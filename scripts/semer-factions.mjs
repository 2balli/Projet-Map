#!/usr/bin/env node
/**
 * BARRAGES DE RÉFÉRENCE — un par brigade, un par faction, quatre par compagnie.
 *
 * CE QU'IL PRODUIT. Pour chaque compagnie du découpage réel, quatre barrages
 * fixes au plus : le premier en faction 1 dans une brigade, le deuxième en
 * faction 2 dans une AUTRE brigade, et ainsi de suite. Une compagnie de trois
 * brigades reçoit trois barrages, pas quatre — on ne fabrique pas de brigade
 * pour atteindre un chiffre rond.
 *
 * D'OÙ VIENNENT LES BRIGADES. De `circo_bt.geojson`, le découpage administratif
 * livré avec la carte, et de nulle part ailleurs : c'est la même source que le
 * serveur consulte pour rattacher un point (`serveur/geo.mjs`). Aucun nom
 * d'unité n'est inventé.
 *
 * OÙ LES POSTES SONT PLACÉS. À l'intérieur de la circonscription de LEUR
 * brigade, testé point par point (`dansGeometrie`), en partant du chef-lieu
 * quand `pts_bt.geojson` le donne. Ce n'est pas une coquetterie : le serveur
 * REFUSE une écriture hors périmètre, et un poste semé en dehors serait
 * invisible à sa propre brigade et impossible à corriger depuis l'application.
 * Une brigade où aucun point n'est trouvé est SIGNALÉE, jamais approximée.
 *
 * CE QU'IL DÉTRUIT, ET COMMENT IL S'EN EXCUSE. `--remplacer` retire les
 * barrages existants. Leurs relèves, alertes, conflits, notifications et
 * rapports d'optimisation les désignent : gardés tels quels, ils deviendraient
 * des orphelins pointant vers des postes disparus. Ils sont donc purgés dans le
 * même geste. Une SAUVEGARDE HORODATÉE de chaque fichier touché est écrite
 * avant la moindre modification, et le chemin en est rappelé à la fin.
 *
 * RIEN N'EST ÉCRIT SANS `--ecrire`. Par défaut le script calcule, affiche ce
 * qu'il ferait, et s'arrête.
 *
 *   node scripts/semer-factions.mjs --donnees donnees-demo
 *   node scripts/semer-factions.mjs --donnees donnees-demo --remplacer --ecrire
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

import { dansGeometrie } from '../serveur/geo.mjs';
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
/** Même graine ⇒ mêmes emplacements : un semis doit être reproductible. */
const GRAINE = Number(arg('--graine', 20260923));

if (!existsSync(DONNEES)) {
  console.error(`\nDossier de donnees introuvable : ${DONNEES}\n`);
  process.exit(1);
}

/** Générateur déterministe — `Math.random()` rendrait le semis irreproductible. */
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
/* LE DÉCOUPAGE RÉEL                                                  */
/* ================================================================== */

const cheminCirco = join(COUCHES, 'circo_bt.geojson');
if (!existsSync(cheminCirco)) {
  console.error(`\nIntrouvable : ${cheminCirco}\nLancez « npm run build:layers ».\n`);
  process.exit(1);
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
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || !f.geometry || BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, {
    bt,
    cie: f.properties?.gr_cie ?? null,
    reg: f.properties?.gr_region ?? null,
    geometry: f.geometry,
    bbox: bbox(f.geometry),
  });
}

/** Compagnie → ses brigades réelles, triées pour que le semis soit stable. */
const PAR_COMPAGNIE = new Map();
for (const b of BRIGADES.values()) {
  if (!b.cie) continue;
  if (!PAR_COMPAGNIE.has(b.cie)) PAR_COMPAGNIE.set(b.cie, []);
  PAR_COMPAGNIE.get(b.cie).push(b);
}
for (const liste of PAR_COMPAGNIE.values()) liste.sort((a, b) => a.bt.localeCompare(b.bt, 'fr'));

if (!PAR_COMPAGNIE.size) {
  console.error('\nAucune compagnie dans circo_bt.geojson.\n');
  process.exit(1);
}

