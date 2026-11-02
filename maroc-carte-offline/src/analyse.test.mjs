import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bandeDe, celluleDe, grilleMercator, indexerAretes, rasteriserMasque, statistiques, tempsDepuis, tempsSurGrille,
} from './couverture.js';
import { RANG_PRINCIPAL, cap, direction, sortiesDuCercle } from './bouclage.js';
import { coutOrdre, ordreOptimal } from './tournee.js';
import { circonscriptionEn, contient, indexerCircos } from './competence.js';
import { construireGraphe, coutsDepuis } from './itineraire.js';
import { formaterDuree } from './mesure.js';

const proche = (reel, attendu, tol) => assert.ok(Math.abs(reel - attendu) <= tol, `${reel} ≉ ${attendu}`);
const carre = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });

/** Réseau national minimal (format CSR de reseau-national.js) : une ligne de nœuds à la même latitude. */
function reseauLigne(points, vitesse = 72) {
  const n = points.length;
  const voisins = points.map(() => []);
  for (let i = 1; i < n; i++) {
    const d = Math.abs(points[i][0] - points[i - 1][0]) * 111_195 * Math.cos((points[i][1] * Math.PI) / 180);
    voisins[i - 1].push([i, d]);
    voisins[i].push([i - 1, d]);
  }
  const debut = new Uint32Array(n + 1);
  voisins.forEach((v, i) => { debut[i + 1] = debut[i] + v.length; });
  const cibles = new Uint32Array(debut[n]);
  const poids = new Float32Array(debut[n]);
  voisins.forEach((v, i) => v.forEach(([j, w], k) => { cibles[debut[i] + k] = j; poids[debut[i] + k] = w; }));
  return {
    lon: Float32Array.from(points, (p) => p[0]), lat: Float32Array.from(points, (p) => p[1]),
    debut, cibles, poids, vitesses: new Uint8Array(debut[n]).fill(vitesse),
  };
}

// ── Couverture ─────────────────────────────────────────────────────────────

test('temps par le réseau : chaque nœud retient la source la plus rapide', () => {
  const reseau = reseauLigne([[-8, 32], [-7.9, 32], [-7.8, 32], [-7.7, 32]]);
  const { temps, proprio } = tempsDepuis(reseau, indexerAretes(reseau), [[-8, 32], [-7.7, 32]]);
  assert.deepEqual([...proprio], [0, 0, 1, 1]);
  // 0,1° de longitude à 32° N ≈ 9,43 km, à 72 km/h (20 m/s) ≈ 471 s.
  proche(temps[1], 471, 5);
  proche(temps[0], 0, 1);
});

test('temps par le réseau : la limite arrête la propagation', () => {
  const reseau = reseauLigne([[-8, 32], [-7.9, 32], [-7.8, 32], [-7.7, 32]]);
  const { temps } = tempsDepuis(reseau, indexerAretes(reseau), [[-8, 32]], { limite: 600 });
  assert.ok(temps[1] < 600);
  assert.equal(temps[2], Infinity);
});

test('grille Mercator : cellule d’un point, masque d’un polygone', () => {
  const g = grilleMercator([-8, 31, -7, 32], 0.05);
  assert.equal(g.largeur, 20);
  assert.equal(celluleDe(g, [-9, 31.5]), -1);
  const masque = rasteriserMasque(g, [carre(-8, 31, -7.5, 32)]);
  assert.equal(masque[celluleDe(g, [-7.3, 31.5])], 0); // à l'est du polygone
  assert.equal(masque[celluleDe(g, [-7.8, 31.5])], 1);
  proche(masque.reduce((s, v) => s + v, 0) / masque.length, 0.5, 0.06);
});

test('grille : temps reporté le long de la route puis propagé hors réseau, sans sortir du masque', () => {
  const reseau = reseauLigne([[-8, 31.5], [-7.6, 31.5]]);
  const g = grilleMercator([-8.1, 31.2, -7.4, 31.8], 0.02);
  const masque = rasteriserMasque(g, [carre(-8.1, 31.2, -7.5, 31.8)]);
  const noeuds = tempsDepuis(reseau, indexerAretes(reseau), [[-8, 31.5]]);
  const { temps } = tempsSurGrille(reseau, noeuds, g, masque, { sources: [[-8, 31.5]], vitesseHorsRoute: 20 });
  const surRoute = temps[celluleDe(g, [-7.7, 31.5])];
  const aCote = temps[celluleDe(g, [-7.7, 31.65])]; // ≈ 16,7 km au nord de la route, ≈ 50 min à 20 km/h
  assert.ok(Number.isFinite(surRoute));
  assert.ok(aCote > surRoute + 2500, `${aCote} devrait dépasser ${surRoute} d’environ 3000 s`);
  assert.equal(temps[celluleDe(g, [-7.45, 31.5])], Infinity); // hors masque
  const { parts, horsAtteinte } = statistiques(g, temps, masque);
  proche(parts.reduce((s, p) => s + p, 0) + horsAtteinte, 1, 1e-9);
});

test('classes de temps', () => {
  assert.equal(bandeDe(10 * 60), 0);
  assert.equal(bandeDe(15 * 60), 0);
  assert.equal(bandeDe(16 * 60), 1);
  assert.equal(bandeDe(500 * 60), 6);
});

