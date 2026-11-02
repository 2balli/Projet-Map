import { useEffect, useRef, useState } from 'react';
import { IconCrayon, IconPoubelle, IconSpinner, IconCible } from '../../icons.jsx';
import * as MQ from '../../marquages.js';
import { GLYPHS } from '../../glyphs.js';

export const EXCLUSION_FR = {
  entree_ville: 'Entrée de ville',
  sortie_ville: 'Sortie de ville',
  accidents: 'Accidents',
  vip: 'VIP',
  non_eclaire: 'Non éclairé',
};

export const svgGlyphe = (cle) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  GLYPHS[cle].map((d) => `<path d="${d}"/>`).join('') +
  '</svg>';

export const SVG_VERROU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"></rect>' +
  '<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path>' +
  '</svg>';

export const SVG_NUIT =
  '<svg viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M15.2 3.4a9 9 0 1 0 5.4 11.4 7.2 7.2 0 0 1-5.4-11.4Z"/>' +
  '</svg>';

export const FORMES_EXCLUSION = [
  {
    motif: 'accidents',
    suffixe: 'accident',
    mot: 'accidents',
    svg: () => svgGlyphe('accident'),
  },
  {
    motif: 'vip',
    suffixe: 'vip',
    mot: 'mission VIP',
    svg: () => svgGlyphe('mission'),
  },
  {
    motif: 'non_eclaire',
    suffixe: 'nuit',
    mot: 'axe non éclairé',
    svg: () => SVG_NUIT,
  },
];

export function formeExclusion(protections) {
  const motifs = protections ?? [];
  const trouvee = FORMES_EXCLUSION.find((f) => motifs.includes(f.motif));
  if (!trouvee) {
    return {
      classe: '',
      classeBandeau: '',
      svg: SVG_VERROU,
      mot: 'intouchable',
    };
  }
  return {
    classe: `gr-exclu-${trouvee.suffixe}`,
    classeBandeau: `gr-popup-exclu-${trouvee.suffixe}`,
    svg: trouvee.svg(),
    mot: trouvee.mot,
  };
}

/**
 * Menu d'actions (Modifier / Déplacer / Supprimer) dans la popup d'un repère.
 *
 * « Déplacer » N'EFFECTUE RIEN : il rend le repère saisissable, et c'est tout.
 * Sans ce geste, aucun repère ne suit la souris — voir `armeDeplacement` dans
 * GendarmerieMap.jsx. Une coordonnée de barrage ne doit pas pouvoir changer
 * parce qu'on a voulu faire glisser la carte d'est en ouest.
 */
