/**
 * TEMPS DE TRAJET PAR LA ROUTE — combien de minutes séparent réellement deux
 * postes.
 *
 * POURQUOI PAS LA DISTANCE. L'optimisation raisonnait en kilomètres. Deux
 * postes à 12 km l'un de l'autre sont proches sur une nationale rectiligne et
 * lointains de part et d'autre d'un massif, où la route fait quarante minutes
 * de lacets. La distance dit la géométrie ; le temps dit ce que l'usager subit
 * et ce qu'une patrouille met à basculer d'un poste à l'autre. C'est le second
 * qui décide si deux postes font double emploi.
 *
 * POURQUOI PAS UN CALCUL PAR PAIRE. Mesurer chaque couple de postes demanderait
 * un A* par paire : sur deux mille cinq cents postes dont chacun a des dizaines
 * de voisins à moins de quarante minutes, cela fait des centaines de milliers
 * d'itinéraires, et un calcul qui ne rend jamais la main.
 *
 * On procède donc à l'envers : UN SEUL DIJKSTRA PAR POSTE, borné au budget de
 * temps, qui récolte au passage tous les postes atteints. Le coût ne dépend
 * plus du nombre de voisins mais de l'étendue que quarante minutes couvrent —
 * et il s'arrête de lui-même dès que le budget est dépassé.
 *
 * LE COÛT EST EN HEURES, comme dans `src/routage.js` (critère « rapide ») :
 * longueur de l'arête divisée par sa vitesse. C'est la même formule des deux
 * côtés ; en écrire une autre ici aurait donné deux durées pour le même trajet.
 */

import { pointsArete, distanceKm, refArete } from './routage.mjs';

/** File de priorité minimale — un tas binaire, sans dépendance. */
class Tas {
  constructor() {
    this.cles = [];
    this.valeurs = [];
  }
  get taille() {
    return this.cles.length;
  }
  pousser(cle, valeur) {
    this.cles.push(cle);
    this.valeurs.push(valeur);
    let i = this.cles.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cles[p] <= this.cles[i]) break;
      [this.cles[p], this.cles[i]] = [this.cles[i], this.cles[p]];
      [this.valeurs[p], this.valeurs[i]] = [this.valeurs[i], this.valeurs[p]];
      i = p;
    }
  }
  extraire() {
    const sommet = this.valeurs[0];
    const derniereCle = this.cles.pop();
    const derniereValeur = this.valeurs.pop();
    if (this.cles.length) {
      this.cles[0] = derniereCle;
      this.valeurs[0] = derniereValeur;
      let i = 0;
      for (;;) {
        const g = 2 * i + 1;
        const d = g + 1;
        let min = i;
        if (g < this.cles.length && this.cles[g] < this.cles[min]) min = g;
        if (d < this.cles.length && this.cles[d] < this.cles[min]) min = d;
        if (min === i) break;
        [this.cles[min], this.cles[i]] = [this.cles[i], this.cles[min]];
        [this.valeurs[min], this.valeurs[i]] = [this.valeurs[i], this.valeurs[min]];
        i = min;
      }
    }
    return sommet;
  }
}

const praticable = (g, i, depuis) => {
  const sens = g.SENS[i];
  if (sens === 0) return true;
  return sens === 1 ? g.A[i] === depuis : g.B[i] === depuis;
};

/** Vitesse d'une arête, jamais nulle : une division par zéro rendrait `Infinity`. */
const vitesse = (g, i) => Math.max(1, g.VIT[i]);

/**
 * LES DEUX POINTS D'ACCÈS D'UN POSTE AU RÉSEAU.
 *
 * Un poste est accroché AU MILIEU d'une arête (voir `accrocher`), pas sur un
 * sommet. Pour entrer dans le graphe il faut donc parcourir un bout de cette
 * arête, vers l'une ou l'autre de ses extrémités — d'où deux points d'entrée,
 * chacun avec son coût. Les ignorer ferait commencer tous les trajets au
 * carrefour le plus proche, et sous-estimerait chaque durée.
 */
