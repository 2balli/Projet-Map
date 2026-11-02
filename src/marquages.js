/**
 * Marquages de terrain — définitions et formats côté navigateur.
 *
 * Quatre natures : congestion, point noir accidents, barrage fixe, barrage
 * mobile — la gestion de crise a été retirée de l'application.
 *
 * Les objets eux-mêmes appartiennent au SERVEUR (voir serveur/api.mjs
 * et src/api.js) : création, modification et fusion y sont contrôlées contre la
 * session et le périmètre de l'unité. Ce fichier ne garde donc que ce qui est
 * purement d'affichage et d'échange de fichier — aucune écriture autoritaire.
 */

import { COULEURS_MARQUAGE } from './palette.js';

/* ================================================================== */
/*  Natures de marquage                                               */
/* ================================================================== */

/**
 * `horaires: true` -> la nature a une plage horaire utile (un pic de
 * circulation, un créneau de barrage). Sur un point noir accidents la plage
 * reste saisissable mais n'est pas mise en avant.
 */
export const TYPES_MARQUAGE = [
  {
    key: 'zahma',
    glyph: 'zahma',
    fr: 'Congestion',
    ar: 'نقطة زحام',
    color: COULEURS_MARQUAGE.zahma,
    scale: 0.8,
    horaires: true,
    aide: 'Point de zahma : carrefour, entrée de ville, péage, marché hebdomadaire…',
  },
  {
    key: 'accident',
    glyph: 'accident',
    fr: 'Point noir accidents',
    ar: 'نقطة الحوادث',
    color: COULEURS_MARQUAGE.accident,
    scale: 0.82,
    horaires: false,
    aide: 'Lieu à accidents répétés : virage, descente, traversée piétonne…',
  },
  {
    key: 'barrage_fixe',
    glyph: 'barrage_fixe',
    fr: 'Barrage fixe',
    ar: 'براج ثابت',
    color: COULEURS_MARQUAGE.barrage_fixe,
    scale: 0.8,
    horaires: true,
    aide: 'Poste permanent tenu au même emplacement.',
  },
  {
    key: 'barrage_mobile',
    glyph: 'barrage_mobile',
    fr: 'Barrage mobile',
    ar: 'براج متنقل',
    color: COULEURS_MARQUAGE.barrage_mobile,
    scale: 0.8,
    horaires: true,
    aide: 'Barrage déplaçable : glissez le repère pour le repositionner.',
  },
  {
    key: 'barrage_vip',
    glyph: 'barrage_vip',
    fr: 'Barrage VIP',
    ar: 'براج كبار الشخصيات',
    color: COULEURS_MARQUAGE.barrage_vip,
    scale: 0.86,
    horaires: true,
    /**
     * `figeable: true` — CE REPÈRE NE SE DÉPLACE PAS.
     *
     * Sa position est pointée à la main sur la carte parce qu'elle répond à un
     * itinéraire officiel, et elle devient définitive. Le drapeau est lu par
     * la carte pour interdire le glisser-déposer, et le serveur refuse de
     * toute façon tout déplacement (voir PATCH /api/marquages/:id) : l'écran
     * ne fait qu'éviter de proposer un geste voué au refus.
     */
    figeable: true,
    aide: 'Poste de protection d’un passage officiel : position pointée sur la carte et définitive, faction de quatre éléments.',
  },
  {
    key: 'FIXED',
    glyph: 'barrage_fixe',
    fr: 'Barrage fixe (synthétique)',
    ar: 'براج ثابت اصطناعي',
    color: COULEURS_MARQUAGE.barrage_fixe,
    scale: 0.8,
    horaires: true,
    aide: 'Barrage fixe synthétique positionné sur le réseau routier.',
  },
  {
    key: 'FIXED_PERMANENT',
    glyph: 'barrage_intouchable',
    fr: 'Barrage fixe permanent',
    ar: 'براج ثابت دائم',
    color: '#0d9488',
    scale: 0.95,
    horaires: true,
    figeable: true,
    aide: 'Barrage fixe permanent intouchable (données synthétiques).',
  },
];

export const TYPE_PAR_CLE = Object.fromEntries(TYPES_MARQUAGE.map((t) => [t.key, t]));

/** Clé de couche (panneau latéral) <-> nature de marquage. */
export const cleCouche = (type) => `mq_${type}`;

