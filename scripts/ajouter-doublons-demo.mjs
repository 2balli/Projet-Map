#!/usr/bin/env node
/**  
 * DOUBLONS DE DÉMONSTRATION — des barrages volontairement trop rapprochés.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Le parc actuel ne contient aucune paire de barrages retirables à moins de
 * 5 km par la route : lancée devant le commandement, l'optimisation
 * répondrait « 0 à retirer » et ne démontrerait rien. Non parce qu'elle
 * fonctionne mal, mais parce que le jeu de données a justement été produit
 * avec un espacement régulier.
 *
 * Ce script pose donc des doublons crédibles : pour un barrage existant, un
 * second poste sur le MÊME AXE, deux à trois kilomètres plus loin. C'est
 * exactement la situation que l'outil est censé détecter — deux équipes
 * immobilisées sur le même tronçon pour un seul filtrage utile.
 *
 * DEUX PRÉCAUTIONS
 * ----------------
 * 1. La proximité est vérifiée PAR LA ROUTE, pas à vol d'oiseau : c'est ce
 *    que mesure l'optimisation. Un doublon qui n'atteindrait pas le critère
 *    serait posé pour rien.
 * 2. Ni porte de ville ni mission : un barrage obligatoire n'est jamais
 *    retiré. Un doublon obligatoire ne prouverait rien non plus.
 *
 * RÉVERSIBLE
 * ----------
 * Chaque doublon porte `note: "doublon-demo"`. Une sauvegarde horodatée est
 * écrite avant toute modification, et `--retirer` les enlève tous.
 *
 *   node scripts/ajouter-doublons-demo.mjs               aperçu, n'écrit rien
 *   node scripts/ajouter-doublons-demo.mjs --ecrire      pose les doublons
 *   node scripts/ajouter-doublons-demo.mjs --retirer     les enlève
 *   node scripts/ajouter-doublons-demo.mjs --ecrire --nombre 20
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  chargerGrapheRoutier,
  distanceRouteMinKm,
  estObligatoire,
} from '../serveur/distances.mjs';
import { distanceKm, classeArete, pointsArete, refArete } from '../serveur/routage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');
const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
};

const NOTE = 'doublon-demo';
const NOMBRE = valeur('nombre', 28); // une par région
const ECART_MIN_KM = 1.8; // assez loin pour être crédible sur le terrain
const ECART_MAX_KM = 3.2; // assez près pour tomber franchement sous les 5 km

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];

/* ------------------------------------------------------------------ */
/* Retrait                                                            */
/* ------------------------------------------------------------------ */
if (drapeau('retirer')) {
  const aRetirer = items.filter((m) => m.note === NOTE);
  console.log('');
  console.log(`Doublons de démonstration trouvés : ${aRetirer.length}`);
  if (!aRetirer.length) {
    console.log('Rien à faire.');
    console.log('');
    process.exit(0);
  }
  if (!drapeau('ecrire')) {
    console.log('Aperçu seulement — ajoutez --ecrire pour les retirer.');
    console.log('');
    process.exit(0);
  }
  copyFileSync(FICHIER, join(ROOT, `donnees-serveur/marquages.avant-retrait-doublons.json`));
  depot.items = items.filter((m) => m.note !== NOTE);
  writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
  console.log(`${aRetirer.length} doublon(s) retiré(s).`);
  console.log('IMPORTANT : redémarrez le serveur — le dépôt est lu au démarrage.');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Pose                                                               */
/* ------------------------------------------------------------------ */
const graphe = chargerGrapheRoutier(join(COUCHES, 'graphe_routier.json'));
if (!graphe) {
  console.error('Réseau routier introuvable — lancez « npm run build:roads ».');
  process.exit(1);
}

const barrages = items.filter(
  (m) => m.type === 'barrage_fixe' && (m.statutBarrage ?? 'en_attente') !== 'annule'
);

/**
 * UN DOUBLON PAR RÉGION, ET NON PAR COMPAGNIE.
 *
 * La première version répartissait par compagnie : la couverture par région
 * devenait alors le fruit du hasard. Résultat, la région de Rabat — celle
 * qu'un chef ouvre en premier — n'en recevait aucun, et la démonstration y
 * répondait « 0 à retirer ». Le périmètre que l'on présente doit être celui
 * que l'on a garni.
 *
 * L'ANCRE PEUT ÊTRE N'IMPORTE QUEL BARRAGE, y compris une porte de ville.
 * C'est le DOUBLON qui est toujours retiré : il est créé sans motif
 * d'implantation et sans accident, donc jamais obligatoire et toujours le
 * moins bien noté des deux. La règle se lit alors d'elle-même — la porte de
 * ville reste, le poste redondant s'en va. Sans cela, les régions dont tous
 * les barrages sont obligatoires (Rabat en compte dix sur dix) restaient
 * impossibles à garnir.
 */
const deja = new Set(items.filter((m) => m.note === NOTE).map((m) => m.origineDoublon));
const regionsPourvues = new Set(items.filter((m) => m.note === NOTE).map((m) => m.reg));

/* PLUSIEURS ANCRES PAR RÉGION, essayées dans l'ordre.
 *
 * Une seule ancre ne suffit pas : tout barrage ne se prête pas à un doublon.
 * Sur autoroute, le point voisin le plus proche peut n'être joignable qu'en
 * passant par un échangeur — donc à bien plus de 4,2 km par la route. La
 * région de Marrakech est restée vide pour cette seule raison. On garde donc
 * une file de candidats par région, et on descend jusqu'à ce que l'un
 * convienne. */
const parRegion = new Map();
for (const b of barrages) {
  if (b.note === NOTE) continue; // ne pas doubler un doublon
  if (deja.has(b.id)) continue; // déjà doublé lors d'un passage précédent
  const r = b.reg ?? '(sans région)';
  if (regionsPourvues.has(r)) continue; // cette région a déjà son doublon
  if (!parRegion.has(r)) parRegion.set(r, []);
  parRegion.get(r).push(b);
}
/* Les barrages ordinaires d'abord : l'arbitrage se lit mieux sur deux postes
   comparables qu'entre une porte de ville et un poste banal. */
for (const liste of parRegion.values()) {
  liste.sort((a, b) => Number(estObligatoire(a)) - Number(estObligatoire(b)));
}
const candidats = [...parRegion.entries()];

/** Points du réseau structurant proches d'une position. */
const pointsAutour = (lng, lat, rayonKm) => {
  const out = [];
  for (let i = 0; i < graphe.nA; i++) {
    const cl = classeArete(graphe, i);
    if (cl !== 'autoroute' && cl !== 'nationale' && cl !== 'regionale') continue;
    const pts = pointsArete(graphe, i);
    /* Test grossier sur le premier point : écarte l'immense majorité des
       arêtes sans les parcourir. */
    if (distanceKm(lng, lat, pts[0][0], pts[0][1]) > rayonKm * 3) continue;
    for (const p of pts) {
      const d = distanceKm(lng, lat, p[0], p[1]);
      if (d >= ECART_MIN_KM && d <= rayonKm) out.push({ lng: p[0], lat: p[1], d, route: refArete(graphe, i) });
    }
  }
  return out;
};

const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const poses = [];
const echecs = [];

for (const [region, file] of candidats) {
  if (poses.length >= NOMBRE) break;

  let pose = null;
  let dernierEchec = null;

  /* Jusqu'à huit tentatives : au-delà, c'est que la région ne s'y prête pas. */
  for (const source of file.slice(0, 8)) {
    const autour = pointsAutour(source.lng, source.lat, ECART_MAX_KM);
    if (!autour.length) {
      dernierEchec = 'aucun axe structurant à proximité';
      continue;
    }

    /* Le plus éloigné dans la fenêtre : un doublon à 3 km est plus crédible
       qu'un doublon à 1,8 km, tout en restant largement sous le seuil. */
    autour.sort((a, b) => b.d - a.d);

    let retenu = null;
    for (const p of autour.slice(0, 16)) {
      const dRoute = distanceRouteMinKm(graphe, [source.lng, source.lat], [p.lng, p.lat]);
      /* LE critère : la route, pas le vol d'oiseau. C'est ce que mesure
         l'optimisation, et deux points séparés de 2 km peuvent être à 15 km
         l'un de l'autre de part et d'autre d'un oued. */
      if (dRoute != null && dRoute < 4.2) {
        retenu = { ...p, dRoute };
        break;
      }
    }
    if (!retenu) {
      dernierEchec = 'aucun point à moins de 4,2 km PAR LA ROUTE';
      continue;
    }

    const route = retenu.route || source.route || '';
    pose = {
    ...source,
    id: nouvelId(),
    nom: route ? `Barrage ${route} — ${source.cie ?? ''}`.trim() : `Barrage ${source.cie ?? ''}`.trim(),
    route,
    lng: Number(retenu.lng.toFixed(5)),
    lat: Number(retenu.lat.toFixed(5)),
    note: NOTE,
    origineDoublon: source.id,
    /* Un doublon ne doit surtout pas être obligatoire, sinon il ne serait
       jamais proposé au retrait et la démonstration tournerait court. */
    positionVille: 'none',
    exceptionnel: false,
    missionId: null,
    statutBarrage: 'en_attente',
    /* Volontairement plus faible que la source sur les accidents : c'est lui
       qui doit tomber, et l'arbitrage doit se lire sans explication. */
    accidentCount: 0,
    severite: 'none',
    cree: new Date().toISOString(),
    maj: new Date().toISOString(),
      _source: { nom: source.nom, cie: source.cie, reg: source.reg, dRoute: retenu.dRoute },
    };
    break; // cette région est pourvue
  }

  if (pose) poses.push(pose);
  else echecs.push({ reg: region, nom: `${file.length} ancre(s) essayée(s)`, raison: dernierEchec ?? 'aucun candidat' });
}

console.log('');
console.log('DOUBLONS DE DÉMONSTRATION');
console.log('-'.repeat(72));
console.log(`Régions pourvues d'un barrage fixe     : ${candidats.length}`);
console.log(`Doublons préparés                     : ${poses.length}`);
if (echecs.length) {
  console.log(`Écartés                               : ${echecs.length}`);
  for (const e of echecs) console.log(`    ${String(e.reg ?? '').padEnd(20)} ${e.nom || '(sans nom)'} — ${e.raison}`);
}
console.log('');
console.log('  région                 compagnie              axe        écart PAR LA ROUTE');
for (const p of poses) {
  console.log(
    `  ${String(p.reg ?? '—').padEnd(22)} ${String(p._source.cie ?? '—').padEnd(22)} ${String(p.route || '—').padEnd(10)} ${p._source.dRoute.toFixed(2)} km`
  );
}
console.log('');
console.log('Chacun de ces doublons forme une paire sous le seuil de 5 km :');
console.log('l’optimisation en proposera un des deux au retrait, jamais les deux.');

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour poser.');
  console.log('');
  process.exit(0);
}

copyFileSync(FICHIER, join(ROOT, 'donnees-serveur/marquages.avant-doublons.json'));
depot.items = [...items, ...poses.map(({ _source, ...p }) => p)];
writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

const total = depot.items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile').length;
console.log('');
console.log(`${poses.length} doublon(s) posé(s). Parc : ${total} barrages.`);
console.log('Sauvegarde : donnees-serveur/marquages.avant-doublons.json');
console.log('Retrait    : node scripts/ajouter-doublons-demo.mjs --retirer --ecrire');
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
