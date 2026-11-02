#!/usr/bin/env node
/**
 * LE BOUTON « ACCEPTER / REFUSER » NE S'OFFRE QU'À QUI PEUT VRAIMENT TRANCHER.
 *
 * La liste de l'Optimisation propose la décision sur place, sur un retrait
 * proposé. Le danger n'est pas qu'un compte non autorisé passe : le serveur
 * refuse (403, voir les gardes du PATCH /api/instructions/:id et la section 18
 * de verifier-securite.mjs). Le danger est qu'on lui MONTRE un bouton qui ne
 * mène qu'à un refus — un chef de brigade qui clique « Accepter » et reçoit
 * une erreur conclura que l'application est cassée, pas qu'il n'avait pas la
 * main.
 *
 * Ces épreuves fixent donc l'affichage sur les gardes du serveur, une à une,
 * pour que les deux ne divergent pas au fil des retouches.
 *
 *   node --test scripts/verifier-decision.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { peutTrancher, retraitATrancher } from '../src/instructionsRegles.js';

/** Une demande de retrait, à la forme exacte du serveur. */
const demande = (extra = {}) => ({
  id: 'i1',
  barrageId: 'b1',
  action: 'suppression',
  statut: 'ouverte',
  decision: null,
  aDecider: 'admin',
  auteur: { matricule: 'CIE-01' },
  cree: '2026-01-02T10:00:00.000Z',
  ...extra,
});

const compte = (rang, matricule) => ({ rang, matricule });

test('une demande ouverte adressée à l’administration se tranche par l’administrateur', () => {
  assert.equal(peutTrancher(demande(), compte('admin', 'ADM-01')), true);
});

test('une demande déjà tranchée ne se rejoue pas', () => {
  assert.equal(
    peutTrancher(demande({ statut: 'traitee', decision: 'acceptee' }), compte('admin', 'ADM-01')),
    false,
  );
});

test('nul ne contresigne sa propre demande', () => {
  /* Le serveur répond 403 : « vous êtes l'auteur de cette demande ». */
  assert.equal(
    peutTrancher(demande({ auteur: { matricule: 'ADM-01' } }), compte('admin', 'ADM-01')),
    false,
  );
});

test('une demande adressée à l’administration n’est pas tranchée par un commandement', () => {
  for (const rang of ['reg', 'cie', 'unite']) {
    assert.equal(peutTrancher(demande(), compte(rang, 'X-01')), false, `rang ${rang}`);
  }
});

test('une demande adressée au commandement échappe au chef de brigade', () => {
  /* `aDecider: 'unite'` désigne la région ou la compagnie — jamais la brigade. */
  const n = demande({ aDecider: 'unite', auteur: { matricule: 'ADM-01' } });
  assert.equal(peutTrancher(n, compte('unite', 'BT-01')), false);
  assert.equal(peutTrancher(n, compte('reg', 'REG-01')), true);
  assert.equal(peutTrancher(n, compte('cie', 'CIE-01')), true);
});

test('une réclamation ne se tranche pas d’un clic', () => {
  /* Elle ouvre un dossier que l'administration instruit ; la faire disparaître
     d'un bouton reviendrait à la traiter sans y répondre. */
  assert.equal(
    peutTrancher(demande({ action: 'reclamation' }), compte('admin', 'ADM-01')),
    false,
  );
});

test('sans session, aucun bouton', () => {
  assert.equal(peutTrancher(demande(), null), false);
  assert.equal(peutTrancher(null, compte('admin', 'ADM-01')), false);
});

test('seul un RETRAIT ouvert sur CE poste remonte dans la ligne', () => {
  const dossier = [
    demande({ id: 'i1', action: 'conservation' }),
    demande({ id: 'i2', barrageId: 'b2' }),
    demande({ id: 'i3', statut: 'traitee' }),
    demande({ id: 'i4' }),
  ];
  const trouve = retraitATrancher(dossier, 'b1', compte('admin', 'ADM-01'));
  assert.equal(trouve?.id, 'i4');
});

test('entre deux propositions, c’est la plus récente qui vaut', () => {
  const dossier = [
    demande({ id: 'ancienne', cree: '2026-01-01T08:00:00.000Z' }),
    demande({ id: 'recente', cree: '2026-03-01T08:00:00.000Z' }),
  ];
  assert.equal(retraitATrancher(dossier, 'b1', compte('admin', 'ADM-01'))?.id, 'recente');
});

test('aucun dossier, aucun poste : rien à trancher, et rien qui casse', () => {
  assert.equal(retraitATrancher(undefined, 'b1', compte('admin', 'ADM-01')), null);
  assert.equal(retraitATrancher([demande()], null, compte('admin', 'ADM-01')), null);
});
