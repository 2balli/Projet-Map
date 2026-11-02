#!/usr/bin/env node
/**
 * « MODIFIER / DÉPLACER UN BARRAGE » DANS LE VRAI ÉCRAN — Chrome réel, clics réels.
 *
 *   Carte → rechercher le barrage → bulle → Modifier → Déplacer → clic sur
 *   la nouvelle position → aperçu (recalage, route, territoire, distance
 *   routière) → Annuler (rien d'écrit) → Déplacer → clic → Enregistrer
 *   (PATCH /api/marquages/:id) → validation par le bord opposé → rouvrir le
 *   barrage → nouvelles valeurs ; intouchable non déplaçable ; factions F1–F4.
 *
 * Aucune dépendance : Chrome (ou Edge) est piloté par le protocole DevTools
 * (CDP), avec le `WebSocket` natif de Node. Le service est lancé sur une
 * COPIE du jeu de démonstration, et sert `dist/` — lancez `npm run build`
 * avant si l'écran a changé.
 *
 *   node scripts/verifier-modification-barrage-ecran.mjs [--chrome <chemin>] [--captures <dossier>]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 ? process.argv[i + 1] : defaut;
};
const CHROME = arg(
  'chrome',
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((c) => existsSync(c)),
);
const CAPTURES = arg('captures', null);
const PORT = 8700 + (process.pid % 200);
const CDP = 9300 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Essai-Ecran-2026';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

if (!CHROME) {
  console.error('\nAucun Chrome/Edge trouvé : passez --chrome <chemin>.\n');
  process.exit(1);
}
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('\ndist/ absent : lancez `npm run build` d’abord.\n');
  process.exit(1);
}

/* ------------------------------ données ------------------------------ */
const travail = mkdtempSync(join(tmpdir(), 'gr-ecran-'));
const DONNEES = join(travail, 'donnees');
cpSync(join(ROOT, 'donnees-demo'), DONNEES, {
  recursive: true,
  filter: (f) => !/sauvegardes|\.avant-semis-|\.reparti-par-journee/.test(f),
});
const items = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items;
const personnel = JSON.parse(readFileSync(join(DONNEES, 'effectifs.json'), 'utf8')).items;
const estIntouchable = (m) => m?.protection === 'intouchable' || m?.intouchable === true;
const bfi = items.find((m) => estIntouchable(m) && m.cie === 'Agadir' && m.nom) ?? items.find(estIntouchable);
const B = items.find(
  (m) => m.type === 'barrage_fixe' && m.cie === bfi.cie && !estIntouchable(m) && /^(RN|RR|A)\d/.test(m.route ?? '') &&
    m.nom && personnel.filter((p) => p.bt === m.bt).length >= 6,
);
console.log(`\n  barrage d'épreuve : ${B.id} « ${B.nom} » (${B.route}, ${B.bt}/${B.cie}) — intouchable actuel ${bfi.id}`);
{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  await definirCompte(etat, { matricule: 'ECRAN-ADMIN', rang: 'admin', unite: 'ecran-admin', nom: 'Admin écran', role: 'commandement', code: CODE });
  await definirCompte(etat, { matricule: 'ECRAN-CIE', rang: 'cie', unite: B.cie, reg: B.reg, nom: 'Cdt compagnie écran', role: 'commandement', code: CODE });
  enregistrerComptes(f, etat);
}

/* ------------------------------ service ------------------------------ */
const service = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES], { cwd: ROOT });
let sortie = '';
service.stdout.on('data', (d) => (sortie += d));
service.stderr.on('data', (d) => (sortie += d));
for (let i = 0; i < 360; i++) {
  try {
    if ((await fetch(`${BASE}/api/etat`)).ok) break;
  } catch {
    /* pas encore */
  }
  await attendre(250);
}

