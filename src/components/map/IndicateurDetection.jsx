import { useRef } from 'react';
import { usePresence } from '../../usePresence.js';

/**
 * ANALYSE DES CONFLITS — l'état de la détection réelle, en une pastille.
 *
 *   analyse  une opération qui fait détecter les conflits par le serveur est
 *            en cours (voir DECLENCHE_DETECTION, api.js), puis la liste est
 *            relue : balayage radar discret ;
 *   aucun    la relecture n'a rien apporté de nouveau : « Aucun nouveau
 *            conflit détecté », quelques secondes.
 * Quand la détection trouve un conflit, la pastille s'efface : la notification
 * « Conflit détecté » et l'impulsion sur la carte prennent le relais.
 *
 * Rien n'est simulé : la pastille ne paraît que pendant une vraie requête.
 */
export default function IndicateurDetection({ etat = null }) {
  const presence = usePresence(Boolean(etat));
  const dernier = useRef(etat);
  if (etat) dernier.current = etat;
  if (!presence.monte) return null;
  const aucun = dernier.current === 'aucun';
  return (
    <div
      role="status"
      aria-live="polite"
      data-presence={presence.etat}
      className="pointer-events-none absolute left-1/2 z-[1140] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border-default bg-gr-navy/95 px-3 py-1.5 text-[11px] font-semibold text-text-secondary shadow-panel"
      style={{ top: 'calc(6.75rem + var(--gr-bandeau, 0px))' }}
    >
      {aucun ? (
        <span className="grid size-3.5 place-items-center rounded-full" style={{ background: '#22C55E' }} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
      ) : (
        <span className="gr-balayage" aria-hidden="true" />
      )}
      {aucun ? 'Aucun nouveau conflit détecté' : 'Analyse des conflits…'}
    </div>
  );
}
