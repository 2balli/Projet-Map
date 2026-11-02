/**
 * GESTION DU FILTRAGE PAR ROUTE ET DES DEUX SENS DE CIRCULATION (ALLER / RETOUR)
 *
 * Règles métier :
 * 1. Distinction claire entre les deux sens de circulation d'un même axe routier :
 *    - Sens 1 : ALLER (direction ascendante ou vers destination)
 *    - Sens 2 : RETOUR (direction descendante ou vers origine)
 * 2. Un barrage sur le sens Aller est une entité distincte du barrage sur le sens Retour.
 * 3. En cas de même tracé routier (chaussée bidirectionnelle), séparation visuelle légère
 *    des marqueurs (décalage latéral de voie de 5 à 6 mètres) pour éviter toute superposition
 *    tout en maintenant les barrages rigoureusement sur la chaussée.
 * 4. Détermination déterministe si la direction n'est pas explicitement fournie.
 */
import { canonicalRouteId } from './conflitsIdentifies.js';

export const SENS_ALLER = 'ALLER';
export const SENS_RETOUR = 'RETOUR';
export const SENS_TOUS = 'tous';

/**
 * Normalise une chaîne vers 'ALLER' ou 'RETOUR'.
 */
export function normaliserDirection(val) {
  if (!val) return null;
  const s = String(val).trim().toUpperCase();
  if (s === 'ALLER' || s === 'SENS_1' || s === 'SENS 1' || s === '1' || s === 'A') return SENS_ALLER;
  if (s === 'RETOUR' || s === 'SENS_2' || s === 'SENS 2' || s === '2' || s === 'R') return SENS_RETOUR;
  return null;
}

/**
 * Obtient la direction d'un barrage :
 * - Préserve strictement la direction existante si déjà renseignée.
 * - Sinon, déduit une direction stable et cohérente par hachage déterministe de l'identifiant.
 */
export function obtenirDirectionBarrage(m) {
  if (!m) return SENS_ALLER;
  const dirExplicite = normaliserDirection(m.direction || m.sens || m.sensCirculation);
  if (dirExplicite) return dirExplicite;

  const cle = String(m.id || m.nom || `${m.lat ?? m.latitude}_${m.lng ?? m.longitude}`);
  let hash = 0;
  for (let i = 0; i < cle.length; i++) {
    hash = ((hash << 5) - hash) + cle.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 2 === 0) ? SENS_ALLER : SENS_RETOUR;
}

/**
 * Libellé lisible complet de la direction.
 */
export function libelleDirection(dir) {
  const d = normaliserDirection(dir) || SENS_ALLER;
  return d === SENS_ALLER ? 'Sens Aller (Sens 1)' : 'Sens Retour (Sens 2)';
}

/**
 * Symbole fléché associé à la direction.
 */
export function symboleDirection(dir) {
  const d = normaliserDirection(dir) || SENS_ALLER;
  return d === SENS_ALLER ? '➔' : '⬅';
}

/**
 * Badge descriptif pour les fiches et popups.
 */
export function badgeDirection(dir) {
  const d = normaliserDirection(dir) || SENS_ALLER;
  const estAller = d === SENS_ALLER;
  return {
    code: d,
    nom: libelleDirection(d),
    symbole: symboleDirection(d),
    labelCourt: estAller ? 'Aller' : 'Retour',
    badgeCourt: estAller ? 'ALLER ➔' : '⬅ RETOUR',
    classe: estAller
      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
      : 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    classeCouleur: estAller
      ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
      : 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  };
}

/**
 * Distance approximative en mètres entre deux coordonnées géographiques WGS84.
 */
export function distanceMetres(lat1, lng1, lat2, lng2) {
  const latMoy = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const mLng = 111320 * Math.cos(latMoy);
  const dx = (lng2 - lng1) * mLng;
  const dy = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dy);
}
const distanceRapideMetres = distanceMetres;

/**
 * Calcule un décalage latéral léger (5 à 6 mètres) perpendiculaire à la voie
 * pour décoller visuellement deux barrages de sens opposés placés au même endroit,
 * tout en conservant les deux marqueurs sur la bande de roulement / chaussée.
 */
export function ajusterPositionSens({ lat, lng, direction, angleDeg = 90 }) {
  const dir = normaliserDirection(direction) || SENS_ALLER;
  // Décalage de 5.5 mètres : dans le sens Aller vers la droite (+), dans le sens Retour vers l'autre voie (-)
  const decalageMetres = dir === SENS_ALLER ? 5.5 : -5.5;

  const angleRad = ((angleDeg + 90) * Math.PI) / 180;
  const dLat = (decalageMetres * Math.cos(angleRad)) / 111320;
  const mLng = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLng = mLng !== 0 ? (decalageMetres * Math.sin(angleRad)) / mLng : 0;

  return [+(lat + dLat).toFixed(5), +(lng + dLng).toFixed(5)];
}

/**
 * Sépare visuellement les barrages proches (< 35m) situés sur le même axe routier
 * pour rendre les sens Aller et Retour distinctement visibles et cliquables sans superposition.
 */
export function separerBarragesSens(barrages = []) {
  if (!Array.isArray(barrages) || barrages.length < 2) return barrages;

  // Détection des paires superposées sur le même axe routier
  const superposes = new Set();
  const routeParId = new Map();

  for (const b of barrages) {
    const r = canonicalRouteId(b.route || b.roadName);
    if (r) routeParId.set(b.id, r);
  }

  for (let i = 0; i < barrages.length; i++) {
    const b1 = barrages[i];
    const r1 = routeParId.get(b1.id);
    if (!r1) continue;

    const lat1 = Number(b1.lat ?? b1.latitude);
    const lng1 = Number(b1.lng ?? b1.longitude);
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1)) continue;

    for (let j = i + 1; j < barrages.length; j++) {
      const b2 = barrages[j];
      const r2 = routeParId.get(b2.id);
      if (r1 === r2) {
        const lat2 = Number(b2.lat ?? b2.latitude);
        const lng2 = Number(b2.lng ?? b2.longitude);
        if (Number.isFinite(lat2) && Number.isFinite(lng2)) {
          const d = distanceRapideMetres(lat1, lng1, lat2, lng2);
          if (d <= 35) {
            superposes.add(b1.id);
            superposes.add(b2.id);
          }
        }
      }
    }
  }

  return barrages.map((m) => {
    const dir = obtenirDirectionBarrage(m);
    const roadId = m.road_id || routeParId.get(m.id) || m.route || m.roadName || '';
    const lat = Number(m.lat ?? m.latitude);
    const lng = Number(m.lng ?? m.longitude);

    let latAffichee = lat;
    let lngAffichee = lng;

    if (superposes.has(m.id)) {
      const [nLat, nLng] = ajusterPositionSens({ lat, lng, direction: dir });
      latAffichee = nLat;
      lngAffichee = nLng;
    }

    return {
      ...m,
      direction: dir,
      sens: dir,
      road_id: roadId,
      coordinates: [lng, lat],
      latAffichee,
      lngAffichee,
    };
  });
}
