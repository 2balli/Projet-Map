/**
 * Ordre de visite d'une tournée — fonction pure, sans MapLibre ni DOM.
 *
 * Le départ est la première étape. Jusqu'à HELD_KARP_MAX étapes, l'ordre est
 * exact (programmation dynamique de Held-Karp) ; au-delà, plus proche voisin
 * puis améliorations 2-opt.
 */

const HELD_KARP_MAX = 12;

const valeur = (c) => (c == null ? Infinity : typeof c === 'number' ? c : c.cout);

/** Coût total d'un ordre (avec le retour au départ si `boucle`). */
export function coutOrdre(couts, ordre, boucle = false) {
  let total = 0;
  for (let i = 1; i < ordre.length; i++) total += couts[ordre[i - 1]][ordre[i]];
  if (boucle && ordre.length > 1) total += couts[ordre.at(-1)][ordre[0]];
  return total;
}

function heldKarp(c, boucle) {
  const n = c.length;
  const m = n - 1; // étapes hors départ : bits 0..m-1 ↔ indices 1..n-1
  const pleins = 1 << m;
  const dp = new Float64Array(pleins * m).fill(Infinity);
  const prec = new Int8Array(pleins * m).fill(-1);
  for (let j = 0; j < m; j++) dp[(1 << j) * m + j] = c[0][j + 1];
  for (let masque = 1; masque < pleins; masque++) {
    for (let j = 0; j < m; j++) {
      const d = dp[masque * m + j];
      if (!(masque & (1 << j)) || d === Infinity) continue;
      for (let k = 0; k < m; k++) {
        if (masque & (1 << k)) continue;
        const suivant = masque | (1 << k);
        const essai = d + c[j + 1][k + 1];
        if (essai < dp[suivant * m + k]) {
          dp[suivant * m + k] = essai;
          prec[suivant * m + k] = j;
        }
      }
    }
  }
  const tous = pleins - 1;
  let fin = -1;
  let meilleur = Infinity;
  for (let j = 0; j < m; j++) {
    const total = dp[tous * m + j] + (boucle ? c[j + 1][0] : 0);
    if (total < meilleur) {
      meilleur = total;
      fin = j;
    }
  }
  if (fin < 0) return null; // une étape injoignable : l'heuristique donne au moins un ordre
  const ordre = [];
  for (let masque = tous, j = fin; j >= 0;) {
    ordre.unshift(j + 1);
    const p = prec[masque * m + j];
    masque &= ~(1 << j);
    j = p;
  }
  return [0, ...ordre];
}

function heuristique(c, boucle) {
  const n = c.length;
  const ordre = [0];
  const restants = new Set(Array.from({ length: n - 1 }, (_, i) => i + 1));
  while (restants.size) {
    const dernier = ordre.at(-1);
    let choix = null;
    for (const j of restants) if (choix === null || c[dernier][j] < c[dernier][choix]) choix = j;
    ordre.push(choix);
    restants.delete(choix);
  }
  // 2-opt : inverser un morceau [i, k] tant que cela raccourcit (le départ reste en tête).
  let ameliore = true;
  let meilleur = coutOrdre(c, ordre, boucle);
  while (ameliore) {
    ameliore = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const essai = [...ordre.slice(0, i), ...ordre.slice(i, k + 1).reverse(), ...ordre.slice(k + 1)];
        const cout = coutOrdre(c, essai, boucle);
        if (cout + 1e-9 < meilleur) {
          ordre.splice(0, n, ...essai);
          meilleur = cout;
          ameliore = true;
        }
      }
    }
  }
  return ordre;
}

/**
 * Ordre de visite au moindre coût total, en partant de l'étape 0.
 * @param {(number | { cout: number } | null)[][]} matrice  coûts deux à deux (null : pas de route)
 * @param {{ boucle?: boolean }} options  `boucle` : retour au départ à la fin
 * @returns {{ ordre: number[], cout: number }}  `cout` : Infinity si une étape est injoignable
 */
export function ordreOptimal(matrice, { boucle = false } = {}) {
  const n = matrice.length;
  const c = matrice.map((ligne) => ligne.map(valeur));
  const ordre = n <= 2 ? Array.from({ length: n }, (_, i) => i)
    : (n <= HELD_KARP_MAX ? heldKarp(c, boucle) : null) ?? heuristique(c, boucle);
  return { ordre, cout: coutOrdre(c, ordre, boucle) };
}
