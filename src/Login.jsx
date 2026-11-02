import { useEffect, useState } from 'react';
import * as API from './api.js';
import { IconChef, IconAlert, IconSpinner, IconVerrou } from './icons.jsx';
import UniteSelect from './UniteSelect.jsx';

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */
/**
 * LES QUATRE NIVEAUX D'ACCÈS, du plus étendu au plus local.
 *
 * L'ordre est celui de la hiérarchie et se lit ligne par ligne dans une
 * grille à deux colonnes :
 *
 *     Admin      Région
 *     Compagnie  Brigade
 *
 * Choix explicite du commandement. J'avais sorti l'administration de cette
 * grille pour ne pas la proposer comme un choix ordinaire ; elle y revient,
 * en tête. Ce qu'aucune disposition ne change : le serveur exige le code du
 * compte, et n'accorde le rang `admin` qu'à un compte qui le porte.
 */
const RANGS_FR = {
  admin: { label: 'Admin', ar: 'المدير' },
  reg:   { label: 'Région', ar: 'الجهة' },
  cie:   { label: 'Compagnie', ar: 'السرية' },
  unite: { label: 'Brigade', ar: 'الفرقة' },
};

/* Étapes d'agrandissement de police disponibles */
const FONT_STEPS = [12, 13, 14, 16, 18];
const FONT_DEFAULT = 1; // index dans FONT_STEPS (13)


