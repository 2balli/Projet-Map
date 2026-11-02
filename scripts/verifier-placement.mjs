#!/usr/bin/env node
/**
 * CONTRÔLE DE CE QUE LA CARTE MONTRE — bulles recadrées, carte lisible.
 *
 * DEUX SUJETS, UN SEUL SCRIPT, parce que c'est la même question posée deux
 * fois : ce qui s'affiche est-il réellement consultable ?
 *
 *   1. LE RECADRAGE DES BULLES — une bulle doit tenir dans le cadre ;
 *   2. LA LISIBILITÉ DES COUCHES — les renseignements se taisent quand on est
 *      trop loin pour les lire, les repères actionnables rétrécissent sans
 *      cesser d'être cliquables (voir src/carteLisibilite.js).
 *
 * Le second est venu d'un désordre constaté : 189 étiquettes de texte posées
 * d'un coup sur la vue du pays entier, plus les repères de décision à taille
 * fixe. La carte n'était pas chargée, elle était inutilisable.
 *
 * ---------------------------------------------------------------------------
 * 1. LE RECADRAGE DES BULLES.
 *
 * La bulle d'un barrage doit rester entièrement visible, où que se trouve le
 * repère — y compris dans un coin, ou hors du cadre. Deux tentatives ont
 * échoué parce qu'elles modélisaient la géométrie interne de Leaflet ; la
 * version retenue mesure le rectangle affiché et le pousse dedans.
 *
 * Ce script éprouve la SEULE partie où un raisonnement peut se tromper :
 * `pousserDedans`. Le reste — lire un rectangle, appliquer un décalage — ne
 * se raisonne pas, il se constate.
 *
 * Balayage exhaustif : toutes les positions de bulle sur une grille, pour
 * plusieurs tailles de cadre et de bulle, y compris des bulles plus grandes
 * que le cadre. On vérifie deux propriétés :
 *
 *   1. après correction, la bulle est dans le cadre, marge comprise ;
 *   2. si elle y était déjà, on ne la bouge pas.
 *
 * La seconde compte autant que la première : une bulle qui saute alors
 * qu'elle tenait déjà serait un défaut à son tour.
 *
 *   node scripts/verifier-placement.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pousserDedans } from '../src/placementBulle.js';
import {
  ZOOM_BADGES,
  COTE_CLIQUABLE_MIN,
  badgesVisibles,
  echelleDecision,
  echelleZoom,
  coteDecision,
} from '../src/carteLisibilite.js';
import { INITIAL_VIEW } from '../src/mapConfig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MARGE = 12;

const cadres = [
  { left: 0, top: 0, right: 1280, bottom: 720 },
  { left: 0, top: 0, right: 360, bottom: 640 },
  { left: 120, top: 64, right: 1520, bottom: 900 },
];

const tailles = [
  [200, 120],
  [300, 420],
  [300, 700],
  [1400, 300],
  [420, 1000],
];

let cas = 0;
let echecs = 0;
let deplacementsInutiles = 0;

for (const cadre of cadres) {
  for (const [w, h] of tailles) {
    for (let x = cadre.left - 400; x <= cadre.right + 400; x += 37) {
      for (let y = cadre.top - 400; y <= cadre.bottom + 400; y += 41) {
        const r = { left: x, top: y, right: x + w, bottom: y + h };
        const { dx, dy } = pousserDedans(r, cadre, MARGE);
        cas++;

        const apres = {
          left: r.left + dx,
          right: r.right + dx,
          top: r.top + dy,
          bottom: r.bottom + dy,
        };

        /* Une bulle plus large ou plus haute que le cadre ne peut pas y tenir :
           on exige alors qu'elle commence au bord, pas qu'elle rentre. */
        const tropLarge = w > cadre.right - cadre.left - 2 * MARGE;
        const tropHaute = h > cadre.bottom - cadre.top - 2 * MARGE;

        const okX = tropLarge
          ? apres.left === cadre.left + MARGE
          : apres.left >= cadre.left + MARGE - 1e-9 && apres.right <= cadre.right - MARGE + 1e-9;
        const okY = tropHaute
          ? apres.top === cadre.top + MARGE
          : apres.top >= cadre.top + MARGE - 1e-9 && apres.bottom <= cadre.bottom - MARGE + 1e-9;

        if (!okX || !okY) {
          echecs++;
          if (echecs <= 3) {
            console.error(
              `  ÉCHEC cadre ${cadre.right - cadre.left}x${cadre.bottom - cadre.top} ` +
                `bulle ${w}x${h} en (${x},${y}) -> décalage (${dx},${dy})`
            );
          }
          continue;
        }

        /* Déjà dedans : on ne doit rien bouger. */
        const dejaDedans =
          r.left >= cadre.left + MARGE &&
          r.right <= cadre.right - MARGE &&
          r.top >= cadre.top + MARGE &&
          r.bottom <= cadre.bottom - MARGE;
        if (dejaDedans && (dx !== 0 || dy !== 0)) deplacementsInutiles++;
      }
    }
  }
}

