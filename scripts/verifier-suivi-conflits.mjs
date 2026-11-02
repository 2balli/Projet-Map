/**
 * TESTS DU SUIVI DES CONFLITS — détection automatique, cloisonnement et statuts.
 *
 *   node scripts/verifier-suivi-conflits.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const tempDir = mkdtempSync(join(tmpdir(), 'gr-conflits-'));
const fichier = join(tempDir, 'suivi-conflits.json');
const depotConflits = creerDepotSuiviConflits(fichier);

const SESSIONS = {
  admin: { matricule: 'ADM-01', rang: 'admin', unite: 'admin', nom: 'Super Admin' },
  reg1: { matricule: 'REG-01', rang: 'reg', unite: 'Rabat', nom: 'CMND Région Rabat' },
  reg2: { matricule: 'REG-02', rang: 'reg', unite: 'Fès', nom: 'CMND Région Fès' },
  cie1: { matricule: 'CIE-01', rang: 'cie', unite: 'Salé', nom: 'CMND Cie Salé' },
  cie2: { matricule: 'CIE-02', rang: 'cie', unite: 'Meknès', nom: 'CMND Cie Meknès' },
};

/* Barrages fictifs mais réalistes */
const B1 = {
  id: 'B_RABAT_1',
  nom: 'Barrage Pont Hassan II',
  type: 'barrage_fixe',
  route: 'RN1',
  lng: -6.83,
  lat: 34.02,
  reg: 'Rabat',
  cie: 'Salé',
  bt: 'BT Hassan',
  factionId: 'F1',
};

const B2_PROCHE = {
  id: 'B_RABAT_2',
  nom: 'Barrage Entrée Salé',
  type: 'barrage_fixe',
  route: 'RN1',
  lng: -6.81,
  lat: 34.04,
  reg: 'Rabat',
  cie: 'Salé',
  bt: 'BT Salé',
  factionId: 'F1',
};

const B2_ELOIGNE = {
  ...B2_PROCHE,
  lng: -6.2,
  lat: 34.5,
};

const mockDepotBarrages = (liste) => {
  const map = new Map(liste.map((b) => [b.id, b]));
  return {
    tous: () => Array.from(map.values()),
    parId: (id) => map.get(id) ?? null,
  };
};

const mockInstructions = (liste = []) => ({
  tous: () => liste,
});

const mockDemandes = (liste = []) => ({
  tous: () => liste,
  ouvertesPour: (id) => liste.filter((d) => d.barrageId === id && d.statutWorkflow !== 'applique'),
});

const notificationsEmises = [];
const mockNotifications = {
  publier: (n) => {
    notificationsEmises.push(n);
    return n;
  },
};

test('1. Détection automatique et création de conflit lors d’une assignation', () => {
  const depotBarrages = mockDepotBarrages([B1, B2_PROCHE]);
  const instructions = [
    { id: 'inst_1', barrageId: B1.id, action: 'assignation', statut: 'ouverte', destinataire: { rang: 'reg', unite: 'Rabat' } },
  ];

  const result = depotConflits.actualiserApresOperation({
    barrageId: B1.id,
    session: SESSIONS.admin,
    action: 'assignation',
    details: { consigne: 'Vérifier espacement' },
    graphe: null,
    depotBarrages,
    depotInstructions: mockInstructions(instructions),
    depotDemandes: mockDemandes([]),
    depotNotifications: mockNotifications,
    seuilKm: 40,
  });

  assert.equal(result.length, 1, 'Un conflit doit être détecté');
  const c = result[0];
  assert.equal(c.statut, 'a_traiter', 'Le statut doit être a_traiter car assigné');
  assert.equal(c.barrageAId, B1.id);
  assert.equal(c.barrageBId, B2_PROCHE.id);
  assert.ok(c.distanceKm < 40, 'Distance sous le seuil');
  assert.equal(c.historique.length, 1, 'Une entrée d’historique');
  assert.equal(notificationsEmises.length, 1, 'Une notification a été générée');
});

test('2. Cloisonnement hiérarchique et territorial des conflits', () => {
  const conflitsAdmin = depotConflits.visiblesPour(SESSIONS.admin);
  const conflitsReg1 = depotConflits.visiblesPour(SESSIONS.reg1);
  const conflitsReg2 = depotConflits.visiblesPour(SESSIONS.reg2);
  const conflitsCie1 = depotConflits.visiblesPour(SESSIONS.cie1);
  const conflitsCie2 = depotConflits.visiblesPour(SESSIONS.cie2);

  assert.equal(conflitsAdmin.length, 1, 'Super Admin voit le conflit');
  assert.equal(conflitsReg1.length, 1, 'CMD_REGION Rabat voit le conflit de sa région');
  assert.equal(conflitsReg2.length, 0, 'CMD_REGION Fès ne voit PAS le conflit de Rabat');
  assert.equal(conflitsCie1.length, 1, 'CMD_CIE Salé voit le conflit de sa compagnie');
  assert.equal(conflitsCie2.length, 0, 'CMD_CIE Meknès ne voit PAS le conflit');
});

test('3. Évolution du workflow : transmission et passage en cours de traitement', () => {
  const depotBarrages = mockDepotBarrages([B1, B2_PROCHE]);
  const instructions = [
    {
      id: 'inst_2',
      barrageId: B1.id,
      action: 'assignation',
      statut: 'ouverte',
      destinataire: { rang: 'cie', unite: 'Salé' },
    },
  ];

  const result = depotConflits.actualiserApresOperation({
    barrageId: B1.id,
    session: SESSIONS.reg1,
    action: 'transmission',
    details: { cie: 'Salé' },
    graphe: null,
    depotBarrages,
    depotInstructions: mockInstructions(instructions),
    depotDemandes: mockDemandes([]),
    depotNotifications: mockNotifications,
    seuilKm: 40,
  });

  const c = depotConflits.tous()[0];
  assert.equal(c.statut, 'en_cours', 'Transmis au CMND Cie : statut en_cours');
  assert.equal(c.historique.length, 2, 'Historique enrichi avec l’étape de transmission');
});