/* ------------------------------------------------------------------ */
/* Composant principal                                                 */
/* ------------------------------------------------------------------ */
export default function Login({ onLoginSuccess, avis = null }) {
  /* ---- données API ---- */
  const [unites, setUnites]   = useState(null);
  const [service, setService] = useState(null);

  /* ---- formulaire ---- */
  /* Admin sélectionné à l'ouverture — choix du commandement. Le formulaire
     s'ouvre donc sur le champ « Identifiant administrateur » ; le serveur
     n'accorde ce rang qu'à un compte qui le porte, code à l'appui. */
  const [rang, setRang]    = useState('admin');
  const [unite, setUnite]  = useState('');
  const [code, setCode]    = useState('');
  const [occupe, setOccupe]= useState(false);
  const [erreur, setErreur]= useState(null);

  /**
   * Un compte personnel (matricule individuel, ex. saisie ou lecture) ne
   * correspond à aucune unité de la liste : ce mode bascule le sélecteur
   * d'unité vers un simple champ matricule. Le serveur accepte les deux
   * formes indifféremment (voir POST /api/session).
   */
  const [modePersonnel, setModePersonnel] = useState(false);
  const [matriculePersonnel, setMatriculePersonnel] = useState('');

  /* ---- accessibilité : taille de police ---- */
  const [fontIdx, setFontIdx] = useState(FONT_DEFAULT);
  const fs = FONT_STEPS[fontIdx];

  const chargerService = async () => {
    try {
      const [etat, listeUnites] = await Promise.all([API.etatService(), API.unites()]);
      setService(etat);
      setUnites(listeUnites);
      setErreur(null);
      return true;
    } catch {
      setService({ indisponible: true });
      setErreur("Serveur d'habilitation injoignable.");
      return false;
    }
  };

  useEffect(() => {
    chargerService();
  }, []);

  /* ---- listes de choix ---- */
  const liste =
    rang === 'cie'   ? (unites?.compagnies ?? []) :
    rang === 'unite' ? (unites?.unites     ?? []) :
    rang === 'reg'   ? (unites?.regions    ?? []) : [];

  /* Le filtrage et le regroupement vivent dans `UniteSelect` : la recherche
     est à l'intérieur de la liste, pas à côté d'elle. */

  /* ---- soumission ---- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setOccupe(true);
    setErreur(null);
    try {
      /* `connexion` rend { session, motDePasseAChanger } : le second dit si le
         mot de passe employé était temporaire. C'est `App` qui en décide la
         suite — cet écran ne fait que transmettre. */
      const { session, motDePasseAChanger } = modePersonnel
        ? await API.connexion(undefined, matriculePersonnel, code)
        : await API.connexion(rang, unite, code);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          for (let i = window.localStorage.length - 1; i >= 0; i--) {
            const k = window.localStorage.key(i);
            if (k && (k.startsWith('gr-optimisation-onglets') || k.startsWith('gr-distance'))) {
              window.localStorage.removeItem(k);
            }
          }
        }
      } catch {
        /* ignore */
      }
      onLoginSuccess(session, motDePasseAChanger);
    } catch (err) {
      setErreur(err.message ?? 'Erreur inattendue.');
      setCode('');
    } finally {
      setOccupe(false);
    }
  };

  /* ---- identifiant effectif, selon le mode ---- */
  const identifiant = modePersonnel ? matriculePersonnel : unite;

  /* ---- styles dynamiques selon fs ---- */
  const labelCls  = 'block font-semibold uppercase tracking-wider text-white/50';
  const inputCls  = 'w-full rounded-lg border border-white/10 bg-white/5 px-3 text-white placeholder:text-white/25 focus:border-gr-gold/70 focus:bg-white/8 focus:outline-none transition-colors duration-150';
  const btnBase   = 'flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, var(--login-a) 0%, var(--login-b) 50%, var(--login-c) 100%)' }}
    >
      {/* ── Fond : grille hexagonale ── */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.04]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="hex" width="60" height="52" patternUnits="userSpaceOnUse">
            <polygon points="30,2 58,17 58,47 30,62 2,47 2,17" fill="none" stroke="#c8a349" strokeWidth="0.8" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>

      {/* ── Lumières d'ambiance ── */}
      <div className="pointer-events-none absolute inset-0">
        <div style={{ position:'absolute', top:'15%', left:'10%', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle, rgba(200,163,73,0.06) 0%, transparent 70%)' }} />
        <div style={{ position:'absolute', bottom:'10%', right:'8%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle, rgba(30,80,140,0.10) 0%, transparent 70%)' }} />
      </div>

      {/* ── Contrôles taille police (coin haut-droite) ── */}
      <div
        className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-xl border border-border-default bg-gr-navy/80 px-2 py-1.5 backdrop-blur-sm"
        title="Taille du texte"
      >
        <span style={{ fontSize: 10 }} className="text-white/40 uppercase tracking-wider mr-1">Texte</span>
        <button
          type="button"
          onClick={() => setFontIdx(i => Math.max(0, i - 1))}
          disabled={fontIdx === 0}
          className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/60 hover:bg-white/12 hover:text-gr-gold disabled:opacity-30 transition-colors"
          title="Réduire le texte"
        >
          <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>A-</span>
        </button>
        <span className="px-1 text-white/40 font-mono" style={{ fontSize: 11 }}>{fs}</span>
        <button
          type="button"
          onClick={() => setFontIdx(i => Math.min(FONT_STEPS.length - 1, i + 1))}
          disabled={fontIdx === FONT_STEPS.length - 1}
          className="grid size-7 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/60 hover:bg-white/12 hover:text-gr-gold disabled:opacity-30 transition-colors"
          title="Agrandir le texte"
        >
          <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1 }}>A+</span>
        </button>
      </div>

      {/* ── Heure en temps réel (coin haut-gauche) ── */}
      <LiveClock />

      {/* ── Carte principale ── */}
      <div
        style={{ fontSize: fs }}
        className="relative z-10 mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-border-default bg-gr-navy/85 shadow-panel backdrop-blur-2xl"
      >
        {/* ─ Bord supérieur doré ─ */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, #c8a349, transparent)' }} />

        {/* ─ En-tête ─ */}
        <div className="px-8 pt-8 pb-6 text-center">
          {/* Emblème */}
          <div className="mx-auto mb-4 flex flex-col items-center">
            <div
              className="relative flex size-20 items-center justify-center rounded-full"
              style={{
                background: 'radial-gradient(circle at 40% 40%, #d4af50, #a07828)',
                boxShadow: '0 0 0 4px rgba(200,163,73,0.15), 0 0 30px rgba(200,163,73,0.2), inset 0 2px 4px rgba(255,255,255,0.15)',
              }}
            >
              <IconChef size={38} className="text-gr-deep" />
              {/* Anneau de scan */}
              <div
                className="absolute inset-0 rounded-full border border-gr-gold/30"
                style={{ animation: 'ping 3s cubic-bezier(0,0,0.2,1) infinite', animationDelay: '1s' }}
              />
            </div>
          </div>

          <h1
            className="font-extrabold tracking-[0.15em] text-white"
            style={{ fontSize: fs * 1.4, letterSpacing: '0.14em' }}
          >
            GENDARMERIE ROYALE
          </h1>
          <p
            className="mt-1 tracking-[0.22em] text-gr-gold/80 uppercase font-medium"
            style={{ fontSize: fs * 0.85 }}
          >
            Commandement Tactique
          </p>
          <p
            dir="rtl"
            className="mt-1 text-white/30 tracking-wide"
            style={{ fontSize: fs * 0.82 }}
          >
            نظام القيادة التكتيكية
          </p>

          {/* Séparateur */}
          <div className="mt-5 flex items-center gap-3">
            <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, rgba(200,163,73,0.4))' }} />
            <span className="text-gr-gold/50" style={{ fontSize: fs * 0.78 }}>IDENTIFICATION</span>
            <div className="h-px flex-1" style={{ background: 'linear-gradient(90deg, rgba(200,163,73,0.4), transparent)' }} />
          </div>
        </div>

        {/* ─ Corps : formulaire ─ */}
        <div className="px-8 pb-8">
          {service?.indisponible ? (
            <AlerteBandeau icon={<IconAlert size={16} />} style={{ fontSize: fs * 0.9 }}>
              Serveur injoignable. Le service de connexion est indisponible.
            </AlerteBandeau>
          ) : service?.comptes === 0 ? (
            <AlerteBandeau icon={<IconAlert size={16} />} style={{ fontSize: fs * 0.9 }}>
              Aucun compte n'est déclaré sur le serveur.
            </AlerteBandeau>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              {!modePersonnel ? (
                <>
                  {/* ── Sélection du rang ── */}
                  <div>
                    <p className={labelCls} style={{ fontSize: fs * 0.78 }}>Niveau d'accès</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {Object.entries(RANGS_FR).map(([cle, { label, ar }]) => {
                        const actif = rang === cle;
                        return (
                          <button
                            key={cle}
                            type="button"
                            role="radio"
                            aria-checked={actif}
                            onClick={() => { setRang(cle); setUnite(''); }}
                            className={`${btnBase} flex-col rounded-xl px-3 py-2.5 border ${
                              actif
                                ? 'border-gr-gold/60 bg-gr-gold/12 text-gr-gold shadow-[0_0_12px_rgba(200,163,73,0.15)]'
                                : 'border-white/8 bg-white/4 text-white/55 hover:border-white/16 hover:bg-white/8 hover:text-white'
                            }`}
                            style={{ fontSize: fs * 0.88 }}
                          >
                            <span className="font-bold leading-tight">{label}</span>
                            <span dir="rtl" className="opacity-50 leading-tight" style={{ fontSize: fs * 0.76 }}>{ar}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Unité / Identifiant ── */}
                  <div>
                    <label className={labelCls} style={{ fontSize: fs * 0.78 }}>
                      {rang === 'admin' ? 'Identifiant administrateur' : rang === 'cie' ? 'Compagnie' : rang === 'reg' ? 'Région' : 'Brigade territoriale'}
                    </label>
                    {rang === 'admin' ? (
                      <input
                        className={`${inputCls} mt-1.5`}
                        style={{ fontSize: fs, padding: `${Math.round(fs * 0.6)}px ${Math.round(fs * 0.9)}px` }}
                        value={unite}
                        onChange={(e) => setUnite(e.target.value)}
                        placeholder="Identifiant administrateur"
                        autoComplete="username"
                        required
                      />
                    ) : (
                      <div className="mt-1.5">
                        <UniteSelect
                          options={liste}
                          value={unite}
                          onChange={setUnite}
                          grouperPar={rang === 'cie' ? 'reg' : rang === 'unite' ? 'cie' : null}
                          fs={fs}
                          placeholderRecherche={
                            rang === 'reg' ? 'Rechercher une région…'
                            : rang === 'cie' ? 'Rechercher une compagnie…'
                            : 'Rechercher une brigade ou sa compagnie…'
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* ── Matricule personnel ── */
                <div>
                  <label className={labelCls} style={{ fontSize: fs * 0.78 }}>Matricule</label>
                  <input
                    className={`${inputCls} mt-1.5 font-mono`}
                    style={{ fontSize: fs, padding: `${Math.round(fs * 0.6)}px ${Math.round(fs * 0.9)}px` }}
                    value={matriculePersonnel}
                    onChange={(e) => setMatriculePersonnel(e.target.value)}
                    placeholder="Ex. G12345"
                    autoComplete="username"
                    required
                  />
                </div>
              )}

              {/* ── Bascules discrètes : matricule personnel, administration ── */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  onClick={() => { setModePersonnel((v) => !v); setRang('unite'); setUnite(''); setErreur(null); }}
                  className="text-white/40 hover:text-gr-gold/80 underline-offset-2 hover:underline transition-colors"
                  style={{ fontSize: fs * 0.78 }}
                >
                  {modePersonnel ? '← Revenir à la sélection par unité' : 'Se connecter avec un matricule personnel'}
                </button>

              </div>

              {/*
                ── Mot de passe ──

                LE CHAMP ACCEPTE LES DEUX, et le dit.

                Un compte porte soit un CODE engendré par le service
                (« K7QF-3M2X-9BTR », comparé sans égard à la casse), soit un
                MOT DE PASSE choisi par son titulaire (comparé au caractère
                près). Les deux régimes coexistent le temps que chacun ait fait
                son premier accès — voir `SECRETS` dans serveur/comptes.mjs.

                L'intitulé nommait le seul premier. Quelqu'un venant de choisir
                son mot de passe pouvait légitimement croire qu'on lui
                demandait autre chose.

                Plus d'espacement de caractères ici : il servait à détacher les
                groupes d'un code, et il rendait un mot de passe ordinaire
                illisible sous les points de masquage.
              */}
              <div>
                <label className={labelCls} style={{ fontSize: fs * 0.78 }}>
                  Mot de passe
                </label>
                <input
                  type="password"
                  className={`${inputCls} mt-1.5`}
                  style={{ fontSize: fs, padding: `${Math.round(fs * 0.6)}px ${Math.round(fs * 0.9)}px` }}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="••••••••••"
                  autoComplete="current-password"
                  required
                />
                <p
                  className="mt-1.5 text-white/35"
                  style={{ fontSize: fs * 0.72 }}
                >
                  Ou le code d’habilitation qui vous a été remis. Au premier accès, un
                  nouveau mot de passe vous sera demandé.
                </p>
              </div>

              {/* ── Pourquoi on revient ici (session perdue) ── */}
              {avis && !erreur && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-gr-gold/30 bg-gr-gold/10 px-3 py-2.5 text-gr-gold"
                  role="status"
                  style={{ fontSize: fs * 0.88 }}
                >
                  <IconAlert size={15} className="mt-px shrink-0" />
                  <span>{avis}</span>
                </div>
              )}

              {/* ── Message d'erreur ── */}
              {erreur && (
                <div
                  className="flex items-start justify-between gap-2 rounded-lg border border-gr-red/25 bg-gr-red/10 px-3 py-2.5 text-gr-red"
                  role="alert"
                  style={{ fontSize: fs * 0.88 }}
                >
                  <div className="flex items-start gap-2">
                    <IconAlert size={15} className="mt-px shrink-0" />
                    <span>{erreur}</span>
                  </div>
                  {service?.indisponible && (
                    <button
                      type="button"
                      onClick={() => chargerService()}
                      className="shrink-0 underline hover:text-white font-semibold text-[11px]"
                    >
                      Réessayer
                    </button>
                  )}
                </div>
              )}

              {/* ── Bouton connexion ── */}
              <button
                type="submit"
                disabled={!identifiant || !code || occupe}
                className={`${btnBase} w-full rounded-xl py-3`}
                style={{
                  fontSize: fs * 1.0,
                  background: (!identifiant || !code || occupe)
                    ? 'rgba(200,163,73,0.3)'
                    : 'linear-gradient(135deg, #d4af50 0%, #c8a349 60%, #a07828 100%)',
                  color: '#0b1220',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  boxShadow: (!identifiant || !code || occupe) ? 'none' : '0 4px 20px rgba(200,163,73,0.35)',
                  opacity: occupe ? 0.7 : 1,
                  cursor: occupe ? 'wait' : (!identifiant || !code ? 'not-allowed' : 'pointer'),
                  transition: 'all 0.15s ease',
                }}
              >
                {occupe ? (
                  <><IconSpinner size={16} /> Vérification en cours…</>
                ) : (
                  <><IconVerrou size={16} /> ACCÉDER AU COMMANDEMENT</>
                )}
              </button>

              {/* ── Pied de carte ── */}
              <p className="text-center text-white/25 leading-snug" style={{ fontSize: fs * 0.78 }}>
                Accès réservé au personnel habilité — 5 échecs = blocage 15 min
              </p>
            </form>
          )}
        </div>

        {/* ─ Bord inférieur doré ─ */}
        <div style={{ height: 2, background: 'linear-gradient(90deg, transparent, rgba(200,163,73,0.3), transparent)' }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sous-composants                                                     */
/* ------------------------------------------------------------------ */

/** Horloge en temps réel (coin haut-gauche). */
function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const date  = now.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="absolute top-4 left-4 z-20 rounded-xl border border-border-default bg-gr-navy/80 px-3 py-2 backdrop-blur-sm">
      <p className="font-mono text-[18px] font-bold tabular-nums text-gr-gold/90 leading-tight">{heure}</p>
      <p className="font-mono text-[10px] text-white/35 uppercase tracking-wider">{date}</p>
    </div>
  );
}

/** Bandeau d'alerte. */
function AlerteBandeau({ icon, children, style }) {
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-gr-red/30 bg-gr-red/10 px-4 py-3 text-gr-red"
      role="alert"
      style={style}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}
