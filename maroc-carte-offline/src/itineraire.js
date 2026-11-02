/**
 * Itinéraire hors ligne le long des routes.
 *
 * Les tuiles vectorielles locales (couche `roads`) autour des deux points sont
 * décodées et transformées en graphe : les sommets partagés relient les voies,
 * les croisements et les raccords en T sont détectés géométriquement (les
 * tuiles peuvent avoir simplifié le sommet commun), mais un pont ou un tunnel
 * n'est jamais relié à la route qu'il franchit. Le plus court chemin est
 * ensuite calculé par A*.
 *
 * Coordonnées internes : « globales » à un niveau de zoom donné, en unités de
 * tuile (4096 par tuile), donc identiques d'une tuile voisine à l'autre.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { distanceMetres, emprise } from './mesure.js';

const ETENDUE = 4096;
/** Pas des routes : voies ferrées, bacs, téléphériques, pistes d'aéroport, cheminements piétons. */
const NON_ROUTIERS = new Set(['rail', 'ferry', 'aerialway', 'aeroway', 'path']);

/**
 * Vitesses de référence (km/h) par catégorie OSM. En mode « autoroutes en priorité »,
 * le chemin retenu est celui du plus faible temps estimé : les autoroutes l'emportent
 * dès que le détour est raisonnable. La distance affichée reste la longueur réelle.
 */
const VITESSES = {
  motorway: 120, motorway_link: 60,
  trunk: 100, trunk_link: 50,
  primary: 80, primary_link: 40,
  secondary: 70, secondary_link: 40,
  tertiary: 60, tertiary_link: 35,
  unclassified: 50, residential: 30, living_street: 15, service: 20, track: 15,
};
export const VITESSE_MAX = 120;
/** Vitesse supposée des rues absentes des tuiles à petite échelle (traversées de ville). */
export const VITESSE_RUES = 30;

export function vitesseRoute(proprietes = {}) {
  return VITESSES[proprietes.kind_detail]
    ?? (proprietes.kind === 'highway' ? VITESSES.motorway : proprietes.kind === 'major_road' ? 60 : VITESSE_RUES);
}

/**
 * Coût d'un tronçon : secondes (`'autoroute'`, autoroutes en priorité) ou mètres (`'court'`).
 * @param {'autoroute' | 'court'} priorite
 */
export function cout(metres, vitesse, priorite) {
  return priorite === 'court' ? metres : metres / (vitesse / 3.6);
}
const MAX_TUILES = 36;
const ZOOM_MAX = 15;
const ZOOM_MIN = 10;
/** Au-delà (à vol d'oiseau), le tronçon passe par le réseau national précalculé. */
const SEUIL_LOCAL_M = 15_000;
/** En deçà, le départ / l'arrivée est relié directement au réseau national. */
const ACCES_DIRECT_M = 30;

// ── Projection ─────────────────────────────────────────────────────────────

export function versGlobal([lon, lat], z) {
  const n = ETENDUE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

export function versLonLat([x, y], z) {
  const n = ETENDUE * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lon, lat];
}

// ── Graphe ─────────────────────────────────────────────────────────────────

const cleDe = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;

function projeter(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { t, q, d2: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 };
}

function croisement(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (denom === 0) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null; // les extrémités sont traitées à part
  return { t, u, p: [a[0] + t * r[0], a[1] + t * r[1]] };
}

/**
 * @param {{ points: number[][], niveau?: number, vitesse?: number }[]} lignes  coordonnées planes ; vitesse en km/h
 * @param {{ longueur?: (p, q) => number, tolerance?: number, cellule?: number }} options
 *   `longueur` : poids d'une arête (mètres) ; `tolerance` : distance (unités) sous
 *   laquelle l'extrémité d'une voie est considérée comme raccordée à une autre.
 */
