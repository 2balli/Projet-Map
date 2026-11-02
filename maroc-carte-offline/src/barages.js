/**
 * Barages (points de contrôle) — fonctions pures, sans MapLibre ni DOM.
 *
 * Deux types :
 *   - « fixe »        : position fixe, affecté à UNE faction de 6 h (`shift` : 00-06, 06-12, 12-18 ou 18-24) ;
 *   - « intouchable » : position fixe, permanent 24 h/24 (`shift` : « continu ») — sans faction, « non affecté ».
 * La faction est une affectation enregistrée : rien ici ne déduit qu'un barage est
 * tenu « maintenant ». Dans le format de données, la faction reste le champ `shift`.
 *
 * Tout barage est posé SUR UNE ROUTE carrossable (voir CLASSES_ROUTE, accrocherARoute,
 * placeurSurRoute) : routes lues dans les tuiles locales, jamais une position arbitraire.
 *
 * Hiérarchie REG → CIE → BT → Barage : un barage ne référence qu'une brigade
 * (`btId`, identifiant « bt-N » de donnees/gendarmerie/circo-bt.geojson). Sa compagnie
 * et sa région sont déduites des circonscriptions importées (voir construireHierarchie),
 * jamais recopiées dans le barage.
 *
 * Jeu de données (`donnees/barages/barages.json`, voir lireJeuBarages) :
 *   { format: 'maroc-carte/barages', version: 1, simulation: boolean, graine?, referentiel?: { importeLe },
 *     barages: [{ id, name, type, latitude, longitude, btId, shift, isSimulation, route? }] }
 *   route (facultatif) : { nom, ref, classe } de la route sur laquelle le barage est posé.
 * Le jeu actuel est SIMULÉ (scripts/generer-barages.mjs). Un jeu validé du même format le
 * remplace sans toucher à la carte. Les modifications faites dans la carte sont une
 * surcouche locale (voir appliquerEditions) : le fichier n'est jamais modifié.
 */
import { EMPRISE_TUILES } from './emprise.js';
import { circonscriptionEn, contient } from './competence.js';
import { emprise as empriseAutour, pointLePlusProche } from './mesure.js';
import { normaliser } from './recherche.js';

export const FORMAT_BARAGES = 'maroc-carte/barages';
export const VERSION_BARAGES = 1;
export const TYPES_BARAGE = Object.freeze(['fixe', 'intouchable']);
/** Les quatre factions de 6 h (valeurs du champ `shift`). */
export const CRENEAUX = Object.freeze(['00-06', '06-12', '12-18', '18-24']);
/** Valeur de `shift` d'un barage intouchable : permanent, sans faction. */
export const CONTINU = 'continu';
/** Filtre de faction des barages sans faction (les intouchables). */
export const NON_AFFECTE = 'non-affecte';
/** `cieId` d'un barage dont la brigade n'a pas de circonscription de compagnie connue. */
export const SANS_COMPAGNIE = 'aucune';
export const LIBELLES_CRENEAUX = Object.freeze({ '00-06': '00:00–06:00', '06-12': '06:00–12:00', '12-18': '12:00–18:00', '18-24': '18:00–00:00' });
/** Numéro de faction (1 à 4, dans l'ordre de la journée) ; null pour un barage sans faction. */
export const numeroFaction = (shift) => (CRENEAUX.includes(shift) ? CRENEAUX.indexOf(shift) + 1 : null);
/** origine : '' (toutes), 'simulation' (isSimulation) ou 'reelle'. */
export const FILTRES_DEFAUT = Object.freeze({ reg: '', cie: '', bt: '', type: 'tous', faction: '', origine: '' });

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * Catégories de voies (kind_detail Protomaps, ou kind à défaut) où un barage peut être posé :
 * voies publiques carrossables. Exclues : voies de service, ruelles, chemins piétons, rail…
 */
export const CLASSES_ROUTE = Object.freeze(new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'track',
  'highway', 'major_road', 'medium_road', 'minor_road',
]));
/** Écart maximal (mètres) entre le clic et la route pour poser ou déplacer un barage. */
export const RAYON_ACCROCHE_M = 150;
/** Écart toléré (mètres) entre un barage et la route la plus proche, à la vérification d'un jeu. */
export const TOLERANCE_ROUTE_M = 5;

const arrondi = (v) => Math.round(v * 1e5) / 1e5;

/**
 * Point de route carrossable le plus proche de `point`, à moins de `rayonMax` mètres.
 * @param {{ points: number[][], nom?, nomFr?, ref?, classe? }[]} lignes  routes en [lon, lat] (ReseauRoutier.lignes)
 * @param {{ rayonMax?: number, dans?: (p: number[]) => boolean }} options  `dans` : le point retenu doit y être (circonscription)
 * @returns {{ point: number[], distance: number, route: { nom, ref, classe } } | null}  point arrondi au 1e-5° (≈ 1 m)
 */
export function accrocherARoute(point, lignes, { rayonMax = RAYON_ACCROCHE_M, dans = () => true } = {}) {
  let meilleur = null;
  for (const l of lignes ?? []) {
    if (!CLASSES_ROUTE.has(l.classe) || (l.points?.length ?? 0) < 2) continue;
    const proche = pointLePlusProche(point, [l.points]);
    if (!proche || proche.distance > rayonMax || (meilleur && proche.distance >= meilleur.distance)) continue;
    const p = [arrondi(proche.point[0]), arrondi(proche.point[1])];
    if (!dans(p)) continue;
    meilleur = { point: p, distance: proche.distance, route: { nom: l.nomFr || l.nom || null, ref: l.ref ?? null, classe: l.classe } };
  }
  return meilleur;
}

/**
 * Placement sur route pour la génération : la route la plus proche d'un point tiré au
 * hasard (rayons croissants, lecture à petite échelle au besoin), puis l'accroche exacte
 * au zoom le plus fin. Rien n'est posé si aucune route n'est lue dans la circonscription.
 * @param {(bbox: number[], zMax: number) => Promise<{ lignes: object[] } | null>} lireRoutes  ex. ReseauRoutier.lignes
 * @returns {(point: number[], geometrieBt: object) => Promise<{ point, distance, route } | null>}
 */
