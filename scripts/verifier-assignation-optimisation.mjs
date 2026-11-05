/**
 * ASSIGNATION DES CONFLITS DE L'OPTIMISATION — règles vérifiées sur le vrai
 * dépôt (serveur/suiviConflits.mjs), avec un fichier temporaire :
 *
 * 1. Le Super Admin n'assigne un conflit qu'au CMD Région de la région du
 *    barrage concerné (des deux barrages pour un conflit inter-régions) ; toute
 *    autre région est refusée côté serveur, sans rien enregistrer.
 * 2. Un conflit assigné est retrouvé par une nouvelle optimisation — autre
 *    numéro de calcul, barrages dans l'autre ordre — avec son état, son
 *    assignation et son historique ; « assigner un conflit nouveau » est alors
 *    refusé (409), sans nouvelle assignation ni doublon.
 * 3. Un numéro de calcul (« C-01 ») ne rattache jamais un conflit à celui d'une
 *    autre paire, et ne devient jamais un identifiant enregistré.
 * 4. Persistance : l'assignation survit à une relecture du fichier.
 * 5. Une fois traité et approuvé (Historique), une nouvelle détection de la
 *    même paire n'est PAS réassignée : « déjà traité », à rouvrir depuis
 *    l'Historique — ni nouveau conflit, ni nouvelle assignation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const fichier = join(mkdtempSync(join(tmpdir(), 'gr-test-assignation-')), 'suivi-conflits.json');
const depot = creerDepotSuiviConflits(fichier);

const ADMIN = { matricule: 'ADM-01', rang: 'admin', unite: 'admin', nom: 'Super Admin' };
const COMPTES = [
  { matricule: 'REG-RABAT', rang: 'reg', unite: 'Rabat', nom: 'CMND Région Rabat' },
  { matricule: 'REG-CASA', rang: 'reg', unite: 'Casablanca-Settat', nom: 'CMND Région Casa' },
  { matricule: 'REG-FES', rang: 'reg', unite: 'Fès-Meknès', nom: 'CMND Région Fès' },
];
const comptes = { tous: () => COMPTES };

const barrage = (id, reg) => ({ id, nom: `Barrage ${id}`, type: 'barrage_fixe', route: 'RN1', reg, factionId: 'F1' });
const BARRAGES = new Map([
  ['R1', barrage('R1', 'Rabat')],
  ['R2', barrage('R2', 'Rabat')],
  ['R3', barrage('R3', 'Rabat')],
  ['C1', barrage('C1', 'Casablanca-Settat')],
]);
const depotBarrages = { parId: (id) => BARRAGES.get(id) ?? null };

const instructions = [];
const depotInstructions = {
  creer: (i) => {
    const x = { id: `INS-${instructions.length + 1}`, statut: 'ouverte', ...i };
    instructions.push(x);
    return x;
  },
  ouvertes: () => instructions.filter((i) => i.statut === 'ouverte'),
};
const depotNotifications = { publier: (n) => n };
const ctx = { depotBarrages, depotInstructions, depotNotifications, comptes };

/** Ce qu'envoie l'écran d'optimisation : un numéro de calcul et la paire. */
const calcule = (numero, a, b) => ({
  conflitId: numero,
  conflitData: { id: numero, numero, barrageAId: a, barrageBId: b, distanceKm: 8, seuilKm: 20 },
});

test('1. seul le CMD Région de la région du barrage peut recevoir le conflit', () => {
  const avant = depot.tous().length;
  assert.throws(
    () => depot.assignerConflit({ ...calcule('C-01', 'R1', 'R2'), session: ADMIN, matricules: ['REG-CASA'], etatAttendu: 'NEW', ...ctx }),
    (e) => e.code === 403 && /qu'au CMD Région Rabat/.test(e.message),
  );
  assert.equal(depot.tous().length, avant, 'un refus n’enregistre aucun conflit');
  assert.equal(instructions.length, 0, 'ni aucune assignation');

  /* Un autre rôle que le Super Admin n'assigne pas, même sa propre région. */
  assert.throws(
    () => depot.assignerConflit({ ...calcule('C-01', 'R1', 'R2'), session: { ...COMPTES[0] }, matricules: ['REG-RABAT'], ...ctx }),
    (e) => e.code === 403,
  );

  const r = depot.assignerConflit({ ...calcule('C-01', 'R1', 'R2'), session: ADMIN, matricules: ['REG-RABAT'], etatAttendu: 'NEW', ...ctx });
  assert.equal(r.conflit.etat, 'ASSIGNED_REGION');
  assert.equal(r.conflit.assignation.regions[0].unite, 'Rabat');
  assert.notEqual(r.conflit.id, 'C-01', 'un numéro de calcul ne devient pas un identifiant');
  assert.equal(r.conflit.paireCle, 'R1|R2');
  assert.equal(instructions.length, 1);
});

