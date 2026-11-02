/**
 * Bouclage d'une zone — fonctions pures, sans MapLibre ni DOM.
 *
 * Points où les routes franchissent un cercle de rayon donné autour d'un
 * centre : ce sont les sorties à tenir pour fermer la zone. Les franchissements
 * proches (chaussées séparées, bretelles, morceaux de tuiles) sont fusionnés en
 * un seul point, celui de la route la plus importante.
 *
 * Coordonnées en [longitude, latitude], distances en mètres, dans une
 * projection plane locale centrée sur le centre (exacte à l'échelle du rayon).
 */
import { distanceMetres, METRES_PAR_DEGRE } from './mesure.js';


/** Importance des catégories OSM (0 = autoroute) ; les bretelles comptent comme leur route. */
const RANGS = Object.freeze({
  motorway: 0, motorway_link: 0, trunk: 1, trunk_link: 1, primary: 2, primary_link: 2,
  secondary: 3, secondary_link: 3, tertiary: 4, tertiary_link: 4,
  unclassified: 5, residential: 6, living_street: 7, track: 7, service: 8,
  highway: 0, major_road: 2, medium_road: 4, minor_road: 6, other: 8,
});
/** « Axes principaux » : jusqu'aux routes tertiaires comprises. */
export const RANG_PRINCIPAL = 4;
const rangDe = (classe) => RANGS[classe] ?? 8;

const DIRECTIONS = Object.freeze({
  fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
  ar: ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'],
});

function projection([lon0, lat0]) {
  const kx = METRES_PAR_DEGRE * Math.cos((lat0 * Math.PI) / 180);
  return {
    vers: ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * METRES_PAR_DEGRE],
    depuis: ([x, y]) => [lon0 + x / kx, lat0 + y / METRES_PAR_DEGRE],
  };
}

/** Cap (degrés, 0 = nord, sens horaire) du centre vers p. */
export function cap(centre, p) {
  const [x, y] = projection(centre).vers(p);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Direction cardinale (8 secteurs) d'un cap. */
export function direction(degres, langue = 'fr') {
  return (DIRECTIONS[langue] ?? DIRECTIONS.fr)[Math.round(degres / 45) % 8];
}

/** Anneau [lon, lat] fermé approchant le cercle (pour l'affichage). */
export function cercle(centre, rayon, n = 128) {
  const proj = projection(centre);
  const anneau = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    anneau.push(proj.depuis([rayon * Math.sin(a), rayon * Math.cos(a)]));
  }
  return anneau;
}

/** Fractions t ∈ [0, 1[ où le segment [a, b] (plan local, centre à l'origine) coupe le cercle. */
function coupes(a, b, rayon) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const B = 2 * (a[0] * dx + a[1] * dy);
  const C = a[0] * a[0] + a[1] * a[1] - rayon * rayon;
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return []; // tangent ou à l'écart : pas de franchissement
  const r = Math.sqrt(disc);
  // [0, 1[ : un sommet exactement sur le cercle n'est compté qu'une fois.
  return [(-B - r) / (2 * A), (-B + r) / (2 * A)].filter((t) => t >= 0 && t < 1);
}

/**
 * Sorties d'une zone circulaire.
 * @param {{ points: number[][], nom?, nomFr?, nomAr?, ref?, classe? }[]} lignes  routes en [lon, lat]
 * @param {{ rangMax?: number, fusion?: number }} options  `fusion` : mètres sous lesquels deux sorties n'en font qu'une
 * @returns {{ point: number[], cap: number, rang: number, classe, nom, nomFr, nomAr, ref, refs: string[] }[]}  triées par cap
 */
export function sortiesDuCercle(lignes, centre, rayon, { rangMax = Infinity, fusion = 150 } = {}) {
  const proj = projection(centre);
  const brutes = [];
  for (const ligne of lignes) {
    const rang = rangDe(ligne.classe);
    if (rang > rangMax) continue;
    const plan = ligne.points.map(proj.vers);
    for (let i = 1; i < plan.length; i++) {
      const a = plan[i - 1];
      const b = plan[i];
      for (const t of coupes(a, b, rayon)) {
        brutes.push({
          point: proj.depuis([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]),
          rang, classe: ligne.classe ?? null, nom: ligne.nom ?? null, nomFr: ligne.nomFr ?? null, nomAr: ligne.nomAr ?? null, ref: ligne.ref ?? null,
        });
      }
    }
  }
  // Les plus importantes d'abord (à rang égal, celles qui ont un numéro) : une sortie fusionnée garde la route principale.
  brutes.sort((x, y) => x.rang - y.rang || Number(Boolean(y.ref)) - Number(Boolean(x.ref)));
  const gardees = [];
  for (const s of brutes) {
    const proche = gardees.find((g) => distanceMetres(g.point, s.point) < fusion);
    if (proche) {
      if (s.ref && !proche.refs.includes(s.ref)) proche.refs.push(s.ref);
      continue;
    }
    gardees.push({ ...s, refs: s.ref ? [s.ref] : [], cap: cap(centre, s.point) });
  }
  return gardees.sort((x, y) => x.cap - y.cap);
}
