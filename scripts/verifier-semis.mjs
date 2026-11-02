#!/usr/bin/env node
/**
 * CONTRÔLE DU JEU DE DÉMONSTRATION SEMÉ — ce que le compte rendu affirme, ce
 * script le vérifie sur les fichiers eux-mêmes.
 *
 * Un semis qui annonce « 504 brigades peuplées » sans que personne ne relise
 * les fichiers n'annonce rien. Chaque contrôle ci-dessous lit `donnees-demo`
 * et la hiérarchie de référence, et ÉCHOUE bruyamment (code de sortie 1) au
 * premier écart.
 *
 * IL N'EST PAS DANS `prebuild`, volontairement : il suppose un jeu déjà semé,
 * que rien ne garantit sur un dépôt fraîchement récupéré, et un `npm run
 * build` qui échoue faute de données de démonstration serait un faux échec.
 * On l'appelle après un semis (`npm run check:semis`).
 *
 * CE QUI EST VÉRIFIÉ
 *   1. hiérarchie   chaque personne appartient à une brigade, une compagnie et
 *                   une région qui existent, et au bon triplet ;
 *   2. couverture   chaque brigade atteint la cible ;
 *   3. unicité      aucun matricule en double ;
 *   4. grades       aucun grade hors de ceux que le serveur accepte ;
 *   5. marquages    chaque marquage semé tombe DANS la circonscription de sa
 *                   brigade — sinon le serveur refuserait de le modifier ;
 *   6. relèves      chaque ligne vise un matricule et un barrage existants, et
 *                   personne ne tient deux postes dans le même créneau ;
 *   7. marque       tout enregistrement semé porte `demo: true`.
 *
 *   node scripts/verifier-semis.mjs
 *   node scripts/verifier-semis.mjs --donnees donnees-demo --cible 20
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dansGeometrie } from '../serveur/geo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-demo')));
const COUCHES = resolve(valeur('couches', join(ROOT, 'public/layers')));
const CIBLE = Math.max(1, Math.trunc(Number(valeur('cible', 20))));
const GRADES = ['MDLG', 'MDLC', 'ADJT', 'A/C'];

const fichier = (n) => join(DONNEES, n);
const lire = (n, d) => (existsSync(fichier(n)) ? JSON.parse(readFileSync(fichier(n), 'utf8')) : d);
const nf = (n) => n.toLocaleString('fr-FR');

const echecs = [];
const notes = [];
const controle = (nom, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(`${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* Références                                                         */
/* ------------------------------------------------------------------ */

const circo = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, { bt, cie: f.properties?.gr_cie ?? null, reg: f.properties?.gr_region ?? null, geometry: f.geometry });
}
const REGIONS = new Set([...BRIGADES.values()].map((b) => b.reg).filter(Boolean));
const COMPAGNIES = new Set([...BRIGADES.values()].map((b) => b.cie).filter(Boolean));

const effectifs = (lire('effectifs.json', { items: [] }).items ?? []);
const marquages = (lire('marquages.json', { items: [] }).items ?? []);

/** Les relèves sont réparties par journée, une ligne JSON par élément. */
const elements = [];
const dossierElements = join(DONNEES, 'elements');
if (existsSync(dossierElements)) {
  for (const nom of readdirSync(dossierElements).sort()) {
    if (!nom.endsWith('.jsonl')) continue;
    for (const ligne of readFileSync(join(dossierElements, nom), 'utf8').split('\n')) {
      const nu = ligne.trim();
      if (!nu) continue;
      try {
        elements.push({ ...JSON.parse(nu), _journee: nom.replace('.jsonl', '') });
      } catch {
        /* Une ligne illisible ne fait pas tomber la journée — même règle que le dépôt. */
      }
    }
  }
}

console.log('');
console.log('CONTRÔLE DU SEMIS DE DÉMONSTRATION');
console.log('='.repeat(78));
console.log(`Dossier    : ${DONNEES}`);
console.log(`Référence  : ${REGIONS.size} région(s) · ${COMPAGNIES.size} compagnie(s) · ${BRIGADES.size} brigade(s)`);
console.log(`Effectif   : ${nf(effectifs.length)} · marquages ${nf(marquages.length)} · relèves ${nf(elements.length)}`);
console.log('');

