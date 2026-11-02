/**
 * Palette de la carte — source unique.
 *
 * Deux familles, et la distinction est structurante :
 *
 *   DONNÉES OPÉRATIONNELLES — teintes franches et très séparées. Chaque couleur
 *   porte une information différente, donc deux d'entre elles ne doivent jamais
 *   pouvoir être confondues d'un coup d'œil, même côte à côte sur la carte.
 *
 *   CONTEXTE (réseau routier) — gris hiérarchisés par l'épaisseur. Les routes
 *   sont un décor : leur donner des teintes les mettrait en concurrence avec les
 *   unités et les marquages.
 *
 * La séparation n'est pas laissée à l'appréciation : `npm run check:palette`
 * mesure l'écart CIEDE2000 de chaque paire et échoue sous le seuil. Toute
 * couleur ajoutée ici doit passer ce contrôle.
 */

/**
 * Hiérarchie territoriale et activité de terrain.
 *
 * Les teintes ALTERNENT en clarté (jaune clair, bleu sombre, vert clair, rouge
 * sombre) : deux couleurs voisines sur la roue des teintes se séparent alors
 * aussi par la luminosité, ce qui double l'écart perçu. C'est ce qui permet
 * huit couleurs distinctes sans qu'aucune paire ne descende sous le seuil.
 */
export const COLORS = {
  reg: '#ffd400', // jaune clair — Région
  cie: '#1565c0', // bleu sombre — Compagnie
  bt: '#00e676', // vert clair — Brigade Territoriale
  pointage: '#d50000', // rouge sombre — pointage de flotte (et sa zone)
};

/**
 * Marquages du chef de compagnie : familles que la hiérarchie n'utilise pas
 * (orange, rose, cyan, violet), là encore à des clartés alternées.
 */
export const COULEURS_MARQUAGE = {
  zahma: '#f57c00', // orange — assombri pour se séparer du rouge des pointages
  accident: '#ff4081', // rose
  barrage_fixe: '#00bcd4', // cyan
  barrage_mobile: '#aa00ff', // violet
  /**
   * BARRAGE VIP — kaki.
   *
   * Cette teinte est le seul creux qui restait dans la palette : toutes les
   * autres familles occupent le jaune, le bleu, le vert vif, le rouge,
   * l'orange, le rose, le cyan et le violet. Elle en est séparée de 36,9
   * CIEDE2000 au plus près, là où la règle en exige 25 — voir
   * `npm run check:palette`, qui refuse toute couleur qui rapprocherait deux
   * informations opérationnelles.
   *
   * Choisie par balayage systématique sous trois contraintes simultanées :
   * l'écart perceptuel, le contraste contre le liseré sombre posé sous chaque
   * repère (3,4:1 pour un minimum de 2,5), et une saturation suffisante pour
   * ne pas se lire comme un gris de contexte.
   */
  barrage_vip: '#607000',
};

/**
 * Infrastructures de transport (données réelles OpenStreetMap : péages,
 * gares, aéroports, ports — voir scripts/build-peages.mjs et
 * build-infrastructure.mjs) : une couche de RÉFÉRENCE géographique, pas une
 * donnée opérationnelle au même titre qu'un marquage saisi par une unité.
 * Vérifiées par `npm run check:palette` contre le réseau routier (écart de
 * contexte, 15) et ENTRE elles (20) — pas contre le jeu complet des couleurs
 * opérationnelles, déjà à son écart minimal : quatre couleurs de plus n'y
 * seraient pas passées. Recherchées par balayage systématique.
 */
export const COULEURS_INFRASTRUCTURE = {
  peage: '#d77b75', // corail
  gare: '#ddb088', // sable
  aeroport: '#b37700', // ambre
  port: '#dddd88', // jaune pâle
};

/**
 * Réseau routier : gris NEUTRES hiérarchisés, du plus sombre (le plus
 * important) au plus clair, dans une bande de clarté moyenne.
 *
 * Neutres et non bleutés : un gris bleuté se rapprochait trop du bleu des
 * compagnies (ΔE 12,5, mesuré). Bande médiane parce que le fond de carte n'est
 * pas connu — un gris trop foncé disparaîtrait sur une imagerie satellite, un
 * gris trop clair sur un plan. C'est l'épaisseur du trait qui porte la
 * hiérarchie, pas la teinte.
 */
export const CLASSES_ROUTE = {
  autoroute: { fr: 'Autoroute', ar: 'الطريق السيار', couleur: '#737373' },
  nationale: { fr: 'Route nationale', ar: 'الطريق الوطنية', couleur: '#8c8c8c' },
  regionale: { fr: 'Route régionale', ar: 'الطريق الجهوية', couleur: '#9e9e9e' },
  provinciale: { fr: 'Route provinciale', ar: 'الطريق الإقليمية', couleur: '#adadad' },
  liaison: { fr: 'Bretelle / traversée', ar: 'وصلة', couleur: '#b8b8b8' },
  /* Rues et dessertes sans numéro (graphe importé de Geofabrik) : calcul seulement. */
  locale: { fr: 'Voie locale', ar: 'طريق محلي', couleur: '#c2c2c2' },
};

/** Habillage : voile hors territoire, liseré de frontière, itinéraire mesuré. */
export const HABILLAGE = {
  voileHorsTerritoire: '#05080f',
  frontiere: '#ffffff',
  itineraire: '#ffd400',
  itineraireHalo: '#0b1220',
};
