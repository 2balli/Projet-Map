#!/usr/bin/env node
/**
 * QUALIFICATION ENTRÉE / SORTIE / PORTE DE VILLE — correction des données.
 *
 * CE QUE L'AUDIT A TROUVÉ
 * -----------------------
 * 219 barrages portaient `positionVille: 'entree'` contre 11 en `sortie`.
 * L'asymétrie ne vient pas du terrain : 212 de ces 219 sont des portes de ville
 * posées par `scripts/build-portes-ville.mjs`, qui écrit `entree` sur TOUTES
 * — son propre commentaire l'assume : « une porte est par nature une entrée ET
 * une sortie ; le champ ne retient qu'une valeur ». `entree` servait donc de
 * drapeau « porte », pas de classification.
 *
 * Conséquence pour l'utilisateur : le filtre « Entrée de ville » de
 * l'Optimisation rendait 219 postes dont la quasi-totalité sont aussi des
 * sorties, et « Sortie de ville » n'en rendait presque aucun.
 *
 * POURQUOI LA DIRECTION N'EST PAS CALCULABLE
 * ------------------------------------------
 * `public/layers/graphe_routier.json` ne porte AUCUN sens de circulation, et
 * `serveur/routage.mjs` insère chaque arête dans les deux sens : le graphe est
 * non orienté. Un point posé sur une chaussée à double sens est une entrée
 * quand on arrive et une sortie quand on part. Sans sens unique ni chaussées
 * séparées dans les données, rien ne permet de trancher — et on ne tranche donc
 * pas : on dit `porte`.
 *
 * CE QUE FAIT CE SCRIPT
 * ---------------------
 *   porte-ville-auto, à plus de `--hors-ville` km d'un chef-lieu  ->  `porte`
 *   porte-ville-auto, à moins que ça                              ->  `none`
 *   tout le reste                                                 ->  INCHANGÉ
 *
 * Le second cas n'est pas un détail : le script des portes s'impose à lui-même
 * de rester hors du tissu urbain (défaut 2,5 km), et quatorze de ses portes
 * violent cette règle — l'une est à 270 m du centre de Chichaoua, donc en zone
 * de Sûreté Nationale. Les déclarer « porte de ville » serait faux ; on les
 * rend à « non déterminé », comme demandé, plutôt que d'inventer.
 *
 * LES ÉTIQUETTES SAISIES À LA MAIN, ELLES AUSSI
 * ---------------------------------------------
 * Je les avais d'abord laissées intactes — « un humain a jugé, une heuristique
 * de distance n'a pas à le contredire ». La mesure a tranché autrement : 26 des
 * 37 sont à plus de 6 km d'un chef-lieu, et jusqu'à 32 km. Un poste à trente
 * kilomètres de la première ville n'est l'entrée d'aucune agglomération, quel
 * que soit ce qu'on a coché dans sa fiche.
 *
 * Le seuil de 6 km n'est pas choisi ici : c'est `RAYON_KM`, le rayon dans
 * lequel `build-portes-ville.mjs` cherche les portes d'une ville. Au-delà, le
 * projet lui-même considère qu'on n'est plus à une porte.
 *
 * Ces étiquettes repassent donc à « non déterminé » — mieux vaut ne rien dire
 * que d'affirmer faux. `--garder-saisies` les laisse tranquilles.
 *
 * Aucun autre champ n'est modifié : ni coordonnées, ni nom, ni identifiant, ni
 * type, ni affectation, ni statut.
 *
 *   node scripts/qualifier-portes-ville.mjs                aperçu, n'écrit rien
 *   node scripts/qualifier-portes-ville.mjs --ecrire       applique
 *   node scripts/qualifier-portes-ville.mjs --hors-ville 3 change le seuil
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

/** Même seuil que `HORS_VILLE_KM` dans build-portes-ville.mjs. */
const HORS_VILLE_KM = valeur('hors-ville', 2.5);
/** `RAYON_KM` de build-portes-ville.mjs : au-delà, ce n'est plus une porte. */
const RAYON_VILLE_KM = valeur('rayon-ville', 6);
const MARQUE = 'porte-ville-auto';

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];

/* Les chefs-lieux de compagnie : les centres-villes de référence, ceux-là
   mêmes qu'a utilisés le script des portes. */
