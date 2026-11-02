/**
 * ÉPREUVE DE L'ÉTAT DES CONFLITS — définition partagée panneau / carte.
 *
 *   npm run check:etat-conflits
 *
 * Le tracé rouge « après déplacement » n'est dessiné que pour une paire en
 * conflit ACTIF du panneau (voir src/etatConflits.js). Cas d'origine : Poste
 * fixe Témara déplacé, à 19,2 km par la route du BFI Ain Aouda — la mesure
 * signalait un conflit, le panneau n'en listait aucun, et le trait restait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estConflitTraite, estConflitAssigne, estConflitNonAssigne, estPaireSupprimee, pairesConflitActives,
} from '../src/etatConflits.js';
import { clePaire } from '../src/conflitsIdentifies.js';

const TEMARA = 'BF-BT-463';
const AIN_AOUDA = 'BFI-CIE-002';
const cle = clePaire(TEMARA, AIN_AOUDA);

test('les trois états restent exclusifs', () => {
  const cas = [
    { statut: 'nouveau' },
    { statut: 'en_cours', assigneA: { nom: 'CMND' } },
    { statut: 'traite' },
    { approbation: { statut: 'approuve' } },
    { statut: 'a_traiter', traiteLe: '2026-10-24' },
  ];
  for (const c of cas) {
    const n = [estConflitTraite(c), estConflitAssigne(c), estConflitNonAssigne(c)].filter(Boolean).length;
    assert.equal(n, 1, JSON.stringify(c));
  }
});

test('cas d’origine : paire absente du panneau ➔ aucun tracé', () => {
  assert.equal(pairesConflitActives({ serveur: [], detectes: [null, null] }).has(cle), false);
});

test('paire enregistrée non traitée ➔ tracé', () => {
  const serveur = [{ id: 'C-9', barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'nouveau' }];
  assert.ok(pairesConflitActives({ serveur }).has(cle));
  const assigne = [{ id: 'x', barrageA: { id: AIN_AOUDA }, barrageB: { id: TEMARA }, statut: 'en_cours' }];
  assert.ok(pairesConflitActives({ serveur: assigne }).has(cle), 'ordre des postes indifférent');
});

test('paire traitée ➔ plus de tracé, même redétectée par l’optimisation', () => {
  const serveur = [{ id: 'C-9', barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'traite' }];
  const detectes = [[{ barrageAId: TEMARA, barrageBId: AIN_AOUDA }]];
  assert.equal(pairesConflitActives({ serveur, detectes }).has(cle), false);
});

test('workflow : refusé ➔ actif ; en validation ou clos ➔ pas actif', () => {
  const avec = (etat) => [{ id: 'w', barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'traite', workflow: { etat } }];
  assert.ok(pairesConflitActives({ serveur: avec('REFUSE_CMD_REGION') }).has(cle), 'renvoyé pour correction : de nouveau à traiter');
  assert.ok(pairesConflitActives({ serveur: avec('REFUSE_SUPERADMIN') }).has(cle));
  assert.equal(pairesConflitActives({ serveur: avec('EN_ATTENTE_CMD_REGION') }).has(cle), false);
  assert.equal(pairesConflitActives({ serveur: avec('EN_ATTENTE_SUPERADMIN') }).has(cle), false);
  /* États du workflow actuel. */
  assert.ok(pairesConflitActives({ serveur: avec('REJECTED') }).has(cle), 'rejeté : de nouveau à traiter');
  assert.ok(pairesConflitActives({ serveur: avec('IN_PROGRESS_CIE') }).has(cle));
  for (const e of ['PENDING_VALIDATION', 'APPROVED', 'FOLLOW_UP', 'CLOSED']) assert.equal(pairesConflitActives({ serveur: avec(e) }).has(cle), false, e);
  /* Sans workflow (objet ancien) : « à corriger » reste actif. */
  assert.ok(pairesConflitActives({ serveur: [{ barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'a_corriger', approbation: { statut: 'rejete_reg' } }] }).has(cle));
});

test('paire close (historique) redétectée par l’optimisation ➔ pas de tracé', () => {
  const detectes = [[{ barrageAId: TEMARA, barrageBId: AIN_AOUDA }]];
  assert.equal(pairesConflitActives({ detectes, clos: new Set([cle]) }).has(cle), false);
  /* Un conflit actif rouvert depuis l'emporte sur la clôture. */
  const serveur = [{ id: 'nouveau', barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'nouveau' }];
  assert.ok(pairesConflitActives({ serveur, detectes, clos: new Set([cle]) }).has(cle));
});

test('paire détectée seulement (optimisation ou filtration) ➔ tracé', () => {
  assert.ok(pairesConflitActives({ detectes: [[{ a: { id: TEMARA }, b: { id: AIN_AOUDA } }]] }).has(cle));
  assert.ok(pairesConflitActives({ detectes: [null, [{ barrageAId: TEMARA, barrageBId: AIN_AOUDA }]] }).has(cle));
});

test('paire supprimée, sous toutes ses formes de clé ➔ plus de tracé', () => {
  const serveur = [{ id: 'conf-abc', barrageAId: TEMARA, barrageBId: AIN_AOUDA, statut: 'nouveau' }];
  for (const k of [cle, `conf_calc_${cle}`, `${TEMARA}::${AIN_AOUDA}`, `${AIN_AOUDA}::${TEMARA}`, 'conf-abc']) {
    assert.equal(pairesConflitActives({ serveur, supprimes: new Set([k]) }).has(cle), false, k);
  }
  /* « C-12 » est un numéro d'affichage, jamais une clé de suppression. */
  assert.equal(estPaireSupprimee(new Set(['C-9']), TEMARA, AIN_AOUDA, 'C-9'), false);
});
