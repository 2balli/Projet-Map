import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerGraphe } from '../serveur/routage.mjs';
import { analyserOptimisationDistance, listerConflitsDistance, SEUIL_DISTANCE_AUTO_KM } from '../serveur/optimisationDistance.mjs';

const KM_PAR_DEG = 111.32;
const lng = (km) => km / KM_PAR_DEG;
/* Les positions des jeux d'essai sont écrites pour un seuil de 40 km et
   ramenées au seuil en vigueur : les rapports de distance, donc les conflits,
   restent les mêmes quel que soit SEUIL_DISTANCE_AUTO_KM. */
const S = SEUIL_DISTANCE_AUTO_KM;
const r = (km) => (km * S) / 40;

function route(longueurKm = 180) {
  const pas = 0.5;
  const sommets = Array.from({ length: Math.round(longueurKm / pas) + 1 }, (_, i) => [lng(i * pas), 0]);
  const aretes = sommets.slice(1).map((_, i) => [i, i + 1, Math.round(pas * 1000), 0, 0, 0, 60]);
  return chargerGraphe({ classes: ['nationale'], vitesses: [60], refs: ['N1'], sommets, aretes });
}

const barrage = (id, km, extra = {}) => ({
  id, type: 'barrage_fixe', nom: id, lng: lng(km), lat: 0, route: 'N1',
  bt: 'BT-1', cie: 'CIE-1', reg: 'REG-1', factionId: 'F2',
  accidentCount: 0, exceptionnel: false, missionId: null, eclairage: 'oui',
  statutBarrage: 'approuve', ...extra,
});

test('seuil automatique (temporairement 20 km), mesuré le long du réseau', () => {
  const g = route();
  assert.equal(SEUIL_DISTANCE_AUTO_KM, 20);
  assert.equal(listerConflitsDistance([barrage('A', 10), barrage('B', 10 + S - 0.1)], g).length, 1);
  assert.equal(listerConflitsDistance([barrage('A', 10), barrage('B', 10 + S + 0.2)], g).length, 0);
});

test('le conflit suit le détour routier au lieu de la proximité à vol d’oiseau', () => {
  const g = chargerGraphe({
    classes: ['nationale'], refs: ['N2'], vitesses: [60],
    sommets: [[0, 0], [0.1, 0]],
    aretes: [[0, 1, 44000, 0, 0, 0, 60, 0, 0.15, 0.1, 0.15]],
  });
  assert.ok(Math.hypot(0.1, 0) * 111.32 < 40);
  assert.equal(listerConflitsDistance([
    barrage('A', r(0), { lng: 0, lat: 0, route: 'N2' }),
    barrage('B', r(0), { lng: 0.1, lat: 0, route: 'N2' }),
  ], g).length, 0);
});

test('un intouchable reste immobile et le barrage normal est déplacé sur une route', () => {
  const g = route();
  const bfi = barrage('BFI', r(50), { protection: 'intouchable', intouchable: true });
  const normal = barrage('NORMAL', r(20));
  const result = analyserOptimisationDistance([bfi, normal], g);
  const proposition = result.propositions.find((p) => p.id === 'NORMAL');
  assert.ok(proposition);
  assert.equal(proposition.action, 'deplacer');
  assert.equal(proposition.apres.factionId, 'F2');
  assert.ok(proposition.distanceApresKm >= S);
  assert.notEqual(proposition.apres.lng, normal.lng);
  assert.equal(result.propositions.some((p) => p.id === 'BFI'), false);
  assert.ok(proposition.apres.route);
  assert.ok(proposition.conflit.trace?.length > 1);
  assert.ok(proposition.routeApres?.length > 1);
});

test('entre deux normaux, le barrage le moins contraint est déplacé en premier', () => {
  const g = route();
  const contraint = barrage('A', r(20), { accidentCount: 2, exceptionnel: true });
  const simple = barrage('B', r(45));
  const result = analyserOptimisationDistance([contraint, simple], g);
  assert.equal(result.propositions[0]?.id, 'B');
  assert.equal(result.propositions[0]?.apres.factionId, simple.factionId);
});

test('la résolution globale recalcule tous les conflits du réseau après déplacement', () => {
  const g = route();
  const positions = [barrage('A', r(20)), barrage('B', r(45)), barrage('C', r(65))];
  const result = analyserOptimisationDistance(positions, g);
  assert.ok(result.propositions.some((p) => p.id === 'B'));
  assert.equal(result.resume.conflitsApres, 0);
  assert.equal(listerConflitsDistance([
    positions[0],
    { ...positions[1], ...result.propositions.find((p) => p.id === 'B').apres },
    positions[2],
  ], g).length, 0);
});

