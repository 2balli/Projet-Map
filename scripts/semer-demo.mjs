#!/usr/bin/env node
/**
 * SEMIS COMPLET DU JEU DE DÉMONSTRATION — toutes les brigades, sans exception.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * `scripts/fake-effectifs.mjs` ne peuplait que les brigades TENANT DÉJÀ UN
 * BARRAGE : 391 sur 504, et un volume déduit de la composition des postes.
 * Résultat mesuré sur `donnees-demo` avant ce script :
 *
 *     113 brigades sans un seul homme, 287 sous la barre des vingt.
 *
 * Une démonstration qui ouvre une brigade au hasard et n'y trouve personne ne
 * démontre rien. Ce script part donc de la LISTE DES BRIGADES, pas de la liste
 * des barrages, et amène CHACUNE au niveau que SES POSTES réclament.
 *
 * L'EFFECTIF N'EST PAS UN NOMBRE CHOISI
 * -------------------------------------
 * Une première version donnait vingt hommes à chaque brigade, sans regarder ce
 * qu'elles tenaient. Mesuré : 6 120 hommes manquants par journée, répartis sur
 * 179 brigades — le signalement de manque devenait du bruit de fond. La cause
 * n'était pas le volume (10 080 hommes pour 7 653 nécessaires par créneau) mais
 * la CONCENTRATION : la brigade médiane tient deux postes et en réclame neuf,
 * Es-Smara en tient trente-six et en réclamait cent quatre-vingt-dix-huit.
 *
 * L'effectif se déduit donc du besoin propre de la brigade, borné en bas
 * (vraisemblance, `--cible`) et en haut (`--plafond`) :
 *
 *     effectif(brigade) = borner( Σ composition(poste) + réserve )
 *
 * Il reste un manque sur les huit brigades réellement surchargées. Il est
 * ASSUMÉ : c'est ce qui donne à voir le signalement de manque sur des unités
 * qu'on peut nommer, au lieu de le diluer partout.
 *
 * LA HIÉRARCHIE N'EST PAS INVENTÉE. Elle est lue dans `circo_bt.geojson`
 * (`gr_bde` / `gr_cie` / `gr_region`), la même source que `serveur/geo.mjs`
 * emploie pour contrôler les écritures — 504 brigades, 93 compagnies, 28
 * régions. Aucune région, compagnie ou brigade n'est créée ici.
 *
 * TOUT EST MARQUÉ, DEUX FOIS PLUTÔT QU'UNE — la règle posée par
 * `fake-effectifs.mjs` est reprise telle quelle :
 *
 *   `demo: true`             le drapeau que lit le code et que `retirer-demo`
 *                            suit pour tout reprendre ;
 *   matricule `DEMO-…`       la marque qui saute aux yeux dans une liste ;
 *   nom finissant par DEMO   « Youssef Bennani DEMO » — un patronyme seul
 *                            finit par être pris pour un vrai.
 *
 * REPRODUCTIBLE. Aucun `Math.random`. Noms, grades, coordonnées et statuts se
 * déduisent d'une empreinte stable du nom de la brigade : deux exécutions, sur
 * deux postes, produisent exactement le même jeu.
 *
 * IDEMPOTENT. Le semis COMPLÈTE, il ne recopie pas : une brigade déjà à la
 * cible ne reçoit personne, un marquage dont l'identifiant déterministe existe
 * déjà n'est pas reposé. Relancer la commande deux fois de suite ne change
 * rien au second passage — c'est vérifié par `npm run check:semis`.
 *
 * JAMAIS EN PRODUCTION. Le script lit `mode.json` du dossier visé et REFUSE de
 * travailler si le mode n'est pas `demo` (voir `serveur/mode.mjs`). Il n'écrit
 * rien sans `--ecrire`, et ne réinitialise rien sans `--reinitialiser
 * --confirmer`.
 *
 * EMPLOI
 *   node scripts/semer-demo.mjs                        aperçu, n'écrit rien
 *   node scripts/semer-demo.mjs --ecrire               sème
 *   node scripts/semer-demo.mjs --composition-demo --ecrire
 *   node scripts/semer-demo.mjs --ecrire --reinitialiser --confirmer
 *   node scripts/semer-demo.mjs --rapport r.md --projection p.csv
 *
 * `--rapport` et `--projection` fonctionnent AUSSI SANS `--ecrire` : l'aperçu
 * décrit alors, brigade par brigade, ce que la commande produirait.
 *
 * Options
 *   --donnees <dossier>   dossier de données          (défaut donnees-demo)
 *   --couches <dossier>   couches géographiques       (défaut public/layers)
 *   --cible <n>           PLANCHER d'effectif par brigade        (défaut 20)
 *   --plafond <n>         PLAFOND d'effectif par brigade         (défaut 60)
 *   --reserve <n>         % au-dessus du besoin strict           (défaut 15)
 *   --composition-demo    poste fixe ramené à 1 ADJT + 2 MDLC + 3 MDLG,
 *                         dans le dossier de démonstration UNIQUEMENT
 *   --projection <f.csv>  effectif attendu, brigade par brigade
 *   --part-accidents <n>  % de brigades recevant un point noir   (défaut 40)
 *   --part-zahma <n>      % de brigades recevant une congestion  (défaut 25)
 *   --sans-barrages       ne touche pas aux marquages
 *   --sans-roster         ne prépare pas les relèves du jour
 *   --graine <n>          graine du tirage déterministe (défaut 20260915)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ecrireJsonAtomique } from '../serveur/ecritureAtomique.mjs';
import { dansGeometrie } from '../serveur/geo.mjs';
import { lireMode, MODES } from '../serveur/mode.mjs';
import { creerDepotElements } from '../serveur/elements.mjs';
import { creerDepotEffectifs } from '../serveur/effectifs.mjs';
import { chargerComposition, preparerJournee, dateLocale, lendemain } from '../serveur/roster.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-demo')));
const COUCHES = resolve(valeur('couches', join(ROOT, 'public/layers')));
/**
 * PLANCHER ET PLAFOND — le scénario « G », arbitré sur mesure.
 *
 * L'effectif d'une brigade n'est plus un nombre choisi : il se déduit de ce que
 * SES postes réclament (voir `cibleBrigade`). Restaient deux bornes :
 *
 *   PLANCHER  une brigade à deux postes n'a besoin que de neuf hommes ; en
 *             afficher neuf ferait croire à une unité exsangue. Vingt est le
 *             plancher de vraisemblance, et c'est aussi ce qui garantit que
 *             n'importe quelle brigade ouverte en démonstration montre une
 *             liste fournie.
 *   PLAFOND   sans borne haute, Es-Smara et ses trente-six postes réclamait
 *             230 hommes — une brigade qui n'existe pas. Soixante est le haut
 *             de ce qu'on peut présenter sans qu'on s'arrête dessus.
 *
 * Le plafond laisse un manque résiduel sur huit brigades réellement
 * surchargées. Il est ASSUMÉ : c'est ce qui fait la démonstration du signalement
 * de manque, sur une poignée d'unités qu'on peut nommer, au lieu de le noyer
 * dans 179 brigades à moitié tenues.
 */
