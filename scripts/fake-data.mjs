#!/usr/bin/env node
/**
 * Génération d'un JEU DE DONNÉES FICTIF pour la carte tactique.
 *
 *   node scripts/fake-data.mjs        ->  public/layers/*.geojson (+ _report.json)
 *
 * À utiliser quand les données réelles (data/**) ne sont pas disponibles :
 * ce script produit EXACTEMENT les mêmes fichiers, avec les mêmes attributs,
 * que `npm run build:layers` — l'application, l'analyse et les popups
 * fonctionnent donc sans aucune modification du code.
 *
 * AUCUNE donnée réelle n'est utilisée. Les noms de villes sont authentiques
 * (pour la vraisemblance géographique), tout le reste — découpages, effectifs,
 * populations, pointages — est inventé et n'a aucune valeur opérationnelle.
 *
 * Sortie déterministe : même graine (SEED) => mêmes fichiers, ce qui permet de
 * comparer deux exécutions et de rejouer une démonstration à l'identique.
 *
 * Hiérarchie produite (chaque niveau pave exactement son parent) :
 *   Maroc  ->  12 régions  ->  ~70 compagnies  ->  ~500 brigades territoriales
 */
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

/* ================================================================== */
/*  PARAMÈTRES — LE SEUL BLOC À MODIFIER                              */
/* ================================================================== */

/** Graine du générateur pseudo-aléatoire : changez-la pour un autre jeu. */
const SEED = 20260804;

/** Nombre de compagnies par région (tiré dans l'intervalle). */
const CIES_PAR_REGION = [4, 8];

/** Nombre de brigades territoriales par compagnie. */
const BT_PAR_CIE = [5, 11];

/** Pointages de flottes à générer. */
const NB_POINTAGES = 380;

/** Pointages supplémentaires collés à un pointage existant (< 5 km),
 *  pour que la couche « proximité » ait de la matière à montrer. */
const NB_POINTAGES_PROCHES = 26;

/** Instant de référence des pointages (fixe : sortie reproductible). */
const MAINTENANT = Date.parse('2026-08-04T08:00:00Z');

/* ================================================================== */
/*  Aléatoire reproductible                                           */
/* ================================================================== */

/** mulberry32 : générateur simple, rapide et déterministe. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(SEED);
/** Entier dans [min, max] inclus. */
const entre = (min, max) => min + Math.floor(rnd() * (max - min + 1));
/** Réel dans [min, max[. */
const reel = (min, max) => min + rnd() * (max - min);
const choix = (arr) => arr[Math.floor(rnd() * arr.length)];

/* ================================================================== */
/*  Emprise nationale (contour volontairement schématique)            */
/* ================================================================== */

/**
 * Contour national simplifié, en [lng, lat]. Il ne sert qu'à borner la
 * génération : tout point tiré en dehors est rejeté, et les découpages sont
 * découpés dessus. Ce n'est PAS une frontière de référence.
 */
const CONTOUR_MAROC = [
  // Côte méditerranéenne, d'ouest en est
  [-5.92, 35.79], [-5.3, 35.9], [-4.3, 35.2], [-3.0, 35.25], [-2.2, 35.1],
  // Frontière est, du nord au sud
  [-1.8, 34.75], [-1.6, 33.7], [-1.1, 32.9], [-1.25, 32.1], [-2.0, 31.6],
  [-3.0, 31.3], [-3.7, 30.6], [-4.6, 30.2], [-5.6, 29.6], [-6.6, 29.3],
  [-7.6, 29.0], [-8.7, 28.7], [-8.68, 27.66], [-8.67, 25.99], [-12.0, 25.99],
  [-13.0, 24.0], [-13.15, 22.76], [-13.0, 21.42], [-16.95, 21.42],
  // Côte atlantique, du sud au nord
  [-17.0, 21.6], [-16.2, 22.3], [-15.0, 23.7], [-14.5, 25.0], [-13.4, 26.2],
  [-12.0, 27.9], [-11.0, 28.4], [-10.0, 29.4], [-9.75, 30.2], [-9.77, 31.51],
  [-9.24, 32.3], [-8.5, 33.25], [-7.59, 33.62], [-6.84, 34.05], [-6.15, 35.19],
  [-5.92, 35.79],
];

