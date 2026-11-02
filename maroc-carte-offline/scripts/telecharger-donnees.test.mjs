import assert from 'node:assert/strict';
import test from 'node:test';
import { limitesInterieures, pointEtiquette } from './telecharger-donnees.mjs';

const carre = (x, y, nom) => ({
  type: 'Feature',
  properties: { shapeName: nom },
  geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] },
});

test('seule la limite commune à deux régions est conservée, pas le contour extérieur', () => {
  // Deux carrés côte à côte : la seule limite intérieure est x = 1, de y = 0 à y = 1.
  const resultat = limitesInterieures({ type: 'FeatureCollection', features: [carre(0, 0, 'A'), carre(1, 0, 'B')] });
  assert.equal(resultat.features.length, 1);
  const ligne = resultat.features[0].geometry.coordinates;
  assert.deepEqual(ligne.map(([x]) => x), [1, 1]);
  assert.deepEqual(ligne.map(([, y]) => y).sort(), [0, 1]);
});

test('aucun segment commun n’est perdu autour d’une jonction de quatre régions', () => {
  // Grille 2 × 2 : les limites intérieures forment une croix de 4 segments unitaires.
  const regions = [carre(0, 0, 'A'), carre(1, 0, 'B'), carre(0, 1, 'C'), carre(1, 1, 'D')];
  const resultat = limitesInterieures({ type: 'FeatureCollection', features: regions });
  const segments = resultat.features.reduce((n, f) => n + f.geometry.coordinates.length - 1, 0);
  assert.equal(segments, 4);
  assert.ok(resultat.features.every((f) => f.geometry.type === 'LineString'));
});

test('le point d’étiquette tombe à l’intérieur, même pour une région concave', () => {
  assert.deepEqual(pointEtiquette(carre(0, 0).geometry), [0.5, 0.5]);
  // Un « U » : son centroïde tombe dans le creux, hors de la forme.
  const u = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
  const [x, y] = pointEtiquette(u);
  const dansLeCreux = x > 1 && x < 2 && y > 1;
  assert.equal(dansLeCreux, false);
  assert.ok(x >= 0 && x <= 3 && y >= 0 && y <= 3);
});
