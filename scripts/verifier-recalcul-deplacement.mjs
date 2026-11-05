/**
 * RECALCUL DES CONFLITS APRÈS DÉPLACEMENT D'UN BARRAGE — `actualiserApresOperation`
 * (serveur/suiviConflits.mjs), sur le vrai dépôt, avec des distances exactes
 * (sans graphe routier : la distance est alors celle à vol d'oiseau).
 *
 * Seuil 20 km :
 *   19 km → actif · 19,5 km → actif · 20 km → résolu · 20,5 km → aucun conflit ;
 *   le déplacement réévalue toutes les paires du barrage déplacé (un nouveau
 *   voisin trop proche devient un conflit), jamais les conflits des autres ;
 *   l'assignation et l'historique sont conservés.
 *
 *   npm run check:recalcul-deplacement
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const RAYON = 6371.0088;
/** Latitude à `km` au nord de 30°N, sur le même méridien (distance exacte). */
const latA = 30;
const latNord = (km) => latA + (km / RAYON) * (180 / Math.PI);

const barrage = (id, lat, lng = -8) => ({ id, nom: `Barrage ${id}`, type: 'barrage_fixe', lat, lng, reg: 'Agadir', factionId: 'F1', statutBarrage: 'approuve' });
const BARRAGES = new Map();
const poser = (b) => BARRAGES.set(b.id, b);
const depotBarrages = { parId: (id) => BARRAGES.get(id) ?? null, tous: () => [...BARRAGES.values()] };
const ADMIN = { matricule: 'ADM', rang: 'admin', unite: 'admin', nom: 'Super Admin' };
const ctx = {
  depotBarrages,
  depotNotifications: { publier: (n) => n, publierConflit: () => {} },
  comptes: { tous: () => [{ matricule: 'REG-AGADIR', rang: 'reg', unite: 'Agadir' }] },
};

const depot = creerDepotSuiviConflits(join(mkdtempSync(join(tmpdir(), 'gr-recalcul-')), 's.json'));
const deplacer = (id, lat, lng = -8) => {
  BARRAGES.set(id, { ...BARRAGES.get(id), lat, lng });
  return depot.actualiserApresOperation({ barrageId: id, action: 'deplacer', graphe: null, depotBarrages, seuilKm: 20 });
};
const conflitDe = (a, b) => depot.tous().find((c) => c.paireCle === [a, b].sort().join('|'));
const actif = (c) => c && c.etat !== 'CLOSED' && !c.resolutionPhysique;

/* A ↔ B à 19 km, conflit d'optimisation (seuil 20) assigné à Agadir. */
poser(barrage('A', latA));
poser(barrage('B', latNord(19)));
/* D ↔ E : un conflit sans rapport, à 5 km, loin de A et B. */
poser(barrage('D', 34, -2));
poser(barrage('E', 34 + (5 / RAYON) * (180 / Math.PI), -2));
for (const [a, b, km] of [['A', 'B', 19], ['D', 'E', 5]]) {
  depot.assignerConflit({
    conflitId: 'C-01', session: ADMIN, matricules: ['REG-AGADIR'], etatAttendu: 'NEW',
    conflitData: { id: 'C-01', barrageAId: a, barrageBId: b, distanceKm: km, seuilKm: 20 }, ...ctx,
  });
}
const histoDE = conflitDe('D', 'E').historique.length;

test('19 km → le conflit reste actif', () => {
  deplacer('B', latNord(19));
  assert.ok(actif(conflitDe('A', 'B')));
});

test('19,5 km → le conflit reste actif', () => {
  deplacer('B', latNord(19.5));
  const c = conflitDe('A', 'B');
  assert.ok(actif(c));
  assert.equal(c.seuilKm, 20, 'le seuil du conflit reste le sien');
  assert.ok(Math.abs(c.distanceKm - 19.5) < 0.05, `distance mise à jour (${c.distanceKm})`);
});

test('20 km → le conflit est résolu (assignation et historique conservés)', () => {
  deplacer('B', latNord(20.0001));
  const c = conflitDe('A', 'B');
  assert.ok(c.resolutionPhysique, 'résolu physiquement');
  assert.equal(c.etat, 'ASSIGNED_REGION', 'l’état du workflow ne bouge pas (cycle existant)');
  assert.equal(c.assignation.regions[0].unite, 'Agadir');
  assert.ok(c.historique.some((h) => h.action === 'resolution_physique'));
});

test('20,5 km → aucun conflit actif, aucun nouveau conflit', () => {
  const avant = depot.tous().length;
  deplacer('B', latNord(20.5));
  assert.equal(depot.tous().length, avant, 'pas de doublon');
  assert.ok(!actif(conflitDe('A', 'B')));
});

test('le déplacement réévalue TOUTES les paires du barrage : un nouveau voisin proche devient un conflit', () => {
  poser(barrage('C', latNord(40)));
  deplacer('B', latNord(30)); // B à 10 km de C, 30 km de A
  const bc = conflitDe('B', 'C');
  assert.ok(bc && bc.etat === 'NEW', 'nouveau conflit B ↔ C');
  assert.equal(bc.seuilKm, 20);
  assert.ok(!actif(conflitDe('A', 'B')));
});

test('aucun conflit sans rapport n’est modifié', () => {
  const de = conflitDe('D', 'E');
  assert.ok(actif(de));
  assert.equal(de.historique.length, histoDE);
});

test('déplacement annulé : rien n’est réévalué (pas d’appel), rien ne change', () => {
  const instantane = JSON.stringify(depot.tous());
  /* L'annulation n'envoie rien au serveur : le dépôt reste identique. */
  assert.equal(JSON.stringify(depot.tous()), instantane);
});

