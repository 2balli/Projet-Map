#!/usr/bin/env node
/**
 * D'OÙ VIENNENT LES 6 120 HOMMES MANQUANTS — analyse, sans rien écrire dans
 * les données.
 *
 * Le semis annonce, pour chaque journée préparée : « 6 120 homme(s)
 * manquant(s) ». Ce script recalcule ce nombre à partir des mêmes fichiers et
 * des mêmes règles que `serveur/roster.mjs`, pour dire EXACTEMENT ce qui le
 * produit — quel grade, quelle brigade, quel poste — et ce que coûterait de le
 * ramener à zéro.
 *
 * LE MODÈLE, EN UNE LIGNE
 * -----------------------
 *   besoin d'une brigade, PAR CRÉNEAU = Σ composition(poste) sur ses postes
 *
 * Et la journée compte QUATRE créneaux (`CRENEAUX = [0, 6, 12, 18]`). Une même
 * personne peut tenir un poste à chacun des quatre — `repartir` est appelée une
 * fois par créneau avec l'effectif ENTIER de la brigade, le vivier se reconstitue
 * à chaque appel. Le manque d'une journée est donc quatre fois le manque d'un
 * créneau, et non un manque cumulé sur des personnes épuisées.
 *
 * CE SCRIPT N'ÉCRIT QUE SON RAPPORT. Aucune donnée n'est touchée.
 *
 *   node scripts/analyser-effectif.mjs
 *   node scripts/analyser-effectif.mjs --rapport artifacts/analyse-effectif.md
 *   node scripts/analyser-effectif.mjs --csv artifacts/    (deux tableaux détaillés)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerComposition } from '../serveur/roster.mjs';
import { CRENEAUX, GRADES } from '../serveur/elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-demo')));
const COUCHES = resolve(valeur('couches', join(ROOT, 'public/layers')));
const RAPPORT = valeur('rapport', null);
const CSV = valeur('csv', null);

const fichier = (n) => join(DONNEES, n);
const nf = (n) => Number(n).toLocaleString('fr-FR');
/** Du plus élevé au moins élevé — l'ordre dans lequel `repartir` sert. */
const ORDRE = [...GRADES].reverse();

/* ------------------------------------------------------------------ */
/* Lecture                                                            */
/* ------------------------------------------------------------------ */

const effectifs = JSON.parse(readFileSync(fichier('effectifs.json'), 'utf8')).items ?? [];
const marquages = JSON.parse(readFileSync(fichier('marquages.json'), 'utf8')).items ?? [];
const composition = chargerComposition(fichier('composition-barrage.json'));

const circo = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const BRIGADES = new Map();
for (const f of circo.features ?? []) {
  const bt = f.properties?.gr_bde;
  if (!bt || BRIGADES.has(bt)) continue;
  BRIGADES.set(bt, { bt, cie: f.properties?.gr_cie ?? null, reg: f.properties?.gr_region ?? null });
}

const postes = marquages.filter((m) => (m.type === 'barrage_fixe' || m.type === 'barrage_mobile') && m.bt);

/* ------------------------------------------------------------------ */
/* Besoin et disponible, brigade par brigade                          */
/* ------------------------------------------------------------------ */

const vide = () => Object.fromEntries(ORDRE.map((g) => [g, 0]));

const postesParBt = new Map();
for (const p of postes) {
  if (!postesParBt.has(p.bt)) postesParBt.set(p.bt, []);
  postesParBt.get(p.bt).push(p);
}

const effectifParBt = new Map();
for (const p of effectifs) {
  if (!effectifParBt.has(p.bt)) effectifParBt.set(p.bt, vide());
  const c = effectifParBt.get(p.bt);
  if (c[p.grade] !== undefined) c[p.grade]++;
}

/** Le détail d'un poste : ce que la composition lui demande, grade par grade. */
const detailPostes = [];
const lignes = [];

