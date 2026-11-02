/**
 * APPARENCE — la partie PURE du système de thèmes : palettes, modes,
 * normalisation et résolution d'une préférence, tables du fond de carte et de
 * l'habillage. Sans React ni réseau : éprouvée sous Node par
 * `npm run check:theme`. Le crochet et le stockage sont dans theme.js.
 */
/* ------------------------------------------------------------------ */
/* Palettes et modes                                                  */
/* ------------------------------------------------------------------ */

export const PALETTES = ['midnight', 'graphite', 'arctic', 'forest'];
export const MODES = ['light', 'dark', 'systeme'];

/**
 * Description de chaque palette : libellé, résumé, et aperçu par mode
 * (fond, panneau, interaction, encre) — les mêmes valeurs que index.css.
 */
export const DESCRIPTIONS_PALETTES = {
  midnight: {
    nom: 'Midnight Command',
    resume: 'Bleu nuit de commandement, interaction cyan.',
    apercu: { dark: ['#0B1220', '#151E2E', '#38BDF8', '#F1F5F9'], light: ['#F4F7FB', '#FFFFFF', '#1D4ED8', '#0B1A33'] },
  },
  graphite: {
    nom: 'Graphite & Electric Blue',
    resume: 'Graphite neutre, bleu électrique.',
    apercu: { dark: ['#111113', '#1C1C20', '#4F8CFF', '#F4F4F5'], light: ['#F6F6F7', '#FFFFFF', '#2563EB', '#18181B'] },
  },
  arctic: {
    nom: 'Arctic Professional',
    resume: 'Blancs froids et bleu glacier, très lisible.',
    apercu: { dark: ['#0E1A24', '#172937', '#67C8F5', '#EAF4FB'], light: ['#F5F9FC', '#FFFFFF', '#0369A1', '#0C2233'] },
  },
  forest: {
    nom: 'Forest Slate',
    resume: 'Ardoise verte, vert opérationnel.',
    apercu: { dark: ['#0F1714', '#18241F', '#4ADE9B', '#EEF4F0'], light: ['#F4F7F5', '#FFFFFF', '#047857', '#12211A'] },
  },
};

export const LIBELLES_MODES = { light: 'Clair', dark: 'Sombre', systeme: 'Système' };

/**
 * ANIMATIONS — « système » suit le réglage du poste (Windows : Effets
 * d'animation ; il fixe `prefers-reduced-motion`) ; « activées » et
 * « réduites » le remplacent pour ce compte. Résolu en `data-mouvement` sur
 * <html> (normal | reduit), que lisent index.css et les animations en JS.
 */
export const MOUVEMENTS = ['systeme', 'actives', 'reduites'];
export const LIBELLES_MOUVEMENTS = { systeme: 'Système', actives: 'Activées', reduites: 'Réduites' };

export const APPARENCE_DEFAUT = Object.freeze({ palette: 'midnight', mode: 'systeme', mouvement: 'systeme' });

/**
 * Une préférence lisible, quelle que soit sa forme : la nouvelle
 * `{ palette, mode }`, ou l'ancienne `{ theme }` des trois thèmes précédents
 * (dark → Midnight sombre, light → Arctic clair, slate → Graphite sombre).
 */
export function normaliserApparence(p) {
  if (!p || typeof p !== 'object') return { ...APPARENCE_DEFAUT };
  const mouvement = MOUVEMENTS.includes(p.mouvement) ? p.mouvement : APPARENCE_DEFAUT.mouvement;
  if (PALETTES.includes(p.palette)) {
    return { palette: p.palette, mode: MODES.includes(p.mode) ? p.mode : APPARENCE_DEFAUT.mode, mouvement };
  }
  const ancien = { dark: { palette: 'midnight', mode: 'dark' }, light: { palette: 'arctic', mode: 'light' }, slate: { palette: 'graphite', mode: 'dark' } }[p.theme];
  return ancien ? { ...ancien, mouvement } : { ...APPARENCE_DEFAUT };
}

