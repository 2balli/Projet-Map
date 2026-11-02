import { useState, useEffect } from 'react';
import { IconAlert, IconClose } from '../../icons.jsx';

/**
 * Bandeau d'avertissement quand le fond de carte (archive PMTiles de
 * maroc-carte-offline, servie sous `fond-carte/`) est introuvable ou illisible.
 */
export function FondInjoignable({ url, coupe = false, onReessayer, decalageGauche = 14 }) {
  const [ferme, setFerme] = useState(false);
  const [deplie, setDeplie] = useState(false);

  useEffect(() => {
    if (coupe) setFerme(false);
  }, [coupe]);

  if (ferme) return null;

  const hote = url;

  return (
    <div
      className="pointer-events-none absolute z-[1049] transition-[left] duration-200 ease-out"
      style={{
        top: 'calc(0.75rem + var(--gr-bandeau, 0px) + 48px)',
        left: decalageGauche,
      }}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto w-[290px] rounded-xl border border-amber-500/35 bg-gr-navy/95 p-2 shadow-panel backdrop-blur-md transition-all duration-200"
      >
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-amber-500/35 bg-amber-500/15 text-amber-400">
            <IconAlert size={13} />
          </span>

          <div
            className="min-w-0 flex-1 cursor-pointer select-none"
            onClick={() => setDeplie(!deplie)}
            title="Cliquer pour afficher/masquer les détails"
          >
            <p className="truncate text-[11px] font-bold text-amber-300">
              Fond de carte injoignable
            </p>
            <p className="truncate text-[9.5px] text-text-secondary">
              Mode autonome · Repères actifs
            </p>
          </div>

          {coupe && (
            <button
              type="button"
              onClick={onReessayer}
              title={`Redemander le fond de carte (${hote})`}
              className="shrink-0 rounded-lg border border-amber-400/35 bg-amber-400/15 px-2 py-1 text-[10px] font-semibold
                text-amber-200 transition-colors duration-150 hover:bg-amber-400/25 hover:text-white
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
            >
              Réessayer
            </button>
          )}

          <button
            type="button"
            onClick={() => setFerme(true)}
            aria-label="Masquer cet avertissement"
            title="Masquer"
            className="grid size-6 shrink-0 place-items-center rounded-md text-white/40
              transition-colors duration-150 hover:bg-white/10 hover:text-white"
          >
            <IconClose size={11} />
          </button>
        </div>

        {deplie && (
          <div className="mt-2 border-t border-white/10 pt-1.5 text-[10px] leading-relaxed text-white/70 motion-safe:animate-in motion-safe:fade-in-0">
            <p>
              Archive du fond introuvable ou illisible : <span className="font-mono text-white/90">{hote}</span>.
              {coupe
                ? ' Demandes arrêtées pour protéger le poste.'
                : ''}
            </p>
            <p className="mt-0.5 text-white/50">
              Repères, contours et calculs restent entièrement opérationnels.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default FondInjoignable;
