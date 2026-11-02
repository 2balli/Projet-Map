import { useState, useEffect, useRef } from 'react';
import { IconChevron, IconClose, IconLayers } from '../../icons.jsx';

export default function MapFilters({ layers, active, onToggle, onOpenLayers }) {
  const [ouvert, setOuvert] = useState(false);
  const conteneurRef = useRef(null);
  const actifs = layers.filter((layer) => active.has(layer.key));

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) {
        setOuvert(false);
      }
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  return (
    <div ref={conteneurRef} className="pointer-events-auto relative flex max-w-[min(880px,calc(100vw-3rem))] flex-col items-center gap-1.5">
      <div className="flex max-w-full items-center gap-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden overflow-x-auto px-1 py-0.5">
        <button
          type="button"
          onClick={() => setOuvert((v) => !v)}
          aria-expanded={ouvert}
          className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border-default bg-gr-navy/95 px-3 text-[11px] font-semibold text-text-primary shadow-panel backdrop-blur-md transition-all hover:border-gr-gold/45 hover:text-gr-gold hover:bg-gr-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <IconLayers size={14} className="text-gr-gold" />
          <span>Filtres</span>
          <span className="rounded-full border border-gr-gold/45 bg-gr-gold/15 px-1.5 font-mono text-[9px] font-bold text-gr-gold">
            {actifs.length}
          </span>
          <IconChevron size={10} open={!ouvert} />
        </button>

        <div className="flex min-w-0 items-center gap-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden overflow-x-auto">
          {actifs.map((layer) => (
            <div
              key={layer.key}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border-default bg-gr-card px-2.5 text-[10px] font-medium text-text-primary shadow-panel backdrop-blur-md transition-all hover:border-border-strong hover:bg-gr-hover"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: layer.color, boxShadow: `0 0 6px ${layer.color}aa` }}
              />
              <span className="truncate max-w-[130px]">{layer.fr.replace('Barrage ', '')}</span>
              <button
                type="button"
                onClick={() => onToggle(layer.key)}
                aria-label={`Masquer ${layer.fr}`}
                title={`Masquer ${layer.fr}`}
                className="grid size-4 place-items-center rounded-md text-text-muted transition-colors hover:bg-white/10 hover:text-text-primary"
              >
                <IconClose size={10} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {ouvert && (
        <div className="absolute bottom-full mb-3 w-[280px] rounded-2xl border border-border-default bg-gr-navy/98 p-3.5 shadow-2xl backdrop-blur-xl z-[1300]">
          <div className="flex items-center justify-between pb-2 border-b border-border-default">
            <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-text-muted">Couches & Filtres</p>
            <span className="font-mono text-[9px] text-gr-gold">{actifs.length}/{layers.length} actifs</span>
          </div>
          <div className="mt-2 space-y-1">
            {layers.map((layer) => {
              const Icon = layer.icon;
              const coche = active.has(layer.key);
              return (
                <label key={layer.key} className="flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-gr-card hover:text-text-primary">
                  <input type="checkbox" checked={coche} onChange={() => onToggle(layer.key)} className="accent-gr-gold size-3.5 rounded" />
                  <Icon size={14} style={{ color: layer.color }} />
                  <span className="flex-1 truncate">{layer.fr}</span>
                </label>
              );
            })}
          </div>
          <button type="button" onClick={() => { setOuvert(false); onOpenLayers?.(); }} className="mt-2.5 w-full rounded-xl border border-border-default bg-gr-card px-2.5 py-2 text-[10px] font-semibold text-text-secondary transition-colors hover:bg-gr-hover hover:text-text-primary">
            Toutes les couches cartographiques
          </button>
        </div>
      )}
    </div>
  );
}