/* ------------------------------------------------------------------ */
/* 1. Hiérarchie                                                      */
/* ------------------------------------------------------------------ */

const mauvaisRattachement = [];
for (const p of effectifs) {
  const b = BRIGADES.get(p.bt);
  if (!b) {
    mauvaisRattachement.push(`${p.matricule} : brigade inconnue « ${p.bt} »`);
    continue;
  }
  if (p.cie !== b.cie || p.reg !== b.reg) {
    mauvaisRattachement.push(`${p.matricule} : ${p.bt} rattachée à ${p.cie}/${p.reg} au lieu de ${b.cie}/${b.reg}`);
  }
}
controle(
  'chaque personne relève d’une brigade, compagnie et région valides',
  mauvaisRattachement.length === 0,
  mauvaisRattachement.length ? `${mauvaisRattachement.length} écart(s), ex. ${mauvaisRattachement[0]}` : '',
);

/* ------------------------------------------------------------------ */
/* 2. Couverture                                                      */
/* ------------------------------------------------------------------ */

const parBt = new Map();
for (const p of effectifs) parBt.set(p.bt, (parBt.get(p.bt) ?? 0) + 1);

const vides = [...BRIGADES.keys()].filter((bt) => !parBt.get(bt));
const sousCible = [...BRIGADES.keys()].filter((bt) => (parBt.get(bt) ?? 0) > 0 && (parBt.get(bt) ?? 0) < CIBLE);

controle('aucune brigade vide', vides.length === 0, vides.length ? `${vides.length} : ${vides.slice(0, 5).join(', ')}` : `${BRIGADES.size} peuplées`);
controle(
  `chaque brigade atteint la cible de ${CIBLE}`,
  sousCible.length === 0,
  sousCible.length ? `${sousCible.length} sous la cible : ${sousCible.slice(0, 5).map((b) => `${b} (${parBt.get(b)})`).join(', ')}` : '',
);

/* ------------------------------------------------------------------ */
/* 3. Unicité                                                         */
/* ------------------------------------------------------------------ */

const vus = new Set();
const doublons = [];
for (const p of effectifs) {
  if (vus.has(p.matricule)) doublons.push(p.matricule);
  vus.add(p.matricule);
}
controle('aucun matricule en double', doublons.length === 0, doublons.length ? `${doublons.length}, ex. ${doublons[0]}` : `${nf(vus.size)} distincts`);

/* ------------------------------------------------------------------ */
/* 4. Grades                                                          */
/* ------------------------------------------------------------------ */

const gradesInconnus = [...new Set(effectifs.map((p) => p.grade).filter((g) => !GRADES.includes(g)))];
controle('aucun grade hors nomenclature', gradesInconnus.length === 0, gradesInconnus.join(', '));

const repartition = {};
for (const p of effectifs) repartition[p.grade] = (repartition[p.grade] ?? 0) + 1;
const gradesParBrigade = new Map();
for (const p of effectifs) {
  if (!gradesParBrigade.has(p.bt)) gradesParBrigade.set(p.bt, new Set());
  gradesParBrigade.get(p.bt).add(p.grade);
}
const pyramidesIdentiques = new Set(
  [...BRIGADES.keys()].map((bt) => {
    const c = {};
    for (const p of effectifs) if (p.bt === bt) c[p.grade] = (c[p.grade] ?? 0) + 1;
    return GRADES.map((g) => c[g] ?? 0).join('/');
  }),
);
controle(
  'la pyramide des grades varie d’une brigade à l’autre',
  pyramidesIdentiques.size > 1,
  `${pyramidesIdentiques.size} pyramide(s) distincte(s)`,
);

/* ------------------------------------------------------------------ */
/* 5. Marquages                                                       */
/* ------------------------------------------------------------------ */

