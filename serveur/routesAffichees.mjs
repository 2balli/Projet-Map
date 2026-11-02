/**
 * LA ROUTE TELLE QU'ELLE EST DESSINÉE — et non telle que le graphe la connaît.
 *
 * POURQUOI CE MODULE EXISTE. Le projet porte DEUX géométries du même réseau,
 * produites par `npm run build:roads` avec deux simplifications différentes :
 *
 *   `graphe_routier.json`     simplifié à 40 m — il sert à CALCULER : distances,
 *                             itinéraires, temps de trajet, accrochage ;
 *   `routes_*.geojson`        simplifié à 60 m — il sert à DESSINER : c'est le
 *                             trait que l'utilisateur voit sur la carte.
 *
 * Un point posé exactement sur une arête du graphe peut donc se trouver à
 * plusieurs dizaines de mètres du trait affiché — jusqu'à une centaine dans un
 * virage, quand les deux simplifications coupent la courbe de part et d'autre.
 * Le barrage est alors « sur une route » pour tous les calculs, et visiblement
 * À CÔTÉ de la route pour qui regarde la carte. Mesuré sur le dispositif semé :
 * 14 % des postes à plus de 25 m du trait, jusqu'à 67 m.
 *
 * CE MODULE PROJETTE SUR CE QUI EST DESSINÉ. On garde le graphe pour choisir
 * l'emplacement — c'est lui qui connaît les brigades, les classes et les
 * temps — puis on rabat le point sur la polyligne affichée la plus proche. Le
 * poste reste routable (l'écart est de quelques dizaines de mètres, très en
 * deçà du rayon d'accrochage) et il tombe exactement sur le trait.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { distanceKm } from './routage.mjs';

/** Les quatre couches que la carte dessine — voir ROUTE_LAYERS. */
export const COUCHES_ROUTES = [
  'routes_autoroute.geojson',
  'routes_nationale.geojson',
  'routes_regionale.geojson',
  'routes_provinciale.geojson',
];

/** Maille de l'index — ~2 km, assez fin pour ne regarder que neuf cases. */
const MAILLE = 0.02;

/**
 * Charge les segments affichés et les indexe spatialement.
 *
 * Un SEGMENT, et non un point : projeter sur des points repris tous les 200 m
 * laisserait un écart d'échantillonnage du même ordre que celui qu'on corrige.
 * La projection orthogonale sur le segment, elle, est exacte.
 */
export function chargerRoutesAffichees(racineCouches) {
  const segments = [];
  const refs = [];

  for (const nom of COUCHES_ROUTES) {
    const chemin = join(racineCouches, nom);
    if (!existsSync(chemin)) continue;
    const couche = JSON.parse(readFileSync(chemin, 'utf8'));
    for (const f of couche.features ?? []) {
      const g = f.geometry;
      if (!g) continue;
      const lignes = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      const ref = f.properties?.ref ?? '';
      const classe = f.properties?.classe ?? '';
      for (const ligne of lignes ?? []) {
        for (let i = 1; i < ligne.length; i++) {
          segments.push([ligne[i - 1], ligne[i]]);
          refs.push({ ref, classe });
        }
      }
    }
  }

  const grille = new Map();
  segments.forEach((s, i) => {
    const xMin = Math.min(s[0][0], s[1][0]);
    const xMax = Math.max(s[0][0], s[1][0]);
    const yMin = Math.min(s[0][1], s[1][1]);
    const yMax = Math.max(s[0][1], s[1][1]);
    for (let x = Math.floor(xMin / MAILLE); x <= Math.floor(xMax / MAILLE); x++) {
      for (let y = Math.floor(yMin / MAILLE); y <= Math.floor(yMax / MAILLE); y++) {
        const cle = `${x}|${y}`;
        if (!grille.has(cle)) grille.set(cle, []);
        grille.get(cle).push(i);
      }
    }
  });

  return { segments, refs, grille, nombre: segments.length };
}

/** Projection orthogonale d'un point sur un segment, bornée à ses extrémités. */
function projeter(px, py, segment) {
  const [[ax, ay], [bx, by]] = segment;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { lng: x, lat: y, metres: distanceKm(px, py, x, y) * 1000 };
}

/**
 * LE POINT DU TRAIT DESSINÉ LE PLUS PROCHE — ou `null` si rien à portée.
 *
 * `anneaux` élargit la recherche case par case : un poste au bord d'une maille
 * doit pouvoir trouver un segment de la maille voisine. Deux anneaux couvrent
 * ~6 km, largement au-delà des écarts corrigés ici.
 */
export function pointSurRouteAffichee(index, lng, lat, anneaux = 2) {
  return meilleurPoint(index, lng, lat, anneaux, null);
}

/**
 * LE POINT DU TRAIT LE PLUS PROCHE QUI SATISFASSE UNE CONDITION.
 *
 * `accepte(lng, lat)` filtre les candidats — en pratique : « ce point est-il
 * encore dans la circonscription du poste ? ». Sans ce filtre, un poste au bord
 * d'un découpage se ferait rabattre sur le trait le plus proche, qui passe
 * parfois chez le voisin : il gagnerait trois mètres et changerait d'autorité.
 *
 * On ne s'arrête donc plus au premier segment venu : on garde le plus proche
 * PARMI CEUX QUI PASSENT. C'est ce qui permet de recaler les postes de bordure
 * au lieu de les laisser de côté.
 */
export function pointSurRouteAccepte(index, lng, lat, accepte, anneaux = 3) {
  return meilleurPoint(index, lng, lat, anneaux, accepte);
}

function meilleurPoint(index, lng, lat, anneaux, accepte) {
  const cx = Math.floor(lng / MAILLE);
  const cy = Math.floor(lat / MAILLE);
  let meilleur = null;

  for (let r = 0; r <= anneaux; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        /* Anneau seulement : les cases intérieures ont déjà été vues. */
        if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        for (const i of index.grille.get(`${cx + dx}|${cy + dy}`) ?? []) {
          const p = projeter(lng, lat, index.segments[i]);
          if (meilleur && p.metres >= meilleur.metres) continue;
          /* Le filtre s'applique APRÈS la projection : c'est le point rabattu
             qu'il faut juger, pas le segment dont il vient. */
          if (accepte && !accepte(p.lng, p.lat)) continue;
          meilleur = { ...p, ...index.refs[i] };
        }
      }
    }
    /* Dès qu'on tient un point plus proche que la largeur d'un anneau, les
       anneaux suivants ne peuvent plus faire mieux. */
    if (meilleur && meilleur.metres < r * MAILLE * 111_000) break;
  }

  return meilleur;
}
