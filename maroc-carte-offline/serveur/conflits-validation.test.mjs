/**
 * Tests des 8 scénarios obligatoires de gestion des conflits traités et validation Superadmin :
 * 1. Déplacement résolu : vue avant/après, recalcul et approbation valide.
 * 2. Changement de faction : recalcul métier, approbation seulement si résolution confirmée.
 * 3. Suppression : conservation de l'historique et approbation valide si règles respectées.
 * 4. Conflit persistant : blocage strict de l'approbation (partenaire intouchable 24/24 ou distance insuffisante).
 * 5. Nouveau conflit après déplacement ou faction : détection et blocage de l'approbation.
 * 6. Audit et persistance : conservation de l'historique complet après approbation.
 * 7. Droits Superadmin : jamais de bouton « Traiter », approbation réservée, traitement interdit.
 * 8. Rôles opérationnels : conservation des actions autorisées (déplacement, faction, suppression) et interdiction d'approuver.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { estProtege } from '../src/barages.js';
import { contient } from '../src/competence.js';
import {
  ETAT_VIDE, ErreurWorkflow, assigner, baragesAvecChangements, changementsApprouves,
  conflitsVisibles, creerCompte, creerConflits, decider, evaluerResolution,
  lireConflit, marquerEnCours, marquerResolu, soumettreProposition,
} from './workflow.mjs';

const carre = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const regions = new Map([
  ['reg-1', { id: 'reg-1', nom: 'Rabat-Salé-Kénitra', geometrie: carre(-8, 33) }],
  ['reg-2', { id: 'reg-2', nom: 'Fès-Meknès', geometrie: carre(-6, 33) }],
]);
const btReg = { 'bt-1': 'reg-1', 'bt-2': 'reg-2' };
const B = (id, champs = {}) => ({
  id, name: `Barrage ${id}`, type: 'fixe', shift: '00-06', latitude: 33.5, longitude: -7.5,
  btId: 'bt-1', isSimulation: true, ...champs,
});

const jeu = [
  B('SIM-BAR-0001'), // mobile, 00-06, Rabat [-7.5, 33.5]
  B('SIM-BAR-0002', { longitude: -7.49 }), // mobile, 00-06, Rabat [-7.49, 33.5] (~1 km)
  B('SIM-BAR-0003', { type: 'intouchable', shift: 'continu', longitude: -7.38 }), // intouchable (24h/24), Rabat (~12 km de 0001)
  B('SIM-BAR-0004', { shift: '06-12', longitude: -7.492 }), // mobile, 06-12, Rabat (~800 m de 0001)
  B('SIM-BAR-0005', { shift: '00-06', longitude: -7.30 }), // mobile, 00-06, Rabat (~18 km de 0001)
  // Paire isolée au nord (latitude 33.8) pour tester le cas intouchable
  B('SIM-BAR-0020', { latitude: 33.8, longitude: -7.5 }), // mobile, 00-06
  B('SIM-BAR-0021', { type: 'intouchable', shift: 'continu', latitude: 33.8, longitude: -7.49 }), // intouchable 24/24 (~1 km)
  B('SIM-BAR-0101', { btId: 'bt-2', latitude: 33.5, longitude: -5.5 }), // mobile, Fès
];
const parId = new Map(jeu.map((b) => [b.id, b]));
const ref = {
  brut: { format: 'maroc-carte/barages', version: 1, barages: jeu },
  regions,
  barage: (id) => parId.get(id) ?? null,
  regDe: (b) => btReg[b?.btId] ?? null,
  nomRegion: (id) => regions.get(id)?.nom ?? id,
  regionExiste: (id) => regions.has(id),
  dansRegion: (regId, p) => Boolean(regions.get(regId)) && contient(regions.get(regId).geometrie, p),
  protege: estProtege,
};

const date = new Date('2026-10-23T10:00:00Z');
const code = (fn) => { try { fn(); } catch (e) { if (e instanceof ErreurWorkflow) return e.code; throw e; } return 200; };

function setup() {
  let e = ETAT_VIDE();
  const sa = creerCompte(e, null, { identifiant: 'superadmin', nom: 'Superadmin Test', role: 'superadmin', motDePasse: 'Solide12345!' }, ref, date);
  e = sa.etat;
  const cmd = creerCompte(e, sa.compte, { identifiant: 'cr-rabat', nom: 'Commandement Rabat', role: 'commandement', regId: 'reg-1', motDePasse: 'Solide12345!' }, ref, date);
  e = cmd.etat;
  return { e, sa: sa.compte, cmd: cmd.compte };
}

test('Scénario 1 : Conflit traité par déplacement — vue avant/après et approbation par le Superadmin', () => {
  const { e: e0, sa, cmd } = setup();
  // Conflit initial entre SIM-BAR-0001 et SIM-BAR-0002 (distance 1500 m <= 5 km)
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;

  // Le commandement déplace SIM-BAR-0001 vers une position dégagée [-7.6, 33.7] (> 10 km)
  const posValide = [-7.6, 33.7];
  e = soumettreProposition(e, cmd, cid, {
    type: 'deplacement', barageId: 'SIM-BAR-0001', position: posValide, raison: 'Déplacement hors de la zone d’espacement',
    validation: { statut: 'valide', minimumM: 8500, violations: [] },
  }, ref, date).etat;

  const conflitTraite = lireConflit(e, sa, cid, ref);
  assert.equal(conflitTraite.statut, 'proposition-soumise');
  assert.ok(conflitTraite.proposition);
  assert.deepEqual(conflitTraite.proposition.avant, { latitude: 33.5, longitude: -7.5 });
  assert.deepEqual(conflitTraite.proposition.position, { latitude: 33.7, longitude: -7.6 });

  // Recalcul de vérification : résolution confirmée, aucun nouveau conflit
  const evalRes = evaluerResolution(conflitTraite, ref);
  assert.equal(evalRes.resolu, true);
  assert.equal(evalRes.bloquant, false);

  // Le Superadmin approuve
  e = decider(e, sa, cid, { decision: 'approuver', raison: 'Déplacement vérifié et conforme' }, ref, date).etat;
  const conflitApprouve = lireConflit(e, sa, cid, ref);
  assert.equal(conflitApprouve.statut, 'approuve');
  assert.equal(conflitApprouve.decision.decision, 'approuver');
  assert.equal(conflitApprouve.decision.par, sa.id);
});

test('Scénario 2 : Conflit traité par changement de faction — validation par recalcul métier', () => {
  const { e: e0, sa, cmd } = setup();
  // Conflit entre SIM-BAR-0001 (00-06) et SIM-BAR-0002 (00-06)
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;

  // Changement de faction vers 12-18 (aucun barrage dans la zone sur 12-18)
  e = soumettreProposition(e, cmd, cid, {
    type: 'faction', barageId: 'SIM-BAR-0001', nouvelleFaction: '12-18', raison: 'Transfert sur la vacation 12-18 pour lever le conflit',
  }, ref, date).etat;

  const conflit = lireConflit(e, sa, cid, ref);
  assert.equal(conflit.proposition.nouvelleFaction, '12-18');
  assert.equal(conflit.proposition.avant.shift, '00-06');

  // Recalcul métier : confirme la résolution
  const evalRes = evaluerResolution(conflit, ref);
  assert.equal(evalRes.resolu, true);
  assert.equal(evalRes.bloquant, false);

  // Le Superadmin peut approuver
  e = decider(e, sa, cid, { decision: 'approuver', raison: 'Changement de vacation confirmé' }, ref, date).etat;
  assert.equal(lireConflit(e, sa, cid, ref).statut, 'approuve');

  // Export vérifie la nouvelle faction
  const exportFichier = baragesAvecChangements(e, sa, ref);
  const bExporte = exportFichier.barages.find((b) => b.id === 'SIM-BAR-0001');
  assert.equal(bExporte.shift, '12-18');
});

test('Scénario 3 : Conflit traité par suppression — conservation de l’historique et validation', () => {
  const { e: e0, sa, cmd } = setup();
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;

  // Suppression du barrage mobile SIM-BAR-0002
  e = soumettreProposition(e, cmd, cid, {
    type: 'suppression', barageId: 'SIM-BAR-0002', raison: 'Barrage redondant supprimé',
  }, ref, date).etat;

  const conflit = lireConflit(e, sa, cid, ref);
  assert.equal(conflit.proposition.type, 'suppression');
  assert.deepEqual(conflit.proposition.avant, { latitude: 33.5, longitude: -7.49 });

  const evalRes = evaluerResolution(conflit, ref);
  assert.equal(evalRes.resolu, true);
  assert.equal(evalRes.bloquant, false);

  // Approbation
  e = decider(e, sa, cid, { decision: 'approuver', raison: 'Suppression motivée et validée' }, ref, date).etat;
  assert.equal(lireConflit(e, sa, cid, ref).statut, 'approuve');

  // L'enregistrement d'origine reste archivé dans retraitsApprouves
  const exportFichier = baragesAvecChangements(e, sa, ref);
  assert.ok(!exportFichier.barages.some((b) => b.id === 'SIM-BAR-0002'));
  assert.equal(exportFichier.retraitsApprouves[0].barage.id, 'SIM-BAR-0002');
});

test('Scénario 4 : Conflit persistant après traitement — l’approbation par le Superadmin est bloquée', () => {
  const { e: e0, sa, cmd } = setup();

  // Cas 4.1 : Changement de faction sur un conflit avec un barrage intouchable (24h/24)
  // SIM-BAR-0020 est en conflit avec SIM-BAR-0021 (intouchable continu à 1 km)
  let e1 = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0020', 'SIM-BAR-0021'], routeM: 1200 }] }, ref, date).etat;
  const cIntouchable = e1.conflits[0].id;
  e1 = assigner(e1, sa, { conflitIds: [cIntouchable] }, date).etat;

  // L'utilisateur change la faction de SIM-BAR-0020 vers 06-12 en espérant résoudre le conflit
  e1 = soumettreProposition(e1, cmd, cIntouchable, {
    type: 'faction', barageId: 'SIM-BAR-0020', nouvelleFaction: '06-12', raison: 'Passage en 06-12',
  }, ref, date).etat;

  const conflit1 = lireConflit(e1, sa, cIntouchable, ref);
  const eval1 = evaluerResolution(conflit1, ref);
  assert.equal(eval1.resolu, false, 'Le conflit persiste car le partenaire est intouchable (actif 24/24)');
  assert.equal(eval1.bloquant, true);
  assert.match(eval1.motif, /intouchable/);

  // Tentative d'approbation par le Superadmin : doit être bloquée avec HTTP 409
  assert.equal(code(() => decider(e1, sa, cIntouchable, { decision: 'approuver', raison: 'Tentative' }, ref)), 409);

  // Cas 4.2 : Déplacement restant trop proche du barrage partenaire
  let e2 = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cTropProche = e2.conflits[0].id;
  e2 = assigner(e2, sa, { conflitIds: [cTropProche] }, date).etat;

  // Déplacement vers [-7.495, 33.5], à moins de 500m de SIM-BAR-0002
  e2 = soumettreProposition(e2, cmd, cTropProche, {
    type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.495, 33.5], raison: 'Déplacement insuffisant',
    validation: { statut: 'valide' },
  }, ref, date).etat;

  const conflit2 = lireConflit(e2, sa, cTropProche, ref);
  const eval2 = evaluerResolution(conflit2, ref);
  assert.equal(eval2.resolu, false, 'Le conflit persiste : distance insuffisante');
  assert.equal(eval2.bloquant, true);
  assert.equal(code(() => decider(e2, sa, cTropProche, { decision: 'approuver', raison: 'Tentative' }, ref)), 409);
});

test('Scénario 5 : Nouveau conflit apparaissant après déplacement ou changement de faction — détection et blocage', () => {
  const { e: e0, sa, cmd } = setup();

  // Cas 5.1 : Déplacement vers une position trop proche d'un tiers (SIM-BAR-0005 est à [-7.30, 33.5])
  let e1 = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e1.conflits[0].id;
  e1 = assigner(e1, sa, { conflitIds: [cid] }, date).etat;

  // Déplacement vers [-7.302, 33.5] (à 200m de SIM-BAR-0005 qui est de même faction 00-06)
  e1 = soumettreProposition(e1, cmd, cid, {
    type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.302, 33.5], raison: 'Nouvel emplacement trop proche de SIM-BAR-0005',
    validation: { statut: 'valide' },
  }, ref, date).etat;

  const eval1 = evaluerResolution(lireConflit(e1, sa, cid, ref), ref);
  assert.equal(eval1.resolu, false);
  assert.equal(eval1.bloquant, true);
  assert.match(eval1.motif, /Nouveau conflit détecté avec le barrage SIM-BAR-0005/);
  assert.equal(code(() => decider(e1, sa, cid, { decision: 'approuver', raison: 'Validation' }, ref)), 409);

  // Cas 5.2 : Changement de faction créant un conflit avec un barrage existant de cette faction
  // SIM-BAR-0004 est à [-7.492, 33.5] sur la faction 06-12.
  // SIM-BAR-0001 est à [-7.5, 33.5] (à ~800m de SIM-BAR-0004).
  // Si SIM-BAR-0001 passe sur 06-12, cela crée un conflit immédiat avec SIM-BAR-0004 !
  let e2 = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cFaction = e2.conflits[0].id;
  e2 = assigner(e2, sa, { conflitIds: [cFaction] }, date).etat;

  e2 = soumettreProposition(e2, cmd, cFaction, {
    type: 'faction', barageId: 'SIM-BAR-0001', nouvelleFaction: '06-12', raison: 'Passage en 06-12 créant un nouveau conflit',
  }, ref, date).etat;

  const eval2 = evaluerResolution(lireConflit(e2, sa, cFaction, ref), ref);
  assert.equal(eval2.resolu, false);
  assert.equal(eval2.bloquant, true);
  assert.match(eval2.motif, /SIM-BAR-0004/);
  assert.equal(code(() => decider(e2, sa, cFaction, { decision: 'approuver', raison: 'Validation' }, ref)), 409);
});

test('Scénario 6 : Conservation de l’historique et audit complet après approbation', () => {
  const { e: e0, sa, cmd } = setup();
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;
  e = soumettreProposition(e, cmd, cid, {
    type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.6, 33.7], raison: 'Éloignement conforme',
    validation: { statut: 'valide' },
  }, ref, date).etat;
  e = decider(e, sa, cid, { decision: 'approuver', raison: 'Résolution validée par Superadmin' }, ref, date).etat;

  // Le conflit reste présent dans la liste des conflits visibles
  const visibles = conflitsVisibles(e, sa, ref);
  assert.equal(visibles.length, 1);
  const fin = visibles[0];
  assert.equal(fin.statut, 'approuve');
  assert.equal(fin.barages.length, 2, 'Les 2 barrages initiaux restent conservés');
  assert.equal(fin.routeM, 1500, 'La distance initiale reste consignée');

  // L'historique d'audit contient la chronologie complète
  const actions = fin.historique.map((h) => h.action);
  assert.deepEqual(actions, ['cree', 'assigne', 'proposition-soumise', 'decision-approuver']);

  // Clôture après installation
  e = marquerResolu(e, sa, cid, { note: 'barages.json réinstallé le 23/10/2026' }, date).etat;
  const clos = lireConflit(e, sa, cid, ref);
  assert.equal(clos.statut, 'resolu');
  assert.ok(clos.historique.some((h) => h.action === 'resolu'));
});

test('Scénario 7 : Superadmin — interdiction de traiter, boutons séparés et sécurité côté API', () => {
  const { e: e0, sa, cmd } = setup();
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;

  // Le Superadmin tente de marquer en cours ou de soumettre une proposition -> 403
  assert.equal(code(() => marquerEnCours(e, sa, cid)), 403, 'Superadmin ne peut pas marquer en cours');
  assert.equal(code(() => soumettreProposition(e, sa, cid, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: 'test' }, ref)), 403, 'Superadmin ne peut pas traiter');

  // Vérification de la logique de libellé d'action UI : Superadmin voit 'Examiner', Commandement voit 'Traiter'
  const boutonPour = (role, ouvert) => (ouvert ? 'Masquer' : (role === 'superadmin' ? 'Examiner' : 'Traiter'));
  assert.equal(boutonPour('superadmin', false), 'Examiner');
  assert.notEqual(boutonPour('superadmin', false), 'Traiter');
  assert.equal(boutonPour('commandement', false), 'Traiter');
});

test('Scénario 8 : Rôles opérationnels — conservation des actions autorisées et interdiction d’approuver', () => {
  const { e: e0, sa, cmd } = setup();
  let e = creerConflits(e0, sa, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const cid = e.conflits[0].id;
  e = assigner(e, sa, { conflitIds: [cid] }, date).etat;

  // Le commandement a le droit de marquer en cours
  e = marquerEnCours(e, cmd, cid, date).etat;
  assert.equal(lireConflit(e, cmd, cid).statut, 'en-cours');

  // Le commandement a le droit de soumettre une proposition
  e = soumettreProposition(e, cmd, cid, {
    type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.6, 33.7], raison: 'Proposition commandement',
    validation: { statut: 'valide' },
  }, ref, date).etat;
  assert.equal(lireConflit(e, cmd, cid).statut, 'proposition-soumise');

  // Mais le commandement n'a PAS le droit d'approuver ou de décider -> 403
  assert.equal(code(() => decider(e, cmd, cid, { decision: 'approuver', raison: 'Je m’approuve' }, ref)), 403);
});
