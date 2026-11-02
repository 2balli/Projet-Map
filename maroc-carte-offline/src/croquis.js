/**
 * Croquis opérationnel : points symbolisés (barrage, incident, PC…), lignes,
 * zones et textes posés sur la carte, enregistrés dans ce navigateur et
 * échangeables en GeoJSON ou KML (Google Earth, QGIS, GPS).
 *
 * Les fonctions d'import / export sont pures ; la classe `Croquis` gère les
 * couches MapLibre, les clics et le panneau.
 */

const GENRES = Object.freeze(['point', 'ligne', 'zone', 'texte']);
const SYMBOLES = Object.freeze(['repere', 'barrage', 'incident', 'rassemblement', 'pc', 'observation']);
export const COULEURS = Object.freeze({ rouge: '#c1272d', bleu: '#1565c0', vert: '#00873f', marine: '#0b2445', or: '#b8892f' });
const CLE = 'maroc-carte:croquis:v1';
const SOURCE = 'croquis';
const SOURCE_EDITION = 'croquis-edition';

const TEXTES = {
  fr: {
    genres: { point: 'Point', ligne: 'Ligne', zone: 'Zone', texte: 'Texte' },
    symboles: { repere: 'Repère', barrage: 'Barrage', incident: 'Incident', rassemblement: 'Rassemblement', pc: 'Poste de commandement', observation: 'Observation' },
    couleurs: { rouge: 'Rouge', bleu: 'Bleu', vert: 'Vert', marine: 'Marine', or: 'Or' },
    aide: {
      point: 'Cliquez sur la carte pour poser le symbole.',
      ligne: 'Cliquez pour poser les sommets ; double-clic ou Entrée pour terminer, ⌫ pour retirer le dernier, Échap pour annuler.',
      zone: 'Cliquez pour poser les sommets (3 au moins) ; double-clic ou Entrée pour fermer la zone, Échap pour annuler.',
      texte: 'Cliquez sur la carte pour poser le texte, puis saisissez-le.',
      aucun: 'Choisissez un outil, ou cliquez sur un élément du croquis pour le modifier.',
    },
    texteDefaut: 'Texte',
    vide: 'Croquis vide.',
    effacerTout: 'Effacer tout le croquis ?',
    importe: (n) => `${n} élément${n > 1 ? 's' : ''} importé${n > 1 ? 's' : ''}.`,
    importVide: 'Aucun point, ligne ou zone dans ce fichier.',
    importErreur: 'Fichier illisible (GeoJSON ou KML attendu).',
  },
  ar: {
    genres: { point: 'نقطة', ligne: 'خط', zone: 'منطقة', texte: 'نص' },
    symboles: { repere: 'علامة', barrage: 'حاجز', incident: 'حادث', rassemblement: 'تجمع', pc: 'مركز القيادة', observation: 'مراقبة' },
    couleurs: { rouge: 'أحمر', bleu: 'أزرق', vert: 'أخضر', marine: 'كحلي', or: 'ذهبي' },
    aide: {
      point: 'انقر على الخريطة لوضع الرمز.',
      ligne: 'انقر لوضع الرؤوس؛ نقرة مزدوجة أو Enter للإنهاء، ⌫ لحذف الأخير، Esc للإلغاء.',
      zone: 'انقر لوضع الرؤوس (3 على الأقل)؛ نقرة مزدوجة أو Enter لإغلاق المنطقة، Esc للإلغاء.',
      texte: 'انقر على الخريطة لوضع النص ثم اكتبه.',
      aucun: 'اختر أداة، أو انقر على عنصر من الرسم لتعديله.',
    },
    texteDefaut: 'نص',
    vide: 'الرسم فارغ.',
    effacerTout: 'مسح كل الرسم؟',
    importe: (n) => `تم استيراد ${n} عنصر.`,
    importVide: 'لا توجد نقاط أو خطوط أو مناطق في هذا الملف.',
    importErreur: 'ملف غير مقروء (GeoJSON أو KML).',
  },
};

// ── Symboles (images générées, aucune ressource externe) ───────────────────

