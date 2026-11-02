import { useEffect, useState } from 'react';
import { IconAlert, IconClose, IconSpinner } from '../../icons.jsx';

/**
 * « ASSIGNER AU CMND RÉGION » — le geste du Super Admin sur un barrage, ou sur
 * les barrages d'une route filtrée.
 *
 * Le Super Admin ne modifie plus les barrages : il les REMET au commandement
 * de région qui les porte, avec une consigne. Chaque barrage part vers SA
 * région (celle de sa fiche) ; le CMND Région le reçoit dans ses
 * notifications, le traite avec ses propres droits et en accuse réception
 * (serveur : POST /api/barrages/assigner).
 *
 * `onConfirmer(texte)` envoie et rend la réponse du serveur
 * (`{assignees, ignores}`) ; la boîte montre ce qui a été assigné et ce qui
 * ne l'a pas été, avec la raison.
 */
export default function AssignerRegion({ barrages, onConfirmer, onFermer }) {
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [resultat, setResultat] = useState(null);

  useEffect(() => {
    const echap = (e) => e.key === 'Escape' && !occupe && onFermer();
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [occupe, onFermer]);

  const parRegion = new Map();
  for (const b of barrages) {
    const r = b.reg || '— sans région';
    parRegion.set(r, (parRegion.get(r) ?? 0) + 1);
  }

  const confirmer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      setResultat(await onConfirmer(texte.trim()));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/55 p-4" role="presentation" onClick={() => !occupe && onFermer()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-assigner-titre"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(440px,100%)] rounded-2xl border border-white/10 bg-gr-navy p-4 text-white shadow-panel"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="gr-assigner-titre" className="text-[14px] font-bold">Assigner au CMND Région</h2>
            <p className="text-[12px] text-white/60">
              {barrages.length === 1 ? barrages[0].nom || barrages[0].id : `${barrages.length} barrages`}
            </p>
          </div>
          <button type="button" aria-label="Fermer" disabled={occupe} onClick={onFermer} className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10">
            <IconClose size={15} />
          </button>
        </div>

        {!resultat ? (
          <>
            <ul className="mt-3 space-y-0.5 text-[12.5px]">
              {[...parRegion].map(([r, n]) => (
                <li key={r} className="flex justify-between gap-2">
                  <span>CMND Région <b>{r}</b></span>
                  <span className="text-white/55">{n} barrage{n > 1 ? 's' : ''}</span>
                </li>
              ))}
            </ul>
            <label className="mt-3 block">
              <span className="mb-1 block text-[11.5px] font-semibold text-white/70">Consigne (facultative)</span>
              <textarea
                rows={3}
                value={texte}
                onChange={(e) => setTexte(e.target.value)}
                placeholder="Ex. vérifier le conflit de distance sur la RN1 et repositionner si nécessaire."
                className="w-full resize-none rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-[12.5px] text-white placeholder:text-white/30"
              />
            </label>
            <p className="mt-2 text-[11px] text-white/50">
              Le barrage n’est pas modifié : le CMND Région le reçoit dans ses notifications et le traite avec ses droits.
            </p>
          </>
        ) : (
          <div role="status" className="mt-3 space-y-1 text-[12px]">
            <p className="font-semibold text-green-300">{resultat.assignees.length} barrage(s) assigné(s).</p>
            {resultat.ignores?.length > 0 && (
              <ul className="space-y-0.5 text-white/60">
                {resultat.ignores.map((x) => <li key={x.id}>{x.nom ?? x.id} : {x.raison}</li>)}
              </ul>
            )}
          </div>
        )}

        {erreur && (
          <p role="alert" className="mt-2 flex gap-1.5 text-[12px] text-red-300">
            <IconAlert size={14} className="mt-px shrink-0" /> {erreur}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {!resultat ? (
            <>
              <button type="button" disabled={occupe} onClick={onFermer} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white/70 hover:bg-white/8">
                Annuler
              </button>
              <button
                type="button"
                disabled={occupe || !barrages.length}
                onClick={confirmer}
                className="flex items-center gap-1.5 rounded-lg bg-gr-gold px-3 py-2 text-[12px] font-semibold text-gr-navy disabled:opacity-40"
              >
                {occupe && <IconSpinner size={12} />} Confirmer l’assignation
              </button>
            </>
          ) : (
            <button type="button" onClick={onFermer} className="rounded-lg bg-white/10 px-3 py-2 text-[12px] font-semibold hover:bg-white/16">
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
