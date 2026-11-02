/**
 * Optimisation des barrages — moteur d'analyse, sans DOM ni MapLibre (testé, exécuté dans
 * optimisation-worker.js et réutilisé par le tableau).
 *
 * Ce que le moteur fait :
 *   - repère des doublons possibles (même identifiant, même position, même signature) et des
 *     quasi-doublons (distance géodésique ≤ seuil réglable, mêmes champs comparés) ;
 *   - contrôle chaque enregistrement avec les règles de la carte (barages.js : validerBarage,
 *     hiérarchie REG → CIE → BT, emprise du Royaume, route) ;
 *   - propose une correction seulement quand elle découle des données (type intouchable →
 *     faction « continu », coordonnée écrite en texte → nombre, point accroché à la route la plus
 *     proche dans sa brigade). Jamais d'identifiant, de classification simulée / réelle ni de
 *     rattachement inventés : ces cas restent « à vérifier », avec les indices disponibles.
 *
 * Ce que le moteur ne fait jamais : supprimer, fusionner, déplacer ou modifier un barage. Les
 * corrections approuvées passent par planifierApplication puis appliquerAuxEditions, qui
 * écrivent dans la surcouche locale (comme l'édition de la carte), annulable avec annulerEntree.
 */
import {
  CONTINU, CRENEAUX, RAYON_ACCROCHE_M, TOLERANCE_ROUTE_M, TYPES_BARAGE, accrocherARoute, estProtege, validerBarage,
} from './barages.js';
import { EMPRISE_TUILES } from './emprise.js';
import { circonscriptionEn } from './competence.js';
import { distanceMetres, emprise as empriseAutour, METRES_PAR_DEGRE } from './mesure.js';
import { normaliser } from './recherche.js';

// ── Règles ─────────────────────────────────────────────────────────────────

/** Champs comparables entre deux barages (fiables dans le format de données). */
export const CHAMPS_COMPARABLES = Object.freeze(['type', 'shift', 'btId', 'route', 'name']);
export const SEVERITES = Object.freeze(['info', 'avertissement', 'erreur']);

export const REGLES_DEFAUT = Object.freeze({
  doublonsExacts: true,
  quasiDoublons: true,
  seuilProximiteM: 30,
  champsComparaison: Object.freeze(['type', 'shift', 'btId', 'route']),
  exigerMemeBrigade: true,
  verifierCoordonnees: true,
  verifierMetadonnees: true,
  verifierRelations: true,
  verifierRoutes: false,
  toleranceRouteM: TOLERANCE_ROUTE_M,
  perimetre: Object.freeze({ origine: 'toutes', reg: '', cie: '', bt: '' }),
  severiteMin: 'info',
  inclureAjoutsLocaux: true,
  controleAjouts: false,
});

/** Descriptions des règles (affichées dans « Règles d'optimisation »). */
export const DESCRIPTIONS_REGLES = Object.freeze({
  doublonsExacts: 'Doublons exacts : même identifiant, même position (au 1e-5°, ≈ 1 m) ou même signature (position, type, faction, brigade).',
  quasiDoublons: 'Quasi-doublons : deux barages de même origine à moins du seuil de proximité.',
  seuilProximiteM: 'Seuil de proximité des quasi-doublons, en mètres (1 à 2 000). Aucune valeur ne vaut pour tous les jeux : à adapter.',
  champsComparaison: 'Champs comparés entre deux barages proches (ils fondent le degré de confiance).',
  exigerMemeBrigade: 'Ne rapprocher que deux barages de la même brigade (BT).',
  verifierCoordonnees: 'Coordonnées : présentes, numériques, finies, dans l\'emprise du Royaume.',
  verifierMetadonnees: 'Métadonnées : identifiant, type, faction, marqueur simulé / réel, nom, selon le format des barages.',
  verifierRelations: 'Relations : brigade existante, position dans sa brigade, compagnie résolue.',
  verifierRoutes: 'Routes : chaque barage sur une route carrossable (lecture des tuiles, plus long).',
  toleranceRouteM: 'Écart toléré entre un barage et la route, en mètres (1 à 50).',
  perimetre: 'Périmètre : origine (simulés, réels ou les deux, jamais mêlés) et unité administrative.',
  severiteMin: 'Gravité minimale des constats affichés.',
  inclureAjoutsLocaux: 'Inclure les barages ajoutés dans ce navigateur.',
  controleAjouts: 'Contrôler chaque nouveau barage à sa pose (doublons proches, champs).',
});

/**
 * Règles validées. Une valeur hors limites ou d'un mauvais type est signalée, jamais corrigée
 * en silence : `erreurs` non vide ⇒ ne pas enregistrer.
 * @returns {{ regles: object, erreurs: string[] }}
 */
export function validerRegles(brut = {}) {
  const r = { ...REGLES_DEFAUT, ...brut, perimetre: { ...REGLES_DEFAUT.perimetre, ...(brut.perimetre ?? {}) } };
  const erreurs = [];
  for (const cle of ['doublonsExacts', 'quasiDoublons', 'exigerMemeBrigade', 'verifierCoordonnees', 'verifierMetadonnees', 'verifierRelations', 'verifierRoutes', 'inclureAjoutsLocaux', 'controleAjouts']) {
    if (typeof r[cle] !== 'boolean') erreurs.push(`${cle} : vrai ou faux attendu`);
  }
  if (!Number.isInteger(r.seuilProximiteM) || r.seuilProximiteM < 1 || r.seuilProximiteM > 2000) erreurs.push('seuil de proximité : entier de 1 à 2 000 m');
  if (!Number.isFinite(r.toleranceRouteM) || r.toleranceRouteM < 1 || r.toleranceRouteM > 50) erreurs.push('tolérance de route : 1 à 50 m');
  if (!Array.isArray(r.champsComparaison) || r.champsComparaison.some((c) => !CHAMPS_COMPARABLES.includes(c))) erreurs.push('champs comparés inconnus');
  else r.champsComparaison = [...new Set(r.champsComparaison)];
  if (!['toutes', 'simulation', 'reelle'].includes(r.perimetre.origine)) erreurs.push('origine : toutes, simulation ou reelle');
  for (const cle of ['reg', 'cie', 'bt']) if (typeof r.perimetre[cle] !== 'string') erreurs.push(`périmètre ${cle} : texte attendu`);
  if (!SEVERITES.includes(r.severiteMin)) erreurs.push('gravité minimale inconnue');
  return { regles: r, erreurs };
}

