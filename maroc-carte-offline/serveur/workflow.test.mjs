import assert from 'node:assert/strict';
import test from 'node:test';
import { estProtege } from '../src/barages.js';
import { contient } from '../src/competence.js';
import { verifierMotDePasse } from './auth.mjs';
import {
  ETAT_VIDE, ErreurWorkflow, assigner, baragesAvecChangements, changementsApprouves, comptePublic, conflitsVisibles, creerCompte,
  creerConflits, decider, lireConflit, marquerEnCours, marquerResolu, modifierCompte, soumettreProposition,
} from './workflow.mjs';

// Référentiel factice : deux régions (carrés), une brigade chacune.
const carre = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const regions = new Map([['reg-1', { id: 'reg-1', nom: 'Rabat', geometrie: carre(-8, 33) }], ['reg-2', { id: 'reg-2', nom: 'Fès', geometrie: carre(-6, 33) }]]);
const btReg = { 'bt-1': 'reg-1', 'bt-2': 'reg-2' };
const B = (id, champs = {}) => ({ id, name: `Barage ${id}`, type: 'fixe', shift: '00-06', latitude: 33.5, longitude: -7.5, btId: 'bt-1', isSimulation: true, ...champs });
const jeu = [
  B('SIM-BAR-0001'), B('SIM-BAR-0002', { longitude: -7.49 }), // déplaçables, Faction 1, Rabat
  B('SIM-BAR-0003', { type: 'intouchable', shift: 'continu', longitude: -7.48 }), // intouchable, Rabat
  B('SIM-BAR-0004', { type: 'intouchable', shift: 'continu', longitude: -7.47 }), // intouchable, Rabat
  B('SIM-BAR-0005', { shift: '06-12', longitude: -7.495 }), // Faction 2, Rabat
  B('SIM-BAR-0101', { btId: 'bt-2', latitude: 33.5, longitude: -5.5 }), B('SIM-BAR-0102', { btId: 'bt-2', latitude: 33.5, longitude: -5.49 }), // Fès
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
const MDP = 'mot-de-passe-solide';
const date = new Date('2026-10-16T08:00:00Z');
const route = (m) => ({ chemin: [[-7.5, 33.5], [-7.49, 33.5]], secondes: 60 });

function preparer() {
  let e = ETAT_VIDE();
  const admin = creerCompte(e, null, { identifiant: 'admin', nom: 'Admin', role: 'admin', motDePasse: MDP }, ref, date);
  e = admin.etat;
  const rabat = creerCompte(e, admin.compte, { identifiant: 'cmd.rabat', nom: 'Commandement Rabat', role: 'commandement', regId: 'reg-1', motDePasse: MDP }, ref, date);
  e = rabat.etat;
  const fes = creerCompte(e, admin.compte, { identifiant: 'cmd.fes', nom: 'Commandement Fès', role: 'commandement', regId: 'reg-2', motDePasse: MDP }, ref, date);
  e = fes.etat;
  return { e, admin: admin.compte, rabat: rabat.compte, fes: fes.compte };
}
const code = (fn) => { try { fn(); } catch (err) { if (err instanceof ErreurWorkflow) return err.code; throw err; } return 200; };

test('comptes : premier admin par la console seulement, mots de passe hachés, commandement rattaché à une région existante', () => {
  const { e, admin, rabat } = preparer();
  assert.equal(rabat.regId, 'reg-1');
  assert.ok(verifierMotDePasse(MDP, admin.empreinte) && !admin.empreinte.includes(MDP));
  assert.equal(comptePublic(admin).empreinte, undefined, 'jamais exposée');
  assert.equal(code(() => creerCompte(e, null, { identifiant: 'pirate', nom: 'X', role: 'admin', motDePasse: MDP }, ref)), 401, 'second admin anonyme refusé');
  assert.equal(code(() => creerCompte(e, rabat, { identifiant: 'x.y', nom: 'X', role: 'commandement', regId: 'reg-1', motDePasse: MDP }, ref)), 403, 'un commandement ne crée pas de compte');
  assert.equal(code(() => creerCompte(e, admin, { identifiant: 'cmd.x', nom: 'X', role: 'commandement', regId: 'reg-9', motDePasse: MDP }, ref)), 400, 'région inconnue');
  assert.equal(code(() => creerCompte(e, admin, { identifiant: 'cmd.rabat', nom: 'X', role: 'commandement', regId: 'reg-1', motDePasse: MDP }, ref)), 409, 'identifiant unique');
  assert.equal(code(() => creerCompte(e, admin, { identifiant: 'cmd.y', nom: 'X', role: 'commandement', regId: 'reg-1', motDePasse: 'court' }, ref)), 400);
  assert.equal(code(() => modifierCompte(e, admin, admin.id, { actif: false })), 400, 'l’admin ne se désactive pas');
  assert.equal(modifierCompte(e, admin, rabat.id, { actif: false }).deconnecter, true);
});

test('optimisation réservée à l’admin ; conflits revérifiés par le serveur (région, faction, distance, doublons)', () => {
  const { e, admin, rabat } = preparer();
  const paires = [
    { ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500, route: route() }, // conforme : conflit
    { ids: ['SIM-BAR-0001', 'SIM-BAR-0003'], routeM: 2500, route: route() }, // déplaçable / intouchable
    { ids: ['SIM-BAR-0003', 'SIM-BAR-0004'], routeM: 1200, route: route() }, // deux intouchables
    { ids: ['SIM-BAR-0001', 'SIM-BAR-0005'], routeM: 700 }, // factions différentes
    { ids: ['SIM-BAR-0001', 'SIM-BAR-0101'], routeM: 900 }, // autre région
    { ids: ['SIM-BAR-0002', 'SIM-BAR-0001'], routeM: 1500 }, // doublon
    { ids: ['SIM-BAR-0002', 'SIM-BAR-0003'], routeM: null }, // route non vérifiée
    { ids: ['SIM-BAR-0002', 'SIM-BAR-0004'], routeM: 9000 }, // au-delà du seuil
    { ids: ['SIM-BAR-0001', 'SIM-BAR-0004'], routeM: 10 }, // plus court que la ligne droite (~2,8 km)
    { ids: ['BAR-LOCAL-1', 'SIM-BAR-0001'], routeM: 100 }, // absent du jeu installé
  ];
  assert.equal(code(() => creerConflits(e, rabat, { regId: 'reg-1', seuilKm: 5, paires }, ref)), 403, 'un commandement ne lance pas l’optimisation');
  const r = creerConflits(e, admin, { regId: 'reg-1', seuilKm: 5, paires }, ref, date);
  assert.equal(r.crees.length, 3);
  assert.deepEqual(r.ignores.map((x) => x.raison), [
    'factions différentes', 'barage hors de la région analysée', 'conflit déjà ouvert pour cette paire', 'distance routière non vérifiée ou au-delà du seuil',
    'distance routière non vérifiée ou au-delà du seuil', 'distance routière invraisemblable (plus courte que la ligne droite)', 'barage absent du jeu installé (ajout local ?)',
  ]);
  const [mobiles, mixte, fixes] = r.crees;
  assert.equal(mobiles.statut, 'a-traiter');
  assert.equal(mixte.statut, 'a-traiter');
  assert.equal(fixes.statut, 'bloque-fixes', 'deux intouchables : informatif');
  assert.ok(fixes.informatif && fixes.barages.every((b) => b.protege));
  assert.equal(mobiles.regId, 'reg-1');
  assert.equal(mobiles.seuilM, 5000);
  assert.equal(mobiles.faction, '00-06');
  assert.equal(mixte.faction, '00-06', 'intouchable : de la faction de l’autre');
  assert.ok(mobiles.historique[0].action === 'cree' && mobiles.historique[0].acteurId === admin.id);
  // Relancer la même analyse : aucun doublon.
  assert.equal(creerConflits(r.etat, admin, { regId: 'reg-1', seuilKm: 5, paires: paires.slice(0, 3) }, ref, date).crees.length, 0);
});

test('affectation : commandement de la région (correspondance), choix explicite si absent/ambigu, assigner ≠ résoudre', () => {
  const { e: e0, admin, rabat, fes } = preparer();
  let e = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const [c] = e.conflits;
  assert.equal(code(() => assigner(e, rabat, { conflitIds: [c.id] })), 403);
  assert.equal(code(() => assigner(e, admin, { conflitIds: [c.id], commandementId: fes.id })), 400, 'commandement d’une autre région refusé');
  e = assigner(e, admin, { conflitIds: [c.id] }, date).etat;
  const a = e.conflits[0];
  assert.equal(a.assigneA, rabat.id);
  assert.equal(a.statut, 'a-traiter', 'assigner ne résout pas');
  assert.ok(a.assigneLe && a.assignePar === admin.id && a.historique.at(-1).action === 'assigne');
  // Deux commandements pour la même région : choix obligatoire.
  const second = creerCompte(e, admin, { identifiant: 'cmd.rabat2', nom: 'Rabat 2', role: 'commandement', regId: 'reg-1', motDePasse: MDP }, ref, date);
  assert.equal(code(() => assigner(second.etat, admin, { conflitIds: [c.id] })), 409);
  assert.equal(assigner(second.etat, admin, { conflitIds: [c.id], commandementId: second.compte.id }).etat.conflits[0].assigneA, second.compte.id);
  // Aucun commandement (Fès désactivé) : erreur explicite.
  const sansFes = modifierCompte(e, admin, fes.id, { actif: false }).etat;
  const cf = creerConflits(sansFes, admin, { regId: 'reg-2', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0101', 'SIM-BAR-0102'], routeM: 1500 }] }, ref, date);
  assert.equal(code(() => assigner(cf.etat, admin, { conflitIds: [cf.crees[0].id] })), 409);
});

test('isolation : un commandement ne voit que ses conflits, de sa région ; ailleurs : 404 (aucune fuite)', () => {
  const { e: e0, admin, rabat, fes } = preparer();
  let e = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  e = creerConflits(e, admin, { regId: 'reg-2', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0101', 'SIM-BAR-0102'], routeM: 1500 }] }, ref, date).etat;
  const [cR, cF] = e.conflits;
  assert.equal(conflitsVisibles(e, rabat).length, 0, 'non assigné : invisible');
  e = assigner(e, admin, { conflitIds: [cR.id] }, date).etat;
  e = assigner(e, admin, { conflitIds: [cF.id] }, date).etat;
  assert.deepEqual(conflitsVisibles(e, rabat).map((c) => c.id), [cR.id]);
  assert.deepEqual(conflitsVisibles(e, fes).map((c) => c.id), [cF.id]);
  assert.equal(conflitsVisibles(e, admin).length, 2);
  assert.equal(code(() => lireConflit(e, rabat, cF.id)), 404);
  assert.equal(code(() => marquerEnCours(e, rabat, cF.id)), 404);
  assert.equal(code(() => soumettreProposition(e, rabat, cF.id, { type: 'suppression', barageId: 'SIM-BAR-0101', raison: 'tentative hors région' }, ref)), 404);
  // Région changée du compte (ou conflit d'une autre région assigné par erreur) : toujours invisible.
  const deplace = { ...rabat, regId: 'reg-2' };
  assert.equal(code(() => lireConflit(e, deplace, cR.id)), 404);
  assert.equal(code(() => conflitsVisibles(e, null)), 401);
});

test('propositions : déplaçable seulement, motivées, dans la région, validées par la route ; un intouchable jamais', () => {
  const { e: e0, admin, rabat } = preparer();
  let e = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0003'], routeM: 2500 }, { ids: ['SIM-BAR-0003', 'SIM-BAR-0004'], routeM: 1200 }] }, ref, date).etat;
  const [mixte, fixes] = e.conflits;
  e = assigner(e, admin, { conflitIds: [mixte.id, fixes.id] }, date).etat;
  const valide = { statut: 'valide', minimumM: 6000, seuilKm: 5 };
  assert.equal(code(() => soumettreProposition(e, admin, mixte.id, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: 'admin' }, ref)), 403, 'l’admin ne propose pas');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'suppression', barageId: 'SIM-BAR-0003', raison: 'supprimer le fixe' }, ref)), 403, 'intouchable : jamais');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0003', position: [-7.4, 33.6], raison: 'déplacer le fixe', validation: valide }, ref)), 403);
  assert.equal(code(() => soumettreProposition(e, rabat, fixes.id, { type: 'suppression', barageId: 'SIM-BAR-0004', raison: 'deux fixes' }, ref)), 409, 'Bloqué — barrages fixes');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: '' }, ref)), 400, 'motif obligatoire');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-5.5, 33.5], raison: 'vers Fès', validation: valide }, ref)), 403, 'hors de la région');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.4, 33.6], raison: 'trop proche', validation: { statut: 'non-valide' } }, ref)), 400, 'emplacement non valide');
  assert.equal(code(() => soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.4, 33.6], raison: 'incertain', validation: { statut: 'verification-impossible' } }, ref)), 400, 'incertain sans confirmation');
  e = marquerEnCours(e, rabat, mixte.id, date).etat;
  assert.equal(e.conflits[0].statut, 'en-cours');
  const r = soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.4, 33.6], raison: 'plus de 5 km par la route du fixe', validation: valide }, ref, date);
  assert.equal(r.conflit.statut, 'proposition-soumise');
  assert.deepEqual(r.conflit.proposition.avant, { latitude: 33.5, longitude: -7.5 });
  assert.equal(ref.barage('SIM-BAR-0001').longitude, -7.5, 'rien n’est modifié par une proposition');
  assert.equal(code(() => soumettreProposition(r.etat, rabat, mixte.id, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: 'deuxième' }, ref)), 409, 'une à la fois');
});

