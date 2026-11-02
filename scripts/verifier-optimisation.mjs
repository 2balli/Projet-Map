#!/usr/bin/env node
/**
 * ÉPREUVE DE L'OPTIMISATION — le calcul aboutit-il, et sur QUEL périmètre ?
 *
 * L'OPTIMISATION est la fonction centrale de l'application : elle mesure, par
 * la route, la distance de chaque poste à son voisin le plus proche, et
 * propose de retirer les redondants. Elle n'avait AUCUNE épreuve de bout en
 * bout — et c'est ce qui a laissé passer un défaut grave : le bouton CALCULER
 * de l'étape 3 sur 5 était grisé tant qu'aucun calcul n'existait, et il était
 * le seul moyen d'en produire un. Le parcours s'arrêtait là, définitivement.
 *
 * La navigation est désormais gardée par `verifier-parcours.mjs`. Ce script-ci
 * garde ce qui vient APRÈS le clic : l'appel part, il aboutit, et sa réponse
 * porte de quoi trancher.
 *
 * Il éprouve aussi les deux règles demandées explicitement pour cette
 * fonction, parce qu'elles ne se voient pas à l'écran :
 *
 *   — LE PÉRIMÈTRE SE DÉDUIT DU PROFIL. Un chef de région, de compagnie ou de
 *     brigade n'a pas de périmètre à choisir : son rang le détermine. Le
 *     serveur IGNORE `niveau` et `unite` du corps dès qu'il peut les déduire —
 *     ce n'est pas un masquage d'interface, c'est la logique de calcul qui ne
 *     les lit plus.
 *
 *   — UNE PORTE DE VILLE EST TOUJOURS INTOUCHABLE. Sans réglage, sans filtre.
 *     C'est la raison pour laquelle les options « Entrées de ville seulement »
 *     et « Sorties de ville seulement » ont été retirées du panneau : elles ne
 *     pouvaient rendre que des postes non décidables.
 *
 *   node scripts/verifier-optimisation.mjs
 *   node scripts/verifier-optimisation.mjs --donnees donnees-demo
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComptes, definirCompte, enregistrerComptes } from '../serveur/comptes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8050 + (process.pid % 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'Optim-Epreuve-2026';

/** Les portes de ville, telles que le panneau et le serveur les nomment. */
const PORTES = ['entree', 'sortie', 'porte'];

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

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

const travail = mkdtempSync(join(tmpdir(), 'gr-optim-'));
const DONNEES = join(travail, 'donnees');
cpSync(source, DONNEES, { recursive: true });
rmSync(join(DONNEES, 'sauvegardes'), { recursive: true, force: true });
console.log(`\n  donnees d'epreuve : copie de ${source}`);

/**
 * QUATRE PROFILS, UN PAR ÉCHELON. Le dernier — un rang hiérarchique SANS unité
 * nommée — n'est pas un cas d'école : c'est celui où le périmètre ne peut pas
 * être déduit, et le serveur doit refuser plutôt que d'analyser le pays.
 */
{
  const f = join(DONNEES, 'comptes.json');
  const etat = chargerComptes(f);
  for (const c of [
    { matricule: 'OP-ADMIN', rang: 'admin', unite: 'op-admin', nom: 'Administration', role: 'commandement' },
    { matricule: 'OP-REG', rang: 'reg', unite: 'Ouarzazate', nom: 'Région Ouarzazate', role: 'commandement' },
    { matricule: 'OP-CIE', rang: 'cie', unite: 'Zagora', nom: 'Compagnie Zagora', role: 'commandement', reg: 'Ouarzazate' },
    { matricule: 'OP-BT', rang: 'unite', unite: 'Agdez', nom: 'Brigade Agdez', role: 'commandement', reg: 'Ouarzazate', cie: 'Zagora' },
  ]) {
    await definirCompte(etat, { ...c, code: CODE });
  }
  enregistrerComptes(f, etat);
}

/* ------------------------------------------------------------------ */

