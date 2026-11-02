/**
 * Jeu d'icônes unique — SVG vectoriels, jamais d'emoji.
 * Contrat commun : trait 1.75, coins arrondis, boîte 24, `currentColor`.
 * Toute icône ajoutée doit respecter ces valeurs (cohérence de la famille).
 *
 * Les glyphes également utilisés comme marqueurs de carte viennent de
 * `glyphs.js` — source unique partagée avec `markerIcons.js`.
 */
import { GLYPHS } from './glyphs.js';

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

const Svg = ({ size = 20, children, ...rest }) => (
  <svg width={size} height={size} {...base} {...rest}>
    {children}
  </svg>
);

/* ---------------- Hiérarchie territoriale ---------------- */

/** Construit une icône React à partir d'un glyphe partagé. */
const fromGlyph = (name) => {
  const Icon = (p) => (
    <Svg {...p}>
      {GLYPHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </Svg>
  );
  Icon.displayName = `Icon_${name}`;
  return Icon;
};

/** Région — étoile dans un écu. */
export const IconRegion = fromGlyph('region');

/** Compagnie — bâtiment à étages. */
export const IconCompagnie = fromGlyph('compagnie');

/** Brigade territoriale — écu avec coche. */
export const IconBrigade = fromGlyph('brigade');

/* ---------------- Surfaces ---------------- */

/** Circonscription — polygone à sommets. */
export const IconCirconscription = (p) => (
  <Svg {...p}>
    <path d="M5 8.5 11 4l8 3.5-1.5 10L9 20l-4-4.5v-7Z" />
    <circle cx="5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="11" cy="4" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* ---------------- Terrain ---------------- */

/** Pointage / contrôle routier — cône de chantier (repère Waze). */
export const IconPointage = fromGlyph('pointage');

/** Zone d'action — rayon autour d'un point. */
export const IconZone = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M12 12h8" strokeDasharray="2 2" />
  </Svg>
);

/** Liaison de proximité — deux nœuds reliés. */
export const IconProximite = (p) => (
  <Svg {...p}>
    <circle cx="6" cy="7" r="2.6" />
    <circle cx="18" cy="17" r="2.6" />
    <path d="M8.2 8.8l7.6 6.4" strokeDasharray="3 2.5" />
  </Svg>
);

/* ---------------- Réseau routier ---------------- */

/** Autoroute — chaussées séparées. */
export const IconAutoroute = fromGlyph('autoroute');

/** Route nationale / régionale / provinciale — tracé sinueux. */
export const IconRoute = fromGlyph('route');

/** Mesure de distance — deux jalons reliés. */
export const IconDistance = fromGlyph('distance');

/** Territoire national — contour plein cerné d'un voile. */
export const IconTerritoire = (p) => (
  <Svg {...p}>
    <path d="M11 3.5 6 6v5.5c0 3.5 2 6.5 5 8 3-1.5 5-4.5 5-8V6l-5-2.5Z" />
    <path d="M19.5 4.5c1 2.2 1.5 4.6 1.5 7 0 2.6-.6 5-1.7 7.2" strokeDasharray="2.5 2.5" />
    <path d="M3.5 19.5A15.6 15.6 0 0 1 2 11.5c0-2.4.5-4.8 1.5-7" strokeDasharray="2.5 2.5" />
  </Svg>
);

/* ---------------- Marquages du chef de compagnie ---------------- */

/** Congestion — file de véhicules. */
export const IconZahma = fromGlyph('zahma');

/** Point noir accidents — étoile de choc. */
export const IconAccident = fromGlyph('accident');

/** Barrage fixe — barrière sur son fût. */
export const IconBarrageFixe = fromGlyph('barrage_fixe');

/** Barrage mobile — barrière relevable et flèche de déplacement. */
export const IconBarrageMobile = fromGlyph('barrage_mobile');

/** Barrage fixe intouchable — forteresse bastionnée, barrière blindée et étoile royale. */
export const IconBarrageIntouchable = fromGlyph('barrage_intouchable');

/** Barrage VIP — barrière surmontée d'un écusson, position définitive. */
export const IconBarrageVIP = fromGlyph('barrage_vip');

export const IconMission = fromGlyph('mission');

/* ---------------- Points stratégiques (sous-types de zahma) ---------------- */

/** Entrée de ville — portique routier. */
export const IconEntreeVille = fromGlyph('entree_ville');

/** Péage — guérite et barrière. */
export const IconPeage = fromGlyph('peage');

/* ---------------- Infrastructures de transport (données réelles) ---------------- */

/** Gare ferroviaire. */
export const IconGare = fromGlyph('gare');

/** Aéroport. */
export const IconAeroport = fromGlyph('aeroport');

/** Port. */
export const IconPort = fromGlyph('port');

/** Saisie terrain — stylet sur un repère. */
export const IconMarquage = (p) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-10.4A6.5 6.5 0 0 1 12 4a6.5 6.5 0 0 1 6.5 6.6" />
    <path d="m15 19.4 5.2-5.2 1.4 1.4-5.2 5.2-1.9.5.5-1.9Z" />
    <circle cx="12" cy="10.4" r="2.2" />
  </Svg>
);

