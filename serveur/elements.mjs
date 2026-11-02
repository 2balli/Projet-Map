/**
 * ÉLÉMENTS PRÉSENTS SUR UN BARRAGE, PAR CRÉNEAU DE 6 HEURES.
 *
 * Ce que le terrain relève quatre fois par jour : qui tient le poste. Un
 * élément, c'est trois informations et rien de plus — un grade, un nom, un
 * matricule — rattachées à UN barrage et à UN créneau de 6 heures.
 *
 * POURQUOI UN DÉPÔT À PART, ET PAS LE CHAMP `patrouilles` DU MARQUAGE
 * ------------------------------------------------------------------
 * Un marquage porte déjà `patrouilles` (voir depot.mjs), et la tentation était
 * d'y ranger ces éléments. Trois raisons de ne pas le faire :
 *
 *   1. `patrouilles` décrit l'AFFECTATION d'un poste (une équipe, son unité,
 *      son véhicule, son effectif), pas la relève nominative. Il est plafonné à
 *      dix entrées, et il est lu par le panneau Filtrer et par l'analyse
 *      (« barrages sans patrouille ») : y verser un historique de relèves
 *      changerait ce que ces deux-là comptent, sans que personne ne l'ait
 *      demandé.
 *   2. Ces relèves s'ACCUMULENT — quatre créneaux par jour, indéfiniment. Le
 *      dépôt des marquages est réécrit en entier à chaque saisie, avec copie de
 *      sauvegarde quotidienne : y faire grossir un journal de présence ferait
 *      payer chaque pose de barrage.
 *   3. Un élément ne se corrige pas, il se retire et se ressaisit. Rien à voir
 *      avec le cycle de vie d'une fiche de barrage.
 *
 * Un fichier JSON, écriture atomique, le serveur seul fait autorité : même
 * principe que les autres dépôts (`regles.mjs`, `missions.mjs`,
 * `instructions.mjs`).
 *
 * UN FICHIER PAR DATE, EN AJOUT — et pourquoi il a fallu en venir là.
 *
 * L'en-tête annonçait ici « de l'ordre du mégaoctet par an ». La mesure sur le
 * dispositif réel dit autre chose : 1 122 postes relevés quatre fois par jour
 * produisent environ 24 000 lignes par jour, soit 65 Mo en CINQ JOURS. La
 * prévision était fausse d'un facteur cent.
 *
 * Or tout le dépôt était réécrit à chaque ajout. Mesuré :
 *
 *   121 428 lignes (5 jours)   778 ms pour ajouter UN homme à un poste
 *   30 jours de relèves        5,4 s
 *   1 an de relèves            57 s, et 4,7 Go
 *
 * Le geste le plus fréquent de l'application devenait donc inutilisable en
 * quelques semaines. Purger l'historique n'était pas une réponse : c'est
 * précisément ce qu'on vient chercher.
 *
 * LA FORME DES DONNÉES DONNAIT LA SOLUTION. Chaque ligne porte une `date`, et
 * une ligne ne se corrige jamais — on la retire et on la ressaisit (voir
 * `supprimer`). Deux propriétés qui autorisent :
 *
 *   — un fichier par journée, `elements/2026-09-07.jsonl` : une écriture ne
 *     touche plus que le jour concerné ;
 *   — l'AJOUT EN FIN DE FICHIER (une ligne JSON par relève) plutôt que la
 *     réécriture : ajouter un homme coûte alors le même temps le premier jour
 *     et le millième.
 *
 * Ce qui n'a PAS changé, à dessein : l'API publique du dépôt, le modèle en
 * mémoire, l'index d'occupation, et le fait qu'une relève est acquise sur le
 * disque à l'instant où elle est prise. Seule la persistance a bougé.
 *
 * CE QUI RESTE À FAIRE, et qu'il ne faut pas croire résolu : tout l'historique
 * est encore chargé en mémoire au démarrage (154 Mo pour cinq jours). Il
 * faudra ne charger qu'une fenêtre de dates le jour où l'historique dépassera
 * quelques mois. Le partitionnement du disque est le préalable qui le rendra
 * possible ; il ne le fait pas.
 */
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Écrit une journée entière, de façon atomique : fichier voisin puis
 * renommage, comme `ecrireJsonAtomique` — mais en lignes JSON plutôt qu'en un
 * seul objet, pour que le fichier reste ajoutable ensuite.
 *
 * Le provisoire porte un nom unique : deux écritures ne se disputent pas la
 * même cible (voir `serveur/ecritureAtomique.mjs`, même raisonnement).
 */
