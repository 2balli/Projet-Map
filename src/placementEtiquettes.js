/**
 * PLACEMENT DES ÉTIQUETTES TERRITORIALES — sans chevauchement.
 *
 * LE DÉFAUT CORRIGÉ. Les agrégats de barrages (« REG Rabat », « CIE Salé »)
 * étaient posés au chef-lieu de chaque entité. Or les chefs-lieux de Rabat,
 * Kénitra, Khémisset, Sidi Kacem et Casablanca tiennent dans un mouchoir : à
 * l'échelle nationale, leurs étiquettes s'empilaient et masquaient le littoral,
 * les routes et les repères. Certaines débordaient aussi en mer, le chef-lieu
 * étant sur la côte.
 *
 * LA RÈGLE, EN TROIS TEMPS, PAR ORDRE DE PRIORITÉ :
 *   1. l'étiquette est centrée sur son ANCRE — le pôle d'inaccessibilité de
 *      l'entité, c'est-à-dire le point le plus éloigné de ses bords : elle y
 *      tient à l'intérieur aussi longtemps que la place le permet ;
 *   2. si elle y heurte une étiquette plus prioritaire, on essaie des positions
 *      voisines, d'abord DANS l'entité, puis au dehors — reliée alors à son
 *      ancre par un trait de rappel ;
 *   3. faute de place, elle se REPLIE en un point discret : l'agrégat reste
 *      visible et cliquable, seul son texte s'efface jusqu'au zoom suivant.
 *
 * Deux étiquettes visibles ne se chevauchent JAMAIS : c'est une garantie du
 * calcul, éprouvée sur les vraies limites par `npm run check:etiquettes`.
 *
 * POURQUOI EN PIXELS DU MONDE, ET NON DE L'ÉCRAN. Le placement est calculé dans
 * la projection Web Mercator au zoom entier courant — la même que Leaflet
 * (EPSG:3857). Il ne dépend donc QUE du zoom : glisser la carte ne déplace
 * aucune étiquette, et le résultat se met en cache par niveau.
 *
 * Calcul pur, sans Leaflet ni DOM : vérifiable sous Node, comme
 * `carteLisibilite.js` et `placementBulle.js`.
 */

const TAILLE_TUILE = 256;
const RAD = Math.PI / 180;
const LAT_MAX = 85.0511287798;

/** [lat, lng] -> pixels du monde au zoom donné (EPSG:3857, comme Leaflet). */
export function projeter([lat, lng], zoom) {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const phi = Math.max(-LAT_MAX, Math.min(LAT_MAX, lat)) * RAD;
  return {
    x: ((lng + 180) / 360) * echelle,
    y: (0.5 - Math.log((1 + Math.sin(phi)) / (1 - Math.sin(phi))) / (4 * Math.PI)) * echelle,
  };
}

/** Pixels du monde -> [lat, lng]. */
export function deprojeter({ x, y }, zoom) {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const lng = (x / echelle) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / echelle;
  const lat = Math.atan(Math.sinh(n)) / RAD;
  return [lat, lng];
}

/* ------------------------------------------------------------------ */
/* Géométrie                                                          */
/* ------------------------------------------------------------------ */

/** Les polygones d'une géométrie GeoJSON, chacun en anneaux [lng, lat]. */
function polygones(geometrie) {
  if (!geometrie) return [];
  if (geometrie.type === 'Polygon') return [geometrie.coordinates];
  if (geometrie.type === 'MultiPolygon') return geometrie.coordinates;
  return [];
}

function boiteAnneau(anneau) {
  let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of anneau) {
    if (x < o) o = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [o, s, e, n];
}

