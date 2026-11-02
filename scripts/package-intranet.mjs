#!/usr/bin/env node
/**
 * Assemble le paquet de déploiement intranet.
 *
 *   npm run package
 *
 * Produit `intranet/` :
 *   dist/          l'application compilée, chemins relatifs, sans aucune
 *                  ressource externe (les couches sont dans dist/layers/)
 *   serve.mjs      serveur statique sans dépendance
 *   demarrer.cmd   lancement en un double-clic sous Windows
 *   LISEZ-MOI.txt  procédure de déploiement
 *
 * puis l'archive `carte-gendarmerie-intranet.zip` prête à copier.
 *
 * Contrôle inclus : le script échoue si une ressource externe subsiste dans
 * le build, pour ne jamais livrer un paquet qui dépendrait d'internet.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
/** Le fond de carte hors ligne (maroc-carte-offline) — servi par serve.mjs sous fond-carte/. */
const FOND_SRC = join(ROOT, 'maroc-carte-offline', 'donnees');
const FOND_ELEMENTS = ['tiles', 'fonts', 'sprites', 'data/regions-limites.geojson', 'data/regions-etiquettes.geojson'];

/**
 * DEUX PAQUETS, UN PAR VERSION — et le même code dans les deux.
 *
 * `--version demo` ou `--version production`. Sans rien, on produit les DEUX :
 * c'est ce qu'on veut à la livraison, et cela évite d'oublier l'un des deux
 * après une correction.
 *
 * CE QUI LES DISTINGUE, et rien d'autre :
 *
 *   — le dossier de données emporté (`donnees-demo/` ou
 *     `donnees-production/`), avec son `mode.json` ;
 *   — le port par défaut (8090 en démonstration, 8080 en production) : deux
 *     onglets ouverts côte à côte ne peuvent pas être confondus ;
 *   — le `--mode` écrit dans `demarrer.cmd`, que le service VÉRIFIE contre le
 *     `mode.json` du dossier et refuse s'il ne correspond pas.
 *
 /* Le code — `dist/`, `serveur/`, `scripts/` — est identique, octet pour
 * octet. Deux bases de code auraient divergé, et la version de démonstration
 * aurait cessé de démontrer la vraie.
 */
const VERSIONS = {
  demo: {
    dossier: 'intranet-demo',
    donnees: 'donnees-demo',
    zip: 'carte-gendarmerie-DEMO.zip',
    port: 8090,
    mode: 'demo',
    titre: 'VERSION DE DÉMONSTRATION — DONNÉES FICTIVES',
  },
  production: {
    dossier: 'intranet-production',
    donnees: 'donnees-production',
    zip: 'carte-gendarmerie-PRODUCTION.zip',
    port: 8080,
    mode: 'production',
    titre: 'VERSION DE PRODUCTION — DONNÉES RÉELLES',
  },
};

const versionDemandee = (() => {
  const i = process.argv.indexOf('--version');
  return i > -1 ? process.argv[i + 1] : null;
})();

if (versionDemandee && !VERSIONS[versionDemandee]) {
  console.error(`\n--version inconnue : ${versionDemandee} (demo | production)\n`);
  process.exit(1);
}

const aProduire = versionDemandee ? [versionDemandee] : Object.keys(VERSIONS);

/* ------------------------------------------------------------------ */
/* 1. Contrôles préalables                                            */
/* ------------------------------------------------------------------ */

if (!existsSync(DIST)) {
  console.error('\ndist/ absent — lancez `npm run build` avant `npm run package`.\n');
  process.exit(1);
}

if (!existsSync(join(DIST, 'layers'))) {
  console.error(
    '\ndist/layers/ absent — lancez `npm run build:layers` puis `npm run build`.\n'
  );
  process.exit(1);
}

/**
 * Hôtes autorisés dans le build. Tout autre hôte signifie que
 * l'application irait chercher une ressource hors du réseau interne.
 */