// ── Outils ─────────────────────────────────────────────────────────────────

const [[OUEST, SUD], [EST, NORD]] = EMPRISE_TUILES;
const estObjet = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
export const origineDe = (b) => (b?.isSimulation === true ? 'sim' : b?.isSimulation === false ? 'reel' : 'inconnue');
const coordonneesValides = (b) => Number.isFinite(b?.latitude) && Number.isFinite(b?.longitude)
  && b.longitude >= OUEST && b.longitude <= EST && b.latitude >= SUD && b.latitude <= NORD;

/** Égalité de valeurs JSON, clés d'objet dans n'importe quel ordre. */
export function memeValeur(a, b) {
  const tri = (v) => (Array.isArray(v) ? v.map(tri) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, tri(v[k])])) : v);
  return JSON.stringify(tri(a)) === JSON.stringify(tri(b));
}

const cleRoute = (r) => (r && typeof r === 'object' ? `${normaliser(r.ref ?? '')}|${normaliser(r.nom ?? '')}` : '');
const valeurComparee = (b, champ) => (champ === 'route' ? cleRoute(b.route) || null : champ === 'name' ? normaliser(b.name ?? '') || null : b[champ] ?? null);

/** Unité administrative d'un barage (par sa brigade) : { regId, cieId, btId } ou des chaînes vides. */
function unite(b, hierarchie) {
  const bt = hierarchie?.brigades.get(b?.btId);
  return { regId: bt?.regId ?? '', cieId: bt?.cieId ?? '', btId: bt ? b.btId : '' };
}

/** L'enregistrement est-il dans le périmètre (origine et unité administrative) ? */
export function dansPerimetre(enr, regles, hierarchie) {
  const b = enr.barage;
  if (!regles.inclureAjoutsLocaux && enr.source === 'local') return false;
  const { origine, reg, cie, bt } = regles.perimetre;
  if (origine === 'simulation' && origineDe(b) !== 'sim') return false;
  if (origine === 'reelle' && origineDe(b) !== 'reel') return false;
  if (reg || cie || bt) {
    const u = unite(b, hierarchie);
    if ((reg && u.regId !== reg) || (cie && u.cieId !== cie) || (bt && u.btId !== bt)) return false;
  }
  return true;
}

// ── Constats ───────────────────────────────────────────────────────────────

/** Catégories (statistiques et filtres). */
export const CATEGORIES = Object.freeze({
  'doublon-exact': 'Doublon exact possible',
  'quasi-doublon': 'Quasi-doublon possible',
  coordonnees: 'Coordonnées',
  metadonnees: 'Métadonnées',
  classification: 'Simulé / réel',
  relation: 'Rattachement administratif',
  route: 'Route',
  coherence: 'Cohérence carte / données',
});

const cleEnr = (enr) => `${enr.source}#${enr.rang}`;
const idEnr = (enr) => (typeof enr.barage?.id === 'string' ? enr.barage.id : null);

function constat(code, categorie, severite, enrs, { champ = null, valeur, raison, preuves = {}, confiance = null, proposition = null, piste = null }) {
  return {
    id: `${code}:${enrs.map(cleEnr).join('+')}${champ ? `:${champ}` : ''}`,
    code, categorie, severite, confiance,
    enregistrements: enrs.map((e) => ({ cle: cleEnr(e), id: idEnr(e), source: e.source, origine: origineDe(e.barage) })),
    champ, valeur: valeur === undefined ? null : valeur, raison, preuves, piste,
    proposition,
  };
}

/** Proposition de correction : champs avant / après d'un seul barage, à approuver. */
function proposer(enr, changements, motif, consequences, confiance = 'moyenne') {
  return {
    cible: { id: idEnr(enr), source: enr.source },
    changements: changements.map(([champ, apres]) => ({ champ, avant: enr.barage[champ] ?? null, apres })),
    motif, consequences, confiance,
    reversible: true, // les valeurs d'origine sont gardées : voir annulerEntree
  };
}

