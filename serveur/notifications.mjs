/**
 * NOTIFICATIONS D'ÉVÉNEMENTS — ce qui vient de changer, et qui l'a lu.
 *
 * À NE PAS CONFONDRE AVEC `serveur/instructions.mjs`. Celui-là porte des
 * DOSSIERS : une proposition, une demande, une assignation, que quelqu'un doit
 * trancher et qui restent « à traiter » tant qu'il ne l'a pas fait. Ici, rien à
 * trancher : un barrage a été assigné, déplacé, a changé de faction ou de
 * statut, une opération a été validée — et chaque compte concerné doit le
 * SAVOIR. La seule chose à suivre est donc « lu / non lu », par personne.
 *
 * LA SOURCE EST LE JOURNAL, ET RIEN D'AUTRE. Toutes les écritures passent déjà
 * par `journal.consigner` (voir serveur/journal.mjs) ; l'API branche ce dépôt
 * derrière lui (`notificationDepuisJournal`). Une modification ne peut donc pas
 * échapper à la notification parce qu'un développeur aurait oublié de l'émettre
 * dans une route — et il n'existe pas de notification qui ne corresponde à une
 * ligne du journal.
 *
 * PAS DE DOUBLON POUR UNE SEULE OPÉRATION. Certains gestes écrivent plusieurs
 * lignes au journal dans la même requête (accepter une demande = appliquer le
 * changement + consigner la décision ; traiter une assignation = changer la
 * faction + clore l'assignation). Ces lignes arrivent à quelques millisecondes
 * d'intervalle, pour le même barrage et le même auteur : elles sont FUSIONNÉES
 * en une seule notification, qui prend le type le plus significatif (`RANG`)
 * et garde le détail des deux.
 *
 * LA LECTURE EST CLOISONNÉE comme la carte : voir `visiblePour`. Et on ne se
 * notifie pas soi-même — la trace de ses propres gestes est au journal.
 *
 * Même dispositif de stockage que les autres dépôts : un fichier JSON, écriture
 * atomique (tmp + rename), le serveur seule source de vérité.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { factionParId } from './factions.mjs';

/** Au-delà, les plus anciennes sont abandonnées : l'historique durable est le journal. */
const MAX_NOTIFICATIONS = 5000;

/** Deux lignes du journal plus proches que cela, même barrage, même auteur : une seule opération. */
const FENETRE_FUSION_MS = 1500;

/**
 * Les natures de notification, et leur titre. `rang` départage une fusion : la
 * notification garde le type de rang le plus élevé.
 */
export const TYPES_NOTIFICATION = {
  validation: { titre: 'Opération validée', rang: 9 },
  traitement: { titre: 'Assignation traitée', rang: 8 },
  assignation: { titre: 'Barrage assigné', rang: 7 },
  faction: { titre: 'Faction modifiée', rang: 6 },
  deplacement: { titre: 'Barrage déplacé', rang: 5 },
  statut: { titre: 'Statut modifié', rang: 4 },
  suppression: { titre: 'Barrage retiré', rang: 3 },
  creation: { titre: 'Nouveau barrage', rang: 2 },
  demande: { titre: 'Demande de validation', rang: 1 },
  modification: { titre: 'Fiche modifiée', rang: 0 },
};

const BARRAGES = new Set(['barrage_fixe', 'barrage_mobile', 'barrage_vip']);

const STATUTS = {
  en_attente: 'en attente',
  approuve: 'approuvé',
  a_modifier: 'à modifier',
  annule: 'annulé',
  supprime: 'supprimé',
  retire_optimisation: 'retiré par l’optimisation',
};
const libelleStatut = (s) => STATUTS[s] ?? s ?? '—';
const nomFaction = (id) => (id ? factionParId(id)?.nom ?? id : 'aucune');

const DECISIONS_WORKFLOW = {
  approuver: ['validation', 'Demande approuvée'],
  rejeter: ['validation', 'Demande rejetée'],
  retourner: ['validation', 'Demande retournée au CMND Cie'],
  retourner_region: ['validation', 'Demande renvoyée au CMND Région'],
  transmettre_admin: ['demande', 'Demande transmise au Super Admin'],
  modifier: ['demande', 'Proposition modifiée par la région'],
  soumettre: ['demande', 'Demande soumise'],
  resoumettre: ['demande', 'Demande soumise de nouveau'],
};

const bouge = (avant, apres) =>
  Boolean(avant && apres) && (avant.lng !== apres.lng || avant.lat !== apres.lat);
const differe = (avant, apres, champ) =>
  Boolean(avant && apres) && (avant[champ] ?? null) !== (apres[champ] ?? null);

