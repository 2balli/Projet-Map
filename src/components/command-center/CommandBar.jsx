import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  IconTerritoire,
  IconDeconnexion,
  IconFocus,
  IconChevron,
  IconLayers,
} from '../../icons.jsx';
import MenuParametres from './MenuParametres.jsx';

const ROLE_LABELS = {
  lecture: 'Consultation',
  saisie: 'Saisie',
  commandement: 'Commandement',
};

const RANK_LABELS = {
  admin: 'Administration',
  reg: 'Région',
  cie: 'Compagnie',
  unite: 'Brigade',
};

/**
 * Boîte de dialogue de confirmation de déconnexion.
 */
export function ConfirmationDeconnexionModal({ onConfirmer, onAnnuler }) {
  useEffect(() => {
    const auClavier = (e) => {
      if (e.key === 'Escape') onAnnuler();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [onAnnuler]);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-deconnexion"
      className="pointer-events-auto fixed inset-0 z-[2500] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onAnnuler();
      }}
    >
      <div className="w-full max-w-[380px] rounded-2xl border border-border-default bg-gr-navy p-5 shadow-[0_12px_40px_rgba(0,0,0,0.75)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
        <div className="flex items-start gap-3.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-gr-red/35 bg-gr-red/15 text-gr-red">
            <IconDeconnexion size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="titre-deconnexion" className="text-[15px] font-bold text-text-primary">
              Se déconnecter ?
            </h2>
            <p className="mt-1 text-[13px] leading-snug text-text-secondary">
              Voulez-vous vraiment quitter la session en cours ?
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            autoFocus
            onClick={onAnnuler}
            className="rounded-xl border border-border-default bg-gr-card px-4 py-2 text-[12px] font-semibold text-text-secondary transition-colors hover:bg-gr-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className="rounded-xl border border-gr-red/50 bg-gr-red px-4 py-2 text-[12px] font-bold text-white shadow-sm transition-all hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-red"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

/**
 * BARRE SUPÉRIEURE ÉPURÉE — Map-First Experience
 * Conserve uniquement l'essentiel : logo, sélecteur de zone, recherche et profil/notifications.
 * Déplace les paramètres secondaires dans un menu discret pour libérer 100% de la carte.
 */
export default function CommandBar({
  session,
  mode,
  source = null,
  recherche,
  breadcrumb,
  onOuvrirFiltres = null,
  filtresModifies = 0,
  notifications = 0,
  onNotifications,
  onVoirNotification = null,
  onNouvelleNotification = null,
  onLogout,
  onDemandeDeconnexion,
  panneauOuvert = false,
  panneauDroitOuvert = false,
  apparence = null,
  onChoisirTheme = null,
  onFocus = null,
}) {
  const [demandeLocale, setDemandeLocale] = useState(false);
  const [menuProfilOuvert, setMenuProfilOuvert] = useState(false);
  const menuProfilRef = useRef(null);

  const declencherDeconnexion = onDemandeDeconnexion || (() => setDemandeLocale(true));

  const identite = session?.nom || session?.matricule || session?.unite || 'Utilisateur';
  const contexte = [ROLE_LABELS[session?.role], RANK_LABELS[session?.rang], session?.unite]
    .filter(Boolean)
    .join(' · ');

  // Fermer le menu profil au clic extérieur
  useEffect(() => {
    if (!menuProfilOuvert) return undefined;
    const gererClicDehors = (e) => {
      if (menuProfilRef.current && !menuProfilRef.current.contains(e.target)) {
        setMenuProfilOuvert(false);
      }
    };
    document.addEventListener('mousedown', gererClicDehors);
    return () => document.removeEventListener('mousedown', gererClicDehors);
  }, [menuProfilOuvert]);

  return (
    <>
      <header
        data-gr-chrome
        className="pointer-events-none absolute inset-x-0 top-0 z-[1100] flex items-center justify-between pr-3 pt-2.5 pb-2 transition-[padding-left] duration-200 ease-out"
        style={{
          paddingLeft: panneauOuvert ? '420px' : '88px',
          paddingRight: panneauDroitOuvert ? 'min(442px, 100vw)' : undefined,
        }}
      >
        {/* Gauche : Logo tactique discret & Sélecteur de zone géographique */}
        <div className="pointer-events-auto flex items-center gap-2 max-w-[calc(50vw-120px)] overflow-hidden">
          <div className="flex items-center gap-2 rounded-xl border border-border-default bg-gr-navy/95 px-3 py-1.5 shadow-panel backdrop-blur-md shrink-0">
            <span className="grid size-6 shrink-0 place-items-center rounded-lg border border-gr-gold/45 bg-gr-card text-gr-gold">
              <IconTerritoire size={14} />
            </span>
            <span className="hidden sm:inline text-[11px] font-bold uppercase tracking-[0.08em] text-text-primary whitespace-nowrap">
              Carte tactique
            </span>
            {mode === 'demo' && (
              <span
                title={source === 'fictif' ? 'Données fictives locales' : 'Service de démonstration'}
                className="rounded border border-gr-gold/45 bg-gr-gold/15 px-1.5 py-0.2 text-[8.5px] font-black uppercase text-gr-gold"
              >
                Démo
              </span>
            )}
          </div>
          {breadcrumb}
        </div>

        {/* Centre : Recherche cartographique et Filtres */}
        <div className="pointer-events-auto hidden md:flex items-center gap-2">
          {recherche}
          {onOuvrirFiltres && (
            <button
              type="button"
              onClick={onOuvrirFiltres}
              className={`flex items-center gap-1.5 h-10 px-3 rounded-xl border text-[11.5px] font-bold shadow-panel backdrop-blur-md transition-all cursor-pointer ${
                filtresModifies > 0
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 ring-1 ring-amber-500/30'
                  : 'border-border-default bg-gr-navy/95 text-white/80 hover:text-white hover:border-white/25 hover:bg-white/10'
              }`}
              title="Ouvrir les filtres des barrages"
            >
              <IconLayers size={14} className={filtresModifies > 0 ? 'text-amber-300' : 'text-gr-gold'} />
              <span>Filtres</span>
              {filtresModifies > 0 && (
                <span className="ml-0.5 rounded-full bg-amber-500 px-1.5 py-0.2 text-[9.5px] font-extrabold text-gr-navy leading-tight">
                  {filtresModifies}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Droite : Menu Profil discret (Pas de cloche ni badges) */}
        <div className="pointer-events-auto flex items-center gap-2" ref={menuProfilRef}>

          {/* Bouton profil compact avec menu déroulant */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuProfilOuvert((v) => !v)}
              aria-expanded={menuProfilOuvert}
              aria-label="Menu utilisateur et paramètres"
              title={`${identite} (${contexte})`}
              className={`flex items-center gap-2 rounded-xl border p-1.5 md:px-3 md:py-1.5 shadow-panel backdrop-blur-md transition-all ${
                menuProfilOuvert
                  ? 'border-gr-gold/60 bg-gr-hover text-white ring-1 ring-gr-gold/30'
                  : 'border-border-default bg-gr-navy/95 text-text-primary hover:border-white/20 hover:bg-gr-hover'
              }`}
            >
              <div className="size-7 rounded-lg bg-gr-card flex items-center justify-center text-gr-gold font-bold text-xs border border-white/10 shrink-0">
                {identite.charAt(0).toUpperCase()}
              </div>
              <div className="hidden lg:block text-left min-w-0 max-w-[140px]">
                <p className="truncate text-[11px] font-bold text-white leading-tight">{identite}</p>
                <p className="truncate text-[9px] text-white/50 uppercase font-mono">{session?.rang || 'Commandement'}</p>
              </div>
              <IconChevron size={10} open={menuProfilOuvert} className="text-white/40 hidden sm:block" />
            </button>

            {/* Menu discret au clic sur le profil */}
            {menuProfilOuvert && (
              <div className="absolute right-0 top-full mt-2 w-[240px] rounded-2xl border border-border-default bg-gr-navy/98 p-3 shadow-2xl backdrop-blur-xl z-[1500] space-y-2.5 animate-in fade-in-0 zoom-in-95 duration-100">
                {/* En-tête profil */}
                <div className="pb-2 border-b border-white/10">
                  <p className="font-bold text-[12px] text-white truncate">{identite}</p>
                  <p className="text-[10px] text-white/60 truncate">{contexte}</p>
                </div>

                {/* Paramètres d'apparence (Thème) */}
                {onChoisirTheme && apparence && (
                  <div className="py-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
                      Thème d'affichage
                    </p>
                    <MenuParametres apparence={apparence} onChoisir={onChoisirTheme} />
                  </div>
                )}

                {/* Mode Focus */}
                {onFocus && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuProfilOuvert(false);
                      onFocus();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-[11px] font-semibold transition-colors"
                  >
                    <IconFocus size={14} className="text-gr-gold" />
                    <span>Mode plein écran (Focus)</span>
                  </button>
                )}

                {/* Déconnexion */}
                <div className="pt-2 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuProfilOuvert(false);
                      declencherDeconnexion();
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-300 text-[11px] font-bold transition-colors"
                  >
                    <IconDeconnexion size={14} />
                    <span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {demandeLocale && (
        <ConfirmationDeconnexionModal
          onConfirmer={() => {
            setDemandeLocale(false);
            onLogout?.();
          }}
          onAnnuler={() => setDemandeLocale(false)}
        />
      )}
    </>
  );
}