for (const bt of [...BRIGADES.keys()].sort((a, b) => a.localeCompare(b, 'fr'))) {
  const info = BRIGADES.get(bt);
  const mes = postesParBt.get(bt) ?? [];
  const dispo = effectifParBt.get(bt) ?? vide();

  const besoin = vide();
  let fixes = 0;
  let mobiles = 0;

  for (const p of mes) {
    const compo = composition.pour(p);
    const parGrade = vide();
    for (const c of compo) parGrade[c.grade] = (parGrade[c.grade] ?? 0) + c.nombre;
    for (const g of ORDRE) besoin[g] += parGrade[g];
    if (p.type === 'barrage_fixe') fixes++;
    else mobiles++;

    detailPostes.push({
      bt,
      cie: info.cie,
      reg: info.reg,
      id: p.id,
      nom: p.nom || '(sans nom)',
      type: p.type,
      ...parGrade,
      total: ORDRE.reduce((s, g) => s + parGrade[g], 0),
    });
  }

  /* Le manque se compte GRADE PAR GRADE : trois MDLG en trop ne comblent pas
     l'A/C qui manque — c'est la règle de `repartir`, pas une convention d'ici. */
  const manque = vide();
  for (const g of ORDRE) manque[g] = Math.max(0, besoin[g] - dispo[g]);
  const manqueCreneau = ORDRE.reduce((s, g) => s + manque[g], 0);

  lignes.push({
    bt,
    cie: info.cie,
    reg: info.reg,
    fixes,
    mobiles,
    postes: mes.length,
    besoin,
    dispo,
    manque,
    besoinTotal: ORDRE.reduce((s, g) => s + besoin[g], 0),
    dispoTotal: ORDRE.reduce((s, g) => s + dispo[g], 0),
    manqueCreneau,
    manqueJour: manqueCreneau * CRENEAUX.length,
  });
}

/* ------------------------------------------------------------------ */
/* Totaux                                                             */
/* ------------------------------------------------------------------ */

const totalBesoin = vide();
const totalDispo = vide();
const totalManque = vide();
for (const l of lignes) {
  for (const g of ORDRE) {
    totalBesoin[g] += l.besoin[g];
    totalDispo[g] += l.dispo[g];
    totalManque[g] += l.manque[g];
  }
}
const manqueCreneau = ORDRE.reduce((s, g) => s + totalManque[g], 0);
const manqueJour = manqueCreneau * CRENEAUX.length;

const avecManque = lignes.filter((l) => l.manqueCreneau > 0);
const sansManque = lignes.filter((l) => l.manqueCreneau === 0);

/* Combien de brigades seraient servies par tel effectif uniforme ? */
const seuilPourZero = (l) => Math.max(l.besoinTotal, 0);
const besoins = lignes.map(seuilPourZero).sort((a, b) => a - b);
const mediane = besoins[Math.floor(besoins.length / 2)];

/* ------------------------------------------------------------------ */
/* Scénarios                                                          */
/* ------------------------------------------------------------------ */

/**
 * SCÉNARIO « VARIABLE » : chaque brigade reçoit ce que SES postes demandent,
 * grade par grade, plus une réserve. C'est la règle de `fake-effectifs.mjs`,
 * réévaluée ici sur le dispositif complet (1 566 postes au lieu de 1 122).
 */
const RESERVE = Number(valeur('reserve', 15)) / 100;
const scenarioVariable = lignes.map((l) => {
  const cible = vide();
  for (const g of ORDRE) {
    cible[g] = l.besoin[g] > 0 ? l.besoin[g] + Math.max(1, Math.round(l.besoin[g] * RESERVE)) : 0;
  }
  return { bt: l.bt, cible, total: ORDRE.reduce((s, g) => s + cible[g], 0), besoinTotal: l.besoinTotal };
});
const totalVariable = scenarioVariable.reduce((s, x) => s + x.total, 0);
const maxVariable = Math.max(...scenarioVariable.map((x) => x.total));
const minVariable = Math.min(...scenarioVariable.map((x) => x.total));
const acMaxVariable = Math.max(...scenarioVariable.map((x) => x.cible['A/C']));



/* ------------------------------------------------------------------ */
/* Écran                                                              */
/* ------------------------------------------------------------------ */