/* ---- chefs-lieux, pour poser le barrage là où il est vraisemblable ---- */
const normaliserNom = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^BT\s+/i, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toUpperCase();

const CHEFS_LIEUX = new Map();
{
  const chemin = join(COUCHES, 'pts_bt.geojson');
  if (existsSync(chemin)) {
    const pts = JSON.parse(readFileSync(chemin, 'utf8'));
    for (const f of pts.features ?? []) {
      const cle = normaliserNom(f.properties?.nom);
      if (cle && f.geometry?.coordinates) CHEFS_LIEUX.set(cle, f.geometry.coordinates);
    }
  }
}

/**
 * UN POINT À L'INTÉRIEUR DE LA CIRCONSCRIPTION — même méthode que
 * `semer-demo.mjs`, et pour la même raison (voir l'en-tête).
 */
function pointDansBrigade(b) {
  const chef = CHEFS_LIEUX.get(normaliserNom(b.bt));
  if (chef && dansGeometrie(chef, b.geometry)) {
    for (let i = 0; i < 40; i++) {
      const d = 0.004 + rnd() * 0.05;
      const a = rnd() * Math.PI * 2;
      const p = [chef[0] + Math.cos(a) * d, chef[1] + Math.sin(a) * d];
      if (dansGeometrie(p, b.geometry)) return p;
    }
    return chef;
  }
  const [minX, minY, maxX, maxY] = b.bbox;
  for (let i = 0; i < 600; i++) {
    const p = [minX + rnd() * (maxX - minX), minY + rnd() * (maxY - minY)];
    if (dansGeometrie(p, b.geometry)) return p;
  }
  return null;
}

/* ================================================================== */
/* LE SEMIS                                                           */
/* ================================================================== */

const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
const arrondir = (p) => [+Number(p[0]).toFixed(5), +Number(p[1]).toFixed(5)];
const maintenant = new Date().toISOString();

const AUTEUR = {
  matricule: 'SYSTEME',
  nom: 'Semis des barrages de référence',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
  cie: null,
};

const nouveaux = [];
const incomplets = [];
const sansPoint = [];
let numero = 0;

