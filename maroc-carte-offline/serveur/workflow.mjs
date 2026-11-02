/**
 * Workflow des conflits d'espacement : comptes, rôles, conflits, affectation, propositions des
 * commandements régionaux, décisions de l'administrateur, historique. Fonctions pures : elles
 * reçoivent l'état ({ comptes, conflits }), l'acteur authentifié et le référentiel du serveur,
 * vérifient les droits, et rendent le nouvel état et les événements d'audit. Toute erreur de
 * droit ou de données lève une ErreurWorkflow (code HTTP), sans rien modifier.
 *
 * Rôles : « admin » (lance l'optimisation, assigne, décide) et « commandement » (une région :
 * voit ses conflits assignés, propose). Personne ne modifie un barage ici : une proposition
 * approuvée est exportée pour le processus d'installation existant.
 */
import { randomBytes } from 'node:crypto';
import { CRENEAUX } from '../src/barages.js';
import { distanceMetres } from '../src/mesure.js';
import { factionCommune, factionDe } from '../src/proximite.js';
import { hacherMotDePasse, refusMotDePasse } from './auth.mjs';

export class ErreurWorkflow extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuser = (code, message) => { throw new ErreurWorkflow(code, message); };

export const ROLES = Object.freeze({ superadmin: 'Superadmin', admin: 'Administrateur', commandement: 'Compte régional (commandement)' });
/** Rôles à accès complet : « superadmin » (et « admin », nom des premières versions). */
export const ADMINS = new Set(['superadmin', 'admin']);
export const estAdmin = (c) => ADMINS.has(c?.role);
export const STATUTS = Object.freeze({
  'a-traiter': 'À traiter',
  'en-cours': 'En cours',
  'proposition-soumise': 'En attente d’approbation',
  'a-corriger': 'Renvoyée pour correction',
  approuve: 'Approuvé',
  resolu: 'Résolu',
  rejete: 'Rejeté',
  'bloque-fixes': 'Bloqué — barrages fixes',
  'conflit-persistant': 'Conflit toujours présent',
});
const OUVERTS = new Set(['a-traiter', 'en-cours', 'proposition-soumise', 'a-corriger', 'approuve', 'bloque-fixes', 'conflit-persistant']);
export const ETAT_VIDE = () => ({ comptes: [], conflits: [] });
const MARGE_PLAUSIBILITE_M = 300; // une route n'est jamais plus courte que la ligne droite (aux accroches près)

const id = (prefixe) => `${prefixe}-${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`;
const texteValide = (t, min = 3) => typeof t === 'string' && t.trim().length >= min;

/** Vue publique d'un compte : jamais l'empreinte du mot de passe. */
export const comptePublic = (c) => (c ? { id: c.id, identifiant: c.identifiant, nom: c.nom, role: c.role, regId: c.regId ?? null, actif: c.actif, doitChanger: c.doitChanger === true } : null);

const exigerAdmin = (acteur) => {
  if (!acteur) refuser(401, 'connexion requise');
  if (!estAdmin(acteur)) refuser(403, 'réservé au superadmin');
};
const exigerCommandement = (acteur) => {
  if (!acteur) refuser(401, 'connexion requise');
  if (acteur.role !== 'commandement' || !acteur.regId) refuser(403, 'réservé aux commandements régionaux');
};

const evenement = (acteur, action, details, date) => ({ date: date.toISOString(), acteurId: acteur?.id ?? null, acteurNom: acteur?.nom ?? 'système', action, ...details });

function avecHistorique(conflit, acteur, action, details, date) {
  const e = evenement(acteur, action, details, date);
  return { conflit: { ...conflit, historique: [...conflit.historique, e], majLe: e.date }, audit: { ...e, conflitId: conflit.id } };
}

// ── Comptes ────────────────────────────────────────────────────────────────

const IDENTIFIANT = /^[a-z0-9._-]{3,40}$/;

/**
 * Création d'un compte. Premier administrateur : `acteur` null et aucun compte existant (CLI).
 * `temporaire` : mot de passe initial (6 caractères au moins) à changer à la première connexion.
 */
