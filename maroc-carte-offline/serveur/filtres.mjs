/**
 * Données servies à un compte régional : seulement sa région. Le serveur filtre lui-même les
 * fichiers qui décrivent l'organisation de la gendarmerie (barages, circonscriptions, unités,
 * étiquettes, index de recherche, rapport) ; le navigateur d'un compte régional ne reçoit
 * jamais les entités des autres régions, quelle que soit l'URL demandée.
 *
 * Appartenance à une région, par identifiants stables du jeu installé :
 *   circonscription reg-N → elle-même ; cie-N → région de la compagnie ; bt-N → région de la
 *   brigade (hiérarchie BT → CIE → REG de construireHierarchie) ; barage → région de sa btId ;
 *   unité → région de sa circonscription (`circo`), sinon position dans le polygone de la région ;
 *   entrée de l'index de recherche → position dans le polygone de la région.
 * Le fond de carte (tuiles), le réseau routier, les lieux et les infrastructures publiques
 * (péages, gares, aéroports, ports) ne sont pas filtrés : ce sont des données géographiques.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { contient } from '../src/competence.js';

/** Chemins d'URL filtrés par région → nature du fichier. */
export const DONNEES_REGIONALES = Object.freeze({
  '/barages/barages.json': 'barages',
  '/gendarmerie/circo-reg.geojson': 'circo',
  '/gendarmerie/circo-cie.geojson': 'circo',
  '/gendarmerie/circo-bt.geojson': 'circo',
  '/gendarmerie/unites.geojson': 'unites',
  '/gendarmerie/etiquettes.geojson': 'etiquettes',
  '/gendarmerie/recherche-gendarmerie.json': 'recherche',
  '/gendarmerie/rapport.json': 'rapport',
});

/** Région (reg-N) d'une circonscription reg-N / cie-N / bt-N ; null si inconnue. */
export function regionDeCirco(id, hierarchie) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('reg-')) return hierarchie.regions.has(id) ? id : null;
  if (id.startsWith('cie-')) return hierarchie.compagnies.get(id)?.regId ?? null;
  if (id.startsWith('bt-')) return hierarchie.brigades.get(id)?.regId ?? null;
  return null;
}

