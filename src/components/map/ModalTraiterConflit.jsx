import { useState, useMemo } from 'react';
import { IconAlert, IconClose, IconSpinner, IconCoche, IconDistance, IconRoute } from '../../icons.jsx';

const FACTIONS_DEFAUT = [
  { id: 'F1', nom: 'Faction 1 (Matin 06h-14h)', couleur: '#38BDF8' },
  { id: 'F2', nom: 'Faction 2 (Après-midi 14h-22h)', couleur: '#F59E0B' },
  { id: 'F3', nom: 'Faction 3 (Nuit 22h-06h)', couleur: '#A855F7' },
  { id: 'F4', nom: 'Faction 4 (Renfort / Spécial)', couleur: '#10B981' },
];

/** Détecte si un barrage est un Barrage Fixe Intouchable (BFI) */
const estBFI = (b) => {
  if (!b) return false;
  return Boolean(
    b.intouchable === true ||
    b.type === 'barrage_vip' ||
    b.type === 'fixe_intouchable' ||
    b.protection === 'intouchable' ||
    b.nature === 'fixe_intouchable' ||
    (typeof b.nom === 'string' && (
      b.nom.toLowerCase().includes('intouchable') ||
      b.nom.toLowerCase().includes('bfi')
    ))
  );
};

/** Extrait l'identifiant de faction principal d'un barrage */
const extraireFactionId = (b) => {
  if (!b) return null;
  if (b.factionId) return b.factionId;
  if (Array.isArray(b.factions) && b.factions.length > 0) return b.factions[0];
  return null;
};

/**
 * MODALE UNIQUE DE TRAITEMENT D'UN CONFLIT.
 *
 * Interface consolidée et simplifiée sans popups en cascade :
 * 1. Identification claire des deux barrages (factions réelles, statuts BFI, routes).
 * 2. Cas A (BFI intouchable vs BF régulier) :
 *    - Option « Changer la faction » strictement masquée avec explication claire.
 *    - Actions autorisées : Déplacer le BF, Supprimer le BF, Dérogation opérationnelle.
 * 3. Cas B (Deux barrages BF de même faction) :
 *    - Actions autorisées : Changer la faction, Déplacer, Supprimer, Dérogation opérationnelle.
 *    - La faction modifiée découple les créneaux et le conflit est marqué comme « Traité ».
 * 4. Zone de saisie d'une justification opérationnelle.
 * 5. Boutons « Confirmer le traitement » et « Annuler » avec protection anti double-soumission.
 */
