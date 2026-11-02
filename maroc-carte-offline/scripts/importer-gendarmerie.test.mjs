import assert from 'node:assert/strict';
import test from 'node:test';
import { IndexRecherche, VERSION_INDEX } from '../src/recherche.js';
import {
  arrondir, cleUnite, construire, dansPolygone, emprise, enTitre, fusionnerUnitesExcel, marquerSites, pointEtiquette, reparerNom,
  separerNoms, squelette,
} from './importer-gendarmerie.mjs';

const carre = (x, y, c = 1) => ({ type: 'Polygon', coordinates: [[[x, y], [x + c, y], [x + c, y + c], [x, y + c], [x, y]]] });
const point = (x, y) => ({ type: 'Point', coordinates: [x, y] });
const fc = (features) => ({ type: 'FeatureCollection', features });
const f = (geometry, properties) => ({ type: 'Feature', geometry, properties });

test('noms : casse, préfixes, rapprochements', () => {
  assert.equal(enTitre('BT IMOUZER IDA OUTANANE'), 'BT Imouzer Ida Outanane');
  assert.equal(enTitre('CIE AIN-AOUDA'), 'Cie Ain-Aouda');
  assert.equal(enTitre('Reg Tétouan'), 'Reg Tétouan'); // déjà en casse mixte : inchangé
  assert.equal(cleUnite('BT AGADIR'), cleUnite('Agadir'));
  assert.equal(squelette('BT DRARGA'), squelette('Drargua'));
  assert.equal(squelette('Ait Abdellah'), squelette('Ait Abdallah'));
  assert.notEqual(squelette('Agadir'), squelette('Azrou'));
});

test('accents perdus réparés seulement si le nom correct concorde', () => {
  assert.equal(reparerNom('Cie T�touan', 'Tétouan'), 'Cie Tétouan');
  assert.equal(reparerNom('El Kela� Des Sraghn', 'El Kelaâ Des Sraghna'), 'El Kelaâ Des Sraghna');
  assert.equal(reparerNom('Cie T�touan', 'Tanger'), 'Cie T�touan');
  assert.equal(reparerNom('Cie Agadir', 'Tanger'), 'Cie Agadir');
});

test('noms d’infrastructure : latin et arabe séparés, tifinagh écarté', () => {
  assert.deepEqual(separerNoms('Aéroport Marrakech Ménara ⴰⵣⴰⴳⵯⵣ ⵏ ⵎⵕⵕⴰⴽⵛ مطار مراكش المنارة'),
    { fr: 'Aéroport Marrakech Ménara', ar: 'مطار مراكش المنارة' });
  assert.deepEqual(separerNoms('الحسيمة'), { fr: 'الحسيمة', ar: '' });
  assert.deepEqual(separerNoms('Gare Ennassim'), { fr: 'Gare Ennassim', ar: '' });
});

test('géométrie : arrondi, emprise, point d’étiquette à l’intérieur', () => {
  assert.deepEqual(arrondir(point(-7.123456789, 33.987654321)).coordinates, [-7.12346, 33.98765]);
  assert.deepEqual(emprise(carre(-8, 30, 2)), [[-8, 30], [-6, 32]]);
  // Contour en U : le centroïde tomberait dans l'échancrure.
  const u = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
  const p = pointEtiquette(u);
  assert.ok(dansPolygone(p, u.coordinates), `point ${p} hors du contour`);
  // Multipolygone : l'étiquette va dans la plus grande partie.
  const multi = { type: 'MultiPolygon', coordinates: [carre(0, 0, 0.1).coordinates, carre(-8, 30, 2).coordinates] };
  const q = pointEtiquette(multi);
  assert.ok(q[0] > -8 && q[0] < -6 && q[1] > 30 && q[1] < 32);
});

