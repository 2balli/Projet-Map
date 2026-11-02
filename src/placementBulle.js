/**
 * RECADRAGE D'UNE BULLE — la seule part de raisonnement du placement.
 *
 * Le reste du placement (voir `placer` dans GendarmerieMap.jsx) ne se raisonne
 * pas : on rend la bulle, on lit le rectangle qu'elle occupe, on applique un
 * décalage. Ici, en revanche, on décide — et c'est donc ici qu'une erreur est
 * possible. D'où un module à part, sans DOM ni Leaflet, que
 * `scripts/verifier-placement.mjs` éprouve sur des dizaines de milliers de
 * positions.
 *
 * Deux versions précédentes modélisaient la géométrie interne de Leaflet
 * — ancre de l'icône, décalage de la bulle, animation de zoom — et se
 * trompaient toutes les deux. Mesurer puis corriger ne demande de connaître
 * aucune de ces mécaniques.
 */

/**
 * De combien faut-il pousser un rectangle pour qu'il rentre dans un cadre ?
 *
 * Un rectangle plus grand que le cadre ne peut pas y tenir : on colle alors
 * son bord haut ou gauche. Mieux vaut voir le début d'une fiche que son
 * milieu — le titre porte le nom du poste, et c'est ce qu'on cherche.
 *
 * @param {{left:number,top:number,right:number,bottom:number}} r  rectangle mesuré
 * @param {{left:number,top:number,right:number,bottom:number}} cadre
 * @param {number} marge  distance minimale aux bords
 * @returns {{dx:number, dy:number}} décalage à appliquer, nul si rien à faire
 */
export function pousserDedans(r, cadre, marge) {
  const rentre = (debut, fin, min, max) => {
    if (fin - debut >= max - min) return min - debut;
    if (debut < min) return min - debut;
    if (fin > max) return max - fin;
    return 0;
  };

  return {
    dx: rentre(r.left, r.right, cadre.left + marge, cadre.right - marge),
    dy: rentre(r.top, r.bottom, cadre.top + marge, cadre.bottom - marge),
  };
}
