/**
 * Distance réelle entre barrages : détection des rapprochements et sélection
 * des points noirs à transformer en barrages-projets.
 *
 * Le préfiltre à vol d'oiseau (`distanceKm`) élimine la quasi-totalité des
 * paires sans appel A* : la distance réelle par la route est TOUJOURS
 * supérieure ou égale à la distance à vol d'oiseau, donc une paire déjà trop
 * éloignée à vol d'oiseau ne peut jamais repasser sous le seuil une fois
 * mesurée sur le réseau — le préfiltre n'écarte donc jamais à tort.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  distanceKm,
  accrocher,
  itineraire,
  refArete,
  nomArete,
  classeArete,
  chargerGraphe,
  /* Géométrie complète d'une arête — nécessaire pour échantillonner le réseau
     lors du redéploiement (voir `proposerRedeploiement`). */
  pointsArete,
} from './routage.mjs';
import { scoreImportance } from './pointsnoirs.mjs';
import { estTypeBarrage, estIntouchable } from './depot.mjs';

/**
 * Charge le graphe routier une fois au démarrage, depuis la même couche que
 * celle livrée à la carte (`racineCouches/graphe_routier.json`, produite par
 * `npm run build:roads`). Absent : `null`, dégradation explicite plutôt qu'un
 * crash — alertes et génération restent désactivées, le reste du service
 * continue de fonctionner (voir `serveur/geo.mjs`, même principe pour les
 * contours).
 */
export function chargerGrapheRoutier(chemin) {
  if (!existsSync(chemin)) return null;
  try {
    return chargerGraphe(JSON.parse(readFileSync(chemin, 'utf8')));
  } catch {
    return null;
  }
}

const RAYON_ACCROCHAGE_KM = 30; // même rayon que l'outil « Distances » côté navigateur

/**
 * Distance réelle par la route entre deux points, ou `null` si l'un des deux
 * est trop loin de toute route connue, ou si le réseau retenu ne les relie pas.
 */
export function distanceReelleKm(graphe, ptA, ptB) {
  const accA = accrocher(graphe, ptA[0], ptA[1], RAYON_ACCROCHAGE_KM);
  const accB = accrocher(graphe, ptB[0], ptB[1], RAYON_ACCROCHAGE_KM);
  if (!accA || !accB) return null;
  const r = itineraire(graphe, accA, accB);
  return r ? r.km : null;
}

/**
 * Recalcule les alertes de rapprochement entre TOUS les barrages
 * (`barrage_fixe`/`barrage_mobile`). Recalcul complet à chaque écriture ; le
 * préfiltre à vol d'oiseau écarte l'immense majorité des paires sans toucher
 * au graphe routier.
 *
 * TOUT EST ENREGISTRÉ EN UNE FOIS
 * -------------------------------
 * Le balayage est quadratique : à mille barrages, il examine plus d'un demi-
 * million de paires. Tant que chaque paire modifiée provoquait sa propre
 * écriture, poser un seul barrage réécrivait le fichier des alertes des
 * milliers de fois — le serveur occupait un cœur entier pendant des minutes,
 * et la rafale de renommages finissait par échouer sur un verrou de Windows,
 * faisant échouer la création elle-même. Le groupement ramène l'ensemble du
 * recalcul à une écriture unique.
 */
/**
 * RECALCUL DES ALERTES DE PROXIMITÉ.
 *
 * `idModifie` restreint le travail aux paires qui CONTIENNENT ce barrage.
 * Absent, on reprend tout — c'est ce qu'il faut au démarrage, après un import
 * ou une opération en lot.
 *
 * POURQUOI CE PARAMÈTRE EXISTE, mesuré sur le dispositif réel de 1 122
 * barrages :
 *
 *   paires examinées à chaque écriture   628 881
 *   paires réellement concernées           1 121
 *   travail inutile                        561 fois
 *
 * Et ce n'est pas un simple gâchis de cycles : 1 951 de ces paires passent le
 * filtre du vol d'oiseau et déclenchent chacune une recherche d'itinéraire sur
 * le réseau routier. Une seule saisie de barrage coûtait ainsi 1,6 seconde
 * avec 145 barrages — le geste principal de l'application, sur des données
 * dix fois moindres que le dispositif réel.
 *
 * Un barrage déplacé, créé ou retiré ne peut modifier QUE les paires dont il
 * fait partie : les distances entre deux autres postes n'ont pas bougé. La
 * restriction est donc exacte, pas une approximation.
 *
 * @param {object} depotAlertes
 * @param {Array}  marquages
 * @param {object} graphe        réseau routier
 * @param {number} seuilKm
 * @param {string|null} [idModifie]  n'examiner que les paires de ce barrage
 */
