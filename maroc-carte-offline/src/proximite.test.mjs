import assert from 'node:assert/strict';
import test from 'node:test';
import { cheminDansGraphe, construireGraphe } from './itineraire.js';
import { distanceMetres } from './mesure.js';
import {
  FACTIONS, HISTORIQUE_VIDE, LIMITES_HISTORIQUE, MARGE_FILTRE_M, REGLES_PROXIMITE, ajouterAnalyse, ajouterProposition, alerte,
  CLASSES_CANDIDAT, CacheItineraires, cibleZone, classerCandidat, compterPropositions, distancesRoute, echantillonnerLignes, factionDe, fenetres,
  lireHistoriqueProximite, majProposition, memeFaction, pairesCandidates, parTranche, traitsPaire, tranches, validerEmplacementRoutier,
  validerEspacement, validerReglesProximite, violeEspacement, voisinsRequis, factionCommune, estProtege, scoreCandidat, indexerCandidats, aptitudeEn, grilleAptitude,
  couleurAptitude, libelleAptitude, SANS_ROUTE, INCONNU,
} from './proximite.js';

let n = 0;
const enr = (champs = {}, source = 'fichier') => ({
  barage: { id: `SIM-BAR-${String(++n).padStart(4, '0')}`, name: `Barage ${n}`, type: 'fixe', shift: '00-06', latitude: 33.5, longitude: -7.6, btId: 'bt-1', isSimulation: true, ...champs },
  source, rang: n,
});
const regles = (r = {}) => ({ ...REGLES_PROXIMITE, origine: 'toutes', ...r });
// Degrés de longitude pour `m` mètres vers l'est à 33,5° N.
const est = (m) => m / (111_320 * Math.cos((33.5 * Math.PI) / 180));
const cle = (p) => [p.a.barage.id, p.b.barage.id].sort().join('+');
/** Moteur de test : renvoie la distance routière fixée pour chaque paire (le vrai moteur est testé plus bas). */
const moteur = (distances) => ({
  appels: 0,
  async itineraire(de, vers) {
    this.appels += 1;
    const d = distances(de, vers);
    if (d === 'erreur') throw new Error('tuiles illisibles');
    return d === null ? null : { chemin: [de, vers], distance: d, secondes: d / 10, approximatif: false };
  },
});
const ok = (distance) => ({ statut: 'ok', distance, secondes: 60, approximatif: false, chemin: [[0, 0], [1, 1]] });

test('paramètres : distance routière choisie librement (bornée), faction, origine ; refus explicites', () => {
  assert.equal(validerReglesProximite({ distanceMaxKm: 7.5 }).regles.distanceMaxKm, 7.5);
  assert.ok(validerReglesProximite({ distanceMaxKm: 0 }).erreurs.length);
  assert.ok(validerReglesProximite({ distanceMaxKm: 'x' }).erreurs.length);
  assert.ok(validerReglesProximite({ faction: 'Faction 9' }).erreurs.length);
  for (const f of ['toutes', ...FACTIONS]) assert.deepEqual(validerReglesProximite({ faction: f }).erreurs, []);
  // Anciens paramètres (vol d'oiseau, types) ignorés : seule la route décide.
  assert.ok(!('mode' in validerReglesProximite({ mode: 'direct', types: ['fixe'] }).regles));
});

test('faction : créneau des barages fixes ; un intouchable (24 h/24) est de toutes les factions ; incohérence exclue', () => {
  assert.equal(factionDe({ type: 'fixe', shift: '06-12' }), '06-12');
  assert.equal(factionDe({ type: 'intouchable', shift: 'continu' }), 'continu');
  assert.equal(factionDe({ type: 'intouchable', shift: '06-12' }), null);
  assert.equal(factionDe({ type: 'fixe', shift: 'continu' }), null);
  const f1 = { type: 'fixe', shift: '00-06', isSimulation: true };
  const i24 = { type: 'intouchable', shift: 'continu', isSimulation: true };
  assert.equal(memeFaction(f1, { ...f1 }), true);
  assert.equal(memeFaction(f1, { ...f1, shift: '06-12' }), false, 'faction 1 ≠ faction 2');
  assert.equal(factionCommune(f1, i24), '00-06', 'intouchable et faction 1 : faction 1');
  assert.equal(factionCommune(i24, { ...f1, shift: '18-24' }), '18-24');
  assert.equal(factionCommune(i24, { ...i24 }), 'continu');
  assert.equal(memeFaction(f1, { ...f1, isSimulation: false }), false, 'simulé ≠ réel');
  assert.equal(memeFaction(i24, { ...f1, isSimulation: false }), false, 'simulé ≠ réel, même pour un intouchable');
});

test('exemples de la règle : même faction 8 km / seuil 10 → alerte ; factions différentes 3 km → non ; 15 km → non ; route indisponible → non', () => {
  const r = regles({ distanceMaxKm: 10 });
  const a = enr({ shift: '00-06' });
  const memeF = enr({ shift: '00-06' });
  const autreF = enr({ shift: '06-12' });
  assert.equal(alerte({ a, b: memeF }, ok(8000), r).alerte, true);
  assert.equal(alerte({ a, b: autreF }, ok(3000), r).alerte, false);
  assert.equal(alerte({ a, b: memeF }, ok(15000), r).alerte, false);
  const sans = alerte({ a, b: memeF }, { statut: 'indisponible' }, r);
  assert.equal(sans.alerte, false);
  assert.match(sans.raison, /Distance routière indisponible/);
  const erreur = alerte({ a, b: memeF }, { statut: 'erreur', erreur: 'tuiles illisibles' }, r);
  assert.equal(erreur.alerte, false);
  assert.match(erreur.raison, /Distance routière indisponible : erreur/);
});

