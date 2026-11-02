#!/usr/bin/env node
/**
 * Maillage national de barrages fixes — de Tanger à Lagouira.
 *
 * Pourquoi un second script
 * -------------------------
 * `build-portes-ville.mjs` pose des barrages aux PORTES DES VILLES : il n'en
 * produit donc que là où il y a des villes. Or les provinces du Sud comptent
 * peu d'agglomérations pour des centaines de kilomètres de RN1 — la couverture
 * y serait quasi nulle. Ce script raisonne sur le RÉSEAU et non sur les villes :
 * il répartit les barrages le long des axes eux-mêmes, à espacement régulier.
 *
 * Méthode
 * -------
 *  1. On échantillonne toutes les routes retenues tous les ~1,5 km : chaque
 *     point candidat est, par construction, SUR la chaussée.
 *  2. On écarte ce qui tombe dans une agglomération (la ville relève de la
 *     Sûreté Nationale, pas de la Gendarmerie).
 *  3. On retient gloutonnement les candidats en imposant un espacement minimal.
 *
 * L'espacement n'est pas choisi à la main : il est CALCULÉ par dichotomie pour
 * atteindre le nombre visé. Fixer l'espacement au jugé donnerait un compte
 * imprévisible ; fixer le compte et déduire l'espacement garantit à la fois le
 * volume demandé et une répartition régulière sur tout le territoire.
 *
 *   node scripts/build-barrages-reseau.mjs --cible 1000            aperçu
 *   node scripts/build-barrages-reseau.mjs --cible 1000 --ecrire   enregistre
 *   node scripts/build-barrages-reseau.mjs --retirer               défait
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { chargerGraphe, distanceKm, classeArete, refArete, pointsArete } from '../serveur/routage.mjs';
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

/**
 * Deux façons de dire combien : une CIBLE totale de barrages du type visé,
 * ou un NOMBRE à ajouter. Le nombre l'emporte quand il est donné.
 */
const CIBLE = Number(valeur('cible', 1000));
const NOMBRE = valeur('nombre') ? Number(valeur('nombre')) : null;

/**
 * Nature produite. Un barrage MOBILE n'a pas d'implantation permanente : il
 * matérialise la réserve tournante, dont l'imprévisibilité fait la valeur.
 * Il n'est donc pas soumis à l'optimisation, qui ne raisonne que sur le fixe.
 */
const TYPE = valeur('type', 'fixe') === 'mobile' ? 'barrage_mobile' : 'barrage_fixe';
const HORS_VILLE_KM = Number(valeur('hors-ville', 2.5));
const PAS_ECHANTILLON_KM = 1.5;

const MARQUE = TYPE === 'barrage_mobile' ? 'barrage-mobile-auto' : 'barrage-reseau-auto';
const CLASSES_RETENUES = new Set(['autoroute', 'nationale', 'regionale']);

const graphe = chargerGraphe(JSON.parse(readFileSync(join(COUCHES, 'graphe_routier.json'), 'utf8')));
const circo = chargerCirconscriptions(COUCHES);
const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];

/* ---------------------------- retrait ----------------------------- */

if (drapeau('retirer')) {
  const avant = items.length;
  depot.items = items.filter((m) => m.note !== MARQUE);
  const n = avant - depot.items.length;
  if (n) writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
  console.log(`\n${n} barrage(s) de maillage retiré(s). ${depot.items.length} marquage(s) restants.\n`);
  process.exit(0);
}

/* ---------------- 1. Échantillonnage du réseau --------------------- */

const candidats = [];
for (let i = 0; i < graphe.nA; i++) {
  if (!CLASSES_RETENUES.has(classeArete(graphe, i))) continue;
  const pts = pointsArete(graphe, i);
  const ref = refArete(graphe, i);
  const classe = classeArete(graphe, i);

  let reste = 0;
  for (let k = 1; k < pts.length; k++) {
    const seg = distanceKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    let pos = reste;
    while (pos <= seg) {
      const t = seg > 0 ? pos / seg : 0;
      candidats.push({
        lng: pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]),
        lat: pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1]),
        ref,
        classe,
      });
      pos += PAS_ECHANTILLON_KM;
    }
    reste = pos - seg;
  }
}

/* ---------------- 2. Retrait des points urbains -------------------- */

/**
 * Grille spatiale : sans elle, tester chaque candidat contre chaque ville
 * (et contre chaque barrage retenu) donnerait des dizaines de millions de
 * comparaisons par passe de dichotomie.
 */
function grille(points, tailleDeg) {
  const m = new Map();
  points.forEach((p, idx) => {
    const c = `${Math.floor(p.lng / tailleDeg)}|${Math.floor(p.lat / tailleDeg)}`;
    if (!m.has(c)) m.set(c, []);
    m.get(c).push(idx);
  });
  return { m, tailleDeg, points };
}
function voisins(g, lng, lat, rayonKm) {
  const r = Math.ceil(rayonKm / (g.tailleDeg * 111)) + 1;
  const cx = Math.floor(lng / g.tailleDeg);
  const cy = Math.floor(lat / g.tailleDeg);
  const out = [];
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      const lot = g.m.get(`${cx + dx}|${cy + dy}`);
      if (lot) out.push(...lot);
    }
  return out;
}

/**
 * Exclusion des zones urbaines, avec un rayon PAR NIVEAU de localité — voir
 * scripts/zones-urbaines.mjs. Un seuil unique laissait des barrages en plein
 * centre des grandes villes, qui relèvent de la Sûreté Nationale.
 */
const zones = chargerZonesUrbaines(COUCHES);
const horsVille = candidats.filter((c) => !zones.contient(c.lng, c.lat));

