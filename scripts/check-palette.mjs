#!/usr/bin/env node
/**
 * Contrôle de séparation des couleurs de la carte.
 *
 *   node scripts/check-palette.mjs
 *
 * POURQUOI CE SCRIPT : « ces deux couleurs se ressemblent » est un jugement
 * qu'on peut mesurer. Chaque paire de couleurs de la palette est comparée en
 * CIEDE2000 — la distance perceptuelle de référence, où ~1 est le seuil de
 * discernement et ~30 une différence franche. Le script échoue si deux couleurs
 * portant des informations différentes sont trop proches, ce qui empêche une
 * palette de dériver au fil des ajouts.
 *
 * Deux exigences, pas une :
 *   - ÉCART_MIN entre deux couches opérationnelles (or / bleu / vert…) ;
 *   - ÉCART_CONTEXTE entre une couche opérationnelle et le réseau routier, qui
 *     reste en gris pour ne pas concurrencer les données.
 *
 * La lisibilité sur le fond de carte est vérifiée en plus : chaque couleur doit
 * garder un contraste suffisant sur fond clair (plan) comme sur fond sombre.
 */
/**
 * `COULEURS_CRISE` N'EST PLUS IMPORTÉE : elle a été retirée de
 * `src/palette.js` avec les couches de crise, et ce script l'importait
 * toujours. Il échouait donc au chargement — ce qui explique qu'il n'ait
 * jamais été branché dans `prebuild` : le brancher aurait cassé le build.
 *
 * Un contrôle qui ne s'exécute pas ne contrôle rien. Celui-ci est réparé et
 * branché.
 */
import {
  COLORS,
  CLASSES_ROUTE,
  COULEURS_MARQUAGE,
  COULEURS_INFRASTRUCTURE,
} from '../src/palette.js';

/**
 * Écart CIEDE2000 minimal entre deux informations opérationnelles distinctes.
 * 25 correspond à deux couleurs franchement différentes ; les paires qui
 * gênaient le commandement se situaient entre 10 et 15.
 */
const ECART_MIN = 25;

/** Écart minimal entre une donnée et le réseau routier (contexte gris). */
const ECART_CONTEXTE = 15;

/**
 * Écart minimal ENTRE les couleurs d'infrastructure (péages, gares,
 * aéroports, ports) : une couche de référence géographique, comparée aux
 * autres couches de référence (contexte) et entre elles, PAS au jeu complet
 * des couleurs opérationnelles déjà à son écart minimal — voir
 * COULEURS_INFRASTRUCTURE dans src/palette.js.
 */
const ECART_ENTRE_INFRA = 20;

/**
 * Contraste minimal contre le LISERÉ SOMBRE posé sous chaque trait coloré.
 *
 * Le fond de carte n'est pas connu à l'avance — le serveur interne peut servir
 * un plan clair comme une imagerie satellite, et l'application retombe sur un
 * fond sombre quand aucune tuile ne répond. Exiger un contraste élevé sur ces
 * trois fonds à la fois n'aurait laissé que des teintes moyennes et ternes,
 * c'est-à-dire l'inverse du but.
 *
 * La lisibilité est donc obtenue PAR CONSTRUCTION : chaque trait de donnée est
 * doublé d'un liseré sombre (voir `Casing` dans GendarmerieMap.jsx) et chaque
 * repère porte un anneau blanc. Ce qui doit être vérifié ici, c'est donc le
 * contraste avec ce liseré — le fond de carte, lui, n'est plus adjacent à la
 * couleur.
 */
const CONTRASTE_MIN = 2.5;

/** Liseré sombre dessiné sous les traits de données. */
const LISERE = '#0b1220';

/* ------------------------------------------------------------------ */
/* Conversion sRGB -> Lab                                             */
/* ------------------------------------------------------------------ */

function versRgb(hex) {
  const h = hex.replace('#', '');
  const plein = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  return [0, 2, 4].map((i) => parseInt(plein.slice(i, i + 2), 16) / 255);
}

