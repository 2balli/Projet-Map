import assert from 'node:assert/strict';
import test from 'node:test';
import { appliquerEditions, editionsVides } from './barages.js';
import {
  REGLES_DEDOUBLONNAGE, ajouterOperation, annulerOptimisation, choisirCanonique, derniereAnnulable, detecterDoublons,
  etatApresInterruption, fusionPossible, lireOperations, majOperation, planifierOptimisation, validerReglesDedoublonnage,
} from './dedoublonnage.js';

// ~1 m vers le nord ≈ 0,000009°.
const M = 0.000009;
let n = 0;
const barage = (champs = {}) => {
  n += 1;
  return {
    id: `SIM-BAR-${String(n).padStart(4, '0')}`, name: `Barage ${n}`, type: 'fixe', shift: '06-12',
    latitude: 33.5, longitude: -7.6, btId: 'bt-1', isSimulation: true, route: { nom: null, ref: 'RN1', classe: 'primary' }, ...champs,
  };
};
/** Instantané comme CoucheBarages.instantane() : fichier + ajouts locaux, surcouche appliquée. */
function instantane(base, editions = editionsVides()) {
  const { barages, dejaInstalles } = appliquerEditions(base, editions);
  const locaux = new Set(editions.ajouts.map((a) => a.id));
  return { enregistrements: barages.map((b, i) => ({ barage: structuredClone(b), source: locaux.has(b.id) && !dejaInstalles.includes(b.id) ? 'local' : 'fichier', rang: i })) };
}
const regles = (r = {}) => ({ ...REGLES_DEDOUBLONNAGE, ...r });
const detecter = (base, editions, r, o) => detecterDoublons(instantane(base, editions), regles(r), o);

test('règles : défauts sûrs, valeurs invalides refusées (jamais corrigées en silence)', () => {
  assert.deepEqual(validerReglesDedoublonnage({}).erreurs, []);
  assert.equal(validerReglesDedoublonnage({}).regles.seuilConfirmeM, 1);
  assert.ok(validerReglesDedoublonnage({ seuilConfirmeM: 50 }).erreurs.length);
  assert.ok(validerReglesDedoublonnage({ seuilConfirmeM: 5, seuilPotentielM: 2 }).erreurs.length);
  assert.ok(validerReglesDedoublonnage({ criteres: ['source', 'source'] }).erreurs.length);
  assert.ok(validerReglesDedoublonnage({ criteres: ['inconnu'] }).erreurs.length);
});

test('doublon exact : mêmes coordonnées et attributs, identifiants distincts → confirmé', () => {
  const a = barage();
  const b = { ...barage(), name: a.name };
  const r = detecter([a, b]);
  assert.equal(r.confirmes.length, 1);
  assert.equal(r.potentiels.length, 0);
  assert.equal(r.confirmes[0].conserve.id, a.id);
  assert.deepEqual(r.confirmes[0].doublons.map((d) => d.id), [b.id]);
});

test('jamais sur le nom seul : même nom ailleurs, ou noms semblables, ne rapprochent rien', () => {
  const a = barage({ name: 'Barage RN1' });
  const b = barage({ name: 'Barage RN1', latitude: 33.6 }); // ~11 km
  const r = detecter([a, b]);
  assert.equal(r.confirmes.length + r.potentiels.length, 0);
});

