/**
 * SUIVI DES CONFLITS — détection automatique, workflow et cycle de vie.
 *
 * Ce module gère la persistance et le suivi des conflits détectés sur le réseau routier :
 *   — États du workflow (NEW → … → CLOSED) et transitions : voir workflowConflits.mjs ;
 *     toute transition passe par `appliquer` (ci-dessous), jamais ailleurs
 *   — `statut` (ancien champ) : dérivé de l'état, tenu à jour pour les autres modules
 *   — Conservation intégrale de l'historique lors de la résolution
 *   — Déduplication des notifications pour un même conflit inchangé
 *   — Cloisonnement hiérarchique : Super Admin, CMD_REGION, CMD_COMPAGNIE
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { analyserConflitsComplet } from './analyseConflits.mjs';
import { enService } from './modificationBarrage.mjs';
import { estIntouchable } from './depot.mjs';
import { recalerPosition } from './pointKilometrique.mjs';
import {
  ETATS, LIBELLES, STATUT_HERITE, ErreurWorkflow, etatDe, estClos, peutVoir, verifierAction,
  synchroniserChampsHerites, regionsAssignees, cieAssignee, responsableDe, libelleAction,
  peutSupprimer,
} from './workflowConflits.mjs';

export const STATUTS_CONFLIT = {
  nouveau: { libelle: 'Nouveau', code: 'nouveau' },
  a_traiter: { libelle: 'À traiter', code: 'a_traiter' },
  en_cours: { libelle: 'En cours de traitement', code: 'en_cours' },
  resolu: { libelle: 'Résolu', code: 'resolu' },
  traite: { libelle: 'Traité — en validation', code: 'traite' },
  a_corriger: { libelle: 'À corriger', code: 'a_corriger' },
  cloture: { libelle: 'Clôturé (approuvé définitivement)', code: 'cloture' },
};

const nouvelId = () => `conf_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
const cleDePaire = (aId, bId) => [String(aId), String(bId)].sort().join('|');

function resumeBarrage(b) {
  if (!b) return null;
  return {
    id: b.id,
    nom: b.nom || b.id,
    type: b.type ?? null,
    route: b.route || '',
    pk: Number.isFinite(b.pk) ? b.pk : null,
    lng: b.lng,
    lat: b.lat,
    reg: b.reg ?? null,
    cie: b.cie ?? null,
    bt: b.bt ?? null,
    factionId: b.factionId ?? null,
    statutBarrage: b.statutBarrage ?? null,
  };
}

export function creerDepotSuiviConflits(fichier) {
  let items = [];
  let supprimes = [];
  let mtimeConnu = 0;

  const dateFichier = () => {
    try {
      return statSync(fichier).mtimeMs;
    } catch {
      return 0;
    }
  };

  const charger = () => {
    if (!existsSync(fichier)) {
      items = [];
      supprimes = [];
      mtimeConnu = 0;
      return;
    }
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter((c) => c && typeof c.id === 'string');
      supprimes = Array.isArray(brut.supprimes)
        ? brut.supprimes
            .map(String)
            .map((s) => s.trim())
            .filter((s) => Boolean(s) && !/^C-\d+$/i.test(s))
        : [];
      mtimeConnu = dateFichier();
    } catch (err) {
      throw new Error(`Dépôt du suivi des conflits illisible (${fichier}) : ${err.message}`);
    }
  };

  charger();

  const relireSiModifie = () => {
    const m = dateFichier();
    if (!m || m === mtimeConnu) return;
    try {
      charger();
    } catch {
      // Conserver l'état mémoire en cas de lecture concurrente temporaire
    }
  };

  const ecrire = () => {
    mkdirSync(dirname(resolve(fichier)), { recursive: true });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items, supprimes }, null, 2));
    renameSync(tmp, fichier);
    mtimeConnu = dateFichier();
  };

  const extrairePaireId = (id) => {
    if (!id) return null;
    const clean = String(id).trim().replace(/^(?:conf_calc_|conf_)/i, '');
    if (clean.includes('|')) {
      const parties = clean.split('|');
      if (parties.length === 2 && parties[0] && parties[1]) {
        return cleDePaire(parties[0], parties[1]);
      }
    }
    return null;
  };

  /**
   * LA PAIRE VIVANTE. Une paire peut porter un conflit CLOS (historique, jamais
   * modifié) et un conflit ACTIF ouvert depuis : toute recherche par paire
   * désigne le second. L'identifiant exact, lui, désigne toujours son conflit.
   */
  const parPaireActive = (paire) => (paire ? items.find((c) => c.paireCle === paire && !estClos(c) && !c.is_deleted && !c.deleted) ?? null : null);

  const trouverConflit = (id) => {
    if (!id) return null;
    const cleanId = String(id).trim();
    const norm = cleanId.toLowerCase();
    const paireId = extrairePaireId(cleanId);
    const exact = items.find(
      (c) => c.id === cleanId || c.numero === cleanId || String(c.id).toLowerCase() === norm || String(c.numero).toLowerCase() === norm,
    );
    if (exact) return exact;
    const paire = paireId || (items.some((c) => c.paireCle === cleanId) ? cleanId : null) ||
      (cleanId.includes('|') ? cleDePaire(...cleanId.split('|')) : null);
    return parPaireActive(paire) ?? (paire ? items.find((c) => c.paireCle === paire) ?? null : null);
  };

  /** Trace de transition, ajoutée au conflit et jamais réécrite. */
  const ajouterTransition = (conf, { ts, auteur, action, de, vers, motif = null, changement = null }) => {
    conf.transitions = conf.transitions ?? [];
    const t = { date: ts, action, de, vers, auteur, motif: motif || null, ...(changement ? { changement } : {}) };
    conf.transitions.push(t);
    return t;
  };

  /** L'auteur d'une action, tel qu'il est inscrit à l'historique. */
  const auteurDe = (session) => ({
    matricule: session?.matricule ?? null,
    nom: session?.nom ?? null,
    rang: session?.rang ?? null,
    unite: session?.unite ?? null,
  });
  let compteurHistorique = 0;
  const idHistorique = () => `h_${Date.now().toString(36)}_${(++compteurHistorique).toString(36)}${randomBytes(2).toString('hex')}`;

  /**
   * APPLIQUER UNE ACTION DU WORKFLOW — le SEUL endroit où l'état d'un conflit
   * change (voir workflowConflits.mjs). Vérifie rôle, état, périmètre et
   * motif AVANT toute écriture ; inscrit à l'historique chaque état traversé
   * (l'historique n'est jamais réécrit ni vidé) ; applique les changements
   * propres à l'action (`modifier`) ; tient à jour les champs hérités ;
   * enregistre.
   */
  const appliquer = (conf, session, action, { motif = '', etatAttendu = null, commentaire = '', destinataire = null, modifier = null, extra = null } = {}) => {
    const { de, vers, etapes } = verifierAction(conf, session, action, { motif, etatAttendu });
    const ts = new Date().toISOString();
    const auteur = auteurDe(session);
    conf.historique = conf.historique ?? [];
    let courant = de;
    for (const e of etapes) {
      conf.historique.push({
        id: idHistorique(), date: ts, auteur, action, de: courant, vers: e, statut: STATUT_HERITE[e],
        commentaire: `${libelleAction(action)} — ${LIBELLES[e]}.`,
      });
      courant = e;
    }
    modifier?.(conf, { ts, auteur });
    conf.etat = vers;
    const entree = {
      id: idHistorique(),
      date: ts,
      auteur,
      action,
      de: courant,
      vers,
      statut: STATUT_HERITE[vers],
      commentaire: commentaire || `${libelleAction(action)}.`,
      motif: String(motif ?? '').trim() || null,
      ...(destinataire ? { destinataire } : {}),
      ...(extra ?? {}),
    };
    conf.historique.push(entree);
    ajouterTransition(conf, { ts, auteur, action, de, vers, motif: entree.motif });
    conf.maj = ts;
    synchroniserChampsHerites(conf);
    ecrire();
    return { conf, entree, ts, de, vers };
  };

  /** Notification ADRESSÉE, liée au conflit et à l'étape — jamais en double. */
  const notifier = (depotNotifications, session, conf, entree, { titre, description, destinataires, type = 'validation' }) => {
    if (!depotNotifications?.publierConflit || !destinataires?.length) return [];
    return destinataires
      .map((d) => depotNotifications.publierConflit({
        session, conf, type, titre, description, destinataires: [d], ts: entree.date,
        cle: `${conf.id}:${entree.id}:${d.rang}:${d.unite ?? ''}:${d.matricule ?? ''}`,
      }))
      .filter(Boolean);
  };
  const ADMINS = [{ rang: 'admin', unite: null, matricule: null }];
  const destRegions = (conf) => regionsAssignees(conf).map((r) => ({ rang: 'reg', unite: r.unite, matricule: null }));
  const destCie = (conf) => {
    const c = cieAssignee(conf);
    return c ? [{ rang: 'cie', unite: c.unite, reg: c.reg ?? null, matricule: null }] : [];
  };
  const destResponsable = (r) => (r ? [{ rang: r.rang, unite: r.unite, reg: r.reg ?? null, matricule: null }] : []);
  const numeroDe = (conf) => conf.numero || conf.id;
  const paireTexte = (conf) => `${conf.barrageA?.nom || conf.barrageAId} ↔ ${conf.barrageB?.nom || conf.barrageBId}`;

  /** Comptes cibles : correspondance EXACTE (matricule, sinon nom d'unité) — jamais approchée, jamais « le premier venu ». */
  const normExact = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const trouverCompte = (tous, rang, ref) => {
    const r = normExact(ref);
    if (!r) return null;
    return tous.find((c) => c.rang === rang && normExact(c.matricule) === r)
      ?? tous.find((c) => c.rang === rang && normExact(c.unite) === r)
      ?? null;
  };

  /** Ferme les instructions encore ouvertes d'un conflit (retiré, réassigné). */
  const annulerInstructions = (depotInstructions, conf, ts, auteur, filtre = () => true) => {
    if (!depotInstructions) return;
    try {
      const ouvertes = depotInstructions.ouvertes ? depotInstructions.ouvertes() : (depotInstructions.tous?.() ?? []).filter((x) => x.statut === 'ouverte');
      for (const inst of ouvertes) {
        if ((inst.criteres?.conflitId === conf.id || inst.criteres?.conflitNumero === conf.numero) && filtre(inst)) {
          inst.statut = 'annulee';
          inst.traiteeLe = ts;
          inst.traiteePar = auteur;
        }
      }
      depotInstructions.ecrire?.();
    } catch (e) {
      console.warn('Annulation des instructions du conflit :', e.message);
    }
  };

  /** L'instruction de travail remise au destinataire (panneau « Instructions »), comme avant. */
  const creerInstruction = (depotInstructions, conf, { destinataire, texte, source, auteur, depotBarrages }) => {
    if (!depotInstructions) return null;
    const bA = depotBarrages?.parId(conf.barrageAId) || conf.barrageA;
    const bB = depotBarrages?.parId(conf.barrageBId) || conf.barrageB;
    return depotInstructions.creer({
      barrageId: conf.barrageAId,
      barrage: bA,
      action: 'assignation',
      source,
      destinataire,
      texte,
      criteres: {
        conflitId: conf.id,
        conflitNumero: numeroDe(conf),
        barrageAId: conf.barrageAId,
        barrageANom: bA?.nom || conf.barrageAId,
        voisinId: conf.barrageBId,
        voisinNom: bB?.nom || conf.barrageBId,
        distanceKm: conf.distanceKm,
        seuilKm: conf.seuilKm,
        factions: conf.factionsCommunes,
        route: conf.route,
        motif: conf.motif || `Espacement de ${conf.distanceKm} km inférieur au seuil réglementaire (${conf.seuilKm} km)`,
      },
      auteur,
    });
  };

  /**
   * RÉSOLUTION « PHYSIQUE » (la paire n'est plus en conflit après une
   * opération sur un poste) — elle ne décide JAMAIS à la place du workflow :
   *   NEW (personne n'en est chargé) → CLOSED automatiquement, tracé ;
   *   en cours de workflow           → noté (`resolutionPhysique`), état inchangé.
   */
  const resoudrePhysiquement = (c, ts, auteur, commentaire) => {
    const etat = etatDe(c);
    if (etat === ETATS.CLOSED) return false;
    c.historique = c.historique ?? [];
    if (etat === ETATS.NEW) {
      c.etat = ETATS.CLOSED;
      c.clotureLe = ts;
      c.cloturePar = auteur;
      c.resoluLe = ts;
      c.statutPhysique = 'resolu';
      c.historique.push({ id: idHistorique(), date: ts, auteur, action: 'resolution_automatique', de: ETATS.NEW, vers: ETATS.CLOSED, statut: STATUT_HERITE.CLOSED, commentaire });
      c.maj = ts;
      synchroniserChampsHerites(c);
      return true;
    }
    if (c.resolutionPhysique) return false;
    c.resolutionPhysique = { le: ts, commentaire };
    c.statutPhysique = 'resolu';
    c.historique.push({ id: idHistorique(), date: ts, auteur, action: 'resolution_physique', de: etat, vers: etat, statut: STATUT_HERITE[etat], commentaire });
    c.maj = ts;
    return true;
  };

  return {
    tous: () => {
      relireSiModifie();
      return items;
    },
    parId: (id) => {
      relireSiModifie();
      return trouverConflit(id);
    },
    parPaire: (aId, bId) => {
      relireSiModifie();
      return parPaireActive(cleDePaire(aId, bId));
    },
    /** Relit le dépôt si un autre processus l'a modifié (avant une décision). */
    rafraichir: () => relireSiModifie(),
    concernant: (barrageId) => {
      relireSiModifie();
      return items.filter((c) => c.barrageAId === barrageId || c.barrageBId === barrageId);
    },
    vider: () => {
      /* Les conflits définitivement approuvés ne sont jamais supprimés
         physiquement : ils forment l'historique. */
      items = items.filter((c) => estClos(c));
      ecrire();
      return true;
    },
    recharger: () => {
      charger();
      return items;
    },
    estSupprime: (cle) => {
      if (!cle) return false;
      const clean = String(cle).trim();
      if (/^C-\d+$/i.test(clean)) return false;
      const norm = clean.toLowerCase();
      return (
        supprimes.includes(clean) ||
        supprimes.includes(norm) ||
        (clean.includes('|') && supprimes.includes(cleDePaire(...clean.split('|'))))
      );
    },
    supprimes: () => {
      relireSiModifie();
      return [...supprimes];
    },
    restaurerConflits: (identifiantsOuPaires = []) => {
      relireSiModifie();
      const cibles = (Array.isArray(identifiantsOuPaires) ? identifiantsOuPaires : [identifiantsOuPaires])
        .filter(Boolean)
        .map((s) => String(s).trim());
      if (cibles.length === 0) return 0;
      const ciblesSet = new Set();
      for (const c of cibles) {
        ciblesSet.add(c);
        ciblesSet.add(c.toLowerCase());
        if (c.includes('|')) {
          const parts = c.split('|');
          if (parts.length === 2) {
            ciblesSet.add(cleDePaire(parts[0], parts[1]));
          }
        }
      }
      const avant = supprimes.length;
      supprimes = supprimes.filter((s) => !ciblesSet.has(s) && !ciblesSet.has(String(s).toLowerCase()));
      let reactive = 0;
      for (const item of items) {
        if (item.is_deleted || item.deleted) {
          if (ciblesSet.has(item.id) || ciblesSet.has(String(item.id).toLowerCase()) || (item.paireCle && ciblesSet.has(item.paireCle))) {
            item.is_deleted = false;
            item.deleted = false;
            delete item.deleted_at;
            delete item.deleted_by;
            reactive++;
          }
        }
      }
      if (supprimes.length !== avant || reactive > 0) {
        ecrire();
      }
      return avant - supprimes.length;
    },

    /**
     * SUPPRESSION MANUELLE D'UN CONFLIT SPÉCIFIQUE (OPTION « REMOVE »).
     * Ne supprime que le conflit ciblé sans affecter les autres.
     * Enregistre la paire dans la liste d'exclusion persistante (supprimes),
     * annule les instructions associées si ouvertes et persiste en base de données.
     */
    supprimerConflit({
      conflitId,
      paireCle = null,
      barrageAId = null,
      barrageBId = null,
      session = null,
      depotInstructions = null,
      depotNotifications = null,
    }) {
      relireSiModifie();
      if (!conflitId && !paireCle && (!barrageAId || !barrageBId)) {
        throw new Error('Identifiant du conflit manquant.');
      }
      let conf = trouverConflit(conflitId);
      if (!conf && paireCle) conf = trouverConflit(paireCle);
      if (!conf && barrageAId && barrageBId) conf = trouverConflit(cleDePaire(barrageAId, barrageBId));

      let paireStr = conf?.paireCle
        ? String(conf.paireCle).trim()
        : paireCle
        ? String(paireCle).trim()
        : (barrageAId && barrageBId ? cleDePaire(barrageAId, barrageBId) : null);

      if (!paireStr && conflitId && String(conflitId).includes('|')) {
        const cleanPaire = extrairePaireId(conflitId);
        if (cleanPaire) paireStr = cleanPaire;
      }

      // Si conf est null mais qu'on a un id relatif comme C-01
      if (!conf && !paireStr) {
        const cleanNorm = String(conflitId || '').trim().toLowerCase();
        const cand = items.find(
          (c) =>
            String(c.id).toLowerCase() === cleanNorm ||
            String(c.numero).toLowerCase() === cleanNorm
        );
        if (cand) {
          conf = cand;
          paireStr =
            conf.paireCle ||
            (conf.barrageAId && conf.barrageBId
              ? cleDePaire(conf.barrageAId, conf.barrageBId)
              : null);
        }
      }

      if (!conf && !paireStr) {
        throw new Error(`Conflit introuvable : ${conflitId}`);
      }
      if (session && session.rang !== 'admin') {
        throw new ErreurWorkflow(403, 'Seul le Super Admin peut supprimer un conflit.');
      }
      if (conf && !peutSupprimer(conf, { rang: 'admin' })) {
        throw new ErreurWorkflow(409, 'Un conflit soumis, validé ou clos ne peut pas être supprimé : il est conservé dans l’historique.');
      }

      const ts = new Date().toISOString();
      const auteur = session
        ? {
            matricule: session.matricule ?? null,
            nom: session.nom ?? null,
            rang: session.rang ?? null,
            unite: session.unite ?? null,
          }
        : { matricule: 'admin', nom: 'Super Admin', rang: 'admin', unite: 'admin' };

      // Enregistrer dans la liste persistante des conflits manuellement supprimés
      const idStr = String(conf?.id || conflitId || '').trim();

      if (paireStr && !supprimes.includes(paireStr)) supprimes.push(paireStr);
      if (idStr && !/^C-\d+$/i.test(idStr) && !supprimes.includes(idStr)) supprimes.push(idStr);

      // Suppression logique (soft delete) : le conflit et son historique sont conservés pour l'audit
      if (conf) {
        conf.is_deleted = true;
        conf.deleted = true;
        conf.deleted_at = ts;
        conf.deleted_by = auteur;
        conf.historique = conf.historique ?? [];
        conf.historique.push({
          id: idHistorique(),
          date: ts,
          auteur,
          action: 'suppression_logique',
          de: etatDe(conf),
          vers: etatDe(conf),
          statut: conf.statut,
          commentaire: 'Suppression logique par le Super Admin.',
        });
        conf.maj = ts;
      }

      ecrire();

      // Annuler les instructions associées si présentes
      if (depotInstructions && (conf || paireStr)) {
        try {
          const ouvertes = depotInstructions.ouvertes
            ? depotInstructions.ouvertes()
            : depotInstructions.tous
            ? depotInstructions.tous().filter((x) => x.statut === 'ouverte')
            : [];
          for (const inst of ouvertes) {
            if (
              (conf &&
                (inst.criteres?.conflitId === conf.id ||
                  inst.criteres?.conflitNumero === conf.numero)) ||
              (paireStr && inst.criteres?.paireCle === paireStr) ||
              inst.criteres?.conflitId === conflitId
            ) {
              inst.statut = 'annulee';
              inst.traiteeLe = ts;
              inst.traiteePar = auteur;
            }
          }
          if (typeof depotInstructions.ecrire === 'function') depotInstructions.ecrire();
        } catch (e) {
          console.warn('Erreur annulation instruction lors de la suppression de conflit:', e.message);
        }
      }

      return {
        ok: true,
        id: conf?.id || idStr || paireStr,
        numero: conf?.numero || conf?.id || idStr || paireStr,
        paireCle: paireStr || conf?.paireCle || null,
        conflitSupprime: conf || { id: idStr, paireCle: paireStr },
      };
    },

    /**
     * SUPPRESSION SÉCURISÉE GROUPÉE (Super Admin uniquement).
     * Effectue un soft-delete sur l'ensemble des conflits admissibles.
     */
    supprimerConflitsGroupe({
      conflitIds = [],
      session = null,
      depotInstructions = null,
      depotNotifications = null,
    }) {
      if (!session || session.rang !== 'admin') {
        throw new ErreurWorkflow(403, 'Seul le Super Admin peut supprimer des conflits.');
      }
      relireSiModifie();
      const cibles = (Array.isArray(conflitIds) ? conflitIds : [conflitIds]).filter(Boolean).map(String);
      if (cibles.length === 0) return { ok: true, supprimes: [], nonSupprimes: [], nbSupprimes: 0 };

      const supprimesResult = [];
      const nonSupprimes = [];
      const ts = new Date().toISOString();
      const auteur = auteurDe(session);

      for (const ref of cibles) {
        const conf = trouverConflit(ref);
        if (!conf) {
          nonSupprimes.push({ id: ref, raison: 'Conflit introuvable' });
          continue;
        }
        if (!peutSupprimer(conf, session)) {
          nonSupprimes.push({
            id: conf.numero || conf.id,
            raison: `Ce conflit est ${LIBELLES[etatDe(conf)].toLowerCase()} et ne peut être supprimé.`,
          });
          continue;
        }

        const paireStr = conf.paireCle || (conf.barrageAId && conf.barrageBId ? cleDePaire(conf.barrageAId, conf.barrageBId) : null);
        const idStr = String(conf.id || '').trim();

        if (paireStr && !supprimes.includes(paireStr)) supprimes.push(paireStr);
        if (idStr && !/^C-\d+$/i.test(idStr) && !supprimes.includes(idStr)) supprimes.push(idStr);

        conf.is_deleted = true;
        conf.deleted = true;
        conf.deleted_at = ts;
        conf.deleted_by = auteur;
        conf.historique = conf.historique ?? [];
        conf.historique.push({
          id: idHistorique(),
          date: ts,
          auteur,
          action: 'suppression_logique',
          de: etatDe(conf),
          vers: etatDe(conf),
          statut: conf.statut,
          commentaire: 'Suppression logique groupée par le Super Admin.',
        });
        conf.maj = ts;

        annulerInstructions(depotInstructions, conf, ts, auteur);
        supprimesResult.push(conf.numero || conf.id);
      }

      if (supprimesResult.length > 0) {
        ecrire();
      }

      return {
        ok: true,
        supprimes: supprimesResult,
        nonSupprimes,
        nbSupprimes: supprimesResult.length,
      };
    },

    /**
     * ASSIGNATION GROUPÉE DE PLUSIEURS CONFLITS (Super Admin uniquement).
     */
    assignerConflitsGroupe({
      conflitIds = [],
      session = null,
      matricule = null,
      matricules = null,
      consigne = '',
      conflitDataList = [],
      depotBarrages = null,
      depotInstructions = null,
      depotNotifications = null,
      comptes = null,
    }) {
      if (!session || session.rang !== 'admin') {
        throw new ErreurWorkflow(403, 'Seul le Super Admin peut assigner des conflits.');
      }
      relireSiModifie();
      const cibles = (Array.isArray(conflitIds) ? conflitIds : [conflitIds]).filter(Boolean);
      if (cibles.length === 0) return { ok: true, assignes: [], erreurs: [], nbAssignes: 0 };

      const assignes = [];
      const erreurs = [];

      for (let i = 0; i < cibles.length; i++) {
        const cId = cibles[i];
        const cd = Array.isArray(conflitDataList) ? (conflitDataList.find((x) => x?.id === cId) || conflitDataList[i]) : null;
        try {
          const res = this.assignerConflit({
            conflitId: cId,
            session,
            matricule,
            matricules,
            consigne,
            conflitData: cd,
            depotBarrages,
            depotInstructions,
            depotNotifications,
            comptes,
          });
          assignes.push({ id: cId, res });
        } catch (err) {
          erreurs.push({ id: cId, erreur: err.message });
        }
      }

      return {
        ok: true,
        nbAssignes: assignes.length,
        assignes,
        erreurs,
      };
    },

    /**
     * CLOISONNEMENT — appliqué par le serveur à chaque lecture (`peutVoir`,
     * workflowConflits.mjs) : Super Admin, tout ; CMD Région, les conflits
     * ASSIGNÉS à sa région ; CMD CIE, ceux assignés à SA compagnie ; aucun
     * autre rôle. Un conflit non assigné (NEW) n'est visible que du Super Admin.
     */
    visiblesPour(session, { statut = null, etat = null } = {}) {
      if (!session) return [];
      relireSiModifie();
      let liste = items.filter((c) => !c.is_deleted && !c.deleted && peutVoir(c, session));
      if (statut) liste = liste.filter((c) => c.statut === statut);
      if (etat) liste = liste.filter((c) => etatDe(c) === etat);
      return liste;
    },

    /**
     * ÉTAPE 1 — LE SUPER ADMIN ASSIGNE UN CONFLIT À UN CMD RÉGION (deux pour un
     * conflit inter-régions). Un conflit calculé par la filtration et pas
     * encore enregistré l'est ici (état NEW), puis assigné.
     *
     * Comptes cibles désignés EXACTEMENT (matricule, sinon nom de région) :
     * jamais d'approximation, jamais « le premier compte venu ». Règle BFI
     * (inchangée) : un conflit entre un poste intouchable et un poste ordinaire
     * va à la région du poste ordinaire, le seul qui peut bouger.
     */
    assignerConflit({
      conflitId,
      session,
      matricule,
      matricules = null,
      consigne = '',
      conflitData = null,
      etatAttendu = null,
      depotBarrages,
      depotInstructions,
      depotNotifications,
      comptes,
    }) {
      if (!session) throw new ErreurWorkflow(401, 'Authentification requise.');
      if (session.rang !== 'admin') throw new ErreurWorkflow(403, 'Seul le Super Admin peut assigner un conflit à un CMD Région.');
      if (!conflitId) throw new ErreurWorkflow(422, 'Identifiant du conflit manquant.');
      relireSiModifie();

      const refs = (Array.isArray(matricules) && matricules.length ? matricules : String(matricule ?? '').split(','))
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (!refs.length) throw new ErreurWorkflow(422, 'Sélectionnez au moins un CMD Région.');
      const tous = comptes?.tous ? comptes.tous() : [];
      let cibles = [];
      for (const ref of refs) {
        const c = trouverCompte(tous, 'reg', ref);
        if (!c) throw new ErreurWorkflow(422, `CMD Région introuvable : « ${ref} ».`);
        if (!cibles.some((x) => normExact(x.unite) === normExact(c.unite))) cibles.push(c);
      }

      let conf = trouverConflit(conflitId);
      const aIdCand = conflitData?.barrageAId || conflitData?.a?.id;
      const bIdCand = conflitData?.barrageBId || conflitData?.b?.id;
      if (!conf && aIdCand && bIdCand) conf = parPaireActive(cleDePaire(aIdCand, bIdCand));
      let cree = null;
      if (!conf) {
        /* Conflit issu de la filtration du Super Admin : enregistré à l'état NEW. */
        const paire = extrairePaireId(conflitId);
        const bAId = aIdCand || paire?.split('|')[0];
        const bBId = bIdCand || paire?.split('|')[1];
        const bA = bAId ? depotBarrages?.parId(bAId) : null;
        const bB = bBId ? depotBarrages?.parId(bBId) : null;
        if (!bA || !bB) throw new ErreurWorkflow(404, 'Conflit introuvable : ses deux barrages doivent exister.');
        const ts0 = new Date().toISOString();
        conf = {
          id: conflitData?.id || conflitId || nouvelId(),
          numero: conflitData?.numero || conflitData?.id || conflitId,
          paireCle: cleDePaire(bAId, bBId),
          type: 'distance_insuffisante',
          severite: 'alerte',
          barrageAId: bAId,
          barrageBId: bBId,
          barrageA: resumeBarrage(bA),
          barrageB: resumeBarrage(bB),
          route: conflitData?.route || bA.route || bB.route || null,
          factionsCommunes: conflitData?.factionsCommunes || (conflitData?.factionId ? [conflitData.factionId] : []),
          distanceKm: Number(conflitData?.distanceKm ?? conflitData?.km ?? 0),
          seuilKm: Number(conflitData?.seuilKm ?? 20),
          motif: conflitData?.motif ?? null,
          trace: Array.isArray(conflitData?.trace) ? conflitData.trace : undefined,
          etat: ETATS.NEW,
          assignation: { regions: [], cie: null, responsable: null, assignePar: null, assigneLe: null },
          statut: 'nouveau',
          cree: ts0,
          maj: ts0,
          historique: [{
            id: idHistorique(), date: ts0, auteur: auteurDe(session), action: 'detection', de: null, vers: ETATS.NEW, statut: 'nouveau',
            commentaire: `Conflit ${conflitData?.numero || conflitId} identifié par la filtration du Super Admin.`,
          }],
        };
        items.push(conf);
        cree = conf;
      }

      /* Règle BFI : la région du poste ordinaire. */
      const bA = depotBarrages?.parId(conf.barrageAId) || conf.barrageA;
      const bB = depotBarrages?.parId(conf.barrageBId) || conf.barrageB;
      const intou = (b) => Boolean(b && (estIntouchable(b) || b.type === 'barrage_vip' || b.protection === 'intouchable' || b.intouchable === true || String(b.id || '').startsWith('BFI-')));
      const regionPosteOrdinaire = intou(bA) && !intou(bB) ? bB?.reg : intou(bB) && !intou(bA) ? bA?.reg : null;
      if (regionPosteOrdinaire && !cibles.every((c) => normExact(c.unite) === normExact(regionPosteOrdinaire))) {
        const compteBF = trouverCompte(tous, 'reg', regionPosteOrdinaire);
        if (!compteBF) {
          if (cree) items.splice(items.indexOf(cree), 1);
          throw new ErreurWorkflow(422, `Ce conflit implique un poste intouchable : il revient au CMD Région ${regionPosteOrdinaire}, introuvable.`);
        }
        cibles = [compteBF];
      }

      const anciennes = regionsAssignees(conf);
      /* Même assignation déjà en place (double clic, requête rejouée) : rien
         ne change — ni transition, ni instruction, ni notification. */
      const memes = (l1, l2) => l1.length === l2.length && l1.every((x) => l2.some((y) => normExact(y.unite) === normExact(x.unite)));
      if (etatDe(conf) === ETATS.ASSIGNED_REGION && memes(anciennes, cibles)) {
        return { ok: true, inchange: true, conflit: conf, instruction: null, instructions: [], assignesA: conf.assignesA };
      }
      const reassignation = etatDe(conf) !== ETATS.NEW;
      const regionsTexte = cibles.map((c) => c.unite).join(' & ');
      let r;
      try {
        r = appliquer(conf, session, 'assigner_region', {
          etatAttendu,
          commentaire: `Conflit ${numeroDe(conf)} ${reassignation ? 'réassigné' : 'assigné'} au CMD Région ${regionsTexte}${consigne ? ` : ${consigne}` : ''}.`,
          destinataire: { rang: 'reg', unite: regionsTexte },
          modifier: (c, { ts, auteur }) => {
            c.assignation = {
              regions: cibles.map((x) => ({ unite: x.unite, matricule: x.matricule, nom: x.nom ?? null })),
              cie: null,
              responsable: null,
              assignePar: auteur,
              assigneLe: ts,
            };
            c.assigneLe = ts;
            if (conflitData?.motif && !c.motif) c.motif = conflitData.motif;
          },
          extra: consigne ? { consigne } : null,
        });
      } catch (e) {
        if (cree) items.splice(items.indexOf(cree), 1);
        throw e;
      }

      /* Les instructions de l'ancienne assignation sont closes, de nouvelles remises. */
      if (reassignation) annulerInstructions(depotInstructions, conf, r.ts, r.entree.auteur);
      const instructions = cibles.map((x) => creerInstruction(depotInstructions, conf, {
        destinataire: { rang: 'reg', unite: x.unite, matricule: x.matricule, nom: x.nom },
        texte: `Conflit ${numeroDe(conf)} assigné : ${paireTexte(conf)} (${conf.distanceKm} km). ${consigne || 'Espacement à traiter par le commandement de région.'}`.trim(),
        source: 'assignation_conflit',
        auteur: r.entree.auteur,
        depotBarrages,
      })).filter(Boolean);

      notifier(depotNotifications, session, conf, r.entree, {
        type: 'assignation',
        titre: 'Nouveau conflit à traiter',
        description: `Le Super Admin vous a assigné le conflit ${numeroDe(conf)} : ${paireTexte(conf)} (${conf.distanceKm} km).${consigne ? ` Consigne : ${consigne}` : ''}`,
        destinataires: destRegions(conf),
      });
      const retirees = anciennes.filter((a) => !cibles.some((x) => normExact(x.unite) === normExact(a.unite)));
      notifier(depotNotifications, session, conf, r.entree, {
        type: 'assignation',
        titre: 'Conflit réassigné',
        description: `Le conflit ${numeroDe(conf)} a été réassigné au CMD Région ${regionsTexte}.`,
        destinataires: retirees.map((a) => ({ rang: 'reg', unite: a.unite, matricule: null })),
      });

      return { ok: true, conflit: conf, instruction: instructions[0] ?? null, instructions, assignesA: conf.assignesA };
    },

    /**
     * DÉSASSIGNATION PAR LE SUPER ADMIN — le conflit revient dans « Les
     * Conflits » (NEW). L'historique des assignations est conservé.
     */
    desassignerConflit({ conflitId, session, etatAttendu = null, depotInstructions, depotNotifications }) {
      if (!session) throw new ErreurWorkflow(401, 'Authentification requise.');
      if (!conflitId) throw new ErreurWorkflow(422, 'Identifiant du conflit manquant.');
      relireSiModifie();
      const conf = trouverConflit(conflitId);
      const anciennesRegions = destRegions(conf ?? {});
      const ancienneCie = destCie(conf ?? {});
      const r = appliquer(conf, session, 'desassigner', {
        etatAttendu,
        commentaire: `Conflit ${numeroDe(conf ?? {})} retiré de ${conf ? regionsAssignees(conf).map((x) => x.unite).join(' & ') || '—' : '—'} : retour dans « Les Conflits ».`,
        modifier: (c) => {
          c.assignation = { regions: [], cie: null, responsable: null, assignePar: null, assigneLe: null };
        },
      });
      annulerInstructions(depotInstructions, conf, r.ts, r.entree.auteur);
      notifier(depotNotifications, session, conf, r.entree, {
        type: 'assignation',
        titre: 'Conflit retiré',
        description: `Le conflit ${numeroDe(conf)} ne vous est plus assigné.`,
        destinataires: [...anciennesRegions, ...ancienneCie],
      });
      return { ok: true, conflit: conf };
    },

    /**
     * ÉTAPE 2, OPTION B — LE CMD RÉGION ASSIGNE LE CONFLIT À UN CMD CIE DE SA
     * RÉGION. Le compte cible est désigné exactement et doit relever de la
     * région du CMD Région (aucune assignation inter-régions). Le CMD Région
     * garde la visibilité du conflit.
     */
    transmettreConflit({ conflitId, session, matricule, consigne = '', etatAttendu = null, depotBarrages, depotInstructions, depotNotifications, comptes }) {
      if (!session) throw new ErreurWorkflow(401, 'Authentification requise.');
      if (session.rang !== 'reg') throw new ErreurWorkflow(403, 'Seul le CMD Région peut assigner un conflit à un CMD CIE.');
      if (!conflitId) throw new ErreurWorkflow(422, 'Identifiant du conflit manquant.');
      if (!matricule) throw new ErreurWorkflow(422, 'Sélectionnez un CMD CIE.');
      relireSiModifie();
      const conf = trouverConflit(conflitId);
      const cible = trouverCompte(comptes?.tous ? comptes.tous() : [], 'cie', matricule);
      if (!cible) throw new ErreurWorkflow(422, `CMD CIE introuvable : « ${matricule} ».`);
      if (normExact(cible.reg) !== normExact(session.unite)) {
        throw new ErreurWorkflow(403, `La compagnie ${cible.unite} ne relève pas de votre région.`);
      }
      const ancienne = cieAssignee(conf ?? {});
      const r = appliquer(conf, session, 'assigner_cie', {
        etatAttendu,
        commentaire: `Conflit ${numeroDe(conf ?? {})} assigné par le CMD Région ${session.unite} au CMD CIE ${cible.unite}${consigne ? ` : ${consigne}` : ''}.`,
        destinataire: { rang: 'cie', unite: cible.unite },
        modifier: (c, { ts, auteur }) => {
          c.assignation = {
            ...(c.assignation ?? { regions: regionsAssignees(c) }),
            cie: { unite: cible.unite, reg: cible.reg ?? null, matricule: cible.matricule, nom: cible.nom ?? null, assignePar: auteur, assigneLe: ts },
            responsable: null,
          };
        },
        extra: consigne ? { consigne } : null,
      });
      if (ancienne && normExact(ancienne.unite) !== normExact(cible.unite)) {
        annulerInstructions(depotInstructions, conf, r.ts, r.entree.auteur, (inst) => inst.destinataire?.rang === 'cie');
      }
      const instruction = creerInstruction(depotInstructions, conf, {
        destinataire: { rang: 'cie', unite: cible.unite, matricule: cible.matricule, nom: cible.nom },
        texte: `Conflit ${numeroDe(conf)} assigné par la Région ${session.unite} : ${paireTexte(conf)} (${conf.distanceKm} km). ${consigne || 'Traitement opérationnel délégué à la compagnie.'}`.trim(),
        source: 'transmission_conflit',
        auteur: r.entree.auteur,
        depotBarrages,
      });
      notifier(depotNotifications, session, conf, r.entree, {
        type: 'assignation',
        titre: 'Nouveau conflit assigné à votre compagnie',
        description: `Le CMD Région ${session.unite} vous a assigné le conflit ${numeroDe(conf)} : ${paireTexte(conf)} (${conf.distanceKm} km).${consigne ? ` Consigne : ${consigne}` : ''}`,
        destinataires: destCie(conf),
      });
      if (ancienne && normExact(ancienne.unite) !== normExact(cible.unite)) {
        notifier(depotNotifications, session, conf, r.entree, {
          type: 'assignation',
          titre: 'Conflit réassigné',
          description: `Le conflit ${numeroDe(conf)} a été confié à une autre compagnie.`,
          destinataires: [{ rang: 'cie', unite: ancienne.unite, reg: ancienne.reg ?? null, matricule: null }],
        });
      }
      return { ok: true, conflit: conf, instruction };
    },

    /**
     * TRAITEMENT DIRECT D'UN CONFLIT PAR LE COMMANDEMENT.
     * Enregistre l'opération, actualise l'historique et résout le conflit si
     * la condition de séparation ou de faction est satisfaite.
     */
    traiterConflit({
      conflitId,
      session,
      action = 'changement_faction',
      details = {},
      depotBarrages,
      depotInstructions,
      depotNotifications,
      auditer = null,
      graphe = null,
    }) {
      if (!session) throw new ErreurWorkflow(401, 'Authentification requise.');
      relireSiModifie();
      if (!['admin', 'reg', 'cie'].includes(session.rang)) {
        throw new ErreurWorkflow(403, 'Seuls le Super Admin, le CMD Région et le CMD CIE peuvent traiter un conflit.');
      }
      const ts = new Date().toISOString();
      const auteur = {
        matricule: session.matricule ?? null,
        nom: session.nom ?? null,
        rang: session.rang,
        unite: session.unite,
      };

      let conf = trouverConflit(conflitId);
      let confCree = null;
      const paireDeId = extrairePaireId(conflitId);
      if (!conf && paireDeId) {
        conf = parPaireActive(paireDeId);
      }
      if (!conf && (details?.paireCle || details?.conflitData?.paireCle)) {
        const p = details.paireCle || details.conflitData.paireCle;
        conf = parPaireActive(p);
      }
      if (!conf && conflitId && !conflitId.includes('|')) {
        const candNorm = String(conflitId).trim().toLowerCase();
        const cand = items.find((c) => String(c.id).toLowerCase() === candNorm || String(c.numero).toLowerCase() === candNorm);
        if (cand) conf = cand;
      }
      /* Un conflit calculé (pas encore enregistré) ne peut être traité
         directement que par le Super Admin ; les autres rôles ne traitent
         que ce qui leur a été assigné. */
      if (!conf && details?.conflitData && session.rang === 'admin') {
        const cd = details.conflitData;
        const bAId = cd.barrageAId || cd.a?.id || (paireDeId ? paireDeId.split('|')[0] : null);
        const bBId = cd.barrageBId || cd.b?.id || (paireDeId ? paireDeId.split('|')[1] : null);
        const bAObj = depotBarrages?.parId(bAId) || cd.a || (bAId ? { id: bAId } : null);
        const bBObj = depotBarrages?.parId(bBId) || cd.b || (bBId ? { id: bBId } : null);
        const paire = cleDePaire(bAId, bBId);
        conf = {
          id: cd.id || conflitId,
          numero: cd.numero || conflitId,
          paireCle: paire,
          type: 'distance_insuffisante',
          severite: 'alerte',
          barrageAId: bAId,
          barrageBId: bBId,
          barrageA: resumeBarrage(bAObj),
          barrageB: resumeBarrage(bBObj),
          route: cd.route || bAObj?.route || bBObj?.route || '',
          distanceKm: cd.distanceKm ?? 0,
          seuilKm: cd.seuilKm ?? 20,
          factionsCommunes: cd.factionsCommunes || [],
          motif: cd.motif || 'Espacement insuffisant',
          etat: ETATS.NEW,
          assignation: { regions: [], cie: null, responsable: null, assignePar: null, assigneLe: null },
          statut: STATUT_HERITE.NEW,
          cree: ts,
          historique: [],
        };
        items.push(conf);
        confCree = conf;
      }
      if (!conf) throw new ErreurWorkflow(404, 'Conflit introuvable.');
      /* Garde de rôle, d'état et de périmètre — AVANT toute écriture (et
         avant toute modification de barrage). Un conflit tout juste créé pour
         ce traitement est retiré si la garde le refuse. */
      try {
        verifierAction(conf, session, 'soumettre');
      } catch (err) {
        if (confCree) items.splice(items.indexOf(confCree), 1);
        throw err;
      }

      const bA = depotBarrages?.parId(conf.barrageAId) || conf.barrageA;
      const bB = depotBarrages?.parId(conf.barrageBId) || conf.barrageB;
      const intA = estIntouchable(bA) || bA?.type === 'barrage_vip' || bA?.protection === 'intouchable' || bA?.intouchable === true || String(bA?.id || '').startsWith('BFI-');
      const intB = estIntouchable(bB) || bB?.type === 'barrage_vip' || bB?.protection === 'intouchable' || bB?.intouchable === true || String(bB?.id || '').startsWith('BFI-');
      const regA = bA?.reg || conf?.barrageA?.reg || null;
      const regB = bB?.reg || conf?.barrageB?.reg || null;
      const estInterRegionDeuxBfi = Boolean(
        intA && intB && regA && regB && regA.trim().toLowerCase() !== regB.trim().toLowerCase()
      );

      // Protection FIXE INTOUCHABLE (Cas A & Cas C) :
      // EXCEPTION : En cas de conflit INTER-RÉGIONS entre deux BFI, le CMD Région a le droit de :
      // 1) Déplacer le BFI
      // 2) Changer sa faction (décalage horaire)
      // 3) Rétrograder le BFI en BF ordinaire
      if (action === 'changement_faction' && !estInterRegionDeuxBfi && (intA || intB || conf.entreIntouchables)) {
        throw new Error('Action non autorisée : un conflit impliquant un barrage FIXE INTOUCHABLE (BFI) ne peut pas être résolu par un changement de faction. Les barrages intouchables sont permanents (24h/24) et actifs sur toutes les factions.');
      }

      let persiste = true;
      let statutPhysique = 'maintenu';
      let commentaireAction = '';
      let decisionLibelle = '';
      let barrageModifie = null;

      if (action === 'changement_faction') {
        const { barrageId, nouvelleFactionId, nouvelleFactionNom } = details;
        const bModifie = barrageId === conf.barrageBId ? bB : bA;
        if (bModifie && depotBarrages && session.rang === 'admin') {
          depotBarrages.modifier?.(bModifie.id, { factionId: nouvelleFactionId, majPar: auteur });
          barrageModifie = depotBarrages.parId(bModifie.id) || { ...bModifie, factionId: nouvelleFactionId };
        }
        // Règle métier : la proximité physique persiste sous un décalage horaire
        persiste = true;
        statutPhysique = 'maintenu_decalage_horaire';
        decisionLibelle = `Changement de faction du barrage ${bModifie?.nom || barrageId} (${nouvelleFactionNom || nouvelleFactionId})`;
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : Faction modifiée en ${nouvelleFactionNom || nouvelleFactionId}. Proximité physique maintenue sous décalage horaire.`;
      } else if (action === 'suppression' || action === 'suppression_barrage') {
        const { barrageId } = details;
        const bSuppr = barrageId === conf.barrageBId ? bB : bA;
        if (bSuppr) {
          if (estIntouchable(bSuppr) || bSuppr?.type === 'barrage_vip' || bSuppr?.protection === 'intouchable') {
            throw new Error('Un barrage FIXE INTOUCHABLE ne peut pas être supprimé.');
          }
          if (depotBarrages && session.rang === 'admin') {
            depotBarrages.supprimer?.(bSuppr.id) || depotBarrages.modifier?.(bSuppr.id, { statutBarrage: 'supprime', majPar: auteur });
            barrageModifie = { id: bSuppr.id, statutBarrage: 'supprime', supprime: true };
          }
        }
        persiste = false;
        statutPhysique = 'resolu';
        decisionLibelle = `Suppression du barrage ${bSuppr?.nom || barrageId}`;
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : Barrage ${bSuppr?.nom || barrageId} supprimé. Conflit résolu.`;
      } else if (action === 'deplacement') {
        const { distanceApresKm, seuilKm } = details;
        const dist = Number(distanceApresKm ?? details.nouvelleDistanceKm);
        const seuil = Number(seuilKm ?? conf.seuilKm ?? 20);
        if (Number.isFinite(dist) && dist >= seuil) {
          persiste = false;
          statutPhysique = 'resolu';
        } else {
          persiste = true;
          statutPhysique = 'maintenu';
        }
        if (session.rang === 'admin' && depotBarrages) {
          const bCible = details.barrageId ? (depotBarrages.parId(details.barrageId) || (details.barrageId === conf.barrageBId ? bB : bA)) : bA;
          if (bCible) {
            const latApres = Number(details.latApres ?? details.point?.lat ?? details.point?.[1]);
            const lngApres = Number(details.lngApres ?? details.point?.lng ?? details.point?.[0]);
            const routeApres = details.routeApres ?? details.route ?? bCible.route ?? '';
            let pk = bCible.pk ?? null;
            if (graphe && routeApres && Number.isFinite(lngApres) && Number.isFinite(latApres)) {
              try {
                const lu = recalerPosition(graphe, lngApres, latApres, { route: routeApres, rayonKm: 30 });
                if (lu && !lu.erreur && Number.isFinite(lu.pk)) pk = lu.pk;
              } catch {}
            }
            if (Number.isFinite(latApres) && Number.isFinite(lngApres)) {
              const modifs = { lat: latApres, lng: lngApres, route: routeApres, pk, majPar: auteur };
              depotBarrages.modifier?.(bCible.id, modifs) || depotBarrages.remplacer?.(bCible.id, { ...bCible, ...modifs });
              barrageModifie = depotBarrages.parId(bCible.id) || { ...bCible, ...modifs };
            }
          }
        }
        decisionLibelle = `Déplacement du barrage (${details.motif || 'Réajustement position'})`;
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : ${decisionLibelle}${persiste ? ' — proximité résiduelle maintenue' : ' — espacement réglementaire atteint, conflit résolu'}.`;
      } else if (action === 'retrograder_bf' || action === 'conversion_bf') {
        const { barrageId } = details;
        const bCible = barrageId === conf.barrageBId ? bB : bA;
        if (bCible && depotBarrages && session.rang === 'admin') {
          const modifs = {
            type: 'barrage_fixe',
            protection: 'standard',
            intouchable: false,
            isPermanent: false,
            majPar: auteur,
          };
          depotBarrages.modifier?.(bCible.id, modifs) || depotBarrages.remplacer?.(bCible.id, { ...bCible, ...modifs });
          barrageModifie = depotBarrages.parId(bCible.id) || { ...bCible, ...modifs };
        }
        persiste = true;
        statutPhysique = 'retrograde_bf';
        decisionLibelle = `Rétrogradation du BFI ${bCible?.nom || barrageId} en Barrage Fixe ordinaire (BF)`;
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : Barrage ${bCible?.nom || barrageId} rétrogradé en Barrage Fixe ordinaire (BF). Statut intouchable levé.`;
      } else if (action === 'derogation' || action === 'maintien_justifie') {
        persiste = true;
        statutPhysique = 'maintenu';
        decisionLibelle = 'Dérogation / Maintien opérationnel validé';
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : Maintien opérationnel justifié par le commandement (${details.justification || details.commentaire || 'Point stratégique'}).`;
      } else if (action === 'marquer_resolu' || action === 'resolution' || details?.statut === 'resolu' || details?.resolu === true) {
        persiste = false;
        statutPhysique = 'resolu';
        decisionLibelle = 'Résolution validée';
        commentaireAction = `Conflit ${conf.numero || conf.id} marqué résolu par ${auteur.nom || auteur.unite} : ${details.commentaire || 'Espacement ou arbitrage validé'}.`;
      } else {
        persiste = details?.resolu ? false : true;
        statutPhysique = details?.resolu ? 'resolu' : 'maintenu';
        decisionLibelle = details.decision || action;
        commentaireAction = `Traitement du conflit ${conf.numero || conf.id} : ${details.commentaire || action}.`;
      }

      // Enregistrement des changements détaillés pour affichage Superadmin (avant / après)
      const changement = {
        type: action,
        avant: details.avant || null,
        apres: details.apres || null,
      };

      if (action === 'changement_faction') {
        const barrageId = details.barrageId;
        const bModifie = barrageId === conf.barrageBId ? bB : bA;
        const ancFId = details.ancienneFactionId || (barrageId === conf.barrageBId ? bB?.factionId : bA?.factionId) || 'F1';
        changement.avant = changement.avant || {
          barrageId: details.barrageId || bModifie?.id,
          barrageNom: details.barrageNom || bModifie?.nom,
          factionId: ancFId,
          factionNom: details.ancienneFactionNom || `Faction ${ancFId}`,
        };
        changement.apres = changement.apres || {
          barrageId: details.barrageId || bModifie?.id,
          barrageNom: details.barrageNom || bModifie?.nom,
          factionId: details.nouvelleFactionId,
          factionNom: details.nouvelleFactionNom || `Faction ${details.nouvelleFactionId}`,
        };
      } else if (action === 'deplacement' || action === 'marquer_resolu') {
        const bCible = details.barrageId ? (depotBarrages?.parId(details.barrageId) || (details.barrageId === conf.barrageBId ? bB : bA)) : bA;
        changement.avant = changement.avant || {
          barrageId: bCible?.id || details.barrageId,
          barrageNom: bCible?.nom || details.barrageNom,
          lat: details.latAvant ?? bCible?.lat,
          lng: details.lngAvant ?? bCible?.lng,
          route: details.routeAvant ?? bCible?.route,
          distanceKm: details.distanceAvantKm ?? conf.distanceKm,
        };
        changement.apres = changement.apres || {
          barrageId: bCible?.id || details.barrageId,
          barrageNom: bCible?.nom || details.barrageNom,
          lat: details.latApres ?? details.point?.lat ?? details.point?.[1],
          lng: details.lngApres ?? details.point?.lng ?? details.point?.[0],
          route: details.routeApres ?? details.route ?? bCible?.route,
          distanceKm: details.distanceApresKm,
        };
      } else if (action === 'suppression' || action === 'suppression_barrage') {
        const bSuppr = details.barrageId ? (depotBarrages?.parId(details.barrageId) || (details.barrageId === conf.barrageBId ? bB : bA)) : bA;
        changement.barrageSupprime = resumeBarrage(bSuppr || details.barrageSupprime || { id: details.barrageId, nom: details.barrageNom });
      } else if (action === 'retrograder_bf' || action === 'conversion_bf') {
        const bCible = details.barrageId ? (depotBarrages?.parId(details.barrageId) || (details.barrageId === conf.barrageBId ? bB : bA)) : bA;
        changement.avant = changement.avant || {
          barrageId: bCible?.id || details.barrageId,
          barrageNom: bCible?.nom || details.barrageNom,
          type: bCible?.type || 'barrage_vip',
          protection: bCible?.protection || 'intouchable',
          intouchable: true,
        };
        changement.apres = changement.apres || {
          barrageId: bCible?.id || details.barrageId,
          barrageNom: bCible?.nom || details.barrageNom,
          type: 'barrage_fixe',
          protection: 'standard',
          intouchable: false,
          isPermanent: false,
        };
      }

      /* UNE RESOUMISSION N'ÉCRASE RIEN : le traitement et la décision du cycle
         précédent (refusé) sont conservés dans `cycles`. */
      if (conf.traitement || conf.approbation) {
        conf.cycles = conf.cycles ?? [];
        conf.cycles.push({ cloreLe: ts, traitement: conf.traitement ?? null, approbation: conf.approbation ?? null });
      }

      /* Les informations du traitement (inchangées), puis LA transition :
         CMD CIE / CMD Région → À valider (PENDING_VALIDATION) ; Super Admin
         (traitement direct, fonction existante) → validé et en suivi. */
      const estParAdmin = session.rang === 'admin';
      conf.traiteLe = ts;
      conf.traitePar = auteur;
      conf.persiste = persiste;
      conf.statutPhysique = statutPhysique;
      conf.decision = decisionLibelle;
      conf.justification = String(details.justification || details.commentaire || '').trim();
      conf.changement = changement;
      conf.traitement = {
        date: ts,
        auteur,
        action,
        decision: decisionLibelle,
        justification: conf.justification,
        persiste,
        statutPhysique,
        details,
        changement,
        approbation: {
          statut: estParAdmin ? 'approuve' : 'en_attente_admin',
          date: estParAdmin ? ts : null,
          par: estParAdmin ? auteur : null,
        },
      };
      if (estParAdmin) conf.validation = { decision: 'valider', par: auteur, le: ts, motif: 'Traitement direct par le Super Admin' };

      const { entree } = appliquer(conf, session, 'soumettre', {
        commentaire: commentaireAction,
        modifier: (c) => {
          c.assignation = {
            ...(c.assignation ?? { regions: regionsAssignees(c), cie: cieAssignee(c) }),
            responsable: estParAdmin ? null : { rang: session.rang, unite: session.unite, reg: session.reg ?? null, matricule: session.matricule ?? null },
          };
        },
        extra: { decision: decisionLibelle, justification: conf.justification, statutPhysique, persiste, details, changement },
      });
      auditer?.(conf, { date: entree.date, action: 'soumettre', de: entree.de, vers: entree.vers, auteur: entree.auteur, motif: conf.justification });

      if (!estParAdmin) {
        const qui = session.rang === 'cie' ? `Le CMD CIE ${auteur.unite ?? ''}` : `Le CMD Région ${auteur.unite ?? ''}`;
        notifier(depotNotifications, session, conf, entree, {
          type: 'demande',
          titre: 'Validation requise',
          description: `${qui} a soumis le traitement du conflit ${numeroDe(conf)} (${decisionLibelle}). Il attend votre validation.`,
          destinataires: ADMINS,
        });
        if (session.rang === 'cie') {
          notifier(depotNotifications, session, conf, entree, {
            type: 'validation',
            titre: 'Traitement soumis par la compagnie',
            description: `${qui} a soumis le traitement du conflit ${numeroDe(conf)} au Super Admin.`,
            destinataires: destRegions(conf),
          });
        }
      }

      return {
        ok: true,
        statut: conf.statut,
        persiste,
        statutPhysique,
        decision: decisionLibelle,
        justification: conf.justification,
        conflit: conf,
        resolu: !persiste,
        changement,
        barrageModifie,
        barragesModifies: barrageModifie ? [barrageModifie] : [],
      };
    },

    /**
     * ÉTAPE 4 — LE SUPER ADMIN VALIDE OU REJETTE UN TRAITEMENT SOUMIS.
     *   valider : PENDING_VALIDATION → APPROVED → FOLLOW_UP (section Suivi) ;
     *   rejeter : motif OBLIGATOIRE → REJECTED, renvoyé au responsable (l'auteur
     *             de la soumission), qui corrige et soumet de nouveau.
     */
    deciderTraitement({
      conflitId,
      session,
      decision,
      raison = '',
      etatAttendu = null,
      depotNotifications,
      auditer = null,
      depotBarrages = null,
      depotDemandes = null,
      graphe = null,
    }) {
      relireSiModifie();
      if (!conflitId) throw new ErreurWorkflow(422, 'Identifiant du conflit manquant.');
      const action = decision === 'approuver' || decision === 'valider' ? 'valider' : decision === 'rejeter' ? 'rejeter' : null;
      if (!action) throw new ErreurWorkflow(422, 'Décision inconnue.');
      const conf = trouverConflit(conflitId);
      const responsable = conf ? responsableDe(conf) : null;
      const motif = String(raison ?? '').trim();
      const r = appliquer(conf, session, action, {
        motif,
        etatAttendu,
        commentaire: action === 'valider'
          ? `Traitement du conflit ${numeroDe(conf ?? {})} validé par le Super Admin : en suivi.`
          : `Traitement du conflit ${numeroDe(conf ?? {})} rejeté par le Super Admin : ${motif}`,
        modifier: (c, { ts, auteur }) => {
          c.validation = { decision: action, par: auteur, le: ts, motif: motif || null };
          if (c.traitement) {
            c.traitement.approbation = { ...(c.traitement.approbation ?? {}), statut: action === 'valider' ? 'approuve' : 'rejete_admin', date: ts, par: auteur, raison: motif || null };
          }
          c.approbation = { ...(c.approbation ?? {}), date: ts, par: auteur, raison: motif || null };
          if (action === 'rejeter') c.assignation = { ...(c.assignation ?? {}), responsable };
        },
      });
      auditer?.(conf, { date: r.ts, action, de: r.de, vers: r.vers, auteur: r.entree.auteur, motif: motif || null });

      const barragesModifies = [];
      /* APPLICATION ATOMIQUE DES CHANGEMENTS VALIDÉS AUX BARRAGES */
      if (action === 'valider' && depotBarrages && conf) {
        const ch = conf.changement || conf.traitement?.changement;
        const dt = conf.traitement?.details || {};
        const typeAction = ch?.type || conf.traitement?.action;
        const auteur = auteurDe(session);
        const ts = r.ts;

        if (typeAction === 'deplacement') {
          const bId = ch?.apres?.barrageId || dt.barrageId || conf.barrageAId;
          const bObj = depotBarrages.parId(bId);
          if (bObj) {
            const latApres = Number(ch?.apres?.lat ?? dt.latApres ?? dt.point?.lat ?? dt.point?.[1]);
            const lngApres = Number(ch?.apres?.lng ?? dt.lngApres ?? dt.point?.lng ?? dt.point?.[0]);
            const routeApres = ch?.apres?.route ?? dt.routeApres ?? dt.route ?? bObj.route ?? '';

            let pk = bObj.pk ?? null;
            if (graphe && routeApres && Number.isFinite(lngApres) && Number.isFinite(latApres)) {
              try {
                const lu = recalerPosition(graphe, lngApres, latApres, { route: routeApres, rayonKm: 30 });
                if (lu && !lu.erreur && Number.isFinite(lu.pk)) pk = lu.pk;
              } catch {}
            }

            if (Number.isFinite(latApres) && Number.isFinite(lngApres)) {
              const modifs = {
                lat: latApres,
                lng: lngApres,
                route: routeApres,
                pk,
                majPar: auteur,
                maj: ts,
              };
              const maj = depotBarrages.modifier?.(bId, modifs) || depotBarrages.remplacer?.(bId, { ...bObj, ...modifs });
              if (maj) {
                barragesModifies.push(maj);
                if (conf.barrageAId === bId) conf.barrageA = resumeBarrage(maj);
                if (conf.barrageBId === bId) conf.barrageB = resumeBarrage(maj);
              }
            }
          }
        } else if (typeAction === 'changement_faction') {
          const bId = ch?.apres?.barrageId || dt.barrageId;
          const bObj = depotBarrages.parId(bId);
          const nouvFaction = ch?.apres?.factionId || dt.nouvelleFactionId;
          if (bObj && nouvFaction) {
            const modifs = {
              factionId: nouvFaction,
              majPar: auteur,
              maj: ts,
            };
            const maj = depotBarrages.modifier?.(bId, modifs) || depotBarrages.remplacer?.(bId, { ...bObj, ...modifs });
            if (maj) {
              barragesModifies.push(maj);
              if (conf.barrageAId === bId) conf.barrageA = resumeBarrage(maj);
              if (conf.barrageBId === bId) conf.barrageB = resumeBarrage(maj);
            }
          }
        } else if (typeAction === 'suppression' || typeAction === 'suppression_barrage') {
          const bId = ch?.barrageSupprime?.id || dt.barrageId;
          const bObj = depotBarrages.parId(bId);
          if (bObj) {
            const modifs = { statutBarrage: 'supprime', majPar: auteur, maj: ts };
            const maj = depotBarrages.modifier?.(bId, modifs) || depotBarrages.remplacer?.(bId, { ...bObj, ...modifs });
            if (maj) barragesModifies.push(maj);
          }
        } else if (typeAction === 'retrograder_bf' || typeAction === 'conversion_bf') {
          const bId = ch?.apres?.barrageId || dt.barrageId || conf.barrageAId;
          const bObj = depotBarrages.parId(bId);
          if (bObj) {
            const modifs = {
              type: 'barrage_fixe',
              protection: 'standard',
              intouchable: false,
              isPermanent: false,
              majPar: auteur,
              maj: ts,
            };
            const maj = depotBarrages.modifier?.(bId, modifs) || depotBarrages.remplacer?.(bId, { ...bObj, ...modifs });
            if (maj) {
              barragesModifies.push(maj);
              if (conf.barrageAId === bId) conf.barrageA = resumeBarrage(maj);
              if (conf.barrageBId === bId) conf.barrageB = resumeBarrage(maj);
            }
          }
        }
      }

      /* Synchroniser les demandes d'approbation liées */
      if (depotDemandes && conf) {
        try {
          const toutes = depotDemandes.tous ? depotDemandes.tous() : [];
          for (const dem of toutes) {
            if (
              (dem.barrageId === conf.barrageAId || dem.barrageId === conf.barrageBId) &&
              dem.statut === 'en_attente'
            ) {
              dem.statut = action === 'valider' ? 'approuve' : 'rejete';
              dem.traiteeLe = r.ts;
              dem.traiteePar = auteurDe(session);
              if (action === 'rejeter' && motif) dem.reponse = motif;
            }
          }
          if (typeof depotDemandes.ecrire === 'function') depotDemandes.ecrire();
        } catch (e) {
          console.warn('Erreur mise à jour demandes liées lors de la décision conflit:', e.message);
        }
      }

      const destinataires = [...destResponsable(responsable)];
      if (responsable?.rang === 'cie') destinataires.push(...destRegions(conf));
      notifier(depotNotifications, session, conf, r.entree, action === 'valider'
        ? {
          type: 'validation',
          titre: 'Traitement validé',
          description: `Le Super Admin a validé le traitement du conflit ${numeroDe(conf)}. Le conflit passe en suivi.`,
          destinataires,
        }
        : {
          type: 'demande',
          titre: 'Traitement rejeté — à corriger',
          description: `Le Super Admin a rejeté le traitement du conflit ${numeroDe(conf)}. Motif : ${motif}`,
          destinataires,
        });
      return {
        ok: true,
        conflit: conf,
        etat: conf.etat,
        barragesModifies,
        barrageModifie: barragesModifies[0] ?? null,
      };
    },

    /**
     * ACTIONS SIMPLES DU WORKFLOW (sans données propres) :
     *   prendre_en_charge  CMD Région, option A — il traite lui-même ;
     *   commencer          CMD CIE — début (ou reprise après rejet) du traitement ;
     *   cloturer           Super Admin — fin du suivi, archivage (Historique).
     */
    actionConflit({ conflitId, session, action, motif = '', etatAttendu = null, depotNotifications, auditer = null }) {
      relireSiModifie();
      if (!['prendre_en_charge', 'commencer', 'cloturer'].includes(action)) {
        throw new ErreurWorkflow(422, `Action inconnue : « ${action} ».`);
      }
      const conf = trouverConflit(conflitId);
      const r = appliquer(conf, session, action, {
        motif,
        etatAttendu,
        commentaire: {
          prendre_en_charge: `Le CMD Région ${session?.unite ?? ''} prend en charge le traitement du conflit ${numeroDe(conf ?? {})}.`,
          commencer: `Le CMD CIE ${session?.unite ?? ''} commence le traitement du conflit ${numeroDe(conf ?? {})}.`,
          cloturer: `Conflit ${numeroDe(conf ?? {})} clôturé par le Super Admin : archivé.`,
        }[action],
        modifier: (c, { ts, auteur }) => {
          if (action === 'prendre_en_charge') c.assignation = { ...(c.assignation ?? {}), cie: null, responsable: null };
          if (action === 'cloturer') {
            c.clotureLe = ts;
            c.cloturePar = auteur;
          }
        },
      });
      auditer?.(conf, { date: r.ts, action, de: r.de, vers: r.vers, auteur: r.entree.auteur, motif: r.entree.motif });
      if (action === 'cloturer') {
        notifier(depotNotifications, session, conf, r.entree, {
          type: 'validation',
          titre: 'Conflit clôturé',
          description: `Le conflit ${numeroDe(conf)} est clôturé et archivé.`,
          destinataires: [...destRegions(conf), ...destCie(conf)],
        });
      }
      return { ok: true, conflit: conf, etat: conf.etat };
    },

    historique(session, f = {}) {
      const norm = (v) => String(v ?? '').trim().toLowerCase();
      const contient = (v, q) => !q || norm(v).includes(norm(q));
      const du = f.du ? Date.parse(f.du) : null;
      const au = f.au ? Date.parse(f.au) + 86_399_999 : null;
      return this.visiblesPour(session)
        .filter((c) => estClos(c))
        .filter((c) => {
          const t = Date.parse(c.clotureLe ?? c.maj ?? '') || 0;
          if (du && t < du) return false;
          if (au && t > au) return false;
          const postes = [c.barrageA, c.barrageB];
          if (f.region && !postes.some((b) => contient(b?.reg, f.region))) return false;
          if (f.compagnie && !postes.some((b) => contient(b?.cie, f.compagnie))) return false;
          if (f.brigade && !postes.some((b) => contient(b?.bt, f.brigade))) return false;
          if (f.faction && !(c.factionsCommunes ?? []).some((x) => norm(x) === norm(f.faction)) &&
            !postes.some((b) => norm(b?.factionId) === norm(f.faction))) return false;
          if (f.statut && norm(c.statutPhysique) !== norm(f.statut)) return false;
          if (f.intervenant) {
            const gens = [c.traitePar, c.cloturePar, ...(c.historique ?? []).map((h) => h.auteur)];
            if (!gens.some((p) => contient(p?.nom, f.intervenant) || contient(p?.unite, f.intervenant) || contient(p?.matricule, f.intervenant))) return false;
          }
          return true;
        })
        .sort((a, b) => (Date.parse(b.clotureLe ?? '') || 0) - (Date.parse(a.clotureLe ?? '') || 0));
    },

    /**
     * RÉOUVERTURE EXCEPTIONNELLE D'UN CONFLIT CLÔTURÉ — Super Admin, motif
     * obligatoire. Il revient à sa région (s'il en avait une), sinon dans
     * « Les Conflits ». Rien de l'historique n'est effacé.
     */
    rouvrirConflit({ conflitId, session, motif, auditer = null, depotNotifications = null }) {
      relireSiModifie();
      const conf = trouverConflit(conflitId);
      if (conf && items.some((c) => c !== conf && c.paireCle === conf.paireCle && !estClos(c))) {
        throw new ErreurWorkflow(409, 'Un conflit actif existe déjà pour cette paire de barrages.');
      }
      const r = appliquer(conf, session, 'rouvrir', {
        motif,
        commentaire: `Réouverture par le Super Admin : ${String(motif ?? '').trim()}`,
        modifier: (c, { ts }) => {
          c.cycles = c.cycles ?? [];
          c.cycles.push({ cloreLe: ts, traitement: c.traitement ?? null, validation: c.validation ?? null, clotureLe: c.clotureLe ?? null, cloturePar: c.cloturePar ?? null });
          c.clotureLe = null;
          c.cloturePar = null;
          delete c.validation;
          c.assignation = { ...(c.assignation ?? {}), cie: null, responsable: null };
        },
      });
      auditer?.(conf, { date: r.ts, action: 'rouvrir', de: r.de, vers: r.vers, auteur: r.entree.auteur, motif: r.entree.motif });
      notifier(depotNotifications, session, conf, r.entree, {
        type: 'assignation',
        titre: 'Conflit rouvert',
        description: `Le Super Admin a rouvert le conflit ${numeroDe(conf)} : ${String(motif).trim()}`,
        destinataires: destRegions(conf),
      });
      return { ok: true, conflit: conf };
    },

    /**
     * DÉTECTION ET ACTUALISATION AUTOMATIQUE DES CONFLITS APRÈS OPÉRATION.
     */
    actualiserApresOperation({
      barrageId,
      session = null,
      action = 'operation',
      details = null,
      graphe = null,
      depotBarrages,
      depotInstructions,
      depotDemandes,
      depotNotifications,
      seuilKm = 40,
    }) {
      if (!barrageId) return [];
      const ts = new Date().toISOString();
      const auteur = session
        ? { matricule: session.matricule ?? null, nom: session.nom ?? null, rang: session.rang ?? null, unite: session.unite ?? null }
        : { matricule: 'systeme', nom: 'Système', rang: 'admin', unite: 'admin' };

      const cible = depotBarrages.parId(barrageId);
      const conflitsModifies = [];

      /* Si le barrage a été supprimé ou retiré du dispositif */
      if (!cible || !enService(cible)) {
        for (const c of items.filter((x) => x.barrageAId === barrageId || x.barrageBId === barrageId)) {
          if (resoudrePhysiquement(c, ts, auteur, `Barrage ${cible?.nom || barrageId} retiré du dispositif ou désactivé.`)) conflitsModifies.push(c);
        }
        if (conflitsModifies.length) ecrire();
        return conflitsModifies;
      }

      /* Analyser les conflits réels via le moteur existant */
      const rapport = analyserConflitsComplet({
        graphe,
        cible,
        barrages: depotBarrages.tous(),
        seuilKm,
      });

      const detectes = rapport.conflits || [];
      const pairesDetectees = new Set();

      /* 1. Mettre à jour ou créer les conflits détectés */
      for (const conf of detectes) {
        const autre = depotBarrages.parId(conf.barrageId);
        if (!autre) continue;

        const paireCle = cleDePaire(cible.id, autre.id);
        if (supprimes.includes(paireCle)) {
          continue;
        }
        pairesDetectees.add(paireCle);

        /* LA DÉTECTION NE DÉCIDE JAMAIS DE L'ÉTAT D'UN CONFLIT EXISTANT : elle
           met à jour ses mesures, et note une réapparition. Avant, le statut
           était RECALCULÉ ici à chaque opération à partir des instructions et
           des demandes ouvertes — un conflit assigné pouvait redevenir
           « nouveau », un conflit en traitement passer « résolu » : c'était la
           source des conflits perdus ou rangés dans la mauvaise section. */
        const existant = parPaireActive(paireCle);
        const routeCommune = conf.barrageRoute || cible.route || autre.route || rapport.routeDetectee || null;

        if (existant) {
          existant.barrageA = resumeBarrage(cible);
          existant.barrageB = resumeBarrage(autre);
          existant.route = routeCommune;
          existant.distanceKm = conf.distanceKm;
          existant.distanceRouteKm = conf.distanceRouteKm;
          existant.estDistanceRoute = conf.estDistanceRoute;
          existant.seuilKm = conf.seuilKm;
          existant.factionsCommunes = conf.factionsCommunes ?? [];
          existant.severite = conf.severite ?? 'alerte';
          existant.maj = ts;
          if (existant.resolutionPhysique) {
            /* Résolu physiquement puis réapparu : l'état ne bouge pas, c'est noté. */
            const etat = etatDe(existant);
            delete existant.resolutionPhysique;
            existant.statutPhysique = 'persistant';
            existant.historique = existant.historique ?? [];
            existant.historique.push({
              id: idHistorique(), date: ts, auteur, action: 'reapparition', de: etat, vers: etat, statut: STATUT_HERITE[etat],
              commentaire: `Conflit réapparu suite à l'opération « ${action} ». Distance mesurée : ${conf.distanceKm} km.`,
            });
            conflitsModifies.push(existant);
          }
        } else {
          /* NOUVEAU CONFLIT DÉTECTÉ : état NEW, dans « Les Conflits » du Super
             Admin — et de lui seul, tant qu'il n'est pas assigné. */
          const nouveau = {
            id: nouvelId(),
            paireCle,
            type: conf.type ?? 'distance_insuffisante',
            severite: conf.severite ?? 'alerte',
            barrageAId: cible.id,
            barrageBId: autre.id,
            barrageA: resumeBarrage(cible),
            barrageB: resumeBarrage(autre),
            route: routeCommune,
            factionsCommunes: conf.factionsCommunes ?? [],
            distanceKm: conf.distanceKm,
            distanceRouteKm: conf.distanceRouteKm,
            estDistanceRoute: conf.estDistanceRoute,
            seuilKm: conf.seuilKm,
            etat: ETATS.NEW,
            assignation: { regions: [], cie: null, responsable: null, assignePar: null, assigneLe: null },
            statut: STATUT_HERITE.NEW,
            cree: ts,
            maj: ts,
            resoluLe: null,
            historique: [
              {
                id: idHistorique(),
                date: ts,
                auteur,
                action: 'detection',
                de: null,
                vers: ETATS.NEW,
                statut: STATUT_HERITE.NEW,
                commentaire: `Conflit détecté le long de la route : espacement ${conf.distanceKm} km (seuil réglementaire ${conf.seuilKm} km).`,
              },
            ],
          };
          items.push(nouveau);
          conflitsModifies.push(nouveau);

          /* Notification au Super Admin (lui seul : le conflit n'est encore assigné à personne). */
          if (depotNotifications?.publierConflit) {
            depotNotifications.publierConflit({
              session,
              conf: nouveau,
              type: 'assignation',
              titre: 'Nouveau conflit détecté',
              description: `Conflit détecté : ${paireTexte(nouveau)} à ${nouveau.distanceKm} km (seuil ${nouveau.seuilKm} km)${nouveau.route ? ` sur ${nouveau.route}` : ''}. À assigner.`,
              destinataires: ADMINS,
              ts,
              cle: `${nouveau.id}:detection`,
            });
          }
        }
      }

      /* 2. Les conflits de ce poste qui ne sont plus détectés : résolus
         physiquement (voir resoudrePhysiquement — jamais une décision). */
      for (const c of items) {
        if ((c.barrageAId === cible.id || c.barrageBId === cible.id) && !pairesDetectees.has(c.paireCle)) {
          if (resoudrePhysiquement(c, ts, auteur, `Conflit résolu physiquement suite à l'opération « ${action} » : distance réglementaire ou factions conformes.`)) {
            conflitsModifies.push(c);
          }
        }
      }

      if (conflitsModifies.length) ecrire();
      return conflitsModifies;
    },
  };
}
