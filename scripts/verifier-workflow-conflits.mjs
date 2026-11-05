/**
 * ÉPREUVE DU WORKFLOW DES CONFLITS — Super Admin → CMD Région → CMD CIE.
 *
 *   npm run check:workflow-conflits
 *
 * La table des transitions (serveur/workflowConflits.mjs) éprouvée en entier :
 * chaque action, chaque rôle, chaque état ; le cloisonnement (équivalent RLS)
 * ; les sections (un conflit, une section) ; la déduction de l'état des
 * anciens conflits et la migration réversible — sur les conflits réels de
 * donnees-demo. L'épreuve de bout en bout (serveur réel, notifications) est
 * `npm run check:workflow-conflits:api`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ETATS, SECTIONS, SECTION_DE, NOMS_ACTIONS, etatDe, sectionDe, estClos, peutVoir, verifierAction, presenterWorkflow,
  compterSections, synchroniserChampsHerites, migrerConflit, annulerMigration, ErreurWorkflow, regionsAssignees,
} from '../serveur/workflowConflits.mjs';

/* Anciens conflits réels (non migrés) : un jeu d'essai FIXE, et non les données
   de démonstration vivantes, qu'un reset des conflits peut vider. */
const reels = JSON.parse(readFileSync(new URL('./fixtures/suivi-conflits-anciens.json', import.meta.url), 'utf8')).items;

const ADMIN = { rang: 'admin', unite: 'admin', matricule: 'ADM' };
const REG = { rang: 'reg', unite: 'Agadir', matricule: 'REG-AGADIR' };
const REG_AUTRE = { rang: 'reg', unite: 'Rabat', matricule: 'REG-RABAT' };
const CIE = { rang: 'cie', unite: 'Taroudant', reg: 'Agadir', matricule: 'CIE-TAROUDANT' };
const CIE_AUTRE = { rang: 'cie', unite: 'Tiznit', reg: 'Agadir', matricule: 'CIE-TIZNIT' };
const CIE_HOMONYME = { rang: 'cie', unite: 'Taroudant', reg: 'Rabat', matricule: 'CIE-TAROUDANT-R' };
const BT = { rang: 'unite', unite: 'Ouled Teima', matricule: 'BT-1' };

/** Un conflit à l'état voulu, assigné à Agadir / Taroudant selon l'état. */
const conflit = (etat, { responsable = null } = {}) => {
  const avecRegion = etat !== ETATS.NEW;
  const avecCie = [ETATS.ASSIGNED_CIE, ETATS.IN_PROGRESS_CIE].includes(etat) || responsable?.rang === 'cie';
  return {
    id: `T-${etat}`,
    etat,
    barrageA: { reg: 'Agadir', cie: 'Taroudant' },
    barrageB: { reg: 'Agadir', cie: 'Taroudant' },
    assignation: {
      regions: avecRegion ? [{ unite: 'Agadir', matricule: 'REG-AGADIR' }] : [],
      cie: avecCie ? { unite: 'Taroudant', reg: 'Agadir', matricule: 'CIE-TAROUDANT' } : null,
      responsable,
    },
    historique: [],
  };
};
const code = (f) => {
  try {
    f();
    return 200;
  } catch (e) {
    assert.ok(e instanceof ErreurWorkflow, `erreur inattendue : ${e.message}`);
    return e.code;
  }
};

