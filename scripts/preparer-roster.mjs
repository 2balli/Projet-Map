#!/usr/bin/env node
/**
 * PRÉPARER LE ROSTER EN LIGNE DE COMMANDE.
 *
 * Le service prépare seul — au démarrage puis toutes les heures — et
 * l'administrateur peut relancer depuis le panneau. Restait un trou : après un
 * chargement d'effectif ou une correction de `composition-barrage.json`, il
 * fallait redémarrer le service ou ouvrir l'application pour que la journée
 * soit refaite. Une commande fait le travail sans ni l'un ni l'autre.
 *
 * MÊMES MODULES QUE LE SERVICE, pas une seconde implémentation : ce script
 * charge `serveur/roster.mjs` et les dépôts, et appelle exactement ce que
 * l'API appelle. Deux mécaniques de préparation finiraient par diverger, et
 * l'on ne saurait plus laquelle a produit la journée qu'on lit.
 *
 *   node scripts/preparer-roster.mjs                aujourd'hui et demain
 *   node scripts/preparer-roster.mjs --remplacer    refait ce qui est proposé
 *   node scripts/preparer-roster.mjs --date 2026-09-03
 *
 * `--remplacer` n'efface QUE les lignes proposées, et jamais dans un créneau
 * où un chef est intervenu (voir `retirerPreparation` dans elements.mjs).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { creerDepotElements } from '../serveur/elements.mjs';
import { creerDepotEffectifs } from '../serveur/effectifs.mjs';
import { chargerComposition, preparerJournee, dateLocale, lendemain } from '../serveur/roster.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-serveur')));
const REMPLACER = drapeau('remplacer');

const fichier = (n) => join(DONNEES, n);
if (!existsSync(fichier('marquages.json'))) {
  console.error(`\nIntrouvable : ${fichier('marquages.json')}\n`);
  process.exit(1);
}

const barrages = JSON.parse(readFileSync(fichier('marquages.json'), 'utf8')).items ?? [];
const depotElements = creerDepotElements(fichier('elements.json'));
const depotEffectifs = creerDepotEffectifs(fichier('effectifs.json'));
const composition = chargerComposition(fichier('composition-barrage.json'));

/**
 * Le même auteur que la préparation automatique du service : on doit pouvoir
 * distinguer une ligne proposée d'une relève tapée par un chef, quelle que
 * soit la voie par laquelle la proposition est arrivée.
 */
const AUTEUR = {
  matricule: 'SYSTEME',
  nom: 'Préparation automatique',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
  cie: null,
};

const jours = valeur('date', null)
  ? [valeur('date', null)]
  : [dateLocale(new Date()), lendemain(new Date())];

console.log('');
for (const date of jours) {
  const r = preparerJournee({
    date,
    effectifs: depotEffectifs,
    barrages,
    composition,
    depotElements,
    auteur: AUTEUR,
    remplacer: REMPLACER,
  });

  console.log(`${date}`);
  if (r.remplacement) {
    console.log(
      `  effacé      : ${r.remplacement.retires} ligne(s) proposée(s)` +
        `  (${r.remplacement.creneauxHumains} créneau(x) tenus par un chef laissés intacts)`
    );
  }
  console.log(`  proposé     : ${r.ajoutes} ligne(s) sur ${r.barrages} poste(s) de ${r.brigades} brigade(s)`);
  console.log(`  déjà occupé : ${r.creneauxOccupes} créneau(x)`);
  console.log(`  sans effectif : ${r.sansEffectif.length} brigade(s)`);
  if (r.manquesTotalHommes) {
    const ou = r.manquesParBrigade
      .slice(0, 3)
      .map((m) => `${m.bt} ${m.hommes}`)
      .join(', ');
    console.log(`  manque      : ${r.manquesTotalHommes} homme(s)${ou ? ` — surtout ${ou}` : ''}`);
  } else {
    console.log('  manque      : aucun — toutes les compositions sont honorées');
  }
  console.log('');
}

console.log('Redémarrez le service pour que les postes le voient.\n');
