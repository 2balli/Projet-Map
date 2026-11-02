/**
 * PARCOURS GUIDÉ — la brique unique d'interaction de l'application.
 *
 * POURQUOI ELLE EXISTE.
 *
 * Chaque section portait son propre tiroir de 352 px, recopié sept fois, et y
 * empilait tous ses contrôles à la fois : la fiche de marquage en montrait
 * vingt-deux boutons et vingt champs répartis dans douze sections pliables.
 * L'utilisateur devait deviner l'ordre des gestes, et rien ne lui disait où il
 * en était ni ce qu'il restait à faire.
 *
 * Le remède n'est pas de repeindre ces tiroirs mais de changer la façon de
 * travailler : UNE question à la fois, un état d'avancement visible, un
 * SUIVANT qui annonce ce qu'il va faire, un RETOUR qui ne perd rien.
 *
 * DEUX PLACEMENTS, UN SEUL DESSIN.
 *
 * Une modale centrée convient pour choisir, régler et vérifier. Elle ne
 * convient PAS aux étapes qui travaillent sur la carte — trancher poste par
 * poste, poser un repère, mesurer un trajet : masquer la carte au moment où
 * l'on doit la lire rendrait l'étape impossible.
 *
 * Une étape déclare donc `carte: true`, et le parcours se range alors sur le
 * côté, sans fond sombre, la carte restant cliquable. Le dessin, l'en-tête,
 * la barre d'avancement et le pied ne changent pas : c'est le même parcours,
 * posé ailleurs. Deux composants distincts auraient divergé en trois
 * modifications.
 *
 * CE QUE LE PARCOURS NE FAIT PAS.
 *
 * Il ne connaît aucune règle métier. Il ne valide rien lui-même : chaque étape
 * dit si elle est franchissable (`valide`) et pourquoi elle ne l'est pas
 * (`empeche`). Il n'écrit rien : `onTerminer` est appelé, et c'est la section
 * qui décide. Ainsi la simplification de l'interface ne peut pas, par
 * construction, modifier ce que fait l'application.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRadarCalcul } from './radarCalcul.js';
import RadarCompact from './components/RadarCompact.jsx';
import { IconClose, IconCoche, IconFleche, IconSpinner } from './icons.jsx';
import {
  EFFETS,
  apresRetour,
  apresSuivant,
  atteignable,
  borner,
  creerSuiviOuverture,
  libelleRetour,
} from './parcoursNavigation.js';

/* ================================================================== */
/* Le parcours                                                        */
/* ================================================================== */

/** Ce qui peut recevoir le focus dans le corps d'une étape. */
const FOCUSABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {object} p
 * @param {React.ComponentType} [p.icone]        pastille d'en-tête
 * @param {string}  p.titre                      nom de la section, en capitales
 * @param {string}  [p.ar]                       le même, en arabe
 * @param {Array}   p.etapes                     voir `Etape` ci-dessous
 * @param {number}  p.indice                     étape courante (piloté par la section)
 * @param {Function} p.onIndice                  demande de changement d'étape
 * @param {Function} p.onFermer                  ANNULER / croix / Échap
 * @param {Function} [p.onTerminer]              dernière étape franchie
 * @param {string}  [p.libelleTerminer]
 * @param {boolean} [p.occupe]                   un appel est en cours
 * @param {string}  [p.erreur]                   message d'échec à afficher
 */
