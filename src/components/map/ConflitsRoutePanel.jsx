import { useEffect, useRef } from 'react';
import { IconAlert, IconSpinner, IconRestaurer } from '../../icons.jsx';

/**
 * LES CONFLITS DU CORRIDOR — la liste à côté de la carte.
 *
 * Tout vient de `conflits`, publié par OptimisationRoutePanel (et calculé par
 * le serveur, serveur/conflitsFaction.mjs). Un clic sur une ligne la désigne :
 * la carte cadre les deux barrages, les cerclent, trace la route qui les relie
 * et ouvre la fiche du conflit (CoucheOptimisationRoute.jsx). « ‹ › » ou les
 * flèches du clavier passent au conflit voisin sans rien perdre du reste.
 *
 * Quatre états : chargement, erreur, aucun conflit, conflits.
 */
const STATUT = {
  actif: { texte: 'À traiter', classe: 'bg-[#DC2626]/20 text-red-300' },
  en_attente: { texte: 'Traitement en validation', classe: 'bg-gr-gold/15 text-gr-gold' },
  assigne: { texte: 'Assigné au CMND Région', classe: 'bg-sky-400/15 text-sky-300' },
};
const km = (v) => `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

export default function ConflitsRoutePanel({ conflits, onAssigner, estAdmin, session }) {
  const liste = useRef(null);
  const vise = conflits?.vise ?? null;

  /* La ligne désignée (depuis la carte comme depuis la liste) reste visible. */
  useEffect(() => {
    if (!vise) return;
    liste.current?.querySelector(`[data-cle="${window.CSS?.escape ? window.CSS.escape(vise) : vise}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [vise]);

  if (!conflits) return null;
  const { etat, liste: lignes, total, seuilKm, regle, erreur, sansFaction, filtre, factions } = conflits;
  const nomFaction = (id) => factions.find((f) => f.id === id)?.libelle ?? id;
  const index = lignes.findIndex((c) => c.cle === vise);

  const assigner = onAssigner || conflits?.onAssigner || conflits?.onAssignerConflit;
  const isAdmin = estAdmin ?? (session ? session.rang === 'admin' : (conflits?.estAdmin ?? Boolean(assigner)));

  const handleAssigner = (c, e) => {
    e?.stopPropagation?.();
    if (!assigner) return;

    const trInfo = (c.cle === vise ? conflits.traceInfo : null) || conflits.traces?.[c.cle];
    const dist = Number(trInfo?.km != null ? trInfo.km : (c.km ?? 0));
    const minutes = trInfo?.minutes != null ? trInfo.minutes : (dist > 0 ? Math.max(1, Math.round(dist * 1.1)) : null);
    const route = trInfo?.routes?.length
      ? trInfo.routes.join(', ')
      : (c.a?.route || c.b?.route || 'Route sélectionnée');
    const factionLibelle = c.factions?.length > 2
      ? 'Toutes factions'
      : (c.factions?.map?.(nomFaction)?.join(' · ') || 'Même faction');

    const conflitComplet = {
      id: c.rang || c.cle || c.id || 'C-01',
      cle: c.cle,
      numero: c.rang || c.cle,
      rang: c.rang,
      a: c.a,
      b: c.b,
      barrageAId: c.a?.id,
      barrageBId: c.b?.id,
      distanceKm: dist,
      km: dist,
      tempsMinutes: minutes,
      seuilKm: seuilKm ?? 20,
      route,
      factionId: c.factions?.[0],
      factions: c.factions ?? [],
      factionLibelle,
      motif: c.raison || `Même faction (${factionLibelle}) — ${dist.toFixed(1)} km par la route, sous le seuil de ${seuilKm ?? 20} km`,
      statut: c.statut ?? 'actif',
      assigneA: c.assigneA ?? null,
    };

    assigner(conflitComplet);
  };

  const clavier = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      conflits.onPas(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      conflits.onPas(-1);
    } else if (e.key === 'Escape') conflits.onFermer();
  };

  return (
    <aside
      aria-label="Conflits du périmètre"
      className="pointer-events-auto flex max-h-[calc(100dvh-13rem)] w-[min(340px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-md"
    >
      <header className="space-y-1.5 border-b border-white/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[13px] font-bold">
            Conflits{etat === 'pret' ? ` · ${lignes.length}${filtre !== 'toutes' ? ` / ${total}` : ''}` : ''}
          </h2>
          <button
            type="button"
            onClick={conflits.onRafraichir}
            title="Relancer l’analyse des conflits"
            aria-label="Relancer l’analyse des conflits"
            className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <IconRestaurer size={13} />
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-white/55">
          Faction
          <select
            value={filtre}
            onChange={(e) => conflits.onFiltre(e.target.value)}
            aria-label="Filtrer les conflits par faction"
            className="flex-1 rounded-md border border-white/15 bg-white/6 px-2 py-1 text-[12px] text-white"
          >
            <option value="toutes">Toutes les factions</option>
            {factions.map((f) => <option key={f.id} value={f.id}>{f.libelle}</option>)}
          </select>
        </label>
        {seuilKm != null && (
          <p className="text-[10.5px] leading-snug text-white/45" title={regle ?? undefined}>
            Même faction et moins de {seuilKm} km par la route.
          </p>
        )}
      </header>

      <div ref={liste} role="listbox" aria-label="Conflits" tabIndex={0} onKeyDown={clavier} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 focus:outline-none">
        {etat === 'chargement' && (
          <p role="status" className="flex items-center gap-2 px-1.5 py-3 text-[12px] text-white/60"><IconSpinner size={13} /> Analyse des conflits…</p>
        )}
        {etat === 'erreur' && (
          <p role="alert" className="flex items-start gap-2 px-1.5 py-3 text-[12px] text-red-300"><IconAlert size={14} className="mt-px shrink-0" /> {erreur}</p>
        )}
        {etat === 'pret' && lignes.length === 0 && (
          <p role="status" className="px-1.5 py-3 text-[12px] text-white/60">Aucun conflit détecté dans ce périmètre{filtre !== 'toutes' ? ' pour cette faction' : ''}.</p>
        )}
        {etat === 'pret' && lignes.map((c) => {
          const actif = c.cle === vise;
          const s = STATUT[c.statut] ?? STATUT.actif;
          return (
            <div
              key={c.cle}
              data-cle={c.cle}
              role="option"
              aria-selected={actif}
              onClick={() => conflits.onViser(c.cle)}
              className={`mb-1 cursor-pointer rounded-xl border px-2.5 py-2 text-[12px] ${actif ? 'border-[#F43F5E] bg-[#F43F5E]/12' : 'border-white/8 hover:bg-white/6'}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] font-bold text-white/55">{c.rang}</span>
                <span className="font-semibold">{km(c.km)}</span>
                <span className="text-[10.5px] text-white/50">{c.factions.length > 2 ? 'toutes factions' : c.factions.map(nomFaction).join(' · ')}</span>
                <span className={`ml-auto rounded px-1.5 py-px text-[9.5px] font-bold ${s.classe}`}>{s.texte}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                <span className="truncate" title={c.a.nom}>{c.a.nom}</span>
                <span aria-hidden className="text-white/40">↔</span>
                <span className="truncate text-right" title={c.b.nom}>{c.b.nom}</span>
              </div>
              {actif && (
                <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[11px] text-white/80">
                  <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-white/6 p-2 text-center">
                    <div>
                      <span className="block text-[9.5px] font-bold uppercase text-white/50">Distance routière</span>
                      <span className="font-mono text-[13px] font-bold text-white">
                        {conflits.traceInfo?.km != null ? km(conflits.traceInfo.km) : km(c.km)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[9.5px] font-bold uppercase text-white/50">Temps estimé</span>
                      <span className="font-mono text-[13px] font-bold text-sky-300">
                        {conflits.traceInfo?.minutes != null ? `${conflits.traceInfo.minutes} min` : 'Temps estimé indisponible'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 rounded-lg border border-white/8 bg-black/20 p-2 text-[11px] leading-relaxed">
                    <div><span className="text-white/50">Route :</span> <b className="text-white">{conflits.traceInfo?.routes?.length ? conflits.traceInfo.routes.join(', ') : (c.a.route || 'Route sélectionnée')}</b></div>
                    <div><span className="text-white/50">Origine :</span> <span className="text-white/90">{c.a.nom}</span></div>
                    <div><span className="text-white/50">Destination :</span> <span className="text-white/90">{c.b.nom}</span></div>
                    <div><span className="text-white/50">Conflit :</span> <span className="text-red-300">{c.raison}</span></div>
                  </div>

                  {(c.a.horsCorridor || c.b.horsCorridor) && (
                    <p className="text-white/45">{c.a.horsCorridor ? c.a.nom : c.b.nom} est hors du corridor : il compte, il n’est pas optimisé.</p>
                  )}
                  <div className="flex gap-1.5 pt-0.5">
                    {[c.a, c.b].map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          conflits.onOuvrirBarrage?.(b.id);
                        }}
                        className="min-w-0 flex-1 truncate rounded-md bg-white/8 px-2 py-1 text-[11px] font-semibold hover:bg-white/14"
                        title={`Ouvrir la fiche de ${b.nom}`}
                      >
                        Ouvrir {b.nom}
                      </button>
                    ))}
                  </div>

                  {/* Assigner au CMND Région — pour le Super Admin avec le conflit complet */}
                  {isAdmin && c.statut !== 'resolu' && Boolean(assigner) && (
                    <button
                      type="button"
                      onClick={(e) => handleAssigner(c, e)}
                      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gr-gold px-2.5 py-2 text-[11.5px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors shadow-sm"
                      title="Assigner ce conflit complet au Commandant de Région"
                    >
                      ➜ {c.statut === 'assigne' || c.assigneA ? 'Réassigner au CMND Région' : 'Assigner au CMND Région'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {etat === 'pret' && sansFaction.length > 0 && (
          <div role="note" className="mt-2 rounded-xl border border-gr-gold/30 bg-gr-gold/8 px-2.5 py-2 text-[11px] text-white/75">
            <p className="flex items-center gap-1.5 font-semibold text-gr-gold"><IconAlert size={13} /> Faction absente ou inconnue ({sansFaction.length})</p>
            <p className="mt-0.5 text-white/55">Ces barrages ne sont comparés à aucun autre tant que leur faction n’est pas renseignée :</p>
            <ul className="mt-1 space-y-0.5">
              {sansFaction.map((b) => <li key={b.id} className="truncate">{b.nom}</li>)}
            </ul>
          </div>
        )}
      </div>

      {etat === 'pret' && lignes.length > 0 && (
        <footer className="flex items-center gap-2 border-t border-white/10 px-3.5 py-2">
          <button type="button" onClick={() => conflits.onPas(-1)} aria-label="Conflit précédent" className="grid size-8 place-items-center rounded-lg bg-white/8 hover:bg-white/14">
            <span aria-hidden className="text-[16px] leading-none">‹</span>
          </button>
          <span className="flex-1 text-center text-[11.5px] text-white/60">{index >= 0 ? `${index + 1} / ${lignes.length}` : `${lignes.length} conflit${lignes.length > 1 ? 's' : ''}`}</span>
          <button type="button" onClick={() => conflits.onPas(1)} aria-label="Conflit suivant" className="grid size-8 place-items-center rounded-lg bg-white/8 hover:bg-white/14">
            <span aria-hidden className="text-[16px] leading-none">›</span>
          </button>
        </footer>
      )}
    </aside>
  );
}
