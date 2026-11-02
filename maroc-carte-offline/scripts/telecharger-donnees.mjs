/**
 * Télécharge, une seule fois, tout ce dont la carte a besoin pour fonctionner
 * hors ligne, dans le dossier `donnees/` :
 *
 *   tiles/maroc.pmtiles      tuiles vectorielles OpenStreetMap (Protomaps), zoom 0–15
 *   fonts/<police>/*.pbf     glyphes des libellés (latin, arabe, tifinagh…)
 *   sprites/v4/*             icônes des points d'intérêt (thèmes clair et sombre)
 *   data/regions.geojson     les 12 régions (geoBoundaries, provinces du Sud incluses)
 *   data/regions-etiquettes.geojson   un point d'étiquette par région
 *   data/regions-limites.geojson      les limites entre régions (sans le littoral)
 *   data/reseau-national.bin          graphe routier national (longues distances)
 *
 * Usage :  npm run data              (ne retélécharge pas ce qui existe déjà)
 *          npm run data -- --force   (tout retélécharger, ex. pour mettre à jour les routes)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = path.join(RACINE, 'donnees');
const FORCE = process.argv.includes('--force');

/** Emprise de l'extraction : le Royaume, du Cap Spartel à Lagouira. */
export const EMPRISE = Object.freeze({ ouest: -17.5, sud: 20.5, est: -0.9, nord: 36.2 });
export const ZOOM_MAX = 15;

const ASSETS = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';
const POLICES = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const SPRITES = ['light', 'dark'].flatMap((t) => [`${t}.json`, `${t}.png`, `${t}@2x.json`, `${t}@2x.png`]);
const GEOBOUNDARIES_ADM1 = 'https://www.geoboundaries.org/api/current/gbOpen/MAR/ADM1/';

async function telecharger(url, { type = 'buffer' } = {}) {
  const reponse = await fetch(url, { headers: { 'User-Agent': 'maroc-carte-offline/1.0' } });
  if (!reponse.ok) {
    const erreur = new Error(`HTTP ${reponse.status} pour ${url}`);
    erreur.status = reponse.status;
    throw erreur;
  }
  if (type === 'json') return reponse.json();
  return Buffer.from(await reponse.arrayBuffer());
}

async function ecrire(fichier, contenu) {
  await mkdir(path.dirname(fichier), { recursive: true });
  await writeFile(fichier, contenu);
}

/** Exécute `taches` avec au plus `n` téléchargements simultanés. */
async function enParallele(taches, n = 16) {
  let suivant = 0;
  const ouvriers = Array.from({ length: n }, async () => {
    while (suivant < taches.length) await taches[suivant++]();
  });
  await Promise.all(ouvriers);
}

