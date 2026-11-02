import React, { useState, useEffect, useRef } from 'react';
import {
  IconClose,
  IconLayers,
  IconHoraire,
  IconRestaurer,
  IconCoche,
} from '../../icons.jsx';

/**
 * MENU FILTRES UNIFIÉ — Map-First Experience
 * Regroupe tous les filtres de la carte (Nature des barrages, Factions opérationnelles,
 * Éclairage, Accidentologie) dans un panneau unique, épuré et compréhensible sans formation.
 */
export default function MenuFiltresUnifie({
  ouvert,
  onFermer,
  // Types / Natures de barrages
  layers = [],
  activeLayers = new Set(),
  onToggleLayer,
  // Factions
  factions = [],
  factionChoisie = 'toutes',
  onChangerFaction,
  factionActuelle = null,
  compteursFactions = {},
  // Éclairage & Accidents
  filtreEclairage = 'tous',
  onChangerEclairage,
  filtreAccidents = 'tous',
  onChangerAccidents,
  // Totaux & Réinitialisation
  totalBarrages = 0,
  filtresModifies = 0,
  onReinitialiser,
}) {
  const [ongletActif, setOngletActif] = useState('types'); // 'types' | 'factions' | 'vigilance'
  const conteneurRef = useRef(null);

  // Fermeture au clic extérieur ou touche Échap
  useEffect(() => {
    if (!ouvert) return undefined;
    const gererClicDehors = (e) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) {
        onFermer?.();
      }
    };
    const gererTouche = (e) => {
      if (e.key === 'Escape') onFermer?.();
    };
    document.addEventListener('mousedown', gererClicDehors);
    document.addEventListener('keydown', gererTouche);
    return () => {
      document.removeEventListener('mousedown', gererClicDehors);
      document.removeEventListener('keydown', gererTouche);
    };
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filtres de la carte"
      className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-150"
    >
      <div
        ref={conteneurRef}
        className="w-full max-w-[460px] rounded-2xl border border-white/15 bg-gr-navy/98 p-5 text-white shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-150"
      >
        {/* En-tête */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl bg-gr-gold/15 text-gr-gold border border-gr-gold/30">
              <IconLayers size={16} />
            </span>
            <div>
              <h2 className="text-[14px] font-bold text-white tracking-wide">Filtres de la carte</h2>
              <p className="text-[11px] text-white/50">
                {filtresModifies > 0 ? `${filtresModifies} critère(s) personnalisé(s)` : 'Tous les barrages affichés'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer les filtres"
            className="grid size-8 place-items-center rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <IconClose size={16} />
          </button>
        </div>

        {/* Résumé des filtres actifs */}
        {filtresModifies > 0 && (
          <div className="flex items-center justify-between px-3 py-1.5 mt-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200">
            <span className="font-semibold">✓ {filtresModifies} critère{filtresModifies > 1 ? 's' : ''} actif{filtresModifies > 1 ? 's' : ''}</span>
            <button
              type="button"
              onClick={onReinitialiser}
              className="text-amber-300 hover:text-white font-bold underline cursor-pointer"
            >
              Réinitialiser tout
            </button>
          </div>
        )}

        {/* Onglets de catégories de filtres */}
        <div className="flex items-center gap-1.5 p-1 my-3.5 rounded-xl bg-black/40 border border-white/5">
          <button
            type="button"
            onClick={() => setOngletActif('types')}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
              ongletActif === 'types'
                ? 'bg-gr-gold text-gr-navy shadow-sm'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            Types de postes
          </button>
          <button
            type="button"
            onClick={() => setOngletActif('factions')}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
              ongletActif === 'factions'
                ? 'bg-gr-gold text-gr-navy shadow-sm'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            Factions (Horaires)
          </button>
          <button
            type="button"
            onClick={() => setOngletActif('vigilance')}
            className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-all ${
              ongletActif === 'vigilance'
                ? 'bg-gr-gold text-gr-navy shadow-sm'
                : 'text-white/70 hover:text-white hover:bg-white/5'
            }`}
          >
            Vigilance
          </button>
        </div>

        {/* Contenu de l'onglet 1 : Types de barrages */}
        {ongletActif === 'types' && (
          <div className="space-y-2 py-1 min-h-[190px]">
            <p className="text-[11px] text-white/60 mb-2">
              Sélectionnez les catégories de barrages à afficher sur la carte :
            </p>
            <div className="grid grid-cols-1 gap-2">
              {layers.map((layer) => {
                const actif = activeLayers.has(layer.key);
                return (
                  <button
                    key={layer.key}
                    type="button"
                    onClick={() => onToggleLayer?.(layer.key)}
                    className={`flex items-center justify-between p-2.5 rounded-xl border text-[12px] font-semibold transition-all ${
                      actif
                        ? 'border-gr-gold/50 bg-gr-gold/10 text-white'
                        : 'border-white/5 bg-white/5 text-white/40 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="size-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span>{layer.fr}</span>
                    </div>
                    <span
                      className={`grid size-5 place-items-center rounded-md border text-[10px] ${
                        actif
                          ? 'border-gr-gold bg-gr-gold text-gr-navy'
                          : 'border-white/20 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Contenu de l'onglet 2 : Factions opérationnelles */}
        {ongletActif === 'factions' && (
          <div className="space-y-2 py-1 min-h-[190px]">
            <div className="flex items-center justify-between text-[11px] text-white/60 mb-2">
              <span>Tour de service opérationnel :</span>
              {factionActuelle && (
                <span className="text-amber-300 font-semibold bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                  En cours : {factionActuelle}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onChangerFaction?.('toutes')}
              className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-[12px] font-semibold transition-all ${
                factionChoisie === 'toutes' || !factionChoisie
                  ? 'border-gr-gold/50 bg-gr-gold/10 text-white'
                  : 'border-white/5 bg-white/5 text-white/60 hover:border-white/10'
              }`}
            >
              <span>Toutes les factions (Vue complète)</span>
              {factionChoisie === 'toutes' || !factionChoisie ? (
                <span className="text-gr-gold font-bold">✓</span>
              ) : null}
            </button>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {factions.map((f) => {
                const estChoisie = factionChoisie === f.id;
                const estEnCours = factionActuelle === f.id;
                const compte = compteursFactions[f.id] ?? 0;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onChangerFaction?.(f.id)}
                    className={`flex flex-col p-2.5 rounded-xl border text-left transition-all ${
                      estChoisie
                        ? 'border-gr-gold/60 bg-gr-gold/15 text-white shadow-md'
                        : 'border-white/5 bg-white/5 text-white/70 hover:border-white/10 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[11.5px]">{f.nom}</span>
                      {estEnCours && (
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" title="Faction active en ce moment" />
                      )}
                    </div>
                    <span className="text-[10px] text-white/50 mt-0.5 font-mono">
                      {f.debut} – {f.fin} ({compte} postes)
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Contenu de l'onglet 3 : Vigilance (Éclairage & Accidents) */}
        {ongletActif === 'vigilance' && (
          <div className="space-y-3.5 py-1 min-h-[190px]">
            {/* Éclairage nocturne */}
            <div>
              <label className="block text-[11px] font-semibold text-white/70 mb-1.5">
                💡 Éclairage nocturne des barrages :
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'tous', label: 'Tous' },
                  { id: 'eclaires', label: 'Éclairés' },
                  { id: 'non_eclaires', label: 'Non éclairés' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangerEclairage?.(opt.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all ${
                      filtreEclairage === opt.id
                        ? 'border-amber-400/50 bg-amber-500/20 text-amber-200'
                        : 'border-white/5 bg-white/5 text-white/60 hover:border-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accidentologie / Points noirs */}
            <div>
              <label className="block text-[11px] font-semibold text-white/70 mb-1.5">
                🚗 Zones accidentogènes (Points noirs) :
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'tous', label: 'Tous' },
                  { id: 'accidentogenes', label: 'Sur points noirs' },
                  { id: 'hors_points_noirs', label: 'Hors points noirs' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangerAccidents?.(opt.id)}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-all ${
                      filtreAccidents === opt.id
                        ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                        : 'border-white/5 bg-white/5 text-white/60 hover:border-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Pied du menu : Bouton Réinitialiser & Fermer */}
        <div className="flex items-center justify-between pt-3 mt-4 border-t border-white/10">
          {filtresModifies > 0 ? (
            <button
              type="button"
              onClick={onReinitialiser}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-red-300 hover:text-red-200 transition-colors"
            >
              <IconRestaurer size={12} />
              <span>Réinitialiser les filtres</span>
            </button>
          ) : (
            <span className="text-[11px] text-white/40">Filtres par défaut actifs</span>
          )}

          <button
            type="button"
            onClick={onFermer}
            className="rounded-xl bg-gr-gold px-4 py-1.5 text-[12px] font-extrabold text-gr-navy hover:bg-gr-gold/90 transition-all shadow-md active:scale-95"
          >
            Appliquer & Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