console.log('');
console.log('ANALYSE DE L’EFFECTIF FACE AU DISPOSITIF');
console.log('='.repeat(78));
console.log(`Dossier    : ${DONNEES}`);
console.log(`Postes     : ${nf(postes.length)}  (${nf(postes.filter((p) => p.type === 'barrage_fixe').length)} fixes, ${nf(postes.filter((p) => p.type === 'barrage_mobile').length)} mobiles)`);
console.log(`Effectif   : ${nf(effectifs.length)} sur ${BRIGADES.size} brigade(s)`);
console.log(`Créneaux   : ${CRENEAUX.length} par journée (${CRENEAUX.join('h, ')}h)`);
console.log('');
console.log('COMPOSITION DÉCLARÉE');
for (const type of ['barrage_fixe', 'barrage_mobile']) {
  const compo = composition.pour({ type });
  const total = compo.reduce((s, c) => s + c.nombre, 0);
  console.log(`  ${type.padEnd(16)} ${compo.map((c) => `${c.nombre} ${c.grade}`).join(' · ')}   = ${total} hommes/poste/créneau`);
}
console.log('');
console.log('BESOIN CONTRE DISPONIBLE, PAR CRÉNEAU');
console.log(`  ${'grade'.padEnd(6)} ${'besoin'.padStart(8)} ${'dispo'.padStart(8)} ${'manque'.padStart(8)}`);
for (const g of ORDRE) {
  console.log(`  ${g.padEnd(6)} ${nf(totalBesoin[g]).padStart(8)} ${nf(totalDispo[g]).padStart(8)} ${nf(totalManque[g]).padStart(8)}`);
}
console.log(`  ${'TOTAL'.padEnd(6)} ${nf(ORDRE.reduce((s, g) => s + totalBesoin[g], 0)).padStart(8)} ${nf(effectifs.length).padStart(8)} ${nf(manqueCreneau).padStart(8)}`);
console.log('');
console.log(`Manque par créneau : ${nf(manqueCreneau)}`);
console.log(`Manque par journée : ${nf(manqueCreneau)} × ${CRENEAUX.length} créneaux = ${nf(manqueJour)}`);
console.log('');
console.log(`Brigades servies entièrement : ${sansManque.length} / ${lignes.length}`);
console.log(`Brigades en manque           : ${avecManque.length}`);
console.log(`Besoin médian d’une brigade  : ${mediane} hommes  (min ${besoins[0]}, max ${besoins[besoins.length - 1]})`);
console.log('');
console.log('LES DIX BRIGADES LES PLUS DÉFICITAIRES');
console.log(`  ${'brigade'.padEnd(24)} ${'postes'.padStart(6)} ${'besoin'.padStart(7)} ${'dispo'.padStart(6)} ${'manque/j'.padStart(9)}   détail`);
for (const l of [...avecManque].sort((a, b) => b.manqueCreneau - a.manqueCreneau).slice(0, 10)) {
  console.log(
    `  ${l.bt.slice(0, 24).padEnd(24)} ${String(l.postes).padStart(6)} ${String(l.besoinTotal).padStart(7)} ${String(l.dispoTotal).padStart(6)} ${String(l.manqueJour).padStart(9)}   ` +
      ORDRE.filter((g) => l.manque[g] > 0).map((g) => `${l.manque[g]} ${g}`).join(' · '),
  );
}
console.log('');
console.log('SCÉNARIOS');
console.log(`  A — 20 par brigade (actuel) : ${nf(lignes.length * 20)} hommes, manque ${nf(manqueJour)}/jour, ${avecManque.length} brigade(s) touchée(s)`);
console.log(`  B — besoin + ${Math.round(RESERVE * 100)} % de réserve  : ${nf(totalVariable)} hommes, manque 0/jour`);
console.log(`      effectif par brigade : de ${minVariable} à ${maxVariable}  —  jusqu’à ${acMaxVariable} A/C dans une seule brigade`);
console.log('');

/* ------------------------------------------------------------------ */
/* Rapports                                                           */
/* ------------------------------------------------------------------ */

if (CSV) {
  mkdirSync(resolve(CSV), { recursive: true });

  const enTete = ['brigade', 'compagnie', 'region', 'postes', 'fixes', 'mobiles'];
  const l1 = [
    [...enTete, ...ORDRE.map((g) => `besoin_${g}`), 'besoin_total', ...ORDRE.map((g) => `dispo_${g}`), 'dispo_total',
      ...ORDRE.map((g) => `manque_${g}`), 'manque_creneau', 'manque_jour'].join(','),
  ];
  for (const l of lignes) {
    l1.push([
      `"${l.bt}"`, `"${l.cie ?? ''}"`, `"${l.reg ?? ''}"`, l.postes, l.fixes, l.mobiles,
      ...ORDRE.map((g) => l.besoin[g]), l.besoinTotal,
      ...ORDRE.map((g) => l.dispo[g]), l.dispoTotal,
      ...ORDRE.map((g) => l.manque[g]), l.manqueCreneau, l.manqueJour,
    ].join(','));
  }

  const f1 = join(resolve(CSV), 'besoins-par-brigade.csv');
  writeFileSync(f1, l1.join('\n'), 'utf8');

  const l2 = [['barrage_id', 'nom', 'type', 'brigade', 'compagnie', 'region', ...ORDRE, 'total_par_creneau'].join(',')];
  for (const p of detailPostes) {
    l2.push([
      p.id, `"${String(p.nom).replace(/"/g, "'")}"`, p.type, `"${p.bt}"`, `"${p.cie ?? ''}"`, `"${p.reg ?? ''}"`,
      ...ORDRE.map((g) => p[g]), p.total,
    ].join(','));
  }
  const f2 = join(resolve(CSV), 'besoins-par-barrage.csv');
  writeFileSync(f2, l2.join('\n'), 'utf8');
  console.log(`CSV : ${f1}`);
  console.log(`CSV : ${f2}`);
}

