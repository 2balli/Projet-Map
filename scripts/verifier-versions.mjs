#!/usr/bin/env node
/**
 * ÉPREUVE DE LA SÉPARATION DES DEUX VERSIONS.
 *
 * La promesse est forte : « une séance de démonstration ne peut JAMAIS écrire
 * dans le dispositif réel ». Une promesse de cette nature ne se vérifie pas en
 * relisant le code — elle se vérifie en essayant de la violer.
 *
 * Ce script LANCE RÉELLEMENT le service, dans les quatre combinaisons
 * possibles de (mode déclaré × dossier de données), et vérifie que les deux
 * croisements sont refusés :
 *
 *                        données demo    données production
 *     --mode demo            SERT              REFUSE
 *     --mode production      REFUSE            SERT
 *
 * Il vérifie aussi les deux cas dégradés : un dossier sans `mode.json` avec un
 * mode déclaré (refus, l'intention n'est pas vérifiable), et sans mode déclaré
 * (service rendu, avec avertissement — les dossiers antérieurs à ce mécanisme
 * continuent de fonctionner).
 *
 *   node scripts/verifier-versions.mjs
 *
 * Aucun port n'est ouvert par les cas de REFUS : le service s'arrête avant.
 * Les cas de SERVICE emploient un port libre et sont arrêtés aussitôt.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODES, ecrireMode } from '../serveur/mode.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = join(ROOT, 'scripts', 'serve.mjs');

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

/**
 * Lance le service et rend { code, sortie }.
 *
 * On ne l'interroge pas : ce qu'on veut savoir, c'est s'il DÉMARRE. Un refus
 * se solde par un code de sortie non nul et un message ; un démarrage réussi
 * par une ligne « Local : http://… ». On le tue dès qu'on a la réponse.
 */
function lancer(donnees, mode, port) {
  return new Promise((resolveP) => {
    const args = [SERVE, '--port', String(port), '--donnees', donnees, '--host', '127.0.0.1'];
    if (mode) args.push('--mode', mode);

    const enfant = spawn(process.execPath, args, { cwd: ROOT });
    let sortie = '';
    let fini = false;

    const terminer = (code) => {
      if (fini) return;
      fini = true;
      try {
        enfant.kill();
      } catch {
        /* déjà mort */
      }
      resolveP({ code, sortie });
    };

    enfant.stdout.on('data', (d) => {
      sortie += d;
      /* Démarrage abouti : le service annonce son adresse. */
      if (sortie.includes('Local   : http://')) terminer(0);
    });
    enfant.stderr.on('data', (d) => {
      sortie += d;
    });
    enfant.on('exit', (code) => terminer(code ?? 0));

    /* Filet : un service qui ne dit rien en 20 s est considéré en échec. */
    setTimeout(() => terminer(null), 20_000).unref?.();
  });
}

/* ------------------------------------------------------------------ */
/* Dossiers d'épreuve                                                 */
/* ------------------------------------------------------------------ */

const travail = mkdtempSync(join(tmpdir(), 'gr-versions-'));

/**
 * Des dossiers MINIMAUX, fabriqués ici : on éprouve le VERROU, pas les
 * données. Un dossier sans comptes suffit — le service démarre quand même, en
 * prévenant, et c'est le démarrage qui nous intéresse.
 */
function preparerDossier(nom, mode) {
  const d = join(travail, nom);
  mkdirSync(d, { recursive: true });
  for (const f of ['marquages.json', 'elements.json', 'effectifs.json', 'alertes.json']) {
    writeFileSync(join(d, f), JSON.stringify({ version: 1, items: [] }) + '\n', 'utf8');
  }
  if (mode) ecrireMode(d, mode);
  return d;
}

const DOSSIER_DEMO = preparerDossier('donnees-demo', MODES.DEMO);
const DOSSIER_PROD = preparerDossier('donnees-production', MODES.PRODUCTION);
const DOSSIER_NU = preparerDossier('donnees-sans-marqueur', null);

/* ------------------------------------------------------------------ */

try {
  console.log('');
  console.log('=== LES QUATRE CROISEMENTS (mode déclaré × dossier) ===');
  console.log('');

  const CAS = [
    [MODES.DEMO, DOSSIER_DEMO, true, 'demo sur données demo'],
    [MODES.PRODUCTION, DOSSIER_PROD, true, 'production sur données production'],
    [MODES.DEMO, DOSSIER_PROD, false, 'demo sur données PRODUCTION'],
    [MODES.PRODUCTION, DOSSIER_DEMO, false, 'production sur données DEMO'],
  ];

  let port = 8971;
  for (const [mode, dossier, doitServir, titre] of CAS) {
    const { code, sortie } = await lancer(dossier, mode, port++);
    const aServi = code === 0 && sortie.includes('Local   : http://');
    dit(
      aServi === doitServir,
      `${titre.padEnd(38)} → ${doitServir ? 'SERT' : 'REFUSE'}`,
      `code ${code}`,
    );

    /* Un refus doit DIRE pourquoi, sinon il est incompréhensible. */
    if (!doitServir) {
      dit(
        sortie.includes('LE MODE DÉCLARÉ NE CORRESPOND PAS'),
        `${titre.padEnd(38)} → le refus est expliqué`,
      );
      dit(
        sortie.includes(mode) && sortie.includes(dossier),
        `${titre.padEnd(38)} → le message nomme le mode et le dossier`,
      );
    }
  }

  console.log('');
  console.log('=== LES DEUX CAS DÉGRADÉS ===');
  console.log('');

  {
    const { code, sortie } = await lancer(DOSSIER_NU, MODES.PRODUCTION, port++);
    dit(code !== 0, 'dossier sans mode.json + --mode déclaré → REFUSE', `code ${code}`);
    dit(sortie.includes('AUCUN mode.json'), 'et le refus dit ce qui manque');
  }

  {
    const { code, sortie } = await lancer(DOSSIER_NU, null, port++);
    dit(code === 0, 'dossier sans mode.json et sans --mode → SERT', `code ${code}`);
    dit(
      sortie.includes('Aucun mode.json'),
      'en prévenant que le mode est inconnu',
    );
  }

  console.log('');
  console.log('=== LES DOSSIERS RÉELS DU DÉPÔT ===');
  console.log('');

  for (const [nom, mode] of [
    ['donnees-demo', MODES.DEMO],
    ['donnees-production', MODES.PRODUCTION],
  ]) {
    const d = join(ROOT, nom);
    if (!existsSync(d)) {
      dit(false, `${nom} existe`);
      continue;
    }
    const marque = JSON.parse(readFileSync(join(d, 'mode.json'), 'utf8'));
    dit(marque.mode === mode, `${nom.padEnd(20)} porte le mode « ${mode} »`, marque.mode);

    const { code } = await lancer(d, mode, port++);
    dit(code === 0, `${nom.padEnd(20)} démarre avec --mode ${mode}`, `code ${code}`);

    const autre = mode === MODES.DEMO ? MODES.PRODUCTION : MODES.DEMO;
    const croise = await lancer(d, autre, port++);
    dit(croise.code !== 0, `${nom.padEnd(20)} REFUSE --mode ${autre}`, `code ${croise.code}`);
  }
} finally {
  rmSync(travail, { recursive: true, force: true });
}

console.log('');
console.log(`  ${ok} réussi(s), ${echecs.length} échoué(s)`);
if (echecs.length) {
  console.error('');
  for (const e of echecs) console.error('  - ' + e);
  console.error('\nLa séparation des versions n’est pas garantie.\n');
  process.exit(1);
}
console.log('\nUne séance de démonstration ne peut pas atteindre les données réelles.\n');
