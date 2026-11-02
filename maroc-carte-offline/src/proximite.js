/**
 * Optimisation des barrages : barages d'une MÊME FACTION proches PAR LA ROUTE, et aide au
 * changement d'emplacement. Fonctions pures (sans DOM) ; les itinéraires viennent du moteur
 * routier du projet (itineraire.js, via ReseauRoutierDistant), passé en paramètre.
 *
 * Règle d'alerte (les deux conditions, sans exception) :
 *   1. même faction (même créneau `shift` ; les intouchables « continu » forment leur propre
 *      groupe) — et même origine, simulés et réels n'étant jamais rapprochés ;
 *   2. distance PAR LA ROUTE (plus court itinéraire du moteur) ≤ distance maximale choisie.
 * Itinéraire introuvable ou en erreur → « Distance routière indisponible », jamais d'alerte.
 *
 * Filtre préalable (performance seulement) : une paire n'est envoyée au moteur que si elle
 * POURRAIT être sous le seuil. La ligne droite sert uniquement de borne inférieure de la
 * route (toute route entre deux points est au moins aussi longue que la ligne droite, aux
 * accroches près : marge MARGE_FILTRE_M). Elle n'apparaît jamais dans une décision d'alerte.
 */
import { CONTINU, CRENEAUX, LIBELLES_CRENEAUX, estProtege, numeroFaction } from './barages.js';
import { distanceMetres } from './mesure.js';
import { dansPerimetre, origineDe } from './optimisation.js';

/** Factions du sélecteur : les quatre créneaux, et les intouchables seuls. */
export const FACTIONS = Object.freeze([...CRENEAUX, CONTINU]);
export const libelleFaction = (f) => (f === CONTINU ? 'Barages intouchables (24 h/24)' : `Faction ${numeroFaction(f)} · ${LIBELLES_CRENEAUX[f]}`);
/** Types de barage du modèle : « fixe » (une faction, déplaçable), « intouchable » (24 h/24, protégé). */
export const TYPES = Object.freeze(['fixe', 'intouchable']);
export const LIBELLES_TYPE = Object.freeze({ fixe: 'Barage fixe (déplaçable)', intouchable: 'Barage fixe intouchable (protégé)' });
/** Marge du filtre préalable : deux accroches à la route (≤ 150 m chacune, édition) + sécurité. */
export const MARGE_FILTRE_M = 500;
export const REGLES_PROXIMITE = Object.freeze({
  distanceMaxKm: 10,
  faction: 'toutes', // 'toutes' (chaque faction séparément) ou une valeur de FACTIONS
  types: TYPES,
  origine: 'simulation', // simulation | reelle | toutes (toujours séparées)
  perimetre: { reg: '', cie: '', bt: '' },
  inclureAjoutsLocaux: true,
  maxCandidats: 5000,
});
export const LIMITES = Object.freeze({ distanceMinKm: 0.01, distanceMaxKm: 100 });

/** Paramètres relus : toute valeur hors bornes est refusée et signalée (jamais corrigée en silence). */
export function validerReglesProximite(brut = {}) {
  const src = brut && typeof brut === 'object' ? brut : {};
  const r = { ...REGLES_PROXIMITE, ...src, perimetre: { ...REGLES_PROXIMITE.perimetre, ...(src.perimetre ?? {}) } };
  const erreurs = [];
  if (!Number.isFinite(r.distanceMaxKm) || r.distanceMaxKm < LIMITES.distanceMinKm || r.distanceMaxKm > LIMITES.distanceMaxKm) {
    erreurs.push(`distance routière maximale : entre ${LIMITES.distanceMinKm * 1000} m et ${LIMITES.distanceMaxKm} km`);
  }
  if (r.faction !== 'toutes' && !FACTIONS.includes(r.faction)) erreurs.push('faction inconnue');
  if (!Array.isArray(r.types) || !r.types.length || r.types.some((t) => !TYPES.includes(t))) erreurs.push('au moins un type de barage connu');
  if (!['simulation', 'reelle', 'toutes'].includes(r.origine)) erreurs.push('origine inconnue');
  if (!Number.isInteger(r.maxCandidats) || r.maxCandidats < 1 || r.maxCandidats > 50_000) erreurs.push('nombre maximal de paires : 1 à 50 000');
  if (typeof r.inclureAjoutsLocaux !== 'boolean') erreurs.push('ajouts locaux : vrai ou faux');
  // Paramètre d'une ancienne version (vol d'oiseau) : ignoré, la route décide.
  const { mode: _m, maxPaires: _p, ...propres } = r;
  return { regles: erreurs.length ? null : { ...propres, types: [...new Set(propres.types)] }, erreurs };
}