const CIBLE = Math.max(1, Math.trunc(Number(valeur('cible', 20))));
const PLAFOND = Math.max(CIBLE, Math.trunc(Number(valeur('plafond', 60))));
/** Au-dessus du besoin strict : la réserve, la rotation, les absents. */
const RESERVE = Math.max(0, Number(valeur('reserve', 15))) / 100;
const PART_ACCIDENTS = Math.min(100, Math.max(0, Number(valeur('part-accidents', 40))));
const PART_ZAHMA = Math.min(100, Math.max(0, Number(valeur('part-zahma', 25))));
const GRAINE = Number(valeur('graine', 20260915));
const ECRIRE = drapeau('ecrire');
const REINIT = drapeau('reinitialiser');
const CONFIRME = drapeau('confirmer');
const SANS_BARRAGES = drapeau('sans-barrages');
const SANS_ROSTER = drapeau('sans-roster');
const RAPPORT = valeur('rapport', null);
const PROJECTION = valeur('projection', null);
/**
 * COMPOSITION PROPRE À LA DÉMONSTRATION — et à elle seule.
 *
 * La composition livrée demande UN A/C PAR BARRAGE FIXE. Une brigade qui tient
 * quatre postes en réclamerait donc quatre : aucune brigade réelle n'a quatre
 * adjudants-chefs, et c'est ce seul point qui produisait 451 des 1 530 hommes
 * manquants par créneau. L'A/C COMMANDE la brigade, il ne se tient pas sur
 * chaque barrage.
 *
 * Avec ce drapeau, le poste fixe devient « 1 ADJT + 2 MDLC + 3 MDLG » — six
 * hommes comme avant, l'encadrement redescendu d'un cran. Le fichier
 * `composition-barrage.json` du dossier VISÉ est réécrit (et sauvegardé avant),
 * jamais celui de la production : chaque dossier de données porte le sien, et
 * le garde-fou `mode.json` interdit déjà de viser autre chose que la
 * démonstration.
 */
const COMPOSITION_DEMO = drapeau('composition-demo');

/** La marque du fictif — un seul endroit, pour que `retirer-demo` ne rate rien. */
const PREFIXE = 'DEMO-';

const fichier = (n) => join(DONNEES, n);

/* ================================================================== */
/* Garde-fous                                                         */
/* ================================================================== */

/**
 * LE MODE EST VÉRIFIÉ AVANT TOUT LE RESTE.
 *
 * Un dossier sans marqueur est REFUSÉ plutôt que deviné : c'est la règle posée
 * par `serveur/mode.mjs`, et la seule qui empêche un `--donnees` mal recopié
 * de verser dix mille gendarmes fictifs dans le dispositif réel.
 */
if (!existsSync(DONNEES)) {
  console.error(`\nDossier de données introuvable : ${DONNEES}\n`);
  process.exit(1);
}

let marqueur;
try {
  marqueur = lireMode(DONNEES);
} catch (err) {
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

if (!marqueur) {
  console.error(`\nAucun mode.json dans ${DONNEES}.`);
  console.error('Un dossier sans marqueur est refusé : impossible de savoir s’il est réel.\n');
  process.exit(1);
}
if (marqueur.mode !== MODES.DEMO) {
  console.error(`\nREFUS : ${DONNEES} est en mode « ${marqueur.mode} ».`);
  console.error('Ce script ne sème que dans un dossier de DÉMONSTRATION.\n');
  process.exit(1);
}

if (REINIT && !CONFIRME) {
  console.error('\n--reinitialiser efface TOUT l’existant fictif (effectif, marquages semés).');
  console.error('Ajoutez --confirmer pour l’assumer.\n');
  process.exit(1);
}

/* ================================================================== */
/* Tirage déterministe                                                */
/* ================================================================== */

/** Empreinte FNV-1a — remplace tout tirage au hasard. */
function empreinte(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 : même générateur que `fake-data.mjs`, pour la même raison. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un générateur propre à une brigade et à un usage : deux flux ne se mêlent pas. */
const tirage = (cle) => mulberry32((empreinte(cle) ^ GRAINE) >>> 0);

/* ================================================================== */
/* Vocabulaire — patronymes courants, ils ne désignent personne       */
/* ================================================================== */

const PRENOMS = [
  'Mohamed', 'Ahmed', 'Youssef', 'Hassan', 'Karim', 'Rachid', 'Said', 'Abdellah',
  'Mustapha', 'Omar', 'Khalid', 'Anas', 'Yassine', 'Hamza', 'Brahim', 'Noureddine',
  'Abderrahim', 'Jamal', 'Tarik', 'Adil', 'Mehdi', 'Reda', 'Soufiane', 'Ayoub',
  'Hicham', 'Mounir', 'Nabil', 'Aziz', 'Driss', 'Fouad', 'Ismail', 'Othmane',
  'Zakaria', 'Bilal', 'Marouane', 'Salah', 'Younes', 'Amine', 'Badr', 'Ilyas',
];
const NOMS = [
  'Alaoui', 'Bennani', 'Cherkaoui', 'El Amrani', 'Benjelloun', 'Tazi', 'Idrissi',
  'El Fassi', 'Berrada', 'Lahlou', 'Sqalli', 'Bouazza', 'Ouazzani', 'Naciri',
  'El Hachimi', 'Skalli', 'Chraibi', 'Belkadi', 'Sebti', 'Kettani', 'El Ghazi',
  'Amrani', 'Bekkali', 'Hajji', 'Moutawakil', 'Rifai', 'Sadiki', 'Zerouali',
  'Benkirane', 'El Malki', 'Boukhris', 'Lamrani', 'Tahiri', 'Najmi', 'Slaoui',
  'Bouhlal', 'Yacoubi', 'Daoudi', 'Filali', 'Mansouri',
];

/** Grades acceptés par le serveur, du plus élevé au moins élevé. */
const GRADES_DESC = ['A/C', 'ADJT', 'MDLC', 'MDLG'];

/** Un compte par grade, à zéro. */
const parGradeVide = () => ({ 'A/C': 0, ADJT: 0, MDLC: 0, MDLG: 0 });

/** Composition d'un poste fixe en démonstration — voir `COMPOSITION_DEMO`. */
const COMPOSITION_FIXE_DEMO = [
  { grade: 'ADJT', nombre: 1 },
  { grade: 'MDLC', nombre: 2 },
  { grade: 'MDLG', nombre: 3 },
];

/**
 * CE QU'UNE BRIGADE DOIT ALIGNER, grade par grade.
 *
 * Le besoin est celui d'UN CRÉNEAU, pas d'une journée : `repartir` est appelée
 * une fois par créneau avec l'effectif entier de la brigade, et une même
 * personne peut donc tenir un poste aux quatre relèves. Compter quatre fois
 * gonflerait l'effectif sans rien servir.
 *
 * Puis trois arbitrages, dans cet ordre :
 *
 *   1. RÉSERVE     15 % au-dessus du besoin, au moins un homme par grade
 *                  employé — sinon le moindre absent découvre un poste ;
 *   2. ENCADREMENT un à deux A/C, deux ADJT au minimum, QUOI QU'EN DISE le
 *                  besoin. C'est la borne de vraisemblance : on préfère un
 *                  manque affiché à une brigade dotée de trente-cinq
 *                  adjudants-chefs, que personne ne croirait ;
 *   3. BORNES      plancher, puis plafond. Le plafond RÉDUIT À L'ÉCHELLE au
 *                  lieu de raboter : voir ci-dessous.
 */
function cibleBrigade(besoin, nbPostes) {
  const cible = parGradeVide();
  for (const g of GRADES_DESC) {
    cible[g] = besoin[g] > 0 ? besoin[g] + Math.max(1, Math.round(besoin[g] * RESERVE)) : 0;
  }

  cible['A/C'] = Math.max(1, Math.min(2, Math.round(nbPostes / 8) + 1));
  if (cible.ADJT < 2) cible.ADJT = 2;

  const total = () => GRADES_DESC.reduce((s, g) => s + cible[g], 0);

  if (total() < CIBLE) cible.MDLG += CIBLE - total();

  /**
   * QUAND LE PLAFOND MORD, ON RÉDUIT À L'ÉCHELLE — on ne rabote pas.
   *
   * Une première version retirait l'excédent grade par grade en commençant par
   * la base. Le résultat, sur Es-Smara : 2 A/C, 35 ADJT, 22 MDLC et UN SEUL
   * MDLG. Une brigade de trente-cinq adjudants pour un gendarme n'existe pas,
   * et personne à qui l'on montre cet écran ne regardera la suite.
   *
   * On garde donc la FORME du besoin — les proportions entre grades — et l'on
   * ramène le tout à la taille du plafond. Le manque en sort réparti sur les
   * trois grades au lieu d'être concentré sur un seul, ce qui est aussi plus
   * juste : une brigade qui ne peut pas tenir trente-six postes en manque
   * partout, pas seulement en gendarmes.
   */
  if (total() > PLAFOND) {
    const base = cible.ADJT + cible.MDLC + cible.MDLG;
    const place = PLAFOND - cible['A/C'];
    const facteur = base > 0 ? place / base : 0;
    cible.ADJT = Math.max(2, Math.round(cible.ADJT * facteur));
    cible.MDLC = Math.max(1, Math.round(cible.MDLC * facteur));
    cible.MDLG = Math.max(0, PLAFOND - cible['A/C'] - cible.ADJT - cible.MDLC);
  }

  return cible;
}

/* ================================================================== */
/* Hiérarchie — lue, jamais inventée                                  */
/* ================================================================== */

const cheminCirco = join(COUCHES, 'circo_bt.geojson');
if (!existsSync(cheminCirco)) {
  console.error(`\nIntrouvable : ${cheminCirco}`);
  console.error('Lancez `npm run build:layers` (ou passez --couches).\n');
  process.exit(1);
}

/** Boîte englobante d'une géométrie — filtre bon marché avant le test complet. */
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
/** @type {Map<string,{bt:string,cie:string,reg:string,geometry:object,bbox:number[]}>} */
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || !f.geometry) continue;
  if (BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, {
    bt,
    cie: f.properties?.gr_cie ?? null,
    reg: f.properties?.gr_region ?? null,
    geometry: f.geometry,
    bbox: bbox(f.geometry),
  });
}

