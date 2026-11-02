/**
 * Couches de la Gendarmerie Royale (données de `donnees/gendarmerie/`, importées
 * par `npm run gendarmerie`) : circonscriptions, chefs-lieux, infrastructures,
 * sélection d'une circonscription.
 *
 * Un seul découpage à la fois : l'échelon suit le zoom (régions, puis
 * compagnies, puis brigades), comme sur la carte tactique, ou est imposé par le
 * panneau. Fonctions pures : le style est reconstruit à chaque changement de
 * thème ou de langue (voir carte-style.js).
 */

/** Charte : bleu marine et or, avec les couleurs d'échelon de la carte tactique. */
const CHARTE = Object.freeze({ marine: '#0b2445', marine2: '#153866', or: '#c6a050', orClair: '#e3c98a', vert: '#006233', rouge: '#c1272d' });

/**
 * Couleurs d'échelon (région jaune-or, compagnie bleu, brigade vert, comme la
 * carte tactique), assombries sur fond clair pour rester lisibles.
 */
export const COULEURS_GR = Object.freeze({
  light: {
    reg: '#a87400', cie: '#1565c0', bt: '#00873f',
    excel: '#7c4d00',
    texte: '#0b2445', halo: '#ffffff', contour: '#ffffff',
    selection: CHARTE.or, voile: '#0b1220',
    infra: { peage: '#c0504a', gare: '#8d5a2b', aeroport: '#6a3fb0', port: '#0f7c9e' },
  },
  dark: {
    reg: '#ffd400', cie: '#5c9ded', bt: '#00e676',
    excel: '#ffca28',
    texte: '#f2ead6', halo: '#0b1220', contour: '#0b1220',
    selection: CHARTE.orClair, voile: '#000000',
    infra: { peage: '#ff8a80', gare: '#ddb088', aeroport: '#b39ddb', port: '#4dd0e1' },
  },
});

export const ECHELONS = Object.freeze(['auto', 'reg', 'cie', 'bt', 'aucun']);
export const NIVEAUX = Object.freeze(['reg', 'cie', 'bt']);

/** Seuils de zoom du découpage automatique (ceux de la carte tactique). */
const SEUILS = Object.freeze({ cie: 7, bt: 9 });
const ZOOM_MAX = 24;

/**
 * Plage de zoom de chaque découpage pour un échelon choisi :
 * { reg: [min, max] | null, cie: …, bt: … } — null = découpage masqué.
 */
export function plagesEchelon(echelon = 'auto') {
  switch (echelon) {
    case 'reg': return { reg: [0, ZOOM_MAX], cie: null, bt: null };
    case 'cie': return { reg: null, cie: [0, ZOOM_MAX], bt: null };
    case 'bt': return { reg: null, cie: null, bt: [0, ZOOM_MAX] };
    case 'aucun': return { reg: null, cie: null, bt: null };
    default: return { reg: [0, SEUILS.cie], cie: [SEUILS.cie, SEUILS.bt], bt: [SEUILS.bt, ZOOM_MAX] };
  }
}

/** Échelon affiché à un zoom donné (null si aucun). */
export function echelonAuZoom(echelon, zoom) {
  const plages = plagesEchelon(echelon);
  return NIVEAUX.find((n) => plages[n] && zoom >= plages[n][0] && zoom < plages[n][1]) ?? null;
}

/** Couches de découpage, par échelon : identifiants utilisés pour le zoom et les clics. */
export const couchesDecoupage = (niveau) => [`gr-${niveau}-fond`, `gr-${niveau}-trait`, `gr-${niveau}-nom`];
export const COUCHES_UNITES = Object.freeze(['gr-unite-bt', 'gr-unite-cie', 'gr-unite-reg', 'gr-unite-nom-bt', 'gr-unite-nom-cie', 'gr-unite-nom-reg', 'gr-unite-excel', 'gr-unite-excel-nom']);
export const COUCHES_INFRA = Object.freeze(['gr-infra-point', 'gr-infra-nom']);
export const COUCHES_CLIQUABLES_POINTS = Object.freeze(['gr-unite-reg', 'gr-unite-cie', 'gr-unite-bt', 'gr-unite-excel', 'gr-infra-point']);

