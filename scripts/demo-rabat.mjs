#!/usr/bin/env node
/**
 * SCÉNARIO TEMPORAIRE « RABAT » — montrer l'objectif de l'optimisation.
 *
 *   node scripts/demo-rabat.mjs [--port 8091] [--source donnees-demo] [--faction F3]
 *
 * Ce que fait le script, et ce qu'il ne fait pas :
 *
 *   1. il COPIE le dossier source dans un dossier temporaire du système ;
 *   2. il y AJOUTE quelques barrages fixes normaux, tous dans la région de
 *      Rabat et dans la même faction, recalés sur des routes réelles du graphe
 *      hors ligne — assez proches les uns des autres pour que la règle des
 *      40 km par la route soit manifestement enfreinte ;
 *   3. il lance le service sur CETTE COPIE, sur un autre port ;
 *   4. à l'arrêt (Ctrl+C), il SUPPRIME la copie.
 *
 * LE DOSSIER SOURCE N'EST JAMAIS ÉCRIT. Les comptes sont ceux de la copie : on
 * s'y connecte avec les identifiants habituels. Les barrages ajoutés portent
 * `demoTemporaire: true` et le préfixe DEMO-RABAT-, et n'existent que dans la
 * copie. Ce ne sont pas des recommandations opérationnelles : ils servent à
 * rendre visible ce que l'optimisation cherche à réduire.
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerGrapheRoutier } from '../serveur/distances.mjs';
import { recalerPosition } from '../serveur/pointKilometrique.mjs';
import { chargerCirconscriptions, localiser } from '../serveur/geo.mjs';
import { factionParId } from '../serveur/factions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};
const PORT = Number(arg('port', 8091));
const SOURCE = resolve(ROOT, arg('source', 'donnees-demo'));
const FACTION = factionParId(arg('faction', 'F3'));
if (!FACTION) throw new Error('Faction inconnue.');
if (!existsSync(join(SOURCE, 'marquages.json'))) throw new Error(`Aucun marquages.json dans ${SOURCE}.`);

/* Points de départ, dans la région de Rabat : chacun est recalé sur la route
   la plus proche, puis gardé seulement s'il tombe bien dans la région.
   A → E : une concentration au nord (Rabat, Salé, Témara, Skhirate, Shoul),
   à quelques kilomètres les uns des autres et des Intouchables — le cas de
   « trop de barrages ». F, au sud (Sidi Yahya des Zaers), est trop proche des
   Intouchables voisins mais a, lui, une position valide dans la région : le
   seul tronçon de Rabat à 40 km par la route de tous les autres postes. Ce que
   l'analyse en fait n'est pas écrit ici : elle le calcule. */
const GRAINES = [
  ['A', -6.845, 33.99],
  ['B', -6.78, 34.045],
  ['C', -6.93, 33.925],
  ['D', -6.99, 33.86],
  ['E', -6.7, 33.985],
  ['F', -6.85, 33.66],
];

const couches = join(ROOT, 'public', 'layers');
const graphe = chargerGrapheRoutier(join(couches, 'graphe_routier.json'));
if (!graphe) throw new Error('Graphe routier absent : lancez « npm run build:roads ».');
const circonscriptions = chargerCirconscriptions(couches);

/* Une copie laissée par un arrêt brutal (fenêtre fermée, processus tué : sous
   Windows, aucun signal n'est alors reçu) est supprimée au lancement suivant. */
for (const nom of readdirSync(tmpdir())) {
  if (nom.startsWith('gr-demo-rabat-')) rmSync(join(tmpdir(), nom), { recursive: true, force: true });
}
const travail = mkdtempSync(join(tmpdir(), 'gr-demo-rabat-'));
cpSync(SOURCE, travail, { recursive: true });
const nettoyer = () => {
  try {
    rmSync(travail, { recursive: true, force: true });
  } catch {
    /* déjà supprimé */
  }
};

const fichier = join(travail, 'marquages.json');
const depot = JSON.parse(readFileSync(fichier, 'utf8'));
const modele = depot.items.find((m) => m.type === 'barrage_fixe' && m.reg === 'Rabat' && !m.intouchable);
const maintenant = new Date().toISOString();
const ajoutes = [];
for (const [lettre, lng, lat] of GRAINES) {
  const pos = recalerPosition(graphe, lng, lat, { rayonKm: 3 });
  if (pos.erreur) continue;
  const lieu = localiser(circonscriptions, [pos.lng, pos.lat]);
  if (lieu.reg !== 'Rabat') continue;
  const id = `DEMO-RABAT-${lettre}`;
  ajoutes.push({
    ...modele,
    id,
    nom: `DÉMO Rabat ${lettre}`,
    note: 'Barrage TEMPORAIRE de démonstration (copie de données, jamais enregistré ailleurs).',
    route: pos.route ?? '',
    pk: pos.pk ?? null,
    lng: pos.lng,
    lat: pos.lat,
    longitude: pos.lng,
    latitude: pos.lat,
    bt: lieu.bt,
    cie: lieu.cie,
    reg: lieu.reg,
    brigadeId: lieu.bt,
    compagnieId: lieu.cie,
    regionId: lieu.reg,
    factionId: FACTION.id,
    debut: FACTION.debut,
    fin: FACTION.fin,
    protection: 'aucune',
    intouchable: false,
    statutBarrage: 'approuve',
    optimisationAuto: null,
    etatAvant: null,
    decisionOptimisation: 'aucune',
    demoTemporaire: true,
    cree: maintenant,
    maj: maintenant,
  });
}
depot.items.push(...ajoutes);
writeFileSync(fichier, JSON.stringify(depot, null, 2));
/* Ce scénario a SA référence de présentation : celle de la source ne connaît
   pas les postes temporaires. Le service la recrée au démarrage. */
rmSync(join(travail, 'reference-presentation.json'), { force: true });

console.log(`\n  SCÉNARIO TEMPORAIRE RABAT — ${ajoutes.length} barrage(s) ${FACTION.id} ajouté(s) à une COPIE :`);
for (const b of ajoutes) console.log(`    ${b.id}  ${b.route || '—'}  ${b.bt ?? '—'} / ${b.cie ?? '—'}  (${b.lng}, ${b.lat})`);
console.log(`\n  Copie : ${travail}`);
console.log(`  Source intacte : ${SOURCE}`);
console.log(`  Ouvrez http://localhost:${PORT}/ — Région Rabat, ${FACTION.nom}, Optimisation → Automatique.\n`);

const service = spawn(
  process.execPath,
  [join(ROOT, 'scripts', 'serve.mjs'), '--port', String(PORT), '--mode', 'demo', '--donnees', travail],
  { cwd: ROOT, stdio: 'inherit' },
);
const arreter = () => {
  service.kill();
  nettoyer();
  process.exit(0);
};
process.on('SIGINT', arreter);
process.on('SIGTERM', arreter);
service.on('exit', (code) => {
  nettoyer();
  process.exit(code ?? 0);
});
