/** 
 * Dépôt des alertes de distance entre barrages — même principe que
 * `serveur/depot.mjs` : un seul fichier JSON, écriture atomique (tmp + rename),
 * le serveur est la seule source de vérité.
 *
 * Une alerte porte sur une PAIRE de barrages (`checkpointAId`/`checkpointBId`,
 * non ordonnée) : au plus une alerte ouverte ou acquittée par paire.
 */
import { readFileSync, existsSync } from 'node:fs';
import { ecrireJsonAtomique } from './ecritureAtomique.mjs';
import { randomBytes } from 'node:crypto';

const estValide = (a) =>
  a &&
  typeof a.id === 'string' &&
  typeof a.checkpointAId === 'string' &&
  typeof a.checkpointBId === 'string' &&
  Number.isFinite(a.roadDistanceKm) &&
  Number.isFinite(a.thresholdKm);

const nouvelId = () => `al_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

/** Paire non ordonnée : « A,B » et « B,A » désignent la même alerte. */
const cleDePaire = (aId, bId) => [aId, bId].sort().join('|');

export function creerDepotAlertes(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des alertes illisible (${fichier}) : ${err.message}`);
    }
  }

  /**
   * Écriture différée pendant un recalcul complet.
   *
   * LE DÉFAUT CORRIGÉ
   * -----------------
   * Chaque modification d'une paire réécrivait la totalité du fichier. Un
   * recalcul balaie toutes les paires de barrages ; sur un parc de plus de
   * mille postes, la création d'UN barrage déclenchait ainsi des milliers de
   * réécritures d'un fichier de plus de quatre cents kilo-octets, chacune
   * suivie d'un renommage.
   *
   * Les conséquences se voyaient à l'usage : le serveur occupait un cœur
   * entier pendant plusieurs minutes après chaque pose, et la rafale de
   * renommages finissait par se heurter à un verrou passager de Windows — la
   * création échouait alors en `EPERM`, sans que rien n'explique à
   * l'utilisateur pourquoi poser un barrage venait de refuser.
   *
   * Le contenu écrit est identique : seule change la fréquence. Les appels
   * isolés (acquittement, suppression) écrivent toujours immédiatement.
   */
  let differe = 0;
  let enAttente = false;

  const ecrire = () => {
    if (differe > 0) {
      enAttente = true;
      return;
    }
    ecrireJsonAtomique(fichier, { version: 1, items });
  };

  return {
    /**
     * Groupe les écritures d'un traitement en une seule. Réentrant, et sûr en
     * cas d'erreur : ce qui a été calculé avant l'incident est enregistré.
     */
    grouperEcritures(traitement) {
      differe++;
      try {
        return traitement();
      } finally {
        differe--;
        if (differe === 0 && enAttente) {
          enAttente = false;
          ecrireJsonAtomique(fichier, { version: 1, items });
        }
      }
    },

    tous: () => items,
    /** Remplace le contenu en une écriture — restauration de la référence de présentation seulement. */
    restaurerLot(liste) {
      items = liste;
      ecrireJsonAtomique(fichier, { version: 1, items });
      return items;
    },
    parId: (id) => items.find((a) => a.id === id) ?? null,
    parPaire: (aId, bId) => items.find((a) => cleDePaire(a.checkpointAId, a.checkpointBId) === cleDePaire(aId, bId)) ?? null,
    /** Toute alerte impliquant l'un ou l'autre de ces marquages. */
    concernant: (checkpointId) =>
      items.filter((a) => a.checkpointAId === checkpointId || a.checkpointBId === checkpointId),

    /**
     * Pose ou met à jour l'alerte d'une paire en un seul passage (utilisé par
     * `recalculerAlertes`). Conserve le statut `acknowledged` déjà acquis :
     * une paire acquittée qui reste sous le seuil ne redevient pas `open` à
     * chaque recalcul.
     */
    upsertPourPaire(aId, bId, { roadDistanceKm, thresholdKm }) {
      const existante = this.parPaire(aId, bId);
      if (existante) {
        existante.roadDistanceKm = roadDistanceKm;
        existante.thresholdKm = thresholdKm;
      } else {
        items.push({
          id: nouvelId(),
          checkpointAId: aId,
          checkpointBId: bId,
          roadDistanceKm,
          thresholdKm,
          status: 'open',
          acknowledgedById: null,
          acknowledgedComment: null,
          createdAt: new Date().toISOString(),
        });
      }
      ecrire();
    },

    /** Retire l'alerte d'une paire qui ne respecte plus le seuil de rapprochement. */
    supprimerPourPaire(aId, bId) {
      const avant = items.length;
      items = items.filter((a) => cleDePaire(a.checkpointAId, a.checkpointBId) !== cleDePaire(aId, bId));
      if (items.length !== avant) ecrire();
    },

    /** Retire toute alerte impliquant un marquage supprimé. */
    supprimerConcernant(checkpointId) {
      const avant = items.length;
      items = items.filter((a) => a.checkpointAId !== checkpointId && a.checkpointBId !== checkpointId);
      if (items.length !== avant) ecrire();
    },

    acquitter(id, { parId: acknowledgedById, comment }) {
      const a = items.find((x) => x.id === id);
      if (!a) return null;
      a.status = 'acknowledged';
      a.acknowledgedById = acknowledgedById;
      a.acknowledgedComment = comment ?? null;
      ecrire();
      return a;
    },
  };
}