/** Contrôles d'un enregistrement seul (coordonnées, métadonnées, relations). */
export function controlerEnregistrement(enr, contexte, regles) {
  const b = enr.barage;
  const sortie = [];
  if (!estObjet(b)) {
    return [constat('enregistrement-invalide', 'metadonnees', 'erreur', [enr], { valeur: b, raison: 'L\'entrée n\'est pas un enregistrement (objet attendu) : elle n\'apparaît pas sur la carte.' })];
  }
  // Coordonnées
  if (regles.verifierCoordonnees) {
    for (const champ of ['latitude', 'longitude']) {
      const v = b[champ];
      if (v === undefined || v === null || v === '') {
        sortie.push(constat('coord-manquante', 'coordonnees', 'erreur', [enr], { champ, valeur: v ?? null, raison: `${champ} absente : le barage n'a pas de position.` }));
      } else if (typeof v === 'string' && Number.isFinite(Number(v.replace(',', '.')))) {
        const n = Number(v.replace(',', '.'));
        sortie.push(constat('coord-texte', 'coordonnees', 'erreur', [enr], {
          champ, valeur: v, raison: `${champ} écrite en texte (« ${v} ») : la carte attend un nombre.`,
          proposition: proposer(enr, [[champ, n]], `La même valeur, écrite en nombre (${n}).`, ['Le barage pourra apparaître sur la carte si ses autres champs sont valides.'], 'haute'),
        }));
      } else if (typeof v !== 'number' || !Number.isFinite(v)) {
        sortie.push(constat('coord-invalide', 'coordonnees', 'erreur', [enr], { champ, valeur: v, raison: `${champ} n'est pas un nombre fini.` }));
      }
    }
    if (Number.isFinite(b.latitude) && Number.isFinite(b.longitude) && !coordonneesValides(b)) {
      sortie.push(constat('hors-emprise', 'coordonnees', 'erreur', [enr], {
        champ: 'latitude/longitude', valeur: [b.longitude, b.latitude],
        raison: `Position hors de l'emprise de la carte (longitude ${OUEST} à ${EST}, latitude ${SUD} à ${NORD}).`,
        piste: Math.abs(b.latitude) <= 20.5 && b.longitude >= SUD && b.longitude <= NORD ? 'Latitude et longitude semblent inversées : à vérifier dans la source.' : null,
      }));
    }
  }
  // Métadonnées
  if (regles.verifierMetadonnees) {
    if (typeof b.id !== 'string' || !b.id.trim()) {
      sortie.push(constat('id-manquant', 'metadonnees', 'erreur', [enr], { champ: 'id', valeur: b.id ?? null, raison: 'Identifiant absent : le barage ne peut pas être suivi ni corrigé.' }));
    } else if (!/^(SIM-BAR-\d{4,}|BAR-[A-Z0-9]+-[A-Z0-9]+)$/.test(b.id)) {
      sortie.push(constat('id-format', 'metadonnees', 'info', [enr], { champ: 'id', valeur: b.id, raison: 'Identifiant d\'un format inhabituel pour cette carte (SIM-BAR-nnnn ou BAR-…) : possible import, à vérifier.' }));
    }
    if (!TYPES_BARAGE.includes(b.type)) {
      sortie.push(constat('type-inconnu', 'metadonnees', 'erreur', [enr], { champ: 'type', valeur: b.type ?? null, raison: `Type absent ou inconnu (attendus : ${TYPES_BARAGE.join(', ')}). Aucune correction déduite.` }));
    } else if (b.type === 'fixe' && !CRENEAUX.includes(b.shift)) {
      sortie.push(constat('faction-fixe', 'metadonnees', 'erreur', [enr], { champ: 'shift', valeur: b.shift ?? null, raison: 'Barage fixe sans faction valide (00-06, 06-12, 12-18, 18-24). Aucune faction déduite : à choisir.' }));
    } else if (b.type === 'intouchable' && b.shift !== CONTINU) {
      sortie.push(constat('faction-intouchable', 'metadonnees', 'erreur', [enr], {
        champ: 'shift', valeur: b.shift ?? null,
        raison: 'Barage intouchable (24 h/24) affecté à une faction : un intouchable n\'en a pas.',
        piste: CRENEAUX.includes(b.shift) ? 'Ou bien le type est erroné (barage fixe de cette faction) : à vérifier dans la source.' : null,
        proposition: proposer(enr, [['shift', CONTINU]], 'La règle des intouchables : faction « continu ».', ['Le barage passera dans « Barages intouchables » ; il reste affiché quelle que soit la faction.']),
      }));
    }
    if (typeof b.isSimulation !== 'boolean') {
      sortie.push(constat('origine-absente', 'classification', 'erreur', [enr], { champ: 'isSimulation', valeur: b.isSimulation ?? null, raison: 'Marqueur simulé / réel absent : la carte ne l\'affiche pas. Il ne se déduit pas : à renseigner dans la source.' }));
    } else if (b.isSimulation === false && (contexte.simulationDeclaree || /^SIM-/.test(b.id ?? ''))) {
      sortie.push(constat('origine-incoherente', 'classification', 'avertissement', [enr], {
        champ: 'isSimulation', valeur: false,
        raison: contexte.simulationDeclaree ? 'Barage déclaré réel dans un jeu déclaré simulé.' : 'Identifiant de barage simulé (SIM-…) mais marqué réel.',
        piste: 'La classification n\'est jamais changée par l\'optimisation : à vérifier dans la source.',
      }));
    }
    if (b.name == null || b.name === '') sortie.push(constat('nom-absent', 'metadonnees', 'info', [enr], { champ: 'name', valeur: null, raison: 'Nom absent (facultatif) : la carte affiche l\'identifiant.' }));
    else if (typeof b.name !== 'string') sortie.push(constat('nom-invalide', 'metadonnees', 'avertissement', [enr], { champ: 'name', valeur: b.name, raison: 'Nom qui n\'est pas du texte.' }));
    if (b.validation != null && !estObjet(b.validation)) sortie.push(constat('trace-invalide', 'metadonnees', 'avertissement', [enr], { champ: 'validation', valeur: b.validation, raison: 'Trace de validation illisible.' }));
  }
  // Relations
  if (regles.verifierRelations) {
    const { hierarchie, circosBt } = contexte;
    const p = coordonneesValides(b) ? [b.longitude, b.latitude] : null;
    const contenant = p ? circonscriptionEn(circosBt, p) : null;
    const indice = contenant ? `Sa position est dans la circonscription de BT ${contenant.nom} (${contenant.id}).` : null;
    if (typeof b.btId !== 'string' || !b.btId) {
      sortie.push(constat('bt-absente', 'relation', 'erreur', [enr], { champ: 'btId', valeur: b.btId ?? null, raison: 'Brigade (btId) absente.', piste: indice ? `${indice} Le rattachement se corrige dans la source.` : null }));
    } else if (!hierarchie.brigades.has(b.btId)) {
      sortie.push(constat('bt-inconnue', 'relation', 'erreur', [enr], { champ: 'btId', valeur: b.btId, raison: `Brigade ${b.btId} absente des circonscriptions importées.`, piste: indice ? `${indice} Le rattachement se corrige dans la source.` : null }));
    } else if (p) {
      const sienne = circosBt.find((c) => c.proprietes.id === b.btId);
      if (sienne && circonscriptionEn([sienne], p) === null) {
        sortie.push(constat('hors-brigade', 'relation', 'avertissement', [enr], {
          champ: 'btId', valeur: b.btId, raison: `La position n'est pas dans la circonscription de sa brigade (${hierarchie.brigades.get(b.btId).nom}).`,
          preuves: { brigadeContenant: contenant ? `${contenant.nom} (${contenant.id})` : 'aucune' },
          piste: 'Position ou rattachement à vérifier ; aucun des deux n\'est changé automatiquement.',
        }));
      }
    }
  }
  if (regles.verifierRoutes === false && regles.verifierCoordonnees && coordonneesValides(b) && !estObjet(b.route)) {
    sortie.push(constat('route-non-verifiee', 'route', 'info', [enr], { champ: 'route', valeur: null, raison: 'Aucune association routière enregistrée : non vérifié (activez « Routes » dans les règles pour contrôler).' }));
  }
  return sortie;
}

