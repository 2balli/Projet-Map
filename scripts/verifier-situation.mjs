#!/usr/bin/env node
/**
 * LA SYNTHÈSE D'OPTIMISATION DIT-ELLE LA VÉRITÉ DU RAPPORT ?
 *
 * Le piège de cet écran est le TOTAL. Additionner les lignes donne un nombre
 * plausible, plus grand que le vrai, et personne ne s'en aperçoit : il faut
 * connaître le chevauchement pour douter. Un poste trop proche de son voisin,
 * non éclairé et en entrée de ville compte dans trois lignes — et une seule
 * fois dans « barrages concernés ».
 *
 * Le reste garde la même exigence : la synthèse ne doit RIEN calculer par
 * elle-même. Elle compte des `protections` et des `sousLeSeuil` déjà posés par
 * le serveur ; si elle se mettait à relire `accidentCount` ou à mesurer une
 * distance, elle deviendrait un second moteur d'optimisation, avec ses propres
 * chiffres.
 *
 *   node --test scripts/verifier-situation.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statistiquesOptimisation,
  libellePerimetre,
  CRITERES_OPTIMISATION,
} from '../src/statistiquesOptimisation.js';

/** Un rapport de consolidation, à la forme exacte du serveur. */
const rapport = (barrages, parametres = {}) => ({
  parametres: {
    distanceMinKm: 10,
    niveau: 'national',
    unite: null,
    accidents: true,
    seuilAccidents: 3,
    vip: true,
    nonEclaire: true,
    ...parametres,
  },
  bilan: { examines: barrages.length },
  barrages,
});

/** Un poste : `sousLeSeuil` et `protections` sont les deux seuls champs lus. */
const poste = (id, { proche = false, protections = [] } = {}) => ({
  id,
  nom: `Poste ${id}`,
  sousLeSeuil: proche,
  protections,
  /* Champs présents dans la vraie réponse — la synthèse ne doit PAS s'en
     servir : s'ils la faisaient changer d'avis, elle recalculerait. */
  accidentCount: 99,
  eclairage: 'non',
  distanceKm: 0.2,
});

test('chaque ligne compte ce que le serveur a jugé, et rien d’autre', () => {
  const s = statistiquesOptimisation(
    rapport([
      poste('A', { proche: true }),
      poste('B', { protections: ['accidents'] }),
      poste('C', { protections: ['non_eclaire'] }),
      poste('D', { protections: ['vip'] }),
      poste('E', { protections: ['entree_ville'] }),
      poste('F', { protections: ['sortie_ville'] }),
      poste('G'), // conforme : dans aucune ligne
    ]),
  );
  const n = Object.fromEntries(s.criteres.map((c) => [c.cle, c.nombre]));
  assert.deepEqual(n, {
    distance: 1, accidents: 1, non_eclaire: 1, vip: 1, entree_ville: 1, sortie_ville: 1,
  });
  assert.equal(s.concernes, 6, 'le poste conforme ne doit pas être compté');
  assert.equal(s.examines, 7);
});

test('un poste touché par plusieurs critères ne compte qu’une fois', () => {
  /* L'exemple du cahier des charges : 10 + 8 + 12 = 30 lignes, 21 postes. */
  const postes = [];
  for (let i = 0; i < 9; i++) {
    /* Neuf postes cumulent les trois critères — ce sont eux qui font l'écart. */
    postes.push(poste(`multi-${i}`, { proche: true, protections: ['accidents', 'non_eclaire'] }));
  }
  for (let i = 0; i < 3; i++) postes.push(poste(`dist-${i}`, { proche: true }));
  for (let i = 0; i < 1; i++) postes.push(poste(`acc-${i}`, { protections: ['accidents'] }));
  for (let i = 0; i < 8; i++) postes.push(poste(`obs-${i}`, { protections: ['non_eclaire'] }));

  const s = statistiquesOptimisation(rapport(postes));
  const n = Object.fromEntries(s.criteres.map((c) => [c.cle, c.nombre]));
  assert.equal(n.distance, 12);
  assert.equal(n.accidents, 10);
  assert.equal(n.non_eclaire, 17);
  const somme = n.distance + n.accidents + n.non_eclaire;
  assert.equal(somme, 39, 'la somme des lignes');
  assert.equal(s.concernes, 21, 'mais 21 postes distincts');
  assert.ok(s.concernes < somme, 'le total ne doit jamais être la somme');
});

test('un critère éteint ne figure pas ; un critère actif à zéro reste affiché', () => {
  const postes = [poste('A', { proche: true })];

  const toutAllume = statistiquesOptimisation(rapport(postes));
  assert.deepEqual(
    toutAllume.criteres.map((c) => c.cle),
    ['distance', 'accidents', 'non_eclaire', 'vip', 'entree_ville', 'sortie_ville'],
  );
  /* Actifs mais sans aucun poste : présents, à zéro. */
  assert.equal(toutAllume.criteres.find((c) => c.cle === 'accidents').nombre, 0);
  assert.equal(toutAllume.criteres.find((c) => c.cle === 'vip').nombre, 0);

  const sansVipNiAccidents = statistiquesOptimisation(
    rapport(postes, { accidents: false, vip: false, nonEclaire: false }),
  );
  assert.deepEqual(
    sansVipNiAccidents.criteres.map((c) => c.cle),
    /* Distance et portes de ville sont évaluées sans interrupteur. */
    ['distance', 'entree_ville', 'sortie_ville'],
  );
});

