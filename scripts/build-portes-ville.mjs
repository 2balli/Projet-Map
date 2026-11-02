#!/usr/bin/env node
/**
 * Barrages aux PORTES DE VILLE — entrées et sorties d'agglomération.
 *
 * Pourquoi ce script
 * ------------------
 * La Gendarmerie Royale tient les axes ENTRE les villes ; l'intérieur des
 * agglomérations relève de la Sûreté Nationale. Les points de contrôle utiles
 * sont donc là où une route importante entre dans une ville ou en sort — pas
 * dans le tissu urbain.
 *
 * Méthode
 * -------
 * Pour chaque chef-lieu, on parcourt le réseau routier depuis la ville
 * (Dijkstra borné) et on s'arrête au rayon demandé. Chaque route qui FRANCHIT
 * ce rayon est une porte : le barrage est posé exactement au point de
 * franchissement, donc sur la chaussée, à l'extérieur du noyau urbain.
 *
 * Seules les classes inter-urbaines sont retenues (autoroute, nationale,
 * régionale) : une desserte locale n'est pas un axe à contrôler.
 *
 * Rien n'est écrasé : un emplacement déjà couvert par un barrage existant est
 * ignoré, et `--retirer` défait exactement ce que ce script a posé.
 *
 *   node scripts/build-portes-ville.mjs                 aperçu, n'écrit rien
 *   node scripts/build-portes-ville.mjs --ecrire        enregistre
 *   node scripts/build-portes-ville.mjs --retirer       retire les portes générées
 *
 * Options :
 *   --rayon <km>      distance au centre-ville           (défaut 6)
 *   --ecart <km>      distance minimale entre deux portes (défaut 2)
 *   --villes <n>      nombre de chefs-lieux traités      (défaut : tous)
 *   --niveau <cie|bt> chefs-lieux de compagnie ou de brigade (défaut cie)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { chargerGraphe, distanceKm, accrocher, refArete, classeArete, pointsArete } from '../serveur/routage.mjs';
import { chargerCirconscriptions, localiser } from '../serveur/geo.mjs';
import { normaliser } from '../serveur/depot.mjs';
import { chargerZonesUrbaines, RAYONS_URBAINS } from './zones-urbaines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

const RAYON_KM = Number(valeur('rayon', 6));
/**
 * ÉCART MINIMAL ENTRE DEUX PORTES — aligné sur la doctrine d'espacement.
 *
 * Il valait 2 km. Le dispositif, lui, demande 5 km entre deux barrages : le
 * générateur fabriquait donc des violations par construction, et les portes de
 * ville se retrouvaient signalées « trop rapprochées » deux fois et demie plus
 * souvent que les barrages ordinaires — 28 % contre 11 %. Sur 56 portes
 * signalées, 48 avaient pour voisin une autre porte.
 *
 * À 5 km, deux portes d'une même ville ne peuvent plus se gêner l'une l'autre.
 * Conséquence assumée : certaines villes reçoivent moins de portes qu'avant,
 * les axes trop serrés ne pouvant plus être équipés séparément.
 */
const ECART_KM = Number(valeur('ecart', 5));

/**
 * Distance minimale À VOL D'OISEAU entre une porte et le centre-ville.
 *
 * Le rayon ci-dessus se mesure PAR LA ROUTE : une voie sinueuse peut faire
 * 6 km de chaussée en ne s'éloignant que de 300 m du centre, et la « porte »
 * se retrouve alors en plein tissu urbain — précisément la zone qui ne relève
 * pas de la Gendarmerie. Ce second seuil, purement géométrique, écarte ces cas.
 */
const HORS_VILLE_KM = Number(valeur('hors-ville', 2.5));
const NIVEAU = valeur('niveau', 'cie') === 'bt' ? 'bt' : 'cie';
const MAX_VILLES = valeur('villes') ? Number(valeur('villes')) : Infinity;

/** Marqueur des barrages posés par ce script — permet `--retirer` sans ambiguïté. */
const MARQUE = 'porte-ville-auto';

/** Axes inter-urbains seulement : une desserte locale ne se contrôle pas. */
const CLASSES_RETENUES = new Set(['autoroute', 'nationale', 'regionale']);

/* ------------------------------------------------------------------ */

