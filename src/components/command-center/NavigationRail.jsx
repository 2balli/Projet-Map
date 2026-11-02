import { useState, useCallback, useLayoutEffect, useRef, useEffect } from 'react';
import { IconPlus, IconTerritoire, IconChevron, IconClose } from '../../icons.jsx';

/**
 * Bouton d'outil individuel dans le rail tactique avec libellé français visible.
 * Conçu pour les utilisateurs débutants : fonction évidente au premier coup d'œil.
 */
function RailItem({ item, onHover, onLeave, onPointerDown }) {
  const Icon = item.icon;
  const isDeconnexion = item.id === 'deconnexion';

  return (
    <button
      type="button"
      onClick={(e) => {
        onLeave?.();
        item.onClick?.(e);
      }}
      onMouseEnter={(e) => onHover?.(e, item.label, item.id)}
      onMouseLeave={onLeave}
      onFocus={(e) => onHover?.(e, item.label, item.id)}
      onBlur={onLeave}
      onPointerDown={onPointerDown}
      aria-label={item.label}
      aria-pressed={item.active || undefined}
      data-rail-actif={item.active || undefined}
      className={`group relative flex flex-col w-full items-center justify-center py-2 px-1 rounded-xl border transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
        item.active
          ? 'border-gr-gold/60 bg-gr-gold/15 text-gr-gold shadow-md'
          : isDeconnexion
          ? 'border-transparent text-white/50 hover:border-gr-red/35 hover:bg-gr-red/15 hover:text-gr-red'
          : 'border-transparent text-white/70 hover:border-white/10 hover:bg-white/10 hover:text-white'
      }`}
    >
      {/* Icône */}
      {Icon && <Icon size={20} className="shrink-0 transition-transform duration-150 group-active:scale-90" />}

      {/* Libellé visible sous l'icône */}
      <span className="mt-1 text-[9.5px] font-bold tracking-tight leading-none text-center truncate max-w-full">
        {item.court || item.label}
      </span>
    </button>
  );
}

/**
 * Rail de navigation tactique épuré — Map-First Experience
 * Largeur optimisée (72px) avec icônes + libellés clairs.
 * Regroupe les outils secondaires dans un menu « Outils » pour dégager 100% de la carte.
 */
