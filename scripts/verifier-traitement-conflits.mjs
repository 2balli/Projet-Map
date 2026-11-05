/**
 * TESTS DE VALIDATION DU TRAITEMENT DES CONFLITS.
 *
 * Vérifie :
 * 1. Cas A (BFI intouchable vs BF régulier) :
 *    - Rejet strict du changement de faction.
 *    - Traitement par déplacement ou dérogation autorisé.
 * 2. Cas B (BF vs BF de même faction) :
 *    - Changement de faction autorisé.
 *    - Maintien opérationnel avec décalage horaire (persiste = true).
 * 3. Résolution physique (déplacement >= seuil ou suppression) :
 *    - persiste = false, statutPhysique = 'resolu'.
 * 4. Persistance en base et visibilité Superadmin :
 *    - Le conflit traité reste visible pour le Superadmin avec le statut 'traite'.
 * 5. Workflow (serveur/workflowConflits.mjs) : un traitement direct du Super
 *    Admin vaut validation — et comme toute validation, il archive le conflit
 *    (CLOSED, section Historique) sans rien effacer du traitement ; un CMD
 *    Région ne traite qu'un conflit qui lui a été ASSIGNÉ.
 *    - Relire le fichier JSON confirme la conservation de toutes les métadonnées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const tempDir = mkdtempSync(join(tmpdir(), 'gr-test-traitement-'));
const fichier = join(tempDir, 'suivi-conflits-test.json');
const depot = creerDepotSuiviConflits(fichier);

const SESSIONS = {
  admin: { matricule: 'ADM-01', rang: 'admin', unite: 'admin', nom: 'Super Admin' },
  reg1: { matricule: 'REG-01', rang: 'reg', unite: 'Rabat', nom: 'CMND Région Rabat' },
  reg2: { matricule: 'REG-02', rang: 'reg', unite: 'Casablanca-Settat', nom: 'CMND Région Casa' },
};

/* Barrages pour les tests */
const B_BFI = {
  id: 'B_BFI_01',
  nom: 'Barrage Intouchable RN1',
  type: 'barrage_vip',
  intouchable: true,
  protection: 'intouchable',
  route: 'RN1',
  reg: 'Rabat',
  factionId: 'F1',
};

const B_BFI_CASA = {
  id: 'B_BFI_CASA_01',
  nom: 'Barrage Intouchable Casa Nord',
  type: 'barrage_vip',
  intouchable: true,
  protection: 'intouchable',
  route: 'A1',
  reg: 'Casablanca-Settat',
  factionId: 'F1',
};

const B_REGULIER_1 = {
  id: 'B_REG_01',
  nom: 'Barrage Régulier Salé',
  type: 'barrage_fixe',
  route: 'RN1',
  reg: 'Rabat',
  factionId: 'F1',
};

const B_REGULIER_2 = {
  id: 'B_REG_02',
  nom: 'Barrage Régulier Kénitra',
  type: 'barrage_fixe',
  route: 'RN1',
  reg: 'Rabat',
  factionId: 'F1',
};

/* Une paire à part pour le déplacement : une même paire ne porte qu'un
   conflit actif (CONF-CAS-B l'occupe déjà, en attente de validation). */
const B_REGULIER_3 = {
  id: 'B_REG_03',
  nom: 'Barrage Régulier Skhirat',
  type: 'barrage_fixe',
  route: 'RN1',
  reg: 'Rabat',
  factionId: 'F1',
};

const barragesMap = new Map([
  [B_BFI.id, { ...B_BFI }],
  [B_BFI_CASA.id, { ...B_BFI_CASA }],
  [B_REGULIER_1.id, { ...B_REGULIER_1 }],
  [B_REGULIER_2.id, { ...B_REGULIER_2 }],
  [B_REGULIER_3.id, { ...B_REGULIER_3 }],
]);

const depotBarrages = {
  parId: (id) => barragesMap.get(id) ?? null,
  modifier: (id, modifs) => {
    const b = barragesMap.get(id);
    if (b) Object.assign(b, modifs);
    return b;
  },
  supprimer: (id) => barragesMap.delete(id),
};

const notificationsEmises = [];
const depotNotifications = {
  publier: (n) => {
    notificationsEmises.push(n);
    return n;
  },
};

