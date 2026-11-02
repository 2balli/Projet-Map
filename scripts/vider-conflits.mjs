#!/usr/bin/env node
/**
 * VIDER / PURGER LES CONFLITS ENREGISTRÉS — base de données et cache.
 *
 * Réinitialise tous les fichiers de suivi des conflits et conflits de planification
 * à l'état vierge `{ version: 1, items: [] }` tout en conservant une sauvegarde
 * horodatée de sécurité.
 *
 * Usage :
 *   node scripts/vider-conflits.mjs
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DOSSIERS = [
  join(ROOT, 'donnees-demo'),
  join(ROOT, 'donnees-serveur'),
  join(ROOT, 'donnees-production'),
  join(ROOT, 'intranet-demo', 'donnees-serveur'),
  join(ROOT, 'intranet-production', 'donnees-serveur'),
];

const FICHIERS = ['suivi-conflits.json', 'conflits-planification.json'];

const horodatage = () => new Date().toISOString().replace(/[:.]/g, '-');

let totalVides = 0;

console.log('\n=== PURGE DE TOUS LES CONFLITS (BASE ET CACHE) ===\n');

for (const dossier of DOSSIERS) {
  if (!existsSync(dossier)) continue;

  const dossierSauvegarde = join(dossier, 'sauvegardes');
  mkdirSync(dossierSauvegarde, { recursive: true });

  for (const fichierNom of FICHIERS) {
    const cheminFichier = join(dossier, fichierNom);
    if (!existsSync(cheminFichier)) {
      // Créer fichier vierge si absent
      writeFileSync(cheminFichier, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf8');
      console.log(`  [INIT]   ${dossier.replace(ROOT, '')}\\${fichierNom} -> initialisé à vide.`);
      continue;
    }

    try {
      const brut = readFileSync(cheminFichier, 'utf8');
      const data = JSON.parse(brut);
      const nbItems = (data.items ?? []).length;

      // Sauvegarde horodatée avant vidage
      const cheminSauvegarde = join(dossierSauvegarde, `${fichierNom}.${horodatage()}`);
      copyFileSync(cheminFichier, cheminSauvegarde);

      // Réinitialisation atomique
      writeFileSync(cheminFichier, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf8');
      console.log(
        `  [PURGE]  ${dossier.replace(ROOT, '')}\\${fichierNom} (${nbItems} conflits) -> vidé (sauvegarde : ${fichierNom}.${horodatage()})`
      );
      totalVides += nbItems;
    } catch (err) {
      console.error(`  [ERREUR] ${cheminFichier} : ${err.message}`);
    }
  }
}

console.log(`\nSuccès : ${totalVides} conflit(s) retiré(s) de la base et du cache.\n`);