const MAROC = turf.polygon([CONTOUR_MAROC]);

/* ================================================================== */
/*  Nomenclature (villes réelles, découpages inventés)                */
/* ================================================================== */

/**
 * Régions : nom, chef-lieu (coordonnées approximatives de la ville) et
 * densité de peuplement retenue pour fabriquer les populations (hab./km²).
 */
const REGIONS = [
  {
    nom: 'Tanger-Tétouan-Al Hoceïma', chefLieu: [-5.83, 35.76], densite: 185,
    villes: ['Tanger', 'Tétouan', 'Larache', 'Chefchaouen', 'Al Hoceïma', 'Ouezzane', 'Fnideq', 'Assilah'],
  },
  {
    nom: "L'Oriental", chefLieu: [-1.91, 34.68], densite: 26,
    villes: ['Oujda', 'Nador', 'Berkane', 'Taourirt', 'Jerada', 'Figuig', 'Driouch', 'Guercif'],
  },
  {
    nom: 'Fès-Meknès', chefLieu: [-5.0, 34.03], densite: 105,
    villes: ['Fès', 'Meknès', 'Taza', 'Sefrou', 'El Hajeb', 'Ifrane', 'Taounate', 'Boulemane'],
  },
  {
    nom: 'Rabat-Salé-Kénitra', chefLieu: [-6.84, 34.02], densite: 265,
    villes: ['Rabat', 'Salé', 'Kénitra', 'Témara', 'Khémisset', 'Sidi Kacem', 'Sidi Slimane', 'Sidi Yahya'],
  },
  {
    nom: 'Béni Mellal-Khénifra', chefLieu: [-6.36, 32.34], densite: 92,
    villes: ['Béni Mellal', 'Khénifra', 'Khouribga', 'Fquih Ben Salah', 'Azilal', 'Kasba Tadla', 'Oued Zem'],
  },
  {
    nom: 'Casablanca-Settat', chefLieu: [-7.59, 33.57], densite: 340,
    villes: ['Casablanca', 'Mohammédia', 'Settat', 'Berrechid', 'El Jadida', 'Benslimane', 'Sidi Bennour', 'Médiouna'],
  },
  {
    nom: 'Marrakech-Safi', chefLieu: [-7.99, 31.63], densite: 96,
    villes: ['Marrakech', 'Safi', 'Essaouira', 'El Kelâa des Sraghna', 'Chichaoua', 'Youssoufia', 'Amizmiz', 'Ben Guerir'],
  },
  {
    nom: 'Drâa-Tafilalet', chefLieu: [-4.43, 31.93], densite: 9,
    villes: ['Errachidia', 'Ouarzazate', 'Zagora', 'Tinghir', 'Midelt', 'Rissani', "Kelaat M'Gouna"],
  },
  {
    nom: 'Souss-Massa', chefLieu: [-9.6, 30.43], densite: 58,
    villes: ['Agadir', 'Inezgane', 'Taroudant', 'Tiznit', 'Biougra', 'Tata', 'Oulad Teïma', 'Aït Melloul'],
  },
  {
    nom: 'Guelmim-Oued Noun', chefLieu: [-10.06, 28.99], densite: 5,
    villes: ['Guelmim', 'Tan-Tan', 'Sidi Ifni', 'Assa-Zag', 'Bouizakarne'],
  },
  {
    nom: 'Laâyoune-Sakia El Hamra', chefLieu: [-13.2, 27.15], densite: 2.6,
    villes: ['Laâyoune', 'Boujdour', 'Tarfaya', 'Es-Semara', 'Foum El Oued'],
  },
  {
    nom: 'Dakhla-Oued Ed-Dahab', chefLieu: [-15.93, 23.72], densite: 1.2,
    villes: ['Dakhla', 'Aousserd', 'Bir Gandouz', 'Imlili'],
  },
];

