/**
 * NAVIGATION D'UN PARCOURS GUIDÉ — la seule part qui se raisonne.
 *
 * Le reste de `Parcours.jsx` ne se raisonne pas : on dessine un en-tête, on
 * empile un corps qui défile, on pose deux boutons. Ici, en revanche, on
 * DÉCIDE — que fait SUIVANT sur la dernière étape, que fait RETOUR sur la
 * première, quelles étapes sont cliquables, que se passe-t-il si l'étape
 * courante sort des bornes parce que la section en a retiré une.
 *
 * Ces décisions se trompent silencieusement : un SUIVANT qui « termine » à
 * l'étape 4 sur 5 ferme le parcours au milieu, et rien ne le signale. D'où un
 * module à part, sans React ni DOM, que `scripts/verifier-parcours.mjs`
 * éprouve sur toutes les combinaisons possibles.
 *
 * MÊME DÉCOUPAGE QUE `placementBulle.js` : la géométrie des bulles y est
 * isolée pour la même raison, et deux tentatives s'y étaient trompées avant
 * qu'elle ne soit éprouvée.
 */

/** Ce que SUIVANT ou RETOUR demande de faire. */
export const EFFETS = {
  /** Aller à l'indice rendu. */
  ALLER: 'aller',
  /** Exécuter l'action portée par l'étape (`onSuivant`) ; elle avancera si elle aboutit. */
  AGIR: 'agir',
  /** Le parcours est mené à son terme (`onTerminer`). */
  TERMINER: 'terminer',
  /** Annuler et fermer (`onFermer`). */
  FERMER: 'fermer',
  /** Ne rien faire — bouton inerte. */
  RIEN: 'rien',
};

/**
 * Ramène un indice dans les bornes.
 *
 * Une section peut retirer une étape (elle dépend souvent d'un état : pas de
 * rapport, pas d'étape de décision). Si l'utilisateur était sur la dernière,
 * l'indice pointe alors DANS LE VIDE, et le parcours se rendait blanc. On
 * borne donc à chaque rendu plutôt que de faire confiance à l'indice reçu.
 *
 * @param {number} indice
 * @param {number} total nombre d'étapes vivantes
 * @returns {number} indice sûr, 0 si le parcours est vide
 */
export function borner(indice, total) {
  if (!Number.isFinite(indice) || total <= 0) return 0;
  return Math.min(Math.max(Math.trunc(indice), 0), total - 1);
}

/**
 * QUE FAIT LE BOUTON PRINCIPAL ?
 *
 * Deux refus avant tout : parcours vide, appel en cours. Le bouton est alors
 * inerte.
 *
 * PUIS UNE DISTINCTION QUI MANQUAIT, ET QUI BLOQUAIT L'OPTIMISATION.
 *
 * `valide` répondait à une seule question — « le bouton fait-il quelque
 * chose ? » — pour deux gestes qui n'ont rien à voir :
 *
 *   QUITTER l'étape (ALLER, TERMINER). Là, `valide` a tout son sens : on ne
 *   passe pas une étape dont les choix ne sont pas faits.
 *
 *   AGIR sur l'étape (`aAction`). Là, `valide` est un contresens, parce que
 *   c'est justement L'ACTION QUI REND L'ÉTAPE VALIDE.
 *
 * L'étape « Les barrages concernés » de l'OPTIMISATION le montre : elle est
 * valide quand un calcul existe (`valide: Boolean(rapport)`), et son bouton
 * CALCULER est le SEUL moyen de produire ce calcul. Le bouton était donc grisé
 * tant qu'on n'avait pas calculé, et l'on ne pouvait pas calculer. Le parcours
 * s'arrêtait définitivement à l'étape 3 sur 5 : ni SUIVANT, ni contournement.
 *
 * Le contrôle de navigation ne l'a pas vu parce qu'il exigeait EXACTEMENT ce
 * comportement (« une étape bloquée ne fait rien », sans distinguer l'action).
 * Ses 2 571 combinaisons passaient donc sur un panneau inutilisable — une
 * garde qui protège la faute est pire qu'une garde absente.
 *
 * `empeche` reste affiché dans ce cas, et c'est ce qu'on veut : il ne dit plus
 * « bouton mort », il dit quoi faire — « Lancez le calcul pour voir les
 * barrages concernés ».
 *
 * Enfin, une étape porteuse d'action agit MÊME si elle est la dernière : c'est
 * elle qui décidera de terminer. Inverser laisserait « CALCULER » fermer le
 * parcours sans calculer.
 *
 * @param {{indice:number,total:number,valide?:boolean,occupe?:boolean,aAction?:boolean}} e
 * @returns {{effet:string, indice?:number}}
 */
