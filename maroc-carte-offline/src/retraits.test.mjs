import assert from 'node:assert/strict';
import test from 'node:test';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import {
  appliquerEditions, editionsVides, entitesRetires, expressionFiltreRetires, lireEditions, restaurerBarage, retirerBarage, retirerSimules,
  retraitsAffiches,
} from './barages.js';
import { planifierOptimisation } from './dedoublonnage.js';
import { REGLES_PROXIMITE, classerCandidat, pairesCandidates, validerEspacement, voisinsRequis } from './proximite.js';

const b = (id, champs = {}) => ({
  id, name: `Barage ${id}`, type: 'fixe', shift: '00-06', latitude: 33.5, longitude: -7.6, btId: 'bt-1', isSimulation: true,
  route: { ref: 'RN1', nom: null, classe: 'primary' }, ...champs,
});
const ids = (liste) => new Set(liste.map((x) => x.id));
const actifs = (base, e) => appliquerEditions(base, e).barages;
const enrs = (liste) => liste.map((x, rang) => ({ barage: x, source: 'fichier', rang }));
const date = new Date('2026-10-14T10:00:00Z');

test('retrait d’un barage du fichier : hors du jeu actif, historique complet, modifications gardées', () => {
  const base = [b('SIM-BAR-0001'), b('SIM-BAR-0002')];
  const e0 = { ...editionsVides(), modifs: { 'SIM-BAR-0001': { name: 'Renommé' } } };
  const affiche = actifs(base, e0).find((x) => x.id === 'SIM-BAR-0001');
  const r = retirerBarage(e0, affiche, 'fichier', { date });
  assert.deepEqual(actifs(base, r.editions).map((x) => x.id), ['SIM-BAR-0002']);
  assert.deepEqual(r.editions.suppressions, ['SIM-BAR-0001']);
  assert.deepEqual(r.editions.modifs, e0.modifs, 'gardées pour une restauration fidèle');
  const h = r.editions.retraits[0];
  assert.equal(h.barageId, 'SIM-BAR-0001');
  assert.equal(h.source, 'fichier');
  assert.equal(h.retireLe, '2026-10-14T10:00:00.000Z');
  assert.equal(h.restaureLe, null);
  assert.deepEqual(h.barage, affiche, 'identifiant, nom, faction, type, brigade, coordonnées, métadonnées');
  assert.deepEqual(e0.suppressions, [], 'la surcouche d’entrée n’est pas modifiée');
  assert.match(retirerBarage(r.editions, affiche, 'fichier').erreur, /déjà retiré/);
});

test('retrait d’un ajout local : retiré des ajouts, copie dans l’historique', () => {
  const local = b('BAR-LOCAL-1', { isSimulation: false });
  const e0 = { ...editionsVides(), ajouts: [local] };
  const r = retirerBarage(e0, local, 'local', { date });
  assert.deepEqual(r.editions.ajouts, []);
  assert.deepEqual(r.editions.retraits[0].barage, local);
  assert.match(retirerBarage(e0, b('BAR-AUTRE-1'), 'local').erreur, /pas un ajout local/);
});

test('historique : relu du stockage après rechargement (même clé que la surcouche), entrées invalides ignorées', () => {
  const r = retirerBarage(editionsVides(), b('SIM-BAR-0001'), 'fichier', { date });
  const relu = lireEditions(JSON.parse(JSON.stringify(r.editions)));
  assert.deepEqual(relu, r.editions);
  const abime = lireEditions({ ...r.editions, retraits: [...r.editions.retraits, null, { id: 'x' }, { ...r.editions.retraits[0], barageId: 'autre' }] });
  assert.equal(abime.retraits.length, 1);
});

