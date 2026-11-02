/**
 * Impression et PDF, hors ligne : la carte est rendue à haute résolution dans
 * une carte cachée (même style, mêmes couches d'analyse et de croquis), puis
 * mise en page sur une feuille A4 ou A3 — cartouche, quadrillage Lambert ou
 * géographique, échelle, nord, légende, listes (sorties de bouclage, étapes de
 * tournée) et notes — et confiée à la boîte d'impression du navigateur
 * (« Enregistrer au format PDF »).
 */
import * as maplibregl from 'maplibre-gl';
import { enDMS } from './barre-recherche.js';
import { fournirIcone } from './croquis.js';
import { depuisLambert, formaterLambert, metres, versLambert, zoneDe, NOMS_ZONES_AR } from './lambert.js';
import { distanceMetres } from './mesure.js';
import { element } from './dom.js';

const CIRCONFERENCE = 40_075_016.686;
/** Mètres de papier par pixel CSS (96 ppp). */
const METRE_PAPIER_PAR_PX = 0.0254 / 96;
const ECHELLES = Object.freeze([5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]);
const CLE = 'maroc-carte:impression:v1';
/** Densité de l'image de carte : 2,5 pixels par pixel CSS ≈ 240 ppp. */
const DENSITE = 2.5;

const TEXTES = {
  fr: {
    titreDefaut: 'Carte opérationnelle', royaume: 'Royaume du Maroc', gr: 'Gendarmerie Royale',
    sous: 'Carte opérationnelle hors ligne', vueActuelle: 'Vue actuelle',
    preparation: 'Préparation de la feuille…', erreur: (m) => `Impression impossible : ${m}`,
    pret: 'Feuille prête : choisissez l’imprimante ou « Enregistrer au format PDF ».',
    legende: 'Légende', notes: 'Notes', echelle: 'Échelle', auCentre: 'au centre de la carte',
    centre: 'Centre', quadrillageLambert: (z) => `Quadrillage ${z}, km`, quadrillageGeo: 'Quadrillage géographique (WGS 84)',
    imprimeLe: (d) => `Imprimé le ${d}`, sources: '© contributeurs OpenStreetMap · Protomaps · circonscriptions : Gendarmerie Royale',
    nord: 'N',
  },
  ar: {
    titreDefaut: 'خريطة عملياتية', royaume: 'المملكة المغربية', gr: 'الدرك الملكي',
    sous: 'خريطة عملياتية بدون اتصال', vueActuelle: 'العرض الحالي',
    preparation: 'جارٍ إعداد الورقة…', erreur: (m) => `تعذّرت الطباعة: ${m}`,
    pret: 'الورقة جاهزة: اختر الطابعة أو « حفظ بتنسيق PDF ».',
    legende: 'مفتاح الخريطة', notes: 'ملاحظات', echelle: 'المقياس', auCentre: 'في وسط الخريطة',
    centre: 'المركز', quadrillageLambert: (z) => `شبكة ${z}، كم`, quadrillageGeo: 'شبكة جغرافية (WGS 84)',
    imprimeLe: (d) => `طُبع في ${d}`, sources: '© مساهمو OpenStreetMap · Protomaps · الدوائر: الدرك الملكي',
    nord: 'ش',
  },
};

// ── Mise en page (pur) ─────────────────────────────────────────────────────

/**
 * Dimensions (mm) de la feuille et du cadre de carte.
 * @param {'A4' | 'A3'} format
 * @param {'paysage' | 'portrait'} orientation
 */
export function dispositionPage(format = 'A4', orientation = 'paysage') {
  const [petit, grand] = format === 'A3' ? [297, 420] : [210, 297];
  const [l, h] = orientation === 'portrait' ? [petit, grand] : [grand, petit];
  const marge = 8;
  const tete = 17;
  const pied = 9;
  const ecart = 3;
  const cote = format === 'A3' ? 82 : 64;
  const utile = [l - 2 * marge, h - 2 * marge - tete - pied - 2 * ecart];
  const carte = orientation === 'portrait' ? [utile[0], utile[1] - cote - ecart] : [utile[0] - cote - ecart, utile[1]];
  return { page: [l, h], marge, tete, pied, ecart, cote: { ou: orientation === 'portrait' ? 'bas' : 'droite', taille: cote }, carte };
}