export function CommandesPopup({
  m,
  onModifier,
  onSupprimer,
  onArmerDeplacement,
  /* Vrai quand la session a le droit de retirer un poste en attente. */
  peutRetirer = false,
  /* « Changer la faction » — ouvre la boîte de confirmation (ChangerFaction.jsx). */
  onChangerFaction = null,
  estAdmin = false,
  onAssigner = null,
}) {
  const [confirme, setConfirme] = useState(false);
  const [traiter, setTraiter] = useState(false);
  if (MQ.estBarrage(m)) {
    if (estAdmin) {
      return null;
    }
    return (
      <TraiterBarrage
        m={m}
        ouvert={traiter}
        onBasculer={() => setTraiter((t) => !t)}
        onModifier={onModifier}
        onSupprimer={onSupprimer}
        onArmerDeplacement={onArmerDeplacement}
        onChangerFaction={onChangerFaction}
        peutRetirer={peutRetirer}
      />
    );
  }
  /**
   * QUAND LA CORBEILLE APPARAÎT.
   *
   * Toutes les natures s'effacent de la même façon, barrage compris.
   *
   * Le barrage a longtemps fait exception : son retrait devait passer par
   * OPTIMISATION, puis — première ouverture — il se retirait s'il était encore
   * EN ATTENTE et qu'on en était l'auteur. Les deux conditions ont été
   * retirées côté serveur (voir la note sur la suppression dans
   * serveur/api.mjs) : le droit d'effacer est le droit d'écrire, rien de plus.
   *
   * Le retrait CONCERTÉ d'un poste en service reste dans OPTIMISATION. C'est
   * une décision, pas un effacement, et elle a son propre écran.
   */
  const barrage = MQ.estBarrage(m);
  /* Le STATUT du barrage n'entre plus dans le calcul : un poste ajouté à la
     main doit pouvoir être défait, or celui que pose l'administrateur est
     approuvé d'emblée et devenait donc indéracinable. Seul compte le droit,
     que `peutRetirer` porte déjà (voir GendarmerieMap.jsx). */
  const effacable = (!barrage || peutRetirer) && !MQ.estIntouchable(m);

  return (
    <div className={effacable || onArmerDeplacement ? 'gr-popup-actions' : ''}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onModifier(m.id);
        }}
        className="gr-popup-act"
        style={effacable ? undefined : { width: '100%' }}
      >
        <IconCrayon size={13} /> Modifier
      </button>
      {/* PAS DE « DÉPLACER » NI DE « SUPPRIMER » SUR UN POSTE INTOUCHABLE. Sa
          position et son existence sont définitives : offrir ces boutons ne
          mènerait qu'à un refus du serveur, et un geste rejeté sans raison
          visible se lit comme une panne. */}
      {onArmerDeplacement && !MQ.estIntouchable(m) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArmerDeplacement(m);
          }}
          title="Rend ce repère saisissable. Le déplacement sera confirmé avant enregistrement."
          className="gr-popup-act"
        >
          <IconCible size={13} /> Déplacer
        </button>
      )}
      {effacable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!confirme) {
              setConfirme(true);
              return;
            }
            onSupprimer(m.id);
          }}
          onBlur={() => setConfirme(false)}
          className={`gr-popup-act ${confirme ? 'gr-popup-act-danger' : ''}`}
        >
          <IconPoubelle size={13} /> {confirme ? 'Confirmer ?' : barrage ? 'Retirer' : 'Supprimer'}
        </button>
      )}
    </div>
  );
}

/**
 * « TRAITER » — les trois gestes sur un barrage, et eux seuls :
 *
 *   EFFACER    le mécanisme de suppression existant (DELETE), confirmé par un
 *              second clic. Un poste rattaché part en validation : il reste
 *              en place, marqué « retrait en attente », jusqu'à la décision ;
 *   DÉPLACER   le mode déplacement existant : clic sur la carte, repère
 *              provisoire recalé sur la route, puis « Enregistrer » ou annuler ;
 *   CHANGER LA FACTION  une boîte qui montre la faction actuelle et celle
 *              d'arrivée, parmi les factions définies, et demande confirmation.
 *
 * Les règles restent celles du serveur — droits, périmètre, validation. Un
 * Intouchable garde sa position, son existence et son service sur toutes les
 * factions : les trois gestes sont montrés, désactivés, avec la raison.
 */
