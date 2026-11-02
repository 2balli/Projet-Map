#!/usr/bin/env node
/**
 * PURGE DES MARQUAGES DE GESTION DE CRISE (nature `incident`).
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * La gestion de crise a été retirée de l'application : plus de nature à poser,
 * plus de fiche, plus de zone tracée, plus de statistiques — et `incident` ne
 * figure plus dans `TYPES` (voir serveur/depot.mjs).
 *
 * Conséquence : une fiche de cette nature encore présente dans le dépôt serait
 * désormais écartée SILENCIEUSEMENT au chargement, par `estValide`. Elle
 * disparaîtrait à la première écriture, sans trace et sans que personne l'ait
 * décidé. C'est exactement ce qu'il ne faut pas laisser arriver à des données.
 *
 * Ce script fait donc le retrait explicitement, avec une sauvegarde datée
 * avant écriture, et dit ce qu'il enlève.
 *
 *   node scripts/purger-crise.mjs            aperçu, n'écrit rien
 *   node scripts/purger-crise.mjs --ecrire   applique
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');
const ecrire = process.argv.includes('--ecrire');

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const crises = items.filter((m) => m.type === 'incident');

console.log('');
console.log('PURGE DE LA GESTION DE CRISE');
console.log('-'.repeat(72));
console.log(`Marquages au total          : ${items.length}`);
console.log(`De nature « incident »      : ${crises.length}`);
console.log('');

for (const m of crises) {
  console.log(
    `  ${m.id}  ${(m.nom || '(sans nom)').slice(0, 26).padEnd(28)} ` +
      `${String(m.categorie ?? '—').padEnd(14)} ${m.reg ?? '—'} / ${m.cie ?? '—'}`
  );
}

if (!crises.length) {
  console.log('Rien à purger.');
  console.log('');
  process.exit(0);
}

if (!ecrire) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour purger.');
  console.log('');
  process.exit(0);
}

const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-purge-crise.json');
copyFileSync(FICHIER, sauvegarde);
depot.items = items.filter((m) => m.type !== 'incident');
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log('');
console.log(`${crises.length} marquage(s) de crise purgé(s). Reste ${depot.items.length} marquages.`);
console.log(`Sauvegarde : ${sauvegarde}`);
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
