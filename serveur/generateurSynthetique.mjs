/**
 * GÉNÉRATEUR DE DONNÉES SYNTHÉTIQUES RÉALISTES POUR BARRAGES FIXES
 *
 * Conforme aux spécifications :
 * - Deux types : FIXED et FIXED_PERMANENT (intouchable)
 * - Positionnement réaliste et strict sur le réseau routier (OpenStreetMap / graphe routier / couches affichées)
 * - Projection orthogonale (snapping) vers le segment routier affiché le plus proche
 * - Zéro barrage hors route
 * - Données synthétiques et statistiques crédibles (plages configurables, éclairage contextuel, circulation)
 * - Déterministe via seed (graine)
 * - Indicateur explicite isSynthetic = true
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chargerGraphe, pointsArete, classeArete, refArete, distanceKm } from './routage.mjs';
import { dansGeometrie } from './geo.mjs';
import {
  chargerRoutesAffichees,
  pointSurRouteAffichee,
  pointSurRouteAccepte,
} from './routesAffichees.mjs';

/**
 * Générateur de nombres pseudo-aléatoires déterministe (Mulberry32).
 */
export function creerPRNG(graine = 20261027) {
  let s = (Number(graine) || 20261027) >>> 0;
  return function rnd() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Boîte englobante d'une géométrie GeoJSON. */
function calculBbox(geometry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const parcourir = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      return;
    }
    c.forEach(parcourir);
  };
  parcourir(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Plages d'accidents configurables par défaut */
export const PLAGES_ACCIDENTS_DEFAUT = {
  autoroute: [10, 40],
  national: [5, 35],
  nationale: [5, 35],
  regional: [2, 20],
  regionale: [2, 20],
  provincial: [0, 12],
  provinciale: [0, 12],
  urban: [3, 25],
};

const CACHE_DONNEES = new Map();

function obtenirDonneesCouches(racineCouches) {
  if (CACHE_DONNEES.has(racineCouches)) {
    return CACHE_DONNEES.get(racineCouches);
  }

  const cheminCirco = join(racineCouches, 'circo_bt.geojson');
  const cheminGraphe = join(racineCouches, 'graphe_routier.json');
  const cheminPoles = join(racineCouches, 'poles-population.json');

  if (!existsSync(cheminCirco) || !existsSync(cheminGraphe)) {
    throw new Error(
      `Couches routières ou circonscriptions manquantes dans ${racineCouches}. Vérifiez la présence de circo_bt.geojson et graphe_routier.json.`,
    );
  }

  const circo = JSON.parse(readFileSync(cheminCirco, 'utf8'));
  const graphe = chargerGraphe(JSON.parse(readFileSync(cheminGraphe, 'utf8')));
  const routesAffichees = chargerRoutesAffichees(racineCouches);

  let poles = [];
  if (existsSync(cheminPoles)) {
    try {
      const pData = JSON.parse(readFileSync(cheminPoles, 'utf8'));
      poles = pData.poles ?? [];
    } catch {
      poles = [];
    }
  }

  const BRIGADES = [];
  const vues = new Set();
  for (const f of circo.features ?? []) {
    const bt = f.properties?.gr_bde;
    if (!bt || !f.geometry || vues.has(bt)) continue;
    vues.add(bt);
    BRIGADES.push({
      bt,
      cie: f.properties?.gr_cie ?? null,
      reg: f.properties?.gr_region ?? null,
      geometry: f.geometry,
      bbox: calculBbox(f.geometry),
    });
  }

  const MAILLE_DEG = 0.25;
  const GRILLE_CIRCO = new Map();
  BRIGADES.forEach((b, i) => {
    const [minX, minY, maxX, maxY] = b.bbox;
    for (let x = Math.floor(minX / MAILLE_DEG); x <= Math.floor(maxX / MAILLE_DEG); x++) {
      for (let y = Math.floor(minY / MAILLE_DEG); y <= Math.floor(maxY / MAILLE_DEG); y++) {
        const cle = `${x}|${y}`;
        if (!GRILLE_CIRCO.has(cle)) GRILLE_CIRCO.set(cle, []);
        GRILLE_CIRCO.get(cle).push(i);
      }
    }
  });

  const brigadeDuPoint = (lng, lat) => {
    const candidates = GRILLE_CIRCO.get(`${Math.floor(lng / MAILLE_DEG)}|${Math.floor(lat / MAILLE_DEG)}`);
    if (!candidates) return null;
    for (const i of candidates) {
      const b = BRIGADES[i];
      const [minX, minY, maxX, maxY] = b.bbox;
      if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
      if (dansGeometrie([lng, lat], b.geometry)) return b;
    }
    return null;
  };

  const CLASSES_RETENUES = new Set(['autoroute', 'nationale', 'regionale', 'provinciale']);
  const PAS_ECHANTILLON_KM = 3.0;
  const candidats = [];

  for (let i = 0; i < graphe.nA; i++) {
    const classe = classeArete(graphe, i);
    if (!CLASSES_RETENUES.has(classe)) continue;
    const ref = refArete(graphe, i) || '';
    const pts = pointsArete(graphe, i);

    let reste = 0;
    for (let k = 1; k < pts.length; k++) {
      const [x1, y1] = pts[k - 1];
      const [x2, y2] = pts[k];
      const seg = distanceKm(x1, y1, x2, y2);
      if (!(seg > 0)) continue;

      let pos = reste;
      while (pos <= seg) {
        const t = pos / seg;
        const lng = x1 + t * (x2 - x1);
        const lat = y1 + t * (y2 - y1);
        const b = brigadeDuPoint(lng, lat);
        if (b) {
          candidats.push({
            lng,
            lat,
            classe,
            ref,
            brigade: b,
          });
        }
        pos += PAS_ECHANTILLON_KM;
      }
      reste = pos - seg;
    }
  }

  const donnees = {
    circo,
    graphe,
    routesAffichees,
    poles,
    BRIGADES,
    GRILLE_CIRCO,
    brigadeDuPoint,
    candidats,
  };
  CACHE_DONNEES.set(racineCouches, donnees);
  return donnees;
}

/**
 * Moteur principal de génération de barrages fixes synthétiques.
 */
export function genererBarragesFixesSynthetiques({
  racineCouches,
  graine = 20261027,
  nombre = 120,
  ratioPermanent = 0.25,
  espacementKm = 4.0,
  espacementReelsKm = 2.0,
  accidentPeriod = '2025-2026',
  plagesAccidents = PLAGES_ACCIDENTS_DEFAUT,
  existantItems = [],
} = {}) {
  const rnd = creerPRNG(graine);

  // 1. Récupération des données mises en cache
  const { routesAffichees, poles, candidats: candidatsBruts } = obtenirDonneesCouches(racineCouches);
  const candidats = candidatsBruts.map((c) => ({ ...c }));

  // Détermination du contexte urbain / périurbain / rural
  const determinerContexte = (lng, lat) => {
    if (!poles.length) return 'rural';
    let minD = Infinity;
    let poleProche = null;
    for (const p of poles) {
      const d = distanceKm(lng, lat, p.lng, p.lat);
      if (d < minD) {
        minD = d;
        poleProche = p;
      }
    }
    if (!poleProche) return 'rural';
    const r = poleProche.rayonKm || 5;
    if (minD <= r) return 'urban';
    if (minD <= r * 2.5) return 'periurban';
    return 'rural';
  };

  // 5. Filtrage contre les barrages réels/manuels existants
  const barragesReels = (existantItems || []).filter(
    (m) => !m.isSynthetic && Number.isFinite(m.lng ?? m.longitude) && Number.isFinite(m.lat ?? m.latitude),
  );

  const tropProcheReel = (lng, lat) => {
    for (const r of barragesReels) {
      const rLng = r.lng ?? r.longitude;
      const rLat = r.lat ?? r.latitude;
      if (distanceKm(lng, lat, rLng, rLat) < espacementReelsKm) return true;
    }
    return false;
  };

  // 6. Sélection étalée et déterministe
  // Mélange pseudo-aléatoire déterministe
  for (let i = candidats.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const temp = candidats[i];
    candidats[i] = candidats[j];
    candidats[j] = temp;
  }

  const selectionnes = [];
  const refsChoisies = new Map();

  for (const cand of candidats) {
    if (selectionnes.length >= nombre) break;

    // Snapping orthogonal sur la polyligne de route affichée la plus proche dans la brigade
    const surTrait =
      pointSurRouteAccepte(routesAffichees, cand.lng, cand.lat, (x, y) =>
        dansGeometrie([+x.toFixed(5), +y.toFixed(5)], cand.brigade.geometry),
      ) ?? pointSurRouteAffichee(routesAffichees, cand.lng, cand.lat);

    const pointFinal = surTrait && surTrait.metres <= 250 ? surTrait : cand;
    const fLng = +Number(pointFinal.lng).toFixed(5);
    const fLat = +Number(pointFinal.lat).toFixed(5);

    // Contrôle d'espacement par rapport aux réels existants
    if (tropProcheReel(fLng, fLat)) continue;

    // Contrôle d'espacement par rapport aux autres barrages synthétiques déjà choisis
    let tropProcheAutre = false;
    for (const s of selectionnes) {
      if (distanceKm(fLng, fLat, s.longitude, s.latitude) < espacementKm) {
        tropProcheAutre = true;
        break;
      }
    }
    if (tropProcheAutre) continue;

    // Diversité des axes
    const cleRef = cand.ref || cand.classe;
    const compteRef = refsChoisies.get(cleRef) ?? 0;
    if (compteRef >= 4 && rnd() > 0.3) continue; // Favorise les axes variés
    refsChoisies.set(cleRef, compteRef + 1);

    // 7. Caractérisation de la route
    const roadTypeMap = {
      autoroute: 'Autoroute',
      nationale: 'Route Nationale',
      regionale: 'Route Régionale',
      provinciale: 'Route Provinciale',
    };
    const roadType = roadTypeMap[cand.classe] ?? 'Route';
    const roadReference = cand.ref ? cand.ref.toUpperCase() : (cand.classe === 'autoroute' ? 'A' : '');
    const roadName = cand.ref ? `${roadType} ${cand.ref.toUpperCase()}` : roadType;

    // 8. Génération du contexte et des statistiques
    const contexte = determinerContexte(fLng, fLat);

    // Accidents dans les plages configurées selon le type de route
    const cleClasse = cand.classe === 'nationale' ? 'national' :
                      cand.classe === 'regionale' ? 'regional' :
                      cand.classe === 'provinciale' ? 'provincial' : cand.classe;
    const plageBase = plagesAccidents[cand.classe] ?? plagesAccidents[cleClasse] ?? [2, 20];
    let [minAcc, maxAcc] = plageBase;
    if (contexte === 'urban') {
      // En zone urbaine, la densité de circulation tire les accidents vers la tranche supérieure de l'axe
      const decalage = Math.round((maxAcc - minAcc) * 0.25);
      minAcc = Math.min(maxAcc, minAcc + decalage);
    }
    const accidentCount = Math.floor(rnd() * (maxAcc - minAcc + 1)) + minAcc;

    // Éclairage (isLighted) selon contexte
    const probaEclairage =
      contexte === 'urban' ? 0.85 :
      contexte === 'periurban' ? 0.50 :
      cand.classe === 'autoroute' ? 0.40 : 0.15;
    const isLighted = rnd() < probaEclairage;

    // Circulation (trafficLevel & trafficDescription)
    let trafficLevel = 'MODERATE';
    const tirageTrafic = rnd();
    if (cand.classe === 'autoroute' || contexte === 'urban') {
      trafficLevel = tirageTrafic < 0.45 ? 'VERY_HIGH' : tirageTrafic < 0.85 ? 'HIGH' : 'MODERATE';
    } else if (cand.classe === 'nationale') {
      trafficLevel = tirageTrafic < 0.15 ? 'VERY_HIGH' : tirageTrafic < 0.65 ? 'HIGH' : tirageTrafic < 0.90 ? 'MODERATE' : 'LOW';
    } else if (cand.classe === 'regionale') {
      trafficLevel = tirageTrafic < 0.08 ? 'HIGH' : tirageTrafic < 0.70 ? 'MODERATE' : 'LOW';
    } else {
      trafficLevel = tirageTrafic < 0.05 ? 'HIGH' : tirageTrafic < 0.35 ? 'MODERATE' : 'LOW';
    }

    const trafficDescriptions = {
      LOW: 'Circulation fluide',
      MODERATE: 'Circulation modérée',
      HIGH: 'Circulation dense',
      VERY_HIGH: 'Circulation très dense',
    };
    const trafficDescription = trafficDescriptions[trafficLevel];

    // Type : FIXED vs FIXED_PERMANENT
    const isPermanent = rnd() < ratioPermanent;
    const type = isPermanent ? 'FIXED_PERMANENT' : 'FIXED';

    const indexNumero = selectionnes.length + 1;
    const prefixeId = isPermanent ? 'syn_bfp' : 'syn_bf';
    const hashId = Math.abs(Math.sin(graine + indexNumero) * 10000000).toString(36).slice(0, 6);
    const id = `${prefixeId}_${String(indexNumero).padStart(3, '0')}_${hashId}`;

    const brigadeNom = cand.brigade.bt || 'Territoire';
    const name = `${isPermanent ? 'Barrage Permanent' : 'Barrage Fixe'} ${roadReference || roadType} — ${brigadeNom}`;

    const dateCreation = new Date(Date.UTC(2026, 9, 27, 8, (indexNumero * 7) % 60)).toISOString();

    // Sens de circulation : alternance réaliste (Sens 1: ALLER, Sens 2: RETOUR)
    const direction = indexNumero % 2 === 1 ? 'ALLER' : 'RETOUR';

    const barrage = {
      id,
      name,
      nom: name,
      type,
      latitude: fLat,
      longitude: fLng,
      lat: fLat,
      lng: fLng,
      roadName,
      route: roadName,
      roadType,
      roadReference,
      ref: roadReference,
      direction,
      sens: direction,
      road_id: roadReference || roadType,
      route_position: null,
      coordinates: [fLng, fLat],
      accidentCount,
      accidentPeriod,
      isLighted,
      eclairage: isLighted ? 'oui' : 'non',
      trafficLevel,
      trafficDescription,
      isPermanent,
      isSynthetic: true,
      protection: isPermanent ? 'intouchable' : 'aucune',
      intouchable: isPermanent,
      statutBarrage: 'approuve',
      statut: 'Opérationnel',
      bt: cand.brigade.bt,
      cie: cand.brigade.cie,
      reg: cand.brigade.reg,
      compagnieId: cand.brigade.cie,
      brigadeId: cand.brigade.bt,
      regionId: cand.brigade.reg,
      contexte,
      createdAt: dateCreation,
      updatedAt: dateCreation,
      cree: dateCreation,
      maj: dateCreation,
      auteur: {
        matricule: 'SYNTHETIC-SYSTEM',
        nom: 'Générateur Synthétique',
        role: 'systeme',
        rang: 'admin',
        unite: 'systeme',
      },
    };

    selectionnes.push(barrage);
  }

  // Statistiques résumées
  const nbPermanents = selectionnes.filter((b) => b.type === 'FIXED_PERMANENT').length;
  const nbFixes = selectionnes.filter((b) => b.type === 'FIXED').length;
  const nbEclaires = selectionnes.filter((b) => b.isLighted).length;
  const totalAccidents = selectionnes.reduce((acc, b) => acc + b.accidentCount, 0);

  const parRoute = {};
  const parNiveau = {};
  const parContexte = {};
  for (const b of selectionnes) {
    parRoute[b.roadType] = (parRoute[b.roadType] ?? 0) + 1;
    parNiveau[b.trafficLevel] = (parNiveau[b.trafficLevel] ?? 0) + 1;
    parContexte[b.contexte] = (parContexte[b.contexte] ?? 0) + 1;
  }

  return {
    barrages: selectionnes,
    statistiques: {
      total: selectionnes.length,
      fixes: nbFixes,
      permanents: nbPermanents,
      eclaires: nbEclaires,
      tauxEclairage: Math.round((nbEclaires / (selectionnes.length || 1)) * 100),
      totalAccidents,
      moyenneAccidents: +(totalAccidents / (selectionnes.length || 1)).toFixed(1),
      accidentPeriod,
      parRoute,
      parNiveau,
      parContexte,
    },
  };
}