export function construireGraphe(lignes, { longueur, tolerance = 1.5, cellule = 128 } = {}) {
  const poids = longueur ?? ((p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]));
  const segments = [];
  lignes.forEach((ligne, l) => {
    for (let i = 1; i < ligne.points.length; i++) {
      const a = ligne.points[i - 1];
      const b = ligne.points[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      segments.push({ a, b, ligne: l, niveau: ligne.niveau ?? 0, vitesse: ligne.vitesse ?? 50, coupes: [] });
    }
  });

  // Index spatial : chaque segment est rangé dans les cellules de sa boîte englobante.
  const grille = new Map();
  segments.forEach((s, i) => {
    const x0 = Math.floor((Math.min(s.a[0], s.b[0]) - tolerance) / cellule);
    const x1 = Math.floor((Math.max(s.a[0], s.b[0]) + tolerance) / cellule);
    const y0 = Math.floor((Math.min(s.a[1], s.b[1]) - tolerance) / cellule);
    const y1 = Math.floor((Math.max(s.a[1], s.b[1]) + tolerance) / cellule);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      if (!grille.has(k)) grille.set(k, []);
      grille.get(k).push(i);
    }
  });

  const tol2 = tolerance * tolerance;
  const vus = new Set();
  const liens = []; // extrémités face à face, à relier après coup
  const raccorder = (extremite, cible) => {
    const { t, d2 } = projeter(extremite, cible.a, cible.b);
    if (d2 > tol2) return;
    if (t > 0 && t < 1) cible.coupes.push({ t, p: extremite });
    else {
      const bout = t === 0 ? cible.a : cible.b;
      if (bout[0] !== extremite[0] || bout[1] !== extremite[1]) liens.push([extremite, bout, cible.vitesse]);
    }
  };
  for (const indices of grille.values()) {
    for (let m = 0; m < indices.length; m++) {
      for (let n = m + 1; n < indices.length; n++) {
        const [i, j] = indices[m] < indices[n] ? [indices[m], indices[n]] : [indices[n], indices[m]];
        const cle = i * segments.length + j;
        if (vus.has(cle)) continue;
        vus.add(cle);
        const s = segments[i];
        const u = segments[j];
        // Un pont ou un tunnel ne croise pas la route qu'il franchit (niveaux différents),
        // mais ses extrémités, elles, rejoignent la route : les raccords sont toujours permis.
        if (s.ligne !== u.ligne && s.niveau === u.niveau) {
          const x = croisement(s.a, s.b, u.a, u.b);
          if (x) {
            s.coupes.push({ t: x.t, p: x.p });
            u.coupes.push({ t: x.u, p: x.p });
          }
        }
        // Raccords en T (et morceaux de la même voie découpés par les tuiles).
        raccorder(s.a, u); raccorder(s.b, u); raccorder(u.a, s); raccorder(u.b, s);
      }
    }
  }

  const noeuds = [];
  const voisins = [];
  const index = new Map();
  const noeud = (p) => {
    const k = cleDe(p);
    let id = index.get(k);
    if (id === undefined) {
      id = noeuds.length;
      index.set(k, id);
      noeuds.push(p);
      voisins.push([]);
    }
    return id;
  };
  const aretes = [];
  for (const s of segments) {
    const etapes = [s.a, ...s.coupes.sort((x, y) => x.t - y.t).map((c) => c.p), s.b];
    for (let i = 1; i < etapes.length; i++) {
      const u = noeud(etapes[i - 1]);
      const v = noeud(etapes[i]);
      if (u === v) continue;
      const w = poids(noeuds[u], noeuds[v]);
      voisins[u].push([v, w, s.vitesse]);
      voisins[v].push([u, w, s.vitesse]);
      aretes.push([u, v, w, s.vitesse]);
    }
  }
  for (const [p, q, vitesse] of liens) {
    const u = noeud(p);
    const v = noeud(q);
    if (u === v) continue;
    const w = poids(noeuds[u], noeuds[v]);
    voisins[u].push([v, w, vitesse]);
    voisins[v].push([u, w, vitesse]);
    aretes.push([u, v, w, vitesse]);
  }
  return { noeuds, voisins, aretes, poids };
}

