#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barragesIntouchablesVisibles } from '../src/optimisationAffichage.js';

test('l’inventaire visible est distinct des candidats et respecte le périmètre', () => {
  const items = [
    { id: 'normal', type: 'barrage_fixe', cie: 'Alpha', statutBarrage: 'approuve' },
    { id: 'bfi', type: 'barrage_fixe', intouchable: true, cie: 'Alpha', statutBarrage: 'approuve' },
    { id: 'autre-cie', type: 'barrage_fixe', protection: 'intouchable', cie: 'Beta' },
    { id: 'retire', type: 'barrage_fixe', intouchable: true, cie: 'Alpha', statutBarrage: 'retire_optimisation' },
    { id: 'vip', type: 'barrage_vip', intouchable: true, cie: 'Alpha' },
  ];

  assert.deepEqual(
    barragesIntouchablesVisibles(items, 'compagnie', 'Alpha').map((b) => b.id),
    ['bfi'],
  );
  assert.deepEqual(
    barragesIntouchablesVisibles(items, 'national').map((b) => b.id),
    ['bfi', 'autre-cie'],
  );
});

test('les deux vues Optimisation rendent cet inventaire en lecture seule', () => {
  const ui = readFileSync(new URL('../src/OptimisationPanel.jsx', import.meta.url), 'utf8');
  const map = readFileSync(new URL('../src/GendarmerieMap.jsx', import.meta.url), 'utf8');
  const filtre = readFileSync(new URL('../src/components/command-center/FactionFilter.jsx', import.meta.url), 'utf8');
  assert.match(ui, /barragesIntouchablesVisibles\(items, niveau, unite\)/);
  assert.ok((ui.match(/<ListeIntouchables barrages=\{barragesIntouchables\}/g) ?? []).length >= 3);
  assert.match(ui, /API\.effectifDuPoste\(b\.id\)/);
  assert.match(ui, /onCadrer\?\.\(b\)/);
  assert.match(ui, /NON MODIFIABLE PAR L’OPTIMISATION/);
  assert.match(map, /const \[factionChoisie, setFactionChoisie\] = useState\(null\)/);
  assert.match(map, /factionChoisie \?\? factions\?\.factionActuelle/);
  assert.match(map, /factionRetenue === 'sans_faction'/);
  const filtreCarte = map.slice(map.indexOf('const marquagesVisibles'), map.indexOf('const [cadre'));
  assert.ok(
    filtreCarte.indexOf("factionRetenue === 'sans_faction'") < filtreCarte.indexOf('MQ.estIntouchable(m)'),
    'les BFI affectés aux quatre factions ne sont pas comptés comme sans faction',
  );
  assert.doesNotMatch(filtre, /choisir\('toutes'\)/);
});