function dansAnneau(x, y, anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/**
 * Prépare une géométrie pour des tests répétés : boîtes englobantes calculées
 * une fois. Un test de point se fait alors d'abord sur la boîte — l'immense
 * majorité des candidats d'un placement s'y décide sans parcourir les sommets.
 */
export function preparerGeometrie(geometrie) {
  return polygones(geometrie).map((anneaux) => ({ anneaux, boite: boiteAnneau(anneaux[0] ?? []) }));
}

/** [lat, lng] dans la géométrie (préparée ou GeoJSON) ? Trous respectés. */
export function pointDansGeometrie([lat, lng], geometrie) {
  const prep = Array.isArray(geometrie) ? geometrie : preparerGeometrie(geometrie);
  for (const { anneaux, boite } of prep) {
    if (lng < boite[0] || lng > boite[2] || lat < boite[1] || lat > boite[3]) continue;
    if (!dansAnneau(lng, lat, anneaux[0])) continue;
    let dansTrou = false;
    for (let k = 1; k < anneaux.length; k++) {
      if (dansAnneau(lng, lat, anneaux[k])) {
        dansTrou = true;
        break;
      }
    }
    if (!dansTrou) return true;
  }
  return false;
}

/** Distance signée d'un point au bord d'un polygone (positive dedans). */
function distanceAuBord(x, y, anneaux) {
  let dedans = false;
  let min = Infinity;
  for (const anneau of anneaux) {
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const [ax, ay] = anneau[i];
      const [bx, by] = anneau[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) dedans = !dedans;
      let dx = bx - ax;
      let dy = by - ay;
      let px = ax;
      let py = ay;
      if (dx !== 0 || dy !== 0) {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        px = ax + dx * t;
        py = ay + dy * t;
      }
      dx = x - px;
      dy = y - py;
      const d = dx * dx + dy * dy;
      if (d < min) min = d;
    }
  }
  return (dedans ? 1 : -1) * Math.sqrt(min);
}

/**
 * PÔLE D'INACCESSIBILITÉ — le point intérieur le plus éloigné des bords
 * (algorithme « polylabel » par subdivision). Contrairement au centroïde, il
 * tombe toujours DANS l'entité, même en croissant ou en forme de L, et c'est là
 * qu'une étiquette a le plus de place.
 *
 * Calculé dans la projection Mercator, pour que « le plus loin des bords » soit
 * vrai à l'écran et non en degrés. Pour un MultiPolygone, le plus grand morceau.
 *
 * @returns {[number, number] | null} [lat, lng]
 */