/** Localités servant de noms de brigades territoriales. */
const LOCALITES = [
  'Aït Ourir', 'Aït Melloul', 'Aït Baha', 'Aït Attab', 'Aït Ishaq', 'Aït Ammar',
  'Sidi Bouzid', 'Sidi Rahal', 'Sidi Allal', 'Sidi Moussa', 'Sidi Smaïl', 'Sidi Bibi',
  'Oulad Berhil', 'Oulad Frej', 'Oulad Ali', 'Oulad Zbaïr', 'Oulad Hassoune',
  'Bab Berred', 'Bab Taza', 'Bni Bouayach', 'Bni Ansar', 'Bni Chiker', 'Bni Drar',
  'Dar Bouazza', 'Dar Gueddari', 'Dar Chaoui', 'Dar El Kebdani',
  'Douar Laouamra', 'Zaouiat Cheikh', 'Zaïo', 'Zeghanghane', 'Zoumi',
  'Tamesna', 'Tamansourt', 'Temsia', 'Tafraout', 'Tahannaout', 'Talmest',
  'Taliouine', 'Tarast', 'Tabounte', 'Tinejdad', 'Tissa', 'Tit Mellil',
  'Skhirat', 'Sebt Gzoula', 'Souk El Arbaa', 'Souk Sebt', 'Sabaa Aiyoun',
  'Moulay Bousselham', 'Moulay Driss', 'Moulay Idriss', 'Moulay Abdallah',
  'El Aioun', 'El Borouj', 'El Gara', 'El Hanchane', 'El Ksiba', 'El Menzel',
  'Ahfir', 'Aknoul', 'Alnif', 'Amalou', 'Arbaoua', 'Aoulouz', 'Argana',
  'Boumia', 'Bouarfa', 'Boudnib', 'Bouknadel', 'Boulanouar', 'Bouskoura',
  'Guisser', 'Ghafsai', 'Galaz', 'Had Kourt', 'Had Soualem', 'Harhoura',
  'Imouzzer', 'Ifni Plage', 'Ighrem', 'Immouzer Kandar', 'Inahnahen',
  'Jorf El Melha', 'Jamaat Shaim', 'Kariat Arekmane', 'Karia Ba Mohamed',
  'Lalla Mimouna', 'Laâtamna', 'Loudaya', 'Mrirt', 'Mechra Bel Ksiri',
  'Naïma', 'Nzalat Beni Amar', 'Ounagha', 'Oued Amlil', 'Oued Laou',
  'Ras El Aïn', 'Ribat El Kheir', 'Reggada', 'Sahel', 'Setti Fatma',
  'Tafetachte', 'Tamri', 'Taghjijt', 'Tafoughalt', 'Taghzout', 'Tazarine',
  'Tarmigt', 'Tighassaline', 'Tilmi', 'Toundoute', 'Timahdit', 'Tizi Ouasli',
  'Zag', 'Zawiya', 'Aghbalou', 'Agourai', 'Aïn Aouda', 'Aïn Bni Mathar',
  'Aïn Cheggag', 'Aïn Chkef', 'Aïn Dorbane', 'Aïn Erreggada', 'Aïn Harrouda',
  'Aïn Leuh', 'Aïn Taoujdate', 'Aït Iaaza', 'Aït Faska', 'Aït Bouguemez',
  'Bejaad', 'Ben Ahmed', 'Ben Taïeb', 'Bhalil', 'Bir Jdid', 'Bouabout',
  'Chemaia', 'Chtouka', 'Dcheira', 'Demnate', 'Deroua', 'Echemmaia',
  'Fam El Hisn', 'Foum Jamaa', 'Foum Zguid', 'Gourrama', 'Goulmima',
  'Ida Ou Gnidif', 'Irherm', 'Ito', 'Kandar', 'Kelaat Sraghna', 'Kerrouchen',
  'Lakhsas', 'Laqliaa', 'Lamzoudia', 'Marnissa', 'Massa', 'Mediq',
  'Missour', 'Mzouda', 'Nkob', 'Ouaouizeght', 'Oualidia', 'Ouezzane Sud',
  'Oulmès', 'Rafsai', 'Rich', 'Saada', 'Sarghine', 'Sidi Bennour Nord',
  'Sidi Chiker', 'Sidi El Aidi', 'Sidi Hajjaj', 'Sidi Ifni Plage',
  'Sidi Jaber', 'Sidi Kaouki', 'Sidi Yahya El Gharb', 'Skhour Rehamna',
  'Tagounite', 'Talsint', 'Tamallalt', 'Tanant', 'Taourirt Nord', 'Targuist',
  'Taznakht', 'Tendrara', 'Tiflet', 'Tinghir Sud', 'Tizi Nisly', 'Zerkten',
];

