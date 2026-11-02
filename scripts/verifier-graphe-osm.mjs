#!/usr/bin/env node
/**
 * Validation d'un graphe routier avant de le mettre en service.
 *
 *   node scripts/verifier-graphe-osm.mjs
 *   node scripts/verifier-graphe-osm.mjs --ancien public/layers/graphe_routier.json \
 *                                        --nouveau public/layers/graphe_routier.new.json
 *
 * LECTURE SEULE : aucun fichier de l'application n'est écrit, aucune position
 * de barrage n'est modifiée. Le rapport est écrit dans data/source/.
 *
 * Tout passe par les moteurs EXISTANTS — `src/routage.js` (navigateur) pour
 * les itinéraires, `serveur/*.mjs` pour l'accrochage, le PK, les conflits et
 * l'optimisation — afin d'éprouver ce que l'application exécutera réellement.
 *
 * Code de sortie 1 si un critère bloquant échoue (arête invalide, itinéraire
 * de référence introuvable, barrage non accrochable alors qu'il l'était).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};
const ANCIEN = resolve(arg('ancien', join(ROOT, 'public/layers/graphe_routier.json')));
const NOUVEAU = resolve(arg('nouveau', join(ROOT, 'public/layers/graphe_routier.new.json')));
const RAPPORT = resolve(arg('rapport', join(ROOT, 'data/source/validation-rapport.json')));
const SANS_OPTIM = process.argv.includes('--sans-optimisation');

const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const RB = await imp('src/routage.js');
const RS = await imp('serveur/routage.mjs');
const PK = await imp('serveur/pointKilometrique.mjs');
const OD = await imp('serveur/optimisationDistance.mjs');

const rapport = { ancien: ANCIEN, nouveau: NOUVEAU, bloquants: [] };
const bloquer = (m) => {
  rapport.bloquants.push(m);
  console.log(`  ✗ BLOQUANT : ${m}`);
};

const charger = (f) => {
  const json = JSON.parse(readFileSync(f, 'utf8'));
  return { json, nav: RB.chargerGraphe(json), srv: RS.chargerGraphe(json) };
};
const G = { ancien: charger(ANCIEN), nouveau: charger(NOUVEAU) };
const ATTR_PONT = 1;
const ATTR_TUNNEL = 2;
const ATTR_ROND_POINT = 8;

/* ================================================================== */
/*  1. Statistiques et intégrité                                      */
/* ================================================================== */

