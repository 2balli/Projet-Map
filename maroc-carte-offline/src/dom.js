/** Crée un élément HTML avec, au besoin, une classe et un texte. */
export function element(balise, classe, texte) {
  const el = document.createElement(balise);
  if (classe) el.className = classe;
  if (texte != null) el.textContent = texte;
  return el;
}
