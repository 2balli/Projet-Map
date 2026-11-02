import { usePresence } from '../../usePresence.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * UN MENU DÉROULANT DE LA BARRE DU HAUT — cloche, Instructions.
 *
 * Rendu dans `document.body` (même procédé que la boîte de déconnexion, voir
 * CommandBar.jsx) et positionné sous son bouton. Ouvert DANS l'en-tête, il
 * restait pris dans son empilement : le résumé de contexte le recouvrait, et
 * sur téléphone il sortait de l'écran par la gauche, sous le rail.
 *
 * Aligné sur le bord droit du bouton, jamais à moins de 12 px des bords de la
 * fenêtre. Fermé par Échap ou un clic ailleurs (le bouton compris dans
 * « dedans », pour qu'un clic sur lui bascule au lieu de rouvrir).
 */
const MARGE = 12;

export default function PanneauDeroulant({ ouvert, ancre, onFermer, largeur = 380, label, children }) {
  const panneau = useRef(null);
  const [pos, setPos] = useState(null);
  /* Gardé monté le temps de sa sortie (voir usePresence). */
  const presence = usePresence(ouvert);

  useLayoutEffect(() => {
    if (!ouvert) return undefined;
    const placer = () => {
      const r = ancre.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth;
      const w = Math.min(largeur, vw - 2 * MARGE);
      const droite = Math.max(MARGE, vw - r.right);
      setPos({ top: r.bottom + 8, right: Math.min(droite, vw - MARGE - w), width: w });
    };
    placer();
    window.addEventListener('resize', placer);
    return () => window.removeEventListener('resize', placer);
  }, [ouvert, ancre, largeur]);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => {
      if (panneau.current?.contains(e.target) || ancre.current?.contains(e.target)) return;
      onFermer();
    };
    const clavier = (e) => {
      if (e.key === 'Escape') onFermer();
    };
    document.addEventListener('pointerdown', dehors);
    document.addEventListener('keydown', clavier);
    return () => {
      document.removeEventListener('pointerdown', dehors);
      document.removeEventListener('keydown', clavier);
    };
  }, [ouvert, ancre, onFermer]);

  if (!presence.monte || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={panneau}
      role="dialog"
      aria-label={label}
      data-presence={presence.etat}
      data-depuis="haut"
      style={{ top: pos.top, right: pos.right, width: pos.width, maxHeight: `min(75dvh, calc(100dvh - ${pos.top + MARGE}px))` }}
      className="pointer-events-auto fixed z-[1900] flex flex-col overflow-hidden rounded-2xl border border-border-default bg-gr-navy text-white shadow-panel"
    >
      {children}
    </div>,
    document.body,
  );
}
