import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTINU, appliquerEditions, construireHierarchie, editionsVides } from './barages.js';
import { distanceMetres } from './mesure.js';
import {
  HISTORIQUE_VIDE, LIMITES_HISTORIQUE, REGLES_DEFAUT, ajouterSession, analyser, annulerEntree, appliquerAuxEditions,
  controlerEnregistrement, controlerRoute, decider, doublonsExacts, filtrerConstats, lireHistorique, memeValeur, nouvelleSession,
  planifierApplication, quasiDoublons, statistiques, statutDe, validerRegles,
} from './optimisation.js';
import { empreinte } from './optimisation-ui.js';

// Référentiel factice : 2 régions, 2 compagnies, 3 brigades (carrés de 0,2°).
const carre = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.2, y], [x + 0.2, y + 0.2], [x, y + 0.2], [x, y]]] });
const BT = [
  { id: 'bt-0', nom: 'Skhirat', cie: 'Témara', reg: 'Rabat', g: carre(-7.0, 33.8) },
  { id: 'bt-1', nom: 'Harhoura', cie: 'Témara', reg: 'Rabat', g: carre(-6.8, 33.8) },
  { id: 'bt-2', nom: 'Bhalil', cie: 'Sefrou', reg: 'Fès', g: carre(-5.0, 33.8) },
];
const hierarchie = construireHierarchie({
  reg: [{ id: 'reg-0', nom: 'Rabat' }, { id: 'reg-1', nom: 'Fès' }],
  cie: [{ id: 'cie-0', nom: 'Témara', reg: 'Rabat' }, { id: 'cie-1', nom: 'Sefrou', reg: 'Fès' }],
  bt: BT.map(({ id, nom, cie, reg }) => ({ id, nom, cie, reg })),
});
const circosBt = BT.map(({ id, nom, cie, reg, g }) => ({
  proprietes: { id, nom, cie, reg }, geometrie: g,
  emprise: [g.coordinates[0][0][0], g.coordinates[0][0][1], g.coordinates[0][2][0], g.coordinates[0][2][1]],
}));
const ROUTE = { nom: 'Route de test', ref: 'R1', classe: 'tertiary' };
const barage = (id, champs = {}) => ({ id, name: `Barage ${id}`, type: 'fixe', shift: '06-12', latitude: 33.9, longitude: -6.95, btId: 'bt-0', isSimulation: true, route: ROUTE, ...champs });
const enr = (b, rang, source = 'fichier') => ({ barage: b, source, rang });
const instantane = (barages, autres = {}) => ({ version: 1, enregistrements: barages.map((b, i) => enr(b, i)), orphelines: [], dejaInstalles: [], simulationDeclaree: false, referentielDifferent: false, ...autres });
const contexte = { hierarchie, circosBt, simulationDeclaree: false };
const regles = (r = {}) => validerRegles(r).regles;
const metres = (m) => m / 111_195; // degrés de latitude
const codes = (constats) => constats.map((c) => c.code).sort();

// ── Règles ─────────────────────────────────────────────────────────────────

test('règles : valeurs par défaut sûres, valeurs invalides signalées et jamais corrigées en silence', () => {
  assert.deepEqual(validerRegles({}).erreurs, []);
  assert.equal(validerRegles({}).regles.seuilProximiteM, REGLES_DEFAUT.seuilProximiteM);
  assert.equal(validerRegles({}).regles.verifierRoutes, false); // contrôle coûteux : à demander
  const e = (r) => validerRegles(r).erreurs.join(' | ');
  assert.match(e({ seuilProximiteM: 0 }), /seuil/);
  assert.match(e({ seuilProximiteM: 2001 }), /seuil/);
  assert.match(e({ seuilProximiteM: '30' }), /seuil/);
  assert.match(e({ toleranceRouteM: 80 }), /tolérance/);
  assert.match(e({ champsComparaison: ['type', 'couleur'] }), /champs/);
  assert.match(e({ perimetre: { origine: 'les deux' } }), /origine/);
  assert.match(e({ quasiDoublons: 'oui' }), /quasiDoublons/);
  assert.match(e({ severiteMin: 'critique' }), /gravité/);
  assert.deepEqual(validerRegles({ champsComparaison: ['type', 'type', 'btId'] }).regles.champsComparaison, ['type', 'btId']);
});