export function placeurSurRoute(lireRoutes, { rayons = [1500, 6000, 25000] } = {}) {
  return async (point, geometrieBt) => {
    const dans = (p) => contient(geometrieBt, p);
    for (const rayon of rayons) {
      const lu = await lireRoutes(empriseAutour(point, point, rayon), 14);
      const proche = accrocherARoute(point, lu?.lignes, { rayonMax: rayon, dans });
      if (!proche) continue;
      const fin = await lireRoutes(empriseAutour(proche.point, proche.point, 250), 15);
      return accrocherARoute(proche.point, fin?.lignes, { rayonMax: 250, dans });
    }
    return null;
  };
}

/**
 * Service de validation d'un emplacement (pose, déplacement) : la route carrossable la plus
 * proche du point proposé, à moins de `rayonMax` mètres (distance géodésique), dans une
 * circonscription de brigade (celle de `btAttendu` pour un déplacement). Rien n'est posé
 * sinon. Le résultat garde la trace de la vérification.
 * @param {number[]} propose  [lon, lat] proposé (clic, import…)
 * @param {object[] | null} lignes  routes lues autour du point (null : lecture impossible)
 * @param {{ proprietes, geometrie, emprise }[]} circosBt  circonscriptions de brigade (Competence.charger)
 * @returns {{ statut: 'valide', origine, point, distance, route, btId }
 *   | { statut: 'refuse', origine, raison: 'routes-illisibles' | 'aucune-route' | 'hors-brigade' | 'autre-brigade' }}
 *   « aucune-route » couvre aussi l'absence de tuiles à cet endroit : on ne peut pas les distinguer.
 */
export function validerEmplacement(propose, lignes, circosBt, { btAttendu = null, rayonMax = RAYON_ACCROCHE_M } = {}) {
  if (!Array.isArray(lignes)) return { statut: 'refuse', origine: propose, raison: 'routes-illisibles' };
  const cible = btAttendu ? circosBt.filter((c) => c.proprietes.id === btAttendu) : circosBt;
  const proche = accrocherARoute(propose, lignes, { rayonMax, dans: (p) => circonscriptionEn(cible, p) !== null });
  if (!proche) {
    const ailleurs = accrocherARoute(propose, lignes, { rayonMax });
    return { statut: 'refuse', origine: propose, raison: !ailleurs ? 'aucune-route' : btAttendu ? 'autre-brigade' : 'hors-brigade' };
  }
  return { statut: 'valide', origine: propose, point: proche.point, distance: proche.distance, route: proche.route, btId: circonscriptionEn(cible, proche.point).id };
}

/** Trace d'une validation, enregistrée avec le barage posé ou déplacé dans la carte. */
export const traceValidation = (v, date = new Date()) => ({
  methode: 'route-tuiles', origine: v.origine, ecartM: Math.round(v.distance * 10) / 10, date: date.toISOString(),
});

/** Le barage est-il sur une route carrossable (à TOLERANCE_ROUTE_M près) ? */
export async function surUneRoute(barage, lireRoutes, tolerance = TOLERANCE_ROUTE_M) {
  const p = [barage.longitude, barage.latitude];
  const lu = await lireRoutes(empriseAutour(p, p, 100), 15);
  return accrocherARoute(p, lu?.lignes, { rayonMax: tolerance }) !== null;
}

// ── Génération (déterministe) ──────────────────────────────────────────────

/** Générateur pseudo-aléatoire mulberry32 : même graine, même suite de nombres dans [0, 1[. */
export function generateur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Emprise [ouest, sud, est, nord] d'une géométrie GeoJSON. */
function emprise(geometrie) {
  const e = [Infinity, Infinity, -Infinity, -Infinity];
  const visiter = (c) => {
    if (typeof c[0] === 'number') {
      e[0] = Math.min(e[0], c[0]); e[1] = Math.min(e[1], c[1]);
      e[2] = Math.max(e[2], c[0]); e[3] = Math.max(e[3], c[1]);
    } else c.forEach(visiter);
  };
  visiter(geometrie.coordinates);
  return e;
}

/** Point [lon, lat] (arrondi au 1e-5°) tiré dans le polygone, ou null après `essais` échecs. */
export function pointAleatoire(geometrie, alea, essais = 1000) {
  const [o, s, e, n] = emprise(geometrie);
  for (let i = 0; i < essais; i++) {
    const p = [arrondi(o + alea() * (e - o)), arrondi(s + alea() * (n - s))];
    if (contient(geometrie, p)) return p;
  }
  return null;
}

const indiceBt = (f) => Number(String(f.properties.id).split('-')[1]);

/**
 * Barages simulés, chacun sur une route d'une circonscription de brigade existante.
 * @param {object[]} circosBt  entités de circo-bt.geojson (géométrie + propriétés `id`)
 * @param {{ graine?: number, nombre?: number, partIntouchables?: number,
 *           placer: (point: number[], geometrieBt: object) => Promise<{ point, route } | null> }} options
 *   `placer` : accroche à une route (placeurSurRoute) ; null = pas de route, le tirage est refait.
 * @returns {Promise<object[]>} enregistrements au format du jeu (voir l'en-tête)
 */
export async function genererBarages(circosBt, { graine = 1, nombre = 1000, partIntouchables = 0.15, placer } = {}) {
  if (typeof placer !== 'function') throw new Error('placement sur route requis (placer)');
  const bts = (circosBt ?? [])
    .filter((f) => f?.geometry && /^bt-\d+$/.test(f.properties?.id ?? ''))
    .sort((a, b) => indiceBt(a) - indiceBt(b));
  if (!bts.length) throw new Error('aucune circonscription de brigade : impossible de rattacher des barages');
  const alea = generateur(graine);
  const barages = [];
  for (let tirages = 0; barages.length < nombre; tirages++) {
    if (tirages > nombre * 20) throw new Error('trop de tirages sans route dans une circonscription (tuiles absentes ?)');
    const bt = bts[Math.floor(alea() * bts.length)];
    const p = pointAleatoire(bt.geometry, alea);
    const surRoute = p && await placer(p, bt.geometry);
    if (!surRoute) continue;
    const intouchable = alea() < partIntouchables;
    const n = String(barages.length + 1).padStart(4, '0');
    barages.push({
      id: `SIM-BAR-${n}`,
      name: `Barage simulé ${n}`,
      type: intouchable ? 'intouchable' : 'fixe',
      latitude: surRoute.point[1],
      longitude: surRoute.point[0],
      btId: bt.properties.id,
      shift: intouchable ? CONTINU : CRENEAUX[Math.floor(alea() * CRENEAUX.length)],
      isSimulation: true,
      route: surRoute.route,
    });
  }
  return barages;
}

