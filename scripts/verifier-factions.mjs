#!/usr/bin/env node
/**
 * CONTRÔLE D'INTÉGRITÉ — Compagnie → Brigade → Barrage → Faction → Éléments.
 *
 * Ce script ne modifie RIEN. Il lit les fichiers du dépôt et vérifie que la
 * chaîne tient bout à bout, parce que c'est une chaîne de relations et non un
 * tableau : un maillon faux ne se voit nulle part à l'écran, il se traduit par
 * un poste qui n'apparaît dans aucune faction, ou par un homme compté dans une
 * brigade qui n'est pas la sienne.
 *
 * CE QU'IL VÉRIFIE, ET POURQUOI CHACUN COMPTE :
 *
 *   1. RATTACHEMENT   tout barrage porte une brigade, une compagnie, une
 *                     région. Sans cela, il est orphelin : aucun filtre
 *                     territorial ne le rend, aucun chef ne le voit, et il ne
 *                     compte dans aucune statistique ;
 *   2. COHÉRENCE      la compagnie d'un barrage est bien celle de sa brigade,
 *                     d'après les circonscriptions. Un rattachement croisé fait
 *                     apparaître le poste chez un commandement qui n'en
 *                     répond pas ;
 *   3. RELÈVES        toute relève vise un barrage qui existe, sur un créneau
 *                     que les factions nomment ;
 *   4. BRIGADE DES ÉLÉMENTS  l'homme relevé sur un poste appartient bien à la
 *                     brigade de ce poste. C'est le contrôle le plus utile :
 *                     une erreur ici ne casse rien techniquement, elle fausse
 *                     seulement les effectifs de deux unités à la fois ;
 *   5. FACTIONS       combien de postes sont rattachés à chaque faction, et
 *                     combien n'en ont aucune.
 *
 * Il RAPPORTE, il ne corrige pas : une correction automatique sur des
 * rattachements territoriaux se ferait sans que personne ne sache ce qui a
 * bougé. Les écarts sont nommés, avec de quoi les retrouver.
 *
 *   node scripts/verifier-factions.mjs
 *   node scripts/verifier-factions.mjs --donnees donnees-demo
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACTIONS, factionsDuBarrage, factionParCreneau } from '../serveur/factions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const demande = process.argv.indexOf('--donnees');
const choisi = demande > -1 ? process.argv[demande + 1] : null;
const DONNEES = choisi
  ? resolve(ROOT, choisi)
  : existsSync(join(ROOT, 'donnees-production'))
    ? join(ROOT, 'donnees-production')
    : join(ROOT, 'donnees-serveur');

if (!existsSync(DONNEES)) {
  console.error(`\nDossier de donnees introuvable : ${DONNEES}\n`);
  process.exit(1);
}

let ok = 0;
const ecarts = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'CONFORME' : 'ÉCART   '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else ecarts.push(titre);
};

const lireJson = (chemin, defaut) => {
  if (!existsSync(chemin)) return defaut;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8'));
  } catch {
    return defaut;
  }
};

console.log(`\n  donnees : ${DONNEES}\n`);

/* ------------------------------------------------------------------ */
/* LECTURE                                                            */
/* ------------------------------------------------------------------ */

const marquages = lireJson(join(DONNEES, 'marquages.json'), { items: [] }).items ?? [];
const effectifs = lireJson(join(DONNEES, 'effectifs.json'), { items: [] }).items ?? [];

/** Les relèves du dépôt par journée (`elements/AAAA-MM-JJ.jsonl`). */
const lireElements = () => {
  const dossier = join(DONNEES, 'elements');
  if (!existsSync(dossier)) return [];
  const out = [];
  for (const nom of readdirSync(dossier).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(nom)) continue;
    for (const ligne of readFileSync(join(dossier, nom), 'utf8').split('\n')) {
      const nu = ligne.trim();
      if (!nu) continue;
      try {
        out.push(JSON.parse(nu));
      } catch {
        /* Une ligne tronquée n'emporte pas la journée — même règle que le dépôt. */
      }
    }
  }
  return out;
};
const elements = lireElements();

