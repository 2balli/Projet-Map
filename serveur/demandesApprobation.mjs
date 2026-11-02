/**
 * DEMANDES D'APPROBATION — le workflow CMND Cie → CMND Région → Super Admin.
 *
 * Une demande porte :
 *   - les changements proposés (position, faction, protection, effectif…),
 *   - les valeurs AVANT la proposition (figées à la soumission),
 *   - un historique complet de chaque action (qui, quand, quoi, commentaire),
 *   - un statut qui détermine QUI doit agir.
 *
 * RIEN N'EST APPLIQUÉ tant que le statut n'est pas `approuvee`. Le barrage
 * garde ses valeurs officielles jusqu'à l'approbation finale.
 *
 * Le dépôt suit le même principe d'écriture atomique que les autres :
 * `tmp + rename`, un seul fichier, aucune dépendance externe.
 *
 * SÉPARATION DES DEVOIRS — chaque échelon ne peut approuver que ce qu'il
 * n'a pas soumis. L'auteur d'une demande ne peut jamais la contresigner,
 * même s'il en a le rang.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';

const MAX_TEXTE = 1000;
const MAX_COMMENTAIRE = 500;

/**
 * STATUTS DU WORKFLOW — la seule liste qui fait foi.
 *
 *   brouillon          CMND Cie prépare, pas encore soumis
 *   en_attente_region  soumis, CMND Région doit agir
 *   retournee_cie      renvoyé à CMND Cie pour correction
 *   modifiee_region    CMND Région a modifié la proposition
 *   en_attente_admin   transmis au Super Admin
 *   approuvee          approuvé — les changements doivent être appliqués
 *   rejetee            rejeté — le barrage reste tel quel
 */
export const STATUTS_WORKFLOW = [
  'brouillon',
  'en_attente_region',
  'retournee_cie',
  'modifiee_region',
  'en_attente_admin',
  'approuvee',
  'rejetee',
];

/** Statuts terminaux — une demande terminée ne change plus de statut. */
const TERMINAUX = new Set(['approuvee', 'rejetee']);

/** Actions possibles sur une demande — chacune change le statut. */
export const ACTIONS_WORKFLOW = [
  'soumettre',        // Cie → statut passe à en_attente_region
  'modifier',         // Région édite la proposition
  'retourner',        // Région → retour à Cie, avec explication obligatoire
  'approuver',        // Région ou Admin approuve
  'transmettre_admin', // Région → transmet au Super Admin
  'rejeter',          // Admin rejete
  'retourner_region', // Admin → renvoie à Région
  'resoumettre',      // Cie corrige et resoumet
];

