#!/usr/bin/env node
/**
 * RESET GLOBAL DES CONFLITS — repartir d'un système de conflits vide.
 *
 *   node scripts/reset-conflits.mjs --donnees donnees-demo
 *
 * LE SERVICE DOIT ÊTRE ARRÊTÉ : les dépôts des instructions et des
 * notifications gardent leurs données en mémoire et réécriraient les anciennes
 * à leur prochaine écriture.
 *
 * Réinitialisé (tous comptes, tous rôles — les données sont communes) :
 *   suivi-conflits.json   tous les conflits (actifs, en attente, en cours,
 *                         traités, clos), leurs historiques, transitions et
 *                         assignations, et la liste des conflits supprimés ;
 *   instructions.json     les instructions d'ASSIGNATION (conflits et barrages
 *                         en conflit : assignation, transmission à une CIE) ;
 *   notifications.json    les notifications du workflow des conflits et des
 *                         assignations.
 *
 * Conservé : comptes, rôles, régions / compagnies / brigades, barrages et
 * leurs positions, routes, configuration de l'optimisation et ses rapports,
 * alertes de distance, effectifs, journal d'audit (journal.jsonl, jamais
 * réécrit), et les instructions / notifications sans rapport avec les
 * conflits (demandes de modification d'un barrage, faction…).
 *
 * Avant d'écrire, une copie des trois fichiers est faite dans
 * `<donnees>/sauvegardes/reset-conflits-<horodatage>/` : le reset se défait en
 * recopiant ces fichiers (service arrêté).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : defaut;
};
const DONNEES = resolve(arg('donnees', 'donnees-demo'));
if (!existsSync(join(DONNEES, 'mode.json'))) {
  console.error(`Dossier de données introuvable ou incomplet : ${DONNEES}`);
  process.exit(1);
}

const FICHIERS = ['suivi-conflits.json', 'instructions.json', 'notifications.json'];
const lire = (f) => (existsSync(join(DONNEES, f)) ? JSON.parse(readFileSync(join(DONNEES, f), 'utf8')) : null);
const ecrire = (f, contenu) => {
  const cible = join(DONNEES, f);
  const tmp = `${cible}.tmp`;
  writeFileSync(tmp, JSON.stringify(contenu, null, 2));
  renameSync(tmp, cible); // atomique : jamais de fichier à moitié écrit
};
const liste = (x) => (Array.isArray(x) ? x : x?.items ?? []);
const avecListe = (origine, items) => (Array.isArray(origine) ? items : { ...origine, items });

/* 1. Sauvegarde */
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const dossierSauvegarde = join(DONNEES, 'sauvegardes', `reset-conflits-${horodatage}`);
mkdirSync(dossierSauvegarde, { recursive: true });
for (const f of FICHIERS) if (existsSync(join(DONNEES, f))) copyFileSync(join(DONNEES, f), join(dossierSauvegarde, f));

/* 2. Conflits : tout */
const suivi = lire('suivi-conflits.json') ?? { version: 1 };
const avantConflits = liste(suivi).length;
const avantSupprimes = (suivi.supprimes ?? []).length;
ecrire('suivi-conflits.json', { version: suivi.version ?? 1, items: [], supprimes: [] });

/* 3. Instructions : les assignations (conflits, barrages en conflit, transmissions) */
const estAssignation = (i) => i?.action === 'assignation' || Boolean(i?.criteres?.conflitId || i?.criteres?.conflitNumero);
const instructions = lire('instructions.json');
let instrRetirees = 0;
let instrGardees = 0;
if (instructions) {
  const gardees = liste(instructions).filter((i) => !estAssignation(i));
  instrRetirees = liste(instructions).length - gardees.length;
  instrGardees = gardees.length;
  ecrire('instructions.json', avecListe(instructions, gardees));
}

/* 4. Notifications : workflow des conflits et assignations */
const estNotifConflit = (n) =>
  n?.type === 'assignation' ||
  (Array.isArray(n?.actions) && n.actions.some((a) => /conflit|assignation/.test(a))) ||
  Boolean(n?.conflitId || n?.details?.conflitId || n?.details?.conflitNumero) ||
  /\bconflit\b/i.test(`${n?.titre ?? ''} ${n?.description ?? ''}`);
const notifications = lire('notifications.json');
let notifRetirees = 0;
let notifGardees = 0;
if (notifications) {
  const gardees = liste(notifications).filter((n) => !estNotifConflit(n));
  notifRetirees = liste(notifications).length - gardees.length;
  notifGardees = gardees.length;
  ecrire('notifications.json', avecListe(notifications, gardees));
}

console.log(`Reset des conflits — ${DONNEES}`);
console.log(`  Sauvegarde           : ${dossierSauvegarde}`);
console.log(`  Conflits supprimés   : ${avantConflits} (+ ${avantSupprimes} entrée(s) de la liste des supprimés)`);
console.log(`  Instructions         : ${instrRetirees} assignation(s) retirée(s), ${instrGardees} conservée(s)`);
console.log(`  Notifications        : ${notifRetirees} retirée(s), ${notifGardees} conservée(s)`);