const accesDe = (g, snap) => [
  { noeud: g.A[snap.arete], heures: snap.versA / vitesse(g, snap.arete) },
  { noeud: g.B[snap.arete], heures: snap.versB / vitesse(g, snap.arete) },
];

/**
 * TEMPS DE TRAJET ENTRE POSTES, en minutes, borné par `budgetMin`.
 *
 * `snaps` est le tableau des accrochages au réseau, dans le même ordre que les
 * postes. Un poste sans accrochage (trop loin de toute route connue) est
 * ignoré : il n'a pas de voisin routier, et lui en inventer un serait faux.
 *
 * @returns {Array<Array<{index:number, minutes:number}>>} pour chaque poste,
 *   ses voisins atteints dans le budget, du plus proche au plus lointain.
 */
/**
 * L'INDEX D'ACCÈS — quels postes entrent dans le réseau par quel sommet.
 *
 * Construit UNE FOIS pour tout un calcul, et relu à chaque Dijkstra. Le
 * reconstruire à chaque mesure coûterait un parcours complet des postes par
 * trajet, ce qui annulerait le gain du Dijkstra borné — c'est exactement ce
 * qui rendait la première version inutilisable dès qu'on recalculait après un
 * déplacement.
 *
 * `remplacer` permet de bouger UN poste sans tout reconstruire : c'est le
 * geste de l'optimisation quand elle essaie un emplacement.
 */
export function indexerAcces(graphe, snaps) {
  const parNoeud = new Map();
  const parArete = new Map();

  const poser = (i) => {
    const snap = snaps[i];
    if (!snap) return;
    for (const a of accesDe(graphe, snap)) {
      if (!parNoeud.has(a.noeud)) parNoeud.set(a.noeud, []);
      parNoeud.get(a.noeud).push({ index: i, heures: a.heures });
    }
    if (!parArete.has(snap.arete)) parArete.set(snap.arete, []);
    parArete.get(snap.arete).push(i);
  };

  for (let i = 0; i < snaps.length; i++) poser(i);

  return {
    snaps,
    parNoeud,
    parArete,
    /** Le poste `i` a changé de place : on refait ses entrées, et elles seules. */
    remplacer(i, snap) {
      const ancien = snaps[i];
      if (ancien) {
        for (const a of accesDe(graphe, ancien)) {
          const lot = parNoeud.get(a.noeud);
          if (lot) {
            const k = lot.findIndex((x) => x.index === i);
            if (k > -1) lot.splice(k, 1);
          }
        }
        const lotArete = parArete.get(ancien.arete);
        if (lotArete) {
          const k = lotArete.indexOf(i);
          if (k > -1) lotArete.splice(k, 1);
        }
      }
      snaps[i] = snap;
      poser(i);
    },
  };
}

/**
 * TEMPS DE TRAJET D'UN POINT VERS TOUS LES POSTES ATTEINTS, en minutes.
 *
 * Un seul Dijkstra borné par `budgetMin`. `exclure` écarte un poste du
 * résultat — celui qu'on est en train de déplacer, qui ne doit pas se compter
 * comme son propre voisin.
 *
 * @returns {Map<number, number>} index de poste -> minutes.
 */