/** Le poste demande-t-il moins d'animation ? */
export function mouvementReduitSysteme() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  } catch {
    return false;
  }
}

/** « normal » | « reduit » : le choix du compte, ou celui du poste en mode système. */
export function resoudreMouvement(mouvement, systemeReduit = mouvementReduitSysteme()) {
  if (mouvement === 'actives') return 'normal';
  if (mouvement === 'reduites') return 'reduit';
  return systemeReduit ? 'reduit' : 'normal';
}

/**
 * Les animations en JS (tracés, présence, vols de carte) le demandent ici :
 * l'état posé sur <html> fait foi ; à défaut, le réglage du poste.
 */
export function mouvementReduit() {
  try {
    const pose = document.documentElement.dataset.mouvement;
    if (pose) return pose === 'reduit';
  } catch {
    /* hors navigateur */
  }
  return mouvementReduitSysteme();
}

/** Le mode du système (sombre si le poste ne dit rien). */
export function modeSysteme() {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)')?.matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Apparence résolue : le mode « système » est remplacé par le mode réel. */
export function resoudreApparence(apparence, systeme = modeSysteme()) {
  const a = normaliserApparence(apparence);
  const mode = a.mode === 'systeme' ? systeme : a.mode;
  return { palette: a.palette, mode, cle: `${a.palette}-${mode}` };
}

/** La famille du fond de carte (sprites Protomaps) : le mode résolu. */
export const familleFond = (cle) => (String(cle ?? '').endsWith('-light') ? 'light' : 'dark');

/* ------------------------------------------------------------------ */
/* Le fond de carte et l'habillage de la carte                        */
/* ------------------------------------------------------------------ */

/**
 * LE FOND DE CARTE PAR THÈME — retouches de la palette Protomaps (voir
 * `construireStyle`, paramètre `retouches`) : une base par mode, teintée par
 * la palette (terres, mer, désert, routes). Le fond reste en retrait : ce sont
 * les repères qui parlent.
 */
