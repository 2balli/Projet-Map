#!/usr/bin/env node
/**
 * Serveur du déploiement intranet : fichiers statiques + API d'habilitation.
 *
 * AUCUNE dépendance : uniquement les modules internes de Node. Il n'y a donc
 * rien à installer sur le serveur cible — Node suffit.
 *
 *   node serve.mjs                 -> http://0.0.0.0:8080, sert ./dist
 *   node serve.mjs --port 8090
 *   node serve.mjs --root ./dist --host 127.0.0.1
 *   node serve.mjs --donnees ./donnees-serveur   (comptes + marquages + alertes)
 *   node serve.mjs --seuil-barrages 25            (distance minimale entre barrages, km)
 *   node serve.mjs --seuil-conflit-km 40          (contrôle de distance de « Modifier barrage », km)
 *   node serve.mjs --n8n http://192.168.0.6:5678/webhook/carte-optimisation
 *   node serve.mjs --ollama http://192.168.0.6:11434 --modele llama3.1
 *
 * Les deux dernières activent l'ASSISTANT D'ANALYSE du panneau Optimisation —
 * le seul appel sortant du service, et il n'a lieu que si on le configure. Voir
 * serveur/assistant.mjs. Équivalents en variables d'environnement :
 * GR_N8N_URL, GR_OLLAMA_URL, GR_OLLAMA_MODELE.
 *
 * L'API (/api/...) authentifie les chefs de compagnie et de région et applique
 * les règles d'écriture des marquages — voir serveur/api.mjs. Sans elle,
 * l'application reste consultable mais la saisie est indisponible : c'est le
 * prix d'une habilitation qui ne se contourne pas depuis le navigateur.
 */
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, resolve, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

/* ---------------------------- arguments ---------------------------- */

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

const ICI = dirname(fileURLToPath(import.meta.url));
const PORT = Number(arg('port', 8080));
const HOST = arg('host', '0.0.0.0');
const ROOT = resolve(arg('root', existsSync(join(ICI, 'dist')) ? join(ICI, 'dist') : 'dist'));
const DONNEES = resolve(arg('donnees', existsSync(join(ICI, 'donnees-serveur')) ? join(ICI, 'donnees-serveur') : 'donnees-serveur'));
const SEUIL_BARRAGES_KM = Number(arg('seuil-barrages', 20));
/* Seuil du contrôle de distance de « Modifier barrage » (km de route) — voir serveur/modificationBarrage.mjs. */
const SEUIL_CONFLIT_KM = Number(arg('seuil-conflit-km', 40));

/**
 * LE FOND DE CARTE — celui de `maroc-carte-offline` : une archive PMTiles
 * (`tiles/maroc.pmtiles`), ses polices (`fonts/`), ses sprites (`sprites/`) et
 * ses limites de régions (`data/`). Servi sous `/fond-carte/`, AVEC les
 * requêtes partielles (`Range`) : MapLibre lit l'archive de 550 Mo par
 * morceaux, jamais en entier.
 *
 * Cherché à côté du script (`./fond-carte`, paquet livré), puis dans le dépôt.
 */
const FOND_CARTE = resolve(
  arg(
    'fond-carte',
    [join(ICI, 'fond-carte'), join(ICI, '..', 'maroc-carte-offline', 'donnees'), join(ICI, 'maroc-carte-offline', 'donnees')].find(
      (d) => existsSync(join(d, 'tiles', 'maroc.pmtiles')),
    ) ?? join(ICI, '..', 'maroc-carte-offline', 'donnees'),
  ),
);
const PREFIXE_FOND = '/fond-carte/';

/**
 * MODE DÉCLARÉ — `demo` ou `production`, et il doit correspondre aux données.
 *
 * Le contrôle a lieu AVANT tout le reste : un service qui refuse de démarrer
 * vaut mieux qu'un service qui écrit au mauvais endroit. Voir
 * `serveur/mode.mjs` pour le raisonnement complet.
 */
const MODE_DECLARE = arg('mode', null);

if (!existsSync(ROOT)) {
  console.error(`\nRépertoire introuvable : ${ROOT}`);
  console.error("Lancez d'abord `npm run build`, ou passez --root <dossier>.\n");
  process.exit(1);
}

/* --------------------- Mode : démonstration ou production -------------- */

/**
 * LE CONTRÔLE DU MODE EST LA PREMIÈRE CHOSE QUE FAIT LE SERVICE.
 *
 * Avant d'ouvrir un port, avant de lire un compte. Si le dossier de données ne
 * porte pas le mode qu'on déclare, on s'arrête — c'est ce qui empêche une
 * séance de démonstration d'écrire dans le dispositif réel.
 *
 * Le module est cherché aux deux emplacements possibles, comme l'API : à côté
 * de ce fichier dans le paquet livré, sous `../serveur/` dans le dépôt.
 */
