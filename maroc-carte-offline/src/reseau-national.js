/**
 * Graphe routier national, pour les longues distances.
 *
 * Construit une fois (scripts/telecharger-donnees.mjs) à partir des tuiles au
 * zoom 9 — autoroutes, nationales, régionales — puis enregistré dans
 * `donnees/data/reseau-national.bin` et chargé par la carte au premier long
 * tronçon.
 *
 * À ce zoom, les traversées d'agglomération (boulevards de classe inférieure)
 * manquent. Chaque fin de route est donc raccordée à la route voisine la plus
 * proche (≤ 3 km) lorsque le réseau ne permet pas déjà de l'atteindre par un
 * chemin raisonnable — sans jamais franchir une frontière internationale. La
 * longueur d'un raccord est majorée pour tenir compte du détour par les rues.
 *
 * Chaque arc garde la vitesse de référence de sa catégorie (autoroute 120 km/h…),
 * pour pouvoir privilégier les autoroutes.
 *
 * Format binaire (petit-boutiste) :
 *   'MAR2' | nbNoeuds u32 | nbArcs u32 | réservé u32
 *   lon f32[n] | lat f32[n] | debut u32[n+1] | cibles u32[m] | poids f32[m] (mètres) | vitesses u8[m] (km/h)
 */
import { construireGraphe, cout, Tas, versLonLat, VITESSE_MAX, VITESSE_RUES } from './itineraire.js';
import { distanceMetres, METRES_PAR_DEGRE } from './mesure.js';

export const ZOOM_NATIONAL = 9;
const SIGNATURE = 0x3252414d; // 'MAR2'
const MAJORATION_RACCORD = 1.3;
/** Accès au réseau depuis un point quelconque : majoration du trajet à vol d'oiseau. */
export const MAJORATION_ACCES = 1.3;

/** Le fichier (ses 4 premiers octets suffisent) est-il au format actuel ? */
export function formatAJour(octets) {
  return octets.length >= 4 && new DataView(octets.buffer, octets.byteOffset, 4).getUint32(0, true) === SIGNATURE;
}

// ── Construction ───────────────────────────────────────────────────────────

function projeter(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return { t, q: [a[0] + t * dx, a[1] + t * dy] };
}

