/**
 * Accès à l'API d'habilitation (voir serveur/api.mjs).
 *
 * Le jeton de session vit dans un cookie `HttpOnly` : ce fichier ne le voit
 * jamais et n'a rien à stocker. D'où `credentials: 'same-origin'` sur chaque
 * appel — c'est le navigateur qui joint la session.
 *
 * Toute écriture porte l'en-tête `X-Requested-With`, exigé par le serveur :
 * un formulaire hébergé ailleurs ne peut pas le poser, donc pas de requête
 * falsifiée depuis un autre site.
 */

import { enModeFictif, SOURCE_ACTIVE } from './donnees/sourceDonnees.js';

const BASE = 'api';

/** Erreur portant le code HTTP : l'appelant distingue 401 (non connecté)
 *  de 403 (hors périmètre) sans analyser un message. */
export class ErreurApi extends Error {
  constructor(message, statut, donnees = null) {
    super(message);
    this.name = 'ErreurApi';
    this.statut = statut;
    /* Le corps de la réponse refusée : un 409 de « Modifier barrage » y porte
       `code` et l'aperçu recalculé, que l'écran relit pour demander la
       confirmation au lieu d'afficher une simple erreur. */
    this.donnees = donnees;
  }
}

/**
 * SOURCE DES DONNÉES — le seul aiguillage de ce fichier.
 *
 * En mode fictif, la requête ne part pas sur le réseau : elle est servie par
 * `repondreFictif`, qui rejoue les mêmes chemins et rend les mêmes formes
 * (voir src/donnees/sourceDonnees.js pour l'interrupteur, et le fournisseur
 * pour ce qui est réellement simulé).
 *
 * L'AIGUILLAGE EST ICI, ET NULLE PART AILLEURS. Les quarante-cinq fonctions
 * ci-dessous, leurs arguments et leurs réponses ne changent pas d'un mode à
 * l'autre ; les neuf écrans qui les appellent n'ont donc rien à savoir de la
 * source, et le jour du branchement sur l'API réelle il n'y a pas une ligne
 * d'interface à reprendre.
 *
 * Le module fictif est chargé à la demande (`import()`) : un build de
 * production qui n'en veut pas ne l'embarque pas dans le lot principal.
 */
let fictif = null;
const chargerFictif = async () => {
  if (!fictif) {
    fictif = await import('./donnees/fictif/fournisseurFictif.js');
    fictif.poserFabriqueErreur((message, statut) => new ErreurApi(message, statut));
  }
  return fictif;
};

/**
 * ÉCRITURES APRÈS LESQUELLES LE SERVEUR DÉTECTE LES CONFLITS — celles dont la
 * route appelle `actualiserSuiviConflits` (serveur/api.mjs) : faction,
 * modification d'un barrage, assignation, transmission, traitement, action
 * sur une demande. La détection a lieu PENDANT la requête ; son début et sa
 * fin sont annoncés (`gr-detection-conflits`) pour que la carte relise la
 * liste des conflits à ce moment-là, et seulement là — sans relevé
 * périodique. Mode fictif : pas de serveur, pas de détection, rien d'annoncé.
 */
const DECLENCHE_DETECTION =
  /^(barrages\/[^/?]+\/(faction|modification)|barrages\/assigner|assignations\/[^/?]+\/(transmettre|traiter)|demandes\/[^/?]+\/action)(\?|$)/;

const annoncerDetection = (detail) => window.dispatchEvent(new CustomEvent('gr-detection-conflits', { detail }));

async function appel(chemin, options = {}) {
  const methode = options.methode ?? 'GET';
  if (methode === 'GET' || typeof window === 'undefined' || enModeFictif() || !DECLENCHE_DETECTION.test(chemin)) {
    return appelDirect(chemin, options);
  }
  annoncerDetection({ phase: 'debut' });
  let ok = false;
  try {
    const r = await appelDirect(chemin, options);
    ok = true;
    return r;
  } finally {
    annoncerDetection({ phase: 'fin', ok });
  }
}

async function appelDirect(chemin, { methode = 'GET', corps } = {}) {
  if (enModeFictif()) {
    const { repondreFictif } = await chargerFictif();
    return repondreFictif(chemin, methode, corps);
  }

  let reponse;
  try {
    reponse = await fetch(`${BASE}/${chemin}`, {
      method: methode,
      credentials: 'same-origin',
      headers: {
        ...(corps ? { 'Content-Type': 'application/json' } : {}),
        ...(methode === 'GET' ? {} : { 'X-Requested-With': 'gr-carte' }),
      },
      body: corps ? JSON.stringify(corps) : undefined,
    });
  } catch {
    // Réseau injoignable : distingué d'un refus, le message doit le dire.
    throw new ErreurApi("Serveur d'habilitation injoignable.", 0);
  }

  if (reponse.status === 204) return null;

  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    donnees = null;
  }

  if (!reponse.ok) {
    /**
     * 428 — MOT DE PASSE TEMPORAIRE À CHANGER.
     *
     * Le serveur refuse tout à une session dans cet état. Plutôt que de
     * laisser chaque appelant traiter ce cas (ils sont des dizaines), on
     * prévient l'application une fois : `App` écoute et repasse sur l'écran
     * de changement. L'erreur est tout de même levée, pour que l'appel en
     * cours ne croie pas avoir réussi.
     */
    if (reponse.status === 428 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gr-mot-de-passe-a-changer'));
    }
    /**
     * 401 — LA SESSION N'EXISTE PLUS côté serveur (elles vivent en mémoire :
     * un redémarrage les efface ; elles expirent aussi après 8 h). Sans ce
     * signal, la carte restait affichée « connectée » et chaque écriture
     * échouait sur « Connexion requise ». `App` revient à la connexion et
     * dit pourquoi. La connexion elle-même (mauvais code) n'est pas concernée.
     */
    if (reponse.status === 401 && typeof window !== 'undefined' && !/^(session|motdepasse)(\/|\?|$)/.test(chemin)) {
      window.dispatchEvent(new CustomEvent('gr-session-perdue'));
    }
    throw new ErreurApi(donnees?.erreur ?? `Erreur ${reponse.status}.`, reponse.status, donnees);
  }

  return donnees;
}