/** Jeu de données complet d'une simulation (contenu de donnees/barages/barages.json). */
export function jeuSimulation(barages, { graine, referentiel = null } = {}) {
  return {
    format: FORMAT_BARAGES,
    version: VERSION_BARAGES,
    simulation: true,
    avertissement: 'Données simulées pour les tests de l’interface : positions fictives sur des routes, pas des emplacements opérationnels.',
    graine,
    referentiel,
    barages,
  };
}

// ── Hiérarchie REG → CIE → BT ──────────────────────────────────────────────

/** Index par nom normalisé ; un nom porté par plusieurs entités est ambigu (null), jamais choisi au hasard. */
function parNom(liste) {
  const index = new Map();
  for (const x of liste) {
    const cle = normaliser(x.nom);
    index.set(cle, index.has(cle) ? null : x);
  }
  return index;
}

/**
 * Rattachements des brigades, d'après les propriétés des circonscriptions importées
 * (circo-reg / circo-cie / circo-bt) : la BT nomme sa compagnie (`cie`) et sa région (`reg`),
 * la compagnie nomme sa région. La région suit la chaîne BT → CIE → REG ; à défaut de
 * compagnie connue, le nom de région de la BT. Aucun rattachement par position.
 * @param {{ reg: object[], cie: object[], bt: object[] }} circos  propriétés ({ id, nom, cie?, reg? })
 * @returns {{ regions: Map, compagnies: Map, brigades: Map,
 *   anomalies: { compagnieInconnue: string[], regionInconnue: string[], incoherences: string[] } }}
 *   brigades : id → { id, nom, cieId | null, cieSource, regId | null, regPar: 'compagnie' | 'brigade' | null }
 */
export function construireHierarchie({ reg = [], cie = [], bt = [] } = {}) {
  const regParNom = parNom(reg);
  const cieParNom = parNom(cie);
  const regions = new Map(reg.map((r) => [r.id, { id: r.id, nom: r.nom }]));
  const compagnies = new Map(cie.map((c) => [c.id, { id: c.id, nom: c.nom, regId: regParNom.get(normaliser(c.reg))?.id ?? null }]));
  const brigades = new Map();
  const anomalies = { compagnieInconnue: [], regionInconnue: [], incoherences: [] };
  for (const b of bt) {
    const c = cieParNom.get(normaliser(b.cie)) ?? null;
    const regDirecte = regParNom.get(normaliser(b.reg))?.id ?? null;
    const regDeCie = c ? compagnies.get(c.id).regId : null;
    if (!c) anomalies.compagnieInconnue.push(b.id);
    if (regDeCie && regDirecte && regDeCie !== regDirecte) anomalies.incoherences.push(b.id);
    const regId = regDeCie ?? regDirecte;
    if (!regId) anomalies.regionInconnue.push(b.id);
    brigades.set(b.id, {
      id: b.id, nom: b.nom, cieId: c?.id ?? null, cieSource: b.cie ?? null, regId,
      regPar: regDeCie ? 'compagnie' : regDirecte ? 'brigade' : null,
    });
  }
  return { regions, compagnies, brigades, anomalies };
}

// ── Validation et chargement ───────────────────────────────────────────────

const [[OUEST, SUD], [EST, NORD]] = EMPRISE_TUILES;

/** Erreurs d'un enregistrement (liste vide s'il est valide). `hierarchie` : vérifie que la brigade existe. */
export function validerBarage(b, hierarchie = null) {
  if (!b || typeof b !== 'object') return ['enregistrement invalide'];
  const erreurs = [];
  if (typeof b.id !== 'string' || !b.id.trim()) erreurs.push('identifiant manquant');
  if (b.name != null && typeof b.name !== 'string') erreurs.push('nom invalide');
  if (!TYPES_BARAGE.includes(b.type)) erreurs.push(`type inconnu : ${b.type}`);
  else if (b.type === 'fixe' && !CRENEAUX.includes(b.shift)) erreurs.push(`barage fixe sans faction valide : ${b.shift}`);
  else if (b.type === 'intouchable' && b.shift !== CONTINU) erreurs.push(`barage intouchable affecté à une faction : ${b.shift}`);
  const { latitude: lat, longitude: lon } = b;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lon < OUEST || lon > EST || lat < SUD || lat > NORD) {
    erreurs.push('coordonnées absentes ou hors du Royaume');
  }
  if (typeof b.btId !== 'string' || !b.btId) erreurs.push('brigade (btId) manquante');
  else if (hierarchie && !hierarchie.brigades.has(b.btId)) erreurs.push(`brigade inconnue : ${b.btId}`);
  if (typeof b.isSimulation !== 'boolean') erreurs.push('marqueur isSimulation manquant');
  if (b.route != null && (typeof b.route !== 'object' || Array.isArray(b.route))) erreurs.push('route invalide');
  if (b.validation != null && (typeof b.validation !== 'object' || Array.isArray(b.validation))) erreurs.push('trace de validation invalide');
  return erreurs;
}

/**
 * Enregistrements valides d'une liste ; les autres (et les doublons d'identifiant) sont listés à part.
 * @returns {{ barages: object[], rejetes: { id: string|null, erreurs: string[] }[] }}
 */
export function trierBarages(liste, hierarchie = null) {
  const barages = [];
  const rejetes = [];
  const vus = new Set();
  for (const b of liste) {
    const erreurs = validerBarage(b, hierarchie);
    if (!erreurs.length && vus.has(b.id)) erreurs.push(`identifiant en double : ${b.id}`);
    if (erreurs.length) {
      rejetes.push({ id: typeof b?.id === 'string' ? b.id : null, erreurs });
      continue;
    }
    vus.add(b.id);
    barages.push(b);
  }
  return { barages, rejetes };
}

