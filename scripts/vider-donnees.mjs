#!/usr/bin/env node
/**
 * REMETTRE LES DONNÉES D'EXPLOITATION À ZÉRO — sans rien casser.
 *
 * À QUOI CELA SERT. Le dépôt a servi de démonstration : 1 124 barrages posés
 * pour éprouver la carte, 121 428 lignes de relève, 7 454 personnes fictives.
 * Pour une mise en service réelle, ces enregistrements ne doivent PAS être là :
 * les barrages seront saisis un par un, région par région, par ceux qui les
 * connaissent.
 *
 * CE QUE LE SCRIPT NE FAIT PAS, et c'est le plus important :
 *
 *   — il n'efface AUCUN FICHIER. Chaque fichier reste, avec son enveloppe
 *     exacte (`{version: 1, items: []}`), de sorte que les dépôts le relisent
 *     sans se plaindre et que rien n'ait à être recréé ;
 *   — il ne touche pas aux COMPTES (comptes.json) : les 625 habilitations et
 *     leurs empreintes sont l'ossature du système, pas des données de terrain ;
 *   — il ne touche pas à la CONFIGURATION (composition-barrage.json,
 *     villes-police.json) : ce sont des réglages écrits à la main, pas des
 *     enregistrements ;
 *   — il ne touche pas aux COUCHES GÉOGRAPHIQUES (dist/layers/) : les 28
 *     régions, 90 compagnies et 504 brigades viennent de là. C'est ce qui
 *     permet de saisir pour N'IMPORTE QUELLE région, et l'effacer reviendrait
 *     à supprimer l'organigramme.
 *
 * POURQUOI L'EFFECTIF EST VIDÉ AVEC LES BARRAGES, alors qu'on ne demandait que
 * les barrages : le service prépare le roster tout seul, au démarrage puis
 * TOUTES LES HEURES (voir `veillerAuRoster` dans serveur/api.mjs). Si l'on
 * vidait les barrages en laissant les 7 454 personnes fictives, le premier
 * barrage saisi à la main se retrouverait garni de personnel DEMO dans l'heure
 * — exactement ce qu'on cherche à éviter. Les deux vont ensemble.
 *
 * `--garder-effectif` permet de s'en dispenser, en connaissance de cause.
 *
 * EMPLOI
 *   node scripts/vider-donnees.mjs --liste          ce qui serait fait
 *   node scripts/vider-donnees.mjs --vider          le faire
 *   node scripts/vider-donnees.mjs --vider --garder-effectif
 *   node scripts/vider-donnees.mjs --vider --garder-journal
 *
 * Une SAUVEGARDE horodatée de chaque fichier touché est écrite dans
 * `donnees-serveur/sauvegardes/` avant toute modification. Rien n'est perdu :
 * remettre un fichier en place suffit à revenir en arrière.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d = null) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : d;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-serveur')));
const FAIRE = drapeau('vider');
const GARDER_EFFECTIF = drapeau('garder-effectif');
const GARDER_JOURNAL = drapeau('garder-journal');

if (!existsSync(DONNEES)) {
  console.error(`\nIntrouvable : ${DONNEES}\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Ce qui se vide, ce qui se garde                                    */
/* ------------------------------------------------------------------ */

/**
 * Chaque entrée dit CE QUE LE FICHIER CONTIENT et POURQUOI il se vide.
 *
 * Le motif n'est pas décoratif : c'est ce qui permet de relire cette liste
 * dans six mois et de savoir si un fichier ajouté depuis doit y figurer.
 */
const AVIDER = [
  {
    nom: 'marquages.json',
    quoi: 'les barrages, points noirs et points de congestion',
    motif: 'ce sont LES enregistrements que l’on veut saisir à la main',
  },
  {
    nom: 'elements.json',
    quoi: 'les relèves — qui tient quel poste, par créneau de 6 h',
    motif: 'chaque ligne désigne un barrage : sans barrages, elles ne désignent rien',
  },
  {
    nom: 'alertes.json',
    quoi: 'les alertes de proximité entre barrages',
    motif: 'calculées sur les barrages, elles n’ont plus d’objet',
  },
  {
    nom: 'instructions.json',
    quoi: 'les notifications de décision (retrait, maintien, nouveau poste)',
    motif: 'chacune porte sur un barrage ; orpheline, elle encombre « À traiter »',
  },
  {
    nom: 'notifications.json',
    quoi: 'les notifications d’événements (assignation, déplacement, faction…) et leur lecture',
    motif: 'chacune raconte une écriture sur un barrage qui n’existe plus',
  },
  {
    nom: 'conflits-planification.json',
    quoi: 'les conflits de planification',
    motif: 'dépendants des barrages (déjà vide)',
  },
  {
    nom: 'suivi-conflits.json',
    quoi: 'le suivi, l’assignation et l’historique des conflits',
    motif: 'historique et assignations de conflits d’essai',
  },
  {
    nom: 'missions.json',
    quoi: 'les missions (passages VIP)',
    motif: 'un enregistrement d’essai, pas une donnée réelle',
  },
  {
    nom: 'effectifs.json',
    quoi: 'l’effectif nominatif',
    motif:
      'les 7 454 personnes sont FICTIVES (demo:true) et la préparation ' +
      'automatique les affecterait aux barrages saisis à la main',
    saute: GARDER_EFFECTIF,
    /* Ce fichier porte une enveloppe particulière : on la conserve, sauf le
       drapeau `demo` qui n'a plus d'objet sur un fichier vide. */
    enveloppe: (j) => ({
      _lisezMoi:
        'Effectif nominatif, un enregistrement par personne. ' +
        'Vide : à renseigner par l’administration.',
      version: j.version ?? 1,
      items: [],
    }),
  },
  {
    nom: 'journal.jsonl',
    quoi: 'le journal d’audit',
    motif: 'il ne consigne que des actions d’essai',
    saute: GARDER_JOURNAL,
    jsonl: true,
  },
];