function seCoupent(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Index spatial simple de segments [a, b] en coordonnées planes. */
function indexer(segments, cellule) {
  const grille = new Map();
  segments.forEach(([a, b], i) => {
    for (let x = Math.floor(Math.min(a[0], b[0]) / cellule); x <= Math.floor(Math.max(a[0], b[0]) / cellule); x++) {
      for (let y = Math.floor(Math.min(a[1], b[1]) / cellule); y <= Math.floor(Math.max(a[1], b[1]) / cellule); y++) {
        const k = `${x},${y}`;
        if (!grille.has(k)) grille.set(k, []);
        grille.get(k).push(i);
      }
    }
  });
  return {
    autour(p, rayon) {
      const vus = new Set();
      for (let x = Math.floor((p[0] - rayon) / cellule); x <= Math.floor((p[0] + rayon) / cellule); x++) {
        for (let y = Math.floor((p[1] - rayon) / cellule); y <= Math.floor((p[1] + rayon) / cellule); y++) {
          for (const i of grille.get(`${x},${y}`) ?? []) vus.add(i);
        }
      }
      return vus;
    },
  };
}

/** Distances (mètres) par le réseau depuis `depart`, jusqu'à `limite`. */
function distancesBornees(voisins, depart, limite) {
  const dist = new Map([[depart, 0]]);
  const tas = new Tas();
  tas.ajouter(0, depart);
  while (tas.taille) {
    const [d, x] = tas.extraire();
    if (d > dist.get(x)) continue;
    for (const [y, w] of voisins[x]) {
      const essai = d + w;
      if (essai <= limite && essai < (dist.get(y) ?? Infinity)) {
        dist.set(y, essai);
        tas.ajouter(essai, y);
      }
    }
  }
  return dist;
}

/**
 * @param {{ points: number[][], niveau?: number, vitesse?: number }[]} routes   coordonnées globales au zoom `z`
 * @param {number[][][]} frontieres  lignes de frontières internationales (mêmes coordonnées)
 * @param {{ z?: number, raccordMax?: number, tolerance?: number }} options
 *   `raccordMax` en mètres ; `tolerance` en unités (extrémités jointes d'office).
 */
export function construireReseauNational(routes, frontieres = [], { z = ZOOM_NATIONAL, raccordMax = 3000, tolerance = 4 } = {}) {
  const enMetres = (p, q) => distanceMetres(versLonLat(p, z), versLonLat(q, z));
  // À ce zoom une unité vaut ≈ 16 m : deux classes successives d'une même route (trunk → primary)
  // peuvent s'arrêter à 1–3 unités l'une de l'autre. 4 unités (≈ 65 m) ne joignent que des extrémités.
  const g = construireGraphe(routes, { longueur: enMetres, tolerance });
  const noeuds = g.noeuds.slice();
  const voisins = g.voisins.map((v) => v.slice());

  // Rayon de recherche en unités planes, avec une marge pour les variations de latitude ;
  // la distance réelle de chaque candidat est ensuite vérifiée en mètres.
  const centre = noeuds[0] ?? [0, 0];
  const metresParUnite = enMetres(centre, [centre[0] + 1, centre[1]]) || 1;
  const rayon = (1.3 * raccordMax) / metresParUnite;
  const aretes = g.aretes.map(([u, v, , vitesse]) => [noeuds[u], noeuds[v], u, v, vitesse]);
  const indexAretes = indexer(aretes, Math.max(rayon, 1));
  const segmentsFrontiere = frontieres.flatMap((ligne) => ligne.slice(1).map((b, i) => [ligne[i], b]));
  const indexFrontiere = indexer(segmentsFrontiere, Math.max(rayon, 1));

  // Chaque fin de route : la route voisine la plus proche que le réseau ne permet pas
  // d'atteindre par un chemin raisonnable (≤ 2 × l'écart + 1 km).
  const finsDeRoute = g.voisins.map((v, n) => (v.length === 1 ? n : -1)).filter((n) => n >= 0);
  const candidats = [];
  for (const n of finsDeRoute) {
    const p = noeuds[n];
    const proches = distancesBornees(g.voisins, n, 2 * raccordMax + 1000);
    let meilleur = null;
    for (const i of indexAretes.autour(p, rayon)) {
      const [a, b, u, v, vitesse] = aretes[i];
      if (u === n || v === n) continue;
      const { q } = projeter(p, a, b);
      const d = enMetres(p, q);
      if (d > raccordMax || (meilleur && d >= meilleur.d)) continue;
      const parLeReseau = Math.min(proches.get(u) ?? Infinity, proches.get(v) ?? Infinity);
      if (parLeReseau <= 2 * d + 1000) continue; // déjà joignable sans détour
      const traverse = [...indexFrontiere.autour(p, rayon)].some((k) => seCoupent(p, q, ...segmentsFrontiere[k]));
      if (!traverse) meilleur = { n, q, u, v, d, vitesse };
    }
    if (meilleur) candidats.push(meilleur);
  }

  for (const c of candidats) {
    // Nouveau nœud au point d'accroche, relié aux deux extrémités de l'arête visée.
    const id = noeuds.length;
    noeuds.push(c.q);
    voisins.push([]);
    const lier = (x, y, w, vitesse) => { voisins[x].push([y, w, vitesse]); voisins[y].push([x, w, vitesse]); };
    lier(id, c.u, enMetres(c.q, noeuds[c.u]), c.vitesse);
    lier(id, c.v, enMetres(c.q, noeuds[c.v]), c.vitesse);
    lier(id, c.n, c.d * MAJORATION_RACCORD, VITESSE_RUES); // traversée de ville, par les rues
  }

  // Forme compacte (CSR) en longitude / latitude.
  const n = noeuds.length;
  const lon = new Float32Array(n);
  const lat = new Float32Array(n);
  const debut = new Uint32Array(n + 1);
  noeuds.forEach((p, i) => {
    [lon[i], lat[i]] = versLonLat(p, z);
    debut[i + 1] = debut[i] + voisins[i].length;
  });
  const cibles = new Uint32Array(debut[n]);
  const poids = new Float32Array(debut[n]);
  const vitesses = new Uint8Array(debut[n]);
  voisins.forEach((liste, i) => liste.forEach(([v, w, vitesse], k) => {
    cibles[debut[i] + k] = v;
    poids[debut[i] + k] = w;
    vitesses[debut[i] + k] = Math.min(255, vitesse ?? VITESSE_RUES);
  }));
  return { lon, lat, debut, cibles, poids, vitesses, raccords: candidats.length };
}

// ── Sérialisation ──────────────────────────────────────────────────────────

export function serialiser({ lon, lat, debut, cibles, poids, vitesses }) {
  const n = lon.length;
  const m = cibles.length;
  const octets = new Uint8Array(16 + 8 * n + 4 * (n + 1) + 9 * m);
  const vue = new DataView(octets.buffer);
  vue.setUint32(0, SIGNATURE, true);
  vue.setUint32(4, n, true);
  vue.setUint32(8, m, true);
  let decalage = 16;
  for (const tableau of [lon, lat, debut, cibles, poids, vitesses]) {
    octets.set(new Uint8Array(tableau.buffer, tableau.byteOffset, tableau.byteLength), decalage);
    decalage += tableau.byteLength;
  }
  return octets;
}

export function deserialiser(tampon) {
  if (tampon.byteLength < 16 || !formatAJour(new Uint8Array(tampon, 0, 16))) {
    throw new Error('reseau-national.bin : format inconnu ou ancien (relancez « npm run data »)');
  }
  const vue = new DataView(tampon);
  const n = vue.getUint32(4, true);
  const m = vue.getUint32(8, true);
  let decalage = 16;
  const lire = (Type, longueur) => {
    const tableau = new Type(tampon.slice(decalage, decalage + longueur * Type.BYTES_PER_ELEMENT));
    decalage += longueur * Type.BYTES_PER_ELEMENT;
    return tableau;
  };
  return {
    lon: lire(Float32Array, n), lat: lire(Float32Array, n), debut: lire(Uint32Array, n + 1),
    cibles: lire(Uint32Array, m), poids: lire(Float32Array, m), vitesses: lire(Uint8Array, m),
  };
}

// ── Index spatial ──────────────────────────────────────────────────────────

/** Rayon (mètres) où `entrees` cherche les accès au réseau. */
export const RAYON_ENTREES_M = 15_000;

/** Réseau prêt pour les itinéraires : le même, avec l'index spatial de ses arêtes (construit une fois). */
export function preparer(reseau) {
  return { ...reseau, index: indexerAretes(reseau) };
}

/** Index spatial des arêtes du réseau national (cellules de `cellule` degrés). */
export function indexerAretes(reseau, cellule = 0.1) {
  const { lon: X, lat: Y, debut, cibles } = reseau;
  const grille = new Map();
  const cle = (x, y) => x * 100_000 + y;
  for (let u = 0; u < X.length; u++) {
    for (let k = debut[u]; k < debut[u + 1]; k++) {
      const v = cibles[k];
      if (v < u) continue;
      const x0 = Math.floor(Math.min(X[u], X[v]) / cellule);
      const x1 = Math.floor(Math.max(X[u], X[v]) / cellule);
      const y0 = Math.floor(Math.min(Y[u], Y[v]) / cellule);
      const y1 = Math.floor(Math.max(Y[u], Y[v]) / cellule);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const c = cle(x, y);
          if (!grille.has(c)) grille.set(c, []);
          grille.get(c).push([u, k]);
        }
      }
    }
  }
  return {
    /** Arêtes [u, k] des cellules à moins de `rayonM` mètres de [lon, lat]. */
    autour([lon, lat], rayonM) {
      const dLat = rayonM / METRES_PAR_DEGRE;
      const dLon = dLat / Math.cos((lat * Math.PI) / 180);
      const liste = [];
      const vues = new Set();
      for (let x = Math.floor((lon - dLon) / cellule); x <= Math.floor((lon + dLon) / cellule); x++) {
        for (let y = Math.floor((lat - dLat) / cellule); y <= Math.floor((lat + dLat) / cellule); y++) {
          for (const arete of grille.get(cle(x, y)) ?? []) {
            if (vues.has(arete[1])) continue;
            vues.add(arete[1]);
            liste.push(arete);
          }
        }
      }
      return liste;
    },
  };
}