// ── Doublons ───────────────────────────────────────────────────────────────

test('doublons exacts : même identifiant (même entre simulé et réel), même signature, même position', () => {
  const r = doublonsExacts([
    enr(barage('A'), 0), enr(barage('A', { latitude: 33.95, isSimulation: false }), 1), // même id, origines différentes
    enr(barage('B', { latitude: 33.91 }), 2), enr(barage('C', { latitude: 33.91 }), 3), // même position et même signature
    enr(barage('D', { latitude: 33.92 }), 4), enr(barage('E', { latitude: 33.92, type: 'intouchable', shift: CONTINU }), 5), // même position, type différent
  ]);
  const par = Object.fromEntries(r.map((c) => [c.code, c]));
  assert.deepEqual(codes(r), ['id-double', 'meme-position', 'signature-identique']);
  assert.match(par['id-double'].raison, /pas tous de la même origine/);
  assert.equal(par['signature-identique'].confiance, 'haute');
  assert.deepEqual(par['signature-identique'].enregistrements.map((x) => x.id), ['B', 'C']);
  assert.equal(par['meme-position'].confiance, 'moyenne');
  assert.equal(par['meme-position'].preuves.distanceM, 0);
  assert.ok(!par['meme-position'].preuves.champsIdentiques.includes('type'));
});

test('doublons exacts : un nom identique seul n’est pas un doublon ; simulé et réel jamais rapprochés par la position', () => {
  const r = doublonsExacts([
    enr(barage('A', { name: 'Barrage Nord' }), 0), enr(barage('B', { name: 'Barrage Nord', latitude: 33.95 }), 1),
    enr(barage('C', { latitude: 33.97 }), 2), enr(barage('D', { latitude: 33.97, isSimulation: false }), 3),
  ]);
  assert.deepEqual(r, []);
});

test('quasi-doublons : distance géodésique, seuil réglable, confiance selon les champs', () => {
  const a = barage('A');
  const b = barage('B', { latitude: 33.9 + metres(8) }); // 8 m, mêmes champs
  const c = barage('C', { latitude: 33.9 - metres(20), shift: '00-06' }); // 20 m de A, faction différente
  const enrs = [enr(a, 0), enr(b, 1), enr(c, 2)];
  const d = distanceMetres([a.longitude, a.latitude], [b.longitude, b.latitude]);
  assert.ok(Math.abs(d - 8) < 0.05, `${d}`);
  const r30 = quasiDoublons(enrs, regles({ seuilProximiteM: 30 }));
  const ab = r30.find((x) => x.enregistrements.map((e) => e.id).join() === 'A,B');
  assert.equal(ab.confiance, 'haute');
  assert.equal(ab.preuves.seuilM, 30);
  assert.deepEqual(ab.preuves.champsIdentiques, ['type', 'shift', 'btId', 'route']);
  const ac = r30.find((x) => x.enregistrements.map((e) => e.id).join() === 'A,C');
  assert.equal(ac.confiance, 'moyenne');
  assert.deepEqual(ac.preuves.champsDifferents, ['shift']);
  // Seuil plus serré : seule la paire à 8 m reste.
  assert.deepEqual(quasiDoublons(enrs, regles({ seuilProximiteM: 10 })).map((x) => x.enregistrements.map((e) => e.id).join()), ['A,B']);
  // Une paire au-delà du seuil n'est jamais proposée, même avec tous les champs identiques.
  assert.equal(quasiDoublons([enr(a, 0), enr(barage('Z', { latitude: 33.9 + metres(40) }), 1)], regles({ seuilProximiteM: 30 })).length, 0);
});