/**
 * Lit un jeu de barages : seuls les enregistrements valides sont gardés, les autres
 * sont listés (`rejetes`). Lève une erreur si le fichier n'est pas un jeu de barages.
 * @returns {{ simulation: boolean, barages: object[], rejetes: { id: string|null, erreurs: string[] }[], referentiel: object|null, graine }}
 *   simulation : le jeu ou l'un de ses enregistrements se déclare simulé
 */
export function lireJeuBarages(donnees, hierarchie = null) {
  if (donnees?.format !== FORMAT_BARAGES || donnees.version !== VERSION_BARAGES || !Array.isArray(donnees.barages)) {
    throw new Error('jeu de barages : format ou version inconnus');
  }
  const { barages, rejetes } = trierBarages(donnees.barages, hierarchie);
  return {
    simulation: donnees.simulation === true || barages.some((b) => b.isSimulation),
    barages,
    rejetes,
    referentiel: donnees.referentiel ?? null,
    graine: donnees.graine ?? null,
  };
}

/** Jeu exporté depuis la carte (même format) : simulé dès qu'un enregistrement l'est. */
export function jeuExporte(barages, { referentiel = null } = {}) {
  const simulation = barages.some((b) => b.isSimulation);
  return {
    format: FORMAT_BARAGES,
    version: VERSION_BARAGES,
    simulation,
    ...(simulation ? { avertissement: 'Contient des données simulées (isSimulation) : pas des emplacements opérationnels.' } : {}),
    source: 'export de la carte (jeu installé + modifications locales)',
    referentiel,
    barages,
  };
}

// ── Modifications locales (surcouche du jeu installé) ──────────────────────

/**
 * Surcouche vide : barages ajoutés, champs modifiés par identifiant, identifiants retirés, et
 * `retraits` — l'historique des barages retirés (copie complète, date), qui garde leur ancien
 * emplacement sur la carte et permet de les restaurer. Le tout est écrit en une seule fois.
 */
export const editionsVides = () => ({ ajouts: [], modifs: {}, suppressions: [], retraits: [] });

const estRetrait = (r) => r && typeof r === 'object' && typeof r.id === 'string' && typeof r.barageId === 'string'
  && r.barage && typeof r.barage === 'object' && r.barage.id === r.barageId && ['fichier', 'local'].includes(r.source) && typeof r.retireLe === 'string';

/** Surcouche relue du stockage : toute forme inattendue est ignorée, jamais une erreur. */
export function lireEditions(brut) {
  const e = editionsVides();
  if (!brut || typeof brut !== 'object') return e;
  if (Array.isArray(brut.ajouts)) e.ajouts = brut.ajouts.filter((b) => b && typeof b === 'object' && typeof b.id === 'string');
  if (brut.modifs && typeof brut.modifs === 'object' && !Array.isArray(brut.modifs)) {
    for (const [id, champs] of Object.entries(brut.modifs)) if (champs && typeof champs === 'object') e.modifs[id] = champs;
  }
  if (Array.isArray(brut.suppressions)) e.suppressions = [...new Set(brut.suppressions.filter((id) => typeof id === 'string'))];
  if (Array.isArray(brut.retraits)) e.retraits = brut.retraits.filter(estRetrait);
  return e;
}

// ── Barages protégés (« Barage fixe intouchable ») ─────────────────────────

/** Un barage intouchable n'est jamais déplacé, supprimé ni modifié par l'optimisation. */
export const estProtege = (b) => b?.type === 'intouchable';
export const MESSAGE_PROTEGE = 'Barage fixe — intouchable : il ne peut être ni déplacé, ni supprimé, ni modifié par l’optimisation.';

const empreinteBarage = (b) => JSON.stringify(Object.keys(b).sort().reduce((o, k) => ({ ...o, [k]: b[k] }), {}));

/**
 * Barages protégés atteints par une écriture : présents (actifs) avant, absents ou différents
 * après. Sert de garde au niveau de la persistance (CoucheBarages.remplacerEditions).
 * @returns {string[]}  identifiants atteints
 */
export function atteintesProtegees(base, avant, apres) {
  const actifs = (e) => new Map(appliquerEditions(base, e).barages.filter((b) => b && typeof b === 'object').map((b) => [b.id, b]));
  const [a, b] = [actifs(avant), actifs(apres)];
  return [...a.values()].filter((x) => estProtege(x) && (!b.has(x.id) || empreinteBarage(b.get(x.id)) !== empreinteBarage(x))).map((x) => x.id);
}

// ── Barages retirés : historique, marqueurs, restauration ──────────────────

/**
 * Retire un barage du jeu actif en gardant son historique : identifiant ajouté aux
 * `suppressions` (barage du fichier ; ses modifications locales sont gardées pour une
 * restauration fidèle) ou ajout local retiré, et copie complète dans `retraits`.
 * @param {object} barage  enregistrement actif (valeurs affichées au moment du retrait)
 * @returns {{ editions: object, retrait: object } | { erreur: string }}
 */
export function retirerBarage(editions, barage, source, { date = new Date(), motif = null } = {}) {
  if (!barage || typeof barage.id !== 'string') return { erreur: 'barage inconnu' };
  if (estProtege(barage)) return { erreur: MESSAGE_PROTEGE };
  if ((editions.retraits ?? []).some((r) => r.barageId === barage.id && !r.restaureLe)) return { erreur: `${barage.id} est déjà retiré.` };
  const copie = structuredClone({ ajouts: editions.ajouts, modifs: editions.modifs, suppressions: editions.suppressions, retraits: editions.retraits ?? [] });
  if (source === 'local') {
    if (!copie.ajouts.some((a) => a.id === barage.id)) return { erreur: `${barage.id} n’est pas un ajout local.` };
    copie.ajouts = copie.ajouts.filter((a) => a.id !== barage.id);
  } else if (copie.suppressions.includes(barage.id)) {
    return { erreur: `${barage.id} est déjà absent du jeu actif.` };
  } else {
    copie.suppressions.push(barage.id);
  }
  const retrait = {
    id: `RET-${date.getTime().toString(36).toUpperCase()}-${barage.id}`,
    barageId: barage.id, source, barage: structuredClone(barage), retireLe: date.toISOString(), motif, restaureLe: null,
  };
  copie.retraits.push(retrait);
  return { editions: copie, retrait };
}

