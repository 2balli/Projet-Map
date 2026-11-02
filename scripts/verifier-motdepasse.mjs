#!/usr/bin/env node
/**
 * CONTRÔLE D'ACCORD DES DEUX JUGES DU MOT DE PASSE.
 *
 * La règle existe deux fois, à dessein : `serveur/comptes.mjs` refuse, et
 * `src/motDePasseRegles.js` prévient pendant la saisie. C'est le même
 * arrangement que `peutModifier` ou `perimetreImpose`, et il porte le même
 * risque : les deux copies peuvent divergir sans que rien ne le signale.
 *
 * Une divergence n'est pas anodine. Si l'écran accepte ce que le serveur
 * refuse, la personne voit ses quatre exigences vertes et se fait renvoyer à
 * l'appui sur ENREGISTRER, sans comprendre. Si l'écran refuse ce que le
 * serveur accepte, on lui interdit un mot de passe parfaitement valable.
 *
 * Ce script compare les deux verdicts — le refus ET son libellé — sur un
 * balayage large : longueurs, natures de caractères, accents, espaces,
 * répétitions, mots de passe courants, et de l'aléatoire.
 *
 *   node scripts/verifier-motdepasse.mjs
 */
import { refusMotDePasse as serveur, MOTDEPASSE_MIN as MIN_SERVEUR } from '../serveur/comptes.mjs';
import { refusMotDePasse as client, MOTDEPASSE_MIN as MIN_CLIENT } from '../src/motDePasseRegles.js';

const ecarts = [];
let cas = 0;

const juger = (saisie) => {
  cas++;
  const a = serveur(saisie);
  const b = client(saisie);
  if (a !== b) ecarts.push({ saisie, serveur: a, client: b });
};

/* ---------------- Le minimum doit être le même ---------------- */
if (MIN_SERVEUR !== MIN_CLIENT) {
  console.error(`\nLongueur minimale divergente : serveur ${MIN_SERVEUR}, client ${MIN_CLIENT}\n`);
  process.exit(1);
}

/* ---------------- Cas nommés ---------------- */
const NOMMES = [
  '',
  ' ',
  'a',
  '1234567',
  '12345678',
  '123456789',
  '123456',
  'password',
  'PASSWORD',
  'MotDePasse',
  'motdepasse',
  'azerty',
  'azertyui',
  'qwerty',
  'gendarmerie',
  'GENDARMERIE',
  'aaaaaaaa',
  'abababab',
  'abcabcabc',
  'abcdefgh',
  'ABCDEFGH',
  'Abcdefgh',
  'Abcdefg1',
  '  Abcdefg1',
  'Abcdefg1  ',
  '\tAbcdefg1',
  'Abcdefg1\n',
  'Mon-Mot-2026!',
  'Ténérife7',
  'ÉÈÊËàâä12',
  'مرور1234',
  '········',
  '!!!!!!!!',
  '!!!!aaaa',
  'aA1!aA1!',
  '        ',
  'barrage!',
  'Barrage2026',
  null,
  undefined,
];
for (const n of NOMMES) juger(n);

/* ---------------- Balayage combinatoire ---------------- */
const MORCEAUX = ['a', 'A', '1', '!', 'é', 'É', ' ', 'z', '9', '-'];
for (const a of MORCEAUX) {
  for (const b of MORCEAUX) {
    for (const c of MORCEAUX) {
      /* Longueurs autour du seuil : 6, 7, 8, 9, 12. */
      for (const n of [2, 3, 4]) {
        juger((a + b + c).repeat(n));
        juger((a + b + c).repeat(n).slice(0, 7));
        juger((a + b + c).repeat(n).slice(0, 8));
      }
    }
  }
}

/* ---------------- Aléatoire ---------------- */
const ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{};:,.<>/?éÉàÀ ';
let graine = 20260904;
const suivant = () => {
  /* Générateur simple et REPRODUCTIBLE : un échec doit pouvoir se rejouer. */
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
};
for (let i = 0; i < 4000; i++) {
  const n = 1 + Math.floor(suivant() * 16);
  let s = '';
  for (let k = 0; k < n; k++) s += ALPHABET[Math.floor(suivant() * ALPHABET.length)];
  juger(s);
}

/* ------------------------------------------------------------------ */

console.log('');
console.log(`Saisies comparées           : ${cas.toLocaleString('fr-FR')}`);
console.log(`Verdicts divergents         : ${ecarts.length}`);

if (ecarts.length) {
  console.error('');
  for (const e of ecarts.slice(0, 10)) {
    console.error(`  ${JSON.stringify(e.saisie)}`);
    console.error(`      serveur : ${e.serveur ?? '(accepté)'}`);
    console.error(`      client  : ${e.client ?? '(accepté)'}`);
  }
  if (ecarts.length > 10) console.error(`  … et ${ecarts.length - 10} autre(s)`);
  console.error('\nLes deux juges du mot de passe ne disent pas la même chose.\n');
  process.exit(1);
}

console.log('\nLe serveur et l’écran rendent exactement le même verdict.\n');