/* ================================================================== */
/* CE QUE LA CARTE MONTRE SANS DEVENIR ILLISIBLE                      */
/* ================================================================== */

/**
 * LE DÉFAUT QUE CES CONTRÔLES ATTRAPENT DÉSORMAIS.
 *
 * Les badges de caractéristiques étaient posés à TOUS les zooms : 189
 * étiquettes de texte dessinées d'un coup sur la vue du pays entier, plus 58
 * « ? » et 19 cadenas, tous de taille fixe. La carte devenait illisible — les
 * pastilles se chevauchaient sur plusieurs rangs et recouvraient les contours,
 * le littoral, et les repères qu'elles étaient censées compléter.
 *
 * Rien ne pouvait le voir : la décision était enfouie dans un composant de
 * cinq mille lignes qui ne s'exécute que dans un navigateur. Elle vit
 * maintenant dans `src/carteLisibilite.js`, qui est du calcul pur.
 *
 * Deux exigences OPPOSÉES, et c'est tout l'intérêt de les écrire ensemble :
 * les renseignements se cachent quand ils ne se lisent plus, les repères
 * ACTIONNABLES ne se cachent jamais — ils rétrécissent, sans devenir trop
 * petits pour être cliqués. Satisfaire l'une en cassant l'autre est l'erreur
 * naturelle ici.
 */
let lisibilite = 0;
const fautes = [];
const exige = (bon, quoi, detail = '') => {
  lisibilite++;
  if (!bon) fautes.push(`${quoi}${detail ? ' — ' + detail : ''}`);
};

/* 1 — LES BADGES SE TAISENT DE LOIN, ET PARLENT DE PRÈS. */
for (let zoom = 0; zoom <= 20; zoom++) {
  exige(
    badgesVisibles(zoom) === zoom >= ZOOM_BADGES,
    'badgesVisibles ne suit pas son seuil',
    `zoom ${zoom} -> ${badgesVisibles(zoom)}`,
  );
}

/* La vue d'ouverture est le cas qui a produit le désordre : le pays entier. */
exige(
  !badgesVisibles(INITIAL_VIEW.zoom),
  'les badges sont posés dès la vue d’ouverture',
  `zoom initial ${INITIAL_VIEW.zoom} — c'est le désordre d'origine`,
);

/* Un zoom inconnu ne doit pas masquer une couche demandée. */
for (const inconnu of [undefined, null, NaN, 'douze']) {
  exige(badgesVisibles(inconnu) === true, 'un zoom inconnu masque les badges', String(inconnu));
}

/* 2 — LES REPÈRES DE DÉCISION RESTENT VISIBLES ET CLIQUABLES. */
for (let zoom = 0; zoom <= 20; zoom++) {
  const cote = coteDecision(30, echelleZoom(zoom));
  exige(
    cote >= COTE_CLIQUABLE_MIN,
    'un repère de décision devient trop petit pour être cliqué',
    `zoom ${zoom} -> ${cote} px (minimum ${COTE_CLIQUABLE_MIN})`,
  );
  /* Et il ne grossit jamais au-delà de sa taille de référence. */
  exige(cote <= 30, 'un repère de décision dépasse sa taille de référence', `zoom ${zoom} -> ${cote} px`);
}

/* Il RÉTRÉCIT bien : sans cela le plancher masquerait une règle inerte. */
exige(
  coteDecision(30, echelleZoom(6)) < coteDecision(30, echelleZoom(13)),
  'les repères de décision ne rétrécissent pas quand on s’éloigne',
  `zoom 6 -> ${coteDecision(30, echelleZoom(6))} px, zoom 13 -> ${coteDecision(30, echelleZoom(13))} px`,
);

