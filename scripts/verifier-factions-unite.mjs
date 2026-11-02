#!/usr/bin/env node
/**
 * ÉPREUVE DES FACTIONS — la définition, l'heure courante, et le rattachement
 * d'un barrage à ses tours de service.
 *
 * Ce qui se joue ici ne se voit pas à l'écran : une faction mal bornée, ou une
 * faction courante déduite d'une heure UTC, donne une carte qui a l'air juste
 * et qui montre le mauvais tour de service. Les épreuves fixent donc les
 * bornes, le passage de minuit, et la règle de rattachement.
 *
 *   node --test scripts/verifier-factions-unite.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CRENEAUX } from '../serveur/elements.mjs';
import {
  FACTIONS,
  DUREE_FACTION_H,
  factionDe,
  factionParId,
  factionParCreneau,
  factionsDuBarrage,
} from '../serveur/factions.mjs';

/* ------------------------------------------------------------------ */
/* LA DÉFINITION                                                      */
/* ------------------------------------------------------------------ */

test('les quatre factions sont définies, bornées et nommées', () => {
  assert.equal(FACTIONS.length, 4);
  assert.deepEqual(
    FACTIONS.map((f) => [f.id, f.debut, f.fin]),
    [
      ['F1', '00:00', '06:00'],
      ['F2', '06:00', '12:00'],
      ['F3', '12:00', '18:00'],
      ['F4', '18:00', '24:00'],
    ],
  );
  assert.deepEqual(
    FACTIONS.map((f) => f.libelle),
    ['00h00 → 06h00', '06h00 → 12h00', '12h00 → 18h00', '18h00 → 00h00'],
  );
  /* Les horaires sont de vraies heures, pas du texte libre. */
  for (const f of FACTIONS) {
    assert.match(f.debut, /^([01]\d|2[0-4]):[0-5]\d$/);
    assert.match(f.fin, /^([01]\d|2[0-4]):[0-5]\d$/);
  }
});

test('les factions se DÉDUISENT des créneaux du dépôt — aucune liste parallèle', () => {
  assert.equal(FACTIONS.length, CRENEAUX.length, 'une faction par créneau, ni plus ni moins');
  assert.deepEqual(
    FACTIONS.map((f) => f.creneau),
    CRENEAUX,
    'et dans le même ordre, avec les mêmes heures de début',
  );
  assert.equal(DUREE_FACTION_H * CRENEAUX.length, 24, 'les factions couvrent la journée entière');
});

test('une faction se retrouve par son identifiant et par son créneau', () => {
  assert.equal(factionParId('F3').debut, '12:00');
  assert.equal(factionParId('F9'), null, 'un identifiant inconnu ne rend rien');
  assert.equal(factionParCreneau(18).id, 'F4');
  assert.equal(factionParCreneau(7), null, 'un créneau hors liste ne rend rien');
});

/* ------------------------------------------------------------------ */
/* L'HEURE COURANTE                                                   */
/* ------------------------------------------------------------------ */

/** Une date LOCALE — `new Date(a, m, j, h)` construit sur l'horloge murale. */
const a = (h, min = 0) => new Date(2026, 8, 23, h, min, 0);

test('la faction en cours suit l’heure locale, aux quatre bascules', () => {
  assert.equal(factionDe(a(3)).id, 'F1', '03h00 → Faction 1');
  assert.equal(factionDe(a(9)).id, 'F2', '09h00 → Faction 2');
  assert.equal(factionDe(a(15)).id, 'F3', '15h00 → Faction 3');
  assert.equal(factionDe(a(21)).id, 'F4', '21h00 → Faction 4');
});

test('les bornes appartiennent à la faction qui COMMENCE', () => {
  assert.equal(factionDe(a(0)).id, 'F1');
  assert.equal(factionDe(a(5, 59)).id, 'F1');
  assert.equal(factionDe(a(6)).id, 'F2', '06h00 pile ouvre la faction 2');
  assert.equal(factionDe(a(11, 59)).id, 'F2');
  assert.equal(factionDe(a(12)).id, 'F3');
  assert.equal(factionDe(a(17, 59)).id, 'F3');
  assert.equal(factionDe(a(18)).id, 'F4');
});

test('le passage de 23h59 à 00h00 bascule de la faction 4 à la faction 1', () => {
  assert.equal(factionDe(new Date(2026, 8, 23, 23, 59, 59)).id, 'F4');
  assert.equal(factionDe(new Date(2026, 8, 24, 0, 0, 0)).id, 'F1');
  /* Et le lendemain reste cohérent : ce n'est pas un cas particulier. */
  assert.equal(factionDe(new Date(2026, 8, 24, 0, 0, 1)).id, 'F1');
});

/* ------------------------------------------------------------------ */
/* LE RATTACHEMENT D'UN BARRAGE                                       */
/* ------------------------------------------------------------------ */