function jeuEssai() {
  return {
    circo_reg: fc([f(carre(-8, 30, 2), { nom: 'Agadir', nbBt: 2, nbCie: 1, population: 1000, superficie: 400, confiance: 1 })]),
    circo_cie: fc([f(carre(-8, 30, 2), { nom: 'Agadir', nbBt: 2, nbCie: 1, population: 1000, superficie: 400, confiance: 0.5, reg: 'Agadir' })]),
    circo_bt: fc([
      f(carre(-8, 30, 1), { gr_bde: 'Agadir', gr_cie: 'Agadir', gr_region: 'Agadir', population: 800, superficie: 100.4 }),
      f(carre(-7, 31, 1), { gr_bde: 'Drargua', gr_cie: 'Agadir', gr_region: 'Agadir', population: 200, superficie: 300 }),
    ]),
    pts_reg: fc([f(point(-7.5, 30.5), { nom: 'Reg Agadir', unite: 'Agadir' })]),
    pts_cie: fc([f(point(-7.5, 30.5), { nom: 'Cie Agadir', unite: 'Agadir' })]),
    pts_bt: fc([
      f(point(-7.5, 30.5), { nom: 'BT AGADIR', cie: 'CIE AGADIR', reg: 'REG AGADIR' }),
      f(point(-6.5, 31.5), { nom: 'BT DRARGA', cie: 'CIE AGADIR', reg: 'REG AGADIR' }),
      f(point(-6.4, 31.6), { nom: 'BT BASE AERIENNE', cie: 'CIE AGADIR', reg: 'REG AGADIR' }),
      f(null, { nom: 'BT SANS POSITION' }),
    ]),
    peages: fc([f(point(-7.2, 30.2), { nom: 'Péage de Test' })]),
    aeroports: fc([f(point(-7.1, 30.1), { nom: 'Aéroport Test مطار', iata: 'TST' }), f(point(10, 50), { nom: 'Hors Royaume' })]),
  };
}

test('construire : rattachements, anomalies, infrastructures', () => {
  const { fichiers, rapport } = construire(jeuEssai(), { issues: [{ level: 'critical', message: '1105 pointages hors circonscription' }] });
  const bt = fichiers['unites.geojson'].features.filter((u) => u.properties.niveau === 'bt').map((u) => u.properties);
  assert.equal(bt.length, 3); // le chef-lieu sans position est écarté
  assert.deepEqual(bt.map((u) => [u.nom, u.rattachement, u.circoNom]), [
    ['BT Agadir', 'nom', 'Agadir'],
    ['BT Drarga', 'orthographe', 'Drargua'],
    ['BT Base Aerienne', 'position', 'Drargua'],
  ]);
  assert.equal(bt[0].population, 800);
  assert.equal(bt[0].cie, 'Agadir');
  assert.equal(fichiers['circo-bt.geojson'].features[0].properties.superficie, 100);
  assert.equal(rapport.chefsLieux.bt, 3);
  assert.equal(rapport.fictif, false);
  assert.ok(rapport.anomalies.some((a) => /coordonnées valides/.test(a.message)));
  assert.ok(rapport.anomalies.some((a) => /Agadir 50 %/.test(a.message)));
  assert.ok(!rapport.anomalies.some((a) => /pointages/.test(a.message)), 'couche non importée : anomalie non reprise');
  assert.deepEqual(rapport.infrastructures, { peage: 1, gare: 0, aeroport: 1, port: 0 });
  const aeroport = fichiers['infrastructures.geojson'].features.find((x) => x.properties.type === 'aeroport').properties;
  assert.deepEqual([aeroport.nom, aeroport.nomAr, aeroport.iata], ['Aéroport Test', 'مطار', 'TST']);
  const etiquettes = fichiers['etiquettes.geojson'].features;
  assert.equal(etiquettes.length, 4);
  assert.deepEqual(etiquettes.find((e) => e.properties.niveau === 'reg').properties.emprise, [[-8, 30], [-6, 32]]);
});

test('construire : le jeu fictif de la source reste signalé comme tel', () => {
  assert.equal(construire(jeuEssai(), { fictif: true }).rapport.fictif, true);
});

test('index de recherche des unités : lisible par la recherche', () => {
  const { fichiers } = construire(jeuEssai());
  const donnees = fichiers['recherche-gendarmerie.json'];
  assert.equal(donnees.version, VERSION_INDEX);
  const index = new IndexRecherche(donnees);
  const [premier] = index.chercher('bt drarga');
  assert.equal(premier.nom, 'BT Drarga');
  assert.equal(premier.libelle, 'Brigade territoriale · Gendarmerie');
  assert.equal(premier.contexte, 'Cie Agadir · Rég. Agadir');
  // La circonscription « Drargua » a un chef-lieu (orthographe voisine) : pas d'entrée en double.
  assert.ok(!index.chercher('circonscription drargua').length);
  // Recherche par catégorie : « gendarmerie » donne les unités.
  assert.ok(index.chercher('gendarmerie', { centre: [-7.5, 30.5] }).length >= 3);
  assert.equal(index.chercher('reg agadir', { langue: 'ar' })[0].libelle, 'القيادة الجهوية · الدرك');
});

// ── Classeur ───────────────────────────────────────────────────────────────

