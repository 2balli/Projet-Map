import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import test from 'node:test';
import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { PMTiles } from 'pmtiles';
import {
  CLASSES_ROUTE, CONTINU, COUCHES_BARAGES, COUCHE_EDITION, CRENEAUX, FILTRES_DEFAUT, FORMAT_BARAGES, NON_AFFECTE, RAYON_ACCROCHE_M,
  SANS_COMPAGNIE, SOURCE_BARAGES, TYPES_BARAGE, VERSION_BARAGES,
  accrocherARoute, appliquerEditions, construireHierarchie, correspond, couchesBarages, editionsVides, entitesBarages, expressionFiltre,
  generateur, genererBarages, jeuExporte, jeuSimulation, lireEditions, lireJeuBarages, nombreEditions, normaliserFiltres, numeroFaction, optionsFiltres,
  placeurSurRoute, surUneRoute, trierBarages, typeEtFaction, validerBarage,
  COUCHES_AGREGATS, SOURCE_AGREGATS, TAILLES_ICONE, ZOOM_BADGES, ZOOM_CIE, ZOOM_DETAIL, agregerBarages, factionDeLHeure, filtrePour,
  niveauAuZoom, refusModification, retirerSimules, traceValidation, validerEmplacement,
} from './barages.js';
import { contient } from './competence.js';
import { couchesGendarmerie } from './gendarmerie-style.js';
import { ReseauRoutier } from './itineraire.js';
import { distanceMetres } from './mesure.js';

// Référentiel factice : 2 régions, 2 compagnies, 4 brigades (carrés de 0,2°).
const carre = (x, y) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 0.2, y], [x + 0.2, y + 0.2], [x, y + 0.2], [x, y]]] });
const circoBt = (i, nom, cie, reg, x, y) => ({ type: 'Feature', geometry: carre(x, y), properties: { niveau: 'bt', id: `bt-${i}`, nom, cie, reg } });
const FIXTURE = {
  reg: [{ id: 'reg-0', nom: 'Rabat' }, { id: 'reg-1', nom: 'Fès' }],
  cie: [{ id: 'cie-0', nom: 'Témara', reg: 'Rabat' }, { id: 'cie-1', nom: 'Sefrou', reg: 'Fes' }],
  bt: [
    circoBt(0, 'Skhirat', 'Temara', 'Rabat', -7.0, 33.8),
    circoBt(1, 'Harhoura', 'Témara', 'Rabat', -6.8, 33.8),
    circoBt(2, 'Bhalil', 'Sefrou', 'Fès', -5.0, 33.8),
    // Compagnie sans circonscription (comme Nouaceur dans les données réelles) : région par la brigade.
    circoBt(3, 'Imouzzer', 'Inexistante', 'Fès', -5.2, 33.6),
  ],
};
const hierarchie = construireHierarchie({ reg: FIXTURE.reg, cie: FIXTURE.cie, bt: FIXTURE.bt.map((f) => f.properties) });

// Réseau routier factice (même forme que ReseauRoutier.lignes) : dans chaque brigade, une route
// carrossable en travers, une voie de service et un chemin, qui ne doivent jamais porter de barage.
const ROUTES = FIXTURE.bt.flatMap(({ geometry }) => {
  const [x, y] = geometry.coordinates[0][0];
  return [
    { classe: 'tertiary', nom: 'Route de test', ref: 'R1', points: [[x + 0.01, y + 0.1], [x + 0.19, y + 0.1]] },
    { classe: 'service', nom: 'Accès', ref: null, points: [[x + 0.01, y + 0.05], [x + 0.19, y + 0.05]] },
    { classe: 'alley', nom: null, ref: null, points: [[x + 0.01, y + 0.15], [x + 0.19, y + 0.15]] },
  ];
});
const lireRoutes = async () => ({ z: 15, lignes: ROUTES });
const placer = placeurSurRoute(lireRoutes);
const surRouteFixture = (b) => ROUTES.some((r) => r.classe === 'tertiary' && Math.abs(b.latitude - r.points[0][1]) < 1e-9 && b.longitude >= r.points[0][0] && b.longitude <= r.points[1][0]);

const barageValide = (champs = {}) => ({
  id: 'SIM-BAR-0001', name: 'Barage simulé 0001', type: 'fixe', latitude: 33.9, longitude: -6.9, btId: 'bt-0', shift: '06-12', isSimulation: true, ...champs,
});

// ── Routes ─────────────────────────────────────────────────────────────────

test('accroche : route carrossable la plus proche, jamais une voie de service ou une ruelle', () => {
  // À 50 m au nord de la voie de service, à 5,5 km de la route : rien dans le rayon de 150 m.
  assert.equal(accrocherARoute([-6.9, 33.8505], ROUTES), null);
  // À 60 m de la route : accroché dessus, à 60 m près.
  const a = accrocherARoute([-6.95, 33.90054], ROUTES);
  assert.deepEqual(a.point, [-6.95, 33.9]);
  assert.ok(Math.abs(a.distance - 60) < 1, String(a.distance));
  assert.deepEqual(a.route, { nom: 'Route de test', ref: 'R1', classe: 'tertiary' });
  // Au-delà du rayon : refusé, pas de position arbitraire.
  assert.equal(accrocherARoute([-6.95, 33.9 + (RAYON_ACCROCHE_M + 20) / 111_195], ROUTES), null);
  // Contrainte de circonscription : à égale distance des routes de deux brigades voisines,
  // seule celle de la brigade demandée est retenue.
  const limite = [-6.8, 33.9];
  const dans = (i) => (p) => contient(FIXTURE.bt[i].geometry, p);
  assert.deepEqual(accrocherARoute(limite, ROUTES, { rayonMax: 1000, dans: dans(0) }).point, [-6.81, 33.9]);
  assert.deepEqual(accrocherARoute(limite, ROUTES, { rayonMax: 1000, dans: dans(1) }).point, [-6.79, 33.9]);
  assert.equal(accrocherARoute(limite, ROUTES, { rayonMax: 1000, dans: dans(2) }), null);
  assert.ok(['service', 'alley', 'footway', 'rail', 'path'].every((c) => !CLASSES_ROUTE.has(c)));
  assert.ok(['motorway', 'primary', 'tertiary', 'residential', 'unclassified', 'track'].every((c) => CLASSES_ROUTE.has(c)));
});

