/**
 * « MODIFIER BARRAGE » — le panneau qui s'ouvre depuis la bulle d'un poste.
 *
 * DEUX GESTES, DEUX CHEMINS — et un seul pour le déplacement :
 *
 *   DÉPLACER      referme le panneau et passe la carte en mode déplacement
 *                 (`onDeplacer`) : clic sur la nouvelle position, recalage sur
 *                 la route, aperçu, puis PATCH /api/marquages/:id. C'est le
 *                 chemin de déplacement du projet ; ce panneau n'en a pas
 *                 d'autre.
 *   EFFECTIF /    l'effectif du créneau en cours et la protection partent
 *   PROTECTION    ensemble à POST /api/barrages/:id/modification. Le serveur
 *                 vérifie tout (règle des trois, disponibilité des hommes, un
 *                 seul intouchable par compagnie, distance) et répond 409 avec
 *                 ce qu'il faut confirmer ; l'écran le montre et renvoie.
 *
 * Aucune donnée n'est modifiée avant « Enregistrer ».
 */
import { useEffect, useState } from 'react';
import * as API from '../../api.js';
import * as MQ from '../../marquages.js';
import { IconAlert, IconBarrageIntouchable, IconCible, IconClose, IconSpinner } from '../../icons.jsx';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const champ =
  'w-full rounded-lg border border-white/12 bg-white/6 px-2 py-1.5 text-[12px] text-white ' +
  'placeholder:text-white/30 focus:border-gr-gold/60 focus:outline-none';

const etiquette = 'mb-1 block text-[11px] font-semibold text-white/70';

const FACTIONS = ['F1', 'F2', 'F3', 'F4'];
const LIBELLE_FACTION = { F1: 'F1 · 00h–06h', F2: 'F2 · 06h–12h', F3: 'F3 · 12h–18h', F4: 'F4 · 18h–00h' };

const fmtCoord = (v) => (Number.isFinite(v) ? v.toFixed(5) : '—');

function Section({ titre, children }) {
  return (
    <section className="space-y-2 border-t border-white/10 px-4 py-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-gr-gold">{titre}</h3>
      {children}
    </section>
  );
}