export function apresSuivant({ indice, total, valide = true, occupe = false, aAction = false }) {
  if (total <= 0) return { effet: EFFETS.RIEN };
  if (occupe) return { effet: EFFETS.RIEN };

  /* L'action d'abord : elle ne dépend pas de `valide`, elle le produit. */
  if (aAction) return { effet: EFFETS.AGIR };

  if (!valide) return { effet: EFFETS.RIEN };

  const rang = borner(indice, total);
  if (rang >= total - 1) return { effet: EFFETS.TERMINER };
  return { effet: EFFETS.ALLER, indice: rang + 1 };
}

/**
 * QUE FAIT LE BOUTON DE GAUCHE ?
 *
 * Sur la première étape il n'y a rien derrière : il ANNULE. C'est délibéré —
 * un bouton grisé « RETOUR » sur la première étape est une case morte, alors
 * qu'« ANNULER » est précisément ce qu'on cherche à cet endroit. Le libellé
 * change avec l'effet, jamais l'un sans l'autre.
 *
 * @param {{indice:number,total:number,occupe?:boolean}} e
 * @returns {{effet:string, indice?:number}}
 */
export function apresRetour({ indice, total, occupe = false }) {
  if (total <= 0) return { effet: EFFETS.RIEN };
  if (occupe) return { effet: EFFETS.RIEN };

  const rang = borner(indice, total);
  if (rang === 0) return { effet: EFFETS.FERMER };
  return { effet: EFFETS.ALLER, indice: rang - 1 };
}

/**
 * PEUT-ON SAUTER DIRECTEMENT À L'ÉTAPE `i` DEPUIS LA BARRE D'AVANCEMENT ?
 *
 * En arrière : oui. Revenir est le geste le plus fréquent d'un parcours, et
 * l'obliger à passer par RETOUR autant de fois que nécessaire est pénible.
 *
 * En avant : non. Sauter une étape laisserait des choix non faits, et c'est
 * précisément ce que le parcours sert à empêcher. L'étape courante non plus :
 * y « aller » ne ferait rien, et un bouton qui ne fait rien se clique quand
 * même.
 *
 * Pendant un appel : rien ne bouge, sinon on changerait d'étape sous les pieds
 * d'une réponse en vol.
 *
 * @returns {boolean}
 */
export function atteignable(i, indice, total, occupe = false) {
  if (occupe || total <= 0) return false;
  const rang = borner(indice, total);
  return Number.isInteger(i) && i >= 0 && i < rang;
}

/**
 * Libellé du bouton de gauche — déduit de l'effet, jamais choisi à part.
 * Deux sources pour un même bouton finiraient par se contredire.
 */
export function libelleRetour({ indice, total }) {
  return apresRetour({ indice, total }).effet === EFFETS.FERMER ? 'ANNULER' : 'RETOUR';
}

/**
 * SUIVI D'OUVERTURE — quand un parcours doit-il repartir de l'étape 1 ?
 *
 * LE DÉFAUT QUE CECI SUPPRIME. Les panneaux se referment par
 * `if (!open) return null`. Cela ne DÉMONTE pas le composant : React n'en
 * dessine rien, mais ses `useState` gardent leur valeur. L'étape survivait
 * donc à la fermeture, et `borner` ramenait l'indice périmé dans les bornes du
 * nouveau tableau — c'est-à-dire SUR LA DERNIÈRE ÉTAPE. Un parcours à deux
 * étapes se rouvrait ainsi sur « Étape 2 sur 2 ».
 *
 * POURQUOI UN OBJET PLUTÔT QU'UNE COMPARAISON DANS L'EFFET. Deux pièges se
 * cachent ici, et aucun ne se voit à la lecture :
 *
 *   — remettre à zéro AU PREMIER RENDU effacerait l'état qu'un lien direct
 *     vient de poser dans le même cycle (« Modifier l'effectif » depuis la
 *     bulle d'un barrage) ;
 *   — remettre à zéro quand `open` n'a PAS changé — ce qui arrive dès qu'une
 *     autre dépendance de l'effet change d'identité — interdirait d'avancer :
 *     chaque rendu ramènerait à l'étape 1.
 *
 * Le suivi est donc explicite, et `scripts/verifier-parcours.mjs` l'éprouve
 * sur des milliers de séquences d'ouverture et de fermeture.
 *
 * @returns {{observer: (open: boolean) => {recommencer: boolean, motif: string}}}
 */
export function creerSuiviOuverture() {
  let premier = true;
  let dernier = null;

  return {
    observer(open) {
      const etat = Boolean(open);

      if (premier) {
        premier = false;
        dernier = etat;
        return { recommencer: false, motif: 'premier rendu' };
      }
      if (etat === dernier) {
        return { recommencer: false, motif: 'inchangé' };
      }
      dernier = etat;
      return { recommencer: true, motif: etat ? 'ouverture' : 'fermeture' };
    },
  };
}
