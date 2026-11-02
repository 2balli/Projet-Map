/**
 * Construction de l'index de recherche (`donnees/data/recherche.json`) à partir
 * des tuiles locales — aucune connexion nécessaire.
 *
 *   lieux (villes, villages, quartiers) : couche `places`, zooms 10 et 14
 *   POI (pharmacies, mosquées, écoles…)  : couche `pois`, zoom 14 partout, zoom 15 en zone habitée
 *   rues et routes nommées (et numéros A7, N9…) : couche `roads`, zoom 14
 *   régions : les 12 régions officielles
 *
 * Un même objet apparaît dans plusieurs tuiles (et une rue en plusieurs morceaux) :
 * les doublons proches de même nom sont fusionnés. Chaque entrée reçoit un
 * contexte — la ville la plus proche, ou sa région.
 */
import { gunzipSync } from 'node:zlib';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { versGlobal, versLonLat } from '../src/itineraire.js';
import { distanceMetres } from '../src/mesure.js';
import { normaliser, TYPES, VERSION_INDEX } from '../src/recherche.js';
import { REGIONS } from '../src/carte-style.js';

const T = Object.fromEntries(TYPES.map((t, i) => [t, i]));
const ARABE = /[؀-ۿ]/;
const RAYONS_FUSION = { ville: 5000, village: 2000, quartier: 1000, lieu: 150, rue: 1500, numero: 25_000 };
const IMPORTANCE_LIEUX = {
  aerodrome: 60, airport: 60, hospital: 50, university: 45, station: 45, bus_station: 40, ferry_terminal: 40,
  stadium: 40, townhall: 40, administrative: 40, police: 40, courthouse: 40, fire_station: 35, attraction: 35,
  museum: 35, mall: 35, marketplace: 30, school: 25, college: 25, place_of_worship: 25, clinic: 25,
  pharmacy: 20, fuel: 20, hotel: 20, bank: 15, tram_stop: 10, bus_stop: 5,
};

/** Noms d'un objet OSM : affichage latin (fr), arabe, et variantes cherchables. */
export function noms(p = {}) {
  const local = p.name ?? '';
  const ar = p['name:ar'] || (ARABE.test(local) ? local : '');
  const fr = p['name:fr'] || (local && !ARABE.test(local) ? local : '') || p['name:en'] || ar || p.ref || '';
  const autres = [...new Set([local, p['name:en'], p.ref].filter((n) => n && n !== fr && n !== ar))].join(' | ');
  return { fr, ar: ar === fr ? '' : ar, autres };
}

/** Sommet d'une ligne situé vers la moitié de sa longueur, et longueur totale (mètres). */
export function pointMilieu(ligne) {
  let total = 0;
  const cumuls = [0];
  for (let i = 1; i < ligne.length; i++) cumuls.push((total += distanceMetres(ligne[i - 1], ligne[i])));
  let k = 0;
  while (k < cumuls.length - 1 && cumuls[k] < total / 2) k++;
  return { point: ligne[k], longueur: total };
}

/**
 * Fusion des doublons : éléments de même `cle` à moins de `rayon` mètres.
 * `fusionner(groupe, element)` met à jour le groupe ; renvoie la liste des groupes.
 */
export function regrouper(elements, { cle, rayon, fusionner = () => {} }) {
  const cellule = rayon / 90_000; // degrés, par excès
  const cases = new Map();
  const groupes = [];
  for (const el of elements) {
    const k = cle(el);
    const cx = Math.floor(el.lon / cellule);
    const cy = Math.floor(el.lat / cellule);
    let trouve = null;
    for (let dx = -1; dx <= 1 && !trouve; dx++) {
      for (let dy = -1; dy <= 1 && !trouve; dy++) {
        for (const g of cases.get(`${k}|${cx + dx}|${cy + dy}`) ?? []) {
          if (distanceMetres([g.lon, g.lat], [el.lon, el.lat]) <= rayon) { trouve = g; break; }
        }
      }
    }
    if (trouve) {
      fusionner(trouve, el);
      continue;
    }
    const groupe = { ...el };
    groupes.push(groupe);
    const ici = `${k}|${cx}|${cy}`;
    if (!cases.has(ici)) cases.set(ici, []);
    cases.get(ici).push(groupe);
  }
  return groupes;
}

