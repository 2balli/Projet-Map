/**
 * LIMITES TERRITORIALES VISIBLES SELON LE ZOOM — source unique.
 *
 * LA QUESTION QUE CE FICHIER TRANCHE
 * ----------------------------------
 * « À ce niveau de zoom, quelles limites dessine-t-on, et avec quelle
 * force ? » Elle se posait auparavant nulle part : les trois découpages
 * (régions, compagnies, brigades) étaient trois cases à cocher, et la carte
 * affichait ce qu'on avait coché, quel que soit l'éloignement. Vue
 * nationale, les 500 circonscriptions de brigade formaient un treillis
 * illisible ; au ras du sol, la seule limite régionale ne disait plus rien de
 * l'unité dont on survolait le terrain.
 *
 * L'échelon suit donc le zoom, et une seule fonction en décide :
 * `visibiliteLimites`. Aucun composant ne compare un zoom à un seuil de son
 * côté — chercher « quand la limite de compagnie apparaît-elle » doit mener
 * ici, et nulle part ailleurs.
 *
 * LES SEUILS NE SONT PAS NOUVEAUX
 * -------------------------------
 * Ils sont ceux du clustering des barrages (`SEUILS_ZOOM`), et c'est
 * délibéré : la carte agrège déjà les barrages par région sous le zoom 7, par
 * compagnie de 7 à 8, et les montre un par un à partir de 9. Donner aux
 * limites leurs propres seuils aurait fait mentir la carte — des barrages
 * groupés par compagnie sur un fond découpé en régions, et l'inverse deux
 * crans plus loin. Un seul jeu de seuils, une seule lecture :
 *
 *     zoom < 7   → RÉGIONS      (clusters régionaux)
 *     7 ≤ z < 9  → COMPAGNIES   (clusters de compagnie)
 *     zoom ≥ 9   → BRIGADES     (barrages individuels)
 *
 * UN SEUL ÉCHELON À LA FOIS — LA RÈGLE EST EXCLUSIVE
 * ---------------------------------------------------
 * Quand les compagnies apparaissent, les régions DISPARAISSENT ; quand les
 * brigades apparaissent, les compagnies disparaissent à leur tour. Jamais
 * deux découpages superposés.
 *
 * Les parents avaient d'abord été gardés en retrait, pour situer l'unité
 * qu'on examine. À l'usage, la carte y perdait : deux traits au même endroit,
 * de deux teintes, avec des sommets presque confondus là où une compagnie
 * épouse le bord de sa région — on ne savait plus lequel on lisait, et le
 * survol atteignait une fois sur deux le mauvais. Le rattachement, lui, est
 * déjà dit ailleurs, et mieux : par le fil d'Ariane en haut de l'écran
 * (« Maroc › Région Agadir › Compagnie Agadir ») et par la bulle du contour.
 * La carte n'a donc pas à le répéter en traits.
 *
 * `OPACITE_ROLE` conserve ses rôles `parent` et `lointain` : ils ne sont plus
 * employés par le plan ci-dessous, mais une couche COCHÉE À LA MAIN reste
 * possible, et un échelon de contexte pourrait revenir sans réécrire la
 * mécanique.
 */
import { SEUILS_ZOOM, determinerNiveauHierarchie } from './barrageClustering.js';

/** Les trois échelons territoriaux, du plus large au plus fin. */
export const ECHELONS = ['region', 'compagnie', 'brigade'];

/** Couche de contours qui porte chaque échelon (voir layersConfig.js). */
export const COUCHE_ECHELON = {
  region: 'circo_reg',
  compagnie: 'circo_cie',
  brigade: 'circo_bt',
};

/** Les trois clés de couche, dans l'ordre d'empilement voulu. */
export const COUCHES_LIMITES = ECHELONS.map((e) => COUCHE_ECHELON[e]);

/**
 * UN VOLET LEAFLET PAR ÉCHELON — c'est ce qui règle l'empilement ET le fondu.
 *
 * Les volets standards de Leaflet : tuiles 200, vecteurs (`overlayPane`) 400,
 * marqueurs 600, infobulles 650, bulles 700. Les trois volets ci-dessous
 * s'intercalent entre les vecteurs ordinaires (routes, voile territorial) et
 * les marqueurs, dans l'ordre région → compagnie → brigade : la limite la
 * plus fine passe donc toujours au-dessus de la plus large, et aucune ne
 * couvre un repère.
 *
 * Deux propriétés CSS suffisent ensuite à tout piloter, sans toucher aux
 * milliers de tracés qu'ils contiennent :
 *   `opacity`        — l'apparition et l'effacement progressifs ;
 *   `pointer-events` — une limite en retrait ne vole pas le clic destiné à
 *                      l'échelon principal qu'elle recouvre exactement.
 *
 * Aucun `z-index` arbitraire (999999 et consorts) : ces trois valeurs se
 * lisent dans l'échelle de Leaflet, et le voile de brume (640) comme la
 * carte de chaleur (350) s'y rangent déjà.
 */