test('incertains : nom, faction, type, route ou distance différents → potentiels, jamais confirmés', () => {
  const a = barage({ name: 'Barage A' });
  const nom = barage({ name: 'Barage B' });
  const faction = barage({ name: 'Barage A', shift: '12-18', latitude: 33.51 });
  const fa = barage({ name: 'Barage A', latitude: 33.51 });
  const loin = barage({ name: 'Barage C', latitude: 33.52 });
  const proche = barage({ name: 'Barage C', latitude: 33.52 + 5 * M });
  const r = detecter([a, nom, faction, fa, loin, proche]);
  assert.equal(r.confirmes.length, 0);
  assert.equal(r.potentiels.length, 3);
  assert.ok(r.potentiels.find((p) => p.enregistrements.some((e) => e.id === nom.id)).differences.includes('name'));
  assert.ok(r.potentiels.find((p) => p.enregistrements.some((e) => e.id === faction.id)).raisons.some((x) => x.includes('planning')));
  assert.ok(r.potentiels.find((p) => p.enregistrements.some((e) => e.id === proche.id)).raisons.some((x) => x.includes('m')));
  // Règle « nom » désactivée : la paire au même nom différent devient confirmée, pas les autres.
  const r2 = detecter([a, nom, faction, fa, loin, proche], undefined, { exigerMemeNom: false });
  assert.equal(r2.confirmes.length, 1);
  // Seuil confirmé élargi : la paire à 5 m le devient aussi.
  assert.equal(detecter([loin, proche], undefined, { seuilConfirmeM: 6 }).confirmes.length, 1);
});

test('simulé et réel : jamais rapprochés, même à la même position', () => {
  const sim = barage();
  const reel = { ...barage(), name: sim.name, isSimulation: false };
  const r = detecter([sim, reel]);
  assert.equal(r.confirmes.length + r.potentiels.length, 0);
  const inconnu = { ...barage(), name: sim.name, isSimulation: undefined };
  assert.equal(detecter([sim, inconnu]).confirmes.length, 0);
});

test('même identifiant : à vérifier, jamais supprimé (la surcouche supprime par identifiant)', () => {
  const a = barage();
  const r = detecter([a, { ...a }]);
  assert.equal(r.confirmes.length, 0);
  assert.equal(r.potentiels.length, 1);
  assert.ok(r.potentiels[0].raisons[0].includes('même identifiant'));
});

test('enregistrement conservé : critères dans l’ordre configuré, choix expliqué et déterministe', () => {
  const base = barage({ id: 'SIM-BAR-9001', route: null, validation: null });
  const complet = { ...base, id: 'SIM-BAR-9002', route: { ref: 'RN1' }, validation: { methode: 'route-tuiles' } };
  const local = { ...complet, id: 'BAR-ABC-1' };
  const enr = (b, source, rang) => ({ barage: b, source, rang });
  const membres = [enr(base, 'fichier', 0), enr(complet, 'fichier', 1), enr(local, 'local', 2)];
  const c1 = choisirCanonique(membres);
  assert.equal(c1.canonique.barage.id, 'SIM-BAR-9002');
  assert.equal(c1.motif, 'Données les plus complètes');
  // Ajout local d'abord si l'on met la complétude devant… mais le local perd sur la source à égalité.
  const c2 = choisirCanonique(membres, ['completude', 'source']);
  assert.equal(c2.canonique.barage.id, 'SIM-BAR-9002');
  // Coordonnées invalides : jamais conservé tant qu'un autre est valide.
  const c3 = choisirCanonique([enr({ ...complet, latitude: 'x' }, 'fichier', 0), enr(base, 'fichier', 1)]);
  assert.equal(c3.canonique.barage.id, 'SIM-BAR-9001');
  // Égalité parfaite : premier du fichier.
  assert.equal(choisirCanonique([enr({ ...base, id: 'SIM-BAR-9004' }, 'fichier', 4), enr({ ...base, id: 'SIM-BAR-9003' }, 'fichier', 3)]).canonique.barage.id, 'SIM-BAR-9003');
});

test('fusion : seulement ce qui manque au conservé et sur quoi les doublons s’accordent', () => {
  assert.deepEqual(fusionPossible({ name: 'A', route: null }, [{ route: { ref: 'RN1' } }, { route: { ref: 'RN1' } }]), { champs: { route: { ref: 'RN1' } }, conflits: [] });
  assert.deepEqual(fusionPossible({ name: 'A', route: null }, [{ route: { ref: 'RN1' } }, { route: { ref: 'RN2' } }]), { champs: {}, conflits: ['route'] });
  assert.deepEqual(fusionPossible({ name: 'A', route: { ref: 'RN9' } }, [{ name: 'B', route: { ref: 'RN1' } }]).champs, {});
});

