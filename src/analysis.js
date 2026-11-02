/**
 * Calculs d'analyse — fonctions pures, sans React ni Leaflet.
 *
 * Tout est dérivé des couches réellement chargées : aucun chiffre n'est écrit
 * en dur, donc l'analyse suit les données quand celles-ci changent.
 *
 * Unités des attributs de `circo_bt` :
 *   - population : habitants
 *   - superficie : km²  (vérifié par recoupement — la somme des 504
 *     circonscriptions donne 710 816 km², soit la superficie du Maroc)
 */

/**
 * CE REPÈRE EST-IL UN POSTE DE CONTRÔLE ?
 *
 * La liste est RECOPIÉE ici, et non importée de `marquages.js` : ce module est
 * volontairement sans dépendance vers lui (voir la note de
 * `computeMarquagesAnalysis`), pour rester purement calculatoire et
 * testable seul. La duplication est donc assumée — et gardée par
 * `npm run check:vip`, qui compare les deux listes et échoue si elles
 * divergent. Sans ce contrôle, un VIP aurait disparu des statistiques sans
 * qu'aucune erreur ne le signale.
 */
const TYPES_BARRAGE = ['barrage_fixe', 'barrage_mobile', 'barrage_vip', 'FIXED', 'FIXED_PERMANENT'];
const estBarrage = (m) => TYPES_BARRAGE.includes(m?.type);
const estIntouchable = (m) =>
  m?.type === 'FIXED_PERMANENT' ||
  m?.isPermanent === true ||
  m?.protection === 'intouchable' ||
  m?.intouchable === true ||
  m?.type === 'barrage_vip';

const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);