/**
 * Restaure un barage retiré : son enregistrement revient tel qu'il était (même identifiant,
 * faction, brigade, métadonnées). Refusé si un barage actif porte déjà cet identifiant (pas de
 * double restauration) ou si l'entrée est déjà restaurée.
 * @param {Set<string>} idsActifs  identifiants du jeu actif
 * @returns {{ editions: object, barage: object } | { erreur: string }}
 */
export function restaurerBarage(editions, retraitId, idsActifs, { date = new Date() } = {}) {
  const r = (editions.retraits ?? []).find((x) => x.id === retraitId);
  if (!r) return { erreur: 'retrait introuvable dans l’historique' };
  if (r.restaureLe) return { erreur: `${r.barageId} a déjà été restauré le ${r.restaureLe.slice(0, 10)}.` };
  if (idsActifs.has(r.barageId)) return { erreur: `${r.barageId} est déjà actif : restauration refusée (pas de doublon).` };
  const copie = structuredClone({ ajouts: editions.ajouts, modifs: editions.modifs, suppressions: editions.suppressions, retraits: editions.retraits });
  if (r.source === 'local') {
    if (copie.ajouts.some((a) => a.id === r.barageId)) return { erreur: `${r.barageId} existe déjà dans les ajouts locaux.` };
    copie.ajouts.push(structuredClone(r.barage));
  } else {
    if (!copie.suppressions.includes(r.barageId)) return { erreur: `${r.barageId} n’est plus retiré du jeu installé.` };
    copie.suppressions = copie.suppressions.filter((id) => id !== r.barageId);
  }
  copie.retraits = copie.retraits.map((x) => (x.id === retraitId ? { ...x, restaureLe: date.toISOString() } : x));
  return { editions: copie, barage: structuredClone(r.barage) };
}

/**
 * Retraits à montrer sur la carte : non restaurés, et dont l'identifiant n'est pas de nouveau
 * actif (une remise en service par un autre chemin n'affiche pas d'ancien emplacement).
 */
export function retraitsAffiches(editions, idsActifs) {
  const vus = new Set();
  return [...(editions.retraits ?? [])].reverse().filter((r) => {
    if (r.restaureLe || idsActifs.has(r.barageId) || vus.has(r.barageId)) return false;
    vus.add(r.barageId);
    return Number.isFinite(r.barage.latitude) && Number.isFinite(r.barage.longitude);
  });
}

/** Entités GeoJSON des anciens emplacements (couche à part : jamais comptées comme barages actifs). */
export function entitesRetires(retraits, hierarchie) {
  return retraits.map((r) => {
    const b = r.barage;
    const bt = hierarchie?.brigades.get(b.btId);
    return {
      type: 'Feature',
      properties: {
        retire: true, retraitId: r.id, id: b.id, name: b.name ?? b.id, type: b.type, shift: b.shift, btId: b.btId ?? '',
        cieId: bt?.cieId ?? '', regId: bt?.regId ?? '', isSimulation: b.isSimulation === true, retireLe: r.retireLe,
      },
      geometry: { type: 'Point', coordinates: [b.longitude, b.latitude] },
    };
  });
}

/** Filtre des anciens emplacements : filtres géographiques et d'origine du panneau (pas type ni faction actifs). */
export function expressionFiltreRetires(f) {
  const conditions = [];
  if (f.reg) conditions.push(['==', ['get', 'regId'], f.reg]);
  if (f.cie) conditions.push(['==', ['get', 'cieId'], f.cie]);
  if (f.bt) conditions.push(['==', ['get', 'btId'], f.bt]);
  if (f.origine === 'simule') conditions.push(['==', ['get', 'isSimulation'], true]);
  if (f.origine === 'reel') conditions.push(['==', ['get', 'isSimulation'], false]);
  return conditions.length ? ['all', ...conditions] : null;
}

/** Nombre de changements de la surcouche. */
export const nombreEditions = (e) => e.ajouts.length + Object.keys(e.modifs).length + e.suppressions.length;

/**
 * Jeu affiché = jeu installé + surcouche. Le jeu installé n'est pas modifié. Un ajout dont
 * l'identifiant est déjà dans le jeu (surcouche exportée puis installée) n'est pas doublé ;
 * une modification ou suppression visant un barage absent du jeu est signalée (`orphelines`).
 * @returns {{ barages: object[], orphelines: string[], dejaInstalles: string[] }}
 */
export function appliquerEditions(base, editions) {
  // `base` peut venir brut du fichier : une entrée qui n'est pas un objet reste telle quelle (la validation la refusera).
  const estObjet = (b) => b !== null && typeof b === 'object';
  const ids = new Set(base.filter(estObjet).map((b) => b.id));
  const suppr = new Set(editions.suppressions);
  const barages = base.filter((b) => !estObjet(b) || !suppr.has(b.id))
    .map((b) => (estObjet(b) && Object.hasOwn(editions.modifs, b.id) ? { ...b, ...editions.modifs[b.id], id: b.id } : b));
  const dejaInstalles = [];
  for (const a of editions.ajouts) {
    if (ids.has(a.id)) dejaInstalles.push(a.id);
    else barages.push(a);
  }
  const orphelines = [...Object.keys(editions.modifs), ...editions.suppressions].filter((id) => !ids.has(id));
  return { barages, orphelines: [...new Set(orphelines)], dejaInstalles };
}

/**
 * Garde-fou simulé / réel : un barage du jeu installé garde son origine (simulé ou réel) ;
 * seul un barage ajouté dans ce navigateur peut en changer. Un champ inconnu est refusé.
 * @returns {string | null}  motif du refus, ou null
 */