test('quasi-doublons : jamais entre simulé et réel ; brigade différente exclue sur demande', () => {
  const a = barage('A', { longitude: -6.8 - 0.00005 }); // dans bt-0, au bord
  const reel = barage('R', { longitude: -6.8 - 0.00002, isSimulation: false });
  const autreBt = barage('X', { longitude: -6.8 + 0.00005, btId: 'bt-1' });
  const enrs = [enr(a, 0), enr(reel, 1), enr(autreBt, 2)];
  assert.deepEqual(quasiDoublons(enrs, regles({ exigerMemeBrigade: true })), []);
  const sansBt = quasiDoublons(enrs, regles({ exigerMemeBrigade: false }));
  assert.deepEqual(sansBt.map((x) => x.enregistrements.map((e) => e.id).join()), ['A,X']);
});

// ── Contrôles d'un enregistrement ──────────────────────────────────────────

const controle = (b, r = {}) => controlerEnregistrement(enr(b, 0), contexte, regles(r));

test('coordonnées : absentes, texte (correction proposée), non finies, hors de l’emprise', () => {
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001'))), []);
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { latitude: undefined }))), ['coord-manquante']);
  const texte = controle(barage('SIM-BAR-0001', { latitude: '33,9' }));
  assert.deepEqual(codes(texte), ['coord-texte']);
  assert.deepEqual(texte[0].proposition.changements, [{ champ: 'latitude', avant: '33,9', apres: 33.9 }]);
  assert.equal(texte[0].proposition.reversible, true);
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { longitude: Infinity }))), ['coord-invalide']);
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { longitude: 'abc' }))), ['coord-invalide']);
  const inverse = controle(barage('SIM-BAR-0001', { latitude: -6.95, longitude: 33.9 }), { verifierRelations: false });
  assert.deepEqual(codes(inverse), ['hors-emprise']);
  assert.match(inverse[0].piste, /inversées/);
});

test('métadonnées : identifiant, type, faction (correction seulement si elle se déduit), simulé / réel, nom', () => {
  assert.deepEqual(codes(controle(barage('', {}))), ['id-manquant']);
  assert.deepEqual(codes(controle(barage('import-17'))), ['id-format']);
  assert.equal(controle(barage('import-17'))[0].severite, 'info');
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { type: 'mobile' }))), ['type-inconnu']);
  const fixe = controle(barage('SIM-BAR-0001', { shift: CONTINU }));
  assert.deepEqual(codes(fixe), ['faction-fixe']);
  assert.equal(fixe[0].proposition, null); // aucune faction inventée
  const intouchable = controle(barage('SIM-BAR-0001', { type: 'intouchable', shift: '12-18' }));
  assert.deepEqual(codes(intouchable), ['faction-intouchable']);
  assert.deepEqual(intouchable[0].proposition.changements, [{ champ: 'shift', avant: '12-18', apres: CONTINU }]);
  assert.match(intouchable[0].piste, /type est erroné/);
  const sansOrigine = controle(barage('SIM-BAR-0001', { isSimulation: undefined }));
  assert.deepEqual(codes(sansOrigine), ['origine-absente']);
  assert.equal(sansOrigine[0].proposition, null); // la classification ne se déduit pas
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { isSimulation: false }))), ['origine-incoherente']);
  assert.deepEqual(codes(controlerEnregistrement(enr(barage('BAR-X-1', { isSimulation: false }), 0), { ...contexte, simulationDeclaree: true }, regles())), ['origine-incoherente']);
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { name: '' }))), ['nom-absent']);
  assert.deepEqual(codes(controle(null)), ['enregistrement-invalide']);
});

test('relations : brigade absente ou inconnue (indice, pas de correction), position hors de sa brigade', () => {
  const inconnue = controle(barage('SIM-BAR-0001', { btId: 'bt-99' }));
  assert.deepEqual(codes(inconnue), ['bt-inconnue']);
  assert.equal(inconnue[0].proposition, null);
  assert.match(inconnue[0].piste, /Skhirat \(bt-0\)/);
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { btId: '' }))), ['bt-absente']);
  const ailleurs = controle(barage('SIM-BAR-0001', { btId: 'bt-1' })); // position dans bt-0
  assert.deepEqual(codes(ailleurs), ['hors-brigade']);
  assert.equal(ailleurs[0].preuves.brigadeContenant, 'Skhirat (bt-0)');
  assert.deepEqual(codes(controle(barage('SIM-BAR-0001', { route: undefined }))), ['route-non-verifiee']); // non vérifié, pas « invalide »
});

