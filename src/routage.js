/**
 * Calcul d'itinéraires sur le réseau routier réel — dans le navigateur.
 *
 * POURQUOI PAS OSRM : il faudrait déployer et maintenir un service C++ à côté
 * de l'application, avec sa phase de préparation en plusieurs Go. Le graphe d'un
 * pays réduit aux autoroutes, nationales, régionales et provinciales tient en
 * 4 Mo (voir scripts/build-roads.mjs) : un A* le parcourt ici en quelques
 * millisecondes, sans service supplémentaire, et les distances restent
 * calculables même quand l'application est servie en fichiers statiques.
 *
 * Deux critères :
 *   'rapide' — minimise la durée (longueur / vitesse de la route)
 *   'court'  — minimise la distance
 * Les deux valeurs sont toujours renvoyées : c'est le critère qui change, pas
 * ce qui est mesuré.
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

/** Côté de la grille d'index spatial, en degrés (~5 km). */
const PAS_GRILLE = 0.05;
const cleCase = (ix, iy) => ix * 100000 + iy;

/**
 * Transforme le JSON compact en structures de calcul.
 *
 * Les attributs deviennent des tableaux typés et la géométrie une seule liste
 * plate avec ses offsets : 65 000 arêtes tiennent alors dans quelques
 * mégaoctets contigus au lieu d'autant d'objets dispersés — c'est ce qui rend
 * le parcours rapide sans code compliqué.
 */
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

  /** Points intermédiaires, aplatis ; les 7 premiers champs sont les attributs. */
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

  /* --- Adjacence compressée (CSR) --- */
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

  /* --- Index spatial : quelles arêtes traversent quelle case --- */
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

/** Points d'une arête, de A vers B, extrémités comprises : [[lng, lat], …]. */
export function pointsArete(g, i) {
  const out = [[g.X[g.A[i]], g.Y[g.A[i]]]];
  for (let k = g.offsets[i]; k < g.offsets[i + 1]; k += 2) {
    out.push([g.GEOM[k], g.GEOM[k + 1]]);
  }
  out.push([g.X[g.B[i]], g.Y[g.B[i]]]);
  return out;
}

/** Nom lisible d'une arête : sa référence, sinon sa classe. */
export const refArete = (g, i) => (g.REF[i] >= 0 ? g.refs[g.REF[i]] : null);
/** Nom de la voie (« Avenue Mohammed V »), ou `null` si le graphe n'en porte pas. */
export const nomArete = (g, i) => (g.NOM && g.NOM[i] >= 0 ? g.noms[g.NOM[i]] : null);
export const classeArete = (g, i) => g.classes[g.CLS[i]];

/* ================================================================== */
/*  Accrochage d'un point au réseau                                   */
/* ================================================================== */

/** Projection d'un point sur un segment (plan local corrigé en longitude). */
function projeter(px, py, [ax, ay], [bx, by], cosLat) {
  const dx = (bx - ax) * cosLat;
  const dy = by - ay;
  const norme = dx * dx + dy * dy;
  let t = norme ? ((px - ax) * cosLat * dx + (py - ay) * dy) / norme : 0;
  t = Math.max(0, Math.min(1, t));
  return [ax + t * (bx - ax), ay + t * (by - ay), t];
}

/**
 * Accroche un point au réseau : arête la plus proche et position exacte dessus.
 *
 * L'accrochage porte sur l'ARÊTE, pas sur le sommet le plus proche : avec un
 * kilomètre en moyenne entre deux intersections, se contenter du sommet
 * ajouterait des centaines de mètres d'erreur à chaque extrémité du trajet.
 *
 * La recherche se fait en anneaux de cases successifs et s'arrête dès qu'un
 * anneau ne peut plus contenir mieux — inutile de balayer les 65 000 arêtes.
 *
 * @returns {{arete, lng, lat, iSeg, versA, versB, ecartKm}|null}
 */