test('seuil : en dessous, égal, au-dessus (distance routière)', () => {
  const r = regles({ distanceMaxKm: 2 });
  const p = { a: enr(), b: enr() };
  assert.equal(alerte(p, ok(1999), r).alerte, true);
  assert.equal(alerte(p, ok(2000), r).alerte, true, 'égal au seuil : alerte (≤)');
  assert.equal(alerte(p, ok(2001), r).alerte, false);
});

test('factions différentes : jamais d’alerte, même à 10 m par la route, et jamais envoyées au moteur', async () => {
  const r = regles({ distanceMaxKm: 10 });
  for (const [fa, fb] of [['00-06', '06-12'], ['12-18', '18-24'], ['00-06', '18-24']]) {
    const a = enr({ shift: fa });
    const b = enr({ shift: fb, longitude: -7.6 + est(10) });
    assert.equal(alerte({ a, b }, ok(10), r).alerte, false, `${fa} / ${fb}`);
    assert.equal(pairesCandidates([a, b], r).candidats.length, 0, 'pas de calcul d’itinéraire entre factions');
  }
  // Un intouchable, de toutes les factions, est comparé à chacune — chaque paire une seule fois.
  const i1 = enr({ type: 'intouchable', shift: 'continu' });
  const i2 = enr({ type: 'intouchable', shift: 'continu', longitude: -7.6 + est(80) });
  const fixes = ['00-06', '06-12', '12-18', '18-24'].map((f, k) => enr({ shift: f, longitude: -7.6 + est(20 + k * 30) }));
  const { candidats } = pairesCandidates([i1, i2, ...fixes], r);
  const cles = candidats.map(cle);
  assert.equal(candidats.length, 4 * 2 + 1, 'chaque fixe avec les 2 intouchables, plus la paire d’intouchables');
  assert.equal(new Set(cles).size, cles.length, 'la paire d’intouchables n’est pas répétée pour chaque faction');
  assert.ok(!candidats.some((c) => c.a.barage.type === 'fixe' && c.b.barage.type === 'fixe'), 'deux fixes de factions différentes : jamais');
  assert.ok(candidats.every((c) => c.faction === factionCommune(c.a.barage, c.b.barage)));
  const reseau = moteur(() => 50);
  const { routes } = await distancesRoute(candidats, reseau);
  assert.equal(reseau.appels, candidats.length);
  assert.ok(candidats.every((c, i) => alerte(c, routes[i], r).alerte));
});

test('sélection d’une faction : les autres ne sont pas analysées (les intouchables, de toutes, si)', () => {
  const i24 = enr({ type: 'intouchable', shift: 'continu' });
  const liste = [enr({ shift: '00-06' }), enr({ shift: '00-06' }), enr({ shift: '06-12' }), enr({ shift: '06-12' }), i24];
  const r = pairesCandidates(liste, regles({ faction: '06-12' }));
  assert.equal(r.analyses, 3);
  assert.equal(r.candidats.length, 3, 'deux fixes de la faction 2 et l’intouchable');
  assert.ok(r.candidats.every((c) => c.faction === '06-12'));
  const seuls = pairesCandidates([...liste, enr({ type: 'intouchable', shift: 'continu' })], regles({ faction: 'continu' }));
  assert.equal(seuls.analyses, 2);
  assert.ok(seuls.candidats.every((c) => c.faction === 'continu'));
});

test('filtre de type : fixes (déplaçables) et intouchables (protégés) sélectionnables', () => {
  const liste = [enr(), enr(), enr({ type: 'intouchable', shift: 'continu' })];
  assert.equal(pairesCandidates(liste, regles({ types: ['fixe'] })).candidats.length, 1);
  assert.equal(pairesCandidates(liste, regles({ types: ['intouchable'] })).candidats.length, 0);
  assert.equal(pairesCandidates(liste, regles()).candidats.length, 3);
  assert.ok(validerReglesProximite({ types: ['mobile'] }).erreurs.length);
});

test('protection : intouchable = « Barage fixe — intouchable » ; conflit fixe / déplaçable → actions sur le déplaçable seul ; deux intouchables → information', () => {
  const r = regles({ distanceMaxKm: 10 });
  const mobile = enr();
  const protege = enr({ type: 'intouchable', shift: 'continu' });
  const protege2 = enr({ type: 'intouchable', shift: 'continu' });
  assert.equal(estProtege(protege.barage), true);
  assert.equal(estProtege(mobile.barage), false);
  const mixte = alerte({ a: protege, b: mobile }, ok(500), r);
  assert.equal(mixte.alerte, true, 'un intouchable participe aux alertes');
  assert.deepEqual(mixte.mobiles, [mobile.barage.id]);
  assert.equal(mixte.informatif, false);
  const deuxProteges = alerte({ a: protege, b: protege2 }, ok(500), r);
  assert.equal(deuxProteges.alerte, true);
  assert.deepEqual(deuxProteges.mobiles, []);
  assert.equal(deuxProteges.informatif, true);
  assert.deepEqual(alerte({ a: mobile, b: enr() }, ok(500), r).mobiles.length, 2);
});

