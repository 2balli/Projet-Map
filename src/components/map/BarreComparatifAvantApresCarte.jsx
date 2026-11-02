import React from 'react';
import { IconClose, IconTerritoire, IconDistance, IconCoche } from '../../icons.jsx';

/**
 * BARRE FLOTTANTE SUR CARTE : COMPARATIF AVANT / APRÈS D'UN CONFLIT TRAITÉ.
 *
 * Permet au Super Admin ou aux Officiers de basculer instantanément
 * entre l'état initial (AVANT) et l'état résolu (APRÈS), ou de comparer
 * les deux sur la carte avec les tracés et nouveaux repères.
 */
export default function BarreComparatifAvantApresCarte({
  conflit,
  mode = 'comparer',
  onChangerMode,
  onRecadrer,
  onFermer,
}) {
  if (!conflit) return null;

  const id = conflit.conflitNumero || conflit.id || 'Conflit';
  const bA = conflit.barrage;
  const bB = conflit.voisin;
  const changement = conflit.changement || conflit.traitement?.changement || {};
  const isDeplacement = changement.type === 'deplacement' || (changement.apres?.lat != null);
  const isFaction = changement.type === 'changement_faction';
  const isSuppr = changement.type === 'suppression' || changement.type === 'suppression_barrage' || Boolean(changement.barrageSupprime);

  const distAvant = Number(changement.avant?.distanceKm ?? conflit.distanceKm ?? 0);
  const distApres = Number(changement.apres?.distanceKm ?? (isDeplacement ? 25.0 : distAvant));
  const routeAvant = changement.avant?.route || conflit.route || bA?.route || 'Route';
  const routeApres = changement.apres?.route || routeAvant;
  const seuilKm = Number(conflit.seuilKm ?? 20);

  return (
    <div
      role="toolbar"
      aria-label="Contrôle comparatif avant après"
      className="pointer-events-auto rounded-2xl border border-border-default bg-gr-navy/95 backdrop-blur-xl p-3 shadow-panel text-white transition-all max-w-xl w-full mx-auto"
    >
      {/* Ligne 1 : Titre du conflit et bouton de fermeture */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded-lg bg-gr-gold/20 text-gr-gold border border-gr-gold/40 px-2 py-0.5 text-[11px] font-extrabold shrink-0">
            {id}
          </span>
          <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 text-[9.5px] font-bold shrink-0">
            ✓ TRAITÉ
          </span>
          <span className="font-bold text-xs truncate text-slate-100">
            {bA?.nom || 'Barrage A'} <span className="text-white/40">↔</span> {bB?.nom || 'Barrage B'}
          </span>
        </div>

        <button
          type="button"
          onClick={onFermer}
          title="Fermer la vue comparative"
          className="grid size-6 place-items-center rounded-lg bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-colors"
        >
          <IconClose size={13} />
        </button>
      </div>

      {/* Ligne 2 : Sélecteur segmented AVANT / APRÈS / COMPARER */}
      <div className="grid grid-cols-3 gap-1.5 pt-2">
        {/* BOUTON AVANT */}
        <button
          type="button"
          onClick={() => onChangerMode?.('avant')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-2 text-[11px] font-bold transition-all active:scale-95 border ${
            mode === 'avant'
              ? 'border-red-400 bg-red-500/30 text-red-200 ring-2 ring-red-500/40 shadow-lg'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          <span className="size-2 rounded-full bg-red-400 shrink-0" />
          <span>AVANT</span>
          <span className="text-[9.5px] opacity-75 font-mono">({distAvant.toFixed(1)} km)</span>
        </button>

        {/* BOUTON APRÈS */}
        <button
          type="button"
          onClick={() => onChangerMode?.('apres')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-2 text-[11px] font-bold transition-all active:scale-95 border ${
            mode === 'apres'
              ? 'border-emerald-400 bg-emerald-500/30 text-emerald-200 ring-2 ring-emerald-500/40 shadow-lg'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          <span className="size-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
          <span>APRÈS</span>
          <span className="text-[9.5px] opacity-75 font-mono">
            ({isDeplacement ? `${distApres.toFixed(1)} km` : 'Résolu'})
          </span>
        </button>

        {/* BOUTON COMPARER */}
        <button
          type="button"
          onClick={() => onChangerMode?.('comparer')}
          className={`flex items-center justify-center gap-1.5 rounded-xl py-1.5 px-2 text-[11px] font-bold transition-all active:scale-95 border ${
            mode === 'comparer'
              ? 'border-cyan-400 bg-cyan-500/30 text-cyan-200 ring-2 ring-cyan-500/40 shadow-lg'
              : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          <span>⇄</span>
          <span>COMPARER</span>
        </button>
      </div>

      {/* Ligne 3 : Détail contextuel selon le mode actif */}
      <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white/5 border border-white/5 px-2.5 py-1.5 text-[10.5px]">
        <div className="flex items-center gap-1.5 text-white/80 truncate">
          {mode === 'avant' && (
            <>
              <span className="text-red-400 font-bold">🔴 Position initiale :</span>
              <span className="truncate">
                Axe {routeAvant} ({distAvant.toFixed(1)} km &lt; {seuilKm} km — conflit actif)
              </span>
            </>
          )}

          {mode === 'apres' && (
            <>
              <span className="text-emerald-400 font-bold">🟢 Position modifiée :</span>
              {isDeplacement && (
                <span className="truncate">
                  Nouvel axe {routeApres} ({distApres.toFixed(1)} km ≥ {seuilKm} km ✓ résolu)
                </span>
              )}
              {isFaction && (
                <span className="truncate">
                  Faction décalée ({changement.apres?.factionNom || 'Nouvelle faction'}) ✓
                </span>
              )}
              {isSuppr && (
                <span className="truncate">
                  Poste surnuméraire retiré du dispositif ✓
                </span>
              )}
            </>
          )}

          {mode === 'comparer' && (
            <>
              <span className="text-cyan-300 font-bold">⇄ Comparaison :</span>
              {isDeplacement && (
                <span className="truncate">
                  {routeAvant} ({distAvant.toFixed(1)} km) ➔ {routeApres} ({distApres.toFixed(1)} km ✓)
                </span>
              )}
              {isFaction && (
                <span className="truncate">
                  {changement.avant?.factionNom || 'Faction initiale'} ➔ {changement.apres?.factionNom || 'Nouvelle faction'}
                </span>
              )}
              {isSuppr && (
                <span className="truncate">
                  Poste initial ➔ Retrait validé
                </span>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onRecadrer}
          title="Recadrer la carte sur cette sélection"
          className="shrink-0 flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/90 px-2 py-0.5 text-[10px] font-bold transition-all active:scale-95"
        >
          <IconTerritoire size={11} className="text-gr-gold" />
          <span>Recadrer</span>
        </button>
      </div>
    </div>
  );
}
