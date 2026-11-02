/**
 * QUI EST EN CONFLIT AVEC QUI — l'identité visuelle des conflits de distance.
 *
 * LE PROBLÈME. Trois barrages sur la même route : A↔B, A↔C, B↔C. Leurs trois
 * itinéraires empruntent la même chaussée ; dessinés tels quels, ils tombent
 * sur les mêmes pixels et la carte ne montre plus qu'UNE ligne rouge. On ne
 * sait plus qui est en conflit avec qui.
 *
 * CE MODULE NE CALCULE RIEN DE ROUTIER. Les paires, leurs distances et leurs
 * tracés viennent du serveur — c'est la seule source de vérité. Ici, on :
 *
 *   1. numérote chaque PAIRE (C-01, C-02…), d'après les paires du serveur et
 *      jamais d'après la géométrie ;
 *   2. oriente chaque tracé pour savoir quelle extrémité est A, laquelle est B ;
 *   3. range sur des VOIES distinctes les tracés qui partagent une chaussée ;
 *   4. décale ces voies de quelques pixels à l'écran.
 *
 * Le décalage est purement visuel : la géométrie transmise reste le tracé
 * réel, et la distance affichée reste celle du serveur.
 *
 * Module pur (aucun import) : éprouvé par scripts/verifier-conflits-identifies.mjs.
 */

/** Clé d'une paire, indépendante de l'ordre : A↔B et B↔A sont le même conflit. */
export const clePaire = (a, b) => [String(a), String(b)].sort().join('|');

/** « C-01 » … « C-99 », puis « C-100 » : au moins deux chiffres, autant qu'il en faut. */
export const libelleConflit = (rang, total = rang) =>
  `C-${String(rang).padStart(Math.max(2, String(total).length), '0')}`;

/**
 * IDENTIFIANT CANONIQUE D'UNE ROUTE.
 * Normalise les identifiants textuels (ex: 'RN 1', 'rn-1', 'A 2', 'N7', 'RR 322')
 * vers leur format canonique réglementaire ('RN1', 'A2', 'RN7', 'RR322').
 */
export function canonicalRouteId(routeStr) {
  if (!routeStr) return null;
  let raw = String(routeStr).trim().toUpperCase();
  if (!raw) return null;

  // Normalisation des préfixes textuels longs (ex: "Route Nationale RN1" -> "RN1", "Autoroute A2" -> "A2")
  raw = raw
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bROUTE\s+NATIONALE\b/gi, 'RN')
    .replace(/\bROUTE\s+REGIONALE\b/gi, 'RR')
    .replace(/\bROUTE\s+PROVINCIALE\b/gi, 'RP')
    .replace(/\bAUTOROUTE\b/gi, 'A');

  const s = raw.replace(/[\s\-_]/g, '');
  if (!s) return null;

  const nettoye = s
    .replace(/^RN(RN|N)/, 'RN')
    .replace(/^RR(RR|R)/, 'RR')
    .replace(/^RP(RP|P)/, 'RP')
    .replace(/^A(A)/, 'A');

  const m = /^(A|RN|RR|RP)(\d+[A-Z]?)$/.exec(nettoye);
  if (m) return `${m[1]}${m[2]}`;
  const mN = /^N(\d+[A-Z]?)$/.exec(nettoye);
  if (mN) return `RN${mN[1]}`;
  const mR = /^R(\d+[A-Z]?)$/.exec(nettoye);
  if (mR) return `RR${mR[1]}`;
  const mP = /^P(\d+[A-Z]?)$/.exec(nettoye);
  if (mP) return `RP${mP[1]}`;

  const mSearch = /\b(A|RN|RR|RP)(\d+[A-Z]?)\b/i.exec(raw);
  if (mSearch) return `${mSearch[1].toUpperCase()}${mSearch[2].toUpperCase()}`;

  return nettoye;
}

/** Vérifie si deux désignations de route correspondent canoniquement. */
export function routesCorrespondent(r1, r2) {
  const c1 = canonicalRouteId(r1);
  const c2 = canonicalRouteId(r2);
  return Boolean(c1 && c2 && c1 === c2);
}