const compagnies = [...PAR_COMPAGNIE.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'));

for (const [cie, brigades] of compagnies) {
  /* Quatre brigades DISTINCTES au plus — et jamais une de plus que ce que la
     compagnie possède réellement. */
  const retenues = brigades.slice(0, FACTIONS.length);
  if (retenues.length < FACTIONS.length) {
    incomplets.push({ cie, brigades: retenues.length, noms: retenues.map((b) => b.bt) });
  }

  retenues.forEach((brigade, i) => {
    const faction = FACTIONS[i];
    const pt = pointDansBrigade(brigade);
    if (!pt) {
      sansPoint.push({ cie, bt: brigade.bt });
      return;
    }
    const [lng, lat] = arrondir(pt);
    numero++;
    nouveaux.push({
      id: nouvelId(),
      type: 'barrage_fixe',
      nom: `B-${String(numero).padStart(3, '0')} ${brigade.bt}`,
      route: '',
      note: `Barrage de référence — ${faction.nom} (${faction.libelle}).`,
      /* L'HORAIRE EST ÉCRIT EN PLUS DE LA FACTION, pas à sa place : il rend la
         fiche lisible sans connaître la numérotation des factions, et il sert
         au calcul de chevauchement de l'optimisation. */
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
      /* Marque de démonstration, comme le reste du semis : ces postes ne sont
         pas des relevés de terrain et ne doivent jamais être présentés comme
         tels. */
      demo: true,
    });
  });
}

/* ================================================================== */
/* COMPTE RENDU                                                       */
/* ================================================================== */

const parFaction = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
for (const b of nouveaux) parFaction[b.factionId]++;
const brigadesUtilisees = new Set(nouveaux.map((b) => `${b.cie} / ${b.bt}`));

console.log('\n  SEMIS DES BARRAGES DE RÉFÉRENCE\n');
console.log(`  données   : ${DONNEES}`);
console.log(`  découpage : ${cheminCirco}`);
console.log(`  graine    : ${GRAINE}\n`);
console.log(`  compagnies traitées : ${compagnies.length}`);
console.log(`  brigades utilisées  : ${brigadesUtilisees.size} (sur ${BRIGADES.size} existantes)`);
console.log(`  barrages produits   : ${nouveaux.length}\n`);
for (const f of FACTIONS) {
  console.log(`    ${f.id}  ${f.libelle}   ${String(parFaction[f.id]).padStart(4)}`);
}

if (incomplets.length) {
  console.log(`\n  ${incomplets.length} compagnie(s) de MOINS de 4 brigades réelles :`);
  for (const c of incomplets) {
    console.log(`    ${c.cie.padEnd(22)} ${c.brigades} brigade(s) : ${c.noms.join(', ')}`);
  }
  console.log('  Aucune brigade n’a été inventée pour les compléter.');
}
if (sansPoint.length) {
  console.log(`\n  ${sansPoint.length} brigade(s) sans point trouvé dans leur circonscription :`);
  for (const s of sansPoint) console.log(`    ${s.cie} / ${s.bt}`);
  console.log('  Ces brigades n’ont pas reçu de barrage — rien n’a été approximé.');
}

if (!ECRIRE) {
  console.log('\n  --ecrire absent : RIEN n’a été modifié.\n');
  process.exit(0);
}

/* ================================================================== */
/* ÉCRITURE                                                           */
/* ================================================================== */

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const DOSSIER_SAUVEGARDE = join(DONNEES, 'sauvegardes', `avant-semis-factions-${horodatage}`);
mkdirSync(DOSSIER_SAUVEGARDE, { recursive: true });

const sauvegarder = (nomFichier) => {
  const chemin = join(DONNEES, nomFichier);
  if (!existsSync(chemin)) return false;
  copyFileSync(chemin, join(DOSSIER_SAUVEGARDE, nomFichier));
  return true;
};

const sauvegardes = [];
for (const f of [
  'marquages.json',
  'alertes.json',
  'conflits-planification.json',
  'instructions.json',
  'rapports-optimisation.json',
]) {
  if (sauvegarder(f)) sauvegardes.push(f);
}

/* Les relèves vivent en un fichier par journée : on copie le dossier entier. */
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

const BARRAGES = ['barrage_fixe', 'barrage_mobile'];
/**
 * LES AUTRES REPÈRES SURVIVENT. Points noirs, congestions, marquages divers :
 * ils ne relèvent d'aucune faction et rien dans la demande ne les concerne.
 * Les emporter aurait vidé la carte de tout ce qui n'est pas un poste.
 */
const conserves = REMPLACER ? avant.filter((m) => !BARRAGES.includes(m.type)) : avant;
const retires = avant.length - conserves.length;

const apres = [...conserves, ...nouveaux];
writeFileSync(cheminMarquages, JSON.stringify({ ...brut, version: 1, items: apres }, null, 2));

/**
 * LES DÉPENDANCES DES BARRAGES DISPARUS.
 *
 * Une relève, une alerte ou une notification qui désigne un poste qui n'existe
 * plus n'est pas seulement inutile : elle fausse les comptes (voir le contrôle
 * « aucune relève ne vise un barrage inexistant » dans verifier-factions.mjs)
 * et fait apparaître des lignes sans objet dans les écrans. On les retire dans
 * le même geste que les postes, et jamais séparément.
 */
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
const rapportsPurges = purgerListe('rapports-optimisation.json', () => null);

console.log('\n  ÉCRIT.\n');
console.log(`  sauvegarde : ${DOSSIER_SAUVEGARDE}`);
console.log(`    ${sauvegardes.length} fichier(s) + ${journeesSauvees} journée(s) de relèves\n`);
console.log(`  barrages retirés  : ${retires}`);
console.log(`  barrages ajoutés  : ${nouveaux.length}`);
console.log(`  marquages au total: ${apres.length}`);
console.log(`  relèves purgées   : ${relevesPurgees}`);
console.log(`  alertes purgées   : ${alertesPurgees}`);
console.log(`  conflits purgés   : ${conflitsPurges}`);
console.log(`  notifications     : ${notifsPurgees} purgée(s)`);
console.log(`  rapports optim.   : ${rapportsPurges} purgé(s)\n`);