export function tempsDepuis(graphe, index, snapDepart, budgetMin, exclure = -1) {
  const resultat = new Map();
  if (!snapDepart) return resultat;
  const budgetHeures = budgetMin / 60;

  /* Même arête : le trajet ne passe par aucun sommet. */
  for (const j of index.parArete.get(snapDepart.arete) ?? []) {
    if (j === exclure) continue;
    const autre = index.snaps[j];
    if (!autre) continue;
    const km = Math.abs(autre.versA - snapDepart.versA);
    const min = (km / vitesse(graphe, snapDepart.arete)) * 60;
    if (min <= budgetMin) resultat.set(j, min);
  }

  const cout = new Map();
  const clos = new Set();
  const tas = new Tas();
  for (const a of accesDe(graphe, snapDepart)) {
    const connu = cout.get(a.noeud);
    if (connu == null || a.heures < connu) {
      cout.set(a.noeud, a.heures);
      tas.pousser(a.heures, a.noeud);
    }
  }

  while (tas.taille) {
    const s = tas.extraire();
    if (clos.has(s)) continue;
    clos.add(s);
    const c = cout.get(s);
    /* LA BORNE : tout ce qui reste dans le tas coûte au moins autant. */
    if (c > budgetHeures) break;

    for (const { index: j, heures } of index.parNoeud.get(s) ?? []) {
      if (j === exclure) continue;
      const min = (c + heures) * 60;
      if (min > budgetMin) continue;
      const connu = resultat.get(j);
      if (connu == null || min < connu) resultat.set(j, min);
    }

    for (let k = graphe.debuts[s]; k < graphe.debuts[s + 1]; k++) {
      const i = graphe.incident[k];
      if (!praticable(graphe, i, s)) continue;
      const autre = graphe.A[i] === s ? graphe.B[i] : graphe.A[i];
      if (clos.has(autre)) continue;
      const nouveau = c + graphe.M[i] / 1000 / vitesse(graphe, i);
      if (nouveau > budgetHeures) continue;
      const connu = cout.get(autre);
      if (connu == null || nouveau < connu) {
        cout.set(autre, nouveau);
        tas.pousser(nouveau, autre);
      }
    }
  }

  for (const [j, m] of resultat) resultat.set(j, Math.round(m * 10) / 10);
  return resultat;
}

/**
 * LES VOISINS EN TEMPS DE TOUS LES POSTES — un Dijkstra borné par poste.
 *
 * @returns {Array<Array<{index:number, minutes:number}>>} du plus proche au
 *   plus lointain.
 */
export function voisinsEnTemps(graphe, snaps, budgetMin) {
  const index = indexerAcces(graphe, snaps);
  return snaps.map((snap, i) =>
    snap
      ? [...tempsDepuis(graphe, index, snap, budgetMin, i).entries()]
          .map(([j, minutes]) => ({ index: j, minutes }))
          .sort((a, b) => a.minutes - b.minutes)
      : [],
  );
}

/**
 * L'ITINÉRAIRE RÉEL ENTRE DEUX POSTES — géométrie, distance et durée.
 *
 * POURQUOI CETTE FONCTION EXISTE. `tempsDepuis` répond « combien de minutes »,
 * et c'est tout ce qu'il faut pour DÉCIDER. Mais pour MONTRER un conflit sur la
 * carte, il faut le tracé : une ligne droite entre deux postes ne dit rien de
 * la route qui les relie, et la dessiner en la présentant comme l'itinéraire
 * serait un mensonge d'affichage. Le commandement doit voir par où l'on passe.
 *
 * C'EST LE MÊME CALCUL QUE LA DÉCISION. Même coût (longueur ÷ vitesse), même
 * graphe, mêmes sens uniques : la durée rendue ici est celle qui a déclaré le
 * conflit, au dixième de minute près. Un second calcul, fût-il proche, aurait
 * fini par afficher une durée que la décision ne reconnaissait pas.
 *
 * Dijkstra AVEC PARENTS : on mémorise, pour chaque sommet atteint, l'arête par
 * laquelle on y est arrivé. Le chemin se relit ensuite à l'envers, et chaque
 * arête rend sa géométrie complète — d'où un tracé qui suit la chaussée, et non
 * les seuls carrefours.
 *
 * `routes` : les identifiants de route empruntés, dans l'ordre, sans doublon
 * consécutif — pour dire « par la N1 puis la RR322 » à côté du tracé.
 *
 * @returns {{minutes, km, coords: Array<[number,number]>, routes: string[]}|null}
 */