test('classeur : chaque unité rattachée à ce qu’elle est (colonnes), puis à son site', () => {
  const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
  const bt = point([-7, 33], { niveau: 'bt', nom: 'BT Ras El Ain', lieu: 'Ras El Ain' });
  const cie = point([-8, 32], { niveau: 'cie', nom: 'Cie Safi', lieu: 'Safi' });
  const reg = point([-8.01, 32], { niveau: 'reg', nom: 'Reg Safi', lieu: 'Safi' });
  const chefsLieux = [bt, cie, reg];
  const ligne = (coordinates, nom, compagnie = null, regroupement = 'REG SAFI') => point(coordinates, { nom, compagnie, regroupement });
  const lignes = [
    ligne([-7, 33], 'BT RAS EL AIN (SAFI)', 'CIE SAFI'), // la brigade elle-même
    ligne([-7.0001, 33], 'BJ RAS EL AIN', 'CIE SAFI'), // relève de la Cie Safi, sur le site de la brigade
    ligne([-7, 33], 'BT VOISINE', 'CIE SAFI'), // brigade inconnue posée sur une autre : conflit
    ligne([-7.03, 33.85], 'EMCIE SKHIRATE', 'CIE SKHIRATE', 'REG RABAT'), // état-major d'une compagnie sans chef-lieu
    ligne([-7.03, 33.85], 'EMCIE SKHIRATE PHOTO', 'CIE SKHIRATE', 'REG RABAT'),
    ligne([-8.01, 32], 'EMR SAFI SANTE', 'CIE SAFI'), // service d'état-major régional : la région, pas la compagnie
    ligne([-6, 31], 'EMR X SANTE', null, 'REG X'), // région inconnue : site à part
    ligne([-6, 31], 'EMR X', null, 'REG X'),
    ligne([-8.2, 32], 'EMCIE SAFI', 'CIE SAFI'), // l'état-major de la Cie Safi, ≈ 19 km de son chef-lieu : écart signalé
  ];
  const { sites, doublons, crees, rattachees, conflits, ecarts } = fusionnerUnitesExcel(chefsLieux, lignes, [{ id: 'cie-9', nom: 'Skhirate', reg: 'Rabat' }]);
  assert.deepEqual(doublons.map((l) => l.properties.nom), ['BT RAS EL AIN (SAFI)', 'EMCIE SKHIRATE', 'EMCIE SAFI']);
  assert.equal(crees.length, 1);
  assert.deepEqual([crees[0].properties.nom, crees[0].properties.circo, crees[0].properties.rattachement], ['Cie Skhirate', 'cie-9', 'classeur']);
  assert.deepEqual(crees[0].properties.rattachees, [['EMCIE SKHIRATE PHOTO', null]]);
  assert.deepEqual(cie.properties.rattachees, [['BT VOISINE', 'BT Ras El Ain'], ['BJ RAS EL AIN', 'BT Ras El Ain']]);
  assert.deepEqual(bt.properties.surSite, [['BT VOISINE', 'Cie Safi'], ['BJ RAS EL AIN', 'Cie Safi']]);
  assert.deepEqual(reg.properties.rattachees, [['EMR SAFI SANTE', null]]);
  assert.equal(bt.properties.rattachees, undefined);
  assert.equal(rattachees, 4); // BJ, BT VOISINE, EMCIE SKHIRATE PHOTO, EMR SAFI SANTE
  assert.deepEqual(conflits, [['BT Ras El Ain', 'BT VOISINE']]);
  assert.deepEqual(ecarts.map(([nom]) => nom), ['EMCIE SAFI']);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].properties.etiquette, 'EMR X +1');
  assert.deepEqual(sites[0].properties.unites, ['EMR X', 'EMR X SANTE']);
});

test('chefs-lieux au même point : même échelon signalé, échelons différents liés', () => {
  const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties });
  const unites = [
    point([-7, 33], { niveau: 'bt', nom: 'BT A' }),
    point([-7.0001, 33], { niveau: 'bt', nom: 'BT B' }), // ≈ 9 m : même position, anomalie
    point([-7, 33.0001], { niveau: 'cie', nom: 'Cie A' }), // même site, échelon différent
    point([-6, 32], { niveau: 'bt', nom: 'BT C', memePosition: ['ancien'] }), // recalculé de zéro
    point([-7, 33], { niveau: 'excel', nom: 'EMR A' }), // pas un chef-lieu : ignoré
  ];
  assert.deepEqual(marquerSites(unites), ['BT A = BT B']);
  assert.deepEqual(unites[0].properties.memePosition, ['BT B']);
  assert.deepEqual(unites[0].properties.memeSite, ['Cie A']);
  assert.deepEqual(unites[2].properties.memeSite, ['BT A', 'BT B']);
  assert.equal(unites[3].properties.memePosition, undefined);
});
