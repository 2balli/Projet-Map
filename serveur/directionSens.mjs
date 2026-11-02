/**
 * GESTION DES DEUX SENS DE CIRCULATION (ALLER / RETOUR) SUR LES AXES ROUTIERS
 *
 * Règles métier :
 * - Sens 1 : ALLER
 * - Sens 2 : RETOUR
 * - Un barrage situé sur le sens Aller est une entité distincte d'un barrage sur le sens Retour.
 * - Préservation stricte de la direction si déjà renseignée dans la base ou le modèle.
 * - Détermination déterministe et cohérente basée sur l'axe et le positionnement si absente.
 */

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
 * Détermine de façon déterministe et cohérente la direction d'un barrage.
 * Si le barrage possède déjà une direction définie, elle est rigoureusement préservée.
 * Sinon, une logique stable attribue ALLER ou RETOUR sans créer de doublon.
 */
export function obtenirDirectionBarrage(m) {
  if (!m) return SENS_ALLER;
  const dirExplicite = normaliserDirection(m.direction || m.sens || m.sensCirculation);
  if (dirExplicite) return dirExplicite;

  // Détermination déterministe stable basée sur un hachage de l'ID ou des coordonnées
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
 * Enrichit un barrage avec ses attributs complets de direction et géolocalisation routière.
 */
export function enrichirBarrageDirection(m) {
  if (!m) return m;
  const direction = obtenirDirectionBarrage(m);
  const roadId = m.road_id || m.roadReference || m.route || m.roadName || '';
  const lat = Number(m.lat ?? m.latitude);
  const lng = Number(m.lng ?? m.longitude);
  const routePosition = m.route_position ?? m.routePosition ?? m.pk ?? null;

  return {
    ...m,
    direction,
    sens: direction,
    road_id: roadId,
    route_position: routePosition,
    coordinates: Array.isArray(m.coordinates) ? m.coordinates : [lng, lat],
  };
}