test('la fiche du poste prime : sa fenêtre d’activité désigne ses factions', () => {
  assert.deepEqual(factionsDuBarrage({ debut: '06:00', fin: '12:00' }), ['F2']);
  assert.deepEqual(factionsDuBarrage({ debut: '00:00', fin: '06:00' }), ['F1']);
  /* Une fenêtre à cheval sur deux factions relève des deux — ce qu'un
     rattachement unique aurait été incapable d'exprimer. */
  assert.deepEqual(factionsDuBarrage({ debut: '10:00', fin: '16:00' }), ['F2', 'F3']);
});

test('une fenêtre qui traverse minuit relève de la dernière faction ET de la première', () => {
  assert.deepEqual(factionsDuBarrage({ debut: '20:00', fin: '02:00' }), ['F1', 'F4']);
  assert.deepEqual(factionsDuBarrage({ debut: '22:00', fin: '01:00' }), ['F1', 'F4']);
});

test('à défaut de fiche, ce sont les créneaux réellement relevés qui parlent', () => {
  assert.deepEqual(factionsDuBarrage({}, new Set([0])), ['F1']);
  assert.deepEqual(factionsDuBarrage({}, new Set([6, 18])), ['F2', 'F4']);
  /* Le cas du dispositif réel : tenu sur les quatre créneaux. */
  assert.deepEqual(factionsDuBarrage({}, new Set([0, 6, 12, 18])), ['F1', 'F2', 'F3', 'F4']);
});

test('la fiche l’emporte sur les relèves quand les deux existent', () => {
  assert.deepEqual(
    factionsDuBarrage({ debut: '06:00', fin: '12:00' }, new Set([0, 12, 18])),
    ['F2'],
    'ce que le chef a déclaré prime sur ce que l’historique montre',
  );
});

test('sans fiche ni relève, le poste n’est rattaché à AUCUNE faction', () => {
  assert.deepEqual(factionsDuBarrage({}, null), []);
  assert.deepEqual(factionsDuBarrage({}, new Set()), []);
  /* C'est délibéré : le ranger d'office dans la faction courante l'aurait
     déclaré tenu alors que rien ne le dit. Il reste visible sous « Toutes ». */
});

test('une fiche incomplète ne vaut pas une fiche — on retombe sur les relèves', () => {
  assert.deepEqual(factionsDuBarrage({ debut: '06:00' }, new Set([18])), ['F4']);
  assert.deepEqual(factionsDuBarrage({ fin: '12:00' }, new Set([18])), ['F4']);
});

/* ------------------------------------------------------------------ */
/* LE FILTRE, TEL QUE LA CARTE L'APPLIQUE                             */
/* ------------------------------------------------------------------ */

/**
 * La règle de filtrage est d'une ligne côté carte (`marquagesVisibles`) et
 * d'une ligne côté serveur (`/api/marquages?faction=`). On l'éprouve ici sur
 * un dispositif minuscule, pour fixer le comportement attendu des deux.
 */
const filtrerParFaction = (postes, assignations, factionId) =>
  factionId ? postes.filter((p) => (assignations[p.id] ?? []).includes(factionId)) : postes;

test('sélectionner une faction ne rend que les postes qui la tiennent', () => {
  const postes = [{ id: 'B1' }, { id: 'B2' }, { id: 'B3' }, { id: 'B4' }];
  const assignations = {
    B1: ['F1'],
    B2: ['F2'],
    B3: ['F1', 'F2'],
    B4: [], // aucune affectation ce jour
  };

  assert.deepEqual(
    filtrerParFaction(postes, assignations, 'F1').map((p) => p.id),
    ['B1', 'B3'],
  );
  assert.deepEqual(
    filtrerParFaction(postes, assignations, 'F2').map((p) => p.id),
    ['B2', 'B3'],
  );
  assert.deepEqual(
    filtrerParFaction(postes, assignations, 'F3').map((p) => p.id),
    [],
    'une faction que personne ne tient rend une carte vide, pas une carte pleine',
  );
  assert.deepEqual(
    filtrerParFaction(postes, assignations, null).map((p) => p.id),
    ['B1', 'B2', 'B3', 'B4'],
    '« Toutes les factions » rend tout, y compris les postes sans affectation',
  );
});

test('les compteurs se recoupent avec le filtre', () => {
  const assignations = { B1: ['F1'], B2: ['F2'], B3: ['F1', 'F2'], B4: [] };
  const postes = Object.keys(assignations).map((id) => ({ id }));

  const compteurs = Object.fromEntries(
    FACTIONS.map((f) => [f.id, filtrerParFaction(postes, assignations, f.id).length]),
  );
  assert.deepEqual(compteurs, { F1: 2, F2: 2, F3: 0, F4: 0 });

  const sansFaction = postes.filter((p) => !(assignations[p.id] ?? []).length).length;
  assert.equal(sansFaction, 1);

  /* LE TOTAL N'EST PAS LA SOMME DES FACTIONS, et ce n'est pas une erreur : un
     poste tenu sur deux tours compte dans les deux. Même principe que les
     critères de l'optimisation (voir src/statistiquesOptimisation.js). */
  const somme = Object.values(compteurs).reduce((x, y) => x + y, 0);
  assert.equal(somme, 4);
  assert.equal(postes.length, 4);
  assert.notEqual(somme, postes.length - sansFaction, 'la somme dépasse bien le nombre de postes');
});
