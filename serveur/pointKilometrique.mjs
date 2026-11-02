/**
 * POINT KILOMÉTRIQUE (PK) — calculé sur le tracé réel d'une route du graphe.
 *
 * LE PROJET N'AVAIT PAS DE PK STRUCTURÉ. Le champ `route` d'un barrage porte
 * la référence de la voie (« RN6 ») et, parfois, un PK écrit à la main dans le
 * texte (« RN8 — PK 42 ») : rien qui se calcule, rien qu'on puisse inverser
 * pour retrouver une position. Ce module est donc le SEUL référentiel
 * kilométrique ; il ne réinvente ni l'accrochage ni le réseau : il lit le même
 * `graphe_routier.json` que les distances, avec les primitives de
 * `serveur/routage.mjs`.
 *
 * COMMENT LE PK EST DÉFINI. Pour une référence de voie (la valeur `refs` du
 * graphe : « RN6 », « A2 », « RR322 »…) :
 *
 *   1. on isole les arêtes du graphe qui portent cette référence ;
 *   2. les tronçons disjoints (coupures de la donnée OSM, traversées de ville
 *      non renseignées) sont raccordés entre leurs extrémités les plus proches,
 *      à vol d'oiseau — sans cela la moitié d'une nationale n'aurait aucun PK ;
 *   3. les deux extrémités du tracé sont les deux bouts les plus éloignés à
 *      vol d'oiseau ;
 *   4. le PK 0 est posé sur l'extrémité la plus au NORD (à latitude égale, la
 *      plus à l'OUEST) : une règle fixe, pour que le même point donne toujours
 *      le même PK, d'un redémarrage à l'autre ;
 *   5. le TRONC est le plus court chemin, sur la route, du PK 0 à l'autre
 *      extrémité ; le PK d'un point est son abscisse sur ce tronc (projection).
 *
 * CE N'EST PAS LE BORNAGE OFFICIEL. Les bornes kilométriques du ministère ne
 * sont pas dans les données du projet ; ce PK est une abscisse curviligne sur
 * le tracé réel, stable et réversible — ce dont la modification d'un barrage a
 * besoin : « même route, PK 137 » désigne toujours le même endroit.
 *
 * POURQUOI LA PROJECTION SUR LE TRONC, et non la distance sur le graphe : là
 * où la route se dédouble (chaussées séparées), un point de l'autre chaussée
 * reçoit ainsi le PK de sa voisine, pas celui d'un détour par l'échangeur
 * suivant. L'inverse (PK → position) suit le même tronc, puis ré-accroche le
 * point à une arête réelle de la route — jamais sur un raccord à vol d'oiseau.
 */
import { distanceKm, pointsArete, refArete, accrocher, projeter, Tas } from './routage.mjs';

const rad = (d) => (d * Math.PI) / 180;

/** Au-delà, un point cliqué n'est pas « sur la route » : on refuse plutôt que de téléporter. */
export const RAYON_RECALAGE_KM = 5;

/** Un dixième de kilomètre : la précision d'une borne, pas davantage. */
export const arrondirPk = (pk) => Math.round(pk * 10) / 10;

/* ------------------------------------------------------------------ */
/* Index des arêtes par référence                                     */
/* ------------------------------------------------------------------ */

const caches = new WeakMap();

function cacheDe(g) {
  let c = caches.get(g);
  if (!c) {
    const parRef = new Map();
    for (let i = 0; i < g.nA; i++) {
      const r = g.REF[i];
      if (r < 0) continue;
      let lot = parRef.get(r);
      if (!lot) parRef.set(r, (lot = []));
      lot.push(i);
    }
    c = { parRef, referentiels: new Map(), liste: null };
    caches.set(g, c);
  }
  return c;
}

const indexRef = (g, ref) => (typeof ref === 'string' ? g.refs.indexOf(ref.trim()) : -1);

/** Cette référence existe-t-elle dans le réseau routier réel ? */
export const routeExiste = (g, ref) => indexRef(g, ref) >= 0;

/**
 * Routes du réseau réel, pour la liste de choix du formulaire.
 * @returns {Array<{ref: string, longueurKm: number}>} triées « à la française » (RN2 avant RN10)
 */
