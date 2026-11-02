/**
 * Serveur local hors ligne : sert l'application (`dist/`) et les données
 * (`donnees/`) sur http://localhost:5555, avec les requêtes partielles
 * (HTTP Range) dont les tuiles PMTiles ont besoin. Aucune dépendance.
 *
 *   node serveur.mjs              ouvre le navigateur
 *   node serveur.mjs --sans-navigateur
 *   PORT=9000 node serveur.mjs
 *   HOTE=0.0.0.0 node serveur.mjs   accessible aux autres postes du réseau local
 *   ETAT=/chemin node serveur.mjs    dossier des comptes, conflits et du journal (défaut : etat/, jamais servi)
 *   HTTPS=1                          cookie de session « Secure » (derrière un proxy HTTPS)
 *
 * /api/… : comptes, rôles et conflits d'optimisation (serveur/api.mjs), droits vérifiés ici.
 */
import { createReadStream, existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { creerApi, lireEtat } from './serveur/api.mjs';

const RACINE = path.dirname(fileURLToPath(import.meta.url));
const DOSSIERS = [path.join(RACINE, 'dist'), path.join(RACINE, 'donnees')];
const PORT = Number(process.env.PORT) || 5555;
const HOTE = process.env.HOTE || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
  '.pmtiles': 'application/octet-stream',
  '.woff2': 'font/woff2',
};

/** Résout un chemin d'URL vers un fichier de l'un des dossiers servis, sans en sortir. */
export async function resoudre(cheminUrl, dossiers = DOSSIERS) {
  let relatif;
  try {
    relatif = decodeURIComponent(cheminUrl.split('?')[0]);
  } catch {
    return null;
  }
  if (relatif.includes('\0')) return null;
  if (relatif.endsWith('/')) relatif += 'index.html';
  for (const dossier of dossiers) {
    const fichier = path.resolve(dossier, `.${path.posix.normalize(`/${relatif}`)}`);
    if (fichier !== dossier && !fichier.startsWith(dossier + path.sep)) continue;
    try {
      const infos = await stat(fichier);
      if (infos.isFile()) return { fichier, taille: infos.size, modifie: infos.mtimeMs };
    } catch { /* absent de ce dossier */ }
  }
  return null;
}

/** « bytes=0-99 » → { debut, fin } ; null si la plage est invalide. */
export function lirePlage(entete, taille) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(entete || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let debut, fin;
  if (m[1] === '') { // suffixe : les N derniers octets
    debut = Math.max(0, taille - Number(m[2]));
    fin = taille - 1;
  } else {
    debut = Number(m[1]);
    fin = m[2] === '' ? taille - 1 : Math.min(Number(m[2]), taille - 1);
  }
  return debut <= fin && debut < taille ? { debut, fin } : null;
}

/** Empreinte d'un fichier (taille + date de modification) : change dès que le fichier est régénéré. */
export const etiquette = ({ taille, modifie }) => `W/"${taille.toString(36)}-${Math.floor(modifie).toString(36)}"`;

/** La copie du navigateur (If-None-Match) est-elle encore celle du fichier ? */
export function inchange(entete, etag) {
  if (!entete) return false;
  return String(entete).split(',').map((v) => v.trim()).some((v) => v === '*' || v === etag || v === etag.slice(2));
}

/**
 * @param {string[]} dossiers  dossiers servis, dans l'ordre
 * @param {{ api?: (req, res) => Promise<boolean> }} options  API (/api/…) traitée avant les
 *   fichiers ; sa garde (`api.garde`) décide de l'accès à chaque fichier (session, région).
 */
