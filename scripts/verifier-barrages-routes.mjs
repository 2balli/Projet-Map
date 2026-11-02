#!/usr/bin/env node
/**
 * VALIDATION DES BARRAGES — sont-ils vraiment sur une route, et dans la bonne
 * circonscription ?
 *
 * Ce contrôle ne fait confiance à rien de ce que le semeur a pu croire faire :
 * il repart des sources — `graphe_routier.json` pour le réseau,
 * `circo_bt.geojson` pour le découpage — et re-vérifie chaque poste un par un.
 * C'est la seule façon de répondre « oui » à « ce barrage est-il sur une
 * route ? » sans se contenter de l'affirmation de celui qui l'a posé.
 *
 * CE QU'IL VÉRIFIE, POSTE PAR POSTE :
 *
 *   région, compagnie, brigade renseignées et cohérentes entre elles ;
 *   faction valide et horaire correspondant à cette faction ;
 *   coordonnées numériques, dans les bornes du monde ;
 *   coordonnées DANS le polygone de la brigade déclarée ;
 *   coordonnées SUR une route — distance à la géométrie du réseau sous
 *     tolérance ;
 *   aucun doublon de coordonnées exactes.
 *
 * Il rend aussi la répartition demandée : par région, compagnie, brigade et
 * faction.
 *
 *   node scripts/verifier-barrages-routes.mjs --donnees donnees-demo
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerGraphe, pointsArete, classeArete, distanceKm } from '../serveur/routage.mjs';
import { dansGeometrie } from '../serveur/geo.mjs';
import { FACTIONS, factionParId } from '../serveur/factions.mjs';
import { chargerRoutesAffichees, pointSurRouteAffichee } from '../serveur/routesAffichees.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(nom);
  return i > -1 ? (process.argv[i + 1] ?? true) : defaut;
};
const DONNEES = resolve(ROOT, arg('--donnees', 'donnees-serveur'));
const COUCHES = resolve(ROOT, arg('--couches', 'public/layers'));

/**
 * TOLÉRANCE — 50 mètres.
 *
 * Elle n'est pas là pour excuser un placement approximatif : un poste semé sur
 * le réseau tombe à quelques centimètres de la polyligne. Elle absorbe
 * l'arrondi des coordonnées à cinq décimales (environ 1 m) et l'écart
 * d'échantillonnage de la mesure ci-dessous, qui compare à des points repris
 * tous les 200 m le long des arêtes plutôt qu'à la ligne continue. Au-delà de
 * 50 m, le poste n'est plus sur la chaussée : il est à côté.
 */
const TOLERANCE_M = Number(arg('--tolerance', 25));

/**
 * SUR QUELLE GÉOMÉTRIE ON JUGE — et pourquoi ce n'est pas celle du graphe.
 *
 * `build:roads` produit DEUX simplifications du même réseau : 40 m pour
 * `graphe_routier.json` (le calcul) et 60 m pour `routes_*.geojson` (le dessin).
 * Là où les deux coupent une courbe de part et d'autre, elles s'écartent de
 * plusieurs dizaines de mètres.
 *
 * « Ce barrage est-il sur une route ? » est une question de CE QU'ON VOIT : le
 * contrôle porte donc sur le trait dessiné. Juger sur le graphe validerait des
 * postes que l'utilisateur voit à côté de la chaussée — c'est exactement ce que
 * faisait la première version de ce script, qui annonçait 100 % de réussite
 * pendant que 14 % des postes étaient visiblement décalés.
 *
 * La ROUTABILITÉ est contrôlée à part, et plus largement : un poste doit
 * s'accrocher au graphe pour que distances et temps de trajet aient un sens,
 * mais quelques dizaines de mètres n'y changent rien (`accrocher` cherche dans
 * un rayon de plusieurs kilomètres).
 */
const TOLERANCE_GRAPHE_M = Number(arg('--tolerance-graphe', 150));
/** Pas de reprise de la géométrie pour la mesure de distance à la route. */
const PAS_MESURE_KM = 0.2;

if (!existsSync(DONNEES)) {
  console.error(`\nDossier de donnees introuvable : ${DONNEES}\n`);
  process.exit(1);
}

