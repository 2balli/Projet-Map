import { useEffect, useState } from 'react';
import * as API from '../../api.js';
import { IconAlert, IconClose, IconSpinner } from '../../icons.jsx';

/**
 * « CHANGER LA FACTION » — CMND CIE et CMND Région.
 *
 * Tout vient du serveur (GET /api/barrages/:id/faction) : la faction actuelle,
 * les factions AUTORISÉES pour ce barrage (les factions définies dans
 * serveur/factions.mjs, sauf celle en place ; aucune pour un Intouchable) et
 * l'historique des changements. Les factions se nomment — « Faction 2 » —
 * sans horaire. Rien n'est envoyé avant « Confirmer le changement ».
 *
 * `onConfirmer(factionId)` enregistre (écriture directe, journalisée) et rend
 * la réponse du serveur ; l'écran appelant met la carte à jour.
 */
const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function ChangerFaction({ barrage, factions, onConfirmer, onFermer }) {
  const definies = factions?.factions ?? [];
  const [info, setInfo] = useState(null);
  const [cible, setCible] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let vivant = true;
    API.factionBarrage(barrage.id)
      .then((r) => vivant && setInfo(r))
      .catch((e) => vivant && setErreur(e.message));
    return () => {
      vivant = false;
    };
  }, [barrage.id]);

  useEffect(() => {
    const echap = (e) => e.key === 'Escape' && !occupe && onFermer();
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [occupe, onFermer]);

  const nom = (id) => definies.find((x) => x.id === id)?.nom ?? id;
  const autorisees = new Set(info?.autorisees ?? []);

  const confirmer = async () => {
    if (!cible) return;
    setOccupe(true);
    setErreur(null);
    try {
      await onConfirmer(cible);
    } catch (e) {
      setErreur(e.message);
      setOccupe(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/55 p-4" role="presentation" onClick={() => !occupe && onFermer()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-changer-faction-titre"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(420px,100%)] rounded-2xl border border-white/10 bg-gr-navy p-4 text-white shadow-panel"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="gr-changer-faction-titre" className="text-[14px] font-bold">Changer la faction</h2>
            <p className="truncate text-[12px] text-white/60">{barrage.nom || barrage.id}</p>
          </div>
          <button type="button" aria-label="Fermer" disabled={occupe} onClick={onFermer} className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10">
            <IconClose size={15} />
          </button>
        </div>

        {!info && !erreur && (
          <p role="status" className="mt-3 flex items-center gap-2 text-[12px] text-white/60"><IconSpinner size={13} /> Chargement…</p>
        )}

        {info && (
          <>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-white/55">Actuelle</dt>
              <dd className={info.actuelle ? '' : 'text-red-300'}>{info.actuelle ? nom(info.actuelle) : 'aucune faction affectée'}</dd>
              <dt className="text-white/55">Destination</dt>
              <dd className={cible ? 'font-semibold text-gr-gold' : 'text-white/45'}>{cible ? nom(cible) : 'à choisir ci-dessous'}</dd>
            </dl>

            {autorisees.size === 0 ? (
              <p className="mt-3 text-[12px] text-white/60">{info.motif || 'Aucune autre faction n’est autorisée pour ce barrage.'}</p>
            ) : (
              <div role="radiogroup" aria-label="Faction de destination" className="mt-3 grid grid-cols-2 gap-1.5">
                {definies.map((f) => {
                  const permise = autorisees.has(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={cible === f.id}
                      disabled={!permise || occupe}
                      onClick={() => setCible(f.id)}
                      className={`rounded-lg border px-2.5 py-2 text-left text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
                        cible === f.id ? 'border-gr-gold bg-gr-gold/15' : 'border-white/12 hover:bg-white/8'
                      }`}
                    >
                      {f.nom}{f.id === info.actuelle ? ' · actuelle' : ''}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-[11px] text-white/50">
              Seule la faction change : position, effectif et statut restent ceux du poste. Le changement est enregistré
              immédiatement et inscrit à l’historique.
            </p>

            {info.historique?.length > 0 && (
              <details className="mt-2 text-[11.5px]">
                <summary className="cursor-pointer text-white/60">Historique ({info.historique.length})</summary>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto pr-1 text-white/70">
                  {info.historique.map((h, i) => (
                    <li key={i}>
                      {fmtDate(h.date)} · {h.ancienne ? nom(h.ancienne) : '—'} → {h.nouvelle ? nom(h.nouvelle) : '—'} · {h.par}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {erreur && (
          <p role="alert" className="mt-2 flex gap-1.5 text-[12px] text-red-300">
            <IconAlert size={14} className="mt-px shrink-0" /> {erreur}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={occupe} onClick={onFermer} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white/70 hover:bg-white/8">
            Annuler
          </button>
          <button
            type="button"
            disabled={!cible || occupe}
            onClick={confirmer}
            className="flex items-center gap-1.5 rounded-lg bg-gr-gold px-3 py-2 text-[12px] font-semibold text-gr-navy disabled:opacity-40"
          >
            {occupe && <IconSpinner size={12} />} Confirmer le changement
          </button>
        </div>
      </div>
    </div>
  );
}
