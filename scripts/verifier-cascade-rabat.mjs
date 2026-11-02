#!/usr/bin/env node
/**
 * ÉPREUVE DE LA CASCADE SUR LE RÉSEAU RÉEL — Rabat, barrages temporaires.
 *
 *   node --max-old-space-size=4096 scripts/verifier-cascade-rabat.mjs
 *
 * Aucune donnée n'est lue ni écrite : les barrages A → E sont créés EN
 * MÉMOIRE, recalés sur des routes réelles de la région de Rabat, puis confiés
 * au moteur de l'optimisation automatique avec la même contrainte de zone que
 * le serveur (candidats dans la région, `controler` sur son contour).
 *
 * Deux jeux :
 *
 *   1. A → E seuls — le moteur doit enchaîner PLUSIEURS déplacements, chacun
 *      appliqué à l'état simulé puis remesuré, jusqu'à ce que plus rien ne
 *      puisse bouger ;
 *   2. A → E avec les Intouchables réels du dépôt de démonstration (lecture
 *      seule) — la même simulation face aux postes permanents.
 *
 * Dans les deux cas, l'état final rendu est REMESURÉ DEPUIS ZÉRO par la route
 * après application des propositions : il doit donner exactement le nombre de
 * conflits annoncé, et aucun poste déplacé ne doit être en conflit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerGrapheRoutier } from '../serveur/distances.mjs';
import { accrocher, itineraire, arbreBorne, distanceParArbres } from '../serveur/routage.mjs';
import { recalerPosition } from '../serveur/pointKilometrique.mjs';
import { chargerCirconscriptions, controler, localiser } from '../serveur/geo.mjs';
import { estIntouchable } from '../serveur/depot.mjs';
import {
  analyserOptimisationDistance, listerConflitsDistance, intouchablesUtiles, SEUIL_DISTANCE_AUTO_KM,
} from '../serveur/optimisationDistance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const couches = join(ROOT, 'public', 'layers');
const graphe = chargerGrapheRoutier(join(couches, 'graphe_routier.json'));
const circ = chargerCirconscriptions(couches);
let echecs = 0;
const dit = (ok, msg) => {
  console.log(`  ${ok ? 'RÉUSSI' : 'ÉCHOUÉ'}  ${msg}`);
  if (!ok) echecs++;
};

const GRAINES = [['A', -6.845, 33.99], ['B', -6.78, 34.045], ['C', -6.93, 33.925], ['D', -6.99, 33.86], ['E', -6.7, 33.985]];
const temporaires = GRAINES.map(([l, x, y]) => {
  const p = recalerPosition(graphe, x, y, { rayonKm: 3 });
  const lieu = localiser(circ, [p.lng, p.lat]);
  return {
    id: `TMP-${l}`, nom: `Temporaire ${l}`, type: 'barrage_fixe', lng: p.lng, lat: p.lat, route: p.route ?? '',
    factionId: 'F3', reg: lieu.reg, cie: lieu.cie, bt: lieu.bt, accidentCount: 0, eclairage: 'oui', statutBarrage: 'approuve',
  };
});
const dansRabat = (pt) => controler(circ, { rang: 'reg', unite: 'Rabat' }, pt) === 'autorise';
const zone = circ.region.get('Rabat');

function eprouver(titre, jeu) {
  console.log(`\n=== ${titre} ===\n`);
  const r = analyserOptimisationDistance(jeu, graphe, { garderPosition: (_b, pt) => dansRabat(pt), dansZone: dansRabat });
  const { resume, mesures, journal } = r;
  console.log(`  ${mesures.barrages} postes (${mesures.intouchables} Intouchables) · ${resume.conflitsAvant} conflits avant · ` +
    `${resume.deplacements} déplacement(s) · ${resume.conflitsResolus} résolus · ${resume.conflitsApres} restants`);
  console.log(`  ${mesures.iterations} itérations · ${mesures.passes} passe(s) · ${mesures.candidats} candidats · ` +
    `${mesures.calculsRoute} calculs de route · ${mesures.dureeMs} ms`);
  for (const p of journal) {
    console.log(`    pas ${p.pas} (passe ${p.passe}, itération ${p.iteration}) : ${p.nom} ` +
      `${p.conflitAvec.km.toFixed(2)} km de ${p.conflitAvec.nom} → ${p.distanceApresKm?.toFixed(2)} km · conflits ${p.conflitsAvant} → ${p.conflitsApres}`);
  }
  dit(jeu.every((b) => b.reg === 'Rabat' || estIntouchable(b)), 'tous les barrages déplaçables sont dans Rabat');
  dit(r.propositions.every((p) => dansRabat([p.apres.lng, p.apres.lat])), 'toutes les positions proposées sont dans Rabat');
  dit(r.propositions.every((p) => !estIntouchable(jeu.find((b) => b.id === p.id))), 'aucun Intouchable déplacé');
  dit(r.propositions.every((p) => p.routeDeplacement?.trace?.length > 2), 'chaque déplacement a son tracé routier réel');
  const final = jeu.map((b) => {
    const p = r.propositions.find((x) => x.id === b.id);
    return p ? { ...b, lng: p.apres.lng, lat: p.apres.lat } : b;
  });
  const remesure = listerConflitsDistance(final, graphe);
  dit(remesure.length === resume.conflitsApres, `état final remesuré depuis zéro : ${remesure.length} conflits = ${resume.conflitsApres} annoncés`);
  dit(r.propositions.every((p) => !remesure.some((c) => c.a === p.id || c.b === p.id)), 'aucun poste déplacé n’est en conflit (< 40 km par la route)');
  let precedent = resume.conflitsAvant;
  const decroit = journal.every((p) => {
    const ok = p.conflitsAvant === precedent && p.conflitsApres < p.conflitsAvant;
    precedent = p.conflitsApres;
    return ok;
  });
  dit(decroit && precedent === resume.conflitsApres, 'chaque pas part de l’état simulé précédent et réduit les conflits');
  dit(r.seuilKm === SEUIL_DISTANCE_AUTO_KM && r.critere === 'distance_routiere', `seuil appliqué : ${r.seuilKm} km par la route`);
  return r;
}

/* 0. LES ARBRES DONNENT LA MÊME DISTANCE QUE L'A* — sur le réseau réel. */
{
  console.log('\n=== 0. Arbres routiers bornés = A* (réseau réel, Rabat) ===\n');
  let graine = 11;
  const alea = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  const [o, sud, e, nord] = zone.bbox;
  let comparees = 0;
  let ecarts = 0;
  let sousSeuil = 0;
  for (let i = 0; i < 30; i++) {
    const p = accrocher(graphe, o + alea() * (e - o), sud + alea() * (nord - sud), 30);
    if (!p) continue;
    const arbres = {
      vers: arbreBorne(graphe, p, { inverse: true, limiteKm: SEUIL_DISTANCE_AUTO_KM }),
      depuis: arbreBorne(graphe, p, { limiteKm: SEUIL_DISTANCE_AUTO_KM }),
    };
    for (let j = 0; j < 60; j++) {
      const q = accrocher(graphe, o + alea() * (e - o), sud + alea() * (nord - sud), 30);
      if (!q) continue;
      const aller = itineraire(graphe, q, p, SEUIL_DISTANCE_AUTO_KM);
      const retour = itineraire(graphe, p, q, SEUIL_DISTANCE_AUTO_KM);
      const astar = Math.min(aller?.km ?? Infinity, retour?.km ?? Infinity);
      const arbre = distanceParArbres(graphe, q, p, arbres);
      const a = astar < SEUIL_DISTANCE_AUTO_KM ? astar : null;
      const b = arbre < SEUIL_DISTANCE_AUTO_KM ? arbre : null;
      comparees++;
      if (a != null) sousSeuil++;
      if ((a == null) !== (b == null) || (a != null && Math.abs(a - b) > 1e-9)) ecarts++;
    }
  }
  dit(ecarts === 0, `${comparees} couples comparés (${sousSeuil} sous ${SEUIL_DISTANCE_AUTO_KM} km) : ${ecarts} écart`);
}

const seuls = eprouver('1. RABAT — cinq barrages temporaires A → E', temporaires);
dit(seuls.resume.deplacements >= 2, `plusieurs déplacements enchaînés : ${seuls.resume.deplacements}`);

const depot = JSON.parse(readFileSync(join(ROOT, 'donnees-demo', 'marquages.json'), 'utf8'));
const intouchables = intouchablesUtiles(
  temporaires,
  depot.items.filter((m) => m.type === 'barrage_fixe' && estIntouchable(m) && m.statutBarrage !== 'supprime'),
  { zoneBbox: zone.bbox },
);
eprouver('2. RABAT — A → E face aux Intouchables réels (lecture seule)', [...temporaires, ...intouchables]);

console.log(`\n  ${echecs ? `${echecs} échec(s)` : 'Toutes les épreuves sont réussies.'}\n`);
process.exit(echecs ? 1 : 0);
