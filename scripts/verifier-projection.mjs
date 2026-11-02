#!/usr/bin/env node
/**
 * CONTRÔLE INDÉPENDANT D'UNE PROJECTION D'EFFECTIF.
 *
 * `semer-demo.mjs --projection` annonce, brigade par brigade, l'effectif qu'il
 * produirait. Ce script REFAIT le calcul depuis les fichiers de données, sans
 * réemployer une ligne du semis, et compare. Deux implémentations qui tombent
 * d'accord valent mieux qu'une qui s'auto-certifie.
 *
 * CE QUI EST RECALCULÉ, PUIS CONFRONTÉ À LA PROJECTION
 *   — le besoin de chaque brigade, poste par poste, d'après la composition ;
 *   — le manque par créneau et par journée qui en découle ;
 *   — les bornes : plancher, plafond, 1 à 2 A/C, au moins 2 ADJT ;
 *   — la cohérence interne des colonnes (final = Σ grades, à créer = final − actuel).
 *
 * IL NE LIT QUE. Aucun fichier de données n'est ouvert en écriture.
 *
 *   node scripts/verifier-projection.mjs --projection artifacts/projection-scenario-g.csv \
 *        --composition-demo --plancher 20 --plafond 60
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-demo')));
const COUCHES = resolve(valeur('couches', join(ROOT, 'public/layers')));
const PROJECTION = resolve(valeur('projection', join(ROOT, 'artifacts/projection-scenario-g.csv')));
const PLANCHER = Number(valeur('plancher', 20));
const PLAFOND = Number(valeur('plafond', 60));
const COMPOSITION_DEMO = drapeau('composition-demo');
const CRENEAUX = 4;
const ORDRE = ['A/C', 'ADJT', 'MDLC', 'MDLG'];

const nf = (n) => Number(n).toLocaleString('fr-FR');
const echecs = [];
const controle = (nom, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'ÉCHEC'}  ${nom}${detail ? ` — ${detail}` : ''}`);
  if (!ok) echecs.push(`${nom}${detail ? ` — ${detail}` : ''}`);
};

if (!existsSync(PROJECTION)) {
  console.error(`\nProjection introuvable : ${PROJECTION}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le besoin, recalculé à la source                                   */
/* ------------------------------------------------------------------ */

/**
 * La composition est relue du fichier, mais le poste fixe est remplacé par le
 * profil de démonstration quand on le demande — exactement ce que le semis
 * appliquera. On ne se fie pas au fichier pour cela : la projection est faite
 * AVANT que le semis ne l'écrive.
 */
const COMPOSITION_FIXE_DEMO = [
  { grade: 'ADJT', nombre: 1 },
  { grade: 'MDLC', nombre: 2 },
  { grade: 'MDLG', nombre: 3 },
];

const brutCompo = JSON.parse(readFileSync(join(DONNEES, 'composition-barrage.json'), 'utf8'));
const compositionPour = (type) => {
  if (COMPOSITION_DEMO && type === 'barrage_fixe') return COMPOSITION_FIXE_DEMO;
  return brutCompo.parType?.[type] ?? brutCompo.defaut;
};

const marquages = JSON.parse(readFileSync(join(DONNEES, 'marquages.json'), 'utf8')).items ?? [];
const circo = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const BRIGADES = new Set(circo.features.map((f) => f.properties?.gr_bde).filter(Boolean));

const vide = () => ({ 'A/C': 0, ADJT: 0, MDLC: 0, MDLG: 0 });
const besoinRecalcule = new Map();
const postesRecalcules = new Map();
for (const bt of BRIGADES) {
  besoinRecalcule.set(bt, vide());
  postesRecalcules.set(bt, 0);
}
for (const m of marquages) {
  if (m.type !== 'barrage_fixe' && m.type !== 'barrage_mobile') continue;
  if (!BRIGADES.has(m.bt)) continue;
  const b = besoinRecalcule.get(m.bt);
  for (const c of compositionPour(m.type)) b[c.grade] = (b[c.grade] ?? 0) + c.nombre;
  postesRecalcules.set(m.bt, postesRecalcules.get(m.bt) + 1);
}

/* L'effectif réellement présent aujourd'hui, pour contrôler la colonne « actuel ». */
const effectifs = JSON.parse(readFileSync(join(DONNEES, 'effectifs.json'), 'utf8')).items ?? [];
const actuelRecalcule = new Map();
for (const p of effectifs) {
  if (!actuelRecalcule.has(p.bt)) actuelRecalcule.set(p.bt, vide());
  const c = actuelRecalcule.get(p.bt);
  if (c[p.grade] !== undefined) c[p.grade]++;
}

/* ------------------------------------------------------------------ */
/* Lecture de la projection                                           */
/* ------------------------------------------------------------------ */

