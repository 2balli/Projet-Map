/**
 * Rendu de la carte sans carte graphique : quand l'accélération matérielle du navigateur
 * est désactivée (ou la carte graphique refusée), WebGL est émulé par le processeur
 * (SwiftShader, llvmpipe, « Microsoft Basic Render Driver »…). Mesuré sur ce projet :
 * 13 à 16 ms par image et des blocages jusqu'à 1,4 s en déplaçant la carte, contre 1 à 2 ms
 * et aucun blocage avec la carte graphique. La carte le signale, rien de plus.
 */

const LOGICIELS = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i;

/**
 * @param {string} rendu  WebGL UNMASKED_RENDERER (ou RENDERER à défaut)
 * @param {boolean} avertissementPerformance  le contexte n'existe qu'en ignorant `failIfMajorPerformanceCaveat`
 */
export const estRenduLogiciel = (rendu, avertissementPerformance) => avertissementPerformance || LOGICIELS.test(String(rendu ?? ''));

/** Examine le WebGL de ce navigateur (≈ 1 ms, un petit canevas jetable). */
export function diagnostiquerRendu(doc = document) {
  try {
    const toile = doc.createElement('canvas');
    const gl = toile.getContext('webgl2') ?? toile.getContext('webgl');
    if (!gl) return { webgl: false, logiciel: true, rendu: null };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const rendu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    // Le navigateur refuse ce contexte s'il ne peut le donner qu'en mode lent (rendu logiciel).
    const rapide = doc.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      ?? doc.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true });
    rapide?.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl: true, logiciel: estRenduLogiciel(rendu, !rapide), rendu };
  } catch {
    return { webgl: false, logiciel: false, rendu: null };
  }
}