test('route : hors route → accroche proposée dans sa brigade ; tuiles illisibles → non vérifiable', async () => {
  const lignes = [{ classe: 'tertiary', nom: 'Route de test', ref: 'R1', points: [[-6.99, 33.9], [-6.81, 33.9]] }];
  const ctx = { ...contexte, lireRoutes: async () => ({ lignes }) };
  assert.deepEqual(await controlerRoute(enr(barage('A'), 0), ctx, regles()), []);
  const loin = await controlerRoute(enr(barage('A', { latitude: 33.9 + metres(60) }), 0), ctx, regles());
  assert.deepEqual(codes(loin), ['hors-route']);
  const ch = Object.fromEntries(loin[0].proposition.changements.map((c) => [c.champ, c.apres]));
  assert.equal(ch.latitude, 33.9);
  assert.ok(Math.abs(loin[0].preuves.distanceM - 60) < 0.5);
  const tropLoin = await controlerRoute(enr(barage('A', { latitude: 33.9 + metres(400) }), 0), ctx, regles());
  assert.equal(tropLoin[0].proposition, null);
  const illisible = await controlerRoute(enr(barage('A'), 0), { ...contexte, lireRoutes: async () => null }, regles());
  assert.deepEqual(codes(illisible), ['route-non-verifiable']);
  assert.equal(illisible[0].severite, 'info');
});

// ── Analyse complète ───────────────────────────────────────────────────────

const JEU = [
  barage('SIM-BAR-0001'),
  barage('SIM-BAR-0002', { latitude: 33.9 + metres(5) }), // quasi-doublon de 0001
  barage('SIM-BAR-0003', { type: 'intouchable', shift: '06-12', latitude: 33.95 }), // correction proposée
  barage('SIM-BAR-0004', { latitude: '33,96' }), // coordonnée texte
  barage('SIM-BAR-0005', { btId: 'bt-99', latitude: 33.97 }),
  barage('BAR-R-1', { isSimulation: false, latitude: 33.9 + metres(3) }), // réel près de 0001 : jamais rapproché
  barage('BAR-R-2', { isSimulation: false, longitude: -4.9, btId: 'bt-2' }),
];

test('analyse : lecture seule, constats attendus, simulés et réels séparés', async () => {
  const inst = instantane(JEU);
  const copie = structuredClone(inst);
  const r = await analyser(inst, contexte, regles());
  assert.deepEqual(inst, copie, 'l’instantané n’est pas modifié');
  assert.equal(r.analyses, 7);
  assert.equal(r.annule, false);
  const c = codes(r.constats);
  for (const attendu of ['proximite', 'faction-intouchable', 'coord-texte', 'bt-inconnue', 'absent-carte']) assert.ok(c.includes(attendu), attendu);
  for (const x of r.constats.filter((y) => y.categorie === 'quasi-doublon')) {
    assert.equal(new Set(x.enregistrements.map((e) => e.origine)).size, 1, 'jamais simulé et réel dans un même quasi-doublon');
  }
  // Périmètre : réels seulement, puis une région.
  const reels = await analyser(inst, contexte, regles({ perimetre: { origine: 'reelle' } }));
  assert.equal(reels.analyses, 2);
  assert.ok(reels.constats.every((x) => x.enregistrements.every((e) => e.origine === 'reel')));
  const fes = await analyser(inst, contexte, regles({ perimetre: { reg: 'reg-1' } }));
  assert.equal(fes.analyses, 1);
  // Gravité minimale.
  const erreurs = await analyser(inst, contexte, regles({ severiteMin: 'erreur' }));
  assert.ok(erreurs.constats.length && erreurs.constats.every((x) => x.severite === 'erreur'));
});

