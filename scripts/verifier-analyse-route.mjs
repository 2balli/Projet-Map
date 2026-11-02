/**
 * ÉPREUVE DE L'ANALYSE PAR ROUTE — « Filtrer par route » → Calculer.
 *
 *   npm run check:analyse-route
 *
 * Sur les barrages réels (donnees-demo/marquages.json) et le graphe routier
 * réel (public/layers/graphe_routier.json) :
 *   — le calcul déplacé dans calculConflitsRoute.js rend EXACTEMENT ce que
 *     rendait la boucle d'origine (recopiée ci-dessous telle qu'elle était
 *     dans GendarmerieMap.jsx), en haversine comme par le graphe ;
 *   — la progression est réelle (paires examinées / total) et va au bout ;
 *   — le calcul rend la main au navigateur (le radar peut tourner) ;
 *   — il s'interrompt proprement, et une erreur n'est jamais avalée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as RT from '../src/routage.js';
import * as MQ from '../src/marquages.js';
import { canonicalRouteId, clePaire } from '../src/conflitsIdentifies.js';
import { obtenirDirectionBarrage, SENS_TOUS, SENS_ALLER } from '../src/directionSens.js';
import { calculerConflitsRoute, barragesDeLaRoute, AnalyseInterrompue } from '../src/calculConflitsRoute.js';

const brut = JSON.parse(readFileSync(new URL('../donnees-demo/marquages.json', import.meta.url), 'utf8'));
const items = brut.items ?? brut;
const graphe = RT.chargerGraphe(JSON.parse(readFileSync(new URL('../public/layers/graphe_routier.json', import.meta.url), 'utf8')));

/* La boucle d'origine, telle qu'elle était dans handleCalculerFiltreRoute. */
function reference({ can, distance, sens = SENS_TOUS, graphe: g = null }) {
  const barragesCandidats = (items || []).filter((b) => {
    if (!MQ.estBarrage(b)) return false;
    if (!can) return true;
    const r = canonicalRouteId(b.route || b.roadName || b.axe || b.axeRoutier);
    return r === can;
  });
  const conflitsTrouves = [];
  const barragesAValuer = (sens && sens !== SENS_TOUS)
    ? barragesCandidats.filter((b) => (obtenirDirectionBarrage(b) || '').toUpperCase() === sens.toUpperCase())
    : barragesCandidats;
  for (let i = 0; i < barragesAValuer.length; i++) {
    for (let j = i + 1; j < barragesAValuer.length; j++) {
      const bA = barragesAValuer[i];
      const bB = barragesAValuer[j];
      let dist = null;
      let trace = null;
      let tempsMin = null;
      if (g && Number.isFinite(bA.lng) && Number.isFinite(bA.lat) && Number.isFinite(bB.lng) && Number.isFinite(bB.lat)) {
        try {
          const accA = RT.accrocher(g, bA.lng, bA.lat);
          const accB = RT.accrocher(g, bB.lng, bB.lat);
          if (accA && accB) {
            const iti = RT.itineraire(g, accA, accB, 'court');
            if (iti && Number.isFinite(iti.km)) {
              dist = iti.km;
              trace = iti.trace;
              tempsMin = iti.heures ? Math.round(iti.heures * 60) : null;
            }
          }
        } catch { /* comme l'original */ }
      }
      if (dist == null && Number.isFinite(bA.lng) && Number.isFinite(bB.lng)) {
        dist = RT.distanceKm(bA.lng, bA.lat, bB.lng, bB.lat);
        trace = [[bA.lng, bA.lat], [bB.lng, bB.lat]];
        tempsMin = Math.round((dist / 60) * 60);
      }
      if (dist != null && dist <= distance) {
        const paire = clePaire(bA.id, bB.id);
        conflitsTrouves.push({
          id: `conf_calc_${paire}`, numero: `C-R${conflitsTrouves.length + 1}`, paireCle: paire,
          barrageAId: bA.id, barrageBId: bB.id, a: bA, b: bB, route: can || bA.route || bB.route || '',
          factionsCommunes: bA.factionId ? [bA.factionId] : (bA.factions || []), distanceKm: Number(dist.toFixed(1)),
          seuilKm: distance, tempsMinutes: tempsMin, trace,
          motif: `Espacement de ${dist.toFixed(1)} km inférieur au seuil (${distance} km)`,
          statut: 'nouveau', estAssigne: false, historique: [],
        });
      }
    }
  }
  return conflitsTrouves;
}

const sansAttente = () => Promise.resolve();
/* Le seul ajout au résultat d'origine : `traceRoutiere` (provenance du tracé). */
const sansProvenance = (l) => l.map(({ traceRoutiere: _p, ...c }) => c);

