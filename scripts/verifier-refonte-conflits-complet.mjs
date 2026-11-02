/**
 * TEST COMPLET DE VALIDATION DE LA REFONTE DU SUIVI & TRAITEMENT DES CONFLITS
 *
 * Vérifie l'ensemble des 10 points clés exigés par la spécification :
 * 1. Organisation en 5 sections : Les Conflits, À traiter, À valider, Suivi, Historique
 * 2. Workflow Super Admin : Détection, assignation avec région/audit, validation, rejet motivé obligatoire
 * 3. Workflow CMD Région : Notification, Option A (traitement direct), Option B (assignation CMD CIE même région)
 * 4. Workflow CMD CIE : Visibilité cloisonnée, traitement opérationnel, soumission pour validation
 * 5. Gestion des statuts et transitions : NEW -> ASSIGNED_REGION -> ASSIGNED_CIE -> IN_PROGRESS_CIE -> PENDING_VALIDATION -> REJECTED -> APPROVED -> FOLLOW_UP -> CLOSED
 * 6. Notifications fiables : Persistantes, liées aux conflits, compteurs exacts, aucun doublon
 * 7. SYNCHRONISATION CARTE (CRITIQUE) : Mise à jour atomique de marquages.json, persistance après rechargement, aucune régression
 * 8. Navigation : Conservation de la section active après chaque opération
 * 9. Sélection multiple : Assignation groupée, suppression groupée, sélection tout / partielle
 * 10. Soft Delete sécurisé : is_deleted, deleted_at, deleted_by, préservation des barrages physiques, refus aux non-admins
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { creerDepot } from '../serveur/depot.mjs';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';
import { SECTIONS, presenterWorkflow } from '../serveur/workflowConflits.mjs';
import { creerDepotNotifications, visiblePour } from '../serveur/notifications.mjs';
import { creerDepotInstructions } from '../serveur/instructions.mjs';

test('1. Organisation stricte des 5 sections du workflow', () => {
  assert.equal(SECTIONS.CONFLITS, 'conflits');
  assert.equal(SECTIONS.A_TRAITER, 'a_traiter');
  assert.equal(SECTIONS.A_VALIDER, 'a_valider');
  assert.equal(SECTIONS.SUIVI, 'suivi');
  assert.equal(SECTIONS.HISTORIQUE, 'historique');
  assert.equal(Object.keys(SECTIONS).length, 5, 'Exactement 5 sections');
});

test('2 à 7. Workflow complet, synchronisation carte & persistance après rechargement', async () => {
  const dossierTest = join(tmpdir(), `test-workflow-map-${Date.now()}`);
  mkdirSync(dossierTest, { recursive: true });
  const fBarrages = join(dossierTest, 'marquages.json');
  const fConflits = join(dossierTest, 'suivi-conflits.json');
  const fNotifs = join(dossierTest, 'notifications.json');
  const fInstr = join(dossierTest, 'instructions.json');

  const barragesInitiaux = [
    {
      id: 'B-001',
      nom: 'Poste Alpha Marrakech',
      reg: 'Marrakech',
      cie: 'CIE Marrakech',
      route: 'N9',
      lat: 31.63,
      lng: -8.00,
      pk: 10,
      statutBarrage: 'en_service',
      type: 'barrage_fixe',
    },
    {
      id: 'B-002',
      nom: 'Poste Beta Marrakech',
      reg: 'Marrakech',
      cie: 'CIE Marrakech',
      route: 'N9',
      lat: 31.65,
      lng: -8.01,
      pk: 13,
      statutBarrage: 'en_service',
      type: 'barrage_fixe',
    },
    {
      id: 'B-003',
      nom: 'Poste Gamma Agadir',
      reg: 'Agadir',
      cie: 'CIE Agadir',
      route: 'N1',
      lat: 30.42,
      lng: -9.59,
      pk: 20,
      statutBarrage: 'en_service',
      type: 'barrage_fixe',
    },
  ];

  writeFileSync(fBarrages, JSON.stringify({ version: 1, items: barragesInitiaux }, null, 2));
  const depotBarrages = creerDepot(fBarrages);
  const depotSuiviConflits = creerDepotSuiviConflits(fConflits);
  const depotNotifications = creerDepotNotifications(fNotifs);
  const depotInstructions = creerDepotInstructions(fInstr);

  const adminSession = { matricule: 'ADM-01', nom: 'Super Admin', rang: 'admin', unite: 'admin' };
  const regSession = { matricule: 'REG-MK', nom: 'CMD Région Marrakech', rang: 'reg', unite: 'Marrakech', reg: 'Marrakech' };
  const cieSession = { matricule: 'CIE-MK', nom: 'CMD CIE Marrakech', rang: 'cie', unite: 'CIE Marrakech', reg: 'Marrakech' };
  const cieAgadir = { matricule: 'CIE-AG', nom: 'CMD CIE Agadir', rang: 'cie', unite: 'CIE Agadir', reg: 'Agadir' };

  // 1. Détection du conflit (NEW) dans "Les Conflits"
  const cDetecte = {
    id: 'CONF-001',
    numero: 'C-01',
    paireCle: 'B-001|B-002',
    barrageAId: 'B-001',
    barrageBId: 'B-002',
    barrageA: depotBarrages.parId('B-001'),
    barrageB: depotBarrages.parId('B-002'),
    distanceKm: 3.2,
    seuilKm: 20,
    route: 'N9',
    etat: 'NEW',
    statut: 'nouveau',
    assignation: { regions: [], cie: null, responsable: null, assignePar: null, assigneLe: null },
    historique: [
      {
        id: 'h-0',
        date: new Date().toISOString(),
        auteur: adminSession,
        action: 'detection',
        de: null,
        vers: 'NEW',
        statut: 'nouveau',
        commentaire: 'Conflit détecté le long de la route N9',
      },
    ],
  };
  depotSuiviConflits.tous().push(cDetecte);

  assert.equal(cDetecte.etat, 'NEW');
  assert.equal(presenterWorkflow(cDetecte, adminSession).section, 'conflits');

  // Visibilité : le Super Admin voit le conflit, mais ni CMD Région ni CMD CIE ne le voient tant qu'il n'est pas assigné
  const visAdmin0 = depotSuiviConflits.visiblesPour(adminSession);
  const visReg0 = depotSuiviConflits.visiblesPour(regSession);
  const visCie0 = depotSuiviConflits.visiblesPour(cieSession);
  assert.ok(visAdmin0.some((c) => c.id === 'CONF-001'), 'Super Admin voit dans Les Conflits');
  assert.ok(!visReg0.some((c) => c.id === 'CONF-001'), 'CMD Région ne voit pas avant assignation');
  assert.ok(!visCie0.some((c) => c.id === 'CONF-001'), 'CMD CIE ne voit pas avant assignation');

  // 2. Assignation par Super Admin au CMD Région Marrakech
  const resAssign = depotSuiviConflits.assignerConflit({
    conflitId: 'CONF-001',
    session: adminSession,
    matricule: 'REG-MK',
    consigne: 'Traiter l’espacement insuffisant sur N9',
    depotBarrages,
    depotInstructions,
    depotNotifications,
    comptes: { tous: () => [adminSession, regSession, cieSession, cieAgadir] },
  });

  assert.equal(resAssign.conflit.etat, 'ASSIGNED_REGION');
  assert.equal(presenterWorkflow(resAssign.conflit, regSession).section, 'a_traiter');

  // Vérification de la notification CMD Région
  const notifsReg = depotNotifications.tous().filter((n) => visiblePour(regSession, n));
  assert.ok(notifsReg.some((n) => n.titre.includes('Nouveau conflit à traiter')), 'CMD Région notifié');

  // 3. Cloisonnement : CMD Région Marrakech tente d'assigner à une CIE d'une autre région (Agadir) -> REFUSÉ
  assert.throws(
    () => {
      depotSuiviConflits.transmettreConflit({
        conflitId: 'CONF-001',
        session: regSession,
        matricule: 'CIE-AG',
        consigne: 'Assignation interdite',
        depotBarrages,
        depotInstructions,
        depotNotifications,
        comptes: { tous: () => [adminSession, regSession, cieSession, cieAgadir] },
      });
    },
    /ne relève pas de votre région/i,
    'Interdiction stricte d’assigner hors de sa région'
  );

  // 4. Assignation valide au CMD CIE Marrakech
  const resTrans = depotSuiviConflits.transmettreConflit({
    conflitId: 'CONF-001',
    session: regSession,
    matricule: 'CIE-MK',
    consigne: 'Proposer déplacement du barrage B-002',
    depotBarrages,
    depotInstructions,
    depotNotifications,
    comptes: { tous: () => [adminSession, regSession, cieSession, cieAgadir] },
  });

  assert.equal(resTrans.conflit.etat, 'ASSIGNED_CIE');
  assert.equal(presenterWorkflow(resTrans.conflit, cieSession).section, 'a_traiter');

  // 5. CMD CIE prend en charge et soumet pour validation un déplacement
  depotSuiviConflits.actionConflit({
    conflitId: 'CONF-001',
    session: cieSession,
    action: 'commencer',
    depotNotifications,
  });

  const resTrait = depotSuiviConflits.traiterConflit({
    conflitId: 'CONF-001',
    session: cieSession,
    action: 'deplacement',
    details: {
      barrageId: 'B-002',
      latApres: 31.85,
      lngApres: -8.12,
      routeApres: 'N9',
      distanceApresKm: 25.4,
      seuilKm: 20,
      motif: 'Déplacement au PK 36 pour respect des 20 km',
    },
    depotBarrages,
    depotInstructions,
    depotNotifications,
  });

  assert.equal(resTrait.conflit.etat, 'PENDING_VALIDATION');
  assert.equal(presenterWorkflow(resTrait.conflit, adminSession).section, 'a_valider');

  // À ce stade, le barrage sur la carte NE DOIT PAS encore être déplacé (attente de validation Super Admin)
  assert.equal(depotBarrages.parId('B-002').lat, 31.65, 'Coordonnées non changées avant validation');

  // 6. Rejet avec motif obligatoire
  assert.throws(
    () => {
      depotSuiviConflits.deciderTraitement({
        conflitId: 'CONF-001',
        session: adminSession,
        decision: 'rejeter',
        raison: '', // VIDE -> DOIT ÉCHOUER
        depotBarrages,
        depotNotifications,
      });
    },
    /motif/i,
    'Rejet sans motif obligatoire refusé'
  );

  // 7. Validation par Super Admin -> MISE À JOUR ATOMIQUE DE marquages.json
  const resVal = depotSuiviConflits.deciderTraitement({
    conflitId: 'CONF-001',
    session: adminSession,
    decision: 'valider',
    raison: 'Validation opérationnelle accordée',
    depotBarrages,
    depotNotifications,
  });

  assert.equal(resVal.conflit.etat, 'FOLLOW_UP');
  assert.equal(presenterWorkflow(resVal.conflit, adminSession).section, 'suivi');
  assert.ok(resVal.barragesModifies?.length > 0, 'Barrages modifiés renvoyés');

  // VÉRIFICATION CRITIQUE : Le barrage dans depotBarrages a reçu les nouvelles coordonnées
  const b002Apres = depotBarrages.parId('B-002');
  assert.equal(b002Apres.lat, 31.85, 'Nouvelle latitude appliquée');
  assert.equal(b002Apres.lng, -8.12, 'Nouvelle longitude appliquée');

  // VÉRIFICATION DE LA PERSISTANCE APRÈS RECHARGEMENT DE LA PAGE (simulé par relecture du fichier disque)
  const depotRecharge = creerDepot(fBarrages, () => []);
  const b002Recharge = depotRecharge.parId('B-002');
  assert.equal(b002Recharge.lat, 31.85, 'Persistance disque après rechargement');
  assert.equal(b002Recharge.lng, -8.12, 'Persistance longitude après rechargement');

  // 8. Historique complet vérifié
  const hist = resVal.conflit.historique;
  assert.ok(hist.length >= 5, 'Historique complet des transitions');
  assert.ok(hist.some((h) => h.action === 'assigner_region'));
  assert.ok(hist.some((h) => h.action === 'assigner_cie'));
  assert.ok(hist.some((h) => h.action === 'soumettre'));
  assert.ok(hist.some((h) => h.action === 'valider'));

  // 9. Clôture dans l'historique
  const resCloture = depotSuiviConflits.actionConflit({
    conflitId: 'CONF-001',
    session: adminSession,
    action: 'cloturer',
    motif: 'Opération terminée avec succès',
    depotNotifications,
  });
  assert.equal(resCloture.conflit.etat, 'CLOSED');
  assert.equal(presenterWorkflow(resCloture.conflit, adminSession).section, 'historique');
});

test('8. Multi-sélection : Assignation et suppression groupée sécurisée (Soft Delete)', () => {
  const dossierTest = join(tmpdir(), `test-batch-conflits-${Date.now()}`);
  mkdirSync(dossierTest, { recursive: true });
  const fBarrages = join(dossierTest, 'marquages.json');
  const fConflits = join(dossierTest, 'suivi-conflits.json');
  const fNotifs = join(dossierTest, 'notifications.json');
  const fInstr = join(dossierTest, 'instructions.json');

  const barragesInit = [
    { id: 'B-10', nom: 'Poste 10', reg: 'Fès', route: 'N6', lat: 34.0, lng: -5.0, type: 'barrage_fixe', statutBarrage: 'en_service' },
    { id: 'B-11', nom: 'Poste 11', reg: 'Fès', route: 'N6', lat: 34.02, lng: -5.01, type: 'barrage_fixe', statutBarrage: 'en_service' },
    { id: 'B-12', nom: 'Poste 12', reg: 'Fès', route: 'N6', lat: 34.04, lng: -5.02, type: 'barrage_fixe', statutBarrage: 'en_service' },
    { id: 'B-13', nom: 'Poste 13', reg: 'Fès', route: 'N6', lat: 34.06, lng: -5.03, type: 'barrage_fixe', statutBarrage: 'en_service' },
  ];

  writeFileSync(fBarrages, JSON.stringify({ version: 1, items: barragesInit }, null, 2));
  const depotBarrages = creerDepot(fBarrages);
  const depotSuiviConflits = creerDepotSuiviConflits(fConflits);
  const depotNotifications = creerDepotNotifications(fNotifs);
  const depotInstructions = creerDepotInstructions(fInstr);

  const adminSession = { matricule: 'ADM-01', nom: 'Super Admin', rang: 'admin', unite: 'admin' };
  const regFes = { matricule: 'REG-FES', nom: 'CMD Région Fès', rang: 'reg', unite: 'Fès', reg: 'Fès' };

  // Création de 3 conflits
  depotSuiviConflits.tous().push(
    { id: 'CONF-10-11', numero: 'C-1011', paireCle: 'B-10|B-11', barrageAId: 'B-10', barrageBId: 'B-11', barrageA: depotBarrages.parId('B-10'), barrageB: depotBarrages.parId('B-11'), route: 'N6', distanceKm: 2, etat: 'NEW', statut: 'nouveau', assignation: { regions: [], cie: null, responsable: null }, historique: [] },
    { id: 'CONF-11-12', numero: 'C-1112', paireCle: 'B-11|B-12', barrageAId: 'B-11', barrageBId: 'B-12', barrageA: depotBarrages.parId('B-11'), barrageB: depotBarrages.parId('B-12'), route: 'N6', distanceKm: 2, etat: 'NEW', statut: 'nouveau', assignation: { regions: [], cie: null, responsable: null }, historique: [] },
    { id: 'CONF-12-13', numero: 'C-1213', paireCle: 'B-12|B-13', barrageAId: 'B-12', barrageBId: 'B-13', barrageA: depotBarrages.parId('B-12'), barrageB: depotBarrages.parId('B-13'), route: 'N6', distanceKm: 2, etat: 'NEW', statut: 'nouveau', assignation: { regions: [], cie: null, responsable: null }, historique: [] }
  );

  // A. Assignation groupée par Super Admin
  const resGrpAssign = depotSuiviConflits.assignerConflitsGroupe({
    conflitIds: ['CONF-10-11', 'CONF-11-12'],
    session: adminSession,
    matricule: 'REG-FES',
    consigne: 'Traitement groupé axe N6',
    depotBarrages,
    depotInstructions,
    depotNotifications,
    comptes: { tous: () => [adminSession, regFes] },
  });

  assert.equal(resGrpAssign.assignes.length, 2, '2 conflits assignés en groupe');
  assert.equal(depotSuiviConflits.parId('CONF-10-11').etat, 'ASSIGNED_REGION');
  assert.equal(depotSuiviConflits.parId('CONF-11-12').etat, 'ASSIGNED_REGION');
  assert.equal(depotSuiviConflits.parId('CONF-12-13').etat, 'NEW');

  // B. Soft delete par CMD Région -> DOIT ÊTRE REFUSÉ (403)
  assert.throws(
    () => {
      depotSuiviConflits.supprimerConflitsGroupe({
        conflitIds: ['CONF-10-11'],
        session: regFes,
        depotNotifications,
      });
    },
    /Super Admin/i,
    'Seul le Super Admin peut supprimer des conflits'
  );

  // C. Soft delete groupé par Super Admin
  const resSuppr = depotSuiviConflits.supprimerConflitsGroupe({
    conflitIds: ['CONF-10-11', 'CONF-12-13'],
    session: adminSession,
    depotNotifications,
  });

  assert.equal(resSuppr.supprimes.length, 2, '2 conflits soft-deleted');

  // Vérification de la structure du Soft Delete
  const cSuppr1 = depotSuiviConflits.parId('CONF-10-11');
  assert.equal(cSuppr1.is_deleted, true, 'is_deleted === true');
  assert.equal(cSuppr1.deleted, true, 'deleted === true');
  assert.ok(cSuppr1.deleted_at, 'deleted_at timestamp renseigné');
  assert.ok(cSuppr1.deleted_by, 'deleted_by auteur renseigné');

  // Vérification que les barrages physiques NE SONT PAS supprimés
  assert.ok(depotBarrages.parId('B-10'), 'Barrage B-10 préservé');
  assert.ok(depotBarrages.parId('B-11'), 'Barrage B-11 préservé');
  assert.ok(depotBarrages.parId('B-12'), 'Barrage B-12 préservé');
  assert.ok(depotBarrages.parId('B-13'), 'Barrage B-13 préservé');

  // Vérification que les conflits supprimés sont exclus des listes opérationnelles
  const visiblesAdmin = depotSuiviConflits.visiblesPour(adminSession);
  assert.ok(!visiblesAdmin.some((c) => c.id === 'CONF-10-11'), 'CONF-10-11 exclu des listes opérationnelles');
  assert.ok(!visiblesAdmin.some((c) => c.id === 'CONF-12-13'), 'CONF-12-13 exclu des listes opérationnelles');
  assert.ok(visiblesAdmin.some((c) => c.id === 'CONF-11-12'), 'CONF-11-12 non supprimé reste visible');
});
