/**
 * NOTIFICATIONS D'ÉVÉNEMENTS ET SUIVI DU WORKFLOW — sans service.
 *
 *   node --test scripts/verifier-notifications.mjs
 *   npm run check:notifications
 *
 * Ce qui est éprouvé ici, à partir des seules fonctions pures et du dépôt :
 *   — une écriture du journal produit UNE notification, et une seule pour une
 *     opération qui écrit plusieurs lignes (fusion) ;
 *   — « lue » est propre à chaque compte, et persiste au rechargement ;
 *   — le cloisonnement : sa propre action, périmètre, destinataire, poste
 *     déplacé hors du périmètre ;
 *   — le statut du workflow : en attente, en cours, terminé — et jamais
 *     « terminé » tant qu'une demande attend validation.
 *
 * Le parcours de bout en bout, par HTTP, est dans
 * scripts/verifier-notifications-service.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  creerDepotNotifications, notificationDepuisJournal, visiblePour, presenterNotification,
} from '../serveur/notifications.mjs';
import { suivreChaine, suivreAssignations } from '../serveur/suiviAssignations.mjs';
import { GUIDES, guidePour } from '../src/guideRoles.js';

const B = { id: 'B1', type: 'barrage_fixe', nom: 'Barrage Nord', route: 'RN1', lng: -6.8, lat: 34, bt: 'BT Nord', cie: 'Cie A', reg: 'Région 1', factionId: 'F1' };
const ADMIN = { matricule: 'ADM', nom: 'Admin', rang: 'admin', unite: 'admin' };
const REG = { matricule: 'REG1', nom: 'Cdt Région 1', rang: 'reg', unite: 'Région 1' };
const REG2 = { matricule: 'REG2', nom: 'Cdt Région 2', rang: 'reg', unite: 'Région 2' };
const CIE = { matricule: 'CIEA', nom: 'Cdt Cie A', rang: 'cie', unite: 'Cie A' };
const CIEB = { matricule: 'CIEB', nom: 'Cdt Cie B', rang: 'cie', unite: 'Cie B' };
const BT = { matricule: 'BTN', nom: 'Cdt BT Nord', rang: 'unite', unite: 'BT Nord' };
const CHAMP = { admin: null, reg: 'reg', cie: 'cie', unite: 'bt' };
const perimetre = (s) => (CHAMP[s.rang] ? { champ: CHAMP[s.rang], unite: s.unite } : null);
const voit = (s, n, assigne = false) => visiblePour(s, n, { perimetre: perimetre(s), assigne });

const depotTemporaire = () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr-notif-'));
  const fichier = join(dir, 'notifications.json');
  return { dir, fichier, depot: creerDepotNotifications(fichier) };
};
const ts = (ms) => new Date(Date.parse('2026-10-22T08:00:00.000Z') + ms).toISOString();

test('une écriture importante du journal produit une notification', () => {
  const cas = [
    [{ action: 'assignation', avant: B, apres: B, details: { region: 'Région 1' } }, 'assignation'],
    [{ action: 'changement_faction', avant: B, apres: { ...B, factionId: 'F2' }, details: { ancienne: 'F1', nouvelle: 'F2' } }, 'faction'],
    [{ action: 'deplacer', avant: B, apres: { ...B, lng: -6.9 } }, 'deplacement'],
    [{ action: 'modifier', avant: B, apres: { ...B, statutBarrage: 'approuve' } }, 'statut'],
    [{ action: 'modifier', avant: B, apres: { ...B, lat: 34.1 } }, 'deplacement'],
    [{ action: 'decision-demande', avant: B, apres: B, details: { decision: 'acceptee', objet: 'demande de modification' } }, 'validation'],
    [{ action: 'workflow-demande-approuver', avant: B, apres: B, details: {} }, 'validation'],
    [{ action: 'assignation_traitee', avant: B, apres: B, details: { reponse: 'Traité.' } }, 'traitement'],
  ];
  for (const [e, type] of cas) assert.equal(notificationDepuisJournal(e)?.type, type, e.action);
  /* Faction nommée, pas son identifiant. */
  assert.match(notificationDepuisJournal(cas[1][0]).description, /Faction 1 → Faction 2/);
});

