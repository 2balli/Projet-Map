#!/usr/bin/env node
/**
 * Réseau routier : extrait OpenStreetMap Geofabrik (.osm.pbf) -> graphe de
 * calcul + couches d'affichage, entièrement en local.
 *
 *   node scripts/import-osm-morocco.mjs
 *   node scripts/import-osm-morocco.mjs --source data/source/morocco-260901.osm.pbf
 *   node scripts/import-osm-morocco.mjs --suffixe ""      (écrit les noms définitifs)
 *
 * Par défaut, la sortie porte le suffixe `.new` :
 *   public/layers/graphe_routier.new.json
 *   public/layers/routes_<classe>.new.geojson
 * et ne remplace donc RIEN de ce que l'application charge. Le remplacement est
 * un geste séparé, après validation.
 *
 * SOURCE. Le fichier `.osm.pbf` est téléchargé UNE fois depuis
 * https://download.geofabrik.de/africa/morocco.html et rangé dans
 * data/source/ (hors des fichiers servis). Ce script ne fait AUCUN appel
 * réseau ; l'application n'en fait pas davantage à l'exécution.
 *
 * DIFFÉRENCES AVEC scripts/build-roads.mjs (réseau Overpass, conservé tel quel) :
 *
 *   - Voies locales (tertiary sans numéro, unclassified, residential,
 *     living_street, service utile) gardées comme RACCORDS du réseau : tous les
 *     giratoires, et chaque morceau de voie locale entre deux nœuds du réseau.
 *     Sans eux, les ronds-points et raccords non numérotés manquaient et
 *     l'itinéraire contournait le carrefour. `--locales toutes` garde toutes
 *     les rues (voir MODE_LOCALES pour le coût mesuré).
 *   - Les tronçons de moins d'un mètre entre deux sommets DISTINCTS sont
 *     gardés : les supprimer ouvrait l'anneau des ronds-points (sens unique),
 *     rendant certaines sorties inaccessibles.
 *   - Une classe `locale` est AJOUTÉE en fin de liste : les indices des classes
 *     existantes ne bougent pas.
 *   - Noms, type OSM, pont/tunnel, revêtement, identifiant OSM : tables
 *     annexes (`noms`, `aretesNoms`, `highways`, `aretesAttr`), que les
 *     chargeurs actuels ignorent — le schéma des arêtes est inchangé.
 *   - Sortie déterministe : `genere` est la date des données source, pas
 *     l'heure du calcul ; l'ordre suit les identifiants OSM.
 *
 * Les routes ne sont raccordées QUE par un nœud OSM partagé : jamais par
 * proximité, jamais par une ligne droite. Un pont sans échangeur reste donc
 * un pont.
 */
import { readdirSync, writeFileSync, mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { blocsPbf, lireEntete, lireBloc } from './osm-pbf.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defaut;
};

/** Le plus récent des extraits rangés dans data/source/. */
function sourceParDefaut() {
  const dossier = join(ROOT, 'data/source');
  if (!existsSync(dossier)) return null;
  const pbf = readdirSync(dossier).filter((f) => f.endsWith('.osm.pbf')).sort();
  return pbf.length ? join(dossier, pbf[pbf.length - 1]) : null;
}

const SOURCE = resolve(arg('source', sourceParDefaut() ?? 'data/source/morocco-latest.osm.pbf'));
const SORTIE = resolve(arg('sortie', join(ROOT, 'public/layers')));
const SUFFIXE = arg('suffixe', '.new');
const RAPPORT = resolve(arg('rapport', join(ROOT, 'data/source/import-rapport.json')));

/* ================================================================== */
/*  PARAMÈTRES                                                        */
/* ================================================================== */

/**
 * Classes, dans l'ORDRE du graphe actuel — `locale` est ajoutée à la fin pour
 * que l'indice de chaque classe existante reste le même.
 * Vitesses de PARCOURS moyennes, utilisées quand la voie n'en signale pas.
 */
export const CLASSES = {
  autoroute: { vitesse: 110 },
  nationale: { vitesse: 75 },
  regionale: { vitesse: 60 },
  provinciale: { vitesse: 50 },
  liaison: { vitesse: 45 },
  locale: { vitesse: 30 },
};

