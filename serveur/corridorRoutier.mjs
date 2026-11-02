/**
 * OPTIMISATION PAR ROUTE OU PAR TRAJET — le périmètre géographique.
 *
 * Ce module ne fait que de la GÉOMÉTRIE sur le graphe routier hors ligne
 * (`graphe_routier.json`, celui des distances et des PK) : il ne lit aucun
 * barrage et n'écrit rien. Trois services, séparés à dessein :
 *
 *   1. LE TRACÉ D'UNE ROUTE — toutes les arêtes qui portent la référence
 *      (« RN1 », « A2 »…), telles que le graphe les connaît. Aucune référence
 *      n'est inventée : la liste est celle du graphe, issue d'OpenStreetMap
 *      (tag `ref`), et le tracé est celui des arêtes, rien d'autre.
 *
 *   2. LE TRAJET ENTRE DEUX LOCALITÉS — plus court chemin EN TEMPS sur le même
 *      graphe, et jusqu'à deux variantes par pénalisation : chaque itinéraire
 *      retenu rend ses arêtes plus chères, et l'on recherche à nouveau. Une
 *      variante n'est gardée que si elle diffère vraiment (recouvrement < 75 %)
 *      et reste raisonnable (≤ 1,5 fois la durée du meilleur). Si le calcul
 *      échoue, la fonction rend `null` : aucun trait n'est dessiné « au jugé ».
 *
 *   3. LE CORRIDOR — la bande de `km` kilomètres autour d'un tracé, indexée
 *      par une grille (comme `graphe.grille`) pour qu'interroger 600 barrages
 *      contre un tracé de 2 000 km reste instantané.
 *
 * Pourquoi pas d'API externe (OSRM, Google…) : l'application tourne sur un
 * intranet isolé, et le graphe embarqué sert déjà à toutes les distances. Le
 * trajet est donc calculé ici, avec les mêmes sens uniques et les mêmes
 * vitesses que les temps de trajet de l'optimisation.
 */
import { distanceKm, pointsArete, refArete, accrocher, projeter, Tas } from './routage.mjs';
import { referentiel, listeRoutes } from './pointKilometrique.mjs';
import { itineraireDetaille } from './tempsTrajet.mjs';

/** Corridor proposé par défaut, et ses bornes. */
export const CORRIDOR_DEFAUT_KM = 2;
export const CORRIDOR_MIN_KM = 0.2;
export const CORRIDOR_MAX_KM = 20;
/**
 * Une position PROPOSÉE doit rester SUR le tracé, pas seulement dans le
 * corridor : déplacer un poste de la RN1 vers une piste parallèle à 1,5 km
 * le sortirait de la route qu'on optimise. 300 m couvrent l'écart entre le
 * graphe et le trait affiché (voir serveur/routesAffichees.mjs) et les
 * chaussées séparées.
 */
export const TOLERANCE_TRACE_KM = 0.3;
/**
 * APPARTENANCE D'UN BARRAGE À UNE ROUTE — 150 m du tracé réel, au plus.
 *
 * Mesuré sur le dispositif : les postes enregistrés sur une route sont à
 * moins de 45 m de son tracé dans le graphe (écart GPS + simplification à
 * 40 m). 150 m laissent de la marge sans atteindre la route parallèle ; la
 * référence de route du poste fait le reste (voir `appartenanceRoute`,
 * serveur/api.mjs).
 */
export const TOLERANCE_ROUTE_KM = 0.15;

const NB_VARIANTES = 3;
const RECOUVREMENT_MAX = 0.75;
const DETOUR_MAX = 1.5;
const PENALITE = 1.6;
/** Rayon d'accrochage d'une localité au réseau. */
const ACCROCHAGE_VILLE_KM = 8;

/** Classe administrative d'une référence — lue sur son préfixe, comme la donnée OSM. */
export function classeDeRef(ref) {
  if (/^A\d/.test(ref)) return 'autoroute';
  if (/^RN\d/.test(ref)) return 'nationale';
  if (/^RR\d/.test(ref)) return 'regionale';
  if (/^RP\d/.test(ref)) return 'provinciale';
  return 'autre';
}
const ORDRE_CLASSE = { autoroute: 0, nationale: 1, regionale: 2, provinciale: 3, autre: 4 };

