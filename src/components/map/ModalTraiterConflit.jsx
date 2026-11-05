import { useState, useMemo, useEffect } from 'react';
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

  /* Échap referme (sauf pendant un enregistrement). */
  useEffect(() => {
    const clavier = (e) => {
      if (e.key === 'Escape' && !envoi) fermer?.();
    };
    window.addEventListener('keydown', clavier);
    return () => window.removeEventListener('keydown', clavier);
  }, [envoi, fermer]);

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

  /* Une ligne, selon l'action choisie (le détail des règles reste appliqué ci-dessus). */
  const NOTES = {
    faction: 'Découple les créneaux ; le conflit est marqué Traité.',
    deplacement: `Choisissez la nouvelle position sur la carte (au-delà de ${seuilKm} km).`,
    retrograder: 'Lève la protection BFI : le poste devient un BF ordinaire.',
    suppression: 'Retire le poste ; le conflit est résolu.',
    derogation: 'Maintien justifié ; motif obligatoire.',
  };
  const TEINTES = {
    sky: 'border-sky-400 bg-sky-500/20 text-sky-100',
    amber: 'border-amber-400 bg-amber-500/20 text-amber-100',
    purple: 'border-purple-400 bg-purple-500/20 text-purple-100',
    red: 'border-red-400 bg-red-500/20 text-red-100',
    emerald: 'border-emerald-400 bg-emerald-500/20 text-emerald-100',
  };
  const poste = (b, intouchable) => {
    const choisi = barrageCibleId === b?.id;
    const choisissable = !intouchable || estInterRegionDeuxBfi;
    return (
      <button
        type="button"
        disabled={!choisissable || envoi}
        onClick={() => setBarrageCibleId(b?.id ?? '')}
        aria-pressed={choisi}
        title={`${b?.nom || b?.id} · ${b?.reg || 'région ?'} · faction ${extraireFactionId(b) || '—'}`}
        className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-left transition-colors ${
          choisi ? 'border-gr-gold bg-gr-gold/15' : 'border-white/10 bg-white/5 enabled:hover:bg-white/10'
        } disabled:cursor-default`}
      >
        <span className="block truncate text-[11.5px] font-semibold text-white">{intouchable ? '🔒 ' : ''}{b?.nom || b?.id}</span>
        <span className="block truncate text-[10px] text-white/50">{intouchable ? 'BFI' : 'BF'} · {extraireFactionId(b) || '—'}{choisi ? ' · ciblé' : ''}</span>
      </button>
    );
  };

  /*
   * PANNEAU COMPACT, NON BLOQUANT — sous la rangée du haut, à gauche : la carte,
   * cadrée sur le conflit, reste visible. Mêmes options, mêmes règles qu'avant.
   */
  return (
    <div
      role="dialog"
      aria-labelledby="gr-modal-traiter-titre"
      className="fixed left-3 top-[calc(4.5rem+var(--gr-bandeau,0px))] z-[2050] flex max-h-[calc(100dvh-5.5rem)] w-[min(340px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/97 text-white shadow-panel backdrop-blur-xl animate-in fade-in zoom-in-95 duration-100"
    >
      <header className="flex items-start gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id="gr-modal-traiter-titre" className="text-[13px] font-bold">
            Traiter le conflit <span className="font-mono text-amber-300">{conflit.numero || conflit.id}</span>
          </h2>
          <p className="truncate text-[10.5px] text-white/55">
            {route} · {distanceKm.toFixed(1)} km (seuil {seuilKm} km)
          </p>
        </div>
        <button
          type="button"
          onClick={fermer}
          disabled={envoi}
          aria-label="Fermer"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <IconClose size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-3">
        <div>
          <p className="mb-1 text-[10.5px] font-semibold text-white/55">Barrage à traiter</p>
          <div className="flex gap-1.5">
            {poste(bA, bAIntouchable)}
            {poste(bB, bBIntouchable)}
          </div>
          {estCasA && <p className="mt-1 text-[10px] text-teal-300">BFI face à un BF : la faction ne peut pas être changée.</p>}
          {estInterRegionDeuxBfi && <p className="mt-1 text-[10px] text-purple-300">Deux BFI de régions différentes ({regA} / {regB}).</p>}
        </div>

        <div>
          <p className="mb-1 text-[10.5px] font-semibold text-white/55">Action</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Action de traitement">
            {[
    ...((estCasB || estInterRegionDeuxBfi) ? [{ m: 'faction', l: 'Faction', c: 'sky' }] : []),
    { m: 'deplacement', l: estInterRegionDeuxBfi ? 'Déplacer BFI' : 'Déplacer', c: 'amber' },
    ...(estInterRegionDeuxBfi ? [{ m: 'retrograder', l: 'Rétrograder', c: 'purple' }] : []),
    ...(!estInterRegionDeuxBfi && !deuxIntouchables ? [{ m: 'suppression', l: 'Supprimer', c: 'red' }] : []),
    { m: 'derogation', l: 'Dérogation', c: 'emerald' },
  ].map((a) => (
              <button
                key={a.m}
                type="button"
                role="radio"
                aria-checked={mode === a.m}
                disabled={envoi}
                onClick={() => setMode(a.m)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                  mode === a.m ? TEINTES[a.c] : 'border-white/12 text-white/75 hover:bg-white/10'
                }`}
              >
                {a.l}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10.5px] text-white/50">{NOTES[mode]}</p>
        </div>

        {mode === 'faction' && (estCasB || estInterRegionDeuxBfi) && (
          <div className="grid grid-cols-2 gap-1">
            {listeFactions.map((f) => (
              <button
                key={f.id}
                type="button"
                disabled={envoi}
                onClick={() => setNouvelleFactionId(f.id)}
                aria-pressed={nouvelleFactionId === f.id}
                title={f.nom}
                className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] transition-colors ${
                  nouvelleFactionId === f.id ? 'border-sky-400 bg-sky-500/25 font-semibold text-white' : 'border-white/10 bg-white/5 text-white/75 hover:bg-white/10'
                }`}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: f.couleur }} />
                <span className="truncate">{f.nom}</span>
                {f.id === factionAutreId && <span className="shrink-0 text-[9px] text-amber-300">voisin</span>}
              </button>
            ))}
          </div>
        )}

        <textarea
          id="gr-input-justification-traitement"
          rows={2}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          aria-label="Justification ou consigne opérationnelle"
          placeholder={mode === 'derogation' ? 'Motif de la dérogation (obligatoire)' : 'Justification (facultative)'}
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
          onClick={fermer}
          className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={envoi}
          onClick={handleValider}
          className="flex items-center gap-1.5 rounded-lg bg-gr-gold px-3.5 py-1.5 text-[12px] font-bold text-gr-navy shadow-sm transition-all hover:bg-gr-gold/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {envoi ? <IconSpinner size={13} className="animate-spin" /> : <IconCoche size={13} />}
          <span>{envoi ? 'Enregistrement…' : mode === 'deplacement' ? 'Choisir la position' : 'Confirmer'}</span>
        </button>
      </footer>
    </div>
  );
}