const valide = (b) => b && typeof b === 'object' && typeof b.id === 'string'
  && Number.isFinite(b.latitude) && Number.isFinite(b.longitude) && Math.abs(b.latitude) <= 90 && Math.abs(b.longitude) <= 180;

/** Faction d'un barage (créneau, ou « continu » pour un intouchable) ; null si incohérente. */
export function factionDe(b) {
  if (b?.type === 'intouchable') return b.shift === CONTINU ? CONTINU : null;
  if (b?.type === 'fixe') return CRENEAUX.includes(b.shift) ? b.shift : null;
  return null;
}

/**
 * Faction commune de deux barages, ou null. Un intouchable (24 h/24) est en service pendant les
 * quatre créneaux : il appartient à chaque faction. Deux barages fixes ne partagent une faction
 * que s'ils ont le même créneau. Simulés et réels ne sont jamais rapprochés.
 */
export function factionCommune(a, b) {
  const [fa, fb] = [factionDe(a), factionDe(b)];
  if (fa === null || fb === null || origineDe(a) !== origineDe(b) || origineDe(a) === 'inconnue') return null;
  if (fa === CONTINU) return fb;
  if (fb === CONTINU || fa === fb) return fa;
  return null;
}

/** Les deux barages sont-ils de la même faction (et de la même origine) ? Vérifié à chaque décision. */
export const memeFaction = (a, b) => factionCommune(a, b) !== null;

/**
 * Barage protégé : « Barage fixe intouchable ». Il compte dans toutes les analyses (point de
 * référence) mais l'optimisation ne le déplace, ne le supprime ni ne le modifie jamais.
 */
export { estProtege };
export const LIBELLE_PROTEGE = 'Barage fixe — intouchable';

/**
 * Barages éligibles, par origine : fixes rangés par créneau, intouchables à part.
 * @returns {{ origines: Map<string, { fixes: Map<string, object[]>, intouchables: object[] }>, analyses: number, incoherents: number }}
 */
export function groupesFaction(enregistrements, regles, hierarchie = null) {
  const portee = { perimetre: { origine: regles.origine, ...regles.perimetre }, inclureAjoutsLocaux: regles.inclureAjoutsLocaux };
  const types = regles.types ?? TYPES;
  const origines = new Map();
  let analyses = 0;
  let incoherents = 0;
  for (const e of enregistrements) {
    if (!valide(e.barage) || origineDe(e.barage) === 'inconnue' || !types.includes(e.barage.type) || !dansPerimetre(e, portee, hierarchie)) continue;
    const f = factionDe(e.barage);
    if (f === null) {
      incoherents += 1; // type et faction incompatibles : jamais comparé
      continue;
    }
    if (regles.faction === CONTINU && f !== CONTINU) continue;
    if (regles.faction !== 'toutes' && regles.faction !== CONTINU && f !== CONTINU && f !== regles.faction) continue;
    analyses += 1;
    const o = origineDe(e.barage);
    if (!origines.has(o)) origines.set(o, { fixes: new Map(), intouchables: [] });
    const g = origines.get(o);
    if (f === CONTINU) g.intouchables.push(e);
    else if (g.fixes.has(f)) g.fixes.get(f).push(e);
    else g.fixes.set(f, [e]);
  }
  return { origines, analyses, incoherents };
}

/**
 * Paires candidates à un calcul d'itinéraire : même faction (les intouchables étant de toutes),
 * même origine, et pas exclues par la borne inférieure (ligne droite > seuil + marge ⇒ la route
 * est forcément au-delà du seuil). Chaque faction est analysée avec les intouchables ; une paire
 * n'apparaît qu'une fois ; jamais un barage avec lui-même.
 * @returns {{ candidats: { a, b, faction }[], analyses: number, incoherents: number, exclus: number, tronque: boolean, parFaction: object }}
 */
