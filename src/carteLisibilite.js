/**
 * CE QUE LA CARTE MONTRE SANS DEVENIR ILLISIBLE.
 *
 * Deux règles, et une seule question derrière : à cette distance, ce signe
 * apporte-t-il quelque chose ?
 *
 * LE DÉFAUT QUI A RENDU CE MODULE NÉCESSAIRE. Les badges de caractéristiques
 * (« ⇥ ENTRÉE », « VIP », « 💡 », « A ») étaient posés à TOUS les zooms. Sur le
 * jeu de démonstration, cela fait 189 étiquettes de texte dessinées d'un coup
 * sur une vue du pays entier — plus 58 « ? » et 19 cadenas. La carte n'était
 * pas chargée, elle était inutilisable : les pastilles se chevauchaient sur
 * plusieurs rangs, recouvrant les contours, le littoral, et les repères
 * qu'elles étaient censées compléter.
 *
 * Personne ne l'avait vu parce que ces couches ne se remplissent QU'APRÈS un
 * calcul d'optimisation, et que le bouton CALCULER était inerte (voir
 * `apresSuivant` dans parcoursNavigation.js). Le premier calcul réussi a
 * révélé du même coup une couche que rien ne bornait.
 *
 * POURQUOI CES RÈGLES VIVENT ICI, ET NON DANS LE COMPOSANT DE CARTE.
 * `GendarmerieMap.jsx` fait cinq mille lignes et ne s'exécute pas hors d'un
 * navigateur : une décision enfouie dedans ne peut pas être éprouvée. Celles-ci
 * sont du calcul pur, donc vérifiables — même démarche que
 * `parcoursNavigation.js` pour la navigation et `placementBulle.js` pour les
 * bulles.
 */

/**
 * TAILLE DES PINS SELON LE ZOOM — petits de loin, entiers de près.
 *
 * À l'échelle nationale, mille cent pins de 30 x 38 px recouvraient le pays :
 * la carte devenait une nappe de gouttes turquoise où plus aucune route ni
 * aucune frontière n'était visible. Le repère n'a pas la même fonction selon la
 * distance — de loin il indique une PRÉSENCE et une densité, de près il
 * s'identifie et se clique.
 *
 * PAR PALIERS, et non en continu. Trois raisons :
 *   — chaque changement d'échelle recrée l'icône de chaque marqueur ; des
 *     paliers bornent le cache (voir `cache`) à quelques entrées par couche au
 *     lieu d'une par niveau de zoom fractionnaire ;
 *   — Leaflet zoome par pas entiers, un dégradé continu n'aurait rien de plus ;
 *   — un saut franc se lit comme un choix, un glissement permanent comme un
 *     défaut d'affichage.
 *
 * Les seuils suivent l'usage : 6 est la vue nationale, 8 la région, 10 la
 * compagnie, 12 le terrain où l'on pose et déplace les repères.
 */
const PALIERS_ZOOM = [
  [6, 0.38],
  [7, 0.5],
  [8, 0.62],
  [9, 0.78],
  [11, 0.9],
];

export function echelleZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  for (const [seuil, facteur] of PALIERS_ZOOM) {
    if (zoom <= seuil) return facteur;
  }
  return 1;
}

/**
 * DEPUIS QUEL ZOOM LES BADGES SE LISENT.
 *
 * Le Maroc fait environ 1 400 km de large : la vue couvre ~45 km au zoom 11,
 * ~22 km au zoom 12. À 11, on regarde une ville et ses abords — quelques
 * postes, quelques badges, lisibles. En deçà, on regarde une région ou le
 * pays, où aucune étiquette de texte ne tient.
 *
 * C'est aussi le palier que `PALIERS_ZOOM` ci-dessus traite déjà comme
 * « assez près pour la taille réelle » : un seul seuil dans l'application,
 * plutôt que deux qui finiraient par diverger.
 */
export const ZOOM_BADGES = 11;

/**
 * Faut-il poser les badges de caractéristiques ?
 *
 * POURQUOI UN SEUIL, ET NON UN ÉCRÉMAGE. N'en afficher que quelques-uns
 * demanderait de choisir lesquels : tout choix serait arbitraire, et cacherait
 * une caractéristique sans le dire. Un seuil est une règle que l'utilisateur
 * comprend d'instinct — on approche pour lire le détail — et l'information
 * n'est perdue nulle part : la liste du panneau la porte, et la bulle du poste
 * aussi. Viser un poste depuis le panneau approche à 13, donc les badges du
 * poste qu'on examine apparaissent d'eux-mêmes.
 *
 * Un zoom inconnu (`undefined`, `NaN`) rend `true` : mieux vaut montrer que
 * masquer par accident une couche que l'utilisateur a demandée.
 *
 * @param {number} zoom
 * @returns {boolean}
 */
export function badgesVisibles(zoom) {
  if (!Number.isFinite(zoom)) return true;
  return zoom >= ZOOM_BADGES;
}

/**
 * LES REPÈRES DE DÉCISION NE DISPARAISSENT PAS, EUX — ILS RÉTRÉCISSENT.
 *
 * Les badges se cachent au loin : ce sont des renseignements. Les « ? » et les
 * cadenas, non : ils disent OÙ IL Y A DU TRAVAIL, et c'est précisément sur la
 * vue du pays qu'un commandant a besoin de le voir d'un coup d'œil. Les cacher
 * reviendrait à cacher le résultat du calcul.
 *
 * LE PLANCHER EST LE POINT DÉLICAT. `echelleZoom` descend à 0,38 au zoom 6, ce
 * qui donnerait un disque de 11 px : trop petit pour être visé à la souris, et
 * ces repères SE CLIQUENT — c'est par eux qu'on tranche. On ne descend donc pas
 * sous 0,62, soit 19 px : assez petit pour dégager la vue, assez grand pour
 * rester une cible.
 */
export const ECHELLE_DECISION_MIN = 0.62;

/** Côté minimal, en pixels, d'un repère qui se clique. */
export const COTE_CLIQUABLE_MIN = 18;

/**
 * @param {number} echelle échelle de zoom des pins (voir `echelleZoom`)
 * @returns {number} échelle à appliquer aux repères de décision
 */
export function echelleDecision(echelle) {
  const e = Number.isFinite(echelle) ? echelle : 1;
  return Math.max(ECHELLE_DECISION_MIN, e);
}

/**
 * Côté d'une icône de décision, en pixels entiers.
 *
 * La taille sert à TROIS endroits qui doivent s'accorder : la boîte du
 * marqueur Leaflet, son ancre, et la variable CSS `--gr-taille` dont le glyphe
 * découle. Les faire calculer ici évite qu'un des trois dérive — ce qui
 * produirait un repère décentré, donc un clic qui manque sa cible.
 *
 * @param {number} base côté à l'échelle 1
 * @param {number} echelle
 * @returns {number}
 */
export function coteDecision(base, echelle) {
  return Math.round(base * echelleDecision(echelle));
}
