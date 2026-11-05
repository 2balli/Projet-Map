/**
 * ÉPREUVE DES ACTIONS PROPOSÉES SUR UN CONFLIT, rôle par rôle.
 *
 *   npm run check:actions-conflit
 *
 * `src/actionsConflit.js` choisit ce que la carte d'un conflit montre. Il est
 * éprouvé ici contre les droits RÉELS du serveur (`presenterWorkflow`), pour
 * chaque état et chaque rôle :
 *   - aucune action proposée n'est refusée par le serveur ;
 *   - le Super Admin voit « Assigner » (jamais « Traiter ») sur un conflit non
 *     assigné, et « Assigné à … » / « Réassigner » une fois assigné ;
 *   - un conflit approuvé ne propose plus rien : il est à l'historique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ETATS, presenterWorkflow } from '../serveur/workflowConflits.mjs';
import { actionsConflit, aTraiterPar, compterATraiter, etatListeConflit, libelleAssignation, prochainConflitAAssigner, rapprocherConflitsEnregistres, statutConflit } from '../src/actionsConflit.js';

const ADMIN = { rang: 'admin', unite: 'admin', matricule: 'ADM' };
const REG = { rang: 'reg', unite: 'Agadir', matricule: 'REG-AGADIR' };
const CIE = { rang: 'cie', unite: 'Taroudant', reg: 'Agadir', matricule: 'CIE-TAROUDANT' };
const BT = { rang: 'unite', unite: 'Ouled Teima', matricule: 'BT-1' };

/** Un conflit à l'état voulu, tel que le serveur l'enverrait à `session`. */
const vu = (etat, session, { responsable = null } = {}) => {
  const avecCie = [ETATS.ASSIGNED_CIE, ETATS.IN_PROGRESS_CIE].includes(etat) || responsable?.rang === 'cie';
  const c = {
    id: `T-${etat}`,
    etat,
    barrageA: { reg: 'Agadir', cie: 'Taroudant' },
    barrageB: { reg: 'Agadir', cie: 'Taroudant' },
    assignation: {
      regions: etat !== ETATS.NEW ? [{ unite: 'Agadir', matricule: 'REG-AGADIR' }] : [],
      cie: avecCie ? { unite: 'Taroudant', reg: 'Agadir', matricule: 'CIE-TAROUDANT' } : null,
      responsable,
    },
    historique: [],
  };
  return { ...c, workflow: presenterWorkflow(c, session) };
};

/* Chaque clé proposée et l'action serveur qui doit la permettre. */
const EXIGE = {
  assigner: ['assigner_region'],
  reassigner: ['assigner_region'],
  desassigner: ['desassigner'],
  transmettre: ['assigner_cie'],
  traiter: ['soumettre', 'prendre_en_charge', 'commencer'],
  traiter_direct: ['soumettre'],
  approuver: ['valider'],
  rejeter: ['rejeter'],
};

test('aucune action proposée n’est refusée par le serveur, pour aucun état ni aucun rôle', () => {
  for (const etat of Object.values(ETATS)) {
    for (const s of [ADMIN, REG, CIE, BT]) {
      const conf = vu(etat, s);
      const { principale, secondaires } = actionsConflit(conf, s);
      for (const act of [principale, ...secondaires].filter(Boolean)) {
        assert.ok(EXIGE[act.cle], `clé inconnue ${act.cle}`);
        assert.ok(EXIGE[act.cle].some((x) => conf.workflow.actions[x]), `${etat} / ${s.rang} : « ${act.libelle} » non permis par le serveur`);
      }
    }
  }
});

test('Super Admin : « Assigner » sur un conflit nouveau, jamais « Traiter » en action principale', () => {
  const neuf = actionsConflit(vu(ETATS.NEW, ADMIN), ADMIN);
  assert.equal(neuf.principale?.cle, 'assigner');
  assert.equal(neuf.principale?.libelle, 'Assigner');
  for (const etat of Object.values(ETATS)) {
    assert.notEqual(actionsConflit(vu(etat, ADMIN), ADMIN).principale?.cle, 'traiter', etat);
  }
  /* Calculé, pas encore enregistré (aucun `workflow`) : assignable aussi. */
  assert.equal(actionsConflit({ id: 'conf_calc_x' }, ADMIN).principale?.cle, 'assigner');
});

