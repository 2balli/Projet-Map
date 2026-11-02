import { useRef, useState } from 'react';
import { IconSpinner, IconCoche, IconAlert, IconClose, IconRoute } from '../../icons.jsx';

/**
 * LES ONGLETS D'OPTIMISATION, en haut de la carte.
 *
 * Purement d'affichage : l'état de chaque onglet vient de `OptimisationPanel`
 * (voir `etatsOnglets`), qui le DÉRIVE du dernier résultat renvoyé par le
 * serveur. Ce composant ne décide jamais qu'un onglet est actif ; il transmet
 * le clic, et montre ce qu'on lui dit.
 *
 * UN CLIC N'EXÉCUTE RIEN : il ouvre la boîte de configuration de l'onglet
 * (voir `DialogueOnglet` dans OptimisationPanel.jsx). Le calcul part de son
 * bouton « Lancer l'optimisation ».
 *
 * Statuts : 'idle' (non optimisé), 'optimizing', 'active', 'error'.
 *
 * Clavier : une seule tabulation entre dans la barre ; ← → Début Fin passent
 * d'un onglet à l'autre ; Entrée ou Espace ouvre sa configuration.
 */
const STATUTS = {
  idle: { texte: 'Non optimisé', point: 'bg-[#64748B]' },
  optimizing: { texte: 'Filtration…', point: 'bg-gr-gold' },
  active: { texte: 'Actif', point: 'bg-green-400' },
  error: { texte: 'Erreur', point: 'bg-gr-red' },
};