test('placement : sans route lisible, aucun barage n’est posé', async () => {
  const vide = placeurSurRoute(async () => ({ lignes: [] }));
  assert.equal(await vide([-6.9, 33.9], FIXTURE.bt[0].geometry), null);
  const illisible = placeurSurRoute(async () => null);
  assert.equal(await illisible([-6.9, 33.9], FIXTURE.bt[0].geometry), null);
  await assert.rejects(genererBarages(FIXTURE.bt, { nombre: 5, placer: vide }), /sans route/);
  await assert.rejects(genererBarages(FIXTURE.bt, { nombre: 5 }), /placement sur route requis/);
});

test('vérification d’un jeu : sur la route ou hors route', async () => {
  assert.equal(await surUneRoute(barageValide({ latitude: 33.9, longitude: -6.95 }), lireRoutes), true);
  assert.equal(await surUneRoute(barageValide({ latitude: 33.92, longitude: -6.95 }), lireRoutes), false);
  assert.equal(await surUneRoute(barageValide({ latitude: 33.85, longitude: -6.95 }), lireRoutes), false); // voie de service
});

// ── Génération ─────────────────────────────────────────────────────────────

test('générateur : même graine, même suite ; graines différentes, suites différentes', () => {
  const [a, b, c] = [generateur(42), generateur(42), generateur(43)];
  const suite = (g) => Array.from({ length: 5 }, g);
  const sa = suite(a);
  assert.deepEqual(sa, suite(b));
  assert.notDeepEqual(sa, suite(c));
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('génération déterministe : ≈ 1 000 barages, identifiants uniques et stables', async () => {
  const a = await genererBarages(FIXTURE.bt, { graine: 7, nombre: 1000, placer });
  assert.equal(a.length, 1000);
  assert.deepEqual(await genererBarages(FIXTURE.bt, { graine: 7, nombre: 1000, placer }), a);
  assert.notDeepEqual(await genererBarages(FIXTURE.bt, { graine: 8, nombre: 1000, placer }), a);
  assert.equal(new Set(a.map((b) => b.id)).size, 1000);
  assert.equal(a[0].id, 'SIM-BAR-0001');
  assert.equal(a.at(-1).id, 'SIM-BAR-1000');
  // L'ordre des circonscriptions dans le fichier ne change pas le résultat.
  assert.deepEqual(await genererBarages([...FIXTURE.bt].reverse(), { graine: 7, nombre: 1000, placer }), a);
});

test('génération : sur une route de sa brigade, marqueur de simulation, règles de type', async () => {
  const barages = await genererBarages(FIXTURE.bt, { graine: 3, nombre: 400, placer });
  const parId = new Map(FIXTURE.bt.map((f) => [f.properties.id, f.geometry]));
  for (const b of barages) {
    assert.ok(surRouteFixture(b), `${b.id} hors de la route carrossable`);
    assert.ok(contient(parId.get(b.btId), [b.longitude, b.latitude]), `${b.id} hors de ${b.btId}`);
    assert.deepEqual(b.route, { nom: 'Route de test', ref: 'R1', classe: 'tertiary' });
    assert.equal(b.isSimulation, true);
    assert.ok(TYPES_BARAGE.includes(b.type));
    if (b.type === 'fixe') assert.ok(CRENEAUX.includes(b.shift), b.id);
    else assert.equal(b.shift, CONTINU, b.id);
    assert.deepEqual(validerBarage(b, hierarchie), [], b.id);
  }
  const intouchables = barages.filter((b) => b.type === 'intouchable').length;
  assert.ok(intouchables > 20 && intouchables < 120, `${intouchables} intouchables sur 400`);
  for (const c of CRENEAUX) assert.ok(barages.some((b) => b.shift === c), c);
});

test('génération : sans circonscription de brigade, aucune donnée inventée', async () => {
  await assert.rejects(genererBarages([], { placer }), /aucune circonscription/);
  await assert.rejects(genererBarages([{ type: 'Feature', geometry: carre(0, 0), properties: { id: 'cie-3' } }], { placer }), /aucune circonscription/);
});

// ── Validation, lecture, hiérarchie ────────────────────────────────────────

test('validation : type et faction cohérents, coordonnées, brigade, marqueur', () => {
  assert.deepEqual(validerBarage(barageValide(), hierarchie), []);
  assert.deepEqual(validerBarage(barageValide({ type: 'intouchable', shift: CONTINU }), hierarchie), []);
  assert.deepEqual(validerBarage(barageValide({ route: { nom: 'N9', ref: 'N9', classe: 'primary' } }), hierarchie), []);
  const erreur = (champs, motif) => assert.match(validerBarage(barageValide(champs), hierarchie).join(' | '), motif);
  erreur({ type: 'mobile' }, /type inconnu/);
  erreur({ shift: CONTINU }, /fixe sans faction/);
  erreur({ shift: undefined }, /fixe sans faction/);
  erreur({ shift: '06-14' }, /fixe sans faction/);
  erreur({ type: 'intouchable', shift: '06-12' }, /intouchable affecté à une faction/);
  erreur({ type: 'intouchable', shift: null }, /intouchable affecté à une faction/);
  erreur({ latitude: 48.85, longitude: 2.35 }, /hors du Royaume/);
  erreur({ latitude: '33.9' }, /coordonnées/);
  erreur({ btId: 'bt-99' }, /brigade inconnue/);
  erreur({ btId: undefined }, /btId/);
  erreur({ isSimulation: 'oui' }, /isSimulation/);
  erreur({ id: '' }, /identifiant/);
  erreur({ route: 'N9' }, /route invalide/);
  assert.deepEqual(validerBarage(null), ['enregistrement invalide']);
  assert.deepEqual(validerBarage(barageValide({ btId: 'bt-99' })), []); // sans référentiel, brigade non vérifiée
});

test('lecture d’un jeu : enregistrements invalides et doublons écartés, simulation signalée', () => {
  const jeu = jeuSimulation([
    barageValide(),
    barageValide({ id: 'SIM-BAR-0001' }), // doublon
    barageValide({ id: 'SIM-BAR-0002', btId: 'bt-42' }), // brigade inconnue
    barageValide({ id: 'SIM-BAR-0003', type: 'intouchable', shift: CONTINU, btId: 'bt-3' }),
  ], { graine: 1 });
  assert.equal(jeu.format, FORMAT_BARAGES);
  assert.equal(jeu.version, VERSION_BARAGES);
  const lu = lireJeuBarages(jeu, hierarchie);
  assert.deepEqual(lu.barages.map((b) => b.id), ['SIM-BAR-0001', 'SIM-BAR-0003']);
  assert.deepEqual(lu.rejetes.map((r) => r.id), ['SIM-BAR-0001', 'SIM-BAR-0002']);
  assert.match(lu.rejetes[0].erreurs[0], /double/);
  assert.equal(lu.simulation, true);
  // Un jeu validé (futur) se lit avec le même code et n'est pas présenté comme une simulation.
  const valide = lireJeuBarages({ ...jeu, simulation: false, barages: [barageValide({ isSimulation: false })] }, hierarchie);
  assert.equal(valide.simulation, false);
  assert.throws(() => lireJeuBarages({ ...jeu, version: 2 }), /format ou version/);
  assert.throws(() => lireJeuBarages({ type: 'FeatureCollection', features: [] }), /format ou version/);
});

test('hiérarchie : BT → CIE → REG par les noms, sans rattachement inventé', () => {
  const { brigades, compagnies, anomalies } = hierarchie;
  assert.deepEqual(compagnies.get('cie-1'), { id: 'cie-1', nom: 'Sefrou', regId: 'reg-1' }); // « Fes » = « Fès »
  assert.deepEqual(brigades.get('bt-0'), { id: 'bt-0', nom: 'Skhirat', cieId: 'cie-0', cieSource: 'Temara', regId: 'reg-0', regPar: 'compagnie' });
  assert.deepEqual(brigades.get('bt-3'), { id: 'bt-3', nom: 'Imouzzer', cieId: null, cieSource: 'Inexistante', regId: 'reg-1', regPar: 'brigade' });
  assert.deepEqual(anomalies, { compagnieInconnue: ['bt-3'], regionInconnue: [], incoherences: [] });
});

test('hiérarchie : noms ambigus, régions inconnues et incohérences signalés', () => {
  const h = construireHierarchie({
    reg: [{ id: 'reg-0', nom: 'Rabat' }, { id: 'reg-1', nom: 'Fès' }],
    cie: [{ id: 'cie-0', nom: 'Centre', reg: 'Rabat' }, { id: 'cie-1', nom: 'Centre', reg: 'Fès' }, { id: 'cie-2', nom: 'Nord', reg: 'Rabat' }],
    bt: [
      { id: 'bt-0', nom: 'A', cie: 'Centre', reg: 'Rabat' }, // deux compagnies « Centre » : ambigu
      { id: 'bt-1', nom: 'B', cie: 'Nord', reg: 'Fès' }, // la compagnie dit Rabat, la brigade Fès
      { id: 'bt-2', nom: 'C', cie: 'Inconnue', reg: 'Atlantide' },
    ],
  });
  assert.equal(h.brigades.get('bt-0').cieId, null);
  assert.equal(h.brigades.get('bt-0').regId, 'reg-0');
  assert.equal(h.brigades.get('bt-1').regId, 'reg-0'); // chaîne BT → CIE → REG
  assert.equal(h.brigades.get('bt-2').regId, null);
  assert.deepEqual(h.anomalies, { compagnieInconnue: ['bt-0', 'bt-2'], regionInconnue: ['bt-2'], incoherences: ['bt-1'] });
});

// ── Filtres ────────────────────────────────────────────────────────────────

const barages = await genererBarages(FIXTURE.bt, { graine: 11, nombre: 1000, placer });
// Une partie des barages marqués « réels » (comme après une saisie dans la carte).
const melanges = barages.map((b, i) => (i % 5 === 0 ? { ...b, isSimulation: false } : b));
const entites = entitesBarages(melanges, hierarchie);
const proprietes = entites.map((f) => f.properties);
const compte = (f) => proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, ...f })).length;