test('Super Admin : un conflit déjà assigné dit à qui, et ne propose qu’une réassignation', () => {
  const region = actionsConflit(vu(ETATS.ASSIGNED_REGION, ADMIN), ADMIN);
  assert.equal(region.principale, null, 'pas de nouvelle assignation en action principale');
  assert.equal(region.info, 'Assigné à CMD Région Agadir');
  assert.ok(region.secondaires.some((x) => x.cle === 'reassigner'));
  const cie = actionsConflit(vu(ETATS.IN_PROGRESS_CIE, ADMIN), ADMIN);
  assert.equal(cie.info, 'Assigné à CMD CIE Taroudant');
});

test('Super Admin : un traitement soumis se décide ici (Approuver / Rejeter)', () => {
  const r = actionsConflit(vu(ETATS.PENDING_VALIDATION, ADMIN, { responsable: { rang: 'cie', unite: 'Taroudant' } }), ADMIN);
  assert.equal(r.principale?.cle, 'approuver');
  assert.deepEqual(r.secondaires.map((x) => x.cle), ['rejeter']);
});

test('CMD Région et CMD CIE : « Traiter » ce qui leur revient, rien de ce qui ne leur revient pas', () => {
  const reg = actionsConflit(vu(ETATS.ASSIGNED_REGION, REG), REG);
  assert.equal(reg.principale?.cle, 'traiter');
  assert.ok(reg.secondaires.some((x) => x.cle === 'transmettre'));
  assert.ok(!reg.secondaires.some((x) => ['assigner', 'reassigner', 'approuver'].includes(x.cle)));
  const transmis = actionsConflit(vu(ETATS.IN_PROGRESS_CIE, REG), REG);
  assert.equal(transmis.principale, null, 'la région ne traite pas un conflit délégué');
  assert.equal(transmis.info, 'Transmis à CMD CIE Taroudant');
  assert.equal(actionsConflit(vu(ETATS.ASSIGNED_CIE, CIE), CIE).principale?.cle, 'traiter');
  assert.equal(actionsConflit(vu(ETATS.PENDING_VALIDATION, CIE, { responsable: { rang: 'cie', unite: 'Taroudant' } }), CIE).principale, null);
  const rejete = actionsConflit(vu(ETATS.REJECTED, CIE, { responsable: { rang: 'cie', unite: 'Taroudant' } }), CIE);
  assert.equal(rejete.principale?.libelle, 'Corriger');
});

test('approuvé : plus aucune action, il est à l’historique', () => {
  for (const etat of [ETATS.APPROVED, ETATS.FOLLOW_UP, ETATS.CLOSED]) {
    for (const s of [ADMIN, REG, CIE]) {
      const r = actionsConflit(vu(etat, s), s);
      assert.equal(r.principale, null, `${etat} / ${s.rang}`);
      assert.deepEqual(r.secondaires, []);
    }
    assert.equal(statutConflit(vu(etat, ADMIN)).code, 'archive');
  }
});

test('libellé d’assignation et statut : lus des données réelles du conflit', () => {
  assert.equal(libelleAssignation(vu(ETATS.NEW, ADMIN)), null);
  assert.equal(libelleAssignation({ assigneA: { unite: 'Rabat' } }), 'CMD Région Rabat', 'anciens champs encore lus');
  assert.equal(statutConflit(vu(ETATS.NEW, ADMIN)).label, 'À traiter');
  assert.equal(statutConflit(vu(ETATS.PENDING_VALIDATION, ADMIN)).label, 'À valider');
});