export function recalculerAlertes(depotAlertes, marquages, graphe, seuilKm, idModifie = null) {
  const barrages = marquages.filter((m) => estTypeBarrage(m.type));

  /*
   * Paires qui portent DÉJÀ une alerte, relevées une fois pour toutes.
   *
   * Sans cet index, chaque paire écartée par le vol d'oiseau appelait quand
   * même la suppression, laquelle reparcourt toute la liste des alertes : un
   * balayage déjà quadratique devenait cubique. C'est ce qui faisait tourner
   * le serveur à plein régime pendant des minutes. Une paire qui n'a pas
   * d'alerte n'a rien à supprimer — on ne la touche plus.
   */
  const avecAlerte = new Set(
    depotAlertes.tous().map((a) => [a.checkpointAId, a.checkpointBId].sort().join('|'))
  );
  const aUneAlerte = (aId, bId) => avecAlerte.has([aId, bId].sort().join('|'));

  /** Une paire, examinée. Le corps de boucle, sorti pour servir aux deux cas. */
  const examiner = (a, b) => {
    const volOiseau = distanceKm(a.lng, a.lat, b.lng, b.lat);
    if (volOiseau > seuilKm) {
      if (aUneAlerte(a.id, b.id)) depotAlertes.supprimerPourPaire(a.id, b.id);
      return;
    }

    const reelle = distanceReelleKm(graphe, [a.lng, a.lat], [b.lng, b.lat]);
    if (reelle != null && reelle < seuilKm) {
      depotAlertes.upsertPourPaire(a.id, b.id, { roadDistanceKm: reelle, thresholdKm: seuilKm });
    } else if (aUneAlerte(a.id, b.id)) {
      depotAlertes.supprimerPourPaire(a.id, b.id);
    }
  };

  depotAlertes.grouperEcritures(() => {
    if (idModifie) {
      /**
       * UN SEUL BARRAGE A CHANGÉ.
       *
       * S'il a été SUPPRIMÉ, il n'est plus dans `barrages` : ses alertes ont
       * déjà été retirées par l'appelant (`supprimerConcernant`), et il n'y a
       * rien à réexaminer. On sort — sans reprendre tout le dispositif, ce qui
       * était précisément le défaut.
       */
      const cible = barrages.find((m) => m.id === idModifie);
      if (!cible) return;

      for (const autre of barrages) {
        if (autre.id !== cible.id) examiner(cible, autre);
      }
      return;
    }

    /* Reprise complète : démarrage, import, opération en lot. */
    for (let i = 0; i < barrages.length; i++) {
      for (let j = i + 1; j < barrages.length; j++) {
        examiner(barrages[i], barrages[j]);
      }
    }
  });
}

/** Vrai si `a` et `b` sont à moins de `seuilKm` l'un de l'autre, par la route. */
function tropProcheDe(graphe, a, b, seuilKm) {
  const volOiseau = distanceKm(a.lng, a.lat, b.lng, b.lat);
  if (volOiseau >= seuilKm) return false; // ne peut pas être trop proche par la route
  const reelle = distanceReelleKm(graphe, [a.lng, a.lat], [b.lng, b.lat]);
  return reelle != null && reelle < seuilKm;
}

/**
 * Génération automatique de barrages-projets à partir de points noirs
 * importants : priorité au score le plus élevé. Deux distances minimales
 * distinctes, toutes deux mesurées par la route :
 *   - `distanceBarragesKm`  — vis-à-vis des barrages déjà en place
 *     (`existants`) : évite un nouveau barrage trop près d'un poste tenu ;
 *   - `distancePointsKm`    — vis-à-vis des AUTRES points noirs déjà retenus
 *     dans cette même génération : évite de transformer deux points noirs
 *     rapprochés en deux barrages redondants, réglable indépendamment (un
 *     chef peut vouloir des barrages plus espacés que ses points noirs).
 * Jamais un choix point par point : la sélection est entièrement automatique.
 *
 * @param candidats   points noirs importants (mêmes coordonnées {lng,lat})
 * @param existants   barrages déjà en place (mêmes coordonnées {lng,lat})
 * @returns {{retenus: Array, ecartes: Array}}
 */
export function genererBarrages(candidats, existants, graphe, distanceBarragesKm, distancePointsKm = distanceBarragesKm) {
  const tries = [...candidats].sort((a, b) => scoreImportance(b) - scoreImportance(a));

  const retenus = [];
  const ecartes = [];

  for (const c of tries) {
    const tropPresDunBarrage = existants.some((b) => tropProcheDe(graphe, c, b, distanceBarragesKm));
    const tropPresDunAutrePoint = retenus.some((r) => tropProcheDe(graphe, c, r, distancePointsKm));

    if (tropPresDunBarrage || tropPresDunAutrePoint) ecartes.push(c);
    else retenus.push(c);
  }

  return { retenus, ecartes };
}