export function listeRoutes(g) {
  const c = cacheDe(g);
  if (!c.liste) {
    c.liste = [...c.parRef.entries()]
      .map(([r, aretes]) => ({
        ref: g.refs[r],
        longueurKm: Math.round(aretes.reduce((s, i) => s + g.M[i], 0) / 100) / 10,
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref, 'fr', { numeric: true }));
  }
  return c.liste;
}

/* ------------------------------------------------------------------ */
/* Référentiel d'une route                                            */
/* ------------------------------------------------------------------ */

/** Plus court chemin restreint au sous-graphe de la route (arêtes réelles + raccords). */
function dijkstra(adj, depart) {
  const dist = new Map([[depart, 0]]);
  const pred = new Map();
  const tas = new Tas();
  tas.pousser(0, depart);
  const clos = new Set();
  while (tas.taille) {
    const s = tas.extraire();
    if (clos.has(s)) continue;
    clos.add(s);
    const d = dist.get(s);
    for (const [v, km, arete] of adj.get(s) ?? []) {
      const nd = d + km;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        pred.set(v, [s, arete]);
        tas.pousser(nd, v);
      }
    }
  }
  return { dist, pred };
}

/** Enveloppe convexe (chaîne monotone d'Andrew) des sommets, en coordonnées planes locales. */
function enveloppeConvexe(g, sommets) {
  if (sommets.length < 3) return sommets;
  const cosLat = Math.cos(rad(sommets.reduce((s, u) => s + g.Y[u], 0) / sommets.length));
  const pts = sommets
    .map((u) => [g.X[u] * cosLat, g.Y[u], u])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const croix = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const bas = [];
  for (const p of pts) {
    while (bas.length >= 2 && croix(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop();
    bas.push(p);
  }
  const haut = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (haut.length >= 2 && croix(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop();
    haut.push(p);
  }
  return [...bas.slice(0, -1), ...haut.slice(0, -1)].map((p) => p[2]);
}

function construireReferentiel(g, r) {
  const aretes = cacheDe(g).parRef.get(r) ?? [];
  if (!aretes.length) return null;

  const adj = new Map();
  const lier = (a, b, km, arete) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, km, arete]);
    adj.get(b).push([a, km, arete]);
  };
  /* Le PK ignore le sens unique : une borne se lit dans les deux sens. */
  for (const i of aretes) lier(g.A[i], g.B[i], g.M[i] / 1000, i);

  /* Composantes connexes du tracé. */
  const comp = new Map();
  const composantes = [];
  for (const s of adj.keys()) {
    if (comp.has(s)) continue;
    const k = composantes.length;
    const membres = [];
    const pile = [s];
    comp.set(s, k);
    while (pile.length) {
      const u = pile.pop();
      membres.push(u);
      for (const [v] of adj.get(u)) {
        if (!comp.has(v)) {
          comp.set(v, k);
          pile.push(v);
        }
      }
    }
    /* Les raccords partent des extrémités (degré 1) : c'est là que la donnée
       s'interrompt. Une boucle sans extrémité offre tous ses sommets. */
    /* Extrémités (degré 1) ET embranchements (degré ≥ 3) : un tracé qui finit
       sur un giratoire COMPLET n'a pas d'extrémité de ce côté-là. Avec les
       seules extrémités, le tronçon El Jadida–Laâyoune de la RN1 n'était
       raccordable que par Laâyoune, et le tronc sautait 801 km à vol d'oiseau. */
    const bouts = membres.filter((u) => adj.get(u).length !== 2);
    composantes.push({ membres, bouts: bouts.length ? bouts : membres });
  }

  /* Raccordement glouton : on greffe à chaque tour la composante la plus
     proche de ce qui est déjà relié (arbre couvrant de Prim sur les bouts).
     Chaque bout garde sa meilleure distance à l'arbre : un bout qui entre
     dans l'arbre n'est comparé qu'une fois à tous les autres — O(bouts²). */
  let raccords = 0;
  if (composantes.length > 1) {
    let principale = 0;
    composantes.forEach((c, k) => {
      if (c.membres.length > composantes[principale].membres.length) principale = k;
    });
    const bouts = [];
    composantes.forEach((c, k) => c.bouts.forEach((u) => bouts.push({ u, k })));
    const n = bouts.length;
    const meilleurD = new Float64Array(n).fill(Infinity);
    const meilleurT = new Int32Array(n).fill(-1);
    const relie = new Uint8Array(composantes.length);
    const greffer = (k) => {
      relie[k] = 1;
      for (const t of composantes[k].bouts) {
        for (let j = 0; j < n; j++) {
          if (relie[bouts[j].k]) continue;
          const u = bouts[j].u;
          const d = distanceKm(g.X[u], g.Y[u], g.X[t], g.Y[t]);
          if (d < meilleurD[j]) {
            meilleurD[j] = d;
            meilleurT[j] = t;
          }
        }
      }
    };
    greffer(principale);
    for (let restant = composantes.length - 1; restant > 0; restant--) {
      let j = -1;
      for (let x = 0; x < n; x++) {
        if (!relie[bouts[x].k] && (j < 0 || meilleurD[x] < meilleurD[j])) j = x;
      }
      lier(meilleurT[j], bouts[j].u, meilleurD[j], -1);
      raccords++;
      greffer(bouts[j].k);
    }
  }

  /* Les deux extrémités : la paire de sommets la plus éloignée À VOL D'OISEAU.
     Pas en distance sur le tracé : une autoroute à chaussées séparées, reliées
     à un seul bout, aurait alors pour « extrémités » ses deux chaussées au
     même péage, et le tronc ferait l'aller-retour. Pas seulement parmi les
     sommets de degré 1 non plus : une route qui finit sur un giratoire n'en a
     pas. La paire la plus éloignée est sur l'enveloppe convexe — on ne compare
     que ses sommets. */
  const candidats = enveloppeConvexe(g, [...adj.keys()]);
  let a = candidats[0];
  let b = candidats[0];
  let dMax = -1;
  for (let x = 0; x < candidats.length; x++) {
    const u = candidats[x];
    for (let y = x + 1; y < candidats.length; y++) {
      const v = candidats[y];
      const d = distanceKm(g.X[u], g.Y[u], g.X[v], g.Y[v]);
      if (d > dMax) {
        dMax = d;
        a = u;
        b = v;
      }
    }
  }
  const auNord = (u, v) => {
    const dy = g.Y[u] - g.Y[v];
    if (Math.abs(dy) > 1e-9) return dy > 0;
    return g.X[u] < g.X[v];
  };
  const origine = auNord(a, b) ? a : b;
  const fin = origine === a ? b : a;
  const { dist, pred } = dijkstra(adj, origine);

  /* Le TRONC, du PK 0 à l'autre extrémité, en points cumulés [lng, lat, pk]. */
  const pas = [];
  for (let v = fin; v !== origine; ) {
    const [u, arete] = pred.get(v);
    pas.push([u, v, arete]);
    v = u;
  }
  pas.reverse();
  const tronc = [[g.X[origine], g.Y[origine], 0]];
  /* Les SAUTS du tronc — les raccords à vol d'oiseau entre tronçons OSM
     disjoints, en PK [début, fin] : là, la géométrie réelle manque. */
  const sauts = [];
  for (const [u, v, arete] of pas) {
    const base = dist.get(u);
    if (arete < 0) {
      tronc.push([g.X[v], g.Y[v], dist.get(v)]);
      sauts.push([base, dist.get(v)]);
      continue;
    }
    let pts = pointsArete(g, arete);
    if (g.A[arete] !== u) pts = pts.slice().reverse();
    let geo = 0;
    const cumul = [0];
    for (let k = 1; k < pts.length; k++) {
      geo += distanceKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      cumul.push(geo);
    }
    const km = g.M[arete] / 1000;
    for (let k = 1; k < pts.length; k++) {
      tronc.push([pts[k][0], pts[k][1], base + (geo ? (cumul[k] / geo) * km : km)]);
    }
  }

  return {
    ref: g.refs[r],
    aretes,
    tronc,
    sauts,
    raccords,
    longueurKm: dist.get(fin) ?? 0,
  };
}

