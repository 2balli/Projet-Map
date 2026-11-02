#!/usr/bin/env node
/**
 * POSER UN MOT DE PASSE TEMPORAIRE, ET EXIGER SON CHANGEMENT.
 *
 * À QUOI CELA SERT. Les 625 comptes du fichier portent chacun un code
 * engendré par le service, montré une seule fois à sa création. Personne ne
 * les a tous notés. Pour mettre l'application en service il faut donc pouvoir
 * distribuer un accès connu — et faire en sorte qu'il ne survive pas à la
 * première connexion.
 *
 * CE QUE FAIT LE SCRIPT, pour chaque compte retenu :
 *   1. remplace l'empreinte par celle du mot de passe temporaire ;
 *   2. pose `doitChanger: true`.
 *
 * Le titulaire se connecte avec le mot de passe temporaire, l'application ne
 * lui ouvre QUE l'écran de changement (le refus est rendu par le serveur, voir
 * le verrou dans `serveur/api.mjs`), et le temporaire meurt à l'instant où il
 * en choisit un — l'empreinte ET le sel sont renouvelés.
 *
 * PRÉCAUTIONS, parce que ce script écrase des accès :
 *   — une SAUVEGARDE horodatée du fichier est écrite avant toute modification ;
 *   — `--liste` n'écrit rien et montre ce qui serait fait ;
 *   — le mot de passe temporaire par défaut est `123456` ; il est REFUSÉ comme
 *     nouveau mot de passe (voir `refusMotDePasse`), donc il ne peut pas être
 *     conservé par inadvertance ;
 *   — les comptes déjà passés au régime « mot de passe » sont LAISSÉS INTACTS
 *     sauf `--forcer` : on ne réinitialise pas l'accès de quelqu'un qui a déjà
 *     choisi son mot de passe.
 *
 * EMPLOI
 *   node scripts/mot-de-passe-initial.mjs --liste
 *   node scripts/mot-de-passe-initial.mjs --tous
 *   node scripts/mot-de-passe-initial.mjs --rang unite
 *   node scripts/mot-de-passe-initial.mjs --matricule BT-AGDEZ
 *   node scripts/mot-de-passe-initial.mjs --tous --mot-de-passe 'Barrage-2026'
 *   node scripts/mot-de-passe-initial.mjs --tous --forcer
 *
 * Sans sélection (`--tous`, `--rang`, `--matricule`), le script ne fait rien et
 * le dit : « tout réinitialiser » ne doit pas être le comportement par défaut
 * d'une commande lancée sans argument.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chargerComptes,
  enregistrerComptes,
  definirCompte,
  normaliserMatricule,
  RANGS,
} from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-serveur')));
const FICHIER = join(DONNEES, 'comptes.json');
const TEMPORAIRE = valeur('mot-de-passe', '123456');
const LISTE = drapeau('liste');
const FORCER = drapeau('forcer');

if (!existsSync(FICHIER)) {
  console.error(`\nIntrouvable : ${FICHIER}\n`);
  process.exit(1);
}

const etat = chargerComptes(FICHIER);
const tous = Object.values(etat.comptes);

/* ------------------------------------------------------------------ */
/* Qui est visé                                                       */
/* ------------------------------------------------------------------ */

const rangVoulu = valeur('rang');
const matriculeVoulu = valeur('matricule');

if (rangVoulu && !RANGS[rangVoulu]) {
  console.error(`\nRang inconnu : ${rangVoulu} (${Object.keys(RANGS).join(', ')})\n`);
  process.exit(1);
}

let vises;
if (matriculeVoulu) {
  const mat = normaliserMatricule(matriculeVoulu);
  vises = tous.filter((c) => c.matricule === mat);
  if (vises.length === 0) {
    console.error(`\nAucun compte de matricule ${mat}.\n`);
    process.exit(1);
  }
} else if (rangVoulu) {
  vises = tous.filter((c) => c.rang === rangVoulu);
} else if (drapeau('tous')) {
  vises = tous;
} else {
  console.log('');
  console.log(`Fichier : ${FICHIER}`);
  console.log(`Comptes : ${tous.length}`);
  console.log('');
  console.log('Aucune sélection. Précisez ce que vous voulez réinitialiser :');
  console.log('');
  console.log('  --liste                     ce qui serait fait, sans rien écrire');
  console.log('  --tous                      les 625 comptes');
  console.log('  --rang unite|cie|reg|admin  un échelon');
  console.log('  --matricule BT-AGDEZ        un seul compte');
  console.log('');
  process.exit(0);
}

/* Un compte qui a DÉJÀ choisi son mot de passe n'est pas réinitialisé sans
   `--forcer` : ce serait lui reprendre son accès sans le lui demander. */
const dejaChoisi = vises.filter((c) => c.secret === 'motdepasse');
const aTraiter = FORCER ? vises : vises.filter((c) => c.secret !== 'motdepasse');

/* ------------------------------------------------------------------ */

const parRang = (liste) => {
  const n = {};
  for (const c of liste) n[c.rang] = (n[c.rang] ?? 0) + 1;
  return Object.entries(n)
    .map(([r, k]) => `${k} ${r}`)
    .join(' · ');
};

console.log('');
console.log(`Fichier              : ${FICHIER}`);
console.log(`Comptes au total     : ${tous.length}`);
console.log(`Visés par la sélection : ${vises.length}  (${parRang(vises)})`);
if (dejaChoisi.length) {
  console.log(
    `Ont déjà un mot de passe : ${dejaChoisi.length}` +
      (FORCER ? '  — RÉINITIALISÉS (--forcer)' : '  — laissés intacts'),
  );
}
console.log(`À réinitialiser      : ${aTraiter.length}`);
console.log(`Mot de passe posé    : ${TEMPORAIRE}`);
console.log('');

if (aTraiter.length === 0) {
  console.log('Rien à faire.\n');
  process.exit(0);
}

if (LISTE) {
  for (const c of aTraiter.slice(0, 25)) {
    console.log(`  ${c.matricule.padEnd(24)} ${c.rang.padEnd(6)} ${c.unite}`);
  }
  if (aTraiter.length > 25) console.log(`  … et ${aTraiter.length - 25} autre(s)`);
  console.log('\nAucune écriture (--liste).\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Sauvegarde, puis écriture                                          */
/* ------------------------------------------------------------------ */

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const sauvegarde = `${FICHIER}.avant-mot-de-passe-${horodatage}`;
copyFileSync(FICHIER, sauvegarde);
console.log(`Sauvegarde           : ${sauvegarde}`);

let faits = 0;
for (const c of aTraiter) {
  /**
   * `definirCompte` REFABRIQUE l'empreinte avec un sel neuf, et conserve tout
   * le reste du compte (nom, rôle, rattachements, date de création). On ne
   * réécrit donc pas la fiche : on remplace l'accès.
   */
  await definirCompte(etat, {
    matricule: c.matricule,
    nom: c.nom,
    role: c.role ?? 'commandement',
    rang: c.rang,
    unite: c.unite,
    reg: c.reg ?? null,
    cie: c.cie ?? null,
    code: TEMPORAIRE,
    doitChanger: true,
  });
  faits++;
}

enregistrerComptes(FICHIER, etat);

console.log(`Réinitialisés        : ${faits}`);
console.log('');
console.log('Chaque titulaire se connecte avec ce mot de passe temporaire, puis');
console.log("l'application ne lui ouvre que l'écran de changement. Le temporaire");
console.log('cesse de fonctionner dès qu’il en a choisi un.');
console.log('');
console.log('Redémarrez le service pour qu’il relise les comptes.');
console.log('');
