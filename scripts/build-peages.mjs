#!/usr/bin/env node
/**
 * Péages du réseau autoroutier — données réelles OpenStreetMap (barrières de
 * péage, `barrier=toll_booth`), pas un jeu saisi à la main : contrairement aux
 * circonscriptions ou aux pointages de flotte (voir scripts/fake-data.mjs),
 * l'emplacement d'un péage est un fait géographique vérifiable, au même titre
 * que le tracé des autoroutes (scripts/fetch-roads.mjs).
 *
 *   node scripts/build-peages.mjs                -> public/layers/peages.geojson
 *   node scripts/build-peages.mjs --serveur <url>
 *
 * À LANCER SUR UN POSTE AVEC ACCÈS INTERNET, une fois — le serveur intranet ne
 * fait ensuite aucun appel sortant : il ne reçoit que le fichier produit.
 *
 * REGROUPEMENT : une gare de péage porte souvent PLUSIEURS barrières OSM (une
 * par voie de péage). Les regrouper par nom (normalisé) ou, à défaut, par
 * proximité (< 400 m) évite d'afficher une dizaine de repères superposés pour
 * un seul poste réel.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(ROOT, 'public/layers/peages.geojson');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const PAYS = arg('pays', 'MA');
const SERVEUR = arg('serveur', 'https://overpass-api.de/api/interpreter');
const RAYON_REGROUPEMENT_M = 400;

const R_TERRE = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Distance géodésique en mètres (haversine) — même formule que build-roads.mjs. */
function distanceM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

/** « Péage de Kénitra Centre » / « Péage d'Oujda » -> « kenitra centre » — pour comparer sans accent ni préfixe. */
function normaliserNom(nom) {
  if (!nom) return null;
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^peage\s+(de\s+|d'|du\s+)?/, '')
    .trim();
}

console.log(`\nTéléchargement des péages — pays ${PAYS}`);
console.log(`Source : ${SERVEUR}\n`);

const requete = `[out:json][timeout:120];
area["ISO3166-1"="${PAYS}"][admin_level=2]->.pays;
node(area.pays)["barrier"="toll_booth"];
out body;`;

let reponse;
try {
  reponse = await fetch(SERVEUR, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: '*/*',
      'User-Agent': 'gendarmerie-royale-carte-tactique/1.0 (build-peages.mjs)',
    },
    body: requete,
  });
} catch (err) {
  console.error(`  échec réseau : ${err.message}`);
  process.exit(1);
}

if (!reponse.ok) {
  const detail = await reponse.text().catch(() => '');
  console.error(`  HTTP ${reponse.status} — le serveur Overpass n'a pas répondu correctement`);
  console.error(detail.slice(0, 2000));
  process.exit(1);
}

const corps = await reponse.json();
const noeuds = (corps.elements ?? []).filter((e) => e.type === 'node' && Number.isFinite(e.lat) && Number.isFinite(e.lon));
console.log(`  ${noeuds.length} barrière(s) de péage brute(s)`);

/* ---------------------------------------------------------------- */
/* Regroupement en postes réels                                     */
/* ---------------------------------------------------------------- */

const groupes = [];

for (const n of noeuds) {
  const nomNorm = normaliserNom(n.tags?.name);

  // Même nom déjà vu : rejoint ce groupe, quelle que soit la distance (les
  // deux sens d'une même gare peuvent être à plusieurs centaines de mètres).
  let groupe = nomNorm ? groupes.find((g) => g.nomNorm === nomNorm) : null;

  // Sans nom : rejoint le groupe SANS NOM le plus proche, si assez près.
  if (!groupe && !nomNorm) {
    groupe = groupes.find(
      (g) => !g.nomNorm && distanceM([n.lon, n.lat], g.centre) < RAYON_REGROUPEMENT_M
    );
  }

  if (groupe) {
    groupe.noeuds.push(n);
    // Centroïde recalculé à chaque ajout — dérive lente, sans incidence pratique.
    groupe.centre = [
      groupe.noeuds.reduce((s, x) => s + x.lon, 0) / groupe.noeuds.length,
      groupe.noeuds.reduce((s, x) => s + x.lat, 0) / groupe.noeuds.length,
    ];
    if (!groupe.nom && n.tags?.name) groupe.nom = n.tags.name.trim();
    if (!groupe.operateur && n.tags?.operator) groupe.operateur = n.tags.operator;
  } else {
    groupes.push({
      nomNorm,
      nom: n.tags?.name?.trim() ?? null,
      operateur: n.tags?.operator ?? null,
      centre: [n.lon, n.lat],
      noeuds: [n],
    });
  }
}

console.log(`  ${groupes.length} poste(s) de péage distinct(s) après regroupement\n`);

const sansNom = groupes.filter((g) => !g.nom).length;
if (sansNom > 0) {
  console.log(`  ! ${sansNom} poste(s) sans nom dans OpenStreetMap — affichés « Péage » sans précision`);
}

const geojson = {
  type: 'FeatureCollection',
  features: groupes.map((g, i) => ({
    type: 'Feature',
    id: `peage_${i}`,
    properties: {
      nom: g.nom ?? 'Péage',
      operateur: g.operateur,
      barrieresOsm: g.noeuds.length,
      osmIds: g.noeuds.map((n) => n.id),
    },
    geometry: { type: 'Point', coordinates: g.centre },
  })),
};

mkdirSync(dirname(SORTIE), { recursive: true });
writeFileSync(SORTIE, JSON.stringify(geojson));
console.log(`Écrit : ${SORTIE} (${groupes.length} péages)\n`);