const nouvelId = () => `dem_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const estValide = (d) => d && typeof d.id === 'string' && typeof d.barrageId === 'string';

export function creerDepotDemandes(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des demandes illisible (${fichier}) : ${err.message}`);
    }
  }

  /* ---- Copie datée du jour ---- */
  const JOURS_CONSERVES = 30;
  const sauvegarder = () => {
    if (!existsSync(fichier)) return;
    const dossier = join(dirname(resolve(fichier)), 'sauvegardes');
    mkdirSync(dossier, { recursive: true });
    const jour = new Date().toISOString().slice(0, 10);
    const copie = join(dossier, `demandes-approbation-${jour}.json`);
    if (existsSync(copie)) return;
    try {
      copyFileSync(fichier, copie);
      const anciennes = readdirSync(dossier)
        .filter((f) => /^demandes-approbation-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of anciennes.slice(0, Math.max(0, anciennes.length - JOURS_CONSERVES))) {
        rmSync(join(dossier, f), { force: true });
      }
    } catch { /* sauvegarde impossible ne bloque pas l'écriture */ }
  };

  const ecrire = () => {
    sauvegarder();
    mkdirSync(dirname(resolve(fichier)), { recursive: true });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    renameSync(tmp, fichier);
  };

  return {
    tous: () => items,
    parId: (id) => items.find((d) => d.id === id) ?? null,

    /** Demandes en attente pour un barrage donné. */
    ouvertesPour: (barrageId) =>
      items.filter((d) => d.barrageId === barrageId && !TERMINAUX.has(d.statutWorkflow)),

    /** Demandes adressées à un compte donné (par rang et unité). */
    pourDestinataire: (rang, unite) =>
      items.filter((d) =>
        !TERMINAUX.has(d.statutWorkflow) &&
        d.destinataireActuel?.rang === rang &&
        d.destinataireActuel?.unite === unite,
      ),

    /** Demandes soumises par un compte donné. */
    soumisesPar: (matricule) =>
      items.filter((d) => d.auteurOriginal?.matricule === matricule),

    /**
     * CRÉER UNE DEMANDE — CMND Cie prépare une proposition.
     *
     * @param {object} params
     * @param {string} params.barrageId
     * @param {object} params.barrage — copie figée du barrage
     * @param {Array}  params.changements — [{champ, ancienne, nouvelle}]
     * @param {string} params.raison — pourquoi les changements
     * @param {object} params.auteur — {matricule, nom, rang, unite, reg, cie}
     * @param {object} params.destinataire — {rang, unite} du CMND Région
     * @returns {object} la demande créée
     */
    creer({
      barrageId,
      barrage,
      changements,
      raison = '',
      auteur,
      destinataire,
    }) {
      const demande = {
        id: nouvelId(),
        barrageId,
        /* COPIE FIGÉE du barrage au moment de la demande — les valeurs d'avant. */
        barrage: {
          id: barrage.id,
          nom: barrage.nom || '',
          route: barrage.route || '',
          type: barrage.type,
          lng: barrage.lng ?? null,
          lat: barrage.lat ?? null,
          pk: barrage.pk ?? null,
          bt: barrage.bt ?? null,
          cie: barrage.cie ?? null,
          reg: barrage.reg ?? null,
          factionId: barrage.factionId || null,
          protection: barrage.protection || null,
          intouchable: barrage.intouchable === true,
          debut: barrage.debut || null,
          fin: barrage.fin || null,
          effectif: barrage.effectif ?? null,
          statutBarrage: barrage.statutBarrage || null,
          decisionOptimisation: barrage.decisionOptimisation || null,
        },
        /* Les changements proposés — chaque entrée porte l'ancienne et la
           nouvelle valeur, figées à la soumission. */
        changements: Array.isArray(changements) ? changements : [],
        raison: texte(raison, MAX_TEXTE),
        statutWorkflow: 'en_attente_region',
        auteurOriginal: auteur,
        destinataireActuel: destinataire,
        /** L'historique complet — chaque action y est consignée. */
        historique: [
          {
            action: 'soumettre',
            par: auteur,
            date: new Date().toISOString(),
            commentaire: texte(raison, MAX_COMMENTAIRE),
            changements: Array.isArray(changements) ? changements : [],
          },
        ],
        cree: new Date().toISOString(),
        maj: new Date().toISOString(),
      };
      items.push(demande);
      ecrire();
      return demande;
    },

    /**
     * AGIR SUR UNE DEMANDE — chaque action change le statut et consigne.
     *
     * @param {string} id — identifiant de la demande
     * @param {object} params
     * @param {string} params.action — une des ACTIONS_WORKFLOW
     * @param {object} params.par — {matricule, nom, rang, unite, reg, cie}
     * @param {string} params.commentaire — obligatoire pour retourner/rejeter
     * @param {Array}  [params.changements] — si l'action modifie la proposition
     * @param {object} [params.destinataire] — nouveau destinataire si redirigé
     * @returns {object|null} la demande mise à jour, ou null si introuvable
     */
    agir(id, { action, par, commentaire = '', changements = null, destinataire = null }) {
      const i = items.findIndex((d) => d.id === id);
      if (i < 0) return null;
      const d = items[i];

      /* Une demande terminée ne change plus. */
      if (TERMINAUX.has(d.statutWorkflow)) return null;

      /* Déterminer le nouveau statut. */
      let nouveauStatut = d.statutWorkflow;
      let nouveauDestinataire = d.destinataireActuel;

      switch (action) {
        case 'soumettre':
        case 'resoumettre':
          nouveauStatut = 'en_attente_region';
          /* Le destinataire est le CMND Région du barrage. */
          nouveauDestinataire = destinataire ?? { rang: 'reg', unite: d.barrage?.reg };
          break;
        case 'retourner':
          nouveauStatut = 'retournee_cie';
          /* Le destinataire revient à l'auteur original. */
          nouveauDestinataire = {
            rang: d.auteurOriginal?.rang ?? 'cie',
            unite: d.auteurOriginal?.unite,
          };
          break;
        case 'modifier':
          nouveauStatut = 'modifiee_region';
          /* Le destinataire reste la Région — elle revoit sa propre modification. */
          break;
        case 'approuver':
          nouveauStatut = 'approuvee';
          nouveauDestinataire = null;
          break;
        case 'transmettre_admin':
          nouveauStatut = 'en_attente_admin';
          nouveauDestinataire = { rang: 'admin', unite: 'admin' };
          break;
        case 'rejeter':
          nouveauStatut = 'rejetee';
          nouveauDestinataire = null;
          break;
        case 'retourner_region':
          nouveauStatut = 'en_attente_region';
          /* Le destinataire est le CMND Région. */
          nouveauDestinataire = destinataire ?? { rang: 'reg', unite: d.barrage?.reg };
          break;
        default:
          return null;
      }

      const entreeHistorique = {
        action,
        par,
        date: new Date().toISOString(),
        commentaire: texte(commentaire, MAX_COMMENTAIRE),
      };
      if (changements) entreeHistorique.changements = changements;

      items[i] = {
        ...d,
        statutWorkflow: nouveauStatut,
        destinataireActuel: nouveauDestinataire,
        changements: changements ?? d.changements,
        historique: [...d.historique, entreeHistorique],
        maj: new Date().toISOString(),
      };
      ecrire();
      return items[i];
    },

    /**
     * COMPTER les demandes en attente — pour le badge de notification.
     */
    compterEnAttente: (rang, unite) =>
      items.filter(
        (d) =>
          !TERMINAUX.has(d.statutWorkflow) &&
          d.destinataireActuel?.rang === rang &&
          (rang === 'admin' || d.destinataireActuel?.unite === unite),
      ).length,
  };
}
