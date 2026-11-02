/**
 * ÉPREUVE DU PLACEMENT DES ÉTIQUETTES TERRITORIALES — sur les vraies limites.
 *
 *   npm run check:etiquettes
 *
 * Ce qui est garanti, et vérifié ici aux zooms où les étiquettes existent :
 *   — deux étiquettes visibles ne se chevauchent jamais ;
 *   — chaque ancre tombe dans son entité ;
 *   — l'entité sélectionnée garde toujours son étiquette ;
 *   — le résultat ne dépend que du zoom (même entrée, même sortie).
 *
 * Et le défaut d'origine est constaté : posées aux chefs-lieux, les étiquettes
 * de région se chevauchaient à l'échelle nationale.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  projeter, deprojeter, poleInaccessibilite, pointDansGeometrie, preparerGeometrie,
  dimensionsEtiquette, placerEtiquettes, filigraneRegionsVisible, MARGE_ETIQUETTES,
} from '../src/placementEtiquettes.js';

const lire = (nom) => JSON.parse(fs.readFileSync(new URL(`../public/layers/${nom}.geojson`, import.meta.url)));
const regions = lire('circo_reg').features;
const compagnies = lire('circo_cie').features;
const chefsLieux = lire('pts_reg').features;

const etiquettesDe = (features, niveau, prio = () => 0, extra = {}) =>
  features.map((f) => ({
    id: `${niveau}:${f.properties.nom}`,
    ancre: poleInaccessibilite(f.geometry),
    geometrie: preparerGeometrie(f.geometry),
    priorite: prio(f),
    ...dimensionsEtiquette(niveau, f.properties.nom),
    ...extra,
  }));

const chevauchements = (places) => {
  const boites = places.filter((p) => p.boite).map((p) => [p.id, p.boite]);
  const paires = [];
  for (let i = 0; i < boites.length; i++) {
    for (let j = i + 1; j < boites.length; j++) {
      const [, a] = boites[i];
      const [, b] = boites[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) paires.push([boites[i][0], boites[j][0]]);
    }
  }
  return paires;
};

test('la projection est celle de Leaflet et se réciproque', () => {
  const p = projeter([0, 0], 0);
  assert.equal(p.x, 128);
  assert.ok(Math.abs(p.y - 128) < 1e-9);
  const [lat, lng] = deprojeter(projeter([31.79, -7.09], 7), 7);
  assert.ok(Math.abs(lat - 31.79) < 1e-9 && Math.abs(lng + 7.09) < 1e-9);
});

test('chaque ancre tombe dans son entité (28 régions, 90 compagnies)', () => {
  for (const f of [...regions, ...compagnies]) {
    const ancre = poleInaccessibilite(f.geometry);
    assert.ok(ancre, `pas d'ancre pour ${f.properties.nom}`);
    assert.ok(pointDansGeometrie(ancre, f.geometry), `${f.properties.nom} : ancre hors de l'entité`);
  }
});

test('défaut d’origine : aux chefs-lieux, les étiquettes de région se chevauchaient', () => {
  const brut = chefsLieux.map((f) => {
    const nom = f.properties.unite;
    const { largeur, hauteur } = dimensionsEtiquette('region', nom);
    const c = projeter([f.geometry.coordinates[1], f.geometry.coordinates[0]], 6);
    return { id: nom, boite: { x0: c.x - largeur / 2, x1: c.x + largeur / 2, y0: c.y - hauteur / 2, y1: c.y + hauteur / 2 } };
  });
  const paires = chevauchements(brut);
  assert.ok(paires.length > 0);
  console.log(`  zoom 6, posées aux chefs-lieux : ${paires.length} paire(s) en chevauchement`);
});

for (const zoom of [5, 6]) {
  test(`zoom ${zoom} — régions : aucun chevauchement, aucune étiquette perdue`, () => {
    const etiquettes = etiquettesDe(regions, 'region', (f) => f.properties.population);
    const places = placerEtiquettes(etiquettes, { zoom });
    assert.equal(places.length, regions.length);
    assert.deepEqual(chevauchements(places), []);
    const parMode = Object.groupBy(places, (p) => p.mode);
    const resume = Object.entries(parMode).map(([m, l]) => `${m} ${l.length}`).join(', ');
    console.log(`  zoom ${zoom} : ${resume}`);
    /* Seuils de non-régression, relevés sur les limites réelles. L'axe
       Kénitra–Rabat–Casablanca ne peut pas contenir ses noms à l'échelle
       nationale : ils y sortent avec un trait de rappel, c'est voulu. Au zoom 6
       — la vue d'ouverture — 26 régions sur 28 sont nommées. */
    const dedans = (parMode.ancre?.length ?? 0) + (parMode.decale?.length ?? 0);
    const nommees = places.length - (parMode.replie?.length ?? 0);
    const seuils = zoom >= 6 ? { dedans: 0.6, nommees: 0.9 } : { dedans: 0.25, nommees: 0.7 };
    assert.ok(dedans >= regions.length * seuils.dedans, `seulement ${dedans} étiquettes dans leur région`);
    assert.ok(nommees >= regions.length * seuils.nommees, `seulement ${nommees} régions nommées`);
  });
}