let MODE = null;
let MODE_LIBELLE = null;
{
  const ici = dirname(fileURLToPath(import.meta.url));
  let modeModule = null;
  for (const candidat of ['./serveur/mode.mjs', '../serveur/mode.mjs']) {
    const chemin = resolve(ici, candidat);
    if (!existsSync(chemin)) continue;
    modeModule = await import(`file://${chemin.replace(/\\/g, '/')}`);
    break;
  }

  if (!modeModule && MODE_DECLARE) {
    console.error('\n  ARRÊT — --mode demandé mais serveur/mode.mjs est introuvable.\n');
    process.exit(1);
  }

  if (modeModule) {
    try {
      const verdict = modeModule.controlerMode(DONNEES, MODE_DECLARE);
      MODE = verdict.mode;
      MODE_LIBELLE = MODE ? modeModule.libelleMode(MODE) : null;
      if (verdict.avertissement) console.warn(`\n  ! ${verdict.avertissement}`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }
}

/* ------------------------- API d'habilitation ------------------------- */

/**
 * Le module d'API est cherché aux deux emplacements possibles : à côté de ce
 * fichier (paquet intranet, `serveur/` copié à la racine) ou dans le dépôt
 * (`../serveur/`). Chargement dynamique et non `import` statique : si le
 * dossier manque, le serveur doit continuer à servir la carte en consultation
 * plutôt que refuser de démarrer.
 */
async function chargerApi() {
  for (const candidat of ['./serveur/api.mjs', '../serveur/api.mjs']) {
    const chemin = resolve(ICI, candidat);
    if (!existsSync(chemin)) continue;
    const { creerApi } = await import(`file://${chemin.replace(/\\/g, '/')}`);
    return creerApi({
      fichierComptes: join(DONNEES, 'comptes.json'),
      fichierMarquages: join(DONNEES, 'marquages.json'),
      fichierJournal: join(DONNEES, 'journal.jsonl'),
      fichierAlertes: join(DONNEES, 'alertes.json'),
      fichierConflits: join(DONNEES, 'conflits-planification.json'),
      fichierRegles: join(DONNEES, 'regles.json'),
      fichierMissions: join(DONNEES, 'missions.json'),
      fichierInstructions: join(DONNEES, 'instructions.json'),
      fichierDemandes: join(DONNEES, 'demandes-approbation.json'),
      fichierNotifications: join(DONNEES, 'notifications.json'),
      fichierElements: join(DONNEES, 'elements.json'),
      fichierEffectifs: join(DONNEES, 'effectifs.json'),
      fichierComposition: join(DONNEES, 'composition-barrage.json'),
      /**
       * ASSISTANT D'ANALYSE — le seul appel sortant possible, et il est optionnel.
       *
       * Non renseigné, le service reste sans appel extérieur et le bouton
       * n'apparaît pas dans le panneau Optimisation. Les valeurs peuvent venir
       * de l'environnement, ce qui évite de les écrire dans une ligne de
       * commande visible de tous (`ps`, journal du gestionnaire de services).
       *
       *   node serve.mjs --n8n http://192.168.0.6:5678/webhook/carte-optimisation
       *   node serve.mjs --ollama http://192.168.0.6:11434 --modele llama3.1
       */
      assistant: {
        n8n: arg('n8n', process.env.GR_N8N_URL ?? ''),
        ollama: arg('ollama', process.env.GR_OLLAMA_URL ?? ''),
        modele: arg('modele', process.env.GR_OLLAMA_MODELE ?? 'llama3.1'),
      },
      // Les contours et le graphe routier servant aux contrôles sont ceux qui sont livrés.
      racineCouches: join(ROOT, 'layers'),
      seuilBarragesKm: SEUIL_BARRAGES_KM,
      seuilConflitKm: SEUIL_CONFLIT_KM,
      /* Le mode part jusqu'à l'écran : un bandeau permanent dit « DÉMONSTRATION »
         pour qu'on ne prenne jamais des données fictives pour de vraies. */
      mode: MODE,
    });
  }
  return null;
}

const api = await chargerApi();

/* --------------------------- en-têtes de sûreté ---------------------- */

/**
 * TROIS EN-TÊTES, ET CE QUE CHACUN EMPÊCHE.
 *
 * L'audit n'en trouvait qu'un (`nosniff`). Les deux autres manquaient, et
 * chacun ferme une porte qui n'a aucune raison de rester ouverte sur un
 * intranet :
 *
 * `X-Content-Type-Options: nosniff`
 *     le navigateur ne devine pas le type d'un fichier. Sans cela, un fichier
 *     servi en texte mais contenant du script peut être exécuté comme tel.
 *
 * `X-Frame-Options: DENY`
 *     l'application ne peut pas être enfermée dans le cadre d'une autre page.
 *     C'est la parade au détournement de clic : une page tierce superpose ses
 *     propres boutons aux nôtres, et l'utilisateur croit cliquer sur l'une
 *     alors qu'il agit sur l'autre. Sur une application qui pose et retire des
 *     barrages, ce n'est pas théorique.
 *
 * `Content-Security-Policy`
 *     dit d'où le code, les styles et les images peuvent venir. Tout est
 *     livré par CE serveur, fond de carte compris (`/fond-carte/`). On
 *     l'écrit, et le navigateur refuse le reste — y compris un script injecté
 *     par une donnée mal filtrée. `worker-src blob:` : MapLibre dessine le fond
 *     dans des workers qu'il crée à partir d'un blob.
 *
 * `'unsafe-inline'` est nécessaire pour les styles : Leaflet et les icônes de
 * carte posent des styles en attribut. Il n'est PAS accordé aux scripts, qui
 * sont tous des fichiers de `dist/assets/`.
 *
 * Pas de `Strict-Transport-Security` : le service est en HTTP sur un intranet,
 * et cet en-tête n'aurait aucun effet — sinon d'annoncer une protection qui
 * n'existe pas.
 */
const ENTETES_SURETE = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/* ------------------------------ types ------------------------------ */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
  '.pbf': 'application/x-protobuf',
  '.bin': 'application/octet-stream',
};

/**
 * Le fond de carte : fichier sous FOND_CARTE, requêtes partielles honorées.
 * Renvoie `true` si la requête lui était destinée (servie ou refusée).
 */
function servirFond(req, res, chemin) {
  const pos = chemin.indexOf(PREFIXE_FOND);
  if (pos < 0) return false;
  const relatif = chemin.slice(pos + PREFIXE_FOND.length);
  const cible = normalize(join(FOND_CARTE, relatif));
  if (!cible.startsWith(FOND_CARTE + sep)) {
    res.writeHead(403).end('403 Forbidden');
    return true;
  }
  let info;
  try {
    info = statSync(cible);
    if (!info.isFile()) throw new Error('pas un fichier');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...ENTETES_SURETE }).end(`404 Not Found : ${relatif}`);
    return true;
  }
  const entetes = {
    'Content-Type': TYPES[extname(cible).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    /* Les tuiles ne changent qu'à un nouveau téléchargement : revalidées, jamais périmées en silence. */
    'Cache-Control': 'no-cache',
    'Last-Modified': info.mtime.toUTCString(),
    ...ENTETES_SURETE,
  };
  const plage = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (plage && (plage[1] || plage[2])) {
    let debut = plage[1] ? Number(plage[1]) : info.size - Number(plage[2]);
    let fin = plage[1] && plage[2] ? Number(plage[2]) : info.size - 1;
    debut = Math.max(0, debut);
    fin = Math.min(fin, info.size - 1);
    if (debut > fin) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}`, ...ENTETES_SURETE }).end();
      return true;
    }
    res.writeHead(206, { ...entetes, 'Content-Range': `bytes ${debut}-${fin}/${info.size}`, 'Content-Length': fin - debut + 1 });
    if (req.method === 'HEAD') return res.end(), true;
    createReadStream(cible, { start: debut, end: fin }).on('error', () => res.destroy()).pipe(res);
    return true;
  }
  res.writeHead(200, { ...entetes, 'Content-Length': info.size });
  if (req.method === 'HEAD') return res.end(), true;
  createReadStream(cible).on('error', () => res.destroy()).pipe(res);
  return true;
}

/* ----------------------------- serveur ----------------------------- */

const server = createServer(async (req, res) => {
  /**
   * L'application appelle l'API en chemin RELATIF (`api/session`), pour rester
   * déployable dans un sous-répertoire. Une requête peut donc arriver en
   * `/carte/api/session` : on ramène le chemin à `/api/...` avant de router,
   * sinon la saisie ne fonctionnerait qu'à la racine du site.
   */
  const posApi = req.url.indexOf('/api/');
  if (posApi > 0) req.url = req.url.slice(posApi);

  /* L'API passe avant le statique : elle seule accepte POST/PATCH/DELETE. */
  if (api && req.url.startsWith('/api/')) {
    if (await api(req, res)) return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('405 Method Not Allowed');
    return;
  }

  /* Sans API chargée, une requête /api/ doit être franche plutôt que de
     renvoyer index.html : le client saurait alors que la saisie est absente. */
  if (!api && req.url.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }).end(
      JSON.stringify({ erreur: "Service d'habilitation absent : serveur/ n'a pas été livré." })
    );
    return;
  }

  let chemin;
  try {
    chemin = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('400 Bad Request');
    return;
  }

  if (servirFond(req, res, chemin)) return;

  if (chemin.endsWith('/')) chemin += 'index.html';

  /**
   * Protection contre la traversée de répertoire : le chemin résolu doit
   * rester strictement sous ROOT. Sans ce contrôle, une requête du type
   * /../../etc/passwd sortirait du dossier servi.
   */
  const cible = normalize(join(ROOT, chemin));
  if (cible !== ROOT && !cible.startsWith(ROOT + sep)) {
    res.writeHead(403).end('403 Forbidden');
    return;
  }

  let info;
  try {
    info = statSync(cible);
    if (info.isDirectory()) throw new Error('répertoire');
  } catch {
    /**
     * Repli sur index.html uniquement pour une navigation (chemin sans
     * extension). Un fichier demandé explicitement — couche .geojson, script,
     * feuille de style — doit renvoyer un vrai 404.
     *
     * Sans cette distinction, une couche absente répondrait 200 avec du HTML :
     * le `fetch` échouerait sur une erreur d'analyse JSON incompréhensible au
     * lieu d'un franc « HTTP 404 », rendant tout diagnostic pénible.
     */
    const repli = join(ROOT, 'index.html');
    if (!extname(chemin) && existsSync(repli)) {
      envoyer(res, repli, statSync(repli), req.method === 'HEAD');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(
      `404 Not Found : ${chemin}`
    );
    return;
  }

  envoyer(res, cible, info, req.method === 'HEAD');
});

function envoyer(res, fichier, info, headOnly) {
  const ext = extname(fichier).toLowerCase();

  /**
   * Les fichiers d'`assets/` portent une empreinte dans leur nom (index-a1b2.js) :
   * ils peuvent être mis en cache indéfiniment. index.html et les couches
   * doivent au contraire être revalidés, sinon une mise à jour des données ne
   * serait jamais visible par les postes clients.
   */
  const empreinte = /[.-][0-9a-zA-Z_-]{8,}\.(js|css)$/.test(fichier);

res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': empreinte ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...ENTETES_SURETE,
  });

  if (headOnly) {
    res.end();
    return;
  }

  createReadStream(fichier)
    .on('error', () => res.destroy())
    .pipe(res);
}

/* ---------------------------- démarrage ---------------------------- */

server.listen(PORT, HOST, () => {
  console.log('\n  Carte tactique — Gendarmerie Royale');
  console.log(`  Racine : ${ROOT}`);

  /* LE MODE EN PREMIER, et en capitales : c'est la première chose à vérifier
     quand on doute de ce qu'on a lancé. */
  if (MODE_LIBELLE) console.log(`  MODE   : ${MODE_LIBELLE}`);
  console.log(
    existsSync(join(FOND_CARTE, 'tiles', 'maroc.pmtiles'))
      ? `  Fond   : ${FOND_CARTE}`
      : `  ! Fond de carte absent (${FOND_CARTE}) : lancez « npm run data » dans maroc-carte-offline, ou passez --fond-carte <dossier>.`,
  );

  if (api) {
    console.log(`  API    : /api  (habilitation + marquages)`);
    console.log(`  Données: ${DONNEES}`);
    if (!existsSync(join(DONNEES, 'comptes.json'))) {
      console.log('\n  ! Aucun compte : la saisie sera refusée à tout le monde.');
      console.log('    Créez-les avec :  node scripts/comptes.mjs --initialiser');
    }
  } else {
    console.log('  API    : absente — consultation seule, saisie indisponible');
  }
  console.log('');
  console.log(`  Local   : http://localhost:${PORT}/`);

  if (HOST === '0.0.0.0') {
    for (const cartes of Object.values(networkInterfaces())) {
      for (const c of cartes ?? []) {
        if (c.family === 'IPv4' && !c.internal) {
          console.log(`  Réseau  : http://${c.address}:${PORT}/`);
        }
      }
    }
  }

  console.log('\n  Ctrl+C pour arrêter.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nLe port ${PORT} est déjà utilisé. Essayez --port ${PORT + 1}.\n`);
  } else {
    console.error('\n' + err.message + '\n');
  }
  process.exit(1);
});
