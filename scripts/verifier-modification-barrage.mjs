#!/usr/bin/env node
/**
 * « MODIFIER / DÉPLACER UN BARRAGE » DE BOUT EN BOUT — position, route, PK,
 * territoire (par PATCH /api/marquages/:id, le seul chemin de déplacement),
 * effectif et intouchable (par POST /api/barrages/:id/modification),
 * distance, optimisation, RBAC, journal.
 *
 * Même méthode que scripts/verifier-cycle.mjs : le script lance SON service,
 * sur une COPIE du jeu de démonstration, et ne parle qu'à lui par HTTP. Chaque
 * vérification relit l'état après coup (liste des marquages, disque, journal)
 * — une réponse 200 n'est pas une preuve d'enregistrement.
 *
 * LA VALIDATION À DEUX BORDS EST ÉPROUVÉE, PAS CONTOURNÉE. Une modification
 * de barrage par une unité part en demande vers l'administration, et
 * inversement (voir `validateurPour` dans serveur/api.mjs). Chaque épreuve
 * enregistre donc, constate que RIEN n'a bougé, fait accepter la demande par
 * le bord opposé, puis constate que TOUT a bougé ensemble.
 *
 *   node scripts/verifier-modification-barrage.mjs
 *   npm run check:modification
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';
import { chargerGrapheRoutier } from '../serveur/distances.mjs';
import { positionAuPk, recalerPosition } from '../serveur/pointKilometrique.mjs';
import { accrocher, refArete } from '../serveur/routage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8300 + (process.pid % 250);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Essai-Modif-2026';

let ok = 0;
const echecs = [];
const parTest = new Map();
let testCourant = '';
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(`${testCourant} : ${titre}`);
  if (!parTest.has(testCourant)) parTest.set(testCourant, true);
  if (!bon) parTest.set(testCourant, false);
};
const test = (titre) => {
  testCourant = titre;
  console.log(`\n=== ${titre} ===`);
};

/* ------------------------------------------------------------------ */
/* Données d'épreuve et comptes                                       */
/* ------------------------------------------------------------------ */

const demande = process.argv.indexOf('--donnees');
const source = resolve(ROOT, demande > -1 ? process.argv[demande + 1] : 'donnees-demo');
const travail = mkdtempSync(join(tmpdir(), 'gr-modif-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, {
  recursive: true,
  filter: (f) => !/sauvegardes|\.avant-semis-|\.reparti-par-journee/.test(f),
});
console.log(`\n  données d'épreuve : copie de ${source}`);

const marquagesDisque = () => JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items;
const personnel = JSON.parse(readFileSync(join(DONNEES, 'effectifs.json'), 'utf8')).items;
const personnelParBt = new Map();
for (const p of personnel) personnelParBt.set(p.bt, (personnelParBt.get(p.bt) ?? 0) + 1);

const estIntouchable = (m) => m?.protection === 'intouchable' || m?.intouchable === true || m?.type === 'barrage_vip';
const enService = (m) => m.statutBarrage !== 'supprime' && m.statutBarrage !== 'retire_optimisation';

/* LA COMPAGNIE D'ÉPREUVE : un intouchable, et au moins trois postes ordinaires
   sur des routes du réseau, répartis sur deux brigades dotées de personnel. */
const graphe = chargerGrapheRoutier(join(ROOT, 'public', 'layers', 'graphe_routier.json'));
const tous0 = marquagesDisque().filter((m) => m.type === 'barrage_fixe' && enService(m));
let CIE = null;
for (const cie of [...new Set(tous0.map((m) => m.cie))].sort()) {
  const ordinaires = tous0.filter(
    (m) => m.cie === cie && !estIntouchable(m) && personnelParBt.get(m.bt) >= 6 &&
      /^(RN|RR|A)\d/.test(m.route ?? '') && !recalerPosition(graphe, m.lng, m.lat, { route: m.route }).erreur,
  );
  const bfi = tous0.find((m) => m.cie === cie && estIntouchable(m));
  if (bfi && new Set(ordinaires.map((m) => m.bt)).size >= 2 && ordinaires.length >= 3) {
    CIE = { nom: cie, reg: bfi.reg, bfi, ordinaires };
    break;
  }
}
if (!CIE) {
  console.error('\nAucune compagnie du jeu ne se prête à l’épreuve.\n');
  process.exit(1);
}
const B = CIE.ordinaires[0];
const C = CIE.ordinaires.find((m) => m.bt !== B.bt && m.route !== B.route) ??
  CIE.ordinaires.find((m) => m.bt !== B.bt);