/** Un CSV sans guillemets échappés : les noms de brigade n'en contiennent pas. */
const decouper = (ligne) => {
  const out = [];
  let courant = '';
  let dansGuillemets = false;
  for (const c of ligne) {
    if (c === '"') dansGuillemets = !dansGuillemets;
    else if (c === ',' && !dansGuillemets) {
      out.push(courant);
      courant = '';
    } else courant += c;
  }
  out.push(courant);
  return out;
};

const lignesCsv = readFileSync(PROJECTION, 'utf8').split('\n').filter((l) => l.trim());
const colonnes = decouper(lignesCsv[0]);
const idx = Object.fromEntries(colonnes.map((c, i) => [c, i]));
const rangs = lignesCsv.slice(1).map((l) => {
  const v = decouper(l);
  const n = (c) => Number(v[idx[c]]);
  return {
    bt: v[idx.brigade],
    postes: n('postes'),
    besoin: Object.fromEntries(ORDRE.map((g) => [g, n(`besoin_${g}`)])),
    actuel: Object.fromEntries(ORDRE.map((g) => [g, n(`actuel_${g}`)])),
    actuelTotal: n('actuel_total'),
    cible: Object.fromEntries(ORDRE.map((g) => [g, n(`cible_${g}`)])),
    final: Object.fromEntries(ORDRE.map((g) => [g, n(`final_${g}`)])),
    finalTotal: n('final_total'),
    aCreer: n('a_creer'),
    manqueCreneau: n('manque_creneau'),
    manqueJour: n('manque_jour'),
  };
});

console.log('');
console.log('CONTRÔLE INDÉPENDANT DE LA PROJECTION');
console.log('='.repeat(78));
console.log(`Projection : ${PROJECTION}`);
console.log(`Données    : ${DONNEES}`);
console.log(`Bornes     : plancher ${PLANCHER}, plafond ${PLAFOND}${COMPOSITION_DEMO ? ', composition de démonstration' : ''}`);
console.log(`Brigades   : ${rangs.length} projetée(s) / ${BRIGADES.size} existante(s)`);
console.log('');

/* ------------------------------------------------------------------ */
/* Contrôles                                                          */
/* ------------------------------------------------------------------ */

controle('la projection couvre toutes les brigades', rangs.length === BRIGADES.size, `${rangs.length} / ${BRIGADES.size}`);

const btInconnues = rangs.filter((r) => !BRIGADES.has(r.bt));
controle('aucune brigade inventée', btInconnues.length === 0, btInconnues.slice(0, 3).map((r) => r.bt).join(', '));

const postesFaux = rangs.filter((r) => r.postes !== postesRecalcules.get(r.bt));
controle('le nombre de postes correspond aux marquages', postesFaux.length === 0,
  postesFaux.length ? `${postesFaux.length}, ex. ${postesFaux[0].bt}` : `${nf(rangs.reduce((s, r) => s + r.postes, 0))} postes`);

const besoinFaux = rangs.filter((r) => ORDRE.some((g) => r.besoin[g] !== besoinRecalcule.get(r.bt)[g]));
controle('le besoin recalculé est identique', besoinFaux.length === 0,
  besoinFaux.length ? `${besoinFaux.length} écart(s), ex. ${besoinFaux[0].bt}` : '');

/**
 * AVANT OU APRÈS L'ÉCRITURE — le même contrôle ne peut pas porter sur la même
 * colonne.
 *
 * Une projection décrit un AVANT (`actuel`) et un APRÈS (`final`). Tant qu'elle
 * n'est pas appliquée, `effectifs.json` doit ressembler à la colonne `actuel` ;
 * une fois appliquée, à la colonne `final`. Comparer toujours à `actuel`
 * signalait 473 écarts au lendemain du semis — un faux positif qui aurait fini
 * par apprendre à ignorer ce contrôle.
 *
 * On détermine donc d'abord la phase, puis on contrôle la colonne qui
 * correspond, et l'on dit laquelle.
 */
const colle = (colonne) =>
  rangs.filter((r) => ORDRE.some((g) => r[colonne][g] !== (actuelRecalcule.get(r.bt) ?? vide())[g])).length;

const ecartsAvant = colle('actuel');
const ecartsApres = colle('final');
const phase = ecartsApres === 0 ? 'appliquée' : ecartsAvant === 0 ? 'non appliquée' : 'indéterminée';
const colonne = ecartsApres <= ecartsAvant ? 'final' : 'actuel';
const ecarts = Math.min(ecartsAvant, ecartsApres);

controle(
  `effectifs.json correspond à la colonne « ${colonne} » (projection ${phase})`,
  ecarts === 0,
  ecarts ? `${ecarts} écart(s)` : `${rangs.length} brigade(s) conformes`,
);

const sommeFausse = rangs.filter((r) => ORDRE.reduce((s, g) => s + r.final[g], 0) !== r.finalTotal);
controle('final_total = somme des grades', sommeFausse.length === 0, sommeFausse.length ? `${sommeFausse.length}` : '');

