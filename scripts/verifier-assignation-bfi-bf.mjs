import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

test('Règle BFI vs BF : Assignation exclusive au commandement du BF régulier car BFI intouchable', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'test-bfi-bf-'));
  const fichierConflits = join(tmpDir, 'suivi-conflits.json');
  writeFileSync(fichierConflits, JSON.stringify({ version: 1, items: [] }), 'utf8');

  const bBFI = {
    id: 'BFI-RABAT-01',
    nom: 'BFI Rabat Ville',
    type: 'barrage_fixe',
    protection: 'intouchable',
    intouchable: true,
    reg: 'Rabat',
    cie: 'Rabat',
    route: 'RN1',
    factionId: 'F1',
    statutBarrage: 'approuve',
  };

  const bBF = {
    id: 'BF-KENITRA-01',
    nom: 'Poste Fixe Kénitra Sud',
    type: 'barrage_fixe',
    protection: 'aucune',
    intouchable: false,
    reg: 'Kénitra',
    cie: 'Kénitra',
    route: 'RN1',
    factionId: 'F1',
    statutBarrage: 'approuve',
  };

  const barragesMap = new Map([
    [bBFI.id, bBFI],
    [bBF.id, bBF],
  ]);

  const mockDepotBarrages = {
    parId: (id) => barragesMap.get(id) || null,
    tous: () => Array.from(barragesMap.values()),
  };

  const mockDepotInstructions = {
    creer: (inst) => ({ id: 'inst-test-01', ...inst }),
    ajouter: (inst) => inst,
    fermer: () => {},
  };

  const mockDepotNotifications = {
    publier: () => {},
    envoyer: () => {},
  };

  const comptesList = [
    { matricule: 'REG-RABAT', nom: 'CMD Région Rabat', rang: 'reg', unite: 'Rabat', reg: 'Rabat' },
    { matricule: 'REG-KENITRA', nom: 'CMD Région Kénitra', rang: 'reg', unite: 'Kénitra', reg: 'Kénitra' },
  ];

  const mockComptes = {
    tous: () => comptesList,
  };

  const suivi = creerDepotSuiviConflits(fichierConflits);
  const sessionAdmin = { matricule: 'SUPERADMIN', rang: 'admin', nom: 'Super Admin', unite: 'admin' };

  await t.test('1. Conflit BFI (Rabat) vs BF (Kénitra) : assignerConflit restreint automatiquement au CMD Région Kénitra (BF)', () => {
    const conflitId = 'conf_bfi_bf_test_01';
    const res = suivi.assignerConflit({
      conflitId,
      session: sessionAdmin,
      matricules: ['REG-RABAT', 'REG-KENITRA'], // Superadmin demande les deux
      consigne: 'Traitement espacement RN1',
      conflitData: {
        id: conflitId,
        numero: 'C-BFI-BF-01',
        barrageAId: bBFI.id,
        barrageBId: bBF.id,
        a: bBFI,
        b: bBF,
        regA: 'Rabat',
        regB: 'Kénitra',
        distanceKm: 12.4,
        seuilKm: 20,
        route: 'RN1',
      },
      depotBarrages: mockDepotBarrages,
      depotInstructions: mockDepotInstructions,
      depotNotifications: mockDepotNotifications,
      comptes: mockComptes,
    });

    assert.ok(res.conflit, 'Le conflit est créé et assigné');
    assert.equal(res.conflit.statut, 'a_traiter');
    // Le BFI est intouchable : seule la région du BF (Kénitra) doit être assignée !
    assert.equal(res.conflit.assignesA.length, 1, 'Une seule région assignée');
    assert.equal(res.conflit.assignesA[0].matricule, 'REG-KENITRA', 'Assigné exclusivement à REG-KENITRA (mol l BF)');
    assert.equal(res.conflit.assignesA[0].unite, 'Kénitra');
  });

  await t.test('2. Conflit BF (Kénitra) vs BFI (Rabat) inversé : assigne également exclusivement au BF (Kénitra)', () => {
    const conflitId = 'conf_bf_bfi_test_02';
    const res = suivi.assignerConflit({
      conflitId,
      session: sessionAdmin,
      matricule: 'REG-RABAT', // Même si on tente d'envoyer au BFI seul
      conflitData: {
        id: conflitId,
        numero: 'C-BF-BFI-02',
        barrageAId: bBF.id,
        barrageBId: bBFI.id,
        a: bBF,
        b: bBFI,
        regA: 'Kénitra',
        regB: 'Rabat',
        distanceKm: 14.1,
        seuilKm: 20,
        route: 'RN1',
      },
      depotBarrages: mockDepotBarrages,
      depotInstructions: mockDepotInstructions,
      depotNotifications: mockDepotNotifications,
      comptes: mockComptes,
    });

    assert.ok(res.conflit);
    assert.equal(res.conflit.assignesA[0].matricule, 'REG-KENITRA', 'Assigné exclusivement au BF même en cas d inversion');
  });

  await t.test('3. Conflit entre deux barrages BF réguliers : assigne aux deux régions conjointement', () => {
    const bBF2 = {
      id: 'BF-RABAT-REGULIER',
      nom: 'Poste Fixe Rabat Sortie',
      type: 'barrage_fixe',
      protection: 'aucune',
      intouchable: false,
      reg: 'Rabat',
      cie: 'Rabat',
      route: 'RN1',
      factionId: 'F1',
      statutBarrage: 'approuve',
    };
    barragesMap.set(bBF2.id, bBF2);

    const conflitId = 'conf_bf_bf_reguliers_03';
    const res = suivi.assignerConflit({
      conflitId,
      session: sessionAdmin,
      matricules: ['REG-RABAT', 'REG-KENITRA'],
      conflitData: {
        id: conflitId,
        numero: 'C-BF-BF-03',
        barrageAId: bBF2.id,
        barrageBId: bBF.id,
        a: bBF2,
        b: bBF,
        regA: 'Rabat',
        regB: 'Kénitra',
        distanceKm: 16.0,
        seuilKm: 20,
        route: 'RN1',
      },
      depotBarrages: mockDepotBarrages,
      depotInstructions: mockDepotInstructions,
      depotNotifications: mockDepotNotifications,
      comptes: mockComptes,
    });

    assert.equal(res.conflit.assignesA.length, 2, 'Les 2 régions sont assignées pour deux BF réguliers');
    assert.ok(res.conflit.assignesA.some((c) => c.matricule === 'REG-RABAT'));
    assert.ok(res.conflit.assignesA.some((c) => c.matricule === 'REG-KENITRA'));
  });

  rmSync(tmpDir, { recursive: true, force: true });
});