/* D change de ROUTE et de BRIGADE au test 3 : on le prend hors de la route et
   de la brigade de C. */
const D = CIE.ordinaires.find((m) => m.id !== B.id && m.id !== C.id && m.route !== C.route && m.bt !== C.bt) ??
  CIE.ordinaires.find((m) => m.id !== B.id && m.id !== C.id);
const autreCie = tous0.find((m) => m.cie !== CIE.nom && m.reg !== CIE.reg && !estIntouchable(m));
console.log(`  compagnie ${CIE.nom} — intouchable ${CIE.bfi.id}, postes ${B.id} (${B.bt}), ${C.id} (${C.bt}), ${D.id}`);

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  const compte = (o) => definirCompte(etat, { role: 'commandement', code: CODE, doitChanger: false, ...o });
  await compte({ matricule: 'MODIF-ADMIN', rang: 'admin', unite: 'modif-admin', nom: 'Admin épreuve' });
  await compte({ matricule: 'MODIF-CIE', rang: 'cie', unite: CIE.nom, reg: CIE.reg, nom: 'Cdt compagnie épreuve' });
  await compte({ matricule: 'MODIF-BT', rang: 'unite', unite: B.bt, cie: CIE.nom, reg: CIE.reg, nom: 'Cdt brigade B' });
  await compte({ matricule: 'MODIF-BT2', rang: 'unite', unite: C.bt, cie: CIE.nom, reg: CIE.reg, nom: 'Cdt brigade C' });
  await compte({ matricule: 'MODIF-AUTRE', rang: 'cie', unite: autreCie.cie, reg: autreCie.reg, nom: 'Cdt autre compagnie' });
  await compte({ matricule: 'MODIF-LECT', rang: 'cie', unite: CIE.nom, reg: CIE.reg, nom: 'Lecture', role: 'lecture' });
  enregistrerComptes(f, etat);
}

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

const service = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--donnees', DONNEES],
  { cwd: ROOT },
);
let sortieService = '';
service.stdout.on('data', (d) => (sortieService += d));
service.stderr.on('data', (d) => (sortieService += d));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let debout = false;
for (let i = 0; i < 360 && service.exitCode === null; i++) {
  try {
    if ((await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(3000) })).ok) {
      debout = true;
      break;
    }
  } catch {
    /* pas encore */
  }
  await attendre(250);
}
if (!debout) {
  console.error('\nLe service ne démarre pas.\n' + sortieService);
  service.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

async function ouvrir(matricule) {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code: CODE }),
  });
  if (!r.ok) throw new Error(`connexion ${matricule} : HTTP ${r.status}`);
  return { cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') };
}
async function appel(s, chemin, { methode = 'GET', corps } = {}) {
  const r = await fetch(BASE + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: s.cookie },
    body: corps ? JSON.stringify(corps) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { statut: r.status, ...(await r.json().catch(() => ({}))) };
}
/* Les deux chemins d'écriture, et eux seuls :
     — DÉPLACER : PATCH /api/marquages/:id (la route de modification existante) ;
     — EFFECTIF / PROTECTION : POST /api/barrages/:id/modification. */
const deplacer = (s, id, corps) => appel(s, `/api/marquages/${id}`, { methode: 'PATCH', corps });
const enregistrer = (s, id, corps) => appel(s, `/api/barrages/${id}/modification`, { methode: 'POST', corps });
const accepter = (s, demandeId) =>
  appel(s, `/api/instructions/${demandeId}`, { methode: 'PATCH', corps: { action: 'accepter', commentaire: 'épreuve' } });
const relire = async (s, id) => (await appel(s, '/api/marquages')).items?.find((m) => m.id === id);