let compteurJournee = 0;
const ATTENTES = [5, 10, 20, 40, 80, 150, 300];
const VERROUS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const patienter = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

function ecrireLignesAtomique(chemin, lot) {
  const tmp = `${chemin}.${process.pid}.${++compteurJournee}.tmp`;
  writeFileSync(tmp, lot.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

  let dernier = null;
  for (let essai = 0; essai <= ATTENTES.length; essai++) {
    try {
      renameSync(tmp, chemin);
      return;
    } catch (err) {
      dernier = err;
      if (!VERROUS.has(err.code) || essai === ATTENTES.length) break;
      patienter(ATTENTES[essai]);
    }
  }
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* plus rien à tenter */
  }
  throw dernier;
}

/**
 * LES QUATRE GRADES, ET RIEN D'AUTRE — liste fermée, jamais de saisie libre.
 *
 * Abréviations officielles, du plus petit au plus élevé :
 *   MDLG  maréchal des logis gendarme
 *   MDLC  maréchal des logis-chef
 *   ADJT  adjudant
 *   A/C   adjudant-chef
 *
 * Elles remplacent `M/G` et `M/C`, notées ainsi dans la première version. Le
 * renommage n'a demandé aucune migration : aucune relève n'avait encore été
 * saisie le jour où il a eu lieu. L'ORDRE COMPTE — il sert à répartir l'effectif
 * du plus gradé au moins gradé (voir la préparation du roster).
 *
 * Le navigateur propose la même liste (voir `GRADES` dans
 * src/ElementsCreneau.jsx) ; celle-ci est celle qui fait autorité.
 */
export const GRADES = ['MDLG', 'MDLC', 'ADJT', 'A/C'];

/**
 * Heure de début des quatre créneaux de la journée. C'est cette heure qui
 * IDENTIFIE le créneau (0, 6, 12 ou 18) : stocker « 06:00 → 12:00 » en clair
 * obligerait à comparer deux champs pour regrouper, et laisserait la porte
 * ouverte à des bornes incohérentes.
 */
export const CRENEAUX = [0, 6, 12, 18];

/**
 * UN BARRAGE EST TENU PAR EXACTEMENT TROIS HOMMES SUR UN CRÉNEAU.
 *
 * MÊME RÈGLE QUE LE NAVIGATEUR (`ELEMENTS_PAR_BARRAGE` dans src/marquages.js),
 * dupliquée à dessein comme `GRADES` et comme le périmètre : ici pour refuser,
 * là-bas pour ne pas proposer ce qui serait refusé. Les deux valeurs sont
 * comparées par `npm run check:trois` — elles ne peuvent pas diverger sans
 * faire échouer le build.
 *
 * La règle porte sur le couple (poste, créneau) : un poste accumule quatre
 * relèves par jour, ce n'est pas trois présences dans sa vie entière.
 */
export const ELEMENTS_PAR_BARRAGE = 3;

/** Le créneau qui contient cette date-heure. */
export const creneauDe = (d) => CRENEAUX[Math.floor(d.getHours() / 6)];

const MAX = {
  nom: 80,
  matricule: 30,
  /** Au-delà, ce n'est plus une relève : c'est une erreur de saisie ou un abus. */
  parCreneau: 40,
};

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Date et heure LOCALES du serveur, pas UTC : un créneau de 6 heures est une
 * réalité d'horloge murale. `toISOString()` aurait décalé la date d'un jour
 * pour toute saisie faite après 23:00 heure locale.
 */
