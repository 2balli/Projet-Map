
/**
 * Légende de la carte de risque (heatmap).
 */
export function LegendeRisque({ onFermer }) {
  return (
    <div
      className="pointer-events-auto rounded-xl border border-gr-gold/35 bg-gr-navy/95 p-3
        shadow-panel backdrop-blur"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold leading-tight tracking-[0.04em] text-white">
            CARTE DE RISQUE
          </p>
          <p dir="rtl" className="text-[11px] leading-tight text-gr-gold/70">
            خريطة المخاطر
          </p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Masquer la carte de risque"
          title="Masquer la carte de risque"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-[15px] leading-none text-white/50
            transition-colors duration-150 hover:bg-white/10 hover:text-white
            motion-reduce:transition-none
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          ✕
        </button>
      </div>

      <div
        className="mt-2 h-2.5 rounded-full"
        style={{
          background:
            'linear-gradient(to right, rgba(46,160,67,.55), rgba(210,190,40,.8), rgba(230,130,30,.9), rgb(214,40,40))',
        }}
      />
      <div className="mt-1 flex justify-between text-[10px] text-white/45">
        <span>faible</span>
        <span>élevé</span>
      </div>

      <p className="mt-2 text-[10.5px] leading-snug text-white/50">
        Accidents constatés et densité de population. Un barrage n’ajoute du risque que s’il a
        relevé des accidents.
      </p>
    </div>
  );
}

export default LegendeRisque;