let ok = 0;
const ecarts = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else ecarts.push(titre);
};

/* ------------------------------------------------------------------ */

const circo = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || !f.geometry || BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, {
    bt,
    cie: f.properties?.gr_cie ?? null,
    reg: f.properties?.gr_region ?? null,
    geometry: f.geometry,
  });
}

const graphe = chargerGraphe(JSON.parse(readFileSync(join(COUCHES, 'graphe_routier.json'), 'utf8')));

/** La géométrie que la carte DESSINE — c'est sur elle que le contrôle porte. */
const routesAffichees = chargerRoutesAffichees(COUCHES);

/**
 * LE RÉSEAU EN POINTS, INDEXÉ — pour mesurer la distance d'un poste à la route
 * la plus proche sans balayer 65 000 arêtes par poste.
 *
 * On reprend la géométrie tous les 200 m et on range les points dans une
 * grille. Chercher revient alors à regarder les neuf mailles autour du poste.
 */
const MAILLE = 0.02; // ~2 km
const RESEAU = new Map();
let pointsReseau = 0;
for (let i = 0; i < graphe.nA; i++) {
  const classe = classeArete(graphe, i);
  const pts = pointsArete(graphe, i);
  let reste = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1];
    const [x2, y2] = pts[k];
    const seg = distanceKm(x1, y1, x2, y2);
    if (!(seg > 0)) continue;
    let pos = reste;
    while (pos <= seg) {
      const t = pos / seg;
      const lng = x1 + t * (x2 - x1);
      const lat = y1 + t * (y2 - y1);
      const cle = `${Math.floor(lng / MAILLE)}|${Math.floor(lat / MAILLE)}`;
      if (!RESEAU.has(cle)) RESEAU.set(cle, []);
      RESEAU.get(cle).push([lng, lat, classe]);
      pointsReseau++;
      pos += PAS_MESURE_KM;
    }
    reste = pos - seg;
  }
}

/** Distance en mètres du poste au point de réseau le plus proche. */
function distanceALaRoute(lng, lat) {
  const cx = Math.floor(lng / MAILLE);
  const cy = Math.floor(lat / MAILLE);
  let meilleure = Infinity;
  let classe = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const lot = RESEAU.get(`${cx + dx}|${cy + dy}`);
      if (!lot) continue;
      for (const [x, y, c] of lot) {
        const d = distanceKm(lng, lat, x, y) * 1000;
        if (d < meilleure) {
          meilleure = d;
          classe = c;
        }
      }
    }
  }
  return { metres: meilleure, classe };
}

/* ------------------------------------------------------------------ */

const items = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items ?? [];
const TYPES = ['barrage_fixe', 'barrage_mobile'];
const HORS_SERVICE = ['supprime', 'retire_optimisation'];
const tous = items.filter((m) => TYPES.includes(m.type) && !HORS_SERVICE.includes(m.statutBarrage));

/**
 * LES POSTES SEMÉS ET LES POSTES POSÉS À LA MAIN — deux exigences distinctes.
 *
 * Ce contrôle garde la GÉNÉRATION : un poste produit par `semer-barrages-routes`
 * doit être sur une route, dans sa brigade, avec sa faction. Aucune tolérance,
 * c'est le contrat du semeur.
 *
 * Un poste posé à la main par un chef n'a pas ce contrat. Il peut se trouver à
 * deux cents mètres d'un axe — une aire de repos, un carrefour non cartographié —
 * et n'avoir pas encore de faction : le commandement la fixera. En faire un
 * ÉCART ferait échouer ce contrôle à la première saisie de terrain, et l'on
 * prendrait vite l'habitude de l'ignorer. Ils sont donc comptés et listés à
 * part, comme une information.
 *
 * Le discriminant est l'auteur : le semeur signe « SYSTEME ».
 */
const semePar = (m) => m?.auteur?.matricule === 'SYSTEME';
const postes = tous.filter(semePar);
const posesALaMain = tous.filter((m) => !semePar(m));

console.log(`\n  données : ${DONNEES}`);
console.log(`  réseau  : ${pointsReseau} points repris tous les ${PAS_MESURE_KM * 1000} m`);
console.log(`  tolérance : trait ${TOLERANCE_M} m · routable ${TOLERANCE_GRAPHE_M} m\n`);
console.log('=== VALIDATION POSTE PAR POSTE ===\n');