function statistiques({ json, nav: g }) {
  const parClasse = {};
  let km = 0;
  let kmNomme = 0;
  let invalides = 0;
  let longueurNulle = 0;
  let geometrieIncoherente = 0;
  let segMaxKm = 0;
  const vus = new Set();
  let doublons = 0;
  for (let i = 0; i < g.nA; i++) {
    const e = json.aretes[i];
    const k = g.M[i] / 1000;
    const c = g.classes[g.CLS[i]];
    parClasse[c] = (parClasse[c] ?? 0) + k;
    km += k;
    if (g.REF[i] >= 0 || (g.NOM && g.NOM[i] >= 0)) kmNomme += k;
    if (g.A[i] < 0 || g.A[i] >= g.nS || g.B[i] < 0 || g.B[i] >= g.nS || g.A[i] === g.B[i] || (e.length - 7) % 2) invalides++;
    if (!(g.M[i] > 0)) longueurNulle++;
    const pts = RB.pointsArete(g, i);
    let l = 0;
    for (let q = 1; q < pts.length; q++) {
      const d = RB.distanceKm(pts[q - 1][0], pts[q - 1][1], pts[q][0], pts[q][1]);
      l += d;
      if (d > segMaxKm) segMaxKm = d;
    }
    /* La géométrie simplifiée ne peut pas être PLUS longue que la voie : sinon
       l'arête relierait des points que la route ne relie pas. */
    if (l * 1000 > g.M[i] * 1.02 + 3) geometrieIncoherente++;
    const cle = `${Math.min(g.A[i], g.B[i])}|${Math.max(g.A[i], g.B[i])}|${g.SENS[i]}|${e.slice(7).join(',')}`;
    if (vus.has(cle)) doublons++;
    vus.add(cle);
  }
  /* Composantes, sur le graphe tel qu'il est livré */
  const comp = new Int32Array(g.nS).fill(-1);
  let nComp = 0;
  for (let s0 = 0; s0 < g.nS; s0++) {
    if (comp[s0] >= 0) continue;
    const pile = [s0];
    comp[s0] = nComp;
    while (pile.length) {
      const s = pile.pop();
      for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
        const i = g.incident[k];
        const o = g.A[i] === s ? g.B[i] : g.A[i];
        if (comp[o] < 0) {
          comp[o] = nComp;
          pile.push(o);
        }
      }
    }
    nComp++;
  }
  /* Forte connexité (sens uniques respectés) : depuis le sommet 0, tout doit
     être atteignable en avant ET en arrière, sinon il existe des pièges. */
  const atteint = (inverse) => {
    const vu = new Uint8Array(g.nS);
    const pile = [0];
    vu[0] = 1;
    let n = 1;
    while (pile.length) {
      const s = pile.pop();
      for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
        const i = g.incident[k];
        const o = g.A[i] === s ? g.B[i] : g.A[i];
        const depuis = inverse ? o : s;
        const ok = g.SENS[i] === 0 || (g.SENS[i] === 1 ? g.A[i] === depuis : g.B[i] === depuis);
        if (ok && !vu[o]) {
          vu[o] = 1;
          n++;
          pile.push(o);
        }
      }
    }
    return n;
  };
  const horsForte = g.nS - Math.min(atteint(false), atteint(true));
  return {
    sommets: g.nS,
    aretes: g.nA,
    sommetsHorsForteConnexite: horsForte,
    km: Math.round(km),
    kmNommesOuNumerotes: Math.round(kmNomme),
    kmParClasse: Object.fromEntries(Object.entries(parClasse).map(([c, v]) => [c, Math.round(v)])),
    classes: g.classes,
    references: g.refs.length,
    noms: json.noms?.length ?? 0,
    composantes: nComp,
    aretesInvalides: invalides,
    aretesLongueurNulle: longueurNulle,
    doublons,
    geometrieIncoherente,
    plusLongSegmentKm: +segMaxKm.toFixed(2),
    source: json.source ?? null,
    genere: json.genere,
  };
}

console.log('\nValidation du graphe routier\n');
rapport.stats = { ancien: statistiques(G.ancien), nouveau: statistiques(G.nouveau) };
for (const k of ['ancien', 'nouveau']) {
  const s = rapport.stats[k];
  console.log(`  ${k.padEnd(8)} ${s.sommets} sommets, ${s.aretes} arêtes, ${s.km} km (${s.kmNommesOuNumerotes} km nommés/numérotés), ${s.composantes} composante(s)`);
  console.log(`           invalides ${s.aretesInvalides} · longueur nulle ${s.aretesLongueurNulle} · doublons ${s.doublons} · géométrie incohérente ${s.geometrieIncoherente} · pièges à sens unique ${s.sommetsHorsForteConnexite} sommets`);
}
if (rapport.stats.nouveau.sommetsHorsForteConnexite) {
  bloquer(`${rapport.stats.nouveau.sommetsHorsForteConnexite} sommets pris dans des pièges à sens unique`);
}
{
  const s = rapport.stats.nouveau;
  if (s.aretesInvalides) bloquer(`${s.aretesInvalides} arêtes invalides`);
  if (s.aretesLongueurNulle) bloquer(`${s.aretesLongueurNulle} arêtes de longueur nulle`);
  if (s.geometrieIncoherente) bloquer(`${s.geometrieIncoherente} arêtes dont la géométrie est plus longue que la voie`);
  if (s.composantes !== 1) bloquer(`${s.composantes} composantes connexes (1 attendue)`);
}

/* ================================================================== */
/*  2. Couverture : l'ancien réseau est-il retrouvé dans le nouveau ? */
/* ================================================================== */