test('statistiques et filtres : mêmes chiffres que la liste, un barage compté une fois', async () => {
  const r = await analyser(instantane(JEU), contexte, regles());
  const s = statistiques(r.constats, {}, r.analyses);
  assert.equal(s.analyses, 7);
  assert.equal(s.quasiDoublons, r.constats.filter((c) => c.categorie === 'quasi-doublon').length);
  assert.equal(s.coordonnees, 1); // SIM-BAR-0004 seulement
  assert.equal(s.propositions, r.constats.filter((c) => c.proposition).length);
  assert.equal(s.enAttente, s.propositions);
  assert.equal(s.approuves + s.refuses + s.appliques, 0);
  const unites = new Map(r.constats.flatMap((c) => c.enregistrements).map((e) => [e.cle, { regId: e.id === 'BAR-R-2' ? 'reg-1' : 'reg-0' }]));
  assert.deepEqual(filtrerConstats(r.constats, { reg: 'reg-1' }, {}, unites).flatMap((c) => c.enregistrements.map((e) => e.id)).filter((id) => id !== 'BAR-R-2'), []);
  assert.ok(filtrerConstats(r.constats, { origine: 'reel' }).every((c) => c.enregistrements.some((e) => e.origine === 'reel')));
  assert.ok(filtrerConstats(r.constats, { categorie: 'coordonnees', severite: 'erreur' }).every((c) => c.categorie === 'coordonnees'));
  assert.equal(filtrerConstats(r.constats, { texte: 'sim-bar-0004' }).length, r.constats.filter((c) => c.enregistrements.some((e) => e.id === 'SIM-BAR-0004')).length);
});

test('validation manuelle : transitions permises seulement, approbation et refus comptés', async () => {
  const r = await analyser(instantane(JEU), contexte, regles());
  const prop = r.constats.find((c) => c.code === 'faction-intouchable');
  const doublon = r.constats.find((c) => c.code === 'proximite');
  let d = {};
  assert.equal(statutDe(prop, d), 'proposition');
  assert.equal(statutDe(doublon, d), 'a-verifier');
  d = decider(d, prop, 'approuve');
  d = decider(d, doublon, 'confirme');
  assert.throws(() => decider(d, prop, 'applique'), /Passage impossible/); // « appliqué » seulement par l'application
  assert.throws(() => decider(d, doublon, 'approuve'), /Passage impossible/);
  const s = statistiques(r.constats, d, r.analyses);
  assert.equal(s.approuves, 1);
  d = decider(d, prop, 'refuse');
  assert.equal(statistiques(r.constats, d, r.analyses).refuses, 1);
});

// ── Application, simulation, annulation ────────────────────────────────────

/** Données actuelles : fichier + surcouche, comme CoucheBarages.instantane(). */
const actuels = (base, editions) => appliquerEditions(base, editions).barages.map((b, i) => enr(b, i, editions.ajouts.some((a) => a.id === b?.id) ? 'local' : 'fichier'));

test('application : simulation sans effet, revalidation, puis surcouche seulement (fichier intact) ; jamais sur un intouchable', async () => {
  const base = structuredClone(JEU);
  const fige = structuredClone(base);
  const r = await analyser(instantane(base), contexte, regles());
  const props = r.constats.filter((c) => c.proposition);
  assert.deepEqual(props.map((c) => c.code).sort(), ['coord-texte', 'faction-intouchable']);
  const editions = editionsVides();
  const plan = planifierApplication(props, actuels(base, editions), hierarchie);
  // SIM-BAR-0003 est un intouchable : protégé, jamais corrigé par l'optimisation.
  assert.deepEqual(plan.refus.map((x) => [x.id, x.raison]), [['SIM-BAR-0003', 'protege']]);
  assert.deepEqual(base, fige, 'planifier ne change rien');
  const { editions: nouvelles, journal } = appliquerAuxEditions(editions, plan.valides);
  assert.deepEqual(editions, editionsVides(), 'la surcouche d’origine n’est pas modifiée');
  assert.deepEqual(base, fige, 'le fichier installé n’est jamais modifié');
  assert.deepEqual(nouvelles.modifs, { 'SIM-BAR-0004': { latitude: 33.96 } });
  assert.deepEqual(journal.map((j) => j.id), ['SIM-BAR-0004']);
  const apres = appliquerEditions(base, nouvelles).barages;
  assert.equal(apres.find((b) => b.id === 'SIM-BAR-0004').latitude, 33.96);
  assert.equal(apres.length, base.length, 'aucun barage supprimé ni fusionné');
});