if (RAPPORT) {
  const m = [];
  m.push('# Effectif contre dispositif — d’où viennent les hommes manquants');
  m.push('');
  m.push(`Produit le ${new Date().toISOString()} par \`scripts/analyser-effectif.mjs\`. Aucune donnée modifiée.`);
  m.push('');
  m.push('## Le calcul');
  m.push('');
  m.push('```');
  m.push(`besoin(brigade, créneau) = Σ composition(poste)   sur tous ses postes`);
  m.push(`manque(brigade, créneau) = Σ max(0, besoin[grade] − effectif[grade])`);
  m.push(`manque(journée)          = manque(créneau) × ${CRENEAUX.length} créneaux`);
  m.push('```');
  m.push('');
  m.push(`Une même personne peut tenir un poste aux quatre créneaux : \`repartir\` est appelée une fois par créneau avec l’effectif entier de la brigade. Le manque journalier est donc quatre fois le manque d’un créneau.`);
  m.push('');
  m.push('## Composition déclarée');
  m.push('');
  m.push('| Nature du poste | A/C | ADJT | MDLC | MDLG | Total par créneau |');
  m.push('| --- | --- | --- | --- | --- | --- |');
  for (const type of ['barrage_fixe', 'barrage_mobile']) {
    const compo = composition.pour({ type });
    const parGrade = vide();
    for (const c of compo) parGrade[c.grade] = c.nombre;
    m.push(`| ${type} | ${parGrade['A/C']} | ${parGrade.ADJT} | ${parGrade.MDLC} | ${parGrade.MDLG} | ${ORDRE.reduce((s, g) => s + parGrade[g], 0)} |`);
  }
  m.push('');
  m.push('## Besoin contre disponible (par créneau, pays entier)');
  m.push('');
  m.push('| Grade | Besoin | Disponible | Manque |');
  m.push('| --- | --- | --- | --- |');
  for (const g of ORDRE) m.push(`| ${g} | ${nf(totalBesoin[g])} | ${nf(totalDispo[g])} | **${nf(totalManque[g])}** |`);
  m.push(`| **Total** | ${nf(ORDRE.reduce((s, g) => s + totalBesoin[g], 0))} | ${nf(effectifs.length)} | **${nf(manqueCreneau)}** |`);
  m.push('');
  m.push(`Par journée : ${nf(manqueCreneau)} × ${CRENEAUX.length} = **${nf(manqueJour)}**.`);
  m.push('');
  m.push('## Scénarios');
  m.push('');
  m.push('| | A — 20 par brigade | B — besoin + réserve |');
  m.push('| --- | --- | --- |');
  m.push(`| Effectif total | ${nf(lignes.length * 20)} | ${nf(totalVariable)} |`);
  m.push(`| Manque par journée | ${nf(manqueJour)} | 0 |`);
  m.push(`| Brigades en manque | ${avecManque.length} | 0 |`);
  m.push(`| Effectif par brigade | 20 partout | de ${minVariable} à ${maxVariable} |`);
  m.push(`| A/C dans une brigade | 1 à 2 | jusqu’à ${acMaxVariable} |`);
  m.push('');
  m.push('## Besoin et disponible, brigade par brigade');
  m.push('');
  m.push('| Brigade | Cie | Région | Postes | Besoin A/C | Besoin ADJT | Besoin MDLC | Besoin MDLG | Besoin total | Effectif | Manque/créneau | Manque/jour |');
  m.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const l of lignes) {
    m.push(
      `| ${l.bt} | ${l.cie ?? ''} | ${l.reg ?? ''} | ${l.postes} | ${l.besoin['A/C']} | ${l.besoin.ADJT} | ${l.besoin.MDLC} | ${l.besoin.MDLG} | ${l.besoinTotal} | ${l.dispoTotal} | ${l.manqueCreneau} | ${l.manqueJour} |`,
    );
  }
  m.push('');

  const dest = resolve(RAPPORT);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, m.join('\n'), 'utf8');
  console.log(`Rapport : ${dest}`);
  console.log('');
}