for (const zoom of [7, 8]) {
  test(`zoom ${zoom} — compagnies et filigrane des régions : aucun chevauchement`, () => {
    assert.ok(filigraneRegionsVisible(zoom));
    const cies = etiquettesDe(compagnies, 'compagnie', (f) => 1e9 + (f.properties.population ?? 0));
    const filigranes = etiquettesDe(regions, 'filigrane', (f) => f.properties.population, { renvoi: false, cedeAuxObstacles: false });
    const places = placerEtiquettes([...cies, ...filigranes], { zoom });
    assert.deepEqual(chevauchements(places), []);
    /* Un filigrane ne sort jamais de sa région. */
    assert.ok(places.filter((p) => p.id.startsWith('filigrane:')).every((p) => p.mode !== 'renvoi'));
    const nommees = places.filter((p) => p.id.startsWith('compagnie:') && p.mode !== 'replie').length;
    console.log(`  zoom ${zoom} : ${nommees}/${cies.length} compagnies nommées, `
      + `${places.filter((p) => p.id.startsWith('filigrane:') && p.mode !== 'replie').length}/${regions.length} régions en filigrane`);
  });
}

test('l’entité sélectionnée garde son étiquette, à son ancre', () => {
  for (const cible of ['Rabat', 'Kénitra', 'Khémisset', 'Casablanca']) {
    const etiquettes = etiquettesDe(regions, 'region', (f) => (f.properties.nom === cible ? Infinity : f.properties.population));
    const p = placerEtiquettes(etiquettes, { zoom: 5 }).find((x) => x.id === `region:${cible}`);
    assert.equal(p.mode, 'ancre', `${cible} : ${p.mode}`);
  }
});

test('les obstacles écartent les positions décalées, jamais l’ancre prioritaire', () => {
  const [a] = etiquettesDe(regions.filter((f) => f.properties.nom === 'Marrakech'), 'region');
  const [p] = placerEtiquettes([a], { zoom: 6, obstacles: [{ position: a.ancre, rayon: 12 }] });
  assert.equal(p.mode, 'ancre');
});

test('même zoom, même placement — glisser la carte ne déplace rien', () => {
  const etiquettes = etiquettesDe(regions, 'region', (f) => f.properties.population);
  assert.deepEqual(placerEtiquettes(etiquettes, { zoom: 6 }), placerEtiquettes([...etiquettes].reverse(), { zoom: 6 }).sort(
    (x, y) => etiquettes.findIndex((e) => e.id === x.id) - etiquettes.findIndex((e) => e.id === y.id),
  ));
  assert.ok(MARGE_ETIQUETTES > 0);
});
