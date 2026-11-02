import { usePresence } from '../../usePresence.js';
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import * as API from '../../api.js';
import {
  IconAlert,
  IconClose,
  IconSpinner,
  IconCoche,
  IconTerritoire,
  IconDistance,
  IconRoute,
  IconPoubelle,
} from '../../icons.jsx';
import { clePaire, canonicalRouteId } from '../../conflitsIdentifies.js';
import {
  obtenirDirectionBarrage,
  badgeDirection,
  libelleDirection,
  SENS_ALLER,
  SENS_RETOUR,
  SENS_TOUS,
} from '../../directionSens.js';
import ModalComparatifAvantApres from './ModalComparatifAvantApres.jsx';
import ModalConfirmationTraitement from './ModalConfirmationTraitement.jsx';
import HistoriqueConflits from './HistoriqueConflits.jsx';
import ValeurAnimee from '../ValeurAnimee.jsx';
import { notifier } from '../Toasts.jsx';

/** Durée du repli d'une carte qui quitte sa file — celle de `--duree-lente`. */
const DUREE_SORTIE_CARTE = 280;

/* Traité / assigné / non assigné : définitions partagées avec la carte, qui
   ne trace un conflit « après déplacement » que s'il est actif ici. */
import { estConflitTraite, estConflitAssigne, estConflitNonAssigne } from '../../etatConflits.js';

/**
 * PANNEAU LATÉRAL : GESTION DES CONFLITS (REFONTE SUPERADMIN & COMMANDEMENT)
 *
 * 3 Onglets principaux mutuellement exclusifs :
 *   1. Traités       : Tous les conflits traités (avec statut d'approbation).
 *   2. En attente    : Conflits assignés en attente de traitement.
 *   3. Les Conflits  : conflits détectés, pas encore assignés (Super Admin).
 */