/**
 * Distance réelle par la route de chaque point au plus proche AUTRE point de
 * la même liste (barrages entre eux, ou points noirs entre eux — jamais les
 * deux mélangés). Sert au filtre « distance min/max » du panneau Filtrer :
 * savoir lesquels ont un voisin à telle distance, pas seulement les paires
 * déjà proches (`recalculerAlertes` ne garde que celles sous un seuil).
 *
 * `maxKm` borne la recherche : au-delà, un point est traité comme sans
 * voisin connu plutôt que de comparer toutes les paires du pays sans limite.
 * Le préfiltre à vol d'oiseau élimine la quasi-totalité des paires, et dès
 * qu'un meilleur candidat réel est trouvé, tout candidat dont le vol d'oiseau
 * dépasse déjà ce meilleur est écarté sans appel A* (il ne peut pas faire
 * mieux, la route est toujours ≥ au vol d'oiseau).
 */

export function partagentFactionItem(a, b) {
  if (estIntouchable(a) || estIntouchable(b)) return true;
  const fa = Array.isArray(a?.factions) ? a.factions : (a?.factionId ? [a.factionId] : null);
  const fb = Array.isArray(b?.factions) ? b.factions : (b?.factionId ? [b.factionId] : null);
  if (fa && fb && fa.length && fb.length) {
    return fa.some((f) => fb.includes(f));
  }
  return true;
}

/**
 * Pour chaque élément, identifie le plus proche voisin sur le graphe routier
 * et calcule la distance réelle en kilomètres.
 *
 * @param {Array<{id: string, lng: number, lat: number, factionId?: string, factions?: string[]}>} items
 * @param {object} graphe
 * @param {number} maxKm
 * @param {((a, b) => boolean)|null} compatible
 * @returns {Map<string, {km: number, voisinId: string}|null>} id -> distance et identité du plus proche voisin, ou `null` si aucun dans `maxKm`.
 */
export function distancesPlusProche(items, graphe, maxKm = 100, compatible = null) {
  const resultats = new Map();

  for (let i = 0; i < items.length; i++) {
    let meilleure = null;
    let voisinId = null;

    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      const a = items[i];
      const b = items[j];

      if (compatible ? !compatible(a, b) : !partagentFactionItem(a, b)) continue;

      const volOiseau = distanceKm(a.lng, a.lat, b.lng, b.lat);
      if (volOiseau > maxKm) continue;
      if (meilleure != null && volOiseau >= meilleure) continue;

      const reelleDirect = distanceReelleKm(graphe, [a.lng, a.lat], [b.lng, b.lat]);
      const reelleInverse = distanceReelleKm(graphe, [b.lng, b.lat], [a.lng, a.lat]);
      let reelle = null;
      if (reelleDirect != null && reelleInverse != null) {
        reelle = Math.min(reelleDirect, reelleInverse);
      } else if (reelleDirect != null) {
        reelle = reelleDirect;
      } else if (reelleInverse != null) {
        reelle = reelleInverse;
      }
      if (reelle != null && (meilleure == null || reelle < meilleure)) {
        meilleure = reelle;
        voisinId = b.id;
      }
    }

    resultats.set(items[i].id, meilleure != null ? { km: meilleure, voisinId } : null);
  }

  return resultats;
}

/**
 * Un barrage est-il OBLIGATOIRE, c'est-à-dire jamais annulable par la
 * consolidation ? Un point posé en entrée ou en sortie de ville filtre tout ce
 * qui entre et sort de l'agglomération : sa valeur ne vient pas de son
 * espacement mais de sa position, donc la règle de distance ne s'y applique
 * pas. Voir `POSITIONS_VILLE` dans serveur/depot.mjs.
 */
/**
 * MOTIFS D'IMPLANTATION — pourquoi ce barrage existe.
 *
 * Quatre justifications, et elles ne se valent pas :
 *
 *   accidents    — le barrage couvre un point noir : sa raison d'être est
 *                  mesurée en vies, c'est le motif le plus fort ;
 *   porte_ville  — il tient une entrée ou une sortie d'agglomération : sa
 *                  valeur vient de sa POSITION, pas de son espacement ;
 *   vip          — il a été posé pour une mission (passage VIP, interception) :
 *                  il répond à un ordre, pas à une statistique ;
 *   non_eclaire  — il se trouve sur un point non éclairé, où le risque de nuit
 *                  est plus élevé et le contrôle plus difficile.
 *
 * Un barrage sans aucun motif n'est justifié par rien de consigné : c'est le
 * premier candidat au retrait quand deux postes se gênent.
 */
export function motifsDuBarrage(m) {
  const motifs = [];
  if ((m?.accidentCount ?? 0) > 0 || m?.origineId) motifs.push('accidents');
  if (m?.positionVille === 'entree' || m?.positionVille === 'sortie') motifs.push('porte_ville');
  if (m?.exceptionnel === true || m?.missionId) motifs.push('vip');
  if (m?.eclairage === 'non') motifs.push('non_eclaire');
  return motifs;
}

