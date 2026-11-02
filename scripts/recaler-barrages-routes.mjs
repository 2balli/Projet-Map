#!/usr/bin/env node
/**
 * RECALER LES BARRAGES SUR LE TRAIT DESSINÉ.
 *
 * LE DÉFAUT CORRIGÉ. Les postes ont été semés sur `graphe_routier.json`, la
 * géométrie de CALCUL, simplifiée à 40 m. La carte, elle, dessine
 * `routes_*.geojson`, simplifiée à 60 m. Les deux coupent les courbes
 * différemment : un poste parfaitement posé sur le graphe peut se trouver à
 * plusieurs dizaines de mètres du trait affiché — dans un virage, jusqu'à une
 * centaine. Il est alors « sur la route » pour tous les calculs et
 * manifestement À CÔTÉ pour qui regarde la carte.
 *
 * Mesuré avant correction sur le dispositif semé : 14 % des postes à plus de
 * 25 m du trait, jusqu'à 67 m.
 *
 * CE QUE FAIT CE SCRIPT. Il rabat chaque poste sur la polyligne affichée la
 * plus proche, par projection orthogonale. Rien d'autre ne bouge : ni
 * l'identifiant, ni la faction, ni la brigade, ni l'horaire.
 *
 * TROIS GARDES, ET AUCUNE N'EST DÉCORATIVE :
 *
 *   BRIGADE     le point recalé doit rester dans la circonscription du poste.
 *               Un poste au bord d'un découpage pourrait sinon basculer chez le
 *               voisin pour gagner trois mètres ;
 *   DISTANCE    au-delà de `--max-recalage` (150 m par défaut), on ne touche
 *               pas : un tel écart ne vient pas de la simplification, il vient
 *               d'autre chose, et le corriger d'office masquerait le vrai
 *               problème ;
 *   POSÉS À LA MAIN  un poste qu'un chef a placé lui-même n'est PAS recalé. Il
 *               l'a mis là où il le voulait — peut-être sur une aire non
 *               cartographiée. Le déplacer serait défaire son travail.
 *
 * RIEN N'EST ÉCRIT SANS `--ecrire`. Sauvegarde horodatée avant toute écriture.
 *
 *   node scripts/recaler-barrages-routes.mjs --donnees donnees-demo
 *   node scripts/recaler-barrages-routes.mjs --donnees donnees-demo --ecrire
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chargerRoutesAffichees,
  pointSurRouteAffichee,
  pointSurRouteAccepte,
} from '../serveur/routesAffichees.mjs';
import { dansGeometrie } from '../serveur/geo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(nom);
  return i > -1 ? (process.argv[i + 1] ?? true) : defaut;
};
const DONNEES = resolve(ROOT, arg('--donnees', 'donnees-serveur'));
const COUCHES = resolve(ROOT, arg('--couches', 'public/layers'));
const ECRIRE = process.argv.includes('--ecrire');
/** Au-delà, l'écart ne vient pas de la simplification : on ne corrige pas. */
const MAX_RECALAGE_M = Number(arg('--max-recalage', 150));

/**
 * BUDGET ÉLARGI POUR LES POSTES DE BORDURE.
 *
 * Quand le trait le plus proche sort de la circonscription, il faut aller
 * chercher le suivant — et il peut être notablement plus loin. Un poste qui se
 * décale de trois cents mètres LE LONG D'UNE ROUTE DE SA PROPRE BRIGADE reste
 * exactement ce qu'il était : un point de contrôle sur un axe qu'elle tient. Le
 * laisser à cinquante mètres du trait, en revanche, se voit sur la carte.
 *
 * Le budget ordinaire reste serré (150 m) : il ne corrige qu'un écart de
 * simplification, et n'a aucune raison de déplacer un poste bien posé.
 */
const MAX_BORDURE_M = Number(arg('--max-bordure', 600));