/** Mètres au sol par pixel CSS à une échelle 1:n, une fois imprimé. */
export const mppPourEchelle = (n) => n * METRE_PAPIER_PAR_PX;
/** Échelle 1:n d'une carte de `mpp` mètres par pixel CSS. */
export const echelleDe = (mpp) => mpp / METRE_PAPIER_PAR_PX;
/** Zoom MapLibre (tuiles de 512 px) donnant `mpp` mètres par pixel CSS à la latitude `lat`. */
export const zoomPourMpp = (mpp, lat) => Math.log2((CIRCONFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * mpp));
export const mppDeZoom = (zoom, lat) => (CIRCONFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

/** 48 712 → « 1:48 700 » (3 chiffres significatifs), 50 000 → « 1:50 000 ». */
export function formaterEchelle(n) {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 2);
  return `1:${metres(Math.round(n / p) * p)}`;
}

/** Plus grande longueur « ronde » (1, 2, 5 × 10ᵏ m) ne dépassant pas `max` mètres. */
export function longueurRonde(max) {
  const p = 10 ** Math.floor(Math.log10(max));
  return [5, 2, 1].map((k) => k * p).find((v) => v <= max) ?? p;
}

const PAS_METRES = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000, 100_000, 200_000];
/** Pas de quadrillage (m) donnant au plus `max` lignes sur `etendue` mètres. */
export const pasMetres = (etendue, max = 8) => PAS_METRES.find((p) => etendue / p <= max) ?? PAS_METRES.at(-1);
const PAS_DEGRES = [1 / 360, 1 / 240, 1 / 120, 1 / 60, 1 / 30, 1 / 12, 1 / 6, 0.25, 1 / 3, 0.5, 1, 2, 5];
/** Pas de quadrillage (degrés) donnant au plus `max` lignes sur `etendue` degrés. */
export const pasDegres = (etendue, max = 8) => PAS_DEGRES.find((p) => etendue / p <= max) ?? 5;