const HOTES_AUTORISES = [
  'www.w3.org', // espaces de noms XML, jamais requêtés
  'leafletjs.com', // texte d'erreur de la bibliothèque
  'react.dev', // texte d'erreur de la bibliothèque
  'tailwindcss.com', // commentaire CSS
  /* MapLibre (fond de carte) — textes et liens, jamais requêtés : */
  'maplibre.invalid', // base fictive servant à analyser une URL
  'maplibre.org', // lien du logo (contrôle désactivé)
  'github.com', // textes d'erreur MapLibre / PMTiles
  'wiki.openstreetmap.org', // texte d'erreur « WebGL requis »
  'www.openstreetmap.org', // lien d'attribution du style
];

function fichiersRecursifs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiersRecursifs(join(dir, e.name)) : [join(dir, e.name)]
  );
}

const suspects = [];
for (const f of fichiersRecursifs(DIST)) {
  if (!['.js', '.css', '.html'].includes(extname(f))) continue;
  const texte = readFileSync(f, 'utf8');
  for (const m of texte.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) {
    if (!HOTES_AUTORISES.includes(m[1])) suspects.push(`${m[1]}  (${f.slice(ROOT.length + 1)})`);
  }
}

if (suspects.length) {
  console.error('\nRessources externes détectées dans le build :');
  [...new Set(suspects)].forEach((s) => console.error('  - ' + s));
  console.error('\nCorrigez-les avant de livrer un paquet intranet.\n');
  process.exit(1);
}

console.log('Contrôle : aucune ressource externe non autorisée dans dist/.');

