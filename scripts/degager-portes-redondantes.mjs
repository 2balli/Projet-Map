#!/usr/bin/env node
/**
 * PORTES DE VILLE REDONDANTES — deux postes sur le MÊME axe, à la même porte.
 *
 * CE QUE L'AUDIT A MONTRÉ
 * -----------------------
 * Les portes de ville dominent la liste des barrages « trop rapprochés » :
 * 28 % d'entre elles sont sous le seuil de 5 km, contre 11 % des barrages
 * ordinaires — deux fois et demie plus. Et 48 des 56 portes signalées ont pour
 * voisin… une autre porte.
 *
 * La cause est dans le générateur : `scripts/build-portes-ville.mjs` s'autorise
 * un écart de 2 km entre deux portes d'une même ville (`ECART_KM`), alors que
 * la doctrine d'espacement du dispositif en demande 5. Il fabrique donc des
 * violations par construction.
 *
 * MAIS TOUTES LES PAIRES NE SE VALENT PAS
 * ---------------------------------------
 * Sur les 93 paires de portes d'une même ville distantes de moins de 5 km :
 *
 *   32 sont sur le MÊME AXE          -> deux postes sur une seule route, à la
 *                                       même entrée de la même ville. C'est une
 *                                       redondance au sens propre.
 *   61 sont sur des AXES DIFFÉRENTS  -> chacune tient une route distincte vers
 *                                       la ville. Les retirer découvrirait un
 *                                       accès. Ce n'est PAS le même sujet, et
 *                                       ce script n'y touche pas.
 *
 * ET UNE TROISIÈME FAMILLE, QUE LE PREMIER JET AVAIT MANQUÉE
 * ----------------------------------------------------------
 * Deux villes VOISINES peuvent poser chacune sa porte sur la MÊME route, face
 * à face — Azrou et Ifrane sur la RN8, à 3,1 km l'une de l'autre. Le premier
 * jet groupait par ville : ces deux-là n'étaient jamais comparées. C'est
 * pourtant la même redondance qu'à l'intérieur d'une ville, un poste couvrant
 * les deux sens du tronçon.
 *
 * Le regroupement se fait donc par AXE, sans tenir compte des villes. Deux
 * portes distantes de 200 km sur la RN1 ne se gênent pas — seul le seuil
 * décide.
 *
 * `--tous-axes` étend le nettoyage aux portes d'une MÊME ville sur des axes
 * DIFFÉRENTS. C'est un choix de doctrine : retirer l'une découvre une route.
 * Éteint par défaut.
 *
 * LEQUEL GARDER ? Le plus ÉLOIGNÉ du centre-ville. La Gendarmerie tient les
 * abords, la Sûreté Nationale l'intérieur : entre deux postes du même axe,
 * celui qui est le plus hors du tissu urbain est le mieux placé.
 *
 * Rien d'autre n'est touché : ni les coordonnées, ni les noms, ni les autres
 * barrages, ni le calcul de distance.
 *
 *   node scripts/degager-portes-redondantes.mjs             aperçu
 *   node scripts/degager-portes-redondantes.mjs --ecrire    applique
 *   node scripts/degager-portes-redondantes.mjs --seuil 8   autre seuil
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../serveur/routage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};

const SEUIL_KM = valeur('seuil', 5);
const MARQUE = 'porte-ville-auto';

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const portes = items.filter((m) => m.note === MARQUE);

const chefsLieux = JSON.parse(
  readFileSync(join(ROOT, 'public/layers/pts_cie.geojson'), 'utf8')
).features.map((f) => ({
  lng: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
}));

const auCentre = (m) => {
  let d = Infinity;
  for (const p of chefsLieux) d = Math.min(d, distanceKm(m.lng, m.lat, p.lng, p.lat));
  return d;
};

/** La ville tenue par cette porte, lue sur son nom : « Porte Cie X — RN1 ». */
const villeDe = (m) => String(m.nom ?? '').replace(/^Porte /, '').split(' — ')[0];

/**
 * Un passage de dégrossissage sur un ensemble de portes.
 *
 * La plus éloignée d'un centre-ville reste — c'est celle qui est le plus hors
 * du tissu urbain, donc la mieux placée pour la Gendarmerie. Les suivantes ne
 * sont gardées que si elles s'écartent d'au moins le seuil de TOUTES celles
 * déjà retenues.
 */
const degrossir = (liste) => {
  const ordonnees = [...liste].sort((a, b) => auCentre(b) - auCentre(a));
  const gardes = [];
  const partent = [];
  for (const m of ordonnees) {
    const conflit = gardes.some((g) => distanceKm(g.lng, g.lat, m.lng, m.lat) < SEUIL_KM);
    (conflit ? partent : gardes).push(m);
  }
  return { gardes, partent };
};

const aRetirer = [];
const groupes = [];

/* --- Passage 1 : par AXE, toutes villes confondues --- */
const parAxe = new Map();
for (const m of portes) {
  const axe = String(m.route ?? '').trim() || '(sans axe)';
  if (!parAxe.has(axe)) parAxe.set(axe, []);
  parAxe.get(axe).push(m);
}
for (const [axe, sur] of parAxe) {
  if (sur.length < 2) continue;
  const { gardes, partent } = degrossir(sur);
  if (partent.length) {
    groupes.push({ titre: `axe ${axe}`, gardes, partent });
    aRetirer.push(...partent);
  }
}

/* --- Passage 2 (optionnel) : même ville, axes différents --- */
if (drapeau('tous-axes')) {
  const partis = new Set(aRetirer.map((m) => m.id));
  const parVille = new Map();
  for (const m of portes) {
    if (partis.has(m.id)) continue;
    const v = villeDe(m);
    if (!parVille.has(v)) parVille.set(v, []);
    parVille.get(v).push(m);
  }
  for (const [ville, liste] of parVille) {
    if (liste.length < 2) continue;
    const { gardes, partent } = degrossir(liste);
    if (partent.length) {
      groupes.push({ titre: `${ville} — axes différents`, gardes, partent });
      aRetirer.push(...partent);
    }
  }
}

console.log('');
console.log(
  `PORTES REDONDANTES — moins de ${SEUIL_KM} km` +
    (drapeau('tous-axes') ? ', axes confondus' : ' sur un même axe')
);
console.log('-'.repeat(78));
console.log(`Portes de ville            : ${portes.length} sur ${new Set(portes.map(villeDe)).size} villes`);
console.log(`Groupes portant un doublon : ${groupes.length}`);
console.log(`Portes à retirer           : ${aRetirer.length}`);
console.log('');

for (const g of groupes) {
  console.log(`  ${g.titre}`);
  for (const m of g.gardes) {
    console.log(`    GARDÉE    ${auCentre(m).toFixed(2).padStart(6)} km du centre   ${m.id}`);
  }
  for (const m of g.partent) {
    console.log(`    retirée   ${auCentre(m).toFixed(2).padStart(6)} km du centre   ${m.id}`);
  }
}

if (!aRetirer.length) {
  console.log('Aucune redondance sur un même axe.');
  console.log('');
  process.exit(0);
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.');
  console.log('');
  process.exit(0);
}

const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-degagement-portes.json');
copyFileSync(FICHIER, sauvegarde);

const partis = new Set(aRetirer.map((m) => m.id));
depot.items = items.filter((m) => !partis.has(m.id));
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

const reste = depot.items.filter((m) => /^barrage_/.test(m.type)).length;
console.log('');
console.log(`${aRetirer.length} porte(s) redondante(s) retirée(s). Parc : ${reste} barrages.`);
console.log(`Sauvegarde : ${sauvegarde}`);
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
