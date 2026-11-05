import { useEffect, useRef } from 'react';
import { IconClose, IconFiltre, IconRestaurer } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * FILTRES — UN SEUL BOUTON, SUR LE CÔTÉ DE LA CARTE.
 *
 * Il remplace l'ancien bouton « Filtres » de la barre et la fenêtre plein
 * écran qui voilait la carte. Le panneau s'ouvre à côté du bouton, sans
 * voile : la carte reste visible et réagit à chaque choix.
 *
 * Il regroupe, sans en changer le fonctionnement :
 *   Barrages        natures affichées (fixe, mobile, point noir…) ;
 *   Faction         le tour de service affiché ;
 *   Vigilance       éclairage nocturne, points noirs ;
 *   Couches         circonscriptions, implantations, numéros de routes.
 *
 * L'OPTIMISATION DES BARRAGES (Distance, Accidents, VIP, Éclairage, Par
 * routes) n'en fait PAS partie : c'est un calcul, pas un filtre d'affichage.
 * Elle a son propre bouton et son propre état — voir MenuOptimisation.jsx.
 * Ni le compteur ni « Réinitialiser » ne la touchent.
 *
 * Le bouton porte le nombre de filtres actifs ; « Réinitialiser » ramène
 * l'affichage initial.
 */
function Puce({ actif, onClick, couleur = null, children }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        actif ? 'border-gr-primary/60 bg-gr-primary/12 text-gr-primary' : 'border-white/12 text-white/70 hover:border-white/25 hover:text-white'
      }`}
    >
      {couleur && <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: couleur }} />}
      {children}
    </button>
  );
}

function Section({ titre, modifie = false, children }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
        {titre}
        {modifie && <span aria-label="modifié" className="size-1.5 rounded-full bg-gr-primary" />}
      </h3>
      {children}
    </section>
  );
}

export default function MenuFiltresUnifie({
  ouvert,
  onOuvrir,
  onFermer,
  // Natures de barrages
  layers = [],
  activeLayers = new Set(),
  onToggleLayer,
  // Factions
  factions = [],
  factionChoisie = 'toutes',
  onChangerFaction,
  factionActuelle = null,
  compteursFactions = {},
  // Éclairage & accidents
  filtreEclairage = 'tous',
  onChangerEclairage,
  filtreAccidents = 'tous',
  onChangerAccidents,
  // Couches de la carte
  couches = [],
  routesVisibles = true,
  onToggleRoutes = null,
  // Totaux & réinitialisation
  filtresModifies = 0,
  onReinitialiser,
  decalageGauche = 12,
  /** Haut du panneau (px) : sous le bouton qui l'ouvre ; null = position d'origine. */
  haut = null,
  /** Raccourcis posés à côté du bouton (ex. « Conflits »). */
  aCote = null,
  /** false : pas de bouton propre — le panneau est ouvert par le menu « Outils ». */
  afficherBouton = true,
}) {
  const presence = usePresence(ouvert);
  const boutonRef = useRef(null);
  const panneauRef = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const auClavier = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onFermer?.();
        boutonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', auClavier, true);
    return () => window.removeEventListener('keydown', auClavier, true);
  }, [ouvert, onFermer]);

  const couchesModifiees = couches.filter((c) => activeLayers.has(c.key) !== Boolean(c.defaultOn)).length + (routesVisibles ? 0 : 1);
  const total = filtresModifies + couchesModifiees;
  const naturesModifiees = layers.some((l) => activeLayers.has(l.key) !== Boolean(l.defaultOn));

  return (
    <>
      {afficherBouton && (
      <div
        data-gr-chrome
        className="pointer-events-none absolute top-[calc(4.25rem+var(--gr-bandeau,0px))] z-[1150] flex items-center gap-2 transition-[left] duration-200"
        style={{ left: decalageGauche }}
      >
      <button
        ref={boutonRef}
        type="button"
        onClick={() => (ouvert ? onFermer?.() : onOuvrir?.())}
        aria-expanded={ouvert}
        aria-label={total > 0 ? `Filtres (${total} actif${total > 1 ? 's' : ''})` : 'Filtres'}
        className={`pointer-events-auto flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold shadow-panel backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
          ouvert || total > 0 ? 'border-gr-primary/50 bg-gr-surface/95 text-gr-primary' : 'border-border-default bg-gr-surface/95 text-text-primary hover:bg-gr-hover'
        }`}
      >
        <IconFiltre size={16} />
        Filtres
        {total > 0 && (
          <span className="rounded-full bg-gr-primary px-1.5 font-mono text-[11px] font-bold text-gr-primary-contrast">{total}</span>
        )}
      </button>
      {aCote}
      </div>
      )}

      {presence.monte && (
        <div
          ref={panneauRef}
          role="dialog"
          aria-label="Filtres de la carte"
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
              <h2 className="text-[14px] font-bold text-white">Filtres</h2>
              <p className="text-[11.5px] text-white/55">{total > 0 ? `${total} filtre${total > 1 ? 's' : ''} actif${total > 1 ? 's' : ''}` : 'Affichage initial'}</p>
            </div>
            <button
              type="button"
              onClick={onFermer}
              aria-label="Masquer les filtres"
              className="flex items-center gap-1.5 rounded-lg border border-white/15 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <IconClose size={13} />
              Masquer
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
            <Section titre="Barrages" modifie={naturesModifiees}>
              <div className="flex flex-wrap gap-1.5">
                {layers.map((l) => (
                  <Puce key={l.key} actif={activeLayers.has(l.key)} couleur={l.color} onClick={() => onToggleLayer?.(l.key)}>
                    {l.fr}
                  </Puce>
                ))}
              </div>
            </Section>

            {factions.length > 0 && (
              <Section titre="Faction" modifie={Boolean(factionChoisie && factionChoisie !== 'toutes')}>
                <div className="flex flex-wrap gap-1.5">
                  <Puce actif={!factionChoisie || factionChoisie === 'toutes'} onClick={() => onChangerFaction?.('toutes')}>
                    Toutes
                  </Puce>
                  {factions.map((f) => (
                    <Puce key={f.id} actif={factionChoisie === f.id} onClick={() => onChangerFaction?.(f.id)}>
                      <span>{f.nom}</span>
                      <span className="font-mono text-[10.5px] opacity-70">{f.debut}–{f.fin}</span>
                      {factionActuelle === f.id && <span title="Faction en cours" className="size-1.5 rounded-full bg-emerald-400" />}
                      <span className="sr-only">{compteursFactions[f.id] ?? 0} postes</span>
                    </Puce>
                  ))}
                </div>
              </Section>
            )}

            <Section titre="Vigilance" modifie={filtreEclairage !== 'tous' || filtreAccidents !== 'tous'}>
              <p className="text-[11.5px] text-white/60">Éclairage nocturne</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['tous', 'Tous'],
                  ['eclaires', 'Éclairés'],
                  ['non_eclaires', 'Non éclairés'],
                ].map(([id, l]) => (
                  <Puce key={id} actif={filtreEclairage === id} onClick={() => onChangerEclairage?.(id)}>
                    {l}
                  </Puce>
                ))}
              </div>
              <p className="pt-1 text-[11.5px] text-white/60">Points noirs (accidents)</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['tous', 'Tous'],
                  ['accidentogenes', 'Sur points noirs'],
                  ['hors_points_noirs', 'Hors points noirs'],
                ].map(([id, l]) => (
                  <Puce key={id} actif={filtreAccidents === id} onClick={() => onChangerAccidents?.(id)}>
                    {l}
                  </Puce>
                ))}
              </div>
            </Section>

            {(couches.length > 0 || onToggleRoutes) && (
              <Section titre="Couches de la carte" modifie={couchesModifiees > 0}>
                <div className="flex flex-wrap gap-1.5">
                  {onToggleRoutes && (
                    <Puce actif={routesVisibles} onClick={onToggleRoutes}>
                      Numéros de routes
                    </Puce>
                  )}
                  {couches.map((c) => (
                    <Puce key={c.key} actif={activeLayers.has(c.key)} couleur={c.color} onClick={() => onToggleLayer?.(c.key)}>
                      {c.fr}
                    </Puce>
                  ))}
                </div>
              </Section>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5">
            <button
              type="button"
              disabled={total === 0}
              onClick={onReinitialiser}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-gr-primary hover:underline disabled:cursor-default disabled:text-white/35 disabled:no-underline"
            >
              <IconRestaurer size={13} />
              Réinitialiser
            </button>
            <button
              type="button"
              onClick={onFermer}
              className="rounded-lg bg-gr-primary px-3.5 py-1.5 text-[12px] font-bold text-gr-primary-contrast hover:bg-gr-primary-hover"
            >
              Terminé
            </button>
          </footer>
        </div>
      )}
    </>
  );
}
