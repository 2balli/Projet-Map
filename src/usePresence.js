import { useEffect, useState } from 'react';
import { mouvementReduit } from './apparence.js';

/**
 * PRÉSENCE D'UN PANNEAU — garder l'élément monté le temps de sa sortie.
 *
 * Les panneaux de l'application se démontaient d'un coup (`if (!open) return
 * null`) : aucune animation de sortie n'était possible. Ce crochet garde le
 * panneau monté `duree` millisecondes après la fermeture, en état `sortie`,
 * pour que la règle CSS `[data-presence='sortie']` (index.css) le fasse
 * disparaître ; puis il le démonte.
 *
 * Rien n'attend l'animation : la fermeture est déjà effective pour l'état de
 * l'application (le panneau ne capte plus le pointeur pendant sa sortie). Si
 * l'utilisateur demande moins d'animation, le démontage est immédiat.
 *
 * @param {boolean} ouvert
 * @param {number} duree  ms — celle de `--duree` (index.css)
 * @returns {{ monte: boolean, etat: 'entree' | 'sortie' }}
 */
export const DUREE_SORTIE = 200;


export function usePresence(ouvert, duree = DUREE_SORTIE) {
  const [monte, setMonte] = useState(ouvert);

  useEffect(() => {
    if (ouvert) {
      setMonte(true);
      return undefined;
    }
    if (mouvementReduit()) {
      setMonte(false);
      return undefined;
    }
    const t = setTimeout(() => setMonte(false), duree);
    return () => clearTimeout(t);
  }, [ouvert, duree]);

  return { monte: ouvert || monte, etat: ouvert ? 'entree' : 'sortie' };
}
