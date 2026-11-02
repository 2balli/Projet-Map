import L from 'leaflet';
import { GABARIT_ETIQUETTES, dimensionsEtiquette } from './placementEtiquettes.js';

/**
 * Abréviations opérationnelles des échelons hiérarchiques. Elles ne sont plus
 * écrites dans l'étiquette (l'échelon s'y lit à la pastille, voir
 * `GABARIT_ETIQUETTES`) mais restent dans l'infobulle et le titre accessible.
 */
export const ABBREVIATIONS_HIERARCHIE = {
  region: 'REG',
  compagnie: 'CIE',
  brigade: 'BT',
};

/**
 * Configuration des clusters par échelon. Les dimensions viennent du gabarit
 * partagé avec le calcul de collision (placementEtiquettes.js) : une boîte
 * dessinée plus grande que la boîte calculée serait un chevauchement invisible
 * pour le calcul. Les couleurs sont celles du thème (index.css,
 * `.gr-cluster-tactique`), et non plus écrites ici.
 */
export const CONFIG_CLUSTERS = Object.fromEntries(
  Object.entries(ABBREVIATIONS_HIERARCHIE).map(([niveau, abbreviation]) => [
    niveau,
    { ...GABARIT_ETIQUETTES[niveau], libelleNiveau: abbreviation, abbreviation },
  ]),
);

/**
 * Dimensions de l'étiquette : la hauteur dépend de l'échelon, la largeur de la
 * longueur du nom. Le nom n'est jamais tronqué.
 *
 * @param {string} niveau
 * @param {string} nom
 * @returns {{largeur: number, hauteur: number}}
 */
export function calculerDimensionsCluster(niveau, nom = '') {
  return dimensionsEtiquette(String(niveau || '').toLowerCase(), nom);
}

/** Côté du point d'un agrégat replié (voir `.gr-cluster-replie`). */
export const COTE_REPLIE = 10;

const cacheIcones = new Map();
const echapperHtml = (valeur) => String(valeur ?? '').replace(/[&<>"']/g, (caractere) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[caractere]);

/**
 * Construit une icône Leaflet DivIcon pour un cluster tactique.
 *
 * @param {object} cluster
 * @param {{ replie?: boolean }} [options] `replie` : faute de place, un simple
 *   point — l'agrégat reste visible et cliquable, son nom est dans l'infobulle.
 * @returns {L.DivIcon}
 */
export function creerIconeCluster(cluster, { replie = false } = {}) {
  const normNiveau = String(cluster.niveau || '').toLowerCase();
  const cfg = CONFIG_CLUSTERS[normNiveau] || CONFIG_CLUSTERS.region;
  const nom = String(cluster.nom ?? '').trim();
  const estSelectionne = Boolean(cluster.selectionne);
  const classes = `gr-cluster-${normNiveau}${estSelectionne ? ' gr-cluster-selectionne' : ''}`;

  if (replie) {
    const cle = `replie|${normNiveau}|${estSelectionne}`;
    if (!cacheIcones.has(cle)) {
      cacheIcones.set(cle, L.divIcon({
        html: `<span class="gr-cluster-replie ${classes}"></span>`,
        className: `gr-cluster-divicon gr-cluster-divicon-${normNiveau}`,
        iconSize: [COTE_REPLIE, COTE_REPLIE],
        iconAnchor: [COTE_REPLIE / 2, COTE_REPLIE / 2],
      }));
    }
    return cacheIcones.get(cle);
  }

  const { largeur, hauteur } = calculerDimensionsCluster(normNiveau, nom);
  const cleCache = `${normNiveau}|${largeur}|${hauteur}|${nom}|${estSelectionne}`;
  if (cacheIcones.has(cleCache)) return cacheIcones.get(cleCache);

  const html = `<div class="gr-cluster-tactique ${classes}" style="height:${hauteur}px;width:${largeur}px;padding:0 ${cfg.paddingH}px"><span class="gr-cluster-pastille" aria-hidden="true"></span><span class="gr-cluster-nom">${echapperHtml(nom)}</span></div>`;

  const icone = L.divIcon({
    html,
    className: `gr-cluster-divicon gr-cluster-divicon-${normNiveau}`,
    iconSize: [largeur, hauteur],
    iconAnchor: [Math.round(largeur / 2), Math.round(hauteur / 2)],
  });
  cacheIcones.set(cleCache, icone);
  return icone;
}

/** Nom de région en filigrane : non interactif, aux dimensions du gabarit. */
export function creerIconeFiligrane(nom) {
  const texte = String(nom ?? '').trim();
  const cle = `filigrane|${texte}`;
  if (cacheIcones.has(cle)) return cacheIcones.get(cle);
  const { largeur, hauteur } = dimensionsEtiquette('filigrane', texte);
  const icone = L.divIcon({
    html: `<span>${echapperHtml(texte)}</span>`,
    className: 'gr-filigrane',
    iconSize: [largeur, hauteur],
    iconAnchor: [Math.round(largeur / 2), Math.round(hauteur / 2)],
  });
  cacheIcones.set(cle, icone);
  return icone;
}

/** Petit point marquant l'ancre d'une étiquette renvoyée hors de son entité. */
export const ICONE_ANCRE_RENVOI = L.divIcon({
  html: '<span class="gr-etiquette-ancre"></span>',
  className: 'gr-etiquette-ancre-divicon',
  iconSize: [5, 5],
  iconAnchor: [2.5, 2.5],
});