const AGARDER = [
  ['comptes.json', 'les 625 habilitations et leurs empreintes — l’ossature du système'],
  ['composition-barrage.json', 'configuration : composition type d’un barrage par grade'],
  ['villes-police.json', 'référence : villes sous compétence de la police'],
  ['dist/layers/ (hors donnees-serveur)', '28 régions, 90 compagnies, 504 brigades — l’organigramme'],
];

/* ------------------------------------------------------------------ */

const octets = (n) => {
  const c = join(DONNEES, n);
  return existsSync(c) ? statSync(c).size : 0;
};

const compter = (n) => {
  const c = join(DONNEES, n);
  if (!existsSync(c)) return null;
  try {
    if (n.endsWith('.jsonl')) {
      return readFileSync(c, 'utf8').split('\n').filter(Boolean).length;
    }
    return (JSON.parse(readFileSync(c, 'utf8')).items ?? []).length;
  } catch {
    return null;
  }
};

console.log('');
console.log(`Dossier : ${DONNEES}`);
console.log('');
console.log('À VIDER — le fichier reste, son contenu part');
console.log('');
for (const e of AVIDER) {
  const n = compter(e.nom);
  const etat = e.saute ? 'GARDÉ (--garder-…)' : n === null ? 'absent' : `${n} → 0`;
  console.log(`  ${e.nom.padEnd(30)} ${String(etat).padStart(14)}   ${e.quoi}`);
  if (!e.saute && n) console.log(`  ${' '.repeat(30)} ${' '.repeat(14)}   ↳ ${e.motif}`);
}

console.log('');
console.log('CONSERVÉ INTACT');
console.log('');
for (const [n, pourquoi] of AGARDER) console.log(`  ${n.padEnd(46)} ${pourquoi}`);

const total = AVIDER.filter((e) => !e.saute).reduce((s, e) => s + octets(e.nom), 0);
console.log('');
console.log(`Volume libéré : ${(total / 1048576).toFixed(1)} Mo`);
console.log('');

if (!FAIRE) {
  console.log('Aucune écriture. Ajoutez --vider pour le faire.');
  console.log('');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Sauvegarde, puis vidage                                            */
/* ------------------------------------------------------------------ */

const SAUVEGARDES = join(DONNEES, 'sauvegardes');
mkdirSync(SAUVEGARDES, { recursive: true });
const horodatage = new Date().toISOString().replace(/[:.]/g, '-');

let vides = 0;
for (const e of AVIDER) {
  if (e.saute) continue;
  const chemin = join(DONNEES, e.nom);
  if (!existsSync(chemin)) continue;

  const copie = join(SAUVEGARDES, `${e.nom}.avant-vidage-${horodatage}`);
  copyFileSync(chemin, copie);

  if (e.jsonl) {
    /* Un journal vide est un fichier vide, pas un fichier contenant « [] ». */
    writeFileSync(chemin, '', 'utf8');
  } else {
    const brut = JSON.parse(readFileSync(chemin, 'utf8'));
    const neuf = e.enveloppe ? e.enveloppe(brut) : { version: brut.version ?? 1, items: [] };
    writeFileSync(chemin, JSON.stringify(neuf, null, 2) + '\n', 'utf8');
  }

  console.log(`  vidé : ${e.nom.padEnd(30)} (sauvegarde dans sauvegardes/)`);
  vides++;
}

console.log('');
console.log(`${vides} fichier(s) vidé(s). Sauvegardes : ${SAUVEGARDES}`);
console.log('');
console.log('Les fichiers, leur enveloppe et leur version sont intacts : les dépôts');
console.log('les relisent sans rien recréer.');
console.log('');
console.log('Redémarrez le service pour qu’il reparte sur des données vides.');
console.log('');