/**
 * Un barrage est OBLIGATOIRE — jamais retiré par la consolidation — quand il
 * est INTOUCHABLE, qu'il tient une porte de ville, ou qu'il répond à une
 * mission.
 *
 * Aucun de ces motifs ne dépend de l'espacement : une porte de ville filtre ce
 * qui entre et sort de l'agglomération, un barrage de mission exécute un
 * ordre, et un barrage intouchable est l'ancrage permanent de sa compagnie.
 * Les écarter parce qu'un voisin est proche serait un contresens.
 *
 * POURQUOI `intouchable` EST AJOUTÉ ICI, ET PAS SEULEMENT DANS L'OPTIMISATION
 * AUTOMATIQUE. Parce que l'optimisation automatique ne retire plus rien : elle
 * réaffecte des tours de service, et son compteur de retraits vaut zéro par
 * construction. Le SEUL chemin qui propose encore d'écarter un poste est la
 * CONSOLIDATION MANUELLE, et c'est cette fonction qui décide de ce qu'elle a
 * le droit de proposer. Protéger le poste ailleurs aurait laissé la seule
 * porte réellement dangereuse grande ouverte.
 */
export const estObligatoire = (m) => {
  if (estIntouchable(m)) return true;
  const motifs = motifsDuBarrage(m);
  return motifs.includes('porte_ville') || motifs.includes('vip');
};

/**
 * Score de MAINTIEN : à distance égale, quel barrage garder ?
 *
 * Distinct de `scoreImportance` (serveur/pointsnoirs.mjs), qui sert à CHOISIR
 * un point noir à équiper. Ici on arbitre entre deux postes déjà en place, et
 * les quatre motifs d'implantation entrent tous dans la balance — l'ancien
 * arbitrage ne regardait que les accidents et la position en ville, ignorant
 * l'éclairage et les missions.
 */
export function scoreMaintien(m) {
  const motifs = motifsDuBarrage(m);
  return (
    (m?.accidentCount ?? 0) * 10 +
    ({ critical: 30, high: 20, moderate: 10, none: 0 }[m?.severite] ?? 0) +
    ({ high: 12, medium: 6, low: 0 }[m?.activite] ?? 0) +
    ({ high: 12, medium: 6, low: 0 }[m?.infraction] ?? 0) +
    (motifs.includes('porte_ville') ? 40 : 0) +
    (motifs.includes('vip') ? 35 : 0) +
    (motifs.includes('non_eclaire') ? 15 : 0)
  );
}

/**
 * Distance routière entre deux points, dans le sens le plus COURT des deux.
 *
 * Le graphe est orienté (sens uniques) : mesuré dans un seul sens, un couple
 * peut afficher 27 km à l'aller pour 6 km au retour — voire aucun chemin d'un
 * côté. Pour juger d'une redondance, seul le trajet réellement praticable le
 * plus court compte : deux barrages à 6 km l'un de l'autre font double emploi
 * sur l'axe, quel que soit le sens dans lequel la mesure a été prise.
 *
 * `null` seulement si AUCUN des deux sens ne relie les points.
 */
export function distanceRouteMinKm(graphe, ptA, ptB) {
  const aller = distanceReelleKm(graphe, ptA, ptB);
  const retour = distanceReelleKm(graphe, ptB, ptA);
  if (aller == null) return retour;
  if (retour == null) return aller;
  return Math.min(aller, retour);
}

/** Distance routière exacte si elle est strictement sous le seuil, sinon null.
 * La borne A* rend les décisions de conflit au seuil praticables à grande
 * échelle sans remplacer le calcul par une distance géométrique. */
export function distanceRouteSousSeuilKm(graphe, ptA, ptB, seuilKm) {
  const depart = accrocher(graphe, ptA[0], ptA[1], RAYON_ACCROCHAGE_KM);
  const arrivee = accrocher(graphe, ptB[0], ptB[1], RAYON_ACCROCHAGE_KM);
  if (!depart || !arrivee) return null;
  const aller = itineraire(graphe, depart, arrivee, seuilKm);
  const retour = itineraire(graphe, arrivee, depart, seuilKm);
  if (!aller) return retour?.km ?? null;
  if (!retour) return aller.km;
  return Math.min(aller.km, retour.km);
}

/**
 * Consolidation du dispositif : quels barrages garder, lesquels annuler ?
 *
 * Trois règles, dans cet ordre :
 *   1. Les barrages d'entrée/sortie de ville sont retenus D'OFFICE, quelle que
 *      soit leur proximité — y compris entre eux (deux portes d'une même ville
 *      sont proches par nature, les opposer serait un contresens).
 *   2. Les autres sont examinés du plus important au moins important
 *      (`scoreDe` : accidents constatés, sévérité, activité, infraction), pour
 *      qu'à distance égale ce soit le poste le plus utile qui survive.
 *   3. Un barrage n'est retenu que s'il est à au moins `distanceMinKm` DE TOUS
 *      les barrages déjà retenus, distance mesurée PAR LA ROUTE.
 *
 * Rien n'est écrit ici : la fonction ne produit qu'une recommandation. C'est
 * l'appelant qui décide d'appliquer, ou non (voir POST /api/barrages/consolidation).
 *
 * Le préfiltre à vol d'oiseau évite l'immense majorité des appels A* : la
 * distance par la route étant toujours >= au vol d'oiseau, une paire déjà
 * au-delà du seuil à vol d'oiseau ne peut pas repasser en dessous une fois
 * mesurée — le préfiltre n'écarte donc jamais à tort.
 *
 * @returns {{conserves: Array<{item, motif}>, annules: Array<{item, voisin, distanceKm}>}}
 */