test('optimisation : un conflit déjà assigné est reconnu par sa paire, pas par son numéro', () => {
  const enregistre = { ...vu(ETATS.ASSIGNED_REGION, ADMIN), id: 'conf_abc', numero: 'C-01', paireCle: 'B1|B2' };
  const archive = { ...vu(ETATS.CLOSED, ADMIN), id: 'conf_old', paireCle: 'B3|B4' };
  const nouveau = { ...vu(ETATS.NEW, ADMIN), id: 'conf_new', paireCle: 'B5|B6' };
  /* Nouvelle optimisation : numéros redistribués, barrages dans l'autre ordre. */
  const calcules = [
    { id: 'C-01', cle: 'B5|B6', a: { id: 'B5' }, b: { id: 'B6' } },
    { id: 'C-02', cle: 'B1|B2', a: { id: 'B2' }, b: { id: 'B1' } },
    { id: 'C-03', cle: 'B3|B4', a: { id: 'B3' }, b: { id: 'B4' } },
  ];
  const r = rapprocherConflitsEnregistres(calcules, [enregistre, archive, nouveau]);
  assert.equal(r[1].dejaAssigne, 'CMD Région Agadir', 'C-02 est le conflit assigné de la paire B1|B2');
  assert.equal(r[1].conflitEnregistre.id, 'conf_abc');
  assert.equal(r[0].dejaAssigne, undefined, 'C-01 (même numéro que l’enregistré, autre paire) n’est pas confondu');
  assert.equal(r[0].conflitEnregistre, undefined, 'un conflit enregistré mais non assigné reste à assigner');
  assert.equal(r[2].dejaAssigne, undefined, 'un conflit traité (archivé) ne bloque plus sa paire');
  assert.equal(rapprocherConflitsEnregistres(calcules, [archive]), calcules, 'rien à rapprocher : même tableau');
});

test('liste déroulante : À assigner, Assigné à … · En attente de traitement, et les autres états', () => {
  assert.equal(etatListeConflit({ id: 'C-01' }).libelle, 'À assigner');
  assert.equal(etatListeConflit(vu(ETATS.NEW, ADMIN)).libelle, 'À assigner');
  const assigne = etatListeConflit(vu(ETATS.ASSIGNED_REGION, ADMIN));
  assert.equal(assigne.libelle, 'Assigné');
  assert.equal(assigne.assignation, 'Assigné à CMD Région Agadir · En attente de traitement');
  assert.equal(etatListeConflit({ id: 'C-02', dejaAssigne: 'CMD Région Rabat' }).libelle, 'Assigné');
  assert.equal(etatListeConflit(vu(ETATS.IN_PROGRESS_REGION, ADMIN)).libelle, 'En cours');
  assert.equal(etatListeConflit(vu(ETATS.PENDING_VALIDATION, ADMIN)).libelle, 'À valider');
  assert.equal(etatListeConflit(vu(ETATS.REJECTED, ADMIN)).libelle, 'À corriger');
  assert.equal(etatListeConflit(vu(ETATS.CLOSED, ADMIN)).libelle, 'Approuvé');
});

test('après une assignation : le prochain conflit à assigner de la même région', () => {
  const calc = (id, reg, extra = {}) => ({ id, paireCle: id + '|x', a: { reg }, b: { reg }, ...extra });
  const liste = [
    calc('C-01', 'Agadir'),
    calc('C-02', 'Rabat'),
    { ...vu(ETATS.ASSIGNED_REGION, ADMIN), id: 'S-1', paireCle: 'S-1|x' }, // assigné par un autre traitement
    calc('C-03', 'Agadir', { dejaAssigne: 'CMD Région Agadir' }), // reconnu déjà assigné
    calc('C-04', 'Agadir'),
  ];
  const faite = { ids: ['C-01'], paires: ['C-01|x'], regions: ['Agadir'] };
  assert.equal(prochainConflitAAssigner(liste, faite, ADMIN)?.id, 'C-04', 'saute l’autre région et les déjà assignés');
  assert.equal(prochainConflitAAssigner(liste, { ...faite, regions: [] }, ADMIN)?.id, 'C-02', 'sans région : le suivant dans la liste');
  assert.equal(prochainConflitAAssigner([liste[0], liste[3]], faite, ADMIN), null, 'plus rien à assigner');
  /* Repart du début : après C-04, revient sur C-01 s'il est encore à assigner. */
  assert.equal(prochainConflitAAssigner(liste, { ids: ['C-04'], regions: ['Agadir'] }, ADMIN)?.id, 'C-01');
  /* CMD Région : son geste est la transmission à une CIE. */
  const pourReg = [{ ...vu(ETATS.ASSIGNED_REGION, REG), id: 'R-1' }, { ...vu(ETATS.ASSIGNED_REGION, REG), id: 'R-2' }, { ...vu(ETATS.ASSIGNED_CIE, REG), id: 'R-3' }];
  assert.equal(prochainConflitAAssigner(pourReg, { ids: ['R-1'] }, REG)?.id, 'R-2');
  assert.equal(prochainConflitAAssigner(pourReg, { ids: ['R-2'] }, REG)?.id, 'R-1', 'R-3 est déjà transmis');
});

