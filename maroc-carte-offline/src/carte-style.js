import { layers, namedFlavor } from '@protomaps/basemaps';
import { couchesGendarmerie, sourcesGendarmerie } from './gendarmerie-style.js';

import { EMPRISE_TUILES } from './emprise.js';

/** Emprise des tuiles téléchargées : voir emprise.js (module sans dépendance, partagé avec le serveur). */
export { EMPRISE_TUILES };
/** Zone de navigation autorisée : un peu plus large que les tuiles. */
export const LIMITES_NAVIGATION = [[-21.5, 18.5], [3.1, 38.2]];
export const ZOOM_MAX_TUILES = 15;

/** Wikidata de l'entité « RASD » présente dans OpenStreetMap. */
const WIKIDATA_RASD = 'Q40362';

/** Les 12 régions du Royaume (découpage de 2015), par code ISO 3166-2. */
export const REGIONS = Object.freeze({
  'MA-01': { fr: 'Tanger-Tétouan-Al Hoceïma', ar: 'طنجة تطوان الحسيمة' },
  'MA-02': { fr: "L'Oriental", ar: 'الشرق' },
  'MA-03': { fr: 'Fès-Meknès', ar: 'فاس مكناس' },
  'MA-04': { fr: 'Rabat-Salé-Kénitra', ar: 'الرباط سلا القنيطرة' },
  'MA-05': { fr: 'Béni Mellal-Khénifra', ar: 'بني ملال خنيفرة' },
  'MA-06': { fr: 'Casablanca-Settat', ar: 'الدار البيضاء سطات' },
  'MA-07': { fr: 'Marrakech-Safi', ar: 'مراكش آسفي' },
  'MA-08': { fr: 'Drâa-Tafilalet', ar: 'درعة تافيلالت' },
  'MA-09': { fr: 'Souss-Massa', ar: 'سوس ماسة' },
  'MA-10': { fr: 'Guelmim-Oued Noun', ar: 'كلميم واد نون' },
  'MA-11': { fr: 'Laâyoune-Sakia El Hamra', ar: 'العيون الساقية الحمراء' },
  'MA-12': { fr: 'Dakhla-Oued Ed-Dahab', ar: 'الداخلة وادي الذهب' },
});

const COULEURS_REGIONS = {
  light: { trait: '#9aa0a6', texte: '#3c4043', halo: '#ffffff' },
  dark: { trait: '#5f6368', texte: '#bdc1c6', halo: '#101418' },
};

/**
 * Adapte le fond OpenStreetMap à la carte du Royaume :
 * - la ligne de séparation au sud (frontière de pays marquée `disputed`) est retirée ;
 * - le libellé de pays « RASD » est retiré ;
 * - les limites régionales OSM (niveau 4) cèdent la place aux 12 régions officielles,
 *   les limites provinciales (niveaux 5–6) sont conservées.
 */
export function adapterCouchesMaroc(couches) {
  return couches.map((couche) => {
    switch (couche.id) {
      case 'boundaries_country':
        return { ...couche, filter: ['all', ['<=', ['get', 'kind_detail'], 2], ['!=', ['get', 'disputed'], true]] };
      case 'boundaries':
        return { ...couche, filter: ['>', ['get', 'kind_detail'], 4] };
      case 'places_country':
        return { ...couche, filter: ['all', ['==', ['get', 'kind'], 'country'], ['!=', ['get', 'wikidata'], WIKIDATA_RASD]] };
      default:
        return couche;
    }
  });
}

function nomRegion(langue) {
  const correspondances = Object.entries(REGIONS).flatMap(([iso, noms]) => [iso, noms[langue] ?? noms.fr]);
  return ['match', ['get', 'shapeISO'], ...correspondances, ['get', 'shapeName']];
}

function couchesRegions({ theme, langue, visible }) {
  const c = COULEURS_REGIONS[theme] ?? COULEURS_REGIONS.light;
  const visibility = visible ? 'visible' : 'none';
  return [
    {
      id: 'regions-trait',
      type: 'line',
      source: 'regions-limites',
      layout: { visibility, 'line-join': 'round' },
      paint: {
        'line-color': c.trait,
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 2, 12, 3],
        'line-opacity': 0.85,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'regions-nom',
      type: 'symbol',
      source: 'regions-etiquettes',
      maxzoom: 9,
      layout: {
        visibility,
        'text-field': nomRegion(langue),
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14],
        'text-transform': langue === 'ar' ? 'none' : 'uppercase',
        'text-letter-spacing': langue === 'ar' ? 0 : 0.08,
        'text-max-width': 8,
      },
      paint: { 'text-color': c.texte, 'text-halo-color': c.halo, 'text-halo-width': 1.5, 'text-opacity': 0.9 },
    },
  ];
}

/**
 * Style MapLibre complet, 100 % local.
 * @param {{ origine: string, theme?: 'light'|'dark', langue?: 'fr'|'ar', regions?: boolean,
 *           gendarmerie?: { echelon?: string, unites?: boolean, infra?: boolean } | null }} options
 *   `origine` : l'adresse du serveur local, ex. `http://localhost:5555`.
 *   `gendarmerie` : couches de la Gendarmerie Royale (omis si les données ne sont pas importées).
 */
export function construireStyle({ origine, theme = 'light', langue = 'fr', regions = true, gendarmerie = null, retouches = null }) {
  /* `retouches` (facultatif) : couleurs Protomaps remplacées dans la palette du
     thème, ex. `{ earth: '#1b2434' }`. Sans lui, la palette d'origine. */
  const palette = { ...namedFlavor(theme), ...(retouches ?? {}) };
  const fond = adapterCouchesMaroc(layers('protomaps', palette, { lang: langue }))
    // Hors de la zone téléchargée, le fond prend la couleur des terres plutôt qu'un gris vide.
    .map((couche) => (couche.id === 'background'
      ? { ...couche, paint: { ...couche.paint, 'background-color': palette.earth } }
      : couche));
  const avantLibelles = fond.findIndex((couche) => couche.type === 'symbol');
  const couches = [...fond];
  const [trait, nom] = couchesRegions({ theme, langue, visible: regions });
  const gr = gendarmerie ? couchesGendarmerie({ theme, langue, ...gendarmerie }) : { sousLibelles: [], dessus: [] };
  couches.splice(avantLibelles < 0 ? couches.length : avantLibelles, 0, trait, ...gr.sousLibelles);
  couches.push(nom, ...gr.dessus);

  return {
    version: 8,
    glyphs: `${origine}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origine}/sprites/v4/${theme}`,
    sources: {
      ...(gendarmerie ? sourcesGendarmerie(origine) : {}),
      protomaps: {
        type: 'vector',
        url: `pmtiles://${origine}/tiles/maroc.pmtiles`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a> · Protomaps',
      },
      'regions-limites': {
        type: 'geojson',
        data: `${origine}/data/regions-limites.geojson`,
        attribution: 'Régions : geoBoundaries (ODbL)',
      },
      'regions-etiquettes': { type: 'geojson', data: `${origine}/data/regions-etiquettes.geojson` },
    },
    layers: couches,
  };
}
