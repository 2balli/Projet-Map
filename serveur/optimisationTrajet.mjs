/**
 * OPTIMISATION AUTOMATIQUE — LE TEMPS DE TRAJET COMME CRITÈRE PRINCIPAL.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. L'optimisation raisonnait en kilomètres et
 * répondait par un RETRAIT : deux postes trop proches, on en écarte un. Deux
 * défauts, et le second est le plus grave.
 *
 *   LA DISTANCE N'EST PAS LA PROXIMITÉ OPÉRATIONNELLE. Douze kilomètres sur une
 *   nationale rectiligne font huit minutes ; les mêmes douze kilomètres de part
 *   et d'autre d'un massif en font quarante. Ce que subit l'usager, et ce que
 *   met une patrouille à basculer d'un poste à l'autre, c'est le TEMPS.
 *
 *   RETIRER N'EST PAS OPTIMISER. Un poste en conflit avec son voisin n'est pas
 *   un poste inutile : c'est un poste MAL PLACÉ, ou mal programmé. Le déplacer
 *   de quinze kilomètres, ou le basculer d'une faction à l'autre, résout le
 *   conflit sans rien retrancher au dispositif. Le retrait était la réponse
 *   facile ; c'est aussi la seule qui perde quelque chose.
 *
 * LA RÈGLE : deux postes sont en CONFLIT quand la route les sépare de moins de
 * `seuilMinutes` (quarante par défaut) ET que leurs factions se chevauchent. Les
 * deux conditions, jamais une seule — deux postes à vingt minutes l'un de
 * l'autre mais qui se relaient (faction 1 et faction 3) ne se gênent pas, ils
 * couvrent la journée.
 *
 * TROIS RÉPONSES, DANS CET ORDRE :
 *
 *   A. DÉPLACER — chercher un autre point de route, dans la MÊME brigade, qui
 *      éloigne le poste de ses voisins en conflit. C'est la réponse préférée :
 *      elle garde le poste, ses hommes et sa faction.
 *   B. CHANGER DE FACTION — si aucun emplacement ne convient, basculer le poste
 *      sur un tour de service où il ne gêne plus personne.
 *   C. CONSERVER — si ni l'un ni l'autre n'améliore la situation, on garde, et
 *      l'on DIT pourquoi. Jamais de retrait automatique.
 *
 * RIEN N'EST ÉCRIT ICI. La fonction rend des PROPOSITIONS, avec la position et
 * la faction envisagées, de quoi les afficher sur la carte avant d'appliquer.
 */
import { accrocher } from './routage.mjs';
import { scoreMaintien } from './distances.mjs';
import { FACTIONS, factionParId } from './factions.mjs';
import { indexerAcces, tempsDepuis, itineraireDetaille } from './tempsTrajet.mjs';
import { protectionsDe, LIBELLE_PROTECTION } from './protections.mjs';

/**
 * LA SÉPARATION OPÉRATIONNELLE MINIMALE — une heure de route.
 *
 * Deux postes tenus EN MÊME TEMPS doivent être séparés d'au moins une heure de
 * trajet par la route, quand le réseau et les contraintes le permettent. C'est
 * la règle que le commandement a fixée, et c'est le seul nombre de ce calcul :
 * il n'y a ni pourcentage de réduction, ni plancher de couverture, ni seuil à
 * régler dans l'écran automatique.
 *
 * UNE HEURE, ET NON QUARANTE MINUTES. Le seuil a valu 40 min ; il a été porté à
 * 60. Ce n'est pas un réglage d'affichage : à 100 km/h, on passe d'un rayon de
 * 66 km à 100 km, et le nombre de couples à examiner croît avec le carré du
 * rayon. Le calcul en est plus long, et il trouve beaucoup plus de conflits —
 * c'est le prix d'une exigence plus haute, pas un défaut.
 */
export const SEUIL_MINUTES_DEFAUT = 60;

/** Rayon d'accrochage d'un poste au réseau — au-delà, il n'est sur aucune route. */
const RAYON_ACCROCHAGE_KM = 5;