export function creerCompte(etat, acteur, { identifiant, nom, role, regId = null, motDePasse, temporaire = false }, ref, date = new Date()) {
  const premier = acteur === null && !etat.comptes.some((c) => estAdmin(c));
  if (!premier) exigerAdmin(acteur);
  if (premier && !ADMINS.has(role)) refuser(400, 'le premier compte doit être superadmin');
  const ident = String(identifiant ?? '').trim().toLowerCase();
  if (!IDENTIFIANT.test(ident)) refuser(400, 'identifiant : 3 à 40 caractères parmi a-z, 0-9, « . », « _ », « - »');
  if (etat.comptes.some((c) => c.identifiant === ident)) refuser(409, 'identifiant déjà utilisé');
  if (!ROLES[role]) refuser(400, 'rôle inconnu');
  if (!texteValide(nom, 2)) refuser(400, 'nom obligatoire');
  if (role === 'commandement' && !ref.regionExiste(regId)) refuser(400, 'région inconnue : un commandement régional est rattaché à une région existante');
  const refus = refusMotDePasse(motDePasse, { temporaire });
  if (refus) refuser(400, refus);
  const compte = {
    id: id('CPT'), identifiant: ident, nom: nom.trim(), role, regId: role === 'commandement' ? regId : null, actif: true,
    empreinte: hacherMotDePasse(motDePasse), doitChanger: temporaire === true, creeLe: date.toISOString(), creePar: acteur?.id ?? 'cli',
  };
  return { etat: { ...etat, comptes: [...etat.comptes, compte] }, compte, audit: [evenement(acteur, 'compte-cree', { compte: comptePublic(compte) }, date)] };
}

/** « Béni Mellal » → « beni-mellal » (identifiant de compte). */
export const slugRegion = (nom) => String(nom).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Comptes de départ : « superadmin » et un compte « cr-<région> » par région du jeu installé
 * (identifiant stable reg-N de circo-reg.geojson). Aucune région n'est inventée : la liste
 * suit les données. @param {Iterable<{ id: string, nom: string }>} regions
 */
export function comptesInitiaux(regions) {
  const liste = [{ identifiant: 'superadmin', nom: 'Superadmin', role: 'superadmin', regId: null }];
  const vus = new Set();
  for (const r of regions) {
    const identifiant = `cr-${slugRegion(r.nom)}`;
    if (vus.has(identifiant) || identifiant === 'cr-') throw new Error(`nom de région ambigu ou vide : ${r.id} « ${r.nom} »`);
    vus.add(identifiant);
    liste.push({ identifiant, nom: `Commandement régional — ${r.nom}`, role: 'commandement', regId: r.id });
  }
  return liste;
}

export function modifierCompte(etat, acteur, compteId, { actif, motDePasse, nom }, date = new Date()) {
  exigerAdmin(acteur);
  const c = etat.comptes.find((x) => x.id === compteId) ?? refuser(404, 'compte introuvable');
  if (c.id === acteur.id && actif === false) refuser(400, 'un administrateur ne se désactive pas lui-même');
  const maj = { ...c };
  const changes = [];
  if (typeof actif === 'boolean' && actif !== c.actif) { maj.actif = actif; changes.push(actif ? 'réactivé' : 'désactivé'); }
  if (motDePasse !== undefined) {
    // Réinitialisation par le superadmin : mot de passe temporaire, à changer à la connexion.
    const refus = refusMotDePasse(motDePasse, { temporaire: true });
    if (refus) refuser(400, refus);
    maj.empreinte = hacherMotDePasse(motDePasse);
    maj.doitChanger = true;
    changes.push('mot de passe réinitialisé (changement imposé)');
  }
  if (nom !== undefined) {
    if (!texteValide(nom, 2)) refuser(400, 'nom obligatoire');
    maj.nom = nom.trim();
    changes.push('nom changé');
  }
  if (!changes.length) refuser(400, 'aucune modification');
  return {
    etat: { ...etat, comptes: etat.comptes.map((x) => (x.id === c.id ? maj : x)) }, compte: maj,
    deconnecter: maj.actif === false || motDePasse !== undefined,
    audit: [evenement(acteur, 'compte-modifie', { compte: comptePublic(maj), changes }, date)],
  };
}

/**
 * L'utilisateur change SON mot de passe (obligatoire après un mot de passe temporaire). Le rôle,
 * la région et le compte ne changent jamais par ce chemin.
 */