export default function ModifierBarrage({ barrage, onDeplacer, onFermer, onEnregistre, onFicheComplete }) {
  const intouchableAvant = MQ.estIntouchable(barrage);
  const estVip = MQ.estVIP(barrage);

  const [presents, setPresents] = useState(null); // effectif du créneau en cours
  const [effectif, setEffectif] = useState('');
  const [intouchable, setIntouchable] = useState(intouchableAvant);
  const [factionId, setFactionId] = useState('');
  /* Ce que le serveur demande de confirmer (409), et les confirmations données. */
  const [aConfirmer, setAConfirmer] = useState(null);
  const [remplacer, setRemplacer] = useState(false);
  const [accepterConflits, setAccepterConflits] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [envoi, setEnvoi] = useState(false);

  /* L'effectif actuel : la relève du créneau en cours, lue par la route existante. */
  useEffect(() => {
    let vivant = true;
    API.effectifDuPoste(barrage.id)
      .then((r) => {
        if (!vivant) return;
        setPresents((r.items ?? []).filter((e) => e.creneau === r.creneau).length);
      })
      .catch(() => vivant && setPresents(null));
    return () => {
      vivant = false;
    };
  }, [barrage.id]);

  /* Une saisie nouvelle annule les confirmations données sur l'ancienne. */
  useEffect(() => {
    setAConfirmer(null);
    setRemplacer(false);
    setAccepterConflits(false);
    setErreur(null);
  }, [effectif, intouchable, factionId]);

  const corps = {
    ...(effectif !== '' ? { effectif: Number(effectif) } : {}),
    ...(intouchable !== intouchableAvant
      ? { intouchable, ...(!intouchable && factionId ? { factionId } : {}) }
      : {}),
  };
  const rien = !Object.keys(corps).length;
  const confirme =
    (!aConfirmer?.intouchableExistant || remplacer) && (!aConfirmer?.confirmerConflits || accepterConflits);

  const enregistrer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await API.enregistrerModificationBarrage(barrage.id, {
        ...corps,
        ...(accepterConflits ? { accepterConflits: true } : {}),
        ...(remplacer && aConfirmer?.intouchableExistant ? { remplacerIntouchable: aConfirmer.intouchableExistant.id } : {}),
      });
      onEnregistre?.(r);
    } catch (e) {
      /* 409 : le serveur a calculé ce qu'il faut confirmer — on le montre. */
      if (e.statut === 409 && e.donnees?.apercu) setAConfirmer(e.donnees.apercu);
      setErreur(e.message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <aside
      className="pointer-events-auto fixed right-3 top-16 z-[1500] flex max-h-[calc(100vh-5rem)] w-[360px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gr-navy/95 shadow-panel backdrop-blur"
      role="dialog"
      aria-labelledby="gr-modif-barrage-titre"
      data-testid="modifier-barrage"
    >
      <header className="flex items-start gap-2.5 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p id="gr-modif-barrage-titre" className="text-[13px] font-bold uppercase tracking-[0.1em] text-white">
            Modifier barrage
          </p>
          <p className="truncate text-[12px] font-semibold text-white/75">
            {MQ.libelle(barrage)} <span className="font-mono text-white/40">· {barrage.id}</span>
          </p>
        </div>
        <button type="button" onClick={onFermer} className={`${bouton} bg-white/10 text-white/80 hover:bg-white/16`} aria-label="Fermer">
          <IconClose size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {intouchableAvant && (
          <div className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-teal-400/40 bg-teal-500/15 px-3 py-2">
            <IconBarrageIntouchable size={18} className="shrink-0 text-teal-300" />
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-teal-200">Barrage intouchable</p>
              <p className="text-[11px] text-teal-100/80">Permanent — 24h/24 · jamais déplacé ni supprimé par la filtration</p>
            </div>
          </div>
        )}

        <Section titre="Position">
          <table className="w-full text-[11px]">
            <tbody>
              <tr>
                <td className="text-white/45">Position actuelle</td>
                <td className="text-right font-mono text-white/80">
                  {fmtCoord(barrage.lat)} / {fmtCoord(barrage.lng)}
                </td>
              </tr>
              <tr>
                <td className="text-white/45">Route · PK</td>
                <td className="text-right font-mono text-white/80">
                  {barrage.route || '—'} · {Number.isFinite(barrage.pk) ? `PK ${barrage.pk}` : 'PK —'}
                </td>
              </tr>
              <tr>
                <td className="text-white/45">Brigade · Compagnie · Région</td>
                <td className="text-right text-white/80">
                  {barrage.bt ?? '—'} · {barrage.cie ?? '—'} · {barrage.reg ?? '—'}
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            onClick={onDeplacer}
            disabled={intouchableAvant}
            className={`${bouton} w-full bg-white/10 text-white hover:bg-white/16`}
          >
            <IconCible size={13} /> Déplacer
          </button>
          {intouchableAvant && (
            <p className="text-[11px] leading-snug text-white/50">
              Sa position est définitive : un barrage intouchable ne se déplace pas.
            </p>
          )}
        </Section>

        <Section titre="Effectif affecté">
          <div className="flex items-end gap-3">
            <div className="text-[11px] text-white/60">
              Effectif actuel
              <p className="text-[18px] font-bold text-white">{presents ?? '…'}</p>
            </div>
            <label className="w-[110px]">
              <span className={etiquette}>Nouvel effectif</span>
              <input
                className={champ}
                type="number"
                min={0}
                max={MQ.ELEMENTS_PAR_BARRAGE}
                value={effectif}
                placeholder={presents != null ? String(presents) : ''}
                onChange={(e) => setEffectif(e.target.value)}
                disabled={estVip}
              />
            </label>
          </div>
          <p className="text-[11px] leading-snug text-white/50">
            Créneau en cours · {MQ.ELEMENTS_PAR_BARRAGE} éléments au plus (règle des trois). Les arrivants sont pris
            dans l’effectif de la brigade, parmi ceux qui ne tiennent pas déjà un poste.
          </p>
        </Section>

        <Section titre="Protection">
          <label className="flex items-center gap-2 text-[12px] font-semibold text-white">
            <input type="checkbox" checked={intouchable} onChange={(e) => setIntouchable(e.target.checked)} disabled={estVip} />
            Barrage intouchable
          </label>
          <p className="text-[11px] leading-snug text-white/50">
            {estVip
              ? 'Un barrage VIP est intouchable par nature.'
              : 'Poste permanent de la compagnie (00:00 → 24:00), visible dans toutes les factions, jamais déplacé ni supprimé par la filtration. Un seul par compagnie.'}
          </p>
          {intouchableAvant && !intouchable && (
            <label>
              <span className={etiquette}>Faction du poste redevenu ordinaire</span>
              <select className={champ} value={factionId} onChange={(e) => setFactionId(e.target.value)}>
                <option value="">Conserver l’horaire actuel</option>
                {FACTIONS.map((f) => (
                  <option key={f} value={f}>{LIBELLE_FACTION[f]}</option>
                ))}
              </select>
            </label>
          )}
        </Section>

        {aConfirmer?.intouchableExistant && (
          <div className="mx-4 mb-3 rounded-lg border border-gr-orange/50 bg-gr-orange/10 px-3 py-2 text-[11px] text-white/85" role="alert">
            <p className="font-semibold">Cette Compagnie possède déjà un barrage intouchable.</p>
            <p className="mt-0.5">
              {aConfirmer.intouchableExistant.nom || aConfirmer.intouchableExistant.id}
              {aConfirmer.intouchableExistant.route ? ` (${aConfirmer.intouchableExistant.route})` : ''}.
            </p>
            <label className="mt-1.5 flex items-start gap-2">
              <input type="checkbox" checked={remplacer} onChange={(e) => setRemplacer(e.target.checked)} />
              Voulez-vous remplacer l’intouchable existant par ce barrage&nbsp;? (il redeviendra un barrage normal)
            </label>
          </div>
        )}

        {aConfirmer?.confirmerConflits && (
          <div className="mx-4 mb-3 rounded-lg border border-gr-red/50 bg-gr-red/10 px-3 py-2 text-[11px] text-white/90" role="alert">
            <p className="flex items-center gap-1.5 font-bold text-gr-red"><IconAlert size={13} /> Conflit de distance</p>
            <ul className="mt-1 space-y-1">
              {aConfirmer.conflits.map((c) => (
                <li key={c.id}>
                  {c.nom || c.id}{c.route ? ` · ${c.route}` : ''} — <b>{c.km} km</b> de route (seuil {aConfirmer.seuilKm} km) · faction {c.factions.join(', ')}
                </li>
              ))}
            </ul>
            {aConfirmer.conflitsHorsPerimetre > 0 && (
              <p className="mt-1 text-white/60">+ {aConfirmer.conflitsHorsPerimetre} poste(s) hors de votre périmètre.</p>
            )}
            <label className="mt-1.5 flex items-start gap-2">
              <input type="checkbox" checked={accepterConflits} onChange={(e) => setAccepterConflits(e.target.checked)} />
              Maintenir la modification malgré ce rapprochement (aucun barrage ne sera supprimé).
            </label>
          </div>
        )}

        {erreur && !aConfirmer && (
          <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-lg border border-gr-red/40 bg-gr-red/10 px-3 py-2 text-[11px] text-white" role="alert">
            <IconAlert size={13} className="mt-0.5 shrink-0 text-gr-red" /> {erreur}
          </p>
        )}
      </div>

      <footer className="flex gap-2 border-t border-white/10 px-4 py-3">
        <button type="button" onClick={onFermer} disabled={envoi} className={`${bouton} flex-1 bg-white/10 text-white/85 hover:bg-white/16`}>
          Annuler
        </button>
        <button
          type="button"
          onClick={enregistrer}
          disabled={rien || envoi || (aConfirmer && !confirme)}
          className={`${bouton} flex-1 bg-gr-gold text-gr-navy hover:brightness-110`}
        >
          {envoi ? <IconSpinner size={13} /> : null} Enregistrer
        </button>
      </footer>
      {onFicheComplete && (
        <button type="button" onClick={onFicheComplete} className="pb-2 text-[11px] text-white/45 underline hover:text-white/70">
          Fiche complète (nom, horaires, caractéristiques)…
        </button>
      )}
    </aside>
  );
}