/**
 * LE BUDGET DE CALCUL — vingt secondes, et l'on rend ce que l'on a.
 *
 * Sur le périmètre national, la résolution complète demande plusieurs minutes :
 * chaque conflit traité rouvre un Dijkstra borné, et il y en a des dizaines de
 * milliers. Une analyse qui ne rend jamais la main est vécue comme un
 * plantage — c'est très exactement le défaut qui a été signalé.
 *
 * On préfère donc un résultat PARTIEL ET DÉCLARÉ : `resume.interrompue` et
 * `resume.conflitsNonExamines` disent ce qui n'a pas été traité. Un résultat
 * incomplet qui se présente comme complet serait pire qu'une attente.
 */
const BUDGET_MS_DEFAUT = 20_000;

/**
 * COMBIEN DE TRACÉS ROUTIERS SONT CALCULÉS — deux cent cinquante.
 *
 * Chaque tracé est un Dijkstra de plus, et il ne sert qu'à DESSINER. Au-delà
 * de deux cent cinquante routes sur la carte, on ne distingue plus rien : le
 * calcul coûterait sans rien apprendre. Les conflits les plus serrés sont
 * servis d'abord, et `resume.tracesOmises` dit combien n'ont pas leur tracé.
 */
const MAX_TRACES = 250;

/**
 * COMBIEN DE PROPOSITIONS SONT RENDUES — quatre cents.
 *
 * Le panneau ne se lit plus au-delà, et la réponse HTTP pèserait plusieurs
 * mégaoctets. Les actions applicables passent devant, puis les conflits les
 * plus courts ; `resume.propositionsOmises` compte le reste.
 */
const MAX_PROPOSITIONS = 400;

/**
 * DEUX POSTES SONT-ILS TENUS EN MÊME TEMPS ?
 *
 * Les factions découpent la journée en tranches DISJOINTES de six heures :
 * deux postes ne sont simultanés que s'ils portent la même. C'est pourquoi la
 * comparaison est une égalité, et non un calcul de chevauchement — il n'y a
 * rien à chevaucher entre 00h00→06h00 et 06h00→12h00.
 *
 * UNE FACTION INCONNUE CHEVAUCHE TOUT, et c'est délibéré. Un poste dont
 * personne n'a dit quand il est tenu peut l'être à n'importe quelle heure :
 * le traiter comme compatible avec tout le monde reviendrait à le PROTÉGER
 * par son propre défaut de renseignement, et à laisser passer des conflits
 * réels. L'absence d'information n'est pas une garantie.
 */
export const factionsSeChevauchent = (a, b) => {
  if (!a || !b) return true;
  if (!factionParId(a) || !factionParId(b)) return true;
  return a === b;
};

/* ------------------------------------------------------------------ */
/* L'ANALYSE                                                          */
/* ------------------------------------------------------------------ */

const minutes = (v) => `${Math.round(v)} min`;

/**
 * ANALYSE PAR TEMPS DE TRAJET — conflits, puis propositions.
 *
 * @param {Array} barrages postes en service, dans le périmètre demandé
 * @param {object} graphe réseau routier chargé
 * @param {object} options
 * @param {number} options.seuilMinutes proximité opérationnelle (défaut 40)
 * @returns {{mode, resume, propositions, conflits, seuilMinutes}}
 */