test('aucun critère inventé : la liste suit celle du serveur', () => {
  const cles = CRITERES_OPTIMISATION.map((c) => c.cle).sort();
  /* Les clés `protections` de la route consolidation, plus la distance. */
  assert.deepEqual(cles, [
    'accidents', 'distance', 'entree_ville', 'non_eclaire', 'sortie_ville', 'vip',
  ]);
  /* Pas d'embouteillages, pas de météo, pas de « score » : ces notions
     n'existent pas dans le résultat d'optimisation. */
  assert.equal(cles.includes('embouteillages'), false);
});

test('sans optimisation, aucune statistique — et surtout pas des zéros', () => {
  for (const vide of [null, undefined, {}, { parametres: {} }, { barrages: null }]) {
    assert.equal(statistiquesOptimisation(vide), null, JSON.stringify(vide));
  }
  /* Un calcul qui n'a rien trouvé, lui, rend bien une synthèse à zéro : c'est
     un résultat, et il se distingue de l'absence de calcul. */
  const s = statistiquesOptimisation(rapport([]));
  assert.notEqual(s, null);
  assert.equal(s.concernes, 0);
  assert.ok(s.criteres.every((c) => c.nombre === 0));
});

test('le périmètre affiché est celui qui a SERVI au calcul', () => {
  const cie = statistiquesOptimisation(
    rapport([poste('A', { proche: true })], { niveau: 'compagnie', unite: 'Agadir' }),
  );
  assert.deepEqual(cie.perimetre, { niveau: 'compagnie', unite: 'Agadir' });
  assert.equal(libellePerimetre(cie.perimetre), 'Compagnie : Agadir');

  const reg = statistiquesOptimisation(
    rapport([poste('A')], { niveau: 'region', unite: 'Casablanca' }),
  );
  assert.equal(libellePerimetre(reg.perimetre), 'Région : Casablanca');

  const national = statistiquesOptimisation(rapport([poste('A')]));
  assert.equal(libellePerimetre(national.perimetre), 'Ensemble du territoire');

  /**
   * LE PÉRIMÈTRE VIENT DU SERVEUR, PAS DE L'ÉCRAN. Pour un profil
   * hiérarchique, la route `consolidation` IGNORE le périmètre envoyé et
   * déduit celui du rang : la synthèse hérite donc du cloisonnement sans avoir
   * à le refaire, et ne peut pas afficher des chiffres nationaux à un chef de
   * compagnie qui vient d'optimiser sa compagnie.
   */
  assert.equal(statistiquesOptimisation(rapport([], { niveau: 'compagnie', unite: 'X' })).perimetre.unite, 'X');
});

test('un second calcul remplace le premier, il ne s’y ajoute pas', () => {
  const premier = statistiquesOptimisation(
    rapport([poste('A', { protections: ['accidents'] })]),
  );
  const second = statistiquesOptimisation(
    rapport([
      poste('A', { protections: ['accidents'] }),
      poste('B', { protections: ['accidents'] }),
      poste('C', { protections: ['accidents'] }),
    ]),
  );
  assert.equal(premier.criteres.find((c) => c.cle === 'accidents').nombre, 1);
  assert.equal(second.criteres.find((c) => c.cle === 'accidents').nombre, 3);
  /* Chaque appel repart du rapport qu'on lui donne : aucun état conservé. */
  assert.equal(
    statistiquesOptimisation(rapport([poste('A', { protections: ['accidents'] })]))
      .criteres.find((c) => c.cle === 'accidents').nombre,
    1,
  );
});

test('la synthèse ne modifie pas le rapport qu’elle lit', () => {
  const postes = [
    poste('A', { proche: true, protections: ['accidents'] }),
    poste('B', { protections: ['non_eclaire'] }),
  ];
  const r = rapport(postes);
  const avant = JSON.stringify(r);
  statistiquesOptimisation(r);
  assert.equal(JSON.stringify(r), avant, 'le rapport a été modifié');
  assert.equal(r.barrages.length, 2, 'des postes ont disparu');
});

test('elle compte les jugements du serveur, jamais les attributs bruts', () => {
  /**
   * Ce poste a 99 accidents et n'est pas éclairé dans ses champs bruts, mais
   * le serveur ne l'a retenu sur AUCUN critère : la synthèse doit le laisser
   * hors de tous les comptes. C'est ce qui prouve qu'elle ne recalcule rien.
   */
  const s = statistiquesOptimisation(rapport([poste('A')]));
  assert.equal(s.concernes, 0);
  assert.ok(s.criteres.every((c) => c.nombre === 0));
});