const lineaire = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function versLab(hex) {
  const [r, g, b] = versRgb(hex).map(lineaire);

  // sRGB -> XYZ (illuminant D65)
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Luminance relative WCAG, pour le contraste sur le fond. */
function luminance(hex) {
  const [r, g, b] = versRgb(hex).map(lineaire);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contraste = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* ------------------------------------------------------------------ */
/* CIEDE2000                                                          */
/* ------------------------------------------------------------------ */

/**
 * Écart perceptuel entre deux couleurs. Implémentation directe de la formule
 * CIEDE2000 : elle corrige les défauts de la distance euclidienne en Lab, qui
 * surestime les écarts dans les bleus et les sous-estime dans les jaunes —
 * précisément les deux familles utilisées ici.
 */
export function ciede2000(hex1, hex2) {
  const [L1, a1, b1] = versLab(hex1);
  const [L2, a2, b2] = versLab(hex2);

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cmoy = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Cmoy ** 7 / (Cmoy ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  const deg = (r) => ((r * 180) / Math.PI + 360) % 360;
  const h1p = C1p === 0 ? 0 : deg(Math.atan2(b1, a1p));
  const h2p = C2p === 0 ? 0 : deg(Math.atan2(b2, a2p));

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);

  const Lmoy = (L1 + L2) / 2;
  const Cpmoy = (C1p + C2p) / 2;

  let hpmoy = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hpmoy += hpmoy < 360 ? 360 : -360;
    hpmoy /= 2;
  }

  const T =
    1 -
    0.17 * Math.cos(((hpmoy - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hpmoy * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hpmoy + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hpmoy - 63) * Math.PI) / 180);

  const dTheta = 30 * Math.exp(-(((hpmoy - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpmoy ** 7 / (Cpmoy ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmoy - 50) ** 2) / Math.sqrt(20 + (Lmoy - 50) ** 2);
  const Sc = 1 + 0.045 * Cpmoy;
  const Sh = 1 + 0.015 * Cpmoy * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

/* ------------------------------------------------------------------ */
/* Palette à vérifier                                                 */
/* ------------------------------------------------------------------ */

/** Couleurs porteuses d'information : elles doivent toutes se distinguer. */
const OPERATIONNELLES = [
  ['Région', COLORS.reg],
  ['Compagnie', COLORS.cie],
  ['Brigade', COLORS.bt],
  ['Pointage', COLORS.pointage],
  ...Object.entries(COULEURS_MARQUAGE),
];

/** Réseau routier : gris volontairement, c'est un contexte. */
const CONTEXTE = Object.entries(CLASSES_ROUTE).map(([, c]) => [c.fr, c.couleur]);

/** Fonds sur lesquels la carte est lue. */
const FONDS = [
  ['plan clair', '#f2efe9'],
  ['fond sombre', '#0b1220'],
];

/* ------------------------------------------------------------------ */

let echecs = 0;
const ligne = (a, b, d, seuil) => {
  const ok = d >= seuil;
  if (!ok) echecs++;
  return `  ${ok ? 'ok  ' : 'ÉCHEC'} ${a.padEnd(22)} / ${b.padEnd(22)} ΔE ${d
    .toFixed(1)
    .padStart(5)}  (min ${seuil})`;
};

console.log('\nSéparation des couleurs — CIEDE2000\n');
console.log(`Couches opérationnelles (${OPERATIONNELLES.length}) — écart minimal ${ECART_MIN}\n`);

const paires = [];
for (let i = 0; i < OPERATIONNELLES.length; i++) {
  for (let j = i + 1; j < OPERATIONNELLES.length; j++) {
    const [na, ca] = OPERATIONNELLES[i];
    const [nb, cb] = OPERATIONNELLES[j];
    paires.push({ na, nb, d: ciede2000(ca, cb) });
  }
}
paires.sort((x, y) => x.d - y.d);

// Seules les paires les plus proches ont un intérêt : le reste est du bruit.
for (const p of paires.slice(0, 8)) console.log(ligne(p.na, p.nb, p.d, ECART_MIN));
console.log(
  `\n  écart le plus faible : ${paires[0].d.toFixed(1)} ` +
    `(${paires[0].na} / ${paires[0].nb})`
);
console.log(`  écart médian : ${paires[Math.floor(paires.length / 2)].d.toFixed(1)}`);

console.log(`\nDonnées / réseau routier — écart minimal ${ECART_CONTEXTE}\n`);
const mixtes = [];
for (const [no, co] of OPERATIONNELLES) {
  for (const [nc, cc] of CONTEXTE) {
    mixtes.push({ na: no, nb: nc, d: ciede2000(co, cc) });
  }
}
mixtes.sort((x, y) => x.d - y.d);
for (const p of mixtes.slice(0, 5)) console.log(ligne(p.na, p.nb, p.d, ECART_CONTEXTE));

/** Infrastructures de transport : couche de référence, pas opérationnelle — voir la constante ci-dessus. */
const INFRASTRUCTURE = Object.entries(COULEURS_INFRASTRUCTURE);

console.log(`\nInfrastructures / réseau routier — écart minimal ${ECART_CONTEXTE}\n`);
const infraVsContexte = [];
for (const [ni, ci] of INFRASTRUCTURE) {
  for (const [nc, cc] of CONTEXTE) infraVsContexte.push({ na: ni, nb: nc, d: ciede2000(ci, cc) });
}
infraVsContexte.sort((x, y) => x.d - y.d);
for (const p of infraVsContexte.slice(0, 5)) console.log(ligne(p.na, p.nb, p.d, ECART_CONTEXTE));

console.log(`\nInfrastructures entre elles — écart minimal ${ECART_ENTRE_INFRA}\n`);
const infraPaires = [];
for (let i = 0; i < INFRASTRUCTURE.length; i++) {
  for (let j = i + 1; j < INFRASTRUCTURE.length; j++) {
    const [na, ca] = INFRASTRUCTURE[i];
    const [nb, cb] = INFRASTRUCTURE[j];
    infraPaires.push({ na, nb, d: ciede2000(ca, cb) });
  }
}
infraPaires.sort((x, y) => x.d - y.d);
for (const p of infraPaires) console.log(ligne(p.na, p.nb, p.d, ECART_ENTRE_INFRA));

console.log(`\nContraste avec le liseré ${LISERE} — minimal ${CONTRASTE_MIN}:1\n`);
console.log('  (les colonnes de fond sont indicatives : la couleur ne les touche pas)\n');

for (const [nom, couleur] of [...OPERATIONNELLES, ...CONTEXTE, ...INFRASTRUCTURE]) {
  const surLisere = contraste(couleur, LISERE);
  const ok = surLisere >= CONTRASTE_MIN;
  if (!ok) echecs++;
  console.log(
    `  ${ok ? 'ok  ' : 'ÉCHEC'} ${nom.padEnd(22)} ${couleur}  ` +
      `liseré ${surLisere.toFixed(2).padStart(5)}   ` +
      FONDS.map(([n, f]) => `${n} ${contraste(couleur, f).toFixed(2)}`).join(' · ')
  );
}

console.log('');
if (echecs) {
  console.error(`${echecs} contrôle(s) en échec — ajustez la palette.\n`);
  process.exit(1);
}
console.log('Palette conforme.\n');
