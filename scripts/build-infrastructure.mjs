#!/usr/bin/env node
/**
 * Infrastructures de transport — données RÉELLES OpenStreetMap : gares
 * ferroviaires (ONCF), aéroports et ports du Maroc. Même principe que
 * scripts/build-peages.mjs : un fait géographique vérifiable, pas un jeu de
 * démonstration (voir scripts/fake-data.mjs pour ce qui, ailleurs dans ce
 * projet, EST synthétique).
 *
 *   node scripts/build-infrastructure.mjs
 *   node scripts/build-infrastructure.mjs --serveur <url>
 *
 * À LANCER SUR UN POSTE AVEC ACCÈS INTERNET, une fois — le serveur intranet
 * ne fait ensuite aucun appel sortant : il ne reçoit que les fichiers
 * produits (public/layers/gares.geojson, aeroports.geojson, ports.geojson).
 *
 * REGROUPEMENT : plusieurs éléments OSM décrivent souvent le même lieu réel
 * (une gare et ses deux quais, un port et ses postes à quai numérotés). Comme
 * pour les péages, on regroupe par nom normalisé puis par proximité — voir
 * `regrouper()`, factorisée ici pour les trois couches.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(ROOT, 'public/layers');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const PAYS = arg('pays', 'MA');
const SERVEUR = arg('serveur', 'https://overpass.kumi.systems/api/interpreter');

const R_TERRE = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function distanceM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

/** Écarte les libellés qui ne désignent qu'une sous-partie (un quai, un poste à quai numéroté). */
const NOM_GENERIQUE = /^(berth|quai|poste)\s*\d+$/i;

function normaliserNom(nom) {
  if (!nom || NOM_GENERIQUE.test(nom.trim())) return null;
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Regroupe des éléments OSM proches en lieux réels distincts — même nom
 * normalisé, ou proximité à défaut de nom.
 *
 * @param {object[]} elements  éléments OSM bruts (node ou way/relation avec `center`)
 * @param {number}   rayonM    distance en dessous de laquelle deux éléments SANS nom fusionnent
 */
function regrouper(elements, rayonM) {
  const groupes = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const nomNorm = normaliserNom(el.tags?.name);
    let groupe = nomNorm ? groupes.find((g) => g.nomNorm === nomNorm) : null;

    if (!groupe && !nomNorm) {
      groupe = groupes.find((g) => !g.nomNorm && distanceM([lon, lat], g.centre) < rayonM);
    }

    if (groupe) {
      groupe.elements.push(el);
      groupe.centre = [
        groupe.elements.reduce((s, x) => s + (x.lon ?? x.center?.lon), 0) / groupe.elements.length,
        groupe.elements.reduce((s, x) => s + (x.lat ?? x.center?.lat), 0) / groupe.elements.length,
      ];
      if (!groupe.nom && el.tags?.name && !NOM_GENERIQUE.test(el.tags.name.trim())) {
        groupe.nom = el.tags.name.trim();
      }
    } else {
      groupes.push({
        nomNorm,
        nom: nomNorm ? el.tags.name.trim() : null,
        centre: [lon, lat],
        elements: [el],
      });
    }
  }

  return groupes;
}

function versGeoJSON(groupes, { nomParDefaut, proprietes }) {
  return {
    type: 'FeatureCollection',
    features: groupes.map((g, i) => ({
      type: 'Feature',
      id: i,
      properties: { nom: g.nom ?? nomParDefaut, ...proprietes(g) },
      geometry: { type: 'Point', coordinates: g.centre },
    })),
  };
}

/* ---------------------------------------------------------------- */
/* Requêtes                                                          */
/* ---------------------------------------------------------------- */

const COUCHES = [
  {
    fichier: 'gares.geojson',
    libelle: 'gares ferroviaires',
    rayonM: 300,
    nomParDefaut: 'Gare',
    requete: (pays) => `
      area["ISO3166-1"="${pays}"][admin_level=2]->.pays;
      node(area.pays)["railway"="station"];
      out body;`,
    proprietes: () => ({}),
  },
  {
    fichier: 'aeroports.geojson',
    libelle: 'aéroports',
    rayonM: 500,
    nomParDefaut: 'Aéroport',
    requete: (pays) => `
      area["ISO3166-1"="${pays}"][admin_level=2]->.pays;
      (
        node(area.pays)["aeroway"="aerodrome"];
        way(area.pays)["aeroway"="aerodrome"];
      );
      out center;`,
    proprietes: (g) => ({ iata: g.elements.find((e) => e.tags?.iata)?.tags?.iata ?? null }),
  },
  {
    fichier: 'ports.geojson',
    libelle: 'ports',
    rayonM: 1200, // un port et ses postes à quai peuvent s'étendre sur plus d'un km
    nomParDefaut: 'Port',
    requete: (pays) => `
      area["ISO3166-1"="${pays}"][admin_level=2]->.pays;
      (
        node(area.pays)["harbour"="yes"];
        way(area.pays)["landuse"="harbour"];
        node(area.pays)["amenity"="ferry_terminal"];
      );
      out center;`,
    proprietes: () => ({}),
  },
];

console.log(`\nTéléchargement des infrastructures de transport — pays ${PAYS}`);
console.log(`Source : ${SERVEUR}\n`);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [i, couche] of COUCHES.entries()) {
  // Espacement entre requêtes : le serveur public renvoie parfois une
  // réponse vide sans erreur HTTP quand les appels se succèdent trop vite.
  if (i > 0) await attendre(3000);

  process.stdout.write(`  ${couche.libelle.padEnd(24)} `);

  let reponse;
  try {
    reponse = await fetch(SERVEUR, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        Accept: '*/*',
        'User-Agent': 'gendarmerie-royale-carte-tactique/1.0 (build-infrastructure.mjs)',
      },
      body: `[out:json][timeout:120];\n${couche.requete(PAYS)}`,
    });
  } catch (err) {
    console.log(`échec réseau : ${err.message}`);
    continue;
  }

  if (!reponse.ok) {
    console.log(`HTTP ${reponse.status} — non récupéré`);
    continue;
  }

  const corps = await reponse.json();
  if (corps.remark) {
    console.log(`réponse incomplète (${corps.remark}) — lot ignoré, relancez le script`);
    continue;
  }
  const elements = (corps.elements ?? []).filter(
    (e) => Number.isFinite(e.lat ?? e.center?.lat) && Number.isFinite(e.lon ?? e.center?.lon)
  );

  const groupes = regrouper(elements, couche.rayonM);
  const geojson = versGeoJSON(groupes, { nomParDefaut: couche.nomParDefaut, proprietes: couche.proprietes });

  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(join(SORTIE, couche.fichier), JSON.stringify(geojson));

  const sansNom = groupes.filter((g) => !g.nom).length;
  console.log(
    `${String(elements.length).padStart(4)} élément(s) brut(s) -> ${String(groupes.length).padStart(3)} ` +
      `lieu(x)${sansNom ? `, ${sansNom} sans nom` : ''}`
  );
}

console.log('\nCouches écrites dans public/layers/.\n');
