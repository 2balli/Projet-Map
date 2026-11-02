/**
 * Contrôle géographique côté serveur : un point est-il dans la circonscription
 * de l'unité qui écrit ?
 *
 * C'EST ICI que la règle est appliquée. Le navigateur fait le même contrôle,
 * mais uniquement pour prévenir l'utilisateur avant d'envoyer : un client
 * modifié peut toujours mentir, donc rien n'est accepté sans cette vérification.
 *
 * Le test point-dans-polygone est réimplémenté (lancer de rayon, ~40 lignes)
 * plutôt qu'emprunté à turf : le serveur doit rester installable par simple
 * copie, sans `npm install` sur la machine cible.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* Point dans polygone                                                */
/* ------------------------------------------------------------------ */

/**
 * Lancer de rayon sur un anneau : compte les intersections d'une demi-droite
 * horizontale partant du point. Nombre impair = à l'intérieur.
 */
function dansAnneau([x, y], anneau) {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    const traverse = yi > y !== yj > y;
    if (traverse && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Un polygone = anneau extérieur moins ses trous. */
const dansPolygone = (pt, anneaux) =>
  dansAnneau(pt, anneaux[0]) && !anneaux.slice(1).some((trou) => dansAnneau(pt, trou));

/** Accepte Polygon comme MultiPolygon : la source mélange les deux. */
export function dansGeometrie(pt, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return dansPolygone(pt, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((poly) => dansPolygone(pt, poly));
  }
  return false;
}

/** Boîte englobante : filtre bon marché avant le test complet. */
function bbox(geometry) {
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

/* ------------------------------------------------------------------ */
/* Chargement des circonscriptions                                    */
/* ------------------------------------------------------------------ */

/**
 * Index des contours, chargé une fois au démarrage depuis les couches déjà
 * livrées avec l'application (`dist/layers/`). Le serveur n'a donc aucune
 * donnée propre à maintenir : contours de l'API et contours affichés sont le
 * même fichier, ils ne peuvent pas divergerpar oubli de mise à jour.
 */
export function chargerCirconscriptions(racineCouches) {
  const lire = (nom) => {
    const chemin = join(racineCouches, nom);
    if (!existsSync(chemin)) return null;
    try {
      return JSON.parse(readFileSync(chemin, 'utf8'));
    } catch {
      return null;
    }
  };

  const index = {
    compagnie: new Map(),
    region: new Map(),
    bt: new Map(),
    /** Contours de brigade par `nom|compagnie|région` — voir plus bas. */
    btParTriple: new Map(),
    manquant: [],
  };

  const cies = lire('circo_cie.geojson');
  if (cies) {
    for (const f of cies.features ?? []) {
      const nom = f.properties?.nom;
      if (!nom || !f.geometry) continue;
      index.compagnie.set(nom, {
        nom,
        reg: f.properties?.reg ?? null,
        geometry: f.geometry,
        bbox: bbox(f.geometry),
      });
    }
  } else index.manquant.push('circo_cie.geojson');

  const regs = lire('circo_reg.geojson');
  if (regs) {
    for (const f of regs.features ?? []) {
      const nom = f.properties?.nom;
      if (!nom || !f.geometry) continue;
      index.region.set(nom, { nom, geometry: f.geometry, bbox: bbox(f.geometry) });
    }
  } else index.manquant.push('circo_reg.geojson');

  /**
   * Brigades Territoriales : le périmètre le plus petit de la voie
   * hiérarchique (voir serveur/comptes.mjs, rang `unite`). `gr_bde` porte le
   * nom de la BT, `gr_cie`/`gr_region` ses rattachements — seules les
   * circonscriptions BT portent ces attributs (voir README).
   */
  /**
   * LE NOM D'UNE BRIGADE NE L'IDENTIFIE PAS.
   *
   * Vingt-cinq noms existent dans DEUX compagnies différentes — « Tamzaourt »
   * est à la fois en Taroudannt/Agadir et en Chichaoua/Marrakech. La Map
   * `index.bt`, indexée par nom seul, n'en garde donc qu'une : chercher un
   * contour par son nom peut rendre le polygone de l'homonyme, à des centaines
   * de kilomètres. Un barrage y a réellement été déplacé, d'Agadir vers
   * Marrakech, avant que le cas ne soit vu.
   *
   * `index.btParTriple` garde les DEUX, sous une clé qui les distingue :
   * nom + compagnie + région. `index.bt` reste inchangée — tout ce qui s'en
   * sert continue de fonctionner — mais qui connaît le rattachement complet
   * d'un poste peut désormais obtenir SON contour, et pas celui d'un
   * homonyme.
   */
  const bts = lire('circo_bt.geojson');
  if (bts) {
    for (const f of bts.features ?? []) {
      const nom = f.properties?.gr_bde;
      if (!nom || !f.geometry) continue;
      const contour = {
        nom,
        cie: f.properties?.gr_cie ?? null,
        reg: f.properties?.gr_region ?? null,
        geometry: f.geometry,
        bbox: bbox(f.geometry),
      };
      if (!index.bt.has(nom)) index.bt.set(nom, contour);
      index.btParTriple.set(`${nom}|${contour.cie}|${contour.reg}`, contour);
    }
  } else index.manquant.push('circo_bt.geojson');

  return index;
}

const dansContour = (pt, contour) =>
  pt[0] >= contour.bbox[0] &&
  pt[0] <= contour.bbox[2] &&
  pt[1] >= contour.bbox[1] &&
  pt[1] <= contour.bbox[3] &&
  dansGeometrie(pt, contour.geometry);

/**
 * Périmètre d'écriture d'une session. `admin` n'en a pas : voir `controler`,
 * qui l'autorise partout avant même d'appeler cette fonction.
 * @returns {{contour: object, niveau: 'unite'|'compagnie'|'region'}|null}
 */
export function perimetreDe(index, session) {
  if (session.rang === 'unite') {
    const u = index.bt.get(session.unite);
    return u ? { contour: u, niveau: 'unite' } : null;
  }
  if (session.rang === 'cie') {
    const c = index.compagnie.get(session.unite);
    return c ? { contour: c, niveau: 'compagnie' } : null;
  }
  if (session.rang === 'reg') {
    const r = index.region.get(session.unite);
    return r ? { contour: r, niveau: 'region' } : null;
  }
  return null;
}

/**
 * Localise un point : quelle BT, quelle compagnie, quelle région ?
 *
 * Sert au rattachement des marquages posés par un chef de région ou de
 * compagnie, dont le périmètre couvre plusieurs unités plus fines : le
 * serveur détermine lesquelles d'après la géométrie plutôt que de croire le
 * client.
 */
export function localiser(index, pt) {
  let bt = null;
  for (const u of index.bt.values()) {
    if (dansContour(pt, u)) {
      bt = u.nom;
      break;
    }
  }

  for (const c of index.compagnie.values()) {
    if (dansContour(pt, c)) return { bt, cie: c.nom, reg: c.reg };
  }
  for (const r of index.region.values()) {
    if (dansContour(pt, r)) return { bt, cie: null, reg: r.nom };
  }
  return { bt, cie: null, reg: null };
}

/**
 * Le point est-il dans le périmètre de la session ?
 *
 * `admin` n'a aucune restriction géographique : c'est le seul rang qui
 * dispense de contour, exactement comme il dispense de vérifier `peutModifier`
 * dans `serveur/api.mjs` — les deux traduisent le même privilège.
 * @returns 'autorise' | 'refuse' | 'indisponible'
 */
export function controler(index, session, pt) {
  if (session.rang === 'admin') return 'autorise';
  const perimetre = perimetreDe(index, session);
  if (!perimetre) return 'indisponible';
  return dansContour(pt, perimetre.contour) ? 'autorise' : 'refuse';
}

/** Unités proposées à la connexion (listes de choix du formulaire). */
export function unites(index) {
  return {
    compagnies: [...index.compagnie.values()]
      .map((c) => ({ nom: c.nom, reg: c.reg }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    regions: [...index.region.keys()].sort((a, b) => a.localeCompare(b, 'fr')),
    unites: [...index.bt.values()]
      .map((u) => ({ nom: u.nom, cie: u.cie, reg: u.reg }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
  };
}