const LISTE_BRIGADES = [...BRIGADES.values()].sort((a, b) => a.bt.localeCompare(b.bt, 'fr'));
const REGIONS = new Set(LISTE_BRIGADES.map((b) => b.reg).filter(Boolean));
const COMPAGNIES = new Set(LISTE_BRIGADES.map((b) => b.cie).filter(Boolean));

if (!LISTE_BRIGADES.length) {
  console.error('\nAucune brigade dans circo_bt.geojson — rien à peupler.\n');
  process.exit(1);
}

/**
 * CHEFS-LIEUX DE BRIGADE, quand la couche est là : un barrage posé près du
 * chef-lieu est plus vraisemblable qu'un point tiré au milieu du désert de la
 * circonscription. `pts_bt.geojson` nomme ses points « BT AGADIR » là où la
 * circonscription dit « Agadir » — d'où la normalisation.
 */
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
 * UN POINT À L'INTÉRIEUR DE LA CIRCONSCRIPTION — et non « quelque part près ».
 *
 * Le serveur refuse une écriture hors périmètre (`serveur/geo.mjs`,
 * `controler`) : un barrage semé en dehors serait invisible à sa propre
 * brigade et impossible à corriger depuis l'application. On tire donc dans la
 * boîte englobante jusqu'à tomber dedans, en partant du chef-lieu quand on
 * l'a. Une brigade où rien n'est trouvé est SIGNALÉE, jamais approximée.
 */
