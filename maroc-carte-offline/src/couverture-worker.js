/**
 * Temps d'intervention calculés dans un fil séparé (≈ 1 à 3 s pour tout le
 * Royaume) : la carte reste fluide. Voir couverture.js.
 *
 * Message reçu : { id, urlReseau, urlMasque, sources: [lon, lat][], limite?: secondes }
 *   sans `limite` : tout le territoire (couverture) ; avec : autour de la source (zone d'intervention).
 * Message émis : { id, image: Blob (PNG), grille: { x0, y0, d, largeur, hauteur, coins }, temps, proprio, stats }
 *                · { id, erreur }
 */
import { emprise } from './mesure.js';
import { deserialiser } from './reseau-national.js';
import {
  coins, colorer, empriseDe, grilleMercator, indexerAretes, rasteriserMasque, statistiques, tempsDepuis, tempsSurGrille,
} from './couverture.js';

/** Pas de la grille nationale (degrés de longitude, ≈ 1 km). */
const PAS_NATIONAL = 0.01;
/** Cellules sur la largeur d'une zone d'intervention. */
const LARGEUR_ZONE = 900;

let donnees = null;
function charger(urlReseau, urlMasque) {
  donnees ??= Promise.all([
    fetch(urlReseau).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`réseau national : HTTP ${r.status}`)))),
    fetch(urlMasque).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`circonscriptions : HTTP ${r.status}`)))),
  ]).then(([tampon, masque]) => {
    const reseau = deserialiser(tampon);
    const geometries = masque.features.map((f) => f.geometry);
    return { reseau, index: indexerAretes(reseau), geometries, territoire: empriseDe(geometries) };
  });
  donnees.catch(() => { donnees = null; }); // nouvel essai au prochain message
  return donnees;
}

/** Emprise d'une zone d'intervention : ce qu'on peut parcourir à 120 km/h, plus une marge. */
const empriseZone = (source, limite) => emprise(source, source, (limite / 3600) * 120_000 + 15_000);

self.onmessage = async ({ data }) => {
  const { id, urlReseau, urlMasque, sources, limite = Infinity } = data;
  try {
    const { reseau, index, geometries, territoire } = await charger(urlReseau, urlMasque);
    const zone = Number.isFinite(limite);
    const bornes = zone ? empriseZone(sources[0], limite) : territoire;
    const g = grilleMercator(bornes, zone ? (bornes[2] - bornes[0]) / LARGEUR_ZONE : PAS_NATIONAL);
    const masque = rasteriserMasque(g, geometries);
    const noeuds = tempsDepuis(reseau, index, sources, { limite });
    const { temps, proprio } = tempsSurGrille(reseau, noeuds, g, masque, { sources, limite });

    const toile = new OffscreenCanvas(g.largeur, g.hauteur);
    toile.getContext('2d').putImageData(new ImageData(colorer(g, temps), g.largeur, g.hauteur), 0, 0);
    const image = await toile.convertToBlob({ type: 'image/png' });
    const grille = { x0: g.x0, y0: g.y0, d: g.d, largeur: g.largeur, hauteur: g.hauteur, coins: coins(g) };
    self.postMessage({ id, image, grille, temps, proprio, stats: statistiques(g, temps, masque) }, [temps.buffer, proprio.buffer]);
  } catch (erreur) {
    self.postMessage({ id, erreur: erreur.message });
  }
};
