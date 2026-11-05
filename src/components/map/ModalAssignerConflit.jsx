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
 *
 * SEUL LE CMD RÉGION CONCERNÉ est proposé : celui de la région du barrage (des
 * deux barrages pour un conflit inter-régions ; du poste ordinaire face à un
 * intouchable). Les autres régions ne sont pas listées — et le serveur les
 * refuse de toute façon (suiviConflits.assignerConflit).
 */
const normRegion = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Le compte est-il celui d'une région CONCERNÉE ? (BFI : le poste ordinaire seul) */
function estCompteConcerne(c, { estGroupe, regionsGroupe, intA, intB }) {
  if (estGroupe) return regionsGroupe.includes(normRegion(c.unite));
  if (intA && !intB) return Boolean(c.concerneB);
  if (intB && !intA) return Boolean(c.concerneA);
  return Boolean(c.duConflit);
}

export default function ModalAssignerConflit({
  conflit = null,
  conflits = null,
  onClose,
  onConfirmer,
  /** Bord gauche (px) : à droite du menu des conflits quand il est ouvert. */
  gauche = 12,
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

  /* Les régions des conflits d'une sélection groupée. */
  const regionsGroupe = useMemo(() => {
    if (!estGroupe) return [];
    const r = new Set();
    for (const c of conflits) {
      for (const b of [c.a || c.barrageA, c.b || c.barrageB]) if (b?.reg) r.add(normRegion(b.reg));
    }
    return [...r];
  }, [estGroupe, conflits]);
  const comptesAffiches = useMemo(
    () => (comptes ?? []).filter((c) => estCompteConcerne(c, { estGroupe, regionsGroupe, intA, intB })),
    [comptes, estGroupe, regionsGroupe, intA, intB],
  );

  useEffect(() => {
    let annule = false;
    if (!conflitEffectif && !estGroupe) return;

    if (estGroupe) {
      API.listerCmndRegionConflit(null)
        .then((res) => {
          if (!annule) {
            const liste = res.comptes ?? [];
            setComptes(liste);
            const conc = liste.filter((c) => regionsGroupe.includes(normRegion(c.unite)));
            if (conc.length === 1) setSelection([conc[0].matricule]);
          }
        })
        .catch(() => {
          API.listerComptes().then((tous) => {
            if (!annule) {
              const liste = (tous ?? []).filter((c) => c.rang === 'reg');
              setComptes(liste);
              const conc = liste.filter((c) => regionsGroupe.includes(normRegion(c.unite)));
              if (conc.length === 1) setSelection([conc[0].matricule]);
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
          if (conc.length > 0) setSelection(conc.map((c) => c.matricule));
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
            if (conc.length > 0) setSelection(conc.map((c) => c.matricule));
          })
          .catch(() => {
            if (!annule) setErreur(err?.message ?? 'Erreur lors du chargement des commandants de région.');
          });
      });

    return () => {
      annule = true;
    };
  }, [conflit, conflits, bA?.id, bB?.id, regA, regB, intA, intB, estGroupe, regionsGroupe]);

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

  const valider = async () => {
    const comptesChoisis = comptesAffiches.filter((c) => selection.includes(c.matricule) && !(c.estBfiRegion && !(c.concerneA && c.concerneB)));
    if (comptesChoisis.length === 0 || envoi) return;
    setEnvoi(true);
    setErreur(null);
    const matriculesChoisis = comptesChoisis.map((c) => c.matricule);

    try {
      if (estGroupe) {
        await onConfirmer({
          conflitIds: conflits.map((c) => c.id || c.numero).filter(Boolean),
          matricule: matriculesChoisis[0],
          matricules: matriculesChoisis,
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
        matricule: matriculesChoisis[0],
        matricules: matriculesChoisis,
        consigne: consigne.trim(),
        /* Conflit d'optimisation (sans état serveur) : « NEW » — refusé s'il a été
           assigné entre-temps. Conflit enregistré : son état lu, pour une
           réassignation volontaire. */
        etatAttendu: conflitEffectif.workflow?.etat ?? 'NEW',
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

  const nbSelectionnes = comptesAffiches.filter((c) => selection.includes(c.matricule)).length;
  /* Une région n'est « intouchable » (non assignable) que si elle ne porte QUE
     le BFI : quand les deux barrages sont dans la même région, c'est elle qui
     traite le BF — elle reste choisissable. */
  const regionBloquee = (c) => Boolean(c.estBfiRegion) && !(c.concerneA && c.concerneB);
  const nomA = bA?.nom || bA?.id || 'Barrage A';
  const nomB = bB?.nom || bB?.id || 'Barrage B';

  /*
   * PANNEAU COMPACT, NON BLOQUANT — même place et même allure que le panneau
   * de traitement : la carte reste visible. Mêmes règles qu'avant (région
   * concernée seule, BFI face à BF : la région du BF).
   */
  return (
    <div
      role="dialog"
      aria-labelledby="gr-modal-assigner-conflit-titre"
      onKeyDown={(e) => e.key === 'Escape' && !envoi && onClose()}
      style={{ left: gauche }}
      className="fixed top-[calc(4.5rem+var(--gr-bandeau,0px))] z-[2050] flex max-h-[calc(100dvh-5.5rem)] w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
    >
      <header className="flex items-start gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id="gr-modal-assigner-conflit-titre" className="text-[13px] font-bold">
            {estGroupe ? `Assigner ${conflits.length} conflits` : 'Assigner le conflit'}
            {!estGroupe && conflitEffectif?.numero && (
              <span className="ml-1 font-mono text-amber-300">{conflitEffectif.numero}</span>
            )}
          </h2>
          {estGroupe ? (
            <p className="truncate text-[10.5px] text-white/55">Chaque conflit va au CMD Région concerné.</p>
          ) : (
            <p className="truncate text-[10.5px] text-white/55" title={motif}>
              {route} · {distance.toFixed(1)} km{temps ? ` · ~${temps} min` : ''} · {faction}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={envoi}
          aria-label="Fermer"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconClose size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3">
        {!estGroupe && (
          <div className="flex items-stretch gap-1.5 text-[11px]">
            {[[bA, regA, intA], [bB, regB, intB]].map(([b, reg, intou], i) => (
              <div key={i} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5">
                <span className="block truncate font-semibold text-white" title={b?.nom || b?.id}>
                  {intou ? '🔒 ' : ''}{i === 0 ? nomA : nomB}
                </span>
                <span className="block truncate text-[10px] text-white/50">{intou ? 'BFI' : 'BF'} · {reg || 'région ?'}</span>
              </div>
            ))}
          </div>
        )}
        {conflitBfiVsBf && !estGroupe && (
          <p className="text-[10.5px] text-amber-300">🔒 BFI face à un BF : assigné à la région du BF ({regionBfSeule || '—'}).</p>
        )}
        {estInterRegion && !conflitBfiVsBf && !estGroupe && (
          <p className="text-[10.5px] text-sky-300">Conflit inter-régions : les deux régions peuvent être assignées.</p>
        )}
        {estGroupe && (
          <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
            {conflits.map((c) => (
              <span key={c.id || c.numero} className="rounded bg-white/10 px-1.5 font-mono text-[10px] text-white/80">{c.numero || c.id}</span>
            ))}
          </div>
        )}

        <div>
          <p className="mb-1 text-[10.5px] font-semibold text-white/55">CMD Région destinataire</p>
          {!comptes && !erreur && (
            <p className="flex items-center gap-1.5 text-[11px] text-white/55"><IconSpinner size={12} /> Chargement…</p>
          )}
          {comptes && comptesAffiches.length === 0 && !erreur && (
            <p className="text-[11px] text-white/55">Aucun CMD Région disponible pour ce conflit.</p>
          )}
          <div className="space-y-1">
            {comptesAffiches.map((c) => {
              const bloque = regionBloquee(c);
              const choisi = selection.includes(c.matricule) && !bloque;
              return (
                <button
                  key={c.matricule}
                  type="button"
                  disabled={bloque || envoi}
                  aria-pressed={choisi}
                  onClick={() => toggleMatricule(c.matricule)}
                  title={bloque ? 'Région du BFI seul : non assignable' : c.nom}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    choisi ? 'border-gr-gold bg-gr-gold/15' : 'border-white/10 bg-white/5 enabled:hover:bg-white/10'
                  } disabled:opacity-45`}
                >
                  <span className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] ${choisi ? 'border-gr-gold bg-gr-gold text-gr-navy' : 'border-white/30'}`}>
                    {choisi ? '✓' : ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-white">CMD Région {c.unite}</span>
                    <span className="block truncate text-[10px] text-white/45">{c.nom}{bloque ? ' · BFI (non assignable)' : ''}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          rows={2}
          value={consigne}
          onChange={(e) => setConsigne(e.target.value)}
          aria-label="Consigne opérationnelle (facultative)"
          placeholder="Consigne (facultative)"
          className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11.5px] text-white placeholder-white/35 focus:border-gr-gold focus:outline-none"
        />

        {erreur && (
          <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1.5 text-[11px] text-red-300">
            <IconAlert size={12} className="mt-0.5 shrink-0" />
            <span>{erreur}</span>
          </p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-1.5 border-t border-white/10 px-3 py-2">
        <button
          type="button"
          disabled={envoi}
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={nbSelectionnes === 0 || envoi}
          onClick={valider}
          className="flex items-center gap-1.5 rounded-lg bg-gr-gold px-3.5 py-1.5 text-[12px] font-bold text-gr-navy shadow-sm transition-all hover:bg-gr-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {envoi && <IconSpinner size={13} className="animate-spin" />}
          <span>{envoi ? 'Assignation…' : 'Assigner'}</span>
        </button>
      </footer>
    </div>
  );
}