export function pairesCandidates(enregistrements, regles, hierarchie = null) {
  const { origines, analyses, incoherents } = groupesFaction(enregistrements, regles, hierarchie);
  const borne = regles.distanceMaxKm * 1000 + MARGE_FILTRE_M;
  const pasLat = borne / 111_320;
  const candidats = [];
  const parFaction = {};
  const vues = new Set();
  let exclus = 0;
  let tronque = false;
  for (const { fixes, intouchables } of origines.values()) {
    const groupes = [...fixes].map(([f, liste]) => [f, [...liste, ...intouchables]]);
    if (!groupes.length && intouchables.length) groupes.push([CONTINU, intouchables]);
    if (intouchables.length) parFaction[CONTINU] = (parFaction[CONTINU] ?? 0) + intouchables.length;
    for (const [f, liste] of fixes) parFaction[f] = (parFaction[f] ?? 0) + liste.length;
    for (const [, enrs] of groupes) {
      const latMax = Math.min(89, enrs.reduce((m, e) => Math.max(m, Math.abs(e.barage.latitude)), 0) + pasLat);
      const pasLon = pasLat / Math.cos((latMax * Math.PI) / 180);
      const cellule = (b) => [Math.floor(b.latitude / pasLat), Math.floor(b.longitude / pasLon)];
      const grille = new Map();
      enrs.forEach((e, i) => {
        const k = cellule(e.barage).join(',');
        if (grille.has(k)) grille.get(k).push(i);
        else grille.set(k, [i]);
      });
      let proches = 0;
      let examinees = 0;
      for (let i = 0; i < enrs.length; i++) {
        const [y, x] = cellule(enrs[i].barage);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          for (const j of grille.get(`${y + dy},${x + dx}`) ?? []) {
            if (j <= i) continue; // ni soi-même, ni la même paire deux fois dans le groupe
            const [a, b] = [enrs[i], enrs[j]];
            if (a.barage.id === b.barage.id) continue;
            const faction = factionCommune(a.barage, b.barage);
            if (faction === null) continue;
            const cle = [`${a.source}#${a.barage.id}`, `${b.source}#${b.barage.id}`].sort().join('+');
            if (vues.has(cle)) continue; // deux intouchables : déjà vus avec une autre faction
            vues.add(cle);
            examinees += 1;
            if (distanceMetres([a.barage.longitude, a.barage.latitude], [b.barage.longitude, b.barage.latitude]) > borne) continue;
            proches += 1;
            if (candidats.length >= regles.maxCandidats) {
              tronque = true;
              continue;
            }
            candidats.push({ a, b, faction });
          }
        }
      }
      exclus += examinees - proches;
    }
  }
  candidats.sort((p, q) => (p.faction < q.faction ? -1 : p.faction > q.faction ? 1 : p.a.barage.id < q.a.barage.id ? -1 : 1));
  return { candidats, analyses, incoherents, exclus, tronque, parFaction };
}

/**
 * Distance par la route de chaque paire, une à une, avec le moteur du projet
 * (`reseau.itineraire`). Statut par paire : 'ok', 'indisponible' (aucun itinéraire) ou
 * 'erreur' (le moteur a échoué). Aucune distance n'est estimée. Annulable entre deux paires.
 * @returns {Promise<{ routes: object[], annule: boolean }>}
 */
export async function distancesRoute(paires, reseau, { priorite = 'court', annule = () => false, progression = () => {} } = {}) {
  const routes = [];
  for (let i = 0; i < paires.length; i++) {
    if (annule()) return { routes, annule: true };
    const { a, b } = paires[i];
    let route;
    try {
      const r = await reseau.itineraire([a.barage.longitude, a.barage.latitude], [b.barage.longitude, b.barage.latitude], { priorite });
      route = r && Number.isFinite(r.distance) && Array.isArray(r.chemin) && r.chemin.length >= 2
        ? { statut: 'ok', distance: r.distance, secondes: Number.isFinite(r.secondes) ? r.secondes : null, approximatif: Boolean(r.approximatif), chemin: r.chemin }
        : { statut: 'indisponible' };
    } catch (erreur) {
      route = { statut: 'erreur', erreur: erreur?.message ?? String(erreur) };
    }
    routes.push(route);
    progression(i + 1, paires.length);
  }
  return { routes, annule: false };
}

/**
 * Décision d'alerte d'une paire : uniquement même faction ET distance routière ≤ seuil.
 * @param {{ a, b }} paire
 * @param {{ statut: 'ok' | 'indisponible' | 'erreur', distance?: number } | undefined} route
 */
export function alerte(paire, route, regles) {
  const seuil = regles.distanceMaxKm * 1000;
  const { a, b } = paire;
  const faction = factionCommune(a.barage, b.barage);
  const statut = route?.statut ?? 'non-calculee';
  const routeM = statut === 'ok' ? route.distance : null;
  // Actions possibles : seulement sur les barages déplaçables ; deux protégés = information seule.
  const mobiles = [a, b].filter((x) => !estProtege(x.barage)).map((x) => x.barage.id);
  const base = {
    id: `${a.source}#${a.barage.id}+${b.source}#${b.barage.id}`,
    ids: [a.barage.id, b.barage.id], types: [a.barage.type, b.barage.type], faction, statutRoute: statut, routeM,
    mobiles, informatif: mobiles.length === 0,
    secondes: statut === 'ok' ? route.secondes : null, approximatif: statut === 'ok' ? route.approximatif : null,
    erreur: statut === 'erreur' ? route.erreur : null,
  };
  if (faction === null) return { ...base, alerte: false, raison: 'Factions différentes : jamais comparées.' };
  if (statut !== 'ok') {
    return { ...base, alerte: false, raison: statut === 'erreur' ? `Distance routière indisponible : erreur du moteur d’itinéraires (${route.erreur}).` : statut === 'indisponible' ? 'Distance routière indisponible : aucun itinéraire trouvé dans les données routières (routes non reliées ?).' : 'Distance routière pas encore calculée.' };
  }
  const ok = violeEspacement(routeM, seuil);
  return {
    ...base, alerte: ok,
    raison: ok
      ? `Alerte de proximité : même faction (${libelleFaction(faction)}) et ${formaterKm(routeM)} par la route ≤ ${formaterKm(seuil)}.`
      : `${formaterKm(routeM)} par la route > ${formaterKm(seuil)} : pas d’alerte.`,
  };
}

