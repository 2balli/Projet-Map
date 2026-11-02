/**
 * Détection des conflits de planification entre barrages — distincte des
 * alertes de distance (`serveur/alertes.mjs`/`distances.mjs`, qui portent sur
 * l'espacement stratégique via le réseau routier). Ici on regarde le TEMPS,
 * pas la route : deux patrouilles ne peuvent pas tenir deux postes à la fois,
 * un même véhicule ne peut pas être à deux endroits, une patrouille trop
 * réduite n'est pas un dispositif valable.
 *
 * Purement géométrique (vol d'oiseau) et temporel : contrairement aux
 * alertes de distance, cette détection ne dépend PAS du graphe routier, donc
 * reste active même si `npm run build:roads` n'a jamais été lancé.
 *
 * Un conflit porte sur une PAIRE (checkpointA/checkpointB, chacun avec
 * l'index de la patrouille en cause) ou sur un SEUL barrage quand
 * `checkpointBId` est `null` (ex. effectif insuffisant).
 */
import { readFileSync, existsSync } from 'node:fs';
import { ecrireJsonAtomique } from './ecritureAtomique.mjs';
import { randomBytes } from 'node:crypto';
import { distanceKm } from './routage.mjs';
import { estTypeBarrage } from './depot.mjs';

const SEUIL_CHEVAUCHEMENT_KM_DEFAUT = 0.3; // 300 m : chevauchement physique, pas un simple rapprochement stratégique
const EFFECTIF_MIN_DEFAUT = 2;

const estValide = (c) =>
  c &&
  typeof c.id === 'string' &&
  typeof c.type === 'string' &&
  typeof c.checkpointAId === 'string';

const nouvelId = () => `cf_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

/** Une patrouille n'a pas d'identifiant propre : son « côté » est (barrage, index). */
const cleCote = (id, idx) => `${id}:${idx ?? '-'}`;

/** Non ordonnée quand les deux côtés existent (comme `alertes.mjs`), sinon le seul côté A. */
const cleDeConflit = (type, aId, idxA, bId, idxB) => {
  if (!bId) return `${type}|${cleCote(aId, idxA)}`;
  const cotes = [cleCote(aId, idxA), cleCote(bId, idxB)].sort();
  return `${type}|${cotes.join('|')}`;
};

export function creerDepotConflits(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des conflits de planification illisible (${fichier}) : ${err.message}`);
    }
  }

  const ecrire = () => ecrireJsonAtomique(fichier, { version: 1, items });

  return {
    tous: () => items,
    parId: (id) => items.find((c) => c.id === id) ?? null,
    concernant: (checkpointId) =>
      items.filter((c) => c.checkpointAId === checkpointId || c.checkpointBId === checkpointId),

    /**
     * Remplace en un seul passage l'ensemble des conflits actuellement
     * valides. Plus simple que le pairage incrémental de `alertes.mjs`
     * (`upsertPourPaire`/`supprimerPourPaire` un par un) puisque
     * `recalculerConflits` calcule ici directement la liste complète à
     * chaque appel plutôt qu'une seule paire. Conserve le statut
     * `acknowledged` déjà acquis pour toute clé encore valide ; toute entrée
     * devenue invalide (conflit résolu) disparaît.
     */
    appliquerConstat(valides) {
      const existants = new Map(
        items.map((c) => [
          cleDeConflit(c.type, c.checkpointAId, c.patrouilleIndexA, c.checkpointBId, c.patrouilleIndexB),
          c,
        ])
      );
      items = valides.map((v) => {
        const cle = cleDeConflit(v.type, v.aId, v.idxA, v.bId, v.idxB);
        const existant = existants.get(cle);
        if (existant) {
          existant.detail = v.detail;
          return existant;
        }
        return {
          id: nouvelId(),
          type: v.type,
          checkpointAId: v.aId,
          patrouilleIndexA: v.idxA,
          checkpointBId: v.bId ?? null,
          patrouilleIndexB: v.bId ? v.idxB : null,
          detail: v.detail,
          status: 'open',
          acknowledgedById: null,
          acknowledgedComment: null,
          createdAt: new Date().toISOString(),
        };
      });
      ecrire();
    },

    /** Retire tout conflit impliquant un barrage supprimé. */
    supprimerConcernant(checkpointId) {
      const avant = items.length;
      items = items.filter((c) => c.checkpointAId !== checkpointId && c.checkpointBId !== checkpointId);
      if (items.length !== avant) ecrire();
    },

    acquitter(id, { parId: acknowledgedById, comment }) {
      const c = items.find((x) => x.id === id);
      if (!c) return null;
      c.status = 'acknowledged';
      c.acknowledgedById = acknowledgedById;
      c.acknowledgedComment = comment ?? null;
      return c;
    },
    vider() {
      items = [];
      ecrire();
      return true;
    },
  };
}