const semes = marquages.filter((m) => typeof m.id === 'string' && m.id.startsWith('mq_semis_'));
const horsCirconscription = [];
const btInconnu = [];
for (const m of semes) {
  const b = BRIGADES.get(m.bt);
  if (!b) {
    btInconnu.push(m.id);
    continue;
  }
  if (!dansGeometrie([m.lng, m.lat], b.geometry)) horsCirconscription.push(`${m.id} (${m.bt})`);
}
controle('chaque marquage semé vise une brigade connue', btInconnu.length === 0, btInconnu.slice(0, 3).join(', '));
controle(
  'chaque marquage semé tombe dans sa circonscription',
  horsCirconscription.length === 0,
  horsCirconscription.length ? `${horsCirconscription.length}, ex. ${horsCirconscription[0]}` : `${nf(semes.length)} contrôlé(s)`,
);

const barrages = marquages.filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile');
const btAvecBarrage = new Set(barrages.map((m) => m.bt));
const sansBarrage = [...BRIGADES.keys()].filter((bt) => !btAvecBarrage.has(bt));
controle('chaque brigade tient au moins un barrage', sansBarrage.length === 0, sansBarrage.length ? `${sansBarrage.length} sans` : `${nf(barrages.length)} barrage(s)`);

const nonMarques = semes.filter((m) => m.demo !== true);
controle('tout marquage semé porte demo:true', nonMarques.length === 0, nonMarques.length ? `${nonMarques.length} sans la marque` : '');

/* ------------------------------------------------------------------ */
/* 6. Relèves                                                         */
/* ------------------------------------------------------------------ */

const matricules = new Set(effectifs.map((p) => p.matricule));
const idsBarrages = new Set(barrages.map((m) => m.id));

/**
 * CE QUE LE SEMIS PRÉPARE, ET CE QU'IL HÉRITE — deux choses différentes.
 *
 * Le semis prépare la journée du jour et celle du lendemain ; tout ce qui
 * précède est de l'ARCHIVE, écrite avant lui, et qui cite parfois un barrage
 * depuis effacé. Exiger la même cohérence des deux reviendrait à demander au
 * semis de réécrire l'histoire — ce qu'il ne fait pas, par principe.
 *
 * Les journées préparées sont donc contrôlées STRICTEMENT ; les archives sont
 * auditées à part et rapportées en note, jamais en échec.
 */