/** Doublons exacts : même identifiant, même position, même signature (jamais sur le seul nom). */
export function doublonsExacts(enrs) {
  const sortie = [];
  // Même identifiant : contraire au format (identifiants uniques) ; signalé même entre simulé et réel.
  const parId = new Map();
  for (const e of enrs) if (idEnr(e)) parId.set(idEnr(e), [...(parId.get(idEnr(e)) ?? []), e]);
  for (const [id, groupe] of parId) {
    if (groupe.length < 2) continue;
    const mixte = new Set(groupe.map((e) => origineDe(e.barage))).size > 1;
    sortie.push(constat('id-double', 'doublon-exact', 'erreur', groupe, {
      champ: 'id', valeur: id, confiance: 'haute',
      raison: `${groupe.length} enregistrements portent l'identifiant ${id}, qui doit être unique : la carte n'en garde qu'un.${mixte ? ' Ils ne sont pas tous de la même origine (simulé / réel).' : ''}`,
      preuves: { champsIdentiques: ['id'] },
    }));
  }
  // Même position (au 1e-5°, la précision du format), dans une même origine.
  const parPosition = new Map();
  for (const e of enrs) {
    if (!coordonneesValides(e.barage)) continue;
    const cle = `${origineDe(e.barage)}|${e.barage.latitude.toFixed(5)},${e.barage.longitude.toFixed(5)}`;
    parPosition.set(cle, [...(parPosition.get(cle) ?? []), e]);
  }
  for (const groupe of parPosition.values()) {
    const distincts = groupe.filter((e, i) => groupe.findIndex((x) => idEnr(x) === idEnr(e)) === i);
    if (distincts.length < 2) continue; // même identifiant : déjà signalé
    const signature = (b) => JSON.stringify([b.type, b.shift, b.btId]);
    const memeSignature = distincts.every((e) => signature(e.barage) === signature(distincts[0].barage));
    const identiques = ['latitude', 'longitude', ...['type', 'shift', 'btId', 'route', 'name'].filter((c) => distincts.every((e) => memeValeur(valeurComparee(e.barage, c), valeurComparee(distincts[0].barage, c))))];
    sortie.push(constat(memeSignature ? 'signature-identique' : 'meme-position', 'doublon-exact', memeSignature ? 'erreur' : 'avertissement', distincts, {
      champ: 'latitude/longitude', valeur: [distincts[0].barage.longitude, distincts[0].barage.latitude],
      confiance: memeSignature ? 'haute' : 'moyenne',
      raison: memeSignature
        ? `${distincts.length} barages identiques par la position, le type, la faction et la brigade, sous des identifiants différents.`
        : `${distincts.length} barages à la même position (au mètre près) mais qui diffèrent par d'autres champs.`,
      preuves: { distanceM: 0, champsIdentiques: identiques },
    }));
  }
  return sortie;
}

/**
 * Quasi-doublons : paires de même origine à moins de `seuilProximiteM` (distance géodésique),
 * cherchées dans une grille (pas de comparaison de toutes les paires). Confiance d'après la
 * distance et les champs comparés ; jamais une preuve.
 */
