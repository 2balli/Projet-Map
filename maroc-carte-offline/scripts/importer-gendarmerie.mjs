/**
 * Importe les couches de la Gendarmerie Royale produites par le projet
 * « Carte tactique » (`npm run build:layers` → public/layers/*.geojson) dans
 * `donnees/gendarmerie/`, au format de cette carte :
 *
 *   circo-reg.geojson   28 circonscriptions de commandement régional
 *   circo-cie.geojson   circonscriptions de compagnie
 *   circo-bt.geojson    circonscriptions de brigade territoriale
 *   unites.geojson      chefs-lieux (région, compagnie, brigade), avec les chiffres de leur circonscription,
 *                       et sites du classeur Classeur4.xlsx s'il est présent (voir fusionnerUnitesExcel)
 *   etiquettes.geojson  un point d'étiquette par circonscription (+ emprise, pour « Aller à »)
 *   infrastructures.geojson   péages, gares, aéroports, ports (OpenStreetMap)
 *   recherche-gendarmerie.json   unités pour la barre de recherche (même format que recherche.json)
 *   rapport.json        effectifs importés, anomalies signalées par la source
 *
 * Les pointages de flottes ne sont pas importés : la source les déclare générés
 * aléatoirement (74 % hors de toute circonscription).
 *
 * Usage :  npm run gendarmerie
 *          npm run gendarmerie -- --source "D:\Projet Map"     (dossier du projet ou son public/layers)
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { normaliser, TYPES, VERSION_INDEX } from '../src/recherche.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = path.join(RACINE, 'donnees', 'gendarmerie');
const SOURCE_PAR_DEFAUT = path.join(os.homedir(), 'OneDrive', 'Desktop', 'Projet Map');
const EXCEL_PAR_DEFAUT = path.join(RACINE, 'Classeur4.xlsx');

/** Emprise du Royaume, provinces du Sud incluses (contrôle des coordonnées). */
const DANS_LE_ROYAUME = ([lon, lat]) => lon >= -17.5 && lon <= -0.9 && lat >= 20.5 && lat <= 36.2;

// ── Géométrie ──────────────────────────────────────────────────────────────