export const PANE_LIMITES = {
  circo_reg: { nom: 'gr-limites-reg', zIndex: 402 },
  circo_cie: { nom: 'gr-limites-cie', zIndex: 404 },
  circo_bt: { nom: 'gr-limites-bt', zIndex: 406 },
};

/** Volet du contour mis en avant : au-dessus des trois échelons. */
export const PANE_CONTOUR = { nom: 'gr-contour-entite', zIndex: 410 };

/** Durée du fondu d'un échelon, en millisecondes. */
export const DUREE_FONDU = 200;

/**
 * Force de chaque rôle.
 *
 * `principal` — l'échelon que le zoom désigne : pleine couleur, cliquable.
 * `parent`    — l'échelon immédiatement supérieur : repère de rattachement.
 * `lointain`  — le grand-parent (la région quand on est sur les brigades) :
 *               présent pour situer, assez pâle pour qu'on l'oublie.
 */
export const OPACITE_ROLE = { principal: 1, parent: 0.5, lointain: 0.26 };

/**
 * Ce que chaque échelon affiche. Table plutôt que cascade de `if` : les trois
 * lignes se lisent d'un coup d'œil et une quatrième s'ajouterait sans
 * réécrire de logique.
 */
const PLAN = {
  region: { circo_reg: 'principal' },
  compagnie: { circo_cie: 'principal' },
  brigade: { circo_bt: 'principal' },
};

/** Libellés d'interface — le même mot partout pour le même échelon. */
export const LIBELLE_ECHELON = {
  region: { court: 'RÉG', long: 'Régions' },
  compagnie: { court: 'CIE', long: 'Compagnies' },
  brigade: { court: 'BT', long: 'Brigades' },
};

/**
 * Seuils exposés pour l'affichage et les contrôles — dérivés, jamais
 * redéclarés (voir l'en-tête : les valeurs vivent dans `SEUILS_ZOOM`).
 */
export const SEUILS_LIMITES = {
  COMPAGNIE_MIN: SEUILS_ZOOM.CIE_MIN,
  BRIGADE_MIN: SEUILS_ZOOM.INDIVIDUEL_MIN,
};

/**
 * Échelon territorial pour un zoom — ou pour un niveau de clustering déjà
 * calculé, ce qui évite de retraverser les seuils quand l'appelant l'a sous
 * la main. `barrage` est le nom que le clustering donne au niveau le plus
 * fin ; côté limites, ce niveau s'appelle `brigade`.
 */
export function echelonPourZoom(zoomOuNiveau) {
  const niveau =
    typeof zoomOuNiveau === 'string' ? zoomOuNiveau : determinerNiveauHierarchie(zoomOuNiveau);
  return niveau === 'barrage' ? 'brigade' : niveau;
}

/**
 * LA FONCTION UNIQUE — état de chaque couche de limites.
 *
 * @param {number|string} zoomOuNiveau zoom Leaflet, ou échelon déjà résolu.
 * @param {Set<string>}   forcees      couches cochées à la main dans le
 *   panneau des couches. Une case cochée reste un ordre explicite : elle
 *   affiche son découpage à pleine force quel que soit le zoom. Le zoom
 *   choisit le DÉFAUT, il ne confisque pas la commande.
 * @returns {{echelon: string, couches: Record<string, {
 *   visible: boolean, role: string, opacite: number, interactif: boolean,
 *   force: boolean }>}}
 */
export function visibiliteLimites(zoomOuNiveau, forcees) {
  const echelon = echelonPourZoom(zoomOuNiveau);
  const plan = PLAN[echelon] ?? PLAN.region;
  const couches = {};

  for (const cle of COUCHES_LIMITES) {
    const role = plan[cle] ?? null;
    const force = Boolean(forcees?.has(cle));
    couches[cle] = {
      visible: Boolean(role) || force,
      /* Cochée à la main, une couche est traitée comme l'échelon principal :
         on l'a demandée, on ne la reçoit pas en filigrane. */
      role: force ? 'principal' : (role ?? 'parent'),
      opacite: force ? 1 : role ? OPACITE_ROLE[role] : 0,
      interactif: force || role === 'principal',
      force,
    };
  }

  return { echelon, couches };
}
