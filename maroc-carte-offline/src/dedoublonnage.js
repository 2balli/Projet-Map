/**
 * Dédoublonnage des barages (« Lancer l'optimisation ») : détection, choix de l'enregistrement
 * conservé, fusion prudente, plan de suppression et annulation. Fonctions pures, sans DOM.
 *
 * Doublon CONFIRMÉ (supprimable après confirmation de l'utilisateur) — tout à la fois :
 *   même origine (simulé / réel, jamais mélangés), coordonnées valides à moins de
 *   `seuilConfirmeM`, même type, même faction, même brigade, routes compatibles (identiques
 *   ou une seule renseignée), noms compatibles si `exigerMemeNom`, identifiants distincts et
 *   uniques dans le jeu (la surcouche supprime par identifiant).
 * Doublon POTENTIEL (jamais supprimé : liste à vérifier) — même origine, à moins de
 *   `seuilPotentielM`, sans remplir toutes les conditions ci-dessus ; ou identifiant en double.
 * Un nom semblable n'est jamais une raison de rapprocher deux barages.
 *
 * Suppression = surcouche locale (voir barages.js) : identifiant ajouté aux `suppressions` pour
 * un barage du fichier, ajout local retiré pour un barage de ce navigateur. Le fichier installé
 * n'est jamais modifié ; l'annulation rétablit tout ce qui a été retiré ou fusionné.
 */
import { CONTINU, estProtege } from './barages.js';
import { distanceMetres } from './mesure.js';
import { dansPerimetre, memeValeur, origineDe } from './optimisation.js';
import { normaliser } from './recherche.js';

export const CRITERES_CANONIQUE = Object.freeze(['coordonnees', 'identifiant', 'source', 'completude', 'liens']);
export const LIBELLES_CRITERES = Object.freeze({
  coordonnees: 'Coordonnées valides',
  identifiant: 'Identifiant au format reconnu',
  source: 'Fichier installé plutôt qu’ajout local',
  completude: 'Données les plus complètes',
  liens: 'Liens vérifiés (brigade connue, route, trace de validation)',
});
export const REGLES_DEDOUBLONNAGE = Object.freeze({
  seuilConfirmeM: 1, // « mêmes coordonnées » : tolérance d'arrondi
  seuilPotentielM: 30,
  exigerMemeNom: true,
  fusionner: true,
  criteres: CRITERES_CANONIQUE,
});
/** Champs complétés depuis un doublon quand le barage conservé ne les a pas (jamais id, btId, type, faction, origine, position). */
export const CHAMPS_FUSIONNABLES = Object.freeze(['name', 'route', 'validation']);
const ID_FIABLE = /^(SIM-BAR-\d{4,}|BAR-[A-Z0-9]+-[A-Z0-9]+)$/;
const METRES_PAR_DEGRE = 111_320;
const MAX_VOISINS = 5;

export function validerReglesDedoublonnage(brut = {}) {
  const r = { ...REGLES_DEDOUBLONNAGE, ...(brut && typeof brut === 'object' ? brut : {}) };
  const erreurs = [];
  const borne = (k, min, max) => {
    if (!Number.isFinite(r[k]) || r[k] < min || r[k] > max) erreurs.push(`${k} doit être entre ${min} et ${max}`);
  };
  borne('seuilConfirmeM', 0, 10);
  borne('seuilPotentielM', 1, 2000);
  if (Number.isFinite(r.seuilConfirmeM) && Number.isFinite(r.seuilPotentielM) && r.seuilConfirmeM > r.seuilPotentielM) erreurs.push('le seuil confirmé dépasse le seuil potentiel');
  for (const k of ['exigerMemeNom', 'fusionner']) if (typeof r[k] !== 'boolean') erreurs.push(`${k} doit être vrai ou faux`);
  if (!Array.isArray(r.criteres) || new Set(r.criteres).size !== r.criteres.length || r.criteres.some((c) => !CRITERES_CANONIQUE.includes(c))) {
    erreurs.push('critères de choix inconnus ou répétés');
  }
  return { regles: erreurs.length ? { ...REGLES_DEDOUBLONNAGE } : { ...r, criteres: [...r.criteres] }, erreurs };
}

// ── Détection ──────────────────────────────────────────────────────────────

const estObjet = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
const vide = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (estObjet(v) && !Object.values(v).some((x) => !vide(x)));
const coordonnees = (b) => Number.isFinite(b?.latitude) && Number.isFinite(b?.longitude) && Math.abs(b.latitude) <= 90 && Math.abs(b.longitude) <= 180;
const cle = (e) => `${e.source}#${e.rang}`;
const cleRoute = (r) => (estObjet(r) ? `${normaliser(r.ref ?? '')}|${normaliser(r.nom ?? '')}|${r.classe ?? ''}` : '');
const resume = (e) => ({ cle: cle(e), id: e.barage.id, source: e.source, origine: origineDe(e.barage) });

