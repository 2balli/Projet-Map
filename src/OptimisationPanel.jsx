/**
 * OPTIMISATION DES BARRAGES — une seule question.
 *
 *     « Montre-moi les barrages qui sont à moins de X km de leur voisin. »
 *
 * Rien d'autre. Le seul jugement porté est `distance < seuil`.
 *
 * CE QUE CE PANNEAU NE FAIT PLUS
 * ------------------------------
 * Il a porté successivement : quatre critères concurrents (accidents, mission,
 * éclairage, distance), un arbitrage entre voisins pesé par les motifs
 * d'implantation, des barrages « obligatoires » mis hors d'atteinte, un
 * redéploiement automatique vers les trous de couverture, et la réaffectation
 * des postes annulés. Chaque couche répondait à une intention défendable, mais
 * leur somme rendait le résultat impossible à prévoir : un poste à deux
 * kilomètres de son voisin pouvait n'apparaître nulle part, sans qu'on sache
 * dire pourquoi.
 *
 * Tout cela est retiré. Le périmètre est celui des BARRAGES FIXES — les mobiles
 * sont temporaires par nature et ne relèvent pas d'un maillage permanent — et
 * aucun autre filtre n'intervient : ni statut, ni motif. Le voisin se cherche
 * parmi ces mêmes fixes, jamais dans un sous-ensemble.
 *
 * ÉTAPE 3 — TROIS INTERRUPTEURS INDÉPENDANTS, DEUX EFFETS DIFFÉRENTS
 * ------------------------------------------------------------------
 * Aucun des trois ne touche au CALCUL : les mêmes postes restent sous le seuil,
 * avec les mêmes kilomètres, quelle que soit la combinaison réglée.
 *
 *   Accidents           joint à chaque poste son nombre d'accidents, et rend
 *                       INTOUCHABLES ceux qui atteignent le seuil réglé (4 par
 *                       défaut, de 0 à 50, borne COMPRISE) : un point où l'on se
 *                       tue ne se retire pas parce qu'un voisin est proche.
 *   Barrage VIP         rend INTOUCHABLES les postes de mission.
 *   Barrage non éclairé rend INTOUCHABLES les postes dont l'axe n'est pas
 *                       éclairé.
 *
 * Et sans interrupteur, parce que ce n'est pas un réglage mais une propriété du
 * terrain : LES ENTRÉES DE VILLE SONT INTOUCHABLES PAR DÉFAUT. Un poste qui
 * commande l'accès à une agglomération ne se retire pas parce qu'un autre
 * barrage se trouve à trois kilomètres.
 *
 * « Intouchable » veut dire : pas de proposition de retrait, pas de ligne dans
 * « à décider », et sur la carte un CADENAS au lieu du « ? » — le « ? » appelle
 * une décision, et il n'y en a aucune à prendre ici. Le poste garde en revanche
 * sa distance mesurée et sa ligne dans le résultat, sous son propre intitulé :
 * le rapprochement constaté reste une information du maillage.
 *
 * Le calcul n'écrit jamais rien. Un poste signalé ET négociable porte un repère
 * « ? » sur la carte ; c'est là, repère par repère, qu'on décide de le supprimer
 * ou de le conserver.
 *
 * DEUX SOURCES, JAMAIS CONFONDUES
 * -------------------------------
 * `rapport` est une MESURE DATÉE : l'état du voisinage à la seconde où l'on a
 * cliqué sur « Générer ». `items` est le DÉPÔT VIVANT : ce qui existe vraiment
 * et ce qui a déjà été décidé. Ce panneau affiche leur superposition — un poste
 * supprimé entre-temps quitte la liste, un poste conservé y passe en vert —
 * sans quoi il continuerait d'afficher des chiffres qui ne valent plus.
 *
 * Une suppression change le voisinage de tous les autres (entre A, B et C,
 * retirer B fait de C le voisin de A) : le calcul est alors REFAIT, sur le
 * dispositif restant. Une conservation ne change rien à la géométrie, donc rien
 * n'est recalculé.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  IconSpinner,
  IconTarget,
  IconBarrageFixe,
  IconBarrageMobile,
  IconAssistant,
  IconTerritoire,
  IconRegion,
  IconCompagnie,
  IconBrigade,
  IconAccident,
  IconVerrou,
  IconPoubelle,
  IconRestaurer,
  IconCible,
  IconCoche,
} from './icons.jsx';
import * as API from './api.js';
import { avecRadar } from './radarCalcul.js';
import { perimetreImpose } from './marquages.js';
import { barragesIntouchablesVisibles, uniquesParIdentifiant } from './optimisationAffichage.js';
import { retraitATrancher } from './instructionsRegles.js';
import { statistiquesOptimisation } from './statistiquesOptimisation.js';
import { identifierConflits, clePaire, kmConflit } from './conflitsIdentifies.js';
import UniteSelect from './UniteSelect.jsx';
import { ExplicationOptimisation } from './components/map/MapPopups.jsx';
import {
  Parcours,
  indiceDe,
  Choix,
  Bascule,
  Champ,
  Recap,
  Note,
  Vide,
} from './Parcours.jsx';

/**
 * LA FILTRATION AUTOMATIQUE N'EST PLUS PROPOSÉE À L'ÉCRAN.
 *
 * Le choix « Automatique » est masqué : seule la filtration manuelle reste
 * offerte. Le code et les routes serveur sont conservés (ils servent aussi la
 * filtration par route) ; passer cette constante à `true` rétablirait le choix.
 */
const FILTRATION_AUTOMATIQUE_VISIBLE = false;

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

/**
 * Bornes du compteur d'accidents de l'étape « Distance et réglages », et sa
 * valeur de départ.
 *
 * 4 par défaut : le nombre d'accidents À PARTIR DUQUEL un poste sort de la
 * décision. Réglable, parce qu'un maillage urbain dense et une nationale de
 * montagne ne comptent pas les accidents de la même façon.
 */
/**
 * LES QUATRE ONGLETS DE LA CARTE, dans leur ordre d'affichage. `critere` nomme
 * l'interrupteur de la route `consolidation` que l'onglet allume ; Distance
 * n'en a pas — c'est la mesure elle-même. Voir `activerOnglet`.
 */
const ONGLETS_OPTIMISATION = [
  { cle: 'distance', libelle: 'Distance', critere: null },
  { cle: 'accidents', libelle: 'Les accidents', critere: 'accidents' },
  { cle: 'vip', libelle: 'Barage VIP', critere: 'vip' },
  { cle: 'eclairage', libelle: 'L’éclairage', critere: 'nonEclaire' },
];

const ACCIDENTS_MIN = 0;
const ACCIDENTS_MAX = 50;
const ACCIDENTS_DEFAUT = 4;

/**
 * NOMBRE D'ACCIDENTS — n'apparaît que si l'interrupteur « Accidents » est ON.
 *
 * Deux boutons et un chiffre, plutôt qu'un champ à taper : sur un poste de
 * commandement, ce réglage se touche du doigt et se lit d'un coup d'œil. La
 * saisie directe reste possible pour aller vite de 4 à 30.
 *
 * Le chiffre est le SEUIL D'EXCLUSION, et il est INCLUSIF : à 4, un poste de 4
 * accidents est déjà exclu. Il ne retire aucun barrage de la liste et ne change
 * aucune distance — il décide seulement de qui peut être proposé au retrait.
 */
function SeuilAccidents({ valeur, onChange }) {
  const borner = (n) => Math.min(ACCIDENTS_MAX, Math.max(ACCIDENTS_MIN, n));
  const pas = (delta) => onChange(borner(valeur + delta));

  const rond =
    'grid size-8 shrink-0 place-items-center rounded-lg border border-white/12 bg-white/8 ' +
    'text-[15px] font-bold leading-none text-white/85 transition-colors duration-150 ' +
    'hover:bg-white/16 disabled:opacity-30 motion-reduce:transition-none ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

  return (
    <div className="rounded-lg border border-gr-gold/30 bg-gr-gold/8 px-2.5 py-2">
      <span className="mb-1 block text-[10px] font-semibold text-white/70">
        Nombre d’accidents — exclure à partir de
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => pas(-1)}
          disabled={valeur <= ACCIDENTS_MIN}
          aria-label="Un accident de moins"
          className={rond}
        >
          −
        </button>

        <input
          type="number"
          min={ACCIDENTS_MIN}
          max={ACCIDENTS_MAX}
          value={valeur}
          /* Le champ vide ne doit pas devenir NaN : on retombe sur 0. */
          onChange={(e) => onChange(borner(Math.trunc(Number(e.target.value) || 0)))}
          aria-label={`Nombre d’accidents, de ${ACCIDENTS_MIN} à ${ACCIDENTS_MAX}`}
          className="min-w-0 flex-1 rounded-lg border border-white/12 bg-white/6 px-2 py-1
            text-center font-mono text-[17px] font-bold tabular-nums text-gr-gold
            focus:border-gr-gold/60 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => pas(1)}
          disabled={valeur >= ACCIDENTS_MAX}
          aria-label="Un accident de plus"
          className={rond}
        >
          +
        </button>
      </div>
      <p className="mt-1 text-[9px] leading-snug text-white/45">
        De {ACCIDENTS_MIN} à {ACCIDENTS_MAX}. Le nombre d’accidents est joint à{' '}
        <b className="text-white/60">tous</b> les postes. Ceux qui en comptent{' '}
        <b className="text-white/60">{valeur} ou plus</b> deviennent{' '}
        <b className="text-white/60">intouchables</b> : sur la carte ils portent l’
        <b className="text-white/60">étoile rose des accidents</b>, jamais un « ? ». Le chiffre
        demandé est <b className="text-white/60">compris</b> — à {valeur}, un poste de {valeur}{' '}
        accident{valeur > 1 ? 's' : ''} est déjà exclu.
      </p>

      {/*
        À 0, la règle s'applique telle quelle : aucun poste n'a moins de zéro
        accident, donc tous sortent de la décision. On le dit plutôt que de
        traiter ce réglage à part — mais on le dit clairement, parce qu'un
        panneau qui ne propose plus rien passe pour cassé.
      */}
      {valeur === ACCIDENTS_MIN && (
        <p className="mt-1 rounded border border-gr-gold/40 bg-gr-gold/10 px-1.5 py-1 text-[9px] leading-snug text-gr-gold">
          À 0, <b>tous</b> les postes sont exclus : l’optimisation n’aura plus rien à proposer.
        </p>
      )}
    </div>
  );
}

/** Comment on NOMME le périmètre quand le rang le détermine. */
const LIBELLE_NIVEAU_IMPOSE = {
  region: 'Région',
  compagnie: 'Compagnie',
  brigade: 'Brigade territoriale',
};

/**
 * LES ÉCHELONS QU'ON A LE DROIT DE DÉSIGNER.
 *
 * « Choisir un autre périmètre » ne veut pas dire « choisir n'importe lequel » :
 * un chef de région descend dans une de ses compagnies ou une de ses brigades,
 * il ne remonte pas au national. On retire donc les échelons plus larges que le
 * sien — le serveur les refuserait de toute façon, et proposer un choix voué au
 * refus n'est pas un choix. Son propre échelon reste proposé : c'est le retour
 * à l'ensemble de son périmètre.
 *
 * Partagé par l'étape 1 du panneau et la boîte de configuration des onglets.
 */
function niveauxAutorises(impose) {
  const RANG = { national: -1, region: 0, compagnie: 1, brigade: 2 };
  return [
    { cle: 'national', libelle: 'Tout le pays', ar: 'كل البلاد', icone: IconTerritoire },
    { cle: 'region', libelle: 'Une région', ar: 'جهة', icone: IconRegion },
    { cle: 'compagnie', libelle: 'Une compagnie', ar: 'سرية', icone: IconCompagnie },
    { cle: 'brigade', libelle: 'Une brigade', ar: 'الدرك الترابي', icone: IconBrigade },
  ].filter((o) => !impose || RANG[o.cle] >= RANG[impose.niveau]);
}

/**
 * ET LES UNITÉS DE SON SEUL PÉRIMÈTRE.
 *
 * `/api/unites` sert la liste complète du pays — elle alimente aussi l'écran de
 * connexion. On ne garde que ce qui relève du compte : les compagnies de sa
 * région, les brigades de sa compagnie. Le filtre lit le rattachement porté par
 * chaque unité (`reg`, `cie`), pas son nom.
 */
function unitesAutorisees(unites, niveau, impose) {
  const toutes =
    niveau === 'region'
      ? (unites?.regions ?? [])
      : niveau === 'compagnie'
        ? (unites?.compagnies ?? [])
        : (unites?.unites ?? []);
  if (!impose) return toutes;
  return toutes.filter((u) => {
    const nom = typeof u === 'string' ? u : u.nom;
    if (niveau === 'region') return nom === impose.unite;
    const rattachement = typeof u === 'string' ? {} : u;
    return impose.champ === 'reg' ? rattachement.reg === impose.unite : rattachement.cie === impose.unite;
  });
}

const RECHERCHE_UNITE = {
  region: 'Rechercher une région…',
  compagnie: 'Rechercher une compagnie…',
  brigade: 'Rechercher une brigade…',
};

/**
 * Motifs de protection, en clair — l'ordre suit celui des bascules de l'étape
 * « Distance et réglages ».
 *
 * Les mêmes clés que côté serveur (voir la route `consolidation`) : le
 * navigateur ne décide pas de ce qui protège, il ne fait que le nommer.
 */
const PROTECTIONS_FR = {
  entree_ville: 'Entrée de ville',
  sortie_ville: 'Sortie de ville',
  accidents: 'Accidents',
  vip: 'VIP',
  non_eclaire: 'Non éclairé',
};

const libelleProtections = (protections) =>
  (protections ?? []).map((p) => PROTECTIONS_FR[p] ?? p).join(' + ') || 'Protégé';

/**
 * UN GROUPE DE POSTES — un titre, une phrase qui dit ce que le groupe signifie,
 * la liste.
 *
 * Les quatre listes du résultat répétaient chacune sa propre mise en forme :
 * même dessin recopié quatre fois, avec quatre teintes écrites à la main. Une
 * brique, et les quatre groupes se lisent pareil.
 */
function ListePostes({ titre, phrase, teinte = 'neutre', listClassName = '', children }) {
  const cadre =
    teinte === 'gold'
      ? 'border-gr-gold/30 bg-gr-gold/8'
      : teinte === 'green'
        ? 'border-gr-green/25 bg-gr-green/8'
        : 'border-white/12 bg-white/5';

  return (
    <section>
      <div className={`rounded-xl border px-3 py-2 ${cadre}`}>
        <p className="text-[12px] font-bold leading-tight text-white/90">{titre}</p>
        {phrase && <p className="mt-1 text-[11px] leading-snug text-white/60">{phrase}</p>}
      </div>
      <ul className={`mt-2 space-y-1 ${listClassName}`}>{children}</ul>
    </section>
  );
}

/**
 * Un des deux boutons de décision d'une ligne. Celui qui porte la décision en
 * cours est coloré et inerte — il n'est pas désactivé au sens HTML, car un
 * bouton désactivé ne reçoit pas le focus et son intitulé disparaîtrait de la
 * lecture au clavier : c'est `aria-pressed` qui dit l'état, et le clic qui ne
 * fait rien.
 */
function BoutonDecision({ actif, teinte, titre, titreActif, onClick, children }) {
  const actives =
    teinte === 'green'
      ? 'border-gr-green/45 bg-gr-green/18 text-gr-green'
      : 'border-gr-gold/45 bg-gr-gold/18 text-gr-gold';

  return (
    <button
      type="button"
      aria-pressed={actif}
      title={actif ? titreActif : titre}
      onClick={actif ? undefined : onClick}
      className={`shrink-0 rounded-lg border px-2 py-[3px] text-[10px] font-semibold
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
        ${
          actif
            ? `${actives} cursor-default`
            : 'border-white/12 bg-white/5 text-white/60 hover:bg-white/12 hover:text-white'
        }`}
    >
      {children}
    </button>
  );
}

/**
 * Une ligne de la liste — le même gabarit qu'un poste attende une décision,
 * qu'il ait déjà été maintenu, ou qu'il soit intouchable. Seule la couleur
 * change : rouge tant que la question est ouverte, vert une fois tranchée,
 * neutre et verrouillée quand la question ne se pose pas.
 *
 * Le clic cadre la carte sur le poste. Trancher, lui, se fait sur la carte,
 * dans la bulle du repère « ? » : c'est là qu'on voit le terrain et le voisin
 * en cause.
 *
 * REVENIR SUR UNE DÉCISION SE FAIT ICI, et non sur la carte : un poste conservé
 * y a repris l'apparence de tous les autres, il n'y a donc plus de repère
 * particulier où cliquer. C'est cette liste qui garde la mémoire des arbitrages
 * rendus.
 */
function LigneBarrage({ b, onCadrer, onDecider, demande, onDeciderDemande, etat = 'aucune', simulation = null, session = null, onAssigner = null, dejaAssigne = null }) {
  /* La demande part au serveur : deux clics pendant l'aller-retour vaudraient
     deux décisions, dont la seconde serait refusée (409). */
  const [occupe, setOccupe] = useState(false);
  const tranche = etat !== 'aucune' && etat !== 'intouchable';
  const teinte =
    etat === 'conserve'
      ? 'border-gr-green/25 bg-gr-green/5 hover:bg-gr-green/10'
      : etat === 'a_supprimer'
        ? 'border-gr-gold/30 bg-gr-gold/8 hover:bg-gr-gold/14'
        : etat === 'intouchable'
          ? 'border-white/12 bg-white/5 hover:bg-white/10'
          : 'border-gr-red/25 bg-gr-red/5 hover:bg-gr-red/10';
  const accent =
    etat === 'conserve'
      ? 'text-gr-green'
      : etat === 'a_supprimer'
        ? 'text-gr-gold'
        : etat === 'intouchable'
          ? 'text-white/60'
          : 'text-gr-red';
  const mention =
    etat === 'conserve' ? 'Conservé · ' : etat === 'a_supprimer' ? 'Retrait proposé · ' : '';

  return (
    <li className="space-y-1">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          /* Le conflit se voit à DEUX : on cadre la route qui relie le poste à
             son voisin, pas le poste seul. */
          onClick={() => onCadrer?.(b, b.voisin?.route?.trace ? { trace: b.voisin.route.trace } : undefined)}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${teinte}`}
        >
          <span className={`shrink-0 ${etat === 'intouchable' ? 'text-white/60' : tranche ? accent : 'text-gr-gold'}`}>
            {etat === 'intouchable' ? (
              <span aria-hidden="true" className="text-[13px] leading-none">🔒</span>
            ) : b.type === 'barrage_mobile' ? (
              <IconBarrageMobile size={14} />
            ) : (
              <IconBarrageFixe size={14} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold text-white/90">
              {b.nom || 'Barrage sans nom'}
            </span>
            <span className="block truncate text-[10px] text-white/45">
              {mention && <span className={accent}>{mention}</span>}
              {/* Le MOTIF de la protection, en premier : c'est la seule chose
                  qu'on cherche sur une ligne verrouillée. */}
              {etat === 'intouchable' && (
                <span className="text-white/70">{libelleProtections(b.protections)} · </span>
              )}
              {[b.route, b.cie].filter(Boolean).join(' · ') || b.reg}
            </span>
            {b.voisin?.id && (
              <span className="block truncate text-[10px] text-white/60">
                ↔ {b.voisinIndisponible ? (
                  <span className="text-amber-300">Position indisponible ({b.voisin.id})</span>
                ) : (
                  <>
                    {b.voisin.nom || b.voisin.id}
                    {b.voisin.intouchable ? ' 🔒' : ''}
                    {b.voisinContexte && (
                      <span className="ml-1 rounded bg-white/10 px-1 text-[9px] font-bold uppercase text-white/70">Contexte</span>
                    )}
                  </>
                )}
              </span>
            )}
          </span>
          {/* Un « 0 km » brut passe pour un défaut de calcul. Il n'en est pas
              un : ce sont deux barrages DISTINCTS posés aux mêmes coordonnées.
              On le dit, parce que c'est justement ce qu'il faut corriger dans
              les données. */}
          <span className="shrink-0 text-right">
            <span
              className={`block font-mono text-[12px] font-bold ${accent}`}
            >
              {b.distanceKm} km
            </span>
            {b.distanceKm === 0 && (
              <span className={`block text-[9px] leading-tight ${accent} opacity-70`}>
                même emplacement
              </span>
            )}
          </span>
        </button>

        {/* Déjà assigné (retrouvé à chaque optimisation, voir `assignationDe`) :
            l'état remplace le bouton — pas de seconde assignation. */}
        {session?.rang === 'admin' && (
          <span className="flex shrink-0 items-center">
            {dejaAssigne ? (
              <span
            className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-200 max-w-[150px] truncate"
            title={`Assigné à ${dejaAssigne} — en attente de traitement.`}
          >
            ✓ Assigné à {dejaAssigne}
          </span>
            ) : (
              <button
                type="button"
                onClick={() => onAssigner?.(b)}
                title="Assigner ce barrage au CMND Région pour traitement"
                className="rounded-lg border border-gr-gold/60 bg-gr-gold/20 px-2.5 py-1.5 text-[11px] font-bold text-gr-gold hover:bg-gr-gold/30 transition-colors"
              >
                Assigner
              </button>
            )}
          </span>
        )}

        {tranche && session?.rang !== 'admin' && (
          /* CONFIRMER / REFUSER — deux gestes nommés, là où il n'y avait qu'un
             bouton unique qui ne disait pas ce qu'il rendait. Confirmer, c'est
             maintenir le poste ; Refuser, c'est en proposer le retrait. La
             décision déjà rendue reste affichée, mise en avant et sans action :
             elle dit l'état courant, l'autre bouton dit ce qui peut encore
             changer — un seul clic pour revenir sur un arbitrage, sans repasser
             par un état intermédiaire. */
          <span className="flex shrink-0 flex-col justify-center gap-1">
            <BoutonDecision
              actif={etat === 'conserve'}
              teinte="green"
              titreActif="Poste maintenu — décision déjà rendue"
              titre="Maintenir ce poste — la proposition de retrait est retirée"
              onClick={() => onDecider?.(b, 'garder')}
            >
              Confirmer
            </BoutonDecision>
            <BoutonDecision
              actif={etat === 'a_supprimer'}
              teinte="gold"
              titreActif="Retrait déjà proposé — en attente du commandant"
              titre="Proposer le retrait de ce poste — rien n'est effacé sans accord"
              onClick={() => onDecider?.(b, 'retirer')}
            >
              Refuser
            </BoutonDecision>
          </span>
        )}
      </div>

      {/**
        * LA DÉCISION DU COMMANDANT, LÀ OÙ ELLE SE LIT.
        *
        * « Retrait proposé — en attente du commandant » : quand ce commandant,
        * c'est le compte qui regarde, l'attente n'a plus lieu d'être. Le
        * bandeau ne s'affiche que pour lui (voir `retraitATrancher`) ; pour
        * tous les autres, la ligne reste ce qu'elle était, une proposition en
        * instance ailleurs.
        *
        * Accepter EFFACE le poste — c'est le seul geste de cet écran qui
        * retire quelque chose, et il passe par le même chemin serveur que
        * toute autre suppression. Refuser rend le poste à son état d'avant.
        */}
      {simulation && <ActionsConflit {...simulation} session={session} barrage={b} onAssigner={onAssigner} dejaAssigne={dejaAssigne} />}

      {demande && (
        <div
          data-gr-decision-retrait={b.id}
          className="flex items-center gap-1.5 rounded-lg border border-gr-gold/30 bg-gr-gold/8 px-2.5 py-1.5"
        >
          <span className="min-w-0 flex-1 text-[10px] leading-snug text-white/70">
            <b className="text-gr-gold">DÉCISION</b> — ce retrait vous est soumis.
          </span>
          <button
            type="button"
            disabled={occupe}
            title="Accepter le retrait — le poste est effacé du dispositif"
            onClick={async () => {
              if (occupe) return;
              setOccupe(true);
              try {
                await onDeciderDemande?.(demande, 'accepter');
              } finally {
                setOccupe(false);
              }
            }}
            className="shrink-0 rounded-lg border border-gr-gold/45 bg-gr-gold/18 px-2 py-[3px]
              text-[10px] font-semibold text-gr-gold hover:bg-gr-gold/28 disabled:opacity-40
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            Accepter
          </button>
          <button
            type="button"
            disabled={occupe}
            title="Refuser le retrait — le poste reste en service, tel qu'il était"
            onClick={async () => {
              if (occupe) return;
              setOccupe(true);
              try {
                await onDeciderDemande?.(demande, 'refuser');
              } finally {
                setOccupe(false);
              }
            }}
            className="shrink-0 rounded-lg border border-white/12 bg-white/5 px-2 py-[3px]
              text-[10px] font-semibold text-white/60 hover:bg-white/12 hover:text-white
              disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2
              focus-visible:outline-gr-primary"
          >
            Refuser
          </button>
        </div>
      )}
    </li>
  );
}

/** Inventaire consultable des BFI, séparé des propositions et sans action métier. */
function ListeIntouchables({ barrages, onCadrer, factionActuelle }) {
  if (!barrages.length) return null;
  return (
    <ListePostes
      titre={`${barrages.length} barrage(s) fixe(s) intouchable(s) — visibles, protégés des actions d’optimisation`}
      teinte="neutre"
      listClassName="max-h-72 overflow-y-auto pr-1"
      phrase="STATUT PERMANENT — NON MODIFIABLE PAR L’OPTIMISATION. Aucun déplacement, retrait ou changement de ces postes n’est proposé. La faction actuelle est indiquée ; sélectionnez un poste pour le retrouver sur la carte."
    >
      {barrages.map((b) => (
        <LigneIntouchable key={b.id} b={b} onCadrer={onCadrer} factionActuelle={factionActuelle} />
      ))}
    </ListePostes>
  );
}

function LigneIntouchable({ b, onCadrer, factionActuelle }) {
  const [ouvert, setOuvert] = useState(false);
  const [effectif, setEffectif] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreurEffectif, setErreurEffectif] = useState(false);

  const basculerEffectif = async () => {
    const ouvrir = !ouvert;
    setOuvert(ouvrir);
    if (!ouvrir || effectif || chargement) return;
    setChargement(true);
    setErreurEffectif(false);
    try {
      setEffectif(await API.effectifDuPoste(b.id));
    } catch {
      setErreurEffectif(true);
    } finally {
      setChargement(false);
    }
  };

  const creneau = effectif?.creneau;
  const presents = (effectif?.items ?? []).filter((e) => e.creneau === creneau);
  return (
    <li className="rounded-lg border border-white/10 bg-black/15 p-2" data-optimisation-intouchable={b.id}>
      <div className="flex items-start gap-2">
        <IconVerrou size={14} />
        <button
          type="button"
          onClick={() => onCadrer?.(b)}
          className="min-w-0 flex-1 text-left hover:text-gr-gold"
          title="Afficher la position actuelle sur la carte"
        >
          <span className="block truncate text-[11px] font-semibold text-white/90">
            {b.nom || 'Barrage sans nom'} <span className="font-mono text-white/50">· {b.id}</span>
          </span>
          <span className="block text-[9.5px] leading-snug text-white/55">
            {[
              b.route || 'Route non renseignée',
              Number.isFinite(b.pk) ? `PK ${b.pk}` : 'PK non renseigné',
              `Région ${b.reg || '—'}`,
              `Compagnie ${b.cie || '—'}`,
              `Brigade ${b.bt || '—'}`,
            ].join(' · ')}
          </span>
          <span className="block text-[9px] leading-snug text-white/45">
            Faction actuelle : {FACTION_LIBELLE[factionActuelle] ?? factionActuelle ?? 'non renseignée'} · poste permanent · NON MODIFIABLE · {b.statutBarrage || 'statut non renseigné'} ·{' '}
            {Number.isFinite(b.lat) && Number.isFinite(b.lng)
              ? `${b.lat.toFixed(5)}, ${b.lng.toFixed(5)}`
              : 'position non renseignée'}
          </span>
        </button>
        <button
          type="button"
          onClick={basculerEffectif}
          className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[9px] text-white/70 hover:bg-white/10"
          aria-expanded={ouvert}
        >
          {ouvert ? 'Masquer effectif' : 'Effectif'}
        </button>
      </div>
      {ouvert && (
        <div className="mt-1 pl-5 text-[9.5px] text-white/60">
          {chargement && 'Chargement de l’effectif du créneau courant…'}
          {erreurEffectif && 'Effectif indisponible pour ce compte ou ce poste.'}
          {effectif && (
            <>
              <p>
                Créneau {String(creneau).padStart(2, '0')}h–{String((creneau + 6) % 24).padStart(2, '0')}h :{' '}
                {presents.length} présent(s) / {effectif.attendus} attendu(s)
              </p>
              {presents.length > 0 && (
                <ul className="mt-0.5">
                  {presents.map((p, i) => (
                    <li key={`${p.matricule ?? p.nom}-${i}`}>{p.grade} {p.nom}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * SECTION : BARRAGES RETIRÉS PAR OPTIMISATION
 *
 * Affiche la liste des barrages actuellement dans l'état RETIRÉ_PAR_OPTIMISATION.
 * Permet de visualiser leur position sur la carte et de les restaurer à l'identique.
 */
function SectionBarragesRetires({
  barrages,
  chargement,
  restaurationEnCours,
  onCadrer,
  onRestaurer,
}) {
  if (chargement) {
    return (
      <div className="flex items-center justify-center py-6 text-white/50 text-[11px] gap-2">
        <IconSpinner size={15} />
        <span>Chargement des barrages retirés…</span>
      </div>
    );
  }

  if (!barrages || barrages.length === 0) {
    return (
      <Vide>
        Aucun barrage retiré par l’optimisation sur ce territoire.
      </Vide>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="rounded-xl border border-white/12 bg-white/5 px-3 py-2">
        <p className="text-[12px] font-bold text-white/90">
          Barrages retirés par optimisation ({barrages.length})
        </p>
        <p className="text-[10px] text-white/50 mt-0.5 leading-snug">
          Ces barrages ne sont pas supprimés : leurs données sont intégralement conservées et ils peuvent être restaurés vers leur état actif à tout moment.
        </p>
      </div>

      <ul className="space-y-2">
        {barrages.map((b) => {
          const opt = b.optimisationAuto ?? {};
          const stats = opt.stats ?? {};
          const dateStr = opt.date
            ? new Date(opt.date).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            : null;
          const enCours = restaurationEnCours === b.id;

          return (
            <li
              key={b.id}
              className="rounded-xl border border-white/12 bg-white/4 p-2.5 space-y-2 hover:bg-white/7 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 size-2 rounded-full bg-gr-gold" title="Retiré par optimisation" />
                    <p className="truncate text-[12px] font-bold text-white/90">
                      {b.nom || 'Barrage sans nom'}
                    </p>
                  </div>
                  <p className="truncate text-[10px] text-white/45 mt-0.5">
                    {[b.route, b.bt, b.cie, b.reg].filter(Boolean).join(' · ') || b.id}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <span className="inline-block rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider bg-gr-gold/15 text-gr-gold border border-gr-gold/30">
                    RETIRÉ_PAR_OPTIMISATION
                  </span>
                  {b.etatAvant && (
                    <span className="block text-[8.5px] text-white/40 mt-0.5">
                      Avant : {b.etatAvant === 'approuve' ? 'ACTIF' : b.etatAvant}
                    </span>
                  )}
                </div>
              </div>

              {/* Détails et statistiques réelles d'optimisation */}
              <div className="rounded-lg bg-black/25 px-2.5 py-2 text-[10.5px] space-y-1 text-white/70 border border-white/6">
                <div className="flex items-center justify-between text-white/60">
                  <span>Raison :</span>
                  <span className="font-semibold text-white/85 text-right">{opt.raison || 'Priorité faible'}</span>
                </div>
                <div className="flex items-center justify-between text-white/60">
                  <span>Accidents :</span>
                  <span className="font-mono font-bold text-white/90">{stats.accidents ?? b.accidentCount ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-white/60">
                  <span>Éclairage :</span>
                  <span className="font-semibold text-white/90">
                    {(stats.eclairage ?? b.eclairage) === 'oui' ? 'Satisfaisant' : (stats.eclairage ?? b.eclairage) === 'non' ? 'Insuffisant' : 'Inconnu'}
                  </span>
                </div>
                {opt.score !== undefined && (
                  <div className="flex items-center justify-between text-white/60">
                    <span>Score calculé :</span>
                    <span className="font-mono font-bold text-gr-gold">{opt.score}</span>
                  </div>
                )}
                {dateStr && (
                  <div className="flex items-center justify-between text-white/60">
                    <span>Date d’optimisation :</span>
                    <span className="text-white/75">{dateStr} · {opt.mode || 'AUTOMATIQUE'}</span>
                  </div>
                )}
              </div>

              {/* Actions : Voir sur la carte & Restaurer le barrage */}
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => onCadrer?.(b)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/6 px-2 py-1.5 text-[10.5px] font-semibold text-white/75 hover:bg-white/14 hover:text-white transition-colors"
                >
                  <IconCible size={13} />
                  <span>Voir sur la carte</span>
                </button>
                <button
                  type="button"
                  disabled={enCours}
                  onClick={() => onRestaurer?.(b)}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-gr-green/40 bg-gr-green/15 px-2 py-1.5 text-[10.5px] font-semibold text-gr-green hover:bg-gr-green/25 disabled:opacity-40 transition-colors"
                >
                  {enCours ? <IconSpinner size={13} /> : <IconRestaurer size={13} />}
                  <span>{enCours ? 'Restauration…' : 'Restaurer le barrage'}</span>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * HISTORIQUE DES OPTIMISATIONS APPLIQUÉES — figé, jamais recalculé.
 *
 * Chaque rapport dit ce qui a été décidé CE JOUR-LÀ : combien de barrages
 * avant, combien après, quelle couverture, sur quels critères, et par qui.
 * Relancer le calcul aujourd'hui donnerait d'autres nombres — c'est
 * précisément pourquoi ceux-ci sont recopiés au moment de la décision et
 * jamais relus (voir serveur/rapportsOptimisation.mjs).
 */
function HistoriqueOptimisations({ rapports }) {
  if (!rapports?.length) return null;
  return (
    <Depliable cle="historique" className="rounded-xl border border-white/10 bg-black/20 p-2.5">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-white/80">
        Historique des optimisations ({rapports.length})
      </summary>
      <ul className="mt-2 space-y-2">
        {rapports.map((r) => {
          /* Une RESTAURATION n'a ni avant/après ni couverture : elle défait un
             retrait, elle ne recalcule rien. Elle se lit donc autrement. */
          const restauration = r.mode === 'RESTAURATION';
          return (
            <li key={r.id} className="rounded-lg border border-white/8 bg-black/25 p-2 space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={`font-mono text-[11px] font-bold ${
                    restauration ? 'text-gr-green' : 'text-gr-gold'
                  }`}
                >
                  {restauration ? 'RESTAURATION' : 'OPTIMISATION'} #
                  {String(r.numero).padStart(3, '0')}
                </span>
                <span className="text-[9.5px] text-white/45">
                  {new Date(r.date).toLocaleString('fr-FR')}
                </span>
              </div>
              <p className="text-[10px] text-white/55">
                {r.auteur?.rang}
                {r.auteur?.unite ? ` · ${r.auteur.unite}` : ''} · mode {r.mode}
              </p>

              {restauration ? (
                <ul className="text-[10.5px] text-white/70 space-y-0.5">
                  {(r.barrages ?? []).map((b) => (
                    <li key={b.id}>
                      <span className="font-semibold text-white/90">{b.nom || b.id}</span> — remis
                      en service{b.route ? ` (${b.route})` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[10.5px] text-white/70 space-y-0.5">
                  <div className="flex justify-between">
                    <span>Analysés / proposés / validés :</span>
                    <span className="font-mono font-bold text-white/90">
                      {r.analyses ?? r.avant ?? '?'} / {r.proposes ?? '?'} / {r.retires}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Avant → après :</span>
                    <span className="font-mono font-bold text-white/90">
                      {r.avant ?? '?'} → {r.apres ?? '?'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Protégés :</span>
                    <span className="font-mono font-bold text-white/90">{r.proteges ?? '?'}</span>
                  </div>
                  {r.couvertureAvant != null && (
                    <div className="flex justify-between">
                      <span>Couverture :</span>
                      <span className="font-mono font-bold text-white/90">
                        {r.couvertureAvant} % → {r.couvertureApres} %
                      </span>
                    </div>
                  )}
                </div>
              )}

              {r.criteres?.length > 0 && (
                <p className="text-[9.5px] text-white/40 leading-snug">
                  Critères : {r.criteres.join(', ')}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Depliable>
  );
}

/**
 * RÉSULTAT DE L'OPTIMISATION AUTOMATIQUE PAR DISTANCE ROUTIÈRE.
 *
 * Le serveur analyse tous les barrages fixes autorisés par le RBAC et propose
 * des déplacements routiers des seuls barrages normaux.
 *
 * TOUT VIENT DU SERVEUR — les distances routières, les positions proposées, les
 * conflits restants. Le navigateur n'a ni le réseau routier ni les
 * circonscriptions ; il ne recalcule rien, il montre et il laisse choisir.
 *
 * L'APERÇU EST LE CŒUR DE CET ÉCRAN. Tant que « Appliquer » n'est pas pressé,
 * rien n'est écrit : la carte montre les positions avant et après et les routes
 * réelles — pour qu'on 
 * juge sur pièces avant d'engager quoi que ce soit.
 */
function Chiffre({ libelle, valeur, ton = 'blanc' }) {
  const couleurs = {
    blanc: 'text-white',
    or: 'text-gr-gold',
    vert: 'text-gr-green',
    gris: 'text-white/55',
    alerte: 'text-orange-300',
  };
  return (
    <div className="rounded-lg bg-black/25 p-2 border border-white/6 text-center">
      <span className="block text-[9px] uppercase tracking-wider text-white/50">{libelle}</span>
      <span className={`font-mono text-[15px] font-bold ${couleurs[ton] ?? couleurs.blanc}`}>
        {valeur}
      </span>
    </div>
  );
}

/**
 * UNE DURÉE COMME ON LA DIT — « 1 h », « 1 h 20 », « 45 min ».
 *
 * « 60 minutes » et « 80 minutes » se lisent mal quand la règle s'énonce en
 * heures. Le calcul, lui, reste en minutes : c'est l'affichage qui traduit.
 */
const formatDuree = (min) => {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`;
};

/**
 * Comment chaque action se nomme et se colore, partout dans cet écran.
 *
 * IL N'Y EN A PLUS QUE DEUX. « Déplacer » a disparu : un barrage est une
 * implantation, pas une variable d'ajustement. L'optimisation réaffecte un
 * tour de service, ou elle conserve et le dit.
 */
const ACTIONS = {
  deplacer: {
    mot: 'Déplacer',
    couleur: 'text-sky-300',
    bord: 'border-sky-400/35 bg-sky-400/8',
  },
  changer_faction: {
    mot: 'Changer de faction',
    couleur: 'text-sky-300',
    bord: 'border-sky-400/35 bg-sky-400/8',
  },
  conserver: {
    mot: 'Conserver',
    couleur: 'text-gr-green',
    bord: 'border-gr-green/30 bg-gr-green/8',
  },
};

/**
 * CE QUE L'OPTIMISATION AUTOMATIQUE ANALYSE — dit avant de lancer, chiffré après.
 *
 * Les comptes viennent du serveur (`perimetre` de la réponse) : ils portent sur
 * la faction analysée dans le périmètre RBAC, et jamais sur les autres.
 */
function PerimetreAuto({ factionId, perimetre }) {
  const ligne = (libelle, valeur) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-white/55">{libelle}</span>
      <b className="font-mono text-gr-gold">{valeur}</b>
    </div>
  );
  const id = perimetre?.factionId ?? factionId;
  return (
    <div className="space-y-1 rounded-lg border border-gr-gold/30 bg-black/20 px-2.5 py-2 text-[11px]">
      {perimetre?.seuilKm != null && ligne('Seuil automatique :', `${perimetre.seuilKm} km`)}
      {perimetre?.zoneLibelle && ligne('Zone analysée :', perimetre.zoneLibelle)}
      {ligne('Faction :', id ? (FACTION_LIBELLE[id] ?? id) : 'faction en cours (serveur)')}
      {perimetre && ligne('Barrages analysés :', perimetre.barragesAnalyses)}
      {perimetre && ligne('Intouchables pris en compte :', perimetre.intouchablesProteges)}
      <p className="text-[10px] leading-snug text-white/45">
        Seuls les barrages de cette zone et de cette faction sont analysés. Les Intouchables
        voisins servent uniquement à vérifier le seuil : ils ne bougent jamais.
      </p>
    </div>
  );
}