test('la validation territoriale écarte les candidats hors périmètre', () => {
  const g = route();
  const result = analyserOptimisationDistance([barrage('A', r(20)), barrage('B', r(45))], g, {
    garderPosition: () => false,
  });
  assert.equal(result.propositions.length, 0);
  assert.equal(result.conflitsSansSolution.length, 1);
});

test('aucun déplacement n’est écrit pendant la simulation', () => {
  const g = route();
  const entree = [barrage('A', r(20)), barrage('B', r(45))];
  const avant = JSON.stringify(entree);
  analyserOptimisationDistance(entree, g);
  assert.equal(JSON.stringify(entree), avant);
});

test('un conflit entre deux intouchables reste explicitement sans solution', () => {
  const g = route();
  const result = analyserOptimisationDistance([
    barrage('A', r(20), { protection: 'intouchable', intouchable: true }),
    barrage('B', r(45), { protection: 'intouchable', intouchable: true }),
  ], g);
  assert.equal(result.propositions.length, 0);
  assert.equal(result.conflitsSansSolution.length, 1);
});

/* ------------------------------------------------------------------ */
/* LA CASCADE : l'état simulé évolue, et les conflits sont repris.     */
/* ------------------------------------------------------------------ */

const dansLaLigne = (longueurKm) => (_b, pt) => pt[0] >= 0 && pt[0] <= lng(longueurKm);
/* Trouvé par recherche au seuil de 20 km (positions écrites ici en unités de
   40 km, comme les autres jeux) : sans réexamen, la simulation s'arrête avec
   un conflit que la cascade sait pourtant résoudre. */
const CAS_CASCADE = [
  ['I0', 212, true], ['I1', 56, true],
  ['N0', 174], ['N1', 250], ['N2', 92], ['N3', 134],
].map(([id, km, intouchable]) => barrage(id, r(km), intouchable ? { protection: 'intouchable', intouchable: true } : {}));

test('un conflit sans solution est réexaminé quand un déplacement a changé l’état simulé', () => {
  const g = route(r(260));
  const garderPosition = dansLaLigne(r(260));
  const sans = analyserOptimisationDistance(CAS_CASCADE, g, { garderPosition, reexamen: false });
  const avec = analyserOptimisationDistance(CAS_CASCADE, g, { garderPosition });
  /* Sans réexamen, la simulation s'arrêtait avec un conflit résoluble. */
  assert.equal(sans.resume.deplacements, 3);
  assert.equal(sans.resume.conflitsApres, 1);
  assert.equal(avec.resume.deplacements, 4);
  assert.equal(avec.resume.conflitsApres, 0);
  assert.ok(avec.resume.passes >= 2);
  /* Le dernier déplacement n'est devenu possible qu'APRÈS les précédents. */
  const dernier = avec.journal.at(-1);
  assert.equal(dernier.id, 'N0');
  assert.ok(dernier.passe > avec.journal[0].passe);
});

test('l’état final rendu est celui qu’on obtient en appliquant les propositions et en remesurant tout', () => {
  const g = route(r(260));
  const res = analyserOptimisationDistance(CAS_CASCADE, g, { garderPosition: dansLaLigne(r(260)) });
  const final = CAS_CASCADE.map((b) => {
    const p = res.propositions.find((x) => x.id === b.id);
    return p ? { ...b, lng: p.apres.lng, lat: p.apres.lat } : b;
  });
  /* Remesure indépendante, depuis zéro, par la route. */
  assert.equal(listerConflitsDistance(final, g).length, res.resume.conflitsApres);
  for (const p of res.propositions) {
    assert.equal(listerConflitsDistance(final, g).some((c) => c.a === p.id || c.b === p.id), false);
  }
  /* Chaque pas du journal réduit strictement les conflits de l'état simulé. */
  let precedent = res.resume.conflitsAvant;
  for (const pas of res.journal) {
    assert.equal(pas.conflitsAvant, precedent);
    assert.ok(pas.conflitsApres < pas.conflitsAvant);
    precedent = pas.conflitsApres;
  }
  assert.equal(precedent, res.resume.conflitsApres);
  /* Les Intouchables n'apparaissent jamais dans les propositions. */
  assert.equal(res.propositions.some((p) => p.id.startsWith('I')), false);
});