test('4. Résolution du conflit après déplacement à distance réglementaire', () => {
  /* B1 déplacé loin (distance > 40 km) */
  const depotBarrages = mockDepotBarrages([B1, B2_ELOIGNE]);

  const result = depotConflits.actualiserApresOperation({
    barrageId: B1.id,
    session: SESSIONS.reg1,
    action: 'deplacer',
    details: { motif: 'Déplacement conforme' },
    graphe: null,
    depotBarrages,
    depotInstructions: mockInstructions([]),
    depotDemandes: mockDemandes([]),
    depotNotifications: mockNotifications,
    seuilKm: 40,
  });

  const c = depotConflits.tous()[0];
  assert.equal(c.statut, 'resolu', 'Le statut doit être résolu');
  assert.ok(c.resoluLe, 'Horodatage de résolution présent');
  assert.equal(c.historique.length, 3, 'Historique conservé avec étape de résolution');
  assert.equal(c.historique[2].statut, 'resolu');
});

test('5. Déduplication des notifications : un conflit inchangé ne renvoie pas de notification en double', () => {
  const avant = notificationsEmises.length;
  const depotBarrages = mockDepotBarrages([B1, B2_ELOIGNE]);

  /* Ré-exécution de la même vérification sans changement */
  depotConflits.actualiserApresOperation({
    barrageId: B1.id,
    session: SESSIONS.reg1,
    action: 'deplacer',
    details: {},
    graphe: null,
    depotBarrages,
    depotInstructions: mockInstructions([]),
    depotDemandes: mockDemandes([]),
    depotNotifications: mockNotifications,
    seuilKm: 40,
  });

  assert.equal(notificationsEmises.length, avant, 'Aucune notification en double émise');
});

test('6. Réouverture avec conservation d’historique si le conflit réapparaît', () => {
  /* B2 ramené proche */
  const depotBarrages = mockDepotBarrages([B1, B2_PROCHE]);

  depotConflits.actualiserApresOperation({
    barrageId: B1.id,
    session: SESSIONS.admin,
    action: 'modifier',
    details: { motif: 'Rapprochement' },
    graphe: null,
    depotBarrages,
    depotInstructions: mockInstructions([]),
    depotDemandes: mockDemandes([]),
    depotNotifications: mockNotifications,
    seuilKm: 40,
  });

  const c = depotConflits.tous()[0];
  assert.notEqual(c.statut, 'resolu', 'Le conflit a été réouvert');
  assert.equal(c.historique.length, 4, 'Historique complet conservé');
  assert.equal(c.historique[3].action, 'reouverture');
});

test('7. Assignation conjointe d’un conflit inter-régions aux deux Commandants de Région', () => {
  const instructionsCreees = [];
  const mockDepotInstructions = {
    creer: (inst) => {
      instructionsCreees.push(inst);
      return inst;
    },
  };
  const notificationsInter = [];
  const mockDepotNotifs = {
    publier: (n) => {
      notificationsInter.push(n);
      return n;
    },
  };

  const bRabat = { ...B1, reg: 'Rabat' };
  const bFes = { ...B2_PROCHE, id: 'B_FES_1', nom: 'Barrage Entrée Fès', reg: 'Fès' };

  const comptesMock = {
    tous: () => [
      { matricule: 'REG-01', nom: 'CMND Région Rabat', unite: 'Rabat', rang: 'reg' },
      { matricule: 'REG-02', nom: 'CMND Région Fès', unite: 'Fès', rang: 'reg' },
    ],
  };

  const res = depotConflits.assignerConflit({
    conflitId: 'C-INTER-01',
    session: SESSIONS.admin,
    matricules: ['REG-01', 'REG-02'],
    consigne: 'Coordination Rabat & Fès sur axe RN1',
    conflitData: {
      numero: 'C-INTER-01',
      barrageAId: bRabat.id,
      barrageBId: bFes.id,
      a: bRabat,
      b: bFes,
      distanceKm: 15,
      seuilKm: 30,
      route: 'RN1',
    },
    depotBarrages: mockDepotBarrages([bRabat, bFes]),
    depotInstructions: mockDepotInstructions,
    depotNotifications: mockDepotNotifs,
    comptes: comptesMock,
  });

  assert.ok(res.conflit, 'Conflit créé et assigné');
  assert.equal(res.conflit.statut, 'a_traiter');
  assert.equal(res.assignesA.length, 2, '2 commandants assignés');
  assert.equal(instructionsCreees.length, 2, 'Deux instructions distinctes créées pour les deux régions');
  assert.equal(notificationsInter.length, 2, 'Deux notifications émises pour les deux régions');

  // Vérifier la visibilité pour les deux commandants de région
  const visiblesReg1 = depotConflits.visiblesPour(SESSIONS.reg1);
  const visiblesReg2 = depotConflits.visiblesPour(SESSIONS.reg2);
  assert.ok(visiblesReg1.some((c) => c.numero === 'C-INTER-01'), 'CMND Rabat voit le conflit inter-régions');
  assert.ok(visiblesReg2.some((c) => c.numero === 'C-INTER-01'), 'CMND Fès voit le conflit inter-régions');
});

test.after(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
