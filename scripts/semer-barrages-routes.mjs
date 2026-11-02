#!/usr/bin/env node
/**
 * BARRAGES SUR ROUTES RÉELLES — un poste est un point du réseau, pas un point
 * de la carte.
 *
 * LA DIFFÉRENCE AVEC `semer-factions.mjs`, ET POURQUOI ELLE COMPTE. Le semis
 * précédent tirait un point à l'intérieur du polygone de la brigade : le poste
 * tombait dans la bonne circonscription, mais souvent dans un champ, une forêt
 * ou une zone sans route. Un barrage n'est pas une position administrative,
 * c'est un point de contrôle SUR une chaussée. Ici, la coordonnée n'est jamais
 * inventée : elle est LUE sur la géométrie d'une arête du réseau.
 *
 * LA CHAÎNE, DANS CET ORDRE :
 *
 *   1. le RÉSEAU — `graphe_routier.json`, celui-là même que le serveur emploie
 *      pour les distances, l'accrochage et l'optimisation. Utiliser une autre
 *      source aurait produit des postes que le calcul d'itinéraire n'aurait pas
 *      su raccrocher ;
 *   2. les CIRCONSCRIPTIONS — `circo_bt.geojson`, le découpage réel. Chaque
 *      point échantillonné est testé par `dansGeometrie` : la brigade n'est pas
 *      attribuée, elle est CONSTATÉE ;
 *   3. l'ÉTALEMENT — parmi les points d'une brigade, on retient les plus
 *      éloignés les uns des autres, en variant les axes. Sans cela, quatre
 *      postes se collaient sur le même kilomètre de nationale ;
 *   4. la FACTION — répartie sur les postes de la brigade, avec un décalage par
 *      brigade pour que les quatre factions s'équilibrent à l'échelle du pays.
 *
 * COMBIEN DE POSTES PAR BRIGADE. Pas un chiffre rond posé d'avance : une part
 * du LINÉAIRE ROUTIER réellement présent dans la circonscription. Une brigade
 * qui tient 300 km de nationale en reçoit davantage qu'une brigade urbaine de
 * 20 km — c'est le seul critère qui produise une densité vraisemblable.
 *
 * RIEN N'EST ÉCRIT SANS `--ecrire`. Par défaut le script calcule, rend compte,
 * et s'arrête. `--remplacer` retire les barrages existants, après sauvegarde
 * horodatée de tous les fichiers qui les désignent.
 *
 *   node scripts/semer-barrages-routes.mjs --donnees donnees-demo
 *   node scripts/semer-barrages-routes.mjs --donnees donnees-demo --remplacer --ecrire
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { chargerGraphe, pointsArete, classeArete, refArete, distanceKm } from '../serveur/routage.mjs';
import { dansGeometrie } from '../serveur/geo.mjs';
import {
  chargerRoutesAffichees,
  pointSurRouteAffichee,
  pointSurRouteAccepte,
} from '../serveur/routesAffichees.mjs';
import { FACTIONS } from '../serveur/factions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const arg = (nom, defaut = null) => {
  const i = process.argv.indexOf(nom);
  return i > -1 ? (process.argv[i + 1] ?? true) : defaut;
};
const DONNEES = resolve(ROOT, arg('--donnees', 'donnees-serveur'));
const COUCHES = resolve(ROOT, arg('--couches', 'public/layers'));
const ECRIRE = process.argv.includes('--ecrire');
const REMPLACER = process.argv.includes('--remplacer');
const GRAINE = Number(arg('--graine', 20260923));

/** Un point candidat tous les N km le long de chaque axe. */
const PAS_ECHANTILLON_KM = Number(arg('--pas', 2));
/** Deux postes d'une même brigade ne se posent jamais plus près que cela. */
const ESPACEMENT_MIN_KM = Number(arg('--espacement', 6));
/** Un poste par tranche de linéaire routier, borné pour rester vraisemblable. */
const KM_PAR_BARRAGE = Number(arg('--km-par-barrage', 45));
const MIN_PAR_BRIGADE = Number(arg('--min', 1));
const MAX_PAR_BRIGADE = Number(arg('--max', 12));

/**
 * LES AXES QUI PORTENT UN CONTRÔLE. `liaison` est exclue : ce sont les bouts de
 * raccordement du graphe (bretelles, amorces), pas des itinéraires sur lesquels
 * on poste des hommes.
 */
const CLASSES_RETENUES = new Set(['autoroute', 'nationale', 'regionale', 'provinciale']);

if (!existsSync(DONNEES)) {
  console.error(`\nDossier de donnees introuvable : ${DONNEES}\n`);
  process.exit(1);
}

