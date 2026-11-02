import { useEffect, useMemo, useState } from 'react';
import * as API from '../../api.js';
import { IconAlert, IconClose, IconSpinner } from '../../icons.jsx';

/**
 * MODALE D'ASSIGNATION D'UN CONFLIT AU CMD_REGION (Super Admin).
 *
 * Affiche les informations réelles du conflit :
 *   - Numéro (C-01, C-02...)
 *   - Barrages A et B concernés
 *   - Régions des barrages A et B
 *   - Détection automatique de conflit inter-régions
 *   - Pré-sélection automatique de la région ou des 2 régions concernées
 *   - Possibilité d'assigner conjointement aux deux Commandants de Région
 */
export default function ModalAssignerConflit({
  conflit = null,
  conflits = null,
  onClose,
  onConfirmer,
}) {
  const estGroupe = Array.isArray(conflits) && conflits.length > 0;
  const conflitEffectif = conflit || (estGroupe ? conflits[0] : null);
  const [comptes, setComptes] = useState(null);
  const [selection, setSelection] = useState([]);
  const [consigne, setConsigne] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  const bA = conflitEffectif?.a || conflitEffectif?.barrageA;
  const bB = conflitEffectif?.b || conflitEffectif?.barrageB;
  const regA = bA?.reg ?? null;
  const regB = bB?.reg ?? null;
  const estInterRegion = Boolean(regA && regB && regA !== regB);

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
  const conflitBfiVsBf = (intA && !intB) || (intB && !intA);
  const regionBfSeule = conflitBfiVsBf ? (intA ? regB : regA) : null;

  const comptesAffiches = useMemo(() => {
    if (!comptes) return [];
    if (conflitBfiVsBf && !estGroupe) {
      // Règle BFI vs BF : Le BFI est intouchable, seule la région du BF doit apparaître
      const filtres = comptes.filter((c) => !c.estBfiRegion && (intA ? c.concerneB : c.concerneA));
      return filtres.length > 0 ? filtres : comptes.filter((c) => !c.estBfiRegion);
    }
    return comptes;
  }, [comptes, conflitBfiVsBf, estGroupe, intA]);

  useEffect(() => {
    let annule = false;
    if (!conflitEffectif && !estGroupe) return;

    if (estGroupe) {
      API.listerCmndRegionConflit(null)
        .then((res) => {
          if (!annule) {
            const liste = res.comptes ?? [];
            setComptes(liste);
            if (liste[0]) setSelection([liste[0].matricule]);
          }
        })
        .catch(() => {
          API.listerComptes().then((tous) => {
            if (!annule) {
              const liste = (tous ?? []).filter((c) => c.rang === 'reg');
              setComptes(liste);
              if (liste[0]) setSelection([liste[0].matricule]);
            }
          });
        });
      return () => { annule = true; };
    }

    API.listerCmndRegionConflit(conflitEffectif?.id, {
      barrageAId: bA?.id,
      barrageBId: bB?.id,
      regA,
      regB,
    })
      .then((res) => {
        if (!annule) {
          const liste = res.comptes ?? [];
          setComptes(liste);

          // Pré-sélection automatique des régions concernées
          // Règle BFI vs BF : Le BFI est intouchable, assigner exclusivement au CMD Région du BF !
          const conc = liste.filter((c) => {
            if (intA && !intB) return c.concerneB;
            if (intB && !intA) return c.concerneA;
            return c.duConflit;
          });
          if (conc.length > 0) {
            setSelection(conc.map((c) => c.matricule));
          } else if (liste[0]) {
            setSelection([liste[0].matricule]);
          }
        }
      })
      .catch((err) => {
        if (annule) return;
        // Repli automatique : charger les comptes via /api/comptes directement
        API.listerComptes()
          .then((tous) => {
            if (annule) return;
            const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const matchReg = (unite, cible) => Boolean(unite && cible && (norm(unite) === norm(cible) || norm(unite).includes(norm(cible)) || norm(cible).includes(norm(unite))));

            const liste = (tous ?? [])
              .filter((c) => c.rang === 'reg')
              .map((c) => {
                const concerneA = Boolean(regA && (matchReg(c.unite, regA) || matchReg(c.reg, regA)));
                const concerneB = Boolean(regB && (matchReg(c.unite, regB) || matchReg(c.reg, regB)));
                let roleConflit = null;
                let duConflit = false;

                if (intA && !intB) {
                  duConflit = concerneB;
                  if (concerneB) roleConflit = `Barrage BF (${bB?.nom || bB?.id || 'BF'}) — À traiter`;
                  else if (concerneA) roleConflit = `Barrage BFI (${bA?.nom || bA?.id || 'BFI'}) — Intouchable`;
                } else if (intB && !intA) {
                  duConflit = concerneA;
                  if (concerneA) roleConflit = `Barrage BF (${bA?.nom || bA?.id || 'BF'}) — À traiter`;
                  else if (concerneB) roleConflit = `Barrage BFI (${bB?.nom || bB?.id || 'BFI'}) — Intouchable`;
                } else {
                  duConflit = Boolean(concerneA || concerneB);
                  if (concerneA && concerneB) roleConflit = 'Barrages A & B';
                  else if (concerneA) roleConflit = `Barrage A (${bA?.nom || bA?.id || 'A'})`;
                  else if (concerneB) roleConflit = `Barrage B (${bB?.nom || bB?.id || 'B'})`;
                }

                return {
                  matricule: c.matricule,
                  nom: c.nom,
                  unite: c.unite,
                  region: c.unite,
                  duConflit,
                  concerneA,
                  concerneB,
                  estBfiRegion: (intA && !intB && concerneA) || (intB && !intA && concerneB),
                  roleConflit,
                };
              })
              .sort((a, b) => Number(b.duConflit) - Number(a.duConflit) || a.unite.localeCompare(b.unite, 'fr'));

            setComptes(liste);
            setErreur(null);

            const conc = liste.filter((c) => {
              if (intA && !intB) return c.concerneB;
              if (intB && !intA) return c.concerneA;
              return c.duConflit;
            });
            if (conc.length > 0) {
              setSelection(conc.map((c) => c.matricule));
            } else if (liste[0]) {
              setSelection([liste[0].matricule]);
            }
          })
          .catch(() => {
            if (!annule) setErreur(err?.message ?? 'Erreur lors du chargement des commandants de région.');
          });
      });

    return () => {
      annule = true;
    };
  }, [conflit, conflits, bA?.id, bB?.id, regA, regB, intA, intB, estGroupe]);

  if (!conflitEffectif && !estGroupe) return null;

  const distance = Number(conflitEffectif?.distanceKm ?? conflitEffectif?.avantKm ?? conflitEffectif?.km ?? 0);
  const temps = conflitEffectif?.tempsMinutes ?? (distance > 0 ? Math.max(1, Math.round(distance * 1.1)) : null);
  const route = conflitEffectif?.route || bA?.route || bB?.route || 'Axe routier';
  const faction = conflitEffectif?.factionLibelle || (conflitEffectif?.factions?.length ? conflitEffectif.factions.join(' · ') : 'Toutes factions');
  const motif = conflitEffectif?.motif || (distance > 0 ? `Distance routière de ${distance.toFixed(1)} km inférieure au seuil réglementaire.` : 'Conflit de proximité');

  const toggleMatricule = (matricule) => {
    setSelection((prev) =>
      prev.includes(matricule)
        ? prev.filter((m) => m !== matricule)
        : [...prev, matricule]
    );
  };

  const selectionnerTousConcernes = () => {
    if (!comptes) return;
    const conc = comptes.filter((c) => {
      if (intA && !intB) return c.concerneB;
      if (intB && !intA) return c.concerneA;
      return c.duConflit;
    }).map((c) => c.matricule);
    if (conc.length > 0) setSelection(conc);
  };

  const selectionnerUniquement = (regionNom) => {
    if (!comptes) return;
    const cible = comptes.find((c) => c.unite === regionNom);
    if (cible) setSelection([cible.matricule]);
  };

  const valider = async () => {
    if (!selection || selection.length === 0 || envoi) return;
    setEnvoi(true);
    setErreur(null);

    const comptesChoisis = (comptes || []).filter((c) => selection.includes(c.matricule));

    try {
      if (estGroupe) {
        await onConfirmer({
          conflitIds: conflits.map((c) => c.id || c.numero).filter(Boolean),
          matricule: selection[0],
          matricules: selection,
          consigne: consigne.trim(),
          conflitsData: conflits,
          destinataire: comptesChoisis[0] ?? null,
          destinataires: comptesChoisis,
        });
        onClose();
        return;
      }

      await onConfirmer({
        conflitId: conflitEffectif.id,
        matricule: selection[0],
        matricules: selection,
        consigne: consigne.trim(),
        conflitData: {
          id: conflitEffectif.id,
          numero: conflitEffectif.numero || conflitEffectif.id,
          paireCle: conflitEffectif.paireCle || (bA?.id && bB?.id ? (bA.id < bB.id ? `${bA.id}|${bB.id}` : `${bB.id}|${bA.id}`) : null),
          barrageAId: bA?.id,
          barrageBId: bB?.id,
          a: bA,
          b: bB,
          distanceKm: distance,
          seuilKm: conflitEffectif.seuilKm ?? 20,
          route,
          factionId: conflitEffectif.factionId,
          factionsCommunes: conflitEffectif.factions ?? (conflitEffectif.factionId ? [conflitEffectif.factionId] : []),
          motif,
          estInterRegion,
          regA,
          regB,
        },
        destinataire: comptesChoisis[0] ?? null,
        destinataires: comptesChoisis,
      });
      onClose();
    } catch (err) {
      setErreur(err?.message ?? 'L’assignation n’a pas pu être enregistrée.');
    } finally {
      setEnvoi(false);
    }
  };

  const nbSelectionnes = selection.length;

  return (
    <div
      role="presentation"
      onClick={() => !envoi && onClose()}
      className="fixed inset-0 z-[3000] grid place-items-center bg-black/65 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-modal-assigner-conflit-titre"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(540px,100%)] rounded-2xl border border-white/15 bg-gr-navy p-5 text-white shadow-2xl space-y-4 my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-[12px] font-bold text-red-300 border border-red-500/30">
                {estGroupe ? `${conflits.length} CONFLITS` : (conflitEffectif?.id || conflitEffectif?.numero)}
              </span>
              <h2 id="gr-modal-assigner-conflit-titre" className="text-[15px] font-bold">
                {estGroupe ? 'Assigner les conflits sélectionnés au CMD_REGION' : 'Assigner le conflit au CMD_REGION'}
              </h2>
            </div>
            <p className="mt-1 text-[11.5px] text-white/55">
              Déléguer la responsabilité opérationnelle aux Commandants de Région concernés.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={envoi}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* Résumé du ou des conflits sélectionnés */}
        {estGroupe ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] space-y-2">
            <div className="flex items-center justify-between text-white/90 font-bold">
              <span>{conflits.length} conflits sélectionnés pour assignation :</span>
              <span className="text-amber-300 font-mono text-[11px]">{conflits.length} au total</span>
            </div>
            <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto pt-1">
              {conflits.map((c) => (
                <span key={c.id || c.numero} className="font-mono text-[10px] bg-white/10 text-white/80 border border-white/20 rounded px-1.5 py-0.2">
                  {c.numero || c.id} ({c.route || 'Route'})
                </span>
              ))}
            </div>
          </div>
        ) : (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] space-y-2.5">
          <div className="flex items-center justify-between text-white/90">
            <div className="max-w-[46%] truncate">
              <span className="font-semibold text-white block truncate" title={bA?.nom}>
                {bA?.nom || bA?.id}
              </span>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {regA && (
                  <span className="text-[10px] font-bold text-sky-300 block">
                    Région : {regA}
                  </span>
                )}
                {intA && (
                  <span className="rounded bg-amber-500/25 px-1.5 py-0.2 text-[9px] font-bold text-amber-300 border border-amber-500/40">
                    🔒 BFI (Intouchable)
                  </span>
                )}
              </div>
            </div>
            <span className="text-white/40 font-bold px-2">↔</span>
            <div className="max-w-[46%] truncate text-right">
              <span className="font-semibold text-white block truncate" title={bB?.nom}>
                {bB?.nom || bB?.id}
              </span>
              <div className="flex items-center justify-end gap-1 flex-wrap mt-0.5">
                {intB && (
                  <span className="rounded bg-amber-500/25 px-1.5 py-0.2 text-[9px] font-bold text-amber-300 border border-amber-500/40">
                    🔒 BFI (Intouchable)
                  </span>
                )}
                {regB && (
                  <span className="text-[10px] font-bold text-amber-300 block">
                    Région : {regB}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-black/30 p-2 border border-white/5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-white/50">
                Distance routière
              </span>
              <span className="font-mono text-[13px] font-bold text-amber-300">
                {distance.toFixed(1)} km
              </span>
            </div>
            <div className="rounded-lg bg-black/30 p-2 border border-white/5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-white/50">
                Temps estimé
              </span>
              <span className="font-mono text-[13px] font-bold text-sky-300">
                {temps != null ? `${temps} min` : '—'}
              </span>
            </div>
          </div>

          <div className="space-y-1 text-[11px] text-white/70">
            <div>
              <span className="text-white/45">Route :</span> <b className="text-white/90">{route}</b>
            </div>
            <div>
              <span className="text-white/45">Faction :</span> <span className="text-sky-300 font-semibold">{faction}</span>
            </div>
            <div>
              <span className="text-white/45">Motif :</span> <span className="text-red-300">{motif}</span>
            </div>
          </div>
        </div>
        )}

        {/* Bannière Règle BFI vs BF : Le BFI est intouchable, assigner exclusivement au CMD Région du BF */}
        {conflitBfiVsBf && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-amber-300">
                <span>🔒</span> Règle BFI / BF — Barrage Intouchable détecté
              </span>
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 border border-amber-400/30">
                Assignation exclusive au BF
              </span>
            </div>
            <p className="text-[11px] text-white/85 leading-relaxed">
              Le barrage <b>{intA ? (bA?.nom || bA?.id || 'A') : (bB?.nom || bB?.id || 'B')}</b> est un <b>Barrage Fixe Intouchable (BFI)</b> non modifiable.
              L'assignation est adressée <b>exclusivement</b> au commandement de la région <b className="text-emerald-300">{intA ? regB : regA}</b> (responsable du barrage modifiable <b>{intA ? (bB?.nom || bB?.id || 'B') : (bA?.nom || bA?.id || 'A')}</b>) pour traitement et repositionnement.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => selectionnerUniquement(intA ? regB : regA)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold bg-amber-400/25 border border-amber-400/60 text-amber-200 hover:bg-amber-400/35 transition-all shadow-sm"
              >
                ✓ Assigner exclusivement à la région {intA ? regB : regA}
              </button>
            </div>
          </div>
        )}

        {/* Bannière alerte Conflit Inter-Régions ordinaire (deux barrages réguliers) */}
        {estInterRegion && !conflitBfiVsBf && (
          <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-amber-300">
                <span>⚡</span> Conflit inter-régions détecté
              </span>
              <span className="rounded bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-400/30">
                2 régions impliquées
              </span>
            </div>
            <p className="text-[11px] text-white/75 leading-relaxed">
              Le barrage <b>{bA?.nom || 'A'}</b> relève de la région <b className="text-sky-300">{regA}</b> et le barrage <b>{bB?.nom || 'B'}</b> de la région <b className="text-amber-300">{regB}</b>.
              Vous pouvez assigner conjointement le traitement aux <b>deux commandants</b>.
            </p>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={selectionnerTousConcernes}
                className={`flex-1 min-w-[170px] rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-all border ${
                  nbSelectionnes >= 2
                    ? 'bg-amber-400/25 border-amber-400/60 text-amber-200 shadow-sm'
                    : 'bg-white/5 border-white/15 text-white/75 hover:bg-white/10'
                }`}
              >
                ✓ Assigner aux 2 régions (Recommandé)
              </button>
              {regA && (
                <button
                  type="button"
                  onClick={() => selectionnerUniquement(regA)}
                  className="rounded-lg px-2 py-1.5 text-[10.5px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors"
                >
                  Uniquement {regA}
                </button>
              )}
              {regB && (
                <button
                  type="button"
                  onClick={() => selectionnerUniquement(regB)}
                  className="rounded-lg px-2 py-1.5 text-[10.5px] font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-colors"
                >
                  Uniquement {regB}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Sélection des Commandants de Région */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-[11.5px] font-bold uppercase tracking-wider text-gr-gold/90">
              Commandant(s) de Région destinataire(s) :
            </label>
            <span className="text-[11px] font-mono text-white/50">
              {nbSelectionnes} sélectionné{nbSelectionnes > 1 ? 's' : ''}
            </span>
          </div>

          {!comptes && !erreur && (
            <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-white/60">
              <IconSpinner size={14} /> Chargement des Commandants de Région…
            </div>
          )}

          {(!comptes || (comptes && comptesAffiches.length === 0)) && !erreur && (
            <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-[12px] text-white/60 text-center">
              Aucun Commandant de Région disponible pour ce conflit.
            </p>
          )}

          {comptesAffiches && comptesAffiches.length > 0 && (
            <div role="group" aria-label="Commandants de Région" className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {comptesAffiches.map((c) => {
                const estSelectionne = selection.includes(c.matricule);
                const estBfi = Boolean(c.estBfiRegion);
                const roleBadge = c.roleConflit || (c.duConflit ? 'Région du conflit' : null);

                return (
                  <button
                    key={c.matricule}
                    type="button"
                    disabled={estBfi}
                    onClick={() => !estBfi && toggleMatricule(c.matricule)}
                    title={estBfi ? 'Le barrage de cette région est BFI (Intouchable), l’assignation va au barrage modifiable.' : undefined}
                    className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left text-[12px] transition-all ${
                      estBfi
                        ? 'opacity-40 cursor-not-allowed border-white/5 bg-white/5'
                        : estSelectionne
                        ? 'border-gr-gold bg-gr-gold/15 shadow-sm ring-1 ring-gr-gold/30'
                        : 'border-white/10 bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white">
                          CMND Région {c.unite}
                        </span>
                        {estBfi && (
                          <span className="rounded px-1.5 py-0.5 text-[9.5px] font-bold border bg-red-500/20 text-red-300 border-red-500/30">
                            🔒 BFI Intouchable (Non assignable)
                          </span>
                        )}
                        {!estBfi && roleBadge && (
                          <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold border ${
                            c.concerneA
                              ? 'bg-sky-400/20 text-sky-300 border-sky-400/30'
                              : c.concerneB
                              ? 'bg-amber-400/20 text-amber-300 border-amber-400/30'
                              : 'bg-emerald-400/20 text-emerald-300 border-emerald-400/30'
                          }`}>
                            {roleBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/55 mt-0.5 truncate">
                        {c.nom} <span className="font-mono text-[10px] text-white/40">({c.matricule})</span>
                      </p>
                    </div>

                    <div
                      className={`size-5 rounded-md border grid place-items-center shrink-0 transition-colors ${
                        estBfi
                          ? 'border-white/10 bg-black/10'
                          : estSelectionne
                          ? 'border-gr-gold bg-gr-gold text-gr-navy'
                          : 'border-white/30 bg-black/20'
                      }`}
                    >
                      {estSelectionne && !estBfi && (
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Consigne optionnelle */}
        <div>
          <label htmlFor="gr-consigne-assignation" className="block text-[11px] font-semibold text-white/70 mb-1">
            Consigne opérationnelle (optionnelle) :
          </label>
          <textarea
            id="gr-consigne-assignation"
            rows={2}
            value={consigne}
            onChange={(e) => setConsigne(e.target.value)}
            placeholder={
              estInterRegion
                ? "Ex : Coordination entre les 2 régions pour ajuster les positions sur l'axe commun."
                : "Ex : Réévaluer l'espacement sur l'axe ou adapter les factions."
            }
            className="w-full resize-none rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-[12px] text-white placeholder-white/30 focus:border-gr-gold focus:outline-none"
          />
        </div>

        {erreur && (
          <p role="alert" className="flex items-start gap-1.5 text-[11.5px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            <IconAlert size={14} className="mt-0.5 shrink-0" />
            <span>{erreur}</span>
          </p>
        )}

        <footer className="flex items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-[11px] text-white/45">
            {nbSelectionnes === 0
              ? 'Aucune région choisie'
              : nbSelectionnes === 1
              ? '1 région assignée'
              : `${nbSelectionnes} régions assignées conjointement`}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={envoi}
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-[12px] font-semibold text-white/70 hover:bg-white/10 transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={nbSelectionnes === 0 || envoi}
              onClick={valider}
              className="flex items-center gap-2 rounded-lg bg-gr-gold px-4 py-2 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
            >
              {envoi && <IconSpinner size={13} />}
              <span>
                {nbSelectionnes > 1
                  ? `Confirmer l’assignation (${nbSelectionnes} régions)`
                  : 'Confirmer l’assignation'}
              </span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