/**
 * NUMÉROTER LES CONFLITS — à partir des paires rendues par le serveur.
 *
 * @param {object} p
 * @param {Array<{a, b, km}>} p.initiaux  paires mesurées sur les positions
 *        officielles ; `a`/`b` sont des identifiants ou des objets `{id, nom}`.
 * @param {Array<{a, b, km}>|null} p.finaux  paires restantes dans l'état
 *        simulé (après les propositions) ; `null` s'il n'y a pas de simulation.
 * @param {Map<string, number>} [p.apresKm]  distance APRÈS d'une paire résolue,
 *        par clé de paire, quand le serveur l'a mesurée.
 * @param {Set<string>} [p.deplaces]  identifiants des barrages déplacés.
 * @param {Map<string, {nom, lng, lat}>} [p.infos]  nom et position officielle
 *        de chaque barrage, pour nommer et situer les extrémités.
 * @returns {{ conflits: object[], parCle: Map<string, object> }}
 *
 * ORDRE : les conflits initiaux d'abord, du plus serré au moins serré (à
 * distance égale, par clé — l'ordre ne dépend jamais de l'ordre de réception) ;
 * puis les NOUVEAUX conflits, nés d'un déplacement, à la suite. Les phases
 * AVANT et APRÈS d'une même paire portent le même identifiant ; une paire
 * nouvelle a le sien.
 */
export function identifierConflits({ initiaux = [], finaux = null, apresKm = new Map(), deplaces = new Set(), infos = new Map() }) {
  const idDe = (x) => String(x?.id ?? x);
  const nomDe = (x, id) => x?.nom || infos.get(id)?.nom || id;
  const extremite = (x) => {
    const id = idDe(x);
    const i = infos.get(id);
    const intouchable = Boolean(
      x?.intouchable || x?.protection === 'intouchable' || x?.type === 'barrage_vip' ||
      i?.intouchable || i?.protection === 'intouchable' || i?.type === 'barrage_vip'
    );
    return {
      id,
      nom: nomDe(x, id),
      lng: Number.isFinite(x?.lng) ? x.lng : i?.lng ?? null,
      lat: Number.isFinite(x?.lat) ? x.lat : i?.lat ?? null,
      route: x?.route || i?.route || '',
      reg: x?.reg || i?.reg || null,
      cie: x?.cie || i?.cie || null,
      deplace: deplaces.has(id),
      intouchable,
      factionId: x?.factionId ?? i?.factionId ?? null,
      factions: x?.factions ?? i?.factions ?? null,
      direction: x?.direction || i?.direction || null,
      sens: x?.sens || i?.sens || null,
      road_id: x?.road_id || i?.road_id || null,
      route_position: x?.route_position ?? i?.route_position ?? null,
    };
  };
  const uniques = (liste) => {
    const out = new Map();
    for (const c of liste ?? []) {
      const [a, b] = [idDe(c.a), idDe(c.b)];
      if (!a || !b || a === b) continue;
      const cle = clePaire(a, b);
      const deja = out.get(cle);
      if (!deja || Number(c.km) < Number(deja.km)) out.set(cle, { ...c, cle });
    }
    return out;
  };
  const tri = (x, y) => Number(x.km) - Number(y.km) || (x.cle < y.cle ? -1 : x.cle > y.cle ? 1 : 0);

  const avant = [...uniques(initiaux).values()].sort(tri);
  const apres = finaux ? uniques(finaux) : null;
  const nouveaux = apres ? [...apres.values()].filter((c) => !avant.some((v) => v.cle === c.cle)).sort(tri) : [];
  const total = avant.length + nouveaux.length;

  const conflits = [];
  for (const c of avant) {
    const fin = apres?.get(c.cle);
    const statut = !apres ? 'actif' : fin ? 'restant' : 'resolu';
    const extA = extremite(c.a);
    const extB = extremite(c.b);
    const dist = Number(c.km);
    const temps = c.minutes != null ? Math.round(c.minutes) : Math.max(1, Math.round(dist * 1.1));
    const axe = c.route || (Array.isArray(c.routes) && c.routes.length ? c.routes.join(', ') : '') || extA.route || extB.route || '';
    conflits.push({
      cle: c.cle,
      a: extA,
      b: extB,
      entreIntouchables: extA.intouchable && extB.intouchable,
      avantKm: dist,
      apresKm: fin ? Number(fin.km) : apresKm.has(c.cle) ? Number(apresKm.get(c.cle)) : null,
      distanceKm: dist,
      km: dist,
      route: axe,
      tempsMinutes: temps,
      motif: c.motif || c.raison || `Distance routière de ${kmConflit(dist)} inférieure au seuil de sécurité`,
      statut,
      nouveau: false,
      factionId: c.factionId ?? fin?.factionId ?? null,
      factionLibelle: c.factionLibelle ?? fin?.factionLibelle ?? null,
      factions: c.factions ?? fin?.factions ?? null,
      assigneA: c.assigneA ?? null,
      assigneLe: c.assigneLe ?? null,
    });
  }
  for (const c of nouveaux) {
    const extA = extremite(c.a);
    const extB = extremite(c.b);
    const dist = Number(c.km);
    const temps = c.minutes != null ? Math.round(c.minutes) : Math.max(1, Math.round(dist * 1.1));
    const axe = c.route || (Array.isArray(c.routes) && c.routes.length ? c.routes.join(', ') : '') || extA.route || extB.route || '';
    conflits.push({
      cle: c.cle,
      a: extA,
      b: extB,
      entreIntouchables: extA.intouchable && extB.intouchable,
      avantKm: null,
      apresKm: dist,
      distanceKm: dist,
      km: dist,
      route: axe,
      tempsMinutes: temps,
      motif: c.motif || c.raison || `Nouveau conflit après déplacement : espacement ${kmConflit(dist)}`,
      statut: 'nouveau',
      nouveau: true,
      factionId: c.factionId ?? null,
      factionLibelle: c.factionLibelle ?? null,
      factions: c.factions ?? null,
      assigneA: c.assigneA ?? null,
      assigneLe: c.assigneLe ?? null,
    });
  }
  conflits.forEach((c, i) => {
    c.rang = i + 1;
    c.id = libelleConflit(i + 1, total);
  });
  return { conflits, parCle: new Map(conflits.map((c) => [c.cle, c])) };
}