/** Minutes depuis minuit — `horaire()` (serveur/depot.mjs) garantit un `HH:MM` bien formé. */
const versMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Vrai si [aDebut,aFin[ et [bDebut,bFin[ (même jour) se recouvrent — une fin
 * inférieure ou égale au début est traitée comme un service à cheval sur
 * minuit (ex. 22:00 → 06:00), pas comme une plage vide.
 */
function chevauchentHoraires(aDebut, aFin, bDebut, bFin) {
  if (!aDebut || !aFin || !bDebut || !bFin) return false;
  const aD = versMinutes(aDebut);
  let aF = versMinutes(aFin);
  if (aF <= aD) aF += 1440;
  const bD = versMinutes(bDebut);
  let bF = versMinutes(bFin);
  if (bF <= bD) bF += 1440;
  return aD < bF && bD < aF;
}

const chevauchentPatrouilles = (pa, pb) =>
  Boolean(pa.date) && pa.date === pb.date && chevauchentHoraires(pa.debut, pa.fin, pb.debut, pb.fin);

/**
 * Recalcule TOUS les conflits de planification à partir des barrages actuels
 * — recalcul complet à chaque écriture, comme `recalculerAlertes` (mêmes
 * volumes en jeu : dizaines à basses centaines de barrages).
 */
export function recalculerConflits(
  depotConflits,
  marquages,
  { seuilChevauchementKm = SEUIL_CHEVAUCHEMENT_KM_DEFAUT, effectifMin = EFFECTIF_MIN_DEFAUT } = {}
) {
  const barrages = marquages.filter((m) => estTypeBarrage(m.type));
  const valides = [];

  /* --- Effectif insuffisant : par patrouille, indépendant des autres barrages --- */
  for (const b of barrages) {
    (b.patrouilles ?? []).forEach((p, idx) => {
      if (p.effectif > 0 && p.effectif < effectifMin) {
        valides.push({
          type: 'effectif',
          aId: b.id,
          idxA: idx,
          bId: null,
          idxB: null,
          detail: `Patrouille « ${p.nom} » — effectif ${p.effectif} inférieur au minimum requis (${effectifMin}).`,
        });
      }
    });
  }

  /* --- Ressource/véhicule doublés au sein d'un MÊME barrage (erreur de saisie la plus fréquente) --- */
  for (const b of barrages) {
    const pats = b.patrouilles ?? [];
    for (let ia = 0; ia < pats.length; ia++) {
      for (let ib = ia + 1; ib < pats.length; ib++) {
        const pa = pats[ia];
        const pb = pats[ib];
        if (!chevauchentPatrouilles(pa, pb)) continue;
        if (pa.nom && pa.nom === pb.nom && pa.unite === pb.unite) {
          valides.push({
            type: 'ressource',
            aId: b.id,
            idxA: ia,
            bId: b.id,
            idxB: ib,
            detail: `Patrouille « ${pa.nom} » affectée deux fois sur le même barrage le ${pa.date}, à des horaires qui se chevauchent.`,
          });
        }
        if (pa.vehicule && pa.vehicule === pb.vehicule) {
          valides.push({
            type: 'vehicule',
            aId: b.id,
            idxA: ia,
            bId: b.id,
            idxB: ib,
            detail: `Véhicule « ${pa.vehicule} » affecté deux fois sur le même barrage le ${pa.date}, à des horaires qui se chevauchent.`,
          });
        }
      }
    }
  }

  /* --- Comparaisons entre CHAQUE PAIRE de barrages --- */
  for (let i = 0; i < barrages.length; i++) {
    for (let j = i + 1; j < barrages.length; j++) {
      const a = barrages[i];
      const b = barrages[j];
      const aPats = a.patrouilles ?? [];
      const bPats = b.patrouilles ?? [];
      if (!aPats.length || !bPats.length) continue;

      const prochesGeo = distanceKm(a.lng, a.lat, b.lng, b.lat) < seuilChevauchementKm;

      aPats.forEach((pa, ia) => {
        bPats.forEach((pb, ib) => {
          if (!chevauchentPatrouilles(pa, pb)) return;

          if (prochesGeo) {
            valides.push({
              type: 'chevauchement',
              aId: a.id,
              idxA: ia,
              bId: b.id,
              idxB: ib,
              detail: `Barrages à moins de ${Math.round(seuilChevauchementKm * 1000)} m l'un de l'autre, tous deux couverts le ${pa.date} (${pa.debut}-${pa.fin} / ${pb.debut}-${pb.fin}).`,
            });
          }
          if (pa.nom && pa.nom === pb.nom && pa.unite === pb.unite) {
            valides.push({
              type: 'ressource',
              aId: a.id,
              idxA: ia,
              bId: b.id,
              idxB: ib,
              detail: `Patrouille « ${pa.nom} » affectée simultanément à deux barrages le ${pa.date}.`,
            });
          }
          if (pa.vehicule && pa.vehicule === pb.vehicule) {
            valides.push({
              type: 'vehicule',
              aId: a.id,
              idxA: ia,
              bId: b.id,
              idxB: ib,
              detail: `Véhicule « ${pa.vehicule} » affecté simultanément à deux barrages le ${pa.date}.`,
            });
          }
        });
      });
    }
  }

  depotConflits.appliquerConstat(valides);
}