function pointDansBrigade(b, rnd) {
  const chef = CHEFS_LIEUX.get(normaliserNom(b.bt));
  if (chef && dansGeometrie(chef, b.geometry)) {
    /* Léger décalage : deux barrages d'une même brigade ne se superposent pas. */
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

const arrondir = (p) => [+Number(p[0]).toFixed(5), +Number(p[1]).toFixed(5)];

/* ================================================================== */
/* Lecture de l'existant                                              */
/* ================================================================== */

const lire = (nom, defaut) => {
  if (!existsSync(fichier(nom))) return defaut;
  try {
    return JSON.parse(readFileSync(fichier(nom), 'utf8'));
  } catch (err) {
    console.error(`\n${nom} illisible : ${err.message}\n`);
    process.exit(1);
  }
  return defaut;
};

const effectifsFichier = lire('effectifs.json', { version: 1, items: [] });
const marquagesFichier = lire('marquages.json', { version: 1, items: [] });

const estFictif = (p) => p?.demo === true || String(p?.matricule ?? '').startsWith(PREFIXE);

/**
 * CE QU'ON NE TOUCHE JAMAIS : les personnes sans la marque du fictif. Un
 * effectif réel chargé entre-temps traverse le semis intact — c'est la même
 * garantie que celle de `fake-effectifs.mjs`, et elle vaut aussi pour un
 * `--reinitialiser`.
 */
const personnesReelles = (effectifsFichier.items ?? []).filter((p) => !estFictif(p));
let personnesFictives = REINIT ? [] : (effectifsFichier.items ?? []).filter(estFictif);

/* Une personne fictive rattachée à une brigade qui n'existe plus est écartée :
   la garder ferait mentir le contrôle « chaque personne appartient à une
   brigade valide » du rapport final. */
const fictivesOrphelines = personnesFictives.filter((p) => !BRIGADES.has(p.bt));
personnesFictives = personnesFictives.filter((p) => BRIGADES.has(p.bt));

/**
 * RATTACHEMENTS REDRESSÉS — 234 personnes fictives portaient une compagnie et
 * une région qui ne sont pas celles de leur brigade.
 *
 * L'effectif fictif d'origine recopiait `cie`/`reg` du BARRAGE sur lequel la
 * personne avait été fabriquée ; quand ce barrage était rattaché autrement que
 * sa brigade, l'incohérence suivait. Exemple mesuré : la brigade d'Aglou,
 * compagnie de Tiznit en région d'Agadir dans `circo_bt.geojson`, portait des
 * gendarmes en « Sidi Ifni / Guelmim ».
 *
 * La circonscription fait foi — c'est elle que le serveur interroge pour
 * autoriser une écriture. On redresse donc, et UNIQUEMENT sur des personnes
 * fictives : un effectif réel mal rattaché serait signalé, jamais corrigé en
 * silence par un script de démonstration.
 */
const redresses = [];
personnesFictives = personnesFictives.map((p) => {
  const b = BRIGADES.get(p.bt);
  if (p.cie === b.cie && p.reg === b.reg) return p;
  redresses.push({ matricule: p.matricule, bt: p.bt, avant: `${p.cie}/${p.reg}`, apres: `${b.cie}/${b.reg}` });
  return { ...p, cie: b.cie, reg: b.reg };
});

/** Un rattachement réel incohérent est DIT, pas corrigé : voir ci-dessus. */
const reelsMalRattaches = personnesReelles.filter((p) => {
  const b = BRIGADES.get(p.bt);
  return !b || p.cie !== b.cie || p.reg !== b.reg;
});

/** Identifiant d'un marquage semé — déterministe, donc jamais reposé deux fois. */
const idMarquage = (bt, type, i) =>
  `mq_semis_${empreinte(`${bt}|${type}|${i}|${GRAINE}`).toString(16).padStart(8, '0')}`;

const estSeme = (m) => typeof m?.id === 'string' && m.id.startsWith('mq_semis_');
const marquagesExistants = REINIT
  ? (marquagesFichier.items ?? []).filter((m) => !estSeme(m))
  : (marquagesFichier.items ?? []);
const idsMarquages = new Set(marquagesExistants.map((m) => m.id));

/* ================================================================== */
/* 1. MARQUAGES — barrages, points noirs, congestion                  */
/*    Ils viennent AVANT l'effectif : c'est le nombre de postes d'une     */
/*    brigade qui décide de l'effectif qu'elle doit aligner.             */
/* ================================================================== */

/**
 * L'auteur des enregistrements semés. Un matricule qui ne peut appartenir à
 * personne : on doit pouvoir distinguer d'un coup d'œil un barrage semé d'un
 * barrage posé par un chef.
 */
const AUTEUR = {
  matricule: 'SEMIS-DEMO',
  nom: 'Semis de démonstration',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
  cie: null,
};

/** Instant de référence fixe : deux exécutions produisent les mêmes dates. */
const HORODATAGE = new Date(Date.UTC(2026, 8, 15, 6, 0, 0)).toISOString();

const SOUS_TYPES = ['carrefour', 'entree_ville', 'peage', 'marche', 'autre'];
const SEVERITES = ['none', 'moderate', 'high', 'critical'];
const NIVEAUX = ['low', 'medium', 'high'];
const ECLAIRAGES = ['inconnu', 'oui', 'non'];

/** Un marquage complet, aux champs EXACTS de `serveur/depot.mjs` (`normaliser`). */
function marquage({ id, type, nom, lng, lat, b, rnd, accidentCount = 0, eclairage = 'inconnu', sousType = 'carrefour' }) {
  return {
    id,
    type,
    nom,
    route: '',
    /* La note dit ce que l'enregistrement est, en clair, pour qui le lit hors
       de l'application — un export, une impression, une copie d'écran. */
    note: 'Enregistrement FICTIF de démonstration (scripts/semer-demo.mjs).',
    debut: '',
    fin: '',
    accidentCount,
    severite: SEVERITES[Math.floor(rnd() * SEVERITES.length)],
    activite: NIVEAUX[Math.floor(rnd() * NIVEAUX.length)],
    infraction: NIVEAUX[Math.floor(rnd() * NIVEAUX.length)],
    positionVille: 'none',
    eclairage,
    /* `en_attente` : l'état d'un barrage que le commandement n'a pas encore
       arbitré. Semer des barrages « approuvés » ferait croire à une décision
       qui n'a jamais été prise. */
    statutBarrage: 'en_attente',
    decisionOptimisation: 'aucune',
    origineId: null,
    patrouilles: [],
    sousType,
    exceptionnel: false,
    missionId: null,
    viaAssistant: false,
    partage: false,
    bt: b.bt,
    cie: b.cie,
    reg: b.reg,
    lng,
    lat,
    auteur: AUTEUR,
    majPar: AUTEUR,
    cree: HORODATAGE,
    maj: HORODATAGE,
    demo: true,
  };
}

const nouveauxMarquages = [];
const sansEmplacement = [];
const compteMarquages = { barrage_fixe: 0, barrage_mobile: 0, accident: 0, zahma: 0 };

if (!SANS_BARRAGES) {
  /* Ce que chaque brigade tient déjà, par nature. */
  const dejaLa = new Map();
  for (const m of marquagesExistants) {
    if (!m.bt) continue;
    if (!dejaLa.has(m.bt)) dejaLa.set(m.bt, {});
    const c = dejaLa.get(m.bt);
    c[m.type] = (c[m.type] ?? 0) + 1;
  }

  for (const b of LISTE_BRIGADES) {
    const compte = dejaLa.get(b.bt) ?? {};
    const rnd = tirage(`marquages|${b.bt}`);
    const decideur = tirage(`part|${b.bt}`);

    /**
     * LES DEUX TIRAGES SONT FAITS D'ABORD, ET TOUJOURS.
     *
     * Écrits en ligne dans la condition (`compte.accident === 0 && decideur()
     * …`), ils n'étaient consommés que si le test précédent passait : au
     * deuxième passage, les brigades ayant reçu un point noir sautaient l'appel
     * et la CONGESTION héritait du tirage destiné au point noir. Le semis
     * reposait alors 96 congestions — un script annoncé idempotent qui ne
     * l'était pas. Un générateur déterministe ne tolère pas le court-circuit :
     * on tire, puis on décide.
     */
    const tireAccident = decideur() * 100 < PART_ACCIDENTS;
    const tireZahma = decideur() * 100 < PART_ZAHMA;

    /* Chaque brigade tient au moins un poste fixe et un poste mobile : c'est
       ce qui permet d'ouvrir n'importe quelle brigade en démonstration et d'y
       trouver quelque chose à montrer. */
    const voulu = [
      { type: 'barrage_fixe', manque: Math.max(0, 1 - (compte.barrage_fixe ?? 0)) },
      { type: 'barrage_mobile', manque: Math.max(0, 1 - (compte.barrage_mobile ?? 0)) },
      { type: 'accident', manque: (compte.accident ?? 0) === 0 && tireAccident ? 1 : 0 },
      { type: 'zahma', manque: (compte.zahma ?? 0) === 0 && tireZahma ? 1 : 0 },
    ];

    for (const { type, manque } of voulu) {
      for (let i = 0; i < manque; i++) {
        const id = idMarquage(b.bt, type, i);
        if (idsMarquages.has(id)) continue;

        const pt = pointDansBrigade(b, rnd);
        if (!pt) {
          sansEmplacement.push({ bt: b.bt, type });
          continue;
        }
        const [lng, lat] = arrondir(pt);

        /* Éclairage : une route sur trois est déclarée non éclairée — c'est
           précisément ce que le panneau Optimisation exploite pour signaler un
           point noir aggravé la nuit. */
        const eclairage =
          type === 'accident' || type === 'zahma'
            ? ECLAIRAGES[rnd() < 0.34 ? 2 : Math.floor(rnd() * 2)]
            : ECLAIRAGES[Math.floor(rnd() * ECLAIRAGES.length)];

        const nom =
          type === 'barrage_fixe'
            ? `Poste fixe ${b.bt} (DEMO)`
            : type === 'barrage_mobile'
              ? `Poste mobile ${b.bt} (DEMO)`
              : type === 'accident'
                ? `Point noir ${b.bt} (DEMO)`
                : `Congestion ${b.bt} (DEMO)`;

        const m = marquage({
          id,
          type,
          nom,
          lng,
          lat,
          b,
          rnd,
          accidentCount: type === 'accident' ? 3 + Math.floor(rnd() * 9) : 0,
          eclairage,
          sousType: type === 'zahma' ? SOUS_TYPES[Math.floor(rnd() * SOUS_TYPES.length)] : 'carrefour',
        });
        nouveauxMarquages.push(m);
        idsMarquages.add(id);
        compteMarquages[type]++;
      }
    }
  }
}

const marquagesFinal = [...marquagesExistants, ...nouveauxMarquages];

/* ================================================================== */
/* 2. EFFECTIF — chaque brigade au niveau que SES postes réclament    */
/* ================================================================== */

/** Numéro le plus haut déjà employé : les nouveaux matricules continuent la suite. */
let compteurMatricule = 0;
for (const p of [...personnesFictives, ...personnesReelles]) {
  const m = /^DEMO-(\d+)$/.exec(String(p.matricule ?? ''));
  if (m) compteurMatricule = Math.max(compteurMatricule, Number(m[1]));
}
const matriculesPris = new Set([...personnesFictives, ...personnesReelles].map((p) => p.matricule));

const prochainMatricule = () => {
  let m;
  do {
    m = `${PREFIXE}${String(++compteurMatricule).padStart(5, '0')}`;
  } while (matriculesPris.has(m));
  matriculesPris.add(m);
  return m;
};

/** Effectif par brigade, tous champs confondus — réel compris. */
const effectifParBt = new Map();
const gradesParBt = new Map();
for (const p of [...personnesReelles, ...personnesFictives]) {
  effectifParBt.set(p.bt, (effectifParBt.get(p.bt) ?? 0) + 1);
  if (!gradesParBt.has(p.bt)) gradesParBt.set(p.bt, {});
  const g = gradesParBt.get(p.bt);
  g[p.grade] = (g[p.grade] ?? 0) + 1;
}

/* ------------------------------------------------------------------ */
/* Le besoin, poste par poste, d'après la composition en vigueur       */
/* ------------------------------------------------------------------ */

const compositionCourante = chargerComposition(fichier('composition-barrage.json'));

/**
 * La composition applicable À CE SEMIS. Avec `--composition-demo`, le poste
 * fixe suit le profil de démonstration ; tout le reste vient du fichier, y
 * compris le barrage mobile, qui n'est pas touché.
 */
const compositionPour = (barrage) =>
  COMPOSITION_DEMO && barrage.type === 'barrage_fixe'
    ? COMPOSITION_FIXE_DEMO
    : compositionCourante.pour(barrage);

const postesParBt = new Map();
for (const m of marquagesFinal) {
  if (m.type !== 'barrage_fixe' && m.type !== 'barrage_mobile') continue;
  if (!m.bt) continue;
  if (!postesParBt.has(m.bt)) postesParBt.set(m.bt, []);
  postesParBt.get(m.bt).push(m);
}

const besoinParBt = new Map();
for (const b of LISTE_BRIGADES) {
  const mes = postesParBt.get(b.bt) ?? [];
  const besoin = parGradeVide();
  for (const poste of mes) {
    for (const c of compositionPour(poste)) besoin[c.grade] = (besoin[c.grade] ?? 0) + c.nombre;
  }
  besoinParBt.set(b.bt, { besoin, postes: mes.length });
}

/* ------------------------------------------------------------------ */
/* Ce qu'il faut créer                                                 */
/* ------------------------------------------------------------------ */

const nouvellesPersonnes = [];
const brigadesCompletees = [];
const brigadesDejaCible = [];
/** La projection, brigade par brigade — c'est elle que l'aperçu donne à lire. */
const projection = [];

for (const b of LISTE_BRIGADES) {
  const rnd = tirage(`effectif|${b.bt}`);
  const { besoin, postes } = besoinParBt.get(b.bt);
  const cible = cibleBrigade(besoin, postes);
  const dejaLa = gradesParBt.get(b.bt) ?? {};
  const present = effectifParBt.get(b.bt) ?? 0;

  /**
   * ON COMBLE, ON NE RETIRE PAS.
   *
   * Un grade déjà en surnombre par rapport à la cible reste tel quel : retirer
   * des personnes déjà présentes rendrait le semis destructeur, et l'effectif
   * final d'une brigade peut donc dépasser sa cible de quelques hommes. C'est
   * dit dans l'aperçu plutôt que corrigé en douce — `--reinitialiser` reste la
   * voie pour repartir exactement sur la cible.
   */
  const aCreer = [];
  for (const grade of GRADES_DESC) {
    const manque = Math.max(0, (cible[grade] ?? 0) - (dejaLa[grade] ?? 0));
    for (let i = 0; i < manque; i++) aCreer.push(grade);
  }

  const finalParGrade = parGradeVide();
  for (const g of GRADES_DESC) finalParGrade[g] = Math.max(dejaLa[g] ?? 0, cible[g] ?? 0);
  const finalTotal = GRADES_DESC.reduce((s, g) => s + finalParGrade[g], 0);

  projection.push({
    bt: b.bt,
    cie: b.cie,
    reg: b.reg,
    postes,
    fixes: (postesParBt.get(b.bt) ?? []).filter((m) => m.type === 'barrage_fixe').length,
    mobiles: (postesParBt.get(b.bt) ?? []).filter((m) => m.type === 'barrage_mobile').length,
    besoin,
    cible,
    present,
    dejaLa: { ...parGradeVide(), ...dejaLa },
    ajoutes: aCreer.length,
    finalParGrade,
    finalTotal,
    manqueCreneau: GRADES_DESC.reduce((s, g) => s + Math.max(0, besoin[g] - finalParGrade[g]), 0),
  });

  if (!aCreer.length) {
    brigadesDejaCible.push({ bt: b.bt, present });
    continue;
  }

  for (const grade of aCreer) {
    const personne = {
      matricule: prochainMatricule(),
      /**
       * « Youssef Bennani DEMO ». Prénom et nom vraisemblables pour que les
       * listes et les impressions ressemblent à ce qu'elles seront, le mot
       * DEMO en dernier pour qu'on ne puisse jamais prendre cette personne
       * pour un gendarme réel.
       */
      nom: `${PRENOMS[Math.floor(rnd() * PRENOMS.length)]} ${NOMS[Math.floor(rnd() * NOMS.length)]} DEMO`,
      grade,
      bt: b.bt,
      cie: b.cie,
      reg: b.reg,
      demo: true,
    };
    nouvellesPersonnes.push(personne);
    gradesParBt.set(b.bt, { ...(gradesParBt.get(b.bt) ?? {}), [grade]: ((gradesParBt.get(b.bt) ?? {})[grade] ?? 0) + 1 });
  }

  brigadesCompletees.push({ bt: b.bt, avant: present, ajoutes: aCreer.length });
}

const effectifFinal = [...personnesReelles, ...personnesFictives, ...nouvellesPersonnes];

/* ================================================================== */
/* Compte rendu à l'écran                                             */
/* ================================================================== */

const nf = (n) => n.toLocaleString('fr-FR');
const parGrade = {};
for (const p of effectifFinal) parGrade[p.grade] = (parGrade[p.grade] ?? 0) + 1;

const effectifFinalParBt = new Map();
for (const p of effectifFinal) effectifFinalParBt.set(p.bt, (effectifFinalParBt.get(p.bt) ?? 0) + 1);
const souscible = LISTE_BRIGADES
  .map((b) => ({ bt: b.bt, n: effectifFinalParBt.get(b.bt) ?? 0 }))
  .filter((x) => x.n < CIBLE);

console.log('');
console.log('SEMIS DU JEU DE DÉMONSTRATION');
console.log('='.repeat(78));
console.log(`Dossier          : ${DONNEES}  (mode ${marqueur.mode})`);
console.log(`Hiérarchie lue   : ${REGIONS.size} région(s) · ${COMPAGNIES.size} compagnie(s) · ${LISTE_BRIGADES.length} brigade(s)`);
console.log(`Effectif par brigade : variable — plancher ${CIBLE}, plafond ${PLAFOND}, réserve ${Math.round(RESERVE * 100)} %`);
console.log(`Composition du poste fixe : ${COMPOSITION_DEMO ? COMPOSITION_FIXE_DEMO.map((c) => `${c.nombre} ${c.grade}`).join(' + ') + '  (profil DÉMONSTRATION)' : compositionCourante.pour({ type: 'barrage_fixe' }).map((c) => `${c.nombre} ${c.grade}`).join(' + ') + '  (fichier inchangé)'}`);
console.log(`Composition du poste mobile : ${compositionCourante.pour({ type: 'barrage_mobile' }).map((c) => `${c.nombre} ${c.grade}`).join(' + ')}  (inchangée)`);
console.log('');
console.log('EFFECTIF');
console.log(`  déjà à leur cible    : ${nf(brigadesDejaCible.length)} brigade(s)`);
console.log(`  complétées           : ${nf(brigadesCompletees.length)} brigade(s)`);
console.log(`  personnes créées     : ${nf(nouvellesPersonnes.length)}`);
console.log(`  effectif final       : ${nf(effectifFinal.length)}  (dont ${nf(personnesReelles.length)} réel(s) intact(s))`);
console.log(`  par grade            : ${GRADES_DESC.map((g) => `${nf(parGrade[g] ?? 0)} ${g}`).join(' · ')}`);
console.log(`  brigades sous plancher : ${souscible.length}`);

/* Ce que la journée coûtera, et ce qui restera découvert : la même arithmétique
   que `scripts/analyser-effectif.mjs`, pour qu'on puisse comparer les deux. */
{
  const manqueCreneau = projection.reduce((s, x) => s + x.manqueCreneau, 0);
  const touchees = projection.filter((x) => x.manqueCreneau > 0);
  const effectifs = projection.map((x) => x.finalTotal).sort((a, b) => a - b);
  const besoinTotal = projection.reduce(
    (s, x) => s + GRADES_DESC.reduce((t, g) => t + x.besoin[g], 0), 0,
  );
  console.log('');
  console.log('DISPOSITIF FACE À L’EFFECTIF  (par créneau ; la journée en compte 4)');
  console.log(`  besoin des postes    : ${nf(besoinTotal)} hommes`);
  console.log(`  manque par créneau   : ${nf(manqueCreneau)}   → par journée : ${nf(manqueCreneau * 4)}`);
  console.log(`  brigades en manque   : ${touchees.length} / ${projection.length}`);
  console.log(`  effectif par brigade : de ${effectifs[0]} à ${effectifs[effectifs.length - 1]} (médiane ${effectifs[Math.floor(effectifs.length / 2)]})`);
  if (touchees.length) {
    console.log(
      `  les plus touchées    : ${[...touchees].sort((a, b) => b.manqueCreneau - a.manqueCreneau).slice(0, 8)
        .map((x) => `${x.bt} (${x.postes} postes, ${x.finalTotal} h., manque ${x.manqueCreneau * 4}/j)`).join(' · ')}`,
    );
  }
  const acHorsBornes = projection.filter((x) => x.finalParGrade['A/C'] < 1 || x.finalParGrade['A/C'] > 2);
  const adjtFaible = projection.filter((x) => x.finalParGrade.ADJT < 2);
  console.log(`  encadrement          : ${acHorsBornes.length} brigade(s) hors de 1–2 A/C · ${adjtFaible.length} sous 2 ADJT`);
}
if (fictivesOrphelines.length) {
  console.log(`  écartées (brigade inconnue) : ${nf(fictivesOrphelines.length)}`);
}
if (redresses.length) {
  console.log(`  rattachements redressés : ${nf(redresses.length)}  (cie/reg alignés sur la circonscription)`);
}
if (reelsMalRattaches.length) {
  console.log(`  ! ${nf(reelsMalRattaches.length)} personne(s) RÉELLE(S) mal rattachée(s) — signalées, non corrigées`);
}
console.log('');
console.log('MARQUAGES');
if (SANS_BARRAGES) {
  console.log('  ignorés (--sans-barrages)');
} else {
  console.log(`  barrages fixes créés : ${nf(compteMarquages.barrage_fixe)}`);
  console.log(`  barrages mobiles     : ${nf(compteMarquages.barrage_mobile)}`);
  console.log(`  points noirs         : ${nf(compteMarquages.accident)}`);
  console.log(`  congestions          : ${nf(compteMarquages.zahma)}`);
  console.log(`  total après semis    : ${nf(marquagesFinal.length)}`);
  if (sansEmplacement.length) {
    console.log(`  SANS EMPLACEMENT     : ${sansEmplacement.length} (circonscription non échantillonnable)`);
  }
}
console.log('');

/* ================================================================== */
/* Rapports — lisibles AVANT d'écrire quoi que ce soit                */
/* ================================================================== */

/**
 * LE RAPPORT S'ÉMET AUSSI EN APERÇU.
 *
 * Il ne l'était qu'après écriture : pour savoir ce que le semis allait faire,
 * il fallait le laisser le faire. C'est l'inverse de ce qu'on attend d'un
 * aperçu. La même fonction sert donc dans les deux cas et dit, en tête, si
 * elle décrit un PROJET ou un état enregistré.
 */
function emettreRapports(rosterResume) {
  const projete = rosterResume === null;

  if (PROJECTION) {
    const enTete = [
      'brigade', 'compagnie', 'region', 'postes', 'fixes', 'mobiles',
      ...GRADES_DESC.map((g) => `besoin_${g}`), 'besoin_total',
      ...GRADES_DESC.map((g) => `actuel_${g}`), 'actuel_total',
      ...GRADES_DESC.map((g) => `cible_${g}`),
      ...GRADES_DESC.map((g) => `final_${g}`), 'final_total',
      'a_creer', 'manque_creneau', 'manque_jour',
    ];
    const l = [enTete.join(',')];
    for (const x of projection) {
      l.push([
        `"${x.bt}"`, `"${x.cie ?? ''}"`, `"${x.reg ?? ''}"`, x.postes, x.fixes, x.mobiles,
        ...GRADES_DESC.map((g) => x.besoin[g]), GRADES_DESC.reduce((s2, g) => s2 + x.besoin[g], 0),
        ...GRADES_DESC.map((g) => x.dejaLa[g] ?? 0), x.present,
        ...GRADES_DESC.map((g) => x.cible[g]),
        ...GRADES_DESC.map((g) => x.finalParGrade[g]), x.finalTotal,
        x.ajoutes, x.manqueCreneau, x.manqueCreneau * 4,
      ].join(','));
    }
    const dest = resolve(PROJECTION);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, l.join('\n'), 'utf8');
    console.log(`projection : ${dest}`);
  }

  if (!RAPPORT) return;

  const manqueCreneau = projection.reduce((s2, x) => s2 + x.manqueCreneau, 0);
  const touchees = projection.filter((x) => x.manqueCreneau > 0);
  const tries = projection.map((x) => x.finalTotal).sort((a, b) => a - b);
  const besoinTotal = projection.reduce((s2, x) => s2 + GRADES_DESC.reduce((t, g) => t + x.besoin[g], 0), 0);
  const compoFixe = COMPOSITION_DEMO ? COMPOSITION_FIXE_DEMO : compositionCourante.pour({ type: 'barrage_fixe' });

  const l = [];
  l.push(projete
    ? '# Semis de démonstration — PROJET (aucune donnée écrite)'
    : '# Semis de démonstration — compte rendu');
  l.push('');
  l.push(`Dossier : \`${DONNEES}\` (mode ${marqueur.mode})`);
  l.push(`${projete ? 'Simulé' : 'Produit'} le ${new Date().toISOString()} par \`scripts/semer-demo.mjs\` (graine ${GRAINE}).`);
  if (projete) {
    l.push('');
    l.push('> **Aucun fichier de données n’a été modifié.** Ce document décrit ce que `--ecrire` produirait.');
  }
  l.push('');
  l.push('## Configuration');
  l.push('');
  l.push('| Réglage | Valeur |');
  l.push('| --- | --- |');
  l.push(`| Effectif par brigade | variable — plancher **${CIBLE}**, plafond **${PLAFOND}** |`);
  l.push(`| Réserve au-dessus du besoin | ${Math.round(RESERVE * 100)} % |`);
  l.push(`| Composition poste fixe | ${compoFixe.map((c) => `${c.nombre} ${c.grade}`).join(' + ')}${COMPOSITION_DEMO ? ' *(profil démonstration)*' : ''} |`);
  l.push(`| Composition poste mobile | ${compositionCourante.pour({ type: 'barrage_mobile' }).map((c) => `${c.nombre} ${c.grade}`).join(' + ')} *(inchangée)* |`);
  l.push('| Encadrement | 1 à 2 A/C, 2 ADJT au minimum |');
  l.push('');
  l.push('## Hiérarchie');
  l.push('');
  l.push('| Régions | Compagnies | Brigades |');
  l.push('| --- | --- | --- |');
  l.push(`| ${REGIONS.size} | ${COMPAGNIES.size} | ${LISTE_BRIGADES.length} |`);
  l.push('');
  l.push('## Effectif');
  l.push('');
  l.push(`- Personnes ${projete ? 'à créer' : 'créées ce passage'} : **${nf(nouvellesPersonnes.length)}**`);
  l.push(`- Effectif total${projete ? ' projeté' : ''} : **${nf(effectifFinal.length)}** (dont ${nf(personnesReelles.length)} non fictives)`);
  l.push(`- Brigades peuplées : **${effectifFinalParBt.size} / ${LISTE_BRIGADES.length}**`);
  l.push(`- Effectif par brigade : de **${tries[0]}** à **${tries[tries.length - 1]}**, médiane **${tries[Math.floor(tries.length / 2)]}**`);
  l.push(`- Brigades sous le plancher : **${souscible.length}**`);
  l.push(`- Par grade : ${GRADES_DESC.map((g) => `${nf(parGrade[g] ?? 0)} ${g}`).join(' · ')}`);
  l.push('');
  l.push('## Dispositif face à l’effectif');
  l.push('');
  l.push(`Besoin des ${nf(projection.reduce((s2, x) => s2 + x.postes, 0))} postes, **par créneau** : ${nf(besoinTotal)} hommes. La journée compte quatre créneaux, qu’une même personne peut tenir.`);
  l.push('');
  l.push('| | Valeur |');
  l.push('| --- | --- |');
  l.push(`| Manque par créneau | ${nf(manqueCreneau)} |`);
  l.push(`| **Manque par journée** | **${nf(manqueCreneau * 4)}** |`);
  l.push(`| Brigades en manque | ${touchees.length} / ${projection.length} |`);
  l.push('');
  if (touchees.length) {
    l.push('### Les brigades qui resteront en manque');
    l.push('');
    l.push('| Brigade | Postes | Effectif | Manque/créneau | Manque/jour |');
    l.push('| --- | --- | --- | --- | --- |');
    for (const x of [...touchees].sort((a, b) => b.manqueCreneau - a.manqueCreneau)) {
      l.push(`| ${x.bt} | ${x.postes} | ${x.finalTotal} | ${x.manqueCreneau} | ${x.manqueCreneau * 4} |`);
    }
    l.push('');
  }
  l.push('## Marquages');
  l.push('');
  l.push(`- Barrages fixes ${projete ? 'à créer' : 'créés'} : ${nf(compteMarquages.barrage_fixe)}`);
  l.push(`- Barrages mobiles : ${nf(compteMarquages.barrage_mobile)}`);
  l.push(`- Points noirs : ${nf(compteMarquages.accident)}`);
  l.push(`- Congestions : ${nf(compteMarquages.zahma)}`);
  l.push(`- Total après semis : ${nf(marquagesFinal.length)}`);
  l.push('');
  if (rosterResume) {
    l.push('## Relèves préparées');
    l.push('');
    l.push('| Journée | Lignes | Postes | Brigades | Sans effectif | Hommes manquants |');
    l.push('| --- | --- | --- | --- | --- | --- |');
    for (const r of rosterResume) {
      l.push(`| ${r.date} | ${nf(r.ajoutes)} | ${nf(r.barrages)} | ${nf(r.brigades)} | ${r.sansEffectif.length} | ${nf(r.manquesTotalHommes ?? 0)} |`);
    }
    l.push('');
  }
  l.push('## Effectif attendu, brigade par brigade');
  l.push('');
  l.push('| Brigade | Cie | Région | Postes | Besoin/créneau | Actuel | À créer | Final | A/C | ADJT | MDLC | MDLG | Manque/jour |');
  l.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const x of projection) {
    const bt = GRADES_DESC.reduce((s2, g) => s2 + x.besoin[g], 0);
    l.push(
      `| ${x.bt} | ${x.cie ?? ''} | ${x.reg ?? ''} | ${x.postes} | ${bt} | ${x.present} | ${x.ajoutes} | **${x.finalTotal}** | ` +
      `${x.finalParGrade['A/C']} | ${x.finalParGrade.ADJT} | ${x.finalParGrade.MDLC} | ${x.finalParGrade.MDLG} | ${x.manqueCreneau * 4} |`,
    );
  }
  l.push('');

  const dest = resolve(RAPPORT);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, l.join('\n'), 'utf8');
  console.log(`rapport : ${dest}`);
}