const BARRAGES = ['barrage_fixe', 'barrage_mobile'];
const HORS_SERVICE = ['supprime', 'retire_optimisation'];
const postes = marquages.filter(
  (m) => BARRAGES.includes(m.type) && !HORS_SERVICE.includes(m.statutBarrage),
);

console.log('=== 1. VOLUMES ===\n');
console.log(`  marquages au fichier   : ${marquages.length}`);
console.log(`  barrages en service    : ${postes.length}`);
console.log(`  effectifs nominatifs   : ${effectifs.length}`);
console.log(`  relèves (toutes dates) : ${elements.length}`);

/* ------------------------------------------------------------------ */
/* 2. RATTACHEMENT TERRITORIAL                                        */
/* ------------------------------------------------------------------ */

console.log('\n=== 2. RATTACHEMENT TERRITORIAL ===\n');

const orphelins = postes.filter((m) => !m.bt || !m.cie || !m.reg);
dit(
  orphelins.length === 0,
  'aucun barrage orphelin (brigade, compagnie et région renseignées)',
  orphelins.length
    ? `${orphelins.length} sans rattachement complet, ex. ${orphelins[0].id}`
    : `${postes.length} barrage(s) rattaché(s)`,
);

/**
 * LA COMPAGNIE D'UNE BRIGADE — déduite des barrages eux-mêmes.
 *
 * On ne relit pas les circonscriptions géographiques ici : ce script vérifie la
 * COHÉRENCE INTERNE du dépôt, et la question est « une même brigade est-elle
 * rattachée à deux compagnies différentes selon le barrage ? ». Une brigade qui
 * change de compagnie d'un poste à l'autre est une erreur, quelle que soit la
 * géographie.
 */
const compagniesParBrigade = new Map();
for (const m of postes) {
  if (!m.bt) continue;
  if (!compagniesParBrigade.has(m.bt)) compagniesParBrigade.set(m.bt, new Set());
  compagniesParBrigade.get(m.bt).add(m.cie);
}
const brigadesAmbigues = [...compagniesParBrigade.entries()].filter(([, cies]) => cies.size > 1);
dit(
  brigadesAmbigues.length === 0,
  'aucune brigade rattachée à deux compagnies différentes',
  brigadesAmbigues.length
    ? brigadesAmbigues
        .slice(0, 3)
        .map(([bt, cies]) => `${bt} → ${[...cies].join(' / ')}`)
        .join(' ; ')
    : `${compagniesParBrigade.size} brigade(s) cohérente(s)`,
);

const parCompagnie = new Map();
for (const m of postes) {
  const cle = m.cie || '(sans compagnie)';
  parCompagnie.set(cle, (parCompagnie.get(cle) ?? 0) + 1);
}
console.log(
  `\n  compagnies : ${parCompagnie.size} · brigades : ${compagniesParBrigade.size} · ` +
    `moyenne ${(postes.length / Math.max(1, parCompagnie.size)).toFixed(1)} barrage(s)/compagnie`,
);

/* ------------------------------------------------------------------ */
/* 3. RELÈVES                                                         */
/* ------------------------------------------------------------------ */

console.log('\n=== 3. RELÈVES ===\n');

const idsPostes = new Set(postes.map((m) => m.id));
const idsTous = new Set(marquages.map((m) => m.id));

const relevesOrphelines = elements.filter((e) => !idsTous.has(e.barrageId));
dit(
  relevesOrphelines.length === 0,
  'aucune relève ne vise un barrage inexistant',
  relevesOrphelines.length ? `${relevesOrphelines.length} relève(s) orpheline(s)` : '',
);

const creneauxInconnus = elements.filter((e) => !factionParCreneau(e.creneau));
dit(
  creneauxInconnus.length === 0,
  'toute relève porte un créneau que les factions nomment',
  creneauxInconnus.length
    ? `${creneauxInconnus.length} sur des créneaux hors ${FACTIONS.map((f) => f.creneau).join('/')}`
    : `créneaux reconnus : ${FACTIONS.map((f) => `${f.id}=${f.creneau}h`).join(', ')}`,
);

/* ------------------------------------------------------------------ */
/* 4. LES ÉLÉMENTS SONT-ILS DE LA BONNE BRIGADE ?                     */
/* ------------------------------------------------------------------ */