const deuxChiffres = (n) => String(n).padStart(2, '0');
const dateLocale = (d) =>
  `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;
const heureLocale = (d) => `${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;

const estValide = (e) =>
  e &&
  typeof e.id === 'string' &&
  typeof e.barrageId === 'string' &&
  GRADES.includes(e.grade) &&
  CRENEAUX.includes(e.creneau) &&
  /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? ''));

const nouvelId = () => `el_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

/** Erreur portant un statut HTTP, pour que la route la rende telle quelle. */
class ErreurElement extends Error {
  constructor(message, statut) {
    super(message);
    this.statut = statut;
  }
}

export function creerDepotElements(fichier) {
  let items = [];

  /**
   * LE DOSSIER DES JOURNÉES, à côté du fichier historique.
   *
   * `fichier` reste le chemin que les appelants passent
   * (`donnees-serveur/elements.json`) : ils n'ont pas à connaître la nouvelle
   * disposition. Le dossier s'en déduit.
   */
  const DOSSIER = join(dirname(resolve(fichier)), 'elements');
  const fichierDuJour = (date) => join(DOSSIER, `${date}.jsonl`);
  const EST_DATE = /^\d{4}-\d{2}-\d{2}$/;

  /** Une ligne JSON par élément — d'où l'extension `.jsonl`. */
  const lireJournee = (chemin) => {
    const lignes = readFileSync(chemin, 'utf8').split('\n');
    const lus = [];
    for (const ligne of lignes) {
      const nu = ligne.trim();
      if (!nu) continue;
      try {
        const e = JSON.parse(nu);
        if (estValide(e)) lus.push(e);
      } catch {
        /**
         * UNE LIGNE ILLISIBLE N'EMPORTE PAS LA JOURNÉE.
         *
         * C'est tout l'intérêt de l'ajout ligne à ligne : une coupure de
         * courant au milieu d'une écriture laisse au pire une dernière ligne
         * tronquée. On la saute et l'on garde les autres — là où un JSON
         * unique tronqué aurait rendu la journée entière illisible.
         */
      }
    }
    return lus;
  };

  const charger = () => {
    items = [];

    if (existsSync(DOSSIER)) {
      for (const nom of readdirSync(DOSSIER).sort()) {
        if (!nom.endsWith('.jsonl')) continue;
        /* Concaténation, et non `push(...journee)` : l'étalement passe chaque
           élément en ARGUMENT, et une journée de 30 000 relèves — ce que donne
           un dispositif complet à quatre créneaux — dépasse la pile d'appels.
           Le symptôme est un `RangeError: Maximum call stack size exceeded` au
           démarrage, c'est-à-dire un service qui ne démarre plus du tout. */
        items = items.concat(lireJournee(join(DOSSIER, nom)));
      }
      return;
    }

    /**
     * REPRISE DU FICHIER UNIQUE — une fois, au premier démarrage.
     *
     * On répartit l'historique par date, puis on écarte l'ancien fichier sous
     * un nom explicite au lieu de l'effacer : si quelque chose s'était mal
     * passé, la donnée d'origine est encore là.
     */
    if (!existsSync(fichier)) return;

    let brut;
    try {
      brut = JSON.parse(readFileSync(fichier, 'utf8'));
    } catch (err) {
      throw new Error(`Dépôt des éléments illisible (${fichier}) : ${err.message}`);
    }
    items = (brut.items ?? []).filter(estValide);

    mkdirSync(DOSSIER, { recursive: true });
    const parDate = new Map();
    for (const e of items) {
      if (!parDate.has(e.date)) parDate.set(e.date, []);
      parDate.get(e.date).push(e);
    }
    for (const [date, lot] of parDate) {
      if (!EST_DATE.test(date)) continue;
      writeFileSync(fichierDuJour(date), lot.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    }
    renameSync(fichier, `${fichier}.reparti-par-journee`);
    console.log(
      `  éléments répartis : ${items.length} ligne(s) sur ${parDate.size} journée(s) dans ${DOSSIER}`,
    );
  };

  charger();

  /**
   * ÉCRITURES GROUPÉES — voir `enBloc` ci-dessous.
   *
   * Chaque ajout réécrit le dépôt entier : c'est ce qui rend une relève
   * durable au moment même où elle est prise, et cela doit rester. Mais une
   * préparation nationale enchaîne quatre mille quatre cents ajouts sur un
   * fichier qui atteint vingt-quatre mégaoctets : le coût devient
   * quadratique, et la commande ne rend pas la main.
   */
  let differe = 0;
  let enAttente = false;

  /**
   * QUELS CRÉNEAUX SONT DÉJÀ POURVUS — un compte par (poste, jour, tranche).
   *
   * `creneauOccupe` balayait les 46 000 lignes du dépôt à chaque appel. La
   * préparation d'une journée en fait 4 484 : deux cents millions de
   * comparaisons, six secondes pendant lesquelles le service ne répondait pas.
   * Au redémarrage, un poste qui rechargeait la page voyait « serveur
   * injoignable ».
   *
   * Un compte, et non un simple drapeau : retirer une ligne ne libère le
   * créneau que s'il n'en reste aucune autre.
   */
  const cleCreneau = (barrageId, date, creneau) => `${barrageId}|${date}|${creneau}`;
  const occupation = new Map();

  const indexer = () => {
    occupation.clear();
    for (const e of items) {
      const k = cleCreneau(e.barrageId, e.date, e.creneau);
      occupation.set(k, (occupation.get(k) ?? 0) + 1);
    }
  };

  const compter = (e, delta) => {
    const k = cleCreneau(e.barrageId, e.date, e.creneau);
    const n = (occupation.get(k) ?? 0) + delta;
    if (n > 0) occupation.set(k, n);
    else occupation.delete(k);
  };

  indexer();

  /**
   * DEUX FAÇONS D'ENREGISTRER, selon ce qui a changé.
   *
   * `aAjouter`  les lignes neuves : on les met en FIN du fichier de leur
   *             journée, ce qui coûte le même temps quelle que soit la taille
   *             de l'historique. C'est le chemin de la relève de terrain.
   *
   * `aRefaire`  les journées dont une ligne a DISPARU. Un retrait ne peut pas
   *             s'exprimer par un ajout : on réécrit cette journée-là, et elle
   *             seule. Le retrait est un geste de correction, bien plus rare
   *             que la saisie.
   */
  const aAjouter = [];
  const aRefaire = new Set();

  const refaireJournee = (date) => {
    const lot = items.filter((e) => e.date === date);
    const chemin = fichierDuJour(date);
    if (lot.length === 0) {
      /* Journée vidée : on retire le fichier plutôt que d'en laisser un vide,
         qui donnerait à croire à une journée renseignée sans effectif. */
      try {
        renameSync(chemin, `${chemin}.vide`);
      } catch {
        /* Absent ou verrouillé : rien de plus à tenter. */
      }
      return;
    }
    ecrireLignesAtomique(chemin, lot);
  };

  const ecrireVraiment = () => {
    mkdirSync(DOSSIER, { recursive: true });

    /* Les réécritures d'abord : elles repartent de `items`, donc elles
       contiennent déjà les lignes neuves de leur journée. */
    for (const date of aRefaire) refaireJournee(date);

    /**
     * UNE SEULE ÉCRITURE PAR JOURNÉE, ET NON UNE PAR LIGNE.
     *
     * Cette boucle appelait `appendFileSync` pour CHAQUE ligne — donc un
     * ouvrir/écrire/fermer par relève. Sur une saisie de terrain, une ligne à
     * la fois, cela ne se voit pas. Sur la préparation d'une journée, c'est
     * 23 256 ouvertures de fichier d'affilée : mesuré à 10,3 secondes, contre
     * 381 millisecondes pour TOUT le calcul de répartition qui précède. Le
     * travail utile était donc vingt-sept fois moins cher que la façon de
     * l'enregistrer.
     *
     * Et comme `preparerJournee` est synchrone et appelé par `veillerAuRoster`
     * au démarrage puis toutes les heures, ces secondes ne sont pas de
     * l'attente en tâche de fond : le service ne répond à personne pendant ce
     * temps.
     *
     * On regroupe donc par journée avant d'écrire. L'ordre des lignes est
     * conservé — `aAjouter` est parcouru dans l'ordre, et chaque journée garde
     * le sien. Un ajout reste un ajout : on n'a pas transformé l'écriture en
     * réécriture, et le coût demeure indépendant de la taille de l'historique.
     */
    const parJournee = new Map();
    for (const { date, element } of aAjouter) {
      if (aRefaire.has(date)) continue; // déjà écrite ci-dessus
      if (!parJournee.has(date)) parJournee.set(date, []);
      parJournee.get(date).push(JSON.stringify(element));
    }
    for (const [date, lignes] of parJournee) {
      appendFileSync(fichierDuJour(date), lignes.join('\n') + '\n', 'utf8');
    }

    aAjouter.length = 0;
    aRefaire.clear();
  };

  const ecrire = () => {
    if (differe > 0) {
      enAttente = true;
      return;
    }
    ecrireVraiment();
  };

  /** Une ligne neuve à porter en fin de journée. */
  const noterAjout = (element) => {
    aAjouter.push({ date: element.date, element });
  };

  /** Une journée à réécrire entièrement (retrait de ligne). */
  const noterRetrait = (date) => {
    aRefaire.add(date);
  };

  return {
    /**
     * EXÉCUTE UN LOT D'ÉCRITURES, ET N'ENREGISTRE QU'UNE FOIS.
     *
     * Réservé aux traitements de masse — la préparation d'une journée. Une
     * saisie de terrain, elle, continue d'écrire immédiatement : c'est ce qui
     * la rend opposable, et l'on ne groupe pas ce qui doit être acquis.
     *
     * L'enregistrement a lieu même si le traitement échoue en cours de route :
     * la mémoire a déjà changé, et laisser le disque en arrière ferait
     * diverger les deux. Mieux vaut une journée à moitié préparée, visible et
     * complétable, qu'un état introuvable au redémarrage.
     */
    enBloc(travail) {
      differe++;
      try {
        return travail();
      } finally {
        differe--;
        if (differe === 0 && enAttente) {
          enAttente = false;
          ecrireVraiment();
        }
      }
    },

    parId: (id) => items.find((e) => e.id === id) ?? null,

    /**
     * Tous les éléments d'UN barrage, du plus récent au plus ancien : le
     * navigateur les regroupe par créneau et n'a donc rien à retrier.
     */
    duBarrage: (barrageId) =>
      items
        .filter((e) => e.barrageId === barrageId)
        .sort((a, b) => String(b.saisiLe).localeCompare(String(a.saisiLe))),

    /**
     * Ajoute un élément au créneau EN COURS.
     *
     * Date, heure et créneau viennent de l'horloge du serveur, jamais du corps
     * de la requête : c'est ce qui rend la relève opposable, et c'est aussi ce
     * qui interdit d'écrire dans un créneau passé — un historique qu'on peut
     * réécrire après coup ne vaut rien.
     */
    creer({ barrageId, grade, nom, matricule, auteur }) {
      if (!GRADES.includes(grade)) {
        throw new ErreurElement(`Grade inconnu : attendu ${GRADES.join(', ')}.`, 400);
      }

      const nomPropre = texte(nom, MAX.nom);
      if (!nomPropre) throw new ErreurElement('Le nom est obligatoire.', 400);

      const maintenant = new Date();
      const date = dateLocale(maintenant);
      const creneau = creneauDe(maintenant);

      /**
       * JAMAIS DEUX POSTES POUR LA MÊME PERSONNE AU MÊME MOMENT.
       *
       * La répartition automatique le garantit déjà par construction (le vivier
       * se consomme, voir `repartir`), et l'interface ne propose que des gens
       * libres. Mais ni l'une ni l'autre ne protège une saisie faite à la main,
       * ou par un second poste au même instant. La règle est donc tenue ICI,
       * seul endroit que tout le monde traverse.
       *
       * Sur le matricule, et non sur le nom : deux gendarmes peuvent être
       * homonymes, le matricule les distingue. Une ligne sans matricule
       * échappe au contrôle — c'est assumé, on ne peut pas identifier
       * quelqu'un qu'on n'a pas nommé.
       */
      const matriculePropre = texte(matricule, MAX.matricule);
      if (matriculePropre) {
        const ailleurs = items.find(
          (e) =>
            e.matricule === matriculePropre &&
            e.date === date &&
            e.creneau === creneau &&
            e.barrageId !== barrageId,
        );
        if (ailleurs) {
          throw new ErreurElement(
            `${matriculePropre} tient déjà un autre poste sur ce créneau : une personne ne peut pas être à deux endroits.`,
            409,
          );
        }
      }

      const dejaLa = items.filter(
        (e) => e.barrageId === barrageId && e.date === date && e.creneau === creneau,
      ).length;
      if (dejaLa >= MAX.parCreneau) {
        throw new ErreurElement(
          `Ce créneau compte déjà ${MAX.parCreneau} éléments : retirez-en avant d'en ajouter.`,
          409,
        );
      }

      const element = {
        id: nouvelId(),
        barrageId,
        grade,
        nom: nomPropre,
        matricule: matriculePropre,
        date, // AAAA-MM-JJ, heure locale du serveur
        heure: heureLocale(maintenant), // HH:MM — quand la saisie a été faite
        creneau, // 0 | 6 | 12 | 18 — heure de début du créneau de 6 h
        saisiLe: maintenant.toISOString(), // l'instant absolu, pour trier sans ambiguïté
        auteur, // qui a saisi (voir `identite` dans api.mjs)
      };

      items.push(element);
      compter(element, +1);
      noterAjout(element);
      ecrire();
      return element;
    },

    /**
     * ROSTER PRÉPARÉ D'AVANCE — écriture DATÉE, réservée au serveur.
     *
     * `creer` refuse volontairement toute date venue du client : un historique
     * qu'on peut réécrire après coup ne vaut rien. La préparation, elle, doit
     * écrire dans un créneau À VENIR — c'est tout son objet. Le compromis tient
     * en trois verrous :
     *
     *   — la date et le créneau sont calculés par la ROUTE, à partir de la date
     *     du jour du serveur ; le navigateur ne les fournit jamais ;
     *   — on n'écrit JAMAIS dans le passé (`avant` est refusé) ;
     *   — on n'écrase JAMAIS un créneau qui contient déjà quelque chose. Une
     *     relève saisie à la main est un fait ; une préparation n'est qu'une
     *     proposition, elle ne passe pas devant.
     *
     * `prepare: true` distingue ensuite les lignes proposées de celles qu'un
     * chef a tapées — utile au compte rendu, et pour re-préparer sans toucher
     * au travail de quelqu'un.
     */
    preparer({ barrageId, date, creneau, personnes, auteur }) {
      if (!CRENEAUX.includes(creneau)) {
        throw new ErreurElement(`Créneau inconnu : attendu ${CRENEAUX.join(', ')}.`, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw new ErreurElement('Date de préparation invalide.', 400);
      }

      /**
       * DÉJÀ QUELQUE CHOSE DANS CE CRÉNEAU : ON NE TOUCHE À RIEN.
       *
       * PAR L'INDEX, ET NON PAR UN BALAYAGE. Cette ligne s'écrivait
       * `items.some((e) => e.barrageId === … && e.date === … && e.creneau === …)`,
       * soit un parcours de TOUT l'historique à chaque créneau préparé. Le coût
       * est le produit des deux :
       *
       *     1 124 barrages × 4 créneaux  =  4 496 appels par journée
       *     × 121 428 relèves en mémoire =  546 millions de comparaisons
       *
       * Et il croît en carré : chaque journée préparée allonge l'historique,
       * donc ralentit la suivante. Mesuré sur le jeu de démonstration, la
       * préparation de DEUX journées ne se terminait pas en dix minutes.
       *
       * Ce n'est pas une lenteur de tâche de fond. `preparerJournee` est
       * appelé par `veillerAuRoster` (voir api.mjs), au démarrage puis toutes
       * les heures, et il est SYNCHRONE : pendant tout ce temps la boucle
       * d'événements est bloquée et le service ne répond plus à personne —
       * processus vivant, aucune réponse, pas même sur une connexion neuve.
       * C'est ainsi que le défaut s'est manifesté : une requête quelconque
       * restait sans réponse indéfiniment, à un endroit qui changeait d'une
       * exécution à l'autre selon le moment où l'horloge tombait.
       *
       * `occupation` répond à la même question en temps constant. L'index
       * existait déjà — tenu à jour par `compter` à chaque ajout et à chaque
       * retrait, reconstruit par `indexer` après un retrait en masse — et
       * `creneauOccupe` l'expose plus bas. Il n'était simplement pas consulté
       * ici.
       */
      if (occupation.has(cleCreneau(barrageId, date, creneau))) {
        return { ajoutes: 0, ignores: personnes.length, motif: 'creneau-non-vide' };
      }

      const maintenant = new Date();
      const crees = [];
      for (const p of personnes.slice(0, MAX.parCreneau)) {
        if (!GRADES.includes(p.grade)) continue;
        const nomPropre = texte(p.nom, MAX.nom);
        if (!nomPropre) continue;
        crees.push({
          id: nouvelId(),
          barrageId,
          grade: p.grade,
          nom: nomPropre,
          matricule: texte(p.matricule, MAX.matricule),
          date,
          heure: `${deuxChiffres(creneau)}:00`,
          creneau,
          saisiLe: maintenant.toISOString(),
          /* Proposé par la préparation, pas relevé par un chef. */
          prepare: true,
          auteur,
        });
      }

      if (crees.length) {
        items.push(...crees);
        for (const c of crees) compter(c, +1);
        for (const c of crees) noterAjout(c);
        ecrire();
      }
      return { ajoutes: crees.length, ignores: personnes.length - crees.length, motif: null };
    },

    /**
     * EFFACE LA PRÉPARATION D'UN JOUR, pour la refaire.
     *
     * Sans cela, une journée préparée est définitive : `preparer` refuse tout
     * créneau non vide, donc corriger `composition-barrage.json` ou charger un
     * effectif n'aurait plus aucun effet sur un jour déjà proposé. Le bouton
     * « préparer » deviendrait inerte exactement au moment où il sert.
     *
     * DEUX GARDES, et elles ne se négocient pas :
     *
     *   - on n'efface que des lignes `prepare: true`. Une proposition se
     *     remplace ; une relève tapée par un chef est un fait ;
     *   - un créneau qui contient NE SERAIT-CE QU'UNE ligne humaine est laissé
     *     entier, préparation comprise. Le chef a peut-être retiré deux hommes
     *     et ajouté le remplaçant : effacer le reste défferait son travail.
     *
     * La date est décidée par l'appelant, qui interdit déjà le passé (voir
     * /api/roster/preparer) : ce dépôt ne connaît pas l'horloge.
     */
    retirerPreparation(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
        throw new ErreurElement('Date de préparation invalide.', 400);
      }

      /* Les créneaux du jour touchés par une main humaine — intouchables. */
      const humains = new Set();
      for (const e of items) {
        if (e.date === date && e.prepare !== true) humains.add(`${e.barrageId}|${e.creneau}`);
      }

      const avant = items.length;
      let proteges = 0;
      const restants = items.filter((e) => {
        if (e.date !== date || e.prepare !== true) return true;
        if (humains.has(`${e.barrageId}|${e.creneau}`)) {
          proteges++;
          return true;
        }
        return false;
      });

      const retires = avant - restants.length;
      if (retires) {
        /* Réaffectation plutôt que `items.push(...restants)` : au-delà de
           quelques dizaines de milliers de lignes, l'étalement dépasse la pile
           d'appels et fait tomber la préparation — mesuré sur le jeu de
           démonstration complet (229 000 relèves). `items` est déjà réaffecté
           par `charger()`, les lecteurs le résolvent par son nom. */
        items = restants;
        indexer(); // retrait en masse : reconstruire coûte moins que compter un à un
        /* Une seule journée est touchée — celle qu'on vient de vider de ses
           propositions. Les autres ne sont pas réécrites. */
        noterRetrait(date);
        ecrire();
      }
      return { retires, proteges, creneauxHumains: humains.size };
    },

    /** Un créneau porte-t-il déjà quelque chose, préparé ou saisi ? */
    creneauOccupe: (barrageId, date, creneau) =>
      occupation.has(cleCreneau(barrageId, date, creneau)),

    /**
     * LES CRÉNEAUX RÉELLEMENT TENUS, POUR TOUS LES BARRAGES À LA FOIS.
     *
     * UNE SEULE TRAVERSÉE, et c'est tout l'intérêt. L'optimisation a besoin de
     * l'horaire d'activité de chaque poste ; l'obtenir par `duBarrage()` poste
     * par poste demanderait un balayage complet par barrage — près de trois
     * cent mille relèves multipliées par un millier de postes sur le
     * dispositif réel, soit un calcul qui ne rend jamais la main.
     *
     * `depuis` borne l'historique à une période récente (`AAAA-MM-JJ`) : ce
     * qu'un poste tenait il y a six mois ne dit rien de son service actuel, et
     * tout garder ferait apparaître les quatre créneaux partout.
     *
     * `jusqua` ferme l'autre borne, incluse. Les deux à la même date donnent
     * UNE journée — c'est ce dont se sert le filtre par faction, qui répond à
     * « qui tient ce poste aujourd'hui », et non « qui l'a tenu ce mois-ci ».
     *
     * @returns {Map<string, Set<number>>} barrageId -> heures de créneau tenues.
     */
    creneauxParBarrage(depuis = null, jusqua = null) {
      const parBarrage = new Map();
      for (const e of items) {
        if (depuis && String(e.date) < depuis) continue;
        if (jusqua && String(e.date) > jusqua) continue;
        let tenus = parBarrage.get(e.barrageId);
        if (!tenus) parBarrage.set(e.barrageId, (tenus = new Set()));
        tenus.add(e.creneau);
      }
      return parBarrage;
    },

    /** Tout ce qui est posé sur un jour donné — pour le compte rendu de préparation. */
    duJour: (date) => items.filter((e) => e.date === date),

    /**
     * Retire un élément — la seule correction possible : on efface la ligne et
     * on la ressaisit. Pas de modification en place : une relève de terrain se
     * lit, elle ne se retouche pas.
     *
     * Les éléments d'un barrage retiré du dispositif ne sont PAS effacés avec
     * lui : ce qui a été relevé a eu lieu, et le retrait d'un poste n'annule
     * pas les gardes qui y ont été tenues. Ils cessent simplement d'être
     * affichés, puisqu'on n'atteint la liste que par un barrage existant.
     */
    supprimer(id) {
      const i = items.findIndex((e) => e.id === id);
      if (i < 0) return false;
      const date = items[i].date;
      compter(items[i], -1);
      items.splice(i, 1);
      /* Un retrait ne s'exprime pas par un ajout : sa journée est réécrite,
         et elle seule. */
      noterRetrait(date);
      ecrire();
      return true;
    },
  };
}
