import { useEffect, useMemo, useState } from 'react';
import { mouvementReduit } from './apparence.js';

/**
 * TRACÉ PROGRESSIF D'UNE ROUTE — la route sélectionnée se dessine le long de
 * sa vraie géométrie, du premier poste au second, en ~450 ms.
 *
 * EXACTITUDE GÉOGRAPHIQUE : le tracé partiel est un PRÉFIXE de la polyligne
 * d'origine — ses sommets, puis un point interpolé SUR le segment en cours.
 * Rien n'est lissé, rien ne coupe un virage ; à la fin de l'animation, la
 * polyligne affichée est exactement celle reçue.
 *
 * COÛT : seul le tracé SÉLECTIONNÉ s'anime, une fois, au moment où il
 * apparaît ; jamais les repères, jamais en continu. Mouvement réduit demandé :
 * le tracé complet, immédiatement.
 */

/**
 * Un point, quelle que soit sa forme : `[lat, lng]` ou `{ lat, lng }`
 * (L.LatLng — ce que rend `map.unproject`, voir ConflitsIdentifiesLayer).
 */
const coord = (p) => (Array.isArray(p) ? p : [p?.lat, p?.lng]);
/** Un point interpolé, dans la forme de son voisin. */
const meme = (modele, lat, lng) => (Array.isArray(modele) ? [lat, lng] : { lat, lng });
const valide = (p) => {
  const [a, b] = coord(p);
  return Number.isFinite(a) && Number.isFinite(b);
};

/** Longueurs cumulées (en degrés projetés, suffisant pour une proportion). */
export function longueursCumulees(points) {
  const cumul = [0];
  for (let i = 1; i < points.length; i++) {
    const [a1, b1] = coord(points[i - 1]);
    const [a2, b2] = coord(points[i]);
    const coslat = Math.cos(((a1 + a2) / 2) * (Math.PI / 180));
    cumul.push(cumul[i - 1] + Math.hypot(a2 - a1, (b2 - b1) * coslat));
  }
  return cumul;
}

/**
 * Le préfixe de la polyligne couvrant la fraction `f` (0–1) de sa longueur.
 * @param {Array<[number, number] | {lat: number, lng: number}>} points
 */
export function prefixeTrace(points, cumul, f) {
  if (points.length < 2 || f >= 1) return points;
  const total = cumul[cumul.length - 1];
  if (!(total > 0)) return points;
  const cible = Math.max(0, f) * total;
  let i = 1;
  while (i < cumul.length && cumul[i] < cible) i++;
  if (i >= cumul.length) return points;
  const t = (cible - cumul[i - 1]) / (cumul[i] - cumul[i - 1] || 1);
  const [a1, b1] = coord(points[i - 1]);
  const [a2, b2] = coord(points[i]);
  return [...points.slice(0, i), meme(points[i], a1 + (a2 - a1) * t, b1 + (b2 - b1) * t)];
}

const adoucir = (k) => 1 - (1 - k) ** 3;

export const DUREE_TRACE = 450;

/**
 * @param {Array<[number, number]>} points  la polyligne complète (peut changer
 *   d'un rendu à l'autre : un changement de zoom la recalcule — l'animation en
 *   cours continue sur la géométrie la plus récente, sans repartir de zéro)
 * @param {string|null} declencheur  l'animation part quand cette clé devient
 *   non nulle ou change — l'identifiant du tracé quand il est sélectionné.
 *   `null` : tracé complet, sans animation.
 * @returns {Array<[number, number]>} les points à afficher maintenant
 */
export function useTraceProgressive(points, declencheur, duree = DUREE_TRACE) {
  const fraction = useFractionProgressive(declencheur, duree);
  /* Une géométrie inattendue n'est jamais fatale : tracé complet, sans animation. */
  const cumul = useMemo(
    () => (Array.isArray(points) && points.length > 1 && points.every(valide) ? longueursCumulees(points) : null),
    [points],
  );
  if (fraction == null || !cumul) return points;
  return prefixeTrace(points, cumul, fraction);
}

/**
 * La seule horloge de l'animation : une fraction 0 → 1 (adoucie), `null` hors
 * animation. Sert aussi aux tracés en plusieurs lignes, qui avancent ensemble.
 */
export function useFractionProgressive(declencheur, duree = DUREE_TRACE) {
  const [fraction, setFraction] = useState(null);
  useEffect(() => {
    if (!declencheur || mouvementReduit()) {
      setFraction(null);
      return undefined;
    }
    const debut = performance.now();
    let image = 0;
    const pas = (t) => {
      const k = Math.min(1, (t - debut) / duree);
      if (k >= 1) {
        setFraction(null);
        return;
      }
      setFraction(adoucir(k));
      image = requestAnimationFrame(pas);
    };
    setFraction(0);
    image = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(image);
  }, [declencheur, duree]);
  return fraction;
}

/** Plusieurs lignes, à la même fraction de chacune. */
export function prefixesTraces(lignes, fraction) {
  if (fraction == null) return lignes;
  return lignes.map((l) => (l.length > 1 && l.every(valide) ? prefixeTrace(l, longueursCumulees(l), fraction) : l));
}