// ── Meilleur chemin ────────────────────────────────────────────────────────

/**
 * Points d'entrée possibles sur le réseau autour de `point` [lon, lat] : la route la
 * plus proche, plus les autres routes dans un rayon de 3 × cette distance (≥ 3 km,
 * ≤ 15 km), espacées d'au moins 300 m. Plusieurs entrées évitent qu'un départ en
 * ville, accroché à la mauvaise route, impose un long détour.
 */
export function entrees(reseau, [lon, lat], { max = 8, aretes = null } = {}) {
  const { lon: X, lat: Y, debut, cibles, poids, vitesses } = reseau;
  const c = Math.cos((lat * Math.PI) / 180);
  const liste = [];
  const examiner = (u, k) => {
    const v = cibles[k];
    if (v < u) return; // chaque arête une seule fois
    const ax = (X[u] - lon) * c, ay = Y[u] - lat;
    const dx = (X[v] - lon) * c - ax, dy = Y[v] - lat - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    const d = Math.hypot(ax + t * dx, ay + t * dy) * METRES_PAR_DEGRE;
    if (d <= RAYON_ENTREES_M) liste.push({ u, v, t, d, w: poids[k], vitesse: vitesses[k] });
  };
  // `aretes` : candidates [u, k] déjà présélectionnées (index spatial), sinon tout le réseau.
  if (aretes) for (const [u, k] of aretes) examiner(u, k);
  else for (let u = 0; u < X.length; u++) for (let k = debut[u]; k < debut[u + 1]; k++) examiner(u, k);
  if (!liste.length) return [];
  // Égalités départagées par les nœuds : le résultat ne dépend pas de l'ordre de lecture (index ou réseau entier).
  liste.sort((x, y) => x.d - y.d || x.u - y.u || x.v - y.v);
  const rayon = Math.min(RAYON_ENTREES_M, Math.max(3000, 3 * liste[0].d));
  const choisies = [];
  for (const e of liste) {
    if (e.d > rayon || choisies.length >= max) break;
    e.point = [X[e.u] + e.t * (X[e.v] - X[e.u]), Y[e.u] + e.t * (Y[e.v] - Y[e.u])];
    if (choisies.some((o) => distanceMetres(o.point, e.point) < 300)) continue;
    choisies.push(e);
  }
  return choisies;
}

