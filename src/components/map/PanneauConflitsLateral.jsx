import { usePresence } from '../../usePresence.js';
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import * as API from '../../api.js';
import {
  IconAlert,
  IconClose,
  IconSpinner,
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
import HistoriqueConflits from './HistoriqueConflits.jsx';
import ActionsConflit from './ActionsConflit.jsx';
import ValeurAnimee from '../ValeurAnimee.jsx';
import { notifier } from '../Toasts.jsx';
import { etatListeConflit, prochainConflitAAssigner, libelleAssignation, compterATraiter, auteurAssignation } from '../../actionsConflit.js';

/** Pastille du statut (voir `etatListeConflit`). */
const BADGE_STATUT = {
  a_traiter: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  assigne: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  en_cours: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  a_valider: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  a_corriger: 'bg-red-500/15 text-red-300 border-red-500/30',
  archive: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  a_assigner: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

/** Largeur de la carte déroulante, et marge à l'écran. */
const LARGEUR_MENU = 400;
const MARGE_MENU = 12;

/** Durée du repli d'une carte qui quitte sa file — celle de `--duree-lente`. */
const DUREE_SORTIE_CARTE = 280;

/* Traité / assigné / non assigné : définitions partagées avec la carte, qui
   ne trace un conflit « après déplacement » que s'il est actif ici. */
import { estConflitTraite, estConflitAssigne, estConflitNonAssigne } from '../../etatConflits.js';

/**
 * GESTION DES CONFLITS — UN MENU DÉROULANT SOUS LE BOUTON « CONFLITS »
 *
 * Plus de colonne permanente à droite : un clic sur le bouton « Conflits »
 * (`ancreRef`) ouvre, juste en dessous, une carte compacte :
 *   — la LISTE : une ligne par conflit (barrages, statut, état d'assignation) ;
 *   — choisir une ligne referme la liste et montre, au même endroit, le
 *     DÉTAIL du conflit avec ses actions (« ← Tous les conflits » pour revenir).
 * Après une assignation (`derniereAssignation`), le détail passe tout seul au
 * prochain conflit à assigner de la même région (prochainConflitAAssigner) ;
 * s'il n'y en a plus, la liste revient avec un message.
 *
 * Les files du workflow, une section serveur chacune (workflow.section) :
 *   Nouveaux    détectés, pas encore assignés — Super Admin seul ;
 *   À traiter   assignés, en traitement, ou renvoyés pour correction ;
 *   À valider   traitements soumis, en attente du Super Admin ;
 *   Historique  approuvés : un conflit approuvé y passe directement.
 *
 * Chaque conflit tient en quelques lignes (numéro, région, barrages, distance,
 * statut) et une action principale choisie selon le rôle (src/actionsConflit.js).
 * Le technique reste sous « Détails ».
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
  /** Le bouton sous lequel la carte se pose. */
  ancreRef = null,
  /** { ts, ids, paires, regions, destinataire } — la dernière assignation enregistrée. */
  derniereAssignation = null,
  /** Le bord droit de la carte déroulante (px), ou null fermée : les barres flottantes s'écartent. */
  onBordDroit = null,
  /** Compteur : chaque incrément montre la LISTE (après une analyse, tous les conflits détectés). */
  demandeListe = 0,
  /** { id, n } : montrer la FICHE de ce conflit (désigné sur la carte, « Voir »…). */
  demandeDetail = null,
}) {
  const fermer = onClose || onFermer;
  const conflitActuel = conflitVise || conflitSelectionne;

  const [dbConflits, setDbConflits] = useState([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [detailsOuverts, setDetailsOuverts] = useState({});
  /* Les autres rôles ne voient jamais de conflit non assigné : ils ouvrent sur « À traiter ». */
  const [ongletActif, setOngletActif] = useState(() => (session?.rang === 'admin' ? 'non_assignes' : 'en_attente')); // 'non_assignes' | 'en_attente' | 'a_valider' | 'historique'
  const [actionEnCours, setActionEnCours] = useState(null);
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
  const [erreurAction, setErreurAction] = useState(null); // { id, message }
  /* Rejet demandé depuis le comparatif : la carte ouvre la saisie du motif. */
  const [demandesRejet, setDemandesRejet] = useState({});
  const cardRefs = useRef({});
  /* Gardé monté le temps de sa sortie (voir usePresence). */
  const presence = usePresence(ouvert);
  /* Le conflit montré en détail (null : la liste). */
  const [detailId, setDetailId] = useState(null);
  /* « C-03 assigné… conflit suivant », ou « plus rien à assigner ». */
  const [annonce, setAnnonce] = useState(null);
  /* Sous le bouton déclencheur, sans sortir de l'écran. */
  const [position, setPosition] = useState({ top: 120, left: MARGE_MENU });
  useEffect(() => {
    if (!ouvert) return undefined;
    const placer = () => {
      const r = ancreRef?.current?.getBoundingClientRect?.();
      const largeur = Math.min(LARGEUR_MENU, window.innerWidth - 2 * MARGE_MENU);
      const top = r ? Math.round(r.bottom + 8) : 120;
      const left = r ? Math.round(Math.min(Math.max(r.left, MARGE_MENU), window.innerWidth - largeur - MARGE_MENU)) : MARGE_MENU;
      setPosition((p) => (p.top === top && p.left === left ? p : { top, left }));
    };
    placer();
    /* Le bouton se déplace quand un panneau de gauche s'ouvre : on suit. */
    const minuterie = setInterval(placer, 400);
    window.addEventListener('resize', placer);
    return () => {
      clearInterval(minuterie);
      window.removeEventListener('resize', placer);
    };
  }, [ouvert, ancreRef]);
  useEffect(() => {
    if (!ouvert) {
      setDetailId(null);
      setAnnonce(null);
    }
  }, [ouvert]);
  /* Après une analyse : la liste de TOUS les conflits détectés, pas le détail
     du premier. Pour le Super Admin, la file « Nouveaux » qui les reçoit. */
  useEffect(() => {
    if (!demandeListe) return;
    setDetailId(null);
    setAnnonce(null);
    if (session?.rang === 'admin') setOngletActif('non_assignes');
  }, [demandeListe, session?.rang]);
  /* Un conflit désigné ailleurs (carte, notification, résultat) : sa fiche,
     ici — la seule fiche de conflit de l'application. */
  useEffect(() => {
    if (!demandeDetail?.id) return;
    setAnnonce(null);
    setDetailId(demandeDetail.id);
  }, [demandeDetail]);
  useEffect(() => {
    onBordDroit?.(ouvert ? position.left + Math.min(LARGEUR_MENU, window.innerWidth - 2 * MARGE_MENU) : null);
  }, [ouvert, position.left, onBordDroit]);
  /* Échap : le détail revient à la liste ; la liste se referme. */
  useEffect(() => {
    if (!ouvert) return undefined;
    const auClavier = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.stopPropagation();
      if (detailId) setDetailId(null);
      else fermer?.();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [ouvert, detailId, fermer]);

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
    return API.listerConflits()
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
        /* Traité et approuvé, sans conflit actif ouvert depuis : il est à
           l'historique — comme pour les conflits de l'optimisation (étape 2),
           il ne revient pas en « Nouveaux » avec un bouton « Assigner ». */
        if (pairesCloses.has(paire) && !existant) continue;

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

  /* Prise en charge préalable transparente puis ouverture du traitement */
  const traitementRef = useRef(null);
  const handlePrendreEnChargeEtTraiter = useCallback(
    async (conf) => {
      /* Un double clic ne relance pas la prise en charge (une seule requête). */
      if (traitementRef.current === conf.id) return;
      traitementRef.current = conf.id;
      try {
        if (conf.workflow?.actions?.prendre_en_charge) {
          await API.actionConflit(conf.id, 'prendre_en_charge', { etatAttendu: conf.workflow?.etat ?? null });
        } else if (conf.workflow?.actions?.commencer) {
          await API.actionConflit(conf.id, 'commencer', { etatAttendu: conf.workflow?.etat ?? null });
        }
      } catch (err) {
        console.warn('Action préalable :', err?.message);
      } finally {
        traitementRef.current = null;
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
   *   Nouveaux     : NEW — détectés, pas encore assignés (Super Admin) ;
   *   À traiter    : assignés à une région ou une compagnie, en traitement,
   *                  ou rejetés pour correction (motif affiché) ;
   *   À valider    : traitements soumis, en attente du Super Admin ;
   *   Historique   : approuvés (onglet dédié, lu à part) — le serveur ne les
   *                  renvoie plus dans les listes actives.
   *
   * Un conflit seulement CALCULÉ (filtration, analyse d'un axe — pas encore
   * enregistré) n'a pas de section : il est « Nouveaux » pour le Super
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

  const conflitsAValider = useMemo(() => visibles.filter((c) => sectionDe(c) === 'a_valider'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps
  const conflitsEnAttente = useMemo(() => visibles.filter((c) => sectionDe(c) === 'a_traiter'), [visibles]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * « NOUVEAUX » = LE CALCUL EN COURS, ET LUI SEUL. Une optimisation (par
   * paramètres ou par route — une seule à la fois) est active : la file ne
   * montre que les paires de SON résultat. Les conflits nouveaux enregistrés
   * par un calcul précédent (autre mode, autre zone) restent en base, intacts,
   * mais ne se mêlent pas à ce résultat. Sans calcul actif : tous, comme avant.
   * Les files assignées, à valider et l'historique ne sont jamais filtrées.
   */
  const pairesDuCalcul = useMemo(() => {
    const listes = [conflitsIdentifies, conflitsCalculesRoute].filter(Array.isArray);
    if (!listes.length) return null;
    const p = new Set();
    for (const l of listes) {
      for (const c of l) {
        const aId = c.barrageAId || c.a?.id || c.barrageA?.id;
        const bId = c.barrageBId || c.b?.id || c.barrageB?.id;
        const cle = c.cle || c.paireCle || (aId && bId ? clePaire(aId, bId) : null);
        if (cle) p.add(cle);
      }
    }
    return p;
  }, [conflitsIdentifies, conflitsCalculesRoute]);
  const conflitsNonAssignes = useMemo(
    () => visibles.filter((c) => sectionDe(c) === 'conflits' && (!pairesDuCalcul || pairesDuCalcul.has(c.paireCle))),
    [visibles, pairesDuCalcul], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
          else if (section === 'a_traiter') setOngletActif('en_attente');
          else if (section === 'conflits') setOngletActif('non_assignes');
        }
      }
      /* Désigné ailleurs (carte, notification) : le menu montre son détail. */
      if (id) setDetailId(id);
    }
  }, [conflitActuel]);

  const conflitsOngletActif = useMemo(() => {
    if (ongletActif === 'non_assignes') return conflitsNonAssignes;
    if (ongletActif === 'en_attente') return conflitsEnAttente;
    if (ongletActif === 'a_valider') return conflitsAValider;
    return [];
  }, [ongletActif, conflitsNonAssignes, conflitsEnAttente, conflitsAValider]);

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
    onVoirSurCarte?.(conf, mode, { garderPanneau: true });
  };

  /* Choisir un conflit dans la liste : la liste se referme sur son détail, et
     la carte se rend sur lui (deux barrages, route). */
  const ouvrirDetail = (conf) => {
    setAnnonce(null);
    setDetailId(conf.id || conf.numero);
    onVoirSurCarte?.(conf, null, { garderPanneau: true });
  };

  /*
   * PASSAGE AU CONFLIT SUIVANT — après une assignation enregistrée : la liste
   * est relue (un conflit assigné entre-temps par un autre traitement est
   * reconnu, voir aAssignerPar), puis le détail passe au prochain conflit à
   * assigner de la même région. Plus rien : la liste, avec un message.
   */
  const assignationVue = useRef(null);
  const [avancer, setAvancer] = useState(null);
  useEffect(() => {
    if (!ouvert || !derniereAssignation?.ts || assignationVue.current === derniereAssignation.ts) return;
    assignationVue.current = derniereAssignation.ts;
    const faite = derniereAssignation;
    Promise.resolve(recharger()).finally(() => setAvancer(faite));
  }, [ouvert, derniereAssignation, recharger]);
  useEffect(() => {
    if (!avancer) return;
    setAvancer(null);
    const assigne = tousConflitsCombines.find((c) => (avancer.ids ?? []).includes(c.id) || (c.paireCle && (avancer.paires ?? []).includes(c.paireCle)));
    const nomFait = assigne ? `Conflit ${indexConflitMap.get(assigne.id) ?? indexConflitMap.get(assigne.paireCle) ?? ''}`.trim() : 'Le conflit';
    const chez = avancer.destinataire || (assigne ? libelleAssignation(assigne) : null);
    const suivant = prochainConflitAAssigner(tousConflitsCombines, avancer, session);
    if (suivant) {
      setDetailId(suivant.id || suivant.numero);
      setAnnonce({ type: 'suivant', texte: `${nomFait} assigné${chez ? ` à ${chez}` : ''}. Conflit suivant :` });
      onVoirSurCarte?.(suivant, null, { garderPanneau: true });
    } else {
      setDetailId(null);
      const portee = (avancer.regions ?? []).length ? ` pour CMD Région ${avancer.regions.join(' & ')}` : '';
      setAnnonce({ type: 'fin', texte: `${nomFait} assigné${chez ? ` à ${chez}` : ''}. Il n'y a plus de conflit à assigner${portee}.` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avancer]);

  const handleDesassigner = async (conf, e) => {
    e?.stopPropagation?.();
    try {
      if (onDesassigner) await onDesassigner(conf);
      else await API.desassignerConflit(conf.id);
      recharger();
    } catch (err) {
      setErreurAction({ id: conf.id, message: err?.message || 'Impossible de désassigner le conflit.' });
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
   * DÉCIDER — approuver tout de suite ; refuser exige un motif (saisi dans la
   * carte, voir ActionsConflit). L'état affiché est envoyé (`etatAttendu`) :
   * si un autre validateur est passé entre-temps, le serveur refuse (409) et
   * la liste est relue au lieu d'appliquer la décision à un état non vu.
   * Approuvé, le conflit passe directement à l'historique (serveur).
   */
  const handleDecider = async (conf, decision, e, raison = '') => {
    e?.stopPropagation?.();
    if (actionEnCours) return;
    if (decision === 'rejeter' && !raison.trim()) return;
    setActionEnCours(conf.id);
    setErreurAction(null);
    try {
      /* L'écriture d'abord : aucune animation ne précède ni ne retarde la
         réponse du serveur. */
      const r = await API.deciderConflit(conf.id, { decision, raison: raison.trim(), etatAttendu: conf.workflow?.etat ?? null });
      const approuve = decision !== 'rejeter';
      notifier({
        type: approuve ? 'succes' : 'info',
        titre: approuve ? 'Conflit approuvé' : 'Traitement rejeté',
        message: approuve
          ? `${conf.numero || conf.id} est archivé dans l’historique.`
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
   * LES BOUTONS D'UNE CARTE (voir ActionsConflit) — chaque clé renvoie au
   * geste existant du workflow : la modale d'assignation, celle de
   * transmission, le traitement, la décision. Aucun droit n'est décidé ici.
   */
  const executerAction = (cle, conf, { motif = '' } = {}) => {
    setErreurAction(null);
    switch (cle) {
      case 'assigner':
      case 'reassigner':
        onAssigner?.(conf);
        break;
      case 'desassigner':
        handleDesassigner(conf);
        break;
      case 'transmettre':
        onTransmettre?.(conf);
        break;
      case 'traiter':
      case 'traiter_direct':
        handlePrendreEnChargeEtTraiter(conf);
        break;
      case 'approuver':
        handleDecider(conf, 'approuver');
        break;
      case 'rejeter':
        handleDecider(conf, 'rejeter', null, motif);
        break;
      default:
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
      notifier({
        type: reussis === nb ? 'succes' : 'erreur',
        titre: reussis === nb ? 'Conflits assignés' : 'Assignation incomplète',
        message: `${reussis} sur ${nb} conflit(s) assigné(s) aux régions concernées.`,
      });
    } catch (err) {
      notifier({ type: 'erreur', titre: 'Assignation impossible', message: err?.message || 'Erreur lors de l’assignation groupée.' });
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

  const onglets = [
    ...(estAdmin ? [{ cle: 'non_assignes', libelle: 'Nouveaux', total: totalNonAssignes }] : []),
    { cle: 'en_attente', libelle: 'À traiter', total: totalEnAttente },
    { cle: 'a_valider', libelle: 'À valider', total: totalAValider },
    { cle: 'historique', libelle: 'Historique', total: totalHistorique },
  ];
  const VIDES = {
    non_assignes: ['Aucun nouveau conflit', 'Les conflits détectés et pas encore assignés apparaissent ici.'],
    en_attente: ['Rien à traiter', estAdmin ? 'Les conflits assignés aux CMD Région et CMD CIE apparaissent ici.' : 'Les conflits qui vous sont assignés apparaissent ici.'],
    a_valider: ['Aucun traitement à valider', estAdmin ? 'Les traitements soumis par les CMD Région et CMD CIE apparaîtront ici.' : 'Vos traitements soumis, en attente du Super Admin, apparaîtront ici.'],
  };

  const confDetail = detailId
    ? tousConflitsCombines.find((c) => c.id === detailId || c.numero === detailId || c.paireCle === detailId) ?? null
    : null;
  const indexDetail = confDetail ? tousConflitsCombines.indexOf(confDetail) : -1;
  /*
   * L'AXE ISOLÉ — l'ancienne barre flottante du haut de la carte, désormais
   * ici : la route, ses barrages, ses conflits, le sens, « Modifier » et
   * « Désactiver ». Visible dans la liste comme dans le détail.
   */
  const nbConflitsAxe = Array.isArray(conflitsCalculesRoute) ? conflitsCalculesRoute.length : null;
  const bandeauAxe = filtreRoute && (
    <div className="space-y-1.5 border-b border-gr-gold/25 bg-gr-gold/[0.07] px-4 py-2 text-[11px] text-white">
      <div className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-gr-gold" />
        <span className="text-white/65">Axe isolé :</span>
        <b className="font-mono uppercase text-gr-gold">{filtreRoute}</b>
        {barragesVisiblesCount != null && (
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10.5px] text-white/80">
            {barragesVisiblesCount} barrage{barragesVisiblesCount > 1 ? 's' : ''}
          </span>
        )}
        {nbConflitsAxe != null && (
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold ${
              nbConflitsAxe > 0 ? 'border-amber-500/40 bg-amber-500/20 text-amber-300' : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {nbConflitsAxe > 0 ? `⚠ ${nbConflitsAxe} conflit${nbConflitsAxe > 1 ? 's' : ''}` : '✓ Espacement respecté'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {[
          { id: SENS_TOUS, label: 'Tous', actif: 'bg-gr-gold text-gr-navy' },
          { id: SENS_ALLER, label: 'Aller ➔', actif: 'bg-sky-500 text-white' },
          { id: SENS_RETOUR, label: 'Retour ⬅', actif: 'bg-amber-500 text-gr-navy' },
        ].map((x) => (
          <button
            key={x.id}
            type="button"
            aria-pressed={(filtreSensRoute || SENS_TOUS) === x.id}
            disabled={!onChangerSensRoute}
            onClick={() => onChangerSensRoute?.(x.id)}
            className={`rounded px-2 py-0.5 text-[10.5px] font-bold transition-colors ${
              (filtreSensRoute || SENS_TOUS) === x.id ? x.actif : 'bg-white/5 text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            {x.label}
          </button>
        ))}
        <span className="flex-1" />
        {onOuvrirFiltreRoute && (
          <button type="button" onClick={onOuvrirFiltreRoute} className="rounded-lg bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/90 hover:bg-white/20">
            Modifier
          </button>
        )}
        {onEffacerFiltreRoute && (
          <button
            type="button"
            onClick={onEffacerFiltreRoute}
            title="Désactiver le filtre et afficher toutes les routes"
            className="rounded-lg bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-300 hover:bg-red-500/30"
          >
            Désactiver
          </button>
        )}
      </div>
    </div>
  );
  const bandeauAnnonce = annonce && (
    <div
      role="status"
      className={`flex items-start gap-2 border-b px-4 py-2 text-[11.5px] ${
        annonce.type === 'fin' ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200' : 'border-sky-500/25 bg-sky-500/10 text-sky-100'
      }`}
    >
      <span className="min-w-0 flex-1">{annonce.texte}</span>
      <button type="button" onClick={() => setAnnonce(null)} aria-label="Masquer ce message" className="shrink-0 text-white/50 hover:text-white">
        <IconClose size={11} />
      </button>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-label="Conflits"
      data-gr-chrome
      data-presence={presence.etat}
      data-depuis="haut"
      className="fixed z-[2000] flex w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-xl"
      style={{ top: position.top, left: position.left, maxHeight: `calc(100dvh - ${position.top + MARGE_MENU}px)` }}
    >
      {confDetail ? (
        <>
          {/* LE DÉTAIL : la liste est refermée, le conflit choisi et ses actions. */}
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setDetailId(null);
                setAnnonce(null);
              }}
              className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span aria-hidden="true">←</span> Tous les conflits
            </button>
            <button
              type="button"
              onClick={fermer}
              aria-label="Masquer les conflits"
              className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <IconClose size={12} />
              Masquer
            </button>
          </header>
          {bandeauAxe}
          {bandeauAnnonce}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {renderCarteConflit(confDetail, indexDetail >= 0 ? indexDetail : null)}
          </div>
        </>
      ) : (
      <>
      {/* EN-TÊTE : titre et « Masquer », rien d'autre */}
      <header className="shrink-0 space-y-3 border-b border-white/10 px-4 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-white">
              {estAdmin ? 'Conflits' : `Conflits à traiter (${compterATraiter(tousConflitsCombines, session)})`}
            </h2>
            <p className="truncate text-[11.5px] text-white/55">
              {estAdmin ? 'Super Admin' : estRegion ? `CMD Région ${session?.unite ?? ''}` : `CMD CIE ${session?.unite ?? ''}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={recharger}
              title="Actualiser la liste"
              aria-label="Actualiser la liste"
              className="grid size-8 place-items-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={fermer}
              aria-label="Masquer le panneau des conflits"
              className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <IconClose size={13} />
              Masquer
            </button>
          </div>
        </div>

        {/* LES FILES — compteurs des files réelles */}
        <div role="tablist" aria-label="Files des conflits" className="flex gap-1 rounded-xl bg-white/5 p-1">
          {onglets.map((o) => {
            const actif = ongletActif === o.cle;
            return (
              <button
                key={o.cle}
                type="button"
                role="tab"
                aria-selected={actif}
                onClick={() => setOngletActif(o.cle)}
                className={`flex min-w-0 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary ${
                  actif ? 'bg-gr-card text-white shadow-sm' : 'text-white/60 hover:text-white'
                }`}
              >
                <span className="truncate">{o.libelle}</span>
                {o.total > 0 && (
                  <span className={`rounded-full px-1 font-mono text-[9.5px] ${actif ? 'bg-gr-primary text-gr-primary-contrast' : 'bg-white/10 text-white/70'}`}>
                    <ValeurAnimee valeur={o.total} classe="gr-compteur-change">{o.total}</ValeurAnimee>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Recherche ; filtres et axe routier repliés derrière un bouton */}
        {ongletActif !== 'historique' && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <input
                type="search"
                value={filtres.texte}
                onChange={(e) => setFiltres((f) => ({ ...f, texte: e.target.value }))}
                placeholder="Rechercher un barrage, une route…"
                aria-label="Rechercher un conflit"
                className="min-w-0 flex-1 rounded-lg border border-border-default bg-gr-card px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:border-gr-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setFiltresOuverts((v) => !v)}
                aria-expanded={filtresOuverts}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold ${filtresActifs || parametresRoute?.route ? 'border-gr-primary/50 bg-gr-primary/12 text-gr-primary' : 'border-border-default bg-gr-card text-text-secondary hover:bg-gr-hover'}`}
              >
                Filtres{filtresActifs || parametresRoute?.route ? ' •' : ''}
              </button>
            </div>
            {filtresOuverts && (
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border-default bg-gr-card/60 p-2">
                <label className="text-[10.5px] text-text-muted">
                  Région
                  <select value={filtres.region} onChange={(e) => setFiltres((f) => ({ ...f, region: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11.5px] text-text-primary">
                    <option value="">Toutes</option>
                    {optionsFiltres.regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label className="text-[10.5px] text-text-muted">
                  Compagnie
                  <select value={filtres.compagnie} onChange={(e) => setFiltres((f) => ({ ...f, compagnie: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11.5px] text-text-primary">
                    <option value="">Toutes</option>
                    {optionsFiltres.cies.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label className="col-span-2 text-[10.5px] text-text-muted">
                  État
                  <select value={filtres.etat} onChange={(e) => setFiltres((f) => ({ ...f, etat: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11.5px] text-text-primary">
                    <option value="">Tous</option>
                    {Object.entries(LIBELLES_ETATS)
                      .filter(([k]) => !['APPROVED', 'FOLLOW_UP', 'CLOSED'].includes(k))
                      .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="text-[10.5px] text-text-muted">
                  Du
                  <input type="date" value={filtres.du} onChange={(e) => setFiltres((f) => ({ ...f, du: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11.5px] text-text-primary" />
                </label>
                <label className="text-[10.5px] text-text-muted">
                  Au
                  <input type="date" value={filtres.au} onChange={(e) => setFiltres((f) => ({ ...f, au: e.target.value }))} className="mt-0.5 w-full rounded-md border border-border-default bg-gr-card px-1.5 py-1 text-[11.5px] text-text-primary" />
                </label>
                {onOuvrirFiltreRoute && (
                  <button
                    type="button"
                    onClick={onOuvrirFiltreRoute}
                    className="col-span-2 flex items-center justify-center gap-1.5 rounded-md border border-border-default px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-gr-hover"
                  >
                    <IconRoute size={12} />
                    {parametresRoute?.route ? `Axe routier : ${parametresRoute.route}` : 'Filtrer par axe routier'}
                  </button>
                )}
                {filtresActifs && (
                  <button
                    type="button"
                    onClick={() => setFiltres({ texte: '', region: '', compagnie: '', etat: '', du: '', au: '' })}
                    className="col-span-2 rounded-md border border-border-default px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-gr-hover"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            )}

          </div>
        )}
      </header>
      {bandeauAxe}
      {bandeauAnnonce}

      {/* LISTE DE LA FILE CHOISIE */}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2.5">
        {!charge && (
          <div role="status" aria-label="Chargement des conflits" className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-border-default p-3">
                <span className="gr-squelette block h-5 w-28" />
                <span className="gr-squelette block h-4 w-3/4" />
                <span className="gr-squelette block h-8 w-full" />
              </div>
            ))}
          </div>
        )}

        {erreur && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12px] text-red-300">
            {erreur}
          </div>
        )}

        {charge && !erreur && ongletActif === 'historique' && (
          <HistoriqueConflits session={session} version={version} onVoirSurCarte={onVoirSurCarte} onRouvert={recharger} />
        )}

        {charge && !erreur && ongletActif !== 'historique' && (
          <>
            {/* Super Admin : sélection multiple et actions groupées, discrètes */}
            {estAdmin && conflitsOngletActif.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-1 text-[11.5px]">
                <label className="flex min-w-0 cursor-pointer select-none items-center gap-2 text-white/65">
                  <input
                    type="checkbox"
                    checked={tousSelectionnes}
                    ref={(el) => {
                      if (el) el.indeterminate = selectionIdsDansOnglet.size > 0 && !tousSelectionnes;
                    }}
                    onChange={toggleSelectionnerTout}
                    aria-label="Sélectionner tous les conflits de cette liste"
                    className="size-4 shrink-0 cursor-pointer accent-gr-primary"
                  />
                  <span className="truncate">
                    {selectionIdsDansOnglet.size > 0 ? `${selectionIdsDansOnglet.size} sélectionné(s)` : `${conflitsOngletActif.length} conflit(s)`}
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  {selectionIdsDansOnglet.size > 0 ? (
                    <>
                      {(ongletActif === 'non_assignes' || ongletActif === 'en_attente') && onAssigner && (
                        <button
                          type="button"
                          onClick={() => {
                            const selectionnes = conflitsOngletActif.filter((c) => selectionIds.has(c.id || c.numero || c.paireCle));
                            if (selectionnes.length > 0) onAssigner(selectionnes);
                          }}
                          className="font-semibold text-gr-primary hover:underline"
                        >
                          Assigner
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const selectionnes = conflitsOngletActif.filter((c) => selectionIds.has(c.id || c.numero || c.paireCle));
                          if (selectionnes.length > 0) setConflitsASupprimerGroupe(selectionnes);
                        }}
                        className="font-semibold text-red-300 hover:underline"
                      >
                        Supprimer
                      </button>
                      <button type="button" onClick={deselectionnerTout} className="text-white/50 hover:text-white">
                        Annuler
                      </button>
                    </>
                  ) : (
                    ongletActif === 'non_assignes' && (
                      <button
                        type="button"
                        disabled={assignationEnMasseEnCours}
                        onClick={handleAssignerTout}
                        title="Assigner chaque conflit au CMD Région concerné"
                        className="flex items-center gap-1 font-semibold text-gr-primary hover:underline disabled:opacity-50"
                      >
                        {assignationEnMasseEnCours && <IconSpinner size={11} />}
                        Assigner tout
                      </button>
                    )
                  )}
                </div>
              </div>
            )}

            {conflitsOngletActif.length === 0 ? (
              <div className="space-y-1 rounded-xl border border-dashed border-white/10 p-6 text-center">
                <p className="text-[13px] font-semibold text-white/80">{VIDES[ongletActif]?.[0]}</p>
                <p className="text-[11.5px] text-white/55">{VIDES[ongletActif]?.[1]}</p>
              </div>
            ) : (
              <div className="space-y-1">
                {conflitsOngletActif.map((conf, idx) => envelopper(conf, renderLigneConflit(conf, idx)))}
              </div>
            )}
          </>
        )}
      </div>
      </>
      )}

      {/* COMPARATIF AVANT / APRÈS d'un traitement (ouvert depuis « Détails ») */}
      {conflitAgrandir && (
        <ModalComparatifAvantApres
          conflit={conflitAgrandir}
          session={session}
          onClose={() => setConflitAgrandir(null)}
          onApprouver={(c) => handleDecider(c, 'approuver')}
          onRejeter={(c) => setDemandesRejet((d) => ({ ...d, [c.id]: (d[c.id] ?? 0) + 1 }))}
          onVoirSurCarte={handleVoirSurCarte}
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
    </div>
  );

  /**
   * UNE LIGNE DE LA LISTE — compacte : numéro, barrages, statut et à qui il
   * est remis. Un clic montre le détail (et ses actions) à la place de la liste.
   */
  function renderLigneConflit(conf, index) {
    const id = conf.id || conf.numero;
    const bA = conf.a || conf.barrageA;
    const bB = conf.b || conf.barrageB;
    const numero =
      indexConflitMap.get(id) || (conf.paireCle && indexConflitMap.get(conf.paireCle)) || (index != null ? index + 1 : 1);
    const etat = etatListeConflit(conf, session);
    const distance = Number(conf.distanceKm ?? conf.km ?? 0);
    return (
      <div className="flex items-stretch gap-1.5">
        {estAdmin && (
          <input
            type="checkbox"
            checked={selectionIds.has(id) || Boolean(conf.paireCle && selectionIds.has(conf.paireCle))}
            onChange={() => toggleSelection(conf)}
            aria-label={`Sélectionner le conflit ${numero}`}
            className="mt-3 size-4 shrink-0 cursor-pointer accent-gr-primary"
          />
        )}
        <button
          type="button"
          onClick={() => ouvrirDetail(conf)}
          className="min-w-0 flex-1 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-white">Conflit {numero}</span>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${BADGE_STATUT[etat.code] ?? BADGE_STATUT.a_traiter}`}>
              {etat.libelle}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-white/85">
            <span className="truncate">{bA?.nom || bA?.id || 'Barrage A'}</span>
            <span aria-label="vers" className="shrink-0 text-white/35">→</span>
            <span className="truncate">{bB?.nom || bB?.id || 'Barrage B'}</span>
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-white/50">
            <span className="truncate">{etat.assignation ?? getRegionConflit(conf)}</span>
            {distance > 0 && <span className="shrink-0 font-mono">{distance.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km</span>}
          </span>
        </button>
      </div>
    );
  }

  /**
   * UNE CARTE DE CONFLIT — ce qu'il faut pour décider, rien de plus :
   *
   *   Conflit 1                      [statut]
   *   Région Rabat
   *   Barrage A → Barrage B
   *   Distance routière : 13,1 km
   *   (à qui il est assigné, s'il l'est)
   *   [Voir sur carte] [action du rôle]
   *
   * Identifiants, seuil, état technique, parcours et suppression : sous
   * « Détails ».
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
    const statut = etatListeConflit(conf, session);
    const aUnTraitement = Boolean(conf.changement || conf.traitement);

    return (
      <article
        key={id}
        ref={(el) => (cardRefs.current[id] = el)}
        className={`space-y-2.5 rounded-2xl border p-3.5 transition-colors ${
          estVise ? 'border-gr-gold bg-gr-gold/10 ring-1 ring-gr-gold/40' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {estAdmin && (
              <input
                type="checkbox"
                checked={selectionIds.has(id) || (conf.paireCle && selectionIds.has(conf.paireCle))}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSelection(conf);
                }}
                aria-label={`Sélectionner le conflit ${numeroAffiche}`}
                className="size-4 shrink-0 cursor-pointer accent-gr-primary"
              />
            )}
            <h3 className="text-[14px] font-bold text-white">Conflit {numeroAffiche}</h3>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${BADGE_STATUT[statut.code]}`}>
            {statut.libelle}
          </span>
        </div>

        <dl className="space-y-1 text-[12.5px]">
          <dt className="sr-only">Région</dt>
          <dd className="font-medium text-white/70">{getRegionConflit(conf)}</dd>
          <dt className="sr-only">Barrages</dt>
          <dd className="flex min-w-0 items-center gap-1.5 font-semibold text-white">
            <span className="truncate" title={nomA}>{nomA}</span>
            <span aria-label="vers" className="shrink-0 text-white/40">→</span>
            <span className="truncate" title={nomB}>{nomB}</span>
          </dd>
          <dd className="text-white/70">
            Distance routière : <b className="font-semibold text-white">{distance.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km</b>
          </dd>
        </dl>

        <ActionsConflit
          conf={conf}
          session={session}
          onAction={executerAction}
          onVoirSurCarte={(c) => handleVoirSurCarte(c, null, 'comparer')}
          enCours={actionEnCours === conf.id}
          erreur={erreurAction?.id === conf.id ? erreurAction.message : null}
          demandeRejet={demandesRejet[conf.id] ?? 0}
        />

        <div className="border-t border-white/5 pt-1.5">
          <button
            type="button"
            aria-expanded={detailsOuvert}
            onClick={() => toggleDetails(id)}
            className="text-[11px] font-medium text-white/50 transition-colors hover:text-white/80"
          >
            {detailsOuvert ? 'Masquer les détails' : 'Détails'}
          </button>

          {detailsOuvert && (
            <div className="mt-2 space-y-2.5 rounded-xl border border-white/5 bg-black/20 p-2.5 text-[11px] text-white/70">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-white/45">Référence</dt>
                <dd className="select-all truncate font-mono text-white/80">{conf.numero && conf.numero !== id ? `${conf.numero} · ${id}` : id}</dd>
                <dt className="text-white/45">Axe routier</dt>
                <dd className="font-mono">{conf.route || bA?.route || bB?.route || '—'}</dd>
                <dt className="text-white/45">Seuil</dt>
                <dd>{conf.seuilKm || 20} km</dd>
                {conf.workflow?.etat && (
                  <>
                    <dt className="text-white/45">État</dt>
                    <dd>{LIBELLES_ETATS[conf.workflow.etat] ?? conf.workflow.etat}</dd>
                  </>
                )}
                {conf.assignation?.assignePar && (
                  <>
                    <dt className="text-white/45">Assigné par</dt>
                    <dd>
                      {auteurAssignation(conf)}
                      {conf.assignation.assigneLe
                        ? ` · ${new Date(conf.assignation.assigneLe).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`
                        : ''}
                    </dd>
                  </>
                )}
                {conf.workflow?.responsable && (
                  <>
                    <dt className="text-white/45">Responsable</dt>
                    <dd>{conf.workflow.responsable.rang === 'cie' ? 'CMD CIE' : 'CMD Région'} {conf.workflow.responsable.unite}</dd>
                  </>
                )}
              </dl>
              {aUnTraitement && (
                <button
                  type="button"
                  onClick={() => setConflitAgrandir(conf)}
                  className="font-semibold text-gr-primary hover:underline"
                >
                  Comparer avant / après le traitement
                </button>
              )}
              {conf.historique?.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-semibold text-white/60">Actions effectuées</p>
                  <ChronologieConflit conf={conf} />
                </div>
              )}
              {peutSupprimer(conf) && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setConflitASupprimer(conf)}
                    className="font-semibold text-red-300 hover:underline"
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
  FOLLOW_UP: 'Validé',
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
