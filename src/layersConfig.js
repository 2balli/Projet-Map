/**
 * Déclaration des couches réelles (طبقات) produites par `npm run build:layers`.
 *
 * Chaque couche est chargée à la demande : le fichier n'est téléchargé qu'au
 * moment où l'utilisateur active son bouton (sauf `defaultOn`).
 *
 * Pour ajouter une couche : voir README.md, section « Ajouter une couche ».
 */
import {
  IconRegion,
  IconCompagnie,
  IconBrigade,
  IconCirconscription,
  IconPointage,
  IconTerritoire,
  IconProximite,
  IconServeur,
  IconZahma,
  IconAccident,
  IconBarrageFixe,
  IconBarrageMobile,
  IconPeage,
  IconGare,
  IconAeroport,
  IconPort,
} from './icons.jsx';
import { TYPES_MARQUAGE, cleCouche, TYPES_BARRAGE } from './marquages.js';

/** Icône de panneau par nature de marquage (mêmes tracés que les repères). */
const MARQUAGE_ICONS = {
  zahma: IconZahma,
  accident: IconAccident,
  barrage_fixe: IconBarrageFixe,
  barrage_mobile: IconBarrageMobile,
};

/**
 * Palette : voir src/palette.js, source unique contrôlée par
 * `npm run check:palette`. Réexportée ici pour ne pas changer les imports
 * existants.
 */
import { COLORS, CLASSES_ROUTE, HABILLAGE, COULEURS_INFRASTRUCTURE } from './palette.js';

export { COLORS, CLASSES_ROUTE, HABILLAGE };

/**
 * Réseau routier : il n'est plus dessiné par l'application — le fond de carte
 * hors ligne (maroc-carte-offline) trace les routes, leurs numéros et leurs
 * noms. Les fichiers `layers/routes_*.geojson` restent produits : les scripts
 * serveur s'en servent pour recaler les barrages sur le tracé (voir
 * serveur/routesAffichees.mjs). Le calcul d'itinéraire lit `graphe_routier.json`.
 */

/** Couches surfaciques : circonscriptions. */
export const CIRCO_LAYERS = [
  {
    key: 'circo_reg',
    url: 'layers/circo_reg.geojson',
    icon: IconCirconscription,
    fr: 'Circonscriptions Régions',
    ar: 'الدوائر الجهوية',
    color: COLORS.reg,
    weight: 2.2,
    /* Remplissage à peine perceptible : la région se devine, les repères dominent. */
    fillOpacity: 0.03,
    defaultOn: false,
    /**
     * Source anonyme (GeometryCollection nue), mais nommée au build par
     * recoupement avec les circonscriptions BT : cliquable et analysable.
     */
    cliquable: true,
  },
  {
    key: 'circo_cie',
    url: 'layers/circo_cie.geojson',
    icon: IconCirconscription,
    fr: 'Circonscriptions Compagnies',
    ar: 'دوائر السرايا',
    color: COLORS.cie,
    weight: 1.6,
    fillOpacity: 0.04,
    defaultOn: false,
    /** Nommée au build comme les régions, mais 5 attributions restent douteuses. */
    cliquable: true,
  },
  {
    key: 'circo_bt',
    url: 'layers/circo_bt.geojson',
    icon: IconCirconscription,
    fr: 'Circonscriptions BT',
    ar: 'الدوائر الترابية',
    color: COLORS.bt,
    weight: 1.0,
    fillOpacity: 0.04,
    defaultOn: false,
    /** Porte ses propres attributs depuis la source (gr_bde / gr_cie / gr_region). */
    cliquable: true,
  },
];

/** Couches ponctuelles : implantations. */
export const POINT_LAYERS = [
  {
    key: 'pts_reg',
    url: 'layers/pts_reg.geojson',
    icon: IconRegion,
    glyph: 'region', // marqueur GPS : voir markerIcons.js
    scale: 1.05,
    fr: 'Chefs-lieux Régions',
    ar: 'مقرات الجهات',
    color: COLORS.reg,
    defaultOn: false,
    permanentLabel: true, // 28 entités : libellés affichés en permanence
  },
  {
    key: 'pts_cie',
    url: 'layers/pts_cie.geojson',
    icon: IconCompagnie,
    glyph: 'compagnie',
    scale: 0.85,
    fr: 'Chefs-lieux Compagnies',
    ar: 'مقرات السرايا',
    color: COLORS.cie,
    defaultOn: false,
    permanentLabel: false,
  },
  {
    key: 'pts_bt',
    url: 'layers/pts_bt.geojson',
    icon: IconBrigade,
    glyph: 'brigade',
    scale: 0.72,
    fr: 'Brigades Territoriales',
    ar: 'مراكز الدرك الترابي',
    color: COLORS.bt,
    defaultOn: false,
    permanentLabel: false,
  },
];

