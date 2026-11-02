/**
 * Distance réelle par la route — côté serveur.
 *
 * MÊME ALGORITHME que `src/routage.js` (accrochage au réseau + A*), copié plutôt
 * qu'importé : `scripts/package-intranet.mjs` ne recopie que `serveur/` dans le
 * paquet livré (`cpSync(serveur, ...)`), un `import '../src/routage.js'` casserait
 * donc le serveur une fois empaqueté. Toute correction de l'algorithme doit être
 * répercutée dans les deux fichiers.
 *
 * Seul le nécessaire au calcul de distance/itinéraire est repris ici — le
 * formatage (`formatKm`, `formatDuree`) ne sert qu'à l'affichage navigateur.
 */

const R_TERRE = 6371.0088; // km
const rad = (d) => (d * Math.PI) / 180;

/** Distance géodésique en kilomètres. */
export function distanceKm(lng1, lat1, lng2, lat2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.sqrt(a));
}

const longueurPolyligne = (pairs) => {
  let d = 0;
  for (let i = 1; i < pairs.length; i++) {
    d += distanceKm(pairs[i - 1][0], pairs[i - 1][1], pairs[i][0], pairs[i][1]);
  }
  return d;
};

/* ================================================================== */
/*  Décodage du graphe                                                */
/* ================================================================== */

const PAS_GRILLE = 0.05;
const cleCase = (ix, iy) => ix * 100000 + iy;

export function chargerGraphe(json) {
  const nS = json.sommets.length;
  const X = new Float64Array(nS);
  const Y = new Float64Array(nS);
  json.sommets.forEach(([x, y], i) => {
    X[i] = x;
    Y[i] = y;
  });

  const brut = json.aretes;
  const nA = brut.length;

  const A = new Int32Array(nA);
  const B = new Int32Array(nA);
  const M = new Float32Array(nA); // mètres
  const CLS = new Uint8Array(nA);
  const REF = new Int32Array(nA);
  const SENS = new Int8Array(nA);
  const VIT = new Uint8Array(nA);

  const offsets = new Int32Array(nA + 1);
  let total = 0;
  for (let i = 0; i < nA; i++) {
    offsets[i] = total;
    total += brut[i].length - 7;
  }
  offsets[nA] = total;
  const GEOM = new Float64Array(total);

  for (let i = 0; i < nA; i++) {
    const e = brut[i];
    A[i] = e[0];
    B[i] = e[1];
    M[i] = e[2];
    CLS[i] = e[3];
    REF[i] = e[4];
    SENS[i] = e[5];
    VIT[i] = e[6];
    for (let k = 7; k < e.length; k++) GEOM[offsets[i] + k - 7] = e[k];
  }

  const debuts = new Int32Array(nS + 1);
  for (let i = 0; i < nA; i++) {
    debuts[A[i] + 1]++;
    debuts[B[i] + 1]++;
  }
  for (let s = 0; s < nS; s++) debuts[s + 1] += debuts[s];
  const incident = new Int32Array(debuts[nS]);
  const curseur = Int32Array.from(debuts.subarray(0, nS));
  for (let i = 0; i < nA; i++) {
    incident[curseur[A[i]]++] = i;
    incident[curseur[B[i]]++] = i;
  }

  const g = {
    X, Y, A, B, M, CLS, REF, SENS, VIT,
    GEOM, offsets, debuts, incident,
    classes: json.classes,
    refs: json.refs,
    /* Noms de voie (graphe importé de Geofabrik) : table annexe facultative,
       absente des graphes plus anciens. */
    noms: json.noms ?? null,
    NOM: json.aretesNoms ? Int32Array.from(json.aretesNoms) : null,
    nS,
    nA,
    grille: new Map(),
    /* Boucle et non `Math.max(...VIT)` : étaler un million d'arêtes en
       arguments dépasse la pile d'appels. */
    vitesseMax: VIT.reduce((m, v) => (v > m ? v : m), Math.max(...json.vitesses)),
  };

  for (let i = 0; i < nA; i++) {
    for (const [x, y] of pointsArete(g, i)) {
      const c = cleCase(Math.floor(x / PAS_GRILLE), Math.floor(y / PAS_GRILLE));
      let lot = g.grille.get(c);
      if (!lot) g.grille.set(c, (lot = []));
      if (lot[lot.length - 1] !== i) lot.push(i);
    }
  }

  return g;
}