/**
 * CE QU'UNE LIGNE DU JOURNAL ANNONCE — ou `null` si elle n'annonce rien.
 *
 * `avant` et `apres` sont les objets COMPLETS passés à `journal.consigner` : le
 * journal n'en garde qu'un extrait, où ni le statut ni la décision
 * d'optimisation ne figurent.
 *
 * Ne sont retenues que les écritures sur un BARRAGE et les décisions qui le
 * concernent. Connexions, simulations, restaurations de présentation, points
 * noirs : rien à notifier.
 *
 * `complement` : ce que l'événement ajoute quand il est FUSIONNÉ dans la
 * notification de la même opération — la clôture d'une assignation ne répète
 * pas le changement de faction qui vient d'être décrit.
 *
 * @returns {{type: string, description: string, complement?: string, destinataire?: object}|null}
 */
export function notificationDepuisJournal({ action, avant = null, apres = null, details = null }) {
  const b = apres ?? avant;
  if (!b || !BARRAGES.has(b.type)) return null;
  const nom = b.nom || b.id || 'ce barrage';

  switch (action) {
    case 'creer':
      return { type: 'creation', description: `${nom} a été posé${b.route ? ` sur ${b.route}` : ''}.` };
    case 'deplacer':
    case 'deplacement_optimisation':
      return { type: 'deplacement', description: `${nom} a changé de position.` };
    case 'supprimer':
      return { type: 'suppression', description: `${nom} a été retiré du dispositif.` };
    case 'changement_faction':
      return {
        type: 'faction',
        description: `${nom} : ${nomFaction(details?.ancienne)} → ${nomFaction(details?.nouvelle)}.`,
      };
    case 'assignation':
      return details?.cie
        ? {
            type: 'assignation',
            description: `${nom} a été assigné au CMND Cie ${details.cie}.`,
            destinataire: { rang: 'cie', unite: details.cie, matricule: details.matricule ?? null },
          }
        : {
            type: 'assignation',
            description: `${nom} a été assigné au CMND Région ${details?.region ?? b.reg ?? ''}${details?.consigne ? ` — ${details.consigne}` : ''}.`,
            destinataire: { rang: 'reg', unite: details?.region ?? b.reg ?? null },
          };
    case 'assignation_traitee':
      return {
        type: 'traitement',
        description: `${nom} : ${String(details?.reponse || 'traitement clôturé').replace(/\.$/, '')}.`,
        complement: 'L’assignation est clôturée.',
      };
    case 'demander-modification':
      return { type: 'demande', description: `Une modification de ${nom} attend validation.` };
    case 'demander-suppression':
      return { type: 'demande', description: `Le retrait de ${nom} attend validation.` };
    case 'creer-demande-approbation':
    case 'soumettre-demande-approbation':
      return { type: 'demande', description: `Une demande d’approbation a été soumise pour ${nom}.` };
    case 'decision-demande': {
      const acceptee = details?.decision === 'acceptee';
      return {
        type: 'validation',
        description: `${acceptee ? 'Acceptée' : 'Refusée'} : ${details?.objet ?? 'demande'} sur ${nom}.`,
        complement: `${acceptee ? 'Acceptée' : 'Refusée'} par l’administration.`,
      };
    }
    case 'application-demande-approuvee':
      return { type: 'validation', description: `Changement approuvé appliqué à ${nom}.` };
    case 'retirer-intouchable':
      return { type: 'modification', description: `${nom} n’est plus le barrage intouchable de sa compagnie.` };
    case 'modifier':
      if (bouge(avant, apres)) return { type: 'deplacement', description: `${nom} a changé de position.` };
      if (differe(avant, apres, 'factionId')) {
        return {
          type: 'faction',
          description: `${nom} : ${nomFaction(avant.factionId)} → ${nomFaction(apres.factionId)}.`,
        };
      }
      if (differe(avant, apres, 'statutBarrage')) {
        return {
          type: 'statut',
          description: `${nom} : ${libelleStatut(avant.statutBarrage)} → ${libelleStatut(apres.statutBarrage)}.`,
        };
      }
      return { type: 'modification', description: `La fiche de ${nom} a été modifiée.` };
    default: {
      const w = /^workflow-demande-(.+)$/.exec(action ?? '');
      if (w && DECISIONS_WORKFLOW[w[1]]) {
        const [type, titre] = DECISIONS_WORKFLOW[w[1]];
        return { type, description: `${titre} pour ${nom}${details?.commentaire ? ` — ${details.commentaire}` : ''}.` };
      }
      return null;
    }
  }
}

/** Le rattachement d'un barrage, tel qu'il compte pour le cloisonnement. */
const rattachement = (m) => (m ? { bt: m.bt ?? null, cie: m.cie ?? null, reg: m.reg ?? null } : null);