const chefsLieux = JSON.parse(
  readFileSync(join(ROOT, 'public/layers/pts_cie.geojson'), 'utf8')
).features.map((f) => ({
  nom: f.properties?.nom ?? '?',
  lng: f.geometry.coordinates[0],
  lat: f.geometry.coordinates[1],
}));

const auCentre = (m) => {
  let d = Infinity;
  let ville = null;
  for (const p of chefsLieux) {
    const x = distanceKm(m.lng, m.lat, p.lng, p.lat);
    if (x < d) {
      d = x;
      ville = p.nom;
    }
  }
  return { d, ville };
};

const barrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');
const portes = barrages.filter((m) => m.note === MARQUE);
const mains = barrages.filter(
  (m) => m.note !== MARQUE && m.positionVille && m.positionVille !== 'none'
);

const versPorte = [];
const versNone = [];
/* Étiquettes saisies à la main, mais géographiquement impossibles. */
const saisiesImpossibles = drapeau('garder-saisies')
  ? []
  : mains
      .map((m) => ({ m, ...auCentre(m) }))
      .filter((x) => x.d > RAYON_VILLE_KM)
      .sort((a, b) => a.d - b.d);
for (const m of portes) {
  const { d, ville } = auCentre(m);
  (d >= HORS_VILLE_KM ? versPorte : versNone).push({ m, d, ville });
}

console.log('');
console.log('QUALIFICATION ENTRÉE / SORTIE / PORTE DE VILLE');
console.log('-'.repeat(78));
console.log(`Parc                                  : ${barrages.length} barrages`);
console.log(`Portes générées (« ${MARQUE} ») : ${portes.length}`);
console.log(`Classées à la main, intouchées         : ${mains.length}`);
console.log('');
console.log(`  -> « porte de ville » (≥ ${HORS_VILLE_KM} km d'un centre)  : ${versPorte.length}`);
console.log(`  -> « non déterminé » (trop près du centre)    : ${versNone.length}`);
console.log(`  -> « non déterminé » (aucune ville à ${RAYON_VILLE_KM} km)    : ${saisiesImpossibles.length}`);
console.log('');

if (versNone.length) {
  console.log(`  DÉCLASSÉES — plus proches du centre que les ${HORS_VILLE_KM} km que le script s'impose :`);
  for (const { m, d, ville } of versNone.sort((a, b) => a.d - b.d)) {
    console.log(`    ${d.toFixed(2).padStart(6)} km de ${String(ville).padEnd(22)} ${m.nom || '(sans nom)'}`);
  }
  console.log('');
}

console.log(`  SAISIES À LA MAIN — ${mains.length}, dont ${saisiesImpossibles.length} hors de portée d'une ville :`);
for (const m of mains) {
  const { d, ville } = auCentre(m);
  const verdict =
    d > RAYON_VILLE_KM
      ? drapeau('garder-saisies')
        ? '   ← à plus de 6 km, mais conservée (--garder-saisies)'
        : '   → « non déterminé » : aucune ville à moins de 6 km'
      : '';
  console.log(
    `    ${String(m.type).replace('barrage_', '').padEnd(7)} ${String(m.positionVille).padEnd(7)} ${d.toFixed(1).padStart(6)} km de ${String(ville).padEnd(20)} ${String(m.route || '—').padEnd(7)}${verdict}`
  );
}

if (!versPorte.length && !versNone.length && !saisiesImpossibles.length) {
  console.log('');
  console.log('Rien à requalifier.');
  console.log('');
  process.exit(0);
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.');
  console.log('');
  process.exit(0);
}

const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-portes-qualifiees.json');
copyFileSync(FICHIER, sauvegarde);

const aPorte = new Set(versPorte.map((x) => x.m.id));
const aNone = new Set([...versNone, ...saisiesImpossibles].map((x) => x.m.id));
let changes = 0;
for (const m of items) {
  if (aPorte.has(m.id) && m.positionVille !== 'porte') {
    m.positionVille = 'porte';
    changes++;
  } else if (aNone.has(m.id) && m.positionVille !== 'none') {
    m.positionVille = 'none';
    changes++;
  }
}
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log('');
console.log(`${changes} fiche(s) requalifiée(s) — seul le champ positionVille a changé.`);
console.log(`Sauvegarde : ${sauvegarde}`);
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