export function changerMotDePasse(etat, acteur, { actuel, nouveau }, verifier, date = new Date()) {
  if (!acteur) refuser(401, 'connexion requise');
  const c = etat.comptes.find((x) => x.id === acteur.id) ?? refuser(404, 'compte introuvable');
  if (!verifier(actuel ?? '', c.empreinte)) refuser(400, 'mot de passe actuel incorrect');
  const refus = refusMotDePasse(nouveau);
  if (refus) refuser(400, refus);
  if (verifier(nouveau, c.empreinte)) refuser(400, 'le nouveau mot de passe doit être différent de l’actuel');
  const maj = { ...c, empreinte: hacherMotDePasse(nouveau), doitChanger: false, motDePasseChangeLe: date.toISOString() };
  return { etat: { ...etat, comptes: etat.comptes.map((x) => (x.id === c.id ? maj : x)) }, compte: maj, audit: [evenement(acteur, 'mot-de-passe-change', { compte: comptePublic(maj) }, date)] };
}

// ── Conflits : création par l'administrateur ───────────────────────────────

const cleConflit = (ids) => [...ids].sort().join('+');

function simplifierChemin(chemin, max = 400) {
  if (!Array.isArray(chemin) || chemin.length < 2) return null;
  const pas = Math.max(1, Math.ceil(chemin.length / max));
  const pts = chemin.filter((_, i) => i % pas === 0);
  if (pts.at(-1) !== chemin.at(-1)) pts.push(chemin.at(-1));
  return pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);
}

const instantaneBarage = (b, ref) => ({
  id: b.id, name: b.name ?? b.id, type: b.type, shift: b.shift, btId: b.btId, latitude: b.latitude, longitude: b.longitude,
  route: b.route ?? null, isSimulation: b.isSimulation === true, protege: ref.protege(b),
});

/**
 * Enregistre les paires non conformes calculées par l'administrateur (moteur routier de la
 * carte). Le serveur revérifie : barages du jeu installé, même région (celle de l'analyse),
 * même faction, distance routière ≤ seuil et plausible, pas de conflit ouvert en double.
 */
export function creerConflits(etat, acteur, { regId, seuilKm, paires }, ref, date = new Date()) {
  exigerAdmin(acteur);
  if (!ref.regionExiste(regId)) refuser(400, 'région inconnue');
  if (!Number.isFinite(seuilKm) || seuilKm <= 0 || seuilKm > 100) refuser(400, 'distance minimale invalide');
  if (!Array.isArray(paires) || !paires.length || paires.length > 2000) refuser(400, 'aucune paire');
  const seuilM = seuilKm * 1000;
  const ouverts = new Set(etat.conflits.filter((c) => OUVERTS.has(c.statut)).map((c) => c.cle));
  const crees = [];
  const ignores = [];
  const audit = [];
  for (const p of paires) {
    const ids = Array.isArray(p?.ids) ? p.ids : [];
    const [a, b] = ids.map((x) => ref.barage(x));
    const ecarter = (raison) => ignores.push({ ids, raison });
    if (ids.length !== 2 || ids[0] === ids[1]) { ecarter('paire invalide'); continue; }
    if (!a || !b) { ecarter('barage absent du jeu installé (ajout local ?)'); continue; }
    if (ref.regDe(a) !== regId || ref.regDe(b) !== regId) { ecarter('barage hors de la région analysée'); continue; }
    const faction = factionCommune(a, b);
    if (faction === null) { ecarter('factions différentes'); continue; }
    if (!Number.isFinite(p.routeM) || p.routeM > seuilM) { ecarter('distance routière non vérifiée ou au-delà du seuil'); continue; }
    if (p.routeM < distanceMetres([a.longitude, a.latitude], [b.longitude, b.latitude]) - MARGE_PLAUSIBILITE_M) { ecarter('distance routière invraisemblable (plus courte que la ligne droite)'); continue; }
    const cle = cleConflit(ids);
    if (ouverts.has(cle)) { ecarter('conflit déjà ouvert pour cette paire'); continue; }
    ouverts.add(cle);
    const barages = [instantaneBarage(a, ref), instantaneBarage(b, ref)];
    const informatif = barages.every((x) => x.protege);
    const conflit = {
      id: id('CF'), cle, regId, regNom: ref.nomRegion(regId), faction, barages, informatif,
      routeM: Math.round(p.routeM), seuilM: Math.round(seuilM),
      route: { chemin: simplifierChemin(p.route?.chemin), secondes: Number.isFinite(p.route?.secondes) ? Math.round(p.route.secondes) : null, approximatif: Boolean(p.route?.approximatif), source: 'moteur routier de la carte (poste de l’administrateur)' },
      statut: informatif ? 'bloque-fixes' : 'a-traiter',
      assigneA: null, assigneLe: null, assignePar: null,
      proposition: null, propositions: [], decision: null,
      creePar: acteur.id, creeLe: date.toISOString(), majLe: date.toISOString(), historique: [],
    };
    const r = avecHistorique(conflit, acteur, 'cree', { routeM: conflit.routeM, seuilM: conflit.seuilM, statut: conflit.statut }, date);
    crees.push(r.conflit);
    audit.push(r.audit);
  }
  return { etat: { ...etat, conflits: [...etat.conflits, ...crees] }, crees, ignores, audit };
}

