/**
 * DÉTECTION DES NOUVEAUX CONFLITS — qu'est-ce qui mérite l'impulsion radar ?
 *
 * LA SOURCE : les conflits ENREGISTRÉS par le serveur (GET /api/conflits),
 * relus quand le flux temps réel annonce un événement, et à intervalle
 * régulier sinon. Le serveur les crée lui-même après une opération réelle
 * (déplacement, changement de faction, assignation… — voir
 * `actualiserApresOperation`, serveur/suiviConflits.mjs) et ne renvoie que
 * ceux du périmètre du compte : rien n'est inventé ici, et rien n'échappe au
 * cloisonnement. Les conflits CALCULÉS dans la page (optimisation, filtration
 * par route) n'en font pas partie : l'utilisateur vient de les demander.
 *
 * CE QUI EST « NOUVEAU » : un événement de DÉTECTION que l'on n'a pas encore
 * vu pendant cette session —
 *   — un identifiant jamais vu ;
 *   — ou un conflit connu dont la DERNIÈRE détection (historique « detection »
 *     ou « reouverture ») est plus récente : il vient de réapparaître.
 * La signature d'un événement est « identifiant @ date de détection » : la
 * même détection n'est jamais annoncée deux fois, quel que soit le nombre de
 * relectures, de rendus, de changements de thème.
 *
 * PAS À L'OUVERTURE DE LA PAGE : la première liste reçue sert de référence
 * (amorçage) — tout ce qu'elle contient est réputé connu. Recharger la page ne
 * rejoue donc rien.
 *
 * Calcul pur, sans DOM : éprouvé par `npm run check:radar`.
 */

const ACTIONS_DETECTION = new Set(['detection', 'reouverture']);

/** Statuts d'un conflit qui attend encore d'être pris en charge. */
const STATUTS_ACTIFS = new Set(['nouveau', 'a_traiter', 'en_cours']);

/** Date de la dernière détection (ou réapparition) — la « version » de l'événement. */
export function dateDetection(c) {
  const dates = (c?.historique ?? [])
    .filter((h) => ACTIONS_DETECTION.has(h?.action) && h.date)
    .map((h) => h.date)
    .sort();
  return dates.at(-1) ?? c?.cree ?? null;
}

export const signatureDetection = (c) => `${c?.id}@${dateDetection(c) ?? '?'}`;

/** Un conflit qui attend une prise en charge (ni soumis, ni clos, ni résolu). */
export const estActif = (c) => STATUTS_ACTIFS.has(c?.statut) && !c?.approbation;

const fini = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);
const RAYON_TERRE_M = 6_371_000;
const RAD = Math.PI / 180;
const distanceM = (a, b) => {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.sqrt(h));
};

/**
 * OÙ ANIMER — le point du conflit et sa zone.
 *
 *   deux postes situés : le milieu, et une zone qui les contient tous deux ;
 *   un seul poste situé : ce poste, zone réduite ;
 *   aucun : `null` — pas d'animation sur la carte (la carte ne devine pas une
 *           position), la notification reste, sans « Voir sur la carte ».
 *
 * @returns {{ centre: [number, number], rayonM: number, postes: Array<[number, number]> } | null}
 */
export function positionConflit(c) {
  const postes = [c?.barrageA ?? c?.a, c?.barrageB ?? c?.b].filter(fini);
  if (!postes.length) return null;
  if (postes.length === 1) return { centre: [postes[0].lat, postes[0].lng], rayonM: 1200, postes: [[postes[0].lat, postes[0].lng]] };
  const [a, b] = postes;
  return {
    centre: [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2],
    /* La moitié de l'écart, plus une marge : la zone contient les deux postes. */
    rayonM: Math.max(1500, distanceM(a, b) / 2 + 900),
    postes: [[a.lat, a.lng], [b.lat, b.lng]],
  };
}

/** Libellé du type de conflit, pour la notification. */
export function typeConflit(c) {
  return {
    distance_insuffisante: 'Espacement insuffisant',
    doublon_position: 'Doublon de position',
  }[c?.type] ?? 'Conflit d’espacement';
}

/**
 * OÙ EN EST UN CONFLIT DÉTECTÉ — l'indicateur de son repère sur la carte.
 *
 * Lecture seule des champs du workflow existant (aucun statut n'est créé ni
 * modifié) :
 * L'état du workflow (`workflow.etat`) fait foi quand le serveur le donne ;
 * sinon (conflit calculé, ancien format) les anciens champs :
 *   nouveau        statut « nouveau », ni assigné ni encore consulté → rouge,
 *                  pulsation discrète jusqu'à sa prise en compte ;
 *   en_attente     assigné (« a_traiter », assigné à un CMD), renvoyé pour
 *                  correction (REFUSE_*), ou consulté sans être assigné → ambre ;
 *   en_traitement  statut « en_cours » → bleu, arc animé ;
 *   traite         soumis à validation (EN_ATTENTE_*), « traite » → neutre, immobile ;
 *   null           approuvé (APPROUVE_FINAL), clos, résolu → le repère disparaît.
 *
 * @param {object} c       le conflit tel que le serveur le présente (avec `workflow`)
 * @param {{ pris?: boolean }} o  `pris` : l'utilisateur l'a ouvert (« Voir sur la carte »)
 */