/** Missions et sous-missions des pointages de flottes. */
const MISSIONS = [
  { mission: 'Contrôle routier', sous: ['Vitesse', 'Alcoolémie', 'Documents', 'Surcharge', 'Ceinture'] },
  { mission: 'Sécurité routière', sous: ['Radar mobile', 'Prévention', 'Signalisation'] },
  { mission: 'Barrage', sous: ['Filtrage', 'Recherche véhicule', 'Contrôle identité'] },
  { mission: 'Patrouille', sous: ['Axe principal', 'Zone rurale', 'Périmètre urbain'] },
  { mission: 'Escorte', sous: ['Convoi exceptionnel', 'Transport de fonds', 'Autorité'] },
];

const ROUTES = ['RN1', 'RN2', 'RN6', 'RN8', 'RN9', 'RN10', 'RN11', 'RN13', 'RN16', 'A1', 'A3', 'A7', 'A8', 'RR301', 'RR504', 'RP2005'];

/* ================================================================== */
/*  Géométrie : pavage hiérarchique                                   */
/* ================================================================== */

/** Un point tombe-t-il dans le polygone (ou multipolygone) ? */
const dedans = (lngLat, poly) => turf.booleanPointInPolygon(lngLat, poly);

/**
 * Tire `n` points bien répartis dans un polygone.
 *
 * Échantillonnage « meilleur candidat » : à chaque tirage on propose plusieurs
 * positions et on garde la plus éloignée des points déjà retenus. Les cellules
 * du pavage qui en découle restent ainsi de tailles comparables, au lieu de
 * produire des éclats quand deux germes tombent côte à côte.
 */
function semer(poly, n, imposes = []) {
  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  const pts = [...imposes];
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

  for (let i = pts.length; i < n; i++) {
    let meilleur = null;
    let meilleurEcart = -1;

    for (let essai = 0; essai < 40; essai++) {
      const c = [reel(minX, maxX), reel(minY, maxY)];
      if (!dedans(c, poly)) continue;
      const ecart = pts.length ? Math.min(...pts.map((p) => dist2(c, p))) : Infinity;
      if (ecart > meilleurEcart) {
        meilleurEcart = ecart;
        meilleur = c;
      }
    }
    if (meilleur) pts.push(meilleur);
  }
  return pts;
}

/**
 * Découpe `parent` en cellules de Voronoï autour de `germes`.
 *
 * Le diagramme est calculé sur une boîte élargie puis intersecté avec le
 * parent : les cellules pavent donc exactement le parent, frontières jointives
 * et sans recouvrement — c'est ce qui rend l'emboîtement région / compagnie /
 * brigade cohérent à tous les niveaux.
 *
 * @returns tableau aligné sur `germes` (null si la cellule est vide)
 */