/* L'échelle est monotone : approcher ne doit jamais rapetisser un repère. */
for (let zoom = 1; zoom <= 20; zoom++) {
  exige(
    echelleDecision(echelleZoom(zoom)) >= echelleDecision(echelleZoom(zoom - 1)),
    'l’échelle des repères n’est pas monotone',
    `zoom ${zoom - 1} -> ${zoom}`,
  );
}

/* Une échelle absurde ne doit pas produire d'icône absurde. */
for (const absurde of [undefined, null, NaN, -3, 0]) {
  const cote = coteDecision(30, absurde);
  exige(
    cote >= COTE_CLIQUABLE_MIN && cote <= 30,
    'une échelle absurde produit une icône absurde',
    `${String(absurde)} -> ${cote} px`,
  );
}

/* Le côté est un entier : un demi-pixel décale l'ancre, donc le clic. */
for (let zoom = 0; zoom <= 20; zoom++) {
  const cote = coteDecision(30, echelleZoom(zoom));
  exige(Number.isInteger(cote), 'le côté d’une icône n’est pas entier', `zoom ${zoom} -> ${cote}`);
}

/* 3 — LE BANDEAU DE MODE NE RECOUVRE RIEN. */

/**
 * LE DÉFAUT : le bandeau « VERSION DE DÉMONSTRATION » se pose en haut au
 * centre, au-dessus de tout (`z-3000`), et la barre de recherche de la carte
 * occupait exactement le même endroit (`left-1/2 top-3`). En démonstration, la
 * recherche était donc INVISIBLE — présente, utilisable au clavier, mais
 * cachée. Les colonnes de panneaux, à la même hauteur, se faisaient recouvrir
 * de même dès que la fenêtre se resserrait.
 *
 * La bande qu'il occupe est désormais RÉSERVÉE : `--gr-bandeau` vaut 32px en
 * démonstration, zéro en production, et `.gr-haut` en décale tout ce qui se
 * range en haut de la carte.
 *
 * CE QUE CE CONTRÔLE VÉRIFIE. Le mobilier de carte se reconnaît à sa couche :
 * `z-[1050]` et `z-1000`. Chacun de ces conteneurs doit s'ancrer EN BAS
 * (`bottom-…`, hors d'atteinte du bandeau) ou porter `.gr-haut`. Écrire `top-3`
 * ici, c'est replacer un élément sous le bandeau — et c'est précisément la
 * faute qu'on vient de corriger.
 */
{
  const dossiers = [join(ROOT, 'src'), join(ROOT, 'src', 'components', 'map')];
  const COUCHES = ['z-[1050]', 'z-[1200]', 'z-1000'];

  for (const dossier of dossiers) {
    for (const nom of readdirSync(dossier)) {
      if (!nom.endsWith('.jsx')) continue;
      const texte = readFileSync(join(dossier, nom), 'utf8');

      for (const ligne of texte.split('\n')) {
        if (!COUCHES.some((c) => ligne.includes(c))) continue;
        if (!ligne.includes('absolute')) continue;

        const ancreEnHaut = / top-\d/.test(ligne);
        const reserve = ligne.includes('gr-haut');

        exige(
          !ancreEnHaut || reserve,
          'un élément du mobilier de carte se pose sous le bandeau de mode',
          `${nom} — ajoutez « gr-haut » et retirez « top-… » : ${ligne.trim().slice(0, 70)}`,
        );
      }
    }
  }
}

console.log('');
console.log(`Règles de lisibilité       : ${lisibilite.toLocaleString('fr-FR')}`);
console.log(`Fautes de lisibilité       : ${fautes.length}`);
if (fautes.length) {
  console.error('');
  for (const f of fautes.slice(0, 10)) console.error(`  ${f}`);
  if (fautes.length > 10) console.error(`  … et ${fautes.length - 10} autre(s)`);
  console.error('\nLa carte redevient illisible.\n');
  process.exit(1);
}

console.log('');
console.log(`Positions éprouvées        : ${cas.toLocaleString('fr-FR')}`);
console.log(`Bulles hors cadre après    : ${echecs}`);
console.log(`Déplacements inutiles      : ${deplacementsInutiles}`);

if (echecs || deplacementsInutiles) {
  console.error('\nLe recadrage des bulles est en défaut.\n');
  process.exit(1);
}

console.log('\nToute bulle finit dans le cadre, et celles qui y étaient ne bougent pas.\n');
