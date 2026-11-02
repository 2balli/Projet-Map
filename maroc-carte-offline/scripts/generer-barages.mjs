/**
 * Génère un jeu de barages SIMULÉS pour tester la couche « Barages » (affichage,
 * filtres, hiérarchie, édition) : `donnees/barages/barages.json`, à part des données de
 * la Gendarmerie. Chaque barage est posé — de façon reproductible — SUR UNE ROUTE
 * carrossable (tuiles locales, donnees/tiles/maroc.pmtiles) d'une circonscription de
 * brigade importée, et marqué `isSimulation: true`. Ce ne sont pas des emplacements
 * opérationnels.
 *
 *   npm run barages                                  1 000 barages, graine 1
 *   npm run barages -- --graine 7 --nombre 2000
 *   npm run barages -- --verifier                    contrôle le jeu installé (routes, brigades)
 *
 * Un jeu validé du même format (voir src/barages.js) peut remplacer ce fichier tel quel ;
 * « --verifier » contrôle qu'il est complet et posé sur des routes.
 * À lancer après « npm run gendarmerie » (et à relancer après chaque nouvel import :
 * les identifiants « bt-N » suivent l'ordre des circonscriptions importées).
 */
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PMTiles } from 'pmtiles';
import {
  construireHierarchie, genererBarages, jeuSimulation, lireJeuBarages, placeurSurRoute, surUneRoute,
} from '../src/barages.js';
import { ReseauRoutier } from '../src/itineraire.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENDARMERIE = path.join(RACINE, 'donnees', 'gendarmerie');
const TUILES = path.join(RACINE, 'donnees', 'tiles', 'maroc.pmtiles');
const SORTIE = path.join(RACINE, 'donnees', 'barages', 'barages.json');

function option(args, nom, defaut) {
  const i = args.indexOf(`--${nom}`);
  if (i < 0) return defaut;
  const valeur = Number(args[i + 1]);
  if (!Number.isInteger(valeur) || valeur < 1) throw new Error(`--${nom} : entier positif attendu`);
  return valeur;
}

/** Routes lues dans l'archive locale, comme le fait la carte (ReseauRoutier.lignes). */
async function ouvrirRoutes() {
  if (!existsSync(TUILES)) throw new Error(`${TUILES} absent : lancez d'abord « npm run data ».`);
  const fichier = await open(TUILES);
  const archive = new PMTiles({
    getKey: () => TUILES,
    getBytes: async (decalage, longueur) => {
      const tampon = Buffer.alloc(longueur);
      await fichier.read(tampon, 0, longueur, decalage);
      return { data: tampon.buffer.slice(tampon.byteOffset, tampon.byteOffset + longueur) };
    },
  });
  const reseau = new ReseauRoutier(archive);
  return { lireRoutes: (bbox, zMax) => reseau.lignes(bbox, { zMax }), fermer: () => fichier.close() };
}

async function lireReferentiel() {
  const lire = async (nom) => {
    const fichier = path.join(GENDARMERIE, nom);
    if (!existsSync(fichier)) throw new Error(`${fichier} absent : lancez d'abord « npm run gendarmerie ».`);
    return JSON.parse(await readFile(fichier, 'utf8'));
  };
  const [reg, cie, bt, rapport] = await Promise.all(['circo-reg.geojson', 'circo-cie.geojson', 'circo-bt.geojson', 'rapport.json'].map(lire));
  const hierarchie = construireHierarchie({ reg: reg.features.map((f) => f.properties), cie: cie.features.map((f) => f.properties), bt: bt.features.map((f) => f.properties) });
  return { bt, rapport, hierarchie };
}

/** Contrôle un jeu : enregistrements valides, brigades existantes, chaque barage sur une route. */
async function verifier(jeu, hierarchie, lireRoutes) {
  const lu = lireJeuBarages(jeu, hierarchie);
  const horsRoute = [];
  for (const b of lu.barages) if (!(await surUneRoute(b, lireRoutes))) horsRoute.push(b.id);
  return { lu, horsRoute };
}

async function principal() {
  const args = process.argv.slice(2);
  const { bt, rapport, hierarchie } = await lireReferentiel();
  const routes = await ouvrirRoutes();
  try {
    if (args.includes('--verifier')) {
      if (!existsSync(SORTIE)) throw new Error(`${SORTIE} absent : rien à vérifier.`);
      const { lu, horsRoute } = await verifier(JSON.parse(await readFile(SORTIE, 'utf8')), hierarchie, routes.lireRoutes);
      console.log(`${SORTIE} : ${lu.barages.length} barage(s) valide(s), ${lu.rejetes.length} rejeté(s), ${horsRoute.length} hors route`);
      for (const r of lu.rejetes.slice(0, 20)) console.log(`  rejeté ${r.id ?? '?'} : ${r.erreurs.join(' ; ')}`);
      if (horsRoute.length) console.log(`  hors route : ${horsRoute.slice(0, 20).join(', ')}${horsRoute.length > 20 ? '…' : ''}`);
      if (lu.rejetes.length || horsRoute.length) process.exitCode = 1;
      return;
    }

    const graine = option(args, 'graine', 1);
    const nombre = option(args, 'nombre', 1000);
    const debut = performance.now();
    const barages = await genererBarages(bt.features, { graine, nombre, placer: placeurSurRoute(routes.lireRoutes) });
    const jeu = jeuSimulation(barages, {
      graine,
      referentiel: { importeLe: rapport.importeLe ?? null, circonscriptionsBt: bt.features.length },
    });

    // Contrôle avec le même code que la carte : valides, rattachés, sur une route.
    const { lu, horsRoute } = await verifier(jeu, hierarchie, routes.lireRoutes);
    if (lu.rejetes.length || horsRoute.length) {
      throw new Error(`jeu généré incorrect : ${lu.rejetes.length} invalide(s), ${horsRoute.length} hors route`);
    }

    await mkdir(path.dirname(SORTIE), { recursive: true });
    await writeFile(SORTIE, JSON.stringify(jeu));

    const compte = (f) => barages.filter(f).length;
    const sansCie = compte((b) => !hierarchie.brigades.get(b.btId).cieId);
    const classes = {};
    for (const b of barages) classes[b.route.classe] = (classes[b.route.classe] ?? 0) + 1;
    console.log(`Barages SIMULÉS : ${barages.length} (graine ${graine}), tous sur une route, ${((performance.now() - debut) / 1000).toFixed(0)} s → ${SORTIE}`);
    console.log(`  fixes : ${compte((b) => b.type === 'fixe')} · intouchables (24 h/24, sans faction) : ${compte((b) => b.type === 'intouchable')}`);
    console.log(`  routes : ${Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(', ')}`);
    console.log(`  brigades concernées : ${new Set(barages.map((b) => b.btId)).size} sur ${bt.features.length}`);
    if (sansCie) {
      const noms = [...new Set(hierarchie.anomalies.compagnieInconnue.map((id) => hierarchie.brigades.get(id).cieSource))].join(', ');
      console.log(`  ${sansCie} barage(s) dans une brigade dont la compagnie n'a pas de circonscription (${noms}) : compagnie « non résolue »`);
    }
    console.log('Positions fictives pour les tests : à ne pas diffuser comme des emplacements opérationnels.');
  } finally {
    await routes.fermer();
  }
}

principal().catch((erreur) => {
  console.error(`Barages : ${erreur.message}`);
  process.exit(1);
});