/** Dessine un symbole dans un contexte 2D de `taille` pixels de côté. */
function dessinerSymbole(ctx, symbole, couleur, taille) {
  const t = taille;
  const c = t / 2;
  ctx.lineWidth = t * 0.07;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = couleur;
  const lettre = (texte, echelle = 0.42) => {
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(t * echelle)}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texte, c, c + t * 0.03);
  };
  ctx.beginPath();
  switch (symbole) {
    case 'barrage':
      ctx.roundRect(t * 0.08, t * 0.27, t * 0.84, t * 0.46, t * 0.08);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(t * 0.22, t * 0.45, t * 0.56, t * 0.1);
      return;
    case 'incident':
      ctx.moveTo(c, t * 0.08); ctx.lineTo(t * 0.94, t * 0.86); ctx.lineTo(t * 0.06, t * 0.86); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(0, t * 0.1); lettre('!', 0.5); ctx.restore();
      return;
    case 'pc':
      ctx.rect(t * 0.12, t * 0.12, t * 0.76, t * 0.76);
      ctx.fill(); ctx.stroke();
      lettre('PC', 0.36);
      return;
    case 'observation':
      ctx.moveTo(c, t * 0.06); ctx.lineTo(t * 0.94, c); ctx.lineTo(c, t * 0.94); ctx.lineTo(t * 0.06, c); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.fillStyle = '#ffffff'; ctx.arc(c, c, t * 0.12, 0, 2 * Math.PI); ctx.fill();
      return;
    case 'rassemblement':
      ctx.arc(c, c, t * 0.4, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
      lettre('R');
      return;
    default: // repère
      ctx.arc(c, c, t * 0.3, 0, 2 * Math.PI);
      ctx.fill(); ctx.stroke();
  }
}

/** Toile d'un symbole (null hors navigateur). */
function toileSymbole(symbole, couleur, taille) {
  if (typeof document === 'undefined') return null;
  const toile = document.createElement('canvas');
  toile.width = taille;
  toile.height = taille;
  dessinerSymbole(toile.getContext('2d'), symbole, COULEURS[couleur] ?? COULEURS.rouge, taille);
  return toile;
}

/** Ajoute à une carte l'icône d'un symbole de croquis qui lui manque (évènement `styleimagemissing`). */
export function fournirIcone(carte, id) {
  const m = /^croquis-([a-z]+)-([a-z]+)$/.exec(id);
  if (!m || carte.hasImage(id)) return;
  const toile = toileSymbole(m[1], m[2], 48);
  if (toile) carte.addImage(id, toile.getContext('2d').getImageData(0, 0, 48, 48), { pixelRatio: 2 });
}

const apercus = new Map();
/** URL d'aperçu d'un symbole (boutons du panneau, légende de l'impression). */
function apercuSymbole(symbole, couleur, taille = 48) {
  const cle = `${symbole}|${couleur}|${taille}`;
  if (!apercus.has(cle)) apercus.set(cle, toileSymbole(symbole, couleur, taille)?.toDataURL() ?? '');
  return apercus.get(cle);
}

// ── Import / export (pur) ──────────────────────────────────────────────────

let compteur = 0;
const nouvelId = () => `c${Date.now().toString(36)}${(compteur++).toString(36)}`;

const valide = (genre, symbole, couleur) => ({
  genre: GENRES.includes(genre) ? genre : 'point',
  symbole: SYMBOLES.includes(symbole) ? symbole : 'repere',
  couleur: Object.hasOwn(COULEURS, couleur ?? '') ? couleur : 'rouge',
});

const estPosition = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1]));
const deux = (p) => [Number(p[0]), Number(p[1])];

/**
 * GeoJSON quelconque → éléments de croquis (Point, LineString, Polygon et leurs Multi*).
 * Les propriétés `genre`, `symbole`, `couleur`, `libelle` (ou `name`) sont reprises si présentes.
 * @returns {object[]} Features
 */
