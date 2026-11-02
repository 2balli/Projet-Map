#!/usr/bin/env node
/**
 * Téléchargement du réseau routier depuis OpenStreetMap (API Overpass).
 *
 *   node scripts/fetch-roads.mjs                -> data/routes/*.json
 *   node scripts/fetch-roads.mjs --pays MA
 *
 * À LANCER SUR UN POSTE AVEC ACCÈS INTERNET, une fois — puis
 * `node scripts/build-roads.mjs` transforme ces fichiers en couches et en
 * graphe. Le serveur intranet ne fait aucun appel sortant : il ne reçoit que
 * le produit fini.
 *
 * Les fichiers bruts (~65 Mo) restent dans data/ : ils ne sont ni livrés ni
 * chargés par le navigateur.
 */
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = join(ROOT, 'data/routes');

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const PAYS = arg('pays', 'MA');
const SERVEUR = arg('serveur', 'https://overpass-api.de/api/interpreter');

/**
 * Trois requêtes plutôt qu'une : Overpass abandonne les requêtes trop longues,
 * et découper par type de voie garde chaque réponse sous ~40 Mo. En cas
 * d'échec, seul le lot concerné est à relancer.
 */
const LOTS = [
  { nom: 'motorway.json', filtre: '^(motorway)$', libelle: 'autoroutes' },
  {
    nom: 'primaire.json',
    filtre: '^(trunk|trunk_link|motorway_link|primary|primary_link)$',
    libelle: 'nationales et bretelles',
  },
  { nom: 'secondaire.json', filtre: '^(secondary|secondary_link)$', libelle: 'régionales' },
  /**
   * Les provinciales sont majoritairement en `tertiary`, dont le volume complet
   * fait abandonner Overpass (504). D'où `refOnly` : seules les voies PORTANT
   * une référence sont demandées — ce sont précisément les RP signalées sur le
   * terrain, à l'exclusion des dessertes et pistes sans numéro.
   */
  {
    nom: 'tertiaire.json',
    filtre: '^(tertiary|tertiary_link|unclassified)$',
    libelle: 'provinciales',
    refOnly: true,
  },
];

const requete = (filtre, refOnly) => `[out:json][timeout:900];
area["ISO3166-1"="${PAYS}"][admin_level=2]->.pays;
way(area.pays)["highway"~"${filtre}"]${refOnly ? '["ref"]' : ''};
out geom;`;

mkdirSync(SORTIE, { recursive: true });

console.log(`\nTéléchargement du réseau routier — pays ${PAYS}`);
console.log(`Source : ${SERVEUR}\n`);

for (const lot of LOTS) {
  const debut = Date.now();
  process.stdout.write(`  ${lot.libelle.padEnd(26)} `);

  let reponse;
  try {
    reponse = await fetch(SERVEUR, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: requete(lot.filtre, lot.refOnly),
    });
  } catch (err) {
    console.log(`échec réseau : ${err.message}`);
    continue;
  }

  if (!reponse.ok) {
    // 429 / 504 : le serveur public est saturé. Réessayer plus tard, ou viser
    // une autre instance avec --serveur.
    console.log(`HTTP ${reponse.status} — lot non récupéré`);
    continue;
  }

  const texte = await reponse.text();

  /** Contrôle avant écriture : une réponse tronquée ne doit pas remplacer
   *  un fichier valide déjà présent. */
  let elements;
  try {
    elements = JSON.parse(texte).elements?.length ?? 0;
  } catch {
    console.log('réponse illisible (JSON incomplet) — lot ignoré');
    continue;
  }

  const chemin = join(SORTIE, lot.nom);
  writeFileSync(chemin, texte);

  console.log(
    `${String(elements).padStart(6)} voies, ` +
      `${(statSync(chemin).size / 1048576).toFixed(1)} Mo, ` +
      `${((Date.now() - debut) / 1000).toFixed(0)} s`
  );
}

console.log('\nEnchaînez avec :  node scripts/build-roads.mjs\n');
