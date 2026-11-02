#!/usr/bin/env node
/**
 * Réseau routier : données OpenStreetMap brutes -> couches d'affichage + graphe
 * de calcul des distances.
 *
 *   data/routes/*.json  ->  public/layers/routes_*.geojson   (affichage)
 *                       ->  public/layers/graphe_routier.json (itinéraires)
 *
 *   node scripts/fetch-roads.mjs      (une fois, avec accès internet)
 *   node scripts/build-roads.mjs
 *
 * POURQUOI PAS OSRM : OSRM est un service C++ à compiler, à préparer (plusieurs
 * Go de RAM) et à maintenir en marche à côté de l'application. Le réseau visé
 * ici est celui d'UN pays, limité aux autoroutes, nationales et régionales :
 * une fois réduit à son graphe, il tient dans quelques mégaoctets et se
 * parcourt en A* dans le navigateur, en quelques millisecondes. Aucun service
 * supplémentaire à déployer, et les distances restent calculables même quand
 * l'application est servie en fichiers statiques.
 *
 * CLASSIFICATION — d'après la référence portée par la route, telle qu'elle est
 * signalée sur le terrain :
 *   A…    autoroute            RN…   route nationale
 *   RR…   route régionale      RP…   route provinciale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTREE = join(ROOT, 'data/routes');
const SORTIE = join(ROOT, 'public/layers');

/* ================================================================== */
/*  PARAMÈTRES                                                        */
/* ================================================================== */

/** Fichiers Overpass à lire (voir scripts/fetch-roads.mjs). */
const SOURCES = ['motorway.json', 'primaire.json', 'secondaire.json', 'tertiaire.json'];

/**
 * Classes retenues, avec la vitesse servant à estimer une durée quand la route
 * ne déclare pas de limitation. Ce sont des vitesses de PARCOURS moyennes
 * (traversées d'agglomération comprises), pas des vitesses maximales.
 */
export const CLASSES = {
  autoroute: { fr: 'Autoroute', ar: 'الطريق السيار', vitesse: 110, couleur: '#2fbf71' },
  nationale: { fr: 'Route nationale', ar: 'الطريق الوطنية', vitesse: 75, couleur: '#e0b653' },
  regionale: { fr: 'Route régionale', ar: 'الطريق الجهوية', vitesse: 60, couleur: '#4aa8e8' },
  provinciale: { fr: 'Route provinciale', ar: 'الطريق الإقليمية', vitesse: 50, couleur: '#9b8ec4' },
  liaison: { fr: 'Bretelle / liaison', ar: 'وصلة', vitesse: 45, couleur: '#8a97ab' },
};

/** Classes affichées en couche (les liaisons servent au calcul, pas à la carte). */
const AFFICHEES = ['autoroute', 'nationale', 'regionale', 'provinciale'];

/** Tolérance de simplification, en mètres. */
const TOLERANCE_AFFICHAGE = 60;
const TOLERANCE_GRAPHE = 40;

/* ================================================================== */
/*  Géométrie                                                         */
/* ================================================================== */

