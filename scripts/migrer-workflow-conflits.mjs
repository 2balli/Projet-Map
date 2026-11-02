#!/usr/bin/env node
/**
 * MIGRATION DES CONFLITS VERS LE MODÈLE À ÉTATS (NEW … CLOSED) — réversible.
 *
 *   node scripts/migrer-workflow-conflits.mjs --donnees donnees-demo            (essai : rien n'est écrit)
 *   node scripts/migrer-workflow-conflits.mjs --donnees donnees-demo --ecrire   (sauvegarde, puis écrit)
 *   node scripts/migrer-workflow-conflits.mjs --donnees donnees-demo --annuler --ecrire  (rend les anciens champs)
 *   node scripts/migrer-workflow-conflits.mjs --donnees donnees-demo --restaurer <sauvegarde.json>
 *
 * La règle, conflit par conflit, est `migrerConflit` (serveur/workflowConflits.mjs) :
 * AUCUN conflit n'est archivé sans preuve d'une décision du Superadmin ; les
 * traitements en attente rejoignent la file de validation qui leur revient ;
 * le reste est laissé tel quel et signalé. Chaque conflit migré porte
 * `migration: { regle, le, statutAvant, approbationAvant }`.
 *
 * Avant toute écriture, le fichier d'origine est copié dans
 * `<donnees>/sauvegardes/suivi-conflits-pre-workflow-<horodatage>.json` :
 * `--restaurer` le remet en place à l'identique. Rien d'autre n'est touché
 * (affectations, factions, routes, barrages).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrerConflit, annulerMigration } from '../serveur/workflowConflits.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom) => {
  const i = process.argv.indexOf(nom);
  return i > -1 ? process.argv[i + 1] : null;
};
const donnees = resolve(ROOT, arg('--donnees') ?? 'donnees-serveur');
const fichier = join(donnees, 'suivi-conflits.json');
const ecrire = process.argv.includes('--ecrire');
const restaurer = arg('--restaurer');
const annuler = process.argv.includes('--annuler');

const ecrireAtomique = (f, contenu) => {
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, contenu);
  renameSync(tmp, f);
};

if (restaurer) {
  const sauvegarde = resolve(ROOT, restaurer);
  if (!existsSync(sauvegarde)) {
    console.error(`\nSauvegarde introuvable : ${sauvegarde}\n`);
    process.exit(1);
  }
  ecrireAtomique(fichier, readFileSync(sauvegarde, 'utf8'));
  console.log(`\nRestauré : ${fichier}\n  depuis ${sauvegarde}\n`);
  process.exit(0);
}

if (!existsSync(fichier)) {
  console.log(`\nAucun suivi de conflits dans ${donnees} : rien à migrer.\n`);
  process.exit(0);
}

const brut = JSON.parse(readFileSync(fichier, 'utf8'));
const items = brut.items ?? [];
const parRegle = new Map();
/* L'état est déduit des anciens champs par la MÊME règle que le serveur
   applique aux conflits non migrés (etatDe) : la migration le rend explicite
   sans changer ce qui s'affiche. Anciens champs gardés dans migrationEtats.avant. */
const migres = items.map((c) => {
  const r = annuler ? annulerMigration(c) : migrerConflit(c);
  const regle = annuler ? (r.change ? 'anciens champs rendus' : 'non migré') : r.change ? `→ ${r.etat}` : `déjà ${r.etat}`;
  const l = parRegle.get(regle) ?? [];
  l.push(c.numero || c.id);
  parRegle.set(regle, l);
  return r.conflit;
});

console.log(`\n${basename(donnees)} — ${items.length} conflit(s)\n`);
for (const [regle, ids] of parRegle) {
  console.log(`  ${String(ids.length).padStart(4)}  ${regle}${ids.length <= 8 ? `  (${ids.join(', ')})` : ''}`);
}

if (!ecrire) {
  console.log('\nEssai seulement — relancer avec --ecrire pour appliquer (une sauvegarde est faite d’abord).\n');
  process.exit(0);
}

const dossierSauvegardes = join(donnees, 'sauvegardes');
mkdirSync(dossierSauvegardes, { recursive: true });
const sauvegarde = join(dossierSauvegardes, `suivi-conflits-${annuler ? 'avant-annulation' : 'pre-etats'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
copyFileSync(fichier, sauvegarde);
ecrireAtomique(fichier, JSON.stringify({ ...brut, items: migres }, null, 2));
console.log(`\nÉcrit : ${fichier}\nSauvegarde : ${sauvegarde}\nAnnuler : node scripts/migrer-workflow-conflits.mjs --donnees ${basename(donnees)} --restaurer "${sauvegarde}"\n`);