if (!existsSync(join(FOND_SRC, 'tiles', 'maroc.pmtiles'))) {
  console.error(`
Fond de carte absent (${FOND_SRC}) — lancez « npm run data » dans maroc-carte-offline.
`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* UN TOUR PAR VERSION — le code est le même, les données diffèrent.   */
/* ------------------------------------------------------------------ */

for (const cleVersion of aProduire) {
  const V = VERSIONS[cleVersion];
  const OUT = join(ROOT, V.dossier);
  const ZIP = join(ROOT, V.zip);

  console.log('');
  console.log(`── ${V.titre}`);

/* ------------------------------------------------------------------ */
/* 2. Assemblage                                                      */
/* ------------------------------------------------------------------ */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(DIST, join(OUT, 'dist'), { recursive: true });
cpSync(join(ROOT, 'scripts/serve.mjs'), join(OUT, 'serve.mjs'));
/* Le fond de carte, à côté de serve.mjs (qui le cherche dans ./fond-carte). */
for (const el of FOND_ELEMENTS) {
  cpSync(join(FOND_SRC, el), join(OUT, 'fond-carte', el), { recursive: true });
}

/**
 * Service d'habilitation : `serveur/` à côté de serve.mjs (qui le cherche
 * là), et le script de gestion des comptes sous `scripts/` pour que son
 * import `../serveur/...` reste valide dans le paquet comme dans le dépôt.
 *
 * Sans ces fichiers, le paquet servirait la carte en consultation seule : la
 * saisie des chefs de compagnie et de région serait impossible.
 */
cpSync(join(ROOT, 'serveur'), join(OUT, 'serveur'), { recursive: true });
mkdirSync(join(OUT, 'scripts'), { recursive: true });
for (const outil of ['comptes.mjs', 'mot-de-passe-initial.mjs', 'vider-donnees.mjs']) {
  cpSync(join(ROOT, 'scripts', outil), join(OUT, 'scripts', outil));
}

/**
 * SQUELETTE DE DONNÉES — les fichiers, vides, avec leur enveloppe.
 *
 * Le paquet ne portait aucune donnée : il fallait copier `donnees-serveur/` à
 * la main, et un oubli se traduisait par un service qui démarre sans trouver
 * un seul compte. Puisque les enregistrements sont désormais VIDES, les
 * emporter ne divulgue rien et supprime cette étape : on dézippe, on lance.
 *
 * `comptes.json` EST EMPAQUETÉ, et ce fut d'abord une erreur de l'exclure.
 *
 * Le raisonnement de départ semblait prudent : ce fichier porte 625 empreintes
 * de mots de passe, sa copie devrait être un geste conscient. Résultat : le
 * paquet démarrait en annonçant « Aucun compte n'est déclaré sur le serveur »,
 * et l'application était inutilisable. Une précaution qui rend le livrable
 * inopérant n'est pas une précaution, c'est un défaut.
 *
 * Ce qu'elle protégeait vraiment est faible : le paquet va du poste de
 * l'administrateur à SON serveur d'intranet, il n'est pas publié, et ce ne
 * sont pas des mots de passe mais des empreintes PBKDF2 à 210 000 itérations.
 *
 * LE VRAI RISQUE EST AILLEURS, et il est réel : dézipper par-dessus un serveur
 * DÉJÀ EN SERVICE remplacerait `comptes.json` — donc les mots de passe que
 * les chefs ont choisis — par celui du poste de développement. Le LISEZ-MOI le
 * dit en toutes lettres : sur une mise à jour, on ne recopie QUE le code.
 *
 * `sauvegardes/` reste exclu : ce sont les données d'avant, elles n'ont rien à
 * faire dans un paquet de livraison.
 */
const DONNEES_SRC = join(ROOT, V.donnees);
  const DONNEES_OUT = join(OUT, 'donnees-serveur');

  if (!existsSync(DONNEES_SRC)) {
    console.error(
      `
${V.donnees}/ absent — lancez « node scripts/preparer-versions.mjs --construire ».
`,
    );
    process.exit(1);
  }
const SQUELETTE = [
  /* LE MARQUEUR D'ABORD : sans lui, le service refuse de démarrer avec le
     `--mode` écrit dans demarrer.cmd. C'est le verrou de la séparation. */
  'mode.json',
  'comptes.json',
  'marquages.json',
  'elements.json',
  'effectifs.json',
  'alertes.json',
  'instructions.json',
  'conflits-planification.json',
  'missions.json',
  'composition-barrage.json',
  'villes-police.json',
];

mkdirSync(DONNEES_OUT, { recursive: true });
let squelette = 0;
let nonVides = [];
for (const nom of SQUELETTE) {
  const source = join(DONNEES_SRC, nom);
  if (!existsSync(source)) continue;
  /* CONTRÔLE : on n'empaquette pas des enregistrements par inadvertance. */
  try {
    const j = JSON.parse(readFileSync(source, 'utf8'));
    if (Array.isArray(j.items) && j.items.length > 0) nonVides.push(`${nom} (${j.items.length})`);
  } catch {
    /* Un fichier de configuration sans `items` : rien à contrôler. */
  }
  cpSync(source, join(DONNEES_OUT, nom));
  squelette++;
}

/**
 * LES RELEVÉS SONT UN DOSSIER, PLUS UN FICHIER — et le paquet l'ignorait.
 *
 * `elements.json` a été remplacé par `elements/<journée>.jsonl` (voir l'en-tête
 * de serveur/elements.mjs : le monolithe atteignait 65 Mo en cinq jours et
 * était réécrit en entier à chaque relève). La liste ci-dessus nommait encore
 * l'ancien fichier, et lui seul.
 *
 * Le défaut ne s'est pas vu tout de suite, parce que le premier démarrage
 * migre le monolithe : tant qu'aucun service n'avait tourné sur `donnees-demo/`,
 * `elements.json` existait et était emporté. Dès qu'un service l'a ouvert — ce
 * que fait `check:versions` — le fichier a été renommé, et le paquet de
 * démonstration est parti SANS AUCUN historique de relèves : dix fichiers au
 * lieu de onze, sans un mot.
 *
 * On emporte donc les deux formes : le dossier s'il existe, et le fichier
 * d'avant migration s'il est encore là (le service le migrera au démarrage).
 */
const RELEVES_SRC = join(DONNEES_SRC, 'elements');
let journees = 0;
if (existsSync(RELEVES_SRC)) {
  const fichiers = readdirSync(RELEVES_SRC).filter((n) => n.endsWith('.jsonl'));
  if (fichiers.length) {
    mkdirSync(join(DONNEES_OUT, 'elements'), { recursive: true });
    for (const n of fichiers) {
      cpSync(join(RELEVES_SRC, n), join(DONNEES_OUT, 'elements', n));
      journees++;
    }
    /* Une relève est un enregistrement : on l'annonce comme les autres, pour
       qu'un paquet de production non vide ne passe jamais inaperçu. */
    nonVides.push(`elements/ (${journees} journée(s))`);
  }
}

console.log(
  `  Données  : ${squelette} fichier(s), dont les habilitations` +
    `${journees ? ` + ${journees} journée(s) de relèves` : ''}.`,
);

  /**
   * L'AVERTISSEMENT NE VAUT QUE POUR LA PRODUCTION.
   *
   * La démonstration DOIT porter des enregistrements — c'est sa raison d'être.
   * Le signaler comme une anomalie apprenait à ignorer l'avertissement, et il
   * n'aurait plus rien dit le jour où la production, elle, en aurait contenu.
   */
  if (V.mode === 'production' && nonVides.length) {
    console.log(`  ATTENTION — la PRODUCTION contient des enregistrements : ${nonVides.join(', ')}`);
    console.log('  Lancez « node scripts/preparer-versions.mjs --verifier » pour en juger.');
  }
  if (V.mode === 'demo') {
    const barrages = nonVides.find((n) => n.startsWith('marquages.json'));
    console.log(`  Fictifs  : ${barrages ?? 'aucun barrage — la démonstration ne montrera rien'}`);
  }

writeFileSync(
  join(OUT, 'demarrer.cmd'),
  [
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if errorlevel 1 (',
    '  echo.',
    '  echo Node.js est introuvable sur ce poste.',
    '  echo Installez Node.js 18 ou superieur, puis relancez ce fichier.',
    '  echo.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
    'rem ---------------------------------------------------------------',
    "rem ASSISTANT D'ANALYSE (panneau Optimisation) — facultatif.",
    'rem',
    'rem Mettez "rem" devant une ligne pour DESACTIVER l\'appel correspondant,',
    'rem et corrigez les adresses si elles changent. Ces services vivent sur',
    "rem l'intranet : c'est CE serveur qui les joint, pas les postes clients.",
    'rem',
    'rem   GR_N8N_URL        url complete du webhook n8n',
    "rem   GR_OLLAMA_URL     racine d'Ollama (secours si n8n ne repond pas)",
    'rem   GR_OLLAMA_MODELE  nom du modele charge dans Ollama',
    'rem',
    "rem Sans ces lignes, aucun appel sortant et le bouton n'apparait pas.",
    'rem ---------------------------------------------------------------',
    'set GR_N8N_URL=http://192.168.0.6:5678/webhook/carte-optimisation',
    'set GR_OLLAMA_URL=http://192.168.0.6:11434',
    'set GR_OLLAMA_MODELE=llama3.1',
    '',
    /* LE PORT ET LE MODE VIENNENT DE LA VERSION.
       `--mode` n'est pas décoratif : le service le compare au `mode.json` du
       dossier de données et REFUSE de démarrer s'ils diffèrent. C'est ce qui
       empêche ce raccourci d'ouvrir le mauvais dispositif. */
    `node serve.mjs --port ${V.port} --mode ${V.mode}`,
    'pause',
  ].join('\r\n')
);

const tailleMo = (dir) =>
  (
    fichiersRecursifs(dir).reduce((s, f) => s + statSync(f).size, 0) /
    1048576
  ).toFixed(1);

const couches = readdirSync(join(DIST, 'layers'));

writeFileSync(
  join(OUT, 'LISEZ-MOI.txt'),
  `CARTE TACTIQUE — GENDARMERIE ROYALE
Deploiement sur reseau interne (intranet)
${'='.repeat(60)}

CONTENU
  dist/          l'application (${tailleMo(join(OUT, 'dist'))} Mo)
  dist/layers/   les ${couches.length} couches de donnees
  fond-carte/    le fond de carte hors ligne (archive PMTiles, polices, sprites)
  serve.mjs      serveur : fichiers + API d'habilitation, aucune dependance
  serveur/       service d'habilitation (comptes, sessions, marquages)
  scripts/       gestion des comptes (comptes.mjs)
  demarrer.cmd   lancement par double-clic (Windows)

AUCUNE CONNEXION INTERNET N'EST REQUISE.
Toutes les ressources (code, styles, icones, donnees, fond de carte) sont
dans ce dossier : dist/ et fond-carte/. Aucun serveur de tuiles n'est requis.

${'-'.repeat(60)}
OPTION 1 — demarrage immediat (Node.js requis)
${'-'.repeat(60)}

  Double-cliquez sur demarrer.cmd
  ou en ligne de commande :   node serve.mjs --port ${V.port} --mode ${V.mode}

  Puis ouvrez http://<ip-du-serveur>:8080/ depuis les postes clients.
  L'adresse reseau exacte est affichee au demarrage.

${'-'.repeat(60)}
COMPTES D'HABILITATION (chefs de compagnie et de region)
${'-'.repeat(60)}

  La saisie des marquages (zahma, accidents, barrages) exige une
  connexion : unite + code, verifies PAR LE SERVEUR. Sans compte,
  personne ne peut ecrire — la carte reste consultable.

  Creer un compte par region et par compagnie, en une fois :

      node scripts/comptes.mjs --initialiser

  Les codes sont AFFICHES UNE SEULE FOIS. Notez-les, remettez a chaque
  chef le sien, puis detruisez la liste : seule une empreinte est
  conservee, rien ne permet de relire un code.

  Autres commandes :
      node scripts/comptes.mjs --lister
      node scripts/comptes.mjs --recoder --rang cie --unite Marrakech
      node scripts/comptes.mjs --supprimer --rang cie --unite Marrakech

  Les donnees d'exploitation vont dans donnees-serveur/ :
      comptes.json     empreintes des mots de passe (jamais les mots de passe)
      marquages.json   les barrages et points saisis
      elements.json    les releves par creneau de 6 h
      effectifs.json   l'effectif nominatif
  Sauvegardez ce dossier : c'est le travail des chefs qu'il contient.
  Protegez-le en lecture au niveau du systeme de fichiers.

  Ce paquet les livre VIDES (sauf comptes.json), avec leur structure :
  les barrages se saisissent depuis l'application, region par region.

!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
MISE A JOUR D'UN SERVEUR DEJA EN SERVICE
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

  NE REMPLACEZ PAS donnees-serveur/ — vous effaceriez les barrages
  saisis ET les mots de passe que les chefs ont choisis, en les
  remplacant par ceux du poste de developpement.

  Sur une mise a jour, ne recopiez QUE le code :

      dist        serveur        scripts        serve.mjs

  Le premier deploiement, lui, prend tout le paquet.

------------------------------------------------------------
PREMIER ACCES — MOT DE PASSE TEMPORAIRE
------------------------------------------------------------

  Pour distribuer un acces connu a tous les chefs d'un coup :

      node scripts/mot-de-passe-initial.mjs --liste --tous
      node scripts/mot-de-passe-initial.mjs --tous

  Chaque titulaire se connecte alors avec 123456, et l'application ne
  lui ouvre QUE l'ecran de changement de mot de passe — le refus est
  applique par le serveur, pas par l'ecran. Le mot de passe temporaire
  cesse de fonctionner des qu'il en a choisi un.

      --rang unite          un seul echelon
      --matricule BT-AGDEZ  un seul compte
      --mot-de-passe 'xxx'  autre chose que 123456

  Un compte qui a deja choisi son mot de passe n'est pas reinitialise
  sans --forcer.

------------------------------------------------------------
REMETTRE LES DONNEES A ZERO
------------------------------------------------------------

      node scripts/vider-donnees.mjs --liste
      node scripts/vider-donnees.mjs --vider

  Vide les enregistrements SANS supprimer les fichiers, et sauvegarde
  l'etat precedent dans donnees-serveur/sauvegardes/. Les comptes, la
  configuration et l'organigramme (28 regions, 90 compagnies,
  504 brigades) ne sont jamais touches.

  Un redemarrage du serveur ferme toutes les sessions ouvertes : les
  chefs se reconnectent, rien n'est perdu.

${'-'.repeat(60)}
OPTION 2 — serveur web existant (IIS, Apache, nginx)
${'-'.repeat(60)}

  ATTENTION : cette option ne sert que des fichiers. La carte et
  l'analyse fonctionnent, mais la SAISIE EST INDISPONIBLE — il n'y a
  aucun service pour verifier les codes. Pour la saisie, utilisez
  l'option 1, ou placez node serve.mjs derriere un mandataire.

  Copiez le CONTENU de dist/ dans le repertoire publie.
  Aucune configuration particuliere : les chemins sont relatifs, donc
  la racine du site comme un sous-repertoire /carte/ fonctionnent.

  Deux points d'attention :
   - le type MIME .geojson doit etre servi (sinon declarez-le en
     application/json) ;
   - ne mettez pas index.html ni layers/ en cache longue duree, sinon
     une mise a jour des donnees resterait invisible cote client.

${'-'.repeat(60)}
FOND DE CARTE
${'-'.repeat(60)}

  Le fond est l'archive fond-carte/tiles/maroc.pmtiles, servie par
  serve.mjs. Si la carte reste sans fond, le panneau lateral affiche un
  badge "hors ligne" : verifiez que fond-carte/ est present a cote de
  serve.mjs, ou passez --fond-carte <dossier>.

${'-'.repeat(60)}
METTRE A JOUR LES DONNEES
${'-'.repeat(60)}

  Sur le poste de developpement, avec les fichiers sources dans data/ :
      npm run build:layers
      npm run build
      npm run package
  puis recopiez le paquet sur le serveur.

  RESEAU ROUTIER (autoroutes, nationales, regionales, provinciales) :
  il vient d'OpenStreetMap et se rafraichit sur un poste AVEC internet :
      npm run roads:fetch      (telechargement, ~110 Mo dans data/routes/)
      npm run build:roads      (couches + graphe des distances)
      npm run build && npm run package

  Le serveur intranet ne fait AUCUN appel sortant : il ne recoit que le
  produit fini. Les distances sont calculees dans le navigateur, il n'y a
  aucun service de routage a installer ni a maintenir.

  UNE SEULE EXCEPTION, et il faut la demander explicitement : l'assistant
  d'analyse du panneau Optimisation. Demarre avec --n8n <url du webhook>
  ou --ollama <url>, le serveur joint cette machine pour faire commenter un
  resultat de calcul. Sans ces options, rien n'est appele et le bouton
  n'apparait pas. Voir serveur/assistant.mjs.
`.replace(/\n/g, '\r\n')
);

console.log(`  Assemblé : ${V.dossier}/ (${tailleMo(OUT)} Mo)`);

/* ------------------------------------------------------------------ */
/* 3. Archive                                                         */
/* ------------------------------------------------------------------ */

rmSync(ZIP, { force: true });
try {
  // Compress-Archive fait partie de Windows : aucun outil à installer.
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${ZIP}' -Force`,
    ],
    { stdio: 'pipe' }
  );
    const mo = (statSync(ZIP).size / 1048576).toFixed(1);
    console.log(`  Archive  : ${V.zip} (${mo} Mo)`);
  } catch (err) {
    console.log(`  Archive non créée — copiez ${V.dossier}/ tel quel.`);
    console.log('  ' + String(err.message).split('\n')[0]);
  }
}

console.log('');
console.log('Prêt à copier sur le serveur intranet.');
console.log('');
console.log('  DÉMONSTRATION : intranet-demo/       port 8090   données fictives');
console.log('  PRODUCTION    : intranet-production/ port 8080   données réelles');
console.log('');
console.log('Le service refuse de démarrer si le dossier de données ne porte pas le');
console.log('mode attendu — voir serveur/mode.mjs.');
console.log('');