const R_TERRE = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Distance géodésique en mètres (haversine). */
function distanceM([lng1, lat1], [lng2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

const longueur = (pts) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceM(pts[i - 1], pts[i]);
  return d;
};

/**
 * Simplification Douglas-Peucker.
 *
 * La tolérance est donnée en mètres et convertie en degrés à la latitude du
 * tracé : un seuil exprimé directement en degrés déformerait le nord du pays
 * par rapport au sud.
 */
function simplifier(pts, toleranceM) {
  if (pts.length < 3) return pts;

  const latMoy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const degLat = toleranceM / 111320;
  const degLng = toleranceM / (111320 * Math.max(0.15, Math.cos(rad(latMoy))));
  const tol = Math.max(degLat, degLng);

  const garde = new Uint8Array(pts.length);
  garde[0] = 1;
  garde[pts.length - 1] = 1;

  const pile = [[0, pts.length - 1]];
  while (pile.length) {
    const [debut, fin] = pile.pop();
    let iMax = -1;
    let dMax = 0;

    const [x1, y1] = pts[debut];
    const [x2, y2] = pts[fin];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norme = dx * dx + dy * dy;

    for (let i = debut + 1; i < fin; i++) {
      const [x, y] = pts[i];
      // Distance du point au segment, dans le plan des degrés
      let t = norme ? ((x - x1) * dx + (y - y1) * dy) / norme : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = x1 + t * dx - x;
      const ey = y1 + t * dy - y;
      const d = Math.hypot(ex, ey);
      if (d > dMax) {
        dMax = d;
        iMax = i;
      }
    }

    if (dMax > tol && iMax > 0) {
      garde[iMax] = 1;
      pile.push([debut, iMax], [iMax, fin]);
    }
  }

  return pts.filter((_, i) => garde[i]);
}

const arrondir = (pts, d = 5) => pts.map(([x, y]) => [+x.toFixed(d), +y.toFixed(d)]);

/* ================================================================== */
/*  Classification                                                    */
/* ================================================================== */

/**
 * Classe d'une route. La référence signalée l'emporte sur le type OSM : une
 * nationale reste une nationale même là où elle traverse une ville et se
 * retrouve étiquetée `primary`. À défaut de référence, on retombe sur le type.
 */
function classer(tags) {
  const refs = String(tags.ref ?? '')
    .split(';')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);

  for (const r of refs) {
    if (/^A\d/.test(r)) return { classe: 'autoroute', ref: r };
    if (/^RN\d/.test(r) || /^N\d/.test(r)) return { classe: 'nationale', ref: r };
    if (/^RR\d/.test(r) || /^R\d/.test(r)) return { classe: 'regionale', ref: r };
    if (/^RP\d/.test(r) || /^P\d/.test(r)) return { classe: 'provinciale', ref: r };
  }

  const h = tags.highway;
  if (h === 'motorway') return { classe: 'autoroute', ref: refs[0] ?? null };
  if (h === 'trunk') return { classe: 'nationale', ref: refs[0] ?? null };
  // Les segments sans référence sont surtout des bretelles et des traversées
  // urbaines : indispensables à la continuité du graphe, hors couche affichée.
  return { classe: 'liaison', ref: refs[0] ?? null };
}

/**
 * Sens unique. Sur une autoroute, chaque chaussée est tracée séparément et
 * n'est presque jamais étiquetée `oneway` : la traiter comme à double sens
 * autoriserait des itinéraires à contresens.
 */
function sensUnique(tags) {
  const o = tags.oneway;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (tags.highway === 'motorway' || tags.junction === 'roundabout') return 1;
  return 0;
}

/** Vitesse retenue : celle qui est signalée, sinon celle de la classe. */
function vitesse(tags, classe) {
  const brut = parseInt(String(tags.maxspeed ?? '').replace(/[^\d]/g, ''), 10);
  const parClasse = CLASSES[classe].vitesse;
  if (!Number.isFinite(brut) || brut < 20 || brut > 130) return parClasse;
  // Une limitation urbaine à 40 sur une nationale ne doit pas plomber le
  // parcours entier : on borne l'écart vers le bas.
  return Math.max(brut, Math.round(parClasse * 0.5));
}

/* ================================================================== */
/*  Lecture des sources                                               */
/* ================================================================== */

console.log('\nRéseau routier — construction\n');

if (!existsSync(ENTREE)) {
  console.error(`Données absentes : ${ENTREE}`);
  console.error('Lancez d\'abord : node scripts/fetch-roads.mjs  (accès internet requis)\n');
  process.exit(1);
}

/** Chaque way retenu : {nodes, geometry, classe, ref, sens, vitesse}. */
const chemins = [];
let luTotal = 0;