export default function ModalTraiterConflit({
  conflit,
  session = null,
  factions = null,
  barrages = [],
  onClose,
  onFermer,
  onConfirmer,
  onDemarrerDeplacement = null,
  onSupprimerBarrage = null,
}) {
  const fermer = onClose || onFermer;

  // Récupération des données réelles et fraîches des deux barrages
  const idA = conflit?.barrageAId || conflit?.a?.id;
  const idB = conflit?.barrageBId || conflit?.b?.id;

  const bA = useMemo(() => {
    return (Array.isArray(barrages) && idA ? barrages.find((x) => x.id === idA) : null) ||
      conflit?.a ||
      conflit?.barrageA ||
      { id: idA, nom: idA };
  }, [barrages, idA, conflit]);

  const bB = useMemo(() => {
    return (Array.isArray(barrages) && idB ? barrages.find((x) => x.id === idB) : null) ||
      conflit?.b ||
      conflit?.barrageB ||
      { id: idB, nom: idB };
  }, [barrages, idB, conflit]);

  const bAIntouchable = estBFI(bA);
  const bBIntouchable = estBFI(bB);

  const regA = bA?.reg || conflit?.barrageA?.reg || '';
  const regB = bB?.reg || conflit?.barrageB?.reg || '';
  const deuxIntouchables = bAIntouchable && bBIntouchable;
  const estInterRegionDeuxBfi = Boolean(
    deuxIntouchables &&
    regA &&
    regB &&
    regA.trim().toLowerCase() !== regB.trim().toLowerCase()
  );

  // Cas A : un BFI et un BF régulier
  const estCasA = (bAIntouchable && !bBIntouchable) || (!bAIntouchable && bBIntouchable);
  // Cas B : deux barrages réguliers
  const estCasB = !bAIntouchable && !bBIntouchable;

  // Détermination du barrage cible initial
  const cibleInitialeId = useMemo(() => {
    if (estInterRegionDeuxBfi) {
      const u = session?.unite?.trim()?.toLowerCase?.();
      if (u && regB?.trim()?.toLowerCase?.() === u) return bB?.id ?? '';
      return bA?.id ?? '';
    }
    return bAIntouchable ? (bB?.id ?? '') : (bA?.id ?? '');
  }, [estInterRegionDeuxBfi, session?.unite, regB, bA, bB, bAIntouchable]);

  const [barrageCibleId, setBarrageCibleId] = useState(cibleInitialeId);

  // Mode initial :
  // - En conflit inter-régions deux BFI : 'deplacement' par défaut (options 'faction' et 'retrograder' également autorisées)
  // - En Cas A : 'deplacement' par défaut ('faction' est interdite et non disponible)
  // - En Cas B : 'faction' par défaut
  const [mode, setMode] = useState(
    estInterRegionDeuxBfi ? 'deplacement' : estCasA ? 'deplacement' : 'faction'
  ); // 'faction' | 'deplacement' | 'retrograder' | 'suppression' | 'derogation'
  const [nouvelleFactionId, setNouvelleFactionId] = useState('');
  const [justification, setJustification] = useState(conflit?.justification || conflit?.traitement?.justification || '');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState(null);

  if (!conflit) return null;

  const listeFactions = factions?.factions?.length
    ? factions.factions.map((f) => ({
        id: f.id,
        nom: f.nom || f.libelle || f.id,
        couleur: f.couleur || '#38BDF8',
      }))
    : FACTIONS_DEFAUT;

  const barrageCible = barrageCibleId === bB?.id ? bB : bA;
  const autreBarrage = barrageCibleId === bB?.id ? bA : bB;
  const cibleEstIntouchable = barrageCibleId === bA?.id ? bAIntouchable : bBIntouchable;
  const factionAId = extraireFactionId(bA);
  const factionBId = extraireFactionId(bB);
  const factionCibleId = extraireFactionId(barrageCible);
  const factionAutreId = extraireFactionId(autreBarrage) || conflit.factionId;

  const distanceKm = Number(conflit.distanceKm ?? conflit.km ?? 0);
  const seuilKm = Number(conflit.seuilKm ?? 20);
  const route = conflit.route || bA?.route || bB?.route || 'Axe routier';

  // Soumission et enregistrement direct
  const handleValider = async (e) => {
    e?.preventDefault?.();
    if (envoi) return;
    setErreur(null);

    // Vérification des règles selon le mode
    if (mode === 'faction') {
      if ((estCasA || cibleEstIntouchable) && !estInterRegionDeuxBfi) {
        setErreur('Règle violée : un barrage BFI ne peut pas changer de faction.');
        return;
      }
      if (!nouvelleFactionId) {
        setErreur('Veuillez sélectionner la nouvelle faction à attribuer au barrage.');
        return;
      }
      if (nouvelleFactionId === factionAutreId) {
        setErreur('Veuillez choisir une faction distincte de celle du barrage voisin pour séparer les créneaux horaires.');
        return;
      }
    }

    if (cibleEstIntouchable && !estInterRegionDeuxBfi && (mode === 'deplacement' || mode === 'suppression')) {
      setErreur('Un barrage FIXE INTOUCHABLE ne peut être ni déplacé ni supprimé.');
      return;
    }

    if (cibleEstIntouchable && mode === 'suppression') {
      setErreur('Un barrage FIXE INTOUCHABLE ne peut pas être supprimé.');
      return;
    }

    if (mode === 'derogation' && !justification.trim()) {
      setErreur('Veuillez saisir un motif ou une consigne opérationnelle pour justifier la dérogation.');
      return;
    }

    setEnvoi(true);

    try {
      if (mode === 'deplacement') {
        // Lance le déplacement sur la carte
        if (onDemarrerDeplacement && barrageCible) {
          onDemarrerDeplacement(barrageCible, {
            ...conflit,
            conflitInterRegionBfi: estInterRegionDeuxBfi,
          });
          fermer?.();
        } else {
          throw new Error('Outil de déplacement cartographique indisponible.');
        }
        return;
      }

      if (mode === 'retrograder' || mode === 'retrograder_bf') {
        await onConfirmer?.({
          conflitId: conflit.id,
          action: 'retrograder_bf',
          details: {
            barrageId: barrageCible?.id,
            barrageNom: barrageCible?.nom || barrageCible?.id,
            typeAvant: barrageCible?.type,
            justification:
              justification.trim() ||
              `Rétrogradation du BFI ${barrageCible?.nom || barrageCible?.id} en Barrage Fixe ordinaire (BF) pour résolution du conflit inter-régions.`,
            conflitData: conflit,
          },
        });
        fermer?.();
        return;
      }

      if (mode === 'suppression') {
        // Lance la suppression directe
        if (onSupprimerBarrage && barrageCible) {
          await onSupprimerBarrage(barrageCible, conflit, justification.trim());
          fermer?.();
        } else {
          throw new Error('Fonction de suppression indisponible.');
        }
        return;
      }

      if (mode === 'faction') {
        const fObj = listeFactions.find((f) => f.id === nouvelleFactionId);
        const ancNom = listeFactions.find((f) => f.id === factionCibleId)?.nom || factionCibleId || 'Faction initiale';
        await onConfirmer?.({
          conflitId: conflit.id,
          action: 'changement_faction',
          details: {
            barrageId: barrageCible?.id,
            barrageNom: barrageCible?.nom || barrageCible?.id,
            ancienneFactionId: factionCibleId,
            ancienneFactionNom: ancNom,
            nouvelleFactionId,
            nouvelleFactionNom: fObj?.nom || nouvelleFactionId,
            justification: justification.trim(),
            conflitData: conflit,
          },
        });
        fermer?.();
        return;
      }

      if (mode === 'derogation') {
        await onConfirmer?.({
          conflitId: conflit.id,
          action: 'derogation',
          details: {
            barrageId: barrageCible?.id,
            barrageNom: barrageCible?.nom || barrageCible?.id,
            justification: justification.trim(),
            motif: 'Dérogation opérationnelle accordée par le commandement',
            conflitData: conflit,
          },
        });
        fermer?.();
        return;
      }
    } catch (err) {
      setErreur(err?.message || 'Erreur lors de l’enregistrement du traitement.');
      setEnvoi(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => !envoi && fermer?.()}
      className="fixed inset-0 z-[3000] grid place-items-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gr-modal-traiter-titre"
        onClick={(e) => e.stopPropagation()}
        className="w-[min(580px,100%)] rounded-2xl border border-white/15 bg-gr-navy p-5 text-white shadow-2xl space-y-4 my-auto animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Entête avec numéro du conflit et route */}
        <header className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[12px] font-bold text-amber-300 border border-amber-500/30">
                {conflit.numero || conflit.id}
              </span>
              <h2 id="gr-modal-traiter-titre" className="text-[16px] font-bold text-white">
                Traitement opérationnel du conflit
              </h2>
            </div>
            <p className="mt-1 text-[11.5px] text-white/60">
              Axe routier : <b className="text-white font-mono">{route}</b> · Espacement : <b className="text-amber-300 font-mono">{distanceKm.toFixed(1)} km</b> (seuil : {seuilKm} km)
            </p>
          </div>
          <button
            type="button"
            onClick={fermer}
            disabled={envoi}
            aria-label="Fermer la fenêtre"
            className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={16} />
          </button>
        </header>

        {/* 1. Identification détaillée des deux barrages */}
        <div className="space-y-1.5">
          <label className="block text-[11.5px] font-bold text-white/80">
            1. Barrages concernés :
          </label>
          <div className="grid grid-cols-2 gap-2">
            {/* Carte Barrage A */}
            <div
              onClick={() => {
                if (!bAIntouchable || estInterRegionDeuxBfi) setBarrageCibleId(bA?.id ?? '');
              }}
              className={`rounded-xl border p-2.5 transition-all cursor-pointer ${
                barrageCibleId === bA?.id
                  ? 'border-gr-gold bg-gr-gold/15 ring-1 ring-gr-gold shadow-md'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              } ${bAIntouchable && !estInterRegionDeuxBfi ? 'opacity-85' : ''}`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-bold text-[12px] truncate text-white" title={bA?.nom || bA?.id}>
                  {bA?.nom || bA?.id}
                </span>
                {bAIntouchable ? (
                  <span className="rounded bg-teal-400/20 px-1.5 py-0.5 text-[8.5px] font-bold text-teal-300 border border-teal-400/30 shrink-0">
                    🔒 BFI Intouchable
                  </span>
                ) : (
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[8.5px] font-bold text-sky-300 border border-sky-500/30 shrink-0">
                    BF Régulier
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-white/60 space-y-0.5">
                <p>Région : <b className="text-white">{bA?.reg || 'Non spécifiée'}</b></p>
                <p>Faction réelle : <b className="text-amber-300 font-mono">{factionAId || 'Même faction'}</b></p>
              </div>
              {barrageCibleId === bA?.id && (!bAIntouchable || estInterRegionDeuxBfi) && (
                <div className="mt-1 text-[10px] text-gr-gold font-bold flex items-center gap-1">
                  <IconCoche size={10} /> <span>Barrage sélectionné</span>
                </div>
              )}
            </div>

            {/* Carte Barrage B */}
            <div
              onClick={() => {
                if (!bBIntouchable || estInterRegionDeuxBfi) setBarrageCibleId(bB?.id ?? '');
              }}
              className={`rounded-xl border p-2.5 transition-all cursor-pointer ${
                barrageCibleId === bB?.id
                  ? 'border-gr-gold bg-gr-gold/15 ring-1 ring-gr-gold shadow-md'
                  : 'border-white/10 bg-white/5 hover:border-white/20'
              } ${bBIntouchable && !estInterRegionDeuxBfi ? 'opacity-85' : ''}`}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="font-bold text-[12px] truncate text-white" title={bB?.nom || bB?.id}>
                  {bB?.nom || bB?.id}
                </span>
                {bBIntouchable ? (
                  <span className="rounded bg-teal-400/20 px-1.5 py-0.5 text-[8.5px] font-bold text-teal-300 border border-teal-400/30 shrink-0">
                    🔒 BFI Intouchable
                  </span>
                ) : (
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[8.5px] font-bold text-sky-300 border border-sky-500/30 shrink-0">
                    BF Régulier
                  </span>
                )}
              </div>
              <div className="text-[10.5px] text-white/60 space-y-0.5">
                <p>Région : <b className="text-white">{bB?.reg || 'Non spécifiée'}</b></p>
                <p>Faction réelle : <b className="text-amber-300 font-mono">{factionBId || 'Même faction'}</b></p>
              </div>
              {barrageCibleId === bB?.id && (!bBIntouchable || estInterRegionDeuxBfi) && (
                <div className="mt-1 text-[10px] text-gr-gold font-bold flex items-center gap-1">
                  <IconCoche size={10} /> <span>Barrage sélectionné</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Alerte contextuelle selon la nature des factions */}
        {estCasA && (
          <div role="status" className="rounded-xl border border-teal-500/40 bg-teal-500/10 p-3 text-[11px] text-teal-200 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-teal-300">
              <IconAlert size={14} className="shrink-0" />
              <span>Cas A : Conflit entre un Barrage BFI et un Barrage BF</span>
            </div>
            <p className="text-teal-100/80 leading-relaxed">
              Le barrage <b>BFI</b> est un poste permanent 24h/24 actif sur toutes les factions.
              L'option <b>« Changer la faction » est formellement retirée</b> car changer la faction du barrage régulier ne résoudrait pas le conflit opérationnel d'espacement.
              Vous pouvez <b>déplacer</b> ou <b>supprimer</b> le barrage régulier, ou consigner une <b>dérogation</b>.
            </p>
          </div>
        )}

        {estCasB && (
          <div role="status" className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-2.5 text-[11px] text-sky-200 space-y-0.5">
            <div className="flex items-center gap-1.5 font-bold text-sky-300">
              <span>Cas B : Conflit entre deux barrages BF réguliers</span>
            </div>
            <p className="text-sky-100/75 leading-relaxed">
              Vous pouvez découpler les créneaux horaires en <b>changeant la faction</b>, réajuster la distance en le <b>déplaçant</b>, ou accorder une <b>dérogation</b>.
            </p>
          </div>
        )}

        {estInterRegionDeuxBfi && (
          <div role="status" className="rounded-xl border border-purple-500/40 bg-purple-500/10 p-3 text-[11px] text-purple-200 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-purple-300">
              <IconAlert size={14} className="shrink-0" />
              <span>Conflit Inter-Régions entre deux Barrages Fixes Intouchables (BFI)</span>
            </div>
            <p className="text-purple-100/80 leading-relaxed">
              Ce conflit oppose deux barrages BFI de deux régions distinctes (<b>{regA}</b> vs <b>{regB}</b>).
              En tant que Commandant de Région, vous êtes autorisé à :
              <b> Déplacer le BFI</b>, <b>changer sa faction horaire</b> ou <b>le rétrograder en Barrage Fixe ordinaire (BF)</b>.
            </p>
          </div>
        )}

        {/* 2. Actions de traitement autorisées selon les règles métier */}
        <div className="space-y-1.5">
          <label className="block text-[11.5px] font-bold text-white/80">
            2. Choisissez l'action de traitement :
          </label>
          <div className={`grid gap-2 ${estInterRegionDeuxBfi ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
            {/* Option Changer Faction (Cas B ou Inter-Régions deux BFI) */}
            {(estCasB || estInterRegionDeuxBfi) && (
              <button
                type="button"
                onClick={() => setMode('faction')}
                className={`rounded-xl border p-2 text-center text-[11.5px] font-semibold transition-all ${
                  mode === 'faction'
                    ? 'border-sky-400 bg-sky-500/20 text-white ring-1 ring-sky-400'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                <span className="block font-bold">Changer faction</span>
                <span className="text-[10px] text-white/50">Décalage horaire</span>
              </button>
            )}

            {/* Option Déplacer */}
            <button
              type="button"
              onClick={() => setMode('deplacement')}
              className={`rounded-xl border p-2 text-center text-[11.5px] font-semibold transition-all ${
                mode === 'deplacement'
                  ? 'border-amber-400 bg-amber-500/20 text-white ring-1 ring-amber-400'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <span className="block font-bold">
                {estInterRegionDeuxBfi ? 'Déplacer BFI' : 'Déplacer'}
              </span>
              <span className="text-[10px] text-white/50">Sur la carte</span>
            </button>

            {/* Option Rétrograder en BF (Spécifique aux conflits inter-régions deux BFI) */}
            {estInterRegionDeuxBfi && (
              <button
                type="button"
                onClick={() => setMode('retrograder')}
                className={`rounded-xl border p-2 text-center text-[11.5px] font-semibold transition-all ${
                  mode === 'retrograder'
                    ? 'border-purple-400 bg-purple-500/20 text-white ring-1 ring-purple-400'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                <span className="block font-bold text-purple-300">Rétrograder en BF</span>
                <span className="text-[10px] text-white/50">Lever le statut BFI</span>
              </button>
            )}

            {/* Option Supprimer (seulement pour BF régulier) */}
            {!estInterRegionDeuxBfi && !deuxIntouchables && (
              <button
                type="button"
                onClick={() => setMode('suppression')}
                className={`rounded-xl border p-2 text-center text-[11.5px] font-semibold transition-all ${
                  mode === 'suppression'
                    ? 'border-red-400 bg-red-500/20 text-white ring-1 ring-red-400'
                    : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                }`}
              >
                <span className="block font-bold text-red-300">Supprimer</span>
                <span className="text-[10px] text-white/50">Retirer le poste</span>
              </button>
            )}

            {/* Option Dérogation opérationnelle */}
            <button
              type="button"
              onClick={() => setMode('derogation')}
              className={`rounded-xl border p-2 text-center text-[11.5px] font-semibold transition-all ${
                mode === 'derogation'
                  ? 'border-emerald-400 bg-emerald-500/20 text-white ring-1 ring-emerald-400'
                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
              }`}
            >
              <span className="block font-bold text-emerald-300">Dérogation</span>
              <span className="text-[10px] text-white/50">Maintien validé</span>
            </button>
          </div>
        </div>

        {/* Détail du mode sélectionné */}
        {mode === 'faction' && (estCasB || estInterRegionDeuxBfi) && (
          <div className="rounded-xl border border-sky-500/30 bg-sky-950/30 p-3 space-y-2 text-[12px]">
            <p className="font-semibold text-sky-200">
              Attribuer une nouvelle faction à {barrageCible?.nom} :
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {listeFactions.map((f) => {
                const estChoisie = nouvelleFactionId === f.id;
                const estPartagee = f.id === factionAutreId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setNouvelleFactionId(f.id)}
                    className={`flex items-center gap-2 rounded-xl border p-2 text-left text-[11.5px] transition-all ${
                      estChoisie
                        ? 'border-sky-400 bg-sky-500/30 text-white font-bold'
                        : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: f.couleur }} />
                    <span className="truncate flex-1">{f.nom}</span>
                    {estPartagee && (
                      <span className="text-[9px] text-amber-300 font-normal shrink-0">(actuelle)</span>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] text-white/50 italic pt-1">
              Note : la modification de faction découple les créneaux d'activité. Le conflit sera enregistré comme <b>Traité</b>, tout en conservant la visibilité sur la proximité résiduelle.
            </p>
          </div>
        )}

        {mode === 'retrograder' && estInterRegionDeuxBfi && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-950/30 p-3 space-y-2 text-[12px]">
            <p className="font-semibold text-purple-200">
              Rétrograder le barrage <b className="text-white">{barrageCible?.nom}</b> en Barrage Fixe ordinaire (BF) :
            </p>
            <p className="text-[11px] text-white/70 leading-relaxed">
              Cette action lève la protection permanente intouchable (BFI) du barrage sélectionné. Il deviendra un barrage régulier (BF), permettant de le déplacer librement ou de lui assigner des créneaux horaires spécifiques.
            </p>
          </div>
        )}

        {mode === 'deplacement' && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 p-3 space-y-1.5 text-[11.5px]">
            <p className="font-bold text-amber-300">
              Déplacement le long de l'axe routier ({route}) :
            </p>
            <p className="text-white/70 leading-relaxed">
              En confirmant, vous pourrez cliquer sur la carte le long de la route pour positionner le barrage <b>« {barrageCible?.nom} »</b> au-delà du seuil de <b>{seuilKm} km</b>.
            </p>
          </div>
        )}

        {mode === 'suppression' && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 space-y-1.5 text-[11.5px]">
            <p className="font-bold text-red-300">
              Suppression définitive du barrage « {barrageCible?.nom} » :
            </p>
            <p className="text-white/70 leading-relaxed">
              Ce barrage régulier sera retiré de la carte et du dispositif opérationnel. Le conflit sera définitivement <b>Résolu</b> et archivé dans l'historique du Superadmin.
            </p>
          </div>
        )}

        {mode === 'derogation' && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 space-y-1.5 text-[11.5px]">
            <p className="font-bold text-emerald-300">
              Dérogation opérationnelle et maintien de proximité :
            </p>
            <p className="text-white/70 leading-relaxed">
              Le conflit sera marqué comme <b>Traité</b>. L'espacement inférieur à {seuilKm} km restera identifié comme dérogatoire avec consigne opérationnelle (ex : filtrage alterné, point stratégique).
            </p>
          </div>
        )}

        {/* 3. Zone de justification / consigne */}
        <div className="space-y-1">
          <label htmlFor="gr-input-justification-traitement" className="block text-[11.5px] font-bold text-white/80">
            3. Justification ou consigne opérationnelle {mode === 'derogation' ? '(obligatoire)' : '(optionnelle)'} :
          </label>
          <textarea
            id="gr-input-justification-traitement"
            rows={2}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Ex : Arbitrage validé en coordination de commandement, surveillance alternée…"
            className="w-full rounded-xl border border-white/15 bg-white/5 p-2.5 text-[11.5px] text-white placeholder-white/35 focus:border-gr-gold focus:outline-none resize-none"
          />
        </div>

        {/* Erreur éventuelle */}
        {erreur && (
          <div role="alert" className="flex items-start gap-2 text-[11.5px] text-red-300 bg-red-500/15 border border-red-500/30 rounded-xl p-2.5">
            <IconAlert size={14} className="mt-0.5 shrink-0 text-red-400" />
            <span>{erreur}</span>
          </div>
        )}

        {/* Pied de fenêtre : Boutons Confirmer et Annuler */}
        <footer className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
          <button
            type="button"
            disabled={envoi}
            onClick={fermer}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[12px] font-semibold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={envoi}
            onClick={handleValider}
            className="flex items-center gap-1.5 rounded-xl bg-gr-gold px-5 py-2 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {envoi ? (
              <>
                <IconSpinner size={14} className="animate-spin" />
                <span>Enregistrement...</span>
              </>
            ) : (
              <>
                <IconCoche size={14} />
                <span>Confirmer le traitement</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
