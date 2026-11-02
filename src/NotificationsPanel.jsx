/**
 * NOTIFICATIONS — ce qui remonte au commandement, et ce qu'il en décide.
 *
 * POURQUOI CE PANNEAU EXISTE
 * --------------------------
 * Le dépôt et les routes existaient déjà (`serveur/instructions.mjs`,
 * `/api/instructions`) : un message rattaché à un barrage, avec destinataire,
 * statut et réponse écrite. Ce qui manquait, c'était l'écran. Sans lui, une
 * décision partait dans un fichier JSON que personne n'ouvrait jamais.
 *
 * QUATRE CAS, UN SEUL FLUX
 * ------------------------
 *   suppression     — le Super Admin propose de retirer un poste. Rien n'est
 *                     effacé : c'est l'ACCEPTATION ici qui l'efface, et le
 *                     refus qui rend le poste à son état d'avant.
 *   conservation    — il propose de le maintenir malgré un rapprochement.
 *   nouveau_barrage — un poste vient d'être posé sur le terrain. Le camp qui
 *                     ne l'a pas posé en décide : une unité pose,
 *                     l'administrateur approuve ou refuse ; l'administrateur
 *                     pose, l'unité accuse réception. Refuser retire le poste.
 *   instruction     — le cas d'origine, un ordre écrit sur un barrage.
 *
 * CE QUE LE SERVEUR GARANTIT, ET QUE CE PANNEAU N'A PAS À REFAIRE : chacun ne
 * reçoit que ce qui relève de son périmètre (voir `dansSonUnite`), et seul ce
 * périmètre peut trancher. Le filtre d'ici n'est qu'un confort de lecture.
 */
import { usePresence } from './usePresence.js';
import { useCallback, useMemo, useState } from 'react';
import {
  IconAlert,
  IconTarget,
  IconBarrageFixe,
  IconBarrageMobile,
  IconFleche,
} from './icons.jsx';
import { Parcours, Cartouche, Choix, Recap, Note } from './Parcours.jsx';

const bouton =
  'flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

/**
 * Apparence par nature d'événement. Les mêmes symboles que sur la carte — la
 * notification et le repère doivent se reconnaître l'un l'autre au premier
 * coup d'œil, sinon il faut lire pour faire le lien.
 */
const ALLURE = {
  suppression: {
    signe: '✗',
    fr: 'Retrait proposé',
    ar: 'اقتراح سحب',
    teinte: 'text-amber-500',
    bord: 'border-amber-500/30 bg-amber-500/8',
  },
  conservation: {
    signe: '✓',
    fr: 'Poste maintenu',
    ar: 'الإبقاء على الحاجز',
    teinte: 'text-gr-green',
    bord: 'border-gr-green/25 bg-gr-green/5',
  },
  nouveau_barrage: {
    signe: '!',
    fr: 'Nouveau barrage',
    ar: 'حاجز جديد',
    teinte: 'text-gr-gold',
    bord: 'border-gr-gold/30 bg-gr-gold/8',
  },
  modification: {
    signe: '✎',
    fr: 'Modification demandée',
    ar: 'طلب تعديل',
    teinte: 'text-sky-400',
    bord: 'border-sky-400/30 bg-sky-400/8',
  },
  reclamation: {
    signe: '!',
    fr: 'Réclamation',
    ar: 'تظلم',
    teinte: 'text-amber-400',
    bord: 'border-amber-400/35 bg-amber-400/10',
  },
  assignation: {
    signe: '➜',
    fr: 'Barrage assigné à votre région',
    ar: 'حاجز مسند إلى جهتكم',
    teinte: 'text-sky-300',
    bord: 'border-sky-400/30 bg-sky-400/8',
  },
  instruction: {
    signe: '✉',
    fr: 'Instruction',
    ar: 'تعليمة',
    teinte: 'text-white/70',
    bord: 'border-white/12 bg-white/5',
  },
  demande_approbation: {
    signe: '⚖',
    fr: 'Demande d’approbation',
    ar: 'طلب اعتماد',
    teinte: 'text-purple-300',
    bord: 'border-purple-400/35 bg-purple-400/10',
  },
};