/** Champs qui empêchent de confirmer la paire (vide = paire confirmable). */
function differences(a, b, regles) {
  const d = [];
  for (const k of ['type', 'shift', 'btId']) if (!memeValeur(a[k] ?? null, b[k] ?? null)) d.push(k);
  if (!vide(a.route) && !vide(b.route) && cleRoute(a.route) !== cleRoute(b.route)) d.push('route');
  if (regles.exigerMemeNom && !vide(a.name) && !vide(b.name) && normaliser(String(a.name)) !== normaliser(String(b.name))) d.push('name');
  return d;
}

/** Une paire est-elle un doublon confirmé ? (distance, attributs, identifiants supprimables) */
function paireConfirmee(a, b, d, regles, nbParId) {
  return d <= regles.seuilConfirmeM && a.barage.id !== b.barage.id && nbParId.get(a.barage.id) === 1 && nbParId.get(b.barage.id) === 1
    && !differences(a.barage, b.barage, regles).length;
}

/** Note d'un enregistrement pour un critère (plus haut = meilleur). */
function note(e, critere, hierarchie) {
  const b = e.barage;
  switch (critere) {
    case 'coordonnees': return coordonnees(b) ? 1 : 0;
    case 'identifiant': return ID_FIABLE.test(b.id) ? 1 : 0;
    case 'source': return e.source === 'fichier' ? 1 : 0;
    case 'completude': return ['name', 'type', 'shift', 'btId', 'route', 'validation'].filter((k) => !vide(b[k])).length;
    case 'liens': return (hierarchie?.brigades?.has(b.btId) ? 1 : 0) + (vide(b.route) ? 0 : 1) + (vide(b.validation) ? 0 : 1);
    default: return 0;
  }
}

/**
 * Enregistrement conservé d'un groupe : critères dans l'ordre configuré, puis le premier du
 * fichier (rang), puis l'identifiant — un choix déterministe et expliqué.
 */
export function choisirCanonique(membres, criteres = CRITERES_CANONIQUE, hierarchie = null) {
  const notes = membres.map((e) => ({ e, notes: criteres.map((c) => note(e, c, hierarchie)) }));
  notes.sort((x, y) => {
    // Un barage intouchable est toujours le barage conservé.
    if (estProtege(x.e.barage) !== estProtege(y.e.barage)) return estProtege(x.e.barage) ? -1 : 1;
    for (let i = 0; i < criteres.length; i++) if (x.notes[i] !== y.notes[i]) return y.notes[i] - x.notes[i];
    if (x.e.source !== y.e.source) return x.e.source === 'fichier' ? -1 : 1;
    return x.e.rang - y.e.rang || (x.e.barage.id < y.e.barage.id ? -1 : 1);
  });
  const [premier, second] = notes;
  const decisif = second ? criteres.findIndex((_, i) => premier.notes[i] !== second.notes[i]) : -1;
  return {
    canonique: premier.e,
    motif: decisif >= 0 ? LIBELLES_CRITERES[criteres[decisif]] : 'À égalité : premier enregistrement du fichier',
    classement: notes.map((n) => ({ id: n.e.barage.id, notes: Object.fromEntries(criteres.map((c, i) => [c, n.notes[i]])) })),
  };
}

/** Champs du conservé complétés depuis ses doublons : seulement s'il ne les a pas et si les doublons s'accordent. */
export function fusionPossible(canonique, doublons) {
  const champs = {};
  const conflits = [];
  for (const k of CHAMPS_FUSIONNABLES) {
    if (!vide(canonique[k])) continue;
    const valeurs = doublons.map((b) => b[k]).filter((v) => !vide(v));
    if (!valeurs.length) continue;
    if (valeurs.every((v) => memeValeur(v, valeurs[0]))) champs[k] = structuredClone(valeurs[0]);
    else conflits.push(k);
  }
  return { champs, conflits };
}

/**
 * Doublons du jeu dans le périmètre.
 * @param {{ enregistrements: { barage, source, rang }[] }} instantane  CoucheBarages.instantane()
 * @param {object} regles  règles de dédoublonnage (validerReglesDedoublonnage)
 * @param {{ perimetre?: object, inclureAjoutsLocaux?: boolean, hierarchie?: object, progression?: Function }} options
 * @returns {{ confirmes: object[], potentiels: object[], analyses: number, exclus: number }}
 */
