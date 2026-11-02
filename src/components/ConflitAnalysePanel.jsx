import { useEffect, useState } from 'react';
import * as API from '../api.js';
import { IconAlert, IconClose, IconSpinner } from '../icons.jsx';

/**
 * Niveaux de sévérité et styles graphiques correspondants.
 */
const SEVERITE_BADGES = {
  critique: { libelle: 'Critique', classe: 'bg-red-500/20 text-red-400 border-red-500/40' },
  alerte: { libelle: 'Alerte', classe: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  attention: { libelle: 'Attention', classe: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/30' },
  info: { libelle: 'Info', classe: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
};

/**
 * PANNEAU D'ANALYSE DE CONFLITS PRÉ-TRAITEMENT
 *
 * Affiché AVANT qu'un CMND Région ne clique « Traiter ».
 * Utilise la géométrie réelle de la route et les distances calculées.
 */
export default function ConflitAnalysePanel({
  barrage,
  seuilInitial = 40,
  onFermer,
  onConfirmerTraitement,
  actionLibelle = 'Procéder au traitement',
  onVoirSurCarte = null,
}) {
  const [seuilKm, setSeuilKm] = useState(seuilInitial);
  const [rapport, setRapport] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let actif = true;
    setChargement(true);
    setErreur(null);
    API.analyserConflitsBarrage(barrage.id, { seuilKm })
      .then((data) => {
        if (actif) {
          setRapport(data);
          setChargement(false);
        }
      })
      .catch((err) => {
        if (actif) {
          setErreur(err.message || 'Erreur lors de l’analyse des conflits.');
          setChargement(false);
        }
      });
    return () => {
      actif = false;
    };
  }, [barrage.id, seuilKm]);

  const conflits = rapport?.conflits ?? [];
  const avertissements = rapport?.avertissements ?? [];

  return (
    <div
      className="fixed inset-0 z-[3200] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onFermer}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-conflit-analyse-titre"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-4rem)] w-[min(650px,100%)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy text-white shadow-2xl"
      >
        {/* En-tête */}
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-white/5">
          <div>
            <h2 id="gr-conflit-analyse-titre" className="text-[15px] font-bold tracking-wide">
              Analyse de conflits pré-traitement
            </h2>
            <p className="text-[12px] text-white/60">
              {barrage.nom || 'Barrage'} · Route {barrage.route || 'non définie'} · Région {barrage.reg || '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* Corps déroulant */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Réglage du seuil de distance */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-white/80">
                Seuil de distance maximale autorisée :
              </span>
              <span className="font-mono text-[13px] font-bold text-gr-gold">
                {seuilKm} km
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <input
                type="range"
                min="5"
                max="80"
                step="5"
                value={seuilKm}
                onChange={(e) => setSeuilKm(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-white/20 accent-gr-gold"
              />
              <div className="flex gap-1">
                {[20, 30, 40, 50].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSeuilKm(v)}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                      seuilKm === v
                        ? 'bg-gr-gold text-gr-navy'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {v}k
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* État de chargement / Erreur */}
          {chargement && (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-white/60">
              <IconSpinner size={16} /> Analyse du réseau et calcul des distances réelles…
            </div>
          )}

          {erreur && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12.5px] text-red-300">
              <IconAlert size={16} className="inline mr-1 text-red-400" /> {erreur}
            </div>
          )}

          {/* Synthèse du rapport */}
          {!chargement && rapport && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-center">
                  <div className="text-[18px] font-bold text-white">
                    {rapport.totalBarragesAnalyses}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wider text-white/50">
                    Barrages analysés
                  </div>
                </div>
                <div className={`rounded-xl border p-2.5 text-center ${
                  conflits.length > 0 ? 'border-amber-500/30 bg-amber-500/10' : 'border-emerald-500/30 bg-emerald-500/10'
                }`}>
                  <div className={`text-[18px] font-bold ${
                    conflits.length > 0 ? 'text-amber-300' : 'text-emerald-400'
                  }`}>
                    {conflits.length}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wider text-white/50">
                    Conflits détectés
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-center">
                  <div className="text-[18px] font-bold text-sky-300">
                    {rapport.routeDetectee || (barrage.route || 'Non rattaché')}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wider text-white/50">
                    Route associée
                  </div>
                </div>
              </div>

              {/* Avertissements sur la géométrie ou coordonnées */}
              {avertissements.length > 0 && (
                <div className="space-y-1.5">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-yellow-300/80">
                    Avertissements & Données
                  </h3>
                  {avertissements.map((a, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-[12px] text-yellow-200"
                    >
                      <p className="font-semibold">{a.message}</p>
                      {a.suggestion && <p className="text-[11px] text-white/60 mt-0.5">{a.suggestion}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* Liste des conflits */}
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                  Détail des conflits ({conflits.length})
                </h3>

                {conflits.length === 0 ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                    <p className="text-[13px] font-semibold text-emerald-400">
                      ✓ Aucun conflit de distance détecté sous le seuil de {seuilKm} km.
                    </p>
                    <p className="text-[11.5px] text-white/60 mt-1">
                      L'espacement avec les autres postes de même faction est conforme.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {conflits.map((c, i) => {
                      const badge = SEVERITE_BADGES[c.severite] ?? SEVERITE_BADGES.alerte;
                      return (
                        <div
                          key={i}
                          className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[13px] text-white">
                              {c.barrageNom || c.barrageId}
                            </span>
                            <span
                              className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${badge.classe}`}
                            >
                              {badge.libelle}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-[11.5px] text-white/70">
                            <div>
                              <span className="text-white/40">Distance réelle : </span>
                              <b className="font-mono text-white">{c.distanceKm} km</b>
                              {c.estDistanceRoute ? ' (par la route)' : ' (à vol d’oiseau)'}
                            </div>
                            <div>
                              <span className="text-white/40">Seuil configuré : </span>
                              <b className="font-mono text-white">{c.seuilKm} km</b>
                            </div>
                            {c.barrageRoute && (
                              <div>
                                <span className="text-white/40">Route : </span>
                                <span>{c.barrageRoute}</span>
                              </div>
                            )}
                            {c.barrageCie && (
                              <div>
                                <span className="text-white/40">Compagnie : </span>
                                <span>{c.barrageCie}</span>
                              </div>
                            )}
                          </div>

                          <p className="text-[12px] text-amber-200/90 leading-snug">
                            {c.message}
                          </p>

                          {c.suggestion && (
                            <p className="text-[11px] text-white/50 italic border-t border-white/5 pt-1 mt-1">
                              Action suggérée : {c.suggestion}
                            </p>
                          )}

                          {onVoirSurCarte && (
                            <button
                              type="button"
                              onClick={() => {
                                onFermer?.();
                                onVoirSurCarte({
                                  barrageId: barrage.id,
                                  barrage,
                                  criteres: {
                                    voisinId: c.barrageId,
                                    voisinNom: c.barrageNom,
                                    distanceKm: c.distanceKm,
                                    seuilKm: c.seuilKm,
                                  },
                                });
                              }}
                              className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-gr-gold hover:underline"
                            >
                              <span>👁 Voir le conflit et la route sur la carte</span>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Pied d'actions */}
        <footer className="flex items-center justify-between border-t border-white/10 bg-white/5 px-5 py-3">
          <button
            type="button"
            onClick={onFermer}
            className="rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/14"
          >
            Fermer
          </button>
          {onConfirmerTraitement && (
            <button
              type="button"
              onClick={() => onConfirmerTraitement(rapport)}
              className="rounded-xl bg-gr-gold px-4 py-2 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors"
            >
              {actionLibelle}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