export function pointsArete(g, i) {
  const out = [[g.X[g.A[i]], g.Y[g.A[i]]]];
  for (let k = g.offsets[i]; k < g.offsets[i + 1]; k += 2) {
    out.push([g.GEOM[k], g.GEOM[k + 1]]);
  }
  out.push([g.X[g.B[i]], g.Y[g.B[i]]]);
  return out;
}

export const refArete = (g, i) => (g.REF[i] >= 0 ? g.refs[g.REF[i]] : null);
/** Nom de la voie (« Avenue Mohammed V »), ou `null` si le graphe n'en porte pas. */
export const nomArete = (g, i) => (g.NOM && g.NOM[i] >= 0 ? g.noms[g.NOM[i]] : null);
export const classeArete = (g, i) => g.classes[g.CLS[i]];

/* ================================================================== */
/*  Accrochage d'un point au réseau                                   */
/* ================================================================== */

export function projeter(px, py, [ax, ay], [bx, by], cosLat) {
  const dx = (bx - ax) * cosLat;
  const dy = by - ay;
  const norme = dx * dx + dy * dy;
  let t = norme ? ((px - ax) * cosLat * dx + (py - ay) * dy) / norme : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * (bx - ax), ay + t * (by - ay), t];
}

export function accrocher(g, lng, lat, rayonMaxKm = 30) {
  const cosLat = Math.cos(rad(lat));
  const ix0 = Math.floor(lng / PAS_GRILLE);
  const iy0 = Math.floor(lat / PAS_GRILLE);
  const anneauMax = Math.ceil(rayonMaxKm / (PAS_GRILLE * 111));

  const vues = new Set();
  let meilleur = null;

  for (let anneau = 0; anneau <= anneauMax; anneau++) {
    if (meilleur && (anneau - 1) * PAS_GRILLE * 111 * Math.max(0.2, cosLat) > meilleur.ecartKm) {
      break;
    }

    for (let dx = -anneau; dx <= anneau; dx++) {
      for (let dy = -anneau; dy <= anneau; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== anneau) continue;
        const lot = g.grille.get(cleCase(ix0 + dx, iy0 + dy));
        if (!lot) continue;

        for (const i of lot) {
          if (vues.has(i)) continue;
          vues.add(i);

          const pairs = pointsArete(g, i);
          for (let k = 1; k < pairs.length; k++) {
            const [px, py, t] = projeter(lng, lat, pairs[k - 1], pairs[k], cosLat);
            const ecart = distanceKm(lng, lat, px, py);
            if (meilleur && ecart >= meilleur.ecartKm) continue;

            const avant =
              longueurPolyligne(pairs.slice(0, k)) +
              distanceKm(pairs[k - 1][0], pairs[k - 1][1], px, py) * (t > 0 ? 1 : 0);
            const totale = longueurPolyligne(pairs);

            meilleur = {
              arete: i,
              lng: px,
              lat: py,
              iSeg: k,
              versA: avant,
              versB: Math.max(0, totale - avant),
              ecartKm: ecart,
            };
          }
        }
      }
    }
  }

  return meilleur && meilleur.ecartKm <= rayonMaxKm ? meilleur : null;
}

function portion(g, acc, vers) {
  const pairs = pointsArete(g, acc.arete);
  const P = [acc.lng, acc.lat];
  return vers === 'B'
    ? [P, ...pairs.slice(acc.iSeg)]
    : [P, ...pairs.slice(0, acc.iSeg).reverse()];
}

/* ================================================================== */
/*  Tas binaire                                                       */
/* ================================================================== */

/* Exporté pour le référentiel kilométrique (serveur/pointKilometrique.mjs),
   qui parcourt le tracé d'UNE route avec le même tas plutôt qu'une copie. */
export class Tas {
  #cles = [];
  #vals = [];

  get taille() {
    return this.#vals.length;
  }