/**
 * Clé de couche EFFECTIVE d'un marquage posé : une entrée de ville (sous-type
 * de `zahma`) a sa PROPRE couche dans le panneau, séparée de la « Congestion »
 * générique — un chef qui veut voir seulement les entrées de ville ne doit
 * pas avoir à filtrer les carrefours au milieu.
 *
 * Le péage n'a PAS ce traitement : sa localisation réelle vient désormais
 * d'une couche de référence (`peages`, voir POINT_LAYERS et
 * scripts/build-peages.mjs) ; un signalement `zahma`/`peage` reste possible
 * (congestion constatée à un péage) mais s'affiche dans la Congestion
 * générique, avec son glyphe propre pour rester reconnaissable.
 */
export function cleCoucheEffective(m) {
  if (m.type === 'zahma' && m.sousType === 'entree_ville') {
    return `mq_zahma_${m.sousType}`;
  }
  if (m.type === 'FIXED' || m.type === 'FIXED_PERMANENT') {
    return 'mq_barrage_fixe';
  }
  return cleCouche(m.type);
}

/* ================================================================== */
/*  Points noirs — attributs d'importance (nature `accident`)         */
/* ================================================================== */

/**
 * Options des attributs d'un point noir : sévérité (accidents), activité
 * routière, fréquence d'infractions, position par rapport à la ville. Saisis
 * uniquement sur la nature `accident`, mais acceptés côté serveur pour
 * n'importe quelle nature (comme `debut`/`fin`) — voir `serveur/depot.mjs`.
 */
export const SEVERITES = [
  { code: 'none', fr: 'Aucune' },
  { code: 'moderate', fr: 'Modérée' },
  { code: 'high', fr: 'Élevée' },
  { code: 'critical', fr: 'Critique' },
];
export const NIVEAUX_ACTIVITE = [
  { code: 'low', fr: 'Faible' },
  { code: 'medium', fr: 'Moyen' },
  { code: 'high', fr: 'Élevé' },
];
export const NIVEAUX_INFRACTION = [
  { code: 'low', fr: 'Faible' },
  { code: 'medium', fr: 'Moyenne' },
  { code: 'high', fr: 'Élevée' },
];
/** Miroir de `POSITIONS_VILLE` dans serveur/depot.mjs — voir son commentaire. */
export const POSITIONS_VILLE = [
  { code: 'none', fr: 'Aucune' },
  { code: 'entree', fr: 'Entrée de ville' },
  { code: 'sortie', fr: 'Sortie de ville' },
  { code: 'porte', fr: 'Porte de ville (entrée et sortie)' },
];
/** Éclairage nocturne du lieu : une route non éclairée aggrave le risque la nuit. */
export const ECLAIRAGE = [
  { code: 'inconnu', fr: 'Inconnu' },
  { code: 'oui', fr: 'Éclairé' },
  { code: 'non', fr: 'Non éclairé' },
];

/**
 * Validation d'un barrage par le commandement central : `en_attente` à la
 * création (génération auto, manuelle, ou pose directe), jusqu'à ce qu'un
 * administrateur l'approuve, demande une modification, ou l'annule — voir
 * la garde d'écriture dans `serveur/api.mjs` (PATCH /api/marquages/:id),
 * seul un compte `admin` peut faire changer ce champ.
 */
export const STATUTS_BARRAGE = [
  { code: 'en_attente', fr: 'En attente', couleur: '#c8a349' },
  { code: 'approuve', fr: 'Approuvé', couleur: '#0f8a4f' },
  { code: 'a_modifier', fr: 'À modifier', couleur: '#ec835a' },
  { code: 'annule', fr: 'Annulé', couleur: '#8a8f99' },
];
export const STATUT_BARRAGE_INFO = Object.fromEntries(STATUTS_BARRAGE.map((s) => [s.code, s]));

const SEVERITES_ELEVEES = new Set(['high', 'critical']);
const POIDS_SEVERITE = { none: 0, moderate: 2, high: 4, critical: 6 };
const POIDS_NIVEAU = { low: 0, medium: 2, high: 4 };
const ORDRE_NIVEAU = { low: 0, medium: 1, high: 2 };

/**
 * Un point noir « important » : nombre d'accidents dans la plage choisie, OU
 * une sévérité élevée/critique, OU une activité/infraction au moins au niveau
 * du seuil choisi, OU une position entrée/sortie de ville (sauf si
 * volontairement ignorée). Les seuils sont réglables — c'est le filtre
 * proposé avant la génération automatique de barrages (voir
 * `GenerationFiltre` dans `MarquagePanel.jsx`) ; sans réglage, ce sont ces
 * mêmes valeurs par défaut qui décident du badge « important » affiché sur un
 * point noir.
 *
 * MÊME RÈGLE que dans `serveur/pointsnoirs.mjs`, dupliquée à dessein : ici
 * pour l'affichage (badge, halo, aperçu du nombre de candidats), là-bas pour
 * choisir les candidats retenus par le serveur. En cas de divergence, c'est
 * la version serveur qui prime.
 */