/**
 * CETTE SESSION VOIT-ELLE CETTE NOTIFICATION ?
 *
 *   — jamais la sienne : on ne se notifie pas de son propre geste ;
 *   — le Super Admin voit tout, comme sur la carte ;
 *   — les autres, ce qui touche un barrage de leur périmètre AVANT ou APRÈS
 *     l'opération (un poste déplacé hors de la brigade concerne encore la
 *     brigade qu'il quitte) ;
 *   — et ce qui leur est explicitement ADRESSÉ (un CMND Cie à qui sa région
 *     confie un barrage d'une autre compagnie), ou qui touche un barrage qui
 *     leur est assigné (`assigne`).
 *
 * `perimetre` : celui de `perimetreDuRang` (serveur/comptes.mjs) — la même
 * table que `dansSonUnite`, pour qu'il n'existe qu'une idée du périmètre.
 */
export function visiblePour(session, n, { perimetre = null, assigne = false } = {}) {
  if (!session || !n) return false;
  if (n.acteur?.matricule && n.acteur.matricule === session.matricule) return false;
  if (session.rang === 'admin') return true;
  /* Même rôle, même unité — et, pour une compagnie, même région quand elle
     est connue (deux régions peuvent avoir une compagnie du même nom). */
  const pourMoi = (x) => Boolean(x) && x.rang === session.rang && x.unite === session.unite && (!x.reg || !session.reg || x.reg === session.reg);
  if (pourMoi(n.destinataire)) return true;
  /* Notification adressée à plusieurs rôles (workflow des conflits). */
  if ((n.destinataires ?? []).some(pourMoi)) return true;
  if (assigne) return true;
  if (!perimetre) return false;
  return (n.perimetres ?? []).some((p) => p?.[perimetre.champ] === perimetre.unite);
}