function trouverPmtiles() {
  const local = path.join(RACINE, 'tools', process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');
  if (existsSync(local)) return local;
  const essai = spawnSync('pmtiles', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' });
  if (essai.status === 0) return 'pmtiles';
  throw new Error('Outil « pmtiles » introuvable : placez-le dans tools/ '
    + '(https://github.com/protomaps/go-pmtiles/releases) ou dans le PATH.');
}

async function tuiles() {
  const cible = path.join(DONNEES, 'tiles', 'maroc.pmtiles');
  if (!FORCE && existsSync(cible)) return console.log('✓ tuiles déjà présentes');
  const builds = await telecharger('https://build-metadata.protomaps.dev/builds.json', { type: 'json' });
  const dernier = builds.at(-1).key;
  console.log(`… extraction des tuiles du Maroc depuis le build Protomaps ${dernier} (≈ 550 Mo)`);
  await mkdir(path.dirname(cible), { recursive: true });
  const { ouest, sud, est, nord } = EMPRISE;
  const resultat = spawnSync(trouverPmtiles(), [
    'extract', `https://build.protomaps.com/${dernier}`, cible,
    `--bbox=${ouest},${sud},${est},${nord}`, `--maxzoom=${ZOOM_MAX}`, '--download-threads=8',
  ], { stdio: 'inherit' });
  if (resultat.status !== 0) throw new Error('échec de l’extraction des tuiles');
  console.log(`✓ tuiles : ${((await stat(cible)).size / 1e6).toFixed(0)} Mo`);
}

async function polices() {
  const taches = [];
  let manquants = 0;
  for (const police of POLICES) {
    for (let debut = 0; debut < 65536; debut += 256) {
      const nom = `${debut}-${debut + 255}.pbf`;
      const cible = path.join(DONNEES, 'fonts', police, nom);
      if (!FORCE && existsSync(cible)) continue;
      taches.push(async () => {
        try {
          await ecrire(cible, await telecharger(`${ASSETS}/fonts/${encodeURIComponent(police)}/${nom}`));
        } catch (erreur) {
          if (erreur.status !== 404) throw erreur;
          manquants += 1; // plage sans glyphes pour cette police
        }
      });
    }
  }
  await enParallele(taches);
  console.log(`✓ polices (${taches.length - manquants} fichiers téléchargés)`);
}

async function sprites() {
  await enParallele(SPRITES.map((nom) => async () => {
    const cible = path.join(DONNEES, 'sprites', 'v4', nom);
    if (!FORCE && existsSync(cible)) return;
    await ecrire(cible, await telecharger(`${ASSETS}/sprites/v4/${nom}`));
  }));
  console.log('✓ icônes');
}

/** Aire signée et centroïde d'un anneau [lon, lat]. */
function centroideAnneau(anneau) {
  let aire = 0, cx = 0, cy = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [x0, y0] = anneau[j];
    const [x1, y1] = anneau[i];
    const f = x0 * y1 - x1 * y0;
    aire += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  aire /= 2;
  return aire === 0 ? null : { aire: Math.abs(aire), point: [cx / (6 * aire), cy / (6 * aire)] };
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
 * Point d'étiquette d'une région : centroïde du plus grand polygone ; s'il
 * tombe hors de la forme (région concave), le point intérieur le plus proche
 * de ce centroïde sur une grille 40×40.
 */
export function pointEtiquette(geometrie) {
  const polygones = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.coordinates;
  let meilleur = null;
  for (const polygone of polygones) {
    const c = centroideAnneau(polygone[0]);
    if (c && (!meilleur || c.aire > meilleur.aire)) meilleur = { ...c, anneau: polygone[0] };
  }
  if (!meilleur) return null;
  if (dansAnneau(meilleur.point, meilleur.anneau)) return meilleur.point;
  const xs = meilleur.anneau.map((p) => p[0]);
  const ys = meilleur.anneau.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let choix = null;
  for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
    const p = [minX + ((maxX - minX) * i) / 40, minY + ((maxY - minY) * j) / 40];
    if (!dansAnneau(p, meilleur.anneau)) continue;
    const d = Math.hypot(p[0] - meilleur.point[0], p[1] - meilleur.point[1]);
    if (!choix || d < choix.d) choix = { p, d };
  }
  return choix ? choix.p : meilleur.point;
}

/**
 * Limites entre régions : uniquement les segments communs à deux régions.
 * Le littoral (simplifié, donc décalé du vrai trait de côte) et les frontières
 * terrestres, déjà tracées par le fond OSM, sont ainsi exclus. Les segments
 * sont chaînés en lignes continues pour que les pointillés restent réguliers.
 */
export function limitesInterieures(geojson) {
  const cle = (c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
  const compte = new Map();
  for (const f of geojson.features) {
    const polygones = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const anneau of polygones.flat()) {
      for (let i = 1; i < anneau.length; i++) {
        const [a, b] = [cle(anneau[i - 1]), cle(anneau[i])];
        if (a === b) continue;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        const entree = compte.get(k) ?? { n: 0, a: anneau[i - 1], b: anneau[i] };
        entree.n += 1;
        compte.set(k, entree);
      }
    }
  }
  const segments = [...compte.values()].filter((s) => s.n >= 2);
  const voisins = new Map();
  segments.forEach((s, i) => {
    for (const bout of [s.a, s.b]) {
      const k = cle(bout);
      if (!voisins.has(k)) voisins.set(k, []);
      voisins.get(k).push(i);
    }
  });
  const utilise = new Set();
  const lignes = [];
  const suivre = (depart, indice) => {
    const ligne = [depart];
    let point = depart;
    let i = indice;
    while (i !== undefined && !utilise.has(i)) {
      utilise.add(i);
      const s = segments[i];
      point = cle(s.a) === cle(point) ? s.b : s.a;
      ligne.push(point);
      const suite = voisins.get(cle(point));
      i = suite.length === 2 ? suite.find((j) => !utilise.has(j)) : undefined;
    }
    if (ligne.length > 1) lignes.push(ligne);
  };
  // D'abord depuis les extrémités et les jonctions (degré ≠ 2), puis les boucles.
  for (const [k, liste] of voisins) {
    if (liste.length === 2) continue;
    for (const i of liste) {
      if (utilise.has(i)) continue;
      const s = segments[i];
      suivre(cle(s.a) === k ? s.a : s.b, i);
    }
  }
  segments.forEach((s, i) => { if (!utilise.has(i)) suivre(s.a, i); });
  return {
    type: 'FeatureCollection',
    features: lignes.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
  };
}

async function regions() {
  const cible = path.join(DONNEES, 'data', 'regions.geojson');
  const etiquettes = path.join(DONNEES, 'data', 'regions-etiquettes.geojson');
  const limites = path.join(DONNEES, 'data', 'regions-limites.geojson');
  if (!FORCE && [cible, etiquettes, limites].every(existsSync)) return console.log('✓ régions déjà présentes');
  let geojson;
  if (!FORCE && existsSync(cible)) {
    geojson = JSON.parse(await readFile(cible, 'utf8'));
  } else {
    const meta = await telecharger(GEOBOUNDARIES_ADM1, { type: 'json' });
    const url = String(meta?.simplifiedGeometryGeoJSON || '');
    if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com|media\.githubusercontent\.com)\//.test(url)) {
      throw new Error(`adresse de téléchargement geoBoundaries inattendue : ${url}`);
    }
    geojson = JSON.parse((await telecharger(url)).toString('utf8'));
  }
  const points = geojson.features.map((f) => ({
    type: 'Feature',
    properties: { shapeName: f.properties.shapeName, shapeISO: f.properties.shapeISO },
    geometry: { type: 'Point', coordinates: pointEtiquette(f.geometry) },
  }));
  await ecrire(cible, JSON.stringify(geojson));
  await ecrire(etiquettes, JSON.stringify({ type: 'FeatureCollection', features: points }));
  await ecrire(limites, JSON.stringify(limitesInterieures(geojson)));
  console.log(`✓ régions : ${geojson.features.length} (${points.map((p) => p.properties.shapeName).join(', ')})`);
}

