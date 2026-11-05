/**
 * LES DEUX CHAUSSÉES D'UNE ROUTE À DEUX VOIES — `chausseesOpposees`
 * (src/routage.js), sur un petit graphe synthétique :
 *   - deux arêtes à sens unique, parallèles et opposées → choix Aller / Retour ;
 *   - une route à double sens → aucun choix ;
 *   - un sens unique sans voie opposée → aucun choix ;
 *   - « Aller » est la chaussée qui circule vers le nord ou l'est.
 *
 *   npm run check:chaussees
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerGraphe, accrocher, chausseesOpposees } from '../src/routage.js';

/* Arête : [a, b, mètres, classe, ref, sens, vitesse] — sens 1 = de a vers b. */
const graphe = chargerGraphe({
  sommets: [
    [-7.0, 33.0], [-6.99, 33.0], // chaussée nord, ouest → est
    [-6.99, 33.0001], [-7.0, 33.0001], // chaussée sud…, est → ouest (11 m plus au nord)
    [-7.0, 33.2], [-6.99, 33.2], // route à double sens
    [-7.0, 33.4], [-6.99, 33.4], // sens unique isolé
  ],
  aretes: [
    [0, 1, 930, 0, 0, 1, 120],
    [2, 3, 930, 0, 0, 1, 120],
    [4, 5, 930, 1, 1, 0, 80],
    [6, 7, 930, 4, -1, 1, 50],
  ],
  classes: ['autoroute', 'nationale', 'regionale', 'provinciale', 'locale'],
  refs: ['A1', 'RN1'],
  vitesses: [120, 80, 50],
});

test('deux chaussées opposées : Aller et Retour, chacun sur sa voie', () => {
  const acc = accrocher(graphe, -6.995, 33.00004, 1);
  const r = chausseesOpposees(graphe, acc);
  assert.ok(r, 'deux chaussées détectées');
  assert.ok(r.aller.cap > 45 && r.aller.cap < 135, `Aller vers l’est (cap ${r.aller.cap.toFixed(0)}°)`);
  assert.ok(r.retour.cap > 225 && r.retour.cap < 315, `Retour vers l’ouest (cap ${r.retour.cap.toFixed(0)}°)`);
  assert.notEqual(r.aller.arete, r.retour.arete);
  assert.ok(r.aller.trace.length >= 2 && r.retour.trace.length >= 2, 'un tracé par chaussée');
  /* Cliquer sur l'autre chaussée donne les mêmes sens. */
  const r2 = chausseesOpposees(graphe, accrocher(graphe, -6.995, 33.0001, 1));
  assert.equal(r2.aller.arete, r.aller.arete);
});

test('route à double sens ou sens unique isolé : pas de choix', () => {
  assert.equal(chausseesOpposees(graphe, accrocher(graphe, -6.995, 33.2, 1)), null);
  assert.equal(chausseesOpposees(graphe, accrocher(graphe, -6.995, 33.4, 1)), null);
});