test('entités : compagnie et région résolues, compagnie inconnue explicite, route', () => {
  assert.equal(entites.length, 1000);
  const p = proprietes.find((x) => x.btId === 'bt-3');
  assert.equal(p.cieId, SANS_COMPAGNIE);
  assert.equal(p.regId, 'reg-1');
  assert.equal(p.routeRef, 'R1');
  assert.ok(proprietes.filter((x) => x.btId === 'bt-0').every((x) => x.cieId === 'cie-0' && x.regId === 'reg-0'));
  const h = construireHierarchie({ reg: [], cie: [], bt: [{ id: 'bt-0', nom: 'A', cie: 'X', reg: 'Y' }] });
  assert.equal(entitesBarages([barageValide()], h)[0].properties.regId, '');
});

test('filtres REG / CIE / BT / type / origine', () => {
  assert.equal(compte({}), 1000);
  assert.equal(compte({ reg: 'reg-0' }) + compte({ reg: 'reg-1' }), 1000);
  assert.ok(proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, reg: 'reg-1' })).every((p) => ['bt-2', 'bt-3'].includes(p.btId)));
  assert.equal(compte({ cie: 'cie-0' }), compte({ bt: 'bt-0' }) + compte({ bt: 'bt-1' }));
  assert.equal(compte({ cie: SANS_COMPAGNIE }), compte({ bt: 'bt-3' }));
  assert.equal(compte({ reg: 'reg-0', bt: 'bt-2' }), 0);
  assert.equal(compte({ type: 'fixe' }) + compte({ type: 'intouchable' }), 1000);
  assert.equal(compte({ origine: 'simulation' }), 800);
  assert.equal(compte({ origine: 'reelle' }), 200);
});

test('faction : chaque faction, toutes les factions et « non affecté »', () => {
  const intouchables = compte({ type: 'intouchable' });
  let fixes = 0;
  for (const c of CRENEAUX) {
    const gardes = proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, faction: c }));
    // Les fixes de cette faction seulement, et TOUS les intouchables (actifs 24 h/24).
    assert.ok(gardes.every((p) => p.type === 'intouchable' || p.shift === c), c);
    assert.equal(gardes.filter((p) => p.type === 'intouchable').length, intouchables, c);
    fixes += gardes.filter((p) => p.type === 'fixe').length;
  }
  // Chaque fixe a exactement une faction ; les intouchables n'en ont pas.
  assert.equal(fixes, 1000 - intouchables);
  const nonAffectes = proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, faction: NON_AFFECTE }));
  assert.equal(nonAffectes.length, intouchables);
  assert.ok(nonAffectes.every((p) => p.type === 'intouchable'));
  assert.equal(compte({ faction: '' }), 1000);
  // Le filtre ne touche pas aux données.
  assert.equal(entites.length, 1000);
});