/**
 * Classes dessinées en couche (les autres servent au calcul).
 *
 * Les voies locales n'ont PAS de couche par défaut : 400 000 tronçons, 70 Mo
 * de GeoJSON, que Leaflet ne peut pas dessiner d'un bloc sans geler la carte.
 * Le fond de carte interne montre déjà les rues ; `--couche-locale` produit
 * tout de même le fichier, pour un usage futur (affichage par emprise).
 */
const AFFICHEES = ['autoroute', 'nationale', 'regionale', 'provinciale'];
if (process.argv.includes('--couche-locale')) AFFICHEES.push('locale');

/** Types OSM routables par un véhicule. */
const ROUTABLES = new Set([
  'motorway', 'motorway_link',
  'trunk', 'trunk_link',
  'primary', 'primary_link',
  'secondary', 'secondary_link',
  'tertiary', 'tertiary_link',
  'unclassified', 'residential', 'living_street',
  'service',
]);

/**
 * Voies de service écartées : allées de parking, accès privatifs, guichets,
 * accès de secours et ruelles. Le reste (voies d'accès sans précision, zones
 * d'activité, accès aux casernes, aux gares…) est gardé : c'est souvent le
 * seul raccord d'un équipement au réseau.
 */
const SERVICE_ECARTE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access', 'parking', 'alley']);

/** Valeurs d'accès qui interdisent un véhicule ordinaire. */
const INTERDIT = new Set(['no', 'private']);
const AUTORISE = new Set(['yes', 'designated', 'permissive', 'destination', 'customers', 'delivery']);

const TOLERANCE_AFFICHAGE = 60;
const TOLERANCE_GRAPHE = 40;

/* ================================================================== */
/*  Géométrie                                                         */
/* ================================================================== */

const R_TERRE = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function distanceM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

const longueur = (pts) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceM(pts[i - 1], pts[i]);
  return d;
};

/** Douglas-Peucker, tolérance en mètres (même méthode que build-roads.mjs). */
function simplifier(pts, toleranceM) {
  if (pts.length < 3) return pts;
  const latMoy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const tol = Math.max(toleranceM / 111320, toleranceM / (111320 * Math.max(0.15, Math.cos(rad(latMoy)))));
  const garde = new Uint8Array(pts.length);
  garde[0] = 1;
  garde[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [debut, fin] = pile.pop();
    let iMax = -1;
    let dMax = 0;
    const [x1, y1] = pts[debut];
    const [x2, y2] = pts[fin];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norme = dx * dx + dy * dy;
    for (let i = debut + 1; i < fin; i++) {
      const [x, y] = pts[i];
      let t = norme ? ((x - x1) * dx + (y - y1) * dy) / norme : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x1 + t * dx - x, y1 + t * dy - y);
      if (d > dMax) {
        dMax = d;
        iMax = i;
      }
    }
    if (dMax > tol && iMax > 0) {
      garde[iMax] = 1;
      pile.push([debut, iMax], [iMax, fin]);
    }
  }
  return pts.filter((_, i) => garde[i]);
}

const arrondir = (pts, d = 5) => pts.map(([x, y]) => [+x.toFixed(d), +y.toFixed(d)]);

/* ================================================================== */
/*  Classification (mêmes règles que build-roads.mjs, plus `locale`)  */
/* ================================================================== */

const LOCALES = new Set(['tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']);

function classer(tags) {
  const refs = String(tags.ref ?? '')
    .split(';')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
  for (const r of refs) {
    if (/^A\d/.test(r)) return { classe: 'autoroute', ref: r };
    if (/^RN\d/.test(r) || /^N\d/.test(r)) return { classe: 'nationale', ref: r };
    if (/^RR\d/.test(r) || /^R\d/.test(r)) return { classe: 'regionale', ref: r };
    if (/^RP\d/.test(r) || /^P\d/.test(r)) return { classe: 'provinciale', ref: r };
  }
  const h = tags.highway;
  if (h === 'motorway') return { classe: 'autoroute', ref: refs[0] ?? null };
  if (h === 'trunk') return { classe: 'nationale', ref: refs[0] ?? null };
  /* Sans numéro : voie locale (rue, desserte) ou bretelle / traversée. */
  if (LOCALES.has(h)) return { classe: 'locale', ref: refs[0] ?? null };
  return { classe: 'liaison', ref: refs[0] ?? null };
}