test('Cas A : Conflit entre BFI et BF régulier — interdiction stricte de changer la faction', () => {
  const confCasA = {
    id: 'CONF-CAS-A',
    numero: 'C-01',
    barrageAId: B_BFI.id,
    barrageBId: B_REGULIER_1.id,
    a: B_BFI,
    b: B_REGULIER_1,
    route: 'RN1',
    distanceKm: 8.5,
    seuilKm: 20,
    factionsCommunes: ['F1'],
  };

  // 1. Tenter un changement de faction doit lancer une erreur explicite
  assert.throws(
    () => {
      depot.traiterConflit({
        conflitId: confCasA.id,
        session: SESSIONS.admin,
        action: 'changement_faction',
        details: {
          barrageId: B_REGULIER_1.id,
          nouvelleFactionId: 'F2',
          conflitData: confCasA,
        },
        depotBarrages,
        depotNotifications,
      });
    },
    /FIXE INTOUCHABLE.*ne peut pas être résolu par un changement de faction/i,
    'Le backend doit refuser catégoriquement le changement de faction pour un conflit avec un BFI'
  );

  // 2. Traitement par dérogation opérationnelle autorisé pour le Superadmin
  const resDerogation = depot.traiterConflit({
    conflitId: confCasA.id,
    session: SESSIONS.admin,
    action: 'derogation',
    details: {
      justification: 'Point d’intérêt stratégique majeur validé par le Superadmin.',
      conflitData: confCasA,
    },
    depotBarrages,
    depotNotifications,
  });

  /* Traitement direct du Super Admin : validé d'office, donc archivé. */
  assert.equal(resDerogation.statut, 'cloture');
  assert.equal(resDerogation.conflit.etat, 'CLOSED');
  assert.ok(resDerogation.conflit.clotureLe, 'l’archivage est daté');
  assert.equal(resDerogation.conflit.cloturePar?.matricule, SESSIONS.admin.matricule, 'et signé');
  assert.equal(resDerogation.persiste, true, 'La proximité physique persiste en dérogation');
  assert.equal(resDerogation.justification, 'Point d’intérêt stratégique majeur validé par le Superadmin.');
});

test('Cas B : Conflit entre deux barrages BF réguliers — changement de faction autorisé et proximité surveillée', () => {
  const confCasB = {
    id: 'CONF-CAS-B',
    numero: 'C-02',
    barrageAId: B_REGULIER_1.id,
    barrageBId: B_REGULIER_2.id,
    a: B_REGULIER_1,
    b: B_REGULIER_2,
    route: 'RN1',
    distanceKm: 12.0,
    seuilKm: 20,
    factionsCommunes: ['F1'],
  };

  /* Un CMD Région ne traite pas un conflit qui ne lui est pas assigné… */
  assert.throws(
    () => depot.traiterConflit({
      conflitId: confCasB.id, session: SESSIONS.reg1, action: 'derogation',
      details: { justification: 'x', conflitData: confCasB }, depotBarrages, depotNotifications,
    }),
    (e) => e.code === 404 || e.code === 403,
  );
  /* … le Super Admin le lui assigne d'abord (enregistré à l'état NEW, puis assigné). */
  const assigne = depot.assignerConflit({
    conflitId: confCasB.id,
    session: SESSIONS.admin,
    matricules: [SESSIONS.reg1.matricule],
    conflitData: confCasB,
    depotBarrages,
    depotNotifications,
    comptes: { tous: () => [{ matricule: SESSIONS.reg1.matricule, rang: 'reg', unite: 'Rabat', nom: SESSIONS.reg1.nom }] },
  });
  assert.equal(assigne.conflit.etat, 'ASSIGNED_REGION');

  const resFaction = depot.traiterConflit({
    conflitId: confCasB.id,
    session: SESSIONS.reg1,
    action: 'changement_faction',
    details: {
      barrageId: B_REGULIER_2.id,
      nouvelleFactionId: 'F2',
      nouvelleFactionNom: 'Faction 2 (Après-midi)',
      justification: 'Décalage horaire validé en coordination régionale.',
      conflitData: confCasB,
    },
    depotBarrages,
    depotNotifications,
  });

  assert.equal(resFaction.statut, 'traite');
  assert.equal(resFaction.conflit.etat, 'PENDING_VALIDATION', 'soumis au Super Admin');
  assert.equal(resFaction.persiste, true, 'Le conflit physique persiste sous forme de décalage horaire');
  assert.equal(resFaction.statutPhysique, 'maintenu_decalage_horaire');
  assert.match(resFaction.decision, /Changement de faction/i);
});

