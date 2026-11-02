#!/usr/bin/env node
/**
 * ÉPREUVE DE SÉCURITÉ — ON ESSAIE DE CASSER, PAS DE CONFIRMER.
 *
 * Chaque contrôle décrit CE QU'UN ATTAQUANT TENTERAIT. Un « SÛR » signifie que
 * la tentative a échoué. Une « FAIBLESSE » est un trou réel, pas un avis de
 * style : le script sort en erreur, et le paquet ne doit pas partir.
 *
 * POURQUOI CE SCRIPT VIT DANS LE DÉPÔT. Ces contrôles ont d'abord été écrits à
 * la main, contre un service lancé à part et des comptes créés à la main.
 * Ils ont trouvé six défauts — trois sur la validation des coordonnées, trois
 * sur l'autorisation du journal — puis ils étaient devenus injouables : plus
 * personne n'aurait pu les rejouer après une modification. Un contrôle de
 * sécurité qu'on ne peut pas relancer ne protège rien.
 *
 * Il lance donc son propre service, sur une COPIE des données, avec ses
 * propres comptes, sur un port qui lui est propre. Il n'écrit jamais dans les
 * dossiers du dépôt et ne dépend d'aucune préparation manuelle.
 *
 *   node scripts/verifier-securite.mjs
 *   node scripts/verifier-securite.mjs --donnees donnees-demo
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* Port propre à cette exécution : un service resté d'une exécution précédente
   répondrait à notre place, et le verdict porterait sur le mauvais service. */
const PORT = 8300 + (process.pid % 250);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Epreuve-2026';

let ok = 0;
const faiblesses = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'SÛR    ' : 'FAIBLE '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else faiblesses.push(`${titre}${detail ? ' — ' + detail : ''}`);
};

/* ------------------------------------------------------------------ */
/* Données et comptes d'épreuve                                       */
/* ------------------------------------------------------------------ */

const demande = process.argv.indexOf('--donnees');
const choisi = demande > -1 ? process.argv[demande + 1] : null;
const source = choisi
  ? resolve(ROOT, choisi)
  : existsSync(join(ROOT, 'donnees-production'))
    ? join(ROOT, 'donnees-production')
    : join(ROOT, 'donnees-serveur');

if (!existsSync(source)) {
  console.error(`\nDossier de donnees introuvable : ${source}\n`);
  process.exit(1);
}

const travail = mkdtempSync(join(tmpdir(), 'gr-secu-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });
console.log(`\n  donnees d'epreuve : copie de ${source}`);

/**
 * SIX COMPTES, UN PAR PROFIL QU'ON VEUT METTRE À L'ÉPREUVE.
 *
 * Les trois échelons hiérarchiques sont nécessaires pour éprouver le périmètre
 * du journal : un chef de région ne doit pas voir le pays, un chef de
 * compagnie doit voir SES brigades. Sans les trois, la moitié du contrôle est
 * impossible à écrire.
 */
const COMPTES = [
  { matricule: 'EP-ADMIN', rang: 'admin', unite: 'ep-admin', role: 'commandement', nom: 'Administration' },
  { matricule: 'EP-REG', rang: 'reg', unite: 'Ouarzazate', role: 'commandement', nom: 'Région Ouarzazate' },
  { matricule: 'EP-CIE', rang: 'cie', unite: 'Zagora', role: 'commandement', nom: 'Compagnie Zagora', reg: 'Ouarzazate' },
  { matricule: 'EP-BT', rang: 'unite', unite: 'Agdez', role: 'commandement', nom: 'Brigade Agdez', reg: 'Ouarzazate', cie: 'Zagora' },
  { matricule: 'EP-LECTEUR', rang: 'unite', unite: 'Agdez', role: 'lecture', nom: 'Lecture Agdez', reg: 'Ouarzazate', cie: 'Zagora' },
  { matricule: 'EP-SAISIE', rang: 'unite', unite: 'Agdez', role: 'saisie', nom: 'Saisie Agdez', reg: 'Ouarzazate', cie: 'Zagora' },
  /* Le Super Admin ne pose plus de barrage : le poste « d'autrui » est posé par une autre région. */
  { matricule: 'EP-REG-MRK', rang: 'reg', unite: 'Marrakech', role: 'commandement', nom: 'Région Marrakech' },
];

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of COMPTES) await definirCompte(etat, { ...c, code: CODE });
  enregistrerComptes(f, etat);
}

/* ------------------------------------------------------------------ */
/* Le service                                                         */
/* ------------------------------------------------------------------ */

{
  let occupe = false;
  try {
    await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(1500) });
    occupe = true;
  } catch {
    /* personne : c'est ce qu'on veut */
  }
  if (occupe) {
    console.error(`\nLe port ${PORT} est deja occupe.\n`);
    rmSync(travail, { recursive: true, force: true });
    process.exit(1);
  }
}

const service = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES],
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
let debout = false;
for (let i = 0; i < 360; i++) {
  if (service.exitCode !== null) break;
  try {
    if ((await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(4000) })).ok) {
      debout = true;
      break;
    }
  } catch {
    /* pas encore là */
  }
  await attendre(250);
}
if (!debout) {
  console.error('\nLe service ne démarre pas.\n' + sortieService);
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Outils d'appel                                                     */
/* ------------------------------------------------------------------ */

/** Un plafond par appel : un blocage doit être nommé, pas attendu 300 s. */
const PLAFOND_MS = 30_000;

async function ouvrir(matricule, code) {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code }),
    signal: AbortSignal.timeout(PLAFOND_MS),
  });
  const brutes = r.headers.getSetCookie?.() ?? [];
  return {
    cookie: brutes.map((c) => c.split(';')[0]).join('; '),
    cookieBrut: brutes.join(' | '),
    statut: r.status,
    ...(await r.json().catch(() => ({}))),
  };
}

const appel = (s, chemin, o = {}) =>
  fetch(BASE + chemin, {
    ...o,
    signal: AbortSignal.timeout(PLAFOND_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'gr-carte',
      ...(s?.cookie ? { Cookie: s.cookie } : {}),
      ...(o.headers ?? {}),
    },
  });

/** Ouvre en franchissant le changement de mot de passe imposé s'il l'est. */
async function session(matricule) {
  let s = await ouvrir(matricule, CODE);
  if (s.motDePasseAChanger) {
    await appel(s, '/api/motdepasse', {
      method: 'POST',
      body: JSON.stringify({ nouveau: CODE + 'b', confirmation: CODE + 'b' }),
    });
    s = await ouvrir(matricule, CODE + 'b');
  }
  return s;
}

const corpsDe = async (r) => await r.json().catch(() => ({}));

/** Combien d'enregistrements le FICHIER porte — la référence, hors de l'API. */
const lireItems = (chemin) => {
  try {
    const j = JSON.parse(readFileSync(chemin, 'utf8'));
    return Array.isArray(j.items) ? j.items.length : 0;
  } catch {
    return 0;
  }
};

/** Les repères eux-mêmes, pour distinguer ce qui est en service de ce qui ne l'est plus. */
const lireTous = (chemin) => {
  try {
    const j = JSON.parse(readFileSync(chemin, 'utf8'));
    return Array.isArray(j.items) ? j.items : [];
  } catch {
    return [];
  }
};

let admin;
let reg;
let cie;
let chef;
let lecteur;
let saisie;
let regMarrakech;

