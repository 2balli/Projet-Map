/*
 * Apparence posée AVANT le premier rendu — même règle que src/theme.js :
 * dernière apparence employée sur ce poste (`gr-apparence`, ou l'ancien
 * `gr-theme`), sinon Midnight Command en suivant le mode du système. Fichier à
 * part, et non script en ligne : la politique de sécurité du serveur
 * (`script-src 'self'`, voir scripts/serve.mjs) refuse tout script en ligne.
 */
(function () {
  var PALETTES = ['midnight', 'graphite', 'arctic', 'forest'];
  var a = null;
  try {
    a = JSON.parse(localStorage.getItem('gr-apparence') || 'null');
    if (!a) {
      var ancien = localStorage.getItem('gr-theme');
      a = { dark: { palette: 'midnight', mode: 'dark' }, light: { palette: 'arctic', mode: 'light' }, slate: { palette: 'graphite', mode: 'dark' } }[ancien] || null;
    }
  } catch (e) {
    a = null;
  }
  var palette = a && PALETTES.indexOf(a.palette) > -1 ? a.palette : 'midnight';
  var mode = a && (a.mode === 'light' || a.mode === 'dark') ? a.mode : null;
  if (!mode) mode = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  var racine = document.documentElement;
  racine.setAttribute('data-palette', palette);
  racine.setAttribute('data-mode', mode);
  racine.setAttribute('data-theme', palette + '-' + mode);
  racine.style.colorScheme = mode;
  /* Animations : le choix du compte, sinon le réglage du poste (src/apparence.js). */
  var mv = a && a.mouvement;
  var reduit = mv === 'reduites' || (mv !== 'actives' && !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
  racine.setAttribute('data-mouvement', reduit ? 'reduit' : 'normal');
})();