export function analyserParTempsTrajet(
  barrages,
  graphe,
  {
    seuilMinutes = SEUIL_MINUTES_DEFAUT,
    accidents = false,
    seuilAccidents = 4,
    vip = false,
    nonEclaire = false,
    exclusIds = [],
    /* Garde-fou : une analyse ne doit pas tourner indéfiniment sur un
       dispositif dense. Chaque tour traite un conflit. */
    maxIterations = 50000,
    budgetMs = BUDGET_MS_DEFAUT,
  } = {},
) {
  /* L'identité physique est l'ID, pas l'occurrence dans une faction. Garder
     la première représentation empêche de traiter une liste développée en
     doublons. */
  const idsVus = new Set();
  barrages = barrages.filter((b) => {
    if (b?.id == null || b.id === '') return true;
    if (idsVus.has(b.id)) return false;
    idsVus.add(b.id);
    return true;
  });
  const exclus = new Set(Array.isArray(exclusIds) ? exclusIds : []);
  const n = barrages.length;

  /* ---- ÉTAT DE TRAVAIL : ce que deviendrait chaque poste ---- */
  const etat = barrages.map((b) => ({
    id: b.id,
    item: b,
    lng: b.lng,
    lat: b.lat,
    route: b.route || '',
    factionId: b.factionId || '',
    protections: protectionsDe(b, { accidents, seuilAccidents, vip, nonEclaire, exclus }),
    action: 'aucune',
    score: scoreMaintien(b),
  }));

  const snaps = etat.map((e) => accrocher(graphe, e.lng, e.lat, RAYON_ACCROCHAGE_KM));
  /* LES ACCROCHAGES D'ORIGINE, figés avant toute proposition : `index.snaps`
     bouge à chaque déplacement essayé, et le tracé d'un conflit doit partir de
     la position où ce conflit a été constaté. */
  const snapsOrigine = [...snaps];
  const index = indexerAcces(graphe, snaps);

  const sansReseau = etat.filter((e, i) => !snaps[i]).length;

  /** Voisins en temps du poste `i`, recalculés à la demande. */
  const voisinsDe = (i) => tempsDepuis(graphe, index, snaps[i], seuilMinutes, i);

  /** Les conflits ACTUELS de `i` : assez proches en temps, et simultanés. */
  const conflitsDe = (i) => {
    const out = [];
    for (const [j, min] of voisinsDe(i)) {
      if (min >= seuilMinutes) continue;
      if (!factionsSeChevauchent(etat[i].factionId, etat[j].factionId)) continue;
      out.push({ index: j, minutes: min });
    }
    return out.sort((a, b) => a.minutes - b.minutes);
  };

  /* ---- L'ÉTAT INITIAL, pour le compte rendu ---- */
  const conflitsInitiaux = [];
  const dejaVu = new Set();
  for (let i = 0; i < n; i++) {
    for (const c of conflitsDe(i)) {
      const cle = i < c.index ? `${i}|${c.index}` : `${c.index}|${i}`;
      if (dejaVu.has(cle)) continue;
      dejaVu.add(cle);
      conflitsInitiaux.push({ a: i, b: c.index, minutes: c.minutes });
    }
  }
  conflitsInitiaux.sort((x, y) => x.minutes - y.minutes);

  /* ---- LA BOUCLE DE RÉSOLUTION ---- */
  const propositions = new Map(); // index -> proposition
  const traites = new Set();
  let iterations = 0;

  /**
   * QUI DOIT BOUGER DANS UN COUPLE. Le moins important des deux — le score de
   * maintien est celui qui sert déjà partout ailleurs à cet arbitrage. Un
   * poste protégé ne bouge jamais : sa position ou son horaire lui viennent
   * d'une contrainte (porte de ville, mission, accidents), pas d'un réglage.
   */
  const choisirCelui = (i, j) => {
    const pi = etat[i].protections.length > 0;
    const pj = etat[j].protections.length > 0;
    if (pi && pj) return null;
    if (pi) return j;
    if (pj) return i;
    if (etat[i].score !== etat[j].score) return etat[i].score < etat[j].score ? i : j;
    /* À score égal, celui qui a le plus de conflits : le déplacer en résout
       davantage d'un coup. */
    return conflitsDe(i).length >= conflitsDe(j).length ? i : j;
  };

  /**
   * ESSAI DE CHANGEMENT DE FACTION.
   *
   * On ne retient une faction que si elle ne crée AUCUN conflit ailleurs : le
   * poste ne doit pas résoudre sa gêne en allant gêner un troisième. C'est la
   * même exigence que pour le déplacement, et c'est ce qui distingue une
   * optimisation d'un déplacement de problème.
   *
   * À validité égale, la faction la moins chargée dans la brigade l'emporte :
   * les tours de service doivent rester équilibrés, sinon on résoudrait les
   * conflits en entassant tout le monde sur la faction 4.
   */
  const essayerFaction = (i) => {
    const actuelle = etat[i].factionId;
    const voisins = [...voisinsDe(i).entries()].filter(([, min]) => min < seuilMinutes);
    if (!voisins.length) return null;

    const charge = new Map();
    for (let k = 0; k < n; k++) {
      if (etat[k].item.bt !== etat[i].item.bt) continue;
      charge.set(etat[k].factionId, (charge.get(etat[k].factionId) ?? 0) + 1);
    }

    let meilleure = null;
    for (const f of FACTIONS) {
      if (f.id === actuelle) continue;
      const gene = voisins.some(([j]) => factionsSeChevauchent(f.id, etat[j].factionId));
      if (gene) continue;
      const poids = charge.get(f.id) ?? 0;
      if (!meilleure || poids < meilleure.poids) meilleure = { faction: f, poids };
    }
    return meilleure?.faction ?? null;
  };


  /**
   * LA FILE DES CONFLITS — construite une fois, complétée au besoin.
   *
   * ELLE NE SE RECALCULE PAS À CHAQUE TOUR, et c'est ce qui rend l'analyse
   * praticable. Une première version rebalayait tout le dispositif à chaque
   * itération pour trouver le conflit le plus serré : sur deux mille cinq cents
   * postes, cela faisait un Dijkstra par poste et par tour, et le calcul ne
   * rendait jamais la main.
   *
   * On part donc des conflits constatés au départ, du plus serré au plus
   * large, et l'on n'ajoute que ceux qu'un déplacement fait APPARAÎTRE — le
   * poste bougé est le seul dont le voisinage a changé.
   *
   * CHAQUE COUPLE N'EST EXAMINÉ QU'UNE FOIS (`paires`). Sans cette garde, un
   * couple dont les deux postes ont déjà été traités revenait à chaque tour :
   * le conflit subsistait, la boucle le retrouvait, et tournait jusqu'au
   * plafond d'itérations. C'est le défaut qui a fait dépasser les dix minutes
   * à la première version.
   */
  const clePaire = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const paires = new Set();
  const file = conflitsInitiaux.map((c) => ({ ...c }));
  for (const c of file) paires.add(clePaire(c.a, c.b));

  /** Le conflit est-il encore réel, dans l'état courant ? */
  const encoreEnConflit = (a, b) => {
    if (!factionsSeChevauchent(etat[a].factionId, etat[b].factionId)) return null;
    const t = voisinsDe(a).get(b);
    return t != null && t < seuilMinutes ? t : null;
  };

  /** Les conflits nés du déplacement de `i` — eux seuls sont nouveaux. */
  const ajouterNouveaux = (i) => {
    for (const [j, min] of voisinsDe(i)) {
      if (min >= seuilMinutes) continue;
      if (!factionsSeChevauchent(etat[i].factionId, etat[j].factionId)) continue;
      const cle = clePaire(i, j);
      if (paires.has(cle)) continue;
      paires.add(cle);
      file.push({ a: i, b: j, minutes: min });
    }
  };

  const debutMs = Date.now();
  let interrompue = false;
  let curseur = 0;
  while (curseur < file.length && iterations < maxIterations) {
    /* LE BUDGET — vérifié tous les cinquante tours, pour ne pas appeler
       l'horloge des milliers de fois inutilement. */
    if (iterations % 50 === 0 && Date.now() - debutMs > budgetMs) {
      interrompue = true;
      break;
    }
    iterations++;
    const conflit = file[curseur++];

    /* Le couple a pu être dénoué par une décision prise entre-temps. */
    const vivant = encoreEnConflit(conflit.a, conflit.b);
    if (vivant == null) continue;
    conflit.minutes = vivant;

    /**
     * QUI BOUGE — le moins important, et seulement s'il n'a pas déjà été
     * traité. Revenir sur une décision déjà prise ferait osciller le calcul :
     * on déplacerait A pour B, puis B pour A, sans fin.
     */
    let cible = choisirCelui(conflit.a, conflit.b);
    if (cible != null && traites.has(cible)) {
      const autre = cible === conflit.a ? conflit.b : conflit.a;
      cible = traites.has(autre) || etat[autre].protections.length ? null : autre;
    }

    if (cible == null) {
      /* Les deux sont protégés, ou déjà traités : le conflit reste, et il sera
         rendu tel quel dans `conflitsRestants`. On ne force rien. */
      continue;
    }

    const e = etat[cible];
    const voisinPrincipal = cible === conflit.a ? conflit.b : conflit.a;
    const avant = {
      lng: e.lng,
      lat: e.lat,
      route: e.route,
      factionId: e.factionId,
    };

    /**
     * LE BARRAGE EST INTOUCHABLE — plus aucun déplacement.
     *
     * L'optimisation a proposé de DÉPLACER un poste sur une autre route de sa
     * brigade. Le commandement l'a écarté : un barrage est une implantation,
     * pas une variable d'ajustement. Sa position, son type, son statut et ses
     * informations métier ne bougent plus, quel que soit le conflit.
     *
     * Ce qui se réaffecte, c'est le TOUR DE SERVICE. Le poste reste où il est
     * et l'on change quand il est tenu — d'où une seule action possible, et un
     * maintien explicite quand elle n'est pas disponible.
     */

    /* ---- A. CHANGER DE FACTION ---- */
    const faction = essayerFaction(cible);
    if (faction) {
      e.factionId = faction.id;
      e.action = 'changer_faction';
      propositions.set(cible, {
        action: 'changer_faction',
        avant,
        apres: { lng: e.lng, lat: e.lat, route: e.route, factionId: faction.id },
        conflitAvec: voisinPrincipal,
        minutesAvant: conflit.minutes,
        minutesApres: null,
      });
      traites.add(cible);
      ajouterNouveaux(cible);
      continue;
    }

    /* ---- B. CONSERVER ---- */
    e.action = 'conserver';
    propositions.set(cible, {
      action: 'conserver',
      avant,
      apres: null,
      conflitAvec: voisinPrincipal,
      minutesAvant: conflit.minutes,
      minutesApres: null,
    });
    traites.add(cible);
  }

  /* ---- L'ÉTAT FINAL, recalculé ---- */
  const conflitsRestants = [];
  const vus = new Set();
  for (let i = 0; i < n; i++) {
    for (const c of conflitsDe(i)) {
      const cle = i < c.index ? `${i}|${c.index}` : `${c.index}|${i}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      conflitsRestants.push({ a: i, b: c.index, minutes: c.minutes });
    }
  }

  /* ---- MISE EN FORME ---- */
  const nomDe = (i) => etat[i].item.nom || etat[i].id;
  const libelleFaction = (id) => {
    const f = id ? factionParId(id) : null;
    return f ? `${f.nom} (${f.libelle})` : 'faction non renseignée';
  };

  /**
   * LE TRACÉ ROUTIER DU CONFLIT — la vraie route, pas un trait entre deux points.
   *
   * Calculé sur le MÊME graphe et avec le MÊME coût que la décision : la durée
   * rendue ici est celle qui a déclaré le conflit. Un second calcul, fût-il
   * proche, aurait fini par afficher une durée que la décision ne reconnaissait
   * pas.
   *
   * `snapsOrigine` porte les accrochages d'AVANT toute proposition : c'est
   * depuis la position actuelle du poste que le conflit a été constaté, et
   * c'est donc elle qu'il faut tracer. `index.snaps` a pu bouger entre-temps.
   */
  let tracesRendues = 0;
  let tracesOmises = 0;
  const traceDuConflit = (snapA, snapB) => {
    if (!snapA || !snapB) return null;
    if (tracesRendues >= MAX_TRACES) {
      tracesOmises++;
      return null;
    }
    const r = itineraireDetaille(graphe, snapA, snapB, seuilMinutes * 2);
    if (!r) return null;
    tracesRendues++;
    return {
      km: r.km,
      minutes: r.minutes,
      /* Arrondi à cinq décimales — la précision du dépôt — et points
         consécutifs identiques écartés : le tracé pèse deux fois moins sans
         qu'on voie la différence. */
      coords: r.coords
        .map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])
        .filter((p, k, t) => k === 0 || p[0] !== t[k - 1][0] || p[1] !== t[k - 1][1]),
    };
  };

  /* Les conflits les plus serrés d'abord : ce sont eux qu'on regarde, et ce
     sont eux qui doivent avoir leur tracé quand le plafond mord. */
  const ordreTraces = [...propositions.entries()].sort(
    (x, y) => x[1].minutesAvant - y[1].minutesAvant,
  );
  const traces = new Map();
  for (const [i, p] of ordreTraces) {
    traces.set(i, traceDuConflit(snapsOrigine[i], snapsOrigine[p.conflitAvec]));
  }

  const sorties = [...propositions.entries()].map(([i, p]) => {
    const b = etat[i].item;
    const voisin = etat[p.conflitAvec];
    const raisons = [
      `Compagnie ${b.cie ?? '—'} · Brigade ${b.bt ?? '—'}`,
      `Conflit avec « ${nomDe(p.conflitAvec)} » (${voisin.item.bt ?? '—'})`,
      `Temps de trajet par la route : ${minutes(p.minutesAvant)} — sous le seuil de ${seuilMinutes} min`,
      `Les deux postes tiennent ${libelleFaction(p.avant.factionId)} : ils sont actifs en même temps`,
    ];

    if (p.action === 'changer_faction') {
      raisons.push(
        `Motif : conflit d’affectation — ${libelleFaction(p.avant.factionId)} est déjà tenue à moins d’une heure de route`,
        `Réaffectation proposée : ${libelleFaction(p.avant.factionId)} → ${libelleFaction(p.apres.factionId)}`,
        'Les deux postes ne seront plus actifs en même temps',
        'LE BARRAGE NE BOUGE PAS : position, type, statut et informations métier inchangés',
      );
    } else {
      raisons.push(
        'Aucune faction libre : toutes sont déjà tenues à moins d’une heure de route',
        'Action : barrage conservé, affectation inchangée',
        'Aucun déplacement, aucun retrait — le barrage est intouchable',
      );
    }

    if (etat[i].protections.length) {
      raisons.push(
        `Protections : ${etat[i].protections.map((m) => LIBELLE_PROTECTION[m] ?? m).join(', ')}`,
      );
    }

    return {
      id: b.id,
      nom: b.nom || 'Barrage sans nom',
      type: b.type,
      bt: b.bt ?? null,
      cie: b.cie ?? null,
      reg: b.reg ?? null,
      action: p.action,
      /**
       * LA POSITION EST RENDUE, ET ELLE NE CHANGE JAMAIS.
       *
       * Elle sert à poser le repère sur la carte, pas à proposer un ailleurs :
       * il n'existe plus de « nouvelle position », parce qu'un barrage ne se
       * déplace plus. Seule la faction varie.
       */
      lng: p.avant.lng,
      lat: p.avant.lat,
      route: p.avant.route,
      factionId: p.avant.factionId,
      nouvelleFactionId: p.apres?.factionId ?? null,
      /**
       * LE CONFLIT, AVEC SA ROUTE.
       *
       * `trace` porte la géométrie réelle du trajet, sa longueur PAR LA ROUTE
       * et sa durée. C'est ce qui permet à la carte de dessiner l'itinéraire
       * plutôt qu'un trait, et d'écrire « 32,4 km · 42 min » à côté.
       *
       * `chevauchementPct` dit à quel point les deux postes sont simultanés :
       * 100 % pour deux factions identiques, 0 pour deux factions disjointes —
       * auquel cas il n'y aurait pas de conflit du tout.
       */
      conflit: {
        id: voisin.id,
        nom: nomDe(p.conflitAvec),
        bt: voisin.item.bt ?? null,
        cie: voisin.item.cie ?? null,
        lng: etat[p.conflitAvec].lng,
        lat: etat[p.conflitAvec].lat,
        factionId: voisin.factionId,
        minutes: p.minutesAvant,
        km: traces.get(i)?.km ?? null,
        trace: traces.get(i)?.coords ?? null,
        chevauchementPct:
          factionsSeChevauchent(p.avant.factionId, voisin.factionId) ? 100 : 0,
      },
      /**
       * CONFLIT OU RÉSOLU — l'état APRÈS la proposition.
       *
       * Une réaffectation le résout en supprimant la simultanéité ; un maintien
       * ne résout rien, et le dit. Le temps de trajet, lui, ne change pas :
       * les deux postes restent où ils sont.
       */
      statut:
        p.action === 'changer_faction'
          ? factionsSeChevauchent(p.apres.factionId, voisin.factionId)
            ? 'conflit'
            : 'resolu'
          : 'conflit',
      minutesAvant: p.minutesAvant,
      minutesApres: p.minutesApres,
      raisons,
      raison: raisons.join(' · '),
      protections: etat[i].protections,
    };
  });

  const parAction = { changer_faction: 0, conserver: 0 };
  for (const s of sorties) parAction[s.action]++;

  /**
   * LES PROPOSITIONS RENDUES — les plus serrées d'abord.
   *
   * Un maintien n'apprend rien tant qu'il reste des changements à examiner :
   * les actions applicables passent donc devant, puis les conflits les plus
   * courts. Le reste est compté.
   */
  const rang = { changer_faction: 0, conserver: 1 };
  const triees = [...sorties].sort(
    (x, y) => rang[x.action] - rang[y.action] || x.minutesAvant - y.minutesAvant,
  );
  const rendues = triees.slice(0, MAX_PROPOSITIONS);
  const propositionsOmises = triees.length - rendues.length;

  const parFactionApres = Object.fromEntries(FACTIONS.map((f) => [f.id, 0]));
  for (const e of etat) if (parFactionApres[e.factionId] != null) parFactionApres[e.factionId]++;

  return {
    mode: 'AUTOMATIQUE',
    critere: 'temps_trajet_routier',
    seuilMinutes,
    resume: {
      barragesAnalyses: n,
      sansReseau,
      conflitsAvant: conflitsInitiaux.length,
      conflitsApres: conflitsRestants.length,
      conflitsResolus: conflitsInitiaux.length - conflitsRestants.length,
      propositions: sorties.length,
      /* Plus aucun déplacement : le barrage est intouchable. Le champ reste à
         zéro pour les écrans qui le liraient encore, et disparaîtra avec eux. */
      deplacements: 0,
      reaffectations: parAction.changer_faction,
      changementsFaction: parAction.changer_faction,
      maintiens: parAction.conserver,
      /* Aucun retrait : ce n'est plus une issue de l'optimisation automatique. */
      retraits: 0,
      repartitionFactionApres: parFactionApres,
      /* Combien de conflits portent leur tracé routier, et combien en manquent
         — voir MAX_TRACES. Dit, jamais masqué. */
      tracesRendues,
      tracesOmises,
      /* Ce qui n'a pas été rendu, et ce qui n'a pas été examiné — dits, jamais
         masqués : un résultat partiel qui se présente comme complet est pire
         qu'un résultat lent. */
      propositionsTotal: sorties.length,
      propositionsOmises,
      interrompue,
      conflitsNonExamines: interrompue ? Math.max(0, file.length - curseur) : 0,
      dureeMs: Date.now() - debutMs,
      iterations,
    },
    criteres: [
      'temps de trajet routier',
      'faction / chevauchement horaire',
      'brigade',
      'compagnie',
      'protections',
    ],
    propositions: rendues,
    conflitsRestants: conflitsRestants.map((c) => ({
      a: { id: etat[c.a].id, nom: nomDe(c.a) },
      b: { id: etat[c.b].id, nom: nomDe(c.b) },
      minutes: c.minutes,
    })),
  };
}