function alea(graine) {
  let x = graine >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}
const rnd = alea(GRAINE);

/* ================================================================== */
/* 1. LES CIRCONSCRIPTIONS RÉELLES                                    */
/* ================================================================== */

const cheminCirco = join(COUCHES, 'circo_bt.geojson');
const cheminGraphe = join(COUCHES, 'graphe_routier.json');
for (const c of [cheminCirco, cheminGraphe]) {
  if (!existsSync(c)) {
    console.error(`\nIntrouvable : ${c}\nLancez « npm run build:layers » puis « npm run build:roads ».\n`);
    process.exit(1);
  }
}

function bbox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parcourir = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(parcourir);
  };
  parcourir(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

const circo = JSON.parse(readFileSync(cheminCirco, 'utf8'));
/** @type {Array<{bt,cie,reg,geometry,bbox}>} */
const BRIGADES = [];
{
  const vues = new Set();
  for (const f of circo.features ?? []) {
    const bt = f.properties?.gr_bde;
    if (!bt || !f.geometry || vues.has(bt)) continue;
    vues.add(bt);
    BRIGADES.push({
      bt,
      cie: f.properties?.gr_cie ?? null,
      reg: f.properties?.gr_region ?? null,
      geometry: f.geometry,
      bbox: bbox(f.geometry),
    });
  }
}
BRIGADES.sort((a, b) => a.bt.localeCompare(b.bt, 'fr'));

/**
 * INDEX SPATIAL DES CIRCONSCRIPTIONS — sans lui, chaque point échantillonné
 * serait testé contre 504 polygones, soit des dizaines de millions de tests
 * point-dans-polygone. La grille ramène la recherche aux deux ou trois
 * brigades dont la boîte englobante couvre la maille.
 */
const MAILLE = 0.25; // degrés
const GRILLE = new Map();
BRIGADES.forEach((b, i) => {
  const [minX, minY, maxX, maxY] = b.bbox;
  for (let x = Math.floor(minX / MAILLE); x <= Math.floor(maxX / MAILLE); x++) {
    for (let y = Math.floor(minY / MAILLE); y <= Math.floor(maxY / MAILLE); y++) {
      const cle = `${x}|${y}`;
      if (!GRILLE.has(cle)) GRILLE.set(cle, []);
      GRILLE.get(cle).push(i);
    }
  }
});

/** La brigade qui CONTIENT ce point, ou `null` — jamais « la plus proche ». */
function brigadeDuPoint(lng, lat) {
  const candidates = GRILLE.get(`${Math.floor(lng / MAILLE)}|${Math.floor(lat / MAILLE)}`);
  if (!candidates) return null;
  for (const i of candidates) {
    const b = BRIGADES[i];
    const [minX, minY, maxX, maxY] = b.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (dansGeometrie([lng, lat], b.geometry)) return i;
  }
  return null;
}

/* ================================================================== */
/* 2. LES POINTS DE ROUTE, RATTACHÉS À LEUR BRIGADE                   */
/* ================================================================== */

const graphe = chargerGraphe(JSON.parse(readFileSync(cheminGraphe, 'utf8')));

/**
 * LA GÉOMÉTRIE DESSINÉE — celle que la carte trace, et qui n'est pas celle du
 * graphe.
 *
 * `build:roads` produit deux simplifications du même réseau : 40 m pour le
 * graphe (qui sert à calculer) et 60 m pour les couches GeoJSON (qui servent à
 * dessiner). Un point posé sur une arête peut donc se trouver à des dizaines de
 * mètres du trait affiché — jusqu'à 67 m mesurés dans un virage. Le poste est
 * alors « sur une route » pour tous les calculs, et visiblement à côté pour qui
 * regarde la carte.
 *
 * On choisit donc l'emplacement sur le GRAPHE — lui seul connaît les classes,
 * les brigades et les temps — puis on rabat le point sur le TRAIT DESSINÉ.
 */
const routesAffichees = chargerRoutesAffichees(COUCHES);

/** @type {Map<number, Array<{lng,lat,ref,classe}>>} index de brigade -> points */
const candidats = new Map();
/** Linéaire routier constaté par brigade, en km. */
const lineaire = new Map();

let echantillons = 0;
for (let i = 0; i < graphe.nA; i++) {
  const classe = classeArete(graphe, i);
  if (!CLASSES_RETENUES.has(classe)) continue;
  const ref = refArete(graphe, i);
  const pts = pointsArete(graphe, i);

  /* On avance le long de l'arête et on dépose un point tous les `PAS`. Le
     reliquat est reporté d'un segment à l'autre : sans cela, une arête de
     200 m déposerait un point à chacune de ses extrémités et l'on obtiendrait
     des grappes aux carrefours. */
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
      echantillons++;
      const ib = brigadeDuPoint(lng, lat);
      if (ib != null) {
        if (!candidats.has(ib)) candidats.set(ib, []);
        candidats.get(ib).push({ lng, lat, ref: ref ?? '', classe });
        lineaire.set(ib, (lineaire.get(ib) ?? 0) + PAS_ECHANTILLON_KM);
      }
      pos += PAS_ECHANTILLON_KM;
    }
    reste = pos - seg;
  }
}