export function itineraireDetaille(graphe, snapDepart, snapArrivee, budgetMin = 240, mode = 'temps') {
  if (!snapDepart || !snapArrivee) return null;
  const distanceOnly = mode === 'distance';
  const budgetCout = distanceOnly ? budgetMin : budgetMin / 60;
  const acces = (snap) => distanceOnly
    ? [
        { noeud: graphe.A[snap.arete], cout: snap.versA },
        { noeud: graphe.B[snap.arete], cout: snap.versB },
      ]
    : accesDe(graphe, snap).map((a) => ({ noeud: a.noeud, cout: a.heures }));
  const coutArete = (i) => graphe.M[i] / 1000 / (distanceOnly ? 1 : vitesse(graphe, i));

  /**
   * MÊME ARÊTE : le trajet ne passe par aucun sommet.
   *
   * On DÉCOUPE la géométrie de l'arête entre les deux accrochages au lieu de
   * tirer un segment d'un point à l'autre. Une arête est une polyligne : deux
   * postes distants de deux kilomètres sur une route sinueuse ne sont pas
   * reliés par une droite, et la tracer ainsi serait exactement le mensonge
   * d'affichage qu'on cherche à éviter.
   */
  if (snapDepart.arete === snapArrivee.arete) {
    const km = Math.abs(snapArrivee.versA - snapDepart.versA);
    const a = Math.min(snapDepart.versA, snapArrivee.versA);
    const b = Math.max(snapDepart.versA, snapArrivee.versA);
    const pts = pointsArete(graphe, snapDepart.arete);

    /* On avance le long de l'arête et on garde les points compris entre les
       deux accrochages, bornes incluses. */
    const entre = [];
    let parcouru = 0;
    for (let k = 1; k < pts.length; k++) {
      const seg = distanceKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      const debut = parcouru;
      const fin = parcouru + seg;
      if (fin >= a && debut <= b) {
        if (!entre.length) entre.push(pts[k - 1]);
        entre.push(pts[k]);
      }
      parcouru = fin;
      if (debut > b) break;
    }

    const depart = [snapDepart.lng, snapDepart.lat];
    const arrivee = [snapArrivee.lng, snapArrivee.lat];
    /* Du départ vers l'arrivée : si l'arête est parcourue à rebours, on
       retourne les points intermédiaires. */
    const milieu = snapDepart.versA <= snapArrivee.versA ? entre : [...entre].reverse();

    return {
      minutes: Math.round((km / vitesse(graphe, snapDepart.arete)) * 60 * 10) / 10,
      km: Math.round(km * 100) / 100,
      coords: [depart, ...milieu.map((p) => [p[0], p[1]]), arrivee],
      routes: refArete(graphe, snapDepart.arete) ? [refArete(graphe, snapDepart.arete)] : [],
    };
  }

  /* Les deux entrées possibles de l'arrivée, avec le coût du dernier bout. */
  const finHeures = new Map();
  for (const a of acces(snapArrivee)) {
    const connu = finHeures.get(a.noeud);
    if (connu == null || a.cout < connu) finHeures.set(a.noeud, a.cout);
  }

  const cout = new Map();
  const viaArete = new Map(); // sommet -> {arete, depuis}
  const clos = new Set();
  const tas = new Tas();
  for (const a of acces(snapDepart)) {
    const connu = cout.get(a.noeud);
    if (connu == null || a.cout < connu) {
      cout.set(a.noeud, a.cout);
      tas.pousser(a.cout, a.noeud);
    }
  }

  let arrivee = null;
  let meilleur = Infinity;

  while (tas.taille) {
    const s = tas.extraire();
    if (clos.has(s)) continue;
    clos.add(s);
    const c = cout.get(s);
    if (c > budgetCout || c >= meilleur) break;

    const reste = finHeures.get(s);
    if (reste != null && c + reste < meilleur) {
      meilleur = c + reste;
      arrivee = s;
    }

    for (let k = graphe.debuts[s]; k < graphe.debuts[s + 1]; k++) {
      const i = graphe.incident[k];
      if (!praticable(graphe, i, s)) continue;
      const autre = graphe.A[i] === s ? graphe.B[i] : graphe.A[i];
      if (clos.has(autre)) continue;
      const nouveau = c + coutArete(i);
      if (nouveau > budgetCout) continue;
      const connu = cout.get(autre);
      if (connu == null || nouveau < connu) {
        cout.set(autre, nouveau);
        viaArete.set(autre, { arete: i, depuis: s });
        tas.pousser(nouveau, autre);
      }
    }
  }

  if (arrivee == null || !Number.isFinite(meilleur)) return null;

  /* ---- RELECTURE DU CHEMIN, de l'arrivée vers le départ ---- */
  const aretes = [];
  let s = arrivee;
  let garde = 0;
  while (viaArete.has(s) && garde++ < 100_000) {
    const { arete, depuis } = viaArete.get(s);
    aretes.push({ arete, de: depuis, vers: s });
    s = depuis;
  }
  aretes.reverse();

  /* ---- GÉOMÉTRIE : chaque arête rend ses points, dans le bon sens ---- */
  const coords = [[snapDepart.lng, snapDepart.lat]];
  let km = 0;
  let heures = (snapDepart.versA / vitesse(graphe, snapDepart.arete)) / 2;
  for (const { arete, de } of aretes) {
    const pts = pointsArete(graphe, arete);
    /* `pointsArete` va toujours de A vers B : on retourne quand on l'emprunte
       dans l'autre sens, sinon le tracé ferait des allers-retours. */
    const ordonnes = graphe.A[arete] === de ? pts : [...pts].reverse();
    for (const p of ordonnes) {
      const dernier = coords[coords.length - 1];
      if (!dernier || dernier[0] !== p[0] || dernier[1] !== p[1]) coords.push([p[0], p[1]]);
    }
    const dKm = graphe.M[arete] / 1000;
    km += dKm;
    heures += dKm / vitesse(graphe, arete);
  }
  heures += (snapArrivee.versA / vitesse(graphe, snapArrivee.arete)) / 2;
  coords.push([snapArrivee.lng, snapArrivee.lat]);

  const dureeEstimee = Number.isFinite(heures) && heures > 0 ? Math.max(1, Math.round(heures * 60)) : null;

  return {
    minutes: !distanceOnly && Number.isFinite(meilleur) ? Math.round(meilleur * 60 * 10) / 10 : dureeEstimee,
    /* La distance vient des longueurs d'arêtes du graphe, pas de la somme des
       segments dessinés : c'est la même source que la durée. */
    km: Math.round((distanceOnly ? meilleur : km) * 100) / 100,
    coords,
    routes: [snapDepart.arete, ...aretes.map((a) => a.arete), snapArrivee.arete]
      .map((i) => refArete(graphe, i))
      .filter((r, k, t) => r && r !== t[k - 1]),
  };
}