/** Arête du graphe la plus proche de `p` et point projeté. */
function accrocher(graphe, p) {
  let meilleure = null;
  for (const [u, v, w, vitesse] of graphe.aretes) {
    const r = projeter(p, graphe.noeuds[u], graphe.noeuds[v]);
    if (!meilleure || r.d2 < meilleure.d2) meilleure = { ...r, u, v, w, vitesse };
  }
  return meilleure;
}

/** Tas binaire minimal sur [priorité, valeur]. */
export class Tas {
  constructor() { this.t = []; }
  get taille() { return this.t.length; }
  ajouter(prio, val) {
    const t = this.t;
    t.push([prio, val]);
    let i = t.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (t[p][0] <= t[i][0]) break;
      [t[p], t[i]] = [t[i], t[p]];
      i = p;
    }
  }
  extraire() {
    const t = this.t;
    const haut = t[0];
    const bas = t.pop();
    if (t.length) {
      t[0] = bas;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1;
        const d = g + 1;
        let m = i;
        if (g < t.length && t[g][0] < t[m][0]) m = g;
        if (d < t.length && t[d][0] < t[m][0]) m = d;
        if (m === i) break;
        [t[m], t[i]] = [t[i], t[m]];
        i = m;
      }
    }
    return haut;
  }
}

/**
 * Meilleur chemin entre deux points quelconques, accrochés à la voie la plus proche.
 * `priorite` : `'autoroute'` (plus faible temps estimé) ou `'court'` (plus courte distance).
 * @returns {{ points: number[][], distance: number, secondes: number } | null}
 *   distance en mètres, secondes : temps estimé aux vitesses de référence
 */
export function cheminDansGraphe(graphe, depart, arrivee, { priorite = 'autoroute' } = {}) {
  if (!graphe.aretes.length) return null;
  const a = accrocher(graphe, depart);
  const b = accrocher(graphe, arrivee);
  const n = graphe.noeuds.length;
  const A = n;
  const B = n + 1;
  const position = (id) => (id === A ? a.q : id === B ? b.q : graphe.noeuds[id]);
  // Deux nœuds temporaires aux points d'accroche, reliés aux extrémités de leur arête.
  const extra = new Map([[A, []], [B, []]]);
  const lier = (x, y, w, vitesse) => {
    if (!extra.has(x)) extra.set(x, []);
    if (!extra.has(y)) extra.set(y, []);
    extra.get(x).push([y, w, vitesse]);
    extra.get(y).push([x, w, vitesse]);
  };
  lier(A, a.u, a.w * a.t, a.vitesse);
  lier(A, a.v, a.w * (1 - a.t), a.vitesse);
  lier(B, b.u, b.w * b.t, b.vitesse);
  lier(B, b.v, b.w * (1 - b.t), b.vitesse);
  const memeArete = (a.u === b.u && a.v === b.v) || (a.u === b.v && a.v === b.u);
  if (memeArete) lier(A, B, graphe.poids(a.q, b.q), a.vitesse);

  const voisinsDe = (id) => (id < n ? graphe.voisins[id].concat(extra.get(id) ?? []) : extra.get(id));
  const cible = position(B);
  // Heuristique admissible : vol d'oiseau à la vitesse maximale.
  const h = (id) => cout(graphe.poids(position(id), cible), VITESSE_MAX, priorite);
  const g = new Map([[A, 0]]);
  const metres = new Map([[A, 0]]);
  const secondes = new Map([[A, 0]]);
  const precedent = new Map();
  const tas = new Tas();
  tas.ajouter(h(A), A);
  const fermes = new Set();
  while (tas.taille) {
    const [, x] = tas.extraire();
    if (x === B) break;
    if (fermes.has(x)) continue;
    fermes.add(x);
    const gx = g.get(x);
    for (const [y, w, vitesse] of voisinsDe(x)) {
      const essai = gx + cout(w, vitesse ?? VITESSE_RUES, priorite);
      if (essai < (g.get(y) ?? Infinity)) {
        g.set(y, essai);
        metres.set(y, metres.get(x) + w);
        secondes.set(y, secondes.get(x) + cout(w, vitesse ?? VITESSE_RUES, 'autoroute'));
        precedent.set(y, x);
        tas.ajouter(essai + h(y), y);
      }
    }
  }
  if (!g.has(B)) return null;
  const ids = [B];
  while (ids[0] !== A) ids.unshift(precedent.get(ids[0]));
  return { points: ids.map(position), distance: metres.get(B), secondes: secondes.get(B) };
}

