/**
 * L'ESPACEMENT DES BARRAGES LE LONG D'UNE ROUTE — distance PAR LA ROUTE entre
 * barrages consécutifs, comparée à un maximum choisi par l'utilisateur.
 *
 * L'AXE est une polyligne `[[lng, lat, abscisse km], …]` qui suit la géométrie
 * réelle : le TRONC du référentiel kilométrique pour une route numérotée
 * (serveur/pointKilometrique.mjs, PK 0 au nord), le tracé du trajet pour un
 * itinéraire. Chaque barrage est projeté sur l'axe ; l'écart entre deux
 * barrages consécutifs est la différence de leurs abscisses — une longueur de
 * route, jamais une distance à vol d'oiseau.
 *
 * LES SAUTS. Là où la donnée OSM est coupée, le tronc relie deux tronçons par
 * un raccord à vol d'oiseau (`sauts`, en abscisses). Un écart qui en traverse
 * un n'est pas une longueur de route mesurée : il est rendu « incertain », et
 * l'écran le dit au lieu de présenter un chiffre inventé.
 *
 * LES PROPOSITIONS ne sont que des propositions : pour un écart de `d` km au-delà
 * du maximum `max`, il manque au moins ⌈d / max⌉ − 1 postes ; on les place à
 * intervalles égaux le long de l'axe. Rien n'est écrit ici.
 *
 * Module pur : aucun accès au dépôt, éprouvé tel quel.
 */
const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const distanceKm = (a, b) => {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Un axe à abscisses à partir d'une simple polyligne `[[lng, lat], …]`. */
export function axeDepuisPolyligne(coords) {
  const axe = [];
  let s = 0;
  coords.forEach((p, k) => {
    if (k) s += distanceKm(coords[k - 1], p);
    axe.push([p[0], p[1], s]);
  });
  return axe;
}

/** Projection d'un point sur l'axe : abscisse et écart à l'axe (km). */
export function projeterSurAxe(axe, [lng, lat]) {
  const c = Math.cos(rad(lat));
  let best = null;
  for (let k = 1; k < axe.length; k++) {
    const a = axe[k - 1];
    const b = axe[k];
    const dx = (b[0] - a[0]) * c;
    const dy = b[1] - a[1];
    const n = dx * dx + dy * dy;
    let t = n ? ((lng - a[0]) * c * dx + (lat - a[1]) * dy) / n : 0;
    t = Math.max(0, Math.min(1, t));
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const ecart = distanceKm([lng, lat], p);
    if (!best || ecart < best.ecart) best = { abscisse: a[2] + t * (b[2] - a[2]), ecart };
  }
  return best;
}

/** Le point de l'axe à l'abscisse `s`. */
export function pointA(axe, s) {
  for (let k = 1; k < axe.length; k++) {
    const a = axe[k - 1];
    const b = axe[k];
    if (s <= b[2] || k === axe.length - 1) {
      const t = b[2] > a[2] ? Math.max(0, Math.min(1, (s - a[2]) / (b[2] - a[2]))) : 0;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return axe.length ? [axe[0][0], axe[0][1]] : null;
}

/** La portion de l'axe entre deux abscisses — ce qu'on dessine pour un écart. */
export function portionAxe(axe, s1, s2) {
  const [d, f] = s1 <= s2 ? [s1, s2] : [s2, s1];
  const out = [pointA(axe, d)];
  for (const p of axe) if (p[2] > d && p[2] < f) out.push([p[0], p[1]]);
  out.push(pointA(axe, f));
  return out.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

/**
 * @param {object} o
 * @param {Array<[number, number, number]>} o.axe
 * @param {Array<[number, number]>} [o.sauts]    abscisses des raccords à vol d'oiseau
 * @param {Array<{id, nom, lng, lat}>} o.barrages  les barrages de la route
 * @param {number} o.maxKm                        écart maximal permis entre deux consécutifs
 * @returns {{ordre, troncons, depassements, avertissements, longueurKm}}
 */
export function analyserEspacement({ axe, sauts = [], barrages, maxKm }) {
  const avertissements = [];
  if (!Array.isArray(axe) || axe.length < 2) {
    return { ordre: [], troncons: [], depassements: 0, longueurKm: 0, avertissements: ['Géométrie de la route absente : aucune distance ne peut être mesurée.'] };
  }
  const longueurKm = axe[axe.length - 1][2];
  const ordre = barrages
    .map((b) => ({ id: b.id, nom: b.nom, lng: b.lng, lat: b.lat, ...projeterSurAxe(axe, [b.lng, b.lat]) }))
    .filter((b) => b.abscisse != null)
    .sort((x, y) => x.abscisse - y.abscisse);
  const croiseSaut = (s1, s2) => sauts.filter(([a, b]) => a < s2 && b > s1);
  const troncons = [];
  for (let k = 1; k < ordre.length; k++) {
    const a = ordre[k - 1];
    const b = ordre[k];
    const km = b.abscisse - a.abscisse;
    const s = croiseSaut(a.abscisse, b.abscisse);
    const depasse = km > maxKm + 1e-9;
    const manque = depasse ? Math.ceil(km / maxKm - 1e-9) - 1 : 0;
    const propositions = [];
    /* Une position qui tomberait sur un raccord à vol d'oiseau ne serait pas
       sur une route : elle n'est pas proposée, elle est comptée. */
    let sansPosition = 0;
    for (let i = 1; i <= manque; i++) {
      const abscisse = a.abscisse + (km * i) / (manque + 1);
      if (sauts.some(([x, y]) => abscisse > x && abscisse < y)) {
        sansPosition++;
        continue;
      }
      const [lng, lat] = pointA(axe, abscisse);
      propositions.push({ lng: Math.round(lng * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5, abscisse: Math.round(abscisse * 100) / 100 });
    }
    troncons.push({
      a: { id: a.id, nom: a.nom }, b: { id: b.id, nom: b.nom },
      km: Math.round(km * 100) / 100,
      depasse,
      manque,
      propositions,
      sansPosition,
      /* Un raccord à vol d'oiseau dans l'intervalle : longueur non mesurée sur la route. */
      incertain: s.length > 0,
      sautsKm: Math.round(s.reduce((t, [x, y]) => t + Math.min(y, b.abscisse) - Math.max(x, a.abscisse), 0) * 10) / 10,
      trace: portionAxe(axe, a.abscisse, b.abscisse),
      milieu: pointA(axe, (a.abscisse + b.abscisse) / 2),
    });
  }
  if (ordre.length < 2) avertissements.push('Moins de deux barrages sur cette route : aucun écart à mesurer.');
  if (troncons.some((t) => t.incertain)) {
    avertissements.push('La géométrie de la route est incomplète par endroits (tronçons OSM raccordés à vol d’oiseau) : les écarts marqués « incertain » ne sont pas des longueurs de route mesurées.');
  }
  return {
    ordre: ordre.map((b) => ({ id: b.id, nom: b.nom, abscisse: Math.round(b.abscisse * 100) / 100, ecartRouteM: Math.round(b.ecart * 1000) })),
    troncons,
    depassements: troncons.filter((t) => t.depasse).length,
    longueurKm: Math.round(longueurKm * 10) / 10,
    avertissements,
  };
}