/* ------------------------------------------------------------------ */
/* Service                                                            */
/* ------------------------------------------------------------------ */

/** Source réellement en service — lue par le bandeau de mode. */
export const sourceDonnees = () => SOURCE_ACTIVE;

/** État du service : sert à savoir si la saisie est possible du tout. */
export const etatService = () => appel('etat');

/** Unités proposées à la connexion. */
export const unites = () => appel('unites');

/* ------------------------------- session --------------------------- */

/**
 * Identité courante, ou `null` si personne n'est connecté.
 *
 * Le serveur répond 200 avec `session: null` pour un visiteur anonyme : la
 * question « qui suis-je ? » a une réponse, ce n'est pas un refus. Le 401 reste
 * toléré ici pour les serveurs plus anciens du parc, qui répondaient ainsi —
 * une carte ne doit pas cesser de s'ouvrir parce que le service n'a pas encore
 * été mis à jour.
 */
/**
 * LA SESSION, ET L'ÉTAT DE SON MOT DE PASSE.
 *
 * Rend `{ session, motDePasseAChanger }` et non la seule session : un compte
 * ouvert avec un mot de passe temporaire doit retrouver l'écran de changement
 * après un simple rechargement de page, pas se retrouver dans l'application.
 */
export async function session() {
  try {
    const r = await appel('session');
    return { session: r.session ?? null, motDePasseAChanger: r.motDePasseAChanger === true };
  } catch (err) {
    if (err.statut === 401) return { session: null, motDePasseAChanger: false };
    throw err;
  }
}

/** Même forme que `session()` : l'appelant traite les deux de la même façon. */
export const connexion = (rang, unite, code) =>
  appel('session', { methode: 'POST', corps: { rang, unite, code } }).then((r) => ({
    session: r.session,
    motDePasseAChanger: r.motDePasseAChanger === true,
  }));

export const deconnexion = () => appel('session', { methode: 'DELETE' });

/**
 * CHANGER SON PROPRE MOT DE PASSE.
 *
 * `actuel` n'est exigé que HORS premier accès : au premier, l'ancien est le
 * mot de passe temporaire que la personne vient de taper. Le serveur en juge —
 * ce n'est pas au navigateur de décider quand la preuve est requise.
 *
 * La réponse porte `reconnexionRequise` : toutes les sessions du compte sont
 * fermées, y compris celle-ci.
 */
export const changerMotDePasse = ({ nouveau, confirmation, actuel }) =>
  appel('motdepasse', { methode: 'POST', corps: { nouveau, confirmation, actuel } });

/**
 * L'ARBRE COMPLET, CHIFFRÉ — régions, compagnies, brigades.
 *
 * Un seul appel donne tout ce que la session a le droit de voir, à chaque
 * échelon : postes, effectif, postes tenus. C'est ce qui permet le « VOIR
 * TOUT » sans ouvrir les vingt-huit régions une par une.
 *
 * Le cloisonnement est celui du serveur : un chef de région n'y trouve que sa
 * région. Rien à filtrer ici.
 */
export const hierarchie = () => appel('hierarchie');

/* ------------------------------ marquages -------------------------- */

export const listerMarquages = () => appel('marquages').then((r) => r.items);

export const creerMarquage = (champs) =>
  appel('marquages', { methode: 'POST', corps: champs }).then((r) => r.item);

export const modifierMarquage = (id, champs) =>
  appel(`marquages/${id}`, { methode: 'PATCH', corps: champs }).then((r) => r.item);

export const supprimerMarquage = (id) => appel(`marquages/${id}`, { methode: 'DELETE' });

/**
 * DÉPLACER un repère — la même route PATCH que `modifierMarquage`, mais la
 * réponse ENTIÈRE est rendue : un barrage déplacé par une unité part en
 * validation (202, `enAttente`, `demande`), et l'écran doit le dire au lieu
 * d'annoncer « repositionné ».
 */
export const deplacerMarquage = (id, { lng, lat, route, ...reste }) =>
  appel(`marquages/${id}`, {
    methode: 'PATCH',
    corps: { lng, lat, ...(route !== undefined ? { route } : {}), ...reste },
  });

/* ------------------------- modifier un barrage ---------------------- */
/**
 * « MODIFIER BARRAGE » — effectif du créneau et protection, en UNE opération.
 * Le déplacement n'en fait pas partie : il passe par `deplacerMarquage`.
 *   { effectif }                  nombre d'éléments du créneau en cours
 *   { intouchable, factionId? }   protection (factionId : si elle est retirée)
 *   { accepterConflits, remplacerIntouchable }   confirmations demandées par un 409
 */
export const enregistrerModificationBarrage = (id, corps) =>
  appel(`barrages/${id}/modification`, { methode: 'POST', corps });

export const importerMarquages = (items) =>
  appel('marquages/import', { methode: 'POST', corps: { items } });

/** Points noirs importants -> barrages-projets, sous réserve de distance minimale. */
export const genererBarrages = (options = {}) =>
  appel('marquages/generer', { methode: 'POST', corps: options });

/**
 * Recalcul du dispositif (admin) : quels barrages garder, lesquels annuler
 * pour un espacement minimal donné, mesuré par la route.
 *
 * Les barrages d'entrée/sortie de ville sont retenus d'office. `appliquer`
 * laissé à faux ne renvoie qu'une recommandation — rien n'est écrit tant que
 * l'administrateur ne l'a pas demandé explicitement.
 */
/**
 * OPTIMISATION — une seule question posée au serveur :
 * « quels barrages FIXES du périmètre sont à moins de X km de leur voisin ? »
 *
 * Les trois drapeaux de l'étape 3 n'entrent JAMAIS dans la mesure de distance.
 * Ils se partagent en deux natures :
 *
 *   `accidents` (+ `seuilAccidents`, 0 à 50)  joint à chaque poste son nombre
 *       d'accidents, et rend intouchables ceux qui ATTEIGNENT ce seuil (borne
 *       comprise : à 4, un poste de 4 accidents est exclu) ;
 *   `vip`, `nonEclaire`                       PROTÈGENT : les postes qui
 *       portent ces caractères deviennent intouchables — jamais proposés au
 *       retrait. Les entrées de ville le sont d'office, sans interrupteur.
 *
 * La route ne fait que mesurer : elle n'écrit jamais.
 */
