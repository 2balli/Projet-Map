import { useState } from 'react';
import { IconChevron } from '../../icons.jsx';

const CLE_STATS = 'gr-stats-carte';

/**
 * Encadre le résumé chiffré de la carte (total, fixes, mobiles, entrées, sorties, VIP, etc.).
 */
export function StatistiquesCarte({ stats }) {
  const [ouvert, setOuvert] = useState(() => {
    try {
      return localStorage.getItem(CLE_STATS) !== '0';
    } catch {
      return true;
    }
  });

  const basculer = () => {
    setOuvert((o) => {
      const suivant = !o;
      try {
        localStorage.setItem(CLE_STATS, suivant ? '1' : '0');
      } catch {
        /* stockage indisponible : le choix vaut pour cette session */
      }
      return suivant;
    });
  };

  const Ligne = ({ icone, libelle, valeur, couleur }) => (
    <div className="flex items-baseline gap-1.5">
      <span
        aria-hidden="true"
        className="w-3.5 shrink-0 text-center text-[10px] leading-none text-white/70"
      >
        {icone}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-white/60">{libelle}</span>
      <span
        className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-white"
        style={couleur ? { color: couleur } : undefined}
      >
        {valeur}
      </span>
    </div>
  );

  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-xl border border-white/12
      bg-gr-navy/95 shadow-panel backdrop-blur"
    >
      <button
        type="button"
        onClick={basculer}
        aria-expanded={ouvert}
        title={ouvert ? 'Replier les statistiques' : 'Afficher les statistiques'}
        className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left
          transition-colors duration-150 hover:bg-white/6 motion-reduce:transition-none
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
      >
        <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">
          📊
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-gr-gold/85">
          Statistiques
        </span>
        <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-white">
          {stats.total}
        </span>
        <IconChevron size={10} open={ouvert} className="shrink-0 text-white/40" />
      </button>

      {ouvert && (
        <div className="space-y-1 border-t border-white/10 px-2.5 py-2">
          <Ligne icone="🛡️" libelle="Barrages fixes intouchables" valeur={stats.bfi ?? stats.intouchables ?? 0} couleur="#14b8a6" />
          <Ligne icone="▪" libelle="Barrages fixes normaux" valeur={stats.fixesNormaux ?? stats.fixes ?? 0} />
          <Ligne icone="▫" libelle="Barrages mobiles" valeur={stats.mobiles ?? 0} couleur={stats.mobiles > 0 ? undefined : '#64748b'} />

          <div className="my-1 border-t border-white/8" />

          <Ligne icone="🔒" libelle="Entrées de ville" valeur={stats.entrees} couleur="#5b9bd5" />
          <Ligne icone="🔒" libelle="Sorties de ville" valeur={stats.sorties} couleur="#5b9bd5" />
          <Ligne icone="⭐" libelle="VIP" valeur={stats.vip} couleur="#c4a2ff" />
          <Ligne icone="💡" libelle="Non éclairés" valeur={stats.nonEclaires} couleur="#e0c76a" />

          {stats.avecOptimisation && (
            <>
              <div className="my-1 border-t border-white/8" />
              <Ligne icone="?" libelle="À décider" valeur={stats.aDecider} couleur="#ff6b6b" />
              <Ligne
                icone="🔒"
                libelle="Intouchables"
                valeur={stats.intouchables}
                couleur="#9ad1a5"
              />
            </>
          )}

          <p className="pt-1 text-[9px] leading-snug text-white/35">Barrages — {stats.assiette}</p>
        </div>
      )}
    </div>
  );
}

export default StatistiquesCarte;
