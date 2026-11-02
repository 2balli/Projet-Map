#!/usr/bin/env node
/**
 * Test du cycle complet de navigation, assignation et notification des conflits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const FICHIER_TEST = resolve('./data/test-suivi-conflits-assignation.json');

test('cycle complet : assignation, notification et persistance du conflit', () => {
  if (existsSync(FICHIER_TEST)) unlinkSync(FICHIER_TEST);

  const depot = creerDepotSuiviConflits(FICHIER_TEST);

  const mockAdmin = { matricule: 'SUPERADMIN', nom: 'Super Admin', rang: 'admin', unite: 'admin' };
  const mockCmdRegion = { matricule: 'REG-CASABLANCA', nom: 'Colonel Casablanca', rang: 'reg', unite: 'CASABLANCA' };

  const comptesMock = {
    tous: () => [
      mockAdmin,
      mockCmdRegion,
      { matricule: 'REG-RABAT', nom: 'Colonel Rabat', rang: 'reg', unite: 'RABAT' },
    ],
  };

  const notificationsEmises = [];
  const depotNotificationsMock = {
    publier: (notif) => {
      notificationsEmises.push(notif);
      return notif;
    },
  };

  const instructionsCreees = [];
  const depotInstructionsMock = {
    creer: (ins) => {
      instructionsCreees.push(ins);
      return { id: `ins_${Date.now()}`, ...ins };
    },
  };

  const depotBarragesMock = {
    parId: (id) => ({
      id,
      nom: `Barrage ${id}`,
      route: 'N1',
      reg: 'CASABLANCA',
      cie: 'CIE-CASA',
      lat: 33.5,
      lng: -7.6,
    }),
  };

  // 1. Assigner le conflit C-01 au CMD_REGION Casablanca
  const resultat = depot.assignerConflit({
    conflitId: 'C-01',
    session: mockAdmin,
    matricule: 'REG-CASABLANCA',
    consigne: 'Vérifier espacement sur la N1.',
    conflitData: {
      numero: 'C-01',
      barrageAId: 'BF-01',
      barrageBId: 'BF-02',
      distanceKm: 14.2,
      seuilKm: 20,
      route: 'N1',
      motif: 'Distance de 14.2 km inférieure au seuil réglementaire de 20 km',
    },
    depotBarrages: depotBarragesMock,
    depotInstructions: depotInstructionsMock,
    depotNotifications: depotNotificationsMock,
    comptes: comptesMock,
  });

  assert.equal(resultat.conflit.numero, 'C-01');
  assert.equal(resultat.conflit.statut, 'a_traiter');
  assert.equal(resultat.conflit.assigneA.matricule, 'REG-CASABLANCA');
  assert.equal(resultat.conflit.assigneA.unite, 'CASABLANCA');
  assert.ok(resultat.conflit.assigneLe);

  // Vérifier la création de notification pour CMD_REGION
  assert.equal(notificationsEmises.length, 1);
  const notif = notificationsEmises[0];
  assert.equal(notif.details.conflitNumero, 'C-01');
  assert.equal(notif.details.destinataire.matricule, 'REG-CASABLANCA');
  assert.equal(notif.details.distanceKm, 14.2);
  assert.ok(notif.details.motif);

  // Vérifier la création de l'instruction
  assert.equal(instructionsCreees.length, 1);
  assert.equal(instructionsCreees[0].criteres.conflitNumero, 'C-01');

  // 2. Éviter notification en double lors d'une assignation inchangée
  const resultatDoublon = depot.assignerConflit({
    conflitId: 'C-01',
    session: mockAdmin,
    matricule: 'REG-CASABLANCA',
    consigne: 'Même consigne',
    depotBarrages: depotBarragesMock,
    depotInstructions: depotInstructionsMock,
    depotNotifications: depotNotificationsMock,
    comptes: comptesMock,
  });

  assert.equal(resultatDoublon.conflit.statut, 'a_traiter');
  // La liste des notifications ne doit pas avoir augmenté
  assert.equal(notificationsEmises.length, 1, 'Pas de notification en double pour assignation inchangée');

  // 3. Recharger depuis le fichier pour valider la persistance
  const depotRecharge = creerDepotSuiviConflits(FICHIER_TEST);
  const confPersiste = depotRecharge.parId(resultat.conflit.id);
  assert.ok(confPersiste);
  assert.equal(confPersiste.numero, 'C-01');
  assert.equal(confPersiste.assigneA.unite, 'CASABLANCA');
  assert.equal(confPersiste.statut, 'a_traiter');
  assert.equal(confPersiste.historique.length, 3); // détection + 2 assignations tracées au journal

  // Nettoyage
  if (existsSync(FICHIER_TEST)) unlinkSync(FICHIER_TEST);
});