test('chaque état a UNE section, et les sections sont exactement les quatre demandées (plus de « Suivi »)', () => {
  assert.deepEqual(Object.values(SECTIONS), ['conflits', 'a_traiter', 'a_valider', 'historique']);
  for (const e of Object.values(ETATS)) assert.ok(SECTION_DE[e], `${e} sans section`);
  assert.equal(SECTION_DE.NEW, 'conflits');
  assert.equal(SECTION_DE.PENDING_VALIDATION, 'a_valider');
  /* Validés avant la suppression du suivi : lus comme archivés, sans réécriture. */
  assert.equal(SECTION_DE.APPROVED, 'historique');
  assert.equal(SECTION_DE.FOLLOW_UP, 'historique');
  assert.equal(SECTION_DE.CLOSED, 'historique');
  for (const e of [ETATS.APPROVED, ETATS.FOLLOW_UP, ETATS.CLOSED]) assert.ok(estClos(conflit(e)), `${e} archivé`);
  for (const e of [ETATS.NEW, ETATS.ASSIGNED_REGION, ETATS.PENDING_VALIDATION, ETATS.REJECTED]) assert.ok(!estClos(conflit(e)), `${e} actif`);
});

test('le parcours complet, option B (CMD CIE) — et rien d’autre n’est permis en chemin', () => {
  const c = conflit(ETATS.NEW);
  const pas = (session, action, attendu, o = {}) => {
    const r = verifierAction(c, session, action, o);
    assert.equal(r.vers, attendu, `${action} → ${attendu}`);
    c.etat = r.vers;
    if (action === 'assigner_region') c.assignation.regions = [{ unite: 'Agadir', matricule: 'REG-AGADIR' }];
    if (action === 'assigner_cie') c.assignation.cie = { unite: 'Taroudant', reg: 'Agadir', matricule: 'CIE-TAROUDANT' };
    if (action === 'soumettre') c.assignation.responsable = { rang: session.rang, unite: session.unite };
    return r;
  };
  pas(ADMIN, 'assigner_region', ETATS.ASSIGNED_REGION);
  assert.equal(code(() => verifierAction(c, CIE, 'commencer')), 403, 'la CIE ne voit pas encore le conflit');
  pas(REG, 'assigner_cie', ETATS.ASSIGNED_CIE);
  assert.equal(code(() => verifierAction(c, REG, 'soumettre')), 409, 'la région ne soumet pas un conflit délégué');
  pas(CIE, 'commencer', ETATS.IN_PROGRESS_CIE);
  assert.equal(code(() => verifierAction(c, ADMIN, 'valider')), 409, 'pas de validation avant soumission');
  pas(CIE, 'soumettre', ETATS.PENDING_VALIDATION);
  assert.equal(code(() => verifierAction(c, CIE, 'soumettre')), 409, 'double soumission refusée');
  assert.equal(code(() => verifierAction(c, REG, 'valider')), 403, 'la région ne valide pas');
  assert.equal(code(() => verifierAction(c, ADMIN, 'rejeter')), 422, 'rejet sans motif refusé');
  pas(ADMIN, 'rejeter', ETATS.REJECTED, { motif: 'Justification insuffisante' });
  assert.equal(code(() => verifierAction(c, REG, 'prendre_en_charge')), 409, 'rejet renvoyé à la CIE, pas à la région');
  pas(CIE, 'commencer', ETATS.IN_PROGRESS_CIE);
  pas(CIE, 'soumettre', ETATS.PENDING_VALIDATION);
  /* Approuver archive directement : aucune clôture manuelle à faire. */
  const v = pas(ADMIN, 'valider', ETATS.CLOSED);
  assert.deepEqual(v.etapes, [ETATS.APPROVED], 'la validation passe par APPROVED (inscrit à l’historique)');
  assert.equal(sectionDe(c), 'historique', 'le conflit approuvé est à l’historique');
  assert.equal(code(() => verifierAction(c, CIE, 'commencer')), 409);
  assert.equal(code(() => verifierAction(c, ADMIN, 'cloturer')), 409, 'déjà clos : plus de clôture');
  assert.equal(code(() => verifierAction(c, ADMIN, 'rouvrir')), 422, 'réouverture sans motif refusée');
  pas(ADMIN, 'rouvrir', ETATS.ASSIGNED_REGION, { motif: 'Erreur de saisie' });
});

