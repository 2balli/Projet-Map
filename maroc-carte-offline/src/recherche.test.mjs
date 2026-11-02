import assert from 'node:assert/strict';
import test from 'node:test';
import { analyserCoordonnees, IndexRecherche, libelleLieu, normaliser, TYPES } from './recherche.js';

const T = Object.fromEntries(TYPES.map((t, i) => [t, i]));
const CASA = [-7.5898, 33.5731];
const RABAT = [-6.8416, 34.0209];
const e5 = (v) => Math.round(v * 1e5);
/** Petit index synthétique au format de recherche.json. */
function index(entrees, kinds = ['pharmacy', 'police', 'place_of_worship']) {
  return new IndexRecherche({ version: 1, contextes: [['Casablanca', 'الدار البيضاء'], ['Rabat', 'الرباط']], kinds, e: entrees });
}
const entree = (type, fr, ar, [lon, lat], { rang = 20, ctx = -1, kind = -1, autres = '' } = {}) =>
  [T[type], fr, ar, e5(lon), e5(lat), rang, ctx, kind, autres];

test('normalisation : accents, ponctuation, lettres doublées, variantes arabes', () => {
  assert.equal(normaliser('Laâyoune'), 'layoune');
  assert.equal(normaliser('Fès-Médina'), 'fes medina');
  assert.equal(normaliser('Mohammed'), normaliser('Mohamed'));
  assert.equal(normaliser('أكادير'), normaliser('اكادير'));
  assert.equal(normaliser('مَدْرَسَة'), normaliser('مدرسه'));
  assert.equal(normaliser('مستشفى'), normaliser('مستشفي'));
  assert.equal(normaliser("L'Oriental"), 'l oriental');
});

test('coordonnées décimales et DMS, dans les deux ordres', () => {
  assert.deepEqual(analyserCoordonnees('33.5731, -7.5898'), [-7.5898, 33.5731]);
  assert.deepEqual(analyserCoordonnees('33,5731 -7,5898'), [-7.5898, 33.5731]);
  assert.deepEqual(analyserCoordonnees('-7.5898, 33.5731'), [-7.5898, 33.5731]);
  const [lon, lat] = analyserCoordonnees('33°34′23″N 7°35′23″O');
  assert.ok(Math.abs(lat - 33.57306) < 1e-4 && Math.abs(lon + 7.58972) < 1e-4);
  assert.ok(analyserCoordonnees('23°41\'05" N, 15°57\'25" W'));
  assert.equal(analyserCoordonnees('Casablanca'), null);
  assert.equal(analyserCoordonnees('Hassan'), null);
});

test('une ville exacte passe devant les noms qui ne font que commencer pareil', () => {
  const idx = index([
    entree('lieu', 'Casa José', '', RABAT),
    entree('ville', 'Casablanca', 'الدار البيضاء', CASA, { rang: 90 }),
    entree('village', 'Casa de Campo', '', [-6, 35]),
  ]);
  assert.equal(idx.chercher('casa', { centre: RABAT })[0].nom, 'Casablanca');
  assert.equal(idx.chercher('الدار البيضاء', { langue: 'ar' })[0].nom, 'الدار البيضاء');
});

test('« casablanca » donne la ville, pas la région Casablanca-Settat', () => {
  const idx = index([
    entree('region', 'Casablanca-Settat', 'الدار البيضاء سطات', [-7.5, 32.9], { rang: 100 }),
    entree('ville', 'Casablanca', 'الدار البيضاء', CASA, { rang: 91 }),
    entree('region', 'Rabat-Salé-Kénitra', 'الرباط سلا القنيطرة', [-6.2, 34.1], { rang: 100 }),
    entree('ville', 'Rabat', 'الرباط', RABAT, { rang: 82 }),
  ]);
  assert.equal(idx.chercher('casablanca', { centre: RABAT })[0].type, 'ville');
  assert.equal(idx.chercher('rabat', { centre: CASA })[0].type, 'ville');
  assert.equal(idx.chercher('settat', { centre: CASA })[0].type, 'region');
});

