/**
 * Temps d'intervention par la route — fonctions pures, sans MapLibre ni DOM
 * (exécutées dans couverture-worker.js).
 *
 * 1. Plus court temps, par le réseau national (reseau-national.js), depuis une
 *    ou plusieurs unités : Dijkstra à sources multiples, chaque nœud retient
 *    l'unité la plus rapide (« propriétaire »).
 * 2. Ces temps sont reportés sur une grille alignée sur la projection de la
 *    carte (Web Mercator), le long de chaque route, puis propagés hors réseau à
 *    VITESSE_HORS_ROUTE (routes secondaires, pistes et rues absentes du réseau
 *    national), sans sortir du territoire (masque des circonscriptions).
 *
 * C'est une estimation de planification, aux vitesses de référence : ni
 * circulation, ni relief, ni sens interdits.
 */
import { cout, VITESSE_RUES } from './itineraire.js';
import { entrees, indexerAretes, MAJORATION_ACCES, RAYON_ENTREES_M } from './reseau-national.js';
import { METRES_PAR_DEGRE } from './mesure.js';

// L'index des arêtes sert aussi à l'itinéraire : il vit dans reseau-national.js.
export { indexerAretes };

/** km/h, hors du réseau national. */
export const VITESSE_HORS_ROUTE = 20;
/** Bornes des classes de temps (minutes) et couleurs (vert → rouge foncé). */
export const BANDES = Object.freeze([15, 30, 45, 60, 90, 120]);
export const COULEURS_BANDES = Object.freeze(['#1a9850', '#91cf60', '#d9ef8b', '#fee08b', '#fc8d59', '#d73027', '#7f0000']);
const ALPHA = 165;

// ── Tas binaire sur tableaux typés ─────────────────────────────────────────

class Tas {
  constructor(capacite = 1024) {
    this.prio = new Float64Array(capacite);
    this.val = new Int32Array(capacite);
    this.taille = 0;
  }
  ajouter(p, v) {
    if (this.taille === this.prio.length) {
      const prio = new Float64Array(this.prio.length * 2);
      const val = new Int32Array(this.val.length * 2);
      prio.set(this.prio);
      val.set(this.val);
      this.prio = prio;
      this.val = val;
    }
    const { prio, val } = this;
    let i = this.taille++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= p) break;
      prio[i] = prio[parent];
      val[i] = val[parent];
      i = parent;
    }
    prio[i] = p;
    val[i] = v;
  }
  /** Retire le minimum ; sa priorité est dans `this.dernier`. */
  extraire() {
    const { prio, val } = this;
    const haut = val[0];
    this.dernier = prio[0];
    const n = --this.taille;
    const p = prio[n];
    const v = val[n];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) break;
      if (m + 1 < n && prio[m + 1] < prio[m]) m += 1;
      if (prio[m] >= p) break;
      prio[i] = prio[m];
      val[i] = val[m];
      i = m;
    }
    prio[i] = p;
    val[i] = v;
    return haut;
  }
}

// ── Réseau ─────────────────────────────────────────────────────────────────

/**
 * Plus court temps (secondes) de chaque nœud du réseau depuis la source la plus
 * rapide. L'accès d'une source au réseau suit la même règle que l'itinéraire
 * (vol d'oiseau majoré, à vitesse de rue).
 * @param {number[][]} sources  [lon, lat]
 * @returns {{ temps: Float64Array, proprio: Int32Array }}  proprio : indice de la source (-1 si hors d'atteinte)
 */
export function tempsDepuis(reseau, index, sources, { limite = Infinity } = {}) {
  const { lon: X, debut, cibles, poids, vitesses } = reseau;
  const n = X.length;
  const temps = new Float64Array(n).fill(Infinity);
  const proprio = new Int32Array(n).fill(-1);
  const tas = new Tas(1 << 16);
  const relacher = (u, t, s) => {
    if (t < temps[u] && t <= limite) {
      temps[u] = t;
      proprio[u] = s;
      tas.ajouter(t, u);
    }
  };
  sources.forEach((source, s) => {
    for (const e of entrees(reseau, source, { aretes: index.autour(source, RAYON_ENTREES_M) })) {
      const acces = cout(e.d * MAJORATION_ACCES, VITESSE_RUES, 'autoroute');
      relacher(e.u, acces + cout(e.w * e.t, e.vitesse, 'autoroute'), s);
      relacher(e.v, acces + cout(e.w * (1 - e.t), e.vitesse, 'autoroute'), s);
    }
  });
  while (tas.taille) {
    const x = tas.extraire();
    const t = tas.dernier;
    if (t > temps[x]) continue;
    for (let k = debut[x]; k < debut[x + 1]; k++) relacher(cibles[k], t + cout(poids[k], vitesses[k], 'autoroute'), proprio[x]);
  }
  return { temps, proprio };
}

// ── Grille Web Mercator ────────────────────────────────────────────────────

const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const latDeMercY = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * Grille de cellules carrées en Web Mercator couvrant [ouest, sud, est, nord],
 * `pas` degrés de longitude par cellule : l'image se superpose exactement à la carte.
 */