// ── Affectation ────────────────────────────────────────────────────────────

/** Commandements actifs d'une région (correspondance région → commandement). */
export const commandementsPour = (etat, regId) => etat.comptes.filter((c) => c.role === 'commandement' && c.actif && c.regId === regId);

/**
 * Assigne des conflits au commandement de leur région. Commandement unique : choisi d'office ;
 * aucun ou plusieurs : l'administrateur doit en désigner un (de la même région). Le statut
 * n'avance pas : assigner n'est pas résoudre.
 */
export function assigner(etat, acteur, { conflitIds, commandementId = null }, date = new Date()) {
  exigerAdmin(acteur);
  if (!Array.isArray(conflitIds) || !conflitIds.length) refuser(400, 'aucun conflit choisi');
  const audit = [];
  let conflits = etat.conflits;
  for (const cid of conflitIds) {
    const c = conflits.find((x) => x.id === cid) ?? refuser(404, `conflit ${cid} introuvable`);
    if (['resolu', 'rejete'].includes(c.statut)) refuser(409, `conflit ${cid} clos (${STATUTS[c.statut]})`);
    const candidats = commandementsPour(etat, c.regId);
    let cible;
    if (commandementId) {
      cible = candidats.find((x) => x.id === commandementId) ?? refuser(400, `le commandement choisi n’est pas un commandement actif de la région ${c.regNom}`);
    } else if (candidats.length === 1) {
      [cible] = candidats;
    } else {
      refuser(409, candidats.length ? `plusieurs commandements pour ${c.regNom} : choisissez-en un` : `aucun commandement actif pour ${c.regNom} : créez-en un ou choisissez-le`);
    }
    const r = avecHistorique({ ...c, assigneA: cible.id, assigneLe: date.toISOString(), assignePar: acteur.id }, acteur, c.assigneA ? 'reassigne' : 'assigne', { a: comptePublic(cible) }, date);
    conflits = conflits.map((x) => (x.id === cid ? r.conflit : x));
    audit.push(r.audit);
  }
  return { etat: { ...etat, conflits }, audit };
}

// ── Lecture (isolation par région) ─────────────────────────────────────────

const visiblePar = (acteur, c) => estAdmin(acteur) || (acteur.role === 'commandement' && c.assigneA === acteur.id && c.regId === acteur.regId);

export function conflitsVisibles(etat, acteur, ref = null) {
  if (!acteur) refuser(401, 'connexion requise');
  const liste = etat.conflits.filter((c) => visiblePar(acteur, c));
  if (!ref) return liste;
  return liste.map((c) => (c.proposition ? { ...c, evaluation: evaluerResolution(c, ref) } : c));
}

/** Conflit visible par l'acteur ; sinon 404 (on ne révèle pas qu'il existe). */
export function lireConflit(etat, acteur, conflitId, ref = null) {
  if (!acteur) refuser(401, 'connexion requise');
  const c = etat.conflits.find((x) => x.id === conflitId);
  if (!c || !visiblePar(acteur, c)) refuser(404, 'conflit introuvable');
  if (c.proposition && ref) {
    return { ...c, evaluation: evaluerResolution(c, ref) };
  }
  return c;
}

function majConflit(etat, c) {
  return { ...etat, conflits: etat.conflits.map((x) => (x.id === c.id ? c : x)) };
}

// ── Commandement régional : traitement et proposition ─────────────────────