  pousser(cle, val) {
    this.#cles.push(cle);
    this.#vals.push(val);
    let i = this.#vals.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.#cles[p] <= this.#cles[i]) break;
      this.#echanger(p, i);
      i = p;
    }
  }

  extraire() {
    const val = this.#vals[0];
    const dernier = this.#vals.length - 1;
    this.#echanger(0, dernier);
    this.#cles.pop();
    this.#vals.pop();

    let i = 0;
    for (;;) {
      const g = 2 * i + 1;
      const d = g + 1;
      let min = i;
      if (g < this.#cles.length && this.#cles[g] < this.#cles[min]) min = g;
      if (d < this.#cles.length && this.#cles[d] < this.#cles[min]) min = d;
      if (min === i) break;
      this.#echanger(i, min);
      i = min;
    }
    return val;
  }

  #echanger(i, j) {
    [this.#cles[i], this.#cles[j]] = [this.#cles[j], this.#cles[i]];
    [this.#vals[i], this.#vals[j]] = [this.#vals[j], this.#vals[i]];
  }
}

/* ================================================================== */
/*  Itinéraire                                                        */
/* ================================================================== */

function praticable(g, i, depuis) {
  const sens = g.SENS[i];
  if (sens === 0) return true;
  return sens === 1 ? g.A[i] === depuis : g.B[i] === depuis;
}

/**
 * TAMPONS DE L'A*, UN JEU PAR GRAPHE, RÉUTILISÉ D'UN APPEL À L'AUTRE.
 *
 * Allouer et remplir deux tableaux de la taille du graphe à chaque appel
 * coûtait plus que la recherche elle-même, bornée à quelques kilomètres : sur
 * l'optimisation automatique, un tiers du temps de calcul. Un tampon de
 * génération dit quels sommets ont déjà été touchés par l'appel en cours ; les
 * autres valent « coût infini, non clos », comme un tableau neuf.
 *
 * `itineraire` est synchrone et ne se rappelle pas lui-même : un seul jeu suffit.
 */
const tamponsAStar = new WeakMap();
function tamponsDe(g) {
  let t = tamponsAStar.get(g);
  if (!t) {
    t = { cout: new Float64Array(g.nS), clos: new Uint8Array(g.nS), vu: new Uint32Array(g.nS), gen: 0 };
    tamponsAStar.set(g, t);
  }
  if (++t.gen === 0xffffffff) {
    t.vu.fill(0);
    t.gen = 1;
  }
  return t;
}

/**
 * Plus court chemin en DISTANCE (jamais en durée) entre deux points accrochés
 * au réseau — Dijkstra guidé (A*) par la distance à vol d'oiseau à l'arrivée,
 * qui ne surestime jamais le trajet restant.
 *
 * Version allégée de `itineraire` dans `src/routage.js` : seule la distance
 * sert ici (alertes de distance, génération de barrages) — pas le critère
 * rapide/court, pas la durée, pas le tracé ni le détail par type de route.
 *
 * @returns {{km:number}|null} — `null` si aucun chemin n'existe.
 */
export function itineraire(g, depart, arrivee, limiteKm = Infinity) {
  if (!depart || !arrivee) return null;

  if (depart.arete === arrivee.arete) {
    const km = Math.abs(arrivee.versA - depart.versA);
    return km < limiteKm ? { km } : null;
  }

  const finKm = new Map([
    [g.A[arrivee.arete], arrivee.versA],
    [g.B[arrivee.arete], arrivee.versB],
  ]);

  const { cout, clos, vu, gen } = tamponsDe(g);
  const toucher = (s) => {
    if (vu[s] !== gen) {
      vu[s] = gen;
      cout[s] = Infinity;
      clos[s] = 0;
    }
  };
  const cibles = [...finKm.keys()];
  const h = (s) => {
    let min = Infinity;
    for (const t of cibles) {
      const d = distanceKm(g.X[s], g.Y[s], g.X[t], g.Y[t]);
      if (d < min) min = d;
    }
    return min;
  };

  const tas = new Tas();
  for (const [s, km] of [
    [g.A[depart.arete], depart.versA],
    [g.B[depart.arete], depart.versB],
  ]) {
    toucher(s);
    if (km < cout[s]) {
      cout[s] = km;
      tas.pousser(km + h(s), s);
    }
  }

  let meilleurTotal = Infinity;

  while (tas.taille) {
    const s = tas.extraire();
    if (clos[s]) continue;
    clos[s] = 1;
    /* Pour une simple décision seuil/non-seuil, A* peut s'arrêter dès que
       même sa borne optimiste dépasse la limite demandée. */
    if (cout[s] + h(s) >= limiteKm && meilleurTotal >= limiteKm) break;

    if (finKm.has(s)) {
      const total = cout[s] + finKm.get(s);
      if (total < meilleurTotal) meilleurTotal = total;
    }
    if (cout[s] >= meilleurTotal) break;

    for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
      const i = g.incident[k];
      if (!praticable(g, i, s)) continue;
      const autre = g.A[i] === s ? g.B[i] : g.A[i];
      toucher(autre);
      if (clos[autre]) continue;

      const nouveau = cout[s] + g.M[i] / 1000;
      if (nouveau < cout[autre]) {
        cout[autre] = nouveau;
        tas.pousser(nouveau + h(autre), autre);
      }
    }
  }

  return Number.isFinite(meilleurTotal) ? { km: meilleurTotal } : null;
}

/**
 * ARBRE DES PLUS COURTS CHEMINS DEPUIS (OU VERS) UN POINT ACCROCHÉ, BORNÉ.
 *
 * Même graphe, même coût (longueur) et mêmes sens uniques que `itineraire` :
 *
 *   `inverse: false`  distance du point vers chaque sommet — le « retour »
 *                     d'un poste vers les autres ;
 *   `inverse: true`   distance de chaque sommet vers le point — l'« aller ».
 *
 * Un seul parcours donne la distance à TOUS les sommets à moins de `limiteKm`,
 * là où `itineraire` refait une recherche par couple de points : c'est ce qui
 * permet d'éprouver des milliers de positions candidates contre un même voisin
 * sans relancer un A* par candidat. Voir `distanceParArbres`.
 *
 * Les sommets au-delà de `limiteKm` peuvent porter une valeur provisoire, mais
 * jamais inférieure à la limite : tout sommet réellement plus proche a été
 * fixé avant l'arrêt.
 *
 * @returns {Map<number, number>} sommet → km
 */
export function arbreBorne(g, acc, { inverse = false, limiteKm = Infinity } = {}) {
  const dist = new Map();
  const clos = new Set();
  const tas = new Tas();
  /* Les départs reproduisent exactement ceux d'`itineraire` : dans le sens
     direct, les deux extrémités de l'arête d'accrochage ; dans le sens
     inverse, le `finKm` de l'arrivée (une Map : sur une arête bouclée, la
     seconde entrée remplace la première, comme là-bas). */
  const departs = inverse
    ? [...new Map([[g.A[acc.arete], acc.versA], [g.B[acc.arete], acc.versB]])]
    : [[g.A[acc.arete], acc.versA], [g.B[acc.arete], acc.versB]];
  for (const [s, km] of departs) {
    if (km < (dist.get(s) ?? Infinity)) {
      dist.set(s, km);
      tas.pousser(km, s);
    }
  }
  while (tas.taille) {
    const s = tas.extraire();
    if (clos.has(s)) continue;
    clos.add(s);
    const c = dist.get(s);
    if (c >= limiteKm) break;
    for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
      const i = g.incident[k];
      const autre = g.A[i] === s ? g.B[i] : g.A[i];
      /* Sens inverse : on remonte l'arête, elle doit donc être praticable
         depuis l'autre extrémité. */
      if (inverse ? !praticable(g, i, autre) : !praticable(g, i, s)) continue;
      if (clos.has(autre)) continue;
      const nouveau = c + g.M[i] / 1000;
      if (nouveau < (dist.get(autre) ?? Infinity)) {
        dist.set(autre, nouveau);
        tas.pousser(nouveau, autre);
      }
    }
  }
  return dist;
}

/**
 * Distance routière, minimum des deux sens, entre un point accroché `acc` et
 * le point dont on a les deux arbres (`vers` = arbre inverse, `depuis` = arbre
 * direct). Même résultat que le minimum de deux `itineraire`, y compris le cas
 * de la même arête (qui, là-bas aussi, ne mesure que l'écart le long d'elle).
 */
export function distanceParArbres(g, acc, cible, { vers, depuis }) {
  if (acc.arete === cible.arete) return Math.abs(cible.versA - acc.versA);
  const A = g.A[acc.arete];
  const B = g.B[acc.arete];
  const aller = Math.min(acc.versA + (vers.get(A) ?? Infinity), acc.versB + (vers.get(B) ?? Infinity));
  /* Le `finKm` d'`itineraire` est une Map : sur une arête bouclée (A = B),
     c'est `versB` qui reste. */
  const finA = A === B ? acc.versB : acc.versA;
  const retour = Math.min((depuis.get(A) ?? Infinity) + finA, (depuis.get(B) ?? Infinity) + acc.versB);
  return Math.min(aller, retour);
}