function sensUnique(tags) {
  const o = tags.oneway;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (tags.highway === 'motorway' || tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  return 0;
}

function vitesse(tags, classe) {
  const brut = parseInt(String(tags.maxspeed ?? '').replace(/[^\d]/g, ''), 10);
  const parClasse = CLASSES[classe].vitesse;
  if (!Number.isFinite(brut) || brut < 20 || brut > 130) return parClasse;
  return Math.max(brut, Math.round(parClasse * 0.5));
}

/**
 * Types écartés à la demande (`--exclure residential,service`) : le graphe
 * complet est exact mais plus lourd à parcourir, et l'optimisation automatique
 * multiplie les recherches locales dans les maillages urbains.
 */
const EXCLUS = new Set(String(arg('exclure', '')).split(',').map((s) => s.trim()).filter(Boolean));

/** Pourquoi une voie est écartée, ou `null` si elle est gardée. */
function motifEcart(tags) {
  const h = tags.highway;
  if (!ROUTABLES.has(h)) return 'type non routable';
  /* Un giratoire reste gardé quel que soit son type : sans lui, les voies
     qui y entrent ne se rejoignent pas (voir l'audit des ronds-points). */
  const giratoire = tags.junction === 'roundabout' || tags.junction === 'circular';
  if (EXCLUS.has(h) && !giratoire) return `exclu (${h})`;
  if (tags.area === 'yes') return 'surface (area=yes)';
  if (h === 'service' && SERVICE_ECARTE.has(tags.service)) return `service=${tags.service}`;
  /* Une route principale ou numérotée reste au réseau même si l'accès y est
     restreint (fermeture, travaux, axe réservé) : les unités l'empruntent, et
     des barrages y sont posés — à Foum El Oued, la RN1 porte access=no.
     La restriction reste marquée sur l'arête (ATTR_ACCES_RESTREINT). */
  if (PRINCIPALES.has(h) || tags.ref) return null;
  const vehicule = tags.motor_vehicle ?? tags.motorcar ?? tags.vehicle;
  if (vehicule !== undefined) return INTERDIT.has(vehicule) ? `accès véhicule=${vehicule}` : null;
  if (INTERDIT.has(tags.access) && !AUTORISE.has(vehicule)) return `access=${tags.access}`;
  return null;
}

/* Attributs annexes, codés en bits. */
const ATTR_PONT = 1;
const ATTR_TUNNEL = 2;
const ATTR_NON_REVETU = 4;
const ATTR_ROND_POINT = 8;
const ATTR_ACCES_RESTREINT = 16;

const PRINCIPALES = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link',
  'primary', 'primary_link', 'secondary', 'secondary_link',
]);
const restreint = (tags) =>
  [tags.access, tags.vehicle, tags.motor_vehicle, tags.motorcar].some((v) => INTERDIT.has(v));
const NON_REVETU = new Set(['unpaved', 'gravel', 'dirt', 'ground', 'earth', 'sand', 'compacted', 'fine_gravel', 'grass', 'mud', 'pebblestone']);

function attributs(tags) {
  let a = 0;
  if (tags.bridge && tags.bridge !== 'no') a |= ATTR_PONT;
  if (tags.tunnel && tags.tunnel !== 'no') a |= ATTR_TUNNEL;
  if (NON_REVETU.has(tags.surface)) a |= ATTR_NON_REVETU;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') a |= ATTR_ROND_POINT;
  if (restreint(tags)) a |= ATTR_ACCES_RESTREINT;
  return a;
}

/* ================================================================== */
/*  Lecture de la source                                              */
/* ================================================================== */

if (!existsSync(SOURCE)) {
  console.error(`\nSource absente : ${SOURCE}`);
  console.error('Téléchargez une fois (accès internet requis) :');
  console.error('  https://download.geofabrik.de/africa/morocco.html  ->  data/source/*.osm.pbf\n');
  process.exit(1);
}

const t0 = Date.now();
const empreinte = createHash('md5');
{
  /* Empreinte de la source : le rapport dit exactement QUEL fichier a servi. */
  const buf = readFileSync(SOURCE);
  empreinte.update(buf);
}
const md5 = empreinte.digest('hex');

console.log(`\nRéseau routier — import OSM\n  source : ${SOURCE}\n  md5    : ${md5}`);

/* --- Passe 1 : les chemins routiers --- */

let entete = null;
const chemins = [];
const ecartes = {};
let nCheminsLus = 0;