export function refusModification(champs, { ajoutLocal = false } = {}) {
  const modifiables = new Set(['name', 'type', 'shift', 'latitude', 'longitude', 'route', 'validation', ...(ajoutLocal ? ['isSimulation'] : [])]);
  const interdits = Object.keys(champs).filter((k) => !modifiables.has(k));
  if (!interdits.length) return null;
  return interdits.includes('isSimulation') ? 'origine-verrouillee' : `champ non modifiable : ${interdits.join(', ')}`;
}

/** Retirer les barages simulés (surcouche) : ajouts simulés effacés, simulés du jeu installé masqués ; les réels intacts. */
export function retirerSimules(base, editions) {
  const suppressions = new Set(editions.suppressions);
  for (const b of base) if (b.isSimulation === true) suppressions.add(b.id);
  return {
    ajouts: editions.ajouts.filter((a) => a.isSimulation !== true),
    modifs: Object.fromEntries(Object.entries(editions.modifs).filter(([id]) => !suppressions.has(id))),
    suppressions: [...suppressions],
    retraits: editions.retraits ?? [], // l'historique des retraits n'est pas touché
  };
}

/**
 * Faction de l'heure : 00:00–05:59 → 1, 06:00–11:59 → 2, 12:00–17:59 → 3, 18:00–23:59 → 4.
 * Les bornes appartiennent à la faction qui commence (06:00 → faction 2) ; minuit ouvre la
 * faction 1 du jour suivant. Heure locale de l'appareil (fuseau de son système).
 */
export const factionDeLHeure = (date = new Date()) => CRENEAUX[Math.floor(date.getHours() / 6)];

/**
 * Changement de type : un intouchable n'a pas de faction (CONTINU), un fixe en reçoit une.
 * @returns {{ type, shift }}
 */
export function typeEtFaction(type, faction = CRENEAUX[0]) {
  return type === 'intouchable' ? { type, shift: CONTINU } : { type: 'fixe', shift: CRENEAUX.includes(faction) ? faction : CRENEAUX[0] };
}

/**
 * Entités GeoJSON de la carte : un point par barage, avec la compagnie et la région
 * résolues (`cieId` = SANS_COMPAGNIE si inconnue, `regId` = '' si inconnue).
 */
export function entitesBarages(barages, hierarchie) {
  return barages.map((b) => {
    const bt = hierarchie.brigades.get(b.btId);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.longitude, b.latitude] },
      properties: {
        id: b.id, name: b.name || b.id, type: b.type, shift: b.shift, btId: b.btId,
        cieId: bt?.cieId ?? SANS_COMPAGNIE, regId: bt?.regId ?? '', isSimulation: b.isSimulation,
        routeNom: b.route?.nom ?? '', routeRef: b.route?.ref ?? '', routeClasse: b.route?.classe ?? '',
      },
    };
  });
}

// ── Filtres ────────────────────────────────────────────────────────────────

/**
 * Le barage (propriétés d'entité) passe-t-il les filtres ?
 * Faction : une faction garde ses barages fixes ET tous les intouchables, actifs 24 h/24
 * donc pendant chaque faction ; NON_AFFECTE ne garde que les intouchables. Pour masquer
 * les intouchables, c'est le filtre de type (« Fixes »).
 */
export function correspond(p, f = FILTRES_DEFAUT) {
  return (!f.reg || p.regId === f.reg)
    && (!f.cie || p.cieId === f.cie)
    && (!f.bt || p.btId === f.bt)
    && (!f.type || f.type === 'tous' || p.type === f.type)
    && (!f.faction || (f.faction === NON_AFFECTE ? !CRENEAUX.includes(p.shift) : p.shift === f.faction || p.type === 'intouchable'))
    && (!f.origine || (f.origine === 'simulation') === (p.isSimulation === true));
}

/** Le même filtre en expression MapLibre (null : aucun filtre). */
export function expressionFiltre(f = FILTRES_DEFAUT) {
  const c = [];
  if (f.reg) c.push(['==', ['get', 'regId'], f.reg]);
  if (f.cie) c.push(['==', ['get', 'cieId'], f.cie]);
  if (f.bt) c.push(['==', ['get', 'btId'], f.bt]);
  if (f.type && f.type !== 'tous') c.push(['==', ['get', 'type'], f.type]);
  if (f.faction === NON_AFFECTE) c.push(['!', ['in', ['get', 'shift'], ['literal', [...CRENEAUX]]]]);
  else if (f.faction) c.push(['any', ['==', ['get', 'shift'], f.faction], ['==', ['get', 'type'], 'intouchable']]);
  if (f.origine) c.push(['==', ['get', 'isSimulation'], f.origine === 'simulation']);
  return c.length ? ['all', ...c] : null;
}

const compter = (liste, cle) => {
  const n = new Map();
  for (const p of liste) n.set(p[cle], (n.get(p[cle]) ?? 0) + 1);
  return n;
};
const parNomFr = (a, b) => String(a.nom ?? '').localeCompare(String(b.nom ?? ''), 'fr');

/**
 * Choix proposés par les listes : REG / CIE / BT qui ont des barages (la CIE limitée à la
 * région choisie, la BT à la région et à la compagnie) et factions, avec leur nombre.
 * La compagnie SANS_COMPAGNIE (nom null) regroupe les brigades sans compagnie connue.
 * Les factions sont les quatre créneaux, toujours proposés, puis NON_AFFECTE.
 * @param {object[]} proprietes  propriétés des entités (entitesBarages)
 */
export function optionsFiltres(proprietes, hierarchie, f = FILTRES_DEFAUT) {
  const dansReg = proprietes.filter((p) => !f.reg || p.regId === f.reg);
  const dansCie = dansReg.filter((p) => !f.cie || p.cieId === f.cie);
  const regions = [...compter(proprietes, 'regId')].filter(([id]) => id)
    .map(([id, n]) => ({ id, nom: hierarchie.regions.get(id)?.nom ?? id, n })).sort(parNomFr);
  const compagnies = [...compter(dansReg, 'cieId')]
    .map(([id, n]) => ({ id, nom: id === SANS_COMPAGNIE ? null : hierarchie.compagnies.get(id)?.nom ?? id, n }))
    .sort((a, b) => (a.nom === null) - (b.nom === null) || parNomFr(a, b));
  const brigades = [...compter(dansCie, 'btId')]
    .map(([id, n]) => ({ id, nom: hierarchie.brigades.get(id)?.nom ?? id, n })).sort(parNomFr);
  // Nombre par faction avec les autres filtres (hors faction) : ce que chaque choix afficherait.
  const autres = proprietes.filter((p) => correspond(p, { ...f, faction: '' }));
  const factions = [...CRENEAUX, NON_AFFECTE].map((id) => ({ id, n: autres.filter((p) => correspond(p, { ...FILTRES_DEFAUT, faction: id })).length }));
  return { regions, compagnies, brigades, factions };
}