function couverture(de, vers, pasKm = 0.5, rayonKm = 0.03) {
  let total = 0;
  let couverts = 0;
  const parClasse = {};
  for (let i = 0; i < de.nA; i++) {
    const c = de.classes[de.CLS[i]];
    const pts = RB.pointsArete(de, i);
    let reste = pasKm / 2;
    for (let q = 1; q < pts.length; q++) {
      const [a, b] = [pts[q - 1], pts[q]];
      const L = RB.distanceKm(a[0], a[1], b[0], b[1]);
      while (reste <= L) {
        const t = reste / L;
        const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        const ok = !!RB.accrocher(vers, p[0], p[1], rayonKm);
        total++;
        couverts += ok;
        const pc = (parClasse[c] ??= [0, 0]);
        pc[0]++;
        pc[1] += ok;
        reste += pasKm;
      }
      reste -= L;
    }
  }
  return {
    echantillons: total,
    pourcent: +((100 * couverts) / total).toFixed(2),
    parClasse: Object.fromEntries(Object.entries(parClasse).map(([c, [n, k]]) => [c, +((100 * k) / n).toFixed(2)])),
  };
}
rapport.couverture = {
  ancienRetrouveDansNouveau: couverture(G.ancien.nav, G.nouveau.nav),
  nouveauPresentDansAncien: couverture(G.nouveau.nav, G.ancien.nav, 2),
};
console.log(`\n  couverture : ${rapport.couverture.ancienRetrouveDansNouveau.pourcent} % de l'ancien réseau retrouvé à 30 m dans le nouveau`);
console.log(`               ${rapport.couverture.nouveauPresentDansAncien.pourcent} % du nouveau réseau existait déjà dans l'ancien`);

/* ================================================================== */
/*  3. Itinéraires de référence                                       */
/* ================================================================== */

const LIEUX = {
  Rabat: [-6.8361, 34.0181],
  Salé: [-6.7985, 34.0531],
  Témara: [-6.9068, 33.9287],
  Casablanca: [-7.6187, 33.5951],
  Skhirate: [-7.0402, 33.853],
  'Ain Aouda': [-6.7962, 33.8107],
  Kénitra: [-6.5802, 34.261],
  Tanger: [-5.8128, 35.7595],
  Fès: [-5.0003, 34.0331],
  Marrakech: [-7.9811, 31.6295],
  Agadir: [-9.5981, 30.4278],
  Oujda: [-1.9086, 34.6814],
  Laâyoune: [-13.2034, 27.1536],
  Dakhla: [-15.957, 23.6848],
};
const TRAJETS = [
  ['Rabat', 'Salé'], ['Rabat', 'Témara'], ['Témara', 'Skhirate'], ['Rabat', 'Ain Aouda'],
  ['Témara', 'Ain Aouda'], ['Skhirate', 'Ain Aouda'], ['Casablanca', 'Rabat'], ['Skhirate', 'Casablanca'],
  ['Salé', 'Kénitra'], ['Rabat', 'Fès'], ['Casablanca', 'Marrakech'], ['Tanger', 'Rabat'],
  ['Marrakech', 'Agadir'], ['Fès', 'Oujda'], ['Agadir', 'Laâyoune'], ['Laâyoune', 'Dakhla'],
];

function trajet(g, a, b) {
  const A = RB.accrocher(g, a[0], a[1], 30);
  const B = RB.accrocher(g, b[0], b[1], 30);
  if (!A || !B) return { erreur: 'point hors réseau' };
  const court = RB.itineraire(g, A, B, 'court');
  const rapide = RB.itineraire(g, A, B, 'rapide');
  if (!court) return { erreur: 'aucun itinéraire' };
  let sautMax = 0;
  for (let q = 1; q < court.trace.length; q++) {
    const [p, r] = [court.trace[q - 1], court.trace[q]];
    sautMax = Math.max(sautMax, RB.distanceKm(p[0], p[1], r[0], r[1]));
  }
  const kmNomme = court.etapes.reduce((s, e) => s + (e.ref || e.nom ? e.km : 0), 0);
  return {
    km: +court.km.toFixed(2),
    minutesRapide: rapide ? Math.round(rapide.heures * 60) : null,
    kmRapide: rapide ? +rapide.km.toFixed(2) : null,
    detour: +(court.km / Math.max(0.01, court.volOiseauKm)).toFixed(2),
    accrochageM: [Math.round(A.ecartKm * 1000), Math.round(B.ecartKm * 1000)],
    etapes: court.etapes.length,
    pourcentNomme: +((100 * kmNomme) / Math.max(1e-9, court.km)).toFixed(1),
    principales: court.etapes
      .filter((e) => e.km >= Math.max(0.3, court.km * 0.05))
      .map((e) => `${e.ref ?? e.nom ?? e.classe} ${e.km.toFixed(1)}`),
    plusLongSegmentTraceKm: +sautMax.toFixed(2),
  };
}