for (const bloc of blocsPbf(SOURCE)) {
  if (bloc.type === 'OSMHeader') {
    entete = lireEntete(bloc.donnees);
    continue;
  }
  lireBloc(bloc.donnees, {
    chemin(w) {
      if (!w.tags.highway) return;
      nCheminsLus++;
      const motif = motifEcart(w.tags);
      if (motif) {
        if (ROUTABLES.has(w.tags.highway)) ecartes[motif] = (ecartes[motif] ?? 0) + 1;
        return;
      }
      if (w.refs.length < 2) return;
      chemins.push(w);
    },
  });
}

/* Ordre par identifiant : la sortie ne dépend pas de l'ordre des blocs. */
chemins.sort((a, b) => a.id - b.id);

console.log(`  date des données : ${entete?.horodatage ?? 'inconnue'}`);
console.log(`  ${chemins.length} voies routables retenues sur ${nCheminsLus} chemins highway=*`);
console.log(`  écartées : ${JSON.stringify(ecartes)}`);

/* --- Passe 2 : coordonnées des seuls nœuds utilisés --- */

let nRefs = 0;
for (const c of chemins) nRefs += c.refs.length;
const tous = new Float64Array(nRefs);
{
  let k = 0;
  for (const c of chemins) for (const r of c.refs) tous[k++] = r;
}
tous.sort();
let nUniques = 0;
for (let i = 0; i < tous.length; i++) if (i === 0 || tous[i] !== tous[i - 1]) tous[nUniques++] = tous[i];
const ids = tous.subarray(0, nUniques);
const LNG = new Float64Array(nUniques).fill(NaN);
const LAT = new Float64Array(nUniques).fill(NaN);

/** Indice d'un identifiant de nœud dans `ids` (recherche dichotomique). */
function indiceNoeud(id) {
  let lo = 0;
  let hi = nUniques - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const v = ids[m];
    if (v === id) return m;
    if (v < id) lo = m + 1;
    else hi = m - 1;
  }
  return -1;
}

for (const bloc of blocsPbf(SOURCE)) {
  if (bloc.type !== 'OSMData') continue;
  lireBloc(bloc.donnees, {
    noeuds(I, X, Y, n) {
      for (let k = 0; k < n; k++) {
        const j = indiceNoeud(I[k]);
        if (j >= 0) {
          LNG[j] = X[k];
          LAT[j] = Y[k];
        }
      }
    },
  });
}

let sansCoord = 0;
for (let j = 0; j < nUniques; j++) if (Number.isNaN(LNG[j])) sansCoord++;
console.log(`  ${nUniques} nœuds utilisés, ${sansCoord} sans coordonnées (hors extrait)`);

/* --- Voies : indices de nœuds + géométrie ; coupure aux nœuds manquants --- */

const voies = [];
let coupeesHorsExtrait = 0;
for (const w of chemins) {
  const { classe, ref } = classer(w.tags);
  const base = {
    id: w.id,
    classe,
    ref,
    nom: w.tags.name ?? w.tags['name:fr'] ?? w.tags['name:ar'] ?? null,
    highway: w.tags.highway,
    sens: sensUnique(w.tags),
    vitesse: vitesse(w.tags, classe),
    attr: attributs(w.tags),
  };
  /* Un nœud absent de l'extrait (voie coupée à la frontière) interrompt la
     voie : on ne relie jamais deux morceaux par-dessus le trou. */
  let morceau = [];
  const pousser = () => {
    if (morceau.length >= 2) voies.push({ ...base, noeuds: morceau });
    morceau = [];
  };
  for (const r of w.refs) {
    const j = indiceNoeud(r);
    if (j < 0 || Number.isNaN(LNG[j])) {
      if (morceau.length) coupeesHorsExtrait++;
      pousser();
      continue;
    }
    if (morceau.length && morceau[morceau.length - 1] === j) continue; // nœud répété
    morceau.push(j);
  }
  pousser();
}

/**
 * `--locales raccords` : les voies locales ne sont gardées QUE comme raccords.
 *
 * Le graphe sert aussi à l'optimisation automatique, qui sème ses positions
 * candidates sur TOUTES les arêtes proches d'un barrage. Avec toutes les rues
 * du pays, elle proposerait des barrages en pleine zone résidentielle, et son
 * temps de calcul est multiplié par quatorze. Ce mode garde l'étendue du
 * réseau actuel (routes numérotées, bretelles, traversées) et n'ajoute des
 * voies locales que ce qui RACCORDE ce réseau, vérifié par les nœuds OSM :
 *   - les giratoires, entiers, quel que soit leur type ;
 *   - le morceau d'une voie locale compris entre deux nœuds consécutifs du
 *     réseau (le petit raccord qu'on traverse pour passer d'une route à l'autre).
 * Une rue qui ne relie le réseau qu'à elle-même n'est pas gardée.
 */