// ── Bouclage ───────────────────────────────────────────────────────────────

test('bouclage : une route qui traverse le cercle donne deux sorties, à l’est et à l’ouest', () => {
  const centre = [-7.6, 33.5];
  const lignes = [{ points: [[-7.8, 33.5], [-7.4, 33.5]], classe: 'primary', ref: 'N1', nom: 'Route N1' }];
  const sorties = sortiesDuCercle(lignes, centre, 5000);
  assert.deepEqual(sorties.map((s) => direction(s.cap)), ['E', 'O']);
  for (const s of sorties) {
    const dx = (s.point[0] - centre[0]) * 111_195 * Math.cos((33.5 * Math.PI) / 180);
    proche(Math.abs(dx), 5000, 5);
  }
});

test('bouclage : chaussées séparées fusionnées, petites voies filtrées', () => {
  const centre = [-7.6, 33.5];
  const lignes = [
    { points: [[-7.6, 33.45], [-7.6, 33.6]], classe: 'motorway', ref: 'A1' },
    { points: [[-7.5995, 33.45], [-7.5995, 33.6]], classe: 'motorway_link', ref: null }, // ≈ 46 m à côté
    { points: [[-7.65, 33.5], [-7.55, 33.5]], classe: 'residential' },
  ];
  const principales = sortiesDuCercle(lignes, centre, 3000, { rangMax: RANG_PRINCIPAL });
  assert.deepEqual(principales.map((s) => [direction(s.cap), s.ref]), [['N', 'A1'], ['S', 'A1']]);
  assert.equal(sortiesDuCercle(lignes, centre, 3000).length, 4);
});

test('cap : nord 0°, est 90°', () => {
  proche(cap([0, 0], [0, 1]), 0, 1e-6);
  proche(cap([0, 0], [1, 0]), 90, 1e-6);
  assert.equal(direction(359), 'N');
  assert.equal(direction(225, 'fr'), 'SO');
});

// ── Tournée ────────────────────────────────────────────────────────────────

test('tournée : ordre exact sur des points alignés, départ fixe', () => {
  // Positions 0, 3, 1, 2 sur une ligne : l'ordre optimal les parcourt dans l'ordre 0 → 1 → 2 → 3.
  const x = [0, 3, 1, 2];
  const m = x.map((a) => x.map((b) => Math.abs(a - b)));
  assert.deepEqual(ordreOptimal(m), { ordre: [0, 2, 3, 1], cout: 3 });
});

test('tournée : boucle et objets { cout }, heuristique au-delà de 12 étapes', () => {
  const x = Array.from({ length: 15 }, (_, i) => (i * 7) % 15);
  const m = x.map((a) => x.map((b) => ({ cout: Math.abs(a - b) })));
  const { ordre, cout } = ordreOptimal(m, { boucle: true });
  assert.equal(ordre[0], 0);
  assert.equal(new Set(ordre).size, 15);
  assert.equal(cout, 28); // aller-retour sur une ligne de 0 à 14
  assert.equal(coutOrdre(m.map((l) => l.map((v) => v.cout)), ordre, true), cout);
});

test('tournée : une étape injoignable donne un coût infini, mais un ordre complet', () => {
  const { ordre, cout } = ordreOptimal([[0, 1, null], [1, 0, null], [null, null, 0]]);
  assert.equal(ordre.length, 3);
  assert.equal(cout, Infinity);
});

// ── Compétence territoriale ────────────────────────────────────────────────

test('compétence : point dans un polygone à trou, puis dans la bonne circonscription', () => {
  const troue = { type: 'Polygon', coordinates: [carre(0, 0, 10, 10).coordinates[0], carre(4, 4, 6, 6).coordinates[0]] };
  assert.equal(contient(troue, [2, 2]), true);
  assert.equal(contient(troue, [5, 5]), false);
  assert.equal(contient({ type: 'MultiPolygon', coordinates: [carre(20, 20, 21, 21).coordinates] }, [20.5, 20.5]), true);
  const circos = indexerCircos({ features: [
    { properties: { id: 'bt-0', nom: 'A' }, geometry: carre(0, 0, 1, 1) },
    { properties: { id: 'bt-1', nom: 'B' }, geometry: carre(1, 0, 2, 1) },
  ] });
  assert.equal(circonscriptionEn(circos, [1.5, 0.5]).nom, 'B');
  assert.equal(circonscriptionEn(circos, [5, 5]), null);
});

// ── Itinéraire : coûts d'un point vers plusieurs ───────────────────────────

test('coûts depuis un point : un parcours, toutes les cibles', () => {
  const g = construireGraphe([{ points: [[0, 0], [100, 0], [100, 100]], vitesse: 36 }]);
  const [a, b, c] = coutsDepuis(g, [0, 0], [[0, 0], [100, 0], [100, 50]]);
  proche(a.distance, 0, 1e-9);
  proche(b.distance, 100, 1e-9);
  proche(c.distance, 150, 1e-9);
  proche(c.secondes, 15, 1e-9); // 150 « mètres » à 10 m/s
});

test('durées affichées', () => {
  assert.equal(formaterDuree(20), '< 1 min');
  assert.equal(formaterDuree(23 * 60), '23 min');
  assert.equal(formaterDuree(85 * 60), '1 h 25');
  assert.equal(formaterDuree(125 * 60), '2 h 05');
});