export function depuisGeoJson(donnees) {
  const entites = donnees?.type === 'FeatureCollection' ? donnees.features ?? []
    : donnees?.type === 'Feature' ? [donnees]
      : donnees?.type ? [{ type: 'Feature', properties: {}, geometry: donnees }] : [];
  const sortie = [];
  for (const f of entites) {
    const p = f?.properties ?? {};
    const libelle = String(p.libelle ?? p.name ?? p.nom ?? '').trim();
    const g = f?.geometry;
    if (!g) continue;
    const ajouter = (geometry, genre) => {
      sortie.push({ type: 'Feature', properties: { id: nouvelId(), ...valide(genre, p.symbole, p.couleur), libelle }, geometry });
    };
    const points = g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : [];
    for (const c of points) if (estPosition(c)) ajouter({ type: 'Point', coordinates: deux(c) }, p.genre === 'texte' ? 'texte' : 'point');
    const lignes = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const l of lignes) {
      const c = (l ?? []).filter(estPosition).map(deux);
      if (c.length >= 2) ajouter({ type: 'LineString', coordinates: c }, 'ligne');
    }
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const anneau = (poly?.[0] ?? []).filter(estPosition).map(deux);
      if (anneau.length >= 4) ajouter({ type: 'Polygon', coordinates: [anneau] }, 'zone');
    }
  }
  return sortie;
}

const echapperXml = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const desechapperXml = (s) => String(s)
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** #rrggbb → couleur KML aabbggrr. */
const couleurKml = (hex, alpha = 'ff') => `${alpha}${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
const coordsKml = (coords) => coords.map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`).join(' ');

/** Éléments de croquis → document KML (styles par couleur, attributs dans ExtendedData). */
export function versKml(entites, { nom = 'Croquis' } = {}) {
  const styles = Object.entries(COULEURS).map(([cle, hex]) => `
    <Style id="${cle}"><IconStyle><color>${couleurKml(hex)}</color></IconStyle>`
    + `<LineStyle><color>${couleurKml(hex)}</color><width>3</width></LineStyle>`
    + `<PolyStyle><color>${couleurKml(hex, '40')}</color></PolyStyle></Style>`).join('');
  const marques = entites.map((f) => {
    const p = f.properties;
    const g = f.geometry;
    const geometrie = g.type === 'Point' ? `<Point><coordinates>${coordsKml([g.coordinates])}</coordinates></Point>`
      : g.type === 'LineString' ? `<LineString><tessellate>1</tessellate><coordinates>${coordsKml(g.coordinates)}</coordinates></LineString>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsKml(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    const donnees = ['genre', 'symbole', 'couleur'].map((k) => `<Data name="${k}"><value>${echapperXml(p[k])}</value></Data>`).join('');
    return `
    <Placemark><name>${echapperXml(p.libelle)}</name><styleUrl>#${p.couleur}</styleUrl>`
      + `<ExtendedData>${donnees}</ExtendedData>${geometrie}</Placemark>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>${echapperXml(nom)}</name>${styles}${marques}
  </Document>
</kml>
`;
}

/** Document KML → éléments de croquis (Point, LineString, Polygon, y compris dans MultiGeometry). */
export function depuisKml(texte) {
  const features = [];
  const lireCoords = (bloc) => (/<coordinates>([\s\S]*?)<\/coordinates>/.exec(bloc)?.[1] ?? '')
    .trim().split(/\s+/).map((t) => t.split(',')).filter(estPosition).map(deux);
  for (const [, marque] of String(texte).matchAll(/<Placemark[\s>]([\s\S]*?)<\/Placemark>/g)) {
    const name = desechapperXml(/<name>([\s\S]*?)<\/name>/.exec(marque)?.[1] ?? '').trim();
    const donnee = (k) => desechapperXml(new RegExp(`<Data name="${k}">\\s*<value>([\\s\\S]*?)</value>`).exec(marque)?.[1] ?? '') || undefined;
    const properties = { libelle: name, genre: donnee('genre'), symbole: donnee('symbole'), couleur: donnee('couleur') };
    for (const [, bloc] of marque.matchAll(/<Point[\s>]([\s\S]*?)<\/Point>/g)) {
      const [c] = lireCoords(bloc);
      if (c) features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: c } });
    }
    for (const [, bloc] of marque.matchAll(/<LineString[\s>]([\s\S]*?)<\/LineString>/g)) {
      features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: lireCoords(bloc) } });
    }
    for (const [, bloc] of marque.matchAll(/<Polygon[\s>]([\s\S]*?)<\/Polygon>/g)) {
      const exterieur = /<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/.exec(bloc)?.[1] ?? bloc;
      features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [lireCoords(exterieur)] } });
    }
  }
  return depuisGeoJson({ type: 'FeatureCollection', features });
}