if (!ECRIRE) {
  emettreRapports(null);
  console.log('');
  console.log('APERÇU SEULEMENT — aucun fichier de données n’a été touché.');
  console.log('Pour appliquer : ajoutez --ecrire à la même commande.');
  console.log('');
  process.exit(0);
}

/* ================================================================== */
/* Écriture — sauvegarde d'abord                                      */
/* ================================================================== */

const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
const sauver = (nom) => {
  if (!existsSync(fichier(nom))) return;
  const dest = `${fichier(nom)}.avant-semis-${horodatage}`;
  copyFileSync(fichier(nom), dest);
  console.log(`Sauvegarde : ${dest}`);
};

const LISEZMOI =
  'DONNÉES DE DÉMONSTRATION. Chaque enregistrement porte demo:true. ' +
  'Ne jamais présenter comme réel, ne jamais verser en production. ' +
  'Produit par scripts/semer-demo.mjs — retrait par scripts/retirer-demo.mjs.';

sauver('effectifs.json');
ecrireJsonAtomique(
  fichier('effectifs.json'),
  {
    _lisezMoi: LISEZMOI,
    version: effectifsFichier.version ?? 1,
    demo: effectifFinal.some((p) => p.demo === true),
    items: effectifFinal,
  },
  2,
);
console.log(`effectifs.json : ${nf(effectifFinal.length)} personne(s) — ${nf(nouvellesPersonnes.length)} ajoutée(s)`);

