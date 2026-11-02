#!/usr/bin/env node
/**
 * Test de vérification complète du filtrage des barrages, gestion et assignation des conflits.
 *
 *   node --test scripts/verifier-filtrage-assignation-conflits.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { canonicalRouteId, routesCorrespondent, clePaire } = await import(
  pathToFileURL(resolve(ROOT, 'src/conflitsIdentifies.js')).href
);
const { creerDepotSuiviConflits } = await import(
  pathToFileURL(resolve(ROOT, 'serveur/suiviConflits.mjs')).href
);
const { creerDepot } = await import(
  pathToFileURL(resolve(ROOT, 'serveur/depot.mjs')).href
);

test('1. Normalisation canonique des identifiants de routes et filtrage strict', () => {
  assert.equal(canonicalRouteId('RN 1'), 'RN1');
  assert.equal(canonicalRouteId('rn-1'), 'RN1');
  assert.equal(canonicalRouteId('N1'), 'RN1');
  assert.equal(canonicalRouteId('A 2'), 'A2');
  assert.equal(canonicalRouteId('a-2'), 'A2');
  assert.equal(canonicalRouteId('RR 322'), 'RR322');
  assert.equal(canonicalRouteId('r322'), 'RR322');
  assert.equal(canonicalRouteId('RP 1001'), 'RP1001');
  assert.equal(canonicalRouteId('p1001'), 'RP1001');

  assert.equal(routesCorrespondent('RN 1', 'rn-1'), true);
  assert.equal(routesCorrespondent('RN1', 'RN7'), false);
  assert.equal(routesCorrespondent('A2', 'A3'), false);

  // Simulation du filtrage strict sur les barrages de la carte
  const barrages = [
    { id: 'B1', nom: 'Poste RN1 Nord', route: 'RN 1', lat: 33.5, lng: -7.5 },
    { id: 'B2', nom: 'Poste RN1 Sud', route: 'rn-1', lat: 33.4, lng: -7.5 },
    { id: 'B3', nom: 'Poste RN7', route: 'RN 7', lat: 31.6, lng: -8.0 },
    { id: 'B4', nom: 'Poste A2', route: 'A 2', lat: 34.0, lng: -6.8 },
  ];

  const filtreRN1 = 'RN1';
  const visiblesRN1 = barrages.filter(
    (b) => canonicalRouteId(b.route) === canonicalRouteId(filtreRN1)
  );
  assert.equal(visiblesRN1.length, 2);
  assert.deepEqual(visiblesRN1.map((b) => b.id), ['B1', 'B2']);

  // Absence de correspondance
  const filtreInconnu = 'RN99';
  const visiblesInconnu = barrages.filter(
    (b) => canonicalRouteId(b.route) === canonicalRouteId(filtreInconnu)
  );
  assert.equal(visiblesInconnu.length, 0);

  // Restauration lorsque le filtre est effacé (null)
  const filtreEfface = null;
  const visiblesTous = barrages.filter(
    (b) => !filtreEfface || canonicalRouteId(b.route) === canonicalRouteId(filtreEfface)
  );
  assert.equal(visiblesTous.length, 4);
});

test('2. Assignation de CONFLIT : l’entité assignée est le conflit, jamais les barrages', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gr-conflit-test-'));
  const fichierConflits = join(tmpDir, 'suivi-conflits.json');
  const fichierBarrages = join(tmpDir, 'barrages.json');

  const barrageAInit = {
    id: 'BA-01',
    nom: 'Barrage Fixe Alpha',
    type: 'barrage_fixe',
    protection: 'aucune',
    intouchable: false,
    route: 'RN1',
    lat: 33.5,
    lng: -7.5,
    reg: 'Casablanca-Settat',
    cie: 'Casablanca',
    factionId: 'F1',
  };
  const barrageBInit = {
    id: 'BB-02',
    nom: 'Barrage Fixe Bêta',
    type: 'barrage_fixe',
    protection: 'aucune',
    intouchable: false,
    route: 'RN1',
    lat: 33.58,
    lng: -7.52,
    reg: 'Casablanca-Settat',
    cie: 'Casablanca',
    factionId: 'F1',
  };

  writeFileSync(
    fichierBarrages,
    JSON.stringify({ version: 1, items: [barrageAInit, barrageBInit] }),
    'utf8'
  );
  writeFileSync(fichierConflits, JSON.stringify({ version: 1, items: [] }), 'utf8');

  const depotBarrages = creerDepot(fichierBarrages);
  const depotConflits = creerDepotSuiviConflits(fichierConflits);

  const sessionAdmin = { matricule: 'ADM01', nom: 'Super Admin', rang: 'admin', unite: 'admin' };
  const comptesMock = {
    tous: () => [
      { matricule: 'REG-CASA', nom: 'Col. Casa', rang: 'reg', unite: 'Casablanca-Settat' },
      { matricule: 'REG-RABAT', nom: 'Col. Rabat', rang: 'reg', unite: 'Rabat-Salé-Kénitra' },
    ],
  };

  // 1. Assignation du conflit C-01 par Super Admin
  const resAssign = depotConflits.assignerConflit({
    conflitId: 'C-01',
    session: sessionAdmin,
    matricule: 'REG-CASA',
    consigne: 'Veuillez espacer les deux postes de 15 km minimum.',
    conflitData: {
      numero: 'C-01',
      barrageAId: 'BA-01',
      barrageBId: 'BB-02',
      a: barrageAInit,
      b: barrageBInit,
      distanceKm: 8.5,
      seuilKm: 20,
      route: 'RN1',
      factionId: 'F1',
      factionsCommunes: ['F1'],
      motif: 'Espacement insuffisant (8.5 km < 20 km)',
    },
    depotBarrages,
    comptes: comptesMock,
  });

  assert.ok(resAssign.conflit);
  assert.equal(resAssign.conflit.statut, 'a_traiter');
  assert.equal(resAssign.conflit.assigneA.matricule, 'REG-CASA');
  assert.equal(resAssign.conflit.assigneA.unite, 'Casablanca-Settat');

  // VÉRIFICATION CRITIQUE : les barrages A et B en base n'ont subi AUCUNE altération
  const barrageARelu = depotBarrages.parId('BA-01');
  const barrageBRelu = depotBarrages.parId('BB-02');

  assert.deepEqual(barrageARelu.lat, barrageAInit.lat);
  assert.deepEqual(barrageARelu.lng, barrageAInit.lng);
  assert.equal(barrageARelu.factionId, 'F1');
  assert.equal(barrageARelu.assigneA, undefined); // Aucune assignation stockée sur le barrage !
  assert.equal(barrageBRelu.assigneA, undefined);

  // 2. Assignation d'un DEUXIÈME conflit (C-02) pour vérifier le regroupement en Section B
  const resAssign2 = depotConflits.assignerConflit({
    conflitId: 'C-02',
    session: sessionAdmin,
    matricule: 'REG-CASA',
    consigne: 'Deuxième conflit assigné.',
    conflitData: {
      numero: 'C-02',
      barrageAId: 'BA-01',
      barrageBId: 'BB-03',
      distanceKm: 12.0,
      route: 'RN1',
      factionId: 'F1',
    },
    depotBarrages,
    comptes: comptesMock,
  });

  const tousConflits = depotConflits.tous();
  const conflitsAssignes = tousConflits.filter((c) => c.statut === 'a_traiter');
  assert.equal(conflitsAssignes.length, 2);
  // Les deux conflits assignés sont présents ensemble dans la même section
  assert.deepEqual(conflitsAssignes.map((c) => c.numero), ['C-01', 'C-02']);

  // 3. Désassignation de C-01 par Super Admin
  const resDes = depotConflits.desassignerConflit({
    conflitId: 'C-01',
    session: sessionAdmin,
  });

  assert.equal(resDes.conflit.statut, 'nouveau');
  assert.equal(resDes.conflit.assigneA, undefined);
  assert.equal(resDes.conflit.assignesA, undefined);

  // Après désassignation, seul C-02 reste assigné, C-01 est retourné aux non assignés
  const conflitsApresDesassign = depotConflits.tous();
  const assignesRestants = conflitsApresDesassign.filter((c) => c.statut === 'a_traiter');
  const nonAssignes = conflitsApresDesassign.filter((c) => c.statut === 'nouveau');

  assert.equal(assignesRestants.length, 1);
  assert.equal(assignesRestants[0].numero, 'C-02');
  assert.equal(nonAssignes.length, 1);
  assert.equal(nonAssignes[0].numero, 'C-01');

  // Nettoyage temporaire
  rmSync(tmpDir, { recursive: true, force: true });
});

test('3. Protection stricte FIXE INTOUCHABLE vs FIXE normal', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gr-intouchable-test-'));
  const fichierConflits = join(tmpDir, 'suivi-conflits.json');
  const fichierBarrages = join(tmpDir, 'barrages.json');

  const bIntouchable = {
    id: 'BFI-CIE-001',
    nom: 'Barrage Intouchable Agadir',
    type: 'barrage_fixe',
    protection: 'intouchable',
    intouchable: true,
    route: 'RN1',
    lat: 30.42,
    lng: -9.55,
    reg: 'Souss-Massa',
    cie: 'Agadir',
    factionId: '', // permanent 24/24 sur toutes les factions
  };
  const bNormal = {
    id: 'BF-BT-001',
    nom: 'Barrage Normal Amskroud',
    type: 'barrage_fixe',
    protection: 'aucune',
    intouchable: false,
    route: 'RN1',
    lat: 30.45,
    lng: -9.50,
    reg: 'Souss-Massa',
    cie: 'Agadir',
    factionId: 'F1',
  };

  writeFileSync(
    fichierBarrages,
    JSON.stringify({ version: 1, items: [bIntouchable, bNormal] }),
    'utf8'
  );
  writeFileSync(fichierConflits, JSON.stringify({ version: 1, items: [] }), 'utf8');

  const depotBarrages = creerDepot(fichierBarrages);
  const depotConflits = creerDepotSuiviConflits(fichierConflits);

  const sessionReg = { matricule: 'REG-SM', nom: 'Col. Souss', rang: 'reg', unite: 'Souss-Massa' };

  // Création d'un conflit impliquant un FIXE INTOUCHABLE
  depotConflits.assignerConflit({
    conflitId: 'C-INTOU-01',
    session: { matricule: 'ADMIN', rang: 'admin' },
    matricule: 'REG-SM',
    conflitData: {
      numero: 'C-INTOU-01',
      barrageAId: 'BFI-CIE-001',
      barrageBId: 'BF-BT-001',
      a: bIntouchable,
      b: bNormal,
      distanceKm: 7.2,
      route: 'RN1',
    },
    depotBarrages,
    comptes: { tous: () => [{ matricule: 'REG-SM', rang: 'reg', unite: 'Souss-Massa' }] },
  });

  // TENTATIVE DE CHANGER LA FACTION POUR RÉSOUDRE LE CONFLIT -> DOIT ÉCHOUER (403/Error)
  assert.throws(
    () => {
      depotConflits.traiterConflit({
        conflitId: 'C-INTOU-01',
        session: sessionReg,
        action: 'changement_faction',
        details: {
          barrageId: 'BF-BT-001',
          nouvelleFactionId: 'F2',
        },
        depotBarrages,
      });
    },
    /Action non autorisée.*FIXE INTOUCHABLE/i
  );

  // Le conflit n'a pas été marqué résolu par changement de faction
  const confApresTentative = depotConflits.parId('C-INTOU-01');
  assert.equal(confApresTentative.statut, 'a_traiter');

  // En revanche, l'action de DÉPLACEMENT sur le barrage normal est autorisée
  const resDeplacement = depotConflits.traiterConflit({
    conflitId: 'C-INTOU-01',
    session: sessionReg,
    action: 'deplacement',
    details: {
      barrageId: 'BF-BT-001',
      motif: 'Déplacement proposé à 22 km du point fixe intouchable.',
    },
    depotBarrages,
  });

  assert.ok(
    resDeplacement.conflit.statut === 'en_cours' || resDeplacement.conflit.statut === 'traite',
    `Statut attendu en_cours ou traite, reçu: ${resDeplacement.conflit.statut}`
  );
  assert.ok(
    resDeplacement.conflit.historique.some((h) => h.action === 'traitement')
  );

  rmSync(tmpDir, { recursive: true, force: true });
});

test('4. Persistance des conflits et indépendance vis-à-vis du filtrage', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gr-filtrage-test-'));
  const fichierConflits = join(tmpDir, 'suivi-conflits.json');

  const confRN1 = {
    id: 'conf_rn1',
    numero: 'C-RN1',
    paireCle: 'B1|B2',
    barrageAId: 'B1',
    barrageBId: 'B2',
    route: 'RN1',
    statut: 'nouveau',
    distanceKm: 9.0,
    seuilKm: 20,
    cree: new Date().toISOString(),
  };

  const confA2 = {
    id: 'conf_a2',
    numero: 'C-A2',
    paireCle: 'B3|B4',
    barrageAId: 'B3',
    barrageBId: 'B4',
    route: 'A2',
    statut: 'a_traiter', // assigné
    assigneA: { matricule: 'REG-RABAT', unite: 'Rabat-Salé-Kénitra' },
    distanceKm: 14.0,
    seuilKm: 20,
    cree: new Date().toISOString(),
  };

  writeFileSync(fichierConflits, JSON.stringify({ version: 1, items: [confRN1, confA2] }), 'utf8');

  // Recharger depuis le fichier
  const depot = creerDepotSuiviConflits(fichierConflits);
  const tous = depot.tous();
  assert.equal(tous.length, 2);

  // Simulation du filtre route "RN1" appliqué
  const filtreActif = 'RN1';
  const nonAssignesFiltres = tous.filter((c) => {
    if (c.statut !== 'nouveau') return false;
    return routesCorrespondent(c.route, filtreActif);
  });
  // Seul le conflit non assigné de la RN1 est dans la liste non assignée filtrée
  assert.equal(nonAssignesFiltres.length, 1);
  assert.equal(nonAssignesFiltres[0].numero, 'C-RN1');

  // Les conflits assignés (C-A2) RESTENT TOUJOURS ACCESSIBLES même lors du filtrage par route de la liste non assignée
  const assignesToujoursVisibles = tous.filter((c) => c.statut === 'a_traiter');
  assert.equal(assignesToujoursVisibles.length, 1);
  assert.equal(assignesToujoursVisibles[0].numero, 'C-A2');
  assert.equal(assignesToujoursVisibles[0].route, 'A2');

  rmSync(tmpDir, { recursive: true, force: true });
});

test('5. Isolation de route (barrages uniquement) et Assignation groupée (« Assigner tout ») aux régions concernées', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'gr-assign-tout-'));
  const fichierConflits = join(tmpDir, 'suivi-conflits.json');
  const fichierBarrages = join(tmpDir, 'marquages.json');

  const depotBarrages = creerDepot(fichierBarrages);
  const depotConflits = creerDepotSuiviConflits(fichierConflits);

  const comptesMock = {
    tous: () => [
      { matricule: 'REG-NADOR', unite: 'Oriental', rang: 'reg', reg: 'Oriental' },
      { matricule: 'REG-FES', unite: 'Fès-Meknès', rang: 'reg', reg: 'Fès-Meknès' },
    ],
  };

  const sessionAdmin = { matricule: 'admin_test', rang: 'admin', nom: 'Super Admin Test' };

  // 1. Simulation du filtrage strict sur la carte : seuls les barrages de la route filtrée sont visibles
  const tousMarquages = [
    { id: 'B-RN2-1', type: 'barrage_fixe', route: 'RN 2', reg: 'Oriental' },
    { id: 'B-RN2-2', type: 'barrage_fixe', route: 'rn2', reg: 'Oriental' },
    { id: 'B-RN1-1', type: 'barrage_fixe', route: 'RN 1', reg: 'Casablanca-Settat' },
    { id: 'ACC-01', type: 'accident', route: 'RN 2' }, // non barrage : doit être masqué lors du filtrage route
    { id: 'PTG-01', type: 'pointage', route: 'RN 2' },  // non barrage : doit être masqué
  ];

  const filtreRoute = 'RN2';
  const marquagesVisibles = tousMarquages.filter((m) => {
    // Règle d'isolation : seuls les barrages de cette route sont visibles
    const estBarrage = m.type === 'barrage_fixe' || m.type === 'barrage_mobile' || m.type === 'barrage_vip';
    if (!estBarrage) return false;
    return canonicalRouteId(m.route) === canonicalRouteId(filtreRoute);
  });

  assert.equal(marquagesVisibles.length, 2);
  assert.deepEqual(marquagesVisibles.map((m) => m.id), ['B-RN2-1', 'B-RN2-2']);

  // 2. Simulation de l'assignation en masse ("Assigner tout")
  const conflitsNonAssignes = [
    {
      id: 'conf_calc_1',
      numero: 'C-01',
      a: { id: 'B-RN2-1', nom: 'Selouane', reg: 'Oriental', route: 'RN2' },
      b: { id: 'B-RN2-2', nom: 'Zaiou', reg: 'Oriental', route: 'RN2' },
      route: 'RN2',
      distanceKm: 12.4,
    },
    {
      id: 'conf_calc_2',
      numero: 'C-02',
      a: { id: 'B-RN2-2', nom: 'Zaiou', reg: 'Oriental', route: 'RN2' },
      b: { id: 'B-RN2-3', nom: 'Berkane', reg: 'Oriental', route: 'RN2' },
      route: 'RN2',
      distanceKm: 16.8,
    },
  ];

  const regComptes = comptesMock.tous().filter((c) => c.rang === 'reg');
  let reussis = 0;

  for (const conf of conflitsNonAssignes) {
    const regA = conf.a.reg;
    const regB = conf.b.reg;
    const cibles = regComptes.filter((c) => c.unite === regA || c.unite === regB);
    const matricules = cibles.map((c) => c.matricule);

    const res = depotConflits.assignerConflit({
      conflitId: conf.id,
      session: sessionAdmin,
      matricules,
      consigne: 'Assignation groupée automatique RN2',
      conflitData: {
        numero: conf.numero,
        barrageAId: conf.a.id,
        barrageBId: conf.b.id,
        a: conf.a,
        b: conf.b,
        distanceKm: conf.distanceKm,
        route: conf.route,
      },
      depotBarrages,
      comptes: comptesMock,
    });

    assert.ok(res.conflit);
    assert.equal(res.conflit.statut, 'a_traiter');
    assert.equal(res.conflit.assigneA.matricule, 'REG-NADOR');
    reussis++;
  }

  assert.equal(reussis, 2);
  assert.equal(depotConflits.tous().length, 2);
  assert.equal(depotConflits.tous().every((c) => c.statut === 'a_traiter'), true);

  rmSync(tmpDir, { recursive: true, force: true });
});
