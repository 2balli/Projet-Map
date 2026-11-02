#!/usr/bin/env node
/**
 * CONTRÔLE DES CLASSES TAILWIND À VALEUR ARBITRAIRE.
 *
 * LE DÉFAUT REDOUTÉ : une classe écrite dans le source dont Tailwind ne
 * comprend pas la valeur. Il n'émet alors AUCUNE règle, sans erreur et sans
 * avertissement. Le build passe, le contrôle de portée passe, le rendu passe
 * — et la mise en page est fausse. Pour une contrainte de largeur, elle n'est
 * fausse que sur les écrans étroits : personne au bureau ne le voit.
 *
 * CE QUE LE SCRIPT FAIT : il relève toutes les classes à valeur arbitraire
 * employées dans `src/`, puis vérifie que chacune a bien produit un sélecteur
 * dans le CSS construit.
 *
 *   npm run build            (le CSS doit exister)
 *   node scripts/verifier-classes.mjs
 *
 * CE QUE CELA ATTRAPE, ÉPROUVÉ : une valeur structurellement cassée —
 * `max-w-[calc(100vw-2rem]`, `text-[rgb(1,2]` — que Tailwind laisse tomber en
 * silence.
 *
 * CE QUE CELA N'ATTRAPE PAS : une valeur bien formée mais absurde. Tailwind
 * accepte `w-[12quux]` et en écrit la règle ; c'est le navigateur qui
 * l'ignorera. Ce script vérifie que la valeur a été COMPRISE, pas qu'elle a
 * un sens.
 *
 * À NOTER, parce que c'est contre-intuitif : Tailwind scanne le TEXTE BRUT des
 * fichiers, commentaires compris. Une classe citée dans une phrase produit
 * donc sa règle comme si elle était employée. C'est aussi ce qui rend ce
 * contrôle fiable : il compare exactement les deux mêmes textes.
 *
 * Le dépôt ne porte aujourd'hui aucune classe muette. Ce script est une
 * barrière, pas un correctif.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'assets');

if (!existsSync(DIST)) {
  console.error('\ndist/assets absent : lancez « npm run build » d’abord.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Le CSS construit                                                   */
/* ------------------------------------------------------------------ */

const css = readdirSync(DIST)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(DIST, f), 'utf8'))
  .join('\n');

if (!css) {
  console.error('\nAucun fichier CSS dans dist/assets.\n');
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Les classes employées dans les sources                             */
/* ------------------------------------------------------------------ */

/** Tous les fichiers de source scannés par Tailwind. */
function sources(dossier) {
  const trouves = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) trouves.push(...sources(chemin));
    else if (/\.(jsx?|css)$/.test(nom)) trouves.push(chemin);
  }
  return trouves;
}

/**
 * LES RACINES D'UTILITAIRES, ÉNUMÉRÉES À LA MAIN.
 *
 * Un motif large (« un mot, puis des crochets ») attrapait l'indexation
 * JavaScript : `pts[i]`, `coordinates[1]`, `tons[ton]` — une centaine de faux
 * positifs, donc un contrôle inexploitable. Distinguer une classe d'une lecture
 * de tableau demande de savoir ce qu'est une classe, d'où cette liste, qui dit
 * exactement ce que le dépôt emploie.
 *
 * Une racine absente de la liste ne produit pas de faux positif : elle produit
 * un angle mort. Ajoutez-la en même temps que la classe.
 */
const RACINES = [
  'w', 'h', 'size', 'min-w', 'min-h', 'max-w', 'max-h', 'basis',
  'top', 'bottom', 'left', 'right', 'inset', 'inset-x', 'inset-y', 'z',
  'p', 'px', 'py', 'pt', 'pb', 'pl', 'pr',
  'm', 'mx', 'my', 'mt', 'mb', 'ml', 'mr',
  'gap', 'gap-x', 'gap-y', 'space-y', 'space-x',
  'text', 'leading', 'tracking', 'font', 'indent',
  'bg', 'border', 'border-t', 'border-b', 'border-l', 'border-r', 'rounded',
  'shadow', 'ring', 'outline', 'outline-offset', 'opacity', 'fill', 'stroke',
  'grid-cols', 'grid-rows', 'col-span', 'row-span', 'order',
  'translate-x', 'translate-y', 'scale', 'rotate', 'duration', 'delay',
  'backdrop-blur', 'blur', 'aspect',
];

