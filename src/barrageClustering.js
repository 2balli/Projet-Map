/** Administrative aggregation. Input must already pass map visibility and RBAC. */
import { centroid, bbox } from '@turf/turf';
import { sansAccent } from './texte.js';
import * as MQ from './marquages.js';

export const SEUILS_ZOOM = { REGION_MAX: 6, CIE_MIN: 7, CIE_MAX: 8, INDIVIDUEL_MIN: 9 };
export function determinerNiveauHierarchie(zoom) {
  if (!Number.isFinite(zoom) || zoom >= SEUILS_ZOOM.INDIVIDUEL_MIN) return 'barrage';
  return zoom >= SEUILS_ZOOM.CIE_MIN ? 'compagnie' : 'region';
}
export const normaliserNomEntite = (nom) => sansAccent(nom).trim()
  .replace(/^(bt|cie|reg|region|compagnie|brigade)\s+/i, '').replace(/\s+/g, ' ');
const niveaux = ['region', 'compagnie', 'brigade'];
const champs = ['reg', 'cie', 'bt'];
const estBarrage = (m) => MQ.estBarrage(m);
const positionValide = (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng);
const chemin = (p, rang) => champs.slice(0, rang + 1).map((k) => normaliserNomEntite(p[k]));
const cle = (p, rang) => JSON.stringify(chemin(p, rang));
function appartenance(p, rang) {
  return {
    reg: p.reg || p.gr_region || (rang === 0 ? p.unite || p.nom : ''),
    cie: p.cie || p.gr_cie || (rang === 1 ? p.unite || p.nom : ''),
    bt: p.bt || p.gr_bde || (rang === 2 ? p.unite || p.nom : ''),
  };
}
function correspond(a, b, rang) {
  return champs.slice(0, rang + 1).every((k) => !a[k] || !b[k]
    || normaliserNomEntite(a[k]) === normaliserNomEntite(b[k]));
}

