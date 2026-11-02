#!/usr/bin/env node
/**
 * ÉPREUVE DES PAQUETS LIVRÉS — on lance ce qu'on livre, pas ce qu'on développe.
 *
 * Tout le reste s'éprouve contre le dépôt. Ce script-ci démarre
 * `intranet-demo/` et `intranet-production/` TELS QU'ILS PARTIRONT, avec leur
 * propre `serve.mjs`, leur propre `serveur/`, leur propre `donnees-serveur/` et
 * le `--mode` que `demarrer.cmd` écrit.
 *
 * POURQUOI. Deux défauts ont échappé à toutes les autres épreuves parce
 * qu'elles ne regardaient jamais le paquet :
 *
 *   — `comptes.json` avait été exclu : le paquet démarrait sur « Aucun compte
 *     n'est déclaré sur le serveur », et l'application était inutilisable ;
 *   — les relèves sont passées d'un fichier à un dossier, la liste des
 *     fichiers emportés nommait encore le fichier, et le paquet de
 *     démonstration est parti sans aucun historique — sans un mot.
 *
 * Les deux se voient en trois secondes si l'on démarre le paquet. Aucun ne se
 * voit autrement.
 *
 *   node scripts/verifier-paquets.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

const PAQUETS = [
  {
    dossier: 'intranet-demo',
    mode: 'demo',
    titre: 'DÉMONSTRATION',
    /* La démonstration doit MONTRER quelque chose : un paquet vide n'a aucun
       intérêt, et c'est précisément le défaut qu'on a livré une fois. */
    barragesAttendus: 'plus de zero',
    relevesAttendues: true,
  },
  {
    dossier: 'intranet-production',
    mode: 'production',
    titre: 'PRODUCTION',
    /* La production doit être VIDE de barrages : c'est l'exigence même. */
    barragesAttendus: 'zero',
    relevesAttendues: false,
  },
];

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Arrête un processus, ET attend qu'il soit parti.
 *
 * Deux secondes de patience, puis la manière forte. Un service qui ne rend pas
 * la main sur SIGTERM ne doit pas immobiliser l'épreuve, mais il ne doit pas
 * non plus survivre à sa fin — voir la note à l'appel.
 */
const terminer = (proc) =>
  new Promise((resoudre) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resoudre();
    const forcer = setTimeout(() => proc.kill('SIGKILL'), 2000);
    proc.once('exit', () => {
      clearTimeout(forcer);
      resoudre();
    });
    proc.kill();
  });

const lireItems = (chemin) => {
  if (!existsSync(chemin)) return null;
  try {
    const j = JSON.parse(readFileSync(chemin, 'utf8'));
    return Array.isArray(j.items) ? j.items.length : null;
  } catch {
    return null;
  }
};

