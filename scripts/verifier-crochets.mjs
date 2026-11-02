#!/usr/bin/env node
/**
 * UN CROCHET LIT-IL UNE VALEUR DÉCLARÉE APRÈS UNE SORTIE ANTICIPÉE ?
 *
 * LE PLANTAGE QUE CE CONTRÔLE EMPÊCHE, mot pour mot :
 *
 *     Uncaught ReferenceError: Cannot access 'proteges' before initialization
 *
 * Toute l'application tombait. Le mécanisme est court et se reproduit très
 * facilement :
 *
 *   1. un composant enregistre `useEffect(() => { … proteges … })` ;
 *   2. plus bas vient `if (!open) return null;` ;
 *   3. plus bas encore, `const proteges = …`.
 *
 * Sur un rendu REPLIÉ, l'exécution s'arrête au `return` : la constante n'est
 * jamais évaluée. Mais l'effet, lui, a été enregistré AVANT — React l'exécute
 * donc après le rendu, et il touche une liaison en zone morte.
 *
 * Ce qui rend la faute redoutable, c'est qu'elle dort. Il faut un rendu replié
 * AVEC des données en mémoire pour la réveiller. Dans le panneau OPTIMISATION,
 * ce chemin est resté inatteignable jusqu'au jour où deux autres corrections
 * l'ont ouvert : CALCULER ne fonctionnait pas, et TERMINER ne fermait pas la
 * section. Le premier calcul suivi d'une fermeture a fait tomber l'application.
 *
 * POURQUOI PAS ESLINT SEUL. `no-use-before-define` est actif, mais avec
 * `variables: false` — il ignore les références venues d'une portée imbriquée,
 * et le corps d'un crochet en est une. Passer à `variables: true` signale bien
 * la faute, MAIS aussi onze usages parfaitement sains : un `etapes` cité dans
 * un gestionnaire de clic, une constante de module employée dans un composant
 * défini plus haut. Un gestionnaire ne peut pas se déclencher pendant qu'un
 * panneau est replié ; le corps d'un crochet, lui, s'exécute toujours. Ce
 * script ne regarde donc QUE les corps de crochets — zéro faux positif, et il
 * dit précisément quoi déplacer.
 *
 *   node scripts/verifier-crochets.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Une sortie anticipée de premier niveau : `  if (…) return null;`. */