test('le conflit garde SON seuil (20 km) même si le serveur analyse au sien (40 km)', () => {
  /* Un conflit F ↔ G de l'optimisation (seuil 20) ; G est déplacé à 25 km, et
     la réévaluation tourne avec le seuil par défaut du serveur (40 km). */
  poser(barrage('F', 32, -5));
  poser(barrage('G', 32 + (15 / RAYON) * (180 / Math.PI), -5));
  depot.assignerConflit({
    conflitId: 'C-02', session: ADMIN, matricules: ['REG-AGADIR'], etatAttendu: 'NEW',
    conflitData: { id: 'C-02', barrageAId: 'F', barrageBId: 'G', distanceKm: 15, seuilKm: 20 }, ...ctx,
  });
  BARRAGES.set('G', { ...BARRAGES.get('G'), lat: 32 + (25 / RAYON) * (180 / Math.PI) });
  depot.actualiserApresOperation({ barrageId: 'G', action: 'deplacer', graphe: null, depotBarrages, seuilKm: 40 });
  const c = conflitDe('F', 'G');
  assert.ok(c.resolutionPhysique, '25 km ≥ 20 km : résolu, quel que soit le seuil du serveur');
  assert.equal(c.seuilKm, 20);
});

test('bilan de la réévaluation : restant, nouveau, résolu, poste à déplacer, position valide', () => {
  poser(barrage('H', 28, -11));
  poser({ ...barrage('BFI-I', 28 + (19 / RAYON) * (180 / Math.PI), -11), intouchable: true, type: 'barrage_vip' });
  depot.assignerConflit({
    conflitId: 'C-03', session: ADMIN, matricules: ['REG-AGADIR'], etatAttendu: 'NEW',
    conflitData: { id: 'C-03', barrageAId: 'H', barrageBId: 'BFI-I', distanceKm: 19, seuilKm: 20 }, ...ctx,
  });
  /* Le BFI ne bouge pas : c'est H qui doit être déplacé. H avance de 0,5 km : reste à 18,5 km. */
  BARRAGES.set('H', { ...BARRAGES.get('H'), lat: 28 + (0.5 / RAYON) * (180 / Math.PI) });
  let b = depot.actualiserApresOperation({ barrageId: 'H', action: 'deplacer', graphe: null, depotBarrages, seuilKm: 20 }).reevaluation;
  assert.equal(b.valide, false);
  assert.equal(b.restants.length, 1);
  assert.equal(b.restants[0].autreId, 'BFI-I');
  assert.ok(Math.abs(b.restants[0].distanceKm - 18.5) < 0.05);
  assert.equal(b.restants[0].aDeplacerId, 'H', 'jamais l’intouchable');
  /* H recule à 22 km du BFI, mais tombe à 5 km d'un nouveau voisin J. */
  poser(barrage('J', 28 - (8 / RAYON) * (180 / Math.PI), -11));
  BARRAGES.set('H', { ...BARRAGES.get('H'), lat: 28 - (3 / RAYON) * (180 / Math.PI) });
  b = depot.actualiserApresOperation({ barrageId: 'H', action: 'deplacer', graphe: null, depotBarrages, seuilKm: 20 }).reevaluation;
  assert.equal(b.resolus.length, 1, 'H ↔ BFI-I résolu');
  assert.equal(b.nouveaux.length, 1, 'H ↔ J nouveau');
  assert.equal(b.nouveaux[0].autreId, 'J');
  assert.equal(b.valide, false);
  /* J est déplacé loin : la réévaluation repart de J, et tout est conforme. */
  BARRAGES.set('J', { ...BARRAGES.get('J'), lat: 28 - (40 / RAYON) * (180 / Math.PI) });
  b = depot.actualiserApresOperation({ barrageId: 'J', action: 'deplacer', graphe: null, depotBarrages, seuilKm: 20 }).reevaluation;
  assert.equal(b.resolus.length, 1);
  assert.equal(b.valide, true, 'position valide');
});

test('position demandée (en attente de validation) : évaluée sans rien écrire, même bilan', () => {
  poser(barrage('K', 26, -13));
  poser(barrage('L', 26 + (12 / RAYON) * (180 / Math.PI), -13));
  depot.assignerConflit({
    conflitId: 'C-04', session: ADMIN, matricules: ['REG-AGADIR'], etatAttendu: 'NEW',
    conflitData: { id: 'C-04', barrageAId: 'K', barrageBId: 'L', distanceKm: 12, seuilKm: 20 }, ...ctx,
  });
  const avant = JSON.stringify(depot.tous());
  const latK = BARRAGES.get('K').lat;
  /* K demandé 3 km plus au sud : 15 km de L → restant ; 15 km plus au sud : 27 km → résolu. */
  const proche = depot.evaluerPosition({ barrageId: 'K', lng: -13, lat: 26 - (3 / RAYON) * (180 / Math.PI), graphe: null, depotBarrages, seuilKm: 20 });
  assert.equal(proche.simulation, true);
  assert.equal(proche.valide, false);
  assert.equal(proche.restants[0].autreId, 'L');
  const loin = depot.evaluerPosition({ barrageId: 'K', lng: -13, lat: 26 - (15 / RAYON) * (180 / Math.PI), graphe: null, depotBarrages, seuilKm: 20 });
  assert.equal(loin.valide, true);
  assert.equal(loin.resolus[0].autreId, 'L');
  assert.equal(JSON.stringify(depot.tous()), avant, 'rien n’est écrit');
  assert.equal(BARRAGES.get('K').lat, latK, 'la position officielle ne bouge pas');
});