const creationFausse = rangs.filter((r) => r.aCreer !== ORDRE.reduce((s, g) => s + Math.max(0, r.cible[g] - r.actuel[g]), 0));
controle('à créer = Σ max(0, cible − actuel)', creationFausse.length === 0, creationFausse.length ? `${creationFausse.length}` : '');

const finalFaux = rangs.filter((r) => ORDRE.some((g) => r.final[g] !== Math.max(r.actuel[g], r.cible[g])));
controle('final = max(actuel, cible), grade par grade', finalFaux.length === 0, finalFaux.length ? `${finalFaux.length}` : '');

const sousPlancher = rangs.filter((r) => r.finalTotal < PLANCHER);
controle(`aucune brigade sous le plancher de ${PLANCHER}`, sousPlancher.length === 0,
  sousPlancher.length ? `${sousPlancher.length}, ex. ${sousPlancher[0].bt} (${sousPlancher[0].finalTotal})` : '');

const surPlafond = rangs.filter((r) => r.finalTotal > PLAFOND);
controle(`aucune brigade au-dessus du plafond de ${PLAFOND}`, surPlafond.length === 0,
  surPlafond.length ? `${surPlafond.length}, ex. ${surPlafond[0].bt} (${surPlafond[0].finalTotal})` : '');

const acHorsBornes = rangs.filter((r) => r.final['A/C'] < 1 || r.final['A/C'] > 2);
controle('1 à 2 A/C par brigade', acHorsBornes.length === 0,
  acHorsBornes.length ? `${acHorsBornes.length}, ex. ${acHorsBornes[0].bt} (${acHorsBornes[0].final['A/C']})` : '');

const adjtFaible = rangs.filter((r) => r.final.ADJT < 2);
controle('au moins 2 ADJT par brigade', adjtFaible.length === 0,
  adjtFaible.length ? `${adjtFaible.length}, ex. ${adjtFaible[0].bt}` : '');

/* La pyramide reste une pyramide : plus de MDLG que de MDLC, plus de MDLC que
   d'ADJT. C'est ce contrôle qui a rattrapé un plafond qui rabotait la base. */
const pyramideInversee = rangs.filter((r) => r.final.MDLG < r.final.MDLC || r.final.MDLC < r.final.ADJT);
controle('la pyramide n’est jamais inversée (MDLG ≥ MDLC ≥ ADJT)', pyramideInversee.length === 0,
  pyramideInversee.length ? `${pyramideInversee.length}, ex. ${pyramideInversee[0].bt}` : '');

const manqueFaux = rangs.filter((r) => {
  const m = ORDRE.reduce((s, g) => s + Math.max(0, besoinRecalcule.get(r.bt)[g] - r.final[g]), 0);
  return m !== r.manqueCreneau || m * CRENEAUX !== r.manqueJour;
});
controle('le manque annoncé est celui que donne le recalcul', manqueFaux.length === 0,
  manqueFaux.length ? `${manqueFaux.length} écart(s), ex. ${manqueFaux[0].bt}` : '');

/* ------------------------------------------------------------------ */
/* Totaux                                                             */
/* ------------------------------------------------------------------ */

const totalFinal = rangs.reduce((s, r) => s + r.finalTotal, 0);
const totalCible = rangs.reduce((s, r) => s + ORDRE.reduce((t, g) => t + r.cible[g], 0), 0);
const totalActuel = rangs.reduce((s, r) => s + r.actuelTotal, 0);
const totalCreer = rangs.reduce((s, r) => s + r.aCreer, 0);
const manqueCreneau = rangs.reduce((s, r) => s + r.manqueCreneau, 0);
const touchees = rangs.filter((r) => r.manqueCreneau > 0);
const parGrade = Object.fromEntries(ORDRE.map((g) => [g, rangs.reduce((s, r) => s + r.final[g], 0)]));
const tailles = rangs.map((r) => r.finalTotal).sort((a, b) => a - b);

console.log('');
console.log('TOTAUX RECALCULÉS');
console.log(`  effectif actuel      : ${nf(totalActuel)}`);
console.log(`  à créer              : ${nf(totalCreer)}`);
console.log(`  effectif final       : ${nf(totalFinal)}   (cible pure ${nf(totalCible)}, écart ${nf(totalFinal - totalCible)} — personnes déjà en place au-dessus de leur cible, jamais retirées)`);
console.log(`  par grade            : ${ORDRE.map((g) => `${nf(parGrade[g])} ${g}`).join(' · ')}`);
console.log(`  effectif par brigade : de ${tailles[0]} à ${tailles[tailles.length - 1]} (médiane ${tailles[Math.floor(tailles.length / 2)]})`);
console.log(`  manque par créneau   : ${nf(manqueCreneau)}  → par journée : ${nf(manqueCreneau * CRENEAUX)}`);
console.log(`  brigades en manque   : ${touchees.length} / ${rangs.length}`);
console.log('');

if (echecs.length) {
  console.error(`${echecs.length} contrôle(s) en échec :`);
  for (const e of echecs) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}

console.log('La projection est cohérente avec les données : tous les contrôles passent.');
console.log('');