/**
 * Filtres cohérents : valeurs inconnues remplacées par « tous », puis une compagnie hors
 * de la région choisie, ou une brigade hors de la région / compagnie, est effacée.
 */
export function normaliserFiltres(proprietes, hierarchie, f = FILTRES_DEFAUT) {
  const r = {
    reg: typeof f.reg === 'string' ? f.reg : '',
    cie: typeof f.cie === 'string' ? f.cie : '',
    bt: typeof f.bt === 'string' ? f.bt : '',
    type: TYPES_BARAGE.includes(f.type) ? f.type : 'tous',
    faction: [...CRENEAUX, NON_AFFECTE].includes(f.faction) ? f.faction : '',
    origine: ['simulation', 'reelle'].includes(f.origine) ? f.origine : '',
  };
  if (r.reg && !optionsFiltres(proprietes, hierarchie, { ...r, cie: '', bt: '' }).regions.some((o) => o.id === r.reg)) r.reg = '';
  if (r.cie && !optionsFiltres(proprietes, hierarchie, { ...r, bt: '' }).compagnies.some((o) => o.id === r.cie)) r.cie = '';
  if (r.bt && !optionsFiltres(proprietes, hierarchie, r).brigades.some((o) => o.id === r.bt)) r.bt = '';
  return r;
}

// ── Agrégation hiérarchique (niveau de détail) ─────────────────────────────

/** Seuils de zoom : régions en dessous de 7, compagnies de 7 à 9, barages un par un dès 9. */
export const ZOOM_CIE = 7;
export const ZOOM_DETAIL = 9;
/** Badges secondaires (« SIM », noms) seulement à partir de ce zoom. */
export const ZOOM_BADGES = 11;
export const niveauAuZoom = (zoom) => (zoom < ZOOM_CIE ? 'reg' : zoom < ZOOM_DETAIL ? 'cie' : 'detail');

/**
 * Groupes de barages par échelon administratif, pour les petites échelles : un point par
 * région et par compagnie, au barycentre de ses barages, avec leur nombre. Calculé sur les
 * barages qui passent les filtres (mêmes nombres que le panneau).
 *
 * Un groupe ne réunit jamais deux parents différents ni simulé et réel : la clé est
 * l'échelon + son identifiant + l'origine. Une compagnie sans circonscription est groupée
 * sous le nom que portent ses brigades, dans sa région (jamais avec une autre compagnie).
 * @param {object[]} entites  entités de entitesBarages
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 *   propriétés : id stable (« cie:reg-3/cie-12:sim »), niveau, nom, n, fixes, intouchables,
 *   simulation, emprise ouest / sud / est / nord des barages du groupe
 */
export function agregerBarages(entites, hierarchie, f = FILTRES_DEFAUT) {
  const groupes = new Map();
  const ajouter = (id, niveau, nom, simulation, [lon, lat], type) => {
    let g = groupes.get(id);
    if (!g) {
      g = { id, niveau, nom, simulation, n: 0, fixes: 0, intouchables: 0, sx: 0, sy: 0, ouest: lon, sud: lat, est: lon, nord: lat };
      groupes.set(id, g);
    }
    g.n += 1;
    g[type === 'intouchable' ? 'intouchables' : 'fixes'] += 1;
    g.sx += lon;
    g.sy += lat;
    g.ouest = Math.min(g.ouest, lon); g.est = Math.max(g.est, lon);
    g.sud = Math.min(g.sud, lat); g.nord = Math.max(g.nord, lat);
  };
  for (const e of entites) {
    const p = e.properties;
    if (!correspond(p, f)) continue;
    const origine = p.isSimulation === true ? 'sim' : 'reel';
    const reg = p.regId || 'sans-region';
    const nomReg = hierarchie.regions.get(p.regId)?.nom ?? null;
    let cie = p.cieId;
    let nomCie = hierarchie.compagnies.get(p.cieId)?.nom ?? null;
    if (p.cieId === SANS_COMPAGNIE) {
      const source = hierarchie.brigades.get(p.btId)?.cieSource ?? '';
      cie = `${SANS_COMPAGNIE}:${normaliser(source) || p.btId}`;
      nomCie = source ? `${source} *` : null;
    }
    ajouter(`reg:${reg}:${origine}`, 'reg', nomReg, origine === 'sim', e.geometry.coordinates, p.type);
    ajouter(`cie:${reg}/${cie}:${origine}`, 'cie', nomCie, origine === 'sim', e.geometry.coordinates, p.type);
  }
  return {
    type: 'FeatureCollection',
    features: [...groupes.values()].map(({ sx, sy, ...g }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [sx / g.n, sy / g.n] },
      properties: g,
    })),
  };
}


// ── Couches MapLibre ───────────────────────────────────────────────────────