console.log('\n=== 4. BRIGADE DES ÉLÉMENTS ===\n');

const brigadeDuPoste = new Map(postes.map((m) => [m.id, m.bt]));
const brigadeDeLHomme = new Map(effectifs.map((p) => [p.matricule, p.bt]));

let verifiables = 0;
const malAffectes = new Map();
for (const e of elements) {
  const bt = brigadeDuPoste.get(e.barrageId);
  const sien = brigadeDeLHomme.get(e.matricule);
  if (!bt || !sien) continue; // l'un des deux est inconnu : rien à conclure
  verifiables++;
  if (bt !== sien) {
    const cle = `${sien} → ${bt}`;
    malAffectes.set(cle, (malAffectes.get(cle) ?? 0) + 1);
  }
}
const nbMalAffectes = [...malAffectes.values()].reduce((a, b) => a + b, 0);

dit(
  nbMalAffectes === 0,
  'aucun élément relevé sur un barrage d’une autre brigade',
  nbMalAffectes
    ? `${nbMalAffectes} relève(s) sur ${verifiables} vérifiable(s) — ex. ${[...malAffectes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => `${k} (${n})`)
        .join(', ')}`
    : `${verifiables} relève(s) vérifiée(s)`,
);

const inconnusAuxEffectifs = new Set(
  elements.filter((e) => !brigadeDeLHomme.has(e.matricule)).map((e) => e.matricule),
);
dit(
  inconnusAuxEffectifs.size === 0,
  'tout homme relevé figure aux effectifs',
  inconnusAuxEffectifs.size
    ? `${inconnusAuxEffectifs.size} matricule(s) absent(s) des effectifs`
    : '',
);

/* ------------------------------------------------------------------ */
/* 5. RÉPARTITION PAR FACTION                                         */
/* ------------------------------------------------------------------ */

console.log('\n=== 5. RÉPARTITION PAR FACTION ===\n');

/* La journée la plus récente qui porte des relèves : c'est celle que la carte
   montre par défaut, et donc celle qu'il faut contrôler. */
const journees = [...new Set(elements.map((e) => e.date))].sort();
const jour = journees[journees.length - 1] ?? null;

const creneauxDuJour = new Map();
for (const e of elements) {
  if (e.date !== jour) continue;
  if (!creneauxDuJour.has(e.barrageId)) creneauxDuJour.set(e.barrageId, new Set());
  creneauxDuJour.get(e.barrageId).add(e.creneau);
}

const compteurs = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
let sansFaction = 0;
for (const m of postes) {
  const ids = factionsDuBarrage(m, creneauxDuJour.get(m.id) ?? null);
  if (!ids.length) sansFaction++;
  for (const id of ids) compteurs[id]++;
}

console.log(`  journée de référence : ${jour ?? '(aucune relève)'}\n`);
for (const f of FACTIONS) {
  console.log(`  ${f.id}  ${f.libelle}   ${String(compteurs[f.id]).padStart(5)} barrage(s)`);
}
console.log(`  —   sans faction        ${String(sansFaction).padStart(5)} barrage(s)`);

dit(
  Object.values(compteurs).some((n) => n > 0),
  'au moins une faction porte des barrages',
  `total en service : ${postes.length}`,
);

/**
 * UN POSTE SANS FACTION N'EST PAS UNE ERREUR DE STRUCTURE — c'est un poste que
 * personne n'a encore planifié pour cette journée. On le signale sans le
 * compter comme un écart : le dire est utile, en faire un défaut serait faux.
 */
if (sansFaction) {
  console.log(
    `\n  ${sansFaction} barrage(s) sans faction ce jour-là : aucune relève saisie ni préparée,\n` +
      "  et aucune fenêtre « début/fin » sur leur fiche. Ils restent visibles sous\n" +
      '  « Toutes les factions » et ne sont rattachés à aucun tour de service.',
  );
}

/* ------------------------------------------------------------------ */

console.log(`\n  ${ok} contrôle(s) conforme(s), ${ecarts.length} écart(s).`);
if (ecarts.length) {
  for (const e of ecarts) console.log(`    - ${e}`);
  process.exit(1);
}
console.log('');