/* ---------------- 3. Sélection à espacement imposé ------------------ */

const barragesExistants = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');
const gExistants = grille(barragesExistants, 0.2);

/** Retient les candidats en imposant `ecartKm` entre eux et avec l'existant. */
function selectionner(ecartKm) {
  const retenus = [];
  const gRetenus = { m: new Map(), tailleDeg: 0.2, points: retenus };
  const ajouter = (p) => {
    const c = `${Math.floor(p.lng / 0.2)}|${Math.floor(p.lat / 0.2)}`;
    if (!gRetenus.m.has(c)) gRetenus.m.set(c, []);
    gRetenus.m.get(c).push(retenus.length);
    retenus.push(p);
  };

  for (const cand of horsVille) {
    let libre = true;
    for (const idx of voisins(gExistants, cand.lng, cand.lat, ecartKm)) {
      const b = barragesExistants[idx];
      if (distanceKm(cand.lng, cand.lat, b.lng, b.lat) < ecartKm) { libre = false; break; }
    }
    if (!libre) continue;
    for (const idx of voisins(gRetenus, cand.lng, cand.lat, ecartKm)) {
      const b = retenus[idx];
      if (b && distanceKm(cand.lng, cand.lat, b.lng, b.lat) < ecartKm) { libre = false; break; }
    }
    if (libre) ajouter(cand);
  }
  return retenus;
}

/**
 * Dichotomie sur l'espacement : on cherche la distance qui produit le nombre
 * demandé. Plus l'espacement est grand, moins il y a de barrages — la fonction
 * est monotone, la recherche converge.
 */
/* Avec --nombre : on ajoute ce nombre. Sinon : on complète jusqu'à la cible,
   comptée sur le TYPE demandé et non sur l'ensemble du parc. */
const duType = items.filter((m) => m.type === TYPE).length;
const aPoser = NOMBRE ?? CIBLE - duType;
if (aPoser <= 0) {
  console.log(`\nLe parc compte déjà ${duType} barrage(s) de ce type, cible ${CIBLE} atteinte.\n`);
  process.exit(0);
}

let bas = 1, haut = 60, meilleur = null;
for (let passe = 0; passe < 18; passe++) {
  const milieu = (bas + haut) / 2;
  const sel = selectionner(milieu);
  if (!meilleur || Math.abs(sel.length - aPoser) < Math.abs(meilleur.length - aPoser)) meilleur = sel;
  if (sel.length > aPoser) bas = milieu;
  else haut = milieu;
  if (Math.abs(sel.length - aPoser) <= Math.max(3, aPoser * 0.01)) { meilleur = sel; break; }
}

const retenus = meilleur.slice(0, aPoser);

/* ---------------------------- rattachement -------------------------- */

const poses = [];
for (const p of retenus) {
  const rat = localiser(circo, [p.lng, p.lat]);
  if (!rat.reg && !rat.cie) continue;
  poses.push({ ...p, rat });
}

/* ------------------------------ rapport ----------------------------- */

const parClasse = {};
const parRegion = {};
for (const p of poses) {
  parClasse[p.classe] = (parClasse[p.classe] ?? 0) + 1;
  const r = p.rat.reg ?? '(non rattaché)';
  parRegion[r] = (parRegion[r] ?? 0) + 1;
}
const lats = poses.map((p) => p.lat);

console.log('');
console.log(`Points échantillonnés sur le réseau : ${candidats.length}`);
console.log(`Hors agglomération                  : ${horsVille.length}`);
console.log(`Barrages déjà en place              : ${barragesExistants.length}`);
console.log(`Cible                               : ${CIBLE}`);
console.log(`À POSER                             : ${poses.length}`);
console.log(`Étendue nord-sud                    : ${Math.max(...lats).toFixed(2)}° → ${Math.min(...lats).toFixed(2)}° de latitude`);
console.log('');
console.log('Par classe :');
for (const [c, n] of Object.entries(parClasse).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${c}`);
console.log('');
console.log(`Par région (${Object.keys(parRegion).length} régions) :`);
for (const [r, n] of Object.entries(parRegion).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour enregistrer.');
  console.log('');
  process.exit(0);
}

/* ------------------------------ écriture ---------------------------- */

const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
const auteur = {
  matricule: 'SYSTEME',
  nom: 'Génération automatique — maillage du réseau',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
};
const maintenant = new Date().toISOString();

for (const p of poses) {
  const item = normaliser(
    {
      type: TYPE,
      nom: `${TYPE === 'barrage_mobile' ? 'Barrage mobile' : 'Barrage'} ${p.ref ?? p.classe}${p.rat.cie ? ` — ${p.rat.cie}` : ''}`,
      route: p.ref ?? '',
      note: MARQUE,
      /* `none` et non `entree` : ce sont des points de maillage courant, pas
         des portes de ville. Ils restent donc soumis à l'optimisation, qui
         pourra les écarter s'ils s'avèrent redondants — contrairement aux
         portes, protégées par construction. */
      positionVille: 'none',
      statutBarrage: 'en_attente',
      eclairage: 'inconnu',
    },
    { id: nouvelId(), bt: p.rat.bt, cie: p.rat.cie, reg: p.rat.reg, auteur, cree: maintenant }
  );
  item.lng = p.lng;
  item.lat = p.lat;
  items.push(item);
}

depot.items = items;
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

const totalBarrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile').length;
console.log('');
console.log(`${poses.length} barrage(s) enregistré(s). Parc total : ${totalBarrages} barrages.`);
console.log('IMPORTANT : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('Pour défaire : node scripts/build-barrages-reseau.mjs --retirer');
console.log('');