if (!SANS_BARRAGES) {
  sauver('marquages.json');
  ecrireJsonAtomique(
    fichier('marquages.json'),
    {
      version: marquagesFichier.version ?? 1,
      items: marquagesFinal,
      demo: true,
      _lisezMoi: LISEZMOI,
    },
    2,
  );
  console.log(`marquages.json : ${nf(marquagesFinal.length)} marquage(s) — ${nf(nouveauxMarquages.length)} ajouté(s)`);
}

/**
 * LA COMPOSITION DU DOSSIER VISÉ, et de lui seul.
 *
 * `composition-barrage.json` vit DANS le dossier de données : `donnees-demo`,
 * `donnees-production` et `donnees-serveur` en ont chacun un exemplaire. Écrire
 * ici ne touche donc que la démonstration — et le garde-fou `mode.json`, vérifié
 * en tête de ce script, interdit déjà de viser autre chose.
 *
 * SEUL LE POSTE FIXE CHANGE. `parType.barrage_mobile` est recopié tel quel, et
 * `valideParLeCommandement` reste à `false` : un profil de démonstration n'est
 * pas une décision du commandement, et rien ici ne doit laisser croire qu'il
 * l'est.
 */
if (COMPOSITION_DEMO) {
  const brut = existsSync(fichier('composition-barrage.json'))
    ? JSON.parse(readFileSync(fichier('composition-barrage.json'), 'utf8'))
    : { version: 1 };

  sauver('composition-barrage.json');
  ecrireJsonAtomique(
    fichier('composition-barrage.json'),
    {
      ...brut,
      _profilDemonstration:
        'Poste fixe ramené à 1 ADJT + 2 MDLC + 3 MDLG par scripts/semer-demo.mjs ' +
        '(--composition-demo). La composition livrée demandait 1 A/C par poste fixe, ' +
        'ce qu\'aucune brigade réelle ne peut aligner : l\'A/C commande la brigade, ' +
        'il ne se tient pas sur chaque barrage. Ne concerne QUE ce dossier de démonstration.',
      valideParLeCommandement: false,
      defaut: COMPOSITION_FIXE_DEMO,
      parType: { ...(brut.parType ?? {}) },
    },
    2,
  );
  console.log(
    `composition-barrage.json : poste fixe → ${COMPOSITION_FIXE_DEMO.map((c) => `${c.nombre} ${c.grade}`).join(' + ')}` +
      '  (poste mobile inchangé)',
  );
}