try {
  admin = await session('EP-ADMIN');
  reg = await session('EP-REG');
  cie = await session('EP-CIE');
  chef = await session('EP-BT');
  lecteur = await session('EP-LECTEUR');
  saisie = await session('EP-SAISIE');
  regMarrakech = await session('EP-REG-MRK');

  if (admin.statut !== 200 || chef.statut !== 200) {
    throw new Error(`comptes d’épreuve inutilisables (admin ${admin.statut}, brigade ${chef.statut})`);
  }

  /* ================================================================ */
  console.log('\n=== 1. COOKIE DE SESSION ===\n');

  {
    const c = chef.cookieBrut;
    dit(/HttpOnly/i.test(c), 'HttpOnly — le script de page ne peut pas lire le jeton');
    dit(/SameSite=Strict/i.test(c), 'SameSite=Strict — pas d’envoi depuis un autre site');
    dit(/Path=\//i.test(c), 'Path défini');
    /* `Secure` est ATTENDU absent : le service est en HTTP sur un intranet. On
       le note sans le compter comme faiblesse — l'exiger rendrait le cookie
       inopérant, donc l'application inutilisable. */
    console.log(`         (Secure : ${/Secure/i.test(c) ? 'présent' : 'absent — intranet en HTTP'})`);
  }

  /* ================================================================ */
  console.log('\n=== 2. FALSIFICATION DE REQUÊTE (CSRF) ===\n');

  for (const [methode, chemin] of [
    ['POST', '/api/marquages'],
    ['DELETE', '/api/session'],
    ['POST', '/api/motdepasse'],
    ['POST', '/api/comptes'],
  ]) {
    /* Sans l'en-tête `X-Requested-With` : exactement ce qu'un formulaire d'un
       autre site peut envoyer avec le cookie de la victime. */
    const r = await fetch(BASE + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
      body: '{}',
      signal: AbortSignal.timeout(PLAFOND_MS),
    });
    dit(r.status === 403, `${methode} ${chemin.padEnd(20)} sans en-tête d’origine → refusé`, `HTTP ${r.status}`);
  }

  /* ================================================================ */
  console.log('\n=== 3. ESCALADE DE PRIVILÈGES ===\n');

  for (const [s, nom] of [
    [chef, 'chef de brigade'],
    [reg, 'chef de région'],
    [lecteur, 'compte lecture'],
    [saisie, 'compte saisie'],
    [null, 'anonyme'],
  ]) {
    const r = await appel(s, '/api/comptes');
    dit(r.status === 403 || r.status === 401, `${nom.padEnd(18)} ne lit pas /api/comptes`, `HTTP ${r.status}`);

    const c = await appel(s, '/api/comptes', {
      method: 'POST',
      body: JSON.stringify({ rang: 'admin', unite: 'pirate', code: 'Pirate-2026' }),
    });
    dit(c.status === 403 || c.status === 401, `${nom.padEnd(18)} ne CRÉE pas de compte admin`, `HTTP ${c.status}`);

    const j = await appel(s, '/api/journal');
    dit(j.status === 403 || j.status === 401, `${nom.padEnd(18)} ne lit pas la trace nationale`, `HTTP ${j.status}`);
  }

  {
    const r = await appel(lecteur, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({ type: 'barrage_fixe', lat: 30.69697, lng: -6.49292, nom: 'LECTURE' }),
    });
    dit(r.status === 403, 'compte lecture       n’écrit aucun marquage', `HTTP ${r.status}`);
  }

  {
    /* Se hausser en réécrivant son propre compte. */
    const r = await appel(chef, '/api/comptes', {
      method: 'POST',
      body: JSON.stringify({ rang: 'admin', unite: 'Agdez', matricule: 'EP-BT', code: 'x' }),
    });
    dit(r.status === 403, 'chef de brigade      ne se hausse pas en admin', `HTTP ${r.status}`);
    const apres = await ouvrir('EP-BT', 'x');
    dit(apres.statut !== 200, 'et son mot de passe n’a pas changé', `HTTP ${apres.statut}`);
  }

  /* ================================================================ */
  console.log('\n=== 4. TRAVERSÉE DE CHEMIN (fichiers statiques) ===\n');

  for (const chemin of [
    '/../donnees-serveur/comptes.json',
    '/..%2fdonnees-serveur%2fcomptes.json',
    '/dist/../../donnees-serveur/comptes.json',
    '/%2e%2e/%2e%2e/serveur/comptes.mjs',
    '/....//....//donnees-serveur/comptes.json',
  ]) {
    const r = await fetch(BASE + chemin, { signal: AbortSignal.timeout(PLAFOND_MS) });
    const texte = await r.text().catch(() => '');
    const fuite = texte.includes('empreinte') || texte.includes('ITERATIONS');
    dit(!fuite, `${chemin.slice(0, 40).padEnd(42)} ne fuit rien`, `HTTP ${r.status}`);
  }

  /* ================================================================ */
  console.log('\n=== 5. CORPS DE REQUÊTE ABUSIF ===\n');

  {
    /**
     * 5 Mo, au-delà du plafond de 512 Ko — ET DEUX FAÇONS CORRECTES DE REFUSER.
     *
     * Le serveur peut répondre 413 puis fermer, ou couper la connexion pendant
     * que le client écrit encore. Dans ce second cas `fetch` ne rend aucune
     * réponse : il lève, avec `ECONNRESET` ou `EPIPE`. Les deux sont le
     * refus qu'on cherche — la protection a joué, et le corps n'a pas été lu.
     *
     * L'épreuve comptait pourtant la coupure comme un blocage, et s'arrêtait
     * là : sur le jeu de démonstration, où le serveur coupe plus tôt, elle
     * abandonnait à la section 5 et les huit sections suivantes n'étaient
     * jamais jouées. Un contrôle qui échoue sur un comportement correct est
     * pire qu'absent : il masque tout ce qui vient après.
     *
     * SEULE une acceptation (2xx) serait une faiblesse.
     */
    const gros = JSON.stringify({
      type: 'barrage_fixe',
      lat: 30.69697,
      lng: -6.49292,
      nom: 'x'.repeat(5_000_000),
    });
    const t0 = Date.now();
    let verdict;
    try {
      const r = await appel(admin, '/api/marquages', { method: 'POST', body: gros });
      verdict = { refuse: r.status >= 400, detail: `HTTP ${r.status}` };
    } catch (e) {
      const code = e?.cause?.code ?? e?.name ?? 'erreur';
      /* Une coupure est un refus ; un dépassement du plafond d'attente non. */
      verdict = {
        refuse: code !== 'TimeoutError',
        detail: `connexion coupée (${code})`,
      };
    }
    dit(verdict.refuse, 'corps de 5 Mo → refusé', `${verdict.detail} en ${Date.now() - t0} ms`);
  }

  for (const [nom, corps] of [
    ['JSON malformé', '{ceci n est pas du json'],
    ['JSON vide', ''],
    ['tableau au lieu d’objet', '[1,2,3]'],
    ['null', 'null'],
    ['nombre', '42'],
    ['profondeur extrême', '['.repeat(2000) + ']'.repeat(2000)],
  ]) {
    const r = await appel(admin, '/api/marquages', { method: 'POST', body: corps });
    dit(r.status >= 400 && r.status < 500, `${nom.padEnd(24)} → refusé proprement`, `HTTP ${r.status}`);
  }

  /* ================================================================ */
  console.log('\n=== 6. VALIDATION DES COORDONNÉES ET DES TYPES ===\n');

  for (const [nom, corps] of [
    ['type inconnu', { type: 'missile', lat: 30.69697, lng: -6.49292 }],
    ['latitude absente', { type: 'barrage_fixe', lng: -6.49292 }],
    ['latitude texte', { type: 'barrage_fixe', lat: 'nord', lng: -6.49292 }],
    ['latitude NaN', { type: 'barrage_fixe', lat: NaN, lng: -6.49292 }],
    ['latitude hors monde', { type: 'barrage_fixe', lat: 999, lng: -6.49292 }],
    ['coordonnées nulles', { type: 'barrage_fixe', lat: null, lng: null }],
    ['hors de tout territoire', { type: 'barrage_fixe', lat: 0, lng: 0 }],
    ['injection dans le nom', { type: 'barrage_fixe', lat: 30.69697, lng: -6.49292, nom: '<script>alert(1)</script>' }],
    ['prototype pollué', { type: 'barrage_fixe', lat: 30.69697, lng: -6.49292, __proto__: { admin: true } }],
  ]) {
    /* Posé par le chef de brigade : le Super Admin ne pose plus de barrage. */
    const r = await appel(chef, '/api/marquages', { method: 'POST', body: JSON.stringify(corps) });
    const j = await corpsDe(r);
    if (nom === 'injection dans le nom') {
      /* Accepté est CORRECT — c'est du texte. Ce qui compte est qu'il revienne
         tel quel, sans avoir été interprété côté serveur ; React le rendra
         comme texte. */
      dit((r.status === 201 || r.status === 202) && j.item?.nom === corps.nom, 'nom avec balises → stocké comme TEXTE', `HTTP ${r.status}`);
      if (j.item) await appel(chef, `/api/marquages/${j.item.id}`, { method: 'DELETE' });
    } else if (nom === 'prototype pollué') {
      dit(r.status >= 400 || j.item?.admin === undefined, 'clé __proto__ → sans effet', `HTTP ${r.status}`);
      if (j.item) await appel(chef, `/api/marquages/${j.item.id}`, { method: 'DELETE' });
    } else {
      dit(r.status >= 400, `${nom.padEnd(24)} → refusé`, `HTTP ${r.status} ${j.erreur ?? ''}`.slice(0, 74));
    }
  }

  /* ================================================================ */
  console.log('\n=== 7. ACCÈS À UN OBJET D’AUTRUI PAR SON IDENTIFIANT ===\n');

  /* Deux repères : un chez le chef d'Agdez, un ailleurs. Ils servent aussi à
     la section 12. */
  let ailleurs = null;
  let chezSoi = null;

  {
    const r = await appel(regMarrakech, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({ type: 'barrage_fixe', lat: 31.6295, lng: -7.9811, nom: 'AUTRUI' }),
    });
    ailleurs = (await corpsDe(r)).item ?? null;

    const r2 = await appel(chef, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({ type: 'barrage_fixe', lat: 30.69697, lng: -6.49292, nom: 'CHEZ SOI' }),
    });
    chezSoi = (await corpsDe(r2)).item ?? null;
  }

  if (ailleurs && chezSoi) {
    const vus = (await corpsDe(await appel(chef, '/api/marquages'))).items ?? [];
    dit(!vus.some((m) => m.id === ailleurs.id), 'le chef ne VOIT pas le barrage d’une autre région');

    const patch = await appel(chef, `/api/marquages/${ailleurs.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...ailleurs, nom: 'DÉTOURNÉ' }),
    });
    dit(patch.status === 403, 'ne le MODIFIE pas, même avec son identifiant', `HTTP ${patch.status}`);

    const sup = await appel(chef, `/api/marquages/${ailleurs.id}`, { method: 'DELETE' });
    dit(sup.status === 403, 'ne le SUPPRIME pas', `HTTP ${sup.status}`);

    const relu = ((await corpsDe(await appel(admin, '/api/marquages'))).items ?? []).find(
      (m) => m.id === ailleurs.id,
    );
    dit(relu?.nom === 'AUTRUI', 'le barrage est intact', relu?.nom);
  } else {
    dit(false, 'préparation de la section 7 impossible');
  }

  /* ================================================================ */
  console.log('\n=== 8. IDENTIFIANTS FORGÉS ===\n');

  for (const id of ['../../../comptes', 'mq_%00', 'mq_' + 'a'.repeat(5000), '__proto__', 'constructor']) {
    const r = await appel(admin, `/api/marquages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    dit(r.status >= 400 && r.status < 500, `identifiant « ${id.slice(0, 24)} » → refusé`, `HTTP ${r.status}`);
  }

  /* ================================================================ */
  console.log('\n=== 9. ÉNUMÉRATION DE COMPTES ===\n');

  {
    const mesurer = async (matricule) => {
      const t0 = Date.now();
      const r = await fetch(`${BASE}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
        body: JSON.stringify({ matricule, code: 'faux-code-quelconque' }),
        signal: AbortSignal.timeout(PLAFOND_MS),
      });
      return { ms: Date.now() - t0, statut: r.status, corps: await r.json().catch(() => ({})) };
    };

    const connu = await mesurer('EP-ADMIN');
    const inconnu = await mesurer('CE-COMPTE-N-EXISTE-PAS');

    dit(
      connu.corps.erreur === inconnu.corps.erreur,
      'même message pour un compte connu et inconnu',
      JSON.stringify(connu.corps.erreur ?? '').slice(0, 46),
    );
    dit(connu.statut === inconnu.statut, 'même code HTTP', `${connu.statut} / ${inconnu.statut}`);
    const ecart = Math.abs(connu.ms - inconnu.ms);
    dit(ecart < 150, 'temps de réponse comparable', `écart ${ecart} ms`);
  }

  /* ================================================================ */
  console.log('\n=== 10. FUITE D’INFORMATION ===\n');

  {
    const e = await corpsDe(await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(PLAFOND_MS) }));
    dit(!JSON.stringify(e).includes('empreinte'), '/api/etat ne divulgue aucune empreinte');
    dit(!JSON.stringify(e).includes('"sel"'), '/api/etat ne divulgue aucun sel');
    dit(
      !JSON.stringify(e).includes(':\\') && !JSON.stringify(e).includes('/Users/'),
      '/api/etat ne divulgue aucun chemin du serveur',
    );

    const brut = JSON.stringify(await corpsDe(await appel(admin, '/api/comptes')));
    dit(!brut.includes('empreinte'), '/api/comptes ne rend pas les empreintes');
    dit(!brut.includes('"sel"'), '/api/comptes ne rend pas les sels');

    const msg = JSON.stringify(await corpsDe(await appel(admin, '/api/marquages', { method: 'POST', body: '{bad' })));
    dit(
      !msg.includes(':\\') && !msg.includes('/Users/') && !msg.includes('    at '),
      'un message d’erreur ne révèle ni chemin ni pile',
      msg.slice(0, 60),
    );
  }

  /* ================================================================ */
  console.log('\n=== 11. EN-TÊTES DE RÉPONSE ===\n');

  {
    const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(PLAFOND_MS) });
    const h = Object.fromEntries(r.headers);
    dit(!h['x-powered-by'], 'aucun X-Powered-By');
    for (const [nom, cle, attendu] of [
      ['X-Content-Type-Options', 'x-content-type-options', 'nosniff'],
      ['X-Frame-Options', 'x-frame-options', 'DENY'],
      ['Referrer-Policy', 'referrer-policy', 'same-origin'],
    ]) {
      dit(h[cle] === attendu, `${nom.padEnd(24)} = ${attendu}`, h[cle] ?? 'ABSENT');
    }
    const csp = h['content-security-policy'] ?? '';
    dit(csp.includes("script-src 'self'"), 'CSP restreint les scripts au service lui-même');
    dit(csp.includes("frame-ancestors 'none'"), 'CSP interdit la mise en cadre');
    dit(!csp.includes("script-src 'self' 'unsafe-inline'"), 'CSP n’autorise aucun script en ligne');
  }

  /* ================================================================ */
  console.log('\n=== 12. PÉRIMÈTRE DU JOURNAL ===\n');

  /**
   * LE CONTRÔLE QUI MANQUAIT, ET QUI A RÉVÉLÉ LE DÉFAUT.
   *
   * Le filtre du journal s'écrivait, pour un chef de région,
   * `e.unite != null` — « une unité quelconque est renseignée ». Ce n'est pas
   * « une unité de ma région » : il lisait l'activité des 504 brigades du
   * pays. Et pour un chef de compagnie, `e.unite === session.unite` exigeait
   * que l'auteur porte le nom de la compagnie : il ne voyait donc presque
   * rien, pas même ses propres brigades.
   *
   * Faux dans les deux sens, et invisible sans un contrôle qui distingue
   * « la trace nationale » de « l'historique d'un repère ». D'où cette
   * section : elle éprouve les deux lectures pour les trois échelons.
   */
  if (chezSoi && ailleurs) {
    /* a) la trace nationale n'appartient qu'à l'administration */
    dit((await appel(admin, '/api/journal')).status === 200, 'admin            lit la trace nationale');
    for (const [s, nom] of [
      [reg, 'chef de région'],
      [cie, 'chef de compagnie'],
      [chef, 'chef de brigade'],
    ]) {
      const r = await appel(s, '/api/journal');
      dit(r.status === 403, `${nom.padEnd(18)} ne lit PAS la trace nationale`, `HTTP ${r.status}`);
    }

    /* b) l'historique d'un repère suit le périmètre du repère */
    const historique = async (s, id) => {
      const r = await appel(s, `/api/journal?id=${encodeURIComponent(id)}`);
      return { statut: r.status, entrees: (await corpsDe(r)).entrees ?? [] };
    };

    for (const [s, nom] of [
      [chef, 'chef de brigade'],
      [cie, 'chef de compagnie'],
      [reg, 'chef de région'],
      [admin, 'admin'],
    ]) {
      const h = await historique(s, chezSoi.id);
      dit(
        h.statut === 200 && h.entrees.length > 0,
        `${nom.padEnd(18)} VOIT l’historique d’un repère de son périmètre`,
        `HTTP ${h.statut}, ${h.entrees.length} entrée(s)`,
      );
      dit(
        h.entrees.every((e) => e.id === chezSoi.id),
        `${nom.padEnd(18)} ne reçoit que les entrées de CE repère`,
      );
    }

    /* c) et s'arrête à la frontière du périmètre — en 404, non en 403 : dire
          « il existe mais il n'est pas à vous » renseignerait sur le
          dispositif d'autrui. */
    for (const [s, nom] of [
      [chef, 'chef de brigade'],
      [cie, 'chef de compagnie'],
      [reg, 'chef de région'],
    ]) {
      const h = await historique(s, ailleurs.id);
      dit(h.statut === 404, `${nom.padEnd(18)} ne voit PAS l’historique d’un repère d’ailleurs`, `HTTP ${h.statut}`);
      dit(h.entrees.length === 0, `${nom.padEnd(18)} et n’en reçoit aucune entrée`);
    }

    /* d) un identifiant inexistant se comporte comme un identifiant interdit */
    const inconnu = await historique(chef, 'mq_inexistant_000000');
    dit(inconnu.statut === 404, 'un identifiant inconnu → 404, comme un interdit', `HTTP ${inconnu.statut}`);

    /* Ménage. */
    await appel(admin, `/api/marquages/${ailleurs.id}`, { method: 'DELETE' });
    await appel(chef, `/api/marquages/${chezSoi.id}`, { method: 'DELETE' });
  } else {
    dit(false, 'préparation de la section 12 impossible');
  }

  /* ================================================================ */
  console.log('\n=== 13. VUE GLOBALE DE L’ADMINISTRATION, ET SEULEMENT D’ELLE ===\n');

  /**
   * DEUX EXIGENCES OPPOSÉES, ET C'EST LE MÊME CONTRÔLE.
   *
   * L'administration doit TOUT voir — sans quoi elle ne peut ni arbitrer ni
   * corriger. Chaque échelon hiérarchique ne doit voir QUE son périmètre —
   * sans quoi le dispositif d'une région est lisible par une autre.
   *
   * Les deux se vérifient sur la même réponse : ce que `/api/marquages` rend à
   * chacun. On les écrit ensemble parce que satisfaire l'une en cassant
   * l'autre est l'erreur naturelle, et qu'un contrôle qui n'en regarde qu'une
   * ne la verrait pas.
   *
   * Rédigé pour tenir sur les DEUX jeux de données : en production tout est à
   * zéro, et un contrôle qui exigerait des nombres stricts y passerait sans
   * rien éprouver. On éprouve donc des RELATIONS — inclusion et périmètre —
   * plus le fait que l'administration ne perd rien.
   */
  {
    const vus = async (s) => ((await corpsDe(await appel(s, '/api/marquages'))).items ?? []);

    const tous = await vus(admin);
    const deReg = await vus(reg);
    const deCie = await vus(cie);
    const deBt = await vus(chef);

    console.log(
      `         vus : admin ${tous.length}, région ${deReg.length}, ` +
        `compagnie ${deCie.length}, brigade ${deBt.length}`,
    );

    dit(deBt.every((m) => m.bt === 'Agdez'), 'la brigade ne voit QUE sa brigade', `${deBt.length} repère(s)`);
    dit(deCie.every((m) => m.cie === 'Zagora'), 'la compagnie ne voit QUE sa compagnie', `${deCie.length}`);
    dit(deReg.every((m) => m.reg === 'Ouarzazate'), 'la région ne voit QUE sa région', `${deReg.length}`);

    /* Emboîtement : ce que voit l'échelon du bas, l'échelon du haut le voit. */
    const ids = (l) => new Set(l.map((m) => m.id));
    const inclus = (a, b) => [...ids(a)].every((id) => ids(b).has(id));
    dit(inclus(deBt, deCie), 'la compagnie voit tout ce que voit sa brigade');
    dit(inclus(deCie, deReg), 'la région voit tout ce que voit sa compagnie');
    dit(inclus(deReg, tous), 'l’administration voit tout ce que voit la région');

    /**
     * Et elle ne perd rien : le fichier et sa vue portent le même compte —
     * SUR LE DISPOSITIF EN SERVICE.
     *
     * `/api/marquages` ne rend pas les postes sortis du service : `supprime`
     * depuis toujours (ils restent lisibles par `?archives=1`), et
     * `retire_optimisation` depuis l'optimisation automatique. Ce n'est pas une
     * perte, c'est la définition de la liste opérationnelle — la carte, les
     * distances et les rosters ne doivent voir que ce qui est tenu.
     *
     * Le compteur les ignorait, si bien que la première optimisation appliquée
     * sur un jeu de données faisait échouer ce contrôle en annonçant une
     * « faiblesse » là où le serveur faisait exactement son travail. Il compte
     * donc désormais la même chose que la route, et le contrôle suivant
     * vérifie que les exclus sont toujours DANS le fichier.
     */
    const HORS_SERVICE = ['supprime', 'retire_optimisation'];
    const itemsDisque = lireTous(join(DONNEES, 'marquages.json'));
    const surDisque = itemsDisque.filter((m) => !HORS_SERVICE.includes(m.statutBarrage)).length;
    const horsService = itemsDisque.length - surDisque;
    dit(
      tous.length === surDisque,
      'l’administration voit TOUS les repères en service',
      `${tous.length} vus / ${surDisque} en service${
        horsService ? ` (+${horsService} hors service, conservés au fichier)` : ''
      }`,
    );
    /* RIEN N'EST EFFACÉ : les hors-service sont absents de la liste, pas du
       fichier. C'est la garantie que l'optimisation et la suppression ne
       détruisent aucune donnée. */
    dit(
      itemsDisque.length >= tous.length,
      'et aucun repère n’a disparu du fichier',
      `${itemsDisque.length} ligne(s) au total`,
    );

    /* Sur un jeu peuplé, la hiérarchie doit RÉELLEMENT restreindre — sinon le
       contrôle ci-dessus serait vrai sans rien prouver. */
    if (surDisque > 0) {
      dit(tous.length > deReg.length, 'et strictement plus qu’une seule région', `${tous.length} > ${deReg.length}`);
      dit(deReg.length >= deCie.length && deCie.length >= deBt.length, 'la restriction est monotone');
    } else {
      console.log('         (jeu vide : la restriction stricte ne peut pas être éprouvée ici)');
    }
  }

  /* ================================================================ */
  console.log('\n=== 14. UNE ÉCRITURE NE REND JAMAIS PLUS QU’UNE LECTURE ===\n');

  /**
   * LA RÈGLE, ET LA FAUTE QU'ELLE ATTRAPE.
   *
   * Plusieurs routes d'écriture renvoient le dispositif à jour, pour que la
   * carte se remette d'aplomb sans second aller-retour. Trois d'entre elles le
   * renvoyaient AVEC `depot.tous()` — le dépôt entier — au lieu de
   * `visibles(session, …)`.
   *
   * Conséquence mesurée : un chef de région qui acceptait un retrait recevait
   * les 1 123 barrages du pays, quand son compte ne lui en montre que 82. Le
   * dispositif des vingt-sept autres régions lui était livré par une réponse
   * d'écriture.
   *
   * ET CELA SE VOYAIT À L'ÉCRAN, ce qui a mis la faute au jour : la carte pose
   * ce tableau tel quel (`setItems(r.items)`). Accepter UN retrait remplaçait
   * donc 82 repères par 1 123 ; le poste supprimé disparaissait bien, mais
   * noyé sous mille autres. La suppression paraissait ne pas s'appliquer, et il
   * fallait recharger la page — qui rappelle `/api/marquages`, filtré — pour
   * voir le dispositif correct. Une fuite de périmètre et un défaut d'affichage
   * n'étaient qu'une seule et même faute.
   *
   * D'où l'invariant, valable pour TOUTE réponse d'écriture : ce qu'elle rend
   * doit être inclus dans ce qu'une lecture rendrait à la même session.
   */
  {
    const lus = async (s) => ((await corpsDe(await appel(s, '/api/marquages'))).items ?? []);

    const duReg = await lus(reg);
    console.log(`         le chef de région voit ${duReg.length} repère(s) en lecture`);

    /**
     * Le scénario complet, parce que c'est le seul qui exerce la route :
     * l'ADMIN propose un retrait (lui seul en a le droit), le COMMANDANT
     * accepte. C'est l'acceptation qui renvoyait le pays entier.
     */
    /**
     * DEUX POSTES PROCHES, POSÉS POUR L'ÉPREUVE — par le chef de région, validés
     * par l'administration. Sans eux, la route d'acceptation ne s'exerçait que
     * si un reste d'une section précédente traînait par hasard à Agdez.
     */
    for (const [k, dLat] of [[1, 0.004], [2, 0.012]]) {
      const pose = await corpsDe(await appel(reg, '/api/marquages', {
        method: 'POST',
        body: JSON.stringify({ type: 'barrage_fixe', lat: 30.69697 + dLat, lng: -6.49292, nom: `EPREUVE PROCHE ${k}` }),
      }));
      if (pose.demande?.id) {
        await appel(admin, `/api/instructions/${pose.demande.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'accepter' }) });
      }
    }
    const calc = await appel(admin, '/api/barrages/consolidation', {
      method: 'POST',
      body: JSON.stringify({
        distanceMinKm: 5,
        niveau: 'region',
        unite: 'Ouarzazate',
        positionVille: null,
        accidents: false,
        seuilAccidents: 0,
        vip: false,
        nonEclaire: false,
      }),
    });
    const postesCalcules = (await corpsDe(calc)).barrages ?? [];

    /**
     * LE PÉRIMÈTRE DEMANDÉ PEUT RESSERRER, JAMAIS ÉLARGIR.
     *
     * Le corps de la requête était entièrement ignoré dès que le rang imposait
     * un périmètre : un chef de région recevait sa région entière, même après
     * être descendu dans UNE de ses compagnies. Il peut désormais demander une
     * unité CONTENUE dans la sienne — et rien d'autre. Les trois contrôles
     * suivants éprouvent les deux sens, et le cas de l'unité inventée.
     */
    const consolide = async (compte, corps) =>
      corpsDe(
        await appel(compte, '/api/barrages/consolidation', {
          method: 'POST',
          body: JSON.stringify({
            distanceMinKm: 5,
            positionVille: null,
            accidents: false,
            seuilAccidents: 0,
            vip: false,
            nonEclaire: false,
            ...corps,
          }),
        }),
      );

    const sienne = postesCalcules.find((b) => b.cie);
    if (sienne) {
      const resserre = await consolide(reg, { niveau: 'compagnie', unite: sienne.cie });
      dit(
        resserre.parametres?.niveau === 'compagnie' && resserre.parametres?.unite === sienne.cie,
        'le chef de région RESSERRE sur une compagnie de sa région',
        `${resserre.parametres?.niveau} ${resserre.parametres?.unite}`,
      );
      dit(
        (resserre.barrages ?? []).every((b) => b.cie === sienne.cie),
        'et le calcul ne porte que sur elle',
        `${(resserre.barrages ?? []).length} poste(s)`,
      );
    }

    /* Une unité d'AILLEURS ne doit rien ouvrir : on retombe sur sa région. */
    const tous = await lus(admin);
    const etrangere = tous.find((b) => b.cie && b.reg && b.reg !== 'Ouarzazate');
    if (etrangere) {
      const vol = await consolide(reg, { niveau: 'compagnie', unite: etrangere.cie });
      dit(
        vol.parametres?.niveau === 'region' && vol.parametres?.unite === 'Ouarzazate',
        'mais PAS sur une compagnie d’une autre région — retour à son périmètre',
        `${vol.parametres?.niveau} ${vol.parametres?.unite}`,
      );
      dit(
        (vol.barrages ?? []).every((b) => b.reg === 'Ouarzazate'),
        'et aucun poste étranger n’entre dans le calcul',
        `${(vol.barrages ?? []).length} poste(s)`,
      );
    }

    /* Un échelon PLUS LARGE est ignoré de la même façon. */
    const plusLarge = await consolide(reg, { niveau: 'national', unite: '' });
    dit(
      plusLarge.parametres?.niveau === 'region' && plusLarge.parametres?.unite === 'Ouarzazate',
      'ni sur le national demandé par un chef de région',
      `${plusLarge.parametres?.niveau} ${plusLarge.parametres?.unite}`,
    );

    const cible = postesCalcules.find(
      (b) => b.sousLeSeuil && b.intouchable !== true && b.decision === 'aucune',
    );

    if (!cible) {
      console.log(
        '         (aucun poste à trancher dans ce jeu : la route d’acceptation ne\n' +
          '          peut pas être exercée ici — voir --donnees donnees-demo)',
      );
    } else {
      /**
       * 1. La proposition — par le CMND Région, sur un poste de SA région.
       *
       * Le Super Admin ne modifie plus les barrages : il les assigne au
       * commandement, qui arbitre. Son arbitrage par lot est donc refusé — et
       * c'est le chef de région qui propose le retrait.
       */
      const parAdmin = await corpsDe(await appel(admin, '/api/barrages/lot', {
        method: 'POST',
        body: JSON.stringify({ action: 'proposer_suppression', ids: [cible.id], criteres: null }),
      }));
      dit(
        (parAdmin.traites ?? 0) === 0,
        'le Super Admin n’arbitre plus un barrage (il l’assigne)',
        `${parAdmin.traites ?? 0} traité(s)`,
      );
      const lot = await appel(reg, '/api/barrages/lot', {
        method: 'POST',
        body: JSON.stringify({ action: 'proposer_suppression', ids: [cible.id], criteres: null }),
      });
      const itemsLot = (await corpsDe(lot)).items ?? [];
      const duReg = await lus(reg);
      dit(
        itemsLot.length <= duReg.length,
        'POST /api/barrages/lot ne rend pas plus que la lecture',
        `${itemsLot.length} rendus / ${duReg.length} visibles`,
      );

      /**
       * 1 bis. L'ARBITRAGE D'UN CHEF SUR SON PROPRE PÉRIMÈTRE.
       *
       * `conserver` / `proposer_suppression` / `reconsiderer` passent par cette
       * route, qui était réservée aux administrateurs : un chef de région
       * lançait l'optimisation, voyait les propositions, cliquait
       * « Conserver »… et recevait 403. L'autorité porte désormais sur le
       * PÉRIMÈTRE et non sur le rang — ce qui est plus strict, et c'est ce que
       * les deux contrôles suivants vérifient dans les deux sens.
       */
      /**
       * SUR UN AUTRE POSTE QUE `cible` — la suite du scénario en dépend.
       *
       * `reconsiderer` referme la notification ouverte par la proposition ; le
       * jouer sur `cible` privait l'épreuve d'acceptation, deux contrôles plus
       * bas, de la notification qu'elle attend. Elle échouait alors pour une
       * raison qui n'avait rien à voir avec ce qu'elle éprouve.
       */
      const autreSien = postesCalcules.find((b) => b.id !== cible.id) ?? cible;
      const sien = await appel(reg, '/api/barrages/lot', {
        method: 'POST',
        body: JSON.stringify({ action: 'conserver', ids: [autreSien.id], criteres: null }),
      });
      const corpsSien = await corpsDe(sien);
      dit(
        sien.status === 200 && corpsSien.traites === 1,
        'le chef de région ARBITRE un poste de sa région',
        `HTTP ${sien.status}, ${corpsSien.traites ?? 0} traité(s)`,
      );
      /* Remis comme on l'a trouvé : la suite du scénario attend « aucune ». */
      await appel(reg, '/api/barrages/lot', {
        method: 'POST',
        body: JSON.stringify({ action: 'reconsiderer', ids: [autreSien.id], criteres: null }),
      });

      /* Et le même geste sur un poste d'ailleurs ne doit RIEN produire. */
      const tousAdmin = await lus(admin);
      const ailleurs = tousAdmin.find((b) => b.reg && b.reg !== autreSien.reg && b.type?.startsWith('barrage'));
      if (ailleurs) {
        const vol = await appel(reg, '/api/barrages/lot', {
          method: 'POST',
          body: JSON.stringify({ action: 'conserver', ids: [ailleurs.id], criteres: null }),
        });
        const corpsVol = await corpsDe(vol);
        const apres = (await lus(admin)).find((b) => b.id === ailleurs.id);
        dit(
          (corpsVol.traites ?? 0) === 0 && apres?.decisionOptimisation === ailleurs.decisionOptimisation,
          'mais PAS un poste d’une autre région — rien n’est écrit',
          `${corpsVol.traites ?? 0} traité(s), décision inchangée (${apres?.decisionOptimisation})`,
        );
      }

      /* La validation, elle, reste le privilège de l'administration. */
      const validation = await appel(reg, '/api/barrages/lot', {
        method: 'POST',
        body: JSON.stringify({ action: 'approuver', ids: [autreSien.id] }),
      });
      dit(
        validation.status === 403,
        'et n’APPROUVE pas : la validation reste à l’administration',
        `HTTP ${validation.status}`,
      );

      /* 2. L'acceptation par le commandant — la faute était ici. */
      const notifs = (await corpsDe(await appel(reg, '/api/instructions'))).items ?? [];
      /**
       * LA PROPOSITION DE RETRAIT, et pas n'importe quelle notification.
       *
       * Ce `find` prenait la PREMIÈRE notification du barrage, quelle qu'elle
       * soit. Un même poste en porte plusieurs — sa pose (`nouveau_barrage`),
       * un arbitrage, une demande de modification — et l'épreuve acceptait
       * alors l'approbation de la pose en croyant accepter le retrait : le
       * poste restait, et l'échec accusait le produit d'une faute qui était
       * dans l'épreuve.
       */
      const n = notifs.find(
        (x) => x.barrageId === cible.id && x.action === 'suppression' && x.statut === 'ouverte',
      );

      if (!n) {
        dit(false, 'la proposition crée bien une notification pour le commandant');
      } else {
        const acc = await appel(reg, `/api/instructions/${n.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'accepter', commentaire: 'épreuve' }),
        });
        const itemsAcc = (await corpsDe(acc)).items ?? [];

        dit(
          itemsAcc.every((m) => m.reg === 'Ouarzazate'),
          'PATCH /api/instructions/:id ne rend que le périmètre de l’appelant',
          `${itemsAcc.filter((m) => m.reg !== 'Ouarzazate').length} repère(s) hors région sur ${itemsAcc.length}`,
        );
        dit(
          itemsAcc.length < duReg.length,
          `et le poste accepté a bien disparu de la réponse (HTTP ${acc.status})`,
          `${itemsAcc.length} après / ${duReg.length} avant`,
        );
        dit(
          !itemsAcc.some((m) => m.id === cible.id),
          'le poste retiré n’est plus dans la réponse d’écriture',
        );

        /* 3. Et la lecture qui suit dit la même chose — sans quoi le
              navigateur afficherait deux vérités selon le geste. */
        const apres = await lus(reg);
        dit(
          apres.length === itemsAcc.length,
          'la lecture qui suit rend exactement le même compte',
          `lecture ${apres.length} / écriture ${itemsAcc.length}`,
        );
      }
    }
  }

  /* ================================================================ */
  console.log('\n=== 15. SESSION FERMÉE, JETON MORT ===\n');

  {
    const s = await session('EP-BT');
    await appel(s, '/api/session', { method: 'DELETE' });
    for (const [chemin, methode] of [
      ['/api/marquages', 'GET'],
      ['/api/marquages', 'POST'],
      ['/api/journal?id=x', 'GET'],
      ['/api/roster?bt=Agdez', 'GET'],
    ]) {
      const r = await appel(s, chemin, {
        method: methode,
        ...(methode === 'POST' ? { body: JSON.stringify({ type: 'barrage_fixe', lat: 30.7, lng: -6.5 }) } : {}),
      });
      dit(r.status === 401, `${methode.padEnd(4)} ${chemin.padEnd(22)} refusé après déconnexion`, `HTTP ${r.status}`);
    }
  }
  /* ================================================================== */
  console.log('\n=== 16. VALIDATION DES MODIFICATIONS DE BARRAGE ===\n');

  {
    /**
     * LA CHAÎNE COMPLÈTE, ÉPROUVÉE DE BOUT EN BOUT.
     *
     *   demande (une unité)  →  confirmation (administration)  →  réclamation
     *
     * Ce qui est vérifié ici n'est pas que l'écran affiche la bonne chose,
     * mais que le SERVEUR refuse ce qu'il doit refuser et n'écrit que ce qu'il
     * doit écrire. Le point critique est le premier : tant que la confirmation
     * n'a pas eu lieu, le barrage officiel ne bouge pas d'un champ.
     */
    const lire = async (compte, id) =>
      ((await corpsDe(await appel(compte, '/api/marquages'))).items ?? []).find((m) => m.id === id);

    const dossier = async (compte) =>
      ((await corpsDe(await appel(compte, '/api/instructions'))).items ?? []).filter(
        (i) => i.action === 'modification' || i.action === 'reclamation',
      );

    /* Un poste neuf dans le périmètre de la compagnie d'épreuve. */
    const pose = await appel(cie, '/api/marquages', {
      method: 'POST',
      body: JSON.stringify({
        type: 'barrage_fixe',
        lat: 30.69697,
        lng: -6.49292,
        nom: 'POSTE VALIDATION',
        route: 'RN-T',
      }),
    });
    const poste = (await corpsDe(pose)).item;

    if (!poste) {
      dit(false, 'un poste d’épreuve peut être posé par la compagnie', `HTTP ${pose.status}`);
    } else {
      /* --- 1. La demande n'applique rien --- */
      const demande = await appel(cie, `/api/marquages/${poste.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nom: 'NOM DEMANDE', motif: 'correction de la plaque' }),
      });
      const corpsDemande = await corpsDe(demande);
      dit(
        demande.status === 202,
        'une modification par la compagnie n’est PAS appliquée',
        `HTTP ${demande.status}`,
      );
      const apresDemande = await lire(cie, poste.id);
      dit(
        apresDemande?.nom === 'POSTE VALIDATION',
        'le barrage officiel garde son ancienne valeur',
        `nom = ${apresDemande?.nom}`,
      );
      dit(
        corpsDemande.demande?.statut === 'ouverte' && corpsDemande.demande?.decision === null,
        'la demande est EN ATTENTE',
        `statut ${corpsDemande.demande?.statut}`,
      );
      const idDemande = corpsDemande.demande?.id;

      /* --- 5 et 6. Ni la région ni la brigade ne confirment --- */
      for (const [nom, compte] of [
        ['région', reg],
        ['brigade', chef],
      ]) {
        const essai = await appel(compte, `/api/instructions/${idDemande}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'accepter' }),
        });
        dit(
          essai.status === 403,
          `le chef de ${nom} ne confirme pas une modification`,
          `HTTP ${essai.status}`,
        );
      }
      const toujoursIntact = await lire(cie, poste.id);
      dit(toujoursIntact?.nom === 'POSTE VALIDATION', 'et le barrage n’a toujours pas bougé');

      /* --- 2. L'administration confirme : la modification prend effet --- */
      const confirme = await appel(admin, `/api/instructions/${idDemande}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter', reponse: 'correction acceptée' }),
      });
      dit(confirme.status === 200, 'l’administration confirme', `HTTP ${confirme.status}`);
      const applique = await lire(admin, poste.id);
      dit(
        applique?.nom === 'NOM DEMANDE',
        'le barrage officiel porte enfin la nouvelle valeur',
        `nom = ${applique?.nom}`,
      );
      const apresConfirmation = (await dossier(admin)).find((d) => d.id === idDemande);
      dit(
        apresConfirmation?.decision === 'acceptee' && apresConfirmation?.statut === 'traitee',
        'la demande passe à CONFIRMÉE, et garde ses deux valeurs',
        `${apresConfirmation?.changements?.[0]?.ancienne} → ${apresConfirmation?.changements?.[0]?.nouvelle}`,
      );

      /* --- 8. Deuxième confirmation : refusée, sans double écriture --- */
      const rejoue = await appel(admin, `/api/instructions/${idDemande}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter' }),
      });
      dit(rejoue.status >= 400, 'une demande déjà tranchée ne se rejoue pas', `HTTP ${rejoue.status}`);

      /* --- 4. La région réclame : rien n'est défait --- */
      const reclam = await appel(reg, `/api/instructions/${idDemande}/reclamation`, {
        method: 'POST',
        body: JSON.stringify({ motif: 'plaque erronée', commentaire: 'le nom d’origine était juste' }),
      });
      const corpsReclam = await corpsDe(reclam);
      dit(
        reclam.status === 201,
        'le chef de région peut réclamer un changement confirmé',
        `HTTP ${reclam.status}`,
      );
      const apresReclamation = await lire(admin, poste.id);
      dit(apresReclamation?.nom === 'NOM DEMANDE', 'la réclamation ne défait PAS la modification');
      dit(
        corpsReclam.reclamation?.modificationId === idDemande &&
          corpsReclam.reclamation?.statut === 'ouverte',
        'elle pointe la modification et reste en attente',
      );
      const chaine = await dossier(admin);
      dit(
        chaine.some((d) => d.id === idDemande) && chaine.some((d) => d.action === 'reclamation'),
        'la chaîne demande → confirmation → réclamation reste entière',
        `${chaine.length} pièce(s) au dossier`,
      );

      /* --- 3. Un refus n'écrit rien --- */
      const seconde = await corpsDe(
        await appel(cie, `/api/marquages/${poste.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ route: 'RN-MODIFIEE' }),
        }),
      );
      const refus = await appel(admin, `/api/instructions/${seconde.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'refuser', reponse: 'non justifié' }),
      });
      dit(refus.status === 200, 'l’administration refuse une demande', `HTTP ${refus.status}`);
      const apresRefus = await lire(admin, poste.id);
      dit(
        apresRefus?.route === 'RN-T',
        'et le barrage garde sa valeur d’origine',
        `route = ${apresRefus?.route}`,
      );
      const refusee = (await dossier(admin)).find((d) => d.id === seconde.demande?.id);
      dit(
        refusee?.decision === 'refusee',
        'la demande refusée reste à l’historique',
        `décision ${refusee?.decision}`,
      );

      /* --- 7. Hors périmètre : refusé avant même d'ouvrir une demande --- */
      const tous = (await corpsDe(await appel(admin, '/api/marquages'))).items ?? [];
      const etranger = tous.find(
        (m) => m.reg && m.reg !== 'Ouarzazate' && String(m.type).startsWith('barrage'),
      );
      if (etranger) {
        const vol = await appel(reg, `/api/marquages/${etranger.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ nom: 'TENTATIVE' }),
        });
        dit(
          vol.status === 403 || vol.status === 404,
          'un poste hors périmètre ne se demande même pas',
          `HTTP ${vol.status}`,
        );
        const intact = await lire(admin, etranger.id);
        dit(intact?.nom === etranger.nom, 'et il garde son nom');
      }

      /* Ménage : le poste d'épreuve ne reste pas dans le jeu. */
      await appel(admin, `/api/marquages/${poste.id}`, { method: 'DELETE' });
    }
  }

  /* ================================================================== */
  console.log('\n=== 17. LA VALIDATION VA DANS LES DEUX SENS ===\n');

  {
    /**
     * LA VALIDATION — c'est elle qu'on éprouve ici.
     *
     *   une unité écrit         →  l'administration confirme
     *   le Super Admin          →  n'écrit pas : il assigne au CMND Région
     *
     * Un chef de région qui découvre qu'un poste de sa région a changé ou
     * disparu sans qu'il en ait rien su n'a plus de dispositif à commander.
     * Le Super Admin garde l'autorité : il propose, et le commandement répond.
     */
    const lire = async (compte, id) =>
      ((await corpsDe(await appel(compte, '/api/marquages'))).items ?? []).find((m) => m.id === id);

    /* Un poste posé par la COMPAGNIE : l'administration n'en est pas l'auteur,
       elle devra donc passer par une demande pour y toucher. */
    const pose = await corpsDe(
      await appel(cie, '/api/marquages', {
        method: 'POST',
        body: JSON.stringify({
          type: 'barrage_fixe',
          lat: 30.69712,
          lng: -6.49305,
          nom: 'POSTE SYMETRIE',
          route: 'RN-S',
        }),
      }),
    );
    const poste = pose.item;

    if (!poste) {
      dit(false, 'un poste d’épreuve peut être posé', 'pose refusée');
    } else {
      /* --- LE SUPER ADMIN NE MODIFIE PAS : il ASSIGNE au CMND Région --- */
      const parAdmin = await appel(admin, `/api/marquages/${poste.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nom: 'RENOMME PAR ADMIN' }),
      });
      dit(parAdmin.status === 403, 'le Super Admin ne modifie pas un barrage (403)', `HTTP ${parAdmin.status}`);
      const intact = await lire(admin, poste.id);
      dit(intact?.nom === 'POSTE SYMETRIE', 'le barrage officiel n’a pas bougé');

      const assignation = await corpsDe(await appel(admin, '/api/barrages/assigner', {
        method: 'POST',
        body: JSON.stringify({ ids: [poste.id], texte: 'renommer le poste' }),
      }));
      const versRegion = assignation.assignees?.[0];
      dit(Boolean(versRegion?.instructionId), 'il l’assigne au CMND Région qui le porte', `région ${versRegion?.region}`);
      const parLaBrigade = await appel(chef, `/api/instructions/${versRegion?.instructionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ commentaire: 'vu' }),
      });
      dit(parLaBrigade.status === 403, 'le chef de brigade ne traite pas une assignation', `HTTP ${parLaBrigade.status}`);

      /* Le commandement modifie : une unité demande, l'administration valide. */
      const demandeRegion = await corpsDe(await appel(reg, `/api/marquages/${poste.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nom: 'RENOMME PAR LA REGION' }),
      }));
      dit(demandeRegion.demande?.aDecider === 'admin', 'la modification du CMND Région part en validation à l’administration',
        `aDecider = ${demandeRegion.demande?.aDecider}`);
      const autoValidation = await appel(reg, `/api/instructions/${demandeRegion.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter' }),
      });
      dit(autoValidation.status === 403, 'le commandement ne contresigne pas sa propre demande', `HTTP ${autoValidation.status}`);
      const parAdminValide = await appel(admin, `/api/instructions/${demandeRegion.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter', reponse: 'vu et accepté' }),
      });
      dit(parAdminValide.status === 200, 'l’administration valide', `HTTP ${parAdminValide.status}`);
      const applique = await lire(admin, poste.id);
      dit(applique?.nom === 'RENOMME PAR LA REGION', 'et la modification du commandement prend alors effet', `nom = ${applique?.nom}`);
      const traite = await appel(reg, `/api/instructions/${versRegion?.instructionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ commentaire: 'poste renommé' }),
      });
      dit(traite.status === 200, 'le CMND Région marque l’assignation traitée', `HTTP ${traite.status}`);

      /* --- SUPPRESSION PAR UNE UNITÉ : l'administration tranche --- */
      const retraitDemande = await appel(cie, `/api/marquages/${poste.id}`, { method: 'DELETE' });
      const corpsRetrait = await corpsDe(retraitDemande);
      dit(
        retraitDemande.status === 202,
        'une suppression par la compagnie n’efface rien',
        `HTTP ${retraitDemande.status}`,
      );
      dit(
        corpsRetrait.demande?.aDecider === 'admin' && corpsRetrait.demande?.action === 'suppression',
        'elle ouvre une demande de retrait pour l’administration',
        `aDecider = ${corpsRetrait.demande?.aDecider}`,
      );
      dit(Boolean(await lire(admin, poste.id)), 'le barrage est toujours là');

      /* Refus : le poste reste. */
      const refuse = await appel(admin, `/api/instructions/${corpsRetrait.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'refuser', reponse: 'poste nécessaire' }),
      });
      dit(refuse.status === 200, 'l’administration refuse le retrait', `HTTP ${refuse.status}`);
      dit(Boolean(await lire(admin, poste.id)), 'et le barrage reste en service');

      /* Nouvelle demande, acceptée cette fois : le retrait a lieu. */
      const seconde = await corpsDe(
        await appel(cie, `/api/marquages/${poste.id}`, { method: 'DELETE' }),
      );
      const accepte = await appel(admin, `/api/instructions/${seconde.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter', reponse: 'retrait validé' }),
      });
      dit(accepte.status === 200, 'l’administration accepte le retrait', `HTTP ${accepte.status}`);
      dit(!(await lire(admin, poste.id)), 'le barrage est alors réellement retiré');
    }

    /* --- Même son PROPRE poste passe par une demande --- */
    const sien = await corpsDe(
      await appel(cie, '/api/marquages', {
        method: 'POST',
        body: JSON.stringify({
          type: 'barrage_fixe',
          lat: 30.6972,
          lng: -6.4931,
          nom: 'POSTE A DEFAIRE',
        }),
      }),
    );
    if (sien.item) {
      /**
       * AUCUNE EXEMPTION POUR L'AUTEUR.
       *
       * Une première version laissait chacun défaire son propre poste sans
       * validation — pour qu'une erreur de saisie s'efface vite. Elle vidait
       * la règle : l'auteur pouvait ensuite modifier son poste autant qu'il
       * voulait, indéfiniment. L'erreur se corrige donc par une demande de
       * retrait, acceptée par l'autre bord.
       */
      const efface = await appel(cie, `/api/marquages/${sien.item.id}`, { method: 'DELETE' });
      dit(
        efface.status === 202,
        'même son propre poste passe par une demande de retrait',
        `HTTP ${efface.status}`,
      );
      const demandeRetrait = (await corpsDe(efface)).demande;
      await appel(admin, `/api/instructions/${demandeRetrait?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter', reponse: 'ménage de l’épreuve' }),
      });
    }
  }

  /* ================================================================== */
  console.log('\n=== 18. SUPPRESSION AVEC VALIDATION — LE POSTE NE DISPARAÎT PAS ===\n');

  {
    /**
     * CE QU'ON ÉPROUVE ICI : qu'aucun clic ne détruit une donnée.
     *
     *   demande  →  le poste reste, marqué « suppression en attente »
     *   refus    →  il redevient exactement ce qu'il était
     *   accord   →  il sort du service, mais reste au fichier avec sa place,
     *               son rattachement, sa date de création, et la trace de qui
     *               l'a retiré.
     */
    const actifs = async (compte) =>
      (await corpsDe(await appel(compte, '/api/marquages'))).items ?? [];
    const avecArchives = async (compte) =>
      (await corpsDe(await appel(compte, '/api/marquages?archives=1'))).items ?? [];
    const lire = async (compte, id) => (await avecArchives(compte)).find((m) => m.id === id);

    const pose = await corpsDe(
      await appel(cie, '/api/marquages', {
        method: 'POST',
        body: JSON.stringify({
          type: 'barrage_fixe',
          lat: 30.6974,
          lng: -6.4933,
          nom: 'POSTE A RETIRER',
          route: 'RN-R',
        }),
      }),
    );
    const poste = pose.item;

    if (!poste) {
      dit(false, 'un poste d’épreuve peut être posé', 'pose refusée');
    } else {
      const avant = await lire(cie, poste.id);

      /* --- 1. La demande ne détruit rien --- */
      const demande = await appel(cie, `/api/marquages/${poste.id}`, { method: 'DELETE' });
      const corpsDemande = await corpsDe(demande);
      dit(demande.status === 202, 'la demande de suppression n’efface rien', `HTTP ${demande.status}`);

      const enAttente = await lire(cie, poste.id);
      dit(Boolean(enAttente), 'le barrage est toujours dans les données');
      dit(
        enAttente?.decisionOptimisation === 'a_supprimer',
        'il porte l’état « suppression en attente »',
        `decisionOptimisation = ${enAttente?.decisionOptimisation}`,
      );
      dit(
        enAttente?.id === avant.id &&
          enAttente?.lat === avant.lat &&
          enAttente?.lng === avant.lng &&
          enAttente?.bt === avant.bt &&
          enAttente?.cie === avant.cie &&
          enAttente?.reg === avant.reg &&
          enAttente?.cree === avant.cree,
        'et garde identifiant, position, rattachement et date de création',
      );
      dit(
        (await actifs(cie)).some((m) => m.id === poste.id),
        'il reste visible tant que la décision n’est pas rendue',
      );

      /* --- 2. Le refus restaure exactement l'état d'avant --- */
      const refus = await appel(admin, `/api/instructions/${corpsDemande.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'refuser', reponse: 'poste nécessaire' }),
      });
      dit(refus.status === 200, 'l’administration refuse la suppression', `HTTP ${refus.status}`);
      const restaure = await lire(cie, poste.id);
      dit(
        restaure?.decisionOptimisation === 'aucune',
        'le barrage redevient ACTIF, sans geste de l’utilisateur',
        `decisionOptimisation = ${restaure?.decisionOptimisation}`,
      );
      for (const champ of ['id', 'lat', 'lng', 'type', 'nom', 'route', 'bt', 'cie', 'reg', 'cree', 'statutBarrage']) {
        if (restaure?.[champ] !== avant?.[champ]) {
          dit(false, `la restauration rend le champ « ${champ} » à l’identique`, `${avant?.[champ]} → ${restaure?.[champ]}`);
        }
      }
      dit(
        ['id', 'lat', 'lng', 'type', 'nom', 'route', 'bt', 'cie', 'reg', 'cree', 'statutBarrage'].every(
          (c) => restaure?.[c] === avant?.[c],
        ),
        'restauré à l’identique — rien à recréer à la main',
      );

      /* --- 6. Un compte non autorisé ne tranche pas --- */
      const secondeDemande = await corpsDe(
        await appel(cie, `/api/marquages/${poste.id}`, { method: 'DELETE' }),
      );
      const parLaBrigade = await appel(chef, `/api/instructions/${secondeDemande.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter' }),
      });
      dit(
        parLaBrigade.status === 403,
        'un compte non autorisé n’accepte pas une suppression',
        `HTTP ${parLaBrigade.status}`,
      );
      const parLAuteur = await appel(cie, `/api/instructions/${secondeDemande.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter' }),
      });
      dit(
        parLAuteur.status === 403,
        'et son auteur ne la valide pas lui-même',
        `HTTP ${parLAuteur.status}`,
      );

      /* --- 3. L'acceptation retire du service sans effacer --- */
      const accepte = await appel(admin, `/api/instructions/${secondeDemande.demande?.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'accepter', reponse: 'retrait validé' }),
      });
      dit(accepte.status === 200, 'l’administration accepte la suppression', `HTTP ${accepte.status}`);

      const archive = await lire(admin, poste.id);
      dit(Boolean(archive), 'le barrage EXISTE toujours dans les données');
      dit(
        archive?.statutBarrage === 'supprime',
        'son état dit qu’il est retiré du service',
        `statutBarrage = ${archive?.statutBarrage}`,
      );
      dit(
        archive?.lat === avant.lat && archive?.lng === avant.lng && archive?.cree === avant.cree,
        'sa position et sa date de création sont conservées',
      );
      dit(
        Boolean(archive?.supprimeLe) && Boolean(archive?.supprimePar?.matricule),
        'on sait QUI l’a retiré et QUAND',
        `${archive?.supprimePar?.matricule} — ${archive?.supprimeLe}`,
      );
      dit(
        !(await actifs(admin)).some((m) => m.id === poste.id),
        'il ne figure plus parmi les barrages actifs',
      );
      dit(
        (await avecArchives(admin)).some((m) => m.id === poste.id),
        'mais reste consultable par ?archives=1',
      );

      /* L'historique complet reste au dossier. */
      const dossier = ((await corpsDe(await appel(admin, '/api/instructions'))).items ?? []).filter(
        (i) => i.barrageId === poste.id,
      );
      dit(
        dossier.some((i) => i.decision === 'refusee') && dossier.some((i) => i.decision === 'acceptee'),
        'le dossier garde le refus ET l’acceptation',
        `${dossier.length} pièce(s)`,
      );

      /**
       * ET TOUT CELA SURVIT À UN REDÉMARRAGE — parce que c'est écrit sur le
       * disque, pas tenu en mémoire.
       *
       * On lit le fichier du service, celui qu'il relira au prochain
       * démarrage : c'est la seule chose qu'un redémarrage change, et la voir
       * sur le disque vaut la preuve qu'on cherche.
       */
      const surDisque = JSON.parse(
        readFileSync(join(travail, 'donnees', 'marquages.json'), 'utf8'),
      );
      const archiveDisque = (surDisque.items ?? []).find((m) => m.id === poste.id);
      dit(
        archiveDisque?.statutBarrage === 'supprime' && archiveDisque?.lat === avant.lat,
        'l’état et la position sont PERSISTÉS : un redémarrage les retrouve',
        `statutBarrage = ${archiveDisque?.statutBarrage}`,
      );
      const dossierDisque = JSON.parse(
        readFileSync(join(travail, 'donnees', 'instructions.json'), 'utf8'),
      );
      dit(
        (dossierDisque.items ?? []).filter((i) => i.barrageId === poste.id).length >= 2,
        'et l’historique aussi',
      );
    }
  }

} catch (e) {
  dit(false, 'l’épreuve se déroule sans blocage', e?.message ?? String(e));
  console.error('\n--- journal du service ---\n' + sortieService.slice(-2000));
} finally {
  service.kill();
  rmSync(travail, { recursive: true, force: true });
}

/* ================================================================== */

console.log(`\n  ${ok} contrôle(s) sûr(s), ${faiblesses.length} faiblesse(s)`);
if (faiblesses.length) {
  console.error('\nFAIBLESSES :');
  for (const f of faiblesses) console.error('  - ' + f);
  console.error('');
  process.exit(1);
}
console.log('\nAucune faiblesse détectée par cette épreuve.\n');