test('application : proposition périmée, cible absente ou ambiguë, conflit, champ verrouillé, résultat invalide', async () => {
  const base = structuredClone(JEU);
  const r = await analyser(instantane(base), contexte, regles());
  const prop = r.constats.find((c) => c.code === 'coord-texte');
  const avant = prop.proposition.changements[0].avant;
  // Périmée : le barage a changé depuis l'analyse.
  const modifie = { ...editionsVides(), modifs: { 'SIM-BAR-0004': { latitude: '33.95' } } };
  assert.equal(planifierApplication([prop], actuels(base, modifie), hierarchie).refus[0].raison, 'perimee');
  // Cible absente.
  const supprime = { ...editionsVides(), suppressions: ['SIM-BAR-0004'] };
  assert.equal(planifierApplication([prop], actuels(base, supprime), hierarchie).refus[0].raison, 'cible-absente');
  // Cible ambiguë (identifiant en double).
  const double = [...base, barage('SIM-BAR-0004', { latitude: 33.99 })];
  assert.equal(planifierApplication([prop], actuels(double, editionsVides()), hierarchie).refus[0].raison, 'cible-ambigue');
  // Conflit : deux propositions différentes sur le même champ.
  const rival = structuredClone(prop);
  rival.id = 'autre';
  rival.proposition.changements = [{ champ: 'latitude', avant, apres: 33.5 }];
  const conflit = planifierApplication([prop, rival], actuels(base, editionsVides()), hierarchie);
  assert.deepEqual(conflit.refus.map((x) => x.raison), ['conflit', 'conflit']);
  assert.deepEqual(conflit.valides, []);
  // Champ verrouillé (classification, brigade, identifiant).
  const verrou = structuredClone(prop);
  verrou.proposition.changements = [{ champ: 'isSimulation', avant: true, apres: false }];
  assert.equal(planifierApplication([verrou], actuels(base, editionsVides()), hierarchie).refus[0].raison, 'champ-verrouille');
  // Résultat encore invalide : refusé, rien d'appliqué pour ce barage.
  const invalide = structuredClone(prop);
  invalide.proposition.changements = [{ champ: 'latitude', avant, apres: 'x' }];
  assert.equal(planifierApplication([invalide], actuels(base, editionsVides()), hierarchie).refus[0].raison, 'invalide');
});

test('annulation : valeurs d’origine rétablies, refusée si le barage a changé depuis', async () => {
  const base = structuredClone(JEU);
  const r = await analyser(instantane(base), contexte, regles());
  const props = r.constats.filter((c) => c.proposition);
  const plan = planifierApplication(props, actuels(base, editionsVides()), hierarchie);
  const { editions, journal } = appliquerAuxEditions(editionsVides(), plan.valides);
  const entree = journal.find((j) => j.id === 'SIM-BAR-0004');
  const baseParId = new Map(base.map((b) => [b.id, b]));
  // Annulation sûre : la modification locale disparaît, le barage retrouve sa valeur d'origine.
  const ok = annulerEntree(editions, entree, actuels(base, editions), baseParId);
  assert.ok(ok.editions);
  assert.equal(ok.editions.modifs['SIM-BAR-0004'], undefined);
  assert.equal(appliquerEditions(base, ok.editions).barages.find((b) => b.id === 'SIM-BAR-0004').latitude, baseParId.get('SIM-BAR-0004').latitude);
  // Barage modifié après coup : annulation refusée, rien n'est changé.
  const ensuite = structuredClone(editions);
  ensuite.modifs['SIM-BAR-0004'] = { latitude: 33.97 };
  const refus = annulerEntree(ensuite, entree, actuels(base, ensuite), baseParId);
  assert.ok(refus.conflits?.length);
  assert.match(refus.conflits[0], /latitude a été modifié/);
  // Ajout local : le champ retrouve sa valeur d'avant.
  const local = barage('BAR-L-1', { latitude: '33.85' });
  const avecAjout = { ...editionsVides(), ajouts: [local] };
  const rl = await analyser({ ...instantane([]), enregistrements: actuels([], avecAjout) }, contexte, regles());
  const planL = planifierApplication(rl.constats.filter((c) => c.proposition), actuels([], avecAjout), hierarchie);
  const appL = appliquerAuxEditions(avecAjout, planL.valides);
  assert.equal(appL.editions.ajouts[0].latitude, 33.85);
  const annL = annulerEntree(appL.editions, appL.journal[0], actuels([], appL.editions), new Map());
  assert.equal(annL.editions.ajouts[0].latitude, '33.85');
});

