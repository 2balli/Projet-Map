import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  IconTerritoire,
  IconDeconnexion,
  IconFocus,
  IconChevron,
  IconReglages,
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
 * Conserve uniquement l'essentiel : logo, sélecteur de zone, recherche et profil.
 * Les filtres ont leur bouton sur le côté de la carte (MenuFiltresUnifie) ; le
 * menu, un bouton à gauche de cette barre (NavigationRail).
 */
export default function CommandBar({
  session,
  mode,
  source = null,
  recherche,
  breadcrumb,
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
  /** Les puces de la rangée du haut (menu « Outils »…), après le fil d'Ariane. */
  outils = null,
}) {
  const [demandeLocale, setDemandeLocale] = useState(false);
  const [menuProfilOuvert, setMenuProfilOuvert] = useState(false);
  const [parametresOuverts, setParametresOuverts] = useState(false);
  const menuProfilRef = useRef(null);

  const declencherDeconnexion = onDemandeDeconnexion || (() => setDemandeLocale(true));

  const identite = session?.nom || session?.matricule || session?.unite || 'Utilisateur';
  /* « Superadmin », « CMD Région Rabat »… */
  const libelleRole =
    session?.rang === 'admin'
      ? 'Superadmin'
      : [RANK_LABELS[session?.rang] ? `CMD ${RANK_LABELS[session.rang]}` : ROLE_LABELS[session?.role], session?.unite].filter(Boolean).join(' ');

  // Fermer le menu profil au clic extérieur
  useEffect(() => {
    if (!menuProfilOuvert) return undefined;
    const gererClicDehors = (e) => {
      if (menuProfilRef.current && !menuProfilRef.current.contains(e.target)) {
        setMenuProfilOuvert(false);
      }
    };
    const gererClavier = (e) => {
      if (e.key === 'Escape') setMenuProfilOuvert(false);
    };
    document.addEventListener('mousedown', gererClicDehors);
    window.addEventListener('keydown', gererClavier);
    return () => {
      document.removeEventListener('mousedown', gererClicDehors);
      window.removeEventListener('keydown', gererClavier);
    };
  }, [menuProfilOuvert]);

  return (
    <>
      <header
        data-gr-chrome
        /* Au-dessus des panneaux flottants : les menus de cette rangée (Outils,
           zone, profil) s'ouvrent dessous sans jamais passer derrière. */
        className="pointer-events-none absolute inset-x-0 top-0 z-[2100] flex items-start justify-between gap-2 pr-3 pt-3 pb-2 transition-[padding-left] duration-200 ease-out"
        style={{
          /* À droite d'un panneau d'outil ouvert ; sinon la simple marge. */
          paddingLeft: panneauOuvert ? '420px' : '12px',
          paddingRight: panneauDroitOuvert ? 'min(442px, 100vw)' : undefined,
        }}
      >
        {/* GAUCHE, comme Google Maps : la boîte de recherche (☰ intégré), puis la
            rangée de puces — zone, fil d'Ariane, Outils, et « Démo » si c'en est une.
            Sur petit écran, les puces passent sous la recherche. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {recherche}
          <div className="pointer-events-auto flex min-w-0 items-center gap-2">
            {outils}
            <div className="flex min-w-0 max-w-[min(520px,calc(100vw-10rem))] items-center gap-2 overflow-hidden">{breadcrumb}</div>
            {mode === 'demo' && (
              <span
                title={source === 'fictif' ? 'Données fictives locales' : 'Service de démonstration — données fictives'}
                className="shrink-0 rounded-full border border-gr-gold/45 bg-gr-surface px-2 py-1 text-[10px] font-black uppercase tracking-wide text-gr-gold shadow-panel"
              >
                Démo
              </span>
            )}
          </div>
        </div>

        {/* Droite : un petit avatar ; nom, rôle, Paramètres et Déconnexion dans son menu. */}
        <div className="pointer-events-auto relative" ref={menuProfilRef}>
          <button
            type="button"
            onClick={() => {
              setMenuProfilOuvert((v) => !v);
              setParametresOuverts(false);
            }}
            aria-expanded={menuProfilOuvert}
            aria-haspopup="menu"
            aria-label={`Profil : ${identite}`}
            title={identite}
            className={`mt-1 grid size-10 place-items-center rounded-full border text-[14px] font-bold shadow-panel backdrop-blur-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
              menuProfilOuvert
                ? 'border-gr-primary/60 bg-gr-surface text-gr-primary'
                : 'border-border-default bg-gr-surface/95 text-gr-gold hover:bg-gr-hover'
            }`}
          >
            {identite.charAt(0).toUpperCase()}
          </button>

          {menuProfilOuvert && (
            <div
              role="menu"
              aria-label="Menu du profil"
              className="absolute right-0 top-full z-[1500] mt-2 w-[230px] overflow-hidden rounded-2xl border border-border-default bg-gr-navy/98 p-1.5 shadow-panel backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-100"
            >
              <div className="flex items-center gap-2.5 border-b border-white/10 px-2.5 pb-2.5 pt-1.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 bg-gr-card text-[13px] font-bold text-gr-gold">
                  {identite.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-bold text-white">{identite}</p>
                  <p className="truncate text-[11px] text-white/55">Rôle : {libelleRole}</p>
                </div>
              </div>

              {(onChoisirTheme && apparence) || onFocus ? (
                <button
                  type="button"
                  role="menuitem"
                  aria-expanded={parametresOuverts}
                  onClick={() => setParametresOuverts((v) => !v)}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-medium text-white/85 transition-colors hover:bg-white/8 hover:text-white"
                >
                  <IconReglages size={15} className="shrink-0 opacity-80" />
                  <span className="flex-1">Paramètres</span>
                  <IconChevron size={10} open={parametresOuverts} className="text-white/40" />
                </button>
              ) : null}
              {/* Les paramètres existants : thème d'affichage et mode focus. */}
              {parametresOuverts && (
                <div className="space-y-2 px-2.5 pb-2 pt-1">
                  {onChoisirTheme && apparence && (
                    <div>
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-white/40">Thème d’affichage</p>
                      <MenuParametres apparence={apparence} onChoisir={onChoisirTheme} />
                    </div>
                  )}
                  {onFocus && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuProfilOuvert(false);
                        onFocus();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <IconFocus size={14} className="text-gr-gold" />
                      <span>Mode plein écran (Focus)</span>
                    </button>
                  )}
                </div>
              )}

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuProfilOuvert(false);
                  declencherDeconnexion();
                }}
                className="mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] font-semibold text-red-300 transition-colors hover:bg-red-500/12"
              >
                <IconDeconnexion size={15} className="shrink-0" />
                <span>Déconnexion</span>
              </button>
            </div>
          )}
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
