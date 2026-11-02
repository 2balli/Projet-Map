import React, { useState, useRef, useEffect } from 'react';
import { IconChevron } from '../../icons.jsx';

/**
 * Filtre avancé des barrages selon l'éclairage et l'accidentologie (avec distinction DEMO / RÉEL).
 */
export default function BarrageStatFilter({
  filtreEclairage = 'tous',
  onChangerEclairage,
  filtreAccidents = 'tous',
  onChangerAccidents,
  totalBarrages = 0,
}) {
  const [ouvert, setOuvert] = useState(false);
  const conteneurRef = useRef(null);

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

  const actif = filtreEclairage !== 'tous' || filtreAccidents !== 'tous';

  return (
    <div ref={conteneurRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        title="Filtrer les barrages par éclairage et accidentologie"
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-semibold shadow-panel backdrop-blur-md transition-all ${
          actif
            ? 'border-amber-500/50 bg-gr-hover text-amber-300 shadow-md ring-1 ring-amber-500/30'
            : 'border-border-default bg-gr-navy/95 text-text-primary hover:border-gr-gold/45 hover:text-gr-gold hover:bg-gr-hover'
        }`}
      >
        <span>💡/🚗 Filtres Barrages</span>
        {actif && (
          <span className="size-1.5 rounded-full bg-amber-400" />
        )}
        <IconChevron size={10} open={!ouvert} />
      </button>

      {ouvert && (
        <div className="absolute bottom-full mb-3 w-[290px] rounded-2xl border border-border-default bg-gr-navy/98 p-3.5 shadow-2xl backdrop-blur-xl z-[1300] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-white/10">
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">
              Filtres État & Accidents
            </span>
            {actif && (
              <button
                type="button"
                onClick={() => {
                  onChangerEclairage('tous');
                  onChangerAccidents('tous');
                }}
                className="text-[9.5px] text-amber-300 hover:text-white underline font-medium"
              >
                Réinitialiser
              </button>
            )}
          </div>

          {/* Filtre Éclairage */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-white/60 uppercase tracking-wide block">
              Éclairage du poste
            </label>
            <div className="grid grid-cols-3 gap-1">
              {[
                ['tous', 'Tous'],
                ['eclaire', '💡 Éclairés'],
                ['non_eclaire', 'Non éclairés'],
              ].map(([cle, lib]) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => onChangerEclairage(cle)}
                  className={`rounded-lg py-1 px-1.5 text-[10px] font-semibold text-center truncate transition-colors ${
                    filtreEclairage === cle
                      ? 'bg-gr-gold text-gr-navy font-bold'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {lib}
                </button>
              ))}
            </div>
          </div>

          {/* Filtre Accidentologie */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold text-white/60 uppercase tracking-wide block">
              Accidents & Sévérité
            </label>
            <div className="grid grid-cols-3 gap-1">
              {[
                ['tous', 'Tous'],
                ['avec_accidents', 'Avec données'],
                ['0', '0 accident'],
                ['1-3', '1 à 3 acc.'],
                ['4-7', '4 à 7 acc.'],
                ['8+', '8+ acc.'],
              ].map(([cle, lib]) => (
                <button
                  key={cle}
                  type="button"
                  onClick={() => onChangerAccidents(cle)}
                  className={`rounded-lg py-1 px-1.5 text-[10px] font-semibold text-center truncate transition-colors ${
                    filtreAccidents === cle
                      ? 'bg-gr-gold text-gr-navy font-bold'
                      : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {lib}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1.5 border-t border-white/10 text-[9.5px] text-white/40 flex items-center justify-between">
            <span>{totalBarrages} barrage(s) dans le périmètre</span>
            <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[8.5px] font-bold text-amber-300">
              DEMO / RÉEL
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