/* Défaut retenu après mesure (optimisation automatique, 594 barrages) :
     raccords  74 254 sommets   29 s     |   toutes  820 709 sommets   327 s
   `--locales toutes` produit le réseau complet, toutes rues comprises. */
const MODE_LOCALES = arg('locales', 'raccords');
if (MODE_LOCALES === 'raccords') {
  const estGiratoire = (v) => (v.attr & ATTR_ROND_POINT) !== 0;
  const reseau = new Uint8Array(nUniques);
  const gardees = [];
  const locales = [];
  for (const v of voies) {
    if (v.classe !== 'locale' || estGiratoire(v)) {
      gardees.push(v);
      for (const j of v.noeuds) reseau[j] = 1;
    } else locales.push(v);
  }
  let raccords = 0;
  for (const v of locales) {
    let precedent = -1;
    v.noeuds.forEach((j, k) => {
      if (!reseau[j]) return;
      if (precedent >= 0 && k - precedent >= 1) {
        gardees.push({ ...v, noeuds: v.noeuds.slice(precedent, k + 1) });
        raccords++;
      }
      precedent = k;
    });
  }
  console.log(`  voies locales : mode raccords — ${raccords} raccords gardés sur ${locales.length} voies locales`);
  voies.length = 0;
  voies.push(...gardees);
}

/* ================================================================== */
/*  Graphe : découpage aux intersections                              */
/* ================================================================== */

const occurrences = new Uint32Array(nUniques);
for (const v of voies) for (const j of v.noeuds) occurrences[j]++;

const sommetDe = new Int32Array(nUniques).fill(-1);
const sommetsX = [];
const sommetsY = [];
const sommet = (j) => {
  if (sommetDe[j] < 0) {
    sommetDe[j] = sommetsX.length;
    sommetsX.push(LNG[j]);
    sommetsY.push(LAT[j]);
  }
  return sommetDe[j];
};

const aretes = [];
let boucles = 0;
let courtesGardees = 0;

function ajouterArete(v, noeuds) {
  const pts = noeuds.map((j) => [LNG[j], LAT[j]]);
  const m = longueur(pts);
  if (m < 1) courtesGardees++;
  aretes.push({
    a: sommet(noeuds[0]),
    b: sommet(noeuds[noeuds.length - 1]),
    m,
    v,
    pts,
  });
}

for (const v of voies) {
  const n = v.noeuds;
  let debut = 0;
  for (let i = 1; i < n.length; i++) {
    const estFin = i === n.length - 1;
    if (!estFin && occurrences[n[i]] < 2) continue;
    const morceau = n.slice(debut, i + 1);
    if (morceau[0] === morceau[morceau.length - 1]) {
      /* Boucle fermée sans autre intersection (rond-point à une seule
         branche, impasse en raquette) : coupée en deux pour qu'aucune arête
         ne parte et n'arrive au même sommet. */
      if (morceau.length >= 3) {
        const mil = morceau.length >> 1;
        ajouterArete(v, morceau.slice(0, mil + 1));
        ajouterArete(v, morceau.slice(mil));
      } else boucles++;
    } else ajouterArete(v, morceau);
    debut = i;
  }
}

/* Doublons exacts : même voie OSM tracée deux fois (même extrémités, même
   géométrie, même sens). Gardés une seule fois. */
const vus = new Set();
let doublons = 0;
const aretesUniques = [];
for (const e of aretes) {
  const cle = `${e.a}|${e.b}|${e.v.sens}|${e.v.classe}|${e.pts.map((p) => p.join(',')).join(';')}`;
  if (vus.has(cle)) {
    doublons++;
    continue;
  }
  vus.add(cle);
  aretesUniques.push(e);
}

const nS = sommetsX.length;
console.log(`\n  graphe brut : ${nS} sommets, ${aretesUniques.length} arêtes (${doublons} doublons exacts retirés)`);

