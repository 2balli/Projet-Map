#!/usr/bin/env node
/**
 * LE CYCLE COMPLET D'UN POSTE DE TERRAIN, DE BOUT EN BOUT.
 *
 *   OUVRIR → SAISIR → VALIDER → ENREGISTRER → RECHARGER → VÉRIFIER
 *          → DÉCONNECTER → RECONNECTER → VÉRIFIER À NOUVEAU
 *
 * POURQUOI CE SCRIPT EXISTE. Les autres contrôles éprouvent des pièces :
 * la navigation des parcours, le rendu des écrans, les permissions, la
 * séparation des versions. Aucun ne suit une JOURNÉE DE TRAVAIL du début à la
 * fin — et c'est là que se cachent les défauts qui comptent pour l'utilisateur :
 * une donnée qui semble enregistrée mais ne survit pas au rechargement, un
 * changement qui disparaît à la reconnexion, une session qui traîne.
 *
 * « RECHARGER » est simulé par une RELECTURE DEPUIS LE DISQUE et une nouvelle
 * requête : c'est exactement ce que fait le navigateur après F5. « RECONNECTER »
 * ouvre une session neuve, avec un nouveau jeton.
 *
 * Le script lance son propre service, sur une copie des données. Il n'écrit
 * jamais dans les dossiers du dépôt.
 *
 *   node scripts/verifier-cycle.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * UN PORT LIBRE, ET LA PREUVE QU'ON PARLE BIEN A SON PROPRE SERVICE.
 *
 * Un port fixe est un piege. Si un service d'une execution precedente tient
 * encore le port, le notre echoue a s'y attacher SANS BRUIT, et la boucle
 * d'attente interroge alors l'ancien — dont le dossier de donnees a ete
 * supprime entre-temps. Les symptomes n'ont plus aucun rapport avec le code
 * eprouve : des appels qui ne repondent jamais, des donnees introuvables.
 *
 * Deux precautions, donc :
 *   1. le port est tire du numero de processus, donc different a chaque
 *      execution, et sa liberte est verifiee AVANT de lancer quoi que ce soit ;
 *   2. \`/api/etat\` doit annoncer NOTRE dossier de donnees. Si un intrus repond,
 *      on s'arrete en le disant, au lieu de rendre un verdict sur le mauvais
 *      service.
 */
const PORT = 8600 + (process.pid % 300);
const BASE = `http://127.0.0.1:${PORT}`;
const MOT_TEMPORAIRE = '123456';
const MOT_CHOISI = 'Cycle-Essai-2026';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

/* ------------------------------------------------------------------ */
/* Données d'épreuve                                                  */
/* ------------------------------------------------------------------ */

const travail = mkdtempSync(join(tmpdir(), 'gr-cycle-'));
const DONNEES = join(travail, 'donnees');

/**
 * SUR QUELLES DONNEES. Le cycle doit se derouler a l'identique sur les deux
 * versions : c'est le meme code, et une difference de comportement entre la
 * demonstration et la production serait un defaut a elle seule.
 *
 *     node scripts/verifier-cycle.mjs                       (production)
 *     node scripts/verifier-cycle.mjs --donnees donnees-demo
 *
 * On travaille TOUJOURS sur une copie : le script ecrit, supprime, et ne doit
 * jamais toucher aux donnees du depot.
 */
const demande = process.argv.indexOf('--donnees');
const choisi = demande > -1 ? process.argv[demande + 1] : null;

const source = choisi
  ? resolve(ROOT, choisi)
  : existsSync(join(ROOT, 'donnees-production'))
    ? join(ROOT, 'donnees-production')
    : join(ROOT, 'donnees-serveur');

if (!existsSync(source)) {
  console.error(`
Dossier de donnees introuvable : ${source}
`);
  process.exit(1);
}
console.log(`
  donnees d'epreuve : copie de ${source}`);
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });

/**
 * DEUX COMPTES, ET UN MOT DE PASSE TEMPORAIRE.
 *
 * On éprouve le cycle depuis le tout début : le premier accès impose le
 * changement de mot de passe, et c'est une étape du cycle réel qu'il serait
 * malhonnête de sauter.
 */
{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  await definirCompte(etat, {
    matricule: 'CYCLE-ADMIN',
    rang: 'admin',
    unite: 'cycle-admin',
    nom: 'Administration du cycle',
    role: 'commandement',
    code: MOT_TEMPORAIRE,
    doitChanger: true,
  });
  await definirCompte(etat, {
    matricule: 'CYCLE-BT',
    rang: 'unite',
    unite: 'Agdez',
    nom: 'Chef de brigade du cycle',
    role: 'commandement',
    reg: 'Ouarzazate',
    cie: 'Zagora',
    code: MOT_TEMPORAIRE,
    doitChanger: true,
  });
  enregistrerComptes(f, etat);
}

