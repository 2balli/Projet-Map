/**
 * Zones sous compétence de la SÛRETÉ NATIONALE.
 *
 * La Gendarmerie Royale tient les zones rurales et périurbaines — plus de 90 %
 * du territoire et plus de 95 % des voies de communication. La DGSN est
 * compétente dans les périmètres urbains, définis commune par commune par voie
 * réglementaire.
 *
 * CE QUI A ÉTÉ ESSAYÉ, ET POURQUOI ÇA NE MARCHAIT PAS
 * ---------------------------------------------------
 * Première version : « toute localité est une ville, donc zone de police »,
 * avec un rayon selon le niveau (région / compagnie / brigade). C'était faux.
 * Beaucoup de communes urbaines relèvent bel et bien de la Gendarmerie —
 * Skhirate, par exemple, compte TROIS brigades territoriales et sa propre
 * compagnie. La règle en écartait les barrages à tort.
 *
 * Seconde piste : déduire la limite des circonscriptions de brigade. Écartée
 * aussi : ces contours couvrent l'intégralité du territoire, centres de
 * Casablanca et de Rabat compris. Ils ne portent donc pas l'information.
 *
 * CE QUI EST FAIT
 * ---------------
 * La répartition n'existe ni dans les couches, ni dans une source publique
 * exploitable : elle est DÉCLARÉE dans `donnees-serveur/villes-police.json`,
 * un fichier que le commandement corrige sans toucher au code.
 *
 * Conséquence : toute localité ABSENTE de la liste relève de la Gendarmerie et
 * peut recevoir des barrages. L'exclusion devient l'exception déclarée, plutôt
 * que la règle par défaut.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceKm } from '../serveur/routage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER_POLICE = join(ROOT, 'donnees-serveur/villes-police.json');

const CASE_DEG = 0.25;

/** Comparaison tolérante aux accents et à la casse : « Témara » = « Temara ». */
const clefNom = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(bt|cie|reg)\s+/, '')
    .trim();

/**
 * Index des périmètres urbains tenus par la DGSN. Retourne un objet doté de
 * `contient(lng, lat)` — non nul seulement à l'intérieur d'une ville DÉCLARÉE.
 */
export function chargerZonesUrbaines(racineCouches) {
  const declaration = existsSync(FICHIER_POLICE)
    ? JSON.parse(readFileSync(FICHIER_POLICE, 'utf8'))
    : { villes: [] };

  const rayonParNom = new Map(
    (declaration.villes ?? []).map((v) => [clefNom(v.nom), Number(v.rayonKm) || 6])
  );

  /* On récupère les coordonnées depuis les chefs-lieux livrés : la liste ne
     porte que des noms, la position vient des couches. */
  const lire = (nom) => {
    const p = join(racineCouches, nom);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, 'utf8')).features ?? [];
    } catch {
      return [];
    }
  };

  const villes = [];
  const vus = new Set();
  for (const fichier of ['pts_reg.geojson', 'pts_cie.geojson', 'pts_bt.geojson']) {
    for (const f of lire(fichier)) {
      if (f.geometry?.type !== 'Point') continue;
      const brut = f.properties?.nom ?? f.properties?.unite ?? '';
      const cle = clefNom(brut);
      const rayon = rayonParNom.get(cle);
      if (rayon === undefined) continue; // absente de la liste -> Gendarmerie
      if (vus.has(cle)) continue; // une ville peut apparaître dans deux couches
      vus.add(cle);
      villes.push({
        nom: brut,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        rayonKm: rayon,
      });
    }
  }

  const nonTrouvees = [...rayonParNom.keys()].filter((c) => !vus.has(c));

  const grille = new Map();
  villes.forEach((v, i) => {
    const c = `${Math.floor(v.lng / CASE_DEG)}|${Math.floor(v.lat / CASE_DEG)}`;
    if (!grille.has(c)) grille.set(c, []);
    grille.get(c).push(i);
  });
  const rayonMax = Math.max(6, ...villes.map((v) => v.rayonKm));
  const portee = Math.ceil(rayonMax / (CASE_DEG * 111)) + 1;

  return {
    villes,
    /** Villes déclarées dont la position n'a pas été retrouvée dans les couches. */
    nonLocalisees: nonTrouvees,
    valide: declaration.valideParLeCommandement === true,

    /** La ville de police qui contient ce point, ou `null`. */
    contient(lng, lat) {
      const cx = Math.floor(lng / CASE_DEG);
      const cy = Math.floor(lat / CASE_DEG);
      let meilleure = null;
      for (let dx = -portee; dx <= portee; dx++) {
        for (let dy = -portee; dy <= portee; dy++) {
          for (const i of grille.get(`${cx + dx}|${cy + dy}`) ?? []) {
            const v = villes[i];
            const d = distanceKm(lng, lat, v.lng, v.lat);
            if (d < v.rayonKm && (!meilleure || d < meilleure.distanceKm)) {
              meilleure = { ville: v, distanceKm: d };
            }
          }
        }
      }
      return meilleure;
    },
  };
}

/* Conservé pour compatibilité d'import ; les rayons viennent désormais de la
   déclaration, ville par ville. */
export const RAYONS_URBAINS = { reg: 12, cie: 6, bt: 3 };
