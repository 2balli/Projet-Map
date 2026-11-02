#!/usr/bin/env node
/**
 * Paquet « sources hors ligne » : permet de RECONSTRUIRE l'application sur un
 * poste sans accès internet.
 *
 *   npm run package:sources
 *
 * Contient le projet complet AVEC node_modules, donc `npm install` n'est
 * jamais nécessaire sur la machine cible : les 209 Mo de dépendances sont
 * déjà là. C'est la méthode fiable pour un poste isolé — un `npm install`
 * hors ligne échouerait, le registre npm étant injoignable.
 *
 * Deux limites à connaître :
 *   - `node_modules` contient des binaires natifs (rolldown/esbuild pour Vite)
 *     compilés pour la plateforme actuelle. La cible doit donc avoir le même
 *     système et la même architecture (ici : Windows x64).
 *   - `data/` (86 Mo de GeoJSON brut) n'est inclus qu'avec --data ; il ne sert
 *     qu'à régénérer les couches, pas à compiler l'application.
 */
import { existsSync, mkdirSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = join(ROOT, 'carte-gendarmerie-sources.zip');
const AVEC_DATA = process.argv.includes('--data');

/** Ce qui part dans l'archive. */
const INCLURE = [
  'src',
  /* Le style du fond de carte (construireStyle) : importé par src/components/map/FondCarteVectoriel.jsx. */
  'maroc-carte-offline/src',
  'scripts',
  'public',
  'node_modules',
  'index.html',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'README.md',
  ...(AVEC_DATA ? ['data'] : []),
];

const manquants = INCLURE.filter((p) => !existsSync(join(ROOT, p)));
if (manquants.length) {
  console.error(`\nIntrouvable : ${manquants.join(', ')}\n`);
  process.exit(1);
}

/* Note de reconstruction, ajoutée à l'archive. */
const NOTE = join(ROOT, 'RECONSTRUIRE.txt');
writeFileSync(
  NOTE,
  `RECONSTRUIRE LA CARTE HORS LIGNE
${'='.repeat(50)}

Ce paquet contient node_modules : il n'y a AUCUN npm install a faire.
Un npm install echouerait de toute facon sans acces au registre npm.

PREREQUIS
  Node.js 18 ou superieur, Windows x64.
  Les binaires natifs de Vite sont compiles pour cette plateforme :
  sur un autre systeme, il faudrait refaire un npm install en ligne.

RECOMPILER L'APPLICATION
  npm run build          -> dist/
  npm run package        -> intranet/ + carte-gendarmerie-intranet.zip

REGENERER LES COUCHES DE DONNEES
  Necessite les fichiers sources dans data/ (inclus seulement si ce
  paquet a ete cree avec --data) :
  npm run build:layers   -> public/layers/*.geojson + _report.json

TRAVAILLER SUR LE CODE
  npm run dev            -> http://localhost:5173

FOND DE CARTE
  src/mapConfig.js       fond de carte hors ligne (chemin fond-carte/)

AJOUTER UNE COUCHE
  scripts/build-layers.mjs   tableau SOURCES  (quel fichier lire)
  src/layersConfig.js        affichage        (nom, couleur, defaut)
  Details dans README.md, section « Ajouter une couche ».
`.replace(/\n/g, '\r\n')
);

const mo = (n) => (n / 1048576).toFixed(1) + ' Mo';

const taille = (p) => {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  return readdirSync(p, { withFileTypes: true }).reduce(
    (t, e) => t + taille(join(p, e.name)),
    0
  );
};

console.log('\nContenu :');
let total = 0;
for (const p of [...INCLURE, 'RECONSTRUIRE.txt']) {
  const t = taille(join(ROOT, p));
  total += t;
  console.log(`  ${p.padEnd(20)} ${mo(t).padStart(10)}`);
}
console.log(`  ${'TOTAL'.padEnd(20)} ${mo(total).padStart(10)}`);

if (!AVEC_DATA) {
  console.log('\n  data/ exclu — ajoutez --data pour pouvoir régénérer les couches.');
}

console.log('\nCompression (long : ~10 000 fichiers)…');

rmSync(ZIP, { force: true });
const chemins = [...INCLURE, 'RECONSTRUIRE.txt'].map((p) => `'${join(ROOT, p)}'`).join(',');

try {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path ${chemins} -DestinationPath '${ZIP}' -CompressionLevel Optimal -Force`,
    ],
    { stdio: 'pipe', timeout: 15 * 60 * 1000 }
  );
  console.log(`\nArchive : carte-gendarmerie-sources.zip (${mo(statSync(ZIP).size)})`);
  console.log('À copier sur le poste isolé, puis décompresser et lancer `npm run build`.\n');
} catch (err) {
  console.error('\nCompression échouée : ' + String(err.message).split('\n')[0]);
  console.error('Copiez le projet tel quel (node_modules compris) sur le poste cible.\n');
  process.exit(1);
}
