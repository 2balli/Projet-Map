#!/usr/bin/env node
/**
 * ÉPREUVE — « qui est en conflit avec qui » (src/conflitsIdentifies.js).
 *
 *   node --test scripts/verifier-conflits-identifies.mjs
 *
 * LE CAS : trois barrages sur LA MÊME ROUTE, A — B — C, dont les itinéraires
 * empruntent exactement la même chaussée :
 *
 *   A↔B 14,75 km, A↔C 9,72 km, B↔C 8,00 km — tous sous le seuil de 20 km.
 *
 * A est déplacé : A↔B est résolu (21,79 km après), A↔C aussi, B↔C reste, et
 * la nouvelle place de A crée un NOUVEAU conflit avec D (12,40 km).
 *
 * L'opérateur doit pouvoir dire qui est en conflit avec qui sans deviner :
 * chaque paire a son identifiant, son statut, ses deux extrémités nommées, et
 * des tracés superposés ne partagent jamais la même voie à l'écran.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const M = await import(pathToFileURL(resolve(ROOT, 'src/conflitsIdentifies.js')).href);

/* Une route droite, est-ouest : A au km 0, B au km ~6, C au km ~11. Les
   points sont ceux d'un même graphe : les tracés qui partagent la chaussée
   partagent EXACTEMENT ces coordonnées. */
const R = [[-7.6, 33.5], [-7.58, 33.5], [-7.56, 33.5], [-7.54, 33.5], [-7.52, 33.5], [-7.5, 33.5]];
const pos = (p) => ({ lng: p[0], lat: p[1] });
const A = { id: 'BF-A', nom: 'Poste Casablanca', ...pos(R[0]) };
const B = { id: 'BF-B', nom: 'Poste Lahraouiyine', ...pos(R[3]) };
const C = { id: 'BF-C', nom: 'Poste Nouaceur', ...pos(R[5]) };
const D = { id: 'BF-D', nom: 'Poste Oulad Azzouz', lng: -7.7, lat: 33.45 };
const infos = new Map([A, B, C, D].map((b) => [b.id, b]));

const initiaux = [
  { a: A.id, b: B.id, km: 14.75 },
  { a: A.id, b: C.id, km: 9.72 },
  { a: B.id, b: C.id, km: 8.0 },
];
const finaux = [
  { a: { id: B.id, nom: B.nom }, b: { id: C.id, nom: C.nom }, km: 8.0 },
  { a: { id: A.id, nom: A.nom }, b: { id: D.id, nom: D.nom }, km: 12.4 },
];
const modele = (ordre = (x) => x) =>
  M.identifierConflits({
    initiaux: ordre([...initiaux]),
    finaux: ordre([...finaux]),
    apresKm: new Map([[M.clePaire(A.id, B.id), 21.79]]),
    deplaces: new Set([A.id]),
    infos,
  });

test('chaque PAIRE reçoit son identifiant, du plus serré au moins serré, puis les nouveaux', () => {
  const { conflits } = modele();
  assert.deepEqual(
    conflits.map((c) => [c.id, c.a.id, c.b.id]),
    [
      ['C-01', B.id, C.id],
      ['C-02', A.id, C.id],
      ['C-03', A.id, B.id],
      ['C-04', A.id, D.id],
    ],
  );
});

test("l'identifiant ne dépend pas de l'ordre de réception, ni du sens de la paire", () => {
  const ref = modele().conflits.map((c) => `${c.id}:${c.cle}`);
  const inverse = modele((l) => l.reverse()).conflits.map((c) => `${c.id}:${c.cle}`);
  assert.deepEqual(inverse, ref);
  const sensOppose = M.identifierConflits({
    initiaux: initiaux.map((c) => ({ a: c.b, b: c.a, km: c.km })),
    finaux,
    infos,
  });
  assert.deepEqual(sensOppose.conflits.map((c) => `${c.id}:${c.cle}`), ref);
});

test("une paire reçue deux fois (A→B et B→A) reste UN conflit", () => {
  const { conflits } = M.identifierConflits({
    initiaux: [...initiaux, { a: B.id, b: A.id, km: 14.75 }],
    finaux: null,
    infos,
  });
  assert.equal(conflits.length, 3);
  assert.equal(conflits.filter((c) => c.cle === M.clePaire(A.id, B.id)).length, 1);
});

test('AVANT → APRÈS : résolu, restant, nouveau — tels que le serveur les a rendus', () => {
  const p = modele().parCle;
  const ab = p.get(M.clePaire(A.id, B.id));
  assert.equal(ab.statut, 'resolu');
  assert.equal(ab.avantKm, 14.75);
  assert.equal(ab.apresKm, 21.79, 'la distance APRÈS mesurée par le serveur, telle quelle');
  const ac = p.get(M.clePaire(A.id, C.id));
  assert.equal(ac.statut, 'resolu');
  assert.equal(ac.apresKm, null, 'non mesurée : on ne l’invente pas');
  const bc = p.get(M.clePaire(B.id, C.id));
  assert.equal(bc.statut, 'restant');
  assert.equal(bc.apresKm, 8.0);
  const ad = p.get(M.clePaire(A.id, D.id));
  assert.equal(ad.statut, 'nouveau');
  assert.equal(ad.nouveau, true);
  assert.equal(ad.avantKm, null);
  assert.equal(ad.apresKm, 12.4);
  assert.equal(ad.id, 'C-04', 'le nouveau conflit a SON identifiant');
});

test('sans simulation, tout conflit mesuré est « actif »', () => {
  const { conflits } = M.identifierConflits({ initiaux, finaux: null, infos });
  assert.ok(conflits.every((c) => c.statut === 'actif'));
});