test('1 bis. conflit inter-régions : les deux régions concernées, et elles seules', () => {
  assert.throws(
    () => depot.assignerConflit({ ...calcule('C-02', 'R3', 'C1'), session: ADMIN, matricules: ['REG-RABAT', 'REG-FES'], etatAttendu: 'NEW', ...ctx }),
    (e) => e.code === 403 && /Fès-Meknès/.test(e.message),
  );
  const r = depot.assignerConflit({ ...calcule('C-02', 'R3', 'C1'), session: ADMIN, matricules: ['REG-RABAT', 'REG-CASA'], etatAttendu: 'NEW', ...ctx });
  assert.deepEqual(r.conflit.assignation.regions.map((x) => x.unite).sort(), ['Casablanca-Settat', 'Rabat']);
});

test('2. une nouvelle optimisation retrouve le conflit assigné, sans réassigner ni dupliquer', () => {
  const original = depot.tous().find((c) => c.paireCle === 'R1|R2');
  const historique = original.historique.length;
  const nbConflits = depot.tous().length;
  const nbInstructions = instructions.length;

  /* Nouvelle optimisation : le même conflit porte le numéro C-07, barrages inversés. */
  assert.throws(
    () => depot.assignerConflit({ ...calcule('C-07', 'R2', 'R1'), session: ADMIN, matricules: ['REG-RABAT'], etatAttendu: 'NEW', ...ctx }),
    (e) => e.code === 409 && /déjà assigné au CMD Région Rabat/.test(e.message),
  );
  /* Même un double envoi vers la même région ne crée rien. */
  const rejoue = depot.assignerConflit({ ...calcule('C-07', 'R2', 'R1'), session: ADMIN, matricules: ['REG-RABAT'], ...ctx });
  assert.equal(rejoue.inchange, true);
  assert.equal(rejoue.conflit.id, original.id, 'le même conflit, reconnu par sa paire');

  assert.equal(depot.tous().length, nbConflits, 'aucun doublon');
  assert.equal(instructions.length, nbInstructions, 'aucune nouvelle assignation');
  assert.equal(original.historique.length, historique, 'historique intact');
  assert.equal(original.etat, 'ASSIGNED_REGION', 'état conservé');
  assert.equal(depot.parPaire('R2', 'R1').id, original.id, 'l’ordre des barrages est indifférent');
});

test('3. un numéro de calcul ne rattache pas un conflit d’une autre paire', () => {
  const r1r2 = depot.tous().find((c) => c.paireCle === 'R1|R2');
  /* À la nouvelle optimisation, « C-01 » désigne la paire R1|R3 — pas R1|R2. */
  const r = depot.assignerConflit({ ...calcule('C-01', 'R1', 'R3'), session: ADMIN, matricules: ['REG-RABAT'], etatAttendu: 'NEW', ...ctx });
  assert.equal(r.conflit.paireCle, 'R1|R3');
  assert.notEqual(r.conflit.id, r1r2.id, 'deux conflits distincts, jamais fusionnés');
  assert.equal(r1r2.paireCle, 'R1|R2', 'l’ancien conflit est intact');
});

test('4. l’assignation est durable : relecture du fichier', () => {
  const relu = creerDepotSuiviConflits(fichier);
  const c = relu.parPaire('R1', 'R2');
  assert.equal(c.etat, 'ASSIGNED_REGION');
  assert.equal(c.assignation.regions[0].unite, 'Rabat');
  assert.ok(c.assignation.assigneLe);
  assert.ok(c.historique.some((h) => h.action === 'assigner_region'), 'trace de l’assignation');
});