/**
 * Graphe routier national (zoom 9) pour les longues distances, construit à partir
 * des tuiles locales : aucune connexion n'est nécessaire pour cette étape.
 */
async function reseauNational() {
  const cible = path.join(DONNEES, 'data', 'reseau-national.bin');
  const source = path.join(DONNEES, 'tiles', 'maroc.pmtiles');
  const [{ PMTiles }, { VectorTile }, { PbfReader }, { ReseauRoutier, versGlobal }, national] = await Promise.all([
    import('pmtiles'), import('@mapbox/vector-tile'), import('pbf'),
    import('../src/itineraire.js'), import('../src/reseau-national.js'),
  ]);
  // À jour = plus récent que les tuiles ET au format actuel (sinon reconstruit, ex. après une mise à jour).
  if (!FORCE && existsSync(cible) && (await stat(cible)).mtimeMs >= (await stat(source)).mtimeMs) {
    const fichierExistant = await open(cible);
    const entete = Buffer.alloc(4);
    await fichierExistant.read(entete, 0, 4, 0);
    await fichierExistant.close();
    if (national.formatAJour(entete)) return console.log('✓ réseau national déjà présent');
  }
  const debut = performance.now();
  const fichier = await open(source);
  try {
    const archive = new PMTiles({
      getKey: () => source,
      getBytes: async (decalage, longueur) => {
        const tampon = Buffer.alloc(longueur);
        await fichier.read(tampon, 0, longueur, decalage);
        return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + longueur) };
      },
    });
    const lecteur = new ReseauRoutier(archive);
    const z = national.ZOOM_NATIONAL;
    const [x0, y0] = versGlobal([EMPRISE.ouest, EMPRISE.nord], z).map((v) => Math.floor(v / 4096));
    const [x1, y1] = versGlobal([EMPRISE.est, EMPRISE.sud], z).map((v) => Math.floor(v / 4096));
    const routes = [];
    const frontieres = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        routes.push(...await lecteur._tuile(z, x, y));
        // Frontières internationales (la limite marquée « contestée » au sud n'en est pas une ici).
        const tuile = await archive.getZxy(z, x, y);
        if (!tuile?.data) continue;
        let octets = new Uint8Array(tuile.data);
        if (octets[0] === 0x1f && octets[1] === 0x8b) octets = new Uint8Array(gunzipSync(octets));
        const couche = new VectorTile(new PbfReader(octets)).layers.boundaries;
        for (let i = 0; i < (couche?.length ?? 0); i++) {
          const f = couche.feature(i);
          if (f.properties.kind_detail > 2 || f.properties.disputed) continue;
          const echelle = 4096 / couche.extent;
          for (const ligne of f.loadGeometry()) {
            frontieres.push(ligne.map((p) => [(x * couche.extent + p.x) * echelle, (y * couche.extent + p.y) * echelle]));
          }
        }
      }
    }
    const reseau = national.construireReseauNational(routes, frontieres);
    const octets = national.serialiser(reseau);
    await ecrire(cible, octets);
    console.log(`✓ réseau national : ${reseau.lon.length.toLocaleString('fr-FR')} nœuds, `
      + `${reseau.raccords} raccords d’agglomération, ${(octets.length / 1e6).toFixed(1)} Mo, `
      + `${((performance.now() - debut) / 1000).toFixed(0)} s`);
  } finally {
    await fichier.close();
  }
}