// ── Historique ─────────────────────────────────────────────────────────────

test('historique : session avec règles et périmètre, bornée, relue sans erreur', async () => {
  const r = await analyser(instantane(JEU), contexte, regles({ seuilProximiteM: 12 }));
  const s = nouvelleSession(r, regles({ seuilProximiteM: 12 }), { date: new Date('2026-10-14T09:00:00Z'), version: 3 });
  assert.match(s.id, /^OPT-/);
  assert.equal(s.regles.seuilProximiteM, 12);
  assert.equal(s.versionDonnees, 3);
  assert.equal(s.constats.length, r.constats.length);
  assert.deepEqual(s.decisions, {});
  let h = HISTORIQUE_VIDE();
  for (let i = 0; i < LIMITES_HISTORIQUE.sessions + 3; i++) h = ajouterSession(h, { ...s, id: `OPT-${i}` });
  assert.equal(h.sessions.length, LIMITES_HISTORIQUE.sessions);
  assert.equal(h.sessions[0].id, `OPT-${LIMITES_HISTORIQUE.sessions + 2}`, 'la plus récente en tête');
  assert.deepEqual(lireHistorique('x'), HISTORIQUE_VIDE());
  assert.deepEqual(lireHistorique({ sessions: [{ id: 3 }, null, { id: 'OPT-1', constats: [] }] }).sessions.map((x) => x.id), ['OPT-1']);
  assert.ok(memeValeur({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
});

// ── Volume et annulation ───────────────────────────────────────────────────

test('volume : 10 000 barages analysés rapidement ; analyse annulable entre deux paquets', async () => {
  const beaucoup = Array.from({ length: 10_000 }, (_, i) => barage(`SIM-BAR-${String(i).padStart(5, '0')}`, {
    latitude: 33.81 + (i % 100) * metres(40), longitude: -6.99 + Math.floor(i / 100) * 0.0019,
  }));
  const debut = performance.now();
  const r = await analyser(instantane(beaucoup), contexte, regles());
  const ms = performance.now() - debut;
  assert.equal(r.analyses, 10_000);
  assert.ok(ms < 5000, `${ms.toFixed(0)} ms`);
  let appels = 0;
  let fait = 0;
  const annulee = await analyser(instantane(beaucoup), contexte, regles(), { annule: () => ++appels > 2, paquet: 1000, progression: (f) => { fait = f; } });
  assert.equal(annulee.annule, true);
  assert.equal(fait, 2000, 'arrêtée après deux paquets sur dix');
});

test('empreinte des données : stable au rechargement, change avec le contenu', () => {
  const i = (lat) => ({ enregistrements: [{ source: 'fichier', rang: 0, barage: { id: 'SIM-BAR-0001', latitude: lat, longitude: -7 } }] });
  assert.equal(empreinte(i(33)), empreinte(i(33)));
  assert.notEqual(empreinte(i(33)), empreinte(i(33.00001)));
  assert.notEqual(empreinte(i(33)), empreinte(i('33')), 'un nombre devenu texte change l’empreinte');
});