const BASE_FOND = {
  dark: {
    background: '#17181a', earth: '#202124', water: '#17263c',
    park_a: '#1e3226', park_b: '#182a20', wood_a: '#1a2d22', wood_b: '#16261c', scrub_a: '#1d2720', scrub_b: '#19241c',
    sand: '#2c2a24', beach: '#332f26', buildings: '#282a2d', boundaries: '#5f6368',
    highway: '#c67d16', highway_casing_early: '#5d390a', highway_casing_late: '#5d390a',
    major: '#3c4043', major_casing_early: '#242528', major_casing_late: '#242528',
    minor_a: '#303134', minor_b: '#28292c', minor_casing: '#1d1e20',
    link: '#303134', link_casing: '#1d1e20', other: '#242528', minor_service: '#242528', minor_service_casing: '#1a1a1c',
    bridges_highway: '#c67d16', bridges_highway_casing: '#5d390a',
    bridges_major: '#3c4043', bridges_major_casing: '#242528',
    bridges_minor: '#303134', bridges_minor_casing: '#1d1e20',
    city_label: '#e8eaed', city_label_halo: '#202124', subplace_label: '#bdc1c6', subplace_label_halo: '#202124',
    roads_label_major: '#9aa0a6', roads_label_major_halo: '#202124', roads_label_minor: '#80868b', roads_label_minor_halo: '#202124',
    ocean_label: '#5f7598', country_label: '#9aa0a6', state_label: '#5f6368', state_label_halo: '#202124',
    landcover: { grassland: '#1c2820', barren: '#23211e', urban_area: '#242629', farmland: '#1f2820', glacier: '#2b2d30', scrub: '#1e261f', forest: '#1a261d' },
  },
  light: {
    background: '#f1f3f4', earth: '#f8f9fa', water: '#aad3df',
    park_a: '#c8e6c9', park_b: '#ceead6', wood_a: '#c8e6c9', wood_b: '#b7e1cd', scrub_a: '#d4ecd5', scrub_b: '#c8e6c9',
    sand: '#fef7e0', beach: '#fde293', hospital: '#fce8e6', school: '#feefe3', industrial: '#e8eaed', pedestrian: '#e8eaed',
    buildings: '#e8eaed', boundaries: '#9aa0a6',
    highway: '#fabb18', highway_casing_early: '#e59a16', highway_casing_late: '#e59a16',
    major: '#ffffff', major_casing_early: '#e0c068', major_casing_late: '#cfc9b8',
    minor_a: '#ffffff', minor_b: '#ffffff', minor_casing: '#e5e7eb',
    link: '#ffffff', link_casing: '#d1d5db', other: '#ffffff', minor_service: '#f8f9fa', minor_service_casing: '#e8eaed',
    bridges_highway: '#fabb18', bridges_highway_casing: '#e59a16',
    bridges_major: '#ffffff', bridges_major_casing: '#cfc9b8',
    bridges_minor: '#ffffff', bridges_minor_casing: '#e5e7eb',
    city_label: '#202124', city_label_halo: '#ffffff',
    subplace_label: '#3c4043', subplace_label_halo: '#ffffff',
    roads_label_major: '#5f6368', roads_label_major_halo: '#ffffff',
    roads_label_minor: '#70757a', roads_label_minor_halo: '#ffffff',
    ocean_label: '#5b7aa8', country_label: '#3c4043', state_label: '#5f6368', state_label_halo: '#ffffff',
    landcover: { grassland: '#c8e6c9', barren: '#fbf7ee', urban_area: '#f1ede9', farmland: '#dceed1', glacier: '#ffffff', scrub: '#dcedd8', forest: '#b7e1cd' },
  },
};

/** Teinte de chaque palette sur sa base : terres, mer, fond, désert, halos. */
const TEINTES_FOND = {
  midnight: { dark: {}, light: { landcover: { barren: '#fbf7ee' } } },
  graphite: {
    dark: {
      background: '#17171a', earth: '#1d1d21', water: '#121216', sand: '#202024', beach: '#26262b', buildings: '#141417',
      highway: '#44444d', major: '#3b3b43', minor_a: '#303037', minor_b: '#2c2c32', link: '#3b3b43', other: '#29292f', minor_service: '#29292f',
      city_label: '#b4b4bc', city_label_halo: '#111113', subplace_label: '#8b8b94', subplace_label_halo: '#111113',
      roads_label_major_halo: '#111113', roads_label_minor_halo: '#111113', boundaries: '#5d5d68',
      landcover: { grassland: '#1f2221', barren: '#1f1f23', urban_area: '#222226', farmland: '#202322', scrub: '#202122', forest: '#1d2321', glacier: '#26262b' },
    },
    light: { landcover: { barren: '#fbf7ee' } },
  },
  arctic: {
    dark: {
      background: '#112230', earth: '#15283a', water: '#0a1722', sand: '#182c3e', beach: '#1d3346', buildings: '#0f202d',
      highway: '#35516a', major: '#2e475d', minor_a: '#263c4f', link: '#2e475d', other: '#213545', minor_service: '#213545',
      city_label: '#b2cadc', city_label_halo: '#0e1a24', subplace_label_halo: '#0e1a24', roads_label_major_halo: '#0e1a24', roads_label_minor_halo: '#0e1a24',
      landcover: { grassland: '#17303c', barren: '#172b3c', urban_area: '#1a2e40', farmland: '#173040', scrub: '#172d3c', forest: '#163039', glacier: '#20384b' },
    },
    light: { landcover: { barren: '#fbf7ee' } },
  },
  forest: {
    dark: {
      background: '#141d19', earth: '#18231e', water: '#0d1a1b', sand: '#1b2620', beach: '#202c25', buildings: '#121a16',
      highway: '#3a4f45', major: '#32463c', minor_a: '#2a3a33', link: '#32463c', other: '#25332d', minor_service: '#25332d',
      city_label: '#b0c4b9', city_label_halo: '#0f1714', subplace_label_halo: '#0f1714', roads_label_major_halo: '#0f1714', roads_label_minor_halo: '#0f1714',
      landcover: { grassland: '#1b2d24', barren: '#1c2620', urban_area: '#1e2923', farmland: '#1b2d25', scrub: '#1b2a22', forest: '#192f25', glacier: '#24312b' },
    },
    light: { landcover: { barren: '#fbf7ee', forest: '#c8e6c9' } },
  },
};

