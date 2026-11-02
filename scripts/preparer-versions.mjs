#!/usr/bin/env node
/**
 * FABRIQUER LES DEUX VERSIONS — démonstration et production.
 *
 * LE CODE EST LE MÊME dans les deux. Mêmes écrans, même authentification,
 * mêmes permissions, même qualité. Seules les DONNÉES diffèrent :
 *
 *   donnees-demo/         un dispositif fictif complet, pour montrer et
 *                         éprouver toutes les fonctions ;
 *   donnees-production/   vide, sauf l'ossature — c'est là que le dispositif
 *                         réel se saisit, région par région.
 *
 * CE QUI EMPÊCHE DE LES CONFONDRE, et ce n'est pas la discipline :
 *
 *   1. chaque dossier porte un `mode.json`, et le service REFUSE DE DÉMARRER
 *      si le mode qu'on lui déclare (`--mode`) ne correspond pas. Lancer le
 *      paquet de démonstration sur les données réelles s'arrête net, avec un
 *      message qui dit lequel est lequel (voir `serveur/mode.mjs`) ;
 *
 *   2. chaque enregistrement fictif porte `demo: true`. La production peut
 *      donc être CONTRÔLÉE — `--verifier` refuse un dossier de production qui
 *      contiendrait le moindre enregistrement de démonstration ;
 *
 *   3. les deux versions écoutent des ports différents (8080 / 8090), pour
 *      qu'un onglet resté ouvert ne trompe personne ;
 *
 *   4. l'écran porte un bandeau permanent en démonstration.
 *
 * CE QUI EST COMMUN AUX DEUX, et doit l'être :
 *
 *   — les COMPTES (comptes.json) : les 625 habilitations, leurs empreintes et
 *     leurs rattachements. Ce sont les mêmes personnes qui essaient et qui
 *     travaillent ; leur redonner un mot de passe par version serait une
 *     source d'erreur, pas une sécurité ;
 *   — la CONFIGURATION (composition-barrage.json, villes-police.json) ;
 *   — l'ORGANIGRAMME (28 régions, 90 compagnies, 504 brigades) qui vient des
 *     couches livrées dans `dist/layers/`, jamais des données.
 *
 * EMPLOI
 *   node scripts/preparer-versions.mjs --etat
 *   node scripts/preparer-versions.mjs --construire
 *   node scripts/preparer-versions.mjs --verifier
 *   node scripts/preparer-versions.mjs --marquer production --donnees <dossier>
 *
 * `--construire` ne détruit rien : il refuse d'écraser un dossier existant
 * sans `--remplacer`.
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODES, ecrireMode, lireMode, libelleMode, FICHIER_MODE } from '../serveur/mode.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DEMO = join(ROOT, 'donnees-demo');
const PROD = join(ROOT, 'donnees-production');
const ACTUEL = join(ROOT, 'donnees-serveur');
const SAUVEGARDES = join(ACTUEL, 'sauvegardes');

/* ------------------------------------------------------------------ */
/* Ce que chaque version contient                                     */
/* ------------------------------------------------------------------ */

/** Fichiers d'ENREGISTREMENTS : pleins en démonstration, vides en production. */
const ENREGISTREMENTS = [
  'marquages.json',
  'elements.json',
  'effectifs.json',
  'alertes.json',
  'instructions.json',
  'conflits-planification.json',
  'missions.json',
];

/** Fichiers COMMUNS : identiques dans les deux versions. */
const COMMUNS = ['comptes.json', 'composition-barrage.json', 'villes-police.json'];

/* ------------------------------------------------------------------ */
/* Outils                                                            */
/* ------------------------------------------------------------------ */

const lireItems = (chemin) => {
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return null;
  }
};

const compter = (chemin) => lireItems(chemin)?.items?.length ?? null;