for (const fichier of SOURCES) {
  const chemin = join(ENTREE, fichier);
  if (!existsSync(chemin)) {
    console.log(`  ! absent, ignoré : data/routes/${fichier}`);
    continue;
  }

  const brut = JSON.parse(readFileSync(chemin, 'utf8'));
  const elements = brut.elements ?? [];
  luTotal += elements.length;

  for (const e of elements) {
    if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    if (!Array.isArray(e.nodes) || e.nodes.length !== e.geometry.length) continue;

    const tags = e.tags ?? {};
    const { classe, ref } = classer(tags);

    chemins.push({
      nodes: e.nodes,
      pts: e.geometry.map((g) => [g.lon, g.lat]),
      classe,
      ref,
      nom: tags.name ?? null,
      sens: sensUnique(tags),
      vitesse: vitesse(tags, classe),
    });
  }

  console.log(
    `  ${fichier.padEnd(18)} ${String(elements.length).padStart(6)} éléments ` +
      `(${(statSync(chemin).size / 1048576).toFixed(1)} Mo)`
  );
}

console.log(`\n  ${chemins.length} tronçons retenus sur ${luTotal} éléments lus`);

const parClasse = {};
for (const c of chemins) parClasse[c.classe] = (parClasse[c.classe] ?? 0) + 1;
console.log(
  '  par classe : ' +
    Object.entries(parClasse)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ')
);

/* ================================================================== */
/*  Graphe : découpage aux intersections                              */
/* ================================================================== */

/**
 * Un nœud OSM partagé par deux tronçons est une intersection. On découpe donc
 * chaque tronçon à ces nœuds : les arêtes obtenues se raccordent exactement,
 * ce qui est la condition pour qu'un itinéraire puisse changer de route.
 *
 * Utiliser les identifiants de nœuds — et non un rapprochement par coordonnées
 * — évite les faux raccordements entre deux routes qui se croisent par un pont
 * sans échangeur.
 */
const occurrences = new Map();
for (const c of chemins) {
  for (const id of c.nodes) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
}

/** Index de sommet par identifiant OSM, attribué à la demande. */
const sommetDe = new Map();
const sommets = []; // [lng, lat]

function sommet(idOsm, pt) {
  let i = sommetDe.get(idOsm);
  if (i === undefined) {
    i = sommets.length;
    sommets.push(pt);
    sommetDe.set(idOsm, i);
  }
  return i;
}

const aretes = []; // {a, b, m, classe, ref, sens, vitesse, pts}

for (const c of chemins) {
  let debut = 0;

  for (let i = 1; i < c.nodes.length; i++) {
    const estFin = i === c.nodes.length - 1;
    const estIntersection = (occurrences.get(c.nodes[i]) ?? 0) > 1;
    if (!estFin && !estIntersection) continue;

    const morceau = c.pts.slice(debut, i + 1);
    if (morceau.length >= 2) {
      const m = longueur(morceau);
      // Un tronçon de moins d'un mètre n'apporte rien et fausse les moyennes.
      if (m >= 1) {
        aretes.push({
          a: sommet(c.nodes[debut], c.pts[debut]),
          b: sommet(c.nodes[i], c.pts[i]),
          m,
          classe: c.classe,
          ref: c.ref,
          nom: c.nom,
          sens: c.sens,
          vitesse: c.vitesse,
          pts: morceau,
        });
      }
    }
    debut = i;
  }
}

console.log(`\n  graphe brut : ${sommets.length} sommets, ${aretes.length} arêtes`);

/* --- Élagage : ne garder que la composante connexe principale --- */

/**
 * Les extraits OSM contiennent des morceaux isolés (route coupée à la
 * frontière de l'extrait, tronçon en construction non raccordé). Les conserver
 * ferait échouer des itinéraires sans raison compréhensible : on ne garde que
 * la composante connexe la plus grande, et on annonce ce qui est écarté.
 */
