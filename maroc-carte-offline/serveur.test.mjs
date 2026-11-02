import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { creerServeur, etiquette, inchange, lirePlage, resoudre } from './serveur.mjs';

test('les plages HTTP sont lues comme le fait PMTiles', () => {
  assert.deepEqual(lirePlage('bytes=0-99', 1000), { debut: 0, fin: 99 });
  assert.deepEqual(lirePlage('bytes=900-', 1000), { debut: 900, fin: 999 });
  assert.deepEqual(lirePlage('bytes=-100', 1000), { debut: 900, fin: 999 });
  assert.deepEqual(lirePlage('bytes=950-5000', 1000), { debut: 950, fin: 999 });
  assert.equal(lirePlage('bytes=1000-1001', 1000), null);
  assert.equal(lirePlage('bytes=5-2', 1000), null);
  assert.equal(lirePlage('bytes=0-1,5-9', 1000), null);
  assert.equal(lirePlage('octets=0-1', 1000), null);
});

test('serveur : fichiers, plages, et aucun accès hors des dossiers servis', async (t) => {
  const racine = await mkdtemp(path.join(tmpdir(), 'maroc-carte-'));
  t.after(() => rm(racine, { recursive: true, force: true }));
  const app = path.join(racine, 'dist');
  const donnees = path.join(racine, 'donnees');
  await mkdir(path.join(donnees, 'fonts', 'Noto Sans Regular'), { recursive: true });
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, 'index.html'), '<!doctype html>');
  await writeFile(path.join(donnees, 'fonts', 'Noto Sans Regular', '0-255.pbf'), Buffer.from([1, 2, 3, 4, 5]));
  await writeFile(path.join(racine, 'secret.txt'), 'ne pas servir');

  assert.equal(await resoudre('/../secret.txt', [app, donnees]), null);
  assert.equal(await resoudre('/..%5csecret.txt', [app, donnees]), null);
  assert.equal(await resoudre('/%2e%2e/secret.txt', [app, donnees]), null);
  assert.equal(await resoudre('/%E0%A4%A', [app, donnees]), null);

  const serveur = creerServeur([app, donnees]).listen(0, '127.0.0.1');
  t.after(() => serveur.close());
  await new Promise((r) => serveur.once('listening', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const accueil = await fetch(`${base}/`);
  assert.equal(accueil.status, 200);
  assert.match(accueil.headers.get('content-type'), /text\/html/);

  const glyphes = `${base}/fonts/Noto%20Sans%20Regular/0-255.pbf`;
  const partiel = await fetch(glyphes, { headers: { Range: 'bytes=1-3' } });
  assert.equal(partiel.status, 206);
  assert.equal(partiel.headers.get('content-range'), 'bytes 1-3/5');
  assert.deepEqual([...new Uint8Array(await partiel.arrayBuffer())], [2, 3, 4]);

  assert.equal((await fetch(glyphes, { headers: { Range: 'bytes=9-' } })).status, 416);
  assert.equal((await fetch(`${base}/absent.json`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});

test('serveur : fichier inchangé → 304 sans contenu ; fichier régénéré → 200 complet', async (t) => {
  const racine = await mkdtemp(path.join(tmpdir(), 'maroc-carte-'));
  t.after(() => rm(racine, { recursive: true, force: true }));
  const fichier = path.join(racine, 'regions.geojson');
  await writeFile(fichier, '{"type":"FeatureCollection","features":[]}');
  const serveur = creerServeur([racine]).listen(0, '127.0.0.1');
  t.after(() => serveur.close());
  await new Promise((r) => serveur.once('listening', r));
  const url = `http://127.0.0.1:${serveur.address().port}/regions.geojson`;

  const premier = await fetch(url);
  const etag = premier.headers.get('etag');
  assert.equal(premier.status, 200);
  assert.match(etag, /^W\/".+"$/);
  assert.ok(premier.headers.get('last-modified'));
  assert.equal(premier.headers.get('cache-control'), 'no-cache'); // toujours revalidé

  const revalide = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(revalide.status, 304);
  assert.equal((await revalide.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': `"autre", ${etag}` } })).status, 304);
  assert.equal((await fetch(url, { headers: { 'If-None-Match': '"autre"' } })).status, 200);

  // Données régénérées (npm run data / gendarmerie) : nouvelle empreinte, contenu renvoyé.
  await new Promise((r) => setTimeout(r, 20));
  await writeFile(fichier, '{"type":"FeatureCollection","features":[{}]}');
  const apres = await fetch(url, { headers: { 'If-None-Match': etag } });
  assert.equal(apres.status, 200);
  assert.notEqual(apres.headers.get('etag'), etag);

  // Requête partielle (tuiles PMTiles) : toujours servie, même avec la bonne empreinte.
  const partiel = await fetch(url, { headers: { Range: 'bytes=0-3', 'If-None-Match': apres.headers.get('etag') } });
  assert.equal(partiel.status, 206);
  assert.equal(partiel.headers.get('etag'), apres.headers.get('etag'));
});

test('empreinte : dépend de la taille et de la date, comparaison forte ou faible', () => {
  const e = etiquette({ taille: 1000, modifie: 1_700_000_000_123.4 });
  assert.equal(e, `W/"${(1000).toString(36)}-${(1_700_000_000_123).toString(36)}"`);
  assert.notEqual(e, etiquette({ taille: 1001, modifie: 1_700_000_000_123.4 }));
  assert.notEqual(e, etiquette({ taille: 1000, modifie: 1_700_000_000_999 }));
  assert.equal(inchange(e, e), true);
  assert.equal(inchange(e.slice(2), e), true);
  assert.equal(inchange('*', e), true);
  assert.equal(inchange(undefined, e), false);
  assert.equal(inchange('W/"x"', e), false);
});