/** Les confirmations qu'un 409 de /modification réclame, données telles quelles. */
const confirmer = (ap) => ({
  accepterConflits: ap?.confirmerConflits === true,
  ...(ap?.intouchableExistant ? { remplacerIntouchable: ap.intouchableExistant.id } : {}),
});

/**
 * ÉCRIT puis FAIT VALIDER : le bord opposé accepte la demande. Rend la fiche
 * relue après acceptation, et vérifie qu'entre-temps rien n'a bougé.
 */
async function ecrireEtValider(ecrire, validateur, id, libelle) {
  const avant = marquagesDisque().find((m) => m.id === id);
  const r = await ecrire();
  dit(r.statut === 202 && r.enAttente === true, `${libelle} : une seule demande de validation`, `HTTP ${r.statut} ${r.erreur ?? ''}`);
  if (r.statut !== 202) return { r, relu: null };
  const pendant = marquagesDisque().find((m) => m.id === id);
  dit(pendant.lng === avant.lng && pendant.lat === avant.lat && pendant.protection === avant.protection &&
    pendant.route === avant.route, `${libelle} : rien n'est appliqué avant validation`);
  const a = await accepter(validateur, r.demande.id);
  dit(a.statut === 200, `${libelle} : acceptée par le bord opposé`, `HTTP ${a.statut} ${a.erreur ?? ''}`);
  return { r, relu: marquagesDisque().find((m) => m.id === id) };
}

/** Ce que l'écran envoie après « Déplacer » : le clic recalé sur la route (src/routage.js). */
const recaleEcran = (lng, lat) => {
  const acc = accrocher(graphe, lng, lat, 5);
  return { lng: +acc.lng.toFixed(5), lat: +acc.lat.toFixed(5), route: refArete(graphe, acc.arete) ?? '' };
};

/* ================================================================== */