/**
 * EST-CE UN POSTE ? — fixe ou mobile, et rien d'autre.
 *
 * Le prédicat était réécrit à la main dans plusieurs composants de la carte
 * (`const barrage = (m) => m.type === 'barrage_fixe' || …`). Il est ici pour
 * que le filtre par faction, qui ne s'applique qu'aux postes, s'appuie sur la
 * même définition que le reste — un point noir n'est tenu par aucune faction.
 */
export const TYPES_BARRAGE = ['barrage_fixe', 'barrage_mobile', 'barrage_vip', 'FIXED', 'FIXED_PERMANENT'];

/**
 * CE REPÈRE EST-IL UN POSTE DE CONTRÔLE ?
 *
 * La liste est écrite ici et importée partout ailleurs — elle l'était
 * auparavant à la main, sous la forme d'un `||` recopié dans une quarantaine
 * d'écrans. L'ajout du BARRAGE VIP l'a rendu intenable : une copie oubliée
 * n'aurait pas produit d'erreur, elle aurait simplement fait disparaître les
 * VIP des compteurs, des analyses et de la recherche, sans que rien ne le
 * signale. Miroir de `TYPES_BARRAGE` dans serveur/depot.mjs.
 */
export const estBarrage = (m) => TYPES_BARRAGE.includes(m?.type);

/** Un barrage fixe intouchable — le point permanent d'une compagnie. */
export const estVIP = (m) => m?.type === 'barrage_vip';

/**
 * CE POSTE EST-IL PROTÉGÉ EN PERMANENCE ?
 *
 * Miroir de `estIntouchable` dans serveur/depot.mjs. La protection porte sur
 * la POSITION et l'IDENTITÉ — pas sur la faction, qui se relaie librement sur
 * le même poste.
 *
 * Le champ est lu en premier, la nature en second : une fiche ancienne écrite
 * avant l'introduction du champ reste protégée par son type.
 */
export const estIntouchable = (m) =>
  m?.type === 'FIXED_PERMANENT' ||
  m?.isPermanent === true ||
  m?.protection === 'intouchable' ||
  m?.intouchable === true ||
  estVIP(m);

export function estImportant(
  m,
  {
    seuilAccidentsMin = 5,
    seuilAccidentsMax = Infinity,
    seuilActivite = 'high',
    seuilInfraction = 'high',
    considererPositionVille = true,
  } = {}
) {
  const accidents = m.accidentCount ?? 0;
  return (
    (accidents >= seuilAccidentsMin && accidents <= seuilAccidentsMax) ||
    SEVERITES_ELEVEES.has(m.severite) ||
    (ORDRE_NIVEAU[m.activite] ?? 0) >= (ORDRE_NIVEAU[seuilActivite] ?? 2) ||
    (ORDRE_NIVEAU[m.infraction] ?? 0) >= (ORDRE_NIVEAU[seuilInfraction] ?? 2) ||
    (considererPositionVille && m.positionVille && m.positionVille !== 'none')
  );
}

/** Note d'importance — même formule que côté serveur, sert au tri seulement. */
export function scoreImportance(m) {
  return (
    (m.accidentCount ?? 0) +
    (POIDS_SEVERITE[m.severite] ?? 0) +
    (POIDS_NIVEAU[m.activite] ?? 0) +
    (POIDS_NIVEAU[m.infraction] ?? 0) +
    (m.positionVille && m.positionVille !== 'none' ? 3 : 0)
  );
}

/**
 * Sous-types d'un point de zahma — un carrefour, un marché et une entrée de
 * ville ne se gèrent pas pareil, mais restent la même nature (congestion) et
 * partagent donc la même couleur : la palette opérationnelle est déjà à son
 * écart minimal (voir `npm run check:palette`), ajouter une teinte de plus n'y
 * passerait pas. Seul le GLYPHE change, ce que le contrôle de palette ne
 * mesure pas — la distinction reste visible sur la carte sans y toucher.
 */
export const CATEGORIES_ZAHMA = [
  { code: 'carrefour', fr: 'Carrefour' },
  { code: 'entree_ville', fr: 'Entrée de ville' },
  { code: 'peage', fr: 'Péage' },
  { code: 'marche', fr: 'Marché hebdomadaire' },
  { code: 'autre', fr: 'Autre' },
];

