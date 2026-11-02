import { useCallback, useEffect, useState } from 'react';
import * as API from '../../api.js';
import { IconAlert, IconClose, IconSpinner } from '../../icons.jsx';

/**
 * LES ASSIGNATIONS — Super Admin → CMND Région → CMND Cie.
 *
 *   À TRAITER   les barrages assignés à CE compte (CMND Région, CMND Cie) :
 *               « Traiter » (choisir une faction autorisée) ou, pour le CMND
 *               Région, « Assigner à un CMND Cie » de sa région ;
 *   SUIVI       ce que ce compte a assigné, avec la suite donnée : traité,
 *               transmis (et à qui), en attente — date et auteur à chaque pas.
 *               Pour le Super Admin : le SUIVI DU TRAITEMENT (`SuiviWorkflow`),
 *               statut lu en base par /api/assignations/suivi — en attente, en
 *               cours, terminé — avec la dernière action et l'historique.
 *
 * Tout est décidé par le serveur (/api/assignations) : la liste des CMND Cie
 * proposés, le droit de traiter, la faction. L'écran ne fait que montrer.
 */
const quand = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};
const STATUT = {
  ouverte: { texte: 'En attente', classe: 'bg-gr-gold/15 text-gr-gold' },
  traitee: { texte: 'Traité', classe: 'bg-[#16A34A]/20 text-green-300' },
  transmise: { texte: 'Transmis', classe: 'bg-sky-400/15 text-sky-300' },
};
const qui = (d) => (d?.rang === 'reg' ? `CMND Région ${d.unite}` : d?.rang === 'cie' ? `CMND Cie ${d.unite}` : d?.unite ?? '—');
const bouton = 'rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

function Statut({ s }) {
  const x = STATUT[s] ?? STATUT.ouverte;
  return <span className={`shrink-0 rounded px-1.5 py-px text-[9.5px] font-bold ${x.classe}`}>{x.texte}</span>;
}