const voisins = Array.from({ length: sommets.length }, () => []);
aretes.forEach((e, i) => {
  voisins[e.a].push(i);
  voisins[e.b].push(i);
});

const composante = new Int32Array(sommets.length).fill(-1);
const tailles = [];

for (let depart = 0; depart < sommets.length; depart++) {
  if (composante[depart] !== -1) continue;
  const id = tailles.length;
  let n = 0;
  const pile = [depart];
  composante[depart] = id;

  while (pile.length) {
    const s = pile.pop();
    n++;
    for (const iArete of voisins[s]) {
      const e = aretes[iArete];
      const autre = e.a === s ? e.b : e.a;
      if (composante[autre] === -1) {
        composante[autre] = id;
        pile.push(autre);
      }
    }
  }
  tailles.push(n);
}

const principale = tailles.indexOf(Math.max(...tailles));
const isoles = sommets.length - tailles[principale];

console.log(
  `  composantes : ${tailles.length} — principale ${tailles[principale]} sommets` +
    (isoles ? `, ${isoles} sommets isolés écartés` : '')
);

/* --- Réindexation compacte de la composante principale --- */

const nouvelIndex = new Int32Array(sommets.length).fill(-1);
const sommetsGardes = [];
for (let s = 0; s < sommets.length; s++) {
  if (composante[s] !== principale) continue;
  nouvelIndex[s] = sommetsGardes.length;
  sommetsGardes.push(sommets[s]);
}

const aretesGardees = aretes.filter((e) => composante[e.a] === principale);

/* ================================================================== */
/*  Écriture du graphe                                                */
/* ================================================================== */

mkdirSync(SORTIE, { recursive: true });

/**
 * Format compact, pensé pour le poids du téléchargement :
 *   - les références et les noms sont mis en table et désignés par un indice,
 *     au lieu d'être répétés sur des milliers d'arêtes ;
 *   - les classes deviennent un indice dans `classes` ;
 *   - la géométrie est simplifiée et les coordonnées arrondies à 5 décimales.
 */
const classesOrdre = Object.keys(CLASSES);
const refs = [];
const refIndex = new Map();
const idRef = (r) => {
  if (r == null) return -1;
  if (!refIndex.has(r)) {
    refIndex.set(r, refs.length);
    refs.push(r);
  }
  return refIndex.get(r);
};

const graphe = {
  version: 1,
  genere: new Date().toISOString(),
  classes: classesOrdre,
  vitesses: classesOrdre.map((c) => CLASSES[c].vitesse),
  refs,
  sommets: sommetsGardes.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
  /** [a, b, mètres, classe, ref, sens, vitesse, ...géométrie aplatie] */
  aretes: aretesGardees.map((e) => {
    const pts = arrondir(simplifier(e.pts, TOLERANCE_GRAPHE));
    return [
      nouvelIndex[e.a],
      nouvelIndex[e.b],
      Math.round(e.m),
      classesOrdre.indexOf(e.classe),
      idRef(e.ref),
      e.sens,
      e.vitesse,
      // Points intermédiaires seulement : les extrémités sont les sommets
      ...pts.slice(1, -1).flat(),
    ];
  }),
};

const cheminGraphe = join(SORTIE, 'graphe_routier.json');
writeFileSync(cheminGraphe, JSON.stringify(graphe));
const moGraphe = (statSync(cheminGraphe).size / 1048576).toFixed(2);

console.log(
  `\n  -> public/layers/graphe_routier.json  ` +
    `(${graphe.sommets.length} sommets, ${graphe.aretes.length} arêtes, ${moGraphe} Mo)`
);

/* ================================================================== */
/*  Couches d'affichage                                               */
/* ================================================================== */

/**
 * Recoud les tronçons d'une même route en longues polylignes.
 *
 * Le graphe découpe à chaque intersection : la RN8 y est éclatée en centaines
 * d'arêtes. Les redessiner une par une coûterait autant d'opérations de rendu à
 * chaque déplacement de la carte, pour un tracé visuellement continu. On les
 * rechaîne donc par référence, ce qui divise le nombre d'entités par cinq à dix
 * — et permet une infobulle « RN8 » sur tout le linéaire plutôt que sur un
 * fragment.
 */
