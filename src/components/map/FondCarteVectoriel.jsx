import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
/* Le worker de MapLibre 6 est un module à part : Vite le livre comme fichier,
   et MapLibre doit en connaître l'adresse (même réglage que maroc-carte-offline). */
import urlTravailleur from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { construireStyle } from '../../../maroc-carte-offline/src/carte-style.js';
import { CHEMIN_FOND, FOND_OPTIONS } from '../../mapConfig.js';
import { RETOUCHES_FOND, HABILLAGE_THEME, themeInitial, familleFond } from '../../theme.js';

/**
 * LE FOND DE CARTE — la carte hors ligne de `maroc-carte-offline`, seule carte
 * de l'application.
 *
 * Le style est celui de ce projet, importé tel quel (`construireStyle`) : une
 * seule définition du fond, pas une copie qui divergerait. Il est dessiné par
 * MapLibre dans le volet des tuiles de la carte Leaflet, sous toutes les
 * couches opérationnelles (limites, barrages, conflits, itinéraires), qui
 * restent celles de l'application, avec leurs interactions et leurs droits.
 *
 *   - thème : celui de l'application (clair ou sombre, voir src/theme.js),
 *     avec les retouches de `RETOUCHES_FOND` — le sombre d'origine, presque
 *     noir à l'échelle du pays, ne laissait pas voir la carte ;
 *   - libellés en français ;
 *   - les 12 régions administratives éteintes, comme par défaut dans
 *     maroc-carte-offline : les découpages affichés sont ceux de la
 *     Gendarmerie (régions, compagnies, BT), gérés par la carte elle-même.
 *
 * `onCharge` : premier rendu complet ; `onErreur` : une ressource du fond
 * (archive, police, sprite) a échoué — la carte compte ces échecs pour décider
 * que le fond est coupé, comme elle le faisait des tuiles.
 */
let protocoleInstalle = false;
function installerProtocole() {
  if (protocoleInstalle) return;
  maplibregl.setWorkerUrl(urlTravailleur);
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  protocoleInstalle = true;
}

/** Adresse absolue du fond : `pmtiles://` et les polices ne se résolvent pas en relatif. */
export const origineFond = () => new URL(CHEMIN_FOND, document.baseURI).href.replace(/\/$/, '');

export function styleFond(theme = 'light') {
  return construireStyle({
    /* Sprites et palette de base : la FAMILLE du thème (Slate Blue part du sombre). */
    origine: origineFond(), theme: familleFond(theme), langue: 'fr', regions: false, gendarmerie: null, retouches: RETOUCHES_FOND[theme],
  });
}

/**
 * LA COUCHE DES ROUTES CLASSÉES — autoroutes, nationales, régionales et
 * provinciales, avec leur numéro (A1, RN1, RR322…).
 *
 * Lue dans les MÊMES tuiles que le fond (`roads` de l'archive PMTiles, tag
 * OpenStreetMap `ref`) : aucune donnée de plus à charger, et seules les tuiles
 * de la vue sont lues — le pays entier n'est jamais en mémoire. La classe se lit
 * sur le préfixe du numéro, comme dans le graphe routier du serveur
 * (serveur/corridorRoutier.mjs) : les deux parlent des mêmes routes.
 */
