/**
 * Simulation de l'optimisation automatique par distance routière réelle.
 * Le module ne reçoit que des barrages du périmètre autorisé par l'API et
 * n'effectue aucune écriture.
 */
import { distanceKm, accrocher, itineraire, pointsArete, refArete, arbreBorne, distanceParArbres } from './routage.mjs';
import { recalerPosition } from './pointKilometrique.mjs';
import { estIntouchable } from './depot.mjs';
import { tracerEntrePostes } from './tempsTrajet.mjs';

/**
 * SEUIL DE L'OPTIMISATION AUTOMATIQUE — distance routière minimale entre deux
 * barrages fixes d'une même faction.
 *
 * TEMPORAIREMENT 20 km (au lieu de 40 km) : un conflit est une distance
 * routière STRICTEMENT inférieure à ce seuil ; une position proposée n'est
 * valide qu'à ce seuil ou au-delà de tous les autres postes. C'est la SEULE
 * valeur à changer pour revenir à 40 km : moteur, arbres routiers, portée des
 * Intouchables, revalidation à l'application et libellés en dérivent tous.
 *
 * L'optimisation MANUELLE n'en dépend pas : elle garde sa propre distance.
 */
export const SEUIL_DISTANCE_AUTO_KM = 20;
/** Déplacement maximal d'une position candidate, à vol d'oiseau. */
const DEPLACEMENT_MAX_KM = 120;
/**
 * Au-delà de cette distance à vol d'oiseau de TOUS les barrages déplaçables,
 * un Intouchable ne peut entrer en conflit avec aucune position, actuelle ou
 * proposée : un candidat est à au plus DEPLACEMENT_MAX_KM de son origine, et la
 * distance routière n'est jamais inférieure au vol d'oiseau.
 */
export const PORTEE_INTOUCHABLE_KM = SEUIL_DISTANCE_AUTO_KM + DEPLACEMENT_MAX_KM;
const RAYON_ACCROCHAGE_KM = 30; // même rayon que serveur/distances.mjs
const PAS_CANDIDAT_KM = 5;
/* Dans une zone, TOUTES les positions de la zone sont candidates (la borne
   n'est qu'un garde-fou) : se limiter aux 300 plus proches ne regardait que les
   abords du poste, et déclarait « sans solution » des conflits qui en avaient
   une plus loin dans la zone. */
const PAS_CANDIDAT_ZONE_KM = 2;
const MAX_CANDIDATS_ZONE = 20_000;
const MAX_TRACES_RESTANTS = 40;
const MAX_CANDIDATS = 300;
const MAX_TOURS = 50_000;
const PAS_GRILLE = 0.05;
const PAS_INDEX_GEO = 0.1;

const contraintes = (b) => [
  Number(b?.accidentCount) > 0,
  b?.exceptionnel === true,
  Boolean(b?.missionId),
  ['entree', 'sortie', 'porte'].includes(b?.positionVille),
  b?.eclairage === 'non',
  b?.decisionOptimisation === 'conserve',
].filter(Boolean).length;

const detailsContraintes = (b) => [
  Number(b?.accidentCount) > 0 ? `${Number(b.accidentCount)} accident(s) recensé(s)` : null,
  b?.exceptionnel === true ? 'événement exceptionnel' : null,
  b?.missionId ? 'mission opérationnelle' : null,
  ['entree', 'sortie', 'porte'].includes(b?.positionVille) ? `position de ville : ${b.positionVille}` : null,
  b?.eclairage === 'non' ? 'axe non éclairé' : null,
  b?.decisionOptimisation === 'conserve' ? 'protection manuelle' : null,
].filter(Boolean);

const clePairePosition = (a, b) => [
  `${a.id}|${a.lng}|${a.lat}`,
  `${b.id}|${b.lng}|${b.lat}`,
].sort().join('::');

/**
 * OUTILS DE MESURE D'UNE ANALYSE — mêmes calculs que serveur/distances.mjs,
 * mémorisés.
 *
 * Accrocher un point au graphe et recaler un candidat sur sa route sont des
 * fonctions déterministes de leurs coordonnées : un barrage en échec est
 * réexaminé après chaque déplacement, et recalculait à chaque fois les mêmes
 * accrochages et recalages pour ses mêmes candidats. Ils sont donc calculés
 * une fois par analyse.
 *
 * Le second sens d'un A* est borné par le premier résultat : seul le minimum
 * des deux sens est retenu, et un retour plus long que l'aller ne peut pas le
 * changer. Le résultat est identique à `distanceRouteSousSeuilKm`.
 */