const graphe = chargerGraphe(JSON.parse(readFileSync(join(COUCHES, 'graphe_routier.json'), 'utf8')));
const circo = chargerCirconscriptions(COUCHES);
const zones = chargerZonesUrbaines(COUCHES);
const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];

/* ---------------------------- retrait ----------------------------- */

if (drapeau('retirer')) {
  const avant = items.length;
  depot.items = items.filter((m) => m.note !== MARQUE);
  const retires = avant - depot.items.length;
  if (retires) writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
  console.log(`\n${retires} porte(s) de ville retirée(s). ${depot.items.length} marquage(s) restants.\n`);
  process.exit(0);
}

/* ---------------------------- villes ------------------------------ */

const fichierPts = NIVEAU === 'bt' ? 'pts_bt.geojson' : 'pts_cie.geojson';
const pts = JSON.parse(readFileSync(join(COUCHES, fichierPts), 'utf8'));
const villes = (pts.features ?? [])
  .filter((f) => f.geometry?.type === 'Point')
  .map((f) => ({
    nom: f.properties?.nom ?? f.properties?.unite ?? 'Ville',
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }))
  .slice(0, MAX_VILLES);

/* ------------------- point à N mètres le long d'une arête ---------- */

/**
 * Coordonnées du point situé à `metres` de l'extrémité choisie, en suivant la
 * géométrie réelle de l'arête — pas la corde entre ses extrémités : sur une
 * route de montagne, l'écart se compte en kilomètres.
 */
function pointSurArete(g, i, depuisA, metres) {
  const pts = pointsArete(g, i);
  const suite = depuisA ? pts : [...pts].reverse();
  let cumul = 0;
  for (let k = 1; k < suite.length; k++) {
    const seg = distanceKm(suite[k - 1][0], suite[k - 1][1], suite[k][0], suite[k][1]) * 1000;
    if (cumul + seg >= metres) {
      const t = seg > 0 ? (metres - cumul) / seg : 0;
      return [
        suite[k - 1][0] + t * (suite[k][0] - suite[k - 1][0]),
        suite[k - 1][1] + t * (suite[k][1] - suite[k - 1][1]),
      ];
    }
    cumul += seg;
  }
  return suite[suite.length - 1];
}

/* ------------------- portes d'une ville (Dijkstra borné) ----------- */

/**
 * Routes franchissant le cercle de rayon `rayonKm` autour de la ville.
 *
 * Le sens de circulation est ignoré : on cherche un emplacement géographique,
 * pas un trajet. Une porte à sens unique reste une porte.
 */
function portesDeVille(g, ville, rayonKm) {
  const acc = accrocher(g, ville.lng, ville.lat, 20);
  if (!acc) return [];

  const rayonM = rayonKm * 1000;
  const dist = new Float64Array(g.nS).fill(Infinity);
  const tas = [];

  for (const s of [g.A[acc.arete], g.B[acc.arete]]) {
    dist[s] = 0;
    tas.push([0, s]);
  }

  const portes = [];
  const vues = new Set();

  while (tas.length) {
    tas.sort((a, b) => a[0] - b[0]);
    const [d, u] = tas.shift();
    if (d > dist[u]) continue;

    for (let k = g.debuts[u]; k < g.debuts[u + 1]; k++) {
      const i = g.incident[k];
      const v = g.A[i] === u ? g.B[i] : g.A[i];
      const L = g.M[i];
      const nd = d + L;

      /* L'arête franchit le cercle : c'est une porte. */
      if (d < rayonM && nd >= rayonM) {
        if (CLASSES_RETENUES.has(classeArete(g, i)) && !vues.has(i)) {
          vues.add(i);
          const [lng, lat] = pointSurArete(g, i, g.A[i] === u, rayonM - d);
          portes.push({ lng, lat, route: refArete(g, i), classe: classeArete(g, i) });
        }
        continue; // on n'explore pas au-delà du cercle
      }

      if (nd < dist[v] && nd < rayonM) {
        dist[v] = nd;
        tas.push([nd, v]);
      }
    }
  }
  return portes;
}

/* ---------------------------- génération --------------------------- */

const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const barragesExistants = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');
const poses = [];
const tropProche = (lng, lat, liste, seuil) =>
  liste.some((b) => distanceKm(lng, lat, b.lng, b.lat) < seuil);