const STATUT_CONFLIT_UI = {
  nouveau: { texte: 'Nouveau', classe: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' },
  a_traiter: { texte: 'À traiter', classe: 'bg-amber-500/20 text-amber-300 border border-amber-500/40' },
  en_cours: { texte: 'En cours', classe: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40' },
  resolu: { texte: 'Résolu', classe: 'bg-[#16A34A]/20 text-green-300 border border-[#16A34A]/40' },
};

const ETAT = {
  en_attente: { texte: 'En attente', classe: 'bg-gr-gold/15 text-gr-gold' },
  en_cours: { texte: 'En cours', classe: 'bg-sky-400/15 text-sky-300' },
  termine: { texte: 'Terminé', classe: 'bg-[#16A34A]/20 text-green-300' },
};
const STATUT_BARRAGE = {
  en_attente: 'en attente de validation',
  approuve: 'approuvé',
  a_modifier: 'à modifier',
  annule: 'annulé',
  supprime: 'retiré',
  retire_optimisation: 'retiré par l’optimisation',
};

/**
 * LE SUIVI DU TRAITEMENT — Super Admin, lecture seule.
 *
 * Assigner au CMND Région → Traiter → Déplacer OU Changer la faction → Terminé.
 * Chaque statut vient du serveur (serveur/suiviAssignations.mjs), qui le lit
 * dans les assignations, les demandes en attente et le journal : « Terminé »
 * n'est jamais affiché avant que l'opération soit réellement enregistrée.
 * Aucun bouton n'agit sur un barrage : le Super Admin suit, il ne traite pas.
 */
function SuiviWorkflow({ version, onVoir, nomFaction }) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [filtre, setFiltre] = useState('tous');
  const [deplie, setDeplie] = useState(null);
  useEffect(() => {
    let annule = false;
    API.suiviAssignations()
      .then((r) => {
        if (!annule) {
          setDonnees(r);
          setErreur(null);
        }
      })
      .catch((e) => !annule && setErreur(e.message));
    return () => {
      annule = true;
    };
  }, [version]);

  if (erreur) return <p role="alert" className="flex gap-1.5 text-[12px] text-red-300"><IconAlert size={14} className="mt-px shrink-0" /> {erreur}</p>;
  if (!donnees) return <p className="flex items-center gap-2 text-[12px] text-white/60"><IconSpinner size={13} /> Chargement…</p>;

  const liste = filtre === 'tous' ? donnees.items : donnees.items.filter((x) => x.statut === filtre);
  return (
    <section aria-label="Suivi du traitement">
      <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">Suivi du traitement ({donnees.items.length})</h3>
      <div role="radiogroup" aria-label="Filtrer par statut" className="mb-2 grid grid-cols-4 gap-1">
        {[
          ['tous', 'Tous'],
          ['en_attente', `En attente (${donnees.totaux.en_attente})`],
          ['en_cours', `En cours (${donnees.totaux.en_cours})`],
          ['termine', `Terminés (${donnees.totaux.termine})`],
        ].map(([cle, libelle]) => (
          <button
            key={cle}
            type="button"
            role="radio"
            aria-checked={filtre === cle}
            onClick={() => setFiltre(cle)}
            className={`rounded-lg px-1 py-1.5 text-[10px] font-semibold leading-tight ${filtre === cle ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 text-white/70 hover:bg-white/14'}`}
          >
            {libelle}
          </button>
        ))}
      </div>
      {liste.length === 0 && <p className="text-[12px] text-white/55">Aucun barrage assigné{filtre !== 'tous' ? ' dans cet état' : ''}.</p>}
      <ul className="space-y-1.5">
        {liste.map((x) => {
          const e = ETAT[x.statut] ?? ETAT.en_attente;
          const ouvert = deplie === x.id;
          return (
            <li key={x.id} className="rounded-xl border border-white/10 px-2.5 py-2 text-[11.5px]">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onVoir?.({ barrageId: x.barrageId, barrage: x.barrage })} className="min-w-0 flex-1 truncate text-left font-semibold hover:text-gr-gold hover:underline">
                  {x.barrage?.nom || x.barrageId}
                </button>
                <span className={`shrink-0 rounded px-1.5 py-px text-[9.5px] font-bold ${e.classe}`}>{e.texte}</span>
              </div>
              <p className="text-white/55">
                {[x.barrage?.reg, x.barrage?.cie, x.barrage?.bt].filter(Boolean).join(' · ') || '—'}
              </p>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                <dt className="text-white/40">Responsable</dt>
                <dd className="text-white/85">{qui(x.responsable)}</dd>
                <dt className="text-white/40">Assigné le</dt>
                <dd className="text-white/85">{quand(x.assigneLe)}{x.assignePar?.nom ? ` par ${x.assignePar.nom}` : ''}</dd>
                <dt className="text-white/40">État du barrage</dt>
                <dd className="text-white/85">
                  {x.barrage?.supprime ? 'n’existe plus' : `${x.barrage?.factionId ? nomFaction(x.barrage.factionId) : 'Sans faction'}${x.barrage?.statutBarrage ? ` · ${STATUT_BARRAGE[x.barrage.statutBarrage] ?? x.barrage.statutBarrage}` : ''}`}
                </dd>
                <dt className="text-white/40">Dernière action</dt>
                <dd className="text-white/85">{x.derniereAction?.libelle}{x.derniereAction?.par ? ` — ${x.derniereAction.par}` : ''}</dd>
                <dt className="text-white/40">Modifié le</dt>
                <dd className="text-white/85">{quand(x.derniereModification)}</dd>
              </dl>
              {x.statut === 'en_cours' && x.demandesEnAttente > 0 && (
                <p className="mt-1 text-[10.5px] text-sky-300">{x.demandesEnAttente} demande{x.demandesEnAttente > 1 ? 's' : ''} en attente de validation.</p>
              )}
              {x.sansModification && <p className="mt-1 text-[10.5px] text-white/50">Clôturé sans modification du barrage.</p>}
              <button
                type="button"
                aria-expanded={ouvert}
                onClick={() => setDeplie(ouvert ? null : x.id)}
                className="mt-1.5 text-[10.5px] font-semibold text-gr-gold/85 hover:text-gr-gold"
              >
                {ouvert ? 'Masquer l’historique ▴' : `Historique des opérations (${x.historique.length}) ▾`}
              </button>
              {ouvert && (
                <ol className="mt-1 space-y-0.5 border-l border-white/12 pl-2.5">
                  {x.historique.map((h, i) => (
                    <li key={`${h.date}-${i}`} className="text-[10.5px] text-white/65">
                      <span className="font-mono text-white/40">{quand(h.date)}</span> · <span className={h.effective ? 'text-white/90' : ''}>{h.libelle}</span>{h.par ? ` — ${h.par}` : ''}
                    </li>
                  ))}
                  {x.historique.length === 0 && <li className="text-[10.5px] text-white/45">Aucune opération enregistrée.</li>}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** « Assigner à un CMND Cie » — seulement les comptes que le serveur autorise. */
function TransmettreCie({ assignation, onFait, onFermer }) {
  const [comptes, setComptes] = useState(null);
  const [choix, setChoix] = useState(null);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    API.cmndCieAssignation(assignation.id).then((r) => {
      setComptes(r.comptes);
      if (r.comptes?.length > 0) {
        const duBarrage = r.comptes.find((c) => c.duBarrage) || r.comptes[0];
        setChoix(duBarrage.matricule);
      }
    }).catch((e) => setErreur(e.message));
  }, [assignation.id]);
  const confirmer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      await API.transmettreAssignation(assignation.id, choix, texte.trim());
      onFait();
    } catch (e) {
      setErreur(e.message);
      setOccupe(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/55 p-4" role="presentation" onClick={() => !occupe && onFermer()}>
      <div role="dialog" aria-modal="true" aria-labelledby="gr-transmettre-titre" onClick={(e) => e.stopPropagation()} className="w-[min(420px,100%)] rounded-2xl border border-white/10 bg-gr-navy p-4 text-white shadow-panel">
        <h2 id="gr-transmettre-titre" className="text-[14px] font-bold">Assigner à un CMND Cie</h2>
        <p className="text-[12px] text-white/60">
          {assignation.barrage?.nom} {assignation.barrage?.cie ? `· Compagnie rattachée : CMND Cie ${assignation.barrage.cie}` : ''}
        </p>
        {!comptes && !erreur && <p className="mt-3 flex items-center gap-2 text-[12px] text-white/60"><IconSpinner size={13} /> Chargement…</p>}
        {comptes && comptes.length === 0 && <p className="mt-3 text-[12px] text-white/60">Aucun compte CMND Cie autorisé pour ce barrage.</p>}
        {comptes && comptes.length > 0 && (
          <div role="radiogroup" aria-label="Compagnie du barrage" className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
            {comptes.map((c) => (
              <button
                key={c.matricule}
                type="button"
                role="radio"
                aria-checked={choix === c.matricule}
                onClick={() => setChoix(c.matricule)}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${choix === c.matricule ? 'border-gr-gold bg-gr-gold/15' : 'border-white/12 hover:bg-white/8'}`}
              >
                <span className="font-semibold">CMND Cie {c.unite}</span>
                <span className="text-white/50">{c.nom}</span>
                {c.duBarrage && <span className="ml-auto rounded bg-white/10 px-1 text-[9.5px] font-bold">compagnie du barrage</span>}
              </button>
            ))}
          </div>
        )}
        <label className="mt-3 block">
          <span className="mb-1 block text-[11.5px] font-semibold text-white/70">Consigne (facultative)</span>
          <textarea rows={2} value={texte} onChange={(e) => setTexte(e.target.value)} className="w-full resize-none rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-[12.5px] text-white" />
        </label>
        {erreur && <p role="alert" className="mt-2 flex gap-1.5 text-[12px] text-red-300"><IconAlert size={14} className="mt-px shrink-0" /> {erreur}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" disabled={occupe} onClick={onFermer} className={`${bouton} text-white/70 hover:bg-white/8`}>Annuler</button>
          <button type="button" disabled={!choix || occupe} onClick={confirmer} className={`${bouton} bg-gr-gold text-gr-navy`}>
            {occupe && <IconSpinner size={12} />} Confirmer l’assignation
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AssignationsPanel({
  open,
  onClose,
  session,
  factions,
  version = 0,
  onTraiter,
  onVoir,
  onCompte,
  onAssignerConflit,
}) {
  const [donnees, setDonnees] = useState(null);
  const [conflitsData, setConflitsData] = useState(null);
  const [onglet, setOnglet] = useState('assignations'); // 'assignations' | 'conflits'
  const [filtreConflit, setFiltreConflit] = useState('tous'); // 'tous' | 'a_traiter' | 'en_cours' | 'resolu'
  const [historiquesOuverts, setHistoriquesOuverts] = useState({});
  const [erreur, setErreur] = useState(null);
  const [transmettre, setTransmettre] = useState(null);

  const toggleHistorique = (id) => setHistoriquesOuverts((p) => ({ ...p, [id]: !p[id] }));

  const recharger = useCallback(() => {
    API.listerAssignations()
      .then((r) => {
        setDonnees(r);
        setErreur(null);
        onCompte?.(r.aTraiter.length);
      })
      .catch((e) => setErreur(e.message));

    API.listerConflits()
      .then((c) => setConflitsData(c))
      .catch(() => {});
  }, [onCompte]);

  useEffect(() => {
    if (session) recharger();
  }, [session, open, version, recharger]);

  if (!open) return null;
  const nomFaction = (id) => factions?.factions?.find((f) => f.id === id)?.nom ?? 'aucune';
  const region = session?.rang === 'reg';

  const conflitsFiltres = (conflitsData?.items ?? []).filter((c) => {
    if (filtreConflit === 'tous') return true;
    return c.statut === filtreConflit;
  });

  return (
    <aside aria-label="Assignations et conflits" className="pointer-events-auto flex max-h-[calc(100dvh-7rem)] w-[min(420px,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-md">
      <header className="flex items-center gap-2.5 border-b border-white/10 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-bold leading-tight">Commandement opérationnel</h2>
          <p className="text-[10.5px] text-white/45">
            {session?.rang === 'admin' ? 'Super Admin · suivi des barrages et conflits' : region ? `CMND Région ${session.unite}` : `CMND Cie ${session?.unite ?? ''}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white">
          <IconClose size={15} />
        </button>
      </header>

      {/* Onglets de navigation entre Assignations et Conflits pour tous les rôles */}
      <div className="flex border-b border-white/10 bg-white/5 p-1 text-[11.5px]">
        <button
          type="button"
          onClick={() => setOnglet('assignations')}
          className={`flex-1 rounded-lg py-1.5 text-center font-semibold transition-colors ${
            onglet === 'assignations'
              ? 'bg-gr-gold text-gr-navy font-bold shadow-sm'
              : 'text-white/60 hover:bg-white/5 hover:text-white'
          }`}
        >
          {session?.rang === 'admin' ? 'Suivi des barrages' : `Assignations (${donnees?.aTraiter?.length ?? 0})`}
        </button>
        <button
          type="button"
          onClick={() => setOnglet('conflits')}
          className={`flex-1 rounded-lg py-1.5 text-center font-semibold transition-colors flex items-center justify-center gap-1.5 ${
            onglet === 'conflits'
              ? 'bg-gr-gold text-gr-navy font-bold shadow-sm'
              : 'text-white/60 hover:bg-white/5 hover:text-white'
          }`}
        >
          <span>{session?.rang === 'admin' ? 'Suivi des conflits' : 'Conflits détectés'}</span>
          {conflitsData?.items?.filter((c) => c.statut !== 'resolu')?.length > 0 && (
            <span className="rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[10px] font-bold text-amber-200">
              {conflitsData.items.filter((c) => c.statut !== 'resolu').length}
            </span>
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3">
        {!donnees && !erreur && <p className="flex items-center gap-2 text-[12px] text-white/60"><IconSpinner size={13} /> Chargement…</p>}
        {erreur && <p role="alert" className="flex gap-1.5 text-[12px] text-red-300"><IconAlert size={14} className="mt-px shrink-0" /> {erreur}</p>}

        {/* VUE CONFLITS DÉTECTÉS (CMD_REGION, CMD_COMPAGNIE & SUPERADMIN) */}
        {onglet === 'conflits' && (
          <section aria-label="Conflits routiers détectés" className="space-y-2">
            <div className="flex flex-wrap items-center gap-1">
              {[
                { cle: 'tous', libelle: 'Tous' },
                { cle: 'a_traiter', libelle: 'À traiter' },
                { cle: 'en_cours', libelle: 'En cours' },
                { cle: 'resolu', libelle: 'Résolu' },
              ].map((f) => (
                <button
                  key={f.cle}
                  type="button"
                  onClick={() => setFiltreConflit(f.cle)}
                  className={`rounded-md px-2 py-1 text-[10.5px] font-semibold transition-colors ${
                    filtreConflit === f.cle
                      ? 'bg-white/20 text-white font-bold'
                      : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {f.libelle}
                </button>
              ))}
            </div>

            {conflitsFiltres.length === 0 && (
              <p className="rounded-xl border border-white/5 bg-white/5 p-3 text-[12px] text-white/50 text-center">
                Aucun conflit dans cette catégorie pour votre commandement.
              </p>
            )}

            <ul className="space-y-2">
              {conflitsFiltres.map((c) => {
                const badge = STATUT_CONFLIT_UI[c.statut] ?? STATUT_CONFLIT_UI.nouveau;
                const ouvert = Boolean(historiquesOuverts[c.id]);
                const bA = c.barrageA;
                const bB = c.barrageB;

                return (
                  <li key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-2.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-amber-300">
                        {c.route ? `Route ${c.route}` : 'Axe routier'}
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${badge.classe}`}>
                        {badge.texte}
                      </span>
                    </div>

                    <p className="mt-1 font-semibold text-white/90">
                      {bA?.nom || c.barrageAId} ↔ {bB?.nom || c.barrageBId}
                    </p>

                    <p className="mt-0.5 text-[11px] text-white/50">
                      {[bA?.cie, bA?.reg].filter(Boolean).join(' · ')} / {[bB?.cie, bB?.reg].filter(Boolean).join(' · ')}
                    </p>

                    <div className="mt-1.5 rounded-lg border border-white/10 bg-black/20 p-2 text-[11px] space-y-0.5">
                      <p className="font-mono text-amber-200">
                        Distance routière : <b className="text-white">{c.distanceKm} km</b> (seuil : {c.seuilKm} km)
                      </p>
                      {c.factionsCommunes?.length > 0 && (
                        <p className="text-white/60">
                          Faction(s) en cause : {c.factionsCommunes.join(', ')}
                        </p>
                      )}
                    </div>

                    {/* Information d'assignation au CMD_REGION */}
                    {c.assigneA && (
                      <div className="mt-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 p-2 text-[11px] text-sky-200 space-y-0.5">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Responsable : CMND Région {c.assigneA.unite}</span>
                          {c.assigneLe && <span className="text-[10px] text-white/50">{quand(c.assigneLe)}</span>}
                        </div>
                        {c.assigneA.nom && (
                          <p className="text-[10.5px] text-white/65">{c.assigneA.nom} ({c.assigneA.matricule})</p>
                        )}
                      </div>
                    )}

                    {/* Dernière action effectuée */}
                    {c.historique?.length > 0 && (
                      <p className="mt-1 text-[10.5px] text-white/50">
                        Dernière action : <b className="text-white/80">{c.historique[c.historique.length - 1].action}</b> ({quand(c.historique[c.historique.length - 1].date)})
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onVoir?.({
                            barrageId: c.barrageAId,
                            barrage: bA,
                            criteres: {
                              conflitId: c.id,
                              conflitNumero: c.numero || c.id,
                              voisinId: c.barrageBId,
                              voisinNom: bB?.nom,
                              distanceKm: c.distanceKm,
                              seuilKm: c.seuilKm,
                              route: c.route,
                              motif: c.motif,
                              factions: c.factionsCommunes,
                            },
                          })
                        }
                        className={`${bouton} w-full border border-amber-400/40 bg-amber-500/15 font-semibold text-amber-200 hover:bg-amber-500/25 flex items-center justify-center gap-1.5`}
                      >
                        <span>👁 Voir le tracé du conflit sur la carte</span>
                      </button>

                      {session?.rang === 'admin' && c.statut !== 'resolu' && (
                        <button
                          type="button"
                          onClick={() => onAssignerConflit?.(c)}
                          className={`${bouton} w-full bg-gr-gold font-bold text-gr-navy hover:bg-gr-gold/90 shadow-sm`}
                        >
                          ➜ {c.assigneA ? 'Réassigner à un CMD_REGION' : 'Assigner le conflit au CMD_REGION'}
                        </button>
                      )}

                      {session?.rang !== 'admin' && c.statut !== 'resolu' && (
                        <>
                          <button
                            type="button"
                            onClick={() => onTraiter?.({ barrageId: c.barrageAId, barrage: bA }, recharger)}
                            className={`${bouton} flex-1 bg-gr-gold font-bold text-gr-navy hover:bg-gr-gold/90`}
                          >
                            Traiter le barrage
                          </button>
                          {region && (
                            <button
                              type="button"
                              onClick={() => setTransmettre({ barrageId: c.barrageAId, barrage: bA, id: c.id })}
                              className={`${bouton} flex-1 border border-sky-400/40 bg-sky-500/20 font-semibold text-sky-200 hover:bg-sky-500/30`}
                            >
                              Assigner Cie
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Accordéon Historique du conflit */}
                    <div className="mt-2 border-t border-white/10 pt-1.5">
                      <button
                        type="button"
                        onClick={() => toggleHistorique(c.id)}
                        className="flex w-full items-center justify-between text-[10.5px] font-semibold text-white/60 hover:text-white"
                      >
                        <span>Historique du conflit ({c.historique?.length || 1})</span>
                        <span>{ouvert ? '▴' : '▾'}</span>
                      </button>

                      {ouvert && (
                        <div className="mt-1.5 space-y-1.5 rounded-lg border border-white/5 bg-black/30 p-2 text-[10.5px]">
                          {(c.historique ?? []).map((h, idx) => (
                            <div key={idx} className="border-b border-white/5 pb-1 last:border-b-0 last:pb-0">
                              <div className="flex items-center justify-between text-white/40">
                                <span>{quand(h.date)}</span>
                                <span className="font-semibold text-gr-gold/80">{h.action}</span>
                              </div>
                              <p className="mt-0.5 text-white/80">{h.commentaire}</p>
                              {h.auteur?.nom && (
                                <p className="text-[9.5px] text-white/40">Par : {h.auteur.nom} ({h.auteur.unite || h.auteur.rang})</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* VUE ASSIGNATIONS HABITUELLE */}
        {onglet === 'assignations' && donnees && session?.rang !== 'admin' && (
          <section aria-label="Barrages à traiter">
            <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">À traiter ({donnees.aTraiter.length})</h3>
            {donnees.aTraiter.length === 0 && <p className="text-[12px] text-white/55">Aucun barrage ne vous est assigné.</p>}
            <ul className="space-y-1.5">
              {donnees.aTraiter.map((a) => (
                <li key={a.id} className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onVoir?.(a)} className="min-w-0 flex-1 truncate text-left font-semibold hover:text-gr-gold hover:underline">{a.barrage?.nom}</button>
                    <Statut s={a.statut} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/55">
                    {a.barrage?.route || '—'} · faction {nomFaction(a.barrage?.factionId)} · assigné par {a.auteur?.nom || a.auteur?.unite} le {quand(a.cree)}
                  </p>
                  <div className="mt-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2 text-[11.5px]">
                    <p className="flex items-center gap-1.5 font-bold text-amber-300">
                      <IconAlert size={13} className="shrink-0" /> Problème signalé :
                    </p>
                    <p className="mt-0.5 text-white/90">
                      {a.texte || 'Conflit de distance routière ou espacement signalé pour traitement.'}
                    </p>
                    {a.criteres?.distanceKm != null && (
                      <p className="mt-1 font-mono text-[10.5px] text-amber-200">
                        Distance mesurée : {a.criteres.distanceKm} km {a.criteres.seuilKm ? `(seuil réglementaire ${a.criteres.seuilKm} km)` : ''} {a.criteres.voisinNom ? `· Voisin : ${a.criteres.voisinNom}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onVoir?.(a)}
                      className={`${bouton} w-full border border-amber-400/40 bg-amber-500/15 font-semibold text-amber-200 hover:bg-amber-500/25 flex items-center justify-center gap-1.5`}
                    >
                      <span>👁 Voir le conflit et la route sur la carte</span>
                    </button>
                    <button type="button" onClick={() => onTraiter?.(a, recharger)} className={`${bouton} flex-1 bg-gr-gold font-bold text-gr-navy hover:bg-gr-gold/90`}>Traiter</button>
                    {region && (
                      <button type="button" onClick={() => setTransmettre(a)} className={`${bouton} flex-1 border border-sky-400/40 bg-sky-500/20 font-semibold text-sky-200 hover:bg-sky-500/30`}>Assigner au CMND Cie</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {onglet === 'assignations' && session?.rang === 'admin' && (
          <SuiviWorkflow version={version} onVoir={onVoir} nomFaction={nomFaction} />
        )}

        {donnees && session?.rang !== 'admin' && (
          <section aria-label="Suivi des assignations">
            <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">Suivi de mes assignations ({donnees.suivi.length})</h3>
            {donnees.suivi.length === 0 && <p className="text-[12px] text-white/55">Vous n’avez encore rien assigné.</p>}
            <ul className="space-y-1.5">
              {donnees.suivi.map((a) => (
                <li key={a.id} className="rounded-xl border border-white/10 px-2.5 py-2 text-[11.5px]">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onVoir?.(a)} className="min-w-0 flex-1 truncate text-left font-semibold hover:text-gr-gold hover:underline">{a.barrage?.nom}</button>
                    <Statut s={a.statut} />
                  </div>
                  <p className="text-white/55">→ {qui(a.destinataire)} · {quand(a.cree)}</p>
                  {a.statut !== 'ouverte' && (
                    <p className="text-white/55">{a.statut === 'transmise' ? 'Transmis' : 'Traité'} par {a.traiteePar?.nom || a.traiteePar?.unite} le {quand(a.traiteeLe)}{a.reponse ? ` — ${a.reponse}` : ''}</p>
                  )}
                  {a.suite.map((x) => (
                    <p key={x.id} className="ml-3 text-white/55">
                      ↳ {qui(x.destinataire)} : <Statut s={x.statut} />{x.traiteeLe ? ` ${quand(x.traiteeLe)}${x.reponse ? ` — ${x.reponse}` : ''}` : ''}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {transmettre && (
        <TransmettreCie
          assignation={transmettre}
          onFermer={() => setTransmettre(null)}
          onFait={() => {
            setTransmettre(null);
            recharger();
          }}
        />
      )}
    </aside>
  );
}
