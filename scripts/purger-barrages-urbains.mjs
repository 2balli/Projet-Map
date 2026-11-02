#!/usr/bin/env node
/**
 * Retire les barrages situés EN VILLE — territoire de la Sûreté Nationale.
 *
 * La Gendarmerie tient les axes entre les agglomérations. Un barrage posé dans
 * le tissu urbain sort de sa compétence : il double un dispositif de police
 * déjà en place et pèse sur l'usager sans contrepartie.
 *
 * Ce script ne touche QUE les barrages produits automatiquement
 * (`build-portes-ville.mjs` et `build-barrages-reseau.mjs`, reconnaissables à
 * leur note). Les repères SAISIS À LA MAIN par les unités sont signalés mais
 * jamais supprimés : ce sont des données de terrain, leur retrait relève d'une
 * décision humaine, pas d'un script.
 *
 *   node scripts/purger-barrages-urbains.mjs            aperçu, n'écrit rien
 *   node scripts/purger-barrages-urbains.mjs --ecrire   retire réellement
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerZonesUrbaines } from './zones-urbaines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);

const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

/** Notes posées par les deux générateurs — seuls ces barrages sont retirables. */
const NOTES_AUTO = new Set(['porte-ville-auto', 'barrage-reseau-auto']);

const zones = chargerZonesUrbaines(COUCHES);
const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const barrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');

console.log('');
console.log(`Villes de police déclarées : ${zones.villes.length}  (donnees-serveur/villes-police.json)`);
if (zones.nonLocalisees.length) {
  console.log(`  déclarées mais absentes des couches : ${zones.nonLocalisees.join(', ')}`);
}
if (!zones.valide) {
  console.log('  ! liste NON VALIDÉE par le commandement — à revoir avant tout arbitrage');
}
console.log('  Toute localité absente de cette liste relève de la Gendarmerie.');
console.log('');

const enVille = [];
for (const b of barrages) {
  const z = zones.contient(b.lng, b.lat);
  if (z) enVille.push({ b, ...z });
}

const auto = enVille.filter((x) => NOTES_AUTO.has(x.b.note));
const manuels = enVille.filter((x) => !NOTES_AUTO.has(x.b.note));

console.log(`Barrages au total        : ${barrages.length}`);
console.log(`En zone urbaine          : ${enVille.length}`);
console.log(`  dont générés (retirables) : ${auto.length}`);
console.log(`  dont saisis à la main     : ${manuels.length}  <- CONSERVÉS, à arbitrer par le commandement`);
console.log('');

const parVille = {};
for (const x of auto) parVille[x.ville.nom] = (parVille[x.ville.nom] ?? 0) + 1;
console.log('Villes les plus concernées (barrages générés) :');
for (const [v, n] of Object.entries(parVille).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(4)}  ${v}`);
}

if (manuels.length) {
  console.log('');
  console.log('Barrages SAISIS À LA MAIN en zone urbaine — non supprimés :');
  for (const x of manuels.slice(0, 12)) {
    console.log(`  ${(x.b.nom || 'sans nom').slice(0, 30).padEnd(32)} ${x.ville.nom} (${x.distanceKm.toFixed(1)} km du centre)`);
  }
  if (manuels.length > 12) console.log(`  … et ${manuels.length - 12} autre(s)`);
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour retirer.');
  console.log('');
  process.exit(0);
}

const aRetirer = new Set(auto.map((x) => x.b.id));
depot.items = items.filter((m) => !aRetirer.has(m.id));
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

const restants = depot.items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile').length;
console.log('');
console.log(`${aRetirer.size} barrage(s) urbain(s) retiré(s). Parc : ${barrages.length} -> ${restants}.`);
console.log('IMPORTANT : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