export default function PanneauConflitsLateral({
  ouvert,
  onClose,
  onFermer,
  session,
  factions = null,
  conflitsIdentifies = null,
  conflitVise = null,
  conflitSelectionne = null,
  onVoirSurCarte,
  onAssigner,
  onDesassigner,
  onTraiter,
  onTransmettre,
  onConflitSupprime = null,
  filtreRoute = null,
  filtreSensRoute = SENS_TOUS,
  onChangerSensRoute = null,
  onFiltrerRoute = null,
  routesDisponibles = [],
  barragesVisiblesCount = null,
  barrages = [],
  graphe = null,
  version = 0,
  onOuvrirFiltreRoute = null,
  conflitsCalculesRoute = null,
  parametresRoute = null,
  onEffacerFiltreRoute = null,
  onBarragesModifies = null,
}) {
  const fermer = onClose || onFermer;
  const conflitActuel = conflitVise || conflitSelectionne;

  const [dbConflits, setDbConflits] = useState([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [detailsOuverts, setDetailsOuverts] = useState({});
  const [ongletActif, setOngletActif] = useState('non_assignes'); // 'non_assignes' | 'en_attente' | 'a_valider' | 'suivi' | 'historique'
  const [actionEnCours, setActionEnCours] = useState(null);
  const [conflitEnConfirmation, setConflitEnConfirmation] = useState(null);
  const [conflitAgrandir, setConflitAgrandir] = useState(null);
  const [conflitASupprimer, setConflitASupprimer] = useState(null);
  const [conflitsASupprimerGroupe, setConflitsASupprimerGroupe] = useState(null);
  const [selectionIds, setSelectionIds] = useState(() => new Set());
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreurSuppression, setErreurSuppression] = useState(null);
  const [conflitsSupprimesLocaux, setConflitsSupprimesLocaux] = useState(() => new Set());
  const [assignationEnMasseEnCours, setAssignationEnMasseEnCours] = useState(false);
  /* WORKFLOW HIÉRARCHIQUE — paires closes (elles sont à l'historique et ne
     reviennent pas comme « nouveaux » conflits quand l'optimisation les
     redétecte), compteurs des files tenus par le serveur, refus en saisie. */
  const [pairesCloses, setPairesCloses] = useState(() => new Set());
  const [compteursServeur, setCompteursServeur] = useState(null);
  const [refus, setRefus] = useState(null); // { id, texte }
  const [erreurAction, setErreurAction] = useState(null); // { id, message }
  const cardRefs = useRef({});
  /* Gardé monté le temps de sa sortie (voir usePresence). */
  const presence = usePresence(ouvert);

  // Basculer automatiquement sur l'onglet 'non_assignes' lorsqu'un calcul d'espacement par route est effectué
  // et restaurer les conflits calculés dans conflitsSupprimesLocaux pour qu'ils réapparaissent immédiatement
  useEffect(() => {
    if (conflitsCalculesRoute && conflitsCalculesRoute.length > 0) {
      setConflitsSupprimesLocaux((prev) => {
        const next = new Set(prev);
        let modifie = false;
        for (const cc of conflitsCalculesRoute) {
          const aId = cc.barrageAId || cc.a?.id;
          const bId = cc.barrageBId || cc.b?.id;
          const paire = cc.paireCle || (aId && bId ? clePaire(aId, bId) : null);
          if (paire && next.has(paire)) {
            next.delete(paire);
            modifie = true;
          }
          if (cc.id && next.has(cc.id)) {
            next.delete(cc.id);
            modifie = true;
          }
        }
        return modifie ? next : prev;
      });
    }
  }, [conflitsCalculesRoute]);

  const rang = session?.rang;
  const estAdmin = rang === 'admin';
  /* Suppression : décidée par le serveur (Super Admin, jamais un traitement soumis ou finalisé). */
  const peutSupprimer = (conf) => (conf?.workflow ? conf.workflow.actions?.supprimer === true : estAdmin);
  const estRegion = rang === 'reg';
  const estCie = rang === 'cie';

  /* Seul le PREMIER chargement montre un état de chargement : les relectures
     suivantes (après une décision, une notification) mettent à jour en place,
     sans faire disparaître la liste. */
  const dejaCharge = useRef(false);
  const recharger = useCallback(() => {
    if (!dejaCharge.current) setCharge(false);
    API.listerConflits()
      .then((res) => {
        setDbConflits(res?.items ?? []);
        setPairesCloses(new Set((res?.clos ?? []).map((c) => c.paireCle).filter(Boolean)));
        setCompteursServeur(res?.compteurs ?? null);
        if (Array.isArray(res?.supprimes)) {
          setConflitsSupprimesLocaux((prev) => {
            const next = new Set(prev);
            res.supprimes.forEach((s) => {
              if (s && !/^C-\d+$/i.test(String(s).trim())) {
                next.add(s);
              }
            });
            return next;
          });
        }
        setErreur(null);
      })
      .catch((err) => {
        setErreur(err?.message ?? 'Impossible de charger la liste des conflits.');
      })
      .finally(() => {
        dejaCharge.current = true;
        setCharge(true);
      });
  }, []);

  useEffect(() => {
    if (session) {
      recharger();
    }
  }, [session, version, recharger]);

  /**
   * FUSION ET DÉDUPLICATION STRICTE DES CONFLITS.
   */
  const tousConflitsCombines = useMemo(() => {
    const mapParPaire = new Map();

    const estIdentifiantRelatif = (val) => !val || /^C-\d+$/i.test(String(val).trim());

    const estSupprime = (cle, id) => {
      if (cle) {
        const p1 = String(cle).trim();
        if (conflitsSupprimesLocaux.has(p1)) return true;
        if (p1.includes('|')) {
          const parties = p1.split('|');
          if (parties.length === 2 && conflitsSupprimesLocaux.has(clePaire(parties[0], parties[1]))) {
            return true;
          }
        }
      }
      if (id && !estIdentifiantRelatif(id)) {
        const idTrim = String(id).trim();
        if (conflitsSupprimesLocaux.has(idTrim)) return true;
      }
      return false;
    };

    // 1. D'abord les conflits persistés en base de données
    for (const c of dbConflits) {
      const aId = c.barrageAId || c.barrageA?.id;
      const bId = c.barrageBId || c.barrageB?.id;
      if (!aId || !bId) continue;
      const paire = c.paireCle || clePaire(aId, bId);
      if (estSupprime(paire, c.id)) continue;
      mapParPaire.set(paire, {
        ...c,
        id: c.id,
        numero: c.numero || c.id,
        paireCle: paire,
        barrageAId: aId,
        barrageBId: bId,
        a: c.barrageA || { id: aId },
        b: c.barrageB || { id: bId },
        route: c.route || c.barrageA?.route || c.barrageB?.route || '',
        statut: c.statut || 'nouveau',
        distanceKm: Number(c.distanceKm ?? c.km ?? 0),
        seuilKm: Number(c.seuilKm ?? 20),
        estAssigne: Boolean(c.assigneA || c.assigneCie || c.statut === 'a_traiter' || c.statut === 'en_cours'),
      });
    }

    // 2. Fusionner avec les conflits détectés en direct sur la carte
    if (Array.isArray(conflitsIdentifies)) {
      for (const ci of conflitsIdentifies) {
        const aId = ci.barrageAId || ci.a?.id || ci.barrageA?.id;
        const bId = ci.barrageBId || ci.b?.id || ci.barrageB?.id;
        if (!aId || !bId) continue;
        const paire = ci.cle || ci.paireCle || clePaire(aId, bId);
        if (estSupprime(paire, ci.id)) continue;
        /* Clos et sans conflit actif ouvert depuis : il est à l'historique. */
        if (pairesCloses.has(paire) && !mapParPaire.has(paire)) continue;
        const existant = mapParPaire.get(paire);

        const aObj = ci.a || ci.barrageA || (Array.isArray(barrages) ? barrages.find((x) => x.id === aId) : null) || { id: aId };
        const bObj = ci.b || ci.barrageB || (Array.isArray(barrages) ? barrages.find((x) => x.id === bId) : null) || { id: bId };

        if (existant) {
          const dejaTraite = estConflitTraite(existant);
          if (ci.route && !existant.route) existant.route = ci.route;
          if (ci.distanceKm && !existant.distanceKm) existant.distanceKm = ci.distanceKm;
          if (ci.motif && !existant.motif) existant.motif = ci.motif;
          if (ci.trace && !existant.trace) existant.trace = ci.trace;
          if (ci.tempsMinutes && !existant.tempsMinutes) existant.tempsMinutes = ci.tempsMinutes;
          if (aObj && (!existant.a || !existant.a.nom)) existant.a = aObj;
          if (bObj && (!existant.b || !existant.b.nom)) existant.b = bObj;
          if (dejaTraite) {
            existant.statut = existant.statut || 'traite';
          }
        } else {
          // Conflit détecté non encore persisté
          mapParPaire.set(paire, {
            id: ci.id || `conf_${paire}`,
            numero: ci.id || ci.numero || `C-${mapParPaire.size + 1}`,
            paireCle: paire,
            barrageAId: aId,
            barrageBId: bId,
            a: aObj,
            b: bObj,
            route: ci.route || aObj?.route || bObj?.route || '',
            factionsCommunes: ci.factionsCommunes || ci.factions || (ci.factionId ? [ci.factionId] : []),
            distanceKm: Number(ci.distanceKm ?? ci.km ?? 0),
            seuilKm: Number(ci.seuilKm ?? 20),
            tempsMinutes: ci.tempsMinutes ?? null,
            motif: ci.motif || `Espacement de ${Number(ci.distanceKm ?? ci.km ?? 0).toFixed(1)} km inférieur au seuil réglementaire`,
            statut: 'nouveau',
            estAssigne: false,
            historique: [],
          });
        }
      }
    }

    // 3. Fusionner avec les conflits calculés spécifiquement sur la route sélectionnée
    if (Array.isArray(conflitsCalculesRoute)) {
      for (const cc of conflitsCalculesRoute) {
        const aId = cc.barrageAId || cc.a?.id;
        const bId = cc.barrageBId || cc.b?.id;
        if (!aId || !bId) continue;
        const paire = cc.paireCle || clePaire(aId, bId);
        // Les conflits explicitement calculés par l'utilisateur ne sont pas bloqués par les anciennes suppressions
        const existant = mapParPaire.get(paire);

        const bAObj = (barrages || []).find((x) => x.id === aId) || cc.a || cc.barrageA || { id: aId };
        const bBObj = (barrages || []).find((x) => x.id === bId) || cc.b || cc.barrageB || { id: bId };

        if (existant) {
          if (cc.route) existant.route = cc.route;
          if (cc.distanceKm != null) existant.distanceKm = cc.distanceKm;
          if (cc.seuilKm != null) existant.seuilKm = cc.seuilKm;
          if (cc.motif) existant.motif = cc.motif;
          if (cc.trace) existant.trace = cc.trace;
          if (cc.tempsMinutes != null) existant.tempsMinutes = cc.tempsMinutes;
          if (!existant.a || !existant.a.nom) existant.a = bAObj;
          if (!existant.b || !existant.b.nom) existant.b = bBObj;
        } else {
          mapParPaire.set(paire, {
            id: cc.id || `conf_calc_${paire}`,
            numero: cc.numero || `C-R${mapParPaire.size + 1}`,
            paireCle: paire,
            barrageAId: aId,
            barrageBId: bId,
            a: bAObj,
            b: bBObj,
            route: cc.route || bAObj.route || bBObj.route || '',
            factionsCommunes: cc.factionsCommunes || (cc.factionId ? [cc.factionId] : []),
            distanceKm: Number(cc.distanceKm ?? cc.km ?? 0),
            seuilKm: Number(cc.seuilKm ?? 20),
            tempsMinutes: cc.tempsMinutes ?? null,
            trace: cc.trace ?? null,
            motif: cc.motif || `Espacement de ${Number(cc.distanceKm ?? cc.km ?? 0).toFixed(1)} km inférieur au seuil`,
            statut: cc.statut || 'nouveau',
            estAssigne: false,
            historique: [],
          });
        }
      }
    }

    return Array.from(mapParPaire.values());
  }, [dbConflits, conflitsIdentifies, conflitsCalculesRoute, barrages, conflitsSupprimesLocaux, pairesCloses]);

  /* Numérotation simple et stable : Conflit 1, Conflit 2... */
  const indexConflitMap = useMemo(() => {
    const m = new Map();
    tousConflitsCombines.forEach((c, idx) => {
      const num = idx + 1;
      if (c.id) m.set(c.id, num);
      if (c.numero) m.set(c.numero, num);
      if (c.paireCle) m.set(c.paireCle, num);
    });
    return m;
  }, [tousConflitsCombines]);

  /* Région concernée claire */
  const getRegionConflit = useCallback((conf) => {
    const bA = conf.a || conf.barrageA;
    const bB = conf.b || conf.barrageB;
    const regA = bA?.reg;
    const regB = bB?.reg;
    if (regA && regB) {
      return regA === regB ? `Région ${regA}` : `Région ${regA} / ${regB}`;
    }
    const reg = regA || regB || conf.workflow?.regions?.[0] || conf.workflow?.region;
    return reg ? `Région ${reg}` : 'Région non définie';
  }, []);

  /* Statut simple parmi les 3 demandés : À traiter | En cours | Traité */
  const getStatutSimple = useCallback((conf) => {
    const etat = conf.workflow?.etat;
    if (
      etat === 'APPROVED' ||
      etat === 'FOLLOW_UP' ||
      etat === 'CLOSED' ||
      conf.statut === 'resolu' ||
      conf.statut === 'traite' ||
      conf.statut === 'cloture'
    ) {
      return {
        label: 'Traité',
        code: 'traite',
        badgeClasse: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    }
    if (
      etat === 'IN_PROGRESS_REGION' ||
      etat === 'IN_PROGRESS_CIE' ||
      etat === 'PENDING_VALIDATION' ||
      conf.statut === 'en_cours'
    ) {
      return {
        label: 'En cours',
        code: 'en_cours',
        badgeClasse: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      };
    }
    return {
      label: 'À traiter',
      code: 'a_traiter',
      badgeClasse: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    };
  }, []);

  /* Prise en charge préalable transparente puis ouverture du traitement */
  const handlePrendreEnChargeEtTraiter = useCallback(
    async (conf) => {
      try {
        if (conf.workflow?.actions?.prendre_en_charge) {
          await API.actionConflit(conf.id, 'prendre_en_charge', { etatAttendu: conf.workflow?.etat ?? null });
        } else if (conf.workflow?.actions?.commencer) {
          await API.actionConflit(conf.id, 'commencer', { etatAttendu: conf.workflow?.etat ?? null });
        }
      } catch (err) {
        console.warn('Action préalable :', err?.message);
      }
      fermer?.();
      onTraiter?.(conf);
    },
    [fermer, onTraiter]
  );

  // FILTRAGE PAR AXE ROUTIER LORSQU'UN FILTRE DE ROUTE EST ACTIF
  const canRouteFiltre = useMemo(() => {
    const r = filtreRoute || parametresRoute?.route;
    return r ? canonicalRouteId(r) : null;
  }, [filtreRoute, parametresRoute?.route]);

  const sensActif = (parametresRoute?.sens || filtreSensRoute || SENS_TOUS).toLowerCase();

  const conflitAppartientAAxe = useCallback((c) => {
    if (!canRouteFiltre) return true;
    const canC = canonicalRouteId(c.route || c.barrageA?.route || c.barrageB?.route || c.a?.route || c.b?.route);
    const canA = canonicalRouteId(c.a?.route || c.barrageA?.route);
    const canB = canonicalRouteId(c.b?.route || c.barrageB?.route);
    const appartientRoute =
      (canC && canC === canRouteFiltre) ||
      (canA && canA === canRouteFiltre) ||
      (canB && canB === canRouteFiltre) ||
      (c.id && String(c.id).startsWith('conf_calc_'));

    if (!appartientRoute) return false;

    // Si filtrage spécifique sur le sens Aller ou Retour
    if (sensActif && sensActif !== SENS_TOUS) {
      const bA = c.a || c.barrageA;
      const bB = c.b || c.barrageB;
      const dirA = (bA?.direction || obtenirDirectionBarrage(bA))?.toLowerCase?.();
      const dirB = (bB?.direction || obtenirDirectionBarrage(bB))?.toLowerCase?.();
      return dirA === sensActif || dirB === sensActif;
    }

    return true;
  }, [canRouteFiltre, sensActif]);

  const conflitsFiltres = useMemo(() => {
    if (!canRouteFiltre) return tousConflitsCombines;
    return tousConflitsCombines.filter((c) => conflitAppartientAAxe(c));
  }, [tousConflitsCombines, canRouteFiltre, conflitAppartientAAxe]);

  /*
   * CLASSIFICATION — LA SECTION VIENT DU SERVEUR (workflow.section), une et
   * une seule par conflit :
   *
   *   Les Conflits : NEW — détectés, pas encore assignés (Super Admin) ;
   *   À traiter    : assignés à une région ou une compagnie, en traitement,
   *                  ou rejetés pour correction (motif affiché) ;
   *   À valider    : traitements soumis, en attente du Super Admin ;
   *   Suivi        : validés, en suivi jusqu'à la clôture ;
   *   Historique   : clôturés (onglet dédié, lu à part).
   *
   * Un conflit seulement CALCULÉ (filtration, analyse d'un axe — pas encore
   * enregistré) n'a pas de section : il est « Les Conflits » pour le Super
   * Admin, qui seul peut l'assigner ; les autres rôles ne voient que ce qui
   * leur est assigné.
   */
  const sectionDe = (c) => c.workflow?.section ?? (estAdmin ? 'conflits' : null);
  const estRenvoye = (c) => c.workflow?.etat === 'REJECTED';

  /* FILTRES : recherche, région, compagnie, état, période. */
  const [filtres, setFiltres] = useState({ texte: '', region: '', compagnie: '', etat: '', du: '', au: '' });
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const filtresActifs = Object.values(filtres).some(Boolean);
  const normF = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const posteDe = (c) => [c.barrageA ?? c.a, c.barrageB ?? c.b];
  const passeFiltres = useCallback((c) => {
    const postes = posteDe(c);
    if (filtres.texte) {
      const q = normF(filtres.texte);
      const champs = [c.numero, c.id, c.route, ...postes.map((p) => p?.nom), ...postes.map((p) => p?.id)];
      if (!champs.some((x) => normF(x).includes(q))) return false;
    }
    if (filtres.region && !postes.some((p) => normF(p?.reg) === normF(filtres.region)) && !(c.workflow?.regions ?? []).some((r) => normF(r) === normF(filtres.region))) return false;
    if (filtres.compagnie && !postes.some((p) => normF(p?.cie) === normF(filtres.compagnie)) && normF(c.workflow?.compagnie) !== normF(filtres.compagnie)) return false;
    if (filtres.etat && (c.workflow?.etat ?? 'NEW') !== filtres.etat) return false;
    const t = Date.parse(c.maj ?? c.cree ?? '') || 0;
    if (filtres.du && t < Date.parse(filtres.du)) return false;
    if (filtres.au && t > Date.parse(filtres.au) + 86_399_999) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtres]);
  const optionsFiltres = useMemo(() => {
    const regions = new Set();
    const cies = new Set();
    for (const c of tousConflitsCombines) {
      for (const p of posteDe(c)) {
        if (p?.reg) regions.add(p.reg);
        if (p?.cie) cies.add(p.cie);
      }
    }
    const tri = (s) => [...s].sort((a, b) => a.localeCompare(b, 'fr'));
    return { regions: tri(regions), cies: tri(cies) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tousConflitsCombines]);
  const visibles = useMemo(() => conflitsFiltres.filter(passeFiltres), [conflitsFiltres, passeFiltres]);

  const conflitsSuivi = useMemo(() => visibles.filter((c) => sectionDe(c) === 'suivi'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflitsAValider = useMemo(() => visibles.filter((c) => sectionDe(c) === 'a_valider'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflitsEnAttente = useMemo(() => visibles.filter((c) => sectionDe(c) === 'a_traiter'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflitsNonAssignes = useMemo(() => visibles.filter((c) => sectionDe(c) === 'conflits'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalSuivi = conflitsSuivi.length;
  const totalAValider = conflitsAValider.length;
  const totalEnAttente = conflitsEnAttente.length;
  const totalNonAssignes = conflitsNonAssignes.length;
  const totalHistorique = compteursServeur?.historique ?? 0;

  // Défilement fluide vers le conflit visé sans changer intempestivement d'onglet
  const conflitViseIdRef = useRef(null);
  useEffect(() => {
    if (conflitActuel) {
      const id = conflitActuel.id || conflitActuel.numero || (typeof conflitActuel === 'string' ? conflitActuel : null);
      if (id && conflitViseIdRef.current !== id) {
        conflitViseIdRef.current = id;
        const conf = tousConflitsCombines.find((x) => x.id === id || x.numero === id);
        if (conf) {
          const section = sectionDe(conf);
          if (section === 'a_valider') setOngletActif('a_valider');
          else if (section === 'suivi') setOngletActif('suivi');
          else if (section === 'a_traiter') setOngletActif('en_attente');
          else if (section === 'conflits') setOngletActif('non_assignes');
        }
      }
      if (id) {
        const el = cardRefs.current[id];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, [conflitActuel]);

  const conflitsOngletActif = useMemo(() => {
    if (ongletActif === 'non_assignes') return conflitsNonAssignes;
    if (ongletActif === 'en_attente') return conflitsEnAttente;
    if (ongletActif === 'a_valider') return conflitsAValider;
    if (ongletActif === 'suivi') return conflitsSuivi;
    return [];
  }, [ongletActif, conflitsNonAssignes, conflitsEnAttente, conflitsAValider, conflitsSuivi]);

  const selectionIdsDansOnglet = useMemo(() => {
    const ids = new Set();
    for (const c of conflitsOngletActif) {
      const cle = c.id || c.numero;
      if (selectionIds.has(cle) || (c.paireCle && selectionIds.has(c.paireCle))) {
        ids.add(cle);
      }
    }
    return ids;
  }, [conflitsOngletActif, selectionIds]);

  const tousSelectionnes = conflitsOngletActif.length > 0 && selectionIdsDansOnglet.size === conflitsOngletActif.length;

  const toggleSelection = (conf) => {
    const cle = conf.id || conf.numero;
    setSelectionIds((prev) => {
      const next = new Set(prev);
      const clePaire = conf.paireCle;
      if (next.has(cle) || (clePaire && next.has(clePaire))) {
        next.delete(cle);
        if (clePaire) next.delete(clePaire);
      } else {
        next.add(cle);
      }
      return next;
    });
  };

  const toggleSelectionnerTout = () => {
    if (tousSelectionnes) {
      setSelectionIds((prev) => {
        const next = new Set(prev);
        conflitsOngletActif.forEach((c) => {
          next.delete(c.id || c.numero);
          if (c.paireCle) next.delete(c.paireCle);
        });
        return next;
      });
    } else {
      setSelectionIds((prev) => {
        const next = new Set(prev);
        conflitsOngletActif.forEach((c) => {
          next.add(c.id || c.numero);
        });
        return next;
      });
    }
  };

  const deselectionnerTout = () => {
    setSelectionIds(new Set());
  };

  const toggleDetails = (id, e) => {
    e?.stopPropagation?.();
    setDetailsOuverts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleVoirSurCarte = (conf, e, mode = 'comparer') => {
    e?.stopPropagation?.();
    onVoirSurCarte?.(conf, mode);
    fermer?.();
  };

  const handleDesassigner = async (conf, e) => {
    e?.stopPropagation?.();
    if (onDesassigner) {
      await onDesassigner(conf);
      recharger();
      return;
    }
    try {
      await API.desassignerConflit(conf.id);
      recharger();
    } catch (err) {
      alert(err.message || 'Impossible de désassigner le conflit.');
    }
  };

  /**
   * Superadmin : Décider sur un traitement (Approuver / Rejeter)
   */
  /*
   * SORTIE DE FILE — la carte se replie (fondu + hauteur, voir
   * `.gr-repliable`), PUIS la liste est mise à jour avec le conflit que le
   * serveur vient de renvoyer (un conflit clos quitte les listes actives), et
   * une relecture silencieuse resynchronise les compteurs. La base est déjà
   * écrite quand cela commence.
   */
  const [sortants, setSortants] = useState(() => new Set());
  const quitterLaFile = (id, conflitServeur) => {
    setSortants((s) => new Set(s).add(id));
    setTimeout(() => {
      setDbConflits((liste) =>
        liste
          .map((c) => (c.id === id && conflitServeur ? conflitServeur : c))
          .filter((c) => c.statut !== 'cloture'),
      );
      setSortants((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      recharger();
    }, DUREE_SORTIE_CARTE);
  };
  const envelopper = (conf, carte) => (
    <div key={conf.id || conf.numero} className="gr-repliable" data-ouvert={sortants.has(conf.id) ? 'false' : 'true'}>
      <div>{carte}</div>
    </div>
  );

  /*
   * DÉCIDER — approuver tout de suite ; refuser ouvre un formulaire dans la
   * carte, motif obligatoire. L'état affiché est envoyé (`etatAttendu`) : si
   * un autre validateur est passé entre-temps, le serveur refuse (409) et la
   * liste est relue au lieu d'appliquer la décision à un état non vu.
   */
  const handleDecider = async (conf, decision, e, raison = '') => {
    e?.stopPropagation?.();
    if (actionEnCours) return;
    if (decision === 'rejeter' && !raison.trim()) {
      setRefus({ id: conf.id, texte: '' });
      setErreurAction(null);
      return;
    }
    setActionEnCours(conf.id);
    setErreurAction(null);
    try {
      /* L'écriture d'abord : aucune animation ne précède ni ne retarde la
         réponse du serveur. */
      const r = await API.deciderConflit(conf.id, { decision, raison: raison.trim(), etatAttendu: conf.workflow?.etat ?? null });
      setRefus(null);
      const vers = r?.conflit?.workflow?.etat;
      notifier({
        type: decision === 'rejeter' ? 'info' : 'succes',
        titre: vers === 'FOLLOW_UP' ? 'Traitement validé' : 'Traitement rejeté',
        message: vers === 'FOLLOW_UP'
          ? `${conf.numero || conf.id} passe en suivi.`
          : `${conf.numero || conf.id} retourne à son responsable, avec votre motif.`,
      });
      if (Array.isArray(r?.barragesModifies) && r.barragesModifies.length > 0) {
        window.dispatchEvent(new CustomEvent('gr-recharger-barrages', { detail: r.barragesModifies }));
        onBarragesModifies?.(r.barragesModifies);
      }
      quitterLaFile(conf.id, r?.conflit ?? null);
    } catch (err) {
      const message = err?.message || 'La décision n’a pas pu être enregistrée.';
      setErreurAction({ id: conf.id, message });
      notifier({ type: 'erreur', titre: 'Décision non enregistrée', message });
      if (err?.statut === 409 || err?.status === 409) recharger();
    } finally {
      setActionEnCours(null);
    }
  };

  /**
   * ACTIONS SIMPLES DU WORKFLOW — prendre en charge (CMD Région), commencer
   * (CMD CIE), clôturer (Super Admin). L'écriture d'abord ; l'état attendu
   * est envoyé : si le conflit a changé entre-temps, le serveur refuse (409)
   * et la liste est relue.
   */
  const handleAction = async (conf, action, e) => {
    e?.stopPropagation?.();
    if (actionEnCours) return;
    setActionEnCours(conf.id);
    setErreurAction(null);
    try {
      const r = await API.actionConflit(conf.id, action, { etatAttendu: conf.workflow?.etat ?? null });
      const titres = {
        prendre_en_charge: ['Pris en charge', `${conf.numero || conf.id} : vous traitez ce conflit.`],
        commencer: ['Traitement commencé', `${conf.numero || conf.id} : renseignez le traitement puis soumettez-le.`],
        cloturer: ['Conflit clôturé', `${conf.numero || conf.id} est archivé dans l’historique.`],
      }[action] ?? ['Action enregistrée', ''];
      notifier({ type: 'succes', titre: titres[0], message: titres[1] });
      quitterLaFile(conf.id, r?.conflit ?? null);
    } catch (err) {
      const message = err?.message || 'L’action n’a pas pu être enregistrée.';
      setErreurAction({ id: conf.id, message });
      notifier({ type: 'erreur', titre: 'Action non enregistrée', message });
      if (err?.statut === 409 || err?.status === 409) recharger();
    } finally {
      setActionEnCours(null);
    }
  };

  const handleAssignerTout = async (e) => {
    e?.stopPropagation?.();
    if (!estAdmin || conflitsNonAssignes.length === 0 || assignationEnMasseEnCours) return;

    const nb = conflitsNonAssignes.length;
    if (!window.confirm(`Voulez-vous assigner automatiquement tous les ${nb} conflit(s) non assignés aux Commandants de Région concernés ?`)) {
      return;
    }

    setAssignationEnMasseEnCours(true);
    try {
      let reussis = 0;
      for (const conf of conflitsNonAssignes) {
        const bA = conf.a || conf.barrageA;
        const bB = conf.b || conf.barrageB;
        const estPosteIntou = (b) =>
          Boolean(
            b &&
            (b.protection === 'intouchable' ||
              b.protection === 'vip' ||
              b.type === 'barrage_vip' ||
              b.intouchable === true ||
              String(b.id || '').startsWith('BFI-'))
          );
        const intA = estPosteIntou(bA);
        const intB = estPosteIntou(bB);
        const regA = bA?.reg || 'Centre';
        const regB = bB?.reg || 'Centre';
        let regions = [];
        if (intA && !intB) {
          // BFI vs BF : Le BFI est intouchable, assigner exclusivement au CMD Région du BF (regB)
          regions = [regB];
        } else if (intB && !intA) {
          // BF vs BFI : Le BFI est intouchable, assigner exclusivement au CMD Région du BF (regA)
          regions = [regA];
        } else {
          regions = Array.from(new Set([regA, regB].filter(Boolean)));
        }

        try {
          await API.assignerConflit(conf.id, {
            matricule: regions[0],
            matricules: regions,
            consigne: `Assignation automatique pour traitement : conflit sur ${conf.route || 'axe commun'} (${Number(conf.distanceKm || conf.km || 0).toFixed(1)} km).`,
            conflitData: {
              ...conf,
              id: conf.id,
              numero: conf.numero || conf.id,
              barrageAId: conf.barrageAId || bA?.id,
              barrageBId: conf.barrageBId || bB?.id,
              a: bA,
              b: bB,
              distanceKm: Number(conf.distanceKm || conf.km || 0),
              seuilKm: conf.seuilKm ?? 20,
              route: conf.route || bA?.route || bB?.route,
              motif: conf.motif,
              regA,
              regB,
            },
          });
          reussis++;
        } catch (err) {
          console.warn(`Échec assignation ${conf.id}:`, err.message);
        }
      }
      recharger();
      alert(`✓ ${reussis} conflit(s) assigné(s) avec succès aux régions concernées.`);
    } catch (err) {
      alert(err.message || 'Erreur lors de l’assignation groupée.');
    } finally {
      setAssignationEnMasseEnCours(false);
    }
  };

  /**
   * SUPPRESSION MANUELLE DU CONFLIT SÉLECTIONNÉ (CONFIRMATION REQUISE).
   * Supprime exclusivement le conflit ciblé et l'exclut localement et en base.
   */
  const handleConfirmerSuppression = async () => {
    if (!conflitASupprimer) return;
    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      const bAId = conflitASupprimer.barrageAId || conflitASupprimer.a?.id;
      const bBId = conflitASupprimer.barrageBId || conflitASupprimer.b?.id;
      const paire =
        conflitASupprimer.paireCle ||
        clePaire(bAId, bBId);
      const id = conflitASupprimer.id || conflitASupprimer.numero;
      const cible = (paire && (!id || /^C-\d+$/i.test(String(id).trim()))) ? paire : (id || paire);

      await API.supprimerConflit(cible, {
        paireCle: paire,
        barrageAId: bAId,
        barrageBId: bBId,
      });

      setConflitsSupprimesLocaux((prev) => {
        const next = new Set(prev);
        if (paire) next.add(paire);
        if (id && !/^C-\d+$/i.test(String(id).trim())) next.add(id);
        if (conflitASupprimer.id && !/^C-\d+$/i.test(String(conflitASupprimer.id).trim())) {
          next.add(conflitASupprimer.id);
        }
        return next;
      });

      setDbConflits((prev) =>
        prev.filter(
          (c) =>
            c.id !== id &&
            c.id !== conflitASupprimer.id &&
            c.paireCle !== paire
        )
      );

      if (typeof onConflitSupprime === 'function') {
        onConflitSupprime(conflitASupprimer);
      }

      setConflitASupprimer(null);
      recharger();
    } catch (err) {
      setErreurSuppression(err?.message ?? 'Échec de la suppression du conflit.');
    } finally {
      setSuppressionEnCours(false);
    }
  };

  const handleConfirmerSuppressionGroupe = async () => {
    if (!conflitsASupprimerGroupe || conflitsASupprimerGroupe.length === 0) return;
    setSuppressionEnCours(true);
    setErreurSuppression(null);
    try {
      const ids = conflitsASupprimerGroupe.map((c) => c.id || c.numero || c.paireCle).filter(Boolean);
      await API.supprimerConflitsGroupe(ids);

      setConflitsSupprimesLocaux((prev) => {
        const next = new Set(prev);
        conflitsASupprimerGroupe.forEach((c) => {
          if (c.paireCle) next.add(c.paireCle);
          if (c.id && !/^C-\d+$/i.test(String(c.id).trim())) next.add(c.id);
          if (c.numero && !/^C-\d+$/i.test(String(c.numero).trim())) next.add(c.numero);
          const aId = c.barrageAId || c.a?.id;
          const bId = c.barrageBId || c.b?.id;
          if (aId && bId) next.add(clePaire(aId, bId));
        });
        return next;
      });

      setDbConflits((prev) =>
        prev.filter((c) => !ids.includes(c.id) && !ids.includes(c.numero) && !ids.includes(c.paireCle))
      );

      setSelectionIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });

      if (typeof onConflitSupprime === 'function') {
        conflitsASupprimerGroupe.forEach((c) => onConflitSupprime(c));
      }

      notifier({
        type: 'succes',
        titre: 'Conflits supprimés',
        message: `${ids.length} conflit(s) supprimé(s) avec succès.`,
      });

      setConflitsASupprimerGroupe(null);
      recharger();
    } catch (err) {
      setErreurSuppression(err?.message ?? 'Échec de la suppression des conflits sélectionnés.');
    } finally {
      setSuppressionEnCours(false);
    }
  };

  if (!presence.monte) return null;

  return (
    <aside
      role="complementary"
      aria-label="Gestion des conflits"
      data-presence={presence.etat}
      data-depuis="droite"
      className="fixed inset-y-0 right-0 z-[2000] flex w-full max-w-[430px] flex-col border-l border-white/10 bg-gr-navy/95 text-white shadow-2xl backdrop-blur-xl"
    >
      {/* 1. EN-TÊTE PRINCIPAL ÉPURÉ */}
      <header className="p-3.5 border-b border-white/10 shrink-0 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="grid size-8 place-items-center rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0">
              <IconAlert size={15} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-bold tracking-tight text-white truncate">
                Gestion des conflits
              </h2>
              <p className="text-[11px] text-white/50 truncate">
                {estAdmin
                  ? 'Super Admin · Contrôle & arbitrage'
                  : estRegion
                  ? `CMD Région ${session?.unite ?? ''}`
                  : `CMD Compagnie ${session?.unite ?? ''}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Bouton discret Filtrer par route */}
            {onOuvrirFiltreRoute && (
              <button
                type="button"
                onClick={onOuvrirFiltreRoute}
                title="Filtrer les conflits par axe routier"
                className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-all ${
                  parametresRoute?.route
                    ? 'border-gr-gold/60 bg-gr-gold/20 text-gr-gold font-bold'
                    : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <IconRoute size={12} className="text-gr-gold" />
                <span className="hidden sm:inline">Filtrer</span>
                {parametresRoute?.route && (
                  <span className="font-mono text-[9.5px]">({parametresRoute.route})</span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={recharger}
              title="Rafraîchir les données"
              className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={fermer}
              aria-label="Fermer le panneau et revenir à la carte"
              title="Fermer et revenir à la carte"
              className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1 text-[11.5px] font-bold text-white hover:bg-white/20 hover:border-white/30 transition-all shadow-sm active:scale-95 ml-1"
            >
              <IconClose size={13} />
              <span>Fermer</span>
            </button>
          </div>
        </div>

        {/* Bannière de filtrage d'axe actif (si présent) */}
        {parametresRoute?.route && (
          <div className="flex flex-col gap-1.5 rounded-xl border border-sky-500/30 bg-sky-950/40 p-2 text-[10.5px] text-white">
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 truncate">
                <IconRoute size={12} className="text-sky-400 shrink-0" />
                <span className="truncate">
                  Axe : <b>{parametresRoute.route}</b> ({parametresRoute.distance} km)
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                <button
                  type="button"
                  onClick={onOuvrirFiltreRoute}
                  className="font-bold text-sky-300 hover:text-sky-200 text-[10px] hover:underline"
                >
                  Modifier
                </button>
                {onEffacerFiltreRoute && (
                  <button
                    type="button"
                    onClick={onEffacerFiltreRoute}
                    title="Effacer le filtre d'axe"
                    className="rounded bg-white/10 hover:bg-white/20 px-1 py-0.2 text-[9.5px] text-white/80"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Sélecteur de sens Aller / Retour sur l'axe */}
            <div className="flex items-center justify-between border-t border-sky-500/20 pt-1.5 text-[9.5px]">
              <span className="text-white/60">Sens :</span>
              <div className="flex items-center gap-1">
                {[
                  { id: SENS_TOUS, label: 'Tous' },
                  { id: SENS_ALLER, label: 'Aller ➔' },
                  { id: SENS_RETOUR, label: '⬅ Retour' },
                ].map((s) => {
                  const estChoisi = sensActif === s.id;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={!onChangerSensRoute}
                      onClick={() => onChangerSensRoute?.(s.id)}
                      className={`px-1.5 py-0.5 rounded font-bold transition-all ${
                        estChoisi
                          ? s.id === SENS_ALLER
                            ? 'bg-sky-500 text-white shadow-sm'
                            : s.id === SENS_RETOUR
                            ? 'bg-amber-500 text-slate-950 shadow-sm'
                            : 'bg-white/20 text-white'
                          : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 2. LES FILES DU WORKFLOW — compteurs = files réelles du serveur */}
        <div role="tablist" aria-label="Files des conflits" className="flex flex-wrap gap-1.5 pt-0.5 text-[11px] font-semibold">
          <button
            type="button"
            role="tab"
            aria-selected={ongletActif === 'non_assignes'}
            onClick={() => setOngletActif('non_assignes')}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              ongletActif === 'non_assignes'
                ? 'border-gr-gold bg-gr-gold font-extrabold text-gr-navy shadow-md'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>Les Conflits</span>
            <span
              className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                ongletActif === 'non_assignes' ? 'bg-gr-navy/30 font-bold text-gr-navy' : 'border border-amber-500/30 bg-amber-500/20 text-amber-300'
              }`}
            >
              <ValeurAnimee valeur={totalNonAssignes} classe="gr-compteur-change">{totalNonAssignes}</ValeurAnimee>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ongletActif === 'en_attente'}
            onClick={() => setOngletActif('en_attente')}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              ongletActif === 'en_attente'
                ? 'border-gr-gold bg-gr-gold font-extrabold text-gr-navy shadow-md'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>À traiter</span>
            <span
              className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                ongletActif === 'en_attente' ? 'bg-gr-navy/30 font-bold text-gr-navy' : 'border border-sky-500/30 bg-sky-500/20 text-sky-300'
              }`}
            >
              <ValeurAnimee valeur={totalEnAttente} classe="gr-compteur-change">{totalEnAttente}</ValeurAnimee>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ongletActif === 'a_valider'}
            onClick={() => setOngletActif('a_valider')}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              ongletActif === 'a_valider'
                ? 'border-gr-gold bg-gr-gold font-extrabold text-gr-navy shadow-md'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>À valider</span>
            <span
              className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                ongletActif === 'a_valider' ? 'bg-gr-navy/30 font-bold text-gr-navy' : 'border border-red-500/30 bg-red-500/20 text-red-300'
              }`}
            >
              <ValeurAnimee valeur={totalAValider} classe="gr-compteur-change">{totalAValider}</ValeurAnimee>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ongletActif === 'suivi'}
            onClick={() => setOngletActif('suivi')}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              ongletActif === 'suivi'
                ? 'border-gr-gold bg-gr-gold font-extrabold text-gr-navy shadow-md'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>Suivi</span>
            <span
              className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                ongletActif === 'suivi' ? 'bg-gr-navy/30 font-bold text-gr-navy' : 'border border-white/15 bg-white/10 text-white/70'
              }`}
            >
              <ValeurAnimee valeur={totalSuivi} classe="gr-compteur-change">{totalSuivi}</ValeurAnimee>
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={ongletActif === 'historique'}
            onClick={() => setOngletActif('historique')}
            className={`flex items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-center transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              ongletActif === 'historique'
                ? 'border-gr-gold bg-gr-gold font-extrabold text-gr-navy shadow-md'
                : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span>Historique</span>
            <span
              className={`rounded-full px-1.5 font-mono text-[9.5px] ${
                ongletActif === 'historique' ? 'bg-gr-navy/30 font-bold text-gr-navy' : 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
              }`}
            >
              <ValeurAnimee valeur={totalHistorique} classe="gr-compteur-change">{totalHistorique}</ValeurAnimee>
            </span>
          </button>
        </div>

        {/* Filtres : recherche, région, compagnie, état, période. */}
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="search"
              value={filtres.texte}
              onChange={(e) => setFiltres((f) => ({ ...f, texte: e.target.value }))}
              placeholder="Rechercher (n°, poste, route)…"
              aria-label="Rechercher un conflit"
              className="min-w-0 flex-1 rounded-lg border border-border-default bg-gr-card px-2.5 py-1.5 text-[11.5px] text-text-primary placeholder:text-text-muted focus:border-gr-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setFiltresOuverts((v) => !v)}
              aria-expanded={filtresOuverts}
              className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${filtresActifs ? 'border-gr-primary/50 bg-gr-primary/12 text-gr-primary' : 'border-border-default bg-gr-card text-text-secondary hover:bg-gr-hover'}`}
            >
              Filtres{filtresActifs ? ' •' : ''}
            </button>
          </div>
          {filtresOuverts && (
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border-default bg-gr-card/60 p-2">
              <label className="text-[10px] text-text-muted">
                Région
                <select value={filtres.region} onChange={(e) => setFiltres((f) => ({ ...f, region: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11px] text-text-primary">
                  <option value="">Toutes</option>
                  {optionsFiltres.regions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-text-muted">
                Compagnie
                <select value={filtres.compagnie} onChange={(e) => setFiltres((f) => ({ ...f, compagnie: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11px] text-text-primary">
                  <option value="">Toutes</option>
                  {optionsFiltres.cies.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="col-span-2 text-[10px] text-text-muted">
                État
                <select value={filtres.etat} onChange={(e) => setFiltres((f) => ({ ...f, etat: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11px] text-text-primary">
                  <option value="">Tous</option>
                  {Object.entries(LIBELLES_ETATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-text-muted">
                Du
                <input type="date" value={filtres.du} onChange={(e) => setFiltres((f) => ({ ...f, du: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11px] text-text-primary" />
              </label>
              <label className="text-[10px] text-text-muted">
                Au
                <input type="date" value={filtres.au} onChange={(e) => setFiltres((f) => ({ ...f, au: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11px] text-text-primary" />
              </label>
              {filtresActifs && (
                <button
                  type="button"
                  onClick={() => setFiltres({ texte: '', region: '', compagnie: '', etat: '', du: '', au: '' })}
                  className="col-span-2 rounded-md border border-border-default px-2 py-1 text-[10.5px] font-semibold text-text-secondary hover:bg-gr-hover"
                >
                  Effacer les filtres
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* 3. CORPS DE LISTE DES CONFLITS SELON L'ONGLET ACTIF */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {!charge && (
          <div role="status" aria-label="Chargement des conflits" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-border-default p-3">
                <div className="flex justify-between gap-2">
                  <span className="gr-squelette h-5 w-28" />
                  <span className="gr-squelette h-5 w-24" />
                </div>
                <span className="gr-squelette block h-4 w-3/4" />
                <span className="gr-squelette block h-12 w-full" />
                <div className="flex gap-2">
                  <span className="gr-squelette h-7 flex-1" />
                  <span className="gr-squelette h-7 w-20" />
                </div>
              </div>
            ))}
          </div>
        )}

        {erreur && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300">
            {erreur}
          </div>
        )}

        {charge && !erreur && (
          <>
            {/* Barre de sélection multiple & actions groupées */}
            {ongletActif !== 'historique' && conflitsOngletActif.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 p-2 px-2.5 text-[11px] mb-2">
                <label className="flex items-center gap-2 font-medium cursor-pointer select-none min-w-0">
                  <input
                    type="checkbox"
                    checked={tousSelectionnes}
                    ref={(el) => {
                      if (el) el.indeterminate = selectionIdsDansOnglet.size > 0 && !tousSelectionnes;
                    }}
                    onChange={toggleSelectionnerTout}
                    aria-label="Sélectionner tous les conflits de cette liste"
                    className="size-4 rounded border-white/30 bg-white/10 text-gr-gold focus:ring-gr-gold/50 cursor-pointer accent-gr-gold shrink-0"
                  />
                  <span className="text-white/80 truncate">
                    {selectionIdsDansOnglet.size > 0
                      ? `${selectionIdsDansOnglet.size} / ${conflitsOngletActif.length} sélectionné(s)`
                      : 'Sélectionner tout'}
                  </span>
                </label>

                {selectionIdsDansOnglet.size > 0 && (
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={deselectionnerTout}
                      className="text-[10px] text-white/50 hover:text-white underline px-1 py-0.5"
                    >
                      Désélectionner
                    </button>

                    {estAdmin && (ongletActif === 'non_assignes' || ongletActif === 'en_attente') && (
                      <button
                        type="button"
                        onClick={() => {
                          const selectionnes = conflitsOngletActif.filter((c) =>
                            selectionIds.has(c.id || c.numero || c.paireCle)
                          );
                          if (selectionnes.length > 0 && onAssigner) {
                            onAssigner(selectionnes);
                          }
                        }}
                        className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-gr-gold to-amber-500 px-2.5 py-1 text-[10.5px] font-extrabold text-gr-navy shadow hover:brightness-110 active:scale-95 transition-all"
                      >
                        Assigner ({selectionIdsDansOnglet.size})
                      </button>
                    )}

                    {estAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          const selectionnes = conflitsOngletActif.filter((c) =>
                            selectionIds.has(c.id || c.numero || c.paireCle)
                          );
                          if (selectionnes.length > 0) {
                            setConflitsASupprimerGroupe(selectionnes);
                          }
                        }}
                        className="flex items-center gap-1 rounded-lg bg-red-600/80 hover:bg-red-600 border border-red-500/50 px-2 py-1 text-[10.5px] font-bold text-white shadow hover:brightness-110 active:scale-95 transition-all"
                      >
                        <IconPoubelle size={12} />
                        <span>Supprimer ({selectionIdsDansOnglet.size})</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {/* ============================================================== */}
            {/* VUE 1 : CONFLITS TRAITÉS (CMD Région / Cie / Superadmin)       */}
            {/* ============================================================== */}
            {ongletActif === 'a_valider' && (
              <div className="space-y-2.5">
                {conflitsAValider.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/50 space-y-1">
                    <p className="text-[13px] font-bold text-white/80">Aucun traitement à valider</p>
                    <p className="text-[11px]">
                      {estAdmin
                        ? 'Les traitements soumis par les CMD Région et les CMD CIE apparaîtront ici pour validation.'
                        : 'Vos traitements soumis, en attente de la validation du Super Admin, apparaîtront ici.'}
                    </p>
                  </div>
                ) : (
                  conflitsAValider.map((conf, idx) => envelopper(conf, renderCarteConflit(conf, idx)))
                )}
              </div>
            )}

            {ongletActif === 'suivi' && (
              <div className="space-y-2.5">
                {conflitsSuivi.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/50 space-y-1">
                    <p className="text-[13px] font-bold text-white/80">Aucun conflit en suivi</p>
                    <p className="text-[11px]">Les conflits dont le traitement a été validé restent ici jusqu’à leur clôture.</p>
                  </div>
                ) : (
                  conflitsSuivi.map((conf, idx) => envelopper(conf, renderCarteConflit(conf, idx)))
                )}
              </div>
            )}

            {ongletActif === 'historique' && (
              <HistoriqueConflits session={session} version={version} onVoirSurCarte={onVoirSurCarte} onRouvert={recharger} />
            )}

            {/* ============================================================== */}
            {/* VUE 2 : EN ATTENTE (Assignés mais non encore traités)           */}
            {/* ============================================================== */}
            {ongletActif === 'en_attente' && (
              <div className="space-y-2.5">
                {conflitsEnAttente.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/50 space-y-1">
                    <p className="text-[13px] font-bold text-white/80">Aucun conflit en attente</p>
                    <p className="text-[11px]">
                      Tous les conflits assignés ont été traités ou sont en attente d'assignation.
                    </p>
                  </div>
                ) : (
                  conflitsEnAttente.map((conf, idx) => envelopper(conf, renderCarteConflit(conf, idx)))
                )}
              </div>
            )}

            {/* ============================================================== */}
            {/* VUE 3 : NON ASSIGNÉS (À arbitrer par Superadmin)                */}
            {/* ============================================================== */}
            {ongletActif === 'non_assignes' && (
              <div className="space-y-2.5">
                {/* Barre d'action groupée pour Superadmin si conflits non assignés */}
                {estAdmin && conflitsNonAssignes.length > 0 && (
                  <div className="flex items-center justify-between pb-1 text-[11px] text-white/60">
                    <span>{totalNonAssignes} conflit(s) à arbitrer</span>
                    <button
                      type="button"
                      disabled={assignationEnMasseEnCours}
                      onClick={handleAssignerTout}
                      title="Assigner automatiquement tous les conflits aux régions concernées"
                      className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-gr-gold to-amber-500 px-2.5 py-1 text-[11px] font-extrabold text-gr-navy shadow hover:brightness-110 active:scale-95 transition-all disabled:opacity-50"
                    >
                      {assignationEnMasseEnCours ? (
                        <>
                          <IconSpinner size={10} className="animate-spin" />
                          <span>En cours…</span>
                        </>
                      ) : (
                        <span>Assigner tout</span>
                      )}
                    </button>
                  </div>
                )}

                {conflitsNonAssignes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-white/50 space-y-1">
                    <p className="text-[13px] font-bold text-white/80">Aucun conflit à assigner</p>
                    <p className="text-[11px]">
                      {estAdmin
                        ? 'Les conflits détectés et pas encore assignés apparaissent ici.'
                        : 'Les conflits non assignés sont gérés par le Super Admin : vous voyez ceux qui vous sont assignés.'}
                    </p>
                  </div>
                ) : (
                  conflitsNonAssignes.map((conf, idx) => envelopper(conf, renderCarteConflit(conf, idx)))
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* MODALE AGRANDIR COMPARATIF COMPLET */}
      {conflitAgrandir && (
        <ModalComparatifAvantApres
          conflit={conflitAgrandir}
          session={session}
          onClose={() => setConflitAgrandir(null)}
          onApprouver={(c) => handleDecider(c, 'approuver')}
          onRejeter={(c) => handleDecider(c, 'rejeter')}
          onVoirSurCarte={handleVoirSurCarte}
        />
      )}

      {/* MODALE DE CONFIRMATION DE TRAITEMENT (Map First Experience) */}
      {conflitEnConfirmation && (
        <ModalConfirmationTraitement
          conflit={conflitEnConfirmation}
          session={session}
          numeroAffiche={
            indexConflitMap.get(conflitEnConfirmation.id) ||
            (conflitEnConfirmation.paireCle && indexConflitMap.get(conflitEnConfirmation.paireCle)) ||
            1
          }
          regionAffichee={getRegionConflit(conflitEnConfirmation)}
          statutSimple={getStatutSimple(conflitEnConfirmation)}
          onClose={() => setConflitEnConfirmation(null)}
          onAssignerRegion={(c) => {
            setConflitEnConfirmation(null);
            onAssigner?.(c);
          }}
          onAssignerCie={(c) => {
            setConflitEnConfirmation(null);
            onTransmettre?.(c);
          }}
          onTraiterDirect={(c) => {
            setConflitEnConfirmation(null);
            handlePrendreEnChargeEtTraiter(c);
          }}
          onValiderAdmin={(c) => {
            setConflitEnConfirmation(null);
            handleDecider(c, 'approuver');
          }}
          onRejeterAdmin={(c, motif) => {
            setConflitEnConfirmation(null);
            handleDecider(c, 'rejeter', null, motif);
          }}
          onCloturerAdmin={(c) => {
            setConflitEnConfirmation(null);
            handleAction(c, 'cloturer');
          }}
        />
      )}

      {/* MODALE DE CONFIRMATION DE SUPPRESSION (SOFT DELETE - UNIQUE OU GROUPE) */}
      {(conflitASupprimer || conflitsASupprimerGroupe) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titre-modal-suppr-conflit"
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => !suppressionEnCours && (setConflitASupprimer(null), setConflitsASupprimerGroupe(null))}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-red-500/40 bg-gr-navy p-5 text-white shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
                <IconPoubelle size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 id="titre-modal-suppr-conflit" className="text-[15px] font-extrabold text-white">
                  {conflitsASupprimerGroupe ? `Supprimer ${conflitsASupprimerGroupe.length} conflit(s)` : 'Supprimer ce conflit'}
                </h3>
                <p className="text-[11.5px] text-white/60">
                  Confirmation de suppression sécurisée (Soft Delete)
                </p>
              </div>
              <button
                type="button"
                disabled={suppressionEnCours}
                onClick={() => (setConflitASupprimer(null), setConflitsASupprimerGroupe(null))}
                className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {conflitASupprimer && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 rounded px-2 py-0.5">
                    {conflitASupprimer.id || conflitASupprimer.numero}
                  </span>
                  <span className="font-mono text-[10.5px] text-sky-300">
                    {conflitASupprimer.route || conflitASupprimer.a?.route || 'Route'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-white/90 font-semibold pt-1">
                  <span className="truncate">{conflitASupprimer.a?.nom || conflitASupprimer.barrageAId || 'Poste A'}</span>
                  <span className="text-white/40 px-1">↔</span>
                  <span className="truncate text-right">{conflitASupprimer.b?.nom || conflitASupprimer.barrageBId || 'Poste B'}</span>
                </div>
                <div className="text-[10px] text-white/50 pt-0.5">
                  Distance : <b className="text-red-300">{Number(conflitASupprimer.distanceKm ?? conflitASupprimer.km ?? 0).toFixed(1)} km</b>
                </div>
              </div>
            )}

            {conflitsASupprimerGroupe && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] space-y-1.5 max-h-40 overflow-y-auto">
                <span className="font-bold text-white/90">
                  {conflitsASupprimerGroupe.length} conflit(s) sélectionné(s) :
                </span>
                <div className="flex flex-wrap gap-1 pt-1">
                  {conflitsASupprimerGroupe.map((c) => (
                    <span key={c.id || c.numero} className="font-mono text-[10px] bg-red-500/20 text-red-200 border border-red-500/30 rounded px-1.5 py-0.2">
                      {c.numero || c.id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[12px] text-white/85 leading-relaxed font-medium">
              « Êtes-vous sûr de vouloir supprimer les conflits sélectionnés ? Cette action est irréversible au niveau de leur affichage opérationnel. »
            </p>

            {erreurSuppression && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/15 p-2.5 text-[11px] text-red-200">
                {erreurSuppression}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={suppressionEnCours}
                onClick={() => (setConflitASupprimer(null), setConflitsASupprimerGroupe(null))}
                className="rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-4 py-2 text-[11.5px] font-bold text-white/80 transition-all"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={suppressionEnCours}
                onClick={conflitsASupprimerGroupe ? handleConfirmerSuppressionGroupe : handleConfirmerSuppression}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 hover:brightness-110 px-4 py-2 text-[11.5px] font-extrabold text-white shadow-lg shadow-red-900/30 transition-all disabled:opacity-50"
              >
                {suppressionEnCours ? (
                  <>
                    <IconSpinner size={13} className="animate-spin" />
                    <span>Suppression…</span>
                  </>
                ) : (
                  <>
                    <IconPoubelle size={13} />
                    <span>Confirmer la suppression</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );

  /**
   * Résout les informations et permissions d'approbation d'un conflit traité :
   * Workflow hiérarchique :
   *   1. CMD Compagnie traite -> En attente validation CMD Région
   *   2. CMD Région valide -> Transmis au Super Admin (En attente validation Super Admin)
   *      CMD Région refuse -> Rejeté CMD Région (avec motif), renvoyé à la Compagnie
   *   3. Super Admin valide -> Validé définitivement Super Admin (Résolu)
   *      Super Admin refuse -> Rejeté Super Admin (avec motif), renvoyé pour correction
   */
  function getStatutApprobationInfo(conf) {
    /* Conflit enregistré : le serveur dit l'état et les actions permises. */
    const w = conf.workflow;
    if (w) {
      /* État et droits DONNÉS PAR LE SERVEUR (serveur/workflowConflits.mjs) :
         l'interface ne recalcule pas qui peut quoi. */
      const ton = {
        NEW: 'bg-white/10 text-white/70 border-white/20',
        ASSIGNED_REGION: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        ASSIGNED_CIE: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        IN_PROGRESS_REGION: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
        IN_PROGRESS_CIE: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
        PENDING_VALIDATION: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
        REJECTED: 'bg-red-500/20 text-red-300 border-red-500/40',
        APPROVED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        FOLLOW_UP: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        CLOSED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      }[w.etat] ?? 'bg-white/10 text-white/70 border-white/20';
      const rejetPar = [...(conf.historique ?? [])].reverse().find((h) => h.action === 'rejeter')?.auteur;
      const label = w.etat === 'PENDING_VALIDATION'
        ? (w.actions?.valider ? '⏳ À valider par vous' : '⏳ En attente de validation (Super Admin)')
        : w.etat === 'REJECTED'
          ? `✕ ${w.libelle}`
          : ['APPROVED', 'FOLLOW_UP', 'CLOSED'].includes(w.etat)
            ? `✓ ${w.libelle}`
            : `⏳ ${w.libelle}`;
      return {
        code: w.etat,
        label,
        classe: ton,
        raison: w.motifRejet,
        par: rejetPar?.nom || rejetPar?.unite || null,
        peutValiderReg: false,
        peutValiderAdmin: Boolean(w.actions?.valider),
        peutRetraiter: w.etat === 'REJECTED' && Boolean(w.actions?.soumettre),
        peutCloturer: Boolean(w.actions?.cloturer),
      };
    }
    const app = conf.approbation || conf.traitement?.approbation;
    const statutApp = app?.statut;
    const valReg = app?.validationReg;
    const valAdmin = app?.validationAdmin;
    const auteurTraitement = conf.traitePar || conf.traitement?.auteur;
    const traiteParRang = auteurTraitement?.rang;

    // 1. Validé définitivement par le Super Admin
    if (statutApp === 'approuve' || valAdmin?.statut === 'valide' || conf.statut === 'resolu') {
      return {
        code: 'approuve',
        label: '✓ Validé Super Admin',
        classe: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        peutValiderReg: false,
        peutValiderAdmin: false,
        peutRetraiter: false,
      };
    }

    // 2. Rejeté par le Super Admin
    if (statutApp === 'rejete_admin' || valAdmin?.statut === 'rejete') {
      return {
        code: 'rejete_admin',
        label: '✕ Rejeté Super Admin',
        classe: 'bg-red-500/20 text-red-300 border-red-500/40',
        raison: valAdmin?.raison || app?.raison || conf.justification,
        par: valAdmin?.par?.nom || 'Super Admin',
        date: valAdmin?.date || app?.date,
        peutValiderReg: false,
        peutValiderAdmin: false,
        peutRetraiter: estRegion || estCie,
      };
    }

    // 3. Rejeté par le Commandant de Région
    if (statutApp === 'rejete_reg' || valReg?.statut === 'rejete') {
      return {
        code: 'rejete_reg',
        label: '✕ Rejeté CMD Région',
        classe: 'bg-red-500/20 text-red-300 border-red-500/40',
        raison: valReg?.raison || app?.raison || conf.justification,
        par: valReg?.par?.nom || (valReg?.par?.unite ? `CMD Région ${valReg.par.unite}` : 'CMD Région'),
        date: valReg?.date || app?.date,
        peutValiderReg: false,
        peutValiderAdmin: false,
        peutRetraiter: estCie || estRegion,
      };
    }

    // 4. Validé par le CMD Région -> Transmis et en attente validation Super Admin
    if (statutApp === 'en_attente_admin' || valReg?.statut === 'valide' || traiteParRang === 'reg') {
      return {
        code: 'en_attente_admin',
        label: estAdmin
          ? '⏳ En attente validation Super Admin'
          : estCie
          ? '✓ Validé Région · En attente Super Admin'
          : '⏳ Transmis Super Admin',
        classe: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
        peutValiderReg: false,
        peutValiderAdmin: estAdmin,
        peutRetraiter: false,
      };
    }

    // 5. Traité par la Compagnie -> En attente validation Région
    if (statutApp === 'en_attente_reg' || traiteParRang === 'cie') {
      return {
        code: 'en_attente_reg',
        label: estRegion ? '⏳ En attente de votre validation' : '⏳ En attente validation Région',
        classe: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        peutValiderReg: estRegion,
        peutValiderAdmin: false,
        peutRetraiter: false,
      };
    }

    // Par défaut : en attente de validation
    return {
      code: 'en_attente',
      label: '⏳ En attente validation',
      classe: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      peutValiderReg: false,
      peutValiderAdmin: estAdmin,
      peutRetraiter: false,
    };
  }

  /**
   * NOUVEAU DESIGN ÉPURÉ — SIMPLIFICATION RADICALE DU MODULE CONFLITS
   *
   * Chaque conflit est présenté sous forme d'une carte très simple :
   *   Conflit 1
   *   Région Rabat
   *   Barrage A → Barrage B
   *   Distance routière : 13,1 km
   *
   * Deux boutons uniquement :
   *   - Voir sur carte
   *   - Traiter
   *
   * Détails techniques masqués par défaut et accessibles via [▼ Détails].
   */
  function renderCarteConflit(conf, index) {
    const id = conf.id || conf.numero;
    const bA = conf.a || conf.barrageA;
    const bB = conf.b || conf.barrageB;
    const nomA = bA?.nom || bA?.id || 'Barrage A';
    const nomB = bB?.nom || bB?.id || 'Barrage B';
    const distance = Number(conf.distanceKm ?? conf.km ?? 0);
    const estVise = conflitActuel && (conflitActuel.id === id || conflitActuel.numero === id);
    const detailsOuvert = Boolean(detailsOuverts[id]);

    const numeroAffiche =
      indexConflitMap.get(id) ||
      (conf.paireCle && indexConflitMap.get(conf.paireCle)) ||
      (index != null ? index + 1 : 1);
    const titreAffiche = `Conflit ${numeroAffiche}`;
    const regionAffichee = getRegionConflit(conf);
    const statutSimple = getStatutSimple(conf);

    return (
      <article
        key={id}
        ref={(el) => (cardRefs.current[id] = el)}
        className={`rounded-2xl border p-4 space-y-3 transition-all ${
          estVise
            ? 'border-gr-gold bg-gr-gold/15 shadow-xl ring-1 ring-gr-gold/50'
            : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.07]'
        }`}
      >
        {/* Ligne 1 : Titre "Conflit N" + Statut simple (À traiter | En cours | Traité) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {estAdmin && (
              <input
                type="checkbox"
                checked={selectionIds.has(id) || (conf.paireCle && selectionIds.has(conf.paireCle))}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelection(conf);
                }}
                aria-label={`Sélectionner le conflit ${numeroAffiche}`}
                className="size-4 rounded border-white/30 bg-white/10 text-gr-gold focus:ring-gr-gold/50 cursor-pointer accent-gr-gold shrink-0"
              />
            )}
            <span className="text-base font-extrabold text-white tracking-wide">
              {titreAffiche}
            </span>
          </div>

          <span className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold border shrink-0 ${statutSimple.badgeClasse}`}>
            {statutSimple.label}
          </span>
        </div>

        {/* Ligne 2 : Région concernée */}
        <div className="text-xs font-semibold text-gr-gold flex items-center gap-1.5">
          <span>📍</span>
          <span>{regionAffichee}</span>
        </div>

        {/* Ligne 3 : Barrage A → Barrage B */}
        <div className="flex items-center gap-2 text-[13px] font-medium text-white/95 bg-black/40 border border-white/5 rounded-xl px-3 py-2.5">
          <span className="truncate font-semibold">{nomA}</span>
          <span className="text-gr-gold font-extrabold text-sm shrink-0">→</span>
          <span className="truncate font-semibold">{nomB}</span>
        </div>

        {/* Ligne 4 : Distance routière */}
        <div className="flex items-center justify-between text-xs px-0.5 text-white/70">
          <span className="text-white/50">Distance routière :</span>
          <span className="font-mono font-bold text-red-300 text-sm">
            {distance.toFixed(1)} km
          </span>
        </div>

        {/* Ligne 5 : Deux boutons uniquement : Voir sur carte & Traiter */}
        <div className="pt-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => handleVoirSurCarte(conf, e, 'comparer')}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 py-2.5 text-xs font-bold text-white transition-all active:scale-95 shadow-sm cursor-pointer"
            title="Fermer le panneau et centrer la carte sur ce conflit"
          >
            <IconTerritoire size={14} className="text-gr-gold" />
            <span>Voir sur carte</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConflitEnConfirmation(conf);
            }}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-gr-gold to-amber-500 hover:brightness-110 py-2.5 text-xs font-extrabold text-gr-navy transition-all active:scale-95 shadow-md cursor-pointer"
            title="Ouvrir la confirmation et traiter ce conflit"
          >
            <span>Traiter</span>
          </button>
        </div>

        {/* Section secondaire repliable : Détails techniques */}
        <div className="pt-1 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => toggleDetails(id)}
            className="text-[10px] text-white/40 hover:text-white/70 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <span>{detailsOuvert ? '▲ Masquer les détails techniques' : '▼ Détails techniques'}</span>
          </button>

          {detailsOuvert && (
            <div className="mt-2 rounded-xl bg-black/40 border border-white/5 p-3 space-y-1.5 text-[10.5px] text-white/70 animate-in fade-in duration-150">
              <div className="flex justify-between">
                <span className="text-white/40">ID technique :</span>
                <span className="font-mono text-white/80 select-all">{id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Axe routier :</span>
                <span className="font-mono text-amber-300">{conf.route || bA?.route || bB?.route || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Seuil réglementaire :</span>
                <span className="font-mono">{conf.seuilKm || 20} km</span>
              </div>
              {conf.assigneA && (
                <div className="flex justify-between">
                  <span className="text-white/40">Délégué région :</span>
                  <span className="font-semibold text-sky-300">{conf.assigneA.unite || conf.assigneA.nom}</span>
                </div>
              )}
              {conf.assigneCie && (
                <div className="flex justify-between">
                  <span className="text-white/40">Délégué compagnie :</span>
                  <span className="font-semibold text-sky-300">{conf.assigneCie.unite || conf.assigneCie.nom}</span>
                </div>
              )}
              {conf.traitePar && (
                <div className="flex justify-between">
                  <span className="text-white/40">Traité par :</span>
                  <span className="font-semibold text-emerald-300">{conf.traitePar.nom || 'Commandement'}</span>
                </div>
              )}
              {conf.workflow?.etat && (
                <div className="flex justify-between">
                  <span className="text-white/40">Statut technique :</span>
                  <span className="font-mono text-[9.5px] text-white/60">{conf.workflow.etat}</span>
                </div>
              )}
              {conf.refus?.raison && (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[10px]">
                  <b>Motif rejet :</b> « {conf.refus.raison} »
                </div>
              )}
              {peutSupprimer(conf) && (
                <div className="pt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setConflitASupprimer(conf)}
                    className="text-[10.5px] font-semibold text-red-400 hover:text-red-300 underline cursor-pointer"
                  >
                    Supprimer ce conflit
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }


}

/** Libellés des états du workflow (serveur/workflowConflits.mjs). */
const LIBELLES_ETATS = {
  NEW: 'Nouveau — non assigné',
  ASSIGNED_REGION: 'Assigné au CMD Région',
  IN_PROGRESS_REGION: 'En traitement — CMD Région',
  ASSIGNED_CIE: 'Assigné au CMD CIE',
  IN_PROGRESS_CIE: 'En traitement — CMD CIE',
  PENDING_VALIDATION: 'À valider',
  REJECTED: 'Rejeté — à corriger',
  APPROVED: 'Validé',
  FOLLOW_UP: 'En suivi',
  CLOSED: 'Clôturé',
};
const LIBELLES_ACTIONS = {
  detection: 'Détection',
  assigner_region: 'Assignation au CMD Région',
  desassigner: 'Désassignation',
  prendre_en_charge: 'Prise en charge (CMD Région)',
  assigner_cie: 'Assignation au CMD CIE',
  commencer: 'Début du traitement (CMD CIE)',
  soumettre: 'Soumission pour validation',
  valider: 'Validation',
  rejeter: 'Rejet',
  cloturer: 'Clôture',
  rouvrir: 'Réouverture',
  resolution_automatique: 'Résolution automatique',
  resolution_physique: 'Résolu sur le terrain',
  reapparition: 'Réapparition',
};

/**
 * HISTORIQUE CHRONOLOGIQUE D'UN CONFLIT — toutes les étapes, jamais
 * effacées : assignations, changements d'état, traitements, validations et
 * rejets (motif), avec leur auteur et leur date.
 */
function ChronologieConflit({ conf }) {
  const etapes = (conf?.historique ?? []).filter((h) => h && (h.vers || h.action));
  if (!etapes.length) return <p className="text-[10.5px] text-text-muted">Aucune étape enregistrée.</p>;
  return (
    <ol className="space-y-1.5 border-l border-border-default pl-3" aria-label={`Historique du conflit ${conf.numero || conf.id}`}>
      {etapes.map((h, i) => (
        <li key={h.id ?? `${h.date}-${i}`} className="relative text-[10.5px]">
          <span aria-hidden="true" className="absolute -left-[15px] top-1 size-2 rounded-full bg-gr-primary" />
          <p className="font-semibold text-text-primary">
            {LIBELLES_ACTIONS[h.action] ?? h.action}
            {h.vers && h.de !== h.vers && <span className="font-normal text-text-secondary"> → {LIBELLES_ETATS[h.vers] ?? h.vers}</span>}
          </p>
          <p className="text-text-muted">
            {h.date ? new Date(h.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
            {' · '}
            {h.auteur?.nom || h.auteur?.matricule || 'Système'}
            {h.auteur?.unite && h.auteur.rang !== 'admin' ? ` (${h.auteur.unite})` : ''}
          </p>
          {h.motif && <p className="italic text-red-300">Motif : {h.motif}</p>}
          {!h.motif && h.commentaire && <p className="text-text-secondary">{h.commentaire}</p>}
        </li>
      ))}
    </ol>
  );
}