function paver(parent, germes) {
  if (germes.length === 1) return [parent];

  const [minX, minY, maxX, maxY] = turf.bbox(parent);
  const marge = 1.5;
  const cellules = turf.voronoi(turf.featureCollection(germes.map((g) => turf.point(g))), {
    bbox: [minX - marge, minY - marge, maxX + marge, maxY + marge],
  });

  const sorties = germes.map(() => null);

  for (const cellule of cellules.features) {
    if (!cellule) continue;
    // Rattache la cellule à SON germe : l'ordre renvoyé n'est pas garanti.
    const i = germes.findIndex((g) => dedans(g, cellule));
    if (i < 0 || sorties[i]) continue;

    const morceau = turf.intersect(turf.featureCollection([cellule, parent]));
    if (morceau) sorties[i] = morceau;
  }
  return sorties;
}

/** Arrondit toutes les coordonnées d'une géométrie (5 décimales ~ 1 m). */
function arrondir(geometry, d = 5) {
  const r = (c) =>
    Array.isArray(c[0]) ? c.map(r) : [+c[0].toFixed(d), +c[1].toFixed(d)];
  return { type: geometry.type, coordinates: r(geometry.coordinates) };
}

const km2 = (feature) => turf.area(feature) / 1e6;

/** Point garanti à l'intérieur d'un polygone (le centroïde peut en sortir). */
const dedansSur = (feature) => turf.pointOnFeature(feature).geometry.coordinates;

/* ================================================================== */
/*  Construction du jeu de données                                    */
/* ================================================================== */

console.log('\nGénération du jeu de données FICTIF (aucune donnée réelle)\n');

/* ---- Niveau 1 : régions ---- */

const germesRegions = REGIONS.map((r) => r.chefLieu);
const polysRegions = paver(MAROC, germesRegions);

const regions = REGIONS.map((r, i) => ({
  ...r,
  poly: polysRegions[i],
  cies: [],
}));

const sansContour = regions.filter((r) => !r.poly);
if (sansContour.length) {
  console.log(`  ! ${sansContour.length} région(s) sans contour : ${sansContour.map((r) => r.nom).join(', ')}`);
}

console.log(`  régions      : ${regions.filter((r) => r.poly).length}/${REGIONS.length}`);

/* ---- Niveau 2 : compagnies ---- */

for (const region of regions) {
  if (!region.poly) continue;

  const voulu = Math.min(region.villes.length, entre(...CIES_PAR_REGION));
  // Le chef-lieu de région est imposé : il tombe donc dans la 1re compagnie.
  const germes = semer(region.poly, voulu, [region.chefLieu]);
  const polys = paver(region.poly, germes);

  polys.forEach((poly, i) => {
    if (!poly) return;
    region.cies.push({
      nom: region.villes[i] ?? `${region.villes[0]} ${i + 1}`,
      region,
      germe: germes[i],
      poly,
      bts: [],
    });
  });
}

const cies = regions.flatMap((r) => r.cies);
console.log(`  compagnies   : ${cies.length}`);

/* ---- Niveau 3 : brigades territoriales ---- */

const nomsPris = new Set();
/** Nom de localité encore libre ; suffixé si le stock est épuisé. */
function nomLocalite() {
  for (let essai = 0; essai < 60; essai++) {
    const n = choix(LOCALITES);
    if (!nomsPris.has(n)) {
      nomsPris.add(n);
      return n;
    }
  }
  let i = 2;
  let n;
  do {
    n = `${choix(LOCALITES)} ${i++}`;
  } while (nomsPris.has(n));
  nomsPris.add(n);
  return n;
}

for (const cie of cies) {
  const voulu = entre(...BT_PAR_CIE);
  // Le chef-lieu de compagnie accueille toujours une brigade.
  const germes = semer(cie.poly, voulu, [cie.germe]);
  const polys = paver(cie.poly, germes);

  polys.forEach((poly, i) => {
    if (!poly) return;
    const superficie = km2(poly);
    // Population fabriquée : densité régionale, modulée par un aléa large —
    // les écarts de charge par brigade sont ainsi analysables.
    const population = Math.max(
      1200,
      Math.round(superficie * cie.region.densite * reel(0.35, 2.1))
    );
    cie.bts.push({
      nom: i === 0 ? cie.nom : nomLocalite(),
      cie,
      germe: germes[i],
      poly,
      superficie,
      population,
    });
  });
}

