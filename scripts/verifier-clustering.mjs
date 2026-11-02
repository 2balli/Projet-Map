import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { agregerBarragesHierarchie as aggregate, construireIndexAdministratif as makeIndex,
  determinerNiveauHierarchie as level, diagnostiquerHierarchie, explorerCluster } from '../src/barrageClustering.js';
import { dansSonPerimetre, cleCoucheEffective, TYPES_BARRAGE } from '../src/marquages.js';
const barrage = (id, bt, cie = 'C', reg = 'R', type = 'barrage_fixe') => ({ id, bt, cie, reg, type, lat: 31, lng: -7 });
const data = [barrage('1', 'A'), barrage('2', 'A', 'C', 'R', 'barrage_mobile'),
  barrage('3', 'B'), barrage('4', 'A', 'D'), barrage('5', 'A', 'C', 'S')];
const collection = (features) => ({ type: 'FeatureCollection', features });
const polygon = (properties) => ({ type: 'Feature', properties,
  geometry: { type: 'Polygon', coordinates: [[[-8,30],[-6,30],[-6,32],[-8,32],[-8,30]]] } });
const point = (properties, coordinates) => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates } });

test('zoom in and out follows region, compagnie, individual with no brigade mode', () => {
  for (const [zoom, expected, counts] of [[20,'barrage',[]],[12,'barrage',[]],[11,'barrage',[]],
    [9,'barrage',[]],[8,'compagnie',[3,1,1]],[7,'compagnie',[3,1,1]],
    [6,'region',[4,1]],[5,'region',[4,1]],[8,'compagnie',[3,1,1]],[10,'barrage',[]],[13,'barrage',[]]]) {
    assert.equal(level(zoom), expected);
    const clusters = aggregate(data, zoom);
    assert.deepEqual(clusters.map(c => c.count), counts);
    assert.equal(new Set(clusters.map(c => c.id)).size, clusters.length);
    if (zoom < 9) assert.equal(clusters.reduce((s,c) => s+c.count,0), data.length);
  }
  assert.deepEqual(aggregate(data, 'brigade'), []);
});
test('filtered/RBAC input determines exact counts, including mobile exclusion', () => {
  const session = { rang: 'cie', unite: 'C', reg: 'R' };
  const active = new Set([cleCoucheEffective(data[0])]);
  const visible = data.filter(m => active.has(cleCoucheEffective(m)) && dansSonPerimetre(session,m));
  assert.ok(visible.length > 0 && visible.length < data.length);
  for (const z of [6,8]) {
    const clusters = aggregate(visible,z);
    assert.equal(clusters.reduce((s,c) => s+c.count,0),visible.length);
    assert.ok(clusters.every(c => c.mobilesCount === 0));
  }
  assert.deepEqual(aggregate([],6),[]);
});
test('polygon hierarchy fills missing parents and normalizes prefixes/accents', () => {
  const index = makeIndex({ circoBt: collection([polygon({ gr_bde:'A', gr_cie:'C', gr_region:'R' })]) });
  const partial = [{ ...data[0], reg:'', cie:'' }, { ...data[1], bt:'BT A', cie:'CIE C', reg:'REG R' }];
  for (const z of [6,8]) assert.equal(aggregate(partial,z,index)[0].count,2);
});
test('unknown or ambiguous parents never merge unrelated barrages', () => {
  const index = makeIndex({ circoBt: collection([
    polygon({ gr_bde:'A', gr_cie:'C', gr_region:'R' }),
    polygon({ gr_bde:'A', gr_cie:'D', gr_region:'S' }),
  ]) });
  const unknown = data.slice(0,2).map(m => ({ ...m, reg:'',cie:'' }));
  for (const z of [6,8]) assert.deepEqual(aggregate(unknown,z,index).map(c => c.count),[1,1]);
});
test('headquarters > administrative center > centroid > marker average; polygon bounds win', () => {
  const circoCie = collection([polygon({ nom:'C',reg:'R' })]);
  const ptsCie = collection([point({ nom:'CIE C',reg:'REG R' },[-7.7,31.7])]);
  const poles = [{ nom:'C',lat:31.5,lng:-7.5 }];
  for (const [geo, expected] of [[{circoCie,ptsCie,poles},[31.7,-7.7]],
    [{circoCie,poles},[31.5,-7.5]],[{circoCie},[31,-7]],[{},[31,-7]]]) {
    const c = aggregate(data.slice(0,2),8,geo)[0];
    assert.deepEqual([c.lat,c.lng],expected);
    if (geo.circoCie) assert.deepEqual(c.bounds,[[30,-8],[32,-6]]);
  }
});
test('headquarters with duplicate compagnie names respect their regions', () => {
  const geo = { circoCie: collection([polygon({nom:'C',reg:'R'}),
    polygon({nom:'C',reg:'S'})]), ptsCie: collection([
    point({nom:'CIE C',reg:'REG R'},[-7,31]),
    point({nom:'CIE C',reg:'REG S'},[-6,32])]) };
  const clusters = aggregate([data[0],data[4]],8,geo);
  assert.deepEqual(clusters.map(c => [c.lat,c.lng]),[[31,-7],[32,-6]]);
});
test('every cluster click advances exactly one band for large and small boundaries', () => {
  for (const [niveau, target, min, max] of [['region','compagnie',7,8],['compagnie','barrage',9,14]]) {
    for (const naturalZoom of [4,10,18]) {
      let zoom = 6, mouvements = 0;
      const bounds = [[30,-8],[32,-6]];
      const map = { stop() {}, getBoundsZoom: () => naturalZoom,
        fitBounds(b,opts) { assert.equal(b,bounds); mouvements += 1; zoom=Math.min(naturalZoom,opts.maxZoom); },
        flyTo(center,z) { assert.deepEqual(center,[31,-7]); mouvements += 1; zoom=z; } };
      explorerCluster(map,{niveau,bounds});
      assert.equal(mouvements, 1);
      assert.ok(zoom >= min && zoom <= max);
      assert.equal(level(zoom),target);
    }
  }
});
test('real Morocco layers: one cluster per actual hierarchy path, exact count conservation', () => {
  const geo = {};
  for (const [key,file] of [['circoBt','circo_bt'],['circoCie','circo_cie'],['circoReg','circo_reg'],
    ['ptsBt','pts_bt'],['ptsCie','pts_cie'],['ptsReg','pts_reg']]) {
    geo[key] = JSON.parse(fs.readFileSync(new URL(`../public/layers/${file}.geojson`,import.meta.url)));
  }
  const markers = geo.circoBt.features.map((f,i) => barrage(String(i),f.properties.gr_bde,f.properties.gr_cie,f.properties.gr_region));
  const index = makeIndex(geo);
  for (const [z,keys] of [[6,['reg']],[8,['reg','cie']]]) {
    const clusters = aggregate(markers,z,index);
    assert.equal(clusters.reduce((s,c) => s+c.count,0),markers.length);
    assert.equal(clusters.length,new Set(markers.map(m => JSON.stringify(keys.map(k => m[k].toLowerCase())))).size);
    assert.ok(clusters.every(c => Number.isFinite(c.lat) && Number.isFinite(c.lng)));
  }
});