/**
 * LA SYNTHÈSE DE L'OPTIMISATION — zone, faction, seuil, AVANT / APRÈS.
 *
 * Tous les chiffres viennent de la simulation courante (`synthese`, calculée
 * dans le panneau à partir des réponses du serveur). Compacte : un bloc, pas un
 * tableau de bord — la carte reste l'espace de travail.
 */
function SyntheseOptimisation({ synthese, simulation, etatSimulation, onRelancer, filtres, onFiltres, onDetails, positionChangee = null, autreFaction = null }) {
  if (!synthese) return null;
  const cellule = (libelle, valeur, ton = 'text-white') =>
    valeur == null ? null : (
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-white/55">{libelle}</span>
        <b className={`font-mono ${ton}`}>{valeur}</b>
      </div>
    );
  const heure = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <div data-gr-synthese="1" className="space-y-2 rounded-xl border border-gr-gold/35 bg-black/25 p-2.5 text-[11px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gr-gold">Optimisation</p>
      <div className="space-y-0.5">
        {cellule('Zone :', synthese.zone, 'text-gr-gold')}
        {cellule('Faction :', synthese.faction, 'text-gr-gold')}
        {cellule(synthese.libelleSeuil, synthese.seuil != null ? `${synthese.seuil} km` : null, 'text-gr-gold')}
        {synthese.seuilDeplacement != null && cellule('Déplacements au seuil :', `${synthese.seuilDeplacement} km`, 'text-gr-gold')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-0.5 rounded-lg border border-[#E11D2E]/30 bg-[#E11D2E]/6 p-2">
          <p className="text-[9.5px] font-bold uppercase text-red-300">Avant</p>
          {cellule('Conflits détectés', synthese.conflitsAvant, 'text-red-300')}
          {cellule('Barrages concernés', synthese.concernes)}
        </div>
        <div className="space-y-0.5 rounded-lg border border-gr-green/30 bg-gr-green/6 p-2">
          <p className="text-[9.5px] font-bold uppercase text-gr-green">Après</p>
          {cellule('Conflits résolus', synthese.resolus, 'text-gr-green')}
          {cellule('Conflits restants', synthese.restants, 'text-red-300')}
          {cellule('Déplacements', synthese.deplacements, 'text-sky-300')}
          {cellule('Retraits proposés', synthese.retraits)}
          {cellule('Conservés', synthese.conserves)}
          {cellule('Intouchables protégés', synthese.intouchables, 'text-[#F59E0B]')}
          {synthese.entreIntouchables > 0 && cellule('Intouchable ↔ Intouchable', synthese.entreIntouchables, 'text-white/60')}
        </div>
      </div>

      {simulation?.libelle && (
        <div className="rounded-lg border border-white/12 bg-white/5 px-2 py-1.5 text-[10px] leading-snug text-white/70">
          <b className="font-mono text-white/90">Simulation #{simulation.libelle}</b>
          <span className="block">
            Créée : {heure(simulation.creee)} · Zone : {simulation.zone ?? synthese.zone} · Faction : {simulation.factionId ?? synthese.faction} · Seuil : {synthese.seuilDeplacement ?? synthese.seuil} km
          </span>
        </div>
      )}
      {autreFaction && (
        <div role="status" data-gr-resultat-autre-faction="1" className="rounded-lg border border-sky-400/40 bg-sky-400/10 p-2 text-[10.5px] leading-snug text-white/80">
          <b className="block text-sky-300">ℹ Résultat calculé pour la faction {autreFaction.resultat}</b>
          La carte affiche {autreFaction.carte} : les conflits de {autreFaction.resultat} restent visibles. Relancez pour analyser {autreFaction.carte}.
        </div>
      )}
      {etatSimulation && etatSimulation.valide === false && (
        <div role="alert" data-gr-simulation-perimee="1" className="space-y-1.5 rounded-lg border border-[#F59E0B]/50 bg-[#F59E0B]/12 p-2">
          {/* Un barrage a pris une NOUVELLE position officielle après cette
              simulation : on le dit, et on ne remplace rien en silence. */}
          {positionChangee && simulation?.creee && positionChangee.ts > Date.parse(simulation.creee) ? (
            <>
              <p data-gr-position-officielle-changee={positionChangee.barrageId} className="text-[11.5px] font-bold text-amber-300">
                ⚠ La position officielle de ce barrage a changé.
              </p>
              <p className="text-[10.5px] text-white/75">
                <b className="block text-white/90">{positionChangee.nom}</b>
                Les résultats d’optimisation doivent être recalculés.
              </p>
              <button type="button" onClick={onRelancer} className={`${bouton} w-full bg-[#F59E0B] font-bold uppercase text-gr-navy hover:brightness-110`}>
                Recalculer
              </button>
            </>
          ) : (
            <>
              <p className="text-[11.5px] font-bold text-amber-300">⚠ Cette optimisation n’est plus valide.</p>
              <p className="text-[10.5px] text-white/75">
                {etatSimulation.raison === 'les données ont changé depuis l’analyse.'
                  ? 'Les données ont changé depuis l’analyse.'
                  : `Motif : ${etatSimulation.raison}`}
              </p>
              <button type="button" onClick={onRelancer} className={`${bouton} w-full bg-[#F59E0B] font-bold uppercase text-gr-navy hover:brightness-110`}>
                Relancer l’optimisation
              </button>
            </>
          )}
        </div>
      )}

      <FiltresOptimisation filtres={filtres} onFiltres={onFiltres} />
      <button type="button" onClick={onDetails} className={`${bouton} w-full border border-white/15 bg-white/5 font-bold uppercase text-white/80 hover:bg-white/12`}>
        Voir les détails
      </button>
    </div>
  );
}

/**
 * FILTRES D'AFFICHAGE — la carte et les listes, JAMAIS la simulation.
 * Décocher masque ; rien n'est recalculé, rien ne sort de l'analyse.
 */
const FILTRES_OPTIMISATION = [
  ['conflits', 'Conflits'],
  ['deplacements', 'Déplacements'],
  ['retraits', 'Retraits proposés'],
  ['conserves', 'Conservés'],
  ['intouchables', 'Intouchables'],
];
function FiltresOptimisation({ filtres, onFiltres }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filtres d'affichage de l’optimisation">
      {FILTRES_OPTIMISATION.map(([cle, libelle]) => (
        <label
          key={cle}
          className={`flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${
            filtres[cle] ? 'border-gr-gold/50 bg-gr-gold/12 text-gr-gold' : 'border-white/12 bg-white/5 text-white/45'
          }`}
        >
          <input
            type="checkbox"
            data-gr-filtre={cle}
            checked={filtres[cle]}
            onChange={(e) => onFiltres({ ...filtres, [cle]: e.target.checked })}
            className="h-3 w-3 accent-gr-gold"
          />
          {libelle}
        </label>
      ))}
    </div>
  );
}

/**
 * LE JOURNAL DE L'OPTIMISATION — lu dans le journal existant (`/api/journal`,
 * catégorie « optimisation »). Chaque ligne : heure, auteur, périmètre et
 * faction, barrage, distances, action, statut.
 */
