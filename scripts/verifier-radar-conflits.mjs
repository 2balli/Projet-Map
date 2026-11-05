/**
 * ÉPREUVE DE LA DÉTECTION « NOUVEAU CONFLIT » — ce qui déclenche l'impulsion radar.
 *
 *   npm run check:radar
 *
 * Sur des conflits issus des données de démonstration (jeu d’essai fixe :
 * scripts/fixtures/suivi-conflits-anciens.json).
 * L'épreuve de bout en bout — une vraie opération par l'API, qui fait détecter
 * un vrai conflit au serveur — est `npm run check:radar:api`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  creerDetecteur, signatureDetection, dateDetection, positionConflit, estActif, typeConflit, MAX_IMPULSIONS,
  phaseConflit, PHASES,
} from '../src/detectionConflits.js';

/* Jeu d'essai FIXE (copie des données de démonstration, voir fixtures/) : un
   reset des conflits peut vider les données vivantes. */
const reels = JSON.parse(readFileSync(new URL('./fixtures/suivi-conflits-anciens.json', import.meta.url), 'utf8')).items;
const actifs = reels.filter(estActif);
const copie = (c, modifs = {}) => ({ ...structuredClone(c), ...modifs });

test('les données réelles contiennent des conflits actifs situés', () => {
  assert.ok(actifs.length >= 5, `${actifs.length} conflits actifs`);
  assert.ok(actifs.every((c) => positionConflit(c)), 'chaque conflit actif a une position');
});

test('ouverture de page : la première liste sert de référence, rien n’est animé', () => {
  const d = creerDetecteur();
  assert.deepEqual(d.observer(reels), { nouveaux: [], animes: [] });
  assert.ok(d.estAmorce());
});

test('relectures, rendus, changements de thème : la même liste n’annonce rien', () => {
  const d = creerDetecteur();
  d.observer(reels);
  for (let i = 0; i < 5; i++) assert.equal(d.observer(structuredClone(reels)).nouveaux.length, 0);
});

test('un conflit jamais vu est annoncé UNE fois, et animé', () => {
  const d = creerDetecteur();
  d.observer(reels.slice(1));
  const r = d.observer(reels.filter(estActif).concat(reels.slice(1)));
  const attendu = actifs.find((c) => !reels.slice(1).includes(c));
  if (attendu) {
    assert.ok(r.nouveaux.some((c) => c.id === attendu.id));
    assert.equal(d.observer(reels).nouveaux.length, 0, 'déjà annoncé');
  }
  const neuf = copie(actifs[0], { id: 'conf_neuf', cree: '2026-10-29T12:00:00Z', historique: [{ action: 'detection', date: '2026-10-29T12:00:00Z' }] });
  const r2 = d.observer([...reels, neuf]);
  assert.deepEqual(r2.nouveaux.map((c) => c.id), ['conf_neuf']);
  assert.deepEqual(r2.animes.map((c) => c.id), ['conf_neuf']);
  assert.equal(d.observer([...reels, neuf]).nouveaux.length, 0, 'dédupliqué par identifiant + version');
});

test('un conflit qui RÉAPPARAÎT (nouvelle détection) est annoncé de nouveau', () => {
  const d = creerDetecteur();
  d.observer(reels);
  const c = actifs[0];
  const rouvert = copie(c, { historique: [...(c.historique ?? []), { action: 'reouverture', date: '2026-10-29T13:00:00Z' }] });
  assert.notEqual(signatureDetection(rouvert), signatureDetection(c));
  assert.equal(dateDetection(rouvert), '2026-10-29T13:00:00Z');
  const r = d.observer(reels.map((x) => (x.id === c.id ? rouvert : x)));
  assert.deepEqual(r.nouveaux.map((x) => x.id), [c.id]);
  /* Une simple mise à jour (assignation, nouvelle distance) n'est pas une détection. */
  const assigne = copie(rouvert, { historique: [...rouvert.historique, { action: 'assignation_region', date: '2026-10-29T14:00:00Z' }], distanceKm: 3 });
  assert.equal(d.observer(reels.map((x) => (x.id === c.id ? assigne : x))).nouveaux.length, 0);
});

test('soumis, clos ou résolu : jamais d’impulsion', () => {
  const d = creerDetecteur();
  d.observer([]);
  const base = { barrageA: actifs[0].barrageA, barrageB: actifs[0].barrageB, cree: '2026-10-29T15:00:00Z' };
  const r = d.observer([
    { ...base, id: 'x1', statut: 'traite', approbation: { statut: 'en_attente_reg' } },
    { ...base, id: 'x2', statut: 'cloture', approbation: { statut: 'approuve' } },
    { ...base, id: 'x3', statut: 'resolu' },
    { ...base, id: 'x4', statut: 'nouveau' },
  ]);
  assert.deepEqual(r.nouveaux.map((c) => c.id), ['x4']);
});

