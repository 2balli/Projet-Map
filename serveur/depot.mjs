/**
 * Dépôt des marquages — un seul fichier JSON, source de vérité unique.
 *
 * Le serveur détient les données : tous les postes voient les mêmes marquages,
 * et surtout la règle d'écriture est appliquée à un seul endroit. Le navigateur
 * n'a plus de copie autoritaire, seulement l'affichage.
 */
import {
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { ecrireJsonAtomique } from './ecritureAtomique.mjs';
import { FACTION_IDS } from './factions.mjs';
import { obtenirDirectionBarrage, normaliserDirection } from './directionSens.mjs';

/**
 * Natures acceptées. `incident` (gestion de crise) a été retirée : la
 * fonctionnalité n'existe plus, ni côté serveur ni côté navigateur. Une fiche
 * de cette nature encore présente dans le dépôt serait donc écartée au
 * chargement par `estValide` — les trois existantes ont été purgées
 * explicitement, avec sauvegarde (voir scripts/purger-crise.mjs).
 */
export const TYPES = [
  'zahma',
  'accident',
  'barrage_fixe',
  'barrage_mobile',
  'barrage_vip',
  'FIXED',
  'FIXED_PERMANENT',
];

/**
 * LES NATURES QUI SONT DES BARRAGES — la liste, écrite UNE FOIS.
 *
 * POURQUOI ELLE EXISTE. Le test « est-ce un barrage ? » était recopié à la
 * main dans une quarantaine d'endroits, sous la forme
 * `type === 'barrage_fixe' || type === 'barrage_mobile'`. Tant qu'il n'y avait
 * que deux natures, cela tenait. L'arrivée du BARRAGE VIP a montré le défaut :
 * il aurait fallu retrouver et corriger ces quarante copies, et celles qu'on
 * aurait manquées auraient traité un VIP comme un repère ordinaire — invisible
 * aux statistiques, absent des analyses, ignoré des alertes de rapprochement.
 * Un oubli silencieux, donc, et non une erreur visible.
 *
 * Les appelants importent cette liste ou `estTypeBarrage`. Une sixième nature
 * de poste n'aura plus qu'un seul endroit à modifier.
 */
export const TYPES_BARRAGE = ['barrage_fixe', 'barrage_mobile', 'barrage_vip', 'FIXED', 'FIXED_PERMANENT'];

/** Ce repère est-il un poste de contrôle, quelle que soit sa nature ? */
export const estTypeBarrage = (type) =>
  TYPES_BARRAGE.includes(type) || type === 'FIXED' || type === 'FIXED_PERMANENT';

/**
 * LE BARRAGE FIXE INTOUCHABLE — le point permanent d'une compagnie.
 *
 * CHAQUE COMPAGNIE EN A UN, ET UN SEUL. Ce n'est pas un poste comme les
 * autres : c'est l'ancrage du dispositif de la compagnie, choisi une fois sur
 * la carte et tenu en permanence. Tout le reste s'organise autour de lui.
 *
 *   SA POSITION EST CHOISIE À LA MAIN et devient définitive.
 *   IL N'EST NI DÉPLACÉ, NI RETIRÉ, NI FUSIONNÉ par aucun calcul.
 *   SON IDENTIFIANT NE CHANGE JAMAIS — c'est ce qui permet aux factions de s'y
 *     relayer sans que le poste soit recréé.
 *
 * SA FACTION, ELLE, N'EST PAS FIGÉE. Le poste appartient à la COMPAGNIE, pas à
 * une faction : quatre tours de service s'y succèdent dans la journée, sur le
 * même barrage et sous le même identifiant. Confondre « position fixe » et
 * « faction fixe » aurait obligé à créer quatre postes au même endroit — un
 * par tour de service — et le dispositif aurait compté quatre fois ce qu'il
 * tient réellement.
 *
 * Quand un conflit l'oppose à un autre poste, c'est L'AUTRE qui s'adapte.
 */
export const TYPE_VIP = 'barrage_vip';

/** Ce repère est-il un barrage fixe intouchable ? */
export const estVIP = (m) => m?.type === TYPE_VIP;

/**
 * LA PROTECTION, COMME PROPRIÉTÉ MÉTIER ET NON COMME AFFICHAGE.
 *
 * `intouchable` est écrit dans la fiche, relu au chargement, et interrogé par
 * le serveur AVANT toute suppression, tout déplacement et toute consolidation.
 * Ce n'est pas une mention destinée à l'écran : une mention n'empêche rien, et
 * la première requête écrite à la main l'aurait contournée.
 *
 * POURQUOI UN CHAMP, ALORS QUE LE TYPE SUFFIRAIT À LE DÉDUIRE. Parce que la
 * protection et la nature du poste ne sont pas le même fait. Un poste
 * ordinaire peut devoir être sanctuarisé sans devenir l'ancrage de sa
 * compagnie ; l'inverse resterait vrai si la règle changeait. Le champ dit ce
 * qui est protégé, le type dit ce que c'est — et les deux se lisent
 * séparément dans les journaux et les rapports.
 *
 * LA DÉDUCTION DEPUIS LE TYPE RESTE, en plus du champ : une fiche ancienne,
 * écrite avant l'introduction du champ, ne doit pas se retrouver déprotégée au
 * rechargement. `estIntouchable` accepte donc les deux.
 */
export const estIntouchable = (m) =>
  m?.type === 'FIXED_PERMANENT' ||
  m?.isPermanent === true ||
  m?.protection === 'intouchable' ||
  m?.intouchable === true ||
  estVIP(m);

/** Longueurs maximales : un champ libre ne doit pas pouvoir gonfler le fichier. */
const MAX = {
  nom: 120,
  route: 120,
  note: 600,
  horaire: 5,
  accidentCount: 100000,
  patrouille: 60,
  patrouilles: 10,
  effectif: 50, // une patrouille ne dépasse pas ça en pratique
  missionId: 60,
};

/**
 * Sous-type d'un point de zahma — un carrefour, une entrée de ville et un
 * péage ne se gèrent pas pareil.
 *
 * La congestion n'est plus proposée à la saisie (voir `NATURES_POSABLES` dans
 * src/MarquagePanel.jsx), mais la nature reste acceptée par le dépôt : des
 * points de zahma existent déjà en base, et les écarter les ferait disparaître
 * silencieusement au chargement.
 */
const SOUS_TYPES_ZAHMA = ['carrefour', 'entree_ville', 'peage', 'marche', 'autre'];

/**
 * Attributs d'un point noir (nature `accident`) : sévérité/activité/infraction et
 * position par rapport à la ville, utilisés pour juger de son importance (voir
 * serveur/pointsnoirs.mjs). Acceptés mais sans effet sur les autres natures — même
 * principe que `debut`/`fin`, saisissables partout mais mis en avant nulle part
 * ailleurs.
 */
const SEVERITES = ['none', 'moderate', 'high', 'critical'];
const NIVEAUX = ['low', 'medium', 'high'];
/**
 * POSITION DU POSTE PAR RAPPORT À LA VILLE — quatre états, pas trois.
 *
 *   none    l'information n'est pas déterminée ;
 *   entree  le poste tient un point d'ACCÈS à l'agglomération ;
 *   sortie  il tient un point de SORTIE vers l'extérieur ;
 *   porte   il tient les DEUX — une porte de ville contrôle ce qui entre et
 *           ce qui sort, c'est le même poste sur la même chaussée.
 *
 * `porte` a été ajouté parce que le champ ne pouvait pas dire « les deux » :
 * les 212 portes générées par scripts/build-portes-ville.mjs étaient donc
 * toutes marquées `entree` par défaut — un pis-aller que le script assumait
 * dans son propre commentaire. Le filtre de l'Optimisation en héritait, et
 * annonçait 219 entrées contre 11 sorties là où le terrain n'a pas cette
 * asymétrie.
 *
 * Un poste `porte` répond donc À LA FOIS au filtre « entrée » et au filtre
 * « sortie » (voir la route consolidation) : c'est la vérité du terrain.
 *
 * Les lecteurs qui ne demandent que « position en ville, oui ou non »
 * (`estImportant`, `scoreImportance`, le panneau Filtrer) testent `!== 'none'`
 * et continuent de fonctionner sans changement.
 */
const POSITIONS_VILLE = ['none', 'entree', 'sortie', 'porte'];
/** Éclairage nocturne du point noir : un facteur de risque à part entière la nuit. */
const ECLAIRAGE = ['inconnu', 'oui', 'non'];

/**
 * Validation d'un barrage (fixe ou mobile) par le commandement : `en_attente`
 * à la création (génération automatique, manuelle, ou pose directe), jusqu'à
 * ce qu'un administrateur l'approuve, demande une modification ou l'annule —
 * voir la garde d'écriture dans serveur/api.mjs (PATCH /api/marquages/:id),
 * seul un administrateur peut faire changer ce champ.
 */
/**
 * `supprime` — RETIRÉ DU SERVICE, MAIS PAS EFFACÉ.
 *
 * Un barrage ne disparaît plus du fichier quand sa suppression est acceptée :
 * il change d'état. Sa position, son rattachement, ses caractéristiques et sa
 * date de création restent lisibles — « il y avait un poste ici, il a été
 * retiré, par qui et quand ». Effacer la ligne effaçait cette phrase avec
 * elle, et c'est précisément ce qu'on veut garder.
 *
 * Il sort en revanche des listes opérationnelles : `/api/marquages` ne le rend
 * plus, sauf demande expresse (`?archives=1`). La carte et les calculs
 * continuent donc de ne voir que le dispositif en service, sans qu'aucun
 * d'eux ait à connaître ce nouvel état.
 */
const STATUTS_BARRAGE = ['en_attente', 'approuve', 'a_modifier', 'annule', 'supprime', 'retire_optimisation'];

/**
 * Décision prise sur un signalement de rapprochement (panneau Optimisation).
 *
 * `conserve` veut dire : « l'autorité a vu que ce poste est trop près de son
 * voisin, et le maintient quand même ». C'est un ARBITRAGE, pas un état du
 * barrage — il ne le déplace pas, ne change pas son statut de validation et ne
 * touche à aucun autre champ. Il sert à ce que le même signalement ne soit pas
 * reposé à chaque calcul comme si personne n'avait jamais tranché.
 *
 * `a_supprimer` veut dire : « le Super Admin propose de retirer ce poste, le
 * commandant concerné ne s'est pas encore prononcé ». Le barrage est toujours
 * là, entier — c'est une PROPOSITION, pas un retrait. L'effacement réel
 * n'intervient qu'à l'acceptation du commandant (voir PATCH
 * /api/instructions/:id). Sans cet état intermédiaire, il n'y aurait plus rien
 * à montrer sur la carte, ni rien à refuser.
 *
 * Il n'y a donc pas de valeur « supprimé » : une fois le retrait accepté, la
 * fiche n'existe plus et ne porte plus rien. Ce qu'il en reste vit dans la
 * notification, qui garde une copie figée du barrage.
 *
 * Qui a décidé et quand n'est pas recopié ici : le journal des écritures le
 * consigne déjà pour toute modification (voir serveur/journal.mjs).
 */
const DECISIONS_OPTIMISATION = ['aucune', 'conserve', 'a_supprimer'];

export function creerDepot(fichier) {
  let items = [];
  /** Date de modification du fichier telle que ce dépôt l'a laissée. */
  let mtimeConnu = 0;

  const dateFichier = () => {
    try {
      return statSync(fichier).mtimeMs;
    } catch {
      return 0; // fichier absent : rien à relire
    }
  };

  const charger = () => {
    if (!existsSync(fichier)) return;
    const brut = JSON.parse(readFileSync(fichier, 'utf8'));
    items = (brut.items ?? []).filter(estValide);
    mtimeConnu = dateFichier();
  };

  try {
    charger();
  } catch (err) {
    throw new Error(`Dépôt des marquages illisible (${fichier}) : ${err.message}`);
  }

  /**
   * LE FICHIER A CHANGÉ SOUS NOS PIEDS : ON LE RELIT.
   *
   * Le dépôt était lu UNE SEULE FOIS, au démarrage. Or ce projet réécrit
   * couramment `marquages.json` par script — reclassement géographique,
   * qualification, purge, import, nettoyage des positions empilées : huit
   * scripts au moins, qui tous impriment « redémarrez le serveur ».
   *
   * Ce rappel ne suffit pas, et le symptôme est trompeur : l'application
   * continue de servir l'ancienne donnée sans le moindre signe. On regarde une
   * carte pleine de barrages « non éclairés » qu'un script vient justement de
   * requalifier, et on en conclut que le script n'a pas marché. Ce piège a coûté
   * trois allers-retours.
   *
   * La relecture ne peut pas perdre une écriture du serveur : c'est LUI qui
   * tient `mtimeConnu` à jour à chaque fois qu'il écrit (voir `ecrire`). Elle ne
   * peut pas non plus lire un fichier à moitié écrit : toutes les écritures du
   * projet passent par `ecrireJsonAtomique` (fichier temporaire puis renommage),
   * donc un lecteur voit soit l'ancien fichier entier, soit le nouveau entier.
   *
   * Un fichier devenu illisible ne fait rien perdre : on garde la mémoire, on le
   * signale, et on réessaiera au prochain appel.
   */
  const relireSiModifie = () => {
    const m = dateFichier();
    if (!m || m === mtimeConnu) return;
    const avant = items.length;
    try {
      charger();
      console.log(
        `  dépôt relu : ${fichier} a changé sur le disque (${avant} -> ${items.length} marquages)`
      );
    } catch (err) {
      /* On ne remplace pas une donnée valide par une lecture ratée. */
      mtimeConnu = m; // inutile de réessayer en boucle sur le même fichier cassé
      console.error(`  ! dépôt non relu (${err.message})`);
    }
  };

  /**
   * Copie datée du jour, prise AVANT la première écriture de la journée.
   *
   * Une sauvegarde par jour suffit : ce qui menace ces données n'est pas la
   * panne machine (l'écriture est atomique) mais l'erreur humaine — une
   * suppression en masse, un import malheureux — et on veut alors revenir à
   * « hier », pas à « il y a trente secondes ». Les 30 derniers jours sont
   * conservés, le reste est effacé pour que le dossier ne gonfle pas seul.
   */
  const JOURS_CONSERVES = 30;

  const sauvegarder = () => {
    if (!existsSync(fichier)) return;

    const dossier = join(dirname(resolve(fichier)), 'sauvegardes');
    mkdirSync(dossier, { recursive: true });

    const jour = new Date().toISOString().slice(0, 10);
    const copie = join(dossier, `marquages-${jour}.json`);
    if (existsSync(copie)) return; // déjà fait aujourd'hui

    try {
      copyFileSync(fichier, copie);
      const anciennes = readdirSync(dossier)
        .filter((f) => /^marquages-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of anciennes.slice(0, Math.max(0, anciennes.length - JOURS_CONSERVES))) {
        rmSync(join(dossier, f), { force: true });
      }
    } catch (err) {
      // Une sauvegarde ratée ne doit pas bloquer le travail : on le dit, c'est tout.
      console.error(`  ! sauvegarde non écrite (${err.message})`);
    }
  };

  /** Écriture atomique : jamais de fichier tronqué en cas de coupure. */
  const ecrire = () => {
    sauvegarder();
    ecrireJsonAtomique(fichier, { version: 1, items });
    /* C'est nous qui venons d'écrire : cette date-là ne doit pas déclencher une
       relecture au prochain appel. */
    mtimeConnu = dateFichier();
  };

  return {
    /* Les deux chemins de LECTURE vérifient d'abord que le fichier n'a pas
       changé — c'est le seul endroit où le faire : tout passe par eux. */
    tous: () => {
      relireSiModifie();
      return items;
    },
    parId: (id) => {
      relireSiModifie();
      return items.find((m) => m.id === id) ?? null;
    },

    ajouter(item) {
      items.push(item);
      ecrire();
      return item;
    },

    modifier(id, champs) {
      const i = items.findIndex((m) => m.id === id);
      if (i < 0) return null;
      items[i] = { ...items[i], ...champs, maj: new Date().toISOString() };
      ecrire();
      return items[i];
    },

    remplacer(id, item) {
      const i = items.findIndex((m) => m.id === id);
      if (i < 0) return null;
      items[i] = item;
      ecrire();
      return item;
    },

    supprimer(id) {
      const i = items.findIndex((m) => m.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      ecrire();
      return true;
    },

    /** Remplace un lot en une seule écriture (import). */
    appliquerLot(nouveaux) {
      items = nouveaux;
      ecrire();
      return items;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

const texte = (v, max) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * `HH:MM` ou vide : tout le reste est écarté plutôt que corrigé.
 *
 * `24:00` est accepté : c'est la fin de journée que portent les postes
 * permanents (00:00 → 24:00) et la dernière faction (voir FACTIONS dans
 * serveur/factions.mjs). Le refuser effaçait l'horaire d'un intouchable à sa
 * première modification.
 */
const horaire = (v) => (/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(String(v ?? '')) ? String(v) : '');

/** PK en kilomètres, au dixième — ou `null` : un PK absent ne devient pas « PK 0 ». */
const pointKilometrique = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n < 10000 ? Math.round(n * 10) / 10 : null;
};

/** Entier borné, 0 si absent ou invalide plutôt que rejeté. */
const entier = (v, max) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

/** Une valeur de la liste, sinon la première (le neutre de chaque énumération). */
const enumeration = (v, liste) => (liste.includes(v) ? v : liste[0]);

/**
 * ÉNUMÉRATION FACULTATIVE — vide plutôt que la première valeur.
 *
 * `enumeration` retombe sur `liste[0]`, ce qui convient aux champs qui ONT une
 * valeur neutre en tête de liste (`severite: 'none'`, `positionVille: 'none'`).
 * Pour la faction, ce comportement serait un piège : une valeur mal saisie —
 * ou envoyée par un client plus ancien — deviendrait silencieusement
 * « Faction 1 », et le poste apparaîtrait dans un tour de service auquel
 * personne ne l'a affecté. L'absence doit rester l'absence.
 */
const enumerationFacultative = (v, liste) => (liste.includes(v) ? v : '');

/** `AAAA-MM-JJ` ou vide : comme `horaire`, tout le reste est écarté plutôt que corrigé. */
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '');

/**
 * Patrouilles affectées à un barrage — une ou plusieurs, chacune avec son
 * unité (peut différer de celle du barrage : une compagnie voisine vient en
 * renfort), sa date et son créneau. Un barrage_fixe tenu en 3x8 ou un
 * barrage_mobile suivi par plusieurs équipes n'a pas qu'un seul nom à porter.
 * Entrées sans nom écartées : une patrouille sans identité ne sert à rien.
 */
const listePatrouilles = (v) =>
  (Array.isArray(v) ? v : [])
    .map((p) => ({
      nom: texte(p?.nom, MAX.patrouille),
      unite: texte(p?.unite, MAX.patrouille),
      date: date(p?.date),
      debut: horaire(p?.debut),
      fin: horaire(p?.fin),
      // Effectif et véhicule : vides par défaut (0 / '') plutôt que refusés —
      // une patrouille reste valide sans ces deux informations, elles ne font
      // qu'affiner la détection de conflits de planification (voir
      // `serveur/conflitsPlanification.mjs`).
      effectif: entier(p?.effectif, MAX.effectif),
      vehicule: texte(p?.vehicule, MAX.patrouille),
    }))
    .filter((p) => p.nom)
    .slice(0, MAX.patrouilles);

/** Un point {lng,lat} valide, arrondi à 5 décimales — ou `null`. */
const pointGeo = (v) => {
  const lng = Number(v?.lng);
  const lat = Number(v?.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lng: +lng.toFixed(5), lat: +lat.toFixed(5) }
    : null;
};

export const estValide = (m) =>
  m &&
  typeof m.id === 'string' &&
  TYPES.includes(m.type) &&
  Number.isFinite(m.lng) &&
  Number.isFinite(m.lat) &&
  Math.abs(m.lat) <= 90 &&
  Math.abs(m.lng) <= 180;

export const nouvelId = () => `mq_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

/**
 * Construit un marquage à partir d'un corps de requête.
 *
 * Aucun champ d'autorité ne vient du client : `bt`, `cie`, `reg` et `auteur`
 * sont posés par l'appelant à partir de la session et de la géométrie. Un
 * client modifié ne peut donc pas s'attribuer une autre compagnie.
 */
export function normaliser(corps, { id, bt = null, cie, reg, auteur, cree }) {
  return {
    id,
    type: corps.type,
    nom: texte(corps.nom, MAX.nom),
    route: texte(corps.route, MAX.route),
    /* Point kilométrique sur `route`, calculé par serveur/pointKilometrique.mjs
       lors d'une modification de position — jamais saisi librement. */
    pk: pointKilometrique(corps.pk),
    note: texte(corps.note, MAX.note),
    debut: horaire(corps.debut),
    fin: horaire(corps.fin),
    accidentCount: entier(corps.accidentCount, MAX.accidentCount),
    severite: enumeration(corps.severite, SEVERITES),
    activite: enumeration(corps.activite, NIVEAUX),
    infraction: enumeration(corps.infraction, NIVEAUX),
    positionVille: enumeration(corps.positionVille, POSITIONS_VILLE),
    eclairage: enumeration(corps.eclairage, ECLAIRAGE),
    /**
     * LA FACTION DU POSTE — le tour de service auquel il est affecté.
     *
     * `F1`…`F4` (voir serveur/factions.mjs), ou vide. VIDE EST UN CAS NORMAL,
     * et même le cas de la plupart des postes : l'affectation se lit alors sur
     * les relèves du dépôt des éléments, qui disent qui a réellement tenu le
     * poste et à quelle heure. Ce champ ne remplace pas cette lecture — il la
     * DEVANCE, pour les postes dont le commandement a fixé la faction une fois
     * pour toutes.
     *
     * Ordre de priorité, résolu par `factionsDuBarrage` :
     *   1. ce champ ;
     *   2. la fenêtre `debut`/`fin` de la fiche ;
     *   3. les créneaux réellement relevés.
     *
     * L'énumération vient de `FACTION_IDS` et n'est pas recopiée : ajouter une
     * cinquième faction ne doit pas la rendre refusée à l'écriture.
     */
    factionId: enumerationFacultative(corps.factionId, FACTION_IDS),
    statutBarrage: enumeration(corps.statutBarrage, STATUTS_BARRAGE),
    etatAvant: typeof corps.etatAvant === 'string' ? corps.etatAvant : null,
    optimisationAuto: corps.optimisationAuto && typeof corps.optimisationAuto === 'object' ? corps.optimisationAuto : null,
    /* QUI a retiré le poste du service, et QUAND. Conservés par la
       normalisation comme le reste : sans cela, la moindre écriture
       ultérieure effacerait la trace de la décision. */
    supprimeLe: typeof corps.supprimeLe === 'string' ? corps.supprimeLe : null,
    supprimePar: corps.supprimePar ?? null,
    // Arbitrage rendu sur un signalement de rapprochement — voir plus haut.
    decisionOptimisation: enumeration(corps.decisionOptimisation, DECISIONS_OPTIMISATION),
    // Point noir d'origine d'un barrage généré (auto ou manuel) — permet de
    // retrouver, depuis la fiche du point noir, le(s) barrage(s) déjà posé(s)
    // pour lui, sans dépendre d'un texte libre dans `note`. `null` pour un
    // barrage posé à la main, ou pour toute autre nature.
    origineId: typeof corps.origineId === 'string' ? corps.origineId : null,
    patrouilles: listePatrouilles(corps.patrouilles),
    sousType: enumeration(corps.sousType, SOUS_TYPES_ZAHMA),
    // Barrage exceptionnel posé pour une mission (VIP/interception, voir
    // serveur/missions.mjs) — jamais un choix arbitraire du client sur un
    // barrage déjà existant : seule sa création peut le marquer ainsi (voir
    // serveur/api.mjs, POST /api/marquages).
    /**
     * LA PROTECTION PERMANENTE DU POSTE — voir `estIntouchable` plus haut.
     *
     * Un barrage fixe intouchable l'est TOUJOURS, que le client l'ait demandé
     * ou non : la protection découle de sa nature, elle ne se négocie pas à
     * l'écriture. Pour les autres natures, le champ est accepté tel quel, ce
     * qui permettra de sanctuariser un poste ordinaire sans changer son type.
     *
     * Conséquence voulue : une requête qui tenterait d'écrire
     * `intouchable: false` sur un barrage fixe intouchable n'y parviendrait
     * pas. La normalisation est traversée par TOUTES les écritures, création
     * comme modification — c'est le seul endroit où cette garantie tient sans
     * dépendre de qui appelle.
     */
    protection:
      corps.type === 'FIXED_PERMANENT' ||
      corps.protection === 'intouchable' ||
      corps.type === TYPE_VIP ||
      corps.intouchable === true ||
      corps.isPermanent === true
        ? 'intouchable'
        : (corps.protection || 'aucune'),
    intouchable:
      corps.type === 'FIXED_PERMANENT' ||
      corps.protection === 'intouchable' ||
      corps.type === TYPE_VIP ||
      corps.isPermanent === true
        ? true
        : corps.intouchable === true,
    exceptionnel: corps.exceptionnel === true,
    missionId: typeof corps.missionId === 'string' ? corps.missionId.slice(0, MAX.missionId) : null,
    // Barrage créé depuis une suggestion de l'Assistant plutôt qu'à la main
    // (voir POST /api/marquages/generer, branche `pointNoirId`) — sert à
    // comparer ce que l'Assistant propose de ce qu'un chef pose lui-même,
    // jamais modifiable après coup (même principe que `exceptionnel`).
    viaAssistant: corps.viaAssistant === true,
    // Diffusion hors région — seul le PATCH contrôlé (voir serveur/api.mjs)
    // peut la faire passer à `true` ; toujours `false` à la création (voir le
    // commentaire au point d'appel POST /api/marquages).
    partage: corps.partage === true,
    // Attributs synthétiques réalistes (interface SyntheticFixedBarrage)
    isSynthetic: corps.isSynthetic === true,
    isPermanent:
      corps.type === 'FIXED_PERMANENT' ||
      corps.isPermanent === true ||
      corps.protection === 'intouchable' ||
      corps.type === TYPE_VIP,
    name: texte(corps.name || corps.nom, MAX.nom),
    roadName: texte(corps.roadName || corps.route, MAX.route),
    roadType: texte(corps.roadType, 60),
    roadReference: texte(corps.roadReference || corps.ref, 60),
    accidentPeriod: texte(corps.accidentPeriod, 30),
    isLighted: corps.isLighted === true || corps.eclairage === 'oui',
    trafficLevel: ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'].includes(corps.trafficLevel)
      ? corps.trafficLevel
      : corps.activite === 'high' ? 'HIGH' : corps.activite === 'low' ? 'LOW' : 'MODERATE',
    trafficDescription: texte(corps.trafficDescription, 120),
    createdAt: corps.createdAt || cree || new Date().toISOString(),
    updatedAt: corps.updatedAt || new Date().toISOString(),
    bt,
    cie,
    reg,
    compagnieId: cie ?? corps.compagnieId ?? null,
    brigadeId: bt ?? corps.brigadeId ?? null,
    regionId: reg ?? corps.regionId ?? null,
    lng: +Number(corps.lng ?? corps.longitude).toFixed(5),
    lat: +Number(corps.lat ?? corps.latitude).toFixed(5),
    longitude: +Number(corps.lng ?? corps.longitude).toFixed(5),
    latitude: +Number(corps.lat ?? corps.latitude).toFixed(5),
    // Gestion des deux sens de circulation (Aller / Retour)
    direction: normaliserDirection(corps.direction || corps.sens || corps.sensCirculation) || obtenirDirectionBarrage(corps),
    sens: normaliserDirection(corps.sens || corps.direction || corps.sensCirculation) || obtenirDirectionBarrage(corps),
    road_id: texte(corps.road_id || corps.roadId || corps.roadReference || corps.ref || corps.route, 60),
    route_position: corps.route_position ?? corps.routePosition ?? corps.pk ?? null,
    coordinates: Array.isArray(corps.coordinates) && corps.coordinates.length === 2
      ? [+Number(corps.coordinates[0]).toFixed(5), +Number(corps.coordinates[1]).toFixed(5)]
      : [+Number(corps.lng ?? corps.longitude).toFixed(5), +Number(corps.lat ?? corps.latitude).toFixed(5)],
    auteur, // {rang, unite} — qui l'a créé
    majPar: auteur, // {rang, unite} — qui l'a modifié en dernier
    cree: cree ?? new Date().toISOString(),
    maj: new Date().toISOString(),
  };
}
