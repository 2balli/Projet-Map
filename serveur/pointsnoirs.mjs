/**
 * Importance d'un point noir (marquage de nature `accident`).
 *
 * MÊME RÈGLE que dans `src/marquages.js`, dupliquée à dessein : ici pour
 * sélectionner les candidats à la génération automatique de barrages, là-bas
 * pour l'affichage (badge « important », halo sur la carte). Si les deux
 * divergent, c'est cette version — utilisée pour créer des barrages — qui
 * prime : à corriger en premier, puis répercuter côté client.
 */

const SEVERITES_ELEVEES = new Set(['high', 'critical']);

/**
 * Au-delà de ce nombre d'accidents relevés, le lieu sort de l'ordinaire.
 *
 * C'était déjà la valeur par défaut de `estImportant` ci-dessous ; elle est
 * simplement NOMMÉE ici pour que le badge « A » de la carte et la génération
 * automatique de barrages s'appuient sur le même nombre. Deux 5 écrits à deux
 * endroits finissent toujours par diverger.
 */
export const SEUIL_ACCIDENTS_NORMAL = 5;

/**
 * Ce poste relève-t-il un nombre d'accidents anormal ?
 *
 * C'est la moitié « accidents » de `estImportant`, isolée — et rien de plus.
 * `estImportant` juge l'importance d'un lieu sur cinq facteurs à la fois
 * (accidents, sévérité, activité, infractions, position en ville) : s'en servir
 * pour un badge d'ACCIDENT ferait porter un « A » à un poste d'entrée de ville
 * qui n'a jamais rien connu. Le badge doit dire ce qu'il montre.
 */
export function accidentsAuDessusDuNormal(m) {
  return (m?.accidentCount ?? 0) >= SEUIL_ACCIDENTS_NORMAL || SEVERITES_ELEVEES.has(m?.severite);
}

/** Poids de la note d'importance : ne sert qu'à trier, pas à filtrer. */
const POIDS_SEVERITE = { none: 0, moderate: 2, high: 4, critical: 6 };
const POIDS_NIVEAU = { low: 0, medium: 2, high: 4 };
const ORDRE_NIVEAU = { low: 0, medium: 1, high: 2 };

/**
 * Un point noir « important » : nombre d'accidents dans la plage choisie, OU
 * une sévérité élevée/critique, OU une activité/infraction au moins au niveau
 * du seuil choisi, OU une position entrée/sortie de ville (sauf si
 * volontairement ignorée). Ces seuils sont ceux du filtre proposé côté client
 * avant de lancer la génération (`POST /api/marquages/generer`) ; sans
 * réglage explicite, ce sont les mêmes valeurs par défaut qui servent au
 * badge « important ».
 */
export function estImportant(
  m,
  {
    seuilAccidentsMin = SEUIL_ACCIDENTS_NORMAL,
    seuilAccidentsMax = Infinity,
    seuilActivite = 'high',
    seuilInfraction = 'high',
    considererPositionVille = true,
  } = {}
) {
  const accidents = m.accidentCount ?? 0;
  return (
    (accidents >= seuilAccidentsMin && accidents <= seuilAccidentsMax) ||
    SEVERITES_ELEVEES.has(m.severite) ||
    (ORDRE_NIVEAU[m.activite] ?? 0) >= (ORDRE_NIVEAU[seuilActivite] ?? 2) ||
    (ORDRE_NIVEAU[m.infraction] ?? 0) >= (ORDRE_NIVEAU[seuilInfraction] ?? 2) ||
    (considererPositionVille && m.positionVille && m.positionVille !== 'none')
  );
}

/** Note de tri pour la génération automatique — priorité au score le plus haut. */
export function scoreImportance(m) {
  return (
    (m.accidentCount ?? 0) +
    (POIDS_SEVERITE[m.severite] ?? 0) +
    (POIDS_NIVEAU[m.activite] ?? 0) +
    (POIDS_NIVEAU[m.infraction] ?? 0) +
    (m.positionVille && m.positionVille !== 'none' ? 3 : 0)
  );
}