test('Conservation des conflits traités dans l’espace Superadmin et persistance en base', () => {
  // 1. Le Super Admin doit voir TOUS les conflits traités dans sa liste
  const visiblesAdmin = depot.visiblesPour(SESSIONS.admin);
  const confA = visiblesAdmin.find((c) => c.id === 'CONF-CAS-A');
  const confB = visiblesAdmin.find((c) => c.id === 'CONF-CAS-B');

  assert.ok(confA, 'Le conflit Cas A traité doit être présent dans la liste du Super Admin');
  assert.equal(confA.statut, 'cloture');
  assert.equal(confA.etat, 'CLOSED');
  assert.ok(confA.traitement, 'Le conflit doit contenir l’objet traitement complet');
  assert.equal(confA.traitement.auteur.matricule, SESSIONS.admin.matricule);

  assert.ok(confB, 'Le conflit Cas B traité doit être présent dans la liste du Super Admin');
  assert.equal(confB.statut, 'traite');
  assert.equal(confB.traitement.auteur.matricule, SESSIONS.reg1.matricule);

  // 2. Relire la base depuis le fichier pour valider la persistance disque
  const depotRecharge = creerDepotSuiviConflits(fichier);
  const recharges = depotRecharge.visiblesPour(SESSIONS.admin);

  const confARecharge = recharges.find((c) => c.id === 'CONF-CAS-A');
  const confBRecharge = recharges.find((c) => c.id === 'CONF-CAS-B');

  assert.equal(confARecharge.etat, 'CLOSED', 'La persistance doit préserver l’état (traitement direct du Superadmin : archivé) après rechargement');
  assert.ok(confARecharge.traitement, 'Archiver ne supprime pas le traitement');
  assert.ok(confARecharge.historique.some((h) => h.vers === 'APPROVED'), 'l’étape d’approbation reste inscrite');
  assert.ok(depotRecharge.historique(SESSIONS.admin).some((c) => c.id === 'CONF-CAS-A'), 'le conflit est lu dans l’historique');
  assert.equal(confBRecharge.etat, 'PENDING_VALIDATION');
  assert.equal(confBRecharge.statut, 'traite', 'La persistance doit préserver le statut traite après rechargement');
  assert.equal(confBRecharge.statutPhysique, 'maintenu_decalage_horaire');
});

test('Résolution complète par déplacement suffisant (distance >= 20 km)', () => {
  const confDeplacement = {
    id: 'CONF-DEP-01',
    numero: 'C-03',
    barrageAId: B_REGULIER_1.id,
    barrageBId: B_REGULIER_3.id,
    distanceKm: 14.0,
    seuilKm: 20,
  };

  const resDeplacement = depot.traiterConflit({
    conflitId: confDeplacement.id,
    session: SESSIONS.admin,
    action: 'deplacement',
    details: {
      barrageId: B_REGULIER_3.id,
      distanceApresKm: 23.5, // >= 20 km
      seuilKm: 20,
      motif: 'Déplacement au PK 45',
      conflitData: confDeplacement,
    },
    depotBarrages,
    depotNotifications,
  });

  assert.equal(resDeplacement.statut, 'cloture');
  assert.equal(resDeplacement.conflit.etat, 'CLOSED');
  assert.equal(resDeplacement.persiste, false, 'Doit être résolu car distance >= seuil');
  assert.equal(resDeplacement.statutPhysique, 'resolu');
});

test('Suppression d’un barrage régulier résout le conflit et protège les BFI', () => {
  const confSuppr = {
    id: 'CONF-SUPPR-01',
    numero: 'C-04',
    barrageAId: B_BFI.id,
    barrageBId: B_REGULIER_1.id,
    distanceKm: 9.0,
    seuilKm: 20,
  };

  // Tenter de supprimer le BFI est rejeté
  assert.throws(
    () => {
      depot.traiterConflit({
        conflitId: confSuppr.id,
        session: SESSIONS.admin,
        action: 'suppression',
        details: {
          barrageId: B_BFI.id,
          conflitData: confSuppr,
        },
        depotBarrages,
        depotNotifications,
      });
    },
    /Un barrage FIXE INTOUCHABLE ne peut pas être supprimé/i
  );

  // Supprimer le barrage régulier est accepté et résout le conflit
  const resSuppr = depot.traiterConflit({
    conflitId: confSuppr.id,
    session: SESSIONS.admin,
    action: 'suppression',
    details: {
      barrageId: B_REGULIER_1.id,
      conflitData: confSuppr,
    },
    depotBarrages,
    depotNotifications,
  });

  assert.equal(resSuppr.statut, 'cloture');
  assert.equal(resSuppr.conflit.etat, 'CLOSED');
  assert.equal(resSuppr.persiste, false);
  assert.equal(resSuppr.statutPhysique, 'resolu');
});

