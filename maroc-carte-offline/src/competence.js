/**
 * Compétence territoriale d'un point : brigade, compagnie et commandement
 * régional dont la circonscription le contient, et siège de l'unité
 * compétente (pour le temps d'intervention par la route).
 *
 * Données de `donnees/gendarmerie/` (npm run gendarmerie), lues à la demande.
 */

/** Le point [lon, lat] est-il dans le polygone (GeoJSON Polygon / MultiPolygon, trous compris) ? */
export function contient(geometrie, [x, y]) {
  const polygones = geometrie?.type === 'Polygon' ? [geometrie.coordinates] : geometrie?.type === 'MultiPolygon' ? geometrie.coordinates : [];
  return polygones.some((anneaux) => {
    let dedans = false; // pair-impair sur tous les anneaux : un trou annule l'extérieur
    for (const anneau of anneaux) {
      for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
        const [xi, yi] = anneau[i];
        const [xj, yj] = anneau[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
      }
    }
    return dedans;
  });
}

/** Emprise [ouest, sud, est, nord] d'une géométrie. */
function emprise(geometrie) {
  const e = [Infinity, Infinity, -Infinity, -Infinity];
  const visiter = (c) => {
    if (typeof c[0] === 'number') {
      e[0] = Math.min(e[0], c[0]); e[1] = Math.min(e[1], c[1]);
      e[2] = Math.max(e[2], c[0]); e[3] = Math.max(e[3], c[1]);
    } else c.forEach(visiter);
  };
  visiter(geometrie.coordinates);
  return e;
}

/** Circonscription (propriétés) contenant le point, parmi des entités indexées par emprise. */
export function circonscriptionEn(entites, [x, y]) {
  return entites.find((e) => x >= e.emprise[0] && x <= e.emprise[2] && y >= e.emprise[1] && y <= e.emprise[3] && contient(e.geometrie, [x, y]))?.proprietes ?? null;
}

export const indexerCircos = (collection) => (collection?.features ?? []).map((f) => ({ proprietes: f.properties, geometrie: f.geometry, emprise: emprise(f.geometry) }));

export class Competence {
  constructor(origine) {
    this.url = (fichier) => `${origine}/gendarmerie/${fichier}`;
    this._chargement = null;
  }

  charger() {
    const lire = (fichier) => fetch(this.url(fichier)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    this._chargement ??= Promise.all(['circo-bt.geojson', 'circo-cie.geojson', 'circo-reg.geojson', 'unites.geojson'].map(lire))
      .then(([bt, cie, reg, unites]) => {
        // Un fichier illisible n'est pas gardé pour la session : nouvel essai au prochain clic droit.
        if (!bt || !cie || !reg || !unites) this._chargement = null;
        // Siège de chaque circonscription : le chef-lieu d'unité qui lui est rattaché.
        const sieges = new Map();
        for (const f of unites?.features ?? []) {
          const p = f.properties;
          if (p.circo && ['bt', 'cie', 'reg'].includes(p.niveau) && !sieges.has(p.circo)) {
            sieges.set(p.circo, { nom: p.nom, niveau: p.niveau, position: f.geometry.coordinates });
          }
        }
        return { bt: indexerCircos(bt), cie: indexerCircos(cie), reg: indexerCircos(reg), sieges };
      });
    return this._chargement;
  }

  /**
   * @returns {Promise<{ bt: object|null, cie: object|null, reg: object|null,
   *   siege: { nom: string, niveau: string, position: number[] } | null }>}
   *   siege : celui de la brigade compétente, à défaut celui de la compagnie
   */
  async en(point) {
    const d = await this.charger();
    const bt = circonscriptionEn(d.bt, point);
    const cie = circonscriptionEn(d.cie, point);
    const reg = circonscriptionEn(d.reg, point);
    const siege = (bt && d.sieges.get(bt.id)) ?? (cie && d.sieges.get(cie.id)) ?? null;
    return { bt, cie, reg, siege };
  }
}