test('paires : ni soi-même, ni doublon ; trois barages proches → trois paires, chacune une fois', () => {
  const liste = [enr(), enr({ longitude: -7.6 + est(100) }), enr({ longitude: -7.6 + est(200) })];
  const { candidats } = pairesCandidates(liste, regles({ distanceMaxKm: 1 }));
  assert.equal(candidats.length, 3);
  assert.equal(new Set(candidats.map(cle)).size, 3);
  assert.ok(candidats.every((c) => c.a.barage.id !== c.b.barage.id));
  // Même identifiant deux fois : pas une paire.
  const x = enr();
  assert.equal(pairesCandidates([x, { ...x, rang: 99 }], regles()).candidats.length, 0);
});

test('filtre préalable : n’exclut que les paires dont la route dépasse forcément le seuil (marge comprise)', () => {
  const a = enr();
  const juste = enr({ longitude: -7.6 + est(10_000 + MARGE_FILTRE_M - 5) });
  const trop = enr({ longitude: -7.6 + est(10_000 + MARGE_FILTRE_M + 50) });
  const { candidats, exclus } = pairesCandidates([a, juste, trop], regles({ distanceMaxKm: 10 }));
  const ids = candidats.map(cle);
  assert.ok(ids.includes([a.barage.id, juste.barage.id].sort().join('+')), 'gardée : la route pourrait être sous le seuil');
  assert.ok(!ids.some((k) => k.includes(trop.barage.id) && k.includes(a.barage.id)));
  assert.ok(exclus >= 1);
  // Une paire candidate n'est JAMAIS une alerte sans distance routière.
  assert.equal(alerte(candidats[0], undefined, regles({ distanceMaxKm: 10 })).alerte, false);
});

test('filtre préalable = comparaison exhaustive (latitudes variées) : aucune paire possible n’est perdue', () => {
  const liste = [];
  let x = 11;
  const alea = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) liste.push(enr({ latitude: 21 + alea() * 15, longitude: -17 + alea() * 16, shift: ['00-06', '06-12'][i % 2] }));
  for (const km of [5, 40]) {
    const r = regles({ distanceMaxKm: km, maxCandidats: 50_000 });
    const grille = pairesCandidates(liste, r).candidats.map(cle).sort();
    const tout = [];
    for (let i = 0; i < liste.length; i++) for (let j = i + 1; j < liste.length; j++) {
      const [a, b] = [liste[i].barage, liste[j].barage];
      if (a.shift === b.shift && distanceMetres([a.longitude, a.latitude], [b.longitude, b.latitude]) <= km * 1000 + MARGE_FILTRE_M) tout.push([a.id, b.id].sort().join('+'));
    }
    assert.deepEqual(grille, tout.sort(), `${km} km`);
  }
});

test('simulés et réels séparés ; périmètre (brigade)', () => {
  const sim = enr();
  const reel = enr({ isSimulation: false });
  assert.equal(pairesCandidates([sim, reel], regles()).candidats.length, 0);
  const hierarchie = { brigades: new Map([['bt-1', { id: 'bt-1', cieId: 'c', regId: 'r' }], ['bt-2', { id: 'bt-2', cieId: 'c', regId: 'r' }]]), compagnies: new Map(), regions: new Map() };
  const liste = [enr(), enr(), enr({ btId: 'bt-2' })];
  const c = pairesCandidates(liste, regles({ perimetre: { reg: '', cie: '', bt: 'bt-1' } }), hierarchie).candidats;
  assert.equal(c.length, 1);
  assert.ok(c.every((p) => p.a.barage.btId === 'bt-1' && p.b.barage.btId === 'bt-1'));
});

test('moteur : indisponible et erreur distingués, aucune distance inventée ; annulation entre deux paires', async () => {
  const paires = [{ a: enr(), b: enr() }, { a: enr(), b: enr() }, { a: enr(), b: enr() }];
  let k = 0;
  const reseau = moteur(() => [1200, null, 'erreur'][k++]);
  const { routes } = await distancesRoute(paires, reseau);
  assert.deepEqual(routes.map((r) => r.statut), ['ok', 'indisponible', 'erreur']);
  assert.equal(routes[0].distance, 1200);
  assert.equal(routes[1].distance, undefined);
  assert.equal(routes[2].erreur, 'tuiles illisibles');
  let appels = 0;
  const coupe = await distancesRoute(paires, moteur(() => 100), { annule: () => appels++ >= 1 });
  assert.equal(coupe.annule, true);
  assert.equal(coupe.routes.length, 1, 'aucune paire calculée après l’annulation');
});