console.log('\n  itinéraires (plus court, km) :');
rapport.itineraires = [];
for (const [de, vers] of TRAJETS) {
  const r = { de, vers, volOiseauKm: +RB.distanceKm(...LIEUX[de], ...LIEUX[vers]).toFixed(2) };
  for (const k of ['ancien', 'nouveau']) r[k] = trajet(G[k].nav, LIEUX[de], LIEUX[vers]);
  rapport.itineraires.push(r);
  const f = (x) => (x.erreur ? x.erreur : `${x.km} km ×${x.detour}, ${x.minutesRapide} min, ${x.pourcentNomme} % nommé`);
  console.log(`    ${`${de} → ${vers}`.padEnd(24)} ancien ${f(r.ancien).padEnd(40)} nouveau ${f(r.nouveau)}`);
  if (r.nouveau.erreur) bloquer(`itinéraire ${de} → ${vers} : ${r.nouveau.erreur}`);
  else if (r.nouveau.detour > 3) bloquer(`itinéraire ${de} → ${vers} : détour ×${r.nouveau.detour}`);
}

/* Pas de repli à vol d'oiseau : hors réseau, l'accrochage échoue franchement. */
{
  const mer = RB.accrocher(G.nouveau.nav, -11.5, 32.5, 30);
  rapport.horsReseau = { pointEnMer: mer ? 'accroché (anormal)' : 'refusé : « Aucune route à moins de 30 km »' };
  if (mer) bloquer('un point en pleine mer est accroché au réseau');
}

/* ================================================================== */
/*  4. Ronds-points : chaque entrée atteint chaque sortie par l'anneau */
/* ================================================================== */

function rondsPoints({ json, nav: g }) {
  if (!json.aretesAttr) return null;
  const est = (i) => (json.aretesAttr[i] & ATTR_ROND_POINT) !== 0;
  const prat = (i, s) => g.SENS[i] === 0 || (g.SENS[i] === 1 ? g.A[i] === s : g.B[i] === s);
  const vu = new Uint8Array(g.nA);
  let anneaux = 0;
  let avecBranches3 = 0;
  let paires = 0;
  let echecs = 0;
  const exemples = [];
  for (let i0 = 0; i0 < g.nA; i0++) {
    if (!est(i0) || vu[i0]) continue;
    const ring = new Set([i0]);
    const pile = [i0];
    vu[i0] = 1;
    while (pile.length) {
      const i = pile.pop();
      for (const s of [g.A[i], g.B[i]]) {
        for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
          const j = g.incident[k];
          if (!vu[j] && est(j)) {
            vu[j] = 1;
            ring.add(j);
            pile.push(j);
          }
        }
      }
    }
    anneaux++;
    const sommets = new Set();
    for (const i of ring) sommets.add(g.A[i]).add(g.B[i]);
    const branches = [];
    for (const s of sommets) {
      for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
        const j = g.incident[k];
        if (ring.has(j)) continue;
        const o = g.A[j] === s ? g.B[j] : g.A[j];
        branches.push({ s, j, entree: prat(j, o), sortie: prat(j, s) });
      }
    }
    if (branches.length < 3) continue;
    avecBranches3++;
    for (const be of branches) {
      if (!be.entree) continue;
      const atteint = new Set([be.s]);
      const p = [be.s];
      while (p.length) {
        const s = p.pop();
        for (let k = g.debuts[s]; k < g.debuts[s + 1]; k++) {
          const j = g.incident[k];
          if (!ring.has(j) || !prat(j, s)) continue;
          const o = g.A[j] === s ? g.B[j] : g.A[j];
          if (!atteint.has(o)) {
            atteint.add(o);
            p.push(o);
          }
        }
      }
      for (const bs of branches) {
        if (bs.j === be.j || !bs.sortie) continue;
        paires++;
        if (!atteint.has(bs.s)) {
          echecs++;
          if (exemples.length < 10) exemples.push([+g.X[be.s].toFixed(5), +g.Y[be.s].toFixed(5)]);
        }
      }
    }
  }
  return { anneaux, avecBranches3, paires, echecs, exemples };
}
rapport.rondsPoints = rondsPoints(G.nouveau);
console.log(
  `\n  ronds-points : ${rapport.rondsPoints.avecBranches3} à ≥3 branches, ` +
    `${rapport.rondsPoints.paires} paires entrée→sortie, ${rapport.rondsPoints.echecs} sans passage par l'anneau`
);