function creerOutils(graphe, seuil = SEUIL_DISTANCE_AUTO_KM) {
  const mesures = { candidats: 0, controlesConflit: 0, calculsRoute: 0, astar: 0, arbres: 0, accrochages: 0, recalages: 0 };
  const accroches = new Map();
  const recales = new Map();
  const accroche = (lng, lat, rayonKm) => {
    const cle = `${rayonKm}|${lng}|${lat}`;
    let acc = accroches.get(cle);
    if (acc === undefined) {
      mesures.accrochages++;
      acc = accrocher(graphe, lng, lat, rayonKm) ?? null;
      accroches.set(cle, acc);
    }
    return acc;
  };
  const astar = (depart, arrivee, limiteKm) => {
    mesures.astar++;
    return itineraire(graphe, depart, arrivee, limiteKm);
  };
  /** Minimum des deux sens entre deux points accrochés, sous `limiteKm`. */
  const entreAccroches = (sa, sb, limiteKm) => {
    mesures.calculsRoute++;
    const aller = astar(sa, sb, limiteKm);
    const retour = astar(sb, sa, aller ? Math.min(limiteKm, aller.km) : limiteKm);
    if (!aller) return retour?.km ?? null;
    if (!retour) return aller.km;
    return Math.min(aller.km, retour.km);
  };
  const route = (ptA, ptB, limiteKm) => {
    const sa = accroche(ptA[0], ptA[1], RAYON_ACCROCHAGE_KM);
    const sb = accroche(ptB[0], ptB[1], RAYON_ACCROCHAGE_KM);
    if (!sa || !sb) return null;
    return entreAccroches(sa, sb, limiteKm);
  };
  /** Candidat recalé sur sa route puis accroché, ou `null` s'il est inutilisable. */
  const recaler = (c) => {
    const cle = `${c.lng}|${c.lat}|${c.route}`;
    let r = recales.get(cle);
    if (r === undefined) {
      mesures.recalages++;
      const recale = recalerPosition(graphe, c.lng, c.lat, { route: c.route, rayonKm: 0.25 });
      const snap = recale.erreur ? null : accroche(recale.lng, recale.lat, 1);
      r = snap ? { recale, snap } : null;
      recales.set(cle, r);
    }
    return r;
  };
  /**
   * LES DEUX ARBRES ROUTIERS D'UN POSTE (bornés au seuil, sens direct et inverse),
   * calculés une fois par POSITION. Un candidat se mesure alors contre ce poste
   * par une simple lecture — la même distance que deux A*, sans les relancer
   * pour chacun des milliers de candidats d'une zone.
   */
  const arbres = new Map();
  const arbreDe = (poste) => {
    const cle = `${poste.lng}|${poste.lat}`;
    let a = arbres.get(cle);
    if (a === undefined) {
      const snap = accroche(poste.lng, poste.lat, RAYON_ACCROCHAGE_KM);
      a = snap
        ? {
            snap,
            vers: arbreBorne(graphe, snap, { inverse: true, limiteKm: seuil }),
            depuis: arbreBorne(graphe, snap, { limiteKm: seuil }),
          }
        : null;
      if (a) mesures.arbres += 2;
      arbres.set(cle, a);
    }
    return a;
  };
  /** Distance routière d'un candidat accroché à un poste, ou `null` au-delà du seuil. */
  const versPoste = (snapCandidat, poste) => {
    mesures.calculsRoute++;
    const a = arbreDe(poste);
    if (!a) return null;
    const km = distanceParArbres(graphe, snapCandidat, a.snap, a);
    return km < seuil ? km : null;
  };
  return {
    seuil,
    mesures,
    accroche,
    entreAccroches,
    versPoste,
    sousSeuil: (ptA, ptB) => route(ptA, ptB, seuil),
    minKm: (ptA, ptB) => route(ptA, ptB, Infinity),
    recaler,
  };
}

/**
 * LES INTOUCHABLES UTILES À LA VALIDATION D'UN PÉRIMÈTRE.
 *
 * Seuls ceux qui sont à moins de PORTEE_INTOUCHABLE_KM d'au moins un barrage
 * déplaçable peuvent contraindre une position ; les autres n'apportent que des
 * paires Intouchable/Intouchable, qu'aucune proposition ne peut résoudre.
 */
export function intouchablesUtiles(deplacables, intouchables, { zoneBbox = null, seuilKm = SEUIL_DISTANCE_AUTO_KM } = {}) {
  return intouchables.filter((i) => {
    /* En conflit possible avec une position ACTUELLE. */
    if (deplacables.some((b) => distanceKm(i.lng, i.lat, b.lng, b.lat) < seuilKm)) return true;
    /* Sinon, seulement avec une position PROPOSÉE : un candidat reste dans la
       zone (quand elle est connue) et à DEPLACEMENT_MAX_KM de son origine. */
    if (zoneBbox && distanceBboxKm(zoneBbox, i.lng, i.lat) >= seuilKm) return false;
    return deplacables.some((b) => distanceKm(i.lng, i.lat, b.lng, b.lat) < (seuilKm + DEPLACEMENT_MAX_KM));
  });
}