test('routes non reliées (vrai calcul de chemin sur un graphe) : distance indisponible, pas d’alerte', async () => {
  // Deux routes parallèles sans jonction, en mètres ; barages posés dessus.
  const X = (lon) => (lon + 7.6) * 111_320 * Math.cos((33.5 * Math.PI) / 180);
  const Y = (lat) => (lat - 33.5) * 111_320;
  const nord = { points: [[0, 300], [3000, 300]] };
  const sud = { points: [[0, 0], [3000, 0]] };
  const relie = { points: [[2900, 0], [2900, 300]] };
  const moteurGraphe = (lignes) => ({
    async itineraire(de, vers) {
      const g = construireGraphe(lignes);
      const r = cheminDansGraphe(g, [X(de[0]), Y(de[1])], [X(vers[0]), Y(vers[1])]);
      return r && { chemin: r.points.map(([x, y]) => [x / (111_320 * Math.cos((33.5 * Math.PI) / 180)) - 7.6, y / 111_320 + 33.5]), distance: r.distance, secondes: r.secondes };
    },
  });
  const a = enr({ longitude: -7.6 + est(100), latitude: 33.5 });
  const b = enr({ longitude: -7.6 + est(100), latitude: 33.5 + 300 / 111_320 });
  const r = regles({ distanceMaxKm: 10 });
  const separe = (await distancesRoute([{ a, b }], moteurGraphe([nord, sud]))).routes[0];
  assert.equal(separe.statut, 'indisponible');
  assert.equal(alerte({ a, b }, separe, r).alerte, false);
  const avecJonction = (await distancesRoute([{ a, b }], moteurGraphe([nord, sud, relie]))).routes[0];
  assert.equal(avecJonction.statut, 'ok');
  assert.ok(avecJonction.distance > 5000, `détour par la jonction : ${Math.round(avecJonction.distance)} m`);
  assert.equal(alerte({ a, b }, avecJonction, regles({ distanceMaxKm: 5 })).alerte, false, '300 m à vol d’oiseau mais > 5 km par la route : pas d’alerte');
  assert.equal(alerte({ a, b }, avecJonction, r).alerte, true);
});

test('vrai moteur sur les tuiles installées : distance routière entre deux barages du jeu', async (t) => {
  const { existsSync, openSync, readSync, readFileSync } = await import('node:fs');
  const fichier = new URL('../donnees/tiles/maroc.pmtiles', import.meta.url);
  const jeu = new URL('../donnees/barages/barages.json', import.meta.url);
  if (!existsSync(fichier) || !existsSync(jeu)) return t.skip('tuiles ou barages non installés');
  const { PMTiles } = await import('pmtiles');
  const { ReseauRoutier } = await import('./itineraire.js');
  const fd = openSync(fichier, 'r');
  const source = {
    getKey: () => 'maroc.pmtiles',
    async getBytes(offset, longueur) {
      const tampon = Buffer.alloc(longueur);
      const lu = readSync(fd, tampon, 0, longueur, offset);
      return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + lu) };
    },
  };
  const barages = JSON.parse(readFileSync(jeu, 'utf8')).barages;
  const parId = (id) => ({ barage: barages.find((b) => b.id === id), source: 'fichier', rang: 0 });
  const [a, b] = [parId('SIM-BAR-0080'), parId('SIM-BAR-0689')];
  if (!a.barage || !b.barage) return t.skip('jeu de barages différent');
  const { routes } = await distancesRoute([{ a, b }], new ReseauRoutier(new PMTiles(source)));
  const r = routes[0];
  assert.equal(r.statut, 'ok');
  assert.ok(r.distance > 0 && r.chemin.length >= 2 && Number.isFinite(r.secondes));
  assert.ok(distanceMetres(r.chemin[0], [a.barage.longitude, a.barage.latitude]) < 200, 'le tracé part du premier barage');
  assert.ok(distanceMetres(r.chemin.at(-1), [b.barage.longitude, b.barage.latitude]) < 200, 'et arrive au second');
});

test('tracés : itinéraire du moteur seulement ; sans route, aucun trait (pas de ligne droite)', () => {
  const a = enr().barage;
  const b = enr({ longitude: -7.59 }).barage;
  assert.ok(traitsPaire(a, b, { statut: 'indisponible' }).every((f) => f.geometry.type === 'Point'));
  const chemin = [[a.longitude, a.latitude], [-7.595, 33.501], [b.longitude, b.latitude]];
  const route = traitsPaire(a, b, { statut: 'ok', distance: 1200, chemin, approximatif: true }).find((f) => f.geometry.type === 'LineString');
  assert.deepEqual(route.geometry.coordinates, chemin);
  assert.match(route.properties.texte, /1,20 km par la route \(tracé approximatif\)/);
});

test('tranches : par distance routière, alertes seulement', () => {
  assert.deepEqual(tranches(10_000).map((t) => t.max), [250, 500, 1000, 2000, 5000, 10_000]);
  const al = [{ alerte: true, routeM: 100 }, { alerte: true, routeM: 4000 }, { alerte: false, routeM: 50 }];
  assert.deepEqual(parTranche(al, regles({ distanceMaxKm: 10 })).map((t) => t.n), [1, 0, 0, 0, 1, 0]);
});

// ── Règle d'espacement commune ────────────────────────────────────────────

test('voisins requis : même faction et origine seulement, jamais le barage déplacé lui-même', () => {
  const x = enr();
  const memeF = enr({ longitude: -7.6 + est(300) });
  const autreF = enr({ shift: '06-12', longitude: -7.6 + est(100) });
  const intouchable = enr({ type: 'intouchable', shift: 'continu', longitude: -7.6 + est(60) });
  const reel = enr({ isSimulation: false, longitude: -7.6 + est(50) });
  const loin = enr({ longitude: -7.6 + est(1000 + MARGE_FILTRE_M + 200) });
  const v = voisinsRequis([-7.6, 33.5], x.barage, [x, memeF, autreF, intouchable, reel, loin], 1000);
  assert.deepEqual(v.map((e) => e.barage.id), [intouchable.barage.id, memeF.barage.id], 'les intouchables restent des points de référence');
  // Pour un intouchable déplacé/créé : toutes les factions comptent.
  const vi = voisinsRequis([-7.6, 33.5], intouchable.barage, [x, memeF, autreF, intouchable, reel, loin], 1000);
  assert.deepEqual(vi.map((e) => e.barage.id), [x.barage.id, autreF.barage.id, memeF.barage.id]);
});