/**
 * Couleurs des couches vectorielles posées par Leaflet. Les couleurs
 * OPÉRATIONNELLES (palette.js) ne changent JAMAIS avec le thème : éprouvées
 * par `check:palette`, elles se lisent de la même façon pour tous.
 */
const BASE_HABILLAGE = {
  dark: { liseré: '#050B14', liseréOpacite: 0.65, haloNumeros: '#0B1220', voileHorsTerritoire: '#05080f', frontiere: '#ffffff', rappel: '#94A3B8' },
  light: { liseré: '#334155', liseréOpacite: 0.45, haloNumeros: '#FFFFFF', voileHorsTerritoire: '#cbd5e1', frontiere: '#475569', rappel: '#64748B' },
};
const TEINTES_HABILLAGE = {
  midnight: { dark: { selection: '#F5C451', survol: 'rgba(56, 189, 248, 0.7)' }, light: { selection: '#D97706', survol: 'rgba(29, 78, 216, 0.7)' } },
  graphite: {
    dark: { selection: '#FACC15', survol: 'rgba(79, 140, 255, 0.75)', liseré: '#09090b', haloNumeros: '#111113', voileHorsTerritoire: '#08080a' },
    light: { selection: '#CA8A04', survol: 'rgba(37, 99, 235, 0.7)', liseré: '#3f3f46', frontiere: '#52525b', voileHorsTerritoire: '#d4d4d8' },
  },
  arctic: {
    dark: { selection: '#F2C14E', survol: 'rgba(103, 200, 245, 0.75)', liseré: '#06111a', haloNumeros: '#0E1A24', voileHorsTerritoire: '#071119' },
    light: { selection: '#D97706', survol: 'rgba(3, 105, 161, 0.7)', liseré: '#1e3a4f', frontiere: '#3d5a70', voileHorsTerritoire: '#d3e2ec' },
  },
  forest: {
    dark: { selection: '#F2C14E', survol: 'rgba(74, 222, 155, 0.7)', liseré: '#070d0b', haloNumeros: '#0F1714', voileHorsTerritoire: '#060b09' },
    light: { selection: '#D97706', survol: 'rgba(4, 120, 87, 0.7)', liseré: '#1f3a2e', frontiere: '#3e5a4c', voileHorsTerritoire: '#d4e0d8' },
  },
};

const fusionner = (base, teinte) => ({
  ...base,
  ...teinte,
  ...(base.landcover || teinte.landcover ? { landcover: { ...(base.landcover ?? {}), ...(teinte.landcover ?? {}) } } : {}),
});

/** Clés « palette-mode » → retouches du fond / habillage. */
export const RETOUCHES_FOND = {};
export const HABILLAGE_THEME = {};
for (const palette of PALETTES) {
  for (const mode of ['light', 'dark']) {
    RETOUCHES_FOND[`${palette}-${mode}`] = fusionner(BASE_FOND[mode], TEINTES_FOND[palette][mode]);
    HABILLAGE_THEME[`${palette}-${mode}`] = { ...BASE_HABILLAGE[mode], ...TEINTES_HABILLAGE[palette][mode] };
  }
}