export const PHASES = Object.freeze({
  NOUVEAU: 'nouveau',
  EN_ATTENTE: 'en_attente',
  EN_TRAITEMENT: 'en_traitement',
  TRAITE: 'traite',
});

export const LIBELLES_PHASE = Object.freeze({
  nouveau: 'Nouveau',
  en_attente: 'En attente de traitement',
  en_traitement: 'En cours de traitement',
  traite: 'Traité — en validation',
});

/** État du workflow (serveur/workflowConflits.mjs) → indicateur du repère. */
const PHASE_DE_L_ETAT = {
  ASSIGNED_REGION: PHASES.EN_ATTENTE,
  ASSIGNED_CIE: PHASES.EN_ATTENTE,
  REJECTED: PHASES.EN_ATTENTE,
  IN_PROGRESS_REGION: PHASES.EN_TRAITEMENT,
  IN_PROGRESS_CIE: PHASES.EN_TRAITEMENT,
  PENDING_VALIDATION: PHASES.TRAITE,
  /* Validé, en suivi, clôturé : plus d'indicateur actif sur la carte. */
  APPROVED: null,
  FOLLOW_UP: null,
  CLOSED: null,
};

export function phaseConflit(c, { pris = false } = {}) {
  if (!c) return null;
  const etat = c.workflow?.etat ?? c.etat ?? null;
  if (etat === 'NEW') return pris ? PHASES.EN_ATTENTE : PHASES.NOUVEAU;
  if (etat && etat in PHASE_DE_L_ETAT) return PHASE_DE_L_ETAT[etat];
  /* Sans état de workflow (conflit calculé, ancien format) : anciens champs. */
  const approbation = c.approbation?.statut ?? null;
  if (etat === 'APPROUVE_FINAL' || approbation === 'approuve') return null;
  if (c.statut === 'cloture' || c.statut === 'resolu') return null;
  if (/^EN_ATTENTE_/.test(etat ?? '') || /^en_attente_/.test(approbation ?? '')) return PHASES.TRAITE;
  if (c.statut === 'traite') return PHASES.TRAITE;
  if (c.statut === 'en_cours') return PHASES.EN_TRAITEMENT;
  if (/^REFUSE_/.test(etat ?? '') || /^rejete_/.test(approbation ?? '')) return PHASES.EN_ATTENTE;
  const assigne = c.statut === 'a_traiter' || Boolean(c.assigneA || c.assigneCie || c.assignesA?.length);
  if (assigne || pris) return PHASES.EN_ATTENTE;
  return PHASES.NOUVEAU;
}

/** Au plus autant d'impulsions simultanées — les plus récentes. */
export const MAX_IMPULSIONS = 3;

/** Au plus autant de pulsations de veille (conflits nouveaux non consultés). */
export const MAX_VEILLES = 12;

/**
 * Le détecteur d'une session : `observer(liste)` à chaque liste reçue.
 *
 * @returns {{ observer: (liste: object[]) => { nouveaux: object[], animes: object[] }, estAmorce: () => boolean }}
 *   `nouveaux` : tous les conflits nouvellement détectés et actifs, du plus
 *   récent au plus ancien ; `animes` : ceux qui reçoivent l'impulsion (au plus
 *   MAX_IMPULSIONS, et seulement s'ils sont situés).
 */
export function creerDetecteur({ maxImpulsions = MAX_IMPULSIONS } = {}) {
  let amorce = false;
  const vues = new Set();

  return {
    estAmorce: () => amorce,
    observer(liste) {
      const conflits = (Array.isArray(liste) ? liste : []).filter((c) => c?.id);
      if (!amorce) {
        for (const c of conflits) vues.add(signatureDetection(c));
        amorce = true;
        return { nouveaux: [], animes: [] };
      }
      const nouveaux = [];
      for (const c of conflits) {
        const s = signatureDetection(c);
        if (vues.has(s)) continue;
        vues.add(s);
        if (estActif(c)) nouveaux.push(c);
      }
      nouveaux.sort((x, y) => String(dateDetection(y) ?? '').localeCompare(String(dateDetection(x) ?? '')));
      return { nouveaux, animes: nouveaux.filter((c) => positionConflit(c)).slice(0, maxImpulsions) };
    },
  };
}