test('chez le CMD Région destinataire : « À traiter » (assigné par…) ; chez le Super Admin : « Assigné »', () => {
  const c = { ...vu(ETATS.ASSIGNED_REGION, REG), assignation: { regions: [{ unite: 'Agadir' }], assignePar: { rang: 'admin', nom: 'Super Admin' } } };
  const e = etatListeConflit(c, REG);
  assert.equal(e.libelle, 'À traiter');
  assert.equal(e.assignation, 'Assigné par Super Admin');
  assert.equal(etatListeConflit({ ...vu(ETATS.ASSIGNED_REGION, ADMIN) }, ADMIN).libelle, 'Assigné', 'pour le Super Admin : son état réel');
  assert.equal(etatListeConflit(vu(ETATS.IN_PROGRESS_REGION, REG), REG).libelle, 'En cours');
  assert.equal(etatListeConflit(vu(ETATS.ASSIGNED_CIE, REG), REG).libelle, 'Transmis', 'transmis à la CIE : à elle de traiter');
  assert.equal(etatListeConflit(vu(ETATS.ASSIGNED_CIE, CIE), CIE).libelle, 'À traiter');
  /* Rapprochement d'une optimisation lancée par le destinataire lui-même. */
  const r = rapprocherConflitsEnregistres([{ id: 'C-01', cle: 'P|Q' }], [{ ...vu(ETATS.ASSIGNED_REGION, REG), paireCle: 'P|Q' }], REG);
  assert.equal(r[0].dejaAssigne, undefined);
  assert.equal(r[0].aTraiterParMoi, true);
});

test('compteur « Conflits à traiter » : exact, sans doublon, sans traités/rejetés/clos', () => {
  const autre = { rang: 'reg', unite: 'Rabat', matricule: 'REG-RABAT' };
  const liste = [
    { ...vu(ETATS.ASSIGNED_REGION, REG), id: 'a' },
    { ...vu(ETATS.ASSIGNED_REGION, REG), id: 'a' }, // doublon
    { ...vu(ETATS.IN_PROGRESS_REGION, REG), id: 'b' },
    { ...vu(ETATS.PENDING_VALIDATION, REG), id: 'c' }, // traité, soumis
    { ...vu(ETATS.REJECTED, REG), id: 'd' },
    { ...vu(ETATS.CLOSED, REG), id: 'e' },
    { ...vu(ETATS.ASSIGNED_CIE, REG), id: 'f' }, // transmis
  ];
  assert.equal(compterATraiter(liste, REG), 2);
  assert.equal(compterATraiter(liste, autre), 0, 'pas chez un autre CMD Région');
  assert.equal(compterATraiter(liste, CIE), 1, 'le CMD CIE compte ce qui lui est transmis');
  assert.equal(aTraiterPar(liste[0], ADMIN), false);
});

test('paire déjà traitée et approuvée : « Déjà traité », aucun bouton Assigner', () => {
  const calcules = [{ id: 'C-01', cle: 'P|Q' }, { id: 'C-02', cle: 'R|S' }];
  const clos = [{ id: 'conf_x', paireCle: 'P|Q' }];
  const r = rapprocherConflitsEnregistres(calcules, [], ADMIN, clos);
  assert.equal(r[0].dejaTraite, true);
  assert.equal(r[1].dejaTraite, undefined);
  const a = actionsConflit(r[0], ADMIN);
  assert.equal(a.principale, null, 'pas d’Assigner');
  assert.match(a.info, /Déjà traité/);
  assert.equal(etatListeConflit(r[0], ADMIN).libelle, 'Déjà traité');
  /* Assigné : pas de bouton non plus. */
  const d = actionsConflit({ id: 'C-03', dejaAssigne: 'CMD Région Dakhla' }, ADMIN);
  assert.equal(d.principale, null);
  assert.match(d.info, /Assigné à CMD Région Dakhla/);
  /* Une paire rouverte (conflit actif) n'est plus « déjà traitée ». */
  const rouvert = { ...vu(ETATS.NEW, ADMIN), paireCle: 'P|Q' };
  assert.equal(rapprocherConflitsEnregistres(calcules, [rouvert], ADMIN, clos)[0].dejaTraite, undefined);
});
