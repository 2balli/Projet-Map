/**
 * SOURCE DES DONNÉES — L'UNIQUE INTERRUPTEUR « FICTIF / RÉEL ».
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Panneaux et carte  →  src/api.js  →  ce fichier décide          │
 * │                                        ├── fournisseur FICTIF    │
 * │                                        └── serveur RÉEL (fetch)  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * LE SEUL ENDROIT À MODIFIER : la constante `SOURCE_PAR_DEFAUT` ci-dessous.
 * Aucun composant ne sait de quelle source il est servi — `src/api.js` garde
 * exactement les mêmes fonctions, les mêmes arguments et les mêmes formes de
 * réponse dans les deux modes. Le jour où l'API réelle prend la main, il n'y a
 * pas une ligne d'interface à réécrire.
 *
 * POURQUOI LA BASCULE EST AU NIVEAU DE LA REQUÊTE, ET NON DES COMPOSANTS.
 * Les neuf écrans de l'application importent déjà tous `src/api.js`, et rien
 * d'autre : la couture existait, il suffisait de s'en servir. Un service
 * parallèle que les composants auraient dû adopter un par un aurait laissé
 * pendant des mois deux chemins d'accès aux données — celui qu'on a migré et
 * celui qu'on a oublié.
 *
 * CE QUE LE MODE FICTIF N'EST PAS. Ce n'est pas le mode « démonstration » du
 * SERVEUR (`--mode demo`, dossier `donnees-demo/`, voir README §5) : celui-là
 * sert de vraies réponses HTTP depuis un jeu fictif déjà semé, et reste la
 * bonne façon de faire une démonstration à plusieurs postes. Le mode fictif
 * décrit ici ne parle à AUCUN serveur : tout est calculé dans le navigateur.
 * Il sert à développer et éprouver l'interface — y compris ses états de
 * chargement, de vide et d'erreur — sans rien lancer d'autre que `npm run dev`.
 */

/* ================================================================== */
/*  1. L'INTERRUPTEUR                                                 */
/* ================================================================== */

export const SOURCES = { FICTIF: 'fictif', REEL: 'reel' };

/**
 * ► POUR PASSER DÉFINITIVEMENT À L'API RÉELLE : mettre `SOURCES.REEL` ici.
 *
 * Valeur actuelle — `auto` :
 *   `npm run dev`            → FICTIF (phase de développement en cours)
 *   build de production      → RÉEL
 *
 * Le build de production ne sert PAS de données fictives par défaut, et ce
 * n'est pas une prudence de principe : l'application est identique à l'écran
 * dans les deux cas, elle affiche des barrages nommés et pourvus, et rien
 * n'empêcherait de prendre un dispositif inventé pour le dispositif réel.
 * C'est la raison d'être du bandeau permanent (voir `BandeauMode.jsx`) et du
 * refus du serveur de démarrer sur le mauvais dossier (`serveur/mode.mjs`) ;
 * livrer un build fictif par défaut reviendrait à défaire les deux.
 *
 * Pour forcer l'un ou l'autre sans toucher au code :
 *   URL          ?donnees=fictif   ou   ?donnees=reel
 *   build        VITE_SOURCE_DONNEES=fictif npm run build
 */
const SOURCE_PAR_DEFAUT = 'auto';

/* ================================================================== */
/*  2. SCÉNARIOS D'ÉPREUVE                                            */
/* ================================================================== */

/**
 * De quoi éprouver les quatre états que toute vue doit savoir tenir, sans
 * débrancher un câble ni patcher un composant.
 *
 *   SUCCES  le jeu complet ;
 *   VIDE    des collections vides — « aucun barrage », « aucun élément » :
 *           l'état le plus souvent oublié, et le plus vite constaté à l'écran ;
 *   ERREUR  le service refuse (503) : les écrans doivent le dire, pas rester
 *           en chargement perpétuel ;
 *   LENT    dix fois la latence : on voit enfin passer les indicateurs de
 *           chargement qu'on ne voit jamais en local.
 *
 * `?scenario=vide` (ou `erreur`, `lent`) dans l'URL, sans rebuild.
 */
export const SCENARIOS = { SUCCES: 'succes', VIDE: 'vide', ERREUR: 'erreur', LENT: 'lent' };

const SCENARIO_PAR_DEFAUT = SCENARIOS.SUCCES;

/** Latence simulée, en millisecondes. Assez pour voir, trop peu pour gêner. */
export const LATENCE_MS = 220;

/** Multiplicateur du scénario « lent ». */
export const FACTEUR_LENT = 10;

/* ================================================================== */
/*  3. RÉSOLUTION                                                     */
/* ================================================================== */

const parametreUrl = (nom) => {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(nom);
  } catch {
    return null; // URL exotique : on retombe sur la configuration
  }
};

const env = (cle) => {
  try {
    return import.meta.env?.[cle] ?? null;
  } catch {
    return null;
  }
};

/**
 * La source active, résolue une fois pour toutes au chargement du module :
 * une bascule en cours de session laisserait la moitié des écrans sur l'autre
 * source, avec des identifiants qui ne se correspondent pas.
 */
export const SOURCE_ACTIVE = (() => {
  const demande = (parametreUrl('donnees') ?? env('VITE_SOURCE_DONNEES') ?? SOURCE_PAR_DEFAUT)
    .toLowerCase();
  if (demande === SOURCES.FICTIF || demande === SOURCES.REEL) return demande;
  /* `auto` : fictif pendant le développement, réel dès qu'on livre. */
  return env('DEV') ? SOURCES.FICTIF : SOURCES.REEL;
})();

export const enModeFictif = () => SOURCE_ACTIVE === SOURCES.FICTIF;

export const SCENARIO_ACTIF = (() => {
  const demande = (parametreUrl('scenario') ?? SCENARIO_PAR_DEFAUT).toLowerCase();
  return Object.values(SCENARIOS).includes(demande) ? demande : SCENARIOS.SUCCES;
})();

/** Latence à appliquer à un appel fictif, scénario compris. */
export const latenceSimulee = () =>
  SCENARIO_ACTIF === SCENARIOS.LENT ? LATENCE_MS * FACTEUR_LENT : LATENCE_MS;

/* ================================================================== */
/*  4. RÉGLAGES DU JEU FICTIF                                         */
/* ================================================================== */

/**
 * Volume engendré. « toutes » suit le découpage réel chargé par la carte
 * (28 régions, 90 compagnies, 504 brigades) ; un nombre le restreint, ce qui
 * rend une mise au point beaucoup plus rapide à lire.
 *
 *   ?echelle=petit   3 régions, 2 compagnies, 3 brigades — le minimum utile
 *   ?echelle=complet tout le pays (défaut)
 */
export const ECHELLES = {
  petit: { regions: 3, compagniesParRegion: 2, brigadesParCompagnie: 3 },
  complet: { regions: 'toutes', compagniesParRegion: 'toutes', brigadesParCompagnie: 'toutes' },
};

export const CONFIG_FICTIVE = {
  /** Même graine ⇒ même jeu, au repère près. Changez-la pour un autre tirage. */
  graine: 42,
  ...(ECHELLES[parametreUrl('echelle')] ?? ECHELLES.complet),
  effectifsParBrigade: [20, 30],
  barragesParBrigade: [3, 8],
  /** Journée de référence : fixe, pour que deux exécutions se comparent. */
  dateReference: '2026-09-18',
};
