import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { construireStyle } from './carte-style.js';
import { couchesGendarmerie, echelonAuZoom, ECHELONS, entitesSelection, plagesEchelon } from './gendarmerie-style.js';

const origine = 'http://localhost:8080';

test('le style complet est valide, dans tous les réglages', () => {
  for (const theme of ['light', 'dark']) {
    for (const langue of ['fr', 'ar']) {
      for (const echelon of ECHELONS) {
        const style = construireStyle({ origine, theme, langue, gendarmerie: { echelon, unites: true, infra: true } });
        assert.deepEqual(validateStyleMin(style).map((e) => e.message), [], `${theme} ${langue} ${echelon}`);
      }
    }
  }
});

test('sans données importées, aucune couche ni source Gendarmerie', () => {
  const style = construireStyle({ origine });
  assert.ok(!style.layers.some((l) => l.id.startsWith('gr-')));
  assert.ok(!Object.keys(style.sources).some((s) => s.startsWith('gr-')));
});

test('un seul découpage à la fois selon le zoom', () => {
  assert.equal(echelonAuZoom('auto', 5), 'reg');
  assert.equal(echelonAuZoom('auto', 7), 'cie');
  assert.equal(echelonAuZoom('auto', 8.9), 'cie');
  assert.equal(echelonAuZoom('auto', 9), 'bt');
  assert.equal(echelonAuZoom('bt', 4), 'bt');
  assert.equal(echelonAuZoom('aucun', 10), null);
  for (let z = 0; z < 22; z += 0.25) {
    const visibles = Object.values(plagesEchelon('auto')).filter((p) => z >= p[0] && z < p[1]);
    assert.equal(visibles.length, 1, `zoom ${z}`);
  }
});

test('contours sous les libellés du fond, chefs-lieux au-dessus de tout', () => {
  const style = construireStyle({ origine, gendarmerie: {} });
  const ids = style.layers.map((l) => l.id);
  const premierLibelleFond = style.layers.findIndex((l) => l.type === 'symbol' && !l.id.startsWith('gr-') && !l.id.startsWith('regions'));
  assert.ok(ids.indexOf('gr-bt-trait') < premierLibelleFond);
  assert.ok(ids.indexOf('gr-selection-voile') < premierLibelleFond);
  assert.equal(ids.at(-1), 'gr-unite-nom-reg');
});

test('réglages : infrastructures masquées, unités affichées par défaut', () => {
  const { dessus } = couchesGendarmerie();
  const vis = (id) => dessus.find((l) => l.id === id).layout.visibility;
  assert.equal(vis('gr-infra-point'), 'none');
  assert.equal(vis('gr-unite-bt'), 'visible');
  const { sousLibelles } = couchesGendarmerie({ echelon: 'aucun' });
  assert.ok(sousLibelles.filter((l) => /^gr-(reg|cie|bt)-/.test(l.id)).every((l) => l.layout.visibility === 'none'));
});

test('sélection : le voile troue le monde à l’endroit du contour, dans le sens inverse', () => {
  const aire = (a) => a.reduce((s, p, i) => s + (a[(i + 1) % a.length][0] - p[0]) * (a[(i + 1) % a.length][1] + p[1]), 0);
  const carre = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  for (const anneau of [carre, [...carre].reverse()]) {
    const { features: [voile, contour] } = entitesSelection({ type: 'Polygon', coordinates: [anneau] });
    const [monde, trou] = voile.geometry.coordinates;
    assert.equal(Math.sign(aire(monde)), -Math.sign(aire(trou)));
    assert.equal(contour.properties.role, 'contour');
  }
  const multi = entitesSelection({ type: 'MultiPolygon', coordinates: [[carre], [carre.map(([x, y]) => [x + 5, y])]] });
  assert.equal(multi.features[0].geometry.coordinates.length, 3);
});