function TraiterBarrage({ m, ouvert, onBasculer, onModifier, onSupprimer, onArmerDeplacement, onChangerFaction, peutRetirer }) {
  const [confirme, setConfirme] = useState(false);
  const menu = useRef(null);
  /* La bulle d'un barrage est haute : le menu s'ouvre sous le pli. */
  useEffect(() => {
    if (ouvert) menu.current?.scrollIntoView({ block: 'nearest' });
  }, [ouvert]);
  const intouchable = MQ.estIntouchable(m);
  const raisonIntouchable = 'Barrage intouchable : position, existence et service sur toutes les factions sont définitifs.';
  return (
    <div className="gr-popup-traiter">
      <div className="gr-popup-actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onModifier(m.id);
          }}
          className="gr-popup-act"
        >
          <IconCrayon size={13} /> Modifier
        </button>
        <button
          type="button"
          aria-expanded={ouvert}
          onClick={(e) => {
            e.stopPropagation();
            setConfirme(false);
            onBasculer();
          }}
          className={`gr-popup-act ${ouvert ? 'gr-popup-act-actif' : ''}`}
        >
          Traiter {ouvert ? '▴' : '▾'}
        </button>
      </div>
      {ouvert && (
        <div ref={menu} role="menu" aria-label="Traiter le barrage" className="gr-popup-traiter-menu">
          <button
            type="button"
            role="menuitem"
            disabled={intouchable || !peutRetirer || !onSupprimer}
            title={intouchable ? raisonIntouchable : 'Le retrait d’un poste rattaché est soumis à validation.'}
            onClick={(e) => {
              e.stopPropagation();
              if (!confirme) {
                setConfirme(true);
                return;
              }
              setConfirme(false);
              onBasculer();
              onSupprimer(m.id);
            }}
            onBlur={() => setConfirme(false)}
            className={`gr-popup-act ${confirme ? 'gr-popup-act-danger' : ''}`}
          >
            <IconPoubelle size={13} /> {confirme ? 'Confirmer l’effacement ?' : 'Effacer le barrage'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={intouchable || !onArmerDeplacement}
            title={intouchable ? raisonIntouchable : 'Choisissez la nouvelle position sur la carte ; elle sera confirmée avant enregistrement.'}
            onClick={(e) => {
              e.stopPropagation();
              /* Le menu se replie : la bulle rouverte repart de « Traiter ▾ ». */
              onBasculer();
              onArmerDeplacement(m);
            }}
            className="gr-popup-act"
          >
            <IconCible size={13} /> Déplacer le barrage
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={intouchable || !onChangerFaction}
            title={intouchable ? raisonIntouchable : onChangerFaction ? 'Choisir une autre faction parmi celles autorisées.' : 'Réservé au CMND CIE et au CMND Région.'}
            onClick={(e) => {
              e.stopPropagation();
              onBasculer();
              onChangerFaction(m);
            }}
            className="gr-popup-act"
          >
            ⇄ Changer la faction
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * « POURQUOI ? » — l'explication d'un poste, tirée de SES données, sans rien inventer.
 *
 * `distanceKm` et `voisinNom` : le conflit mesuré ; `seuilKm` : le seuil qui
 * l'a déclaré ; `decision` : le verdict du serveur (type, statut, distances
 * après, conflit restant, motif de refus). Sans voisin ni distance, aucune
 * phrase de conflit n'est écrite.
 */
export function ExplicationOptimisation({
  nom, distanceKm = null, seuilKm = null, voisinNom = null, decision = null, intouchable = false, seuilDeplacementKm = null, estAdmin = false,
}) {
  const km = (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)} km` : '—');
  const enConflit = distanceKm != null && seuilKm != null && Number(distanceKm) < Number(seuilKm);
  let libelleDecision;
  if (intouchable) libelleDecision = 'PROTÉGÉ — NON DÉPLAÇABLE';
  else if (estAdmin) libelleDecision = enConflit ? 'À ASSIGNER AU CMND RÉGION' : 'AUCUN CONFLIT';
  else if (decision?.statut === 'refuse') libelleDecision = `REFUSÉE — ${decision.raison}`;
  else if (decision?.type === 'deplacer') libelleDecision = 'DÉPLACEMENT PROPOSÉ';
  else if (decision?.type === 'supprimer') libelleDecision = 'RETRAIT PROPOSÉ';
  else if (decision?.type === 'conserver') libelleDecision = 'CONSERVÉ';
  else libelleDecision = enConflit ? 'À TRANCHER' : 'AUCUNE';
  let pourquoi = null;
  if (voisinNom && enConflit) {
    if (intouchable || decision?.type === 'conserver') {
      const restant = decision?.type === 'conserver' ? decision.conflitRestant !== false : true;
      pourquoi = restant
        ? `Ce barrage reste en conflit avec ${voisinNom} : ${km(decision?.distanceApresKm ?? distanceKm)} par la route, sous ${seuilKm} km.`
        : `Conservé : son conflit avec ${voisinNom} n’existe plus dans l’état simulé.`;
    } else {
      pourquoi = `Ce barrage est trop rapproché de ${voisinNom} : ${km(distanceKm)} par la route, sous le seuil de ${seuilKm} km.`;
    }
  } else if (intouchable) {
    pourquoi = 'Poste permanent : la filtration ne le déplace ni ne le retire.';
  }
  return (
    <div className="gr-pourquoi" data-gr-pourquoi="1" style={{ marginTop: 6, padding: '6px 7px', borderRadius: 6, background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)', fontSize: 10.5, lineHeight: 1.45 }}>
      {intouchable && <div style={{ fontWeight: 800, color: 'var(--tone-amber)' }}>🔒 INTOUCHABLE</div>}
      {nom && <div style={{ fontWeight: 700 }}>{nom}</div>}
      {distanceKm != null && (
        <div>Distance actuelle : <b>{km(distanceKm)}</b> {seuilKm == null ? '' : enConflit ? '❌' : '✓'}</div>
      )}
      {seuilKm != null && <div>Seuil : {seuilKm} km</div>}
      <div>Décision : <b>{libelleDecision}</b></div>
      {decision?.type === 'deplacer' && decision.statut === 'simule' && (
        <div>
          AVANT <b>{km(decision.distanceAvantKm)}</b> ❌ → APRÈS <b>{km(decision.distanceApresKm)}</b>{' '}
          {decision.conflitRestant ? '❌' : '✓'}
          {seuilDeplacementKm != null && <span style={{ opacity: 0.7 }}> (déplacement au seuil de {seuilDeplacementKm} km)</span>}
        </div>
      )}
      {pourquoi && (
        <div style={{ marginTop: 3 }}>
          <b>Pourquoi ?</b> {pourquoi}
        </div>
      )}
    </div>
  );
}

/**
 * LES TROIS DÉCISIONS SIMULÉES D'UN CONFLIT — CONSERVER, DÉPLACER, SUPPRIMER.
 *
 * Aucune n'écrit : chacune est enregistrée dans la simulation d'optimisation,
 * que le serveur recalcule aussitôt. Rien n'est persisté avant « Activer les
 * modifications ». Un poste protégé (Intouchable, porte de ville) n'a que
 * CONSERVER — le serveur refuse de toute façon le reste.
 *
 * `decision` : ce que le serveur a rendu pour ce poste — type, statut
 * (« simule » / « refuse »), distances avant/après, conflit restant.
 */
export function ActionsSimulation({
  decision = null,
  protege = false,
  enCours = false,
  seuilKm = null,
  onDecider,
  explication = null,
  estAdmin = false,
  onAssigner = null,
  barrage = null,
}) {
  const km = (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)} km` : '—');
  /* SUPPRIMER demande une confirmation explicite : le retrait sera proposé au
     commandement, rien n'est supprimé sur-le-champ. */
  const [confirmerRetrait, setConfirmerRetrait] = useState(false);
  const bouton = (type, libelle) => {
    const actif = decision?.type === type;
    return (
      <button
        type="button"
        disabled={enCours}
        aria-pressed={actif}
        title={type === 'deplacer'
          ? 'Choisir la nouvelle position sur la carte — simulé, rien n’est écrit'
          : actif ? 'Retirer cette décision de la simulation' : `${libelle} — simulé, rien n'est écrit`}
        className={`gr-popup-act ${actif ? 'gr-popup-act-actif' : ''} ${type === 'supprimer' ? 'gr-popup-act-danger' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          if (type === 'supprimer' && !actif) {
            setConfirmerRetrait(true);
            return;
          }
          onDecider?.(type);
        }}
      >
        {enCours && actif ? <IconSpinner size={12} /> : null} {type === 'deplacer' && actif ? 'Modifier la position' : libelle}
      </button>
    );
  };
  let etat = null;
  if (decision?.statut === 'refuse') {
    etat = <span style={{ color: 'var(--tone-warn)' }}>⚠ Refusé — {decision.raison}</span>;
  } else if (decision?.type === 'conserver') {
    etat = decision.conflitRestant
      ? <span style={{ color: 'var(--tone-warn)' }}>⚠ Conservé — conflit restant : {km(decision.distanceApresKm)}</span>
      : <span style={{ color: 'var(--tone-ok)' }}>✓ CONSERVÉ</span>;
  } else if (decision?.type === 'deplacer') {
    etat = (
      <span style={{ color: 'var(--tone-info)' }}>
        ↗ DÉPLACEMENT PROPOSÉ — AVANT {km(decision.distanceAvantKm)} ❌ → APRÈS {km(decision.distanceApresKm)}{' '}
        {decision.conflitRestant ? '❌' : '✓'}
      </span>
    );
  } else if (decision?.type === 'supprimer') {
    etat = (
      <span style={{ color: 'var(--tone-danger)' }}>
        ⚠ SUPPRESSION PROPOSÉE — soumise au commandement à l’activation, rien n’est effacé avant.
      </span>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      {protege && (
        <p style={{ margin: '0 0 4px', fontSize: 10.5, fontWeight: 700, color: 'var(--tone-amber)' }}>
          🔒 INTOUCHABLE / PROTÉGÉ — ni déplacement ni suppression
        </p>
      )}
      {estAdmin ? (
        <div className="gr-popup-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssigner?.(barrage || { id: explication?.nom });
            }}
            className="gr-popup-act"
            style={{
              width: '100%',
              background: '#F59E0B',
              color: '#0B1B2D',
              fontWeight: 800,
              padding: '8px 10px',
              fontSize: 11.5,
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span>➜ Assigner au CMND Région</span>
          </button>
        </div>
      ) : (
        <>
          <div className="gr-popup-actions">
            {bouton('conserver', 'Conserver')}
            {!protege && bouton('deplacer', 'Déplacer')}
            {!protege && bouton('supprimer', 'Supprimer')}
          </div>
          {confirmerRetrait && !protege && (
            <div data-gr-confirmer-retrait="1" style={{ marginTop: 6, padding: '6px 7px', borderRadius: 6, border: '1px solid rgba(225,29,46,0.5)', background: 'rgba(225,29,46,0.1)' }}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 11 }}>Supprimer ce barrage ?</p>
              <p style={{ margin: '3px 0 6px', fontSize: 10.5, lineHeight: 1.4 }}>
                Le retrait sera proposé au commandement. Le barrage ne sera pas supprimé immédiatement.
              </p>
              <div className="gr-popup-actions">
                <button type="button" className="gr-popup-act" onClick={(e) => { e.stopPropagation(); setConfirmerRetrait(false); }}>
                  Annuler
                </button>
                <button
                  type="button"
                  className="gr-popup-act gr-popup-act-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmerRetrait(false);
                    onDecider?.('supprimer');
                  }}
                >
                  Confirmer le retrait
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {etat && !estAdmin && <p style={{ margin: '5px 0 0', fontSize: 10.5, lineHeight: 1.4, fontWeight: 700 }}>{etat}</p>}
      {explication && <ExplicationOptimisation {...explication} decision={decision} intouchable={protege} estAdmin={estAdmin} />}
      <p style={{ margin: '4px 0 0', fontSize: 9.5, opacity: 0.6 }}>
        {estAdmin
          ? `Filtration au seuil de ${seuilKm ?? 20} km — Super Admin : assigner ce barrage au CMND Région pour traitement.`
          : `Simulation${seuilKm != null ? ` au seuil de ${seuilKm} km` : ''} — rien n’est enregistré avant « Activer les modifications ».`}
      </p>
    </div>
  );
}

/**
 * Bulle de décision pour un barrage trop rapproché (Retirer / Conserver).
 */
export function DecisionPopup({
  m,
  mesure,
  etat = 'aucune',
  empiles = 1,
  onDecider,
  /**
   * LA DEMANDE DE RETRAIT SOUMISE À CE COMPTE, si elle l'est.
   *
   * « Retrait proposé — en attente du commandant » : quand ce commandant,
   * c'est celui qui ouvre la bulle, l'attente n'a plus lieu d'être. Il répond
   * ici, devant le terrain concerné, au lieu d'aller chercher la cloche.
   *
   * `null` pour tous les autres comptes — la règle est dans
   * src/instructionsRegles.js, et le serveur tranche pour de bon.
   */
  demande = null,
  /** Accepte ou refuse cette demande : (instruction, 'accepter'|'refuser'). */
  onDeciderDemande,
  /**
   * Emplacement libre en bas de bulle — la carte y place l'effectif du
   * créneau. Un emplacement plutôt qu'un import : ce fichier ne connaît ni
   * l'API ni les créneaux, et n'a pas à les connaître pour les afficher.
   */
  enPied = null,
  /**
   * LA SIMULATION EN COURS, si le panneau d'optimisation en porte une :
   * `{ decision, protege, enCours, seuilKm, onDecider(type) }`. Présente, elle
   * REMPLACE les gestes immédiats Supprimer / Conserver : les trois décisions
   * sont alors simulées, et rien n'est écrit avant l'activation.
   */
  simulation = null,
  /** Le voisin du conflit, nommé : « A ↔ B ». */
  voisinNom = null,
  estAdmin = false,
  onAssigner = null,
}) {
  const [confirme, setConfirme] = useState(false);
  const [occupe, setOccupe] = useState(null);

  const decider = async (choix) => {
    if (occupe) return;
    setOccupe(choix);
    try {
      await onDecider?.(m, choix);
    } finally {
      setOccupe(null);
    }
  };

  /* Le même verrou, pour l'autre nature de geste : celui-ci ne pose pas une
     marque, il répond à une demande ouverte — et l'accepter EFFACE le poste. */
  const repondre = async (reponse) => {
    if (occupe) return;
    setOccupe(reponse);
    try {
      await onDeciderDemande?.(demande, reponse);
    } finally {
      setOccupe(null);
    }
  };

  const TITRE = {
    aucune: 'Barrage trop rapproché',
    a_supprimer: 'Retrait proposé — en attente du commandant',
    conserve: 'Maintenu par décision',
  };

  return (
    <div className="gr-popup">
      <h4>{TITRE[etat]}</h4>
      <table className="gr-tbl">
        <tbody>
          <tr>
            <td>Barrage</td>
            <td>
              🔴 {m.id} — {m.nom || '(sans nom)'}
            </td>
          </tr>
          {voisinNom && (
            <tr>
              <td>En conflit avec</td>
              <td>↔ 🔴 {voisinNom}</td>
            </tr>
          )}
          {m.route && (
            <tr>
              <td>Axe</td>
              <td>{m.route}</td>
            </tr>
          )}
          <tr>
            <td>Distance</td>
            <td>
              {mesure?.texte ?? '—'}
              {mesure?.texte?.startsWith('0 km') && (
                <>
                  <br />
                  <span style={{ color: 'var(--tone-danger)' }}>même emplacement exactement</span>
                </>
              )}
            </td>
          </tr>
          {mesure?.seuil != null && (
            <tr>
              <td>Seuil demandé</td>
              <td>{mesure.seuil} km</td>
            </tr>
          )}
          {mesure?.criteres?.accidents != null && (
            <tr>
              <td>Accidents</td>
              <td>{mesure.criteres.accidents}</td>
            </tr>
          )}
          {mesure?.criteres?.vip != null && (
            <tr>
              <td>Mission VIP</td>
              <td>{mesure.criteres.vip ? 'oui' : 'non'}</td>
            </tr>
          )}
          {mesure?.criteres?.nonEclaire != null && (
            <tr>
              <td>Éclairage</td>
              <td>{mesure.criteres.nonEclaire ? 'axe non éclairé' : 'éclairé'}</td>
            </tr>
          )}
        </tbody>
      </table>

      {empiles > 1 && (
        <p
          style={{
            margin: '6px 0 0',
            padding: '5px 7px',
            borderRadius: 6,
            background: 'rgba(234, 179, 8, 0.15)',
            color: 'var(--tone-warn)',
            fontSize: 10.5,
            lineHeight: 1.4,
          }}
        >
          <b>{empiles} barrages sont posés exactement ici.</b> Leurs repères se superposent : en
          traiter un fait apparaître le suivant au même endroit.
        </p>
      )}

      {simulation ? (
        <ActionsSimulation {...simulation} estAdmin={simulation.estAdmin ?? estAdmin} onAssigner={simulation.onAssigner ?? onAssigner} barrage={m} />
      ) : etat === 'aucune' ? (
        estAdmin ? (
          <div className="gr-popup-actions" style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAssigner?.(m);
              }}
              className="gr-popup-act"
              style={{
                width: '100%',
                background: '#F59E0B',
                color: '#0B1B2D',
                fontWeight: 800,
                padding: '7px 10px',
                fontSize: 11.5,
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ➜ Assigner au CMND Région
            </button>
          </div>
        ) : (
          <div className="gr-popup-actions">
            <button
              type="button"
              disabled={Boolean(occupe)}
              className={`gr-popup-act ${confirme ? 'gr-popup-act-danger' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!confirme) {
                  setConfirme(true);
                  return;
                }
                decider('retirer');
              }}
            >
              {occupe === 'retirer' ? (
                <>
                  <IconSpinner size={13} /> Envoi…
                </>
              ) : confirme ? (
                'Confirmer ?'
              ) : (
                'Supprimer'
              )}
            </button>
            <button
              type="button"
              disabled={Boolean(occupe)}
              className="gr-popup-act"
              onClick={(e) => {
                e.stopPropagation();
                decider('garder');
              }}
            >
              {occupe === 'garder' ? (
                <>
                  <IconSpinner size={13} /> Envoi…
                </>
              ) : (
                'Conserver'
              )}
            </button>
          </div>
        )
      ) : demande ? (
        /**
         * LA DÉCISION DU COMMANDANT, DEVANT LE TERRAIN.
         *
         * Elle ne s'affiche que pour le compte à qui le retrait est soumis.
         * CONFIRMER efface réellement le poste — c'est le seul geste de cette
         * bulle qui retire quelque chose, et il passe par le même chemin
         * serveur que toute autre suppression. REFUSER rend le poste à son
         * état d'avant, sans qu'il reste rien à recréer à la main.
         *
         * L'arbitrage « Confirmer / Refuser » de l'auteur de la proposition
         * (branche suivante) n'est PAS montré en même temps : quatre boutons
         * pour deux questions différentes, c'est une question de trop. Celui
         * qui tranche prime sur celui qui propose.
         */
        <div style={{ marginTop: 6 }}>
          <p
            style={{
              margin: '0 0 4px',
              fontSize: 10.5,
              lineHeight: 1.4,
              color: 'var(--accent)',
            }}
          >
            <b>DÉCISION</b> — ce retrait vous est soumis.
          </p>
          <div className="gr-popup-actions">
            <button
              type="button"
              disabled={Boolean(occupe)}
              className="gr-popup-act gr-popup-act-danger"
              title="Confirmer le retrait — le poste est effacé du dispositif"
              onClick={(e) => {
                e.stopPropagation();
                repondre('accepter');
              }}
            >
              {occupe === 'accepter' ? (
                <>
                  <IconSpinner size={13} /> Envoi…
                </>
              ) : (
                'Confirmer'
              )}
            </button>
            <button
              type="button"
              disabled={Boolean(occupe)}
              className="gr-popup-act"
              title="Refuser le retrait — le poste reste en service, tel qu'il était"
              onClick={(e) => {
                e.stopPropagation();
                repondre('refuser');
              }}
            >
              {occupe === 'refuser' ? (
                <>
                  <IconSpinner size={13} /> Envoi…
                </>
              ) : (
                'Refuser'
              )}
            </button>
          </div>
        </div>
      ) : onDecider ? (
        /**
         * REVENIR SUR SA PROPRE PROPOSITION — en la nommant.
         *
         * Un bouton unique « Revenir sur cette décision » ne disait pas ce
         * qu'il rendait. Les deux gestes portent désormais leur nom, comme
         * dans la liste du panneau Optimisation : CONFIRMER maintient le
         * poste, REFUSER en propose le retrait. Celui qui correspond à la
         * décision en cours reste allumé et inerte : il dit où l'on en est.
         */
        <div className="gr-popup-actions" style={{ marginTop: 6 }}>
          <button
            type="button"
            disabled={Boolean(occupe) || etat === 'conserve'}
            className="gr-popup-act"
            title={
              etat === 'conserve'
                ? 'Poste maintenu — décision déjà rendue'
                : 'Maintenir ce poste — la proposition de retrait est retirée'
            }
            onClick={(e) => {
              e.stopPropagation();
              decider('garder');
            }}
          >
            {occupe === 'garder' ? (
              <>
                <IconSpinner size={13} /> Envoi…
              </>
            ) : (
              'Confirmer'
            )}
          </button>
          <button
            type="button"
            disabled={Boolean(occupe) || etat === 'a_supprimer'}
            className="gr-popup-act"
            title={
              etat === 'a_supprimer'
                ? 'Retrait déjà proposé — en attente du commandant'
                : "Proposer le retrait de ce poste — rien n'est effacé sans accord"
            }
            onClick={(e) => {
              e.stopPropagation();
              decider('retirer');
            }}
          >
            {occupe === 'retirer' ? (
              <>
                <IconSpinner size={13} /> Envoi…
              </>
            ) : (
              'Refuser'
            )}
          </button>
        </div>
      ) : estAdmin ? (
        <div style={{ marginTop: 6 }}>
          <p
            style={{
              margin: '0 0 4px',
              fontSize: 10.5,
              lineHeight: 1.4,
              color: 'var(--accent)',
            }}
          >
            Filtration — Super Admin : assigner ce barrage au CMND Région pour traitement.
          </p>
          <div className="gr-popup-actions">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAssigner?.(m);
              }}
              className="gr-popup-act"
              style={{
                width: '100%',
                background: '#F59E0B',
                color: '#0B1B2D',
                fontWeight: 800,
                padding: '7px 10px',
                fontSize: 11.5,
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ➜ Assigner au CMND Région
            </button>
          </div>
        </div>
      ) : (
        <p
          style={{
            margin: '6px 0 0',
            fontSize: 10.5,
            lineHeight: 1.4,
            color: 'var(--accent)',
          }}
        >
          Décision enregistrée.
        </p>
      )}

      <p
        style={{
          margin: '6px 0 0',
          fontSize: 10.5,
          lineHeight: 1.4,
          color: 'var(--text-secondary)',
        }}
      >
        {estAdmin
          ? 'Super Admin : rôle de filtration uniquement. Aucun droit de modification ou suppression directe.'
          : etat === 'a_supprimer'
            ? 'Le retrait est PROPOSÉ : rien n’est encore effacé. Le commandant concerné a été notifié et doit accepter ou refuser.'
            : etat === 'conserve'
              ? 'Le poste est maintenu malgré le rapprochement. Le commandant concerné a été notifié.'
              : 'Supprimer PROPOSE le retrait au commandant — rien n’est effacé sans son accord. Conserver ne modifie pas le poste.'}
      </p>
      {enPied}
    </div>
  );
}