// ── Optimisation en une étape (fenêtre « Calculer ») ─────────────────────

export const DISTANCE_SIMPLE_DEFAUT_KM = 10;

/** Distance saisie dans la fenêtre : nombre positif (virgule acceptée), dans les limites. */
export function validerDistanceSimple(saisie) {
  const km = Number(String(saisie ?? '').trim().replace(',', '.'));
  if (String(saisie ?? '').trim() === '' || !Number.isFinite(km) || km <= 0) return { erreur: 'Saisissez une distance positive, en kilomètres.' };
  if (km < LIMITES.distanceMinKm || km > LIMITES.distanceMaxKm) return { erreur: `Distance entre ${LIMITES.distanceMinKm * 1000} m et ${LIMITES.distanceMaxKm} km.` };
  return { km };
}

/**
 * Règles de l'optimisation en une étape : seule la distance est choisie. Toutes les factions
 * (chacune avec les intouchables), les deux types, tout le Royaume ; simulés et réels restent
 * séparés (jamais appariés).
 */
export const reglesSimples = (km) => ({ ...REGLES_PROXIMITE, distanceMaxKm: km, faction: 'toutes', types: [...TYPES], origine: 'toutes', perimetre: { reg: '', cie: '', bt: '' } });

/**
 * Résultats de l'optimisation en une étape : les paires NON CONFORMES (même faction, distance
 * routière vérifiée ≤ seuil) et, à part, celles dont la distance routière n'a pas pu être
 * vérifiée (jamais présentées comme des violations). Les autres paires ne sont pas montrées.
 * @returns {{ violations: number[], nonVerifiees: number[] }}  indices dans `alertes`
 */
export function resultatsNonConformes(alertes) {
  const violations = [];
  const nonVerifiees = [];
  const vues = new Set();
  alertes.forEach((a, i) => {
    if (!a || a.faction === null) return;
    const cle = [...a.ids].sort().join('+');
    if (a.ids[0] === a.ids[1] || vues.has(cle)) return; // ni soi-même, ni doublon
    vues.add(cle);
    if (a.alerte) violations.push(i);
    else if (a.statutRoute === 'indisponible' || a.statutRoute === 'erreur') nonVerifiees.push(i);
  });
  return { violations, nonVerifiees };
}

/** Tranches de distance routière (bornes en mètres) jusqu'au seuil. */
export function tranches(seuilM) {
  const bornes = [250, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000].filter((x) => x < seuilM);
  return [...bornes, seuilM].map((max, i, t) => ({ min: i ? t[i - 1] : 0, max, libelle: `${i ? formaterKm(t[i - 1]) : '0'} – ${formaterKm(max)}` }));
}

export function parTranche(alertes, regles) {
  const t = tranches(regles.distanceMaxKm * 1000).map((x) => ({ ...x, n: 0 }));
  for (const a of alertes) {
    if (!a.alerte) continue;
    const x = t.find((y) => a.routeM <= y.max);
    if (x) x.n += 1;
  }
  return t;
}