/** Sources GeoJSON locales. La sélection démarre vide (voir gendarmerie.js). */
export function sourcesGendarmerie(origine) {
  const url = (fichier) => `${origine}/gendarmerie/${fichier}`;
  const vide = { type: 'FeatureCollection', features: [] };
  return {
    'gr-circo-reg': { type: 'geojson', data: url('circo-reg.geojson'), attribution: 'Circonscriptions : Gendarmerie Royale' },
    'gr-circo-cie': { type: 'geojson', data: url('circo-cie.geojson') },
    'gr-circo-bt': { type: 'geojson', data: url('circo-bt.geojson') },
    'gr-etiquettes': { type: 'geojson', data: url('etiquettes.geojson') },
    'gr-unites': { type: 'geojson', data: url('unites.geojson') },
    'gr-infra': { type: 'geojson', data: url('infrastructures.geojson') },
    'gr-selection': { type: 'geojson', data: vide },
  };
}

/** Monde moins les contours retenus : le voile qui isole une circonscription. */
const MONDE = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];

const aireSignee = (anneau) => anneau.reduce((s, p, i) => {
  const q = anneau[(i + 1) % anneau.length];
  return s + (q[0] - p[0]) * (q[1] + p[1]);
}, 0);

/**
 * Données de la source `gr-selection` : voile (monde troué par le contour) et
 * contour. Les trous sont orientés à l'inverse du monde : MapLibre distingue
 * trous et parties par le sens de parcours.
 */
export function entitesSelection(geometrie) {
  const parties = geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.coordinates;
  const sensMonde = Math.sign(aireSignee(MONDE));
  const trous = parties.map(([exterieur]) => (Math.sign(aireSignee(exterieur)) === sensMonde ? [...exterieur].reverse() : exterieur));
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { role: 'voile' }, geometry: { type: 'Polygon', coordinates: [MONDE, ...trous] } },
      { type: 'Feature', properties: { role: 'contour' }, geometry: geometrie },
    ],
  };
}

const plage = (couche, p) => (p ? { ...couche, minzoom: p[0], maxzoom: p[1] } : couche);
const visible = (oui) => (oui ? 'visible' : 'none');

/**
 * @param {{ theme?: 'light'|'dark', langue?: 'fr'|'ar', echelon?: string, unites?: boolean, infra?: boolean, excel?: boolean }} options
 * @returns {{ sousLibelles: object[], dessus: object[] }}
 *   `sousLibelles` : à placer sous les libellés du fond (contours, voile de sélection) ;
 *   `dessus` : au-dessus de tout (noms de circonscription, chefs-lieux, infrastructures).
 */
