import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('Visual Map Simulation: CSS classes and animations exist', () => {
  const css = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
  assert.ok(css.includes('.gr-apercu-avant'), 'Classe .gr-apercu-avant présente');
  assert.ok(css.includes('.gr-mouvement-etiquette'), 'Classe .gr-mouvement-etiquette présente');
  assert.ok(css.includes('.gr-apercu-nouveau'), 'Classe .gr-apercu-nouveau présente');
  assert.ok(css.includes('grPulseApercu'), 'Animation grPulseApercu présente');
  assert.ok(css.includes('.gr-apercu-warning'), 'Classe .gr-apercu-warning présente');
});

test('Visual Map Simulation: GendarmerieMap has enhanced ApercuOptimisationLayer', () => {
  const mapCode = fs.readFileSync(path.resolve('src/GendarmerieMap.jsx'), 'utf8');
  assert.ok(mapCode.includes('conflitsNonResolus'), 'Support des conflits non résolus dans ApercuOptimisationLayer');
  assert.ok(mapCode.includes('gr-mouvement-etiquette'), 'Liaison visuelle OLD ──▶ NEW sur la carte');
  assert.ok(mapCode.includes('gr-apercu-avant'), 'Repère AVANT présent');
  assert.ok(mapCode.includes('gr-apercu-nouveau'), 'Repère NOUVEAU avec impulsion présent');
  assert.ok(mapCode.includes('gr-apercu-warning'), 'Repère d’avertissement pour conflits non résolus présent');
  assert.ok(mapCode.includes('cadrerResultatsOptimisation'), 'Fonction de cadrage automatique des résultats présente');
});

test('Visual Map Simulation: OptimisationPanel activates preview immediately and publishes enriched data', () => {
  const panelCode = fs.readFileSync(path.resolve('src/OptimisationPanel.jsx'), 'utf8');
  assert.ok(panelCode.includes('setApercuAuto(true)'), 'Activation immédiate de l’aperçu après calcul');
  assert.ok(panelCode.includes('onCadrerResultats?.(res.propositions)'), 'Recadrage automatique sur la carte après calcul');
  assert.ok(panelCode.includes('conflitsNonResolus'), 'Transmission des conflits non résolus à la carte');
  assert.ok(panelCode.includes('routeAvant'), 'Données routeAvant transmises');
  assert.ok(panelCode.includes('routeApres'), 'Données routeApres transmises');
  assert.ok(panelCode.includes('Barrages affectés'), 'Bilan compact avec les 4 chiffres clés');
  assert.ok(panelCode.includes('Conflits détectés'), 'Chiffre conflits détectés');
  assert.ok(panelCode.includes('Conflits résolus'), 'Chiffre conflits résolus');
  assert.ok(panelCode.includes('Conflits restants'), 'Chiffre conflits restants');
});
