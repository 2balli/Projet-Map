#!/usr/bin/env node
/**
 * CLI — Génération de données synthétiques réalistes pour les barrages fixes.
 *
 * Utilisation :
 *   node scripts/generer-barrages-fixes-synthetiques.mjs --dry-run
 *   node scripts/generer-barrages-fixes-synthetiques.mjs --donnees donnees-demo --ecrire --remplacer
 *   node scripts/generer-barrages-fixes-synthetiques.mjs --donnees donnees-demo --nombre 100 --graine 20261027 --ecrire
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genererBarragesFixesSynthetiques, PLAGES_ACCIDENTS_DEFAUT } from '../serveur/generateurSynthetique.mjs';
import { ecrireJsonAtomique } from '../serveur/ecritureAtomique.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(nom);
  return i > -1 ? (process.argv[i + 1] ?? true) : defaut;
};

const DOSSIER_DONNEES = resolve(ROOT, arg('--donnees', 'donnees-demo'));
const DOSSIER_COUCHES = resolve(ROOT, arg('--couches', 'public/layers'));
const GRAINE = Number(arg('--graine', 20261027));
const NOMBRE = Number(arg('--nombre', 120));
const RATIO_PERMANENT = Number(arg('--ratio-permanent', 0.25));
const ESPACEMENT_KM = Number(arg('--espacement', 4.0));
const ECRIRE = process.argv.includes('--ecrire');
const REMPLACER = process.argv.includes('--remplacer') || process.argv.includes('--regenerer');
const DRY_RUN = process.argv.includes('--dry-run') || !ECRIRE;
const VERBOSE = process.argv.includes('--verbose');

console.log('\n======================================================================');
console.log(' GÉNÉRATEUR DE DONNÉES SYNTHÉTIQUES — BARRAGES FIXES (SIMULATION)');
console.log('======================================================================');
console.log(`  Jeu de données cible : ${DOSSIER_DONNEES}`);
console.log(`  Couches carto        : ${DOSSIER_COUCHES}`);
console.log(`  Graine (seed)        : ${GRAINE}`);
console.log(`  Nombre demandé       : ${NOMBRE}`);
console.log(`  Ratio permanent      : ${RATIO_PERMANENT * 100} %`);
console.log(`  Espacement min       : ${ESPACEMENT_KM} km`);
console.log(`  Mode                 : ${DRY_RUN ? 'DRY-RUN (simulation seule, aucune écriture)' : 'ÉCRITURE DISQUE'}`);
console.log('----------------------------------------------------------------------\n');

const fichierMarquages = join(DOSSIER_DONNEES, 'marquages.json');
let itemsExistants = [];
let versionInitiale = 1;

if (existsSync(fichierMarquages)) {
  try {
    const brut = JSON.parse(readFileSync(fichierMarquages, 'utf8'));
    itemsExistants = Array.isArray(brut) ? brut : (brut.items ?? []);
    versionInitiale = brut.version ?? 1;
  } catch (err) {
    console.error(`Erreur lecture ${fichierMarquages} : ${err.message}`);
    process.exit(1);
  }
}

const reelsOuManuels = itemsExistants.filter((m) => !m.isSynthetic);
const anciensSynthetiques = itemsExistants.filter((m) => m.isSynthetic === true);

console.log(`  Barrages réels / manuels existants préservés : ${reelsOuManuels.length}`);
console.log(`  Barrages synthétiques existants détectés      : ${anciensSynthetiques.length}`);

// Génération
const { barrages, statistiques } = genererBarragesFixesSynthetiques({
  racineCouches: DOSSIER_COUCHES,
  graine: GRAINE,
  nombre: NOMBRE,
  ratioPermanent: RATIO_PERMANENT,
  espacementKm: ESPACEMENT_KM,
  existantItems: reelsOuManuels,
  plagesAccidents: PLAGES_ACCIDENTS_DEFAUT,
});

console.log('\n----------------------------------------------------------------------');
console.log(' RÉSULTATS DE LA GÉNÉRATION SYNTHÉTIQUE');
console.log('----------------------------------------------------------------------');
console.log(`  Total barrages générés       : ${statistiques.total}`);
console.log(`  - Barrages fixes (FIXED)     : ${statistiques.fixes}`);
console.log(`  - Permanents (FIXED_PERM)   : ${statistiques.permanents}`);
console.log(`  - Éclairés                   : ${statistiques.eclaires} (${statistiques.tauxEclairage} %)`);
console.log(`  - Moyenne accidents          : ${statistiques.moyenneAccidents} (Période : ${statistiques.accidentPeriod})`);

console.log('\n  Répartition par type d\'axe :');
for (const [axe, nb] of Object.entries(statistiques.parRoute)) {
  console.log(`    • ${axe.padEnd(20)} : ${nb}`);
}

console.log('\n  Répartition par contexte territorial :');
for (const [ctx, nb] of Object.entries(statistiques.parContexte)) {
  console.log(`    • ${ctx.padEnd(20)} : ${nb}`);
}

console.log('\n  Répartition par niveau de circulation :');
for (const [niv, nb] of Object.entries(statistiques.parNiveau)) {
  console.log(`    • ${niv.padEnd(20)} : ${nb}`);
}

if (VERBOSE || DRY_RUN) {
  console.log('\n  Exemples de barrages générés :');
  barrages.slice(0, 5).forEach((b, i) => {
    console.log(`    [${i + 1}] ${b.id} | ${b.type} | ${b.name} | ${b.roadName} (${b.roadType}) | Acc: ${b.accidentCount} | Éclairé: ${b.isLighted ? 'Oui' : 'Non'} | Trafic: ${b.trafficLevel} | Lat: ${b.latitude}, Lng: ${b.longitude}`);
  });
}

if (DRY_RUN) {
  console.log('\n[DRY-RUN] Fin de la simulation. Aucun fichier n\'a été modifié.');
  console.log('Pour appliquer ces modifications, ajoutez le drapeau « --ecrire ».\n');
  process.exit(0);
}

// Écriture
const dossierSauvegarde = join(DOSSIER_DONNEES, 'sauvegardes');
mkdirSync(dossierSauvegarde, { recursive: true });
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const copieBkp = join(dossierSauvegarde, `marquages-pre-synthetique-${horodatage}.json`);
copyFileSync(fichierMarquages, copieBkp);
console.log(`\n  Sauvegarde créée : ${copieBkp}`);

let resultatFinal;
if (REMPLACER) {
  resultatFinal = [...reelsOuManuels, ...barrages];
  console.log(`  Remplacement effectué : ${anciensSynthetiques.length} anciens synthétiques purgés.`);
} else {
  // Fusion par ID
  const mapExistants = new Map(itemsExistants.map((m) => [m.id, m]));
  for (const b of barrages) {
    mapExistants.set(b.id, b);
  }
  resultatFinal = [...mapExistants.values()];
}

ecrireJsonAtomique(fichierMarquages, {
  version: versionInitiale,
  items: resultatFinal,
});

console.log(`\n  Base de données mise à jour avec succès : ${fichierMarquages}`);
console.log(`  Total marquages après insertion : ${resultatFinal.length} (${barrages.length} synthétiques)\n`);