/**
 * Infrastructures de transport — données RÉELLES OpenStreetMap (voir
 * scripts/build-peages.mjs et scripts/build-infrastructure.mjs), pas un jeu
 * de démonstration : au même titre que le tracé des autoroutes, leur
 * emplacement est un fait géographique vérifiable. Regroupées à part, juste
 * après le réseau routier dont elles dépendent (péages) ou qu'elles
 * complètent (gares, aéroports, ports). Chacune sa couleur — voir
 * COULEURS_INFRASTRUCTURE dans src/palette.js et `npm run check:palette`.
 */
export const INFRASTRUCTURE_LAYERS = [
  {
    key: 'peages',
    url: 'layers/peages.geojson',
    icon: IconPeage,
    glyph: 'peage',
    scale: 0.85,
    fr: 'Péages',
    ar: 'محطات الأداء',
    color: COULEURS_INFRASTRUCTURE.peage,
    defaultOn: false,
    permanentLabel: false,
  },
  {
    key: 'gares',
    url: 'layers/gares.geojson',
    icon: IconGare,
    glyph: 'gare',
    scale: 0.85,
    fr: 'Gares ferroviaires',
    ar: 'محطات القطار',
    color: COULEURS_INFRASTRUCTURE.gare,
    defaultOn: false,
    permanentLabel: false,
  },
  {
    key: 'aeroports',
    url: 'layers/aeroports.geojson',
    icon: IconAeroport,
    glyph: 'aeroport',
    scale: 0.9,
    fr: 'Aéroports',
    ar: 'المطارات',
    color: COULEURS_INFRASTRUCTURE.aeroport,
    defaultOn: false,
    permanentLabel: false,
  },
  {
    key: 'ports',
    url: 'layers/ports.geojson',
    icon: IconPort,
    glyph: 'port',
    scale: 0.9,
    fr: 'Ports',
    ar: 'الموانئ',
    color: COULEURS_INFRASTRUCTURE.port,
    defaultOn: false,
    permanentLabel: false,
  },
];

/**
 * Pointages de flottes — UNE seule couche.
 *
 * Le point et sa zone d'action décrivent le même objet : deux boutons distincts
 * (« Pointages » et « Zones de pointage ») donnaient l'impression de deux jeux
 * de données, alors qu'ils lisent le même fichier. La couche affiche donc le
 * repère ET son emprise, ensemble.
 */
export const POINTAGE_LAYERS = [
  {
    key: 'pointages',
    url: 'layers/pointages.geojson',
    icon: IconPointage,
    glyph: 'pointage',
    scale: 0.78,
    fr: 'Pointages et zones',
    ar: 'نقاط المراقبة ومناطقها',
    color: COLORS.pointage,
    /** Trace le cercle d'emprise (diamètre / 2) sous chaque repère. */
    avecZone: true,
    defaultOn: false,
  },
];

/**
 * Couches calculées : paires d'entités distantes de <= 5 km.
 * Rien n'est préparé au build — les liaisons sont recalculées à l'affichage.
 */
export const PROXIMITY_LAYERS = [
  {
    key: 'proximite_bt',
    icon: IconProximite,
    fr: 'BT à moins de 5 km',
    ar: 'تقارب المراكز',
    /**
     * Couleur de la couche analysée, et non une teinte propre : la liaison
     * appartient visuellement aux brigades qu'elle relie. Le trait pointillé
     * suffit à la distinguer, et c'est une couleur de moins à mémoriser.
     */
    color: COLORS.bt,
    dataKey: 'pts_bt',
    defaultOn: false,
  },
  {
    key: 'proximite_pointages',
    icon: IconProximite,
    fr: 'Pointages à moins de 5 km',
    ar: 'تقارب نقاط المراقبة',
    color: COLORS.pointage,
    dataKey: 'pointages',
    defaultOn: false,
  },
];

