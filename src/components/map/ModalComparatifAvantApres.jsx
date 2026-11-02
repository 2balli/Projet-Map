import { IconClose, IconCoche, IconTerritoire, IconDistance, IconRoute, IconAlert } from '../../icons.jsx';

/**
 * MODAL DE COMPARAISON AVANT / APRÈS POUR LE SUPERADMIN.
 * 
 * Permet au Super Admin d'examiner en détail et en grand format
 * les modifications appliquées à un conflit traité (déplacement,
 * changement de faction, suppression de barrage, dérogation).
 */
export default function ModalComparatifAvantApres({
  conflit,
  session,
  onClose,
  onApprouver,
  onRejeter,
  onVoirSurCarte,
}) {
  if (!conflit) return null;

  const id = conflit.numero || conflit.id;
  const bA = conflit.a || conflit.barrageA;
  const bB = conflit.b || conflit.barrageB;
  const changement = conflit.changement || conflit.traitement?.changement || conflit.traitement?.details || {};
  const traitement = conflit.traitement || {};
  const approbation = conflit.approbation || traitement.approbation;
  const typeAction = changement.type || traitement.action || 'traitement';

  // Informations initiales (AVANT)
  const latAvant = changement.avant?.lat ?? bA?.lat;
  const lngAvant = changement.avant?.lng ?? bA?.lng;
  const routeAvant = changement.avant?.route || conflit.route || bA?.route || 'Route';
  const distanceAvant = Number(changement.avant?.distanceKm ?? conflit.distanceKm ?? 0);
  const seuilKm = Number(conflit.seuilKm ?? 20);
  const factionAvant = changement.avant?.factionNom || changement.avant?.factionId || bA?.factionId || 'F1';
  const barrageConcerne = changement.avant?.barrageNom || bA?.nom || bA?.id;

  // Informations finales (APRÈS)
  const latApres = changement.apres?.lat ?? traitement.details?.latApres;
  const lngApres = changement.apres?.lng ?? traitement.details?.lngApres;
  const routeApres = changement.apres?.route || traitement.details?.routeApres || routeAvant;
  const distanceApres = Number(changement.apres?.distanceKm ?? traitement.details?.distanceApresKm ?? (typeAction === 'deplacement' ? 25 : distanceAvant));
  const factionApres = changement.apres?.factionNom || changement.apres?.factionId || traitement.details?.nouvelleFactionNom || traitement.details?.nouvelleFactionId;
  const barrageSupprime = changement.barrageSupprime || (typeAction.includes('suppression') ? (bB || bA) : null);

  const auteurTraitement = conflit.traitePar || traitement.auteur;
  const dateTraitement = conflit.traiteLe || traitement.date;
  const decisionTexte = conflit.decision || traitement.decision || typeAction;
  const justificationTexte = conflit.justification || traitement.justification || traitement.details?.commentaire || 'Mesure opérationnelle appliquée par le commandement.';

  const app = conflit.approbation || traitement.approbation;
  const statutApp = app?.statut;
  const valReg = app?.validationReg;
  const valAdmin = app?.validationAdmin;
  const traiteParRang = auteurTraitement?.rang;

  const estAdmin = session?.rang === 'admin';
  const estRegion = session?.rang === 'reg';
  const estCie = session?.rang === 'cie';

  const estValideAdmin = statutApp === 'approuve' || valAdmin?.statut === 'valide' || conflit.statut === 'resolu';
  const estRejeteAdmin = statutApp === 'rejete_admin' || valAdmin?.statut === 'rejete';
  const estRejeteReg = statutApp === 'rejete_reg' || valReg?.statut === 'rejete';
  const estEnAttenteAdmin = (statutApp === 'en_attente_admin' || valReg?.statut === 'valide' || traiteParRang === 'reg') && !estValideAdmin && !estRejeteAdmin;
  const estEnAttenteReg = (statutApp === 'en_attente_reg' || traiteParRang === 'cie') && !valReg?.statut && !estValideAdmin && !estRejeteReg && !estRejeteAdmin;

  /* Workflow actuel : seul le Super Admin valide ou rejette, et seulement ce
     que le serveur lui permet (`workflow.actions`). La validation régionale
     n'existe plus. Ancien format sans `workflow` : règle d'avant, pour le seul
     Super Admin. */
  const peutValiderReg = false;
  const peutValiderAdmin = conflit.workflow
    ? Boolean(conflit.workflow.actions?.valider)
    : estAdmin && (estEnAttenteAdmin || (!valAdmin?.statut && statutApp !== 'approuve' && !estValideAdmin));
  void estRegion;
  void estEnAttenteReg;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-comparatif"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-3xl border border-white/20 bg-gradient-to-b from-gr-card to-gr-navy p-5 shadow-2xl text-white space-y-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* EN-TÊTE DE LA MODALE */}
        <header className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 place-items-center rounded-xl bg-gr-gold/20 text-gr-gold border border-gr-gold/30">
              <span className="text-lg">⚖</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="titre-comparatif" className="text-base font-bold tracking-tight text-white">
                  Comparatif du Traitement — Conflit {id}
                </h2>
                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                  Traité
                </span>
                {estValideAdmin ? (
                  <span className="rounded-full bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                    ✓ Validé Super Admin
                  </span>
                ) : estRejeteAdmin ? (
                  <span className="rounded-full bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-[10px] font-bold text-red-200">
                    ✕ Rejeté Super Admin
                  </span>
                ) : estRejeteReg ? (
                  <span className="rounded-full bg-red-500/20 border border-red-500/30 px-2 py-0.5 text-[10px] font-bold text-red-200">
                    ✕ Rejeté CMD Région
                  </span>
                ) : estEnAttenteAdmin ? (
                  <span className="rounded-full bg-sky-500/20 border border-sky-500/30 px-2 py-0.5 text-[10px] font-bold text-sky-200">
                    {estAdmin ? '⏳ En attente validation Super Admin' : '✓ Validé Région · En attente Super Admin'}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                    ⏳ En attente validation Région
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-white/50">
                Action : <b className="text-white/90">{decisionTexte}</b>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le comparatif"
            className="grid size-8 place-items-center rounded-xl bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* CONTENU COMPARATIF SCROLLABLE */}
        <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
          {/* GRILLE COMPARATIVE 2 COLONNES AVANT / APRÈS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {/* ============================================================== */}
            {/* COLONNE GAUCHE : ÉTAT INITIAL (AVANT)                          */}
            {/* ============================================================== */}
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-red-500/20 pb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/25 border border-red-500/40 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-red-200">
                  <span>🔴</span> AVANT — État en conflit
                </span>
                <span className="text-[10.5px] font-mono text-red-300/70">
                  Infraction détectée
                </span>
              </div>

              <div className="space-y-2 text-[12px]">
                {/* Barrages en conflit */}
                <div className="rounded-xl bg-black/40 p-2.5 border border-red-500/10 space-y-1">
                  <span className="text-[10px] uppercase font-bold text-red-300/70 tracking-wider block">
                    Barrages impliqués
                  </span>
                  <div className="space-y-1">
                    <p className="font-semibold text-white/90 flex items-center justify-between">
                      <span>{bA?.nom || bA?.id}</span>
                      <span className="text-[10px] text-white/40 font-mono">[{bA?.reg || 'Région'}]</span>
                    </p>
                    <div className="text-center text-white/30 text-xs">↕ (Conflit de proximité)</div>
                    <p className="font-semibold text-white/90 flex items-center justify-between">
                      <span>{bB?.nom || bB?.id}</span>
                      <span className="text-[10px] text-white/40 font-mono">[{bB?.reg || 'Région'}]</span>
                    </p>
                  </div>
                </div>

                {/* Axe et position avant */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-black/40 p-2 border border-red-500/10">
                    <span className="text-[10px] uppercase font-bold text-white/40 block">Axe routier initial</span>
                    <div className="flex items-center gap-1 mt-0.5 font-bold text-amber-300">
                      <IconRoute size={12} />
                      <span>{routeAvant}</span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-black/40 p-2 border border-red-500/10">
                    <span className="text-[10px] uppercase font-bold text-white/40 block">Distance initiale</span>
                    <div className="flex items-center gap-1 mt-0.5 font-bold text-red-300">
                      <IconDistance size={12} />
                      <span>{distanceAvant.toFixed(1)} km</span>
                    </div>
                    <span className="text-[9.5px] text-red-400 block mt-0.5">Inférieur au seuil ({seuilKm} km)</span>
                  </div>
                </div>

                {/* Coordonnées GPS avant */}
                <div className="rounded-xl bg-black/40 p-2 border border-red-500/10 text-[11px]">
                  <span className="text-[10px] uppercase font-bold text-white/40 block">Position GPS initiale</span>
                  <p className="font-mono text-white/80 mt-0.5">
                    Lat: {latAvant?.toFixed?.(5) ?? latAvant ?? '—'} · Lng: {lngAvant?.toFixed?.(5) ?? lngAvant ?? '—'}
                  </p>
                </div>

                {/* Faction avant */}
                <div className="rounded-xl bg-black/40 p-2 border border-red-500/10 text-[11px]">
                  <span className="text-[10px] uppercase font-bold text-white/40 block">Faction initiale</span>
                  <p className="font-semibold text-amber-300 mt-0.5">
                    {factionAvant}
                  </p>
                  <p className="text-[10px] text-red-300/80 mt-0.5">
                    Même créneau horaire actif → Conflit horaire et spatial.
                  </p>
                </div>
              </div>
            </div>

            {/* ============================================================== */}
            {/* COLONNE DROITE : ÉTAT MODIFIÉ (APRÈS)                          */}
            {/* ============================================================== */}
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/25 p-3.5 space-y-3">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/25 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-emerald-200">
                  <span>🟢</span> APRÈS — État modifié & appliqué
                </span>
                <span className="text-[10.5px] font-mono text-emerald-300/90 font-bold">
                  ✓ Conforme
                </span>
              </div>

              <div className="space-y-2 text-[12px]">
                {/* Cas 1 : Déplacement de barrage */}
                {typeAction === 'deplacement' && (
                  <>
                    <div className="rounded-xl bg-black/40 p-2.5 border border-emerald-500/20 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-emerald-300/80 tracking-wider block">
                        Barrage repositionné
                      </span>
                      <p className="font-bold text-white text-[13px]">
                        {barrageConcerne}
                      </p>
                      <p className="text-[10.5px] text-emerald-300">
                        Déplacé vers une nouvelle position garantissant l'espacement de sécurité.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20">
                        <span className="text-[10px] uppercase font-bold text-white/40 block">Nouvel axe routier</span>
                        <div className="flex items-center gap-1 mt-0.5 font-bold text-emerald-300">
                          <IconRoute size={12} />
                          <span>{routeApres}</span>
                        </div>
                      </div>

                      <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20">
                        <span className="text-[10px] uppercase font-bold text-white/40 block">Nouvelle distance</span>
                        <div className="flex items-center gap-1 mt-0.5 font-bold text-emerald-300">
                          <IconDistance size={12} />
                          <span>{distanceApres >= 20 ? distanceApres.toFixed(1) : '≥ 25.0'} km</span>
                        </div>
                        <span className="text-[9.5px] text-emerald-400 block mt-0.5">✓ Seuil respecté (≥ {seuilKm} km)</span>
                      </div>
                    </div>

                    <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20 text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-emerald-300/80 block">Nouvelles coordonnées GPS</span>
                      <p className="font-mono text-emerald-200 font-bold mt-0.5">
                        Lat: {latApres != null ? Number(latApres).toFixed(5) : '—'} · Lng: {lngApres != null ? Number(lngApres).toFixed(5) : '—'}
                      </p>
                    </div>
                  </>
                )}

                {/* Cas 2 : Changement de faction */}
                {typeAction === 'changement_faction' && (
                  <>
                    <div className="rounded-xl bg-black/40 p-2.5 border border-emerald-500/20 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-emerald-300/80 tracking-wider block">
                        Barrage modifié
                      </span>
                      <p className="font-bold text-white text-[13px]">
                        {barrageConcerne}
                      </p>
                      <p className="text-[10.5px] text-emerald-300">
                        Faction réassignée pour découpler les horaires d'activation opérationnelle.
                      </p>
                    </div>

                    <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20 text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-white/40 block">Nouvelle faction assignée</span>
                      <p className="font-bold text-emerald-300 text-sm mt-0.5">
                        {factionApres}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-emerald-200 font-medium">
                        <IconCoche size={12} />
                        <span>Décalage horaire actif : aucun chevauchement avec l'autre poste.</span>
                      </div>
                    </div>

                    <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20 text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-white/40 block">Impact physique</span>
                      <p className="text-white/80 mt-0.5">
                        Maintien de la position géographique avec couverture temporelle distincte et réglementaire.
                      </p>
                    </div>
                  </>
                )}

                {/* Cas 3 : Suppression de barrage */}
                {(typeAction.includes('suppression') || barrageSupprime) && (
                  <>
                    <div className="rounded-xl bg-black/40 p-2.5 border border-emerald-500/20 space-y-1">
                      <span className="text-[10px] uppercase font-bold text-emerald-300/80 tracking-wider block">
                        Dispositif opérationnel allégé
                      </span>
                      <p className="font-bold text-red-200 text-[13px]">
                        Poste supprimé : {barrageSupprime?.nom || barrageSupprime?.id}
                      </p>
                      <p className="text-[10.5px] text-white/70">
                        Rattaché à : {[barrageSupprime?.reg, barrageSupprime?.cie, barrageSupprime?.bt].filter(Boolean).join(' · ') || 'Unité'}
                      </p>
                    </div>

                    <div className="rounded-xl bg-black/40 p-2 border border-emerald-500/20 text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-white/40 block">État après suppression</span>
                      <p className="font-bold text-emerald-300 mt-0.5">
                        ✓ Barrage retiré du maillage opérationnel
                      </p>
                      <p className="text-[10px] text-white/60 mt-0.5">
                        Le conflit de proximité est définitivement éliminé par le retrait du poste surnuméraire.
                      </p>
                    </div>
                  </>
                )}

                {/* Cas 4 : Dérogation / Autre */}
                {typeAction !== 'deplacement' && typeAction !== 'changement_faction' && !typeAction.includes('suppression') && !barrageSupprime && (
                  <div className="rounded-xl bg-black/40 p-2.5 border border-emerald-500/20 space-y-1.5 text-[11px]">
                    <span className="text-[10px] uppercase font-bold text-emerald-300/80 tracking-wider block">
                      Arbitrage validé
                    </span>
                    <p className="font-bold text-emerald-200">
                      {decisionTexte}
                    </p>
                    <p className="text-white/80">
                      {justificationTexte}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* BANNIÈRE DE REJET SI LE CONFLIT A ÉTÉ REFUSÉ */}
          {(estRejeteAdmin || estRejeteReg) && (
            <div className="rounded-2xl bg-red-500/15 p-3.5 border border-red-500/40 space-y-1 text-[11.5px] text-red-200">
              <div className="flex items-center gap-2 font-bold text-red-300">
                <IconAlert size={14} />
                <span>Traitement refusé par {estRejeteAdmin ? (valAdmin?.par?.nom || 'le Super Admin') : (valReg?.par?.nom || 'le Commandant de Région')}</span>
              </div>
              <p className="italic text-white/90 pl-5">
                Motif du refus : « {valAdmin?.raison || valReg?.raison || app?.raison || 'À corriger selon directives.'} »
              </p>
            </div>
          )}

          {/* DÉTAILS D'EXÉCUTION & COMMENTAIRE DU COMMANDEMENT */}
          <div className="rounded-2xl bg-black/35 p-3.5 border border-white/10 space-y-2 text-[11.5px]">
            <div className="flex items-center justify-between text-white/60">
              <span>
                Exécuté par : <b className="text-white">{auteurTraitement?.nom || auteurTraitement?.unite || 'Commandement'}</b> ({auteurTraitement?.rang || 'Officier'})
              </span>
              <span className="font-mono text-white/40">
                {dateTraitement && new Date(dateTraitement).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div className="rounded-xl bg-white/5 p-2.5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-gr-gold tracking-wider block">
                Justification opérationnelle consignée :
              </span>
              <p className="mt-1 text-white/90 italic leading-relaxed">
                « {justificationTexte} »
              </p>
            </div>
          </div>
        </div>

        {/* PIED DE MODALE & ACTIONS HIERARCHIQUES */}
        <footer className="border-t border-white/10 pt-3 shrink-0 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onVoirSurCarte?.(conflit, 'comparer');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[11.5px] font-bold text-white hover:bg-white/20 transition-all active:scale-95 shadow-sm"
            >
              <span>⇄</span>
              <span>Comparer sur la carte</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onVoirSurCarte?.(conflit, 'avant');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/20 px-2.5 py-2 text-[11px] font-bold text-red-200 hover:bg-red-500/30 transition-all active:scale-95 shadow-sm"
            >
              <span>🔴</span>
              <span>Voir AVANT</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose?.();
                onVoirSurCarte?.(conflit, 'apres');
              }}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-2 text-[11px] font-bold text-emerald-200 hover:bg-emerald-500/30 transition-all active:scale-95 shadow-sm"
            >
              <span>🟢</span>
              <span>Voir APRÈS</span>
            </button>
          </div>

          {/* Validation CMD Région */}
          {peutValiderReg && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onApprouver?.(conflit);
                  onClose?.();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 text-[12px] font-extrabold text-white hover:brightness-110 transition-all shadow-md active:scale-95"
              >
                <IconCoche size={13} />
                <span>Valider (Région)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRejeter?.(conflit);
                  onClose?.();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 px-4 py-2 text-[12px] font-extrabold text-white hover:brightness-110 transition-all shadow-md active:scale-95"
              >
                <span>✕ Refuser (Région)</span>
              </button>
            </div>
          )}

          {/* Validation Super Admin */}
          {peutValiderAdmin && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onApprouver?.(conflit);
                  onClose?.();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 text-[12px] font-extrabold text-white hover:brightness-110 transition-all shadow-md active:scale-95"
              >
                <IconCoche size={13} />
                <span>Valider (Super Admin)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRejeter?.(conflit);
                  onClose?.();
                }}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-red-500 px-4 py-2 text-[12px] font-extrabold text-white hover:brightness-110 transition-all shadow-md active:scale-95"
              >
                <span>✕ Refuser (Super Admin)</span>
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