/** Glyphe par sous-type de zahma — `carrefour`/`marche`/`autre` gardent le glyphe générique. */
export const CATEGORIE_ZAHMA_INFO = {
  carrefour: { glyph: 'zahma' },
  entree_ville: { glyph: 'entree_ville' },
  peage: { glyph: 'peage' },
  marche: { glyph: 'zahma' },
  autre: { glyph: 'zahma' },
};

/** Glyphe/couleur effectifs d'un marquage — dépend du caractère intouchable et du sous-type. */
export function apparence(m) {
  if (estIntouchable(m)) {
    return {
      glyph: 'barrage_intouchable',
      color: '#0d9488', // Teinte teal/émeraude dédiée aux postes permanents intouchables
      scale: 0.95,
      intouchable: true,
    };
  }
  if (m.type === 'zahma') {
    const info = CATEGORIE_ZAHMA_INFO[m.sousType] ?? CATEGORIE_ZAHMA_INFO.carrefour;
    return { glyph: info.glyph, color: TYPE_PAR_CLE.zahma.color, scale: TYPE_PAR_CLE.zahma.scale, intouchable: false };
  }
  const t = TYPE_PAR_CLE[m.type] ?? (m.type === 'FIXED' ? TYPE_PAR_CLE.barrage_fixe : null);
  return { glyph: t?.glyph ?? 'barrage_fixe', color: t?.color ?? COULEURS_MARQUAGE.barrage_fixe, scale: t?.scale ?? 0.8, intouchable: false };
}

/* ================================================================== */
/*  Stockage local                                                    */
/* ================================================================== */

export const VERSION = 3;

/** Un marquage n'est exploitable que s'il a une nature connue et un point. */
export function valide(m) {
  return (
    m &&
    typeof m.id === 'string' &&
    TYPE_PAR_CLE[m.type] != null &&
    Number.isFinite(m.lng) &&
    Number.isFinite(m.lat)
  );
}

/**
 * Le repère tombe-t-il dans la circonscription de la session ?
 *
 * C'est la question de la VISIBILITÉ — que voit-on sur la carte et dans les
 * listes — et elle est distincte de celle de l'AUTORITÉ (`peutModifier`, plus
 * bas), qui décide de ce qu'on a le droit de corriger ou d'effacer.
 *
 * Les deux ont longtemps été confondues, parce qu'elles se ressemblaient :
 * tant que l'autorité se réduisait au périmètre, une seule fonction servait
 * aux deux usages. Elles divergent dès qu'on tient compte de l'auteur — un
 * gendarme en saisie ne reprend que ses propres relevés, mais il doit
 * évidemment continuer à voir ceux de ses collègues sur la carte. Employer
 * `peutModifier` pour filtrer l'affichage ferait disparaître de son écran tout
 * ce qu'il n'a pas posé lui-même.
 */
export function dansSonPerimetre(session, m) {
  if (!session) return false;
  const p = perimetreImpose(session);
  return !p || m[p.champ] === p.unite;
}

/**
 * PÉRIMÈTRE IMPOSÉ PAR LE PROFIL — miroir de `perimetreDuRang` (comptes.mjs).
 *
 * MÊME RÈGLE QUE LE SERVEUR, dupliquée à dessein comme `peutModifier` : ici
 * pour ne pas demander à l'utilisateur ce que son compte dit déjà, là-bas pour
 * refuser qu'on prétende le contraire. Si les deux divergent, c'est le serveur
 * qui tranche.
 *
 * Un chef de région, de compagnie ou de brigade ne CHOISIT pas son périmètre
 * d'optimisation : son rang le nomme. Seul `admin`, hors hiérarchie
 * géographique, a encore quelque chose à désigner — d'où le `null`.
 *
 * `champ` est le champ de rattachement du barrage, celui-là même que
 * `dansSonPerimetre` compare.
 *
 * @returns {{niveau: 'region'|'compagnie'|'brigade', champ: 'reg'|'cie'|'bt', unite: string}|null}
 */
export function perimetreImpose(session) {
  if (session?.rang === 'reg') return { niveau: 'region', champ: 'reg', unite: session.unite };
  if (session?.rang === 'cie') return { niveau: 'compagnie', champ: 'cie', unite: session.unite };
  if (session?.rang === 'unite') return { niveau: 'brigade', champ: 'bt', unite: session.unite };
  return null;
}

/**
 * LA PORTÉE D'UN COMPTE, DÉRIVÉE — et jamais redéfinie.
 *
 * Tout ce qui suit répond à `perimetreImpose` ci-dessus, la règle unique :
 * carte bornée, contours cliquables, effectifs consultables et actions
 * autorisées disent donc forcément la même chose. Une seconde table de rôles,
 * même fidèle le jour où on l'écrit, diverge au premier changement — et une
 * divergence, ici, s'appelle une fuite.
 *
 *   admin  → global      reg → sa région
 *   cie    → sa compagnie        unite → sa brigade
 */