test('ce qui ne concerne pas un barrage ne notifie personne', () => {
  assert.equal(notificationDepuisJournal({ action: 'connexion' }), null);
  assert.equal(notificationDepuisJournal({ action: 'creer', apres: { id: 'P', type: 'accident' } }), null);
  assert.equal(notificationDepuisJournal({ action: 'optimisation_decision', avant: B, apres: B }), null);
});

test('une opération qui écrit plusieurs lignes ne donne qu’UNE notification', () => {
  const { dir, depot } = depotTemporaire();
  try {
    depot.publier({ session: REG, action: 'changement_faction', avant: B, apres: { ...B, factionId: 'F2' }, details: { ancienne: 'F1', nouvelle: 'F2' }, ts: ts(0) });
    depot.publier({ session: REG, action: 'assignation_traitee', avant: B, apres: B, details: { reponse: 'Faction : Faction 1 → Faction 2' }, ts: ts(40) });
    assert.equal(depot.tous().length, 1, 'fusionnées');
    assert.equal(depot.tous()[0].type, 'traitement', 'le type le plus significatif l’emporte');
    assert.equal(depot.tous()[0].description.split('Faction 1 → Faction 2').length - 1, 1, 'décrite une seule fois');
    assert.match(depot.tous()[0].description, /assignation est clôturée/);
    /* Deux gestes distincts, espacés : deux notifications. */
    depot.publier({ session: REG, action: 'deplacer', avant: B, apres: { ...B, lng: -6.7 }, ts: ts(60_000) });
    assert.equal(depot.tous().length, 2);
    /* Même instant, autre auteur : pas la même opération. */
    depot.publier({ session: ADMIN, action: 'assignation', avant: B, apres: B, details: { region: 'Région 1' }, ts: ts(60_010) });
    assert.equal(depot.tous().length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ouvrir marque lue pour ce compte seulement, et la lecture persiste', () => {
  const { dir, fichier, depot } = depotTemporaire();
  try {
    const n = depot.publier({ session: ADMIN, action: 'assignation', avant: B, apres: B, details: { region: 'Région 1' } });
    assert.equal(presenterNotification(n, REG.matricule).lue, false);
    depot.marquerLue(n.id, REG.matricule);
    assert.equal(depot.estLue(depot.parId(n.id), REG.matricule), true);
    assert.equal(depot.estLue(depot.parId(n.id), BT.matricule), false, 'un autre compte la voit toujours non lue');
    /* Idempotent : rouvrir ne change pas la date de lecture. */
    const premiere = depot.parId(n.id).lues[REG.matricule];
    depot.marquerLue(n.id, REG.matricule);
    assert.equal(depot.parId(n.id).lues[REG.matricule], premiere);
    /* Relue depuis le disque : rien n'est perdu, et elle reste dans l'historique. */
    const relu = creerDepotNotifications(fichier);
    assert.equal(relu.tous().length, 1);
    assert.equal(relu.estLue(relu.parId(n.id), REG.matricule), true);
    assert.ok(JSON.parse(readFileSync(fichier, 'utf8')).items[0].lues[REG.matricule]);
    /* La forme envoyée ne divulgue pas qui d'autre a lu. */
    assert.equal(presenterNotification(relu.parId(n.id), BT.matricule).lues, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('le cloisonnement suit le périmètre et les permissions', () => {
  const { dir, depot } = depotTemporaire();
  try {
    const assign = depot.publier({ session: ADMIN, action: 'assignation', avant: B, apres: B, details: { region: 'Région 1' } });
    assert.equal(voit(ADMIN, assign), false, 'on ne se notifie pas soi-même');
    assert.equal(voit(REG, assign), true, 'la région du barrage');
    assert.equal(voit(CIE, assign), true, 'la compagnie du barrage');
    assert.equal(voit(BT, assign), true, 'la brigade du barrage');
    assert.equal(voit(REG2, assign), false, 'une autre région');
    assert.equal(voit(CIEB, assign), false, 'une autre compagnie');

    /* Un CMND Cie à qui sa région confie un barrage d'une AUTRE compagnie. */
    const transmis = depot.publier({ session: REG, action: 'assignation', avant: B, apres: B, details: { cie: 'Cie B', matricule: 'CIEB' }, ts: ts(10_000) });
    assert.equal(voit(CIEB, transmis), true, 'le destinataire explicite');
    const faction = depot.publier({ session: CIE, action: 'changement_faction', avant: B, apres: { ...B, factionId: 'F3' }, details: {}, ts: ts(20_000) });
    assert.equal(voit(CIEB, faction), false);
    assert.equal(voit(CIEB, faction, true), true, 'tant que le barrage lui est assigné');
    assert.equal(voit(ADMIN, faction), true, 'le Super Admin voit tout');

    /* Un poste déplacé hors de la brigade concerne encore celle qu'il quitte. */
    const sortie = depot.publier({ session: REG, action: 'deplacer', avant: B, apres: { ...B, bt: 'BT Sud', lng: -7 }, ts: ts(30_000) });
    assert.equal(voit(BT, sortie), true);
    assert.equal(voit({ ...BT, unite: 'BT Sud', matricule: 'BTS' }, sortie), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* -------------------------- workflow d'assignation -------------------------- */

const racine = { id: 'A1', action: 'assignation', barrageId: 'B1', barrage: B, statut: 'ouverte', destinataire: { rang: 'reg', unite: 'Région 1' }, auteur: ADMIN, cree: ts(0), texte: 'Conflit' };
const ligne = (action, ms, extra = {}) => ({ action, ts: ts(ms), id: 'B1', nom: 'Cdt Région 1', rang: 'reg', ...extra });
const assignationJournal = ligne('assignation', 5, { details: { region: 'Région 1' }, nom: 'Admin', rang: 'admin' });

test('workflow : assigné, rien fait — en attente', () => {
  const r = suivreChaine({ racine, instructions: [racine], operations: [assignationJournal], barrage: B });
  assert.equal(r.statut, 'en_attente');
  assert.equal(r.responsable.unite, 'Région 1');
  assert.equal(r.derniereAction.libelle, 'Assigné au CMND Région Région 1');
});

test('workflow : déplacement demandé, pas encore validé — en cours, jamais terminé', () => {
  const ops = [assignationJournal, ligne('demander-modification', 1000)];
  const r = suivreChaine({ racine, instructions: [racine], operations: ops, demandesEnAttente: 1, barrage: B });
  assert.equal(r.statut, 'en_cours');
  assert.match(r.derniereAction.libelle, /en attente de validation/);
  /* Même si la chaîne était close, une demande en attente interdit « terminé ». */
  const close = { ...racine, statut: 'traitee' };
  assert.equal(suivreChaine({ racine: close, instructions: [close], operations: ops, demandesEnAttente: 1, barrage: B }).statut, 'en_cours');
});

test('workflow : transmis au CMND Cie — en cours, responsable = la compagnie', () => {
  const parent = { ...racine, statut: 'traitee', decision: 'transmise' };
  const suite = { ...racine, id: 'A2', parentId: 'A1', destinataire: { rang: 'cie', unite: 'Cie A' }, cree: ts(2000) };
  const r = suivreChaine({ racine: parent, instructions: [parent, suite], operations: [assignationJournal], barrage: B });
  assert.equal(r.statut, 'en_cours');
  assert.equal(r.responsable.unite, 'Cie A');
  assert.equal(r.maillons.length, 2);
});

test('workflow : faction changée et assignation close — terminé', () => {
  const close = { ...racine, statut: 'traitee', traiteeLe: ts(3000) };
  const ops = [assignationJournal, ligne('changement_faction', 3000), ligne('assignation_traitee', 3010)];
  const r = suivreChaine({ racine: close, instructions: [close], operations: ops, barrage: { ...B, factionId: 'F2' } });
  assert.equal(r.statut, 'termine');
  assert.equal(r.sansModification, false);
  assert.ok(r.historique.some((h) => h.libelle === 'Faction changée' && h.effective));
  assert.equal(r.derniereAction.libelle, 'Faction changée', 'l’opération, pas la clôture qui la suit');
});

test('workflow : clos sans écriture — terminé, et dit « sans modification »', () => {
  const close = { ...racine, statut: 'traitee' };
  const r = suivreChaine({ racine: close, instructions: [close], operations: [assignationJournal, ligne('assignation_traitee', 500)], barrage: B });
  assert.equal(r.statut, 'termine');
  assert.equal(r.sansModification, true);
});

test('workflow : les opérations d’une réassignation ultérieure ne sont pas imputées à la précédente', () => {
  const premiere = { ...racine, statut: 'traitee' };
  const seconde = { ...racine, id: 'A9', cree: ts(100_000) };
  const ops = [assignationJournal, ligne('assignation_traitee', 500), ligne('assignation', 100_005, { details: { region: 'Région 1' } }), ligne('deplacer', 200_000)];
  const items = suivreAssignations({
    instructions: [premiere, seconde],
    operationsPar: () => ops,
    demandesEnAttentePour: () => 0,
    barrageParId: () => B,
  });
  const p = items.find((x) => x.id === 'A1');
  const s = items.find((x) => x.id === 'A9');
  assert.equal(p.historique.some((h) => h.libelle === 'Barrage déplacé'), false);
  assert.equal(s.historique.some((h) => h.libelle === 'Barrage déplacé'), true);
  assert.equal(items[0].id, 'A9', 'la plus récente d’abord');
});

test('instructions par rôle : chaque rôle autorisé dispose de son guide conforme', () => {
  const adminGuide = guidePour(ADMIN);
  assert.ok(adminGuide);
  assert.equal(adminGuide.etapes.length, 5);
  assert.equal(adminGuide.etapes[0].titre, 'Filtrer et analyser les barrages');
  assert.equal(adminGuide.etapes[1].titre, 'Consulter les conflits détectés');
  assert.equal(adminGuide.etapes[2].titre, 'Voir sur la carte');
  assert.equal(adminGuide.etapes[3].titre, 'Assigner au CMD_REGION');
  assert.equal(adminGuide.etapes[4].titre, 'Suivre l’avancement opérationnel');

  const regGuide = guidePour(REG);
  assert.ok(regGuide);
  assert.equal(regGuide.etapes.length, 5);
  assert.equal(regGuide.etapes[0].titre, 'Consulter le conflit assigné');
  assert.equal(regGuide.etapes[1].titre, 'Voir sur la carte');
  assert.equal(regGuide.etapes[2].titre, 'Traiter le conflit');
  assert.equal(regGuide.etapes[3].titre, 'Assigner au CMD_COMPAGNIE');
  assert.equal(regGuide.etapes[4].titre, 'Confirmer et vérifier la résolution');

  const cieGuide = guidePour(CIE);
  assert.ok(cieGuide);
  assert.equal(cieGuide.etapes.length, 4);
  assert.equal(cieGuide.etapes[0].titre, 'Consulter le conflit transmis');
  assert.equal(cieGuide.etapes[1].titre, 'Voir sur la carte');
  assert.equal(cieGuide.etapes[2].titre, 'Effectuer les actions autorisées');
  assert.equal(cieGuide.etapes[3].titre, 'Consulter le statut et l’historique');

  const uniteGuide = guidePour(BT);
  assert.ok(uniteGuide);
  assert.ok(uniteGuide.etapes.length > 0);

  assert.equal(guidePour({ rang: 'inconnu' }), null);
});

