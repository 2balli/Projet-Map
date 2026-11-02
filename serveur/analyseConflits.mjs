/**
 * ANALYSE DE CONFLITS PRÉ-TRAITEMENT — le rapport complet AVANT qu'un CMND
 * Région ne clique « Traiter ».
 *
 * Ce module COMPOSE les outils existants — il n'invente aucune mesure :
 *   — `controleDistance`     (modificationBarrage.mjs) : conflits de distance
 *   — `distanceRouteMinKm`  (distances.mjs)           : distance PAR LA ROUTE
 *   — `analyserEspacement`  (espacementRoute.mjs)     : espacement sur un axe
 *   — `accrocher`           (routage.mjs)             : rattachement au réseau
 *   — `factionsDuBarrage`   (factions.mjs)            : factions d'un poste
 *   — `estIntouchable`      (depot.mjs)               : protection permanente
 *
 * Aucune distance n'est inventée. Si le graphe routier est absent ou si la
 * position ne peut pas être rattachée, le rapport le dit : « données
 * insuffisantes — aucun conflit ne peut être confirmé ».
 *
 * La fonction `analyserConflitsComplet` est RÉUTILISABLE par tous les modules
 * d'optimisation — un seul code, les mêmes règles.
 */
import { distanceKm, accrocher, refArete } from './routage.mjs';
import { distanceRouteMinKm } from './distances.mjs';
import { estIntouchable, estTypeBarrage } from './depot.mjs';
import { factionsDuBarrage } from './factions.mjs';
import { controleDistance, enService, factionsPourConflit } from './modificationBarrage.mjs';

/**
 * NIVEAUX DE SÉVÉRITÉ — du plus grave au plus léger.
 *
 *   critique    deux postes de même faction à moins de la moitié du seuil
 *   alerte      deux postes de même faction sous le seuil
 *   attention   situation à vérifier, données incomplètes ou seuil proche
 *   info        observation sans urgence (position à vérifier, etc.)
 */
export const SEVERITES = ['critique', 'alerte', 'attention', 'info'];

/**
 * TYPES DE CONFLITS détectés.
 */
export const TYPES_CONFLIT = [
  'distance_insuffisante',      // Deux postes trop proches sur la même faction
  'doublon_position',           // Même position (< 50m)
  'region_incorrecte',          // Barrage potentiellement dans la mauvaise région
  'route_incoherente',          // Route du barrage ne correspond pas à sa position
  'donnees_manquantes',         // Coordonnées, route ou rattachement absent
];

/**
 * ANALYSE COMPLÈTE DES CONFLITS D'UN BARRAGE — avant traitement.
 *
 * @param {object} params
 * @param {object} params.graphe — le réseau routier (null si absent)
 * @param {object} params.cible — le barrage à analyser
 * @param {Array}  params.barrages — tous les barrages du périmètre
 * @param {number} params.seuilKm — seuil de distance max (km)
 * @param {object} [params.creneaux] — créneaux par barrage pour la faction
 * @returns {object} le rapport complet
 */