export function poleInaccessibilite(geometrie) {
  let meilleur = null;
  for (const anneauxGeo of polygones(geometrie)) {
    const anneaux = anneauxGeo.map((a) => a.map(([lng, lat]) => {
      const p = projeter([lat, lng], 0);
      return [p.x, p.y];
    }));
    if (!anneaux[0]?.length) continue;
    const [o, s, e, n] = boiteAnneau(anneaux[0]);
    const largeur = e - o;
    const hauteur = n - s;
    const cote = Math.min(largeur, hauteur);
    if (!(cote > 0)) continue;
    const precision = Math.max(largeur, hauteur) / 200;

    const cellule = (x, y, h) => {
      const d = distanceAuBord(x, y, anneaux);
      return { x, y, h, d, max: d + h * Math.SQRT2 };
    };
    const file = [];
    for (let x = o; x < e; x += cote) {
      for (let y = s; y < n; y += cote) file.push(cellule(x + cote / 2, y + cote / 2, cote / 2));
    }
    let top = cellule(o + largeur / 2, s + hauteur / 2, 0);
    for (const c of file) if (c.d > top.d) top = c;

    let garde = 0;
    while (file.length && garde++ < 20000) {
      let iMax = 0;
      for (let i = 1; i < file.length; i++) if (file[i].max > file[iMax].max) iMax = i;
      const c = file.splice(iMax, 1)[0];
      if (c.d > top.d) top = c;
      if (c.max - top.d <= precision) continue;
      const h = c.h / 2;
      file.push(cellule(c.x - h, c.y - h, h), cellule(c.x + h, c.y - h, h),
        cellule(c.x - h, c.y + h, h), cellule(c.x + h, c.y + h, h));
    }
    if (!meilleur || top.d > meilleur.d) meilleur = top;
  }
  return meilleur && meilleur.d > 0 ? deprojeter({ x: meilleur.x, y: meilleur.y }, 0) : null;
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Gabarit typographique des étiquettes, par échelon. Une seule source pour le
 * dessin (barrageClusterIcons.js, index.css) et pour le calcul de collision :
 * une boîte mal estimée serait un chevauchement que le calcul ne voit pas.
 */
export const GABARIT_ETIQUETTES = {
  /* L'échelon se lit à une pastille de couleur (`pastille`, en px, marge
     comprise) plutôt qu'au sigle « REG » / « CIE » : à un zoom donné, toutes
     les étiquettes sont du même échelon, et le sigle coûtait un quart de la
     largeur — donc autant de place perdue pour les noms. */
  region: { hauteur: 20, paddingH: 7, nom: 11.5, pastille: 11 },
  compagnie: { hauteur: 18, paddingH: 6, nom: 10.5, pastille: 10 },
  brigade: { hauteur: 17, paddingH: 6, nom: 10, pastille: 9 },
  /* Nom de région en filigrane (zooms 7–8) : capitales espacées, sans fond. */
  filigrane: { hauteur: 14, paddingH: 2, nom: 10.5, pastille: 0, capitales: true },
};

/**
 * Largeur moyenne d'un glyphe, en em, à la graisse employée (600–700).
 * Volontairement un peu GÉNÉREUSE : surestimer une boîte coûte quelques pixels
 * d'écart, la sous-estimer laisse passer un chevauchement réel.
 */
const EM_MINUSCULES = 0.6;
const EM_CAPITALES = 0.74;

export function dimensionsEtiquette(niveau, nom = '') {
  const g = GABARIT_ETIQUETTES[niveau] ?? GABARIT_ETIQUETTES.region;
  const texte = String(nom ?? '').trim();
  /* +0,1 em en capitales : l'espacement des lettres du filigrane (0,1 em). */
  const largeurNom = texte.length * g.nom * (g.capitales ? EM_CAPITALES + 0.1 : EM_MINUSCULES);
  return { largeur: Math.ceil(largeurNom + g.pastille + g.paddingH * 2), hauteur: g.hauteur };
}

/* ------------------------------------------------------------------ */
/* Visibilité selon le zoom                                           */
/* ------------------------------------------------------------------ */

/**
 * QUI PARLE À QUEL ZOOM — calée sur les échelons de la carte (voir
 * `SEUILS_ZOOM` dans barrageClustering.js) :
 *   ≤ 6   régions : agrégats de région, nommés ;
 *   7–8   compagnies nommées, et les régions RESTENT lisibles en filigrane
 *         (capitales espacées, sans fond), cédant toujours le pas ;
 *   ≥ 9   repères individuels : plus aucune étiquette territoriale, la place
 *         revient aux villes du fond et aux barrages.
 */
export const ZOOM_FILIGRANE = { min: 7, max: 8 };

export function filigraneRegionsVisible(zoom) {
  return Number.isFinite(zoom) && zoom >= ZOOM_FILIGRANE.min && zoom <= ZOOM_FILIGRANE.max;
}

/* ------------------------------------------------------------------ */
/* Placement                                                          */
/* ------------------------------------------------------------------ */

/** Marge minimale entre deux étiquettes, en pixels. */
export const MARGE_ETIQUETTES = 4;

/** Distance maximale d'un renvoi (étiquette sortie de son entité), en pixels. */
export const PORTEE_RENVOI = 90;

/** Positions essayées autour de l'ancre : d'abord au plus près, verticalement. */
function decalages(hauteur, largeur) {
  const out = [[0, 0]];
  const pas = [0.75, 1.25, 1.9, 2.7, 3.7, 5];
  const directions = [
    [0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1],
  ];
  for (const k of pas) {
    for (const [dx, dy] of directions) out.push([dx * largeur * k * 0.45, dy * hauteur * k]);
  }
  return out;
}

const chevauche = (a, b, marge) =>
  a.x0 < b.x1 + marge && b.x0 < a.x1 + marge && a.y0 < b.y1 + marge && b.y0 < a.y1 + marge;

const touchePastille = (r, o) => {
  const cx = Math.max(r.x0, Math.min(o.x, r.x1));
  const cy = Math.max(r.y0, Math.min(o.y, r.y1));
  return (cx - o.x) ** 2 + (cy - o.y) ** 2 < o.r * o.r;
};

/**
 * Place un jeu d'étiquettes au zoom donné.
 *
 * @param {Array<{
 *   id: string, ancre: [number, number], largeur: number, hauteur: number,
 *   priorite?: number, geometrie?: object|Array, cedeAuxObstacles?: boolean,
 *   renvoi?: boolean,
 * }>} etiquettes
 *   `renvoi: false` : l'étiquette se replie plutôt que de sortir de son entité.
 *   `geometrie` : GeoJSON ou résultat de `preparerGeometrie` — sans elle,
 *   « dedans » n'est pas évalué et seule la proximité de l'ancre compte.
 * @param {{ zoom: number, marge?: number, obstacles?: Array<{ position: [number, number], rayon: number }> }} options
 *   `obstacles` : repères à ne pas recouvrir (rayon en pixels) — contrainte
 *   ferme pour les positions décalées, jamais pour l'ancre d'une étiquette
 *   prioritaire : un agrégat ne disparaît pas parce qu'un repère est dessous.
 * @returns {Array<{ id: string, mode: 'ancre'|'decale'|'renvoi'|'replie',
 *   centre: [number, number], ancre: [number, number], boite: object|null }>}
 *   `boite` en pixels du monde au zoom donné, `null` pour une étiquette repliée.
 */
export function placerEtiquettes(etiquettes, { zoom, marge = MARGE_ETIQUETTES, obstacles = [] } = {}) {
  const z = Math.round(zoom);
  const posees = [];
  const obst = obstacles.map((o) => ({ ...projeter(o.position, z), r: o.rayon }));
  const triees = [...etiquettes]
    .filter((e) => Array.isArray(e.ancre) && e.ancre.every(Number.isFinite))
    .sort((a, b) => (b.priorite ?? 0) - (a.priorite ?? 0) || String(a.id).localeCompare(String(b.id)));

  const resultats = new Map();
  for (const e of triees) {
    const a = projeter(e.ancre, z);
    const geo = e.geometrie ? (Array.isArray(e.geometrie) ? e.geometrie : preparerGeometrie(e.geometrie)) : null;
    const dedans = (x, y) => !geo || pointDansGeometrie(deprojeter({ x, y }, z), geo);
    const libre = (r) => !posees.some((p) => chevauche(r, p, marge));
    const sansObstacle = (r) => !obst.some((o) => touchePastille(r, o));
    /* L'entité peut-elle contenir l'étiquette entière ? À l'échelle nationale,
       une petite région (Rabat, Casablanca) fait moins de vingt pixels : y
       exiger une étiquette entière la renverrait toujours au dehors. On n'y
       exige alors que le CENTRE — l'étiquette déborde un peu, comme sur toute
       carte de référence, mais reste posée sur ce qu'elle nomme. */
    const contientEntiere = (cx, cy) =>
      dedans(cx, cy) && dedans(cx - e.largeur / 2 + 2, cy) && dedans(cx + e.largeur / 2 - 2, cy);
    const exigeEntiere = contientEntiere(a.x, a.y);

    let choisi = null;
    let repli = null;
    for (const [dx, dy] of decalages(e.hauteur, e.largeur)) {
      const cx = a.x + dx;
      const cy = a.y + dy;
      const r = { x0: cx - e.largeur / 2, x1: cx + e.largeur / 2, y0: cy - e.hauteur / 2, y1: cy + e.hauteur / 2 };
      if (!libre(r)) continue;
      const aLAncre = dx === 0 && dy === 0;
      if (!aLAncre && e.cedeAuxObstacles !== false && !sansObstacle(r)) continue;
      const interieur = exigeEntiere ? contientEntiere(cx, cy) : dedans(cx, cy);
      if (interieur) {
        choisi = { r, cx, cy, mode: aLAncre ? 'ancre' : 'decale' };
        break;
      }
      if (!repli && Math.hypot(dx, dy) <= PORTEE_RENVOI) repli = { r, cx, cy, mode: 'renvoi' };
    }
    /* Un renvoi (étiquette hors de son entité, reliée par un trait) n'est
       permis qu'aux étiquettes qui le demandent : un filigrane hors de sa
       région ne désignerait plus rien. */
    if (!choisi && e.renvoi !== false) choisi = repli;

    if (choisi) {
      posees.push(choisi.r);
      resultats.set(e.id, {
        id: e.id,
        mode: choisi.mode,
        centre: deprojeter({ x: choisi.cx, y: choisi.cy }, z),
        ancre: e.ancre,
        boite: choisi.r,
      });
    } else {
      resultats.set(e.id, { id: e.id, mode: 'replie', centre: e.ancre, ancre: e.ancre, boite: null });
    }
  }
  /* Ordre d'entrée conservé : le rendu ne change pas d'ordre d'un zoom à l'autre. */
  return etiquettes.filter((e) => resultats.has(e.id)).map((e) => resultats.get(e.id));
}