test('les extrémités sont nommées, et le poste déplacé est dit déplacé', () => {
  const ab = modele().parCle.get(M.clePaire(A.id, B.id));
  assert.equal(ab.a.nom, 'Poste Casablanca');
  assert.equal(ab.b.nom, 'Poste Lahraouiyine');
  assert.equal(ab.a.deplace, true);
  assert.equal(ab.b.deplace, false);
  assert.equal(ab.a.lng, A.lng);
});

test('badges : chaque barrage liste SES conflits, avec l’autre poste de chaque paire', () => {
  const parBarrage = M.conflitsParBarrage(modele().conflits);
  const a = parBarrage.get(A.id);
  assert.deepEqual(
    a.conflits.map((x) => `${x.conflit.id}→${x.autre.nom}`),
    ['C-02→Poste Nouaceur', 'C-03→Poste Lahraouiyine', 'C-04→Poste Oulad Azzouz'],
  );
  assert.deepEqual(parBarrage.get(C.id).conflits.map((x) => x.conflit.id), ['C-01', 'C-02']);
});

test('voies : des tracés qui partagent la même chaussée ne sont JAMAIS sur la même voie', () => {
  const routes = [
    { cle: 'C-01', trace: R.slice(3) }, // B → C
    { cle: 'C-02', trace: R.slice(0) }, // A → C, par B
    { cle: 'C-03', trace: R.slice(0, 4) }, // A → B
    { cle: 'C-04', trace: [R[0], [-7.65, 33.47], [D.lng, D.lat]] }, // A → D, autre route
  ];
  const voies = M.attribuerVoies(routes);
  const partage = (x, y) => {
    const s = (t) => new Set(t.slice(1).map((p, i) => [t[i], p].map(String).sort().join('>')));
    const a = s(x.trace);
    return [...s(y.trace)].some((k) => a.has(k));
  };
  for (const x of routes) {
    for (const y of routes) {
      if (x !== y && partage(x, y)) assert.notEqual(voies.get(x.cle), voies.get(y.cle), `${x.cle} et ${y.cle} superposés`);
    }
  }
  assert.equal(voies.get('C-01'), 0, 'le premier reste au centre, sur la route');
  assert.equal(voies.get('C-04'), 0, 'une route qui ne partage rien n’est pas décalée');
  /* A→C emprunte toute la route : il est décalé de A→B ET de B→C. Ces deux-là
     ne se touchent qu'au point B, sans tronçon commun : ils peuvent rester
     tous deux au centre. */
  assert.notEqual(voies.get('C-02'), voies.get('C-01'));
  assert.notEqual(voies.get('C-02'), voies.get('C-03'));
  assert.equal(voies.get('C-03'), 0);
});

test('le décalage est VISUEL : il ne touche ni au tracé, ni à la distance', () => {
  const trace = R.map((p) => [...p]);
  const copie = JSON.stringify(trace);
  M.attribuerVoies([{ cle: 'x', trace }, { cle: 'y', trace }]);
  assert.equal(JSON.stringify(trace), copie, 'le tracé du serveur est intact');
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
  const dec = M.decalerPixels(pts, 6);
  assert.deepEqual(pts, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], 'les points d’entrée sont intacts');
  assert.deepEqual(dec.map((p) => [p.x, Math.round(p.y * 1000) / 1000]), [[0, 6], [100, 6], [200, 6]]);
  assert.deepEqual(M.decalerPixels(pts, -6).map((p) => Math.round(p.y)), [-6, -6, -6], 'voie négative : de l’autre côté');
  const coude = M.decalerPixels([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 6);
  assert.ok(Math.hypot(coude[1].x - 100, coude[1].y) < 6 * 2.01, 'onglet borné dans un virage');
});

test("extrémité A/B : le bout du tracé le plus proche de A est A, même si le tracé est à l'envers", () => {
  const trace = R.slice(0, 4);
  assert.equal(M.traceInverse(trace, A, B), false);
  assert.equal(M.traceInverse([...trace].reverse(), A, B), true);
  assert.equal(M.traceInverse([...trace].reverse(), null, B), true, 'B seul suffit');
  assert.equal(M.traceInverse(trace, null, null), false, 'sans position : le sens du serveur (A → B)');
});

test('étiquette le long du tracé, et identifiants à trois chiffres au-delà de 99', () => {
  const p = M.pointLeLong([{ x: 0, y: 0 }, { x: 100, y: 0 }], 30);
  assert.deepEqual(p, { x: 30, y: 0 });
  assert.equal(M.libelleConflit(1, 3), 'C-01');
  assert.equal(M.libelleConflit(7, 140), 'C-007');
  assert.equal(M.kmConflit(14.75), '14.75 km');
});

test('paires entre deux intouchables : entreIntouchables est vrai si et seulement si les deux sont intouchables', () => {
  const infosIntou = new Map([
    ['I-1', { id: 'I-1', nom: 'BFI 1', intouchable: true }],
    ['I-2', { id: 'I-2', nom: 'BFI 2', protection: 'intouchable' }],
    ['N-1', { id: 'N-1', nom: 'Normal 1' }],
  ]);
  const { conflits } = M.identifierConflits({
    initiaux: [
      { a: 'I-1', b: 'I-2', km: 10 },
      { a: 'I-1', b: 'N-1', km: 12 },
    ],
    infos: infosIntou,
  });
  const cIntou = conflits.find((c) => c.cle === M.clePaire('I-1', 'I-2'));
  const cMixte = conflits.find((c) => c.cle === M.clePaire('I-1', 'N-1'));
  assert.equal(cIntou?.entreIntouchables, true, 'deux intouchables -> entreIntouchables');
  assert.equal(cMixte?.entreIntouchables, false, 'un intouchable + un normal -> pas entre deux intouchables');
});

