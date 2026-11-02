/**
 * Prépare le transfert vers un réseau sans internet : construit l'image Docker
 * de la carte (données comprises) et rassemble dans
 * `transfert/carte-gendarmerie-<version>/` tout ce qu'il faut pour l'installer.
 *
 *   npm run transfert                       image pour la plateforme de ce poste
 *   npm run transfert -- --plateforme linux/arm64
 *
 * À lancer sur ce poste (connecté une dernière fois : l'image de base Node et
 * les dépendances de compilation sont téléchargées par Docker), après
 * « npm run data » et « npm run gendarmerie ».
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELES = path.join(RACINE, 'docker');
const NOM = 'carte-gendarmerie';

/** Lance une commande, sortie visible ; rejette si elle échoue. */
function lancer(commande, args) {
  return new Promise((resolve, reject) => {
    const processus = spawn(commande, args, { cwd: RACINE, stdio: 'inherit' });
    processus.on('error', (erreur) => reject(new Error(`${commande} introuvable (${erreur.message})`)));
    processus.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${commande} ${args[0]} a échoué (code ${code})`))));
  });
}

/** Sortie texte d'une commande. */
function lire(commande, args) {
  return new Promise((resolve, reject) => {
    let sortie = '';
    const processus = spawn(commande, args, { cwd: RACINE });
    processus.stdout.on('data', (d) => { sortie += d; });
    processus.on('error', reject);
    processus.on('close', (code) => (code === 0 ? resolve(sortie.trim()) : reject(new Error(`${commande} ${args.join(' ')} : code ${code}`))));
  });
}

function empreinte(fichier) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(fichier).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

const remplir = (modele, valeurs) => Object.entries(valeurs).reduce((t, [cle, valeur]) => t.replaceAll(`__${cle}__`, valeur), modele);

async function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--plateforme');
  const plateformeDemandee = i >= 0 ? args[i + 1] : null;

  for (const [fichier, commande] of [['donnees/tiles/maroc.pmtiles', 'npm run data'], ['donnees/gendarmerie/rapport.json', 'npm run gendarmerie']]) {
    if (!existsSync(path.join(RACINE, fichier))) throw new Error(`${fichier} absent : lancez d'abord « ${commande} ».`);
  }
  // donnees/ entre tel quel dans l'image : un jeu de barages simulés y serait livré.
  const barages = path.join(RACINE, 'donnees', 'barages', 'barages.json');
  if (existsSync(barages) && JSON.parse(await readFile(barages, 'utf8')).simulation === true) {
    console.warn(`\n⚠ ${barages} contient des barages SIMULÉS : ils seront inclus dans l'image (marqués « Simulation »).`
      + '\n  Supprimez ce fichier avant « npm run transfert » s\'ils ne doivent pas être livrés.');
  }
  try {
    await lire('docker', ['info', '--format', '{{.ServerVersion}}']);
  } catch {
    throw new Error('Docker ne répond pas : démarrez Docker Desktop, puis relancez.');
  }

  const { version } = JSON.parse(await readFile(path.join(RACINE, 'package.json'), 'utf8'));
  const image = `${NOM}:${version}`;
  const archive = `${NOM}-${version}.tar`;
  const sortie = path.join(RACINE, 'transfert', `${NOM}-${version}`);

  console.log(`\n── Construction de l'image ${image} ──`);
  await lancer('docker', ['build', ...(plateformeDemandee ? ['--platform', plateformeDemandee] : []), '-t', image, '-t', `${NOM}:latest`, '.']);
  const plateforme = await lire('docker', ['image', 'inspect', image, '--format', '{{.Os}}/{{.Architecture}}']);

  console.log(`\n── Export de l'image (${plateforme}) ──`);
  await rm(sortie, { recursive: true, force: true });
  await mkdir(sortie, { recursive: true });
  await lancer('docker', ['save', '-o', path.join(sortie, archive), image]);

  const rapport = JSON.parse(await readFile(path.join(RACINE, 'donnees', 'gendarmerie', 'rapport.json'), 'utf8'));
  const dateDonnees = rapport.importeLe
    ? `couches importées le ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(rapport.importeLe))}`
    : 'date d’import inconnue';
  const valeurs = { IMAGE: image, ARCHIVE: archive, PLATEFORME: plateforme, DATE_DONNEES: dateDonnees };
  for (const nom of await readdir(MODELES)) {
    const texte = remplir(await readFile(path.join(MODELES, nom), 'utf8'), valeurs).replace(/\r\n/g, '\n');
    // Windows PowerShell 5 lit un script sans BOM comme du « ANSI » : BOM et fins de ligne CRLF pour .ps1.
    const contenu = nom.endsWith('.ps1') ? `﻿${texte.replace(/\n/g, '\r\n')}` : texte;
    await writeFile(path.join(sortie, nom), contenu);
  }

  const fichiers = (await readdir(sortie)).filter((f) => f !== 'SHA256SUMS').sort();
  const lignes = [];
  for (const f of fichiers) lignes.push(`${await empreinte(path.join(sortie, f))}  ${f}`);
  await writeFile(path.join(sortie, 'SHA256SUMS'), `${lignes.join('\n')}\n`);

  const taille = (await stat(path.join(sortie, archive))).size;
  console.log(`\nTransfert prêt : ${sortie}`);
  console.log(`  ${archive} (${(taille / 1e9).toFixed(2).replace('.', ',')} Go, ${plateforme}), docker-compose.yml, installer.sh, installer.ps1, LISEZMOI.md, SHA256SUMS`);
  console.log('Copiez ce dossier tel quel sur le réseau isolé, puis suivez LISEZMOI.md.');
}

principal().catch((erreur) => {
  console.error(`\nTransfert impossible : ${erreur.message}`);
  process.exit(1);
});