const quand = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * UNE LIGNE DE LA LISTE — compacte, et rien de plus.
 *
 * Chaque ligne se dépliait sur place : un tableau de treize lignes, un bouton
 * de cadrage, une zone de commentaire et deux boutons de décision. Deux
 * notifications ouvertes remplissaient l'écran, et l'on tranchait au milieu
 * d'un empilement où plus rien ne ressortait.
 *
 * La ligne ne fait donc plus qu'annoncer, et le clic ouvre le parcours de
 * décision — centré, une question à la fois.
 */
function LigneNotification({ n, onOuvrir }) {
  const a = ALLURE[n.action] ?? ALLURE.instruction;
  const traitee = n.statut === 'traitee';

  return (
    <li>
      <button
        type="button"
        onClick={() => onOuvrir(n)}
        className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left
          transition-colors duration-150 hover:bg-white/8 motion-reduce:transition-none
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
          ${a.bord} ${traitee ? 'opacity-60' : ''}`}
      >
        <span
          className={`mt-px shrink-0 text-[16px] font-black leading-none ${a.teinte}`}
          aria-hidden="true"
        >
          {a.signe}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className={`text-[11px] font-bold ${a.teinte}`}>{a.fr}</span>
            {traitee && (
              <span className="text-[9.5px] font-bold uppercase tracking-wide text-white/40">
                {n.decision === 'acceptee'
                  ? '· acceptée'
                  : n.decision === 'refusee'
                    ? '· refusée'
                    : '· traitée'}
              </span>
            )}
          </span>
          <span className="block truncate text-[12.5px] font-semibold text-white/90">
            {n.barrage?.nom || 'Barrage sans nom'}
          </span>
          <span className="block truncate text-[10.5px] text-white/45">
            {[n.barrage?.reg, n.barrage?.cie].filter(Boolean).join(' · ')} — {quand(n.cree)}
          </span>
          {n.action === 'assignation' && (
            <span className="mt-1 block rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              ⚠️ Problème : {n.criteres?.distanceKm ? `Conflit distance ${n.criteres.distanceKm} km` : (n.texte || 'À traiter par votre région')}
            </span>
          )}
        </span>
        <IconFleche size={15} className="mt-1 shrink-0 text-white/30" />
      </button>
    </li>
  );
}

/**
 * LE PARCOURS D'UNE DÉCISION.
 *
 * Deux temps : on LIT ce qui est demandé, puis on RÉPOND. Les deux tenaient
 * dans le même repli, si bien qu'on voyait les boutons avant d'avoir lu le
 * tableau qui les justifie.
 *
 * AUCUNE RÈGLE N'A CHANGÉ. `aValider`, `aArbitrer` et `peutDecider` sont ceux
 * d'avant, au caractère près, et le serveur tranche pour de bon de son côté.
 * Une notification déjà traitée, ou hors de la main de ce compte, n'a qu'une
 * seule étape : il n'y a rien à répondre.
 */
function ParcoursDecision({ n, session, onDecider = null, onCadrer, onFermer, onReclamer, onTraiterAssignation, onTransmettreAssignation }) {
  const [etape, setEtape] = useState(0);
  const [reponse, setReponse] = useState(null); // 'accepter' | 'refuser'
  const [commentaire, setCommentaire] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);

  const a = ALLURE[n.action] ?? ALLURE.instruction;
  const traitee = n.statut === 'traitee';

  /**
   * UN NOUVEAU BARRAGE S'APPROUVE — MAIS PAR L'AUTRE CAMP.
   *
   * `aDecider` dit qui a la main (voir serveur/api.mjs) :
   *   'admin' — une unité a posé, l'administrateur approuve ou refuse ;
   *   'unite' — l'administrateur a posé, le poste est déjà approuvé et l'unité
   *             concernée accuse simplement réception.
   *
   * Refuser retire le poste : un refus qui le laisserait sur la carte, dans les
   * distances et dans les rosters ne voudrait rien dire.
   */
  /**
   * UNE MODIFICATION SE CONFIRME COMME UNE POSE : PLUS HAUT QUE SON AUTEUR.
   *
   * Le barrage officiel n'a pas bougé tant que l'administration n'a pas
   * tranché ; c'est elle, et elle seule, qui décide — un chef ne contresigne
   * pas sa propre demande. Le serveur refuse de toute façon (403), on ne
   * propose donc pas le bouton.
   *
   * Une RÉCLAMATION, elle, ne se tranche pas d'un clic : elle ouvre un dossier
   * que l'administration instruit. Aucun bouton ici — la contestation reste
   * visible, et personne ne peut la « traiter » en la faisant disparaître.
   */
  const [reclamationOuverte, setReclamationOuverte] = useState(false);
  const [motifReclamation, setMotifReclamation] = useState('');
  const [commentaireReclamation, setCommentaireReclamation] = useState('');
  const [envoiReclamation, setEnvoiReclamation] = useState(false);
  const [erreurReclamation, setErreurReclamation] = useState(null);

  /** Une modification CONFIRMÉE, vue par un chef de région ou l'administrateur. */
  const peutReclamer =
    n.action === 'modification' &&
    n.decision === 'acceptee' &&
    (session?.rang === 'reg' || session?.rang === 'admin');

  const aValider =
    (n.action === 'nouveau_barrage' || n.action === 'modification') && n.aDecider === 'admin';
  const aArbitrer = n.action === 'suppression' || n.action === 'conservation' || aValider;

  /* Le serveur tranche pour de bon ; ici on n'affiche que ce qui a un sens. */
  const assignation = n.action === 'assignation';
  const peutDecider =
    !traitee &&
    n.action !== 'reclamation' &&
    /* Une assignation se traite par le CMND Région qui la reçoit. */
    (assignation
      ? session?.rang === 'reg'
      : aValider ? session?.rang === 'admin' : session?.rang === 'admin' || session?.rang !== 'unite');

  const Icone = n.barrage?.type === 'barrage_mobile' ? IconBarrageMobile : IconBarrageFixe;

  const envoyer = async () => {
    if (occupe) return;
    setOccupe(true);
    setErreur(null);
    try {
      await onDecider?.(n, aArbitrer ? reponse : 'accepter', commentaire);
      onFermer();
    } catch (err) {
      setErreur(err?.message ?? 'La décision n’a pas pu être transmise.');
    } finally {
      setOccupe(false);
    }
  };

  const detail = [
    ['Barrage', n.barrage?.nom || '(sans nom)'],
    ['Type', n.barrage?.type === 'barrage_mobile' ? 'Barrage mobile' : 'Barrage fixe'],
    ['Axe', n.barrage?.route || null],
    ['Localisation', n.barrage?.lat != null ? `${n.barrage.lat}, ${n.barrage.lng}` : null],
    ['Région', n.barrage?.reg || null],
    ['Compagnie', n.barrage?.cie || null],
    ['Par', `${n.auteur?.nom || n.auteur?.unite || '—'} (${n.auteur?.rang ?? '—'})`],
    ['Date', quand(n.cree)],
    ...(n.source
      ? [['Source', n.source === 'saisie_terrain' ? 'Saisie terrain' : n.source === 'assignation' ? 'Assignation du Super Admin' : 'Filtration']]
      : []),
    ...(n.criteres?.distanceKm != null
      ? [
          [
            'Distance',
            `${n.criteres.distanceKm} km${
              n.criteres.seuilKm ? ` (seuil ${n.criteres.seuilKm} km)` : ''
            }`,
          ],
        ]
      : []),
    ...(n.criteres?.voisinNom ? [['Voisin', n.criteres.voisinNom]] : []),
    /* Seulement ce qui a été demandé au calcul : `null` = paramètre éteint, et
       se tait au lieu d'afficher un zéro trompeur. */
    ...(n.criteres?.accidents != null ? [['Accidents', String(n.criteres.accidents)]] : []),
    ...(n.criteres?.vip != null ? [['Mission VIP', n.criteres.vip ? 'oui' : 'non']] : []),
    ...(n.criteres?.nonEclaire != null
      ? [['Éclairage', n.criteres.nonEclaire ? 'axe non éclairé' : 'éclairé']]
      : []),
    /**
     * CE QUE LA MODIFICATION CHANGERAIT — ancienne valeur ET nouvelle.
     *
     * Les deux, côte à côte, sur la même ligne : c'est la seule façon de
     * décider sans aller ouvrir la fiche du barrage à côté. L'ancienne valeur
     * est celle figée au moment de la demande, pas relue maintenant — c'est
     * sur celle-là que l'auteur s'est prononcé, et le serveur refuse
     * d'appliquer si elle a bougé depuis.
     */
    ...(Array.isArray(n.changements)
      ? n.changements.map((c) => [
          c.champ,
          `${c.ancienne === null || c.ancienne === '' ? '—' : c.ancienne} → ${
            c.nouvelle === null || c.nouvelle === '' ? '—' : c.nouvelle
          }`,
        ])
      : []),
    ...(n.motif ? [['Motif', n.motif]] : []),
    /* Une réclamation dit sur QUOI elle porte : sans ce lien, on lit une
       contestation sans savoir ce qui est contesté. */
    ...(n.modificationId ? [['Porte sur', `modification ${n.modificationId.slice(-6)}`]] : []),
  ];

  const etapes = [
    {
      cle: 'demande',
      titre: a.fr,
      ar: a.ar,
      aide: n.texte,
      valide: true,
      libelleSuivant: peutDecider ? (aArbitrer ? 'RÉPONDRE' : assignation ? 'MARQUER TRAITÉ' : 'ACCUSER RÉCEPTION') : undefined,
      contenu: (
        <div className="space-y-3">
          {n.action === 'assignation' && (
            <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[12px]">
              <p className="flex items-center gap-1.5 font-bold text-amber-300">
                <IconAlert size={14} className="shrink-0" />
                <span>Problème signalé par le Super Admin</span>
              </p>
              <p className="mt-1 text-white/90">
                {n.texte || 'Barrage signalé en conflit de distance routière ou espacement pour traitement.'}
              </p>
              {n.criteres?.distanceKm != null && (
                <p className="mt-1 font-mono text-[11px] text-amber-200">
                  Distance mesurée : {n.criteres.distanceKm} km {n.criteres.seuilKm ? `(seuil réglementaire ${n.criteres.seuilKm} km)` : ''} {n.criteres.voisinNom ? `· Voisin : ${n.criteres.voisinNom}` : ''}
                </p>
              )}
              {session?.rang === 'reg' && !traitee && (
                <div className="mt-3 flex gap-2 border-t border-amber-500/25 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onFermer();
                      onTraiterAssignation?.(n);
                    }}
                    className={`${bouton} flex-1 bg-gr-gold font-bold text-gr-navy hover:bg-gr-gold/90`}
                  >
                    Traiter ce barrage
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFermer();
                      onTransmettreAssignation?.(n);
                    }}
                    className={`${bouton} flex-1 border border-sky-400/40 bg-sky-500/20 font-semibold text-sky-200 hover:bg-sky-500/30`}
                  >
                    Assigner au CMND Cie
                  </button>
                </div>
              )}
            </div>
          )}

          <Recap titre="Le poste concerné" lignes={detail.map(([l, v]) => ({ libelle: l, valeur: v }))} />

          <button
            type="button"
            onClick={() => onCadrer?.(n)}
            disabled={n.barrage?.lat == null}
            className={`${bouton} w-full bg-white/8 py-2.5 text-white/80 hover:bg-white/14`}
          >
            <Icone size={14} /> Voir sur la carte
          </button>

          {traitee && (
            <Note>
              <b className="text-white/85">
                {n.decision === 'acceptee'
                  ? 'Acceptée'
                  : n.decision === 'refusee'
                    ? 'Refusée'
                    : 'Traitée'}
              </b>{' '}
              par {n.traiteePar?.nom || n.traiteePar?.unite || '—'} — {quand(n.traiteeLe)}
              {n.reponse && <span className="mt-1 block italic text-white/70">« {n.reponse} »</span>}
            </Note>
          )}

          {!traitee && !peutDecider && (
            <Note>
              Cette décision n’est pas de votre ressort :{' '}
              {aValider
                ? 'seul l’administrateur peut approuver un poste nouvellement posé.'
                : assignation
                  ? 'ce barrage est assigné au CMND Région, qui le traite.'
                  : 'elle revient au commandement concerné.'}
            </Note>
          )}

          {/**
            * RÉCLAMER — sur un changement DÉJÀ confirmé, et rien d'autre.
            *
            * Le chef de région constate la modification appliquée chez lui et
            * la conteste. Le geste n'annule rien : il ouvre un dossier qui
            * pointe cette modification, et le barrage reste dans l'état que
            * l'administration a validé. Défaire d'un clic ce qu'une validation
            * vient d'établir rendrait la validation sans objet.
            *
            * Le bouton n'apparaît qu'au chef de région et à l'administrateur,
            * comme le serveur l'exige (403 pour les autres) : proposer un
            * geste voué au refus n'est pas proposer un geste.
            */}
          {peutReclamer && (
            <div className="space-y-1.5 rounded-lg border border-amber-400/25 bg-amber-400/5 p-2.5">
              {!reclamationOuverte ? (
                <button
                  type="button"
                  onClick={() => setReclamationOuverte(true)}
                  className={`${bouton} w-full bg-amber-400/12 py-2.5 text-amber-300 hover:bg-amber-400/20`}
                >
                  Réclamer le changement
                </button>
              ) : (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300/80">
                    Réclamation — le changement reste appliqué
                  </p>
                  <input
                    value={motifReclamation}
                    onChange={(e) => setMotifReclamation(e.target.value)}
                    placeholder="Motif (ex. plaque erronée)"
                    className="w-full rounded-lg border border-white/12 bg-white/6 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30"
                  />
                  <textarea
                    value={commentaireReclamation}
                    onChange={(e) => setCommentaireReclamation(e.target.value)}
                    rows={3}
                    placeholder="Commentaire détaillé"
                    className="w-full rounded-lg border border-white/12 bg-white/6 px-2.5 py-2 text-[12px] text-white placeholder:text-white/30"
                  />
                  {erreurReclamation && (
                    <p className="text-[11px] text-gr-red">{erreurReclamation}</p>
                  )}
                  <button
                    type="button"
                    disabled={!motifReclamation.trim() || envoiReclamation}
                    onClick={async () => {
                      setEnvoiReclamation(true);
                      setErreurReclamation(null);
                      try {
                        await onReclamer?.(n, {
                          motif: motifReclamation,
                          commentaire: commentaireReclamation,
                        });
                        setReclamationOuverte(false);
                        setMotifReclamation('');
                        setCommentaireReclamation('');
                      } catch (err) {
                        setErreurReclamation(err.message ?? 'Envoi impossible.');
                      } finally {
                        setEnvoiReclamation(false);
                      }
                    }}
                    className={`${bouton} w-full bg-amber-400/20 py-2.5 font-bold text-amber-200 hover:bg-amber-400/30 disabled:opacity-40`}
                  >
                    {envoiReclamation ? 'Envoi…' : 'Envoyer la réclamation'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ),
    },

    peutDecider && {
      cle: 'reponse',
      titre: aArbitrer ? 'Votre réponse' : assignation ? 'Traitement effectué' : 'Accuser réception',
      ar: aArbitrer ? 'قرارك' : 'إشعار بالتوصل',
      aide: aArbitrer
        ? 'Un seul choix, puis la raison. Le commandement concerné en sera informé.'
        : assignation
          ? 'Traitez le barrage depuis sa fiche sur la carte (déplacer, effacer, changer la faction), puis dites ce qui a été fait.'
          : 'Il n’y a rien à trancher : ce poste a été placé par le commandement et est déjà approuvé.',
      valide: aArbitrer ? Boolean(reponse) : true,
      empeche: 'Choisissez d’accepter ou de refuser.',
      libelleSuivant: 'CONFIRMER',
      contenu: (
        <div className="space-y-3">
          {aArbitrer ? (
            <>
              <Choix
                nom="Votre décision"
                valeur={reponse}
                onChange={setReponse}
                options={[
                  {
                    cle: 'accepter',
                    libelle: aValider ? 'Approuver le poste' : 'Accepter la proposition',
                    icone: IconTarget,
                    aide: aValider
                      ? 'Le poste passe en service.'
                      : n.action === 'suppression'
                        ? 'Le barrage est réellement effacé du dispositif.'
                        : 'Le maintien du poste est confirmé.',
                  },
                  {
                    cle: 'refuser',
                    libelle: aValider ? 'Refuser et retirer' : 'Refuser la proposition',
                    icone: IconAlert,
                    aide: aValider
                      ? 'Le poste est retiré de la carte — c’est le seul sens qu’un refus puisse avoir sur un poste pas encore validé.'
                      : n.action === 'suppression'
                        ? 'Le barrage est maintenu, et la proposition levée.'
                        : 'Le maintien est levé.',
                  },
                ]}
              />

              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/75">
                  La raison de votre décision
                </span>
                <textarea
                  rows={3}
                  value={commentaire}
                  onChange={(e) => setCommentaire(e.target.value)}
                  placeholder="Pourquoi vous acceptez ou refusez ce que propose le commandement…"
                  className="w-full resize-none rounded-xl border border-white/12 bg-white/6 px-3 py-2
                    text-[13px] text-white placeholder:text-white/25
                    focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary"
                />
              </label>
            </>
          ) : (
            <>
              {assignation ? (
                <Note>
                  Le Super Admin vous a <b className="text-white/85">assigné ce barrage</b> pour traitement. Le
                  barrage n’a pas été modifié : vous le traitez avec vos droits, puis vous l’indiquez ici.
                </Note>
              ) : (
                <Note>
                  Posé par le commandement, donc <b className="text-white/85">déjà approuvé</b>. Vous
                  en accusez réception.
                </Note>
              )}
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-white/75">
                  Observation (facultative)
                </span>
                <textarea
                  rows={3}
                  value={commentaire}
                  onChange={(e) => setCommentaire(e.target.value)}
                  placeholder="Observation éventuelle…"
                  className="w-full resize-none rounded-xl border border-white/12 bg-white/6 px-3 py-2
                    text-[13px] text-white placeholder:text-white/25
                    focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary"
                />
              </label>
            </>
          )}
        </div>
      ),
    },
  ].filter(Boolean);

  return (
    <Parcours
      icone={IconAlert}
      titre="DÉCISION"
      ar="قرار"
      etapes={etapes}
      indice={etape}
      onIndice={setEtape}
      onFermer={onFermer}
      onTerminer={peutDecider ? envoyer : onFermer}
      libelleTerminer={peutDecider ? 'CONFIRMER' : 'FERMER'}
      occupe={occupe}
      erreur={erreur}
    />
  );
}

export default function NotificationsPanel({
  open,
  onClose,
  session,
  notifications,
  onDecider,
  /** Réclamer un changement confirmé — voir `peutReclamer`. */
  onReclamer,
  onCadrer,
  onTraiterAssignation = null,
  onTransmettreAssignation = null,
}) {
  const [filtre, setFiltre] = useState('ouvertes'); // ouvertes | toutes

  /** La notification ouverte dans le parcours de décision, ou `null`. */
  const [ouverte, setOuverte] = useState(null);

  /**
   * ON NE SE NOTIFIE PAS SOI-MÊME.
   *
   * La lecture du serveur retient une notification de son périmètre OU dont on
   * est l'auteur — ce qui, pour un chef de région qui pose un poste chez lui,
   * la retenait deux fois. Il se voyait donc signaler son propre geste, et le
   * badge lui réclamait une action qu'il venait d'accomplir.
   *
   * Un signalement s'adresse à celui qui n'a pas posé le poste. Le sien reste
   * dans « Tout l'historique » : la trace est utile, l'alerte non.
   */
  const aTraiter = useCallback(
    (n) => n.statut === 'ouverte' && n.auteur?.matricule !== session?.matricule,
    [session?.matricule],
  );

  const liste = useMemo(() => {
    const tri = [...(notifications ?? [])].sort((a, b) =>
      String(b.cree).localeCompare(String(a.cree)),
    );
    return filtre === 'ouvertes' ? tri.filter(aTraiter) : tri;
  }, [notifications, filtre, aTraiter]);

  const ouvertes = (notifications ?? []).filter(aTraiter).length;

  /* Gardé monté le temps de sa sortie (voir usePresence). */
  const presence = usePresence(open);
  if (!presence.monte) return null;

  /**
   * PAS DE SÉQUENCE INVENTÉE ICI.
   *
   * Une liste de notifications n'est pas un réglage en plusieurs temps : c'est
   * un écran de lecture. On lui donne donc la MÊME ENVELOPPE que les parcours
   * (`Cartouche` : même en-tête, mêmes marges, même typographie) mais NI barre
   * d'avancement NI boutons SUIVANT/RETOUR — il n'y a rien à franchir.
   *
   * Le parcours, lui, commence quand on ouvre une notification : c'est là qu'il
   * y a une décision à rendre, et c'est là qu'elle est guidée.
   */
  return (
    <>
      <Cartouche presence={presence.etat} icone={IconAlert} titre="DÉCISIONS" ar="القرارات" onFermer={onClose}>
        <p className="rounded-lg bg-white/5 px-3 py-2.5 text-[11.5px] leading-relaxed text-white/60">
          Les dossiers à trancher sur les barrages de votre périmètre : propositions, demandes,
          assignations et postes qui viennent d’y être posés. Vous ne voyez que ce qui vous concerne.
          Les événements à lire sont sous la cloche, en haut à droite.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {[
            ['ouvertes', `À traiter (${ouvertes})`],
            ['toutes', 'Tout l’historique'],
          ].map(([cle, libelleFiltre]) => (
            <button
              key={cle}
              type="button"
              role="radio"
              aria-checked={filtre === cle}
              onClick={() => setFiltre(cle)}
              className={`${bouton} min-h-10 ${
                filtre === cle
                  ? 'bg-gr-gold text-gr-navy'
                  : 'bg-white/8 text-white/70 hover:bg-white/14'
              }`}
            >
              {libelleFiltre}
            </button>
          ))}
        </div>

        {liste.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[12.5px] leading-relaxed text-white/40">
            {filtre === 'ouvertes'
              ? 'Rien à traiter pour le moment.'
              : 'Aucune notification.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {liste.map((n) => (
              <LigneNotification key={n.id} n={n} onOuvrir={setOuverte} />
            ))}
          </ul>
        )}
      </Cartouche>

      {/* La décision est un parcours centré : voir `ParcoursDecision`. */}
      {ouverte && (
        <ParcoursDecision
          n={ouverte}
          session={session}
          onDecider={onDecider}
          onCadrer={onCadrer}
          onReclamer={onReclamer}
          onTraiterAssignation={onTraiterAssignation}
          onTransmettreAssignation={onTransmettreAssignation}
          onFermer={() => setOuverte(null)}
        />
      )}
    </>
  );
}