/**
 * Coût (selon `priorite`), longueur et temps du meilleur chemin de `depart` vers
 * chacun des `cibles` (points quelconques, accrochés à la voie la plus proche).
 * Un seul parcours de Dijkstra pour toutes les cibles.
 * @returns {({ cout: number, distance: number, secondes: number } | null)[]}
 */
export function coutsDepuis(graphe, depart, cibles, { priorite = 'autoroute' } = {}) {
  if (!graphe.aretes.length) return cibles.map(() => null);
  const a = accrocher(graphe, depart);
  const n = graphe.noeuds.length;
  const g = new Float64Array(n).fill(Infinity);
  const metres = new Float64Array(n);
  const secondes = new Float64Array(n);
  const tas = new Tas();
  const partir = (u, w) => {
    const c = cout(w, a.vitesse, priorite);
    if (c < g[u]) {
      g[u] = c;
      metres[u] = w;
      secondes[u] = cout(w, a.vitesse, 'autoroute');
      tas.ajouter(c, u);
    }
  };
  partir(a.u, a.w * a.t);
  partir(a.v, a.w * (1 - a.t));
  while (tas.taille) {
    const [gx, x] = tas.extraire();
    if (gx > g[x]) continue;
    for (const [y, w, vitesse] of graphe.voisins[x]) {
      const essai = gx + cout(w, vitesse ?? VITESSE_RUES, priorite);
      if (essai < g[y]) {
        g[y] = essai;
        metres[y] = metres[x] + w;
        secondes[y] = secondes[x] + cout(w, vitesse ?? VITESSE_RUES, 'autoroute');
        tas.ajouter(essai, y);
      }
    }
  }
  return cibles.map((cible) => {
    const b = accrocher(graphe, cible);
    const memeArete = (a.u === b.u && a.v === b.v) || (a.u === b.v && a.v === b.u);
    const options = [
      [b.u, b.w * b.t],
      [b.v, b.w * (1 - b.t)],
    ].filter(([u]) => g[u] < Infinity).map(([u, w]) => ({
      cout: g[u] + cout(w, b.vitesse, priorite), distance: metres[u] + w, secondes: secondes[u] + cout(w, b.vitesse, 'autoroute'),
    }));
    if (memeArete) {
      const w = graphe.poids(a.q, b.q);
      options.push({ cout: cout(w, a.vitesse, priorite), distance: w, secondes: cout(w, a.vitesse, 'autoroute') });
    }
    return options.length ? options.reduce((m, o) => (o.cout < m.cout ? o : m)) : null;
  });
}

// ── Lecture des tuiles ─────────────────────────────────────────────────────

function tuilesCouvrant(bbox, z) {
  const [x0, y0] = versGlobal([bbox[0], bbox[3]], z).map((v) => Math.floor(v / ETENDUE));
  const [x1, y1] = versGlobal([bbox[2], bbox[1]], z).map((v) => Math.floor(v / ETENDUE));
  const liste = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) liste.push([z, x, y]);
  return liste;
}