export function consoliderBarrages(barrages, graphe, { distanceMinKm, scoreDe = () => 0 }) {
  const conserves = [];
  const annules = [];

  // 1. Obligatoires — retenus sans condition de distance.
  for (const b of barrages) {
    if (estObligatoire(b)) conserves.push({ item: b, motif: 'obligatoire' });
  }

  // 2. Les autres, par importance décroissante.
  const candidats = barrages
    .filter((b) => !estObligatoire(b))
    .sort((a, b) => scoreDe(b) - scoreDe(a));

  // 3. Espacement minimal garanti vis-à-vis de tout ce qui est déjà retenu.
  for (const c of candidats) {
    let conflit = null;

    for (const garde of conserves) {
      const k = garde.item;
      const vol = distanceKm(c.lng, c.lat, k.lng, k.lat);
      if (vol >= distanceMinKm) continue; // ne peut pas être sous le seuil par la route

      const reelle = distanceRouteMinKm(graphe, [c.lng, c.lat], [k.lng, k.lat]);
      if (reelle != null && reelle < distanceMinKm && (!conflit || reelle < conflit.distanceKm)) {
        conflit = { voisin: k, distanceKm: reelle };
      }
    }

    if (conflit) annules.push({ item: c, voisin: conflit.voisin, distanceKm: conflit.distanceKm });
    else conserves.push({ item: c, motif: 'retenu' });
  }

  return { conserves, annules };
}

/**
 * Consolidation PAR VOISINAGE — la règle « à gauche et à droite ».
 *
 * Différence avec `consoliderBarrages` : ici un barrage n'est jugé que sur ses
 * voisins IMMÉDIATS le long de l'axe, pas sur l'ensemble du dispositif. C'est
 * la façon dont un usager subit la densité : ce qui le gêne, ce n'est pas le
 * nombre total de barrages du pays, c'est d'en rencontrer deux coup sur coup
 * sur la même route.
 *
 * Trois temps :
 *
 *  1. CHAÎNES — les barrages reliés entre eux par une distance routière
 *     inférieure au seuil forment un corridor. Deux corridors distincts ne
 *     s'influencent jamais.
 *
 *  2. ORDRE — un corridor est linéarisé : on prend les deux barrages les plus
 *     éloignés l'un de l'autre (ses extrémités), puis on classe les autres par
 *     distance à l'une d'elles. Cela donne un « avant » et un « après » pour
 *     chaque barrage, c'est-à-dire un voisin de gauche et un de droite.
 *
 *  3. BALAYAGE — on avance le long du corridor. Si le barrage courant est trop
 *     près du dernier conservé, l'un des deux tombe : celui qui couvre le moins
 *     d'accidents. Un barrage d'entrée/sortie de ville ne tombe jamais.
 *
 * @returns {{conserves: Array<{item, motif}>, annules: Array<{item, voisin, distanceKm}>}}
 */