const bts = cies.flatMap((c) => c.bts);
console.log(`  brigades     : ${bts.length}`);

/* ---- Agrégats des niveaux supérieurs (comme au build réel) ---- */

const agreger = (btsDuGroupe) => ({
  nbBt: btsDuGroupe.length,
  nbCie: new Set(btsDuGroupe.map((b) => b.cie.nom)).size,
  population: Math.round(btsDuGroupe.reduce((s, b) => s + b.population, 0)),
  superficie: Math.round(btsDuGroupe.reduce((s, b) => s + b.superficie, 0)),
});

/**
 * Confiance d'attribution : au build réel elle mesure la part des votes
 * concordants. Ici le découpage est exact par construction, donc 1 — sauf sur
 * quelques contours volontairement marqués comme douteux, pour que la section
 * « qualité des données » ait quelque chose de représentatif à signaler.
 */
const douteux = [];
const confiance = (nom) => {
  if (rnd() >= 0.08) return 1;
  const c = +reel(0.55, 0.79).toFixed(2);
  douteux.push({ nom, confiance: c });
  return c;
};

/* ================================================================== */
/*  Écriture des couches                                              */
/* ================================================================== */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIES = [resolve(ROOT, 'public/layers')];
// dist/ n'existe qu'après `npm run build` : on y recopie pour que
// `npm run serve` (déploiement intranet) montre les mêmes données.
if (existsSync(resolve(ROOT, 'dist'))) SORTIES.push(resolve(ROOT, 'dist/layers'));
for (const d of SORTIES) mkdirSync(d, { recursive: true });

const report = { fictif: true, graine: SEED, layers: {}, issues: [] };
const issue = (level, message, count = null) => report.issues.push({ level, message, count });

const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' Mo';

function ecrire(nom, features, extra = {}) {
  const geojson = { type: 'FeatureCollection', features };
  const json = JSON.stringify(geojson);
  for (const dir of SORTIES) writeFileSync(resolve(dir, nom), json);

  const chemin = resolve(SORTIES[0], nom);
  console.log(`  -> public/layers/${nom}  (${features.length} entités, ${mb(chemin)})`);
  report.layers[nom.replace('.geojson', '')] = {
    entites: features.length,
    taille: mb(chemin),
    source: 'généré (fictif)',
    ...extra,
  };
}

console.log('');

/* ---- Circonscriptions BT : porte gr_bde / gr_cie / gr_region ---- */
ecrire(
  'circo_bt.geojson',
  bts.map((b) => ({
    type: 'Feature',
    properties: {
      gr_bde: b.nom,
      gr_cie: b.cie.nom,
      gr_region: b.cie.region.nom,
      population: b.population,
      superficie: Math.round(b.superficie),
    },
    geometry: arrondir(b.poly.geometry),
  }))
);

/* ---- Circonscriptions Compagnies : nommées + agrégats ---- */
ecrire(
  'circo_cie.geojson',
  cies.map((c) => ({
    type: 'Feature',
    properties: {
      nom: c.nom,
      ...agreger(c.bts),
      confiance: confiance(c.nom),
      reg: c.region.nom,
    },
    geometry: arrondir(c.poly.geometry),
  }))
);

/* ---- Circonscriptions Régions : nommées + agrégats ---- */
ecrire(
  'circo_reg.geojson',
  regions
    .filter((r) => r.poly)
    .map((r) => ({
      type: 'Feature',
      properties: {
        nom: r.nom,
        ...agreger(r.cies.flatMap((c) => c.bts)),
        confiance: confiance(r.nom),
      },
      geometry: arrondir(r.poly.geometry),
    }))
);