export function detecterDoublons(instantane, regles, { perimetre = { origine: 'toutes', reg: '', cie: '', bt: '' }, inclureAjoutsLocaux = true, hierarchie = null, progression = () => {} } = {}) {
  const tous = instantane.enregistrements.filter((e) => estObjet(e.barage) && typeof e.barage.id === 'string');
  // Un identifiant en double ne peut pas être supprimé seul : la surcouche supprime par identifiant.
  const nbParId = new Map();
  for (const e of tous) nbParId.set(e.barage.id, (nbParId.get(e.barage.id) ?? 0) + 1);
  const portee = { perimetre, inclureAjoutsLocaux };
  const enrs = tous.filter((e) => dansPerimetre(e, portee, hierarchie));
  const exclus = instantane.enregistrements.length - enrs.length;
  const valides = enrs.filter((e) => coordonnees(e.barage) && origineDe(e.barage) !== 'inconnue');
  progression(0, valides.length, 'paires');

  const pasLat = Math.max(regles.seuilPotentielM, 1) / METRES_PAR_DEGRE;
  const pasLon = pasLat / Math.cos((37 * Math.PI) / 180);
  const grille = new Map();
  for (const e of valides) {
    const k = `${Math.floor(e.barage.latitude / pasLat)},${Math.floor(e.barage.longitude / pasLon)}`;
    if (grille.has(k)) grille.get(k).push(e);
    else grille.set(k, [e]);
  }
  const paires = []; // [a, b, distance, confirmee]
  const vues = new Set();
  valides.forEach((a, n) => {
    if (n % 2000 === 0) progression(n, valides.length, 'paires');
    const cy = Math.floor(a.barage.latitude / pasLat);
    const cx = Math.floor(a.barage.longitude / pasLon);
    const voisins = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const b of grille.get(`${cy + dy},${cx + dx}`) ?? []) {
        if (b === a || origineDe(b.barage) !== origineDe(a.barage)) continue; // simulé et réel jamais rapprochés
        const d = distanceMetres([a.barage.longitude, a.barage.latitude], [b.barage.longitude, b.barage.latitude]);
        if (d <= regles.seuilPotentielM) voisins.push([b, d]);
      }
    }
    // Les confirmés passent tous ; les autres voisins sont bornés pour qu'une zone dense ne noie pas la liste.
    voisins.sort((x, y) => x[1] - y[1]);
    let autres = 0;
    for (const [b, d] of voisins) {
      const k = [cle(a), cle(b)].sort().join('+');
      if (vues.has(k)) continue;
      const confirmee = paireConfirmee(a, b, d, regles, nbParId);
      if (!confirmee && ++autres > MAX_VOISINS) continue;
      vues.add(k);
      paires.push([a, b, d, confirmee]);
    }
  });
  // Identifiants en double hors de portée de la distance (positions éloignées) : aussi à vérifier.
  const parId = new Map();
  for (const e of enrs) parId.set(e.barage.id, [...(parId.get(e.barage.id) ?? []), e]);
  for (const groupe of parId.values()) {
    for (let i = 0; i < groupe.length; i++) for (let j = i + 1; j < groupe.length; j++) {
      const [a, b] = [groupe[i], groupe[j]];
      const k = [cle(a), cle(b)].sort().join('+');
      if (vues.has(k)) continue;
      vues.add(k);
      const d = coordonnees(a.barage) && coordonnees(b.barage) ? distanceMetres([a.barage.longitude, a.barage.latitude], [b.barage.longitude, b.barage.latitude]) : null;
      paires.push([a, b, d, false]);
    }
  }
  progression(valides.length, valides.length, 'groupes');

  // Groupes : union des paires confirmées, puis chaque membre revérifié contre le conservé
  // (une chaîne A≈B≈C ne rapproche pas A et C au-delà du seuil).
  const parent = new Map();
  const racine = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const enrParCle = new Map(enrs.map((e) => [cle(e), e]));
  for (const [a, b, , ok] of paires) {
    if (!ok) continue;
    for (const e of [a, b]) if (!parent.has(cle(e))) parent.set(cle(e), cle(e));
    parent.set(racine(cle(a)), racine(cle(b)));
  }
  const groupes = new Map();
  for (const k of parent.keys()) groupes.set(racine(k), [...(groupes.get(racine(k)) ?? []), enrParCle.get(k)]);

  const confirmes = [];
  const dansGroupe = new Map(); // cle → id du groupe
  for (const membres of groupes.values()) {
    const choix = choisirCanonique(membres, regles.criteres, hierarchie);
    const c = choix.canonique;
    const distance = (e) => distanceMetres([c.barage.longitude, c.barage.latitude], [e.barage.longitude, e.barage.latitude]);
    const retenus = membres.filter((e) => e !== c && !estProtege(e.barage) && paireConfirmee(c, e, distance(e), regles, nbParId));
    if (!retenus.length) continue;
    const id = `G-${c.barage.id}`;
    const fusion = regles.fusionner ? fusionPossible(c.barage, retenus.map((e) => e.barage)) : { champs: {}, conflits: [] };
    confirmes.push({
      id,
      conserve: { ...resume(c), barage: c.barage },
      doublons: retenus.map((e) => ({ ...resume(e), barage: e.barage, distanceM: Math.round(distance(e) * 100) / 100 })),
      motif: choix.motif,
      classement: choix.classement,
      fusion,
    });
    for (const e of [c, ...retenus]) dansGroupe.set(cle(e), id);
  }

  const potentiels = [];
  for (const [a, b, d] of paires) {
    const ga = dansGroupe.get(cle(a));
    if (ga && ga === dansGroupe.get(cle(b))) continue; // déjà dans le même groupe confirmé
    const memeId = a.barage.id === b.barage.id;
    const diff = differences(a.barage, b.barage, regles);
    const raisons = [];
    if (memeId) raisons.push('même identifiant (la surcouche ne peut pas en supprimer un seul)');
    else if ((nbParId.get(a.barage.id) ?? 0) > 1 || (nbParId.get(b.barage.id) ?? 0) > 1) raisons.push('identifiant présent plusieurs fois dans le jeu');
    if (d !== null && d > regles.seuilConfirmeM) raisons.push(`positions à ${d < 10 ? d.toFixed(1) : Math.round(d)} m`);
    if (diff.length) raisons.push(`différences : ${diff.join(', ')}`);
    if (estProtege(a.barage) || estProtege(b.barage)) raisons.push('barage fixe intouchable : jamais supprimé');
    if (diff.includes('shift') || diff.includes('type')) raisons.push(a.barage.shift === CONTINU || b.barage.shift === CONTINU ? 'un intouchable et un barage fixe peuvent partager un emplacement' : 'des factions différentes au même endroit peuvent être un planning normal');
    potentiels.push({
      id: `P-${[cle(a), cle(b)].sort().join('+')}`,
      enregistrements: [a, b].map((e) => ({ ...resume(e), barage: e.barage })),
      distanceM: d === null ? null : Math.round(d * 10) / 10,
      differences: diff,
      raisons,
    });
  }
  potentiels.sort((x, y) => (x.distanceM ?? Infinity) - (y.distanceM ?? Infinity));
  confirmes.sort((x, y) => (x.conserve.id < y.conserve.id ? -1 : 1));
  return { confirmes, potentiels, analyses: enrs.length, exclus };
}

