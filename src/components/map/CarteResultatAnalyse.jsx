import { useEffect, useRef, useState } from 'react';
import { IconClose } from '../../icons.jsx';
import { usePresence } from '../../usePresence.js';

/**
 * RÉSULTAT DE L'ANALYSE PAR ROUTE — ce que le calcul réel a rendu.
 *
 *   conflits  « X conflits détectés » — compacte : la liste se déplie à la
 *             demande (la carte cadrée sur les conflits reste dégagée) ;
 *             chaque ligne cadre la carte sur ce conflit, REJOUE le dessin de
 *             sa route et ouvre le panneau des conflits existant sur lui ;
 *   aucun     « NO CONFLICT DETECTED » — Aucun conflit détecté dans la zone
 *             analysée (coche, couleur « succès » du thème) ; s'efface seule ;
 *   erreur    l'erreur du calcul, et « Réessayer » (rouvre le filtre). Un
 *             échec n'est JAMAIS présenté comme « aucun conflit ».
 */
const DUREE_AUCUN = 9000;

/*
 * PLACE : en haut à GAUCHE, sous la pastille « Axe isolé ». La carte est
 * bornée au Maroc (maxBounds) : en vue nationale, elle ne peut pas se
 * décaler, et c'est la gauche — l'Atlantique — qui reste libre ; à droite,
 * la carte cachait les conflits du nord (Rabat, Kénitra…).
 */
export default function CarteResultatAnalyse({ analyse, onVoir, onFermer, onReessayer, gauche = 88 }) {
  const etat = analyse?.etat;
  const visible = etat === 'conflits' || etat === 'aucun' || etat === 'erreur';
  const presence = usePresence(visible);
  const dernier = useRef(analyse);
  if (visible) dernier.current = analyse;
  const [fige, setFige] = useState(false);
  const [liste, setListe] = useState(false);
  /* Chaque nouveau résultat repart replié. */
  useEffect(() => setListe(false), [analyse?.version]);

  useEffect(() => {
    if (etat !== 'aucun' || fige) return undefined;
    const t = setTimeout(() => onFermer?.(), DUREE_AUCUN);
    return () => clearTimeout(t);
  }, [etat, fige, analyse?.version, onFermer]);

  if (!presence.monte) return null;
  const a = dernier.current;
  const conflits = a?.conflits ?? [];
  /* `libelle` : le mode (« Axe RN1 », « Optimisation par paramètres »…). */
  const nomCalcul = a?.libelle ?? `Axe ${a?.route}`;
  const pied = `${nomCalcul} · seuil ≤ ${a?.distance} km${a?.paires != null ? ` · ${a.barrages} barrage${a.barrages > 1 ? 's' : ''}, ${a.paires.toLocaleString('fr-FR')} paire${a.paires > 1 ? 's' : ''} analysée${a.paires > 1 ? 's' : ''}` : ''}`;
  /* Couleurs du thème actif : alerte, succès, avertissement. */
  const couleur = { conflits: 'var(--gr-conflit)', aucun: 'var(--tone-ok)', erreur: 'var(--tone-warn)' }[a?.etat];

  return (
    <div
      role={a?.etat === 'erreur' ? 'alert' : 'status'}
      aria-live="polite"
      data-presence={presence.etat}
      onMouseEnter={() => setFige(true)}
      onMouseLeave={() => setFige(false)}
      className="pointer-events-auto absolute z-[1150] w-[350px] max-w-[calc(100vw-2rem)] rounded-xl border border-border-default bg-gr-navy p-3 shadow-panel"
      data-depuis="gauche"
      style={{ top: 'calc(10rem + var(--gr-bandeau, 0px))', left: gauche, borderLeft: `3px solid ${couleur}` }}
    >
      <div className="flex items-start gap-2.5">
        {a?.etat === 'aucun' ? (
          <span className="gr-succes-analyse mt-0.5 grid size-7 shrink-0 place-items-center rounded-full" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path className="gr-succes-coche" d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : (
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[14px] font-black text-white" style={{ background: couleur }} aria-hidden="true">
            !
          </span>
        )}
        <div className="min-w-0 flex-1">
          {a?.etat === 'conflits' && (
            <p className="text-[13px] font-bold text-text-primary">
              {conflits.length} conflit{conflits.length > 1 ? 's' : ''} détecté{conflits.length > 1 ? 's' : ''}
            </p>
          )}
          {a?.etat === 'aucun' && (
            <>
              <p className="text-[13px] font-bold tracking-wide text-text-primary">NO CONFLICT DETECTED</p>
              <p className="text-[11.5px] text-text-secondary">Aucun conflit détecté dans la zone analysée</p>
            </>
          )}
          {a?.etat === 'erreur' && (
            <>
              <p className="text-[13px] font-bold text-text-primary">Échec de l’analyse des conflits</p>
              <p className="text-[11.5px] text-text-secondary">{a.message}</p>
            </>
          )}
          <p className="mt-0.5 text-[10.5px] text-text-muted">{a?.etat === 'erreur' ? `${nomCalcul} · seuil ≤ ${a?.distance} km — aucun résultat n’a été affiché.` : pied}</p>
        </div>
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer le résultat de l’analyse"
          className="gr-bouton grid size-6 shrink-0 place-items-center rounded-md text-text-muted hover:bg-gr-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-gr-primary"
        >
          <IconClose size={12} />
        </button>
      </div>

      {a?.etat === 'conflits' && (
        <button
          type="button"
          onClick={() => setListe((v) => !v)}
          aria-expanded={liste}
          className="gr-bouton mt-2 w-full rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-gr-hover hover:text-text-primary"
        >
          {liste ? 'Masquer la liste' : `Afficher les ${conflits.length} résultat${conflits.length > 1 ? 's' : ''}`}
        </button>
      )}
      {a?.etat === 'conflits' && liste && (
        <ul className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto pr-0.5">
          {conflits.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onVoir?.(c)}
                className="gr-bouton flex w-full items-center gap-2 rounded-lg border border-border-default bg-gr-card px-2.5 py-1.5 text-left hover:bg-gr-hover focus-visible:outline-2 focus-visible:outline-gr-primary"
              >
                <span className="font-mono text-[10.5px] font-bold" style={{ color: 'var(--gr-conflit)' }}>{c.numero}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
                  {c.a?.nom || c.barrageAId} ↔ {c.b?.nom || c.barrageBId}
                </span>
                <span className="font-mono text-[10.5px] text-text-primary">{c.distanceKm} km</span>
                {!c.traceRoutiere && (
                  <span className="text-[9.5px] text-text-muted" title="Graphe routier indisponible : aucune route n’est dessinée pour ce conflit.">
                    sans tracé routier
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {a?.etat === 'erreur' && (
        <button
          type="button"
          onClick={onReessayer}
          className="gr-bouton mt-2 w-full rounded-lg bg-gr-primary px-2 py-1.5 text-[11.5px] font-bold text-gr-primary-contrast hover:bg-gr-primary-hover"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