/** Autorité / habilitation — écu avec galon. */
export const IconChef = (p) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v6c0 4.2 3 7.6 7.5 9 4.5-1.4 7.5-4.8 7.5-9V6L12 3Z" />
    <path d="m8.6 10.5 3.4 3 3.4-3M8.6 14.2l3.4 3 3.4-3" />
  </Svg>
);

/** Horaires — cadran. */
export const IconHoraire = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.6V12l3.2 2" />
  </Svg>
);

/** Suppression — corbeille. */
export const IconPoubelle = (p) => (
  <Svg {...p}>
    <path d="M4.5 7.5h15M9.5 7.5V5.2h5v2.3" />
    <path d="M6.5 7.5 7.4 20h9.2l.9-12.5" />
    <path d="M10.3 11v5.4M13.7 11v5.4" />
  </Svg>
);

/** Crayon — corriger une fiche. */
export const IconCrayon = (p) => (
  <Svg {...p}>
    <path d="M4.5 19.5h4l9.2-9.2a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4.5 15.5z" />
    <path d="m14.2 6.3 3.5 3.5" />
  </Svg>
);

/** Export d'un fichier. */
export const IconExport = (p) => (
  <Svg {...p}>
    <path d="M12 15.5V4.5" />
    <path d="m8.2 8 3.8-3.5L15.8 8" />
    <path d="M4.5 14.5v3.2c0 1 .8 1.8 1.8 1.8h11.4c1 0 1.8-.8 1.8-1.8v-3.2" />
  </Svg>
);

/** Impression — imprimante. */
export const IconPrint = (p) => (
  <Svg {...p}>
    <path d="M6.5 8.5V4h11v4.5" />
    <path d="M6.5 17.5h-2A1.5 1.5 0 0 1 3 16v-4.5A2 2 0 0 1 5 9.5h14a2 2 0 0 1 2 2V16a1.5 1.5 0 0 1-1.5 1.5h-2" />
    <path d="M6.5 13.5h11v6.5h-11z" />
  </Svg>
);

/** Import d'un fichier. */
export const IconImport = (p) => (
  <Svg {...p}>
    <path d="M12 4.5v11" />
    <path d="m8.2 12 3.8 3.5L15.8 12" />
    <path d="M4.5 14.5v3.2c0 1 .8 1.8 1.8 1.8h11.4c1 0 1.8-.8 1.8-1.8v-3.2" />
  </Svg>
);

/** Ajout — croix. */
export const IconPlus = (p) => (
  <Svg {...p}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Svg>
);

/** Verrou — hors périmètre d'habilitation. */
export const IconVerrou = (p) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14v2.5" />
  </Svg>
);

/* ---------------- Fonds de carte ---------------- */

/** Serveur interne. */
export const IconServeur = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="6" rx="2" />
    <rect x="3.5" y="13.5" width="17" height="6" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Svg>
);

/** Plan / vecteur. */
export const IconPlan = (p) => (
  <Svg {...p}>
    <path d="M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13l-5.5 2-6-2Z" />
    <path d="M9 4.5v13M15 6.5v13" />
  </Svg>
);

/** Satellite / imagerie. */
export const IconSatellite = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.4 2.3 3.7 5.3 3.7 8.5s-1.3 6.2-3.7 8.5c-2.4-2.3-3.7-5.3-3.7-8.5S9.6 5.8 12 3.5Z" />
  </Svg>
);

/* ---------------- Interface ---------------- */

export const IconLayers = (p) => (
  <Svg {...p}>
    <path d="m12 3.5 8.5 4.2-8.5 4.3-8.5-4.3L12 3.5Z" />
    <path d="m3.5 12.3 8.5 4.2 8.5-4.2" />
    <path d="m3.5 16.6 8.5 4.2 8.5-4.2" />
  </Svg>
);

/** Consultation — tableau de données. */
export const IconTable = (p) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.3 4.5v15" />
  </Svg>
);