/* ------------------------------ Chrome ------------------------------ */
const profil = join(travail, 'profil');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profil}`,
  '--window-size=1500,950', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
]);
let cible = null;
for (let i = 0; i < 120 && !cible; i++) {
  try {
    cible = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {
    /* pas encore */
  }
  if (!cible) await attendre(250);
}
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nId = 0;
const enCours = new Map();
const consoleErreurs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && enCours.has(m.id)) {
    const { res, rej } = enCours.get(m.id);
    enCours.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleErreurs.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  }
});
const cdp = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nId;
    enCours.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const attendreQue = async (expr, ms = 30000, quoi = expr) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    try {
      /* Un nœud DOM ne se rend pas « par valeur » : on le ramène à `true`. */
      const v = await js(`(() => { const v = (${expr}); return typeof Node !== 'undefined' && v instanceof Node ? true : v; })()`);
      if (v) return v;
    } catch {
      /* page en cours de chargement */
    }
    await attendre(200);
  }
  throw new Error(`délai dépassé : ${quoi}`);
};
let nCapture = 0;
const capture = async (nom) => {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(CAPTURES, `${String(++nCapture).padStart(2, '0')}-${nom}.png`), Buffer.from(data, 'base64'));
};

/* Outils injectés dans la page : trouver un bouton par son texte, saisir dans
   un champ React (le setter natif, puis l'événement que React écoute). */
const OUTILS = `window.__t = {
  btn: (txt, racine = document) => [...racine.querySelectorAll('button')].find((b) => b.textContent.replace(/\\s+/g, ' ').trim().includes(txt)),
  /* Le bouton dont le texte est EXACTEMENT celui-là : la bulle porte aussi
     « Modifier l'effectif », qui mène ailleurs. */
  exact: (txt, racine = document) => [...racine.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === txt),
  panneau: () => document.querySelector('[data-testid=modifier-barrage]'),
  champ: (libelle) => {
    const lab = [...__t.panneau().querySelectorAll('label')].find((l) => l.textContent.includes(libelle));
    return lab && lab.querySelector('input,select');
  },
  saisir: (el, v) => {
    const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  },
  texte: () => __t.panneau()?.innerText ?? '',
  cellule: (libelle, col) => {
    const tr = [...__t.panneau().querySelectorAll('table.gr-tbl tr')].find((r) => r.cells[0]?.textContent.trim() === libelle);
    return tr?.cells[col]?.textContent.trim();
  },
};`;

const connecter = async (matricule) => {
  await cdp('Page.navigate', { url: BASE + '/' });
  await attendreQue(`document.readyState === 'complete'`);
  await js(`fetch('api/session', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule: '${matricule}', code: '${CODE}' }) }).then((r) => r.status)`);
  await cdp('Page.reload');
  await attendreQue(`document.querySelector('.leaflet-container') && document.querySelector('[aria-label="Rechercher"]')`, 60000, 'carte chargée');
  await js(OUTILS);
  /* TOUTES LES FACTIONS : la carte n'affiche par défaut que la faction en
     service à l'heure du serveur. Sans cela, l'épreuve échoue ou réussit selon
     l'heure à laquelle on la lance — le barrage visé n'a pas de repère à cliquer. */
  await attendreQue(`document.querySelector('[aria-label="Filtrer par faction"]')`, 30000, 'filtre faction');
  await js(`document.querySelector('[aria-label="Filtrer par faction"]').click()`);
  await attendreQue(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Toutes les factions'))`, 5000);
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Toutes les factions')).click()`);
  await attendre(800);
};

const ouvrirBarrage = async (nom) => {
  await js(`document.querySelector('[aria-label="Rechercher"]').click()`);
  await attendreQue(`document.querySelector('input[aria-label^="Rechercher un barrage"]')`);
  await js(`__t.saisir(document.querySelector('input[aria-label^="Rechercher un barrage"]'), ${JSON.stringify(nom)})`);
  await attendreQue(`[...document.querySelectorAll('button')].some((b) => b.textContent.includes(${JSON.stringify(nom)}) && !b.closest('.leaflet-popup'))`, 10000, 'résultat de recherche');
  await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes(${JSON.stringify(nom)}) && !b.closest('.leaflet-popup')).click()`);
  const bulle = `__t.exact('Modifier', document.querySelector('.leaflet-popup') ?? document.createElement('div'))`;
  const ouverte = await attendreQue(bulle, 6000).catch(() => false);
  if (!ouverte) {
    /* La bulle ne s'est pas ouverte seule (vol de caméra encore en cours) :
       on clique le repère, comme le ferait l'utilisateur. */
    await attendre(800);
    const r = await js(`(() => { const e = [...document.querySelectorAll('.leaflet-marker-icon')].find((x) => x.getAttribute('title') === ${JSON.stringify(nom)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (r) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await attendreQue(bulle, 15000, 'bulle du barrage');
  }
};

const apiAdmin = async (matricule = 'ECRAN-ADMIN') => {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code: CODE }),
  });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  return (chemin, o = {}) =>
    fetch(BASE + chemin, { ...o, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: cookie } }).then((x) => x.json());
};