test('validation : valide, non valide (≤ seuil), vérification impossible (route manquante)', () => {
  const a = enr();
  const b = enr();
  assert.equal(validerEspacement([], 1000).statut, 'valide', 'aucun voisin requis');
  assert.equal(validerEspacement([{ enr: a, route: ok(1500) }, { enr: b, route: ok(1001) }], 1000).statut, 'valide');
  const non = validerEspacement([{ enr: a, route: ok(1500) }, { enr: b, route: ok(1000) }], 1000);
  assert.equal(non.statut, 'non-valide', 'à exactement le seuil : trop proche');
  assert.deepEqual(non.violations.map((v) => v.enr.barage.id), [b.barage.id]);
  const impossible = validerEspacement([{ enr: a, route: ok(5000) }, { enr: b, route: { statut: 'indisponible' } }], 1000);
  assert.equal(impossible.statut, 'verification-impossible', 'une route manquante ne valide jamais');
  assert.equal(validerEspacement([{ enr: a, route: ok(200) }, { enr: b, route: { statut: 'erreur', erreur: 'x' } }], 1000).statut, 'non-valide', 'une violation vérifiée suffit');
});

test('cohérence : la même règle décide l’alerte d’une paire et la validité d’un emplacement', () => {
  const seuil = 2000;
  const r = regles({ distanceMaxKm: seuil / 1000 });
  const a = enr();
  const b = enr();
  for (const d of [1, seuil - 1, seuil, seuil + 1, 50_000]) {
    const enAlerte = alerte({ a, b }, ok(d), r).alerte;
    const nonValide = validerEspacement([{ enr: b, route: ok(d) }], seuil).statut === 'non-valide';
    assert.equal(enAlerte, nonValide, `${d} m`);
    assert.equal(enAlerte, violeEspacement(d, seuil));
  }
  for (const route of [{ statut: 'indisponible' }, { statut: 'erreur', erreur: 'x' }]) {
    assert.equal(alerte({ a, b }, route, r).alerte, false);
    assert.equal(validerEspacement([{ enr: b, route }], seuil).statut, 'verification-impossible');
  }
});

test('validation en direct d’un emplacement : routes du moteur vers la même faction seulement, autres factions ignorées', async () => {
  const deplace = enr({ shift: '12-18' });
  const memeF = enr({ shift: '12-18', longitude: -7.6 + est(400) });
  const autreF = enr({ shift: '00-06', longitude: -7.6 + est(150) }); // très proche mais autre faction
  const appels = [];
  const reseau = { async itineraire(de, vers) { appels.push(vers); return { chemin: [de, vers], distance: distanceMetres(de, vers) * 1.3, secondes: 30 }; } };
  const liste = [deplace, memeF, autreF];
  // Proposé à 300 m de memeF : 390 m par la route ≤ 1 km → non valide.
  const proche = await validerEmplacementRoutier([-7.6 + est(100), 33.5], deplace.barage, liste, 1000, reseau);
  assert.equal(proche.statut, 'non-valide');
  assert.deepEqual(proche.violations.map((v) => v.enr.barage.id), [memeF.barage.id]);
  assert.ok(appels.every((p) => p[0] !== autreF.barage.longitude), 'l’autre faction n’est jamais routée');
  // Proposé loin : aucun voisin requis → valide ; et le barage lui-même n'est jamais comparé.
  const loin = await validerEmplacementRoutier([-7.6 - est(5000), 33.5], deplace.barage, liste, 1000, reseau);
  assert.equal(loin.statut, 'valide');
  const surPlace = await validerEmplacementRoutier([-7.6, 33.5], deplace.barage, [deplace], 1000, reseau);
  assert.equal(surPlace.requis, 0, 'pas de comparaison avec soi-même');
});

test('routes non reliées : emplacement « vérification impossible », jamais valide', async () => {
  const X = (lon) => (lon + 7.6) * 111_320 * Math.cos((33.5 * Math.PI) / 180);
  const Y = (lat) => (lat - 33.5) * 111_320;
  const moteurGraphe = (lignes) => ({
    async itineraire(de, vers) {
      const r = cheminDansGraphe(construireGraphe(lignes), [X(de[0]), Y(de[1])], [X(vers[0]), Y(vers[1])]);
      return r && { chemin: [de, vers], distance: r.distance, secondes: r.secondes };
    },
  });
  const voisin = enr({ longitude: -7.6 + est(100), latitude: 33.5 + 300 / 111_320 });
  const deplace = enr({ longitude: -7.6 + est(2000) });
  const point = [-7.6 + est(100), 33.5];
  const separe = await validerEmplacementRoutier(point, deplace.barage, [deplace, voisin], 1000, moteurGraphe([{ points: [[0, 300], [3000, 300]] }, { points: [[0, 0], [3000, 0]] }]));
  assert.equal(separe.statut, 'verification-impossible');
  assert.equal(separe.indisponibles[0].route.statut, 'indisponible');
});

// ── Carte de chaleur ──────────────────────────────────────────────────────