/** Contenu d'un fichier importé (GeoJSON ou KML) → éléments ; lève une erreur si illisible. */
export function lireFichier(texte) {
  const debut = String(texte).replace(/^﻿/, '').trimStart();
  if (debut.startsWith('<')) return depuisKml(debut);
  return depuisGeoJson(JSON.parse(debut));
}

// ── Outil sur la carte ─────────────────────────────────────────────────────

const couleurExpr = ['match', ['get', 'couleur'], ...Object.entries(COULEURS).flat(), COULEURS.rouge];
const COUCHES_CLIQUABLES = ['croquis-points', 'croquis-textes', 'croquis-libelles-ligne', 'croquis-libelles-zone', 'croquis-trait', 'croquis-zone-fond'];

export function telecharger(nomFichier, contenu, type) {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const horodatage = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
};

export class Croquis {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ $: (id: string) => HTMLElement, langue?: string, surOutil?: () => void, autreOutilActif?: () => boolean }} options
   *   `surOutil` : un outil du croquis prend les clics (l'appelant arrête les autres) ;
   *   `autreOutilActif` : un autre outil a les clics, la sélection d'un élément est suspendue.
   */
  constructor(carte, { $, langue = 'fr', surOutil = () => {}, autreOutilActif = () => false }) {
    Object.assign(this, { carte, $, langue, surOutil, autreOutilActif });
    this.entites = this._lire();
    this.outil = null; // genre en cours de tracé
    this.symbole = 'barrage';
    this.couleur = 'rouge';
    this.sommets = [];
    this.curseur = null;
    this.selection = null; // id
    this.message = null;

    carte.on('click', (e) => this._surClic(e));
    carte.on('dblclick', (e) => {
      if (this.outil !== 'ligne' && this.outil !== 'zone') return;
      e.preventDefault();
      this._terminer();
    });
    carte.on('mousemove', (e) => {
      if (!this.sommets.length) return;
      this.curseur = [e.lngLat.lng, e.lngLat.lat];
      this._rendreEdition();
    });
    carte.setMissingStyleImageResolver((id) => fournirIcone(carte, id));
    document.addEventListener('keydown', (e) => this._surTouche(e));
    // Un autre onglet a modifié le croquis : le reprendre, sans écraser ses changements.
    window.addEventListener('storage', (e) => {
      if (e.key !== CLE) return;
      this.entites = this._lire();
      this.selection = null;
      this._rendre();
      this.rendrePanneau();
    });
    this._lierPanneau();
    this.rendrePanneau();
  }

  get t() {
    return TEXTES[this.langue] ?? TEXTES.fr;
  }

  _lire() {
    try {
      return depuisGeoJson(JSON.parse(localStorage.getItem(CLE) || 'null'));
    } catch {
      return [];
    }
  }

  _enregistrer() {
    try {
      localStorage.setItem(CLE, JSON.stringify({ type: 'FeatureCollection', features: this.entites }));
    } catch { /* stockage indisponible ou plein */ }
  }

  // ── Couches ──────────────────────────────────────────────────────────────

  /** À chaque chargement de style : sources et couches du croquis, au-dessus du reste. */
  installer() {
    const carte = this.carte;
    const vide = { type: 'FeatureCollection', features: [] };
    if (!carte.getSource(SOURCE)) carte.addSource(SOURCE, { type: 'geojson', data: vide });
    if (!carte.getSource(SOURCE_EDITION)) carte.addSource(SOURCE_EDITION, { type: 'geojson', data: vide });
    const genre = (...g) => ['in', ['get', 'genre'], ['literal', g]];
    const role = (r) => ['==', ['get', 'role'], r];
    const halo = { 'text-halo-color': '#ffffff', 'text-halo-width': 2 };
    const couches = [
      { id: 'croquis-zone-fond', type: 'fill', source: SOURCE, filter: genre('zone'), paint: { 'fill-color': couleurExpr, 'fill-opacity': 0.18 } },
      { id: 'croquis-trait', type: 'line', source: SOURCE, filter: genre('ligne', 'zone'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': couleurExpr, 'line-width': ['match', ['get', 'genre'], 'zone', 2.5, 3.5] } },
      { id: 'croquis-selection', type: 'line', source: SOURCE_EDITION, filter: role('selection'),
        paint: { 'line-color': '#c6a050', 'line-width': 7, 'line-opacity': 0.45 } },
      { id: 'croquis-selection-point', type: 'circle', source: SOURCE_EDITION, filter: role('selection-point'),
        paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#c6a050', 'circle-stroke-width': 3 } },
      { id: 'croquis-trace', type: 'line', source: SOURCE_EDITION, filter: role('trace'),
        paint: { 'line-color': couleurExpr, 'line-width': 3, 'line-dasharray': [2, 1] } },
      { id: 'croquis-sommets', type: 'circle', source: SOURCE_EDITION, filter: role('sommet'),
        paint: { 'circle-radius': 4.5, 'circle-color': couleurExpr, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } },
      // Libellés : le long des lignes, au centre des zones (le placement n'accepte pas d'expression).
      ...['ligne', 'zone'].map((g) => ({
        id: `croquis-libelles-${g}`, type: 'symbol', source: SOURCE, filter: genre(g),
        layout: {
          'text-field': ['get', 'libelle'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-max-width': 12,
          'symbol-placement': g === 'ligne' ? 'line' : 'point',
        },
        paint: { 'text-color': couleurExpr, ...halo },
      })),
      { id: 'croquis-points', type: 'symbol', source: SOURCE, filter: genre('point'),
        layout: {
          'icon-image': ['concat', 'croquis-', ['get', 'symbole'], '-', ['get', 'couleur']],
          'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'text-field': ['get', 'libelle'], 'text-font': ['Noto Sans Medium'], 'text-size': 12,
          'text-anchor': 'top', 'text-offset': [0, 1.2], 'text-optional': true, 'text-max-width': 12,
        },
        paint: { 'text-color': couleurExpr, ...halo } },
      { id: 'croquis-textes', type: 'symbol', source: SOURCE, filter: genre('texte'),
        layout: { 'text-field': ['get', 'libelle'], 'text-font': ['Noto Sans Medium'], 'text-size': 16, 'text-allow-overlap': true, 'text-max-width': 14 },
        paint: { 'text-color': couleurExpr, 'text-halo-color': '#ffffff', 'text-halo-width': 2.2 } },
    ];
    for (const couche of couches) if (!carte.getLayer(couche.id)) carte.addLayer(couche);
    this._rendre();
  }

  _rendre() {
    this.carte.getSource(SOURCE)?.setData({ type: 'FeatureCollection', features: this.entites });
    this._rendreEdition();
  }

  _rendreEdition() {
    const f = [];
    const choisie = this._choisie();
    if (choisie) {
      const g = choisie.geometry;
      if (g.type === 'Point') f.push({ type: 'Feature', properties: { role: 'selection-point' }, geometry: g });
      else f.push({ type: 'Feature', properties: { role: 'selection' }, geometry: { type: 'LineString', coordinates: g.type === 'Polygon' ? g.coordinates[0] : g.coordinates } });
    }
    if (this.sommets.length) {
      const trace = [...this.sommets, ...(this.curseur ? [this.curseur] : [])];
      if (this.outil === 'zone' && trace.length >= 3) trace.push(trace[0]);
      if (trace.length >= 2) f.push({ type: 'Feature', properties: { role: 'trace', couleur: this.couleur }, geometry: { type: 'LineString', coordinates: trace } });
      for (const s of this.sommets) f.push({ type: 'Feature', properties: { role: 'sommet', couleur: this.couleur }, geometry: { type: 'Point', coordinates: s } });
    }
    this.carte.getSource(SOURCE_EDITION)?.setData({ type: 'FeatureCollection', features: f });
  }

  // ── Outils ───────────────────────────────────────────────────────────────

  activer(genre) {
    if (this.outil === genre) return this.arreter();
    this.surOutil();
    this._annulerTrace();
    this.outil = genre;
    this.selection = null;
    this.carte.doubleClickZoom.disable();
    this.carte.getCanvas().style.cursor = 'crosshair';
    this._rendre();
    this.rendrePanneau();
  }

  arreter() {
    if (!this.outil) return;
    this._annulerTrace();
    this.outil = null;
    this.carte.doubleClickZoom.enable();
    this.carte.getCanvas().style.cursor = '';
    this._rendreEdition();
    this.rendrePanneau();
  }

  _annulerTrace() {
    this.sommets = [];
    this.curseur = null;
  }

  /** Élément du croquis sous le clic (sélection ; la fiche d'unité ne s'ouvre pas dessous). */
  sousLeClic(e) {
    const couches = COUCHES_CLIQUABLES.filter((id) => this.carte.getLayer(id));
    if (!couches.length || !this.entites.length) return null;
    const { x, y } = e.point;
    const f = this.carte.queryRenderedFeatures([[x - 5, y - 5], [x + 5, y + 5]], { layers: couches })[0];
    return f ? this.entites.find((en) => en.properties.id === f.properties.id) ?? null : null;
  }

  _surClic(e) {
    const position = [e.lngLat.lng, e.lngLat.lat];
    if (!this.outil) {
      if (this.autreOutilActif()) return;
      const touche = this.sousLeClic(e);
      if (touche || this.selection) this.selectionner(touche?.properties.id ?? null);
      return;
    }
    if (this.outil === 'point' || this.outil === 'texte') {
      this._ajouter({
        type: 'Feature',
        properties: { id: nouvelId(), genre: this.outil, symbole: this.symbole, couleur: this.couleur, libelle: this.outil === 'texte' ? this.t.texteDefaut : '' },
        geometry: { type: 'Point', coordinates: position },
      });
      return;
    }
    // Un double-clic produit aussi deux clics : ne pas doubler le dernier sommet.
    const dernier = this.sommets.at(-1);
    if (dernier && Math.abs(dernier[0] - position[0]) < 1e-7 && Math.abs(dernier[1] - position[1]) < 1e-7) return;
    this.sommets.push(position);
    this._rendreEdition();
  }

  _terminer() {
    const s = this.sommets;
    const genre = this.outil;
    if (s.length < (genre === 'ligne' ? 2 : 3)) return;
    const geometry = genre === 'ligne' ? { type: 'LineString', coordinates: s.slice() } : { type: 'Polygon', coordinates: [[...s, s[0]]] };
    this._annulerTrace();
    this._ajouter({ type: 'Feature', properties: { id: nouvelId(), genre, symbole: this.symbole, couleur: this.couleur, libelle: '' }, geometry });
  }

  _ajouter(entite) {
    this.entites.push(entite);
    this._enregistrer();
    this.selection = entite.properties.id;
    this._rendre();
    this.rendrePanneau();
    const champ = this.$('croquis-libelle');
    champ.focus();
    champ.select();
  }

  _surTouche(e) {
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) {
      if ((e.key === 'Enter' || e.key === 'Escape') && e.target.id === 'croquis-libelle') e.target.blur();
      return;
    }
    if (!this.outil && !this.selection) return;
    if (e.key === 'Escape') {
      if (this.sommets.length) {
        this._annulerTrace();
        this._rendreEdition();
      } else if (this.outil) this.arreter();
      else this.selectionner(null);
    } else if (e.key === 'Enter' && this.sommets.length) {
      this._terminer();
    } else if (e.key === 'Backspace' && this.sommets.length) {
      e.preventDefault();
      this.sommets.pop();
      this._rendreEdition();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection && !this.outil) {
      e.preventDefault();
      this.supprimer(this.selection);
    }
  }

  // ── Édition ──────────────────────────────────────────────────────────────

  _choisie() {
    return this.entites.find((e) => e.properties.id === this.selection) ?? null;
  }

  selectionner(id) {
    this.selection = id;
    const choisie = this._choisie();
    if (choisie) {
      this.couleur = choisie.properties.couleur;
      if (choisie.properties.genre === 'point') this.symbole = choisie.properties.symbole;
    }
    this._rendreEdition();
    this.rendrePanneau();
  }

  _modifier(champs) {
    const choisie = this._choisie();
    if (!choisie) return;
    Object.assign(choisie.properties, champs);
    this._enregistrer();
    this._rendre();
    this.rendrePanneau();
  }

  supprimer(id) {
    this.entites = this.entites.filter((e) => e.properties.id !== id);
    if (this.selection === id) this.selection = null;
    this._enregistrer();
    this._rendre();
    this.rendrePanneau();
  }

  effacerTout() {
    if (!this.entites.length || !window.confirm(this.t.effacerTout)) return;
    this.entites = [];
    this.selection = null;
    this._enregistrer();
    this._rendre();
    this.rendrePanneau();
  }

  importer(texte) {
    let nouvelles;
    try {
      nouvelles = lireFichier(texte);
    } catch {
      this.message = this.t.importErreur;
      return this.rendrePanneau();
    }
    this.message = nouvelles.length ? this.t.importe(nouvelles.length) : this.t.importVide;
    if (nouvelles.length) {
      this.entites.push(...nouvelles);
      this._enregistrer();
      this._rendre();
      this.cadrer(nouvelles);
    }
    this.rendrePanneau();
  }

  /** Cadre la carte sur des éléments. */
  cadrer(entites = this.entites) {
    const coords = entites.flatMap((f) => (f.geometry.type === 'Point' ? [f.geometry.coordinates]
      : f.geometry.type === 'LineString' ? f.geometry.coordinates : f.geometry.coordinates[0]));
    if (!coords.length) return;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    this.carte.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 80, maxZoom: 15 });
  }

  definirLangue(langue) {
    this.langue = langue;
    this.rendrePanneau();
  }

  /** Symboles et genres utilisés (légende de l'impression). */
  pourImpression() {
    const vus = new Map();
    for (const { properties: p } of this.entites) {
      if (p.genre === 'texte') continue;
      const cle = p.genre === 'point' ? `${p.symbole}|${p.couleur}` : `${p.genre}|${p.couleur}`;
      if (!vus.has(cle)) {
        vus.set(cle, {
          genre: p.genre, couleur: COULEURS[p.couleur],
          image: p.genre === 'point' ? apercuSymbole(p.symbole, p.couleur) : null,
          libelle: p.genre === 'point' ? this.t.symboles[p.symbole] : this.t.genres[p.genre],
        });
      }
    }
    return [...vus.values()];
  }

  // ── Panneau ──────────────────────────────────────────────────────────────

  _lierPanneau() {
    const $ = this.$;
    for (const b of document.querySelectorAll('[data-croquis-outil]')) b.addEventListener('click', () => this.activer(b.dataset.croquisOutil));
    $('croquis-symboles').replaceChildren(...SYMBOLES.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.symbole = s;
      b.append(Object.assign(document.createElement('img'), { alt: '', width: 26, height: 26 }));
      // Outil actif : le choix vaut pour les prochains éléments ; sinon il modifie l'élément sélectionné.
      b.addEventListener('click', () => {
        this.symbole = s;
        if (!this.outil && this._choisie()?.properties.genre === 'point') this._modifier({ symbole: s });
        else if (this.outil !== 'point') this.activer('point');
        else this.rendrePanneau();
      });
      return b;
    }));
    $('croquis-couleurs').replaceChildren(...Object.entries(COULEURS).map(([cle, hex]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.couleur = cle;
      b.style.setProperty('--c', hex);
      b.addEventListener('click', () => {
        this.couleur = cle;
        if (!this.outil && this._choisie()) return this._modifier({ couleur: cle });
        this._rendreEdition();
        this.rendrePanneau();
      });
      return b;
    }));
    $('croquis-libelle').addEventListener('input', (e) => this._modifier({ libelle: e.target.value }));
    $('croquis-supprimer').addEventListener('click', () => this.selection && this.supprimer(this.selection));
    $('croquis-export-geojson').addEventListener('click', () => telecharger(`croquis-${horodatage()}.geojson`,
      JSON.stringify({ type: 'FeatureCollection', features: this.entites }, null, 1), 'application/geo+json'));
    $('croquis-export-kml').addEventListener('click', () => telecharger(`croquis-${horodatage()}.kml`,
      versKml(this.entites, { nom: `Croquis ${horodatage()}` }), 'application/vnd.google-earth.kml+xml'));
    const fichier = $('croquis-fichier');
    $('croquis-importer').addEventListener('click', () => fichier.click());
    fichier.addEventListener('change', async () => {
      const f = fichier.files?.[0];
      fichier.value = '';
      if (f) this.importer(await f.text());
    });
    $('croquis-effacer').addEventListener('click', () => this.effacerTout());
  }

  rendrePanneau() {
    const $ = this.$;
    const t = this.t;
    for (const b of document.querySelectorAll('[data-croquis-outil]')) {
      b.setAttribute('aria-pressed', String(b.dataset.croquisOutil === this.outil));
      b.textContent = t.genres[b.dataset.croquisOutil];
    }
    for (const b of $('croquis-symboles').children) {
      b.setAttribute('aria-pressed', String(b.dataset.symbole === this.symbole));
      b.title = t.symboles[b.dataset.symbole];
      b.setAttribute('aria-label', t.symboles[b.dataset.symbole]);
      b.firstChild.src = apercuSymbole(b.dataset.symbole, this.couleur);
    }
    for (const b of $('croquis-couleurs').children) {
      b.setAttribute('aria-pressed', String(b.dataset.couleur === this.couleur));
      b.title = t.couleurs[b.dataset.couleur];
      b.setAttribute('aria-label', t.couleurs[b.dataset.couleur]);
    }
    $('croquis-aide').textContent = this.message ?? t.aide[this.outil ?? 'aucun'];
    this.message = null;

    const choisie = this._choisie();
    $('croquis-selection').hidden = !choisie;
    const champ = $('croquis-libelle');
    if (choisie && document.activeElement !== champ) champ.value = choisie.properties.libelle ?? '';

    $('croquis-liste').replaceChildren(...this.entites.map((f) => {
      const p = f.properties;
      const li = document.createElement('li');
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'item-liste';
      bouton.setAttribute('aria-pressed', String(p.id === this.selection));
      const icone = document.createElement('i');
      icone.className = `pastille-croquis ${p.genre}`;
      icone.style.setProperty('--c', COULEURS[p.couleur]);
      if (p.genre === 'point') icone.style.backgroundImage = `url(${apercuSymbole(p.symbole, p.couleur, 32)})`;
      const sorte = p.genre === 'point' ? t.symboles[p.symbole] : t.genres[p.genre];
      const nom = document.createElement('span');
      nom.className = 'item-nom';
      nom.textContent = p.libelle || sorte;
      const genre = document.createElement('small');
      genre.textContent = p.libelle ? sorte : '';
      bouton.append(icone, nom, genre);
      bouton.addEventListener('click', () => {
        this.selectionner(p.id);
        this.cadrer([f]);
      });
      li.append(bouton);
      return li;
    }));
    $('croquis-vide').hidden = this.entites.length > 0;
    $('croquis-vide').textContent = t.vide;
    for (const id of ['croquis-export-geojson', 'croquis-export-kml', 'croquis-effacer']) $(id).disabled = !this.entites.length;
  }
}
