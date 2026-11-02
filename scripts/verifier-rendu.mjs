#!/usr/bin/env node
/**
 * RENDU D'ÉPREUVE DE TOUTES LES SECTIONS.
 *
 * Trois contrôles existaient : le prouveur de navigation
 * (`verifier-parcours.mjs`) éprouve du calcul pur, `eslint` attrape les
 * identifiants inconnus, le placement des bulles est balayé
 * (`verifier-placement.mjs`). AUCUN ne rend les composants.
 *
 * Or c'est le rendu qui a produit quatre écrans blancs dans ce projet : un
 * `useEffect` non importé, un `roster.effectif` lu quand `roster` est nul, une
 * brique appelée avec la mauvaise forme de données. Le build passait, le
 * bundle se construisait, et l'application mourait à l'ouverture.
 *
 * Ce script assemble `scripts/rendu-essai.jsx` avec VITE — donc avec les mêmes
 * réglages, les mêmes alias et le même JSX que l'application — puis exécute le
 * module dans Node et rend chaque section dans les états qui comptent.
 *
 *   node scripts/verifier-rendu.mjs
 *
 * Le rendu serveur ne clique pas : il n'éprouve pas les transitions (c'est le
 * rôle du prouveur de navigation). Il éprouve ce que le prouveur ne peut pas
 * voir : que CHAQUE étape de CHAQUE section se construit et se dessine, avec
 * des données vides comme avec des données plausibles.
 */
import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * AUCUN APPEL RÉSEAU pendant l'épreuve.
 *
 * Les panneaux appellent l'API au montage (`chargerComptes`, `chargerRoster`,
 * `etatRoster`). Sans serveur, `fetch` lèverait une erreur non capturée dans
 * une promesse et le processus s'arrêterait sur un motif qui n'a rien à voir
 * avec ce qu'on éprouve. On le remplace par un refus immédiat : les panneaux
 * doivent supporter que le serveur ne réponde pas, et c'est aussi ce qu'on
 * vérifie ici.
 */
globalThis.fetch = () => Promise.reject(new Error('réseau volontairement absent'));

/* Le rendu serveur touche à ces globales du navigateur : on les rend inertes
   plutôt que de les laisser manquer. */
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });

/* Une promesse rejetée sans capture ne doit pas tuer l'épreuve : c'est
   exactement ce que produit le `fetch` refusé ci-dessus. */
process.on('unhandledRejection', () => {});

/**
 * LE BUNDLE EST ÉCRIT DANS LE PROJET, ET NON DANS `tmp`.
 *
 * Vite laisse `react` et `react-dom` en dépendances externes d'un bundle SSR
 * — c'est ce qu'on veut, on ne va pas empaqueter React pour l'éprouver. Mais
 * Node résout ces imports en remontant les dossiers depuis le FICHIER : posé
 * dans `tmp`, il ne trouve aucun `node_modules`.
 *
 * Sous `node_modules/.gr-rendu/`, la résolution aboutit. Le dossier est effacé
 * à la fin, et `node_modules` n'est de toute façon pas livré.
 */
const sortie = await mkdtemp(join(ROOT, 'node_modules', '.gr-rendu-'));

try {
  await build({
    root: ROOT,
    configFile: join(ROOT, 'vite.config.js'),
    logLevel: 'error',
    build: {
      ssr: true,
      write: true,
      outDir: sortie,
      emptyOutDir: true,
      rollupOptions: { input: join(ROOT, 'scripts', 'rendu-essai.jsx') },
    },
  });

  const { eprouver } = await import(pathToFileURL(join(sortie, 'rendu-essai.js')).href);
  const { rendus, echecs, parcours } = eprouver();

  console.log('');
  console.log(`Sections rendues            : ${rendus}`);
  console.log(`Dont parcours guidés        : ${parcours}, tous à l’étape 1`);
  console.log(`Échecs de rendu             : ${echecs.length}`);

  if (echecs.length) {
    console.error('');
    for (const e of echecs.slice(0, 15)) console.error(`  ${e.nom}\n      ${e.motif}`);
    if (echecs.length > 15) console.error(`  … et ${echecs.length - 15} autre(s)`);
    console.error('\nUne section ne se rend pas.\n');
    process.exit(1);
  }

  console.log('\nToutes les sections se rendent, dans tous les états éprouvés.\n');
} finally {
  await rm(sortie, { recursive: true, force: true });
}