const deuxChiffres = (n) => String(n).padStart(2, '0');
const jour = (d) => `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
const maintenant = new Date();
const JOURNEES = String(
  valeur('journees', [jour(maintenant), jour(new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + 1))].join(',')),
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const journeesPreparees = JOURNEES.filter((j) => elements.some((e) => e._journee === j));
const recentes = elements.filter((e) => journeesPreparees.includes(e._journee));

const matriculeOrphelin = recentes.filter((e) => e.matricule && !matricules.has(e.matricule));
const barrageOrphelin = recentes.filter((e) => e.barrageId && !idsBarrages.has(e.barrageId));
controle(
  'chaque relève préparée vise un matricule existant',
  matriculeOrphelin.length === 0,
  matriculeOrphelin.length ? `${nf(matriculeOrphelin.length)} orpheline(s), ex. ${matriculeOrphelin[0].matricule}` : `${nf(recentes.length)} ligne(s)`,
);
controle(
  'chaque relève préparée vise un barrage existant',
  barrageOrphelin.length === 0,
  barrageOrphelin.length ? `${nf(barrageOrphelin.length)} orpheline(s), ex. ${barrageOrphelin[0].barrageId}` : '',
);

/**
 * AUCUNE LIGNE EN DOUBLE — le contrôle qui atteste que relancer le semis ne
 * recopie rien.
 *
 * La préparation réécrit la journée à chaque passage, et chaque ligne reçoit
 * alors un `id` et un `saisiLe` neufs : comparer les fichiers octet à octet
 * dirait « différents » sans que rien n'ait bougé. Ce qui doit être stable,
 * c'est l'AFFECTATION — qui tient quel poste, quel jour, à quel créneau.
 */
const clesAffectation = new Set();
const lignesDupliquees = [];
for (const e of recentes) {
  const cle = `${e.date}|${e.creneau}|${e.barrageId}|${e.matricule}`;
  if (clesAffectation.has(cle)) lignesDupliquees.push(cle);
  clesAffectation.add(cle);
}
controle(
  'aucune affectation en double dans une journée préparée',
  lignesDupliquees.length === 0,
  lignesDupliquees.length ? `${nf(lignesDupliquees.length)}, ex. ${lignesDupliquees[0]}` : `${nf(clesAffectation.size)} affectation(s) distincte(s)`,
);

/* Personne ne tient deux postes en même temps : la clé est (journée, créneau,
   matricule). C'est la règle que `repartir` applique — on la vérifie sur le
   résultat écrit, pas sur l'intention. */
const occupation = new Map();
const cumuls = [];
for (const e of recentes) {
  if (!e.matricule) continue;
  const cle = `${e.date}|${e.creneau}|${e.matricule}`;
  if (occupation.has(cle) && occupation.get(cle) !== e.barrageId) cumuls.push(cle);
  occupation.set(cle, e.barrageId);
}
controle('personne n’est affecté à deux postes dans le même créneau', cumuls.length === 0, cumuls.length ? `${cumuls.length}, ex. ${cumuls[0]}` : '');

controle(
  'les journées attendues ont bien été préparées',
  journeesPreparees.length === JOURNEES.length,
  journeesPreparees.length === JOURNEES.length
    ? journeesPreparees.join(', ')
    : `manquante(s) : ${JOURNEES.filter((j) => !journeesPreparees.includes(j)).join(', ')}`,
);

/* Audit des archives — rapporté, jamais fatal. */
const archives = [...new Set(elements.map((e) => e._journee))].filter((j) => !journeesPreparees.includes(j)).sort();
if (archives.length) {
  const lignesArchives = elements.filter((e) => archives.includes(e._journee));
  const barragesDisparus = lignesArchives.filter((e) => e.barrageId && !idsBarrages.has(e.barrageId));
  const matriculesDisparus = lignesArchives.filter((e) => e.matricule && !matricules.has(e.matricule));
  const occA = new Map();
  let cumulsArchives = 0;
  for (const e of lignesArchives) {
    if (!e.matricule) continue;
    const cle = `${e.date}|${e.creneau}|${e.matricule}`;
    if (occA.has(cle) && occA.get(cle) !== e.barrageId) cumulsArchives++;
    occA.set(cle, e.barrageId);
  }
  notes.push(
    `Archives (${archives.join(', ')}) : ${nf(lignesArchives.length)} ligne(s) antérieure(s) au semis — ` +
      `${nf(barragesDisparus.length)} vers un barrage effacé, ${nf(matriculesDisparus.length)} vers un matricule inconnu, ` +
      `${nf(cumulsArchives)} cumul(s) de créneau. Conservées telles quelles : c'est de l'historique, pas du semis.`,
  );
}

/* ------------------------------------------------------------------ */
/* 7. Marque du fictif                                                */
/* ------------------------------------------------------------------ */

const fictifsSansDrapeau = effectifs.filter((p) => String(p.matricule).startsWith('DEMO-') && p.demo !== true);
controle('toute personne DEMO- porte demo:true', fictifsSansDrapeau.length === 0, fictifsSansDrapeau.length ? `${fictifsSansDrapeau.length}` : '');

const nonFictifs = effectifs.filter((p) => p.demo !== true);
if (nonFictifs.length) notes.push(`${nf(nonFictifs.length)} personne(s) sans la marque demo — effectif réel, laissé intact.`);

/* ------------------------------------------------------------------ */

console.log('');
console.log(`Répartition : ${GRADES.slice().reverse().map((g) => `${nf(repartition[g] ?? 0)} ${g}`).join(' · ')}`);
const parType = {};
for (const m of marquages) parType[m.type] = (parType[m.type] ?? 0) + 1;
console.log(`Marquages   : ${Object.entries(parType).map(([t, n]) => `${nf(n)} ${t}`).join(' · ')}`);
for (const n of notes) console.log(`Note        : ${n}`);
console.log('');

if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}

console.log('Tous les contrôles passent.');
console.log('');
