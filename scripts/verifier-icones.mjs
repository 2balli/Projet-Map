/**
 * Toute icône UTILISÉE dans un fichier doit y être IMPORTÉE.
 *
 * Le build ne le voit pas : un identifiant absent n'est une erreur qu'à
 * l'exécution. Deux plantages sont partis de là — IconChevron, puis IconClose.
 *
 * Les commentaires sont retirés AVANT toute analyse : un bloc d'import du
 * projet en contient, virgules comprises, et les découper naïvement faisait
 * disparaître l'import qui suivait.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
const sansCommentaires = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dispo = new Set(
  [...readFileSync(join(SRC, 'icons.jsx'), 'utf8').matchAll(/export const (Icon\w+)/g)].map((m) => m[1])
);

let fautes = 0;
for (const f of readdirSync(SRC).filter((x) => /\.jsx?$/.test(x))) {
  if (f === 'icons.jsx') continue;
  const brut = readFileSync(join(SRC, f), 'utf8');
  const src = sansCommentaires(brut);

  /* `Icone` (sans majuscule après) est un nom de PROP dans ce projet, pas une
     icône du module : on ne retient que ce qui existe vraiment. */
  const utilisees = new Set(
    [...src.matchAll(/<(Icon[A-Z]\w*)[\s/>]/g)].map((m) => m[1]).filter((n) => dispo.has(n))
  );
  if (!utilisees.size) continue;

  const importe = new Set();
  for (const bloc of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const nom of bloc[1].split(',')) {
      const n = nom.trim();
      if (/^Icon[A-Z]\w*$/.test(n)) importe.add(n);
    }
  }

  const manquantes = [...utilisees].filter((i) => !importe.has(i));
  if (manquantes.length) {
    fautes++;
    console.log(`ÉCHEC ${f} — utilisée(s) sans import : ${manquantes.join(', ')}`);
  }
}
console.log(fautes ? `\n${fautes} fichier(s) en faute.` : 'Toutes les icônes utilisées sont importées.');
process.exit(fautes ? 1 : 0);