/** Tendance — flèche diagonale, `hausse` inverse le sens (même contrat que `IconChevron`). */
export const IconTendance = ({ size = 12, hausse = true, ...rest }) => (
  <Svg size={size} {...rest} style={{ transform: hausse ? 'none' : 'scaleY(-1)' }}>
    <path d="M4 16 10 10l4 4 6-7" />
    <path d="M14 7h6v6" />
  </Svg>
);

/* ---------------- Parcours guidé ---------------- */

/**
 * Coche — étape franchie, choix retenu, parcours terminé.
 * Jamais employée seule pour porter un sens : toujours doublée d'un libellé ou
 * d'un changement de fond (voir `Parcours.jsx`), comme le reste de l'interface.
 */
export const IconCoche = (p) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);

/**
 * Flèche horizontale — SUIVANT et RETOUR du parcours guidé.
 * `arriere` la retourne : une seule forme pour les deux sens, donc aucun
 * risque de voir deux dessins divergents pour un même geste.
 */
export const IconFleche = ({ size = 18, arriere = false, ...rest }) => (
  <Svg size={size} {...rest} style={{ transform: arriere ? 'rotate(180deg)' : 'none' }}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Svg>
);

export const IconChevron = ({ size = 18, open = false, ...rest }) => (
  <Svg size={size} {...rest} style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
    <path d="m6 9.5 6 5 6-5" />
  </Svg>
);

/**
 * CIBLE — « montre-le-moi sur la carte ».
 *
 * Un réticule plutôt qu'une épingle : l'épingle dit « il y a un poste ici »,
 * le réticule dit « regarde ici ». C'est bien le second sens qu'on veut, et
 * l'épingle est déjà prise par les repères eux-mêmes.
 */
export const IconCible = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);

/**
 * POIGNÉE DE DÉPLACEMENT — six points, la convention universelle du « ça se
 * saisit ». Deux colonnes plutôt qu'une : une seule colonne se lit comme un
 * séparateur, deux se lisent comme une prise.
 */
export const IconPoignee = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="6" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconClose = (p) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Svg>
);

/* ---------------- Affichage ---------------- */

/** Thème clair : un soleil. */
export const IconSoleil = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41" />
  </Svg>
);

/** Thème sombre : un croissant. */
export const IconLune = (p) => (
  <Svg {...p}>
    <path d="M20.25 14.5A8.25 8.25 0 0 1 9.5 3.75a8.25 8.25 0 1 0 10.75 10.75Z" />
  </Svg>
);

/** Paramètres : un engrenage. */
export const IconReglages = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1Z" />
  </Svg>
);

/** Mode focus : quatre coins de cadrage, vers l'extérieur. */
export const IconFocus = (p) => (
  <Svg {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </Svg>
);

/** Sortie du mode focus : les coins rentrent. */
export const IconFocusQuitter = (p) => (
  <Svg {...p}>
    <path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" />
  </Svg>
);

export const IconSpinner = (p) => (
  <Svg {...p} className="animate-spin motion-reduce:animate-none">
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
  </Svg>
);

export const IconAlert = (p) => (
  <Svg {...p}>
    <path d="M12 4.5 20.5 19h-17L12 4.5Z" />
    <path d="M12 10v4M12 16.6h.01" />
  </Svg>
);

export const IconTarget = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </Svg>
);

/** Loupe — recherche d'un repère sur la carte. */
export const IconLoupe = (p) => (
  <Svg {...p}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </Svg>
);

/** Assistant — ampoule, pour une suggestion plutôt qu'une donnée constatée. */
export const IconAssistant = (p) => (
  <Svg {...p}>
    <path d="M9 18.5h6M9.8 21h4.4" />
    <path d="M12 3.5a5.8 5.8 0 0 0-3.2 10.6c.6.45 1 1.1 1 1.9v.5h4.4v-.5c0-.8.4-1.45 1-1.9A5.8 5.8 0 0 0 12 3.5Z" />
  </Svg>
);

/** Déconnexion — sortie de session (porte avec flèche sortante). */
export const IconDeconnexion = (p) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </Svg>
);

/** Restauration — flèche circulaire de remise en service. */
export const IconRestaurer = (p) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);

/** Notifications — cloche. */
export const IconCloche = (p) => (
  <Svg {...p}>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.75 6 1.75 6H4.25S6 14 6 9.5Z" />
    <path d="M10 19a2.1 2.1 0 0 0 4 0" />
  </Svg>
);

/** Instructions — carnet aux étapes numérotées. */
export const IconGuide = (p) => (
  <Svg {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M9 8h7M9 12h7M9 16h4" />
    <path d="M7 8h.01M7 12h.01M7 16h.01" />
  </Svg>
);
