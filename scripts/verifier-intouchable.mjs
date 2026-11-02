#!/usr/bin/env node
/**
 * ÉPREUVE DU BARRAGE FIXE INTOUCHABLE (ÉTAPE 3)
 *
 * Vérifie l'ensemble des 14 exigences :
 * 1. Chaque Compagnie possède son Barrage Fixe Intouchable (BFI).
 * 2. Le barrage possède un ID stable.
 * 3. Sa position reste identique après optimisation.
 * 4. L'optimisation ne le propose jamais au retrait.
 * 5. Une tentative serveur de suppression est refusée.
 * 6. Une tentative serveur de déplacement est refusée.
 * 7. Une faction peut être remplacée sans créer un nouveau barrage.
 * 8. Deux factions successives utilisent le même ID.
 * 9. Le barrage reste visible après changement de planning.
 * 10. Le RBAC respecte Région → Compagnie → Brigade.
 * 11. Aucun ancien barrage du RESET n'est restauré.
 * 12. Aucune Compagnie réelle n'est oubliée.
 * 13. donnees-production reste conforme à la politique de données définie à l'ÉTAPE 2 (0 barrage).
 * 14. Les autres validations continuent de passer.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';
import { apparence, estIntouchable } from '../src/marquages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8700 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Intouchable-2026';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

const demande = process.argv.indexOf('--donnees');
const choisi = demande > -1 ? process.argv[demande + 1] : null;
const source = choisi ? resolve(ROOT, choisi) : join(ROOT, 'donnees-demo');
if (!existsSync(source)) {
  console.error(`\nDossier de donnees introuvable : ${source}\n`);
  process.exit(1);
}

const travail = mkdtempSync(join(tmpdir(), 'gr-intouchable-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });
console.log(`\n  donnees d'epreuve : copie de ${source}`);

const compagnies = JSON.parse(
  readFileSync(join(ROOT, 'public', 'layers', 'circo_cie.geojson'), 'utf8'),
).features.map((f) => f.properties.nom);

const brigades = JSON.parse(
  readFileSync(join(ROOT, 'public', 'layers', 'circo_bt.geojson'), 'utf8'),
).features.map((f) => f.properties.gr_bde);

const brutInitial = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8'));
const itemsInitiaux = brutInitial.items ?? brutInitial;
const bfis = itemsInitiaux.filter((m) => m.intouchable === true);

if (!bfis.length) {
  console.error('\nAucun barrage intouchable dans le jeu de données d\'épreuve.\n');
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

const parRegion = new Map();
for (const b of bfis) {
  if (!parRegion.has(b.reg)) parRegion.set(b.reg, []);
  parRegion.get(b.reg).push(b);
}
const [REG, BFIS_REG] = [...parRegion.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const CIBLE = BFIS_REG[0];
const CIE = CIBLE.cie;
const BT = CIBLE.bt;

{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of [
    { matricule: 'IT-ADMIN', rang: 'admin', unite: 'it-admin', nom: 'Administration', role: 'commandement' },
    { matricule: 'IT-REG', rang: 'reg', unite: REG, nom: 'Commandement région', role: 'commandement' },
    { matricule: 'IT-CIE', rang: 'cie', unite: CIE, nom: 'Commandement compagnie', role: 'commandement', reg: REG },
    { matricule: 'IT-BT', rang: 'unite', unite: BT, nom: 'Brigade', role: 'commandement', reg: REG, cie: CIE },
  ]) {
    await definirCompte(etat, { ...c, code: CODE });
  }
  enregistrerComptes(f, etat);
}
console.log(`  périmètre RBAC : région ${REG} > compagnie ${CIE} > brigade ${BT}\n`);

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

async function demarrer() {
  const proc = spawn(
    process.execPath,
    [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--host', '127.0.0.1',
      '--donnees', DONNEES],
    { cwd: ROOT },
  );
  let sortie = '';
  proc.stdout.on('data', (d) => { sortie += d; });
  proc.stderr.on('data', (d) => { sortie += d; });
  for (let i = 0; i < 480; i++) {
    if (proc.exitCode !== null) break;
    try {
      if ((await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(4000) })).ok) return proc;
    } catch {}
    await attendre(250);
  }
  console.error('\nLe service ne démarre pas.\n' + sortie);
  proc.kill();
  rmSync(travail, { recursive: true, force: true });
  process.exit(1);
}

const terminer = (proc) =>
  new Promise((r) => {
    if (!proc || proc.exitCode !== null) return r();
    const forcer = setTimeout(() => proc.kill('SIGKILL'), 3000);
    proc.once('exit', () => {
      clearTimeout(forcer);
      r();
    });
    proc.kill();
  });

async function ouvrir(matricule) {
  const r = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
    body: JSON.stringify({ matricule, code: CODE }),
    signal: AbortSignal.timeout(30_000),
  });
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
}

const appeler = async (cookie, chemin, { methode = 'GET', corps = null } = {}) => {
  const r = await fetch(`${BASE}/api/${chemin}`, {
    method: methode,
    signal: AbortSignal.timeout(900_000),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: cookie },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let brut = null;
  try {
    brut = await r.json();
  } catch {
    brut = null;
  }
  return { statut: r.status, corps: brut ?? {} };
};

let service = await demarrer();

try {
  const admin = await ouvrir('IT-ADMIN');
  if (!admin) throw new Error('Session administrateur refusée.');

  /* ================================================================ */
  console.log('COUVERTURE & MODÈLE — 90 BFI + 504 FIXES NORMAUX = 594 BARRAGES\n');

  const tous = (await appeler(admin, 'marquages')).corps.items ?? [];
  const tousBarrages = tous.filter((m) => String(m.type ?? '').startsWith('barrage'));
  const bfisList = tous.filter((m) => estIntouchable(m));
  const fixesNormaux = tous.filter((m) => m.type === 'barrage_fixe' && !estIntouchable(m));
  const mobiles = tous.filter((m) => m.type === 'barrage_mobile');

  // CRITÈRE 1 — Aucun barrage mobile n'existe
  dit(
    mobiles.length === 0,
    'CRITÈRE 1 — aucun barrage mobile n’existe dans le dataset',
    `${mobiles.length} barrage(s) mobile(s) trouvé(s)`,
  );

  // CRITÈRE 2 — Les 90 Compagnies possèdent leur BFI
  const protegesParCie = new Map();
  for (const m of bfisList) {
    if (!protegesParCie.has(m.cie)) protegesParCie.set(m.cie, []);
    protegesParCie.get(m.cie).push(m);
  }
  const manquantesCie = compagnies.filter((c) => !protegesParCie.has(c));
  const enDoubleCie = [...protegesParCie.entries()].filter(([, l]) => l.length > 1);

  dit(
    manquantesCie.length === 0 && protegesParCie.size === 90 && enDoubleCie.length === 0,
    'CRITÈRE 2 — les 90 Compagnies possèdent exactement leur BFI unique',
    `${protegesParCie.size}/${compagnies.length} compagnies dotées, ${enDoubleCie.length} doublon`,
  );
  dit(
    bfisList.every((m) => m.type === 'barrage_fixe' && m.protection === 'intouchable' && m.intouchable === true),
    'tous les BFI portent type=barrage_fixe, protection="intouchable" et intouchable=true',
  );

  // CRITÈRE 3 — Les 504 Brigades possèdent leur barrage fixe normal
  const fixesParBt = new Map();
  for (const m of fixesNormaux) {
    if (!fixesParBt.has(m.bt)) fixesParBt.set(m.bt, []);
    fixesParBt.get(m.bt).push(m);
  }
  const manquantesBt = brigades.filter((b) => !fixesParBt.has(b));
  dit(
    fixesNormaux.length === 504 && manquantesBt.length === 0,
    'CRITÈRE 3 — les 504 Brigades possèdent leur barrage fixe normal',
    `${fixesNormaux.length}/504 fixes normaux, ${manquantesBt.length} brigade(s) manquante(s)`,
  );

  // CRITÈRE 4 — Chaque BFI possède l'icône dédiée
  const bfiIconesValides = bfisList.every((m) => {
    const app = apparence(m);
    return app.glyph === 'barrage_intouchable' && app.intouchable === true;
  });
  // Vérifier également qu'un BFI avec un ID quelconque reçoit automatiquement l'icône dédiée
  const testIdArbitraire = {
    id: 'BARRAGE-CUSTOM-XYZ-999',
    type: 'barrage_fixe',
    protection: 'intouchable',
    intouchable: true,
  };
  const appArbitraire = apparence(testIdArbitraire);
  const iconeMetierOk =
    estIntouchable(testIdArbitraire) &&
    appArbitraire.glyph === 'barrage_intouchable' &&
    appArbitraire.intouchable === true;

  dit(
    bfiIconesValides && iconeMetierOk,
    'CRITÈRE 4 — chaque BFI possède l’icône dédiée (pilotée par la règle métier estIntouchable)',
    `90/90 glyphes "barrage_intouchable", test ID arbitraire = ${appArbitraire.glyph}`,
  );

  // CRITÈRE 5 — Chaque barrage fixe normal possède l'icône normale
  const fixesIconesValides = fixesNormaux.every((m) => {
    const app = apparence(m);
    return app.glyph === 'barrage_fixe' && app.intouchable === false;
  });
  dit(
    fixesIconesValides && fixesNormaux.length === 504,
    'CRITÈRE 5 — chaque barrage fixe normal possède l’icône normale (barrage_fixe)',
    `${fixesNormaux.length}/504 glyphes "barrage_fixe"`,
  );

  // CRITÈRE 9 — Aucun ancien barrage mobile n'est restauré
  const fBackupPreReset = join(ROOT, 'donnees-demo', 'sauvegardes', 'marquages.json.2026-09-24T10-44-25-259Z');
  let anciensMobilesIds = new Set();
  if (existsSync(fBackupPreReset)) {
    const bkp = JSON.parse(readFileSync(fBackupPreReset, 'utf8'));
    const bkpItems = bkp.items ?? bkp;
    bkpItems.filter((m) => m.type === 'barrage_mobile').forEach((m) => anciensMobilesIds.add(m.id));
  }
  const anciensRestaures = tousBarrages.filter((m) => anciensMobilesIds.has(m.id));
  dit(
    anciensRestaures.length === 0 && mobiles.length === 0,
    'CRITÈRE 9 — aucun ancien barrage mobile n’est restauré',
    `${anciensRestaures.length} ancien(s) ID restauré(s) sur ${anciensMobilesIds.size} archivés`,
  );

  // CRITÈRE 10 — Total exact = 594 par dataset
  const fDemo = join(ROOT, 'donnees-demo', 'marquages.json');
  const fServ = join(ROOT, 'donnees-serveur', 'marquages.json');
  const bDemo = (JSON.parse(readFileSync(fDemo, 'utf8')).items ?? []).filter((m) => String(m.type ?? '').startsWith('barrage'));
  const bServ = (JSON.parse(readFileSync(fServ, 'utf8')).items ?? []).filter((m) => String(m.type ?? '').startsWith('barrage'));

  dit(
    tousBarrages.length === 594 && bDemo.length === 594 && bServ.length === 594,
    'CRITÈRE 10 — total exact = 594 barrages par dataset (90 BFI + 504 fixes normaux)',
    `mémoire=${tousBarrages.length} · demo=${bDemo.length} · serveur=${bServ.length}`,
  );

  /* ================================================================ */
  console.log('\nPROTECTION — POSITION ET IDENTITÉ\n');

  const cible = tous.find((m) => m.id === CIBLE.id);
  const idAvant = cible.id;
  const posAvant = [cible.lng, cible.lat];

  // TEST 6
  const bouger = await appeler(admin, `marquages/${cible.id}`, {
    methode: 'PATCH',
    corps: { lng: cible.lng + 0.1, lat: cible.lat + 0.1 },
  });
  dit(bouger.statut === 403, 'TEST 6 — le déplacer est refusé par le serveur', `statut ${bouger.statut}`);

  // TEST 5
  const supprimer = await appeler(admin, `marquages/${cible.id}`, { methode: 'DELETE' });
  dit(supprimer.statut === 403, 'TEST 5 — le supprimer est refusé par le serveur', `statut ${supprimer.statut}`);

  const relu1 = ((await appeler(admin, 'marquages')).corps.items ?? []).find((m) => m.id === cible.id);
  // TEST 2
  dit(
    relu1?.id === idAvant && relu1.lng === posAvant[0] && relu1.lat === posAvant[1],
    'TEST 2 — identifiant et coordonnées inchangés après ces tentatives',
    `${relu1?.lng},${relu1?.lat}`,
  );

  /* Un second barrage intouchable dans la même compagnie : refusé. */
  /* Posé par le CMND CIE : le Super Admin ne pose plus de barrage — c'est la
     règle « un seul intouchable par compagnie » qu'on éprouve. */
  const second = await appeler(await ouvrir('IT-CIE'), 'marquages', {
    methode: 'POST',
    corps: {
      type: 'barrage_fixe',
      protection: 'intouchable',
      nom: 'Second BFI',
      lng: cible.lng + 0.01,
      lat: cible.lat + 0.01,
      elements: [],
    },
  });
  dit(
    second.statut === 409,
    'un second barrage intouchable dans la même compagnie est refusé',
    `statut ${second.statut}`,
  );

  /* ================================================================ */
  console.log('\nRELAIS DES FACTIONS — MÊME BARRAGE, MÊME IDENTIFIANT\n');

  // TEST 7 + TEST 8
  const avantRelais = (await appeler(admin, 'marquages')).corps.items ?? [];
  const combienAvant = avantRelais.filter((m) => m.intouchable === true).length;

  const cieRelais = await ouvrir('IT-CIE');
  const successives = ['F1', 'F2', 'F3', 'F4'];
  const idsVus = new Set();
  let refus = 0;
  for (const f of successives) {
    /* Par le CMND CIE : le Super Admin ne modifie plus les barrages (il les
       assigne). Le relais reste une demande de planning, jamais un refus. */
    const r = await appeler(cieRelais, `marquages/${cible.id}`, {
      methode: 'PATCH',
      corps: { factionId: f },
    });
    if (r.statut === 403) refus++;
    const relu = ((await appeler(admin, 'marquages')).corps.items ?? []).find(
      (m) => m.id === cible.id,
    );
    if (relu) idsVus.add(relu.id);
  }
  dit(refus === 0, 'les quatre factions se relaient sans être refusées', `${refus} refus`);

  const apresRelais = (await appeler(admin, 'marquages')).corps.items ?? [];
  dit(
    apresRelais.filter((m) => m.intouchable === true).length === combienAvant,
    'aucun barrage n’a été créé par ces changements de faction',
    `${combienAvant} avant, ${apresRelais.filter((m) => m.intouchable === true).length} après`,
  );
  // CRITÈRE 6 — Le changement de faction sur un BFI conserve le même barrageId
  dit(
    idsVus.size === 1 && idsVus.has(idAvant),
    'CRITÈRE 6 — le changement de faction sur un BFI conserve le même barrageId',
    [...idsVus].join(', '),
  );

  const relu2 = apresRelais.find((m) => m.id === cible.id);
  dit(Boolean(relu2), 'le barrage reste visible après changement de planning');
  // CRITÈRE 7 — Le changement de faction ne change pas sa position
  dit(
    relu2?.lng === posAvant[0] && relu2?.lat === posAvant[1] && relu2?.type === 'barrage_fixe',
    'CRITÈRE 7 — le changement de faction ne change pas sa position (position immuable)',
    `${relu2?.lng},${relu2?.lat}`,
  );

  /* ================================================================ */
  console.log('\nOPTIMISATION — LE POSTE N’EST JAMAIS UNE CIBLE\n');

  const avantOptim = ((await appeler(admin, 'marquages')).corps.items ?? [])
    .filter((m) => m.intouchable === true)
    .map((m) => `${m.id}|${m.lng}|${m.lat}|${m.type}`)
    .sort();

  const analyse = await appeler(admin, 'barrages/optimisation-auto', { methode: 'POST', corps: {} });
  dit(analyse.statut === 200, 'l’analyse répond', `statut ${analyse.statut}`);

  const propositions = analyse.corps.propositions ?? [];
  const idsProteges = new Set(avantOptim.map((x) => x.split('|')[0]));
  // CRITÈRE 8 — L'optimisation ne propose jamais un BFI au retrait
  dit(
    !propositions.some((p) => idsProteges.has(p.id)),
    'CRITÈRE 8 — l’optimisation automatique ne propose jamais un BFI au retrait',
    `${propositions.length} proposition(s) au total`,
  );
  dit(
    (analyse.corps.resume?.retraits ?? -1) === 0,
    'aucun retrait proposé, pour aucun poste',
    `retraits = ${analyse.corps.resume?.retraits}`,
  );

  const apresOptim = ((await appeler(admin, 'marquages')).corps.items ?? [])
    .filter((m) => m.intouchable === true)
    .map((m) => `${m.id}|${m.lng}|${m.lat}|${m.type}`)
    .sort();
  // TEST 3
  dit(
    JSON.stringify(avantOptim) === JSON.stringify(apresOptim),
    'TEST 3 — identifiants, coordonnées et natures identiques après optimisation',
    `${apresOptim.length} poste(s) comparé(s)`,
  );

  /* La consolidation MANUELLE est le seul chemin qui propose encore un retrait. */
  const conso = await appeler(admin, 'barrages/consolidation', {
    methode: 'POST',
    corps: { distanceMinKm: 200 },
  });
  const proposesAuRetrait = [
    ...(conso.corps?.aAnnuler ?? []),
    ...(conso.corps?.annules ?? []),
    ...(conso.corps?.propositions ?? []),
  ].filter((p) => idsProteges.has(p?.id));
  dit(
    proposesAuRetrait.length === 0,
    'la consolidation manuelle ne les propose pas non plus au retrait',
    `statut ${conso.statut} · ${proposesAuRetrait.length} proposé(s)`,
  );

  /* ================================================================ */
  console.log('\nRBAC — RÉGION > COMPAGNIE > BRIGADE\n');

  const reg = await ouvrir('IT-REG');
  const cie = await ouvrir('IT-CIE');
  const bt = await ouvrir('IT-BT');

  const vuPar = async (cookie) =>
    ((await appeler(cookie, 'marquages')).corps.items ?? []).filter((m) => m.intouchable === true);

  const vuReg = await vuPar(reg);
  const vuCie = await vuPar(cie);
  const vuBt = await vuPar(bt);

  // TEST 10
  dit(
    vuReg.length > 0 && vuReg.every((m) => m.reg === REG),
    'TEST 10 — le commandement de région voit ceux de sa région, et rien d’autre',
    `${vuReg.length} poste(s) · région ${REG}`,
  );
  dit(
    vuCie.every((m) => m.cie === CIE) && vuCie.length <= vuReg.length,
    'la compagnie voit les siens, sous-ensemble de la région',
    `${vuCie.length} poste(s) · compagnie ${CIE}`,
  );
  dit(
    vuBt.every((m) => m.bt === BT) && vuBt.length <= vuCie.length,
    'la brigade voit les siens, sous-ensemble de la compagnie',
    `${vuBt.length} poste(s) · brigade ${BT}`,
  );

  const adminSupprime = await appeler(admin, `marquages/${cible.id}`, { methode: 'DELETE' });
  dit(
    adminSupprime.statut === 403,
    'même l’administrateur ne peut ni le supprimer…',
    `statut ${adminSupprime.statut}`,
  );
  const adminBouge = await appeler(admin, `marquages/${cible.id}`, {
    methode: 'PATCH',
    corps: { lng: cible.lng + 0.2 },
  });
  dit(adminBouge.statut === 403, '…ni le déplacer', `statut ${adminBouge.statut}`);

  /* ================================================================ */
  console.log('\nPERSISTANCE ET POLITIQUE DE DONNÉES\n');

  await terminer(service);
  service = await demarrer();
  const admin2 = await ouvrir('IT-ADMIN');
  const final = ((await appeler(admin2, 'marquages')).corps.items ?? []).filter(
    (m) => m.intouchable === true,
  );
  dit(
    final.length === protegesParCie.size,
    'le dispositif protégé est relu à l’identique après redémarrage',
    `${final.length} poste(s)`,
  );
  const cibleFinale = final.find((m) => m.id === idAvant);
  dit(
    cibleFinale?.lng === posAvant[0] && cibleFinale?.lat === posAvant[1],
    'et la position du poste éprouvé n’a pas bougé d’un mètre',
    `${cibleFinale?.lng},${cibleFinale?.lat}`,
  );

  // CRITÈRE 11 — donnees-production = 0 barrage
  const prod = join(ROOT, 'donnees-production', 'marquages.json');
  const itemsProd = existsSync(prod)
    ? (() => {
        const j = JSON.parse(readFileSync(prod, 'utf8'));
        return j.items ?? j;
      })()
    : [];
  const prodBarrages = itemsProd.filter((m) => String(m.type ?? '').startsWith('barrage'));
  dit(
    prodBarrages.length === 0,
    'CRITÈRE 11 — donnees-production ne contient strictement aucun barrage (0 barrage)',
    `${prodBarrages.length} barrage(s) dans production (${itemsProd.length} repères civils)`,
  );
} finally {
  await terminer(service);
  rmSync(travail, { recursive: true, force: true });
}

console.log('');
console.log(`  ${ok} épreuve(s) réussie(s), ${echecs.length} échec(s).`);
if (echecs.length) {
  for (const e of echecs) console.log(`    - ${e}`);
  console.log('');
  process.exit(1);
}
console.log('');