/** Arrondit au 1e-5 degré (≈ 1 m) et retire les sommets devenus identiques. */
export function arrondir(geometrie) {
  const point = ([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
  const anneau = (a) => a.map(point).filter((p, i, t) => i === 0 || p[0] !== t[i - 1][0] || p[1] !== t[i - 1][1]);
  switch (geometrie.type) {
    case 'Point': return { type: 'Point', coordinates: point(geometrie.coordinates) };
    case 'Polygon': return { type: 'Polygon', coordinates: geometrie.coordinates.map(anneau).filter((a) => a.length >= 4) };
    case 'MultiPolygon': return {
      type: 'MultiPolygon',
      coordinates: geometrie.coordinates.map((p) => p.map(anneau).filter((a) => a.length >= 4)).filter((p) => p.length),
    };
    default: throw new Error(`géométrie non prise en charge : ${geometrie.type}`);
  }
}

const polygones = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

/** Aire plane (degrés², corrigée de la latitude) d'un anneau. */
function aire(anneau) {
  const k = Math.cos((anneau[0][1] * Math.PI) / 180);
  let s = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) s += (anneau[j][0] - anneau[i][0]) * (anneau[j][1] + anneau[i][1]);
  return Math.abs(s / 2) * k;
}

function dansAnneau([x, y], anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

export function dansPolygone(p, polygone) {
  return dansAnneau(p, polygone[0]) && !polygone.slice(1).some((trou) => dansAnneau(p, trou));
}

/** Distance (degrés, longitude corrigée) d'un point au bord le plus proche. */
function distanceAuBord([x, y], polygone, k) {
  let min = Infinity;
  for (const anneau of polygone) {
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      const ax = anneau[j][0] * k, ay = anneau[j][1], bx = anneau[i][0] * k, by = anneau[i][1];
      const dx = bx - ax, dy = by - ay;
      const t = dx || dy ? Math.max(0, Math.min(1, ((x * k - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
      min = Math.min(min, Math.hypot(x * k - (ax + t * dx), y - (ay + t * dy)));
    }
  }
  return min;
}

/**
 * Point d'étiquette : le point le plus éloigné des bords dans la plus grande
 * partie du contour (recherche sur grille, affinée trois fois). Toujours à
 * l'intérieur, contrairement au centroïde d'un contour en croissant.
 */
export function pointEtiquette(geometrie) {
  const polygone = polygones(geometrie).reduce((a, b) => (aire(b[0]) > aire(a[0]) ? b : a));
  const k = Math.cos((polygone[0][0][1] * Math.PI) / 180);
  const xs = polygone[0].map((p) => p[0]), ys = polygone[0].map((p) => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let meilleur = null, distance = -1;
  for (let passe = 0; passe < 4; passe++) {
    const n = 20;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const p = [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n];
        if (!dansPolygone(p, polygone)) continue;
        const d = distanceAuBord(p, polygone, k);
        if (d > distance) { distance = d; meilleur = p; }
      }
    }
    if (!meilleur) break;
    const [dx, dy] = [(x1 - x0) / 5, (y1 - y0) / 5];
    [x0, x1, y0, y1] = [meilleur[0] - dx, meilleur[0] + dx, meilleur[1] - dy, meilleur[1] + dy];
  }
  return arrondir({ type: 'Point', coordinates: meilleur ?? polygone[0][0] }).coordinates;
}

/** [[ouest, sud], [est, nord]] */
export function emprise(geometrie) {
  const points = polygones(geometrie).flatMap((p) => p[0]);
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

// ── Noms ───────────────────────────────────────────────────────────────────

const PREFIXES = { BT: 'BT', CIE: 'Cie', REG: 'Rég.' };

/** « BT IMOUZER IDA OUTANANE » → « BT Imouzer Ida Outanane » ; les noms déjà en casse mixte sont gardés. */
export function enTitre(nom) {
  const brut = String(nom ?? '').trim().replace(/\s+/g, ' ');
  if (brut !== brut.toUpperCase()) return brut;
  return brut.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, sep, l) => sep + l.toUpperCase())
    .replace(/^(Bt|Cie|Reg)\b/, (p) => PREFIXES[p.toUpperCase()]);
}

/** Nom de lieu sans le préfixe d'unité, pour les rapprochements : « BT AGADIR » → « agadir ». */
export function cleUnite(nom) {
  return normaliser(String(nom ?? '').replace(/^\s*(bt|cie|reg|région|region|compagnie|brigade)\.?\s+/i, ''));
}

/** Ossature consonantique, pour les variantes d'orthographe : Drarga / Drargua, Ait Abdellah / Ait Abdallah. */
export function squelette(nom) {
  return cleUnite(nom).replace(/[aeiouy\s]/g, '').replace(/(.)\1+/g, '$1');
}

/**
 * Répare un nom dont les lettres accentuées ont été perdues à l'encodage
 * (« Cie T�touan ») à l'aide du nom correct connu par ailleurs (« Tétouan »).
 */
export function reparerNom(nom, correct) {
  const brut = String(nom ?? '');
  if (!brut.includes('�') || !correct) return brut;
  const motif = brut.replace(/^(\s*(?:bt|cie|reg)\s+)/i, '').split('�')
    .map((morceau) => morceau.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.');
  if (!new RegExp(`^${motif}`, 'iu').test(correct)) return brut;
  const prefixe = /^(\s*(?:bt|cie|reg)\s+)/i.exec(brut)?.[1] ?? '';
  return `${prefixe}${correct}`;
}

/** « Aéroport Marrakech Ménara ⴰⵣⴰⴳⵯⵣ … مطار مراكش المنارة » → { fr: 'Aéroport Marrakech Ménara', ar: 'مطار مراكش المنارة' } */
export function separerNoms(nom) {
  const brut = String(nom ?? '').trim();
  const ar = (brut.match(/[\u0600-\u06FF][\u0600-\u06FF\s\-'’]*/gu) ?? []).join(' ').replace(/\s+/g, ' ').trim();
  const fr = brut.replace(/[\u0600-\u06FF\u2D30-\u2D7F]+/gu, ' ').replace(/\s+/g, ' ').replace(/[\s\-–,]+$/, '').trim();
  return { fr: fr || ar, ar: fr ? ar : '' };
}

// ── Import ─────────────────────────────────────────────────────────────────

function lireArguments(argv) {
  const i = argv.indexOf('--source');
  const source = i >= 0 ? argv[i + 1] : process.env.GR_SOURCE || SOURCE_PAR_DEFAUT;
  if (!source) throw new Error('--source : chemin manquant');
  return { source: path.resolve(source) };
}

export function dossierCouches(source) {
  for (const d of [path.join(source, 'public', 'layers'), path.join(source, 'dist', 'layers'), source]) {
    if (existsSync(path.join(d, 'circo_bt.geojson'))) return d;
  }
  return null;
}

const entite = (geometry, properties) => ({ type: 'Feature', geometry, properties });
const collection = (features) => ({ type: 'FeatureCollection', features });

/** Convertit le tableau Excel des unités en points, sans interpréter le nom de l'unité. */
export function lireUnitesExcel(chemin) {
  const classeur = XLSX.readFile(chemin, { cellDates: false });
  const feuille = classeur.Sheets[classeur.SheetNames[0]];
  const lignes = XLSX.utils.sheet_to_json(feuille, { defval: null });
  const features = [];
  let ignorees = 0;
  for (const ligne of lignes) {
    const longitude = Number(ligne.Longitude);
    const latitude = Number(ligne.Latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !DANS_LE_ROYAUME([longitude, latitude])) {
      ignorees++;
      continue;
    }
    features.push(entite({ type: 'Point', coordinates: [longitude, latitude] }, {
      nom: String(ligne.Unite ?? '').trim(),
      compagnie: ligne.Compagnie && ligne.Compagnie !== 'NULL' ? String(ligne.Compagnie).trim() : null,
      regroupement: String(ligne.RegroupementNiv1 ?? '').trim() || null,
    }));
  }
  return { fichiers: collection(features), ignorees };
}

/** Ordre de préséance pour nommer un site du classeur (le premier préfixe présent l'emporte). */
const PRESEANCE = ['EMR', 'EMCIE', 'BT', 'BJ', 'BD', 'SJ', 'PM', 'PMA', 'BMA', 'BGTA', 'BSI', 'BE', 'SRD', 'SRI', 'BA', 'BMU'];
const rangPreseance = (nom) => {
  const i = PRESEANCE.indexOf(String(nom).split(/\s+/)[0].toUpperCase());
  return i < 0 ? PRESEANCE.length : i;
};
/** Écart (mètres) sous lequel une ligne du classeur est sur le site d'un chef-lieu. */
const MEME_SITE_M = 30;

/** Nom comparable : sans la précision entre parenthèses (« BT RAS EL AIN (SAFI) » → « bt ras el ain »). */
const nomComparable = (nom) => normaliser(String(nom ?? '').replace(/\([^)]*\)/g, ' '));
const estBrigade = (nom) => /^\s*bt\b/i.test(String(nom ?? ''));

function ecartMetres([lon1, lat1], [lon2, lat2]) {
  const k = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot((lon2 - lon1) * k, lat2 - lat1) * 111_195;
}

/**
 * Chefs-lieux posés au même point (un seul y est cliquable) : `memePosition` pour deux
 * unités distinctes du même échelon (anomalie de la source), `memeSite` pour des échelons
 * différents (brigade et compagnie dans les mêmes locaux). Recalculé de zéro.
 * @returns {string[]} paires du même échelon (« BT A = BT B »)
 */
export function marquerSites(unites) {
  const chefs = unites.filter((f) => ['reg', 'cie', 'bt'].includes(f.properties.niveau));
  for (const f of chefs) {
    delete f.properties.memePosition;
    delete f.properties.memeSite;
  }
  const superposes = [];
  for (let i = 0; i < chefs.length; i++) {
    for (let j = i + 1; j < chefs.length; j++) {
      const [a, b] = [chefs[i].properties, chefs[j].properties];
      if (ecartMetres(chefs[i].geometry.coordinates, chefs[j].geometry.coordinates) > MEME_SITE_M) continue;
      const cle = a.niveau === b.niveau ? 'memePosition' : 'memeSite';
      (a[cle] ??= []).push(b.nom);
      (b[cle] ??= []).push(a.nom);
      if (a.niveau === b.niveau) superposes.push(`${a.nom} = ${b.nom}`);
    }
  }
  return superposes;
}

/** Écart (mètres) au-delà duquel une unité et son chef-lieu sont signalés comme mal placés. */
const ECART_SIGNALE_M = 1000;
const prefixe = (nom) => String(nom ?? '').trim().split(/\s+/)[0].toUpperCase();
/** Lieu d'une unité ou d'une colonne du classeur : « CIE SKHIRATE » → « skhirate », « EMCIE FES » → « fes ». */
const lieuDe = (nom) => cleUnite(String(nom ?? '').replace(/\([^)]*\)/g, ' ').replace(/^\s*(emcie|emr)\s+/i, ''));

/**
 * Combine les unités du classeur avec les chefs-lieux. Chaque ligne est rattachée
 * d'abord **par ce qu'elle est**, d'après ses colonnes, puis placée par sa position :
 *   - « BT X », « EMCIE X » (état-major de la compagnie X), « EMR X » (de la région X) sont
 *     le chef-lieu lui-même : doublons écartés. Une compagnie sans chef-lieu (absente de la
 *     Carte tactique) le reçoit de son EMCIE : `crees` ;
 *   - les autres unités dépendent de leur compagnie (colonne Compagnie), à défaut de leur
 *     région (colonne RegroupementNiv1, toujours pour les services d'EMR) : listées dans
 *     la fiche de ce chef-lieu (`rattachees` : [nom, où]) — où = null sur son site, le nom
 *     du chef-lieu qui les héberge, ou « site » pour un site à part ;
 *   - une unité posée sur le site d'un autre chef-lieu y figure aussi (`surSite` : [nom, dépend de]) ;
 *   - les lignes restantes forment un point par site : `sites` (propriété `unites` : noms des unités).
 * @param {object[]} chefsLieux  points bt / cie / reg (complétés sur place, `crees` y sont ajoutés)
 * @param {object[]} lignes      points du classeur ({ nom, compagnie, regroupement })
 * @param {object[]} circosCie   propriétés des circonscriptions de compagnie ({ id, nom, reg, … })
 * @returns {{ sites: object[], doublons: object[], crees: object[], rattachees: number,
 *   conflits: [string, string][], ecarts: [string, number][] }}
 *   rattachees : nombre de lignes rattachées à un chef-lieu ;
 *   conflits : brigade du classeur à moins de 30 m d'une autre brigade ;
 *   ecarts : unité du classeur à plus d'1 km de son chef-lieu (position à vérifier)
 */
export function fusionnerUnitesExcel(chefsLieux, lignes, circosCie = []) {
  // Rapprochement par le lieu exact (déjà sans accents ni lettres doublées) : l'ossature
  // consonantique est trop lâche ici (« Ouled Ayad » → « ld » rencontrerait d'autres « Ouled … »).
  const parLieu = (niveau) => {
    const index = new Map();
    for (const c of chefsLieux) {
      if (c.properties.niveau !== niveau) continue;
      for (const cle of [lieuDe(c.properties.nom), lieuDe(c.properties.lieu)]) {
        if (cle && !index.has(cle)) index.set(cle, c);
      }
    }
    return { trouver: (nom) => index.get(lieuDe(nom)) ?? null, ajouter: (cle, c) => index.set(cle, c) };
  };
  const index = { bt: parLieu('bt'), cie: parLieu('cie'), reg: parLieu('reg') };

  // Compagnies sans chef-lieu : celui de leur état-major (EMCIE).
  const crees = [];
  for (const circo of circosCie) {
    if (index.cie.trouver(circo.nom) || chefsLieux.some((c) => c.properties.niveau === 'cie' && c.properties.circo === circo.id)) continue;
    const etatMajor = lignes
      .filter((l) => prefixe(l.properties.nom) === 'EMCIE' && lieuDe(l.properties.compagnie) === lieuDe(circo.nom))
      .sort((a, b) => a.properties.nom.length - b.properties.nom.length)[0];
    if (!etatMajor) continue;
    const chefLieu = entite(etatMajor.geometry, {
      niveau: 'cie', nom: `Cie ${circo.nom}`, lieu: circo.nom, cie: null, reg: circo.reg ?? null,
      population: circo.population ?? null, superficie: circo.superficie ?? null, nbCie: null, nbBt: circo.nbBt ?? null,
      circo: circo.id, circoNom: circo.nom, rattachement: 'classeur',
    });
    chefsLieux.push(chefLieu);
    crees.push(chefLieu);
    index.cie.ajouter(lieuDe(circo.nom), chefLieu);
  }

  const doublons = [];
  const restantes = [];
  const conflits = [];
  const ecarts = [];
  let rattachees = 0;
  const hoteDe = (position) => {
    let hote = null;
    let meilleur = MEME_SITE_M;
    for (const c of chefsLieux) {
      const d = ecartMetres(position, c.geometry.coordinates);
      if (d <= meilleur) {
        meilleur = d;
        hote = c;
      }
    }
    return hote;
  };
  for (const ligne of lignes) {
    const { nom, compagnie, regroupement } = ligne.properties;
    const position = ligne.geometry.coordinates;
    const p = prefixe(nom);
    // La ligne est-elle le chef-lieu lui-même ?
    const lui = p === 'BT' ? index.bt.trouver(nom)
      : p === 'EMCIE' && lieuDe(nom) === lieuDe(compagnie) ? index.cie.trouver(compagnie)
        : p === 'EMR' && lieuDe(nom) === lieuDe(regroupement) ? index.reg.trouver(regroupement) : null;
    if (lui && (p !== 'BT' || nomComparable(nom) === nomComparable(lui.properties.nom) || ecartMetres(position, lui.geometry.coordinates) <= MEME_SITE_M)) {
      doublons.push(ligne);
      const d = ecartMetres(position, lui.geometry.coordinates);
      if (d > ECART_SIGNALE_M) ecarts.push([nom, Math.round(d)]);
      continue;
    }
    const parent = (p !== 'EMR' && compagnie ? index.cie.trouver(compagnie) : null) ?? (regroupement ? index.reg.trouver(regroupement) : null);
    const hote = hoteDe(position);
    if (estBrigade(nom) && hote?.properties.niveau === 'bt') conflits.push([hote.properties.nom, nom]);
    if (parent) {
      (parent.properties.rattachees ??= []).push([nom, hote === parent ? null : hote ? hote.properties.nom : 'site']);
      rattachees++;
    }
    if (hote && hote !== parent) (hote.properties.surSite ??= []).push([nom, parent?.properties.nom ?? null]);
    if (!hote) restantes.push({ ...ligne, properties: { ...ligne.properties, rattachement: parent?.properties.nom ?? null } });
  }
  const parPreseance = ([a], [b]) => rangPreseance(a) - rangPreseance(b) || a.localeCompare(b, 'fr');
  for (const c of chefsLieux) {
    c.properties.rattachees?.sort(parPreseance);
    c.properties.surSite?.sort(parPreseance);
  }

  const parSite = new Map();
  for (const ligne of restantes) {
    const cle = ligne.geometry.coordinates.map((v) => v.toFixed(5)).join(',');
    if (!parSite.has(cle)) parSite.set(cle, []);
    parSite.get(cle).push(ligne);
  }
  const sites = [...parSite.values()].map((groupe) => {
    groupe.sort((a, b) => rangPreseance(a.properties.nom) - rangPreseance(b.properties.nom)
      || a.properties.nom.length - b.properties.nom.length || a.properties.nom.localeCompare(b.properties.nom, 'fr'));
    const [principale] = groupe;
    const noms = groupe.map((l) => l.properties.nom);
    return entite(principale.geometry, {
      niveau: 'excel',
      nom: principale.properties.nom,
      etiquette: noms.length > 1 ? `${principale.properties.nom} +${noms.length - 1}` : principale.properties.nom,
      compagnie: principale.properties.compagnie,
      regroupement: principale.properties.regroupement,
      rattachement: principale.properties.rattachement,
      unites: noms,
    });
  });
  return { sites, doublons, crees, rattachees, conflits, ecarts };
}

/**
 * Construit tout le contenu de `donnees/gendarmerie/` à partir des couches lues.
 * Fonction pure : `couches` = { circo_reg, circo_cie, circo_bt, pts_reg, pts_cie, pts_bt, peages?, gares?, aeroports?, ports? }.
 */
export function construire(couches, rapportSource = {}) {
  const anomalies = [];
  const signaler = (niveau, message) => anomalies.push({ niveau, message });

  // Circonscriptions : attributs uniformisés (nom, cie, reg) quel que soit l'échelon.
  const circos = {
    reg: couches.circo_reg.features.map((f) => entite(arrondir(f.geometry), {
      niveau: 'reg', nom: f.properties.nom, nbCie: f.properties.nbCie, nbBt: f.properties.nbBt,
      population: f.properties.population, superficie: f.properties.superficie, confiance: f.properties.confiance ?? 1,
    })),
    cie: couches.circo_cie.features.map((f) => entite(arrondir(f.geometry), {
      niveau: 'cie', nom: f.properties.nom, reg: f.properties.reg, nbBt: f.properties.nbBt,
      population: f.properties.population, superficie: f.properties.superficie, confiance: f.properties.confiance ?? 1,
    })),
    bt: couches.circo_bt.features.map((f) => entite(arrondir(f.geometry), {
      niveau: 'bt', nom: f.properties.gr_bde, cie: f.properties.gr_cie, reg: f.properties.gr_region,
      population: f.properties.population, superficie: Math.round(f.properties.superficie ?? 0),
    })),
  };
  for (const [niveau, liste] of Object.entries(circos)) {
    liste.forEach((f, id) => { f.id = id; f.properties.id = `${niveau}-${id}`; });
    const incertaines = liste.filter((f) => f.properties.confiance < 1);
    if (incertaines.length) {
      signaler('attention', `${incertaines.length} contour(s) ${niveau === 'cie' ? 'de compagnie' : 'de région'} nommé(s) avec une attribution incertaine : `
        + incertaines.map((f) => `${f.properties.nom} ${Math.round(f.properties.confiance * 100)} %`).join(', '));
    }
  }

  const etiquettes = Object.values(circos).flat().map((f) => entite(
    { type: 'Point', coordinates: pointEtiquette(f.geometry) },
    { niveau: f.properties.niveau, nom: f.properties.nom, id: f.properties.id, emprise: emprise(f.geometry) },
  ));

  // Chefs-lieux : rattachés à leur circonscription pour en porter les chiffres —
  // par le nom d'abord, sinon par le contour qui contient le chef-lieu.
  const parNom = (liste) => new Map(liste.map((f) => [cleUnite(f.properties.nom), f.properties]));
  const index = { reg: parNom(circos.reg), cie: parNom(circos.cie), bt: parNom(circos.bt) };
  const contenant = (niveau, p) => circos[niveau].find((c) => polygones(c.geometry).some((poly) => dansPolygone(p, poly)))?.properties;
  const unites = [];
  let horsZone = 0;
  let repares = 0;
  for (const [niveau, cle] of [['reg', 'pts_reg'], ['cie', 'pts_cie'], ['bt', 'pts_bt']]) {
    const bilan = { nom: 0, orthographe: 0, position: 0, aucun: 0 };
    for (const f of couches[cle].features) {
      if (!f.geometry || f.geometry.type !== 'Point' || !DANS_LE_ROYAUME(f.geometry.coordinates)) { horsZone++; continue; }
      const p = f.properties;
      const lieuSource = niveau === 'bt' ? p.nom : p.unite ?? p.nom;
      let circo = index[niveau].get(cleUnite(lieuSource));
      let rattachement = 'nom';
      if (!circo) {
        circo = contenant(niveau, f.geometry.coordinates);
        rattachement = !circo ? null
          : squelette(lieuSource) === squelette(circo.nom) || reparerNom(lieuSource, circo.nom) !== lieuSource ? 'orthographe' : 'position';
      }
      bilan[rattachement ?? 'aucun']++;
      const nomRepare = reparerNom(p.nom, circo?.nom);
      if (nomRepare !== p.nom) repares++;
      const lieu = rattachement === 'nom' || rattachement === 'orthographe' ? circo.nom
        : enTitre(String(nomRepare).replace(/^\s*(bt|cie|reg)\s+/i, ''));
      unites.push(entite(arrondir(f.geometry), {
        niveau,
        nom: enTitre(nomRepare.includes('�') ? `${nomRepare.split(' ')[0]} ${lieu}` : nomRepare),
        lieu,
        cie: niveau === 'bt' ? enTitre(String(p.cie ?? '').replace(/^\s*cie\s+/i, '')) : null,
        reg: niveau === 'reg' ? null : enTitre(String(niveau === 'bt' ? p.reg : circo?.reg ?? '').replace(/^\s*reg\s+/i, '')) || null,
        population: circo?.population ?? null,
        superficie: circo?.superficie ?? null,
        nbCie: circo?.nbCie ?? null,
        nbBt: circo?.nbBt ?? null,
        circo: circo?.id ?? null,
        circoNom: circo?.nom ?? null,
        rattachement,
      }));
    }
    const echelon = niveau === 'bt' ? 'de brigade' : niveau === 'cie' ? 'de compagnie' : 'de région';
    if (bilan.position) signaler('info', `${bilan.position} chef(s)-lieu(x) ${echelon} rattaché(s) au contour qui les contient, faute de contour du même nom`);
    if (bilan.aucun) signaler('attention', `${bilan.aucun} chef(s)-lieu(x) ${echelon} hors de tout contour ${echelon}`);
  }
  if (repares) signaler('info', `${repares} nom(s) d'unité aux accents perdus réparé(s) d'après le nom de leur circonscription`);
  const superposes = marquerSites(unites);
  if (superposes.length) {
    signaler('attention', `${superposes.length} paire(s) de chefs-lieux distincts au même point dans la source (position à vérifier) : ${superposes.join(', ')}`);
  }
  if (horsZone) signaler('attention', `${horsZone} chef(s)-lieu(x) sans coordonnées valides : absents de la carte`);

  // Infrastructures (OpenStreetMap), une seule couche typée.
  const infrastructures = [];
  for (const [type, cle] of [['peage', 'peages'], ['gare', 'gares'], ['aeroport', 'aeroports'], ['port', 'ports']]) {
    for (const f of couches[cle]?.features ?? []) {
      if (f.geometry?.type !== 'Point' || !DANS_LE_ROYAUME(f.geometry.coordinates)) continue;
      const { fr, ar } = separerNoms(f.properties.nom);
      infrastructures.push(entite(arrondir(f.geometry), { type, nom: fr, nomAr: ar, iata: f.properties.iata ?? null }));
    }
  }

  // Index de recherche (format de src/recherche.js).
  const contextes = [];
  const indexContexte = new Map();
  const contexte = (fr, ar) => {
    if (!fr) return -1;
    if (!indexContexte.has(fr)) { indexContexte.set(fr, contextes.length); contextes.push([fr, ar]); }
    return indexContexte.get(fr);
  };
  const kinds = ['gr_reg', 'gr_cie', 'gr_bt'];
  const typeDe = { reg: TYPES.indexOf('commandement'), cie: TYPES.indexOf('compagnie'), bt: TYPES.indexOf('brigade') };
  const rang = { reg: 90, cie: 70, bt: 50 };
  const e = unites.map(({ geometry: { coordinates: [lon, lat] }, properties: u }) => {
    const ctx = u.niveau === 'bt' ? contexte(`Cie ${u.cie} · Rég. ${u.reg}`, `سرية ${u.cie} · جهة ${u.reg}`)
      : u.niveau === 'cie' && u.reg ? contexte(`Rég. ${u.reg}`, `جهة ${u.reg}`) : -1;
    return [typeDe[u.niveau], u.nom, '', Math.round(lon * 1e5), Math.round(lat * 1e5), rang[u.niveau], ctx,
      kinds.indexOf(`gr_${u.niveau}`), `${u.lieu} gendarmerie درك`];
  });
  // Circonscriptions de brigade sans chef-lieu du même nom : cherchables à leur point d'étiquette.
  const avecChefLieu = new Set(unites.filter((u) => u.properties.rattachement === 'nom' || u.properties.rattachement === 'orthographe')
    .map((u) => u.properties.circo));
  for (const f of etiquettes) {
    if (f.properties.niveau !== 'bt' || avecChefLieu.has(f.properties.id)) continue;
    const c = circos.bt[Number(f.properties.id.split('-')[1])].properties;
    const [lon, lat] = f.geometry.coordinates;
    e.push([typeDe.bt, `Circonscription BT ${c.nom}`, '', Math.round(lon * 1e5), Math.round(lat * 1e5), 40,
      contexte(`Cie ${c.cie} · Rég. ${c.reg}`, `سرية ${c.cie} · جهة ${c.reg}`), kinds.indexOf('gr_bt'), `${c.nom} gendarmerie درك`]);
  }

  for (const a of rapportSource.issues ?? []) {
    if (/pointage/i.test(a.message)) continue; // couche non importée
    if (/attribu|nommés sur des votes/i.test(a.message)) continue; // déjà signalé ci-dessus, chiffré
    signaler(a.level === 'critical' ? 'attention' : 'info', `Source : ${a.message}`);
  }

  const compte = (n) => unites.filter((u) => u.properties.niveau === n).length;
  return {
    fichiers: {
      'circo-reg.geojson': collection(circos.reg),
      'circo-cie.geojson': collection(circos.cie),
      'circo-bt.geojson': collection(circos.bt),
      'unites.geojson': collection(unites),
      'etiquettes.geojson': collection(etiquettes),
      'infrastructures.geojson': collection(infrastructures),
      'recherche-gendarmerie.json': { version: VERSION_INDEX, contextes, kinds, e },
    },
    rapport: {
      fictif: rapportSource.fictif === true,
      circonscriptions: { reg: circos.reg.length, cie: circos.cie.length, bt: circos.bt.length },
      chefsLieux: { reg: compte('reg'), cie: compte('cie'), bt: compte('bt') },
      infrastructures: Object.fromEntries(['peage', 'gare', 'aeroport', 'port'].map((t) => [t, infrastructures.filter((f) => f.properties.type === t).length])),
      anomalies,
    },
  };
}

async function principal() {
  const { source } = lireArguments(process.argv.slice(2));
  const dossier = dossierCouches(source);
  if (!dossier) {
    console.error(`Couches introuvables dans « ${source} ».\nIndiquez le projet Carte tactique : npm run gendarmerie -- --source "<dossier>"`);
    process.exit(1);
  }
  console.log(`Source : ${dossier}`);
  const lire = async (nom, obligatoire = true) => {
    const fichier = path.join(dossier, nom);
    if (!existsSync(fichier)) {
      if (obligatoire) throw new Error(`fichier absent : ${fichier}`);
      console.warn(`  ! ${nom} absent : couche ignorée`);
      return null;
    }
    return JSON.parse(await readFile(fichier, 'utf8'));
  };
  const couches = {};
  for (const nom of ['circo_reg', 'circo_cie', 'circo_bt', 'pts_reg', 'pts_cie', 'pts_bt']) couches[nom] = await lire(`${nom}.geojson`);
  for (const nom of ['peages', 'gares', 'aeroports', 'ports']) couches[nom] = await lire(`${nom}.geojson`, false);
  const rapportSource = (await lire('_report.json', false)) ?? {};

  const { fichiers, rapport } = construire(couches, rapportSource);
  if (existsSync(EXCEL_PAR_DEFAUT)) {
    const excel = lireUnitesExcel(EXCEL_PAR_DEFAUT);
    const unites = fichiers['unites.geojson'].features;
    const circosCie = fichiers['circo-cie.geojson'].features.map((f) => f.properties);
    const { sites, doublons, crees, rattachees, conflits, ecarts } = fusionnerUnitesExcel(unites, excel.fichiers.features, circosCie);
    if (crees.length) {
      rapport.anomalies.push({
        niveau: 'info',
        message: `Classeur : ${crees.length} compagnie(s) sans chef-lieu dans la Carte tactique, placée(s) à leur état-major (EMCIE) : `
          + crees.map((c) => c.properties.lieu).join(', '),
      });
      rapport.chefsLieux.cie += crees.length;
    }
    if (ecarts.length) {
      rapport.anomalies.push({
        niveau: 'attention',
        message: `Classeur : ${ecarts.length} unité(s) à plus d'1 km de leur chef-lieu dans la Carte tactique (position à vérifier) : `
          + ecarts.map(([nom, d]) => `${nom} ${(d / 1000).toFixed(1).replace('.', ',')} km`).join(', '),
      });
    }
    if (conflits.length) {
      rapport.anomalies.push({
        niveau: 'attention',
        message: `Classeur : ${conflits.length} brigade(s) à moins de 30 m d'une autre brigade (position à vérifier dans l'une des deux sources) : `
          + conflits.map(([chefLieu, ligne]) => `${ligne} sur ${chefLieu}`).join(', '),
      });
    }
    marquerSites(unites); // les compagnies placées d'après le classeur partagent souvent le site d'une brigade
    unites.push(...sites);
    // La recherche garde chaque unité du classeur, sauf les doublons des chefs-lieux (déjà indexés).
    const ecartees = new Set(doublons);
    excel.fichiers.features = excel.fichiers.features.filter((f) => !ecartees.has(f));
    const indexExcel = fichiers['recherche-gendarmerie.json'];
    const kindExcel = indexExcel.kinds.push('gr_excel') - 1;
    const contexteExcel = (nom) => {
      const i = indexExcel.contextes.findIndex(([fr]) => fr === nom);
      if (i >= 0) return i;
      indexExcel.contextes.push([nom, nom]);
      return indexExcel.contextes.length - 1;
    };
    // Compagnies placées d'après le classeur : cherchables comme les autres chefs-lieux.
    for (const c of crees) {
      const [lon, lat] = c.geometry.coordinates;
      indexExcel.e.push([TYPES.indexOf('compagnie'), c.properties.nom, '', Math.round(lon * 1e5), Math.round(lat * 1e5), 70,
        c.properties.reg ? contexteExcel(`Rég. ${c.properties.reg}`) : -1, indexExcel.kinds.indexOf('gr_cie'), `${c.properties.lieu} gendarmerie درك`]);
    }
    for (const f of excel.fichiers.features) {
      const p = f.properties;
      const [lon, lat] = f.geometry.coordinates;
      const rattachement = [p.compagnie, p.regroupement].filter(Boolean).join(' · ');
      indexExcel.e.push([
        TYPES.indexOf('lieu'), p.nom, '', Math.round(lon * 1e5), Math.round(lat * 1e5), 45,
        rattachement ? contexteExcel(rattachement) : -1, kindExcel,
        `${p.nom} ${rattachement} gendarmerie unité`,
      ]);
    }
    rapport.excel = {
      lignes: excel.fichiers.features.length + doublons.length,
      doublons: doublons.length,
      compagniesCreees: crees.length,
      rattachees,
      sites: sites.length,
      coordonneesManquantes: excel.ignorees,
      source: EXCEL_PAR_DEFAUT,
    };
  }
  rapport.source = dossier;
  rapport.importeLe = new Date().toISOString();

  await mkdir(SORTIE, { recursive: true });
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const texte = JSON.stringify(contenu);
    await writeFile(path.join(SORTIE, nom), texte);
    console.log(`  ${nom.padEnd(30)} ${(texte.length / 1e6).toFixed(2)} Mo`);
  }
  await writeFile(path.join(SORTIE, 'rapport.json'), JSON.stringify(rapport, null, 2));

  const { circonscriptions: c, chefsLieux: u } = rapport;
  console.log(`\nCirconscriptions : ${c.reg} régions, ${c.cie} compagnies, ${c.bt} brigades`);
  console.log(`Chefs-lieux      : ${u.reg} régions, ${u.cie} compagnies, ${u.bt} brigades`);
  if (rapport.excel) {
    const x = rapport.excel;
    console.log(`Classeur         : ${x.lignes} unités — ${x.doublons} doublons des chefs-lieux écartés, `
      + `${x.rattachees} rattachées à un chef-lieu, ${x.sites} autres sites`);
  }
  if (rapport.fictif) console.log('\n*** La source déclare un jeu FICTIF : la carte affichera « données fictives ». ***');
  for (const a of rapport.anomalies) console.log(`  [${a.niveau}] ${a.message}`);
  console.log(`\nÉcrit dans ${SORTIE}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((erreur) => {
    console.error(`Import impossible : ${erreur.message}`);
    process.exit(1);
  });
}
