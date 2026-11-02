/**
 * L'ÉTAT D'UN CONFLIT — une seule définition pour le panneau et la carte.
 *
 * Le panneau latéral classe les conflits en trois onglets (Traités, En
 * attente, Non assignés). La carte, elle, doit savoir si une paire de postes
 * est un conflit ACTIF au sens de ce panneau : c'est ce qui décide si le
 * tracé rouge « après déplacement » est dessiné (voir `routesRepositionnement`
 * dans GendarmerieMap.jsx). Deux définitions finiraient par diverger, et la
 * carte montrerait un conflit que le panneau ne liste pas — précisément le
 * défaut qui a motivé ce module.
 *
 * Calcul pur, vérifiable sous Node : `npm run check:etat-conflits`.
 */
import { clePaire } from './conflitsIdentifies.js';

/**
 * TRAITÉ = SOUMIS (en validation) OU CLOS. Un conflit REFUSÉ pour correction
 * n'est pas traité : il est de nouveau à traiter par le CMD Compagnie.
 *
 * Pour un conflit enregistré, l'état de workflow calculé par le serveur
 * (`workflow.etat`, voir serveur/workflowConflits.mjs) fait foi ; les
 * indices historiques ne servent qu'aux objets qui ne le portent pas.
 */
/* Workflow (serveur/workflowConflits.mjs) : traité = soumis à validation, validé,
   en suivi ou clôturé. Les anciens noms d'état restent reconnus. */
const ETATS_TRAITES = new Set(['PENDING_VALIDATION', 'APPROVED', 'FOLLOW_UP', 'CLOSED', 'EN_ATTENTE_CMD_REGION', 'EN_ATTENTE_SUPERADMIN', 'APPROUVE_FINAL']);
const ETATS_ASSIGNES = new Set(['ASSIGNED_REGION', 'IN_PROGRESS_REGION', 'ASSIGNED_CIE', 'IN_PROGRESS_CIE', 'REJECTED']);
export const estConflitTraite = (c) => {
  const etat = c?.workflow?.etat;
  if (etat) return ETATS_TRAITES.has(etat);
  if (c?.statut === 'cloture') return true;
  if (c?.statut === 'a_corriger' || /^rejete/.test(c?.approbation?.statut ?? '')) return false;
  return Boolean(
    c?.statut === 'traite' ||
    c?.statut === 'resolu' ||
    c?.traitement ||
    c?.traiteLe ||
    c?.approbation,
  );
};

/** Assigné (CMD Région ou CMD Cie) et toujours en attente de traitement. */
export const estConflitAssigne = (c) => {
  if (c?.workflow?.etat) return ETATS_ASSIGNES.has(c.workflow.etat);
  if (estConflitTraite(c)) return false;
  return Boolean(
    c?.assigneA ||
    c?.assigneCie ||
    (Array.isArray(c?.assignesA) && c.assignesA.length > 0) ||
    c?.statut === 'a_traiter' ||
    c?.statut === 'en_cours' ||
    c?.estAssigne,
  );
};

/** Ni assigné ni traité. */
export const estConflitNonAssigne = (c) => !estConflitTraite(c) && !estConflitAssigne(c);

/** Les deux postes d'un conflit, quelle que soit la forme de l'objet. */
const postes = (c) => [
  c?.barrageAId ?? c?.barrageA?.id ?? c?.a?.id,
  c?.barrageBId ?? c?.barrageB?.id ?? c?.b?.id,
];

/** « C-12 » est un numéro d'affichage relatif, pas un identifiant stable. */
const estIdentifiantRelatif = (v) => !v || /^C-\d+$/i.test(String(v).trim());

/**
 * Une paire supprimée, sous toutes les formes de clé que le serveur et le
 * panneau emploient (« a|b », « a::b », « conf_calc_a|b », identifiant).
 */
export function estPaireSupprimee(supprimes, a, b, id = null) {
  if (!supprimes?.size) return false;
  const cle = clePaire(a, b);
  if (supprimes.has(cle) || supprimes.has(`conf_calc_${cle}`)) return true;
  if (supprimes.has(`${a}::${b}`) || supprimes.has(`${b}::${a}`)) return true;
  return Boolean(id && !estIdentifiantRelatif(id) && supprimes.has(String(id).trim()));
}

/**
 * LES PAIRES EN CONFLIT ACTIF — celles que le panneau range sous « En
 * attente » ou « Non assignés ».
 *
 * Même fusion que le panneau : les conflits enregistrés par le serveur font
 * foi pour leur paire (un conflit traité le reste, même si l'optimisation le
 * redétecte) ; les conflits détectés (optimisation, filtration par route)
 * n'ajoutent que les paires que le serveur ne connaît pas. Une paire
 * supprimée n'existe plus ; une paire CLOSE (approuvée définitivement) est à
 * l'historique, même redétectée.
 *
 * @param {{ serveur?: object[], detectes?: Array<object[]|null|undefined>, supprimes?: Set<string>, clos?: Set<string> }} sources
 * @returns {Set<string>} clés `clePaire(a, b)`
 */
export function pairesConflitActives({ serveur = [], detectes = [], supprimes = new Set(), clos = new Set() } = {}) {
  const parPaire = new Map();
  for (const c of serveur ?? []) {
    const [a, b] = postes(c);
    if (!a || !b || estPaireSupprimee(supprimes, a, b, c.id)) continue;
    parPaire.set(clePaire(a, b), c);
  }
  for (const liste of detectes) {
    for (const c of liste ?? []) {
      const [a, b] = postes(c);
      if (!a || !b || estPaireSupprimee(supprimes, a, b, c.id)) continue;
      const cle = clePaire(a, b);
      if (!parPaire.has(cle) && !clos.has(cle)) parPaire.set(cle, c);
    }
  }
  const actives = new Set();
  for (const [cle, c] of parPaire) if (!estConflitTraite(c)) actives.add(cle);
  return actives;
}