const SORTIE = /^ {2}if \([^)]*\) return\b/;
/** Une déclaration de premier niveau : `  const x = …` ou `  const { x, y } = …`. */
const DECL = /^ {2}(?:const|let) (\{[^}]*\}|[A-Za-z_$][A-Za-z0-9_$]*)/;
/** L'ouverture d'un composant ou d'un crochet personnalisé. */
const COMPOSANT = /^(?:export\s+)?(?:default\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;
const CROCHET = /\b(useEffect|useMemo|useCallback|useLayoutEffect)\(/g;

let examines = 0;
const fautes = [];

/** Les noms liés par une déclaration, déstructuration comprise. */
function nomsDe(capture) {
  if (!capture.startsWith('{')) return [capture];
  return capture
    .slice(1, -1)
    .split(',')
    .map((p) => p.split(':').pop().trim())
    .filter((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
}

/**
 * Les corps de crochets d'un texte, par équilibrage de parenthèses.
 *
 * Un balayage à la ligne ne suffirait pas : ces corps font parfois deux cents
 * lignes et contiennent des parenthèses à foison.
 */
function corpsDeCrochets(texte) {
  const corps = [];
  CROCHET.lastIndex = 0;
  let m;
  while ((m = CROCHET.exec(texte)) !== null) {
    const debut = m.index + m[0].length - 1; // sur la '('
    let profondeur = 0;
    let j = debut;
    for (; j < texte.length; j++) {
      if (texte[j] === '(') profondeur++;
      else if (texte[j] === ')') {
        profondeur--;
        if (profondeur === 0) break;
      }
    }
    corps.push({ nom: m[1], texte: texte.slice(debut, j + 1) });
    CROCHET.lastIndex = debut + 1;
  }
  return corps;
}

/**
 * La première instruction du corps est-elle `if (!open) return;` ?
 *
 * On saute l'en-tête `() => {`, les lignes vides et les commentaires, puis on
 * regarde la première ligne de code — et elle seule.
 */
function renonceSiReplie(texte) {
  const lignes = texte.split('\n');
  /* On suit l'ouverture et la fermeture des blocs de commentaire : leurs
     lignes de continuation ne commencent pas forcément par une étoile, et les
     prendre pour du code faisait échouer la reconnaissance. */
  let dansBloc = false;
  for (let i = 1; i < lignes.length; i++) {
    const nue = lignes[i].trim();
    if (dansBloc) {
      if (nue.includes('*/')) dansBloc = false;
      continue;
    }
    if (!nue || nue.startsWith('//')) continue;
    if (nue.startsWith('/*')) {
      if (!nue.includes('*/')) dansBloc = true;
      continue;
    }
    return /^if \(!open\) return;$/.test(nue);
  }
  return false;
}

/**
 * Le texte, commentaires retirés — ils NOMMENT souvent la faute qu'ils
 * expliquent, et une explication n'est pas une capture.
 *
 * ON SUIT L'ÉTAT DU BLOC, et non le seul début de ligne. Ce dépôt écrit
 * volontiers des blocs dont les lignes de continuation ne portent pas
 * d'étoile ; les prendre pour du code laissait passer de fausses captures et,
 * pire, faisait échouer la reconnaissance du renoncement `if (!open) return;`
 * placé juste après un tel bloc.
 */
function sansCommentaires(lignes) {
  let dansBloc = false;
  return lignes.map((l) => {
    const nue = l.trim();
    if (dansBloc) {
      if (nue.includes('*/')) dansBloc = false;
      return '';
    }
    if (nue.startsWith('//')) return '';
    if (nue.startsWith('/*') || nue.startsWith('*')) {
      if (nue.startsWith('/*') && !nue.includes('*/')) dansBloc = true;
      return '';
    }
    return l;
  });
}

/**
 * DÉCOUPAGE PAR COMPOSANT — c'est ce qui supprime les faux positifs.
 *
 * `GendarmerieMap.jsx` et `Parcours.jsx` déclarent une dizaine de composants
 * chacun, et des noms courants (`map`, `ref`, `cadre`) y sont redéclarés dans
 * plusieurs. Comparer un `return` d'un composant aux constantes d'un autre
 * signalait des fautes qui n'existent pas. On ne compare donc jamais au-delà
 * des bornes d'une même fonction.
 */
function composants(lignes) {
  const trouves = [];
  for (let i = 0; i < lignes.length; i++) {
    const m = lignes[i].match(COMPOSANT);
    if (!m) continue;
    /* La fonction finit à la première accolade fermante en colonne 0. */
    let fin = lignes.length;
    for (let j = i + 1; j < lignes.length; j++) {
      if (lignes[j] === '}') {
        fin = j;
        break;
      }
    }
    trouves.push({ nom: m[1], debut: i, fin });
    i = fin;
  }
  return trouves;
}

for (const fichier of readdirSync(SRC)) {
  if (!/\.jsx?$/.test(fichier)) continue;
  const lignes = readFileSync(join(SRC, fichier), 'utf8').replace(/\r/g, '').split('\n');
  const nues = sansCommentaires(lignes);

  for (const c of composants(lignes)) {
    const corps = nues.slice(c.debut, c.fin);

    const iSortie = corps.findIndex((l) => SORTIE.test(l));
    if (iSortie === -1) continue;
    examines++;

    /* Ce qui est déclaré APRÈS la sortie, dans CE composant. */
    const apres = [];
    for (let i = iSortie + 1; i < corps.length; i++) {
      const m = corps[i].match(DECL);
      if (m) apres.push(...nomsDe(m[1]));
    }
    if (!apres.length) continue;

    /* Les crochets enregistrés AVANT la sortie. */
    const avant = corps.slice(0, iSortie).join('\n');
    for (const crochet of corpsDeCrochets(avant)) {
      /**
       * UN CROCHET QUI RENONCE D'ABORD EST HORS DE CAUSE.
       *
       * Si sa PREMIÈRE instruction est `if (!open) return;`, il ne peut rien
       * lire sur un rendu replié — donc rien toucher en zone morte. C'est la
       * bonne réponse quand le crochet n'a de sens que panneau ouvert : faire
       * avancer une étape d'un parcours invisible n'en a aucun.
       *
       * « PREMIÈRE » compte : un renoncement placé après une lecture ne
       * protège de rien, et cette vérification ne l'accepterait pas.
       */
      if (renonceSiReplie(crochet.texte)) continue;

      for (const nom of apres) {
        if (!new RegExp(`\\b${nom}\\b`).test(crochet.texte)) continue;
        fautes.push(
          `${fichier} · ${c.nom} — ${crochet.nom} lit « ${nom} », déclaré après la ` +
            `sortie anticipée (ligne ${c.debut + iSortie + 1})`,
        );
      }
    }
  }
}

console.log('');
console.log(`Composants à sortie anticipée : ${examines}`);
console.log(`Crochets en zone morte        : ${fautes.length}`);

if (fautes.length) {
  console.error('');
  for (const f of fautes.slice(0, 12)) console.error(`  ${f}`);
  if (fautes.length > 12) console.error(`  … et ${fautes.length - 12} autre(s)`);
  console.error(
    '\nDéplacez le crochet APRÈS les valeurs qu’il lit, ou ces valeurs avant la\n' +
      'sortie. Sinon un rendu replié fera tomber l’application.\n',
  );
  process.exit(1);
}

console.log('\nAucun crochet ne lit une valeur déclarée après une sortie anticipée.\n');
