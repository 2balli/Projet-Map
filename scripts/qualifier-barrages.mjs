#!/usr/bin/env node
/**
 * Qualifie les barrages : leur donne les MOTIFS d'implantation qui manquent.
 *
 * Le panneau Optimisation arbitre sur quatre motifs — accidents, porte de
 * ville, mission VIP, éclairage (voir `motifsDuBarrage` dans
 * serveur/distances.mjs). Or le parc n'en portait presque aucun : les
 * barrages générés n'avaient ni accidents constatés, ni mission, ni relevé
 * d'éclairage. L'arbitrage se réduisait donc à « porte de ville ou rien ».
 *
 * Ce script pose des valeurs PLAUSIBLES, pas mesurées :
 *
 *   accidents  — les barrages proches d'un point noir connu héritent de son
 *                nombre d'accidents ; les axes lourds (autoroute, nationale)
 *                reçoivent une charge plus élevée que les routes régionales ;
 *   VIP        — les barrages des grands axes reliant les chefs-lieux de
 *                région portent une mission de passage (cortèges, escortes) ;
 *   éclairage  — renseigné partout : « oui » près des villes, « non » en rase
 *                campagne, plutôt que le « inconnu » par défaut.
 *
 * Il s'agit de données de DÉMONSTRATION. Elles rendent l'arbitrage lisible en
 * séance ; elles ne remplacent pas le relevé de terrain, qui reste l'objet de
 * la phase de fiabilisation.
 *
 *   node scripts/qualifier-barrages.mjs            aperçu, n'écrit rien
 *   node scripts/qualifier-barrages.mjs --ecrire   applique
 *   node scripts/qualifier-barrages.mjs --retirer  remet tout à zéro
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../serveur/routage.mjs';
import { chargerZonesUrbaines } from './zones-urbaines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

/** Part des barrages d'axe majeur portant une mission VIP. */
const PART_VIP = Number(valeur('vip', 0.12));

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const barrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');
const pointsNoirs = items.filter((m) => m.type === 'accident');

/* ---------------------------- remise à zéro ------------------------ */

if (drapeau('retirer')) {
  let n = 0;
  for (const b of barrages) {
    if (b.exceptionnel || b.missionId || b.accidentCount || b.eclairage !== 'inconnu') n++;
    b.exceptionnel = false;
    b.missionId = null;
    b.accidentCount = 0;
    b.severite = 'none';
    b.eclairage = 'inconnu';
  }
  writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
  console.log(`\n${n} barrage(s) remis à zéro (ni accidents, ni VIP, ni éclairage).\n`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */

const zones = chargerZonesUrbaines(COUCHES);

/**
 * Tirage DÉTERMINISTE à partir de l'identifiant : deux exécutions donnent le
 * même résultat, et relancer le script ne redistribue pas tout au hasard.
 */
function hasard(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 10000) / 10000;
}

const estAxeMajeur = (b) => /^(A\d|RN\d)/i.test(b.route ?? '');

let nAccidents = 0, nVip = 0, nEclaire = 0, nNonEclaire = 0;

for (const b of barrages) {
  const r = hasard(b.id);

  /* ---- Accidents : hérités d'un point noir proche, sinon selon l'axe ---- */
  const proche = pointsNoirs
    .map((p) => ({ p, d: distanceKm(b.lng, b.lat, p.lng, p.lat) }))
    .filter((x) => x.d < 8)
    .sort((a, b2) => a.d - b2.d)[0];

  if (proche) {
    b.accidentCount = Math.max(1, proche.p.accidentCount ?? 1);
    b.severite = proche.p.severite && proche.p.severite !== 'none' ? proche.p.severite : 'moderate';
    nAccidents++;
  } else if (estAxeMajeur(b) && r < 0.45) {
    /* Axe lourd : charge d'accidents plausible, croissante avec le tirage. */
    b.accidentCount = 2 + Math.floor(r * 24);
    b.severite = r > 0.36 ? 'high' : r > 0.2 ? 'moderate' : 'none';
    nAccidents++;
  } else if (r < 0.12) {
    b.accidentCount = 1 + Math.floor(r * 12);
    b.severite = 'moderate';
    nAccidents++;
  }

  /* ---- Mission VIP : uniquement sur les grands axes ---- */
  if (estAxeMajeur(b) && r > 1 - PART_VIP / 0.55) {
    b.exceptionnel = true;
    b.missionId = `mission_vip_${b.id.slice(-6)}`;
    nVip++;
  }

  /* ---- Éclairage : renseigné partout, selon la proximité d'une ville ---- */
  const enVille = zones.contient(b.lng, b.lat);
  const auxAbords = !enVille && zones.villes.some((v) => distanceKm(b.lng, b.lat, v.lng, v.lat) < 15);
  if (enVille || (auxAbords && r > 0.45)) {
    b.eclairage = 'oui';
    nEclaire++;
  } else {
    b.eclairage = 'non';
    nNonEclaire++;
  }
}

console.log('');
console.log(`Barrages traités : ${barrages.length}`);
console.log('');
console.log('Motifs après qualification :');
console.log(`  ${String(nAccidents).padStart(4)}  accidents constatés`);
console.log(`  ${String(nVip).padStart(4)}  mission VIP`);
console.log(`  ${String(nNonEclaire).padStart(4)}  non éclairé`);
console.log(`  ${String(nEclaire).padStart(4)}  éclairé (pas un motif, mais renseigné)`);
console.log(`  ${String(barrages.filter((b) => b.positionVille === 'entree' || b.positionVille === 'sortie').length).padStart(4)}  porte de ville (inchangé)`);

const sansMotif = barrages.filter(
  (b) => !(b.accidentCount > 0) && !b.exceptionnel && b.eclairage !== 'non'
    && b.positionVille !== 'entree' && b.positionVille !== 'sortie'
).length;
console.log(`  ${String(sansMotif).padStart(4)}  encore SANS aucun motif`);

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.');
  console.log('');
  process.exit(0);
}

writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
console.log('');
console.log('Qualification enregistrée.');
console.log('IMPORTANT : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
