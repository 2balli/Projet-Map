/**
 * Boutons d'agrandissement et de réduction du zoom de la carte — Style Google Maps.
 *
 * `echelon` — le découpage que ce zoom fait apparaître (RÉG, CIE, BT ; voir
 * limitesTerritoriales.js).
 */
export function CommandesZoom({ carte, zoom, min, max, integrees = false, echelon = null }) {
  /* Zoom fractionnaire (molette) : une décimale au plus. */
  const affiche = Number.isInteger(zoom) ? zoom : Math.round(zoom * 10) / 10;
  const bouger = (delta) => {
    const m = carte.current;
    if (!m) return;
    delta > 0 ? m.zoomIn(1) : m.zoomOut(1);
  };

  return (
    <div
      className={`${
        integrees ? 'relative' : 'pointer-events-auto absolute bottom-16 right-3 z-[1050]'
      } flex flex-col items-center overflow-hidden rounded-xl border border-black/10 bg-white/95 text-gray-700 shadow-md backdrop-blur-md transition-colors dark:border-white/10 dark:bg-[#202124]/95 dark:text-gray-200`}
    >
      <button
        type="button"
        onClick={() => bouger(1)}
        disabled={zoom >= max}
        aria-label="Agrandir la carte"
        title="Agrandir (zoom avant)"
        className="grid size-10 place-items-center text-[20px] font-normal leading-none transition-colors hover:bg-gray-100 hover:text-black active:bg-gray-200 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white dark:active:bg-white/20"
      >
        +
      </button>

      <div className="w-6 border-t border-gray-200 dark:border-white/10" />

      {echelon && (
        <span
          title={`Zoom ${affiche} — limites affichées : ${echelon.long}`}
          className="select-none px-1 py-0.5 text-center font-mono text-[9px] font-bold tracking-tight text-amber-600 dark:text-amber-400"
        >
          {echelon.court}
        </span>
      )}

      <button
        type="button"
        onClick={() => bouger(-1)}
        disabled={zoom <= min}
        aria-label="Réduire la carte"
        title="Réduire (zoom arrière)"
        className="grid size-10 place-items-center text-[20px] font-normal leading-none transition-colors hover:bg-gray-100 hover:text-black active:bg-gray-200 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white dark:active:bg-white/20"
      >
        −
      </button>
    </div>
  );
}

export default CommandesZoom;
