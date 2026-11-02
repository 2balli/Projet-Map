/**
 * Géométrie de la mesure — fonctions pures, sans MapLibre ni DOM.
 * Coordonnées en [longitude, latitude] (degrés), distances en mètres.
 *
 * Les distances affichées sont géodésiques (haversine, rayon moyen terrestre ;
 * écart < 0,5 % avec l'ellipsoïde). La recherche du point le plus proche se
 * fait dans une projection plane locale, exacte à l'échelle d'une ville.
 */

const RAYON_TERRE = 6_371_008.8;
/** Mètres par degré de latitude (et de longitude à l'équateur), approximation plane locale. */
export const METRES_PAR_DEGRE = 111_195;
const rad = (degres) => (degres * Math.PI) / 180;

export function distanceMetres([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAYON_TERRE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Emprise [ouest, sud, est, nord] couvrant deux points (ou un seul : a = b), avec une marge en mètres. */
export function emprise(a, b, margeM) {
  const dLat = margeM / METRES_PAR_DEGRE;
  const dLon = dLat / Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return [Math.min(a[0], b[0]) - dLon, Math.min(a[1], b[1]) - dLat, Math.max(a[0], b[0]) + dLon, Math.max(a[1], b[1]) + dLat];
}

export function longueurMetres(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceMetres(points[i - 1], points[i]);
  return total;
}

/** Point situé à mi-longueur d'une ligne (pour y poser l'étiquette d'un tracé routier). */
export function pointMilieuChemin(chemin) {
  const moitie = longueurMetres(chemin) / 2;
  let parcouru = 0;
  for (let i = 1; i < chemin.length; i++) {
    const d = distanceMetres(chemin[i - 1], chemin[i]);
    if (d > 0 && parcouru + d >= moitie) {
      const t = (moitie - parcouru) / d;
      const [a, b] = [chemin[i - 1], chemin[i]];
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    parcouru += d;
  }
  return chemin[0];
}

/** Projection plane locale (mètres) centrée sur la latitude `lat0`. */
function projection(lat0) {
  const k = (RAYON_TERRE * Math.PI) / 180;
  const c = Math.cos(rad(lat0));
  return {
    vers: ([lon, lat]) => [lon * k * c, lat * k],
    depuis: ([x, y]) => [x / (k * c), y / k],
  };
}

/** Point de [a, b] le plus proche de p (coordonnées planes). */
function projeterSurSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return [a[0] + t * dx, a[1] + t * dy];
}

const carre = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

/** Intersection des segments [a, b] et [c, d] (coordonnées planes), ou null. */
function intersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (denom === 0) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

/** GeoJSON LineString / MultiLineString → liste de lignes [[lon, lat], …]. */
export function lignesDe(geometrie) {
  if (!geometrie) return [];
  if (geometrie.type === 'LineString') return [geometrie.coordinates];
  if (geometrie.type === 'MultiLineString') return geometrie.coordinates;
  return [];
}

/**
 * Point des `lignes` le plus proche de `point`.
 * @returns {{ point: [number, number], distance: number } | null}
 */
export function pointLePlusProche(point, lignes) {
  const proj = projection(point[1]);
  const p = proj.vers(point);
  let meilleur = null;
  for (const ligne of lignes) {
    const plane = ligne.map(proj.vers);
    for (let i = 1; i < plane.length; i++) {
      const q = projeterSurSegment(p, plane[i - 1], plane[i]);
      const d = carre(p, q);
      if (!meilleur || d < meilleur.d) meilleur = { d, q };
    }
  }
  if (!meilleur) return null;
  const proche = proj.depuis(meilleur.q);
  return { point: proche, distance: distanceMetres(point, proche) };
}

/**
 * Écart le plus court entre deux routes (chacune = une liste de lignes).
 * @returns {{ de: [number, number], a: [number, number], distance: number, croisement: boolean } | null}
 */
export function ecartMinimal(lignesA, lignesB) {
  const premier = lignesA.find((l) => l.length)?.[0];
  if (!premier || !lignesB.some((l) => l.length > 1) || !lignesA.some((l) => l.length > 1)) return null;
  const proj = projection(premier[1]);
  const segments = (lignes) => lignes.flatMap((ligne) => {
    const plane = ligne.map(proj.vers);
    const liste = [];
    for (let i = 1; i < plane.length; i++) {
      const [a, b] = [plane[i - 1], plane[i]];
      liste.push({ a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }
    return liste;
  });
  const segA = segments(lignesA);
  const segB = segments(lignesB);
  let meilleur = null;
  for (const s of segA) {
    for (const t of segB) {
      if (meilleur) {
        // Boîtes englobantes plus éloignées que le meilleur écart : rien de mieux ici.
        const ex = Math.max(0, s.minX - t.maxX, t.minX - s.maxX);
        const ey = Math.max(0, s.minY - t.maxY, t.minY - s.maxY);
        if (ex * ex + ey * ey >= meilleur.d) continue;
      }
      const croise = intersection(s.a, s.b, t.a, t.b);
      if (croise) {
        const point = proj.depuis(croise);
        return { de: point, a: point, distance: 0, croisement: true };
      }
      for (const [p, sur, depuisA] of [[s.a, t, true], [s.b, t, true], [t.a, s, false], [t.b, s, false]]) {
        const q = projeterSurSegment(p, sur.a, sur.b);
        const d = carre(p, q);
        if (!meilleur || d < meilleur.d) meilleur = { d, de: depuisA ? p : q, a: depuisA ? q : p };
      }
    }
  }
  if (!meilleur) return null;
  const de = proj.depuis(meilleur.de);
  const a = proj.depuis(meilleur.a);
  return { de, a, distance: distanceMetres(de, a), croisement: false };
}

const UNITES = { fr: ['m', 'km'], ar: ['م', 'كم'] };

/** 8.43 → « 8,4 m » ; 245.2 → « 245 m » ; 1234 → « 1,23 km » ; 23 456 → « 23,5 km ». */
export function formaterDistance(metres, langue = 'fr') {
  const [m, km] = UNITES[langue] ?? UNITES.fr;
  const nombre = (valeur, decimales) => new Intl.NumberFormat(langue === 'ar' ? 'ar-MA' : 'fr-FR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valeur);
  if (metres < 10) return `${nombre(metres, 1)} ${m}`;
  if (metres < 1000) return `${nombre(metres, 0)} ${m}`;
  if (metres < 10_000) return `${nombre(metres / 1000, 2)} ${km}`;
  return `${nombre(metres / 1000, 1)} ${km}`;
}

const DUREES = { fr: ['min', 'h'], ar: ['د', 'س'] };

/** 40 → « < 1 min » ; 1380 → « 23 min » ; 5100 → « 1 h 25 ». */
export function formaterDuree(secondes, langue = 'fr') {
  const [min, h] = DUREES[langue] ?? DUREES.fr;
  const nombre = (valeur, chiffres = 1) => new Intl.NumberFormat(langue === 'ar' ? 'ar-MA' : 'fr-FR', { minimumIntegerDigits: chiffres }).format(valeur);
  const minutes = Math.round(secondes / 60);
  if (minutes < 1) return `< 1 ${min}`;
  if (minutes < 60) return `${nombre(minutes)} ${min}`;
  return `${nombre(Math.floor(minutes / 60))} ${h} ${nombre(minutes % 60, 2)}`;
}

/** Nom affichable d'une route OSM : nom dans la langue, nom local, puis numéro (RN1…). */
export function nomRoute(proprietes = {}, langue = 'fr') {
  return proprietes[`name:${langue}`] || proprietes.name || proprietes.ref || null;
}