export function consoliderParVoisinage(barrages, graphe, { distanceMinKm, scoreDe = () => 0, estProtege = estObligatoire }) {
  const n = barrages.length;
  const cache = new Map();
  const cle = (i, j) => (i < j ? `${i}|${j}` : `${j}|${i}`);

  /** Distance routière mémorisée — chaque paire n'est calculée qu'une fois. */
  const dist = (i, j) => {
    if (i === j) return 0;
    const k = cle(i, j);
    if (cache.has(k)) return cache.get(k);
    const a = barrages[i];
    const b = barrages[j];
    // La route est toujours >= au vol d'oiseau : au-delà du plafond, inutile d'appeler A*.
    const vol = distanceKm(a.lng, a.lat, b.lng, b.lat);
    const d = vol > distanceMinKm * 6 ? Infinity : (distanceRouteMinKm(graphe, [a.lng, a.lat], [b.lng, b.lat]) ?? Infinity);
    cache.set(k, d);
    return d;
  };

  /* ---- 1. Chaînes (composantes connexes sous le seuil) ---- */
  const parent = barrages.map((_, k) => k);
  const trouver = (x) => (parent[x] === x ? x : (parent[x] = trouver(parent[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(i, j) < distanceMinKm) {
        const a = trouver(i);
        const b = trouver(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const chaines = new Map();
  for (let k = 0; k < n; k++) {
    const r = trouver(k);
    if (!chaines.has(r)) chaines.set(r, []);
    chaines.get(r).push(k);
  }

  const conserves = [];
  const annules = [];

  for (const chaine of chaines.values()) {
    /* Barrage isolé : aucun voisin sous le seuil, rien à arbitrer. */
    if (chaine.length === 1) {
      conserves.push({ item: barrages[chaine[0]], motif: estProtege(barrages[chaine[0]]) ? 'obligatoire' : 'isole' });
      continue;
    }

    /* ---- 2. Linéarisation : extrémité la plus éloignée, puis tri ---- */
    let extremite = chaine[0];
    let record = -1;
    for (const i of chaine) {
      for (const j of chaine) {
        const d = dist(i, j);
        if (Number.isFinite(d) && d > record) {
          record = d;
          extremite = i;
        }
      }
    }
    const ordonnee = [...chaine].sort((a, b) => {
      const da = dist(extremite, a);
      const db = dist(extremite, b);
      return (Number.isFinite(da) ? da : 1e9) - (Number.isFinite(db) ? db : 1e9);
    });

    /* ---- 3. Balayage le long du corridor ---- */
    let dernier = null; // index du dernier barrage conservé
    for (const idx of ordonnee) {
      const courant = barrages[idx];

      if (dernier === null) {
        conserves.push({ item: courant, motif: estProtege(courant) ? 'obligatoire' : 'retenu' });
        dernier = idx;
        continue;
      }

      const d = dist(dernier, idx);
      if (d >= distanceMinKm) {
        conserves.push({ item: courant, motif: estProtege(courant) ? 'obligatoire' : 'retenu' });
        dernier = idx;
        continue;
      }

      /* Trop près du voisin de gauche : l'un des deux tombe. */
      const precedent = barrages[dernier];
      const courantIntouchable = estProtege(courant);
      const precedentIntouchable = estProtege(precedent);

      if (courantIntouchable && precedentIntouchable) {
        /* Deux portes de ville rapprochées : aucune ne tombe, elles tiennent
           leur valeur de leur position, pas de leur espacement. */
        conserves.push({ item: courant, motif: 'obligatoire' });
        dernier = idx;
        continue;
      }

      /* À défaut d'obligation, le plus utile reste : celui qui a la plus grande priorité.
         À score égal, on garde celui déjà en place. */
      const courantGagne = !precedentIntouchable && (courantIntouchable || scoreDe(courant) > scoreDe(precedent));

      if (courantGagne) {
        const pos = conserves.findIndex((c) => c.item.id === precedent.id);
        if (pos !== -1) conserves.splice(pos, 1);
        annules.push({ item: precedent, voisin: courant, distanceKm: d });
        conserves.push({ item: courant, motif: estProtege(courant) ? 'obligatoire' : 'retenu' });
        dernier = idx;
      } else {
        annules.push({ item: courant, voisin: precedent, distanceKm: d });
        /* `dernier` ne bouge pas : le barrage suivant se compare au dernier
           CONSERVÉ, jamais à celui qu'on vient d'écarter. */
      }
    }
  }

  return { conserves, annules };
}

/**
 * OPTIMISATION AUTOMATIQUE DES BARRAGES — voir serveur/optimisationAuto.mjs.
 *
 * Le calcul a quitté ce fichier, et il n'en reste rien ici : il n'existe qu'UNE
 * implémentation, celle du module dédié, qui réutilise `motifsDuBarrage`,
 * `estObligatoire`, `scoreMaintien` et `distanceRouteMinKm` ci-dessus plutôt
 * que d'en recopier la logique.
 *
 * Ce qu'il faisait — un balayage de corridor sans mesure de couverture, sans
 * niveau de redondance et sans plafond de réduction — est décrit dans le
 * nouveau module, qui l'étend au lieu de le doubler.
 */

/**
 * REDÉPLOIEMENT — déplacer plutôt que supprimer.
 *
 * Un barrage en surnombre n'est pas un barrage inutile : c'est un poste, des
 * effectifs et une implantation déjà acquis, simplement mal placés. Les
 * annuler revient à perdre la ressource ; les DÉPLACER la reporte là où le
 * dispositif est aveugle.
 *
 * Méthode :
 *   1. on échantillonne le réseau structurant tous les `pasKm` ;
 *   2. on écarte tout point déjà couvert — à moins de `distanceMinKm` d'un
 *      barrage conservé — ce qui ne laisse que les TROUS de couverture ;
 *   3. chaque barrage à redéployer prend le trou le plus proche de lui, et ce
 *      trou est retiré des disponibles.
 *
 * Le plus proche d'abord : un redéploiement se juge aussi au trajet qu'il
 * impose. Un poste qu'on déplace de 15 km reste tenu par la même brigade ;
 * à 200 km, c'est une autre unité et une autre décision.
 *
 * @returns {Array<{item, versLng, versLat, deplacementKm, route}>}
 */
/**
 * TOUS LES BARRAGES TROP RAPPROCHÉS — sans arbitrage.
 *
 * Distinct de `consoliderParVoisinage`, qui répond à « lequel des deux
 * garder ? » et ne signale donc qu'un poste par paire, en épargnant d'office
 * les portes de ville et les missions.
 *
 * Ici la question est autre : « QUELS barrages sont trop proches ? » — tous,
 * les deux côtés de chaque paire, quel que soit leur motif. Un poste qui
 * couvre un point noir peut parfaitement être celui qu'il faut déplacer ; le
 * calcul ne peut pas le savoir, le chef si. On expose donc le constat complet
 * et la décision se prend repère par repère.
 *
 * Chaque barrage signalé revient avec son voisin le PLUS PROCHE et la distance
 * routière qui les sépare : c'est ce qui rend l'arbitrage possible sans avoir
 * à ouvrir deux fiches.
 */
export function barragesTropProches(barrages, graphe, { distanceMinKm }) {
  const n = barrages.length;
  const plusProche = new Array(n).fill(null); // {index, km}

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = barrages[i];
      const b = barrages[j];

      /* Préfiltre à vol d'oiseau : la route est toujours plus longue, donc
         au-delà du seuil il est inutile d'appeler A*. C'est ce qui rend le
         balayage quadratique praticable sur un millier de postes. */
      if (distanceKm(a.lng, a.lat, b.lng, b.lat) >= distanceMinKm) continue;

      const d = distanceRouteMinKm(graphe, [a.lng, a.lat], [b.lng, b.lat]);
      if (d == null || d >= distanceMinKm) continue;

      if (!plusProche[i] || d < plusProche[i].km) plusProche[i] = { index: j, km: d };
      if (!plusProche[j] || d < plusProche[j].km) plusProche[j] = { index: i, km: d };
    }
  }

  const signales = [];
  const indemnes = [];
  for (let i = 0; i < n; i++) {
    if (plusProche[i]) {
      signales.push({
        item: barrages[i],
        voisin: barrages[plusProche[i].index],
        distanceKm: plusProche[i].km,
      });
    } else {
      indemnes.push(barrages[i]);
    }
  }
  return { signales, indemnes };
}

/**
 * TROUS DE COUVERTURE — emplacements du réseau structurant situés à plus de
 * `espacementKm` de tout barrage existant.
 *
 * Extrait de `proposerRedeploiement`, qui faisait déjà exactement ce calcul
 * pour replacer les postes redondants. La gestion semi-automatique pose la
 * même question sous un autre angle : non plus « où remettre celui-ci ? »,
 * mais « où manque-t-il quelque chose ? ». Une seule implémentation pour les
 * deux, sinon les deux réponses finiraient par diverger.
 *
 * Ne retourne que des POSITIONS : rien n'est créé, rien n'est écrit. C'est
 * l'appelant — donc l'administrateur, après avoir coché — qui décide.
 */
export function trouverTrousCouverture(
  existants,
  graphe,
  { espacementKm, pasKm = 5, limite = 60, garder = null }
) {
  const CLASSES = new Set(['autoroute', 'nationale', 'regionale']);

  /* 1. Semer des points tous les `pasKm` le long des axes structurants. */
  const candidats = [];
  for (let i = 0; i < graphe.nA; i++) {
    if (!CLASSES.has(classeArete(graphe, i))) continue;
    const pts = pointsArete(graphe, i);
    const ref = refArete(graphe, i);
    let reste = 0;
    for (let k = 1; k < pts.length; k++) {
      const seg = distanceKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      let pos = reste;
      while (pos <= seg) {
        const t = seg > 0 ? pos / seg : 0;
        candidats.push({
          lng: pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]),
          lat: pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1]),
          route: ref,
        });
        pos += pasKm;
      }
      reste = pos - seg;
    }
  }

  /* 2. Écarter tout ce qui est déjà couvert, puis tout ce qui se couvrirait
        entre soi : sans cette seconde passe, un trou de 100 km rendrait vingt
        propositions collées les unes aux autres. */
  const MAILLE = 0.2;
  const cle = (lng, lat) => `${Math.floor(lng / MAILLE)}|${Math.floor(lat / MAILLE)}`;
  const grille = new Map();
  existants.forEach((p, i) => {
    const c = cle(p.lng, p.lat);
    if (!grille.has(c)) grille.set(c, []);
    grille.get(c).push(i);
  });
  const voisins = (m, lng, lat, rayonKm) => {
    const r = Math.ceil(rayonKm / (MAILLE * 111)) + 1;
    const cx = Math.floor(lng / MAILLE);
    const cy = Math.floor(lat / MAILLE);
    const out = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) out.push(...(m.get(`${cx + dx}|${cy + dy}`) ?? []));
    return out;
  };

  const libres = candidats.filter((c) => {
    /* Le filtre de périmètre s'applique ICI, avant l'espacement et avant le
       plafond. Appliqué après, il ne voyait plus que les premiers résultats
       retenus à l'échelle du pays : demander les trous d'une seule région en
       renvoyait zéro, non parce qu'il n'y en avait pas, mais parce qu'aucun
       des premiers trous nationaux ne s'y trouvait. */
    if (garder && !garder(c)) return false;
    for (const i of voisins(grille, c.lng, c.lat, espacementKm)) {
      if (distanceKm(c.lng, c.lat, existants[i].lng, existants[i].lat) < espacementKm) return false;
    }
    return true;
  });

  const retenus = [];
  for (const c of libres) {
    if (retenus.length >= limite) break;
    if (retenus.every((r) => distanceKm(c.lng, c.lat, r.lng, r.lat) >= espacementKm)) retenus.push(c);
  }
  return retenus;
}