export default function NavigationRail({
  sections = [],
  canCreate = false,
  onCreate,
  onBrandClick,
  outilsSecondaires = [],
}) {
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [menuOutilsOuvert, setMenuOutilsOuvert] = useState(false);
  const menuOutilsRef = useRef(null);

  // Fermer le menu outils au clic extérieur
  useEffect(() => {
    if (!menuOutilsOuvert) return undefined;
    const gererClicDehors = (e) => {
      if (menuOutilsRef.current && !menuOutilsRef.current.contains(e.target)) {
        setMenuOutilsOuvert(false);
      }
    };
    document.addEventListener('mousedown', gererClicDehors);
    return () => document.removeEventListener('mousedown', gererClicDehors);
  }, [menuOutilsOuvert]);

  const railRef = useRef(null);
  const [indicateur, setIndicateur] = useState(null);

  const placerIndicateur = useCallback(() => {
    const rail = railRef.current;
    const actif = rail?.querySelector('[data-rail-actif]');
    if (!rail || !actif) {
      setIndicateur((v) => (v ? { ...v, visible: false } : v));
      return;
    }
    const r = rail.getBoundingClientRect();
    const a = actif.getBoundingClientRect();
    const visible = a.bottom > r.top + 4 && a.top < r.bottom - 4;
    setIndicateur({ y: Math.round(a.top - r.top + (a.height - 20) / 2), visible });
  }, []);

  const clesActives = sections.flatMap((s) => s.items?.filter((i) => i.active).map((i) => i.id) || []).join('|');
  useLayoutEffect(() => {
    placerIndicateur();
    window.addEventListener('resize', placerIndicateur);
    return () => window.removeEventListener('resize', placerIndicateur);
  }, [placerIndicateur, clesActives]);

  const showTooltip = useCallback((e, label, id) => {
    if (e.type === 'focus' || (window.matchMedia?.('(hover: hover)')?.matches ?? true)) {
      const rect = e.currentTarget.getBoundingClientRect();
      setActiveTooltip({
        id,
        label,
        top: Math.round(rect.top + rect.height / 2),
        left: Math.round(rect.right + 10),
      });
    }
  }, []);

  const hideTooltip = useCallback(() => {
    setActiveTooltip(null);
  }, []);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType === 'touch') {
      setActiveTooltip(null);
    }
  }, []);

  // Déterminer les éléments principaux et les éléments secondaires
  const tousItems = sections.flatMap((s) => s.items || []);
  const itemsPrincipaux = tousItems.filter((i) => !i.secondaire);
  const itemsSecondaires = outilsSecondaires.length > 0 ? outilsSecondaires : tousItems.filter((i) => i.secondaire);

  return (
    <nav
      ref={railRef}
      aria-label="Barre d'outils tactiques"
      data-gr-chrome
      className="pointer-events-auto absolute left-3 top-2.5 bottom-3 z-[1150] flex w-[72px] flex-col rounded-2xl border border-white/10 bg-gr-surface/95 shadow-panel backdrop-blur-md select-none transition-all duration-200"
    >
      {/* Indicateur d'élément actif */}
      {indicateur && (
        <span
          aria-hidden="true"
          className="gr-rail-indicateur pointer-events-none absolute left-0 top-0 z-20 h-6 w-1 rounded-r bg-gr-gold"
          style={{ transform: `translateY(${indicateur.y}px)`, opacity: indicateur.visible ? 1 : 0 }}
        />
      )}

      {/* 1. Écusson & Recentrage carte */}
      <div className="flex flex-col items-center pt-2.5 pb-2">
        <button
          type="button"
          onClick={onBrandClick}
          onMouseEnter={(e) => showTooltip(e, 'Recentrer la carte', 'brand')}
          onMouseLeave={hideTooltip}
          onFocus={(e) => showTooltip(e, 'Recentrer la carte', 'brand')}
          onBlur={hideTooltip}
          onPointerDown={handlePointerDown}
          aria-label="Recentrer la carte"
          title="Recentrer la carte"
          className="group flex flex-col items-center justify-center size-12 rounded-xl border border-gr-gold/30 bg-gr-card/80 text-gr-gold shadow-sm transition-all duration-150 hover:border-gr-gold/60 hover:bg-gr-hover hover:shadow-[0_0_12px_rgba(214,169,40,0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <IconTerritoire size={18} className="transition-transform duration-200 group-hover:scale-105" />
          <span className="text-[9px] font-bold text-white/60 mt-0.5">Carte</span>
        </button>
      </div>

      {/* 2. Bouton d'action rapide : Nouveau barrage */}
      {canCreate && (
        <div className="flex flex-col items-center px-2 pb-2">
          <button
            type="button"
            onClick={(e) => {
              hideTooltip();
              onCreate?.(e);
            }}
            onMouseEnter={(e) => showTooltip(e, 'Poser un nouveau barrage', 'nouveau-barrage')}
            onMouseLeave={hideTooltip}
            onFocus={(e) => showTooltip(e, 'Poser un nouveau barrage', 'nouveau-barrage')}
            onBlur={hideTooltip}
            onPointerDown={handlePointerDown}
            aria-label="Poser un nouveau barrage"
            className="group flex flex-col items-center justify-center size-12 rounded-xl bg-gr-gold text-gr-deep shadow-[0_4px_12px_rgba(214,169,40,0.25)] transition-all duration-150 hover:bg-gr-gold-hover hover:shadow-[0_6px_16px_rgba(214,169,40,0.35)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <IconPlus size={18} className="transition-transform duration-150 group-hover:scale-110" />
            <span className="text-[9px] font-extrabold text-gr-navy leading-none mt-0.5">Poser</span>
          </button>
        </div>
      )}

      {/* Séparateur */}
      <div className="mx-2 border-t border-white/10 my-1" />

      {/* 3. Outils opérationnels principaux */}
      <div
        onScroll={() => {
          hideTooltip();
          placerIndicateur();
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-1.5 py-1.5 overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {itemsPrincipaux.map((item) => (
          <RailItem
            key={item.id}
            item={item}
            onHover={showTooltip}
            onLeave={hideTooltip}
            onPointerDown={handlePointerDown}
          />
        ))}

        {/* Bouton "Plus d'outils" */}
        {itemsSecondaires.length > 0 && (
          <div className="relative pt-1 border-t border-white/10" ref={menuOutilsRef}>
            <button
              type="button"
              onClick={() => setMenuOutilsOuvert((v) => !v)}
              aria-expanded={menuOutilsOuvert}
              aria-label="Plus d'outils"
              title="Fonctionnalités complémentaires"
              className={`group flex flex-col w-full items-center justify-center py-2 px-1 rounded-xl border transition-all ${
                menuOutilsOuvert
                  ? 'border-gr-gold/50 bg-gr-gold/15 text-gr-gold'
                  : 'border-transparent text-white/70 hover:border-white/10 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span className="text-[18px] leading-none mb-0.5">⋯</span>
              <span className="text-[9.5px] font-bold tracking-tight leading-none text-center">Outils</span>
            </button>

            {/* Menu Popover "Plus d'outils" */}
            {menuOutilsOuvert && (
              <div className="absolute left-full top-0 ml-3 w-[220px] rounded-2xl border border-border-default bg-gr-navy/98 p-2.5 shadow-2xl backdrop-blur-xl z-[1500] space-y-1 animate-in fade-in-0 zoom-in-95 duration-100">
                <div className="px-2 py-1 border-b border-white/10 mb-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                    Outils complémentaires
                  </p>
                </div>
                {itemsSecondaires.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(e) => {
                        setMenuOutilsOuvert(false);
                        item.onClick?.(e);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[11.5px] font-semibold text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      {Icon && <Icon size={15} className="text-gr-gold shrink-0" />}
                      <span className="truncate flex-1">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Infobulle flottante */}
      {activeTooltip && (
        <div
          role="tooltip"
          id="sidebar-tooltip"
          style={{
            position: 'fixed',
            top: `${activeTooltip.top}px`,
            left: `${activeTooltip.left}px`,
            transform: 'translateY(-50%)',
          }}
          className="pointer-events-none z-[1300] flex items-center whitespace-nowrap rounded-lg border border-border-default bg-gr-navy px-2.5 py-1 text-[11px] font-semibold text-text-primary shadow-xl backdrop-blur-md transition-opacity duration-150"
        >
          <span
            aria-hidden="true"
            className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rotate-45 border-b border-l border-border-default bg-gr-navy"
          />
          <span className="relative z-10 select-none">{activeTooltip.label}</span>
        </div>
      )}
    </nav>
  );
}