test('option A : le CMD Région traite lui-même ; soumission directe = prise en charge inscrite', () => {
  const c = conflit(ETATS.ASSIGNED_REGION);
  const r = verifierAction(c, REG, 'soumettre');
  assert.equal(r.vers, ETATS.PENDING_VALIDATION);
  assert.deepEqual(r.etapes, [ETATS.IN_PROGRESS_REGION]);
  assert.equal(verifierAction(c, REG, 'prendre_en_charge').vers, ETATS.IN_PROGRESS_REGION);
  /* Rejet d'un traitement régional : renvoyé à la région. */
  const rej = conflit(ETATS.REJECTED, { responsable: { rang: 'reg', unite: 'Agadir' } });
  assert.equal(verifierAction(rej, REG, 'prendre_en_charge').vers, ETATS.IN_PROGRESS_REGION);
  assert.equal(code(() => verifierAction(rej, CIE, 'commencer')), 403, 'sans CIE assignée, la CIE ne le voit pas');
});

test('matrice complète : pour chaque état, seules les actions de la table sont permises', () => {
  const attendu = {
    NEW: { admin: ['assigner_region', 'soumettre'] },
    ASSIGNED_REGION: { admin: ['assigner_region', 'desassigner', 'soumettre'], reg: ['prendre_en_charge', 'assigner_cie', 'soumettre'] },
    IN_PROGRESS_REGION: { admin: ['assigner_region', 'desassigner', 'soumettre'], reg: ['assigner_cie', 'soumettre'] },
    ASSIGNED_CIE: { admin: ['assigner_region', 'desassigner', 'soumettre'], reg: ['assigner_cie'], cie: ['commencer', 'soumettre'] },
    IN_PROGRESS_CIE: { admin: ['assigner_region', 'desassigner', 'soumettre'], reg: ['assigner_cie'], cie: ['soumettre'] },
    PENDING_VALIDATION: { admin: ['valider', 'rejeter'] },
    APPROVED: { admin: ['cloturer', 'rouvrir'] },
    FOLLOW_UP: { admin: ['cloturer', 'rouvrir'] },
    CLOSED: { admin: ['rouvrir'] },
  };
  for (const [etat, parRole] of Object.entries(attendu)) {
    const c = conflit(etat);
    for (const [nom, s] of [['admin', ADMIN], ['reg', REG], ['cie', CIE], ['bt', BT]]) {
      const permises = NOMS_ACTIONS.filter((a) => presenterWorkflow(c, s).actions[a]);
      assert.deepEqual(permises.sort(), (parRole[nom] ?? []).sort(), `${etat} / ${nom}`);
    }
  }
});

test('cloisonnement (équivalent RLS) : jamais de NEW hors Super Admin, jamais d’accès inter-régions ou inter-compagnies', () => {
  const neuf = conflit(ETATS.NEW);
  assert.ok(peutVoir(neuf, ADMIN));
  assert.ok(!peutVoir(neuf, REG), 'un conflit non assigné n’est pas visible de la région de ses postes');
  const delegue = conflit(ETATS.IN_PROGRESS_CIE);
  assert.ok(peutVoir(delegue, REG), 'la région garde la visibilité après délégation');
  assert.ok(peutVoir(delegue, CIE));
  assert.ok(!peutVoir(delegue, REG_AUTRE), 'autre région');
  assert.ok(!peutVoir(delegue, CIE_AUTRE), 'autre compagnie de la même région');
  assert.ok(!peutVoir(delegue, CIE_HOMONYME), 'compagnie homonyme d’une autre région');
  assert.ok(!peutVoir(delegue, BT), 'brigade');
  assert.equal(code(() => verifierAction(delegue, REG_AUTRE, 'assigner_cie')), 403);
  assert.equal(code(() => verifierAction(delegue, CIE_AUTRE, 'soumettre')), 403);
  assert.equal(code(() => verifierAction(delegue, null, 'soumettre')), 401);
  assert.equal(code(() => verifierAction(null, ADMIN, 'valider')), 404);
  assert.equal(code(() => verifierAction(delegue, ADMIN, 'inventee')), 422);
  /* Compteurs : uniquement ce que le rôle voit. */
  const tous = Object.values(ETATS).map((e) => conflit(e));
  assert.equal(Object.values(compterSections(tous, ADMIN)).reduce((a, b) => a + b, 0), tous.length);
  assert.equal(compterSections(tous, REG).conflits, 0, 'la région ne compte aucun NEW');
  assert.equal(compterSections(tous, CIE_AUTRE).a_traiter, 0);
});