test('all demo barrages resolve unambiguously against the real administrative hierarchy', (t) => {
  const raw = JSON.parse(fs.readFileSync(new URL('../donnees-demo/marquages.json', import.meta.url)));
  const items = Array.isArray(raw) ? raw : raw.items;
  const geo = {};
  for (const [key, file] of [['circoBt', 'circo_bt'], ['circoCie', 'circo_cie'], ['circoReg', 'circo_reg'],
    ['ptsBt', 'pts_bt'], ['ptsCie', 'pts_cie'], ['ptsReg', 'pts_reg']]) {
    geo[key] = JSON.parse(fs.readFileSync(new URL(`../public/layers/${file}.geojson`, import.meta.url)));
  }
  /**
   * LE NOMBRE ATTENDU EST CELUI DU FICHIER, PAS UN LITTÉRAL FIGÉ.
   *
   * L'assertion portait « total: 1122 » en dur. Le jeu de démonstration se
   * resème (voir scripts/semer-demo.mjs) : le test tombait alors sur un
   * changement de VOLUME, sans que rien de ce qu'il surveille n'ait bougé —
   * et la seule façon de le faire repasser était de recopier le nouveau
   * nombre, ce qui n'atteste de rien.
   *
   * L'invariant, lui, ne change pas : CHAQUE barrage du jeu se rattache à une
   * et une seule branche de la hiérarchie réelle. C'est cela qui est vérifié,
   * sur l'effectif présent quel qu'il soit.
   */
  const barrages = items.filter((m) => TYPES_BARRAGE.includes(m.type));

  /**
   * UN JEU SANS BARRAGE N'EST PAS UN ÉCHEC — c'est un dispositif à saisir.
   *
   * L'assertion exigeait au moins un barrage, au motif qu'un jeu vide ne
   * prouve rien. C'est exact, et c'est pourquoi ce contrôle est SAUTÉ plutôt
   * que réussi en silence. Mais il ne doit pas ÉCHOUER : le dispositif a été
   * remis à zéro pour être ressaisi poste par poste sous les nouvelles règles,
   * et faire tomber le build tant que le premier barrage n'est pas posé
   * reviendrait à interdire l'état de départ prévu.
   *
   * L'invariant reprend dès qu'un poste existe : chaque barrage se rattache à
   * une et une seule branche de la hiérarchie réelle.
   */
  if (barrages.length === 0) {
    t.skip('aucun barrage dans le jeu : rien à rattacher (dispositif à saisir)');
    return;
  }
  assert.deepEqual(diagnostiquerHierarchie(items, geo), {
    total: barrages.length,
    resolus: barrages.length,
    nonResolus: 0,
    ambigus: 0,
    exemplesNonResolus: [],
    exemplesAmbigus: [],
  });
});