/**
 * La sauvegarde la plus récente d'un fichier, dans `sauvegardes/`.
 *
 * Le jeu fictif y est : c'est ce que `vider-donnees.mjs` a mis de côté avant
 * de remettre les données à zéro. On le reprend de là plutôt que de le
 * régénérer, pour que la démonstration montre EXACTEMENT ce qui a servi à
 * éprouver l'application.
 */
function derniereSauvegarde(nom) {
  if (!existsSync(SAUVEGARDES)) return null;
  const candidats = readdirSync(SAUVEGARDES)
    .filter((f) => f.startsWith(nom + '.avant-vidage-'))
    .sort();
  return candidats.length ? join(SAUVEGARDES, candidats[candidats.length - 1]) : null;
}

/**
 * MARQUER LES ENREGISTREMENTS COMME FICTIFS.
 *
 * `demo: true` sur chaque enregistrement, et non seulement sur le dossier.
 * Deux raisons, et la seconde est la plus importante :
 *
 *   — l'écran peut le dire, ligne par ligne (l'effectif fictif le fait déjà) ;
 *   — un enregistrement fictif qui se retrouverait en production devient
 *     DÉTECTABLE. Sans marque sur la donnée elle-même, un copier-coller
 *     malheureux serait indiscernable d'une saisie réelle — et il n'y aurait
 *     plus aucun moyen de faire le tri après coup.
 */
function marquerFictifs(chemin) {
  const brut = lireItems(chemin);
  if (!brut || !Array.isArray(brut.items)) return 0;
  let n = 0;
  for (const item of brut.items) {
    if (item.demo !== true) {
      item.demo = true;
      n++;
    }
  }
  brut.demo = true;
  brut._lisezMoi =
    'DONNÉES DE DÉMONSTRATION. Chaque enregistrement porte demo:true. ' +
    'Ne jamais présenter comme réel, ne jamais verser en production.';
  writeFileSync(chemin, JSON.stringify(brut, null, 2) + '\n', 'utf8');
  return n;
}

/** Les enregistrements fictifs présents dans un dossier. */
function fictifsDans(dossier) {
  const trouves = [];
  for (const nom of ENREGISTREMENTS) {
    const brut = lireItems(join(dossier, nom));
    const n = (brut?.items ?? []).filter((i) => i?.demo === true).length;
    if (n) trouves.push({ fichier: nom, n });
  }
  return trouves;
}

/* ------------------------------------------------------------------ */
/* --marquer                                                          */
/* ------------------------------------------------------------------ */