test('marqueurs : non restaurés et pas de nouveau actifs ; entités à part, filtre géographique et d’origine', () => {
  const base = [b('SIM-BAR-0001', { btId: 'bt-1' }), b('SIM-BAR-0002', { btId: 'bt-2', isSimulation: false })];
  let e = editionsVides();
  for (const x of base) e = retirerBarage(e, x, 'fichier', { date }).editions;
  const affiches = retraitsAffiches(e, ids(actifs(base, e)));
  assert.deepEqual(affiches.map((r) => r.barageId).sort(), ['SIM-BAR-0001', 'SIM-BAR-0002']);
  // Remis en service par un autre chemin (suppression levée) : plus de marqueur.
  const leve = { ...e, suppressions: ['SIM-BAR-0002'] };
  assert.deepEqual(retraitsAffiches(leve, ids(actifs(base, leve))).map((r) => r.barageId), ['SIM-BAR-0002']);
  const hierarchie = { brigades: new Map([['bt-1', { cieId: 'cie-1', regId: 'reg-1' }], ['bt-2', { cieId: 'cie-2', regId: 'reg-2' }]]) };
  const f = entitesRetires(affiches, hierarchie);
  assert.ok(f.every((x) => x.properties.retire === true && x.geometry.type === 'Point'));
  const garde = (filtres) => f.filter((x) => { const exp = expressionFiltreRetires(filtres); return !exp || featureFilter(exp, 'layers[0].filter').filter({ zoom: 10 }, x); }).map((x) => x.properties.id);
  assert.deepEqual(garde({ reg: 'reg-1' }), ['SIM-BAR-0001']);
  assert.deepEqual(garde({ origine: 'reel' }), ['SIM-BAR-0002']);
  assert.deepEqual(garde({ reg: '', origine: 'tous', faction: '06-12', type: 'intouchable' }).length, 2, 'type et faction actifs ne filtrent pas l’historique');
});

test('restauration : enregistrement d’origine rétabli, statut mis à jour, double restauration refusée', () => {
  const base = [b('SIM-BAR-0001')];
  const local = b('BAR-LOCAL-1');
  let e = { ...editionsVides(), ajouts: [local], modifs: { 'SIM-BAR-0001': { name: 'Renommé' } } };
  e = retirerBarage(e, actifs(base, e)[0], 'fichier', { date }).editions;
  e = retirerBarage(e, local, 'local', { date }).editions;
  assert.equal(actifs(base, e).length, 0);
  const [rf, rl] = e.retraits;
  const r1 = restaurerBarage(e, rf.id, ids(actifs(base, e)));
  assert.equal(actifs(base, r1.editions).find((x) => x.id === 'SIM-BAR-0001').name, 'Renommé', 'avec ses modifications d’avant');
  assert.ok(r1.editions.retraits.find((x) => x.id === rf.id).restaureLe);
  assert.match(restaurerBarage(r1.editions, rf.id, ids(actifs(base, r1.editions))).erreur, /déjà été restauré/);
  const r2 = restaurerBarage(r1.editions, rl.id, ids(actifs(base, r1.editions)));
  assert.deepEqual(actifs(base, r2.editions).find((x) => x.id === 'BAR-LOCAL-1'), local);
  assert.equal(retraitsAffiches(r2.editions, ids(actifs(base, r2.editions))).length, 0, 'plus de marqueur');
  // Doublon : un barage actif porte déjà l'identifiant.
  const e3 = retirerBarage({ ...editionsVides(), ajouts: [local] }, local, 'local').editions;
  const e3bis = { ...e3, ajouts: [local] };
  assert.match(restaurerBarage(e3bis, e3.retraits[0].id, ids(actifs([], e3bis))).erreur, /déjà actif/);
  assert.match(restaurerBarage(e, 'RET-INCONNU', new Set()).erreur, /introuvable/);
});

test('autres écritures de la surcouche : l’historique est conservé', () => {
  const base = [b('SIM-BAR-0001'), b('SIM-BAR-0002', { latitude: 34 })];
  const e = retirerBarage(editionsVides(), base[0], 'fichier', { date }).editions;
  assert.equal(retirerSimules(base, e).retraits.length, 1);
  const g = { id: 'G', conserve: { id: 'SIM-BAR-0002', source: 'fichier', barage: base[1] }, doublons: [], fusion: { champs: {}, conflits: [] } };
  assert.equal(planifierOptimisation(e, [g]).editions.retraits.length, 1);
});