/* --- Composantes connexes : on garde la principale, on annonce le reste --- */

const debuts = new Int32Array(nS + 1);
for (const e of aretesUniques) {
  debuts[e.a + 1]++;
  debuts[e.b + 1]++;
}
for (let s = 0; s < nS; s++) debuts[s + 1] += debuts[s];
const incident = new Int32Array(debuts[nS]);
{
  const cur = Int32Array.from(debuts.subarray(0, nS));
  aretesUniques.forEach((e, i) => {
    incident[cur[e.a]++] = i;
    incident[cur[e.b]++] = i;
  });
}

const composante = new Int32Array(nS).fill(-1);
const tailles = [];
const kmComposante = [];
for (let s0 = 0; s0 < nS; s0++) {
  if (composante[s0] !== -1) continue;
  const id = tailles.length;
  let n = 0;
  const pile = [s0];
  composante[s0] = id;
  while (pile.length) {
    const s = pile.pop();
    n++;
    for (let k = debuts[s]; k < debuts[s + 1]; k++) {
      const e = aretesUniques[incident[k]];
      const o = e.a === s ? e.b : e.a;
      if (composante[o] === -1) {
        composante[o] = id;
        pile.push(o);
      }
    }
  }
  tailles.push(n);
  kmComposante.push(0);
}
for (const e of aretesUniques) kmComposante[composante[e.a]] += e.m / 1000;

let principale = 0;
for (let i = 1; i < tailles.length; i++) if (tailles[i] > tailles[principale]) principale = i;
const kmEcartes = kmComposante.reduce((s, k, i) => (i === principale ? s : s + k), 0);

console.log(
  `  composantes : ${tailles.length} — principale ${tailles[principale]} sommets ; ` +
    `${nS - tailles[principale]} sommets / ${kmEcartes.toFixed(0)} km isolés écartés`
);

/* --- Forte connexité : aucun piège à sens unique --- */

/**
 * Relié « sans tenir compte du sens » ne suffit pas : un bout de sens unique
 * dont la suite n'est pas au réseau (rue locale non gardée, bretelle coupée)
 * se laisse ENTRER sans permettre d'en SORTIR, ou l'inverse. Un point accroché
 * là n'a d'itinéraire vers personne — l'optimisation y voyait même une place
 * « sans conflit », puisque aucune distance ne s'y mesure. On ne garde donc que
 * la plus grande composante FORTEMENT connexe (Kosaraju, itératif) : tout
 * sommet gardé atteint tout autre en respectant les sens uniques.
 */
const dansPrincipale = (s) => composante[s] === principale;
const succ = Array.from({ length: nS }, () => []);
const pred = Array.from({ length: nS }, () => []);
for (const e of aretesUniques) {
  if (!dansPrincipale(e.a)) continue;
  if (e.v.sens >= 0) {
    succ[e.a].push(e.b);
    pred[e.b].push(e.a);
  }
  if (e.v.sens <= 0) {
    succ[e.b].push(e.a);
    pred[e.a].push(e.b);
  }
}
const ordreFin = [];
{
  const vu = new Uint8Array(nS);
  for (let s0 = 0; s0 < nS; s0++) {
    if (vu[s0] || !dansPrincipale(s0)) continue;
    vu[s0] = 1;
    const pile = [[s0, 0]];
    while (pile.length) {
      const haut = pile[pile.length - 1];
      const [s, k] = haut;
      if (k < succ[s].length) {
        haut[1]++;
        const t = succ[s][k];
        if (!vu[t]) {
          vu[t] = 1;
          pile.push([t, 0]);
        }
      } else {
        ordreFin.push(s);
        pile.pop();
      }
    }
  }
}
const fort = new Int32Array(nS).fill(-1);
const taillesFortes = [];
for (let n = ordreFin.length - 1; n >= 0; n--) {
  const s0 = ordreFin[n];
  if (fort[s0] >= 0) continue;
  const id = taillesFortes.length;
  let taille = 0;
  const pile = [s0];
  fort[s0] = id;
  while (pile.length) {
    const s = pile.pop();
    taille++;
    for (const t of pred[s]) {
      if (fort[t] < 0) {
        fort[t] = id;
        pile.push(t);
      }
    }
  }
  taillesFortes.push(taille);
}
let forte = 0;
for (let i = 1; i < taillesFortes.length; i++) if (taillesFortes[i] > taillesFortes[forte]) forte = i;
const garde = (s) => fort[s] === forte;
let kmPieges = 0;
for (const e of aretesUniques) if (dansPrincipale(e.a) && !(garde(e.a) && garde(e.b))) kmPieges += e.m / 1000;
const sommetsPieges = tailles[principale] - taillesFortes[forte];
console.log(
  `  forte connexité : ${taillesFortes[forte]} sommets gardés ; ${sommetsPieges} sommets / ${kmPieges.toFixed(0)} km ` +
    `de pièges à sens unique écartés`
);