/* ---- Chefs-lieux de régions ---- */
ecrire(
  'pts_reg.geojson',
  regions
    .filter((r) => r.poly)
    .map((r) => ({
      type: 'Feature',
      properties: {
        nom: r.nom,
        unite: `Région de gendarmerie — ${r.nom}`,
        categorie: 'Commandement régional',
      },
      geometry: { type: 'Point', coordinates: r.chefLieu },
    }))
);

/* ---- Chefs-lieux de compagnies ---- */
ecrire(
  'pts_cie.geojson',
  cies.map((c) => ({
    type: 'Feature',
    properties: {
      nom: c.nom,
      unite: `Compagnie de ${c.nom}`,
      categorie: choix(['Compagnie', 'Compagnie', 'Compagnie renforcée', 'Escadron']),
    },
    geometry: arrondir({ type: 'Point', coordinates: c.germe }),
  }))
);

/* ---- Brigades territoriales ---- */
ecrire(
  'pts_bt.geojson',
  bts.map((b) => ({
    type: 'Feature',
    properties: { nom: b.nom, cie: b.cie.nom, reg: b.cie.region.nom },
    geometry: arrondir({ type: 'Point', coordinates: b.germe }),
  }))
);

/* ================================================================== */
/*  Pointages de flottes                                              */
/* ================================================================== */

/**
 * Tirage pondéré par la population : les pointages se concentrent là où il y a
 * du monde, comme une activité réelle, au lieu d'être uniformes sur le
 * territoire (ce qui saturerait les provinces désertiques).
 */