test('la ligne « distance » compte ce que la carte propose à trancher', () => {
  /**
   * LE DÉFAUT SIGNALÉ, REJOUÉ À L'IDENTIQUE.
   *
   * Deux « ? » sur la carte, « 3 » dans les statistiques. Le troisième poste
   * est sous le seuil mais INTOUCHABLE (entrée de ville) : la carte lui met un
   * cadenas, pas une question, et il n'a donc rien à faire dans un chiffre qui
   * annonce du travail à faire. Il reste compté par le panneau Optimisation, à
   * sa ligne « Sous le seuil mais intouchables ».
   *
   * Les nombres ci-dessous sont ceux de la capture d'écran.
   */
  const postes = [
    { id: 'q1', sousLeSeuil: true, intouchable: false, decision: 'aucune', protections: [] },
    { id: 'q2', sousLeSeuil: true, intouchable: false, decision: 'aucune', protections: [] },
    { id: 'lock', sousLeSeuil: true, intouchable: true, decision: 'aucune', protections: ['entree_ville'] },
    ...[1, 2, 3, 4].map((n) => ({
      id: `ev${n}`, sousLeSeuil: false, intouchable: true, decision: 'aucune',
      protections: ['entree_ville'],
    })),
  ];
  const s = statistiquesOptimisation({
    parametres: { niveau: 'region', unite: 'Tanger', accidents: false, vip: false, nonEclaire: false },
    bilan: { examines: 34 },
    barrages: postes,
  });

  const distance = s.criteres.find((c) => c.cle === 'distance');
  assert.equal(distance.nombre, 2, 'le poste au cadenas ne compte pas');
  /* Exactement les postes que la carte marque d'un « ? ». */
  assert.equal(
    distance.nombre,
    postes.filter((b) => b.sousLeSeuil && b.intouchable !== true).length,
  );
  /* Aucune ventilation : le chiffre se suffit, et rien n'évoque plus les
     intouchables dans cette statistique. */
  assert.equal(distance.detail, undefined);

  /* Le poste protégé reste compté là où il a un sens : son entrée de ville. */
  assert.equal(s.criteres.find((c) => c.cle === 'entree_ville').nombre, 5);
  /* Sept postes distincts : les deux à trancher, plus les cinq entrées de
     ville — le poste au cadenas y figure toujours, à ce titre-là. Retirer un
     poste d'une LIGNE ne le retire pas du total. */
  assert.equal(s.concernes, 7);
});

test('un poste protégé n’entre jamais dans la ligne « distance »', () => {
  const protege = (id, protections) => ({
    id, sousLeSeuil: true, intouchable: true, decision: 'aucune', protections,
  });
  const s = statistiquesOptimisation({
    parametres: { accidents: true, seuilAccidents: 3, vip: true, nonEclaire: true },
    bilan: { examines: 4 },
    barrages: [
      protege('a', ['accidents']),
      protege('b', ['vip']),
      protege('c', ['non_eclaire']),
      { id: 'd', sousLeSeuil: true, intouchable: false, decision: 'aucune', protections: [] },
    ],
  });
  assert.equal(s.criteres.find((c) => c.cle === 'distance').nombre, 1);
  /* Chacun reste compté par le critère qui le protège. */
  for (const cle of ['accidents', 'vip', 'non_eclaire']) {
    assert.equal(s.criteres.find((c) => c.cle === cle).nombre, 1, cle);
  }
});

test('une décision fait baisser le compte : il dit ce qui RESTE en alerte', () => {
  /**
   * « Conserver » et « proposer le retrait » sont des RÉPONSES : le « ? »
   * disparaît de la carte, et la statistique doit suivre — sinon elle annonce
   * un travail déjà fait. Le panneau, lui, garde le décompte du calcul à ses
   * lignes « Déjà maintenus » et « Retraits déjà proposés ».
   */
  const postes = (decisions) => [
    { id: 'q1', sousLeSeuil: true, intouchable: false, decision: decisions.q1, protections: [] },
    { id: 'q2', sousLeSeuil: true, intouchable: false, decision: decisions.q2, protections: [] },
    { id: 'lock', sousLeSeuil: true, intouchable: true, decision: 'aucune', protections: ['entree_ville'] },
  ];
  const distance = (d) =>
    statistiquesOptimisation({ parametres: {}, bilan: { examines: 3 }, barrages: postes(d) })
      .criteres.find((c) => c.cle === 'distance').nombre;

  assert.equal(distance({ q1: 'aucune', q2: 'aucune' }), 2, 'deux questions ouvertes');
  assert.equal(distance({ q1: 'conserve', q2: 'aucune' }), 1, 'après Conserver');
  assert.equal(distance({ q1: 'conserve', q2: 'a_supprimer' }), 0, 'tout est tranché');

  /* Un champ `decision` absent (serveur d'une version antérieure) vaut
     « aucune » : le poste reste en alerte plutôt que de disparaître. */
  const sansChamp = statistiquesOptimisation({
    parametres: {}, bilan: { examines: 1 },
    barrages: [{ id: 'x', sousLeSeuil: true, intouchable: false, protections: [] }],
  });
  assert.equal(sansChamp.criteres.find((c) => c.cle === 'distance').nombre, 1);
});