test('chaîne A≈B≈C : chaque doublon est revérifié contre le conservé', () => {
  const a = barage({ name: 'X' });
  const b = barage({ name: 'X', latitude: a.latitude + 0.8 * M });
  const c = barage({ name: 'X', latitude: a.latitude + 1.6 * M });
  const r = detecter([a, b, c]);
  const supprimes = r.confirmes.flatMap((g) => g.doublons.map((d) => d.id));
  for (const g of r.confirmes) for (const d of g.doublons) assert.ok(d.distanceM <= 1, `${d.id} à ${d.distanceM} m`);
  assert.equal(new Set(supprimes).size, supprimes.length);
  assert.ok(r.potentiels.length >= 1, 'le maillon trop loin reste à vérifier');
});

test('périmètre : rien hors du périmètre choisi', () => {
  const s1 = barage({ name: 'S' });
  const s2 = { ...barage(), name: 'S' };
  const r1 = barage({ name: 'R', isSimulation: false, latitude: 34 });
  const r2 = { ...barage(), name: 'R', isSimulation: false, latitude: 34 };
  const r = detecter([s1, s2, r1, r2], undefined, undefined, { perimetre: { origine: 'reelle', reg: '', cie: '', bt: '' } });
  assert.deepEqual(r.confirmes.map((g) => g.conserve.id), [r1.id]);
  assert.equal(r.exclus, 2);
  // Ajouts locaux exclus sur demande.
  const local = { ...barage(), name: 'S' };
  const editions = { ...editionsVides(), ajouts: [local] };
  assert.equal(detecter([s1], editions, undefined, { inclureAjoutsLocaux: false }).confirmes.length, 0);
  assert.equal(detecter([s1], editions).confirmes.length, 1);
});

test('suppression : surcouche seulement, conservé intact (id, brigade, origine), autres barages inchangés', () => {
  const garde = barage({ name: 'G', route: null, validation: { methode: 'route-tuiles' } });
  const doublonFichier = { ...barage(), name: 'G', route: { ref: 'RN1' } };
  const autre = barage({ latitude: 34 });
  const doublonLocal = { ...barage(), name: 'G', id: 'BAR-LOCAL-1', route: { ref: 'RN1' } };
  const base = [garde, doublonFichier, autre];
  const editions = { ...editionsVides(), ajouts: [doublonLocal], modifs: { [autre.id]: { name: 'Modifié' } } };
  const avant = structuredClone(editions);
  const r = detecter(base, editions);
  assert.equal(r.confirmes.length, 1);
  const plan = planifierOptimisation(editions, r.confirmes);
  assert.deepEqual(editions, avant, 'la surcouche d’entrée n’est pas modifiée');
  assert.deepEqual(plan.editions.suppressions, [doublonFichier.id]);
  assert.deepEqual(plan.editions.ajouts, []);
  assert.deepEqual(plan.editions.modifs[garde.id], { route: { ref: 'RN1' } }, 'route manquante complétée');
  assert.deepEqual(plan.editions.modifs[autre.id], { name: 'Modifié' });
  const resultat = appliquerEditions(base, plan.editions).barages;
  assert.equal(resultat.length, 2);
  const g = resultat.find((b) => b.id === garde.id);
  assert.equal(g.btId, garde.btId);
  assert.equal(g.isSimulation, true);
  assert.deepEqual(resultat.find((b) => b.id === autre.id).name, 'Modifié');
  assert.deepEqual(base.map((b) => b.id), [garde.id, doublonFichier.id, autre.id], 'le fichier n’est jamais modifié');
});