export function quasiDoublons(enrs, regles, { dejaSignales = new Set() } = {}) {
  const seuil = regles.seuilProximiteM;
  const champs = regles.champsComparaison;
  const pasLat = seuil / METRES_PAR_DEGRE;
  const pasLon = pasLat / Math.cos((37 * Math.PI) / 180); // cellules assez larges pour toute la latitude du Royaume
  const grille = new Map();
  const valides = enrs.filter((e) => coordonneesValides(e.barage) && idEnr(e));
  for (const e of valides) {
    const k = `${Math.floor(e.barage.latitude / pasLat)},${Math.floor(e.barage.longitude / pasLon)}`;
    grille.set(k, [...(grille.get(k) ?? []), e]);
  }
  const sortie = [];
  const vus = new Set();
  for (const a of valides) {
    const cy = Math.floor(a.barage.latitude / pasLat);
    const cx = Math.floor(a.barage.longitude / pasLon);
    const voisins = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of grille.get(`${cy + dy},${cx + dx}`) ?? []) {
        if (b === a || idEnr(b) === idEnr(a) || origineDe(b.barage) !== origineDe(a.barage)) continue;
        if (regles.exigerMemeBrigade && a.barage.btId !== b.barage.btId) continue;
        const d = distanceMetres([a.barage.longitude, a.barage.latitude], [b.barage.longitude, b.barage.latitude]);
        if (d > seuil || d === 0) continue; // même position : doublon exact
        voisins.push([b, d]);
      }
    }
    // Au plus 5 voisins par barage : une zone dense ne noie pas la liste.
    for (const [b, d] of voisins.sort((x, y) => x[1] - y[1]).slice(0, 5)) {
      const paire = [a, b].sort((x, y) => (idEnr(x) < idEnr(y) ? -1 : 1));
      const cle = paire.map(idEnr).join('+');
      if (vus.has(cle) || dejaSignales.has(cle)) continue;
      vus.add(cle);
      const identiques = champs.filter((c) => valeurComparee(a.barage, c) !== null && memeValeur(valeurComparee(a.barage, c), valeurComparee(b.barage, c)));
      const differents = champs.filter((c) => !identiques.includes(c));
      const part = champs.length ? identiques.length / champs.length : 0;
      const confiance = d <= seuil / 3 && part === 1 ? 'haute' : part >= 0.5 ? 'moyenne' : 'faible';
      sortie.push(constat('proximite', 'quasi-doublon', confiance === 'faible' ? 'info' : 'avertissement', paire, {
        champ: 'latitude/longitude', valeur: Math.round(d * 10) / 10, confiance,
        raison: `Deux barages à ${d < 10 ? d.toFixed(1) : Math.round(d)} m l'un de l'autre${identiques.length ? `, mêmes ${identiques.join(', ')}` : ''}.`,
        preuves: { distanceM: Math.round(d * 10) / 10, seuilM: seuil, champsIdentiques: identiques, champsDifferents: differents },
      }));
    }
  }
  return sortie;
}

/**
 * Contrôle de la route : barage à plus de `toleranceRouteM` d'une route carrossable. Si une
 * route de sa brigade est à moins de RAYON_ACCROCHE_M, propose d'y accrocher le barage.
 * Tuiles illisibles ou absentes : « non vérifiable », jamais « invalide ».
 */
export async function controlerRoute(enr, contexte, regles) {
  const b = enr.barage;
  if (!coordonneesValides(b)) return [];
  const p = [b.longitude, b.latitude];
  let lu;
  try { lu = await contexte.lireRoutes(empriseAutour(p, p, RAYON_ACCROCHE_M + 50), 15); } catch { lu = null; }
  if (!lu) return [constat('route-non-verifiable', 'route', 'info', [enr], { champ: 'route', valeur: null, raison: 'Routes illisibles à cet endroit : non vérifié.' })];
  if (accrocherARoute(p, lu.lignes, { rayonMax: regles.toleranceRouteM })) return [];
  const sienne = contexte.circosBt.find((c) => c.proprietes.id === b.btId);
  const dans = sienne ? (q) => circonscriptionEn([sienne], q) !== null : () => false;
  const proche = sienne ? accrocherARoute(p, lu.lignes, { rayonMax: RAYON_ACCROCHE_M, dans }) : null;
  return [constat('hors-route', 'route', 'avertissement', [enr], {
    champ: 'latitude/longitude', valeur: p,
    raison: `Aucune route carrossable à moins de ${regles.toleranceRouteM} m.`,
    preuves: proche ? { distanceM: Math.round(proche.distance * 10) / 10, route: proche.route } : { distanceM: null },
    piste: proche ? null : `Aucune route de sa brigade à moins de ${RAYON_ACCROCHE_M} m : position à vérifier dans la source.`,
    proposition: proche ? proposer(enr, [['latitude', proche.point[1]], ['longitude', proche.point[0]], ['route', proche.route]],
      `Route carrossable la plus proche dans sa brigade, à ${Math.round(proche.distance)} m.`,
      [`Le barage serait déplacé de ${Math.round(proche.distance)} m, sur ${[proche.route.ref, proche.route.nom].filter(Boolean).join(' · ') || 'une route sans nom'}.`, 'Sa brigade ne change pas.']) : null,
  })];
}

/** Constats d'ensemble : surcouche visant des barages absents, imports répétés, référentiel. */
function constatsEnsemble(instantane, enrsPerimetre) {
  const sortie = [];
  for (const id of instantane.orphelines ?? []) {
    sortie.push({ ...constat('modif-orpheline', 'coherence', 'avertissement', [], { champ: 'id', valeur: id, raison: `Une modification locale vise ${id}, absent du jeu installé : elle est ignorée par la carte.` }), id: `modif-orpheline:${id}` });
  }
  for (const id of instantane.dejaInstalles ?? []) {
    sortie.push({ ...constat('import-repete', 'coherence', 'info', [], { champ: 'id', valeur: id, raison: `Le barage ajouté ${id} est aussi dans le jeu installé (export déjà réinstallé ?) : la version installée est affichée, l'ajout local est ignoré.` }), id: `import-repete:${id}` });
  }
  if (instantane.referentielDifferent) {
    sortie.push({ ...constat('referentiel', 'coherence', 'avertissement', [], { raison: 'Jeu préparé pour un autre import des circonscriptions : les identifiants de brigade (bt-N) peuvent ne plus correspondre.' }), id: 'referentiel' });
  }
  // Barages du périmètre que la carte refuse (règles de validerBarage) : absents de la carte.
  for (const e of enrsPerimetre) {
    if (!estObjet(e.barage)) continue;
    const erreurs = validerBarage(e.barage, instantane.hierarchie);
    if (erreurs.length) {
      sortie.push(constat('absent-carte', 'coherence', 'erreur', [e], { valeur: erreurs, raison: `Absent de la carte : ${erreurs.join(' ; ')}.` }));
    }
  }
  return sortie;
}

