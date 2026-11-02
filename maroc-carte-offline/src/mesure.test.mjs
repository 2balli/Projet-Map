import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distanceMetres, longueurMetres, pointLePlusProche, ecartMinimal, formaterDistance, nomRoute, lignesDe,
  pointMilieuChemin,
} from './mesure.js';

// Sur la sphère du modèle, 1 m vers le nord = 1/111 195 degré de latitude.
const M_LAT = 1 / 111_195;
const CASA = [-7.5898, 33.5731];
const auNord = ([lon, lat], m) => [lon, lat + m * M_LAT];
const aLEst = ([lon, lat], m) => [lon + (m * M_LAT) / Math.cos((lat * Math.PI) / 180), lat];
const proche = (reel, attendu, tolerance) => assert.ok(Math.abs(reel - attendu) <= tolerance, `${reel} ≉ ${attendu}`);

test('distance géodésique : un degré de méridien, puis 100 m en ville', () => {
  proche(distanceMetres([0, 0], [0, 1]), 111_195, 1);
  proche(distanceMetres(CASA, auNord(CASA, 100)), 100, 0.01);
  proche(distanceMetres(CASA, aLEst(CASA, 100)), 100, 0.05);
  proche(longueurMetres([CASA, auNord(CASA, 30), aLEst(auNord(CASA, 30), 40)]), 70, 0.05);
  assert.equal(longueurMetres([CASA]), 0);
});

test('le point est accroché à la route la plus proche, perpendiculairement', () => {
  // Route est-ouest de 200 m ; un clic 12 m au nord de son milieu.
  const route = [aLEst(CASA, -100), aLEst(CASA, 100)];
  const r = pointLePlusProche(auNord(CASA, 12), [route]);
  proche(r.distance, 12, 0.02);
  proche(distanceMetres(r.point, CASA), 0, 0.02);
  // Au-delà de l'extrémité, on s'accroche au bout de la route.
  const bout = pointLePlusProche(aLEst(CASA, 130), [route]);
  proche(bout.distance, 30, 0.05);
  assert.equal(pointLePlusProche(CASA, []), null);
});

test('écart entre deux routes parallèles : la plus courte perpendiculaire', () => {
  const routeA = [[aLEst(CASA, -200), aLEst(CASA, 200)]];
  const routeB = [[auNord(aLEst(CASA, -150), 35), auNord(aLEst(CASA, 150), 35)]];
  const r = ecartMinimal(routeA, routeB);
  assert.equal(r.croisement, false);
  proche(r.distance, 35, 0.05);
  proche(distanceMetres(r.de, r.a), r.distance, 1e-9);
});

test('écart entre deux routes en biais : depuis l’extrémité la plus proche', () => {
  // A : segment nord-sud de 100 m ; B part à 20 m à l'est de son milieu, vers l'est.
  const routeA = [[CASA, auNord(CASA, 100)]];
  const routeB = [[aLEst(auNord(CASA, 50), 20), aLEst(auNord(CASA, 50), 300)]];
  proche(ecartMinimal(routeA, routeB).distance, 20, 0.05);
});

test('deux routes qui se croisent : écart nul, au point de croisement', () => {
  const routeA = [[aLEst(CASA, -50), aLEst(CASA, 50)]];
  const routeB = [[auNord(CASA, -50), auNord(CASA, 50)]];
  const r = ecartMinimal(routeA, routeB);
  assert.equal(r.croisement, true);
  assert.equal(r.distance, 0);
  proche(distanceMetres(r.de, CASA), 0, 0.01);
});

test('routes en plusieurs morceaux (découpage des tuiles)', () => {
  const routeA = [[aLEst(CASA, -300), aLEst(CASA, -100)], [aLEst(CASA, 100), aLEst(CASA, 300)]];
  const routeB = [[auNord(aLEst(CASA, 200), 8), auNord(aLEst(CASA, 260), 8)]];
  proche(ecartMinimal(routeA, routeB).distance, 8, 0.02);
  assert.equal(ecartMinimal([], routeB), null);
  assert.equal(ecartMinimal(routeA, [[CASA]]), null);
});

test('format des distances en français et en arabe', () => {
  assert.equal(formaterDistance(8.43), '8,4 m');
  assert.equal(formaterDistance(245.2), '245 m');
  assert.equal(formaterDistance(1234), '1,23 km');
  assert.equal(formaterDistance(23_456), '23,5 km');
  assert.match(formaterDistance(245.2, 'ar'), /م$/);
  assert.match(formaterDistance(1234, 'ar'), /كم$/);
});

test('étiquette à mi-longueur du tracé, pas au milieu des extrémités', () => {
  // Un « L » : 100 m vers l'est puis 300 m vers le nord → milieu à 100 m au nord du coude.
  const coude = aLEst(CASA, 100);
  const milieu = pointMilieuChemin([CASA, coude, auNord(coude, 300)]);
  proche(distanceMetres(milieu, auNord(coude, 100)), 0, 0.05);
  assert.deepEqual(pointMilieuChemin([CASA]), CASA);
});

test('nom de route : langue, nom local, puis numéro', () => {
  assert.equal(nomRoute({ 'name:fr': 'Boulevard Zerktouni', name: 'شارع الزرقطوني' }, 'fr'), 'Boulevard Zerktouni');
  assert.equal(nomRoute({ 'name:fr': 'Boulevard Zerktouni', name: 'شارع الزرقطوني' }, 'ar'), 'شارع الزرقطوني');
  assert.equal(nomRoute({ ref: 'RN1' }), 'RN1');
  assert.equal(nomRoute({}), null);
  assert.deepEqual(lignesDe({ type: 'Point', coordinates: [0, 0] }), []);
  assert.equal(lignesDe({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }).length, 2);
});