/* ================================================================== */
/*  LA RÈGLE DES TROIS                                                */
/* ================================================================== */

/**
 * UN BARRAGE EST TENU PAR EXACTEMENT TROIS HOMMES, SUR UN CRÉNEAU DONNÉ.
 *
 * CE QUE « TROIS ÉLÉMENTS » VEUT DIRE ICI. Un élément n'est pas une
 * affectation permanente : c'est une PRÉSENCE, datée et rattachée à l'un des
 * quatre créneaux de six heures (voir `serveur/elements.mjs`). La règle porte
 * donc sur le couple (poste, créneau) : trois hommes tiennent le poste de 6 h
 * à 12 h, trois autres — ou les mêmes — le tiennent de 12 h à 18 h. Comptée
 * sur la vie entière d'un poste, « trois éléments » n'aurait aucun sens : il
 * en accumule quatre par jour depuis son ouverture.
 *
 * POURQUOI UNE CONSTANTE ET NON UN NOMBRE ÉCRIT DANS CHAQUE ÉCRAN. La règle
 * est vérifiée à quatre endroits — la saisie, le fournisseur fictif, le
 * serveur, et le semis du jeu d'épreuve. Écrite quatre fois, elle aurait
 * quatre valeurs le jour où elle change.
 *
 * ELLE COEXISTE AVEC LA COMPOSITION, ET LA BORNE. `composition-barrage.json`
 * dit QUELS grades tiennent un poste (1 MDLC + 2 MDLG) ; cette constante dit
 * COMBIEN, et fait autorité sur le nombre — voir `chargerComposition` dans
 * serveur/roster.mjs, qui écrête toute composition plus nombreuse et le
 * signale plutôt que de laisser les deux règles se contredire en silence.
 */
export const ELEMENTS_PAR_BARRAGE = 3;

/**
 * UN BARRAGE VIP EST TENU PAR EXACTEMENT QUATRE ÉLÉMENTS.
 *
 * POURQUOI QUATRE, ET NON TROIS. Un VIP n'est pas un poste de contrôle
 * ordinaire : il couvre un passage officiel, et le commandement a fixé sa
 * composition à quatre hommes. La règle générale des trois reste celle des
 * barrages fixes et mobiles — elle n'est pas remplacée, elle est complétée.
 *
 * LES DEUX NOMBRES COEXISTENT SANS SE CONTREDIRE parce qu'ils ne portent pas
 * sur la même chose : `elementsAttendus` choisit d'après la NATURE du poste,
 * et c'est le seul endroit où ce choix se fait. Écrire « 4 » en dur dans
 * l'écran de saisie du VIP aurait produit deux règles, et le jour où l'une
 * change, deux comportements.
 */
export const ELEMENTS_PAR_BARRAGE_VIP = 4;

/** Combien d'éléments ce poste doit compter, d'après sa nature. */
export const elementsAttendus = (type) =>
  type === 'barrage_vip' ? ELEMENTS_PAR_BARRAGE_VIP : ELEMENTS_PAR_BARRAGE;

/**
 * L'effectif d'un poste est-il réglementaire ?
 *
 * Rend un motif plutôt qu'un booléen : l'écran qui refuse doit pouvoir dire
 * POURQUOI, et le serveur renvoie la même phrase. Un « non » sans motif finit
 * toujours par être lu comme un défaut de l'application.
 *
 * @param {Array} elements présences du poste sur UN créneau
 * @returns {{ok: boolean, motif: string|null}}
 */
export function verifieEffectifBarrage(elements, type = 'barrage_fixe') {
  if (!Array.isArray(elements)) {
    return { ok: false, motif: 'Effectif du poste illisible.' };
  }
  const attendu = elementsAttendus(type);
  const quoi = type === 'barrage_vip' ? 'Un barrage VIP' : 'Un barrage';
  const n = elements.length;
  if (n === attendu) return { ok: true, motif: null };
  return {
    ok: false,
    motif:
      n < attendu
        ? `${quoi} doit compter exactement ${attendu} éléments : il en manque ${attendu - n}.`
        : `${quoi} doit compter exactement ${attendu} éléments : il y en a ${n - attendu} de trop.`,
  };
}

/** Niveau de la portée : 'national' | 'region' | 'compagnie' | 'brigade'. */
export const niveauPortee = (session) => perimetreImpose(session)?.niveau ?? 'national';

/** Rang numérique d'un échelon, pour comparer « au-dessus / au-dessous ». */
const RANG_ECHELON = { region: 0, compagnie: 1, brigade: 2 };

