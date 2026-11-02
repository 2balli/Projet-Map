#!/usr/bin/env node
/**
 * LA RÈGLE DES TROIS — un barrage est tenu par exactement trois hommes.
 *
 * Trois choses sont vérifiées ici, et elles se trompent différemment :
 *
 *   LA CONSTANTE     elle existe en deux exemplaires, navigateur et serveur
 *                    (duplication assumée, comme `GRADES`). Deux exemplaires
 *                    qui divergent, c'est une interface qui propose ce que le
 *                    service refuse : le pire des deux mondes. Ils sont donc
 *                    comparés ici, et le build échoue s'ils s'écartent.
 *
 *   LA VALIDATION    zéro, un, deux, quatre, cinq — tout sauf trois doit être
 *                    refusé, avec un motif lisible.
 *
 *   LE JEU FICTIF    chaque poste, sans exception, avec ses trois hommes, et
 *                    ces trois hommes de SA brigade. Un jeu d'épreuve qui
 *                    viole la règle qu'on éprouve ne sert plus à rien.
 *
 *   node --test scripts/verifier-trois.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ELEMENTS_PAR_BARRAGE, verifieEffectifBarrage } from '../src/marquages.js';
import { ELEMENTS_PAR_BARRAGE as REGLE_SERVEUR } from '../serveur/elements.mjs';
import { chargerComposition } from '../serveur/roster.mjs';
import { creerJeuFictif, lireDecoupages } from '../src/donnees/fictif/generateur.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const couche = (nom) =>
  JSON.parse(readFileSync(join(ROOT, 'public', 'layers', `${nom}.geojson`), 'utf8'));

const JEU = creerJeuFictif(
  lireDecoupages({ circoBt: couche('circo_bt'), circoCie: couche('circo_cie'), circoReg: couche('circo_reg') }),
  {
    graine: 42,
    regions: 'toutes',
    compagniesParRegion: 'toutes',
    brigadesParCompagnie: 'toutes',
    effectifsParBrigade: [20, 30],
    barragesParBrigade: [3, 8],
    dateReference: '2026-09-18',
  },
);

test('la règle vaut trois, des deux côtés', () => {
  assert.equal(ELEMENTS_PAR_BARRAGE, 3);
  assert.equal(REGLE_SERVEUR, ELEMENTS_PAR_BARRAGE, 'navigateur et serveur ont divergé');
});

test('tout sauf trois est refusé, avec un motif', () => {
  const liste = (n) => Array.from({ length: n }, (_, i) => ({ matricule: `DEMO-0000${i}` }));

  const bon = verifieEffectifBarrage(liste(3));
  assert.equal(bon.ok, true);
  assert.equal(bon.motif, null);

  for (const n of [0, 1, 2, 4, 5, 9]) {
    const verdict = verifieEffectifBarrage(liste(n));
    assert.equal(verdict.ok, false, `${n} élément(s) accepté(s)`);
    assert.match(verdict.motif, /exactement 3 éléments/, `motif pour ${n}`);
    /* Le motif dit de quel côté l'on est : il en manque, ou il y en a trop. */
    assert.match(verdict.motif, n < 3 ? /il en manque \d/ : /de trop/);
  }

  /* Une entrée qui n'est pas une liste est refusée, pas interprétée. */
  for (const brut of [null, undefined, 3, 'trois', {}]) {
    assert.equal(verifieEffectifBarrage(brut).ok, false, `accepté : ${JSON.stringify(brut)}`);
  }
});

test('la composition ne peut pas demander plus que la règle', () => {
  /* Le fichier de démonstration est aligné sur trois ; l'écrêtage le garantit
     de toute façon, quelle que soit la valeur écrite dans le fichier. */
  const compo = chargerComposition(join(ROOT, 'donnees-demo', 'composition-barrage.json'));
  for (const type of ['barrage_fixe', 'barrage_mobile', 'autre']) {
    const total = compo.pour({ type }).reduce((s, c) => s + c.nombre, 0);
    assert.equal(total, ELEMENTS_PAR_BARRAGE, `composition « ${type} » : ${total} hommes`);
  }
});

