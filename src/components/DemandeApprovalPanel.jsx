import { useCallback, useEffect, useState } from 'react';
import * as API from '../api.js';
import { IconAlert, IconClose, IconSpinner } from '../icons.jsx';

const STATUTS_CONFIG = {
  brouillon: { libelle: 'Brouillon', classe: 'bg-white/10 text-white/60 border-white/20' },
  en_attente_region: { libelle: 'En attente Région', classe: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  retournee_cie: { libelle: 'Retournée à la Cie', classe: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  modifiee_region: { libelle: 'Modifiée par Région', classe: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  en_attente_admin: { libelle: 'En attente Super Admin', classe: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  approuvee: { libelle: 'Approuvée', classe: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  rejetee: { libelle: 'Rejetée', classe: 'bg-red-500/20 text-red-300 border-red-500/40' },
};

const dateLisible = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * MODAL DE DIALOGUE (Commentaire / Confirmation)
 */
function ActionCommentaireModal({ titre, description, obligatoire = true, onValider, onAnnuler, occupe }) {
  const [commentaire, setCommentaire] = useState('');
  return (
    <div className="fixed inset-0 z-[3400] grid place-items-center bg-black/65 p-4" role="presentation" onClick={onAnnuler}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="w-[min(450px,100%)] rounded-2xl border border-white/10 bg-gr-navy p-5 text-white shadow-2xl space-y-3">
        <h3 className="text-[14px] font-bold tracking-wide">{titre}</h3>
        <p className="text-[12px] text-white/65">{description}</p>
        <textarea
          rows={3}
          value={commentaire}
          onChange={(e) => setCommentaire(e.target.value)}
          placeholder={obligatoire ? 'Explication obligatoire…' : 'Commentaire optionnel…'}
          className="w-full resize-none rounded-xl border border-white/12 bg-white/6 p-3 text-[12.5px] text-white placeholder-white/35 focus:border-gr-gold focus:outline-none"
        />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" disabled={occupe} onClick={onAnnuler} className="rounded-xl border border-white/12 px-3 py-1.5 text-[12px] text-white/70 hover:bg-white/8">
            Annuler
          </button>
          <button
            type="button"
            disabled={occupe || (obligatoire && !commentaire.trim())}
            onClick={() => onValider(commentaire.trim())}
            className="rounded-xl bg-gr-gold px-4 py-1.5 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 disabled:opacity-40"
          >
            {occupe ? <IconSpinner size={13} className="inline mr-1" /> : null} Confirmer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * PANNEAU DES DEMANDES D'APPROBATION
 * Workflow CMND Cie → CMND Région → Super Admin
 */
export default function DemandeApprovalPanel({
  open,
  onClose,
  session,
  factions,
  onVoirSurCarte,
  onDemandeApprouvee,
}) {
  const [demandes, setDemandes] = useState([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [selection, setSelection] = useState(null);
  const [actionEnCours, setActionEnCours] = useState(null);
  const [modalAction, setModalAction] = useState(null); // { type: 'retourner'|'rejeter'|'transmettre'|'approuver' }
  const [onglet, setOnglet] = useState('en_cours'); // 'en_cours' | 'toutes' | 'terminees'

  const recharger = useCallback(() => {
    setChargement(true);
    API.listerDemandes()
      .then((res) => {
        setDemandes(res.items || []);
        setErreur(null);
        setChargement(false);
      })
      .catch((err) => {
        setErreur(err.message || 'Erreur lors du chargement des demandes.');
        setChargement(false);
      });
  }, []);

  useEffect(() => {
    if (open) recharger();
  }, [open, recharger]);

  // Recharger le détail de la demande sélectionnée
  const chargerDetail = useCallback((id) => {
    API.obtenirDemande(id)
      .then((res) => {
        setSelection(res);
      })
      .catch((err) => {
        setErreur(err.message);
      });
  }, []);

  if (!open) return null;

  const estAdmin = session?.rang === 'admin';
  const estRegion = session?.rang === 'reg';
  const estCie = session?.rang === 'cie';

  const demandesFiltrees = demandes.filter((d) => {
    const terminee = d.statutWorkflow === 'approuvee' || d.statutWorkflow === 'rejetee';
    if (onglet === 'en_cours') return !terminee;
    if (onglet === 'terminees') return terminee;
    return true;
  });

  const executerAction = async (action, commentaire = '', changements = null) => {
    if (!selection?.demande) return;
    setActionEnCours(action);
    setErreur(null);
    try {
      const res = await API.agirDemande(selection.demande.id, {
        action,
        commentaire,
        changements,
      });
      setModalAction(null);
      setActionEnCours(null);
      recharger();
      if (res.demande) {
        setSelection((prev) => ({ ...prev, demande: res.demande }));
      }
      if (action === 'approuver') {
        onDemandeApprouvee?.(res);
      }
    } catch (err) {
      setErreur(err.message);
      setActionEnCours(null);
    }
  };

  const demandeCourante = selection?.demande;
  const rapportConflits = selection?.rapportConflits;
  const auteurEstMoi = demandeCourante?.auteurOriginal?.matricule === session?.matricule;

  return (
    <div
      className="fixed inset-0 z-[3100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-demandes-titre"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(700px,calc(100dvh-3rem))] w-[min(960px,100%)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy text-white shadow-2xl"
      >
        {/* En-tête */}
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-white/5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-gr-gold/15 text-gr-gold font-bold">
              ⚖
            </span>
            <div>
              <h2 id="gr-demandes-titre" className="text-[15px] font-bold tracking-wide">
                Workflow d'Approbation des Barrages
              </h2>
              <p className="text-[11.5px] text-white/55">
                {estAdmin ? 'Super Admin · Contrôle & Décision finale' : estRegion ? `CMND Région ${session?.unite} · Examen & Arbitrage` : `CMND Cie ${session?.unite} · Propositions`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="grid size-8 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* Corps partagé en deux colonnes : liste et détail */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Colonne gauche : liste des demandes */}
          <div className="w-[320px] shrink-0 border-r border-white/10 flex flex-col bg-white/[0.02]">
            {/* Onglets de filtrage */}
            <div className="flex border-b border-white/10 p-2 gap-1 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setOnglet('en_cours')}
                className={`flex-1 rounded-lg py-1.5 transition-colors ${
                  onglet === 'en_cours' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/6'
                }`}
              >
                En cours ({demandes.filter((d) => d.statutWorkflow !== 'approuvee' && d.statutWorkflow !== 'rejetee').length})
              </button>
              <button
                type="button"
                onClick={() => setOnglet('terminees')}
                className={`flex-1 rounded-lg py-1.5 transition-colors ${
                  onglet === 'terminees' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/6'
                }`}
              >
                Terminées
              </button>
              <button
                type="button"
                onClick={() => setOnglet('toutes')}
                className={`rounded-lg px-2 py-1.5 transition-colors ${
                  onglet === 'toutes' ? 'bg-white/12 text-white' : 'text-white/50 hover:bg-white/6'
                }`}
              >
                Toutes
              </button>
            </div>

            {/* Liste scrollable */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {chargement && (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-white/50">
                  <IconSpinner size={14} /> Chargement…
                </div>
              )}

              {!chargement && demandesFiltrees.length === 0 && (
                <p className="py-8 text-center text-[12px] text-white/45">
                  Aucune demande dans cette vue.
                </p>
              )}

              {demandesFiltrees.map((d) => {
                const conf = STATUTS_CONFIG[d.statutWorkflow] ?? STATUTS_CONFIG.brouillon;
                const estSelectionne = selection?.demande?.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => chargerDetail(d.id)}
                    className={`w-full text-left rounded-xl border p-2.5 transition-all space-y-1 ${
                      estSelectionne
                        ? 'border-gr-gold/60 bg-gr-gold/10'
                        : 'border-white/8 bg-white/4 hover:bg-white/8 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="font-semibold text-[12.5px] truncate text-white">
                        {d.barrage?.nom || d.barrageId}
                      </span>
                      <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9.5px] font-bold ${conf.classe}`}>
                        {conf.libelle}
                      </span>
                    </div>

                    <p className="text-[11px] text-white/50 truncate">
                      {d.barrage?.route ? `Route ${d.barrage.route}` : 'Axe non spécifié'} · Région {d.barrage?.reg || '—'}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-white/40 pt-0.5">
                      <span>Par {d.auteurOriginal?.nom || d.auteurOriginal?.unite || 'Inconnu'}</span>
                      <span>{dateLisible(d.maj).split(' à ')[0]}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Colonne droite : détail de la demande sélectionnée */}
          <div className="flex-1 flex flex-col min-h-0 bg-transparent overflow-y-auto p-5 space-y-4">
            {erreur && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12.5px] text-red-300">
                <IconAlert size={16} className="inline mr-1 text-red-400" /> {erreur}
              </div>
            )}

            {!demandeCourante && (
              <div className="flex flex-1 items-center justify-center text-center text-white/40 text-[13px]">
                Sélectionnez une demande dans la liste pour examiner ses modifications et décider.
              </div>
            )}

            {demandeCourante && (
              <>
                {/* Carte d'en-tête de la demande */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-[16px] font-bold text-white">
                          {demandeCourante.barrage?.nom || demandeCourante.barrageId}
                        </h3>
                        {demandeCourante.barrageId && onVoirSurCarte && (
                          <button
                            type="button"
                            onClick={() => onVoirSurCarte(demandeCourante.barrage)}
                            className="rounded bg-white/10 px-2 py-0.5 text-[10.5px] text-white/70 hover:bg-white/20"
                          >
                            Voir sur carte ↗
                          </button>
                        )}
                      </div>
                      <p className="text-[12px] text-white/60">
                        {demandeCourante.barrage?.route || 'Route'} · Région {demandeCourante.barrage?.reg || '—'} · Compagnie {demandeCourante.barrage?.cie || '—'}
                      </p>
                    </div>

                    <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                      (STATUTS_CONFIG[demandeCourante.statutWorkflow] ?? STATUTS_CONFIG.brouillon).classe
                    }`}>
                      {(STATUTS_CONFIG[demandeCourante.statutWorkflow] ?? STATUTS_CONFIG.brouillon).libelle}
                    </span>
                  </div>

                  {/* Tableau Comparatif : Valeurs AVANT (figées) vs NOUVELLES */}
                  <div className="rounded-xl border border-white/10 overflow-hidden bg-black/25">
                    <table className="w-full text-[12px]">
                      <thead className="bg-white/8 text-[10.5px] uppercase tracking-wider text-white/60">
                        <tr>
                          <th className="px-3 py-2 text-left">Propriété</th>
                          <th className="px-3 py-2 text-left">Valeur d'origine (figée)</th>
                          <th className="px-3 py-2 text-left">Proposition nouvelle</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/8">
                        {(demandeCourante.changements || []).map((c, i) => (
                          <tr key={i} className="hover:bg-white/4">
                            <td className="px-3 py-2 font-semibold text-white/80">{c.champ}</td>
                            <td className="px-3 py-2 font-mono text-white/60">
                              {c.nomAncienne || (c.ancienne != null ? String(c.ancienne) : '—')}
                            </td>
                            <td className="px-3 py-2 font-mono font-bold text-gr-gold">
                              {c.nomNouvelle || (c.nouvelle != null ? String(c.nouvelle) : '—')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {demandeCourante.raison && (
                    <div className="rounded-lg border border-white/8 bg-white/4 p-2.5 text-[12px]">
                      <span className="font-semibold text-white/70 block mb-0.5">Motif de la demande :</span>
                      <p className="italic text-white/85">{demandeCourante.raison}</p>
                    </div>
                  )}

                  {/* Auteur et date */}
                  <div className="flex items-center justify-between text-[11px] text-white/50 border-t border-white/10 pt-2">
                    <span>
                      Soumis par : <b>{demandeCourante.auteurOriginal?.nom || demandeCourante.auteurOriginal?.unite}</b> ({demandeCourante.auteurOriginal?.rang})
                    </span>
                    <span>Date : {dateLisible(demandeCourante.cree)}</span>
                  </div>
                </div>

                {/* Rapport de conflits pré-calculé */}
                {rapportConflits && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[12px] font-bold uppercase tracking-wider text-white/70">
                        Analyse de conflits de la proposition
                      </h4>
                      <span className={`rounded px-2 py-0.5 text-[10.5px] font-bold ${
                        (rapportConflits.conflits || []).length > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                        {(rapportConflits.conflits || []).length} conflit(s) détecté(s)
                      </span>
                    </div>

                    {(rapportConflits.conflits || []).length > 0 ? (
                      <div className="space-y-1.5">
                        {rapportConflits.conflits.map((c, i) => (
                          <div key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-200">
                            <div className="flex justify-between font-semibold">
                              <span>{c.barrageNom || c.barrageId}</span>
                              <span>{c.distanceKm} km (seuil {c.seuilKm} km)</span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-white/75">{c.message}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-emerald-400">
                        ✓ Aucun conflit avec les barrages voisins sous le seuil réglementaire.
                      </p>
                    )}
                  </div>
                )}

                {/* Historique chronologique d'audit */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                  <h4 className="text-[12px] font-bold uppercase tracking-wider text-white/70">
                    Historique & Traçabilité (Audit Trail)
                  </h4>
                  <ol className="relative border-l border-white/15 ml-2 space-y-3 pl-4 text-[11.5px]">
                    {(demandeCourante.historique || []).map((h, i) => (
                      <li key={i} className="relative">
                        <div className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-gr-gold" />
                        <div className="flex items-center justify-between font-semibold text-white">
                          <span>Action : « {h.action} »</span>
                          <span className="font-normal text-white/45 text-[10.5px]">{dateLisible(h.date)}</span>
                        </div>
                        <p className="text-white/60">
                          Par : {h.par?.nom || h.par?.unite || 'Utilisateur'} ({h.par?.rang})
                        </p>
                        {h.commentaire && (
                          <p className="mt-1 rounded bg-white/6 p-1.5 text-white/80 italic">
                            « {h.commentaire} »
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Barre d'actions selon le rôle */}
                {demandeCourante.statutWorkflow !== 'approuvee' && demandeCourante.statutWorkflow !== 'rejetee' && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 space-y-2">
                    <h4 className="text-[11.5px] font-bold uppercase tracking-wider text-gr-gold">
                      Actions disponibles
                    </h4>

                    {/* Alerte séparation des devoirs */}
                    {auteurEstMoi && (
                      <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2">
                        ⚖ Séparation des devoirs : Vous êtes l'auteur de cette proposition, vous ne pouvez pas l'approuver vous-même.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {/* CMND Région Actions */}
                      {estRegion && (
                        <>
                          <button
                            type="button"
                            disabled={actionEnCours !== null}
                            onClick={() => setModalAction({ type: 'modifier', titre: 'Modifier la proposition', description: 'Apportez des ajustements ou consignes avant re-soumission.' })}
                            className="rounded-xl border border-sky-400/40 bg-sky-400/15 px-3 py-2 text-[11.5px] font-bold text-sky-300 hover:bg-sky-400/25 transition-colors"
                          >
                            1. Modifier
                          </button>

                          <button
                            type="button"
                            disabled={actionEnCours !== null}
                            onClick={() => setModalAction({ type: 'retourner', titre: 'Retourner à CMND Cie', description: 'Indiquez les corrections demandées à la compagnie.' })}
                            className="rounded-xl border border-orange-500/40 bg-orange-500/15 px-3 py-2 text-[11.5px] font-bold text-orange-300 hover:bg-orange-500/25 transition-colors"
                          >
                            2. Retourner à CMND Cie
                          </button>

                          <button
                            type="button"
                            disabled={actionEnCours !== null || auteurEstMoi}
                            onClick={() => executerAction('approuver', 'Approuvé par CMND Région.')}
                            className="rounded-xl bg-emerald-500 px-3.5 py-2 text-[11.5px] font-bold text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors shadow-md"
                          >
                            3. Approuver
                          </button>

                          <button
                            type="button"
                            disabled={actionEnCours !== null}
                            onClick={() => setModalAction({ type: 'transmettre_admin', titre: 'Transmettre au Super Admin', description: 'Transmettez cette demande au Super Admin pour décision finale.' })}
                            className="rounded-xl border border-purple-400/40 bg-purple-400/15 px-3 py-2 text-[11.5px] font-bold text-purple-300 hover:bg-purple-400/25 transition-colors"
                          >
                            4. Transmettre au Super Admin
                          </button>
                        </>
                      )}

                      {/* Super Admin Actions */}
                      {estAdmin && (
                        <>
                          <button
                            type="button"
                            disabled={actionEnCours !== null || auteurEstMoi}
                            onClick={() => executerAction('approuver', 'Approuvé par Super Admin.')}
                            className="rounded-xl bg-emerald-500 px-4 py-2 text-[12px] font-bold text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors shadow-md"
                          >
                            Approuver la demande
                          </button>

                          <button
                            type="button"
                            disabled={actionEnCours !== null}
                            onClick={() => setModalAction({ type: 'retourner_region', titre: 'Retourner au CMND Région', description: 'Renvoyer la demande au commandement régional pour réexamen.' })}
                            className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-[12px] font-bold text-amber-300 hover:bg-amber-500/25 transition-colors"
                          >
                            Retourner au CMND Région
                          </button>

                          <button
                            type="button"
                            disabled={actionEnCours !== null}
                            onClick={() => setModalAction({ type: 'rejeter', titre: 'Rejeter la demande', description: 'Rejeter définitivement cette demande. Le barrage restera inchangé.' })}
                            className="rounded-xl border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-[12px] font-bold text-red-300 hover:bg-red-500/25 transition-colors"
                          >
                            Rejeter
                          </button>
                        </>
                      )}

                      {/* CMND Cie Actions (quand retournée) */}
                      {estCie && demandeCourante.statutWorkflow === 'retournee_cie' && (
                        <button
                          type="button"
                          disabled={actionEnCours !== null}
                          onClick={() => setModalAction({ type: 'resoumettre', titre: 'Corriger et Resoumettre', description: 'Précisez les corrections apportées avant renvoi au CMND Région.' })}
                          className="rounded-xl bg-gr-gold px-4 py-2 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors"
                        >
                          Corriger et Resoumettre
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal pour saisir un commentaire d'action */}
      {modalAction && (
        <ActionCommentaireModal
          titre={modalAction.titre}
          description={modalAction.description}
          obligatoire={modalAction.type === 'retourner' || modalAction.type === 'rejeter' || modalAction.type === 'retourner_region'}
          occupe={actionEnCours !== null}
          onAnnuler={() => setModalAction(null)}
          onValider={(comm) => executerAction(modalAction.type, comm)}
        />
      )}
    </div>
  );
}
