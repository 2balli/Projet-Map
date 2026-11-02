/**
 * Règles de génération enregistrées — mêmes critères que le filtre avant
 * génération (voir `GenerationFiltre` dans `MarquagePanel.jsx`), mais nommées,
 * numérotées et persistées : n'importe quel chef peut réutiliser plus tard
 * une règle qu'un autre a déjà réglée, sans tout retaper.
 *
 * Même principe que `serveur/alertes.mjs` : un seul fichier JSON, écriture
 * atomique (tmp + rename), le serveur est la seule source de vérité.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { TYPES_BARRAGE } from './depot.mjs';

const MAX_NOM = 80;
const BARRAGES = TYPES_BARRAGE;
const NIVEAUX = ['low', 'medium', 'high'];

const estValide = (r) => r && typeof r.id === 'string' && typeof r.nom === 'string' && r.criteres;

const nouvelId = () => `rg_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

/**
 * Ne garde des critères soumis que les clés reconnues de `/api/marquages/generer`
 * (voir serveur/api.mjs) — une règle ne doit jamais transporter autre chose.
 */
function normaliserCriteres(c = {}) {
  const nombre = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  return {
    type: BARRAGES.includes(c.type) ? c.type : 'barrage_fixe',
    minDistanceKm: nombre(c.minDistanceKm),
    distancePointsKm: nombre(c.distancePointsKm),
    seuilAccidentsMin: nombre(c.seuilAccidentsMin),
    seuilAccidentsMax: nombre(c.seuilAccidentsMax),
    seuilActivite: NIVEAUX.includes(c.seuilActivite) ? c.seuilActivite : undefined,
    seuilInfraction: NIVEAUX.includes(c.seuilInfraction) ? c.seuilInfraction : undefined,
    considererPositionVille: c.considererPositionVille !== false,
  };
}

export function creerDepotRegles(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des règles illisible (${fichier}) : ${err.message}`);
    }
  }

  const ecrire = () => {
    mkdirSync(dirname(resolve(fichier)), { recursive: true });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    renameSync(tmp, fichier);
  };

  return {
    tous: () => items,
    parId: (id) => items.find((r) => r.id === id) ?? null,

    /** Numéro affiché : le suivant après le plus grand déjà attribué. */
    creer({ nom, criteres, auteur }) {
      const numero = items.reduce((max, r) => Math.max(max, r.numero ?? 0), 0) + 1;
      const regle = {
        id: nouvelId(),
        numero,
        nom: String(nom ?? '').trim().slice(0, MAX_NOM) || `Règle ${numero}`,
        criteres: normaliserCriteres(criteres),
        auteur, // {rang, unite} — qui l'a enregistrée
        cree: new Date().toISOString(),
      };
      items.push(regle);
      ecrire();
      return regle;
    },

    supprimer(id) {
      const i = items.findIndex((r) => r.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      ecrire();
      return true;
    },
  };
}