/** Index de recherche (lieux, POI, rues), construit à partir des tuiles locales (≈ 3 min). */
async function indexRecherche() {
  const cible = path.join(DONNEES, 'data', 'recherche.json');
  const source = path.join(DONNEES, 'tiles', 'maroc.pmtiles');
  const [{ PMTiles }, { construireIndexRecherche }, { VERSION_INDEX }] = await Promise.all([
    import('pmtiles'), import('./index-recherche.mjs'), import('../src/recherche.js'),
  ]);
  if (!FORCE && existsSync(cible) && (await stat(cible)).mtimeMs >= (await stat(source)).mtimeMs) {
    const fichierExistant = await open(cible);
    const entete = Buffer.alloc(64);
    await fichierExistant.read(entete, 0, 64, 0);
    await fichierExistant.close();
    if (Number(/"version":(\d+)/.exec(entete.toString('utf8'))?.[1]) === VERSION_INDEX) {
      return console.log('✓ index de recherche déjà présent');
    }
  }
  console.log('… index de recherche (lieux, POI, rues) — environ 3 minutes');
  const debut = performance.now();
  const fichier = await open(source);
  try {
    const archive = new PMTiles({
      getKey: () => source,
      getBytes: async (decalage, longueur) => {
        const tampon = Buffer.alloc(longueur);
        await fichier.read(tampon, 0, longueur, decalage);
        return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + longueur) };
      },
    });
    const lireJson = async (nom) => JSON.parse(await readFile(path.join(DONNEES, 'data', nom), 'utf8'));
    const index = await construireIndexRecherche({
      archive,
      emprise: EMPRISE,
      regions: await lireJson('regions.geojson'),
      etiquettes: await lireJson('regions-etiquettes.geojson'),
      journal: console.log,
    });
    const texte = JSON.stringify(index);
    await ecrire(cible, texte);
    console.log(`✓ index de recherche : ${index.e.length.toLocaleString('fr-FR')} entrées, `
      + `${(Buffer.byteLength(texte) / 1e6).toFixed(1)} Mo, ${((performance.now() - debut) / 1000).toFixed(0)} s`);
  } finally {
    await fichier.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await mkdir(DONNEES, { recursive: true });
    await tuiles();
    await polices();
    await sprites();
    await regions();
    await reseauNational();
    await indexRecherche();
    console.log('\nDonnées prêtes. La carte fonctionne désormais sans connexion.');
  } catch (erreur) {
    console.error(`\n✗ ${erreur.message}`);
    process.exitCode = 1;
  }
}