export function analyserConflitsComplet({ graphe, cible, barrages, seuilKm, creneaux = null }) {
  const conflits = [];
  const avertissements = [];
  let routeCible = null;

  /* ---- 1. Données manquantes ---- */
  if (!Number.isFinite(cible.lng) || !Number.isFinite(cible.lat)) {
    avertissements.push({
      type: 'donnees_manquantes',
      severite: 'attention',
      message: 'Coordonnées du barrage manquantes ou invalides.',
      suggestion: 'Vérifiez la position du barrage sur la carte.',
    });
    return rapportVide(cible, avertissements);
  }

  if (!graphe) {
    avertissements.push({
      type: 'donnees_manquantes',
      severite: 'info',
      message: 'Réseau routier non chargé : les distances par la route ne peuvent pas être calculées.',
      suggestion: 'Les distances affichées sont à vol d\'oiseau, pas par la route.',
    });
  }

  /* ---- 2. Position sur le réseau ---- */
  if (graphe) {
    const acc = accrocher(graphe, cible.lng, cible.lat, 2);
    if (acc) {
      const ref = refArete(graphe, acc.arete);
      routeCible = ref;
      if (cible.route && ref && cible.route !== ref) {
        avertissements.push({
          type: 'route_incoherente',
          severite: 'attention',
          message: `Le barrage est enregistré sur « ${cible.route} » mais la route la plus proche est « ${ref} ».`,
          suggestion: 'Vérifiez que la route enregistrée correspond à la position.',
        });
      }
    } else {
      avertissements.push({
        type: 'donnees_manquantes',
        severite: 'info',
        message: 'Le barrage n\'est rattaché à aucune route du réseau dans un rayon de 2 km.',
        suggestion: 'Vérifiez la position ou la route enregistrée.',
      });
    }
  }

  /* ---- 3. Conflits de distance (même faction) ---- */
  const factionsCible = new Set(factionsPourConflit(cible));
  const autresEnService = barrages.filter(
    (m) => m.id !== cible.id && estTypeBarrage(m.type) && enService(m),
  );

  const SEUIL_DOUBLON_KM = 0.05; // 50 m

  for (const autre of autresEnService) {
    const volOiseau = distanceKm(cible.lng, cible.lat, autre.lng, autre.lat);
    if (volOiseau > seuilKm * 1.5) continue; // Préfiltre large

    /* Distance par la route si possible. */
    let distRoute = null;
    if (graphe) {
      distRoute = distanceRouteMinKm(graphe, [cible.lng, cible.lat], [autre.lng, autre.lat]);
      if (distRoute == null && volOiseau >= SEUIL_DOUBLON_KM) continue;
    }
    const distAffichee = distRoute ?? volOiseau;
    const estRouteReelle = distRoute != null;

    /* Doublon de position (< 50 m). */
    if (volOiseau < SEUIL_DOUBLON_KM) {
      conflits.push({
        type: 'doublon_position',
        severite: 'critique',
        barrageId: autre.id,
        barrageNom: autre.nom || '',
        barrageRoute: autre.route || null,
        barragePk: autre.pk ?? null,
        barrageCie: autre.cie ?? null,
        barrageBt: autre.bt ?? null,
        distanceKm: Math.round(volOiseau * 1000) / 1000,
        distanceRouteKm: distRoute != null ? Math.round(distRoute * 10) / 10 : null,
        estDistanceRoute: estRouteReelle,
        seuilKm,
        intouchable: estIntouchable(autre),
        message: `Position identique ou quasi identique (${Math.round(volOiseau * 1000)} m).`,
        suggestion: 'Vérifiez s\'il s\'agit d\'un doublon à supprimer.',
      });
      continue;
    }

    /* Conflit de distance : même faction, sous le seuil. */
    const factionsAutre = factionsPourConflit(autre);
    const factionsCommunes = factionsAutre.filter((f) => factionsCible.has(f));
    if (!factionsCommunes.length) continue;

    if (distAffichee < seuilKm) {
      const moitieSeuil = seuilKm / 2;
      const severite = distAffichee < moitieSeuil ? 'critique' : 'alerte';

      conflits.push({
        type: 'distance_insuffisante',
        severite,
        barrageId: autre.id,
        barrageNom: autre.nom || '',
        barrageRoute: autre.route || null,
        barragePk: autre.pk ?? null,
        barrageCie: autre.cie ?? null,
        barrageBt: autre.bt ?? null,
        distanceKm: Math.round(distAffichee * 10) / 10,
        distanceRouteKm: distRoute != null ? Math.round(distRoute * 10) / 10 : null,
        distanceVolOiseauKm: Math.round(volOiseau * 10) / 10,
        estDistanceRoute: estRouteReelle,
        seuilKm,
        factionsCommunes,
        intouchable: estIntouchable(autre),
        message: `Barrage « ${autre.nom || autre.id} » à ${Math.round(distAffichee * 10) / 10} km` +
          (estRouteReelle ? ' (par la route)' : ' (vol d\'oiseau)') +
          ` — seuil : ${seuilKm} km.`,
        suggestion: distAffichee < moitieSeuil
          ? 'Conflit critique : envisagez le retrait ou le déplacement de l\'un des deux postes.'
          : 'Distance inférieure au seuil configuré : justification requise.',
      });
    }
  }

  /* ---- 4. Vérification du rattachement territorial ---- */
  if (!cible.bt) {
    avertissements.push({
      type: 'donnees_manquantes',
      severite: 'attention',
      message: 'Le barrage n\'est rattaché à aucune brigade territoriale.',
      suggestion: 'Vérifiez la position : elle tombe peut-être hors du territoire couvert.',
    });
  }

  /* ---- Rapport final ---- */
  /* Tri : critique d'abord, puis alerte, attention, info. */
  const ordreS = Object.fromEntries(SEVERITES.map((s, i) => [s, i]));
  conflits.sort((a, b) => ordreS[a.severite] - ordreS[b.severite] || (a.distanceKm ?? 999) - (b.distanceKm ?? 999));

  return {
    barrageId: cible.id,
    barrageNom: cible.nom || '',
    barrageRoute: cible.route || null,
    barragePk: cible.pk ?? null,
    barrageBt: cible.bt ?? null,
    barrageCie: cible.cie ?? null,
    barrageReg: cible.reg ?? null,
    routeDetectee: routeCible,
    reseauRoutierDisponible: !!graphe,
    seuilKm,
    /* Résumé. */
    totalBarragesAnalyses: autresEnService.length,
    totalConflits: conflits.length,
    totalAvertissements: avertissements.length,
    conflitsCritiques: conflits.filter((c) => c.severite === 'critique').length,
    conflitsAlertes: conflits.filter((c) => c.severite === 'alerte').length,
    /* Détails. */
    conflits,
    avertissements,
  };
}

