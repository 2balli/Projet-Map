/**
 * Configuration du fond de carte.
 *
 * FOND UNIQUE : la carte hors ligne de `maroc-carte-offline` — fond vectoriel
 * Protomaps dans une archive PMTiles (`tiles/maroc.pmtiles`, zooms 0 à 15,
 * provinces du Sud comprises), polices et sprites locaux, règles cartographiques
 * propres au Maroc (`construireStyle` dans maroc-carte-offline/src/carte-style.js).
 *
 * Il est servi par la même origine que l'application, sous `fond-carte/`
 * (voir `scripts/serve.mjs` et le greffon `fondCarte` de vite.config.js) :
 * aucun serveur de tuiles, aucune adresse externe. MapLibre le dessine sous
 * les couches Leaflet (voir components/map/FondCarteVectoriel.jsx).
 */

/** Chemin RELATIF du fond : l'application reste déployable dans un sous-répertoire. */
export const CHEMIN_FOND = 'fond-carte';

/** L'archive de tuiles, relative à la page — c'est elle que la sonde interroge. */
export const ARCHIVE_FOND = `${CHEMIN_FOND}/tiles/maroc.pmtiles`;

/**
 * Bornes de zoom de la carte. L'archive s'arrête au zoom 15 : au-delà, MapLibre
 * agrandit les tuiles vectorielles du zoom 15, qui restent nettes.
 */
export const FOND_OPTIONS = {
  attribution: '© contributeurs OpenStreetMap · Protomaps',
  minZoom: 3,
  maxZoom: 20,
};

/** Vue initiale — Maroc. */
export const INITIAL_VIEW = { center: [31.7917, -7.0926], zoom: 6 };

/**
 * Emprise du territoire national — la carte ne sort pas de ce cadre.
 *
 * Valeurs relevées sur `public/layers/territoire.geojson` : de 17,32° ouest
 * à 1,00° ouest, et de 20,67° à 36,00° nord. La marge de 0,4° laisse
 * respirer les côtes et les postes frontaliers, qui seraient sinon collés au
 * bord de l'écran et malaisés à consulter.
 *
 * Ce cadre est une limite de DÉPLACEMENT : combiné au zoom minimal calculé à
 * l'ouverture (voir `LimiterAuTerritoire`), il empêche d'atteindre l'Espagne,
 * l'Algérie ou l'Atlantique ouvert. On ne peut plus se perdre hors de la zone
 * de responsabilité, ni par glissement ni par zoom arrière.
 *
 * Format Leaflet : [[sud, ouest], [nord, est]].
 */
const MARGE_DEG = 0.4;
export const BORNES_MAROC = [
  [20.6673 - MARGE_DEG, -17.319 - MARGE_DEG],
  [35.9965 + MARGE_DEG, -0.999 + MARGE_DEG],
];

/** Rayon de détection de proximité (km). */
export const PROXIMITY_KM = 5;