test('faction 1 à 4 : numérotée dans l’ordre de la journée ; « faction 1 » = faction 1 + intouchables', () => {
  assert.deepEqual(CRENEAUX.map(numeroFaction), [1, 2, 3, 4]);
  assert.equal(numeroFaction(CONTINU), null);
  const faction1 = proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, faction: CRENEAUX[0] }));
  assert.ok(faction1.some((p) => p.type === 'fixe') && faction1.some((p) => p.type === 'intouchable'));
  assert.ok(faction1.every((p) => numeroFaction(p.shift) === 1 || p.type === 'intouchable')); // aucune autre faction
  const { filter } = featureFilter(expressionFiltre({ ...FILTRES_DEFAUT, faction: CRENEAUX[0] }), 'layers[0].filter');
  assert.equal(entites.filter((e) => filter({ zoom: 10 }, { type: 1, properties: e.properties })).length, faction1.length);
});

test('faction combinée aux autres filtres', () => {
  for (const faction of [...CRENEAUX, NON_AFFECTE]) {
    for (const autres of [{ reg: 'reg-1' }, { cie: 'cie-0' }, { bt: 'bt-3' }, { origine: 'reelle' }, { type: 'fixe' }, { reg: 'reg-0', origine: 'simulation', type: 'fixe' }]) {
      const f = { ...FILTRES_DEFAUT, ...autres, faction };
      const attendu = proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, ...autres }) && correspond(p, { ...FILTRES_DEFAUT, faction })).length;
      assert.equal(compte(f), attendu, JSON.stringify(f));
    }
  }
  // Les intouchables restent quelle que soit la faction ; seul le type « Fixes » les masque.
  assert.equal(compte({ type: 'intouchable', faction: '00-06' }), compte({ type: 'intouchable' }));
  assert.ok(compte({ type: 'fixe', faction: '00-06' }) > 0);
  assert.ok(proprietes.filter((p) => correspond(p, { ...FILTRES_DEFAUT, type: 'fixe', faction: '00-06' })).every((p) => p.shift === '00-06'));
  assert.equal(compte({ type: 'fixe', faction: NON_AFFECTE }), 0);
});

test('l’expression MapLibre filtre exactement comme le panneau', () => {
  const combinaisons = [
    {}, { reg: 'reg-0' }, { cie: 'cie-1' }, { cie: SANS_COMPAGNIE }, { bt: 'bt-1' }, { type: 'fixe' }, { type: 'intouchable' },
    { faction: '18-24' }, { faction: NON_AFFECTE }, { origine: 'simulation' }, { origine: 'reelle' },
    { reg: 'reg-1', type: 'fixe', faction: '06-12' }, { reg: 'reg-0', cie: 'cie-0', bt: 'bt-0', faction: '00-06', origine: 'reelle' },
    { reg: 'reg-1', faction: NON_AFFECTE, origine: 'simulation' },
  ];
  assert.equal(expressionFiltre(FILTRES_DEFAUT), null);
  for (const c of combinaisons) {
    const f = { ...FILTRES_DEFAUT, ...c };
    const { filter } = featureFilter(expressionFiltre(f) ?? undefined, 'layers[0].filter');
    for (const e of entites) {
      assert.equal(filter({ zoom: 10 }, { type: 1, properties: e.properties }), correspond(e.properties, f), `${JSON.stringify(c)} ${e.properties.id}`);
    }
  }
});

test('listes : dépendances REG → CIE → BT et nombres par faction', () => {
  const tout = optionsFiltres(proprietes, hierarchie, FILTRES_DEFAUT);
  assert.deepEqual(tout.regions.map((o) => o.nom), ['Fès', 'Rabat']);
  assert.equal(tout.regions.reduce((s, o) => s + o.n, 0), 1000);
  assert.deepEqual(tout.factions.map((o) => o.id), [...CRENEAUX, NON_AFFECTE]);
  // Chaque faction compte ses fixes + tous les intouchables.
  for (const o of tout.factions) assert.equal(o.n, compte({ faction: o.id }));
  // Nombre par faction avec les autres filtres actifs.
  const fesReelles = optionsFiltres(proprietes, hierarchie, { ...FILTRES_DEFAUT, reg: 'reg-1', origine: 'reelle', faction: '00-06' });
  for (const o of fesReelles.factions) assert.equal(o.n, compte({ reg: 'reg-1', origine: 'reelle', faction: o.id }));
  const fes = optionsFiltres(proprietes, hierarchie, { ...FILTRES_DEFAUT, reg: 'reg-1' });
  assert.deepEqual(fes.compagnies.map((o) => o.id), ['cie-1', SANS_COMPAGNIE]); // « sans compagnie » en dernier
  assert.equal(fes.compagnies.at(-1).nom, null);
  assert.deepEqual(fes.brigades.map((o) => o.id).sort(), ['bt-2', 'bt-3']);

  const avant = { ...FILTRES_DEFAUT, reg: 'reg-0', cie: 'cie-0', bt: 'bt-1', type: 'fixe', faction: '12-18', origine: 'reelle' };
  assert.deepEqual(normaliserFiltres(proprietes, hierarchie, { ...avant, reg: 'reg-1' }), { ...avant, reg: 'reg-1', cie: '', bt: '' });
  assert.deepEqual(normaliserFiltres(proprietes, hierarchie, avant), avant);
  // Une compagnie d'une autre région est effacée ; la brigade, qui relève bien de la région, reste.
  assert.deepEqual(normaliserFiltres(proprietes, hierarchie, { ...avant, cie: 'cie-1' }), { ...avant, cie: '' });
  // Valeurs inconnues (ancien stockage avec « creneau », jeu remplacé) : remises à « tous ».
  assert.deepEqual(normaliserFiltres(proprietes, hierarchie, { reg: 'reg-9', cie: 4, bt: 'bt-9', type: 'mobile', creneau: '06-12', faction: '24h', origine: 'x' }), FILTRES_DEFAUT);
  assert.deepEqual(normaliserFiltres(proprietes, hierarchie, { ...FILTRES_DEFAUT, faction: NON_AFFECTE }), { ...FILTRES_DEFAUT, faction: NON_AFFECTE });
});

// ── Modifications locales ──────────────────────────────────────────────────