/* ================================================================== */
/* 3. RELÈVES — la préparation du service, pas une seconde mécanique   */
/* ================================================================== */

let rosterResume = null;
if (!SANS_ROSTER) {
  mkdirSync(join(DONNEES, 'elements'), { recursive: true });

  const depotElements = creerDepotElements(fichier('elements.json'));
  const depotEffectifs = creerDepotEffectifs(fichier('effectifs.json'));
  /**
   * LA MÊME COMPOSITION QUE CELLE QUI A DIMENSIONNÉ L'EFFECTIF.
   *
   * Le fichier vient d'être réécrit si `--composition-demo` était demandé, donc
   * le relire suffit — mais on s'en assure par construction plutôt que par
   * confiance : dimensionner l'effectif sur un profil et répartir sur un autre
   * produirait un manque inexplicable, exactement le défaut qu'on corrige ici.
   */
  const compositionFichier = chargerComposition(fichier('composition-barrage.json'));
  const composition = {
    ...compositionFichier,
    pour: (barrage) =>
      COMPOSITION_DEMO && barrage?.type === 'barrage_fixe'
        ? COMPOSITION_FIXE_DEMO
        : compositionFichier.pour(barrage),
  };

  const AUTEUR_ROSTER = {
    matricule: 'SYSTEME',
    nom: 'Préparation automatique',
    role: 'commandement',
    rang: 'admin',
    unite: 'systeme',
    reg: null,
    cie: null,
  };

  rosterResume = [];
  for (const date of [dateLocale(new Date()), lendemain(new Date())]) {
    const r = preparerJournee({
      date,
      effectifs: depotEffectifs,
      barrages: marquagesFinal,
      composition,
      depotElements,
      auteur: AUTEUR_ROSTER,
      remplacer: true,
    });
    rosterResume.push({ date, ...r });
    console.log(
      `relèves ${date} : ${nf(r.ajoutes)} ligne(s) sur ${nf(r.barrages)} poste(s) de ${nf(r.brigades)} brigade(s)` +
        `  —  ${r.sansEffectif.length} brigade(s) sans effectif, ${nf(r.manquesTotalHommes ?? 0)} homme(s) manquant(s)`,
    );
  }
}

emettreRapports(rosterResume);

console.log('');
console.log('Fait. Redémarrez le service de démonstration pour qu’il relise les données :');
console.log('  npm run serve:demo');
console.log('');
console.log('Pour tout retirer : node scripts/retirer-demo.mjs --donnees donnees-demo --retirer');
console.log('');