const median = (nums) => {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const quantile = (sorted, p) =>
  sorted.length ? sorted[Math.floor(p * (sorted.length - 1))] : 0;

/** Agrège les circonscriptions BT par région. */
function groupByRegion(circo) {
  const map = new Map();
  for (const f of circo.features) {
    const p = f.properties || {};
    const nom = p.gr_region;
    if (!nom) continue;
    const r = map.get(nom) ?? { nom, nbBt: 0, pop: 0, sup: 0, cies: new Set() };
    r.nbBt++;
    r.pop += p.population || 0;
    r.sup += p.superficie || 0;
    if (p.gr_cie) r.cies.add(p.gr_cie);
    map.set(nom, r);
  }
  return [...map.values()];
}

/** Découpe une série en classes à bornes fixes, pour un histogramme. */
function histogram(values, bounds) {
  const bins = bounds.slice(0, -1).map((from, i) => ({
    from,
    to: bounds[i + 1],
    count: 0,
  }));
  for (const v of values) {
    const i = bins.findIndex((b, k) => v >= b.from && (v < b.to || k === bins.length - 1));
    if (i >= 0) bins[i].count++;
  }
  return bins;
}

/**
 * @param {object} layers  {circo, pointages, ptsBt, ptsCie, ptsReg}
 * @returns null si les données indispensables manquent encore
 */
export function computeAnalysis({ circo, pointages, ptsBt, ptsCie, ptsReg }) {
  if (!circo) return null;

  const regions = groupByRegion(circo);
  const population = sum(regions, (r) => r.pop);
  const superficie = sum(regions, (r) => r.sup);
  const compagnies = new Set(circo.features.map((f) => f.properties?.gr_cie).filter(Boolean));

  /* --- Charge démographique : habitants couverts par brigade --- */
  const chargeVals = regions.map((r) => r.pop / r.nbBt);
  const chargeMediane = median(chargeVals);
  const chargeSeuil = 2 * chargeMediane;
  const charge = regions
    .map((r) => ({
      nom: r.nom,
      valeur: r.pop / r.nbBt,
      flag: r.pop / r.nbBt > chargeSeuil,
      detail: `${r.nbBt} BT · ${Math.round(r.pop).toLocaleString('fr-FR')} hab.`,
    }))
    .sort((a, b) => b.valeur - a.valeur);

  /* --- Étendue territoriale : km² couverts par brigade --- */
  const etendueVals = regions.map((r) => r.sup / r.nbBt);
  const etendueMediane = median(etendueVals);
  const etendueSeuil = 4 * etendueMediane;
  const etendue = regions
    .map((r) => ({
      nom: r.nom,
      valeur: r.sup / r.nbBt,
      flag: r.sup / r.nbBt > etendueSeuil,
      detail: `${r.nbBt} BT · ${Math.round(r.sup).toLocaleString('fr-FR')} km²`,
    }))
    .sort((a, b) => b.valeur - a.valeur);

  /* --- Distribution des superficies de circonscription --- */
  const sups = circo.features
    .map((f) => f.properties?.superficie || 0)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  const distribution = {
    bins: histogram(sups, [0, 200, 500, 1000, 2000, 5000, Infinity]),
    total: sups.length,
    min: quantile(sups, 0),
    q1: quantile(sups, 0.25),
    mediane: quantile(sups, 0.5),
    q3: quantile(sups, 0.75),
    max: quantile(sups, 1),
  };

  /* --- Pointages rattachés (propriété `reg` posée au build) --- */
  let activite = null;
  if (pointages) {
    const parRegion = new Map();
    const parUnite = new Map();
    for (const f of pointages.features) {
      const p = f.properties || {};
      if (p.reg) parRegion.set(p.reg, (parRegion.get(p.reg) ?? 0) + 1);
      if (p.unite) parUnite.set(p.unite, (parUnite.get(p.unite) ?? 0) + 1);
    }

    const couvertes = new Set(parRegion.keys());
    activite = {
      total: pointages.features.length,
      parRegion: [...parRegion.entries()]
        .map(([nom, valeur]) => ({ nom, valeur, detail: `${valeur} pointages` }))
        .sort((a, b) => b.valeur - a.valeur),
      parUnite: [...parUnite.entries()]
        .map(([nom, valeur]) => ({ nom, valeur }))
        .sort((a, b) => b.valeur - a.valeur),
      regionsCouvertes: couvertes.size,
      regionsSans: regions.map((r) => r.nom).filter((n) => !couvertes.has(n)),
    };
  }

  return {
    couverture: {
      regions: regions.length,
      compagnies: compagnies.size,
      circonscriptions: circo.features.length,
      population,
      superficie,
      ptsBt: ptsBt?.features.length ?? null,
      ptsCie: ptsCie?.features.length ?? null,
      ptsReg: ptsReg?.features.length ?? null,
    },
    charge: { items: charge, mediane: chargeMediane, seuil: chargeSeuil },
    etendue: { items: etendue, mediane: etendueMediane, seuil: etendueSeuil },
    distribution,
    activite,
  };
}

/* ====================================================================== */
/* Analyse des marquages de terrain — barrages et points noirs            */
/* ====================================================================== */

/**
 * Lecture chiffrée de ce que les chefs ont posé sur la carte : barrages et
 * points noirs. Tout dérive de `items` (voir serveur/depot.mjs pour la forme
 * exacte de chaque marquage) et de `alertes` (alertes de distance) : rien
 * n'est recalculé côté serveur, cette vue est purement une synthèse.
 *
 * `estImportant`/`scoreImportance` sont injectés plutôt qu'importés ici pour
 * garder ce fichier sans dépendance vers `marquages.js` — même pourquoi que
 * les autres fonctions de ce module, purement calculatoires.
 */
const TOP_MARQUAGES = 6;

export function computeMarquagesAnalysis(items, alertes, { estImportant, scoreImportance } = {}) {
  if (!items) return null;

  const parType = new Map();
  for (const m of items) parType.set(m.type, (parType.get(m.type) ?? 0) + 1);

  const barrages = items.filter((m) => estBarrage(m));
  const patrouillees = barrages.filter((b) => (b.patrouilles?.length ?? 0) > 0);
  const alertesOuvertes = (alertes ?? []).filter((a) => a.status === 'open');

  const noirs = items.filter((m) => m.type === 'accident');
  const importants = estImportant ? noirs.filter((m) => estImportant(m)) : [];
  const topImportants = estImportant && scoreImportance
    ? [...importants].sort((a, b) => scoreImportance(b) - scoreImportance(a)).slice(0, TOP_MARQUAGES)
    : [];

  /** Répartition par unité (cie) — toutes natures confondues. */
  const parCie = new Map();
  for (const m of items) {
    if (!m.cie) continue;
    const c = parCie.get(m.cie) ?? { nom: m.cie, total: 0 };
    c.total++;
    parCie.set(m.cie, c);
  }

  return {
    total: items.length,
    parType: [...parType.entries()].map(([nom, valeur]) => ({ nom, valeur })).sort((a, b) => b.valeur - a.valeur),
    barrages: {
      total: barrages.length,
      bfi: barrages.filter((b) => estIntouchable(b)).length,
      fixesNormaux: barrages.filter((b) => (b.type === 'barrage_fixe' || b.type === 'FIXED') && !estIntouchable(b)).length,
      fixes: barrages.filter((b) => (b.type === 'barrage_fixe' || b.type === 'FIXED') && !estIntouchable(b)).length,
      mobiles: barrages.filter((b) => b.type === 'barrage_mobile').length,
      patrouilles: patrouillees.length,
      sansPatrouille: barrages.length - patrouillees.length,
      exceptionnels: barrages.filter((b) => b.exceptionnel).length,
      alertesOuvertes: alertesOuvertes.length,
    },
    pointsNoirs: {
      total: noirs.length,
      importants: importants.length,
      top: topImportants.map((m) => ({
        nom: m.nom || m.route || 'Point noir',
        valeur: scoreImportance(m),
        detail: m.cie ? `Cie ${m.cie}` : '',
      })),
    },
    parCie: [...parCie.values()].map((c) => ({ nom: c.nom, valeur: c.total })).sort((a, b) => b.valeur - a.valeur),
  };
}

const JOURS_PERIODE = { jour: 1, semaine: 7, mois: 30, annee: 365 };

/** `{actuel, precedent, delta, pourcentage}` — pourcentage à 100 % si la période précédente était à zéro. */
function ecart(actuel, precedent) {
  const d = actuel - precedent;
  const pourcentage = precedent > 0 ? Math.round((d / precedent) * 100) : actuel > 0 ? 100 : 0;
  return { actuel, precedent, delta: d, pourcentage };
}

/**
 * Compare la période courante à la période précédente de même longueur
 * (jour/semaine/mois/année, en jours calendaires simples — pas de
 * bibliothèque de dates, cohérent avec le reste de ce module) : barrages,
 * points noirs, véhicules mobilisés, effectifs déployés, et zones
 * (compagnies) les plus actives avec leur évolution.
 *
 * Axée sur `cree` (date de saisie) : c'est le seul axe temporel universel à
 * tous les marquages (voir `serveur/depot.mjs`).
 */
export function comparerPeriodes(items, alertes, { estImportant, scoreImportance } = {}, periode = 'semaine') {
  const joursPeriode = JOURS_PERIODE[periode] ?? JOURS_PERIODE.semaine;

  const maintenant = new Date();
  const debutActuel = new Date(maintenant);
  debutActuel.setDate(debutActuel.getDate() - joursPeriode);
  const debutPrecedent = new Date(debutActuel);
  debutPrecedent.setDate(debutPrecedent.getDate() - joursPeriode);

  const bActuel = debutActuel.toISOString();
  const bPrecedent = debutPrecedent.toISOString();
  const bMaintenant = maintenant.toISOString();

  const itemsActuels = items.filter((m) => m.cree && m.cree >= bActuel && m.cree < bMaintenant);
  const itemsPrecedents = items.filter((m) => m.cree && m.cree >= bPrecedent && m.cree < bActuel);

  const statsActuel = computeMarquagesAnalysis(itemsActuels, alertes, { estImportant, scoreImportance });
  const statsPrecedent = computeMarquagesAnalysis(itemsPrecedents, alertes, { estImportant, scoreImportance });

  /** Véhicules distincts et effectif cumulé des patrouilles affectées, sur l'ensemble donné. */
  const ressourcesPatrouilles = (liste) => {
    const vehicules = new Set();
    let effectifs = 0;
    for (const m of liste) {
      if (!estBarrage(m)) continue;
      for (const p of m.patrouilles ?? []) {
        if (p.vehicule) vehicules.add(p.vehicule);
        effectifs += p.effectif || 0;
      }
    }
    return { vehicules: vehicules.size, effectifs };
  };
  const resActuel = ressourcesPatrouilles(itemsActuels);
  const resPrecedent = ressourcesPatrouilles(itemsPrecedents);

  const parCieActuel = new Map((statsActuel?.parCie ?? []).map((c) => [c.nom, c.valeur]));
  const parCiePrecedent = new Map((statsPrecedent?.parCie ?? []).map((c) => [c.nom, c.valeur]));
  const zonesActives = [...parCieActuel.entries()]
    .map(([nom, valeur]) => ({ nom, ...ecart(valeur, parCiePrecedent.get(nom) ?? 0) }))
    .sort((a, b) => b.actuel - a.actuel);

  return {
    periode,
    joursPeriode,
    total: ecart(statsActuel?.total ?? 0, statsPrecedent?.total ?? 0),
    barrages: ecart(statsActuel?.barrages.total ?? 0, statsPrecedent?.barrages.total ?? 0),
    pointsNoirs: ecart(statsActuel?.pointsNoirs.total ?? 0, statsPrecedent?.pointsNoirs.total ?? 0),
    vehicules: ecart(resActuel.vehicules, resPrecedent.vehicules),
    effectifs: ecart(resActuel.effectifs, resPrecedent.effectifs),
    zonesActives,
  };
}

/**
 * Analyse « intelligente » d'un ENSEMBLE de marquages déjà choisi (fiche de
 * circonscription, ou résultat du panneau Filtrer sur une route) : points
 * forts, points faibles et recommandations sur ce qui a été posé dans ce
 * périmètre — barrages (distance, validation, patrouilles), points noirs
 * (importance, éclairage). `ici` est déjà filtré
 * par l'appelant, cette fonction ne fait plus de tri géographique.
 */
export function analyserMarquagesEnsemble(ici, alertes, estImportant) {
  if (!ici) return null;

  const barrages = ici.filter((m) => estBarrage(m));
  const noirs = ici.filter((m) => m.type === 'accident');
  const idsIci = new Set(barrages.map((b) => b.id));

  const barragesEnAlerte = new Set();
  for (const a of alertes ?? []) {
    if (a.status !== 'open') continue;
    if (a.a && idsIci.has(a.a.id)) barragesEnAlerte.add(a.a.id);
    if (a.b && idsIci.has(a.b.id)) barragesEnAlerte.add(a.b.id);
  }

  const parStatut = { en_attente: 0, approuve: 0, a_modifier: 0, annule: 0 };
  for (const b of barrages) parStatut[b.statutBarrage ?? 'en_attente'] = (parStatut[b.statutBarrage ?? 'en_attente'] ?? 0) + 1;
  const sansPatrouille = barrages.filter((b) => !(b.patrouilles?.length > 0)).length;

  const importants = estImportant ? noirs.filter((m) => estImportant(m)) : [];
  const nonEclaires = noirs.filter((m) => m.eclairage === 'non').length;
  const accidentsTotal = sum(noirs, (m) => m.accidentCount ?? 0);

  const pointsForts = [];
  const pointsFaibles = [];
  const recommandations = [];

  if (barrages.length > 0 && barragesEnAlerte.size === 0) {
    pointsForts.push('Tous les barrages respectent la distance minimale entre eux.');
  } else if (barragesEnAlerte.size > 0) {
    pointsFaibles.push(
      `${barragesEnAlerte.size} barrage(s) trop rapproché(s) d'un autre (alerte de distance ouverte).`
    );
    recommandations.push('Repositionner ou fusionner les barrages concernés par une alerte de distance.');
  }

  if (barrages.length > 0 && (parStatut.en_attente ?? 0) === 0) {
    pointsForts.push('Aucun barrage en attente de validation.');
  } else if ((parStatut.en_attente ?? 0) > 0) {
    pointsFaibles.push(`${parStatut.en_attente} barrage(s) encore en attente de validation.`);
    recommandations.push("Faire valider les barrages en attente par l'administrateur.");
  }
  if ((parStatut.a_modifier ?? 0) > 0) {
    pointsFaibles.push(`${parStatut.a_modifier} barrage(s) marqué(s) « à modifier » par l'administrateur.`);
  }

  if (barrages.length > 0 && sansPatrouille === 0) {
    pointsForts.push('Chaque barrage a au moins une patrouille affectée.');
  } else if (sansPatrouille > 0) {
    pointsFaibles.push(`${sansPatrouille} barrage(s) sans patrouille affectée.`);
    recommandations.push("Affecter une patrouille aux barrages qui n'en ont pas encore.");
  }

  if (noirs.length > 0 && nonEclaires === 0) {
    pointsForts.push('Tous les points noirs sont éclairés la nuit.');
  } else if (nonEclaires > 0) {
    pointsFaibles.push(`${nonEclaires} point(s) noir(s) non éclairé(s) la nuit.`);
    recommandations.push(
      "Prioriser l'éclairage ou une présence renforcée la nuit sur les points noirs non éclairés."
    );
  }

  if (importants.length > barrages.length) {
    pointsFaibles.push(
      `${importants.length} point(s) noir(s) important(s) pour seulement ${barrages.length} barrage(s) en place.`
    );
    recommandations.push('Envisager des barrages supplémentaires sur les points noirs importants non couverts.');
  } else if (importants.length > 0) {
    pointsForts.push(`${importants.length} point(s) noir(s) important(s), tous suivis d'un dispositif.`);
  }

  return {
    barrages: { total: barrages.length, parStatut, enAlerte: barragesEnAlerte.size, sansPatrouille },
    pointsNoirs: { total: noirs.length, importants: importants.length, accidentsTotal, nonEclaires },
    pointsForts,
    pointsFaibles,
    recommandations,
  };
}

/**
 * Couverture opérationnelle : croise les barrages et les points stratégiques
 * (entrées de ville, péages — sous-types de `zahma`) avec les pointages de
 * flotte réellement postés, pour répondre à deux questions qu'aucune des
 * analyses ci-dessus ne pose : un barrage posé est-il dans une zone
 * surveillée par ailleurs, et un point stratégique reconnu a-t-il un
 * dispositif à proximité ?
 *
 * `distance` est injecté (turf.distance côté appelant) : ce fichier reste
 * sans dépendance à une librairie géométrique, comme `computeProximity`.
 *
 * @param {object[]} items               marquages visibles (déjà filtrés par périmètre de session)
 * @param {object[]} pointagesFeatures   features GeoJSON des pointages de flotte
 * @param {function} distance            (lngLatA, lngLatB) -> km
 * @param {number}   seuilKm             rayon jugé « couvert » autour d'un pointage
 */
export function analyserCouverture({ items, pointagesFeatures, distance, seuilKm = 5 }) {
  if (!items?.length || !pointagesFeatures?.length || !distance) return null;

  const barrages = items.filter((m) => estBarrage(m));
  const pointsStrategiques = items.filter(
    (m) => m.type === 'zahma' && (m.sousType === 'entree_ville' || m.sousType === 'peage')
  );

  const proche = (m, contre) => {
    let min = Infinity;
    for (const c of contre) {
      const d = distance([m.lng, m.lat], c);
      if (d < min) min = d;
    }
    return min;
  };

  const coordsPointages = pointagesFeatures.map((f) => f.geometry.coordinates);
  const barragesIsoles = barrages.filter((b) => proche(b, coordsPointages) > seuilKm);

  const coordsBarrages = barrages.map((b) => [b.lng, b.lat]);
  const pointsStrategiquesSansBarrage = pointsStrategiques.filter(
    (p) => coordsBarrages.length === 0 || proche(p, coordsBarrages) > seuilKm
  );

  return {
    seuilKm,
    barragesTotal: barrages.length,
    barragesIsoles,
    pointsStrategiquesTotal: pointsStrategiques.length,
    pointsStrategiquesSansBarrage,
  };
}

/**
 * Analyse d'un itinéraire calculé par l'outil Distances : barrages posés le
 * long du trajet, points noirs rencontrés, et tronçons sans aucun barrage à
 * proximité (« trous de couverture »). Purement géométrique — projection de
 * chaque marquage sur la trace (voir `projeterSurTrace` dans
 * `correlation.js`) — donc valable pour n'importe quel trajet, pas seulement
 * les routes nommées qu'un marquage porte dans son champ `route`.
 *
 * @param {Array<[number,number]>} trace       polyligne [lng,lat] du trajet complet (toutes jambes confondues)
 * @param {object[]} items                     marquages visibles (déjà filtrés par périmètre de session)
 * @param {function} traceCumulKm              injecté (voir correlation.js) — pas de dépendance géométrique ici
 * @param {function} projeterSurTrace          injecté (voir correlation.js)
 * @param {number} seuilProximiteM             distance (m) en deçà de laquelle un marquage est « sur » le trajet
 * @param {number} seuilGapKm                  longueur (km) à partir de laquelle un tronçon sans barrage est signalé
 */
export function analyserCouvertureRoute(
  trace,
  items,
  traceCumulKm,
  projeterSurTrace,
  { seuilProximiteM = 1000, seuilGapKm = 15 } = {}
) {
  if (!trace?.length || trace.length < 2) return null;

  const cumul = traceCumulKm(trace);
  const longueurKm = cumul[cumul.length - 1];

  const projeterListe = (liste) =>
    liste
      .map((m) => ({ m, ...projeterSurTrace({ lng: m.lng, lat: m.lat }, trace, cumul) }))
      .filter((x) => x.distanceM <= seuilProximiteM)
      .sort((a, b) => a.km - b.km);

  const barrages = projeterListe(items.filter((m) => estBarrage(m)));
  const pointsNoirs = projeterListe(items.filter((m) => m.type === 'accident'));

  /** Tronçons entre deux barrages consécutifs (et avant le premier / après le dernier) plus longs que le seuil. */
  const bornes = [0, ...barrages.map((b) => b.km), longueurKm];
  const gaps = [];
  for (let i = 0; i < bornes.length - 1; i++) {
    const longueur = bornes[i + 1] - bornes[i];
    if (longueur >= seuilGapKm) gaps.push({ debutKm: bornes[i], finKm: bornes[i + 1], longueurKm: longueur });
  }

  const pointsNoirsNonCouverts = pointsNoirs.filter((p) => gaps.some((g) => p.km >= g.debutKm && p.km <= g.finKm));

  return {
    longueurKm,
    seuilProximiteM,
    seuilGapKm,
    barrages,
    pointsNoirs,
    accidentsTotal: sum(pointsNoirs, (p) => p.m.accidentCount ?? 0),
    gaps,
    pointsNoirsNonCouverts,
  };
}

/**
 * Efficacité mesurée d'un barrage : à sa création, il reprend en instantané
 * les critères d'importance du point noir d'origine (`accidentCount` compris
 * — voir la génération dans `serveur/api.mjs`). Ce champ ne bouge plus sur le
 * barrage, alors que celui du point noir reste vivant si l'unité continue de
 * le tenir à jour. Comparer les deux dit si le dispositif a fait baisser les
 * accidents depuis sa pose — sans historique à parcourir, juste ces deux
 * valeurs déjà en mémoire.
 */
export function analyserEfficaciteBarrages(items) {
  const parId = new Map(items.map((m) => [m.id, m]));
  const mesures = items
    .filter((m) => (estBarrage(m)) && m.origineId)
    .map((b) => {
      const origine = parId.get(b.origineId);
      if (!origine) return null;
      const avant = b.accidentCount ?? 0;
      const apres = origine.accidentCount ?? 0;
      return { barrage: b, origine, avant, apres, delta: apres - avant };
    })
    .filter(Boolean);

  return {
    total: mesures.length,
    ameliores: mesures.filter((m) => m.delta < 0),
    aggraves: mesures.filter((m) => m.delta > 0),
    stables: mesures.filter((m) => m.delta === 0).length,
  };
}

/**
 * Assistant de couverture : routes qui portent des points noirs mais AUCUN
 * barrage — dans la même région, puisqu'un tronçon de RN1 couvert à Rabat ne
 * dit rien de son tronçon à Fès. Chaque route sans dispositif reçoit une
 * SUGGESTION : le point noir le plus significatif de cette route (le plus
 * d'accidents), candidat naturel à un barrage — voir `origineId` et
 * `genererBarrageManuel` pour la même mécanique déjà utilisée ailleurs.
 *
 * Rien n'est écrit ici : la suggestion n'existe que le temps du calcul, tant
 * qu'un chef ne la confirme pas.
 *
 * NOTE — le panneau Assistant qui exposait ces fonctions a été retiré de
 * l'interface. Elles restent exportées, sans appelant : conservées pour le
 * chantier d'optimisation des barrages, elles sortent du bundle tant que rien
 * ne les importe.
 */
function grouperRoutes(routes) {
  const grouper = (champ) => {
    const map = new Map();
    for (const r of routes) {
      const cle = r[champ] ?? '—';
      if (!map.has(cle)) map.set(cle, []);
      map.get(cle).push(r);
    }
    return [...map.entries()]
      .map(([nom, routes]) => ({ nom, routes, accidentsTotal: sum(routes, (r) => r.accidentsTotal) }))
      .sort((a, b) => b.accidentsTotal - a.accidentsTotal || b.routes.length - a.routes.length);
  };
  return { parRegion: grouper('reg'), parCompagnie: grouper('cie') };
}

function recommandationsPointsNoirs(routes) {
  if (routes.length === 0) {
    return ['Toutes les routes portant un point noir disposent déjà d’au moins un barrage.'];
  }
  const top = routes[0];
  const recommandations = [
    `${routes.length} route(s) portent des points noirs sans aucun barrage. La plus critique : ` +
      `${top.route} (région ${top.reg}), avec ${top.accidentsTotal} accident(s) recensé(s) sur ` +
      `${top.pointsNoirs} point(s) noir(s) et aucun dispositif.`,
  ];
  if (routes.length > 1) {
    recommandations.push(
      'Traiter en priorité les routes en tête de liste (accidents cumulés les plus élevés) avant ' +
        'les routes à un seul point noir isolé.'
    );
  }
  return recommandations;
}

function recommandationsPointsStrategiques(routes, libelleType, seuilKm) {
  return routes.length > 0
    ? [
        `${routes.length} ${libelleType}${routes.length === 1 ? '' : 's'} sans aucun barrage à moins de ${seuilKm} km — ce sont des passages à fort potentiel de contrôle, un renfort y serait pertinent.`,
      ]
    : [`Tous les ${libelleType}s recensés ont un barrage à proximité.`];
}

/**
 * Recalcule groupes/recommandations/total à partir d'une liste de `routes`
 * déjà filtrée (ex. après avoir écarté des suggestions côté Assistant) — sans
 * cela, seul `total` bougerait et les groupes région/compagnie continueraient
 * d'afficher des suggestions déjà écartées.
 */
export function refiltrerSuggestions(routes, { pointNoir = false, libelleType = 'point stratégique', seuilKm = 5 } = {}) {
  const { parRegion, parCompagnie } = grouperRoutes(routes);
  return {
    total: routes.length,
    accidentsTotal: sum(routes, (r) => r.accidentsTotal),
    routes,
    parRegion,
    parCompagnie,
    recommandations: pointNoir
      ? recommandationsPointsNoirs(routes)
      : recommandationsPointsStrategiques(routes, libelleType, seuilKm),
  };
}

export function analyserRoutesSansBarrage(items) {
  const noirs = items.filter((m) => m.type === 'accident' && m.route && m.reg);
  const barrages = items.filter(
    (m) => (estBarrage(m)) && m.route && m.reg
  );

  const routesCouvertes = new Set(barrages.map((b) => `${b.reg}|${b.route}`));

  const parCle = new Map();
  for (const m of noirs) {
    const cle = `${m.reg}|${m.route}`;
    if (!parCle.has(cle)) parCle.set(cle, []);
    parCle.get(cle).push(m);
  }

  const routes = [];
  for (const [cle, groupe] of parCle) {
    if (routesCouvertes.has(cle)) continue;
    const [reg, route] = cle.split('|');
    const pire = [...groupe].sort((a, b) => (b.accidentCount ?? 0) - (a.accidentCount ?? 0))[0];
    routes.push({
      reg,
      route,
      cie: pire.cie,
      pointsNoirs: groupe.length,
      accidentsTotal: sum(groupe, (m) => m.accidentCount ?? 0),
      suggestion: { mode: 'pointNoir', id: pire.id, lat: pire.lat, lng: pire.lng, nom: pire.nom, route, reg, cie: pire.cie },
    });
  }
  routes.sort((a, b) => b.accidentsTotal - a.accidentsTotal);

  return refiltrerSuggestions(routes, { pointNoir: true });
}

/**
 * Points stratégiques réels (péages — `peagesFeatures` — ou points signalés
 * comme entrée de ville) sans aucun barrage à moins de `seuilKm` — deuxième
 * source de suggestions de l'Assistant, à côté des routes sans barrage.
 *
 * Contrairement à un point noir, un péage n'existe pas comme marquage : sa
 * suggestion n'a donc pas de point noir d'origine à générer (`mode: 'direct'`
 * plutôt que `'pointNoir'`) — « Créer ce barrage » pose alors un barrage
 * neuf à ses coordonnées exactes (déjà sur l'axe routier), sans passer par
 * `origineId`.
 *
 * @param {object[]} points     {nom, lat, lng} — péages (OSM) ou zahma/entree_ville (marquages)
 * @param {object[]} barrages   barrages existants (items filtrés en amont)
 * @param {function} distance   (lngLatA, lngLatB) -> km
 * @param {number}   seuilKm
 */
export function analyserPointsStrategiquesSansBarrage(points, barrages, distance, seuilKm = 5, libelleType = 'point stratégique') {
  const coordsBarrages = barrages.map((b) => [b.lng, b.lat]);
  const sansBarrage = points.filter((p) => {
    if (coordsBarrages.length === 0) return true;
    let min = Infinity;
    for (const c of coordsBarrages) {
      const d = distance([p.lng, p.lat], c);
      if (d < min) min = d;
    }
    return min > seuilKm;
  });

  // Même forme que `analyserRoutesSansBarrage` (`routes`/`parRegion`/`parCompagnie`/
  // `recommandations`) : l'Assistant affiche les trois sources avec le même composant.
  const routes = sansBarrage.map((p) => ({
    reg: p.reg ?? '—',
    route: p.nom, // pas une route à proprement parler, mais le même emplacement d'affichage
    cie: p.cie ?? null,
    pointsNoirs: 0,
    accidentsTotal: 0,
    suggestion: { mode: 'direct', lat: p.lat, lng: p.lng, nom: p.nom, reg: p.reg ?? null, cie: p.cie ?? null },
  }));

  return refiltrerSuggestions(routes, { pointNoir: false, libelleType, seuilKm });
}

/**
 * Même analyse, appliquée à UNE circonscription sélectionnée (région,
 * compagnie ou brigade) : filtre `items` par rattachement avant de passer la
 * main à `analyserMarquagesEnsemble`. Complète `analyseEntite`
 * (démographie/territoire) par le volet terrain, pour la même fiche.
 *
 * @param {string} champ 'reg' | 'cie' | 'bt' — le champ de `items` à comparer à `ficheNom`
 */
export function analyserMarquagesFiche(items, alertes, ficheNom, champ, estImportant) {
  if (!ficheNom || !items) return null;
  return analyserMarquagesEnsemble(
    items.filter((m) => m[champ] === ficheNom),
    alertes,
    estImportant
  );
}

/* ====================================================================== */
/* Analyse d'une entité sélectionnée                                      */
/* ====================================================================== */

/** Rang de `valeur` dans la série, 1 = le plus élevé. */
const rang = (valeurs, valeur) =>
  valeurs.filter((v) => v > valeur).length + 1;

/**
 * Fiche analytique d'un contour cliqué.
 *
 * Les agrégats (nbBt, population, superficie) sont posés au build sur chaque
 * polygone, donc cette analyse ne nécessite QUE la couche des contours : pas
 * besoin de charger les 1,5 Mo de circonscriptions BT pour cliquer une région.
 *
 * @param {string} nom      valeur de `properties.nom` du contour cliqué
 * @param {object} fc       la couche de contours (circo_reg ou circo_cie)
 * @param {object} pointages couche des pointages, facultative
 * @param {string} champReg nom du champ portant la région dans les pointages
 */
export function analyseEntite(nom, fc, pointages, champReg = 'reg') {
  if (!nom || !fc) return null;

  /**
   * Le nom vient de `nom` sur les contours nommés au build (régions,
   * compagnies) et de `gr_bde` sur les circonscriptions BT, qui portent déjà
   * leurs attributs d'origine. Un contour BT couvre par définition une seule
   * brigade, d'où `nbBt` à 1 : sa « charge par brigade » vaut sa population,
   * ce qui reste exact et comparable aux autres.
   */
  const nomDe = (p) => p?.nom ?? p?.gr_bde ?? null;
  const nb = (p) => p?.nbBt ?? 1;

  const cible = fc.features.find((f) => nomDe(f.properties) === nom);
  if (!cible) return null;

  const p = cible.properties;
  const tous = fc.features.map((f) => f.properties).filter((x) => nomDe(x));

  const charge = p.population / nb(p);
  const etendue = p.superficie / nb(p);
  const densite = p.superficie ? p.population / p.superficie : 0;

  const charges = tous.map((x) => x.population / nb(x));
  const etendues = tous.map((x) => x.superficie / nb(x));
  const densites = tous.map((x) => (x.superficie ? x.population / x.superficie : 0));

  /* Pointages rattachés à cette entité */
  let pointagesIci = null;
  if (pointages) {
    const compte = new Map();
    for (const f of pointages.features) {
      const v = f.properties?.[champReg];
      if (v) compte.set(v, (compte.get(v) ?? 0) + 1);
    }
    const n = compte.get(nom) ?? 0;
    pointagesIci = {
      nombre: n,
      // `nb(p)` et non `p.nbBt` : ce dernier est absent sur une circonscription
      // BT, ce qui ramenait le ratio à zéro alors qu'elle couvre une brigade.
      parBrigade: n / nb(p),
      surTotal: pointages.features.length,
      /** Rang parmi les seules entités ayant au moins un pointage. */
      rang: rang([...compte.values()], n),
      classees: compte.size,
    };
  }

  const indicateur = (valeur, serie, unite, libelle) => ({
    libelle,
    valeur,
    unite,
    rang: rang(serie, valeur),
    total: serie.length,
    mediane: median(serie),
    /** Écart à la médiane, en multiples : 4 = « quatre fois la médiane ». */
    facteur: median(serie) ? valeur / median(serie) : 0,
  });

  return {
    nom,
    region: p.reg ?? p.gr_region ?? null, // compagnie -> reg ; circonscription BT -> gr_region
    compagnie: p.gr_cie ?? null,
    confiance: p.confiance ?? null,
    nbBt: nb(p),
    nbCie: p.nbCie ?? null,
    population: p.population,
    superficie: p.superficie,
    indicateurs: [
      indicateur(charge, charges, 'hab./BT', 'Charge par brigade'),
      indicateur(etendue, etendues, 'km²/BT', 'Étendue par brigade'),
      indicateur(densite, densites, 'hab./km²', 'Densité de population'),
    ],
    pointages: pointagesIci,
  };
}

/* ====================================================================== */
/* Proximité — paires d'entités séparées de moins de N km                 */
/* ====================================================================== */

/**
 * Toutes les paires distantes de <= maxKm, avec leurs grappes.
 *
 * Pré-filtre par boîte englobante avant l'appel géodésique : la liste est
 * triée par latitude, ce qui permet un arrêt précoce dès que l'écart de
 * latitude dépasse le seuil. Sur 395 pointages cela ramène 77 815 paires
 * théoriques à 5 calculs géodésiques réels.
 *
 * @param {object}   fc         FeatureCollection de points
 * @param {function} distance   (lngLatA, lngLatB) -> km  (turf.distance injecté)
 * @param {object}   opts       maxKm, nom(properties), rayonM(properties)
 */
export function computeProximity(fc, distance, opts = {}) {
  const { maxKm = 5, nom = (p) => p.nom, rayonM = null } = opts;

  const pts = fc.features
    .map((f, i) => ({
      idx: i,
      id: f.properties?.id ?? `${i}`,
      props: f.properties || {},
      nom: nom(f.properties || {}) || `#${i + 1}`,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }))
    .sort((a, b) => a.lat - b.lat);

  const degLat = maxKm / 111; // 1° de latitude ~ 111 km
  const paires = [];
  let calculs = 0;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const degLng = maxKm / (111 * Math.max(0.1, Math.cos((a.lat * Math.PI) / 180)));

    for (let j = i + 1; j < pts.length; j++) {
      const b = pts[j];
      if (b.lat - a.lat > degLat) break; // trié : plus aucun voisin possible
      if (Math.abs(b.lng - a.lng) > degLng) continue;

      calculs++;
      const km = distance([a.lng, a.lat], [b.lng, b.lat]);
      if (km > maxKm) continue;

      // Zones sécantes : la distance est inférieure à la somme des rayons
      const secant =
        rayonM != null
          ? km * 1000 < (rayonM(a.props) || 0) + (rayonM(b.props) || 0)
          : false;

      paires.push({
        id: `${a.id}|${b.id}`,
        a,
        b,
        km,
        secant,
        positions: [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
      });
    }
  }

  paires.sort((x, y) => x.km - y.km);

  /* --- Grappes : composantes connexes du graphe de proximité --- */
  const voisins = new Map();
  for (const p of paires) {
    if (!voisins.has(p.a.id)) voisins.set(p.a.id, []);
    if (!voisins.has(p.b.id)) voisins.set(p.b.id, []);
    voisins.get(p.a.id).push(p.b.id);
    voisins.get(p.b.id).push(p.a.id);
  }

  const vus = new Set();
  const grappes = [];
  for (const id of voisins.keys()) {
    if (vus.has(id)) continue;
    const pile = [id];
    const comp = [];
    vus.add(id);
    while (pile.length) {
      const x = pile.pop();
      comp.push(x);
      for (const y of voisins.get(x) || []) {
        if (!vus.has(y)) {
          vus.add(y);
          pile.push(y);
        }
      }
    }
    grappes.push(comp);
  }
  grappes.sort((a, b) => b.length - a.length);

  return {
    maxKm,
    paires,
    secantes: paires.filter((p) => p.secant).length,
    grappes: grappes.map((g) => g.length),
    entitesConcernees: vus.size,
    total: pts.length,
    calculsGeodesiques: calculs,
    pairesTheoriques: (pts.length * (pts.length - 1)) / 2,
  };
}

/* ---------------------------- formatage ---------------------------- */

/** Valeur compacte pour les tuiles : 36,8 M / 710,8 k / 504. */
export function compact(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace('.', ',') + ' Md';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' M';
  if (abs >= 1e4) return Math.round(n / 1e3).toLocaleString('fr-FR') + ' k';
  return Math.round(n).toLocaleString('fr-FR');
}

/** Nombre entier avec séparateurs de milliers français. */
export const entier = (n) =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('fr-FR');

/** Borne haute d'une classe d'histogramme, en libellé court. */
export const borne = (v) => (v === Infinity ? '+' : compact(v));
