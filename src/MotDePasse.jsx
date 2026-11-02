/**
 * NOUVEAU MOT DE PASSE — l'écran obligatoire du premier accès.
 *
 * OÙ IL S'INSÈRE. `App.jsx` connaît trois états et non deux : pas de session,
 * session valable, et session dont le mot de passe est encore le temporaire.
 * Ce troisième état affiche CET écran et rien d'autre — ni carte, ni panneaux.
 *
 * CE QUI LE REND OBLIGATOIRE N'EST PAS CET ÉCRAN. Le serveur refuse toute
 * requête d'une session marquée `doitChanger`, sauf l'état du service, la
 * lecture de session et le changement lui-même (voir le verrou dans
 * `serveur/api.mjs`). Contourner l'écran ne mène donc nulle part : un appel
 * direct à l'API reçoit 428 et rien de plus. L'écran n'est que la face visible
 * d'un refus qui est appliqué ailleurs.
 *
 * APRÈS LE CHANGEMENT, on se reconnecte. Le serveur ferme toutes les sessions
 * du compte — celle-ci comprise — parce qu'on change souvent de mot de passe
 * précisément quand on soupçonne l'ancien d'avoir fuité. L'écran le dit au
 * lieu de laisser croire à une panne.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as API from './api.js';
import { IconVerrou, IconSpinner, IconCoche, IconAlert, IconChef } from './icons.jsx';
import { exigences, refusMotDePasse } from './motDePasseRegles.js';

const RANGS_FR = {
  admin: 'Administration',
  reg: 'Région',
  cie: 'Compagnie',
  unite: 'Brigade territoriale',
};

const champ =
  'min-h-11 w-full rounded-xl border border-white/12 bg-white/6 px-3 text-[15px] text-white ' +
  'placeholder:text-white/25 focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'focus-visible:outline-gr-primary';

export default function MotDePasse({ session, onFait, onAbandon }) {
  const [nouveau, setNouveau] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [fait, setFait] = useState(false);
  const premier = useRef(null);

  useEffect(() => {
    premier.current?.focus();
  }, []);

  const listeExigences = useMemo(() => exigences(nouveau), [nouveau]);
  const refus = refusMotDePasse(nouveau);
  const identiques = nouveau.length > 0 && nouveau === confirmation;
  const pretAEnvoyer = !refus && identiques && !occupe;

  const envoyer = async (e) => {
    e?.preventDefault();
    if (!pretAEnvoyer) return;
    setOccupe(true);
    setErreur(null);
    try {
      await API.changerMotDePasse({ nouveau, confirmation });
      setFait(true);
    } catch (err) {
      /* Le message du serveur est affiché TEL QUEL : c'est lui qui fait
         autorité, et il peut refuser ce que l'écran a laissé passer. */
      setErreur(err?.message ?? 'Le changement n’a pas abouti.');
    } finally {
      setOccupe(false);
    }
  };

  /* ---------------------------------------------------------------- */

  if (fait) {
    return (
      <Cadre>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-gr-green/20 text-gr-green">
            <IconCoche size={34} />
          </span>
          <p className="text-[17px] font-bold leading-tight text-white">Mot de passe enregistré</p>
          <p className="max-w-[38ch] text-[13px] leading-relaxed text-white/60">
            L’ancien mot de passe ne fonctionne plus. Toutes les sessions de ce compte ont été
            fermées — reconnectez-vous avec le nouveau.
          </p>
          <button
            type="button"
            onClick={onFait}
            className="min-h-12 w-full rounded-xl bg-gr-gold px-4 text-[13px] font-bold
              text-gr-navy transition-[filter] duration-150 hover:brightness-110
              motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            SE CONNECTER
          </button>
        </div>
      </Cadre>
    );
  }

  return (
    <Cadre>
      <form onSubmit={envoyer} className="space-y-5">
        <div className="flex items-start gap-2.5 rounded-xl border border-gr-gold/40 bg-gr-gold/12 px-3 py-2.5">
          <IconAlert size={16} className="mt-px shrink-0 text-gr-gold" />
          <p className="text-[12.5px] leading-relaxed text-gr-gold">
            Votre mot de passe est <b>temporaire</b>. Choisissez-en un nouveau pour accéder à
            l’application.
          </p>
        </div>

        {session && (
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
            <p className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-white/90">
                {session.nom}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-white/40">
                {session.matricule}
              </span>
            </p>
            <p className="mt-0.5 text-[11.5px] text-white/45">
              {RANGS_FR[session.rang] ?? session.rang} — {session.unite}
            </p>
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold text-white/75">
            Nouveau mot de passe
          </span>
          <input
            ref={premier}
            type="password"
            className={champ}
            value={nouveau}
            onChange={(e) => setNouveau(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        {/* LES EXIGENCES SONT AFFICHÉES EN PERMANENCE, et non seulement en cas
            d'échec : on choisit mieux quand on sait d'avance ce qui est
            demandé. Chaque ligne se coche à mesure qu'on tape. */}
        <ul className="space-y-1">
          {listeExigences.map((x) => (
            <li key={x.texte} className="flex items-start gap-2 text-[11.5px] leading-snug">
              <span
                className={`mt-px shrink-0 ${x.satisfaite ? 'text-gr-green' : 'text-white/25'}`}
                aria-hidden="true"
              >
                {x.satisfaite ? <IconCoche size={13} /> : <span className="block size-3.5">·</span>}
              </span>
              <span className={x.satisfaite ? 'text-white/70' : 'text-white/40'}>{x.texte}</span>
            </li>
          ))}
        </ul>

        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold text-white/75">
            Confirmer le mot de passe
          </span>
          <input
            type="password"
            className={champ}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            required
          />
          {confirmation.length > 0 && !identiques && (
            <span className="mt-1.5 block text-[11.5px] text-gr-red">
              Les deux saisies ne sont pas identiques.
            </span>
          )}
        </label>

        {erreur && (
          <p
            role="status"
            className="rounded-xl border border-gr-red/40 bg-gr-red/12 px-3 py-2 text-[12px] leading-snug text-gr-red"
          >
            {erreur}
          </p>
        )}

        <button
          type="submit"
          disabled={!pretAEnvoyer}
          className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4
            text-[13px] font-bold transition-colors duration-150 motion-reduce:transition-none
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
            ${
              pretAEnvoyer
                ? 'bg-gr-gold text-gr-navy hover:brightness-110'
                : 'cursor-not-allowed bg-white/8 text-white/35'
            }`}
        >
          {occupe ? <IconSpinner size={16} /> : <IconVerrou size={16} />}
          {occupe ? 'ENREGISTREMENT…' : 'ENREGISTRER'}
        </button>

        {/* Une porte de sortie, mais qui ne mène PAS dans l'application : elle
            referme la session. Sans elle, un poste ouvert par erreur sur le
            compte d'un autre resterait bloqué sur cet écran. */}
        <button
          type="button"
          onClick={onAbandon}
          className="w-full text-[11.5px] text-white/40 underline-offset-2 transition-colors
            duration-150 hover:text-white/70 hover:underline motion-reduce:transition-none"
        >
          Ce n’est pas mon compte — se déconnecter
        </button>
      </form>
    </Cadre>
  );
}

/** Le cadre plein écran, commun aux deux états de cet écran. */
function Cadre({ children }) {
  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gr-deep p-4">
      <div className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/95 shadow-panel">
        <header className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy">
            <IconChef size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[16px] font-bold leading-tight tracking-[-0.01em] text-white">
              NOUVEAU MOT DE PASSE
            </h1>
            <p dir="rtl" className="truncate text-[12.5px] leading-tight text-gr-gold/70">
              كلمة مرور جديدة
            </p>
          </div>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
