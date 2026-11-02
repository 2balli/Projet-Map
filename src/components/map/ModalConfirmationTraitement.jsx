import React, { useState } from 'react';
import { IconClose, IconCoche, IconAlert, IconTerritoire, IconSpinner } from '../../icons.jsx';

/**
 * MODALE DE CONFIRMATION DE TRAITEMENT — Map-First Experience
 * Ouvre une confirmation claire et simple avant d'exécuter une action
 * sur un conflit, en respectant les rôles, permissions et le workflow existant.
 */
export default function ModalConfirmationTraitement({
  conflit,
  session,
  numeroAffiche,
  regionAffichee,
  statutSimple,
  onClose,
  onAssignerRegion,
  onAssignerCie,
  onTraiterDirect,
  onValiderAdmin,
  onRejeterAdmin,
  onCloturerAdmin,
}) {
  const [motifRejet, setMotifRejet] = useState('');
  const [afficherChampRejet, setAfficherChampRejet] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(null);

  if (!conflit) return null;

  const rang = session?.rang;
  const estAdmin = rang === 'admin';
  const estRegion = rang === 'reg';
  const estCie = rang === 'cie';

  const etat = conflit.workflow?.etat ?? 'NEW';
  const actions = conflit.workflow?.actions ?? {};

  const bA = conflit.a || conflit.barrageA;
  const bB = conflit.b || conflit.barrageB;
  const nomA = bA?.nom || bA?.id || 'Barrage A';
  const nomB = bB?.nom || bB?.id || 'Barrage B';
  const distance = Number(conflit.distanceKm ?? conflit.km ?? 0);

  const changement = conflit.changement || conflit.traitement?.changement || {};
  const isDeplacement = changement.type === 'deplacement' || changement.apres?.lat != null;
  const isFaction = changement.type === 'changement_faction';
  const isSuppression = changement.type === 'suppression' || changement.type === 'suppression_barrage';

  const executerAction = async (fn, ...args) => {
    if (enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      await fn(...args);
      onClose?.();
    } catch (err) {
      setErreur(err?.message || 'Une erreur est survenue lors de l’opération.');
      setEnCours(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[2100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-gr-navy text-text-primary shadow-2xl space-y-4 p-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚖️</span>
            <div>
              <h3 className="text-base font-bold text-white">
                {etat === 'PENDING_VALIDATION' && estAdmin
                  ? `Validation du Conflit ${numeroAffiche}`
                  : `Traiter le Conflit ${numeroAffiche}`}
              </h3>
              <p className="text-xs text-gr-gold font-medium">📍 {regionAffichee}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Rappel concis du conflit */}
        <div className="rounded-xl bg-black/40 border border-white/5 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between text-white/90 font-medium">
            <span className="truncate">{nomA}</span>
            <span className="text-gr-gold font-bold px-2">→</span>
            <span className="truncate">{nomB}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-white/5 text-white/60">
            <span>Distance routière :</span>
            <span className="font-mono font-bold text-red-300 text-[13px]">{distance.toFixed(1)} km</span>
          </div>
          <div className="flex items-center justify-between text-white/60">
            <span>Statut :</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${statutSimple?.badgeClasse}`}>
              {statutSimple?.label}
            </span>
          </div>
        </div>

        {/* Message d'erreur s'il y a lieu */}
        {erreur && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300 flex items-center gap-2">
            <IconAlert size={14} className="shrink-0 text-red-400" />
            <span>{erreur}</span>
          </div>
        )}

        {/* Détail du traitement en attente de validation (pour Super Admin dans À valider) */}
        {etat === 'PENDING_VALIDATION' && estAdmin && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3 space-y-2 text-xs">
            <p className="font-bold text-sky-200">Traitement soumis à validation :</p>
            <p className="text-white/80">
              {isDeplacement && `Déplacement vers ${changement.apres?.route || 'un nouvel emplacement'} (${changement.apres?.distanceKm ? `${changement.apres.distanceKm.toFixed(1)} km` : 'distance conforme'})`}
              {isFaction && `Changement de faction vers ${changement.apres?.factionNom || 'décalage horaire'}`}
              {isSuppression && `Retrait / suppression du barrage`}
              {!isDeplacement && !isFaction && !isSuppression && (conflit.decision || 'Mesure de résolution opérationnelle')}
            </p>
            {conflit.traitePar?.nom && (
              <p className="text-[11px] text-white/50">
                Par : <span className="text-white/80 font-semibold">{conflit.traitePar.nom}</span>
              </p>
            )}
          </div>
        )}

        {/* Motif de rejet obligatoire si rejet activé */}
        {afficherChampRejet && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 space-y-2 animate-in fade-in">
            <label htmlFor="motif-rejet" className="block text-xs font-bold text-red-200">
              Motif du rejet (obligatoire) :
            </label>
            <textarea
              id="motif-rejet"
              autoFocus
              rows={2}
              value={motifRejet}
              onChange={(e) => setMotifRejet(e.target.value)}
              placeholder="Précisez la raison du rejet pour correction..."
              className="w-full rounded-lg border border-red-500/40 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setAfficherChampRejet(false)}
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!motifRejet.trim() || enCours}
                onClick={() => executerAction(onRejeterAdmin, conflit, motifRejet.trim())}
                className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                Confirmer le rejet
              </button>
            </div>
          </div>
        )}

        {/* ACTIONS PROPOSÉES SELON LE WORKFLOW ET LE RÔLE */}
        {!afficherChampRejet && (
          <div className="space-y-2 pt-1">
            {/* 1. SUPER ADMIN : Conflit non assigné (Section "Les Conflits") */}
            {estAdmin && (etat === 'NEW' || !conflit.workflow?.etat) && (
              <>
                <p className="text-xs text-white/70">Choisissez comment gérer ce conflit :</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => {
                      onClose?.();
                      onAssignerRegion?.(conflit);
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-gr-gold to-amber-500 py-2.5 px-4 text-xs font-extrabold text-gr-navy shadow-md hover:brightness-110 active:scale-95 transition-all"
                  >
                    <span>➜ Assigner au CMD Région</span>
                  </button>
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => executerAction(onTraiterDirect, conflit)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/20 py-2 px-4 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 active:scale-95 transition-all"
                  >
                    <span>🛠️ Traiter directement (résolution immédiate)</span>
                  </button>
                </div>
              </>
            )}

            {/* 2. CMD RÉGION : Conflit assigné (Section "À traiter") */}
            {estRegion && (etat === 'ASSIGNED_REGION' || etat === 'IN_PROGRESS_REGION' || etat === 'REJECTED') && (
              <>
                <p className="text-xs text-white/70">Choisissez votre modalité de traitement :</p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => executerAction(onTraiterDirect, conflit)}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-2.5 px-4 text-xs font-extrabold text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
                  >
                    <IconCoche size={14} />
                    <span>Option A — Traiter directement</span>
                  </button>
                  {actions.assigner_cie && (
                    <button
                      type="button"
                      disabled={enCours}
                      onClick={() => {
                        onClose?.();
                        onAssignerCie?.(conflit);
                      }}
                      className="w-full flex items-center justify-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/20 py-2 px-4 text-xs font-bold text-sky-200 hover:bg-sky-500/30 active:scale-95 transition-all"
                    >
                      <span>➜ Option B — Déléguer au CMD CIE</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {/* 3. CMD CIE : Conflit assigné (Section "À traiter") */}
            {estCie && (etat === 'ASSIGNED_CIE' || etat === 'IN_PROGRESS_CIE' || etat === 'REJECTED') && (
              <>
                <p className="text-xs text-white/70">
                  Prendre en charge et ouvrir l'interface de traitement pour résoudre ce conflit :
                </p>
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => executerAction(onTraiterDirect, conflit)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-2.5 px-4 text-xs font-extrabold text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
                >
                  <IconCoche size={14} />
                  <span>Confirmer et ouvrir le traitement</span>
                </button>
              </>
            )}

            {/* 4. SUPER ADMIN : Validation de traitement (Section "À valider") */}
            {estAdmin && etat === 'PENDING_VALIDATION' && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => executerAction(onValiderAdmin, conflit)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-2.5 text-xs font-extrabold text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
                >
                  <IconCoche size={14} />
                  <span>Valider</span>
                </button>
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => setAfficherChampRejet(true)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/20 py-2.5 text-xs font-extrabold text-red-200 hover:bg-red-500/30 active:scale-95 transition-all"
                >
                  <span>✕ Rejeter (motif)</span>
                </button>
              </div>
            )}

            {/* 5. SUPER ADMIN : Clôture (Section "Suivi") */}
            {estAdmin && (etat === 'APPROVED' || etat === 'FOLLOW_UP') && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-white/70">
                  Ce conflit est validé et sous suivi. Vous pouvez le clôturer pour l’archiver définitivement :
                </p>
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => executerAction(onCloturerAdmin, conflit)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-2.5 px-4 text-xs font-extrabold text-white shadow-md hover:brightness-110 active:scale-95 transition-all"
                >
                  <IconCoche size={14} />
                  <span>Clôturer et archiver dans l’historique</span>
                </button>
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => executerAction(onTraiterDirect, conflit)}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 py-2 text-xs font-medium text-white/80 hover:bg-white/20 transition-all"
                >
                  <span>Modifier le traitement</span>
                </button>
              </div>
            )}

            {/* 6. Cas de repli / Consultation par un autre profil */}
            {!estAdmin && etat === 'PENDING_VALIDATION' && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70 text-center">
                Traitement soumis. En attente de validation par le Super Admin.
              </div>
            )}

            {!estAdmin && (etat === 'APPROVED' || etat === 'FOLLOW_UP') && (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300 text-center">
                ✓ Ce traitement a été validé par le Super Admin et est sous suivi opérationnel.
              </div>
            )}

            {/* Bouton Annuler général */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/70 hover:text-white transition-colors"
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

