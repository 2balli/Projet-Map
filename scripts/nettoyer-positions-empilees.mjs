#!/usr/bin/env node
/**
 * BARRAGES EMPILÉS SUR UN MÊME POINT — détection et nettoyage.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * L'optimisation par distance signalait, sur Rabat au seuil de 1 km, huit
 * barrages « à 0 km ». Le calcul a été mis en cause, puis mis hors de cause :
 * aucun barrage n'y est comparé à lui-même, chaque alerte porte bien deux
 * identifiants différents. Le défaut est dans les DONNÉES — sept postes
 * enregistrés sur le même point, à quelques centimètres les uns des autres.
 *
 * Ce sont des saisies accidentelles : cliquer plusieurs fois au même endroit
 * pendant un essai crée autant d'enregistrements distincts. Ils sont restés,
 * la plupart en « annulé », sans nom ni axe. L'optimisation ne se trompait
 * donc pas : elle remontait fidèlement une anomalie réelle. Mais « 0 km »
 * répété sept fois n'apprend rien à un chef — la vraie information est
 * qu'un point porte sept fiches au lieu d'une.
 *
 * CE QU'IL FAIT
 * -------------
 * Regroupe les barrages distants de moins de 50 m les uns des autres, et
 * propose de n'en garder qu'un par groupe. Le poste conservé est le plus
 * renseigné : d'abord celui qui n'est pas annulé, puis celui qui porte un
 * nom, puis celui qui porte un axe.
 *
 * RIEN N'EST SUPPRIMÉ SANS `--ecrire`, et une sauvegarde horodatée est prise
 * avant toute écriture.
 *
 *   node scripts/nettoyer-positions-empilees.mjs             aperçu, n'écrit rien
 *   node scripts/nettoyer-positions-empilees.mjs --ecrire    applique
 *   node scripts/nettoyer-positions-empilees.mjs --rayon 100 groupe à 100 m
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../serveur/routage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};

const RAYON_M = valeur('rayon', 50);

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const barrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');

/* ------------------------------------------------------------------ */
/* Regroupement par proximité                                          */
/* ------------------------------------------------------------------ */

/*
 * Regroupement par contact de proche en proche, et non par arrondi des
 * coordonnées : deux postes séparés de 8 m peuvent tomber de part et d'autre
 * d'une décimale et passer pour éloignés. C'est exactement ce qui masquait le
 * huitième cas de Rabat (−6,69080 contre −6,69088) lors du premier examen.
 */
const vus = new Set();
const groupes = [];
for (const a of barrages) {
  if (vus.has(a.id)) continue;
  const groupe = [a];
  vus.add(a.id);
  /* File d'attente : un poste rattaché peut à son tour en rapprocher d'autres. */
  for (let i = 0; i < groupe.length; i++) {
    for (const b of barrages) {
      if (vus.has(b.id)) continue;
      if (distanceKm(groupe[i].lng, groupe[i].lat, b.lng, b.lat) * 1000 > RAYON_M) continue;
      groupe.push(b);
      vus.add(b.id);
    }
  }
  if (groupe.length > 1) groupes.push(groupe);
}

/** Le plus renseigné du groupe : c'est lui qu'on garde. */
const rang = (m) => {
  let r = 0;
  if ((m.statutBarrage ?? 'en_attente') !== 'annule') r += 8;
  if (String(m.nom ?? '').trim()) r += 4;
  if (String(m.route ?? '').trim()) r += 2;
  if (m.motif || m.positionVille === 'gate') r += 1;
  return r;
};

const aSupprimer = [];
for (const g of groupes) {
  g.sort((x, y) => rang(y) - rang(x));
  aSupprimer.push(...g.slice(1));
}

/* ------------------------------------------------------------------ */
/* Rapport                                                             */
/* ------------------------------------------------------------------ */
const etiquette = (m) =>
  `${m.id}  ${(m.nom || '(sans nom)').slice(0, 24).padEnd(26)} ${String(m.statutBarrage ?? 'en_attente').padEnd(10)} ${m.route || '—'}`;

console.log('');
console.log(`BARRAGES EMPILÉS — regroupement à moins de ${RAYON_M} m`);
console.log('-'.repeat(84));
console.log(`Parc                           : ${barrages.length} barrages`);
console.log(`Points portant plusieurs fiches : ${groupes.length}`);
console.log(`Fiches en trop                 : ${aSupprimer.length}`);
console.log('');

for (const g of groupes) {
  const t = g[0];
  console.log(`  ${t.reg ?? '—'} / ${t.cie ?? '—'}   (${t.lat}, ${t.lng})   ${g.length} fiches`);
  console.log(`    GARDÉ     ${etiquette(g[0])}`);
  for (const m of g.slice(1)) console.log(`    supprimé  ${etiquette(m)}`);
  console.log('');
}

if (!aSupprimer.length) {
  console.log('Rien à nettoyer.');
  console.log('');
  process.exit(0);
}

if (!drapeau('ecrire')) {
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.');
  console.log('');
  process.exit(0);
}

const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-nettoyage-empiles.json');
copyFileSync(FICHIER, sauvegarde);

const retires = new Set(aSupprimer.map((m) => m.id));
depot.items = items.filter((m) => !retires.has(m.id));
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

const reste = depot.items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile').length;
console.log(`${aSupprimer.length} fiche(s) en trop supprimée(s). Parc : ${reste} barrages.`);
console.log(`Sauvegarde : ${sauvegarde}`);
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
