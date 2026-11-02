/**
 * Distance géodésique — fonction pure, sans React ni Leaflet.
 *
 * Ce module portait aussi le calcul de surface des zones de crise
 * (`calculerSurfaceHa`, `formatHa`) ; il est parti avec la gestion de crise
 * elle-même. Ne reste que la distance entre deux points, dont se sert la
 * projection d'un marquage sur un itinéraire (voir correlation.js).
 */

/**
 * Distance approchée en mètres entre deux points {lng, lat}.
 *
 * Projection équirectangulaire locale : à l'échelle où elle sert — quelques
 * kilomètres autour d'un trajet — l'écart avec une géodésique exacte est
 * négligeable, et le calcul est assez rapide pour être refait sur chaque
 * segment d'une polyligne à chaque rendu.
 */
export function distanceM(a, b) {
  const mParDegLat = 111_320;
  const mParDegLng = 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dx = (a.lng - b.lng) * mParDegLng;
  const dy = (a.lat - b.lat) * mParDegLat;
  return Math.hypot(dx, dy);
}
