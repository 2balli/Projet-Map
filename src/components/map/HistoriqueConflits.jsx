import { useCallback, useEffect, useState } from 'react';
import * as API from '../../api.js';
import { IconSpinner, IconTerritoire } from '../../icons.jsx';

/**
 * HISTORIQUE DES CONFLITS — définitivement approuvés par le Superadmin.
 *
 * Lecture seule pour tous : le serveur ne laisse aucune route modifier un
 * conflit clos (voir serveur/workflowConflits.mjs). Seule exception, la
 * correction exceptionnelle du Superadmin — réouverture, motif obligatoire,
 * consignée au journal d'audit.
 *
 * Chaque fiche garde tout le parcours : traitement, décisions successives,
 * motifs des refus antérieurs, changements effectués.
 */

const LIBELLES_TRANSITION = {
  soumission: 'Traitement soumis',
  resoumission: 'Traitement corrigé et resoumis',
  approbation_region: 'Validé par le CMD Région',
  refus_region: 'Refusé par le CMD Région',
  approbation_superadmin: 'Approuvé définitivement par le Superadmin',
  refus_superadmin: 'Refusé par le Superadmin',
  reouverture_superadmin: 'Rouvert par le Superadmin (correction)',
};

const date = (iso) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const qui = (p) => (p ? p.nom || [p.rang === 'reg' ? 'CMD Région' : p.rang === 'cie' ? 'CMD Cie' : p.rang === 'admin' ? 'Superadmin' : p.rang, p.unite].filter(Boolean).join(' ') : '—');

const FILTRES_VIDES = { du: '', au: '', region: '', compagnie: '', brigade: '', faction: '', intervenant: '' };
const champ =
  'w-full rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[11px] text-text-primary placeholder:text-text-muted focus:border-gr-primary focus:outline-none';