export const optimiserParDistance = ({
  distanceMinKm,
  niveau,
  unite,
  positionVille,
  accidents,
  seuilAccidents,
  vip,
  nonEclaire,
  factionId = null,
  /* Décisions SIMULÉES (conserver / déplacer / supprimer) : le serveur les
     applique à une copie et mesure l'état obtenu. Rien n'est écrit. */
  decisions = null,
  /* La décision que l'utilisateur vient de prendre — tracée au journal. */
  decisionNouvelle = null,
}) =>
  appel('barrages/consolidation', {
    methode: 'POST',
    corps: {
      decisions,
      decisionNouvelle,
      /* La faction du filtre de la carte : l'analyse manuelle, comme
         l'automatique, ne confronte que des postes tenus en même temps. */
      factionId,
      distanceMinKm,
      niveau: niveau ?? null,
      unite: unite ?? null,
      /* Barrages spéciaux : filtre ce qui est RAPPORTÉ, jamais ce qui est
         mesuré — le voisinage reste cherché parmi tous les fixes du
         périmètre, sans quoi les distances seraient fausses. */
      positionVille: positionVille ?? null,
      /* Aucun des trois ne change le jugement de distance — voir le
         commentaire de la route. */
      accidents: accidents === true,
      /* Ignoré côté serveur si `accidents` est éteint : un seuil sans
         information à joindre ne veut rien dire. */
      seuilAccidents: Number(seuilAccidents) || 0,
      vip: vip === true,
      nonEclaire: nonEclaire === true,
    },
  });

/**
 * OPTIMISATION AUTOMATIQUE — SIMULATION SEULE, aucune écriture.
 *
 * AUCUN SEUIL DE RÉDUCTION N'EST ENVOYÉ, et il n'y en a plus à envoyer. Quatre
 * ont existé — plafond en nombre, plafond en pourcentage, plancher de
 * couverture, perte tolérée — et tous ont été retirés : ils demandaient un
 * chiffre que le métier ne permet pas de justifier, et ce chiffre décidait
 * pourtant combien de postes tombaient. Le nombre de propositions est
 * maintenant ce qui reste une fois les règles appliquées.
 *
 * Ne partent donc que des DONNÉES :
 *
 *   `distanceMinKm`  le seuil de rapprochement déjà en service, partagé avec
 *                    le mode manuel — il dit ce qui est proche, pas combien
 *                    retirer ;
 *   `accidents` / `seuilAccidents` / `vip` / `nonEclaire` les bascules de
 *                    protection, identiques à celles de la consolidation ;
 *   `exclusIds`      les postes que l'utilisateur a sortis de la proposition
 *                    ou décidé de conserver — ils rejoignent les protégés.
 */
export const analyserOptimisationAuto = ({ factionId = null, niveau = null, unite = null, distanceMinKm = null, seuilKm = null } = {}) =>
  appel('barrages/optimisation-auto', {
    methode: 'POST',
    /* La faction montrée par le filtre de la carte, et la zone consultée
       (`porteeCourante`). Le serveur revalide les deux contre le RBAC : la zone
       ne peut que RESTREINDRE le périmètre du compte. */
    corps: {
      factionId,
      niveau,
      unite,
      distanceMinKm: distanceMinKm ?? seuilKm ?? null,
      seuilKm: seuilKm ?? distanceMinKm ?? null,
    },
  });

/** Ce que l'optimisation automatique prendrait en compte — sans la calculer. */
export const perimetreOptimisationAuto = ({ factionId = null, niveau = null, unite = null, distanceMinKm = null, seuilKm = null } = {}) => {
  const q = new URLSearchParams();
  if (factionId) q.set('factionId', factionId);
  if (niveau && niveau !== 'national' && unite) {
    q.set('niveau', niveau);
    q.set('unite', unite);
  }
  const seuil = seuilKm ?? distanceMinKm;
  if (seuil) q.set('seuilKm', String(seuil));
  return appel(`barrages/optimisation-auto/perimetre${q.size ? '?' + q : ''}`);
};

/**
 * APPLICATION DE L'OPTIMISATION AUTOMATIQUE — les barrages retenus CHANGENT DE
 * FACTION, et une demande de validation part au commandement concerné. Rien
 * n'est effacé, rien n'est déplacé, tout est restaurable.
 *
 * `resume`, `poids` et `criteres` ne servent pas au calcul : ils sont recopiés
 * dans le rapport d'optimisation, qui doit rester lisible sans avoir à
 * relancer quoi que ce soit.
 */
export const appliquerOptimisationAuto = ({
  simulationId,
  propositions,
  parametres = null,
  resume = null,
  poids = null,
  criteres = null,
}) =>
  /* Chaque proposition porte `action: 'changer_faction'` et la faction
     d'arrivée — rien d'autre. Aucune position n'est envoyée : le barrage est
     intouchable, et le serveur refuse toute autre action. */
  appel('barrages/appliquer-optimisation-auto', {
    methode: 'POST',
    corps: { simulationId, propositions, parametres, resume, poids, criteres },
  });

/**
 * ACTIVER UNE OPTIMISATION MANUELLE — les décisions simulées par le serveur
 * (`simulationId`), revalidées par la même route sécurisée que l'automatique.
 */
export const appliquerOptimisationManuelle = ({ simulationId, decisions }) =>
  appel('barrages/appliquer-optimisation-auto', {
    methode: 'POST',
    corps: { mode: 'manuel', simulationId, decisions },
  });

/** Une simulation est-elle encore applicable ? Lecture seule — l'activation refait ses contrôles. */
export const etatSimulationOptimisation = (id) =>
  appel(`barrages/optimisation/simulation?id=${encodeURIComponent(id)}`);

/**
 * LES REPOSITIONNEMENTS RÉCENTS — repères « barrage nouvellement posé » rendus
 * par le serveur (journal + demandes ouvertes), avec, pour un changement
 * officiel, les distances routières avant/après au seuil demandé.
 */
/** Historique des conflits définitivement approuvés — filtres facultatifs. */
export const historiqueConflits = (filtres = {}) => {
  const qs = new URLSearchParams(Object.entries(filtres).filter(([, v]) => v != null && String(v).trim() !== '')).toString();
  return appel(`conflits/historique${qs ? `?${qs}` : ''}`);
};