// ── Plan, exécution, annulation ───────────────────────────────────────────

const copieEditions = (e) => ({ ajouts: structuredClone(e.ajouts), modifs: structuredClone(e.modifs), suppressions: [...e.suppressions], retraits: structuredClone(e.retraits ?? []) });

/**
 * Surcouche après suppression des doublons confirmés (et fusion des champs sûrs), avec le
 * journal qui permet l'annulation. Lève une erreur si une condition de sûreté n'est pas tenue :
 * rien n'est alors écrit.
 * @param {object} editions  surcouche actuelle (non modifiée)
 * @param {object[]} confirmes  groupes de detecterDoublons
 */
export function planifierOptimisation(editions, confirmes) {
  const apres = copieEditions(editions);
  const supprimes = [];
  const fusions = [];
  const conserves = new Set(confirmes.map((g) => g.conserve.id));
  const vus = new Set();
  for (const g of confirmes) {
    for (const d of g.doublons) {
      if (conserves.has(d.id)) throw new Error(`${d.id} est à la fois conservé et supprimé.`);
      if (estProtege(d.barage)) throw new Error(`${d.id} : barage fixe intouchable, jamais supprimé.`);
      if (vus.has(d.id)) throw new Error(`${d.id} apparaît dans deux groupes.`);
      if (origineDe(d.barage) !== origineDe(g.conserve.barage)) throw new Error(`${d.id} : simulé et réel ne se fusionnent pas.`);
      vus.add(d.id);
      if (d.source === 'local') {
        const index = apres.ajouts.findIndex((a) => a.id === d.id);
        if (index < 0) throw new Error(`${d.id} n'est plus un ajout local.`);
        supprimes.push({ id: d.id, source: 'local', groupe: g.id, conserve: g.conserve.id, barage: structuredClone(apres.ajouts[index]), index: editions.ajouts.findIndex((a) => a.id === d.id) });
        apres.ajouts.splice(index, 1);
      } else {
        if (apres.suppressions.includes(d.id)) throw new Error(`${d.id} est déjà supprimé.`);
        supprimes.push({ id: d.id, source: 'fichier', groupe: g.id, conserve: g.conserve.id, barage: structuredClone(d.barage) });
        apres.suppressions.push(d.id);
      }
    }
    const champs = g.fusion?.champs ?? {};
    if (!Object.keys(champs).length) continue;
    const c = g.conserve;
    if (c.source === 'local') {
      const index = apres.ajouts.findIndex((a) => a.id === c.id);
      if (index < 0) throw new Error(`${c.id} n'est plus un ajout local.`);
      const avant = structuredClone(apres.ajouts[index]);
      apres.ajouts[index] = { ...avant, ...structuredClone(champs) };
      fusions.push({ id: c.id, source: 'local', champs: Object.keys(champs), avant, apres: structuredClone(apres.ajouts[index]) });
    } else {
      const avant = Object.hasOwn(apres.modifs, c.id) ? structuredClone(apres.modifs[c.id]) : null;
      apres.modifs[c.id] = { ...(avant ?? {}), ...structuredClone(champs) };
      fusions.push({ id: c.id, source: 'fichier', champs: Object.keys(champs), avant, apres: structuredClone(apres.modifs[c.id]) });
    }
  }
  return { editions: apres, supprimes, fusions, conserves: [...conserves] };
}