if (!existsSync(DONNEES)) {
  console.error(`\nDossier de donnees introuvable : ${DONNEES}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */

const circo = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || !f.geometry || BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, f.geometry);
}

console.log('\n  RECALAGE DES BARRAGES SUR LE TRAIT DESSINÉ\n');
console.log(`  données : ${DONNEES}`);
console.log(`  couches : ${COUCHES}`);

const index = chargerRoutesAffichees(COUCHES);
console.log(`  segments affichés : ${index.nombre}`);
console.log(`  recalage maximal  : ${MAX_RECALAGE_M} m\n`);

const chemin = join(DONNEES, 'marquages.json');
const brut = JSON.parse(readFileSync(chemin, 'utf8'));
const items = brut.items ?? [];

const TYPES = ['barrage_fixe', 'barrage_mobile'];
const HORS_SERVICE = ['supprime', 'retire_optimisation'];
const semePar = (m) => m?.auteur?.matricule === 'SYSTEME';

let examines = 0;
let recales = 0;
let dejaJustes = 0;
let horsBrigade = 0;
let recalesBordure = 0;
let tropLoin = 0;
let posesALaMain = 0;
const avant = [];
const apres = [];

const majItems = items.map((m) => {
  if (!TYPES.includes(m.type) || HORS_SERVICE.includes(m.statutBarrage)) return m;
  if (!semePar(m)) {
    posesALaMain++;
    return m;
  }
  examines++;

  const p = pointSurRouteAffichee(index, m.lng, m.lat);
  if (!p) {
    tropLoin++;
    return m;
  }
  avant.push(p.metres);

  /* Déjà sur le trait, à l'arrondi près : ne rien réécrire pour un demi-mètre. */
  if (p.metres <= 1) {
    dejaJustes++;
    apres.push(p.metres);
    return m;
  }
  if (p.metres > MAX_RECALAGE_M) {
    tropLoin++;
    apres.push(p.metres);
    return m;
  }

  const lng = +p.lng.toFixed(5);
  const lat = +p.lat.toFixed(5);

  /* LE POSTE RESTE DANS SA BRIGADE — sinon il changerait d'autorité. */
  const contour = BRIGADES.get(m.bt);
  if (contour && !dansGeometrie([lng, lat], contour)) {
    /**
     * SECONDE PASSE POUR LES POSTES DE BORDURE.
     *
     * Le trait le plus proche sort de la circonscription — cela arrive le long
     * d'une limite, où la route longe la frontière administrative. Plutôt que
     * de renoncer, on cherche le point le plus proche PARMI CEUX QUI RESTENT
     * dans la brigade. Sans cette passe, les postes de bordure étaient les
     * seuls à demeurer visiblement à côté de la route.
     */
    const replie = pointSurRouteAccepte(
      index,
      m.lng,
      m.lat,
      (x, y) => dansGeometrie([+x.toFixed(5), +y.toFixed(5)], contour),
      /* Quatre anneaux : ~10 km de recherche, assez pour trouver un axe de la
         brigade quand celui d'à côté appartient au voisin. */
      4,
    );
    if (!replie || replie.metres > MAX_BORDURE_M) {
      horsBrigade++;
      apres.push(p.metres);
      return m;
    }
    recalesBordure++;
    apres.push(0);
    return { ...m, lng: +replie.lng.toFixed(5), lat: +replie.lat.toFixed(5) };
  }

  recales++;
  apres.push(0);
  return { ...m, lng, lat };
});

/* ------------------------------------------------------------------ */

const stat = (liste) => {
  if (!liste.length) return 'aucun';
  const t = [...liste].sort((a, b) => a - b);
  const moy = t.reduce((s, x) => s + x, 0) / t.length;
  return (
    `moyenne ${moy.toFixed(1)} m · médiane ${t[Math.floor(t.length / 2)].toFixed(1)} m · ` +
    `p95 ${t[Math.floor(t.length * 0.95)].toFixed(1)} m · max ${t[t.length - 1].toFixed(1)} m`
  );
};
const auDela = (liste, seuil) => liste.filter((d) => d > seuil).length;

console.log(`  barrages semés examinés : ${examines}`);
console.log(`  posés à la main (intacts) : ${posesALaMain}\n`);
console.log(`  AVANT : ${stat(avant)}`);
console.log(`          ${auDela(avant, 25)} poste(s) à plus de 25 m du trait`);
console.log(`  APRÈS : ${stat(apres)}`);
console.log(`          ${auDela(apres, 25)} poste(s) à plus de 25 m du trait\n`);
console.log(`  recalés          : ${recales}`);
console.log(`  recalés en bordure (2e passe) : ${recalesBordure}`);
console.log(`  déjà sur le trait : ${dejaJustes}`);
console.log(`  laissés (aucun trait dans leur brigade à moins de ${MAX_BORDURE_M} m) : ${horsBrigade}`);
console.log(`  laissés (écart > ${MAX_RECALAGE_M} m)   : ${tropLoin}`);

if (!ECRIRE) {
  console.log('\n  --ecrire absent : RIEN n’a été modifié.\n');
  process.exit(0);
}

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const dossier = join(DONNEES, 'sauvegardes', `avant-recalage-${horodatage}`);
mkdirSync(dossier, { recursive: true });
copyFileSync(chemin, join(dossier, 'marquages.json'));

writeFileSync(chemin, JSON.stringify({ ...brut, items: majItems }, null, 2));

console.log(`\n  ÉCRIT.\n`);
console.log(`  sauvegarde : ${dossier}`);
console.log(`  ${recales + recalesBordure} poste(s) recalé(s) sur le trait dessiné.\n`);
