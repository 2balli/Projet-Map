import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { creerServeur } from '../serveur.mjs';
import { Sessions, verifierMotDePasse } from './auth.mjs';
import { creerApi } from './api.mjs';
import { regionDeCirco } from './filtres.mjs';
import { Referentiel, outilsReferentiel } from './referentiel.mjs';
import { Stockage } from './stockage.mjs';
import { ETAT_VIDE, changerMotDePasse, comptesInitiaux, creerCompte, modifierCompte, slugRegion } from './workflow.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNEES = path.join(RACINE, 'donnees');
const TEMPORAIRE = '123456';
const NOUVEAU = 'nouveau-mot-de-passe-1';
const H = 3600 * 1000;

test('sessions : expiration après 2 h d’inactivité et au plus tard 12 h après la connexion', () => {
  let t = 0;
  const s = new Sessions({ maintenant: () => t });
  const j = s.creer('CPT-1');
  t = 1.9 * H;
  assert.equal(s.lire(j), 'CPT-1', 'activité avant 2 h : prolongée');
  t = 3.8 * H;
  assert.equal(s.lire(j, { prolonger: false }), 'CPT-1');
  t = 4 * H;
  assert.equal(s.lire(j), null, 'plus de 2 h depuis la dernière activité (la consultation ne compte pas)');
  // Durée maximale : même active, la session s'arrête à 12 h.
  t = 0;
  const k = s.creer('CPT-2');
  for (t = H; t <= 12 * H; t += H) assert.equal(s.lire(k), 'CPT-2');
  t = 12 * H + 1;
  assert.equal(s.lire(k), null);
  assert.equal(s.restant(k), 0);
});

test('comptes initiaux : superadmin + un compte cr-<région> par région du jeu, sans doublon ni région inventée', () => {
  const regions = [{ id: 'reg-11', nom: 'Béni Mellal' }, { id: 'reg-6', nom: 'Tétouan' }, { id: 'reg-22', nom: 'El Jadida' }];
  const l = comptesInitiaux(regions);
  assert.deepEqual(l.map((c) => c.identifiant), ['superadmin', 'cr-beni-mellal', 'cr-tetouan', 'cr-el-jadida']);
  assert.deepEqual(l.map((c) => c.regId), [null, 'reg-11', 'reg-6', 'reg-22']);
  assert.equal(l[0].role, 'superadmin');
  assert.equal(slugRegion('Fès'), 'fes');
  assert.throws(() => comptesInitiaux([{ id: 'reg-1', nom: 'Fès' }, { id: 'reg-2', nom: 'Fes' }]), /ambigu/);
});