const arrondi = ([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];

/* ================================================================== */
/*  1. Routes                                                         */
/* ================================================================== */

/** Toutes les routes numérotées du graphe : autoroutes, puis nationales… */
export function catalogueRoutes(g) {
  return listeRoutes(g)
    .map((r) => ({ ...r, classe: classeDeRef(r.ref) }))
    .sort((a, b) => ORDRE_CLASSE[a.classe] - ORDRE_CLASSE[b.classe] ||
      a.ref.localeCompare(b.ref, 'fr', { numeric: true }));
}

/**
 * Raboute les arêtes d'une route en polylignes : une ligne par tronçon continu,
 * au lieu d'une ligne par arête (des milliers pour une nationale).
 */
function assembler(g, aretes) {
  const parSommet = new Map();
  for (const i of aretes) {
    for (const s of [g.A[i], g.B[i]]) {
      if (!parSommet.has(s)) parSommet.set(s, []);
      parSommet.get(s).push(i);
    }
  }
  const utilisees = new Set();
  const suivante = (s) => (parSommet.get(s) ?? []).find((i) => !utilisees.has(i));
  const lignes = [];
  for (const depart of aretes) {
    if (utilisees.has(depart)) continue;
    utilisees.add(depart);
    let pts = pointsArete(g, depart);
    let fin = g.B[depart];
    let debut = g.A[depart];
    /* Vers l'avant, puis vers l'arrière, tant qu'une arête prolonge le tronçon. */
    for (let i = suivante(fin); i != null; i = suivante(fin)) {
      utilisees.add(i);
      const p = pointsArete(g, i);
      const sens = g.A[i] === fin ? p : [...p].reverse();
      pts = pts.concat(sens.slice(1));
      fin = g.A[i] === fin ? g.B[i] : g.A[i];
    }
    for (let i = suivante(debut); i != null; i = suivante(debut)) {
      utilisees.add(i);
      const p = pointsArete(g, i);
      const sens = g.B[i] === debut ? p : [...p].reverse();
      pts = sens.slice(0, -1).concat(pts);
      debut = g.B[i] === debut ? g.A[i] : g.B[i];
    }
    lignes.push(pts);
  }
  return lignes;
}

function bboxDe(lignes) {
  let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lignes) {
    for (const [x, y] of l) {
      if (x < o) o = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [o, s, e, n];
}

/** La localité connue la plus proche d'un point (à moins de `maxKm`). */
export function localiteProche(villes, [lng, lat], maxKm = 40) {
  let best = null;
  for (const v of villes) {
    const d = distanceKm(lng, lat, v.lng, v.lat);
    if (d <= maxKm && (!best || d < best.d)) best = { nom: v.nom, d };
  }
  return best?.nom ?? null;
}

/**
 * Le tracé complet d'une route du graphe.
 * @returns {null | {type:'route', ref, classe, longueurKm, lignes, bbox, extremites}}
 */
export function traceRoute(g, ref, villes = []) {
  const ret = referentiel(g, ref);
  if (!ret) return null;
  const lignes = assembler(g, ret.aretes);
  /* Les deux bouts les plus éloignés : « de Tanger à … », pour situer la route. */
  const bouts = lignes.flatMap((l) => [l[0], l[l.length - 1]]);
  let paire = [bouts[0], bouts[bouts.length - 1]];
  let dMax = -1;
  for (let i = 0; i < bouts.length; i++) {
    for (let j = i + 1; j < bouts.length; j++) {
      const d = distanceKm(bouts[i][0], bouts[i][1], bouts[j][0], bouts[j][1]);
      if (d > dMax) { dMax = d; paire = [bouts[i], bouts[j]]; }
    }
  }
  /* Nord d'abord, comme le PK 0 (voir serveur/pointKilometrique.mjs). */
  paire.sort((a, b) => b[1] - a[1]);
  return {
    type: 'route',
    ref: ret.ref,
    classe: classeDeRef(ret.ref),
    longueurKm: Math.round(ret.aretes.reduce((s, i) => s + g.M[i], 0) / 100) / 10,
    troncons: lignes.length,
    lignes,
    bbox: bboxDe(lignes),
    extremites: paire.map((p) => ({ lng: p[0], lat: p[1], localite: localiteProche(villes, p) })),
  };
}

/** La route numérotée la plus proche d'un clic, ou `null` au-delà de `maxKm`. */
export function routeAuPoint(g, lng, lat, maxKm = 1.5) {
  const acc = accrocher(g, lng, lat, maxKm);
  if (!acc) return null;
  const ref = refArete(g, acc.arete);
  return ref ? { ref, classe: classeDeRef(ref), ecartKm: Math.round(acc.ecartKm * 1000) / 1000 } : null;
}

/* ================================================================== */
/*  2. Trajet entre deux localités                                    */
/* ================================================================== */

const vitesse = (g, i) => Math.max(1, g.VIT[i]);
const praticable = (g, i, depuis) => g.SENS[i] === 0 || (g.SENS[i] === 1 ? g.A[i] === depuis : g.B[i] === depuis);

/**
 * A* en temps, avec un multiplicateur par arête (`penalite`). L'heuristique —
 * vol d'oiseau à la vitesse maximale du réseau — reste admissible, puisque les
 * pénalités ne font que renchérir.
 */
function cheminPenalise(g, snapA, snapB, penalite) {
  const pen = (i) => penalite.get(i) ?? 1;
  const cout = new Map();
  const via = new Map();
  const clos = new Set();
  const tas = new Tas();
  const [xB, yB] = [snapB.lng, snapB.lat];
  const h = (s) => distanceKm(g.X[s], g.Y[s], xB, yB) / g.vitesseMax;
  const fin = new Map([
    [g.A[snapB.arete], (snapB.versA / vitesse(g, snapB.arete)) * pen(snapB.arete)],
    [g.B[snapB.arete], (snapB.versB / vitesse(g, snapB.arete)) * pen(snapB.arete)],
  ]);
  for (const [s, c] of [
    [g.A[snapA.arete], (snapA.versA / vitesse(g, snapA.arete)) * pen(snapA.arete)],
    [g.B[snapA.arete], (snapA.versB / vitesse(g, snapA.arete)) * pen(snapA.arete)],
  ]) {
    if (c < (cout.get(s) ?? Infinity)) {
      cout.set(s, c);
      tas.pousser(c + h(s), s);
    }
  }
  let arrivee = null;
  let meilleur = Infinity;
  while (tas.taille) {
    const s = tas.extraire();
    if (clos.has(s)) continue;
    clos.add(s);
    const c = cout.get(s);
    if (c + h(s) >= meilleur) break;
    const reste = fin.get(s);
    if (reste != null && c + reste < meilleur) {
      meilleur = c + reste;
      arrivee = s;
    }
    for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
      const i = g.incident[k];
      if (!praticable(g, i, s)) continue;
      const autre = g.A[i] === s ? g.B[i] : g.A[i];
      if (clos.has(autre)) continue;
      const nouveau = c + (g.M[i] / 1000 / vitesse(g, i)) * pen(i);
      if (nouveau < (cout.get(autre) ?? Infinity)) {
        cout.set(autre, nouveau);
        via.set(autre, { arete: i, depuis: s });
        tas.pousser(nouveau + h(autre), autre);
      }
    }
  }
  if (arrivee == null) return null;
  const aretes = [];
  let s = arrivee;
  for (let garde = 0; via.has(s) && garde < 1e6; garde++) {
    const { arete, depuis } = via.get(s);
    aretes.push({ arete, de: depuis });
    s = depuis;
  }
  return { aretes: aretes.reverse(), depart: s, arrivee };
}

/** Mesures RÉELLES (sans pénalité) et géométrie d'un chemin d'arêtes. */
function decrire(g, snapA, snapB, { aretes, depart, arrivee }) {
  const coords = [[snapA.lng, snapA.lat]];
  let km = 0;
  let heures = 0;
  const parRef = new Map();
  const compter = (i, kmArete) => {
    const r = refArete(g, i);
    if (r) parRef.set(r, (parRef.get(r) ?? 0) + kmArete);
  };
  /* Les deux bouts d'arête parcourus depuis/vers les accrochages. */
  const kmDepart = depart === g.A[snapA.arete] ? snapA.versA : snapA.versB;
  const kmArrivee = arrivee === g.A[snapB.arete] ? snapB.versA : snapB.versB;
  /* Le bout d'arête de départ, jusqu'au premier sommet : sinon le trait
     commencerait au carrefour, pas à la localité. */
  const ptsDepart = pointsArete(g, snapA.arete);
  for (const p of depart === g.A[snapA.arete]
    ? [...ptsDepart.slice(0, snapA.iSeg)].reverse() : ptsDepart.slice(snapA.iSeg)) coords.push([p[0], p[1]]);
  km += kmDepart + kmArrivee;
  heures += kmDepart / vitesse(g, snapA.arete) + kmArrivee / vitesse(g, snapB.arete);
  compter(snapA.arete, kmDepart);
  compter(snapB.arete, kmArrivee);
  for (const { arete, de } of aretes) {
    const pts = pointsArete(g, arete);
    for (const p of g.A[arete] === de ? pts : [...pts].reverse()) {
      const d = coords[coords.length - 1];
      if (d[0] !== p[0] || d[1] !== p[1]) coords.push([p[0], p[1]]);
    }
    const k = g.M[arete] / 1000;
    km += k;
    heures += k / vitesse(g, arete);
    compter(arete, k);
  }
  /* Et le bout d'arête d'arrivée, du dernier sommet à la localité. */
  const ptsArrivee = pointsArete(g, snapB.arete);
  for (const p of arrivee === g.A[snapB.arete]
    ? ptsArrivee.slice(0, snapB.iSeg) : [...ptsArrivee.slice(snapB.iSeg)].reverse()) {
    const d = coords[coords.length - 1];
    if (d[0] !== p[0] || d[1] !== p[1]) coords.push([p[0], p[1]]);
  }
  coords.push([snapB.lng, snapB.lat]);
  const routes = [...parRef.entries()].sort((a, b) => b[1] - a[1]).map(([ref, k]) => ({ ref, km: Math.round(k * 10) / 10 }));
  return {
    km: Math.round(km * 10) / 10,
    minutes: Math.round(heures * 600) / 10,
    coords,
    routes,
    ensemble: new Map(aretes.map(({ arete }) => [arete, g.M[arete]])),
  };
}

/**
 * Le trajet routier d'une localité à une autre, avec ses variantes.
 * @param {{nom, lng, lat}} depart
 * @param {{nom, lng, lat}} arrivee
 * @returns {{erreur: string} | {variantes: Array}}
 */
export function itinerairesTrajet(g, depart, arrivee, { variantes = NB_VARIANTES } = {}) {
  const snapA = accrocher(g, depart.lng, depart.lat, ACCROCHAGE_VILLE_KM);
  const snapB = accrocher(g, arrivee.lng, arrivee.lat, ACCROCHAGE_VILLE_KM);
  if (!snapA) return { erreur: `« ${depart.nom} » n’est accroché à aucune route du réseau (> ${ACCROCHAGE_VILLE_KM} km).` };
  if (!snapB) return { erreur: `« ${arrivee.nom} » n’est accroché à aucune route du réseau (> ${ACCROCHAGE_VILLE_KM} km).` };

  /* Même arête : un seul tracé possible, par le calcul existant. */
  if (snapA.arete === snapB.arete) {
    const r = itineraireDetaille(g, snapA, snapB, 10_000, 'temps');
    if (!r) return { erreur: 'Aucun itinéraire routier trouvé entre ces deux localités.' };
    return {
      variantes: [{
        rang: 1, km: Math.round(r.km * 10) / 10, minutes: r.minutes, coords: r.coords,
        routes: r.routes.map((ref) => ({ ref, km: null })),
      }],
    };
  }

  const penalite = new Map();
  const retenues = [];
  for (let essai = 0; essai < variantes * 3 && retenues.length < variantes; essai++) {
    const chemin = cheminPenalise(g, snapA, snapB, penalite);
    if (!chemin) break;
    const v = decrire(g, snapA, snapB, chemin);
    for (const { arete } of chemin.aretes) penalite.set(arete, (penalite.get(arete) ?? 1) * PENALITE);
    if (retenues.length && v.minutes > retenues[0].minutes * DETOUR_MAX) break;
    const total = [...v.ensemble.values()].reduce((s, m) => s + m, 0) || 1;
    const tropSemblable = retenues.some((r) => {
      let commun = 0;
      for (const [i, m] of v.ensemble) if (r.ensemble.has(i)) commun += m;
      return commun / total >= RECOUVREMENT_MAX;
    });
    if (!tropSemblable) retenues.push(v);
  }
  if (!retenues.length) return { erreur: 'Aucun itinéraire routier trouvé entre ces deux localités.' };
  return {
    variantes: retenues.map(({ ensemble: _e, ...v }, k) => ({ rang: k + 1, ...v })),
  };
}

/* ================================================================== */
/*  3. Corridor                                                       */
/* ================================================================== */

const PAS = 0.05; // ~5 km, comme la grille du graphe
const cle = (ix, iy) => ix * 100000 + iy;

/**
 * Le corridor de `km` kilomètres autour de `lignes`.
 *
 * `distance(pt, portee)` rend la distance du point au tracé, ou `Infinity` si
 * elle dépasse `portee` (par défaut le corridor) — on ne regarde que les cases
 * voisines. Un barrage proche de plusieurs tronçons de la même route n'est
 * compté qu'une fois : on interroge par barrage, pas par tronçon.
 */
export function creerCorridor(lignes, km) {
  const segments = [];
  const grille = new Map();
  for (const l of lignes) {
    for (let k = 1; k < l.length; k++) {
      const a = l[k - 1];
      const b = l[k];
      const n = segments.push([a, b]) - 1;
      const [x0, x1] = [Math.floor(Math.min(a[0], b[0]) / PAS), Math.floor(Math.max(a[0], b[0]) / PAS)];
      const [y0, y1] = [Math.floor(Math.min(a[1], b[1]) / PAS), Math.floor(Math.max(a[1], b[1]) / PAS)];
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const c = cle(ix, iy);
          if (!grille.has(c)) grille.set(c, []);
          grille.get(c).push(n);
        }
      }
    }
  }
  const bbox = bboxDe(lignes);
  const distance = ([lng, lat], portee = km) => {
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const rx = Math.ceil(portee / (PAS * 111 * Math.max(0.2, cosLat))) + 1;
    const ry = Math.ceil(portee / (PAS * 111)) + 1;
    const ix0 = Math.floor(lng / PAS);
    const iy0 = Math.floor(lat / PAS);
    const vus = new Set();
    let best = Infinity;
    for (let dx = -rx; dx <= rx; dx++) {
      for (let dy = -ry; dy <= ry; dy++) {
        for (const n of grille.get(cle(ix0 + dx, iy0 + dy)) ?? []) {
          if (vus.has(n)) continue;
          vus.add(n);
          const [a, b] = segments[n];
          const [px, py] = projeter(lng, lat, a, b, cosLat);
          const d = distanceKm(lng, lat, px, py);
          if (d < best) best = d;
        }
      }
    }
    return best <= portee ? best : Infinity;
  };
  return {
    km,
    bbox,
    distance,
    contient: (pt) => distance(pt, km) <= km,
    /** Une position proposée doit être SUR le tracé — voir TOLERANCE_TRACE_KM. */
    surTrace: (pt) => distance(pt, TOLERANCE_TRACE_KM) <= TOLERANCE_TRACE_KM,
  };
}

/** Tracé allégé pour le navigateur : coordonnées à 1 m près. */
export const lignesPourCarte = (lignes) => lignes.map((l) => l.map(arrondi));
