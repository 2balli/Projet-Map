import { useEffect, useRef, useState } from 'react';
import { IconPlus, IconTerritoire, IconClose, IconMenu } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * VOLET DE NAVIGATION — à la manière de Google Maps.
 *
 * Masqué par défaut : seul un petit bouton « Menu » reste sur la carte. Un
 * clic ouvre le volet (libellés en clair, aucune icône à deviner) ; « Masquer »,
 * Échap ou un clic sur la carte le referme entièrement. Choisir une entrée
 * ouvre l'outil ET referme le volet : un seul panneau à la fois, la carte
 * garde toute sa place. Il ne s'ouvre jamais tout seul.
 *
 * Les props sont celles de l'ancien rail : `sections` (outils principaux),
 * `outilsSecondaires`, `canCreate`/`onCreate` (poser un barrage),
 * `onBrandClick` (recentrer la carte). `decalageGauche` : où poser le bouton
 * (à droite d'un panneau d'outil ouvert, pour qu'il reste atteignable).
 */
export default function NavigationRail({
  sections = [],
  canCreate = false,
  onCreate,
  onBrandClick,
  outilsSecondaires = [],
  decalageGauche = 12,
  /* Piloté de l'extérieur (le ☰ de la barre de recherche) : son propre bouton est masqué. */
  ouvert: ouvertExterne = null,
  onOuvertChange = null,
  masquerBouton = false,
}) {
  const [ouvertLocal, setOuvertLocal] = useState(false);
  const ouvert = ouvertExterne ?? ouvertLocal;
  const setOuvert = (v) => (onOuvertChange ? onOuvertChange(v) : setOuvertLocal(v));
  const presence = usePresence(ouvert);
  const boutonRef = useRef(null);
  const voletRef = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const auClavier = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOuvert(false);
        boutonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', auClavier, true);
    voletRef.current?.querySelector('button')?.focus();
    return () => window.removeEventListener('keydown', auClavier, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert]);

  const tousItems = sections.flatMap((s) => s.items || []);
  const principaux = tousItems.filter((i) => !i.secondaire);
  const secondaires = outilsSecondaires.length > 0 ? outilsSecondaires : tousItems.filter((i) => i.secondaire);
  const actif = tousItems.some((i) => i.active) || secondaires.some((i) => i.active);

  const choisir = (fn) => (e) => {
    setOuvert(false);
    fn?.(e);
  };

  const ligne = (item) => {
    const Icon = item.icon;
    return (
      <button
        key={item.id}
        type="button"
        onClick={choisir(item.onClick)}
        aria-pressed={item.active || undefined}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gr-primary ${
          item.active ? 'bg-gr-primary/12 text-gr-primary' : 'text-white/85 hover:bg-white/8 hover:text-white'
        }`}
      >
        {Icon && <Icon size={18} className="shrink-0 opacity-80" />}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {Boolean(item.badge) && (
          <span className="rounded-full bg-gr-primary px-1.5 py-0.5 font-mono text-[10px] font-bold text-gr-primary-contrast">{item.badge}</span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Le seul élément permanent : un petit bouton discret (sauf s'il est intégré ailleurs). */}
      {!masquerBouton && (
      <button
        ref={boutonRef}
        type="button"
        data-gr-chrome
        onClick={() => setOuvert(true)}
        aria-label="Ouvrir le menu"
        aria-expanded={ouvert}
        title="Menu"
        className="pointer-events-auto absolute top-[calc(0.625rem+var(--gr-bandeau,0px))] z-[1150] grid size-11 place-items-center rounded-2xl border border-border-default bg-gr-surface/95 text-text-primary shadow-panel backdrop-blur-md transition-[left,background-color] duration-200 hover:bg-gr-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        style={{ left: decalageGauche }}
      >
        <IconMenu size={20} />
        {actif && <span aria-hidden="true" className="absolute right-2 top-2 size-2 rounded-full bg-gr-primary" />}
      </button>
      )}

      {presence.monte && (
        <div className="pointer-events-auto fixed inset-0 z-[2200]" data-gr-chrome>
          {/* Un clic sur la carte referme le volet. */}
          <div
            aria-hidden="true"
            data-presence={presence.etat}
            data-depuis="centre"
            onClick={() => setOuvert(false)}
            className="absolute inset-0 bg-black/15"
          />
          <nav
            ref={voletRef}
            aria-label="Menu principal"
            data-presence={presence.etat}
            data-depuis="gauche"
            className="absolute bottom-3 left-3 top-3 flex w-[min(300px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-surface/97 shadow-panel backdrop-blur-xl"
          >
            <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-gr-gold/40 text-gr-gold">
                  <IconTerritoire size={14} />
                </span>
                <span className="truncate text-[13px] font-bold uppercase tracking-[0.06em] text-white">Carte tactique</span>
              </span>
              <button
                type="button"
                onClick={() => setOuvert(false)}
                aria-label="Masquer le menu"
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
              >
                <IconClose size={13} />
                Masquer
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3">
              {canCreate && (
                <button
                  type="button"
                  onClick={choisir(onCreate)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gr-primary py-2.5 text-[13px] font-bold text-gr-primary-contrast shadow-sm transition-colors hover:bg-gr-primary-hover"
                >
                  <IconPlus size={16} />
                  Poser un barrage
                </button>
              )}

              <div className="space-y-0.5">
                {principaux.map(ligne)}
                {onBrandClick && ligne({ id: 'recentrer', label: 'Recentrer la carte', icon: IconTerritoire, onClick: onBrandClick })}
              </div>

              {secondaires.length > 0 && (
                <div className="space-y-0.5 border-t border-white/10 pt-3">
                  <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/45">Autres outils</p>
                  {secondaires.map(ligne)}
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