export default function OngletsOptimisation({ onglets, onOuvrir, onDesactiver }) {
  const [ouverte, setOuverte] = useState(false);
  const [courant, setCourant] = useState(null);
  const [focus, setFocus] = useState(0);
  const boutons = useRef([]);

  if (!onglets?.length) return null;

  const actifs = onglets.filter((o) => o.statut === 'active').length;
  const enCours = onglets.some((o) => o.statut === 'optimizing');
  const enErreur = onglets.some((o) => o.statut === 'error');

  const deplacer = (e, i) => {
    const n = onglets.length;
    const cible = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[
      e.key
    ];
    if (cible === undefined) return;
    e.preventDefault();
    setFocus(cible);
    boutons.current[cible]?.focus();
  };

  const choisi = onglets.find((o) => o.cle === courant) ?? null;

  /* PAR DÉFAUT : Barre masquée pour libérer l'espace sur la carte, bouton discret et visible */
  if (!ouverte) {
    return (
      <div className="pointer-events-auto flex items-center transition-all duration-200">
        <button
          type="button"
          onClick={() => setOuverte(true)}
          aria-expanded={false}
          aria-label="Afficher la barre des filtres et optimisation des barrages"
          title="Afficher les filtres des barrages (Distance, Accidents, VIP, Éclairage, Par routes…)"
          className="group relative flex min-h-9 items-center gap-2 rounded-xl border border-white/15 bg-gr-navy/90 px-3.5 py-1.5 text-[11.5px] font-semibold text-text-primary shadow-panel backdrop-blur-md transition-all duration-200 hover:border-gr-gold/60 hover:bg-gr-navy hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary active:scale-95"
        >
          <span className="text-gr-gold transition-transform duration-200 group-hover:scale-110">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </span>
          <span>Filtres barrages</span>
          {enCours && (
            <span className="text-gr-gold">
              <IconSpinner size={12} />
            </span>
          )}
          {actifs > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-[rgba(74,222,128,0.18)] px-2 py-0.5 text-[10px] font-bold text-green-400">
              <span className="size-1.5 rounded-full bg-green-400" />
              {actifs} actif{actifs > 1 ? 's' : ''}
            </span>
          )}
          {enErreur && (
            <span className="rounded-full bg-gr-red/25 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
              Erreur
            </span>
          )}
          <span className="text-white/40 transition-transform duration-150 group-hover:text-white/80">
            ▾
          </span>
        </button>
      </div>
    );
  }

  return (
    /* En bas de l'écran sur mobile : le message d'erreur passe AU-DESSUS de la barre. */
    <div className="pointer-events-auto flex max-w-full flex-col-reverse items-center gap-1 transition-all duration-200 md:flex-col animate-in fade-in zoom-in-95">
      <div className="flex max-w-full items-center gap-1.5">
        <div
          role="toolbar"
          aria-label="Filtrations de la carte"
          className="flex max-w-full items-stretch gap-1 overflow-x-auto overscroll-contain rounded-xl border border-border-default bg-gr-navy/95 p-1 shadow-panel backdrop-blur-md [scrollbar-width:none]"
        >
        {onglets.map((o, i) => {
          const s = STATUTS[o.statut] ?? STATUTS.idle;
          const selectionne = o.ouvert || courant === o.cle;
          const actif = o.statut === 'active';
          const autresActifs = onglets
            .filter((x) => x.cle !== o.cle && x.statut === 'active')
            .map((x) => x.libelle);
          return (
            <div key={o.cle} className="flex shrink-0 items-stretch">
              <button
                ref={(el) => {
                  boutons.current[i] = el;
                }}
                type="button"
                tabIndex={focus === i ? 0 : -1}
                aria-pressed={actif}
                aria-busy={o.statut === 'optimizing'}
                aria-haspopup="dialog"
                aria-expanded={Boolean(o.ouvert)}
                aria-label={`${o.libelle} — ${s.texte}${o.erreur ? ` : ${o.erreur}` : ''}`}
                title={
                  o.statut === 'error'
                    ? `${o.erreur} — cliquer pour configurer et relancer`
                    : `${s.texte} — cliquer pour configurer`
                }
                onFocus={() => setFocus(i)}
                onKeyDown={(e) => deplacer(e, i)}
                onClick={() => {
                  setCourant(o.cle);
                  onOuvrir?.(o.cle);
                }}
                className={`relative flex min-h-9 shrink-0 items-center gap-2 px-3 text-[11px] ${actif ? 'rounded-l-lg' : 'rounded-lg'} font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
                  actif
                    ? 'bg-[rgba(74,222,128,0.12)] text-text-primary'
                    : o.statut === 'error'
                      ? 'bg-gr-red/15 text-text-primary'
                      : 'text-text-secondary hover:bg-text-secondary/12 hover:text-text-primary'
                }`}
              >
                {o.statut === 'optimizing' ? (
                  <span className="text-gr-gold">
                    <IconSpinner size={12} />
                  </span>
                ) : o.statut === 'active' ? (
                  <IconCoche size={12} className="text-green-400" />
                ) : o.statut === 'error' ? (
                  <IconAlert size={12} className="text-gr-red" />
                ) : o.cle === 'route' ? (
                  <IconRoute size={12} className="text-text-secondary" />
                ) : (
                  <span aria-hidden className={`size-2 rounded-full ${s.point}`} />
                )}
                <span>{o.libelle}</span>
                <span className="hidden font-mono text-[9px] font-bold uppercase tracking-wider opacity-70 sm:inline">
                  {o.statut === 'active'
                    ? 'Actif'
                    : o.statut === 'optimizing'
                      ? '…'
                      : o.statut === 'error'
                        ? 'Erreur'
                        : ''}
                </span>
                {/* L'onglet consulté en dernier : soulignement or, comme le reste du centre de commandement. */}
                {selectionne && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-gr-gold"
                  />
                )}
              </button>
              {/* DÉSACTIVER EN UN CLIC — seulement sur un onglet actif. Hors de la
                tabulation de la barre : au clavier, la boîte de l'onglet porte
                le même geste (« Désactiver »). */}
              {actif && (
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={o.verrouille}
                  aria-label={`Désactiver ${o.libelle}`}
                  title={
                    o.cle === 'distance' && autresActifs.length
                      ? `Désactiver Distance (efface le résultat : ${autresActifs.join(', ')} aussi)`
                      : `Désactiver ${o.libelle}`
                  }
                  onClick={() => onDesactiver?.(o.cle)}
                  className="grid w-7 place-items-center rounded-r-lg border-l border-white/10 bg-[rgba(74,222,128,0.12)] text-text-secondary transition-colors hover:bg-gr-red/25 hover:text-red-300 disabled:opacity-40"
                >
                  <IconClose size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setOuverte(false)}
        aria-expanded={true}
        aria-label="Masquer la barre des filtres"
        title="Masquer la barre des filtres pour libérer la carte"
        className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border-default bg-gr-navy/95 px-2.5 text-[11px] font-semibold text-text-secondary shadow-panel backdrop-blur-md transition-colors hover:bg-text-secondary/12 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary active:scale-95"
      >
        <span>Masquer</span>
        <span className="text-[10px] text-white/50">▴</span>
      </button>
      </div>
      {choisi?.statut === 'error' && !choisi.ouvert && (
        <p
          role="alert"
          className="max-w-[min(92vw,520px)] rounded-lg border border-gr-red/40 bg-gr-navy/95 px-2.5 py-1 text-center text-[10.5px] text-text-primary shadow-panel"
        >
          {choisi.libelle} : {choisi.erreur} — cliquez sur l’onglet pour relancer.
        </p>
      )}
    </div>
  );
}