test('jeu fictif : CHAQUE barrage tient exactement trois éléments', () => {
  const parBarrage = new Map(JEU.barrages.map((b) => [b.id, []]));
  for (const e of JEU.elements) parBarrage.get(e.barrageId)?.push(e);

  /* L'audit demandé : combien de postes à 0, 1, 2, ou plus de 3 ? */
  const repartition = {};
  for (const [, liste] of parBarrage) {
    repartition[liste.length] = (repartition[liste.length] ?? 0) + 1;
  }
  assert.deepEqual(
    Object.keys(repartition),
    [String(ELEMENTS_PAR_BARRAGE)],
    `répartition observée : ${JSON.stringify(repartition)}`,
  );
  assert.equal(parBarrage.size, JEU.barrages.length);
  assert.equal(JEU.elements.length, JEU.barrages.length * ELEMENTS_PAR_BARRAGE);

  /* Et la liste portée par le poste dit la même chose que les relèves. */
  for (const b of JEU.barrages) {
    assert.equal(b.elements.length, ELEMENTS_PAR_BARRAGE, `poste ${b.id}`);
    assert.deepEqual(
      [...b.elements].sort(),
      parBarrage.get(b.id).map((e) => e.id).sort(),
      `poste ${b.id} : liste et relèves désaccordées`,
    );
  }
});

test('les trois hommes existent vraiment, et sont de la brigade du poste', () => {
  const parId = new Map(JEU.elements.map((e) => [e.id, e]));
  const parMatricule = new Map(JEU.effectifs.map((e) => [e.matricule, e]));
  const barrages = new Map(JEU.barrages.map((b) => [b.id, b]));

  for (const b of JEU.barrages) {
    const trio = b.elements.map((id) => parId.get(id));
    assert.ok(trio.every(Boolean), `poste ${b.id} : relève fantôme`);

    for (const e of trio) {
      /* Ce n'est pas un identifiant inventé : la personne est au fichier. */
      const personne = parMatricule.get(e.matricule);
      assert.ok(personne, `${e.matricule} absent de l'effectif`);
      /* Même région, même compagnie, même brigade que le poste. */
      assert.equal(personne.bt, b.bt, `${e.matricule} n'est pas de ${b.bt}`);
      assert.equal(personne.cie, b.cie);
      assert.equal(personne.reg, b.reg);
      assert.equal(personne.brigadeId, barrages.get(b.id).brigadeId);
      assert.equal(personne.compagnieId, b.compagnieId);
      assert.equal(personne.regionId, b.regionId);
    }

    /* Trois places, trois hommes différents. */
    assert.equal(new Set(trio.map((e) => e.matricule)).size, ELEMENTS_PAR_BARRAGE, `poste ${b.id}`);
    /* Et tous sur le même créneau : la règle porte sur (poste, créneau). */
    assert.equal(new Set(trio.map((e) => `${e.date}#${e.creneau}`)).size, 1, `poste ${b.id}`);
  }
});

test('aucun poste n’existe sans pouvoir être armé', () => {
  /* Une brigade trop petite ne tient AUCUN poste, plutôt que des postes hors
     règle : l'invariant est tenu par construction, pas rattrapé après coup. */
  const petit = creerJeuFictif(
    lireDecoupages({ circoBt: couche('circo_bt'), circoCie: couche('circo_cie'), circoReg: couche('circo_reg') }),
    {
      graine: 42, regions: 2, compagniesParRegion: 1, brigadesParCompagnie: 2,
      effectifsParBrigade: [2, 2], barragesParBrigade: [3, 8], dateReference: '2026-09-18',
    },
  );
  assert.equal(petit.barrages.length, 0, 'des postes ont été créés sans effectif pour les tenir');
});

test('le cloisonnement suit : qui voit le poste voit ses trois hommes', () => {
  /**
   * La règle ne crée pas de brèche RBAC, et c'est structurel : les trois
   * hommes d'un poste sont de SA brigade, donc du même périmètre que lui. Un
   * chef qui voit le poste voit son équipe ; un chef qui ne le voit pas ne
   * voit pas davantage ses hommes.
   */
  const parId = new Map(JEU.elements.map((e) => [e.id, e]));
  const brigade = JEU.brigades[0];
  const sesPostes = JEU.barrages.filter((b) => b.bt === brigade.nom);
  assert.ok(sesPostes.length > 0);

  for (const poste of sesPostes) {
    for (const id of poste.elements) {
      const e = parId.get(id);
      assert.equal(e.matricule.startsWith('DEMO-'), true);
      const personne = JEU.effectifs.find((p) => p.matricule === e.matricule);
      assert.equal(personne.bt, brigade.nom);
      assert.equal(personne.cie, brigade.cie);
      assert.equal(personne.reg, brigade.reg);
    }
  }

  /* Aucun poste du pays n'emprunte un homme à une autre brigade. */
  const empruntes = JEU.barrages.filter((b) =>
    b.elements.some((id) => parId.get(id) && parId.get(id).matricule
      && JEU.effectifs.find((p) => p.matricule === parId.get(id).matricule)?.bt !== b.bt));
  assert.equal(empruntes.length, 0);
});