/**
 * Analyse complète, en lecture seule. `contexte` : { hierarchie, circosBt, lireRoutes?,
 * simulationDeclaree }. `annule()` est consulté entre deux paquets ; `progression(fait, total, etape)`.
 * @returns {Promise<{ constats: object[], analyses: number, exclus: number, annule: boolean }>}
 */
export async function analyser(instantane, contexte, regles, { progression = () => {}, annule = () => false, paquet = 200 } = {}) {
  const tous = instantane.enregistrements;
  const enrs = tous.filter((e) => dansPerimetre(e, regles, contexte.hierarchie));
  const constats = [];
  const total = enrs.length + (regles.verifierRoutes ? enrs.length : 0);
  const pause = () => new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < enrs.length; i += paquet) {
    if (annule()) return { constats, analyses: enrs.length, exclus: tous.length - enrs.length, annule: true };
    for (const e of enrs.slice(i, i + paquet)) constats.push(...controlerEnregistrement(e, contexte, regles));
    progression(Math.min(i + paquet, enrs.length), total, 'controles');
    await pause();
  }
  constats.push(...constatsEnsemble({ ...instantane, hierarchie: contexte.hierarchie }, enrs));
  if (regles.doublonsExacts) constats.push(...doublonsExacts(enrs));
  if (regles.quasiDoublons) {
    const exacts = new Set(constats.filter((c) => c.categorie === 'doublon-exact').map((c) => c.enregistrements.map((x) => x.id).sort().join('+')));
    constats.push(...quasiDoublons(enrs, regles, { dejaSignales: exacts }));
  }
  if (regles.verifierRoutes && contexte.lireRoutes) {
    for (let i = 0; i < enrs.length; i++) {
      if (i % 20 === 0) {
        if (annule()) return { constats, analyses: enrs.length, exclus: tous.length - enrs.length, annule: true };
        progression(enrs.length + i, total, 'routes');
        await pause();
      }
      constats.push(...await controlerRoute(enrs[i], contexte, regles));
    }
  }
  progression(total, total, 'fin');
  const rang = { erreur: 2, avertissement: 1, info: 0 };
  const garde = constats.filter((c) => rang[c.severite] >= rang[regles.severiteMin]);
  return { constats: garde.sort((a, b) => rang[b.severite] - rang[a.severite]), analyses: enrs.length, exclus: tous.length - enrs.length, annule: false };
}

// ── Statuts et statistiques ────────────────────────────────────────────────

/** Statuts d'un constat (libellés du tableau). */
export const STATUTS = Object.freeze({
  'a-verifier': 'À vérifier',
  verifie: 'Vérifié',
  confirme: 'Doublon confirmé',
  rejete: 'Suggestion rejetée',
  proposition: 'Proposition disponible',
  approuve: 'Approuvé',
  refuse: 'Refusé',
  applique: 'Appliqué',
  echec: 'Échec d\'application',
  annule: 'Modification annulée',
});

/** Statut courant d'un constat : décision de l'utilisateur, sinon « proposition » ou « à vérifier ». */
export const statutDe = (c, decisions = {}) => decisions[c.id]?.statut ?? (c.proposition ? 'proposition' : 'a-verifier');

/** Transitions permises : une décision ne saute pas d'étape (pas d'« appliqué » sans application). */
const TRANSITIONS = Object.freeze({
  'a-verifier': ['verifie', 'confirme', 'rejete'],
  verifie: ['a-verifier', 'confirme', 'rejete'],
  confirme: ['a-verifier'],
  rejete: ['a-verifier'],
  proposition: ['approuve', 'refuse'],
  approuve: ['proposition', 'refuse'],
  refuse: ['proposition', 'approuve'],
  echec: ['approuve', 'refuse'],
  applique: [],
  annule: [],
});
export const peutPasser = (de, vers) => TRANSITIONS[de]?.includes(vers) ?? false;

/** Décision de l'utilisateur sur un constat ; refusée si la transition n'est pas permise. */
export function decider(decisions, c, statut, date = new Date()) {
  const actuel = statutDe(c, decisions);
  if (!peutPasser(actuel, statut)) throw new Error(`Passage impossible : ${STATUTS[actuel]} → ${STATUTS[statut] ?? statut}`);
  return { ...decisions, [c.id]: { statut, date: date.toISOString() } };
}

/**
 * Chiffres du tableau, tous tirés des constats et des décisions. Un barage compté une fois
 * par rubrique, même s'il a plusieurs constats.
 */
export function statistiques(constats, decisions = {}, analyses = 0) {
  const barages = (filtre) => new Set(constats.filter(filtre).flatMap((c) => c.enregistrements.map((e) => e.cle))).size;
  const statut = (c) => statutDe(c, decisions);
  return {
    analyses,
    constats: constats.length,
    doublonsExacts: constats.filter((c) => c.categorie === 'doublon-exact').length,
    quasiDoublons: constats.filter((c) => c.categorie === 'quasi-doublon').length,
    coordonnees: barages((c) => c.categorie === 'coordonnees'),
    metadonnees: barages((c) => ['metadonnees', 'classification', 'relation'].includes(c.categorie)),
    aVerifier: barages((c) => !c.proposition && ['a-verifier'].includes(statut(c))),
    propositions: constats.filter((c) => c.proposition).length,
    enAttente: constats.filter((c) => ['proposition', 'echec'].includes(statut(c))).length,
    approuves: constats.filter((c) => statut(c) === 'approuve').length,
    refuses: constats.filter((c) => ['refuse', 'rejete'].includes(statut(c))).length,
    appliques: constats.filter((c) => statut(c) === 'applique').length,
  };
}

