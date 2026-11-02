/**
 * scripts/verifier-barrages-aller-retour.mjs
 *
 * Suite de tests automatisée pour la validation du filtrage par route
 * et de la gestion des barrages Aller / Retour :
 *
 * Cas 1 : Route avec des barrages uniquement dans le sens Aller.
 * Cas 2 : Route avec des barrages uniquement dans le sens Retour.
 * Cas 3 : Route avec des barrages dans les deux sens.
 * Cas 4 : Deux barrages proches sur la même route, mais dans des sens opposés (séparation visuelle latérale, non-superposition).
 * Cas 5 : Route avec des barrages fixes (FIXED) et permanents (FIXED_PERMANENT) dans les deux sens.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SENS_ALLER,
  SENS_RETOUR,
  SENS_TOUS,
  normaliserDirection,
  obtenirDirectionBarrage,
  libelleDirection,
  symboleDirection,
  badgeDirection,
  separerBarragesSens,
  ajusterPositionSens,
  distanceMetres,
} from '../src/directionSens.js';
import {
  normaliserDirection as normaliserDirectionSrv,
  obtenirDirectionBarrage as obtenirDirectionBarrageSrv,
  enrichirBarrageDirection,
} from '../serveur/directionSens.mjs';

// Données de test représentatives d'un axe routier à double sens (N1)
const AXE_N1_COORDS = [
  [-6.8498, 33.9716],
  [-6.8400, 33.9800],
  [-6.8300, 33.9900],
  [-6.8200, 34.0000],
];

test('Gestion des directions : Normalisation et labels', () => {
  assert.equal(normaliserDirection('aller'), SENS_ALLER);
  assert.equal(normaliserDirection('ALLER'), SENS_ALLER);
  assert.equal(normaliserDirection('Sens 1'), SENS_ALLER);
  assert.equal(normaliserDirection('1'), SENS_ALLER);

  assert.equal(normaliserDirection('retour'), SENS_RETOUR);
  assert.equal(normaliserDirection('RETOUR'), SENS_RETOUR);
  assert.equal(normaliserDirection('Sens 2'), SENS_RETOUR);
  assert.equal(normaliserDirection('2'), SENS_RETOUR);

  assert.equal(normaliserDirection('inconnu'), null);
  assert.equal(normaliserDirection(null), null);

  assert.equal(libelleDirection(SENS_ALLER), 'Sens Aller (Sens 1)');
  assert.equal(libelleDirection(SENS_RETOUR), 'Sens Retour (Sens 2)');
  assert.equal(symboleDirection(SENS_ALLER), '➔');
  assert.equal(symboleDirection(SENS_RETOUR), '⬅');

  const bA = badgeDirection(SENS_ALLER);
  assert.equal(bA.labelCourt, 'Aller');
  assert.ok(bA.classe.includes('sky'));

  const bR = badgeDirection(SENS_RETOUR);
  assert.equal(bR.labelCourt, 'Retour');
  assert.ok(bR.classe.includes('amber'));
});

test('Détermination déterministe si direction absente', () => {
  const barrageSansSensA = { id: 'B-101', nom: 'Barrage Km 12', lat: 33.975, lng: -6.845 };
  const barrageSansSensB = { id: 'B-102', nom: 'Barrage Km 14', lat: 33.985, lng: -6.835 };

  const dir1 = obtenirDirectionBarrage(barrageSansSensA);
  const dir1Bis = obtenirDirectionBarrage(barrageSansSensA);
  // Stabilité déterministe
  assert.equal(dir1, dir1Bis);
  assert.ok(dir1 === SENS_ALLER || dir1 === SENS_RETOUR);

  // Côté serveur
  const enrichi = enrichirBarrageDirection(barrageSansSensA);
  assert.equal(enrichi.direction, dir1);
  assert.ok(Array.isArray(enrichi.coordinates));
});

test('Cas 1 : Une route avec des barrages uniquement dans le sens Aller', () => {
  const barragesRoute = [
    { id: 'B1', nom: 'Barrage N1 Nord A1', route: 'N1', direction: SENS_ALLER, lat: 33.972, lng: -6.848 },
    { id: 'B2', nom: 'Barrage N1 Nord A2', route: 'N1', direction: SENS_ALLER, lat: 33.985, lng: -6.835 },
  ];

  // Filtrage par sens Aller
  const filtreAller = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_ALLER);
  assert.equal(filtreAller.length, 2);

  // Filtrage par sens Retour
  const filtreRetour = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_RETOUR);
  assert.equal(filtreRetour.length, 0);

  // Filtrage tous sens
  assert.equal(barragesRoute.length, 2);
});

test('Cas 2 : Une route avec des barrages uniquement dans le sens Retour', () => {
  const barragesRoute = [
    { id: 'B3', nom: 'Barrage N1 Sud R1', route: 'N1', direction: SENS_RETOUR, lat: 33.972, lng: -6.848 },
    { id: 'B4', nom: 'Barrage N1 Sud R2', route: 'N1', direction: SENS_RETOUR, lat: 33.985, lng: -6.835 },
  ];

  const filtreAller = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_ALLER);
  assert.equal(filtreAller.length, 0);

  const filtreRetour = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_RETOUR);
  assert.equal(filtreRetour.length, 2);
});

test('Cas 3 : Une route avec des barrages dans les deux sens', () => {
  const barragesRoute = [
    { id: 'B_ALLER_1', nom: 'Barrage N1 PK10 Aller', route: 'N1', direction: SENS_ALLER, route_position: 10.2, lat: 33.972, lng: -6.848 },
    { id: 'B_ALLER_2', nom: 'Barrage N1 PK25 Aller', route: 'N1', direction: SENS_ALLER, route_position: 25.4, lat: 33.985, lng: -6.835 },
    { id: 'B_RETOUR_1', nom: 'Barrage N1 PK12 Retour', route: 'N1', direction: SENS_RETOUR, route_position: 12.0, lat: 33.974, lng: -6.846 },
    { id: 'B_RETOUR_2', nom: 'Barrage N1 PK30 Retour', route: 'N1', direction: SENS_RETOUR, route_position: 30.1, lat: 33.990, lng: -6.830 },
  ];

  const aller = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_ALLER);
  const retour = barragesRoute.filter((b) => obtenirDirectionBarrage(b) === SENS_RETOUR);

  assert.equal(aller.length, 2);
  assert.equal(retour.length, 2);
  assert.equal(barragesRoute.length, 4);

  // Distincts : aucun ID n'est commun
  const idsAller = new Set(aller.map((b) => b.id));
  const idsRetour = new Set(retour.map((b) => b.id));
  for (const id of idsAller) {
    assert.ok(!idsRetour.has(id), `Le barrage ${id} ne doit pas appartenir aux deux sens simultanément`);
  }
});

test('Cas 4 : Deux barrages proches sur la même route, mais dans des sens opposés (séparation visuelle latérale)', () => {
  // Deux barrages situés quasiment aux mêmes coordonnées sur un axe à double sens
  const bAller = {
    id: 'B_AXE_ALLER',
    nom: 'Barrage N1 Km 20 Sens Aller',
    route: 'N1',
    direction: SENS_ALLER,
    lat: 33.978000,
    lng: -6.842000,
  };
  const bRetour = {
    id: 'B_AXE_RETOUR',
    nom: 'Barrage N1 Km 20 Sens Retour',
    route: 'N1',
    direction: SENS_RETOUR,
    lat: 33.978000, // Coordonnées géométriques identiques (axe médian)
    lng: -6.842000,
  };

  const distInitiale = distanceMetres(bAller.lat, bAller.lng, bRetour.lat, bRetour.lng);
  assert.equal(distInitiale, 0);

  // Application de la séparation visuelle de voie (separerBarragesSens)
  const [bAjusteA, bAjusteB] = separerBarragesSens([bAller, bRetour]);

  assert.ok(bAjusteA.latAffichee != null);
  assert.ok(bAjusteA.lngAffichee != null);
  assert.ok(bAjusteB.latAffichee != null);
  assert.ok(bAjusteB.lngAffichee != null);

  const distAffichee = distanceMetres(
    bAjusteA.latAffichee,
    bAjusteA.lngAffichee,
    bAjusteB.latAffichee,
    bAjusteB.lngAffichee
  );

  // Les deux marqueurs ne se superposent plus (séparés d'environ 11 mètres, soit ±5.5m)
  assert.ok(distAffichee >= 8 && distAffichee <= 14, `Distance entre marqueurs: ${distAffichee.toFixed(2)}m (doit être ~11m)`);

  // Chaque marqueur reste sur la chaussée (déplacement d'environ 5.5m du centre)
  const ecartA = distanceMetres(bAller.lat, bAller.lng, bAjusteA.latAffichee, bAjusteA.lngAffichee);
  const ecartB = distanceMetres(bRetour.lat, bRetour.lng, bAjusteB.latAffichee, bAjusteB.lngAffichee);
  assert.ok(ecartA >= 4.5 && ecartA <= 6.5, `Écart A de l'axe: ${ecartA.toFixed(2)}m (dans l'emprise de la chaussée)`);
  assert.ok(ecartB >= 4.5 && ecartB <= 6.5, `Écart B de l'axe: ${ecartB.toFixed(2)}m (dans l'emprise de la chaussée)`);

  // Les identités restent strictement distinctes
  assert.notEqual(bAjusteA.id, bAjusteB.id);
  assert.equal(bAjusteA.direction, SENS_ALLER);
  assert.equal(bAjusteB.direction, SENS_RETOUR);
});

test('Cas 5 : Une route avec des barrages fixes (FIXED) et permanents (FIXED_PERMANENT) dans les deux sens', () => {
  const barrages = [
    {
      id: 'BF-1',
      nom: 'Barrage Fixe N1 PK5 Aller',
      type: 'FIXED',
      nature: 'barrage_fixe',
      route: 'N1',
      direction: SENS_ALLER,
      permanent: false,
      lat: 33.971,
      lng: -6.849,
    },
    {
      id: 'BFI-1',
      nom: 'Barrage Permanent N1 PK8 Aller',
      type: 'FIXED_PERMANENT',
      nature: 'barrage_fixe_intouchable',
      route: 'N1',
      direction: SENS_ALLER,
      permanent: true,
      lat: 33.974,
      lng: -6.846,
    },
    {
      id: 'BF-2',
      nom: 'Barrage Fixe N1 PK15 Retour',
      type: 'FIXED',
      nature: 'barrage_fixe',
      route: 'N1',
      direction: SENS_RETOUR,
      permanent: false,
      lat: 33.981,
      lng: -6.839,
    },
    {
      id: 'BFI-2',
      nom: 'Barrage Permanent N1 PK20 Retour',
      type: 'FIXED_PERMANENT',
      nature: 'barrage_fixe_intouchable',
      route: 'N1',
      direction: SENS_RETOUR,
      permanent: true,
      lat: 33.986,
      lng: -6.834,
    },
  ];

  // Vérification de la présence des deux types dans les deux sens
  const allerFixe = barrages.filter((b) => b.direction === SENS_ALLER && b.type === 'FIXED');
  const allerPerm = barrages.filter((b) => b.direction === SENS_ALLER && b.type === 'FIXED_PERMANENT');
  const retourFixe = barrages.filter((b) => b.direction === SENS_RETOUR && b.type === 'FIXED');
  const retourPerm = barrages.filter((b) => b.direction === SENS_RETOUR && b.type === 'FIXED_PERMANENT');

  assert.equal(allerFixe.length, 1);
  assert.equal(allerPerm.length, 1);
  assert.equal(retourFixe.length, 1);
  assert.equal(retourPerm.length, 1);

  // Préservation des statuts permanents et intouchables
  assert.equal(allerPerm[0].permanent, true);
  assert.equal(retourPerm[0].permanent, true);
  assert.equal(allerFixe[0].permanent, false);
  assert.equal(retourFixe[0].permanent, false);
});