/**
 * Bulle d'explication pour un poste intouchable/exclu.
 */
export function ExclusionPopup({ m, exclusion, enPied = null, simulation = null }) {
  const motifs = exclusion?.protections ?? [];
  const forme = formeExclusion(motifs);

  return (
    <div className="gr-popup">
      <h4>{MQ.libelle(m)}</h4>
      <p className={`gr-popup-exclu ${forme.classeBandeau}`}>
        {forme.classeBandeau ? `Exclu — ${forme.mot}` : 'Exclu de la filtration'}
      </p>
      <table className="gr-tbl">
        <tbody>
          <tr>
            <td>Motif</td>
            <td>{motifs.map((p) => EXCLUSION_FR[p] ?? p).join(' + ') || 'Protégé'}</td>
          </tr>
          {exclusion?.accidents != null && (
            <tr>
              <td>Accidents</td>
              <td>
                {exclusion.accidents}
                {motifs.includes('accidents') && exclusion.seuilAccidents != null
                  ? ` (exclu à partir de ${exclusion.seuilAccidents})`
                  : ''}
              </td>
            </tr>
          )}
          {exclusion?.distanceKm != null && (
            <tr>
              <td>Voisin</td>
              <td>
                {exclusion.distanceKm} km
                {exclusion.voisinNom ? ` — ${exclusion.voisinNom}` : ''}
                {exclusion.seuilKm != null ? ` (seuil ${exclusion.seuilKm} km)` : ''}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="gr-popup-note">
        Ce poste reste sur la carte, mais la filtration ne peut ni le supprimer ni le modifier.
      </p>
      {enPied}
      {simulation && <ActionsSimulation {...simulation} protege />}
    </div>
  );
}
