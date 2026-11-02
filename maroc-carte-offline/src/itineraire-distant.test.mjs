import assert from 'node:assert/strict';
import test from 'node:test';
import { ReseauRoutierDistant } from './itineraire-distant.js';

/**
 * Faux worker : reproduit le protocole de itineraire-worker.js (file d'attente une à une,
 * annulation avant le tour, progression), avec des réponses calculées sur place.
 */
class FauxWorker {
  constructor(repondre) {
    this.repondre = repondre;
    this.envoyes = [];
    this.file = [];
    this.annules = new Set();
    this.termine = false;
  }
  postMessage(data) {
    this.envoyes.push(data);
    if (data.type === 'annuler') this.annules.add(data.id);
    if (data.type === 'appel') this.file.push(data);
  }
  /** Traite la file comme le worker : une demande à la fois, les annulées sautées. */
  async vider() {
    while (this.file.length) {
      const { id, methode, args } = this.file.shift();
      if (this.annules.delete(id)) { this.onmessage({ data: { id, annule: true } }); continue; }
      await this.repondre({ id, methode, args }, (data) => this.onmessage({ data }));
    }
  }
  terminate() { this.termine = true; }
}

test('itinéraire distant : mêmes arguments et résultat que ReseauRoutier', async () => {
  const workers = [];
  const r = new ReseauRoutierDistant(() => {
    const w = new FauxWorker(async ({ id, methode, args }, emettre) => emettre({ id, resultat: { methode, args } }));
    workers.push(w);
    return w;
  }, { urlTuiles: 't', urlNational: 'n' });
  const p1 = r.itineraire([1, 2], [3, 4], { priorite: 'court' });
  const p2 = r.lignes([0, 0, 1, 1], { zMax: 14 });
  const p3 = r.lignes([0, 0, 1, 1]);
  await workers[0].vider();
  assert.deepEqual(await p1, { methode: 'itineraire', args: [[1, 2], [3, 4], { priorite: 'court' }] });
  assert.deepEqual(await p2, { methode: 'lignes', args: [[0, 0, 1, 1], { zMax: 14 }] });
  assert.deepEqual(await p3, { methode: 'lignes', args: [[0, 0, 1, 1], {}] }); // zMax par défaut : celui de ReseauRoutier
  assert.equal(workers.length, 1, 'un seul worker pour toutes les demandes');
  assert.deepEqual(workers[0].envoyes[0], { type: 'init', urlTuiles: 't', urlNational: 'n' });
});

test('itinéraire distant : un aperçu remplacé avant son tour est annulé (résolu à null), les autres non', async () => {
  let w;
  const calcules = [];
  const r = new ReseauRoutierDistant(() => (w = new FauxWorker(async ({ id, args }, emettre) => {
    calcules.push(args[1]);
    emettre({ id, resultat: args[1] });
  })), { urlTuiles: 't', urlNational: 'n' });
  const clic = r.itineraire([0, 0], [9, 9]); // sans canal : jamais annulé
  const apercus = [1, 2, 3, 4].map((x) => r.itineraire([0, 0], [x, x], { canal: 'apercu' }));
  await w.vider();
  assert.deepEqual(await clic, [9, 9]);
  assert.deepEqual(await Promise.all(apercus), [null, null, null, [4, 4]]);
  // Seuls le clic et le dernier aperçu ont été calculés.
  assert.deepEqual(calcules, [[9, 9], [4, 4]]);
});

test('itinéraire distant : progression de la matrice et erreurs transmises', async () => {
  let w;
  const r = new ReseauRoutierDistant(() => (w = new FauxWorker(async ({ id, methode }, emettre) => {
    if (methode === 'matrice') {
      emettre({ id, progression: [1, 2] });
      emettre({ id, progression: [2, 2] });
      emettre({ id, resultat: [[0]] });
    } else emettre({ id, erreur: 'tuiles illisibles' });
  })), { urlTuiles: 't', urlNational: 'n' });
  const etapes = [];
  const m = r.matrice([[0, 0]], { progression: (f, t) => etapes.push(`${f}/${t}`) });
  const e = r.itineraire([0, 0], [1, 1]);
  await w.vider();
  assert.deepEqual(await m, [[0]]);
  assert.deepEqual(etapes, ['1/2', '2/2']);
  await assert.rejects(e, /tuiles illisibles/);
});

test('itinéraire distant : un worker planté rejette les demandes en cours, le suivant est recréé', async () => {
  const workers = [];
  const r = new ReseauRoutierDistant(() => {
    const w = new FauxWorker(async ({ id }, emettre) => emettre({ id, resultat: 'ok' }));
    workers.push(w);
    return w;
  }, { urlTuiles: 't', urlNational: 'n' });
  const enCours = r.itineraire([0, 0], [1, 1]);
  workers[0].onerror({ message: 'module introuvable', preventDefault() {} });
  await assert.rejects(enCours, /module introuvable/);
  assert.equal(workers[0].termine, true);
  const ensuite = r.itineraire([0, 0], [1, 1]);
  await workers[1].vider();
  assert.equal(await ensuite, 'ok');
  assert.equal(workers.length, 2);
});