test('abréviations et chiffres romains', () => {
  const idx = index([
    entree('rue', 'Avenue Mohammed VI', '', RABAT),
    entree('rue', 'Avenue Mohamed V', '', RABAT),
    entree('rue', 'Boulevard Zerktouni', '', CASA),
    entree('lieu', 'Mosquée Hassan II', '', CASA, { kind: 2 }),
  ]);
  assert.equal(idx.chercher('av mohammed v', { centre: RABAT })[0].nom, 'Avenue Mohamed V');
  assert.equal(idx.chercher('bd zerktouni', { centre: CASA })[0].nom, 'Boulevard Zerktouni');
  assert.equal(idx.chercher('hassan 2', { centre: CASA })[0].nom, 'Mosquée Hassan II');
});

test('une catégorie (« pharmacie », « مسجد ») renvoie d’abord les plus proches', () => {
  const idx = index([
    entree('lieu', 'Pharmacie Atlas', '', RABAT, { kind: 0 }),
    entree('lieu', 'Pharmacie Anfa', '', [CASA[0] + 0.01, CASA[1]], { kind: 0 }),
    entree('lieu', 'Dar Lmouhit', '', [CASA[0] + 0.001, CASA[1]], { kind: 0 }), // pharmacie sans le mot dans son nom
    entree('lieu', 'Jamaa Lkbir', '', CASA, { kind: 2 }),
  ]);
  const proches = idx.chercher('pharmacie', { centre: CASA }).map((r) => r.nom);
  assert.deepEqual(proches.slice(0, 2).sort(), ['Dar Lmouhit', 'Pharmacie Anfa']);
  assert.equal(proches.at(-1), 'Pharmacie Atlas');
  assert.equal(idx.chercher('مسجد', { centre: CASA, langue: 'ar' })[0].nom, 'Jamaa Lkbir');
});

test('une rue découpée en plusieurs tronçons n’apparaît qu’une fois par ville', () => {
  const idx = index([
    entree('rue', 'Boulevard Anfa', '', CASA, { ctx: 0 }),
    entree('rue', 'Boulevard Anfa', '', [CASA[0] + 0.02, CASA[1]], { ctx: 0 }),
    entree('rue', 'Boulevard Anfa', '', RABAT, { ctx: 1 }),
  ]);
  const r = idx.chercher('anfa', { centre: CASA });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.contexte), ['Casablanca', 'Rabat']);
});

test('description d’un résultat : libellés, langue, zoom', () => {
  const idx = index([entree('lieu', 'Gendarmerie Royale', 'الدرك الملكي', RABAT, { ctx: 1, kind: 1 })]);
  const fr = idx.chercher('gendarmerie')[0];
  assert.equal(fr.libelle, 'Police / Gendarmerie');
  assert.equal(fr.nomSecondaire, 'الدرك الملكي');
  assert.equal(fr.contexte, 'Rabat');
  assert.equal(fr.zoom, 17);
  const ar = idx.chercher('الدرك', { langue: 'ar' })[0];
  assert.equal(ar.nom, 'الدرك الملكي');
  assert.equal(ar.contexte, 'الرباط');
  assert.equal(libelleLieu('pharmacy', 'ar'), 'صيدلية');
  assert.equal(libelleLieu('some_new_kind'), 'Some new kind');
  assert.throws(() => new IndexRecherche({ version: 99 }), /version/);
});

test('fusion d’index : contextes et catégories renumérotés, entrées des deux index cherchables', async () => {
  const { fusionnerIndex } = await import('./recherche.js');
  const a = { version: 1, contextes: [['Rabat', 'الرباط']], kinds: ['pharmacy'], e: [[4, 'Pharmacie Agdal', '', -685000, 3399000, 10, 0, 0, '']] };
  const b = { version: 1, contextes: [['Cie Rabat · Rég. Rabat', '']], kinds: ['gr_bt', 'pharmacy'], e: [[8, 'BT Agdal', '', -684000, 3398000, 50, 0, 0, 'gendarmerie']] };
  const fusion = fusionnerIndex(a, b);
  assert.deepEqual(fusion.kinds, ['pharmacy', 'gr_bt']);
  assert.equal(fusion.contextes.length, 2);
  assert.deepEqual(fusion.e[1].slice(6, 8), [1, 1]);
  assert.equal(a.e.length, 1, 'index d’origine intact');
  const index = new IndexRecherche(fusion);
  const noms = index.chercher('agdal').map((r) => r.nom);
  assert.ok(noms.includes('BT Agdal') && noms.includes('Pharmacie Agdal'));
  const bt = index.chercher('bt agdal')[0];
  assert.equal(bt.type, 'brigade');
  assert.equal(bt.contexte, 'Cie Rabat · Rég. Rabat');
});