export function accrocher(g, lng, lat, rayonMaxKm = 30) {
  const cosLat = Math.cos(rad(lat));
  const ix0 = Math.floor(lng / PAS_GRILLE);
  const iy0 = Math.floor(lat / PAS_GRILLE);
  const anneauMax = Math.ceil(rayonMaxKm / (PAS_GRILLE * 111));

  const vues = new Set();
  let meilleur = null;

  for (let anneau = 0; anneau <= anneauMax; anneau++) {
    /* Un anneau ne peut rien apporter s'il commence plus loin que le meilleur
       écart déjà obtenu. */
    if (meilleur && (anneau - 1) * PAS_GRILLE * 111 * Math.max(0.2, cosLat) > meilleur.ecartKm) {
      break;
    }

    for (let dx = -anneau; dx <= anneau; dx++) {
      for (let dy = -anneau; dy <= anneau; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== anneau) continue; // bord de l'anneau
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
              iSeg: k, // le point est sur le segment [k-1, k]
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

/* ================================================================== */
/*  Chaussées séparées : les deux sens d'une route à deux voies       */
/* ================================================================== */

/** Cap de circulation d'un segment (degrés, 0 = nord, sens horaire), dans le sens permis. */
function capSegment(g, i, k) {
  const pts = pointsArete(g, i);
  let a = pts[k - 1];
  let b = pts[k];
  if (g.SENS[i] !== 0 && g.SENS[i] !== 1) [a, b] = [b, a];
  const dl = rad(b[0] - a[0]);
  const y = Math.sin(dl) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const ecartCap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** « Aller » : la chaussée qui monte vers le nord ou l'est (cap 315° → 135°). */
const versAller = (cap) => cap >= 315 || cap < 135;

/**
 * LES DEUX CHAUSSÉES D'UNE ROUTE À DEUX VOIES, autour d'un point accroché.
 *
 * Une route à chaussées séparées (autoroute, voie express) est dans le graphe
 * comme DEUX arêtes à sens unique (`SENS` ≠ 0), parallèles et de sens
 * opposés. On cherche, à moins de `rayonKm` du point, une arête à sens unique
 * dont le cap de circulation est opposé (écart ≥ 135°) à celui de l'arête
 * accrochée — de même numéro de route de préférence.
 *
 * Rend `null` pour une route à chaussée unique (à double sens, ou sens unique
 * sans voie opposée proche) : il n'y a alors pas de choix à proposer.
 * Sinon `{ aller, retour }`, chacun `{ arete, lng, lat, cap, trace }` — la
 * position exacte sur SA chaussée et un bout de son tracé ([[lng, lat]…]).
 * « Aller » est la chaussée qui circule vers le nord ou l'est (cap de 315° à
 * 135°), « Retour » l'autre : une convention fixe, la même partout.
 *
 * @param {object} g graphe (chargerGraphe)
 * @param {{arete, lng, lat, iSeg}} acc résultat d'`accrocher`
 */
export function chausseesOpposees(g, acc, rayonKm = 0.08) {
  if (!g || !acc || g.SENS[acc.arete] === 0) return null;
  const e0 = acc.arete;
  const cap0 = capSegment(g, e0, acc.iSeg);
  const ref0 = g.REF[e0];
  const cosLat = Math.cos(rad(acc.lat));
  const ix0 = Math.floor(acc.lng / PAS_GRILLE);
  const iy0 = Math.floor(acc.lat / PAS_GRILLE);
  const vues = new Set([e0]);
  let meilleur = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const i of g.grille.get(cleCase(ix0 + dx, iy0 + dy)) ?? []) {
        if (vues.has(i) || g.SENS[i] === 0) continue;
        vues.add(i);
        const pts = pointsArete(g, i);
        for (let k = 1; k < pts.length; k++) {
          const [px, py] = projeter(acc.lng, acc.lat, pts[k - 1], pts[k], cosLat);
          const ecart = distanceKm(acc.lng, acc.lat, px, py);
          if (ecart > rayonKm) continue;
          const cap = capSegment(g, i, k);
          if (ecartCap(cap, cap0) < 135) continue;
          /* Même numéro de route : préférée, à 50 m près. */
          const score = ecart - (ref0 >= 0 && g.REF[i] === ref0 ? 0.05 : 0);
          if (!meilleur || score < meilleur.score) meilleur = { arete: i, lng: px, lat: py, iSeg: k, cap, score };
        }
      }
    }
  }
  if (!meilleur) return null;

  const troncon = (arete, iSeg, lng, lat) => {
    const pts = pointsArete(g, arete);
    return [...pts.slice(Math.max(0, iSeg - 2), iSeg), [lng, lat], ...pts.slice(iSeg, Math.min(pts.length, iSeg + 2))];
  };
  const ici = { arete: e0, lng: acc.lng, lat: acc.lat, cap: cap0, trace: troncon(e0, acc.iSeg, acc.lng, acc.lat) };
  const enFace = {
    arete: meilleur.arete, lng: meilleur.lng, lat: meilleur.lat, cap: meilleur.cap,
    trace: troncon(meilleur.arete, meilleur.iSeg, meilleur.lng, meilleur.lat),
  };
  let allerIci = versAller(cap0);
  /* Les deux dans la même moitié (caps proches de 135° / 315°) : la plus
     proche du nord-est est « Aller ». */
  if (allerIci === versAller(meilleur.cap)) allerIci = ecartCap(cap0, 45) <= ecartCap(meilleur.cap, 45);
  return allerIci ? { aller: ici, retour: enFace } : { aller: enFace, retour: ici };
}

/**
 * Portion d'arête entre le point accroché et l'une de ses extrémités.
 * @param vers 'A' | 'B'
 */
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

class Tas {
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

/** L'arête est-elle praticable en partant de ce sommet ? */
function praticable(g, i, depuis) {
  const sens = g.SENS[i];
  if (sens === 0) return true;
  return sens === 1 ? g.A[i] === depuis : g.B[i] === depuis;
}

const coutArete = (g, i, critere) =>
  critere === 'court' ? g.M[i] / 1000 : g.M[i] / 1000 / g.VIT[i];

/**
 * Plus court chemin entre deux points accrochés au réseau.
 *
 * A* guidé par la distance à vol d'oiseau (divisée par la vitesse maximale du
 * réseau quand le critère est la durée) : l'heuristique ne surestime jamais le
 * trajet restant, donc le chemin trouvé est bien optimal — là où un Dijkstra
 * explorerait tout le pays à chaque calcul.
 *
 * Les deux extrémités tombent au milieu d'arêtes. Plutôt que de modifier le
 * graphe (qui reste ainsi immuable et réutilisable), la recherche est AMORCÉE
 * depuis les deux sommets de l'arête de départ, chacun avec le coût du bout de
 * route parcouru pour l'atteindre, et TERMINÉE sur ceux de l'arête d'arrivée.
 *
 * @returns null si aucun chemin n'existe
 */
export function itineraire(g, depart, arrivee, critere = 'rapide') {
  if (!depart || !arrivee) return null;

  /* --- Les deux points sur la même arête : pas de recherche --- */
  if (depart.arete === arrivee.arete) {
    const i = depart.arete;
    const km = Math.abs(arrivee.versA - depart.versA);
    const pairs = pointsArete(g, i);
    const versB = arrivee.versA > depart.versA;
    const milieu = versB
      ? pairs.slice(depart.iSeg, arrivee.iSeg)
      : pairs.slice(arrivee.iSeg, depart.iSeg).reverse();

    return resultat(g, {
      km,
      heures: km / g.VIT[i],
      segments: [{ i, km }],
      trace: [[depart.lng, depart.lat], ...milieu, [arrivee.lng, arrivee.lat]],
      depart,
      arrivee,
      critere,
    });
  }

  /* --- Cibles : les deux sommets de l'arête d'arrivée --- */
  const finKm = new Map([
    [g.A[arrivee.arete], arrivee.versA],
    [g.B[arrivee.arete], arrivee.versB],
  ]);
  const finCout = new Map(
    [...finKm].map(([s, km]) => [s, critere === 'court' ? km : km / g.VIT[arrivee.arete]])
  );

  const cout = new Float64Array(g.nS).fill(Infinity);
  const kmCumul = new Float64Array(g.nS);
  const parent = new Int32Array(g.nS).fill(-1);
  const parentArete = new Int32Array(g.nS).fill(-1);
  const clos = new Uint8Array(g.nS);

  const diviseur = critere === 'court' ? 1 : g.vitesseMax;
  const cibles = [...finKm.keys()];
  const h = (s) => {
    let min = Infinity;
    for (const t of cibles) {
      const d = distanceKm(g.X[s], g.Y[s], g.X[t], g.Y[t]);
      if (d < min) min = d;
    }
    return min / diviseur;
  };

  const tas = new Tas();
  for (const [s, km] of [
    [g.A[depart.arete], depart.versA],
    [g.B[depart.arete], depart.versB],
  ]) {
    const c = critere === 'court' ? km : km / g.VIT[depart.arete];
    if (c < cout[s]) {
      cout[s] = c;
      kmCumul[s] = km;
      tas.pousser(c + h(s), s);
    }
  }

  let fin = -1;
  let meilleurTotal = Infinity;

  while (tas.taille) {
    const s = tas.extraire();
    if (clos[s]) continue;
    clos[s] = 1;

    if (finCout.has(s)) {
      const total = cout[s] + finCout.get(s);
      if (total < meilleurTotal) {
        meilleurTotal = total;
        fin = s;
      }
    }
    /* Plus rien d'ouvert ne peut battre la meilleure fin déjà atteinte. */
    if (cout[s] >= meilleurTotal) break;

    for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
      const i = g.incident[k];
      if (!praticable(g, i, s)) continue;
      const autre = g.A[i] === s ? g.B[i] : g.A[i];
      if (clos[autre]) continue;

      const nouveau = cout[s] + coutArete(g, i, critere);
      if (nouveau < cout[autre]) {
        cout[autre] = nouveau;
        kmCumul[autre] = kmCumul[s] + g.M[i] / 1000;
        parent[autre] = s;
        parentArete[autre] = i;
        tas.pousser(nouveau + h(autre), autre);
      }
    }
  }

  if (fin < 0) return null;

  /* --- Remontée : suite d'arêtes empruntées, du départ vers l'arrivée --- */
  const pas = [];
  let s = fin;
  while (parent[s] !== -1) {
    pas.push({ i: parentArete[s], de: parent[s], vers: s });
    s = parent[s];
  }
  pas.reverse();
  const racine = s; // sommet de l'arête de départ par lequel on part

  /* --- Tracé : bout de départ + arêtes + bout d'arrivée --- */
  const trace = portion(g, depart, racine === g.A[depart.arete] ? 'A' : 'B');

  for (const p of pas) {
    const pairs = pointsArete(g, p.i);
    const oriente = p.vers === g.B[p.i] ? pairs : pairs.slice().reverse();
    trace.push(...oriente.slice(1)); // le premier point est la jonction déjà posée
  }

  const bout = portion(g, arrivee, fin === g.A[arrivee.arete] ? 'A' : 'B');
  trace.push(...bout.slice(1).reverse(), [arrivee.lng, arrivee.lat]);

  /* --- Segments, pour le détail par route --- */
  const kmDepart = racine === g.A[depart.arete] ? depart.versA : depart.versB;
  const segments = [
    { i: depart.arete, km: kmDepart },
    ...pas.map((p) => ({ i: p.i, km: g.M[p.i] / 1000 })),
    { i: arrivee.arete, km: finKm.get(fin) },
  ];

  const km = kmCumul[fin] + finKm.get(fin);
  const heures =
    critere === 'court'
      ? segments.reduce((t, sg) => t + sg.km / g.VIT[sg.i], 0)
      : meilleurTotal;

  return resultat(g, { km, heures, segments, trace, depart, arrivee, critere });
}

/* ------------------------- mise en forme ------------------------- */

/**
 * Regroupe les segments consécutifs de même référence : l'itinéraire se lit
 * alors comme des consignes de terrain — « RN8 sur 42 km, puis A7 sur 120 km »
 * — au lieu de centaines de tronçons.
 */
function resultat(g, { km, heures, segments, trace, depart, arrivee, critere }) {
  const etapes = [];
  for (const sg of segments) {
    if (!Number.isFinite(sg.km) || sg.km <= 0) continue;
    const ref = refArete(g, sg.i);
    const classe = classeArete(g, sg.i);
    const nom = nomArete(g, sg.i);
    const dernier = etapes[etapes.length - 1];
    /* Une route numérotée reste UNE étape même si son nom change d'une ville
       à l'autre ; une voie sans numéro se distingue par son nom. */
    const memeVoie =
      dernier && dernier.ref === ref && dernier.classe === classe && (ref != null || dernier.nom === nom);
    if (memeVoie) {
      dernier.km += sg.km;
      if (!dernier.nom && nom) dernier.nom = nom;
    } else etapes.push({ ref, nom, classe, km: sg.km });
  }

  /** Kilométrage par classe : 200 km d'autoroute ne valent pas 200 km de
   *  provinciale, et un chef de compagnie doit pouvoir en juger. */
  const parClasse = {};
  for (const e of etapes) parClasse[e.classe] = (parClasse[e.classe] ?? 0) + e.km;

  return {
    critere,
    km,
    heures,
    etapes: etapes.filter((e) => e.km >= 0.05),
    parClasse,
    trace: trace.filter((p, i, t) => i === 0 || p[0] !== t[i - 1][0] || p[1] !== t[i - 1][1]),
    depart,
    arrivee,
    volOiseauKm: distanceKm(depart.lng, depart.lat, arrivee.lng, arrivee.lat),
  };
}

/* ================================================================== */
/*  Itinéraire multi-points                                           */
/* ================================================================== */

/**
 * Calcule un trajet passant par N points dans l'ordre.
 *
 * @param {object}   g        - graphe chargé par chargerGraphe()
 * @param {object[]} accroche - tableau d'objets accrochés (>=2), produits par accrocher()
 * @param {string}   critere  - 'rapide' | 'court'
 * @returns {{ jambes: (object|null)[], km: number, heures: number, volOiseauKm: number } | null}
 *   jambes[i] = résultat de itineraire(accroche[i], accroche[i+1]) ou null si aucun chemin.
 *   Renvoie null si moins de 2 points fournis.
 */
export function itineraireMulti(g, accroche, critere = 'rapide') {
  if (!g || !accroche || accroche.length < 2) return null;

  const jambes = [];
  let kmTotal = 0;
  let heuresTotal = 0;
  let volOiseauTotal = 0;

  for (let i = 0; i < accroche.length - 1; i++) {
    const res = itineraire(g, accroche[i], accroche[i + 1], critere);
    jambes.push(res);
    if (res) {
      kmTotal += res.km;
      heuresTotal += res.heures;
      volOiseauTotal += res.volOiseauKm;
    }
  }

  return { jambes, km: kmTotal, heures: heuresTotal, volOiseauKm: volOiseauTotal };
}

/* --------------------------- formatage --------------------------- */

export const formatKm = (km) =>
  km == null || !Number.isFinite(km)
    ? '—'
    : km < 1
      ? `${Math.round(km * 1000)} m`
      : `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

export const formatDuree = (heures) => {
  if (heures == null || !Number.isFinite(heures)) return '—';
  const total = Math.max(1, Math.round(heures * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