test('décision de l’admin : motivée ; approuver / rejeter / renvoyer ; approuvé ≠ résolu ; export sans toucher aux fixes', () => {
  const { e: e0, admin, rabat } = preparer();
  let e = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0003'], routeM: 2500 }, { ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  const [mixte, mobiles] = e.conflits;
  e = assigner(e, admin, { conflitIds: [mixte.id, mobiles.id] }, date).etat;
  e = soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.4, 33.6], raison: 'espacement', validation: { statut: 'valide' } }, ref, date).etat;
  e = soumettreProposition(e, rabat, mobiles.id, { type: 'suppression', barageId: 'SIM-BAR-0002', raison: 'redondant' }, ref, date).etat;
  assert.equal(code(() => decider(e, rabat, mixte.id, { decision: 'approuver', raison: 'ok' }, ref)), 403, 'un commandement ne décide pas');
  assert.equal(code(() => decider(e, admin, mixte.id, { decision: 'approuver', raison: '' }, ref)), 400, 'motif obligatoire');
  // Renvoyer pour correction, puis nouvelle proposition, puis approbation.
  e = decider(e, admin, mixte.id, { decision: 'corriger', raison: 'précisez la route' }, ref, date).etat;
  assert.equal(lireConflit(e, rabat, mixte.id).statut, 'a-corriger');
  e = soumettreProposition(e, rabat, mixte.id, { type: 'deplacement', barageId: 'SIM-BAR-0001', position: [-7.41, 33.6], raison: 'sur la RN1, 6 km du fixe', validation: { statut: 'valide' } }, ref, date).etat;
  e = decider(e, admin, mixte.id, { decision: 'approuver', raison: 'validé' }, ref, date).etat;
  e = decider(e, admin, mobiles.id, { decision: 'approuver', raison: 'validé' }, ref, date).etat;
  assert.equal(lireConflit(e, admin, mixte.id).statut, 'approuve', 'approuvé, pas encore résolu');
  assert.equal(code(() => marquerResolu(e, admin, mixte.id, { note: '' })), 400);
  // Export : changements approuvés ; fixes intacts ; la suppression garde l'enregistrement d'origine.
  const ch = changementsApprouves(e, admin);
  assert.deepEqual(ch.map((x) => [x.barageId, x.type]).sort(), [['SIM-BAR-0001', 'deplacement'], ['SIM-BAR-0002', 'suppression']]);
  assert.equal(code(() => changementsApprouves(e, rabat)), 403);
  const fichier = baragesAvecChangements(e, admin, ref);
  assert.equal(fichier.barages.find((b) => b.id === 'SIM-BAR-0001').longitude, -7.41);
  assert.ok(!fichier.barages.some((b) => b.id === 'SIM-BAR-0002'));
  assert.equal(fichier.retraitsApprouves[0].barage.id, 'SIM-BAR-0002', 'enregistrement d’origine gardé');
  assert.deepEqual(fichier.barages.find((b) => b.id === 'SIM-BAR-0003'), ref.barage('SIM-BAR-0003'), 'intouchable inchangé');
  assert.equal(ref.brut.barages.length, jeu.length, 'le jeu installé n’est pas modifié');
  e = marquerResolu(e, admin, mixte.id, { note: 'barages.json réinstallé' }, date).etat;
  const fin = lireConflit(e, admin, mixte.id);
  assert.equal(fin.statut, 'resolu');
  assert.deepEqual(fin.historique.map((h) => h.action), ['cree', 'assigne', 'proposition-soumise', 'decision-corriger', 'proposition-soumise', 'decision-approuver', 'resolu']);
  assert.ok(fin.historique.every((h) => h.date && h.acteurId));
  // Rejet motivé.
  const r = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date);
  let e2 = assigner(r.etat, admin, { conflitIds: [r.crees[0].id] }, date).etat;
  e2 = soumettreProposition(e2, rabat, r.crees[0].id, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: 'test de suppression' }, ref, date).etat;
  assert.equal(decider(e2, admin, r.crees[0].id, { decision: 'rejeter', raison: 'barage nécessaire' }, ref, date).conflit.statut, 'rejete');
});

test('protection jusqu’à l’export : un changement approuvé visant un barage devenu intouchable est refusé', () => {
  const { e: e0, admin, rabat } = preparer();
  let e = creerConflits(e0, admin, { regId: 'reg-1', seuilKm: 5, paires: [{ ids: ['SIM-BAR-0001', 'SIM-BAR-0002'], routeM: 1500 }] }, ref, date).etat;
  e = assigner(e, admin, { conflitIds: [e.conflits[0].id] }, date).etat;
  e = soumettreProposition(e, rabat, e.conflits[0].id, { type: 'suppression', barageId: 'SIM-BAR-0001', raison: 'test de suppression' }, ref, date).etat;
  const devenuFixe = { ...ref, barage: (id) => (id === 'SIM-BAR-0001' ? { ...parId.get(id), type: 'intouchable', shift: 'continu' } : parId.get(id) ?? null) };
  assert.equal(code(() => decider(e, admin, e.conflits[0].id, { decision: 'approuver', raison: 'approuvé' }, devenuFixe)), 403);
});