/**
 * Annule une optimisation sur la surcouche actuelle : barages supprimés rétablis, fusions
 * défaites. Les changements faits depuis sur d'autres barages sont gardés ; si un barage
 * concerné a été modifié depuis, rien n'est fait et les conflits sont rendus.
 * @returns {{ editions: object } | { conflits: string[] }}
 */
export function annulerOptimisation(editions, operation) {
  const conflits = [];
  const apres = copieEditions(editions);
  for (const f of operation.fusions) {
    if (f.source === 'local') {
      const index = apres.ajouts.findIndex((a) => a.id === f.id);
      if (index < 0 || !memeValeur(apres.ajouts[index], f.apres)) conflits.push(`${f.id} a été modifié ou retiré depuis l'optimisation.`);
      else apres.ajouts[index] = structuredClone(f.avant);
    } else if (!memeValeur(apres.modifs[f.id] ?? null, f.apres)) {
      conflits.push(`${f.id} a été modifié depuis l'optimisation.`);
    } else if (f.avant === null) {
      delete apres.modifs[f.id];
    } else {
      apres.modifs[f.id] = structuredClone(f.avant);
    }
  }
  for (const s of operation.supprimes) {
    if (s.source === 'local') {
      if (apres.ajouts.some((a) => a.id === s.id)) conflits.push(`${s.id} existe de nouveau dans ce navigateur.`);
      else apres.ajouts.splice(Math.max(0, Math.min(s.index ?? apres.ajouts.length, apres.ajouts.length)), 0, structuredClone(s.barage));
    } else {
      apres.suppressions = apres.suppressions.filter((id) => id !== s.id);
    }
  }
  return conflits.length ? { conflits } : { editions: apres };
}

/**
 * Opération en cours retrouvée au chargement (onglet fermé pendant l'écriture) : l'état de la
 * surcouche dit si elle a abouti.
 */
export function etatApresInterruption(operation, editions) {
  if (memeValeur(editions, operation.editionsApres)) return 'terminee';
  if (memeValeur(editions, operation.editionsAvant)) return 'echec';
  return 'inconnue';
}

// ── Historique des opérations ─────────────────────────────────────────────

export const LIMITE_OPERATIONS = 20;
export const OPERATIONS_VIDES = () => ({ version: 1, operations: [] });

export function lireOperations(brut) {
  if (!estObjet(brut) || !Array.isArray(brut.operations)) return OPERATIONS_VIDES();
  return { version: 1, operations: brut.operations.filter((o) => estObjet(o) && typeof o.id === 'string' && Array.isArray(o.supprimes)) };
}

export function ajouterOperation(historique, operation) {
  return { ...historique, operations: [operation, ...historique.operations].slice(0, LIMITE_OPERATIONS) };
}

export const majOperation = (historique, operation) => ({ ...historique, operations: historique.operations.map((o) => (o.id === operation.id ? operation : o)) });

/** Dernière optimisation annulable (la plus récente qui a abouti et n'est pas annulée). */
export const derniereAnnulable = (historique) => historique.operations.find((o) => o.statut === 'terminee') ?? null;