/** Distance à vol d'oiseau d'un point à un rectangle [ouest, sud, est, nord] ; 0 dedans. */
function distanceBboxKm([o, sud, e, nord], lng, lat) {
  const x = Math.min(Math.max(lng, o), e);
  const y = Math.min(Math.max(lat, sud), nord);
  return distanceKm(lng, lat, x, y);
}

export function partagentFaction(a, b) {
  if (estIntouchable(a) || estIntouchable(b)) return true;
  const fa = Array.isArray(a?.factions) ? a.factions : (a?.factionId ? [a.factionId] : null);
  const fb = Array.isArray(b?.factions) ? b.factions : (b?.factionId ? [b.factionId] : null);
  if (fa && fb && fa.length && fb.length) {
    return fa.some((f) => fb.includes(f));
  }
  return true;
}

function conflits(barrages, outils, cache = null) {
  const out = [];
  for (let i = 0; i < barrages.length; i++) {
    for (let j = i + 1; j < barrages.length; j++) {
      const a = barrages[i];
      const b = barrages[j];
      if (!partagentFaction(a, b)) continue;
      if (distanceKm(a.lng, a.lat, b.lng, b.lat) >= outils.seuil) continue;
      outils.mesures.controlesConflit++;
      const cle = clePairePosition(a, b);
      let km = cache?.get(cle);
      if (km === undefined) {
        km = outils.sousSeuil([a.lng, a.lat], [b.lng, b.lat]);
        cache?.set(cle, km);
      }
      if (km != null && km < outils.seuil) out.push({ a: i, b: j, km });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}

export function listerConflitsDistance(barrages, graphe, { seuilKm = SEUIL_DISTANCE_AUTO_KM } = {}) {
  return conflits(barrages, creerOutils(graphe, seuilKm)).map((c) => ({
    a: barrages[c.a].id, b: barrages[c.b].id, km: c.km,
  }));
}

/**
 * `dansZone` (facultatif) écarte d'emblée les points hors de la zone analysée,
 * AVANT de retenir les MAX_CANDIDATS plus proches : sinon, dans un réseau dense,
 * les plus proches peuvent être presque tous hors zone et les positions valides
 * de la zone ne sont jamais examinées. `garderPosition` reste appliqué ensuite
 * à la position recalée : ce filtre ne fait que ne pas gaspiller de candidats.
 *
 * Dans une zone, le pas d'échantillonnage descend à PAS_CANDIDAT_ZONE_KM : une
 * zone est petite, et un pas de 5 km peut enjamber le seul tronçon valide (à
 * Rabat, le seul tronçon libre à 40 km de tout Intouchable mesure 2,4 km).
 */
function candidatsLocaux(graphe, barrage, dansZone = null) {
  const pas = dansZone ? PAS_CANDIDAT_ZONE_KM : PAS_CANDIDAT_KM;
  const candidats = [];
  const coordonneesVues = new Set();
  const cosLat = Math.max(0.2, Math.cos((barrage.lat * Math.PI) / 180));
  const centreX = Math.floor(barrage.lng / PAS_GRILLE);
  const centreY = Math.floor(barrage.lat / PAS_GRILLE);
  const rayonX = Math.ceil(DEPLACEMENT_MAX_KM / (PAS_GRILLE * 111 * cosLat)) + 1;
  const rayonY = Math.ceil(DEPLACEMENT_MAX_KM / (PAS_GRILLE * 111)) + 1;
  const aretesLocales = new Set();
  for (let dx = -rayonX; dx <= rayonX; dx++) {
    for (let dy = -rayonY; dy <= rayonY; dy++) {
      for (const arete of graphe.grille.get((centreX + dx) * 100000 + centreY + dy) ?? []) {
        aretesLocales.add(arete);
      }
    }
  }
  for (const i of aretesLocales) {
    const points = pointsArete(graphe, i);
    let reste = 0;
    for (let k = 1; k < points.length; k++) {
      const [ax, ay] = points[k - 1];
      const [bx, by] = points[k];
      const segment = distanceKm(ax, ay, bx, by);
      if (!segment) continue;
      let pos = reste;
      while (pos <= segment) {
        const t = pos / segment;
        const lng = ax + t * (bx - ax);
        const lat = ay + t * (by - ay);
        const deplacement = distanceKm(barrage.lng, barrage.lat, lng, lat);
        if (deplacement >= 1 && deplacement <= DEPLACEMENT_MAX_KM) {
          const cle = `${lng.toFixed(5)}|${lat.toFixed(5)}`;
          if (coordonneesVues.has(cle)) {
            pos += pas;
            continue;
          }
          coordonneesVues.add(cle);
          if (!dansZone || dansZone([lng, lat])) {
            candidats.push({ lng, lat, route: refArete(graphe, i), deplacement });
          }
        }
        pos += pas;
      }
      reste = pos - segment;
    }
  }
  return candidats.sort((a, b) => a.deplacement - b.deplacement ||
    Number(b.route === barrage.route) - Number(a.route === barrage.route)).slice(0, dansZone ? MAX_CANDIDATS_ZONE : MAX_CANDIDATS);
}

function construireIndexGeo(barrages) {
  const cellules = new Map();
  barrages.forEach((b, i) => {
    const x = Math.floor(b.lng / PAS_INDEX_GEO);
    const y = Math.floor(b.lat / PAS_INDEX_GEO);
    const cle = `${x}|${y}`;
    if (!cellules.has(cle)) cellules.set(cle, []);
    cellules.get(cle).push(i);
  });
  return cellules;
}

function indicesProches(cellules, lng, lat, seuil = SEUIL_DISTANCE_AUTO_KM) {
  const cosLat = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const rayonX = Math.ceil(seuil / (PAS_INDEX_GEO * 111 * cosLat)) + 1;
  const rayonY = Math.ceil(seuil / (PAS_INDEX_GEO * 111)) + 1;
  const centreX = Math.floor(lng / PAS_INDEX_GEO);
  const centreY = Math.floor(lat / PAS_INDEX_GEO);
  const resultat = [];
  for (let dx = -rayonX; dx <= rayonX; dx++) {
    for (let dy = -rayonY; dy <= rayonY; dy++) {
      resultat.push(...(cellules.get(`${centreX + dx}|${centreY + dy}`) ?? []));
    }
  }
  return resultat;
}

/**
 * `obstacles` (facultatif) : des postes FIXES hors de l'état simulé — ceux de
 * l'espace adjacent (voir `resoudreAvecEspaceAdjacent`). Une position doit
 * tenir le seuil contre eux aussi ; ils ne sont jamais déplacés ni comptés.
 */
function resoudrePosition(index, barrages, indexGeo, graphe, garderPosition, cache, candidatsMemo, outils, dansZone, obstacles = null) {
  const barrage = barrages[index];
  const cleCandidats = `${barrage.id}|${barrage.lng}|${barrage.lat}`;
  let candidats = candidatsMemo.get(cleCandidats);
  if (!candidatsMemo.has(cleCandidats)) {
    candidats = candidatsLocaux(graphe, barrage, dansZone);
    candidatsMemo.set(cleCandidats, candidats);
    outils.mesures.candidats += candidats.length;
  }
  for (const c of candidats) {
    const r = outils.recaler(c);
    /* Le recalage complet en troisième argument : route et PK de la position. */
    if (!r || !garderPosition(barrage, [r.recale.lng, r.recale.lat], r.recale)) continue;
    const { recale, snap: snapCandidat } = r;
    /* Voisins du plus proche au plus éloigné : le premier conflit suffit à
       écarter le candidat, et c'est le plus proche qui a le plus de chances
       d'en être un. L'ordre ne change pas le verdict, seulement le nombre
       d'A* nécessaires pour l'atteindre. */
    const voisins = [];
    for (const j of indicesProches(indexGeo, recale.lng, recale.lat, outils.seuil)) {
      if (j === index) continue;
      const autre = barrages[j];
      if (!partagentFaction(barrage, autre)) continue;
      const vol = distanceKm(recale.lng, recale.lat, autre.lng, autre.lat);
      if (vol >= outils.seuil) continue;
      voisins.push([vol, j]);
    }
    voisins.sort((x, y) => x[0] - y[0]);
    let valide = true;
    for (const [, j] of voisins) {
      const autre = barrages[j];
      outils.mesures.controlesConflit++;
      const cle = clePairePosition({ ...barrage, lng: recale.lng, lat: recale.lat }, autre);
      let km = cache.get(cle);
      if (km === undefined) {
        km = outils.versPoste(snapCandidat, autre);
        cache.set(cle, km);
      }
      if (km != null && km < outils.seuil) {
        valide = false;
        break;
      }
    }
    if (!valide) continue;
    if (obstacles?.length) {
      for (const autre of obstacles) {
        if (autre.id === barrage.id) continue;
        if (!partagentFaction(barrage, autre)) continue;
        if (distanceKm(recale.lng, recale.lat, autre.lng, autre.lat) >= outils.seuil) continue;
        outils.mesures.controlesConflit++;
        const cle = clePairePosition({ ...barrage, lng: recale.lng, lat: recale.lat }, autre);
        let km = cache.get(cle);
        if (km === undefined) {
          km = outils.versPoste(snapCandidat, autre);
          cache.set(cle, km);
        }
        if (km != null && km < outils.seuil) { valide = false; break; }
      }
      if (!valide) continue;
    }
    /* La position courante en conflit est le seul conflit qu'une proposition
       peut supprimer; le contrôle global suivant couvre aussi les effets en chaîne. */
    return { ...recale, lng: +recale.lng.toFixed(5), lat: +recale.lat.toFixed(5) };
  }
  return null;
}

/** Simulation en cascade, sans aucune mutation des données fournies. */
/**
 * ESPACE ADJACENT — la zone d'abord, puis, SEULEMENT si elle n'offre aucune
 * position valide, une bande locale juste au-delà de sa limite.
 *
 * `espaceAdjacent` est fourni par l'appelant, qui seul connaît le RBAC :
 *   dansZone(pt, barrage)      la bande autorisée (périmètre du compte, à
 *                              faible distance de la zone et du poste) ;
 *   garderPosition(barrage,pt) la même règle, revérifiée après recalage ;
 *   obstacles                  les postes de la même faction qui s'y trouvent
 *                              (plus les Intouchables), FIXES.
 * Le moteur ne cherche jamais au-delà : ni territoire élargi, ni pays entier.
 */
function resoudreAvecEspaceAdjacent(index, etat, indexGeo, graphe, garderPosition, cache, candidatsMemo, outils, dansZone, espaceAdjacent, candidatsAdjacentsMemo) {
  const p = resoudrePosition(index, etat, indexGeo, graphe, garderPosition, cache, candidatsMemo, outils, dansZone);
  if (p) return { ...p, espace: 'zone' };
  if (!espaceAdjacent || !dansZone) return null;
  const barrage = etat[index];
  const q = resoudrePosition(
    index, etat, indexGeo, graphe, espaceAdjacent.garderPosition, cache, candidatsAdjacentsMemo, outils,
    (pt) => espaceAdjacent.dansZone(pt, barrage), espaceAdjacent.obstacles ?? null,
  );
  return q ? { ...q, espace: 'adjacent' } : null;
}

export function analyserOptimisationDistance(barrages, graphe, {
  garderPosition = () => true, dansZone = null, maxIterations = MAX_TOURS,
  /* Le seuil de distance — celui de l'automatique par défaut. */
  seuilKm = SEUIL_DISTANCE_AUTO_KM,
  /* Réexamen des conflits sans solution après un déplacement — toujours actif ;
     désactivable pour les seules épreuves qui mesurent ce qu'il apporte. */
  reexamen = true,
  /* Repli local au-delà de la zone — voir `resoudreAvecEspaceAdjacent`. */
  espaceAdjacent = null,
  /* Identifiants des postes FIXES le temps de ce calcul : ils comptent dans
     les conflits, comme un Intouchable, mais ne sont jamais déplacés. Sert à
     l'optimisation par route : les barrages des autres routes ne bougent pas,
     et aucune position proposée ne peut entrer en conflit avec eux. */
  fixes = null,
} = {}) {
  const immobile = (b) => estIntouchable(b) || Boolean(fixes?.has(b?.id));
  const debut = performance.now();
  const candidatsAdjacentsMemo = new Map();
  const outils = creerOutils(graphe, seuilKm);
  const etat = barrages.map((b) => ({ ...b }));
  const avant = new Map(etat.map((b) => [b.id, {
    lng: b.lng, lat: b.lat, route: b.route || '', factionId: b.factionId || '',
    contraintes: detailsContraintes(b),
  }]));
  const mouvements = new Map();
  const sansSolution = new Map();
  const distancesMemo = new Map();
  const candidatsMemo = new Map();
  const echecsDeplacement = new Map();
  let generationPositions = 0;
  let tours = 0;
  let passes = 1;
  /** Le déroulé de la simulation : un pas par déplacement retenu. */
  const journal = [];
  /* Les positions ne changent qu'à un déplacement : l'index n'est reconstruit
     qu'à ce moment-là, et non à chaque barrage examiné. */
  let indexGeo = construireIndexGeo(etat);
  let courants = conflits(etat, outils, distancesMemo);
  const conflitsInitiaux = courants.map((c) => ({ ...c }));

  /**
   * LE NOMBRE EXACT DE CONFLITS DE L'ÉTAT SIMULÉ COURANT — pour le journal.
   * Toutes les paires sous le seuil à vol d'oiseau ont déjà leur distance
   * routière en mémoire (état initial, puis chaque déplacement) : ce compte ne
   * relance aucun itinéraire.
   */
  const compterConflits = () => {
    let n = 0;
    for (let i = 0; i < etat.length; i++) {
      for (let j = i + 1; j < etat.length; j++) {
        const x = etat[i];
        const y = etat[j];
        if (!partagentFaction(x, y)) continue;
        if (distanceKm(x.lng, x.lat, y.lng, y.lat) >= outils.seuil) continue;
        const cle = clePairePosition(x, y);
        let km = distancesMemo.get(cle);
        if (km === undefined) {
          km = outils.sousSeuil([x.lng, x.lat], [y.lng, y.lat]);
          distancesMemo.set(cle, km);
        }
        if (km != null && km < outils.seuil) n++;
      }
    }
    return n;
  };

  /* LA SIMULATION EN CASCADE. Une passe traite les conflits du plus serré au
     plus lâche ; chaque déplacement met à jour l'état simulé, puis remesure le
     poste déplacé contre tout le périmètre. En fin de passe, un conflit déclaré
     sans solution est RÉEXAMINÉ si un déplacement a eu lieu depuis : l'état
     n'est plus le même, un poste qui bloquait a pu partir. On s'arrête quand
     plus rien ne bouge — plus de conflit, ou plus aucune solution valide.
     Chaque déplacement laisse son poste sans aucun conflit : le nombre de
     conflits décroît strictement, la simulation se termine donc toujours. */
  for (;;) {
  while (courants.length && tours++ < maxIterations) {
    const conflit = courants[0];
    const a = etat[conflit.a];
    const b = etat[conflit.b];
    const aIntouchable = immobile(a);
    const bIntouchable = immobile(b);
    const candidats = aIntouchable && bIntouchable
      ? []
      : aIntouchable ? [conflit.b]
        : bIntouchable ? [conflit.a]
          : [conflit.a, conflit.b].sort((x, y) => contraintes(etat[x]) - contraintes(etat[y]));

    let index = null;
    let position = null;
    for (const possible of candidatosUnicos(candidats)) {
      if (immobile(etat[possible])) continue;
      if (echecsDeplacement.get(etat[possible].id) === generationPositions) continue;
      const trouvee = resoudreAvecEspaceAdjacent(
        possible, etat, indexGeo, graphe, garderPosition, distancesMemo, candidatsMemo, outils, dansZone, espaceAdjacent, candidatsAdjacentsMemo,
      );
      if (trouvee) { index = possible; position = trouvee; break; }
      echecsDeplacement.set(etat[possible].id, generationPositions);
    }
    if (index == null) {
      const key = `${a.id}|${b.id}`;
      sansSolution.set(key, {
        a: a.id, b: b.id, km: conflit.km, raison: 'aucune position routière valide dans le territoire',
        /* Pour le réexamen : à quel état simulé ce verdict se rapporte. */
        ia: conflit.a, ib: conflit.b, generation: generationPositions,
        entreIntouchables: aIntouchable && bIntouchable,
      });
      courants = courants.filter((c) => c !== conflit);
      continue;
    }
    const conflitsAvantPas = compterConflits();

    const cible = etat[index];
    const original = avant.get(cible.id);
    const lienAvant = { id: (index === conflit.a ? b : a).id, km: conflit.km };
    cible.lng = position.lng;
    cible.lat = position.lat;
    cible.route = position.route || cible.route;
    cible.pk = position.pk ?? null;
    generationPositions++;
    const distanceApresKm = outils.minKm(
      [cible.lng, cible.lat], [etat[index === conflit.a ? conflit.b : conflit.a].lng, etat[index === conflit.a ? conflit.b : conflit.a].lat]);
    const mouvementPrecedent = mouvements.get(cible.id);
    mouvements.set(cible.id, {
      id: cible.id, avant: original,
      apres: { lng: cible.lng, lat: cible.lat, route: cible.route, pk: cible.pk, factionId: cible.factionId || '' },
      conflitAvant: mouvementPrecedent?.conflitAvant ?? lienAvant,
      distanceApresKm, contraintes: contraintes(cible),
      /* 'zone' ou 'adjacent' : où la position a été trouvée. Le dernier pas
         d'un poste fait foi (un second déplacement peut revenir en zone). */
      espace: position.espace ?? 'zone',
      detailsContraintes: detailsContraintes(cible),
    });
    /* Une seule position a changé. Les distances entre toutes les autres
       paires restent mathématiquement identiques ; on conserve leurs résultats
       et recalcule les distances du barrage déplacé avec tout le périmètre.
       C'est une revalidation globale exacte sans recalculer 600×599 paires à
       chaque tour. */
    const recalcules = courants.filter((c) => c.a !== index && c.b !== index);
    indexGeo = construireIndexGeo(etat);
    for (const autreIndex of indicesProches(indexGeo, etat[index].lng, etat[index].lat, outils.seuil)) {
      if (autreIndex === index) continue;
      const x = etat[index];
      const y = etat[autreIndex];
      if (distanceKm(x.lng, x.lat, y.lng, y.lat) >= outils.seuil) continue;
      outils.mesures.controlesConflit++;
      const cle = clePairePosition(x, y);
      let km = distancesMemo.get(cle);
      if (km === undefined) {
        km = outils.sousSeuil([x.lng, x.lat], [y.lng, y.lat]);
        distancesMemo.set(cle, km);
      }
      if (km != null && km < outils.seuil &&
          !sansSolution.has(`${x.id}|${y.id}`) && !sansSolution.has(`${y.id}|${x.id}`)) {
        recalcules.push({ a: Math.min(index, autreIndex), b: Math.max(index, autreIndex), km });
      }
    }
    courants = recalcules.sort((x, y) => x.km - y.km);
    journal.push({
      pas: journal.length + 1,
      iteration: tours,
      passe: passes,
      id: cible.id,
      nom: cible.nom || cible.id,
      conflitAvec: { id: lienAvant.id, nom: etat.find((x) => x.id === lienAvant.id)?.nom || lienAvant.id, km: conflit.km },
      apres: { lng: cible.lng, lat: cible.lat, route: cible.route },
      espace: position.espace ?? 'zone',
      distanceApresKm,
      conflitsAvant: conflitsAvantPas,
      conflitsApres: compterConflits(),
    });
  }
    if (tours >= maxIterations || !reexamen) break;
    const aReexaminer = [...sansSolution.entries()]
      .filter(([, x]) => !x.entreIntouchables && x.generation < generationPositions);
    if (!aReexaminer.length) break;
    passes++;
    for (const [cle, x] of aReexaminer) {
      sansSolution.delete(cle);
      const p = etat[x.ia];
      const q = etat[x.ib];
      const clePaire = clePairePosition(p, q);
      let km = distancesMemo.get(clePaire);
      if (km === undefined) {
        km = outils.sousSeuil([p.lng, p.lat], [q.lng, q.lat]);
        distancesMemo.set(clePaire, km);
      }
      /* Un des deux a pu bouger entre-temps : le conflit n'existe plus. */
      if (km != null && km < outils.seuil) courants.push({ a: x.ia, b: x.ib, km });
    }
    courants.sort((x, y) => x.km - y.km);
  }

  const conflitFinaux = conflits(etat, outils, distancesMemo);
  for (const c of conflitFinaux) {
    const a = etat[c.a].id;
    const b = etat[c.b].id;
    const cle = `${a}|${b}`;
    if (!sansSolution.has(cle) && !sansSolution.has(`${b}|${a}`)) {
      sansSolution.set(cle, { a, b, km: c.km, raison: 'conflit restant après la limite de calcul' });
    }
  }
  /** Le plus court des deux sens entre deux postes, avec sa géométrie. */
  const itineraireRoutier = (a, b) => (a && b
    ? tracerEntrePostes(graphe, a, b, outils.accroche(a.lng, a.lat, 5), outils.accroche(b.lng, b.lat, 5))
    : null);
  /* LES CONFLITS RESTANTS TRACÉS : pour chaque barrage analysé encore en
     conflit, son conflit le plus serré — un tracé par poste, pas une toile. Les
     autres sont comptés, pas dessinés. Au-delà de MAX_TRACES_RESTANTS postes
     (vue nationale), rien n'est tracé. */
  const plusSerre = new Map();
  for (const c of conflitFinaux) {
    for (const i of [c.a, c.b]) {
      if (immobile(etat[i])) continue;
      if (!plusSerre.has(i) || c.km < plusSerre.get(i).km) plusSerre.set(i, c);
    }
  }
  const aTracer = new Set(plusSerre.size <= MAX_TRACES_RESTANTS ? plusSerre.values() : []);
  const propositions = [...mouvements.values()].map((m) => {
    const item = barrages.find((b) => b.id === m.id);
    const voisinAvant = barrages.find((b) => b.id === m.conflitAvant.id);
    const voisinApres = etat.find((b) => b.id === m.conflitAvant.id);
    const apresConflits = conflitFinaux.filter((c) => etat[c.a].id === m.id || etat[c.b].id === m.id);
    const trace = (a, b) => itineraireRoutier(a, b)?.trace ?? null;
    const final = etat.find((b) => b.id === m.id);
    return {
      ...m, nom: item?.nom || m.id, type: item?.type,
      bt: item?.bt ?? null, cie: item?.cie ?? null, reg: item?.reg ?? null,
      lng: item?.lng, lat: item?.lat, route: item?.route,
      factionId: item?.factionId || '', action: 'deplacer',
      raisons: [
        `Conflit routier initial avec ${voisinAvant?.nom || voisinAvant?.id} : ${m.conflitAvant.km.toFixed(1)} km`,
        m.detailsContraintes.length ? `Contraintes conservées : ${m.detailsContraintes.join(', ')}` : 'Aucune contrainte opérationnelle recensée',
        `Position proposée sur ${m.apres.route || 'une route du réseau'}`,
        `Faction conservée : ${m.apres.factionId || 'non renseignée'}`,
      ],
      raison: 'Déplacement routier validé sans nouveau conflit',
      conflit: {
        id: voisinAvant?.id, nom: voisinAvant?.nom, km: m.conflitAvant.km,
        lng: voisinAvant?.lng, lat: voisinAvant?.lat,
        intouchable: estIntouchable(voisinAvant), trace: trace(item, voisinAvant),
        /* LE SECOND BARRAGE DU CONFLIT, dans l'état FINAL de la simulation :
           il reste le plus souvent à sa place, mais la cascade a pu le
           déplacer lui aussi — la carte doit le dire, pas le supposer. */
        deplaceAussi: mouvements.has(voisinAvant?.id),
        apres: voisinApres ? { lng: voisinApres.lng, lat: voisinApres.lat, route: voisinApres.route || '' } : null,
      },
      /* LA DISTANCE APRÈS, mesurée dans l'état FINAL — la même paire de
         positions que `routeApres`. Mesurée au moment du déplacement, elle
         pouvait dire autre chose que le tracé si le voisin a bougé ensuite. */
      distanceApresKm: final && voisinApres
        ? outils.minKm([final.lng, final.lat], [voisinApres.lng, voisinApres.lat])
        : m.distanceApresKm,
      /* LE DÉPLACEMENT PAR LA ROUTE — de l'ancienne à la nouvelle position, sur
         le même graphe hors ligne. Affichage seulement : il ne décide de rien. */
      routeDeplacement: itineraireRoutier(item, final),
      routeApres: trace(final, voisinApres),
      conflitsApres: apresConflits.map((c) => ({ a: etat[c.a].id, b: etat[c.b].id, km: c.km })),
      statut: apresConflits.length ? 'conflit' : 'resolu',
    };
  });
  return {
    mode: 'AUTOMATIQUE', critere: 'distance_routiere', seuilKm: outils.seuil,
    resume: {
      barragesAnalyses: etat.length, conflitsAvant: conflitsInitiaux.length,
      conflitsApres: conflitFinaux.length, conflitsResolus: conflitsInitiaux.length - conflitFinaux.length,
      deplacements: propositions.length, sansSolution: sansSolution.size,
      interrompue: tours >= maxIterations && courants.length > 0,
      conflitsNonExamines: tours >= maxIterations ? courants.length : 0,
      iterations: tours,
      passes,
      /* Paires de deux Intouchables : comptées dans les conflits (la règle
         vaut pour eux aussi), mais aucune proposition ne peut les résoudre. */
      conflitsEntreIntouchables: conflitsInitiaux.filter(
        (c) => estIntouchable(etat[c.a]) && estIntouchable(etat[c.b]),
      ).length,
    },
    propositions,
    conflitsSansSolution: [...sansSolution.values()].map(({ a, b, km, raison }) => ({ a, b, km, raison })),
    conflitsInitiaux: conflitsInitiaux.map((c) => ({ a: etat[c.a].id, b: etat[c.b].id, km: c.km })),
    /* Tracés des conflits restants : seulement pour un périmètre restreint,
       où la carte peut les montrer sans devenir illisible. */
    journal,
    conflitsRestants: conflitFinaux.map((c) => ({
      entreIntouchables: estIntouchable(etat[c.a]) && estIntouchable(etat[c.b]),
      a: { id: etat[c.a].id, nom: etat[c.a].nom, lng: etat[c.a].lng, lat: etat[c.a].lat, intouchable: estIntouchable(etat[c.a]) },
      b: { id: etat[c.b].id, nom: etat[c.b].nom, lng: etat[c.b].lng, lat: etat[c.b].lat, intouchable: estIntouchable(etat[c.b]) },
      km: c.km,
      trace: aTracer.has(c) ? itineraireRoutier(etat[c.a], etat[c.b])?.trace ?? null : null,
    })),
    /* Ce que le calcul a coûté — relu par les épreuves et le journal serveur. */
    mesures: {
      barrages: etat.length,
      intouchables: etat.filter(estIntouchable).length,
      ...outils.mesures,
      iterations: tours,
      passes,
      deplacementsSimules: generationPositions,
      dureeMs: Math.round(performance.now() - debut),
    },
  };
}

function* candidatosUnicos(indices) { yield* [...new Set(indices)]; }

/**
 * UN DÉPLACEMENT POUR UN SEUL BARRAGE — la même recherche que la cascade.
 *
 * Sert à la décision « Déplacer » de l'optimisation manuelle : le barrage
 * `id` cherche une position routière valide, au seuil demandé, contre tous
 * les autres postes de `barrages` (l'état simulé courant), par
 * `resoudrePosition` — mêmes candidats, mêmes contrôles, mêmes arbres routiers.
 * Aucune donnée n'est modifiée.
 *
 * @returns {{position, routeDeplacement}|null} `null` si aucune position ne tient.
 */
export function proposerDeplacement(barrages, graphe, id, {
  seuilKm = SEUIL_DISTANCE_AUTO_KM, garderPosition = () => true, dansZone = null, espaceAdjacent = null,
} = {}) {
  const index = barrages.findIndex((b) => b.id === id);
  if (index < 0 || estIntouchable(barrages[index])) return null;
  const outils = creerOutils(graphe, seuilKm);
  const position = resoudreAvecEspaceAdjacent(
    index, barrages, construireIndexGeo(barrages), graphe, garderPosition, new Map(), new Map(), outils, dansZone,
    espaceAdjacent, new Map(),
  );
  if (!position) return null;
  const avant = barrages[index];
  return {
    position,
    espace: position.espace,
    routeDeplacement: tracerEntrePostes(
      graphe, avant, position, outils.accroche(avant.lng, avant.lat, 5), outils.accroche(position.lng, position.lat, 5),
    ),
  };
}