/**
 * L'unité `nom`, à l'échelon `niveau`, tombe-t-elle dans la portée du compte ?
 *
 * Trois cas, et ils ne se traitent pas de la même façon :
 *
 *   MON ÉCHELON      c'est mon unité, ou ce n'en est pas une.
 *   AU-DESSUS        ma région quand je commande une compagnie : consultable,
 *                    sinon le fil d'Ariane n'aurait pas de racine et l'arbre
 *                    s'ouvrirait sur du vide. On la reconnaît par `session.reg`
 *                    / `session.cie`, que le compte porte déjà.
 *   AU-DESSOUS       il faut son RATTACHEMENT : qu'une brigade appartienne à
 *                    ma compagnie ne se lit pas dans son nom. L'appelant le
 *                    tient du découpage (contours) ou d'un repère.
 *
 * @param {object} session
 * @param {'region'|'compagnie'|'brigade'} niveau échelon de l'unité visée
 * @param {string} nom                            son nom
 * @param {{reg?: string, cie?: string}} ascendance rattachement de l'unité visée
 */
export function dansSaPortee(session, niveau, nom, ascendance = {}) {
  const p = perimetreImpose(session);
  if (!p) return Boolean(nom); // admin : aucune borne géographique
  if (!nom) return false;

  const mien = RANG_ECHELON[p.niveau];
  const vise = RANG_ECHELON[niveau];
  if (vise == null) return false;

  if (vise === mien) return nom === p.unite;

  if (vise < mien) {
    /* Ascendance du COMPTE, portée par la session elle-même. */
    if (niveau === 'region') return nom === (session.reg ?? null);
    return nom === (session.cie ?? null);
  }

  if (p.champ === 'reg') return ascendance.reg === p.unite;
  if (p.champ === 'cie') return ascendance.cie === p.unite;
  return false; // un chef de brigade n'a rien au-dessous de lui
}

/**
 * LA PORTÉE COURANTE — ce que l'utilisateur regarde EN CE MOMENT.
 *
 * Deux choses différentes, qu'on confondait :
 *
 *   le PÉRIMÈTRE DU COMPTE   ce qu'il a le droit de voir. Fixé par son rang,
 *                            il ne bouge jamais (`perimetreImpose`).
 *   la PORTÉE COURANTE       ce qu'il a choisi de regarder à l'intérieur : il
 *                            est descendu dans une compagnie, puis dans une
 *                            brigade. Elle bouge à chaque pas.
 *
 * La carte ne montrait que le premier : un chef de région entrait dans une
 * compagnie, la carte se recadrait, le fil d'Ariane suivait — et les barrages
 * des dix autres compagnies restaient affichés. On travaillait sur une unité
 * en regardant le dispositif de toute la région.
 *
 * ELLE NE PEUT JAMAIS ÊTRE PLUS LARGE QUE LE PÉRIMÈTRE. La navigation
 * RESSERRE, elle n'ouvre pas : un contexte qui désignerait une autre région
 * que la sienne est ignoré, et l'on retombe sur le périmètre du compte. Le
 * cloisonnement reste donc entier, quoi qu'il arrive au fil d'Ariane.
 *
 * @param {object} session
 * @param {{region?: string, compagnie?: string, brigade?: string}} contexte
 * @returns {{niveau: 'region'|'compagnie'|'brigade', champ: 'reg'|'cie'|'bt',
 *   unite: string}|null} `null` = aucune restriction (vue nationale d'un admin)
 */
export function porteeCourante(session, contexte = {}) {
  const impose = perimetreImpose(session);

  /* Du plus fin au plus large : la portée est le pas le plus profond. */
  const candidats = [
    contexte?.brigade && { niveau: 'brigade', champ: 'bt', unite: contexte.brigade },
    contexte?.compagnie && { niveau: 'compagnie', champ: 'cie', unite: contexte.compagnie },
    contexte?.region && { niveau: 'region', champ: 'reg', unite: contexte.region },
  ].filter(Boolean);

  const RANG = { region: 0, compagnie: 1, brigade: 2 };
  for (const candidat of candidats) {
    /* Un pas PLUS FIN que le périmètre, ou de même niveau et la même unité :
       on le suit. Tout le reste est ignoré — voir la note ci-dessus. */
    if (!impose) return candidat;
    if (RANG[candidat.niveau] > RANG[impose.niveau]) return candidat;
    if (candidat.niveau === impose.niveau && candidat.unite === impose.unite) return candidat;
  }
  return impose;
}

/** Le repère tombe-t-il dans la portée courante ? `null` accepte tout. */
export const dansLaPortee = (portee, m) => !portee || m?.[portee.champ] === portee.unite;

