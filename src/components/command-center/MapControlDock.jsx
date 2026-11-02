import { useEffect, useState } from 'react';
import { IconTarget } from '../../icons.jsx';
import { Boussole, CommandesZoom } from '../map/index.js';

function IconPleinEcran({ reduire = false }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {reduire ? (
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
      ) : (
        <path d="M15 3h6v6M9 21H3v-6M21 15v6h-6M3 9V3h6" />
      )}
    </svg>
  );
}

/** Globe : vue d'ensemble du Maroc */
function IconMaroc() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </svg>
  );
}

/** Réticule cible : My Location / Géolocalisation GPS style Google Maps */
function IconMaPosition() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="1" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="23" />
      <line x1="1" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="23" y2="12" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}

export default function MapControlDock({
  carte,
  zoom,
  min,
  max,
  onRecentrer,
  onMaroc = null,
  onLocaliser = null,
  echelon = null,
}) {
  const [pleinEcran, setPleinEcran] = useState(Boolean(document.fullscreenElement));

  useEffect(() => {
    const actualiser = () => setPleinEcran(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', actualiser);
    return () => document.removeEventListener('fullscreenchange', actualiser);
  }, []);

  const basculerPleinEcran = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    const centre = carte.current?.getContainer()?.closest('[data-gr-command-center]');
    await centre?.requestFullscreen?.();
  };

  const boutonStyle =
    'grid size-10 place-items-center rounded-xl border border-black/10 bg-white/95 text-gray-700 shadow-md backdrop-blur-md transition-all hover:bg-gray-100 hover:text-black active:scale-95 dark:border-white/10 dark:bg-[#202124]/95 dark:text-gray-200 dark:hover:bg-white/10 dark:hover:text-white cursor-pointer';

  return (
    <aside
      className="pointer-events-auto absolute bottom-4 right-4 z-[1050] flex flex-col items-center gap-2"
      aria-label="Commandes de navigation cartographique"
    >
      {/* 1. Bouton Plein écran */}
      <button
        type="button"
        onClick={basculerPleinEcran}
        aria-label={pleinEcran ? 'Quitter le plein écran' : 'Afficher en plein écran'}
        title={pleinEcran ? 'Quitter le plein écran' : 'Plein écran'}
        className={boutonStyle}
      >
        <IconPleinEcran reduire={pleinEcran} />
      </button>

      {/* 2. Bouton Vue Maroc (Ensemble du Royaume) */}
      {onMaroc && (
        <button
          type="button"
          onClick={onMaroc}
          aria-label="Vue d’ensemble du Maroc"
          title="Recadrer sur l’ensemble du Maroc"
          className={boutonStyle}
        >
          <IconMaroc />
        </button>
      )}

      {/* 3. Bouton Recentrer sur sa zone territoriale */}
      <button
        type="button"
        onClick={onRecentrer}
        aria-label="Recentrer la carte"
        title="Recentrer sur votre zone opérationnelle"
        className={boutonStyle}
      >
        <IconTarget size={17} />
      </button>

      {/* 4. Bouton Localisation GPS / Ma Position Google Maps */}
      {onLocaliser && (
        <button
          type="button"
          onClick={onLocaliser}
          aria-label="Ma position géographique"
          title="Centrer sur ma position GPS"
          className={boutonStyle}
        >
          <IconMaPosition />
        </button>
      )}

      {/* 5. Pile de Zoom unifiée Google Maps */}
      <CommandesZoom carte={carte} zoom={zoom} min={min} max={max} integrees echelon={echelon} />

      {/* 6. Boussole d'orientation si nécessaire */}
      <Boussole integree />
    </aside>
  );
}