test('édition : ajout, modification, déplacement et suppression en surcouche, jeu installé intact', () => {
  const base = melanges.slice(0, 10);
  const copie = structuredClone(base);
  const e = editionsVides();
  const nouveau = barageValide({ id: 'BAR-X1', isSimulation: false, latitude: 33.7, longitude: -5.1, btId: 'bt-3', type: 'intouchable', shift: CONTINU });
  e.ajouts.push(nouveau);
  e.modifs[base[0].id] = { name: 'Renommé', ...typeEtFaction('fixe', '18-24') };
  e.modifs[base[1].id] = { latitude: 33.9, longitude: -6.95, route: { nom: 'Route de test', ref: 'R1', classe: 'tertiary' } };
  e.suppressions.push(base[2].id);
  const { barages: resultat, orphelines, dejaInstalles } = appliquerEditions(base, e);
  assert.equal(resultat.length, 10);
  assert.equal(resultat.find((b) => b.id === base[0].id).name, 'Renommé');
  assert.equal(resultat.find((b) => b.id === base[0].id).shift, '18-24');
  assert.equal(resultat.find((b) => b.id === base[1].id).longitude, -6.95);
  assert.equal(resultat.find((b) => b.id === base[1].id).btId, base[1].btId); // la brigade reste
  assert.ok(!resultat.some((b) => b.id === base[2].id));
  assert.deepEqual(resultat.at(-1), nouveau);
  assert.deepEqual(orphelines, []);
  assert.deepEqual(dejaInstalles, []);
  assert.deepEqual(base, copie); // le jeu installé n'est pas modifié
  assert.equal(nombreEditions(e), 4);
  assert.deepEqual(trierBarages(resultat, hierarchie).rejetes, []);
});

test('édition : export puis réinstallation sans doublon, modifications orphelines signalées', () => {
  const base = melanges.slice(0, 5);
  const e = editionsVides();
  e.ajouts.push(barageValide({ id: 'BAR-X2', latitude: 33.9, longitude: -6.95 }));
  const exporte = jeuExporte(appliquerEditions(base, e).barages, { referentiel: { importeLe: 'x' } });
  assert.equal(exporte.format, FORMAT_BARAGES);
  assert.equal(exporte.simulation, true);
  // Le fichier exporté devient le jeu installé, la surcouche n'a pas encore été annulée : pas de doublon.
  const installe = lireJeuBarages(exporte, hierarchie).barages;
  const apres = appliquerEditions(installe, e);
  assert.equal(apres.barages.length, 6);
  assert.deepEqual(apres.dejaInstalles, ['BAR-X2']);
  assert.equal(new Set(apres.barages.map((b) => b.id)).size, 6);
  // Jeu remplacé : les modifications visant des barages disparus sont signalées, pas appliquées.
  const e2 = { ...editionsVides(), modifs: { 'SIM-BAR-9999': { name: 'x' } }, suppressions: ['SIM-BAR-8888'] };
  assert.deepEqual(appliquerEditions(base, e2).orphelines, ['SIM-BAR-9999', 'SIM-BAR-8888']);
  assert.equal(appliquerEditions(base, e2).barages.length, 5);
  // Un jeu entièrement réel exporté n'est pas déclaré simulé.
  assert.equal(jeuExporte([barageValide({ isSimulation: false })]).simulation, false);
});

test('édition : surcouche relue du stockage sans erreur, type et faction cohérents', () => {
  assert.deepEqual(lireEditions(null), editionsVides());
  assert.deepEqual(lireEditions('x'), editionsVides());
  assert.deepEqual(lireEditions({ ajouts: [{ id: 'A' }, null, { x: 1 }], modifs: [], suppressions: ['B', 'B', 3] }), { ajouts: [{ id: 'A' }], modifs: {}, suppressions: ['B'], retraits: [] });
  assert.deepEqual(typeEtFaction('intouchable', '06-12'), { type: 'intouchable', shift: CONTINU });
  assert.deepEqual(typeEtFaction('fixe', '06-12'), { type: 'fixe', shift: '06-12' });
  assert.deepEqual(typeEtFaction('fixe', CONTINU), { type: 'fixe', shift: '00-06' }); // un intouchable redevenu fixe reçoit une faction
});

// ── Couches ────────────────────────────────────────────────────────────────

test('couches : style valide, masquées par défaut, filtre appliqué, aucun conflit avec la Gendarmerie', () => {
  for (const theme of ['light', 'dark']) {
    for (const visible of [false, true]) {
      const couches = couchesBarages({ theme, visible, filtre: expressionFiltre({ ...FILTRES_DEFAUT, reg: 'reg-0', faction: NON_AFFECTE }), edition: 'SIM-BAR-0001' });
      const style = {
        version: 8,
        glyphs: 'http://localhost/fonts/{fontstack}/{range}.pbf',
        sources: {
          [SOURCE_BARAGES]: { type: 'geojson', data: { type: 'FeatureCollection', features: entites } },
          [SOURCE_AGREGATS]: { type: 'geojson', data: agregerBarages(entites, hierarchie) },
        },
        layers: couches,
      };
      assert.deepEqual(validateStyleMin(style).map((e) => e.message), [], `${theme} ${visible}`);
      assert.deepEqual(couches.map((c) => c.id), [...COUCHES_AGREGATS, COUCHE_EDITION, 'barages-symbole', 'barages-badge', 'barages-nom']);
      assert.ok(couches.every((c) => c.layout.visibility === (visible ? 'visible' : 'none') && c.filter));
    }
  }
  // Sans filtre de l'utilisateur, les couches de détail n'en ont pas (sauf le badge, réservé aux simulés).
  assert.ok(couchesBarages().filter((c) => ['barages-symbole', 'barages-nom'].includes(c.id)).every((c) => c.layout.visibility === 'none' && !c.filter));
  const gr = couchesGendarmerie({});
  const idsGr = [...gr.sousLibelles, ...gr.dessus].map((c) => c.id);
  assert.ok([COUCHE_EDITION, ...COUCHES_BARAGES, ...COUCHES_AGREGATS].every((id) => !idsGr.includes(id)));
  assert.ok([...gr.sousLibelles, ...gr.dessus].every((c) => c.source !== SOURCE_BARAGES && c.source !== SOURCE_AGREGATS));
});

test('volume : 1 000 barages convertis et filtrés rapidement', () => {
  const debut = performance.now();
  const e = entitesBarages(melanges, hierarchie);
  for (const c of [...CRENEAUX, NON_AFFECTE]) e.filter((f) => correspond(f.properties, { ...FILTRES_DEFAUT, faction: c }));
  optionsFiltres(e.map((f) => f.properties), hierarchie, { ...FILTRES_DEFAUT, reg: 'reg-0' });
  assert.ok(performance.now() - debut < 1000);
});