test('les données réelles : un axe avec conflits, un axe sans', async () => {
  const rn1 = await calculerConflitsRoute({ barrages: items, can: 'RN1', distance: 20, ceder: sansAttente });
  assert.ok(rn1.conflits.length > 0, 'RN1 ≤ 20 km : des conflits');
  const rn25 = await calculerConflitsRoute({ barrages: items, can: 'RN25', distance: 5, ceder: sansAttente });
  assert.ok(rn25.barragesCandidats.length >= 2 && rn25.conflits.length === 0, 'RN25 ≤ 5 km : aucun conflit');
});

test('haversine : résultats identiques à la boucle d’origine (6 axes, 2 seuils, sens)', async () => {
  for (const can of ['RN1', 'RN17', 'RN8', 'RN2', 'RN16', 'RN25']) {
    for (const distance of [5, 20]) {
      const attendu = reference({ can, distance });
      const { conflits } = await calculerConflitsRoute({ barrages: items, can, distance, ceder: sansAttente });
      assert.deepEqual(sansProvenance(conflits), attendu, `${can} ≤ ${distance} km`);
      assert.ok(conflits.every((c) => c.traceRoutiere === false), 'sans graphe : jamais présenté comme une route');
    }
  }
  const { conflits } = await calculerConflitsRoute({ barrages: items, can: 'RN1', distance: 20, sens: SENS_ALLER, ceder: sansAttente });
  assert.deepEqual(sansProvenance(conflits), reference({ can: 'RN1', distance: 20, sens: SENS_ALLER }), 'RN1, un seul sens');
});

test('graphe routier réel : résultats identiques à la boucle d’origine', async () => {
  for (const can of ['RN6', 'RN16']) {
    const attendu = reference({ can, distance: 20, graphe });
    const { conflits } = await calculerConflitsRoute({ barrages: items, can, distance: 20, graphe, ceder: sansAttente });
    assert.deepEqual(sansProvenance(conflits), attendu, can);
  }
});

test('graphe : tracé routier réel (virages conservés), marqué comme tel', async () => {
  const { conflits } = await calculerConflitsRoute({ barrages: items, can: 'RN1', distance: 20, graphe, ceder: sansAttente });
  const routiers = conflits.filter((c) => c.traceRoutiere);
  assert.ok(routiers.length > 0, 'des conflits ont leur route');
  assert.ok(routiers.some((c) => c.trace.length > 2), 'au moins une route a des sommets intermédiaires (virages)');
  for (const c of routiers) {
    /* La route part d'un poste et arrive à l'autre (à l'accroche près). */
    const [debut, fin] = [c.trace[0], c.trace.at(-1)];
    const prochesDe = (p, b) => RT.distanceKm(p[0], p[1], b.lng, b.lat) < 5;
    assert.ok((prochesDe(debut, c.a) && prochesDe(fin, c.b)) || (prochesDe(debut, c.b) && prochesDe(fin, c.a)), `${c.numero} : extrémités`);
  }
});

test('progression réelle : monotone, jusqu’à paires examinées = total', async () => {
  const vues = [];
  let cessions = 0;
  const r = await calculerConflitsRoute({
    barrages: items, can: 'RN1', distance: 20, graphe, tranche: 1,
    surProgression: (p) => vues.push({ ...p }),
    ceder: () => { cessions++; return Promise.resolve(); },
  });
  const n = barragesDeLaRoute(items, 'RN1').length;
  assert.equal(r.total, (n * (n - 1)) / 2);
  assert.deepEqual(vues[0], { faites: 0, total: r.total });
  assert.deepEqual(vues.at(-1), { faites: r.total, total: r.total });
  assert.ok(vues.every((p, i) => i === 0 || p.faites >= vues[i - 1].faites), 'monotone');
  assert.ok(cessions > 0, 'le calcul rend la main entre deux tranches');
});

test('interruption (carte fermée) : AnalyseInterrompue, aucun résultat', async () => {
  const signal = { aborted: false };
  await assert.rejects(
    calculerConflitsRoute({ barrages: items, can: 'RN1', distance: 20, graphe, tranche: 0, signal, ceder: () => { signal.aborted = true; return Promise.resolve(); } }),
    AnalyseInterrompue,
  );
});

test('une erreur pendant le calcul remonte (jamais « aucun conflit »)', async () => {
  await assert.rejects(
    calculerConflitsRoute({ barrages: items, can: 'RN1', distance: 20, tranche: 0, ceder: sansAttente, surProgression: (p) => { if (p.faites > 10) throw new Error('panne'); } }),
    /panne/,
  );
});