/* =============================================================== */
try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  const admin = await apiAdmin();
  const surServeur = async () => (await admin('/api/marquages')).items.find((m) => m.id === B.id);
  const reseau = [];
  await cdp('Network.enable');
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') reseau.push(`${m.params.request.method} ${m.params.request.url}`);
  });

  /* Où le repère du barrage est-il dessiné ? (coordonnées écran de son icône) */
  const iconeB = `(() => { const e = [...document.querySelectorAll('.leaflet-marker-icon')].find((x) => x.getAttribute('title') === ${JSON.stringify(B.nom)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; })()`;
  const cliquerCarte = async (fx, fy) => {
    const pt = await js(`(() => { const r = document.querySelector('.leaflet-container').getBoundingClientRect(); return { x: r.left + r.width * ${fx}, y: r.top + r.height * ${fy} }; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    }
  };
  const carteDepl = `document.querySelector('[data-testid=deplacement-barrage]')`;
  const texteDepl = `(${carteDepl}?.innerText ?? '')`;

  console.log('\n=== Sélection → Modifier → Déplacer ===');
  await connecter('ECRAN-CIE');
  await ouvrirBarrage(B.nom);
  await capture('bulle');
  await js(`__t.exact('Modifier', document.querySelector('.leaflet-popup')).click()`);
  await attendreQue(`__t.panneau()`, 10000, 'panneau Modifier barrage');
  dit(true, 'Modifier ouvre le panneau du barrage');
  await capture('panneau-modifier');
  const avant = await surServeur();
  const posEcranAvant = await js(iconeB);
  reseau.length = 0;
  await js(`__t.exact('Déplacer', __t.panneau()).click()`);
  await attendreQue(`${carteDepl} && !__t.panneau()`, 10000, 'mode déplacement');
  dit(/Cliquez sur la carte pour choisir la nouvelle position/.test(await js(texteDepl)),
    'consigne « Cliquez sur la carte pour choisir la nouvelle position »');
  dit(await js(`document.querySelector('.leaflet-container').style.cursor === 'crosshair'`), 'curseur en croix sur la carte');
  await capture('mode-deplacement');

  console.log('\n=== Clic sur la nouvelle position → aperçu ===');
  await cliquerCarte(0.62, 0.42);
  await attendreQue(`/Nouvelle position/.test(${texteDepl}) && !/…/.test(${texteDepl}.split('Région')[1] ?? '…')`, 60000, 'aperçu calculé');
  const texte = await js(texteDepl);
  dit(/Position actuelle[\s\S]*Nouvelle position/.test(texte), 'aperçu Position actuelle → Nouvelle position');
  dit(/recalé à \d+ m du clic/.test(texte), 'point recalé sur la route réelle', texte.match(/Route[^\n]*/)?.[0]);
  dit(/Distance routière\s*\n?\s*[\d.,]+\s*(km|m)/.test(texte), 'distance routière affichée', texte.match(/Distance routière[^\n]*\n?[^\n]*/)?.[0]?.replace(/\s+/g, ' '));
  dit(/Région · Cie · Brigade\s*\n?\s*[^—\n]+ · [^—\n]+ · [^—\n]+/.test(texte), 'région / compagnie / brigade recalculées', texte.match(/Région · Cie · Brigade[^\n]*\n?[^\n]*/)?.[0]?.replace(/\s+/g, ' '));
  const posEcranApres = await js(iconeB);
  dit(posEcranAvant && posEcranApres && (posEcranAvant.x !== posEcranApres.x || posEcranAvant.y !== posEcranApres.y),
    'le barrage est déplacé visuellement tout de suite', `${JSON.stringify(posEcranAvant)} → ${JSON.stringify(posEcranApres)}`);
  const ecrits = reseau.filter((r) => !r.startsWith('GET'));
  dit(ecrits.length === 0, 'aucune écriture serveur avant « Enregistrer »', ecrits.join(' | '));
  dit(!reseau.some((r) => /modification\/apercu/.test(r)), 'plus aucun appel à /modification/apercu');
  const pendant = await surServeur();
  dit(pendant.lng === avant.lng && pendant.lat === avant.lat, 'position serveur inchangée');
  await capture('apercu');

  console.log('\n=== Annuler ===');
  await js(`__t.exact('Annuler', ${carteDepl}).click()`);
  await attendreQue(`!${carteDepl}`, 5000, 'aperçu refermé');
  const posAnnule = await js(iconeB);
  dit(posAnnule && posAnnule.x === posEcranAvant.x && posAnnule.y === posEcranAvant.y, 'le barrage revient à sa place');
  const apresAnnul = await surServeur();
  dit(apresAnnul.lng === avant.lng && apresAnnul.lat === avant.lat && apresAnnul.maj === avant.maj, 'rien n’a été écrit');

  console.log('\n=== Clic hors route → refus ===');
  await ouvrirBarrage(B.nom);
  /* « Déplacer » vit désormais dans « Traiter » (effacer, déplacer, changer la faction). */
  await js(`__t.exact('Traiter ▾', document.querySelector('.leaflet-popup')).click()`);
  await js(`__t.exact('Déplacer le barrage', document.querySelector('.leaflet-popup')).click()`);
  await attendreQue(carteDepl, 5000, 'mode déplacement depuis la bulle');
  dit(true, '« Traiter → Déplacer le barrage » directement depuis la bulle');
  /* Ouest d'Agadir : l'Atlantique, sans route à 5 km. On dézoome d'abord pour
     que le bord gauche de la carte tombe en pleine mer. */
  const centre = await js(`(() => { const r = document.querySelector('.leaflet-container').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: centre.x, y: centre.y, deltaX: 0, deltaY: 700 });
  await attendre(1500);
  await capture('avant-clic-mer');
  await cliquerCarte(0.12, 0.62);
  const motif = await attendreQue(`(${texteDepl}.match(/Aucune route[^\\n]*|hors de votre périmètre[^\\n]*|aucune brigade[^\\n]*/) ?? [])[0]`, 30000, 'refus').catch(() => null);
  dit(Boolean(motif) && (await js(`__t.btn('Enregistrer la nouvelle position', ${carteDepl}).disabled`)),
    'point invalide : Enregistrer bloqué, motif affiché', motif ?? '');
  await capture('refus');

  console.log('\n=== Nouveau clic → Enregistrer la nouvelle position ===');
  await js(`__t.exact('Annuler', ${carteDepl}).click()`);
  await ouvrirBarrage(B.nom);
  /* « Déplacer » vit désormais dans « Traiter » (effacer, déplacer, changer la faction). */
  await js(`__t.exact('Traiter ▾', document.querySelector('.leaflet-popup')).click()`);
  await js(`__t.exact('Déplacer le barrage', document.querySelector('.leaflet-popup')).click()`);
  await attendreQue(carteDepl, 5000);
  await cliquerCarte(0.62, 0.42);
  await attendreQue(`/Nouvelle position/.test(${texteDepl}) && !__t.btn('Enregistrer la nouvelle position', ${carteDepl}).disabled`, 60000, 'aperçu prêt');
  const nouvelle = await js(`${texteDepl}.match(/Nouvelle position\\s*\\n?\\s*([-\\d.]+), ([-\\d.]+)/).slice(1).map(Number)`);
  const routeProposee = await js(`${texteDepl}.match(/→ ([^\\s·]+)/)?.[1]`);
  const terr = await js(`${texteDepl}.match(/Région · Cie · Brigade\\s*\\n?\\s*([^\\n]+)/)[1].split(' · ')`);
  reseau.length = 0;
  await js(`__t.btn('Enregistrer la nouvelle position', ${carteDepl}).click()`);
  await attendreQue(`!${carteDepl}`, 20000, 'aperçu refermé après enregistrement');
  const message = await attendreQue(`[...document.querySelectorAll('[role=status]')].map((e) => e.textContent).find((t) => /déplacement transmis|repositionné/.test(t))`, 10000, 'compte rendu');
  dit(true, 'enregistré, compte rendu affiché', message.trim());
  const ecritures = reseau.filter((r) => !r.startsWith('GET'));
  dit(ecritures.length === 1 && new RegExp(`PATCH .*/api/marquages/${B.id}$`).test(ecritures[0]),
    'UNE écriture : PATCH /api/marquages/:id (route existante)', ecritures.join(' | '));

  /* Règle existante : un déplacement par une unité est validé par l'administration. */
  const notifs = await admin('/api/instructions');
  const demande = (notifs.items ?? []).find((n) => n.barrageId === B.id && n.statut === 'ouverte' && n.action === 'modification');
  dit(Boolean(demande), 'demande de validation ouverte', demande?.changements.map((c) => c.champ).join(', '));
  const acc = await admin(`/api/instructions/${demande.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'accepter', commentaire: 'épreuve écran' }) });
  dit(acc.instruction?.decision === 'acceptee', 'validée par l’administration');
  const persiste = await surServeur();
  dit(persiste.lat === nouvelle[0] && persiste.lng === nouvelle[1] && persiste.latitude === nouvelle[0] && persiste.longitude === nouvelle[1],
    'latitude / longitude persistées = celles de l’aperçu', `${persiste.lat}, ${persiste.lng}`);
  dit(persiste.bt === terr[2] && persiste.cie === terr[1] && persiste.reg === terr[0], 'brigade / compagnie / région = celles de l’aperçu',
    `${persiste.reg} · ${persiste.cie} · ${persiste.bt}`);
  dit(persiste.brigadeId === persiste.bt && persiste.compagnieId === persiste.cie && persiste.regionId === persiste.reg, 'brigadeId / compagnieId / regionId cohérents');
  dit(persiste.route === routeProposee, 'route persistée = route de recalage de l’aperçu', `${persiste.route} (aperçu : ${routeProposee})`);
  dit(Number.isFinite(persiste.pk) || !/^(A|RN|RR|RP)/.test(routeProposee ?? ''), 'PK recalculé par le serveur sur cette route', `${persiste.route} PK ${persiste.pk}`);
  dit(!demande.changements.some((c) => c.champ === 'sousType'), 'la demande ne porte que ce qui a changé');

  console.log('\n=== Rouvrir le barrage ===');
  await connecter('ECRAN-CIE');
  await ouvrirBarrage(B.nom);
  await js(`__t.exact('Modifier', document.querySelector('.leaflet-popup')).click()`);
  await attendreQue(`__t.panneau()`, 10000);
  const affiche = await js('__t.texte()');
  dit(affiche.includes(`${persiste.lat.toFixed(5)} / ${persiste.lng.toFixed(5)}`) && affiche.includes(`PK ${persiste.pk}`),
    'le panneau rouvert montre la nouvelle position et le PK', affiche.match(/Position actuelle[^\n]*\n?[^\n]*/)?.[0]?.replace(/\s+/g, ' '));
  await capture('rouvert');
  await js(`__t.btn('Annuler', __t.panneau()).click()`);

  console.log('\n=== Intouchable : pas de déplacement manuel (règle existante) ===');
  await ouvrirBarrage(bfi.nom);
  await js(`__t.exact('Traiter ▾', document.querySelector('.leaflet-popup')).click()`);
  dit(await js(`__t.exact('Déplacer le barrage', document.querySelector('.leaflet-popup'))?.disabled === true`), '« Déplacer le barrage » désactivé dans la bulle d’un intouchable');
  await js(`__t.exact('Modifier', document.querySelector('.leaflet-popup')).click()`);
  await attendreQue(`__t.panneau()`, 10000);
  dit(await js(`__t.exact('Déplacer', __t.panneau()).disabled`) && /position est définitive/.test(await js('__t.texte()')),
    '« Déplacer » désactivé et expliqué dans le panneau');
  await capture('intouchable');
  await js(`__t.btn('Annuler', __t.panneau()).click()`);
  /* Par le CMND CIE : le Super Admin est refusé d'emblée (il supervise) ; c'est
     la règle de l'intouchable qu'on éprouve ici. */
  const forcer = await (await apiAdmin('ECRAN-CIE'))(`/api/marquages/${bfi.id}`, { method: 'PATCH', body: JSON.stringify({ lng: bfi.lng + 0.01, lat: bfi.lat }) });
  dit(/ne peut pas être déplacé/.test(forcer.erreur ?? ''), 'le serveur refuse aussi le déplacement d’un intouchable', forcer.erreur);

  console.log('\n=== Factions F1–F4 : l’intouchable reste visible ===');
  for (const f of ['F1', 'F2', 'F3', 'F4']) {
    await js(`document.querySelector('[aria-label="Filtrer par faction"]').click()`);
    await attendreQue(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Faction ${f.slice(1)}'))`, 5000, `option ${f}`);
    await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Faction ${f.slice(1)}')).click()`);
    await attendre(700);
    dit(await js(`[...document.querySelectorAll('.leaflet-marker-icon')].some((e) => e.getAttribute('title') === ${JSON.stringify(bfi.nom)})`),
      `faction ${f} : l’intouchable est affiché`);
  }
  dit(consoleErreurs.length === 0, 'aucune exception JavaScript dans la page', consoleErreurs.slice(0, 2).join(' | '));
} catch (e) {
  dit(false, 'le parcours se déroule sans blocage', e?.message ?? String(e));
  await capture('echec').catch(() => {});
  console.error(sortie.slice(-2000));
} finally {
  try {
    ws.close();
  } catch {
    /* déjà fermé */
  }
  chrome.kill();
  service.kill();
  await attendre(500);
  rmSync(travail, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(`\n  ${ok} réussi(s), ${echecs.length} échoué(s)`);
console.log(`  Validation frontend réelle : ${echecs.length ? 'FAIL' : 'PASS'}\n`);
if (echecs.length) process.exit(1);