export default function HistoriqueConflits({ session, version = 0, onVoirSurCarte = null, onRouvert = null }) {
  const [filtres, setFiltres] = useState(FILTRES_VIDES);
  const [appliques, setAppliques] = useState(FILTRES_VIDES);
  const [items, setItems] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [ouverts, setOuverts] = useState({});
  const [reouverture, setReouverture] = useState(null); // { id, motif, erreur }
  const estAdmin = session?.rang === 'admin';

  const charger = useCallback(() => {
    setItems(null);
    setErreur(null);
    API.historiqueConflits(appliques)
      .then((r) => setItems(r?.items ?? []))
      .catch((e) => {
        setErreur(e?.message ?? 'Historique indisponible.');
        setItems([]);
      });
  }, [appliques]);

  useEffect(() => {
    charger();
  }, [charger, version]);

  const rouvrir = async () => {
    try {
      await API.rouvrirConflit(reouverture.id, reouverture.motif.trim());
      setReouverture(null);
      charger();
      onRouvert?.();
    } catch (e) {
      setReouverture((r) => ({ ...r, erreur: e?.message ?? 'Réouverture refusée.' }));
    }
  };

  const nbFiltres = Object.values(appliques).filter((v) => v.trim()).length;

  return (
    <div className="space-y-2.5">
      <form
        aria-label="Filtrer l’historique"
        onSubmit={(e) => {
          e.preventDefault();
          setAppliques(filtres);
        }}
        className="space-y-1.5 rounded-xl border border-border-default bg-white/4 p-2.5"
      >
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10px] text-text-secondary">
            Du
            <input type="date" value={filtres.du} onChange={(e) => setFiltres({ ...filtres, du: e.target.value })} className={champ} />
          </label>
          <label className="text-[10px] text-text-secondary">
            Au
            <input type="date" value={filtres.au} onChange={(e) => setFiltres({ ...filtres, au: e.target.value })} className={champ} />
          </label>
          {[
            ['region', 'Région'],
            ['compagnie', 'Compagnie'],
            ['brigade', 'Brigade'],
            ['faction', 'Faction (F1…F4)'],
          ].map(([k, l]) => (
            <label key={k} className="text-[10px] text-text-secondary">
              {l}
              <input value={filtres[k]} onChange={(e) => setFiltres({ ...filtres, [k]: e.target.value })} className={champ} />
            </label>
          ))}
          <label className="col-span-2 text-[10px] text-text-secondary">
            Intervenant (nom, unité ou matricule)
            <input value={filtres.intervenant} onChange={(e) => setFiltres({ ...filtres, intervenant: e.target.value })} className={champ} />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-[10.5px] text-text-muted">
            {items ? `${items.length} conflit(s) clôturé(s)` : '…'}
            {nbFiltres > 0 && ` · ${nbFiltres} filtre(s)`}
          </span>
          <div className="flex gap-1.5">
            {nbFiltres > 0 && (
              <button
                type="button"
                onClick={() => {
                  setFiltres(FILTRES_VIDES);
                  setAppliques(FILTRES_VIDES);
                }}
                className="rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[10.5px] font-semibold text-text-secondary hover:bg-gr-hover hover:text-text-primary"
              >
                Réinitialiser
              </button>
            )}
            <button type="submit" className="rounded-lg bg-gr-primary px-2.5 py-1 text-[10.5px] font-bold text-gr-primary-contrast hover:bg-gr-primary-hover">
              Filtrer
            </button>
          </div>
        </div>
      </form>

      {erreur && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
          {erreur}
        </p>
      )}
      {items === null && (
        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-text-secondary">
          <IconSpinner size={14} /> Chargement de l’historique…
        </div>
      )}
      {items?.length === 0 && !erreur && (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center">
          <p className="text-[13px] font-bold text-text-primary">Aucun conflit clôturé</p>
          <p className="text-[11px] text-text-secondary">Les conflits approuvés définitivement par le Superadmin sont conservés ici.</p>
        </div>
      )}

      {items?.map((c) => {
        const ouvert = Boolean(ouverts[c.id]);
        const parcours = c.transitions ?? [];
        const refusAnterieurs = parcours.filter((t) => t.action?.startsWith('refus'));
        return (
          <article key={c.id} className="space-y-1.5 rounded-2xl border border-emerald-500/25 bg-gr-card/80 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-bold text-text-primary">
                  {c.numero || c.id} <span className="font-mono text-[10px] text-text-secondary">· {c.route || '—'}</span>
                </p>
                <p className="truncate text-[11px] text-text-secondary">
                  {c.barrageA?.nom || c.barrageAId} ↔ {c.barrageB?.nom || c.barrageBId}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[9.5px] font-bold text-emerald-300">
                ✓ Clôturé
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[10.5px]">
              <dt className="text-text-muted">Traitement</dt>
              <dd className="text-text-primary">{c.decision || c.traitement?.decision || '—'}</dd>
              <dt className="text-text-muted">Traité par</dt>
              <dd className="text-text-primary">{qui(c.traitePar)} · {date(c.traiteLe)}</dd>
              <dt className="text-text-muted">Clôturé par</dt>
              <dd className="text-text-primary">{qui(c.cloturePar)} · {date(c.clotureLe)}</dd>
              {c.justification && (
                <>
                  <dt className="text-text-muted">Justification</dt>
                  <dd className="italic text-text-secondary">« {c.justification} »</dd>
                </>
              )}
              {refusAnterieurs.length > 0 && (
                <>
                  <dt className="text-text-muted">Refus antérieurs</dt>
                  <dd style={{ color: 'var(--tone-danger)' }}>{refusAnterieurs.length}</dd>
                </>
              )}
            </dl>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <button
                type="button"
                aria-expanded={ouvert}
                onClick={() => setOuverts((o) => ({ ...o, [c.id]: !ouvert }))}
                className="rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[10.5px] font-semibold text-text-secondary hover:bg-gr-hover hover:text-text-primary"
              >
                {ouvert ? 'Masquer le parcours' : `Parcours (${parcours.length} étape${parcours.length > 1 ? 's' : ''})`}
              </button>
              {onVoirSurCarte && (
                <button
                  type="button"
                  onClick={() => onVoirSurCarte(c)}
                  className="flex items-center gap-1 rounded-lg border border-border-default bg-gr-card px-2 py-1 text-[10.5px] font-semibold text-text-secondary hover:bg-gr-hover hover:text-text-primary"
                >
                  <IconTerritoire size={11} /> Voir sur la carte
                </button>
              )}
              {estAdmin && (
                <button
                  type="button"
                  onClick={() => setReouverture({ id: c.id, motif: '', erreur: null })}
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10.5px] font-semibold text-amber-300 hover:bg-amber-500/20"
                >
                  Corriger (rouvrir)
                </button>
              )}
            </div>

            {ouvert && (
              <ol className="space-y-1 border-l border-border-strong pl-2.5">
                {parcours.map((t, i) => (
                  <li key={i} className="text-[10.5px]">
                    <p className="font-semibold text-text-primary">{LIBELLES_TRANSITION[t.action] ?? t.action}</p>
                    <p className="text-text-secondary">{qui(t.auteur)} · {date(t.date)}</p>
                    {t.motif && <p className="italic text-text-secondary">« {t.motif} »</p>}
                  </li>
                ))}
                {parcours.length === 0 && <li className="text-[10.5px] text-text-muted">Conflit antérieur au workflow (migré) : voir son historique détaillé.</li>}
              </ol>
            )}

            {reouverture?.id === c.id && (
              <div className="space-y-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-2">
                <label htmlFor={`motif-reouverture-${c.id}`} className="block text-[10.5px] font-bold text-amber-300">
                  Motif de la correction (obligatoire, consigné au journal d’audit)
                </label>
                <textarea
                  id={`motif-reouverture-${c.id}`}
                  autoFocus
                  rows={2}
                  value={reouverture.motif}
                  onChange={(e) => setReouverture({ ...reouverture, motif: e.target.value })}
                  className={`${champ} resize-y`}
                />
                {reouverture.erreur && <p role="alert" className="text-[10.5px] text-red-300">{reouverture.erreur}</p>}
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setReouverture(null)}
                    className="rounded-lg border border-border-default bg-gr-card px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:bg-gr-hover"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    disabled={!reouverture.motif.trim()}
                    onClick={rouvrir}
                    className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-blanc hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Rouvrir le conflit
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