{
  let occupe = false;
  try {
    await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(1500) });
    occupe = true;
  } catch {
    /* personne : tant mieux */
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

const terminer = (proc) =>
  new Promise((r) => {
    if (proc.exitCode !== null) return r();
    const forcer = setTimeout(() => proc.kill('SIGKILL'), 2000);
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
  return {
    cookie: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; '),
    statut: r.status,
  };
}

/**
 * LE CORPS EXACT QUE LE PANNEAU ENVOIE.
 *
 * `positionVille` part toujours à `null` depuis le retrait du filtre par porte
 * de ville. On le passe ici tel quel pour éprouver ce que l'application envoie
 * VRAIMENT, et non un corps arrangé pour l'occasion.
 */
const consolider = async (s, corps) => {
  const r = await fetch(`${BASE}/api/barrages/consolidation`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte', Cookie: s.cookie },
    body: JSON.stringify({
      distanceMinKm: 5,
      niveau: null,
      unite: null,
      positionVille: null,
      accidents: false,
      seuilAccidents: 0,
      vip: false,
      nonEclaire: false,
      ...corps,
    }),
  });
  return { statut: r.status, corps: await r.json().catch(() => ({})) };
};

try {
  /* ================================================================ */
  console.log('\n=== 1. LE CALCUL ABOUTIT, ET REND DE QUOI TRANCHER ===\n');

  const profils = [
    ['OP-ADMIN', 'admin', { niveau: null, unite: null }],
    ['OP-REG', 'chef de région', {}],
    ['OP-CIE', 'chef de compagnie', {}],
    ['OP-BT', 'chef de brigade', {}],
  ];

  /** Ce que chaque profil a vu, pour les comparaisons de la section 3. */
  const vus = new Map();

  for (const [matricule, nom, corps] of profils) {
    const s = await ouvrir(matricule);
    dit(s.statut === 200, `${nom.padEnd(18)} session ouverte`, `HTTP ${s.statut}`);

    const t0 = Date.now();
    const r = await consolider(s, corps);
    dit(r.statut === 200, `${nom.padEnd(18)} le calcul aboutit`, `HTTP ${r.statut} en ${Date.now() - t0} ms`);
    if (r.statut !== 200) {
      console.log(`         ${JSON.stringify(r.corps).slice(0, 160)}`);
      continue;
    }

    const barrages = r.corps.barrages;
    dit(Array.isArray(barrages), `${nom.padEnd(18)} la réponse porte la liste des postes`, `${barrages?.length ?? '—'}`);
    dit(
      r.corps.parametres?.distanceMinKm === 5,
      `${nom.padEnd(18)} les paramètres appliqués sont renvoyés`,
      `${r.corps.parametres?.niveau ?? 'national'} ${r.corps.parametres?.unite ?? ''}`.trim(),
    );

    /**
     * CHAQUE POSTE SOUS LE SEUIL EST CLASSÉ — intouchable, déjà décidé, ou à
     * trancher. Un poste sous le seuil qui n'entre dans aucune de ces cases
     * n'apparaîtrait nulle part dans le panneau : ni protégé, ni proposé. Il
     * serait mesuré puis perdu.
     */
    const sous = (barrages ?? []).filter((b) => b.sousLeSeuil);
    const intouchables = sous.filter((b) => b.intouchable === true);
    const decides = sous.filter((b) => b.intouchable !== true && b.decision && b.decision !== 'aucune');
    const aTrancher = sous.filter((b) => b.intouchable !== true && b.decision === 'aucune');
    console.log(
      `         examinés ${barrages?.length ?? 0} · sous le seuil ${sous.length} · ` +
        `intouchables ${intouchables.length} · déjà décidés ${decides.length} · à trancher ${aTrancher.length}`,
    );
    dit(
      intouchables.length + decides.length + aTrancher.length === sous.length,
      `${nom.padEnd(18)} aucun poste sous le seuil n’est laissé sans classement`,
    );

    /* Une distance mesurée, et un voisin nommé : sans quoi la ligne du panneau
       n'a rien à afficher. */
    dit(
      sous.every((b) => Number.isFinite(b.distanceKm) && b.distanceKm >= 0),
      `${nom.padEnd(18)} chaque poste sous le seuil porte une distance`,
    );

    vus.set(matricule, { barrages: barrages ?? [], parametres: r.corps.parametres ?? {} });
  }

  /* ================================================================ */
  console.log('\n=== 2. LE PÉRIMÈTRE VIENT DU PROFIL, PAS DE LA REQUÊTE ===\n');

  /**
   * LA TENTATIVE QUI DOIT ÉCHOUER SANS BRUIT.
   *
   * Un chef de région envoie le périmètre d'une AUTRE région, puis aucun
   * périmètre du tout. Dans les deux cas, le serveur doit analyser SA région —
   * pas celle qu'il réclame, pas le pays. C'est une élévation de privilège par
   * simple paramètre : elle ne demande aucun outil, juste une requête modifiée.
   */
  {
    const s = await ouvrir('OP-REG');
    const sien = vus.get('OP-REG');

    for (const [nom, corps] of [
      ['une autre région', { niveau: 'region', unite: 'Tanger' }],
      ['aucun périmètre', { niveau: null, unite: null }],
      ['le niveau national', { niveau: 'national', unite: null }],
      /* Une brigade d'une AUTRE région : ce n'est pas resserrer, c'est sortir. */
      ['une brigade ailleurs', { niveau: 'brigade', unite: 'Shoul' }],
    ]) {
      const r = await consolider(s, corps);
      dit(
        r.statut === 200 && r.corps.parametres?.unite === 'Ouarzazate',
        `réclamer ${nom.padEnd(20)} → analyse quand même Ouarzazate`,
        `HTTP ${r.statut}, périmètre « ${r.corps.parametres?.unite ?? '—'} »`,
      );
      dit(
        r.statut === 200 && (r.corps.barrages?.length ?? -1) === sien.barrages.length,
        `  et le même nombre de postes que son propre périmètre`,
        `${r.corps.barrages?.length ?? '—'} / ${sien.barrages.length}`,
      );
    }
  }

  /**
   * RESSERRER EST PERMIS — voir « LE CORPS PEUT RESSERRER, JAMAIS ÉLARGIR »
   * dans serveur/api.mjs. Un chef de région descendu dans une brigade de SA
   * région analyse cette brigade, et elle seule.
   */
  {
    const s = await ouvrir('OP-REG');
    const sien = vus.get('OP-REG');
    const r = await consolider(s, { niveau: 'brigade', unite: 'Agdez' });
    dit(
      r.statut === 200 && r.corps.parametres?.niveau === 'brigade' && r.corps.parametres?.unite === 'Agdez',
      'resserrer sur une brigade de sa région → analyse Agdez',
      `HTTP ${r.statut}, périmètre « ${r.corps.parametres?.unite ?? '—'} »`,
    );
    dit(
      r.statut === 200 && (r.corps.barrages?.length ?? Infinity) <= sien.barrages.length &&
        (r.corps.barrages ?? []).every((b) => sien.barrages.some((x) => x.id === b.id)),
      '  et seulement des postes de sa région',
      `${r.corps.barrages?.length ?? '—'} / ${sien.barrages.length}`,
    );
  }

  /* L'administrateur, lui, choisit — c'est le seul sans périmètre propre. */
  {
    const s = await ouvrir('OP-ADMIN');
    const national = await consolider(s, { niveau: null, unite: null });
    const region = await consolider(s, { niveau: 'region', unite: 'Ouarzazate' });
    dit(
      national.statut === 200 && region.statut === 200,
      'admin              peut choisir son périmètre',
      `national ${national.corps.barrages?.length ?? '—'}, région ${region.corps.barrages?.length ?? '—'}`,
    );
    dit(
      (region.corps.barrages?.length ?? 0) <= (national.corps.barrages?.length ?? 0),
      'et une région ne contient jamais plus de postes que le pays',
    );
  }

  /* ================================================================ */
  console.log('\n=== 3. UNE PORTE DE VILLE EST TOUJOURS INTOUCHABLE ===\n');

  /**
   * SANS RÉGLAGE, SANS FILTRE, ET POUR TOUS LES PROFILS.
   *
   * C'est la propriété qui justifie le retrait des deux options « Entrées de
   * ville seulement » / « Sorties de ville seulement » du panneau : un rapport
   * restreint à ces postes n'aurait porté que des lignes non décidables. Si
   * cette propriété cessait d'être vraie, le retrait de ces options serait à
   * reconsidérer — d'où le contrôle, et non un simple commentaire.
   */
  let portesEprouvees = 0;
  for (const [matricule, nom] of [
    ['OP-ADMIN', 'admin'],
    ['OP-REG', 'chef de région'],
    ['OP-CIE', 'chef de compagnie'],
    ['OP-BT', 'chef de brigade'],
  ]) {
    const vu = vus.get(matricule);
    if (!vu) continue;
    const portesSous = vu.barrages.filter((b) => b.sousLeSeuil && PORTES.includes(b.positionVille));
    portesEprouvees += portesSous.length;
    dit(
      portesSous.every((b) => b.intouchable === true),
      `${nom.padEnd(18)} aucune porte de ville n’est proposée au retrait`,
      `${portesSous.length} porte(s) sous le seuil`,
    );
  }

  if (portesEprouvees === 0) {
    console.log(
      '         (aucune porte de ville sous le seuil dans ce jeu : la propriété\n' +
        '          ne peut pas être éprouvée ici — voir --donnees donnees-demo)',
    );
  }

  /* ================================================================ */
  console.log('\n=== 4. CE QUI DOIT ÊTRE REFUSÉ L’EST ===\n');

  {
    const s = await ouvrir('OP-ADMIN');
    for (const [nom, corps] of [
      ['distance absente', { distanceMinKm: undefined }],
      ['distance nulle', { distanceMinKm: 0 }],
      ['distance négative', { distanceMinKm: -3 }],
      ['distance en texte', { distanceMinKm: 'cinq' }],
    ]) {
      const r = await consolider(s, corps);
      dit(r.statut === 400, `${nom.padEnd(20)} → refusé`, `HTTP ${r.statut}`);
    }
  }

  /* Un profil hiérarchique dont le compte ne nomme aucune unité : le périmètre
     est indéterminable, et le serveur doit le dire plutôt que tout analyser. */
  {
    const anonyme = await fetch(`${BASE}/api/barrages/consolidation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gr-carte' },
      body: JSON.stringify({ distanceMinKm: 5 }),
      signal: AbortSignal.timeout(30_000),
    });
    dit(anonyme.status === 401, 'sans session          → refusé', `HTTP ${anonyme.status}`);
  }
} catch (e) {
  dit(false, 'l’épreuve se déroule sans blocage', e?.message ?? String(e));
  console.error('\n--- journal du service ---\n' + sortieService.slice(-1500));
} finally {
  await terminer(service);
  rmSync(travail, { recursive: true, force: true });
}

console.log(`\n  ${ok} réussi(s), ${echecs.length} échoué(s)`);
if (echecs.length) {
  console.error('');
  for (const e of echecs) console.error('  - ' + e);
  console.error('\nL’OPTIMISATION ne tient pas ses règles.\n');
  process.exit(1);
}
console.log('\nLe calcul aboutit, le périmètre vient du profil, les portes restent intouchables.\n');