/** Build once per geography change; never choose arbitrarily between homonyms. */
export function construireIndexAdministratif(geo = {}) {
  const index = niveaux.map(() => new Map());
  const ajouter = (rang, entite) => {
    const nom = normaliserNomEntite(entite[champs[rang]]);
    if (!nom) return;
    const liste = index[rang].get(nom) || [];
    liste.push(entite);
    index[rang].set(nom, liste);
  };
  [geo.circoReg, geo.circoCie, geo.circoBt].forEach((couche, rang) => {
    for (const f of couche?.features || []) {
      const p = appartenance(f.properties || {}, rang);
      let centre = null, bounds = null;
      try {
        const [lng, lat] = centroid(f).geometry.coordinates;
        if (Number.isFinite(lat) && Number.isFinite(lng)) centre = [lat, lng];
        const [w, s, e, n] = bbox(f);
        if ([w, s, e, n].every(Number.isFinite)) bounds = [[s, w], [n, e]];
      } catch { /* Incomplete geometry: use headquarters or contained markers. */ }
      ajouter(rang, { ...p, centre, bounds });
    }
  });
  [geo.ptsReg, geo.ptsCie, geo.ptsBt].forEach((couche, rang) => {
    for (const f of couche?.features || []) {
      if (f.geometry?.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const p = appartenance(f.properties || {}, rang);
      const entitesDuNom = index[rang].get(normaliserNomEntite(p[champs[rang]])) || [];
      const candidats = entitesDuNom
        .filter((e) => correspond(p, e, rang));
      if (candidats.length === 1) candidats[0].siege = [lat, lng];
      else if (entitesDuNom.length === 1) entitesDuNom[0].siege = [lat, lng];
      else if (!entitesDuNom.length) ajouter(rang, { ...p, siege: [lat, lng] });
    }
  });
  const poles = geo.polesPop || geo.poles;
  for (const f of (Array.isArray(poles) ? poles : poles?.features) || []) {
    const p = f.properties || f;
    const coords = f.geometry?.coordinates || [p.lng, p.lat];
    if (coords.length < 2 || !coords.slice(0, 2).every(Number.isFinite)) continue;
    for (let rang = 0; rang < 3; rang++) {
      const candidats = index[rang].get(normaliserNomEntite(p.nom || p.ville || p.nom_fr)) || [];
      if (candidats.length === 1) candidats[0].centreAdministratif = [coords[1], coords[0]];
    }
  }
  return index;
}
function resoudreEntite(p, rang, index) {
  const candidats = (index[rang].get(normaliserNomEntite(p[champs[rang]])) || [])
    .filter((e) => correspond(p, e, rang));
  return candidats.length === 1 ? candidats[0] : null;
}

/** Diagnostic of the real barrage -> brigade -> compagnie -> region mapping. */
export function diagnostiquerHierarchie(items, geo = {}) {
  const index = Array.isArray(geo) ? geo : construireIndexAdministratif(geo);
  const resultat = { total: 0, resolus: 0, nonResolus: 0, ambigus: 0, exemplesNonResolus: [], exemplesAmbigus: [] };
  for (const barrage of items || []) {
    if (!estBarrage(barrage) || !positionValide(barrage)) continue;
    resultat.total += 1;
    const p = resoudreAppartenance(barrage, index);
    const candidats = (index[2].get(normaliserNomEntite(p.bt)) || [])
      .filter((entite) => correspond(p, entite, 2));
    if (candidats.length === 1) resultat.resolus += 1;
    else if (candidats.length > 1) {
      resultat.ambigus += 1;
      if (resultat.exemplesAmbigus.length < 5) resultat.exemplesAmbigus.push({ id: barrage.id, ...p });
    } else {
      resultat.nonResolus += 1;
      if (resultat.exemplesNonResolus.length < 5) resultat.exemplesNonResolus.push({ id: barrage.id, ...p });
    }
  }
  return resultat;
}
/** Resolve names against the hierarchy. A globally unique brigade is authoritative. */
function resoudreAppartenance(b, index) {
  const p = appartenance(b, -1);
  const brigadesDuNom = index[2].get(normaliserNomEntite(p.bt)) || [];
  const brigade = brigadesDuNom.length === 1
    ? brigadesDuNom[0]
    : brigadesDuNom.filter((entite) => correspond(p, entite, 2)).length === 1
      ? brigadesDuNom.filter((entite) => correspond(p, entite, 2))[0]
      : null;
  if (brigade) {
    // The polygon hierarchy corrects stale compagnie/region values on records.
    for (const k of champs) p[k] = brigade[k] || p[k];
    return p;
  }
  for (const rang of [1, 0]) {
    const e = resoudreEntite(p, rang, index);
    if (e) for (const k of champs) if (!p[k]) p[k] = e[k];
  }
  return p;
}
export function agregerBarragesHierarchie(items, zoom, geo = {}) {
  const niveau = typeof zoom === 'string' ? zoom : determinerNiveauHierarchie(zoom);
  const rang = niveau === 'region' ? 0 : niveau === 'compagnie' ? 1 : -1;
  if (rang < 0) return [];
  const index = Array.isArray(geo) ? geo : construireIndexAdministratif(geo);
  const groupes = new Map();
  for (const [i, b] of (items || []).entries()) {
    if (!estBarrage(b) || !positionValide(b)) continue;
    const p = resoudreAppartenance(b, index);
    // Incomplete membership stays isolated, rather than combining unrelated units.
    const complet = chemin(p, rang).every(Boolean);
    const id = complet ? cle(p, rang) : JSON.stringify(['non-affecte', b.id ?? i]);
    if (!groupes.has(id)) groupes.set(id, { p, barrages: [], entite: complet ? resoudreEntite(p, rang, index) : null });
    groupes.get(id).barrages.push(b);
  }
  return [...groupes].map(([id, { p, barrages, entite }]) => {
    const lat = barrages.reduce((s, b) => s + b.lat, 0) / barrages.length;
    const lng = barrages.reduce((s, b) => s + b.lng, 0) / barrages.length;
    const position = entite?.siege || entite?.centreAdministratif || entite?.centre || [lat, lng];
    const bounds = entite?.bounds || barrages.reduce((r, b) => [
      [Math.min(r[0][0], b.lat), Math.min(r[0][1], b.lng)],
      [Math.max(r[1][0], b.lat), Math.max(r[1][1], b.lng)],
    ], [[Infinity, Infinity], [-Infinity, -Infinity]]);
    const fixesCount = barrages.filter((b) => b.type === 'barrage_fixe' || b.type === 'FIXED' || b.type === 'FIXED_PERMANENT').length;
    return { id: `${niveau}:${id}`, niveau, nom: p[champs[rang]] || 'Non affecté',
      count: barrages.length, fixesCount, mobilesCount: barrages.length - fixesCount,
      lat: position[0], lng: position[1], bounds, barrages };
  }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
/** Fit administrative bounds, then enforce the next (and only) visual level. */
export function explorerCluster(map, cluster) {
  if (!map || !cluster.bounds) return;
  const bande = { region: [7, 8], compagnie: [9, 14] }[cluster.niveau];
  if (!bande) return;
  const [min, max] = bande;
  const zoomNaturel = map.getBoundsZoom(cluster.bounds, false);
  const zoomCible = Math.max(min, Math.min(max, zoomNaturel));
  map.stop();
  if (zoomNaturel >= min) {
    map.fitBounds(cluster.bounds, { padding: [40, 40], maxZoom: max, animate: true, duration: 0.3 });
    return;
  }
  const [[sud, ouest], [nord, est]] = cluster.bounds;
  map.flyTo([(sud + nord) / 2, (ouest + est) / 2], zoomCible, { duration: 0.3 });
}
