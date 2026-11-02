#!/usr/bin/env node
/**
 * Contour du territoire national -> public/layers/territoire.geojson
 *
 *   node scripts/build-territoire.mjs        (accès internet, une seule fois)
 *
 * Sert à deux choses dans l'application :
 *   - le VOILE permanent posé sur tout ce qui n'est pas le territoire : la carte
 *     ne présente alors que la zone de responsabilité, les pays voisins passant
 *     à l'arrière-plan sans disparaître ;
 *   - le liseré de frontière, qui cadre la lecture.
 *
 * Source : OpenStreetMap via Nominatim, qui renvoie directement un polygone
 * (contrairement à Overpass, dont les relations demandent d'être recousues
 * membre par membre). Le contour obtenu couvre l'ensemble du territoire, des
 * provinces du Nord à celles du Sud.
 *
 * Ce contour est un FOND DE CARTE, pas une référence : il ne sert qu'à
 * l'habillage et n'entre dans aucun calcul (les contrôles de périmètre se font
 * sur les circonscriptions, voir serveur/geo.mjs).
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as turf from '@turf/turf';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(ROOT, 'public/layers');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

/** Requête Nominatim : `q` désigne le territoire, `polygon_geojson` la forme. */
const RECHERCHE = arg('territoire', 'Morocco');

/** Tolérance de simplification, en degrés (~1 km) : c'est de l'habillage. */
const TOLERANCE = Number(arg('tolerance', '0.008'));

console.log(`\nContour du territoire — « ${RECHERCHE} »\n`);

const url = new URL('https://nominatim.openstreetmap.org/search');
url.searchParams.set('q', RECHERCHE);
url.searchParams.set('format', 'json');
url.searchParams.set('polygon_geojson', '1');
url.searchParams.set('limit', '1');

const reponse = await fetch(url, {
  // Nominatim exige un agent identifiable ; sans lui, la requête est refusée.
  headers: { 'User-Agent': 'carte-tactique-gendarmerie-royale/1.0' },
});

if (!reponse.ok) {
  console.error(`Nominatim a répondu HTTP ${reponse.status}.\n`);
  process.exit(1);
}

const resultats = await reponse.json();
const trouve = resultats[0];

if (!trouve?.geojson) {
  console.error('Aucun contour renvoyé pour cette recherche.\n');
  process.exit(1);
}

const brut = turf.feature(trouve.geojson);
const bbox = turf.bbox(brut);
const km2 = Math.round(turf.area(brut) / 1e6);

console.log(`  source     : OSM ${trouve.osm_type} ${trouve.osm_id}`);
console.log(`  emprise    : lng ${bbox[0].toFixed(2)} → ${bbox[2].toFixed(2)}, ` +
  `lat ${bbox[1].toFixed(2)} → ${bbox[3].toFixed(2)}`);
console.log(`  superficie : ${km2.toLocaleString('fr-FR')} km²`);

/**
 * Contrôle de vraisemblance : un contour qui n'atteindrait pas les provinces
 * du Sud signalerait un résultat Nominatim partiel — mieux vaut le refuser que
 * livrer une carte qui voilerait une partie du territoire.
 */
const reperes = {
  Tanger: [-5.81, 35.76],
  Oujda: [-1.91, 34.68],
  Laâyoune: [-13.2, 27.15],
  Dakhla: [-15.93, 23.68],
  'Bir Gandouz': [-16.5, 21.9],
};

const dehors = Object.entries(reperes).filter(
  ([, p]) => !turf.booleanPointInPolygon(p, brut)
);

if (dehors.length) {
  console.error(
    `\n  ! contour incomplet : ${dehors.map(([n]) => n).join(', ')} hors du polygone.`
  );
  console.error('  Fichier NON écrit — vérifiez la recherche.\n');
  process.exit(1);
}
console.log(`  contrôle   : ${Object.keys(reperes).length} repères tous à l'intérieur`);

/* --- Simplification : le contour ne sert qu'à l'habillage --- */
const simplifie = turf.simplify(brut, { tolerance: TOLERANCE, highQuality: true });

const compter = (g) => JSON.stringify(g).match(/,/g)?.length ?? 0;
console.log(
  `  simplifié  : ${compter(brut.geometry)} → ${compter(simplifie.geometry)} sommets ` +
    `(tolérance ${TOLERANCE}°)`
);

mkdirSync(SORTIE, { recursive: true });
const chemin = join(SORTIE, 'territoire.geojson');

writeFileSync(
  chemin,
  JSON.stringify({
    type: 'FeatureCollection',
    meta: {
      objet: 'contour du territoire national (habillage)',
      source: `OpenStreetMap / Nominatim — ${trouve.osm_type} ${trouve.osm_id}`,
      recherche: RECHERCHE,
      superficieKm2: km2,
      genere: new Date().toISOString(),
    },
    features: [
      { type: 'Feature', properties: { nom: trouve.name ?? RECHERCHE }, geometry: simplifie.geometry },
    ],
  })
);

console.log(
  `\n  -> public/layers/territoire.geojson (${(statSync(chemin).size / 1024).toFixed(0)} ko)\n`
);
