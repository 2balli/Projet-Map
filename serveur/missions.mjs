/**
 * Missions — VIP (protection d'un passage) ou interception (véhicule/suspect
 * recherché) : un départ, une arrivée, le reste (l'itinéraire probable) est
 * recalculé côté client à l'affichage, sur le même moteur que l'outil
 * Distances (`src/routage.js`) — rien à recalculer ni à stocker ici, le tracé
 * dépend seulement du réseau routier, pas de la mission.
 *
 * Même principe que `serveur/alertes.mjs` : un seul fichier JSON, écriture
 * atomique (tmp + rename), le serveur est la seule source de vérité.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';

const MAX = { description: 600, plaque: 60 };
export const TYPES_MISSION = ['vip', 'interception'];
export const STATUTS_MISSION = ['planifiee', 'en_cours', 'terminee', 'annulee'];

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const enumeration = (v, liste, defaut) => (liste.includes(v) ? v : defaut);
const point = (v) =>
  v && Number.isFinite(Number(v.lng)) && Number.isFinite(Number(v.lat))
    ? { lng: +Number(v.lng).toFixed(5), lat: +Number(v.lat).toFixed(5) }
    : null;

const estValide = (m) => m && typeof m.id === 'string' && m.depart && m.arrivee;

const nouvelId = () => `ms_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

export function creerDepotMissions(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des missions illisible (${fichier}) : ${err.message}`);
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
    parId: (id) => items.find((m) => m.id === id) ?? null,

    creer(corps, { auteur }) {
      const depart = point(corps.depart);
      const arrivee = point(corps.arrivee);
      if (!depart || !arrivee) throw new Error('Départ et arrivée sont requis (longitude/latitude).');

      const mission = {
        id: nouvelId(),
        type: enumeration(corps.type, TYPES_MISSION, 'interception'),
        description: texte(corps.description, MAX.description),
        plaque: texte(corps.plaque, MAX.plaque),
        depart,
        arrivee,
        dateHeure: texte(corps.dateHeure, 30), // ISO local libre : "2026-08-10T14:00"
        statut: enumeration(corps.statut, STATUTS_MISSION, 'planifiee'),
        auteur,
        cree: new Date().toISOString(),
        maj: new Date().toISOString(),
      };
      items.push(mission);
      ecrire();
      return mission;
    },

    modifier(id, corps) {
      const i = items.findIndex((m) => m.id === id);
      if (i < 0) return null;
      const existante = items[i];
      const mise = {
        ...existante,
        description: corps.description !== undefined ? texte(corps.description, MAX.description) : existante.description,
        plaque: corps.plaque !== undefined ? texte(corps.plaque, MAX.plaque) : existante.plaque,
        statut: corps.statut !== undefined ? enumeration(corps.statut, STATUTS_MISSION, existante.statut) : existante.statut,
        maj: new Date().toISOString(),
      };
      items[i] = mise;
      ecrire();
      return mise;
    },

    supprimer(id) {
      const i = items.findIndex((m) => m.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      ecrire();
      return true;
    },
  };
}
