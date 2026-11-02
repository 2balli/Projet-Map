/**
 * LE RADAR DES CALCULS — un seul radar pour tous les calculs réels.
 *
 *   const r = await avecRadar('Filtration par distance · 20 km', () => generer(...));
 *
 * Annonce le début et la fin du calcul (`gr-radar-calcul`) ; la carte
 * (GendarmerieMap → RadarAnalyse) affiche le radar exactement pendant ce
 * temps, et les fenêtres de parcours (Parcours.jsx), qui masquent la carte,
 * en montrent la version compacte (`useRadarCalcul`). Le radar représente le
 * calcul : il ne simule rien, il ne crée aucun résultat. Ce que le calcul
 * rend s'affiche comme avant, là où il s'affichait.
 *
 * Calculs branchés : filtration par distance, filtration automatique,
 * filtrations des onglets (OptimisationPanel), filtration et conflits d'une
 * route, itinéraire, mesure des écarts (OptimisationRoutePanel). L'analyse
 * des conflits d'un axe (Filtrer par route) a son propre cycle, plus riche
 * (progression, routes dessinées) : voir lancerAnalyseRoute.
 */
import { useSyncExternalStore } from 'react';

let suivant = 0;
/** Calculs en cours : id → libellé. */
const enCours = new Map();
const abonnes = new Set();
const notifier = () => {
  for (const f of abonnes) f();
};

const annoncer = (detail) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('gr-radar-calcul', { detail }));
};

/**
 * @template T
 * @param {string} libelle  ce qui est calculé (affiché sous « Analyse en cours… »)
 * @param {() => Promise<T>} calcul
 * @returns {Promise<T>}
 */
export async function avecRadar(libelle, calcul) {
  const id = ++suivant;
  const debut = Date.now();
  enCours.set(id, libelle);
  notifier();
  annoncer({ phase: 'debut', id, libelle });
  try {
    return await calcul();
  } finally {
    /* Le résultat est rendu AUSSITÔT ; seul le radar reste au moins
       DUREE_MIN_RADAR (un calcul de 20 ms ne doit pas le faire clignoter). */
    const finir = () => {
      enCours.delete(id);
      notifier();
      annoncer({ phase: 'fin', id });
    };
    const reste = DUREE_MIN_RADAR - (Date.now() - debut);
    if (reste > 0) setTimeout(finir, reste);
    else finir();
  }
}

/** Durée minimale d'affichage du radar (ms). */
export const DUREE_MIN_RADAR = 600;

const abonner = (f) => {
  abonnes.add(f);
  return () => abonnes.delete(f);
};
const libelleCourant = () => (enCours.size ? [...enCours.values()].at(-1) : null);

/** Le libellé du calcul en cours (le plus récent), ou null. */
export function useRadarCalcul() {
  return useSyncExternalStore(abonner, libelleCourant, () => null);
}