/** Correction exceptionnelle de l'historique (Superadmin) : rouvre un conflit clos. */
export const rouvrirConflit = (id, motif) =>
  appel(`conflits/${encodeURIComponent(id)}/rouvrir`, { methode: 'POST', corps: { motif } });

/** Préférences d'affichage du compte connecté (thème). */
export const lirePreferences = () => appel('preferences');
export const enregistrerPreferences = (preferences) => appel('preferences', { methode: 'PUT', corps: preferences });

export const repositionnements = ({ seuilKm = null, factionId = null } = {}) => {
  const q = new URLSearchParams();
  if (seuilKm != null) q.set('seuilKm', String(seuilKm));
  if (factionId) q.set('factionId', factionId);
  const qs = q.toString();
  return appel(`barrages/repositionnements${qs ? `?${qs}` : ''}`);
};

/**
 * OUTILS DE PRÉSENTATION — référence et restauration du dispositif de
 * démonstration. Le serveur vérifie le mode (démo), le rang (administrateur)
 * et le mot de confirmation : l'écran ne fait que le transmettre.
 */
export const etatPresentation = () => appel('presentation');
export const enregistrerReferencePresentation = (confirmation) =>
  appel('presentation/reference', { methode: 'POST', corps: { confirmation } });
export const restaurerPresentation = (confirmation) =>
  appel('presentation/restaurer', { methode: 'POST', corps: { confirmation } });

/**
 * ↶ RESTAURER AVANT SIMULATION — instantané pris au début d'une simulation, puis
 * retour à cet état. Indépendant de la référence de présentation.
 */
export const instantaneSimulation = () => appel('optimisation/instantane', { methode: 'POST', corps: {} });
export const restaurerAvantSimulation = (id) =>
  appel('optimisation/restaurer-avant-simulation', { methode: 'POST', corps: { id } });

/** Le journal des décisions d'optimisation (journal existant, catégorie « optimisation »). */
export const journalOptimisation = (limite = 30) => appel(`journal?categorie=optimisation&limite=${limite}`);

/** HISTORIQUE DES OPTIMISATIONS APPLIQUÉES — figé, jamais recalculé. */
export const listerRapportsOptimisation = () => appel('barrages/rapports-optimisation');

/* ------------------------------ factions ------------------------------ */

/**
 * LES TOURS DE SERVICE — définition, faction en cours, et affectations.
 *
 * TOUT VIENT DU SERVEUR, y compris la faction courante. Le navigateur ne la
 * déduit PAS de sa propre horloge : un poste de travail mal réglé — ou
 * simplement dans un autre fuseau — afficherait un tour de service différent de
 * celui où les hommes sont réellement postés. C'est l'heure locale du serveur
 * qui fait foi, comme pour la saisie des relèves.
 *
 * `assignations` donne, par barrage, les factions sur lesquelles il est tenu.
 * Le périmètre du compte est déjà appliqué : demander une faction ne montre
 * jamais un poste qu'on n'aurait pas le droit de voir.
 *
 * @param {string|null} date `AAAA-MM-JJ` pour consulter une autre journée.
 */
export const listerFactions = (date = null) =>
  appel(`factions${date ? `?date=${encodeURIComponent(date)}` : ''}`);

/**
 * LISTE DES BARRAGES RETIRÉS PAR OPTIMISATION.
 */
export const listerBarragesRetiresOptimisation = ({ niveau = null, unite = null } = {}) => {
  const params = new URLSearchParams();
  if (niveau) params.set('niveau', niveau);
  if (unite) params.set('unite', unite);
  const q = params.toString();
  return appel(`barrages/retires-optimisation${q ? '?' + q : ''}`);
};

/**
 * RESTAURATION D'UN BARRAGE RETIRÉ PAR OPTIMISATION — Redevient ACTIF avec données originales.
 */
export const restaurerBarrageOptimisation = (id) =>
  appel(`barrages/${id}/restaurer-optimisation`, {
    methode: 'POST',
  });

/* ------------------- optimisation par route / par trajet ------------------- */

/**
 * OPTIMISATION PAR ROUTE OU PAR TRAJET — réservée au Superadmin, voir
 * serveur/corridorRoutier.mjs. Le corridor se décrit, il ne se dessine pas :
 * `{type:'route', ref, km}` ou `{type:'trajet', trajetId, variante, km}` ; le
 * serveur en recalcule le tracé lui-même.
 */
export const listerRoutes = () => appel('routes');
export const villesRoutes = () => appel('routes/villes');
export const traceRoute = (ref) => appel(`routes/trace?ref=${encodeURIComponent(ref)}`);
export const routeAuPoint = (lng, lat) => appel(`routes/au-point?lng=${lng}&lat=${lat}`);
export const calculerTrajet = (depart, arrivee) =>
  appel('routes/trajet', { methode: 'POST', corps: { depart, arrivee } });
export const perimetreCorridor = ({ corridor, factionId = null }) =>
  appel('routes/perimetre', { methode: 'POST', corps: { corridor, factionId } });
/** La simulation : le même calcul que l'automatique, limité au corridor. Rien n'est écrit. */
export const analyserOptimisationRoute = ({ corridor, factionId = null }) =>
  appel('barrages/optimisation-auto', { methode: 'POST', corps: { corridor, factionId } });
/**
 * LES CONFLITS DU CORRIDOR, faction par faction (serveur/conflitsFaction.mjs).
 * `ids` : ne remesurer que les paires touchant ces barrages — après un traitement.
 */
export const conflitsCorridor = ({ corridor, factionId = null, ids = null }) =>
  appel('routes/conflits', { methode: 'POST', corps: { corridor, factionId, ids } });
/** Le trajet routier entre deux barrages (liaison d'un conflit sur la carte). */
export const traceEntreBarrages = (a, b) => appel('routes/trace-entre', { methode: 'POST', corps: { a, b } });

/**
 * CHANGER LA FACTION D'UN BARRAGE — la même route PATCH que toute correction
 * de fiche : contrôles de périmètre, journal, et circuit de validation. La
 * réponse ENTIÈRE est rendue : un barrage rattaché part en validation (202,
 * `enAttente`), et l'écran doit le dire au lieu d'annoncer le changement.
 */