const nouvelIndex = new Int32Array(nS).fill(-1);
const sommetsGardes = [];
for (let s = 0; s < nS; s++) {
  if (!garde(s)) continue;
  nouvelIndex[s] = sommetsGardes.length;
  sommetsGardes.push([+sommetsX[s].toFixed(5), +sommetsY[s].toFixed(5)]);
}
const aretesGardees = aretesUniques.filter((e) => garde(e.a) && garde(e.b));

/* ================================================================== */
/*  Écriture du graphe                                                */
/* ================================================================== */

mkdirSync(SORTIE, { recursive: true });

const classesOrdre = Object.keys(CLASSES);
const table = () => {
  const liste = [];
  const index = new Map();
  return {
    liste,
    id(v) {
      if (v == null) return -1;
      let i = index.get(v);
      if (i === undefined) {
        i = liste.length;
        liste.push(v);
        index.set(v, i);
      }
      return i;
    },
  };
};
const refs = table();
const noms = table();
const highways = table();

const graphe = {
  version: 1,
  genere: entete?.horodatage ?? null,
  source: {
    fichier: basename(SOURCE),
    md5,
    donnees: entete?.horodatage ?? null,
    origine: 'https://download.geofabrik.de/africa/morocco.html',
    licence: 'ODbL — © contributeurs OpenStreetMap',
  },
  classes: classesOrdre,
  vitesses: classesOrdre.map((c) => CLASSES[c].vitesse),
  refs: refs.liste,
  sommets: sommetsGardes,
  /** [a, b, mètres, classe, ref, sens, vitesse, ...géométrie aplatie] — schéma inchangé */
  aretes: [],
  /* Tables annexes, alignées sur `aretes` — ignorées par les chargeurs actuels. */
  noms: noms.liste,
  aretesNoms: [],
  highways: highways.liste,
  aretesHighway: [],
  /** bits : 1 pont, 2 tunnel, 4 non revêtu, 8 rond-point, 16 accès restreint (route principale gardée) */
  aretesAttr: [],
  aretesOsm: [],
};

for (const e of aretesGardees) {
  const pts = arrondir(simplifier(e.pts, TOLERANCE_GRAPHE));
  graphe.aretes.push([
    nouvelIndex[e.a],
    nouvelIndex[e.b],
    /* Au moins 1 m : aucune arête à coût nul (les morceaux de moins d'un
       mètre sont gardés pour la continuité des ronds-points). */
    Math.max(1, Math.round(e.m)),
    classesOrdre.indexOf(e.v.classe),
    refs.id(e.v.ref),
    e.v.sens,
    e.v.vitesse,
    ...pts.slice(1, -1).flat(),
  ]);
  graphe.aretesNoms.push(noms.id(e.v.nom));
  graphe.aretesHighway.push(highways.id(e.v.highway));
  graphe.aretesAttr.push(e.v.attr);
  graphe.aretesOsm.push(e.v.id);
}

const cheminGraphe = join(SORTIE, `graphe_routier${SUFFIXE}.json`);
writeFileSync(cheminGraphe, JSON.stringify(graphe));
const moGraphe = statSync(cheminGraphe).size / 1048576;
console.log(
  `\n  -> ${cheminGraphe}\n     ${graphe.sommets.length} sommets, ${graphe.aretes.length} arêtes, ${moGraphe.toFixed(1)} Mo`
);

/* ================================================================== */
/*  Couches d'affichage (même recollement que build-roads.mjs)        */
/* ================================================================== */

