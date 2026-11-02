#!/usr/bin/env node
/**
 * RETIRER L'EFFECTIF DE DÉMONSTRATION, AVANT LA MISE EN SERVICE.
 *
 * POURQUOI CE SCRIPT EXISTE. L'effectif fictif a été fabriqué pour éprouver
 * SAISIE TERRAIN tant que l'effectif réel n'était pas disponible
 * (`scripts/fake-effectifs.mjs`). Il devait pouvoir partir sans laisser de
 * trace — c'était la condition posée dès sa création. Rien ne le permettait :
 * il fallait éditer deux fichiers JSON à la main, dont un de 27 Mo.
 *
 * CE QU'IL RETIRE, et RIEN d'autre :
 *
 *   effectifs.json   les personnes portant `demo: true` ;
 *   elements.json    les lignes de relève qui les affectent à un poste.
 *
 * CE QU'IL NE TOUCHE PAS. Les BARRAGES ne sont pas de la démonstration : les
 * 1 124 repères sont des positions géographiques réelles, saisies et nommées.
 * Les COMPTES non plus. Les notifications et les missions non plus. Ce script
 * ne connaît qu'une chose : la marque `demo`.
 *
 * TROIS MARQUES, ET ON EXIGE LA PREMIÈRE. Une personne fictive porte
 * `demo: true`, un matricule en « DEMO-… » et un nom finissant par « DEMO ».
 * Le tri se fait sur le DRAPEAU, jamais sur le nom : un vrai gendarme qui
 * s'appellerait Demo ne doit pas disparaître, et l'inverse — se fier au nom —
 * était exactement l'écueil annoncé à la création de ces données.
 *
 * PRÉCAUTIONS
 *   — sauvegarde horodatée de chaque fichier touché, avant toute écriture ;
 *   — `--liste` n'écrit rien et montre ce qui partirait ;
 *   — les lignes de relève sont retirées PAR MATRICULE fictif, ce qui laisse
 *     intactes celles d'un effectif réel déjà chargé sur les mêmes postes.
 *
 * EMPLOI
 *   node scripts/retirer-demo.mjs --liste
 *   node scripts/retirer-demo.mjs --retirer
 *   node scripts/retirer-demo.mjs --retirer --donnees ./autre-dossier
 *
 * Sans `--retirer`, le script ne fait rien : effacer 7 454 personnes ne doit
 * pas être le comportement d'une commande lancée sans argument.
 */
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ecrireJsonAtomique } from '../serveur/ecritureAtomique.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-serveur')));
const RETIRER = drapeau('retirer');

const fichier = (n) => join(DONNEES, n);
const lire = (n) => {
  if (!existsSync(fichier(n))) return null;
  try {
    return JSON.parse(readFileSync(fichier(n), 'utf8'));
  } catch (err) {
    console.error(`\n${n} illisible : ${err.message}\n`);
    process.exit(1);
  }
};

const effectifs = lire('effectifs.json');
const elements = lire('elements.json');

if (!effectifs) {
  console.error(`\nIntrouvable : ${fichier('effectifs.json')}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Ce qui est fictif                                                  */
/* ------------------------------------------------------------------ */

const gens = effectifs.items ?? [];
const fictifs = gens.filter((p) => p.demo === true);
const reels = gens.filter((p) => p.demo !== true);
const matriculesFictifs = new Set(fictifs.map((p) => p.matricule));

const lignes = elements?.items ?? [];
const lignesFictives = lignes.filter((e) => matriculesFictifs.has(e.matricule));
const lignesReelles = lignes.filter((e) => !matriculesFictifs.has(e.matricule));

/**
 * DES LIGNES ORPHELINES ? Une relève dont le matricule n'existe dans aucun des
 * deux ensembles est signalée mais CONSERVÉE : ce serait de la donnée dont on
 * ne sait rien, et un script de nettoyage n'a pas à trancher à sa place.
 */
const connus = new Set(gens.map((p) => p.matricule));
const orphelines = lignes.filter((e) => e.matricule && !connus.has(e.matricule));

/* Par brigade, pour dire ce qui reste après. */
const parBrigade = new Map();
for (const p of reels) parBrigade.set(p.bt, (parBrigade.get(p.bt) ?? 0) + 1);

/* ------------------------------------------------------------------ */

console.log('');
console.log(`Dossier                  : ${DONNEES}`);
console.log('');
console.log(`Effectif total           : ${gens.length.toLocaleString('fr-FR')}`);
console.log(`  dont fictif (demo)     : ${fictifs.length.toLocaleString('fr-FR')}`);
console.log(`  dont réel              : ${reels.length.toLocaleString('fr-FR')}`);
console.log('');
console.log(`Lignes de relève         : ${lignes.length.toLocaleString('fr-FR')}`);
console.log(`  affectant un fictif    : ${lignesFictives.length.toLocaleString('fr-FR')}`);
console.log(`  affectant un réel      : ${lignesReelles.length.toLocaleString('fr-FR')}`);
if (orphelines.length) {
  console.log(`  matricule inconnu      : ${orphelines.length.toLocaleString('fr-FR')}  (CONSERVÉES)`);
}
console.log('');
console.log(`Brigades gardant un effectif réel : ${parBrigade.size}`);

if (fictifs.length === 0) {
  console.log('\nAucune donnée de démonstration. Rien à faire.\n');
  process.exit(0);
}

if (!RETIRER) {
  console.log('');
  console.log('Rien n’a été écrit.');
  console.log('');
  console.log('  --liste     ce compte rendu (vous y êtes)');
  console.log('  --retirer   retire effectivement l’effectif fictif et ses relèves');
  console.log('');
  console.log('APRÈS LE RETRAIT, les 391 brigades n’auront plus d’effectif : leurs');
  console.log('postes s’afficheront vides jusqu’au chargement de l’effectif réel.');
  console.log('C’est l’état attendu d’une application neuve, pas une panne.');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Sauvegarde, puis écriture                                          */
/* ------------------------------------------------------------------ */

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const sauver = (n) => {
  const dest = `${fichier(n)}.avant-retrait-demo-${horodatage}`;
  copyFileSync(fichier(n), dest);
  console.log(`Sauvegarde : ${dest}`);
};

console.log('');
sauver('effectifs.json');
ecrireJsonAtomique(fichier('effectifs.json'), { ...effectifs, items: reels }, 2);
console.log(`effectifs.json : ${fictifs.length.toLocaleString('fr-FR')} personne(s) retirée(s)`);

if (elements && lignesFictives.length) {
  sauver('elements.json');
  ecrireJsonAtomique(
    fichier('elements.json'),
    { ...elements, items: [...lignesReelles] },
    2,
  );
  console.log(`elements.json  : ${lignesFictives.length.toLocaleString('fr-FR')} ligne(s) retirée(s)`);
}

console.log('');
console.log('Fait. Redémarrez le service pour qu’il relise les données.');
console.log('');
console.log('Chargez ensuite l’effectif réel — même forme que effectifs.json :');
console.log('  { matricule, nom, grade, bt, cie, reg }   sans champ `demo`');
console.log('');
console.log('La préparation du roster repartira d’elle-même (voir roster.mjs).');
console.log('');