/**
 * Meilleur chemin (A*) entre deux points [lon, lat] par le réseau national :
 * `priorite` `'autoroute'` (plus faible temps estimé) ou `'court'` (plus courte distance).
 * L'accès au réseau (≈ vol d'oiseau majoré, à vitesse de rue) ne sert qu'à choisir les
 * meilleures entrée et sortie : `chemin` et `distance` (mètres) vont de l'entrée à la
 * sortie, l'appelant calcule ensuite l'accès réel par les rues.
 * @returns {{ chemin: number[][], distance: number, secondes: number } | null}
 */
export function cheminNational(reseau, depart, arrivee, { priorite = 'autoroute' } = {}) {
  // Avec l'index (preparer), seules les arêtes des cellules voisines sont examinées, pas le million d'arcs.
  const candidates = (p) => (reseau.index ? { aretes: reseau.index.autour(p, RAYON_ENTREES_M) } : {});
  const sources = entrees(reseau, depart, candidates(depart));
  const puits = entrees(reseau, arrivee, candidates(arrivee));
  if (!sources.length || !puits.length) return null;
  const { lon: X, lat: Y, debut, cibles, poids, vitesses } = reseau;
  const n = X.length;
  // Nœuds virtuels : A, B, puis une entrée par source et une sortie par puits.
  const A = n;
  const B = n + 1;
  const idSource = (i) => n + 2 + i;
  const idPuits = (j) => n + 2 + sources.length + j;
  const total = n + 2 + sources.length + puits.length;
  const position = (id) => {
    if (id < n) return [X[id], Y[id]];
    if (id === A) return depart;
    if (id === B) return arrivee;
    const i = id - n - 2;
    return i < sources.length ? sources[i].point : puits[i - sources.length].point;
  };

  const extra = new Map();
  const lier = (x, y, w, vitesse) => {
    if (!extra.has(x)) extra.set(x, []);
    extra.get(x).push([y, w, vitesse]);
  };
  sources.forEach((s, i) => {
    lier(A, idSource(i), s.d * MAJORATION_ACCES, VITESSE_RUES);
    lier(idSource(i), s.u, s.w * s.t, s.vitesse);
    lier(idSource(i), s.v, s.w * (1 - s.t), s.vitesse);
  });
  puits.forEach((p, j) => {
    lier(p.u, idPuits(j), p.w * p.t, p.vitesse);
    lier(p.v, idPuits(j), p.w * (1 - p.t), p.vitesse);
    lier(idPuits(j), B, p.d * MAJORATION_ACCES, VITESSE_RUES);
    // Entrée et sortie sur la même arête : liaison directe le long de la route.
    sources.forEach((s, i) => {
      const meme = (s.u === p.u && s.v === p.v) || (s.u === p.v && s.v === p.u);
      if (meme) lier(idSource(i), idPuits(j), distanceMetres(s.point, p.point), s.vitesse);
    });
  });

  // Heuristique admissible : la sortie la plus proche est au plus à `rayonPuits` de l'arrivée,
  // et aucune route ne dépasse VITESSE_MAX.
  const rayonPuits = Math.max(...puits.map((p) => p.d));
  const h = (id) => cout(Math.max(0, distanceMetres(position(id), arrivee) - rayonPuits), VITESSE_MAX, priorite);
  const g = new Float64Array(total).fill(Infinity);
  const metres = new Float64Array(total);
  const secondes = new Float64Array(total);
  const precedent = new Int32Array(total).fill(-1);
  const ferme = new Uint8Array(total);
  const tas = new Tas();
  g[A] = 0;
  tas.ajouter(h(A), A);
  while (tas.taille) {
    const [, x] = tas.extraire();
    if (x === B) break;
    if (ferme[x]) continue;
    ferme[x] = 1;
    const relacher = (y, w, vitesse) => {
      const essai = g[x] + cout(w, vitesse, priorite);
      if (essai < g[y]) {
        g[y] = essai;
        metres[y] = metres[x] + w;
        secondes[y] = secondes[x] + cout(w, vitesse, 'autoroute');
        precedent[y] = x;
        tas.ajouter(essai + h(y), y);
      }
    };
    if (x < n) for (let k = debut[x]; k < debut[x + 1]; k++) relacher(cibles[k], poids[k], vitesses[k]);
    for (const [y, w, vitesse] of extra.get(x) ?? []) relacher(y, w, vitesse);
  }
  if (g[B] === Infinity) return null;
  const ids = [];
  for (let id = precedent[B]; id !== A; id = precedent[id]) ids.unshift(id);
  // ids : [entrée, …, sortie] ; la distance exclut l'accès estimé de part et d'autre.
  const entree = ids[0];
  const sortie = ids.at(-1);
  return { chemin: ids.map(position), distance: metres[sortie] - metres[entree], secondes: secondes[sortie] - secondes[entree] };
}

/** Réseau national chargé à la demande depuis le serveur local. */
export class ReseauNational {
  constructor(url) {
    this.url = url;
    this._chargement = null;
  }

  charger() {
    this._chargement ??= fetch(this.url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((tampon) => preparer(deserialiser(tampon)))
      .catch((erreur) => {
        // Fichier absent ou ancien : pas de réseau national. Échec réseau (TypeError) : nouvel essai au prochain appel.
        if (erreur instanceof TypeError) this._chargement = null;
        return null;
      });
    return this._chargement;
  }

  async itineraire(a, b, options) {
    const reseau = await this.charger();
    return reseau ? cheminNational(reseau, a, b, options) : null;
  }
}