export function marquerEnCours(etat, acteur, conflitId, date = new Date()) {
  exigerCommandement(acteur);
  const c = lireConflit(etat, acteur, conflitId);
  if (!['a-traiter', 'a-corriger'].includes(c.statut)) refuser(409, `statut actuel : ${STATUTS[c.statut]}`);
  const r = avecHistorique({ ...c, statut: 'en-cours' }, acteur, 'en-cours', {}, date);
  return { etat: majConflit(etat, r.conflit), conflit: r.conflit, audit: [r.audit] };
}

/**
 * Proposition d'un commandement sur SON conflit : déplacement, changement de faction ou
 * suppression d'un barage déplaçable du conflit, motivée. Jamais un barage fixe intouchable
 * (vérifié sur le jeu installé, pas sur le conflit), jamais une position hors de sa région.
 * Rien n'est modifié dans le référentiel opérationnel : la proposition attend la décision du
 * superadmin.
 */
export function soumettreProposition(etat, acteur, conflitId, corps, ref, date = new Date()) {
  exigerCommandement(acteur);
  const { type, barageId, position = null, nouvelleFaction = null, raison, validation = null } = corps ?? {};
  const c = lireConflit(etat, acteur, conflitId);
  if (c.informatif || c.statut === 'bloque-fixes') refuser(409, 'Bloqué — barrages fixes : aucune proposition possible');
  if (!['a-traiter', 'en-cours', 'a-corriger'].includes(c.statut)) refuser(409, `statut actuel : ${STATUTS[c.statut]}`);
  if (!['deplacement', 'suppression', 'faction', 'modification-faction'].includes(type)) refuser(400, 'type de proposition inconnu');
  if (!c.barages.some((b) => b.id === barageId)) refuser(400, 'ce barage ne fait pas partie du conflit');
  const actuel = ref.barage(barageId) ?? refuser(409, 'barage absent du jeu installé');
  if (ref.protege(actuel)) refuser(403, 'Barage fixe — intouchable : ni déplacement ni suppression ni changement de faction');
  if (!texteValide(raison, 5)) refuser(400, 'motif obligatoire (5 caractères au moins)');
  let pos = null;
  let nouvFaction = null;
  if (type === 'deplacement') {
    const [lon, lat] = Array.isArray(position) ? position.map(Number) : [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) refuser(400, 'position proposée invalide');
    if (!ref.dansRegion(acteur.regId, [lon, lat])) refuser(403, 'position proposée hors de la région du commandement');
    const statut = validation?.statut;
    if (statut === 'non-valide') refuser(400, 'emplacement non valide (espacement par la route) : proposition refusée');
    if (!['valide', 'verification-impossible'].includes(statut)) refuser(400, 'validation routière de l’emplacement manquante');
    if (statut === 'verification-impossible' && validation?.accepteIncertain !== true) refuser(400, 'vérification impossible : confirmation explicite requise');
    pos = { longitude: lon, latitude: lat };
  } else if (type === 'faction' || type === 'modification-faction') {
    nouvFaction = String(nouvelleFaction ?? '').trim();
    if (!CRENEAUX.includes(nouvFaction)) refuser(400, 'nouvelle faction invalide');
    if (nouvFaction === actuel.shift) refuser(400, 'la nouvelle faction doit être différente de la faction actuelle');
  }
  const proposition = {
    id: id('PRO'), type, barageId, position: pos, nouvelleFaction: nouvFaction, raison: raison.trim(),
    validation: validation ? {
      statut: validation.statut,
      minimumM: Number.isFinite(validation.minimumM) ? Math.round(validation.minimumM) : null,
      violations: (validation.violations ?? []).slice(0, 20),
      accepteIncertain: validation.accepteIncertain === true,
      seuilKm: validation.seuilKm ?? null,
    } : null,
    avant: { latitude: actuel.latitude, longitude: actuel.longitude, ...(type === 'faction' || type === 'modification-faction' ? { shift: actuel.shift, faction: factionDe(actuel) } : {}) },
    soumisePar: acteur.id, soumiseParNom: acteur.nom ?? 'Commandement', soumiseLe: date.toISOString(),
  };
  const r = avecHistorique(
    { ...c, statut: 'proposition-soumise', proposition, propositions: [...c.propositions, proposition] },
    acteur, 'proposition-soumise',
    { proposition: { id: proposition.id, type, barageId, position: pos, nouvelleFaction: nouvFaction, raison: proposition.raison } },
    date
  );
  return { etat: majConflit(etat, r.conflit), conflit: r.conflit, audit: [r.audit] };
}

