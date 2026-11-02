#!/usr/bin/env node
/**
 * EFFECTIF FICTIF DE DÉMONSTRATION — pour éprouver la mécanique de SAISIE
 * TERRAIN tant que l'effectif réel n'est pas disponible.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Le projet ne contient AUCUN effectif nominatif : `comptes.json` ne porte que
 * des comptes de connexion — un par unité, 504 chefs de brigade — sans grade ni
 * gendarme individuel. Impossible, donc, de préparer un roster à partir de
 * l'existant. Cet effectif est fabriqué pour développer et démontrer, et pour
 * cela seulement.
 *
 * TOUT EST MARQUÉ, DEUX FOIS PLUTÔT QU'UNE
 * ----------------------------------------
 *   `demo: true`            le drapeau que lit le code ;
 *   matricule `DEMO-xxxxx`  la marque qui saute aux yeux dans une liste, à
 *                           l'écran comme sur un tirage papier.
 *
 * La redondance est délibérée : un drapeau seul se perd dans un export, un
 * préfixe seul se contourne dans une requête. Ensemble, on ne peut pas prendre
 * une de ces personnes pour un gendarme réel.
 *
 * REPRODUCTIBLE : aucun tirage au hasard. Les noms, les grades et les effectifs
 * se déduisent du nom de la brigade par une empreinte stable — relancer le
 * script produit exactement le même effectif, et deux postes qui le relancent
 * obtiennent la même chose.
 *
 * VOLUME DÉDUIT DES POSTES, PAS D'UN NOMBRE CHOISI
 * ------------------------------------------------
 * Une première version peuplait trois régions avec vingt à trente-sept hommes
 * par brigade. Résultat : 362 brigades sur 391 restaient vides, et cliquer un
 * barrage au hasard donnait « 0/6 — personne sur ce poste ». Une démonstration
 * qui ne montre rien ne démontre rien.
 *
 * L'effectif d'une brigade se calcule donc à partir de ce que SES postes
 * demandent, grade par grade, d'après `composition-barrage.json` :
 *
 *     effectif(brigade) = Σ composition(poste)  +  réserve
 *
 * Une personne peut tenir un poste à chacun des quatre créneaux — c'est la
 * règle du dépôt, pas une invention d'ici — donc couvrir un créneau suffit à
 * couvrir la journée. La réserve alimente les « non affectés » et permet la
 * rotation d'un créneau à l'autre.
 *
 * CONSÉQUENCE À CONNAÎTRE : la composition déclarée demande un A/C par barrage
 * fixe. Une brigade qui tient trente-six barrages reçoit donc trente-six A/C,
 * ce qu'aucune brigade réelle n'a. C'est le reflet fidèle de la composition
 * telle qu'elle est écrite, pas une fantaisie du générateur — et le jour où
 * cette composition sera revue, l'effectif suivra.
 *
 *   node scripts/fake-effectifs.mjs                aperçu, n'écrit rien
 *   node scripts/fake-effectifs.mjs --ecrire       enregistre
 *   node scripts/fake-effectifs.mjs --retirer      efface le fictif, et lui seul
 *
 * Options :
 *   --regions <a,b,c>   restreindre à certaines régions (défaut : tout le pays)
 *   --reserve <n>       réserve en % au-dessus du besoin  (défaut 15)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = join(ROOT, 'donnees-serveur/effectifs.json');
const MARQUAGES = join(ROOT, 'donnees-serveur/marquages.json');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

/* Vide = tout le pays. Une liste restreint, pour un jeu de démonstration
   plus léger si on le souhaite. */