/**
 * Filtres de la liste des constats (les mêmes pour les chiffres, la liste et la carte).
 * `unites` : cle d'enregistrement → { regId } (d'après la hiérarchie).
 */
export function filtrerConstats(constats, f = {}, decisions = {}, unites = new Map()) {
  return constats.filter((c) => (!f.categorie || c.categorie === f.categorie)
    && (!f.severite || c.severite === f.severite)
    && (!f.statut || statutDe(c, decisions) === f.statut)
    && (!f.origine || c.enregistrements.some((e) => e.origine === f.origine))
    && (!f.reg || c.enregistrements.some((e) => unites.get(e.cle)?.regId === f.reg))
    && (!f.texte || `${c.raison} ${c.enregistrements.map((e) => e.id).join(' ')}`.toLowerCase().includes(f.texte.toLowerCase())));
}

// ── Application des corrections approuvées ─────────────────────────────────

/** Champs qu'une correction peut changer (jamais id, btId ni isSimulation : voir refusModification). */
export const CHAMPS_CORRIGEABLES = Object.freeze(['latitude', 'longitude', 'route', 'shift', 'name']);

/**
 * Vérifie à nouveau les propositions approuvées contre les données actuelles, sans rien écrire.
 * Refus : cible absente ou ambiguë (identifiant en double), valeur changée depuis l'analyse
 * (périmée), deux propositions sur le même champ (conflit), champ non corrigeable, barage
 * invalide après correction. Toutes les corrections d'un barage passent ou aucune.
 * @param {object[]} constats  constats approuvés (avec proposition)
 * @param {object[]} actuels   enregistrements actuels (instantane().enregistrements)
 * @returns {{ valides: { constatId, id, source, changements }[], refus: { constatId, id, raison, detail }[] }}
 */
export function planifierApplication(constats, actuels, hierarchie) {
  const parId = new Map();
  for (const e of actuels) if (estObjet(e.barage) && typeof e.barage.id === 'string') parId.set(e.barage.id, [...(parId.get(e.barage.id) ?? []), e]);
  const refus = [];
  const candidats = [];
  for (const c of constats) {
    const p = c.proposition;
    const id = p?.cible?.id;
    const cibles = parId.get(id) ?? [];
    if (!p || !id) { refus.push({ constatId: c.id, id, raison: 'sans-proposition', detail: 'Aucune correction proposée.' }); continue; }
    if (!cibles.length) { refus.push({ constatId: c.id, id, raison: 'cible-absente', detail: `${id} n'existe plus.` }); continue; }
    if (cibles.length > 1) { refus.push({ constatId: c.id, id, raison: 'cible-ambigue', detail: `${id} désigne plusieurs enregistrements.` }); continue; }
    if (estProtege(cibles[0].barage)) { refus.push({ constatId: c.id, id, raison: 'protege', detail: 'Barage fixe — intouchable : non modifié par l’optimisation (à corriger dans la source).' }); continue; }
    const interdit = p.changements.find((ch) => !CHAMPS_CORRIGEABLES.includes(ch.champ));
    if (interdit) { refus.push({ constatId: c.id, id, raison: 'champ-verrouille', detail: `Le champ ${interdit.champ} ne se corrige pas ici.` }); continue; }
    const perime = p.changements.find((ch) => !memeValeur(cibles[0].barage[ch.champ] ?? null, ch.avant));
    if (perime) { refus.push({ constatId: c.id, id, raison: 'perimee', detail: `${perime.champ} a changé depuis l'analyse (${JSON.stringify(perime.avant)} → ${JSON.stringify(cibles[0].barage[perime.champ] ?? null)}) : relancez l'analyse.` }); continue; }
    candidats.push({ c, id, cible: cibles[0] });
  }
  // Conflits : deux propositions qui touchent le même champ du même barage.
  const parChamp = new Map();
  for (const k of candidats) for (const ch of k.c.proposition.changements) parChamp.set(`${k.id}|${ch.champ}`, [...(parChamp.get(`${k.id}|${ch.champ}`) ?? []), k]);
  const enConflit = new Set([...parChamp.values()].filter((l) => l.length > 1 && new Set(l.map((k) => JSON.stringify(k.c.proposition.changements))).size > 1).flat());
  for (const k of enConflit) refus.push({ constatId: k.c.id, id: k.id, raison: 'conflit', detail: 'Une autre proposition change le même champ de ce barage : n\'en approuvez qu\'une.' });
  // Par barage : toutes les corrections ensemble, puis validation du résultat.
  const parBarage = new Map();
  for (const k of candidats.filter((x) => !enConflit.has(x))) parBarage.set(k.id, [...(parBarage.get(k.id) ?? []), k]);
  const valides = [];
  for (const [id, liste] of parBarage) {
    const changements = new Map();
    for (const k of liste) for (const ch of k.c.proposition.changements) changements.set(ch.champ, ch);
    const resultat = { ...liste[0].cible.barage };
    for (const ch of changements.values()) resultat[ch.champ] = ch.apres;
    const erreurs = validerBarage(resultat, hierarchie);
    if (erreurs.length) {
      for (const k of liste) refus.push({ constatId: k.c.id, id, raison: 'invalide', detail: `Après correction, le barage resterait invalide : ${erreurs.join(' ; ')}.` });
      continue;
    }
    for (const k of liste) valides.push({ constatId: k.c.id, id, source: liste[0].cible.source, changements: k.c.proposition.changements });
  }
  return { valides, refus };
}