/**
 * Marquages saisis par les unités.
 *
 * Seules figurent ici les natures qui servent à l'optimisation du dispositif :
 * les BARRAGES eux-mêmes, et les POINTS NOIRS d'accidents qui justifient leur
 * implantation (voir `motifsDuBarrage` côté serveur).
 *
 * Congestion et entrées de ville ont été retirées du
 * panneau : elles répondaient à d'autres usages, retirés depuis. Les données
 * correspondantes ne sont PAS supprimées — elles restent dans le dépôt et
 * réapparaîtraient en rétablissant une entrée ci-dessous.
 *
 * `local: true` : ces couches n'ont AUCUN fichier à télécharger — elles sont
 * alimentées par le serveur (voir src/api.js). Le chargeur de fichiers les
 * ignore donc, sans quoi il tenterait un fetch voué à l'échec.
 */
const NATURES_AFFICHEES = ['accident', 'barrage_fixe', 'barrage_mobile'];

export const MARQUAGE_LAYERS = TYPES_MARQUAGE.filter((t) => NATURES_AFFICHEES.includes(t.key)).map((t) => ({
  key: cleCouche(t.key),
  typeMarquage: t.key,
  icon: MARQUAGE_ICONS[t.key],
  fr: t.fr,
  ar: t.ar,
  color: t.color,
  local: true,
  /* Les barrages sont le sujet même de l'application : cochés d'office. */
  defaultOn: TYPES_BARRAGE.includes(t.key),
}));

/**
 * Habillage du territoire : masque hors frontières + liseré de frontière.
 *
 * Ce n'est pas une donnée mais le CADRE de la carte, et il ne se décoche plus.
 * Le masque est désormais opaque, et la carte est bornée en déplacement comme
 * en zoom au seul territoire national (voir `BORNES_MAROC` dans mapConfig.js
 * et `LimiterAuTerritoire` dans GendarmerieMap.jsx). Proposer une case pour
 * l'éteindre n'aurait plus de sens : elle rouvrirait la vue sur les pays
 * voisins que les deux autres dispositifs interdisent d'atteindre.
 *
 * L'entrée reste déclarée — c'est elle qui fait télécharger le contour — mais
 * elle ne figure plus dans `LAYER_GROUPS`, donc plus dans le panneau.
 */
export const CADRE_LAYERS = [
  {
    key: 'territoire',
    url: 'layers/territoire.geojson',
    icon: IconTerritoire,
    fr: 'Voile hors territoire',
    ar: 'حجب خارج الوطن',
    color: HABILLAGE.frontiere,
    defaultOn: true,
  },
];

/**
 * Groupes AFFICHÉS dans le panneau latéral, dans l'ordre.
 *
 * Le réseau routier n'y figure pas : il fait partie du fond de carte. Les
 * infrastructures de transport, le terrain (pointages) et les couches de
 * proximité ont été retirés du panneau à la demande du commandement.
 *
 * Retirer un groupe d'ici ne retire pas la DONNÉE : les pointages restent
 * chargés à l'ouverture du panneau Analyse, qui les exploite (population,
 * couverture, proximité) sans passer par une case à cocher.
 *
 * ATTENTION — cette liste ne pilote QUE l'affichage du panneau. Les couches
 * elles-mêmes restent déclarées et chargées via `ALL_LAYERS` ci-dessous :
 * dériver l'un de l'autre ferait disparaître les routes de la carte en même
 * temps que de la liste.
 */
export const LAYER_GROUPS = [
  { id: 'circo', fr: 'Circonscriptions', ar: 'الدوائر', layers: CIRCO_LAYERS },
  { id: 'implantations', fr: 'Implantations', ar: 'المراكز', layers: POINT_LAYERS },
  { id: 'marquages', fr: 'Marquages compagnie', ar: 'تشوير السرية', layers: MARQUAGE_LAYERS },
];

/**
 * Toutes les couches déclarées, à plat — y compris celles qui ne sont plus
 * proposées dans le panneau. C'est cette liste, et non `LAYER_GROUPS`, qui
 * décide de ce qui est actif au démarrage et de ce qui est téléchargé (voir
 * `ALL_LAYERS` dans GendarmerieMap.jsx).
 */
export const ALL_LAYERS = [
  ...CADRE_LAYERS,
  ...INFRASTRUCTURE_LAYERS,
  ...CIRCO_LAYERS,
  ...POINT_LAYERS,
  ...POINTAGE_LAYERS,
  ...PROXIMITY_LAYERS,
  ...MARQUAGE_LAYERS,
];

/**
 * Fond de carte unique : la carte hors ligne de maroc-carte-offline (voir
 * mapConfig.js). Aucune tuile n'est demandée hors de l'application.
 */
export const BASEMAP = {
  id: 'hors-ligne',
  icon: IconServeur,
  fr: 'Carte hors ligne',
  hint: 'fond-carte/tiles/maroc.pmtiles',
};