/* ================================================================== */
/*  5. Ponts et tunnels : croisements SANS sommet commun              */
/* ================================================================== */

function croisements({ json, nav: g }) {
  if (!json.aretesAttr) return null;
  const G2 = 0.005;
  const cases = new Map();
  for (let i = 0; i < g.nA; i++) {
    const pts = RB.pointsArete(g, i);
    for (let q = 1; q < pts.length; q++) {
      const [a, b] = [pts[q - 1], pts[q]];
      for (let x = Math.floor(Math.min(a[0], b[0]) / G2); x <= Math.floor(Math.max(a[0], b[0]) / G2); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / G2); y <= Math.floor(Math.max(a[1], b[1]) / G2); y++) {
          const c = x * 1e6 + y;
          let l = cases.get(c);
          if (!l) cases.set(c, (l = []));
          l.push(i, q);
        }
    }
  }
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const coupe = (p1, p2, p3, p4) => {
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const vus = new Set();
  const out = { total: 0, pontOuTunnel: 0, memeNiveau: 0, exemplesMemeNiveau: [] };
  const geo = new Map();
  const pts = (i) => {
    let p = geo.get(i);
    if (!p) geo.set(i, (p = RB.pointsArete(g, i)));
    return p;
  };
  for (const [, l] of cases) {
    for (let u = 0; u < l.length; u += 2)
      for (let v = u + 2; v < l.length; v += 2) {
        const [i, q, j, r] = [l[u], l[u + 1], l[v], l[v + 1]];
        if (i === j) continue;
        const [pi, pj] = [pts(i), pts(j)];
        if (!coupe(pi[q - 1], pi[q], pj[r - 1], pj[r])) continue;
        const cle = i < j ? `${i}:${q}:${j}:${r}` : `${j}:${r}:${i}:${q}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        out.total++;
        const niveau = (json.aretesAttr[i] | json.aretesAttr[j]) & (ATTR_PONT | ATTR_TUNNEL);
        if (niveau) out.pontOuTunnel++;
        else {
          out.memeNiveau++;
          if (out.exemplesMemeNiveau.length < 15) out.exemplesMemeNiveau.push({ p: pi[q].map((x) => +x.toFixed(5)), osm: [json.aretesOsm?.[i], json.aretesOsm?.[j]] });
        }
      }
    if (geo.size > 200000) geo.clear();
  }
  return out;
}
rapport.croisements = croisements(G.nouveau);
console.log(
  `  croisements sans sommet commun : ${rapport.croisements.total} — ${rapport.croisements.pontOuTunnel} pont/tunnel, ` +
    `${rapport.croisements.memeNiveau} au même niveau (non raccordés : à vérifier dans OSM, jamais raccordés d'office)`
);

/* ================================================================== */
/*  6. Barrages : accrochage, route, PK, trajet vers le voisin        */
/* ================================================================== */

const barrages = [];
for (const d of ['donnees-serveur', 'donnees-demo']) {
  const f = join(ROOT, d, 'marquages.json');
  if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  for (const m of j.items ?? []) {
    if (/^barrage/.test(m.type) && Number.isFinite(m.lng) && Number.isFinite(m.lat)) barrages.push({ ...m, _jeu: d });
  }
}
const avantPositions = JSON.stringify(barrages.map((b) => [b.id, b.lng, b.lat]));

function barrage(k, m) {
  const g = G[k].srv;
  const acc = RS.accrocher(g, m.lng, m.lat, 30);
  if (!acc) return { accroche: false };
  const ref = RS.refArete(g, acc.arete);
  const route = m.route && PK.routeExiste(g, m.route) ? m.route : null;
  const lu = PK.recalerPosition(g, m.lng, m.lat, { route, rayonKm: 30 });
  return {
    accroche: true,
    ecartM: acc.ecartKm * 1000,
    classe: RS.classeArete(g, acc.arete),
    ref,
    nom: RS.nomArete(g, acc.arete),
    routeDeclareeConnue: !!route,
    pk: lu.erreur ? null : lu.pk,
    acc,
  };
}

const B = { n: barrages.length, ancien: [], nouveau: [] };
for (const m of barrages) {
  B.ancien.push(barrage('ancien', m));
  B.nouveau.push(barrage('nouveau', m));
}
const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1) : null;
};
const resumeB = (L) => {
  const ok = L.filter((x) => x.accroche);
  const parClasse = {};
  for (const x of ok) parClasse[x.classe] = (parClasse[x.classe] ?? 0) + 1;
  return {
    accroches: ok.length,
    ecartMedianM: quantile(ok.map((x) => x.ecartM), 0.5),
    ecart95M: quantile(ok.map((x) => x.ecartM), 0.95),
    ecartMaxM: quantile(ok.map((x) => x.ecartM), 1),
    parClasse,
    routeDeclareeConnue: ok.filter((x) => x.routeDeclareeConnue).length,
  };
};
let memeRef = 0;
let refChange = 0;
let pkEcart = [];
let versLocale = 0;
const exemplesChange = [];
barrages.forEach((m, i) => {
  const [a, n] = [B.ancien[i], B.nouveau[i]];
  if (!a.accroche || !n.accroche) return;
  if (a.ref === n.ref) memeRef++;
  else {
    refChange++;
    if (n.classe === 'locale') versLocale++;
    if (exemplesChange.length < 12) exemplesChange.push({ id: m.id, nom: m.nom, route: m.route, lng: m.lng, lat: m.lat, ancien: a.ref ?? a.classe, nouveau: n.ref ?? n.nom ?? n.classe, ecartNouveauM: Math.round(n.ecartM) });
  }
  if (a.pk != null && n.pk != null && a.routeDeclareeConnue && n.routeDeclareeConnue) pkEcart.push(Math.abs(a.pk - n.pk));
});

/* Trajet réel vers le barrage le plus proche (même jeu), ancien et nouveau */
function versVoisin(k) {
  const g = G[k].srv;
  const out = [];
  for (let i = 0; i < barrages.length; i++) {
    const m = barrages[i];
    let best = null;
    for (let j = 0; j < barrages.length; j++) {
      if (i === j || barrages[j]._jeu !== m._jeu) continue;
      const d = RS.distanceKm(m.lng, m.lat, barrages[j].lng, barrages[j].lat);
      if (!best || d < best.d) best = { j, d };
    }
    if (!best) continue;
    const [A, Bb] = [B[k][i].acc, B[k][best.j].acc];
    const r = A && Bb ? RS.itineraire(g, A, Bb) : null;
    out.push({ i, volOiseau: best.d, km: r ? r.km : null });
  }
  return out;
}
const VA = versVoisin('ancien');
const VN = versVoisin('nouveau');
const sansTrajet = { ancien: VA.filter((x) => x.km == null).length, nouveau: VN.filter((x) => x.km == null).length };
const ratio = VN.map((x, k) => (x.km != null && VA[k].km != null ? x.km / VA[k].km : null)).filter((x) => x != null);

rapport.barrages = {
  total: barrages.length,
  ancien: resumeB(B.ancien),
  nouveau: resumeB(B.nouveau),
  memeRoute: memeRef,
  routeChangee: refChange,
  routeChangeeVersVoieLocale: versLocale,
  exemplesRouteChangee: exemplesChange,
  pkEcartMedianKm: quantile(pkEcart, 0.5),
  pkEcart95Km: quantile(pkEcart, 0.95),
  pkComparables: pkEcart.length,
  trajetVoisin: {
    sansTrajet,
    rapportNouveauSurAncienMedian: quantile(ratio, 0.5),
    rapport5: quantile(ratio, 0.05),
    rapport95: quantile(ratio, 0.95),
  },
  positionsInchangees: JSON.stringify(barrages.map((b) => [b.id, b.lng, b.lat])) === avantPositions,
};
const rb = rapport.barrages;
console.log(`\n  barrages : ${rb.total} (données serveur + démo), positions inchangées : ${rb.positionsInchangees}`);
console.log(`    accrochés  ancien ${rb.ancien.accroches} (écart médian ${rb.ancien.ecartMedianM} m, 95 % ${rb.ancien.ecart95M} m) · nouveau ${rb.nouveau.accroches} (médian ${rb.nouveau.ecartMedianM} m, 95 % ${rb.nouveau.ecart95M} m)`);
console.log(`    même route ${rb.memeRoute}, route changée ${rb.routeChangee} (dont ${rb.routeChangeeVersVoieLocale} vers une voie locale)`);
console.log(`    PK (route déclarée) : écart médian ${rb.pkEcartMedianKm} km, 95 % ${rb.pkEcart95Km} km sur ${rb.pkComparables}`);
console.log(`    trajet vers le voisin : sans trajet ancien ${sansTrajet.ancien} / nouveau ${sansTrajet.nouveau}, nouveau/ancien médian ×${rb.trajetVoisin.rapportNouveauSurAncienMedian}`);
if (rb.nouveau.accroches < rb.ancien.accroches) bloquer(`${rb.ancien.accroches - rb.nouveau.accroches} barrages ne s'accrochent plus`);
if (!rb.positionsInchangees) bloquer('positions de barrages modifiées');

/* ================================================================== */
/*  7. Optimisation : conflits à 20 km et analyse automatique          */
/* ================================================================== */

if (!SANS_OPTIM) {
  rapport.optimisation = {};
  const jeu = barrages.filter((b) => b._jeu === 'donnees-serveur');
  for (const k of ['ancien', 'nouveau']) {
    let t = performance.now();
    const c = OD.listerConflitsDistance(jeu, G[k].srv, { seuilKm: OD.SEUIL_DISTANCE_AUTO_KM });
    const tC = performance.now() - t;
    t = performance.now();
    const a = OD.analyserOptimisationDistance(jeu, G[k].srv, { seuilKm: OD.SEUIL_DISTANCE_AUTO_KM });
    const tA = performance.now() - t;
    rapport.optimisation[k] = {
      barrages: jeu.length,
      conflits20km: c.length,
      conflitsMs: Math.round(tC),
      analyseMs: Math.round(tA),
      deplacements: a.mouvements?.length ?? a.deplacements?.length ?? null,
      sansSolution: a.sansSolution?.length ?? null,
      conflitsRestants: a.conflitsRestants?.length ?? a.apres?.conflits?.length ?? null,
      cles: Object.keys(a).slice(0, 20),
    };
    console.log(`  optimisation (${k}) : ${c.length} conflits < 20 km en ${Math.round(tC)} ms ; analyse automatique ${Math.round(tA)} ms`);
  }
}

writeFileSync(RAPPORT, JSON.stringify(rapport, null, 2));
console.log(`\n  rapport : ${RAPPORT}`);
console.log(rapport.bloquants.length ? `\n  ${rapport.bloquants.length} critère(s) bloquant(s).\n` : '\n  Aucun critère bloquant.\n');
process.exit(rapport.bloquants.length ? 1 : 0);