export const SOURCE_BARAGES = 'barages';
/** Source des groupes (agregerBarages), recalculée quand les filtres ou les données changent. */
export const SOURCE_AGREGATS = 'barages-agregats';
/** Couches des barages un par un (dès ZOOM_DETAIL) : le filtre de l'utilisateur s'y applique. */
export const COUCHES_BARAGES = Object.freeze(['barages-symbole', 'barages-badge', 'barages-nom']);
/** Couches des groupes : régions puis compagnies, chacune sur sa plage de zoom. */
export const COUCHES_AGREGATS = Object.freeze(['barages-agregats-reg', 'barages-agregats-reg-n', 'barages-agregats-cie', 'barages-agregats-cie-n']);
/** Anneau autour du barage en cours de modification (filtre par identifiant). */
export const COUCHE_EDITION = 'barages-edition';
/** Couleurs des deux types (contraste ≥ 4,5:1 avec le blanc des icônes) ; texte éclairci en thème sombre. */
export const COULEURS_BARAGES = Object.freeze({
  light: { fixe: '#c2410c', intouchable: '#9f1239', halo: '#ffffff', edition: '#c6a050', reel: '#0b2445', simule: '#c2410c', fondSimule: '#ffffff' },
  dark: { fixe: '#fb923c', intouchable: '#fb7185', halo: '#0b1220', edition: '#e3c98a', reel: '#e3c98a', simule: '#fb923c', fondSimule: '#172234' },
});
/** Icône d'un type, et sa variante « simulée » (anneau pointillé) : images générées par couche-barages.js. */
export const iconeDe = (type, simulation = false) => `barage-${type}${simulation ? '-sim' : ''}`;
/** Paliers de taille des icônes (discrets) : 0,75 × 24 px = 18 px au moins, la cible tactile minimale. */
export const TAILLES_ICONE = Object.freeze([[ZOOM_DETAIL, 0.75], [11, 0.9], [13, 1], [15, 1.15]]);

const estSimule = ['==', ['get', 'isSimulation'], true];

/** Filtre d'une couche de détail : celui de l'utilisateur, et « simulés seulement » pour le badge SIM. */
export function filtrePour(id, filtre) {
  const propre = id === 'barages-badge' ? estSimule : null;
  if (propre && filtre) return ['all', propre, filtre];
  return propre ?? filtre ?? null;
}

/**
 * Couches des barages, du moins au plus détaillé :
 *   - zoom < 7 : un disque par région, avec le nombre de barages ; 7 à 9 : un par compagnie
 *     (disque plein = réels, disque clair cerclé = simulés : jamais mélangés) ;
 *   - zoom ≥ 9 : chaque barage (forme par type, anneau pointillé si simulé, paliers de taille) ;
 *   - zoom ≥ 11 : badge « SIM » ; zoom ≥ 12 : nom.
 * Les plages de zoom ne se recouvrent pas : aucun barage n'est montré deux fois.
 * Visibilité et filtres changent sans recréer les couches.
 */
export function couchesBarages({ theme = 'light', visible = false, filtre = null, edition = '' } = {}) {
  const c = COULEURS_BARAGES[theme] ?? COULEURS_BARAGES.light;
  const visibility = visible ? 'visible' : 'none';
  const avecFiltre = (couche) => {
    const f = filtrePour(couche.id, filtre);
    return f ? { ...couche, filter: f } : couche;
  };
  const groupe = (niveau, minzoom, maxzoom) => [
    {
      id: `barages-agregats-${niveau}`,
      type: 'circle',
      source: SOURCE_AGREGATS,
      ...(minzoom ? { minzoom } : {}),
      maxzoom,
      filter: ['==', ['get', 'niveau'], niveau],
      layout: { visibility },
      paint: {
        // Rayon par paliers du nombre de barages : 22 px de diamètre au moins (cible tactile).
        'circle-radius': ['step', ['get', 'n'], 11, 10, 14, 50, 18, 200, 23],
        'circle-color': ['case', ['get', 'simulation'], c.fondSimule, c.reel],
        'circle-stroke-color': ['case', ['get', 'simulation'], c.simule, c.halo],
        'circle-stroke-width': ['case', ['get', 'simulation'], 2.5, 1.5],
        'circle-opacity': 0.92,
      },
    },
    {
      id: `barages-agregats-${niveau}-n`,
      type: 'symbol',
      source: SOURCE_AGREGATS,
      ...(minzoom ? { minzoom } : {}),
      maxzoom,
      filter: ['==', ['get', 'niveau'], niveau],
      layout: {
        visibility,
        'text-field': ['to-string', ['get', 'n']],
        'text-font': ['Noto Sans Medium'],
        'text-size': 11.5,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': ['case', ['get', 'simulation'], c.simule, theme === 'dark' ? '#0b2445' : '#ffffff'] },
    },
  ];
  return [
    ...groupe('reg', 0, ZOOM_CIE),
    ...groupe('cie', ZOOM_CIE, ZOOM_DETAIL),
    {
      id: COUCHE_EDITION,
      type: 'circle',
      source: SOURCE_BARAGES,
      minzoom: ZOOM_DETAIL,
      filter: ['==', ['get', 'id'], edition],
      layout: { visibility },
      paint: { 'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': c.edition, 'circle-stroke-width': 3 },
    },
    avecFiltre({
      id: 'barages-symbole',
      type: 'symbol',
      source: SOURCE_BARAGES,
      minzoom: ZOOM_DETAIL,
      layout: {
        visibility,
        'icon-image': ['concat', 'barage-', ['get', 'type'], ['case', estSimule, '-sim', '']],
        'icon-size': ['step', ['zoom'], TAILLES_ICONE[0][1], ...TAILLES_ICONE.slice(1).flat()],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Les intouchables au-dessus des fixes quand ils se chevauchent.
        'symbol-sort-key': ['match', ['get', 'type'], 'intouchable', 1, 0],
      },
    }),
    avecFiltre({
      id: 'barages-badge',
      type: 'symbol',
      source: SOURCE_BARAGES,
      minzoom: ZOOM_BADGES,
      layout: {
        visibility,
        'text-field': 'SIM',
        'text-font': ['Noto Sans Medium'],
        'text-size': 9,
        'text-anchor': 'bottom-left',
        'text-offset': [0.6, -0.6],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': c.simule, 'text-halo-color': c.halo, 'text-halo-width': 1.6 },
    }),
    avecFiltre({
      id: 'barages-nom',
      type: 'symbol',
      source: SOURCE_BARAGES,
      minzoom: 12,
      layout: {
        visibility,
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10.5,
        'text-anchor': 'top',
        'text-offset': [0, 1],
        'text-optional': true,
        'text-max-width': 10,
      },
      paint: {
        'text-color': ['match', ['get', 'type'], 'intouchable', c.intouchable, c.fixe],
        'text-halo-color': c.halo,
        'text-halo-width': 1.4,
      },
    }),
  ];
}
