import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnostiquerRendu, estRenduLogiciel } from './diagnostic-rendu.js';

test('rendu logiciel reconnu (SwiftShader, llvmpipe, pilote de base Windows), carte graphique non', () => {
  for (const rendu of [
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Google SwiftShader',
  ]) assert.equal(estRenduLogiciel(rendu, false), true, rendu);
  for (const rendu of [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Apple M2',
  ]) assert.equal(estRenduLogiciel(rendu, false), false, rendu);
  // Contexte refusé avec failIfMajorPerformanceCaveat : lent, quel que soit le nom annoncé.
  assert.equal(estRenduLogiciel('Renderer masqué', true), true);
  assert.equal(estRenduLogiciel(null, false), false);
});

test('diagnostic : sans WebGL ou sur erreur, aucun plantage', () => {
  const sansWebgl = { createElement: () => ({ getContext: () => null }) };
  assert.deepEqual(diagnostiquerRendu(sansWebgl), { webgl: false, logiciel: true, rendu: null });
  const enErreur = { createElement: () => { throw new Error('pas de canevas'); } };
  assert.deepEqual(diagnostiquerRendu(enErreur), { webgl: false, logiciel: false, rendu: null });
});