// ── Agrégation hiérarchique et niveau de détail ────────────────────────────

test('échelons par zoom : régions ≤ 6, compagnies 7–8, barages un par un dès 9', () => {
  assert.deepEqual([4, 6, 6.99, 7, 8, 8.99, 9, 12].map(niveauAuZoom), ['reg', 'reg', 'reg', 'cie', 'cie', 'cie', 'detail', 'detail']);
  const couches = Object.fromEntries(couchesBarages({ visible: true }).map((c) => [c.id, c]));
  const plage = (id) => [couches[id].minzoom ?? 0, couches[id].maxzoom ?? 24];
  // Les plages se suivent sans se recouvrir : aucun barage n'est montré deux fois.
  assert.deepEqual(plage('barages-agregats-reg'), [0, ZOOM_CIE]);
  assert.deepEqual(plage('barages-agregats-cie'), [ZOOM_CIE, ZOOM_DETAIL]);
  assert.deepEqual(plage('barages-symbole'), [ZOOM_DETAIL, 24]);
  assert.deepEqual(plage('barages-agregats-reg-n'), plage('barages-agregats-reg'));
  assert.deepEqual(plage('barages-agregats-cie-n'), plage('barages-agregats-cie'));
  assert.ok(COUCHES_AGREGATS.every((id) => couches[id].source === SOURCE_AGREGATS));
});

