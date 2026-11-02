/**
 * CALCUL DES CONFLITS D'ESPACEMENT SUR UN AXE — « Filtrer par route » → Calculer.
 *
 * C'est le calcul qui vivait dans `handleCalculerFiltreRoute`
 * (GendarmerieMap.jsx), déplacé ici À L'IDENTIQUE pour deux raisons :
 *   — il était une double boucle synchrone : tant qu'elle tournait, le
 *     navigateur ne dessinait plus rien, ni radar ni progression ;
 *   — il est désormais éprouvé sous Node sur les données réelles
 *     (`npm run check:analyse-route`).
 *
 * LA RÈGLE (inchangée) : toute paire de barrages de l'axe (et du sens choisi)
 * dont la distance est ≤ au seuil est un conflit. Distance routière par le
 * graphe quand il est chargé (plus court chemin), sinon géodésique
 * (haversine, `distanceKm`). Ce calcul n'applique NI faction NI créneau — il
 * ne l'a jamais fait ; seule la détection du serveur le fait.
 *
 * CE QUI CHANGE : le travail est découpé en tranches de ~16 ms ; entre deux
 * tranches la page respire (le radar tourne, la progression s'affiche).
 * La progression est RÉELLE : paires examinées / paires à examiner.
 *
 * `traceRoutiere` (ajouté) dit d'où vient `trace` : `true` = le plus court
 * chemin du graphe routier (la vraie route, virages compris) ; `false` = le
 * segment entre les deux postes (repli haversine, sans graphe) — la carte ne
 * le dessine JAMAIS comme une route.
 */
import * as RT from './routage.js';
import * as MQ from './marquages.js';
import { canonicalRouteId, clePaire } from './conflitsIdentifies.js';
import { obtenirDirectionBarrage, SENS_TOUS } from './directionSens.js';

/** Les barrages portés par l'axe (identifiant canonique de route). */
export function barragesDeLaRoute(items, can) {
  return (items || []).filter((b) => {
    if (!MQ.estBarrage(b)) return false;
    if (!can) return true;
    const r = canonicalRouteId(b.route || b.roadName || b.axe || b.axeRoutier);
    return r === can;
  });
}

const cederParDefaut = () => new Promise((r) => setTimeout(r, 0));
const maintenant = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Erreur d'interruption (composant démonté, calcul remplacé). */
export class AnalyseInterrompue extends Error {
  constructor() {
    super('Analyse interrompue.');
    this.name = 'AnalyseInterrompue';
  }
}

/**
 * @param {object} p
 * @param {object[]} p.barrages     tous les marquages (filtrés ici sur l'axe)
 * @param {string}   p.can          identifiant canonique de l'axe
 * @param {number}   p.distance     seuil (km)
 * @param {string}   [p.sens]       SENS_TOUS | sens d'un barrage
 * @param {object}   [p.graphe]     graphe routier chargé, ou null (haversine)
 * @param {(f: {faites: number, total: number}) => void} [p.surProgression]
 * @param {{ aborted: boolean }} [p.signal]  interruption
 * @param {() => Promise<void>} [p.ceder]    rend la main au navigateur
 * @param {number} [p.tranche]  durée d'une tranche de calcul (ms)
 * @returns {Promise<{ conflits: object[], barragesCandidats: object[], total: number }>}
 */
export async function calculerConflitsRoute({
  barrages, can, distance, sens = SENS_TOUS, graphe = null, surProgression, signal, ceder = cederParDefaut, tranche = 16,
}) {
  const barragesCandidats = barragesDeLaRoute(barrages, can);
  const barragesAValuer = (sens && sens !== SENS_TOUS)
    ? barragesCandidats.filter((b) => (obtenirDirectionBarrage(b) || '').toUpperCase() === sens.toUpperCase())
    : barragesCandidats;

  const n = barragesAValuer.length;
  const total = (n * (n - 1)) / 2;
  let faites = 0;
  surProgression?.({ faites, total });

  const conflitsTrouves = [];
  let debutTranche = maintenant();

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const bA = barragesAValuer[i];
      const bB = barragesAValuer[j];

      let dist = null;
      let trace = null;
      let tempsMin = null;
      let traceRoutiere = false;

      if (graphe && Number.isFinite(bA.lng) && Number.isFinite(bA.lat) && Number.isFinite(bB.lng) && Number.isFinite(bB.lat)) {
        try {
          const accA = RT.accrocher(graphe, bA.lng, bA.lat);
          const accB = RT.accrocher(graphe, bB.lng, bB.lat);
          if (accA && accB) {
            const iti = RT.itineraire(graphe, accA, accB, 'court');
            if (iti && Number.isFinite(iti.km)) {
              dist = iti.km;
              trace = iti.trace;
              traceRoutiere = Array.isArray(iti.trace) && iti.trace.length > 1;
              tempsMin = iti.heures ? Math.round(iti.heures * 60) : null;
            }
          }
        } catch (err) {
          console.warn('Erreur itinéraire graphe:', err);
        }
      }

      if (dist == null && Number.isFinite(bA.lng) && Number.isFinite(bB.lng)) {
        dist = RT.distanceKm(bA.lng, bA.lat, bB.lng, bB.lat);
        trace = [[bA.lng, bA.lat], [bB.lng, bB.lat]];
        tempsMin = Math.round((dist / 60) * 60);
      }

      if (dist != null && dist <= distance) {
        const paire = clePaire(bA.id, bB.id);
        conflitsTrouves.push({
          id: `conf_calc_${paire}`,
          numero: `C-R${conflitsTrouves.length + 1}`,
          paireCle: paire,
          barrageAId: bA.id,
          barrageBId: bB.id,
          a: bA,
          b: bB,
          route: can || bA.route || bB.route || '',
          factionsCommunes: bA.factionId ? [bA.factionId] : (bA.factions || []),
          distanceKm: Number(dist.toFixed(1)),
          seuilKm: distance,
          tempsMinutes: tempsMin,
          trace,
          traceRoutiere,
          motif: `Espacement de ${dist.toFixed(1)} km inférieur au seuil (${distance} km)`,
          statut: 'nouveau',
          estAssigne: false,
          historique: [],
        });
      }

      faites++;
      if (maintenant() - debutTranche >= tranche) {
        surProgression?.({ faites, total });
        await ceder();
        if (signal?.aborted) throw new AnalyseInterrompue();
        debutTranche = maintenant();
      }
    }
  }
  surProgression?.({ faites, total });
  return { conflits: conflitsTrouves, barragesCandidats, total };
}
