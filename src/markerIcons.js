/**
 * Marqueurs GPS (pins) pour la carte.
 *
 * Chaque pin est une image SVG en data-URI passée à `L.icon`, et NON un
 * `L.divIcon` : Leaflet produit alors un seul <img> par marqueur au lieu d'un
 * arbre SVG complet. Avec ~1000 marqueurs simultanés c'est la différence entre
 * ~1000 et ~6000 nœuds DOM. L'URI étant identique pour tous les marqueurs
 * d'une même couche, le navigateur ne décode l'image qu'une fois.
 *
 * Les glyphes viennent de `glyphs.js` — mêmes tracés que la légende.
 */
import L from 'leaflet';
import { GLYPHS } from './glyphs.js';

const INK_DARK = '#0b1220';
const INK_LIGHT = '#ffffff';

/** Luminance relative WCAG d'une couleur hexadécimale. */
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Encre de glyphe lisible sur le fond du pin.
 *
 * On compare les DEUX encres et on garde la plus contrastée, au lieu de
 * trancher sur un seuil de luminance : un bleu moyen comme #4aa8e8 tombe à
 * 2,61:1 avec du blanc (sous le minimum de 3:1 pour un élément non textuel)
 * alors qu'il atteint 7:1 avec l'encre sombre.
 */
function readableOn(background) {
  return contrast(INK_LIGHT, background) >= contrast(INK_DARK, background)
    ? INK_LIGHT
    : INK_DARK;
}

/** Silhouette de la goutte, pointe en bas au centre (30 x 38). */
const PIN_PATH =
  'M15 1.6c-7.1 0-12.9 5.7-12.9 12.8 0 4.3 2.6 9 5.6 12.9a63 63 0 0 0 7.3 8.1 63 63 0 0 0 7.3-8.1c3-3.9 5.6-8.6 5.6-12.9C27.9 7.3 22.1 1.6 15 1.6Z';

/** Silhouette BFI : tête circulaire et pointe de repère compacte (30 x 38). */
const BFI_PIN_PATH =
  'M15 2.5a10.5 10.5 0 0 0-10.5 10.5c0 7.2 10.5 23 10.5 23s10.5-15.8 10.5-23A10.5 10.5 0 0 0 15 2.5Z';

const cache = new Map();

/*
 * L'ÉCHELLE DES PINS SELON LE ZOOM A DÉMÉNAGÉ.
 *
 * `PALIERS_ZOOM` et `echelleZoom` vivent désormais dans `carteLisibilite.js`,
 * avec les autres règles qui décident de ce que la carte montre. Raison : ce
 * fichier-ci importe Leaflet, donc il ne s'exécute pas hors d'un navigateur —
 * et une règle qu'aucun script ne peut charger est une règle qu'on ne peut pas
 * éprouver. Elle l'est maintenant (voir scripts/verifier-placement.mjs).
 *
 * Le ré-export garde les appelants inchangés : `pinIcon` et `echelleZoom` se
 * demandent toujours au même endroit.
 */
export { echelleZoom } from './carteLisibilite.js';


/**
 * Icône de pin pour une couche.
 * @param {string} glyph  clé dans GLYPHS
 * @param {string} color  couleur de remplissage du pin
 * @param {number} scale  1 = 30x38 px
 * @param {boolean} intouchable true pour le marqueur BFI dédié
 */
export function pinIcon({ glyph, color, scale = 1, intouchable = false, attenue = false, misEnEvidence = false, direction = null }) {
  const isBFI = intouchable === true || glyph === 'barrage_intouchable';
  const cacheKey = `${glyph}|${color}|${scale}|${isBFI}|${attenue}|${misEnEvidence}|${direction}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const w = Math.round(30 * scale);
  const h = Math.round(38 * scale);
  const ink = readableOn(color);

  // Le glyphe (boîte 24) est réduit et recentré dans la tête du pin.
  const gScale = isBFI ? 0.68 : 0.72;
  const gx = 15 - 12 * gScale;
  const gy = (isBFI ? 15.2 : 14.4) - 12 * gScale;

  /**
   * SOUS 18 px DE LARGE, LE GLYPHE EST RETIRÉ.
   *
   * Un pictogramme de brigade ou de barrière dans une tête de pin de dix pixels
   * ne se lit pas : il ne reste qu'un gribouillis sombre qui salit la couleur, et
   * c'est la couleur seule qui porte l'information à cette distance. Le pin garde
   * sa silhouette et son contour blanc, donc sa lisibilité sur fond sombre.
   */
  const avecGlyphe = w >= 18;

  const paths = avecGlyphe ? (GLYPHS[glyph] ?? []).map((d) => `<path d="${d}"/>`).join('') : '';
  const pinPath = isBFI ? BFI_PIN_PATH : PIN_PATH;
  const strokeColor = isBFI ? '#f59e0b' : '#ffffff';
  const strokeWidth = isBFI ? '2.6' : '2.2';

  const badgeSens = (direction === 'ALLER' || direction === 'RETOUR') && avecGlyphe
    ? `<circle cx="23.5" cy="6.5" r="5" fill="${direction === 'ALLER' ? '#0284c7' : '#d97706'}" stroke="#ffffff" stroke-width="1.2"/>` +
      `<text x="23.5" y="9" font-size="6.5" font-weight="900" font-family="system-ui, sans-serif" text-anchor="middle" fill="#ffffff">${direction === 'ALLER' ? 'A' : 'R'}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 30 38">` +
    // Ombre portée au sol : ancre le pin sur la carte
    `<ellipse cx="15" cy="36" rx="${isBFI ? '5.2' : '4.2'}" ry="1.5" fill="rgba(0,0,0,.42)"/>` +
    (isBFI
      ? `<path d="${pinPath}" fill="none" stroke="#ffffff" stroke-width="4.2" opacity="0.9"/>` +
        `<path d="${pinPath}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`
      : `<path d="${pinPath}" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>`) +
    // Glyphe
    (avecGlyphe
      ? `<g transform="translate(${gx} ${gy}) scale(${gScale})" fill="none" stroke="${ink}" ` +
        `stroke-width="${(1.75 / gScale).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">` +
        paths +
        `</g>`
      : '') +
    badgeSens +
    `</svg>`;

  let className = isBFI ? 'gr-pin gr-pin-bfi' : 'gr-pin';
  if (attenue) className += ' gr-pin-attenue';
  if (misEnEvidence) className += ' gr-pin-mis-en-evidence';

  const icon = L.icon({
    iconUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h], // la pointe touche la coordonnée exacte
    popupAnchor: [0, -h + 2],
    tooltipAnchor: [0, -h + 8],
    className,
  });

  cache.set(cacheKey, icon);
  return icon;
}
