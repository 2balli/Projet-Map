import assert from 'node:assert/strict';
import test from 'node:test';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { adapterCouchesMaroc, construireStyle, REGIONS } from './carte-style.js';

const origine = 'http://localhost:8080';
const couche = (style, id) => style.layers.find((l) => l.id === id);
const garde = (style, id, properties) => {
  const index = style.layers.findIndex((l) => l.id === id);
  return featureFilter(style.layers[index].filter, `layers[${index}].filter`)
    .filter({ zoom: 6 }, { type: 2, properties });
};
const nomDe = (style, iso) => {
  const champ = couche(style, 'regions-nom').layout['text-field'];
  return champ[champ.indexOf(iso) + 1];
};

test('la ligne de séparation au sud est masquée, les autres frontières restent', () => {
  const style = construireStyle({ origine });
  assert.equal(garde(style, 'boundaries_country', { kind: 'country', kind_detail: 2, disputed: true }), false);
  assert.equal(garde(style, 'boundaries_country', { kind: 'country', kind_detail: 2 }), true);
  assert.equal(garde(style, 'boundaries_country', { kind: 'country', kind_detail: 2, disputed: false }), true);
});

test('le libellé « RASD » est masqué, « Maroc » et les voisins restent', () => {
  const style = construireStyle({ origine });
  const pays = (wikidata) => garde(style, 'places_country', { kind: 'country', wikidata });
  assert.equal(pays('Q40362'), false);
  assert.equal(pays('Q1028'), true); // Maroc
  assert.equal(pays('Q1025'), true); // Mauritanie
});

test('les limites régionales OSM cèdent la place aux 12 régions, les provinces restent', () => {
  const style = construireStyle({ origine });
  assert.equal(garde(style, 'boundaries', { kind: 'region', kind_detail: 4 }), false);
  assert.equal(garde(style, 'boundaries', { kind: 'county', kind_detail: 5 }), true);
  assert.equal(garde(style, 'boundaries', { kind: 'county', kind_detail: 6 }), true);
  assert.equal(Object.keys(REGIONS).length, 12);
});

test('les couches non concernées ne sont pas modifiées', () => {
  const entree = [{ id: 'roads_highway', type: 'line', filter: ['==', 'kind', 'highway'] }];
  assert.deepEqual(adapterCouchesMaroc(entree), entree);
});

test('tout est servi localement, aucune adresse externe', () => {
  for (const theme of ['light', 'dark']) for (const langue of ['fr', 'ar']) {
    const style = construireStyle({ origine, theme, langue });
    const adresses = [style.glyphs, style.sprite, ...Object.values(style.sources).map((s) => s.url ?? s.data)];
    for (const adresse of adresses) assert.match(adresse, /^(pmtiles:\/\/)?http:\/\/localhost:8080\//, adresse);
  }
});

test('les noms des régions suivent la langue, le trait passe sous les libellés', () => {
  assert.equal(nomDe(construireStyle({ origine, langue: 'ar' }), 'MA-11'), 'العيون الساقية الحمراء');
  const fr = construireStyle({ origine, langue: 'fr' });
  assert.equal(nomDe(fr, 'MA-03'), 'Fès-Meknès');
  const premierLibelle = fr.layers.findIndex((l) => l.type === 'symbol');
  assert.ok(fr.layers.findIndex((l) => l.id === 'regions-trait') < premierLibelle);
});

test('la case « régions » masque le trait et les noms', () => {
  const style = construireStyle({ origine, regions: false });
  assert.equal(couche(style, 'regions-trait').layout.visibility, 'none');
  assert.equal(couche(style, 'regions-nom').layout.visibility, 'none');
});
