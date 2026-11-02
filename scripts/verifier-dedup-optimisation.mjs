#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { statistiquesOptimisation } from '../src/statistiquesOptimisation.js';
import { uniquesParIdentifiant, barragesIntouchablesVisibles } from '../src/optimisationAffichage.js';
import { chargerGraphe } from '../serveur/routage.mjs';
import { analyserParTempsTrajet } from '../serveur/optimisationTrajet.mjs';

const kmParDeg = 111.32;
const lngDe = (km) => km / kmParDeg;
function route(longueurKm) {
  const pas = 0.5;
  const n = Math.round(longueurKm / pas) + 1;
  const sommets = Array.from({ length: n }, (_, i) => [+lngDe(i * pas).toFixed(6), 0]);
  const aretes = Array.from({ length: n - 1 }, (_, i) => [i, i + 1, 500, 0, 0, 0, 60]);
  return chargerGraphe({ classes: ['nationale'], vitesses: [60], refs: ['N1'], sommets, aretes });
}
const poste = (id, km, extra = {}) => ({
  id, type: 'barrage_fixe', nom: id, route: 'N1', lng: +lngDe(km).toFixed(6), lat: 0,
  accidentCount: 0, severite: 'none', activite: 'low', infraction: 'low',
  positionVille: 'none', eclairage: 'oui', statutBarrage: 'approuve',
  decisionOptimisation: 'aucune', exceptionnel: false, missionId: null,
  factionId: 'F1', bt: 'BDE-A', cie: 'CIE-X', reg: 'REG-1', ...extra,
});

test('les vues d’optimisation conservent le BFI consultable mais comptent son ID une fois', () => {
  const bfi = { id: 'BFI-005', type: 'barrage_fixe', intouchable: true, statutBarrage: 'approuve' };
  const occurrences = [
    { id: 'B-001', type: 'barrage_fixe' },
    { id: 'B-002', type: 'barrage_fixe' },
    { id: 'B-003', type: 'barrage_fixe' },
    { id: 'B-004', type: 'barrage_fixe' },
    ...['F1', 'F2', 'F3', 'F4'].map((factionId) => ({ ...bfi, factionId })),
  ];
  assert.equal(uniquesParIdentifiant(occurrences).length, 5);
  assert.equal(barragesIntouchablesVisibles(occurrences).length, 1);
  assert.deepEqual(occurrences.slice(-4).map((b) => b.factionId), ['F1', 'F2', 'F3', 'F4'],
    'la déduplication des compteurs ne modifie pas les occurrences affichées sur la carte');
});

test('statistics count physical IDs once across faction occurrences', () => {
  const rows = [
    ...['B-001', 'B-002', 'B-003', 'B-004'].map((id) => ({ id, protections: [] })),
    ...['F1', 'F2', 'F3', 'F4'].map((factionId) => ({
      id: 'B-005', factionId, intouchable: true, sousLeSeuil: true,
      decision: 'aucune', protections: ['intouchable'],
    })),
  ];
  const result = statistiquesOptimisation({
    parametres: { vip: true }, bilan: { examines: rows.length },
    barrages: rows.map((b) => b.id === 'B-005' ? { ...b, protections: ['vip'] } : b),
  });
  assert.equal(result.examines, 5);
  assert.equal(result.concernes, 1);
});

test('optimization deduplicates IDs and leaves a repeated untouchable protected', () => {
  const bfi = poste('B-005', 10, { protection: 'intouchable', intouchable: true });
  const repeated = ['F1', 'F2', 'F3', 'F4'].map((factionId) => ({ ...bfi, factionId }));
  const normal = poste('B-001', 13, { factionId: 'F1' });
  const result = analyserParTempsTrajet([normal, ...repeated], route(120));
  assert.equal(result.resume.barragesAnalyses, 2);
  assert.equal(Object.values(result.resume.repartitionFactionApres).reduce((sum, n) => sum + n, 0), 2);
  assert.equal(result.propositions.filter((p) => p.id === normal.id).length, 1);
  assert.equal(result.propositions.some((p) => p.id === bfi.id), false);
});