try {
  const admin = await ouvrir('MODIF-ADMIN');
  const cie = await ouvrir('MODIF-CIE');
  const bt = await ouvrir('MODIF-BT');
  const bt2 = await ouvrir('MODIF-BT2');
  const autre = await ouvrir('MODIF-AUTRE');
  const lecteur = await ouvrir('MODIF-LECT');

  test('Plus d’aperçu, plus de second chemin de déplacement');
  {
    const r = await appel(cie, `/api/barrages/${B.id}/modification/apercu`, { methode: 'POST', corps: {} });
    dit(r.statut === 404, '/modification/apercu n’existe plus', `HTTP ${r.statut}`);
    const r2 = await enregistrer(cie, B.id, { mode: 'position', lng: C.lng, lat: C.lat });
    dit(r2.statut === 400 && /Déplacer/.test(r2.erreur), '/modification refuse tout déplacement', r2.erreur);
  }

  /* ---------------------------------------------------------------- */
  test('Test 1 — déplacer (position) par la route existante PATCH');
  {
    const ref = recalerPosition(graphe, B.lng, B.lat, { route: B.route });
    const cible = positionAuPk(graphe, B.route, Math.max(0, ref.pk - 2));
    const envoi = recaleEcran(cible.lng + 0.0012, cible.lat + 0.0008);
    const { relu } = await ecrireEtValider(() => deplacer(bt, B.id, envoi), admin, B.id, 'déplacement');
    dit(relu?.lng === envoi.lng && relu?.lat === envoi.lat && relu?.longitude === envoi.lng && relu?.latitude === envoi.lat,
      'lat/lng/latitude/longitude persistés', `${relu?.lng},${relu?.lat}`);
    const attendu = recalerPosition(graphe, envoi.lng, envoi.lat, { route: envoi.route, rayonKm: 30 });
    dit(relu?.route === envoi.route && relu?.pk === attendu.pk, 'route et PK recalculés sur la route de recalage', `${relu?.route} PK ${relu?.pk}`);
    const rouvert = await relire(bt, B.id);
    dit(rouvert?.lng === envoi.lng && rouvert?.pk === attendu.pk, 'rouvert : /api/marquages rend la nouvelle position');
  }

  /* ---------------------------------------------------------------- */
  test('Test 2 — PK : suit la position, jamais saisi');
  {
    const base = marquagesDisque().find((m) => m.id === B.id);
    const r = await deplacer(admin, B.id, { pk: 1 });
    const apres = marquagesDisque().find((m) => m.id === B.id);
    dit(apres.pk === base.pk, 'un PK envoyé seul est ignoré (il se calcule depuis la position)', `HTTP ${r.statut}, PK ${apres.pk}`);
  }

  /* ---------------------------------------------------------------- */
  test('Test 3 + Test 8 — changement de route et recalcul territorial');
  {
    const envoi = recaleEcran(C.lng + 0.0005, C.lat + 0.0005);
    /* Le Super Admin ne déplace plus : le CMND CIE déplace, l'administration valide. */
    const { relu } = await ecrireEtValider(() => deplacer(cie, D.id, envoi), admin, D.id, 'route + territoire');
    dit(D.route !== envoi.route, 'la route change réellement', `${D.route} → ${envoi.route}`);
    const pk = recalerPosition(graphe, envoi.lng, envoi.lat, { route: envoi.route, rayonKm: 30 }).pk;
    dit(relu?.route === envoi.route && relu?.pk === pk, 'nouvelle route et PK persistés', `${relu?.route} PK ${relu?.pk}`);
    dit(D.bt !== relu?.bt, 'le rattachement change', `${D.bt} → ${relu?.bt}`);
    dit(relu?.bt === C.bt && relu?.brigadeId === C.bt && relu?.cie === C.cie && relu?.compagnieId === C.cie &&
      relu?.reg === C.reg && relu?.regionId === C.reg,
      'bt/brigadeId, cie/compagnieId, reg/regionId recalculés par la géométrie', `${relu?.bt} / ${relu?.cie} / ${relu?.reg}`);
  }

  /* ---------------------------------------------------------------- */
  test('Test 4 — effectif seul');
  {
    const el0 = await appel(bt, `/api/elements?barrageId=${B.id}&date=aujourdhui`);
    const n0 = el0.items.filter((e) => e.creneau === el0.creneau).length;
    const cibleN = n0 >= 3 ? 1 : n0 + 1;
    const r = await enregistrer(bt, B.id, { effectif: cibleN });
    dit(r.statut === 200 && !r.enAttente, `effectif ${n0} → ${cibleN} appliqué tout de suite (relève, pas fiche)`, `HTTP ${r.statut} ${r.erreur ?? ''}`);
    const el = await appel(bt, `/api/elements?barrageId=${B.id}&date=aujourdhui`);
    const surCreneau = el.items.filter((e) => e.creneau === el.creneau);
    dit(surCreneau.length === cibleN, 'le créneau compte bien le nouvel effectif', `${surCreneau.length}`);
    const brigade = new Set(personnel.filter((p) => p.bt === B.bt).map((p) => p.matricule));
    dit(surCreneau.every((e) => !e.matricule || brigade.has(e.matricule)), 'tous les éléments sont de la brigade du poste');
    const trop = await enregistrer(bt, B.id, { effectif: 6 });
    dit(trop.statut === 400 && /règle des trois/.test(trop.erreur), 'effectif 6 refusé : règle des trois', trop.erreur);
    dit((await enregistrer(bt, B.id, { effectif: -2 })).statut === 400, 'effectif négatif refusé');
  }

  /* ---------------------------------------------------------------- */
  test('Test 7 — refus d’un deuxième intouchable dans la compagnie');
  {
    const sans = await enregistrer(cie, C.id, { intouchable: true, accepterConflits: true });
    dit(sans.statut === 409 && sans.code === 'intouchable_existant' && sans.apercu?.intouchableExistant?.id === CIE.bfi.id,
      'sans confirmation : 409, l’intouchable existant est nommé', sans.erreur);
    const patch = await appel(cie, `/api/marquages/${C.id}`, { methode: 'PATCH', corps: { protection: 'intouchable', intouchable: true } });
    dit(patch.statut === 409, 'le PATCH direct ne peut pas créer un second intouchable', `HTTP ${patch.statut}`);
    const n = marquagesDisque().filter((m) => m.cie === CIE.nom && estIntouchable(m) && enService(m)).length;
    dit(n === 1, 'toujours un seul intouchable dans la compagnie', `${n}`);
  }

  /* ---------------------------------------------------------------- */
  test('Test 9 — conflit de distance < 40 km, même faction (activation intouchable)');
  {
    /* Un intouchable est de service sur les quatre factions : tout poste à
       moins de 40 km de route entre en conflit avec lui. */
    const r = await enregistrer(cie, C.id, { intouchable: true, remplacerIntouchable: CIE.bfi.id });
    const avecConflit = r.apercu?.conflits?.length > 0;
    dit(r.statut === 409 && r.code === 'conflit_distance' && avecConflit, 'conflit détecté, enregistrement suspendu',
      r.apercu?.conflits?.map((c) => `${c.id} ${c.km} km ${c.factions.join('/')}`).slice(0, 3).join(' ; '));
    dit(r.apercu?.seuilKm === 40 && r.apercu.conflits.every((c) => c.km < 40), 'seuil de 40 km, distances routières sous le seuil');
    const inchange = marquagesDisque().find((m) => m.id === C.id);
    dit(!estIntouchable(inchange) && enService(inchange), 'rien n’est écrit, aucun barrage supprimé');
  }

  /* ---------------------------------------------------------------- */
  test('Test 5 — barrage normal → intouchable (remplacement confirmé)');
  {
    const r0 = await enregistrer(cie, C.id, { intouchable: true });
    const { relu } = await ecrireEtValider(() => enregistrer(cie, C.id, { intouchable: true, ...confirmer(r0.apercu) }), admin, C.id, 'intouchable ON');
    dit(relu?.intouchable === true && relu?.protection === 'intouchable', 'intouchable: true, protection: "intouchable"');
    dit(relu?.type === 'barrage_fixe', 'le type n’est PAS devenu barrage_vip', relu?.type);
    dit(relu?.debut === '00:00' && relu?.fin === '24:00' && relu?.factionId === '', 'permanent 00:00 → 24:00, factions en relève');
    const ancien = marquagesDisque().find((m) => m.id === CIE.bfi.id);
    dit(ancien.intouchable === false && ancien.protection === 'aucune', 'l’ancien intouchable redevient normal', `${ancien.protection}`);
    const n = marquagesDisque().filter((m) => m.cie === CIE.nom && estIntouchable(m) && enService(m)).map((m) => m.id);
    dit(n.length === 1 && n[0] === C.id, 'exactement un intouchable dans la compagnie', n.join(','));
    const f = await appel(admin, '/api/factions');
    dit((f.assignations?.[C.id] ?? []).length === 4, 'visible dans les quatre factions F1–F4', (f.assignations?.[C.id] ?? []).join(','));
  }

  /* ---------------------------------------------------------------- */
  test('Test 10 — intouchable : ni l’optimisation ni un déplacement manuel ne le bougent');
  {
    const opt = await appel(admin, '/api/barrages/optimisation-auto', { methode: 'POST', corps: { niveau: 'compagnie', unite: CIE.nom } });
    dit(opt.statut === 200, 'analyse d’optimisation exécutée', `HTTP ${opt.statut} ${opt.erreur ?? ''}`);
    const liste = opt.propositions ?? [];
    dit(liste.filter((p) => p.id === C.id).every((p) => p.action === 'conserver' || !p.action), 'aucune action proposée sur lui');
    dit(liste.filter((p) => p.id === C.id).every((p) => p.action !== 'deplacer' && p.action !== 'supprimer'), 'l’optimisation ne déplace ni ne supprime');
    /* Par le CMND CIE : c'est la règle de l'intouchable qui refuse, pas la supervision. */
    const del = await appel(cie, `/api/marquages/${C.id}`, { methode: 'DELETE' });
    dit(del.statut === 403, 'suppression refusée', `HTTP ${del.statut}`);
    const drag = await deplacer(cie, C.id, recaleEcran(C.lng + 0.01, C.lat));
    dit(drag.statut === 403 && /définitive/.test(drag.erreur), 'déplacement manuel refusé (règle existante)', drag.erreur);
  }

  /* ---------------------------------------------------------------- */
  test('Test 6 — intouchable → barrage normal');
  {
    const { relu } = await ecrireEtValider(() => enregistrer(cie, C.id, { intouchable: false, factionId: 'F2', accepterConflits: true }), admin, C.id, 'intouchable OFF');
    dit(relu?.intouchable === false && relu?.protection === 'aucune', 'intouchable: false, protection: "aucune"');
    dit(relu?.factionId === 'F2' && relu?.debut === '06:00' && relu?.fin === '12:00', 'horaire de la faction choisie');
  }

  /* ---------------------------------------------------------------- */
  test('Test 11 — RBAC (contrôlé par le serveur)');
  {
    const r1 = await deplacer(bt2, B.id, recaleEcran(B.lng + 0.002, B.lat));
    dit(r1.statut === 403, 'CMD_BRIGADE : ne déplace pas le poste d’une autre brigade', r1.erreur);
    const r2 = await deplacer(bt, B.id, recaleEcran(C.lng, C.lat));
    dit(r2.statut === 403, 'CMD_BRIGADE : ne sort pas un poste de sa brigade', r2.erreur);
    const r3 = await deplacer(autre, B.id, recaleEcran(B.lng + 0.002, B.lat));
    dit(r3.statut === 403, 'CMD_COMPAGNIE : pas sur une autre compagnie', r3.erreur);
    const r4 = await deplacer(lecteur, B.id, recaleEcran(B.lng + 0.002, B.lat));
    dit(r4.statut === 403, 'compte en lecture seule : refusé', r4.erreur);
    const r5 = await enregistrer(bt2, B.id, { effectif: 1 });
    dit(r5.statut === 403, 'effectif : même cloisonnement', r5.erreur);
    const anonyme = await fetch(`${BASE}/api/marquages/${B.id}`, {
      method: 'PATCH', headers: { 'X-Requested-With': 'gr-carte', 'Content-Type': 'application/json' }, body: '{"lng":0,"lat":0}',
    });
    dit(anonyme.status === 401, 'sans session : 401', `HTTP ${anonyme.status}`);
  }

  /* ---------------------------------------------------------------- */
  test('Test 12 — journalisation');
  {
    const j = await appel(admin, `/api/journal?id=${B.id}&limite=50`);
    const entrees = j.entrees ?? [];
    const dep = entrees.find((e) => e.action === 'demander-modification');
    dit(Boolean(dep) && dep.matricule && dep.ts, 'la demande de déplacement est journalisée (matricule, date)', `${dep?.matricule} ${dep?.ts}`);
    const acc = entrees.find((e) => e.action === 'modifier' && e.change?.lng && e.change?.pk);
    dit(Boolean(acc), 'l’acceptation journalise ancienne/nouvelle position et PK',
      acc ? `lng ${acc.change.lng.de} → ${acc.change.lng.vers}, PK ${acc.change.pk.de} → ${acc.change.pk.vers}` : '');
    const eff = entrees.find((e) => e.action === 'modifier-effectif');
    dit(eff?.details?.effectif?.avant != null && eff?.details?.effectif?.apres != null, 'la modification d’effectif est journalisée',
      `${eff?.details?.effectif?.avant} → ${eff?.details?.effectif?.apres}`);
    const jc = await appel(admin, `/api/journal?id=${C.id}&limite=50`);
    const prot = (jc.entrees ?? []).find((e) => e.action === 'modifier' && e.change?.intouchable);
    dit(Boolean(prot), 'l’ancien et le nouveau statut intouchable sont journalisés', prot ? JSON.stringify(prot.change.intouchable) : '');
    const jb = await appel(admin, `/api/journal?id=${CIE.bfi.id}&limite=20`);
    dit((jb.entrees ?? []).some((e) => e.action === 'retirer-intouchable'), 'le retrait de l’ancien intouchable est journalisé');
  }
} catch (e) {
  dit(false, 'l’épreuve se déroule sans exception', e?.stack ?? String(e));
  console.error(sortieService.slice(-3000));
} finally {
  service.kill();
  rmSync(travail, { recursive: true, force: true });
}

console.log('\n  Récapitulatif par test :');
for (const [t, bon] of parTest) console.log(`    ${bon ? 'PASS' : 'FAIL'}  ${t}`);
console.log(`\n  ${ok} vérification(s) réussie(s), ${echecs.length} échouée(s)`);
if (echecs.length) {
  for (const e of echecs) console.error('  - ' + e);
  process.exit(1);
}