export function grilleMercator([ouest, sud, est, nord], pas) {
  const x0 = mercX(ouest);
  const y0 = mercY(nord);
  const d = pas / 360;
  const largeur = Math.max(1, Math.ceil((mercX(est) - x0) / d));
  const hauteur = Math.max(1, Math.ceil((mercY(sud) - y0) / d));
  const latitudes = new Float64Array(hauteur);
  const metres = new Float64Array(hauteur); // côté d'une cellule, par ligne
  for (let r = 0; r < hauteur; r++) {
    latitudes[r] = latDeMercY(y0 + (r + 0.5) * d);
    metres[r] = pas * METRES_PAR_DEGRE * Math.cos((latitudes[r] * Math.PI) / 180);
  }
  return {
    largeur, hauteur, pas, x0, y0, d, latitudes, metres,
    ouest, est: ouest + largeur * pas, nord, sud: latDeMercY(y0 + hauteur * d),
  };
}

/** Indice de la cellule contenant [lon, lat], ou -1 hors de la grille. */
export function celluleDe(g, [lon, lat]) {
  const c = Math.floor((mercX(lon) - g.x0) / g.d);
  const r = Math.floor((mercY(lat) - g.y0) / g.d);
  return c < 0 || r < 0 || c >= g.largeur || r >= g.hauteur ? -1 : r * g.largeur + c;
}

/** Coins de l'image pour une source MapLibre de type « image ». */
export function coins(g) {
  return [[g.ouest, g.nord], [g.est, g.nord], [g.est, g.sud], [g.ouest, g.sud]];
}

/**
 * Masque (1 = territoire) : cellules dont le centre est dans l'un des polygones
 * (GeoJSON Polygon / MultiPolygon, trous compris), par balayage de lignes.
 */
export function rasteriserMasque(g, geometries) {
  const masque = new Uint8Array(g.largeur * g.hauteur);
  const ligneDe = (lat) => (mercY(lat) - g.y0) / g.d - 0.5; // ligne fractionnaire du centre
  for (const geometrie of geometries) {
    const polygones = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.type === 'MultiPolygon' ? geometrie.coordinates : [];
    for (const anneaux of polygones) {
      const croisements = new Map(); // ligne → longitudes des bords qui la traversent
      for (const anneau of anneaux) {
        for (let i = 1; i < anneau.length; i++) {
          const [lonA, latA] = anneau[i - 1];
          const [lonB, latB] = anneau[i];
          const ra = ligneDe(latA);
          const rb = ligneDe(latB);
          if (ra === rb) continue;
          // Lignes r telles que le centre (r) est dans [min, max[ : chaque sommet compté une fois.
          const r0 = Math.max(0, Math.ceil(Math.min(ra, rb)));
          const r1 = Math.min(g.hauteur - 1, Math.ceil(Math.max(ra, rb)) - 1);
          for (let r = r0; r <= r1; r++) {
            const t = (r - ra) / (rb - ra);
            if (!croisements.has(r)) croisements.set(r, []);
            croisements.get(r).push(lonA + t * (lonB - lonA));
          }
        }
      }
      for (const [r, lons] of croisements) {
        lons.sort((a, b) => a - b);
        for (let i = 0; i + 1 < lons.length; i += 2) {
          const c0 = Math.max(0, Math.ceil((mercX(lons[i]) - g.x0) / g.d - 0.5));
          const c1 = Math.min(g.largeur - 1, Math.floor((mercX(lons[i + 1]) - g.x0) / g.d - 0.5));
          if (c1 >= c0) masque.fill(1, r * g.largeur + c0, r * g.largeur + c1 + 1);
        }
      }
    }
  }
  return masque;
}

/**
 * Temps (secondes) de chaque cellule du territoire : reporté le long des routes,
 * puis propagé hors réseau à `vitesseHorsRoute` (distance de chanfrein 8-voisins).
 * @returns {{ temps: Float32Array, proprio: Int32Array }}  Infinity / -1 hors d'atteinte ou hors territoire
 */