async function decompresser(donnees) {
  const octets = new Uint8Array(donnees);
  if (octets[0] !== 0x1f || octets[1] !== 0x8b) return octets;
  const flux = new Blob([octets]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/**
 * Réseau routier lu à la demande dans l'archive PMTiles locale ; les longs
 * tronçons passent par le réseau national précalculé (reseau-national.js).
 */
export class ReseauRoutier {
  /**
   * @param {import('pmtiles').PMTiles} archive
   * @param {{ national?: { itineraire(a, b): Promise<{ chemin: number[][], distance: number } | null> } }} options
   */
  constructor(archive, { national = null } = {}) {
    this.archive = archive;
    this.national = national;
    this.tuiles = new Map();
    this.dernierGraphe = null;
  }

  _tuile(z, x, y) {
    const cle = `${z}/${x}/${y}`;
    if (!this.tuiles.has(cle)) {
      // Tuile illisible : aucune route cette fois, mais pas de mise en cache de l'échec.
      this.tuiles.set(cle, this._lireTuile(z, x, y).catch(() => {
        this.tuiles.delete(cle);
        return [];
      }));
      if (this.tuiles.size > 400) this.tuiles.delete(this.tuiles.keys().next().value);
    }
    return this.tuiles.get(cle);
  }

  async _lireTuile(z, x, y) {
    const reponse = await this.archive.getZxy(z, x, y);
    if (!reponse?.data) return [];
    const couche = new VectorTile(new PbfReader(await decompresser(reponse.data))).layers.roads;
    if (!couche) return [];
    const lignes = [];
    const echelle = ETENDUE / couche.extent;
    for (let i = 0; i < couche.length; i++) {
      const f = couche.feature(i);
      if (f.type !== 2 || NON_ROUTIERS.has(f.properties.kind)) continue;
      const p = f.properties;
      const niveau = p.is_bridge ? 1 : p.is_tunnel ? -1 : 0;
      const vitesse = vitesseRoute(p);
      // Nom et catégorie : ignorés par le graphe, utiles au bouclage (bouclage.js).
      const route = { nom: p.name ?? null, nomFr: p['name:fr'] ?? null, nomAr: p['name:ar'] ?? null, ref: p.ref ?? null, classe: p.kind_detail ?? p.kind ?? null };
      for (const ligne of f.loadGeometry()) {
        lignes.push({
          ...route,
          niveau,
          vitesse,
          points: ligne.map((p) => [(x * couche.extent + p.x) * echelle, (y * couche.extent + p.y) * echelle]),
        });
      }
    }
    return lignes;
  }

  async _graphe(bbox) {
    let z = ZOOM_MAX;
    while (z > ZOOM_MIN && tuilesCouvrant(bbox, z).length > MAX_TUILES) z -= 1;
    const tuiles = tuilesCouvrant(bbox, z);
    if (tuiles.length > MAX_TUILES) return null;
    const cle = tuiles.map((t) => t.join('/')).join(' ');
    if (this.dernierGraphe?.cle === cle) return this.dernierGraphe;
    const lignes = (await Promise.all(tuiles.map((t) => this._tuile(...t)))).flat();
    const graphe = construireGraphe(lignes, {
      longueur: (p, q) => distanceMetres(versLonLat(p, z), versLonLat(q, z)),
    });
    this.dernierGraphe = { cle, z, graphe };
    return this.dernierGraphe;
  }

  /**
   * Routes (en [lon, lat], avec nom et catégorie) d'une emprise [ouest, sud, est, nord],
   * lues au zoom le plus fin possible sans dépasser MAX_TUILES (au plus `zMax`).
   * @returns {Promise<{ z: number, lignes: { points: number[][], nom, nomFr, nomAr, ref, classe }[] } | null>}
   */
  async lignes(bbox, { zMax = ZOOM_MAX } = {}) {
    let z = zMax;
    while (z > ZOOM_MIN && tuilesCouvrant(bbox, z).length > MAX_TUILES) z -= 1;
    const tuiles = tuilesCouvrant(bbox, z);
    if (tuiles.length > MAX_TUILES) return null;
    const lignes = (await Promise.all(tuiles.map((t) => this._tuile(...t)))).flat();
    return { z, lignes: lignes.map((l) => ({ ...l, points: l.points.map((p) => versLonLat(p, z)) })) };
  }

  /**
   * Coûts entre tous les points deux à deux (matrice n × n, `null` si aucune route).
   * Points proches les uns des autres : un seul graphe local, un parcours par point.
   * Sinon, un itinéraire par paire (les routes sont supposées à double sens).
   * @param {(fait: number, total: number) => void} progression
   * @returns {Promise<({ cout: number, distance: number, secondes: number } | null)[][]>}
   */
  async matrice(points, { priorite = 'autoroute', progression = () => {} } = {}) {
    const n = points.length;
    const m = Array.from({ length: n }, () => Array(n).fill(null));
    for (let i = 0; i < n; i++) m[i][i] = { cout: 0, distance: 0, secondes: 0 };
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const coins = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
    if (distanceMetres(...coins) <= SEUIL_LOCAL_M * 2) {
      const resultat = await this._graphe(emprise(...coins, Math.max(1000, distanceMetres(...coins) * 0.3)));
      if (resultat) {
        const { z, graphe } = resultat;
        const enGlobal = points.map((p) => versGlobal(p, z));
        for (let i = 0; i < n; i++) {
          coutsDepuis(graphe, enGlobal[i], enGlobal, { priorite }).forEach((c, j) => { if (i !== j) m[i][j] = c; });
          progression(i + 1, n);
          await new Promise((r) => setTimeout(r)); // rendre la main à l'interface
        }
        return m;
      }
    }
    const paires = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) paires.push([i, j]);
    let fait = 0;
    for (const [i, j] of paires) {
      const r = await this.itineraire(points[i], points[j], { priorite }).catch(() => null);
      const c = r && { cout: priorite === 'court' ? r.distance : r.secondes, distance: r.distance, secondes: r.secondes };
      m[i][j] = c;
      m[j][i] = c;
      progression(++fait, paires.length);
    }
    return m;
  }

  /**
   * Itinéraire par la route entre deux points [lon, lat], sans limite de distance.
   * @param {{ priorite?: 'autoroute' | 'court' }} options  autoroutes en priorité (défaut) ou plus court chemin
   * @returns {Promise<{ chemin: number[][], distance: number, secondes: number, approximatif: boolean } | null>}
   */
  async itineraire(a, b, { priorite = 'autoroute' } = {}) {
    const court = distanceMetres(a, b) <= SEUIL_LOCAL_M;
    if (court) {
      const local = await this._itineraireLocal(a, b, priorite);
      if (local) return local;
    }
    const national = await this._itineraireNational(a, b, priorite);
    if (national) return national;
    return court ? null : this._itineraireLocal(a, b, priorite);
  }

  /** Long tronçon : rues jusqu'au grand axe le plus proche, réseau national, puis rues jusqu'à l'arrivée. */
  async _itineraireNational(a, b, priorite) {
    const principal = await this.national?.itineraire(a, b, { priorite }).catch(() => null);
    if (!principal) return null;
    const entree = principal.chemin[0];
    const sortie = principal.chemin.at(-1);
    const acces = async (de, vers) => {
      const direct = distanceMetres(de, vers);
      const droit = { chemin: [de, vers], distance: direct, secondes: cout(direct, VITESSE_RUES, 'autoroute') };
      if (direct <= ACCES_DIRECT_M) return droit;
      return (await this._itineraireLocal(de, vers, priorite)) ?? droit;
    };
    const [debut, fin] = await Promise.all([acces(a, entree), acces(sortie, b)]);
    return {
      chemin: [...debut.chemin, ...principal.chemin, ...fin.chemin],
      distance: debut.distance + principal.distance + fin.distance,
      secondes: debut.secondes + principal.secondes + fin.secondes,
      approximatif: true,
    };
  }

  async _itineraireLocal(a, b, priorite = 'autoroute') {
    const directe = distanceMetres(a, b);
    // D'abord une zone serrée, puis plus large si les routes font un détour.
    for (const facteur of [0.4, 1.5]) {
      const resultat = await this._graphe(emprise(a, b, Math.max(400, directe * facteur)));
      if (!resultat) return null;
      const { z, graphe } = resultat;
      const chemin = cheminDansGraphe(graphe, versGlobal(a, z), versGlobal(b, z), { priorite });
      if (chemin) {
        return {
          chemin: chemin.points.map((p) => versLonLat(p, z)), distance: chemin.distance, secondes: chemin.secondes, approximatif: z < 14,
        };
      }
    }
    return null;
  }
}