export const COULEURS_ROUTES = {
  A: '#EA8600',
  RN: '#F59E0B',
  RR: '#2563EB',
  RP: '#64748B',
  casing: {
    A: '#B45309',
    RN: '#B45309',
    RR: '#1D4ED8',
    RP: '#475569',
  },
};
const REF = ['get', 'ref'];
const CLASSE = ['case', ['==', ['slice', REF, 0, 1], 'A'], 'A', ['slice', REF, 0, 2]];
const COULEUR = ['match', CLASSE, 'A', COULEURS_ROUTES.A, 'RN', COULEURS_ROUTES.RN, 'RR', COULEURS_ROUTES.RR, COULEURS_ROUTES.RP];
const COULEUR_CASING = [
  'match',
  CLASSE,
  'A',
  COULEURS_ROUTES.casing.A,
  'RN',
  COULEURS_ROUTES.casing.RN,
  'RR',
  COULEURS_ROUTES.casing.RR,
  COULEURS_ROUTES.casing.RP,
];
const estClassee = (prefixes) => ['all', ['has', 'ref'], ['match', CLASSE, prefixes, true, false]];
const COUCHES_ROUTES = [
  {
    id: 'gr-routes-secondaires-casing',
    type: 'line',
    source: 'protomaps',
    'source-layer': 'roads',
    minzoom: 7,
    filter: estClassee(['RR', 'RP']),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COULEUR_CASING,
      'line-opacity': 0.75,
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 4.2, 16, 7.5],
    },
  },
  {
    id: 'gr-routes-secondaires',
    type: 'line',
    source: 'protomaps',
    'source-layer': 'roads',
    minzoom: 7,
    filter: estClassee(['RR', 'RP']),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COULEUR,
      'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 2.6, 16, 5],
    },
  },
  {
    id: 'gr-routes-principales-casing',
    type: 'line',
    source: 'protomaps',
    'source-layer': 'roads',
    minzoom: 4,
    filter: estClassee(['A', 'RN']),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COULEUR_CASING,
      'line-opacity': 0.85,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.2, 8, 4, 12, 6.5, 16, 11],
    },
  },
  {
    id: 'gr-routes-principales',
    type: 'line',
    source: 'protomaps',
    'source-layer': 'roads',
    minzoom: 4,
    filter: estClassee(['A', 'RN']),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COULEUR,
      'line-opacity': 0.98,
      'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.3, 8, 2.6, 12, 4.4, 16, 8],
    },
  },
  {
    id: 'gr-routes-numeros',
    type: 'symbol',
    source: 'protomaps',
    'source-layer': 'roads',
    minzoom: 7,
    filter: estClassee(['A', 'RN', 'RR', 'RP']),
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['coalesce', ['get', 'shield_text'], REF],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11,
      'text-rotation-alignment': 'viewport',
    },
    paint: { 'text-color': COULEUR, 'text-halo-color': '#FFFFFF', 'text-halo-width': 2.5 },
  },
];

/** Opacité des routes du fond quand un tracé est mis en évidence. */
const OPACITE_ATTENUEE = 0.28;