const defauts = {
  region: [],
  compagnie: [],
  brigade: [],
  faction: [],
  horaire: [],
  coordonnees: [],
  horsCirconscription: [],
  horsRoute: [],
  horsGraphe: [],
};
const doublons = new Map();
let surRoute = 0;
let sommeDistance = 0;
let pireDistance = 0;
const parReg = new Map();
const parCie = new Map();
const parBt = new Map();
const parFaction = new Map();
const parClasse = new Map();

for (const m of postes) {
  const ref = m.nom || m.id;

  if (!m.reg) defauts.region.push(ref);
  if (!m.cie) defauts.compagnie.push(ref);
  if (!m.bt) defauts.brigade.push(ref);

  /* Cohérence de la chaîne : la brigade déclarée relève-t-elle bien de la
     compagnie et de la région déclarées, d'après le découpage officiel ? */
  const officielle = BRIGADES.get(m.bt);
  if (!officielle) {
    if (m.bt) defauts.brigade.push(`${ref} (brigade inconnue : ${m.bt})`);
  } else {
    if (officielle.cie !== m.cie) defauts.compagnie.push(`${ref} : ${m.cie} ≠ ${officielle.cie}`);
    if (officielle.reg !== m.reg) defauts.region.push(`${ref} : ${m.reg} ≠ ${officielle.reg}`);
  }

  const faction = m.factionId ? factionParId(m.factionId) : null;
  if (!faction) defauts.faction.push(ref);
  else {
    const finAttendue = faction.fin === '24:00' ? '00:00' : faction.fin;
    if (m.debut !== faction.debut || m.fin !== finAttendue) {
      defauts.horaire.push(`${ref} : ${m.debut}-${m.fin} ≠ ${faction.debut}-${finAttendue}`);
    }
    parFaction.set(m.factionId, (parFaction.get(m.factionId) ?? 0) + 1);
  }

  const lng = Number(m.lng);
  const lat = Number(m.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    defauts.coordonnees.push(ref);
    continue;
  }

  if (officielle && !dansGeometrie([lng, lat], officielle.geometry)) {
    defauts.horsCirconscription.push(`${ref} (${m.bt})`);
  }

  /* LE CRITÈRE : la distance au TRAIT DESSINÉ. */
  const surTrait = pointSurRouteAffichee(routesAffichees, lng, lat);
  const ecart = surTrait ? surTrait.metres : Infinity;
  if (ecart <= TOLERANCE_M) {
    surRoute++;
    sommeDistance += ecart;
    if (ecart > pireDistance) pireDistance = ecart;
    const cl = surTrait.classe || '(sans classe)';
    parClasse.set(cl, (parClasse.get(cl) ?? 0) + 1);
  } else {
    defauts.horsRoute.push(`${ref} à ${Math.round(ecart)} m du trait`);
  }

  /* LA ROUTABILITÉ, à part : le poste s'accroche-t-il encore au graphe ? */
  const { metres } = distanceALaRoute(lng, lat);
  if (metres > TOLERANCE_GRAPHE_M) {
    defauts.horsGraphe.push(`${ref} à ${Math.round(metres)} m du graphe`);
  }

  const cle = `${lng},${lat}`;
  doublons.set(cle, (doublons.get(cle) ?? 0) + 1);

  parReg.set(m.reg, (parReg.get(m.reg) ?? 0) + 1);
  parCie.set(m.cie, (parCie.get(m.cie) ?? 0) + 1);
  parBt.set(`${m.cie}/${m.bt}`, (parBt.get(`${m.cie}/${m.bt}`) ?? 0) + 1);
}

const nbDoublons = [...doublons.values()].filter((n) => n > 1).length;

const bilan = (titre, liste) =>
  dit(liste.length === 0, titre, liste.length ? `${liste.length} — ex. ${liste[0]}` : '');

