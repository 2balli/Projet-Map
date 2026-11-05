/**
 * API d'habilitation et de marquages.
 *
 * Toutes les règles d'autorité sont ICI, et nulle part ailleurs :
 *
 *   sans compte         RIEN, hormis l'état du service et la liste des unités,
 *                       dont l'écran de connexion a besoin. La consultation
 *                       était ouverte du temps de la démonstration ; sur des
 *                       données réelles, elle donnait le dispositif national à
 *                       qui le demandait — et rendait le cloisonnement
 *                       contournable par simple déconnexion (voir `visibles`).
 *   chef de brigade      voit et modifie sa seule circonscription de BT
 *   chef de compagnie   voit et modifie sa seule circonscription de compagnie,
 *                       y compris les marquages de ses brigades
 *   chef de région      voit et modifie sa seule région, y compris les
 *                       marquages de ses compagnies (il peut corriger un
 *                       repère mal placé)
 *   administrateur      aucune restriction géographique ; seul rang à voir
 *                       toutes les régions et à gérer les comptes
 *
 * La consultation (lecture) suit le même périmètre géographique que
 * l'écriture — voir `visibles()` — pour qu'un chef ne voie jamais les
 * effectifs, barrages ou points noirs d'une région qui n'est pas la sienne.
 *
 * Le contrôle est double, et le second est le seul qui compte : le navigateur
 * prévient l'utilisateur avant l'envoi, le serveur refuse. Un client modifié ne
 * gagne donc rien.
 *
 * Routes :
 *   GET    /api/etat                  état du service (comptes présents ?)
 *   GET    /api/unites                listes pour le formulaire de connexion
 *   GET    /api/distances-plus-proche  distance réelle au plus proche voisin (même nature)
 *   POST   /api/session               {matricule, code} -> ouvre la session
 *   POST   /api/motdepasse            change SON mot de passe (jamais celui
 *                                     d'un autre : la cible vient de la session)
 *   GET    /api/session               identité courante
 *   DELETE /api/session               ferme la session
 *   GET    /api/comptes                           comptes existants (admin)
 *   POST   /api/comptes                           {rang, unite, code, ...} -> crée/remplace (admin)
 *   DELETE /api/comptes/:matricule                supprime un compte (admin)
 *   DELETE /api/comptes/:rang/:unite               idem, par unité (compatibilité)
 *   GET    /api/marquages             marquages visibles par la session (tous pour admin)
 *   POST   /api/marquages             crée
 *   POST   /api/marquages/generer     points noirs importants -> barrages-projets
 *   POST   /api/barrages/consolidation  recalcul du dispositif (admin) : garder / annuler
 *   -- OPTIMISATION AUTOMATIQUE (mode AUTO du panneau Optimisation) --
 *   POST   /api/barrages/optimisation-auto            simule les déplacements sous le seuil automatique, n'écrit rien
 *   POST   /api/barrages/appliquer-optimisation-auto  revalide globalement puis applique
 *   GET    /api/barrages/retires-optimisation         les postes sortis du service
 *   POST   /api/barrages/:id/restaurer-optimisation   les y rend, à l'identique
 *   GET    /api/barrages/rapports-optimisation        l'historique figé des applications
 *   PATCH  /api/marquages/:id         modifie (position incluse)
 *   DELETE /api/marquages/:id         supprime
 *   POST   /api/marquages/import      fusionne un export GeoJSON
 *   GET    /api/alertes-distance                 barrages trop rapprochés (route réelle)
 *   POST   /api/alertes-distance/:id/acquitter    {comment} -> acquitte une alerte
 *   GET    /api/conflits-planification                 chevauchements, ressources/véhicules doublés, effectifs insuffisants
 *   POST   /api/conflits-planification/:id/acquitter   {comment} -> acquitte un conflit
 *   GET    /api/regles                            règles de génération enregistrées
 *   POST   /api/regles                            {nom, criteres} -> enregistre une règle
 *   DELETE /api/regles/:id                        supprime une règle (son auteur ou un admin)
 *   GET    /api/missions                          missions VIP / interception
 *   POST   /api/missions                          {type, depart, arrivee, ...} -> crée
 *   PATCH  /api/missions/:id                       modifie (son auteur ou un admin)
 *   DELETE /api/missions/:id                       supprime (son auteur ou un admin)
 *   GET    /api/instructions                      instructions de l'admin sur des barrages
 *   POST   /api/instructions                      {barrageId, texte} -> crée (admin)
 *   PATCH  /api/instructions/:id                  {action:'traiter'|'rouvrir', reponse}
 *   DELETE /api/instructions/:id                  supprime (admin)
 *   POST   /api/assistant/optimisation            relaie un résumé d'optimisation à n8n / Ollama, rend un texte
 *   GET    /api/roster?bt=...&date=...            effectif, barrages et roster préparé d'une brigade
 *   POST   /api/roster/preparer                   prépare une journée (admin ; demain par défaut)
 *   GET    /api/roster/etat                       ce qui est préparé pour aujourd'hui et demain
 *   GET    /api/elements?barrageId=...            éléments présents sur un barrage, par créneau de 6 h
 *   POST   /api/elements                          {barrageId, grade, nom, matricule} -> ajoute au créneau en cours
 *   DELETE /api/elements/:id                      retire un élément
 *   GET    /api/journal               trace des écritures de son périmètre
 *   GET    /api/notifications                     événements visibles par la session, lus / non lus
 *   POST   /api/notifications/:id/lue             ouverte par ce compte -> lue pour lui
 *   GET    /api/notifications/flux                flux temps réel (text/event-stream)
 *   GET    /api/assignations/suivi                suivi du workflow d'assignation (Super Admin)
 *   -- MODIFIER BARRAGE (position / PK / route / effectif / intouchable) --
 *   POST   /api/barrages/:id/modification          effectif + protection en UNE opération (ou une demande)
 *                                     — le DÉPLACEMENT, lui, passe par PATCH /api/marquages/:id
 */
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  chargerComptes,
  verifier,
  normaliserMatricule,
  ROLES,
  listerComptes,
  definirCompte,
  supprimerCompte,
  enregistrerComptes,
  chercherParRangUnite,
  matriculeDe,
  perimetreDuRang,
  RANGS,
  changerMotDePasse,
  refusMotDePasse,
  MOTDEPASSE_MIN,
} from './comptes.mjs';
import * as S from './sessions.mjs';
import { chargerCirconscriptions, controler, localiser, unites, perimetreDe } from './geo.mjs';
import { creerDepot, normaliser, nouvelId, estValide, TYPES, estIntouchable } from './depot.mjs';
import { creerJournal } from './journal.mjs';
import { creerDepotNotifications, presenterNotification, visiblePour } from './notifications.mjs';
import { suivreAssignations, ACTIONS_SUIVIES } from './suiviAssignations.mjs';
import { creerDepotSuiviConflits } from './suiviConflits.mjs';
import { ErreurWorkflow, presenterWorkflow, verifierAction, peutSupprimer, estClos, compterSections, LIBELLES_SECTIONS, ETATS, etatDe, regionsAssignees } from './workflowConflits.mjs';
import { creerDepotAlertes } from './alertes.mjs';
import { creerDepotConflits, recalculerConflits } from './conflitsPlanification.mjs';
import { creerDepotRegles } from './regles.mjs';
import { creerDepotMissions } from './missions.mjs';
import { creerDepotInstructions } from './instructions.mjs';
import {
  creerDepotElements, CRENEAUX, creneauDe, ELEMENTS_PAR_BARRAGE,
} from './elements.mjs';
import { creerDepotEffectifs } from './effectifs.mjs';
import { chargerComposition, preparerJournee, dateLocale, lendemain } from './roster.mjs';
import { creerAssistant } from './assistant.mjs';
import { estImportant, scoreImportance, accidentsAuDessusDuNormal } from './pointsnoirs.mjs';
import {
  chargerGrapheRoutier,
  recalculerAlertes,
  genererBarrages,
  accrocherRoute,
  distancesPlusProche,
  distanceReelleKm,
  /* Seule survivante des anciennes fonctions d'arbitrage : elle sert au volet
     « Proposer des emplacements » du panneau d'administration, pas à
     l'optimisation. Les autres — arbitrage par motifs, redéploiement,
     réaffectation — n'ont plus d'appelant. */
  trouverTrousCouverture,
} from './distances.mjs';
import {
  analyserOptimisationDistance, listerConflitsDistance, intouchablesUtiles, proposerDeplacement,
  SEUIL_DISTANCE_AUTO_KM,
} from './optimisationDistance.mjs';
import { accrocher, distanceKm, refArete } from './routage.mjs';
import { tracerEntrePostes } from './tempsTrajet.mjs';
import { creerDepotRapportsOptimisation } from './rapportsOptimisation.mjs';
import { genererBarragesFixesSynthetiques, PLAGES_ACCIDENTS_DEFAUT } from './generateurSynthetique.mjs';
import { MODES } from './mode.mjs';
import {
  FICHIER_REFERENCE_PRESENTATION, creerReferencePresentation, fusionnerAvecReference, ecartsAvecReference, notificationDeBarrage,
} from './presentation.mjs';
import {
  FACTIONS, factionDe, factionParId, factionsDuBarrage,
} from './factions.mjs';
import { recalerPosition, routeExiste, referentiel } from './pointKilometrique.mjs';
import { analyserEspacement, axeDepuisPolyligne } from './espacementRoute.mjs';
import { readFileSync, existsSync } from 'node:fs';
import {
  catalogueRoutes, traceRoute, routeAuPoint, itinerairesTrajet, creerCorridor, lignesPourCarte,
  CORRIDOR_DEFAUT_KM, CORRIDOR_MIN_KM, CORRIDOR_MAX_KM, TOLERANCE_TRACE_KM, TOLERANCE_ROUTE_KM,
} from './corridorRoutier.mjs';
import { conflitsParFaction } from './conflitsFaction.mjs';
import {
  SEUIL_CONFLIT_KM_DEFAUT,
  positionActuelle,
    controleDistance,
  autreIntouchableDeLaCompagnie,
  champsProtection,
  planEffectif,
  resume,
  enService,
} from './modificationBarrage.mjs';
import { creerDepotDemandes, STATUTS_WORKFLOW, ACTIONS_WORKFLOW } from './demandesApprobation.mjs';
import { analyserConflitsComplet, analyserConflitsRoute } from './analyseConflits.mjs';

const BARRAGES = ['barrage_fixe', 'barrage_mobile'];
/** Durée pendant laquelle un repositionnement garde son repère « nouvellement posé ». */
const FENETRE_REPOSITIONNEMENT_MS = 7 * 86_400_000;
/** Portée de la recherche du plus proche voisin — celle de la consolidation manuelle. */
const PORTEE_VOISIN_KM = 60;
const estBarrage = (m) => BARRAGES.includes(m?.type);

/**
 * DÉCLARER UN POINT NOIR EST RÉSERVÉ À L'ADMINISTRATEUR.
 *
 * Un point noir n'est pas un signalement ordinaire : il alimente la carte de
 * risque, l'analyse, et les critères d'importance qui décident où un barrage
 * doit être posé. Le déclarer engage donc le dispositif bien au-delà du
 * périmètre de l'unité qui clique — c'est une qualification du terrain, pas
 * une observation locale.
 *
 * Ne porte QUE sur la création. Une unité continue de renseigner et de
 * corriger les points noirs déjà présents chez elle (voir PATCH
 * /api/marquages/:id, qui s'appuie sur `peutModifier`), et de poser ses
 * barrages sans restriction.
 *
 * Le panneau de saisie masque déjà la nature aux autres grades ; cette garde
 * est celle qui fait autorité — un client modifié ne la contourne pas.
 */
const peutPoserPointNoir = (session, type) => type !== 'accident' || session?.rang === 'admin';

/**
 * QUI PEUT RETIRER UN BARRAGE DE LA CARTE — `peutModifier`, et rien d'autre.
 *
 * Il y avait ici deux constantes et une fonction (`retraitDirectPossible`)
 * qui ajoutaient au droit de gestion deux conditions supplémentaires : être
 * l'AUTEUR du barrage, et que celui-ci soit encore `en_attente`. Elles ont
 * été retirées, pas déplacées.
 *
 * Le raisonnement d'origine était qu'effacer un poste engage la couverture
 * d'un territoire, et que cela devait donc passer par OPTIMISATION. Le
 * retrait CONCERTÉ y passe toujours. Mais confondre ce retrait-là avec
 * l'effacement d'un repère qu'on vient de poser à la main produisait deux
 * absurdités : un chef ne pouvait pas défaire le point posé par erreur par
 * son adjoint, et un point posé par l'administrateur — approuvé d'office —
 * ne pouvait plus être défait par personne.
 *
 * La règle tient maintenant en une phrase : qui a autorité d'écriture sur le
 * périmètre (voir `peutModifier`) peut retirer le repère. La paternité de la
 * saisie ne donne ni ne retire aucun droit.
 */

/**
 * DES COORDONNÉES ACCEPTABLES — et pourquoi `Number.isFinite` ne suffisait pas.
 *
 * Le contrôle s'arrêtait à « c'est un nombre fini ». L'audit a montré ce qu'il
 * laissait passer, et ce n'est pas théorique — trois repères en ont été
 * enregistrés :
 *
 *     { lat: null,  lng: null  }  ->  `Number(null)` vaut 0 : accepté en (0,0),
 *                                     dans le golfe de Guinée ;
 *     { lat: 999,   lng: -6.9  }  ->  accepté, latitude impossible ;
 *     { lat: 0,     lng: -6.9  }  ->  accepté, en pleine mer.
 *
 * Le résultat est pire qu'une donnée fausse : `localiser` ne trouve aucune
 * circonscription, le repère est écrit avec `bt/cie/reg` à `null`, et il
 * devient INVISIBLE pour tout le monde sauf l'administrateur — `dansSonUnite`
 * compare `item[champ] === unite`, et `null` n'égale jamais rien. Personne ne
 * peut donc le corriger ni le retirer, alors qu'il compte dans les analyses.
 *
 * Deux exigences, donc :
 *   1. des coordonnées dans les bornes du monde, et REFUSER l'absence plutôt
 *      que de la convertir en zéro ;
 *   2. un rattachement effectif — voir `rattachementManquant` plus bas.
 */
const coordonneesValides = (corps) => {
  /* On refuse l'ABSENCE avant toute conversion : `Number(null)` et
     `Number('')` valent 0, ce qui est une position parfaitement valide au
     large de l'Afrique. */
  if (corps?.lat === undefined || corps?.lat === null || corps.lat === '') return null;
  if (corps?.lng === undefined || corps?.lng === null || corps.lng === '') return null;

  const lat = Number(corps.lat);
  const lng = Number(corps.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return [lng, lat];
};

const REFUS_COORDONNEES =
  'Coordonnées manquantes ou hors bornes : la latitude va de -90 à 90, ' +
  'la longitude de -180 à 180.';

/**
 * UN REPÈRE SANS RATTACHEMENT N'EST PAS ENREGISTRABLE.
 *
 * `rattacher` demande à `localiser` quelle brigade, quelle compagnie et
 * quelle région contiennent le point. Hors du territoire couvert par les
 * contours, les trois valent `null` — et le repère devient orphelin, donc
 * ingérable (voir la note ci-dessus).
 *
 * On refuse plutôt que d'écrire. L'administrateur, qui n'a pas de périmètre,
 * était le seul à pouvoir créer de tels orphelins : `controler` l'autorise
 * partout, y compris en pleine mer.
 *
 * `bt` seul est exigé : c'est l'échelon qui porte les postes, et les deux
 * autres en découlent.
 */
const rattachementManquant = (item) => !item?.bt;

const REFUS_HORS_TERRITOIRE =
  'Ce point ne tombe dans aucune brigade territoriale connue : il serait ' +
  'rattaché à personne et deviendrait ingérable. Vérifiez la position.';

/**
 * LE BARRAGE EST INTOUCHABLE — la règle, et ce qu'elle interdit exactement.
 *
 * L'optimisation automatique ne peut faire qu'une chose : dire QUELLE FACTION
 * tient un poste. Tout le reste de la fiche — l'identité du poste, sa
 * position, son type, son horaire, sa durée, son statut, et les hommes qui le
 * composent — lui est fermé.
 *
 * POURQUOI UNE FONCTION, ALORS QUE LE CODE D'ÉCRITURE NE COPIE QU'UN CHAMP.
 * Parce que « ne copier qu'un champ » est une intention, et qu'une intention
 * ne survit pas à la prochaine modification. Ce contrôle, lui, s'exécute : il
 * se place entre le calcul et l'écriture, et si un jour quelqu'un ajoute un
 * champ au `modifie`, c'est ici que la requête sera refusée — pas six mois
 * plus tard, sur un dispositif réel.
 *
 * LA DURÉE N'EST PAS UN CHAMP DE LA FICHE : elle se déduit de `debut` et
 * `fin`. Les contrôler tous deux la contrôle donc, et il n'y a rien à
 * comparer de plus.
 *
 * @returns {string|null} le champ fautif, en clair — `null` si rien n'a bougé.
 */
const CHAMPS_INTOUCHABLES = [
  ['id', 'identifiant du barrage'],
  ['lng', 'longitude'],
  ['lat', 'latitude'],
  ['type', 'type de barrage'],
  ['sousType', 'sous-type'],
  ['nom', 'nom du barrage'],
  ['route', 'axe routier'],
  ['debut', 'heure de début'],
  ['fin', 'heure de fin'],
  ['statutBarrage', 'statut'],
  ['bt', 'brigade'],
  ['cie', 'compagnie'],
  ['reg', 'région'],
];

const ecartInterdit = (avant, apres) => {
  for (const [champ, libelle] of CHAMPS_INTOUCHABLES) {
    if ((avant?.[champ] ?? null) !== (apres?.[champ] ?? null)) {
      return `${libelle} modifié (${avant?.[champ] ?? '—'} → ${apres?.[champ] ?? '—'}) — ` +
        'le barrage est intouchable, seule la faction peut changer';
    }
  }
  return null;
};

/** La signature des éléments d'un poste — l'ordre ne compte pas, l'identité si. */
const signatureElements = (elements) =>
  (elements ?? [])
    .map((e) => `${e.matricule ?? ''}|${e.grade ?? ''}|${e.nom ?? ''}|${e.creneau ?? ''}|${e.date ?? ''}`)
    .sort()
    .join(';');

const REFUS_BARRAGE_INTOUCHABLE =
  'action refusée : l’optimisation automatique ne peut que réaffecter une faction. ' +
  'Le barrage — position, type, horaire, durée, statut, éléments — est intouchable.';

const REFUS_POINT_NOIR =
  "La déclaration d'un point noir est réservée à l'administrateur : elle pèse sur la carte de " +
  'risque et sur l’implantation des barrages. Vous pouvez renseigner ceux qui existent déjà dans ' +
  'votre périmètre.';

/** Corps de requête plafonné : au-delà, la requête est rejetée sans être lue. */
const CORPS_MAX = 512 * 1024;

/**
 * En-tête exigé sur toute écriture. Combiné à `SameSite=Strict`, il rend la
 * falsification de requête inopérante : un formulaire d'un autre site ne peut
 * pas poser cet en-tête sans autorisation préalable du navigateur.
 */
const EN_TETE_ATTENDU = 'gr-carte';

export function creerApi({
  /**
   * MODE DU DOSSIER DE DONNÉES — 'demo', 'production', ou `null`.
   *
   * Renvoyé par `/api/etat` et rien de plus : c'est l'écran qui en fait un
   * bandeau. Le SERVICE, lui, s'en est déjà servi pour refuser de démarrer si
   * le mode déclaré ne correspondait pas (voir `serveur/mode.mjs`) — la
   * protection est là, pas ici.
   */
  mode = null,
  fichierComptes,
  fichierMarquages,
  fichierJournal,
  fichierAlertes,
  fichierConflits,
  fichierRegles,
  fichierMissions,
  fichierInstructions,
  fichierDemandes = join(dirname(fichierMarquages), 'demandes-approbation.json'),
  /** Événements notifiés et leur lecture par compte — voir serveur/notifications.mjs. */
  fichierNotifications = join(dirname(fichierMarquages), 'notifications.json'),
  /** Suivi des conflits réels et leur historique — voir serveur/suiviConflits.mjs. */
  fichierSuiviConflits = join(dirname(fichierMarquages), 'suivi-conflits.json'),
  /**
   * Éléments présents par créneau de 6 h (voir elements.mjs). Déduit du dépôt
   * des marquages quand l'appelant ne le passe pas : un paquet intranet déjà
   * déployé garde son `serve.mjs`, et le service doit démarrer sans qu'on ait à
   * le remplacer en même temps que `serveur/`.
   */
  fichierElements = join(dirname(fichierMarquages), 'elements.json'),
  /** Effectif nominatif et composition type — voir effectifs.mjs et roster.mjs. */
  fichierEffectifs = join(dirname(fichierMarquages), 'effectifs.json'),
  fichierComposition = join(dirname(fichierMarquages), 'composition-barrage.json'),
  racineCouches,
  seuilBarragesKm = 20,
  /** Seuil du contrôle de distance de « Modifier barrage » — voir serveur/modificationBarrage.mjs. */
  seuilConflitKm = SEUIL_CONFLIT_KM_DEFAUT,
  /**
   * ASSISTANT D'ANALYSE — désactivé tant qu'il n'est pas configuré.
   *
   * `{ n8n, ollama, modele }` — voir serveur/assistant.mjs. Vide, aucune route
   * n'appelle l'extérieur et le bouton n'apparaît pas dans l'interface : le
   * service reste ce qu'il était, sans appel sortant.
   */
  assistant: configAssistant = {},
}) {
  const circonscriptions = chargerCirconscriptions(racineCouches);
  const depot = creerDepot(fichierMarquages);
  const depotNotifications = creerDepotNotifications(fichierNotifications);
  /**
   * LE JOURNAL NOTIFIE. Toute écriture passe par `journal.consigner` : c'est
   * donc là, et une seule fois, que naît la notification de l'événement (voir
   * serveur/notifications.mjs). Une notification qui échoue n'empêche jamais
   * l'écriture — elle est déjà faite, et consignée.
   */
  const journal = (() => {
    const brut = creerJournal(fichierJournal);
    return {
      ...brut,
      consigner(e) {
        const entree = brut.consigner(e);
        try {
          depotNotifications.publier({ ...e, ts: entree.ts });
        } catch (err) {
          console.error(`  ! notification non publiée (${err.message})`);
        }
        return entree;
      },
    };
  })();
  const depotAlertes = creerDepotAlertes(fichierAlertes);
  const depotConflitsPlanification = creerDepotConflits(fichierConflits);
  const depotRegles = creerDepotRegles(fichierRegles);
  const depotMissions = creerDepotMissions(fichierMissions);
  const depotInstructions = creerDepotInstructions(fichierInstructions);
  const depotDemandes = creerDepotDemandes(fichierDemandes);
  const depotSuiviConflits = creerDepotSuiviConflits(fichierSuiviConflits);
  /**
   * JOURNAL D'AUDIT DES TRANSITIONS DE CONFLIT. Chaque soumission, validation,
   * refus et réouverture est consigné dans `journal.jsonl`, fichier en ajout
   * seul : une ligne n'y est jamais réécrite, et une décision refusée puis
   * resoumise laisse ses deux lignes. Le conflit garde aussi ses `transitions`
   * (lues par l'interface) ; le journal est la trace indépendante.
   */
  const auditerConflit = (session) => (conf, t) => journal.consigner({
    session,
    action: 'conflit-transition',
    avant: null,
    apres: null,
    details: {
      categorie: 'conflit',
      conflitId: conf.id,
      numero: conf.numero ?? null,
      paireCle: conf.paireCle ?? null,
      transition: t.action,
      de: t.de,
      vers: t.vers,
      motif: t.motif ?? null,
      changement: t.changement ?? null,
    },
  });
  /**
   * LA RÉFÉRENCE DE PRÉSENTATION — voir serveur/presentation.mjs. En mode démo,
   * un dossier qui n'en a pas encore la reçoit au premier démarrage : l'état
   * de départ est alors celui des données livrées, figé avant toute séance.
   * En production, rien n'est créé.
   */
  const referencePresentation = creerReferencePresentation(join(dirname(fichierMarquages), FICHIER_REFERENCE_PRESENTATION));
  /* Les alertes sont d’abord remises d’accord avec les barrages : la référence
     doit être un état cohérent, pour qu’une restauration le reproduise à l’octet. */
  const capturerReferencePresentation = (par, motif) => (recalculerSiPresent(), referencePresentation.enregistrer({
    marquages: depot.tous(), instructions: depotInstructions.tous(), alertes: depotAlertes.tous(), estBarrage, par, motif,
  }));
  /* Historique des optimisations appliquées — voir rapportsOptimisation.mjs.
     Déduit du dépôt des marquages comme les éléments et les effectifs : un
     paquet déjà déployé garde son `serve.mjs` et démarre sans retouche. */
  const depotRapportsOptimisation = creerDepotRapportsOptimisation(
    join(dirname(fichierMarquages), 'rapports-optimisation.json'),
  );
  const depotElements = creerDepotElements(fichierElements);
  const depotEffectifs = creerDepotEffectifs(fichierEffectifs);
  const assistant = creerAssistant(configAssistant);
  /**
   * Absent si `npm run build:roads` n'a pas été lancé : alertes de distance et
   * génération automatique restent désactivées, tout le reste (saisie,
   * consultation) continue de fonctionner normalement.
   */
  const graphe = chargerGrapheRoutier(join(racineCouches, 'graphe_routier.json'));
  /* Jetons éphémères de simulation : ils lient l'application à l'état exact
     analysé sans écrire de brouillon dans les dépôts persistants. */
  const simulationsOptimisation = new Map();
  /** « ↶ Restaurer avant simulation » : les instantanés d'avant simulation, par identifiant. */
  const instantanesSimulation = new Map();
  /**
   * OPTIMISATION PAR ROUTE OU PAR TRAJET — voir serveur/corridorRoutier.mjs.
   *
   * Les localités proposées comme départ et arrivée sont celles du projet
   * (`poles-population.json`, tirées des circonscriptions) : pas de liste
   * saisie à la main. Les trajets calculés sont gardés 30 min, comme les
   * simulations : l'optimisation reçoit l'identifiant du trajet choisi, et
   * c'est le tracé calculé ICI qui fait foi, jamais une géométrie du client.
   */
  const fichierVilles = join(racineCouches, 'poles-population.json');
  const villes = existsSync(fichierVilles)
    ? (JSON.parse(readFileSync(fichierVilles, 'utf8')).poles ?? [])
      .filter((v) => v?.nom && Number.isFinite(v.lng) && Number.isFinite(v.lat))
    : [];
  const trajetsCalcules = new Map();

  /**
   * PRÉPARATION AUTOMATIQUE DE LA VEILLE.
   *
   * Le jour J doit trouver sa liste déjà faite : c'est toute la raison d'être du
   * roster. On ne peut donc pas attendre qu'un utilisateur ouvre SAISIE TERRAIN
   * pour la fabriquer — il la découvrirait vide, et c'est exactement ce qu'on
   * cherche à éviter.
   *
   * DANS LE SERVICE, ET NON DANS UNE TÂCHE PLANIFIÉE DU SYSTÈME. Un intranet de
   * gendarmerie n'a pas forcément de cron administré, et une tâche Windows
   * oubliée au prochain redéploiement laisserait le roster silencieusement à
   * l'arrêt. Le service, lui, est déjà là — et s'il ne tourne pas, personne
   * n'ouvre l'application non plus.
   *
   * DEUX DÉCLENCHEMENTS, VOLONTAIREMENT REDONDANTS :
   *   — au démarrage, pour qu'un service relancé rattrape immédiatement ce qui
   *     manque, y compris le jour même si la veille a été manquée ;
   *   — toutes les heures, pour franchir minuit sans redémarrage.
   *
   * IDEMPOTENT PAR CONSTRUCTION : `preparer` n'écrit jamais dans un créneau qui
   * contient déjà quelque chose. Repasser sur une journée déjà préparée ne crée
   * donc aucun doublon et ne touche à aucune saisie humaine — ce qui permet de
   * relancer sans réfléchir.
   */
  const AUTEUR_SYSTEME = {
    matricule: 'SYSTEME',
    nom: 'Préparation automatique',
    role: 'commandement',
    rang: 'admin',
    unite: 'systeme',
    reg: null,
    cie: null,
  };

  const preparerSiNecessaire = (quand) => {
    try {
      const composition = chargerComposition(fichierComposition);
      /**
       * ON ANNONCE LE TEMPS PASSÉ, PARCE QUE CE TEMPS EST DU BLOCAGE.
       *
       * `preparerJournee` est synchrone : pendant qu'il travaille, le service
       * ne répond à personne. Ce coût est resté longtemps invisible, et il
       * avait atteint vingt-six secondes par journée sur un parc de 1 124
       * postes — le service paraissait figé au démarrage et à chaque heure
       * ronde, sans que rien ne le dise (voir `preparer` et `ecrireVraiment`
       * dans serveur/elements.mjs, où les deux causes ont été corrigées :
       * moins de 1,2 s aujourd'hui).
       *
       * L'afficher, c'est permettre à celui qui exploite le service de voir
       * cette valeur repartir à la hausse le jour où le parc double, au lieu
       * de le découvrir par une application qui ne répond plus.
       */
      const debutPreparation = Date.now();
      const rapport = preparerJournee({
        date: quand,
        effectifs: depotEffectifs,
        barrages: depot.tous(),
        composition,
        depotElements,
        auteur: AUTEUR_SYSTEME,
      });
      const dureeMs = Date.now() - debutPreparation;
      if (rapport.ajoutes) {
        console.log(
          `  roster ${quand} : ${rapport.ajoutes} ligne(s) proposée(s) sur ` +
            `${rapport.barrages} barrage(s) de ${rapport.brigades} brigade(s) ` +
            `en ${dureeMs} ms`,
        );
      }
      return rapport;
    } catch (err) {
      /* Une préparation ratée ne doit pas empêcher le service de servir la
         carte : on le dit, et la prochaine heure réessaiera. */
      console.error(`  ! roster ${quand} non préparé (${err.message})`);
      return null;
    }
  };

  const veillerAuRoster = () => {
    /* Aujourd'hui d'abord : si la veille a été manquée — service arrêté, panne —
       mieux vaut une liste tardive que pas de liste du tout. */
    preparerSiNecessaire(dateLocale(new Date()));
    preparerSiNecessaire(lendemain(new Date()));
  };

  if (depotEffectifs.tous().length) {
    /**
     * LA PRÉPARATION NE RETARDE PAS L'OUVERTURE DU SERVICE.
     *
     * Elle s'exécutait avant que le serveur ne se mette à écouter : six
     * secondes pendant lesquelles un poste qui rechargeait la page recevait
     * « serveur injoignable ». Or rien ne presse — une journée déjà préparée
     * l'est encore une seconde plus tard, et si elle ne l'est pas, personne ne
     * la consulte dans la première seconde d'un redémarrage.
     *
     * `unref` : ce délai ne doit pas retenir un service qu'on arrête.
     */
    setTimeout(veillerAuRoster, 1500).unref?.();
    const horloge = setInterval(veillerAuRoster, 60 * 60 * 1000);
    /* `unref` : cette horloge ne doit pas retenir le processus en vie à elle
       seule, sinon un service arrêté proprement resterait pendu une heure. */
    horloge.unref?.();
  }

  /**
   * UN POSTE QUI DISPARAÎT EMPORTE SES SIGNALEMENTS EN ATTENTE.
   *
   * Sans cela, l'administrateur se voyait demander d'approuver un barrage que son
   * auteur venait de retirer : la notification restait « à traiter », le badge
   * réclamait une action impossible, et « Approuver » n'aurait rien trouvé à
   * mettre en service.
   *
   * On CLASSE, on n'efface pas. La notification porte une copie figée du barrage
   * et reste lisible après sa disparition — c'est même son cas le plus utile :
   * « ce poste a existé, voici qui l'avait posé, et voici pourquoi il n'est
   * plus là ».
   *
   * Pas de décision attachée (`decision: null`) : personne n'a tranché. Le poste
   * a été retiré, ce n'est ni une approbation ni un refus.
   */
  /**
   * UN SIGNALEMENT SANS POSTE N’A RIEN À FAIRE DANS « À TRAITER ».
   *
   * `clore` s’occupe du retrait passant par l’API. Mais un poste peut
   * disparaître autrement : un script de correction, une purge, une
   * suppression faite avant que cette règle existe. Le signalement restait
   * alors ouvert pour toujours, et « Approuver » n’aurait rien trouvé à
   * mettre en service.
   *
   * On rattrape donc à la lecture : toute notification ENCORE OUVERTE dont
   * le barrage a disparu est classée. Sans risque pour les autres cas — une
   * proposition de suppression encore ouverte porte, par définition, sur un
   * poste qui existe toujours ; elle ne devient `traitee` qu’une fois
   * acceptée, et c’est cette acceptation qui efface le poste.
   *
   * Coût nul : quelques dizaines de notifications, un `Set` d’identifiants.
   */
  const reconcilierSignalements = (session) => {
    const ouvertes = depotInstructions.tous().filter((n) => n.statut === 'ouverte');
    if (!ouvertes.length) return 0;

    let classees = 0;
    for (const n of ouvertes) {
      if (depot.parId(n.barrageId)) continue;
      depotInstructions.traiter(n.id, {
        traiteePar: session ? identite(session) : AUTEUR_SYSTEME,
        reponse: 'Poste absent de la carte : signalement classé automatiquement.',
        decision: null,
      });
      classees++;
    }
    return classees;
  };
  /**
   * L'ANCIEN INTOUCHABLE D'UNE COMPAGNIE REDEVIENT UN POSTE ORDINAIRE.
   *
   * Appelé quand un autre poste de la même compagnie prend la protection, et
   * seulement après confirmation explicite. Son horaire est conservé : il
   * reste tenu, il cesse seulement d'être sanctuarisé. Écrit et journalisé ici,
   * pour que la pose d'un nouvel intouchable ne laisse jamais deux ancrages.
   */
  const retirerProtection = (ancien, session) => {
    const rendu = normaliser(
      { ...ancien, ...champsProtection(false) },
      { id: ancien.id, bt: ancien.bt, cie: ancien.cie, reg: ancien.reg, auteur: ancien.auteur, cree: ancien.cree },
    );
    rendu.majPar = identite(session);
    depot.remplacer(ancien.id, rendu);
    journal.consigner({
      session,
      action: 'retirer-intouchable',
      avant: ancien,
      apres: rendu,
      details: { motif: 'remplace par un autre intouchable de la compagnie', cie: ancien.cie },
    });
    return rendu;
  };

  const clore = (barrage, session, motif) => {
    for (const n of depotInstructions.ouvertesPour(barrage.id)) {
      depotInstructions.traiter(n.id, {
        traiteePar: identite(session),
        reponse: motif,
        decision: null,
      });
    }
  };

  /**
   * Recalcule les alertes si le réseau routier est disponible — sans effet sinon.
   *
   * `idModifie` LIMITE LE TRAVAIL AUX PAIRES DE CE BARRAGE. À passer dès qu'un
   * SEUL poste a changé, ce qui est le cas de tous les gestes du terrain :
   * poser, déplacer, corriger. Sans lui, on reprend les 628 881 paires du
   * dispositif national alors que 1 121 seulement peuvent avoir bougé — le
   * geste principal de l'application coûtait ainsi plus d'une seconde. Voir
   * `recalculerAlertes` dans serveur/distances.mjs.
   *
   * On ne le passe PAS pour un import, une génération en lot ou le démarrage :
   * là, tout a changé, et la reprise complète est la bonne réponse.
   */
  const recalculerSiPresent = (idModifie = null) => {
    if (graphe) recalculerAlertes(depotAlertes, depot.tous(), graphe, seuilBarragesKm, idModifie);
  };

  /** Contrairement aux alertes de distance, ne dépend pas du réseau routier : toujours actif. */
  const recalculerConflitsSiPresent = () => {
    recalculerConflits(depotConflitsPlanification, depot.tous());
  };

  /**
   * ACTUALISATION AUTOMATIQUE DU SUIVI DES CONFLITS.
   * Détecte les conflits réels via le moteur routier et les règles de faction,
   * met à jour les statuts ('nouveau', 'a_traiter', 'en_cours', 'resolu'),
   * préserve l'historique et notifie de façon ciblée les commandements concernés.
   */
  const actualiserSuiviConflits = (barrageId, session = null, action = 'operation', details = null, { seuilKm = null } = {}) => {
    /* Le seuil de l'optimisation active (transmis par l'écran) prime sur celui du serveur. */
    const seuilDemande = Number(seuilKm);
    const seuil = Number.isFinite(seuilDemande) && seuilDemande > 0 && seuilDemande <= 200 ? seuilDemande : seuilConflitKm;
    try {
      if (barrageId) {
        return depotSuiviConflits.actualiserApresOperation({
          barrageId,
          session,
          action,
          details,
          graphe,
          depotBarrages: depot,
          depotInstructions,
          depotDemandes,
          depotNotifications,
          seuilKm: seuil,
        });
      }
    } catch (err) {
      console.error(`  ! actualisation suivi conflits (${barrageId}) : ${err.message}`);
    }
    return [];
  };

  /* La référence de présentation, au premier démarrage d’un dossier de démo — après
     la définition du recalcul, dont la capture a besoin. */
  if (mode === MODES.DEMO && !referencePresentation.existe()) {
    capturerReferencePresentation(null, 'premier_demarrage');
    console.log(`  Référence de présentation créée : ${referencePresentation.lire().barrages.length} barrage(s).`);
  }

  /** Les comptes sont relus à chaque connexion : ajouter un compte ne
   *  nécessite pas de redémarrer le serveur. */
  const comptes = () => chargerComptes(fichierComptes);

  /* ---------------------------------------------------------------- */
  /* Utilitaires HTTP                                                 */
  /* ---------------------------------------------------------------- */

  const json = (res, code, corps, entetes = {}) => {
    const texte = JSON.stringify(corps);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(texte),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      /* Une réponse d'API n'a jamais à être encadrée par une autre page : la
         même parade au détournement de clic que sur les fichiers servis (voir
         `ENTETES_SURETE` dans scripts/serve.mjs). */
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      ...entetes,
    });
    res.end(texte);
  };

  const lireCorps = (req, res) =>
    new Promise((resolve, reject) => {
      let taille = 0;
      const morceaux = [];
      req.on('data', (c) => {
        taille += c.length;
        if (taille > CORPS_MAX) {
          const err = new Error(
            `Corps de requête trop volumineux (${Math.round(CORPS_MAX / 1024)} Ko maximum).`,
          );
          err.statut = 413;
          reject(err);
          /**
           * On répond AVANT de couper : détruire la requête immédiatement
           * laisserait le client sur une connexion rompue, sans savoir que
           * c'est la taille qui a été refusée.
           */
          res.on('finish', () => req.destroy());
          return;
        }
        morceaux.push(c);
      });
      req.on('end', () => {
        if (!morceaux.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8')));
        } catch {
          reject(new Error('Corps de requête JSON invalide.'));
        }
      });
      req.on('error', reject);
    });

  /* ---------------------------------------------------------------- */
  /* Autorité                                                        */
  /* ---------------------------------------------------------------- */

  /** Le compte a-t-il le droit d'écrire, quel que soit l'objet ? */
  const peutEcrire = (session) => ROLES[session?.role]?.ecrit === true;

  /**
   * Le marquage relève-t-il du périmètre de l'unité (BT, compagnie, région) ?
   *
   * La correspondance rang → champ de rattachement N'EST PLUS écrite ici : elle
   * vient de `perimetreDuRang` (serveur/comptes.mjs), qui sert aussi à
   * OPTIMISATION. Deux copies de la même règle finissaient par divergir — et
   * c'est exactement ce qui s'était produit, l'une parlant de « brigade » là où
   * l'autre disait « unite ».
   *
   * `admin` n'a pas de périmètre : `perimetreDuRang` renvoie `null`, et il
   * passe partout.
   */
  const dansSonUnite = (session, item) => {
    const p = perimetreDuRang(session);
    return !p || item[p.champ] === p.unite;
  };

/**
   * Marquages visibles EN CONSULTATION pour cette session : un compte de
   * commandement (reg/cie/unite) ne voit que sa propre circonscription, comme
   * pour l'écriture — seul `admin` voit tout.
   *
   * SANS SESSION, PLUS RIEN. Cette fonction rendait la liste ENTIÈRE à un
   * appelant anonyme : « consultation publique », choix assumé du temps où la
   * carte était une démonstration. Sur des données opérationnelles réelles,
   * c'était deux fautes en une.
   *
   * La première est évidente : les 1 124 postes du pays partaient à qui les
   * demandait, sans le moindre identifiant.
   *
   * La seconde est pire, parce qu'elle retourne tout l'édifice : un anonyme
   * voyait PLUS qu'un chef de brigade connecté (1 124 contre 9). Le
   * cloisonnement se contournait donc en SE DÉCONNECTANT. Aucune règle de
   * périmètre ne vaut si sortir de son compte donne davantage que d'y être.
   *
   * Le refus est désormais la valeur par défaut : une route qui oublierait sa
   * garde ne divulgue rien. C'est la seule façon d'écrire ce genre de fonction.
   *
   * Exception conservée : un marquage `partage: true` (diffusé par un chef de
   * région ou l'admin, voir le PATCH `/api/marquages/:id`) reste visible à
   * toutes les régions — une collaboration inter-unités sur un événement qui
   * déborde d'une circonscription ne doit pas être bloquée par le cloisonnement
   * géographique par ailleurs nécessaire.
   */
  const visibles = (session, liste) => {
    if (!session) return [];
    if (session.rang === 'admin') return liste;
    return liste.filter((item) => item.partage === true || dansSonUnite(session, item));
  };

  /**
   * Le compte peut-il écrire sur CE marquage ?
   *
   * Deux conditions : le repère doit relever de son unité, ET il faut soit
   * l'avoir créé soi-même, soit exercer le commandement (rôle `commandement`,
   * ce qu'un compte `admin` porte toujours — voir `serveur/comptes.mjs`). Un
   * gendarme corrige ses propres relevés ; effacer celui d'un autre est un
   * acte de chef, pas une manipulation ordinaire.
   */
  const peutModifier = (session, item) => {
    if (!peutEcrire(session) || !dansSonUnite(session, item)) return false;
    if (superviseur(session) && estBarrage(item)) return false;
    if (ROLES[session.role].surAutrui) return true;
    return item.auteur?.matricule === session.matricule;
  };

  /** Motif du refus, en clair : l'utilisateur doit savoir ce qui bloque. */
  const motifRefus = (session, item) => {
    if (superviseur(session) && estBarrage(item)) return REFUS_SUPERVISION;
    if (!peutEcrire(session)) return 'Compte en lecture seule : aucune écriture autorisée.';
    if (!dansSonUnite(session, item)) {
      return session.rang === 'reg'
        ? `Ce marquage relève de la région ${item.reg ?? '—'}, hors de votre autorité.`
        : session.rang === 'unite'
          ? `Ce marquage relève de la brigade ${item.bt ?? '—'}, hors de votre autorité.`
          : `Ce marquage relève de la compagnie ${item.cie ?? '—'}, hors de votre autorité.`;
    }
    return (
      `Ce repère a été posé par ${item.auteur?.nom ?? 'un autre agent'} : ` +
      'seul un compte de commandement peut le modifier.'
    );
  };

  /** Message de refus explicite : l'utilisateur doit savoir pourquoi. */
  const motifPerimetre = (session, verdict) =>
    verdict === 'indisponible'
      ? `Aucun contour trouvé pour ${session.unite} : le serveur ne peut pas vérifier le périmètre (couches absentes ?).`
      : session.rang === 'reg'
        ? `Point hors de la région ${session.unite} : écriture refusée.`
        : session.rang === 'cie'
          ? `Point hors de la circonscription de la compagnie ${session.unite} : écriture refusée.`
          : `Point hors de la brigade territoriale ${session.unite} : écriture refusée.`;

  /**
   * Rattachement d'un point, d'après la géométrie et non d'après le client.
   * Un chef de région ou de compagnie couvre plusieurs unités plus fines :
   * c'est le serveur qui détermine lesquelles, sinon la répartition serait
   * déclarative. `admin` n'a pas d'unité propre : purement géographique.
   */
  const rattacher = (session, pt) => {
    const trouve = localiser(circonscriptions, pt);
    if (session.rang === 'admin') return trouve;
    if (session.rang === 'unite') {
      return { bt: session.unite, cie: session.cie ?? trouve.cie, reg: session.reg ?? trouve.reg };
    }
    if (session.rang === 'reg') return { bt: trouve.bt, cie: trouve.cie, reg: session.unite };
    // 'cie'
    return { bt: trouve.bt, cie: session.unite, reg: trouve.reg ?? session.reg ?? null };
  };

  const barragesAutorisesOptimisation = (session) => visibles(session, depot.tous()).filter(
    (m) => m.type === 'barrage_fixe' &&
      m.statutBarrage !== 'supprime' && m.statutBarrage !== 'retire_optimisation',
  );
  /**
   * LE PÉRIMÈTRE DE L'OPTIMISATION AUTOMATIQUE — RBAC ET FACTION.
   *
   * Deux barrages de factions différentes ne sont jamais tenus en même temps :
   * les confronter produisait des conflits qui n'existent pas sur le terrain,
   * et quadruplait le calcul. Ne sont donc déplaçables que les barrages de la
   * faction analysée, lue comme partout ailleurs par `factionsDuBarrage` (fiche,
   * horaire, puis relèves du jour — même lecture que `/api/factions`).
   *
   * Les Intouchables sont permanents, en service dans chaque faction : ceux du
   * périmètre RBAC qui peuvent contraindre une position (voir
   * `intouchablesUtiles`) sont joints, comme obstacles fixes, jamais déplacés.
   */
  const perimetreOptimisationAuto = (session, factionId, jour, zone = null) => {
    const creneauxDuJour = depotElements.creneauxParBarrage(jour, jour);
    const autorises = barragesAutorisesOptimisation(session);
    const toutes = !factionId || factionId === 'toutes' || factionId === 'all';
    const deplacables = autorises.filter((m) => !estIntouchable(m) &&
      (!zone || m[zone.champ] === zone.unite) &&
      (toutes || factionsDuBarrage(m, creneauxDuJour.get(m.id) ?? null).includes(factionId)));
    /* Les Intouchables peuvent être hors de la zone (juste de l'autre côté
       d'une limite) : ils valident le seuil de distance, jamais davantage. */
    const intouchables = intouchablesUtiles(deplacables, autorises.filter(estIntouchable), {
      zoneBbox: zone?.bbox ?? null,
    });
    return { deplacables, intouchables, barrages: [...deplacables, ...intouchables] };
  };

  /**
   * LA ROUTE OU LE TRAJET D'UNE FILTRATION — résolu ici, à partir d'une
   * description : `{type:'route', ref}` ou `{type:'trajet', trajetId, variante}`.
   * Le tracé vient du graphe (route) ou d'un trajet calculé par CE serveur
   * (trajet) ; le client n'envoie jamais de géométrie. La bande retenue autour
   * du tracé n'est plus un réglage : c'est la tolérance d'appartenance
   * (TOLERANCE_ROUTE_KM), voir `appartenanceRoute`.
   */
  const resoudreCorridor = (spec) => {
    if (!graphe) return { statut: 409, erreur: 'Réseau routier indisponible : lancez « npm run build:roads ».' };
    /* La distance d'un barrage à la route (appartenance) — un paramètre À PART
       de l'écart entre barrages : 150 m par défaut, de 50 à 500 m. */
    const toleranceM = spec?.toleranceM == null ? TOLERANCE_ROUTE_KM * 1000 : Number(spec.toleranceM);
    if (!Number.isFinite(toleranceM) || toleranceM < 50 || toleranceM > 500) {
      return { statut: 400, erreur: 'Distance à la route invalide : entre 50 et 500 m.' };
    }
    const km = toleranceM / 1000;
    if (spec?.type === 'route') {
      const trace = traceRoute(graphe, String(spec.ref ?? ''), villes);
      if (!trace) return { statut: 404, erreur: `Route inconnue du réseau : « ${spec?.ref ?? ''} ».` };
      return {
        spec: { type: 'route', ref: trace.ref, km },
        libelle: trace.ref,
        lignes: trace.lignes,
        refs: new Set([trace.ref]),
        corridor: creerCorridor(trace.lignes, km),
      };
    }
    if (spec?.type === 'trajet') {
      const t = trajetsCalcules.get(String(spec.trajetId ?? ''));
      const v = t?.variantes.find((x) => x.rang === Number(spec.variante));
      if (!t || !v) return { statut: 409, erreur: 'Trajet expiré ou inconnu : recalculez l’itinéraire.' };
      return {
        spec: { type: 'trajet', trajetId: t.id, variante: v.rang, km },
        libelle: `${t.depart.nom} → ${t.arrivee.nom} (itinéraire ${v.rang})`,
        lignes: [v.coords],
        /* Les routes numérotées qu'emprunte le trajet. */
        refs: new Set(v.routes.map((r) => r.ref)),
        corridor: creerCorridor([v.coords], km),
      };
    }
    return { statut: 400, erreur: 'Périmètre routier invalide : « route » ou « trajet ».' };
  };

  /**
   * UN BARRAGE EST-IL SUR CETTE ROUTE ? — la géométrie ET la route.
   *
   * Être PROCHE du tracé ne suffit pas : aux croisements, un poste de la route
   * voisine est à quelques mètres de la RN1 sans être sur la RN1. Un barrage
   * est retenu quand :
   *   1. il est à moins de TOLERANCE_ROUTE_KM (150 m) du tracé réel — l'écart
   *      GPS et la simplification du graphe, mesurés sur le dispositif (les
   *      postes d'une route sont à moins de 45 m de son tracé) ;
   *   2. ET la route qu'il porte est celle du tracé (ou l'une de celles du
   *      trajet) ; s'il n'en porte aucune exploitable, c'est la route
   *      numérotée la plus proche de lui qui doit l'être.
   * Un poste enregistré sur la route mais loin de son tracé n'est PAS retenu :
   * il est signalé, « position à vérifier », jusqu'à PORTEE_VERIFICATION_KM.
   *
   * @returns {{sur: boolean, raison?: string}|null} `null` : sans rapport.
   */
  const PORTEE_VERIFICATION_KM = 2;
  const refDuBarrage = (m) => /^(A|RN|RR|RP)\d+[A-Z]?$/.exec(String(m.route ?? '').trim())?.[0] ?? null;
  const appartenanceRoute = (resolu, m, d) => {
    const ref = refDuBarrage(m);
    if (d <= resolu.corridor.km) {
      if (ref) return resolu.refs.has(ref) ? { sur: true } : { sur: false, raison: `Sur une autre route (${ref})` };
      const acc = accrocher(graphe, m.lng, m.lat, resolu.corridor.km);
      const proche = acc ? refArete(graphe, acc.arete) : null;
      if (proche && resolu.refs.has(proche)) return { sur: true };
      return { sur: false, raison: proche ? `Plus proche de la ${proche}` : 'Route du poste non numérotée' };
    }
    if (ref && resolu.refs.has(ref) && d <= PORTEE_VERIFICATION_KM) {
      return { sur: false, raison: `Enregistré sur ${ref}, mais à ${Math.round(d * 1000)} m de son tracé : position à vérifier` };
    }
    return null;
  };

  /**
   * LES BARRAGES DE LA ROUTE — tous types et toutes factions, en service, que
   * le compte voit. Lecture seule : c'est la liste de la filtration.
   */
  const barragesSurRoute = (session, resolu) => {
    const sur = [];
    const exclusions = [];
    const distances = new Map();
    for (const m of visibles(session, depot.tous())) {
      if (!estBarrage(m) || m.statutBarrage === 'supprime' || m.statutBarrage === 'retire_optimisation') continue;
      const d = resolu.corridor.distance([m.lng, m.lat], PORTEE_VERIFICATION_KM);
      if (!Number.isFinite(d)) continue;
      const a = appartenanceRoute(resolu, m, d);
      if (!a) continue;
      distances.set(m.id, d);
      if (a.sur) sur.push(m);
      else exclusions.push({ id: m.id, raison: a.raison, barrage: m });
    }
    return { sur, exclusions, distances };
  };

  /**
   * LE PÉRIMÈTRE D'UNE OPTIMISATION PAR ROUTE (moteur, sans interface) — même
   * RBAC, même faction, mêmes Intouchables que l'automatique, restreints aux
   * barrages SUR la route (`appartenanceRoute`).
   *
   *   deplacables  barrages fixes de la faction, sur la route ;
   *   fixes        les Intouchables de la route, et les postes hors route
   *                assez proches pour gêner une position proposée : ils
   *                comptent dans les conflits, ils ne bougent jamais ;
   *   exclusions   ce qui touche la route mais n'entre pas dans le calcul.
   */
  const perimetreCorridor = (session, factionId, jour, resolu) => {
    const { corridor } = resolu;
    const creneaux = depotElements.creneauxParBarrage(jour, jour);
    const toutes = !factionId || factionId === 'toutes' || factionId === 'all';
    const deFaction = (m) => toutes || factionsDuBarrage(m, creneaux.get(m.id) ?? null).includes(factionId);
    const autorises = barragesAutorisesOptimisation(session);
    const autorisesIds = new Set(autorises.map((m) => m.id));
    const portee = corridor.km + SEUIL_DISTANCE_AUTO_KM;
    const deplacables = [];
    const fixes = [];
    const exclusions = [];
    const distances = new Map();
    for (const m of autorises) {
      const d = corridor.distance([m.lng, m.lat], portee);
      if (!Number.isFinite(d)) continue;
      distances.set(m.id, d);
      const a = d <= PORTEE_VERIFICATION_KM ? appartenanceRoute(resolu, m, d) : null;
      const dedans = Boolean(a?.sur);
      if (a && !a.sur) exclusions.push({ id: m.id, raison: a.raison });
      if (estIntouchable(m)) {
        if (dedans) exclusions.push({ id: m.id, raison: 'Intouchable : protégé, jamais déplacé' });
        fixes.push(m);
      } else if (!deFaction(m)) {
        if (dedans) exclusions.push({ id: m.id, raison: 'Autre faction : pas tenu en même temps' });
      } else if (!dedans) {
        fixes.push(m);
      } else if (!peutModifier(session, m)) {
        exclusions.push({ id: m.id, raison: motifRefus(session, m) });
        fixes.push(m);
      } else {
        deplacables.push(m);
      }
    }
    /* Sur la route, hors calcul : mobiles, supprimés, retirés. */
    for (const m of visibles(session, depot.tous())) {
      if (autorisesIds.has(m.id) || (m.type !== 'barrage_fixe' && m.type !== 'barrage_mobile')) continue;
      const d = corridor.distance([m.lng, m.lat]);
      if (!Number.isFinite(d) || !appartenanceRoute(resolu, m, d)?.sur) continue;
      distances.set(m.id, d);
      exclusions.push({
        id: m.id,
        raison: m.type === 'barrage_mobile'
          ? 'Barrage mobile : hors filtration automatique'
          : m.statutBarrage === 'supprime' ? 'Supprimé' : 'Déjà retiré par une filtration',
      });
    }
    const parId = new Map(visibles(session, depot.tous()).map((m) => [m.id, m]));
    return {
      deplacables,
      fixes,
      barrages: [...deplacables, ...fixes],
      exclusions: exclusions.map((e) => ({ ...e, barrage: parId.get(e.id) ?? null, distanceKm: distances.get(e.id) ?? null })),
      distances,
    };
  };

  /**
   * LE SUPER ADMIN SUPERVISE — IL NE MODIFIE PLUS LES BARRAGES.
   *
   * Il voit tout, il ASSIGNE un barrage au CMND Région compétent, et c'est le
   * commandement qui traite. Les gestes qui écrivent un barrage en service
   * (modifier, déplacer, supprimer, changer la faction, appliquer une
   * filtration, arbitrer, restaurer) lui sont refusés ICI, côté serveur, et non
   * seulement retirés de l'écran. Ses autres droits d'administration — comptes,
   * génération et import du dispositif, effectifs, alertes, validation des
   * demandes des unités — sont inchangés.
   */
  const REFUS_SUPERVISION =
    'Le Super Admin supervise sans modifier directement les barrages : assignez ce barrage au CMND Région compétent.';
  const superviseur = (session) => session?.rang === 'admin';
  /** L'assignation encore ouverte pour ce barrage, s'il y en a une (quel que soit son destinataire). */
  const assignationOuverte = (barrageId) =>
    depotInstructions.ouvertesPour(barrageId).find((i) => i.action === 'assignation') ?? null;
  /**
   * Le conflit ACTIF de ce barrage déjà remis au CMD Région de sa région (circuit
   * des conflits) : le barrage est déjà entre ses mains, une seconde assignation
   * par l'autre circuit ferait doublon. Seule l'instruction du barrage A d'un
   * conflit est écrite, d'où cette lecture du conflit lui-même.
   */
  const conflitAssignePour = (b) =>
    depotSuiviConflits.tous().find((c) =>
      !c.is_deleted && !c.deleted && !estClos(c) && etatDe(c) !== ETATS.NEW &&
      (c.barrageAId === b.id || c.barrageBId === b.id) &&
      regionsAssignees(c).some((r) => String(r.unite ?? '').toLowerCase() === String(b.reg ?? '').toLowerCase())) ?? null;

  /**
   * LA CHAÎNE D'ASSIGNATION — Super Admin → CMND Région → CMND Cie.
   *
   * Chaque maillon est une notification `assignation` avec son DESTINATAIRE
   * (`{rang, unite}`). Les assignations antérieures à ce champ étaient toutes
   * adressées à la région du barrage : c'est leur destinataire par défaut.
   */
  const destinataireDe = (i) => i.destinataire ?? { rang: 'reg', unite: i.barrage?.reg ?? null };
  const estDestinataire = (session, i) => {
    const d = destinataireDe(i);
    return Boolean(session) && d.rang === session.rang && d.unite === session.unite;
  };
  /** L'assignation ouverte de CE barrage adressée à CE compte. */
  const assignationPour = (session, barrageId) =>
    depotInstructions.ouvertesPour(barrageId).find((i) => i.action === 'assignation' && estDestinataire(session, i)) ?? null;

  /**
   * CLORE UNE ASSIGNATION — le seul chemin, et il est journalisé.
   *
   * `par` : qui a fait le traitement (le destinataire). `session` : qui écrit
   * maintenant — le même, sauf quand c'est l'acceptation par l'administration
   * d'un déplacement demandé qui rend le traitement effectif.
   */
  const cloreAssignation = (session, assignation, reponse, par = identite(session)) => {
    const traitee = depotInstructions.traiter(assignation.id, { traiteePar: par, reponse });
    const barrage = depot.parId(assignation.barrageId) ?? { id: assignation.barrageId, ...assignation.barrage };
    journal.consigner({
      session, action: 'assignation_traitee', avant: barrage, apres: barrage,
      details: { categorie: 'assignation', assignationId: assignation.id, reponse },
    });
    return traitee;
  };

  /**
   * L'OPÉRATION EST FAITE : L'ASSIGNATION EST TRAITÉE.
   *
   * Le CMND Région traite un barrage assigné depuis sa bulle (« Traiter →
   * Changer la faction », « Déplacer ») aussi bien que depuis le panneau
   * Assignations. Dans tous les cas, c'est l'écriture EFFECTIVE qui clôt —
   * jamais la demande : un déplacement qui part en validation laisse
   * l'assignation ouverte jusqu'à son acceptation (voir PATCH
   * /api/instructions/:id).
   *
   * `porteur` : `{rang, unite}` du commandement qui a traité.
   */
  const terminerAssignationsDe = (session, barrageId, porteur, reponse, par = identite(session)) => {
    for (const i of depotInstructions.ouvertesPour(barrageId)) {
      if (i.action !== 'assignation') continue;
      const d = destinataireDe(i);
      if (d.rang === porteur?.rang && d.unite === porteur?.unite) cloreAssignation(session, i, reponse, par);
    }
  };

  /**
   * LES NOTIFICATIONS QUE CETTE SESSION VOIT — `visiblePour`
   * (serveur/notifications.mjs), avec le périmètre de `perimetreDuRang` et les
   * barrages qui lui sont assignés, exactement comme la carte les lui montre.
   */
  const notificationsVisibles = (session) => {
    const perimetre = perimetreDuRang(session);
    const assignes = new Set(
      depotInstructions.tous()
        .filter((i) => i.action === 'assignation' && i.statut === 'ouverte' && estDestinataire(session, i))
        .map((i) => i.barrageId),
    );
    return depotNotifications.tous().filter((n) =>
      visiblePour(session, n, { perimetre, assigne: Boolean(n.barrageId && assignes.has(n.barrageId)) }));
  };

  /**
   * LE FLUX TEMPS RÉEL — une connexion `text/event-stream` par poste ouvert.
   *
   * À chaque notification publiée, chaque abonné qui a le droit de la voir
   * reçoit un événement : l'écran relit alors sa liste, sans recharger la page.
   * La session est relue à chaque envoi SANS être prolongée (`S.consulter`) :
   * expirée ou fermée, la connexion est coupée.
   */
  const abonnesFlux = new Set();
  depotNotifications.abonner((n) => {
    for (const a of abonnesFlux) {
      const s = S.consulter(a.jeton);
      if (!s) {
        a.fermer();
        continue;
      }
      const perimetre = perimetreDuRang(s);
      if (visiblePour(s, n, { perimetre, assigne: Boolean(n.barrageId && assignationPour(s, n.barrageId)) })) {
        a.res.write(`event: notification\ndata: ${JSON.stringify({ id: n.id, type: n.type })}\n\n`);
      }
    }
  });

  /**
   * QUI PEUT CHANGER LA FACTION D'UN BARRAGE.
   *   CMND Région   tout barrage de sa région ;
   *   CMND Cie      les barrages QUI LUI SONT ASSIGNÉS, et eux seuls ;
   *   Super Admin   jamais (il assigne) ; chef de brigade : jamais.
   */
  const droitFaction = (session, b) => {
    if (superviseur(session)) return { statut: 403, erreur: REFUS_SUPERVISION };
    if (!peutEcrire(session)) return { statut: 403, erreur: 'Compte en lecture seule : aucune écriture autorisée.' };
    if (session.rang === 'reg') return peutModifier(session, b) ? { ok: true } : { statut: 403, erreur: motifRefus(session, b) };
    if (session.rang === 'cie') {
      return assignationPour(session, b.id)
        ? { ok: true }
        : { statut: 403, erreur: 'Ce barrage ne vous est pas assigné : le CMND Cie traite les barrages que sa région lui assigne.' };
    }
    return { statut: 403, erreur: 'Le changement de faction est réservé au CMND Région et au CMND Cie.' };
  };

  /** Le changement de faction lui-même — écrit, journalisé. `{statut, erreur}` ou `{item, ancienne, nouvelle}`. */
  const changerFaction = (session, existant, factionId, commentaire = '', autoriserBfi = false) => {
    if (estIntouchable(existant) && !autoriserBfi) return { statut: 409, erreur: 'Barrage intouchable : il est en service sur toutes les factions.' };
    const nouvelle = factionParId(String(factionId ?? ''));
    if (!nouvelle) return { statut: 400, erreur: `Faction inconnue : « ${factionId ?? ''} ».` };
    if (nouvelle.id === existant.factionId) return { statut: 400, erreur: `Le barrage est déjà en ${nouvelle.nom}.` };
    const modifie = { ...existant, factionId: nouvelle.id, majPar: identite(session), maj: new Date().toISOString() };
    depot.remplacer(existant.id, modifie);
    journal.consigner({
      session, action: 'changement_faction', avant: existant, apres: modifie,
      details: { categorie: 'faction', ancienne: existant.factionId || null, nouvelle: nouvelle.id },
    });
    /* Les rapprochements et chevauchements dépendent de la faction. */
    depotAlertes.supprimerConcernant(existant.id);
    depotConflitsPlanification.supprimerConcernant(existant.id);
    recalculerSiPresent(existant.id);
    recalculerConflitsSiPresent();
    actualiserSuiviConflits(existant.id, session, 'changement_faction', {
      ancienne: existant.factionId || null,
      nouvelle: nouvelle.id,
      commentaire,
    });
    terminerAssignationsDe(
      session, existant.id, session,
      `Faction : ${factionParId(existant.factionId)?.nom ?? 'aucune'} → ${nouvelle.nom}${commentaire ? ` — ${commentaire}` : ''}`,
    );
    return { item: modifie, ancienne: existant.factionId || null, nouvelle: nouvelle.id, nomNouvelle: nouvelle.nom };
  };

  /** Les comptes CMND Cie de la région (qui écrivent), restreints à la compagnie du barrage si renseignée. */
  const cmndCieDeRegion = (region, barrage = null) => {
    const etat = comptes();
    const tous = listerComptes(etat)
      .filter((c) => c.rang === 'cie' && ROLES[c.role]?.ecrit &&
        (c.reg === region || circonscriptions.compagnie?.get(c.unite)?.reg === region))
      .map((c) => ({ matricule: c.matricule, nom: c.nom, unite: c.unite, duBarrage: Boolean(barrage && c.unite === barrage.cie) }));
    return tous.sort((a, b) => Number(b.duBarrage) - Number(a.duBarrage) || a.unite.localeCompare(b.unite, 'fr'));
  };

  /** Le périmètre d'une simulation automatique, zone ou corridor — le même à l'analyse et à l'application. */
  const perimetreDeSimulation = (session, sim) => (sim.corridor
    ? perimetreCorridor(session, sim.factionId, sim.jour, sim.corridor)
    : perimetreOptimisationAuto(session, sim.factionId, sim.jour, sim.zone));

  /**
   * LA ZONE ANALYSÉE — la portée que la carte consulte, revalidée ici.
   *
   * Le client envoie `{niveau, unite}` : c'est `porteeCourante` (src/marquages.js),
   * la même portée que le fil d'Ariane et le filtre territorial. Le serveur ne
   * la croit pas : elle doit être le périmètre du compte ou une unité PLUS FINE
   * qui y est contenue — la même règle que `porteeCourante`. Sans zone, le
   * périmètre du rang s'applique (tout le pays pour un administrateur).
   */
  /**
   * NIVEAU HIÉRARCHIQUE → CHAMP DE RATTACHEMENT DU BARRAGE ('region' → 'reg'…).
   *
   * Lu dans `RANGS` (serveur/comptes.mjs), la table qui fait déjà foi pour le
   * RBAC : chaque rang y porte son `niveauOptimisation` et son `champ`. Il
   * n'existe donc qu'une idée de ce qu'est « la région » d'un barrage — celle
   * que `perimetreDuRang` et `dansSonUnite` appliquent déjà.
   */
  const CHAMP_DU_NIVEAU = Object.fromEntries(
    Object.values(RANGS).filter((r) => r.champ).map((r) => [r.niveauOptimisation, r.champ]),
  );
  const RANG_DE_NIVEAU = { region: 'reg', compagnie: 'cie', brigade: 'unite' };
  const INDEX_DE_NIVEAU = { region: 'region', compagnie: 'compagnie', brigade: 'bt' };
  const ORDRE_NIVEAU = { region: 0, compagnie: 1, brigade: 2 };
  const zoneOptimisation = (session, niveau, unite) => {
    const impose = perimetreDuRang(session);
    const demande = CHAMP_DU_NIVEAU[niveau] && typeof unite === 'string' && unite.trim()
      ? { niveau, unite: unite.trim() }
      : impose ? { niveau: impose.niveau, unite: impose.unite } : null;
    if (!demande) return { zone: null };
    const contour = circonscriptions[INDEX_DE_NIVEAU[demande.niveau]]?.get(demande.unite);
    if (!contour) return { statut: 400, erreur: `Unité inconnue : « ${demande.unite} ».` };
    if (impose) {
      const meme = demande.niveau === impose.niveau && demande.unite === impose.unite;
      const plusFine = ORDRE_NIVEAU[demande.niveau] > ORDRE_NIVEAU[impose.niveau] &&
        contour[impose.champ] === impose.unite;
      if (!meme && !plusFine) {
        return { statut: 403, erreur: `« ${demande.unite} » est hors de votre périmètre.` };
      }
    }
    return {
      zone: {
        niveau: demande.niveau,
        unite: demande.unite,
        champ: CHAMP_DU_NIVEAU[demande.niveau],
        bbox: contour.bbox,
        /* Pour `controler` : une session fictive dont le périmètre est la zone. */
        porteur: { rang: RANG_DE_NIVEAU[demande.niveau], unite: demande.unite },
      },
    };
  };
  /** Une position proposée doit rester dans le RBAC ET dans la zone analysée. */
  const positionAutorisee = (session, zone, pt) =>
    controler(circonscriptions, session, pt) === 'autorise' &&
    (!zone || controler(circonscriptions, zone.porteur, pt) === 'autorise');
  /**
   * L'ESPACE ADJACENT — une bande LOCALE juste au-delà de la zone analysée,
   * utilisée seulement quand la zone n'offre aucune position valide (voir
   * `resoudreAvecEspaceAdjacent`, serveur/optimisationDistance.mjs).
   *
   * Un point y est admis s'il est : dans le PÉRIMÈTRE RBAC du compte (le même
   * contrôle que partout), HORS de la zone analysée, à moins de
   * ESPACE_ADJACENT_KM au-delà de son cadre, et — pour une recherche — à moins
   * de ESPACE_ADJACENT_DEPLACEMENT_KM du poste. Ni territoire élargi, ni pays
   * entier : sans zone (vue nationale), il n'y a pas d'espace adjacent.
   */
  const ESPACE_ADJACENT_KM = 10;
  const ESPACE_ADJACENT_DEPLACEMENT_KM = 30;
  const dansCadreElargi = (zone, pt, margeKm) => {
    const [x0, y0, x1, y1] = zone.bbox;
    const dLat = margeKm / 111;
    const dLng = margeKm / (111 * Math.cos((((y0 + y1) / 2) * Math.PI) / 180));
    return pt[0] >= x0 - dLng && pt[0] <= x1 + dLng && pt[1] >= y0 - dLat && pt[1] <= y1 + dLat;
  };
  const dansEspaceAdjacent = (session, zone, pt) => Boolean(zone?.bbox) &&
    dansCadreElargi(zone, pt, ESPACE_ADJACENT_KM) &&
    controler(circonscriptions, session, pt) === 'autorise' &&
    controler(circonscriptions, zone.porteur, pt) !== 'autorise';
  const espaceAdjacentPour = (session, zone, obstacles = []) => (zone?.bbox ? {
    dansZone: (pt, b) => distanceKm(pt[0], pt[1], b.lng, b.lat) <= ESPACE_ADJACENT_DEPLACEMENT_KM && dansEspaceAdjacent(session, zone, pt),
    garderPosition: (_b, pt) => dansEspaceAdjacent(session, zone, pt),
    obstacles,
  } : null);
  /** Les postes FIXES de l'espace adjacent : même faction (ou Intouchables), visibles du compte. */
  const obstaclesAdjacents = (session, factionId, jour, zone, dejaIds) => {
    if (!zone?.bbox) return [];
    const creneaux = depotElements.creneauxParBarrage(jour, jour);
    return barragesAutorisesOptimisation(session).filter((m) => !dejaIds.has(m.id) &&
      dansCadreElargi(zone, [m.lng, m.lat], ESPACE_ADJACENT_KM + SEUIL_DISTANCE_AUTO_KM) &&
      (estIntouchable(m) || factionsDuBarrage(m, creneaux.get(m.id) ?? null).includes(factionId)));
  };
  /** « Compagnie Salé » — l'unité de même niveau où tombe la position adjacente. */
  const libelleEspaceAdjacent = (zone, pt) => {
    const l = localiser(circonscriptions, pt);
    const nom = zone?.niveau === 'region' ? l.reg : zone?.niveau === 'compagnie' ? l.cie : l.bt;
    return nom ? `${{ region: 'Région', compagnie: 'Compagnie', brigade: 'Brigade' }[zone.niveau]} ${nom}` : 'Espace adjacent';
  };
  const libelleZone = (zone) =>
    zone ? `${{ region: 'Région', compagnie: 'Compagnie', brigade: 'Brigade' }[zone.niveau]} ${zone.unite}` : 'Tout le pays';
  /**
   * L'ENSEMBLE MESURÉ PAR L'OPTIMISATION MANUELLE — RBAC, une faction, plus les
   * Intouchables. Le même pour la mesure et pour la revalidation à l'application.
   */
  const ensembleManuel = (session, factionId, jour) => {
    const creneaux = depotElements.creneauxParBarrage(jour, jour);
    const autorises = barragesAutorisesOptimisation(session);
    const toutes = !factionId || factionId === 'toutes' || factionId === 'all';
    return {
      autorises,
      barrages: autorises.filter((m) => estIntouchable(m) || toutes ||
        factionsDuBarrage(m, creneaux.get(m.id) ?? null).includes(factionId)),
    };
  };

  /**
   * UN ARBITRAGE D'OPTIMISATION ÉCRIT SUR UN BARRAGE — « conserver » ou
   * « proposer_suppression ».
   *
   * Le seul chemin d'écriture de ces deux gestes, partagé par la route `lot` et
   * par l'activation d'une optimisation manuelle. La suppression n'efface rien :
   * elle est PROPOSÉE au commandement concerné (`decisionOptimisation:
   * 'a_supprimer'` et une instruction « suppression »), qui la valide — la
   * règle de validation existante n'est pas contournée.
   */
  const DECISION_ARBITRAGE = { conserver: 'conserve', proposer_suppression: 'a_supprimer', reconsiderer: 'aucune' };
  const arbitrerBarrage = (session, existant, action, criteresDecision = null) => {
    const item = normaliser(
      { ...existant, statutBarrage: existant.statutBarrage, decisionOptimisation: DECISION_ARBITRAGE[action] },
      { id: existant.id, bt: existant.bt, cie: existant.cie, reg: existant.reg, auteur: existant.auteur, cree: existant.cree },
    );
    item.majPar = identite(session);
    depot.remplacer(existant.id, item);
    journal.consigner({ session, action: 'modifier', avant: existant, apres: item });
    if (action === 'conserver' || action === 'proposer_suppression') {
      depotInstructions.creer({
        barrageId: item.id,
        barrage: item,
        action: action === 'conserver' ? 'conservation' : 'suppression',
        source: 'optimisation',
        criteres: criteresDecision,
        texte:
          action === 'conserver'
            ? 'Le poste est maintenu malgré le rapprochement constaté.'
            : 'Le retrait de ce poste est proposé : il est trop proche de son voisin.',
        auteur: identite(session),
      });
    } else if (action === 'reconsiderer') {
      for (const n of depotInstructions.ouvertesPour(item.id)) depotInstructions.supprimer(n.id);
    }
    return item;
  };

  /** « OPT-20260930-1542-3F9A » : lisible, daté, unique par simulation. */
  const libelleSimulation = (id, creee) => {
    const d = new Date(creee);
    const p = (n) => String(n).padStart(2, '0');
    return `OPT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${String(id).slice(0, 4).toUpperCase()}`;
  };

  /**
   * LA TRACE D'UNE DÉCISION D'OPTIMISATION — dans le journal existant.
   *
   * Pas de second système : `journal.consigner`, comme toute écriture, avec
   * `details.categorie = 'optimisation'` pour la relire (voir `/api/journal`).
   * Chaque entrée dit qui, quand, sur quel périmètre et quelle faction, quel
   * barrage, d'où à où, avec quelles distances routières, quelle action et
   * quel statut : PROPOSÉ (simulé), ACTIVÉE (écrite), REFUSÉE (par le serveur).
   */
  const ACTION_JOURNAL = { conserver: 'KEEP', deplacer: 'MOVE', supprimer: 'DELETE' };
  const journaliserDecision = (session, {
    statut, type, barrage, zoneLibelle, factionId, simulation = null, mode = 'MANUEL',
    avant = null, apres = null, distanceAvantKm = null, distanceApresKm = null, seuilKm = null, raison = null,
  }) => journal.consigner({
    session,
    action: 'optimisation_decision',
    avant: barrage,
    apres: barrage,
    details: {
      categorie: 'optimisation', statut, mode, type, action: ACTION_JOURNAL[type] ?? type,
      zone: zoneLibelle, factionId, simulation, seuilKm,
      positionAvant: avant, positionApres: apres, distanceAvantKm, distanceApresKm, raison,
    },
  });
  const journaliserActivation = (session, { statut, mode, simulation, zoneLibelle, factionId, raison = null, nombre = null }) =>
    journal.consigner({
      session, action: 'optimisation_activation', avant: null, apres: null,
      details: { categorie: 'optimisation', statut, mode, simulation, zone: zoneLibelle, factionId, raison, nombre },
    });

  const signatureOptimisation = (barrages) => JSON.stringify(
    barrages.map((b) => [
      b.id, b.lng, b.lat, b.route || '', b.pk ?? null, b.factionId || '',
      b.type, b.statutBarrage || '', b.protection || '', b.intouchable === true,
      b.accidentCount ?? 0, b.exceptionnel === true, b.missionId || '',
      b.eclairage || '', b.positionVille || '', b.decisionOptimisation || '',
      b.severite || '', b.activite || '', b.infraction || '', b.bt || '', b.cie || '', b.reg || '',
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );

  /* ---------------------------------------------------------------- */
  /* Routeur                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * @returns true si la requête a été traitée (ne pas la passer au statique).
   */
  return async function api(req, res) {
    const url = new URL(req.url, 'http://interne');
    if (!url.pathname.startsWith('/api/')) return false;

    const chemin = url.pathname.replace(/\/+$/, '');
    const ecriture = req.method !== 'GET' && req.method !== 'HEAD';

    try {
      /* --- Garde anti-falsification sur toute écriture --- */
      if (ecriture && !S.memeChaine(req.headers['x-requested-with'], EN_TETE_ATTENDU)) {
        json(res, 403, { erreur: "Requête refusée : en-tête d'origine absent." });
        return true;
      }

      const session = S.lire(S.jetonDe(req));

      /**
       * VERROU DE PREMIER ACCÈS — appliqué ICI, avant tout aiguillage.
       *
       * Un compte ouvert avec un mot de passe temporaire porte
       * `doitChanger`. Tant qu'il le porte, il n'a accès à RIEN d'autre que :
       *
       *   — `/api/etat`            l'écran de connexion en a besoin ;
       *   — `/api/session`         pour se relire ou se refermer ;
       *   — `/api/motdepasse`      le seul geste qu'on attend de lui.
       *
       * POURQUOI AU SERVEUR ET NON DANS L'INTERFACE. « L'utilisateur ne doit
       * pas pouvoir continuer » ne peut pas être tenu par un écran : il suffit
       * d'appeler l'API directement pour passer outre. Le refus est donc rendu
       * par la seule porte que tout le monde franchit, et il est impossible de
       * l'éviter en changeant une URL, un identifiant ou un état de page.
       *
       * Le code 428 (« Precondition Required ») dit exactement cela : la
       * requête est légitime, mais une condition préalable n'est pas remplie.
       * L'interface s'en sert pour rouvrir l'écran de changement si un poste
       * resté ouvert tente autre chose.
       */
      const LIBRES_AVANT_CHANGEMENT = ['/api/etat', '/api/session', '/api/motdepasse'];
      if (session?.doitChanger === true && !LIBRES_AVANT_CHANGEMENT.includes(chemin)) {
        json(res, 428, {
          erreur:
            'Mot de passe temporaire : choisissez un nouveau mot de passe avant de continuer.',
          motDePasseAChanger: true,
        });
        return true;
      }

      /* ------------------------- état ------------------------- */
      if (chemin === '/api/etat' && req.method === 'GET') {
        const etat = comptes();
        json(res, 200, {
          service: 'habilitation',
          mode,
          comptes: Object.keys(etat.comptes).length,
          contours: {
            compagnies: circonscriptions.compagnie.size,
            regions: circonscriptions.region.size,
            manquant: circonscriptions.manquant,
          },
          reseauRoutier: !!graphe,
          sessions: S.compteSessions(),
          /* Le navigateur n'affiche le bouton d'analyse que si un assistant
             existe : un bouton qui répond « non configuré » ne sert à rien. */
          assistant: assistant.etat(),
        });
        return true;
      }

      /* ------------------------ unités ------------------------ */
      /**
       * ------------------- LA HIÉRARCHIE, CHIFFRÉE -------------------
       *
       * POURQUOI CETTE ROUTE EXISTE.
       *
       * Un administrateur devait ouvrir une région, revenir, ouvrir la
       * suivante, revenir — vingt-huit fois — pour se faire une idée de l'état
       * du pays. Rien ne lui donnait la vue d'ensemble : `/api/unites` liste
       * des noms, `/api/analyse/situation` agrège au niveau national, et entre
       * les deux, rien.
       *
       * Cette route rend l'ARBRE COMPLET avec, à chaque échelon, ce qu'il
       * porte : postes, effectif, postes tenus sur le créneau en cours. C'est
       * ce qui permet un écran « VOIR TOUT » où l'on descend région →
       * compagnie → brigade sans jamais recharger.
       *
       * ELLE OBÉIT AU MÊME CLOISONNEMENT QUE TOUT LE RESTE. L'arbre est
       * construit sur `visibles(session, …)` : un chef de région n'y trouve
       * que sa région, un chef de brigade que sa brigade. Ce n'est pas une
       * route d'administration à part — c'est la même règle, présentée
       * autrement. Un compte de brigade qui l'appelle ne gagne rien.
       *
       * LES CONTOURS PLUTÔT QUE LES SEULS BARRAGES. Les unités viennent de
       * `circonscriptions` (les 28 régions, 90 compagnies et 504 brigades
       * réelles), pas des barrages existants : une brigade sans aucun poste
       * doit apparaître, justement parce que c'est là qu'il y a quelque chose
       * à saisir. Bâtir l'arbre sur les barrages l'aurait rendue invisible.
       */
      if (chemin === '/api/hierarchie' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        const perimetre = perimetreDuRang(session);

        /**
         * L'ARBRE VISIBLE VA DANS LES DEUX SENS.
         *
         * Un chef de compagnie doit voir SA compagnie, SES brigades — et la
         * région qui les contient, sans quoi l'arbre n'a pas de racine et
         * l'écran reste vide. Filtrer chaque niveau indépendamment sur le seul
         * champ du périmètre ne pouvait pas marcher : une région est
         * `{nom, reg}`, elle n'a pas de champ `cie` ; aucune ne passait, et
         * tout tombait à zéro.
         *
         * On établit donc UNE FOIS l'ascendance du périmètre — sa région, sa
         * compagnie, sa brigade, selon son niveau — puis chaque contour est
         * retenu s'il est compatible avec elle. Un contour supérieur passe
         * parce qu'il contient le périmètre ; un contour inférieur parce qu'il
         * y est contenu.
         */
        const cadre = { reg: null, cie: null, bt: null };
        if (perimetre?.champ === 'reg') {
          cadre.reg = perimetre.unite;
        } else if (perimetre?.champ === 'cie') {
          cadre.cie = perimetre.unite;
          cadre.reg = circonscriptions.compagnie.get(perimetre.unite)?.reg ?? null;
        } else if (perimetre?.champ === 'bt') {
          const u = circonscriptions.bt.get(perimetre.unite);
          cadre.bt = perimetre.unite;
          cadre.cie = u?.cie ?? null;
          cadre.reg = u?.reg ?? null;
        }

        /** Le contour tombe-t-il dans le cadre ? Un cadre vide accepte tout. */
        const dansLePerimetre = (u, niveauDuContour) => {
          if (!perimetre) return true;
          if (niveauDuContour === 'region') return !cadre.reg || u.nom === cadre.reg;
          if (niveauDuContour === 'compagnie') {
            return (!cadre.reg || u.reg === cadre.reg) && (!cadre.cie || u.nom === cadre.cie);
          }
          return (
            (!cadre.reg || u.reg === cadre.reg) &&
            (!cadre.cie || u.cie === cadre.cie) &&
            (!cadre.bt || u.nom === cadre.bt)
          );
        };

        /* Les barrages que CETTE session a le droit de voir, indexés par unité. */
        const postes = visibles(session, depot.tous()).filter(estBarrage);
        const parBt = new Map();
        for (const m of postes) {
          if (!m.bt) continue;
          if (!parBt.has(m.bt)) parBt.set(m.bt, []);
          parBt.get(m.bt).push(m);
        }

        /**
         * L'EFFECTIF PAR BRIGADE — regroupé ici, et non par `parBrigade()`.
         *
         * `depotEffectifs.parBrigade()` rend un Map de COMPTES (`bt -> n`), pas
         * de listes. Il ne permet donc pas de savoir si l'effectif d'une
         * brigade est fictif, ce que cet écran doit signaler : une personne de
         * démonstration ne doit jamais passer pour réelle, même dans un
         * compteur.
         */
        const effectifParBt = new Map();
        for (const p of depotEffectifs.tous()) {
          if (!p.bt) continue;
          const e = effectifParBt.get(p.bt) ?? { n: 0, demo: false };
          e.n++;
          if (p.demo === true) e.demo = true;
          effectifParBt.set(p.bt, e);
        }

        /* Ce qui est tenu MAINTENANT : même créneau serveur que partout. */
        const date = dateLocale(new Date());
        const creneau = creneauDe(new Date());
        const tenus = new Set();
        for (const e of depotElements.duJour(date)) {
          if (e.creneau === creneau && e.barrageId) tenus.add(e.barrageId);
        }

        /**
         * Une brigade et ce qu'elle porte. `bt` est le contour, pas un
         * barrage : le nom, la compagnie et la région en viennent.
         */
        const brigade = (u) => {
          const liste = parBt.get(u.nom) ?? [];
          const gens = effectifParBt.get(u.nom) ?? { n: 0, demo: false };
          return {
            nom: u.nom,
            cie: u.cie ?? null,
            reg: u.reg ?? null,
            barrages: liste.length,
            bfi: liste.filter((m) => estIntouchable(m)).length,
            fixesNormaux: liste.filter((m) => m.type === 'barrage_fixe' && !estIntouchable(m)).length,
            fixes: liste.filter((m) => m.type === 'barrage_fixe' && !estIntouchable(m)).length,
            mobiles: liste.filter((m) => m.type === 'barrage_mobile').length,
            tenus: liste.filter((m) => tenus.has(m.id)).length,
            effectif: gens.n,
            /* Un effectif fictif ne doit JAMAIS passer pour réel, même dans un
               simple compteur : l'écran le signale à partir de ce drapeau. */
            effectifDemo: gens.demo,
          };
        };

        const brigades = [...circonscriptions.bt.values()]
          .filter((u) => dansLePerimetre(u, 'brigade'))
          .map(brigade);

        /** Somme d'un champ sur une liste d'échelons inférieurs. */
        const somme = (liste, champ) => liste.reduce((n, x) => n + (x[champ] ?? 0), 0);

        /* Compagnies : celles du périmètre, avec leurs brigades dedans. */
        const compagnies = [...circonscriptions.compagnie.values()]
          .filter((u) => dansLePerimetre(u, 'compagnie'))
          .map((c) => {
            const siennes = brigades.filter((b) => b.cie === c.nom);
            return {
              nom: c.nom,
              reg: c.reg ?? null,
              brigades: siennes,
              nbBrigades: siennes.length,
              barrages: somme(siennes, 'barrages'),
              bfi: somme(siennes, 'bfi'),
              fixesNormaux: somme(siennes, 'fixesNormaux'),
              fixes: somme(siennes, 'fixes'),
              mobiles: somme(siennes, 'mobiles'),
              tenus: somme(siennes, 'tenus'),
              effectif: somme(siennes, 'effectif'),
              effectifDemo: siennes.some((b) => b.effectifDemo),
            };
          });

        /* Régions : idem, un cran au-dessus. */
        const regions = [...circonscriptions.region.keys()]
          .filter((nom) => dansLePerimetre({ nom, reg: nom }, 'region'))
          .map((nom) => {
            const siennes = compagnies.filter((c) => c.reg === nom);
            /* Une brigade dont la compagnie manque au découpage ne doit pas
               disparaître du total de sa région. */
            const orphelines = brigades.filter(
              (b) => b.reg === nom && !siennes.some((c) => c.nom === b.cie),
            );
            return {
              nom,
              compagnies: siennes,
              nbCompagnies: siennes.length,
              nbBrigades: somme(siennes, 'nbBrigades') + orphelines.length,
              barrages: somme(siennes, 'barrages') + somme(orphelines, 'barrages'),
              bfi: somme(siennes, 'bfi') + somme(orphelines, 'bfi'),
              fixesNormaux: somme(siennes, 'fixesNormaux') + somme(orphelines, 'fixesNormaux'),
              fixes: somme(siennes, 'fixes') + somme(orphelines, 'fixes'),
              mobiles: somme(siennes, 'mobiles') + somme(orphelines, 'mobiles'),
              tenus: somme(siennes, 'tenus') + somme(orphelines, 'tenus'),
              effectif: somme(siennes, 'effectif') + somme(orphelines, 'effectif'),
              effectifDemo:
                siennes.some((c) => c.effectifDemo) || orphelines.some((b) => b.effectifDemo),
              orphelines,
            };
          })
          /* Une région vide de brigades n'apprend rien — sauf si c'est
             précisément le périmètre du compte, où son vide EST l'information. */
          .filter((r) => r.nbBrigades > 0 || r.barrages > 0 || r.nom === cadre.reg)
          .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

        json(res, 200, {
          date,
          creneau,
          /* Ce que la session PEUT voir, dit explicitement : l'écran s'en sert
             pour annoncer sa portée au lieu de la laisser deviner. */
          portee: perimetre
            ? { niveau: perimetre.niveau, unite: perimetre.unite }
            : { niveau: 'national', unite: null },
          total: {
            regions: regions.length,
            compagnies: somme(regions, 'nbCompagnies'),
            brigades: somme(regions, 'nbBrigades'),
            barrages: somme(regions, 'barrages'),
            bfi: somme(regions, 'bfi'),
            fixesNormaux: somme(regions, 'fixesNormaux'),
            fixes: somme(regions, 'fixes'),
            mobiles: somme(regions, 'mobiles'),
            tenus: somme(regions, 'tenus'),
            effectif: somme(regions, 'effectif'),
            effectifDemo: regions.some((r) => r.effectifDemo),
          },
          regions,
        });
        return true;
      }

      if (chemin === '/api/unites' && req.method === 'GET') {
        json(res, 200, unites(circonscriptions));
        return true;
      }

      /**
       * Distance réelle au plus proche voisin (même nature) — filtre
       * min/max du panneau Filtrer, sur le même périmètre visible que
       * `/api/marquages` (voir `visibles`) ; dégradé (toutes distances
       * `null`) si le réseau routier n'est pas chargé plutôt qu'une erreur.
       */
      if (chemin === '/api/distances-plus-proche' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const scope = url.searchParams.get('scope') === 'barrage' ? 'barrage' : 'accident';
        const maxKm = Number(url.searchParams.get('maxKm'));
        const bornage = Number.isFinite(maxKm) && maxKm > 0 ? maxKm : 100;

        const ensemble = visibles(session, depot.tous()).filter((m) =>
          scope === 'barrage' ? estBarrage(m) : m.type === 'accident',
        );

        const distances = graphe ? distancesPlusProche(ensemble, graphe, bornage) : new Map();
        json(res, 200, {
          reseauRoutier: !!graphe,
          items: ensemble.map((m) => {
            const d = distances.get(m.id);
            return {
              id: m.id,
              distanceProcheKm: d?.km ?? null,
              voisinProcheId: d?.voisinId ?? null,
            };
          }),
        });
        return true;
      }

      /* ----------------------- session ------------------------ */
      /**
       * PRÉFÉRENCES D'AFFICHAGE DU COMPTE — la palette (Midnight Command,
       * Graphite & Electric Blue, Arctic Professional, Forest Slate) et le mode
       * (clair, sombre, système). Portées par le compte lui-même, dans
       * `comptes.json` : retrouvées à chaque reconnexion, sur n'importe quel
       * poste, et jamais imposées à un autre compte. Une préférence n'ouvre
       * aucun droit : seule la session courante lit et écrit la sienne.
       */
      if (chemin === '/api/preferences') {
        if (!session) return refuseNonConnecte(json, res);
        const PALETTES_AUTORISEES = ['midnight', 'graphite', 'arctic', 'forest'];
        const MODES_AUTORISES = ['light', 'dark', 'systeme'];
        /* Animations : suivre le poste, toujours activées, ou réduites. Facultatif. */
        const MOUVEMENTS_AUTORISES = ['systeme', 'actives', 'reduites'];
        /* L'ancien format { theme } (trois thèmes) est converti à la volée. */
        const ANCIENS = { dark: ['midnight', 'dark'], light: ['arctic', 'light'], slate: ['graphite', 'dark'] };
        const etat = comptes();
        const compte = etat.comptes[normaliserMatricule(session.matricule)];
        if (req.method === 'GET') {
          json(res, 200, { preferences: compte?.preferences ?? {} });
          return true;
        }
        if (req.method === 'PUT' || req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const [palette, mode] = corps?.palette
            ? [String(corps.palette), String(corps.mode ?? 'systeme')]
            : ANCIENS[String(corps?.theme ?? '')] ?? [null, null];
          if (!PALETTES_AUTORISEES.includes(palette) || !MODES_AUTORISES.includes(mode)) {
            json(res, 422, { erreur: `Apparence inconnue. Palettes : ${PALETTES_AUTORISEES.join(', ')} ; modes : ${MODES_AUTORISES.join(', ')}.` });
            return true;
          }
          const mouvement = corps?.mouvement == null ? null : String(corps.mouvement);
          if (mouvement != null && !MOUVEMENTS_AUTORISES.includes(mouvement)) {
            json(res, 422, { erreur: `Réglage d’animation inconnu. Valeurs : ${MOUVEMENTS_AUTORISES.join(', ')}.` });
            return true;
          }
          if (!compte) {
            json(res, 404, { erreur: 'Compte introuvable.' });
            return true;
          }
          const { theme: _ancien, ...autres } = compte.preferences ?? {};
          compte.preferences = { ...autres, palette, mode, ...(mouvement ? { mouvement } : {}) };
          enregistrerComptes(fichierComptes, etat);
          json(res, 200, { preferences: compte.preferences });
          return true;
        }
        json(res, 405, { erreur: 'Méthode non admise.' });
        return true;
      }

      if (chemin === '/api/session') {
        if (req.method === 'GET') {
          /**
           * « QUI SUIS-JE ? » — « PERSONNE » EST UNE RÉPONSE, PAS UN REFUS.
           *
           * Cette route répondait 401 au visiteur anonyme. Or 401 signifie
           * « accès refusé », et rien n'est refusé ici : la question est
           * légitime, et la réponse est simplement « aucune session ». Le
           * navigateur consigne pourtant chaque 401 en rouge dans la console,
           * si bien que TOUTE ouverture de la carte s'accompagnait d'une erreur
           * apparente — du bruit qui masque les vraies pannes.
           *
           * Les routes qui protègent quelque chose, elles, continuent de
           * répondre 401 : c'est là que le refus a un sens.
           */
          /* Le rechargement d'une page doit retrouver l'état exact : une
             session ouverte avec un mot de passe temporaire reste devant
             l'écran de changement, même après F5. */
          json(res, 200, {
            session: session ? identite(session) : null,
            motDePasseAChanger: session?.doitChanger === true,
          });
          return true;
        }

        if (req.method === 'DELETE') {
          S.fermer(S.jetonDe(req));
          json(res, 200, { ferme: true }, { 'Set-Cookie': S.cookieEffacement() });
          return true;
        }

        if (req.method === 'POST') {
          const corps = await lireCorps(req, res);

          /**
           * Trois façons de désigner le compte, par ordre de précision :
           *
           *  1. `matricule` explicite — connexion personnelle, sans ambiguïté ;
           *  2. le couple {rang, unite} — ce que le formulaire d'unité envoie.
           *     C'est le couple, et NON le seul nom d'unité, qui identifie un
           *     compte : « Tanger » est à la fois une région, une compagnie et
           *     une brigade. Résoudre sur le nom seul ouvrait la session d'un
           *     autre rang que celui demandé ;
           *  3. `unite` seule — postes n'ayant pas rechargé la page, et comptes
           *     historiques dont le matricule VAUT le nom d'unité.
           */
          const parCouple = corps.matricule
            ? null
            : chercherParRangUnite(comptes(), corps.rang, corps.unite);
          const matricule = parCouple
            ? parCouple.matricule
            : normaliserMatricule(corps.matricule ?? corps.unite);
          const code = corps.code;

          if (!matricule || typeof code !== 'string') {
            json(res, 400, { erreur: 'Matricule et code sont requis.' });
            return true;
          }

          const restant = S.blocage(matricule);
          if (restant > 0) {
            json(
              res,
              429,
              {
                erreur: `Trop de tentatives : compte bloqué ${Math.ceil(restant / 60)} min.`,
                secondes: restant,
              },
              { 'Retry-After': String(restant) },
            );
            return true;
          }

          const identifie = await verifier(comptes(), matricule, code);

          if (!identifie) {
            const reste = S.echec(matricule);
            /**
             * Message unique pour « matricule inconnu » et « code faux » : il ne
             * doit pas permettre de deviner quels comptes existent.
             */
            journal.consigner({
              session: { matricule, nom: null },
              action: 'echec',
              details: { tentativesRestantes: reste },
            });
            json(res, 401, {
              erreur: 'Matricule ou code incorrect.',
              tentativesRestantes: reste,
            });
            return true;
          }

          S.reussite(matricule);
          journal.consigner({ session: identifie, action: 'connexion' });
          const jeton = S.ouvrir(identifie);
          /**
           * `doitChanger` est joint À CÔTÉ de l'identité, jamais dedans.
           *
           * `identite()` sert aussi d'AUTEUR sur chaque marquage posé : y
           * glisser un état de compte inscrirait « doitChanger: true » dans
           * les données du terrain, pour toujours, et sans aucun sens.
           */
          json(
            res,
            200,
            {
              session: identite(identifie),
              motDePasseAChanger: identifie.doitChanger === true,
            },
            { 'Set-Cookie': S.cookieSession(jeton) },
          );
          return true;
        }

        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      /**
       * ------------------- MOT DE PASSE (le sien) -------------------
       *
       * CHACUN CHANGE LE SIEN, ET SEULEMENT LE SIEN.
       *
       * Le matricule visé n'est PAS pris dans la requête : il vient de la
       * session. Sans quoi n'importe qui pourrait poster
       * `{matricule: 'SUPERADMIN', nouveau: '…'}` et s'emparer du compte
       * d'administration — c'est l'attaque la plus évidente sur ce genre de
       * route, et la seule protection qui tienne est de ne jamais lire la
       * cible ailleurs que dans la session.
       *
       * L'ANCIEN MOT DE PASSE EST EXIGÉ, sauf au premier accès. Un poste
       * laissé ouvert sans surveillance ne doit pas suffire à verrouiller le
       * compte de son titulaire. Au premier accès, en revanche, l'ancien est
       * le mot de passe temporaire, que la personne vient de taper : le
       * redemander serait une formalité, pas une sécurité.
       *
       * La confirmation est vérifiée ICI aussi, et pas seulement à l'écran :
       * une erreur de frappe recopiée deux fois par un script poserait un mot
       * de passe que personne ne connaît.
       */
      if (chemin === '/api/motdepasse') {
        if (req.method !== 'POST') {
          json(res, 405, { erreur: 'Méthode non autorisée.' });
          return true;
        }
        if (!session) return refuseNonConnecte(json, res);

        const corps = await lireCorps(req, res);
        const nouveau = typeof corps.nouveau === 'string' ? corps.nouveau : '';
        const confirmation = typeof corps.confirmation === 'string' ? corps.confirmation : '';
        const actuel = typeof corps.actuel === 'string' ? corps.actuel : '';

        if (nouveau !== confirmation) {
          json(res, 400, { erreur: 'Les deux saisies ne sont pas identiques.' });
          return true;
        }

        const refus = refusMotDePasse(nouveau);
        if (refus) {
          json(res, 400, { erreur: refus, minimum: MOTDEPASSE_MIN });
          return true;
        }

        /* Hors premier accès : prouver qu'on est bien devant son poste. */
        if (session.doitChanger !== true) {
          const preuve = await verifier(comptes(), session.matricule, actuel);
          if (!preuve) {
            json(res, 403, { erreur: 'Mot de passe actuel incorrect.' });
            return true;
          }
        }

        try {
          const etat = comptes();
          await changerMotDePasse(etat, session.matricule, nouveau);
          enregistrerComptes(fichierComptes, etat);
        } catch (err) {
          json(res, 400, { erreur: err.message ?? 'Changement impossible.' });
          return true;
        }

        /**
         * TOUTES LES SESSIONS DU COMPTE SONT FERMÉES, y compris celle-ci.
         *
         * Changer de mot de passe, c'est souvent qu'on soupçonne l'ancien
         * d'avoir fuité. Laisser vivre les sessions ouvertes avec ce
         * mot de passe-là viderait le geste de son sens : on se reconnecte,
         * une fois, avec le nouveau.
         */
        const fermees = S.fermerToutesDe(session.matricule);
        journal.consigner({
          session,
          action: 'motdepasse',
          details: { sessionsFermees: fermees },
        });

        json(
          res,
          200,
          { change: true, reconnexionRequise: true },
          { 'Set-Cookie': S.cookieEffacement() },
        );
        return true;
      }

      /* ----------------------- comptes (admin) ----------------- */
      if (chemin === '/api/comptes') {
        if (!session || session.rang !== 'admin') {
          json(res, 403, { erreur: 'Accès réservé aux administrateurs.' });
          return true;
        }

        const etat = comptes();

        if (req.method === 'GET') {
          json(res, 200, { comptes: listerComptes(etat) });
          return true;
        }

        if (req.method === 'POST') {
          const { rang, unite, code, reg, cie, matricule, nom, role } = await lireCorps(req, res);
          try {
            /* Le panneau d'administration n'envoie que rang/unite/code : le
               matricule est alors CALCULÉ à partir du rang (« CIE-TANGER »),
               jamais le seul nom d'unité — sans quoi la compagnie Tanger
               écraserait la région Tanger, qui porte le même nom (voir
               `matriculeDe` dans serveur/comptes.mjs). Le rôle par défaut est
               `commandement`, comme `--initialiser` en ligne de commande. */
            const matriculeEffectif = matricule ?? matriculeDe(rang, unite);
            const clair = await definirCompte(etat, {
              matricule: matriculeEffectif,
              nom,
              role: role ?? 'commandement',
              rang,
              unite,
              code,
              reg,
              cie,
            });
            enregistrerComptes(fichierComptes, etat);
            json(res, 201, {
              compte: {
                matricule: normaliserMatricule(matriculeEffectif),
                nom: nom ?? null,
                role: role ?? 'commandement',
                rang,
                unite,
                reg,
                cie,
                cree: new Date().toISOString(),
              },
              code: clair,
            });
          } catch (err) {
            json(res, 400, { erreur: err.message });
          }
          return true;
        }

        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      if (chemin.startsWith('/api/comptes/') && req.method === 'DELETE') {
        if (!session || session.rang !== 'admin') {
          json(res, 403, { erreur: 'Accès réservé aux administrateurs.' });
          return true;
        }

        const etat = comptes();
        const parties = chemin.split('/');
        let matricule = null;

        if (parties.length === 4) {
          // /api/comptes/:matricule
          matricule = normaliserMatricule(decodeURIComponent(parties[3]));
        } else if (parties.length === 5) {
          // /api/comptes/:rang/:unite — compatibilité avec le panneau d'administration.
          const rang = decodeURIComponent(parties[3]);
          const unite = decodeURIComponent(parties[4]);
          const trouve = Object.values(etat.comptes).find(
            (c) => c.rang === rang && c.unite === unite,
          );
          matricule = trouve?.matricule ?? null;
        } else {
          json(res, 400, {
            erreur: 'Format attendu : /api/comptes/:matricule ou /api/comptes/:rang/:unite',
          });
          return true;
        }

        const fait = matricule ? supprimerCompte(etat, matricule) : false;
        if (fait) {
          enregistrerComptes(fichierComptes, etat);
          json(res, 200, { ok: true });
        } else {
          json(res, 404, { erreur: 'Compte introuvable.' });
        }
        return true;
      }

      /* ---------------------- marquages ----------------------- */
      /**
       * LECTURE RÉSERVÉE AUX COMPTES IDENTIFIÉS.
       *
       * Cette route servait 1,2 Mo — la totalité du dispositif national — à
       * qui la demandait, sans identifiant. Voir la note de `visibles` : sur
       * des données réelles, ce n'est pas une commodité, c'est une fuite, et
       * elle rendait le cloisonnement contournable par simple déconnexion.
       */
      /**
       * LE DISPOSITIF EN SERVICE — la seule liste que rendent les écritures.
       *
       * Une réponse d'écriture qui contiendrait un poste retiré le ferait
       * reparaître sur la carte de celui qui vient de valider son retrait :
       * il aurait accepté la suppression et verrait le poste revenir. La
       * lecture et l'écriture doivent rendre le même ensemble — c'est ce que
       * vérifie la section « une écriture ne rend jamais plus qu'une lecture »
       * de scripts/verifier-securite.mjs, et c'est elle qui a attrapé l'écart.
       */
      const actifs = (session) =>
        visibles(session, depot.tous()).filter(
          (m) => m.statutBarrage !== 'supprime' && m.statutBarrage !== 'retire_optimisation',
        );

      /**
       * ---------------------- LES FACTIONS ----------------------
       *
       * Une seule route pour tout ce qui touche aux tours de service :
       *
       *   - la DÉFINITION des quatre factions (id, nom, bornes horaires), qui
       *     vient de `serveur/factions.mjs` et de nulle part ailleurs — le
       *     navigateur ne la recopie pas, il la lit ;
       *   - la FACTION EN COURS, calculée sur l'horloge LOCALE DU SERVEUR. Le
       *     navigateur ne doit surtout pas la déduire de la sienne : un poste
       *     de travail mal réglé afficherait un autre tour de service que celui
       *     où les hommes sont réellement postés ;
       *   - les AFFECTATIONS, c'est-à-dire, pour chaque barrage visible, les
       *     factions sur lesquelles il est tenu — déduites de sa fiche
       *     (`debut`/`fin`) ou, à défaut, des relèves du jour.
       *
       * LE PÉRIMÈTRE EST CELUI DE LA SESSION. `actifs(session)` applique déjà
       * le RBAC : un chef de brigade ne reçoit que ses postes, donc que ses
       * affectations. Le filtre par faction ne peut pas servir à voir ailleurs.
       */
      if (chemin === '/api/factions' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        const maintenant = new Date();
        /* `?date=` sert aux épreuves et à la consultation d'une journée passée ;
           par défaut, aujourd'hui — la carte montre le service du jour. */
        const demandee = url.searchParams.get('date');
        const jour = /^\d{4}-\d{2}-\d{2}$/.test(demandee ?? '')
          ? demandee
          : dateLocale(maintenant);

        const creneauxDuJour = depotElements.creneauxParBarrage(jour, jour);
        const postes = actifs(session).filter((m) => estBarrage(m));

        const assignations = {};
        let sansFaction = 0;
        const compteurs = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
        for (const m of postes) {
          const ids = factionsDuBarrage(m, creneauxDuJour.get(m.id) ?? null);
          assignations[m.id] = ids;
          if (!ids.length) sansFaction++;
          for (const id of ids) compteurs[id]++;
        }

        json(res, 200, {
          factions: FACTIONS,
          factionActuelle: factionDe(maintenant).id,
          /* L'heure du serveur, dite en clair : le navigateur peut ainsi
             expliquer POURQUOI telle faction est la courante, au lieu de
             l'affirmer. */
          heureServeur: `${String(maintenant.getHours()).padStart(2, '0')}:${String(
            maintenant.getMinutes(),
          ).padStart(2, '0')}`,
          date: jour,
          assignations,
          compteurs,
          sansFaction,
          total: postes.length,
        });
        return true;
      }

      if (chemin === '/api/marquages' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        /**
         * LE DISPOSITIF EN SERVICE, ET LUI SEUL — sauf demande expresse.
         *
         * Un poste retiré (`statutBarrage: 'supprime'`) reste dans le fichier
         * avec sa position et son histoire, mais il n'est plus opérationnel :
         * le rendre ici le ferait reparaître sur la carte, dans les distances,
         * dans les rosters et dans les statistiques, comme s'il tenait encore
         * le terrain.
         *
         * `?archives=1` le rend consultable — c'est par là que passe
         * l'historique « il y avait un poste ici ». Le filtre est posé au
         * SERVEUR : aucun écran n'a à connaître ce nouvel état pour rester
         * juste.
         */
        const archives = url.searchParams.get('archives') === '1';
        let items = archives ? visibles(session, depot.tous()) : actifs(session);

        /**
         * FILTRE PAR FACTION — AU SERVEUR, et pas seulement à l'écran.
         *
         * La carte filtre déjà son propre jeu de données (voir
         * `marquagesVisibles` dans src/GendarmerieMap.jsx) : c'est ce qui rend
         * les compteurs, le clustering et l'optimisation cohérents entre eux.
         * Mais un filtre qui n'existerait QUE là serait un filtre d'affichage :
         * n'importe quel appel direct à cette route rendrait tout le dispositif.
         *
         * D'où ce filtre-ci, qui vaut pour tout appelant — script, export,
         * intégration. Il s'ajoute au RBAC, il ne s'y substitue jamais : le
         * périmètre est appliqué d'abord (`actifs`/`visibles`), la faction
         * ensuite. Demander une faction ne peut donc pas élargir ce qu'on voit.
         *
         * SEULS LES BARRAGES SONT CONCERNÉS. Un point noir ou une congestion
         * n'est pas tenu par une faction ; les écarter parce qu'ils n'en ont
         * aucune viderait la carte de tout ce qui n'est pas un poste.
         */
        const factionDemandee = url.searchParams.get('faction');
        if (factionDemandee && factionDemandee !== 'toutes') {
          const faction =
            factionDemandee === 'actuelle' ? factionDe(new Date()) : factionParId(factionDemandee);
          if (!faction) {
            json(res, 400, {
              erreur: `Faction inconnue : ${factionDemandee}. Attendu ${FACTIONS.map((f) => f.id).join(', ')}, « actuelle » ou « toutes ».`,
            });
            return true;
          }
          const jourDemande = url.searchParams.get('date');
          const jour = /^\d{4}-\d{2}-\d{2}$/.test(jourDemande ?? '')
            ? jourDemande
            : dateLocale(new Date());
          const creneauxDuJour = depotElements.creneauxParBarrage(jour, jour);
          items = items.filter(
            (m) =>
              !estBarrage(m) ||
              factionsDuBarrage(m, creneauxDuJour.get(m.id) ?? null).includes(faction.id),
          );
        }

        json(res, 200, { items });
        return true;
      }

      if (chemin === '/api/marquages' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        const corps = await lireCorps(req, res);
        if (!TYPES.includes(corps.type)) {
          json(res, 400, { erreur: `Nature inconnue : ${corps.type}` });
          return true;
        }
        /* Le Super Admin assigne, il ne pose pas de barrage (la génération et
           l'import du dispositif restent ses outils d'administration). */
        if (superviseur(session) && ['barrage_fixe', 'barrage_mobile', 'barrage_vip'].includes(corps.type)) {
          json(res, 403, { erreur: REFUS_SUPERVISION });
          return true;
        }
        if (!peutPoserPointNoir(session, corps.type)) {
          json(res, 403, { erreur: REFUS_POINT_NOIR });
          return true;
        }

        const pt = coordonneesValides(corps);
        if (!pt) {
          json(res, 400, { erreur: REFUS_COORDONNEES });
          return true;
        }

        const verdict = controler(circonscriptions, session, pt);
        if (verdict !== 'autorise') {
          json(res, 403, { erreur: motifPerimetre(session, verdict) });
          return true;
        }

        const item = normaliser(
          // La diffusion hors région (`partage`) ne se décrète jamais à la
          // création : voir le PATCH plus bas, seul chemin autorisé.
          { ...corps, partage: false },
          {
            id: nouvelId(),
            ...rattacher(session, pt),
            auteur: identite(session),
          },
        );

        /* AVANT D'ÉCRIRE : un repère que le serveur n'a pu rattacher à aucune
           brigade serait ingérable — voir `rattachementManquant`. */
        if (rattachementManquant(item)) {
          json(res, 400, { erreur: REFUS_HORS_TERRITOIRE });
          return true;
        }

        if (estIntouchable(item)) {
          /* La règle « un seul par compagnie », écrite une fois pour la pose,
             la modification et l'acceptation d'une demande. */
          const deja = autreIntouchableDeLaCompagnie(depot.tous(), item.cie, item.id);
          if (deja) {
            json(res, 409, {
              erreur: `La compagnie ${item.cie} possède déjà son barrage fixe intouchable (${deja.nom || deja.id}). Un seul ancrage permanent par compagnie.`,
              existant: { id: deja.id, nom: deja.nom || '', lng: deja.lng, lat: deja.lat },
            });
            return true;
          }
        }

        depot.ajouter(item);
        journal.consigner({ session, action: 'creer', avant: null, apres: item });
        if (estBarrage(item)) {
          recalculerSiPresent(item.id);
          recalculerConflitsSiPresent();

          /**
           * UN BARRAGE POSÉ SUR LE TERRAIN PRÉVIENT LE COMMANDEMENT, TOUT DE
           * SUITE.
           *
           * Et non « à la prochaine optimisation » : un poste peut vivre des
           * semaines sans qu'aucun calcul soit lancé, et le commandant
           * l'apprendrait alors par hasard, en relisant une carte. La
           * notification part donc à la création, sur le même geste que
           * l'écriture.
           *
           * Rien n'est bloqué pour autant : le barrage est déjà enregistré et
           * déjà sur la carte. C'est un signalement, pas une demande
           * d'autorisation — la validation, elle, passe par `statutBarrage`.
           *
           * QUEL QUE SOIT L'AUTEUR, ADMINISTRATEUR COMPRIS.
           *
           * Ce signalement était sauté pour un administrateur, au motif qu'il
           * n'a personne au-dessus de lui à prévenir. Le raisonnement portait
           * sur la notification comme un message adressé ; or le marqueur
           * « nouvellement posé » de la carte (voir NouveauxBarragesLayer)
           * n'est pas un message : c'est un état du dispositif — un poste est
           * apparu et personne ne l'a encore regardé.
           *
           * Conséquence du saut : un barrage posé depuis un compte
           * administrateur s'enregistrait sans le moindre signe, et paraissait
           * accepté d'emblée. Son statut était pourtant bien `en_attente`.
           *
           * Sans risque d'inondation : ni la génération en lot
           * (/api/marquages/generer) ni l'import (/api/marquages/import) ne
           * passent par ici. Et l'auteur voit toujours la sienne — la lecture
           * retient une notification de son unité OU dont il est l'auteur.
           */
          /**
           * LA DÉCISION REVIENT À L'AUTRE CAMP.
           *
           *   posé par une UNITÉ  -> l'ADMINISTRATEUR approuve ou refuse ;
           *                          le poste reste `en_attente` d'ici là.
           *   posé par l'ADMIN    -> il n'y a personne au-dessus : le poste est
           *                          approuvé sur-le-champ, et l'unité concernée
           *                          en est informée. Elle accuse réception ;
           *                          elle n'a pas de veto sur une décision de
           *                          l'échelon supérieur.
           *
           * Le signalement part dans les deux sens — c'est celui qui n'a pas
           * posé le poste qui doit l'apprendre.
           */
          const parAdmin = session.rang === 'admin';

          if (parAdmin && item.statutBarrage === 'en_attente') {
            const approuve = { ...item, statutBarrage: 'approuve', majPar: identite(session) };
            depot.remplacer(item.id, approuve);
            item.statutBarrage = 'approuve';
          }

          depotInstructions.creer({
            barrageId: item.id,
            barrage: item,
            action: 'nouveau_barrage',
            source: 'saisie_terrain',
            /* Qui doit trancher : lu par le panneau pour n'offrir la décision
               qu'à celui qui l'a. */
            aDecider: parAdmin ? 'unite' : 'admin',
            texte: parAdmin
              ? `Nouveau ${item.type === 'barrage_mobile' ? 'barrage mobile' : 'barrage fixe'} posé par le commandement, déjà approuvé.`
              : `Nouveau ${item.type === 'barrage_mobile' ? 'barrage mobile' : 'barrage fixe'} posé sur le terrain — à approuver.`,
            auteur: identite(session),
          });
        }
        json(res, 201, { item });
        return true;
      }

      /* ---------------- gestion des barrages en lot ------------------ */
      /**
       * UNE SEULE REQUÊTE POUR TOUT UN LOT — et ce n'est pas un confort.
       *
       * Chaque écriture déclenche le recalcul complet des alertes de
       * rapprochement, mesuré à 2,5 s sur le parc actuel. Enchaîner cinquante
       * appels unitaires depuis le navigateur, c'est cinquante recalculs, soit
       * plus de deux minutes de serveur saturé pour une action que
       * l'utilisateur croit instantanée. Ici, tout le lot est appliqué, puis
       * les alertes sont recalculées UNE fois, à la fin.
       *
       * Réservé aux administrateurs : approuver ou annuler relève déjà de leur
       * seule autorité (voir PATCH /api/marquages/:id), et supprimer en nombre
       * mérite au moins autant de prudence.
       */
      if (chemin === '/api/barrages/lot' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const corps = await lireCorps(req, res);
        const action = String(corps.action ?? '');

        /**
         * DEUX FAMILLES, DEUX AUTORITÉS — et c'est ce qui manquait.
         *
         * Cette route servait à deux choses très différentes sous une seule
         * garde « administrateur » :
         *
         *   VALIDATION    approuver, à modifier, annuler, réactiver, créer —
         *                 le commandement central tranche sur le dispositif.
         *                 Réservé à `admin`, et cela ne change pas.
         *
         *   ARBITRAGE     conserver, proposer_suppression, reconsidérer — la
         *                 réponse d'un chef au rapprochement signalé sur SES
         *                 postes, après une optimisation.
         *
         * Le second était refusé aux chefs de région, de compagnie et de
         * brigade : ils lançaient l'optimisation, voyaient les propositions,
         * cliquaient « Conserver » ou « Retirer »… et recevaient
         * « Gestion en lot réservée aux administrateurs ». La fonction leur
         * était donc inutilisable, alors que l'arbitrage sur son propre
         * périmètre est précisément leur travail.
         *
         * L'autorité n'est pas pour autant élargie : elle passe du RANG au
         * PÉRIMÈTRE, ce qui est plus strict. Chaque identifiant est vérifié un
         * par un avec `peutModifier` (dans la boucle ci-dessous) — la même
         * règle que pour modifier ou retirer un repère. Un chef de région ne
         * peut arbitrer que des postes de sa région, et un compte en lecture
         * seule n'arbitre rien du tout.
         */
        const ARBITRAGES = new Set(['conserver', 'proposer_suppression', 'reconsiderer']);
        if (!ARBITRAGES.has(action) && session.rang !== 'admin') {
          json(res, 403, { erreur: 'Gestion en lot réservée aux administrateurs.' });
          return true;
        }
        if (ARBITRAGES.has(action) && !peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }
        /**
         * `conserver` / `reconsiderer` — l'arbitrage rendu depuis le panneau
         * Optimisation passe par CETTE route, et non par un mécanisme à part.
         * C'est déjà elle qui applique une décision de commandement à un lot de
         * barrages, avec la même garde d'autorité, le même journal et le même
         * recalcul en fin de course ; un second chemin n'aurait rien apporté
         * qu'un second endroit où se tromper.
         *
         * `conserver` NE TOUCHE PAS au barrage : ni sa position, ni son statut
         * de validation, ni aucun autre champ. Il pose seulement la marque
         * `decisionOptimisation`, qui dit que le rapprochement a été examiné et
         * le poste maintenu. `reconsiderer` retire cette marque.
         *
         * `proposer_suppression` non plus n'efface RIEN : il marque le poste
         * `a_supprimer` et notifie le commandant concerné. Le retrait réel
         * n'a lieu qu'à l'acceptation de celui-ci (voir PATCH
         * /api/instructions/:id), qui rappelle alors `supprimer`. Sans cet
         * état d'attente, il n'y aurait ni repère à montrer sur la carte, ni
         * décision à refuser.
         */
        const ACTIONS = new Set([
          'approuver',
          'a_modifier',
          'annuler',
          'reactiver',
          'creer',
          'conserver',
          'proposer_suppression',
          'reconsiderer',
        ]);
        if (!ACTIONS.has(action)) {
          json(res, 400, { erreur: `Action inconnue : ${action || '(vide)'}.` });
          return true;
        }

        /* --- Création d'un lot d'emplacements retenus par l'administrateur --- */
        if (action === 'creer') {
          const points = Array.isArray(corps.points) ? corps.points.slice(0, 200) : [];
          if (!points.length) {
            json(res, 400, { erreur: 'Aucun emplacement à créer.' });
            return true;
          }
          const crees = [];
          const refuses = [];
          for (const p of points) {
            const pt = [Number(p.lng), Number(p.lat)];
            if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
              refuses.push({ raison: 'coordonnées invalides' });
              continue;
            }
            /* Même contrôle de périmètre qu'à la création unitaire : un lot
               n'ouvre aucun droit que le geste unitaire n'accorderait pas. */
            const verdict = controler(circonscriptions, session, pt);
            if (verdict !== 'autorise') {
              refuses.push({ lng: pt[0], lat: pt[1], raison: motifPerimetre(session, verdict) });
              continue;
            }
            const item = normaliser(
              {
                type: p.type === 'barrage_mobile' ? 'barrage_mobile' : 'barrage_fixe',
                lng: pt[0],
                lat: pt[1],
                nom: p.nom ?? '',
                route: p.route ?? '',
                note: 'barrage-semi-auto',
                partage: false,
              },
              { id: nouvelId(), ...rattacher(session, pt), auteur: identite(session) },
            );
            depot.ajouter(item);
            journal.consigner({ session, action: 'creer', avant: null, apres: item });
            crees.push(item);
          }
          if (crees.length) recalculerSiPresent();
          /* Même règle : filtré au périmètre — voir la note du
             PATCH /api/instructions/:id. */
          json(res, 201, {
            crees,
            refuses,
            total: crees.length,
            items: actifs(session),
          });
          return true;
        }

        /* --- Actions sur des barrages existants --- */
        const ids = Array.isArray(corps.ids) ? corps.ids.slice(0, 2000) : [];
        if (!ids.length) {
          json(res, 400, { erreur: 'Aucun barrage sélectionné.' });
          return true;
        }

        const STATUT = {
          approuver: 'approuve',
          a_modifier: 'a_modifier',
          annuler: 'annule',
          reactiver: 'en_attente',
        };

        /**
         * L'état du calcul au moment où la décision est prise — distance
         * mesurée, voisin retenu, et les paramètres qui étaient activés.
         *
         * Il vient du panneau plutôt que d'un recalcul ici, et c'est voulu :
         * refaire la mesure donnerait d'autres chiffres (le parc a pu bouger
         * entre-temps), et la notification ne raconterait plus la décision
         * réellement prise. On borne ce qu'on accepte — rien de ce qui vient
         * du client n'entre tel quel dans un dépôt.
         */
        const c = corps.criteres ?? null;
        const criteresDecision =
          c && typeof c === 'object'
            ? {
                distanceKm: Number.isFinite(Number(c.distanceKm)) ? Number(c.distanceKm) : null,
                seuilKm: Number.isFinite(Number(c.seuilKm)) ? Number(c.seuilKm) : null,
                voisinNom: typeof c.voisinNom === 'string' ? c.voisinNom.slice(0, 120) : '',
                accidents: Number.isFinite(Number(c.accidents)) ? Number(c.accidents) : null,
                vip: typeof c.vip === 'boolean' ? c.vip : null,
                nonEclaire: typeof c.nonEclaire === 'boolean' ? c.nonEclaire : null,
              }
            : null;

        let traites = 0;
        const ignores = [];
        for (const id of ids) {
          const existant = depot.parId(id);
          if (!existant) {
            ignores.push({ id, raison: 'introuvable' });
            continue;
          }
          if (existant.type !== 'barrage_fixe' && existant.type !== 'barrage_mobile') {
            ignores.push({ id, raison: 'ce repère n’est pas un barrage' });
            continue;
          }
          /**
           * L'AUTORITÉ SE VÉRIFIE POSTE PAR POSTE, et non au rang.
           *
           * Voir la note de la garde d'entrée : un arbitrage rendu par un chef
           * ne vaut que sur SON périmètre. Le poste étranger est ignoré avec
           * son motif — jamais écarté en silence, sans quoi l'écran annoncerait
           * « traité » un poste auquel on n'a pas touché.
           *
           * `admin` passe ici comme ailleurs : `peutModifier` le lui accorde.
           */
          if (ARBITRAGES.has(action) && superviseur(session)) {
            ignores.push({ id, raison: REFUS_SUPERVISION });
            continue;
          }
          if (ARBITRAGES.has(action) && !peutModifier(session, existant)) {
            ignores.push({ id, raison: motifRefus(session, existant) });
            continue;
          }
          /**
           * DEUX FAMILLES D'ACTIONS, à ne jamais confondre.
           *
           * Les unes changent le STATUT DE VALIDATION du barrage (approuvé,
           * à modifier, annulé, remis en attente). Les autres ne font
           * qu'enregistrer l'ARBITRAGE rendu sur un signalement de
           * rapprochement, et laissent le barrage exactement tel qu'il est.
           *
           * D'où le report explicite de `statutBarrage` depuis l'existant sur
           * `conserver` / `reconsiderer` : sans lui, `STATUT[action]` vaudrait
           * `undefined` et l'énumération retomberait sur sa valeur neutre —
           * « conserver » remettrait donc silencieusement un barrage approuvé
           * en attente de validation. Conserver ne doit RIEN modifier.
           */
          if (action in DECISION_ARBITRAGE) {
            /* Voir `arbitrerBarrage` : même écriture, même notification. */
            arbitrerBarrage(session, existant, action, criteresDecision);
          } else {
            const item = normaliser(
              { ...existant, statutBarrage: STATUT[action] },
              { id: existant.id, bt: existant.bt, cie: existant.cie, reg: existant.reg, auteur: existant.auteur, cree: existant.cree },
            );
            item.majPar = identite(session);
            depot.remplacer(id, item);
            journal.consigner({ session, action: 'modifier', avant: existant, apres: item });
          }
          traites++;
        }

        /* Un arbitrage ne déplace ni ne retire aucun poste : la géométrie du
           dispositif est inchangée, donc les alertes de rapprochement aussi.
           Les recalculer coûterait les 2,5 s habituelles pour aboutir au même
           fichier — et « Conserver » doit répondre du tac au tac. */
        const arbitrageSeul =
          action === 'conserver' || action === 'proposer_suppression' || action === 'reconsiderer';
        if (traites && !arbitrageSeul) recalculerSiPresent();
        /* Filtré au périmètre de l'appelant, comme toute lecture — voir la
           note du PATCH /api/instructions/:id. Une réponse d'écriture qui
           rend plus que ce que l'appelant peut voir divulgue le dispositif
           d'autrui ET fausse ce que la carte affiche. */
        json(res, 200, { traites, ignores, items: actifs(session) });
        return true;
      }

      /**
       * Emplacements PROPOSÉS — lecture seule, aucune écriture.
       *
       * Renvoie les points du réseau structurant situés à plus de
       * `espacementKm` de tout barrage existant : les trous de couverture.
       * L'administrateur coche ceux qu'il retient, et la création passe par
       * `POST /api/barrages/lot` avec `action: "creer"`.
       */
      if (chemin === '/api/barrages/proposer' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Proposition réservée aux administrateurs.' });
          return true;
        }
        if (!graphe) {
          json(res, 409, {
            erreur: 'Réseau routier indisponible : lancez « npm run build:roads ».',
          });
          return true;
        }

        const corps = await lireCorps(req, res);
        const espacementKm = Number(corps.espacementKm);
        if (!Number.isFinite(espacementKm) || espacementKm <= 0) {
          json(res, 400, {
            erreur: 'Espacement invalide : indiquez un nombre de km supérieur à 0.',
          });
          return true;
        }

        /* MÊME RÈGLE QUE LA CONSOLIDATION : le périmètre se déduit du rang dès
           que le rang en porte un. La route est réservée à l'administrateur
           (voir plus haut), donc `impose` y vaut toujours `null` aujourd'hui —
           mais la règle est écrite une seule fois, et le jour où la proposition
           s'ouvrira aux commandants, elle s'appliquera d'elle-même. */
        const impose = perimetreDuRang(session);
        const niveau = impose ? impose.niveau : (corps.niveau ?? 'national');
        const unite = impose ? impose.unite : (corps.unite ?? null);
        const champ = impose
          ? impose.champ
          : ({ region: 'reg', compagnie: 'cie', brigade: 'bt' }[niveau] ?? null);

        const barrages = depot
          .tous()
          .filter((m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile')
          .filter((m) => (m.statutBarrage ?? 'en_attente') !== 'annule');

        /* Les trous se cherchent DANS le périmètre demandé, mais en tenant
           compte de TOUS les barrages : un poste voisin, même d'une autre
           unité, couvre le terrain aussi bien. Ignorer cela proposerait des
           emplacements à quelques kilomètres d'un barrage existant. */
        const propositions = trouverTrousCouverture(barrages, graphe, {
          espacementKm,
          limite: Number(corps.limite) || 60,
          /* Le périmètre est passé au calcul, pas appliqué à son résultat :
             voir le commentaire dans `trouverTrousCouverture`. */
          garder:
            champ && unite
              ? (c) => localiser(circonscriptions, [c.lng, c.lat])?.[champ] === unite
              : null,
        });

        json(res, 200, {
          propositions,
          parametres: { espacementKm, niveau, unite },
          barragesConsideres: barrages.length,
        });
        return true;
      }

      /* ------------------------- optimisation --------------------------- */
      /**
       * OPTIMISATION — UNE SEULE QUESTION.
       *
       *     « Quels barrages sont à moins de X km de leur voisin ? »
       *
       * Rien d'autre. Le seul jugement porté est `distance < seuil`.
       *
       * CE QUI A ÉTÉ RETIRÉ, ET POURQUOI
       * --------------------------------
       * Cette route portait successivement : un arbitrage entre voisins pesé
       * par les motifs d'implantation, des barrages « obligatoires » mis hors
       * d'atteinte, quatre critères concurrents, un redéploiement automatique
       * vers les trous de couverture, et une réaffectation des postes annulés.
       * Chaque couche répondait à une intention défendable, mais leur somme
       * rendait le résultat impossible à prévoir : un poste à deux kilomètres
       * de son voisin pouvait n'apparaître nulle part, et personne ne savait
       * plus dire pourquoi.
       *
       * LE PÉRIMÈTRE : LES BARRAGES FIXES, ET EUX SEULS.
       *
       * Un barrage mobile est temporaire par nature — il n'est pas « trop
       * près » de quoi que ce soit, il est là aujourd'hui et ailleurs demain.
       * L'optimisation raisonne sur le maillage permanent ; les mobiles en
       * sont donc écartés. Ils restent intacts partout ailleurs : en base, sur
       * la carte générale, dans la saisie et dans l'analyse.
       *
       * Conséquence assumée : LE VOISIN AUSSI se cherche parmi les fixes. Un
       * poste dont le plus proche voisin serait un mobile verrait sinon
       * s'afficher une distance qu'aucune décision ne peut traiter.
       *
       * Aucun autre filtre en amont : ni statut, ni motif. Les trois
       * paramètres `accidents` / `vip` / `nonEclaire` ci-dessous n'en sont pas
       * — voir leur commentaire.
       *
       * CE QUI EST MESURÉ ET CE QUI EST PROPOSÉ SONT DEUX CHOSES.
       *
       * La mesure ne dépend de rien d'autre que de la géométrie : tout barrage
       * fixe du périmètre est mesuré contre tous les autres, et `sousLeSeuil`
       * ne connaît que la distance. La PROPOSITION, elle, épargne les postes
       * intouchables — portes de ville (entrée comme sortie) toujours, accidents,
       * VIP et non-éclairé si leur interrupteur est allumé. Un poste protégé
       * garde donc sa distance affichée, et continue de servir de voisin aux
       * autres : le retirer du calcul aurait faussé les leurs.
       *
       * Rien n'est jamais écrit : la route ne fait que mesurer. Le retrait
       * éventuel se décide repère par repère, sur la carte.
       */
      if (chemin === '/api/barrages/consolidation' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!graphe) {
          json(res, 409, {
            erreur: 'Réseau routier indisponible : lancez « npm run build:roads ».',
          });
          return true;
        }

        const corps = await lireCorps(req, res);
        const distanceMinKm = Number(corps.distanceMinKm);
        if (!Number.isFinite(distanceMinKm) || distanceMinKm <= 0) {
          json(res, 400, {
            erreur: 'Distance minimale invalide : indiquez un nombre de km supérieur à 0.',
          });
          return true;
        }

        /**
         * LE PÉRIMÈTRE NE VIENT PLUS DE LA REQUÊTE POUR UN PROFIL HIÉRARCHIQUE.
         *
         * Avant, le client envoyait `niveau` et `unite`, et le serveur les
         * croyait. Deux défauts, pas un :
         *
         *   1. un chef de compagnie devait DÉSIGNER sa propre compagnie, alors
         *      que son compte la nomme déjà ;
         *   2. rien ne l'empêchait d'en désigner une autre — ou de ne rien
         *      désigner du tout et d'obtenir le pays entier.
         *
         * Le périmètre se DÉDUIT donc du rang (`perimetreDuRang`), et les
         * champs du corps sont IGNORÉS dès qu'il est déduit. Ce n'est pas un
         * masquage d'interface : la logique de calcul ne les lit plus.
         *
         * `admin` reste le seul à choisir, parce qu'il est le seul sans
         * périmètre propre.
         */
        const impose = perimetreDuRang(session);

        if (impose && !impose.unite) {
          json(res, 409, {
            erreur:
              `Votre compte est rattaché au niveau « ${impose.niveau} » sans unité nommée : ` +
              "le périmètre d'optimisation ne peut pas être déterminé.",
          });
          return true;
        }

        /**
         * LE CORPS PEUT RESSERRER, JAMAIS ÉLARGIR.
         *
         * Le périmètre demandé était ignoré dès que le rang en imposait un :
         * un chef de région obtenait toujours sa région entière, même après
         * être descendu dans UNE de ses compagnies. Il lisait alors, sur un
         * écran centré sur cette compagnie, un calcul portant sur les dix
         * autres.
         *
         * On accepte donc le périmètre du corps s'il est STRICTEMENT CONTENU
         * dans celui du rang — une compagnie de sa région, une brigade de sa
         * compagnie. Tout le reste (un niveau plus large, une autre unité, un
         * champ absent) retombe sur le périmètre du rang, exactement comme
         * avant. L'appartenance est vérifiée sur les CONTOURS, pas sur le mot
         * envoyé : dire « compagnie X » ne suffit pas, il faut que X relève
         * réellement de sa région.
         */
        const RANG_NIVEAU = { region: 0, compagnie: 1, brigade: 2 };
        const demande = {
          niveau: typeof corps.niveau === 'string' ? corps.niveau : null,
          unite: typeof corps.unite === 'string' ? corps.unite.trim() : '',
        };

        /** La demande relève-t-elle bien du périmètre du rang ? */
        const contenueDansLeRang = () => {
          if (!impose || !demande.niveau || !demande.unite) return false;
          if (RANG_NIVEAU[demande.niveau] <= RANG_NIVEAU[impose.niveau]) return false;
          const u =
            demande.niveau === 'compagnie'
              ? circonscriptions.compagnie.get(demande.unite)
              : circonscriptions.bt.get(demande.unite);
          if (!u) return false;
          return u[impose.champ] === impose.unite;
        };

        const resserre = contenueDansLeRang();
        const niveauEffectif = resserre ? demande.niveau : impose ? impose.niveau : corps.niveau;
        const champ = resserre
          ? CHAMP_DU_NIVEAU[demande.niveau]
          : impose
            ? impose.champ
            : (CHAMP_DU_NIVEAU[niveauEffectif] ?? null);
        const unite = resserre ? demande.unite : impose ? impose.unite : demande.unite;
        const perimetre = Boolean(champ && unite);

        /**
         * LES TROIS PARAMÈTRES DE L'ÉTAPE 3 — INDÉPENDANTS, ET DE DEUX NATURES.
         *
         * `accidents` joint au résultat le nombre d'accidents relevés sur
         * chaque poste, ET exclut ceux qui atteignent le seuil demandé (voir
         * `seuilAccidents`) : un point où l'on se tue ne se retire pas parce
         * qu'un voisin est proche.
         *
         * `vip` et `nonEclaire` PROTÈGENT : allumés, les postes qui portent
         * effectivement ces caractères deviennent INTOUCHABLES — jamais
         * proposés au retrait (voir `intouchable` plus bas).
         *
         * Aucun des trois ne touche à la MESURE : le voisin le plus proche et
         * la distance qui l'en sépare sont calculés sur le même ensemble, quels
         * que soient les interrupteurs. Un poste protégé reste donc sous le
         * seuil, et reste un voisin possible pour les autres — sans quoi les
         * distances des postes alentour deviendraient fausses.
         */
        const avecAccidents = corps.accidents === true;
        const avecVip = corps.vip === true;
        const avecNonEclaire = corps.nonEclaire === true;

        /**
         * ACCIDENTS : LE NOMBRE À PARTIR DUQUEL LE POSTE EST EXCLU.
         *
         * Un barrage qui relève plusieurs accidents n'est pas un poste comme un
         * autre : il tient un endroit où l'on se tue. Le proposer au retrait
         * parce qu'un voisin est proche prendrait le problème à l'envers.
         *
         * 4 par défaut, réglable de 0 à 50. Le seuil est INCLUSIF : à 4, un
         * poste de 4 accidents est déjà exclu. C'est le sens naturel du chiffre
         * qu'on tape dans un champ intitulé « nombre d'accidents » — on désigne
         * le nombre qui déclenche, pas celui qui précède le déclenchement.
         *
         * À 0, tout poste est donc exclu (aucun n'a moins de zéro accident) et
         * l'optimisation n'a plus rien à proposer. Ce n'est pas un cas
         * particulier traité à part : c'est la règle appliquée telle quelle, et
         * le panneau prévient à l'écran quand le réglage est là.
         *
         * N'a d'effet que si l'interrupteur « Accidents » est allumé : éteint,
         * aucune information accident n'est demandée, donc aucune ne décide.
         */
        const SEUIL_ACCIDENTS_DEFAUT = 4;
        const seuilAccidents = Number.isFinite(Number(corps.seuilAccidents))
          ? Math.min(50, Math.max(0, Math.trunc(Number(corps.seuilAccidents))))
          : SEUIL_ACCIDENTS_DEFAUT;

        /**
         * LES PORTES DE VILLE SONT INTOUCHABLES, SANS INTERRUPTEUR.
         *
         * Ce n'est pas un réglage mais une propriété du terrain : un poste qui
         * tient l'accès à une agglomération n'est pas un maillon de maillage
         * qu'on desserre, c'est un point de passage obligé. Le proposer au
         * retrait parce qu'un autre barrage se trouve à 3 km n'a aucun sens.
         *
         * ENTRÉE ET SORTIE SONT TOUTES DEUX PROTÉGÉES. La sortie ne l'était pas :
         * elle ne « commande pas l'accès », disait le commentaire d'origine.
         * C'était une distinction sans objet — on contrôle ce qui quitte une
         * agglomération comme ce qui y entre, et un poste de sortie retiré laisse
         * le même trou dans le dispositif. Le commandement a tranché en ce sens.
         *
         * `porte` relève des deux listes : une porte de ville tient l'entrée ET
         * la sortie, c'est le même poste sur la même chaussée (voir
         * POSITIONS_VILLE dans serveur/depot.mjs). Elle porte donc les deux
         * motifs, et sa bulle les nomme tous les deux.
         */
        const ENTREES_DE_VILLE = ['entree', 'porte'];
        const SORTIES_DE_VILLE = ['sortie', 'porte'];

        /**
         * BARRAGES SPÉCIAUX — « toutes » | « entree » | « sortie ».
         *
         * `positionVille` existe déjà sur chaque marquage (voir POSITIONS_VILLE
         * dans serveur/depot.mjs) ; rien de nouveau n'est calculé.
         *
         * CE FILTRE PORTE SUR CE QUI EST RAPPORTÉ, PAS SUR CE QUI EST MESURÉ.
         *
         * C'est délibéré, et c'est la seule façon de rester juste. Un poste
         * d'entrée de ville à 1 km d'un barrage ordinaire EST trop proche ; si
         * l'ordinaire était retiré du calcul, la mesure remonterait au voisin
         * suivant et déclarerait le poste conforme. On mesure donc toujours
         * contre TOUS les fixes du périmètre — puis on n'affiche que ceux
         * demandés. La distance reste vraie, la liste reste filtrée.
         */
        /**
         * UNE PORTE DE VILLE RÉPOND AUX DEUX FILTRES.
         *
         * `porte` veut dire « ce poste tient l'entrée ET la sortie » : le
         * demander sous « Entrée de ville » doit donc le rendre, et sous
         * « Sortie de ville » aussi. C'est le même agent sur la même chaussée
         * qui contrôle ce qui arrive et ce qui part.
         */
        const ACCEPTES = { entree: ['entree', 'porte'], sortie: ['sortie', 'porte'] };
        const position = ACCEPTES[corps.positionVille] ? corps.positionVille : null;

        /* LES BARRAGES FIXES DU PÉRIMÈTRE — voir l'en-tête : les mobiles sont
           hors sujet pour un maillage permanent. C'est sur cet ensemble entier
           que le voisinage se cherche, filtre spécial ou non.

           D'UNE SEULE FACTION, plus les Intouchables (permanents, en service
           dans chacune). Deux postes de factions différentes ne sont jamais
           tenus en même temps : les confronter faisait apparaître, dans le
           résultat d'une faction, des conflits — et des barrages — d'une autre.
           C'était la source des barrages « en trop » : le périmètre s'élargissait
           sans le dire à tout ce qu'une autre faction avait de proche. La
           faction vient du filtre de la carte, comme pour le mode automatique ;
           à défaut, c'est la faction en cours selon l'horloge du serveur. */
        const maintenantManuel = new Date();
        const toutesFactions = !corps.factionId || corps.factionId === 'toutes' || corps.factionId === 'all';
        const factionManuelle = toutesFactions
          ? { id: 'toutes', nom: 'Toutes les factions', libelle: 'Toutes les factions' }
          : (factionParId(corps.factionId) ?? factionDe(maintenantManuel));
        const jourManuel = dateLocale(maintenantManuel);
        const { autorises: autorisesManuel, barrages: barragesInitiaux } = ensembleManuel(
          session,
          toutesFactions ? 'toutes' : factionManuelle.id,
          jourManuel
        );

        /**
         * LES DÉCISIONS SIMULÉES — CONSERVER, DÉPLACER, SUPPRIMER.
         *
         * Rien n'est écrit ici : les décisions reçues sont appliquées, dans
         * l'ordre, à une COPIE de l'ensemble mesuré, et la mesure ci-dessous
         * porte alors sur l'état simulé. Chaque décision est revérifiée côté
         * serveur (zone, droits, Intouchable) ; celles qui ne tiennent pas sont
         * rendues « refusées » avec leur motif, jamais appliquées en douce.
         *
         *   conserver  aucun changement géométrique : le conflit, s'il existe,
         *              reste mesuré et rapporté tel quel ;
         *   déplacer   `proposerDeplacement`, la même recherche que la cascade
         *              automatique, au seuil manuel ;
         *   supprimer  le poste sort de l'état simulé — ses conflits disparaissent
         *              de la mesure, sans que rien ne soit effacé au dépôt.
         */
        const decisionsDemandees = Array.isArray(corps.decisions) ? corps.decisions.slice(0, 200) : [];
        const zoneDecisions = perimetre ? zoneOptimisation(session, niveauEffectif, unite).zone ?? null : null;
        const decisionsSimulees = [];
        let barrages = barragesInitiaux;
        let mesureAvant = null;
        if (decisionsDemandees.length) {
          mesureAvant = distancesPlusProche(barragesInitiaux, graphe, Math.max(distanceMinKm * 4, 60));
          let etat = barragesInitiaux.map((b) => ({ ...b }));
          const vues = new Set();
          const dansZoneDecisions = zoneDecisions ? (pt) => positionAutorisee(session, zoneDecisions, pt) : null;
          for (const d of decisionsDemandees) {
            const id = String(d?.barrageId ?? '');
            const type = String(d?.type ?? '');
            if (!['conserver', 'deplacer', 'supprimer'].includes(type) || !id || vues.has(id)) continue;
            vues.add(id);
            const b = etat.find((x) => x.id === id);
            const existant = depot.parId(id);
            const sortie = {
              barrageId: id, type, nom: b?.nom || existant?.nom || id, statut: 'simule', raison: null,
              intouchable: estIntouchable(existant),
              distanceAvantKm: mesureAvant.get(id)?.km != null ? Math.round(mesureAvant.get(id).km * 100) / 100 : null,
              voisinAvant: mesureAvant.get(id)?.voisinId ?? null,
            };
            const refuser = (raison) => { sortie.statut = 'refuse'; sortie.raison = raison; decisionsSimulees.push(sortie); };
            if (!b || !existant) { refuser('barrage absent de l’ensemble analysé'); continue; }
            if (perimetre && b[champ] !== unite) { refuser('hors de la zone analysée'); continue; }
            if (estIntouchable(existant) && type !== 'conserver') { refuser('Intouchable : seul « Conserver » est possible'); continue; }
            /* Une porte de ville est toujours protégée en optimisation manuelle. */
            if (['entree', 'sortie', 'porte'].includes(existant.positionVille) && type !== 'conserver') {
              refuser('porte de ville protégée : seul « Conserver » est possible');
              continue;
            }
            if (!estIntouchable(existant) && !peutModifier(session, existant)) { refuser(motifRefus(session, existant)); continue; }
            if (type === 'supprimer') etat = etat.filter((x) => x.id !== id);
            if (type === 'deplacer' && d?.position) {
              /**
               * LA POSITION CHOISIE PAR L'OPÉRATEUR — un clic sur la carte.
               *
               * Le serveur la recale sur la route la plus proche, vérifie le
               * territoire (zone analysée, sinon espace adjacent autorisé), trace
               * le déplacement par la route et mesure la règle d'activation : à
               * SEUIL_DISTANCE_AUTO_KM par la route de tout poste. Une position qui
               * ne la tient pas reste simulée — l'opérateur la voit et la change ;
               * l'activation, elle, la refusera.
               */
              const coords = coordonneesValides({ lng: d.position.lng, lat: d.position.lat });
              if (!coords) { refuser('position choisie invalide'); continue; }
              const rec = recalerPosition(graphe, coords[0], coords[1], { rayonKm: 2 });
              if (rec.erreur) { refuser('aucune route du réseau à moins de 2 km du point choisi'); continue; }
              const pt = [rec.lng, rec.lat];
              const espace = !zoneDecisions
                ? (positionAutorisee(session, null, pt) ? 'zone' : null)
                : positionAutorisee(session, zoneDecisions, pt) ? 'zone'
                  : dansEspaceAdjacent(session, zoneDecisions, pt) ? 'adjacent' : null;
              if (!espace) { refuser('position hors de la zone analysée et de son espace adjacent autorisé'); continue; }
              sortie.avant = { lng: b.lng, lat: b.lat, route: b.route || '', pk: b.pk ?? null };
              sortie.apres = { lng: rec.lng, lat: rec.lat, route: rec.route || '', pk: rec.pk ?? null };
              sortie.choixOperateur = true;
              sortie.recalageM = Math.round(distanceKm(coords[0], coords[1], rec.lng, rec.lat) * 1000);
              sortie.espace = espace;
              sortie.espaceAdjacent = espace === 'adjacent'
                ? { libelle: libelleEspaceAdjacent(zoneDecisions, pt), autorisation: 'autorisee', zone: libelleZone(zoneDecisions) }
                : null;
              sortie.routeDeplacement = tracerEntrePostes(graphe, b, sortie.apres, accrocher(graphe, b.lng, b.lat, 5), accrocher(graphe, rec.lng, rec.lat, 5));
              let gene = null;
              for (const v of etat) {
                if (v.id === id || distanceKm(rec.lng, rec.lat, v.lng, v.lat) >= SEUIL_DISTANCE_AUTO_KM) continue;
                const km = distanceReelleKm(graphe, pt, [v.lng, v.lat]);
                if (km != null && km < SEUIL_DISTANCE_AUTO_KM && (!gene || km < gene.km)) gene = { id: v.id, nom: v.nom || v.id, km: Math.round(km * 100) / 100 };
              }
              sortie.activable = !gene;
              sortie.conflitActivation = gene;
              etat = etat.map((x) => (x.id === id ? { ...x, lng: sortie.apres.lng, lat: sortie.apres.lat, route: sortie.apres.route, pk: sortie.apres.pk } : x));
            } else if (type === 'deplacer') {
              /* DÉPLACER suit la règle de l'automatique : la nouvelle position
                 doit être à SEUIL_DISTANCE_AUTO_KM par la route de tout poste.
                 (Recherche automatique — conservée pour l'API ; l'écran demande
                 désormais toujours une position choisie sur la carte.) */
              const r = proposerDeplacement(etat, graphe, id, {
                seuilKm: SEUIL_DISTANCE_AUTO_KM,
                garderPosition: (_b, pt) => positionAutorisee(session, zoneDecisions, pt),
                dansZone: dansZoneDecisions,
                espaceAdjacent: espaceAdjacentPour(session, zoneDecisions, []),
              });
              if (!r) { refuser(`aucune position routière valide à ${SEUIL_DISTANCE_AUTO_KM} km de tous les postes, dans la zone ni dans son espace adjacent`); continue; }
              sortie.avant = { lng: b.lng, lat: b.lat, route: b.route || '', pk: b.pk ?? null };
              sortie.apres = { lng: r.position.lng, lat: r.position.lat, route: r.position.route || b.route || '', pk: r.position.pk ?? null };
              sortie.routeDeplacement = r.routeDeplacement;
              sortie.espace = r.espace ?? 'zone';
              sortie.espaceAdjacent = r.espace === 'adjacent'
                ? { libelle: libelleEspaceAdjacent(zoneDecisions, [r.position.lng, r.position.lat]), autorisation: 'autorisee', zone: libelleZone(zoneDecisions) }
                : null;
              sortie.activable = true;
              etat = etat.map((x) => (x.id === id ? { ...x, lng: sortie.apres.lng, lat: sortie.apres.lat, route: sortie.apres.route, pk: sortie.apres.pk } : x));
            }
            decisionsSimulees.push(sortie);
          }
          barrages = etat;
        }

        /* Le voisin se cherche dans ce même ensemble — celui-là précisément,
           sans retrait d'aucune sorte. */
        const proches = distancesPlusProche(barrages, graphe, Math.max(distanceMinKm * 4, 60));
        const parId = new Map(barrages.map((m) => [m.id, m]));

        /**
         * LE TRACÉ ROUTIER DU CONFLIT — seulement pour les postes sous le seuil.
         *
         * Le navigateur recalculait la géométrie avec son propre routeur, et
         * retombait sur un trait droit quand il échouait. Le tracé vient
         * désormais d'ici, par `tracerEntrePostes` : le même graphe hors ligne
         * et la même recherche que l'optimisation automatique. Une paire A↔B
         * n'est tracée qu'une fois, quel que soit le poste qui la désigne.
         */
        const tracesConflit = new Map();
        const traceConflit = (a, b) => {
          const cle = [a.id, b.id].sort().join('|');
          if (!tracesConflit.has(cle)) {
            const t = tracerEntrePostes(graphe, a, b, accrocher(graphe, a.lng, a.lat, 5), accrocher(graphe, b.lng, b.lat, 5));
            tracesConflit.set(cle, t && t.trace.length > 2 ? t : null);
          }
          const t = tracesConflit.get(cle);
          if (!t) return null;
          /* Toujours orienté du poste vers son voisin. */
          const direct = Math.abs(t.trace[0][0] - +a.lng.toFixed(5)) < 1e-9 && Math.abs(t.trace[0][1] - +a.lat.toFixed(5)) < 1e-9;
          return direct ? t : { ...t, trace: [...t.trace].reverse(), routes: [...t.routes].reverse() };
        };

        const resultats = barrages
          .map((m) => {
            const p = proches.get(m.id);
            const voisin = p?.voisinId ? parId.get(p.voisinId) : null;
            const km = p?.km != null ? Math.round(p.km * 100) / 100 : null;

            /* Ce que le poste EST, indépendamment de ce qui est demandé. */
            const estVip = Boolean(m.exceptionnel || m.missionId);
            const estNonEclaire = m.eclairage === 'non';
            const estEntreeDeVille = ENTREES_DE_VILLE.includes(m.positionVille);
            const estSortieDeVille = SORTIES_DE_VILLE.includes(m.positionVille);
            const nbAccidents = Number(m.accidentCount) || 0;
            /* Allumé, l'interrupteur joint le compte de TOUS les postes : c'est
               une information, elle ne se mérite pas. Le seuil ne sert qu'à
               l'exclusion, juste en dessous. */
            const accidentsJoints = avecAccidents;
            /* Inclusif : `>=`, pas `>`. Le chiffre demandé fait partie de ce
               qui est exclu — voir le commentaire de `seuilAccidents`. */
            const tropDAccidents = avecAccidents && nbAccidents >= seuilAccidents;

            /**
             * POURQUOI CE POSTE EST INTOUCHABLE — la liste, pas un booléen.
             *
             * Trois motifs indépendants, cumulables, et chacun doit rester
             * lisible : « intouchable » sans le motif obligerait l'utilisateur à
             * retrouver lui-même laquelle des trois raisons s'applique, alors
             * que c'est exactement ce qu'il veut savoir avant de trancher.
             *
             * Les portes de ville y figurent toujours ; les trois autres motifs
             * seulement si leur interrupteur est allumé — éteint, le caractère
             * existe toujours sur le poste mais n'a pas été invoqué.
             */
            const protections = [];
            if (estIntouchable(m)) protections.push('intouchable');
            if (estEntreeDeVille) protections.push('entree_ville');
            if (estSortieDeVille) protections.push('sortie_ville');
            if (tropDAccidents) protections.push('accidents');
            if (avecVip && estVip) protections.push('vip');
            if (avecNonEclaire && estNonEclaire) protections.push('non_eclaire');

            return {
              id: m.id,
              nom: m.nom || '',
              type: m.type,
              route: m.route || '',
              cie: m.cie ?? null,
              reg: m.reg ?? null,
              lng: m.lng,
              lat: m.lat,
              distanceKm: km,
              /* Le voisin tel qu'il est au dépôt — identifiant, position réelle
                 — et, pour un poste sous le seuil, le tracé routier qui a été
                 mesuré entre les deux. */
              voisin: voisin
                ? {
                    id: voisin.id,
                    nom: voisin.nom || '',
                    lng: voisin.lng,
                    lat: voisin.lat,
                    intouchable: estIntouchable(voisin),
                    route: km != null && km < distanceMinKm ? traceConflit(m, voisin) : null,
                  }
                : null,
              /* LE seul jugement de DISTANCE — inchangé par l'étape 3. */
              sousLeSeuil: km != null && km < distanceMinKm,
              /**
               * INTOUCHABLE : sous le seuil, mais jamais proposé au retrait.
               *
               * La mesure au-dessus reste vraie et reste affichée — c'est une
               * information utile : savoir qu'une entrée de ville a un voisin à
               * 800 m renseigne sur le maillage. Seule la PROPOSITION est
               * retirée (voir `aDecider` dans le bilan, et le panneau).
               */
              intouchable: protections.length > 0,
              protections,
              /* Arbitrage déjà rendu sur ce poste, s'il y en a un. Il ne change
                 RIEN à la mesure ci-dessus : un barrage conservé reste sous le
                 seuil, reste dans le dispositif et reste un voisin possible.
                 Il dit seulement que la question a déjà été tranchée, pour ne
                 pas la reposer à chaque calcul. */
              decision: m.decisionOptimisation ?? 'aucune',
              /* Ce que les paramètres demandés ajoutent — et rien de plus.
                 `null` quand le paramètre est OFF : l'absence de champ dit
                 « non demandé », un zéro dirait « demandé, et rien trouvé ». */
              accidents: accidentsJoints ? nbAccidents : null,
              severite: accidentsJoints ? (m.severite ?? 'none') : null,
              /* Le badge « A » ne se pose pas sur un simple compteur non nul :
                 il dit « au-dessus de l'ordinaire », au sens que le projet
                 donne déjà à ce mot — voir accidentsAuDessusDuNormal. */
              accidentAnormal: accidentsJoints ? accidentsAuDessusDuNormal(m) : null,
              vip: avecVip ? estVip : null,
              nonEclaire: avecNonEclaire ? estNonEclaire : null,
              /* Entrée / sortie de ville : renvoyée SANS interrupteur — elle
                 décrit l'implantation même du poste, pas un état à interroger,
                 et l'utilisateur ne l'a rattachée à aucune bascule. */
              positionVille: m.positionVille ?? 'none',
            };
          })
          .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
          /* Le tri d'abord, le filtre ensuite : l'ordre n'a pas d'importance
             ici, mais le filtre vient APRÈS `distancesPlusProche`, et c'est
             cela qui compte — voir plus haut. */
          .filter((m) => !position || ACCEPTES[position].includes(m.positionVille))
          /* Le PÉRIMÈTRE retenu (région, compagnie ou brigade, resserré sous le
             RBAC) filtre lui aussi ce qui est RAPPORTÉ : le voisin le plus
             proche reste cherché dans tout le dispositif autorisé, pour qu'un
             poste en limite de zone soit mesuré contre son vrai voisin. */
          .filter((m) => !perimetre || parId.get(m.id)?.[champ] === unite);

        /**
         * LES PARTS DU TOTAL SOUS LE SEUIL — sans recoupement.
         *
         * Un poste protégé peut très bien porter en plus une décision rendue
         * avant qu'il ne le soit. Compté dans les deux parts, il ferait un
         * total faux — et un « à décider » négatif si les deux se soustraient.
         * La protection passe donc d'abord : elle éteint la question.
         */
        /**
         * ANALYSÉS ET CONTEXTE — deux ensembles, jamais mêlés.
         *
         *   ANALYSÉS  les postes de la zone retenue (RBAC, puis resserrement),
         *             de la faction : ce sont eux que l'on compte et tranche ;
         *   CONTEXTE  les seuls postes HORS zone qu'il faut montrer pour
         *             dessiner un conflit détecté — le voisin d'un poste analysé
         *             sous le seuil. Ils ne sont ni comptés ni tranchés.
         *
         * Chaque poste renvoyé dit pourquoi il est là (`raison`).
         */
        for (const m of resultats) m.raison = m.intouchable ? 'intouchable-protege' : 'analyse';
        const analysesIds = new Set(resultats.map((m) => m.id));
        const contexte = new Map();
        for (const m of resultats) {
          if (!m.sousLeSeuil || !m.voisin?.id || analysesIds.has(m.voisin.id)) continue;
          const v = parId.get(m.voisin.id);
          if (!v) continue;
          const c = contexte.get(v.id) ?? {
            id: v.id, nom: v.nom || '', type: v.type, lng: v.lng, lat: v.lat,
            route: v.route || '', bt: v.bt ?? null, cie: v.cie ?? null, reg: v.reg ?? null,
            factionId: v.factionId || '', intouchable: estIntouchable(v),
            raison: 'voisin-conflit', pour: [],
          };
          c.pour.push(m.id);
          contexte.set(v.id, c);
        }
        const zoneManuelle = perimetre ? { niveau: niveauEffectif, unite } : null;
        const autresFactions = autorisesManuel.length - barragesInitiaux.length;
        const supprimesSimules = barragesInitiaux.length - barrages.length;
        const horsZone = barrages.length - analysesIds.size - contexte.size;
        console.log([
          'OPTIMISATION MANUELLE',
          `  scope: ${libelleZone(zoneManuelle)} · ${factionManuelle.id} · seuil ${distanceMinKm} km`,
          `  authorized: ${autorisesManuel.length}`,
          `  analyzed: ${analysesIds.size}`,
          `  context: ${contexte.size}`,
          `  outside-scope-rejected: ${autresFactions + horsZone} (autres factions ${autresFactions}, hors zone ${horsZone})`,
          `  decisions: ${decisionsSimulees.length} (suppressions simulées ${supprimesSimules})`,
        ].join('\n'));

        /* L'état APRÈS de chaque décision, lu dans la mesure de l'état simulé. */
        let simulationManuelle = null;
        if (decisionsSimulees.length) {
          for (const d of decisionsSimulees) {
            if (d.statut !== 'simule' || d.type === 'supprimer') continue;
            const apres = proches.get(d.barrageId);
            d.distanceApresKm = apres?.km != null ? Math.round(apres.km * 100) / 100 : null;
            d.voisinApres = apres?.voisinId ?? null;
            d.conflitRestant = d.distanceApresKm != null && d.distanceApresKm < distanceMinKm;
            /* Le trajet APRÈS entre le poste et son voisin, pour la carte — même tracé que partout ailleurs. */
            const posteApres = parId.get(d.barrageId);
            const voisinApres = d.voisinApres ? parId.get(d.voisinApres) : null;
            d.voisinApresNom = voisinApres?.nom || d.voisinApres || null;
            if (d.type === 'deplacer' && posteApres && voisinApres) d.routeApres = traceConflit(posteApres, voisinApres)?.trace ?? null;
          }
          const simulationId = randomUUID();
          const creeeSim = Date.now();
          const libelleSim = libelleSimulation(simulationId, creeeSim);
          const retenues = decisionsSimulees.filter((d) => d.statut === 'simule');
          /* Au journal : la décision que l'utilisateur VIENT de prendre (la liste
             complète est renvoyée à chaque clic, la retracer entière dupliquerait). */
          const nouvelle = corps.decisionNouvelle;
          for (const d of decisionsSimulees) {
            if (!nouvelle || d.barrageId !== String(nouvelle.barrageId) || d.type !== String(nouvelle.type)) continue;
            journaliserDecision(session, {
              statut: d.statut === 'simule' ? 'PROPOSÉ' : 'REFUSÉE', type: d.type,
              barrage: depot.parId(d.barrageId) ?? { id: d.barrageId, nom: d.nom },
              zoneLibelle: libelleZone(zoneDecisions), factionId: factionManuelle.id,
              simulation: retenues.length ? libelleSim : null,
              avant: d.avant ?? null, apres: d.apres ?? null,
              distanceAvantKm: d.distanceAvantKm, distanceApresKm: d.distanceApresKm ?? null,
              seuilKm: d.type === 'deplacer' ? SEUIL_DISTANCE_AUTO_KM : distanceMinKm, raison: d.raison,
            });
          }
          if (retenues.length) {
            const maintenantSim = creeeSim;
            for (const [cle, sim] of simulationsOptimisation) {
              if (maintenantSim - sim.creee > 30 * 60 * 1000) simulationsOptimisation.delete(cle);
            }
            simulationsOptimisation.set(simulationId, {
              type: 'manuelle',
              creee: maintenantSim,
              auteur: JSON.stringify(identite(session)),
              factionId: factionManuelle.id,
              jour: jourManuel,
              seuilKm: distanceMinKm,
              zone: zoneDecisions,
              libelle: libelleSim,
              zoneLibelle: libelleZone(zoneDecisions),
              signature: signatureOptimisation(barragesInitiaux),
              /* `espace` DOIT suivre : l'activation revalide une position adjacente
                 par la règle de l'espace adjacent, pas par celle de la zone. Sans
                 lui, toute position choisie hors zone était refusée à l'activation. */
              decisions: retenues.map(({ barrageId, type, avant, apres, intouchable, distanceAvantKm, distanceApresKm, espace, choixOperateur }) =>
                ({ barrageId, type, avant, apres, intouchable, distanceAvantKm, distanceApresKm, espace: espace ?? 'zone', choixOperateur: choixOperateur === true })),
            });
          }
          simulationManuelle = {
            simulationId: retenues.length ? simulationId : null,
            libelle: retenues.length ? libelleSim : null,
            creee: new Date(creeeSim).toISOString(),
            zoneLibelle: libelleZone(zoneDecisions),
            factionId: factionManuelle.id,
            /* Le seuil des DÉPLACEMENTS (celui de l'automatique) et celui de la mesure. */
            seuilDeplacementKm: SEUIL_DISTANCE_AUTO_KM,
            seuilMesureKm: distanceMinKm,
            decisions: decisionsSimulees,
            supprimes: decisionsSimulees.filter((d) => d.statut === 'simule' && d.type === 'supprimer').map((d) => d.barrageId),
          };
        }

        const sousLeSeuilListe = resultats.filter((m) => m.sousLeSeuil);
        const sousLeSeuil = sousLeSeuilListe.length;
        const intouchables = sousLeSeuilListe.filter((m) => m.intouchable).length;
        const aTrancher = sousLeSeuilListe.filter((m) => !m.intouchable);
        const conserves = aTrancher.filter((m) => m.decision === 'conserve').length;
        const aDecider = aTrancher.filter((m) => m.decision === 'aucune').length;

        json(res, 200, {
          parametres: {
            distanceMinKm,
            niveau: perimetre ? niveauEffectif : 'national',
            unite: perimetre ? unite : null,
            /* Renvoyés tels qu'appliqués : le panneau affiche ce qui a
               RÉELLEMENT servi, pas ce que les cases montrent au moment où on
               les regarde — elles ont pu changer depuis le calcul. */
            accidents: avecAccidents,
            seuilAccidents,
            vip: avecVip,
            nonEclaire: avecNonEclaire,
            typeBarrage: 'barrage_fixe',
            positionVille: position ?? 'toutes',
            factionId: factionManuelle.id,
          },
          perimetre: {
            zoneLibelle: libelleZone(zoneManuelle),
            factionId: factionManuelle.id,
            autorises: autorisesManuel.length,
            analyses: analysesIds.size,
            contexte: contexte.size,
            horsPerimetreExclus: autresFactions + horsZone,
            autresFactions,
            horsZone,
          },
          /* Les postes affichés pour CONTEXTE seulement — voir plus haut. */
          contexte: [...contexte.values()],
          /* Les décisions simulées et leur effet — `null` sans décision. */
          simulation: simulationManuelle,
          bilan: {
            examines: resultats.length,
            sousLeSeuil,
            conformes: resultats.length - sousLeSeuil,
            /* Le total sous le seuil se lit en trois parts : ce qui est protégé
               (rien à trancher), ce que le commandement a déjà décidé de garder,
               et ce qui reste effectivement à trancher. */
            intouchables,
            conserves,
            aDecider,
          },
          barrages: resultats,
        });
        return true;
      }

      /* --------------------------------------------------------------- */
      /* ROUTES — catalogue, tracé, trajet, périmètre d'un corridor      */
      /* --------------------------------------------------------------- */
      /**
       * Ouvert à tout compte connecté : le catalogue et les tracés sont du
       * réseau public, et chaque liste de barrages passe par `visibles` — un
       * commandement ne voit que son périmètre. Les écritures ne sont pas ici.
       */
      if (chemin.startsWith('/api/routes')) {
        if (!session) return refuseNonConnecte(json, res);
        if (!graphe) {
          json(res, 409, { erreur: 'Réseau routier indisponible : lancez « npm run build:roads ».' });
          return true;
        }
        if (chemin === '/api/routes' && req.method === 'GET') {
          json(res, 200, {
            source: 'OpenStreetMap (tag ref) — graphe_routier.json',
            routes: catalogueRoutes(graphe),
            corridor: { defautKm: CORRIDOR_DEFAUT_KM, minKm: CORRIDOR_MIN_KM, maxKm: CORRIDOR_MAX_KM, toleranceTraceKm: TOLERANCE_TRACE_KM },
          });
          return true;
        }
        if (chemin === '/api/routes/villes' && req.method === 'GET') {
          json(res, 200, {
            villes: [...villes].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
              .map((v) => ({ nom: v.nom, lng: v.lng, lat: v.lat, pop: v.pop ?? null })),
          });
          return true;
        }
        if (chemin === '/api/routes/trace' && req.method === 'GET') {
          const trace = traceRoute(graphe, url.searchParams.get('ref') ?? '', villes);
          if (!trace) {
            json(res, 404, { erreur: `Route inconnue du réseau : « ${url.searchParams.get('ref') ?? ''} ».` });
            return true;
          }
          json(res, 200, { ...trace, lignes: lignesPourCarte(trace.lignes) });
          return true;
        }
        if (chemin === '/api/routes/au-point' && req.method === 'GET') {
          const pt = coordonneesValides({ lng: url.searchParams.get('lng'), lat: url.searchParams.get('lat') });
          if (!pt) {
            json(res, 400, { erreur: 'Coordonnées invalides.' });
            return true;
          }
          const trouvee = routeAuPoint(graphe, pt[0], pt[1]);
          json(res, trouvee ? 200 : 404, trouvee ?? { erreur: 'Aucune route numérotée à moins de 1,5 km de ce point.' });
          return true;
        }
        if (chemin === '/api/routes/trajet' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const trouver = (nom) => villes.find((v) => v.nom === String(nom ?? '').trim());
          const depart = trouver(corps?.depart);
          const arrivee = trouver(corps?.arrivee);
          if (!depart || !arrivee) {
            json(res, 400, { erreur: `Localité inconnue : « ${!depart ? corps?.depart ?? '' : corps?.arrivee ?? ''} ».` });
            return true;
          }
          if (depart === arrivee) {
            json(res, 400, { erreur: 'Le départ et l’arrivée sont la même localité.' });
            return true;
          }
          const r = itinerairesTrajet(graphe, depart, arrivee);
          /* Un échec est DIT : aucun tracé de remplacement n'est dessiné. */
          if (r.erreur) {
            json(res, 422, { erreur: r.erreur });
            return true;
          }
          const maintenantTrajet = Date.now();
          for (const [k, x] of trajetsCalcules) if (maintenantTrajet - x.cree > 30 * 60 * 1000) trajetsCalcules.delete(k);
          const id = randomUUID();
          const variantes = r.variantes.map((v) => ({ ...v, coords: v.coords.map(([x, y]) => [x, y]) }));
          trajetsCalcules.set(id, { id, cree: maintenantTrajet, depart, arrivee, variantes });
          json(res, 200, {
            trajetId: id,
            depart: { nom: depart.nom, lng: depart.lng, lat: depart.lat },
            arrivee: { nom: arrivee.nom, lng: arrivee.lng, lat: arrivee.lat },
            variantes: variantes.map((v) => ({ ...v, coords: lignesPourCarte([v.coords])[0] })),
          });
          return true;
        }
        /**
         * LES BARRAGES DE LA ROUTE — la liste de la filtration, en lecture :
         * tous les barrages en service SUR la route (`appartenanceRoute`),
         * toutes factions, et ceux qu'on a écartés avec leur raison (autre
         * route, position à vérifier). `factionId` ne fait que filtrer la liste.
         */
        if (chemin === '/api/routes/perimetre' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const resolu = resoudreCorridor(corps?.corridor);
          if (resolu.erreur) {
            json(res, resolu.statut, { erreur: resolu.erreur });
            return true;
          }
          const jour = dateLocale(new Date());
          const creneaux = depotElements.creneauxParBarrage(jour, jour);
          const toutesLesFactions = FACTIONS.map((x) => x.id);
          const factionsDe = (m) => (estIntouchable(m) ? toutesLesFactions : factionsDuBarrage(m, creneaux.get(m.id) ?? null));
          const filtre = corps?.factionId && corps.factionId !== 'toutes' && corps.factionId !== 'all' ? String(corps.factionId) : null;
          const p = barragesSurRoute(session, resolu);
          const fiche = (m) => ({
            id: m.id, nom: m.nom || m.id, type: m.type, statut: m.statutBarrage || 'approuve',
            route: m.route || '', pk: m.pk ?? null, factionId: m.factionId || '', factions: factionsDe(m),
            lng: m.lng, lat: m.lat, reg: m.reg ?? null, cie: m.cie ?? null, bt: m.bt ?? null,
            intouchable: estIntouchable(m), distanceKm: Math.round((p.distances.get(m.id) ?? 0) * 1000) / 1000,
            assigne: assignationOuverte(m.id) != null,
          });
          json(res, 200, {
            libelle: resolu.libelle,
            corridor: resolu.spec,
            toleranceM: Math.round(TOLERANCE_ROUTE_KM * 1000),
            factionId: filtre ?? 'toutes',
            barrages: p.sur.filter((m) => !filtre || factionsDe(m).includes(filtre)).map(fiche)
              .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
            exclusions: p.exclusions.map((e) => ({ ...fiche(e.barrage), raison: e.raison })),
          });
          return true;
        }
        /**
         * LES CONFLITS DU PÉRIMÈTRE, FACTION PAR FACTION — voir
         * serveur/conflitsFaction.mjs. Postes analysés : les barrages fixes
         * actifs du corridor ; leurs voisins hors corridor (à portée du seuil)
         * comptent, une paire n'est rendue que si l'un des deux est dans le
         * corridor. Avec `ids`, seules les paires touchant ces postes sont
         * remesurées : l'écran remplace les siennes, garde les autres.
         */
        if (chemin === '/api/routes/conflits' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const resolu = resoudreCorridor(corps?.corridor);
          if (resolu.erreur) {
            json(res, resolu.statut, { erreur: resolu.erreur });
            return true;
          }
          const jour = dateLocale(new Date());
          const creneaux = depotElements.creneauxParBarrage(jour, jour);
          const toutesLesFactions = FACTIONS.map((f) => f.id);
          const factionsDe = (m) => (estIntouchable(m) ? toutesLesFactions : factionsDuBarrage(m, creneaux.get(m.id) ?? null));
          /* Les barrages fixes en service SUR la route : les deux postes d'un
             conflit en font partie — un poste d'une route voisine n'y entre pas. */
          const surRoute = new Set(barragesSurRoute(session, resolu).sur.map((m) => m.id));
          const membres = barragesAutorisesOptimisation(session).filter((m) => surRoute.has(m.id));
          const dans = new Set(membres.map((m) => m.id));
          const ids = Array.isArray(corps?.ids) ? corps.ids.map(String).slice(0, 500) : null;
          const seuilKmEffectif = Number(corps?.seuilKm) || Number(corps?.maxKm) || SEUIL_DISTANCE_AUTO_KM;
          const r = conflitsParFaction(membres, graphe, { seuilKm: seuilKmEffectif, factionsDe, ids });
          const filtre = corps?.factionId && corps.factionId !== 'toutes' ? String(corps.factionId) : null;
          const parId = new Map(membres.map((m) => [m.id, m]));
          /* « En validation » : une demande à trancher (retrait, modification).
             « Assigné » : remis au CMND Région, pas encore traité. */
          const enAttente = (m) => m.decisionOptimisation === 'a_supprimer' ||
            depotInstructions.ouvertesPour(m.id).some((i) => i.aDecider);
          const assigne = (m) => assignationOuverte(m.id) != null;
          const fiche = (m) => ({
            id: m.id, nom: m.nom || m.id, lng: m.lng, lat: m.lat, route: m.route || '',
            factionId: m.factionId || null, factions: factionsDe(m), intouchable: estIntouchable(m),
            bt: m.bt ?? null, horsCorridor: !dans.has(m.id),
          });
          const conflits = r.conflits
            .filter((c) => dans.has(c.a) || dans.has(c.b))
            .filter((c) => !filtre || c.factions.includes(filtre))
            .map((c) => {
              const a = parId.get(c.a);
              const b = parId.get(c.b);
              return {
                cle: `${c.a}|${c.b}`,
                a: fiche(a),
                b: fiche(b),
                km: Math.round(c.km * 100) / 100,
                factions: c.factions,
                raison: `Même faction (${c.factions.map((x) => factionParId(x)?.nom ?? x).join(', ')}) — ${c.km.toFixed(1)} km par la route, sous le seuil de ${seuilKmEffectif} km`,
                statut: enAttente(a) || enAttente(b) ? 'en_attente' : assigne(a) || assigne(b) ? 'assigne' : 'actif',
              };
            });
          json(res, 200, {
            seuilKm: seuilKmEffectif,
            regle: 'Deux barrages ne sont en conflit que s’ils partagent une faction et que la route les sépare de moins du seuil.',
            barragesAnalyses: dans.size,
            partiel: Boolean(ids),
            ids,
            conflits,
            sansFaction: r.sansFaction.filter((id) => dans.has(id) && (!ids || ids.includes(id))).map((id) => fiche(parId.get(id))),
          });
          return true;
        }
        /**
         * L'ESPACEMENT LE LONG DE LA ROUTE — voir serveur/espacementRoute.mjs.
         *
         * Les barrages fixes SUR la route (`appartenanceRoute`), rangés le long
         * de l'axe réel (tronc kilométrique d'une route, tracé d'un trajet) ;
         * l'écart entre deux consécutifs est une longueur de route. `maxKm` est
         * l'écart maximal permis, saisi par l'utilisateur. Lecture seule : les
         * positions proposées ne sont que des propositions.
         */
        if (chemin === '/api/routes/espacement' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const maxKm = Number(corps?.maxKm);
          if (!Number.isFinite(maxKm) || maxKm < 0.1 || maxKm > 500) {
            json(res, 400, { erreur: 'Écart maximal invalide : entre 0,1 et 500 km.' });
            return true;
          }
          const resolu = resoudreCorridor(corps?.corridor);
          if (resolu.erreur) {
            json(res, resolu.statut, { erreur: resolu.erreur });
            return true;
          }
          let axe;
          let sauts = [];
          if (resolu.spec.type === 'route') {
            const ret = referentiel(graphe, resolu.spec.ref);
            if (!ret?.tronc?.length) {
              json(res, 422, { erreur: `Géométrie de la ${resolu.spec.ref} absente du réseau : aucune distance ne peut être mesurée.` });
              return true;
            }
            axe = ret.tronc;
            sauts = ret.sauts ?? [];
          } else {
            axe = axeDepuisPolyligne(resolu.lignes[0]);
          }
          const jour = dateLocale(new Date());
          const creneaux = depotElements.creneauxParBarrage(jour, jour);
          const filtre = corps?.factionId && corps.factionId !== 'toutes' ? String(corps.factionId) : null;
          const surRoute = barragesSurRoute(session, resolu).sur
            .filter((m) => m.type !== 'barrage_mobile')
            .filter((m) => !filtre || estIntouchable(m) || factionsDuBarrage(m, creneaux.get(m.id) ?? null).includes(filtre));
          const r = analyserEspacement({ axe, sauts, barrages: surRoute.map((m) => ({ id: m.id, nom: m.nom || m.id, lng: m.lng, lat: m.lat })), maxKm });
          json(res, 200, {
            ...r,
            maxKm,
            toleranceM: Math.round(resolu.corridor.km * 1000),
            route: resolu.libelle,
            mesure: resolu.spec.type === 'route' ? 'tronc kilométrique de la route' : 'tracé du trajet',
          });
          return true;
        }
        /** Le trajet routier entre deux barrages — la liaison montrée sur la carte. */
        if (chemin === '/api/routes/trace-entre' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          const vus = new Map(visibles(session, depot.tous()).map((m) => [m.id, m]));
          const a = vus.get(String(corps?.a ?? ''));
          const b = vus.get(String(corps?.b ?? ''));
          if (!a || !b) {
            json(res, 404, { erreur: 'Barrage introuvable.' });
            return true;
          }
          const t = tracerEntrePostes(graphe, a, b, accrocher(graphe, a.lng, a.lat, 5), accrocher(graphe, b.lng, b.lat, 5));
          json(res, t ? 200 : 422, t ?? { erreur: 'Aucun itinéraire routier entre ces deux barrages.' });
          return true;
        }
        json(res, 404, { erreur: 'Route inconnue.' });
        return true;
      }

      /* --------------------------------------------------------------- */
      /* OPTIMISATION AUTOMATIQUE                                        */
      /* --------------------------------------------------------------- */
      /**
       * LE PÉRIMÈTRE DE L'OPTIMISATION AUTOMATIQUE, SANS LA CALCULER.
       *
       * Ce que l'analyse prendrait en compte — zone, faction, barrages,
       * Intouchables — dit AVANT de lancer le calcul, par la même fonction que
       * la simulation. Aucun itinéraire n'est calculé ici.
       */
      if (chemin === '/api/barrages/optimisation-auto/perimetre' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const maintenant = new Date();
        const fidParam = url.searchParams.get('factionId');
        const toutesFactions = !fidParam || fidParam === 'toutes' || fidParam === 'all';
        const faction = toutesFactions
          ? { id: 'toutes', nom: 'Toutes les factions', libelle: 'Toutes les factions' }
          : (factionParId(fidParam) ?? factionDe(maintenant));
        const zoneDemandee = zoneOptimisation(session, url.searchParams.get('niveau'), url.searchParams.get('unite'));
        if (zoneDemandee.erreur) {
          json(res, zoneDemandee.statut, { erreur: zoneDemandee.erreur });
          return true;
        }
        const { zone } = zoneDemandee;
        const seuilKmParam = Number(url.searchParams.get('seuilKm') || url.searchParams.get('distanceMinKm'));
        const seuilKm = Number.isFinite(seuilKmParam) && seuilKmParam > 0 ? seuilKmParam : SEUIL_DISTANCE_AUTO_KM;
        const p = perimetreOptimisationAuto(session, toutesFactions ? 'toutes' : faction.id, dateLocale(maintenant), zone);
        json(res, 200, {
          factionId: faction.id,
          factionNom: faction.nom,
          factionLibelle: faction.libelle,
          zone: zone ? { niveau: zone.niveau, unite: zone.unite } : null,
          zoneLibelle: libelleZone(zone),
          barragesAnalyses: p.deplacables.length,
          intouchablesProteges: p.intouchables.length,
          seuilKm,
        });
        return true;
      }

      if (chemin === '/api/barrages/optimisation-auto' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!graphe) {
          json(res, 409, {
            erreur: 'Réseau routier indisponible : lancez « npm run build:roads ».',
          });
          return true;
        }

        const corps = await lireCorps(req, res);
        const maintenantAnalyse = new Date();
        const toutesFactions = !corps?.factionId || corps?.factionId === 'toutes' || corps?.factionId === 'all';
        const faction = toutesFactions
          ? { id: 'toutes', nom: 'Toutes les factions', libelle: 'Toutes les factions' }
          : (factionParId(corps?.factionId) ?? factionDe(maintenantAnalyse));
        const jourAnalyse = dateLocale(maintenantAnalyse);
        const seuilKm = Number.isFinite(Number(corps?.seuilKm)) && Number(corps?.seuilKm) > 0
          ? Number(corps.seuilKm)
          : (Number.isFinite(Number(corps?.distanceMinKm)) && Number(corps?.distanceMinKm) > 0
            ? Number(corps.distanceMinKm)
            : SEUIL_DISTANCE_AUTO_KM);

        /**
         * OPTIMISATION PAR ROUTE OU PAR TRAJET — le même moteur, la même
         * simulation, la même application revalidée ; seul le périmètre change.
         *
         * Analysés : les barrages fixes de la faction dans le corridor. Fixes :
         * les Intouchables, et les postes des autres routes assez proches pour
         * gêner — ils comptent dans les conflits, ils ne bougent jamais. Une
         * position proposée reste SUR le tracé choisi (TOLERANCE_TRACE_KM).
         */
        if (corps?.corridor) {
          if (session.rang !== 'admin') {
            json(res, 403, { erreur: 'Optimisation par route : réservée au Superadmin.' });
            return true;
          }
          /* Une faction, et une seule : deux postes de factions différentes ne
             sont jamais en conflit, et le moteur compare tout ce qu'on lui
             donne. « Toutes » mêlerait des tours de service qui se relaient. */
          if (toutesFactions) {
            json(res, 400, { erreur: 'Choisissez une faction : les conflits ne se comptent qu’entre barrages d’une même faction.' });
            return true;
          }
          const resolu = resoudreCorridor(corps.corridor);
          if (resolu.erreur) {
            json(res, resolu.statut, { erreur: resolu.erreur });
            return true;
          }
          const perimetreRoute = perimetreCorridor(session, toutesFactions ? 'toutes' : faction.id, jourAnalyse, resolu);
          const analyses = new Set(perimetreRoute.deplacables.map((b) => b.id));
          const resultatRoute = analyserOptimisationDistance(perimetreRoute.barrages, graphe, {
            seuilKm,
            fixes: new Set(perimetreRoute.fixes.map((b) => b.id)),
            /* Sur le tracé ET sur une route numérotée de ce tracé : une position
               sur une bretelle sans référence ne se revaliderait pas à l'application. */
            garderPosition: (_barrage, pt, recale) => Boolean(recale?.route) && resolu.refs.has(recale.route) &&
              positionAutorisee(session, null, pt) && resolu.corridor.surTrace(pt),
            dansZone: (pt) => resolu.corridor.surTrace(pt),
          });
          for (const p of resultatRoute.propositions) {
            p.seuilKm = seuilKm;
            p.espaceAdjacent = null;
          }
          console.log(`[optimisation-route] ${resolu.libelle} ${faction.id} ${seuilKm}km ${JSON.stringify(resultatRoute.mesures)}`);
          const simulationIdRoute = randomUUID();
          const creeeRoute = Date.now();
          for (const [id, s] of simulationsOptimisation) if (creeeRoute - s.creee > 30 * 60 * 1000) simulationsOptimisation.delete(id);
          const libelleSimRoute = libelleSimulation(simulationIdRoute, creeeRoute);
          journal.consigner({
            session, action: 'optimisation_simulation', avant: null, apres: null,
            details: {
              categorie: 'optimisation', statut: 'PROPOSÉ', mode: 'AUTOMATIQUE', simulation: libelleSimRoute,
              zone: resolu.libelle, factionId: faction.id, seuilKm, corridor: resolu.spec,
              nombre: resultatRoute.propositions.length,
              conflitsAvant: resultatRoute.resume.conflitsAvant, conflitsApres: resultatRoute.resume.conflitsApres,
            },
          });
          simulationsOptimisation.set(simulationIdRoute, {
            creee: creeeRoute,
            libelle: libelleSimRoute,
            zoneLibelle: resolu.libelle,
            auteur: JSON.stringify(identite(session)),
            factionId: faction.id,
            jour: jourAnalyse,
            zone: null,
            corridor: resolu,
            seuilKm,
            signature: signatureOptimisation(perimetreRoute.barrages),
            propositions: resultatRoute.propositions,
          });
          /* Les conflits qui concernent la route : au moins un poste analysé.
             Ceux qui opposent deux postes d'autres routes ne sont pas l'objet
             de cette optimisation, et ne sont pas comptés. */
          const touche = (c) => analyses.has(c.a?.id ?? c.a) || analyses.has(c.b?.id ?? c.b);
          json(res, 200, {
            ...resultatRoute,
            conflitsInitiaux: resultatRoute.conflitsInitiaux.filter(touche),
            conflitsRestants: resultatRoute.conflitsRestants.filter(touche),
            conflitsSansSolution: resultatRoute.conflitsSansSolution.filter(touche),
            simulationId: simulationIdRoute,
            simulationLibelle: libelleSimRoute,
            simulationCreee: new Date(creeeRoute).toISOString(),
            resumeCorridor: {
              barragesAnalyses: analyses.size,
              postesFixes: perimetreRoute.fixes.length,
              conflitsAvant: resultatRoute.conflitsInitiaux.filter(touche).length,
              conflitsApres: resultatRoute.conflitsRestants.filter(touche).length,
              deplacements: resultatRoute.propositions.length,
            },
            parametres: { seuilKm, niveau: 'national', unite: null, factionId: faction.id, corridor: resolu.spec, libelle: resolu.libelle },
            perimetre: {
              factionId: faction.id, factionLibelle: faction.libelle,
              barragesAnalyses: analyses.size, zoneLibelle: resolu.libelle, seuilKm,
            },
          });
          return true;
        }

        const impose = perimetreDuRang(session);

        if (impose && !impose.unite) {
          json(res, 409, {
            erreur:
              `Votre compte est rattaché au niveau « ${impose.niveau} » sans unité nommée : ` +
              "le périmètre d'optimisation ne peut pas être déterminé.",
          });
          return true;
        }

        /* LA ZONE : la portée consultée à l'écran, revalidée contre le RBAC.
           Ni les barrages hors zone ni les positions hors zone n'entrent dans
           le calcul — seuls les Intouchables voisins, pour valider le seuil. */
        const zoneDemandee = zoneOptimisation(session, corps?.niveau, corps?.unite);
        if (zoneDemandee.erreur) {
          json(res, zoneDemandee.statut, { erreur: zoneDemandee.erreur });
          return true;
        }
        const { zone } = zoneDemandee;
        let resultat;
        let barragesPourSignature;
        let perimetre = null;

        if (toutesFactions) {
          const toutesPropositions = [];
          const tousConflitsInitiaux = [];
          const tousConflitsRestants = [];
          const tousConflitsSansSolution = [];
          const tousJournal = [];
          let totalConflitsAvant = 0;
          let totalConflitsApres = 0;
          let totalConflitsEntreIntou = 0;
          const tousBarragesMap = new Map();
          const totalMesures = { barrages: 0, intouchables: 0, iterations: 0, passes: 1, deplacementsSimules: 0, dureeMs: 0 };

          for (const f of FACTIONS) {
            const perimetreF = perimetreOptimisationAuto(session, f.id, jourAnalyse, zone);
            const barragesF = perimetreF.barrages;
            for (const b of barragesF) tousBarragesMap.set(b.id, b);

            const resF = analyserOptimisationDistance(barragesF, graphe, {
              seuilKm,
              garderPosition: (_barrage, pt) => positionAutorisee(session, zone, pt),
              dansZone: zone ? (pt) => positionAutorisee(session, zone, pt) : null,
              espaceAdjacent: espaceAdjacentPour(session, zone,
                obstaclesAdjacents(session, f.id, jourAnalyse, zone, new Set(barragesF.map((b) => b.id)))),
            });

            for (const p of resF.propositions) {
              p.seuilKm = seuilKm;
              p.factionId = f.id;
              p.factionLibelle = f.libelle;
              p.espaceAdjacent = p.espace === 'adjacent'
                ? { libelle: libelleEspaceAdjacent(zone, [p.apres.lng, p.apres.lat]), autorisation: 'autorisee', zone: libelleZone(zone) }
                : null;
              toutesPropositions.push(p);
            }

            for (const ci of resF.conflitsInitiaux) {
              tousConflitsInitiaux.push({ ...ci, factionId: f.id, factionLibelle: f.libelle });
            }
            for (const cr of resF.conflitsRestants) {
              tousConflitsRestants.push({ ...cr, factionId: f.id, factionLibelle: f.libelle });
            }
            for (const cs of resF.conflitsSansSolution) {
              tousConflitsSansSolution.push({ ...cs, factionId: f.id, factionLibelle: f.libelle });
            }
            if (Array.isArray(resF.journal)) {
              for (const j of resF.journal) {
                tousJournal.push({ ...j, factionId: f.id, factionLibelle: f.libelle });
              }
            }

            totalConflitsAvant += resF.resume?.conflitsAvant ?? 0;
            totalConflitsApres += resF.resume?.conflitsApres ?? 0;
            totalConflitsEntreIntou += resF.resume?.conflitsEntreIntouchables ?? 0;

            totalMesures.barrages += resF.mesures?.barrages ?? 0;
            totalMesures.intouchables += resF.mesures?.intouchables ?? 0;
            totalMesures.iterations += resF.mesures?.iterations ?? 0;
            totalMesures.passes = Math.max(totalMesures.passes, resF.mesures?.passes ?? 1);
            totalMesures.deplacementsSimules += resF.mesures?.deplacementsSimules ?? 0;
            totalMesures.dureeMs += resF.mesures?.dureeMs ?? 0;
          }

          barragesPourSignature = [...tousBarragesMap.values()];
          resultat = {
            propositions: toutesPropositions,
            conflitsInitiaux: tousConflitsInitiaux,
            conflitsRestants: tousConflitsRestants,
            conflitsSansSolution: tousConflitsSansSolution,
            journal: tousJournal,
            resume: {
              conflitsAvant: totalConflitsAvant,
              conflitsApres: totalConflitsApres,
              deplacements: toutesPropositions.length,
              barragesAnalyses: barragesPourSignature.filter((b) => !estIntouchable(b)).length,
              conflitsEntreIntouchables: totalConflitsEntreIntou,
            },
            mesures: totalMesures,
          };
        } else {
          perimetre = perimetreOptimisationAuto(session, faction.id, jourAnalyse, zone);
          const barrages = perimetre.barrages;
          barragesPourSignature = barrages;
          resultat = analyserOptimisationDistance(barrages, graphe, {
            seuilKm,
            garderPosition: (_barrage, pt) => positionAutorisee(session, zone, pt),
            /* Les candidats sont cherchés DANS la zone : un barrage de Rabat ne
               part pas en Casablanca. */
            dansZone: zone ? (pt) => positionAutorisee(session, zone, pt) : null,
            /* Seulement si la zone ne donne rien : la bande locale au-delà de sa
               limite, dans le RBAC, contre les postes fixes qui s'y trouvent. */
            espaceAdjacent: espaceAdjacentPour(session, zone,
              obstaclesAdjacents(session, faction.id, jourAnalyse, zone, new Set(barrages.map((b) => b.id)))),
          });
          for (const p of resultat.propositions) {
            p.seuilKm = seuilKm;
            p.factionId = faction.id;
            p.factionLibelle = faction.libelle;
            p.espaceAdjacent = p.espace === 'adjacent'
              ? { libelle: libelleEspaceAdjacent(zone, [p.apres.lng, p.apres.lat]), autorisation: 'autorisee', zone: libelleZone(zone) }
              : null;
          }
          for (const ci of resultat.conflitsInitiaux) {
            ci.factionId = faction.id;
            ci.factionLibelle = faction.libelle;
          }
          for (const cr of resultat.conflitsRestants) {
            cr.factionId = faction.id;
            cr.factionLibelle = faction.libelle;
          }
          for (const cs of resultat.conflitsSansSolution) {
            cs.factionId = faction.id;
            cs.factionLibelle = faction.libelle;
          }
        }
        console.log(`[optimisation-auto] ${libelleZone(zone)} ${faction.id} ${seuilKm}km ${JSON.stringify(resultat.mesures)}`);
        const simulationId = randomUUID();
        const maintenantSimulation = Date.now();
        for (const [id, simulation] of simulationsOptimisation) {
          if (maintenantSimulation - simulation.creee > 30 * 60 * 1000) simulationsOptimisation.delete(id);
        }
        const libelleSimAuto = libelleSimulation(simulationId, maintenantSimulation);
        journal.consigner({
          session, action: 'optimisation_simulation', avant: null, apres: null,
          details: {
            categorie: 'optimisation', statut: 'PROPOSÉ', mode: 'AUTOMATIQUE', simulation: libelleSimAuto,
            zone: libelleZone(zone), factionId: faction.id, seuilKm,
            nombre: resultat.propositions.length,
            conflitsAvant: resultat.resume.conflitsAvant, conflitsApres: resultat.resume.conflitsApres,
          },
        });
        simulationsOptimisation.set(simulationId, {
          creee: maintenantSimulation,
          libelle: libelleSimAuto,
          zoneLibelle: libelleZone(zone),
          auteur: JSON.stringify(identite(session)),
          factionId: faction.id,
          jour: jourAnalyse,
          zone,
          seuilKm,
          signature: signatureOptimisation(barragesPourSignature),
          propositions: resultat.propositions,
        });

        /**
         * LES POSTES DÉJÀ RETIRÉS PAR UNE OPTIMISATION PRÉCÉDENTE.
         */
        const dejaRetires = visibles(session, depot.tous()).filter(
          (m) =>
            m.statutBarrage === 'retire_optimisation' &&
            (session.rang === 'admin' || m[impose?.champ] === impose?.unite),
        ).length;

        json(res, 200, {
          ...resultat,
          simulationId,
          simulationLibelle: libelleSimAuto,
          simulationCreee: new Date(maintenantSimulation).toISOString(),
          resume: { ...resultat.resume, dejaRetires },
          parametres: {
            seuilKm,
            niveau: zone?.niveau ?? 'national',
            unite: zone?.unite ?? null,
            factionId: faction.id,
          },
          perimetre: {
            factionId: faction.id,
            factionNom: faction.nom,
            factionLibelle: faction.libelle,
            barragesAnalyses: perimetre ? perimetre.deplacables.length : barragesPourSignature.filter((b) => !estIntouchable(b)).length,
            intouchablesProteges: perimetre ? perimetre.intouchables.length : barragesPourSignature.filter(estIntouchable).length,
            zone: zone ? { niveau: zone.niveau, unite: zone.unite } : null,
            zoneLibelle: libelleZone(zone),
            seuilKm,
          },
        });
        return true;
      }

      /**
       * ↶ RESTAURER AVANT SIMULATION — l'état d'AVANT la simulation en cours.
       *
       * Distinct de la référence de présentation (serveur/presentation.mjs) : rien
       * n'est lu ni écrit dans \`reference-presentation.json\`. L'INSTANTANÉ est
       * pris par le panneau au premier calcul d'une simulation : la copie exacte
       * de chaque barrage visible du compte (le modèle du dépôt, tel quel), et
       * l'heure. Il vit en mémoire du service, lié à l'auteur.
       *
       * RESTAURER : tant que rien n'a été activé, il n'y a rien à écrire — les
       * simulations ne touchent jamais le dépôt — et l'écran abandonne la sienne.
       * Si une activation a écrit pendant la simulation, les barrages concernés
       * reprennent EXACTEMENT leur copie d'avant, et les notifications de barrage
       * que CET auteur a créées depuis (retraits proposés, conservations) sont
       * retirées. En PRODUCTION, une écriture activée ne s'annule pas ici : le
       * refus le dit, et le circuit de validation reste le seul chemin.
       */
      if (chemin === '/api/optimisation/instantane' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const maintenantInst = Date.now();
        for (const [cle, x] of instantanesSimulation) if (maintenantInst - x.cree > 12 * 3600 * 1000) instantanesSimulation.delete(cle);
        const barragesInst = visibles(session, depot.tous()).filter(estBarrage);
        const id = randomUUID();
        instantanesSimulation.set(id, {
          cree: maintenantInst,
          auteur: JSON.stringify(identite(session)),
          matricule: session.matricule ?? null,
          barrages: JSON.parse(JSON.stringify(barragesInst)),
        });
        json(res, 200, { id, cree: new Date(maintenantInst).toISOString(), barrages: barragesInst.length });
        return true;
      }

      if (chemin === '/api/optimisation/restaurer-avant-simulation' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const corps = await lireCorps(req, res);
        const inst = instantanesSimulation.get(String(corps?.id ?? ''));
        if (!inst || inst.auteur !== JSON.stringify(identite(session))) {
          json(res, 404, { erreur: 'Aucune simulation à restaurer.' });
          return true;
        }
        const avantParId = new Map(inst.barrages.map((m) => [m.id, m]));
        const courantsInst = depot.tous();
        const presents = new Set(courantsInst.map((m) => m.id));
        const modifies = courantsInst.filter((m) => avantParId.has(m.id) && JSON.stringify(m) !== JSON.stringify(avantParId.get(m.id)));
        const disparus = inst.barrages.filter((m) => !presents.has(m.id));
        const depuis = new Date(inst.cree).toISOString();
        const notificationsSimulation = depotInstructions.tous().filter((i) => notificationDeBarrage(i) && i.cree > depuis &&
          avantParId.has(i.barrageId) && i.auteur?.matricule && i.auteur.matricule === inst.matricule);
        if (!modifies.length && !disparus.length && !notificationsSimulation.length) {
          /* Rien d'activé : la simulation se jette, le dépôt est déjà l'état d'avant. */
          for (const [cle, x] of simulationsOptimisation) if (x.auteur === inst.auteur) simulationsOptimisation.delete(cle);
          json(res, 200, { restaures: 0, retablis: 0, notificationsRetirees: 0, officielInchange: true, items: actifs(session) });
          return true;
        }
        if (mode !== MODES.DEMO) {
          json(res, 409, {
            code: 'activation_irreversible',
            erreur: `${modifies.length + disparus.length} barrage(s) ont été modifiés par une activation pendant cette simulation. ` +
              'En production, une modification activée ne s’annule pas ici : passez par le circuit de validation.',
          });
          return true;
        }
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }
        const modifiesIds = new Set(modifies.map((m) => m.id));
        depot.appliquerLot([
          ...courantsInst.map((m) => (modifiesIds.has(m.id) ? JSON.parse(JSON.stringify(avantParId.get(m.id))) : m)),
          ...disparus.map((m) => JSON.parse(JSON.stringify(m))),
        ]);
        const retirer = new Set(notificationsSimulation.map((i) => i.id));
        if (retirer.size) depotInstructions.restaurerLot(depotInstructions.tous().filter((i) => !retirer.has(i.id)));
        for (const [cle, x] of simulationsOptimisation) if (x.auteur === inst.auteur) simulationsOptimisation.delete(cle);
        recalculerSiPresent();
        recalculerConflitsSiPresent();
        const resume = { restaures: modifies.length, retablis: disparus.length, notificationsRetirees: retirer.size };
        journal.consigner({ session, action: 'restauration_avant_simulation', avant: null, apres: null, details: { ...resume, depuis } });
        json(res, 200, { ...resume, officielInchange: false, items: actifs(session) });
        return true;
      }

      /**
       * OUTILS DE PRÉSENTATION — référence et restauration du dispositif de
       * démonstration (voir serveur/presentation.mjs).
       *
       * Trois garde-fous, tous ici, aucun dans l'écran :
       *   - le MODE : seul un dossier marqué « demo » (mode.json, vérifié au
       *     démarrage) accepte ces routes — en production elles refusent ;
       *   - le RANG : administrateur seulement, avec droit d'écriture ;
       *   - la CONFIRMATION : le mot exact (« RESTAURER », « ENREGISTRER »)
       *     doit accompagner la demande.
       */
      if (chemin.startsWith('/api/presentation')) {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Outils de présentation réservés à l’administrateur.' });
          return true;
        }
        const enDemo = mode === MODES.DEMO;
        const etatPresentation = () => {
          const ref = referencePresentation.lire();
          return {
            mode,
            disponible: enDemo,
            reference: ref?.barrages
              ? {
                  cree: ref.cree, creePar: ref.creePar, motif: ref.motif ?? null,
                  barrages: ref.barrages.length, notifications: ref.instructions.length,
                  derniereRestauration: ref.restaurations?.at(-1) ?? null,
                  restaurations: ref.restaurations?.length ?? 0,
                }
              : null,
            ecarts: ref?.barrages ? {
              barrages: ecartsAvecReference(depot.tous(), ref.barrages, estBarrage),
              notifications: ecartsAvecReference(depotInstructions.tous(), ref.instructions, notificationDeBarrage, ['statut', 'decision']),
            } : null,
          };
        };

        if (chemin === '/api/presentation' && req.method === 'GET') {
          json(res, 200, etatPresentation());
          return true;
        }
        if (!enDemo) {
          json(res, 403, { erreur: 'Environnement de production : la référence de présentation n’existe pas ici, rien n’est restauré.' });
          return true;
        }
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        if (chemin === '/api/presentation/reference' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          if (corps?.confirmation !== 'ENREGISTRER') {
            json(res, 400, { erreur: 'Confirmation requise : saisissez ENREGISTRER.' });
            return true;
          }
          capturerReferencePresentation(identite(session), 'manuel');
          journal.consigner({ session, action: 'reference_presentation', avant: null, apres: null, details: { barrages: referencePresentation.lire().barrages.length } });
          json(res, 200, etatPresentation());
          return true;
        }

        if (chemin === '/api/presentation/restaurer' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          if (corps?.confirmation !== 'RESTAURER') {
            json(res, 400, { erreur: 'Confirmation requise : saisissez RESTAURER.' });
            return true;
          }
          const ref = referencePresentation.lire();
          if (!ref?.barrages) {
            json(res, 409, { erreur: 'Aucune référence de présentation enregistrée : rien à restaurer.' });
            return true;
          }
          const t0 = Date.now();
          const ecartsAvant = {
            barrages: ecartsAvecReference(depot.tous(), ref.barrages, estBarrage),
            notifications: ecartsAvecReference(depotInstructions.tous(), ref.instructions, notificationDeBarrage, ['statut', 'decision']),
          };
          /* 1. Les barrages, à l'identique ; le reste du dépôt n'est pas touché. */
          depot.appliquerLot(fusionnerAvecReference(depot.tous(), ref.barrages, ref.ordreMarquages, estBarrage));
          /* 2. Les notifications qui décrivent l'état d'un barrage : celles de la
                démonstration disparaissent, celles de la référence reviennent
                dans leur état d'alors. Instructions et réclamations restent. */
          depotInstructions.restaurerLot(
            fusionnerAvecReference(depotInstructions.tous(), ref.instructions, ref.ordreInstructions, notificationDeBarrage),
          );
          /* 3. Les alertes de la référence (et leurs acquittements), avant recalcul. */
          if (Array.isArray(ref.alertes)) depotAlertes.restaurerLot(JSON.parse(JSON.stringify(ref.alertes)));
          /* 4. Aucune simulation ne survit : elles décrivaient l'état démontré. */
          simulationsOptimisation.clear();
          /* 5. Le dérivé est recalculé sur les positions restaurées — même
                graphe routier, mêmes fonctions qu'après toute écriture. */
          recalculerSiPresent();
          recalculerConflitsSiPresent();
          const ts = new Date().toISOString();
          const resume = { ...ecartsAvant, dureeMs: Date.now() - t0 };
          referencePresentation.noterRestauration({ ts, par: identite(session), resume });
          journal.consigner({ session, action: 'restauration_presentation', avant: null, apres: null, details: resume });
          console.log(`[présentation] restauration — ${JSON.stringify(resume)}`);
          json(res, 200, { ...etatPresentation(), restauration: { ts, resume } });
          return true;
        }
        json(res, 404, { erreur: 'Route inconnue.' });
        return true;
      }

      /**
       * LES REPOSITIONNEMENTS RÉCENTS — le repère « barrage nouvellement posé »,
       * reconstruit à chaque chargement depuis ce que le serveur a DÉJÀ consigné.
       *
       * Aucun stockage nouveau, aucun état décidé par le navigateur :
       *   SAVED            — entrée `deplacer` du journal (écriture directe) ;
       *   APPROVED         — entrée `modifier` portant `details.demande` : une
       *                      demande acceptée par le commandement, qui a écrit
       *                      la position demandée ;
       *   PENDING_APPROVAL — demande `modification` OUVERTE dont les changements
       *                      touchent la position. Le poste officiel n'a pas bougé :
       *                      `avant` est sa position réelle, `apres` la demandée.
       * Une demande refusée ne laisse aucun repère. Seuls les postes visibles du
       * compte (RBAC) sont rendus, sur FENETRE_REPOSITIONNEMENT_MS.
       *
       * L'IMPACT — pour un changement OFFICIEL seulement (SAVED / APPROVED) : la
       * distance PAR LA ROUTE (`distanceReelleKm`, le graphe hors ligne et la
       * mesure de l'optimisation manuelle) entre le poste et chaque voisin qui
       * peut être en conflit, depuis l'ANCIENNE puis la NOUVELLE position. Une
       * demande en attente n'est pas mesurée : rien d'officiel n'a changé.
       */
      if (chemin === '/api/barrages/repositionnements' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const seuilDemande = Number(url.searchParams.get('seuilKm'));
        const seuilKm = Number.isFinite(seuilDemande) && seuilDemande >= 0.5 && seuilDemande <= 200 ? seuilDemande : SEUIL_DISTANCE_AUTO_KM;
        const factionDemandee = url.searchParams.get('factionId') || null;
        const visiblesParId = new Map(visibles(session, depot.tous()).filter(estBarrage).map((m) => [m.id, m]));
        const limite = Math.max(
          Date.now() - FENETRE_REPOSITIONNEMENT_MS,
          /* Une restauration ou une nouvelle référence repart d'un état propre :
             les repères d'avant ne décrivent plus rien de ce qui est à l'écran. */
          Date.parse(referencePresentation.derniereRestauration() ?? '') || 0,
          Date.parse(referencePresentation.lire()?.cree ?? '') || 0,
        );
        const pos = (p) => (p ? { lng: p.lng ?? null, lat: p.lat ?? null, route: p.route || '', pk: p.pk ?? null } : null);
        const qui = (a) => (a ? { matricule: a.matricule ?? null, nom: a.nom ?? null, rang: a.rang ?? null, unite: a.unite ?? null } : null);
        const parBarrage = new Map();

        /* Le plus récent d'abord : la première entrée d'un poste est sa dernière position écrite. */
        const ecrits = journal.dernieres(5000, (e) => Date.parse(e.ts) >= limite && e.id &&
          (e.action === 'deplacer' || (e.action === 'modifier' && e.details?.demande)) &&
          Boolean(e.change?.lng || e.change?.lat));
        for (const e of ecrits) {
          if (parBarrage.has(e.id)) continue;
          const m = visiblesParId.get(e.id);
          /* Le poste a rebougé depuis par un autre chemin : ce repère ne dit plus la vérité. */
          if (!m || m.lng !== e.apres?.lng || m.lat !== e.apres?.lat) { parBarrage.set(e.id, null); continue; }
          const demande = e.details?.demande ? depotInstructions.parId(e.details.demande) : null;
          parBarrage.set(e.id, {
            barrageId: e.id, nom: m.nom || e.libelle || e.id,
            statut: e.action === 'deplacer' ? 'SAVED' : 'APPROVED',
            ts: e.ts, avant: pos(e.avant), apres: pos(e.apres),
            auteur: demande ? qui(demande.auteur) : qui(e),
            validePar: demande ? qui(e) : null,
            demandeId: demande?.id ?? null, demandeLe: demande?.cree ?? null,
          });
        }
        for (const i of depotInstructions.tous()) {
          if (i.action !== 'modification' || i.statut !== 'ouverte' || Date.parse(i.cree) < limite) continue;
          const ch = Object.fromEntries((i.changements ?? []).map((c) => [c.champ, c]));
          if (!ch.lng && !ch.lat) continue;
          const m = visiblesParId.get(i.barrageId);
          if (!m) continue;
          /* La plus récente l’emporte — écriture officielle ou autre demande ouverte. */
          const deja = parBarrage.get(i.barrageId);
          if (deja && Date.parse(deja.ts) > Date.parse(i.cree)) continue;
          parBarrage.set(i.barrageId, {
            barrageId: i.barrageId, nom: m.nom || i.barrage?.nom || i.barrageId,
            statut: 'PENDING_APPROVAL', ts: i.cree,
            avant: pos(m),
            apres: {
              lng: ch.lng ? ch.lng.nouvelle : m.lng, lat: ch.lat ? ch.lat.nouvelle : m.lat,
              route: ch.route ? ch.route.nouvelle || '' : m.route || '', pk: ch.pk ? ch.pk.nouvelle ?? null : null,
            },
            auteur: qui(i.auteur), validePar: null, valideur: i.aDecider ?? null,
            demandeId: i.id, demandeLe: i.cree,
          });
        }

        const jour = dateLocale(new Date());
        const creneaux = depotElements.creneauxParBarrage(jour, jour);
        const autorises = barragesAutorisesOptimisation(session);
        const factionsDe = (m) => factionsDuBarrage(m, creneaux.get(m.id) ?? null);
        const mesurer = (m, avant) => {
          /* Les règles de l'optimisation : mêmes factions (deux postes de tours
             différents ne sont jamais tenus ensemble), Intouchables toujours
             présents, périmètre RBAC du compte. */
          const factionsM = factionsDe(m);
          const factions = factionDemandee && factionsM.includes(factionDemandee) ? [factionDemandee] : factionsM;
          const memes = autorises.filter((v) => v.id !== m.id &&
            (estIntouchable(m) || estIntouchable(v) || factionsDe(v).some((f) => factions.includes(f))));
          const arrondi = (km) => (km == null ? null : Math.round(km * 100) / 100);
          const mesures = new Map();
          const mesure = (v, cle, p) => {
            const e = mesures.get(v.id) ?? {};
            if (!(cle in e)) e[cle] = arrondi(distanceReelleKm(graphe, [p.lng, p.lat], [v.lng, v.lat]));
            mesures.set(v.id, e);
            return e[cle];
          };
          /* Un conflit exige une route sous le seuil, donc un vol d'oiseau sous
             le seuil : seuls ces voisins-là sont mesurés pour le conflit. */
          const volOiseau = (p, v) => distanceKm(p.lng, p.lat, v.lng, v.lat);
          for (const v of memes) {
            if (volOiseau(avant, v) < seuilKm || volOiseau(m, v) < seuilKm) { mesure(v, 'avantKm', avant); mesure(v, 'apresKm', m); }
          }
          /* Le plus proche par la route, comme `distancesPlusProche` : par vol
             d'oiseau croissant, arrêt dès qu'aucun candidat ne peut faire mieux. */
          const plusProche = (p, cle) => {
            let best = null;
            const tri = memes.map((v) => ({ v, d: volOiseau(p, v) })).filter((x) => x.d <= PORTEE_VOISIN_KM).sort((a, b) => a.d - b.d);
            for (const { v, d } of tri) {
              if (best && d >= best.km) break;
              const k = mesure(v, cle, p);
              if (k != null && (!best || k < best.km)) best = { id: v.id, nom: v.nom || v.id, km: k };
            }
            return best;
          };
          const pa = plusProche(avant, 'avantKm');
          const pb = plusProche(m, 'apresKm');
          const portee = PORTEE_VOISIN_KM;
          const voisins = [...mesures.keys()].map((id) => {
            const v = memes.find((x) => x.id === id);
            const avantKm = mesure(v, 'avantKm', avant);
            const apresKm = mesure(v, 'apresKm', m);
            const conflitAvant = avantKm != null && avantKm < seuilKm;
            const conflitApres = apresKm != null && apresKm < seuilKm;
            const t = conflitApres ? tracerEntrePostes(graphe, m, v, accrocher(graphe, m.lng, m.lat, 5), accrocher(graphe, v.lng, v.lat, 5)) : null;
            return {
              id: v.id, nom: v.nom || v.id, bt: v.bt ?? null, intouchable: estIntouchable(v),
              factionId: factions.find((f) => factionsDe(v).includes(f)) ?? factionsDe(v)[0] ?? null,
              avantKm, apresKm, conflitAvant, conflitApres,
              evolution: conflitAvant && !conflitApres ? 'resolu' : !conflitAvant && conflitApres ? 'nouveau' : conflitApres ? 'maintenu' : 'aucun',
              route: t && t.trace.length > 2 ? { km: arrondi(t.km), routes: t.routes, trace: t.trace } : null,
            };
          }).sort((x, y) => (x.apresKm ?? Infinity) - (y.apresKm ?? Infinity));
          const nb = (f) => voisins.filter(f).length;
          return {
            seuilKm, factions, porteeKm: portee,
            voisins: voisins.filter((v) => v.conflitAvant || v.conflitApres || v.id === pa?.id || v.id === pb?.id),
            plusProcheAvant: pa,
            plusProcheApres: pb,
            conflitsAvant: nb((v) => v.conflitAvant), conflitsApres: nb((v) => v.conflitApres),
            resolus: nb((v) => v.evolution === 'resolu'), nouveaux: nb((v) => v.evolution === 'nouveau'),
            statut: nb((v) => v.conflitApres) ? 'en_conflit' : 'conforme',
          };
        };

        const items = [...parBarrage.values()].filter(Boolean).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 40);
        for (const r of items) {
          if (r.statut === 'PENDING_APPROVAL') { r.impact = null; continue; }
          const m = visiblesParId.get(r.barrageId);
          r.impact = m && Number.isFinite(r.avant?.lng) ? mesurer(m, r.avant) : null;
        }
        json(res, 200, { seuilKm, factionId: factionDemandee, fenetreJours: FENETRE_REPOSITIONNEMENT_MS / 86_400_000, items });
        return true;
      }

      /**
       * UNE SIMULATION EST-ELLE ENCORE APPLICABLE ? — lecture seule.
       *
       * Les mêmes contrôles que l'application (propriété, âge, signature du
       * dispositif), rendus AVANT le clic : l'écran peut dire « cette
       * optimisation n'est plus valide » au lieu de laisser échouer l'activation.
       * L'application, elle, refait tous ses contrôles : ceci n'en dispense pas.
       */
      if (chemin === '/api/barrages/optimisation/simulation' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const sim = simulationsOptimisation.get(url.searchParams.get('id') ?? '');
        const repondre = (valide, raison = null) => {
          json(res, 200, {
            valide, raison,
            libelle: sim?.libelle ?? null,
            creee: sim ? new Date(sim.creee).toISOString() : null,
            zone: sim?.zoneLibelle ?? null,
            factionId: sim?.factionId ?? null,
          });
          return true;
        };
        if (!sim || sim.auteur !== JSON.stringify(identite(session))) return repondre(false, 'simulation inconnue pour cette session.');
        if (Date.now() - sim.creee > 30 * 60 * 1000) return repondre(false, 'la simulation a expiré (30 min).');
        const courants = sim.type === 'manuelle'
          ? ensembleManuel(session, sim.factionId, sim.jour).barrages
          : perimetreDeSimulation(session, sim).barrages;
        if (signatureOptimisation(courants) !== sim.signature) return repondre(false, 'les données ont changé depuis l’analyse.');
        return repondre(true);
      }

      if (chemin === '/api/barrages/appliquer-optimisation-auto' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (superviseur(session)) {
          json(res, 403, { erreur: REFUS_SUPERVISION });
          return true;
        }
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        const corps = await lireCorps(req, res);

        /**
         * ACTIVER UNE OPTIMISATION MANUELLE — les décisions simulées, revalidées.
         *
         * Le client n'envoie que l'identifiant de simulation et la liste des
         * décisions ; le serveur n'applique que ce qu'IL a simulé, et seulement
         * si rien n'a bougé depuis : propriété, âge, signature du dispositif,
         * existence, droits, Intouchables, zone, position routière (recalage),
         * puis conflits finaux — aucun nouveau conflit sous le seuil manuel.
         */
        if (corps.mode === 'manuel') {
          const sim = simulationsOptimisation.get(corps.simulationId);
          const obsoleteManuel = (raison) => {
            journaliserActivation(session, {
              statut: 'REFUSÉE', mode: 'MANUEL', simulation: sim?.libelle ?? null,
              zoneLibelle: sim?.zoneLibelle ?? null, factionId: sim?.factionId ?? null, raison,
            });
            json(res, 409, { erreur: `OPTIMISATION OBSOLÈTE — ${raison} Veuillez relancer l’analyse.` });
            return true;
          };
          if (!sim || sim.type !== 'manuelle' || Date.now() - sim.creee > 30 * 60 * 1000 ||
              sim.auteur !== JSON.stringify(identite(session))) {
            return obsoleteManuel('la simulation a expiré ou ne correspond pas à cette session.');
          }
          const envoyees = Array.isArray(corps.decisions) ? corps.decisions : [];
          const cleD = (d) => `${d.barrageId}|${d.type}`;
          if (envoyees.length !== sim.decisions.length ||
              JSON.stringify(envoyees.map(cleD).sort()) !== JSON.stringify(sim.decisions.map(cleD).sort())) {
            return obsoleteManuel('les décisions envoyées ne sont pas celles simulées par le serveur.');
          }
          const { barrages: courants } = ensembleManuel(session, sim.factionId, sim.jour);
          if (signatureOptimisation(courants) !== sim.signature) {
            simulationsOptimisation.delete(corps.simulationId);
            return obsoleteManuel('le dispositif a changé depuis l’analyse.');
          }
          let etatFinal = courants.map((b) => ({ ...b }));
          const positions = new Map();
          for (const d of sim.decisions) {
            const existant = depot.parId(d.barrageId);
            if (!existant || !courants.some((b) => b.id === d.barrageId)) return obsoleteManuel(`le barrage ${d.barrageId} n’existe plus.`);
            if (estIntouchable(existant) && d.type !== 'conserver') {
              json(res, 403, { erreur: REFUS_BARRAGE_INTOUCHABLE });
              return true;
            }
            if (['entree', 'sortie', 'porte'].includes(existant.positionVille) && d.type !== 'conserver') {
              json(res, 403, { erreur: 'Porte de ville protégée : seul « Conserver » est possible.' });
              return true;
            }
            if (!estIntouchable(existant) && !peutModifier(session, existant)) {
              json(res, 403, { erreur: motifRefus(session, existant) });
              return true;
            }
            if (sim.zone && existant[CHAMP_DU_NIVEAU[sim.zone.niveau]] !== sim.zone.unite) {
              return obsoleteManuel(`le barrage ${d.barrageId} n’est plus dans la zone analysée.`);
            }
            if (d.type === 'supprimer') etatFinal = etatFinal.filter((b) => b.id !== d.barrageId);
            if (d.type === 'deplacer') {
              const coordonnees = coordonneesValides({ lng: d.apres?.lng, lat: d.apres?.lat });
              if (!coordonnees || !(positionAutorisee(session, sim.zone, coordonnees) ||
                  (d.espace === 'adjacent' && dansEspaceAdjacent(session, sim.zone, coordonnees)))) {
                return obsoleteManuel(`le territoire de la position proposée pour ${d.barrageId} n’est pas autorisé.`);
              }
              const rattachement = rattacher(session, coordonnees);
              if (!rattachement?.bt) return obsoleteManuel(`la position proposée pour ${d.barrageId} n’a pas de rattachement territorial.`);
              const route = recalerPosition(graphe, coordonnees[0], coordonnees[1], { route: d.apres.route, rayonKm: 0.25 });
              if (route.erreur || Math.abs(route.lng - coordonnees[0]) > 0.00002 || Math.abs(route.lat - coordonnees[1]) > 0.00002 ||
                  route.route !== d.apres.route || Math.abs(Number(route.pk ?? 0) - Number(d.apres.pk ?? 0)) > 0.11) {
                return obsoleteManuel(`la route ou le PK de la position proposée pour ${d.barrageId} n’est plus valide.`);
              }
              positions.set(d.barrageId, { ...route, rattachement });
              etatFinal = etatFinal.map((b) => (b.id === d.barrageId ? { ...b, lng: route.lng, lat: route.lat } : b));
            }
          }
          /**
           * LES RÈGLES D'ACTIVATION — refusées avec LEUR raison, chiffrée.
           *
           * Ce n'est pas une simulation périmée : la position a été mesurée, et
           * elle ne tient pas la règle. Le dire « obsolète » renvoyait l'opérateur
           * relancer une analyse qui redonnerait le même refus. Le refus nomme
           * donc le poste, l'autre barrage, la distance par la route et le seuil.
           */
          const nomDe = (id) => courants.find((b) => b.id === id)?.nom || id;
          const refuserActivation = (raison, details = null) => {
            journaliserActivation(session, {
              statut: 'REFUSÉE', mode: 'MANUEL', simulation: sim.libelle, zoneLibelle: sim.zoneLibelle, factionId: sim.factionId, raison,
            });
            json(res, 409, { code: 'activation_refusee', erreur: `ACTIVATION REFUSÉE — ${raison}`, raison, details });
            return true;
          };
          /* Conflits finaux, au seuil manuel : aucune paire nouvelle. */
          const cle = (c) => [c.a, c.b].sort().join('|');
          const avantC = new Set(listerConflitsDistance(courants, graphe, { seuilKm: sim.seuilKm }).map(cle));
          const nouveau = listerConflitsDistance(etatFinal, graphe, { seuilKm: sim.seuilKm }).find((c) => !avantC.has(cle(c)));
          if (nouveau) {
            return refuserActivation(
              `la simulation crée un nouveau conflit : ${nomDe(nouveau.a)} ↔ ${nomDe(nouveau.b)} à ${nouveau.km.toFixed(1)} km par la route. Seuil : ${sim.seuilKm} km.`,
              { a: nouveau.a, b: nouveau.b, km: nouveau.km, seuilKm: sim.seuilKm },
            );
          }
          /* Un poste déplacé doit tenir le seuil de l'automatique contre TOUS les postes. */
          const deplacesIds = new Set([...positions.keys()]);
          const tropProche = deplacesIds.size
            ? listerConflitsDistance(etatFinal, graphe, { seuilKm: SEUIL_DISTANCE_AUTO_KM })
              .filter((c) => deplacesIds.has(c.a) || deplacesIds.has(c.b)).sort((x, y) => x.km - y.km)[0]
            : null;
          if (tropProche) {
            const deplace = deplacesIds.has(tropProche.a) ? tropProche.a : tropProche.b;
            const autre = deplace === tropProche.a ? tropProche.b : tropProche.a;
            return refuserActivation(
              `la position proposée pour ${nomDe(deplace)} est à ${tropProche.km.toFixed(1)} km de ${nomDe(autre)}. Seuil : ${SEUIL_DISTANCE_AUTO_KM} km.`,
              { barrageId: deplace, voisinId: autre, km: tropProche.km, seuilKm: SEUIL_DISTANCE_AUTO_KM },
            );
          }

          const bilan = { deplaces: 0, suppressionsProposees: 0, conserves: 0, deplacements: [] };
          for (const d of sim.decisions) {
            const existant = depot.parId(d.barrageId);
            journaliserDecision(session, {
              statut: 'ACTIVÉE', type: d.type, barrage: existant, zoneLibelle: sim.zoneLibelle, factionId: sim.factionId,
              simulation: sim.libelle, avant: d.avant ?? null, apres: d.apres ?? null,
              distanceAvantKm: d.distanceAvantKm ?? null, distanceApresKm: d.distanceApresKm ?? null,
              seuilKm: d.type === 'deplacer' ? SEUIL_DISTANCE_AUTO_KM : sim.seuilKm,
            });
            if (d.type === 'deplacer') {
              const position = positions.get(d.barrageId);
              const modifie = {
                ...existant,
                lng: position.lng, lat: position.lat, longitude: position.lng, latitude: position.lat,
                route: position.route, pk: position.pk, ...position.rattachement,
                majPar: identite(session), maj: new Date().toISOString(),
                optimisationManuelle: {
                  mode: 'MANUEL', critere: `distance_routiere_${sim.seuilKm}_km`, action: 'deplacer',
                  date: new Date().toISOString(),
                  avant: { lng: existant.lng, lat: existant.lat, route: existant.route || '', pk: existant.pk ?? null },
                  apres: d.apres, distanceAvantKm: d.distanceAvantKm ?? null, distanceApresKm: d.distanceApresKm ?? null,
                  appliquePar: identite(session),
                },
              };
              depot.remplacer(existant.id, modifie);
              journal.consigner({ session, action: 'deplacement_optimisation', avant: existant, apres: modifie, motif: 'optimisation_manuelle' });
              depotAlertes.supprimerConcernant(existant.id);
              depotConflitsPlanification.supprimerConcernant(existant.id);
              bilan.deplaces++;
              /* Le rattachement NOUVEAU : un poste posé dans l'espace adjacent quitte la zone affichée. */
              bilan.deplacements.push({ id: existant.id, nom: existant.nom || existant.id, espace: d.espace ?? 'zone', bt: modifie.bt ?? null, cie: modifie.cie ?? null, reg: modifie.reg ?? null });
            } else if (d.type === 'supprimer') {
              arbitrerBarrage(session, existant, 'proposer_suppression', {
                distanceKm: d.distanceAvantKm ?? null, seuilKm: sim.seuilKm, voisinNom: '', accidents: null, vip: null, nonEclaire: null,
              });
              bilan.suppressionsProposees++;
            } else if (d.type === 'conserver') {
              /* Un Intouchable est permanent : le conserver n'a rien à écrire. */
              if (!estIntouchable(existant)) {
                arbitrerBarrage(session, existant, 'conserver', {
                  distanceKm: d.distanceAvantKm ?? null, seuilKm: sim.seuilKm, voisinNom: '', accidents: null, vip: null, nonEclaire: null,
                });
              }
              bilan.conserves++;
            }
          }
          simulationsOptimisation.delete(corps.simulationId);
          if (bilan.deplaces) recalculerSiPresent();
          json(res, 200, { ...bilan, appliques: sim.decisions.length, items: actifs(session) });
          return true;
        }

        const propositions = Array.isArray(corps.propositions)
          ? corps.propositions
          : Array.isArray(corps.ids)
            ? corps.ids.map((id) => ({ id, ...(corps.motifs?.[id] || {}) }))
            : [];
        if (!propositions.length) {
          json(res, 400, { erreur: 'Aucune proposition à appliquer.' });
          return true;
        }
        if (new Set(propositions.map((p) => p.id)).size !== propositions.length) {
          json(res, 400, { erreur: 'Une proposition ne peut apparaître qu’une fois.' });
          return true;
        }

        const simulation = simulationsOptimisation.get(corps.simulationId);
        const obsolete = (raison) => {
          journaliserActivation(session, {
            statut: 'REFUSÉE', mode: 'AUTOMATIQUE', simulation: simulation?.libelle ?? null,
            zoneLibelle: simulation?.zoneLibelle ?? null, factionId: simulation?.factionId ?? null, raison,
          });
          json(res, 409, { erreur: `OPTIMISATION OBSOLÈTE — ${raison} Veuillez relancer l’analyse.` });
          return true;
        };
        if (!simulation || Date.now() - simulation.creee > 30 * 60 * 1000 ||
            simulation.auteur !== JSON.stringify(identite(session))) {
          return obsolete('la simulation a expiré ou ne correspond pas à cette session.');
        }
        const barragesCourants = perimetreDeSimulation(session, simulation).barrages;
        if (signatureOptimisation(barragesCourants) !== simulation.signature) {
          simulationsOptimisation.delete(corps.simulationId);
          return obsolete('le dispositif a changé depuis l’analyse.');
        }

        const plan = new Map(simulation.propositions.map((p) => [p.id, p]));
        const positionsValidees = new Map();
        const apresSimulation = new Map(barragesCourants.map((b) => [b.id, b]));
        for (const p of propositions) {
          const prevue = plan.get(p.id);
          const existant = depot.parId(p.id);
          if (!prevue || p.action !== 'deplacer' || !existant || estIntouchable(existant) ||
              !peutModifier(session, existant) ||
              JSON.stringify(p.apres) !== JSON.stringify(prevue.apres) ||
              JSON.stringify(p.avant) !== JSON.stringify(prevue.avant)) {
            return obsolete(`la proposition pour ${p.id} n’est pas celle calculée par le serveur.`);
          }
          const coordonnees = coordonneesValides({ lng: prevue.apres.lng, lat: prevue.apres.lat });
          if (!coordonnees || !(positionAutorisee(session, simulation.zone, coordonnees) ||
              (prevue.espace === 'adjacent' && dansEspaceAdjacent(session, simulation.zone, coordonnees)))) {
            return obsolete(`le territoire de la position proposée pour ${p.id} n’est pas autorisé.`);
          }
          /* Optimisation par route : la position reste sur le tracé analysé. */
          if (simulation.corridor && !simulation.corridor.corridor.surTrace(coordonnees)) {
            return obsolete(`la position proposée pour ${p.id} n’est plus sur le tracé ${simulation.corridor.libelle}.`);
          }
          const rattachement = rattacher(session, coordonnees);
          if (!rattachement?.bt) return obsolete(`la position proposée pour ${p.id} n’a pas de rattachement territorial.`);
          const route = recalerPosition(graphe, coordonnees[0], coordonnees[1], {
            route: prevue.apres.route, rayonKm: 0.25,
          });
          if (route.erreur || Math.abs(route.lng - coordonnees[0]) > 0.00002 ||
              Math.abs(route.lat - coordonnees[1]) > 0.00002 || route.route !== prevue.apres.route ||
              Math.abs(Number(route.pk ?? 0) - Number(prevue.apres.pk ?? 0)) > 0.11) {
            return obsolete(`la route ou le PK de la position proposée pour ${p.id} n’est plus valide.`);
          }
          positionsValidees.set(p.id, { ...route, rattachement });
          apresSimulation.set(p.id, {
            ...existant, lng: route.lng, lat: route.lat, route: route.route, pk: route.pk,
            bt: rattachement.bt, cie: rattachement.cie, reg: rattachement.reg,
          });
        }
        /* Une position dans l'espace adjacent se revalide aussi contre les postes
           fixes qui s'y trouvent AUJOURD'HUI. */
        const obstaclesApplication = simulation.propositions.some((p) => p.espace === 'adjacent')
          ? obstaclesAdjacents(session, simulation.factionId, simulation.jour, simulation.zone, new Set(barragesCourants.map((b) => b.id)))
          : [];
        const conflitsAvantApplication = listerConflitsDistance([...barragesCourants, ...obstaclesApplication], graphe);
        const conflitsApresApplication = listerConflitsDistance([...apresSimulation.values(), ...obstaclesApplication], graphe);
        const cleConflit = (a, b) => [a, b].sort().join('|');
        const existantsAvant = new Set(conflitsAvantApplication.map((c) => cleConflit(c.a, c.b)));
        if (conflitsApresApplication.some((c) => !existantsAvant.has(cleConflit(c.a, c.b)))) {
          return obsolete('la validation globale détecte un nouveau conflit de distance.');
        }
        const conflitsApresSet = new Set(conflitsApresApplication.map((c) => cleConflit(c.a, c.b)));
        if (propositions.some((p) => p.conflitAvant?.id &&
            conflitsApresSet.has(cleConflit(p.id, p.conflitAvant.id)))) {
          return obsolete('un conflit ciblé n’est plus résolu par la proposition.');
        }

        /**
         * QUI DOIT VALIDER LE RETRAIT — même règle que partout ailleurs.
         *
         * `validateurPour` dit exactement cela, mais il est déclaré deux mille
         * lignes plus bas, dans le même corps de fonction : le lire d'ici le
         * trouverait en zone morte. La règle est donc réécrite, à l'identique
         * et avec la même conséquence : un administrateur propose, le
         * commandement concerné tranche ; une unité propose, l'administration
         * tranche. Nul ne contresigne sa propre demande.
         */
        const validateurDuRetrait = (barrage) =>
          barrage?.bt ? (session.rang === 'admin' ? 'unite' : 'admin') : null;

        let traites = 0;
        const refuses = [];
        /** Ce que le rapport gardera de chaque poste réellement retiré. */
        const consignes = [];
        for (const p of propositions) {
          const existant = depot.parId(p.id);
          if (!existant) {
            refuses.push({ id: p.id, raison: 'introuvable' });
            continue;
          }
          if (existant.type !== 'barrage_fixe' && existant.type !== 'barrage_mobile') {
            refuses.push({ id: p.id, raison: 'repère non barrage' });
            continue;
          }
          if (!peutModifier(session, existant)) {
            refuses.push({ id: p.id, raison: motifRefus(session, existant) });
            continue;
          }

          /**
           * UNE SEULE ACTION ÉCRIT : LA RÉAFFECTATION DE FACTION.
           *
           * LE BARRAGE EST INTOUCHABLE, et cette route est l'endroit où cela
           * doit tenir. Elle acceptait auparavant `deplacer` : elle écrivait
           * alors `lng`, `lat`, `route`, et recalculait le rattachement. Ce
           * chemin n'est plus masqué — il est REFUSÉ. La différence compte :
           * une interface qui cache un bouton laisse passer une requête forgée
           * ou un client resté à l'ancienne version ; un refus serveur, non.
           *
           * Ce qui se réaffecte, c'est le TOUR DE SERVICE, et lui seul. Le
           * poste reste où il est, avec son type, son horaire, sa durée, son
           * statut et SES ÉLÉMENTS — on change quelle faction le tient.
           *
           * `conserver` n'écrit rien : c'est une décision de NE PAS bouger,
           * elle est déjà l'état du dépôt. L'envoyer reviendrait à réécrire
           * une fiche pour n'y rien changer, et à polluer le journal.
           */
          const action = p.action ?? 'changer_faction';
          if (action === 'deplacer') {
            const position = positionsValidees.get(p.id);
            if (!position) {
              refuses.push({ id: p.id, raison: 'position de simulation absente ou non validée' });
              continue;
            }
            const avant = {
              lng: existant.lng, lat: existant.lat, route: existant.route || '',
              pk: existant.pk ?? null, factionId: existant.factionId || '',
              bt: existant.bt ?? null, cie: existant.cie ?? null, reg: existant.reg ?? null,
            };
            const trace = {
              mode: 'AUTOMATIQUE', critere: `distance_routiere_${SEUIL_DISTANCE_AUTO_KM}_km`, action,
              date: new Date().toISOString(), avant, apres: p.apres,
              conflitAvant: p.conflitAvant ?? null, contraintes: p.contraintes ?? 0,
              appliquePar: identite(session),
            };
            const modifie = {
              ...existant,
              lng: position.lng, lat: position.lat,
              longitude: position.lng, latitude: position.lat,
              route: position.route, pk: position.pk,
              ...position.rattachement,
              majPar: identite(session), maj: new Date().toISOString(),
              optimisationAuto: trace,
            };
            depot.remplacer(existant.id, modifie);
            journal.consigner({
              session, action: 'deplacement_optimisation', avant: existant, apres: modifie,
              motif: 'optimisation_auto',
            details: {
                mode: 'AUTOMATIQUE', action, conflitAvant: p.conflitAvant ?? null,
                distanceAvantKm: p.conflitAvant?.km ?? null,
                distanceApresKm: p.distanceApresKm ?? null,
                positionAvant: { lng: avant.lng, lat: avant.lat, route: avant.route },
                positionApres: { lng: position.lng, lat: position.lat, route: position.route, pk: position.pk },
              },
            });
            depotAlertes.supprimerConcernant(existant.id);
            depotConflitsPlanification.supprimerConcernant(existant.id);
            journaliserDecision(session, {
              statut: 'ACTIVÉE', type: 'deplacer', mode: 'AUTOMATIQUE', barrage: existant,
              zoneLibelle: simulation.zoneLibelle ?? null, factionId: simulation.factionId, simulation: simulation.libelle ?? null,
              avant: { lng: avant.lng, lat: avant.lat, route: avant.route }, apres: { lng: position.lng, lat: position.lat, route: position.route },
              distanceAvantKm: p.conflitAvant?.km ?? null, distanceApresKm: p.distanceApresKm ?? null, seuilKm: SEUIL_DISTANCE_AUTO_KM,
            });
            consignes.push({
              id: existant.id, nom: existant.nom || '', action,
              routeAvant: avant.route, routeApres: position.route,
              factionAvant: avant.factionId || null, factionApres: avant.factionId || null,
              positionAvant: { lng: avant.lng, lat: avant.lat },
              positionApres: { lng: position.lng, lat: position.lat },
              distanceAvantKm: p.conflitAvant?.km ?? null,
              distanceApresKm: p.distanceApresKm ?? null,
              raison: p.raison ?? 'conflit de distance routière',
            });
            traites++;
            continue;
          }
          if (action === 'conserver') {
            refuses.push({ id: p.id, raison: 'maintien : rien à écrire' });
            continue;
          }
          if (action !== 'changer_faction') {
            refuses.push({ id: p.id, raison: REFUS_BARRAGE_INTOUCHABLE });
            continue;
          }

          const faction = factionParId(p.nouvelleFactionId);
          if (!faction) {
            refuses.push({ id: p.id, raison: 'faction proposée inconnue' });
            continue;
          }
          if (faction.id === (existant.factionId || '')) {
            refuses.push({ id: p.id, raison: 'faction inchangée : rien à écrire' });
            continue;
          }

          /**
           * L'ÉTAT D'AVANT, RECOPIÉ DANS LA FICHE — c'est ce qui rend le geste
           * réversible. Sans lui, « Restaurer » ne saurait pas quelle faction
           * rendre au poste. Position et horaire y figurent encore, non parce
           * qu'ils changent — ils ne changent plus jamais — mais parce que la
           * restauration et le rapport les relisent, et qu'un instantané
           * complet vaut mieux qu'un instantané partiel.
           */
          const avant = {
            lng: existant.lng,
            lat: existant.lat,
            route: existant.route || '',
            factionId: existant.factionId || '',
            debut: existant.debut || '',
            fin: existant.fin || '',
            statutBarrage: existant.statutBarrage || 'approuve',
          };

          const trace = {
            mode: 'AUTOMATIQUE',
            critere: `distance_routiere_${SEUIL_DISTANCE_AUTO_KM}_km`,
            action,
            date: new Date().toISOString(),
            raison: p.raison ?? '',
            avant,
            stats: p.stats ?? null,
            parametres: corps.parametres ?? null,
            appliquePar: identite(session),
          };

          /**
           * UN SEUL CHAMP MÉTIER EST ÉCRIT : `factionId`.
           *
           * NI `debut` NI `fin` NE SONT TOUCHÉS, et c'est délibéré. La
           * réaffectation écrivait auparavant les bornes de la faction
           * d'arrivée, ce qui changeait l'horaire du barrage — exactement ce
           * que le commandement a interdit. L'horaire du poste est une donnée
           * qui lui appartient ; la faction dit quelle équipe de service en
           * répond. Les deux sont désormais indépendantes dans la fiche.
           *
           * LES ÉLÉMENTS NE SONT PAS TOUCHÉS NON PLUS. Ils ne vivent pas ici :
           * ils sont dans le dépôt des relèves, et cette route n'y écrit pas
           * une ligne. C'est une propriété de structure, pas une promesse —
           * et `ecartInterdit` la vérifie tout de même ci-dessous.
           */
          const modifie = {
            ...existant,
            factionId: faction.id,
            optimisationAuto: trace,
            majPar: identite(session),
            maj: new Date().toISOString(),
          };

          /**
           * LE CONTRÔLE AVANT/APRÈS — la dernière garde, et celle qui fait foi.
           *
           * Les lignes ci-dessus ne copient qu'un champ ; ce contrôle le
           * VÉRIFIE. Il n'est pas redondant : il se place entre le calcul et
           * l'écriture, et il survivra à la prochaine main qui ajoutera un
           * champ au `modifie` sans y penser. Si l'identité, la position, le
           * type, l'horaire, la durée, le statut ou les éléments du barrage
           * diffèrent, RIEN N'EST ÉCRIT et le refus nomme le champ fautif.
           */
          const elementsAvant = depotElements.duBarrage(existant.id);
          const ecart = ecartInterdit(existant, modifie);
          if (ecart) {
            refuses.push({ id: p.id, raison: `optimisation refusée : ${ecart}` });
            continue;
          }

          depot.remplacer(existant.id, modifie);

          /**
           * ET LES ÉLÉMENTS ? RELUS, ET COMPARÉS.
           *
           * Cette route n'écrit pas une ligne dans le dépôt des relèves : les
           * hommes ne peuvent structurellement pas bouger. Le contrôle est
           * fait quand même, et l'écriture est DÉFAITE s'il échoue. Une
           * propriété que l'on tient pour acquise sans la vérifier est une
           * propriété que l'on perdra sans s'en apercevoir.
           */
          if (signatureElements(depotElements.duBarrage(existant.id)) !==
              signatureElements(elementsAvant)) {
            depot.remplacer(existant.id, existant);
            refuses.push({
              id: p.id,
              raison: 'optimisation annulée : les éléments du barrage auraient été modifiés',
            });
            continue;
          }

          journal.consigner({
            session,
            action: 'faction_optimisation',
            avant: existant,
            apres: modifie,
            motif: 'optimisation_auto',
            details: { mode: 'AUTOMATIQUE', action, raison: p.raison },
          });
          /**
           * LES RAPPROCHEMENTS ET CHEVAUCHEMENTS SONT RECALCULÉS.
           *
           * La POSITION n'a pas bougé — elle ne bouge plus jamais — mais le
           * tour de service, si : deux postes voisins qui se gênaient peuvent
           * ne plus être simultanés, et l'inverse. Les constats établis sous
           * l'ancienne affectation ne valent donc plus.
           */
          depotAlertes.supprimerConcernant(existant.id);
          depotConflitsPlanification.supprimerConcernant(existant.id);

          /**
           * LA VALIDATION N'EST PAS CONTOURNÉE — elle est demandée ici.
           *
           * La nouvelle faction est déjà écrite, mais rien n'est perdu : la
           * fiche porte son état d'avant, et tout est réversible. La
           * notification ouvre la décision de commandement, et c'est elle qui
           * conclut : ACCEPTER confirme la réaffectation, REFUSER rend au
           * poste sa faction d'origine (voir PATCH /api/instructions/:id).
           *
           * `aDecider` à `null` — un compte sans brigade rattachée — laisse la
           * notification informative, exactement comme pour une suppression
           * ordinaire dans le même cas.
           */
          const texteAction =
            `Réaffectation de faction par optimisation automatique de ${existant.nom || 'ce poste'} ` +
            `(${avant.factionId || 'aucune'} → ${modifie.factionId}) — ` +
            `${p.raison || 'conflit d’affectation'}. Le barrage n’a pas été modifié : ` +
            'position, type, horaire, durée, statut et éléments inchangés.';

          depotInstructions.creer({
            barrageId: existant.id,
            barrage: modifie,
            action: 'retrait_optimisation',
            source: 'optimisation_auto',
            aDecider: validateurDuRetrait(existant),
            texte: texteAction,
            criteres: p.stats ?? null,
            auteur: identite(session),
          });

          /**
           * CE QUE LE RAPPORT GARDE — et ce qu'il n'a plus à garder.
           *
           * Il portait une position d'avant et une position d'après. Il n'y a
           * plus d'après : la position est unique, et elle est celle du poste.
           * `elementsInchanges` n'est pas décoratif — c'est le résultat du
           * contrôle qui vient d'être fait, consigné pour qui relira le
           * rapport dans six mois.
           */
          consignes.push({
            id: existant.id,
            nom: existant.nom || '',
            action,
            route: existant.route || '',
            bt: existant.bt ?? null,
            cie: existant.cie ?? null,
            reg: existant.reg ?? null,
            factionAvant: avant.factionId || null,
            factionApres: modifie.factionId || null,
            lng: existant.lng,
            lat: existant.lat,
            horaire: `${existant.debut || '—'} → ${existant.fin || '—'}`,
            elements: elementsAvant.length,
            elementsInchanges: true,
            minutesAvant: p.minutesAvant ?? null,
            minutesApres: p.minutesApres ?? null,
            raison: p.raison ?? null,
          });

          traites++;
        }

        if (traites === 0 && refuses.length > 0) {
          json(res, 403, {
            erreur: 'Aucun barrage n’a pu être optimisé : autorisations insuffisantes.',
            refuses,
          });
          return true;
        }

        /**
         * LE RAPPORT — écrit une fois, à l'APPLICATION, jamais au calcul.
         *
         * Ses chiffres viennent du résumé de la simulation qui a été appliquée
         * (`corps.resume`), et la liste des postes de ce qui a RÉELLEMENT été
         * traité — pas de ce qui avait été proposé : entre les deux, des
         * refus d'autorisation ont pu écarter des lignes.
         */
        let rapport = null;
        if (traites > 0) {
          const resume = corps.resume ?? {};
          rapport = depotRapportsOptimisation.creer({
            auteur: identite(session),
            perimetre: {
              niveau: corps.parametres?.niveau ?? 'national',
              unite: corps.parametres?.unite ?? null,
            },
            parametres: corps.parametres ?? null,
            poids: corps.poids ?? null,
            criteres: Array.isArray(corps.criteres)
              ? corps.criteres
              : [`distance routière < ${SEUIL_DISTANCE_AUTO_KM} km`, 'contraintes opérationnelles', 'RBAC territorial'],
            avant: resume.barragesAnalyses ?? resume.barragesActuels ?? null,
            apres: resume.barragesAnalyses ?? resume.barragesActuels ?? null,
            /**
             * ANALYSÉS / PROPOSÉS / VALIDÉS — trois nombres, jamais un seul.
             *
             * L'utilisateur choisit quels retraits appliquer : sur 35 postes
             * proposés il peut n'en valider que 12. Un rapport qui ne dirait
             * que « 12 retirés » perdrait le fait que 23 propositions ont été
             * écartées à la main — c'est-à-dire l'essentiel de la décision.
             */
            analyses: resume.barragesActuels ?? null,
            proposes: resume.deplacements ?? resume.proposes ?? traites,
            retires: 0,
            proteges: resume.proteges ?? null,
            couvertureAvant: resume.couvertureAvant ?? null,
            couvertureApres: resume.couvertureApres ?? null,
            barrages: consignes,
            refuses,
          });
          recalculerSiPresent();
        }

        json(res, 200, { traites, appliques: traites, refuses, rapport, items: actifs(session) });
        return true;
      }

      /**
       * L'HISTORIQUE DES OPTIMISATIONS — consultable, jamais recalculé.
       *
       * Chaque rapport est figé (voir rapportsOptimisation.mjs) : on lit ce qui
       * a été décidé, pas ce que le même calcul donnerait aujourd'hui.
       *
       * Le filtre de périmètre reprend celui du rang : un chef de région ne lit
       * que les optimisations portant sur sa région. L'administrateur les lit
       * toutes.
       */
      if (chemin === '/api/barrages/rapports-optimisation' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const impose = perimetreDuRang(session);
        const tous = depotRapportsOptimisation.tous();
        const rapports = impose?.unite
          ? tous.filter(
              (r) =>
                r.perimetre?.unite === impose.unite ||
                (r.barrages ?? []).some((b) => b[impose.champ] === impose.unite),
            )
          : tous;
        json(res, 200, { rapports: [...rapports].reverse() });
        return true;
      }

      if (chemin === '/api/barrages/retires-optimisation' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        /**
         * TOUT CE QU'UNE OPTIMISATION A TOUCHÉ, et pas seulement les retirés.
         *
         * Depuis que l'optimisation déplace et réaffecte, un poste optimisé
         * garde son statut : il est toujours en service, simplement ailleurs ou
         * sur un autre tour de service. Ne lister que `retire_optimisation`
         * rendait ces postes irréversibles en pratique — rien ne les montrait,
         * donc rien ne permettait de les restaurer.
         */
        let retires = visibles(session, depot.tous()).filter(
          (m) => m.statutBarrage === 'retire_optimisation' || m.optimisationAuto != null,
        );
        const niv = url.searchParams.get('niveau');
        const unit = url.searchParams.get('unite');
        if (niv && unit && CHAMP_DU_NIVEAU[niv]) {
          retires = retires.filter((m) => m[CHAMP_DU_NIVEAU[niv]] === unit);
        }
        json(res, 200, { barrages: retires });
        return true;
      }

      /**
       * RENDRE UN POSTE À SON ÉTAT D'AVANT L'OPTIMISATION.
       *
       * UNE SEULE façon de restaurer, pour DEUX chemins qui y mènent : le
       * bouton « Restaurer » du panneau, et le REFUS du commandement sur la
       * demande de validation (voir PATCH /api/instructions/:id). Écrite deux
       * fois, elle aurait fini par rendre deux états différents selon la porte
       * empruntée.
       *
       * Le poste n'a jamais été effacé : il retrouve son statut d'avant
       * (`etatAvant`, `approuve` à défaut), perd sa marque d'optimisation et
       * garde absolument tout le reste — position, rattachement, accidents,
       * éclairage, auteur, date de création. Rien à ressaisir.
       */
      const restaurerDepuisOptimisation = (existant, session, motif) => {
        const statutRestaure =
          existant.etatAvant &&
          existant.etatAvant !== 'retire_optimisation' &&
          existant.etatAvant !== 'supprime'
            ? existant.etatAvant
            : 'approuve';

        /**
         * LA POSITION ET LA FACTION D'AVANT, quand l'optimisation les a
         * changées.
         *
         * Depuis que l'optimisation DÉPLACE et RÉAFFECTE au lieu de retirer,
         * rendre le seul statut ne suffit plus : un poste déplacé de vingt
         * kilomètres serait « restauré » à sa nouvelle position, c'est-à-dire
         * pas restauré du tout. `optimisationAuto.avant` porte l'état
         * d'origine, recopié au moment d'appliquer — c'est lui qui fait foi.
         *
         * Un poste retiré par une optimisation ANTÉRIEURE n'a pas ce bloc : la
         * restauration retombe alors sur l'ancien comportement, et c'est bien
         * ce qu'il faut — sa position n'avait pas bougé.
         */
        const avant = existant.optimisationAuto?.avant ?? null;
        const rendu = avant
          ? {
              lng: avant.lng ?? existant.lng,
              lat: avant.lat ?? existant.lat,
              route: avant.route ?? existant.route,
              /* Le PK suit la route rendue : sans lui, le poste revenu à sa
                 place garderait le PK de sa position déplacée. */
              pk: avant.pk !== undefined ? avant.pk : existant.pk,
              ...(avant.lng != null && avant.lat != null ? { longitude: avant.lng, latitude: avant.lat } : {}),
              factionId: avant.factionId ?? existant.factionId,
              debut: avant.debut ?? existant.debut,
              fin: avant.fin ?? existant.fin,
              /* Le rattachement suit la position rendue, il ne se devine pas. */
              ...(avant.lng != null && avant.lat != null
                ? rattacher(session, [avant.lng, avant.lat])
                : {}),
            }
          : {};

        const restaure = {
          ...existant,
          ...rendu,
          statutBarrage: statutRestaure,
          etatAvant: null,
          decisionOptimisation: 'aucune',
          optimisationAuto: null,
          supprimeLe: null,
          supprimePar: null,
          majPar: identite(session),
          maj: new Date().toISOString(),
        };

        depot.remplacer(existant.id, restaure);
        journal.consigner({
          session,
          action: 'restauration_optimisation',
          avant: existant,
          apres: restaure,
          motif,
          details: { mode: 'AUTOMATIQUE' },
        });
        /* ET DANS L'HISTORIQUE DES OPTIMISATIONS — voir la note de
           `consignerRestauration` : sans cette ligne, l'historique annonçait
           des retraits que plus rien ne venait défaire. */
        depotRapportsOptimisation.consignerRestauration({
          auteur: identite(session),
          barrage: restaure,
          motif,
        });
        return restaure;
      };

      const matchRestaurer = chemin.match(/^\/api\/barrages\/([\w-]+)\/restaurer-optimisation$/);
      if (matchRestaurer && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (superviseur(session)) {
          json(res, 403, { erreur: REFUS_SUPERVISION });
          return true;
        }
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        const id = matchRestaurer[1];
        const existant = depot.parId(id);
        if (!existant) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }
        if (!peutModifier(session, existant)) {
          json(res, 403, { erreur: motifRefus(session, existant) });
          return true;
        }

        const restaure = restaurerDepuisOptimisation(existant, session, 'restauration_optimisation');

        depotInstructions.creer({
          barrageId: existant.id,
          barrage: restaure,
          action: 'restauration_optimisation',
          source: 'optimisation_auto',
          texte: 'Barrage restauré du statut RETIRÉ_PAR_OPTIMISATION',
          auteur: identite(session),
        });

        recalculerSiPresent();
        json(res, 200, { barrage: restaure, restaure, items: actifs(session) });
        return true;
      }

      /**
       * BARRAGES SYNTHÉTIQUES — GÉNÉRATION ET GESTION
       */
      if (chemin === '/api/barrages/synthetiques' && req.method === 'GET') {
        const tous = depot.tous();
        const synthetiques = tous.filter((m) => m.isSynthetic === true);
        const fixes = synthetiques.filter((m) => m.type === 'FIXED').length;
        const permanents = synthetiques.filter((m) => m.type === 'FIXED_PERMANENT').length;
        const eclaires = synthetiques.filter((m) => m.isLighted).length;
        json(res, 200, {
          total: synthetiques.length,
          fixes,
          permanents,
          eclaires,
          items: synthetiques,
        });
        return true;
      }

      if (chemin === '/api/barrages/synthetiques/generer' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Génération réservée aux administrateurs.' });
          return true;
        }

        const corps = await lireCorps(req, res);
        const graine = Number(corps.graine ?? 20261027);
        const nombre = Number(corps.nombre ?? 120);
        const ratioPermanent = Number(corps.ratioPermanent ?? 0.25);
        const espacementKm = Number(corps.espacementKm ?? 4.0);
        const dryRun = corps.dryRun === true;
        const remplacer = corps.remplacer !== false;

        const existants = depot.tous();
        const reels = existants.filter((m) => !m.isSynthetic);

        const { barrages, statistiques } = genererBarragesFixesSynthetiques({
          racineCouches,
          graine,
          nombre,
          ratioPermanent,
          espacementKm,
          existantItems: reels,
          plagesAccidents: corps.plagesAccidents ?? PLAGES_ACCIDENTS_DEFAUT,
        });

        if (!dryRun) {
          const nouveauxItems = remplacer ? [...reels, ...barrages] : [...existants, ...barrages];
          depot.appliquerLot(nouveauxItems);
          recalculerSiPresent();
        }

        json(res, 200, {
          statut: 'succes',
          dryRun,
          statistiques,
          total: barrages.length,
          items: barrages,
        });
        return true;
      }

      if (chemin === '/api/barrages/synthetiques' && req.method === 'DELETE') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Purge réservée aux administrateurs.' });
          return true;
        }

        const existants = depot.tous();
        const reels = existants.filter((m) => !m.isSynthetic);
        const nbSuppr = existants.length - reels.length;
        depot.appliquerLot(reels);
        recalculerSiPresent();
        json(res, 200, {
          statut: 'succes',
          supprimes: nbSuppr,
          restants: reels.length,
        });
        return true;
      }

      /**
       * La génération est déclarée AVANT la route par identifiant, pour la
       * même raison que l'import juste en dessous : `generer` serait sinon
       * cherché comme un identifiant de marquage.
       */
      if (chemin === '/api/marquages/generer' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        if (!graphe) {
          json(res, 409, {
            erreur:
              'Réseau routier indisponible : lancez « npm run build:roads » pour produire graphe_routier.json.',
          });
          return true;
        }

        const corps = await lireCorps(req, res);
        const type = BARRAGES.includes(corps.type) ? corps.type : 'barrage_fixe';

        /**
         * Génération MANUELLE d'un seul barrage depuis un point noir précis
         * (bouton dans sa fiche, panneau Saisie) : aucun filtre d'importance
         * ni de distance minimale ne s'applique ici — contrairement à la
         * génération en masse plus bas, c'est un choix humain déjà délibéré
         * sur CE point noir précis, pas une sélection automatique à affiner.
         */
        if (typeof corps.pointNoirId === 'string' && corps.pointNoirId) {
          const candidat = depot.parId(corps.pointNoirId);
          if (!candidat || candidat.type !== 'accident') {
            json(res, 404, { erreur: 'Point noir introuvable.' });
            return true;
          }
          if (!peutModifier(session, candidat)) {
            json(res, 403, { erreur: 'Ce point noir est hors de votre périmètre.' });
            return true;
          }
          // Un seul barrage par point noir — voir `origineId`.
          if (depot.tous().some((b) => estBarrage(b) && b.origineId === candidat.id)) {
            json(res, 409, { erreur: 'Un barrage a déjà été généré depuis ce point noir.' });
            return true;
          }

          const acc = accrocherRoute(graphe, candidat.lng, candidat.lat);
          const pt = acc ? [acc.lng, acc.lat] : [candidat.lng, candidat.lat];

          const viaAssistant = corps.viaAssistant === true;
          const item = normaliser(
            {
              type,
              route: acc?.route ?? '',
              note: viaAssistant
                ? `Suggéré par l'Assistant depuis le point noir « ${candidat.nom || candidat.route || 'sans nom'} ».`
                : `Généré manuellement depuis le point noir « ${candidat.nom || candidat.route || 'sans nom'} ».`,
              lng: pt[0],
              lat: pt[1],
              origineId: candidat.id,
              viaAssistant,
              accidentCount: candidat.accidentCount,
              severite: candidat.severite,
              activite: candidat.activite,
              infraction: candidat.infraction,
              positionVille: candidat.positionVille,
              eclairage: candidat.eclairage,
            },
            { id: nouvelId(), ...rattacher(session, pt), auteur: identite(session) },
          );

          depot.ajouter(item);
          journal.consigner({ session, action: 'creer', avant: null, apres: item });
          recalculerSiPresent(item.id);
          recalculerConflitsSiPresent();
          json(res, 201, { generes: [item] });
          return true;
        }

        const nombrePositif = (v) =>
          Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
        const seuilAccidentsMin = nombrePositif(corps.seuilAccidentsMin ?? corps.seuilAccidents);
        const seuilAccidentsMax = nombrePositif(corps.seuilAccidentsMax);

        // Deux distances distinctes (voir genererBarrages dans distances.mjs) : celle vis-à-vis
        // des barrages déjà en place, et celle entre points noirs retenus dans cette génération.
        const distanceBarragesKm =
          Number.isFinite(Number(corps.minDistanceKm)) && Number(corps.minDistanceKm) > 0
            ? Number(corps.minDistanceKm)
            : seuilBarragesKm;
        const distancePointsKm =
          Number.isFinite(Number(corps.distancePointsKm)) && Number(corps.distancePointsKm) > 0
            ? Number(corps.distancePointsKm)
            : distanceBarragesKm;

        // Filtre proposé au chef avant la génération (voir GenerationFiltre côté client) :
        // mêmes critères que le badge « important », mais réglables pour cette génération.
        const NIVEAUX = ['low', 'medium', 'high'];
        const seuilActivite = NIVEAUX.includes(corps.seuilActivite)
          ? corps.seuilActivite
          : undefined;
        const seuilInfraction = NIVEAUX.includes(corps.seuilInfraction)
          ? corps.seuilInfraction
          : undefined;
        const considererPositionVille = corps.considererPositionVille !== false;

        const existants = depot.tous().filter(estBarrage);
        // Un seul barrage par point noir : un point déjà couvert (voir `origineId`)
        // ne redevient pas candidat à chaque nouvelle génération en masse.
        const dejaCouverts = new Set(existants.map((b) => b.origineId).filter(Boolean));

        const candidats = depot.tous().filter(
          (m) =>
            m.type === 'accident' &&
            !dejaCouverts.has(m.id) &&
            peutModifier(session, m) &&
            estImportant(m, {
              seuilAccidentsMin,
              seuilAccidentsMax,
              seuilActivite,
              seuilInfraction,
              considererPositionVille,
            }),
        );

        const { retenus, ecartes } = genererBarrages(
          candidats,
          existants,
          graphe,
          distanceBarragesKm,
          distancePointsKm,
        );

        /**
         * Aperçu (`apercu: true`) : calcule exactement ce qui SERAIT généré —
         * même sélection, même accroche à la route — sans rien écrire ni
         * recalculer les alertes. Le client l'appelle à chaque réglage du
         * filtre pour montrer les points noirs qui deviendraient des
         * barrages avant de s'engager.
         */
        const enApercu = corps.apercu === true;

        const generes = retenus.map((candidat) => {
          const acc = accrocherRoute(graphe, candidat.lng, candidat.lat);
          const pt = acc ? [acc.lng, acc.lat] : [candidat.lng, candidat.lat];

          const item = normaliser(
            {
              type,
              route: acc?.route ?? '',
              note: `Généré depuis un point noir important (score ${scoreImportance(candidat)}, ${candidat.accidentCount ?? 0} accident(s)).`,
              lng: pt[0],
              lat: pt[1],
              origineId: candidat.id,
              // Critères du point noir d'origine, conservés sur le barrage lui-même : le
              // panneau Filtrer peut ainsi retrouver les barrages « importants » avec les
              // mêmes critères que les points noirs, même si le point noir source est
              // ensuite modifié ou supprimé (voir `estImportant`, générique aux deux natures).
              accidentCount: candidat.accidentCount,
              severite: candidat.severite,
              activite: candidat.activite,
              infraction: candidat.infraction,
              positionVille: candidat.positionVille,
              eclairage: candidat.eclairage,
            },
            {
              id: nouvelId(),
              ...rattacher(session, pt),
              auteur: identite(session),
            },
          );

          if (!enApercu) {
            depot.ajouter(item);
            journal.consigner({ session, action: 'creer', avant: null, apres: item });
          }
          return item;
        });

        if (!enApercu) {
          recalculerSiPresent();
          recalculerConflitsSiPresent();
        }
        json(res, 201, { apercu: enApercu, generes, consideres: candidats.length, ecartes });
        return true;
      }

      /**
       * L'import est déclaré AVANT la route par identifiant : `[\w-]+` accepte
       * aussi le mot « import », qui serait alors cherché comme un marquage et
       * répondrait « introuvable ». L'ordre est donc porteur de sens ici.
       */
      if (chemin === '/api/marquages/import' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!peutEcrire(session)) {
          json(res, 403, { erreur: 'Compte en lecture seule : aucune écriture autorisée.' });
          return true;
        }

        const corps = await lireCorps(req, res);
        const entrants = Array.isArray(corps.items) ? corps.items : [];

        const bilan = { ajoutes: 0, remplaces: 0, ignores: 0, refuses: 0 };
        const actuels = new Map(depot.tous().map((m) => [m.id, m]));

        for (const brut of entrants) {
          /* MÊMES BORNES QU'À LA POSE. Un fichier d'import vient de
             l'extérieur : c'est la porte la plus exposée du service, et elle
             se contentait de « c'est un nombre fini » — donc (0,0) passait,
             comme une latitude de 999. Voir `coordonneesValides`. */
          const pt = coordonneesValides(brut);
          if (!pt || !TYPES.includes(brut.type)) {
            bilan.refuses++;
            continue;
          }

          // Même règle qu'à la pose : rien n'entre hors du périmètre.
          if (controler(circonscriptions, session, pt) !== 'autorise') {
            bilan.refuses++;
            continue;
          }

          const ancien = typeof brut.id === 'string' ? actuels.get(brut.id) : null;

          if (ancien && !peutModifier(session, ancien)) {
            bilan.refuses++;
            continue;
          }

          /* Un import ne doit pas être une porte dérobée : introduire un point
             noir INÉDIT relève de l'administrateur, comme à la pose. Mettre à
             jour un point noir déjà présent reste permis à qui peut le
             modifier — c'est le cas `ancien` traité juste au-dessus. */
          if (!ancien && !peutPoserPointNoir(session, brut.type)) {
            bilan.refuses++;
            continue;
          }

          // À identifiant égal, la version la plus récente gagne.
          if (ancien && (brut.maj ?? '') <= (ancien.maj ?? '')) {
            bilan.ignores++;
            continue;
          }

          const item = normaliser(brut, {
            id: ancien?.id ?? (typeof brut.id === 'string' && brut.id ? brut.id : nouvelId()),
            ...rattacher(session, pt),
            auteur: ancien?.auteur ?? identite(session),
            cree: ancien?.cree ?? brut.cree,
          });
          item.majPar = identite(session);

          /* Un import ne doit pas introduire d'orphelin non plus : hors
             territoire, l'entité serait ingérable (voir `rattachementManquant`). */
          if (rattachementManquant(item)) {
            bilan.refuses++;
            continue;
          }

          if (!estValide(item)) {
            bilan.refuses++;
            continue;
          }

          actuels.set(item.id, item);
          ancien ? bilan.remplaces++ : bilan.ajoutes++;
        }

        depot.appliquerLot([...actuels.values()]);
        recalculerSiPresent();
        recalculerConflitsSiPresent();
        json(res, 200, { bilan, items: actifs(session) });
        return true;
      }

      /* ------------------- alertes de distance ----------------- */
      if (chemin === '/api/alertes-distance' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const toutesAlertes = depotAlertes.tous();
        const alertesVisibles =
          !session || session.rang === 'admin'
            ? toutesAlertes
            : toutesAlertes.filter((al) => {
                const a = depot.parId(al.checkpointAId);
                const b = depot.parId(al.checkpointBId);
                return a && b && dansSonUnite(session, a) && dansSonUnite(session, b);
              });
        json(res, 200, { items: alertesVisibles, reseauRoutier: !!graphe });
        return true;
      }

      const acquit = chemin.match(/^\/api\/alertes-distance\/([\w-]+)\/acquitter$/);
      if (acquit && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const alerte = depotAlertes.parId(acquit[1]);
        if (!alerte) {
          json(res, 404, { erreur: 'Alerte introuvable.' });
          return true;
        }

        const a = depot.parId(alerte.checkpointAId);
        const b = depot.parId(alerte.checkpointBId);
        const autorise = (a && peutModifier(session, a)) || (b && peutModifier(session, b));
        if (!autorise) {
          json(res, 403, {
            erreur: 'Aucun des deux barrages de cette alerte ne relève de votre autorité.',
          });
          return true;
        }

        const { comment } = await lireCorps(req, res);
        const majee = depotAlertes.acquitter(acquit[1], { parId: identite(session), comment });
        json(res, 200, { alerte: majee });
        return true;
      }

      /* ------------------- conflits de planification ----------------- */
      if (chemin === '/api/conflits-planification' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const tousConflits = depotConflitsPlanification.tous();
        const conflitsVisibles =
          !session || session.rang === 'admin'
            ? tousConflits
            : tousConflits.filter((c) => {
                const a = depot.parId(c.checkpointAId);
                const b = c.checkpointBId ? depot.parId(c.checkpointBId) : null;
                if (!a || !dansSonUnite(session, a)) return false;
                return !c.checkpointBId || (b && dansSonUnite(session, b));
              });
        json(res, 200, { items: conflitsVisibles });
        return true;
      }

      const acquitConflit = chemin.match(/^\/api\/conflits-planification\/([\w-]+)\/acquitter$/);
      if (acquitConflit && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const conflit = depotConflitsPlanification.parId(acquitConflit[1]);
        if (!conflit) {
          json(res, 404, { erreur: 'Conflit introuvable.' });
          return true;
        }

        const a = depot.parId(conflit.checkpointAId);
        const b = conflit.checkpointBId ? depot.parId(conflit.checkpointBId) : null;
        const autorise = (a && peutModifier(session, a)) || (b && peutModifier(session, b));
        if (!autorise) {
          json(res, 403, {
            erreur: 'Aucun des barrages de ce conflit ne relève de votre autorité.',
          });
          return true;
        }

        const { comment } = await lireCorps(req, res);
        const majee = depotConflitsPlanification.acquitter(acquitConflit[1], {
          parId: identite(session),
          comment,
        });
        json(res, 200, { conflit: majee });
        return true;
      }

      /* ------------------- suivi des conflits réels ------------------- */
      if ((chemin === '/api/conflits' || chemin === '/api/conflits/') && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const statut = url.searchParams.get('statut') || null;
        /* LES LISTES ACTIVES N'ONT PAS DE CONFLIT CLOS : ceux-là sont dans
           l'historique (GET /api/conflits/historique). Chaque conflit porte
           `workflow` — sa file pour CETTE session et les actions qu'elle y a :
           l'interface n'a pas à recalculer les droits. */
        const tousVisibles = depotSuiviConflits.visiblesPour(session);
        const visibles = depotSuiviConflits.visiblesPour(session, { statut })
          .filter((c) => !estClos(c))
          .map((c) => ({ ...c, workflow: presenterWorkflow(c, session) }));
        const compteurs = compterSections(tousVisibles, session);
        json(res, 200, {
          items: visibles,
          compteurs,
          sections: LIBELLES_SECTIONS,
          /* Paires closes : l'interface ne les reprend pas comme « nouveaux »
             conflits quand l'optimisation les redétecte. */
          clos: tousVisibles.filter((c) => estClos(c)).map((c) => ({ id: c.id, paireCle: c.paireCle, clotureLe: c.clotureLe ?? null })),
          supprimes: depotSuiviConflits.supprimes ? depotSuiviConflits.supprimes() : [],
          totaux: {
            nouveau: tousVisibles.filter((c) => c.statut === 'nouveau').length,
            a_traiter: tousVisibles.filter((c) => c.statut === 'a_traiter').length,
            en_cours: tousVisibles.filter((c) => c.statut === 'en_cours').length,
            resolu: tousVisibles.filter((c) => c.statut === 'resolu').length,
            total: tousVisibles.length,
          },
        });
        return true;
      }

      /* HISTORIQUE des conflits définitivement approuvés — lecture seule, filtrée. */
      if ((chemin === '/api/conflits/historique' || chemin === '/api/conflits/historique/') && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const p = (k) => url.searchParams.get(k) || undefined;
        const liste = depotSuiviConflits.historique(session, {
          du: p('du'), au: p('au'), region: p('region'), compagnie: p('compagnie'), brigade: p('brigade'),
          faction: p('faction'), statut: p('statut'), intervenant: p('intervenant'),
        });
        json(res, 200, { items: liste.map((c) => ({ ...c, workflow: presenterWorkflow(c, session) })), total: liste.length });
        return true;
      }

      /* Correction exceptionnelle de l'historique — Superadmin, motif obligatoire, auditée. */
      const matchConflitRouvrir = chemin.match(/^\/api\/conflits\/([^/]+)\/rouvrir$/);
      if (matchConflitRouvrir && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const corps = await lireCorps(req, res);
        try {
          const r = depotSuiviConflits.rouvrirConflit({
            conflitId: decodeURIComponent(matchConflitRouvrir[1]), session,
            motif: String(corps?.motif ?? '').trim(), auditer: auditerConflit(session), depotNotifications,
          });
          json(res, 200, { ...r, conflit: { ...r.conflit, workflow: presenterWorkflow(r.conflit, session) } });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      const matchConflitHist = chemin.match(/^\/api\/conflits\/([^/]+)\/historique$/);
      if (matchConflitHist && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const conf = depotSuiviConflits.parId(decodeURIComponent(matchConflitHist[1]));
        if (!conf) {
          json(res, 404, { erreur: 'Conflit introuvable.' });
          return true;
        }
        if (!depotSuiviConflits.visiblesPour(session).some((c) => c.id === conf.id)) {
          json(res, 403, { erreur: 'Ce conflit ne relève pas de votre commandement.' });
          return true;
        }
        json(res, 200, { id: conf.id, historique: conf.historique || [] });
        return true;
      }

      /* Liste des Commandants de Région autorisés pour traiter un conflit (AVANT /api/conflits/:id) */
      if ((chemin === '/api/conflits/cmnd-reg' || chemin === '/api/conflits/cmnd-reg/') && (req.method === 'GET' || req.method === 'POST')) {
        if (!session) return refuseNonConnecte(json, res);
        const etat = comptes();
        const pBAId = url.searchParams.get('barrageAId');
        const pBBId = url.searchParams.get('barrageBId');
        const pRegA = url.searchParams.get('regA');
        const pRegB = url.searchParams.get('regB');

        const confId = url.searchParams.get('id');
        const conf = confId ? (depotSuiviConflits.parId(confId) || depotSuiviConflits.tous().find((c) => c.id === confId || c.numero === confId)) : null;

        const bAId = pBAId || conf?.barrageAId;
        const bBId = pBBId || conf?.barrageBId;
        const bA = bAId ? depot.parId(bAId) : (conf?.barrageA || null);
        const bB = bBId ? depot.parId(bBId) : (conf?.barrageB || null);

        const regA = pRegA || bA?.reg || conf?.barrageA?.reg || null;
        const regB = pRegB || bB?.reg || conf?.barrageB?.reg || null;
        const estInterRegion = Boolean(regA && regB && regA.toLowerCase() !== regB.toLowerCase());
        const regionsConcernees = Array.from(new Set([regA, regB].filter(Boolean)));

        const estPosteIntou = (b) =>
          Boolean(
            b &&
            (estIntouchable(b) ||
              b?.type === 'barrage_vip' ||
              b?.protection === 'intouchable' ||
              b?.intouchable === true ||
              String(b?.id || '').startsWith('BFI-'))
          );
        const intA = estPosteIntou(bA);
        const intB = estPosteIntou(bB);
        const bAEstIntouchable = Boolean(intA);
        const bBEstIntouchable = Boolean(intB);
        const conflitBfiVsBf = (intA && !intB) || (intB && !intA);

        const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const matchReg = (uniteCompte, regTarget) => {
          if (!uniteCompte || !regTarget) return false;
          const u = norm(uniteCompte);
          const t = norm(regTarget);
          return u === t || u.includes(t) || t.includes(u);
        };

        const tous = listerComptes(etat)
          .filter((c) => c.rang === 'reg' && ROLES[c.role]?.ecrit)
          .map((c) => {
            const concerneA = Boolean(regA && (matchReg(c.unite, regA) || matchReg(c.reg, regA)));
            const concerneB = Boolean(regB && (matchReg(c.unite, regB) || matchReg(c.reg, regB)));
            let roleConflit = null;
            let duConflit = false;

            if (intA && !intB) {
              // bA est BFI (intouchable), bB est BF normal -> Seule la région du BF doit être assignée
              duConflit = concerneB;
              if (concerneB) roleConflit = `Barrage BF (${bB?.nom || bBId || 'B'}) — À traiter`;
              else if (concerneA) roleConflit = `Barrage BFI (${bA?.nom || bAId || 'A'}) — Intouchable`;
            } else if (intB && !intA) {
              // bB est BFI (intouchable), bA est BF normal -> Seule la région du BF doit être assignée
              duConflit = concerneA;
              if (concerneA) roleConflit = `Barrage BF (${bA?.nom || bAId || 'A'}) — À traiter`;
              else if (concerneB) roleConflit = `Barrage BFI (${bB?.nom || bBId || 'B'}) — Intouchable`;
            } else {
              duConflit = Boolean(concerneA || concerneB);
              if (concerneA && concerneB) roleConflit = 'Barrages A & B';
              else if (concerneA) roleConflit = `Barrage A (${bA?.nom || bAId || 'A'})`;
              else if (concerneB) roleConflit = `Barrage B (${bB?.nom || bBId || 'B'})`;
            }

            return {
              matricule: c.matricule,
              nom: c.nom,
              unite: c.unite,
              region: c.unite,
              duConflit,
              concerneA,
              concerneB,
              estBfiRegion: (intA && !intB && concerneA) || (intB && !intA && concerneB),
              roleConflit,
            };
          })
          .sort((a, b) => Number(b.duConflit) - Number(a.duConflit) || a.unite.localeCompare(b.unite, 'fr'));

        if (conflitBfiVsBf) {
          // Règle BFI vs BF : Le BFI étant intouchable, seule la région du Barrage Fixe ordinaire doit être proposée pour assignation
          tous = tous.filter((c) => (intA ? c.concerneB : c.concerneA));
        }

        json(res, 200, {
          comptes: tous,
          regA,
          regB,
          estInterRegion,
          regionsConcernees,
          bAEstIntouchable,
          bBEstIntouchable,
          conflitBfiVsBf,
        });
        return true;
      }

      const matchConflitUnique = chemin.match(/^\/api\/conflits\/([^/]+)(?:\/(?:supprimer|remove))?$/);
      if (
        matchConflitUnique &&
        !['vider', 'tous', 'cmnd-reg', 'conflits', 'supprimer-groupe', 'assigner-groupe', 'restaurer'].includes(matchConflitUnique[1]) &&
        !chemin.endsWith('/assigner') &&
        !chemin.endsWith('/desassigner') &&
        !chemin.endsWith('/cmnd-cie') &&
        !chemin.endsWith('/transmettre') &&
        !chemin.endsWith('/traiter') &&
        !chemin.endsWith('/decider') &&
        !chemin.endsWith('/rouvrir') &&
        !chemin.endsWith('/historique')
      ) {
        if (!session) return refuseNonConnecte(json, res);
        const conflitId = decodeURIComponent(matchConflitUnique[1]);

        // GET : consultation du détail du conflit
        if (req.method === 'GET') {
          const conf = depotSuiviConflits.parId(conflitId);
          if (!conf) {
            json(res, 404, { erreur: 'Conflit introuvable.' });
            return true;
          }
          if (!depotSuiviConflits.visiblesPour(session).some((c) => c.id === conf.id)) {
            if (session.rang !== 'admin') {
              json(res, 403, { erreur: 'Ce conflit ne relève pas de votre commandement.' });
              return true;
            }
          }
          json(res, 200, { conflit: conf });
          return true;
        }

        // DELETE ou POST /supprimer : suppression manuelle du conflit spécifique
        if (req.method === 'DELETE' || (req.method === 'POST' && (chemin.endsWith('/supprimer') || chemin.endsWith('/remove')))) {
          try {
            let corps = {};
            if (req.method !== 'GET') {
              try { corps = await lireCorps(req, res); } catch {}
            }
            const paireCle = url.searchParams.get('paire') || url.searchParams.get('paireCle') || corps?.paireCle || null;
            const barrageAId = url.searchParams.get('barrageAId') || corps?.barrageAId || null;
            const barrageBId = url.searchParams.get('barrageBId') || corps?.barrageBId || null;

            /* Un conflit enregistré hors du périmètre du compte reste protégé :
               seul le Superadmin supprime partout. */
            const confCible = depotSuiviConflits.parId(conflitId) ||
              (paireCle ? depotSuiviConflits.parId(paireCle) : null) ||
              (barrageAId && barrageBId ? depotSuiviConflits.parPaire(barrageAId, barrageBId) : null);
            if (session.rang !== 'admin') {
              json(res, 403, { erreur: 'Seul le Super Admin peut supprimer un conflit.' });
              return true;
            }
            if (confCible && !peutSupprimer(confCible, session)) {
              json(res, 409, { erreur: 'Un conflit soumis, validé ou clos ne peut pas être supprimé : il est conservé dans l’historique.' });
              return true;
            }

            const resSuppr = depotSuiviConflits.supprimerConflit({
              conflitId,
              paireCle,
              barrageAId,
              barrageBId,
              session,
              depotInstructions,
              depotNotifications,
            graphe,
            });

            const bA = resSuppr.conflitSupprime?.barrageA || depot.parId(resSuppr.conflitSupprime?.barrageAId);
            journal.consigner({
              session,
              action: 'suppression_conflit',
              avant: bA,
              apres: bA,
              details: {
                categorie: 'conflit',
                conflitId: resSuppr.id,
                numero: resSuppr.numero,
                paireCle: resSuppr.paireCle,
                description: `Suppression manuelle du conflit ${resSuppr.numero || resSuppr.id}.`,
              },
            });

            json(res, 200, {
              ok: true,
              id: resSuppr.id,
              numero: resSuppr.numero,
              paireCle: resSuppr.paireCle,
              message: `Le conflit ${resSuppr.numero || resSuppr.id} a été supprimé avec succès.`,
            });
          } catch (err) {
            json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
          }
          return true;
        }
      }

      /* Assigner un conflit au CMD_REGION (Super Admin uniquement) */
      const matchConflitAssigner = chemin.match(/^\/api\/conflits\/([^/]+)\/assigner$/);
      if (matchConflitAssigner && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Seul le Super Admin peut assigner un conflit à un Commandant de Région.' });
          return true;
        }
        const conflitId = decodeURIComponent(matchConflitAssigner[1]);
        const corps = await lireCorps(req, res);
        const ciblesEntrantes = corps?.matricules ?? corps?.matricule ?? corps?.cibles ?? corps?.destinataires ?? corps?.destinataire ?? [];
        const listeBrute = Array.isArray(ciblesEntrantes) ? ciblesEntrantes : [ciblesEntrantes];
        const matricules = listeBrute
          .flatMap((item) => {
            if (!item) return [];
            if (typeof item === 'string') return item.split(',').map((s) => s.trim());
            if (typeof item === 'object') return [item.matricule || item.unite || item.region].filter(Boolean).map(String);
            return [];
          })
          .map((s) => s.trim())
          .filter(Boolean);
        const matricule = matricules[0] ?? '';
        const consigne = String(corps?.consigne ?? corps?.commentaire ?? corps?.texte ?? '').trim();
        const conflitData = corps?.conflitData ?? null;
        const etatAttenduAssign = corps?.etatAttendu ? String(corps.etatAttendu) : null;

        try {
          const resAssign = depotSuiviConflits.assignerConflit({
            conflitId,
            session,
            matricule,
            matricules,
            consigne,
            conflitData,
            etatAttendu: etatAttenduAssign,
            depotBarrages: depot,
            depotInstructions,
            depotNotifications,
            graphe,
            comptes: { tous: () => listerComptes(comptes()) },
          });

          // Journalisation de l'assignation de conflit
          const bCible = depot.parId(resAssign.conflit?.barrageAId) || resAssign.conflit?.barrageA;
          journal.consigner({
            session,
            action: 'assignation_conflit',
            avant: bCible,
            apres: bCible,
            details: {
              categorie: 'conflit',
              conflitId: resAssign.conflit?.id,
              conflitNumero: resAssign.conflit?.numero,
              matricule: matricules.join(','),
              matricules,
              consigne,
            },
          });

          json(res, 200, {
            ok: true,
            /* Même assignation déjà en place : rien n'a changé (double clic). */
            inchange: resAssign.inchange === true,
            conflit: { ...resAssign.conflit, workflow: presenterWorkflow(resAssign.conflit, session) },
            instruction: resAssign.instruction,
            instructions: resAssign.instructions,
            assignesA: resAssign.assignesA,
          });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Assigner un groupe de conflits au CMD_REGION (Super Admin uniquement) */
      if ((chemin === '/api/conflits/assigner-groupe' || chemin === '/api/conflits/assigner-groupe/') && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Seul le Super Admin peut assigner un lot de conflits.' });
          return true;
        }
        const corps = await lireCorps(req, res);
        const conflitIds = Array.isArray(corps?.ids) ? corps.ids : (Array.isArray(corps?.conflitIds) ? corps.conflitIds : []);
        if (!conflitIds.length) {
          json(res, 400, { erreur: 'Aucun conflit spécifié pour l’assignation groupée.' });
          return true;
        }
        const ciblesEntrantes = corps?.matricules ?? corps?.matricule ?? corps?.cibles ?? corps?.destinataires ?? corps?.destinataire ?? [];
        const listeBrute = Array.isArray(ciblesEntrantes) ? ciblesEntrantes : [ciblesEntrantes];
        const matricules = listeBrute
          .flatMap((item) => {
            if (!item) return [];
            if (typeof item === 'string') return item.split(',').map((s) => s.trim());
            if (typeof item === 'object') return [item.matricule || item.unite || item.region].filter(Boolean).map(String);
            return [];
          })
          .map((s) => s.trim())
          .filter(Boolean);
        const matricule = matricules[0] ?? '';
        const consigne = String(corps?.consigne ?? corps?.commentaire ?? corps?.texte ?? '').trim();
        const conflitDataList = Array.isArray(corps?.conflitsData) ? corps.conflitsData : (Array.isArray(corps?.conflits) ? corps.conflits : []);

        try {
          const resGrp = depotSuiviConflits.assignerConflitsGroupe({
            conflitIds,
            session,
            matricule,
            matricules,
            consigne,
            conflitDataList,
            depotBarrages: depot,
            depotInstructions,
            depotNotifications,
            graphe,
            comptes: { tous: () => listerComptes(comptes()) },
          });

          journal.consigner({
            session,
            action: 'assignation_groupee_conflits',
            details: {
              nbAssignes: resGrp.assignes.length,
              /* Le dépôt rend `erreurs` (et non `echecs`) : lire l'absent faisait échouer la requête. */
              nbEchecs: (resGrp.erreurs ?? []).length,
              matricules,
              consigne,
            },
          });

          json(res, 200, {
            ok: true,
            count: resGrp.assignes.length,
            /* Chaque entrée du dépôt est { id, res } : le conflit est dans `res.conflit`. */
            assignes: resGrp.assignes.map((a) => a.res?.conflit).filter(Boolean).map((c) => ({ ...c, workflow: presenterWorkflow(c, session) })),
            echecs: resGrp.erreurs ?? [],
            message: `${resGrp.assignes.length} conflit(s) assigné(s) avec succès.`,
          });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Supprimer un groupe de conflits (Soft Delete Super Admin uniquement) */
      if (
        (chemin === '/api/conflits/supprimer-groupe' || chemin === '/api/conflits/supprimer-groupe/') &&
        (req.method === 'POST' || req.method === 'DELETE')
      ) {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Seul le Super Admin peut supprimer des conflits.' });
          return true;
        }
        const corps = await lireCorps(req, res);
        const conflitIds = Array.isArray(corps?.ids) ? corps.ids : (Array.isArray(corps?.conflitIds) ? corps.conflitIds : []);
        if (!conflitIds.length) {
          json(res, 400, { erreur: 'Aucun conflit spécifié pour la suppression groupée.' });
          return true;
        }

        try {
          const resSuppr = depotSuiviConflits.supprimerConflitsGroupe({
            conflitIds,
            session,
            depotInstructions,
            depotNotifications,
            graphe,
          });

          journal.consigner({
            session,
            action: 'suppression_groupee_conflits',
            details: {
              nbSupprimes: resSuppr.supprimes.length,
              /* Le dépôt rend `nonSupprimes` (et non `echecs`) : lire l'absent faisait échouer la requête. */
              nbEchecs: (resSuppr.nonSupprimes ?? []).length,
              supprimes: resSuppr.supprimes,
            },
          });

          json(res, 200, {
            ok: true,
            count: resSuppr.supprimes.length,
            supprimes: resSuppr.supprimes,
            echecs: resSuppr.nonSupprimes ?? [],
            message: `${resSuppr.supprimes.length} conflit(s) supprimé(s) avec succès.`,
          });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Désassigner un conflit (Super Admin uniquement) */
      const matchConflitDesassigner = chemin.match(/^\/api\/conflits\/([^/]+)\/(?:desassigner|unassign)$/);
      if (matchConflitDesassigner && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Seul le Super Admin peut désassigner un conflit.' });
          return true;
        }
        const conflitId = decodeURIComponent(matchConflitDesassigner[1]);
        try {
          const resDes = depotSuiviConflits.desassignerConflit({
            conflitId,
            session,
            depotInstructions,
            depotNotifications,
            graphe,
          });

          // Journalisation de la désassignation de conflit
          const bCible = depot.parId(resDes.conflit?.barrageAId) || resDes.conflit?.barrageA;
          journal.consigner({
            session,
            action: 'desassignation_conflit',
            avant: bCible,
            apres: bCible,
            details: {
              categorie: 'conflit',
              conflitId: resDes.conflit?.id,
              conflitNumero: resDes.conflit?.numero,
            },
          });

          json(res, 200, { ok: true, conflit: { ...resDes.conflit, workflow: presenterWorkflow(resDes.conflit, session) } });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Vider / purger tous les conflits enregistrés (Super Admin uniquement) */
      if (
        ((chemin === '/api/conflits' || chemin === '/api/conflits/' || chemin === '/api/conflits/tous') && req.method === 'DELETE') ||
        ((chemin === '/api/conflits/vider' || chemin === '/api/conflits/tous/vider') && (req.method === 'POST' || req.method === 'DELETE'))
      ) {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Seul le Super Admin peut vider les conflits.' });
          return true;
        }
        try {
          depotSuiviConflits.vider();
          if (depotConflitsPlanification && typeof depotConflitsPlanification.vider === 'function') {
            depotConflitsPlanification.vider();
          }
          json(res, 200, { ok: true, message: 'Tous les conflits enregistrés ont été effacés avec succès.' });
        } catch (err) {
          json(res, 500, { erreur: err.message });
        }
        return true;
      }

      /* Restaurer des conflits précédemment supprimés (ex: lors d'un nouveau calcul d'espacement) */
      if (
        (chemin === '/api/conflits/restaurer' || chemin === '/api/conflits/restaurer/') &&
        (req.method === 'POST' || req.method === 'DELETE')
      ) {
        if (!session) return refuseNonConnecte(json, res);
        let corps = {};
        try { corps = await lireCorps(req, res); } catch {}
        const paires = Array.isArray(corps?.paires)
          ? corps.paires
          : (corps?.paireCle ? [corps.paireCle] : (corps?.id ? [corps.id] : []));
        const nbRestaures = depotSuiviConflits.restaurerConflits(paires);
        json(res, 200, { ok: true, count: nbRestaures, message: `${nbRestaures} conflit(s) restauré(s).` });
        return true;
      }


      /* Liste des Commandants de Compagnie autorisés pour un conflit (CMD_REGION) */
      const matchConflitCmndCie = chemin.match(/^\/api\/conflits\/([^/]+)\/cmnd-cie$/);
      if (matchConflitCmndCie && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const conflitId = decodeURIComponent(matchConflitCmndCie[1]);
        const conf = depotSuiviConflits.parId(conflitId);

        const bA = conf ? (depot.parId(conf.barrageAId) || conf.barrageA) : null;
        const bB = conf ? (depot.parId(conf.barrageBId) || conf.barrageB) : null;
        const estPosteIntou = (b) =>
          Boolean(
            b &&
            (estIntouchable(b) ||
              b?.type === 'barrage_vip' ||
              b?.protection === 'intouchable' ||
              b?.intouchable === true ||
              String(b?.id || '').startsWith('BFI-'))
          );
        const intA = estPosteIntou(bA);
        const intB = estPosteIntou(bB);
        let barrageCibleCie = bA || bB;
        if (intA && !intB) barrageCibleCie = bB;
        else if (intB && !intA) barrageCibleCie = bA;

        if (session.rang !== 'reg' && session.rang !== 'admin') {
          json(res, 403, { erreur: 'Liste réservée au CMD Région et au Super Admin.' });
          return true;
        }
        const reg = session.rang === 'reg' ? session.unite : (url.searchParams.get('reg') || bA?.reg || bB?.reg || '');
        const cies = cmndCieDeRegion(reg, barrageCibleCie);

        json(res, 200, { region: reg, comptes: cies });
        return true;
      }

      /* Transmettre un conflit au CMD_COMPAGNIE (CMD_REGION uniquement) */
      const matchConflitTransmettre = chemin.match(/^\/api\/conflits\/([^/]+)\/transmettre$/);
      if (matchConflitTransmettre && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'reg') {
          json(res, 403, { erreur: 'Seul le CMD Région peut assigner un conflit à un CMD CIE.' });
          return true;
        }
        const conflitId = decodeURIComponent(matchConflitTransmettre[1]);
        const corps = await lireCorps(req, res);
        const matricule = String(corps?.matricule ?? corps?.cible ?? '').trim();
        const consigne = String(corps?.consigne ?? corps?.texte ?? corps?.commentaire ?? '').trim();
        const etatAttenduTrans = corps?.etatAttendu ? String(corps.etatAttendu) : null;

        try {
          const resTrans = depotSuiviConflits.transmettreConflit({
            etatAttendu: etatAttenduTrans,
            conflitId,
            session,
            matricule,
            consigne,
            depotBarrages: depot,
            depotInstructions,
            depotNotifications,
            graphe,
            comptes: { tous: () => listerComptes(comptes()) },
          });

          // Journalisation de la transmission
          const bCible = depot.parId(resTrans.conflit?.barrageAId) || resTrans.conflit?.barrageA;
          journal.consigner({
            session,
            action: 'transmission_conflit',
            avant: bCible,
            apres: bCible,
            details: {
              categorie: 'conflit',
              conflitId: resTrans.conflit?.id,
              conflitNumero: resTrans.conflit?.numero,
              matricule,
              consigne,
            },
          });

          json(res, 200, { ok: true, conflit: { ...resTrans.conflit, workflow: presenterWorkflow(resTrans.conflit, session) }, instruction: resTrans.instruction });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Traiter un conflit (CMD_REGION ou Admin) : changer faction ou déplacer */
      const matchConflitTraiter = chemin.match(/^\/api\/conflits\/([^/]+)\/traiter$/);
      if (matchConflitTraiter && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'reg' && session.rang !== 'admin' && session.rang !== 'cie') {
          json(res, 403, { erreur: 'Seuls le Commandement de Région, la Compagnie assignée ou le Superadmin peuvent traiter ce conflit.' });
          return true;
        }
        const conflitId = decodeURIComponent(matchConflitTraiter[1]);
        const corps = await lireCorps(req, res);
        const action = String(corps?.action ?? 'changement_faction');
        const details = corps?.details ?? {};

        /* GARDE DU WORKFLOW AVANT TOUTE ÉCRITURE. Le changement de faction
           ci-dessous modifie le barrage : un traitement refusé (conflit déjà
           soumis, en validation, clos, ou hors périmètre) ne doit rien avoir
           changé sur la carte. */
        try {
          depotSuiviConflits.rafraichir?.();
          const confGarde = depotSuiviConflits.parId(conflitId) ?? null;
          /* Un conflit calculé non encore enregistré : seul le Super Admin le
             traite directement (le dépôt le vérifie aussi). */
          if (confGarde) verifierAction(confGarde, session, 'soumettre');
          else if (session.rang !== 'admin') throw new ErreurWorkflow(404, 'Conflit introuvable.');
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
          return true;
        }

        try {
          const confCheck = depotSuiviConflits.parId(conflitId);
          const chkA = depot.parId(confCheck?.barrageAId) || confCheck?.barrageA;
          const chkB = depot.parId(confCheck?.barrageBId) || confCheck?.barrageB;
          const intA = estIntouchable(chkA) || chkA?.type === 'barrage_vip';
          const intB = estIntouchable(chkB) || chkB?.type === 'barrage_vip';
          const regA = chkA?.reg || confCheck?.barrageA?.reg;
          const regB = chkB?.reg || confCheck?.barrageB?.reg;
          const estInterRegionDeuxBfi = Boolean(
            intA && intB && regA && regB && regA.trim().toLowerCase() !== regB.trim().toLowerCase()
          );

          // Si changement de faction : contrôle strict FIXE INTOUCHABLE sauf exception inter-régions BFI vs BFI
          if (action === 'changement_faction') {
            if (!estInterRegionDeuxBfi && (intA || intB || confCheck?.entreIntouchables)) {
              json(res, 403, {
                erreur: 'Action non autorisée : un conflit impliquant un barrage FIXE INTOUCHABLE ne peut pas être résolu par un changement de faction. Les barrages intouchables sont permanents et actifs sur toutes les factions.',
              });
              return true;
            }
          }

          // Si rétrogradation d'un BFI en BF ordinaire
          if ((action === 'retrograder_bf' || action === 'conversion_bf') && details.barrageId && session.rang === 'admin') {
            const bCible = depot.parId(details.barrageId);
            if (bCible) {
              const ancien = { ...bCible };
              const modifs = {
                type: 'barrage_fixe',
                protection: 'standard',
                intouchable: false,
                isPermanent: false,
              };
              depot.modifier(bCible.id, modifs);
              journal.consigner({
                session,
                action: 'retrograder_bf',
                avant: ancien,
                apres: { ...bCible, ...modifs },
                details: { conflitId },
              });
            }
          }

          // Si changement de faction sur un barrage réel
          if (action === 'changement_faction' && details.barrageId && details.nouvelleFactionId && session.rang === 'admin') {
            const bCible = depot.parId(details.barrageId);
            if (bCible) {
              const ancien = { ...bCible };
              const maj = { ...bCible, factionId: details.nouvelleFactionId };
              depot.modifier(bCible.id, { factionId: details.nouvelleFactionId });
              journal.consigner({
                session,
                action: 'changement_faction',
                avant: ancien,
                apres: maj,
                details: { factionId: details.nouvelleFactionId, conflitId },
              });
            }
          }

          const resTrait = depotSuiviConflits.traiterConflit({
            conflitId,
            session,
            action,
            details,
            depotBarrages: depot,
            depotInstructions,
            depotNotifications,
            graphe,
            auditer: auditerConflit(session),
          });

          if (resTrait.barrageModifie) {
            recalculerSiPresent(resTrait.barrageModifie.id);
            recalculerConflitsSiPresent();
            actualiserSuiviConflits(resTrait.barrageModifie.id, session, 'traitement_conflit_direct', details);
          }

          json(res, 200, {
            ok: true,
            conflit: { ...resTrait.conflit, workflow: presenterWorkflow(resTrait.conflit, session) },
            resolu: resTrait.resolu,
            barrageModifie: resTrait.barrageModifie || null,
            barragesModifies: resTrait.barragesModifies || (resTrait.barrageModifie ? [resTrait.barrageModifie] : []),
          });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Actions simples du workflow : prendre_en_charge (CMD Région),
         commencer (CMD CIE), cloturer (Super Admin). Rôle, état et périmètre
         vérifiés par le dépôt (workflowConflits.mjs). */
      const matchConflitAction = chemin.match(/^\/api\/conflits\/([^/]+)\/action$/);
      if (matchConflitAction && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const corps = await lireCorps(req, res);
        try {
          const r = depotSuiviConflits.actionConflit({
            conflitId: decodeURIComponent(matchConflitAction[1]),
            session,
            action: String(corps?.action ?? ''),
            motif: String(corps?.motif ?? '').trim(),
            etatAttendu: corps?.etatAttendu ? String(corps.etatAttendu) : null,
            depotNotifications,
            graphe,
            auditer: auditerConflit(session),
          });
          json(res, 200, { ...r, conflit: { ...r.conflit, workflow: presenterWorkflow(r.conflit, session) } });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* Validation / rejet du traitement d’un conflit — Super Admin */
      const matchConflitDecider = chemin.match(/^\/api\/conflits\/([^/]+)\/decider$/);
      if (matchConflitDecider && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Seul le Super Admin peut valider ou rejeter le traitement d’un conflit.' });
          return true;
        }
        const conflitId = decodeURIComponent(matchConflitDecider[1]);
        const corps = await lireCorps(req, res);
        const decision = String(corps?.decision ?? 'approuver');
        const raison = String(corps?.raison ?? corps?.commentaire ?? '').trim();
        const etatAttendu = corps?.etatAttendu ? String(corps.etatAttendu) : null;

        try {
          const resDec = depotSuiviConflits.deciderTraitement({
            conflitId,
            session,
            decision,
            raison,
            etatAttendu,
            depotBarrages: depot,
            depotDemandes,
            depotNotifications,
            graphe,
            auditer: auditerConflit(session),
          });
          if (Array.isArray(resDec.barragesModifies) && resDec.barragesModifies.length > 0) {
            for (const b of resDec.barragesModifies) {
              if (b?.id) {
                recalculerSiPresent(b.id);
                recalculerConflitsSiPresent();
                actualiserSuiviConflits(b.id, session, 'validation_traitement_conflit', { decision, raison });
              }
            }
          }

          json(res, 200, {
            ...resDec,
            conflit: { ...resDec.conflit, workflow: presenterWorkflow(resDec.conflit, session) },
            barragesModifies: resDec.barragesModifies || (resDec.barrageModifie ? [resDec.barrageModifie] : []),
          });
        } catch (err) {
          json(res, err instanceof ErreurWorkflow ? err.code : 400, { erreur: err.message });
        }
        return true;
      }

      /* ---------------------------- règles ---------------------------- */
      if (chemin === '/api/regles' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        json(res, 200, { items: depotRegles.tous() });
        return true;
      }

      if (chemin === '/api/regles' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const { nom, criteres } = await lireCorps(req, res);
        const regle = depotRegles.creer({ nom, criteres, auteur: identite(session) });
        json(res, 201, { regle });
        return true;
      }

      const regleId = chemin.match(/^\/api\/regles\/([\w-]+)$/);
      if (regleId && req.method === 'DELETE') {
        if (!session) return refuseNonConnecte(json, res);

        const regle = depotRegles.parId(regleId[1]);
        if (!regle) {
          json(res, 404, { erreur: 'Règle introuvable.' });
          return true;
        }

        /** Sa créatrice ou un administrateur seulement — pas n'importe qui,
         *  même si l'usage de la règle reste ouvert à tous. */
        const peutSupprimer =
          session.rang === 'admin' ||
          (regle.auteur?.rang === session.rang && regle.auteur?.unite === session.unite);
        if (!peutSupprimer) {
          json(res, 403, {
            erreur: "Seule l'unité qui a enregistré cette règle peut la supprimer.",
          });
          return true;
        }

        depotRegles.supprimer(regleId[1]);
        json(res, 200, { supprime: regleId[1] });
        return true;
      }

      /* --------------------------- missions --------------------------- */
      if (chemin === '/api/missions' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        json(res, 200, { items: depotMissions.tous() });
        return true;
      }

      if (chemin === '/api/missions' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const corps = await lireCorps(req, res);
        const mission = depotMissions.creer(corps, { auteur: identite(session) });
        json(res, 201, { mission });
        return true;
      }

      /** Sa créatrice ou un administrateur seulement, même règle que les règles enregistrées. */
      const peutGererMission = (mission) =>
        session?.rang === 'admin' ||
        (mission.auteur?.rang === session?.rang && mission.auteur?.unite === session?.unite);

      const missionId = chemin.match(/^\/api\/missions\/([\w-]+)$/);
      if (missionId) {
        if (!session) return refuseNonConnecte(json, res);

        const mission = depotMissions.parId(missionId[1]);
        if (!mission) {
          json(res, 404, { erreur: 'Mission introuvable.' });
          return true;
        }

        if (!peutGererMission(mission)) {
          json(res, 403, { erreur: "Seule l'unité qui a créé cette mission peut la modifier." });
          return true;
        }

        if (req.method === 'PATCH') {
          const corps = await lireCorps(req, res);
          const mise = depotMissions.modifier(missionId[1], corps);
          json(res, 200, { mission: mise });
          return true;
        }

        if (req.method === 'DELETE') {
          depotMissions.supprimer(missionId[1]);
          json(res, 200, { supprime: missionId[1] });
          return true;
        }

        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      /**
       * QUI VALIDE QUOI — LA RÈGLE, ÉCRITE UNE FOIS.
       *
       * Toute modification et toute suppression d'un barrage passent par une
       * validation, et elle va DANS LES DEUX SENS :
       *
       *   une unité écrit    →  l'administration confirme      (`admin`)
       *   l'administration écrit → le commandement concerné confirme (`unite`)
       *
       * La symétrie n'est pas une politesse. Un chef de région qui découvre
       * qu'un poste de sa région a changé ou disparu sans qu'il en ait rien su
       * n'a plus de dispositif à commander : il a une carte qu'on modifie
       * derrière lui. Le Super Admin garde l'autorité — il propose, et le
       * commandement concerné répond — exactement comme l'inverse.
       *
       * UNE SEULE EXCEPTION : un poste SANS rattachement (`bt` absent).
       * Personne n'est concerné, il n'y a donc personne à qui demander.
       *
       * IL N'Y A PAS D'EXEMPTION POUR « SON PROPRE POSTE ». Elle avait été
       * écrite pour qu'une erreur de saisie s'efface sans attendre un tiers —
       * et elle vidait la règle de son sens : l'auteur d'un poste pouvait
       * ensuite le modifier autant qu'il voulait, indéfiniment, sans aucune
       * validation. Une erreur se corrige donc par une demande de retrait, que
       * l'autre bord accepte : c'est le prix de la règle, et il est modeste
       * devant ce qu'elle protège.
       */
      const validateurPour = (session, barrage) => {
        if (!barrage?.bt) return null;
        return session.rang === 'admin' ? 'unite' : 'admin';
      };

      /** Ouvre la demande et rend la réponse « reçu, pas appliqué ». */
      const mettreEnAttente = ({
        barrage, aDecider, action, changements, corps, session, remplacerIntouchable = null, details = null,
      }) => {
        const demande = depotInstructions.creer({
          barrageId: barrage.id,
          barrage,
          action,
          aDecider,
          changements: changements ?? null,
          motif: typeof corps?.motif === 'string' ? corps.motif : '',
          texte:
            action === 'suppression'
              ? `Retrait demandé pour ${barrage.nom || 'ce poste'}.`
              : `Modification demandée sur ${barrage.nom || 'ce poste'} : ` +
                `${(changements ?? []).map((c) => c.champ).join(', ')}.`,
          auteur: identite(session),
          source: 'modification',
          remplacerIntouchable,
        });
        journal.consigner({
          session,
          action: action === 'suppression' ? 'demander-suppression' : 'demander-modification',
          avant: barrage,
          apres: null,
          details,
        });
        return demande;
      };


      /* ------------- MODIFIER BARRAGE : position, PK, effectif, protection ------------- */
      /**
       * UNE MODIFICATION, UN CALCUL — effectif et protection.
       *
       * Calculé sur l'état du dépôt à l'instant de l'enregistrement. Aucune
       * valeur venue du navigateur n'est reprise : ni l'effectif désigné, ni
       * l'intouchable à remplacer, ni les conflits.
       *
       * @returns {{statut: number, erreur: string}|{plan: object}}
       */
      const analyserModification = (session, existant, corps) => {
        /* LE DÉPLACEMENT N'EST PAS ICI. Il a son chemin, unique : « Déplacer »
           sur la carte, puis PATCH /api/marquages/:id (contrôle de périmètre,
           rattachement, validation, et refus pour un intouchable). Un second
           chemin de déplacement contournerait ces règles. */
        if (corps.mode || corps.lng != null || corps.lat != null || corps.pk != null) {
          return {
            statut: 400,
            erreur: 'Le déplacement d’un barrage se fait par « Déplacer » sur la carte (PATCH /api/marquages/:id).',
          };
        }
        const actuelle = positionActuelle(graphe, existant);
        const pos = { change: false, ...actuelle, lng: existant.lng, lat: existant.lat };

        /* CONTRÔLE TERRITORIAL — le même qu'à la pose et qu'au PATCH : le point
           doit être dans le périmètre du compte, et il est RATTACHÉ par la
           géométrie, jamais par ce que dit le client. */
        let rattachement = { bt: existant.bt ?? null, cie: existant.cie ?? null, reg: existant.reg ?? null };
        if (pos.change) {
          const pt = [pos.lng, pos.lat];
          const verdict = controler(circonscriptions, session, pt);
          if (verdict !== 'autorise') return { statut: 403, erreur: motifPerimetre(session, verdict) };
          rattachement = rattacher(session, pt);
          if (!rattachement?.bt) return { statut: 400, erreur: REFUS_HORS_TERRITOIRE };
        }

        /* PROTECTION. Un VIP l'est par nature : sa protection ne se retire pas. */
        const etaitIntouchable = estIntouchable(existant);
        const veutIntouchable =
          typeof corps.intouchable === 'boolean' ? corps.intouchable : etaitIntouchable;
        if (existant.type === 'barrage_vip' && !veutIntouchable) {
          return { statut: 400, erreur: 'Un barrage VIP est intouchable par nature : sa protection ne peut pas être retirée.' };
        }
        const protectionChange = veutIntouchable !== etaitIntouchable;
        const protection = protectionChange ? champsProtection(veutIntouchable, corps.factionId) : {};

        const apres = normaliser(
          {
            ...existant,
            ...protection,
            lng: pos.lng,
            lat: pos.lat,
            route: pos.change ? (pos.route ?? '') : existant.route,
            pk: pos.change ? pos.pk : (existant.pk ?? null),
            type: existant.type,
            exceptionnel: existant.exceptionnel,
            missionId: existant.missionId,
            viaAssistant: existant.viaAssistant,
            partage: existant.partage,
          },
          { id: existant.id, ...rattachement, auteur: existant.auteur ?? identite(session), cree: existant.cree },
        );
        apres.majPar = identite(session);
        /* `normaliser` ramène le sous-type d'un barrage (`none`) sur la première
           catégorie de zahma : sans intérêt ici, et la demande de validation
           afficherait un changement que personne n'a demandé. */
        if (existant.type !== 'zahma') apres.sousType = existant.sousType;

        /* UN SEUL INTOUCHABLE PAR COMPAGNIE — dans la compagnie d'ARRIVÉE, qui
           peut avoir changé avec la position. */
        const autre = estIntouchable(apres)
          ? autreIntouchableDeLaCompagnie(depot.tous(), apres.cie, existant.id)
          : null;
        if (autre && !peutModifier(session, autre)) {
          return {
            statut: 403,
            erreur:
              `La compagnie ${apres.cie} a déjà son barrage intouchable (${autre.nom || autre.id}), ` +
              'hors de votre autorité : seul un commandement qui en a la charge peut le remplacer.',
          };
        }

        /* EFFECTIF DU CRÉNEAU EN COURS — horloge du serveur, comme POST /api/elements. */
        const maintenant = new Date();
        const date = dateLocale(maintenant);
        const creneau = creneauDe(maintenant);
        const presents = depotElements
          .duBarrage(existant.id)
          .filter((e) => e.date === date && e.creneau === creneau);
        const demandeEffectif =
          corps.effectif === undefined || corps.effectif === null || corps.effectif === ''
            ? null
            : corps.effectif;
        if (demandeEffectif != null && Number(demandeEffectif) !== presents.length && !estBarrage(existant)) {
          return { statut: 400, erreur: 'La relève nominative ne se saisit que sur un barrage fixe ou mobile.' };
        }
        const occupes = new Set(
          depotElements
            .duJour(date)
            .filter((e) => e.creneau === creneau && e.barrageId !== existant.id && e.matricule)
            .map((e) => e.matricule),
        );
        const eff = planEffectif({
          demande: demandeEffectif,
          presents,
          /* La relève appartient à la brigade OFFICIELLE du poste : tant qu'un
             déplacement attend sa validation, c'est encore celle-là. */
          personnel: depotEffectifs.deLaBrigade(existant.bt),
          occupes,
          max: ELEMENTS_PAR_BARRAGE,
        });
        if (eff.erreur) return { statut: 400, erreur: eff.erreur };

        /* CONTRÔLE DE DISTANCE — sur la position d'arrivée, avec les factions
           d'arrivée (un intouchable est en service sur les quatre). */
        const tous = depot.tous();
        const { conflits, plusProche } = controleDistance(graphe, apres, tous, seuilConflitKm);
        const visiblesIds = new Set(visibles(session, tous).map((m) => m.id));
        const conflitsVisibles = conflits.filter((c) => visiblesIds.has(c.id));

        const SANS_INTERET = new Set(['majPar', 'maj', 'id', 'cree', 'auteur']);
        const changements = Object.keys(apres)
          .filter((champ) => !SANS_INTERET.has(champ))
          .filter((champ) => JSON.stringify(apres[champ] ?? null) !== JSON.stringify(existant[champ] ?? null))
          .map((champ) => ({ champ, ancienne: existant[champ] ?? null, nouvelle: apres[champ] ?? null }));

        return {
          plan: {
            existant,
            apres,
            actuelle,
            pos,
            autre,
            eff,
            date,
            creneau,
            changements,
            protectionChange,
            conflits,
            conflitsVisibles,
            conflitsHorsPerimetre: conflits.length - conflitsVisibles.length,
            /* Un rapprochement ne demande confirmation que si CETTE modification
               le crée : un poste qu'on ne déplace pas et dont la protection ne
               change pas n'a pas à se justifier d'un voisin qu'il avait déjà. */
            confirmerConflits: (pos.change || protectionChange) && conflits.length > 0,
            plusProche:
              plusProche && (visiblesIds.has(plusProche.id) || session.rang === 'admin')
                ? plusProche
                : plusProche && { km: plusProche.km, id: null, nom: 'poste hors de votre périmètre' },
            validePar: changements.length && estBarrage(existant) ? validateurPour(session, existant) : null,
          },
        };
      };

      const lireElement = (e) => ({ id: e.id, matricule: e.matricule, nom: e.nom, grade: e.grade });

      /** Ce que l'écran d'aperçu affiche — et que la réponse d'enregistrement répète. */
      const presenterPlan = (plan) => ({
        avant: {
          ...resume(plan.existant, { effectif: plan.eff.actuel }),
          route: plan.actuelle.route,
          pk: plan.actuelle.pk,
        },
        apres: {
          ...resume(plan.apres, { effectif: plan.eff.demande }),
          route: plan.apres.route || null,
          pk: plan.pos.change ? plan.pos.pk : plan.actuelle.pk,
        },
        recalage: plan.pos.change
          ? { ecartKm: plan.pos.ecartKm, longueurRouteKm: plan.pos.longueurRouteKm ?? null }
          : null,
        territoire: {
          bt: plan.apres.bt,
          cie: plan.apres.cie,
          reg: plan.apres.reg,
          change:
            plan.apres.bt !== plan.existant.bt ||
            plan.apres.cie !== plan.existant.cie ||
            plan.apres.reg !== plan.existant.reg,
        },
        seuilKm: seuilConflitKm,
        conflits: plan.conflitsVisibles,
        conflitsHorsPerimetre: plan.conflitsHorsPerimetre,
        confirmerConflits: plan.confirmerConflits,
        plusProche: plan.plusProche,
        intouchableExistant: plan.autre
          ? { id: plan.autre.id, nom: plan.autre.nom || '', route: plan.autre.route || null, cie: plan.autre.cie }
          : null,
        effectif: {
          date: plan.date,
          creneau: plan.creneau,
          max: ELEMENTS_PAR_BARRAGE,
          actuel: plan.eff.actuel,
          demande: plan.eff.demande,
          ajouter: plan.eff.ajouter.map((p) => ({ matricule: p.matricule, nom: p.nom, grade: p.grade })),
          retirer: plan.eff.retirer.map(lireElement),
        },
        changements: plan.changements.map((c) => c.champ),
        validation: plan.validePar ? { requise: true, par: plan.validePar } : { requise: false },
        rien: !plan.changements.length && !plan.eff.ajouter.length && !plan.eff.retirer.length,
      });

      /**
       * CHANGER LA FACTION D'UN BARRAGE — CMND CIE et CMND Région.
       *
       * Une écriture DIRECTE, sur le périmètre du compte (`peutModifier` :
       * région ou compagnie, rôle qui écrit) : la faction est la décision de
       * service du commandement, elle prend effet tout de suite. Le Super Admin
       * n'y a pas accès (il assigne), un chef de brigade non plus. Seules les
       * factions définies (serveur/factions.mjs) sont admises, et pas celle
       * déjà en place ; un Intouchable, en service sur toutes, n'en change pas.
       *
       * L'HISTORIQUE est le journal existant (`journal.consigner`) : qui, quand,
       * avant, après. GET rend les changements de faction de ce barrage.
       */
      const factionBarrage = chemin.match(/^\/api\/barrages\/([\w-]+)\/faction$/);
      if (factionBarrage && (req.method === 'POST' || req.method === 'GET')) {
        if (!session) return refuseNonConnecte(json, res);
        const existant = depot.parId(factionBarrage[1]);
        /* Un barrage assigné à ce compte lui est lisible, même hors de sa compagnie. */
        if (!existant || !estBarrage(existant) || !(visibles(session, [existant]).length || assignationPour(session, existant.id))) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }
        const droit = droitFaction(session, existant);
        if (req.method === 'GET') {
          json(res, 200, {
            actuelle: existant.factionId || null,
            /* Les factions définies, sauf l'actuelle ; aucune sans le droit ni pour un Intouchable. */
            autorisees: !droit.ok || estIntouchable(existant) ? [] : FACTIONS.map((x) => x.id).filter((id) => id !== existant.factionId),
            motif: droit.ok ? (estIntouchable(existant) ? 'Barrage intouchable : en service sur toutes les factions.' : null) : droit.erreur,
            historique: journal.dernieres(50, (e) => e.action === 'changement_faction' && e.id === existant.id)
              .map((e) => ({ date: e.ts, par: e.nom || e.matricule, rang: e.rang, ancienne: e.details?.ancienne ?? null, nouvelle: e.details?.nouvelle ?? null })),
          });
          return true;
        }
        if (!droit.ok) {
          json(res, droit.statut, { erreur: droit.erreur });
          return true;
        }
        const corps = await lireCorps(req, res);
        const r = changerFaction(session, existant, corps?.factionId, '', Boolean(corps?.conflitInterRegionBfi || corps?.autoriserBfi));
        if (r.erreur) {
          json(res, r.statut, { erreur: r.erreur });
          return true;
        }
        json(res, 200, { item: r.item, ancienne: r.ancienne, nouvelle: r.nouvelle });
        return true;
      }

      /**
       * ASSIGNER DES BARRAGES AU CMND RÉGION — le geste du Super Admin.
       *
       * Une notification par barrage, adressée à la région qui le porte
       * (`action: 'assignation'`), avec la consigne. Le CMND Région la voit dans
       * ses notifications, traite le barrage avec ses propres droits, puis
       * accuse réception. Un barrage déjà assigné et non traité n'est pas
       * assigné une seconde fois.
       */
      if (chemin === '/api/barrages/assigner' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Seul le Super Admin assigne des barrages aux CMND Région.' });
          return true;
        }
        const corps = await lireCorps(req, res);
        const ids = Array.isArray(corps?.ids) ? [...new Set(corps.ids.map(String))].slice(0, 500) : [];
        if (!ids.length) {
          json(res, 400, { erreur: 'Aucun barrage à assigner.' });
          return true;
        }
        const consigne = String(corps?.texte ?? '').trim();
        const assignees = [];
        const ignores = [];
        for (const id of ids) {
          const b = depot.parId(id);
          if (!b || !estBarrage(b)) {
            ignores.push({ id, raison: 'introuvable' });
            continue;
          }
          if (!b.reg) {
            ignores.push({ id, nom: b.nom || id, raison: 'sans région de rattachement' });
            continue;
          }
          if (assignationOuverte(b.id)) {
            ignores.push({ id, nom: b.nom || id, raison: 'déjà assigné, en attente de traitement' });
            continue;
          }
          const dejaConflit = conflitAssignePour(b);
          if (dejaConflit) {
            ignores.push({ id, nom: b.nom || id, raison: `déjà assigné au CMD Région ${b.reg} (conflit ${dejaConflit.numero || dejaConflit.id}), en attente de traitement` });
            continue;
          }
          const bconflit = corps?.criteres?.[b.id] ?? (corps?.criteres?.distanceKm != null ? corps.criteres : null) ?? (b.distanceKm ? { distanceKm: b.distanceKm, seuilKm: corps?.seuilKm || 20, voisinNom: b.voisin?.nom } : null);
          const instruction = depotInstructions.creer({
            barrageId: b.id,
            barrage: b,
            action: 'assignation',
            source: 'assignation',
            destinataire: { rang: 'reg', unite: b.reg, nom: `CMND Région ${b.reg}` },
            texte: consigne
              ? `Problème / Consigne : ${consigne}`
              : (bconflit?.distanceKm != null
                ? `Conflit de distance routière (${bconflit.distanceKm} km${bconflit.voisinNom ? ` avec ${bconflit.voisinNom}` : ''}) à traiter.`
                : `Barrage assigné au CMND Région ${b.reg} pour traitement.`),
            criteres: bconflit,
            auteur: identite(session),
          });
          journal.consigner({ session, action: 'assignation', avant: b, apres: b, details: { categorie: 'assignation', region: b.reg, consigne } });
          actualiserSuiviConflits(b.id, session, 'assignation', { consigne, instructionId: instruction.id });
          assignees.push({ id: b.id, nom: b.nom || b.id, region: b.reg, instructionId: instruction.id });
        }
        json(res, assignees.length ? 201 : 409, {
          assignees, ignores,
          ...(assignees.length ? {} : { erreur: 'Aucun barrage assigné : ' + ignores.map((x) => `${x.nom ?? x.id} (${x.raison})`).join(', ') }),
        });
        return true;
      }

      /**
       * LES ASSIGNATIONS — ce que le compte doit traiter, et ce qu'il a assigné.
       *
       *   GET  /api/assignations                       { aTraiter, suivi }
       *   GET  /api/assignations/:id/cmnd-cie          CMND Cie de la région (CMND Région)
       *   POST /api/assignations/:id/transmettre       { matricule } → au CMND Cie choisi
       *   POST /api/assignations/:id/traiter           { factionId?, commentaire }
       *
       * Chaque maillon garde sa date, son auteur, son destinataire et son statut
       * (ouverte, traitée, transmise) : la chaîne Super Admin → Région → Cie se
       * relit entière dans le suivi.
       */
      const presenterAssignation = (i) => {
        const b = depot.parId(i.barrageId);
        const enfants = depotInstructions.tous().filter((x) => x.parentId === i.id);
        return {
          id: i.id, barrageId: i.barrageId,
          barrage: b ? { id: b.id, nom: b.nom || b.id, route: b.route || '', lng: b.lng, lat: b.lat, reg: b.reg ?? null, cie: b.cie ?? null, factionId: b.factionId || null, intouchable: estIntouchable(b) } : { ...i.barrage, supprime: true },
          destinataire: destinataireDe(i),
          auteur: i.auteur, cree: i.cree, texte: i.texte,
          criteres: i.criteres ?? null,
          statut: i.decision === 'transmise' ? 'transmise' : i.statut,
          traiteePar: i.traiteePar, traiteeLe: i.traiteeLe, reponse: i.reponse,
          parentId: i.parentId ?? null,
          suite: enfants.map((x) => ({
            id: x.id, destinataire: destinataireDe(x), cree: x.cree,
            statut: x.decision === 'transmise' ? 'transmise' : x.statut, traiteePar: x.traiteePar, traiteeLe: x.traiteeLe, reponse: x.reponse,
          })),
        };
      };
      if (chemin === '/api/assignations' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const toutes = depotInstructions.tous().filter((i) => i.action === 'assignation');
        json(res, 200, {
          aTraiter: toutes.filter((i) => i.statut === 'ouverte' && estDestinataire(session, i)).map(presenterAssignation),
          suivi: toutes.filter((i) => i.auteur?.matricule === session.matricule).map(presenterAssignation).reverse(),
        });
        return true;
      }

      /**
       * LE SUIVI DU WORKFLOW — Super Admin seulement, en LECTURE seule.
       *
       * Chaque chaîne d'assignation, son responsable actuel, sa dernière
       * action et son historique, avec un statut lu en base (voir
       * serveur/suiviAssignations.mjs) : « Terminé » n'apparaît qu'une fois
       * l'opération réellement écrite et plus rien en attente de validation.
       * Rien ici ne permet d'agir sur un barrage : le Super Admin suit, le
       * commandement traite.
       */
      if (chemin === '/api/assignations/suivi' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        if (!superviseur(session)) {
          json(res, 403, { erreur: 'Le suivi des assignations est réservé au Super Admin.' });
          return true;
        }
        const instructions = depotInstructions.tous();
        const ids = new Set(instructions.filter((i) => i.action === 'assignation').map((i) => i.barrageId));
        const debut = instructions.filter((i) => i.action === 'assignation').map((i) => i.cree).sort()[0] ?? null;
        /* Une seule lecture du journal, de la plus récente à la plus ancienne. */
        const operations = new Map();
        if (debut) {
          for (const e of journal.dernieres(20000, (x) => ids.has(x.id) && ACTIONS_SUIVIES.has(x.action) && x.ts >= debut)) {
            if (!operations.has(e.id)) operations.set(e.id, []);
            operations.get(e.id).unshift(e);
          }
        }
        const items = suivreAssignations({
          instructions,
          operationsPar: (id) => operations.get(id) ?? [],
          demandesEnAttentePour: (barrageId, depuis) =>
            instructions.filter((i) => i.barrageId === barrageId && i.statut === 'ouverte' &&
              (i.action === 'modification' || i.action === 'suppression') && i.cree >= depuis).length +
            depotDemandes.ouvertesPour(barrageId).filter((d) => !d.cree || d.cree >= depuis).length,
          barrageParId: (id) => depot.parId(id),
        });
        json(res, 200, {
          items,
          totaux: {
            en_attente: items.filter((x) => x.statut === 'en_attente').length,
            en_cours: items.filter((x) => x.statut === 'en_cours').length,
            termine: items.filter((x) => x.statut === 'termine').length,
          },
        });
        return true;
      }

      /**
       * LES NOTIFICATIONS D'ÉVÉNEMENTS — voir serveur/notifications.mjs.
       *
       *   GET  /api/notifications            { items, nonLues } — les plus récentes d'abord
       *   POST /api/notifications/:id/lue    ouverte : lue pour CE compte
       *   GET  /api/notifications/flux       temps réel (text/event-stream)
       *
       * Le cloisonnement est celui de la carte, vérifié ici et non dans
       * l'écran : marquer lue une notification qu'on ne voit pas est refusé
       * comme si elle n'existait pas (404).
       */
      if (chemin === '/api/notifications' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const visibles = notificationsVisibles(session);
        const limite = Math.min(500, Math.max(1, Number(url.searchParams.get('limite')) || 200));
        const tri = [...visibles].sort((a, b) => String(b.maj ?? b.cree).localeCompare(String(a.maj ?? a.cree)));
        json(res, 200, {
          items: tri.slice(0, limite).map((n) => presenterNotification(n, session.matricule)),
          nonLues: visibles.filter((n) => !depotNotifications.estLue(n, session.matricule)).length,
          total: visibles.length,
        });
        return true;
      }
      const notificationLue = chemin.match(/^\/api\/notifications\/([\w-]+)\/lue$/);
      if (notificationLue && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const n = notificationsVisibles(session).find((x) => x.id === notificationLue[1]);
        if (!n) {
          json(res, 404, { erreur: 'Notification introuvable.' });
          return true;
        }
        const lue = depotNotifications.marquerLue(n.id, session.matricule);
        json(res, 200, {
          item: presenterNotification(lue, session.matricule),
          nonLues: notificationsVisibles(session).filter((x) => !depotNotifications.estLue(x, session.matricule)).length,
        });
        return true;
      }
      if (chemin === '/api/notifications/flux' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Content-Type-Options': 'nosniff',
          /* Un relais (nginx) ne doit pas retenir les événements en tampon. */
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 15000\n\n');
        const abonne = { jeton: S.jetonDe(req), res, fermer: null };
        /* Un commentaire régulier garde la connexion ouverte à travers les relais. */
        const battement = setInterval(() => res.write(': battement\n\n'), 25_000);
        battement.unref?.();
        abonne.fermer = () => {
          clearInterval(battement);
          abonnesFlux.delete(abonne);
          res.end();
        };
        abonnesFlux.add(abonne);
        req.on('close', () => {
          clearInterval(battement);
          abonnesFlux.delete(abonne);
        });
        return true;
      }
      const assignationCible = chemin.match(/^\/api\/assignations\/([\w-]+)\/(cmnd-cie|transmettre|traiter)$/);
      if (assignationCible) {
        if (!session) return refuseNonConnecte(json, res);
        const assignation = depotInstructions.parId(assignationCible[1]);
        if (!assignation || assignation.action !== 'assignation') {
          json(res, 404, { erreur: 'Assignation introuvable.' });
          return true;
        }
        if (!estDestinataire(session, assignation)) {
          json(res, 403, { erreur: 'Cette assignation est adressée à un autre commandement.' });
          return true;
        }
        if (assignation.statut !== 'ouverte') {
          json(res, 409, { erreur: 'Cette assignation est déjà traitée.' });
          return true;
        }
        const barrage = depot.parId(assignation.barrageId);
        if (!barrage) {
          json(res, 409, { erreur: 'Le barrage de cette assignation n’existe plus.' });
          return true;
        }
        const action = assignationCible[2];
        if (action === 'cmnd-cie' || action === 'transmettre') {
          if (session.rang !== 'reg') {
            json(res, 403, { erreur: 'Seul le CMND Région assigne un barrage à un CMND Cie.' });
            return true;
          }
          const cies = cmndCieDeRegion(session.unite, barrage);
          if (action === 'cmnd-cie' && req.method === 'GET') {
            json(res, 200, { region: session.unite, comptes: cies });
            return true;
          }
          if (action === 'transmettre' && req.method === 'POST') {
            const corps = await lireCorps(req, res);
            const cible = cies.find((c) => c.matricule === String(corps?.matricule ?? ''));
            if (!cible) {
              json(res, 403, { erreur: 'Ce compte n’est pas un CMND Cie autorisé de votre région.' });
              return true;
            }
            const consigne = String(corps?.texte ?? '').trim();
            const suite = depotInstructions.creer({
              barrageId: barrage.id, barrage, action: 'assignation', source: 'assignation',
              destinataire: { rang: 'cie', unite: cible.unite, matricule: cible.matricule, nom: cible.nom },
              parentId: assignation.id,
              texte: `Barrage assigné par le CMND Région ${session.unite} au CMND Cie ${cible.unite}${consigne ? ` : ${consigne}` : '.'}`,
              criteres: assignation.criteres ?? null,
              auteur: identite(session),
            });
            depotInstructions.traiter(assignation.id, {
              traiteePar: identite(session), decision: 'transmise',
              reponse: `Assigné au CMND Cie ${cible.unite}${consigne ? ` — ${consigne}` : ''}`,
            });
            journal.consigner({ session, action: 'assignation', avant: barrage, apres: barrage, details: { categorie: 'assignation', cie: cible.unite, matricule: cible.matricule, parentId: assignation.id } });
            actualiserSuiviConflits(barrage.id, session, 'transmission', { cie: cible.unite, consigne });
            json(res, 201, { assignation: presenterAssignation(suite), parent: presenterAssignation(depotInstructions.parId(assignation.id)) });
            return true;
          }
        }
        if (action === 'traiter' && req.method === 'POST') {
          const corps = await lireCorps(req, res);
          let compteRendu = String(corps?.commentaire ?? '').trim();
          let item = null;
          if (corps?.factionId) {
            const droit = droitFaction(session, barrage);
            if (!droit.ok) {
              json(res, droit.statut, { erreur: droit.erreur });
              return true;
            }
            if (session.rang === 'cie') {
              const ancienneNom = factionParId(barrage.factionId)?.nom ?? 'aucune';
              const nouvelleNom = factionParId(corps.factionId)?.nom ?? corps.factionId;
              const demande = depotDemandes.creer({
                barrageId: barrage.id,
                barrage,
                changements: [{
                  champ: 'factionId',
                  ancienne: barrage.factionId || null,
                  nouvelle: corps.factionId,
                  nomAncienne: ancienneNom,
                  nomNouvelle: nouvelleNom,
                }],
                raison: compteRendu || `Changement de faction proposé : ${ancienneNom} → ${nouvelleNom}`,
                auteur: identite(session),
                destinataire: { rang: 'reg', unite: barrage.reg, nom: `CMND Région ${barrage.reg}` },
              });
              depotInstructions.creer({
                barrageId: barrage.id,
                barrage,
                action: 'demande_approbation',
                source: 'workflow',
                destinataire: { rang: 'reg', unite: barrage.reg, nom: `CMND Région ${barrage.reg}` },
                texte: `Demande d'approbation soumise par CMND Cie ${session.unite} pour ${barrage.nom || barrage.id} (faction : ${nouvelleNom})`,
                auteur: identite(session),
              });
              const traitee = depotInstructions.traiter(assignation.id, {
                traiteePar: identite(session),
                reponse: `Proposition soumise au CMND Région : Faction ${nouvelleNom}${compteRendu ? ` — ${compteRendu}` : ''}`,
              });
              journal.consigner({
                session,
                action: 'soumettre-demande-approbation',
                avant: barrage,
                apres: barrage,
                details: { demandeId: demande.id, factionId: corps.factionId, region: barrage.reg },
              });
              actualiserSuiviConflits(barrage.id, session, 'demande_approbation', { demandeId: demande.id, factionId: corps.factionId });
              json(res, 201, {
                assignation: presenterAssignation(traitee),
                demande,
                enAttenteValidation: true,
                message: 'Proposition enregistrée et transmise au CMND Région pour validation.',
                items: actifs(session),
              });
              return true;
            }
            /* `changerFaction` clôt l'assignation elle-même (`terminerAssignationsDe`). */
            const r = changerFaction(session, barrage, corps.factionId, compteRendu);
            if (r.erreur) {
              json(res, r.statut, { erreur: r.erreur });
              return true;
            }
            item = r.item;
          }
          const traitee = item
            ? depotInstructions.parId(assignation.id)
            : cloreAssignation(session, assignation, compteRendu || 'Traité.');
          if (!item) {
            actualiserSuiviConflits(barrage.id, session, 'cloture', { compteRendu });
          }
          json(res, 200, { assignation: presenterAssignation(traitee), item, items: actifs(session) });
          return true;
        }
        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      /* ---- CONTRÔLE DE CONFLITS PRÉ-TRAITEMENT ---- */
      const matchAnalyseConflits = chemin.match(/^\/api\/barrages\/([\w-]+)\/analyse-conflits$/);
      if (matchAnalyseConflits && (req.method === 'GET' || req.method === 'POST')) {
        if (!session) return refuseNonConnecte(json, res);
        const b = depot.parId(matchAnalyseConflits[1]);
        if (!b || !estBarrage(b)) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }
        let seuilKm = seuilConflitKm;
        if (req.method === 'POST') {
          const corps = await lireCorps(req, res);
          if (Number.isFinite(Number(corps?.seuilKm)) && Number(corps.seuilKm) > 0) {
            seuilKm = Number(corps.seuilKm);
          }
        } else {
          const urlParams = new URL(req.url, 'http://localhost').searchParams;
          if (urlParams.has('seuilKm') && Number.isFinite(Number(urlParams.get('seuilKm')))) {
            seuilKm = Number(urlParams.get('seuilKm'));
          }
        }
        const rapport = analyserConflitsComplet({
          graphe,
          cible: b,
          barrages: depot.tous(),
          seuilKm,
        });
        json(res, 200, rapport);
        return true;
      }

      /* ---- DEMANDES D'APPROBATION (Workflow Cie → Région → Super Admin) ---- */
      if (chemin === '/api/demandes' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        let items = depotDemandes.tous();
        if (session.rang === 'reg') {
          items = items.filter((d) => d.barrage?.reg === session.unite || d.destinataireActuel?.unite === session.unite);
        } else if (session.rang === 'cie') {
          items = items.filter((d) => d.barrage?.cie === session.unite || d.auteurOriginal?.matricule === session.matricule || d.destinataireActuel?.unite === session.unite);
        } else if (session.rang === 'unite') {
          items = items.filter((d) => d.barrage?.bt === session.unite || d.auteurOriginal?.matricule === session.matricule);
        }
        const urlParams = new URL(req.url, 'http://localhost').searchParams;
        if (urlParams.has('statut')) {
          const st = urlParams.get('statut');
          items = items.filter((d) => d.statutWorkflow === st);
        }
        if (urlParams.has('barrageId')) {
          const bId = urlParams.get('barrageId');
          items = items.filter((d) => d.barrageId === bId);
        }
        json(res, 200, { items: [...items].reverse() });
        return true;
      }

      if (chemin === '/api/demandes' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (!peutEcrire(session)) return refuse(json, res, 'Compte en lecture seule : aucune écriture autorisée.');
        const corps = await lireCorps(req, res);
        const b = depot.parId(corps?.barrageId);
        if (!b || !estBarrage(b)) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }
        const raison = String(corps?.raison ?? corps?.commentaire ?? '').trim();
        const changements = Array.isArray(corps?.changements) ? corps.changements : [];
        if (!changements.length && !corps?.factionId) {
          json(res, 400, { erreur: 'Aucun changement proposé.' });
          return true;
        }
        if (corps?.factionId && !changements.some((c) => c.champ === 'factionId')) {
          changements.push({
            champ: 'factionId',
            ancienne: b.factionId || null,
            nouvelle: corps.factionId,
            nomAncienne: factionParId(b.factionId)?.nom ?? 'aucune',
            nomNouvelle: factionParId(corps.factionId)?.nom ?? corps.factionId,
          });
        }
        const destinataire = session.rang === 'cie'
          ? { rang: 'reg', unite: b.reg, nom: `CMND Région ${b.reg}` }
          : { rang: 'admin', unite: 'admin', nom: 'Super Admin' };

        const demande = depotDemandes.creer({
          barrageId: b.id,
          barrage: b,
          changements,
          raison,
          auteur: identite(session),
          destinataire,
        });

        depotInstructions.creer({
          barrageId: b.id,
          barrage: b,
          action: 'demande_approbation',
          source: 'workflow',
          destinataire,
          texte: `Demande d'approbation soumise par ${session.nom || session.unite} pour ${b.nom || b.id}${raison ? ` : ${raison}` : '.'}`,
          auteur: identite(session),
        });

        journal.consigner({
          session,
          action: 'creer-demande-approbation',
          avant: b,
          apres: b,
          details: { demandeId: demande.id, changements, workflow: true },
        });

        json(res, 201, { demande });
        return true;
      }

      const matchDemande = chemin.match(/^\/api\/demandes\/([\w-]+)(\/action|\/historique)?$/);
      if (matchDemande) {
        if (!session) return refuseNonConnecte(json, res);
        const id = matchDemande[1];
        const sousAction = matchDemande[2];
        const demande = depotDemandes.parId(id);
        if (!demande) {
          json(res, 404, { erreur: 'Demande introuvable.' });
          return true;
        }

        if (!sousAction && req.method === 'GET') {
          const barragePourAnalyse = {
            ...demande.barrage,
            ...Object.fromEntries((demande.changements || []).map((c) => [c.champ, c.nouvelle])),
          };
          const rapportConflits = analyserConflitsComplet({
            graphe,
            cible: barragePourAnalyse,
            barrages: depot.tous(),
            seuilKm: seuilConflitKm,
          });
          json(res, 200, { demande, rapportConflits });
          return true;
        }

        if (sousAction === '/historique' && req.method === 'GET') {
          json(res, 200, { id: demande.id, historique: demande.historique || [] });
          return true;
        }

        if ((sousAction === '/action' && req.method === 'POST') || (!sousAction && req.method === 'PATCH')) {
          const corps = await lireCorps(req, res);
          const action = String(corps?.action ?? '').trim();
          const commentaire = String(corps?.commentaire ?? corps?.raison ?? '').trim();
          const nouveauxChangements = Array.isArray(corps?.changements) ? corps.changements : null;

          if (!ACTIONS_WORKFLOW.includes(action)) {
            json(res, 400, { erreur: `Action non reconnue : ${action}` });
            return true;
          }

          if (action === 'approuver' && demande.auteurOriginal?.matricule === session.matricule) {
            json(res, 403, { erreur: 'Séparation des devoirs : l’auteur d’une demande ne peut pas l’approuver lui-même.' });
            return true;
          }

          if ((action === 'retourner' || action === 'rejeter' || action === 'retourner_region') && !commentaire) {
            json(res, 400, { erreur: 'Un commentaire explicatif est obligatoire pour retourner ou rejeter une demande.' });
            return true;
          }

          if (action === 'approuver' && session.rang !== 'reg' && session.rang !== 'admin') {
            json(res, 403, { erreur: 'Seul le CMND Région ou le Super Admin peut approuver une demande.' });
            return true;
          }

          if (action === 'rejeter' && session.rang !== 'admin' && session.rang !== 'reg') {
            json(res, 403, { erreur: 'Seul le Super Admin ou le CMND Région peut rejeter une demande.' });
            return true;
          }

          if (action === 'transmettre_admin' && session.rang !== 'reg') {
            json(res, 403, { erreur: 'Seul le CMND Région peut transmettre une demande au Super Admin.' });
            return true;
          }

          let destinataire = null;
          if (action === 'transmettre_admin') {
            destinataire = { rang: 'admin', unite: 'admin', nom: 'Super Admin' };
          } else if (action === 'retourner') {
            destinataire = { rang: demande.auteurOriginal?.rang ?? 'cie', unite: demande.auteurOriginal?.unite, nom: demande.auteurOriginal?.nom };
          } else if (action === 'retourner_region') {
            destinataire = { rang: 'reg', unite: demande.barrage?.reg, nom: `CMND Région ${demande.barrage?.reg}` };
          }

          const maj = depotDemandes.agir(id, {
            action,
            par: identite(session),
            commentaire,
            changements: nouveauxChangements,
            destinataire,
          });

          if (!maj) {
            json(res, 409, { erreur: 'Cette demande est déjà terminée ou n’a pas pu être mise à jour.' });
            return true;
          }

          let barrageMisAJour = null;
          if (action === 'approuver') {
            const barrageActuel = depot.parId(demande.barrageId);
            if (barrageActuel) {
              const avant = { ...barrageActuel };
              const champsAAppliquer = maj.changements || [];
              const modifs = {};
              for (const ch of champsAAppliquer) {
                modifs[ch.champ] = ch.nouvelle;
              }
              const nouveau = {
                ...barrageActuel,
                ...modifs,
                maj: new Date().toISOString(),
                majPar: identite(session),
              };
              depot.remplacer(barrageActuel.id, nouveau);
              barrageMisAJour = nouveau;
              journal.consigner({
                session,
                action: 'application-demande-approuvee',
                avant,
                apres: barrageMisAJour,
                details: { demandeId: maj.id, changements: champsAAppliquer, workflow: true },
              });
            }
          }

          if (destinataire) {
            depotInstructions.creer({
              barrageId: demande.barrageId,
              barrage: demande.barrage,
              action: 'demande_approbation',
              source: 'workflow',
              destinataire,
              texte: `Demande pour ${demande.barrage?.nom || demande.barrageId} : action « ${action} » par ${session.nom || session.unite}${commentaire ? ` (${commentaire})` : ''}`,
              auteur: identite(session),
            });
          }

          journal.consigner({
            session,
            action: `workflow-demande-${action}`,
            avant: demande.barrage,
            apres: barrageMisAJour ?? demande.barrage,
            details: { demandeId: maj.id, action, commentaire, nouveauStatut: maj.statutWorkflow },
          });

          if (barrageMisAJour) {
            recalculerSiPresent(barrageMisAJour.id);
            recalculerConflitsSiPresent();
            actualiserSuiviConflits(barrageMisAJour.id, session, `approbation_${action}`, { demandeId: maj.id, action });
          } else {
            actualiserSuiviConflits(demande.barrageId, session, `workflow_${action}`, { demandeId: maj.id, action });
          }

          json(res, 200, {
            demande: maj,
            barrage: barrageMisAJour,
            items: actifs(session),
          });
          return true;
        }
      }

      const modifBarrage = chemin.match(/^\/api\/barrages\/([\w-]+)\/modification$/);
      if (modifBarrage && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        const existant = depot.parId(modifBarrage[1]);
        if (!existant || !enService(existant)) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }
        if (!['barrage_fixe', 'barrage_mobile', 'barrage_vip'].includes(existant.type)) {
          json(res, 400, { erreur: "Ce repère n'est pas un barrage." });
          return true;
        }
        if (superviseur(session)) {
          json(res, 403, { erreur: REFUS_SUPERVISION });
          return true;
        }
        /* RBAC — la même règle que partout : périmètre, rôle, auteur. */
        if (!peutModifier(session, existant)) {
          json(res, 403, { erreur: motifRefus(session, existant) });
          return true;
        }

        const corps = await lireCorps(req, res);
        const analyse = analyserModification(session, existant, corps);
        if (analyse.erreur) {
          json(res, analyse.statut, { erreur: analyse.erreur });
          return true;
        }
        const { plan } = analyse;
        const apercu = presenterPlan(plan);

        /* ---- ENREGISTREMENT : les confirmations d'abord, rien n'est écrit avant. ---- */
        if (plan.autre && corps.remplacerIntouchable !== plan.autre.id) {
          json(res, 409, {
            code: 'intouchable_existant',
            erreur:
              `Cette Compagnie possède déjà un barrage intouchable (${plan.autre.nom || plan.autre.id}). ` +
              "Confirmez son remplacement par ce barrage pour l'enregistrer.",
            apercu,
          });
          return true;
        }
        if (plan.confirmerConflits && corps.accepterConflits !== true) {
          json(res, 409, {
            code: 'conflit_distance',
            erreur: `Conflit de distance : ${plan.conflits.length} poste(s) de même faction à moins de ${seuilConflitKm} km de route.`,
            apercu,
          });
          return true;
        }
        if (apercu.rien) {
          json(res, 200, { item: existant, rien: true, apercu });
          return true;
        }
        /* Le créneau a pu basculer entre l'analyse et l'écriture (six heures
           pile) : l'effectif calculé ne porterait plus sur le bon créneau. */
        if ((plan.eff.ajouter.length || plan.eff.retirer.length) && creneauDe(new Date()) !== plan.creneau) {
          json(res, 409, { erreur: 'Le créneau vient de changer : relancez l’aperçu avant d’enregistrer.' });
          return true;
        }

        const details = {
          barrageId: existant.id,
          avant: apercu.avant,
          apres: apercu.apres,
          effectif: {
            creneau: plan.creneau,
            date: plan.date,
            avant: plan.eff.actuel,
            apres: plan.eff.demande,
            ajoutes: apercu.effectif.ajouter.map((p) => p.matricule),
            retires: apercu.effectif.retirer.map((e) => e.matricule),
          },
          remplacerIntouchable: plan.autre?.id ?? null,
          conflitsAcceptes: plan.confirmerConflits ? plan.conflits.map((c) => ({ id: c.id, km: c.km })) : [],
          validation: plan.validePar ? `en_attente:${plan.validePar}` : 'appliquee',
        };

        /* 1. LA FICHE — directement, ou en UNE demande de validation qui porte
              tous les champs à la fois (jamais trois demandes séparées). */
        let demande = null;
        let item = existant;
        let remplace = null;
        const precedentAutre = plan.autre;
        if (plan.changements.length) {
          if (plan.validePar) {
            demande = mettreEnAttente({
              barrage: existant,
              aDecider: plan.validePar,
              action: 'modification',
              changements: plan.changements,
              corps,
              session,
              remplacerIntouchable: plan.autre?.id ?? null,
              details,
            });
          } else {
            if (plan.autre) remplace = retirerProtection(plan.autre, session);
            try {
              depot.remplacer(existant.id, plan.apres);
            } catch (err) {
              if (remplace) depot.remplacer(precedentAutre.id, precedentAutre);
              throw err;
            }
            item = plan.apres;
          }
        }

        /* 2. L'EFFECTIF — la relève s'applique tout de suite, comme la saisie
              unitaire : c'est une présence, pas une correction de fiche. Tout a
              été vérifié plus haut (brigade, disponibilité, règle des trois). */
        const ajoutes = [];
        const retires = [];
        try {
          depotElements.enBloc(() => {
            for (const e of plan.eff.retirer) {
              if (depotElements.supprimer(e.id)) retires.push(e.id);
            }
            for (const p of plan.eff.ajouter) {
              ajoutes.push(
                depotElements.creer({
                  barrageId: existant.id,
                  grade: p.grade,
                  nom: p.nom,
                  matricule: p.matricule,
                  auteur: identite(session),
                }),
              );
            }
          });
        } catch (err) {
          /* Tout ou rien : une relève à moitié écrite n'est pas laissée. */
          for (const e of ajoutes) depotElements.supprimer(e.id);
          if (item !== existant) depot.remplacer(existant.id, existant);
          if (remplace) depot.remplacer(precedentAutre.id, precedentAutre);
          if (demande) depotInstructions.traiter(demande.id, {
            traiteePar: identite(session),
            reponse: 'Annulée : l’effectif n’a pas pu être enregistré.',
            decision: null,
          });
          json(res, err.statut ?? 409, { erreur: `Modification non enregistrée : ${err.message}` });
          return true;
        }

        /* 3. LE JOURNAL — une entrée pour la modification entière (la demande
              a déjà la sienne, avec les mêmes détails). */
        if (!demande) {
          journal.consigner({
            session,
            action: !plan.changements.length
              ? 'modifier-effectif'
              : existant.lng !== item.lng || existant.lat !== item.lat
                ? 'deplacer'
                : 'modifier',
            avant: existant,
            apres: item,
            details,
          });
        } else if (ajoutes.length || retires.length) {
          journal.consigner({ session, action: 'modifier-effectif', avant: existant, apres: existant, details });
        }

        if (item !== existant) {
          recalculerSiPresent(item.id);
          recalculerConflitsSiPresent();
          actualiserSuiviConflits(
            item.id,
            session,
            existant.lng !== item.lng || existant.lat !== item.lat ? 'deplacer' : 'modifier',
            details,
          );
        } else if (demande) {
          actualiserSuiviConflits(existant.id, session, 'demande_approbation', details);
        }

        json(res, demande ? 202 : 200, {
          item,
          remplace: remplace ? { id: remplace.id, item: remplace } : null,
          demande,
          enAttente: Boolean(demande),
          effectif: { ajoutes: ajoutes.map(lireElement), retires },
          apercu,
        });
        return true;
      }

      /* Tout identifiant : ceux de démonstration finissent parfois par un point
         (« syn_bf_001_5y1i0. ») — avant, seuls [\w-] passaient, et ces barrages
         ne pouvaient être ni déplacés, ni modifiés, ni supprimés. */
      const modifBrut = chemin.match(/^\/api\/marquages\/([^/]+)$/);
      let idModif = null;
      try {
        idModif = modifBrut ? decodeURIComponent(modifBrut[1]) : null;
      } catch {
        idModif = null;
      }
      const modif = idModif ? [modifBrut[0], idModif] : null;
      if (modif) {
        if (!session) return refuseNonConnecte(json, res);

        const existant = depot.parId(modif[1]);
        if (!existant) {
          json(res, 404, { erreur: 'Marquage introuvable.' });
          return true;
        }

        if (superviseur(session) && estBarrage(existant) && (req.method === 'PATCH' || req.method === 'DELETE')) {
          json(res, 403, { erreur: REFUS_SUPERVISION });
          return true;
        }

        if (!peutModifier(session, existant)) {
          json(res, 403, { erreur: motifRefus(session, existant) });
          return true;
        }

        if (req.method === 'DELETE') {
          if (estIntouchable(existant)) {
            json(res, 403, { erreur: 'Un barrage fixe intouchable ne peut pas être supprimé : c’est le point permanent de la compagnie.' });
            return true;
          }
          /**
           * AUCUN GARDE SUPPLÉMENTAIRE POUR LES BARRAGES.
           *
           * Le droit de suppression est celui de `peutModifier`, vérifié juste
           * au-dessus : périmètre, écriture, rôle. Rien d'autre.
           *
           * Il y avait ici un second garde qui exigeait d'être l'AUTEUR du
           * barrage (ou administrateur), et de plus que le barrage soit encore
           * `en_attente`. Les deux conditions étaient fausses :
           *
           *   — l'auteur : un poste posé par erreur par un collègue devenait
           *     indéracinable pour le chef, qui a pourtant autorité sur son
           *     périmètre. Le droit de gestion ne se transmet pas avec la
           *     paternité d'une saisie ;
           *   — le statut : un barrage posé par l'administrateur passe
           *     immédiatement en `approuve` (voir la pose, plus haut), donc la
           *     condition « en_attente » le rendait insupprimable par
           *     quiconque, y compris son auteur. Un poste ajouté à la main
           *     devait toujours pouvoir être défait.
           *
           * Le retrait CONCERTÉ d'un poste en service existe toujours et reste
           * dans OPTIMISATION : c'est une décision collective, pas la même
           * chose qu'effacer un repère de sa propre circonscription.
           */
          /**
           * UN BARRAGE NE DISPARAÎT PLUS SANS VALIDATION.
           *
           * Même règle que la modification, et pour la même raison : un poste
           * du dispositif n'est pas un repère de travail qu'on efface seul.
           * La demande part vers l'autre bord — l'administration si c'est une
           * unité qui demande, le commandement concerné si c'est
           * l'administration — et c'est l'ACCEPTATION qui supprime réellement,
           * par le chemin qui existait déjà (`action: 'suppression'` dans
           * PATCH /api/instructions/:id).
           *
           * Les autres marquages — points noirs, congestions — restent
           * effaçables directement : ce sont des relevés de terrain, pas des
           * postes en service.
           */
          const valideRetrait = estBarrage(existant) ? validateurPour(session, existant) : null;
          if (valideRetrait) {
            const demande = mettreEnAttente({
              barrage: existant,
              aDecider: valideRetrait,
              action: 'suppression',
              corps: null,
              session,
            });
            /**
             * LE POSTE PORTE SON ÉTAT : « suppression en attente ».
             *
             * `decisionOptimisation: 'a_supprimer'` dit exactement cela, et le
             * dit déjà partout — la carte y pose son repère « ✗ », la bulle
             * annonce « Retrait proposé — en attente du commandant », les
             * listes le comptent à part. Inventer un second champ pour le même
             * sens aurait donné deux vérités à tenir d'accord.
             *
             * Le poste ne bouge pas d'un autre champ : position, rattachement,
             * caractéristiques, éléments et date de création restent intacts.
             */
            const enAttenteDeRetrait = {
              ...existant,
              decisionOptimisation: 'a_supprimer',
              majPar: identite(session),
            };
            depot.remplacer(existant.id, enAttenteDeRetrait);
            json(res, 202, { item: enAttenteDeRetrait, demande, enAttente: true });
            return true;
          }

          depot.supprimer(existant.id);
          // Un barrage supprimé emporte ses alertes et ses conflits : rien à acquitter sur un repère qui n'existe plus.
          if (estBarrage(existant)) {
            depotAlertes.supprimerConcernant(existant.id);
            depotConflitsPlanification.supprimerConcernant(existant.id);
            clore(existant, session, 'Poste retiré de la carte.');
          }
          journal.consigner({ session, action: 'supprimer', avant: existant, apres: null });
          json(res, 200, { supprime: existant.id });
          return true;
        }

        if (req.method === 'PATCH') {
          const corps = await lireCorps(req, res);

          if (estIntouchable(existant)) {
            const bouge =
              (corps.lng != null && Number(corps.lng) !== existant.lng) ||
              (corps.lat != null && Number(corps.lat) !== existant.lat) ||
              (corps.longitude != null && Number(corps.longitude) !== existant.lng) ||
              (corps.latitude != null && Number(corps.latitude) !== existant.lat);
            if (bouge && !corps.conflitInterRegionBfi && !corps.autoriserBfi) {
              json(res, 403, {
                erreur:
                  'Un barrage intouchable ne peut pas être déplacé : sa position est définitive ' +
                  '(point permanent de la compagnie).',
              });
              return true;
            }
          }

          /* UNE FACTION INCONNUE EST REFUSÉE, pas effacée : `normaliser` ramène
             toute valeur hors liste à « aucune faction », ce qui retirerait en
             silence la faction du poste. Seules les factions définies
             (serveur/factions.mjs) sont admises ; « '' » ou null la retirent. */
          if (typeof corps.factionId === 'string' && corps.factionId !== '' && !factionParId(corps.factionId)) {
            json(res, 400, { erreur: `Faction inconnue : « ${corps.factionId} ».` });
            return true;
          }

          /**
           * Le statut de validation d'un barrage (approuvé / à modifier /
           * annulé) est une décision de commandement central, pas une
           * correction de fiche ordinaire : seul un administrateur peut le
           * faire changer, même à l'intérieur de son propre périmètre.
           */
          if (
            corps.statutBarrage !== undefined &&
            corps.statutBarrage !== existant.statutBarrage &&
            session.rang !== 'admin'
          ) {
            json(res, 403, {
              erreur:
                "Seul un administrateur peut valider, annuler ou demander la modification d'un barrage.",
            });
            return true;
          }

          /**
           * Diffuser un marquage hors de sa région (`partage`) lève le
           * cloisonnement de lecture pour CE marquage — voir `visibles()`.
           * Décision d'escalade, réservée au chef de région et à l'admin :
           * un chef de compagnie ou de brigade ne décrète pas seul qu'un
           * événement devient visible national.
           */
          if (
            corps.partage !== undefined &&
            corps.partage !== existant.partage &&
            session.rang !== 'admin' &&
            session.rang !== 'reg'
          ) {
            json(res, 403, {
              erreur:
                'Seuls un chef de région ou un administrateur peuvent diffuser un marquage hors de sa région.',
            });
            return true;
          }

          // Une position n'est acceptée qu'après le même contrôle qu'à la pose.
          let rattachement = { bt: existant.bt, cie: existant.cie, reg: existant.reg };
          let pt = [existant.lng, existant.lat];

          if (corps.lng != null || corps.lat != null) {
            /* MÊME CONTRÔLE QU'À LA POSE, par la même fonction : un
               déplacement pouvait sinon emmener un poste là où la pose
               l'aurait refusé. Voir `coordonneesValides`. */
            const propose = coordonneesValides({
              lng: corps.lng ?? existant.lng,
              lat: corps.lat ?? existant.lat,
            });
            if (!propose) {
              json(res, 400, { erreur: REFUS_COORDONNEES });
              return true;
            }
            pt = propose;

            const verdict = controler(circonscriptions, session, pt);
            if (verdict !== 'autorise') {
              json(res, 403, { erreur: motifPerimetre(session, verdict) });
              return true;
            }
            rattachement = rattacher(session, pt);

            /* Et le déplacement ne doit pas rendre orphelin un poste qui ne
               l'était pas : hors territoire, il deviendrait ingérable. */
            if (!rattachement?.bt) {
              json(res, 400, { erreur: REFUS_HORS_TERRITOIRE });
              return true;
            }
          }

          const item = normaliser(
            {
              ...existant,
              ...corps,
              lng: pt[0],
              lat: pt[1],
              type: existant.type,
              // Un barrage exceptionnel ne se décrète qu'à la création (voir
              // POST /api/marquages) : une modification ne peut ni le devenir
              // ni changer de mission a posteriori.
              exceptionnel: existant.exceptionnel,
              missionId: existant.missionId,
              // Même principe : l'origine (Assistant ou pose manuelle) ne se
              // décrète qu'à la création, jamais réécrite ensuite.
              viaAssistant: existant.viaAssistant,
              // Déjà validé plus haut (rang autorisé) ; sinon la valeur reste inchangée.
              partage: corps.partage !== undefined ? corps.partage === true : existant.partage,
            },
            {
              id: existant.id,
              ...rattachement,
              auteur: existant.auteur ?? identite(session),
              cree: existant.cree,
            },
          );
          item.majPar = identite(session); // qui a corrigé, et non qui a créé
          /* `normaliser` ramène le sous-type d'un barrage (`none`) sur la
             première catégorie de zahma : la demande de validation affichait
             alors un changement que personne n'avait demandé. */
          if (existant.type !== 'zahma' && corps.sousType === undefined) item.sousType = existant.sousType;

          /* LE PK SUIT LA POSITION, il ne se saisit pas : un déplacement ou un
             changement d'axe par ce chemin le rend caduc. Il est recalculé si
             la route est une voie du réseau, effacé sinon — jamais laissé faux. */
          if (item.lng !== existant.lng || item.lat !== existant.lat || item.route !== existant.route) {
            const lu = graphe && item.route && routeExiste(graphe, item.route)
              ? recalerPosition(graphe, item.lng, item.lat, { route: item.route, rayonKm: 30 })
              : null;
            item.pk = lu && !lu.erreur ? lu.pk : null;
          } else {
            item.pk = existant.pk ?? null;
          }

          /* UN SEUL INTOUCHABLE PAR COMPAGNIE — ce chemin ne doit pas pouvoir en
             créer un second (`protection: 'intouchable'` écrit à la main). */
          if (estIntouchable(item) && (!estIntouchable(existant) || item.cie !== existant.cie)) {
            const deja = autreIntouchableDeLaCompagnie(depot.tous(), item.cie, item.id);
            if (deja) {
              json(res, 409, {
                code: 'intouchable_existant',
                erreur:
                  `La compagnie ${item.cie} possède déjà son barrage intouchable (${deja.nom || deja.id}). ` +
                  'Utilisez « Modifier barrage » pour le remplacer.',
                existant: { id: deja.id, nom: deja.nom || '', lng: deja.lng, lat: deja.lat },
              });
              return true;
            }
          }

          /**
           * RIEN N'EST ÉCRIT TANT QUE L'ADMINISTRATION N'A PAS CONFIRMÉ.
           *
           * Une correction de fiche demandée par une unité ne modifie plus le
           * barrage officiel : elle ouvre une DEMANDE, qui porte l'ancienne et
           * la nouvelle valeur de chaque champ touché. La carte, les calculs
           * et les autres utilisateurs continuent de voir la version
           * officielle — c'est tout l'objet du dispositif.
           *
           * L'administrateur, lui, écrit directement : il est le validateur,
           * lui demander de se confirmer à lui-même n'ajouterait qu'un clic et
           * une ligne d'historique sans auteur distinct.
           *
           * LES CONTRÔLES ONT DÉJÀ EU LIEU. Périmètre, coordonnées, rang requis
           * pour le statut ou la diffusion : tout ce qui précède s'est appliqué
           * à la demande. On ne met donc pas en attente une modification qui
           * serait de toute façon refusée — le refus reste immédiat, et motivé.
           */
          const SANS_INTERET = new Set(['majPar', 'maj', 'id', 'cree', 'auteur']);
          const changements = Object.keys(item)
            .filter((champ) => !SANS_INTERET.has(champ))
            .filter((champ) => JSON.stringify(item[champ] ?? null) !== JSON.stringify(existant[champ] ?? null))
            .map((champ) => ({ champ, ancienne: existant[champ] ?? null, nouvelle: item[champ] ?? null }));

          const validePar = estBarrage(existant) ? validateurPour(session, existant) : null;
          if (validePar && changements.length) {
            const demande = mettreEnAttente({
              barrage: existant,
              aDecider: validePar,
              action: 'modification',
              changements,
              corps,
              session,
            });
            /* 202 : reçu, pas appliqué. Et l'item RENVOYÉ est l'officiel, celui
               qui n'a pas bougé — l'écran qui l'affiche revient donc de
               lui-même à la valeur en vigueur. */
            /* La position demandée, évaluée sans rien écrire : qui l'a demandée
               sait déjà si elle règle ses conflits (statuts mis à jour à
               l'approbation, par la même réévaluation que pour l'administration). */
            let reevaluation = null;
            if (estBarrage(existant) && (existant.lng !== item.lng || existant.lat !== item.lat)) {
              try {
                const s = Number(corps.seuilKm);
                reevaluation = depotSuiviConflits.evaluerPosition({
                  barrageId: existant.id, lng: item.lng, lat: item.lat, graphe, depotBarrages: depot,
                  seuilKm: Number.isFinite(s) && s > 0 && s <= 200 ? s : seuilConflitKm,
                });
              } catch (err) {
                console.error(`  ! évaluation de la position demandée (${existant.id}) : ${err.message}`);
              }
            }
            json(res, 202, { item: existant, demande, enAttente: true, reevaluation });
            return true;
          }

          depot.remplacer(existant.id, item);
          let reevaluation = null;
          journal.consigner({
            session,
            /* Un déplacement se lit autrement qu'une correction de fiche : le
               distinguer évite de relire les coordonnées pour le comprendre. */
            action:
              existant.lng !== item.lng || existant.lat !== item.lat ? 'deplacer' : 'modifier',
            avant: existant,
            apres: item,
          });
          if (estBarrage(item)) {
            recalculerSiPresent(item.id);
            recalculerConflitsSiPresent();
            if (existant.lng !== item.lng || existant.lat !== item.lat) {
              terminerAssignationsDe(session, item.id, session, 'Barrage déplacé.');
              /* LA POSITION A CHANGÉ : les conflits de CE barrage sont réévalués
                 sur ses nouvelles coordonnées (résolus à partir du seuil, nouveaux
                 détectés) — sans relancer d'optimisation, sans toucher aux autres. */
              reevaluation = actualiserSuiviConflits(item.id, session, 'deplacer', null, { seuilKm: corps.seuilKm })?.reevaluation ?? null;
            }
          }
          /* Le bilan de la réévaluation guide l'étape suivante (voir actualiserApresOperation). */
          json(res, 200, { item, reevaluation });
          return true;
        }

        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      /**
       * Instructions de l'administrateur sur un barrage précis (approuver,
       * déplacer, annuler…). Lecture ouverte à toute session : chacun doit
       * pouvoir voir ce qui le concerne, filtré côté client comme les alertes
       * — écriture (créer/rouvrir/supprimer) réservée à l'admin, sauf marquer
       * « traitée », qui revient à l'unité concernée elle-même.
       */
      /**
       * NOTIFICATIONS VISIBLES PAR CETTE SESSION.
       *
       * Le même cloisonnement que la carte, et par la même fonction
       * (`dansSonUnite`) : un commandant de compagnie voit ce qui concerne sa
       * compagnie, un commandant de région sa région, l'administrateur tout.
       * Sans ce filtre la route renvoyait TOUT à qui la demandait — supportable
       * quand elle n'avait aucune interface, inacceptable maintenant qu'elle en
       * a une.
       *
       * L'AUTEUR VOIT AUSSI CE QU'IL A ÉMIS, même hors de son périmètre : sans
       * cela un Super Admin ne pourrait pas relire ses propres décisions, ni
       * savoir ce que le commandant en a fait.
       */
      if (chemin === '/api/instructions' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        /* Rattrapage avant de rendre la liste : voir reconcilierSignalements. */
        reconcilierSignalements(session);
        const miennes = depotInstructions
          .tous()
          .filter(
            (n) => (n.action === 'assignation'
              /* Une assignation se lit par son destinataire, son auteur et l'administration. */
              ? estDestinataire(session, n) || session.rang === 'admin'
              : dansSonUnite(session, n.barrage)) ||
              n.auteur?.matricule === session.matricule,
          );
        json(res, 200, { items: miennes });
        return true;
      }

      if (chemin === '/api/instructions' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'Seul un administrateur peut donner une instruction.' });
          return true;
        }

        const corps = await lireCorps(req, res);
        const barrage = depot.parId(corps.barrageId);
        if (!barrage || !estBarrage(barrage)) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return true;
        }

        const texteInstruction = String(corps.texte ?? '').trim();
        if (!texteInstruction) {
          json(res, 400, { erreur: "Le texte de l'instruction est obligatoire." });
          return true;
        }

        const instruction = depotInstructions.creer({
          barrageId: barrage.id,
          barrage,
          texte: texteInstruction,
          auteur: identite(session),
        });
        json(res, 201, { instruction });
        return true;
      }

      /**
       * RÉCLAMER UNE MODIFICATION DÉJÀ CONFIRMÉE.
       *
       * Le chef de région constate un changement appliqué chez lui et le
       * conteste. La réclamation N'ANNULE RIEN : elle ouvre un dossier qui
       * pointe la modification, et la chaîne reste entière et lisible —
       * demande, confirmation, réclamation. Défaire automatiquement serait
       * donner à la contestation le pouvoir qu'on vient de refuser à la
       * demande.
       *
       * Qui peut réclamer : le chef de RÉGION dont relève le barrage, et
       * l'administrateur. Un chef de compagnie ou de brigade remonte par la
       * voie hiérarchique — c'est ce que dit le cahier des charges, et c'est
       * aussi ce qui évite qu'une même modification soit contestée trois fois
       * à trois échelons.
       */
      const reclamationCible = chemin.match(/^\/api\/instructions\/([\w-]+)\/reclamation$/);
      if (reclamationCible && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const modification = depotInstructions.parId(reclamationCible[1]);
        if (!modification) {
          json(res, 404, { erreur: 'Modification introuvable.' });
          return true;
        }
        if (modification.action !== 'modification' || modification.decision !== 'acceptee') {
          json(res, 409, {
            erreur: 'Seule une modification CONFIRMÉE peut faire l’objet d’une réclamation.',
          });
          return true;
        }
        if (session.rang !== 'admin' && session.rang !== 'reg') {
          json(res, 403, {
            erreur: 'Seul un chef de région ou un administrateur peut réclamer un changement.',
          });
          return true;
        }
        if (!dansSonUnite(session, modification.barrage)) {
          json(res, 403, { erreur: motifRefus(session, modification.barrage) });
          return true;
        }

        const corps = await lireCorps(req, res);
        const reclamation = depotInstructions.creer({
          barrageId: modification.barrageId,
          barrage: modification.barrage,
          action: 'reclamation',
          aDecider: 'admin',
          modificationId: modification.id,
          motif: typeof corps.motif === 'string' ? corps.motif : '',
          texte:
            `Réclamation sur ${modification.barrage?.nom || 'ce poste'} : ` +
            `${typeof corps.commentaire === 'string' && corps.commentaire.trim()
              ? corps.commentaire
              : 'le changement confirmé est contesté.'}`,
          auteur: identite(session),
          source: 'reclamation',
        });
        journal.consigner({
          session,
          action: 'reclamation',
          avant: modification.barrage,
          apres: null,
        });
        json(res, 201, { reclamation });
        return true;
      }

      const instructionId = chemin.match(/^\/api\/instructions\/([\w-]+)$/);
      if (instructionId) {
        if (!session) return refuseNonConnecte(json, res);

        const instruction = depotInstructions.parId(instructionId[1]);
        if (!instruction) {
          json(res, 404, { erreur: 'Instruction introuvable.' });
          return true;
        }

        if (req.method === 'PATCH') {
          const corps = await lireCorps(req, res);

          if (corps.action === 'rouvrir') {
            if (session.rang !== 'admin') {
              json(res, 403, { erreur: 'Seul un administrateur peut rouvrir une instruction.' });
              return true;
            }
            json(res, 200, { instruction: depotInstructions.rouvrir(instruction.id) });
            return true;
          }

          /* Une assignation se traite par son DESTINATAIRE, et par lui seul. */
          if (instruction.action === 'assignation' && !estDestinataire(session, instruction)) {
            json(res, 403, { erreur: 'Cette assignation est traitée par le commandement à qui elle est adressée.' });
            return true;
          }
          // Trancher est réservé au périmètre concerné (ou à un admin).
          if (instruction.action !== 'assignation' && !dansSonUnite(session, instruction.barrage)) {
            json(res, 403, { erreur: 'Cette notification ne relève pas de votre périmètre.' });
            return true;
          }

          /**
           * UN NOUVEAU BARRAGE POSÉ PAR UNE UNITÉ S'APPROUVE PLUS HAUT.
           *
           * Le périmètre suffit pour les autres cas — un commandant tranche une
           * proposition de retrait chez lui. Mais approuver sa propre pose
           * n'est pas une validation : c'est une signature au bas de sa propre
           * demande.
           */
          if (instruction.aDecider === 'admin' && session.rang !== 'admin') {
            json(res, 403, {
              erreur:
                "Cette validation revient à l'administrateur : elle porte sur une demande qui lui est adressée.",
            });
            return true;
          }

          /**
           * NUL NE CONTRESIGNE SA PROPRE DEMANDE — dans les deux sens.
           *
           * La validation va de l'unité vers l'administration ET de
           * l'administration vers le commandement concerné. Dans les deux cas
           * elle n'a de sens que si celui qui répond n'est pas celui qui a
           * demandé : un administrateur qui confirmerait sa propre
           * modification n'aurait rien validé, il aurait écrit en deux temps.
           */
          if (
            instruction.aDecider &&
            instruction.auteur?.matricule &&
            instruction.auteur.matricule === session.matricule
          ) {
            json(res, 403, {
              erreur:
                'Vous êtes l’auteur de cette demande : elle doit être tranchée par le bord opposé.',
            });
            return true;
          }

          /**
           * ET LE BORD OPPOSÉ EST BIEN CELUI QU'ON ATTEND.
           *
           * `aDecider: 'unite'` désigne le commandement du poste — région ou
           * compagnie. Un chef de brigade n'arbitre pas une décision de
           * commandement, ici comme partout ailleurs dans ce panneau.
           */
          if (instruction.aDecider === 'unite' && session.rang === 'unite') {
            json(res, 403, {
              erreur:
                'Cette validation revient au commandement de région ou de compagnie concerné.',
            });
            return true;
          }

          /**
           * ACCEPTER / REFUSER — et c'est ICI que la décision prend effet.
           *
           * Le Super Admin n'a rien effacé : il a proposé. Une proposition de
           * suppression acceptée déclenche le retrait réel, par le MÊME chemin
           * que la suppression ordinaire (`depot.supprimer` + purge des alertes
           * + journal), pour qu'il n'existe qu'une seule façon de faire
           * disparaître un barrage.
           *
           * Un refus rend le poste à son état d'avant : la marque
           * `decisionOptimisation` retombe à `aucune`, le repère redevient
           * ordinaire sur la carte.
           */
          const decision =
            corps.action === 'accepter'
              ? 'acceptee'
              : corps.action === 'refuser'
                ? 'refusee'
                : null;

          const barrage = depot.parId(instruction.barrageId);
          if (decision && barrage) {
            if (instruction.action === 'nouveau_barrage') {
              /**
               * APPROUVER MET LE POSTE EN SERVICE ; REFUSER LE RETIRE.
               *
               * Un refus qui laisserait le barrage en place ne voudrait rien
               * dire : il resterait sur la carte, dans les calculs de distance
               * et dans les rosters, avec pour seule trace une notification
               * classée. Le retrait passe par le MÊME chemin que partout
               * ailleurs — dépôt, alertes, conflits, journal.
               */
              if (decision === 'acceptee') {
                const approuve = {
                  ...barrage,
                  statutBarrage: 'approuve',
                  majPar: identite(session),
                };
                depot.remplacer(barrage.id, approuve);
                journal.consigner({ session, action: 'modifier', avant: barrage, apres: approuve });
              } else {
                depot.supprimer(barrage.id);
                depotAlertes.supprimerConcernant(barrage.id);
                depotConflitsPlanification.supprimerConcernant(barrage.id);
                journal.consigner({ session, action: 'supprimer', avant: barrage, apres: null });
                /**
                 * AUCUN RECALCUL APRÈS UN RETRAIT.
                 *
                 * Retirer un poste ne change AUCUNE distance entre deux autres
                 * postes : ses propres alertes viennent d'être purgées, et il
                 * n'existe plus de paire à réexaminer. Le recalcul complet qui
                 * se trouvait ici coûtait la seconde et demie habituelle pour
                 * réécrire exactement le même fichier.
                 */
              }
            } else if (instruction.action === 'modification') {
              /**
               * LA MODIFICATION DEMANDÉE PREND EFFET ICI, ET NULLE PART AILLEURS.
               *
               * Tant que l'administration n'a pas confirmé, le barrage officiel
               * n'a pas bougé d'un champ : la demande ne portait que l'ancienne
               * et la nouvelle valeur. C'est cette acceptation qui écrit — au
               * même endroit et par le même chemin que toute autre écriture,
               * pour qu'il n'existe qu'une seule façon de modifier un poste.
               *
               * TROIS GARDES, et chacune ferme un scénario réel :
               *
               *   le RANG        seul un administrateur confirme. Le contrôle
               *                  est répété ici parce que cette branche écrit :
               *                  une garde plus haut protège la route, pas
               *                  l'écriture.
               *   l'ÉTAT DE DÉPART  entre la demande et la confirmation,
               *                  quelqu'un a pu corriger la fiche. Appliquer
               *                  quand même écraserait son travail sans que
               *                  personne ne le sache ; on refuse, et on dit
               *                  quel champ a bougé.
               *   le DOUBLON     une demande déjà tranchée ne se rejoue pas
               *                  (garde plus haut : `statut === 'traitee'`).
               */
              if (decision === 'acceptee') {
                /* Le destinataire a déjà été vérifié plus haut (`aDecider`,
                   auteur, rang) : la validation va dans les deux sens, et ce
                   n'est donc plus « admin seul » — c'est « pas l'auteur, et le
                   bord désigné ». */
                const changements = Array.isArray(instruction.changements)
                  ? instruction.changements
                  : [];
                const perime = changements.find(
                  (c) => JSON.stringify(barrage[c.champ] ?? null) !== JSON.stringify(c.ancienne ?? null),
                );
                if (perime) {
                  json(res, 409, {
                    erreur:
                      `Le barrage a changé depuis la demande : « ${perime.champ} » ne vaut plus ` +
                      `ce qui était proposé. Demandez une nouvelle modification.`,
                  });
                  return true;
                }

                const nouvelles = Object.fromEntries(changements.map((c) => [c.champ, c.nouvelle]));
                /* Le RATTACHEMENT fait partie de la demande : un poste déplacé
                   d'une brigade à l'autre doit changer de brigade à
                   l'acceptation. `normaliser` le prend du contexte, pas du corps —
                   on le lui donne donc depuis les valeurs acceptées. */
                const ctx = {
                  id: barrage.id,
                  bt: 'bt' in nouvelles ? nouvelles.bt : barrage.bt,
                  cie: 'cie' in nouvelles ? nouvelles.cie : barrage.cie,
                  reg: 'reg' in nouvelles ? nouvelles.reg : barrage.reg,
                  auteur: barrage.auteur,
                  cree: barrage.cree,
                };
                const modifie = normaliser(
                  { ...barrage, ...nouvelles, majPar: identite(session) },
                  ctx,
                );

                /* UN SEUL INTOUCHABLE PAR COMPAGNIE, revérifié à l'acceptation :
                   entre la demande et maintenant, un autre a pu le devenir. Le
                   remplacement n'a lieu que si la demande le portait, confirmé
                   par son auteur, et pour CE poste-là. */
                let remplaceAcc = null;
                if (estIntouchable(modifie) && (!estIntouchable(barrage) || modifie.cie !== barrage.cie)) {
                  const deja = autreIntouchableDeLaCompagnie(depot.tous(), modifie.cie, barrage.id);
                  if (deja && instruction.remplacerIntouchable !== deja.id) {
                    json(res, 409, {
                      code: 'intouchable_existant',
                      erreur:
                        `La compagnie ${modifie.cie} a maintenant un autre barrage intouchable ` +
                        `(${deja.nom || deja.id}) que la demande ne prévoyait pas de remplacer. ` +
                        'Demandez une nouvelle modification.',
                    });
                    return true;
                  }
                  if (deja) remplaceAcc = retirerProtection(deja, session);
                }
                depot.remplacer(barrage.id, modifie);
                journal.consigner({
                  session,
                  action: 'modifier',
                  avant: barrage,
                  apres: modifie,
                  details: {
                    demande: instruction.id,
                    remplacerIntouchable: remplaceAcc?.id ?? null,
                  },
                });
                if (estBarrage(modifie)) {
                  recalculerSiPresent(modifie.id);
                  recalculerConflitsSiPresent();
                }
                /* Le déplacement demandé par le commandement assigné est
                   maintenant RÉEL : son assignation est traitée. */
                const deplace = modifie.lng !== barrage.lng || modifie.lat !== barrage.lat;
                if (instruction.auteur && (deplace || modifie.factionId !== barrage.factionId)) {
                  terminerAssignationsDe(
                    session, barrage.id, instruction.auteur,
                    `${deplace ? 'Déplacement' : 'Modification'} validé par ${session.nom || 'l’administration'}.`,
                    instruction.auteur,
                  );
                }
              }
              /* Un REFUS n'écrit rien du tout : le barrage n'a jamais bougé, il
                 n'y a donc rien à rendre à son état d'avant. La demande reste
                 dans l'historique avec son motif de refus. */
            } else if (instruction.action === 'retrait_optimisation') {
              /**
               * LE COMMANDEMENT TRANCHE L'OPTIMISATION AUTOMATIQUE.
               *
               * ACCEPTER ne supprime rien : le poste est DÉJÀ sorti du service
               * (`retire_optimisation`) depuis l'application. L'acceptation ne
               * fait que le confirmer, et le consigne dans la fiche pour qu'on
               * sache, plus tard, que ce retrait a été validé et par qui — sans
               * avoir à ressortir la notification.
               *
               * REFUSER rend le poste à son état d'avant, par le MÊME chemin
               * que le bouton « Restaurer » du panneau. C'est le cas qui rend
               * l'automatisme acceptable : une optimisation appliquée trop vite
               * se défait entièrement, sans rien ressaisir.
               */
              if (decision === 'acceptee') {
                const confirme = {
                  ...barrage,
                  optimisationAuto: {
                    ...(barrage.optimisationAuto ?? {}),
                    valide: true,
                    valideLe: new Date().toISOString(),
                    validePar: identite(session),
                  },
                  majPar: identite(session),
                  maj: new Date().toISOString(),
                };
                depot.remplacer(barrage.id, confirme);
                journal.consigner({ session, action: 'modifier', avant: barrage, apres: confirme });
              } else {
                restaurerDepuisOptimisation(barrage, session, 'refus_optimisation');
                /* Le poste REVIENT dans le dispositif : ses rapprochements
                   avec les autres redeviennent vrais, et doivent donc être
                   recalculés — contrairement à un retrait, où il n'y avait
                   plus aucune paire à réexaminer. */
                recalculerSiPresent();
              }
            } else if (decision === 'acceptee' && instruction.action === 'suppression') {
              /**
               * RETIRÉ DU SERVICE — ET NON EFFACÉ DU FICHIER.
               *
               * `depot.supprimer` faisait disparaître la ligne : avec elle
               * partaient la position, le rattachement, la date de création et
               * la possibilité même de dire « il y avait un poste ici ». Le
               * barrage change donc d'ÉTAT (`statutBarrage: 'supprime'`) et
               * garde tout le reste, plus la trace de qui l'a retiré et quand.
               *
               * Il sort des listes opérationnelles : `/api/marquages` ne le
               * rend plus sauf demande expresse (`?archives=1`). La carte, les
               * calculs de distance et les rosters continuent donc de ne voir
               * que le dispositif en service, sans qu'aucun ait à connaître ce
               * nouvel état — c'est ce qui rend ce changement sûr.
               *
               * Ses alertes et ses conflits sont purgés : ils désignaient un
               * poste en service, et il ne l'est plus.
               */
              const retire = {
                ...barrage,
                statutBarrage: 'supprime',
                decisionOptimisation: 'a_supprimer',
                supprimeLe: new Date().toISOString(),
                supprimePar: identite(session),
                majPar: identite(session),
              };
              depot.remplacer(barrage.id, retire);
              journal.consigner({ session, action: 'supprimer', avant: barrage, apres: retire });
              depotAlertes.supprimerConcernant(barrage.id);
              /* Les CONFLITS DE PLANIFICATION étaient oubliés ici, alors qu'ils
                 le sont partout ailleurs (voir juste au-dessus et le DELETE de
                 /api/marquages) : accepter un retrait laissait des conflits
                 désignant un poste disparu. Même famille d'orphelins que les
                 notifications, et même remède. */
              depotConflitsPlanification.supprimerConcernant(barrage.id);
            } else if (decision === 'refusee') {
              const rendu = normaliser(
                {
                  ...barrage,
                  statutBarrage: barrage.statutBarrage,
                  decisionOptimisation: 'aucune',
                },
                {
                  id: barrage.id,
                  bt: barrage.bt,
                  cie: barrage.cie,
                  reg: barrage.reg,
                  auteur: barrage.auteur,
                  cree: barrage.cree,
                },
              );
              rendu.majPar = identite(session);
              depot.remplacer(barrage.id, rendu);
              journal.consigner({ session, action: 'modifier', avant: barrage, apres: rendu });
            }
          }

          const traitee = depotInstructions.traiter(instruction.id, {
            traiteePar: identite(session),
            reponse: corps.commentaire ?? corps.reponse,
            decision,
          });
          /* LA DÉCISION ELLE-MÊME est une opération : sans cette ligne, un refus
             (qui n'écrit rien sur le barrage) ne laissait aucune trace au journal,
             et personne n'en était notifié. */
          if (decision && instruction.action !== 'assignation') {
            const cible = depot.parId(instruction.barrageId) ?? { id: instruction.barrageId, ...instruction.barrage };
            journal.consigner({
              session, action: 'decision-demande', avant: cible, apres: cible,
              details: {
                instructionId: instruction.id,
                decision,
                objet: {
                  modification: 'demande de modification',
                  suppression: 'proposition de retrait',
                  nouveau_barrage: 'nouveau barrage',
                  conservation: 'maintien du poste',
                  retrait_optimisation: 'retrait par l’optimisation',
                }[instruction.action] ?? 'demande',
              },
            });
          }
          /**
           * `visibles`, ET NON `depot.tous()` — le dépôt entier n'a rien à
           * faire dans cette réponse.
           *
           * DEUX FAUTES EN UNE, et la seconde se voyait à l'écran.
           *
           * 1. LE PÉRIMÈTRE. Un chef de région qui accepte un retrait recevait
           *    les 1 123 barrages du pays, alors que son compte ne lui en
           *    montre que 82. Le dispositif des vingt-sept autres régions lui
           *    était livré par une réponse d'écriture, sans qu'il ait rien
           *    demandé — exactement ce que `visibles` interdit partout
           *    ailleurs (voir GET /api/marquages).
           *
           * 2. CE QUE LE NAVIGATEUR EN FAISAIT. La carte pose ce tableau tel
           *    quel (`setItems(r.items)` dans GendarmerieMap.jsx). Accepter UN
           *    retrait remplaçait donc les 82 repères par 1 123 : le poste
           *    supprimé disparaissait bien, mais noyé sous mille autres, si
           *    bien que la suppression paraissait ne pas s'appliquer. Il
           *    fallait recharger la page — qui rappelle `/api/marquages`,
           *    filtré, lui — pour voir le dispositif correct sans le poste
           *    retiré. D'où « ça ne s'applique pas tout de suite, mais après
           *    rafraîchissement c'est là ».
           *
           * Une réponse d'écriture doit rendre le MÊME ensemble qu'une lecture.
           * Sans quoi le navigateur affiche deux vérités selon le geste qui l'a
           * amené là.
           */
          json(res, 200, { instruction: traitee, items: actifs(session) });
          return true;
        }

        if (req.method === 'DELETE') {
          if (session.rang !== 'admin') {
            json(res, 403, { erreur: 'Seul un administrateur peut supprimer une instruction.' });
            return true;
          }
          depotInstructions.supprimer(instruction.id);
          json(res, 200, { supprime: instruction.id });
          return true;
        }

        json(res, 405, { erreur: 'Méthode non autorisée.' });
        return true;
      }

      /* --------- éléments présents, par créneau de 6 heures --------- */
      /**
       * QUI TIENT LE POSTE, CRÉNEAU PAR CRÉNEAU — voir serveur/elements.mjs.
       *
       * Trois routes, une seule règle d'autorité, et elle n'est pas nouvelle :
       * on peut lire les éléments d'un barrage qu'on VOIT, et écrire sur un
       * barrage qu'on peut MODIFIER (`peutModifier`, exactement comme pour sa
       * fiche). Rien à retenir de plus que pour le reste du dépôt.
       *
       * La lecture exige une session, alors que la carte est consultable sans
       * compte : un élément porte un nom et un matricule. Une liste nominative
       * de qui est en poste, à quelle heure et où, ne s'ouvre pas à un appel
       * anonyme.
       */
      const barrageDeLElement = (barrageId) => {
        const barrage = depot.parId(String(barrageId ?? ''));
        if (!barrage) {
          json(res, 404, { erreur: 'Barrage introuvable.' });
          return null;
        }
        if (!estBarrage(barrage)) {
          json(res, 400, { erreur: 'Les éléments ne se relèvent que sur un barrage.' });
          return null;
        }
        return barrage;
      };

      if (chemin === '/api/elements' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        const barrage = barrageDeLElement(url.searchParams.get('barrageId'));
        if (!barrage) return true;

        /* Même cloisonnement géographique que la carte — voir `visibles`. */
        if (!visibles(session, [barrage]).length) {
          json(res, 403, { erreur: motifRefus(session, barrage) });
          return true;
        }

        /**
         * `date` restreint la réponse à une journée. La popup de la carte s'en
         * sert pour n'afficher que la relève en cours : sans ce filtre, elle
         * recevrait tout l'historique du poste — des milliers de lignes après
         * quelques mois, pour en montrer six.
         */
        const maintenant = new Date();
        const jour = url.searchParams.get('date');
        /* `aujourdhui` évite au navigateur de deviner la date : c'est l'horloge
           du serveur qui fait foi ici comme à l'écriture, et un poste dont
           l'horloge dérive ne doit pas lire la relève de la veille. */
        const filtre =
          jour === 'aujourdhui'
            ? dateLocale(maintenant)
            : /^\d{4}-\d{2}-\d{2}$/.test(jour ?? '')
              ? jour
              : null;
        const items = depotElements
          .duBarrage(barrage.id)
          .filter((e) => !filtre || e.date === filtre);

        json(res, 200, {
          items,
          /* L'heure et le créneau viennent du SERVEUR, comme à l'écriture : un
             poste dont l'horloge dérive ne doit pas lire la mauvaise relève. */
          date: dateLocale(maintenant),
          creneau: creneauDe(maintenant),
          /* Combien d'hommes ce poste attend — pour dire « 4 sur 6 ». */
          attendus: chargerComposition(fichierComposition)
            .pour(barrage)
            .reduce((total, c) => total + c.nombre, 0),
        });
        return true;
      }

      if (chemin === '/api/elements' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const corps = await lireCorps(req, res);
        const barrage = barrageDeLElement(corps.barrageId);
        if (!barrage) return true;

        if (!peutModifier(session, barrage)) {
          json(res, 403, { erreur: motifRefus(session, barrage) });
          return true;
        }

        /**
         * LA RÈGLE DES TROIS, TENUE ICI — et pas seulement à l'écran.
         *
         * Un barrage est tenu par exactement trois hommes sur un créneau
         * (`ELEMENTS_PAR_BARRAGE`, voir elements.mjs). L'écran grise déjà le
         * bouton au troisième, mais un écran ne protège rien : la même requête
         * envoyée à la main placerait un quatrième homme, et le poste
         * afficherait « 4 / 3 » sans que personne ne sache d'où il sort.
         *
         * Le compte porte sur le créneau EN COURS, celui dans lequel l'ajout
         * va tomber — c'est l'horloge du serveur qui le désigne, jamais le
         * corps de la requête.
         */
        /**
         * L'HOMME DOIT ÊTRE DE LA BRIGADE DU POSTE.
         *
         * Seconde moitié de la règle : trois hommes, et trois hommes D'ICI.
         * L'écran ne propose déjà que l'effectif de la brigade (le sélecteur
         * est alimenté par `/api/roster`), donc aucun geste légitime n'est
         * retiré — ce contrôle ferme la porte à la requête écrite à la main,
         * qui rattacherait un gendarme d'une autre unité à ce poste.
         *
         * Le matricule fait foi, et non le nom : deux militaires peuvent
         * porter le même nom, jamais le même matricule.
         */
        const effectifBrigade = depotEffectifs.deLaBrigade(barrage.bt);
        if (
          effectifBrigade.length &&
          !effectifBrigade.some((p) => p.matricule === corps.matricule)
        ) {
          json(res, 400, {
            erreur:
              `${corps.matricule ?? 'Cet élément'} n'appartient pas à la brigade ${barrage.bt} : ` +
              'un barrage est tenu par des hommes de sa propre brigade.',
          });
          return true;
        }

        const maintenantAjout = new Date();
        const dejaSurLeCreneau = depotElements
          .duBarrage(barrage.id)
          .filter(
            (e) =>
              e.date === dateLocale(maintenantAjout) && e.creneau === creneauDe(maintenantAjout),
          );
        if (dejaSurLeCreneau.length >= ELEMENTS_PAR_BARRAGE) {
          json(res, 400, {
            erreur:
              `Ce poste compte déjà ${dejaSurLeCreneau.length} éléments sur ce créneau : ` +
              `un barrage en tient exactement ${ELEMENTS_PAR_BARRAGE}. Retirez-en un avant d'ajouter.`,
          });
          return true;
        }

        /* Ni date, ni heure, ni créneau ne sont lus du corps : l'horloge du
           serveur les pose (voir `creer`). Un poste dont l'horloge dérive ne
           décale donc pas la relève, et personne ne réécrit un créneau passé. */
        const element = depotElements.creer({
          barrageId: barrage.id,
          grade: corps.grade,
          nom: corps.nom,
          matricule: corps.matricule,
          auteur: identite(session),
        });
        json(res, 201, { element });
        return true;
      }

      const elementId = chemin.match(/^\/api\/elements\/([\w-]+)$/);
      if (elementId && req.method === 'DELETE') {
        if (!session) return refuseNonConnecte(json, res);

        const element = depotElements.parId(elementId[1]);
        if (!element) {
          json(res, 404, { erreur: 'Élément introuvable.' });
          return true;
        }

        const barrage = depot.parId(element.barrageId);
        /* Barrage disparu du dépôt : plus personne ne peut se prévaloir d'une
           autorité sur lui, sauf l'administrateur — sans quoi la ligne serait
           ineffaçable. */
        if (barrage ? !peutModifier(session, barrage) : session.rang !== 'admin') {
          json(res, 403, {
            erreur: barrage
              ? motifRefus(session, barrage)
              : "Le barrage de cet élément n'existe plus : seul un administrateur peut retirer la ligne.",
          });
          return true;
        }

        depotElements.supprimer(element.id);
        json(res, 200, { supprime: element.id });
        return true;
      }

      /* --------- assistant d'analyse (n8n / Ollama) --------- */
      /**
       * ANALYSE D'UN RÉSULTAT D'OPTIMISATION PAR UN SERVICE EXTERNE.
       *
       * Le navigateur envoie le RÉSUMÉ du calcul qu'il a sous les yeux ; le
       * serveur le relaie au workflow n8n (ou à Ollama) et rapporte le texte
       * obtenu. Rien n'est écrit, aucune décision n'est prise : c'est une
       * lecture, au même titre que la mesure de distance.
       *
       * POURQUOI LE RELAIS PASSE PAR LE SERVEUR, et non par le navigateur :
       *   — pas de CORS à obtenir de n8n ni d'Ollama (qui refuse par défaut) ;
       *   — l'adresse des services reste dans la configuration du serveur, elle
       *     ne part pas dans le bundle JavaScript de tous les postes ;
       *   — la session est exigée ici, donc l'appel n'est pas ouvert à tous ;
       *   — un poste client n'a pas forcément la route vers ces machines.
       *
       * Le corps est NORMALISÉ avant d'être transmis : on ne relaie que des
       * chiffres et des libellés de postes, plafonnés. Ni identité, ni
       * coordonnées, ni matricule ne sortent d'ici.
       */
      if (chemin === '/api/assistant/optimisation' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);

        const corps = await lireCorps(req, res);
        /**
         * `null` reste `null`, et ne devient PAS zéro.
         *
         * Un `Number(null)` vaut 0 et passe `isFinite` : la première version de
         * ce convertisseur transformait donc « aucune mesure faite » en « zéro
         * poste sous le seuil ». Un modèle à qui l'on annonce zéro conclut que
         * le dispositif est conforme, alors que personne n'a rien mesuré. Les
         * deux cas doivent rester distincts jusqu'au bout de la chaîne.
         */
        const nombre = (v) =>
          v === null || v === undefined || v === '' || Number.isNaN(Number(v))
            ? null
            : Number.isFinite(Number(v))
              ? Number(v)
              : null;
        const texte = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

        /* Au plus vingt postes : au-delà, le modèle n'ajoute rien et la requête
           s'allonge pour rien. */
        const postes = (Array.isArray(corps.postes) ? corps.postes : []).slice(0, 20).map((p) => ({
          nom: texte(p?.nom),
          route: texte(p?.route, 20),
          distanceKm: nombre(p?.distanceKm),
          protections: (Array.isArray(p?.protections) ? p.protections : [])
            .slice(0, 4)
            .map((x) => texte(x, 20))
            .filter(Boolean),
        }));

        /**
         * L'INVENTAIRE du périmètre — ce qu'il contient, indépendamment de toute
         * mesure de distance. C'est ce qui permet à l'agent de répondre sans
         * qu'un calcul ait été lancé.
         */
        const inv = corps.inventaire ?? {};
        const inventaire = {
          total: nombre(inv.total),
          fixes: nombre(inv.fixes),
          mobiles: nombre(inv.mobiles),
          entrees: nombre(inv.entrees),
          sorties: nombre(inv.sorties),
          vip: nombre(inv.vip),
          nonEclaires: nombre(inv.nonEclaires),
        };

        const resume = {
          perimetre: texte(corps.perimetre, 60) || 'tout le pays',
          inventaire,
          /* `null` — et non 0 — quand aucun calcul de distance n'a été fait :
             l'agent doit pouvoir distinguer « rien mesuré » de « rien trouvé ». */
          seuilKm: nombre(corps.seuilKm),
          examines: nombre(corps.examines),
          sousLeSeuil: nombre(corps.sousLeSeuil),
          intouchables: nombre(corps.intouchables),
          aDecider: nombre(corps.aDecider),
          postes,
        };

        const resultat = await assistant.analyser(resume);
        json(res, 200, resultat);
        return true;
      }

      /* ------------------- effectif et roster préparé ------------------- */
      /**
       * LE ROSTER — l'effectif d'une brigade, réparti d'avance sur ses postes.
       *
       *   GET  /api/roster?bt=…&date=…   ce qui est prévu pour cette brigade
       *   POST /api/roster/preparer      prépare une journée (administrateur)
       *
       * AUTORITÉ : on lit le roster d'une brigade dont on voit les barrages —
       * exactement la règle de la carte, pas une nouvelle. Un chef de compagnie
       * voit ses brigades, un chef de région les siennes, l'administrateur
       * toutes. La préparation, elle, écrit pour tout le pays : administrateur.
       */
      const barragesDeLaBrigade = (bt) => depot.tous().filter((m) => estBarrage(m) && m.bt === bt);

      if (chemin === '/api/roster' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        const bt = String(url.searchParams.get('bt') ?? '').trim();
        if (!bt) {
          json(res, 400, { erreur: 'Précisez la brigade (bt).' });
          return true;
        }

        const postes = barragesDeLaBrigade(bt);
        if (!postes.length) {
          json(res, 404, { erreur: `Aucun barrage rattaché à la brigade ${bt}.` });
          return true;
        }
        /* Un seul poste visible suffit : la brigade relève alors du périmètre. */
        if (!visibles(session, postes).length) {
          json(res, 403, { erreur: motifRefus(session, postes[0]) });
          return true;
        }

        const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '')
          ? url.searchParams.get('date')
          : dateLocale(new Date());

        /* La composition attendue accompagne le roster : l'écran peut alors
           dire « 4 présents sur 6 attendus » sans la deviner. */
        const compo = chargerComposition(fichierComposition);

        json(res, 200, {
          bt,
          date,
          /* L'effectif complet de la brigade : c'est lui qui permet de
             remplacer quelqu'un sans retaper son matricule. */
          effectif: depotEffectifs.deLaBrigade(bt),
          composition: Object.fromEntries(postes.map((m) => [m.id, compo.pour(m)])),
          barrages: postes.map((m) => ({
            id: m.id,
            nom: m.nom || '',
            route: m.route || '',
            type: m.type,
            lng: m.lng,
            lat: m.lat,
          })),
          /* Tout ce qui est posé ce jour-là sur ces postes, préparé ou saisi :
             le navigateur regroupe par créneau, il n'a rien à recalculer. */
          elements: depotElements
            .duJour(date)
            .filter((e) => postes.some((m) => m.id === e.barrageId)),
        });
        return true;
      }

      if (chemin === '/api/roster/preparer' && req.method === 'POST') {
        if (!session) return refuseNonConnecte(json, res);
        if (session.rang !== 'admin') {
          json(res, 403, { erreur: 'La préparation du roster est réservée à l’administrateur.' });
          return true;
        }

        const corps = await lireCorps(req, res);
        /* Par défaut : DEMAIN. C'est l'objet même de la préparation — le jour J
           doit trouver sa liste déjà faite. */
        const date = /^\d{4}-\d{2}-\d{2}$/.test(corps.date ?? '')
          ? corps.date
          : lendemain(new Date());

        /* Jamais dans le passé : un roster rétroactif ne prépare rien et
           salirait l'historique. */
        if (date < dateLocale(new Date())) {
          json(res, 400, { erreur: 'On ne prépare pas une journée passée.' });
          return true;
        }

        const composition = chargerComposition(fichierComposition);
        /**
         * `remplacer` refait une journée déjà proposée, au lieu de seulement
         * combler ses trous. Demandé explicitement, jamais par défaut : sans
         * cela on rebattrait les cartes d'une journée que le commandement a
         * peut-être déjà lue. Les créneaux touchés par un chef restent hors
         * d'atteinte dans les deux cas.
         */
        const rapport = preparerJournee({
          date,
          effectifs: depotEffectifs,
          barrages: depot.tous(),
          composition,
          depotElements,
          auteur: identite(session),
          remplacer: corps.remplacer === true,
        });

        journal.consigner({
          session,
          action: 'preparer-roster',
          details: {
            date,
            ajoutes: rapport.ajoutes,
            brigades: rapport.brigades,
            /* Un remplacement efface des lignes : la trace doit le dire. */
            remplacees: rapport.remplacement?.retires ?? 0,
          },
        });

        json(res, 200, {
          rapport: {
            ...rapport,
            /* La liste détaillée peut compter des centaines d'entrées : le
               résumé par grade suffit à l'écran, le détail est tronqué. */
            manques: rapport.manques.slice(0, 50),
            /* Deux comptes distincts, et il faut les nommer : le nombre de
               LIGNES de manque, et le nombre d'HOMMES qu'elles représentent.
               Les confondre gonfle ou minore le déficit d'un facteur trois. */
            manquesTotal: rapport.manques.length,
            /* Les dix premières brigades suffisent à situer le problème ;
               au-delà, c'est une liste qu'on ne lit plus. */
            manquesParBrigade: rapport.manquesParBrigade.slice(0, 10),
            compositionValidee: composition.valide,
          },
        });
        return true;
      }

      /**
       * LA SITUATION, EN UN APPEL — pour le premier écran d'ANALYSE.
       *
       * Répond sans clic aux questions qu'on se pose en ouvrant le panneau :
       * combien de postes sont tenus, lesquels sont incomplets, quelles
       * brigades n'ont pas d'effectif, combien d'hommes sont en réserve.
       *
       * TOUT EST CALCULÉ ICI, et non dans le navigateur : la réponse tient en
       * quelques centaines d'octets, là où il faudrait sinon transmettre les
       * vingt-trois mille lignes du jour pour les recompter à l'écran.
       *
       * Le périmètre est celui de la session, comme partout ailleurs : un chef
       * de compagnie voit la situation de sa compagnie, pas celle du pays.
       */
      if (chemin === '/api/analyse/situation' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

        const maintenant = new Date();
        const date = dateLocale(maintenant);
        const creneau = creneauDe(maintenant);

        const postes = visibles(
          session,
          depot.tous().filter((m) => estBarrage(m))
        );
        const idsVisibles = new Set(postes.map((m) => m.id));
        const duJour = depotElements.duJour(date).filter((e) => idsVisibles.has(e.barrageId));

        const compo = chargerComposition(fichierComposition);
        const attendus = (m) => compo.pour(m).reduce((t, c) => t + c.nombre, 0);

        /* Présents par poste, sur le créneau en cours. */
        const presents = new Map();
        for (const e of duJour) {
          if (e.creneau !== creneau) continue;
          presents.set(e.barrageId, (presents.get(e.barrageId) ?? 0) + 1);
        }

        const incomplets = [];
        let pourvus = 0;
        let vides = 0;
        for (const m of postes) {
          const n = presents.get(m.id) ?? 0;
          const cible = attendus(m);
          if (n === 0) vides++;
          else if (n >= cible) pourvus++;
          if (n < cible) {
            incomplets.push({ id: m.id, nom: m.nom || '', bt: m.bt || '', presents: n, attendus: cible });
          }
        }
        /* Le plus dégarni d'abord : c'est celui qu'on veut voir en premier. */
        incomplets.sort((a, b) => a.presents - b.presents || b.attendus - a.attendus);

        /* Brigades du périmètre, et celles qui n'ont personne au tableau. */
        const brigades = new Set(postes.map((m) => m.bt).filter(Boolean));
        const effectif = depotEffectifs.tous().filter((p) => brigades.has(p.bt));
        const places = new Set(duJour.filter((e) => e.creneau === creneau).map((e) => e.matricule));
        const avecEffectif = new Set(effectif.map((p) => p.bt));

        json(res, 200, {
          date,
          creneau,
          barrages: {
            total: postes.length,
            pourvus,
            incomplets: incomplets.length,
            vides,
          },
          brigades: {
            total: brigades.size,
            avecEffectif: avecEffectif.size,
            sansEffectif: brigades.size - avecEffectif.size,
          },
          effectif: {
            total: effectif.length,
            affectes: places.size,
            libres: effectif.length - places.size,
            demo: effectif.some((p) => p.demo === true),
          },
          /* Les quatre tranches de la journée : on voit d'un coup si une relève
             est moins bien tenue que les autres. */
          creneaux: CRENEAUX.map((c) => {
            const lignes = duJour.filter((e) => e.creneau === c);
            return {
              creneau: c,
              lignes: lignes.length,
              postes: new Set(lignes.map((e) => e.barrageId)).size,
            };
          }),
          /* Tronqué : au-delà, c'est une liste qu'on ne lit plus. Le compte
             complet reste dans `barrages.incomplets`. */
          detailIncomplets: incomplets.slice(0, 40),
        });
        return true;
      }

      if (chemin === '/api/roster/etat' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);
        const aujourdhui = dateLocale(new Date());
        const demain = lendemain(new Date());
        const parBrigade = depotEffectifs.parBrigade();
        json(res, 200, {
          aujourdhui: { date: aujourdhui, lignes: depotElements.duJour(aujourdhui).length },
          demain: { date: demain, lignes: depotElements.duJour(demain).length },
          effectif: {
            total: depotEffectifs.tous().length,
            brigades: parBrigade.size,
            demo: depotEffectifs.tous().some((p) => p.demo === true),
            /**
             * LES NOMS DES BRIGADES POURVUES, et non leur seul nombre.
             *
             * Sans cette liste, le sélecteur de SAISIE TERRAIN propose les 391
             * brigades qui tiennent un barrage sans distinguer les 29 dont
             * l'effectif est chargé : on en choisit une au hasard, l'écran est
             * vide, et la fonction passe pour cassée alors qu'il manque
             * seulement une donnée. Des noms d'unités, rien de nominatif.
             */
            listeBrigades: [...parBrigade.keys()].sort((a, b) => a.localeCompare(b, 'fr')),
          },
          creneaux: CRENEAUX,
        });
        return true;
      }

      /* ------------------------ journal ----------------------- */
      if (chemin === '/api/journal' && req.method === 'GET') {
        if (!session) return refuseNonConnecte(json, res);

/**
         * DEUX LECTURES DISTINCTES, ET DEUX AUTORISATIONS DISTINCTES.
         *
         * LE FILTRE PRÉCÉDENT ÉTAIT FAUX DANS LES DEUX SENS, et l'audit l'a
         * montré. Il s'écrivait :
         *
         *     rang === 'reg'  ->  e.unite != null
         *     sinon           ->  e.unite === session.unite
         *
         * Pour un chef de RÉGION, « une unité quelconque est renseignée »
         * n'est pas « une unité de ma région » : il lisait l'activité des 504
         * brigades du pays. Pour un chef de COMPAGNIE, la comparaison exigeait
         * que l'auteur porte le nom de la compagnie elle-même — donc il ne
         * voyait presque rien, pas même ses propres brigades.
         *
         * La cause tient à ce qu'une entrée consigne l'AUTEUR (matricule, nom,
         * unité, rang) et JAMAIS le rattachement de l'objet touché. Aucun
         * filtre sur `e.unite` ne peut donc reconstituer un périmètre
         * géographique : la donnée n'est pas là.
         *
         * On s'appuie donc sur ce qui existe et qui est exact :
         *
         *   — avec `id` : c'est l'historique d'UN marquage, seul usage réel
         *     (la fiche, voir `journalMarquage` dans src/api.js). L'autorisation
         *     est alors celle du marquage lui-même — `dansSonUnite`, la règle
         *     appliquée partout ailleurs. Exacte, et sans champ à ajouter ;
         *
         *   — sans `id` : c'est la trace nationale de toute l'activité. Aucun
         *     écran ne la demande, et elle n'a de sens que pour
         *     l'administration. Réservée à `admin`.
         */
        const limite = Math.min(200, Math.max(1, Number(url.searchParams.get('limite')) || 40));
        const idFiltre = url.searchParams.get('id');

        /* Les décisions d'optimisation : toutes pour l'administration, les siennes
           pour tout autre compte. */
        if (url.searchParams.get('categorie') === 'optimisation') {
          json(res, 200, {
            entrees: journal.dernieres(limite, (e) => e.details?.categorie === 'optimisation' &&
              (session.rang === 'admin' || e.matricule === session.matricule)),
          });
          return true;
        }

        if (!idFiltre) {
          if (session.rang !== 'admin') {
            json(res, 403, {
              erreur:
                'La trace complète de l’activité est réservée à l’administration. ' +
                'L’historique d’un repère se demande avec son identifiant.',
            });
            return true;
          }
          json(res, 200, { entrees: journal.dernieres(limite), taille: journal.taille() });
          return true;
        }

        /**
         * L'historique d'un repère suit le repère. Un repère qu'on n'a pas le
         * droit de voir n'a pas d'historique consultable — et l'on répond 404
         * plutôt que 403 : dire « ce repère existe mais il n'est pas à vous »
         * renseignerait sur le dispositif des autres unités.
         */
        const vise = depot.parId(idFiltre);
        if (!vise || !dansSonUnite(session, vise)) {
          json(res, 404, { erreur: 'Repère introuvable.' });
          return true;
        }

        json(res, 200, {
          entrees: journal.dernieres(limite, (e) => e.id === idFiltre),
          taille: journal.taille(),
        });
        return true;
      }

      json(res, 404, { erreur: `Route inconnue : ${chemin}` });
      return true;
    } catch (err) {
      // Aucune trace d'exécution renvoyée au client : juste le motif utile.
      json(res, err.statut ?? 400, { erreur: err.message });
      return true;
    }
  };
}

const identite = (s) => ({
  matricule: s.matricule,
  nom: s.nom,
  role: s.role,
  rang: s.rang,
  unite: s.unite,
  reg: s.reg ?? null,
  cie: s.cie ?? null,
});

function refuseNonConnecte(json, res) {
  json(res, 401, { erreur: 'Connexion requise : identifiez-vous pour écrire.' });
  return true;
}