// ── Évaluation de la résolution d'un conflit ───────────────────────────────

/**
 * Recalcule et vérifie la situation réelle après action de traitement selon les règles métier :
 * - Cas A (déplacement) : vérifie le partenaire d'origine et l'absence de conflit à la nouvelle position.
 * - Cas B (faction) : vérifie si le changement supprime réellement le conflit (non résolu si le partenaire
 *   est intouchable 24/24 ou s'il y a un autre barrage trop proche sur la nouvelle faction).
 * - Cas C (suppression) : vérifie que le barrage est déplaçable/supprimable (non protégé).
 */
export function evaluerResolution(c, ref) {
  if (!c || !c.proposition) {
    return { resolu: false, bloquant: false, motif: 'Aucune action effectuée sur ce conflit', statutVisuel: 'en-attente' };
  }
  const p = c.proposition;
  const b = ref?.barage ? ref.barage(p.barageId) : null;
  if (!b) {
    return { resolu: false, bloquant: true, motif: `Barrage ${p.barageId} absent du jeu installé`, statutVisuel: 'conflit-persistant' };
  }
  if (ref.protege && ref.protege(b)) {
    return { resolu: false, bloquant: true, motif: `Barrage ${b.id} protégé (intouchable) : aucune action autorisée`, statutVisuel: 'conflit-persistant' };
  }

  const partenaireSnapshot = c.barages.find((x) => x.id !== p.barageId);
  const partenaire = partenaireSnapshot && ref?.barage ? ref.barage(partenaireSnapshot.id) : null;

  if (p.type === 'deplacement') {
    if (!p.position || !Number.isFinite(p.position.longitude) || !Number.isFinite(p.position.latitude)) {
      return { resolu: false, bloquant: true, motif: 'Position proposée invalide', statutVisuel: 'conflit-persistant' };
    }
    // Si la validation routière soumise signale des violations : nouveau conflit
    if (p.validation?.statut === 'non-valide' || (p.validation?.violations && p.validation.violations.length > 0)) {
      const nb = p.validation.violations?.length ?? 1;
      return {
        resolu: false,
        bloquant: true,
        motif: `Nouveau conflit détecté : ${nb} barrage(s) trop proche(s) de la nouvelle position`,
        statutVisuel: 'conflit-persistant',
      };
    }
    // Vérification de la distance vis-à-vis du barrage partenaire d'origine
    if (partenaire) {
      const distLigne = distanceMetres([p.position.longitude, p.position.latitude], [partenaire.longitude, partenaire.latitude]);
      if (distLigne < (c.seuilM - MARGE_PLAUSIBILITE_M)) {
        return {
          resolu: false,
          bloquant: true,
          motif: `Le conflit initial persiste : distance vers ${partenaire.id} insuffisante (${Math.round(distLigne)} m ≤ seuil)`,
          statutVisuel: 'conflit-persistant',
        };
      }
    }
    // Vérification géométrique de sécurité par rapport aux autres barrages de même faction
    if (ref?.brut?.barages) {
      for (const autre of ref.brut.barages) {
        if (!autre || autre.id === b.id || (partenaire && autre.id === partenaire.id)) continue;
        if (ref.regDe && ref.regDe(autre) !== c.regId) continue;
        if (factionCommune(autre, b) !== null) {
          const d = distanceMetres([p.position.longitude, p.position.latitude], [autre.longitude, autre.latitude]);
          if (d < (c.seuilM - MARGE_PLAUSIBILITE_M)) {
            return {
              resolu: false,
              bloquant: true,
              motif: `Nouveau conflit détecté avec le barrage ${autre.id} (${Math.round(d)} m ≤ seuil)`,
              statutVisuel: 'conflit-persistant',
            };
          }
        }
      }
    }
    return {
      resolu: true,
      bloquant: false,
      motif: 'Conflit résolu : nouvel emplacement conforme aux règles d’espacement',
      statutVisuel: 'en-attente',
    };
  }

  if (p.type === 'faction' || p.type === 'modification-faction') {
    const nouv = p.nouvelleFaction;
    if (!nouv) {
      return { resolu: false, bloquant: true, motif: 'Nouvelle faction non renseignée', statutVisuel: 'conflit-persistant' };
    }
    const bModifie = { ...b, shift: nouv };
    // Le conflit persiste-t-il avec le partenaire ?
    if (partenaire) {
      const commune = factionCommune(partenaire, bModifie);
      if (commune !== null) {
        const estIntouchable = ref.protege && ref.protege(partenaire);
        return {
          resolu: false,
          bloquant: true,
          motif: `Conflit toujours présent : ${estIntouchable ? 'le barrage partenaire est fixe intouchable (24h/24)' : `conflit persistant sur le créneau ${commune}`}`,
          statutVisuel: 'conflit-persistant',
        };
      }
    }
    // Un nouveau conflit apparaît-il dans la nouvelle faction ?
    if (ref?.brut?.barages) {
      for (const autre of ref.brut.barages) {
        if (!autre || autre.id === b.id) continue;
        if (ref.regDe && ref.regDe(autre) !== c.regId) continue;
        const commune = factionCommune(autre, bModifie);
        if (commune !== null) {
          const d = distanceMetres([autre.longitude, autre.latitude], [b.longitude, b.latitude]);
          if (d < (c.seuilM - MARGE_PLAUSIBILITE_M)) {
            return {
              resolu: false,
              bloquant: true,
              motif: `Nouveau conflit détecté avec le barrage ${autre.id} dans la faction ${nouv} (${Math.round(d)} m)`,
              statutVisuel: 'conflit-persistant',
            };
          }
        }
      }
    }
    return {
      resolu: true,
      bloquant: false,
      motif: `Conflit résolu : changement de faction vers ${nouv} validé sans nouveau conflit`,
      statutVisuel: 'en-attente',
    };
  }

  if (p.type === 'suppression') {
    return {
      resolu: true,
      bloquant: false,
      motif: `Conflit résolu par suppression du barrage ${b.id}`,
      statutVisuel: 'en-attente',
    };
  }

  return { resolu: false, bloquant: true, motif: 'Type d’action non reconnu', statutVisuel: 'conflit-persistant' };
}

