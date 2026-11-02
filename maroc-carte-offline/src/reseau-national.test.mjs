import assert from 'node:assert/strict';
import test from 'node:test';
import { versGlobal, versLonLat } from './itineraire.js';
import { distanceMetres } from './mesure.js';
import { construireReseauNational, cheminNational, deserialiser, entrees, preparer, serialiser } from './reseau-national.js';

// Coordonnées globales au zoom 9 autour de Casablanca ; 1 unité ≈ 16 m.
const Z = 9;
const [X0, Y0] = versGlobal([-7.6, 33.5], Z);
const p = (dx, dy) => [X0 + dx, Y0 + dy];
const ll = (dx, dy) => versLonLat(p(dx, dy), Z);
const route = (...points) => ({ points: points.map(([dx, dy]) => p(dx, dy)), niveau: 0 });
const metres = (u) => distanceMetres(ll(0, 0), ll(u, 0));

test('un trou de traversée d’agglomération est comblé, majoré du détour', () => {
  // Deux tronçons d'une nationale séparés de 60 unités (≈ 1 km, la ville manquante).
  const r = construireReseauNational([route([0, 0], [1000, 0]), route([1060, 0], [2000, 0])]);
  assert.ok(r.raccords >= 1);
  const res = cheminNational(r, ll(0, 0), ll(2000, 0));
  assert.ok(res, 'itinéraire trouvé');
  const attendu = metres(1000) + metres(60) * 1.3 + metres(940);
  assert.ok(Math.abs(res.distance - attendu) / attendu < 0.01, `${res.distance} ≉ ${attendu}`);
});

test('un raccord ne franchit jamais une frontière internationale', () => {
  const frontiere = [[p(1030, -500), p(1030, 500)]];
  const r = construireReseauNational([route([0, 0], [1000, 0]), route([1060, 0], [2000, 0])], frontiere);
  assert.equal(r.raccords, 0);
  assert.equal(cheminNational(r, ll(0, 0), ll(2000, 0)), null);
});

test('au-delà de 3 km, pas de raccord', () => {
  const r = construireReseauNational([route([0, 0], [1000, 0]), route([1300, 0], [2000, 0])]); // ≈ 5 km
  assert.equal(r.raccords, 0);
});

test('une boucle absurde est court-circuitée (même morceau de réseau)', () => {
  // La boucle part du bout de A et revient s'arrêter à 60 unités (≈ 1 km) de lui, après ~280 km.
  const boucle = route([0, 0], [0, -6000], [3000, -6000], [3000, 0], [60, 0]);
  const r = construireReseauNational([route([-1000, 0], [0, 0]), boucle]);
  const res = cheminNational(r, ll(-1000, 0), ll(60, 0));
  assert.ok(res.distance < metres(1000 + 60 * 1.3 + 10), `${(res.distance / 1000).toFixed(1)} km`);
});

test('le départ peut entrer sur le réseau par une autre route que la plus proche', () => {
  const r = construireReseauNational([
    route([0, 10], [30, 10]),       // impasse isolée, à ≈ 160 m du départ
    route([-500, 60], [5000, 60]),  // nationale, à ≈ 1 km
  ], [], { raccordMax: 100 });      // aucun raccord : on teste les entrées multiples
  assert.ok(entrees(r, ll(0, 0)).length >= 2, 'plusieurs entrées candidates');
  const res = cheminNational(r, ll(0, 0), ll(5000, 60));
  assert.ok(res, 'itinéraire par la nationale');
  // La distance renvoyée part de l'entrée sur la nationale : l'accès est calculé à part, par les rues.
  assert.ok(Math.abs(res.distance - metres(5000)) / metres(5000) < 0.02, `${res.distance}`);
});

test('autoroutes en priorité sur le réseau national', () => {
  // Nationale directe (80 km/h) contre autoroute parallèle (120 km/h) à 30 unités (≈ 500 m), reliée aux deux bouts.
  const nationale = { ...route([0, 0], [3000, 0]), vitesse: 80 };
  const autoroute = { ...route([0, 0], [100, 30], [2900, 30], [3000, 0]), vitesse: 120 };
  const r = construireReseauNational([nationale, autoroute]);
  const viaAutoroute = cheminNational(r, ll(0, 0), ll(3000, 0), { priorite: 'autoroute' });
  const plusCourt = cheminNational(r, ll(0, 0), ll(3000, 0), { priorite: 'court' });
  assert.ok(viaAutoroute.distance > plusCourt.distance, 'le détour par l’autoroute est plus long…');
  assert.ok(Math.abs(plusCourt.distance - metres(3000)) / metres(3000) < 0.01, '…et le plus court suit la nationale');
  assert.ok(viaAutoroute.chemin.some(([, lat]) => Math.abs(lat - ll(0, 30)[1]) < 1e-5), 'tracé sur l’autoroute');
});

test('sérialisation binaire aller-retour', () => {
  const r = construireReseauNational([route([0, 0], [100, 0], [100, 100]), route([100, 0], [200, 0])]);
  const octets = serialiser(r);
  const relu = deserialiser(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength));
  for (const cle of ['lon', 'lat', 'debut', 'cibles', 'poids', 'vitesses']) assert.deepEqual([...relu[cle]], [...r[cle]], cle);
  assert.throws(() => deserialiser(new ArrayBuffer(16)), /format inconnu/);
});

test('index spatial : mêmes itinéraires qu’en parcourant tout le réseau, dans les deux priorités', () => {
  // Grille de routes (10 × 10 tronçons) et des départs / arrivées au hasard (graine fixe).
  const routes = [];
  for (let i = 0; i <= 10; i++) {
    routes.push({ ...route([0, i * 300], [3000, i * 300]), vitesse: i % 3 ? 80 : 120 });
    routes.push({ ...route([i * 300, 0], [i * 300, 3000]), vitesse: 60 });
  }
  const r = construireReseauNational(routes);
  const indexe = preparer(r);
  assert.ok(indexe.index && !r.index, 'le réseau d’origine n’est pas modifié');
  let graine = 7;
  const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 40; k++) {
    const [a, b] = [ll(alea() * 3000, alea() * 3000), ll(alea() * 3000, alea() * 3000)];
    for (const priorite of ['autoroute', 'court']) {
      const sans = cheminNational(r, a, b, { priorite });
      const avec = cheminNational(indexe, a, b, { priorite });
      assert.deepEqual(avec, sans, `${k} ${priorite}`);
    }
  }
  // Point à plus de 15 km de toute route : aucun itinéraire, avec ou sans index.
  assert.equal(cheminNational(indexe, ll(0, 0), ll(5000, 5000)), cheminNational(r, ll(0, 0), ll(5000, 5000)));
  assert.equal(cheminNational(indexe, ll(0, 0), versLonLat(p(200_000, 0), Z)), null);
});
