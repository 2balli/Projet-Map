/**
 * ÉPREUVE DU TRACÉ PROGRESSIF — l'animation ne trahit jamais la géographie.
 *
 *   npm run check:trace
 *
 * Le tracé partiel est un préfixe de la polyligne d'origine : ses sommets,
 * puis un point SUR le segment en cours ; à la fin, la polyligne exacte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { longueursCumulees, prefixeTrace, prefixesTraces } from '../src/traceProgressive.js';

/* Une route en L : nord, puis est (Rabat → Salé → Kénitra, simplifiée). */
const route = [[34.0, -6.85], [34.05, -6.85], [34.1, -6.85], [34.1, -6.75], [34.1, -6.65]];
const cumul = longueursCumulees(route);

const surSegment = (p, a, b) => {
  const [x, y] = [p[1] - a[1], p[0] - a[0]];
  const [dx, dy] = [b[1] - a[1], b[0] - a[0]];
  const croix = Math.abs(x * dy - y * dx);
  const dans = x * dx + y * dy >= -1e-12 && x * dx + y * dy <= dx * dx + dy * dy + 1e-12;
  return croix < 1e-12 && dans;
};

test('fin d’animation : exactement la polyligne reçue', () => {
  assert.equal(prefixeTrace(route, cumul, 1), route);
  assert.deepEqual(prefixesTraces([route], null), [route]);
});

test('chaque étape est un préfixe : sommets d’origine + un point sur le segment en cours', () => {
  for (let f = 0; f <= 1; f += 0.05) {
    const p = prefixeTrace(route, cumul, f);
    const k = p.length - 1;
    for (let i = 0; i < k; i++) assert.deepEqual(p[i], route[i], `sommet ${i} conservé à f=${f.toFixed(2)}`);
    assert.ok(surSegment(p[k], route[k - 1], route[k] ?? route[k - 1]), `point interpolé sur le segment à f=${f.toFixed(2)}`);
  }
});

test('le tracé avance de façon monotone, sans couper le virage', () => {
  let precedent = 0;
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const p = prefixeTrace(route, cumul, f);
    const long = longueursCumulees(p).at(-1);
    assert.ok(long + 1e-12 >= precedent, 'longueur croissante');
    precedent = long;
  }
  /* Le tronçon nord fait 37,6 % de la longueur (les tronçons est, à cos(34°), pèsent plus) :
     à 30 %, le point est encore sur le tronçon nord — le virage n'est pas coupé. */
  const milieu = prefixeTrace(route, cumul, 0.3).at(-1);
  assert.equal(milieu[1], -6.85);
});

test('lignes multiples : la même fraction pour chacune', () => {
  const [a, b] = prefixesTraces([route, route.slice().reverse()], 0.5);
  assert.ok(a.length >= 2 && b.length >= 2);
});

test('points L.LatLng ({ lat, lng }) — la forme des conflits identifiés : même tracé, même forme', () => {
  /* ConflitsIdentifiesLayer passe le résultat de map.unproject : des objets,
     pas des paires. Ce cas faisait planter la carte (« object is not iterable »). */
  const objets = route.map(([lat, lng]) => ({ lat, lng }));
  const c = longueursCumulees(objets);
  assert.deepEqual(c, cumul);
  const p = prefixeTrace(objets, c, 0.5);
  const attendu = prefixeTrace(route, cumul, 0.5);
  assert.equal(p.length, attendu.length);
  assert.deepEqual(p.at(-1), { lat: attendu.at(-1)[0], lng: attendu.at(-1)[1] });
  assert.equal(prefixeTrace(objets, c, 1), objets, 'à la fin : la polyligne reçue, telle quelle');
  const [l] = prefixesTraces([objets], 0.5);
  assert.deepEqual(l.at(-1), p.at(-1));
});

test('géométrie inattendue : jamais d’exception, tracé laissé tel quel', () => {
  const bizarre = [{ x: 1 }, null, 3];
  assert.deepEqual(prefixesTraces([bizarre], 0.5), [bizarre]);
});

/* ------------------------------------------------------------------ */
/* Dessin lent des routes (animationTrace.js) : mesures pures          */
/* ------------------------------------------------------------------ */
test('animationTrace : longueur réelle, point le long de la route, durée selon la longueur', async () => {
  const { longueurKm, pointLeLong, dureeDessin } = await import('../src/animationTrace.js');
  /* Route en L : sa longueur est la somme de SES segments (plus que la droite). */
  const L1 = longueurKm(route);
  const droite = longueurKm([route[0], route.at(-1)]);
  assert.ok(L1 > droite, 'la route (virage) est plus longue que la ligne droite');
  /* Le point à mi-parcours est SUR la route (ici, au coin ou sur un segment). */
  const m = pointLeLong(route, 0.5);
  const surUnSegment = route.slice(1).some((b, i) => {
    const a = route[i];
    const dans = (v, x, y) => v >= Math.min(x, y) - 1e-9 && v <= Math.max(x, y) + 1e-9;
    return dans(m[0], a[0], b[0]) && dans(m[1], a[1], b[1]) && (a[0] === b[0] ? Math.abs(m[0] - a[0]) < 1e-9 : Math.abs(m[1] - a[1]) < 1e-9);
  });
  assert.ok(surUnSegment, 'le point à mi-parcours est sur la polyligne');
  assert.deepEqual(pointLeLong(route, 0), route[0]);
  assert.deepEqual(pointLeLong(route, 1), route.at(-1));
  /* Durée : ~4–6 s pour une route courante, bornée 3,5–6,5 s, croissante. */
  assert.equal(dureeDessin(0.5), 3.5);
  assert.ok(dureeDessin(10) >= 4 && dureeDessin(10) <= 5);
  assert.ok(dureeDessin(20) > dureeDessin(10) && dureeDessin(20) <= 6);
  assert.equal(dureeDessin(500), 6.5);
});