export const changerFactionBarrage = (id, factionId) =>
  appel(`marquages/${id}`, { methode: 'PATCH', corps: { factionId } });

/**
 * LA FACTION D'UN BARRAGE, GÉRÉE PAR LE CMND CIE OU LE CMND RÉGION — écriture
 * directe sur son périmètre, journalisée (serveur : POST /api/barrages/:id/faction).
 * `factionBarrage` rend la faction actuelle, celles autorisées et l'historique.
 */
export const factionBarrage = (id) => appel(`barrages/${encodeURIComponent(id)}/faction`);
export const changerFactionCommandement = (id, factionId, extra = {}) =>
  appel(`barrages/${encodeURIComponent(id)}/faction`, { methode: 'POST', corps: { factionId, ...extra } });

/** Le Super Admin remet des barrages au CMND Région qui les porte, pour traitement. */
export const assignerBarrages = (ids, texte = '', options = {}) =>
  appel('barrages/assigner', { methode: 'POST', corps: { ids, texte, ...options } });

/**
 * LES ASSIGNATIONS — Super Admin → CMND Région → CMND Cie (serveur : /api/assignations).
 * `listerAssignations` rend `{ aTraiter, suivi }` pour le compte connecté.
 */
export const listerAssignations = () => appel('assignations');
export const cmndCieAssignation = (id) => appel(`assignations/${encodeURIComponent(id)}/cmnd-cie`);
export const transmettreAssignation = (id, matricule, texte = '') =>
  appel(`assignations/${encodeURIComponent(id)}/transmettre`, { methode: 'POST', corps: { matricule, texte } });
/** Traiter : changer la faction (si `factionId`) et clore l'assignation, avec un commentaire. */
export const traiterAssignation = (id, { factionId = null, commentaire = '' } = {}) =>
  appel(`assignations/${encodeURIComponent(id)}/traiter`, { methode: 'POST', corps: { factionId, commentaire } });

/**
 * LE SUIVI DU WORKFLOW — Super Admin, lecture seule (serveur : /api/assignations/suivi).
 * Rend `{ items, totaux }` : une ligne par chaîne d'assignation, statut lu en base.
 */
export const suiviAssignations = () => appel('assignations/suivi');

/**
 * LE SUIVI DES CONFLITS — visibles selon le rôle et périmètre (CMD_REGION, CMD_COMPAGNIE, Super Admin).
 * Rend `{ items, totaux }` : liste des conflits réels détectés et leur historique.
 */
export const listerConflits = (statut = null) =>
  appel(`conflits${statut ? `?statut=${encodeURIComponent(statut)}` : ''}`);
export const detailConflit = (id) => appel(`conflits/${encodeURIComponent(id)}`);
export const historiqueConflit = (id) => appel(`conflits/${encodeURIComponent(id)}/historique`);
export const listerCmndRegionConflit = (id = null, { barrageAId = null, barrageBId = null, regA = null, regB = null } = {}) => {
  const params = new URLSearchParams();
  if (id) params.set('id', id);
  if (barrageAId) params.set('barrageAId', barrageAId);
  if (barrageBId) params.set('barrageBId', barrageBId);
  if (regA) params.set('regA', regA);
  if (regB) params.set('regB', regB);
  const q = params.toString();
  return appel(`conflits/cmnd-reg${q ? `?${q}` : ''}`);
};
export const assignerConflit = (id, { matricule, matricules, consigne, conflitData }) =>
  appel(`conflits/${encodeURIComponent(id)}/assigner`, {
    methode: 'POST',
    corps: {
      matricule: Array.isArray(matricules) && matricules.length > 0 ? matricules[0] : matricule,
      matricules: Array.isArray(matricules) ? matricules : (matricule ? [matricule] : []),
      consigne,
      conflitData,
    },
  });
export const desassignerConflit = (id) =>
  appel(`conflits/${encodeURIComponent(id)}/desassigner`, {
    methode: 'POST',
  });
export const listerCmndCieConflit = (id, { reg = null } = {}) => {
  const params = new URLSearchParams();
  if (reg) params.set('reg', reg);
  const q = params.toString();
  return appel(`conflits/${encodeURIComponent(id)}/cmnd-cie${q ? `?${q}` : ''}`);
};
export const transmettreConflit = (id, { matricule, consigne, conflitData } = {}) =>
  appel(`conflits/${encodeURIComponent(id)}/transmettre`, {
    methode: 'POST',
    corps: { matricule, consigne, conflitData },
  });
export const traiterConflit = (id, { action, details }) =>
  appel(`conflits/${encodeURIComponent(id)}/traiter`, {
    methode: 'POST',
    corps: { action, details },
  });
/**
 * `etatAttendu` : l'état de workflow que l'écran affichait. Si le conflit a
 * changé entre-temps (autre validateur, double clic), le serveur refuse (409)
 * au lieu d'appliquer la décision à un état que l'utilisateur n'a pas vu.
 */
/**
 * ACTIONS SIMPLES DU WORKFLOW — prendre_en_charge (CMD Région), commencer
 * (CMD CIE), cloturer (Super Admin). Le serveur vérifie rôle, état et périmètre.
 */
export const actionConflit = (id, action, { motif = '', etatAttendu = null } = {}) =>
  appel(`conflits/${encodeURIComponent(id)}/action`, { methode: 'POST', corps: { action, motif, etatAttendu } });

export const deciderConflit = (id, { decision, raison, etatAttendu = null }) =>
  appel(`conflits/${encodeURIComponent(id)}/decider`, {
    methode: 'POST',
    corps: { decision, raison, etatAttendu },
  });
