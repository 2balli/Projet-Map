/**
 * NORMALISATION DE TEXTE POUR LA RECHERCHE — une seule fois.
 *
 * La même fonction existait en TROIS copies : `UniteSelect.jsx` (exportée),
 * `AdminPanel.jsx` (privée) et `components/map/RechercheCarte.jsx` (sous le nom
 * `normaliserTexte`). Trois copies identiques au comportement près, dont deux
 * écrivaient la plage des diacritiques avec des caractères combinants
 * littéraux — invisibles dans un éditeur, et qu'un enregistrement maladroit
 * peut effacer sans que rien ne le signale.
 *
 * Une seule implémentation, avec la plage écrite en échappements explicites.
 */

/**
 * Minuscules, sans accents : « Agdez » se trouve en tapant « agdez », et
 * « Témara » en tapant « temara ».
 *
 * `NFD` sépare la lettre de son accent, la substitution retire les marques
 * diacritiques combinantes (U+0300 à U+036F), et il reste la lettre nue.
 *
 * @param {unknown} s
 * @returns {string}
 */
export const sansAccent = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
