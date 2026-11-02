/**
 * DESSIN PROGRESSIF D'UNE ROUTE RÉELLE — partagé par le radar des conflits
 * (RadarConflits.jsx) et « Voir sur la carte » (RouteAnimee.jsx).
 *
 * Sur l'élément SVG d'une polyligne Leaflet (renderer SVG obligatoire : la
 * carte est en canvas par défaut) :
 *   — le trait se dessine du premier point au dernier (pathLength = 100,
 *     stroke-dashoffset 100 → 0) : c'est la géométrie EXACTE qui se révèle,
 *     chaque virage compris ;
 *   — un point lumineux suit la route pendant le dessin (SVG animateMotion +
 *     mpath sur le même tracé, même courbe d'accélération), puis s'éteint ;
 *   — à la fin, la route reste entière (fill forwards) ; rien ne boucle.
 * Animations réduites : la route paraît d'un coup, sans point.
 *
 * Fonctions de mesure pures (longueur, point à mi-parcours, durée) : éprouvées
 * par `npm run check:trace`.
 */

const R_TERRE_KM = 6371.0088;
const RAD = Math.PI / 180;
const distKm = ([la1, lo1], [la2, lo2]) => {
  const dLa = (la2 - la1) * RAD;
  const dLo = (lo2 - lo1) * RAD;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * R_TERRE_KM * Math.asin(Math.sqrt(h));
};

/** Longueur d'une polyligne [lat, lng] en km — la somme de SES segments. */
export function longueurKm(points) {
  let d = 0;
  for (let i = 1; i < (points?.length ?? 0); i++) d += distKm(points[i - 1], points[i]);
  return d;
}

/** Le point situé à la fraction `f` de la longueur, sur la polyligne même. */
export function pointLeLong(points, f = 0.5) {
  if (!points?.length) return null;
  if (points.length === 1) return points[0];
  const total = longueurKm(points);
  let cible = Math.max(0, Math.min(1, f)) * total;
  for (let i = 1; i < points.length; i++) {
    const seg = distKm(points[i - 1], points[i]);
    if (cible <= seg || i === points.length - 1) {
      const t = seg > 0 ? Math.min(1, cible / seg) : 0;
      const [a, b] = [points[i - 1], points[i]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    cible -= seg;
  }
  return points.at(-1);
}

/**
 * Durée du dessin selon la longueur RÉELLE : ~4–6 s pour une route courante,
 * bornée (3,5 s – 6,5 s) pour les très courtes et les très longues.
 */
export function dureeDessin(km) {
  const k = Number.isFinite(km) ? km : 10;
  return Math.round(Math.min(6.5, Math.max(3.5, 3.4 + 0.1 * k)) * 100) / 100;
}

/** Courbe commune au trait et au point (CSS cubic-bezier ↔ SVG keySplines). */
const COURBE = [0.45, 0.05, 0.35, 1];
const NS = 'http://www.w3.org/2000/svg';
let suivant = 0;

const mouvementReduit = () => {
  try {
    return document.documentElement.dataset.mouvement === 'reduit';
  } catch {
    return false;
  }
};

/**
 * Anime le tracé SVG `path`. Retourne la fonction de nettoyage (retire le
 * point lumineux) — à appeler quand la couche quitte la carte.
 *
 * @param {SVGPathElement} path
 * @param {{ delaiS?: number, dureeS?: number, point?: boolean, classe?: string }} o
 */
export function animerTrace(path, { delaiS = 0, dureeS = 4.5, point = true, classe = 'gr-trace-anime' } = {}) {
  if (!path) return () => {};
  path.classList.add(classe);
  path.setAttribute('pathLength', '100');
  path.style.setProperty('--gr-delai', `${delaiS}s`);
  path.style.setProperty('--gr-duree-trace', `${dureeS}s`);
  path.style.setProperty('--gr-courbe', `cubic-bezier(${COURBE.join(',')})`);
  if (!point || mouvementReduit() || !path.parentNode) return () => {};

  if (!path.id) path.id = `gr-trace-${++suivant}`;
  const lueur = document.createElementNS(NS, 'circle');
  lueur.setAttribute('r', '4.5');
  lueur.setAttribute('class', 'gr-trace-point');
  lueur.setAttribute('opacity', '0');
  const mouvement = document.createElementNS(NS, 'animateMotion');
  mouvement.setAttribute('dur', `${dureeS}s`);
  mouvement.setAttribute('begin', 'indefinite');
  mouvement.setAttribute('fill', 'freeze');
  mouvement.setAttribute('calcMode', 'spline');
  mouvement.setAttribute('keyPoints', '0;1');
  mouvement.setAttribute('keyTimes', '0;1');
  mouvement.setAttribute('keySplines', COURBE.join(' '));
  const mpath = document.createElementNS(NS, 'mpath');
  mpath.setAttribute('href', `#${path.id}`);
  mouvement.appendChild(mpath);
  /* Visible le temps du dessin seulement, puis s'éteint (pas de boucle). */
  const presence = document.createElementNS(NS, 'animate');
  presence.setAttribute('attributeName', 'opacity');
  presence.setAttribute('values', '0;1;1;0');
  presence.setAttribute('keyTimes', '0;0.06;0.9;1');
  presence.setAttribute('dur', `${dureeS}s`);
  presence.setAttribute('begin', 'indefinite');
  presence.setAttribute('fill', 'freeze');
  lueur.appendChild(mouvement);
  lueur.appendChild(presence);
  path.parentNode.appendChild(lueur);
  try {
    mouvement.beginElementAt(delaiS);
    presence.beginElementAt(delaiS);
  } catch {
    lueur.remove();
  }
  return () => lueur.remove();
}