export function Parcours({
  icone: Icone,
  titre,
  ar,
  etapes,
  indice,
  onIndice,
  onFermer,
  onTerminer,
  libelleTerminer = 'CONFIRMER',
  occupe = false,
  erreur = null,
}) {
  const vivantes = useMemo(() => etapes.filter(Boolean), [etapes]);
  const total = vivantes.length;
  /* Borné et non pris tel quel : une section peut retirer une étape sous les
     pieds de l'utilisateur — voir `borner` dans parcoursNavigation.js. */
  const rang = borner(indice, total);
  const etape = vivantes[rang];

  const derniere = rang === total - 1;
  const franchissable = etape?.valide !== false;

  /**
   * L'ÉTAPE PORTE-T-ELLE UNE ACTION, ET LE BOUTON FAIT-IL QUELQUE CHOSE ?
   *
   * Deux choses distinctes, longtemps confondues sous le seul `franchissable`.
   * Une étape qui AGIT (« CALCULER ») n'a pas besoin d'être franchissable : son
   * action est précisément ce qui la rendra franchissable. Griser son bouton
   * parce qu'elle ne l'est pas encore, c'est fermer la seule porte — voir
   * `apresSuivant` dans parcoursNavigation.js, où le même défaut arrêtait
   * l'OPTIMISATION à l'étape 3 sur 5.
   *
   * `actif` décide de l'apparence ET de `disabled`, ensemble : un bouton doré
   * et inerte, ou grisé et cliquable, sont deux mensonges qu'on évite en ne
   * calculant la réponse qu'une fois.
   */
  const aAction = Boolean(etape?.onSuivant);
  const actif = (franchissable || aAction) && !occupe;

  /**
   * CE QUE LE PROUVEUR NE PEUT PAS ATTRAPER.
   *
   * `scripts/verifier-parcours.mjs` éprouve la navigation, qui est du calcul
   * pur. Il ne voit pas les étapes que les sections déclarent — deux étapes de
   * même `cle`, ou une étape sans titre, ne se remarqueraient qu'à l'usage :
   * React réutiliserait un segment d'avancement pour deux étapes, et le titre
   * serait vide sans que rien ne le signale.
   *
   * Un contrôle au rendu, en développement seulement (`import.meta.env.DEV`,
   * effacé du bundle de production par Vite).
   */
  if (import.meta.env.DEV) {
    const cles = vivantes.map((e) => e.cle);
    const doublons = cles.filter((c, i) => cles.indexOf(c) !== i);
    if (doublons.length) {
      console.error(`Parcours « ${titre} » : clé(s) d'étape en double — ${[...new Set(doublons)].join(', ')}`);
    }
    const sansTitre = vivantes.filter((e) => !e.titre).map((e) => e.cle ?? '(sans clé)');
    if (sansTitre.length) {
      console.error(`Parcours « ${titre} » : étape(s) sans titre — ${sansTitre.join(', ')}`);
    }
  }

  const corps = useRef(null);
  const cadre = useRef(null);
  const focusAvant = useRef(null);

  /**
   * SUIVANT et RETOUR — ce qu'ils font est DÉCIDÉ AILLEURS.
   *
   * Les deux boutons se contentent d'appliquer l'effet rendu par
   * `parcoursNavigation.js`, module pur éprouvé par
   * `scripts/verifier-parcours.mjs`. Cette navigation avait tout pour se
   * tromper en silence : un SUIVANT qui « termine » à l'étape 4 sur 5 ferme le
   * parcours au milieu sans rien signaler.
   *
   * Une étape peut porter `onSuivant` : le bouton exécute alors cette action au
   * lieu d'avancer, et c'est l'étape qui avancera si elle aboutit. C'est ce qui
   * permet d'écrire « CALCULER » sur le bouton plutôt que « SUIVANT » suivi
   * d'un second bouton « Calculer » dans le corps — deux gestes pour une seule
   * intention.
   */
  const appliquer = useCallback(
    (issue) => {
      if (issue.effet === EFFETS.ALLER) onIndice(issue.indice);
      else if (issue.effet === EFFETS.AGIR) etape?.onSuivant?.();
      else if (issue.effet === EFFETS.TERMINER) onTerminer?.();
      else if (issue.effet === EFFETS.FERMER) onFermer?.();
    },
    [onIndice, etape, onTerminer, onFermer],
  );

  const suivant = useCallback(
    () =>
      appliquer(
        apresSuivant({
          indice: rang,
          total,
          valide: franchissable,
          occupe,
          aAction,
        }),
      ),
    [appliquer, rang, total, franchissable, occupe, aAction],
  );

  const retour = useCallback(
    () => appliquer(apresRetour({ indice: rang, total, occupe })),
    [appliquer, rang, total, occupe],
  );

  /**
   * FOCUS — pris à l'ouverture, rendu à la fermeture.
   *
   * Sans restitution, refermer le parcours renvoyait le focus au début du
   * document : au clavier, il fallait retraverser toute la carte pour revenir
   * au bouton qu'on venait d'employer.
   */
  useEffect(() => {
    focusAvant.current = document.activeElement;
    return () => focusAvant.current?.focus?.();
  }, []);

  /**
   * À CHAQUE ÉTAPE, le focus va au premier contrôle du corps — et à défaut au
   * cadre lui-même, pour que Échap et Entrée répondent tout de suite.
   *
   * Il ne va PAS sur SUIVANT : Entrée franchirait alors l'étape sans que rien
   * n'ait été choisi.
   */
  useEffect(() => {
    const premier = corps.current?.querySelector(FOCUSABLES);
    (premier ?? cadre.current)?.focus?.({ preventScroll: true });
    if (corps.current) corps.current.scrollTop = 0;
  }, [rang]);

  /**
   * CLAVIER — Échap annule, Entrée avance, Tab reste dans le cadre.
   *
   * Entrée est ignorée dans une zone de texte multiligne (on y saisit des
   * retours à la ligne) et sur un bouton (il a sa propre action).
   */
  const auClavier = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onFermer?.();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      const c = e.target;
      const brut = c?.tagName === 'TEXTAREA' || c?.tagName === 'BUTTON' || c?.tagName === 'A';
      if (!brut) {
        e.preventDefault();
        suivant();
      }
      return;
    }

    /* Piège à focus : sur la dernière cible, Tab revient à la première. */
    if (e.key === 'Tab') {
      const cibles = [...(cadre.current?.querySelectorAll(FOCUSABLES) ?? [])].filter(
        (n) => n.offsetParent !== null,
      );
      if (cibles.length === 0) return;
      const premier = cibles[0];
      const dernier = cibles[cibles.length - 1];
      if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      } else if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      }
    }
  };

  if (!etape) return null;

  const surCarte = etape.carte === true;

  /* ---------------------------------------------------------------- */

  const contenuEtape = (
    <>
      <h3 className="text-[19px] font-bold leading-tight tracking-[-0.01em] text-white">
        {etape.titre}
      </h3>
      {etape.ar && (
        <p dir="rtl" className="mt-0.5 text-[13px] leading-tight text-gr-gold/70">
          {etape.ar}
        </p>
      )}
      {etape.aide && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">{etape.aide}</p>
      )}
      <div className="mt-4">{etape.contenu}</div>
    </>
  );

  const pied = (
    <>
        {(erreur || (!franchissable && etape.empeche)) && (
          <p
            role="status"
            className={`mb-2.5 rounded-lg px-2.5 py-1.5 text-[11.5px] leading-snug ${
              erreur ? 'bg-gr-red/15 text-gr-red' : 'bg-white/8 text-white/60'
            }`}
          >
            {erreur || etape.empeche}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={retour}
            disabled={occupe}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white/8 px-3.5 text-[12px]
              font-semibold text-white/75 transition-colors duration-150 hover:bg-white/14
              disabled:opacity-40 motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            {libelleRetour({ indice: rang, total }) === 'ANNULER' ? (
              'ANNULER'
            ) : (
              <>
                <IconFleche size={15} arriere /> RETOUR
              </>
            )}
          </button>

          <span className="flex-1" />

          <button
            type="button"
            onClick={suivant}
            disabled={!actif}
            className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl px-4
              text-[12.5px] font-bold transition-colors duration-150 motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
              ${
                actif
                  ? 'bg-gr-gold text-gr-navy hover:brightness-110'
                  : 'cursor-not-allowed bg-white/8 text-white/35'
              }`}
          >
            {occupe ? (
              <>
                <IconSpinner size={15} /> PATIENTEZ…
              </>
            ) : derniere ? (
              <>
                <IconCoche size={15} /> {libelleTerminer}
              </>
            ) : (
              <>
                {etape.libelleSuivant ?? 'SUIVANT'} <IconFleche size={15} />
              </>
            )}
          </button>
        </div>
    </>
  );

  return (
    <Cartouche
      icone={Icone}
      titre={titre}
      ar={ar}
      onFermer={onFermer}
      surCarte={surCarte}
      cadreRef={cadre}
      corpsRef={corps}
      onKeyDown={auClavier}
      avantCorps={
        <Avancement
          etapes={vivantes}
          rang={rang}
          total={total}
          onIndice={onIndice}
          occupe={occupe}
        />
      }
      pied={pied}
    >
      {contenuEtape}
    </Cartouche>
  );
}

/* ================================================================== */
/* L'état d'un parcours — et sa remise à zéro                         */
/* ================================================================== */

/**
 * UN PARCOURS REPART TOUJOURS DE L'ÉTAPE 1.
 *
 * LE DÉFAUT QUE CE CROCHET SUPPRIME. Chaque panneau tenait son étape dans un
 * `useState(0)` et se refermait par `if (!open) return null`. Or `return null`
 * ne DÉMONTE PAS le composant : React n'en dessine rien, mais la fonction
 * continue d'exister et ses `useState` gardent leur valeur. L'étape survivait
 * donc à la fermeture.
 *
 * À la réouverture, `borner` ramenait cet indice périmé dans les bornes du
 * nouveau tableau d'étapes — et « ramener dans les bornes » signifie ALLER À
 * LA DERNIÈRE. Le parcours s'ouvrait sur « Étape 2 sur 2 », c'est-à-dire sur
 * l'écran de fin, et il fallait appuyer sur RETOUR pour commencer.
 *
 * Le pire est que le symptôme dépendait du nombre d'étapes : une section à
 * cinq étapes quittée en 2 se rouvrait en 2 (dans les bornes, donc pas
 * corrigée), une section à deux étapes quittée en 4 se rouvrait à la fin. Le
 * même défaut, avec des apparences différentes selon la section.
 *
 * CE QUE FAIT CE CROCHET : il possède l'étape ET la remet à zéro à CHAQUE
 * changement de `open` — à l'ouverture comme à la fermeture. Remettre à zéro
 * en se fermant n'est pas redondant : cela évite qu'un état périmé subsiste
 * entre-temps, visible d'un autre écran ou d'un test.
 *
 * `remiseAZero` remet ce que la SECTION connaît en plus de l'étape : la tâche
 * choisie, la portée, le mode. L'étape seule ne suffit pas — un parcours
 * rouvert à l'étape 1 d'une branche qu'on n'a pas choisie n'a pas de sens.
 *
 * PAS AU PREMIER RENDU, à dessein. Tout y est déjà neuf, et surtout un lien
 * direct — « Modifier l'effectif » depuis la bulle d'un barrage — pose son
 * état dans le même cycle : le remettre à zéro effacerait la demande.
 *
 * @param {boolean} open      le panneau est-il déployé
 * @param {Function} [remiseAZero] ce que la section remet à zéro en plus
 * @param {*} [branche]       la branche choisie (tâche, portée) — `null` sur
 *                            l'étape de choix. Voir le second suivi plus bas.
 * @returns {{indice: number, setIndice: Function, recommencer: Function}}
 */
export function useParcours(open, remiseAZero, branche = null) {
  const [indice, setIndice] = useState(0);

  /**
   * La remise à zéro vit dans une référence, et non dans les dépendances de
   * l'effet : une fonction fléchée change d'identité à chaque rendu, et
   * l'effet se rejouerait sans fin — en remettant l'étape à zéro à chacun,
   * donc en interdisant d'avancer.
   */
  const remise = useRef(remiseAZero);
  remise.current = remiseAZero;

  /** Employée par ANNULER, TERMINER, et « nouvelle saisie ». */
  const recommencer = useCallback(() => {
    setIndice(0);
    remise.current?.();
  }, []);

  /**
   * LE SUIVI DÉCIDE, PAS LE TABLEAU DE DÉPENDANCES.
   *
   * Se fier au seul `[open]` marcherait aujourd'hui et se casserait à la
   * première dépendance ajoutée : l'effet se rejouerait alors sans que `open`
   * ait changé, et ramènerait à l'étape 1 en pleine saisie. Le suivi compare
   * lui-même — voir `creerSuiviOuverture`, éprouvé sur des milliers de
   * séquences par `scripts/verifier-parcours.mjs`.
   */
  const suiviOuverture = useRef(null);
  if (suiviOuverture.current === null) suiviOuverture.current = creerSuiviOuverture();

  useEffect(() => {
    if (suiviOuverture.current.observer(open).recommencer) recommencer();
  }, [open, recommencer]);

  /**
   * CHANGER DE BRANCHE MÈNE À SA PREMIÈRE ÉTAPE — automatiquement.
   *
   * LE DÉFAUT QUE CECI SUPPRIME, et il était visible : choisir « Poser un
   * nouveau repère » ouvrait « Où le poser ? », étape 2 sur 2, en sautant
   * « Quelle nature ? ». Comme aucune nature n'était armée, l'étape ne pouvait
   * jamais être franchie : le parcours était sans issue, sauf RETOUR.
   *
   * La cause était un `setEtape(1)` écrit à la main dans le gestionnaire de
   * choix. Il était JUSTE dans ORGANISATION, dont l'étape de choix reste dans
   * le tableau — et FAUX dans SAISIE TERRAIN, dont le tableau était remplacé
   * par celui de la tâche. Deux structures pour un même geste, et le nombre 1
   * recopié de l'une à l'autre.
   *
   * Les trois sections gardent maintenant leur étape de choix en tête du
   * tableau. La branche choisie mène donc TOUJOURS à l'indice 1, et c'est le
   * crochet qui l'écrit — plus aucun appelant ne manipule d'indice.
   *
   * `branche` remise à `null` (on revient au choix) ramène à l'indice 0.
   *
   * @param {*} branche  la tâche, la portée, le mode — ce qui distingue la
   *                     branche courante. `null` = on est sur le choix.
   */
  const suiviBranche = useRef(null);
  if (suiviBranche.current === null) suiviBranche.current = creerSuiviOuverture();

  useEffect(() => {
    if (suiviBranche.current.observer(branche != null).recommencer) {
      setIndice(branche != null ? 1 : 0);
    }
  }, [branche]);

  return { indice, setIndice, recommencer };
}

/**
 * L'INDICE D'UNE ÉTAPE, PAR SA CLÉ — et jamais par un nombre écrit à la main.
 *
 * POURQUOI CETTE FONCTION EXISTE. En déplaçant l'étape de choix en tête des
 * tableaux, tous les indices codés en dur se sont décalés d'un cran : le saut
 * vers « Compte créé » visait encore 4 alors que l'étape était passée en 5, le
 * retour au premier écran d'une tâche visait 0 — le menu — au lieu de 1. Cinq
 * sauts faux d'un coup, et aucun que le compilateur ou le prouveur pouvait
 * voir : un indice est un nombre valide, il mène simplement ailleurs.
 *
 * Une clé, elle, ne se décale pas. Elle ne se trompe que si l'étape n'existe
 * pas — et l'on rend alors -1, que l'appelant doit vérifier.
 *
 * Le `filter(Boolean)` reproduit exactement ce que fait `Parcours` : une étape
 * conditionnelle vaut `null` et ne compte pas dans la numérotation affichée.
 * Compter sans filtrer donnerait un indice juste dans le tableau et faux à
 * l'écran.
 *
 * @param {Array} etapes  le tableau tel qu'il est passé à `Parcours`
 * @param {string} cle
 * @returns {number} l'indice, ou -1
 */
export const indiceDe = (etapes, cle) =>
  (etapes ?? []).filter(Boolean).findIndex((e) => e.cle === cle);

/* ================================================================== */
/* Cartouche — l'enveloppe commune à TOUTES les sections              */
/* ================================================================== */

/**
 * L'ENVELOPPE, UNE SEULE FOIS.
 *
 * Sept panneaux portaient chacun son propre `<aside>` : mêmes classes
 * recopiées sept fois, avec des largeurs qui avaient déjà divergé (336 px ici,
 * 352 px là), des en-têtes à `px-3.5` ou `px-4`, et un bouton de fermeture
 * tantôt `size-11` tantôt `size-10`. Rien de grave pris un par un, et c'est
 * bien le problème : l'application ne se lisait pas comme un seul système.
 *
 * DEUX PLACEMENTS. `surCarte` la range sur le côté, la carte restant
 * cliquable : c'est ce qu'il faut pour désigner un point, trancher poste par
 * poste, suivre un tracé. Sinon elle est centrée sur un fond sombre, en
 * portail — pour choisir, régler, vérifier.
 *
 * ELLE NE SAIT RIEN DES ÉTAPES. `Parcours` lui passe sa barre d'avancement
 * dans `avantCorps` et ses boutons dans `pied` ; un écran de lecture
 * (notifications, analyse) ne lui passe ni l'une ni l'autre et obtient le même
 * dessin, sans séquence inventée là où il n'y en a pas.
 */
export function Cartouche({
  icone: Icone,
  titre,
  ar,
  onFermer,
  surCarte = true,
  /** Slot de la barre d'avancement — absent, il n'y a pas de séquence. */
  avantCorps = null,
  /** Slot du pied — absent, la cartouche n'a pas de pied. */
  pied = null,
  /**
   * Actions propres à la section, placées dans l'en-tête avant la fermeture.
   * Réservé à ce qui porte sur TOUT l'écran — imprimer, basculer une couche —
   * et jamais à une action d'étape, qui vit dans le corps.
   */
  actions = null,
  /** Références et clavier, quand l'appelant en a besoin (voir `Parcours`). */
  cadreRef = null,
  corpsRef = null,
  onKeyDown = null,
  /** 'entree' | 'sortie' — voir usePresence ; par défaut, l'entrée seule. */
  presence = 'entree',
  children,
}) {
  const idTitre = useId();
  const appuiSurFond = useRef(false);

  const cadre = (
    <div
      ref={cadreRef}
      role="dialog"
      data-presence={presence}
      data-depuis={surCarte ? 'gauche' : 'centre'}
      aria-modal={surCarte ? undefined : 'true'}
      aria-labelledby={idTitre}
      tabIndex={-1}
      onKeyDown={onKeyDown ?? undefined}
      className={`pointer-events-auto flex flex-col overflow-hidden rounded-2xl border
        border-white/10 bg-gr-navy/95 shadow-panel backdrop-blur-md outline-none
        ${
          surCarte
            ? 'max-h-full w-[368px] max-w-[calc(100vw-1.5rem)] shrink-0'
            : 'max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-1.5rem))]'
        }`}
    >
      <header className="flex items-center gap-2.5 border-b border-white/10 bg-white/5 px-4 py-3">
        {Icone && (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy">
            <Icone size={20} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2
            id={idTitre}
            className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-white"
          >
            {titre}
          </h2>
          {ar && (
            <p dir="rtl" className="truncate text-[12px] leading-tight text-gr-gold/70">
              {ar}
            </p>
          )}
        </div>
        {actions}
        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer"
          className="grid size-10 shrink-0 place-items-center rounded-lg text-white/50
            transition-colors duration-150 hover:bg-white/10 hover:text-white
            motion-reduce:transition-none
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <IconClose size={18} />
        </button>
      </header>

      {avantCorps}

      <div ref={corpsRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {children}
      </div>

      {pied && (
        <footer className="shrink-0 border-t border-white/10 bg-white/5 px-4 py-3">{pied}</footer>
      )}
    </div>
  );

  if (surCarte) return cadre;

  /**
   * LE FOND SOMBRE, autour du cartouche centré.
   *
   * Sorti dans une variable parce qu'il est rendu de deux façons : par un
   * portail dans le navigateur, tel quel s'il n'y a pas de document (voir
   * plus bas).
   */
  const centre = (
    <div
      data-voile-presence={presence}
      className="pointer-events-auto fixed inset-0 z-[2000] flex items-center justify-center
        bg-black/60 p-4 backdrop-blur-[2px]"
      /**
       * Le fond ne referme que si l'appui A COMMENCÉ sur lui. Un glissement
       * parti d'un champ et relâché hors du cadre émet son `click` sur leur
       * premier ancêtre commun — le fond — et annulerait la saisie.
       */
      onMouseDown={(e) => {
        appuiSurFond.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (appuiSurFond.current && e.target === e.currentTarget) onFermer?.();
      }}
    >
      {cadre}
    </div>
  );

  /**
   * SANS DOCUMENT, PAS DE PORTAIL.
   *
   * Le rendu serveur de React ne sait pas rendre un portail, et il n'y a de
   * toute façon pas de `document.body` où le poser. Ce n'est pas un cas
   * théorique : `scripts/verifier-rendu.mjs` rend toutes les sections dans
   * Node pour éprouver que chaque étape se dessine — c'est le contrôle qui
   * aurait attrapé les quatre écrans blancs de ce projet.
   *
   * Le contenu est alors rendu tel quel. Dans le navigateur, le portail
   * reprend son office.
   */
  if (typeof document === 'undefined') return centre;

  /**
   * LA MODALE SORT DE SON PANNEAU — portail vers `document.body`.
   *
   * Les panneaux de décision vivent dans un conteneur `absolute` qui porte
   * `pointer-events-none`, `overflow-x-auto` et un `zoom` (l'échelle de
   * l'interface). Une modale `fixed` posée là-dedans hérite du zoom, se fait
   * rogner par le débordement, et ses clics n'arrivent pas : elle se serait
   * affichée de travers, dans le coin, à demi coupée.
   *
   * Le portail la place directement sur le corps du document. Centrée
   * réellement, quel que soit l'endroit du code qui la demande.
   */
  return createPortal(centre, document.body);
}

/* ================================================================== */
/* Avancement                                                         */
/* ================================================================== */

/**
 * OÙ SUIS-JE, ET QUE RESTE-T-IL ?
 *
 * Trois réponses au même endroit : le rang chiffré (« ÉTAPE 2 SUR 5 »), le nom
 * de l'étape, et un segment par étape. Les segments franchis sont cliquables —
 * revenir en arrière est le geste le plus demandé d'un parcours, et l'obliger
 * à passer par RETOUR autant de fois que nécessaire serait pénible.
 *
 * Les étapes à venir ne sont PAS cliquables : sauter une étape laisserait des
 * choix non faits, et c'est exactement ce que le parcours sert à éviter.
 */
function Avancement({ etapes, rang, total, onIndice, occupe }) {
  /* Un calcul réel est en cours (radarCalcul.js) : la fenêtre masque la
     carte, son radar s'affiche donc ici, en petit — le même, aux couleurs du
     thème, le temps exact du calcul. */
  const calcul = useRadarCalcul();
  return (
    <div className="shrink-0 border-b border-white/10 px-4 pb-2.5 pt-2">
      {calcul && (
        <div role="status" aria-live="polite" className="mb-2 flex items-center gap-2 rounded-lg border border-border-default bg-gr-card px-2.5 py-1.5">
          <RadarCompact />
          <span className="text-[11.5px] font-bold text-text-primary">Analyse en cours…</span>
          <span className="truncate text-[10.5px] text-text-secondary">{calcul}</span>
        </div>
      )}
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-gr-gold/70">
        Étape {rang + 1} sur {etapes.length}
      </p>

      <div className="mt-1.5 flex gap-1" role="list">
        {etapes.map((e, i) => {
          const franchie = i < rang;
          const courante = i === rang;
          /* Même règle que les boutons du pied — voir parcoursNavigation.js. */
          const accessible = atteignable(i, rang, total, occupe);

          return (
            <button
              key={e.cle}
              type="button"
              role="listitem"
              disabled={!accessible}
              onClick={() => accessible && onIndice(i)}
              aria-current={courante ? 'step' : undefined}
              aria-label={`Étape ${i + 1} : ${e.titre}${franchie ? ' (franchie)' : ''}`}
              title={accessible ? `Revenir à : ${e.titre}` : e.titre}
              className={`h-1.5 flex-1 rounded-full transition-colors duration-200
                motion-reduce:transition-none
                ${accessible ? 'cursor-pointer hover:brightness-125' : 'cursor-default'}
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
                ${courante ? 'bg-gr-gold' : franchie ? 'bg-gr-gold/45' : 'bg-white/12'}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Briques d'étape — le vocabulaire visuel commun                     */
/* ================================================================== */

/**
 * CHOIX — une question, des réponses en pleines cartes.
 *
 * Remplace les rangées de petits boutons-radio de 11 px qu'on trouvait dans
 * chaque panneau. Une carte porte un libellé, son équivalent arabe et une
 * phrase qui dit ce que l'option implique : le sens ne se devine pas au
 * survol, il est écrit.
 *
 * Le choix retenu est signalé par le fond ET la coche ET la couleur — jamais
 * par la couleur seule, comme le reste de l'application.
 */
export function Choix({ options, valeur, onChange, colonnes = 1, nom }) {
  return (
    <div
      role="radiogroup"
      aria-label={nom}
      className={`grid gap-2 ${colonnes === 2 ? 'sm:grid-cols-2' : ''}`}
    >
      {options.map((o) => {
        const actif = o.cle === valeur;
        const Icone = o.icone;
        return (
          <button
            key={o.cle}
            type="button"
            role="radio"
            aria-checked={actif}
            disabled={o.desactive}
            onClick={() => onChange(o.cle)}
            className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left
              transition-colors duration-150 disabled:opacity-40 motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
              ${
                actif
                  ? 'border-gr-gold/70 bg-gr-gold/15'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
          >
            {Icone && (
              <span
                className={`grid size-9 shrink-0 place-items-center rounded-lg
                  ${actif ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 text-white/50'}`}
              >
                <Icone size={18} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={`text-[13.5px] font-semibold leading-tight
                    ${actif ? 'text-white' : 'text-white/85'}`}
                >
                  {o.libelle}
                </span>
                {actif && <IconCoche size={14} className="shrink-0 text-gr-gold" />}
              </span>
              {o.ar && (
                <span dir="rtl" className="mt-0.5 block text-[11.5px] leading-tight text-gr-gold/60">
                  {o.ar}
                </span>
              )}
              {o.aide && (
                <span className="mt-1 block text-[11.5px] leading-snug text-white/45">
                  {o.aide}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * BASCULE — un réglage qui s'allume, et la phrase qui dit ce qu'il change.
 *
 * Les interrupteurs des panneaux ne portaient qu'un libellé de deux mots
 * (« VIP », « Non éclairé ») : impossible de savoir s'ils filtraient
 * l'affichage ou modifiaient le calcul. La phrase n'est donc pas décorative.
 */
export function Bascule({ actif, onChange, libelle, ar, aide, icone: Icone }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      onClick={() => onChange(!actif)}
      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left
        transition-colors duration-150 motion-reduce:transition-none
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
        ${actif ? 'border-gr-gold/60 bg-gr-gold/12' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
    >
      {Icone && (
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg
            ${actif ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 text-white/45'}`}
        >
          <Icone size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="text-[13.5px] font-semibold leading-tight text-white/90">{libelle}</span>
        {ar && (
          <span dir="rtl" className="mt-0.5 block text-[11.5px] leading-tight text-gr-gold/60">
            {ar}
          </span>
        )}
        {aide && <span className="mt-1 block text-[11.5px] leading-snug text-white/45">{aide}</span>}
      </span>
      <span
        aria-hidden
        className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5
          transition-colors duration-150 motion-reduce:transition-none
          ${actif ? 'bg-gr-gold' : 'bg-white/15'}`}
      >
        <span
          className={`size-5 rounded-full bg-white transition-transform duration-150
            motion-reduce:transition-none ${actif ? 'translate-x-5' : 'translate-x-0'}`}
        />
      </span>
    </button>
  );
}

/**
 * CHAMP — un libellé au-dessus, une unité à droite, une aide en dessous.
 * Toujours ce dessin, pour que tous les champs de l'application se lisent
 * pareil quel que soit le panneau.
 */
export function Champ({
  libelle,
  ar,
  aide,
  suffixe,
  value,
  onChange,
  type = 'text',
  inputMode,
  placeholder,
  autoFocus,
  min,
  max,
  step,
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-semibold text-white/75">
        {libelle}
        {ar && (
          <span dir="rtl" className="ml-1.5 text-[11px] font-normal text-gr-gold/60">
            {ar}
          </span>
        )}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-white/12 bg-white/6 px-3
            text-[14px] text-white placeholder:text-white/25
            focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary"
        />
        {suffixe && (
          <span className="shrink-0 text-[12.5px] font-semibold text-white/50">{suffixe}</span>
        )}
      </div>
      {aide && <p className="mt-1.5 text-[11.5px] leading-snug text-white/45">{aide}</p>}
    </div>
  );
}

/**
 * RÉCAPITULATIF — l'étape de vérification, toujours dessinée pareil.
 *
 * Ce que l'utilisateur va valider, en clair, avant de le valider. Les entrées
 * dont la valeur est `null` sont omises : une ligne « — » n'apprend rien.
 */
export function Recap({ lignes, titre }) {
  const utiles = lignes.filter((l) => l && l.valeur != null && l.valeur !== '');
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
      {titre && (
        <p className="border-b border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-gr-gold/70">
          {titre}
        </p>
      )}
      <dl className="divide-y divide-white/8">
        {utiles.map((l) => (
          <div key={l.libelle} className="flex items-baseline gap-3 px-3 py-2">
            <dt className="min-w-0 flex-1 text-[12px] text-white/50">{l.libelle}</dt>
            <dd
              className={`shrink-0 text-right text-[13px] font-semibold ${
                l.accent ? 'text-gr-gold' : 'text-white/90'
              }`}
            >
              {l.valeur}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * TERMINÉ — la dernière vue d'un parcours qui a abouti.
 *
 * Elle existe pour une raison précise : sans elle, le parcours se refermait et
 * l'utilisateur ne savait pas si son geste avait porté. Un compte rendu court,
 * et la porte de sortie.
 */
export function Termine({ titre, detail, actions }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-gr-green/20 text-gr-green">
        <IconCoche size={30} />
      </span>
      <p className="text-[16px] font-bold leading-tight text-white">{titre}</p>
      {detail && <p className="max-w-[36ch] text-[12.5px] leading-relaxed text-white/55">{detail}</p>}
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * NOTE — une phrase de contexte dans une étape, sans en faire un pavé.
 * `ton` : 'info' par défaut, 'alerte' quand la phrase avertit.
 */
export function Note({ children, ton = 'info' }) {
  return (
    <p
      className={`rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed ${
        ton === 'alerte' ? 'bg-gr-red/12 text-gr-red' : 'bg-white/6 text-white/60'
      }`}
    >
      {children}
    </p>
  );
}

/**
 * MESSAGE FLOTTANT — un compte rendu qui ne bloque rien.
 *
 * EN PORTAIL, comme les modales, et pour la même raison : les panneaux vivent
 * dans un conteneur qui porte un `zoom` (l'échelle de l'interface), et un
 * élément `fixed` posé là-dedans hérite de ce zoom — le message se serait
 * affiché décalé, d'autant plus que l'échelle s'éloigne de 100 %.
 *
 * `pointer-events-none` : il passe devant sans jamais avaler un clic.
 */
export function MessageFlottant({ children, ton = 'ok' }) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <p
      role="status"
      /* Jamais plus large que 30 rem, jamais plus large que l'écran : les deux
         bornes tiennent dans une seule classe. */
      className={`pointer-events-none fixed bottom-4 left-1/2 z-[2000]
        max-w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border bg-gr-navy/95
        px-3.5 py-2 text-center text-[12px] leading-snug shadow-panel backdrop-blur-md
        ${ton === 'ok' ? 'border-gr-green/40 text-gr-green' : 'border-gr-red/40 text-gr-red'}`}
    >
      {children}
    </p>,
    document.body,
  );
}

/**
 * VIDE — ce qu'on affiche quand une étape n'a rien à montrer.
 * Une liste vide sans explication se lit comme une panne.
 */
export function Vide({ children }) {
  return (
    <p className="rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[12.5px] leading-relaxed text-white/40">
      {children}
    </p>
  );
}