test('mot de passe : temporaire à la création, changement par l’utilisateur seulement, réinitialisation imposant un changement', () => {
  const ref = { regionExiste: (id) => id === 'reg-21' };
  let e = ETAT_VIDE();
  const sa = creerCompte(e, null, { identifiant: 'Superadmin', nom: 'Superadmin', role: 'superadmin', motDePasse: TEMPORAIRE, temporaire: true }, ref);
  e = sa.etat;
  assert.equal(sa.compte.identifiant, 'superadmin');
  assert.equal(sa.compte.doitChanger, true);
  assert.notEqual(sa.compte.empreinte, TEMPORAIRE);
  assert.ok(verifierMotDePasse(TEMPORAIRE, sa.compte.empreinte));
  // Hors mot de passe temporaire, 6 caractères ne suffisent pas.
  assert.throws(() => creerCompte(e, sa.compte, { identifiant: 'x.y', nom: 'X Y', role: 'commandement', regId: 'reg-21', motDePasse: TEMPORAIRE }, ref), /10 caractères/);
  const cr = creerCompte(e, sa.compte, { identifiant: 'cr-rabat', nom: 'CR Rabat', role: 'commandement', regId: 'reg-21', motDePasse: TEMPORAIRE, temporaire: true }, ref);
  e = cr.etat;
  // Changement : mot de passe actuel exigé, 10 caractères, différent.
  assert.throws(() => changerMotDePasse(e, cr.compte, { actuel: 'faux', nouveau: NOUVEAU }, verifierMotDePasse), /actuel incorrect/);
  assert.throws(() => changerMotDePasse(e, cr.compte, { actuel: TEMPORAIRE, nouveau: 'court' }, verifierMotDePasse), /10 caractères/);
  const ch = changerMotDePasse(e, cr.compte, { actuel: TEMPORAIRE, nouveau: NOUVEAU, role: 'superadmin', regId: 'reg-1' }, verifierMotDePasse);
  e = ch.etat;
  assert.equal(ch.compte.doitChanger, false);
  assert.equal(ch.compte.role, 'commandement', 'rôle inchangé');
  assert.equal(ch.compte.regId, 'reg-21', 'région inchangée');
  assert.throws(() => changerMotDePasse(e, ch.compte, { actuel: NOUVEAU, nouveau: NOUVEAU }, verifierMotDePasse), /différent/);
  // Un compte régional ne modifie aucun compte, pas même le sien.
  assert.throws(() => modifierCompte(e, ch.compte, ch.compte.id, { nom: 'Autre' }), /superadmin/);
  // Réinitialisation par le superadmin : temporaire, changement imposé.
  const re = modifierCompte(e, sa.compte, cr.compte.id, { motDePasse: 'reinit1' });
  assert.equal(re.compte.doitChanger, true);
  assert.equal(re.deconnecter, true);
  assert.ok(!JSON.stringify(re.audit).includes('reinit1'), 'mot de passe absent du journal');
});

