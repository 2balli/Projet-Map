#!/usr/bin/env node
/**
 * Scénarios reproductibles pour éprouver l'optimisation automatique sur le
 * graphe routier local. Le mode par défaut est un aperçu sans écriture.
 *
 *   node scripts/seed-optimisation-demo.mjs                 aperçu
 *   node scripts/seed-optimisation-demo.mjs --appliquer     ajoute aux seules données demo
 *   node scripts/seed-optimisation-demo.mjs --retirer       aperçu du retrait
 *   node scripts/seed-optimisation-demo.mjs --retirer --appliquer
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accrocher, chargerGraphe, refArete } from '../serveur/routage.mjs';
import { distanceRouteMinKm } from '../serveur/distances.mjs';
import { analyserParTempsTrajet } from '../serveur/optimisationTrajet.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FICHIER_DEMO = join(ROOT, 'donnees-demo/marquages.json');
export const SCENARIOS = [
  { id: 'OPT-DEMO-RABAT-001', reg: 'Rabat', cie: 'Ain Aouda', bt: 'Ain Aouda', ancre: 'BF-BT-016', route: 'RN25', lng: -6.72909, lat: 33.76663 },
  { id: 'OPT-DEMO-AGADIR-001', reg: 'Agadir', cie: 'Agadir', bt: 'Agadir', ancre: 'BF-BT-005', route: 'RN1', lng: -9.53621, lat: 30.40711 },
  { id: 'OPT-DEMO-GUELMIM-001', reg: 'Guelmim', cie: 'Tan Tan', bt: 'Abteh', ancre: 'BF-BT-002', route: 'RN14', lng: -11.51135, lat: 27.85648 },
  { id: 'OPT-DEMO-MARRAKECH-001', reg: 'Marrakech', cie: 'Marrakech', bt: 'Agafay', ancre: 'BF-BT-006', route: 'RR212', lng: -8.11574, lat: 31.54889 },
  { id: 'OPT-DEMO-TETOUAN-001', reg: 'Tétouan', cie: 'Ouazzane', bt: 'Ain Dorrij', ancre: 'BF-BT-023', route: 'RP4569', lng: -5.26753, lat: 34.52425 },
  { id: 'OPT-DEMO-TAZA-001', reg: 'Taza', cie: 'Taza', bt: 'Ajdir', ancre: 'BF-BT-046', route: 'RR510', lng: -4.06332, lat: 34.72260 },
];

const ID_TEST = new Set(SCENARIOS.map((s) => s.id));
const lireDepot = () => JSON.parse(readFileSync(FICHIER_DEMO, 'utf8'));
const chargerGrapheDemo = () =>
  chargerGraphe(JSON.parse(readFileSync(join(ROOT, 'public/layers/graphe_routier.json'), 'utf8')));
const estActive = (m) =>
  m?.type === 'barrage_fixe' &&
  !['supprime', 'retire_optimisation'].includes(m.statutBarrage);
const uniques = (items) => [...new Map(items.filter(estActive).map((m) => [m.id, m])).values()];

function fabriquerScenario(s, anchor, cree, graphe) {
  if (
    anchor.reg !== s.reg ||
    anchor.cie !== s.cie ||
    anchor.bt !== s.bt ||
    anchor.route !== s.route ||
    anchor.intouchable === true ||
    anchor.type !== 'barrage_fixe' ||
    anchor.statutBarrage !== 'approuve' ||
    !anchor.factionId
  ) {
    throw new Error(`L'ancre ${s.ancre} ne correspond plus à la fiche territoriale attendue.`);
  }

  const point = { lng: s.lng, lat: s.lat };
  const snap = accrocher(graphe, point.lng, point.lat, 0.1);
  if (!snap || snap.ecartKm > 0.05 || refArete(graphe, snap.arete) !== s.route) {
    throw new Error(`${s.id} : coordonnées non situées sur la route locale ${s.route}.`);
  }
  const distanceKm = distanceRouteMinKm(graphe, [anchor.lng, anchor.lat], [point.lng, point.lat]);
  if (!(distanceKm > 0 && distanceKm < 40)) {
    throw new Error(`${s.id} : distance routière réelle invalide (${distanceKm} km).`);
  }

  const item = {
    ...anchor,
    id: s.id,
    nom: `TEST AUTO — ${s.reg} — ${s.bt}`,
    route: s.route,
    lng: s.lng,
    lat: s.lat,
    longitude: s.lng,
    latitude: s.lat,
    factionId: anchor.factionId,
    statutBarrage: 'approuve',
    protection: 'aucune',
    intouchable: false,
    note: `DONNÉE FICTIVE DE TEST — scénario optimisation automatique (${s.reg}).`,
    demo: true,
    auteur: {
      matricule: 'DEMO-OPTIMISATION',
      nom: 'Scénario de test automatique',
      role: 'commandement',
      rang: 'admin',
      unite: 'DEMO',
      reg: s.reg,
      cie: s.cie,
    },
    majPar: {
      matricule: 'DEMO-OPTIMISATION',
      nom: 'Scénario de test automatique',
      role: 'commandement',
      rang: 'admin',
      unite: 'DEMO',
      reg: s.reg,
      cie: s.cie,
    },
    cree,
    maj: cree,
  };

  return { item, distanceKm };
}

function verifierScenario(s, item, pool, graphe) {
  const scope = pool.filter((m) => m.bt === s.bt);
  const avant = JSON.stringify(scope);
  const resultat = analyserParTempsTrajet([item, ...scope], graphe);
  const proposition = resultat.propositions.find(
    (p) => p.id === item.id && p.action === 'changer_faction',
  );
  if (resultat.resume.conflitsAvant < 1 || !proposition) {
    throw new Error(`${s.id} : le moteur ne propose pas de changement de faction dans la brigade ${s.bt}.`);
  }
  if (proposition.nouvelleFactionId === item.factionId) {
    throw new Error(`${s.id} : la proposition ne change pas la faction.`);
  }
  if (proposition.lng !== item.lng || proposition.lat !== item.lat) {
    throw new Error(`${s.id} : le moteur a modifié une position, contrairement à son contrat actuel.`);
  }
  if (JSON.stringify(scope) !== avant) {
    throw new Error(`${s.id} : le moteur a modifié les objets d'entrée.`);
  }
  return { s, distanceKm: proposition.conflit.km, minutes: proposition.minutesAvant, proposition };
}

function sauvegarderAvantEcriture() {
  const dossier = join(ROOT, 'donnees-demo/sauvegardes');
  mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().replaceAll(':', '-');
  const backup = join(dossier, `marquages.avant-optimisation-auto-demo-${horodatage}.json`);
  copyFileSync(FICHIER_DEMO, backup);
  return backup;
}

function lancer() {
  const appliquer = process.argv.includes('--appliquer');
  const retirer = process.argv.includes('--retirer');
  const mode = JSON.parse(readFileSync(join(ROOT, 'donnees-demo/mode.json'), 'utf8')).mode;
  if (mode !== 'demo') throw new Error('Arrêt : donnees-demo/mode.json ne déclare pas le mode demo.');
  const graphe = chargerGrapheDemo();
  const depot = lireDepot();
  const items = Array.isArray(depot.items) ? depot.items : [];
  const physiquesAvant = uniques(items);
  const instant = new Date().toISOString();

  if (retirer) {
    const retires = items.filter((m) => ID_TEST.has(m.id));
    console.log(`Scénarios trouvés : ${retires.length}/${SCENARIOS.length}`);
    if (!appliquer || retires.length === 0) {
      console.log(appliquer ? 'Aucun scénario à retirer.' : 'Aperçu seulement : aucun fichier n’a été écrit.');
      return;
    }
    const backup = sauvegarderAvantEcriture();
    depot.items = items.filter((m) => !ID_TEST.has(m.id));
    writeFileSync(FICHIER_DEMO, `${JSON.stringify(depot, null, 2)}\n`, 'utf8');
    console.log(`Retirés : ${retires.length}. Barrages fixes physiques : ${uniques(depot.items).length}.`);
    console.log(`Sauvegarde : ${backup}`);
    return;
  }

  const deja = new Set(items.filter((m) => ID_TEST.has(m.id)).map((m) => m.id));
  if (deja.size && deja.size !== SCENARIOS.length) {
    throw new Error(`Semis partiel détecté (${deja.size}/${SCENARIOS.length}); vérifiez le fichier avant de continuer.`);
  }
  const ajouts = [];
  for (const s of SCENARIOS) {
    if (deja.has(s.id)) continue;
    const anchor = physiquesAvant.find((m) => m.id === s.ancre);
    if (!anchor) throw new Error(`Ancre introuvable : ${s.ancre}.`);
    const { item, distanceKm } = fabriquerScenario(s, anchor, instant, graphe);
    if (items.some((m) => m.id === item.id)) throw new Error(`ID déjà utilisé : ${item.id}.`);
    const scope = physiquesAvant.filter((m) => m.bt === s.bt);
    const verifie = verifierScenario(s, item, scope, graphe);
    ajouts.push({ s, anchor, item, distanceKm, minutes: verifie.minutes });
  }

  console.log('SCÉNARIOS D’OPTIMISATION AUTOMATIQUE — DEMO UNIQUEMENT');
  console.log(`Barrages fixes physiques avant : ${physiquesAvant.length}`);
  console.log(`Barrages à ajouter : ${ajouts.length}`);
  console.log(`Barrages fixes physiques après : ${physiquesAvant.length + ajouts.length}`);
  for (const { s, anchor, item, distanceKm, minutes } of ajouts) {
    console.log(
      `${s.id} | ${s.reg} | ${s.cie} | ${s.bt} | ${s.route} | ` +
        `${anchor.factionId} | ${distanceKm.toFixed(2)} km réseau | ${minutes.toFixed(1)} min | ` +
        `${item.lat}, ${item.lng}`,
    );
  }

  if (!appliquer) {
    console.log('Aperçu seulement : aucun fichier n’a été écrit. Ajoutez --appliquer pour semer demo.');
    return;
  }

  const backup = sauvegarderAvantEcriture();
  const aInserer = new Map(ajouts.map(({ s, item }) => [s.ancre, item]));
  depot.items = [];
  for (const item of items) {
    const nouveau = aInserer.get(item.id);
    if (nouveau) depot.items.push(nouveau); // égalité de score : le scénario est traité explicitement.
    depot.items.push(item);
  }
  writeFileSync(FICHIER_DEMO, `${JSON.stringify(depot, null, 2)}\n`, 'utf8');
  console.log(`Ajoutés : ${ajouts.length}. Barrages fixes physiques : ${uniques(depot.items).length}.`);
  console.log(`Sauvegarde : ${backup}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    lancer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