export function creerServeur(dossiers = DOSSIERS, { api = null } = {}) {
  const dossierApp = realpath(dossiers[0]).catch(() => dossiers[0]); // canonique, comme les fichiers
  return createServer(async (req, res) => {
    if (api && (await api(req, res))) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const chemin = new URL(req.url, 'http://local').pathname;
    const cible = await resoudre(chemin, dossiers);
    if (api?.garde) {
      // Décision sur le fichier réellement servi (chemin canonique : casse, liens, « ..%2f »),
      // pas sur l'URL : une variante d'écriture ne contourne ni la session ni le filtre régional.
      const fichier = cible ? await realpath(cible.fichier).catch(() => null) : null;
      const decision = await api.garde(req, { chemin, fichier, publique: fichierPublic(fichier, await dossierApp) });
      if (await servirSelonGarde(req, res, decision)) return;
    }
    if (!cible) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    // no-cache : le navigateur redemande toujours (les données peuvent être régénérées),
    // mais un fichier inchangé ne repart pas : 304 sans contenu.
    const etag = etiquette(cible);
    const entetes = {
      'Content-Type': TYPES[path.extname(cible.fichier).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': new Date(cible.modifie).toUTCString(),
    };
    if (!req.headers.range && inchange(req.headers['if-none-match'], etag)) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', 'Last-Modified': entetes['Last-Modified'] }).end();
      return;
    }
    let debut = 0, fin = cible.taille - 1, statut = 200;
    if (req.headers.range) {
      const plage = lirePlage(req.headers.range, cible.taille);
      if (!plage) {
        res.writeHead(416, { 'Content-Range': `bytes */${cible.taille}` }).end();
        return;
      }
      ({ debut, fin } = plage);
      statut = 206;
      entetes['Content-Range'] = `bytes ${debut}-${fin}/${cible.taille}`;
    }
    entetes['Content-Length'] = cible.taille === 0 ? 0 : fin - debut + 1;
    res.writeHead(statut, entetes);
    if (req.method === 'HEAD' || cible.taille === 0) return res.end();
    createReadStream(cible.fichier, { start: debut, end: fin }).pipe(res);
  });
}

/**
 * Servi sans session : la page de connexion et les ressources construites (`assets/` de
 * l'application : code, styles, logo — aucune donnée). `fichier` : chemin canonique.
 */
export function fichierPublic(fichier, dossierApp) {
  if (!fichier) return false;
  const meme = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const dans = (f, d) => meme(f.slice(0, d.length + 1), d + path.sep);
  return meme(fichier, path.join(dossierApp, 'connexion.html')) || dans(fichier, path.join(dossierApp, 'assets'));
}

/** Applique la décision de la garde ; false : le fichier est servi normalement. */
function servirSelonGarde(req, res, decision) {
  if (decision.suite) return false;
  const prive = { 'Cache-Control': 'private, no-cache', Vary: 'Cookie' };
  if (decision.redirection) res.writeHead(302, { Location: decision.redirection, 'Cache-Control': 'no-store' }).end();
  else if (decision.refus) {
    const textes = { 401: 'Connexion requise', 403: 'Accès refusé', 404: 'Introuvable' };
    res.writeHead(decision.refus, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(textes[decision.refus] ?? 'Refusé');
  } else {
    // Contenu filtré pour la région du compte : jamais partagé entre comptes.
    const { corps, etag } = decision.contenu;
    if (inchange(req.headers['if-none-match'], etag)) res.writeHead(304, { ETag: etag, ...prive }).end();
    else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': corps.length, ETag: etag, ...prive });
      res.end(req.method === 'HEAD' ? undefined : corps);
    }
  }
  return true;
}

function ouvrirNavigateur(url) {
  const [commande, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(commande, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(path.join(RACINE, 'dist', 'index.html'))) {
    console.error('Application non compilée : lancez d’abord « npm run build ».');
    process.exit(1);
  }
  if (!existsSync(path.join(RACINE, 'donnees', 'tiles', 'maroc.pmtiles'))) {
    console.error('Données absentes : lancez d’abord « npm run data » (connexion requise une seule fois).');
    process.exit(1);
  }
  const api = creerApi({
    dossierEtat: process.env.ETAT || path.join(RACINE, 'etat'),
    dossierDonnees: path.join(RACINE, 'donnees'),
    secure: process.env.HTTPS === '1',
  });
  const serveur = creerServeur(DOSSIERS, { api });
  serveur.on('error', (erreur) => {
    if (erreur.code !== 'EADDRINUSE') throw erreur;
    console.error(`Le port ${PORT} est déjà utilisé : la carte est sans doute déjà ouverte (http://localhost:${PORT}/).
`
      + 'Sinon, choisissez un autre port : set "PORT=9000" && node serveur.mjs');
    process.exit(1);
  });
  serveur.listen(PORT, HOTE, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`Gendarmerie Royale — carte hors ligne : ${url}\n(Ctrl+C pour arrêter)`);
    if (!existsSync(path.join(RACINE, 'donnees', 'gendarmerie', 'rapport.json'))) {
      console.log('Couches Gendarmerie absentes : lancez « npm run gendarmerie » pour les importer.');
    }
    lireEtat(process.env.ETAT || path.join(RACINE, 'etat')).then((e) => {
      if (!e.comptes.length) console.log('Aucun compte : la carte est fermée. Créez les comptes : npm run comptes -- initialiser');
    }).catch(() => {});
    if (!process.argv.includes('--sans-navigateur')) ouvrirNavigateur(url);
  });
}
