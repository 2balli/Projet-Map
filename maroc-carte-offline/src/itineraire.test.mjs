import assert from 'node:assert/strict';
import test from 'node:test';
import { cheminDansGraphe, construireGraphe, versGlobal, versLonLat, vitesseRoute } from './itineraire.js';

const voie = (points, niveau = 0) => ({ points, niveau });
const proche = (reel, attendu, tol = 1e-6) => assert.ok(Math.abs(reel - attendu) <= tol, `${reel} ≉ ${attendu}`);

test('projection globale aller-retour', () => {
  for (const p of [[-7.5898, 33.5731], [-15.957, 23.6848], [0, 0]]) {
    const [lon, lat] = versLonLat(versGlobal(p, 15), 15);
    proche(lon, p[0], 1e-9);
    proche(lat, p[1], 1e-9);
  }
});

test('le chemin suit les rues d’une grille, jamais en diagonale', () => {
  // Deux rues horizontales et deux verticales qui se croisent sans sommet commun.
  const g = construireGraphe([
    voie([[0, 0], [100, 0]]), voie([[0, 100], [100, 100]]),
    voie([[10, -10], [10, 110]]), voie([[90, -10], [90, 110]]),
  ]);
  const r = cheminDansGraphe(g, [10, 0], [90, 100]);
  proche(r.distance, 180); // 80 + 100, pas √(80² + 100²) ≈ 128
  assert.ok(r.points.every(([x, y]) => [0, 100, 10, 90].includes(Math.round(y)) || [10, 90].includes(Math.round(x))));
});

test('un pont n’est pas relié à la route qu’il enjambe', () => {
  const route = voie([[0, 50], [200, 50]]);
  const pont = voie([[100, 0], [100, 100]], 1);
  const g = construireGraphe([route, pont]);
  assert.equal(cheminDansGraphe(g, [0, 50], [100, 0]), null);
  // Avec une bretelle au niveau du sol, le chemin passe par elle.
  const bretelle = voie([[150, 50], [150, 0], [100, 0]]);
  const r = cheminDansGraphe(construireGraphe([route, pont, bretelle]), [0, 50], [100, 0]);
  proche(r.distance, 150 + 50 + 50);
});

test('les extrémités d’un pont rejoignent la route, même sans sommet commun', () => {
  // Route coupée par une rivière ; le pont la prolonge, ses bouts à 1 unité des deux tronçons.
  const g = construireGraphe([
    voie([[0, 0], [100, 0]]),
    voie([[101, 0], [199, 0]], 1),
    voie([[200, 0], [300, 0]]),
  ]);
  const r = cheminDansGraphe(g, [0, 0], [300, 0]);
  assert.ok(r, 'le pont relie les deux rives');
  proche(r.distance, 300, 0.01);
});

test('un raccord en T sans sommet commun est relié (simplification des tuiles)', () => {
  const principale = voie([[0, 0], [200, 0]]);
  const laterale = voie([[120, 1], [120, 80]]); // s'arrête à 1 unité de la principale
  const r = cheminDansGraphe(construireGraphe([principale, laterale]), [0, 0], [120, 80]);
  assert.ok(r, 'raccord détecté');
  proche(r.distance, 120 + 79, 0.01);
});

test('le plus court chemin préfère le détour réel le plus court', () => {
  const g = construireGraphe([
    voie([[0, 0], [100, 0]]),                           // départ → carrefour
    voie([[100, 0], [100, 300], [200, 300]]),           // long détour
    voie([[100, 0], [150, 50], [200, 50], [200, 300]]), // plus court
  ]);
  const r = cheminDansGraphe(g, [0, 0], [200, 300]);
  proche(r.distance, 100 + Math.hypot(50, 50) + 50 + 250);
});

test('autoroutes en priorité : un détour par l’autoroute bat la route directe plus lente', () => {
  // Directe : 1000 à 60 km/h (60 s). Par l'autoroute : 100 + 1000 + 100 = 1200, dont 1000 à 120 km/h (≈ 42 s).
  const directe = { points: [[0, 0], [1000, 0]], vitesse: 60 };
  const bretelles = [{ points: [[0, 0], [0, 100]], vitesse: 60 }, { points: [[1000, 100], [1000, 0]], vitesse: 60 }];
  const autoroute = { points: [[0, 100], [1000, 100]], vitesse: 120 };
  const g = construireGraphe([directe, ...bretelles, autoroute]);
  proche(cheminDansGraphe(g, [0, 0], [1000, 0], { priorite: 'autoroute' }).distance, 1200);
  proche(cheminDansGraphe(g, [0, 0], [1000, 0], { priorite: 'court' }).distance, 1000);
  // Un trop grand détour (5000, ≈ 270 s) n'en vaut pas la peine, même par l'autoroute.
  const loin = construireGraphe([directe,
    { points: [[0, 0], [0, 2000]], vitesse: 60 }, { points: [[1000, 2000], [1000, 0]], vitesse: 60 },
    { points: [[0, 2000], [1000, 2000]], vitesse: 120 }]);
  proche(cheminDansGraphe(loin, [0, 0], [1000, 0], { priorite: 'autoroute' }).distance, 1000);
});

test('vitesses de référence par catégorie OSM', () => {
  assert.equal(vitesseRoute({ kind: 'highway', kind_detail: 'motorway' }), 120);
  assert.equal(vitesseRoute({ kind: 'major_road', kind_detail: 'primary' }), 80);
  assert.equal(vitesseRoute({ kind: 'minor_road', kind_detail: 'residential' }), 30);
  assert.equal(vitesseRoute({ kind: 'highway' }), 120);
  assert.equal(vitesseRoute({}), 30);
});

test('départ et arrivée sur le même tronçon', () => {
  const r = cheminDansGraphe(construireGraphe([voie([[0, 0], [100, 0]])]), [20, 5], [70, -5]);
  proche(r.distance, 50);
});

test('aucune route : pas d’itinéraire', () => {
  assert.equal(cheminDansGraphe(construireGraphe([]), [0, 0], [1, 1]), null);
  const deuxIlots = construireGraphe([voie([[0, 0], [10, 0]]), voie([[100, 100], [110, 100]])]);
  assert.equal(cheminDansGraphe(deuxIlots, [0, 0], [110, 100]), null);
});