let sansPorte = 0;
let rejetUrbain = 0;
for (const ville of villes) {
  const portes = portesDeVille(graphe, ville, RAYON_KM);
  if (portes.length === 0) sansPorte++;

  for (const p of portes) {
    /**
     * Encore dans une agglomération malgré le rayon routier : écartée.
     *
     * Le contrôle porte sur TOUTES les localités, pas seulement celle qu'on
     * traite : une porte posée à 6 km d'un chef-lieu de compagnie peut très
     * bien tomber en pleine ville voisine. Et le rayon dépend du niveau — 12 km
     * pour une région, 3 km pour un village (voir zones-urbaines.mjs).
     */
    if (zones.contient(p.lng, p.lat)) {
      rejetUrbain++;
      continue;
    }

    /* Une porte déjà couverte — par un barrage existant ou par une porte
       déjà posée pour la ville voisine — n'en appelle pas une seconde. */
    if (tropProche(p.lng, p.lat, barragesExistants, ECART_KM)) continue;
    if (tropProche(p.lng, p.lat, poses, ECART_KM)) continue;

    const rattachement = localiser(circo, [p.lng, p.lat]);
    /* Hors circonscription connue : pas de responsable identifiable, on passe. */
    if (!rattachement.reg && !rattachement.cie) continue;

    poses.push({
      lng: p.lng,
      lat: p.lat,
      ville: ville.nom,
      route: p.route,
      classe: p.classe,
      rattachement,
    });
  }
}

/* ---------------------------- rapport ------------------------------ */

const parClasse = {};
for (const p of poses) parClasse[p.classe] = (parClasse[p.classe] ?? 0) + 1;
const parRegion = {};
for (const p of poses) {
  const r = p.rattachement.reg ?? '(non rattaché)';
  parRegion[r] = (parRegion[r] ?? 0) + 1;
}

console.log('');
console.log(`Chefs-lieux examinés      : ${villes.length} (${NIVEAU === 'bt' ? 'brigades' : 'compagnies'})`);
console.log(`Sans porte détectée       : ${sansPorte}`);
console.log(`Rayon / écart minimal     : ${RAYON_KM} km / ${ECART_KM} km`);
console.log(`Hors-ville exigé          : ${HORS_VILLE_KM} km à vol d'oiseau`);
console.log(`Écartées (trop urbaines)  : ${rejetUrbain}`);
console.log(`Barrages déjà en place    : ${barragesExistants.length}`);
console.log(`PORTES DE VILLE À POSER   : ${poses.length}`);
console.log('');
console.log('Par classe de route :');
for (const [c, n] of Object.entries(parClasse).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${c}`);
}
console.log('');
console.log('Par région (10 premières) :');
for (const [r, n] of Object.entries(parRegion).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${String(n).padStart(4)}  ${r}`);
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit.');
  console.log('Relancez avec --ecrire pour enregistrer, --retirer pour défaire.');
  console.log('');
  process.exit(0);
}

/* ---------------------------- écriture ----------------------------- */

const auteur = {
  matricule: 'SYSTEME',
  nom: 'Génération automatique — portes de ville',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
};
const maintenant = new Date().toISOString();

for (const p of poses) {
  const item = normaliser(
    {
      type: 'barrage_fixe',
      nom: `Porte ${p.ville}${p.route ? ` — ${p.route}` : ''}`,
      route: p.route ?? '',
      note: MARQUE,
      /* Une porte est par nature une entrée ET une sortie. Le champ ne pouvait
         pas le dire — d'où l'ancien pis-aller `entree`, qui faussait le filtre
         de l'Optimisation (219 entrées contre 11 sorties). `porte` existe
         désormais pour ça : voir POSITIONS_VILLE dans serveur/depot.mjs. */
      positionVille: 'porte',
      statutBarrage: 'en_attente',
      eclairage: 'inconnu',
    },
    {
      id: nouvelId(),
      bt: p.rattachement.bt,
      cie: p.rattachement.cie,
      reg: p.rattachement.reg,
      auteur,
      cree: maintenant,
    }
  );
  item.lng = p.lng;
  item.lat = p.lat;
  items.push(item);
}

depot.items = items;
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log('');
console.log(`${poses.length} porte(s) enregistrée(s). Total : ${items.length} marquages.`);
console.log(`Fichier : ${FICHIER}`);
console.log('Pour défaire : node scripts/build-portes-ville.mjs --retirer');
console.log('');