function dansAnneau([x, y], anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/**
 * Masque du territoire (12 régions) en grille de `pas` degrés, élargi de `marge`
 * cases pour garder le littoral que les contours simplifiés rognent.
 * @returns {(lon: number, lat: number) => boolean}
 */
export function masqueTerritoire(regions, { pas = 0.02, marge = 2 } = {}) {
  const anneaux = regions.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]));
  const tous = anneaux.flat();
  if (!tous.length) return () => false;
  const ouest = Math.min(...tous.map((p) => p[0])) - (marge + 1) * pas;
  const sud = Math.min(...tous.map((p) => p[1])) - (marge + 1) * pas;
  const nx = Math.ceil((Math.max(...tous.map((p) => p[0])) - ouest) / pas) + marge + 2;
  const ny = Math.ceil((Math.max(...tous.map((p) => p[1])) - sud) / pas) + marge + 2;
  const plein = new Uint8Array(nx * ny);
  // Remplissage par lignes de balayage (règle pair-impair, anneau par anneau).
  for (let j = 0; j < ny; j++) {
    const lat = sud + (j + 0.5) * pas;
    for (const anneau of anneaux) {
      const xs = [];
      for (let k = 0, m = anneau.length - 1; k < anneau.length; m = k++) {
        const [x1, y1] = anneau[m];
        const [x2, y2] = anneau[k];
        if ((y1 > lat) !== (y2 > lat)) xs.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - ouest) / pas - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - ouest) / pas - 0.5));
        for (let i = i0; i <= i1; i++) plein[j * nx + i] = 1;
      }
    }
  }
  const elargi = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!plein[j * nx + i]) continue;
    for (let dj = -marge; dj <= marge; dj++) for (let di = -marge; di <= marge; di++) {
      const [a, b] = [i + di, j + dj];
      if (a >= 0 && a < nx && b >= 0 && b < ny) elargi[b * nx + a] = 1;
    }
  }
  return (lon, lat) => {
    const i = Math.floor((lon - ouest) / pas);
    const j = Math.floor((lat - sud) / pas);
    return i >= 0 && i < nx && j >= 0 && j < ny && elargi[j * nx + i] === 1;
  };
}

/** Parcourt les tuiles d'un zoom sur l'emprise, en option filtrées par (x, y). */
async function parcourir(archive, z, emprise, traiter, filtre = null) {
  const [x0, y0] = versGlobal([emprise.ouest, emprise.nord], z).map((v) => Math.floor(v / 4096));
  const [x1, y1] = versGlobal([emprise.est, emprise.sud], z).map((v) => Math.floor(v / 4096));
  for (let x = x0; x <= x1; x++) {
    const ys = [];
    for (let y = y0; y <= y1; y++) if (!filtre || filtre(x, y)) ys.push(y);
    const tuiles = await Promise.all(ys.map((y) => archive.getZxy(z, x, y)));
    tuiles.forEach((t, k) => {
      if (!t?.data) return;
      let octets = new Uint8Array(t.data);
      if (octets[0] === 0x1f && octets[1] === 0x8b) octets = new Uint8Array(gunzipSync(octets));
      traiter(new VectorTile(new PbfReader(octets)), x, ys[k]);
    });
  }
}

/**
 * @param {{ archive: import('pmtiles').PMTiles, emprise: object, regions: object, etiquettes: object, journal?: Function }} options
 *   `regions` / `etiquettes` : GeoJSON des 12 régions (polygones / points d'étiquette)
 */