/** Rapport vide quand l'analyse est impossible. */
function rapportVide(cible, avertissements) {
  return {
    barrageId: cible.id,
    barrageNom: cible.nom || '',
    barrageRoute: cible.route || null,
    barragePk: cible.pk ?? null,
    barrageBt: cible.bt ?? null,
    barrageCie: cible.cie ?? null,
    barrageReg: cible.reg ?? null,
    routeDetectee: null,
    reseauRoutierDisponible: false,
    seuilKm: 0,
    totalBarragesAnalyses: 0,
    totalConflits: 0,
    totalAvertissements: avertissements.length,
    conflitsCritiques: 0,
    conflitsAlertes: 0,
    conflits: [],
    avertissements,
  };
}

/**
 * ANALYSE DE CONFLITS SUR UNE ROUTE ENTIÈRE — espacement des barrages le long
 * d'un axe, avec le seuil configurable.
 *
 * @param {object} params
 * @param {object} params.graphe — le réseau routier
 * @param {Array}  params.barrages — les barrages sur la route
 * @param {number} params.seuilKm — écart max entre barrages consécutifs
 * @param {string} params.routeRef — identifiant de la route (RN1, A2…)
 * @returns {object} le rapport de route
 */
export function analyserConflitsRoute({ graphe, barrages, seuilKm, routeRef }) {
  if (!graphe || !barrages.length) {
    return {
      routeRef,
      totalBarrages: barrages.length,
      reseauRoutierDisponible: !!graphe,
      conflits: [],
      avertissements: !graphe
        ? [{ type: 'donnees_manquantes', severite: 'info', message: 'Réseau routier indisponible.' }]
        : [],
    };
  }

  /* Trier les barrages par PK le long de la route, quand disponible. */
  const tries = [...barrages]
    .filter((m) => Number.isFinite(m.pk))
    .sort((a, b) => a.pk - b.pk);

  const conflits = [];
  for (let i = 0; i < tries.length - 1; i++) {
    const a = tries[i];
    const b = tries[i + 1];
    const distRoute = distanceRouteMinKm(graphe, [a.lng, a.lat], [b.lng, b.lat]);
    const distVol = distanceKm(a.lng, a.lat, b.lng, b.lat);
    const dist = distRoute ?? distVol;

    if (dist > seuilKm) {
      conflits.push({
        type: 'distance_insuffisante',
        severite: dist > seuilKm * 1.5 ? 'alerte' : 'attention',
        barrageA: { id: a.id, nom: a.nom || '', pk: a.pk },
        barrageB: { id: b.id, nom: b.nom || '', pk: b.pk },
        distanceKm: Math.round(dist * 10) / 10,
        distanceRouteKm: distRoute != null ? Math.round(distRoute * 10) / 10 : null,
        estDistanceRoute: distRoute != null,
        seuilKm,
        message: `Espacement de ${Math.round(dist * 10) / 10} km entre « ${a.nom || a.id} » (PK ${a.pk}) et « ${b.nom || b.id} » (PK ${b.pk}) — seuil : ${seuilKm} km.`,
      });
    }
  }

  return {
    routeRef,
    totalBarrages: barrages.length,
    totalBarragesAvecPk: tries.length,
    reseauRoutierDisponible: true,
    seuilKm,
    conflits,
  };
}