test('carte de chaleur : classes dérivées de la validation commune', () => {
  const a = enr();
  const v = (verifs) => validerEspacement(verifs, 1000);
  assert.equal(classerCandidat(v([{ enr: a, route: ok(5000) }])), 'adapte');
  assert.equal(classerCandidat(v([])), 'adapte');
  assert.equal(classerCandidat(v([{ enr: a, route: ok(1100) }])), 'a-examiner', 'au-delà du seuil mais à moins de 1,2 × seuil');
  assert.equal(classerCandidat(v([{ enr: a, route: { ...ok(5000), approximatif: true } }])), 'a-examiner', 'itinéraire approximatif');
  assert.equal(classerCandidat(v([{ enr: a, route: ok(1000) }])), 'invalide');
  assert.equal(classerCandidat(v([{ enr: a, route: { statut: 'indisponible' } }])), 'indetermine');
  assert.deepEqual(Object.keys(CLASSES_CANDIDAT).sort(), ['a-examiner', 'adapte', 'indetermine', 'invalide']);
});

test('carte de chaleur : points pris sur les routes carrossables, dans la zone, sans doublon', () => {
  const route = { classe: 'primary', ref: 'RN1', points: [[-7.6, 33.5], [-7.6 + est(3000), 33.5]] };
  const sentier = { classe: 'path', points: [[-7.6, 33.6], [-7.6 + est(3000), 33.6]] };
  const classes = new Set(['primary']);
  const pts = echantillonnerLignes([route, sentier, route], 1000, { classes });
  assert.equal(pts.length, 3, 'mi-pas puis un point tous les 1000 m ; route lue deux fois → pas de doublon ; sentier ignoré');
  assert.ok(pts.every((p) => p.route.ref === 'RN1' && Math.abs(p.point[1] - 33.5) < 1e-9));
  assert.ok(Math.abs(distanceMetres(pts[0].point, route.points[0]) - 500) < 1);
  const dansZone = echantillonnerLignes([route], 1000, { classes, dans: (p) => p[0] < -7.6 + est(1200) });
  assert.equal(dansZone.length, 1);
  assert.deepEqual(fenetres([0, 0, 0.5, 0.3], 0.25).length, 4);
});

// ── Zone choisie ──────────────────────────────────────────────────────────

test('zone : la plus précise des circonscriptions du projet, erreur si ses limites manquent', () => {
  const carre = { type: 'Polygon', coordinates: [[[-8, 33], [-7, 33], [-7, 34], [-8, 34], [-8, 33]]] };
  const circos = {
    reg: [{ proprietes: { id: 'reg-1', nom: 'Rabat' }, geometrie: carre, emprise: [-8, 33, -7, 34] }],
    cie: [{ proprietes: { id: 'cie-1', nom: 'Salé' }, geometrie: carre, emprise: [-7.9, 33.9, -7.7, 34] }],
    bt: [],
  };
  assert.deepEqual(cibleZone(circos, {}), { tout: true });
  const reg = cibleZone(circos, { reg: 'reg-1' });
  assert.equal(reg.nom, 'Rabat');
  assert.deepEqual(reg.emprise, [-8, 33, -7, 34]);
  assert.equal(cibleZone(circos, { reg: 'reg-1', cie: 'cie-1' }).nom, 'Salé', 'la compagnie, plus précise');
  assert.match(cibleZone(circos, { reg: 'reg-9' }).erreur, /introuvables/);
  assert.match(cibleZone(circos, { reg: 'reg-1', bt: 'bt-1' }).erreur, /brigade/);
  assert.match(cibleZone(null, { reg: 'reg-1' }).erreur, /introuvables/);
});

// ── Cache des itinéraires ─────────────────────────────────────────────────

test('cache : une paire calculée une fois (dans les deux sens), oubliée quand les barages changent, erreurs non gardées', async () => {
  let n = 0;
  const reseau = { async itineraire(de, vers) { n += 1; if (de[0] === 9) throw new Error('panne'); return { chemin: [de, vers], distance: 100, secondes: 10 }; } };
  const cache = new CacheItineraires(reseau);
  cache.valider(1);
  const a = [-7.6, 33.5];
  const b = [-7.5, 33.5];
  const r1 = await cache.itineraire(a, b);
  const r2 = await cache.itineraire(b, a);
  assert.equal(n, 1);
  assert.deepEqual(r2.chemin, [...r1.chemin].reverse(), 'tracé retourné');
  cache.valider(1);
  await cache.itineraire(a, b);
  assert.equal(n, 1);
  cache.valider(2); // barages modifiés
  await cache.itineraire(a, b);
  assert.equal(n, 2);
  await assert.rejects(cache.itineraire([9, 0], [9, 1]));
  await assert.rejects(cache.itineraire([9, 0], [9, 1]));
  assert.equal(n, 4, 'une erreur n’est pas mise en cache');
});

test('historique : borné, relu sans erreur, propositions comptées par statut', () => {
  let h = lireHistoriqueProximite({ analyses: [null, 'x'], propositions: 3 });
  assert.deepEqual(h, HISTORIQUE_VIDE());
  for (let i = 0; i < 25; i++) h = ajouterAnalyse(h, { id: `A${i}`, alertes: Array(LIMITES_HISTORIQUE.alertesParAnalyse + 5).fill({}) });
  assert.equal(h.analyses.length, LIMITES_HISTORIQUE.analyses);
  assert.equal(h.analyses[0].alertes.length, LIMITES_HISTORIQUE.alertesParAnalyse);
  h = ajouterProposition(h, { id: 'P1', statut: 'en-attente' });
  h = ajouterProposition(h, { id: 'P2', statut: 'en-attente' });
  h = majProposition(h, { id: 'P1', statut: 'appliquee' });
  assert.deepEqual(compterPropositions(h), { total: 2, 'en-attente': 1, appliquee: 1, rejetee: 0, annulee: 0, echec: 0 });
  for (let i = 0; i < 250; i++) h = ajouterProposition(h, { id: `R${i}`, statut: 'rejetee' });
  assert.equal(h.propositions.length, LIMITES_HISTORIQUE.propositions);
  assert.ok(h.propositions.some((p) => p.id === 'P1'), 'une proposition appliquée (annulable) est gardée');
});