test('barages retirés : jamais dans les calculs (paires, espacement, carte de chaleur, doublons)', () => {
  const garde = b('SIM-BAR-0001');
  const retire = b('SIM-BAR-0002', { longitude: -7.6005 }); // à ~45 m, même faction
  const base = [garde, retire];
  const e = retirerBarage(editionsVides(), retire, 'fichier', { date }).editions;
  const jeu = enrs(actifs(base, e));
  const regles = { ...REGLES_PROXIMITE, origine: 'toutes', distanceMaxKm: 5 };
  assert.equal(pairesCandidates(jeu, regles).candidats.length, 0, 'aucune alerte de proximité');
  assert.equal(pairesCandidates(enrs(base), regles).candidats.length, 1, 'alors qu’actif, il en donnerait une');
  const requis = voisinsRequis([-7.6005, 33.5], { type: 'fixe', shift: '00-06', isSimulation: true }, jeu, 5000);
  assert.deepEqual(requis.map((x) => x.barage.id), ['SIM-BAR-0001'], 'l’ancien emplacement n’est pas un voisin');
  const v = validerEspacement(requis.map((enr) => ({ enr, route: { statut: 'ok', distance: 8000 } })), 5000);
  assert.equal(classerCandidat(v), 'adapte');
});

test('nouvel identifiant : jamais celui d’un barage retiré (pas de collision à la restauration)', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./couche-barages.js', import.meta.url), 'utf8');
  assert.match(src, /retraits \?\? \[\]\)\.map\(\(r\) => r\.barageId\)/);
});

// ── Barages fixes intouchables : protégés au niveau des règles et de l'écriture ──

test('protection : un intouchable ne se retire pas ; toute écriture qui le déplace, le retire ou le modifie est détectée', async () => {
  const { atteintesProtegees, estProtege, MESSAGE_PROTEGE } = await import('./barages.js');
  const i24 = b('SIM-BAR-0101', { type: 'intouchable', shift: 'continu' });
  const mobile = b('SIM-BAR-0102');
  const base = [i24, mobile];
  assert.equal(estProtege(i24), true);
  assert.equal(retirerBarage(editionsVides(), i24, 'fichier').erreur, MESSAGE_PROTEGE);
  const e0 = editionsVides();
  const deplace = { ...e0, modifs: { 'SIM-BAR-0101': { latitude: 33.6 } } };
  const supprime = { ...e0, suppressions: ['SIM-BAR-0101'] };
  const renomme = { ...e0, modifs: { 'SIM-BAR-0101': { name: 'autre' } } };
  for (const apres of [deplace, supprime, renomme]) assert.deepEqual(atteintesProtegees(base, e0, apres), ['SIM-BAR-0101']);
  // Le barage déplaçable peut changer ; un ajout ne touche pas l'intouchable.
  assert.deepEqual(atteintesProtegees(base, e0, { ...e0, modifs: { 'SIM-BAR-0102': { latitude: 33.7 } } }), []);
  assert.deepEqual(atteintesProtegees(base, e0, { ...e0, ajouts: [b('BAR-N-1')] }), []);
  // Restaurer un intouchable retiré autrefois (avant cette règle) n'est pas une atteinte.
  assert.deepEqual(atteintesProtegees(base, supprime, e0), []);
});

test('protection : le dédoublonnage garde toujours l’intouchable et ne le supprime jamais', async () => {
  const { detecterDoublons, REGLES_DEDOUBLONNAGE } = await import('./dedoublonnage.js');
  const i1 = b('SIM-BAR-0201', { type: 'intouchable', shift: 'continu', name: 'X' });
  const i2 = b('SIM-BAR-0202', { type: 'intouchable', shift: 'continu', name: 'X' });
  const det = detecterDoublons({ enregistrements: enrs([i1, i2]) }, REGLES_DEDOUBLONNAGE);
  assert.equal(det.confirmes.length, 0, 'deux intouchables identiques : jamais de suppression');
  assert.ok(det.potentiels.some((p) => p.raisons.some((r) => /intouchable/.test(r))));
  const g = { id: 'G', conserve: { id: 'SIM-BAR-0201', source: 'fichier', barage: i1 }, doublons: [{ id: 'SIM-BAR-0202', source: 'fichier', barage: i2 }], fusion: { champs: {}, conflits: [] } };
  assert.throws(() => planifierOptimisation(editionsVides(), [g]), /intouchable/);
});