test('état attendu : une action sur un état périmé est refusée (409), rien ne s’applique', () => {
  const c = conflit(ETATS.PENDING_VALIDATION);
  assert.equal(code(() => verifierAction(c, ADMIN, 'valider', { etatAttendu: ETATS.IN_PROGRESS_CIE })), 409);
  assert.equal(verifierAction(c, ADMIN, 'valider', { etatAttendu: ETATS.PENDING_VALIDATION }).vers, ETATS.CLOSED);
});

test('anciens conflits (non migrés) : l’état est déduit, un et un seul par conflit réel', () => {
  const vus = new Map();
  for (const c of reels) {
    const e = etatDe(c);
    assert.ok(ETATS[e], `${c.id} : état inconnu`);
    assert.ok(SECTION_DE[e]);
    vus.set(e, (vus.get(e) ?? 0) + 1);
  }
  assert.ok(vus.size >= 3, `plusieurs états représentés : ${[...vus.keys()].join(', ')}`);
  /* Règles clés de la déduction. */
  assert.equal(etatDe({ statut: 'cloture' }), ETATS.CLOSED);
  assert.equal(etatDe({ statut: 'traite', approbation: { statut: 'en_attente_reg' } }), ETATS.PENDING_VALIDATION);
  assert.equal(etatDe({ statut: 'a_corriger' }), ETATS.REJECTED);
  assert.equal(etatDe({ statut: 'en_cours', assigneCie: { unite: 'X' } }), ETATS.IN_PROGRESS_CIE);
  assert.equal(etatDe({ statut: 'a_traiter', assigneA: { rang: 'reg', unite: 'Agadir' } }), ETATS.ASSIGNED_REGION);
  assert.equal(etatDe({ statut: 'nouveau' }), ETATS.NEW);
});

test('migration réversible sur les conflits réels : même état, anciens champs rendus à l’identique', () => {
  for (const c of reels) {
    if (c.etat) continue;
    const m = migrerConflit(c);
    assert.equal(m.conflit.etat, etatDe(c), `${c.id} : la migration ne change pas l’état affiché`);
    assert.equal(sectionDe(m.conflit), sectionDe(c));
    assert.equal(migrerConflit(m.conflit).change, false, 'idempotente');
    const retour = annulerMigration(m.conflit).conflit;
    for (const k of ['statut', 'approbation', 'assigneA', 'assignesA', 'assigneCie']) {
      assert.deepEqual(retour[k], c[k], `${c.id} : ${k} rendu`);
    }
    assert.ok(!('etat' in retour) && !('assignation' in retour));
  }
});

test('champs hérités dérivés de l’état (lus par d’autres modules)', () => {
  const c = conflit(ETATS.PENDING_VALIDATION, { responsable: { rang: 'cie', unite: 'Taroudant' } });
  synchroniserChampsHerites(c);
  assert.equal(c.statut, 'traite');
  assert.equal(c.approbation.statut, 'en_attente_admin');
  assert.equal(c.assigneA.unite, 'Agadir');
  assert.equal(c.assigneCie.unite, 'Taroudant');
  const n = conflit(ETATS.NEW);
  synchroniserChampsHerites(n);
  assert.equal(n.statut, 'nouveau');
  assert.ok(!n.assigneA && !n.approbation);
  assert.deepEqual(regionsAssignees(conflit(ETATS.NEW)), []);
});