function fusionnerChaines(lot) {
  const parRef = new Map();
  for (const e of lot) {
    const cle = e.ref ?? `_${e.nom ?? 'sans-nom'}`;
    if (!parRef.has(cle)) parRef.set(cle, []);
    parRef.get(cle).push(e);
  }

  const chaines = [];

  for (const [, aretesRef] of parRef) {
    /** Arêtes encore libres, indexées par sommet d'extrémité. */
    const parSommet = new Map();
    const libre = new Set(aretesRef.keys());

    aretesRef.forEach((e, i) => {
      for (const s of [e.a, e.b]) {
        if (!parSommet.has(s)) parSommet.set(s, []);
        parSommet.get(s).push(i);
      }
    });

    /** Prochaine arête libre attachée à ce sommet, s'il n'y en a qu'une. */
    const suivante = (sommet, sauf) => {
      const candidats = (parSommet.get(sommet) ?? []).filter(
        (i) => i !== sauf && libre.has(i)
      );
      return candidats.length === 1 ? candidats[0] : null;
    };

    while (libre.size) {
      const depart = libre.values().next().value;
      libre.delete(depart);

      const e0 = aretesRef[depart];
      let pts = [...e0.pts];
      let metres = e0.m;
      let tete = e0.a;
      let queue = e0.b;
      let precedent = depart;

      // Prolongement vers l'avant
      for (let i = suivante(queue, precedent); i != null; i = suivante(queue, precedent)) {
        libre.delete(i);
        const e = aretesRef[i];
        const suite = e.a === queue ? e.pts : [...e.pts].reverse();
        pts = pts.concat(suite.slice(1));
        queue = e.a === queue ? e.b : e.a;
        metres += e.m;
        precedent = i;
      }

      // Puis vers l'arrière
      precedent = depart;
      for (let i = suivante(tete, precedent); i != null; i = suivante(tete, precedent)) {
        libre.delete(i);
        const e = aretesRef[i];
        const avant = e.b === tete ? e.pts : [...e.pts].reverse();
        pts = avant.slice(0, -1).concat(pts);
        tete = e.b === tete ? e.a : e.b;
        metres += e.m;
        precedent = i;
      }

      chaines.push({ ref: e0.ref, nom: e0.nom, pts, m: metres });
    }
  }

  return chaines;
}

for (const classe of AFFICHEES) {
  const lot = aretesGardees.filter((e) => e.classe === classe);
  if (!lot.length) {
    console.log(`  ! aucune entité pour ${classe}`);
    continue;
  }

  const chaines = fusionnerChaines(lot);

  const features = chaines.map((c) => ({
    type: 'Feature',
    properties: {
      ref: c.ref,
      nom: c.nom,
      classe,
      km: +(c.m / 1000).toFixed(3),
    },
    geometry: {
      type: 'LineString',
      // Simplification APRÈS recollement : les points redondants aux
      // raccords disparaissent aussi.
      coordinates: arrondir(simplifier(c.pts, TOLERANCE_AFFICHAGE)),
    },
  }));

  const nom = `routes_${classe}.geojson`;
  const chemin = join(SORTIE, nom);
  writeFileSync(chemin, JSON.stringify({ type: 'FeatureCollection', features }));

  const km = lot.reduce((s, e) => s + e.m, 0) / 1000;
  console.log(
    `  -> public/layers/${nom.padEnd(28)} ${String(features.length).padStart(6)} tronçons, ` +
      `${Math.round(km).toLocaleString('fr-FR').padStart(7)} km, ` +
      `${(statSync(chemin).size / 1048576).toFixed(2)} Mo`
  );
}

console.log('\nTerminé.\n');