const REGIONS = String(valeur('regions', ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** Au-dessus du besoin strict : la réserve et la rotation entre créneaux. */
const RESERVE = Math.max(0, Number(valeur('reserve', 15))) / 100;

const COMPOSITION = join(ROOT, 'donnees-serveur/composition-barrage.json');

/** Marque du fictif — un seul endroit, pour que `--retirer` ne se trompe pas. */
const PREFIXE = 'DEMO-';

/* ------------------------------------------------------------------ */
/* Retrait                                                            */
/* ------------------------------------------------------------------ */

if (drapeau('retirer')) {
  if (!existsSync(FICHIER)) {
    console.log('\nAucun effectif enregistré : rien à retirer.\n');
    process.exit(0);
  }
  const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
  const avant = (depot.items ?? []).length;
  /* On n'efface QUE le fictif : un effectif réel chargé entre-temps survit. */
  depot.items = (depot.items ?? []).filter((p) => p.demo !== true && !p.matricule?.startsWith(PREFIXE));
  depot.demo = depot.items.some((p) => p.demo === true);
  writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');
  console.log(`\n${avant - depot.items.length} personne(s) fictive(s) retirée(s).`);
  console.log(`${depot.items.length} personne(s) conservée(s) — effectif réel, s'il y en a.\n`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Vocabulaire                                                        */
/* ------------------------------------------------------------------ */

/**
 * Noms et prénoms marocains courants. Ils ne désignent personne : ce sont les
 * patronymes les plus répandus du pays, assemblés par une empreinte.
 */
const PRENOMS = [
  'Mohamed', 'Ahmed', 'Youssef', 'Hassan', 'Karim', 'Rachid', 'Said', 'Abdellah',
  'Mustapha', 'Omar', 'Khalid', 'Anas', 'Yassine', 'Hamza', 'Brahim', 'Noureddine',
  'Abderrahim', 'Jamal', 'Tarik', 'Adil', 'Mehdi', 'Reda', 'Soufiane', 'Ayoub',
  'Hicham', 'Mounir', 'Nabil', 'Aziz', 'Driss', 'Fouad',
];
const NOMS = [
  'Alaoui', 'Bennani', 'Cherkaoui', 'El Amrani', 'Benjelloun', 'Tazi', 'Idrissi',
  'El Fassi', 'Berrada', 'Lahlou', 'Sqalli', 'Bouazza', 'Ouazzani', 'Naciri',
  'El Hachimi', 'Skalli', 'Chraibi', 'Belkadi', 'Sebti', 'Kettani', 'El Ghazi',
  'Amrani', 'Bekkali', 'Hajji', 'Moutawakil', 'Rifai', 'Sadiki', 'Zerouali',
  'Benkirane', 'El Malki',
];

/** Empreinte stable d'une chaîne — remplace tout tirage au hasard. */
function empreinte(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * PYRAMIDE DES GRADES d'une brigade — plausible, et non calquée sur le nombre
 * de barrages.
 *
 * Une brigade territoriale compte UN adjudant-chef, deux ou trois adjudants,
 * une poignée de maréchaux des logis-chefs, et le reste en maréchaux des logis.
 * On ne fabrique pas un encadrement sur mesure pour que la composition type
 * tombe juste : c'est justement la tension entre cette pyramide et la
 * composition demandée qui doit se voir à l'écran, poste par poste.
 */
/**
 * CE QU'UNE BRIGADE DOIT POUVOIR ALIGNER, grade par grade.
 *
 * Somme des compositions de ses postes, plus la réserve. Calculé grade par
 * grade et non sur un total : trois MDLG de plus ne remplacent pas l'A/C qui
 * manque, et un poste incomplet reste incomplet.
 */
function besoinParGrade(postes, composition) {
  const besoin = { 'A/C': 0, ADJT: 0, MDLC: 0, MDLG: 0 };
  for (const type of postes) {
    const compo = composition.parType?.[type] ?? composition.defaut;
    for (const c of compo) besoin[c.grade] = (besoin[c.grade] ?? 0) + c.nombre;
  }
  /* Réserve : au moins une personne par grade utilisé, sinon le moindre absent
     laisse un poste découvert et la démonstration montre un trou. */
  for (const g of Object.keys(besoin)) {
    if (besoin[g] > 0) besoin[g] += Math.max(1, Math.round(besoin[g] * RESERVE));
  }
  return besoin;
}

/* ------------------------------------------------------------------ */
/* Brigades à peupler                                                 */
/* ------------------------------------------------------------------ */

const items = JSON.parse(readFileSync(MARQUAGES, 'utf8')).items ?? [];
const barrages = items.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');

/** Une brigade n'est peuplée que si elle tient au moins un barrage. */
const composition = JSON.parse(readFileSync(COMPOSITION, 'utf8'));

const parBt = new Map();
for (const m of barrages) {
  if (REGIONS.length && !REGIONS.includes(m.reg)) continue;
  if (!m.bt) continue;
  if (!parBt.has(m.bt)) {
    parBt.set(m.bt, { bt: m.bt, reg: m.reg, cie: m.cie, barrages: 0, postes: [] });
  }
  const e = parBt.get(m.bt);
  e.barrages++;
  e.postes.push(m.type);
}
const brigades = [...parBt.values()].sort((a, b) => a.bt.localeCompare(b.bt, 'fr'));

if (!brigades.length) {
  console.error(
    `\nAucune brigade avec barrage${REGIONS.length ? ` dans : ${REGIONS.join(', ')}` : ''}.\n`
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Fabrication                                                        */
/* ------------------------------------------------------------------ */

const personnes = [];
let compteur = 1;

for (const b of brigades) {
  const pyr = besoinParGrade(b.postes, composition);
  b.effectif = Object.values(pyr).reduce((s, n) => s + n, 0);
  b.pyramide = pyr;

  for (const [grade, combien] of Object.entries(pyr)) {
    for (let i = 0; i < combien; i++) {
      const graine = empreinte(`${b.bt}|${grade}|${i}`);
      personnes.push({
        matricule: `${PREFIXE}${String(compteur++).padStart(5, '0')}`,
        /**
         * « Ahmed DEMO », pas « Ahmed Benkirane ».
         *
         * Un patronyme vraisemblable finit par être pris pour un vrai : on le
         * recopie dans un compte rendu, il ressort dans un export, et plus
         * personne ne sait d'où il vient. Le mot DEMO dans le nom rend la
         * confusion impossible — c'est le but, pas une négligence de style.
         */
        nom: `${PRENOMS[graine % PRENOMS.length]} DEMO`,
        grade,
        bt: b.bt,
        cie: b.cie,
        reg: b.reg,
        demo: true,
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Compte rendu                                                       */
/* ------------------------------------------------------------------ */

const parGrade = {};
for (const p of personnes) parGrade[p.grade] = (parGrade[p.grade] ?? 0) + 1;

console.log('');
console.log('EFFECTIF FICTIF DE DÉMONSTRATION');
console.log('='.repeat(78));
console.log(`Régions peuplées : ${REGIONS.length ? REGIONS.join(', ') : 'tout le pays'}`);
console.log(`Brigades         : ${brigades.length} (celles qui tiennent au moins un barrage)`);
console.log(`Personnes        : ${personnes.length}  —  toutes en « ${PREFIXE}… » et demo: true`);
console.log(`Par grade        : ${Object.entries(parGrade).map(([g, n]) => `${n} ${g}`).join(' · ')}`);
console.log('');
console.log(`  ${'Brigade'.padEnd(26)} ${'barr.'.padStart(5)} ${'eff.'.padStart(5)}   pyramide`);
for (const b of brigades) {
  const eff = personnes.filter((p) => p.bt === b.bt);
  const pyr = {};
  for (const p of eff) pyr[p.grade] = (pyr[p.grade] ?? 0) + 1;
  console.log(
    `  ${b.bt.slice(0, 26).padEnd(26)} ${String(b.barrages).padStart(5)} ${String(eff.length).padStart(5)}   ` +
      ['A/C', 'ADJT', 'MDLC', 'MDLG'].map((g) => `${pyr[g] ?? 0} ${g}`).join(' · ')
  );
}

if (!drapeau('ecrire')) {
  console.log('');
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour enregistrer.');
  console.log('');
  process.exit(0);
}

/* Un effectif réel déjà chargé n'est jamais écrasé : on ne remplace que le fictif. */
const existant = existsSync(FICHIER) ? JSON.parse(readFileSync(FICHIER, 'utf8')) : { items: [] };
const reels = (existant.items ?? []).filter((p) => p.demo !== true && !p.matricule?.startsWith(PREFIXE));

writeFileSync(
  FICHIER,
  JSON.stringify(
    {
      _lisezMoi:
        'Effectif nominatif. Les personnes marquées demo:true sont FICTIVES ' +
        '(voir scripts/fake-effectifs.mjs) et se retirent avec --retirer.',
      version: 1,
      demo: personnes.length > 0,
      items: [...reels, ...personnes],
    },
    null,
    2
  ),
  'utf8'
);

console.log('');
console.log(`${personnes.length} personne(s) fictive(s) enregistrée(s) dans ${FICHIER}`);
if (reels.length) console.log(`${reels.length} personne(s) réelle(s) conservée(s) intactes.`);
console.log('Pour tout retirer : node scripts/fake-effectifs.mjs --retirer');
console.log('');
