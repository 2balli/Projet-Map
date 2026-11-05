import { forwardRef, useEffect, useRef, useState } from 'react';
import { IconAlert, IconBarrageFixe, IconFiltre } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * LES OUTILS DE LA CARTE — UN SEUL BOUTON, UN MENU DÉROULANT.
 *
 * Remplace les trois pastilles qui se suivaient en haut à gauche (Filtres,
 * Optimisation, Conflits). Chaque outil garde son panneau, son état et son
 * fonctionnement : ce menu ne fait que l'ouvrir. Le panneau choisi s'ouvre
 * sous le bouton, à la même place qu'avant, sans rien déplacer sur la carte.
 *
 *   — l'outil ouvert est nommé sur le bouton et coché dans le menu ;
 *   — chaque ligne porte son compteur (filtres actifs, calculs actifs,
 *     conflits à traiter) ;
 *   — le menu se referme au choix, à Échap ou au clic à l'extérieur.
 *
 * `outils` : [{ cle, libelle, icone, compteur, actif, onChoisir }] — seuls
 * ceux que le rôle a le droit d'utiliser (la carte décide, comme avant).
 * La référence (`ref`) est le bouton : le menu des conflits se pose dessous.
 */
const ICONES = { filtres: IconFiltre, optimisation: IconBarrageFixe, conflits: IconAlert };

const MenuOutilsCarte = forwardRef(function MenuOutilsCarte({ outils = [], decalageGauche = 12, enLigne = false }, boutonRef) {
  const [ouvert, setOuvert] = useState(false);
  const presence = usePresence(ouvert);
  const racineRef = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => {
      if (!racineRef.current?.contains(e.target)) setOuvert(false);
    };
    const clavier = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOuvert(false);
        boutonRef?.current?.focus?.();
      }
    };
    document.addEventListener('pointerdown', dehors, true);
    window.addEventListener('keydown', clavier, true);
    return () => {
      document.removeEventListener('pointerdown', dehors, true);
      window.removeEventListener('keydown', clavier, true);
    };
  }, [ouvert, boutonRef]);

  const actif = outils.find((o) => o.actif) ?? null;
  const total = outils.reduce((n, o) => n + (o.compteurBouton ?? 0), 0);

  return (
    <div
      ref={racineRef}
      data-gr-chrome
      data-gr-masque-selection
      /* Au-dessus des panneaux qu'il ouvre (filtres, optimisation, conflits) :
         on change d'outil sans refermer le panneau courant. */
      className={enLigne ? 'pointer-events-none relative shrink-0' : 'pointer-events-none absolute top-[calc(4.25rem+var(--gr-bandeau,0px))] z-[2100] transition-[left] duration-200'}
      style={enLigne ? undefined : { left: decalageGauche }}
    >
      <button
        ref={boutonRef}
        type="button"
        data-gr-bouton-outils
        aria-haspopup="menu"
        aria-expanded={ouvert}
        onClick={() => setOuvert((v) => !v)}
        className={`pointer-events-auto flex ${enLigne ? 'h-8 px-3' : 'h-10 px-3.5'} items-center gap-2 rounded-full border text-[13px] font-semibold shadow-panel backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
          ouvert || actif ? 'border-gr-primary/50 bg-gr-surface/95 text-gr-primary' : 'border-border-default bg-gr-surface/95 text-text-primary hover:bg-gr-hover'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
        <span>Outils</span>
        {actif && <span className="max-w-[9rem] truncate font-medium text-text-secondary">· {actif.libelleCourt ?? actif.libelle}</span>}
        {total > 0 && (
          <span className="rounded-full bg-gr-primary px-1.5 font-mono text-[11px] font-bold text-gr-primary-contrast">{total}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={`transition-transform ${ouvert ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {presence.monte && (
        <div
          role="menu"
          aria-label="Outils de la carte"
          data-presence={presence.etat}
          data-depuis="haut"
          className="pointer-events-auto absolute left-0 top-full mt-2 w-[min(17rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 p-1.5 text-white shadow-panel backdrop-blur-xl"
        >
          {outils.map((o) => {
            const Icone = ICONES[o.cle] ?? IconFiltre;
            return (
              <button
                key={o.cle}
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(o.actif)}
                onClick={() => {
                  setOuvert(false);
                  o.onChoisir?.();
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gr-primary ${
                  o.actif ? 'bg-gr-primary/12 text-gr-primary' : 'text-white/85 hover:bg-white/8 hover:text-white'
                }`}
              >
                <Icone size={16} className="shrink-0 opacity-85" />
                <span className="min-w-0 flex-1 truncate">{o.libelle}</span>
                {o.compteur > 0 && (
                  <span className="rounded-full bg-white/12 px-1.5 font-mono text-[10.5px] font-bold text-white/85">{o.compteur}</span>
                )}
                {o.actif && <span aria-hidden="true" className="text-[12px]">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default MenuOutilsCarte;
