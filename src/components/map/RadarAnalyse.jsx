import { useRef } from 'react';
import { usePresence } from '../../usePresence.js';

/**
 * LE RADAR DES CALCULS — affiché EXACTEMENT pendant un calcul réel.
 *
 * Un petit scanner circulaire au centre de la partie visible de la carte :
 * cercles concentriques, faisceau qui tourne, légère lueur ; dessous,
 * « Analyse en cours… », ce qui est calculé, et la PROGRESSION RÉELLE quand le
 * calcul la fournit (paires examinées / total — analyse d'un axe). Rien
 * d'autre : pas de voile sur la carte, pas de tableau de bord.
 *
 * COULEURS : uniquement les jetons du thème actif (index.css,
 * `.gr-radar-analyse-*`) — changer de thème recolore le radar en direct.
 * Animations réduites : le faisceau s'immobilise ; le texte reste.
 *
 * @param {{ radar: { libelle: string, progression?: { faites: number, total: number } } | null, decalageDroit?: number }} p
 */
export default function RadarAnalyse({ radar, decalageDroit = 0 }) {
  const presence = usePresence(Boolean(radar), 240);
  const dernier = useRef(radar);
  if (radar) dernier.current = radar;
  if (!presence.monte) return null;
  const r = dernier.current;
  const p = r?.progression;
  const pct = p && p.total > 0 ? Math.min(100, Math.floor((p.faites / p.total) * 100)) : null;

  return (
    /* Centré sur la partie VISIBLE de la carte (le panneau latéral déduit). */
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-[1050] grid place-items-center"
      style={{ right: decalageDroit }}
    >
      <div className="gr-radar-analyse" data-presence={presence.etat} data-depuis="centre">
        <div className="gr-radar-analyse-disque" aria-hidden="true">
          <span className="gr-radar-analyse-cercle" style={{ '--k': 1 }} />
          <span className="gr-radar-analyse-cercle" style={{ '--k': 0.66 }} />
          <span className="gr-radar-analyse-cercle" style={{ '--k': 0.33 }} />
          <span className="gr-radar-analyse-secteur" />
          <span className="gr-radar-analyse-centre" />
        </div>
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-[220px] max-w-[300px] flex-col items-center gap-1 rounded-xl border border-border-default bg-gr-navy/95 px-3 py-2 text-center shadow-panel"
        >
          <p className="text-[12.5px] font-bold text-text-primary">Analyse en cours…</p>
          {r?.libelle && <p className="text-[11px] text-text-secondary">{r.libelle}</p>}
          {pct != null && (
            <div className="flex w-full items-center gap-2" aria-label={`Progression : ${pct} %`}>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-gr-card">
                <span className="gr-radar-analyse-barre block h-full rounded-full transition-[width] duration-150" style={{ width: `${pct}%` }} />
              </span>
              <span className="font-mono text-[10px] text-text-muted">
                {p.faites.toLocaleString('fr-FR')} / {p.total.toLocaleString('fr-FR')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