test('serveur réel : connexion, changement imposé, pages et données protégées, filtrage par région, expiration, déconnexion', async (t) => {
  if (!existsSync(path.join(DONNEES, 'barages', 'barages.json')) || !existsSync(path.join(DONNEES, 'gendarmerie', 'recherche-gendarmerie.json'))) return t.skip('données non installées');
  const tmp = await mkdtemp(path.join(tmpdir(), 'mc-acces-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  // Application construite factice (le test ne dépend pas de « npm run build »).
  const dist = path.join(tmp, 'dist');
  await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>carte</title>');
  await writeFile(path.join(dist, 'connexion.html'), '<!doctype html><title>connexion</title>');
  await writeFile(path.join(dist, 'assets', 'app.js'), 'export {}');
  const dossierEtat = path.join(tmp, 'etat');

  const donnees = await new Referentiel(DONNEES).charger();
  const ref = outilsReferentiel(donnees);
  let e = ETAT_VIDE();
  for (const p of comptesInitiaux(ref.regions.values())) {
    e = creerCompte(e, e.comptes.length ? { id: 'console', role: 'superadmin' } : null, { ...p, motDePasse: TEMPORAIRE, temporaire: true }, ref).etat;
  }
  assert.equal(e.comptes.length, ref.regions.size + 1);
  await new Stockage(dossierEtat).ecrire('etat', e);

  let horloge = Date.now();
  const sessions = new Sessions({ maintenant: () => horloge });
  const serveur = creerServeur([dist, DONNEES], { api: creerApi({ dossierEtat, dossierDonnees: DONNEES, sessions }) }).listen(0, '127.0.0.1');
  await new Promise((r) => serveur.once('listening', r));
  t.after(() => serveur.close());
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appel = async (chemin, { methode = 'GET', corps, cookie, page = false, entetes = {} } = {}) => {
    const r = await fetch(base + chemin, {
      method: methode, redirect: 'manual',
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(page ? { Accept: 'text/html' } : {}), ...(methode === 'POST' ? { 'Content-Type': 'application/json', 'X-Requested-With': 'maroc-carte' } : {}), ...entetes },
      body: methode === 'POST' ? JSON.stringify(corps ?? {}) : undefined,
    });
    const type = r.headers.get('content-type') ?? '';
    return { statut: r.status, corps: type.includes('json') ? await r.json() : await r.text(), cookie: r.headers.get('set-cookie'), entetes: r.headers };
  };
  const connecter = async (identifiant, motDePasse = TEMPORAIRE) => {
    const r = await appel('/api/connexion', { methode: 'POST', corps: { identifiant, motDePasse } });
    assert.equal(r.statut, 200, identifiant);
    return { cookie: r.cookie.split(';')[0], corps: r.corps };
  };
  const changer = async (cookie) => {
    const r = await appel('/api/mot-de-passe', { methode: 'POST', cookie, corps: { actuel: TEMPORAIRE, nouveau: NOUVEAU } });
    assert.equal(r.statut, 200);
    assert.equal(r.corps.doitChanger, false);
    return r.cookie.split(';')[0];
  };

  // ── Sans session : seule la page de connexion (et ses ressources) ──
  assert.equal((await appel('/', { page: true })).statut, 302);
  assert.equal((await appel('/', { page: true })).entetes.get('location'), '/connexion.html');
  assert.equal((await appel('/index.html', { page: true })).entetes.get('location'), '/connexion.html');
  assert.equal((await appel('/connexion.html', { page: true })).statut, 200);
  assert.equal((await appel('/assets/app.js')).statut, 200);
  for (const u of ['/barages/barages.json', '/gendarmerie/circo-reg.geojson', '/gendarmerie/recherche-gendarmerie.json', '/data/recherche.json', '/tiles/maroc.pmtiles', '/api/moi', '/api/conflits']) {
    assert.equal((await appel(u)).statut, 401, u);
  }
  assert.equal((await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'superadmin', motDePasse: 'mauvais' } })).statut, 401);
  // Variantes d'écriture : la décision porte sur le fichier servi, pas sur l'URL.
  for (const u of ['/assets/..%2fbarages/barages.json', '/assets/..%2F..%2Fbarages%2Fbarages.json', '/assets/%2e%2e/index.html', '/connexion.html/../barages/barages.json', '/assets/../index.html']) {
    assert.ok([401, 302, 404].includes((await appel(u)).statut), u);
    assert.notEqual((await appel(u)).statut, 200, u);
  }

  // ── Superadmin : identifiant insensible à la casse, changement imposé ──
  const sa = await connecter('Superadmin');
  assert.equal(sa.corps.doitChanger, true);
  assert.equal(sa.corps.compte.role, 'superadmin');
  const bloque = await appel('/api/conflits', { cookie: sa.cookie });
  assert.equal(bloque.statut, 403);
  assert.equal(bloque.corps.changer, true);
  assert.equal((await appel('/', { cookie: sa.cookie, page: true })).entetes.get('location'), '/connexion.html?changer=1');
  assert.equal((await appel('/barages/barages.json', { cookie: sa.cookie })).statut, 403);
  assert.equal((await appel('/api/mot-de-passe', { methode: 'POST', cookie: sa.cookie, corps: { actuel: TEMPORAIRE, nouveau: 'court' } })).statut, 400);
  const cSa = await changer(sa.cookie);
  assert.equal((await appel('/api/moi', { cookie: sa.cookie })).statut, 401, 'l’ancienne session est fermée au changement');
  assert.equal((await appel('/', { cookie: cSa, page: true })).statut, 200);
  assert.equal((await connecter('superadmin', NOUVEAU)).corps.doitChanger, false);
  assert.equal((await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'superadmin', motDePasse: TEMPORAIRE } })).statut, 401, 'le mot de passe temporaire ne vaut plus');

  // Superadmin : données complètes.
  const complet = JSON.parse(await readFile(path.join(DONNEES, 'barages', 'barages.json'), 'utf8'));
  assert.equal((await appel('/barages/barages.json', { cookie: cSa })).corps.barages.length, complet.barages.length);
  assert.equal((await appel('/gendarmerie/circo-reg.geojson', { cookie: cSa })).corps.features.length, ref.regions.size);

  // ── Comptes régionaux : chacun ne reçoit que sa région ──
  const brigades = donnees.hierarchie.brigades;
  const totalRecherche = JSON.parse(await readFile(path.join(DONNEES, 'gendarmerie', 'recherche-gendarmerie.json'), 'utf8')).e.length;
  const vus = {};
  for (const [identifiant, regId] of [['cr-rabat', 'reg-21'], ['cr-casablanca', 'reg-14'], ['cr-agadir', 'reg-16'], ['cr-dakhla', 'reg-27']]) {
    const c = await connecter(identifiant);
    assert.equal(c.corps.compte.regId, regId);
    assert.equal(c.corps.region.id, regId);
    assert.equal(c.corps.region.nom, ref.nomRegion(regId));
    assert.equal(c.corps.region.emprise.length, 2, 'emprise pour cadrer la carte');
    const cookie = await changer(c.cookie);
    vus[identifiant] = cookie;
    const moi = await appel('/api/moi', { cookie });
    assert.equal(moi.corps.region.id, regId);

    const b = await appel('/barages/barages.json', { cookie });
    assert.equal(b.statut, 200);
    assert.match(b.entetes.get('cache-control'), /private/);
    assert.ok(b.corps.barages.length > 0 && b.corps.barages.length < complet.barages.length);
    assert.ok(b.corps.barages.every((x) => brigades.get(x.btId)?.regId === regId), `${identifiant} : barages d’une autre région`);
    assert.equal(b.corps.barages.length, complet.barages.filter((x) => brigades.get(x.btId)?.regId === regId).length, 'tous les barages de la région');
    const reg = (await appel('/gendarmerie/circo-reg.geojson', { cookie })).corps;
    assert.deepEqual(reg.features.map((f) => f.properties.id), [regId]);
    for (const n of ['cie', 'bt']) {
      const fc = (await appel(`/gendarmerie/circo-${n}.geojson`, { cookie })).corps;
      assert.ok(fc.features.length > 0 && fc.features.every((f) => regionDeCirco(f.properties.id, donnees.hierarchie) === regId), `${identifiant} circo-${n}`);
    }
    const et = (await appel('/gendarmerie/etiquettes.geojson', { cookie })).corps;
    assert.ok(et.features.every((f) => regionDeCirco(f.properties.id, donnees.hierarchie) === regId));
    const un = (await appel('/gendarmerie/unites.geojson', { cookie })).corps;
    assert.ok(un.features.length > 0 && un.features.every((f) => !f.properties.circo || regionDeCirco(f.properties.circo, donnees.hierarchie) === regId));
    const re = (await appel('/gendarmerie/recherche-gendarmerie.json', { cookie })).corps;
    assert.ok(re.e.length > 0 && re.e.length < totalRecherche);
    assert.ok(re.e.every((x) => ref.dansRegion(regId, [x[3] / 1e5, x[4] / 1e5])));
    const ra = (await appel('/gendarmerie/rapport.json', { cookie })).corps;
    assert.equal(ra.circonscriptions.reg, 1);
    assert.equal(ra.source, undefined);
    assert.equal(ra.anomalies, undefined);
    // Autres écritures du même fichier (casse sous Windows, « // », « ..%2f ») : toujours filtré.
    for (const u of ['/barages//barages.json', '/gendarmerie/x/..%2fcirco-reg.geojson', ...(process.platform === 'win32' ? ['/BARAGES/Barages.JSON', '/Gendarmerie/CIRCO-REG.geojson'] : [])]) {
      const r = await appel(u, { cookie });
      if (r.statut === 200) {
        const liste = r.corps.barages ?? r.corps.features;
        assert.ok(liste.every((x) => (x.btId ? brigades.get(x.btId)?.regId : regionDeCirco(x.properties.id, donnees.hierarchie)) === regId), `${identifiant} ${u}`);
      } else assert.equal(r.statut, 404, u);
    }
    // Cache du navigateur : 304 pour la même région.
    assert.equal((await appel('/barages/barages.json', { cookie, entetes: { 'If-None-Match': b.entetes.get('etag') } })).statut, 304);

    // Actions interdites : comptes, rôle, région, optimisation, exports, journal.
    assert.equal((await appel('/api/comptes', { cookie })).statut, 403);
    assert.equal((await appel('/api/comptes', { methode: 'POST', cookie, corps: { identifiant: 'pirate', nom: 'Pirate', role: 'superadmin', motDePasse: 'un-mot-de-passe-long' } })).statut, 403);
    assert.equal((await appel(`/api/comptes/${moi.corps.compte.id}`, { methode: 'POST', cookie, corps: { role: 'superadmin', regId: 'reg-0', nom: 'Moi' } })).statut, 403);
    assert.equal((await appel('/api/conflits', { methode: 'POST', cookie, corps: { regId, seuilKm: 5, paires: [] } })).statut, 403);
    assert.equal((await appel('/api/barages-mis-a-jour', { cookie })).statut, 403);
    assert.equal((await appel('/api/journal', { cookie })).statut, 403);
    assert.equal((await appel('/api/commandements', { cookie })).statut, 403);
    const apres = await appel('/api/moi', { cookie });
    assert.equal(apres.corps.compte.role, 'commandement');
    assert.equal(apres.corps.compte.regId, regId);
  }
  // Même URL, contenu différent selon le compte : jamais d'ETag commun.
  const eRabat = (await appel('/barages/barages.json', { cookie: vus['cr-rabat'] })).entetes.get('etag');
  const r304 = await appel('/barages/barages.json', { cookie: vus['cr-casablanca'], entetes: { 'If-None-Match': eRabat } });
  assert.equal(r304.statut, 200, 'la copie de Rabat n’est pas valable pour Casablanca');
  assert.ok(r304.corps.barages.every((x) => brigades.get(x.btId)?.regId === 'reg-14'));

  // ── Expiration : 2 h sans activité ──
  horloge += 2 * H + 1000;
  assert.equal((await appel('/api/moi', { cookie: vus['cr-rabat'] })).statut, 401);
  assert.equal((await appel('/', { cookie: vus['cr-rabat'], page: true })).entetes.get('location'), '/connexion.html?expire=1');
  assert.equal((await appel('/barages/barages.json', { cookie: vus['cr-casablanca'] })).statut, 401);

  // ── Déconnexion ──
  const d = await connecter('cr-agadir', NOUVEAU);
  assert.equal((await appel('/api/session', { cookie: d.cookie })).corps.restantS, 2 * 3600);
  const sortie = await appel('/api/deconnexion', { methode: 'POST', cookie: d.cookie });
  assert.match(sortie.cookie, /Max-Age=0/);
  assert.equal((await appel('/api/moi', { cookie: d.cookie })).statut, 401);
  assert.equal((await appel('/barages/barages.json', { cookie: d.cookie })).statut, 401);

  // ── Désactivation et réinitialisation par le superadmin : effet immédiat ──
  const sa2 = await connecter('superadmin', NOUVEAU);
  const dakhla = await connecter('cr-dakhla', NOUVEAU);
  const idDakhla = dakhla.corps.compte.id;
  assert.equal((await appel(`/api/comptes/${idDakhla}`, { methode: 'POST', cookie: sa2.cookie, corps: { motDePasse: 'reinit2' } })).statut, 200);
  assert.equal((await appel('/api/moi', { cookie: dakhla.cookie })).statut, 401);
  assert.equal((await connecter('cr-dakhla', 'reinit2')).corps.doitChanger, true);
  assert.equal((await appel(`/api/comptes/${idDakhla}`, { methode: 'POST', cookie: sa2.cookie, corps: { actif: false } })).statut, 200);
  assert.equal((await appel('/api/connexion', { methode: 'POST', corps: { identifiant: 'cr-dakhla', motDePasse: 'reinit2' } })).statut, 401);

  // Aucun mot de passe dans l'état ni dans le journal.
  const brutEtat = await readFile(path.join(dossierEtat, 'etat.json'), 'utf8');
  const journal = await readFile(path.join(dossierEtat, 'journal.jsonl'), 'utf8');
  for (const mdp of [TEMPORAIRE, NOUVEAU, 'reinit2']) {
    assert.ok(!brutEtat.includes(`"${mdp}"`), `état : ${mdp}`);
    assert.ok(!journal.includes(mdp), `journal : ${mdp}`);
  }
});