export function couchesGendarmerie({ theme = 'light', langue = 'fr', echelon = 'auto', unites = true, infra = false, excel = false } = {}) {
  const c = COULEURS_GR[theme] ?? COULEURS_GR.light;
  const plages = plagesEchelon(echelon);
  const ar = langue === 'ar';

  const epaisseur = { reg: [4, 1.4, 8, 2.6, 12, 3.4], cie: [5, 1, 9, 1.8, 13, 2.6], bt: [7, 0.7, 11, 1.4, 15, 2.2] };
  const fonds = NIVEAUX.map((n) => plage({
    id: `gr-${n}-fond`,
    type: 'fill',
    source: `gr-circo-${n}`,
    layout: { visibility: visible(plages[n]) },
    // Presque transparent : rend la circonscription cliquable sans masquer le fond.
    paint: { 'fill-color': c[n], 'fill-opacity': 0.05 },
  }, plages[n]));
  const traits = NIVEAUX.map((n) => plage({
    id: `gr-${n}-trait`,
    type: 'line',
    source: `gr-circo-${n}`,
    layout: { visibility: visible(plages[n]), 'line-join': 'round' },
    paint: {
      'line-color': c[n],
      'line-width': ['interpolate', ['linear'], ['zoom'], ...epaisseur[n]],
      'line-opacity': 0.9,
    },
  }, plages[n]));

  const selection = [
    {
      id: 'gr-selection-voile',
      type: 'fill',
      source: 'gr-selection',
      filter: ['==', ['get', 'role'], 'voile'],
      paint: { 'fill-color': c.voile, 'fill-opacity': theme === 'dark' ? 0.5 : 0.32 },
    },
    {
      id: 'gr-selection-trait',
      type: 'line',
      source: 'gr-selection',
      filter: ['==', ['get', 'role'], 'contour'],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': c.selection, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 12, 4] },
    },
  ];

  const tailleNom = { reg: [4, 11, 8, 15], cie: [6, 10.5, 10, 13.5], bt: [8, 10, 13, 13] };
  const noms = NIVEAUX.map((n) => plage({
    id: `gr-${n}-nom`,
    type: 'symbol',
    source: 'gr-etiquettes',
    filter: ['==', ['get', 'niveau'], n],
    layout: {
      visibility: visible(plages[n]),
      'text-field': ['get', 'nom'],
      'text-font': [n === 'bt' ? 'Noto Sans Italic' : 'Noto Sans Medium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], ...tailleNom[n]],
      'text-transform': n === 'reg' && !ar ? 'uppercase' : 'none',
      'text-letter-spacing': n === 'reg' && !ar ? 0.1 : 0,
      'text-max-width': 8,
      'text-padding': 4,
    },
    paint: { 'text-color': c[n], 'text-halo-color': c.halo, 'text-halo-width': 1.6, 'text-opacity': 0.85 },
  }, plages[n]));

  const parInfra = Object.entries(c.infra).flat();
  const infrastructures = [
    {
      id: 'gr-infra-point',
      type: 'circle',
      source: 'gr-infra',
      minzoom: 5,
      layout: { visibility: visible(infra) },
      paint: {
        'circle-color': ['match', ['get', 'type'], ...parInfra, '#888888'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 5, 14, 7],
        'circle-stroke-color': c.contour,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'gr-infra-nom',
      type: 'symbol',
      source: 'gr-infra',
      minzoom: 10,
      layout: {
        visibility: visible(infra),
        'text-field': ar ? ['coalesce', ['get', 'nomAr'], ['get', 'nom']] : ['get', 'nom'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.7],
        'text-optional': true,
        'text-max-width': 9,
      },
      paint: { 'text-color': ['match', ['get', 'type'], ...parInfra, '#888888'], 'text-halo-color': c.halo, 'text-halo-width': 1.4 },
    },
  ];

  const unitesExcel = [
    {
      id: 'gr-unite-excel',
      type: 'circle',
      source: 'gr-unites',
      minzoom: 5,
      // Les sites du classeur seulement : leurs unités co-implantées avec un chef-lieu sont dans sa fiche.
      filter: ['==', ['get', 'niveau'], 'excel'],
      layout: { visibility: visible(excel) },
      paint: {
        'circle-color': c.excel,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 5, 15, 7],
        'circle-stroke-color': c.halo,
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'gr-unite-excel-nom',
      type: 'symbol',
      source: 'gr-unites',
      minzoom: 10,
      filter: ['==', ['get', 'niveau'], 'excel'],
      layout: {
        visibility: visible(excel),
        'text-field': ['coalesce', ['get', 'etiquette'], ['get', 'nom']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-optional': true,
        'text-max-width': 12,
      },
      paint: { 'text-color': c.excel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 },
    },
  ];

  // Chefs-lieux : la taille dit l'échelon ; un liseré marine pour les commandements.
  const point = (n, minzoom, rayon, lisere, largeur) => ({
    id: `gr-unite-${n}`,
    type: 'circle',
    source: 'gr-unites',
    minzoom,
    filter: ['==', ['get', 'niveau'], n],
    layout: { visibility: visible(unites) },
    paint: {
      'circle-color': c[n],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], ...rayon],
      'circle-stroke-color': lisere,
      'circle-stroke-width': largeur,
    },
  });
  const chefsLieux = [
    point('bt', 7.5, [7.5, 2.5, 11, 4.5, 15, 6.5], c.contour, 1.2),
    point('cie', 5.5, [5.5, 3.5, 10, 6, 15, 8], c.contour, 1.8),
    point('reg', 0, [4, 4.5, 10, 8, 15, 10], CHARTE.marine, 2.5),
    // Noms : brigade dès le zoom 11, compagnie dès 8, région dès 5 (posés dans cet ordre,
    // la région en dernier pour être placée en priorité).
    ...[['bt', 11, 11, 'Noto Sans Regular'], ['cie', 8, 11.5, 'Noto Sans Medium'], ['reg', 5, 12.5, 'Noto Sans Medium']]
      .map(([n, minzoom, taille, police]) => ({
        id: `gr-unite-nom-${n}`,
        type: 'symbol',
        source: 'gr-unites',
        minzoom,
        filter: ['==', ['get', 'niveau'], n],
        layout: {
          visibility: visible(unites),
          'text-field': ['get', 'nom'],
          'text-font': [police],
          'text-size': taille,
          'text-anchor': 'left',
          'text-offset': [0.9, 0],
          'text-optional': true,
          'text-max-width': 10,
        },
        paint: { 'text-color': c.texte, 'text-halo-color': c.halo, 'text-halo-width': 1.6 },
      })),
  ];

  return { sousLibelles: [...fonds, ...traits, ...selection], dessus: [...noms, ...infrastructures, ...unitesExcel, ...chefsLieux] };
}