function fusionnerChaines(lot) {
  const parRef = new Map();
  for (const e of lot) {
    const cle = e.v.ref ?? `_${e.v.nom ?? 'sans-nom'}`;
    if (!parRef.has(cle)) parRef.set(cle, []);
    parRef.get(cle).push(e);
  }
  const chaines = [];
  for (const [, aretesRef] of parRef) {
    const parSommet = new Map();
    const libre = new Set(aretesRef.keys());
    aretesRef.forEach((e, i) => {
      for (const s of [e.a, e.b]) {
        if (!parSommet.has(s)) parSommet.set(s, []);
        parSommet.get(s).push(i);
      }
    });
    const suivante = (s, sauf) => {
      const c = (parSommet.get(s) ?? []).filter((i) => i !== sauf && libre.has(i));
      return c.length === 1 ? c[0] : null;
    };
    while (libre.size) {
      const depart = libre.values().next().value;
      libre.delete(depart);
      const e0 = aretesRef[depart];
      let pts = [...e0.pts];
      let metres = e0.m;
      let tete = e0.a;
      let queue = e0.b;
      let prec = depart;
      for (let i = suivante(queue, prec); i != null; i = suivante(queue, prec)) {
        libre.delete(i);
        const e = aretesRef[i];
        pts = pts.concat((e.a === queue ? e.pts : [...e.pts].reverse()).slice(1));
        queue = e.a === queue ? e.b : e.a;
        metres += e.m;
        prec = i;
      }
      prec = depart;
      for (let i = suivante(tete, prec); i != null; i = suivante(tete, prec)) {
        libre.delete(i);
        const e = aretesRef[i];
        pts = (e.b === tete ? e.pts : [...e.pts].reverse()).slice(0, -1).concat(pts);
        tete = e.b === tete ? e.a : e.b;
        metres += e.m;
        prec = i;
      }
      chaines.push({ ref: e0.v.ref, nom: e0.v.nom, pts, m: metres });
    }
  }
  return chaines;
}

const couches = {};
for (const classe of AFFICHEES) {
  const lot = aretesGardees.filter((e) => e.v.classe === classe);
  const features = fusionnerChaines(lot).map((c) => ({
    type: 'Feature',
    properties: { ref: c.ref, nom: c.nom, classe, km: +(c.m / 1000).toFixed(3) },
    geometry: { type: 'LineString', coordinates: arrondir(simplifier(c.pts, TOLERANCE_AFFICHAGE)) },
  }));
  const chemin = join(SORTIE, `routes_${classe}${SUFFIXE}.geojson`);
  writeFileSync(chemin, JSON.stringify({ type: 'FeatureCollection', features }));
  couches[classe] = { entites: features.length, mo: +(statSync(chemin).size / 1048576).toFixed(2) };
  console.log(`  -> routes_${classe}${SUFFIXE}.geojson  ${features.length} tronçons, ${couches[classe].mo} Mo`);
}

/* ================================================================== */
/*  Rapport                                                           */
/* ================================================================== */

const parClasse = {};
let kmTotal = 0;
let kmNommes = 0;
for (const e of aretesGardees) {
  const k = e.m / 1000;
  const c = (parClasse[e.v.classe] ??= { aretes: 0, km: 0 });
  c.aretes++;
  c.km += k;
  kmTotal += k;
  if (e.v.nom || e.v.ref) kmNommes += k;
}
for (const c of Object.values(parClasse)) c.km = Math.round(c.km);

const rapport = {
  source: graphe.source,
  entete,
  voiesRetenues: chemins.length,
  voiesEcartees: ecartes,
  noeudsUtilises: nUniques,
  noeudsHorsExtrait: sansCoord,
  voiesCoupeesHorsExtrait: coupeesHorsExtrait,
  sommets: graphe.sommets.length,
  aretes: graphe.aretes.length,
  kmTotal: Math.round(kmTotal),
  kmNommesOuNumerotes: Math.round(kmNommes),
  parClasse,
  composantes: tailles.length,
  sommetsIsolesEcartes: nS - tailles[principale],
  kmIsolesEcartes: Math.round(kmEcartes),
  sommetsPiegesSensUniqueEcartes: sommetsPieges,
  kmPiegesSensUniqueEcartes: Math.round(kmPieges),
  doublonsRetires: doublons,
  bouclesRetirees: boucles,
  courtesGardees,
  grapheMo: +moGraphe.toFixed(2),
  couches,
  dureeS: Math.round((Date.now() - t0) / 1000),
};
mkdirSync(dirname(RAPPORT), { recursive: true });
writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2));
console.log(`\n  rapport : ${RAPPORT}\n  durée   : ${rapport.dureeS} s\n`);
