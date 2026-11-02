/**
 * LES POSTES QU'AUCUNE OPTIMISATION NE TOUCHE.
 *
 * Ce module ne contient QUE la règle de protection. Il remplace
 * `serveur/optimisationAuto.mjs`, qui portait l'ancien moteur d'optimisation —
 * celui qui raisonnait en kilomètres et répondait par un RETRAIT.
 *
 * POURQUOI CE MOTEUR A ÉTÉ SUPPRIMÉ, ET NON SIMPLEMENT DÉBRANCHÉ. Il décidait
 * d'écarter un poste sur des critères que le commandement a explicitement
 * écartés : distance en mètres, « même axe », « même rôle », priorité,
 * couverture, accidents, éclairage, pourcentage de réduction. Le laisser en
 * place, même sans appelant, aurait laissé deux algorithmes d'optimisation
 * automatique dans le dépôt — et le prochain qui aurait cherché « l'algorithme »
 * serait tombé sur le mauvais. Il n'en existe plus qu'un :
 * `serveur/optimisationTrajet.mjs`, qui mesure un temps de trajet routier et ne
 * retire jamais rien.
 *
 * CE QUI SURVIT ICI est la seule chose que la nouvelle optimisation lui
 * empruntait : la liste des motifs qui mettent un poste hors d'atteinte. Elle
 * est inchangée, et elle reste alignée sur la consolidation MANUELLE, qui nomme
 * les mêmes motifs (voir la route `consolidation` et
 * `src/statistiquesOptimisation.js`).
 */
import { estObligatoire } from './distances.mjs';
import { estIntouchable } from './depot.mjs';

const PORTES_ENTREE = ['entree', 'porte'];
const PORTES_SORTIE = ['sortie', 'porte'];

/**
 * Ce que chaque motif de protection veut dire, en clair.
 *
 * Écrit ICI et non dans l'interface : le motif part aussi dans le rapport
 * d'optimisation et dans la notification de validation, qui se lisent sans
 * navigateur. Une seule traduction pour les trois.
 */
export const LIBELLE_PROTECTION = {
  intouchable: 'barrage fixe intouchable (point permanent)',
  entree_ville: 'entrée de ville',
  sortie_ville: 'sortie de ville',
  vip: 'VIP / mission',
  accidents: 'accidents au-dessus du seuil',
  non_eclaire: 'axe non éclairé',
  protege_manuellement: 'protégé manuellement',
  exclu_optimisation: 'exclu de l’optimisation',
};

/**
 * POURQUOI CE POSTE NE PEUT PAS ÊTRE TOUCHÉ — la liste des motifs, jamais un
 * simple booléen : celui qui lit la proposition veut savoir LAQUELLE des règles
 * s'applique, sinon il doit la retrouver lui-même.
 *
 * PORTES DE VILLE ET MISSIONS SONT PROTÉGÉES SANS INTERRUPTEUR — c'est la règle
 * `estObligatoire` de serveur/distances.mjs, déjà appliquée par la consolidation
 * manuelle. Accidents et éclairage restent commandés par leur bascule : éteinte,
 * le caractère existe toujours sur le poste mais n'a pas été invoqué.
 *
 * Deux motifs viennent de l'utilisateur lui-même, et d'aucun calcul :
 * `protege_manuellement` (le poste porte déjà `decisionOptimisation: 'conserve'`)
 * et `exclu_optimisation` (il l'a retiré de CETTE analyse).
 *
 * CES MOTIFS NE FONT PLUS RETIRER PERSONNE. L'optimisation automatique ne
 * retire plus rien : ils empêchent seulement qu'un poste soit DÉPLACÉ ou
 * RÉAFFECTÉ. Sa position ou son horaire lui viennent d'une contrainte de
 * terrain, pas d'un réglage.
 */
export function protectionsDe(m, { accidents, seuilAccidents, vip, nonEclaire, exclus } = {}) {
  const protections = [];
  if (estIntouchable(m)) protections.push('intouchable');
  if (PORTES_ENTREE.includes(m?.positionVille)) protections.push('entree_ville');
  if (PORTES_SORTIE.includes(m?.positionVille)) protections.push('sortie_ville');
  /* `estObligatoire` = porte de ville OU mission. Les portes viennent d'être
     nommées par leurs deux faces ; reste la mission, qui protège toujours. */
  if (m?.exceptionnel === true || m?.missionId) protections.push('vip');
  if (accidents && (Number(m?.accidentCount) || 0) >= (Number(seuilAccidents) || 0)) {
    protections.push('accidents');
  }
  if (nonEclaire && m?.eclairage === 'non') protections.push('non_eclaire');
  if (m?.decisionOptimisation === 'conserve') protections.push('protege_manuellement');
  if (exclus?.has(m?.id)) protections.push('exclu_optimisation');
  /* `vip` n'ajoute aucun motif de son côté : la bascule est lue pour rester
     cohérente avec le panneau, mais la protection de mission ne dépend pas
     d'elle — voir le commentaire ci-dessus. */
  void vip;
  void estObligatoire;
  return protections;
}