export function proposerRedeploiement(conserves, aRedeployer, graphe, { distanceMinKm, pasKm = 5 }) {
  if (!aRedeployer.length) return [];

  const CLASSES = new Set(['autoroute', 'nationale', 'regionale']);

  /* ---- 1. Points candidats le long du réseau structurant ---- */
  const candidats = [];
  for (let i = 0; i < graphe.nA; i++) {
    if (!CLASSES.has(classeArete(graphe, i))) continue;
    const pts = pointsArete(graphe, i);
    const ref = refArete(graphe, i);
    let reste = 0;
    for (let k = 1; k < pts.length; k++) {
      const seg = distanceKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      let pos = reste;
      while (pos <= seg) {
        const t = seg > 0 ? pos / seg : 0;
        candidats.push({
          lng: pts[k - 1][0] + t * (pts[k][0] - pts[k - 1][0]),
          lat: pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1]),
          route: ref,
        });
        pos += pasKm;
      }
      reste = pos - seg;
    }
  }

  /* ---- Grille spatiale : sans elle, chaque test balaierait tout le parc ---- */
  const MAILLE = 0.2;
  const cle = (lng, lat) => `${Math.floor(lng / MAILLE)}|${Math.floor(lat / MAILLE)}`;
  const index = (liste) => {
    const m = new Map();
    liste.forEach((p, i) => {
      const c = cle(p.lng, p.lat);
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(i);
    });
    return m;
  };
  const autour = (m, lng, lat, rayonKm) => {
    const r = Math.ceil(rayonKm / (MAILLE * 111)) + 1;
    const cx = Math.floor(lng / MAILLE);
    const cy = Math.floor(lat / MAILLE);
    const out = [];
    for (let dx = -r; dx <= r; dx++)
      for (let dy = -r; dy <= r; dy++) out.push(...(m.get(`${cx + dx}|${cy + dy}`) ?? []));
    return out;
  };

  /* ---- 2. Ne garder que les trous de couverture ---- */
  const gardes = conserves.map((c) => c.item ?? c);
  const idxGardes = index(gardes);
  const trous = candidats.filter((c) => {
    for (const i of autour(idxGardes, c.lng, c.lat, distanceMinKm)) {
      if (distanceKm(c.lng, c.lat, gardes[i].lng, gardes[i].lat) < distanceMinKm) return false;
    }
    return true;
  });

  /* ---- 3. Affectation : à chacun le trou le plus proche, une seule fois ---- */
  const pris = new Set();
  const idxTrous = index(trous);
  const propositions = [];

  /* Le barrage le plus contraint d'abord — celui qui a le moins de trous à
     portée — sinon les premiers servis raflent les seules options des autres. */
  const ordre = [...aRedeployer].sort((a, b) => {
    const na = autour(idxTrous, a.item.lng, a.item.lat, 60).length;
    const nb = autour(idxTrous, b.item.lng, b.item.lat, 60).length;
    return na - nb;
  });

  for (const cible of ordre) {
    const b = cible.item;
    let meilleur = null;
    /* Recherche par anneaux : on s'arrête dès qu'un trou libre est trouvé. */
    for (const rayon of [25, 60, 150, 400]) {
      for (const i of autour(idxTrous, b.lng, b.lat, rayon)) {
        if (pris.has(i)) continue;
        const d = distanceKm(b.lng, b.lat, trous[i].lng, trous[i].lat);
        if (d <= rayon && (!meilleur || d < meilleur.d)) meilleur = { i, d };
      }
      if (meilleur) break;
    }
    if (!meilleur) continue; // plus aucun trou : ce barrage restera sur place

    pris.add(meilleur.i);
    const t = trous[meilleur.i];
    propositions.push({
      item: b,
      voisin: cible.voisin,
      distanceKm: cible.distanceKm,
      versLng: t.lng,
      versLat: t.lat,
      route: t.route,
      deplacementKm: meilleur.d,
    });
  }

  return propositions;
}

/**
 * Accroche un point noir à la route la plus proche : position exacte du futur
 * barrage (sur la route, pas au milieu d'un terre-plein) et intitulé de voie
 * pour préremplir sa fiche. `null` si aucune route à moins de 30 km.
 */
export function accrocherRoute(graphe, lng, lat) {
  const acc = accrocher(graphe, lng, lat, RAYON_ACCROCHAGE_KM);
  if (!acc) return null;
  return {
    lng: acc.lng,
    lat: acc.lat,
    route: refArete(graphe, acc.arete) ?? nomArete(graphe, acc.arete) ?? classeArete(graphe, acc.arete) ?? null,
  };
}
