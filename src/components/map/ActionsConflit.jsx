import { useEffect, useState } from 'react';
import { IconSpinner, IconCoche, IconTerritoire } from '../../icons.jsx';
import { actionsConflit } from '../../actionsConflit.js';

const TONS = {
  neutre: 'text-white/60',
  succes: 'text-emerald-300',
  attente: 'text-sky-300',
  alerte: 'text-red-300',
};

/**
 * LES BOUTONS D'UN CONFLIT — « Voir sur carte », l'action principale du rôle
 * (voir src/actionsConflit.js), puis les actions secondaires en liens
 * discrets. Le rejet demande son motif (obligatoire) sur place.
 *
 * `onAction(cle, conf, { motif })` : le parent exécute ; ce composant ne
 * décide d'aucun droit. `demandeRejet` (un compteur) ouvre la saisie du motif
 * de l'extérieur — un rejet demandé depuis une autre vue.
 */
export default function ActionsConflit({ conf, session, onAction, onVoirSurCarte = null, enCours = false, erreur = null, demandeRejet = 0 }) {
  const [motif, setMotif] = useState(null);
  useEffect(() => {
    if (demandeRejet) setMotif('');
  }, [demandeRejet]);
  const { principale, secondaires, info, ton } = actionsConflit(conf, session);

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {info && (
        <p className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${TONS[ton]}`}>
          {ton === 'succes' && <IconCoche size={12} className="shrink-0" />}
          <span className="min-w-0">{info}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        {onVoirSurCarte && (
          <button
            type="button"
            onClick={() => onVoirSurCarte(conf)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
          >
            <IconTerritoire size={13} className="text-gr-gold" />
            Voir sur carte
          </button>
        )}
        {principale && (
          <button
            type="button"
            disabled={enCours}
            onClick={() => onAction?.(principale.cle, conf)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gr-primary py-2 text-[12px] font-bold text-gr-primary-contrast shadow-sm transition-colors hover:bg-gr-primary-hover disabled:opacity-60"
          >
            {enCours && <IconSpinner size={12} />}
            {principale.libelle}
          </button>
        )}
      </div>

      {secondaires.length > 0 && motif === null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {secondaires.map((s) => (
            <button
              key={s.cle}
              type="button"
              disabled={enCours}
              onClick={() => (s.cle === 'rejeter' ? setMotif('') : onAction?.(s.cle, conf))}
              className={`text-[11.5px] font-semibold underline-offset-2 hover:underline disabled:opacity-50 ${s.cle === 'rejeter' || s.cle === 'desassigner' ? 'text-red-300' : 'text-gr-primary'}`}
            >
              {s.libelle}
            </button>
          ))}
        </div>
      )}

      {motif !== null && (
        <div className="space-y-1.5 rounded-xl border border-red-500/30 bg-red-500/5 p-2">
          <label htmlFor={`motif-${conf.id}`} className="block text-[11px] font-semibold text-red-300">
            Motif du rejet (obligatoire)
          </label>
          <textarea
            id={`motif-${conf.id}`}
            autoFocus
            rows={2}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            className="w-full resize-y rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[12px] text-text-primary focus:border-gr-primary focus:outline-none"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setMotif(null)} className="rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-white/70 hover:bg-white/10">
              Annuler
            </button>
            <button
              type="button"
              disabled={!motif.trim() || enCours}
              onClick={() => {
                onAction?.('rejeter', conf, { motif: motif.trim() });
                setMotif(null);
              }}
              className="rounded-lg bg-red-600 px-2.5 py-1 text-[11.5px] font-bold text-white hover:bg-red-500 disabled:opacity-50"
            >
              Rejeter
            </button>
          </div>
        </div>
      )}

      {erreur && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11.5px] text-red-300">
          {erreur}
        </p>
      )}
    </div>
  );
}