// ── Superadmin : décision et validation ────────────────────────────────────

/**
 * Approuver, rejeter ou renvoyer pour correction, toujours motivé.
 * L'approbation recalcule et vérifie obligatoirement la résolution effective du conflit.
 * En cas de conflit persistant ou de nouveau conflit bloquant, l'approbation est rejetée.
 */
export function decider(etat, acteur, conflitId, { decision, raison }, ref, date = new Date()) {
  exigerAdmin(acteur);
  const c = lireConflit(etat, acteur, conflitId);
  if (c.statut !== 'proposition-soumise' || !c.proposition) refuser(409, 'aucune proposition en attente de décision');
  if (!['approuver', 'rejeter', 'corriger'].includes(decision)) refuser(400, 'décision inconnue');
  if (!texteValide(raison, 3)) refuser(400, 'motif de la décision obligatoire');
  let evaluation = null;
  if (decision === 'approuver') {
    const b = ref.barage(c.proposition.barageId) ?? refuser(409, 'barage absent du jeu installé');
    if (ref.protege(b)) refuser(403, 'Barage fixe — intouchable : jamais approuvé');
    if (
      b.latitude !== c.proposition.avant.latitude ||
      b.longitude !== c.proposition.avant.longitude ||
      (c.proposition.avant.shift && b.shift !== c.proposition.avant.shift)
    ) {
      refuser(409, 'le barage a changé depuis la proposition : renvoyez-la pour correction');
    }
    evaluation = evaluerResolution(c, ref);
    if (!evaluation.resolu || evaluation.bloquant) {
      refuser(409, `approbation bloquée : ${evaluation.motif}`);
    }
  }
  const statut = { approuver: 'approuve', rejeter: 'rejete', corriger: 'a-corriger' }[decision];
  const d = {
    decision,
    raison: raison.trim(),
    par: acteur.id,
    parNom: acteur.nom ?? 'Superadmin',
    le: date.toISOString(),
    propositionId: c.proposition.id,
    evaluation,
  };
  const r = avecHistorique(
    { ...c, statut, decision: d, proposition: decision === 'corriger' ? null : c.proposition },
    acteur, `decision-${decision}`,
    { raison: d.raison, propositionId: d.propositionId, evaluation },
    date
  );
  return { etat: majConflit(etat, r.conflit), conflit: r.conflit, audit: [r.audit] };
}

