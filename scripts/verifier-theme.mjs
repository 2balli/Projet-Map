/**
 * ÉPREUVE DES THÈMES — palettes × modes, préférence, contrastes réels.
 *
 *   npm run check:theme
 *
 * Les contrastes sont calculés sur les VALEURS D'index.css (bloc :root, bloc
 * du mode clair, bloc de chaque palette) : changer une couleur qui ferait
 * passer un texte sous le seuil WCAG AA fait échouer le build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PALETTES, MODES, normaliserApparence, resoudreApparence, familleFond, RETOUCHES_FOND, HABILLAGE_THEME, DESCRIPTIONS_PALETTES,
  MOUVEMENTS, resoudreMouvement,
} from '../src/apparence.js';

/* ------------------------------------------------------------------ */
/* Préférence                                                         */
/* ------------------------------------------------------------------ */

test('normalisation : nouveau format, anciens thèmes, valeurs invalides', () => {
  /* Sans réglage d'animation enregistré : « système » (le poste décide). */
  const s = 'systeme';
  assert.deepEqual(normaliserApparence({ palette: 'forest', mode: 'light' }), { palette: 'forest', mode: 'light', mouvement: s });
  assert.deepEqual(normaliserApparence({ theme: 'dark' }), { palette: 'midnight', mode: 'dark', mouvement: s });
  assert.deepEqual(normaliserApparence({ theme: 'light' }), { palette: 'arctic', mode: 'light', mouvement: s });
  assert.deepEqual(normaliserApparence({ theme: 'slate' }), { palette: 'graphite', mode: 'dark', mouvement: s });
  assert.deepEqual(normaliserApparence({ palette: 'neon', mode: 'dark' }), { palette: 'midnight', mode: 'systeme', mouvement: s });
  assert.deepEqual(normaliserApparence({ palette: 'arctic', mode: 'violet' }), { palette: 'arctic', mode: 'systeme', mouvement: s });
  assert.deepEqual(normaliserApparence(null), { palette: 'midnight', mode: 'systeme', mouvement: s });
});

test('animations : le choix du compte prime sur le poste ; « système » suit le poste', () => {
  assert.deepEqual(MOUVEMENTS, ['systeme', 'actives', 'reduites']);
  assert.equal(normaliserApparence({ palette: 'forest', mode: 'light', mouvement: 'actives' }).mouvement, 'actives');
  assert.equal(normaliserApparence({ palette: 'forest', mode: 'light', mouvement: 'turbo' }).mouvement, 'systeme');
  assert.equal(normaliserApparence({ theme: 'dark', mouvement: 'reduites' }).mouvement, 'reduites');
  /* Poste qui demande moins d'animation (Windows : Effets d'animation désactivés). */
  assert.equal(resoudreMouvement('systeme', true), 'reduit');
  assert.equal(resoudreMouvement('actives', true), 'normal', 'Activées : visibles même si Windows les coupe');
  assert.equal(resoudreMouvement('reduites', false), 'reduit');
  assert.equal(resoudreMouvement('systeme', false), 'normal');
});

test('index.css : plus aucune règle liée au seul réglage du poste', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.ok(!/prefers-reduced-motion/.test(css), 'les réductions passent par data-mouvement');
  assert.ok(css.includes(':root[data-mouvement="reduit"] .gr-radar-onde'), 'le radar suit le réglage');
  assert.ok(/@custom-variant motion-reduce/.test(css), 'motion-reduce: suit le réglage');
});

test('résolution : le mode « système » suit le poste', () => {
  assert.equal(resoudreApparence({ palette: 'graphite', mode: 'systeme' }, 'light').cle, 'graphite-light');
  assert.equal(resoudreApparence({ palette: 'graphite', mode: 'systeme' }, 'dark').cle, 'graphite-dark');
  assert.equal(resoudreApparence({ palette: 'arctic', mode: 'dark' }, 'light').cle, 'arctic-dark', 'un choix explicite l’emporte');
  assert.equal(familleFond('forest-light'), 'light');
  assert.equal(familleFond('forest-dark'), 'dark');
});

test('chaque palette × mode a son fond de carte, son habillage et son aperçu', () => {
  assert.deepEqual(MODES, ['light', 'dark', 'systeme']);
  for (const p of PALETTES) {
    for (const m of ['light', 'dark']) {
      const cle = `${p}-${m}`;
      assert.ok(RETOUCHES_FOND[cle]?.earth && RETOUCHES_FOND[cle]?.landcover?.barren, `${cle} : fond`);
      for (const k of ['liseré', 'selection', 'survol', 'voileHorsTerritoire', 'frontiere', 'rappel', 'haloNumeros']) {
        assert.ok(HABILLAGE_THEME[cle]?.[k] != null, `${cle} : habillage.${k}`);
      }
      assert.equal(DESCRIPTIONS_PALETTES[p].apercu[m].length, 4);
    }
  }
});

/* ------------------------------------------------------------------ */
/* Contrastes — sur les valeurs d'index.css                           */
/* ------------------------------------------------------------------ */

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bloc = (selecteur) => {
  const i = css.indexOf(`${selecteur} {`);
  assert.ok(i >= 0, `bloc absent : ${selecteur}`);
  const corps = css.slice(i, css.indexOf('\n}', i));
  return Object.fromEntries([...corps.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
};
const racine = bloc(':root');
const clair = bloc(":root[data-mode='light']");
const jetons = (palette, mode) => ({
  ...racine,
  ...(mode === 'light' ? clair : {}),
  ...(palette === 'midnight' && mode === 'dark' ? {} : bloc(`:root[data-palette='${palette}'][data-mode='${mode}']`)),
});

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const palette of PALETTES) {
  for (const mode of ['light', 'dark']) {
    test(`contrastes WCAG AA — ${palette}-${mode}`, () => {
      const t = jetons(palette, mode);
      const fonds = { panneau: t['bg-panel'], carte: t['bg-card'], application: t['bg-app'] };
      const verifier = (encre, fond, seuil, quoi) => {
        const r = contraste(t[encre], fonds[fond]);
        assert.ok(r >= seuil, `${quoi} (${encre} ${t[encre]} sur ${fond} ${fonds[fond]}) : ${r.toFixed(2)}:1 < ${seuil}`);
      };
      for (const encre of ['text-primary', 'text-secondary', 'text-muted']) {
        verifier(encre, 'panneau', 4.5, 'texte');
        verifier(encre, 'carte', 4.5, 'texte');
      }
      /* L'interaction et la sélection s'écrivent aussi en texte (liens, sigles). */
      verifier('primary', 'panneau', 4.5, 'interaction');
      verifier('primary', 'application', 4.5, 'interaction');
      verifier('accent', 'panneau', 4.5, 'sélection');
      const surBouton = contraste(t['primary-contrast'], t.primary);
      assert.ok(surBouton >= 4.5, `encre sur bouton d’interaction : ${surBouton.toFixed(2)}:1`);
      /* Les tons d'état du mode sur les surfaces de la palette. */
      for (const ton of ['tone-danger', 'tone-ok', 'tone-warn', 'tone-info', 'tone-amber']) {
        verifier(ton, 'panneau', 4.5, 'ton d’état');
        verifier(ton, 'carte', 4.5, 'ton d’état');
      }
    });
  }
}