export const supprimerConflit = (id, options = {}) => {
  const params = new URLSearchParams();
  if (options?.paireCle) params.set('paire', options.paireCle);
  if (options?.barrageAId) params.set('barrageAId', options.barrageAId);
  if (options?.barrageBId) params.set('barrageBId', options.barrageBId);
  const q = params.toString();
  return appel(`conflits/${encodeURIComponent(id)}${q ? `?${q}` : ''}`, {
    methode: 'DELETE',
    corps: options && Object.keys(options).length > 0 ? options : undefined,
  });
};
export const assignerConflitsGroupe = (ids, { matricule, matricules, consigne, conflitsData } = {}) =>
  appel('conflits/assigner-groupe', {
    methode: 'POST',
    corps: {
      ids: Array.isArray(ids) ? ids : [ids],
      matricule: Array.isArray(matricules) && matricules.length > 0 ? matricules[0] : matricule,
      matricules: Array.isArray(matricules) ? matricules : (matricule ? [matricule] : []),
      consigne,
      conflitsData,
    },
  });
export const supprimerConflitsGroupe = (ids) =>
  appel('conflits/supprimer-groupe', {
    methode: 'POST',
    corps: {
      ids: Array.isArray(ids) ? ids : [ids],
    },
  });
export const viderConflits = () =>
  appel('conflits', { methode: 'DELETE' });
export const restaurerConflits = (paires) =>
  appel('conflits/restaurer', {
    methode: 'POST',
    corps: { paires: Array.isArray(paires) ? paires : [paires] },
  });

/* ---------------------- notifications d'événements ---------------------- */

/**
 * CE QUI VIENT DE CHANGER — voir serveur/notifications.mjs.
 *
 * À ne pas confondre avec `listerNotifications` plus bas : celles-là sont des
 * DÉCISIONS à rendre (route `instructions`). Celles-ci se lisent, une fois :
 * `{ items, nonLues }`, chaque item portant `lue` pour le compte connecté.
 */
export const listerNotificationsEvenements = () => appel('notifications');

/** Ouverte : lue pour ce compte. Rend `{ item, nonLues }`. */
export const marquerNotificationLue = (id) =>
  appel(`notifications/${encodeURIComponent(id)}/lue`, { methode: 'POST' });

/**
 * LE FLUX TEMPS RÉEL — `onEvenement` est appelé à chaque notification qui
 * concerne ce compte. Rend la fonction qui ferme le flux.
 *
 * `onPanne` : le flux n'a pas pu s'établir (relais qui le coupe, navigateur
 * sans EventSource). L'appelant passe alors à une relecture périodique. En
 * mode fictif, il n'y a pas de serveur pour émettre : rien n'est ouvert.
 */
export const abonnerNotifications = (onEvenement, onPanne = null) => {
  if (enModeFictif() || typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    onPanne?.();
    return () => {};
  }
  const flux = new window.EventSource(`${BASE}/notifications/flux`, { withCredentials: true });
  let ouvert = false;
  flux.addEventListener('open', () => {
    ouvert = true;
  });
  flux.addEventListener('notification', (e) => {
    try {
      onEvenement(JSON.parse(e.data));
    } catch {
      onEvenement(null);
    }
  });
  flux.addEventListener('error', () => {
    /* Jamais établi (401, relais hostile) : on n'insiste pas, l'appelant relit
       périodiquement. Établi puis coupé : EventSource se reconnecte seul. */
    if (!ouvert) {
      flux.close();
      onPanne?.();
    }
  });
  return () => flux.close();
};

/** L'espacement des barrages le long d'une route, au maximum `maxKm` (lecture seule). */
export const espacementRoute = ({ corridor, maxKm, factionId = null }) =>
  appel('routes/espacement', { methode: 'POST', corps: { corridor, maxKm, factionId } });

/* --------------------------- alertes de distance --------------------------- */

/** Barrages trop rapprochés (distance réelle par la route), toutes unités. */
export const listerAlertes = () => appel('alertes-distance');

export const acquitterAlerte = (id, comment) =>
  appel(`alertes-distance/${id}/acquitter`, { methode: 'POST', corps: { comment } }).then(
    (r) => r.alerte,
  );

/* --------------------- gestion des barrages en lot --------------------- */

/**
 * Une action, UNE requête, quel que soit le nombre de barrages.
 *
 * Chaque écriture déclenche côté serveur le recalcul complet des alertes de
 * rapprochement (~2,5 s sur le parc actuel). Boucler ici sur la route unitaire
 * pour cinquante barrages, ce serait cinquante recalculs : le serveur saturé
 * plusieurs minutes pour un geste que l'utilisateur croit immédiat. Le lot
 * part donc d'un bloc, et le serveur ne recalcule qu'une fois, à la fin.
 *
 * `action` :
 *   'approuver' | 'a_modifier' | 'annuler' | 'reactiver'  changent le statut
 *                                                          de validation ;
 *   'supprimer'                                            efface du dépôt ;
 *   'conserver' | 'reconsiderer'                           n'enregistrent que
 *       l'arbitrage rendu sur un signalement de rapprochement (panneau
 *       Optimisation) — le barrage lui-même n'est pas touché.
 *
 * C'est volontairement la MÊME route pour les trois familles : même garde
 * d'autorité, même journal, même réponse (`items` à jour). Les décisions du
 * panneau Optimisation n'ont pas leur propre chemin d'écriture.
 *
 * Réservé aux administrateurs.
 */
export const actionLotBarrages = (action, ids, criteres) =>
  appel('barrages/lot', { methode: 'POST', corps: { action, ids, criteres } });

/*
 * DORMANT — `creerBarragesLot` et `proposerBarrages` ont été retirés en même
 * temps que le volet « Gestion des barrages » du panneau d'administration, qui
 * en était le seul appelant. Les routes serveur correspondantes
 * (`POST /api/barrages/lot` avec `action: "creer"`, et `POST
 * /api/barrages/proposer`) existent toujours et restent testables, mais plus
 * rien dans l'interface ne les atteint.
 */

/* ----------------------- conflits de planification ----------------------- */

/*
 * DORMANT — plus aucun appelant dans l'interface.
 *
 * Les conflits de planification ont été retirés de l'application (onglet du
 * panneau Filtrer, indicateur du panneau Analyse, tracé sur la carte). Les
 * routes du serveur et `serveur/conflitsPlanification.mjs` restent en place :
 * ces deux fonctions sont le point de raccordement si le commandement demande
 * un jour le rétablissement. Elles ne coûtent rien et se suppriment en deux
 * lignes le jour où la décision est définitive.
 */

/** Chevauchements, ressources/véhicules doublés, effectifs insuffisants. */
export const listerConflitsPlanification = () => appel('conflits-planification');