/**
 * Écrit les corrections validées dans une COPIE de la surcouche locale (même mécanisme que
 * l'édition de la carte) et renvoie le journal avant / après. Rien n'est écrit ailleurs.
 * @returns {{ editions: object, journal: { id, source, champs: { [champ]: { avant, apres } } }[] }}
 */
export function appliquerAuxEditions(editions, valides) {
  const copie = structuredClone(editions);
  const journal = new Map();
  for (const v of valides) {
    const entree = journal.get(v.id) ?? { id: v.id, source: v.source, champs: {}, constats: [] };
    for (const ch of v.changements) entree.champs[ch.champ] = { avant: ch.avant, apres: ch.apres };
    entree.constats.push(v.constatId);
    journal.set(v.id, entree);
  }
  for (const entree of journal.values()) {
    const champs = Object.fromEntries(Object.entries(entree.champs).map(([k, v]) => [k, v.apres]));
    if (entree.source === 'local') {
      copie.ajouts = copie.ajouts.map((a) => (a.id === entree.id ? { ...a, ...champs } : a));
    } else {
      copie.modifs[entree.id] = { ...(copie.modifs[entree.id] ?? {}), ...champs };
    }
  }
  return { editions: copie, journal: [...journal.values()] };
}

/**
 * Annule une modification appliquée : rétablit les valeurs « avant » seulement si chaque champ
 * a encore sa valeur « après » (sinon conflit, rien n'est changé). Pour un barage du fichier,
 * une valeur rétablie égale à l'originale retire la modification locale.
 * @param {Map} baseParId  enregistrements du fichier installé (valeurs d'origine)
 * @returns {{ editions: object } | { conflits: string[] }}
 */
export function annulerEntree(editions, entree, actuels, baseParId) {
  const cibles = actuels.filter((e) => estObjet(e.barage) && e.barage.id === entree.id);
  if (cibles.length !== 1) return { conflits: [cibles.length ? `${entree.id} désigne plusieurs enregistrements.` : `${entree.id} n'existe plus.`] };
  const conflits = Object.entries(entree.champs)
    .filter(([champ, { apres }]) => !memeValeur(cibles[0].barage[champ] ?? null, apres))
    .map(([champ, { apres }]) => `${champ} a été modifié depuis (${JSON.stringify(cibles[0].barage[champ] ?? null)} au lieu de ${JSON.stringify(apres)}).`);
  if (conflits.length) return { conflits };
  const copie = structuredClone(editions);
  if (entree.source === 'local') {
    if (!copie.ajouts.some((a) => a.id === entree.id)) return { conflits: [`${entree.id} n'est plus un ajout local.`] };
    copie.ajouts = copie.ajouts.map((a) => {
      if (a.id !== entree.id) return a;
      const r = { ...a };
      for (const [champ, { avant }] of Object.entries(entree.champs)) {
        if (avant === null || avant === undefined) delete r[champ];
        else r[champ] = avant;
      }
      return r;
    });
  } else {
    const origine = baseParId.get(entree.id) ?? {};
    const modif = { ...(copie.modifs[entree.id] ?? {}) };
    for (const [champ, { avant }] of Object.entries(entree.champs)) {
      if (memeValeur(origine[champ] ?? null, avant)) delete modif[champ];
      else modif[champ] = avant;
    }
    if (Object.keys(modif).length) copie.modifs[entree.id] = modif;
    else delete copie.modifs[entree.id];
  }
  return { editions: copie };
}

// ── Historique ─────────────────────────────────────────────────────────────

export const HISTORIQUE_VIDE = () => ({ version: 1, sessions: [] });
export const LIMITES_HISTORIQUE = Object.freeze({ sessions: 20, constatsParSession: 2000 });

/** Nouvelle session d'analyse : règles, périmètre et constats gardés (bornés) pour l'historique. */
export function nouvelleSession(resultat, regles, { date = new Date(), version = null, auteur = 'poste local (pas d\'authentification)' } = {}) {
  const constats = resultat.constats.slice(0, LIMITES_HISTORIQUE.constatsParSession);
  return {
    id: `OPT-${date.getTime().toString(36).toUpperCase()}`,
    date: date.toISOString(),
    auteur,
    regles: structuredClone(regles),
    perimetre: structuredClone(regles.perimetre),
    versionDonnees: version,
    analyses: resultat.analyses,
    exclus: resultat.exclus,
    annulee: resultat.annule === true,
    tronque: resultat.constats.length > constats.length ? resultat.constats.length : 0,
    constats,
    decisions: {},
    evenements: [],
  };
}

/** Ajoute une session en tête ; les plus anciennes au-delà de la limite sont retirées. */
export function ajouterSession(historique, session) {
  return { ...historique, sessions: [session, ...historique.sessions].slice(0, LIMITES_HISTORIQUE.sessions) };
}

/** Historique relu du stockage : toute forme inattendue donne un historique vide. */
export function lireHistorique(brut) {
  if (!brut || typeof brut !== 'object' || !Array.isArray(brut.sessions)) return HISTORIQUE_VIDE();
  return { version: 1, sessions: brut.sessions.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.constats)).map((s) => ({ decisions: {}, evenements: [], ...s })) };
}

/** Remplace une session (décisions, événements) sans toucher aux autres. */
export const majSession = (historique, session) => ({ ...historique, sessions: historique.sessions.map((s) => (s.id === session.id ? session : s)) });