test('Règle BFI vs BF : seul le CMD Région du barrage ordinaire est assignable pour traitement', () => {
  const confBfiVsBf = {
    id: 'CONF-BFI-VS-BF-02',
    numero: 'C-05',
    barrageAId: B_BFI.id,
    barrageBId: B_REGULIER_2.id,
    route: 'RN1',
    distanceKm: 8.5,
    seuilKm: 20,
    regA: 'Rabat',
    regB: 'Rabat',
  };

  // Assignation par Super Admin : même si une mauvaise région est passée, la règle BFI force l'assignation au BF ordinaire
  const resAssign = depot.assignerConflit({
    conflitId: confBfiVsBf.id,
    conflitData: confBfiVsBf,
    session: SESSIONS.admin,
    matricules: ['REG-01'],
    depotBarrages,
    depotNotifications,
    comptes: { tous: () => Object.values(SESSIONS) },
  });

  assert.equal(resAssign.ok, true);
  assert.equal(resAssign.conflit.etat, 'ASSIGNED_REGION');
});

test('Conflit Inter-Régions entre deux BFI : le CMD Région peut déplacer, changer la faction ou rétrograder en BF', () => {
  const confInterBfi = {
    id: 'CONF-INTER-BFI-01',
    numero: 'C-06',
    barrageAId: B_BFI.id, // Rabat
    barrageBId: B_BFI_CASA.id, // Casablanca-Settat
    route: 'A1',
    distanceKm: 14.2,
    seuilKm: 20,
    factionsCommunes: ['F1'],
    barrageA: B_BFI,
    barrageB: B_BFI_CASA,
  };

  // Assigner au CMD Région Rabat
  depot.assignerConflit({
    conflitId: confInterBfi.id,
    conflitData: confInterBfi,
    session: SESSIONS.admin,
    matricules: ['REG-01'],
    depotBarrages,
    depotNotifications,
    comptes: { tous: () => Object.values(SESSIONS) },
  });

  // 1. Changement de faction sur BFI autorisé dans ce cas inter-régions
  const resFaction = depot.traiterConflit({
    conflitId: confInterBfi.id,
    session: SESSIONS.reg1,
    action: 'changement_faction',
    details: {
      barrageId: B_BFI.id,
      nouvelleFactionId: 'F2',
      conflitData: confInterBfi,
    },
    depotBarrages,
    depotNotifications,
  });
  assert.equal(resFaction.ok, true);
  assert.equal(resFaction.conflit.etat, 'PENDING_VALIDATION');
  assert.equal(resFaction.statutPhysique, 'maintenu_decalage_horaire');

  // Rejet par Super Admin pour tester le cycle de rétrogradation
  depot.deciderTraitement({
    conflitId: confInterBfi.id,
    session: SESSIONS.admin,
    decision: 'rejeter',
    raison: 'Tester le mode rétrogradation en BF',
    depotBarrages,
    depotNotifications,
  });

  // 2. Rétrogradation du BFI en BF ordinaire autorisée pour le CMD Région
  const resRetrograde = depot.traiterConflit({
    conflitId: confInterBfi.id,
    session: SESSIONS.reg1,
    action: 'retrograder_bf',
    details: {
      barrageId: B_BFI.id,
      conflitData: confInterBfi,
      justification: 'Résolution par passage en barrage fixe ordinaire.',
    },
    depotBarrages,
    depotNotifications,
  });
  assert.equal(resRetrograde.ok, true);
  assert.equal(resRetrograde.conflit.etat, 'PENDING_VALIDATION');
  assert.equal(resRetrograde.statutPhysique, 'retrograde_bf');

  // 3. Validation par Super Admin : application atomique sur le barrage
  const resValide = depot.deciderTraitement({
    conflitId: confInterBfi.id,
    session: SESSIONS.admin,
    decision: 'valider',
    depotBarrages,
    depotNotifications,
  });
  /* Approuvé : archivé à l'historique, sans clôture manuelle, données intactes. */
  assert.equal(resValide.conflit.etat, 'CLOSED');
  assert.ok(resValide.conflit.clotureLe);
  assert.ok(resValide.conflit.traitement, 'le traitement reste attaché au conflit archivé');
  assert.deepEqual(resValide.conflit.historique.slice(-2).map((h) => h.vers), ['APPROVED', 'CLOSED']);
  assert.ok(depot.historique(SESSIONS.admin).some((c) => c.id === confInterBfi.id));
  assert.equal(resValide.barragesModifies.length, 1);

  const barrageMisAJour = depotBarrages.parId(B_BFI.id);
  assert.equal(barrageMisAJour.type, 'barrage_fixe', 'Le barrage doit maintenant être de type barrage_fixe');
  assert.equal(barrageMisAJour.protection, 'standard', 'La protection doit être passée à standard');
  assert.equal(barrageMisAJour.intouchable, false, 'Le statut intouchable doit être levé');
});

// Nettoyage
test.after(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