/**
 * LE TIRET AVANT LE CROCHET — ce qui distingue une classe d'un tableau.
 *
 * Une valeur arbitraire Tailwind s'écrit TOUJOURS `racine-[valeur]` :
 * `w-[368px]`, `max-w-[calc(100vw-2rem)]`, `text-[12px]`. L'indexation
 * JavaScript, elle, n'a jamais de tiret : `m[champ]`, `p[0]`, `pts[i]`.
 *
 * Exiger `-[` élimine donc d'un coup tous les faux positifs, sans liste
 * d'exceptions et sans deviner si le contenu des crochets ressemble à une
 * valeur CSS.
 *
 * La frontière en tête (espace, guillemet, accent grave, accolade, parenthèse)
 * exclut en plus `obj.prop-[…]`, qui n'existe pas mais ne coûte rien.
 *
 * NON COUVERT, à dessein : les variantes arbitraires (`[&>*]:…`) et les
 * propriétés arbitraires (`[mask-type:luminance]`), que le dépôt n'emploie
 * pas. Le jour où il en emploiera une, ce script ne la verra pas — c'est un
 * angle mort connu, pas une erreur silencieuse.
 */
const MOTIF = new RegExp(
  '(?<=^|[\\s"\'`{(])((?:[a-z][a-z-]*:)*-?(?:' +
    RACINES.join('|') +
    ')-\\[[^\\s"\'`]+?\\])',
  'g',
);

/**
 * Le sélecteur CSS échappe les caractères spéciaux. Plutôt que de reproduire
 * l'échappement de Tailwind — qui a ses propres règles — on retire TOUS les
 * antislashs du CSS une fois pour toutes, puis on cherche la classe telle
 * qu'elle est écrite dans le source. Un faux positif serait possible en
 * théorie ; en pratique un nom de classe complet est trop spécifique pour se
 * trouver par hasard.
 */
const cssSansEchappement = css.replace(/\\/g, '');

const employees = new Map(); // classe -> [fichiers]

for (const f of sources(join(ROOT, 'src'))) {
  const texte = readFileSync(f, 'utf8');
  for (const brut of texte.match(MOTIF) ?? []) {
    const court = f.replace(ROOT + '\\', '').replace(ROOT + '/', '').replace(/\\/g, '/');
    if (!employees.has(brut)) employees.set(brut, []);
    if (!employees.get(brut).includes(court)) employees.get(brut).push(court);
  }
}

/* ------------------------------------------------------------------ */

const muettes = [];
for (const [classe, fichiers] of employees) {
  if (!cssSansEchappement.includes('.' + classe)) muettes.push({ classe, fichiers });
}

console.log('');
console.log(`Classes arbitraires relevées : ${employees.size}`);
console.log(`Sans règle CSS produite      : ${muettes.length}`);

if (muettes.length) {
  console.error('');
  for (const m of muettes.slice(0, 20)) {
    console.error(`  ${m.classe}`);
    console.error(`      ${m.fichiers.join(', ')}`);
  }
  if (muettes.length > 20) console.error(`  … et ${muettes.length - 20} autre(s)`);
  console.error(
    '\nCes classes ne produisent aucune règle : Tailwind ne comprend pas leur' +
      '\nvaleur. Cherchez une parenthèse non fermée ou une virgule mal placée,' +
      '\nou passez par le thème.\n',
  );
  process.exit(1);
}

console.log('\nToute classe arbitraire employée produit bien sa règle CSS.\n');
