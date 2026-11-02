/**
 * Projection d'un point sur un trajet — fonctions pures.
 *
 * Sert à situer barrages et points noirs LE LONG d'un itinéraire calculé :
 * distance au trajet, kilométrage cumulé, point projeté. Pur calcul
 * géométrique, sans dépendance à React ni Leaflet.
 */
import { distanceM } from './geometrie.js';

/** Distance minimale (m) d'un point à un segment [a,b] — projection locale, bornée aux extrémités. */
function distancePointSegmentM(p, a, b) {
  const latMoy = (p.lat + a.lat + b.lat) / 3;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((latMoy * Math.PI) / 180);
  const toXY = (q) => [q.lng * mLng, q.lat * mLat];
  const [px, py] = toXY(p);
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distance minimale (m) d'un point à une trace [[lng,lat], …]. */
export function distancePointTraceM(point, trace) {
  if (!trace?.length) return Infinity;
  if (trace.length === 1) return distanceM(point, { lng: trace[0][0], lat: trace[0][1] });
  let min = Infinity;
  for (let i = 0; i < trace.length - 1; i++) {
    const a = { lng: trace[i][0], lat: trace[i][1] };
    const b = { lng: trace[i + 1][0], lat: trace[i + 1][1] };
    const d = distancePointSegmentM(point, a, b);
    if (d < min) min = d;
  }
  return min;
}


/** Longueur cumulée (km) au début de chaque segment d'une trace, plus la longueur totale en dernier. */
export function traceCumulKm(trace) {
  const cumul = [0];
  for (let i = 1; i < trace.length; i++) {
    const a = { lng: trace[i - 1][0], lat: trace[i - 1][1] };
    const b = { lng: trace[i][0], lat: trace[i][1] };
    cumul.push(cumul[i - 1] + distanceM(a, b) / 1000);
  }
  return cumul;
}

/**
 * Projette un point sur la trace la plus proche : distance perpendiculaire (m)
 * et position le long du trajet (km depuis le départ). Sert à situer un
 * barrage ou un point noir sur un itinéraire pour repérer les tronçons non
 * couverts (voir `analyserCouvertureRoute` dans `analysis.js`).
 *
 * @param {object} point   {lng, lat}
 * @param {Array<[number,number]>} trace
 * @param {number[]} cumul  précalculé par `traceCumulKm(trace)` — évite de le refaire à chaque point
 */
export function projeterSurTrace(point, trace, cumul) {
  if (!trace?.length) return { km: 0, distanceM: Infinity };
  if (trace.length === 1) return { km: 0, distanceM: distanceM(point, { lng: trace[0][0], lat: trace[0][1] }) };

  const latMoy = point.lat;
  const mLat = 111_320;
  const mLng = 111_320 * Math.cos((latMoy * Math.PI) / 180);
  const toXY = (q) => [q.lng * mLng, q.lat * mLat];
  const [px, py] = toXY(point);

  let meilleure = { km: 0, distanceM: Infinity };
  for (let i = 0; i < trace.length - 1; i++) {
    const [ax, ay] = toXY({ lng: trace[i][0], lat: trace[i][1] });
    const [bx, by] = toXY({ lng: trace[i + 1][0], lat: trace[i + 1][1] });
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < meilleure.distanceM) {
      const segKm = cumul[i + 1] - cumul[i];
      meilleure = { km: cumul[i] + t * segKm, distanceM: d };
    }
  }
  return meilleure;
}
