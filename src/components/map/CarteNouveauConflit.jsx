import { useEffect, useRef, useState } from 'react';
import { IconClose, IconAlert, IconTerritoire, IconFleche } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * CARTE NOUVEAU CONFLIT — Map-First Experience
 * 
 * Message temporaire discret sur le côté de la carte :
 * 
 * ┌────────────────────────────────────────────────────────┐
 * │ ⚠️  Nouveau conflit                                [✕] │
 * │ Un nouveau conflit vient d'être détecté dans          │
 * │ la région [Nom de la région].                          │
 * │                                                        │
 * │ [ Voir le conflit → ]                                  │
 * └────────────────────────────────────────────────────────┘
 * 
 * Comportement :
 * - Apparition automatique avec animation discrète
 * - Visible pendant 8 secondes puis disparition automatique
 * - Clic sur « Voir le conflit » : ouvre immédiatement le conflit sélectionné
 *   sur la carte avec son petit panneau latéral dédié
 * - Interaction avec la carte non bloquée
 * - Déduplication : pas de réaffichage pour un même conflit
 * - Groupement propre si plusieurs conflits arrivent simultanément
 */
const DUREE_AFFICHAGE = 8_000;

export default function CarteNouveauConflit({
  conflits = [],
  version = 0,
  onVoir,
  onFermer,
  decalageDroit = 16,
}) {
  const [fige, setFige] = useState(false);
  const vusRef = useRef(new Set());

  // Filtrer les conflits non encore vus pour éviter les alertes redondantes
  const nouveauxNonVus = conflits.filter((c) => c && c.id && !vusRef.current.has(c.id));
  const ouvert = nouveauxNonVus.length > 0;
  const presence = usePresence(ouvert);

  // Marquer comme vus
  useEffect(() => {
    if (nouveauxNonVus.length > 0) {
      nouveauxNonVus.forEach((c) => {
        if (c.id) vusRef.current.add(c.id);
      });
    }
  }, [nouveauxNonVus]);

  // Disparition automatique au bout de 8 secondes
  useEffect(() => {
    if (!ouvert || fige) return undefined;
    const timer = setTimeout(() => {
      onFermer?.();
    }, DUREE_AFFICHAGE);
    return () => clearTimeout(timer);
  }, [ouvert, fige, version, onFermer]);

  if (!presence.monte || nouveauxNonVus.length === 0) return null;

  const premier = nouveauxNonVus[0];
  const plusieurs = nouveauxNonVus.length > 1;

  // Calcul propre du nom de région
  const bA = premier.a || premier.barrageA || premier.barrage;
  const bB = premier.b || premier.barrageB || premier.voisin;
  const regNom =
    bA?.reg ||
    bB?.reg ||
    premier.workflow?.regions?.[0] ||
    premier.workflow?.region ||
    'votre secteur';

  const handleVoir = () => {
    onFermer?.();
    onVoir?.(premier);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setFige(true)}
      onMouseLeave={() => setFige(false)}
      className="pointer-events-auto fixed z-[2050] w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl border border-amber-500/40 bg-gr-navy/95 p-3.5 text-white shadow-2xl backdrop-blur-xl animate-in slide-in-from-right-4 fade-in duration-300"
      style={{ top: '80px', right: `${decalageDroit}px` }}
    >
      {/* En-tête : Titre & Bouton fermer */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
            <IconAlert size={13} />
          </span>
          <h3 className="text-[13px] font-extrabold text-white tracking-wide">
            {plusieurs ? `Nouveaux conflits (${nouveauxNonVus.length})` : 'Nouveau conflit'}
          </h3>
        </div>

        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer l'alerte"
          className="grid size-6 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
        >
          <IconClose size={12} />
        </button>
      </div>

      {/* Message principal */}
      <p className="mt-2 text-[11.5px] leading-relaxed text-white/80">
        {plusieurs
          ? `${nouveauxNonVus.length} nouveaux conflits viennent d'être détectés dans la région ${regNom}.`
          : `Un nouveau conflit vient d'être détecté dans la région ${regNom}.`}
      </p>

      {/* Bouton d'action direct : « Voir le conflit » */}
      <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-end">
        <button
          type="button"
          onClick={handleVoir}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gr-gold to-amber-500 px-3.5 py-1.5 text-[11.5px] font-extrabold text-gr-navy shadow-md hover:brightness-110 active:scale-95 transition-all cursor-pointer"
        >
          <IconTerritoire size={12} />
          <span>Voir le conflit</span>
          <IconFleche size={12} className="rotate-180" />
        </button>
      </div>
    </div>
  );
}