/** Un conflit est-il encore un DANGER une fois la proposition appliquée ? */
export const estEnConflitApres = (c) => c.statut !== 'resolu';

/* ------------------------------------------------------------------ */
/*  Extrémités : quel bout du tracé est A ?                           */
/* ------------------------------------------------------------------ */

const carre = (p, q) => {
  const k = Math.cos(((p[1] + q[1]) / 2) * (Math.PI / 180));
  return ((p[0] - q[0]) * k) ** 2 + (p[1] - q[1]) ** 2;
};

/**
 * Le tracé du serveur part du premier poste de la paire qu'il a reçue. Quand
 * les positions sont connues, on le vérifie plutôt que de le supposer : le
 * bout le plus proche de A est l'extrémité A.
 *
 * @param {Array<[lng, lat]>} trace
 * @param {{lng, lat}|null} posA  position de A (celle de CE tracé : l'ancienne
 *        place pour un tracé AVANT, la nouvelle pour un tracé APRÈS)
 * @param {{lng, lat}|null} posB
 * @returns {boolean} vrai si le tracé va de B vers A (à lire à l'envers)
 */
export function traceInverse(trace, posA, posB) {
  if (!trace?.length) return false;
  const debut = trace[0];
  const fin = trace[trace.length - 1];
  const ok = (p) => p && Number.isFinite(p.lng) && Number.isFinite(p.lat);
  if (ok(posA)) return carre(fin, [posA.lng, posA.lat]) < carre(debut, [posA.lng, posA.lat]);
  if (ok(posB)) return carre(debut, [posB.lng, posB.lat]) < carre(fin, [posB.lng, posB.lat]);
  return false;
}

/* ------------------------------------------------------------------ */
/*  Voies : les tracés qui partagent une chaussée sont séparés         */
/* ------------------------------------------------------------------ */

/**
 * Les tronçons d'un tracé, en clés de coordonnées. Deux itinéraires calculés
 * sur le même graphe empruntent les MÊMES points pour la même chaussée : la
 * comparaison exacte (à 1e-5°, la précision du graphe) suffit, sans aucune
 * tolérance qui confondrait deux routes voisines.
 */