export async function construireIndexRecherche({ archive, emprise, regions, etiquettes, journal = () => {} }) {
  const lieux = [];
  const pois = [];
  const rues = [];
  const versLL = (z, x, y, ext, p) => versLonLat([(x * ext + p.x) * (4096 / ext), (y * ext + p.y) * (4096 / ext)], z);

  const lireLieux = (vt, x, y, z) => {
    const couche = vt.layers.places;
    for (let i = 0; i < (couche?.length ?? 0); i++) {
      const f = couche.feature(i);
      const p = f.properties;
      let type = null;
      if (p.kind === 'locality') {
        type = ['city', 'town'].includes(p.kind_detail) || (p.population ?? 0) >= 20_000 ? 'ville' : 'village';
      } else if (['neighbourhood', 'macrohood', 'microhood'].includes(p.kind)) type = 'quartier';
      if (!type || !p.name) continue;
      const [lon, lat] = versLL(z, x, y, couche.extent, f.loadGeometry()[0][0]);
      lieux.push({ type, ...noms(p), lon, lat, population: Number(p.population) || 0 });
    }
  };
  const lirePois = (vt, x, y, z) => {
    const couche = vt.layers.pois;
    let nommes = 0;
    for (let i = 0; i < (couche?.length ?? 0); i++) {
      const f = couche.feature(i);
      const p = f.properties;
      if (!p.name || !p.kind) continue;
      nommes += 1;
      const [lon, lat] = versLL(z, x, y, couche.extent, f.loadGeometry()[0][0]);
      pois.push({ kind: p.kind, ...noms(p), lon, lat });
    }
    return nommes;
  };

  let debut = performance.now();
  await parcourir(archive, 10, emprise, (vt, x, y) => lireLieux(vt, x, y, 10));
  journal(`  lieux (zoom 10) : ${lieux.length}, ${((performance.now() - debut) / 1000).toFixed(0)} s`);

  debut = performance.now();
  const habitees = new Set();
  await parcourir(archive, 14, emprise, (vt, x, y) => {
    lireLieux(vt, x, y, 14);
    if (lirePois(vt, x, y, 14) > 0) habitees.add(`${x},${y}`);
    const couche = vt.layers.roads;
    for (let i = 0; i < (couche?.length ?? 0); i++) {
      const f = couche.feature(i);
      const p = f.properties;
      if (!p.name && !p.ref) continue;
      if (['rail', 'ferry', 'aerialway', 'aeroway'].includes(p.kind)) continue;
      for (const ligne of f.loadGeometry()) {
        if (ligne.length < 2) continue;
        const { point, longueur } = pointMilieu(ligne.map((q) => versLL(14, x, y, couche.extent, q)));
        rues.push({ ...noms(p), numero: !p.name, lon: point[0], lat: point[1], longueur });
      }
    }
  });
  journal(`  zoom 14 : ${lieux.length} lieux, ${pois.length} POI, ${rues.length} morceaux de rues, ${((performance.now() - debut) / 1000).toFixed(0)} s`);

  debut = performance.now();
  await parcourir(archive, 15, emprise, (vt, x, y) => lirePois(vt, x, y, 15), (x, y) => habitees.has(`${x >> 1},${y >> 1}`));
  journal(`  POI zoom 15 (${habitees.size} zones habitées) : ${pois.length} POI, ${((performance.now() - debut) / 1000).toFixed(0)} s`);

  // ── Fusion des doublons ──────────────────────────────────────────────────
  const cleNom = (el) => normaliser(el.fr || el.ar);
  const lieuxUniques = ['ville', 'village', 'quartier'].flatMap((type) => regrouper(lieux.filter((l) => l.type === type), {
    cle: cleNom,
    rayon: RAYONS_FUSION[type],
    fusionner: (g, el) => {
      if (el.population > g.population) Object.assign(g, { population: el.population, lon: el.lon, lat: el.lat });
      g.ar ||= el.ar;
    },
  }));
  const poisUniques = regrouper(pois, { cle: (el) => `${cleNom(el)}|${el.kind}`, rayon: RAYONS_FUSION.lieu, fusionner: (g, el) => { g.ar ||= el.ar; } });
  const fusionRues = (g, el) => {
    if (el.longueur > g.plusLong) Object.assign(g, { lon: el.lon, lat: el.lat, plusLong: el.longueur });
    g.longueur += el.longueur;
    g.ar ||= el.ar;
  };
  const avecLongueur = (liste) => liste.map((r) => ({ ...r, plusLong: r.longueur }));
  const ruesUniques = [
    ...regrouper(avecLongueur(rues.filter((r) => !r.numero)), { cle: cleNom, rayon: RAYONS_FUSION.rue, fusionner: fusionRues }),
    ...regrouper(avecLongueur(rues.filter((r) => r.numero)), { cle: cleNom, rayon: RAYONS_FUSION.numero, fusionner: fusionRues }),
  ];

  // ── Contextes : ville la plus proche (≤ 25 km), sinon région ─────────────
  const contextes = [];
  const indexContexte = new Map();
  const contexte = (fr, ar) => {
    const k = `${fr}|${ar}`;
    if (!indexContexte.has(k)) { indexContexte.set(k, contextes.length); contextes.push([fr, ar]); }
    return indexContexte.get(k);
  };
  const polygones = regions.features.map((f) => ({
    iso: f.properties.shapeISO,
    anneaux: (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0]),
  }));
  const regionDe = (lon, lat) => {
    const r = polygones.find((pg) => pg.anneaux.some((a) => dansAnneau([lon, lat], a)));
    return r && REGIONS[r.iso] ? contexte(REGIONS[r.iso].fr, REGIONS[r.iso].ar) : -1;
  };
  const villes = lieuxUniques.filter((l) => l.type === 'ville');
  const grilleVilles = new Map();
  for (const v of villes) {
    const k = `${Math.floor(v.lon / 0.25)},${Math.floor(v.lat / 0.25)}`;
    if (!grilleVilles.has(k)) grilleVilles.set(k, []);
    grilleVilles.get(k).push(v);
  }
  const villeProche = (lon, lat) => {
    let meilleure = null;
    const cx = Math.floor(lon / 0.25);
    const cy = Math.floor(lat / 0.25);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const v of grilleVilles.get(`${cx + dx},${cy + dy}`) ?? []) {
        // Les grandes villes « attirent » plus loin que les petites.
        const d = distanceMetres([lon, lat], [v.lon, v.lat]) / (1 + Math.log10(1 + v.population) / 3);
        if (d <= 25_000 && (!meilleure || d < meilleure.d)) meilleure = { v, d };
      }
    }
    return meilleure ? contexte(meilleure.v.fr, meilleure.v.ar) : regionDe(lon, lat);
  };

  // ── Entrées ──────────────────────────────────────────────────────────────
  const kinds = [];
  const indexKind = new Map();
  const kindDe = (k) => {
    if (!indexKind.has(k)) { indexKind.set(k, kinds.length); kinds.push(k); }
    return indexKind.get(k);
  };
  const coord = (v) => Math.round(v * 1e5);
  const entrees = [];
  for (const f of etiquettes.features) {
    const r = REGIONS[f.properties.shapeISO];
    if (!r) continue;
    const [lon, lat] = f.geometry.coordinates;
    entrees.push([T.region, r.fr, r.ar, coord(lon), coord(lat), 100, -1, -1, f.properties.shapeName ?? '']);
  }
  // Hors du Royaume (Andalousie, Canaries, Madère, Algérie…) : seules les villes restent
  // cherchables, classées plus bas ; villages, lieux et rues étrangers sont écartés.
  const auMaroc = masqueTerritoire(regions);
  const compte = { lieux: 0, pois: 0, rues: 0, ecartes: 0 };
  for (const l of lieuxUniques) {
    const chezNous = auMaroc(l.lon, l.lat);
    if (!chezNous && l.type !== 'ville') { compte.ecartes += 1; continue; }
    let rang = l.population > 0 ? Math.min(100, Math.round(Math.log10(l.population + 1) * 14)) : (l.type === 'ville' ? 40 : 10);
    if (!chezNous) rang = Math.round(rang / 2);
    const ctx = l.type === 'ville' ? regionDe(l.lon, l.lat) : villeProche(l.lon, l.lat);
    entrees.push([T[l.type], l.fr, l.ar, coord(l.lon), coord(l.lat), rang, ctx, -1, l.autres]);
    compte.lieux += 1;
  }
  for (const p of poisUniques) {
    if (!auMaroc(p.lon, p.lat)) { compte.ecartes += 1; continue; }
    entrees.push([T.lieu, p.fr, p.ar, coord(p.lon), coord(p.lat), IMPORTANCE_LIEUX[p.kind] ?? 15, villeProche(p.lon, p.lat), kindDe(p.kind), p.autres]);
    compte.pois += 1;
  }
  for (const r of ruesUniques) {
    if (!auMaroc(r.lon, r.lat)) { compte.ecartes += 1; continue; }
    const rang = Math.min(80, Math.round(Math.log10(r.longueur + 1) * 12)) + (/^[AN]\d/i.test(r.fr) ? 10 : 0);
    entrees.push([T.rue, r.fr, r.ar, coord(r.lon), coord(r.lat), rang, villeProche(r.lon, r.lat), -1, r.autres]);
    compte.rues += 1;
  }
  journal(`  index : ${compte.lieux} lieux, ${compte.pois} POI, ${compte.rues} rues et routes, 12 régions `
    + `(${compte.ecartes} éléments hors du Royaume écartés)`);
  return { version: VERSION_INDEX, contextes, kinds, e: entrees };
}