/** Motif de refus, dit en une phrase et dans le vocabulaire du compte. */
export const motifHorsPortee = (session) =>
  session && perimetreLibelle(session)
    ? `Hors de votre périmètre : votre compte ne couvre que ${perimetreLibelle(session)}.`
    : 'Hors de votre périmètre.';

/**
 * Autorité d'écriture, telle que l'affiche l'interface.
 *
 * MÊME RÈGLE que `peutModifier` dans serveur/api.mjs, dupliquée à dessein :
 * ici pour griser ce qui n'est pas modifiable, là-bas pour refuser. Si les deux
 * divergent, c'est le serveur qui tranche — jamais l'inverse.
 *
 * La règle a DEUX conditions, et l'interface ne vérifiait que la première :
 *
 *   1. le périmètre — le repère est-il dans la circonscription de la session ;
 *   2. l'auteur — un rôle « Saisie » ne reprend que ses propres repères ; seul
 *      un rôle « Commandement » (ou un administrateur) corrige ceux des autres.
 *
 * Faute de la seconde, un agent en saisie voyait le repère d'un collègue comme
 * modifiable et ne découvrait le refus qu'après coup, par un message d'erreur.
 * Depuis que les commandes de modification et de suppression sont proposées
 * directement sur la carte, l'écart ne pouvait plus tenir : un bouton visible
 * doit être un bouton qui fonctionne.
 */
export function peutModifier(session, m, role) {
  if (!session) return false;
  if (session.rang === 'admin') {
    if (estBarrage(m)) return false;
    return true;
  }
  if (!dansSonPerimetre(session, m)) return false;

  /* `role` peut manquer (anciens appels) : dans le doute on laisse passer et
     le serveur tranche — c'est lui qui fait autorité. */
  const r = role ?? session.role;
  if (r === 'lecture') return false;
  if (r === 'commandement') return true;
  if (r !== 'saisie') return true;
  return !m.auteur?.matricule || m.auteur.matricule === session.matricule;
}

/** Ce que couvre une session, en une ligne lisible. */
export const perimetreLibelle = (session) =>
  !session
    ? null
    : session.rang === 'admin'
      ? 'tout le territoire (administrateur)'
      : session.rang === 'reg'
        ? `région ${session.unite}`
        : session.rang === 'cie'
          ? `compagnie ${session.unite}`
          : `brigade territoriale ${session.unite}`;

/** Libellé d'affichage : le nom saisi, sinon la route, sinon la nature. */
export const libelle = (m) =>
  m?.name?.trim() || m?.nom?.trim() || m?.roadName?.trim() || m?.route?.trim() || TYPE_PAR_CLE[m?.type]?.fr || 'Marquage';

/** Plage horaire lisible, ou null si elle n'est pas renseignée. */
export const plage = (m) =>
  m.debut && m.fin ? `${m.debut} → ${m.fin}` : m.debut || m.fin || null;

/* ================================================================== */
/*  Échange de fichier                                                */
/* ================================================================== */

/**
 * Export en GeoJSON — et non dans un format maison : le fichier s'ouvre
 * directement dans QGIS ou ArcGIS côté commandement, sans conversion.
 */
export function versGeoJSON(items, session) {
  return {
    type: 'FeatureCollection',
    meta: {
      producteur: 'Carte tactique — Gendarmerie Royale',
      objet: 'marquages de terrain',
      unite: session ? `${session.rang}:${session.unite}` : null,
      version: VERSION,
      exporte: new Date().toISOString(),
      entites: items.length,
    },
    features: items.map((m) => ({
      type: 'Feature',
      properties: {
        id: m.id,
        type: m.type,
        nature: TYPE_PAR_CLE[m.type]?.fr ?? m.type,
        nom: m.nom || null,
        route: m.route || null,
        note: m.note || null,
        debut: m.debut || null,
        fin: m.fin || null,
        accidentCount: m.accidentCount || null,
        severite: m.severite || null,
        activite: m.activite || null,
        infraction: m.infraction || null,
        positionVille: m.positionVille || null,
        eclairage: m.eclairage || null,
        patrouilles: m.patrouilles?.length ? m.patrouilles : null,
        categorie: m.categorie || null,
        gravite: m.gravite || null,
        statut: m.statut || null,
        description: m.description || null,
        dateEvenement: m.dateEvenement || null,
        mesure: m.mesure ?? null,
        zone: m.zone || null,
        surfaceHa: m.surfaceHa ?? null,
        typeEau: m.typeEau || null,
        accessible: m.accessible ?? null,
        exceptionnel: m.exceptionnel || null,
        missionId: m.missionId || null,
        cie: m.cie,
        reg: m.reg,
        auteur: m.auteur ? `${m.auteur.rang}:${m.auteur.unite}` : null,
        cree: m.cree ?? null,
        maj: m.maj,
      },
      geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
    })),
  };
}