bilan('région valide et cohérente avec le découpage', defauts.region);
bilan('compagnie valide et cohérente avec le découpage', defauts.compagnie);
bilan('brigade valide et connue du découpage', defauts.brigade);
bilan('faction valide', defauts.faction);
bilan('horaire correspondant à la faction', defauts.horaire);
bilan('coordonnées numériques et dans les bornes', defauts.coordonnees);
bilan('coordonnées DANS la circonscription de la brigade', defauts.horsCirconscription);
bilan(`coordonnées SUR le trait dessiné (≤ ${TOLERANCE_M} m)`, defauts.horsRoute);
bilan(`poste routable — accroché au graphe (≤ ${TOLERANCE_GRAPHE_M} m)`, defauts.horsGraphe);
dit(nbDoublons === 0, 'aucun doublon de coordonnées exactes', nbDoublons ? `${nbDoublons}` : '');

/* ------------------------------------------------------------------ */

console.log('\n=== RÉPARTITION ===\n');
console.log(`  Total barrages          : ${postes.length}`);
console.log(`  Barrages sur le trait   : ${surRoute}`);
console.log(`  Barrages hors trait     : ${defauts.horsRoute.length}`);
console.log(`  Doublons de coordonnées : ${nbDoublons}`);
console.log(`  Rattachements invalides : ${defauts.horsCirconscription.length}`);
if (surRoute) {
  console.log(
    `  Distance à la route     : moyenne ${(sommeDistance / surRoute).toFixed(1)} m · ` +
      `maximum ${pireDistance.toFixed(1)} m`,
  );
}

console.log(`\n  Régions    : ${parReg.size}`);
console.log(`  Compagnies : ${parCie.size}`);
console.log(`  Brigades   : ${parBt.size}`);

console.log('\n  Par faction :');
for (const f of FACTIONS) {
  console.log(`    ${f.id}  ${f.libelle}   ${String(parFaction.get(f.id) ?? 0).padStart(5)}`);
}

console.log('\n  Par classe de route :');
for (const [c, n] of [...parClasse.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(c).padEnd(12)} ${String(n).padStart(5)}`);
}

const etendue = (m) => {
  const v = [...m.values()].sort((a, b) => a - b);
  return `min ${v[0]} · médiane ${v[Math.floor(v.length / 2)]} · max ${v[v.length - 1]}`;
};
console.log(`\n  Par région    : ${etendue(parReg)}`);
console.log(`  Par compagnie : ${etendue(parCie)}`);
console.log(`  Par brigade   : ${etendue(parBt)}`);

console.log('\n  Dix premières régions :');
for (const [r, n] of [...parReg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${String(r).padEnd(24)} ${String(n).padStart(5)}`);
}

/* ------------------------------------------------------------------ */
/* LES POSTES POSÉS À LA MAIN — information, jamais écart              */
/* ------------------------------------------------------------------ */

if (posesALaMain.length) {
  console.log(`\n=== POSTES POSÉS À LA MAIN (${posesALaMain.length}) ===\n`);
  console.log('  Hors du contrat du semeur : signalés, jamais comptés en écart.\n');
  for (const m of posesALaMain.slice(0, 20)) {
    const lng = Number(m.lng);
    const lat = Number(m.lat);
    const d = Number.isFinite(lng) && Number.isFinite(lat) ? distanceALaRoute(lng, lat) : null;
    const manques = [];
    if (!m.factionId) manques.push('sans faction');
    if (d && d.metres > TOLERANCE_M) manques.push(`a ${Math.round(d.metres)} m d'une route`);
    if (!m.nom) manques.push('sans nom');
    console.log(
      `    ${(m.nom || m.id).padEnd(26)} ${m.cie ?? '-'} / ${m.bt ?? '-'}` +
        (manques.length ? `  — ${manques.join(', ')}` : '  — complet'),
    );
  }
  if (posesALaMain.length > 20) console.log(`    … et ${posesALaMain.length - 20} autre(s)`);
  console.log(
    '\n  Un poste sans faction n’apparaît sous aucun filtre de faction : il reste' +
      '\n  visible sous « Toutes les factions » jusqu’à ce qu’un tour de service lui' +
      '\n  soit attribué.',
  );
}

console.log(`\n  ${ok} contrôle(s) conforme(s), ${ecarts.length} écart(s).`);
if (ecarts.length) {
  for (const e of ecarts) console.log(`    - ${e}`);
  process.exit(1);
}
console.log('');