for (const P of PAQUETS) {
  const OUT = join(ROOT, P.dossier);
  console.log(`\n=== PAQUET ${P.titre} — ${P.dossier}/ ===\n`);

  if (!existsSync(OUT)) {
    dit(false, `${P.dossier}/ existe`, 'lancez « npm run package »');
    continue;
  }

  /* ---- 1. Ce que le paquet contient ---- */

  for (const attendu of ['dist/index.html', 'serve.mjs', 'serveur/api.mjs', 'demarrer.cmd', 'LISEZ-MOI.txt']) {
    dit(existsSync(join(OUT, attendu)), `${attendu.padEnd(20)} présent`);
  }

  const D = join(OUT, 'donnees-serveur');
  dit(existsSync(D), 'donnees-serveur/     présent');

  /* Le marqueur de mode : c'est lui qui interdit de croiser les données. */
  let modeMarque = null;
  try {
    modeMarque = JSON.parse(readFileSync(join(D, 'mode.json'), 'utf8')).mode;
  } catch {
    /* absent ou illisible */
  }
  dit(modeMarque === P.mode, `mode.json porte « ${P.mode} »`, modeMarque ?? 'ABSENT');

  /* `demarrer.cmd` doit réclamer CE mode : sans cela le verrou ne joue pas. */
  const cmd = existsSync(join(OUT, 'demarrer.cmd')) ? readFileSync(join(OUT, 'demarrer.cmd'), 'utf8') : '';
  dit(cmd.includes(`--mode ${P.mode}`), `demarrer.cmd déclare --mode ${P.mode}`);

  /* Les habilitations — l'oubli qui rendait le paquet inutilisable. */
  let nComptes = 0;
  try {
    nComptes = Object.keys(JSON.parse(readFileSync(join(D, 'comptes.json'), 'utf8')).comptes ?? {}).length;
  } catch {
    /* absent */
  }
  dit(nComptes > 0, 'les habilitations sont emportées', `${nComptes} compte(s)`);

  /* Les barrages : présents en démonstration, ABSENTS en production. */
  const nBarrages = lireItems(join(D, 'marquages.json'));
  if (P.barragesAttendus === 'zero') {
    dit(nBarrages === 0, 'aucun barrage fictif dans la PRODUCTION', `${nBarrages} repère(s)`);
    for (const f of ['effectifs.json', 'alertes.json', 'instructions.json']) {
      dit(lireItems(join(D, f)) === 0, `${f.padEnd(20)} vide en production`, `${lireItems(join(D, f))}`);
    }
  } else {
    dit(nBarrages > 0, 'la DÉMONSTRATION porte des barrages à montrer', `${nBarrages} repère(s)`);
  }

  /* Les relèves — un DOSSIER depuis la répartition par journée. */
  const releves = join(D, 'elements');
  const journees = existsSync(releves) ? readdirSync(releves).filter((n) => n.endsWith('.jsonl')) : [];
  const octets = journees.reduce((s, n) => s + statSync(join(releves, n)).size, 0);
  if (P.relevesAttendues) {
    dit(
      journees.length > 0,
      'la DÉMONSTRATION emporte son historique de relèves',
      `${journees.length} journée(s), ${(octets / 1048576).toFixed(1)} Mo`,
    );
  } else {
    dit(journees.length === 0, 'aucune relève fictive dans la PRODUCTION', `${journees.length} journée(s)`);
  }

  /* ---- 2. Il démarre, et il se présente correctement ---- */

  const PORT = 8400 + (process.pid % 150) + PAQUETS.indexOf(P) * 2;
  const BASE = `http://127.0.0.1:${PORT}`;

  const service = spawn(process.execPath, ['serve.mjs', '--port', String(PORT), '--host', '127.0.0.1', '--mode', P.mode], {
    cwd: OUT,
  });
  let sortie = '';
  service.stdout.on('data', (d) => {
    sortie += d;
  });
  service.stderr.on('data', (d) => {
    sortie += d;
  });

  let etat = null;
  for (let i = 0; i < 360; i++) {
    if (service.exitCode !== null) break;
    try {
      const r = await fetch(`${BASE}/api/etat`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        etat = await r.json();
        break;
      }
    } catch {
      /* pas encore là */
    }
    await attendre(250);
  }

  dit(!!etat, 'le paquet démarre tel qu’il est livré', etat ? `HTTP 200` : sortie.slice(-160).trim());

  if (etat) {
    dit(etat.mode === P.mode, `/api/etat annonce le mode « ${P.mode} »`, String(etat.mode));
    dit(etat.comptes === nComptes, 'et le même nombre de comptes que le fichier', `${etat.comptes}`);
    dit(etat.contours?.regions > 0, 'les circonscriptions sont chargées', `${etat.contours?.regions} région(s)`);

    /* La page se sert, avec ses en-têtes de sûreté. */
    const page = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8000) });
    const html = await page.text();
    dit(page.status === 200 && html.includes('<div id="root"'), 'la carte se sert', `HTTP ${page.status}`);
    dit(page.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options sur la page servie');
    dit(
      (page.headers.get('content-security-policy') ?? '').includes("script-src 'self'"),
      'Content-Security-Policy sur la page servie',
    );

    /* Rien ne s'ouvre sans habilitation. */
    const nu = await fetch(`${BASE}/api/marquages`, { signal: AbortSignal.timeout(8000) });
    dit(nu.status === 401, 'les repères ne se lisent pas sans session', `HTTP ${nu.status}`);
  }

  /**
   * ON ATTEND QUE LE PROCESSUS SOIT VRAIMENT PARTI.
   *
   * `kill()` demande l'arrêt, il ne le constate pas. Et ces services sont
   * lancés avec `cwd` DANS le dossier du paquet — c'est voulu, `demarrer.cmd`
   * fait de même — ce qui veut dire que sous Windows, tant que le processus
   * vit, le dossier ne peut être ni supprimé ni renommé. Rendre la main avant
   * sa mort ferait échouer le `npm run package` suivant sur un EPERM dont la
   * cause serait introuvable.
   */
  await terminer(service);

  /* ---- 3. Le verrou de mode, sur le paquet lui-même ---- */

  const autre = P.mode === 'demo' ? 'production' : 'demo';
  const croise = spawn(process.execPath, ['serve.mjs', '--port', String(PORT + 1), '--host', '127.0.0.1', '--mode', autre], {
    cwd: OUT,
  });
  let bruit = '';
  croise.stdout.on('data', (d) => {
    bruit += d;
  });
  croise.stderr.on('data', (d) => {
    bruit += d;
  });
  /* Il DOIT refuser de lui-même. S'il sert quand même, on l'arrête — et là
     encore on attend sa mort, pour ne pas laisser le dossier verrouillé. */
  let servi = false;
  const code = await new Promise((r) => {
    const minuterie = setTimeout(() => {
      servi = true;
      r(null);
    }, 20_000);
    croise.on('exit', (c) => {
      clearTimeout(minuterie);
      r(c);
    });
  });
  if (servi) await terminer(croise);

  dit(code === 1, `le paquet REFUSE de démarrer en --mode ${autre}`, servi ? 'il a servi !' : `code ${code}`);
  dit(/mode/i.test(bruit) && bruit.includes(P.mode), 'et le refus nomme les deux modes');
}

console.log(`\n  ${ok} réussi(s), ${echecs.length} échoué(s)`);
if (echecs.length) {
  console.error('');
  for (const e of echecs) console.error('  - ' + e);
  console.error('\nUn paquet n’est pas livrable en l’état.\n');
  process.exit(1);
}
console.log('\nLes deux paquets démarrent, se présentent et se verrouillent correctement.\n');