/**
 * LE TRACÉ ROUTIER ENTRE DEUX POSTES — le plus court des deux sens, orienté
 * du premier vers le second, par la même recherche que `itineraireDetaille`.
 *
 * Partagé par l'optimisation automatique (déplacement, conflits avant/après)
 * et manuelle (conflit avec le voisin) : la carte ne dessine jamais d'autre
 * géométrie que celle calculée ici, sur le graphe routier hors ligne.
 *
 * Le tracé part de la position exacte du premier poste et arrive exactement
 * sur le second : l'accrochage n'est qu'à quelques mètres, mais sans ces deux
 * points le trait s'arrêterait à côté du repère.
 *
 * @returns {{km: number, minutes: number|null, routes: string[], trace: Array<[number, number]>}|null}
 */
export function tracerEntrePostes(graphe, a, b, snapA, snapB) {
  if (!a || !b || !snapA || !snapB) return null;
  const aller = itineraireDetaille(graphe, snapA, snapB, 500, 'distance');
  const retour = itineraireDetaille(graphe, snapB, snapA, 500, 'distance');
  const best = !aller ? retour : !retour || aller.km <= retour.km ? aller : retour;
  if (!best?.coords) return null;
  const ordonne = best === aller ? best.coords : [...best.coords].reverse();
  return {
    km: best.km,
    minutes: best.minutes ?? null,
    routes: best === aller ? best.routes ?? [] : [...(best.routes ?? [])].reverse(),
    trace: [[a.lng, a.lat], ...ordonne, [b.lng, b.lat]].map(([lng, lat]) => [+lng.toFixed(5), +lat.toFixed(5)]),
  };
}