function JournalOptimisation({ entrees }) {
  if (!entrees?.length) return null;
  const km = (v) => (v != null ? `${Number(v).toFixed(2)} km` : '—');
  const ACTION = { conserver: 'CONSERVER', deplacer: 'DÉPLACER', supprimer: 'SUPPRIMER' };
  return (
    <Depliable cle="journal-optimisation" className="rounded-xl border border-white/10 bg-black/20 p-2.5">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-white/80">
        Journal de l’optimisation ({entrees.length})
      </summary>
      <ol className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1 text-[10px] leading-snug text-white/70" data-gr-journal="1">
        {entrees.map((e, i) => {
          const d = e.details ?? {};
          const heure = new Date(e.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          return (
            <li key={`${e.ts}-${i}`} className="rounded-md border border-white/8 bg-white/4 px-2 py-1">
              <span className="font-mono text-white/90">{heure}</span> · {e.matricule ?? '—'} · {d.zone ?? '—'} / {d.factionId ?? '—'}
              {e.action === 'optimisation_decision' ? (
                <>
                  <span className="block font-mono text-white/85">
                    {e.id} {d.distanceAvantKm != null || d.distanceApresKm != null ? `· ${km(d.distanceAvantKm)} → ${km(d.distanceApresKm)}` : ''}
                  </span>
                  <span className="block">
                    Action : <b>{ACTION[d.type] ?? d.type}</b> · Statut : <b>{d.statut}</b>
                    {d.raison ? <> · {d.raison}</> : null}
                  </span>
                </>
              ) : (
                <span className="block">
                  {e.action === 'optimisation_simulation' ? `Simulation ${d.simulation} — ${d.nombre} proposition(s)` : `Activation ${d.simulation ?? ''}`} · Statut : <b>{d.statut}</b>
                  {d.raison ? <> · {d.raison}</> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Depliable>
  );
}

/**
 * LES DÉCISIONS D'UN CONFLIT — CONSERVER / DÉPLACER / SUPPRIMER, simulées.
 *
 * Le type de décision reste celui du projet (`conserver` | `deplacer` |
 * `supprimer`, soit keep / move / delete) : un seul vocabulaire, celui du
 * serveur. Cliquer la décision déjà choisie la retire de la simulation.
 * Un poste protégé (Intouchable, porte de ville) n'a que CONSERVER.
 */
function ActionsConflit({ decision = null, protege = false, enCours = false, onDecider, explication = null, session = null, barrage = null, onAssigner = null, dejaAssigne = null }) {
  const estAdmin = session?.rang === 'admin';
  const km = (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)} km` : '—');
  const [confirmerRetrait, setConfirmerRetrait] = useState(false);
  const [voirPourquoi, setVoirPourquoi] = useState(false);
  const btn = (type, libelle, teinte) => {
    const actif = decision?.type === type;
    return (
      <button
        type="button"
        disabled={enCours}
        aria-pressed={actif}
        data-gr-decision={type}
        title={type === 'deplacer'
          ? 'Choisir la nouvelle position sur la carte — simulé, rien n’est écrit'
          : actif ? 'Retirer cette décision de la simulation' : `${libelle} — simulé, rien n'est écrit`}
        onClick={() => {
          if (type === 'supprimer' && !actif) {
            setConfirmerRetrait(true);
            return;
          }
          onDecider?.(type);
        }}
        className={`flex-1 rounded-md border px-1.5 py-1 text-[9.5px] font-bold uppercase tracking-wide transition-colors disabled:opacity-40 ${
          actif ? teinte.actif : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/12 hover:text-white'
        }`}
      >
        {type === 'deplacer' && actif ? 'Modifier la position' : libelle}
      </button>
    );
  };
  let etat = null;
  if (decision?.statut === 'en_cours') {
    etat = <span className="text-white/55">Calcul de la simulation…</span>;
  } else if (decision?.statut === 'refuse') {
    etat = <span className="text-amber-300">⚠ Refusé — {decision.raison}</span>;
  } else if (decision?.type === 'conserver') {
    etat = (
      <span className="text-gr-green">
        ✓ CONSERVÉ
        {decision.conflitRestant && (
          <span className="block text-amber-300">⚠ Conflit restant : {km(decision.distanceApresKm)}</span>
        )}
      </span>
    );
  } else if (decision?.type === 'deplacer') {
    etat = (
      <span className="text-sky-300">
        ↗ DÉPLACEMENT PROPOSÉ
        <span className="block font-mono">
          AVANT {km(decision.distanceAvantKm)} ❌ · APRÈS {km(decision.distanceApresKm)} {decision.conflitRestant ? '❌' : '✓'}
        </span>
        {decision.apres?.route && <span className="block text-white/55">sur {decision.apres.route}, par la route réelle</span>}
      </span>
    );
  } else if (decision?.type === 'supprimer') {
    etat = (
      <span className="text-red-300">
        ⚠ SUPPRESSION PROPOSÉE
        <span className="block font-normal text-white/60">
          Ce barrage sera supprimé uniquement après « Activer les modifications » (retrait soumis au commandement).
        </span>
      </span>
    );
  }
  return (
    <div className="space-y-1 px-1 pb-1">
      {protege && <p className="text-[10px] font-bold text-[#F59E0B]">🔒 INTOUCHABLE / PROTÉGÉ</p>}
      <div className="flex gap-1">
        {estAdmin && dejaAssigne ? (
          <span
            className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-200 flex-1 text-center"
            title={`Assigné à ${dejaAssigne} — en attente de traitement.`}
          >
            ✓ Assigné à {dejaAssigne}
          </span>
        ) : estAdmin ? (
          <button
            type="button"
            onClick={() => onAssigner?.(barrage)}
            className="flex-1 rounded-lg border border-gr-gold/60 bg-gr-gold/20 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-gr-gold hover:bg-gr-gold/30 transition-colors"
          >
            Assigner au CMND Région
          </button>
        ) : (
          <>
            {btn('conserver', 'Conserver', { actif: 'border-gr-green/60 bg-gr-green/20 text-gr-green' })}
            {!protege && btn('deplacer', 'Déplacer', { actif: 'border-sky-400/60 bg-sky-400/20 text-sky-300' })}
            {!protege && btn('supprimer', 'Supprimer', { actif: 'border-[#E11D2E]/60 bg-[#E11D2E]/20 text-red-300' })}
          </>
        )}
      </div>
      {confirmerRetrait && !protege && !estAdmin && (
        <div role="alertdialog" aria-label="Supprimer ce barrage ?" className="space-y-1.5 rounded-lg border border-[#E11D2E]/45 bg-[#E11D2E]/10 p-2">
          <p className="text-[11px] font-bold text-red-300">Supprimer ce barrage ?</p>
          <p className="text-[10.5px] leading-snug text-white/75">
            Le retrait sera proposé au commandement. Le barrage ne sera pas supprimé immédiatement.
          </p>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setConfirmerRetrait(false)} className="flex-1 rounded-md border border-white/15 bg-white/8 px-2 py-1 text-[10px] font-bold uppercase text-white/80 hover:bg-white/14">
              Annuler
            </button>
            <button
              type="button"
              data-gr-confirmer-retrait="1"
              onClick={() => {
                setConfirmerRetrait(false);
                onDecider?.('supprimer');
              }}
              className="flex-1 rounded-md border border-[#E11D2E]/60 bg-[#E11D2E]/25 px-2 py-1 text-[10px] font-bold uppercase text-red-300 hover:bg-[#E11D2E]/35"
            >
              Confirmer le retrait
            </button>
          </div>
        </div>
      )}
      {etat && <p className="text-[10px] font-bold leading-snug">{etat}</p>}
      {explication && (
        <>
          <button type="button" data-gr-pourquoi-bouton="1" onClick={() => setVoirPourquoi((v) => !v)} className="text-[10px] font-semibold text-gr-gold hover:underline">
            {voirPourquoi ? 'Masquer' : 'Pourquoi ?'}
          </button>
          {voirPourquoi && <ExplicationOptimisation {...explication} decision={decision} intouchable={protege} estAdmin={estAdmin} />}
        </>
      )}
    </div>
  );
}

/**
 * ACTIVER LES MODIFICATIONS — MANUEL. Les décisions simulées par le SERVEUR
 * (`simulationId`), revalidées par la même route d'application sécurisée.
 */
function ActivationManuelle({ simulation, enCours, calculEnCours, onActiver, onAnnuler }) {
  if (!simulation?.decisions?.length) return null;
  const retenues = simulation.decisions.filter((d) => d.statut === 'simule');
  const n = (t) => retenues.filter((d) => d.type === t).length;
  const refusees = simulation.decisions.length - retenues.length;
  const restants = retenues.filter((d) => d.conflitRestant).length;
  const indisponible = enCours || calculEnCours || !simulation.simulationId || retenues.length === 0;
  return (
    <div className="space-y-2 rounded-xl border border-gr-green/35 bg-gr-green/8 p-3">
      <p className="text-[12px] font-bold text-gr-green">✓ Optimisation simulée</p>
      <ul className="space-y-0.5 text-[11.5px] text-white/80">
        <li><b className="font-mono text-white">{n('deplacer')}</b> déplacement(s) proposé(s)</li>
        <li><b className="font-mono text-white">{n('supprimer')}</b> suppression(s) proposée(s)</li>
        <li><b className="font-mono text-white">{n('conserver')}</b> conservation(s)</li>
        {restants > 0 && <li><b className="font-mono text-amber-300">{restants}</b> conflit(s) restant(s) après décision</li>}
        {refusees > 0 && <li><b className="font-mono text-amber-300">{refusees}</b> décision(s) refusée(s) par le serveur</li>}
      </ul>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={enCours}
          onClick={onAnnuler}
          className="flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 px-4 text-[12px] font-bold uppercase text-white/75 hover:bg-white/14 hover:text-white disabled:opacity-40 transition-all"
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={indisponible}
          onClick={onActiver}
          className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-gr-gold text-gr-navy font-bold text-[12px] uppercase shadow-lg hover:brightness-110 disabled:opacity-40 transition-all"
        >
          {enCours ? <IconSpinner size={16} /> : <IconCoche size={16} />}
          <span>{enCours ? 'Activation en cours…' : calculEnCours ? 'Calcul en cours…' : 'Activer les modifications'}</span>
        </button>
      </div>
      <p className="text-[9.5px] leading-snug text-white/45">
        Le serveur revalide chaque décision avant d’écrire. Une suppression part au commandement
        concerné, selon le circuit de validation habituel.
      </p>
    </div>
  );
}

/**
 * ↻ RÉINITIALISER L'OPTIMISATION — le RÉSULTAT, pas la configuration.
 *
 * Confirmation demandée seulement s'il reste des modifications simulées non
 * activées ; sinon, la remise à zéro est immédiate.
 */
/**
 * ↶ RESTAURER AVANT SIMULATION — revenir à l'état d'avant la simulation en cours.
 *
 * Distinct de « ↩ Restaurer les positions initiales » (Administration), qui
 * ramène toute la démonstration à sa référence : celui-ci ne touche qu'à la
 * simulation en cours et à ce qu'elle a pu activer, jamais à la référence.
 */
function RestaurationAvantSimulation({ confirmer, enCours, message, onDemander, onConfirmer, onRenoncer }) {
  return (
    <div className="space-y-2" data-gr-avant-simulation="1">
      {confirmer ? (
        <div role="alertdialog" aria-label="Restaurer l’état avant simulation ?" className="space-y-2 rounded-xl border border-sky-400/45 bg-sky-400/10 p-3">
          <p className="text-[12px] font-bold text-sky-200">Restaurer l’état avant simulation ?</p>
          <p className="text-[11px] leading-snug text-white/75">Toutes les modifications simulées seront annulées.</p>
          <div className="flex gap-2">
            <button type="button" disabled={enCours} onClick={onRenoncer} className={`${bouton} flex-1 border border-white/15 bg-white/8 text-white/80 hover:bg-white/14`}>
              Annuler
            </button>
            <button type="button" disabled={enCours} onClick={onConfirmer} className={`${bouton} flex-1 bg-sky-400 font-bold text-gr-navy hover:brightness-110`}>
              {enCours ? 'Restauration…' : 'Restaurer'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onDemander}
          title="Revenir à l’état des barrages d’avant la simulation en cours"
          className={`${bouton} w-full border border-sky-400/45 bg-sky-400/8 font-semibold text-sky-200 hover:bg-sky-400/16`}
        >
          ↶ Restaurer avant simulation
        </button>
      )}
      {message && (
        <p role="status" data-gr-message-avant-simulation={message.ton} className={`rounded-lg px-3 py-2 text-[11.5px] font-semibold ${message.ton === 'alerte' ? 'bg-gr-red/12 text-gr-red' : 'bg-white/6 text-white/75'}`}>
          {message.texte}
        </p>
      )}
    </div>
  );
}

function Reinitialisation({ visible, enAttente, confirmer, onDemander, onConfirmer, onRenoncer }) {
  if (!visible) return null;
  if (confirmer) {
    return (
      <div role="alertdialog" aria-label="Réinitialiser l’optimisation ?" className="space-y-2 rounded-xl border border-[#F59E0B]/45 bg-[#F59E0B]/10 p-3">
        <p className="text-[12px] font-bold text-amber-300">Réinitialiser l’optimisation ?</p>
        <p className="text-[11px] leading-snug text-white/75">
          Toutes les modifications simulées non activées seront perdues.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onRenoncer} className={`${bouton} flex-1 border border-white/15 bg-white/8 text-white/80 hover:bg-white/14`}>
            Annuler
          </button>
          <button type="button" onClick={onConfirmer} className={`${bouton} flex-1 bg-[#F59E0B] font-bold text-gr-navy hover:brightness-110`}>
            Réinitialiser
          </button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => (enAttente ? onDemander() : onConfirmer())}
      className={`${bouton} w-full border border-white/15 bg-white/5 py-2 font-bold uppercase tracking-wide text-white/80 hover:bg-white/12 hover:text-white`}
    >
      ↻ Réinitialiser l’optimisation
    </button>
  );
}

/**
 * « ACTIVER LES MODIFICATIONS » — appliquer la simulation AFFICHÉE, rien d'autre.
 *
 * Le bouton ne calcule rien : il envoie les propositions retenues de CETTE
 * simulation (`simulationId`) à la route sécurisée d'application, qui revalide
 * tout côté serveur — RBAC, propriété et fraîcheur de la simulation,
 * Intouchables, territoire, position routière, distances, conflits. Il est
 * indisponible tant qu'aucune simulation n'a abouti, et pendant un calcul.
 */
function ActivationOptimisation({ rapport, retenus, applicationEnCours, calculEnCours, onActiver, onAnnuler, session = null }) {
  if (!rapport?.propositions) return null;
  const { resume = {} } = rapport;
  const entreIntouchables = resume.conflitsEntreIntouchables ?? 0;
  const restants = (resume.conflitsApres ?? 0) - entreIntouchables;
  const aDeplacer = rapport.propositions.filter((p) => p.action === 'deplacer').length;
  const indisponible = applicationEnCours || calculEnCours || retenus === 0;
  const estAdmin = session?.rang === 'admin';
  return (
    <div className="space-y-2 rounded-xl border border-gr-green/35 bg-gr-green/8 p-3">
      <p className="text-[12px] font-bold text-gr-green">✓ Optimisation simulée</p>
      <ul className="space-y-0.5 text-[11.5px] text-white/80">
        <li>
          <b className="font-mono text-white">{aDeplacer}</b> barrage(s) à déplacer
          {retenus !== aDeplacer && <span className="text-white/50"> · {retenus} retenu(s)</span>}
        </li>
        <li>
          <b className="font-mono text-gr-green">{resume.conflitsResolus ?? 0}</b> conflit(s) résolu(s)
        </li>
        <li>
          <b className="font-mono text-red-300">{restants}</b> conflit(s) restant(s)
        </li>
      </ul>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={applicationEnCours}
          onClick={onAnnuler}
          className="flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/8 px-4 text-[12px] font-bold uppercase text-white/75 hover:bg-white/14 hover:text-white disabled:opacity-40 transition-all"
        >
          Annuler
        </button>
        {estAdmin ? (
          <div className="flex-1 rounded-xl border border-white/10 bg-white/5 p-2 text-center text-[11px] text-white/70">
            Super Admin : rôle de consultation et filtrage. Assignez ces barrages aux CMND Région pour mise en œuvre.
          </div>
        ) : (
          <button
            type="button"
            disabled={indisponible}
            onClick={onActiver}
            className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-gr-gold text-gr-navy font-bold text-[12px] uppercase shadow-lg hover:brightness-110 disabled:opacity-40 transition-all"
          >
            {applicationEnCours ? <IconSpinner size={16} /> : <IconCoche size={16} />}
            <span>
              {applicationEnCours
                ? 'Activation en cours…'
                : calculEnCours
                  ? 'Calcul en cours…'
                  : retenus === 0
                    ? 'Aucune modification retenue'
                    : 'Activer les modifications'}
            </span>
          </button>
        )}
      </div>
      <p className="text-[9.5px] leading-snug text-white/45">
        Applique la simulation affichée, sans nouveau calcul. Le serveur revalide chaque position
        avant toute écriture ; rien n’est enregistré avant ce clic.
      </p>
    </div>
  );
}

/**
 * L'APERÇU DES DÉPLACEMENTS SIMULÉS EN MANUEL — au format de l'automatique.
 *
 * Même calque (ancienne / nouvelle position, trajet routier réel, second
 * barrage visible) et mêmes routes AVANT / APRÈS : tout vient du serveur
 * (décision `deplacer`) et de la mesure initiale ; rien n'est inventé.
 */
/**
 * LES BARRAGES EN CONFLIT DE DISTANCE — publiés pour la carte (BarragesEnConflitLayer).
 *
 * Source : la MESURE DU SERVEUR sur les positions officielles (`lignesInitiales`),
 * jamais un état d'écran. Chaque poste sous le seuil y figure — à trancher,
 * protégé, conservé, en retrait proposé, déjà décidé dans la simulation — ainsi
 * que les postes de CONTEXTE (hors zone) qui sont l'autre extrémité d'un conflit.
 * La simulation, quand elle existe, ne dit que l'ISSUE (« résolu » / « restant ») :
 * tant que rien n'est activé, le conflit officiel demeure.
 */
function conflitsManuels(lignesInitiales, rapport, rapportSimule, decisionsVue) {
  const seuilKm = rapport?.parametres?.distanceMinKm ?? null;
  const sous = (lignesInitiales ?? []).filter((b) => b.sousLeSeuil);
  const simules = rapportSimule?.barrages ? new Map(rapportSimule.barrages.map((b) => [b.id, b])) : null;
  const parId = new Map((lignesInitiales ?? []).map((b) => [b.id, b]));
  const out = new Map();
  for (const b of sous) {
    const etat = b.intouchable === true
      ? 'protege'
      : decisionsVue.has(b.id)
        ? 'decide'
        : b.decision === 'conserve'
          ? 'conserve'
          : b.decision === 'a_supprimer' ? 'a_supprimer' : 'a_trancher';
    const v = b.voisin?.id ? parId.get(b.voisin.id) : null;
    out.set(b.id, {
      id: b.id, etat, km: b.distanceKm, seuilKm,
      voisinId: b.voisin?.id ?? null, voisinNom: b.voisin?.nom || b.voisin?.id || null,
      voisinIntouchable: b.voisin?.intouchable === true || v?.intouchable === true,
      trace: b.voisin?.route?.trace ?? null,
      issue: simules ? (simules.get(b.id)?.sousLeSeuil ? 'restant' : 'resolu') : null,
    });
  }
  for (const b of sous) {
    if (b.voisin?.id && !out.has(b.voisin.id)) {
      const v = parId.get(b.voisin.id);
      out.set(b.voisin.id, {
        id: b.voisin.id,
        etat: (v?.intouchable === true || v?.protection === 'intouchable') ? 'protege' : 'a_trancher',
        km: b.distanceKm,
        seuilKm,
        voisinId: b.id,
        voisinNom: b.nom || b.id,
        voisinIntouchable: b.intouchable === true,
        trace: b.voisin?.route?.trace ?? null,
        issue: simules ? (simules.get(b.voisin.id)?.sousLeSeuil ? 'restant' : 'resolu') : null,
      });
    }
  }
  for (const c of rapport?.contexte ?? []) {
    if (out.has(c.id)) continue;
    const partenaire = sous.find((b) => b.voisin?.id === c.id) ?? sous.find((b) => (c.pour ?? []).includes(b.id));
    out.set(c.id, {
      id: c.id, etat: 'contexte', km: partenaire?.distanceKm ?? null, seuilKm,
      voisinId: partenaire?.id ?? null, voisinNom: partenaire?.nom || partenaire?.id || null,
      voisinIntouchable: partenaire?.intouchable === true,
      trace: partenaire?.voisin?.route?.trace ?? null,
      issue: null,
    });
  }
  return out;
}

/**
 * LES MÊMES REPÈRES EN AUTOMATIQUE — les deux extrémités de chaque conflit
 * initial (positions officielles), avec leur conflit le plus serré ; l'issue
 * vient de l'état final de la simulation (`conflitsRestants`).
 */
function conflitsAuto(rapportAuto, items) {
  const seuilKm = rapportAuto?.seuilKm ?? null;
  const parId = new Map((items ?? []).map((m) => [m.id, m]));
  const estIntou = (m) => m?.protection === 'intouchable' || m?.intouchable === true;
  const restants = new Set((rapportAuto?.conflitsRestants ?? []).map((c) => [c.a?.id ?? c.a, c.b?.id ?? c.b].sort().join('|')));
  const out = new Map();
  for (const c of rapportAuto?.conflitsInitiaux ?? []) {
    const issue = restants.has([c.a, c.b].sort().join('|')) ? 'restant' : 'resolu';
    for (const [id, autre] of [[c.a, c.b], [c.b, c.a]]) {
      const deja = out.get(id);
      if (deja && deja.km <= c.km) continue;
      const v = parId.get(autre);
      out.set(id, {
        id, etat: estIntou(parId.get(id)) ? 'protege' : 'restant', km: c.km, seuilKm,
        voisinId: autre, voisinNom: v?.nom || autre, voisinIntouchable: estIntou(v), trace: null, issue,
      });
    }
  }
  return out;
}

function apercuManuel(decisionsVue, lignesInitiales, items, seuils = {}) {
  const estIntou = (m) => m?.protection === 'intouchable' || m?.intouchable === true;
  const parId = new Map((items ?? []).map((m) => [m.id, m]));
  const apercu = [];
  const routesConflit = [];
  for (const d of decisionsVue.values()) {
    if (d.type !== 'deplacer' || d.statut !== 'simule' || !d.apres) continue;
    const initiale = (lignesInitiales ?? []).find((b) => b.id === d.barrageId);
    const voisin = parId.get(d.voisinAvant);
    const statut = d.conflitRestant ? 'conflit' : 'resolu';
    apercu.push({
      id: d.barrageId,
      nom: d.nom,
      action: 'deplacer',
      lng: d.apres.lng,
      lat: d.apres.lat,
      lngAvant: d.avant.lng,
      latAvant: d.avant.lat,
      routeAvant: d.avant.route,
      routeApres: d.apres.route,
      routeDeplacement: d.routeDeplacement ?? null,
      conflitAvant: { id: d.voisinAvant, km: d.distanceAvantKm },
      distanceApresKm: d.distanceApresKm,
      statut,
      /* Le seuil MANUEL de la mesure, et — à part — la règle de déplacement
         que l'activation applique. Les deux viennent du serveur. */
      seuilKm: seuils.manuel ?? null,
      seuilDeplacementKm: seuils.deplacement ?? null,
      mode: 'manuel',
      choixOperateur: d.choixOperateur === true,
      recalageM: d.recalageM ?? null,
      espace: d.espace ?? 'zone',
      espaceAdjacent: d.espaceAdjacent ?? null,
      activable: d.activable ?? null,
      conflitActivation: d.conflitActivation ?? null,
      voisinApresId: d.voisinApres ?? null,
      voisinApresNom: d.voisinApresNom ?? null,
      factionId: parId.get(d.barrageId)?.factionId ?? '',
      conflit: voisin
        ? {
            id: voisin.id, nom: voisin.nom, lng: voisin.lng, lat: voisin.lat,
            intouchable: estIntou(voisin), deplaceAussi: decisionsVue.get(voisin.id)?.type === 'deplacer',
          }
        : null,
    });
    const avant = initiale?.voisin?.route?.trace;
    if (avant?.length > 1) {
      routesConflit.push({
        cle: `${[d.barrageId, d.voisinAvant].sort().join('|')}-manuel-avant`,
        phase: 'avant', trace: avant, km: d.distanceAvantKm, statut: 'conflit',
        a: { id: d.barrageId, nom: d.nom, lng: d.avant?.lng, lat: d.avant?.lat },
        b: { id: d.voisinAvant, nom: voisin?.nom, lng: voisin?.lng, lat: voisin?.lat },
      });
    }
    if (d.routeApres?.length > 1) {
      routesConflit.push({
        cle: `${[d.barrageId, d.voisinApres].sort().join('|')}-manuel-apres`,
        phase: 'apres', trace: d.routeApres, km: d.distanceApresKm, statut,
        a: { id: d.barrageId, nom: d.nom, deplace: true, lng: d.apres?.lng, lat: d.apres?.lat },
        b: { id: d.voisinApres, nom: d.voisinApresNom, lng: parId.get(d.voisinApres)?.lng, lat: parId.get(d.voisinApres)?.lat },
      });
    }
  }
  return apercu.length ? { apercu, routesConflit } : {};
}

/**
 * CE QUE L'OPTIMISATION MANUELLE A ANALYSÉ — et ce qu'elle montre en plus.
 *
 * Les postes de CONTEXTE sont hors de la zone analysée : ils ne sont là que
 * parce qu'un poste analysé est en conflit avec eux. Ils ne sont pas comptés
 * parmi les analysés, et le total affiché le dit.
 */
function PerimetreManuel({ perimetre }) {
  if (!perimetre) return null;
  const ligne = (libelle, valeur) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-white/55">{libelle}</span>
      <b className="font-mono text-gr-gold">{valeur}</b>
    </div>
  );
  return (
    <div className="space-y-1 rounded-lg border border-gr-gold/30 bg-black/20 px-2.5 py-2 text-[11px]">
      {ligne('Zone analysée :', perimetre.zoneLibelle)}
      {ligne('Faction :', FACTION_LIBELLE[perimetre.factionId] ?? perimetre.factionId)}
      {ligne('Barrages analysés :', perimetre.analyses)}
      {ligne('Barrages de contexte :', perimetre.contexte)}
      {ligne('Total affiché :', perimetre.analyses + perimetre.contexte)}
      <p className="text-[10px] leading-snug text-white/45">
        « Contexte » : voisin hors zone d’un conflit détecté, montré pour le comprendre, ni compté
        ni analysé. {perimetre.horsPerimetreExclus} poste(s) autorisé(s) hors zone ou d’une autre
        faction ne sont pas pris en compte.
      </p>
    </div>
  );
}

/**
 * CE QUI EST DÉPLIÉ SURVIT AU REPLI DU PANNEAU.
 *
 * Replié, le panneau ne rend rien : ses `<details>` sont démontés et se
 * rouvraient fermés. Leur état vit donc ici, hors du rendu, pour la durée de
 * la page — rien de sensible, rien d'envoyé au serveur.
 */
const DEPLIAGES = new Map();
function Depliable({ cle, className, children, ...rest }) {
  const [ouvert, setOuvert] = useState(() => DEPLIAGES.get(cle) === true);
  return (
    <details
      {...rest}
      className={className}
      open={ouvert}
      onToggle={(e) => {
        DEPLIAGES.set(cle, e.currentTarget.open);
        setOuvert(e.currentTarget.open);
      }}
    >
      {children}
    </details>
  );
}

const FACTION_LIBELLE = {
  toutes: 'Toutes les factions',
  all: 'Toutes les factions',
  F1: 'Faction 1 (00h00 → 06h00)',
  F2: 'Faction 2 (06h00 → 12h00)',
  F3: 'Faction 3 (12h00 → 18h00)',
  F4: 'Faction 4 (18h00 → 00h00)',
};

/**
 * UNE LIGNE DE PROPOSITION — l'avant, l'après, et pourquoi.
 *
 * Un maintien ne porte PAS de case à cocher : il n'y a rien à appliquer. Le
 * lui donner laisserait croire qu'on peut « valider » une absence de
 * changement, et le serveur refuserait la ligne.
 */
/**
 * CADRER UNE PROPOSITION SUR SES ROUTES — le déplacement et le conflit initial.
 * La carte montre alors les deux barrages et le trajet, sans anneau de visée.
 */
const cadrageProposition = (p) => {
  const trace = [...(p.routeDeplacement?.trace ?? []), ...(p.conflit?.trace ?? [])];
  return trace.length > 1 ? { trace } : undefined;
};

function LigneProposition({ p, choisi, onBasculer, onCadrer, gesteEnCours, seuilKm }) {
  const a = ACTIONS[p.action] ?? ACTIONS.conserver;
  const applicable = p.action !== 'conserver';
  const positionActuelle =
    Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
      : 'non renseignée';
  const positionProposee =
    Number.isFinite(p.nouvelleLat) && Number.isFinite(p.nouvelleLng)
      ? `${p.nouvelleLat.toFixed(5)}, ${p.nouvelleLng.toFixed(5)}`
      : Number.isFinite(p.apres?.lat) && Number.isFinite(p.apres?.lng)
        ? `${p.apres.lat.toFixed(5)}, ${p.apres.lng.toFixed(5)}`
        : 'sans solution automatique';

  return (
    <li className={`rounded-xl border p-2.5 space-y-2 ${choisi && applicable ? a.bord : 'border-white/10 bg-black/20'}`}>
      <div className="flex items-start gap-2">
        {applicable ? (
          <input
            type="checkbox"
            checked={choisi}
            onChange={() => onBasculer?.(p.id)}
            aria-label={`Retenir : ${a.mot} ${p.nom}`}
            className="mt-0.5 h-4 w-4 shrink-0 accent-gr-gold cursor-pointer"
          />
        ) : (
          <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-white/90">{p.nom}</p>
          <p className="text-[9px] leading-tight text-white/50 break-words">
            Région {p.reg || '—'} · Cie {p.cie || '—'} · BT {p.bt || '—'} · Route {p.route || '—'}
          </p>
          <p className="text-[9px] leading-tight text-white/40 break-all">
            ID {p.id}
          </p>
        </div>
        <span className={`shrink-0 rounded-md bg-white/8 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${a.couleur}`}>
          {a.mot}
        </span>
      </div>

      {/* AVANT → APRÈS, en tableau : c'est ce qu'on compare d'une ligne à l'autre. */}
      <div className="rounded-lg border border-white/8 bg-black/30 px-2 py-1.5 text-[10px] space-y-0.5">
        <div className="flex justify-between gap-2 text-white/70">
          <span>Conflit avec :</span>
          <span className="truncate font-semibold text-white/90">{p.conflit?.nom}</span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Conflit par la route :</span>
          <span className="font-mono font-bold text-white/90">
            {p.conflitAvant?.km != null ? `${Number(p.conflitAvant.km).toFixed(1)} km` : '—'}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Minimum requis :</span>
          <span className="font-mono text-white/60">{seuilKm != null ? `${seuilKm} km` : '—'}</span>
        </div>
      </div>

      {/**
        * CE QUI CHANGE, ET CE QUI NE CHANGE PAS — les deux, côte à côte.
        *
        * La colonne de droite n'est pas une décoration rassurante : c'est la
        * lecture dont le commandement a besoin pour signer. Un chef de
        * compagnie n'accepte pas une réaffectation sans voir, sur la même
        * ligne, que ses hommes et son horaire n'y sont pour rien.
        */}
      <div className="rounded-lg border border-white/8 bg-black/30 px-2 py-1.5 text-[10px] space-y-0.5">
        <div className="flex justify-between gap-2 text-white/70">
          <span>Barrage :</span>
          <span className="truncate font-semibold text-white/90">{p.nom}</span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Ancienne faction :</span>
          <span className="truncate font-semibold text-white/90">
            {FACTION_LIBELLE[p.factionId] ?? 'non renseignée'}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Contraintes avant :</span>
          <span className="max-w-[65%] text-right font-semibold text-white/85">
            {p.avant?.contraintes?.length ? p.avant.contraintes.join(', ') : 'aucune renseignée'}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Position actuelle :</span>
          <span className="max-w-[60%] text-right font-mono font-semibold text-white/85 break-all">{positionActuelle}</span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Nouvelle faction :</span>
          <span className="truncate font-semibold text-sky-300">
            {FACTION_LIBELLE[p.apres?.factionId ?? p.factionId] ?? p.apres?.factionId ?? p.factionId ?? 'inchangée'}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Éléments :</span>
          <span className="font-semibold text-gr-green">inchangés</span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Distance après :</span>
          <span className="font-semibold text-gr-green">
            {p.distanceApresKm == null ? 'aucun conflit ciblé' : `${Number(p.distanceApresKm).toFixed(1)} km`}
          </span>
        </div>
        <div className="flex justify-between gap-2 text-white/70">
          <span>Motif :</span>
          <span className="truncate text-right text-white/85">
            {p.action === 'deplacer' ? 'déplacement proposé sur le réseau routier' : 'aucune position routière valide'}
          </span>
        </div>
      </div>

      {/* L'EXPLICATION — une phrase par raison, dans l'ordre du raisonnement. */}
      <ul className="rounded-lg bg-black/25 px-2 py-1.5 space-y-0.5 border border-white/6">
        {(p.raisons ?? []).map((r, i) => (
          <li key={i} className="flex gap-1.5 text-[10px] leading-snug text-white/70">
            <span className={a.couleur}>•</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>

      {/* LE STATUT APRÈS LA PROPOSITION — le seul chiffre qui dise si elle sert. */}
      <div
        className={`rounded-lg px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider ${
          p.statut === 'resolu'
            ? 'bg-gr-green/15 text-gr-green'
            : 'bg-orange-400/15 text-orange-300'
        }`}
      >
        {p.statut === 'resolu' ? '✓ Conflit résolu' : '⚠ Conflit non résolu'}
      </div>

      {/* LE MAINTIEN, ÉCRIT EN TOUTES LETTRES — il n'y a rien à appliquer, et
          il faut que celui qui lit sache exactement ce qui a été décidé. */}
      {p.action === 'conserver' && (
        <div className="rounded-lg border border-orange-400/25 bg-orange-400/8 px-2 py-1.5 text-[10px] leading-snug text-orange-200/90 space-y-0.5">
          <p>
            <b>Motif :</b> aucune faction disponible
          </p>
          <p>
            <b>Action :</b> barrage conservé, affectation inchangée
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={gesteEnCours === p.id}
        onClick={() => onCadrer?.(p, cadrageProposition(p))}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/6 py-1.5 text-[10px] font-semibold text-white/75 hover:bg-white/14 hover:text-white transition-colors"
      >
        <IconCible size={12} />
        <span>Voir sur la carte</span>
      </button>
    </li>
  );
}

/**
 * LES CONFLITS NUMÉROTÉS — qui est en conflit avec qui, une paire par ligne.
 *
 * Les identifiants (C-01…) et les distances sont ceux que la carte dessine :
 * la liste lit le résultat PUBLIÉ (voir `conflitsIdentifies`), elle ne
 * recompte rien. Un clic désigne la paire : seule elle passe au premier plan
 * sur la carte, les autres restent visibles en retrait.
 *
 * Un même barrage peut figurer dans plusieurs lignes : chaque paire reste un
 * conflit à part, jamais fondu avec ses voisins de route.
 */
const MAX_CONFLITS_LISTES = 60;
function ListeConflits({ conflits, vise, onViser, seuilKm }) {
  if (!conflits?.length) return null;
  const initiaux = conflits.filter((c) => !c.nouveau);
  const nouveaux = conflits.filter((c) => c.nouveau);
  const nomPoste = (e) => `${e.nom}${e.deplace ? ' (déplacé)' : ''}`;
  const ligne = (c) => {
    const choisi = vise === c.id;
    const resolu = c.statut === 'resolu';
    return (
      <li key={c.id}>
        <button
          type="button"
          data-gr-conflit={c.id}
          aria-pressed={choisi}
          onClick={() => onViser?.(choisi ? null : c.id, { cadrer: !choisi })}
          className={`w-full rounded-lg border px-2 py-1.5 text-left transition-colors ${
            choisi ? 'border-[#E11D2E] bg-[#E11D2E]/15' : 'border-white/10 bg-black/20 hover:bg-white/8'
          }`}
        >
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            <span aria-hidden="true">{resolu ? '🟢' : '🔴'}</span>
            <span className="font-mono text-white">{c.id}</span>
            {c.nouveau && (
              <span className="rounded bg-[#E11D2E]/25 px-1 text-[9px] font-bold tracking-wide text-red-300">
                NOUVEAU CONFLIT
              </span>
            )}
            {c.statut === 'restant' && (
              <span className="rounded bg-orange-400/20 px-1 text-[9px] font-bold tracking-wide text-orange-200">
                RESTE EN CONFLIT
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10.5px] leading-snug text-white/85">
            <span className="text-white/45">A</span> {nomPoste(c.a)} <span className="text-white/45">↔ B</span> {nomPoste(c.b)}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] tabular-nums">
            {c.avantKm != null && (
              <span className="text-red-300">
                {c.statut === 'actif' ? '' : 'AVANT '}
                {kmConflit(c.avantKm)} ❌
              </span>
            )}
            {c.statut === 'resolu' && (
              <span className="text-gr-green">
                {' '}→ APRÈS {c.apresKm != null ? kmConflit(c.apresKm) : `≥ ${seuilKm ?? '—'} km`} ✓
              </span>
            )}
            {(c.statut === 'restant' || c.nouveau) && (
              <span className="text-red-300">
                {c.nouveau ? '' : ' → '}APRÈS {kmConflit(c.apresKm)} ❌
              </span>
            )}
          </div>
        </button>
      </li>
    );
  };
  return (
    <div data-gr-liste-conflits className="space-y-2 rounded-xl border border-[#E11D2E]/30 bg-[#E11D2E]/5 p-2.5">
      <div className="text-[11.5px] font-bold tracking-wide text-red-300">CONFLITS ACTIFS ({initiaux.length})</div>
      <p className="text-[9.5px] leading-snug text-white/50">
        Une ligne par paire mesurée par le serveur. Cliquez pour isoler la paire sur la carte.
      </p>
      <ul className="space-y-1">{initiaux.slice(0, MAX_CONFLITS_LISTES).map(ligne)}</ul>
      {initiaux.length > MAX_CONFLITS_LISTES && (
        <p className="text-[10px] italic text-white/35">… et {initiaux.length - MAX_CONFLITS_LISTES} autre(s)</p>
      )}
      {nouveaux.length > 0 && (
        <>
          <div className="pt-1 text-[11.5px] font-bold tracking-wide text-red-300">
            NOUVEAUX CONFLITS APRÈS DÉPLACEMENT ({nouveaux.length})
          </div>
          <ul className="space-y-1">{nouveaux.slice(0, MAX_CONFLITS_LISTES).map(ligne)}</ul>
        </>
      )}
    </div>
  );
}

function ResumeOptimisationAuto({
  rapport,
  onCadrer,
  onAppliquer,
  applicationEnCours,
  selection,
  onBasculerSelection,
  onToutAccepter,
  onToutRefuser,
  /** L'aperçu de la version proposée est-il posé sur la carte ? */
  apercu,
  onBasculerApercu,
  /** Jette la proposition sans rien écrire — le dépôt n'a pas bougé. */
  onAnnuler,
  gesteEnCours,
  /** Un calcul est en cours : activer n'a pas de sens tant qu'il n'a pas abouti. */
  calculEnCours = false,
  /** Change quand « Voir les détails » demande le détail déplié. */
  detailsCle = 0,
}) {
  if (!rapport) return null;
  const { resume, propositions = [], conflitsRestants = [], journal = [], mesures = null } = rapport;
  const {
    barragesAnalyses = 0,
    conflitsAvant = 0,
    conflitsApres = 0,
    conflitsResolus = 0,
    deplacements = 0,
    maintiens = 0,
    sansReseau = 0,
    repartitionFactionApres = {},
    interrompue = false,
    conflitsNonExamines = 0,
    propositionsOmises = 0,
    propositionsTotal = 0,
    tracesOmises = 0,
    dureeMs = null,
    conflitsEntreIntouchables = 0,
  } = resume ?? {};
  /* Les paires de deux Intouchables voisins sont hors de portée de toute
     proposition : elles sont dites à part, pas mêlées au problème de la zone. */
  const conflitsZoneAvant = conflitsAvant - conflitsEntreIntouchables;
  /** Le seuil appliqué par le serveur — jamais recopié ici. */
  const seuil = rapport.seuilKm;
  const conflitsZoneApres = conflitsApres - conflitsEntreIntouchables;

  const applicables = propositions.filter((p) => p.action === 'deplacer');
  const retenus = applicables.filter((p) => selection.has(p.id)).length;
  /* INCHANGÉS : les postes qu'aucune proposition ne touche, plus ceux qu'on a
     examinés puis maintenus. C'est le complément exact des applicables. */
  const inchanges = barragesAnalyses - applicables.length;
  /* Regroupées par nature : c'est ainsi que le commandement les lit. */
  const parAction = {
    deplacer: propositions.filter((p) => p.action === 'deplacer'),
    conserver: propositions.filter((p) => p.action !== 'deplacer'),
  };

  return (
    <div className="space-y-3">
      {/* LE BILAN — ce que l'analyse a trouvé, et ce qu'elle dénoue. */}
      <div className="rounded-xl border border-gr-gold/30 bg-gr-gold/8 p-3 space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-gr-gold">
          Optimisation automatique
        </p>
        {rapport.perimetre && (
          <p className="text-[11px] text-white/80">
            Zone : <b className="text-gr-gold">{rapport.perimetre.zoneLibelle}</b>
            {' · '}Faction : <b className="text-gr-gold">{rapport.perimetre.factionId}</b>
          </p>
        )}

        {/* SITUATION ACTUELLE — ce que le terrain montre avant toute proposition. */}
        <div className="rounded-lg border border-[#E11D2E]/35 bg-[#E11D2E]/8 px-2.5 py-2">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-red-300">Situation actuelle</p>
          <div className="mt-1 flex justify-between text-[11px] text-white/80">
            <span>Barrages : <b>{rapport.perimetre?.barragesAnalyses ?? barragesAnalyses}</b></span>
            <span>Conflits de distance (&lt; {seuil} km) : <b className="text-red-300">{conflitsZoneAvant}</b></span>
          </div>
          {conflitsEntreIntouchables > 0 && (
            <p className="mt-1 text-[9.5px] leading-snug text-white/45">
              + {conflitsEntreIntouchables} conflit(s) entre Intouchables voisins, permanents et hors
              optimisation — non comptés ici.
            </p>
          )}
        </div>

        <p className="text-[10.5px] leading-snug text-white/70">
          <b className="text-white/85">Objectif :</b> réduire les barrages trop rapprochés (moins de{' '}
          {seuil} km par la route) et supprimer les doublons ou chevauchements, lorsqu’une position
          valide existe. Les Intouchables ne bougent jamais ; un conflit sans solution reste signalé.
        </p>

        <p className="text-[9.5px] font-bold uppercase tracking-wider text-gr-green/90 pt-1">Résultat simulé</p>

        {/**
          * LES QUATRE CHIFFRES DU BILAN.
          *
          * Conflits détectés, déplacements proposés, conflits non résolus,
          * barrages inchangés. Ce sont les seuls que le commandement lit avant
          * de décider ; le reste — conflits restants, répartition — suit en
          * dessous, pour qui veut aller plus loin.
          */}
        {/* LES 4 CHIFFRES CLÉS DU BILAN */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Chiffre libelle="Barrages déplacés" valeur={deplacements} ton="or" />
          <Chiffre libelle="Conflits détectés" valeur={conflitsZoneAvant} ton="alerte" />
          <Chiffre libelle="Conflits résolus" valeur={conflitsResolus} ton="vert" />
          <Chiffre libelle="Conflits restants" valeur={conflitsZoneApres} ton="alerte" />
        </div>
        {/* AUCUN DÉPLACEMENT POSSIBLE : dit en toutes lettres. Mesurer des
            distances n'est pas optimiser — le panneau ne le laisse pas croire. */}
        {deplacements === 0 && conflitsZoneAvant > 0 && (
          <p className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-2.5 py-2 text-[11px] font-bold leading-snug text-amber-300">
            Aucune solution automatique valide trouvée.
            <span className="block pt-0.5 text-[10px] font-normal text-white/65">
              Chaque position routière de la zone a été éprouvée : aucune ne tient à {seuil} km de tous
              les autres postes.
            </span>
          </p>
        )}

        {/* LE DÉROULÉ DE LA SIMULATION — chaque pas part de l'état simulé laissé
            par le précédent, et le compte de conflits est remesuré à chaque fois. */}
        {journal.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-white/60">
              Déroulé de la simulation
            </p>
            <ol className="mt-1 space-y-1 text-[10.5px] leading-snug text-white/75">
              {journal.map((p) => (
                <li key={p.pas} className="flex gap-1.5">
                  <span className="font-mono text-gr-gold">{p.pas}.</span>
                  <span>
                    <b className="text-white/90">{p.nom}</b> déplacé : {Number(p.conflitAvec.km).toFixed(2)} km de{' '}
                    {p.conflitAvec.nom} ❌ → {p.distanceApresKm != null ? Number(p.distanceApresKm).toFixed(2) : '—'} km ✓
                    <span className="block text-white/50">
                      conflits de l’état simulé : {p.conflitsAvant} → {p.conflitsApres}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {mesures && (
          <p className="text-[9.5px] leading-snug text-white/40">
            {mesures.iterations} itération(s) · {mesures.passes} passe(s) · {mesures.candidats} positions
            candidates · {mesures.calculsRoute} distances routières · {(mesures.dureeMs / 1000).toFixed(1)} s
          </p>
        )}

        {conflitsZoneApres > 0 && (
          <p className="rounded-lg border border-[#E11D2E]/30 bg-[#E11D2E]/8 px-2.5 py-1.5 text-[10.5px] leading-snug text-red-300">
            {conflitsZoneApres} conflit(s) sans position valide dans la zone : il y a plus de barrages
            que la règle des {seuil} km par la route ne peut en espacer ici. Ils restent tracés en rouge sur
            la carte et relèvent d’une décision du commandement.
          </p>
        )}
        <p className="text-[9.5px] leading-snug text-white/40">
          L’analyse reste une simulation non persistante. Les positions seront revalidées avant
          toute écriture.
        </p>

        {Object.keys(repartitionFactionApres).length > 0 && (
          <div className="pt-2 border-t border-white/10 text-[11px] space-y-0.5">
            <p className="font-semibold text-white/80">Répartition après optimisation :</p>
            {Object.entries(repartitionFactionApres).map(([id, n]) => (
              <div key={id} className="flex items-center justify-between text-white/65">
                <span>{FACTION_LIBELLE[id] ?? id} :</span>
                <span className="font-mono font-bold text-white/90">{n}</span>
              </div>
            ))}
          </div>
        )}

        {/**
          * L'ANALYSE S'EST-ELLE ARRÊTÉE AVANT LA FIN ?
          *
          * Sur un périmètre national, la résolution complète demande plusieurs
          * minutes : l'analyse s'interrompt au bout de vingt secondes. Un
          * résultat partiel qui se présenterait comme complet serait pire
          * qu'une attente — on appliquerait des changements en croyant avoir
          * traité tout le dispositif.
          */}
        {interrompue && (
          <div className="rounded-lg border border-orange-400/35 bg-orange-400/10 px-2.5 py-2 text-[10.5px] leading-snug text-orange-200">
            <b>Analyse interrompue</b> après {Math.round((dureeMs ?? 0) / 1000)} s.{' '}
            {conflitsNonExamines} conflit(s) n’ont pas été examinés. Le résultat ci-dessous est
            donc <b>partiel</b>.
            <br />
            Relancez l’analyse pour recalculer le dispositif autorisé.
          </div>
        )}
        {propositionsOmises > 0 && (
          <p className="text-[9.5px] leading-snug text-white/45">
            {propositions.length} proposition(s) affichée(s) sur {propositionsTotal} — les conflits
            les plus serrés d’abord.
          </p>
        )}
        {tracesOmises > 0 && (
          <p className="text-[9.5px] leading-snug text-white/45">
            {tracesOmises} conflit(s) sans tracé routier sur la carte : seules les{' '}
            {resume.tracesRendues} routes les plus serrées sont dessinées.
          </p>
        )}

        {sansReseau > 0 && (
          <p className="text-[9.5px] leading-snug text-orange-300/80">
            {sansReseau} poste(s) hors du réseau routier connu : aucune distance routière n’a pu être
            mesuré pour eux.
          </p>
        )}
      </div>

      {/* L'APERÇU — activé automatiquement, basculable */}
      {applicables.length > 0 && (
        <button
          type="button"
          onClick={onBasculerApercu}
          className={`w-full flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-[11.5px] font-bold transition-all ${
            apercu
              ? 'border-gr-gold bg-gr-gold/20 text-gr-gold'
              : 'border-white/15 bg-white/8 text-white/80 hover:bg-white/14'
          }`}
        >
          <IconCible size={14} />
          <span>
            {apercu
              ? 'Masquer la version optimisée sur la carte'
              : 'Voir la version optimisée sur la carte'}
          </span>
        </button>
      )}
      {apercu && (
        <Note>
          La carte affiche en direct les repères <b className="text-red-400">AVANT</b>, les repères <b className="text-emerald-400">APRÈS</b>, les tracés routiers réels et les lignes de mouvement <b className="text-white/85">OLD → NEW</b>.{' '}
          <b className="text-white/85">Rien n’est enregistré</b> dans la base tant que vous ne cliquez pas sur « Activer les modifications ».
        </Note>
      )}

      {/* ACTIVER OU ANNULER — la simulation affichée, et elle seule. */}
      <ActivationOptimisation
        rapport={rapport}
        retenus={retenus}
        applicationEnCours={applicationEnCours}
        calculEnCours={calculEnCours}
        onActiver={onAppliquer}
        onAnnuler={onAnnuler}
      />

      {/* DÉTAIL DES PROPOSITIONS (REPLIABLE POUR GARDER UN PANNEAU COMPACT) */}
      {propositions.length > 0 ? (
        <Depliable key={`auto-propositions-${detailsCle}`} cle="auto-propositions" data-gr-details-optimisation="1" className="rounded-xl border border-white/15 bg-white/5 p-2.5 space-y-2">
          <summary className="cursor-pointer text-[11.5px] font-bold text-white/90 select-none hover:text-white">
            Détail des propositions ({retenus}/{applicables.length} retenue(s))
          </summary>
          <div className="pt-2 space-y-2">
            {applicables.length > 0 && (
              <div className="flex justify-end gap-1.5 pb-1">
                <button
                  type="button"
                  onClick={onToutAccepter}
                  className="rounded-lg border border-gr-gold/30 bg-gr-gold/10 px-2 py-1 text-[9.5px] font-semibold text-gr-gold hover:bg-gr-gold/20 transition-colors"
                >
                  Tout accepter
                </button>
                <button
                  type="button"
                  onClick={onToutRefuser}
                  className="rounded-lg border border-white/12 bg-white/6 px-2 py-1 text-[9.5px] font-semibold text-white/70 hover:bg-white/14 transition-colors"
                >
                  Tout refuser
                </button>
              </div>
            )}

            {parAction.deplacer.length > 0 && (
              <div className="rounded-lg border border-sky-400/20 bg-sky-400/5 p-2">
                <p className="text-[10.5px] font-semibold text-sky-200 mb-1">
                  Déplacements ({parAction.deplacer.length})
                </p>
                <ul className="space-y-1">
                  {parAction.deplacer.map((p) => (
                    <li key={p.id} className="text-[10px] leading-snug">
                      <button
                        type="button"
                        onClick={() => onCadrer?.(p, cadrageProposition(p))}
                        className="text-left font-semibold text-white/90 underline-offset-2 hover:text-sky-300 hover:underline"
                      >
                        {p.nom}
                      </button>
                      <span className="text-white/55">
                        {' '}— {Number(p.avant?.lat).toFixed(4)}, {Number(p.avant?.lng).toFixed(4)}{' '}
                        <span className="text-sky-300">→</span>{' '}
                        <b className="text-white/85">{Number(p.apres?.lat).toFixed(4)}, {Number(p.apres?.lng).toFixed(4)}</b>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rapport.conflitsSansSolution?.length > 0 && (
              <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 p-2">
                <p className="text-[10.5px] font-semibold text-orange-300 mb-1">
                  Sans solution automatique ({rapport.conflitsSansSolution.length})
                </p>
                <ul className="space-y-1">
                  {rapport.conflitsSansSolution.map((c, i) => (
                    <li key={`${c.a}|${c.b}|${i}`} className="text-[10px] leading-snug text-white/70">
                      {c.a} ↔ {c.b} — {Number(c.km).toFixed(1)} km · {c.raison}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="space-y-2">
              {propositions.map((p) => (
                <LigneProposition
                  key={p.id}
                  p={p}
                  seuilKm={rapport.seuilKm}
                  choisi={selection.has(p.id)}
                  onBasculer={onBasculerSelection}
                  onCadrer={onCadrer}
                  gesteEnCours={gesteEnCours}
                />
              ))}
            </ul>
          </div>
        </Depliable>
      ) : (
        <p className="rounded-lg border border-gr-green/25 bg-gr-green/10 px-3 py-2.5 text-[11.5px] leading-snug text-gr-green">
          Aucun conflit : tous les barrages fixes sont à au moins {seuil} km de route les uns des autres.
        </p>
      )}

      {/* CE QUI RESTE EN CONFLIT — dit, jamais masqué. */}
      {conflitsRestants.length > 0 && (
        <Depliable cle="auto-restants" className="rounded-xl border border-orange-400/25 bg-orange-400/5 p-2.5">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-orange-200">
            Conflits non dénoués ({conflitsRestants.length})
          </summary>
          <p className="mt-1 text-[9.5px] leading-snug text-white/50">
            Ces conflits restent présents dans l’état simulé et nécessitent une décision manuelle.
          </p>
          <ul className="mt-2 space-y-1">
            {conflitsRestants.slice(0, 40).map((c, i) => (
              <li key={i} className="text-[10px] text-white/60 leading-snug">
                <span className="text-white/85">{c.a.nom}</span> ↔{' '}
                <span className="text-white/85">{c.b.nom}</span>
                <span className="text-white/40"> — {Number(c.km).toFixed(1)} km par la route</span>
              </li>
            ))}
            {conflitsRestants.length > 40 && (
              <li className="text-[10px] italic text-white/35">
                … et {conflitsRestants.length - 40} autre(s)
              </li>
            )}
          </ul>
        </Depliable>
      )}
    </div>
  );
}

/**
 * CONTRÔLES DIRECTS DE DISTANCE ET DE FACTION
 *
 * Permet de régler directement la distance minimale (20 km par défaut, 30 km, 40 km,
 * ou valeur personnalisée) et la faction (toutes les factions ou une faction précise)
 * avec recalcul immédiat en un clic, tout en restant toujours visible dans l'interface.
 */
function ControlesDistanceEtFaction({
  distance,
  onDistanceChange,
  factionChoisie,
  onFactionChange,
  factions,
  items,
  rapport,
  rapportAuto,
  modeOptimisation,
  onRecalculer,
  chargement = false,
}) {
  const totalBarrages = factions?.total ?? (items?.length || 0);
  const estToutes = !factionChoisie || factionChoisie === 'toutes';
  const listeFactions = factions?.factions ?? [];
  const factionObj = listeFactions.find((f) => f.id === factionChoisie);
  const nomFactionAffichee = estToutes
    ? 'Toutes les factions'
    : (factionObj?.nom ? `${factionObj.nom} (${factionObj.libelle || ''})` : factionChoisie);
  const compteFactionAffichee = estToutes
    ? totalBarrages
    : (factions?.compteurs?.[factionChoisie] ?? (items?.filter((m) => m.factionId === factionChoisie)?.length || 0));

  const nbSousSeuil = modeOptimisation === 'auto'
    ? rapportAuto?.propositions?.length
    : (rapport?.barrages?.filter((b) => b.sousLeSeuil)?.length);

  const aRapport = modeOptimisation === 'auto' ? Boolean(rapportAuto) : Boolean(rapport);

  return (
    <div className="rounded-xl border border-gr-gold/30 bg-gr-navy/90 p-3 space-y-3 shadow-md backdrop-blur-sm">
      {/* En-tête avec critères courants */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2">
        <div className="flex items-center gap-1.5">
          <span className="flex h-2 w-2 rounded-full bg-gr-gold animate-pulse" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-gr-gold">
            Critères d’optimisation
          </span>
        </div>
        <span className="text-[10.5px] font-mono text-white/60">
          {distance} km · {estToutes ? 'Toutes factions' : (factionObj?.id || factionChoisie)}
        </span>
      </div>

      {/* 1. Distance minimale réglable */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-white/85">Distance minimale</span>
          <span className="text-[10px] text-white/45">Par le réseau routier</span>
        </div>
        <div className="flex items-center gap-1.5">
          {[20, 30, 40].map((val) => {
            const actif = String(distance) === String(val);
            return (
              <button
                key={val}
                type="button"
                onClick={() => {
                  onDistanceChange(String(val));
                  onRecalculer(String(val), factionChoisie);
                }}
                disabled={chargement}
                className={`flex-1 py-1.5 px-2 rounded-lg text-[12px] font-bold transition-all border ${
                  actif
                    ? 'bg-gr-gold text-[#0B192C] border-gr-gold shadow-[0_0_10px_rgba(245,158,11,0.3)] scale-[1.02]'
                    : 'bg-white/6 hover:bg-white/12 text-white/80 border-white/12 hover:border-white/25'
                }`}
                title={`Régler à ${val} km et recalculer`}
              >
                {val} km
              </button>
            );
          })}
          {/* Saisie personnalisée */}
          <div className="relative flex items-center w-24">
            <input
              type="number"
              min="0.5"
              max="200"
              step="0.5"
              value={distance}
              onChange={(e) => onDistanceChange(e.target.value)}
              placeholder="Autre"
              disabled={chargement}
              className="w-full rounded-lg border border-white/15 bg-black/40 py-1.5 pl-2 pr-7 text-[12px] font-mono font-bold text-white placeholder-white/30 focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold"
              title="Distance minimale personnalisée en km"
            />
            <span className="pointer-events-none absolute right-2 text-[10px] font-bold text-white/45">
              km
            </span>
          </div>
        </div>
      </div>

      {/* 2. Optimisation par faction */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-white/85">Faction (Compagnie)</span>
          <span className="text-[10px] text-white/45">Tour de service</span>
        </div>
        <select
          value={factionChoisie || 'toutes'}
          onChange={(e) => {
            const f = e.target.value;
            onFactionChange?.(f);
          }}
          disabled={chargement}
          className="w-full rounded-lg border border-white/15 bg-gr-card px-2.5 py-1.5 text-[12px] font-medium text-white shadow-inner focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold cursor-pointer"
        >
          <option value="toutes">
            🌐 Toutes les factions ({totalBarrages} barrages)
          </option>
          {listeFactions.map((f) => {
            const cnt = factions?.compteurs?.[f.id] ?? 0;
            return (
              <option key={f.id} value={f.id}>
                {f.nom} — {cnt} barrage{cnt > 1 ? 's' : ''}
              </option>
            );
          })}
          {(factions?.sansFaction ?? 0) > 0 && (
            <option value="sans_faction">
              Sans faction ({factions?.sansFaction} barrages)
            </option>
          )}
        </select>
      </div>

      {/* Affichage clair de la faction sélectionnée et des barrages concernés */}
      <div className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-white/60">Faction sélectionnée :</span>
          <span className="font-bold text-gr-gold truncate max-w-[200px]" title={nomFactionAffichee}>
            {nomFactionAffichee}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/5">
          <span className="text-white/60">Barrages du périmètre :</span>
          <span className="font-mono font-bold text-white/90">
            {compteFactionAffichee} barrage{compteFactionAffichee > 1 ? 's' : ''}
          </span>
        </div>
        {nbSousSeuil != null && (
          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-white/5">
            <span className="text-red-300/80">Sous le seuil ({distance} km) :</span>
            <span className="font-mono font-bold text-red-400">
              {nbSousSeuil} barrage{nbSousSeuil > 1 ? 's' : ''} trop proche{nbSousSeuil > 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* 3. Bouton direct de calcul / recalcul en un clic */}
      <button
        type="button"
        disabled={chargement}
        onClick={() => onRecalculer(distance, factionChoisie)}
        className="w-full rounded-lg bg-gr-gold py-2.5 px-3 text-[12px] font-bold uppercase tracking-wider text-[#0B192C] shadow-md transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {chargement ? (
          <>
            <IconSpinner size={14} />
            <span>Calcul en cours…</span>
          </>
        ) : (
          <>
            <IconTarget size={14} />
            <span>
              {aRapport ? 'Recalculer' : 'Calculer'} ({distance} km · {estToutes ? 'Toutes factions' : (factionObj?.id || factionChoisie)})
            </span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * CE QUE FAIT CHAQUE ONGLET — repris des aides de l'étape « Distance et
 * réglages », jamais une promesse nouvelle.
 */
const AIDE_ONGLET = {
  distance:
    'Deux postes fixes plus proches que cette distance sont signalés comme redondants. La distance est mesurée par la route, jamais à vol d’oiseau.',
  accidents:
    'Joint le nombre d’accidents relevés à chaque poste, et met hors de la décision ceux qui atteignent le seuil ci-dessous.',
  vip: 'Un poste sur un itinéraire officiel reste sous le seuil, mais ne sera jamais proposé au retrait.',
  eclairage: 'Retirer un poste sans éclairage laisse un tronçon aveugle la nuit : les postes non éclairés sont protégés.',
};

/**
 * LA BOÎTE DE CONFIGURATION D'UN ONGLET — rien ne part avant « Lancer ».
 *
 * Elle ne montre que les réglages que la route `consolidation` accepte
 * réellement : le périmètre (dans les limites du rang), la distance, la faction,
 * et pour « Les accidents » son seuil. VIP et éclairage n'ont pas de réglage
 * propre — l'interrupteur EST le réglage ; la boîte le dit plutôt que d'en
 * inventer un.
 *
 * Le périmètre, la distance et la faction sont ceux de la MESURE, qui est une :
 * les changer ici recalcule aussi les critères déjà actifs. La note le dit dès
 * que les valeurs diffèrent de celles appliquées.
 */
function DialogueOnglet({
  onglet,
  config,
  onConfig,
  applique,
  impose,
  unites,
  factions,
  items,
  statut,
  erreur,
  validation,
  calculAilleurs,
  onAnnuler,
  onLancer,
  onDesactiver,
}) {
  const boite = useRef(null);
  const enCours = statut === 'optimizing';
  const actif = statut === 'active';

  /* Le focus entre dans la boîte, et revient à l'onglet à la fermeture. */
  useEffect(() => {
    const precedent = document.activeElement;
    boite.current?.querySelector('input,select,button:not([data-fermer])')?.focus();
    return () => precedent?.focus?.();
  }, []);

  useEffect(() => {
    const touche = (e) => {
      if (e.key !== 'Escape' || enCours) return;
      /* Échap referme d'abord la liste d'unités ouverte, pas la boîte. */
      if (boite.current?.querySelector('[aria-haspopup=listbox][aria-expanded=true]')) return;
      onAnnuler();
    };
    /* En capture : on lit l'état de la liste AVANT que React ne la referme. */
    document.addEventListener('keydown', touche, true);
    return () => document.removeEventListener('keydown', touche, true);
  }, [enCours, onAnnuler]);

  const listeFactions = factions?.factions ?? [];
  const totalBarrages = factions?.total ?? (items?.length || 0);
  const libelleZone = (niveau, unite) =>
    niveau === 'national' ? 'Tout le pays' : `${LIBELLE_NIVEAU_IMPOSE[niveau] ?? 'Territoire'} ${unite || '—'}`;
  const libelleFaction = (id) =>
    !id || id === 'toutes' ? 'Toutes les factions' : (listeFactions.find((f) => f.id === id)?.nom ?? id);

  /* La mesure appliquée diffère-t-elle de celle qu'on s'apprête à lancer ? */
  const mesureChangee =
    applique &&
    (Number(applique.distanceMinKm) !== Number(String(config.distance).replace(',', '.')) ||
      (applique.niveau ?? 'national') !== config.niveau ||
      (config.niveau !== 'national' && (applique.unite ?? '') !== config.unite) ||
      (applique.factionId ?? 'toutes') !== (config.factionId ?? 'toutes'));
  const autresActifs = applique
    ? ONGLETS_OPTIMISATION.filter((o) => o.cle !== onglet.cle && (!o.critere || applique[o.critere] === true))
    : [];

  const champ =
    'w-full rounded-lg border border-white/15 bg-gr-card px-2.5 py-1.5 text-[12px] font-medium text-white ' +
    'focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold disabled:opacity-50';
  const titreSection = 'text-[11px] font-bold uppercase tracking-wider text-white/70';

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[2000] flex items-end justify-center bg-black/30 md:items-start md:pt-[calc(7.5rem+var(--gr-bandeau,0px))]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !enCours) onAnnuler();
      }}
    >
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titre-onglet-optimisation"
        data-testid="dialogue-onglet"
        className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-border-default bg-gr-navy shadow-[0_12px_40px_rgba(0,0,0,0.75)] md:max-h-[calc(100dvh-9rem)] md:w-[400px] md:rounded-2xl"
      >
        <div className="flex items-start gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-gr-gold">Optimisation</p>
            <h2 id="titre-onglet-optimisation" className="text-[15px] font-bold text-text-primary">
              {onglet.libelle}
            </h2>
          </div>
          <span
            className={`mt-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              actif
                ? 'border-green-400/40 text-green-400'
                : enCours
                  ? 'border-gr-gold/45 text-gr-gold'
                  : statut === 'error'
                    ? 'border-gr-red/45 text-gr-red'
                    : 'border-white/15 text-white/50'
            }`}
          >
            {actif ? 'Actif' : enCours ? 'En cours' : statut === 'error' ? 'Erreur' : 'Non optimisé'}
          </span>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-3">
          <p className="text-[12px] leading-snug text-white/70">{AIDE_ONGLET[onglet.cle]}</p>

          {actif && applique && (
            <Recap
              titre="Appliqué actuellement"
              lignes={[
                { libelle: 'Territoire', valeur: libelleZone(applique.niveau ?? 'national', applique.unite), accent: true },
                { libelle: 'Distance', valeur: `${applique.distanceMinKm} km` },
                { libelle: 'Faction', valeur: libelleFaction(applique.factionId) },
                ...(onglet.cle === 'accidents' ? [{ libelle: 'Seuil', valeur: `${applique.seuilAccidents} accident(s)` }] : []),
              ]}
            />
          )}

          {/* ---- Territoire ---- */}
          <div className="space-y-2">
            <p className={titreSection}>Territoire</p>
            {impose?.niveau === 'brigade' ? (
              /* Un chef de brigade n'a rien de plus fin à désigner. */
              <Recap lignes={[{ libelle: 'Brigade territoriale', valeur: impose.unite, accent: true }]} />
            ) : (
              <>
                <Choix
                  nom="Territoire à étudier"
                  colonnes={2}
                  valeur={config.niveau}
                  onChange={(cle) => onConfig({ niveau: cle, unite: '' })}
                  options={niveauxAutorises(impose)}
                />
                {config.niveau !== 'national' && (
                  <UniteSelect
                    options={unitesAutorisees(unites, config.niveau, impose)}
                    value={config.unite}
                    onChange={(v) => onConfig({ unite: v })}
                    grouperPar={config.niveau === 'compagnie' ? 'reg' : config.niveau === 'brigade' ? 'cie' : null}
                    placeholderRecherche={RECHERCHE_UNITE[config.niveau]}
                  />
                )}
              </>
            )}
          </div>

          {/* ---- Distance : les mêmes repères que l'étape « Distance et réglages » ---- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="onglet-distance" className={titreSection}>
                Distance minimale
              </label>
              <span className="text-[10px] text-white/45">Par le réseau routier</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[20, 30, 40].map((val) => (
                <button
                  key={val}
                  type="button"
                  disabled={enCours}
                  aria-pressed={String(config.distance) === String(val)}
                  onClick={() => onConfig({ distance: String(val) })}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-bold transition-colors ${
                    String(config.distance) === String(val)
                      ? 'border-gr-gold bg-gr-gold text-[#0B192C]'
                      : 'border-white/12 bg-white/6 text-white/80 hover:bg-white/12'
                  }`}
                >
                  {val} km
                </button>
              ))}
              <div className="relative flex w-24 items-center">
                <input
                  id="onglet-distance"
                  type="number"
                  min="0.5"
                  max="200"
                  step="0.5"
                  inputMode="decimal"
                  value={config.distance}
                  disabled={enCours}
                  onChange={(e) => onConfig({ distance: e.target.value })}
                  aria-label="Distance minimale en kilomètres"
                  className={`${champ} pr-7 font-mono font-bold`}
                />
                <span className="pointer-events-none absolute right-2 text-[10px] font-bold text-white/45">km</span>
              </div>
            </div>
          </div>

          {/* ---- Faction : la même liste que le panneau ---- */}
          <div className="space-y-2">
            <label htmlFor="onglet-faction" className={titreSection}>
              Faction
            </label>
            <select
              id="onglet-faction"
              value={config.factionId || 'toutes'}
              disabled={enCours}
              onChange={(e) => onConfig({ factionId: e.target.value })}
              className={`${champ} cursor-pointer`}
            >
              <option value="toutes">Toutes les factions ({totalBarrages} barrages)</option>
              {listeFactions.map((f) => {
                const n = factions?.compteurs?.[f.id] ?? 0;
                return (
                  <option key={f.id} value={f.id}>
                    {f.nom} — {n} barrage{n > 1 ? 's' : ''}
                  </option>
                );
              })}
              {(factions?.sansFaction ?? 0) > 0 && (
                <option value="sans_faction">Sans faction ({factions.sansFaction} barrages)</option>
              )}
            </select>
          </div>

          {onglet.cle === 'accidents' && (
            <SeuilAccidents valeur={config.seuilAccidents} onChange={(n) => onConfig({ seuilAccidents: n })} />
          )}
          {(onglet.cle === 'vip' || onglet.cle === 'eclairage') && (
            <Note>Ce critère n’a pas de réglage propre : il protège les postes concernés dans la mesure ci-dessus.</Note>
          )}

          {mesureChangee && autresActifs.length > 0 && (
            <Note ton="alerte">
              Territoire, distance et faction sont communs aux quatre onglets : lancer avec ces valeurs recalcule aussi{' '}
              {autresActifs.map((o) => o.libelle).join(', ')}.
            </Note>
          )}

          {(validation || erreur) && (
            <p role="alert" className="rounded-lg border border-gr-red/40 bg-gr-red/10 px-2.5 py-1.5 text-[11.5px] text-text-primary">
              {validation ?? `Échec : ${erreur} — vos réglages sont conservés, vous pouvez relancer.`}
            </p>
          )}
          {calculAilleurs && !enCours && (
            <p className="text-[11px] text-gr-gold">Un autre calcul est en cours : attendez qu’il se termine pour lancer.</p>
          )}
          {actif && !onglet.critere && autresActifs.length > 0 && (
            <Note>
              Désactiver Distance efface le résultat : {autresActifs.map((o) => o.libelle).join(', ')}, qui
              en dépend{autresActifs.length > 1 ? 'ent' : ''}, sera{autresActifs.length > 1 ? 'ont' : ''} aussi désactivé
              {autresActifs.length > 1 ? 's' : ''}.
            </Note>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          {actif && (
            <button
              type="button"
              disabled={enCours || calculAilleurs}
              onClick={onDesactiver}
              className={`${bouton} mr-auto border border-gr-red/45 bg-gr-red/10 px-3.5 text-red-300 hover:bg-gr-red/20`}
            >
              Désactiver
            </button>
          )}
          <button
            type="button"
            data-fermer
            disabled={enCours}
            onClick={onAnnuler}
            className={`${bouton} bg-white/8 px-3.5 text-white/80 hover:bg-white/14`}
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={enCours || calculAilleurs}
            onClick={onLancer}
            className={`${bouton} bg-gr-gold px-3.5 text-[#0B192C] hover:brightness-110`}
          >
            {enCours && <IconSpinner size={13} />}
            {enCours ? 'Optimisation…' : 'Lancer l’optimisation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OptimisationPanel({
  open,
  onClose,
  unites,
  /**
   * État du service (voir /api/etat) — sert uniquement à savoir si un assistant
   * d'analyse est configuré. Absent, le bouton ne s'affiche pas.
   */
  service,
  /**
   * Sert au seul message d'aide sur l'assistant : la marche à suivre pour
   * l'activer ne s'adresse qu'à l'administrateur, c'est lui qui démarre le
   * service. Elle était passée par la carte sans être déclarée ici — donc
   * ignorée.
   */
  session,
  onAssigner = null,
  /** « CMD Région X » si le barrage (ou sa paire en conflit) est déjà assigné et pas encore traité. */
  assignationDe = null,
  /** Le dépôt vivant — porte les décisions rendues et les postes encore là. */
  items,
  /** Callback pour mettre à jour la liste des items en direct après retrait/restauration. */
  onItemsChange,
  /** Incrémenté à chaque retrait réel : le calcul doit alors être refait. */
  dispositifVersion,
  positionChangee = null,
  /** Avance quand la référence de présentation est restaurée : remise à zéro, configuration conservée. */
  presentationVersion = 0,
  /** Après « ↶ Restaurer avant simulation » : la carte relit l'état officiel (même chemin qu'une restauration de présentation). */
  onEtatOfficielRestaure,
  /** DÉPLACER (manuel) : la carte passe en mode placement — voir `deciderSimulation`. */
  onDemanderPlacement,
  onCadrerCirconscription,
  onCadrer,
  /** Cadre en une fois tous les postes sous le seuil produits par le calcul. */
  onCadrerResultats,
  /**
   * LA PORTÉE COURANTE — ce que l'utilisateur regarde au moment d'ouvrir.
   *
   * `{niveau, unite}` ou `null` (vue nationale d'un administrateur). Elle
   * devient le périmètre PROPOSÉ par défaut : on optimise ce qu'on a sous les
   * yeux, et non le pays entier parce que c'était la première case de la
   * liste. Voir `porteeCourante` dans src/marquages.js.
   */
  porteeCourante = null,
  /** Faction en cours selon l'horloge serveur, pour l'inventaire des BFI. */
  factionActuelle = null,
  /** Faction dont l'optimisation automatique analyse les barrages (filtre de la carte). */
  factionAnalysee = null,
  factions = null,
  onFactionChange = null,
  /** Réinitialisation de l'optimisation : la carte oublie sa sélection. */
  onReinitialiser,
  /** Revient sur un « Conservé » : le poste redevient à trancher. */
  onDecider,
  /**
   * LE DOSSIER OUVERT — les mêmes pièces que la cloche des notifications.
   *
   * Sert à une seule chose ici : savoir si le retrait proposé sur une ligne
   * attend une réponse de CE compte, et proposer alors de trancher sans
   * quitter la liste.
   */
  notifications,
  /** Accepte ou refuse une demande de retrait : (instruction, 'accepter'|'refuser'). */
  onDeciderDemande,
  /** Remonte le résultat pour que la CARTE pose les repères « ? ». */
  onResultatsChange,
  /** Les paires numérotées telles que la carte les a reçues (C-01…). */
  conflitsIdentifies = null,
  /** L'identifiant du conflit désigné (« C-01 »), ou `null`. */
  conflitVise = null,
  /** Désigne un conflit : (id | null, { cadrer }). */
  onViserConflit,
  distance: distanceProp = '20',
  onDistanceChange: onDistanceChangeProp = null,
  onEnregistrerRecalcul = null,
  onDistanceBaseChange = null,
  /** Onglets de la carte : reçoit l'état des quatre onglets à chaque changement. */
  onOngletsChange = null,
  /** Onglets de la carte : reçoit la fonction `(cle) => …` qui active un onglet. */
  onEnregistrerOnglets = null,
}) {
  /* Un numéro par rapport calculé : la carte reconnaît un NOUVEAU calcul. */
  const calculsVus = useRef({ rapport: null, n: 0 });
  const idCalcul = (r) => {
    if (r && calculsVus.current.rapport !== r) calculsVus.current = { rapport: r, n: calculsVus.current.n + 1 };
    return calculsVus.current.n;
  };
  /**
   * LE PÉRIMÈTRE N'EST PLUS UN CHOIX POUR UN PROFIL HIÉRARCHIQUE.
   *
   * `perimetreImpose` renvoie le périmètre que le rang détermine — région,
   * compagnie ou brigade du compte connecté — et `null` pour l'administrateur,
   * seul profil sans circonscription propre.
   *
   * Les deux états ci-dessous ne servent PLUS QU'À L'ADMINISTRATEUR. Pour tous
   * les autres, `niveau` et `unite` sont des valeurs DÉDUITES : l'étape 1 ne
   * s'affiche pas, et surtout aucun code en aval ne lit l'état choisi. Ce n'est
   * pas le champ qui est caché, c'est la dépendance qui est supprimée — le
   * serveur applique d'ailleurs la même déduction et ignore ce que la requête
   * prétend (voir `perimetreDuRang` dans serveur/comptes.mjs).
   */
  const impose = useMemo(() => perimetreImpose(session), [session]);

  /**
   * L'ÉTAPE COURANTE DU PARCOURS — elle vit dans la section et non dans
   * `Parcours` : c'est elle qui sait quand avancer d'elle-même, après un calcul
   * abouti par exemple.
   *
   * FERMER N'EST PAS ANNULER — l'étape survit au repli du panneau.
   *
   * `useParcours(open)` remet l'étape à zéro à chaque ouverture et à chaque
   * fermeture : juste pour les parcours de saisie, faux ici. L'optimisation
   * porte un calcul, un aperçu et une sélection que l'on quitte le temps de
   * regarder la carte ; la rouvrir doit ramener exactement au même endroit.
   * Le panneau reste MONTÉ quand il est replié (voir plus bas), donc cet état
   * vit tant que la carte est ouverte. Seul ANNULER remet à zéro.
   */
  const [etape, setEtape] = useState(0);
  const etapesRef = useRef(null);

  /**
   * LES DEUX MODES D'OPTIMISATION : MANUEL OU AUTOMATIQUE
   */
  const [modeOptimisation, setModeOptimisation] = useState('manuel'); // 'manuel' | 'auto'

  const [niveauChoisi, setNiveauChoisi] = useState('national');
  const [uniteChoisie, setUniteChoisie] = useState('');

  /**
   * A-T-ON DEMANDÉ À CHOISIR UN AUTRE PÉRIMÈTRE ?
   *
   * Tant que non, le calcul portera sur la portée courante — celle de l'écran.
   * Le geste reste EXPLICITE dans les deux cas : « Continuer » confirme la
   * portée affichée, « Choisir un autre périmètre » ouvre la liste. Aucun
   * calcul national ne part sans avoir été demandé.
   */
  const [autrePerimetre, setAutrePerimetre] = useState(false);

  /**
   * Le périmètre effectivement envoyé.
   *
   *   choix explicite  ....... ce que l'utilisateur vient de désigner ;
   *   sinon portée courante .. ce qu'il regarde ;
   *   sinon périmètre du rang  pour un compte hiérarchique sans navigation ;
   *   sinon national ......... l'administrateur qui n'est descendu nulle part.
   *
   * Le serveur revérifie tout : il accepte un périmètre plus étroit que le
   * rang, jamais plus large (voir la route `consolidation`). Ce qui est décidé
   * ici est une PROPOSITION, pas une autorisation.
   */
  /* Les deux résultats — déclarés ici parce que la portée en dépend. */
  const [rapport, setRapport] = useState(null);
  const [rapportAuto, setRapportAuto] = useState(null);

  /**
   * LES DÉCISIONS SIMULÉES DE L'OPTIMISATION MANUELLE — rattachées au résultat
   * manuel (`rapport`), comme la sélection l'est au résultat automatique.
   * `decisionsManuelles` est ce que l'utilisateur a choisi ({ barrageId, type }) ;
   * `rapportSimule` est ce que le SERVEUR en a fait : l'état mesuré après
   * application des décisions à une copie, et le verdict de chacune.
   * Rien n'est écrit tant que « Activer les modifications » n'a pas abouti.
   */
  const [decisionsManuelles, setDecisionsManuelles] = useState([]);
  const [rapportSimule, setRapportSimule] = useState(null);
  const [decisionEnCours, setDecisionEnCours] = useState(null);
  const [activationManuelleEnCours, setActivationManuelleEnCours] = useState(false);
  const [messageManuel, setMessageManuel] = useState(null);
  const [confirmerReinit, setConfirmerReinit] = useState(false);
  const [optimisationReinitialisee, setOptimisationReinitialisee] = useState(false);
  /* Filtres d'AFFICHAGE : ils masquent, jamais ne recalculent. */
  const [filtresVue, setFiltresVue] = useState({ conflits: true, deplacements: true, retraits: true, conserves: true, intouchables: true });
  /* Validité de la simulation affichée, lue au serveur (lecture seule). */
  const [etatSimulation, setEtatSimulation] = useState(null);
  /* Le journal de l'optimisation — relu après chaque décision ou activation. */
  const [journalEntrees, setJournalEntrees] = useState([]);
  const [journalVersion, setJournalVersion] = useState(0);
  const [detailsCle, setDetailsCle] = useState(0);

  /**
   * LA PORTÉE D'UN RÉSULTAT EST FIGÉE TANT QU'IL EXISTE.
   *
   * Sans choix explicite, la portée suit la navigation de la carte
   * (`porteeCourante`). Or la navigation bouge d'elle-même : dézoomer au
   * niveau régional remet le contexte à zéro, cliquer un regroupement le
   * resserre. Le périmètre ANALYSÉ changeait alors sous les yeux, et le
   * résultat affiché était effacé ou déclaré périmé sans qu'on ait rien demandé.
   *
   * Un résultat en cours fige donc sa portée : celle qui a servi au calcul.
   * Elle ne change que par un choix EXPLICITE (« Choisir un autre périmètre »)
   * ou après ANNULER.
   */
  const porteeFigee = autrePerimetre
    ? null
    : modeOptimisation === 'auto'
      ? (rapportAuto?.perimetre
          ? {
              niveau: rapportAuto.perimetre.zone?.niveau ?? 'national',
              unite: rapportAuto.perimetre.zone?.unite ?? '',
            }
          : null)
      : (rapport?.parametres
          ? { niveau: rapport.parametres.niveau ?? 'national', unite: rapport.parametres.unite ?? '' }
          : null);
  const niveau = autrePerimetre
    ? niveauChoisi
    : (porteeFigee?.niveau ?? porteeCourante?.niveau ?? impose?.niveau ?? 'national');
  const unite = autrePerimetre
    ? uniteChoisie
    : (porteeFigee ? porteeFigee.unite : (porteeCourante?.unite ?? impose?.unite ?? ''));
  const barragesIntouchables = useMemo(
    () => barragesIntouchablesVisibles(items, niveau, unite),
    [items, niveau, unite],
  );
  /** La zone de l'optimisation automatique : la même portée que le mode manuel. */
  const zoneAuto = useMemo(
    () => (niveau && niveau !== 'national' && unite ? { niveau, unite } : { niveau: null, unite: null }),
    [niveau, unite],
  );
  const [distance, setDistance] = useState(distanceProp ? String(distanceProp) : '20');
  const [factionChoisie, setFactionChoisie] = useState(factionAnalysee || 'toutes');

  useEffect(() => {
    if (distanceProp != null && String(distanceProp) !== distance) {
      setDistance(String(distanceProp));
    }
  }, [distanceProp, distance]);

  const changerDistance = (nouvelleDist) => {
    const dStr = String(nouvelleDist);
    setDistance(dStr);
    onDistanceChangeProp?.(dStr);
  };

  useEffect(() => {
    if (factionAnalysee) {
      setFactionChoisie(factionAnalysee);
    }
  }, [factionAnalysee]);

  const changerFaction = (nouvelleFaction) => {
    const estActif = Boolean(rapport || rapportAuto || open || modeOptimisation === 'auto');
    if (estActif) {
      lancerRecalcul(distance, nouvelleFaction);
    } else {
      setFactionChoisie(nouvelleFaction);
      onFactionChange?.(nouvelleFaction);
    }
  };
  /*
   * Il n'y a plus d'état « postes à examiner ». L'analyse porte toujours sur
   * tout le dispositif fixe du périmètre — voir la note à l'étape 1, où le
   * choix a été retiré, et `positionVille` dans `lancerCalcul`.
   */
  /**
   * LES TROIS PARAMÈTRES DE L'ÉTAPE 3 — ÉTEINTS PAR DÉFAUT, INDÉPENDANTS.
   *
   * Trois états séparés, et aucune règle qui les lie : les huit combinaisons
   * sont possibles, et chacune se lit à l'écran telle qu'elle a été réglée.
   *
   * Éteints, le résultat ne parle que de distance. Allumés :
   *   `accidents`   joint le nombre d'accidents relevés, et rend intouchables
   *                 les postes qui dépassent `seuilAccidents` (4 par défaut) ;
   *   `vip`         rend les postes de mission intouchables ;
   *   `nonEclaire`  rend les postes non éclairés intouchables.
   *
   * Aucun ne touche à la mesure — voir la route `consolidation` côté serveur.
   * Les entrées de ville, elles, sont intouchables sans interrupteur.
   */
  const [accidents, setAccidents] = useState(false);
  const [seuilAccidents, setSeuilAccidents] = useState(ACCIDENTS_DEFAUT);
  const [vip, setVip] = useState(false);
  const [nonEclaire, setNonEclaire] = useState(false);

  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);

  /** ÉTATS POUR LE MODE AUTOMATIQUE (le rapport est déclaré avec la portée, plus haut) */
  const [calculAutoEnCours, setCalculAutoEnCours] = useState(false);
  const [applicationAutoEnCours, setApplicationAutoEnCours] = useState(false);
  const [erreurAuto, setErreurAuto] = useState(null);
  const [succesAuto, setSuccesAuto] = useState(null);
  /**
   * CE QUE L'UTILISATEUR A SORTI DE L'OPTIMISATION — ids, tenus pour la durée
   * de la session de travail.
   *
   * « Exclure » n'écrit rien : le poste sort de CETTE optimisation et
   * redeviendra candidat au prochain calcul. « Conserver » écrit, lui
   * (`decisionOptimisation: 'conserve'`), et le serveur le tiendra pour protégé
   * de façon durable — mais il rejoint aussi cette liste, pour que la
   * proposition se mette à jour sans attendre le rechargement du dépôt.
   */
  const [exclusAuto, setExclusAuto] = useState(() => new Set());
  const [gesteAuto, setGesteAuto] = useState(null);
  /**
   * LES PROPOSITIONS RETENUES POUR APPLICATION.
   *
   * L'analyse propose ; l'utilisateur dispose. Sur trente-cinq retraits
   * proposés il peut n'en retenir que douze, et seuls ces douze partiront au
   * serveur. La sélection démarre COMPLÈTE — décocher est un geste conscient,
   * tout cocher à la main sur trente-cinq lignes n'en serait pas un.
   *
   * Elle est remise à plat à chaque nouveau calcul : une sélection faite sur
   * une analyse précédente ne veut plus rien dire une fois les propositions
   * changées.
   */
  const [selectionAuto, setSelectionAuto] = useState(() => new Set());
  /**
   * L'APERÇU DE LA VERSION PROPOSÉE, sur la carte.
   *
   * Allumé, la carte pose les positions et factions PROPOSÉES par-dessus le
   * dispositif réel, avec un trait de l'ancienne place vers la nouvelle. Le
   * dépôt, lui, n'a pas bougé d'un champ : c'est un calque de lecture, pas un
   * état. Il s'éteint dès qu'une application aboutit — la proposition est
   * alors devenue la réalité, et la montrer deux fois n'apprendrait rien.
   */
  const [apercuAuto, setApercuAuto] = useState(false);
  /** Historique des optimisations appliquées — figé, relu du serveur. */
  const [rapportsOptimisation, setRapportsOptimisation] = useState([]);

  /** BARRAGES RETIRÉS PAR OPTIMISATION */
  const [barragesRetires, setBarragesRetires] = useState([]);
  const [chargementRetires, setChargementRetires] = useState(false);
  const [restaurationEnCours, setRestaurationEnCours] = useState(null);

  /**
   * ASSISTANT D'ANALYSE — n8n ou Ollama, selon ce que le serveur a configuré.
   *
   * Le panneau ne connaît ni adresse ni modèle : il envoie le résumé du calcul
   * qu'il affiche et reçoit un texte (voir serveur/assistant.mjs). Le résultat
   * n'écrit rien et ne décide rien — c'est une lecture de plus, à côté de la
   * mesure de distance.
   */
  const [analyse, setAnalyse] = useState(null); // {texte, source}
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  const [analyseErreur, setAnalyseErreur] = useState(null);
  const assistantDisponible = service?.assistant?.disponible === true;

  /**
   * LA MESURE, RELUE À TRAVERS L'ÉTAT RÉEL.
   *
   * Le rapport du serveur ne bouge plus une fois reçu. Le dépôt, lui, change à
   * chaque décision. On repasse donc chaque ligne par `items` :
   *
   *   - le poste n'y est plus  -> il a été supprimé, la ligne disparaît ;
   *   - il porte une décision  -> c'est ELLE qui fait foi, pas celle qu'avait
   *                               le rapport au moment du calcul.
   *
   * `items` vide (chargement en cours) ne doit rien filtrer : on afficherait
   * une liste vide en prétendant que tout a été supprimé.
   */
  const lignes = useMemo(() => {
    if (!Array.isArray(rapport?.barrages)) return null;
    const vivants = new Map((items ?? []).map((m) => [m.id, m]));
    const idsVus = new Set();
    const uniques = rapport.barrages.filter((b) => {
      if (b?.id == null || b.id === '') return true;
      if (idsVus.has(b.id)) return false;
      idsVus.add(b.id);
      return true;
    });
    if (!vivants.size) return uniques;
    return uniques
      .filter((b) => vivants.has(b.id))
      .map((b) => {
        /* LE VOISIN DU CONFLIT, RÉSOLU PAR SON IDENTIFIANT dans le dépôt
           vivant — jamais une position inventée. Introuvable : on le dit. */
        const voisin = b.voisin?.id ? vivants.get(b.voisin.id) : null;
        if (b.voisin?.id && !voisin) {
          console.warn(`[Optimisation manuelle] voisin introuvable : ${b.voisin.id} (conflit de ${b.id})`);
        }
        return {
          ...b,
          decision: vivants.get(b.id).decisionOptimisation ?? b.decision ?? 'aucune',
          voisinIndisponible: Boolean(b.voisin?.id && !voisin),
          voisinContexte: Boolean(b.voisin?.id && (rapport.contexte ?? []).some((c) => c.id === b.voisin.id)),
        };
      });
  }, [rapport, items]);

  /**
   * LES CHIFFRES PAR CRITÈRE — sur la liste FUSIONNÉE, jamais sur le rapport brut.
   *
   * `lignes` est le rapport du serveur rafraîchi par le dépôt vivant : les
   * postes disparus en sont retirés, et chaque décision rendue depuis le calcul
   * y est reportée. C'est donc lui qui doit alimenter la statistique — sinon,
   * après avoir cliqué « Conserver », le chiffre resterait figé sur l'état du
   * calcul et annoncerait un travail déjà fait.
   *
   * Déclaré AVANT la sortie anticipée du panneau (`if (!open) return null`) :
   * l'effet de publication le lit, et il est enregistré plus haut que cette
   * sortie. C'est la faute que `npm run check:crochets` empêche.
   */
  const situation = useMemo(
    () => (lignes ? statistiquesOptimisation({ ...rapport, barrages: lignes }) : null),
    [rapport, lignes],
  );

  /**
   * Le résultat est répercuté sur la carte : les postes sous le seuil y
   * reçoivent un repère « ? », ou « ✓ » une fois tranchés. Effacé à la
   * fermeture du panneau — un signalement sans panneau ouvert ne s'expliquerait
   * plus.
   */
  /**
   * LE CADRAGE SUIT LE PÉRIMÈTRE PROPOSÉ — celui de l'écran, pas celui du rang.
   *
   * Il cadrait sur `impose`, la circonscription que le RANG détermine. L'idée
   * était juste — un chef de brigade ne doit pas optimiser sa brigade en
   * regardant le pays entier — mais l'effet écrasait la navigation : descendu
   * dans une de ses compagnies, un chef de région ouvrait l'optimisation et se
   * retrouvait ramené à sa région entière, carte comprise. Le périmètre
   * proposé redevenait la région, et le travail en cours était perdu.
   *
   * On cadre donc sur ce qui va être optimisé (`niveau`/`unite`), c'est-à-dire
   * la portée courante tant que l'utilisateur n'a rien choisi d'autre. Le
   * geste est idempotent : cadrer sur la portée courante la redonne identique,
   * il n'y a pas de va-et-vient.
   */
  /* Seulement quand la portée CHANGE : rouvrir le panneau ne doit pas faire
     perdre le cadrage de la carte sur le conflit qu'on regardait. */
  const derniereCirconscription = useRef(null);
  useEffect(() => {
    if (!open || autrePerimetre) return;
    if (niveau === 'national' || !unite) return;
    const cle = `${niveau}|${unite}`;
    if (derniereCirconscription.current === cle) return;
    derniereCirconscription.current = cle;
    onCadrerCirconscription?.(niveau, unite);
  }, [open, niveau, unite, autrePerimetre, onCadrerCirconscription]);


  /**
   * Lance le calcul et RETOURNE son rapport, en plus de le poser dans l'état.
   *
   * Le retour n'est pas un ornement : « Analyser par agent IA » enchaîne calcul
   * puis analyse dans un seul geste, et l'état React n'est pas encore à jour au
   * moment où l'analyse part. Elle travaille donc sur la valeur rendue ici, pas
   * sur `rapport`.
   */
  /**
   * L'INSTANTANÉ D'AVANT SIMULATION — pris par le serveur au PREMIER calcul d'une
   * simulation (même zone, même faction, même mode), conservé jusqu'à sa
   * restauration. Un nouveau périmètre en prend un nouveau.
   */
  const instantaneRef = useRef(null);
  const [confirmerAvantSimulation, setConfirmerAvantSimulation] = useState(false);
  const [avantSimulationEnCours, setAvantSimulationEnCours] = useState(false);
  const [messageAvantSimulation, setMessageAvantSimulation] = useState(null);
  const assurerInstantane = useCallback(async (cle) => {
    if (instantaneRef.current?.cle === cle) return;
    try {
      const r = await API.instantaneSimulation();
      instantaneRef.current = { ...r, cle };
    } catch {
      /* Sans instantané, la restauration se limite à abandonner la simulation. */
    }
  }, []);
  /**
   * `options` (toutes facultatives) :
   *   `criteres`           { accidents, vip, nonEclaire, seuilAccidents } — remplace les
   *                        interrupteurs le temps d'UN calcul. Les onglets de la carte
   *                        en ont besoin : l'état React n'est pas encore à jour quand
   *                        le calcul part.
   *   `conserverSurErreur` un échec laisse le résultat précédent en place (un onglet
   *                        qui échoue ne doit pas éteindre les autres).
   *   `surErreur(msg)`     reçoit le message d'échec, quel qu'en soit le chemin.
   *   `sansCadrage`        ne recadre pas la carte (restauration après rechargement).
   *   `perimetre`          { niveau, unite } choisis dans la boîte d'un onglet — sinon
   *                        le périmètre courant du panneau. Le serveur revérifie tout.
   */
  const generer = async (distKm = distance, fId = factionChoisie, options = {}) => {
    const niveauCalcul = options?.perimetre?.niveau ?? niveau;
    const uniteCalcul = options?.perimetre ? (options.perimetre.unite ?? '') : unite;
    const echec = (msg) => {
      setErreur(msg);
      options?.surErreur?.(msg);
      return null;
    };
    if (!options?.estAlternative) {
      onDistanceBaseChange?.(String(distKm));
    }
    const km = Number(String(distKm).replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0) {
      return echec('Indiquez une distance en kilomètres, supérieure à 0.');
    }
    /* Ne peut arriver qu'à l'administrateur : pour tout autre profil, `unite`
       vient du compte et ne peut pas être vide. */
    if (niveauCalcul !== 'national' && !uniteCalcul && (!impose || options?.perimetre)) {
      return echec("Choisissez l'unité à analyser, ou repassez en périmètre national.");
    }
    const criteres = options?.criteres ?? { accidents, seuilAccidents, vip, nonEclaire };
    setOccupe(true);
    await assurerInstantane(`manuel|${fId}|${niveauCalcul}|${uniteCalcul ?? ''}`);
    setErreur(null);
    try {
      /* Le radar de la carte suit ce calcul réel (radarCalcul.js). */
      const r = await avecRadar(`Optimisation par distance · ${km} km`, () => API.optimiserParDistance({
        distanceMinKm: km,
        niveau: niveauCalcul === 'national' ? null : niveauCalcul,
        unite: niveauCalcul === 'national' ? null : uniteCalcul,
        /* Toujours `null` : tout le dispositif fixe du périmètre. Le filtre
           par porte de ville a été retiré — il ne pouvait rendre que des
           postes intouchables, donc une liste sans décision possible. Le
           paramètre reste envoyé pour ne rien changer au contrat de la route
           `consolidation`, que d'autres appelants partagent. */
        positionVille: null,
        accidents: criteres.accidents === true,
        seuilAccidents: criteres.seuilAccidents ?? seuilAccidents,
        vip: criteres.vip === true,
        nonEclaire: criteres.nonEclaire === true,
        factionId: fId,
      }));
      setOptimisationReinitialisee(false);
      console.log(
        `[OPTIMISATION MANUELLE] zone=${r?.perimetre?.zoneLibelle} faction=${r?.perimetre?.factionId} ` +
          `autorisés=${r?.perimetre?.autorises} analysés=${r?.perimetre?.analyses} contexte=${r?.perimetre?.contexte} ` +
          `hors-périmètre-exclus=${r?.perimetre?.horsPerimetreExclus}`,
      );
      setRapport(r);
      /* Un nouveau calcul périme l'analyse du précédent : la garder à l'écran
         laisserait lire un commentaire sur des chiffres qui ne sont plus là. */
      setAnalyse(null);
      setAnalyseErreur(null);
      if (r && !options?.sansCadrage) {
        const liste = Array.isArray(r.barrages) ? r.barrages : [];
        const vivants = new Map((items ?? []).map((m) => [m.id, m]));
        const concernes = liste
          .filter((b) => b.sousLeSeuil)
          .map((b) => (vivants.has(b.id) ? { ...b, ...vivants.get(b.id) } : b));
        onCadrerResultats?.(concernes);
      }
      return r;
    } catch (err) {
      if (!options?.conserverSurErreur) setRapport(null);
      return echec(err.message ?? 'Erreur pendant le calcul.');
    } finally {
      setOccupe(false);
    }
  };

  /**
   * ANALYSE PAR AGENT — UN GESTE À PART ENTIÈRE.
   *
   * Elle ne lance PAS le calcul de distance et ne dépend pas de « Générer ».
   * C'était le cas dans une première version : le bouton déclenchait le calcul
   * s'il n'y en avait pas, ce qui mêlait deux actions sous un seul geste et
   * rendait l'agent tributaire d'un travail qu'on ne lui avait pas demandé.
   *
   * Ce qu'elle envoie :
   *   — l'INVENTAIRE du périmètre de l'étape 1, tiré du dépôt (`items`),
   *     donc disponible immédiatement, sans aucun calcul préalable ;
   *   — les conclusions du calcul de distance EN PLUS, si et seulement si un
   *     rapport existe et porte sur ce même périmètre. Sinon l'agent est prévenu
   *     qu'aucune mesure n'a été faite, plutôt que de recevoir des chiffres
   *     venus d'un autre périmètre.
   *
   * Aucune source de données nouvelle : le même dépôt que la carte, et le même
   * rapport que le panneau affiche.
   */
  const analyserParAgent = async () => {
    setAnalyseEnCours(true);
    setAnalyseErreur(null);
    try {
      const CHAMP = { region: 'reg', compagnie: 'cie', brigade: 'bt' };
      const champ = CHAMP[niveau] ?? null;
      const dansPerimetre = (m) => !champ || !unite || m[champ] === unite;
      const barrages = uniquesParIdentifiant((items ?? []).filter(
        (m) => (m.type === 'barrage_fixe' || m.type === 'barrage_mobile') && dansPerimetre(m)
      ));
      const compte = (f) => barrages.filter(f).length;
      const porte = (m, sens) => m.positionVille === sens || m.positionVille === 'porte';

      /* Le rapport ne sert QUE s'il porte sur le périmètre affiché. */
      const memePerimetre =
        rapport &&
        (rapport.parametres?.unite ?? null) === (champ ? unite : null) &&
        (rapport.parametres?.niveau ?? 'national') === niveau;
      const rap = memePerimetre ? rapport : null;
      const sous = rap ? rap.barrages.filter((b) => b.sousLeSeuil) : [];
      const proteges = sous.filter((b) => b.intouchable === true);
      const aTrancher = sous.filter((b) => b.intouchable !== true && b.decision === 'aucune');

      const r = await API.analyserOptimisation({
        perimetre: champ && unite ? `${niveau} ${unite}` : 'tout le pays',
        inventaire: {
          total: barrages.length,
          fixes: compte((m) => m.type === 'barrage_fixe'),
          mobiles: compte((m) => m.type === 'barrage_mobile'),
          entrees: compte((m) => porte(m, 'entree')),
          sorties: compte((m) => porte(m, 'sortie')),
          vip: compte((m) => Boolean(m.exceptionnel || m.missionId)),
          nonEclaires: compte((m) => m.eclairage === 'non'),
        },
        /* `null` quand aucun calcul de distance n'a porté sur ce périmètre :
           l'agent doit savoir qu'il n'y en a pas, et non lire un zéro. */
        seuilKm: rap ? (rap.parametres?.distanceMinKm ?? null) : null,
        examines: rap ? rap.barrages.length : null,
        sousLeSeuil: rap ? sous.length : null,
        intouchables: rap ? proteges.length : null,
        aDecider: rap ? aTrancher.length : null,
        postes: [...aTrancher, ...proteges].slice(0, 20).map((b) => ({
          nom: b.nom || '',
          route: b.route || '',
          distanceKm: b.distanceKm,
          protections: b.protections ?? [],
        })),
      });
      setAnalyse(r);
    } catch (err) {
      setAnalyseErreur(err.message ?? 'Analyse indisponible.');
    } finally {
      setAnalyseEnCours(false);
    }
  };

  /**
   * CHARGEMENT DES BARRAGES RETIRÉS PAR OPTIMISATION
   */
  const chargerBarragesRetires = useCallback(async () => {
    setChargementRetires(true);
    try {
      const list = await API.listerBarragesRetiresOptimisation();
      setBarragesRetires(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Erreur chargement barrages retirés:', err);
    } finally {
      setChargementRetires(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      chargerBarragesRetires();
    }
  }, [open, chargerBarragesRetires]);

  /**
   * LANCER L'OPTIMISATION AUTOMATIQUE
   */
  const lancerCalculAuto = useCallback(
    async (exclusions = exclusAuto, distKm = distance, fId = factionChoisie) => {
      setCalculAutoEnCours(true);
      setErreurAuto(null);
      setSuccesAuto(null);
      console.log('[AUTO] AUTO START');
      try {
        // En mode automatique, la règle est TOUJOURS et STRICTEMENT 20 km
        const km = 20;
        setOptimisationReinitialisee(false);
        await assurerInstantane(`auto|${fId}|${zoneAuto.niveau ?? ''}|${zoneAuto.unite ?? ''}`);
        const res = await avecRadar('Optimisation automatique · 20 km', () => API.analyserOptimisationAuto({
          factionId: fId,
          seuilKm: 20,
          distanceMinKm: 20,
          ...zoneAuto,
        }));
        console.log('[AUTO] AUTO API RESPONSE: propositions=' + (res?.propositions?.length ?? 0));
        setRapportAuto(res);
        setJournalVersion((v) => v + 1);
        console.log('[AUTO] AUTO SET RAPPORT: propositions=' + (res?.propositions?.length ?? 0));
        const proposedIds = (res?.propositions ?? []).filter((p) => p.action !== 'conserver').map((p) => p.id);
        setSelectionAuto(new Set(proposedIds));
        console.log('[AUTO] AUTO SET SELECTION: ' + proposedIds.length);
        setApercuAuto(true);
        console.log('[AUTO] AUTO SET PREVIEW: true');
        if (res?.propositions?.length) {
          onCadrerResultats?.(res.propositions);
        }
        return res;
      } catch (err) {
        console.log('[AUTO] AUTO ERROR:', err.message);
        setErreurAuto(err.message ?? 'Erreur lors de l’analyse automatique.');
        setRapportAuto(null);
        setSelectionAuto(new Set());
        return null;
      } finally {
        setCalculAutoEnCours(false);
      }
    },
    [factionChoisie, distance, zoneAuto, exclusAuto, onCadrerResultats, assurerInstantane],
  );

  const lancerRecalcul = async (nouvelleDistance = distance, nouvelleFaction = factionChoisie, options = {}) => {
    const distStr = String(nouvelleDistance);
    if (distStr !== distance) {
      setDistance(distStr);
      onDistanceChangeProp?.(distStr);
    }
    if (nouvelleFaction !== factionChoisie) {
      setFactionChoisie(nouvelleFaction);
      onFactionChange?.(nouvelleFaction);
    }
    if (!options?.estAlternative) {
      onDistanceBaseChange?.(distStr);
    }
    if (modeOptimisation === 'auto') {
      const r = await lancerCalculAuto(exclusAuto, '20', nouvelleFaction);
      if (r) {
        const idx = indiceDe(etapesRef.current ?? [], 'decision');
        setEtape(idx >= 0 ? idx : 3);
      }
      return r;
    }
    const r = await generer(distStr, nouvelleFaction, options);
    if (r) {
      const idx = indiceDe(etapesRef.current ?? [], 'decision');
      setEtape(idx >= 0 ? idx : 3);
    }
    return r;
  };

  const lancerRecalculRef = useRef(lancerRecalcul);
  lancerRecalculRef.current = lancerRecalcul;

  useEffect(() => {
    onEnregistrerRecalcul?.((...args) => lancerRecalculRef.current(...args));
  }, [onEnregistrerRecalcul]);

  /**
   * UNE ANALYSE NE VAUT QUE POUR SA FACTION. Changer de faction sur la carte
   * rend le rapport affiché hors sujet : il est retiré, l'aperçu avec lui, et
   * la prochaine analyse portera sur la nouvelle faction.
   */
  /**
   * CHANGER DE FACTION SUR LA CARTE N'EFFACE PLUS LE RÉSULTAT.
   *
   * Effacer la mesure faisait disparaître, d'un coup, les repères et les routes
   * des barrages en conflit — un conflit réel cessait de se voir parce qu'on
   * regardait une autre faction. Le résultat reste donc affiché, avec SA
   * faction ; le panneau dit qu'il ne porte pas sur la faction de la carte, et
   * la prochaine analyse portera sur celle-ci.
   */
  const factionDuRapportManuel = rapport?.parametres?.factionId ?? null;

  const factionDuRapport = rapportAuto?.perimetre?.factionId ?? null;
  /* Même règle pour la ZONE : un rapport de Rabat ne se lit pas sur Casablanca. */
  const zoneDuRapport = rapportAuto?.perimetre
    ? `${rapportAuto.perimetre.zone?.niveau ?? ''}|${rapportAuto.perimetre.zone?.unite ?? ''}`
    : null;
  const zoneCourante = `${zoneAuto.niveau ?? ''}|${zoneAuto.unite ?? ''}`;
  useEffect(() => {
    /* La ZONE seule périme le résultat automatique ; la faction, non (voir plus haut). */
    const autreZone = zoneDuRapport != null && zoneDuRapport !== zoneCourante;
    if (!autreZone) return;
    setRapportAuto(null);
    setSelectionAuto(new Set());
    setApercuAuto(false);
  }, [zoneDuRapport, zoneCourante]);
  const factionDuResultat = modeOptimisation === 'auto' ? factionDuRapport : factionDuRapportManuel;
  const resultatAutreFaction = Boolean(
    !occupe &&
      !calculAutoEnCours &&
      factionDuResultat &&
      factionChoisie &&
      factionChoisie !== 'toutes' &&
      factionDuResultat !== factionChoisie,
  );

  /**
   * CE QUE L'ANALYSE PRENDRA EN COMPTE — lu au serveur AVANT le calcul, par la
   * même fonction que la simulation (aucun itinéraire calculé).
   */
  const [perimetreAvantCalcul, setPerimetreAvantCalcul] = useState(null);
  useEffect(() => {
    /* Un résultat en cours porte déjà son périmètre : rien à relire. */
    if (!open || modeOptimisation !== 'auto' || rapportAuto) return undefined;
    let annule = false;
    API.perimetreOptimisationAuto({ factionId: factionChoisie, seuilKm: distance, distanceMinKm: distance, ...zoneAuto })
      .then((p) => { if (!annule) setPerimetreAvantCalcul(p); })
      .catch(() => { if (!annule) setPerimetreAvantCalcul(null); });
    return () => { annule = true; };
  }, [open, modeOptimisation, factionChoisie, distance, zoneAuto, rapportAuto]);

  /** Retenir ou écarter UNE proposition — sans toucher aux autres. */
  const basculerSelection = useCallback((id) => {
    setSelectionAuto((courante) => {
      const suivante = new Set(courante);
      if (suivante.has(id)) suivante.delete(id);
      else suivante.add(id);
      return suivante;
    });
  }, []);

  const toutAccepter = useCallback(() => {
    setSelectionAuto(
      new Set(
        (rapportAuto?.propositions ?? [])
          .filter((p) => p.action !== 'conserver')
          .map((p) => p.id),
      ),
    );
  }, [rapportAuto]);

  /**
   * TOUT REFUSER VIDE LA SÉLECTION — sans effacer l'analyse.
   *
   * Refuser les propositions n'est pas annuler le calcul : le commandement veut
   * souvent garder l'analyse sous les yeux après l'avoir refusée, ne serait-ce
   * que pour en retenir deux lignes. Le bouton « Effacer les repères » reste le
   * seul moyen de jeter le résultat.
   */
  const toutRefuser = useCallback(() => setSelectionAuto(new Set()), []);

  /**
   * ANNULER L'ANALYSE — jeter la proposition, et rien d'autre.
   *
   * Aucune écriture n'a eu lieu : le dépôt est intact depuis le début. Il n'y a
   * donc rien à défaire, seulement un résultat à oublier et des repères à
   * retirer de la carte.
   */
  const annulerAuto = useCallback(() => {
    console.log('[AUTO] AUTO RESET');
    setRapportAuto(null);
    setSelectionAuto(new Set());
    setApercuAuto(false);
    setErreurAuto(null);
    setSuccesAuto(null);
    onResultatsChange?.(null);
  }, [onResultatsChange]);

  /*
   * `exclureDeLOptimisation` a vécu ici : il retirait un poste de la
   * proposition et relançait le calcul. La case à cocher fait la même chose
   * sans aller-retour serveur — décocher une ligne suffit à ne pas l'appliquer.
   * Il ne reste donc qu'un geste qui écrit vraiment, « Protéger », ci-dessous.
   */

  /**
   * CONSERVER UN POSTE — « PROTÉGÉ MANUELLEMENT », et écrit comme tel.
   *
   * Passe par l'arbitrage `conserver` qui existe déjà (voir
   * `actionLotBarrages` et `DECISIONS_OPTIMISATION` côté serveur) : le poste
   * porte `decisionOptimisation: 'conserve'`, que l'algorithme relit comme une
   * protection. Il ne sera donc plus proposé, ni dans cette optimisation ni
   * dans les suivantes, tant que la décision n'est pas reprise.
   *
   * Si l'écriture échoue — compte sans autorité sur ce poste — l'exclusion
   * locale s'applique quand même : la proposition ne doit pas revenir sur un
   * poste dont l'utilisateur vient de dire qu'il le garde.
   */
  const conserverBarrageAuto = useCallback(
    async (p) => {
      if (!p?.id) return;
      setGesteAuto(p.id);
      setErreurAuto(null);
      try {
        await API.actionLotBarrages('conserver', [p.id], p.stats ?? null);
      } catch (err) {
        setErreurAuto(
          `« ${p.nom} » est exclu de cette optimisation, mais la protection durable n’a pas pu être écrite : ${err.message}`,
        );
      } finally {
        setGesteAuto(null);
      }
      const suivant = new Set(exclusAuto);
      suivant.add(p.id);
      setExclusAuto(suivant);
      await lancerCalculAuto(suivant);
    },
    [exclusAuto, lancerCalculAuto],
  );

  /** L'historique des optimisations appliquées — relu, jamais recalculé. */
  const chargerRapportsOptimisation = useCallback(async () => {
    try {
      const res = await API.listerRapportsOptimisation();
      setRapportsOptimisation(res.rapports ?? []);
    } catch {
      /* Un historique indisponible n'empêche pas d'optimiser : on n'affiche
         simplement rien, plutôt que de faire échouer le panneau entier. */
    }
  }, []);

  useEffect(() => {
    if (open) chargerRapportsOptimisation();
  }, [open, chargerRapportsOptimisation]);

  /**
   * APPLIQUER L'OPTIMISATION AUTOMATIQUE
   */
  const appliquerAuto = useCallback(async () => {
    if (!rapportAuto?.propositions?.length) return;
    setApplicationAutoEnCours(true);
    setErreurAuto(null);
    setSuccesAuto(null);
    try {
      /**
       * LE CORPS PART TEL QUE LE SERVEUR L'ATTEND — un objet nommé.
       *
       * Il partait auparavant en deux arguments positionnels
       * (`(ids, motifs)`), alors que `appliquerOptimisationAuto` en attend UN
       * seul, déstructuré. `propositions` valait donc `undefined`, le serveur
       * répondait « Aucune proposition à appliquer » (400), et le bouton
       * « Appliquer » ne pouvait rien appliquer du tout.
       *
       * Chaque proposition porte son propre motif : c'est lui qui sera écrit
       * dans la fiche du poste, dans la demande de validation et dans le
       * rapport. Le résumé, les poids et les critères suivent pour le rapport,
       * et ne servent à aucun calcul.
       */
      /**
       * SEULES LES PROPOSITIONS RETENUES PARTENT.
       *
       * C'est le point de la sélection : ce que l'utilisateur a décoché n'est
       * pas « refusé plus tard », il n'est simplement jamais envoyé. Le serveur
       * n'écrit donc que sur des postes explicitement retenus.
       */
      const propositions = rapportAuto.propositions
        .filter((p) => selectionAuto.has(p.id) && p.action !== 'conserver')
        .map((p) => ({
          id: p.id,
          action: p.action,
          avant: p.avant,
          apres: p.apres,
          conflitAvant: p.conflitAvant,
          distanceApresKm: p.distanceApresKm ?? null,
          contraintes: p.contraintes ?? 0,
          raison: p.raison,
          stats: null,
        }));
      if (!propositions.length) {
        setErreurAuto('Aucune proposition retenue : cochez au moins une réaffectation.');
        return;
      }
      const res = await API.appliquerOptimisationAuto({
        simulationId: rapportAuto.simulationId,
        propositions,
        parametres: rapportAuto.parametres ?? null,
        resume: rapportAuto.resume ?? null,
        poids: rapportAuto.poids ?? null,
        criteres: rapportAuto.criteres ?? null,
      });
      const ids = propositions.map((p) => p.id);
      const refuses = Array.isArray(res.refuses) ? res.refuses.length : 0;
      setSuccesAuto(
        `✓ Modifications activées — ${res.appliques ?? ids.length} barrage(s) déplacé(s), revalidé(s) par le serveur` +
          (refuses ? ` · ${refuses} refusé(s)` : '') +
          '. La carte montre désormais le dispositif réel.',
      );
      setRapportAuto(null);
      setExclusAuto(new Set());
      setSelectionAuto(new Set());
      setApercuAuto(false);
      await chargerBarragesRetires();
      await chargerRapportsOptimisation();
      if (onItemsChange && Array.isArray(res.items)) onItemsChange(res.items);
    } catch (err) {
      /* Simulation expirée, d'un autre compte, ou dispositif changé depuis :
         le serveur répond 409 « OPTIMISATION OBSOLÈTE » et n'écrit rien. */
      const message = err.message ?? '';
      setErreurAuto(
        /OBSOL/i.test(message)
          ? `Optimisation devenue obsolète. Veuillez relancer l’analyse. (${message.replace(/^.*OBSOLÈTE\s*—\s*/i, '')})`
          : message || 'Erreur lors de l’application de l’optimisation automatique.',
      );
    } finally {
      setApplicationAutoEnCours(false);
    }
  }, [
    rapportAuto,
    selectionAuto,
    chargerBarragesRetires,
    chargerRapportsOptimisation,
    onItemsChange,
    items,
  ]);

  /**
   * RESTAURER UN BARRAGE RETIRÉ
   */
  const restaurer = useCallback(async (barrage) => {
    if (!barrage?.id) return;
    setRestaurationEnCours(barrage.id);
    setErreurAuto(null);
    try {
      const res = await API.restaurerBarrageOptimisation(barrage.id);
      if (res.barrage && onItemsChange && Array.isArray(items)) {
        onItemsChange([...items.filter((m) => m.id !== barrage.id), res.barrage]);
      }
      await chargerBarragesRetires();
      setSuccesAuto(`Barrage « ${barrage.nom || barrage.id} » restauré avec succès.`);
    } catch (err) {
      setErreurAuto(err.message ?? 'Erreur lors de la restauration du barrage.');
    } finally {
      setRestaurationEnCours(null);
    }
  }, [chargerBarragesRetires, onItemsChange, items]);



  /**
   * REFAIRE LE CALCUL DÈS QU'UN POSTE A ÉTÉ RETIRÉ.
   *
   * Le voisinage affiché ne décrit plus le dispositif dès qu'il en manque un
   * membre : les distances des postes voisins du disparu sont fausses, et
   * certains conformes ne le sont peut-être plus. Le rapport est donc refait
   * sur ce qui reste, au lieu de laisser à l'écran des chiffres périmés.
   *
   * `generer` est atteint par une référence tenue à jour, pour que cet effet ne
   * dépende que de la version du dispositif — sinon il se redéclencherait à
   * chaque frappe dans le champ « distance ».
   */
  /* Un NOUVEAU résultat manuel (calcul relancé) périme les décisions prises
     sur l'ancien — jamais la fermeture du panneau. */
  const rapportDesDecisions = useRef(rapport);
  useEffect(() => {
    if (rapportDesDecisions.current === rapport) return;
    rapportDesDecisions.current = rapport;
    setDecisionsManuelles([]);
    setRapportSimule(null);
  }, [rapport]);

  /** Le verdict du serveur pour chaque décision courante (ou « en cours »). */
  const decisionsVue = useMemo(() => {
    const serveur = new Map((rapportSimule?.simulation?.decisions ?? []).map((d) => [`${d.barrageId}|${d.type}`, d]));
    return new Map(
      decisionsManuelles.map((d) => [
        d.barrageId,
        serveur.get(`${d.barrageId}|${d.type}`) ?? { ...d, statut: 'en_cours' },
      ]),
    );
  }, [decisionsManuelles, rapportSimule]);

  /**
   * DÉCIDER — la liste complète des décisions part au serveur, qui la rejoue
   * sur une copie de l'état et mesure le résultat (voir la route
   * `consolidation`). Chaque décision est ainsi évaluée contre l'état simulé
   * COURANT : supprimer B fait disparaître A↔B et B↔C de la mesure.
   */
  /* Lu par référence : l'identité du rappel de la carte ne doit pas recréer
     `deciderSimulation`, dont dépend l'effet de publication des résultats. */
  const demanderPlacementRef = useRef(onDemanderPlacement);
  demanderPlacementRef.current = onDemanderPlacement;
  const deciderSimulation = useCallback(async (barrageId, type, position = null) => {
    const p = rapport?.parametres;
    if (!p) return;
    /**
     * DÉPLACER NE CHOISIT RIEN À LA PLACE DE L'OPÉRATEUR.
     *
     * Sans position, le geste ouvre le mode placement de la carte : c'est le
     * clic de l'opérateur qui revient ici, avec la position — le serveur la
     * recale sur la route, la mesure et la renvoie. Un second DÉPLACER (ou
     * « Modifier la position ») rouvre le placement ; rien n'est écrit.
     */
    if (type === 'deplacer' && !position) {
      const ligne = (rapport?.barrages ?? []).find((b) => b.id === barrageId);
      demanderPlacementRef.current?.({ barrageId, nom: ligne?.nom || barrageId });
      return;
    }
    const existante = decisionsManuelles.find((d) => d.barrageId === barrageId);
    const nouvelle = position ? { barrageId, type, position: { lng: position.lng, lat: position.lat } } : { barrageId, type };
    const suivantes = existante?.type === type && !position
      ? decisionsManuelles.filter((d) => d.barrageId !== barrageId)
      : [...decisionsManuelles.filter((d) => d.barrageId !== barrageId), nouvelle];
    setDecisionsManuelles(suivantes);
    setMessageManuel(null);
    setOptimisationReinitialisee(false);
    if (!suivantes.length) {
      setRapportSimule(null);
      return;
    }
    setDecisionEnCours(barrageId);
    try {
      const r = await API.optimiserParDistance({
        distanceMinKm: p.distanceMinKm,
        niveau: p.niveau === 'national' ? null : p.niveau,
        unite: p.niveau === 'national' ? null : p.unite,
        positionVille: null,
        accidents: p.accidents,
        seuilAccidents: p.seuilAccidents,
        vip: p.vip,
        nonEclaire: p.nonEclaire,
        factionId: p.factionId,
        decisions: suivantes,
        /* Tracée au journal par le serveur ; `null` quand on retire une décision. */
        decisionNouvelle: existante?.type === type && !position ? null : nouvelle,
      });
      console.log(`[OPTIMISATION MANUELLE] simulation : ${suivantes.map((d) => `${d.type} ${d.barrageId}`).join(', ')}`);
      setRapportSimule(r);
      setJournalVersion((v) => v + 1);
    } catch (err) {
      setMessageManuel({ ton: 'alerte', texte: err.message ?? 'La simulation a échoué.' });
    } finally {
      setDecisionEnCours(null);
    }
  }, [rapport, decisionsManuelles]);

  /** ACTIVER — par la route d'application sécurisée ; le serveur revalide tout. */
  const activerManuel = useCallback(async () => {
    const sim = rapportSimule?.simulation;
    if (!sim?.simulationId) return;
    setActivationManuelleEnCours(true);
    setMessageManuel(null);
    try {
      const decisions = sim.decisions.filter((d) => d.statut === 'simule').map(({ barrageId, type }) => ({ barrageId, type }));
      const res = await API.appliquerOptimisationManuelle({ simulationId: sim.simulationId, decisions });
      if (onItemsChange && Array.isArray(res.items)) onItemsChange(res.items);
      setDecisionsManuelles([]);
      setRapportSimule(null);
      setMessageManuel({
        ton: 'succes',
        texte: `✓ MODIFICATIONS ACTIVÉES — ${res.deplaces} déplacé(s), ${res.suppressionsProposees} suppression(s) soumise(s) au commandement, ${res.conserves} conservé(s).` +
          /* Un poste posé dans l'espace adjacent change de rattachement : on le dit,
             sinon il semblerait disparaître du périmètre affiché. */
          (res.deplacements ?? []).filter((d) => d.espace === 'adjacent')
            .map((d) => ` ${d.nom} est désormais rattaché à ${[d.bt, d.cie, d.reg].filter(Boolean).join(' · ')} (espace adjacent), hors de la zone affichée.`)
            .join(''),
      });
      /* La carte et la liste reprennent l'état RÉEL, remesuré. */
      await genererRef.current?.();
      setJournalVersion((v) => v + 1);
    } catch (err) {
      setJournalVersion((v) => v + 1);
      const m = err.message ?? '';
      setMessageManuel({
        ton: 'alerte',
        texte: /OBSOL/i.test(m)
          ? `Optimisation devenue obsolète. Veuillez relancer l’analyse. (${m.replace(/^.*OBSOLÈTE\s*—\s*/i, '')})`
          : m || 'L’activation a échoué.',
      });
    } finally {
      setActivationManuelleEnCours(false);
    }
  }, [rapportSimule, onItemsChange]);

  /* Modifications simulées non activées : décisions manuelles, ou simulation
     automatique proposant des déplacements. */
  const changementsEnAttente =
    decisionsManuelles.length > 0 || Boolean(rapportAuto?.propositions?.some((p) => p.action === 'deplacer'));
  const optimisationEnCours = Boolean(rapport || rapportAuto || decisionsManuelles.length);

  /**
   * RÉINITIALISER L'OPTIMISATION — le résultat, pas la configuration.
   *
   * Efface simulation, décisions, sélection, aperçu et étape ; garde le mode,
   * la zone, la faction et les seuils. Aucune écriture.
   */
  const reinitialiserOptimisation = useCallback(() => {
    setRapport(null);
    setRapportSimule(null);
    setDecisionsManuelles([]);
    setRapportAuto(null);
    setSelectionAuto(new Set());
    setApercuAuto(false);
    setExclusAuto(new Set());
    setErreurAuto(null);
    setSuccesAuto(null);
    setMessageManuel(null);
    setAnalyse(null);
    setErreur(null);
    setConfirmerReinit(false);
    setOptimisationReinitialisee(true);
    onResultatsChange?.(null);
    onReinitialiser?.();
    setEtape(indiceDe(etapesRef.current ?? [], 'calcul'));
    console.log('[OPTIMISATION] RÉINITIALISÉE — configuration conservée');
  }, [onResultatsChange, onReinitialiser]);

  const restaurerAvantSimulation = useCallback(async () => {
    setAvantSimulationEnCours(true);
    try {
      const inst = instantaneRef.current;
      const r = inst ? await API.restaurerAvantSimulation(inst.id) : null;
      instantaneRef.current = null;
      setConfirmerAvantSimulation(false);
      if (r?.items) onItemsChange?.(r.items);
      reinitialiserOptimisation();
      onEtatOfficielRestaure?.();
      setMessageAvantSimulation({
        ton: 'succes',
        texte: !r || r.officielInchange
          ? '✓ État avant simulation rétabli — aucune modification n’avait été activée : la simulation est annulée.'
          : `✓ État avant simulation rétabli — ${r.restaures} barrage(s) remis exactement à leur état d’avant${r.retablis ? `, ${r.retablis} rétabli(s)` : ''}${r.notificationsRetirees ? `, ${r.notificationsRetirees} notification(s) de la simulation retirée(s)` : ''}. Distances et conflits recalculés.`,
      });
    } catch (err) {
      setConfirmerAvantSimulation(false);
      setMessageAvantSimulation({ ton: 'alerte', texte: err.message ?? 'La restauration a échoué.' });
    } finally {
      setAvantSimulationEnCours(false);
    }
  }, [onItemsChange, reinitialiserOptimisation, onEtatOfficielRestaure]);
  /* Restauration de la présentation : la même remise à zéro que le bouton
     RÉINITIALISER, sans confirmation — elle a déjà été donnée. */
  const presentationVue = useRef(presentationVersion);
  useEffect(() => {
    if (presentationVue.current === presentationVersion) return;
    presentationVue.current = presentationVersion;
    reinitialiserOptimisation();
    setEtatSimulation(null);
  }, [presentationVersion, reinitialiserOptimisation]);

  /** La simulation affichée — celle qui serait activée. */
  const simulationAffichee = modeOptimisation === 'auto'
    ? (rapportAuto?.simulationId
        ? {
            id: rapportAuto.simulationId, libelle: rapportAuto.simulationLibelle, creee: rapportAuto.simulationCreee,
            zone: rapportAuto.perimetre?.zoneLibelle, factionId: rapportAuto.perimetre?.factionId,
          }
        : null)
    : (rapportSimule?.simulation?.simulationId
        ? {
            id: rapportSimule.simulation.simulationId, libelle: rapportSimule.simulation.libelle, creee: rapportSimule.simulation.creee,
            zone: rapportSimule.simulation.zoneLibelle, factionId: rapportSimule.simulation.factionId,
          }
        : null);

  /**
   * LA SIMULATION EST-ELLE ENCORE VALIDE ? — demandé au serveur, qui fait les
   * mêmes contrôles qu'à l'activation (sans rien écrire), à l'ouverture, à
   * chaque changement du dispositif, et toutes les 30 s tant qu'elle est affichée.
   */
  useEffect(() => {
    if (!open || !simulationAffichee?.id) {
      setEtatSimulation(null);
      return undefined;
    }
    let annule = false;
    const verifier = () => API.etatSimulationOptimisation(simulationAffichee.id)
      .then((r) => { if (!annule) setEtatSimulation(r); })
      .catch(() => {});
    verifier();
    const minuterie = setInterval(verifier, 30_000);
    return () => { annule = true; clearInterval(minuterie); };
  }, [open, simulationAffichee?.id, dispositifVersion]);

  /* Le journal, relu à l'ouverture et après chaque décision ou activation. */
  useEffect(() => {
    if (!open) return undefined;
    let annule = false;
    API.journalOptimisation(30)
      .then((r) => { if (!annule) setJournalEntrees(r.entrees ?? []); })
      .catch(() => { if (!annule) setJournalEntrees([]); });
    return () => { annule = true; };
  }, [open, journalVersion]);

  /**
   * LA SYNTHÈSE — chiffres de la simulation courante, jamais écrits en dur.
   * Automatique : le résumé du moteur. Manuel : la mesure initiale (AVANT) et
   * l'état simulé par le serveur après décisions (APRÈS).
   */
  const synthese = useMemo(() => {
    const estIntou = (m) => m?.protection === 'intouchable' || m?.intouchable === true;
    if (modeOptimisation === 'auto') {
      if (!rapportAuto?.resume) return null;
      const parId = new Map((items ?? []).map((m) => [m.id, m]));
      const r = rapportAuto.resume;
      const concernes = new Set((rapportAuto.conflitsInitiaux ?? []).flatMap((c) => [c.a, c.b]).filter((id) => !estIntou(parId.get(id))));
      return {
        zone: rapportAuto.perimetre?.zoneLibelle, faction: rapportAuto.perimetre?.factionId,
        libelleSeuil: 'Seuil automatique :', seuil: rapportAuto.seuilKm, seuilDeplacement: null,
        conflitsAvant: r.conflitsAvant, concernes: concernes.size, resolus: r.conflitsResolus, restants: r.conflitsApres,
        deplacements: (rapportAuto.propositions ?? []).filter((p) => p.action === 'deplacer').length,
        retraits: 0, conserves: 0, intouchables: rapportAuto.perimetre?.intouchablesProteges ?? 0,
        entreIntouchables: r.conflitsEntreIntouchables ?? 0,
      };
    }
    if (!rapport?.barrages) return null;
    const paires = (lignesX) => {
      const vues = new Set();
      let entreIntou = 0;
      for (const b of lignesX ?? []) {
        if (!b.sousLeSeuil || !b.voisin?.id) continue;
        const cle = [b.id, b.voisin.id].sort().join('|');
        if (vues.has(cle)) continue;
        vues.add(cle);
        if (b.intouchable && b.voisin.intouchable) entreIntou++;
      }
      return { n: vues.size, entreIntou };
    };
    const avant = paires(rapport.barrages);
    const apres = paires((rapportSimule ?? rapport).barrages);
    const retenues = (rapportSimule?.simulation?.decisions ?? []).filter((d) => d.statut === 'simule');
    const n = (t) => retenues.filter((d) => d.type === t).length;
    return {
      zone: rapport.perimetre?.zoneLibelle, faction: rapport.perimetre?.factionId,
      libelleSeuil: 'Seuil manuel :', seuil: rapport.parametres?.distanceMinKm,
      seuilDeplacement: rapportSimule?.simulation?.seuilDeplacementKm ?? null,
      conflitsAvant: avant.n, concernes: rapport.barrages.filter((b) => b.sousLeSeuil).length,
      resolus: Math.max(0, avant.n - apres.n), restants: apres.n,
      deplacements: n('deplacer'), retraits: n('supprimer'), conserves: n('conserver'),
      intouchables: rapport.barrages.filter((b) => b.sousLeSeuil && b.intouchable).length,
      entreIntouchables: apres.entreIntou,
    };
  }, [modeOptimisation, rapportAuto, rapport, rapportSimule, items]);

  /** « Voir les détails » : le résultat détaillé existant, déplié. */
  const voirDetails = () => {
    DEPLIAGES.set('auto-propositions', true);
    setDetailsCle((k) => k + 1);
    setEtape(indiceDe(etapesRef.current ?? [], modeOptimisation === 'auto' ? 'calcul' : 'decision'));
    setTimeout(() => document.querySelector('[data-gr-details-optimisation]')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 150);
  };
  const relancer = () => {
    setEtatSimulation(null);
    lancerRecalcul(distance, factionChoisie);
  };
  const blocSynthese = (
    <SyntheseOptimisation
      synthese={synthese}
      simulation={simulationAffichee}
      etatSimulation={etatSimulation}
      positionChangee={positionChangee}
      autreFaction={resultatAutreFaction ? { resultat: factionDuResultat, carte: factionChoisie } : null}
      onRelancer={relancer}
      filtres={filtresVue}
      onFiltres={setFiltresVue}
      onDetails={voirDetails}
    />
  );
  const blocJournal = <JournalOptimisation entrees={journalEntrees} />;
  /** Les données du « Pourquoi ? » d'une ligne manuelle — la mesure initiale. */
  const explicationDe = (b) => ({
    nom: `${b.id} — ${b.nom || b.id}`,
    distanceKm: b.distanceKm,
    seuilKm: rapport?.parametres?.distanceMinKm ?? null,
    voisinNom: b.voisin?.nom || b.voisin?.id || null,
    seuilDeplacementKm: rapportSimule?.simulation?.seuilDeplacementKm ?? null,
  });

  const reinitialisation = (
    <>
      <Reinitialisation
        visible={optimisationEnCours}
        enAttente={changementsEnAttente}
        confirmer={confirmerReinit}
        onDemander={() => setConfirmerReinit(true)}
        onConfirmer={reinitialiserOptimisation}
        onRenoncer={() => setConfirmerReinit(false)}
      />
      {optimisationReinitialisee && !optimisationEnCours && (
        <p className="rounded-lg border border-white/12 bg-white/5 px-3 py-2 text-[11.5px] font-semibold text-white/75">
          Aucune optimisation en cours
        </p>
      )}
      <RestaurationAvantSimulation
        confirmer={confirmerAvantSimulation}
        enCours={avantSimulationEnCours}
        message={messageAvantSimulation}
        onDemander={() => {
          setMessageAvantSimulation(null);
          if (!instantaneRef.current && !optimisationEnCours) {
            setMessageAvantSimulation({ ton: 'info', texte: 'Aucune simulation à restaurer.' });
            return;
          }
          setConfirmerAvantSimulation(true);
        }}
        onConfirmer={restaurerAvantSimulation}
        onRenoncer={() => setConfirmerAvantSimulation(false)}
      />
    </>
  );

  const genererRef = useRef(generer);
  genererRef.current = generer;
  const versionVue = useRef(dispositifVersion);
  useEffect(() => {
    if (versionVue.current === dispositifVersion) return;
    versionVue.current = dispositifVersion;
    if (rapport) genererRef.current();
  }, [dispositifVersion, rapport]);

  /*
   * `rapport?.barrages` et non `rapport?.barrages.filter` : le `?.` ne
   * protégeait que `rapport`. Une réponse sans le champ `barrages` — celle que
   * renvoie une version PRÉCÉDENTE du serveur, restée sur `redeploiements` et
   * `conserves` — faisait donc échouer `.filter` pendant le rendu, et React
   * démontait toute l'application : écran blanc, sans message.
   *
   * Un panneau doit résister à une réponse qu'il ne comprend pas. Il le dit
   * (voir `reponseInattendue` plus bas), il ne fait pas disparaître la carte.
   */
  const barrages = lignes;
  const sous = (barrages ?? []).filter((b) => b.sousLeSeuil);
  /**
   * SOUS LE SEUIL, MAIS PROTÉGÉS — la question ne leur est pas posée.
   *
   * Ils gardent leur ligne et leur distance : savoir qu'une entrée de ville a
   * un voisin à 800 m renseigne sur le maillage, et c'est bien pour cela qu'on
   * a lancé le calcul. Ils sortent seulement des trois listes de décision.
   *
   * `intouchable !== true` et non `!intouchable` : un serveur d'une version
   * antérieure ne renvoie pas ce champ. `undefined` doit alors se comporter
   * comme avant — le poste reste négociable — plutôt que de faire disparaître
   * toutes les décisions à l'écran.
   */
  const proteges = sous.filter((b) => b.intouchable === true);
  const negociables = sous.filter((b) => b.intouchable !== true);
  const aDecider = negociables.filter((b) => b.decision === 'aucune');
  const conserves = negociables.filter((b) => b.decision === 'conserve');
  const aSupprimer = negociables.filter((b) => b.decision === 'a_supprimer');
  const reponseInattendue = Boolean(rapport) && barrages === null;

  /**
   * PUBLIER LE RÉSULTAT SUR LA CARTE — DÉFINI ICI, APRÈS SES DONNÉES.
   *
   * Cet effet était écrit deux cents lignes PLUS HAUT, parmi les autres
   * crochets, alors qu'il lit `barrages`, `sous`, `proteges`, `negociables`,
   * `aDecider`, `conserves` et `aSupprimer` — tous déclarés juste au-dessus
   * de ces lignes-ci.
   *
   * Cela tenait par accident, et a fini par céder : la sortie anticipée
   * « panneau replié » se trouvait entre les deux. Un rendu replié
   * n'évaluait donc jamais ces sept constantes, et l'effet — enregistré
   * avant la sortie, donc exécuté quand même après le rendu — lisait des
   * liaisons en zone morte :
   *
   *     Uncaught ReferenceError: Cannot access 'proteges' before initialization
   *
   * Toute l'application tombait. Il fallait pour cela un rendu replié AVEC
   * un rapport en mémoire : c'est ce que produit TERMINER depuis qu'il ferme
   * la section, et il fallait d'abord que CALCULER fonctionne. Deux
   * corrections plus tôt, ce chemin n'était jamais emprunté.
   *
   * Le placer après ses données supprime la classe entière : l'ordre du
   * texte suit l'ordre d'évaluation, et plus aucune sortie ne peut se glisser
   * entre une valeur et le crochet qui la lit.
   */
  useEffect(() => {
    if (!onResultatsChange) return;

    if (modeOptimisation === 'auto') {
      if (!rapportAuto?.propositions) {
        onResultatsChange(null);
        return;
      }

      /**
       * LA CARTE MONTRE CE QUI EST RETENU, pas tout ce qui a été proposé.
       * Si selectionAuto est encore vide à l'initialisation, toutes les propositions
       * applicables sont retenues par défaut.
       */
      const selectionEffective =
        selectionAuto && selectionAuto.size > 0
          ? selectionAuto
          : new Set(
              (rapportAuto.propositions ?? [])
                .filter((p) => p.action !== 'conserver')
                .map((p) => p.id),
            );

      const retenus = rapportAuto.propositions.filter(
        (p) => p.action !== 'conserver' && selectionEffective.has(p.id),
      );

      console.log('[AUTO] AUTO RESULTATS CHANGE: propositions=' + retenus.length);

      /**
       * L'APERÇU DE LA VERSION PROPOSÉE — le cœur de cet écran.
       *
       * Chaque ligne porte la position du poste — LA MÊME AVANT ET APRÈS, le
       * barrage ne bouge pas — et les deux factions, l'ancienne et la
       * proposée. La faction doit voyager avec, sans quoi le filtre par
       * faction montrerait le poste sous son ancien tour de service alors que
       * l'aperçu annonce le nouveau.
       *
       * RIEN N'EST ÉCRIT. Ce tableau est un calque de lecture : le dépôt n'a
       * pas bougé, et il ne bougera qu'au clic sur « Appliquer ».
       */
      const apercu = apercuAuto
        ? retenus.map((p) => ({
            id: p.id,
            nom: p.nom,
            action: p.action,
            bt: p.bt ?? null,
            cie: p.cie ?? null,
            lng: p.apres?.lng,
            lat: p.apres?.lat,
            lngAvant: p.avant?.lng,
            latAvant: p.avant?.lat,
            route: p.apres?.route,
            routeAvant: p.avant?.route ?? null,
            routeApres: p.apres?.route ?? p.route ?? null,
            distanceDeplacementKm: p.distanceDeplacementKm ?? null,
            factionId: p.factionId,
            conflitAvant: p.conflitAvant ?? null,
            distanceApresKm: p.distanceApresKm ?? null,
            conflit: p.conflit ?? null,
            raison: p.raison ?? null,
            raisons: p.raisons ?? [],
            statut: p.statut ?? null,
            /* Le trajet OLD → NEW par la route réelle — jamais une droite. */
            routeDeplacement: p.routeDeplacement ?? null,
            seuilKm: rapportAuto.seuilKm,
            mode: 'auto',
            espace: p.espace ?? 'zone',
            espaceAdjacent: p.espaceAdjacent ?? null,
            factionApres: p.apres?.factionId || null,
          }))
        : null;

      /**
       * LES ROUTES EN CONFLIT — la VRAIE route, pas un trait entre deux points.
       *
       * `conflit.trace` est la géométrie de l'itinéraire, calculée par le
       * serveur sur le même graphe et avec le même coût que la décision. Une
       * ligne droite aurait été plus simple à dessiner et fausse : elle ne
       * passe par aucune chaussée, et sa longueur n'a rien à voir avec les
       * kilomètres qu'il faut réellement parcourir.
       *
       * Chaque route porte sa distance ROUTIÈRE, sa durée, et le statut de la
       * proposition — pour que la carte puisse écrire « 32,4 km · 42 min ·
       * minimum 1 h » et dire si le conflit est dénoué.
       */
      /**
       * QUI EST EN CONFLIT AVEC QUI — chaque PAIRE du serveur reçoit son
       * identifiant (C-01, C-02…), voir src/conflitsIdentifies.js.
       *
       * Les paires viennent du rapport : `conflitsInitiaux` (positions
       * officielles) et `conflitsRestants` (état final de la simulation).
       * Jamais de la géométrie : deux tracés superposés restent deux conflits.
       * La distance APRÈS d'une paire dénouée est celle que le serveur a
       * mesurée pour le poste déplacé (`distanceApresKm`).
       */
      const deplacesAuto = rapportAuto.propositions.filter((p) => p.action === 'deplacer');
      const modeleConflits = identifierConflits({
        initiaux: rapportAuto.conflitsInitiaux ?? [],
        finaux: rapportAuto.conflitsRestants ?? [],
        apresKm: new Map(
          deplacesAuto
            .filter((p) => p.conflitAvant?.id && Number.isFinite(Number(p.distanceApresKm)))
            .map((p) => [clePaire(p.id, p.conflitAvant.id), p.distanceApresKm]),
        ),
        deplaces: new Set(deplacesAuto.map((p) => p.id)),
        infos: new Map((items ?? []).map((m) => [m.id, {
          nom: m.nom,
          lng: m.lng,
          lat: m.lat,
          route: m.route || '',
          reg: m.reg ?? null,
          cie: m.cie ?? null,
          factionId: m.factionId ?? null,
          factions: m.factions ?? null,
          intouchable: m.protection === 'intouchable' || m.intouchable === true || m.type === 'barrage_vip',
        }])),
      });
      const idConflit = (a, b) => modeleConflits.parCle.get(clePaire(a, b))?.id ?? null;
      const pos = (lng, lat) => (Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : {});

      const routesAvant = retenus
        .filter((p) => p.conflit?.trace?.length > 1)
        .map((p) => ({
          cle: [p.id, p.conflit.id].sort().join('|'),
          conflitId: idConflit(p.id, p.conflit.id),
          phase: 'avant',
          trace: p.conflit.trace,
          km: p.conflit.km,
          minutes: null,
          seuilKm: rapportAuto.seuilKm,
          statut: 'conflit',
          action: p.action,
          /* Les positions de CE tracé (l'ancienne place du poste déplacé) :
             elles disent quelle extrémité du tracé est A, laquelle est B. */
          a: { id: p.id, nom: p.nom, factionId: p.factionId, bt: p.bt, ...pos(p.lng, p.lat) },
          b: {
            id: p.conflit.id,
            nom: p.conflit.nom,
            factionId: p.conflit.factionId,
            bt: p.conflit.bt,
            ...pos(p.conflit.lng, p.conflit.lat),
          },
        }));
      const routesApres = retenus
        .filter((p) => p.routeApres?.length > 1)
        .map((p) => ({
          cle: `${[p.id, p.conflitAvant?.id].sort().join('|')}-apres`,
          conflitId: idConflit(p.id, p.conflitAvant?.id),
          phase: 'apres',
          trace: p.routeApres,
          km: p.distanceApresKm,
          minutes: null,
          seuilKm: rapportAuto.seuilKm,
          statut: p.statut,
          action: p.action,
          /* APRÈS : le poste à sa NOUVELLE place, le voisin là où la cascade
             l'a laissé (il a pu bouger lui aussi). */
          a: { id: p.id, nom: p.nom, factionId: p.factionId, bt: p.bt, deplace: true, ...pos(p.apres?.lng, p.apres?.lat) },
          b: {
            id: p.conflitAvant?.id,
            nom: p.conflit?.nom,
            deplace: p.conflit?.deplaceAussi === true,
            ...pos(p.conflit?.apres?.lng ?? p.conflit?.lng, p.conflit?.apres?.lat ?? p.conflit?.lat),
          },
        }));
      /* LES CONFLITS RESTANTS — tracés par le serveur seulement quand ils sont
         peu nombreux (périmètre restreint) : la carte reste lisible. Ceux qui
         touchent un poste déplacé sont déjà dessinés en « après ». Les conflits
         entre deux intouchables ne sont jamais dessinés en rouge d'erreur. */
      const dejaTraces = new Set(routesApres.map((r) => [r.a.id, r.b.id].sort().join('|')));
      const routesRestantes = apercuAuto
        ? (rapportAuto.conflitsRestants ?? [])
            .filter((c) => c.trace?.length > 1 && !c.entreIntouchables && !(c.a?.intouchable && c.b?.intouchable) && !dejaTraces.has([c.a.id, c.b.id].sort().join('|')))
            .map((c) => ({
              cle: `${[c.a.id, c.b.id].sort().join('|')}-restant`,
              conflitId: idConflit(c.a.id, c.b.id),
              phase: 'restant',
              trace: c.trace,
              km: c.km,
              seuilKm: rapportAuto.seuilKm,
              statut: 'conflit',
              entreIntouchables: Boolean(c.entreIntouchables || (c.a?.intouchable && c.b?.intouchable)),
              a: { id: c.a.id, nom: c.a.nom, intouchable: Boolean(c.a?.intouchable), ...pos(c.a.lng, c.a.lat) },
              b: { id: c.b.id, nom: c.b.nom, intouchable: Boolean(c.b?.intouchable), ...pos(c.b.lng, c.b.lat) },
            }))
        : [];
      const routesConflit = [...routesAvant, ...routesApres, ...routesRestantes];

      const conflitsNonResolus = (rapportAuto.conflitsSansSolution ?? []).map((c) => {
        const itemA = (items ?? []).find((m) => m.id === c.a);
        const itemB = (items ?? []).find((m) => m.id === c.b);
        return {
          a: {
            id: c.a,
            nom: itemA?.nom || c.a,
            lat: itemA?.lat,
            lng: itemA?.lng,
            route: itemA?.route,
            intouchable: itemA?.protection === 'intouchable' || itemA?.intouchable === true,
          },
          b: {
            id: c.b,
            nom: itemB?.nom || c.b,
            lat: itemB?.lat,
            lng: itemB?.lng,
            route: itemB?.route,
            intouchable: itemB?.protection === 'intouchable' || itemB?.intouchable === true,
          },
          km: c.km,
          raison: c.raison,
        };
      });

      onResultatsChange({
        /* Un nouveau calcul (et non une simple republication) : la carte enchaîne
           alors les étapes communes à toutes les optimisations. */
        calculId: idCalcul(rapportAuto),
        annulesIds: new Set(),
        conservesIds: new Set(),
        /* Les postes concernés portent un repère de décision, jamais un « ✗ » :
           rien n'est retiré. */
        aSupprimerIds: new Set(),
        masquesIds: new Set(),
        deplacesIds: new Set(retenus.filter((p) => p.action === 'deplacer').map((p) => p.id)),
        /* « CONSERVER » depuis la bulle d'une proposition : la retire de la sélection. */
        basculerAuto: basculerSelection,
        mode: 'auto',
        conflits: conflitsAuto(rapportAuto, items),
        factionsChangeesIds: new Set(
          retenus.filter((p) => p.action === 'changer_faction').map((p) => p.id),
        ),
        apercu,
        routesConflit,
        /* Les paires numérotées (C-01…) : la carte et la liste du panneau
           lisent les MÊMES identifiants. */
        conflitsIdentifies: modeleConflits.conflits,
        /* Filtres d'AFFICHAGE — lus par les calques, jamais par le calcul. */
        filtres: filtresVue,
        conflitsNonResolus,
        /* Plus de `liens` : ils tiraient une droite entre deux postes, ce que
           la demande interdit explicitement. Les routes réelles les remplacent. */
        liens: null,
        seuilKm: rapportAuto.seuilKm,
        perimetre: {
          niveau: niveau === 'national' ? 'national' : niveau,
          unite: niveau === 'national' ? null : unite,
        },
        situation: null,
        badges: new Map(),
        protegesIds: new Set(),
        exclusions: new Map(),
        analysesIds: new Set([...(rapportAuto.propositions ?? []).map((p) => p.id), ...(rapportAuto.conflitsInitiaux ?? []).flatMap((c) => [c.a, c.b])]),
        contexteIds: new Set((rapportAuto.contexte ?? []).map((c) => c.id)),
        decisionsSimulees: new Map(
          (rapportAuto.propositions ?? []).map((p) => [
            p.id,
            {
              type: p.action === 'conserver' ? 'conserver' : p.action === 'deplacer' ? 'deplacer' : 'supprimer',
              statut: 'simule',
              barrageId: p.id,
              distanceAvantKm: p.conflitAvant?.km,
              distanceApresKm: p.distanceApresKm,
              conflitRestant: p.distanceApresKm != null && p.distanceApresKm < rapportAuto.seuilKm,
            },
          ]),
        ),
        decider: (id, type) => {
          if (type === 'conserver') basculerSelection(id);
          else if (type === 'deplacer') {
            const prop = (rapportAuto.propositions ?? []).find((p) => p.id === id);
            demanderPlacementRef.current?.({ barrageId: id, nom: prop?.nom || id });
          } else if (type === 'supprimer') {
            setSelectionAuto((cur) => {
              const next = new Set(cur);
              next.add(id);
              return next;
            });
          }
        },
        explications: new Map(
          (rapportAuto.conflitsInitiaux ?? []).flatMap((c) => {
            const itemA = (items ?? []).find((x) => x.id === c.a);
            const itemB = (items ?? []).find((x) => x.id === c.b);
            return [
              [c.a, { nom: itemA ? (itemA.nom || itemA.id) : c.a, distanceKm: c.km, seuilKm: rapportAuto.seuilKm, voisinNom: itemB ? (itemB.nom || itemB.id) : c.b }],
              [c.b, { nom: itemB ? (itemB.nom || itemB.id) : c.b, distanceKm: c.km, seuilKm: rapportAuto.seuilKm, voisinNom: itemA ? (itemA.nom || itemA.id) : c.a }],
            ];
          }),
        ),
        motifs: new Map(
          retenus.map((p) => [
            p.id,
            {
              texte: p.raison || 'Optimisation par distance routière',
              seuilKm: rapportAuto.seuilKm,
              criteres: {
                action: p.action,
                distanceAvantKm: p.conflitAvant?.km,
                distanceApresKm: p.distanceApresKm,
                factionId: p.factionId,
                nouvelleFactionId: p.nouvelleFactionId,
              },
            },
          ]),
        ),
      });
      return;
    }

    /**
     * LE RÉSULTAT SURVIT AU REPLI DU PANNEAU.
     *
     * Il était effacé dès que `open` passait à faux — « un signalement sans
     * panneau ouvert ne s'expliquerait plus », disais-je. C'était faux : chaque
     * repère « ? » porte sa propre bulle, avec la distance mesurée, le seuil
     * demandé et les critères joints. Il s'explique tout seul.
     *
     * Et c'était surtout nuisible : replier le panneau pour dégager la carte —
     * exactement ce qu'on demande de faire — vidait la carte de l'analyse
     * qu'on venait d'y lire.
     *
     * Ne reste plus qu'une seule façon d'effacer les repères : le bouton
     * « Effacer » ci-dessous, ou un nouveau calcul qui les remplace.
     */
    if (!lignes) {
      onResultatsChange(null);
      return;
    }
    /* L'ÉTAT SIMULÉ quand des décisions existent : c'est lui que la carte montre
       (les supprimés en sont absents, les déplacés y sont à leur nouvelle place). */
    const tous = rapportSimule?.barrages ?? lignes;
    const sous = tous.filter((b) => b.sousLeSeuil);
    /**
     * LES POSTES INTOUCHABLES NE PORTENT AUCUN REPÈRE DE DÉCISION.
     *
     * C'est ici que la protection prend effet sur la carte : pas de « ? », donc
     * aucune bulle où proposer un retrait. Ils restent des barrages ordinaires
     * à l'écran, avec leur icône habituelle — leur distance est dans le panneau,
     * qui les liste à part avec le motif de leur protection.
     *
     * Le filtre porte sur les repères, jamais sur la mesure : ces postes sont
     * toujours dans `tous`, donc toujours dans les badges et dans les liens de
     * voisinage tracés.
     */
    const negociables = sous.filter((b) => b.intouchable !== true);
    /* TROIS ÉTATS, jamais deux : la question ouverte, le poste maintenu, et le
       retrait proposé mais pas encore validé par le commandant. */
    const aDecider = negociables.filter((b) => b.decision === 'aucune');
    const conserves = negociables.filter((b) => b.decision === 'conserve');
    const aSupprimer = negociables.filter((b) => b.decision === 'a_supprimer');

    /**
     * LES PAIRES RÉELLEMENT COMPARÉES, pour que la carte puisse les tracer.
     *
     * Chaque lien vient du résultat du calcul — `barrage → son voisin retenu` —
     * jamais d'un rapprochement visuel. Deux barrages voisins l'un de l'autre
     * ne produisent qu'un seul trait : la clé de paire est triée, donc A→B et
     * B→A se confondent.
     *
     * La distance transportée est CELLE DU SERVEUR, telle quelle. Le tracé,
     * lui, sera recalculé côté carte pour obtenir sa géométrie — avec le même
     * critère (le plus court en kilomètres), donc le même chemin.
     */
    /* LES DEUX BARRAGES DU CONFLIT, résolus dans le DÉPÔT par leur identifiant
       — pas seulement parmi les lignes du rapport : le voisin peut être hors
       de la zone rapportée (juste de l'autre côté d'une limite) et il existe
       pourtant. Un identifiant qui ne se résout pas ne produit aucun trait. */
    const depot = new Map((items ?? []).map((m) => [m.id, m]));
    const liens = new Map();
    for (const a of tous) {
      if (!a.voisin?.id || !a.sousLeSeuil) continue;
      const reelA = depot.get(a.id);
      const reelB = depot.get(a.voisin.id);
      if (!reelA || !reelB || reelB.id === reelA.id) continue; // jamais un barrage avec lui-même
      const intouA = reelA.protection === 'intouchable' || reelA.intouchable === true || reelA.type === 'barrage_vip';
      const intouB = reelB.protection === 'intouchable' || reelB.intouchable === true || reelB.type === 'barrage_vip';
      const cle = [reelA.id, reelB.id].sort().join('|');
      if (liens.has(cle)) continue;
      liens.set(cle, {
        cle,
        a: { id: reelA.id, nom: reelA.nom, lng: reelA.lng, lat: reelA.lat, intouchable: intouA },
        b: { id: reelB.id, nom: reelB.nom, lng: reelB.lng, lat: reelB.lat, intouchable: intouB },
        distanceKm: a.distanceKm,
        sousLeSeuil: a.sousLeSeuil,
        entreIntouchables: intouA && intouB,
        /* La géométrie mesurée par le serveur, sur le graphe hors ligne. */
        trace: a.voisin.route?.trace ?? null,
        routes: a.voisin.route?.routes ?? [],
      });
    }

    /**
     * QUI EST EN CONFLIT AVEC QUI — en manuel aussi (voir src/conflitsIdentifies.js).
     *
     * Les paires sont celles que le serveur a mesurées : chaque poste sous le
     * seuil et le voisin qu'il a retenu, sur les positions OFFICIELLES
     * (`lignes`), puis dans l'état simulé quand des décisions existent. Une
     * paire qui n'existe qu'après simulation est un NOUVEAU conflit.
     */
    const pairesDe = (liste) =>
      (liste ?? [])
        .filter((b) => b.sousLeSeuil && b.voisin?.id && b.voisin.id !== b.id)
        .map((b) => ({ a: { id: b.id, nom: b.nom }, b: { id: b.voisin.id, nom: b.voisin.nom }, km: b.distanceKm }));
    const deplacesManuel = [...decisionsVue.values()].filter((d) => d.type === 'deplacer' && d.statut === 'simule');
    const modeleConflits = identifierConflits({
      initiaux: pairesDe(lignes),
      finaux: rapportSimule?.barrages ? pairesDe(rapportSimule.barrages) : null,
      apresKm: new Map(
        deplacesManuel
          .filter((d) => d.voisinAvant && d.voisinApres === d.voisinAvant && Number.isFinite(Number(d.distanceApresKm)))
          .map((d) => [clePaire(d.barrageId, d.voisinAvant), d.distanceApresKm]),
      ),
      deplaces: new Set(deplacesManuel.map((d) => d.barrageId)),
      infos: new Map((items ?? []).map((m) => [m.id, {
        nom: m.nom,
        lng: m.lng,
        lat: m.lat,
        route: m.route || '',
        reg: m.reg ?? null,
        cie: m.cie ?? null,
        factionId: m.factionId ?? null,
        factions: m.factions ?? null,
        intouchable: m.protection === 'intouchable' || m.intouchable === true || m.type === 'barrage_vip',
      }])),
    });
    const idConflit = (a, b) => modeleConflits.parCle.get(clePaire(a, b))?.id ?? null;
    for (const l of liens.values()) l.conflitId = idConflit(l.a.id, l.b.id);
    const vueManuelle = apercuManuel(decisionsVue, lignes, items, {
      manuel: rapport.parametres?.distanceMinKm ?? null,
      deplacement: rapportSimule?.simulation?.seuilDeplacementKm ?? null,
    });
    if (vueManuelle.routesConflit) {
      vueManuelle.routesConflit = vueManuelle.routesConflit.map((r) => ({ ...r, conflitId: idConflit(r.a.id, r.b.id) }));
    }

    onResultatsChange({
      calculId: idCalcul(rapport),
      /* Un poste décidé porte le repère de sa décision, plus le « ? ». */
      annulesIds: new Set(aDecider.filter((b) => !decisionsVue.has(b.id)).map((b) => b.id)),
      conservesIds: new Set(conserves.map((b) => b.id)),
      aSupprimerIds: new Set(aSupprimer.map((b) => b.id)),
      /* Tout poste qui porte un repère — « ? » à trancher, « 🔒 » exclu, « ✓ »
         ou « ✗ » tranché — voit son icône de barrage REMPLACÉE, jamais
         surchargée : deux symboles empilés au même point ne se lisent plus.
         Voir `masques` dans MarquagesLayer. */
      /* Les postes de contexte portent leur propre repère (« Contexte ») : leur
         icône ordinaire est remplacée, jamais doublée. */
      masquesIds: new Set([
        ...sous.map((b) => b.id),
        ...(rapport.contexte ?? []).map((c) => c.id),
        ...decisionsVue.keys(),
      ]),
      liens: [...liens.values()],
      /* ANALYSÉS et CONTEXTE, séparés dès le serveur — la carte n'ajoute rien
         d'autre. Les postes dont la suppression est simulée restent désignés,
         pour porter leur repère « suppression proposée ». */
      analysesIds: new Set([...tous.map((b) => b.id), ...decisionsVue.keys()]),
      contexte: (rapportSimule ?? rapport).contexte ?? [],
      /* LES DÉCISIONS SIMULÉES — voir DecisionsSimuleesLayer et les bulles. */
      decisionsSimulees: decisionsVue,
      decider: deciderSimulation,
      decisionEnCours,
      seuilDeplacementKm: rapportSimule?.simulation?.seuilDeplacementKm ?? null,
      filtres: filtresVue,
      /* « Pourquoi ? » : la mesure initiale de chaque poste en conflit. */
      explications: new Map(
        (lignes ?? []).filter((b) => b.sousLeSeuil).map((b) => [b.id, {
          nom: `${b.id} — ${b.nom || b.id}`, distanceKm: b.distanceKm,
          seuilKm: rapport.parametres?.distanceMinKm ?? null,
          voisinNom: b.voisin?.nom || b.voisin?.id || null,
          seuilDeplacementKm: rapportSimule?.simulation?.seuilDeplacementKm ?? null,
        }]),
      ),
      ...vueManuelle,
      conflitsIdentifies: modeleConflits.conflits,
      contexteIds: new Set((rapport.contexte ?? []).map((c) => c.id)),
      /* Tout barrage en conflit, d'après la mesure du serveur — voir conflitsManuels. */
      mode: 'manuel',
      conflits: conflitsManuels(lignes, rapport, rapportSimule, decisionsVue),
      seuilKm: rapport.parametres?.distanceMinKm ?? null,
      /**
       * LE PÉRIMÈTRE RÉELLEMENT CALCULÉ — pour que le résumé de la carte compte
       * sur le même ensemble que ce panneau, et non sur ce qui traîne à l'écran.
       *
       * Il vient de `parametres`, donc du serveur : ce sont les valeurs qui ont
       * SERVI au calcul, pas celles que les boutons affichent maintenant.
       */
      perimetre: {
        niveau: rapport.parametres?.niveau ?? 'national',
        unite: rapport.parametres?.unite ?? null,
      },
      /**
       * LA SYNTHÈSE, dérivée du MÊME rapport que les listes ci-dessous.
       *
       * Elle voyage sur le canal qui existe déjà plutôt que par un second
       * chemin : deux publications du même calcul finiraient par se désaccorder
       * d'un rendu, et l'on verrait la synthèse d'une optimisation à côté du
       * détail de la précédente. Voir `statistiquesOptimisation` — ce champ ne
       * contient que des comptes, aucune décision.
       */
      situation,
      /* Ce que la bulle affichera : la distance mesurée et le seuil demandé. */
      /**
       * LES CARACTÉRISTIQUES À MONTRER SUR LA CARTE, par identifiant.
       *
       * Sur TOUS les postes examinés, pas seulement ceux sous le seuil : un
       * barrage conforme peut très bien relever huit accidents, et c'est une
       * chose que le chef doit voir. L'alerte de distance et ces badges
       * répondent à deux questions différentes et ne se remplacent jamais.
       *
       * Un paramètre éteint envoie `null` : le badge ne se pose pas, plutôt que
       * de se poser en gris pour dire « non demandé ».
       */
      badges: new Map(
        tous
          .filter(
            (b) =>
              b.accidentAnormal ||
              b.vip ||
              b.nonEclaire ||
              (b.positionVille && b.positionVille !== 'none')
          )
          .map((b) => [
            b.id,
            {
              accident: b.accidentAnormal === true,
              accidents: b.accidents,
              vip: b.vip === true,
              nonEclaire: b.nonEclaire === true,
              positionVille: b.positionVille ?? 'none',
            },
          ])
      ),
      /**
       * LES POSTES EXCLUS, ET POURQUOI — pour le repère « 🔒 » de la carte.
       *
       * Un poste exclu reste visible et cliquable, mais sa bulle ne pose aucune
       * question : elle explique. D'où une carte séparée de `motifs`, qui est
       * celle des postes à trancher.
       */
      /**
       * Le cadenas ne se pose PAS sur un poste qui porte déjà une décision.
       *
       * « ✓ » et « ✗ » viennent du dépôt (voir DecisionsLayer) et disent un
       * acte réellement consigné : ils l'emportent sur le cadenas, qui ne dit
       * qu'un état de calcul. Sans cette réserve, les deux repères se
       * superposeraient au pixel près — et deux symboles empilés ne se lisent
       * plus. La ligne du panneau, elle, reste dans la liste des intouchables.
       */
      protegesIds: new Set(proteges.filter((b) => b.decision === 'aucune').map((b) => b.id)),
      exclusions: new Map(
        proteges.map((b) => [
          b.id,
          {
            protections: b.protections ?? [],
            accidents: b.accidents,
            distanceKm: b.distanceKm,
            seuilKm: rapport.parametres?.distanceMinKm ?? null,
            seuilAccidents: rapport.parametres?.seuilAccidents ?? null,
            voisinNom: b.voisin?.nom ?? '',
          },
        ])
      ),
      /* Le motif accompagne le repère « ? » : sans repère, pas de motif à
         afficher — d'où `negociables` et non `sous`. */
      motifs: new Map(
        negociables.map((b) => [
          b.id,
          {
            texte: b.voisin?.nom
              ? `${b.distanceKm} km de « ${b.voisin.nom} »`
              : `${b.distanceKm} km de son voisin`,
            seuil: rapport.parametres?.distanceMinKm ?? null,
            /* CE QUE LA NOTIFICATION EMPORTERA. Figé ici, au moment du calcul :
               le commandant doit lire les chiffres sur lesquels la décision a
               été prise, pas ceux d'un calcul ultérieur. */
            criteres: {
              distanceKm: b.distanceKm,
              seuilKm: rapport.parametres?.distanceMinKm ?? null,
              voisinNom: b.voisin?.nom ?? '',
              accidents: b.accidents,
              vip: b.vip,
              nonEclaire: b.nonEclaire,
            },
          },
        ])
      ),
    });
    /* `situation` dans les dépendances : l'effet la PUBLIE, et la carte s'en
       sert pour son cartouche. Elle dérive certes de `lignes` et `rapport`,
       mais l'écrire évite qu'un changement de sa dérivation laisse un jour ce
       résumé figé sans que rien ne le signale. */
  }, [
    modeOptimisation,
    rapportAuto,
    selectionAuto,
    apercuAuto,
    items,
    niveau,
    unite,
    lignes,
    rapport,
    situation,
    onResultatsChange,
    rapportSimule,
    decisionsVue,
    deciderSimulation,
    decisionEnCours,
    filtresVue,
  ]);

  /**
   * LES ONGLETS DE LA CARTE — Distance, Les accidents, Barage VIP, L'éclairage.
   *
   * Aucun calcul nouveau : chaque onglet passe par `generer`, donc par la même
   * route `consolidation` que le bouton « Générer » de ce panneau. Distance est
   * la mesure de base ; les trois autres sont les interrupteurs de l'étape 3
   * (`accidents`, `vip`, `nonEclaire`), qui s'ajoutent à cette mesure.
   *
   * L'ÉTAT « ACTIF » VIENT DU SERVEUR, jamais du clic : il se lit dans
   * `rapport.parametres`, que la route renvoie tels qu'APPLIQUÉS. Un onglet
   * n'est donc jamais marqué actif avant que son calcul ait abouti.
   *
   * CLIQUER UN ONGLET OUVRE SA CONFIGURATION, IL NE LANCE RIEN. Le calcul part
   * de « Lancer l'optimisation », avec les valeurs de la boîte.
   *
   * Chaque onglet garde SA configuration (`configsOnglets`), initialisée à sa
   * première ouverture depuis le contexte de la carte, puis conservée telle
   * que l'utilisateur l'a laissée. Lancer un onglet n'écrit dans celle d'aucun
   * autre.
   *
   * Lancer garde les critères déjà appliqués : on ajoute, on ne remplace pas.
   * « Désactiver » refait le même calcul sans lui. Un échec laisse le
   * résultat précédent en place.
   */
  const [ongletsEnCours, setOngletsEnCours] = useState(() => new Set());
  const [erreursOnglets, setErreursOnglets] = useState({});
  const ongletVerrou = useRef(false);
  const [dialogueOnglet, setDialogueOnglet] = useState(null);
  const [configsOnglets, setConfigsOnglets] = useState({});
  const [validationOnglet, setValidationOnglet] = useState(null);

  /**
   * LES VALEURS PAR DÉFAUT — lues dans l'état de la carte, à l'ouverture.
   *
   *   Territoire  le choix explicite fait dans le panneau (« Choisir un autre
   *               périmètre ») s'il existe ; sinon la portée de la carte (la
   *               région, compagnie ou brigade où l'on est descendu) ; sinon le
   *               périmètre du rang ; sinon tout le pays. C'est la même
   *               dérivation que `niveau`/`unite`, SANS la portée figée du
   *               dernier résultat : un changement de région sur la carte
   *               avant la première ouverture est donc pris en compte.
   *   Distance    la distance courante (celle de la carte et du panneau).
   *   Faction     la faction que la carte optimise (filtre « Faction »).
   *   Seuil       celui du dernier calcul appliqué, sinon celui du panneau.
   */
  const configParDefaut = (cle) => {
    const contexte = autrePerimetre
      ? { niveau: niveauChoisi, unite: uniteChoisie }
      : (porteeCourante ?? impose ?? { niveau: 'national', unite: '' });
    const config = {
      niveau: contexte.niveau ?? 'national',
      unite: contexte.niveau === 'national' ? '' : (contexte.unite ?? ''),
      distance: String(distance),
      factionId: factionChoisie || 'toutes',
    };
    if (cle === 'accidents') {
      const appliqueSeuil = modeOptimisation === 'manuel' ? rapport?.parametres?.seuilAccidents : null;
      config.seuilAccidents = Number.isFinite(Number(appliqueSeuil)) ? Number(appliqueSeuil) : seuilAccidents;
    }
    return config;
  };

  const ouvrirOnglet = (cle) => {
    if (!ONGLETS_OPTIMISATION.some((o) => o.cle === cle)) return;
    setConfigsOnglets((cur) => (cur[cle] ? cur : { ...cur, [cle]: configParDefaut(cle) }));
    setValidationOnglet(null);
    setDialogueOnglet(cle);
  };
  const ouvrirOngletRef = useRef(ouvrirOnglet);
  ouvrirOngletRef.current = ouvrirOnglet;

  const modifierConfigOnglet = useCallback((cle, champs) => {
    setValidationOnglet(null);
    setConfigsOnglets((cur) => ({ ...cur, [cle]: { ...cur[cle], ...champs } }));
  }, []);

  /** Retourne un message si la configuration ne peut pas partir, sinon `null`. */
  const validerConfigOnglet = (cle, config) => {
    const km = Number(String(config?.distance ?? '').replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0) return 'Indiquez une distance en kilomètres, supérieure à 0.';
    if (config.niveau !== 'national' && !config.unite && impose?.niveau !== 'brigade') {
      return `Choisissez ${config.niveau === 'region' ? 'la région' : config.niveau === 'compagnie' ? 'la compagnie' : 'la brigade'} à analyser, ou repassez sur « Tout le pays ».`;
    }
    if (cle === 'accidents') {
      const n = Number(config.seuilAccidents);
      if (!Number.isInteger(n) || n < 0 || n > 50) return 'Le seuil d’accidents doit être un nombre entier de 0 à 50.';
    }
    return null;
  };

  /**
   * LANCE UN ONGLET avec une configuration — celle de sa boîte, ou celle
   * enregistrée lors d'une restauration. Renvoie `true` si le calcul a abouti.
   */
  const activerOnglet = async (cle, { config, retirer = false, restauration = null }) => {
    if (!ONGLETS_OPTIMISATION.some((o) => o.cle === cle)) return false;
    /* Un seul calcul à la fois : tous les onglets partagent la même mesure. */
    if (ongletVerrou.current || occupe) return false;
    ongletVerrou.current = true;

    const p = modeOptimisation === 'manuel' ? rapport?.parametres : null;
    /* Sans résultat, on part des interrupteurs du panneau : un réglage fait
       dans l'Optimisation n'est pas perdu parce qu'on passe par un onglet. */
    const base = restauration ?? (p
      ? { accidents: p.accidents === true, vip: p.vip === true, nonEclaire: p.nonEclaire === true, seuilAccidents: p.seuilAccidents ?? seuilAccidents }
      : { accidents, vip, nonEclaire, seuilAccidents });
    const criteres = {
      accidents: base.accidents === true,
      vip: base.vip === true,
      nonEclaire: base.nonEclaire === true,
      seuilAccidents: Number.isFinite(Number(base.seuilAccidents)) ? Number(base.seuilAccidents) : seuilAccidents,
    };
    const champ = ONGLETS_OPTIMISATION.find((o) => o.cle === cle).critere;
    if (champ && !restauration) criteres[champ] = !retirer;
    /* Seul l'onglet « Les accidents » règle le seuil : lancer un autre onglet le laisse tel qu'appliqué. */
    if (cle === 'accidents' && !restauration && Number.isInteger(Number(config.seuilAccidents))) {
      criteres.seuilAccidents = Number(config.seuilAccidents);
    }

    const concernes = restauration
      ? ONGLETS_OPTIMISATION.filter((o) => !o.critere || criteres[o.critere]).map((o) => o.cle)
      : [cle];
    setOngletsEnCours(new Set(concernes));
    setErreursOnglets((cur) => {
      const suivant = { ...cur };
      for (const c of concernes) delete suivant[c];
      return suivant;
    });

    const distKm = String(config.distance).replace(',', '.');
    const fId = config.factionId || 'toutes';
    const perimetre =
      impose?.niveau === 'brigade'
        ? { niveau: impose.niveau, unite: impose.unite }
        : { niveau: config.niveau ?? 'national', unite: config.niveau === 'national' ? '' : (config.unite ?? '') };
    if (modeOptimisation !== 'manuel') setModeOptimisation('manuel');

    let message = null;
    try {
      const r = await generer(distKm, fId, {
        criteres,
        perimetre,
        conserverSurErreur: true,
        sansCadrage: Boolean(restauration),
        surErreur: (m) => {
          message = m;
        },
      });
      if (r?.parametres) {
        /* Le panneau reprend ce qui a RÉELLEMENT servi : interrupteurs,
           distance, faction, et le périmètre (figé par le résultat). */
        setAccidents(r.parametres.accidents === true);
        setVip(r.parametres.vip === true);
        setNonEclaire(r.parametres.nonEclaire === true);
        if (Number.isFinite(Number(r.parametres.seuilAccidents))) setSeuilAccidents(Number(r.parametres.seuilAccidents));
        if (distKm !== distance) changerDistance(distKm);
        if (fId !== factionChoisie) {
          setFactionChoisie(fId);
          onFactionChange?.(fId);
        }
        setAutrePerimetre(false);
        const idx = indiceDe(etapesRef.current ?? [], 'decision');
        setEtape(idx >= 0 ? idx : 3);
        return true;
      }
      const texte = message ?? 'Le calcul n’a rien renvoyé.';
      setErreursOnglets((cur) => ({ ...cur, ...Object.fromEntries(concernes.map((c) => [c, texte])) }));
      return false;
    } finally {
      ongletVerrou.current = false;
      setOngletsEnCours(new Set());
    }
  };
  const activerOngletRef = useRef(activerOnglet);
  activerOngletRef.current = activerOnglet;

  /**
   * DÉSACTIVER UN ONGLET — bouton « × » de la barre, ou « Désactiver » de la boîte.
   *
   * Un critère (accidents, VIP, éclairage) : le MÊME calcul est refait sans
   * lui, sur la mesure appliquée — jamais sur les valeurs en cours de saisie
   * dans la boîte, qui changeraient le territoire ou la distance au passage.
   *
   * Distance : c'est la mesure elle-même, les critères n'existent que sur elle.
   * La désactiver efface donc le résultat, par la même remise à zéro que
   * « Réinitialiser » (rien n'est écrit), et éteint les interrupteurs — sans
   * quoi le prochain calcul les rallumerait en silence.
   */
  const desactiverOnglet = async (cle) => {
    const p = modeOptimisation === 'manuel' ? rapport?.parametres : null;
    if (!p || ongletVerrou.current || occupe) return false;
    if (cle === 'distance') {
      reinitialiserOptimisation();
      setAccidents(false);
      setVip(false);
      setNonEclaire(false);
      setErreursOnglets({});
      return true;
    }
    return activerOngletRef.current(cle, {
      retirer: true,
      config: {
        niveau: p.niveau ?? 'national',
        unite: p.unite ?? '',
        distance: String(p.distanceMinKm),
        factionId: p.factionId ?? factionChoisie,
      },
    });
  };
  const desactiverOngletRef = useRef(desactiverOnglet);
  desactiverOngletRef.current = desactiverOnglet;

  /** « Lancer l'optimisation » depuis la boîte. */
  const lancerDepuisDialogue = async () => {
    const cle = dialogueOnglet;
    const config = configsOnglets[cle];
    const invalide = validerConfigOnglet(cle, config);
    if (invalide) {
      setValidationOnglet(invalide);
      return;
    }
    const ok = await activerOngletRef.current(cle, { config });
    /* Succès : la boîte se ferme, le résultat est sur la carte. Échec : elle
       reste ouverte, avec le message et les réglages intacts. */
    if (ok) setDialogueOnglet((d) => (d === cle ? null : d));
  };

  const desactiverDepuisDialogue = async () => {
    const cle = dialogueOnglet;
    const ok = await desactiverOngletRef.current(cle);
    if (ok) setDialogueOnglet((d) => (d === cle ? null : d));
  };

  useEffect(() => {
    onEnregistrerOnglets?.({
      ouvrir: (cle) => ouvrirOngletRef.current(cle),
      desactiver: (cle) => desactiverOngletRef.current(cle),
    });
  }, [onEnregistrerOnglets]);

  const parametresAppliques = modeOptimisation === 'manuel' ? (rapport?.parametres ?? null) : null;
  const etatsOnglets = useMemo(
    () =>
      ONGLETS_OPTIMISATION.map((o) => {
        const actif = Boolean(parametresAppliques) && (!o.critere || parametresAppliques[o.critere] === true);
        /* Un calcul lancé depuis le panneau (ou la carte) refait la mesure de base. */
        const enCours = ongletsEnCours.has(o.cle) || (occupe && !ongletsEnCours.size && o.cle === 'distance');
        return {
          cle: o.cle,
          libelle: o.libelle,
          statut: enCours ? 'optimizing' : erreursOnglets[o.cle] ? 'error' : actif ? 'active' : 'idle',
          erreur: erreursOnglets[o.cle] ?? null,
          verrouille: occupe || ongletsEnCours.size > 0,
          ouvert: dialogueOnglet === o.cle,
        };
      }),
    [parametresAppliques, ongletsEnCours, occupe, erreursOnglets, dialogueOnglet],
  );
  useEffect(() => {
    onOngletsChange?.(etatsOnglets);
  }, [etatsOnglets, onOngletsChange]);

  /**
   * PERSISTANCE — les critères APPLIQUÉS, jamais un clic.
   *
   * On enregistre ce que le serveur a renvoyé dans `parametres`, par compte.
   * Au rechargement, rien n'est affiché comme actif d'office : le calcul est
   * REFAIT avec ces paramètres, et c'est son succès qui rallume les onglets.
   * L'enregistrement disparaît quand le résultat est effacé (Réinitialiser,
   * restauration de présentation…), pas quand un onglet échoue.
   */
  const cleOnglets = `gr-optimisation-onglets:${session?.matricule ?? ''}`;
  const rapportOngletsPrecedent = useRef(null);
  useEffect(() => {
    const avant = rapportOngletsPrecedent.current;
    rapportOngletsPrecedent.current = rapport;
    if (!session?.matricule) return;
    const p = rapport?.parametres;
    try {
      if (p) {
        localStorage.setItem(
          cleOnglets,
          JSON.stringify({
            distanceMinKm: p.distanceMinKm,
            accidents: p.accidents === true,
            seuilAccidents: p.seuilAccidents,
            vip: p.vip === true,
            nonEclaire: p.nonEclaire === true,
            niveau: p.niveau ?? 'national',
            unite: p.unite ?? null,
            factionId: p.factionId ?? null,
          }),
        );
      } else if (avant) {
        localStorage.removeItem(cleOnglets);
      }
    } catch {
      /* Stockage indisponible (navigation privée…) : les onglets marchent, sans mémoire. */
    }
  }, [rapport, cleOnglets, session?.matricule]);

  /* À la connexion, la distance démarre toujours désactivée (aucun calcul automatique au login). */
  const restaurationOngletsFaite = useRef(false);
  useEffect(() => {
    if (restaurationOngletsFaite.current || !session?.matricule || rapport) return;
    restaurationOngletsFaite.current = true;
    try {
      localStorage.removeItem(cleOnglets);
    } catch {
      /* ignore */
    }
  }, [session?.matricule, cleOnglets, rapport]);

  /* La boîte de configuration — en portail, comme les modales du projet : le
     panneau vit dans un conteneur qui porte un `zoom`, et elle doit s'afficher
     panneau ouvert ou replié. */
  const ongletOuvert = ONGLETS_OPTIMISATION.find((o) => o.cle === dialogueOnglet) ?? null;
  const etatOngletOuvert = etatsOnglets.find((o) => o.cle === dialogueOnglet) ?? null;
  const dialogue =
    ongletOuvert && configsOnglets[ongletOuvert.cle] && typeof document !== 'undefined'
      ? createPortal(
          <DialogueOnglet
            onglet={ongletOuvert}
            config={configsOnglets[ongletOuvert.cle]}
            onConfig={(champs) => modifierConfigOnglet(ongletOuvert.cle, champs)}
            applique={parametresAppliques}
            impose={impose}
            unites={unites}
            factions={factions}
            items={items}
            statut={etatOngletOuvert?.statut}
            erreur={etatOngletOuvert?.erreur}
            validation={validationOnglet}
            calculAilleurs={Boolean(etatOngletOuvert?.verrouille) && etatOngletOuvert?.statut !== 'optimizing'}
            onAnnuler={() => {
              setValidationOnglet(null);
              setDialogueOnglet(null);
            }}
            onLancer={() => lancerDepuisDialogue()}
            onDesactiver={desactiverDepuisDialogue}
          />,
          document.body,
        )
      : null;

  /**
   * LE PANNEAU REPLIÉ NE REND RIEN — et cette sortie vient APRÈS tous les
   * crochets, jamais au milieu.
   *
   * Elle était placée plus haut, entre l'effet de publication et les valeurs
   * qu'il lit. Un rendu replié n'évaluait donc pas ces valeurs, et l'effet les
   * touchait quand même après le rendu : l'application tombait sur « Cannot
   * access 'proteges' before initialization ». Voir la note de cet effet, juste
   * au-dessus.
   *
   * La règle qui en découle : rien de ce qu'un crochet capture ne doit être
   * déclaré après une sortie conditionnelle. Le plus sûr est de n'en placer
   * aucune avant le dernier crochet.
   */
  /* Replié, le panneau ne rend que la boîte d'un onglet, si elle est ouverte. */
  if (!open) return dialogue;

  /**
   * LES RÉGLAGES ONT CHANGÉ DEPUIS LE CALCUL.
   *
   * Le rapport est une mesure DATÉE : il garde les réglages qui ont servi, et
   * c'est très bien ainsi. Mais les interrupteurs, eux, montrent l'état
   * courant : allumer « VIP » après un calcul laisserait donc à l'écran des
   * postes VIP encore proposés au retrait, sans que rien ne le dise.
   *
   * On ne vide pas la liste pour autant — perdre un résultat parce qu'on a
   * effleuré une bascule serait pire. On le dit, et le bouton Générer est juste
   * au-dessus.
   */
  /**
   * LE SERVEUR N'A PAS ÉTÉ REDÉMARRÉ.
   *
   * `serveur/api.mjs` est lu AU DÉMARRAGE du service : mettre à jour les
   * fichiers ne suffit pas, le processus doit être relancé. Un serveur resté sur
   * la version précédente répond sans les protections — sa réponse est par
   * ailleurs parfaitement valide, et le panneau la traite alors comme avant :
   * tous les postes sous le seuil reçoivent un « ? ».
   *
   * C'est exactement la panne que l'on ne doit PAS laisser silencieuse : elle
   * ressemble trait pour trait à « la fonctionnalité ne marche pas ». On la
   * reconnaît à l'absence de `seuilAccidents`, que toute version qui connaît les
   * protections renvoie toujours — même interrupteurs éteints.
   */
  const serveurSansProtections =
    Boolean(rapport?.parametres) && rapport.parametres.seuilAccidents === undefined;

  /**
   * SERVEUR D'UNE VERSION INTERMÉDIAIRE — LA CONTRADICTION SE VOIT DANS SA
   * PROPRE RÉPONSE.
   *
   * Le test ci-dessus ne suffit pas : un serveur peut renvoyer `seuilAccidents`
   * — donc passer pour à jour — et ignorer une protection ajoutée après. Les
   * sorties de ville, puis les VIP, sont arrivées dans cet ordre ; à chaque
   * fois le symptôme était le même, un badge « SORTIE » ou « VIP » à côté d'un
   * repère « ? », c'est-à-dire un poste que le serveur décrit comme protégeable
   * et propose quand même au retrait.
   *
   * Plutôt qu'un test par fonctionnalité, un SEUL invariant, vérifié sur les
   * quatre motifs : tout poste dont la réponse dit qu'il porte un caractère
   * protecteur DOIT être `intouchable`. Le code à jour ne produit jamais
   * l'inverse — d'où une détection exacte, et qui couvrira d'elle-même le
   * prochain motif ajouté.
   *
   * `vip` et `nonEclaire` valent `null` quand leur interrupteur est éteint : on
   * ne teste donc que `=== true`, jamais la simple présence du champ.
   */
  const PORTES = ['entree', 'sortie', 'porte'];
  const contradictions = Array.isArray(rapport?.barrages)
    ? rapport.barrages.filter(
        (b) =>
          b.intouchable !== true &&
          (b.vip === true || b.nonEclaire === true || PORTES.includes(b.positionVille))
      )
    : [];

  /** Ce que le serveur ignore, nommé — pour que le message soit utile. */
  const motifsIgnores = [
    contradictions.some((b) => PORTES.includes(b.positionVille)) && 'les portes de ville',
    contradictions.some((b) => b.vip === true) && 'les barrages VIP',
    contradictions.some((b) => b.nonEclaire === true) && 'les barrages non éclairés',
  ].filter(Boolean);

  const serveurPerime = serveurSansProtections || contradictions.length > 0;

  /**
   * CE QUI A CHANGÉ DEPUIS LE CALCUL — nommé, pas seulement signalé.
   *
   * « Les réglages ont changé » laisse chercher lesquels. Dire « Accidents est
   * passé à ON » va droit au malentendu : l'interrupteur est allumé sous les
   * yeux, et les chiffres affichés viennent d'un calcul qui l'ignorait.
   *
   * Le seuil n'est comparé que si l'interrupteur était allumé DES DEUX CÔTÉS :
   * sinon « Accidents ON » le dit déjà, et répéter « seuil 4 » ferait croire à
   * deux écarts là où il n'y en a qu'un.
   */
  const applique = rapport?.parametres;
  const ecarts = [];
  if (applique) {
    const kmCourant = Number(String(distance).replace(',', '.'));
    if (applique.distanceMinKm != null && applique.distanceMinKm !== kmCourant) {
      ecarts.push(`seuil ${kmCourant} km au lieu de ${applique.distanceMinKm} km`);
    }
    const factionRapport = applique.factionId || 'toutes';
    const factionVoulue = factionChoisie || 'toutes';
    if (factionRapport !== factionVoulue) {
      ecarts.push(`faction ${factionVoulue} au lieu de ${factionRapport}`);
    }
    if (applique.accidents !== accidents) ecarts.push(`Accidents ${accidents ? 'ON' : 'OFF'}`);
    else if (accidents && (applique.seuilAccidents ?? 0) !== seuilAccidents) {
      ecarts.push(`exclusion au-delà de ${seuilAccidents} accident(s)`);
    }
    if (applique.vip !== vip) ecarts.push(`Barrage VIP ${vip ? 'ON' : 'OFF'}`);
    if (applique.nonEclaire !== nonEclaire) ecarts.push(`Barrage non éclairé ${nonEclaire ? 'ON' : 'OFF'}`);
  }
  const reglagesModifies = ecarts.length > 0;

  /*
   * COMPTEURS RECALCULÉS ICI, pas recopiés du rapport.
   *
   * Le bilan du serveur vaut pour l'instant du calcul. Dès qu'un poste est
   * supprimé, il est faux d'une unité — et c'est justement après une décision
   * qu'on regarde les compteurs. Ils se déduisent donc des lignes réellement
   * affichées.
   */
  const bilan = {
    examines: barrages?.length ?? 0,
    aDecider: aDecider.length,
    intouchables: proteges.length,
    conserves: conserves.length,
    aSupprimer: aSupprimer.length,
  };

  /**
   * FAUT-IL (RE)CALCULER AVANT DE POUVOIR TRANCHER ?
   *
   * Oui s'il n'y a pas de rapport, oui aussi si les réglages ont bougé depuis
   * le dernier — trancher sur des chiffres périmés était le piège de l'ancien
   * panneau, qui affichait l'avertissement SOUS la grille du bilan, donc
   * souvent hors de l'écran.
   */
  const aBesoinDeCalcul = !rapport || reglagesModifies;

  const controlesOptimisation = (
    <ControlesDistanceEtFaction
      distance={distance}
      onDistanceChange={changerDistance}
      factionChoisie={factionChoisie}
      onFactionChange={changerFaction}
      factions={factions}
      items={items}
      rapport={rapport}
      rapportAuto={rapportAuto}
      modeOptimisation={modeOptimisation}
      onRecalculer={lancerRecalcul}
      chargement={occupe || calculAutoEnCours}
    />
  );

  /**
   * Le SUIVANT de l'étape 3 fait le calcul qu'il annonce, puis avance — mais
   * seulement s'il a abouti. Un échec laisse sur place, avec son message.
   */
  const calculerPuisAvancer = async () => {
    return await lancerRecalcul(distance, factionChoisie);
  };

  /**
   * LES CINQ ÉTAPES — le même parcours que partout ailleurs dans l'application.
   *
   * Le panneau montrait tout à la fois : périmètre, barrages spéciaux,
   * distance, trois interrupteurs, un seuil, deux boutons de lancement, un
   * bilan à cinq colonnes et quatre listes de postes. Dans un tiroir de
   * 352 px, il fallait faire défiler quatre écrans pour revoir ce qu'on venait
   * de régler.
   *
   * Découpage : on choisit CE QU'ON REGARDE, puis COMMENT on mesure, puis on
   * CALCULE, puis on TRANCHE poste par poste, puis on VÉRIFIE.
   *
   * AUCUNE RÈGLE N'A CHANGÉ. Les mêmes valeurs partent au même appel
   * (`generer`), les décisions restent celles de la carte (bulle du poste), et
   * l'étape 5 n'écrit rien : chaque retrait a déjà été notifié au commandant
   * au moment où il a été proposé. Il n'y a pas d'enregistrement groupé, et il
   * n'en a pas été inventé un.
   */
  const etapes = [
    /* ---------------- 1 — ce qu'on optimise ---------------- */
    {
      cle: 'perimetre',
      titre: 'Ce qu’on optimise',
      ar: 'النطاق',
      /* Ces deux phrases annonçaient « puis le type de postes à examiner » :
         ce choix n'existe plus (voir la note plus bas). Une aide qui promet un
         réglage absent fait chercher ce qui n'est pas là. */
      aide: autrePerimetre
        ? 'Choisissez le territoire à étudier. L’analyse porte sur tout son dispositif fixe.'
        : 'L’analyse porte sur le territoire que vous consultez, et sur tout son dispositif fixe.',
      valide: niveau === 'national' || Boolean(unite),
      empeche: 'Choisissez l’unité à analyser, ou repassez sur « Tout le pays ».',
      contenu: (
        <div className="space-y-4">
          {/* SÉLECTION DU MODE D'OPTIMISATION */}
          {/* LE MODE AUTOMATIQUE EST MASQUÉ — voir FILTRATION_AUTOMATIQUE_VISIBLE. */}
          {FILTRATION_AUTOMATIQUE_VISIBLE && (
          <div className="space-y-1.5 pb-2 border-b border-white/10">
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Mode d’optimisation
            </p>
            <Choix
              nom="Mode d’optimisation"
              colonnes={2}
              valeur={modeOptimisation}
              onChange={(m) => {
                setModeOptimisation(m);
                if (m === 'auto') {
                  setDistance('20');
                  onDistanceChangeProp?.('20');
                }
                setErreurAuto(null);
                setSuccesAuto(null);
              }}
              options={[
                {
                  cle: 'manuel',
                  libelle: 'Manuel',
                  ar: 'يدوي',
                  icone: IconTarget,
                },
                {
                  cle: 'auto',
                  libelle: 'Automatique',
                  ar: 'تلقائي',
                  icone: IconAssistant,
                },
              ]}
            />
            <p className="text-[10px] text-white/45 leading-snug">
              {modeOptimisation === 'manuel'
                ? 'Mode manuel : vous analysez et choisissez vous-même les décisions pour chaque barrage.'
                : 'Mode automatique : le système analyse l’ensemble du maillage selon vos critères et propose le retrait des barrages de plus faible priorité.'}
            </p>
          </div>
          )}

          {!autrePerimetre ? (
            /**
             * LA PORTÉE COURANTE, CONFIRMÉE — pas un calcul national par défaut.
             *
             * Ce qu'on optimise est ce qu'on regarde : la compagnie où l'on
             * vient de descendre, la brigade qu'on examine. « Suivant » vaut
             * « Continuer » ; le bouton en dessous ouvre le choix, dans les
             * limites du compte.
             */
            <div className="space-y-2.5">
              <Recap
                titre="Territoire étudié"
                lignes={[
                  {
                    libelle: niveau === 'national'
                      ? 'Tout le pays'
                      : LIBELLE_NIVEAU_IMPOSE[niveau] ?? 'Territoire',
                    valeur: unite || 'ensemble du territoire',
                    accent: true,
                  },
                  {
                    libelle: 'Déterminé par',
                    valeur: porteeCourante
                      ? 'votre navigation'
                      : impose
                        ? 'votre compte'
                        : 'aucune restriction',
                  },
                ]}
              />
              {/* Un chef de brigade n'a rien de plus fin à désigner, et rien
                  de plus large auquel il ait droit : le bouton ne lui
                  proposerait qu'un refus. */}
              {impose?.niveau !== 'brigade' && (
                <button
                  type="button"
                  onClick={() => {
                    setAutrePerimetre(true);
                    setNiveauChoisi(niveau);
                    setUniteChoisie(unite);
                    setRapport(null);
                  }}
                  className={`${bouton} w-full bg-white/8 py-2 text-white/75 hover:bg-white/14`}
                >
                  Choisir un autre périmètre
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <Choix
                nom="Territoire à étudier"
                colonnes={2}
                valeur={niveau}
                onChange={(cle) => {
                  setNiveauChoisi(cle);
                  setUniteChoisie('');
                  setRapport(null);
                  if (cle === 'national') onCadrerCirconscription?.('region', 'toutes');
                }}
                /* Voir `niveauxAutorises` : jamais plus large que le rang. */
                options={niveauxAutorises(impose)}
              />
              {niveau !== 'national' && (
                <UniteSelect
                  /* Voir `unitesAutorisees` : les seules unités du périmètre du compte. */
                  options={unitesAutorisees(unites, niveau, impose)}
                  value={unite}
                  onChange={(v) => {
                    setUniteChoisie(v);
                    setRapport(null);
                    onCadrerCirconscription?.(niveau, v);
                  }}
                  grouperPar={niveau === 'compagnie' ? 'reg' : niveau === 'brigade' ? 'cie' : null}
                  placeholderRecherche={RECHERCHE_UNITE[niveau]}
                />
              )}
            </div>
          )}

          {/*
            « POSTES À EXAMINER » A ÉTÉ RETIRÉ, ET NON MASQUÉ.

            Ce choix offrait trois options : tous les barrages fixes (le
            défaut), « Entrées de ville seulement », « Sorties de ville
            seulement ». Les deux dernières ne pouvaient rien produire d'utile.

            Une porte de ville est INTOUCHABLE par construction : `positionVille`
            valant `entree`, `sortie` ou `porte` place le poste parmi les
            protections, aux côtés des postes VIP et non éclairés (voir `PORTES`
            plus haut). Un poste protégé n'est jamais proposé au retrait — il
            porte un cadenas et aucune décision ne s'y applique.

            Restreindre le rapport à ces postes-là donnait donc une liste dont
            AUCUNE ligne n'était décidable : l'étape « Ce qu'on décide » se
            présentait vide, et l'utilisateur ne pouvait pas savoir si c'était
            parce que le dispositif était sain ou parce que son filtre excluait
            tout ce qui est décidable. Un réglage qui ne peut que tromper n'a
            pas à être proposé.

            Il ne reste donc qu'un cas, qui est le défaut : tout le dispositif
            fixe du périmètre. Un choix à une seule option n'est pas un choix —
            on retire le contrôle plutôt que de laisser une case unique déjà
            cochée, et `positionVille` part désormais à `null` (voir
            `lancerCalcul`).
          */}
        </div>
      ),
    },

    /* ---------------- 2 — comment on mesure ---------------- */
    {
      cle: 'mesure',
      titre: modeOptimisation === 'auto' ? 'La règle appliquée' : 'Distance et réglages',
      ar: modeOptimisation === 'auto' ? 'القاعدة المطبقة' : 'المسافة والمعايير',
      aide:
        modeOptimisation === 'auto'
          ? 'Le mode automatique n’a rien à régler : la règle est fixée, et le calcul la vérifie sur le réseau routier réel.'
          : 'Deux postes plus proches que cette distance sont considérés comme redondants. La distance est mesurée par la route, jamais à vol d’oiseau.',
      /**
       * EN AUTOMATIQUE, IL N'Y A RIEN À REMPLIR — donc rien à valider.
       *
       * Les réglages de cette étape (distance, accidents, VIP, éclairage) sont
       * ceux du mode MANUEL, et ils y restent entiers. Le mode automatique ne
       * les lit pas : sa règle est une heure de route entre deux postes tenus
       * en même temps, et elle ne se règle pas. Les afficher ici laisserait
       * croire qu'ils pèsent sur le calcul.
       */
      valide:
        modeOptimisation === 'auto' ? true : Number(String(distance).replace(',', '.')) > 0,
      empeche: 'Indiquez une distance en kilomètres, supérieure à 0.',
      contenu: modeOptimisation === 'auto' ? (
        <div className="space-y-3">
          <PerimetreAuto factionId={factionChoisie} perimetre={rapportAuto?.perimetre ?? perimetreAvantCalcul} />
          <div className="rounded-xl border border-gr-gold/30 bg-gr-gold/8 p-3 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gr-gold">
              Séparation opérationnelle — 20 km
            </p>
            <p className="text-[12px] leading-relaxed text-white/80">
              Deux barrages fixes doivent être séparés d’au moins{' '}
              <b className="text-gr-gold">20 km par la route</b> en mode automatique.
            </p>
            <ul className="space-y-1 pt-1 text-[11px] leading-snug text-white/65">
              <li className="flex gap-1.5">
                <span className="text-gr-gold">•</span>
                <span>
                  La distance est mesurée <b className="text-white/85">par le réseau routier</b>, jamais
                  à vol d’oiseau.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-gr-gold">•</span>
                <span>
                  La règle de 20 km est fixe : aucun réglage arbitraire n’est requis.
                </span>
              </li>
              <li className="flex gap-1.5">
                <span className="text-gr-gold">•</span>
                <span>
                  En cas de conflit, le serveur propose une position routière valide au barrage
                  normal le moins contraint. Les intouchables restent immobiles.
                </span>
              </li>
            </ul>
          </div>
          <Note>
            En mode automatique, la règle de 20 km est appliquée directement sur le réseau routier réel.
          </Note>
        </div>
      ) : (
        <div className="space-y-4">
          {controlesOptimisation}

          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-white/75">
              Joindre les accidents
              <span dir="rtl" className="ml-1.5 text-[11px] font-normal text-gr-gold/60">
                معطيات إضافية
              </span>
            </p>
            <Bascule
              actif={accidents}
              onChange={setAccidents}
              libelle="Compter les accidents de chaque poste"
              aide="Joint le nombre d’accidents relevés, et met hors de la décision les postes qui atteignent le seuil ci-dessous."
              icone={IconAccident}
            />
            {accidents && <SeuilAccidents valeur={seuilAccidents} onChange={setSeuilAccidents} />}
          </div>

          <div className="space-y-2">
            <p className="text-[12px] font-semibold text-white/75">
              Postes à ne jamais proposer au retrait
              <span dir="rtl" className="ml-1.5 text-[11px] font-normal text-gr-gold/60">
                حماية
              </span>
            </p>
            <Bascule
              actif={vip}
              onChange={setVip}
              libelle="Protéger les postes VIP"
              aide="Un poste sur un itinéraire officiel reste sous le seuil, mais ne sera jamais proposé au retrait."
              icone={IconVerrou}
            />
            <Bascule
              actif={nonEclaire}
              onChange={setNonEclaire}
              libelle="Protéger les postes non éclairés"
              aide="Retirer un poste sans éclairage laisse un tronçon aveugle la nuit."
              icone={IconVerrou}
            />
          </div>
        </div>
      ),
    },

    /* ---------------- 3 — les barrages concernés ---------------- */
    {
      cle: 'calcul',
      titre: modeOptimisation === 'auto' ? 'Optimisation automatique' : 'Les barrages concernés',
      ar: modeOptimisation === 'auto' ? 'الترشيد التلقائي' : 'الحواجز المعنية',
      carte: true,
      aide:
        modeOptimisation === 'auto'
          ? (rapportAuto
              ? 'Analyse automatique terminée. Consultez le résumé et les propositions ci-dessous.'
              : 'L’analyse automatique évalue les scores de maintien selon vos critères et identifie les barrages de priorité faible.')
          : (aBesoinDeCalcul
              ? 'Le calcul mesure, par la route, la distance de chaque poste à son voisin le plus proche. Il n’écrit rien.'
              : 'Voici ce que la mesure a trouvé. La carte porte un repère sur chaque poste concerné.'),
      valide: modeOptimisation === 'auto' ? Boolean(rapportAuto) : (Boolean(rapport) && !reglagesModifies),
      empeche:
        modeOptimisation === 'auto'
          ? 'Lancez l’optimisation automatique pour analyser le territoire.'
          : (rapport
              ? 'Vos réglages ont changé depuis ce calcul : refaites-le avant de trancher.'
              : 'Lancez le calcul pour voir les barrages concernés.'),
      libelleSuivant:
        modeOptimisation === 'auto'
          ? (rapportAuto ? 'SUIVANT' : 'OPTIMISER')
          : (aBesoinDeCalcul ? 'CALCULER' : 'SUIVANT'),
      onSuivant:
        modeOptimisation === 'auto'
          ? (!rapportAuto ? calculerPuisAvancer : undefined)
          : (aBesoinDeCalcul ? calculerPuisAvancer : undefined),
      contenu: modeOptimisation === 'auto' ? (
        <div className="space-y-3">
          {erreurAuto && <Note ton="alerte">{erreurAuto}</Note>}
          {succesAuto && (
            <p className="rounded-lg border border-gr-green/25 bg-gr-green/10 px-3 py-2.5 text-[11.5px] leading-snug text-gr-green">
              {succesAuto}
            </p>
          )}

          {/**
            * AUCUN SEUIL À RÉGLER — ET C'EST LE POINT.
            *
            * Deux champs se trouvaient ici : « Réduction maximale (%) » et
            * « Perte de couverture max. (pts) ». Ils ont été RETIRÉS. Ils
            * demandaient au commandement deux chiffres que rien, dans le
            * métier, ne permet de justifier — et ces chiffres décidaient
            * pourtant combien de postes tombaient.
            *
            * L'analyse ne vise donc plus aucun nombre : elle propose ce qui est
            * réellement redondant au vu des données, et le compte est ce qui en
            * ressort. Les seuls réglages restants sont ceux du parcours, qui
            * servent AUSSI au mode manuel : la distance de rapprochement et les
            * bascules de protection.
            */}

          {exclusAuto.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-[10.5px] text-white/65">
              <span>
                {exclusAuto.size} barrage(s) écarté(s) de cette optimisation par vos soins.
              </span>
              <button
                type="button"
                onClick={() => {
                  const vide = new Set();
                  setExclusAuto(vide);
                  lancerCalculAuto(vide);
                }}
                className="font-semibold text-gr-gold hover:underline"
              >
                Tout réintégrer
              </button>
            </div>
          )}

          <PerimetreAuto factionId={factionChoisie} perimetre={rapportAuto?.perimetre ?? perimetreAvantCalcul} />

          {blocSynthese}
          {reinitialisation}

          <button
            type="button"
            onClick={() => lancerCalculAuto()}
            disabled={calculAutoEnCours}
            className={`${bouton} w-full bg-gr-gold text-gr-navy font-bold py-2.5 hover:brightness-110 shadow-md`}
          >
            {calculAutoEnCours ? <IconSpinner size={14} /> : <IconAssistant size={14} />}
            <span>
              {calculAutoEnCours
                ? 'Analyse automatique en cours…'
                : rapportAuto
                  ? 'Relancer l’optimisation automatique'
                  : 'Lancer l’optimisation automatique'}
            </span>
          </button>

          {!rapportAuto ? (
            <Vide>
              Rien n’a encore été analysé en mode automatique.
              <br />
              Appuyez sur <b className="text-gr-gold">Lancer l’optimisation automatique</b> ci-dessus.
            </Vide>
          ) : (
            <ResumeOptimisationAuto
              rapport={rapportAuto}
              onCadrer={onCadrer}
              onAppliquer={appliquerAuto}
              applicationEnCours={applicationAutoEnCours}
              selection={selectionAuto}
              onBasculerSelection={basculerSelection}
              onToutAccepter={toutAccepter}
              onToutRefuser={toutRefuser}
              apercu={apercuAuto}
              onBasculerApercu={() => setApercuAuto((v) => !v)}
              onAnnuler={annulerAuto}
              gesteEnCours={gesteAuto}
              calculEnCours={calculAutoEnCours}
              detailsCle={detailsCle}
            />
          )}
          {rapportAuto && (
            <ListeConflits conflits={conflitsIdentifies} vise={conflitVise} onViser={onViserConflit} seuilKm={rapportAuto.seuilKm} />
          )}
          <ListeIntouchables barrages={barragesIntouchables} onCadrer={onCadrer} factionActuelle={factionActuelle} />
        </div>
      ) : (
        <div className="space-y-3">
          {serveurPerime && (
            <Note ton="alerte">
              {serveurSansProtections ? (
                <>
                  <b>Les protections ne sont pas appliquées.</b> Ce serveur répond encore sans
                  elles : aucun poste n’est exclu, et tous ceux qui sont sous le seuil portent un
                  « ? », y compris les portes de ville et les postes très accidentés.
                </>
              ) : (
                <>
                  <b>Ce serveur ne protège pas encore {motifsIgnores.join(', ')}.</b>{' '}
                  {contradictions.length} poste(s) portent donc un « ? » au lieu d’un cadenas, alors
                  qu’ils ne devraient jamais être proposés au retrait.
                </>
              )}
              <br />
              Le service lit son code au démarrage : <b>relancez-le</b>, puis refaites le calcul.
            </Note>
          )}

          {reponseInattendue && (
            <Note ton="alerte">
              <b>Ce serveur a répondu sans la liste des postes.</b> Le calcul a abouti mais sa
              réponse n’a pas la forme attendue : il n’y a donc rien à trancher. Relancez le
              service, puis refaites le calcul.
            </Note>
          )}

          {blocSynthese}
          {reinitialisation}

          {!rapport ? (
            <Vide>
              Rien n’a encore été mesuré sur ce périmètre.
              <br />
              Appuyez sur <b className="text-gr-gold">CALCULER</b>, en bas.
            </Vide>
          ) : (
            <>
              {reglagesModifies && (
                <Note ton="alerte">
                  <b>Ces chiffres datent d’avant votre dernier réglage.</b> Depuis ce calcul :{' '}
                  <b>{ecarts.join(', ')}</b>.
                </Note>
              )}

              <PerimetreManuel perimetre={rapport.perimetre} />

              <ListeConflits
                conflits={conflitsIdentifies}
                vise={conflitVise}
                onViser={onViserConflit}
                seuilKm={rapport.parametres?.distanceMinKm}
              />

              <Recap
                titre={`Mesure — ${rapport.parametres?.distanceMinKm} km · ${
                  rapport.parametres?.unite ?? 'tout le pays'
                }`}
                lignes={[
                  { libelle: 'Postes examinés', valeur: bilan.examines },
                  {
                    libelle: 'Sous le seuil, à trancher',
                    valeur: bilan.aDecider,
                    accent: bilan.aDecider > 0,
                  },
                  { libelle: 'Sous le seuil mais intouchables', valeur: bilan.intouchables || null },
                  { libelle: 'Déjà maintenus', valeur: bilan.conserves || null },
                  { libelle: 'Retraits déjà proposés', valeur: bilan.aSupprimer || null },
                ]}
              />

              {/**
                * LE RÉSULTAT DE L'OPTIMISATION, PAR CRITÈRE.
                *
                * Ces chiffres vivaient dans un cartouche flottant sur la
                * carte. Ils sont revenus ICI, dans la zone de résultat du
                * panneau : c'est là qu'on lit le calcul, et un chiffre posé
                * ailleurs qu'à côté de ce qu'il commente oblige à faire
                * l'aller-retour.
                *
                * Ils ne sont pas recalculés : `statistiquesOptimisation` COMPTE
                * les verdicts déjà rendus par le serveur (voir
                * src/statistiquesOptimisation.js). Un même poste peut relever
                * de plusieurs critères — les lignes ne s'additionnent donc pas,
                * et le total distinct est établi sur les identifiants, jamais
                * par une somme.
                */}
              {situation && (
                <div className="rounded-xl border border-white/12 bg-white/4 px-3 py-2.5">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gr-gold/80">
                    Résultat de l’optimisation
                  </p>
                  <ul className="space-y-1">
                    {situation.criteres.map((c) => (
                      <li key={c.cle} className="flex items-baseline gap-2">
                        <span aria-hidden className="w-4 shrink-0 text-center text-[11px] leading-none">
                          {c.emoji}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-white/70">
                          {c.libelle}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[12.5px] font-bold tabular-nums ${
                            c.nombre > 0 ? 'text-white/90' : 'text-white/30'
                          }`}
                        >
                          {c.nombre}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 flex items-baseline gap-2 border-t border-white/10 pt-1.5">
                    <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/45">
                      Barrages concernés
                    </span>
                    <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-gr-gold">
                      {situation.concernes}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-white/35">
                    postes distincts — un poste touché par plusieurs critères n’est compté qu’une
                    fois
                  </p>
                </div>
              )}

              {rapport.parametres?.accidents && (
                <Note>
                  Accidents joints à tous les postes ; ceux qui comptent{' '}
                  <b className="text-white/80">{rapport.parametres.seuilAccidents}</b> accident(s) ou
                  plus sont mis hors de la décision.
                </Note>
              )}

              {sous.length === 0 && (
                <p className="rounded-lg border border-gr-green/25 bg-gr-green/10 px-3 py-2.5 text-[11.5px] leading-snug text-gr-green">
                  Aucun barrage à moins de {rapport.parametres?.distanceMinKm} km de son voisin sur
                  ce périmètre. Le maillage est conforme au seuil demandé.
                </p>
              )}

              <button
                type="button"
                onClick={calculerPuisAvancer}
                disabled={occupe}
                className={`${bouton} w-full bg-white/8 py-2.5 text-white/75 hover:bg-white/14`}
              >
                {occupe ? <IconSpinner size={14} /> : <IconTarget size={14} />}
                Refaire le calcul
              </button>

              {assistantDisponible && (
                <>
                  <button
                    type="button"
                    onClick={analyserParAgent}
                    disabled={analyseEnCours}
                    className={`${bouton} w-full border border-gr-gold/45 bg-gr-gold/12 py-2.5 text-gr-gold hover:bg-gr-gold/20`}
                  >
                    {analyseEnCours ? <IconSpinner size={14} /> : <IconAssistant size={14} />}
                    {analyseEnCours ? 'Analyse en cours…' : 'Demander l’avis de l’agent IA'}
                  </button>
                  {analyseErreur && <Note ton="alerte">{analyseErreur}</Note>}
                  {analyse?.texte && (
                    <div className="rounded-xl border border-gr-gold/25 bg-gr-gold/8 px-3 py-2.5">
                      <p className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-gr-gold/70">
                        {analyse.source}
                        {analyse.modele ? ` · ${analyse.modele}` : ''}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-white/80">
                        {analyse.texte}
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      ),
    },

    /* ---------------- 4 — trancher poste par poste ---------------- */
    {
      cle: 'decision',
      titre: modeOptimisation === 'auto' ? 'Barrages retirés & décisions' : 'Conserver ou retirer',
      ar: modeOptimisation === 'auto' ? 'الحواجز المسحوبة والقرارات' : 'الإبقاء أو السحب',
      carte: true,
      aide:
        modeOptimisation === 'auto'
          ? 'Consultez les barrages retirés par optimisation et restaurez-les si nécessaire.'
          : (aDecider.length > 0
            ? 'Cliquez un poste ci-dessous pour le voir sur la carte, puis tranchez depuis sa bulle. Rien n’est effacé : le commandant concerné est notifié et décide.'
            : 'Rien ne reste à trancher sur ce périmètre.'),
      valide: true,
      contenu: modeOptimisation === 'auto' ? (
        <div className="space-y-3">
          {blocSynthese}
          {reinitialisation}
          {blocJournal}
          {erreurAuto && <Note ton="alerte">{erreurAuto}</Note>}
          {succesAuto && (
            <p className="rounded-lg border border-gr-green/25 bg-gr-green/10 px-3 py-2.5 text-[11.5px] leading-snug text-gr-green">
              {succesAuto}
            </p>
          )}

          <ListeConflits
            conflits={conflitsIdentifies}
            vise={conflitVise}
            onViser={onViserConflit}
            seuilKm={rapportAuto?.parametres?.distanceMinKm ?? distance}
          />

          <ListeIntouchables barrages={barragesIntouchables} onCadrer={onCadrer} factionActuelle={factionActuelle} />

          {rapportAuto?.propositions?.length > 0 && (
            <ActivationOptimisation
              rapport={rapportAuto}
              retenus={rapportAuto.propositions.filter((p) => selectionAuto.has(p.id) && p.action === 'deplacer').length}
              applicationEnCours={applicationAutoEnCours}
              calculEnCours={calculAutoEnCours}
              onActiver={appliquerAuto}
              onAnnuler={annulerAuto}
            />
          )}

          <SectionBarragesRetires
            barrages={barragesRetires}
            chargement={chargementRetires}
            restaurationEnCours={restaurationEnCours}
            onCadrer={onCadrer}
            onRestaurer={restaurer}
          />

          <HistoriqueOptimisations rapports={rapportsOptimisation} />

          <button
            type="button"
            onClick={() => {
              setRapportAuto(null);
              onResultatsChange?.(null);
            }}
            title="Retire les repères de la carte"
            className={`${bouton} w-full bg-white/8 py-2.5 text-white/70 hover:bg-white/14`}
          >
            <IconPoubelle size={14} />
            Effacer les repères de la carte
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {blocSynthese}
          <PerimetreManuel perimetre={rapport?.perimetre} />
          {/* Trancher, c'est savoir QUI est en conflit avec QUI : la même
              liste numérotée qu'à l'étape précédente, la même désignation. */}
          <ListeConflits
            conflits={conflitsIdentifies}
            vise={conflitVise}
            onViser={onViserConflit}
            seuilKm={rapport?.parametres?.distanceMinKm}
          />
          {messageManuel && (
            <p data-gr-message-manuel={messageManuel.ton} className={`rounded-lg border px-3 py-2.5 text-[11.5px] leading-snug ${
              messageManuel.ton === 'succes'
                ? 'border-gr-green/25 bg-gr-green/10 text-gr-green'
                : 'border-[#F59E0B]/35 bg-[#F59E0B]/10 text-amber-300'
            }`}>
              {messageManuel.texte}
            </p>
          )}
          {session?.rang !== 'admin' && (
            <ActivationManuelle
              simulation={rapportSimule?.simulation}
              enCours={activationManuelleEnCours}
              calculEnCours={decisionEnCours != null}
              onActiver={activerManuel}
              onAnnuler={() => {
                setDecisionsManuelles([]);
                setRapportSimule(null);
              }}
            />
          )}
          {reinitialisation}
          {blocJournal}
          {filtresVue.intouchables && (
            <ListeIntouchables barrages={barragesIntouchables} onCadrer={onCadrer} factionActuelle={factionActuelle} />
          )}

          {aDecider.length === 0 &&
            proteges.length === 0 &&
            aSupprimer.length === 0 &&
            conserves.length === 0 && (
              <Vide>Aucun poste sous le seuil : il n’y a rien à trancher.</Vide>
            )}

          {filtresVue.conflits && aDecider.length > 0 && (
            <ListePostes
              titre={`${aDecider.length} barrage(s) trop rapproché(s)`}
              teinte="gold"
              phrase={
                <>
                  Pour chaque conflit : <b className="text-gr-gold">Conserver</b>, <b className="text-gr-gold">Déplacer</b>{' '}
                  ou <b className="text-gr-gold">Supprimer</b>. Tout reste simulé jusqu’à « Activer les modifications ».
                </>
              }
            >
              {aDecider.map((b) => (
                <LigneBarrage
                  key={b.id}
                  b={b}
                  onCadrer={onCadrer}
                  session={session}
                  onAssigner={onAssigner}
                  dejaAssigne={assignationDe?.(b) ?? null}
                  simulation={{
                    decision: decisionsVue.get(b.id) ?? null,
                    protege: false,
                    enCours: decisionEnCours != null,
                    onDecider: (type) => deciderSimulation(b.id, type),
                    explication: explicationDe(b),
                  }}
                />
              ))}
            </ListePostes>
          )}

          {filtresVue.intouchables && proteges.length > 0 && (
            <ListePostes
              titre={`${proteges.length} barrage(s) protégé(s) en conflit`}
              teinte="neutre"
              phrase="Intouchables et postes protégés : ni déplacement ni suppression. Seul « Conserver » est possible."
            >
              {proteges.map((b) => (
                <LigneBarrage
                  key={b.id}
                  b={b}
                  onCadrer={onCadrer}
                  session={session}
                  onAssigner={onAssigner}
                  dejaAssigne={assignationDe?.(b) ?? null}
                  etat="intouchable"
                  simulation={{
                    decision: decisionsVue.get(b.id) ?? null,
                    protege: true,
                    enCours: decisionEnCours != null,
                    onDecider: (type) => deciderSimulation(b.id, type),
                    explication: explicationDe(b),
                  }}
                />
              ))}
            </ListePostes>
          )}

          {aSupprimer.length > 0 && (
            <ListePostes
              titre={`${aSupprimer.length} retrait(s) proposé(s)`}
              teinte="gold"
              phrase={
                <>
                  Repère <b className="text-gr-gold">« ✗ »</b> sur la carte.{' '}
                  <b className="text-white/85">Rien n’est encore effacé</b> : le commandant concerné
                  a été notifié et doit accepter ou refuser.
                </>
              }
            >
              {aSupprimer.map((b) => (
                <LigneBarrage
                  key={b.id}
                  b={b}
                  onCadrer={onCadrer}
                  onDecider={onDecider}
                  session={session}
                  onAssigner={onAssigner}
                  dejaAssigne={assignationDe?.(b) ?? null}
                  demande={retraitATrancher(notifications, b.id, session)}
                  onDeciderDemande={onDeciderDemande}
                  etat="a_supprimer"
                />
              ))}
            </ListePostes>
          )}

          {conserves.length > 0 && (
            <ListePostes
              titre={`${conserves.length} poste(s) maintenu(s)`}
              teinte="green"
              phrase={
                <>
                  Repère <b className="text-gr-green">« ✓ »</b> sur la carte. Le commandant concerné
                  a été notifié.
                </>
              }
            >
              {conserves.map((b) => (
                <LigneBarrage
                  key={b.id}
                  b={b}
                  onCadrer={onCadrer}
                  onDecider={onDecider}
                  session={session}
                  onAssigner={onAssigner}
                  dejaAssigne={assignationDe?.(b) ?? null}
                  etat="conserve"
                />
              ))}
            </ListePostes>
          )}

          {/**
           * EFFACER LES REPÈRES — descendu ici depuis l'étape « Vérification ».
           */}
          <button
            type="button"
            onClick={() => setRapport(null)}
            title="Retire les repères « ? » et « ✓ » de la carte — aucun barrage n’est modifié"
            className={`${bouton} w-full bg-white/8 py-2.5 text-white/70 hover:bg-white/14`}
          >
            <IconPoubelle size={14} />
            Effacer les repères de la carte
          </button>

          {/* Section dédiée aux barrages retirés également accessible en mode manuel */}
          <div className="pt-3 border-t border-white/10">
            <SectionBarragesRetires
              barrages={barragesRetires}
              chargement={chargementRetires}
              restaurationEnCours={restaurationEnCours}
              onCadrer={onCadrer}
              onRestaurer={restaurer}
            />
          </div>
        </div>
      ),
    },

  ];

  etapesRef.current = etapes;

  return (
    <>
      <Parcours
        icone={IconBarrageFixe}
        titre="OPTIMISATION DES BARRAGES"
        ar="ترشيد الحواجز"
        etapes={etapes}
        indice={etape}
        onIndice={setEtape}
        onFermer={onClose}
        onTerminer={onClose}
        libelleTerminer="TERMINER"
        occupe={occupe}
        erreur={erreur}
      />
      {dialogue}
    </>
  );
}