test('volume : 20 000 barages, regroupement par faction et filtre préalable en moins d’une seconde', () => {
  const liste = [];
  for (let i = 0; i < 20_000; i++) liste.push(enr({ shift: ['00-06', '06-12', '12-18', '18-24'][i % 4], latitude: 28 + (i % 400) * 0.02, longitude: -12 + Math.floor(i / 400) * 0.2 }));
  const t0 = performance.now();
  const r = pairesCandidates(liste, regles({ distanceMaxKm: 2 }));
  assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(r.analyses, 20_000);
  assert.ok(r.candidats.every((c) => memeFaction(c.a.barage, c.b.barage)));
});

// ── Surface continue d'aptitude ───────────────────────────────────────────

const candidat = (lon, lat, classe, minimumM = null, seuilM = 5000) => ({ point: [lon, lat], classe, validation: { minimumM, seuilM } });

test('surface : aptitude des candidats (adapté ≥ 0,7, à examiner 0,45, non valide 0, inconnu null)', () => {
  assert.equal(scoreCandidat(candidat(0, 0, 'adapte')), 1);
  assert.ok(scoreCandidat(candidat(0, 0, 'adapte', 6000)) >= 0.7 && scoreCandidat(candidat(0, 0, 'adapte', 6000)) < 1);
  assert.equal(scoreCandidat(candidat(0, 0, 'a-examiner', 5500)), 0.45);
  assert.equal(scoreCandidat(candidat(0, 0, 'invalide', 1000)), 0);
  assert.equal(scoreCandidat(candidat(0, 0, 'indetermine')), null);
});

test('surface : une zone qui viole l’espacement n’apparaît jamais adaptée, même entourée de zones adaptées', () => {
  const dLon = est(1000);
  const cands = [candidat(-7.6, 33.5, 'invalide', 2000)];
  for (let k = 1; k <= 6; k++) cands.push(candidat(-7.6 + k * dLon, 33.5, 'adapte'), candidat(-7.6 - k * dLon, 33.5, 'adapte'));
  const index = indexerCandidats(cands, 2500);
  const auPied = aptitudeEn([-7.6, 33.5], index, 2500).valeur;
  assert.ok(auPied >= 0 && auPied < 1 / 3, `${auPied}`);
  const aMiChemin = aptitudeEn([-7.6 + dLon * 0.45, 33.5], index, 2500).valeur;
  assert.ok(aMiChemin < 0.67, `près du point non valide : ${aMiChemin}`);
  const loin = aptitudeEn([-7.6 + dLon * 5, 33.5], index, 2500).valeur;
  assert.ok(loin >= 0.67, `loin : ${loin}`);
});

test('surface : route manquante → inconnu (jamais adapté) ; aucune route proche → sans route', () => {
  const cands = [candidat(-7.6, 33.5, 'indetermine'), candidat(-7.6 + est(800), 33.5, 'indetermine'), candidat(-7.6 + est(1600), 33.5, 'adapte')];
  const index = indexerCandidats(cands, 2000);
  assert.equal(aptitudeEn([-7.6, 33.5], index, 2000).valeur, INCONNU);
  assert.equal(aptitudeEn([-7.0, 33.5], index, 2000).valeur, SANS_ROUTE);
  assert.equal(aptitudeEn([-7.6, 33.5], index, 2000).proche, 0);
});

test('surface : grille raster dans la projection de la carte, continue, couleurs graduées', () => {
  const cands = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) cands.push(candidat(-7.6 + i * 0.01, 33.4 + j * 0.01, (i + j) % 7 === 0 ? 'invalide' : 'adapte', 6000 + ((i * j) % 9) * 600));
  const g = grilleAptitude(cands, [-7.6, 33.4, -7.41, 33.59], { largeur: 120, rayonM: 2000 });
  assert.equal(g.valeurs.length, g.largeur * g.hauteur);
  assert.ok(g.hauteur > 100 && g.hauteur < 150, `hauteur Mercator ${g.hauteur}`);
  assert.ok(g.lat(0) > g.lat(g.hauteur - 1) && g.lat(0) < 33.59 && g.lat(g.hauteur - 1) > 33.4, 'du nord au sud');
  assert.deepEqual(g.coins, [[-7.6, 33.59], [-7.41, 33.59], [-7.41, 33.4], [-7.6, 33.4]]);
  const valeurs = [...g.valeurs].filter((v) => v >= 0);
  assert.ok(valeurs.length > g.valeurs.length * 0.9, 'surface couvrante sur le réseau');
  assert.ok(new Set(valeurs.map((v) => v.toFixed(2))).size > 20, 'valeurs continues, pas quelques paliers');
  assert.deepEqual(couleurAptitude(0).slice(0, 3), [185, 28, 28]);
  assert.deepEqual(couleurAptitude(1).slice(0, 3), [21, 128, 61]);
  assert.deepEqual(couleurAptitude(0.5).slice(0, 3), [245, 158, 11]);
  assert.ok(couleurAptitude(0.25)[0] > couleurAptitude(0.75)[0], 'graduel');
  assert.equal(couleurAptitude(INCONNU)[3], 150);
  assert.match(libelleAptitude(0.1), /Non adapté/);
  assert.match(libelleAptitude(INCONNU), /Inconnu/);
});

