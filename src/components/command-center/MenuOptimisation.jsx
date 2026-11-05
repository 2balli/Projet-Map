import { useEffect, useRef } from 'react';
import { IconBarrageFixe, IconClose, IconSpinner } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * OPTIMISATION DES BARRAGES — un module à part, distinct des filtres.
 *
 * Les filtres choisissent CE QUE LA CARTE MONTRE (natures, faction, couches).
 * L'optimisation CALCULE : elle mesure les distances entre barrages, propose
 * d'en réduire le nombre et détecte les conflits. Les deux ont donc chacun leur
 * bouton, leur panneau et leur état : réinitialiser les filtres ne touche pas à
 * l'optimisation, et désactiver l'optimisation ne touche pas aux filtres.
 *
 * Ce module ne fait que donner accès aux calculs existants, inchangés :
 *   Distance, Accidents, VIP, Éclairage   boîtes de réglage d'OptimisationPanel ;
 *   Par routes                            ModalFiltrerParRoute ;
 *   « Panneau complet »                   OptimisationPanel (barrages retirés,
 *                                         restauration, historique, journal).
 *
 * `onglets` : `[{ cle, libelle, statut, erreur, verrouille }]`, tels que
 * GendarmerieMap les assemble (`ongletsOptimisationComplets`).
 */
const STATUTS = {
  active: { texte: 'Actif', classe: 'text-emerald-300' },
  optimizing: { texte: 'Calcul…', classe: 'text-gr-gold' },
  error: { texte: 'Erreur', classe: 'text-red-300' },
};

export const nombreOptimisationsActives = (onglets = []) => onglets.filter((o) => o.statut === 'active').length;

/** Le bouton, posé dans la rangée des raccourcis de la carte (à côté de « Filtres »). */
export function BoutonOptimisation({ ouvert, onOuvrir, onFermer, onglets = [] }) {
  const actifs = nombreOptimisationsActives(onglets);
  const calcul = onglets.some((o) => o.statut === 'optimizing');
  return (
    <button
      type="button"
      data-gr-bouton-optimisation
      onClick={() => (ouvert ? onFermer?.() : onOuvrir?.())}
      aria-expanded={ouvert}
      aria-label={actifs > 0 ? `Optimisation des barrages (${actifs} active${actifs > 1 ? 's' : ''})` : 'Optimisation des barrages'}
      className={`pointer-events-auto flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold shadow-panel backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
        ouvert || actifs > 0 ? 'border-gr-gold/60 bg-gr-surface/95 text-gr-gold' : 'border-border-default bg-gr-surface/95 text-text-primary hover:bg-gr-hover'
      }`}
    >
      {calcul ? <IconSpinner size={15} /> : <IconBarrageFixe size={15} />}
      Optimisation
      {actifs > 0 && (
        <span className="rounded-full bg-gr-gold px-1.5 font-mono text-[11px] font-bold text-gr-deep">{actifs}</span>
      )}
    </button>
  );
}

/** Le panneau, non modal : la carte reste visible et réagit aux calculs. */
export default function MenuOptimisation({
  ouvert,
  onFermer,
  onglets = [],
  onOuvrirOnglet,
  onDesactiverOnglet,
  onOuvrirPanneauComplet = null,
  decalageGauche = 12,
  /** Haut du panneau (px) : sous le bouton qui l'ouvre ; null = position d'origine. */
  haut = null,
}) {
  const presence = usePresence(ouvert);
  const panneauRef = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const auClavier = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFermer?.();
        document.querySelector('[data-gr-bouton-optimisation]')?.focus();
      }
    };
    window.addEventListener('keydown', auClavier, true);
    return () => window.removeEventListener('keydown', auClavier, true);
  }, [ouvert, onFermer]);

  if (!presence.monte) return null;
  const actifs = nombreOptimisationsActives(onglets);

  return (
    <div
      ref={panneauRef}
      role="dialog"
      aria-label="Optimisation des barrages"
      data-gr-chrome
      data-presence={presence.etat}
      data-depuis="gauche"
      className="pointer-events-auto absolute bottom-3 z-[1160] flex w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-surface/97 text-white shadow-panel backdrop-blur-xl transition-[left] duration-200 md:bottom-auto "
      style={{
        left: decalageGauche,
        top: haut ?? 'calc(7.25rem + var(--gr-bandeau, 0px))',
        maxHeight: `calc(100% - ${haut != null ? `${haut + 12}px` : '8.5rem'})`,
      }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold text-white">Optimisation des barrages</h2>
          <p className="text-[11.5px] text-white/55">
            {actifs > 0 ? `${actifs} calcul${actifs > 1 ? 's' : ''} actif${actifs > 1 ? 's' : ''} sur la carte` : 'Aucun calcul actif'}
          </p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Masquer l'optimisation"
          className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
        >
          <IconClose size={13} />
          Masquer
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="text-[11.5px] leading-relaxed text-white/60">
          Distances entre barrages, réduction des barrages affichés et conflits. Indépendant des filtres de la carte.
        </p>
        <ul className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10">
          {onglets.map((o) => {
            const s = STATUTS[o.statut];
            return (
              <li key={o.cle} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-white">{o.libelle}</p>
                  {s && (
                    <p className={`flex items-center gap-1 text-[11px] font-medium ${s.classe}`}>
                      {o.statut === 'optimizing' && <IconSpinner size={10} />}
                      {s.texte}
                      {o.statut === 'error' && o.erreur ? ` — ${o.erreur}` : ''}
                    </p>
                  )}
                </div>
                {o.statut === 'active' && (
                  <button
                    type="button"
                    disabled={o.verrouille}
                    onClick={() => onDesactiverOnglet?.(o.cle)}
                    className="text-[11.5px] font-semibold text-red-300 hover:underline disabled:opacity-40"
                  >
                    Désactiver
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOuvrirOnglet?.(o.cle)}
                  className="rounded-lg border border-white/15 px-2 py-1 text-[11.5px] font-semibold text-white/85 hover:bg-white/10"
                >
                  Régler
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {onOuvrirPanneauComplet && (
        <footer className="border-t border-white/10 px-4 py-2.5">
          <button
            type="button"
            onClick={onOuvrirPanneauComplet}
            className="w-full rounded-lg border border-white/15 py-2 text-[12px] font-semibold text-white/85 transition-colors hover:bg-white/10"
          >
            Panneau complet — barrages retirés, historique
          </button>
        </footer>
      )}
    </div>
  );
}
