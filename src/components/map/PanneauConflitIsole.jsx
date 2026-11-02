import React from 'react';
import { IconClose, IconTerritoire, IconFleche } from '../../icons.jsx';

/**
 * PANNEAU CONFLIT ISOLÉ — Map-First Experience
 * 
 * Petit panneau latéral dédié à un conflit unique sélectionné sur la carte (« Voir sur carte »).
 * Ne pollue pas l'écran, restitue 100% de l'espace à la carte à la fermeture.
 * 
 * Affiche UNIQUEMENT les informations essentielles :
 * - Conflit sélectionné (numéro simple)
 * - Région concernée
 * - Barrage A → Barrage B
 * - Distance routière
 * - Statut simple (À traiter | En cours | Traité)
 * - Bouton principal « Traiter »
 * - Bouton [✕] de fermeture
 */
export default function PanneauConflitIsole({
  conflit,
  numeroAffiche = 1,
  regionAffichee = null,
  statutSimple = null,
  onFermer,
  onTraiter,
}) {
  if (!conflit) return null;

  const bA = conflit.a || conflit.barrageA || conflit.barrage;
  const bB = conflit.b || conflit.barrageB || conflit.voisin;
  const nomA = bA?.nom || bA?.name || bA?.id || 'Barrage A';
  const nomB = bB?.nom || bB?.name || bB?.id || 'Barrage B';

  const regA = bA?.reg;
  const regB = bB?.reg;
  const regionCalculee =
    regionAffichee ||
    (regA && regB
      ? regA === regB
        ? `Région ${regA}`
        : `Région ${regA} / ${regB}`
      : regA || regB || conflit.workflow?.regions?.[0] || 'Région non définie');

  const distance = Number(
    conflit.distanceRoutiereKm ??
    conflit.distanceKm ??
    conflit.kmTrace ??
    conflit.km ??
    0
  );

  // Statut simple par défaut si non fourni
  const statut = statutSimple || (() => {
    const etat = conflit.workflow?.etat;
    if (
      etat === 'APPROVED' ||
      etat === 'FOLLOW_UP' ||
      etat === 'CLOSED' ||
      conflit.statut === 'resolu' ||
      conflit.statut === 'traite' ||
      conflit.statut === 'cloture'
    ) {
      return { label: 'Traité', badgeClasse: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
    }
    if (
      etat === 'IN_PROGRESS_REGION' ||
      etat === 'IN_PROGRESS_CIE' ||
      etat === 'PENDING_VALIDATION' ||
      conflit.statut === 'en_cours'
    ) {
      return { label: 'En cours', badgeClasse: 'bg-sky-500/15 text-sky-300 border-sky-500/30' };
    }
    return { label: 'À traiter', badgeClasse: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  })();

  const titre = typeof numeroAffiche === 'number'
    ? `Conflit ${numeroAffiche}`
    : String(numeroAffiche || 'Conflit sélectionné');

  return (
    <aside
      aria-label="Détail du conflit sélectionné"
      className="fixed top-20 right-4 z-[2000] w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-gr-navy/95 p-4 text-white shadow-2xl backdrop-blur-xl animate-in slide-in-from-right-4 fade-in duration-200"
    >
      {/* 1. En-tête : Titre simple + bouton X */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-gr-gold/15 text-gr-gold border border-gr-gold/30 shrink-0">
            <IconTerritoire size={14} />
          </span>
          <h2 className="text-[14px] font-extrabold text-white tracking-wide">
            {titre}
          </h2>
        </div>

        <button
          type="button"
          onClick={onFermer}
          title="Fermer et restituer l'espace à la carte"
          aria-label="Fermer le panneau du conflit"
          className="grid size-7 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer text-base"
        >
          <IconClose size={14} />
        </button>
      </div>

      {/* 2. Corps : 4 informations clés uniquement */}
      <div className="py-3.5 space-y-3">
        {/* Région concernée & Statut */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-white/80 truncate" title={regionCalculee}>
            📍 {regionCalculee}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border shrink-0 ${statut.badgeClasse}`}>
            {statut.label}
          </span>
        </div>

        {/* Barrage A → Barrage B */}
        <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="grid size-5 place-items-center rounded-md bg-gr-gold/20 text-gr-gold text-[10px] font-bold border border-gr-gold/40 shrink-0">
              A
            </span>
            <span className="text-[12px] font-bold text-white truncate" title={nomA}>
              {nomA}
            </span>
          </div>

          <div className="flex items-center gap-2 text-white/40 pl-2">
            <span className="text-xs">↓</span>
            <span className="text-[10px] uppercase font-mono tracking-wider">Liaison routière</span>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <span className="grid size-5 place-items-center rounded-md bg-sky-500/20 text-sky-300 text-[10px] font-bold border border-sky-500/40 shrink-0">
              B
            </span>
            <span className="text-[12px] font-bold text-white truncate" title={nomB}>
              {nomB}
            </span>
          </div>
        </div>

        {/* Distance routière */}
        <div className="flex items-center justify-between px-1">
          <span className="text-[11.5px] text-white/60">Distance routière :</span>
          <span className="font-mono font-bold text-red-300 text-sm">
            {distance > 0 ? `${distance.toFixed(1)} km` : 'En calcul'}
          </span>
        </div>
      </div>

      {/* 3. Bouton principal « Traiter » */}
      <div className="pt-2 border-t border-white/10">
        <button
          type="button"
          onClick={() => onTraiter?.(conflit)}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-gr-gold to-amber-500 hover:brightness-110 py-2.5 text-xs font-extrabold text-gr-navy transition-all active:scale-95 shadow-md cursor-pointer"
          title="Ouvrir la confirmation et traiter ce conflit"
        >
          <span>Traiter</span>
          <IconFleche size={14} className="rotate-180" />
        </button>
      </div>
    </aside>
  );
}