/** Emprise [[ouest, sud], [est, nord]] d'une géométrie (Polygon / MultiPolygon). */
export function emprise(geometrie) {
  let o = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polygones = geometrie?.type === 'Polygon' ? [geometrie.coordinates] : geometrie?.type === 'MultiPolygon' ? geometrie.coordinates : [];
  for (const anneaux of polygones) for (const [x, y] of anneaux[0] ?? []) {
    if (x < o) o = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return Number.isFinite(o) ? [[o, s], [e, n]] : null;
}

/**
 * Contenu filtré (pur). `donnees` : contenu JSON du fichier ; `region` : { id, geometrie } ;
 * `hierarchie` : construireHierarchie ; `fichiers` : contenus filtrés déjà calculés pour le
 * rapport (circo-*, unites).
 */
export function filtrer(nature, donnees, { region, hierarchie, chemin = '', compter = null }) {
  const dedans = (coord) => Array.isArray(coord) && contient(region.geometrie, coord);
  switch (nature) {
    case 'barages':
      return { ...donnees, region: region.id, barages: (donnees.barages ?? []).filter((b) => hierarchie.brigades.get(b?.btId)?.regId === region.id) };
    case 'circo':
    case 'etiquettes':
      return { ...donnees, features: donnees.features.filter((f) => regionDeCirco(f.properties?.id, hierarchie) === region.id) };
    case 'unites':
      return {
        ...donnees,
        features: donnees.features.filter((f) => {
          const r = regionDeCirco(f.properties?.circo, hierarchie);
          return r ? r === region.id : dedans(f.geometry?.coordinates);
        }),
      };
    case 'recherche':
      return { ...donnees, e: (donnees.e ?? []).filter((x) => dedans([x[3] / 1e5, x[4] / 1e5])) };
    case 'rapport': {
      // Totaux recalculés sur la seule région ; ni anomalies ni chemins de la source.
      const { anomalies, source, excel, ...reste } = donnees;
      return {
        ...reste,
        region: region.id,
        ...(compter ? { circonscriptions: compter.circonscriptions, chefsLieux: compter.chefsLieux } : {}),
        ...(excel ? { excel: { lignes: null } } : {}),
      };
    }
    default:
      throw new Error(`nature inconnue : ${nature} (${chemin})`);
  }
}

/** Filtre les fichiers de `dossierDonnees` pour une région, avec cache par région et date. */
export class FiltreRegional {
  /** @param {string} dossierDonnees  @param {{ charger(): Promise<{ hierarchie, regions: Map }> }} referentiel */
  constructor(dossierDonnees, referentiel) {
    Object.assign(this, { dossierDonnees, referentiel });
    this.cache = new Map();
    this._canoniques = null;
  }

  /**
   * Fichier filtré correspondant à un fichier résolu (chemin canonique) : clé de
   * DONNEES_REGIONALES, ou null. Comparaison sur le chemin canonique (insensible à la casse
   * sous Windows) : aucune variante d'URL ne désigne le fichier sans le filtre.
   */
  async identifier(fichier) {
    const norme = (f) => (process.platform === 'win32' ? f.toLowerCase() : f);
    const cle = norme(fichier);
    if (!this._canoniques?.has(cle)) {
      // (Re)construit la table : fichiers créés ou remplacés depuis le dernier appel.
      const t = new Map();
      for (const chemin of Object.keys(DONNEES_REGIONALES)) {
        const reel = await realpath(this._fichier(chemin)).catch(() => null);
        if (reel) t.set(norme(reel), chemin);
      }
      this._canoniques = t;
    }
    return this._canoniques.get(cle) ?? null;
  }

  _fichier(chemin) {
    return path.join(this.dossierDonnees, ...chemin.split('/').filter(Boolean));
  }

  async _empreinte(chemin) {
    const s = await stat(this._fichier(chemin));
    return `${s.size.toString(36)}-${Math.floor(s.mtimeMs).toString(36)}`;
  }

  async _contenu(chemin, regId) {
    const nature = DONNEES_REGIONALES[chemin];
    const { hierarchie, regions } = await this.referentiel.charger();
    const region = regions.get(regId);
    if (!region) return null;
    const lire = async (c) => JSON.parse(await readFile(this._fichier(c), 'utf8'));
    let compter = null;
    if (nature === 'rapport') {
      const parNiveau = (fc, cle = 'niveau') => fc.features.reduce((n, f) => ({ ...n, [f.properties[cle]]: (n[f.properties[cle]] ?? 0) + 1 }), {});
      const [reg, cie, bt, unites] = await Promise.all(['reg', 'cie', 'bt'].map((n) => `/gendarmerie/circo-${n}.geojson`).concat('/gendarmerie/unites.geojson')
        .map(async (c) => filtrer(DONNEES_REGIONALES[c], await lire(c), { region, hierarchie })));
      const chefs = parNiveau(unites);
      compter = {
        circonscriptions: { reg: reg.features.length, cie: cie.features.length, bt: bt.features.length },
        chefsLieux: { reg: chefs.reg ?? 0, cie: chefs.cie ?? 0, bt: chefs.bt ?? 0 },
      };
    }
    return Buffer.from(JSON.stringify(filtrer(nature, await lire(chemin), { region, hierarchie, chemin, compter })));
  }

  /**
   * @returns {Promise<{ corps: Buffer, etag: string } | null>}  null : fichier absent ou région inconnue
   */
  async servir(chemin, regId) {
    if (!DONNEES_REGIONALES[chemin]) return null;
    let empreinte;
    try {
      // Le rapport dépend des circonscriptions et des unités : toutes les dates comptent.
      const dependances = DONNEES_REGIONALES[chemin] === 'rapport' ? Object.keys(DONNEES_REGIONALES) : [chemin, '/gendarmerie/circo-reg.geojson', '/gendarmerie/circo-cie.geojson', '/gendarmerie/circo-bt.geojson'];
      empreinte = (await Promise.all(dependances.map((c) => this._empreinte(c)))).join('.');
    } catch {
      return null;
    }
    const cle = `${chemin}|${regId}`;
    const connu = this.cache.get(cle);
    if (connu?.empreinte === empreinte) return connu;
    const corps = await this._contenu(chemin, regId);
    if (!corps) return null;
    const r = { empreinte, corps, etag: `W/"${regId}-${empreinte}"` };
    this.cache.set(cle, r);
    return r;
  }
}
