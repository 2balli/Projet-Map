/**
 * Coordonnées Lambert du Maroc (système Merchich) — fonctions pures.
 *
 * Quatre zones conique conforme de Lambert (1 parallèle) sur l'ellipsoïde de
 * Clarke 1880 (IGN), paramètres EPSG 26191, 26192, 26194 et 26195. Passage
 * WGS 84 → Merchich par translation géocentrique (31, 146, 47 m), comme
 * `+towgs84=31,146,47` : précision de l'ordre de quelques mètres, suffisante
 * pour la lecture de carte, pas pour la géodésie.
 */

const CLARKE_IGN = { a: 6378249.2, b: 6356515.0 };
const WGS84 = { a: 6378137, b: 6378137 * (1 - 1 / 298.257223563) };
/** Merchich → WGS 84 (mètres, géocentrique). */
const TRANSLATION = [31, 146, 47];
const LON0 = -5.4;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Zones du nord au sud ; `latMin` : limite sud (degrés WGS 84). */
const ZONES = Object.freeze([
  { id: 'nord', nom: 'Lambert Nord Maroc', epsg: 26191, lat0: 33.3, k0: 0.999625769, x0: 500_000, y0: 300_000, latMin: 31.5 },
  { id: 'sud', nom: 'Lambert Sud Maroc', epsg: 26192, lat0: 29.7, k0: 0.999615596, x0: 500_000, y0: 300_000, latMin: 27.9 },
  { id: 'sahara-nord', nom: 'Lambert Sahara Nord', epsg: 26194, lat0: 26.1, k0: 0.999616304, x0: 1_200_000, y0: 400_000, latMin: 24.3 },
  { id: 'sahara-sud', nom: 'Lambert Sahara Sud', epsg: 26195, lat0: 22.5, k0: 0.999616437, x0: 1_500_000, y0: 400_000, latMin: -90 },
]);

export const NOMS_ZONES_AR = Object.freeze({
  nord: 'لامبير شمال المغرب', sud: 'لامبير جنوب المغرب', 'sahara-nord': 'لامبير شمال الصحراء', 'sahara-sud': 'لامبير جنوب الصحراء',
});

/** Zone Lambert d'une latitude (WGS 84). */
export const zoneDe = (lat) => ZONES.find((z) => lat >= z.latMin);

// ── Changement de système (translation géocentrique) ───────────────────────

function versGeocentrique([lon, lat], { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const φ = rad(lat);
  const λ = rad(lon);
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  return [N * Math.cos(φ) * Math.cos(λ), N * Math.cos(φ) * Math.sin(λ), N * (1 - e2) * Math.sin(φ)];
}

function depuisGeocentrique([X, Y, Z], { a, b }) {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.hypot(X, Y);
  let φ = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const h = p / Math.cos(φ) - N;
    φ = Math.atan2(Z, p * (1 - (e2 * N) / (N + h)));
  }
  return [deg(Math.atan2(Y, X)), deg(φ)];
}

const wgs84VersMerchich = (p) => {
  const [X, Y, Z] = versGeocentrique(p, WGS84);
  return depuisGeocentrique([X - TRANSLATION[0], Y - TRANSLATION[1], Z - TRANSLATION[2]], CLARKE_IGN);
};
const merchichVersWgs84 = (p) => {
  const [X, Y, Z] = versGeocentrique(p, CLARKE_IGN);
  return depuisGeocentrique([X + TRANSLATION[0], Y + TRANSLATION[1], Z + TRANSLATION[2]], WGS84);
};

// ── Conique conforme de Lambert, 1 parallèle (EPSG 9801) ───────────────────

const E = Math.sqrt(1 - (CLARKE_IGN.b * CLARKE_IGN.b) / (CLARKE_IGN.a * CLARKE_IGN.a));
const mDe = (φ) => Math.cos(φ) / Math.sqrt(1 - E * E * Math.sin(φ) ** 2);
const tDe = (φ) => Math.tan(Math.PI / 4 - φ / 2) / ((1 - E * Math.sin(φ)) / (1 + E * Math.sin(φ))) ** (E / 2);

function constantes(zone) {
  const φ0 = rad(zone.lat0);
  const n = Math.sin(φ0);
  const F = mDe(φ0) / (n * tDe(φ0) ** n);
  const r0 = CLARKE_IGN.a * F * tDe(φ0) ** n * zone.k0;
  return { n, F, r0 };
}

/**
 * [lon, lat] WGS 84 → Lambert (mètres) ; zone d'après la latitude, sauf si elle est imposée
 * (pour un quadrillage continu à cheval sur une limite de zone).
 * @returns {{ x: number, y: number, zone: object }}
 */
export function versLambert(point, zone = zoneDe(point[1])) {
  const [lon, lat] = wgs84VersMerchich(point);
  const { n, F, r0 } = constantes(zone);
  const r = CLARKE_IGN.a * F * tDe(rad(lat)) ** n * zone.k0;
  const θ = n * rad(lon - LON0);
  return { x: zone.x0 + r * Math.sin(θ), y: zone.y0 + r0 - r * Math.cos(θ), zone };
}

/** Lambert (mètres) d'une zone → [lon, lat] WGS 84. */
export function depuisLambert([x, y], zone) {
  const { n, F, r0 } = constantes(zone);
  const dx = x - zone.x0;
  const dy = r0 - (y - zone.y0);
  const r = Math.sign(n) * Math.hypot(dx, dy);
  const t = (r / (CLARKE_IGN.a * zone.k0 * F)) ** (1 / n);
  const θ = Math.atan2(dx, dy);
  let φ = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) {
    φ = Math.PI / 2 - 2 * Math.atan(t * ((1 - E * Math.sin(φ)) / (1 + E * Math.sin(φ))) ** (E / 2));
  }
  return merchichVersWgs84([deg(θ / n) + LON0, deg(φ)]);
}

/** 345678.4 → « 345 678 » (au mètre, espaces fines insécables). */
export function metres(v) {
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** « X 345 678 · Y 234 567 (Lambert Nord Maroc) » */
export function formaterLambert({ x, y, zone }, { langue = 'fr', avecZone = true } = {}) {
  const coord = `X ${metres(x)} · Y ${metres(y)}`;
  if (!avecZone) return coord;
  return `${coord} (${langue === 'ar' ? NOMS_ZONES_AR[zone.id] : zone.nom})`;
}