/* ------------------------------------------------------------------ */
/* Le service                                                         */
/* ------------------------------------------------------------------ */

/* Le port doit etre libre : sinon notre service ne s'y attachera pas, et la
   boucle d'attente interrogerait un inconnu. */
{
  let occupe = false;
  try {
    await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(1500) });
    occupe = true;
  } catch {
    /* personne ne repond : c'est ce qu'on veut */
  }
  if (occupe) {
    console.error(`
Le port ${PORT} est deja occupe. Arretez le service qui le tient, puis relancez.
`);
    rmSync(travail, { recursive: true, force: true });
    process.exit(1);
  }
}

const service = spawn(
  process.execPath,
  [
    join(ROOT, 'scripts', 'serve.mjs'),
    '--port',
    String(PORT),
    '--host',
    '127.0.0.1',
    '--donnees',
    DONNEES,
  ],
  { cwd: ROOT },
);

let sortieService = '';
service.stdout.on('data', (d) => {
  sortieService += d;
});
service.stderr.on('data', (d) => {
  sortieService += d;
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * LE DEMARRAGE PEUT ETRE LONG LA PREMIERE FOIS. Sur le jeu de demonstration,
 * les 68 Mo de \`elements.json\` sont repartis par journee au premier
 * lancement — mesure a 6 s, mais une machine chargee peut mettre davantage.
 * 90 s de patience valent mieux qu'un faux « le service ne demarre pas ».
 */
let debout = false;
let annonce = null;
for (let i = 0; i < 360; i++) {
  if (service.exitCode !== null) break;
  try {
    const r = await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      annonce = await r.json().catch(() => null);
      debout = true;
      break;
    }
  } catch {
    /* pas encore là */
  }
  await attendre(250);
}

if (!debout) {
  console.error('\nLe service ne démarre pas.\n');
  console.error(sortieService);
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

/**
 * ET C'EST BIEN LE NOTRE QUI REPOND.
 *
 * \`/api/etat\` ne publie pas le chemin du dossier de donnees, et c'est
 * deliberé : annoncer l'arborescence du serveur a tout client qui demande
 * n'apporte rien et renseigne un attaquant. On ne l'ajoute donc pas pour les
 * besoins d'une epreuve.
 *
 * L'identite est etablie autrement, et plus surement : l'etape 1 ouvre une
 * session avec \`CYCLE-ADMIN\`, un matricule cree a l'instant dans NOTRE copie.
 * Un service etranger ne le connait pas et repondrait 401 — l'epreuve
 * s'arreterait la, en le disant.
 */
if (annonce && typeof annonce.comptes !== 'number') {
  console.error(`
La reponse sur le port ${PORT} n'est pas celle du service attendu.
`);
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Outils d'appel                                                     */
/* ------------------------------------------------------------------ */

/**
 * UN PLAFOND SUR CHAQUE APPEL.
 *
 * Sans plafond, un appel qui ne revient jamais fait tomber tout le script sur
 * un \`fetch failed\` d'\`undici\` — 300 secondes plus tard, sans dire QUEL appel
 * a bloque. Le diagnostic devient impossible, alors que c'est justement le
 * defaut le plus grave qu'on puisse rencontrer.
 *
 * 20 secondes : les appels mesures tiennent tous sous 200 ms, meme sur le jeu
 * de demonstration. Au-dela, ce n'est plus de la lenteur, c'est un blocage.
 */
const PLAFOND_MS = Number(process.env.GR_PLAFOND_MS) || 20_000;

/** \`GR_TRACE=1\` imprime la duree de chaque appel — pour situer un blocage. */
const TRACE = process.env.GR_TRACE === '1';

let finPrecedente = Date.now();

const fetchBorne = async (url, o = {}) => {
  const arret = AbortSignal.timeout(PLAFOND_MS);
  const debut = Date.now();
  const creux = debut - finPrecedente;
  try {
    const r = await fetch(url, { ...o, signal: arret });
    finPrecedente = Date.now();
    if (TRACE) {
      console.log(
        `      [${String(Date.now() - debut).padStart(6)} ms, creux ${String(creux).padStart(6)} ms] ` +
          `${(o.method ?? 'GET').padEnd(6)} ${String(url).replace(BASE, '')} -> ${r.status}`,
      );
    }
    return r;
  } catch (e) {
    finPrecedente = Date.now();
    if (TRACE) {
      console.log(
        `      [${String(Date.now() - debut).padStart(6)} ms, creux ${String(creux).padStart(6)} ms] ` +
          `${(o.method ?? 'GET').padEnd(6)} ${String(url).replace(BASE, '')} -> ${e?.name}`,
      );
    }
    const cause = e?.name === 'TimeoutError' || arret.aborted ? `aucune reponse en ${PLAFOND_MS / 1000} s` : (e?.cause?.code ?? e?.message);
    throw new Error(`${o.method ?? 'GET'} ${String(url).replace(BASE, '')} — ${cause}`);
  }
};

async function ouvrir(matricule, code) {
  const r = await fetchBorne(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code }),
  });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { cookie, statut: r.status, ...(await r.json().catch(() => ({}))) };
}

const appel = (s, chemin, o = {}) =>
  fetchBorne(BASE + chemin, {
    ...o,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'gr-carte',
      ...(s?.cookie ? { Cookie: s.cookie } : {}),
      ...(o.headers ?? {}),
    },
  });

/** Ce que le DISQUE contient — la seule preuve d'un enregistrement. */
const surDisque = (fichier) =>
  JSON.parse(readFileSync(join(DONNEES, fichier), 'utf8')).items ?? [];

/** Les relèves, désormais réparties par journée. */
const relevesSurDisque = () => {
  const d = join(DONNEES, 'elements');
  if (!existsSync(d)) return [];
  const lignes = [];
  for (const nom of readdirSync(d)) {
    if (!nom.endsWith('.jsonl')) continue;
    for (const l of readFileSync(join(d, nom), 'utf8').split('\n')) {
      const nu = l.trim();
      if (nu) lignes.push(JSON.parse(nu));
    }
  }
  return lignes;
};

/* ================================================================== */

try {
  console.log('');
  console.log('=== 1. OUVRIR — premier accès et mot de passe imposé ===');
  console.log('');

  let admin = await ouvrir('CYCLE-ADMIN', MOT_TEMPORAIRE);
  dit(admin.statut === 200, 'le mot de passe temporaire ouvre la session', `HTTP ${admin.statut}`);
  dit(admin.motDePasseAChanger === true, 'le changement est exigé');

  {
    const bloque = await appel(admin, '/api/marquages');
    dit(bloque.status === 428, 'rien n’est accessible avant le changement', `HTTP ${bloque.status}`);
  }

  {
    const r = await appel(admin, '/api/motdepasse', {
      method: 'POST',
      body: JSON.stringify({ nouveau: MOT_CHOISI, confirmation: MOT_CHOISI }),
    });
    dit(r.status === 200, 'le nouveau mot de passe est accepté', `HTTP ${r.status}`);
  }

  dit((await ouvrir('CYCLE-ADMIN', MOT_TEMPORAIRE)).statut === 401, '123456 ne fonctionne plus');
  admin = await ouvrir('CYCLE-ADMIN', MOT_CHOISI);
  dit(admin.statut === 200 && !admin.motDePasseAChanger, 'le nouveau ouvre sans rien redemander');

  /* Le chef de brigade fait de même : c'est lui qui travaille ensuite. */
  let chef = await ouvrir('CYCLE-BT', MOT_TEMPORAIRE);
  await appel(chef, '/api/motdepasse', {
    method: 'POST',
    body: JSON.stringify({ nouveau: MOT_CHOISI, confirmation: MOT_CHOISI }),
  });
  chef = await ouvrir('CYCLE-BT', MOT_CHOISI);
  dit(chef.statut === 200, 'le chef de brigade est en session', `HTTP ${chef.statut}`);

  /* ================================================================ */
  console.log('');
  console.log('=== 2. VALIDER — ce qui doit être refusé l’est ===');
  console.log('');

  /**
   * ON COMPTE AVANT. En production les fichiers sont vides, mais en
   * demonstration il y a plus d'un millier de reperes : la question n'est pas
   * « le fichier est-il vide » mais « un refus a-t-il quand meme ecrit ».
   */
  const avantRefus = surDisque('marquages.json').length;

  const refus = [
    ['sans nature', { lat: 30.69697, lng: -6.49292 }],
    ['nature inconnue', { type: 'inventee', lat: 30.69697, lng: -6.49292 }],
    ['sans coordonnées', { type: 'barrage_fixe' }],
    ['coordonnées nulles', { type: 'barrage_fixe', lat: null, lng: null }],
    ['latitude impossible', { type: 'barrage_fixe', lat: 999, lng: -6.49292 }],
    ['en pleine mer', { type: 'barrage_fixe', lat: 0, lng: 0 }],
    ['hors de sa brigade', { type: 'barrage_fixe', lat: 35.7595, lng: -5.834 }],
  ];
  for (const [nom, corps] of refus) {
    const r = await appel(chef, '/api/marquages', { method: 'POST', body: JSON.stringify(corps) });
    dit(r.status >= 400, `${nom.padEnd(22)} → refusé`, `HTTP ${r.status}`);
  }
  dit(
    surDisque('marquages.json').length === avantRefus,
    'et rien n’a été écrit sur le disque',
    `${avantRefus} avant, ${surDisque('marquages.json').length} après`,
  );

  /* ================================================================ */
  console.log('');
  console.log('=== 3. SAISIR et ENREGISTRER ===');
  console.log('');

  let poste = null;
  {
    const r = await appel(chef, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({
        type: 'barrage_fixe',
        lat: 30.69697,
        lng: -6.49292,
        nom: 'Carrefour du cycle',
        route: 'RN9 — PK 12',
      }),
    });
    poste = (await r.json()).item;
    dit(r.status === 201 && !!poste, 'le poste est créé', `HTTP ${r.status}`);
    dit(
      poste?.bt === 'Agdez' && !!poste?.cie && !!poste?.reg,
      'rattaché automatiquement par le serveur',
      poste ? `${poste.reg} > ${poste.cie} > ${poste.bt}` : '',
    );
    dit(poste?.auteur?.matricule === 'CYCLE-BT', 'l’auteur est consigné');
  }

  dit(
    surDisque('marquages.json').some((m) => m.id === poste.id),
    'il est sur le disque AVANT tout rechargement',
  );

  /* Une relève sur ce poste — le geste le plus fréquent. */
  {
    const r = await appel(chef, '/api/elements', {
      method: 'POST',
      body: JSON.stringify({
        barrageId: poste.id,
        grade: 'MDLC',
        nom: 'Element du cycle',
        matricule: 'CYCLE-001',
      }),
    });
    dit(r.status === 201, 'une relève est enregistrée sur ce poste', `HTTP ${r.status}`);
    dit(
      relevesSurDisque().some((e) => e.matricule === 'CYCLE-001'),
      'et elle est sur le disque, dans la journée du jour',
    );
  }

  /* ================================================================ */
  console.log('');
  console.log('=== 4. RECHARGER — ce que voit un F5 ===');
  console.log('');

  {
    const items = (await (await appel(chef, '/api/marquages')).json()).items ?? [];
    const relu = items.find((m) => m.id === poste.id);
    dit(!!relu, 'le poste est rendu par l’API');
    dit(relu?.nom === 'Carrefour du cycle', 'avec son nom', relu?.nom);
    dit(relu?.route === 'RN9 — PK 12', 'et son axe', relu?.route);

    const r = await appel(chef, `/api/roster?bt=Agdez`);
    dit(r.status === 200, 'le roster de la brigade répond', `HTTP ${r.status}`);
  }

  /* ================================================================ */
  console.log('');
  console.log('=== 5. MODIFIER, puis vérifier ===');
  console.log('');

  {
    const avant = (await (await appel(chef, '/api/marquages')).json()).items.find(
      (m) => m.id === poste.id,
    );
    const r = await appel(chef, `/api/marquages/${poste.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...avant, nom: 'Carrefour corrigé', note: 'Sortie de souk' }),
    });
    dit(r.status === 200, 'la correction est acceptée', `HTTP ${r.status}`);

    const apres = surDisque('marquages.json').find((m) => m.id === poste.id);
    dit(apres?.nom === 'Carrefour corrigé', 'le disque porte la correction', apres?.nom);
    dit(apres?.note === 'Sortie de souk', 'y compris l’observation');
  }

  /* ================================================================ */
  console.log('');
  console.log('=== 6. DÉCONNECTER ===');
  console.log('');

  {
    /* Le service repond-il encore ? Si la deconnexion echoue, il faut savoir
       si c'est elle ou tout le service. */
    const vivant = await appel(null, '/api/etat');
    dit(vivant.status === 200, 'le service repond avant la deconnexion', `HTTP ${vivant.status}`);

    const r = await appel(chef, '/api/session', { method: 'DELETE' });
    dit(r.status === 200, 'la déconnexion répond', `HTTP ${r.status}`);

    const apres = await appel(chef, '/api/marquages');
    dit(apres.status === 401, 'le jeton ne vaut plus rien', `HTTP ${apres.status}`);

    const ecriture = await appel(chef, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({ type: 'barrage_fixe', lat: 30.7, lng: -6.5, nom: 'APRES DECONNEXION' }),
    });
    dit(ecriture.status === 401, 'et il n’écrit plus rien', `HTTP ${ecriture.status}`);
  }

  /* ================================================================ */
  console.log('');
  console.log('=== 7. RECONNECTER et VÉRIFIER À NOUVEAU ===');
  console.log('');

  {
    const revenu = await ouvrir('CYCLE-BT', MOT_CHOISI);
    dit(revenu.statut === 200, 'reconnexion avec le mot de passe choisi', `HTTP ${revenu.statut}`);

    const items = (await (await appel(revenu, '/api/marquages')).json()).items ?? [];
    const relu = items.find((m) => m.id === poste.id);
    dit(!!relu, 'le poste est toujours là');
    dit(relu?.nom === 'Carrefour corrigé', 'avec la correction de tout à l’heure', relu?.nom);

    const releves = relevesSurDisque().filter((e) => e.matricule === 'CYCLE-001');
    dit(releves.length === 1, 'la relève a survécu, une seule fois', `${releves.length}`);

    /* Et rien de ce qui a été refusé n'est apparu entre-temps. */
    dit(
      !items.some((m) => m.nom === 'APRES DECONNEXION'),
      'aucune écriture refusée ne s’est glissée',
    );
    dit(
      items.every((m) => m.bt && m.cie && m.reg),
      'aucun repère orphelin dans le périmètre',
    );
  }

  /* ================================================================ */
  console.log('');
  console.log('=== 8. SUPPRIMER, et vérifier la disparition ===');
  console.log('');

  {
    const s = await ouvrir('CYCLE-BT', MOT_CHOISI);
    const r = await appel(s, `/api/marquages/${poste.id}`, { method: 'DELETE' });
    dit(r.status === 200, 'le poste se supprime', `HTTP ${r.status}`);
    dit(
      !surDisque('marquages.json').some((m) => m.id === poste.id),
      'il a disparu du disque',
    );

    const apres = await ouvrir('CYCLE-BT', MOT_CHOISI);
    const items = (await (await appel(apres, '/api/marquages')).json()).items ?? [];
    dit(!items.some((m) => m.id === poste.id), 'et il ne revient pas après reconnexion');

    /* Ni alerte ni conflit orphelin. */
    const alertes = surDisque('alertes.json');
    dit(
      !alertes.some((a) => a.checkpointAId === poste.id || a.checkpointBId === poste.id),
      'aucune alerte ne le désigne encore',
    );
    const instructions = surDisque('instructions.json');
    const ouvertes = instructions.filter(
      (n) => n.barrageId === poste.id && n.statut === 'ouverte',
    );
    dit(ouvertes.length === 0, 'aucune notification ouverte ne le désigne', `${ouvertes.length}`);
  }
} catch (e) {
  /**
   * Un appel bloque ou une exception ne doit pas se solder par une trace de
   * pile : c'est un ECHEC du cycle, et il doit compter comme tel. On imprime
   * aussi ce que le service a dit — c'est souvent la seule piste.
   */
  dit(false, 'le cycle se deroule sans blocage', e?.message ?? String(e));
  /**
   * QUE VAUT LE SERVICE APRES LE BLOCAGE ? La reponse oriente tout le
   * diagnostic : mort (le processus a rendu l'ame), bloque (il ne repond plus
   * du tout), ou seule cette connexion a ete perdue.
   */
  console.error(
    `  processus : ${service.exitCode === null ? 'vivant' : 'sorti(' + service.exitCode + ')'}`,
  );
  for (const essai of [1, 2]) {
    const t = Date.now();
    try {
      const r = await fetch(`${BASE}/api/etat`, {
        signal: AbortSignal.timeout(8000),
        headers: { Connection: 'close' },
      });
      console.error(`  sonde ${essai} /api/etat : HTTP ${r.status} en ${Date.now() - t} ms`);
    } catch (err) {
      console.error(`  sonde ${essai} /api/etat : ${err?.name} apres ${Date.now() - t} ms`);
    }
  }
  console.error('\n--- journal du service ---\n' + sortieService.slice(-3000));
} finally {
  service.kill();
  rmSync(travail, { recursive: true, force: true });
}

console.log('');
console.log(`  ${ok} réussi(s), ${echecs.length} échoué(s)`);
if (echecs.length) {
  console.error('');
  for (const e of echecs) console.error('  - ' + e);
  console.error('\nLe cycle de travail est en défaut.\n');
  process.exit(1);
}
console.log('\nUne journée de travail se déroule sans perte ni surprise.\n');