test('5. traité et approuvé : une nouvelle détection n’est pas réassignée (« déjà traité »)', () => {
  const c = depot.parPaire('R1', 'R2');
  depot.traiterConflit({
    conflitId: c.id, session: ADMIN, action: 'derogation',
    details: { justification: 'Validé par le Super Admin.', conflitData: { barrageAId: 'R1', barrageBId: 'R2' } },
    depotBarrages, depotNotifications,
  });
  assert.equal(depot.tous().find((x) => x.id === c.id).etat, 'CLOSED');

  const nb = depot.tous().length;
  const nbInstructions = instructions.length;
  assert.throws(
    () => depot.assignerConflit({ ...calcule('C-09', 'R2', 'R1'), session: ADMIN, matricules: ['REG-RABAT'], etatAttendu: 'NEW', ...ctx }),
    (e) => e.code === 409 && /déjà traité et approuvé/.test(e.message) && /rouvrez-le/.test(e.message),
  );
  assert.equal(depot.tous().length, nb, 'aucun nouveau conflit');
  assert.equal(instructions.length, nbInstructions, 'aucune nouvelle assignation');
  assert.equal(depot.tous().find((x) => x.id === c.id).etat, 'CLOSED', 'l’archive reste intacte');
});

test('6. identifiant de route (« conf_calc_a|b ») sur une paire traitée : « déjà traité », archive intacte', () => {
  /* R1|R3 : assigné au test 3, puis traité ici. */
  const c = depot.parPaire('R1', 'R3');
  depot.traiterConflit({
    conflitId: c.id, session: ADMIN, action: 'derogation',
    details: { justification: 'Validé.', conflitData: { barrageAId: 'R1', barrageBId: 'R3' } },
    depotBarrages, depotNotifications,
  });
  assert.equal(depot.tous().find((x) => x.id === c.id).etat, 'CLOSED');
  const nb = depot.tous().length;
  assert.throws(
    () => depot.assignerConflit({
      conflitId: 'conf_calc_R1|R3',
      conflitData: { id: 'conf_calc_R1|R3', barrageAId: 'R1', barrageBId: 'R3', distanceKm: 6 },
      session: ADMIN, matricules: ['REG-RABAT'], etatAttendu: 'NEW', ...ctx,
    }),
    (e) => e.code === 409 && /déjà traité/.test(e.message) && !/en attente de traitement/.test(e.message),
  );
  assert.equal(depot.tous().length, nb, 'aucun nouveau conflit');
  assert.equal(depot.tous().find((x) => x.id === c.id).etat, 'CLOSED', 'l’archive reste intacte');
});

test('7. ancien conflit sans `etat` : son CMD Région le traite sans fausse erreur « déjà à valider »', async () => {
  const { writeFileSync } = await import('node:fs');
  const f = join(mkdtempSync(join(tmpdir(), 'gr-test-ancien-')), 's.json');
  /* Forme réelle des anciens enregistrements : état déduit de `statut` et `assigneA`. */
  writeFileSync(f, JSON.stringify({
    version: 1,
    supprimes: [],
    items: [{
      id: 'conf_calc_R1|R2', numero: 'C-R18', paireCle: 'R1|R2', barrageAId: 'R1', barrageBId: 'R2',
      barrageA: { id: 'R1', reg: 'Rabat' }, barrageB: { id: 'R2', reg: 'Rabat' },
      distanceKm: 7.3, seuilKm: 20, statut: 'a_traiter', historique: [],
      assigneA: { matricule: 'REG-RABAT', rang: 'reg', unite: 'Rabat', region: 'Rabat' },
      assignesA: [{ matricule: 'REG-RABAT', rang: 'reg', unite: 'Rabat', region: 'Rabat' }],
    }],
  }));
  const ancien = creerDepotSuiviConflits(f);
  const reg = { matricule: 'REG-RABAT', rang: 'reg', unite: 'Rabat' };
  const r = ancien.traiterConflit({
    conflitId: 'conf_calc_R1|R2', session: reg, action: 'maintien_justifie',
    details: { justification: 'Maintien justifié.' }, depotBarrages, depotNotifications,
  });
  assert.equal(r.conflit.etat, 'PENDING_VALIDATION');
  assert.ok(r.conflit.historique.some((h) => h.action === 'soumettre'), 'la soumission est inscrite');
});