export const acquitterConflitPlanification = (id, comment) =>
  appel(`conflits-planification/${id}/acquitter`, { methode: 'POST', corps: { comment } }).then(
    (r) => r.conflit,
  );

/**
 * Distance réelle par la route au plus proche AUTRE marquage de même nature
 * (`scope`: 'accident' ou 'barrage') — jamais à vol d'oiseau. `maxKm` borne la
 * recherche : au-delà, la distance renvoyée est `null` plutôt qu'illimitée.
 */
export const distancesPlusProche = (scope, maxKm) =>
  appel(
    `distances-plus-proche?scope=${encodeURIComponent(scope)}&maxKm=${encodeURIComponent(maxKm)}`,
  );

/* ------------------------------- règles ------------------------------- */

/*
 * DORMANT — plus aucun appelant. Ces règles servaient la génération EN LOT de
 * barrages depuis les points noirs (section « Barrages-projets »), retirée du
 * panneau Saisie. La pose se fait désormais barrage par barrage, et
 * l'arbitrage d'ensemble dans OPTIMISATION DES BARRAGES.
 */

/** Règles de génération enregistrées — nommées et numérotées, réutilisables par tous. */
export const listerRegles = () => appel('regles').then((r) => r.items);

export const creerRegle = (nom, criteres) =>
  appel('regles', { methode: 'POST', corps: { nom, criteres } }).then((r) => r.regle);

export const supprimerRegle = (id) => appel(`regles/${id}`, { methode: 'DELETE' });

/* ------------------------------- missions ------------------------------ */

/*
 * DORMANT — plus aucun appelant. Le panneau des missions VIP n'existe plus
 * côté interface ; `serveur/missions.mjs` reste intact.
 */

/** Missions VIP / interception — départ, arrivée ; l'itinéraire se recalcule à l'affichage. */
export const listerMissions = () => appel('missions').then((r) => r.items);

export const creerMission = (champs) =>
  appel('missions', { methode: 'POST', corps: champs }).then((r) => r.mission);

export const modifierMission = (id, champs) =>
  appel(`missions/${id}`, { methode: 'PATCH', corps: champs }).then((r) => r.mission);

export const supprimerMission = (id) => appel(`missions/${id}`, { methode: 'DELETE' });

/* ---------------------------- notifications ----------------------------- */

/**
 * NOTIFICATIONS adressées au commandement à propos d'un barrage.
 *
 * La route s'appelle encore `instructions` : c'est le dépôt d'origine, élargi
 * plutôt que doublé (voir serveur/instructions.mjs). Le renommer aurait obligé
 * à migrer `donnees-serveur/instructions.json` pour un gain purement cosmétique.
 *
 * Le serveur ne renvoie que ce qui relève du périmètre de la session — ou ce
 * qu'elle a elle-même émis.
 */
export const listerNotifications = () => appel('instructions').then((r) => r.items);

/** Ordre écrit de l'administrateur sur un barrage précis (le cas d'origine). */
export const creerInstruction = (barrageId, texte) =>
  appel('instructions', { methode: 'POST', corps: { barrageId, texte } }).then(
    (r) => r.instruction,
  );

/**
 * Le commandant tranche. `decision` : 'accepter' | 'refuser'.
 *
 * Accepter une proposition de SUPPRESSION déclenche le retrait réel côté
 * serveur ; la réponse rapporte donc le dépôt à jour (`items`), pour que la
 * carte se remette d'aplomb sans second aller-retour.
 */
export const deciderNotification = (id, decision, commentaire) =>
  appel(`instructions/${id}`, { methode: 'PATCH', corps: { action: decision, commentaire } });

/** Rouverte par l'admin — la réponse ne le satisfait pas. */
export const rouvrirNotification = (id) =>
  appel(`instructions/${id}`, { methode: 'PATCH', corps: { action: 'rouvrir' } }).then(
    (r) => r.instruction,
  );

export const supprimerNotification = (id) => appel(`instructions/${id}`, { methode: 'DELETE' });

/**
 * RÉCLAMER UN CHANGEMENT DÉJÀ CONFIRMÉ — le chef de région conteste.
 *
 * Elle n'annule rien : elle ouvre un dossier qui pointe la modification (voir
 * POST /api/instructions/:id/reclamation). La chaîne demande → confirmation →
 * réclamation reste entière, et c'est tout l'objet de ce geste.
 */
export const reclamerModification = (id, { motif, commentaire }) =>
  appel(`instructions/${id}/reclamation`, {
    methode: 'POST',
    corps: { motif, commentaire },
  }).then((r) => r.reclamation);

/* ------------- éléments présents, par créneau de 6 heures -------------- */

/**
 * QUI TIENT LE POSTE — voir serveur/elements.mjs et src/ElementsCreneau.jsx.
 *
 * L'ajout n'envoie que le barrage et les trois informations saisies : la date,
 * l'heure et le créneau de 6 h sont posés par l'horloge du SERVEUR, jamais par
 * le navigateur. C'est ce qui garantit qu'une relève tombe dans le même créneau
 * pour tous les postes, quelle que soit l'horloge de la machine.
 */
export const listerElements = (barrageId) =>
  appel(`elements?barrageId=${encodeURIComponent(barrageId)}`).then((r) => r.items);

/**
 * QUI TIENT CE POSTE AUJOURD'HUI — pour la popup de la carte.
 *
 * Restreint à la journée, et rend en plus le créneau courant du SERVEUR et
 * l'effectif attendu : la popup peut alors dire « 06:00 → 12:00, 4 sur 6 »
 * sans consulter l'horloge du poste client ni deviner la composition.
 */
export const effectifDuPoste = (barrageId) =>
  appel(`elements?barrageId=${encodeURIComponent(barrageId)}&date=aujourdhui`);

export const effectifAuPoint = async (lng, lat) => {
  try {
    return await appel(`effectif-au-point?lng=${encodeURIComponent(lng)}&lat=${encodeURIComponent(lat)}`);
  } catch {
    return { attendus: 4, occupes: [], effectif: [] };
  }
};

export const ajouterElement = ({ barrageId, grade, nom, matricule }) =>
  appel('elements', { methode: 'POST', corps: { barrageId, grade, nom, matricule } }).then(
    (r) => r.element,
  );