/** Référentiel kilométrique d'une route — construit une fois, gardé en mémoire. */
export function referentiel(g, ref) {
  const r = indexRef(g, ref);
  if (r < 0) return null;
  const c = cacheDe(g);
  if (!c.referentiels.has(r)) c.referentiels.set(r, construireReferentiel(g, r));
  return c.referentiels.get(r);
}

/* ------------------------------------------------------------------ */
/* Accrochage sur UNE route                                           */
/* ------------------------------------------------------------------ */

/**
 * Le point de la route `ref` le plus proche de (lng, lat) — même projection
 * que `accrocher`, mais limitée aux arêtes de cette route.
 */
export function accrocherSurRoute(g, ref, lng, lat) {
  const ret = referentiel(g, ref);
  if (!ret) return null;
  const cosLat = Math.cos(rad(lat));
  let meilleur = null;
  for (const i of ret.aretes) {
    const pairs = pointsArete(g, i);
    let totale = 0;
    for (let k = 1; k < pairs.length; k++) {
      totale += distanceKm(pairs[k - 1][0], pairs[k - 1][1], pairs[k][0], pairs[k][1]);
    }
    let avant = 0;
    for (let k = 1; k < pairs.length; k++) {
      const seg = distanceKm(pairs[k - 1][0], pairs[k - 1][1], pairs[k][0], pairs[k][1]);
      const [px, py, t] = projeter(lng, lat, pairs[k - 1], pairs[k], cosLat);
      const ecart = distanceKm(lng, lat, px, py);
      if (!meilleur || ecart < meilleur.ecartKm) {
        const versA = avant + seg * t;
        meilleur = { arete: i, lng: px, lat: py, versA, versB: Math.max(0, totale - versA), ecartKm: ecart };
      }
      avant += seg;
    }
  }
  return meilleur;
}

