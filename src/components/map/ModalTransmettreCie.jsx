import { useEffect, useState } from 'react';
import * as API from '../../api.js';
import { IconAlert, IconClose, IconSpinner } from '../../icons.jsx';

/**
 * MODALE DE TRANSMISSION D'UN CONFLIT AU CMD_COMPAGNIE (CMD_REGION).
 *
 * Affiche uniquement les Commandants de Compagnie autorisés dans la région du conflit.
 * Demande confirmation avant d'enregistrer la transmission et de notifier le CMD_COMPAGNIE.
 * Le conflit reste ouvert (statut 'en_cours') et conserve l'historique complet.
 */
export default function ModalTransmettreCie({
  conflit,
  session,
  onClose,
  onFermer,
  onConfirmer,
}) {
  const fermer = () => {
    if (typeof onClose === 'function') onClose();
    else if (typeof onFermer === 'function') onFermer();
  };

  const [comptes, setComptes] = useState(null);
  const [choix, setChoix] = useState(null);
  const [consigne, setConsigne] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  const bA = conflit?.a || conflit?.barrageA;
  const bB = conflit?.b || conflit?.barrageB;

  const estPosteIntou = (b) =>
    Boolean(
      b &&
      (b.protection === 'intouchable' ||
        b.protection === 'vip' ||
        b.type === 'barrage_vip' ||
        b.intouchable === true ||
        String(b.id || '').startsWith('BFI-'))
    );
  const intA = estPosteIntou(bA);
  const intB = estPosteIntou(bB);

  useEffect(() => {
    let annule = false;
    if (!conflit?.id) return;

    const regCible = session?.unite || bA?.reg || bB?.reg;
    API.listerCmndCieConflit(conflit.id, { reg: regCible })
      .then((res) => {
        if (!annule) {
          const liste = res.comptes ?? [];
          setComptes(liste);
          const duBarrage = liste.find((c) => c.duBarrage) || liste[0];
          if (duBarrage) setChoix(duBarrage.matricule);
        }
      })
      .catch((err) => {
        if (annule) return;
        // Repli automatique via listerComptes
        API.listerComptes()
          .then((tous) => {
            if (annule) return;
            const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const nReg = norm(regCible);
            const liste = (tous ?? [])
              .filter((c) => c.rang === 'cie' && (!nReg || norm(c.reg) === nReg || norm(c.reg).includes(nReg) || nReg.includes(norm(c.reg))))
              .map((c) => ({
                matricule: c.matricule,
                nom: c.nom,
                unite: c.unite,
                duBarrage: Boolean(
                  intA && !intB
                    ? bB?.cie && c.unite === bB.cie
                    : intB && !intA
                    ? bA?.cie && c.unite === bA.cie
                    : (bA?.cie && c.unite === bA.cie) || (bB?.cie && c.unite === bB.cie)
                ),
              }))
              .sort((a, b) => Number(b.duBarrage) - Number(a.duBarrage) || a.unite.localeCompare(b.unite, 'fr'));
            setComptes(liste);
            setErreur(null);
            const duBarrage = liste.find((c) => c.duBarrage) || liste[0];
            if (duBarrage) setChoix(duBarrage.matricule);
          })
          .catch(() => {
            if (!annule) setErreur(err?.message ?? 'Impossible de charger les compagnies autorisées.');
          });
      });

    return () => {
      annule = true;
    };
  }, [conflit?.id, session?.unite, bA?.reg, bB?.reg, bA?.cie, bB?.cie]);

  if (!conflit) return null;

  const distance = Number(conflit.distanceKm ?? conflit.km ?? 0);
  const route = conflit.route || bA?.route || bB?.route || 'Axe commun';

  const valider = async () => {
    if (!choix || envoi) return;
    setEnvoi(true);
    setErreur(null);

    const compteChoisi = comptes?.find((c) => c.matricule === choix);

    try {
      if (typeof onConfirmer === 'function') {
        await onConfirmer({
          conflitId: conflit.id,
          matricule: choix,
          consigne: consigne.trim(),
          destinataire: compteChoisi,
          conflitData: {
            ...conflit,
            id: conflit.id,
            numero: conflit.numero || conflit.id,
            paireCle: conflit.paireCle || (bA?.id && bB?.id ? (bA.id < bB.id ? `${bA.id}|${bB.id}` : `${bB.id}|${bA.id}`) : null),
            barrageAId: bA?.id,
            barrageBId: bB?.id,
            a: bA,
            b: bB,
            distanceKm: distance,
            route,
          },
        });
      }
      fermer();
    } catch (err) {
      setErreur(err?.message ?? 'La transmission n’a pas pu être enregistrée.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => !envoi && fermer()}
      className="fixed inset-0 z-[3000] grid place-items-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-modal-transmettre-cie-titre"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(480px,100%)] rounded-2xl border border-white/15 bg-gr-navy p-5 text-white shadow-2xl space-y-4 my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-[12px] font-bold text-sky-300 border border-sky-500/30">
                {conflit.numero || conflit.id}
              </span>
              <h2 id="gr-modal-transmettre-cie-titre" className="text-[15px] font-bold">
                Assigner au CMD_COMPAGNIE
              </h2>
            </div>
            <p className="mt-1 text-[11.5px] text-white/55">
              Transmettre la responsabilité du traitement opérationnel à une Compagnie de votre région.
            </p>
          </div>
          <button
            type="button"
            onClick={fermer}
            disabled={envoi}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* Résumé du conflit */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] space-y-2">
          <div className="flex items-center justify-between text-white/90">
            <span className="font-semibold text-white truncate max-w-[45%]" title={bA?.nom}>
              {bA?.nom || bA?.id}
            </span>
            <span className="text-white/40 font-bold px-2">↔</span>
            <span className="font-semibold text-white truncate max-w-[45%] text-right" title={bB?.nom}>
              {bB?.nom || bB?.id}
            </span>
          </div>

          <div className="flex items-center justify-between text-[11.5px] text-white/70 pt-1 border-t border-white/10">
            <span>Route : <b className="text-white">{route}</b></span>
            <span>Distance : <b className="text-amber-300">{distance.toFixed(1)} km</b></span>
          </div>
        </div>

        {/* Sélection du Commandant de Compagnie */}
        <div>
          <label className="block text-[11.5px] font-bold uppercase tracking-wider text-sky-300 mb-1.5">
            Commandant de Compagnie responsable :
          </label>

          {!comptes && !erreur && (
            <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-white/60">
              <IconSpinner size={14} /> Chargement des Compagnies autorisées…
            </div>
          )}

          {comptes && comptes.length === 0 && (
            <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] text-white/60 text-center">
              Aucun Commandant de Compagnie disponible dans votre région.
            </p>
          )}

          {comptes && comptes.length > 0 && (
            <div role="radiogroup" aria-label="Commandant de Compagnie" className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {comptes.map((c) => {
                const estSelectionne = choix === c.matricule;
                return (
                  <button
                    key={c.matricule}
                    type="button"
                    role="radio"
                    aria-checked={estSelectionne}
                    onClick={() => setChoix(c.matricule)}
                    className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-[12px] transition-all ${
                      estSelectionne
                        ? 'border-sky-400 bg-sky-500/15 shadow-sm ring-1 ring-sky-400/30'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          CMND Cie {c.unite}
                        </span>
                        {c.duBarrage && (
                          <span className="rounded bg-sky-400/20 px-1.5 py-0.5 text-[9.5px] font-bold text-sky-300 border border-sky-400/30">
                            Compagnie du barrage
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/55 mt-0.5">
                        {c.nom} <span className="font-mono text-[10px] text-white/40">({c.matricule})</span>
                      </p>
                    </div>

                    <div
                      className={`size-4 rounded-full border grid place-items-center ${
                        estSelectionne ? 'border-sky-400 bg-sky-400 text-gr-navy' : 'border-white/30'
                      }`}
                    >
                      {estSelectionne && <span className="size-1.5 rounded-full bg-gr-navy" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Consigne optionnelle */}
        <div>
          <label htmlFor="gr-consigne-transmission" className="block text-[11px] font-semibold text-white/70 mb-1">
            Consigne opérationnelle pour la Compagnie :
          </label>
          <textarea
            id="gr-consigne-transmission"
            rows={2}
            value={consigne}
            onChange={(e) => setConsigne(e.target.value)}
            placeholder="Ex : Réévaluer les factions sur cet axe ou proposer un réajustement de position."
            className="w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[12px] text-white placeholder-white/30 focus:border-sky-400 focus:outline-none"
          />
        </div>

        {erreur && (
          <p role="alert" className="flex items-start gap-1.5 text-[11.5px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            <IconAlert size={14} className="mt-0.5 shrink-0" />
            <span>{erreur}</span>
          </p>
        )}

        <footer className="flex justify-end gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            disabled={envoi}
            onClick={fermer}
            className="rounded-lg px-3.5 py-2 text-[12px] font-semibold text-white/70 hover:bg-white/10 transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!choix || envoi}
            onClick={valider}
            className="flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-[12px] font-bold text-white hover:bg-sky-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
          >
            {envoi && <IconSpinner size={13} />}
            <span>Confirmer la transmission</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
