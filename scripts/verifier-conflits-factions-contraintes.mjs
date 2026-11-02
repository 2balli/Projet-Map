/**
 * ÉPREUVE AUTOMATISÉE : RESPECT STRICT DES FACTIONS, VISIBILITÉ DES CONFLITS,
 * ET PRÉSERVATION DES CONTRAINTES D'ASSIGNATION & DÉPLACEMENT.
 *
 * Exécuté avec : node --test scripts/verifier-conflits-factions-contraintes.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerGraphe } from '../serveur/routage.mjs';
import { listerConflitsDistance, analyserOptimisationDistance, SEUIL_DISTANCE_AUTO_KM } from '../serveur/optimisationDistance.mjs';
import { distancesPlusProche } from '../serveur/distances.mjs';
import { conflitsParFaction } from '../serveur/conflitsFaction.mjs';

const KM_PAR_DEG = 111.32;
const lng = (km) => km / KM_PAR_DEG;

function routeTest(longueurKm = 200) {
  const pas = 0.5;
  const sommets = Array.from({ length: Math.round(longueurKm / pas) + 1 }, (_, i) => [lng(i * pas), 0]);
  const aretes = sommets.slice(1).map((_, i) => [i, i + 1, Math.round(pas * 1000), 0, 0, 0, 60]);
  return chargerGraphe({ classes: ['nationale'], vitesses: [60], refs: ['N1'], sommets, aretes });
}

const creerBarrage = (id, km, extra = {}) => ({
  id,
  type: 'barrage_fixe',
  nom: id,
  lng: lng(km),
  lat: 0,
  route: 'N1',
  bt: 'BT-1',
  cie: 'CIE-1',
  reg: 'REG-1',
  factionId: 'f1',
  factions: ['f1'],
  accidentCount: 0,
  exceptionnel: false,
  missionId: null,
  eclairage: 'oui',
  statutBarrage: 'approuve',
  ...extra,
});

test('1. Deux barrages de la MÊME faction sous le seuil (ex: 10 km < 20 km) rapportent un conflit', () => {
  const g = routeTest();
  const b1 = creerBarrage('B1', 10, { factionId: 'f1', factions: ['f1'] });
  const b2 = creerBarrage('B2', 15, { factionId: 'f1', factions: ['f1'] }); // écart 5 km < 20 km

  const conflits = listerConflitsDistance([b1, b2], g, { seuilKm: 20 });
  assert.equal(conflits.length, 1, 'Un conflit doit être détecté entre deux barrages de même faction');
  assert.equal(conflits[0].a, 'B1');
  assert.equal(conflits[0].b, 'B2');
  assert.ok(conflits[0].km < 20, 'La distance mesurée doit être inférieure au seuil');
  assert.ok(Math.abs(conflits[0].km - 5) < 0.5);
});

test('2. Deux barrages de FACTIONS DIFFÉRENTES sous le seuil ne rapportent AUCUN conflit', () => {
  const g = routeTest();
  const b1 = creerBarrage('B1_F1', 10, { factionId: 'f1', factions: ['f1'] });
  const b2 = creerBarrage('B2_F2', 15, { factionId: 'f2', factions: ['f2'] }); // écart 5 km, factions différentes

  const conflits = listerConflitsDistance([b1, b2], g, { seuilKm: 20 });
  assert.equal(conflits.length, 0, 'Aucun conflit ne doit être rapporté entre des barrages de factions différentes');

  // Vérification dans conflitsParFaction
  const factionsDe = (b) => b.factions || [b.factionId];
  const repFaction = conflitsParFaction([b1, b2], g, { seuilKm: 20, factionsDe });
  assert.equal(repFaction.conflits.length, 0, 'conflitsParFaction ne doit détecter aucun conflit entre factions différentes');

  // Vérification dans distancesPlusProche
  const proches = distancesPlusProche([b1, b2], g, 20);
  assert.equal(proches.get('B1_F1'), null, 'distancesPlusProche ne doit pas apparier des postes de factions différentes');
  assert.equal(proches.get('B2_F2'), null, 'distancesPlusProche ne doit pas apparier des postes de factions différentes');
});

test('3. Un barrage Intouchable (permanent) est en conflit avec un poste sous le seuil quelle que soit sa faction', () => {
  const g = routeTest();
  const bIntou = creerBarrage('BINTOU', 10, { protection: 'intouchable', intouchable: true, factionId: 'f1' });
  const bF2 = creerBarrage('B_F2', 15, { factionId: 'f2', factions: ['f2'] }); // écart 5 km

  const conflits = listerConflitsDistance([bIntou, bF2], g, { seuilKm: 20 });
  assert.equal(conflits.length, 1, 'Un barrage intouchable est permanent et contraint toutes les factions');
});

test('4. L’optimisation de toutes les factions traite chaque faction indépendamment', () => {
  const g = routeTest();
  // Faction 1 : deux postes en conflit (10 et 15 km)
  const f1_a = creerBarrage('F1_A', 10, { factionId: 'f1', factions: ['f1'] });
  const f1_b = creerBarrage('F1_B', 15, { factionId: 'f1', factions: ['f1'] });
  
  // Faction 2 : deux postes espacés sans conflit (50 et 100 km)
  const f2_a = creerBarrage('F2_A', 50, { factionId: 'f2', factions: ['f2'] });
  const f2_b = creerBarrage('F2_B', 100, { factionId: 'f2', factions: ['f2'] });

  const resF1 = analyserOptimisationDistance([f1_a, f1_b], g, { seuilKm: 20 });
  const resF2 = analyserOptimisationDistance([f2_a, f2_b], g, { seuilKm: 20 });

  assert.equal(resF1.conflitsInitiaux.length, 1, 'F1 doit avoir 1 conflit initial');
  assert.equal(resF2.conflitsInitiaux.length, 0, 'F2 ne doit avoir aucun conflit');

  // Si on passe la liste mixte à analyserOptimisationDistance, partagentFaction empêche les conflits croisés F1/F2
  const mixte = [f1_a, f1_b, f2_a, f2_b];
  const resMixte = analyserOptimisationDistance(mixte, g, { seuilKm: 20 });
  assert.equal(resMixte.conflitsInitiaux.length, 1, 'Seul le conflit interne à F1 doit être détecté, aucun conflit croisé');
  assert.equal(resMixte.conflitsInitiaux[0].a, 'F1_A');
  assert.equal(resMixte.conflitsInitiaux[0].b, 'F1_B');
});

test('5. Préservation des contraintes et seuils personnalisés (ex: 30 km ou 5 km)', () => {
  const g = routeTest();
  const p1 = creerBarrage('P1', 10, { factionId: 'f1', factions: ['f1'] });
  const p2 = creerBarrage('P2', 18, { factionId: 'f1', factions: ['f1'] }); // écart de 8 km

  // Seuil strict de 5 km : distance de 8 km est conforme (pas de conflit)
  const resSeuil5 = listerConflitsDistance([p1, p2], g, { seuilKm: 5 });
  assert.equal(resSeuil5.length, 0, 'Sous un seuil configuré de 5 km, 8 km est sans conflit');

  // Seuil étendu de 30 km : distance de 8 km viole le seuil (conflit détecté)
  const resSeuil30 = listerConflitsDistance([p1, p2], g, { seuilKm: 30 });
  assert.equal(resSeuil30.length, 1, 'Sous un seuil configuré de 30 km, 8 km est en conflit');
  assert.ok(resSeuil30[0].km < 30);
});

test('6. Recalcul lors d’un déplacement : détection du maintien de conflit ou résolution', () => {
  const g = routeTest();
  const fixe = creerBarrage('FIXE', 20, { factionId: 'f1', factions: ['f1'] });
  
  // Position déplacée 1 (km 25 -> écart 5 km < 20 km) -> toujours en conflit
  const deplaceProche = creerBarrage('MOV_PROCHE', 25, { factionId: 'f1', factions: ['f1'] });
  const conflitsProche = listerConflitsDistance([fixe, deplaceProche], g, { seuilKm: 20 });
  assert.equal(conflitsProche.length, 1, 'Le conflit doit subsister si la nouvelle position est toujours sous le seuil');

  // Position déplacée 2 (km 70 -> écart 50 km >= 20 km) -> conflit résolu
  const deplaceLoin = creerBarrage('MOV_LOIN', 70, { factionId: 'f1', factions: ['f1'] });
  const conflitsLoin = listerConflitsDistance([fixe, deplaceLoin], g, { seuilKm: 20 });
  assert.equal(conflitsLoin.length, 0, 'Le conflit est résolu si la nouvelle position respecte le seuil');
});
