import { estIntouchable } from './marquages.js';

/** Déduplique les lignes d'affichage selon l'identité du barrage physique. */
export function uniquesParIdentifiant(items) {
  const idsVus = new Set();
  return (items ?? []).filter((m) => {
    if (m?.id == null || m.id === '') return true;
    if (idsVus.has(m.id)) return false;
    idsVus.add(m.id);
    return true;
  });
}

/**
 * L'inventaire visible dans Optimisation est distinct des postes éligibles au
 * calcul. Les BFI restent consultables même quand ils ne sont jamais candidats
 * à une action de l'optimiseur.
 */
export function barragesIntouchablesVisibles(items, niveau = 'national', unite = '') {
  const champ = { region: 'reg', compagnie: 'cie', brigade: 'bt' }[niveau];
  return uniquesParIdentifiant((items ?? []).filter(
    (m) =>
      m.type === 'barrage_fixe' &&
      estIntouchable(m) &&
      m.statutBarrage !== 'supprime' &&
      m.statutBarrage !== 'retire_optimisation' &&
      (!champ || !unite || m[champ] === unite),
  ));
}