function troncons(trace) {
  const cles = new Set();
  const k = (p) => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`;
  for (let i = 1; i < trace.length; i++) {
    const a = k(trace[i - 1]);
    const b = k(trace[i]);
    if (a !== b) cles.add(a < b ? `${a}>${b}` : `${b}>${a}`);
  }
  return cles;
}

/** Voies 0, +1, −1, +2, −2… : la première reste au centre, sur la route. */
const VOIES = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5];

/**
 * VOIE de chaque tracé, pour qu'aucun ne soit dessiné sur un autre.
 *
 * Deux tracés qui partagent au moins un tronçon ne prennent jamais la même
 * voie. Attribution gloutonne dans l'ordre des identifiants (C-01 d'abord) :
 * stable d'un rendu à l'autre, donc une route ne « saute » pas de voie quand
 * on sélectionne un conflit.
 *
 * @param {Array<{cle: string, trace: Array<[lng, lat]>}>} routes  déjà triées
 * @returns {Map<string, number>} clé de route → voie (entier, 0 = centre)
 */
export function attribuerVoies(routes) {
  const segments = routes.map((r) => troncons(r.trace ?? []));
  const voies = new Map();
  routes.forEach((r, i) => {
    const prises = new Set();
    for (let j = 0; j < i; j++) {
      const s = segments[j];
      for (const t of segments[i]) {
        if (s.has(t)) {
          prises.add(voies.get(routes[j].cle));
          break;
        }
      }
    }
    voies.set(r.cle, VOIES.find((v) => !prises.has(v)) ?? i);
  });
  return voies;
}

/**
 * DÉCALER UNE POLYLIGNE de `d` pixels, perpendiculairement — en coordonnées
 * ÉCRAN, recalculées à chaque zoom : un décalage en mètres serait invisible
 * vu de loin et énorme vu de près.
 *
 * Normale moyenne aux sommets, bornée (onglet limité) pour qu'un virage serré
 * ne projette pas le sommet au loin.
 *
 * @param {Array<{x, y}>} pts  points écran
 * @param {number} d  pixels (négatif : de l'autre côté)
 * @returns {Array<{x, y}>}
 */
export function decalerPixels(pts, d) {
  if (!d || pts.length < 2) return pts.map((p) => ({ x: p.x, y: p.y }));
  const n = pts.length;
  const normale = (p, q) => {
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: -dy / l, y: dx / l };
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const avant = i > 0 ? normale(pts[i - 1], pts[i]) : null;
    const apres = i < n - 1 ? normale(pts[i], pts[i + 1]) : null;
    let nx;
    let ny;
    if (avant && apres) {
      nx = avant.x + apres.x;
      ny = avant.y + apres.y;
      const l = Math.hypot(nx, ny);
      if (l < 1e-6) {
        nx = apres.x;
        ny = apres.y;
      } else {
        /* Longueur de l'onglet : 1/cos(demi-angle), bornée à 2. */
        const cos = l / 2;
        const f = Math.min(2, 1 / Math.max(cos, 0.5));
        nx = (nx / l) * f;
        ny = (ny / l) * f;
      }
    } else {
      ({ x: nx, y: ny } = avant ?? apres);
    }
    out.push({ x: pts[i].x + nx * d, y: pts[i].y + ny * d });
  }
  return out;
}

/** Le point à `distancePx` le long d'une polyligne écran, depuis son début. */
export function pointLeLong(pts, distancePx) {
  if (!pts.length) return null;
  let reste = distancePx;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l >= reste && l > 0) {
      const t = reste / l;
      return { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
    }
    reste -= l;
  }
  return pts[pts.length - 1];
}

/* ------------------------------------------------------------------ */
/*  Badges : les conflits de chaque barrage                           */
/* ------------------------------------------------------------------ */

/**
 * Pour chaque barrage, la liste de SES conflits, dans l'ordre des identifiants,
 * chacun avec l'AUTRE barrage de la paire.
 *
 * @returns {Map<string, {id, nom, lng, lat, conflits: Array<{conflit, autre}>}>}
 */
export function conflitsParBarrage(conflits) {
  const out = new Map();
  for (const c of conflits) {
    for (const [moi, autre] of [[c.a, c.b], [c.b, c.a]]) {
      let e = out.get(moi.id);
      if (!e) out.set(moi.id, (e = { id: moi.id, nom: moi.nom, lng: moi.lng, lat: moi.lat, conflits: [] }));
      e.conflits.push({ conflit: c, autre });
    }
  }
  return out;
}

/** « 14.75 km » — la distance du serveur, jamais arrondie autrement. */
export const kmConflit = (km) => (km != null && Number.isFinite(Number(km)) ? `${Number(km).toFixed(2)} km` : '—');