export const supprimerElement = (id) => appel(`elements/${id}`, { methode: 'DELETE' });

/* --------------------------- roster préparé ---------------------------- */

/**
 * LE ROSTER D'UNE BRIGADE — effectif, barrages, composition attendue et
 * personnes déjà réparties, EN UN SEUL APPEL.
 *
 * Une requête par barrage aurait multiplié les allers-retours pour afficher un
 * écran qui se lit d'un bloc — et l'écran ne peut de toute façon rien montrer
 * tant qu'il n'a pas tout reçu.
 */
export const chargerRoster = (bt, date) =>
  appel(`roster?bt=${encodeURIComponent(bt)}${date ? `&date=${encodeURIComponent(date)}` : ''}`);

/**
 * Prépare une journée (administrateur). Sans date : demain.
 *
 * `remplacer` refait une journée déjà proposée au lieu d'en combler les seuls
 * trous — nécessaire après une correction de la composition ou un chargement
 * d'effectif, sans quoi re-préparer resterait sans effet. Les créneaux où un
 * chef est intervenu ne sont jamais défaits.
 */
export const preparerRoster = (date, remplacer = false) =>
  appel('roster/preparer', { methode: 'POST', corps: { date, remplacer } }).then((r) => r.rapport);

/**
 * LA SITUATION D'UN COUP D'ŒIL — le premier écran d'ANALYSE.
 *
 * Un seul appel, quelques centaines d'octets : postes tenus, postes
 * incomplets, brigades sans effectif, hommes en réserve, et les quatre
 * tranches de la journée. Tout est compté par le serveur, qui a déjà les
 * vingt-trois mille lignes du jour sous la main.
 */
export const chargerSituation = () => appel('analyse/situation');

/** Ce qui est déjà préparé pour aujourd'hui et demain. */
export const etatRoster = () => appel('roster/etat');

/* --------------------- assistant d'analyse (n8n / Ollama) --------------------- */

/**
 * Fait analyser un résultat d'optimisation par le service configuré côté
 * serveur — workflow n8n, ou Ollama en direct (voir serveur/assistant.mjs).
 *
 * Le navigateur ne connaît ni l'adresse ni le modèle : il envoie le résumé du
 * calcul qu'il affiche, et reçoit `{texte, source}`. C'est le serveur qui joint
 * ces machines — pas de CORS à obtenir, et leur adresse ne part pas dans le
 * bundle de tous les postes.
 *
 * Réponse lente par nature : un modèle local met des dizaines de secondes.
 */
export const analyserOptimisation = (resume) =>
  appel('assistant/optimisation', { methode: 'POST', corps: resume });

/* ------------------------------- journal -------------------------------- */

/** Historique des écritures (créer/modifier/supprimer) d'UN marquage précis. */
export const journalMarquage = (id, limite = 40) =>
  appel(`journal?id=${encodeURIComponent(id)}&limite=${limite}`).then((r) => r.entrees);

/* ------------------------------- comptes ------------------------------- */

/** Réservé aux administrateurs. */
export const listerComptes = () => appel('comptes').then((r) => r.comptes);

export const creerCompte = (rang, unite, code, reg, cie) =>
  appel('comptes', { methode: 'POST', corps: { rang, unite, code, reg, cie } });

export const supprimerCompte = (rang, unite) =>
  appel(`comptes/${encodeURIComponent(rang)}/${encodeURIComponent(unite)}`, { methode: 'DELETE' });

/* -------------------- workflow d'approbation (Cie → Région → Super Admin) -------------------- */

/** Liste des demandes d'approbation visibles par le compte courant. */
export const listerDemandes = ({ barrageId = null, statut = null } = {}) => {
  const q = new URLSearchParams();
  if (barrageId) q.set('barrageId', barrageId);
  if (statut) q.set('statut', statut);
  const qs = q.toString();
  return appel(`demandes${qs ? `?${qs}` : ''}`);
};

/** Détail d'une demande avec rapport de conflit pré-calculé. */
export const obtenirDemande = (id) => appel(`demandes/${encodeURIComponent(id)}`);

/** Créer une nouvelle demande de modification (CMND Cie ou Région). */
export const creerDemande = ({ barrageId, changements = [], raison = '', destinataire = null, factionId = null }) =>
  appel('demandes', { methode: 'POST', corps: { barrageId, changements, raison, destinataire, factionId } });

/** Agir sur une demande (modifier, retourner, approuver, transmettre_admin, rejeter). */
export const agirDemande = (id, { action, commentaire = '', changements = null, destinataire = null }) =>
  appel(`demandes/${encodeURIComponent(id)}/action`, {
    methode: 'POST',
    corps: { action, commentaire, changements, destinataire },
  });

/** Historique complet de la chaîne d'approbation d'une demande. */
export const historiqueDemande = (id) => appel(`demandes/${encodeURIComponent(id)}/historique`);

/* -------------------- analyse des conflits pré-traitement -------------------- */

/** Analyse complète des conflits d'un barrage avant traitement. */
export const analyserConflitsBarrage = (id, { seuilKm = null } = {}) =>
  appel(`barrages/${encodeURIComponent(id)}/analyse-conflits${seuilKm != null ? `?seuilKm=${encodeURIComponent(seuilKm)}` : ''}`);

/* -------------------- barrages synthétiques (simulation UX/UI) -------------------- */

/** Récupère la liste des barrages synthétiques et leurs statistiques. */
export const listerBarragesSynthetiques = () => appel('barrages/synthetiques');

/** Génère des barrages synthétiques réalistes (dryRun possible). */
export const genererBarragesSynthetiques = ({ graine = 20261027, nombre = 120, ratioPermanent = 0.25, espacementKm = 4.0, dryRun = false, remplacer = true, plagesAccidents = null } = {}) =>
  appel('barrages/synthetiques/generer', {
    methode: 'POST',
    corps: { graine, nombre, ratioPermanent, espacementKm, dryRun, remplacer, plagesAccidents },
  });

/** Supprime les barrages synthétiques tout en préservant 100% des barrages réels. */
export const supprimerBarragesSynthetiques = () =>
  appel('barrages/synthetiques', { methode: 'DELETE' });