/** Lit un fichier exporté. Les entités illisibles sont comptées, pas devinées. */
export function depuisGeoJSON(json) {
  const feats = Array.isArray(json?.features) ? json.features : null;
  if (!feats) return { items: [], rejetes: 0, erreur: 'Fichier sans « features » : ce n\'est pas un export de marquages.' };

  const items = [];
  let rejetes = 0;

  for (const f of feats) {
    const p = f?.properties ?? {};
    const c = f?.geometry?.coordinates;
    const m = {
      // Pas d'identifiant inventé ici : le serveur en attribuera un. Un id
      // fabriqué côté client fausserait le rapprochement à la fusion.
      id: typeof p.id === 'string' ? p.id : '',
      type: p.type,
      nom: p.nom ?? '',
      route: p.route ?? '',
      note: p.note ?? '',
      debut: p.debut ?? '',
      fin: p.fin ?? '',
      accidentCount: p.accidentCount ?? 0,
      severite: p.severite ?? 'none',
      activite: p.activite ?? 'low',
      infraction: p.infraction ?? 'low',
      positionVille: p.positionVille ?? 'none',
      eclairage: p.eclairage ?? 'inconnu',
      // Le serveur revalide/normalise chaque patrouille à l'import (voir
      // `listePatrouilles` dans serveur/depot.mjs) : on ne filtre ici que le
      // bruit évident, pas la forme exacte de chaque objet.
      patrouilles: Array.isArray(p.patrouilles) ? p.patrouilles.filter((v) => v && typeof v === 'object') : [],
      categorie: p.categorie ?? 'autre',
      gravite: p.gravite ?? 'faible',
      statut: p.statut ?? 'signale',
      description: p.description ?? '',
      dateEvenement: p.dateEvenement ?? '',
      mesure: p.mesure ?? null,
      // La zone est revalidée par le serveur à l'import (voir `zoneValidee`
      // dans serveur/depot.mjs) : ici on ne filtre que le bruit évident.
      zone: p.zone && typeof p.zone === 'object' ? p.zone : null,
      surfaceHa: p.surfaceHa ?? null,
      typeEau: p.typeEau ?? 'aucun',
      accessible: typeof p.accessible === 'boolean' ? p.accessible : null,
      exceptionnel: p.exceptionnel === true,
      missionId: typeof p.missionId === 'string' ? p.missionId : null,
      cie: p.cie ?? null,
      reg: p.reg ?? null,
      lng: Array.isArray(c) ? c[0] : NaN,
      lat: Array.isArray(c) ? c[1] : NaN,
      cree: p.cree ?? null,
      maj: p.maj ?? new Date().toISOString(),
    };
    // `valide` exige un id : un import sans id reste recevable, le serveur en
    // posera un. On ne contrôle donc ici que nature et coordonnées.
    if (TYPE_PAR_CLE[m.type] && Number.isFinite(m.lng) && Number.isFinite(m.lat)) items.push(m);
    else rejetes++;
  }

  return { items, rejetes, erreur: null };
}

/** Déclenche le téléchargement d'un objet JSON sous `nomFichier`. */
export function telecharger(objet, nomFichier) {
  const blob = new Blob([JSON.stringify(objet, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  a.click();
  // Libère l'URL après le clic : sans cela le Blob reste en mémoire.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nom de fichier daté, sans espace ni accent — sûr sur un partage réseau. */
export function nomFichierExport(session) {
  const jour = new Date().toISOString().slice(0, 10);
  const cie = (session?.unite ?? 'unite')
    .normalize('NFD') // sépare les accents, retirés juste après
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .toLowerCase();
  return `marquages-${cie}-${jour}.geojson`;
}

/** Une cellule CSV : guillemets doublés, tout le champ entre guillemets s'il contient le séparateur. */
const celluleCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Export CSV, point-virgule en séparateur : Excel FR ouvre ce fichier
 * directement sans assistant d'import, la virgule y étant déjà le séparateur
 * décimal. BOM UTF-8 en tête pour que les accents s'affichent correctement
 * dès l'ouverture (Excel suppose sinon un encodage local Windows-1252).
 */
export function telechargerCSV(lignes, entetes, nomFichier) {
  const texte = [entetes, ...lignes].map((ligne) => ligne.map(celluleCsv).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + texte], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