const poids = [];
let cumul = 0;
for (const b of bts) {
  cumul += Math.sqrt(b.population);
  poids.push(cumul);
}
const tirerBt = () => {
  const x = rnd() * cumul;
  let lo = 0;
  let hi = poids.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poids[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return bts[lo];
};

/** Identifiant à la façon d'un ObjectId Mongo (24 caractères hexadécimaux). */
const oid = () =>
  Array.from({ length: 24 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

/** Décale un point de `km` kilomètres dans une direction quelconque. */
function decaler([lng, lat], km) {
  const cap = reel(0, 2 * Math.PI);
  const dLat = (km / 111) * Math.sin(cap);
  const dLng = (km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))) * Math.cos(cap);
  return [lng + dLng, lat + dLat];
}

function pointage(lngLat, bt) {
  const m = choix(MISSIONS);
  const debut = MAINTENANT - entre(0, 30 * 24) * 3600_000 - entre(0, 59) * 60_000;
  const duree = entre(2, 7) * 3600_000;

  return {
    type: 'Feature',
    properties: {
      id: oid(),
      unite: `BT ${bt.nom}`,
      uniteId: oid().slice(0, 12),
      pk: `PK ${entre(1, 240)} — ${choix(ROUTES)}`,
      mission: m.mission,
      sousMission: choix(m.sous),
      diametre: choix([200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 2500]),
      debut: new Date(debut).toISOString(),
      fin: new Date(debut + duree).toISOString(),
      bde: bt.nom,
      cie: bt.cie.nom,
      reg: bt.cie.region.nom,
    },
    geometry: arrondir({ type: 'Point', coordinates: lngLat }),
  };
}

const pointages = [];

// Tirage principal : dans la circonscription de la brigade concernée.
while (pointages.length < NB_POINTAGES) {
  const bt = tirerBt();
  let pos = null;
  for (let essai = 0; essai < 25 && !pos; essai++) {
    const c = decaler(bt.germe, reel(0.5, Math.max(3, Math.sqrt(bt.superficie) / 2)));
    if (dedans(c, bt.poly)) pos = c;
  }
  pointages.push(pointage(pos ?? dedansSur(bt.poly), bt));
}

/**
 * Localise un point dans les circonscriptions BT, comme le fait le build réel :
 * le rattachement (bde / cie / reg) doit décrire la circonscription qui
 * contient VRAIMENT le point, sinon l'analyse par région compterait des
 * pointages là où ils ne sont pas. Pré-filtre par boîte englobante.
 */
const boites = bts.map((b) => ({ bt: b, bbox: turf.bbox(b.poly) }));
const localiser = ([lng, lat]) => {
  for (const { bt, bbox } of boites) {
    if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (dedans([lng, lat], bt.poly)) return bt;
  }
  return null;
};

// Doublons de proximité : alimente la couche « pointages à moins de 5 km ».
let rapproches = 0;
for (let i = 0; i < NB_POINTAGES_PROCHES; i++) {
  const ref = pointages[Math.floor(rnd() * NB_POINTAGES)];
  for (let essai = 0; essai < 30; essai++) {
    const pos = decaler(ref.geometry.coordinates, reel(0.4, 4.2));
    const bt = localiser(pos); // hors territoire (mer, frontière) -> nouveau tirage
    if (!bt) continue;
    pointages.push(pointage(pos, bt));
    rapproches++;
    break;
  }
}

const regionsCouvertes = new Set(pointages.map((p) => p.properties.reg));
console.log(
  `\n  pointages    : ${pointages.length} sur ${regionsCouvertes.size}/${regions.length} régions ` +
    `(${rapproches} volontairement rapprochés)`
);
console.log('');

ecrire('pointages.geojson', pointages, {
  rapproches,
  regionsCouvertes: regionsCouvertes.size,
});

/* ================================================================== */
/*  Rapport de qualité (section « qualité des données »)              */
/* ================================================================== */

issue(
  'critical',
  'Jeu de DÉMONSTRATION : découpages, populations, superficies et pointages sont générés artificiellement (node scripts/fake-data.mjs) — aucune valeur opérationnelle.',
  null
);

const compter = (nom) => report.layers[nom]?.entites ?? 0;

/* Contours marqués comme douteux à la génération (confiance < 0,8). */
if (douteux.length) {
  const pires = douteux
    .sort((a, b) => a.confiance - b.confiance)
    .slice(0, 3)
    .map((d) => `${d.nom} ${Math.round(d.confiance * 100)} %`);
  issue(
    'warning',
    `${douteux.length} contours portent une confiance d'attribution inférieure à 80 % (${pires.join(', ')}) : leur rattachement resterait à vérifier sur des données réelles.`,
    douteux.length
  );
}

const sansPointage = regions.filter((r) => r.poly && !regionsCouvertes.has(r.nom));
if (sansPointage.length) {
  issue(
    'warning',
    `${sansPointage.length} région(s) sans aucun pointage (${sansPointage.map((r) => r.nom).join(', ')}) : couverture terrain incomplète dans le jeu généré.`,
    sansPointage.length
  );
}

if (sansContour.length) {
  issue(
    'serious',
    `${sansContour.length} région(s) n'ont pu être pavées : ${sansContour.map((r) => r.nom).join(', ')}.`,
    sansContour.length
  );
}

issue(
  'warning',
  `Les contours sont des cellules de Voronoï : les frontières sont rectilignes et ne correspondent à aucun découpage administratif réel.`,
  null
);

issue(
  'serious',
  `Les ${compter('pointages')} pointages portent des dates comprises dans les 30 jours précédant le 4 août 2026, figées à la génération : elles ne vieillissent pas.`,
  compter('pointages')
);

report.couches = Object.keys(report.layers).length;
report.couchesAttendues = 7;

for (const dir of SORTIES) {
  writeFileSync(resolve(dir, '_report.json'), JSON.stringify(report, null, 2));
}

console.log(
  `Terminé : ${report.couches} couches fictives générées dans ${SORTIES.map((d) => d.replace(ROOT + '\\', '').replace(ROOT + '/', '')).join(' et ')}.`
);
console.log(`Rapport : _report.json (${report.issues.length} anomalie(s) déclarée(s))\n`);
