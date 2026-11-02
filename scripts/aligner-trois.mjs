#!/usr/bin/env node
/**
 * ALIGNER LES RELÈVES EXISTANTES SUR LA RÈGLE DES TROIS.
 *
 *   node scripts/aligner-trois.mjs                    aperçu : n'écrit rien
 *   node scripts/aligner-trois.mjs --ecrire           applique
 *   node scripts/aligner-trois.mjs --donnees <dossier>
 *
 * POURQUOI UN SCRIPT ET NON UNE CORRECTION AU DÉMARRAGE. Les relèves déjà
 * écrites sont un HISTORIQUE : ce sont des hommes qui ont réellement tenu des
 * postes, aux dates où ils les ont tenus. Les réécrire au vol, à chaque
 * lecture, effacerait cet historique sans que personne ne l'ait demandé. On
 * corrige donc une fois, sur ordre, avec une sauvegarde et un rapport.
 *
 * IL REFUSE UN DOSSIER QUI N'EST PAS DE DÉMONSTRATION. Le contrôle est le même
 * que celui du semis (`mode.json`) : la règle des trois s'applique aux données
 * réelles par les ÉCRITURES À VENIR (le service refuse le quatrième homme),
 * pas par une réécriture du passé, qui n'appartient pas à un script.
 *
 * CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS
 * --------------------------------------
 *   TROP D'HOMMES (4, 5, 6…)  → on retire les surnuméraires, en gardant les
 *                               plus gradés : c'est l'équipe qu'on garderait
 *                               en réduisant un poste.
 *   PAS ASSEZ (1, 2)          → on NE TOUCHE À RIEN et on le signale. Compléter
 *                               demanderait d'inventer des présences, ce que
 *                               ce dépôt s'interdit partout ailleurs (voir
 *                               « AUCUNE personne n'est inventée » dans
 *                               composition-barrage.json). La préparation du
 *                               roster, elle, sait les compléter avec
 *                               l'effectif réel de la brigade.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADES, ELEMENTS_PAR_BARRAGE } from '../serveur/elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ecrire = args.includes('--ecrire');
/* `indexOf` rend -1 quand le drapeau est absent : sans cette garde, `args[0]`
   — donc `--ecrire` — était pris pour le dossier. */
const iDonnees = args.indexOf('--donnees');
const dossier = resolve(ROOT, iDonnees >= 0 ? (args[iDonnees + 1] ?? 'donnees-demo') : 'donnees-demo');

/* --- Garde : démonstration seulement -------------------------------- */
const fichierMode = join(dossier, 'mode.json');
const mode = existsSync(fichierMode) ? JSON.parse(readFileSync(fichierMode, 'utf8')).mode : null;
if (mode !== 'demo') {
  console.error(
    `Refus : ${dossier} n'est pas un dossier de DÉMONSTRATION (mode.json → ${mode ?? 'absent'}).\n` +
      "Sur des données réelles, la règle s'applique aux écritures à venir ; " +
      "l'historique ne se réécrit pas par script.",
  );
  process.exit(1);
}

const dossierElements = join(dossier, 'elements');
if (!existsSync(dossierElements)) {
  console.error(`Aucun dossier de relèves : ${dossierElements}`);
  process.exit(1);
}

/* --- Lecture --------------------------------------------------------- */
const fichiers = readdirSync(dossierElements).filter((f) => f.endsWith('.jsonl'));
const parFichier = new Map();
for (const f of fichiers) {
  const lignes = readFileSync(join(dossierElements, f), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  parFichier.set(f, lignes);
}

/* --- Tri : les plus gradés restent ----------------------------------- */
const rang = (e) => GRADES.indexOf(e.grade); // GRADES : du moins élevé au plus élevé
const garder = (liste) =>
  [...liste]
    .sort((a, b) => rang(b) - rang(a) || String(a.saisiLe).localeCompare(String(b.saisiLe)))
    .slice(0, ELEMENTS_PAR_BARRAGE);

let couples = 0;
let trop = 0;
let retires = 0;
let insuffisants = 0;
const exemples = [];

for (const [fichier, lignes] of parFichier) {
  const groupes = new Map();
  for (const e of lignes) {
    const cle = `${e.barrageId}#${e.date}#${e.creneau}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(e);
  }

  const conserves = new Set();
  for (const [cle, groupe] of groupes) {
    couples++;
    if (groupe.length > ELEMENTS_PAR_BARRAGE) {
      trop++;
      retires += groupe.length - ELEMENTS_PAR_BARRAGE;
      for (const e of garder(groupe)) conserves.add(e.id);
      if (exemples.length < 3) exemples.push(`${cle} : ${groupe.length} → ${ELEMENTS_PAR_BARRAGE}`);
    } else {
      if (groupe.length < ELEMENTS_PAR_BARRAGE) insuffisants++;
      for (const e of groupe) conserves.add(e.id);
    }
  }

  if (ecrire) {
    const restantes = lignes.filter((e) => conserves.has(e.id));
    if (restantes.length !== lignes.length) {
      const chemin = join(dossierElements, fichier);
      copyFileSync(chemin, `${chemin}.avant-trois`);
      writeFileSync(chemin, restantes.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }
  }
}

/* --- Rapport ---------------------------------------------------------- */
console.log(`\nRègle : ${ELEMENTS_PAR_BARRAGE} éléments par (poste, date, créneau)`);
console.log(`Dossier                    : ${dossier}`);
console.log(`Journées de relève         : ${fichiers.length}`);
console.log(`Couples (poste, créneau)   : ${couples}`);
console.log(`  au-dessus de la règle    : ${trop}  → ${retires} ligne(s) à retirer`);
console.log(`  au-dessous de la règle   : ${insuffisants}  (laissés tels quels)`);
for (const ex of exemples) console.log(`    ex. ${ex}`);

if (!ecrire) {
  console.log('\nAperçu seulement — relancez avec --ecrire pour appliquer.');
} else {
  console.log(`\n${retires} ligne(s) retirée(s). Sauvegardes : *.jsonl.avant-trois`);
  if (insuffisants) {
    console.log(
      `${insuffisants} créneau(x) restent incomplets : relancez la préparation du roster ` +
        "depuis le panneau Administration, qui les complétera avec l'effectif réel des brigades.",
    );
  }
}