export function tempsSurGrille(reseau, { temps: tNoeuds, proprio: pNoeuds }, g, masque, {
  sources = [], vitesseHorsRoute = VITESSE_HORS_ROUTE, limite = Infinity,
} = {}) {
  const { lon: X, lat: Y, debut, cibles, poids, vitesses } = reseau;
  const { largeur, hauteur } = g;
  const temps = new Float32Array(largeur * hauteur).fill(Infinity);
  const proprio = new Int32Array(largeur * hauteur).fill(-1);
  const deposer = (lon, lat, t, s) => {
    if (t > limite) return;
    const i = celluleDe(g, [lon, lat]);
    if (i >= 0 && masque[i] && t < temps[i]) {
      temps[i] = t;
      proprio[i] = s;
    }
  };

  // Le long de chaque route : à une fraction f de u vers v, le meilleur des deux sens.
  for (let u = 0; u < X.length; u++) {
    for (let k = debut[u]; k < debut[u + 1]; k++) {
      const v = cibles[k];
      if (v < u) continue;
      const tu = tNoeuds[u];
      const tv = tNoeuds[v];
      if (tu === Infinity && tv === Infinity) continue;
      const duree = cout(poids[k], vitesses[k], 'autoroute');
      const cellules = Math.max(Math.abs(X[v] - X[u]), Math.abs(Y[v] - Y[u]) * 1.25) / g.pas;
      const pasN = Math.max(1, Math.ceil(cellules * 2));
      for (let j = 0; j <= pasN; j++) {
        const f = j / pasN;
        const depuisU = tu + f * duree;
        const depuisV = tv + (1 - f) * duree;
        if (depuisU <= depuisV) deposer(X[u] + f * (X[v] - X[u]), Y[u] + f * (Y[v] - Y[u]), depuisU, pNoeuds[u]);
        else deposer(X[u] + f * (X[v] - X[u]), Y[u] + f * (Y[v] - Y[u]), depuisV, pNoeuds[v]);
      }
    }
  }
  sources.forEach((p, s) => deposer(p[0], p[1], 0, s));

  // Hors réseau : deux allers-retours de chanfrein (côté et diagonale, en secondes).
  const v = vitesseHorsRoute / 3.6;
  const cote = Float64Array.from(g.metres, (m) => m / v);
  const voisinage = (i, r, rr, cc, diagonale) => {
    if (rr < 0 || cc < 0 || rr >= hauteur || cc >= largeur) return;
    const j = rr * largeur + cc;
    if (!masque[j] || temps[j] === Infinity) return;
    const t = temps[j] + (diagonale ? Math.SQRT2 : 1) * (cote[r] + cote[rr]) / 2;
    if (t < temps[i] && t <= limite) {
      temps[i] = t;
      proprio[i] = proprio[j];
    }
  };
  for (let passe = 0; passe < 2; passe++) {
    for (let r = 0; r < hauteur; r++) {
      for (let c = 0; c < largeur; c++) {
        const i = r * largeur + c;
        if (!masque[i]) continue;
        voisinage(i, r, r, c - 1, false); voisinage(i, r, r - 1, c - 1, true);
        voisinage(i, r, r - 1, c, false); voisinage(i, r, r - 1, c + 1, true);
      }
    }
    for (let r = hauteur - 1; r >= 0; r--) {
      for (let c = largeur - 1; c >= 0; c--) {
        const i = r * largeur + c;
        if (!masque[i]) continue;
        voisinage(i, r, r, c + 1, false); voisinage(i, r, r + 1, c + 1, true);
        voisinage(i, r, r + 1, c, false); voisinage(i, r, r + 1, c - 1, true);
      }
    }
  }
  return { temps, proprio };
}

/** Classe de temps d'une durée en secondes : 0 (≤ 15 min) … BANDES.length (au-delà). */
export function bandeDe(secondes) {
  const minutes = secondes / 60;
  const i = BANDES.findIndex((b) => minutes <= b);
  return i < 0 ? BANDES.length : i;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Image RGBA (largeur × hauteur) : couleur de la classe de temps, transparente ailleurs. */
export function colorer(g, temps) {
  const palette = COULEURS_BANDES.map(rgb);
  const pixels = new Uint8ClampedArray(g.largeur * g.hauteur * 4);
  for (let i = 0; i < temps.length; i++) {
    if (temps[i] === Infinity) continue;
    const [r, v, b] = palette[bandeDe(temps[i])];
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = v;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = ALPHA;
  }
  return pixels;
}

/**
 * Part du territoire (surface) par classe de temps.
 * @returns {{ parts: number[], horsAtteinte: number, km2: number }}  parts.length = BANDES.length + 1
 */
export function statistiques(g, temps, masque) {
  const surfaces = new Float64Array(BANDES.length + 1);
  let hors = 0;
  let total = 0;
  for (let r = 0; r < g.hauteur; r++) {
    const a = g.metres[r] ** 2;
    for (let c = 0; c < g.largeur; c++) {
      const i = r * g.largeur + c;
      if (!masque[i]) continue;
      total += a;
      if (temps[i] === Infinity) hors += a;
      else surfaces[bandeDe(temps[i])] += a;
    }
  }
  return {
    parts: Array.from(surfaces, (s) => (total ? s / total : 0)),
    horsAtteinte: total ? hors / total : 0,
    km2: total / 1e6,
  };
}

/** Emprise [ouest, sud, est, nord] d'un ensemble de géométries GeoJSON. */
export function empriseDe(geometries) {
  const e = [Infinity, Infinity, -Infinity, -Infinity];
  const visiter = (c) => {
    if (typeof c[0] === 'number') {
      e[0] = Math.min(e[0], c[0]); e[1] = Math.min(e[1], c[1]);
      e[2] = Math.max(e[2], c[0]); e[3] = Math.max(e[3], c[1]);
    } else c.forEach(visiter);
  };
  for (const geometrie of geometries) visiter(geometrie.coordinates);
  return e;
}