/** Après installation du changement par le processus existant : l'administrateur clôt le conflit. */
export function marquerResolu(etat, acteur, conflitId, { note }, date = new Date()) {
  exigerAdmin(acteur);
  const c = lireConflit(etat, acteur, conflitId);
  if (c.statut !== 'approuve') refuser(409, 'seul un conflit approuvé (changement appliqué) peut être marqué résolu');
  if (!texteValide(note, 3)) refuser(400, 'note obligatoire (ex. « barages.json réinstallé le … »)');
  const r = avecHistorique({ ...c, statut: 'resolu' }, acteur, 'resolu', { note: note.trim() }, date);
  return { etat: majConflit(etat, r.conflit), conflit: r.conflit, audit: [r.audit] };
}

// ── Export des changements approuvés (processus d'installation existant) ──

/** Changements approuvés en attente d'installation, avec leur origine (auditables). */
export function changementsApprouves(etat, acteur) {
  exigerAdmin(acteur);
  return etat.conflits.filter((c) => c.statut === 'approuve' && c.proposition).map((c) => ({
    conflitId: c.id, regId: c.regId, regNom: c.regNom, propositionId: c.proposition.id, type: c.proposition.type, barageId: c.proposition.barageId,
    nouvelleFaction: c.proposition.nouvelleFaction ?? null,
    avant: c.proposition.avant, apres: c.proposition.position, raison: c.proposition.raison,
    soumisePar: c.proposition.soumisePar, soumiseLe: c.proposition.soumiseLe, approuvePar: c.decision.par, approuveLe: c.decision.le, motifDecision: c.decision.raison,
  }));
}

/**
 * barages.json à installer : le jeu installé + les changements approuvés. Aucun barage fixe
 * touché ; deux changements approuvés sur un même barage : refus (à arbitrer). Rien n'est écrit
 * côté serveur : c'est un fichier à télécharger.
 */
export function baragesAvecChangements(etat, acteur, ref) {
  const changements = changementsApprouves(etat, acteur);
  const parBarage = new Map();
  for (const ch of changements) parBarage.set(ch.barageId, [...(parBarage.get(ch.barageId) ?? []), ch]);
  const doubles = [...parBarage].filter(([, l]) => l.length > 1).map(([b]) => b);
  if (doubles.length) refuser(409, `plusieurs changements approuvés pour ${doubles.join(', ')} : à arbitrer avant export`);
  const barages = [];
  const retraits = [];
  for (const b of ref.brut.barages ?? []) {
    const ch = parBarage.get(b?.id)?.[0];
    if (!ch) { barages.push(b); continue; }
    if (ref.protege(b)) refuser(403, `${b.id} : Barage fixe — intouchable`);
    if (b.latitude !== ch.avant.latitude || b.longitude !== ch.avant.longitude) refuser(409, `${b.id} a changé depuis l’approbation`);
    if (ch.type === 'suppression') {
      // L'enregistrement d'origine est gardé dans le fichier (historique), hors du jeu actif.
      retraits.push({ barage: b, conflitId: ch.conflitId, propositionId: ch.propositionId, approuveLe: ch.approuveLe, raison: ch.raison });
      continue;
    }
    if (ch.type === 'faction' || ch.type === 'modification-faction') {
      barages.push({ ...b, shift: ch.nouvelleFaction, validation: { methode: 'proposition-approuvee', conflitId: ch.conflitId, propositionId: ch.propositionId, date: ch.approuveLe, avant: ch.avant } });
      continue;
    }
    barages.push({ ...b, latitude: ch.apres.latitude, longitude: ch.apres.longitude, validation: { methode: 'proposition-approuvee', conflitId: ch.conflitId, propositionId: ch.propositionId, date: ch.approuveLe, avant: ch.avant } });
  }
  return {
    ...ref.brut, source: `${ref.brut.source ?? 'jeu installé'} + ${changements.length} changement(s) approuvé(s)`, barages,
    retraitsApprouves: [...(ref.brut.retraitsApprouves ?? []), ...retraits], changementsAppliques: changements.map((c) => c.propositionId),
  };
}
