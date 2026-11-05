import { IconAlert, IconClose, IconCoche } from '../../icons.jsx';

/**
 * LA RÉÉVALUATION APRÈS UN DÉPLACEMENT — ce que le serveur a recalculé sur les
 * coordonnées enregistrées (actualiserApresOperation → `reevaluation`) :
 *
 *   Position valide        plus aucun conflit de distance pour ce poste ;
 *   Conflit restant        tel voisin, à telle distance, sous le seuil ;
 *   Nouveau conflit        tel voisin est désormais trop proche ;
 *   Nouvelle position      quel poste déplacer (jamais un intouchable), et
 *   nécessaire             « Déplacer … » relance la sélection de position —
 *                          la réévaluation se refait à chaque enregistrement.
 *
 * Deux intouchables face à face : aucune position ne règle le conflit — une
 * intervention manuelle est nécessaire.
 */
export default function CarteReevaluation({ bilan, onDeplacer, onVoirConflits, onFermer }) {
  if (!bilan) return null;
  const km = (v) => (Number.isFinite(Number(v)) ? `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : '—');
  const problemes = [...bilan.nouveaux.map((l) => ({ ...l, nouveau: true })), ...bilan.restants];
  const aDeplacer = problemes.find((l) => l.aDeplacerId) ?? null;
  const bloque = problemes.length > 0 && problemes.every((l) => !l.aDeplacerId);

  return (
    <div
      role="status"
      aria-live="polite"
      data-gr-reevaluation
      className="pointer-events-auto fixed bottom-16 left-1/2 z-[1600] w-[min(340px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-xl md:bottom-3 md:left-auto md:right-3 md:translate-x-0"
    >
      <header className={`flex items-start gap-2 border-b px-3 py-2 ${bilan.valide ? 'border-emerald-500/25 bg-emerald-500/10' : 'border-amber-500/25 bg-amber-500/10'}`}>
        <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${bilan.valide ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
          {bilan.valide ? <IconCoche size={13} /> : <IconAlert size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-bold">
            {bilan.valide ? 'Position valide' : bloque ? 'Intervention manuelle nécessaire' : 'Nouvelle position nécessaire'}
          </h2>
          <p className="truncate text-[10.5px] text-white/60" title={bilan.simulation ? 'Position demandée, en attente de validation par l’administration : les statuts des conflits seront mis à jour à l’approbation.' : undefined}>
            {bilan.barrageNom} · seuil {bilan.seuilKm} km · {bilan.simulation ? 'position demandée (en attente de validation)' : 'position enregistrée'}
          </p>
        </div>
        <button type="button" onClick={onFermer} aria-label="Fermer" className="grid size-6 shrink-0 place-items-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white">
          <IconClose size={12} />
        </button>
      </header>

      <div className="max-h-[40vh] space-y-2 overflow-y-auto px-3 py-2 text-[11.5px]">
        {bilan.valide && (
          <p className="text-emerald-200">Plus aucun conflit de distance pour ce poste : sa position est acceptable.</p>
        )}
        {problemes.length > 0 && (
          <ul className="space-y-1">
            {problemes.map((l) => (
              <li key={`${l.nouveau ? 'n' : 'r'}-${l.autreId}`} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className={`mr-1 text-[10px] font-bold uppercase ${l.nouveau ? 'text-red-300' : 'text-amber-300'}`}>{l.nouveau ? 'Nouveau' : 'Restant'}</span>
                  {l.autreNom}
                </span>
                <span className="shrink-0 font-mono text-red-300">{km(l.distanceKm)} &lt; {l.seuilKm} km</span>
              </li>
            ))}
          </ul>
        )}
        {bilan.resolus.length > 0 && (
          <p className="text-[11px] text-emerald-300">
            ✓ Résolu : {bilan.resolus.map((l) => l.autreNom).join(', ')}
          </p>
        )}
        {bloque && (
          <p className="text-[11px] text-white/65">Les deux postes sont intouchables : aucun déplacement ne règle ce conflit.</p>
        )}
      </div>

      {!bilan.valide && (
        <footer className="flex items-center justify-end gap-1.5 border-t border-white/10 px-3 py-2">
          {onVoirConflits && (
            <button type="button" onClick={onVoirConflits} className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white/75 hover:bg-white/10 hover:text-white">
              Voir les conflits
            </button>
          )}
          {aDeplacer && onDeplacer && (
            <button
              type="button"
              onClick={() => onDeplacer(aDeplacer.aDeplacerId)}
              className="max-w-[60%] truncate rounded-lg bg-gr-gold px-3 py-1.5 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90"
              title={`Choisir une nouvelle position pour ${aDeplacer.aDeplacerNom}`}
            >
              Déplacer {aDeplacer.aDeplacerNom}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
