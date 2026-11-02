import assert from 'node:assert/strict';
import test from 'node:test';
import { masqueTerritoire, noms, pointMilieu, regrouper } from './index-recherche.mjs';

test('noms : affichage latin, arabe à part, variantes cherchables', () => {
  assert.deepEqual(noms({ name: 'الرباط', 'name:fr': 'Rabat', 'name:en': 'Rabat' }), { fr: 'Rabat', ar: 'الرباط', autres: '' });
  assert.deepEqual(noms({ name: 'Tanger', 'name:ar': 'طنجة', 'name:en': 'Tangier' }), { fr: 'Tanger', ar: 'طنجة', autres: 'Tangier' });
  assert.deepEqual(noms({ name: 'مسجد النور' }), { fr: 'مسجد النور', ar: '', autres: '' });
  assert.deepEqual(noms({ ref: 'A7' }), { fr: 'A7', ar: '', autres: '' });
});

test('point au milieu d’une rue et longueur', () => {
  const { point, longueur } = pointMilieu([[0, 0], [0, 0.001], [0, 0.002], [0, 0.003]]);
  assert.deepEqual(point, [0, 0.002]);
  assert.ok(Math.abs(longueur - 333.6) < 1);
});

test('fusion des doublons proches de même nom, pas des homonymes lointains', () => {
  const elements = [
    { nom: 'Agdal', lon: -6.85, lat: 33.99, n: 1 },
    { nom: 'Agdal', lon: -6.851, lat: 33.991, n: 2 },  // ≈ 140 m : le même quartier de Rabat
    { nom: 'Agdal', lon: -5.0, lat: 34.03, n: 10 },    // Fès : un autre Agdal
    { nom: 'Souissi', lon: -6.851, lat: 33.991, n: 100 },
  ];
  const groupes = regrouper(elements, { cle: (e) => e.nom, rayon: 1000, fusionner: (g, e) => { g.n += e.n; } });
  assert.equal(groupes.length, 3);
  assert.equal(groupes.find((g) => g.nom === 'Agdal' && g.lon < -6).n, 3);
  assert.equal(groupes.find((g) => g.nom === 'Agdal' && g.lon > -6).n, 10);
});

test('masque du territoire : dedans, littoral rogné, dehors', () => {
  const carre = { features: [{ geometry: { type: 'Polygon', coordinates: [[[-8, 30], [-6, 30], [-6, 32], [-8, 32], [-8, 30]]] } }] };
  const dedans = masqueTerritoire(carre, { pas: 0.02, marge: 2 });
  assert.equal(dedans(-7, 31), true);
  assert.equal(dedans(-5.98, 31), true);   // à 2 km du bord : marge littorale
  assert.equal(dedans(-5.5, 31), false);   // à 50 km
  assert.equal(dedans(-12, 28), false);
});