export default function FondCarteVectoriel({ onCharge, onErreur, routes = false, attenuer = false, theme: themeDemande }) {
  const carte = useMap();
  const glRef = useRef(null);
  const [pret, setPret] = useState(false);
  /* Sans thème fourni (vue 3D), celui de la page au montage. */
  const theme = themeDemande ?? themeInitial();
  const themeRef = useRef(theme);
  /* Incrémentée à chaque style rechargé : les couches ajoutées à la main
     (routes classées) sont alors à reposer. */
  const [versionStyle, setVersionStyle] = useState(0);
  /* Vrai entre setStyle et la fin du chargement : le style n'existe pas encore. */
  const enRecharge = useRef(false);
  /* L'opacité d'origine de chaque couche de routes, relevée une fois. */
  const opacitesOrigine = useRef(new Map());


  /* Les routes classées : posées une fois le style chargé, puis seulement
     allumées ou éteintes — basculer ne recharge aucune tuile. */
  useEffect(() => {
    const gl = glRef.current;
    if (!pret || !gl || enRecharge.current) return;
    const premierLibelle = gl.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    for (const couche of COUCHES_ROUTES) {
      if (!gl.getLayer(couche.id)) gl.addLayer(couche, couche.type === 'line' ? premierLibelle : undefined);
      gl.setLayoutProperty(couche.id, 'visibility', routes ? 'visible' : 'none');
    }
    /* Le halo des numéros suit le fond : blanc sur clair, nuit sur sombre. */
    gl.setPaintProperty('gr-routes-numeros', 'text-halo-color', HABILLAGE_THEME[themeRef.current]?.haloNumeros ?? '#FFFFFF');
  }, [pret, routes, versionStyle]);

  /* HIÉRARCHIE VISUELLE GOOGLE MAPS DES LIBELLÉS DU FOND :
     - z5+  : Villes principales (Casablanca, Rabat, Marrakech, Fès, Tanger, Agadir…)
     - z10+ : Communes, quartiers et grands axes routiers
     - z14+ : Rues locales, avenues et détails de quartier */
  useEffect(() => {
    const gl = glRef.current;
    if (!pret || !gl || enRecharge.current) return;
    if (gl.getLayer('places_locality')) gl.setLayerZoomRange('places_locality', 5, 24);
    if (gl.getLayer('places_subplace')) gl.setLayerZoomRange('places_subplace', 10, 24);
    if (gl.getLayer('roads_labels_major')) gl.setLayerZoomRange('roads_labels_major', 10, 24);
    if (gl.getLayer('roads_labels_minor')) gl.setLayerZoomRange('roads_labels_minor', 14, 24);
    if (gl.getLayer('places_country')) gl.setLayoutProperty('places_country', 'visibility', 'none');
  }, [pret, versionStyle]);

  /* CHANGEMENT DE THÈME : le style est mis à jour EN PLACE, par différence
     (`diff: true`) — MapLibre ne change que les couleurs et le sprite, sans
     vider ses sources ni redemander les tuiles : pas d'image vide, pas
     d'éclair. La carte Leaflet, sa vue et les couches opérationnelles ne
     bougent pas ; les routes classées (ajoutées à la main, absentes du style)
     sont reposées aussitôt. */
  useEffect(() => {
    const gl = glRef.current;
    if (!pret || !gl || themeRef.current === theme) return undefined;
    themeRef.current = theme;
    opacitesOrigine.current.clear();
    const recharge = () => {
      enRecharge.current = false;
      setVersionStyle((v) => v + 1);
    };
    enRecharge.current = true;
    gl.setStyle(styleFond(theme), { diff: true });
    if (gl.isStyleLoaded()) {
      recharge();
      return undefined;
    }
    gl.once('styledata', recharge);
    return () => gl.off('styledata', recharge);
  }, [pret, theme]);

  /* UN TRACÉ MIS EN ÉVIDENCE (optimisation par route) : toutes les routes du
     fond — celles du style et les routes classées — passent au second plan,
     puis reprennent exactement leur opacité d'origine. */
  useEffect(() => {
    const gl = glRef.current;
    if (!pret || !gl || enRecharge.current) return;
    for (const couche of gl.getStyle().layers) {
      if (couche['source-layer'] !== 'roads') continue;
      const prop = couche.type === 'line' ? 'line-opacity' : couche.type === 'symbol' ? 'text-opacity' : null;
      if (!prop) continue;
      const cle = `${couche.id}|${prop}`;
      if (!opacitesOrigine.current.has(cle)) opacitesOrigine.current.set(cle, gl.getPaintProperty(couche.id, prop));
      const origine = opacitesOrigine.current.get(cle);
      gl.setPaintProperty(couche.id, prop, attenuer ? OPACITE_ATTENUEE : origine ?? 1);
    }
  }, [pret, attenuer, routes, versionStyle]);

  useEffect(() => {
    installerProtocole();
    const couche = maplibreGL({
      style: styleFond(themeRef.current),
      /* Reprise par le contrôle d'attribution de Leaflet, comme celle d'une couche de tuiles. */
      attribution: FOND_OPTIONS.attribution,
      attributionControl: false,
      interactive: false,
      maxZoom: FOND_OPTIONS.maxZoom,
    });
    couche.addTo(carte);
    const gl = couche.getMaplibreMap();
    glRef.current = gl;
    const charge = () => {
      setPret(true);
      onCharge?.();
    };
    const erreur = (e) => onErreur?.(e?.error?.message ?? 'erreur du fond de carte');
    gl.on('load', charge);
    gl.on('error', erreur);
    return () => {
      glRef.current = null;
      setPret(false);
      gl.off('load', charge);
      gl.off('error', erreur);
      carte.removeLayer(couche);
    };
    /* Monté une fois par essai : la clé du composant force un montage neuf. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carte]);

  return null;
}