test('sûreté du plan : incohérence → erreur, rien n’est produit', () => {
  const a = barage();
  const groupe = { id: 'G', conserve: { id: a.id, source: 'fichier', barage: a }, doublons: [{ id: 'SIM-BAR-X', source: 'fichier', barage: { ...a, isSimulation: false } }] };
  assert.throws(() => planifierOptimisation(editionsVides(), [groupe]), /simulé et réel/);
  const local = { id: 'G', conserve: { id: a.id, source: 'fichier', barage: a }, doublons: [{ id: 'BAR-ABSENT-1', source: 'local', barage: a }] };
  assert.throws(() => planifierOptimisation(editionsVides(), [local]), /ajout local/);
});

test('annulation : tout est rétabli ; les changements faits depuis ailleurs sont gardés ; conflit → rien', () => {
  const garde = barage({ name: 'G', route: null, validation: { methode: 'route-tuiles' } });
  const doublon = { ...barage(), name: 'G' };
  const local = { ...barage(), name: 'G', id: 'BAR-LOCAL-2' };
  const autre = barage({ latitude: 34 });
  const base = [garde, doublon, autre];
  const editions = { ...editionsVides(), ajouts: [local] };
  const r = detecter(base, editions);
  const plan = planifierOptimisation(editions, r.confirmes);
  const operation = { supprimes: plan.supprimes, fusions: plan.fusions };
  assert.equal(plan.fusions.length, 1, 'route complétée sur le conservé');
  assert.deepEqual(annulerOptimisation(plan.editions, operation).editions, editions);
  // Un autre barage modifié depuis : gardé.
  const ensuite = structuredClone(plan.editions);
  ensuite.modifs[autre.id] = { name: 'Plus tard' };
  const annule = annulerOptimisation(ensuite, operation).editions;
  assert.deepEqual(annule.modifs[autre.id], { name: 'Plus tard' });
  assert.equal(appliquerEditions(base, annule).barages.length, 4);
  // Le conservé modifié depuis : refus, rien n'est rendu.
  const conflit = structuredClone(plan.editions);
  conflit.modifs[garde.id] = { ...conflit.modifs[garde.id], route: { ref: 'RN7' } };
  assert.ok(annulerOptimisation(conflit, operation).conflits[0].includes(garde.id));
});

test('opération interrompue : l’état de la surcouche dit si elle a abouti', () => {
  const avant = editionsVides();
  const apres = { ...editionsVides(), suppressions: ['SIM-BAR-0001'] };
  const op = { editionsAvant: avant, editionsApres: apres };
  assert.equal(etatApresInterruption(op, apres), 'terminee');
  assert.equal(etatApresInterruption(op, avant), 'echec');
  assert.equal(etatApresInterruption(op, { ...avant, suppressions: ['autre'] }), 'inconnue');
});

test('historique des opérations : borné, relu sans erreur, dernière annulable', () => {
  let h = lireOperations({ operations: [{ id: 'x' }, null, 'y'] });
  assert.equal(h.operations.length, 0);
  for (let i = 0; i < 25; i++) h = ajouterOperation(h, { id: `OP-${i}`, statut: 'terminee', supprimes: [] });
  assert.equal(h.operations.length, 20);
  assert.equal(derniereAnnulable(h).id, 'OP-24');
  h = majOperation(h, { ...h.operations[0], statut: 'annulee' });
  assert.equal(derniereAnnulable(h).id, 'OP-23');
});

test('volume : 20 000 barages en moins de 2 s', () => {
  const base = [];
  for (let i = 0; i < 20_000; i++) base.push(barage({ name: `V${i}`, latitude: 30 + (i % 200) * 0.01, longitude: -8 + Math.floor(i / 200) * 0.01 }));
  for (let i = 0; i < 50; i++) base.push({ ...barage(), name: base[i * 7].name, latitude: base[i * 7].latitude, longitude: base[i * 7].longitude });
  const t0 = performance.now();
  const r = detecter(base);
  const ms = performance.now() - t0;
  assert.equal(r.confirmes.reduce((s, g) => s + g.doublons.length, 0), 50);
  assert.ok(ms < 2000, `${Math.round(ms)} ms`);
});