const nouvelId = () => `not_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

export function creerDepotNotifications(fichier) {
  let items = [];
  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter((n) => n && typeof n.id === 'string');
    } catch (err) {
      throw new Error(`Dépôt des notifications illisible (${fichier}) : ${err.message}`);
    }
  }

  const ecrire = () => {
    mkdirSync(dirname(resolve(fichier)), { recursive: true });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    renameSync(tmp, fichier);
  };

  /** Appelés à chaque notification créée ou complétée — le flux temps réel. */
  const abonnes = new Set();
  const annoncer = (n) => {
    for (const f of abonnes) {
      try {
        f(n);
      } catch {
        /* un abonné défaillant ne doit pas empêcher les autres d'être prévenus */
      }
    }
  };

  return {
    tous: () => items,
    parId: (id) => items.find((n) => n.id === id) ?? null,

    /**
     * Publie l'événement d'une ligne du journal — ou le fusionne dans la
     * notification de la même opération (voir l'en-tête).
     *
     * @returns la notification créée ou complétée, `null` si rien à notifier.
     */
    publier({ session, action, avant = null, apres = null, details = null, ts = new Date().toISOString() }) {
      const evenement = notificationDepuisJournal({ action, avant, apres, details });
      if (!evenement) return null;
      const b = apres ?? avant;
      const acteur = {
        matricule: session?.matricule ?? null,
        nom: session?.nom ?? null,
        rang: session?.rang ?? null,
        unite: session?.unite ?? null,
      };
      const perimetres = [rattachement(avant), rattachement(apres)].filter(Boolean);

      const derniere = items[items.length - 1];
      if (
        derniere &&
        derniere.barrageId === b.id &&
        derniere.acteur?.matricule === acteur.matricule &&
        Math.abs(Date.parse(ts) - Date.parse(derniere.maj ?? derniere.cree)) <= FENETRE_FUSION_MS
      ) {
        const plusFort = TYPES_NOTIFICATION[evenement.type].rang > TYPES_NOTIFICATION[derniere.type].rang;
        const ajout = evenement.complement ?? evenement.description;
        const fusion = {
          ...derniere,
          type: plusFort ? evenement.type : derniere.type,
          titre: TYPES_NOTIFICATION[plusFort ? evenement.type : derniere.type].titre,
          description: derniere.description.includes(ajout)
            ? derniere.description
            : `${derniere.description} ${ajout}`,
          actions: [...new Set([...(derniere.actions ?? []), action])],
          destinataire: derniere.destinataire ?? evenement.destinataire ?? null,
          perimetres: [...derniere.perimetres, ...perimetres].filter(
            (p, i, t) => t.findIndex((q) => q.bt === p.bt && q.cie === p.cie && q.reg === p.reg) === i,
          ),
          barrage: { ...derniere.barrage, ...resumeBarrage(b) },
          maj: ts,
          /* Complétée après coup : elle redevient non lue pour qui l'aurait déjà ouverte. */
          lues: {},
        };
        items[items.length - 1] = fusion;
        ecrire();
        annoncer(fusion);
        return fusion;
      }

      const n = {
        id: nouvelId(),
        type: evenement.type,
        titre: TYPES_NOTIFICATION[evenement.type].titre,
        description: evenement.description,
        actions: [action],
        barrageId: b.id ?? null,
        barrage: resumeBarrage(b),
        acteur,
        destinataire: evenement.destinataire ?? null,
        perimetres: perimetres.filter(
          (p, i, t) => t.findIndex((q) => q.bt === p.bt && q.cie === p.cie && q.reg === p.reg) === i,
        ),
        cree: ts,
        maj: ts,
        /** matricule → date d'ouverture. */
        lues: {},
      };
      items.push(n);
      if (items.length > MAX_NOTIFICATIONS) items = items.slice(items.length - MAX_NOTIFICATIONS);
      ecrire();
      annoncer(n);
      return n;
    },

    /**
     * NOTIFICATION DU WORKFLOW DES CONFLITS — ADRESSÉE, JAMAIS DIFFUSÉE.
     *
     * `publier` décrit une opération sur un barrage et la montre à tout le
     * périmètre du poste. Une étape de validation, elle, ne concerne que le
     * rôle qui doit agir : aucun périmètre n'est posé (`perimetres: []`) et
     * `barrageId` reste nul, si bien que seuls les `destinataires` (et le
     * Superadmin, qui voit tout) la reçoivent — rien n'est divulgué aux
     * unités voisines. Le barrage A n'est joint que pour le contexte.
     *
     * `cle` : identifiant de l'événement (conflit, étape, destinataire) — une
     * notification déjà publiée sous cette clé n'est JAMAIS publiée deux fois
     * (requête rejouée, double clic, relance du serveur).
     *
     * @param {{ session: object, conf: object, type: string, titre: string,
     *   description: string, destinataires: Array<{rang: string, unite: string|null}>, ts?: string, cle?: string }} o
     */
    publierConflit({ session, conf, type, titre, description, destinataires = [], ts = new Date().toISOString(), cle = null }) {
      if (!destinataires.length) return null;
      if (cle) {
        const deja = items.find((x) => x.cle === cle);
        if (deja) return deja;
      }
      const n = {
        ...(cle ? { cle } : {}),
        id: nouvelId(),
        type: TYPES_NOTIFICATION[type] ? type : 'validation',
        titre,
        description,
        actions: ['conflit-workflow'],
        barrageId: null,
        barrage: conf?.barrageA ? resumeBarrage(conf.barrageA) : null,
        conflitId: conf?.id ?? null,
        details: { conflitId: conf?.id ?? null, conflitNumero: conf?.numero ?? conf?.id ?? null },
        acteur: {
          matricule: session?.matricule ?? null,
          nom: session?.nom ?? null,
          rang: session?.rang ?? null,
          unite: session?.unite ?? null,
        },
        destinataire: destinataires[0],
        destinataires,
        perimetres: [],
        cree: ts,
        maj: ts,
        lues: {},
      };
      items.push(n);
      if (items.length > MAX_NOTIFICATIONS) items = items.slice(items.length - MAX_NOTIFICATIONS);
      ecrire();
      annoncer(n);
      return n;
    },

    /** Ouverte par ce compte : lue pour lui, et pour lui seul. Idempotent. */
    marquerLue(id, matricule) {
      const i = items.findIndex((n) => n.id === id);
      if (i < 0 || !matricule) return null;
      if (items[i].lues?.[matricule]) return items[i];
      items[i] = { ...items[i], lues: { ...(items[i].lues ?? {}), [matricule]: new Date().toISOString() } };
      ecrire();
      return items[i];
    },

    estLue: (n, matricule) => Boolean(n?.lues?.[matricule]),

    abonner(f) {
      abonnes.add(f);
      return () => abonnes.delete(f);
    },
  };
}

/** La copie figée du barrage, pour que la notification reste lisible s'il disparaît. */
function resumeBarrage(b) {
  return {
    id: b.id ?? null,
    nom: b.nom || '',
    type: b.type ?? null,
    route: b.route || '',
    lng: b.lng ?? null,
    lat: b.lat ?? null,
    bt: b.bt ?? null,
    cie: b.cie ?? null,
    reg: b.reg ?? null,
    factionId: b.factionId ?? null,
    statutBarrage: b.statutBarrage ?? null,
  };
}

/** La forme envoyée au navigateur : `lue` pour CE compte, jamais la liste des lecteurs. */
export const presenterNotification = (n, matricule) => {
  const { lues, perimetres, ...reste } = n;
  return { ...reste, lue: Boolean(lues?.[matricule]), lueLe: lues?.[matricule] ?? null };
};
