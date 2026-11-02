/**
 * Données de référence du serveur, lues dans les fichiers installés (donnees/) : barages du jeu
 * installé, circonscriptions et hiérarchie BT → CIE → REG. Le serveur en déduit lui-même la
 * région d'un barage, sa protection et l'appartenance d'une position à une région : il ne fait
 * jamais confiance au poste client pour ces points. Relu quand un fichier change.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { construireHierarchie, estProtege } from '../src/barages.js';
import { contient } from '../src/competence.js';

export class Referentiel {
  constructor(dossierDonnees) {
    this.fichiers = {
      barages: path.join(dossierDonnees, 'barages', 'barages.json'),
      reg: path.join(dossierDonnees, 'gendarmerie', 'circo-reg.geojson'),
      cie: path.join(dossierDonnees, 'gendarmerie', 'circo-cie.geojson'),
      bt: path.join(dossierDonnees, 'gendarmerie', 'circo-bt.geojson'),
    };
    this._cle = null;
    this._donnees = null;
  }

  async _empreinte() {
    const dates = await Promise.all(Object.values(this.fichiers).map((f) => stat(f).then((s) => `${s.size}-${s.mtimeMs}`).catch(() => 'absent')));
    return dates.join('|');
  }

  /** @returns {Promise<{ barages: Map, hierarchie, regions: Map, brut: object }>} */
  async charger() {
    const cle = await this._empreinte();
    if (cle === this._cle && this._donnees) return this._donnees;
    const lire = async (f) => JSON.parse(await readFile(f, 'utf8'));
    const [jeu, reg, cie, bt] = await Promise.all([lire(this.fichiers.barages), lire(this.fichiers.reg), lire(this.fichiers.cie), lire(this.fichiers.bt)]);
    const hierarchie = construireHierarchie({ reg: reg.features.map((f) => f.properties), cie: cie.features.map((f) => f.properties), bt: bt.features.map((f) => f.properties) });
    const regions = new Map(reg.features.map((f) => [f.properties.id, { id: f.properties.id, nom: f.properties.nom, geometrie: f.geometry }]));
    const barages = new Map((jeu.barages ?? []).filter((b) => b && typeof b.id === 'string').map((b) => [b.id, b]));
    this._donnees = { barages, hierarchie, regions, brut: jeu };
    this._cle = cle;
    return this._donnees;
  }
}

/** Fonctions de référence à partir des données chargées (pures, testables sans fichiers). */
export function outilsReferentiel({ barages, hierarchie, regions, brut }) {
  return {
    brut,
    regions,
    barage: (id) => barages.get(id) ?? null,
    regDe: (b) => hierarchie.brigades.get(b?.btId)?.regId ?? null,
    nomRegion: (id) => regions.get(id)?.nom ?? id,
    regionExiste: (id) => regions.has(id),
    dansRegion: (regId, [lon, lat]) => {
      const g = regions.get(regId)?.geometrie;
      return Boolean(g) && contient(g, [lon, lat]);
    },
    protege: (b) => estProtege(b),
  };
}