test('groupes : jamais deux régions, compagnies ou origines mêlées ; nombres justes', () => {
  const { features } = agregerBarages(entites, hierarchie, FILTRES_DEFAUT);
  const ids = features.map((f) => f.properties.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants uniques');
  for (const niveau of ['reg', 'cie']) {
    const groupes = features.filter((f) => f.properties.niveau === niveau);
    // Chaque barage est dans exactement un groupe de chaque échelon.
    assert.equal(groupes.reduce((s, f) => s + f.properties.n, 0), 1000, niveau);
    for (const g of groupes) {
      const membres = proprietes.filter((p) => (p.isSimulation === true) === g.properties.simulation
        && (niveau === 'reg' ? p.regId === g.properties.id.split(':')[1] : `${p.regId}/${p.cieId}` === g.properties.id.split(':')[1]
          || (p.cieId === SANS_COMPAGNIE && g.properties.id.startsWith(`cie:${p.regId}/${SANS_COMPAGNIE}:`))));
      if (!g.properties.id.includes(SANS_COMPAGNIE)) assert.equal(g.properties.n, membres.length, g.properties.id);
      assert.equal(g.properties.fixes + g.properties.intouchables, g.properties.n);
    }
  }
  // Simulés et réels ne partagent jamais un groupe : une région a deux groupes (sim / reel).
  const reg0 = features.filter((f) => f.properties.id.startsWith('reg:reg-0:'));
  assert.deepEqual(reg0.map((f) => f.properties.simulation).sort(), [false, true]);
  assert.equal(reg0.find((f) => !f.properties.simulation).properties.n, compte({ reg: 'reg-0', origine: 'reelle' }));
});

test('groupes : centre et emprise tirés des barages du groupe, compagnie inconnue explicite', () => {
  const { features } = agregerBarages(entites, hierarchie, { ...FILTRES_DEFAUT, origine: 'simulation' });
  const bt3 = entites.filter((e) => e.properties.btId === 'bt-3' && e.properties.isSimulation);
  const g = features.find((f) => f.properties.niveau === 'cie' && f.properties.id.includes(SANS_COMPAGNIE));
  // bt-3 est la seule brigade sans compagnie : son groupe porte le nom donné par la brigade.
  assert.equal(g.properties.id, `cie:reg-1/${SANS_COMPAGNIE}:inexistante:sim`);
  assert.equal(g.properties.nom, 'Inexistante *');
  assert.equal(g.properties.n, bt3.length);
  const moyenne = (i) => bt3.reduce((s, e) => s + e.geometry.coordinates[i], 0) / bt3.length;
  assert.ok(Math.abs(g.geometry.coordinates[0] - moyenne(0)) < 1e-9 && Math.abs(g.geometry.coordinates[1] - moyenne(1)) < 1e-9);
  assert.equal(g.properties.ouest, Math.min(...bt3.map((e) => e.geometry.coordinates[0])));
  assert.equal(g.properties.nord, Math.max(...bt3.map((e) => e.geometry.coordinates[1])));
  // Région absente : groupe « sans-region », pas d'erreur.
  const h = construireHierarchie({ reg: [], cie: [], bt: [{ id: 'bt-0', nom: 'A', cie: 'X', reg: 'Y' }] });
  const seul = agregerBarages(entitesBarages([barageValide()], h), h).features;
  assert.deepEqual(seul.map((f) => f.properties.id), ['reg:sans-region:sim', `cie:sans-region/${SANS_COMPAGNIE}:x:sim`]);
  assert.equal(seul[0].properties.nom, null);
});

test('groupes et filtres : faction, type, origine et brigade donnent les mêmes nombres que la liste', () => {
  for (const autres of [{ faction: '00-06' }, { faction: NON_AFFECTE }, { type: 'fixe', faction: '12-18' }, { origine: 'reelle', reg: 'reg-1' }, { bt: 'bt-0' }]) {
    const f = { ...FILTRES_DEFAUT, ...autres };
    const { features } = agregerBarages(entites, hierarchie, f);
    for (const niveau of ['reg', 'cie']) {
      assert.equal(features.filter((g) => g.properties.niveau === niveau).reduce((s, g) => s + g.properties.n, 0), compte(f), `${niveau} ${JSON.stringify(autres)}`);
    }
  }
  // Rien ne passe les filtres : aucun groupe.
  assert.equal(agregerBarages(entites, hierarchie, { ...FILTRES_DEFAUT, type: 'intouchable', faction: NON_AFFECTE, bt: 'bt-99' }).features.length, 0);
});

test('niveau de détail : paliers d’icône ≥ 18 px, badge SIM et noms seulement de près', () => {
  const couches = Object.fromEntries(couchesBarages({ visible: true }).map((c) => [c.id, c]));
  const taille = couches['barages-symbole'].layout['icon-size'];
  assert.equal(taille[0], 'step'); // paliers discrets, pas d'interpolation continue
  assert.ok(TAILLES_ICONE.every(([, k]) => k * 24 >= 18), 'icône de 48 px à pixelRatio 2 = 24 px CSS');
  assert.equal(couches['barages-badge'].minzoom, ZOOM_BADGES);
  assert.equal(ZOOM_BADGES, 11);
  assert.ok(couches['barages-nom'].minzoom >= ZOOM_BADGES);
  // Le badge ne vise que les simulés, en plus du filtre de l'utilisateur.
  const f = expressionFiltre({ ...FILTRES_DEFAUT, faction: '06-12' });
  assert.deepEqual(filtrePour('barages-badge', f), ['all', ['==', ['get', 'isSimulation'], true], f]);
  assert.deepEqual(filtrePour('barages-symbole', f), f);
  assert.equal(filtrePour('barages-symbole', null), null);
  const { filter } = featureFilter(filtrePour('barages-badge', null), 'layers[0].filter');
  assert.equal(entites.filter((e) => filter({ zoom: 12 }, { type: 1, properties: e.properties })).length, compte({ origine: 'simulation' }));
  // Simulé et réel distingués à tout zoom de détail : icône à anneau pointillé pour les simulés.
  assert.deepEqual(couches['barages-symbole'].layout['icon-image'], ['concat', 'barage-', ['get', 'type'], ['case', ['==', ['get', 'isSimulation'], true], '-sim', '']]);
});

// ── Validation d'emplacement sur route ─────────────────────────────────────

const CIRCOS_BT = FIXTURE.bt.map((f) => ({ proprietes: f.properties, geometrie: f.geometry, emprise: [f.geometry.coordinates[0][0][0], f.geometry.coordinates[0][0][1], f.geometry.coordinates[0][2][0], f.geometry.coordinates[0][2][1]] }));

test('validation d’emplacement : accroché sur la route à moins de 150 m, trace complète', () => {
  const propose = [-6.95, 33.9008]; // ≈ 89 m au nord de la route de bt-0
  const v = validerEmplacement(propose, ROUTES, CIRCOS_BT);
  assert.equal(v.statut, 'valide');
  assert.deepEqual(v.origine, propose);
  assert.deepEqual(v.point, [-6.95, 33.9]);
  assert.ok(Math.abs(v.distance - distanceMetres(propose, v.point)) < 0.5 && v.distance < RAYON_ACCROCHE_M);
  assert.equal(v.btId, 'bt-0');
  assert.equal(v.route.classe, 'tertiary');
  const trace = traceValidation(v, new Date('2026-10-13T08:00:00Z'));
  assert.deepEqual(trace, { methode: 'route-tuiles', origine: propose, ecartM: Math.round(v.distance * 10) / 10, date: '2026-10-13T08:00:00.000Z' });
  assert.deepEqual(validerBarage({ ...barageValide(), validation: trace }, hierarchie), []);
});

test('validation d’emplacement : refus explicites, jamais de position inventée', () => {
  // Trop loin : la seule route carrossable est à ≈ 330 m.
  assert.deepEqual(validerEmplacement([-6.95, 33.903], ROUTES, CIRCOS_BT), { statut: 'refuse', origine: [-6.95, 33.903], raison: 'aucune-route' });
  // Près d'une voie de service seulement : refusé aussi.
  assert.equal(validerEmplacement([-6.95, 33.8504], ROUTES, CIRCOS_BT).raison, 'aucune-route');
  // Routes illisibles (tuiles) : refus distinct, pas « aucune route ».
  assert.equal(validerEmplacement([-6.95, 33.9], null, CIRCOS_BT).raison, 'routes-illisibles');
  // Aucune donnée routière : rien n'est posé.
  assert.equal(validerEmplacement([-6.95, 33.9], [], CIRCOS_BT).statut, 'refuse');
  // Route hors de toute circonscription.
  const horsBt = [{ classe: 'primary', nom: 'X', ref: null, points: [[-8.5, 31], [-8.4, 31]] }];
  assert.equal(validerEmplacement([-8.45, 31.0005], horsBt, CIRCOS_BT).raison, 'hors-brigade');
  // Déplacement : la route de la brigade voisine ne convient pas.
  assert.equal(validerEmplacement([-6.79, 33.9005], ROUTES, CIRCOS_BT, { btAttendu: 'bt-0' }).raison, 'autre-brigade');
  assert.equal(validerEmplacement([-6.79, 33.9005], ROUTES, CIRCOS_BT, { btAttendu: 'bt-1' }).btId, 'bt-1');
  // Rayon configurable.
  assert.equal(validerEmplacement([-6.95, 33.9008], ROUTES, CIRCOS_BT, { rayonMax: 50 }).statut, 'refuse');
});

// ── Simulé / réel ──────────────────────────────────────────────────────────

test('simulé / réel : l’origine d’un barage installé est verrouillée, un ajout local peut changer', () => {
  assert.equal(refusModification({ isSimulation: false }), 'origine-verrouillee');
  assert.equal(refusModification({ isSimulation: true }, { ajoutLocal: false }), 'origine-verrouillee');
  assert.equal(refusModification({ isSimulation: false }, { ajoutLocal: true }), null);
  assert.equal(refusModification({ name: 'x', shift: '06-12', latitude: 1, longitude: 2, route: {}, validation: {} }), null);
  assert.match(refusModification({ btId: 'bt-2' }), /btId/);
  assert.match(refusModification({ id: 'X' }), /id/);
});

test('simulé / réel : retirer les simulés ne touche pas aux réels, et se défait', () => {
  const base = melanges.slice(0, 20);
  const e = editionsVides();
  e.ajouts.push(barageValide({ id: 'BAR-SIM', isSimulation: true }), barageValide({ id: 'BAR-REEL', isSimulation: false, latitude: 33.9, longitude: -6.95 }));
  e.modifs[base[1].id] = { name: 'Renommé' };
  const apres = retirerSimules(base, e);
  const { barages: affiches } = appliquerEditions(base, apres);
  assert.ok(affiches.every((b) => b.isSimulation === false));
  assert.deepEqual(affiches.map((b) => b.id).sort(), [...base.filter((b) => !b.isSimulation).map((b) => b.id), 'BAR-REEL'].sort());
  assert.ok(affiches.length > 1);
  // Le jeu installé n'est pas modifié ; annuler la surcouche fait tout revenir.
  assert.equal(appliquerEditions(base, editionsVides()).barages.length, 20);
  // Un ajout local qui reprendrait l'identifiant d'un barage installé ne le remplace pas.
  const reel = base.find((b) => !b.isSimulation);
  const intrus = { ...editionsVides(), ajouts: [{ ...reel, isSimulation: true, name: 'intrus' }] };
  const r = appliquerEditions(base, intrus);
  assert.deepEqual(r.dejaInstalles, [reel.id]);
  assert.equal(r.barages.find((b) => b.id === reel.id).isSimulation, false);
});

// ── Factions et heure ──────────────────────────────────────────────────────

test('faction de l’heure : bornes, minuit, chaque minute du jour dans exactement une faction', () => {
  const a = (h, m = 0) => factionDeLHeure(new Date(2026, 9, 13, h, m, 0));
  assert.equal(a(0, 0), '00-06');
  assert.equal(a(5, 59), '00-06');
  assert.equal(a(6, 0), '06-12'); // une borne appartient à la faction qui commence
  assert.equal(a(11, 59), '06-12');
  assert.equal(a(12, 0), '12-18');
  assert.equal(a(18, 0), '18-24');
  assert.equal(a(23, 59), '18-24');
  assert.equal(factionDeLHeure(new Date(2026, 9, 14, 0, 0, 0)), '00-06'); // minuit : faction 1 du lendemain
  const parFaction = {};
  for (let m = 0; m < 24 * 60; m++) parFaction[a(Math.floor(m / 60), m % 60)] = (parFaction[a(Math.floor(m / 60), m % 60)] ?? 0) + 1;
  assert.deepEqual(parFaction, { '00-06': 360, '06-12': 360, '12-18': 360, '18-24': 360 });
});

test('volume : 10 000 barages groupés en un temps compatible avec chaque changement de filtre', async () => {
  const beaucoup = await genererBarages(FIXTURE.bt, { graine: 2, nombre: 10_000, placer });
  const e = entitesBarages(beaucoup, hierarchie);
  const debut = performance.now();
  for (const faction of ['', ...CRENEAUX, NON_AFFECTE]) agregerBarages(e, hierarchie, { ...FILTRES_DEFAUT, faction });
  const ms = (performance.now() - debut) / 6;
  assert.ok(ms < 100, `${ms.toFixed(1)} ms par regroupement`);
});

// ── Données réelles (si importées sur ce poste : donnees/ n'est pas versionné) ──
const GR = new URL('../donnees/gendarmerie/', import.meta.url);
const TUILES = new URL('../donnees/tiles/maroc.pmtiles', import.meta.url);
const FICHIER_BARAGES = new URL('../donnees/barages/barages.json', import.meta.url);
const avecDonnees = ['circo-reg.geojson', 'circo-cie.geojson', 'circo-bt.geojson'].every((f) => existsSync(new URL(f, GR)));
const lireGr = (f) => JSON.parse(readFileSync(new URL(f, GR), 'utf8'));
const hierarchieReelle = () => {
  const [reg, cie, bt] = ['circo-reg.geojson', 'circo-cie.geojson', 'circo-bt.geojson'].map(lireGr);
  return { bt, h: construireHierarchie({ reg: reg.features.map((f) => f.properties), cie: cie.features.map((f) => f.properties), bt: bt.features.map((f) => f.properties) }) };
};

/** Routes des vraies tuiles, comme dans la carte. */
async function routesReelles() {
  const fichier = await open(TUILES);
  const archive = new PMTiles({
    getKey: () => 'maroc',
    getBytes: async (decalage, longueur) => {
      const tampon = Buffer.alloc(longueur);
      await fichier.read(tampon, 0, longueur, decalage);
      return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + longueur) };
    },
  });
  const reseau = new ReseauRoutier(archive);
  return { lire: (bbox, zMax) => reseau.lignes(bbox, { zMax }), fermer: () => fichier.close() };
}