/** 33.5 → « 33°30′N » ; 33.5125 → « 33°30′45″N ». */
export function degresCourts(v, positif, negatif) {
  const a = Math.abs(v);
  let d = Math.floor(a + 1e-9);
  let m = Math.floor((a - d) * 60 + 1e-7);
  let s = Math.round((a - d - m / 60) * 3600);
  if (s === 60) { s = 0; m += 1; }
  if (m === 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, '0')}′${s ? `${String(s).padStart(2, '0')}″` : ''}${v >= 0 ? positif : negatif}`;
}

/** Point où une polyligne (pixels) croise la droite x = c (`axe` 0) ou y = c (`axe` 1). */
export function croisement(points, axe, c) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1][axe] - c;
    const b = points[i][axe] - c;
    if (a === 0) return points[i - 1];
    if (a * b < 0) {
      const t = a / (a - b);
      return [points[i - 1][0] + t * (points[i][0] - points[i - 1][0]), points[i - 1][1] + t * (points[i][1] - points[i - 1][1])];
    }
  }
  return null;
}

/**
 * Lignes de quadrillage en pixels de la carte imprimée, libellées sur le bord bas
 * (lignes nord-sud) ou gauche (lignes est-ouest).
 * @param {'lambert' | 'geo'} type
 * @param {{ projeter: (p: number[]) => number[], deprojeter: (p: number[]) => number[], largeur: number, hauteur: number }} carte
 * @returns {{ lignes: { points: number[][], libelle: string, bord: 'bas' | 'gauche' }[], zone?: object }}
 */
export function quadrillage(type, { projeter, deprojeter, largeur, hauteur }) {
  // Les lignes débordent un peu du cadre : une ligne qui finirait pile sur le bord
  // (aux arrondis près) ne serait pas vue le croiser.
  const etendre = ([a0, a1, b0, b1]) => {
    const da = (a1 - a0) * 0.1;
    const db = (b1 - b0) * 0.1;
    return [a0 - da, a1 + da, b0 - db, b1 + db];
  };
  const bords = [[0, 0], [largeur, 0], [largeur, hauteur], [0, hauteur], [largeur / 2, 0], [largeur / 2, hauteur], [0, hauteur / 2], [largeur, hauteur / 2]].map(deprojeter);
  const lignes = [];
  const garder = (points, axe, bordure, libelle, bord) => {
    if (croisement(points, axe, bordure)) lignes.push({ points, libelle, bord });
  };
  if (type === 'geo') {
    const lons = bords.map((c) => c[0]);
    const lats = bords.map((c) => c[1]);
    const [o, e, s, n] = etendre([Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]);
    const pas = pasDegres(Math.max(e - o, n - s) / 1.2);
    for (let k = Math.ceil(o / pas); k * pas <= e; k++) garder([projeter([k * pas, s]), projeter([k * pas, n])], 1, hauteur, degresCourts(k * pas, 'E', 'O'), 'bas');
    for (let k = Math.ceil(s / pas); k * pas <= n; k++) garder([projeter([o, k * pas]), projeter([e, k * pas])], 0, 0, degresCourts(k * pas, 'N', 'S'), 'gauche');
    return { lignes };
  }
  // Lambert : la zone du centre, imposée à toute la feuille pour un quadrillage continu.
  const zone = zoneDe(deprojeter([largeur / 2, hauteur / 2])[1]);
  const xy = bords.map((c) => versLambert(c, zone));
  const xs = xy.map((p) => p.x);
  const ys = xy.map((p) => p.y);
  const [x0, x1, y0, y1] = etendre([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
  const pas = pasMetres(Math.max(x1 - x0, y1 - y0) / 1.2);
  const km = (v) => (pas >= 1000 ? metres(v / 1000) : String(Math.round(v / 100) / 10).replace('.', ','));
  const etapes = 24;
  for (let k = Math.ceil(x0 / pas); k * pas <= x1; k++) {
    const x = k * pas;
    garder(Array.from({ length: etapes + 1 }, (_, i) => projeter(depuisLambert([x, y0 + ((y1 - y0) * i) / etapes], zone))), 1, hauteur, km(x), 'bas');
  }
  for (let k = Math.ceil(y0 / pas); k * pas <= y1; k++) {
    const y = k * pas;
    garder(Array.from({ length: etapes + 1 }, (_, i) => projeter(depuisLambert([x0 + ((x1 - x0) * i) / etapes, y], zone))), 0, 0, km(y), 'gauche');
  }
  return { lignes, zone };
}

/** SVG du quadrillage (coordonnées en pixels CSS de la carte imprimée). */
function svgQuadrillage({ lignes }, largeur, hauteur) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${largeur} ${hauteur}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.classList.add('f-quadrillage');
  for (const l of lignes) {
    const trait = document.createElementNS(ns, 'polyline');
    trait.setAttribute('points', l.points.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '));
    svg.append(trait);
    const ancre = l.bord === 'bas' ? croisement(l.points, 1, hauteur) : croisement(l.points, 0, 0);
    if (!ancre) continue;
    const texte = document.createElementNS(ns, 'text');
    texte.textContent = l.libelle;
    if (l.bord === 'bas') {
      texte.setAttribute('x', ancre[0].toFixed(1));
      texte.setAttribute('y', String(hauteur - 4));
      texte.setAttribute('text-anchor', 'middle');
    } else {
      texte.setAttribute('x', '4');
      texte.setAttribute('y', (ancre[1] - 3).toFixed(1));
    }
    svg.append(texte);
  }
  return svg;
}

// ── Impression ─────────────────────────────────────────────────────────────

function lireReglages() {
  try {
    const r = JSON.parse(localStorage.getItem(CLE) || '{}');
    return {
      format: r.format === 'A3' ? 'A3' : 'A4',
      orientation: r.orientation === 'portrait' ? 'portrait' : 'paysage',
      echelle: ECHELLES.includes(r.echelle) ? r.echelle : 'vue',
      quadrillage: ['lambert', 'geo', 'aucun'].includes(r.quadrillage) ? r.quadrillage : 'lambert',
      titre: typeof r.titre === 'string' ? r.titre : '',
      mention: typeof r.mention === 'string' ? r.mention : '',
    };
  } catch {
    return { format: 'A4', orientation: 'paysage', echelle: 'vue', quadrillage: 'lambert', titre: '', mention: '' };
  }
}

export class Impression {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ $: (id: string) => HTMLElement, langue?: string, logo: string, style: () => object,
   *           contenu: (zoom: number) => { legende: object[], listes: { titre: string, lignes: { num?: string, texte: string, detail?: string }[] }[] },
   *           visible: () => boolean, resoudreIcone?: (carte: maplibregl.Map, id: string) => void }} options
   *   `style` : style à imprimer (couches d'analyse et de croquis comprises) ;
   *   `contenu` : légende et listes pour le zoom imprimé ; `visible` : panneau d'impression ouvert (cadre sur la carte) ;
   *   `resoudreIcone` : fournit les icônes générées à la carte imprimée (croquis par défaut ; main.js y ajoute les barages).
   */
  constructor(carte, { $, langue = 'fr', logo, style, contenu, visible, resoudreIcone = fournirIcone }) {
    Object.assign(this, { carte, $, langue, logo, style, contenu, visible, resoudreIcone });
    this.reglages = lireReglages();
    this.enCours = false;
    this._lierPanneau();
    for (const evt of ['move', 'resize']) carte.on(evt, () => this.rendreCadre());
    window.addEventListener('afterprint', () => this._nettoyer());
    this.rendrePanneau();
  }

  get t() {
    return TEXTES[this.langue] ?? TEXTES.fr;
  }

  definirLangue(langue) {
    this.langue = langue;
    this.rendrePanneau();
  }

  _enregistrer() {
    try { localStorage.setItem(CLE, JSON.stringify(this.reglages)); } catch { /* stockage indisponible */ }
  }

  /** Carte imprimée : taille en pixels CSS, centre, zoom et mètres par pixel. */
  _cadrage() {
    const disposition = dispositionPage(this.reglages.format, this.reglages.orientation);
    const [lmm, hmm] = disposition.carte;
    const largeur = Math.round((lmm / 25.4) * 96);
    const hauteur = Math.round((hmm / 25.4) * 96);
    const centre = this.carte.getCenter();
    let mpp;
    if (this.reglages.echelle === 'vue') {
      // Toute la vue de l'écran tient dans le cadre.
      const ecran = this.carte.getContainer();
      const mppEcran = mppDeZoom(this.carte.getZoom(), centre.lat);
      mpp = Math.max((ecran.clientWidth * mppEcran) / largeur, (ecran.clientHeight * mppEcran) / hauteur);
    } else {
      mpp = mppPourEchelle(this.reglages.echelle);
    }
    return { disposition, largeur, hauteur, centre: [centre.lng, centre.lat], zoom: zoomPourMpp(mpp, centre.lat), mpp };
  }

  /** Cadre de l'emprise imprimée, au centre de la carte, quand le panneau est ouvert. */
  rendreCadre() {
    const cadre = this.$('cadre-impression');
    if (!this.visible()) {
      cadre.hidden = true;
      return;
    }
    const { largeur, hauteur, mpp, centre } = this._cadrage();
    const mppEcran = mppDeZoom(this.carte.getZoom(), centre[1]);
    cadre.hidden = false;
    cadre.style.width = `${(largeur * mpp) / mppEcran}px`;
    cadre.style.height = `${(hauteur * mpp) / mppEcran}px`;
    cadre.dataset.echelle = formaterEchelle(echelleDe(mpp));
  }

  _lierPanneau() {
    const $ = this.$;
    for (const b of document.querySelectorAll('[data-impression]')) {
      b.addEventListener('click', () => {
        const [cle, valeur] = b.dataset.impression.split(':');
        this.reglages[cle] = valeur;
        this._enregistrer();
        this.rendrePanneau();
      });
    }
    const echelle = $('imp-echelle');
    echelle.replaceChildren(new Option('', 'vue'), ...ECHELLES.map((n) => new Option(formaterEchelle(n), String(n))));
    echelle.addEventListener('change', () => {
      this.reglages.echelle = echelle.value === 'vue' ? 'vue' : Number(echelle.value);
      this._enregistrer();
      this.rendrePanneau();
    });
    for (const id of ['titre', 'mention']) {
      $(`imp-${id}`).addEventListener('input', (e) => {
        this.reglages[id] = e.target.value;
        this._enregistrer();
      });
    }
    $('imp-lancer').addEventListener('click', () => this.imprimer());
  }

  rendrePanneau() {
    const $ = this.$;
    for (const b of document.querySelectorAll('[data-impression]')) {
      const [cle, valeur] = b.dataset.impression.split(':');
      b.setAttribute('aria-pressed', String(String(this.reglages[cle]) === valeur));
    }
    const echelle = $('imp-echelle');
    echelle.options[0].textContent = this.t.vueActuelle;
    echelle.value = String(this.reglages.echelle);
    $('imp-titre').value = this.reglages.titre;
    $('imp-titre').placeholder = this.t.titreDefaut;
    $('imp-mention').value = this.reglages.mention;
    $('imp-lancer').disabled = this.enCours;
    this.rendreCadre();
  }

  /** Rend la carte cachée ; renvoie l'image, le quadrillage et la largeur au sol. */
  async _rendreCarte({ largeur, hauteur, centre, zoom }) {
    const conteneur = element('div', 'carte-impression');
    Object.assign(conteneur.style, { width: `${largeur}px`, height: `${hauteur}px` });
    document.body.append(conteneur);
    const carte = new maplibregl.Map({
      container: conteneur, style: this.style(), center: centre, zoom, bearing: 0, pitch: 0,
      interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: DENSITE,
      minZoom: 0, maxZoom: 22, canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    carte.setMissingStyleImageResolver((id) => this.resoudreIcone(carte, id));
    try {
      await new Promise((resolve, reject) => {
        const delai = setTimeout(() => reject(new Error('délai dépassé (tuiles)')), 60_000);
        carte.once('idle', () => { clearTimeout(delai); resolve(); });
      });
      const blob = await new Promise((resolve) => carte.getCanvas().toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('image de carte vide');
      const projeter = (p) => { const { x, y } = carte.project(p); return [x, y]; };
      const deprojeter = ([x, y]) => { const { lng, lat } = carte.unproject([x, y]); return [lng, lat]; };
      const grille = this.reglages.quadrillage === 'aucun' ? null
        : quadrillage(this.reglages.quadrillage, { projeter, deprojeter, largeur, hauteur });
      const largeurSol = distanceMetres(deprojeter([0, hauteur / 2]), deprojeter([largeur, hauteur / 2]));
      return { url: URL.createObjectURL(blob), grille, largeurSol, zoom: carte.getZoom() };
    } finally {
      carte.remove();
      conteneur.remove();
    }
  }

  async imprimer() {
    if (this.enCours) return;
    const statut = this.$('imp-statut');
    this.enCours = true;
    this.rendrePanneau();
    statut.textContent = this.t.preparation;
    try {
      const cadrage = this._cadrage();
      const rendu = await this._rendreCarte(cadrage);
      await this._composer(cadrage, rendu);
      statut.textContent = this.t.pret;
      window.print();
    } catch (erreur) {
      statut.textContent = this.t.erreur(erreur?.message ?? String(erreur));
      this._nettoyer();
    } finally {
      this.enCours = false;
      this.rendrePanneau();
    }
  }

  _nettoyer() {
    const feuille = this.$('impression');
    for (const img of feuille.querySelectorAll('img.f-image')) URL.revokeObjectURL(img.src);
    feuille.replaceChildren();
    feuille.hidden = true;
    document.getElementById('style-page')?.remove();
  }

  /** Feuille d'impression : cartouche, carte, côté (légende, listes, notes), pied. */
  async _composer(cadrage, rendu) {
    const t = this.t;
    const ar = this.langue === 'ar';
    const { disposition: d, largeur, hauteur, centre } = cadrage;
    const mm = (v) => `${v}mm`;

    document.getElementById('style-page')?.remove();
    const stylePage = element('style');
    stylePage.id = 'style-page';
    stylePage.textContent = `@page { size: ${d.page[0]}mm ${d.page[1]}mm; margin: 0; }`;
    document.head.append(stylePage);

    const feuille = this.$('impression');
    feuille.replaceChildren();
    const page = element('div', `f-page f-cote-${d.cote.ou}`);
    Object.assign(page.style, { width: mm(d.page[0]), height: mm(d.page[1]), padding: mm(d.marge), gap: mm(d.ecart) });

    // Cartouche
    const tete = element('header', 'f-tete');
    tete.style.height = mm(d.tete);
    const logo = element('img', 'f-logo');
    logo.src = this.logo;
    logo.alt = '';
    const marque = element('div', 'f-marque');
    marque.append(element('span', 'f-royaume', t.royaume), element('strong', null, t.gr), element('span', null, t.sous));
    const titre = element('h1', 'f-titre', this.reglages.titre.trim() || t.titreDefaut);
    const date = new Intl.DateTimeFormat(ar ? 'ar-MA' : 'fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    const droite = element('div', 'f-droite');
    if (this.reglages.mention.trim()) droite.append(element('span', 'f-mention', this.reglages.mention.trim()));
    droite.append(element('span', null, t.imprimeLe(date)));
    tete.append(logo, marque, titre, droite);

    // Carte : image, quadrillage, nord, barre d'échelle
    const corps = element('div', 'f-corps');
    corps.style.gap = mm(d.ecart);
    const cadre = element('div', 'f-carte');
    Object.assign(cadre.style, { width: mm(d.carte[0]), height: mm(d.carte[1]) });
    const image = element('img', 'f-image');
    image.alt = '';
    image.src = rendu.url;
    cadre.append(image);
    if (rendu.grille) cadre.append(svgQuadrillage(rendu.grille, largeur, hauteur));
    const nord = element('div', 'f-nord');
    nord.innerHTML = '<svg viewBox="0 0 24 34" aria-hidden="true"><path d="M12 2 20 26 12 21 4 26Z"/></svg>';
    nord.append(element('span', null, t.nord));
    const n = echelleDe(cadrage.mpp);
    const longueur = longueurRonde(rendu.largeurSol * 0.28);
    const barre = element('div', 'f-barre');
    const regle = element('div', 'f-regle');
    regle.style.width = mm((d.carte[0] * longueur) / rendu.largeurSol);
    regle.append(element('i'), element('i'), element('i'), element('i'));
    barre.append(regle, element('span', null, `${longueur >= 1000 ? `${metres(longueur / 1000)} km` : `${longueur} m`} · ${formaterEchelle(n)}`));
    cadre.append(nord, barre);

    // Côté : légende, listes, notes
    const cote = element('aside', 'f-cote');
    cote.style[d.cote.ou === 'bas' ? 'height' : 'width'] = mm(d.cote.taille);
    const { legende, listes } = this.contenu(rendu.zoom);
    if (legende.length) {
      const bloc = element('section', 'f-bloc');
      bloc.append(element('h2', null, t.legende));
      const ul = element('ul', 'f-legende');
      for (const item of legende) {
        const li = element('li', `lg-${item.type}`);
        const signe = element('i');
        signe.style.setProperty('--c', item.couleur ?? '#888888');
        if (item.image) signe.style.backgroundImage = `url(${item.image})`;
        if (item.type !== 'titre') li.append(signe);
        li.append(element('span', null, item.libelle));
        if (item.valeur) li.append(element('b', null, item.valeur));
        ul.append(li);
      }
      bloc.append(ul);
      cote.append(bloc);
    }
    for (const liste of listes) {
      const bloc = element('section', 'f-bloc');
      bloc.append(element('h2', null, liste.titre));
      const ol = element('ol', 'f-liste');
      for (const ligne of liste.lignes) {
        const li = element('li');
        if (ligne.num) li.append(element('b', null, ligne.num));
        const texte = element('span', null, ligne.texte);
        if (ligne.detail) texte.append(element('small', null, ligne.detail));
        li.append(texte);
        ol.append(li);
      }
      bloc.append(ol);
      cote.append(bloc);
    }
    const notes = this.$('imp-notes').value.trim();
    if (notes) {
      const bloc = element('section', 'f-bloc f-notes');
      bloc.append(element('h2', null, t.notes), element('p', null, notes));
      cote.append(bloc);
    }
    corps.append(cadre, cote);

    // Pied : centre, échelle, quadrillage, sources
    const pied = element('footer', 'f-pied');
    pied.style.height = mm(d.pied);
    const quad = !rendu.grille ? null : this.reglages.quadrillage === 'geo' ? t.quadrillageGeo
      : t.quadrillageLambert(ar ? NOMS_ZONES_AR[rendu.grille.zone.id] : rendu.grille.zone.nom);
    pied.append(
      element('span', null, `${t.centre} : ${enDMS(centre[1], 'N', 'S')} ${enDMS(centre[0], 'E', 'O')} · ${formaterLambert(versLambert(centre), { langue: this.langue })}`),
      element('span', null, [`${t.echelle} ${formaterEchelle(n)} (${t.auCentre})`, quad, t.sources].filter(Boolean).join(' · ')),
    );

    page.append(tete, corps, pied);
    feuille.append(page);
    feuille.hidden = false;
    await Promise.all([image.decode().catch(() => {}), logo.decode().catch(() => {})]);
  }
}