/** PK d'un point : son abscisse sur le tronc, par projection sur le segment le plus proche. */
function pkSurTronc(ret, lng, lat) {
  const t = ret.tronc;
  const cosLat = Math.cos(rad(lat));
  let meilleur = null;
  for (let k = 1; k < t.length; k++) {
    const [px, py, f] = projeter(lng, lat, t[k - 1], t[k], cosLat);
    const ecart = distanceKm(lng, lat, px, py);
    if (!meilleur || ecart < meilleur.ecart) {
      meilleur = { ecart, pk: t[k - 1][2] + f * (t[k][2] - t[k - 1][2]) };
    }
  }
  return meilleur ? meilleur.pk : null;
}

/* ------------------------------------------------------------------ */
/* Les deux questions de la modification d'un barrage                 */
/* ------------------------------------------------------------------ */

const sortie = (g, ret, acc) => ({
  route: ret?.ref ?? (acc ? refArete(g, acc.arete) : null),
  pk: ret ? arrondirPk(pkSurTronc(ret, acc.lng, acc.lat)) : null,
  lng: +acc.lng.toFixed(5),
  lat: +acc.lat.toFixed(5),
  ecartKm: Math.round(acc.ecartKm * 1000) / 1000,
  longueurRouteKm: ret ? arrondirPk(ret.longueurKm) : null,
});

/**
 * POSITION → (route, PK), le point recalé sur le réseau.
 *
 * Sans `route`, le point s'accroche à la voie la plus proche, quelle qu'elle
 * soit — c'est le geste « je déplace le barrage sur la carte ». Avec `route`,
 * il reste sur cette voie — « je le glisse le long de la N6 ».
 *
 * @returns {{route, pk, lng, lat, ecartKm, longueurRouteKm}|{erreur: string}}
 */
export function recalerPosition(g, lng, lat, { route = null, rayonKm = RAYON_RECALAGE_KM } = {}) {
  if (route) {
    const ret = referentiel(g, route);
    if (!ret) return { erreur: `La route « ${route} » n'existe pas dans le réseau routier.` };
    const acc = accrocherSurRoute(g, route, lng, lat);
    if (!acc || acc.ecartKm > rayonKm) {
      return { erreur: `Ce point est à plus de ${rayonKm} km de la route ${ret.ref}.` };
    }
    return sortie(g, ret, acc);
  }
  const acc = accrocher(g, lng, lat, rayonKm);
  if (!acc) return { erreur: `Aucune route du réseau à moins de ${rayonKm} km de ce point.` };
  const ref = refArete(g, acc.arete);
  const ret = ref ? referentiel(g, ref) : null;
  return sortie(g, ret, acc);
}

/**
 * (route, PK) → position réelle sur le tracé.
 *
 * @returns {{route, pk, lng, lat, ecartKm, longueurRouteKm}|{erreur: string}}
 */
export function positionAuPk(g, route, pk) {
  const ret = referentiel(g, route);
  if (!ret) return { erreur: `La route « ${route} » n'existe pas dans le réseau routier.` };
  const v = Number(pk);
  if (!Number.isFinite(v) || v < 0) return { erreur: 'Le PK doit être un nombre positif, en kilomètres.' };
  const L = ret.longueurKm;
  if (v > L + 0.05) {
    return { erreur: `PK ${v} hors du tracé : la route ${ret.ref} mesure ${arrondirPk(L)} km (PK 0 → PK ${arrondirPk(L)}).` };
  }
  const t = ret.tronc;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid][2] <= v) lo = mid;
    else hi = mid;
  }
  const [x1, y1, p1] = t[lo];
  const [x2, y2, p2] = t[hi];
  const f = p2 > p1 ? Math.min(1, Math.max(0, (v - p1) / (p2 - p1))) : 0;
  /* Le point interpolé est ré-accroché à une arête RÉELLE de la route : sur
     un raccord à vol d'oiseau, il tomberait sinon en plein champ. */
  const acc = accrocherSurRoute(g, route, x1 + f * (x2 - x1), y1 + f * (y2 - y1));
  return sortie(g, ret, acc);
}