export function formaterKm(m) {
  if (m === null || m === undefined || !Number.isFinite(m)) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10_000 ? 2 : 1).replace('.', ',')} km`;
}

export function formaterDuree(s) {
  if (!Number.isFinite(s)) return '—';
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

/**
 * Tracés pour la carte : les deux barages et l'itinéraire routier tel que le moteur le donne.
 * Sans itinéraire, aucun trait (jamais de ligne droite à la place d'une route).
 */
export function traitsPaire(a, b, route, { role = 'actuel' } = {}) {
  const point = (x, texte) => ({ type: 'Feature', properties: { role: `barage-${role}`, texte }, geometry: { type: 'Point', coordinates: [x.longitude, x.latitude] } });
  const f = [point(a, a.id), point(b, b.id)];
  if (route?.statut === 'ok' && route.chemin?.length >= 2) {
    f.unshift({ type: 'Feature', properties: { role: `route-${role}`, texte: `${formaterKm(route.distance)} par la route${route.approximatif ? ' (tracé approximatif)' : ''}` }, geometry: { type: 'LineString', coordinates: route.chemin } });
  }
  return f;
}

// ── Règle d'espacement : une seule définition, utilisée partout ───────────
//
// Seuil D (km, choisi par l'utilisateur) entre deux barages de la MÊME faction :
//   - une paire existante est en alerte si distance routière ≤ D ;
//   - un emplacement (déplacement, carte de chaleur, nouveau barage) n'est valide que si
//     chaque distance routière vérifiée vers un barage de même faction est > D.
// Les deux formulations sont la même règle : « à D ou moins par la route = trop proche ».

/** La distance routière viole-t-elle l'espacement ? (à exactement D : oui, comme l'alerte) */
export const violeEspacement = (routeM, seuilM) => Number.isFinite(routeM) && routeM <= seuilM;

/**
 * Barages qu'il faut vérifier par la route pour un emplacement : même faction, même origine,
 * jamais le barage déplacé lui-même. Ceux que la borne inférieure (ligne droite > D + marge ⇒
 * route > D) exclut ne peuvent pas violer la règle : ils ne sont pas routés.
 * @param {number[]} point  [lon, lat] de l'emplacement
 * @param {{ type, shift, isSimulation, id? }} barage  barage déplacé, ou modèle d'un nouveau barage
 */
export function voisinsRequis(point, barage, enregistrements, seuilM) {
  const borne = seuilM + MARGE_FILTRE_M;
  return enregistrements
    .filter((e) => valide(e.barage) && e.barage.id !== barage.id && memeFaction(e.barage, barage))
    .map((e) => ({ e, d: distanceMetres(point, [e.barage.longitude, e.barage.latitude]) }))
    .filter((x) => x.d <= borne)
    .sort((x, y) => x.d - y.d)
    .map((x) => x.e);
}

/**
 * Validation d'un emplacement à partir des distances routières vers les voisins requis.
 * @param {{ enr, route }[]} verifs  route : { statut: 'ok' | 'indisponible' | 'erreur', distance? }
 * @returns {{ statut: 'valide' | 'non-valide' | 'verification-impossible', violations, indisponibles, verifiees, minimumM }}
 *   non-valide : au moins une route vérifiée ≤ D ; vérification impossible : aucune violation
 *   mais une route manque (rien ne garantit l'espacement) ; valide : toutes vérifiées et > D.
 */
export function validerEspacement(verifs, seuilM) {
  const violations = verifs.filter((v) => v.route?.statut === 'ok' && violeEspacement(v.route.distance, seuilM));
  const indisponibles = verifs.filter((v) => v.route?.statut !== 'ok');
  const verifiees = verifs.filter((v) => v.route?.statut === 'ok');
  const minimumM = verifiees.length ? Math.min(...verifiees.map((v) => v.route.distance)) : null;
  const statut = violations.length ? 'non-valide' : indisponibles.length ? 'verification-impossible' : 'valide';
  return { statut, violations, indisponibles, verifiees, minimumM, seuilM, requis: verifs.length };
}

export const LIBELLES_VALIDATION = Object.freeze({
  valide: 'Emplacement valide', 'non-valide': 'Emplacement non valide', 'verification-impossible': 'Vérification impossible',
});

/** Distances routières vers les voisins requis (moteur du projet) puis validation commune. */
export async function validerEmplacementRoutier(point, barage, enregistrements, seuilM, reseau, options = {}) {
  const voisins = voisinsRequis(point, barage, enregistrements, seuilM);
  const depart = { barage: { longitude: point[0], latitude: point[1] } };
  const { routes, annule } = await distancesRoute(voisins.map((v) => ({ a: depart, b: v })), reseau, options);
  if (annule) return null;
  return validerEspacement(voisins.map((enr, i) => ({ enr, route: routes[i] })), seuilM);
}

/**
 * Mémoire des itinéraires (même interface que le moteur : `itineraire(a, b, options)`). Une
 * paire déjà calculée n'est pas recalculée ; tout est oublié dès que les barages changent
 * (`valider(version)`), les routes étant lues de tuiles fixes. Les erreurs ne sont pas gardées.
 */
export class CacheItineraires {
  constructor(reseau, { max = 5000 } = {}) {
    Object.assign(this, { reseau, max });
    this.memo = new Map();
    this.version = undefined;
    this.appels = 0;
  }

  valider(version) {
    if (version === this.version) return;
    this.memo.clear();
    this.version = version;
  }

  itineraire(a, b, { priorite = 'court' } = {}) {
    const k = (p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    const [ka, kb] = [k(a), k(b)];
    const inverse = kb < ka;
    const cle = `${priorite}|${inverse ? kb : ka}|${inverse ? ka : kb}`;
    if (!this.memo.has(cle)) {
      this.appels += 1;
      const [de, vers] = inverse ? [b, a] : [a, b];
      const promesse = Promise.resolve(this.reseau.itineraire(de, vers, { priorite })).catch((erreur) => {
        this.memo.delete(cle);
        throw erreur;
      });
      this.memo.set(cle, promesse);
      if (this.memo.size > this.max) this.memo.delete(this.memo.keys().next().value);
    }
    // Routes à double sens (hypothèse du moteur) : même distance, tracé retourné si besoin.
    return this.memo.get(cle).then((r) => (r && inverse ? { ...r, chemin: [...r.chemin].reverse() } : r));
  }
}

// ── Carte de chaleur des emplacements ─────────────────────────────────────

export const CLASSES_CANDIDAT = Object.freeze({
  adapte: { libelle: 'Potentiellement adapté', couleur: '#15803d', aide: 'Toutes les distances routières requises vers la faction sont au-delà du seuil.' },
  'a-examiner': { libelle: 'À examiner', couleur: '#d97706', aide: 'Valide, mais un barage de la faction est à moins de 1,2 × le seuil par la route, ou un itinéraire est approximatif (raccords du réseau national).' },
  invalide: { libelle: 'Non valide (espacement)', couleur: '#b91c1c', aide: 'Un barage de la même faction est à une distance routière inférieure ou égale au seuil.' },
  indetermine: { libelle: 'Réseau insuffisant', couleur: '#64748b', aide: 'Au moins un itinéraire requis est introuvable ou en erreur : la règle ne peut pas être garantie.' },
});
export const MARGE_EXAMEN = 1.2;

/** Classe d'un emplacement candidat, à partir de la validation commune. */
export function classerCandidat(validation) {
  if (validation.statut === 'non-valide') return 'invalide';
  if (validation.statut === 'verification-impossible') return 'indetermine';
  const approximatif = validation.verifiees.some((v) => v.route.approximatif);
  const limite = validation.minimumM !== null && validation.minimumM < validation.seuilM * MARGE_EXAMEN;
  return approximatif || limite ? 'a-examiner' : 'adapte';
}

// ── Surface continue d'aptitude (raster) ──────────────────────────────────
//
// La surface est une grille (projection de la carte) dont chaque cellule reçoit une aptitude
// [0, 1] interpolée à partir des emplacements candidats VÉRIFIÉS PAR LA ROUTE autour d'elle :
//   0 = non valide (barage de la même faction ≤ D par la route), ~0,45 = à examiner, ≥ 0,7 = adapté.
// Contraintes : une cellule dont le candidat le plus proche est non valide (ou qui en a un à
// moins de la moitié du rayon) ne peut pas paraître adaptée ; une cellule dominée par des
// candidats non vérifiables est « inconnue » ; sans candidat dans le rayon (aucune route
// carrossable proche), elle est « sans route ».

export const SANS_ROUTE = -1;
export const INCONNU = -2;

/** Aptitude d'un candidat (null : inconnue, la route manque). */
export function scoreCandidat(c) {
  switch (c.classe) {
    case 'invalide': return 0;
    case 'indetermine': return null;
    case 'a-examiner': return 0.45;
    default: {
      const { minimumM: m, seuilM: d } = c.validation;
      if (m === null) return 1; // aucun barage de la faction ne peut être à D ou moins par la route
      return 0.7 + 0.3 * Math.min(1, Math.max(0, (m - MARGE_EXAMEN * d) / d));
    }
  }
}

/** Index en grille des candidats (cellules de `cellM` mètres). */
export function indexerCandidats(candidats, cellM) {
  const pas = cellM / 111_320;
  const cases = new Map();
  candidats.forEach((c, i) => {
    const k = `${Math.floor(c.point[1] / pas)},${Math.floor(c.point[0] / pas)}`;
    if (cases.has(k)) cases.get(k).push(i);
    else cases.set(k, [i]);
  });
  return { candidats, pas, cases, scores: candidats.map(scoreCandidat) };
}

/**
 * Aptitude en un point : SANS_ROUTE, INCONNU, ou une valeur dans [0, 1].
 * @returns {{ valeur: number, proche: number | null }}  proche : indice du candidat le plus proche
 */
export function aptitudeEn([lon, lat], index, rayonM) {
  const { candidats, pas, cases, scores } = index;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const portee = Math.ceil(rayonM / 111_320 / pas / Math.max(cosLat, 0.2));
  const y0 = Math.floor(lat / pas);
  const x0 = Math.floor(lon / pas);
  const lissage = (rayonM / 6) ** 2;
  let connu = 0;
  let inconnu = 0;
  let somme = 0;
  let proche = null;
  let dProche = Infinity;
  let invalideTresProche = false;
  for (let dy = -portee; dy <= portee; dy++) for (let dx = -portee; dx <= portee; dx++) {
    for (const i of cases.get(`${y0 + dy},${x0 + dx}`) ?? []) {
      const p = candidats[i].point;
      const mx = (p[0] - lon) * 111_320 * cosLat;
      const my = (p[1] - lat) * 111_320;
      const d2 = mx * mx + my * my;
      if (d2 > rayonM * rayonM) continue;
      const w = 1 / (d2 + lissage);
      if (scores[i] === null) inconnu += w;
      else {
        connu += w;
        somme += w * scores[i];
      }
      if (d2 < dProche) { dProche = d2; proche = i; }
      if (scores[i] === 0 && d2 <= (rayonM / 2) ** 2) invalideTresProche = true;
    }
  }
  if (proche === null) return { valeur: SANS_ROUTE, proche: null };
  if (inconnu >= connu || scores[proche] === null) return { valeur: INCONNU, proche };
  let v = somme / connu;
  v = Math.min(v, scores[proche] + 0.15); // jamais plus apte que le lieu vérifié le plus proche, à peu près
  if (scores[proche] === 0) v = Math.min(v, 0.2);
  if (invalideTresProche) v = Math.min(v, 0.3);
  return { valeur: v, proche };
}

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latMerc = (y) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/**
 * Grille d'aptitude sur une emprise, en lignes régulières dans la projection de la carte
 * (Web Mercator), pour une source « image » MapLibre aux quatre coins de l'emprise.
 * @returns {{ largeur, hauteur, valeurs: Float32Array, coins: number[][], lat: (y) => number, lon: (x) => number }}
 */
export function grilleAptitude(candidats, [o, s, e, n], { largeur = 400, rayonM, index = null } = {}) {
  const yN = mercY(n);
  const yS = mercY(s);
  const hauteur = Math.max(1, Math.round((largeur * (yN - yS)) / (((e - o) * Math.PI) / 180)));
  const idx = index ?? indexerCandidats(candidats, rayonM);
  const valeurs = new Float32Array(largeur * hauteur);
  const lon = (x) => o + ((x + 0.5) / largeur) * (e - o);
  const lat = (y) => latMerc(yN - ((y + 0.5) / hauteur) * (yN - yS));
  for (let y = 0; y < hauteur; y++) {
    const la = lat(y);
    for (let x = 0; x < largeur; x++) valeurs[y * largeur + x] = aptitudeEn([lon(x), la], idx, rayonM).valeur;
  }
  return { largeur, hauteur, valeurs, coins: [[o, n], [e, n], [e, s], [o, s]], lon, lat, mercY: [yN, yS] };
}

/** Couleur RGBA d'une aptitude : rouge (0) → orange (0,5) → vert (1) ; gris si inconnu ; voile léger sans route. */
export function couleurAptitude(v) {
  if (v === SANS_ROUTE) return [148, 163, 184, 40];
  if (v === INCONNU) return [100, 116, 139, 150];
  const rouge = [185, 28, 28];
  const orange = [245, 158, 11];
  const vert = [21, 128, 61];
  const [a, b, t] = v < 0.5 ? [rouge, orange, v / 0.5] : [orange, vert, (v - 0.5) / 0.5];
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)).concat(165);
}

/** Libellé d'une aptitude (légende, info au clic). */
export function libelleAptitude(v) {
  if (v === SANS_ROUTE) return 'Aucune route carrossable proche : pas d’emplacement possible';
  if (v === INCONNU) return 'Inconnu : distance routière indisponible';
  if (v < 1 / 3) return 'Non adapté (trop proche d’un barage de la même faction par la route)';
  if (v < 0.67) return 'Incertain (à examiner)';
  return 'Potentiellement adapté';
}

/**
 * Points candidats le long des routes carrossables (géométrie des tuiles), tous les `pasM`
 * mètres, gardés seulement si `dans(point)` (zone choisie). Dédoublonnés sur une grille de pasM/2
 * (une route lue dans deux fenêtres, ou deux voies superposées, ne donnent qu'un candidat).
 * @param {{ points: number[][], classe, nom, ref }[]} lignes  en [lon, lat]
 */
export function echantillonnerLignes(lignes, pasM, { classes, dans = () => true, vus = new Set() } = {}) {
  const sortie = [];
  const cellule = pasM / 2 / 111_320;
  const garder = (p, l) => {
    const k = `${Math.round(p[1] / cellule)},${Math.round(p[0] / (cellule / Math.cos((p[1] * Math.PI) / 180)))}`;
    if (vus.has(k) || !dans(p)) return;
    vus.add(k);
    sortie.push({ point: p, route: { nom: l.nom ?? null, ref: l.ref ?? null, classe: l.classe ?? null } });
  };
  for (const l of lignes) {
    if (classes && !classes.has(l.classe)) continue;
    const pts = l.points ?? [];
    if (pts.length < 2) continue;
    let reste = pasM / 2; // premier point à mi-pas du début de la ligne
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const long = distanceMetres(a, b);
      let t = reste;
      while (t <= long) {
        const f = long ? t / long : 0;
        garder([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], l);
        t += pasM;
      }
      reste = t - long;
    }
  }
  return sortie;
}

/** Découpe une emprise [ouest, sud, est, nord] en fenêtres d'au plus `pasDeg` degrés. */
export function fenetres([o, s, e, n], pasDeg) {
  const f = [];
  for (let y = s; y < n; y += pasDeg) for (let x = o; x < e; x += pasDeg) f.push([x, y, Math.min(e, x + pasDeg), Math.min(n, y + pasDeg)]);
  return f;
}

// ── Zone géographique choisie ─────────────────────────────────────────────

/**
 * Zone à cadrer et à analyser, résolue dans les circonscriptions du projet (la plus précise :
 * brigade, sinon compagnie, sinon région). Aucune zone inventée : erreur si elle manque.
 * @param {{ reg: object[], cie: object[], bt: object[] }} circos  entités indexées (competence.js)
 * @returns {{ tout: true } | { niveau, id, nom, geometrie, emprise } | { erreur: string }}
 */
export function cibleZone(circos, perimetre = {}) {
  const niveau = perimetre.bt ? 'bt' : perimetre.cie ? 'cie' : perimetre.reg ? 'reg' : null;
  if (!niveau) return { tout: true };
  const id = perimetre[niveau];
  const entite = circos?.[niveau]?.find((e) => e.proprietes?.id === id);
  if (!entite?.geometrie || !entite.emprise?.every(Number.isFinite)) {
    const quoi = { bt: 'la brigade', cie: 'la compagnie', reg: 'la région' }[niveau];
    return { erreur: `Limites de ${quoi} « ${id} » introuvables dans les données : la carte n’est pas déplacée.` };
  }
  return { niveau, id, nom: entite.proprietes.nom ?? id, geometrie: entite.geometrie, emprise: entite.emprise };
}

// ── Historique (ce navigateur) ────────────────────────────────────────────

export const LIMITES_HISTORIQUE = Object.freeze({ analyses: 20, alertesParAnalyse: 1000, propositions: 200 });
export const STATUTS_PROPOSITION = Object.freeze({ 'en-attente': 'En attente', appliquee: 'Appliquée', rejetee: 'Rejetée', annulee: 'Annulée (rétablie)', echec: 'Échec' });
export const HISTORIQUE_VIDE = () => ({ version: 1, analyses: [], propositions: [], evenements: [] });

export function lireHistoriqueProximite(brut) {
  if (!brut || typeof brut !== 'object') return HISTORIQUE_VIDE();
  const liste = (x) => (Array.isArray(x) ? x.filter((y) => y && typeof y === 'object' && typeof y.id === 'string') : []);
  return { version: 1, analyses: liste(brut.analyses), propositions: liste(brut.propositions), evenements: liste(brut.evenements) };
}

export function ajouterAnalyse(h, analyse) {
  const bornee = { ...analyse, alertes: analyse.alertes.slice(0, LIMITES_HISTORIQUE.alertesParAnalyse), tronqueHistorique: analyse.alertes.length > LIMITES_HISTORIQUE.alertesParAnalyse };
  return { ...h, analyses: [bornee, ...h.analyses].slice(0, LIMITES_HISTORIQUE.analyses) };
}

/** Propositions : les plus récentes d'abord ; les anciennes clôturées partent en premier. */
export function ajouterProposition(h, p) {
  const propositions = [p, ...h.propositions];
  while (propositions.length > LIMITES_HISTORIQUE.propositions) {
    const i = propositions.findLastIndex((x) => x.statut !== 'en-attente' && x.statut !== 'appliquee');
    propositions.splice(i >= 0 ? i : propositions.length - 1, 1);
  }
  return { ...h, propositions };
}

export const majProposition = (h, p) => ({ ...h, propositions: h.propositions.map((x) => (x.id === p.id ? p : x)) });

export function compterPropositions(h) {
  const n = { total: h.propositions.length, 'en-attente': 0, appliquee: 0, rejetee: 0, annulee: 0, echec: 0 };
  for (const p of h.propositions) n[p.statut] = (n[p.statut] ?? 0) + 1;
  return n;
}
