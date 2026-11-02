#!/usr/bin/env node
/**
 * Recalcule le rattachement (région / compagnie / brigade) de chaque marquage
 * À PARTIR DE SA POSITION.
 *
 * Le problème
 * -----------
 * Le filtre par région ou par compagnie se fie au champ `reg` / `cie` stocké
 * sur le repère. Or 78 marquages saisis à la main portent des noms de RÉGIONS
 * ADMINISTRATIVES — « Rabat-Salé-Kénitra », « Casablanca-Settat »… — alors que
 * les contours livrés découpent le territoire en RÉGIONS DE GENDARMERIE :
 * « Rabat », « Khémisset », « Casablanca », « El Jadida »…
 *
 * Deux vocabulaires pour la même notion : filtrer sur « Rabat-Salé-Kénitra »
 * remontait donc des barrages répartis sur quatre régions de gendarmerie, qui
 * apparaissaient à l'écran hors du contour demandé.
 *
 * La correction
 * -------------
 * La position fait foi. On applique `localiser()` — la même fonction que le
 * serveur utilise à chaque écriture (voir `rattacher` dans serveur/api.mjs) —
 * et on aligne le champ stocké sur le contour qui contient réellement le point.
 *
 * Un repère hors de tout contour connu est SIGNALÉ et laissé tel quel : effacer
 * son rattachement supprimerait une information sans en produire une meilleure.
 *
 *   node scripts/reparer-rattachements.mjs            aperçu, n'écrit rien
 *   node scripts/reparer-rattachements.mjs --ecrire   corrige
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerCirconscriptions, localiser } from '../serveur/geo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);

const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

const circo = chargerCirconscriptions(COUCHES);
const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];

console.log('');
console.log(`Contours : ${circo.region.size} régions · ${circo.compagnie.size} compagnies · ${circo.bt.size} brigades`);
console.log(`Marquages : ${items.length}`);
console.log('');

const corrections = [];
const introuvables = [];

for (const m of items) {
  if (!Number.isFinite(m.lng) || !Number.isFinite(m.lat)) continue;
  const vrai = localiser(circo, [m.lng, m.lat]);

  /* Hors de tout contour : on ne touche à rien, mais on le signale. */
  if (!vrai.reg && !vrai.cie && !vrai.bt) {
    if (m.reg || m.cie || m.bt) introuvables.push(m);
    continue;
  }

  const changements = {};
  if ((m.reg ?? null) !== (vrai.reg ?? null)) changements.reg = [m.reg ?? null, vrai.reg ?? null];
  if ((m.cie ?? null) !== (vrai.cie ?? null)) changements.cie = [m.cie ?? null, vrai.cie ?? null];
  if ((m.bt ?? null) !== (vrai.bt ?? null)) changements.bt = [m.bt ?? null, vrai.bt ?? null];

  if (Object.keys(changements).length) corrections.push({ m, vrai, changements });
}

console.log(`À CORRIGER : ${corrections.length} marquage(s)`);
console.log(`Hors de tout contour (laissés tels quels) : ${introuvables.length}`);
console.log('');

/* Quels renommages reviennent le plus ? C'est là qu'on voit les deux vocabulaires. */
const paires = {};
for (const c of corrections) {
  if (!c.changements.reg) continue;
  const [de, vers] = c.changements.reg;
  const cle = `${de ?? '(vide)'}  ->  ${vers ?? '(vide)'}`;
  paires[cle] = (paires[cle] ?? 0) + 1;
}
console.log('Corrections de RÉGION les plus fréquentes :');
for (const [p, n] of Object.entries(paires).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(4)}  ${p}`);
}

const parOrigine = {};
for (const c of corrections) {
  const o = c.m.note === 'porte-ville-auto' ? 'portes de ville'
    : c.m.note === 'barrage-reseau-auto' ? 'maillage réseau'
    : 'saisis à la main';
  parOrigine[o] = (parOrigine[o] ?? 0) + 1;
}
console.log('');
console.log('Origine des marquages à corriger :');
for (const [o, n] of Object.entries(parOrigine).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${o}`);

if (introuvables.length) {
  console.log('');
  console.log('Hors de tout contour — à vérifier à la main :');
  for (const m of introuvables.slice(0, 8)) {
    console.log(`  ${(m.nom || 'sans nom').slice(0, 28).padEnd(30)} ${m.lat.toFixed(4)}, ${m.lng.toFixed(4)}  (déclare « ${m.reg ?? m.cie ?? '?'} »)`);
  }
  if (introuvables.length > 8) console.log(`  … et ${introuvables.length - 8} autre(s)`);
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour corriger.');
  console.log('');
  process.exit(0);
}

for (const c of corrections) {
  c.m.reg = c.vrai.reg ?? null;
  c.m.cie = c.vrai.cie ?? null;
  c.m.bt = c.vrai.bt ?? null;
}
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log('');
console.log(`${corrections.length} rattachement(s) corrigé(s) d'après la position.`);
console.log('IMPORTANT : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