/* ================================================================== */
/* 3. LE CHOIX DES EMPLACEMENTS — étalés, et sur des axes variés      */
/* ================================================================== */

/**
 * SÉLECTION PAR ÉLOIGNEMENT PROGRESSIF.
 *
 * On part d'un point tiré au hasard, puis on ajoute à chaque tour le candidat
 * le PLUS ÉLOIGNÉ de tout ce qui est déjà retenu — à condition qu'il respecte
 * l'espacement minimal. C'est ce qui produit une couverture étalée plutôt
 * qu'une grappe : un tirage purement aléatoire aurait laissé des postes à
 * quelques centaines de mètres et des pans de circonscription vides.
 *
 * À distance égale, un axe non encore utilisé l'emporte : une brigade
 * traversée par une nationale et deux provinciales ne doit pas poster ses
 * quatre hommes sur la seule nationale.
 */
function choisirEtales(points, combien) {
  if (points.length <= combien) return points.slice();
  const retenus = [points[Math.floor(rnd() * points.length)]];
  const refsPrises = new Set([retenus[0].ref]);

  while (retenus.length < combien) {
    let meilleur = null;
    let meilleurScore = -Infinity;
    for (const p of points) {
      let plusProche = Infinity;
      for (const r of retenus) {
        const d = distanceKm(p.lng, p.lat, r.lng, r.lat);
        if (d < plusProche) plusProche = d;
        if (plusProche < ESPACEMENT_MIN_KM) break;
      }
      if (plusProche < ESPACEMENT_MIN_KM) continue;
      /* Le bonus d'axe nouveau vaut un kilomètre d'éloignement : assez pour
         départager, trop peu pour aller chercher un point à l'autre bout. */
      const score = plusProche + (refsPrises.has(p.ref) ? 0 : 1);
      if (score > meilleurScore) {
        meilleurScore = score;
        meilleur = p;
      }
    }
    if (!meilleur) break; // plus rien qui respecte l'espacement
    retenus.push(meilleur);
    refsPrises.add(meilleur.ref);
  }
  return retenus;
}