test('coordonnées absentes : annoncé, mais jamais animé sur la carte', () => {
  const d = creerDetecteur();
  d.observer([]);
  const r = d.observer([{ id: 'sans_position', statut: 'nouveau', cree: '2026-10-29T16:00:00Z', barrageA: { id: 'A' }, barrageB: { id: 'B', lat: null } }]);
  assert.equal(r.nouveaux.length, 1);
  assert.equal(r.animes.length, 0);
  assert.equal(positionConflit(r.nouveaux[0]), null);
  /* Un seul poste situé : ce poste. */
  assert.deepEqual(positionConflit({ barrageA: { lat: 34, lng: -6.8 }, barrageB: { id: 'B' } }).centre, [34, -6.8]);
});

test('beaucoup de conflits d’un coup : au plus trois impulsions, les plus récentes', () => {
  const d = creerDetecteur();
  d.observer([]);
  const lot = Array.from({ length: 12 }, (_, i) =>
    copie(actifs[i % actifs.length], { id: `lot_${i}`, cree: `2026-10-29T17:${String(i).padStart(2, '0')}:00Z`, historique: [] }));
  const r = d.observer(lot);
  assert.equal(r.nouveaux.length, 12);
  assert.equal(r.animes.length, MAX_IMPULSIONS);
  assert.deepEqual(r.animes.map((c) => c.id), ['lot_11', 'lot_10', 'lot_9']);
});

test('la zone contient les deux postes ; le type est lisible', () => {
  for (const c of actifs) {
    const p = positionConflit(c);
    const [lat, lng] = p.centre;
    for (const [plat, plng] of p.postes) {
      const dLat = (plat - lat) * 111_320;
      const dLng = (plng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
      assert.ok(Math.hypot(dLat, dLng) < p.rayonM, `${c.numero} : poste hors de la zone`);
    }
  }
  assert.equal(typeConflit({ type: 'distance_insuffisante' }), 'Espacement insuffisant');
});

test('état du repère : lu sur le workflow réel, sans rien inventer', () => {
  const parEtat = (filtre) => reels.find(filtre);
  /* Les quatre familles présentes dans les données réelles. */
  const assigne = parEtat((c) => c.statut === 'a_traiter' && !c.approbation);
  const soumis = parEtat((c) => c.approbation?.statut === 'en_attente_reg') || copie(assigne, { approbation: { statut: 'en_attente_reg' }, workflow: { etat: 'PENDING_VALIDATION' } });
  const approuve = parEtat((c) => c.approbation?.statut === 'approuve');
  const clos = parEtat((c) => c.statut === 'cloture');
  assert.ok(assigne && soumis && approuve && clos, 'données réelles incomplètes');
  assert.equal(phaseConflit(assigne), PHASES.EN_ATTENTE, 'assigné → ambre');
  assert.equal(phaseConflit(soumis), PHASES.TRAITE, 'soumis à validation → neutre');
  assert.equal(phaseConflit(approuve), null, 'approuvé → plus de repère');
  assert.equal(phaseConflit(clos), null, 'clos → plus de repère');

  /* Le même conflit réel, aux autres étapes du workflow. */
  const neuf = copie(assigne, { statut: 'nouveau', assigneA: null, assigneCie: null, assignesA: [] });
  assert.equal(phaseConflit(neuf), PHASES.NOUVEAU, 'nouveau, non assigné → rouge');
  assert.equal(phaseConflit(neuf, { pris: true }), PHASES.EN_ATTENTE, 'consulté → la pulsation s’arrête');
  assert.equal(phaseConflit(copie(assigne, { statut: 'en_cours' })), PHASES.EN_TRAITEMENT, 'en cours → bleu');
  assert.equal(phaseConflit(copie(assigne, { workflow: { etat: 'REJECTED' } })), PHASES.EN_ATTENTE, 'rejeté, à corriger → ambre');
  assert.equal(phaseConflit(copie(assigne, { workflow: { etat: 'IN_PROGRESS_CIE' } })), PHASES.EN_TRAITEMENT, 'en traitement → bleu');
  assert.equal(phaseConflit(copie(assigne, { workflow: { etat: 'PENDING_VALIDATION' } })), PHASES.TRAITE, 'à valider → neutre');
  assert.equal(phaseConflit(copie(assigne, { workflow: { etat: 'FOLLOW_UP' } })), null, 'validé, en suivi → plus de repère');
  assert.equal(phaseConflit(copie(assigne, { workflow: { etat: 'CLOSED' } })), null);
  assert.equal(phaseConflit(copie(neuf, { workflow: { etat: 'NEW' } })), PHASES.NOUVEAU);
});

test('l’état du repère ne modifie jamais le conflit', () => {
  const avant = structuredClone(reels);
  for (const c of reels) {
    phaseConflit(c);
    phaseConflit(c, { pris: true });
  }
  assert.deepEqual(reels, avant);
});
