import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { creerServeur } from '../serveur.mjs';
import { distanceMetres } from '../src/mesure.js';
import { creerApi } from './api.mjs';
import { Referentiel, outilsReferentiel } from './referentiel.mjs';
import { Stockage } from './stockage.mjs';
import { ETAT_VIDE, creerCompte } from './workflow.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = path.join(RACINE, 'donnees');
const MDP = 'mot-de-passe-solide';

test('API : connexion, rôles, isolation régionale, propositions, décisions, export, audit (serveur réel)', async (t) => {
  if (!existsSync(path.join(DONNEES, 'barages', 'barages.json')) || !existsSync(path.join(DONNEES, 'gendarmerie', 'circo-reg.geojson'))) return t.skip('données non installées');
  const etat = await mkdtemp(path.join(tmpdir(), 'mc-etat-'));
  t.after(() => rm(etat, { recursive: true, force: true }));
  const ref = outilsReferentiel(await new Referentiel(DONNEES).charger());
  // Paire réelle : SIM-BAR-0004 (déplaçable) et SIM-BAR-0520 (intouchable), même région.
  const [a, b] = ['SIM-BAR-0004', 'SIM-BAR-0520'].map((id) => ref.barage(id));
  if (!a || !b) return t.skip('jeu de barages différent');
  const regId = ref.regDe(a);
  const autreReg = [...ref.regions.keys()].find((r) => r !== regId);
  // Comptes : admin, commandement de la région, commandement d'une autre région.
  let e = ETAT_VIDE();
  const admin = creerCompte(e, null, { identifiant: 'admin', nom: 'Admin', role: 'admin', motDePasse: MDP }, ref); e = admin.etat;
  e = creerCompte(e, admin.compte, { identifiant: 'cmd.ici', nom: 'Commandement ici', role: 'commandement', regId, motDePasse: MDP }, ref).etat;
  e = creerCompte(e, admin.compte, { identifiant: 'cmd.ailleurs', nom: 'Commandement ailleurs', role: 'commandement', regId: autreReg, motDePasse: MDP }, ref).etat;
  await new Stockage(etat).ecrire('etat', e);

  const serveur = creerServeur([path.join(RACINE, 'dist'), DONNEES], { api: creerApi({ dossierEtat: etat, dossierDonnees: DONNEES }) }).listen(0, '127.0.0.1');
  await new Promise((r) => serveur.once('listening', r));
  t.after(() => serveur.close());
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appel = async (chemin, { methode = 'GET', corps, cookie, csrf = true } = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(methode === 'POST' ? { 'Content-Type': 'application/json', ...(csrf ? { 'X-Requested-With': 'maroc-carte' } : {}) } : {}) },
      body: corps ? JSON.stringify(corps) : methode === 'POST' ? '{}' : undefined,
    });
    return { statut: r.status, corps: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), cookie: r.headers.get('set-cookie'), entetes: r.headers };
  };
  const connecter = async (identifiant) => {
    const r = await appel('/api/connexion', { methode: 'POST', corps: { identifiant, motDePasse: MDP } });
    assert.equal(r.statut, 200, identifiant);
    assert.match(r.cookie, /HttpOnly/);
    assert.match(r.cookie, /SameSite=Strict/);
    return r.cookie.split(';')[0];
  };

  // Sans session : rien.
  assert.equal((await appel('/api/moi')).statut, 401);
  assert.equal((await appel('/api/conflits')).statut, 401);
  assert.equal((await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'admin', motDePasse: 'faux-mot-de-passe' } })).statut, 401);
  // Sans session, les fichiers non plus.
  assert.equal((await appel('/etat.json')).statut, 401);

  const cAdmin = await connecter('admin');
  // L'état du serveur n'est jamais servi, même connecté.
  assert.equal((await appel('/etat.json', { cookie: cAdmin })).statut, 404);
  assert.equal((await appel('/../etat/etat.json', { cookie: cAdmin })).statut, 404);
  const cIci = await connecter('cmd.ici');
  const cAilleurs = await connecter('cmd.ailleurs');
  assert.equal((await appel('/api/moi', { cookie: cIci })).corps.compte.regId, regId);
  assert.equal((await appel('/api/moi', { cookie: cIci })).corps.compte.empreinte, undefined);

  // Écriture sans l'en-tête anti-intersite : refusée, même connecté.
  assert.equal((await appel('/api/conflits', { methode: 'POST', cookie: cAdmin, csrf: false, corps: {} })).statut, 403);
  // Le commandement ne lance pas l'optimisation et ne voit pas les comptes.
  const paire = { ids: [a.id, b.id], routeM: Math.round(distanceMetres([a.longitude, a.latitude], [b.longitude, b.latitude]) + 400), route: { chemin: [[a.longitude, a.latitude], [b.longitude, b.latitude]], secondes: 300 } };
  assert.equal((await appel('/api/conflits', { methode: 'POST', cookie: cIci, corps: { regId, seuilKm: 5, paires: [paire] } })).statut, 403);
  assert.equal((await appel('/api/comptes', { cookie: cIci })).statut, 403);

  // Admin : création (revérifiée par le serveur), affectation au commandement de la région.
  const cree = await appel('/api/conflits', { methode: 'POST', cookie: cAdmin, corps: { regId, seuilKm: 5, paires: [paire, paire] } });
  assert.equal(cree.statut, 201);
  assert.equal(cree.corps.crees.length, 1, 'doublon écarté');
  const conflit = cree.corps.crees[0];
  assert.equal(conflit.regId, regId);
  assert.ok(conflit.barages.find((x) => x.id === b.id).protege);
  assert.equal((await appel('/api/conflits/assigner', { methode: 'POST', cookie: cAdmin, corps: { conflitIds: [conflit.id] } })).statut, 200);

  // Isolation : l'autre commandement ne voit rien, même en forçant l'URL.
  assert.equal((await appel('/api/conflits', { cookie: cAilleurs })).corps.conflits.length, 0);
  assert.equal((await appel(`/api/conflits/${conflit.id}`, { cookie: cAilleurs })).statut, 404);
  assert.equal((await appel(`/api/conflits/${conflit.id}/proposition`, { methode: 'POST', cookie: cAilleurs, corps: { type: 'suppression', barageId: a.id, raison: 'tentative' } })).statut, 404);
  assert.equal((await appel('/api/conflits', { cookie: cIci })).corps.conflits.length, 1);

  // Proposition : jamais sur l'intouchable ; suppression motivée du déplaçable.
  assert.equal((await appel(`/api/conflits/${conflit.id}/proposition`, { methode: 'POST', cookie: cIci, corps: { type: 'suppression', barageId: b.id, raison: 'supprimer le fixe' } })).statut, 403);
  assert.equal((await appel(`/api/conflits/${conflit.id}/en-cours`, { methode: 'POST', cookie: cIci })).corps.conflit.statut, 'en-cours');
  const prop = await appel(`/api/conflits/${conflit.id}/proposition`, { methode: 'POST', cookie: cIci, corps: { type: 'suppression', barageId: a.id, raison: 'trop proche du barage intouchable' } });
  assert.equal(prop.corps.conflit.statut, 'proposition-soumise');
  // Décision : le commandement ne décide pas ; l'admin approuve, motivé.
  assert.equal((await appel(`/api/conflits/${conflit.id}/decision`, { methode: 'POST', cookie: cIci, corps: { decision: 'approuver', raison: 'moi-même' } })).statut, 403);
  const dec = await appel(`/api/conflits/${conflit.id}/decision`, { methode: 'POST', cookie: cAdmin, corps: { decision: 'approuver', raison: 'validé par l’état-major' } });
  assert.equal(dec.corps.conflit.statut, 'approuve');
  // Export : fichier à installer, rien d'écrit dans donnees/.
  const fichier = await appel('/api/barages-mis-a-jour', { cookie: cAdmin });
  assert.match(fichier.entetes.get('content-disposition'), /barages\.json/);
  assert.ok(!fichier.corps.barages.some((x) => x.id === a.id) && fichier.corps.barages.some((x) => x.id === b.id));
  assert.equal(fichier.corps.retraitsApprouves[0].barage.id, a.id);
  assert.ok((await new Referentiel(DONNEES).charger()).barages.has(a.id), 'donnees/ non modifié');
  assert.equal((await appel('/api/barages-mis-a-jour', { cookie: cIci })).statut, 403);

  // Journal d'audit : qui, quoi, quand.
  const journal = (await appel('/api/journal', { cookie: cAdmin })).corps.journal;
  const actions = journal.filter((j) => j.conflitId === conflit.id).map((j) => j.action);
  assert.deepEqual(actions, ['cree', 'assigne', 'en-cours', 'proposition-soumise', 'decision-approuver']);
  assert.ok(journal.some((j) => j.action === 'connexion-refusee'));

  // Désactivation : la session ouverte est fermée aussitôt.
  const cpt = (await appel('/api/comptes', { cookie: cAdmin })).corps.comptes.find((c) => c.identifiant === 'cmd.ailleurs');
  await appel(`/api/comptes/${cpt.id}`, { methode: 'POST', cookie: cAdmin, corps: { actif: false } });
  assert.equal((await appel('/api/moi', { cookie: cAilleurs })).statut, 401);

  // Force brute : verrouillage après 5 échecs.
  for (let i = 0; i < 5; i++) await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'cmd.ici', motDePasse: 'mauvais' } });
  assert.equal((await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'cmd.ici', motDePasse: MDP } })).statut, 429);
});