test('données importées : hiérarchie complète côté régions', { skip: !avecDonnees && 'donnees/gendarmerie absent' }, () => {
  const { h } = hierarchieReelle();
  assert.deepEqual(h.anomalies.regionInconnue, []);
  assert.deepEqual(h.anomalies.incoherences, []);
});

test('tuiles réelles : barages générés sur des routes, accroche refusée en pleine mer', { skip: !(avecDonnees && existsSync(TUILES)) && 'tuiles ou circonscriptions absentes' }, async () => {
  const { bt, h } = hierarchieReelle();
  const routes = await routesReelles();
  try {
    const genere = await genererBarages(bt.features, { graine: 3, nombre: 40, placer: placeurSurRoute(routes.lire) });
    const lu = lireJeuBarages(jeuSimulation(genere, { graine: 3 }), h);
    assert.deepEqual(lu.rejetes, []);
    for (const b of genere) assert.ok(await surUneRoute(b, routes.lire), `${b.id} hors route`);
    // En mer au large de Casablanca : aucune route, rien n'est posé.
    const mer = [-7.9, 33.75];
    const lu2 = await routes.lire([mer[0] - 0.01, mer[1] - 0.01, mer[0] + 0.01, mer[1] + 0.01], 15);
    assert.equal(accrocherARoute(mer, lu2?.lignes), null);
    // Boulevard Zerktouni (Casablanca), clic à ≈ 40 m : accroché à une route carrossable proche.
    const clic = [-7.6301, 33.5895];
    const lu3 = await routes.lire([clic[0] - 0.003, clic[1] - 0.003, clic[0] + 0.003, clic[1] + 0.003], 15);
    const a = accrocherARoute(clic, lu3.lignes);
    assert.ok(a && CLASSES_ROUTE.has(a.route.classe) && distanceMetres(clic, a.point) <= RAYON_ACCROCHE_M);
  } finally {
    await routes.fermer();
  }
});

test('jeu installé (donnees/barages/barages.json) : valide, et un échantillon sur des routes', { skip: !(avecDonnees && existsSync(FICHIER_BARAGES) && existsSync(TUILES)) && 'jeu, tuiles ou circonscriptions absents' }, async () => {
  const { h } = hierarchieReelle();
  const jeu = JSON.parse(readFileSync(FICHIER_BARAGES, 'utf8'));
  const lu = lireJeuBarages(jeu, h);
  assert.deepEqual(lu.rejetes, []);
  if (jeu.simulation) assert.ok(lu.barages.every((b) => b.isSimulation === true));
  const routes = await routesReelles();
  try {
    for (const b of lu.barages.filter((_, i) => i % 10 === 0)) assert.ok(await surUneRoute(b, routes.lire), `${b.id} hors route`);
  } finally {
    await routes.fermer();
  }
});