// ── Optimisation en une étape (fenêtre « Calculer ») ─────────────────────

test('fenêtre : distance positive obligatoire (virgule acceptée), 10 km par défaut', async () => {
  const { validerDistanceSimple, DISTANCE_SIMPLE_DEFAUT_KM } = await import('./proximite.js');
  assert.equal(DISTANCE_SIMPLE_DEFAUT_KM, 10);
  assert.deepEqual(validerDistanceSimple('10'), { km: 10 });
  assert.deepEqual(validerDistanceSimple('2,5'), { km: 2.5 });
  for (const mauvais of ['', '0', '-3', 'abc', null, '500']) assert.ok(validerDistanceSimple(mauvais).erreur, String(mauvais));
});

test('une étape : toutes les factions, les deux types, tout le Royaume ; seuls les non conformes et les non vérifiés sont rendus', async () => {
  const { reglesSimples, resultatsNonConformes } = await import('./proximite.js');
  const r = reglesSimples(2);
  assert.deepEqual([r.distanceMaxKm, r.faction, r.types, r.origine, r.perimetre], [2, 'toutes', ['fixe', 'intouchable'], 'toutes', { reg: '', cie: '', bt: '' }]);
  assert.deepEqual(validerReglesProximite(r).erreurs, []);
  // Barages : deux déplaçables faction 1, un déplaçable faction 2, deux intouchables, un réel.
  const f1a = enr({ shift: '00-06' });
  const f1b = enr({ shift: '00-06', longitude: -7.6 + est(300) });
  const f2 = enr({ shift: '06-12', longitude: -7.6 + est(100) });
  const i1 = enr({ type: 'intouchable', shift: 'continu', longitude: -7.6 + est(600) });
  const i2 = enr({ type: 'intouchable', shift: 'continu', longitude: -7.6 + est(900) });
  const reel = enr({ isSimulation: false, longitude: -7.6 + est(50) });
  const liste = [f1a, f1b, f2, i1, i2, reel];
  const { candidats } = pairesCandidates(liste, r);
  const cles = candidats.map(cle);
  assert.equal(new Set(cles).size, cles.length, 'aucune paire en double');
  assert.ok(candidats.every((c) => c.a.barage.id !== c.b.barage.id), 'aucun barage avec lui-même');
  assert.ok(!cles.some((k) => k.includes(f1a.barage.id) && k.includes(f2.barage.id)), 'factions 1 et 2 jamais comparées');
  assert.ok(!cles.some((k) => k.includes(reel.barage.id)), 'le réel n’a aucun voisin réel : aucune paire');
  // Distances routières imposées par paire (le moteur est remplacé par un double de test).
  const routeDe = (c) => {
    const k = cle(c);
    if (k === [f1a.barage.id, f1b.barage.id].sort().join('+')) return 1999; // < seuil
    if (k === [f1a.barage.id, i1.barage.id].sort().join('+')) return 2000; // = seuil
    if (k === [i1.barage.id, i2.barage.id].sort().join('+')) return 500; // deux intouchables
    if (k === [f2.barage.id, i2.barage.id].sort().join('+')) return null; // route introuvable
    if (k === [f2.barage.id, i1.barage.id].sort().join('+')) return 'erreur';
    return 2001; // > seuil
  };
  const routes = candidats.map((c) => { const d = routeDe(c); return d === null ? { statut: 'indisponible' } : d === 'erreur' ? { statut: 'erreur', erreur: 'panne' } : ok(d); });
  const alertes = candidats.map((c, i) => alerte(c, routes[i], r));
  const { violations, nonVerifiees } = resultatsNonConformes([...alertes, alertes[0]]); // doublon ajouté exprès
  const v = violations.map((i) => alertes[i]);
  assert.deepEqual(v.map((a) => a.routeM).sort((x, y) => x - y), [500, 1999, 2000], 'seulement ≤ seuil, distance routière vérifiée');
  assert.equal(violations.length, new Set(violations.map((i) => cle(candidats[i]))).size, 'doublon écarté');
  const deuxFixes = v.find((a) => a.routeM === 500);
  assert.equal(deuxFixes.informatif, true, 'deux intouchables : information seule');
  assert.deepEqual(deuxFixes.mobiles, []);
  const mixte = v.find((a) => a.routeM === 2000);
  assert.deepEqual(mixte.mobiles, [f1a.barage.id], 'intouchable / déplaçable : actions sur le déplaçable seul');
  assert.equal(v.find((a) => a.routeM === 1999).mobiles.length, 2, 'deux déplaçables : l’un ou l’autre');
  const nv = nonVerifiees.map((i) => alertes[i]);
  assert.deepEqual(nv.map((a) => a.statutRoute).sort(), ['erreur', 'indisponible'], 'routes manquantes : non vérifiées, jamais des violations');
  assert.ok(nv.every((a) => a.alerte === false && a.routeM === null));
});