const maintenant = new Date().toISOString();
const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(5).toString('hex')}`;
const arrondir = (v) => +Number(v).toFixed(5);

const AUTEUR = {
  matricule: 'SYSTEME',
  nom: 'Semis des barrages sur routes',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
  cie: null,
};

const nouveaux = [];
const sansRoute = [];
let numero = 0;
/* Décalage de faction PAR BRIGADE : sans lui, chaque brigade commencerait par
   la faction 1 et celle-ci serait surreprésentée à l'échelle du pays. */
let curseurFaction = 0;

BRIGADES.forEach((brigade, ib) => {
  const points = candidats.get(ib);
  if (!points || !points.length) {
    sansRoute.push(brigade);
    return;
  }

  const km = lineaire.get(ib) ?? 0;
  const combien = Math.max(
    MIN_PAR_BRIGADE,
    Math.min(MAX_PAR_BRIGADE, Math.round(km / KM_PAR_BARRAGE)),
  );
  const choisis = choisirEtales(points, combien);

  choisis.forEach((p) => {
    const faction = FACTIONS[curseurFaction % FACTIONS.length];
    curseurFaction++;
    numero++;

    /**
     * RABATTEMENT SUR LE TRAIT DESSINÉ — dernier geste avant de poser.
     *
     * Le point vient du graphe ; on le projette sur la polyligne affichée la
     * plus proche QUI RESTE dans la brigade. Sans la condition, un poste de
     * bordure se ferait rabattre sur une route du voisin et changerait
     * d'autorité pour gagner trois mètres.
     *
     * Si rien ne convient — cela n'arrive pas sur le réseau actuel — on garde
     * le point du graphe : mieux vaut un poste à quarante mètres du trait
     * qu'un poste dans la mauvaise circonscription.
     */
    const surTrait =
      pointSurRouteAccepte(routesAffichees, p.lng, p.lat, (x, y) =>
        dansGeometrie([+x.toFixed(5), +y.toFixed(5)], brigade.geometry),
      ) ?? pointSurRouteAffichee(routesAffichees, p.lng, p.lat);
    const retenu = surTrait && surTrait.metres <= 150 ? surTrait : p;

    const lng = arrondir(retenu.lng);
    const lat = arrondir(retenu.lat);
    nouveaux.push({
      id: nouvelId(),
      type: 'barrage_fixe',
      nom: `B-${String(numero).padStart(4, '0')} ${brigade.bt}`,
      /* La route vient du réseau : c'est son vrai numéro, pas une étiquette. */
      route: p.ref || p.classe,
      note: `Point de contrôle sur ${p.ref || p.classe} — ${faction.nom} (${faction.libelle}).`,
      debut: faction.debut,
      fin: faction.fin === '24:00' ? '00:00' : faction.fin,
      factionId: faction.id,
      accidentCount: 0,
      severite: 'none',
      activite: 'low',
      infraction: 'low',
      positionVille: 'none',
      eclairage: 'inconnu',
      statutBarrage: 'approuve',
      etatAvant: null,
      optimisationAuto: null,
      supprimeLe: null,
      supprimePar: null,
      decisionOptimisation: 'aucune',
      origineId: null,
      patrouilles: [],
      sousType: 'none',
      exceptionnel: false,
      missionId: null,
      viaAssistant: false,
      partage: false,
      bt: brigade.bt,
      cie: brigade.cie,
      reg: brigade.reg,
      lng,
      lat,
      auteur: AUTEUR,
      majPar: AUTEUR,
      cree: maintenant,
      maj: maintenant,
      demo: true,
    });
  });
});

/* ================================================================== */
/* COMPTE RENDU                                                       */
/* ================================================================== */

const parFaction = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
const parClasse = {};
const parCie = new Map();
const parReg = new Map();
const parBt = new Map();
for (const b of nouveaux) {
  parFaction[b.factionId]++;
  parCie.set(b.cie, (parCie.get(b.cie) ?? 0) + 1);
  parReg.set(b.reg, (parReg.get(b.reg) ?? 0) + 1);
  parBt.set(`${b.cie}/${b.bt}`, (parBt.get(`${b.cie}/${b.bt}`) ?? 0) + 1);
}
for (const b of nouveaux) {
  const c = b.note.includes('autoroute') ? 'autoroute' : b.route;
  void c;
}

console.log('\n  SEMIS DES BARRAGES SUR ROUTES RÉELLES\n');
console.log(`  données   : ${DONNEES}`);
console.log(`  réseau    : ${cheminGraphe}`);
console.log(`  découpage : ${cheminCirco}`);
console.log(
  `  réglages  : pas ${PAS_ECHANTILLON_KM} km · espacement ${ESPACEMENT_MIN_KM} km · ` +
    `1 poste / ${KM_PAR_BARRAGE} km (de ${MIN_PAR_BRIGADE} à ${MAX_PAR_BRIGADE} par brigade)\n`,
);
console.log(`  points de route échantillonnés : ${echantillons}`);
console.log(`  points retenus dans une brigade : ${[...candidats.values()].reduce((s, v) => s + v.length, 0)}`);
console.log(`  brigades pourvues : ${candidats.size} / ${BRIGADES.length}`);
console.log(`  BARRAGES PRODUITS : ${nouveaux.length}\n`);
console.log(`  régions : ${parReg.size} · compagnies : ${parCie.size} · brigades : ${parBt.size}\n`);
for (const f of FACTIONS) {
  console.log(`    ${f.id}  ${f.libelle}   ${String(parFaction[f.id]).padStart(5)}`);
}
const tailles = [...parBt.values()].sort((a, b) => a - b);
console.log(
  `\n  par brigade : min ${tailles[0]} · médiane ${tailles[Math.floor(tailles.length / 2)]} · max ${tailles[tailles.length - 1]}`,
);
const taillesCie = [...parCie.values()].sort((a, b) => a - b);
console.log(
  `  par compagnie : min ${taillesCie[0]} · médiane ${taillesCie[Math.floor(taillesCie.length / 2)]} · max ${taillesCie[taillesCie.length - 1]}`,
);
void parClasse;

if (sansRoute.length) {
  console.log(`\n  ${sansRoute.length} brigade(s) SANS aucun axe retenu dans leur circonscription :`);
  for (const b of sansRoute.slice(0, 15)) console.log(`    ${b.cie} / ${b.bt}`);
  if (sansRoute.length > 15) console.log(`    … et ${sansRoute.length - 15} autre(s)`);
  console.log('  Elles ne reçoivent aucun barrage : rien n’a été posé hors réseau.');
}

if (!ECRIRE) {
  console.log('\n  --ecrire absent : RIEN n’a été modifié.\n');
  process.exit(0);
}

/* ================================================================== */
/* ÉCRITURE                                                           */
/* ================================================================== */

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const DOSSIER_SAUVEGARDE = join(DONNEES, 'sauvegardes', `avant-semis-routes-${horodatage}`);
mkdirSync(DOSSIER_SAUVEGARDE, { recursive: true });

const sauvegardes = [];
for (const f of [
  'marquages.json',
  'alertes.json',
  'conflits-planification.json',
  'instructions.json',
  'rapports-optimisation.json',
]) {
  const chemin = join(DONNEES, f);
  if (!existsSync(chemin)) continue;
  copyFileSync(chemin, join(DOSSIER_SAUVEGARDE, f));
  sauvegardes.push(f);
}

const dossierElements = join(DONNEES, 'elements');
let journeesSauvees = 0;
if (existsSync(dossierElements)) {
  const cible = join(DOSSIER_SAUVEGARDE, 'elements');
  mkdirSync(cible, { recursive: true });
  for (const nom of readdirSync(dossierElements)) {
    if (!nom.endsWith('.jsonl')) continue;
    copyFileSync(join(dossierElements, nom), join(cible, nom));
    journeesSauvees++;
  }
}

const cheminMarquages = join(DONNEES, 'marquages.json');
const brut = existsSync(cheminMarquages)
  ? JSON.parse(readFileSync(cheminMarquages, 'utf8'))
  : { version: 1, items: [] };
const avant = brut.items ?? [];
const TYPES_BARRAGE = ['barrage_fixe', 'barrage_mobile'];
const conserves = REMPLACER ? avant.filter((m) => !TYPES_BARRAGE.includes(m.type)) : avant;
const retires = avant.length - conserves.length;
const apres = [...conserves, ...nouveaux];
writeFileSync(cheminMarquages, JSON.stringify({ ...brut, version: 1, items: apres }, null, 2));

/* Les dépendances des postes disparus — même raison que le semis précédent :
   une relève qui désigne un barrage effacé fausse tous les comptes. */
let relevesPurgees = 0;
if (REMPLACER && existsSync(dossierElements)) {
  const vivants = new Set(apres.map((m) => m.id));
  for (const nom of readdirSync(dossierElements)) {
    if (!nom.endsWith('.jsonl')) continue;
    const chemin = join(dossierElements, nom);
    const gardees = [];
    for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
      const nu = ligne.trim();
      if (!nu) continue;
      try {
        if (vivants.has(JSON.parse(nu).barrageId)) gardees.push(nu);
        else relevesPurgees++;
      } catch {
        relevesPurgees++;
      }
    }
    if (gardees.length) writeFileSync(chemin, gardees.join('\n') + '\n');
    else rmSync(chemin, { force: true });
  }
}

const purgerListe = (nomFichier, champId) => {
  const chemin = join(DONNEES, nomFichier);
  if (!REMPLACER || !existsSync(chemin)) return 0;
  const contenu = JSON.parse(readFileSync(chemin, 'utf8'));
  const items = contenu.items ?? [];
  const vivants = new Set(apres.map((m) => m.id));
  const gardes = items.filter((i) => {
    const id = typeof champId === 'function' ? champId(i) : i[champId];
    return id == null || vivants.has(id);
  });
  writeFileSync(chemin, JSON.stringify({ ...contenu, items: gardes }, null, 2));
  return items.length - gardes.length;
};

const alertesPurgees = purgerListe('alertes.json', (a) => a.barrageId ?? a.aId ?? null);
const conflitsPurges = purgerListe('conflits-planification.json', (c) => c.barrageId ?? null);
const notifsPurgees = purgerListe('instructions.json', 'barrageId');

console.log('\n  ÉCRIT.\n');
console.log(`  sauvegarde : ${DOSSIER_SAUVEGARDE}`);
console.log(`    ${sauvegardes.length} fichier(s) + ${journeesSauvees} journée(s) de relèves\n`);
console.log(`  barrages retirés   : ${retires}`);
console.log(`  barrages ajoutés   : ${nouveaux.length}`);
console.log(`  marquages au total : ${apres.length}`);
console.log(`  relèves purgées    : ${relevesPurgees}`);
console.log(`  alertes purgées    : ${alertesPurgees}`);
console.log(`  conflits purgés    : ${conflitsPurges}`);
console.log(`  notifications      : ${notifsPurgees} purgée(s)\n`);