if (drapeau('marquer')) {
  const mode = valeur('marquer');
  const dossier = resolve(valeur('donnees', ACTUEL));
  if (!existsSync(dossier)) {
    console.error(`\nIntrouvable : ${dossier}\n`);
    process.exit(1);
  }
  try {
    const ecrit = ecrireMode(dossier, mode);
    console.log(`\n${dossier}`);
    console.log(`  marqué : ${ecrit.mode} (${libelleMode(ecrit.mode)})\n`);
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* --etat                                                             */
/* ------------------------------------------------------------------ */

function etatDe(dossier, nom) {
  console.log('');
  console.log(`${nom}`);
  console.log(`  ${dossier}`);
  if (!existsSync(dossier)) {
    console.log('  (absent)');
    return;
  }

  let marque = null;
  try {
    marque = lireMode(dossier);
  } catch (err) {
    console.log(`  ${FICHIER_MODE} EN DÉFAUT : ${err.message}`);
  }
  console.log(`  mode : ${marque ? `${marque.mode} — ${libelleMode(marque.mode)}` : 'NON MARQUÉ'}`);

  for (const f of ENREGISTREMENTS) {
    const n = compter(join(dossier, f));
    if (n === null) continue;
    const fictifs = (lireItems(join(dossier, f))?.items ?? []).filter((i) => i?.demo === true).length;
    console.log(
      `    ${f.padEnd(30)} ${String(n).padStart(7)}` +
        (fictifs ? `   dont ${fictifs} fictif(s)` : ''),
    );
  }
  for (const f of COMMUNS) {
    const chemin = join(dossier, f);
    if (!existsSync(chemin)) {
      console.log(`    ${f.padEnd(30)}  ABSENT`);
      continue;
    }
    const brut = lireItems(chemin);
    const n = brut?.comptes ? Object.keys(brut.comptes).length : null;
    console.log(`    ${f.padEnd(30)} ${n !== null ? String(n).padStart(7) : '  (config)'}`);
  }
}

if (drapeau('etat') || process.argv.length <= 2) {
  console.log('');
  console.log('LES DEUX VERSIONS');
  etatDe(DEMO, 'VERSION 1 — DÉMONSTRATION');
  etatDe(PROD, 'VERSION 2 — PRODUCTION');
  etatDe(ACTUEL, 'dossier historique (donnees-serveur)');
  console.log('');
  if (process.argv.length <= 2) {
    console.log('  --construire   fabriquer les deux dossiers');
    console.log('  --verifier     contrôler leur séparation');
    console.log('');
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* --verifier                                                         */
/* ------------------------------------------------------------------ */

if (drapeau('verifier')) {
  const fautes = [];
  console.log('');
  console.log('CONTRÔLE DE LA SÉPARATION');
  console.log('');

  for (const [dossier, attendu, nom] of [
    [DEMO, MODES.DEMO, 'DÉMONSTRATION'],
    [PROD, MODES.PRODUCTION, 'PRODUCTION'],
  ]) {
    if (!existsSync(dossier)) {
      fautes.push(`${nom} : dossier absent (${dossier})`);
      continue;
    }

    let marque = null;
    try {
      marque = lireMode(dossier);
    } catch (err) {
      fautes.push(`${nom} : ${err.message}`);
    }
    if (!marque) fautes.push(`${nom} : aucun ${FICHIER_MODE}`);
    else if (marque.mode !== attendu) {
      fautes.push(`${nom} : marqué « ${marque.mode} » au lieu de « ${attendu} »`);
    } else console.log(`  ok   ${nom.padEnd(14)} marqué ${marque.mode}`);

    /* Les comptes doivent être là : sans eux, personne ne se connecte. */
    const comptes = lireItems(join(dossier, 'comptes.json'))?.comptes;
    if (!comptes || Object.keys(comptes).length === 0) {
      fautes.push(`${nom} : aucun compte`);
    } else console.log(`  ok   ${nom.padEnd(14)} ${Object.keys(comptes).length} habilitations`);
  }

  /* LE CONTRÔLE QUI COMPTE : rien de fictif en production. */
  if (existsSync(PROD)) {
    const fictifs = fictifsDans(PROD);
    if (fictifs.length) {
      for (const f of fictifs) {
        fautes.push(`PRODUCTION contient ${f.n} enregistrement(s) fictif(s) dans ${f.fichier}`);
      }
    } else {
      console.log('  ok   PRODUCTION    aucun enregistrement fictif');
    }

    const total = ENREGISTREMENTS.reduce((s, f) => s + (compter(join(PROD, f)) ?? 0), 0);
    if (total === 0) console.log('  ok   PRODUCTION    aucun enregistrement — prête à la saisie');
    else console.log(`  --   PRODUCTION    ${total} enregistrement(s) saisi(s)`);
  }

  /* Et la démonstration doit bien être fictive, sinon elle ne sert à rien. */
  if (existsSync(DEMO)) {
    const barrages = compter(join(DEMO, 'marquages.json')) ?? 0;
    const fictifs = fictifsDans(DEMO).find((f) => f.fichier === 'marquages.json')?.n ?? 0;
    if (barrages === 0) fautes.push('DÉMONSTRATION : aucun barrage — rien à montrer');
    else if (fictifs !== barrages) {
      fautes.push(
        `DÉMONSTRATION : ${barrages - fictifs} barrage(s) sur ${barrages} ne portent pas demo:true`,
      );
    } else console.log(`  ok   DÉMONSTRATION ${barrages} barrages, tous marqués fictifs`);
  }

  console.log('');
  if (fautes.length) {
    for (const f of fautes) console.error(`  DÉFAUT  ${f}`);
    console.error('\nLa séparation des versions est en défaut.\n');
    process.exit(1);
  }
  console.log('Les deux versions sont séparées et conformes.\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* --construire                                                       */
/* ------------------------------------------------------------------ */

if (!drapeau('construire')) {
  console.error('\nRien à faire. Employez --etat, --construire, --verifier ou --marquer.\n');
  process.exit(1);
}

const REMPLACER = drapeau('remplacer');

for (const [dossier, nom] of [
  [DEMO, 'donnees-demo'],
  [PROD, 'donnees-production'],
]) {
  if (existsSync(dossier) && !REMPLACER) {
    console.error(`\n${dossier} existe déjà.`);
    console.error('Ajoutez --remplacer pour le refaire, ou choisissez un autre chemin.\n');
    process.exit(1);
  }
  if (existsSync(dossier) && REMPLACER) rmSync(dossier, { recursive: true, force: true });
  mkdirSync(dossier, { recursive: true });
  void nom;
}

console.log('');
console.log('VERSION 1 — DÉMONSTRATION');
console.log('');

/* Les communs, à l'identique. */
for (const f of COMMUNS) {
  const src = join(ACTUEL, f);
  if (!existsSync(src)) {
    console.log(`  ! ${f} introuvable dans ${ACTUEL}`);
    continue;
  }
  copyFileSync(src, join(DEMO, f));
  copyFileSync(src, join(PROD, f));
}
console.log(`  communs copiés : ${COMMUNS.join(', ')}`);

/* Les enregistrements fictifs, repris des sauvegardes. */
let reprises = 0;
for (const f of ENREGISTREMENTS) {
  const source = derniereSauvegarde(f);
  const cible = join(DEMO, f);

  if (source) {
    copyFileSync(source, cible);
    reprises++;
  } else {
    /* Pas de sauvegarde : on part de l'enveloppe vide plutôt que d'échouer. */
    const actuel = join(ACTUEL, f);
    if (existsSync(actuel)) copyFileSync(actuel, cible);
    else writeFileSync(cible, JSON.stringify({ version: 1, items: [] }, null, 2) + '\n');
  }

  const marques = marquerFictifs(cible);
  const n = compter(cible) ?? 0;
  console.log(`  ${f.padEnd(30)} ${String(n).padStart(7)}` + (marques ? `   ${marques} marqué(s) demo` : ''));
}

/* Le journal fictif, s'il existe. */
{
  const source = derniereSauvegarde('journal.jsonl');
  writeFileSync(join(DEMO, 'journal.jsonl'), source ? readFileSync(source, 'utf8') : '', 'utf8');
}

ecrireMode(DEMO, MODES.DEMO, `${reprises} fichier(s) repris des sauvegardes`);
console.log(`  ${FICHIER_MODE} : demo`);

console.log('');
console.log('VERSION 2 — PRODUCTION');
console.log('');

for (const f of ENREGISTREMENTS) {
  /* L'enveloppe EXACTE de la démonstration, vidée : mêmes clés, même version,
     de sorte que les dépôts lisent les deux de la même façon. */
  const modele = lireItems(join(DEMO, f)) ?? { version: 1, items: [] };
  const vide = { version: modele.version ?? 1, items: [] };
  writeFileSync(join(PROD, f), JSON.stringify(vide, null, 2) + '\n', 'utf8');
  console.log(`  ${f.padEnd(30)}       0`);
}
writeFileSync(join(PROD, 'journal.jsonl'), '', 'utf8');

ecrireMode(PROD, MODES.PRODUCTION, 'aucun enregistrement — le dispositif réel se saisit ici');
console.log(`  ${FICHIER_MODE} : production`);

console.log('');
console.log('Les deux dossiers sont prêts. Contrôlez-les :');
console.log('    node scripts/preparer-versions.mjs --verifier');
console.log('');
void statSync;
