/**
 * LES CONFLITS ENTRE BARRAGES, FACTION PAR FACTION.
 *
 * LA RÈGLE — celle du projet, pas une nouvelle : deux postes ne se gênent que
 * s'ils sont tenus EN MÊME TEMPS (voir `perimetreOptimisationAuto` dans
 * serveur/api.mjs et serveur/optimisationTrajet.mjs). Deux barrages de
 * factions différentes, si proches soient-ils, se relaient : ce n'est pas un
 * conflit. On compare donc les barrages faction par faction, et une paire est
 * en conflit quand la ROUTE les sépare de moins du seuil de l'optimisation
 * automatique (`SEUIL_DISTANCE_AUTO_KM`, serveur/optimisationDistance.mjs) —
 * même seuil, même mesure (`listerConflitsDistance`) que l'optimisation.
 *
 * LA FACTION D'UN POSTE est lue par `factionsDuBarrage` (fiche, horaire, puis
 * relèves du jour), comme partout. Un Intouchable est en service dans toutes
 * les factions. Un poste dont la faction est ABSENTE ou INCONNUE n'est rattaché
 * à aucune : il est signalé (`sansFaction`), jamais affecté au hasard.
 *
 * UNE PAIRE N'APPARAÎT QU'UNE FOIS, même si les deux postes partagent plusieurs
 * factions (un Intouchable et un poste à horaire long) : ses factions communes
 * sont listées sur la même ligne.
 *
 * RECALCUL PARTIEL : avec `ids`, seules les paires qui touchent ces barrages
 * sont mesurées — contre leurs seuls voisins à vol d'oiseau sous le seuil.
 * Après un traitement sur un poste, inutile de remesurer tout le périmètre.
 */
import { distanceKm } from './routage.mjs';
import { listerConflitsDistance } from './optimisationDistance.mjs';
import { FACTIONS } from './factions.mjs';

export const clePaire = (a, b) => [String(a), String(b)].sort().join('|');

/**
 * @param {object[]} barrages        postes à comparer (déjà filtrés : actifs, visibles)
 * @param {object} graphe            graphe routier chargé
 * @param {object} o
 * @param {number} o.seuilKm
 * @param {(b) => string[]} o.factionsDe  factions d'un poste ([] = inconnue)
 * @param {Iterable<string>|null} [o.ids]  ne mesurer que les paires touchant ces postes
 * @returns {{conflits: Array<{a, b, km, factions: string[]}>, sansFaction: string[]}}
 */
export function conflitsParFaction(barrages, graphe, { seuilKm, factionsDe, ids = null }) {
  const cibles = ids ? new Set([...ids].map(String)) : null;
  const sansFaction = [];
  const groupes = new Map(FACTIONS.map((f) => [f.id, []]));
  for (const b of barrages) {
    const fs = factionsDe(b);
    if (!fs.length) {
      sansFaction.push(b.id);
      continue;
    }
    for (const f of fs) groupes.get(f)?.push(b);
  }

  const paires = new Map();
  for (const [faction, groupe] of groupes) {
    let membres = groupe;
    if (cibles) {
      /* Les postes visés, et leurs seuls voisins à vol d'oiseau sous le seuil :
         la distance routière n'est jamais inférieure au vol d'oiseau. */
      const vises = groupe.filter((b) => cibles.has(String(b.id)));
      if (!vises.length) continue;
      membres = groupe.filter((b) => cibles.has(String(b.id)) ||
        vises.some((v) => distanceKm(v.lng, v.lat, b.lng, b.lat) < seuilKm));
    }
    if (membres.length < 2) continue;
    for (const c of listerConflitsDistance(membres, graphe, { seuilKm })) {
      if (c.a === c.b) continue;
      if (cibles && !cibles.has(String(c.a)) && !cibles.has(String(c.b))) continue;
      const cle = clePaire(c.a, c.b);
      const deja = paires.get(cle);
      if (deja) {
        if (!deja.factions.includes(faction)) deja.factions.push(faction);
        deja.km = Math.min(deja.km, c.km);
      } else {
        const [a, b] = [String(c.a), String(c.b)].sort();
        paires.set(cle, { a, b, km: c.km, factions: [faction] });
      }
    }
  }
  return {
    conflits: [...paires.values()].sort((x, y) => x.km - y.km || clePaire(x.a, x.b).localeCompare(clePaire(y.a, y.b))),
    sansFaction,
  };
}
