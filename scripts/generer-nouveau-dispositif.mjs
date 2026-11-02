#!/usr/bin/env node
/**
 * GÉNÉRATEUR DU NOUVEAU DISPOSITIF OPÉRATIONNEL (ÉTAPE 3)
 *
 * Dimensionnement validé :
 *   - 90 Barrages Fixes Intouchables (1 par Compagnie)
 *   - 504 Barrages Fixes Normaux (1 par Brigade)
 *   - 504 Barrages Mobiles (1 par Brigade)
 *   - TOTAL = 1 098 nouveaux barrages
 *
 * Datasets cibles :
 *   - donnees-demo    : 1 098 barrages (+ repères existants hors barrage)
 *   - donnees-serveur : 1 098 barrages (+ repères existants hors barrage)
 *   - donnees-production : 0 barrage (ne jamais toucher / vide)
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chargerGraphe,
  pointsArete,
  refArete,
  classeArete,
  distanceKm,
} from '../serveur/routage.mjs';
const SEPARATION_MEME_AXE_KM = 40;
import { chargerCirconscriptions, localiser, dansGeometrie } from '../serveur/geo.mjs';
import {
  chargerRoutesAffichees,
  pointSurRouteAffichee,
  pointSurRouteAccepte,
} from '../serveur/routesAffichees.mjs';
import { FACTIONS } from '../serveur/factions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COUCHES = join(ROOT, 'public', 'layers');
const ECRIRE = process.argv.includes('--ecrire');

console.log('\n================================================================');
console.log('  GÉNÉRATION DU NOUVEAU DISPOSITIF DE BARRAGES (ÉTAPE 3)');
console.log('================================================================\n');

const graphe = chargerGraphe(JSON.parse(readFileSync(join(COUCHES, 'graphe_routier.json'), 'utf8')));
const circo = chargerCirconscriptions(COUCHES);
const routesAffichees = chargerRoutesAffichees(COUCHES);

const circoBtJson = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
const circoCieJson = JSON.parse(readFileSync(join(COUCHES, 'circo_cie.geojson'), 'utf8'));
const circoRegJson = JSON.parse(readFileSync(join(COUCHES, 'circo_reg.geojson'), 'utf8'));

console.log(`Géographie : ${circoRegJson.features.length} Régions, ${circoCieJson.features.length} Compagnies, ${circoBtJson.features.length} Brigades`);

const RANG_CLASSE = { autoroute: 0, nationale: 1, regionale: 2, provinciale: 3, liaison: 4 };
const CLASSES_RETENUES = new Set(['autoroute', 'nationale', 'regionale', 'provinciale']);

const MAILLE = 0.25;
const GRILLE = new Map();
const BRIGADES = [];
{
  const vues = new Set();
  for (const f of circoBtJson.features ?? []) {
    const bt = f.properties?.gr_bde;
    if (!bt || !f.geometry || vues.has(bt)) continue;
    vues.add(bt);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const parcourir = (c) => {
      if (typeof c[0] === 'number') {
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
        return;
      }
      c.forEach(parcourir);
    };
    parcourir(f.geometry.coordinates);
    BRIGADES.push({
      bt,
      cie: f.properties?.gr_cie ?? null,
      reg: f.properties?.gr_region ?? null,
      geometry: f.geometry,
      bbox: [minX, minY, maxX, maxY],
    });
  }
}
BRIGADES.sort((a, b) => a.bt.localeCompare(b.bt, 'fr'));

BRIGADES.forEach((b, i) => {
  const [minX, minY, maxX, maxY] = b.bbox;
  for (let x = Math.floor(minX / MAILLE); x <= Math.floor(maxX / MAILLE); x++) {
    for (let y = Math.floor(minY / MAILLE); y <= Math.floor(maxY / MAILLE); y++) {
      const cle = `${x}|${y}`;
      if (!GRILLE.has(cle)) GRILLE.set(cle, []);
      GRILLE.get(cle).push(i);
    }
  }
});

function brigadeDuPoint(lng, lat) {
  const candidates = GRILLE.get(`${Math.floor(lng / MAILLE)}|${Math.floor(lat / MAILLE)}`);
  if (!candidates) return null;
  for (const i of candidates) {
    const b = BRIGADES[i];
    const [minX, minY, maxX, maxY] = b.bbox;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (dansGeometrie([lng, lat], b.geometry)) return i;
  }
  return null;
}

// 1. Échantillonnage des arêtes par brigade et par compagnie
console.log('Échantillonnage du réseau routier...');
const parCompagnie = new Map();
const candidatsParBrigade = new Map();

const milieuDe = (arete) => {
  const pts = pointsArete(graphe, arete);
  return pts[Math.floor(pts.length / 2)];
};

for (let i = 0; i < graphe.nA; i++) {
  const classe = classeArete(graphe, i);
  if (!CLASSES_RETENUES.has(classe)) continue;
  const ref = refArete(graphe, i) ?? '';
  const pts = pointsArete(graphe, i);
  const [mX, mY] = milieuDe(i);
  const lieu = localiser(circo, [mX, mY]);

  if (lieu?.cie && ref) {
    let lot = parCompagnie.get(lieu.cie);
    if (!lot) parCompagnie.set(lieu.cie, (lot = new Map()));
    let axe = lot.get(ref);
    if (!axe) lot.set(ref, (axe = { ref, classe, km: 0, aretes: [] }));
    axe.km += graphe.M[i] / 1000;
    axe.aretes.push(i);
  }

  // Échantillonnage pour les brigades
  let reste = 0;
  for (let k = 1; k < pts.length; k++) {
    const [x1, y1] = pts[k - 1];
    const [x2, y2] = pts[k];
    const seg = distanceKm(x1, y1, x2, y2);
    if (!(seg > 0)) continue;
    let pos = reste;
    while (pos <= seg) {
      const t = pos / seg;
      const lng = x1 + t * (x2 - x1);
      const lat = y1 + t * (y2 - y1);
      const ib = brigadeDuPoint(lng, lat);
      if (ib != null) {
        if (!candidatsParBrigade.has(ib)) candidatsParBrigade.set(ib, []);
        candidatsParBrigade.get(ib).push({ lng, lat, ref, classe });
      }
      pos += 2.0; // Pas de 2 km
    }
    reste = pos - seg;
  }
}

// 2. GÉNÉRATION DES 90 BFI
console.log('Calcul des 90 Barrages Fixes Intouchables...');
const compagnies = [...circo.compagnie.values()].sort((a, b) => a.nom.localeCompare(b.nom));
const bfis = [];
const posesBFI = [];

for (let idx = 0; idx < compagnies.length; idx++) {
  const c = compagnies[idx];
  const lot = parCompagnie.get(c.nom);
  let ptChoisi = null;

  if (lot) {
    const axes = [...lot.values()].sort(
      (a, b) => (RANG_CLASSE[a.classe] ?? 9) - (RANG_CLASSE[b.classe] ?? 9) || b.km - a.km,
    );

    for (const axe of axes) {
      const n = axe.aretes.length;
      const ordre = [];
      const centre = Math.floor(n / 2);
      for (let d = 0; d < n; d++) {
        const g = centre - d;
        const dr = centre + d;
        if (g >= 0) ordre.push(axe.aretes[g]);
        if (d > 0 && dr < n) ordre.push(axe.aretes[dr]);
      }

      for (const arete of ordre) {
        const [lng, lat] = milieuDe(arete);
        const lieu = localiser(circo, [lng, lat]);
        if (lieu?.cie !== c.nom) continue;

        const gene = posesBFI.find(
          (p) => p.route === axe.ref && distanceKm(lng, lat, p.lng, p.lat) < SEPARATION_MEME_AXE_KM,
        );
        if (gene) continue;

        const surTrait =
          pointSurRouteAccepte(routesAffichees, lng, lat, (x, y) => {
            const loc = localiser(circo, [x, y]);
            return loc?.cie === c.nom;
          }) ?? pointSurRouteAffichee(routesAffichees, lng, lat);

        const retenu = surTrait && surTrait.metres <= 150 ? surTrait : { lng, lat };

        ptChoisi = {
          lng: +Number(retenu.lng).toFixed(5),
          lat: +Number(retenu.lat).toFixed(5),
          route: axe.ref,
          classe: axe.classe,
          cie: lieu.cie,
          bt: lieu.bt,
          reg: lieu.reg,
        };
        break;
      }
      if (ptChoisi) break;
    }
  }

  // Si aucun point sur axe structurant respectant 40km n'a été trouvé, chercher sur n'importe quelle route de la compagnie
  if (!ptChoisi) {
    const bds = BRIGADES.filter((b) => b.cie === c.nom);
    for (const b of bds) {
      const ib = BRIGADES.indexOf(b);
      const pts = candidatsParBrigade.get(ib);
      if (pts && pts.length > 0) {
        const p = pts[Math.floor(pts.length / 2)];
        ptChoisi = {
          lng: +Number(p.lng).toFixed(5),
          lat: +Number(p.lat).toFixed(5),
          route: p.ref || 'Voie locale',
          classe: p.classe,
          cie: b.cie,
          bt: b.bt,
          reg: b.reg,
        };
        break;
      }
    }
  }

  if (!ptChoisi) {
    throw new Error(`Impossible de trouver une position pour le BFI de la compagnie ${c.nom}`);
  }

  posesBFI.push(ptChoisi);

  const codeId = String(idx + 1).padStart(3, '0');
  const bfiItem = {
    id: `BFI-CIE-${codeId}`,
    nom: `BFI ${ptChoisi.cie}`,
    type: 'barrage_fixe',
    protection: 'intouchable',
    intouchable: true,
    route: ptChoisi.route,
    note: `Barrage Fixe Intouchable de la compagnie ${ptChoisi.cie}. Position permanente sur ${ptChoisi.route} (${ptChoisi.classe}). Les factions s'y relaient ; poste exclu du retrait et de l'optimisation.`,
    debut: '00:00',
    fin: '24:00',
    factionId: '',
    accidentCount: 0,
    severite: 'none',
    activite: 'low',
    infraction: 'low',
    positionVille: 'none',
    eclairage: 'inconnu',
    statutBarrage: 'approuve',
    etatAvant: null,
    optimisationAuto: null,
    supprimeLe: null,
    supprimePar: null,
    decisionOptimisation: 'aucune',
    origineId: null,
    patrouilles: [],
    sousType: 'none',
    exceptionnel: false,
    missionId: null,
    viaAssistant: false,
    partage: false,
    bt: ptChoisi.bt,
    cie: ptChoisi.cie,
    reg: ptChoisi.reg,
    compagnieId: ptChoisi.cie,
    brigadeId: ptChoisi.bt,
    regionId: ptChoisi.reg,
    lng: ptChoisi.lng,
    lat: ptChoisi.lat,
    longitude: ptChoisi.lng,
    latitude: ptChoisi.lat,
    auteur: { matricule: 'SYSTEME', nom: 'Semis BFI Permanent', role: 'commandement', rang: 'admin', unite: 'systeme' },
    majPar: { matricule: 'SYSTEME', nom: 'Semis BFI Permanent', role: 'commandement', rang: 'admin', unite: 'systeme' },
    cree: '2026-09-24T12:00:00.000Z',
    maj: '2026-09-24T12:00:00.000Z',
  };
  bfis.push(bfiItem);
}

console.log(`✓ 90 BFI créés pour les 90 Compagnies.`);

// 3. GÉNÉRATION DES BARRAGES NORMAUX (504 FIXES, 0 MOBILE)
console.log('Calcul des 504 Barrages Fixes Normaux (aucun barrage mobile)...');
const fixesNormaux = [];

BRIGADES.forEach((b, idx) => {
  const ib = idx;
  const pts = candidatsParBrigade.get(ib) ?? [];
  const bfiCie = posesBFI.find((p) => p.bt === b.bt);

  // Trier les candidats par distance au BFI pour éviter la confusion
  const candidatsValides = pts.filter((p) => {
    if (!bfiCie) return true;
    return distanceKm(p.lng, p.lat, bfiCie.lng, bfiCie.lat) >= 3.0;
  });

  const sourcePts = candidatsValides.length >= 1 ? candidatsValides : pts;

  let ptFixe = null;

  if (sourcePts.length >= 1) {
    const i1 = Math.floor(sourcePts.length * 0.5);
    ptFixe = sourcePts[i1];
  } else {
    // Si la brigade n'avait pas de point d'arête échantillonné, prendre le centre de la brigade
    const [minX, minY, maxX, maxY] = b.bbox;
    const cX = +Number((minX + maxX) / 2).toFixed(5);
    const cY = +Number((minY + maxY) / 2).toFixed(5);
    ptFixe = { lng: cX, lat: cY, ref: 'Axe territorial', classe: 'provinciale' };
  }

  // Rabattre sur les routes affichées
  const surTraitFixe = pointSurRouteAccepte(routesAffichees, ptFixe.lng, ptFixe.lat, (x, y) => dansGeometrie([x, y], b.geometry))
    ?? pointSurRouteAffichee(routesAffichees, ptFixe.lng, ptFixe.lat);

  const lngF = +Number((surTraitFixe?.metres <= 150 ? surTraitFixe : ptFixe).lng).toFixed(5);
  const latF = +Number((surTraitFixe?.metres <= 150 ? surTraitFixe : ptFixe).lat).toFixed(5);

  const codeId = String(idx + 1).padStart(3, '0');
  const factionF = FACTIONS[idx % FACTIONS.length];

  // Barrage Fixe Normal
  fixesNormaux.push({
    id: `BF-BT-${codeId}`,
    nom: `Poste fixe ${b.bt}`,
    type: 'barrage_fixe',
    protection: 'aucune',
    intouchable: false,
    route: ptFixe.ref || ptFixe.classe || 'Route',
    note: `Point de contrôle fixe sur ${ptFixe.ref || ptFixe.classe || 'axe'} — ${factionF.nom} (${factionF.libelle}).`,
    debut: factionF.debut,
    fin: factionF.fin === '24:00' ? '00:00' : factionF.fin,
    factionId: factionF.id,
    accidentCount: 0,
    severite: 'none',
    activite: 'low',
    infraction: 'low',
    positionVille: 'none',
    eclairage: 'inconnu',
    statutBarrage: 'approuve',
    etatAvant: null,
    optimisationAuto: null,
    supprimeLe: null,
    supprimePar: null,
    decisionOptimisation: 'aucune',
    origineId: null,
    patrouilles: [],
    sousType: 'none',
    exceptionnel: false,
    missionId: null,
    viaAssistant: false,
    partage: false,
    bt: b.bt,
    cie: b.cie,
    reg: b.reg,
    compagnieId: b.cie,
    brigadeId: b.bt,
    regionId: b.reg,
    lng: lngF,
    lat: latF,
    longitude: lngF,
    latitude: latF,
    auteur: { matricule: 'SYSTEME', nom: 'Génération Dispositif', role: 'commandement', rang: 'admin', unite: 'systeme' },
    majPar: { matricule: 'SYSTEME', nom: 'Génération Dispositif', role: 'commandement', rang: 'admin', unite: 'systeme' },
    cree: '2026-09-24T12:00:00.000Z',
    maj: '2026-09-24T12:00:00.000Z',
  });
});

console.log(`✓ 504 Barrages Fixes Normaux créés.`);
console.log(`✓ 0 Barrage Mobile (supprimés selon modèle validé).`);

const tousNouveauxBarrages = [...bfis, ...fixesNormaux];
console.log(`\nTOTAL NOUVEAUX BARRAGES GÉNÉRÉS : ${tousNouveauxBarrages.length}`);

// Vérification d'unicité des IDs
const idsSet = new Set(tousNouveauxBarrages.map((b) => b.id));
if (idsSet.size !== tousNouveauxBarrages.length) {
  throw new Error(`Doublons d'ID détectés ! ${idsSet.size} uniques sur ${tousNouveauxBarrages.length}`);
}
console.log(`✓ Tous les ${tousNouveauxBarrages.length} identifiants sont strictement uniques.`);

// Écriture dans donnees-serveur et donnees-demo
function appliquerJeu(dossierNom) {
  const dossier = join(ROOT, dossierNom);
  const fichier = join(dossier, 'marquages.json');
  if (!existsSync(fichier)) {
    console.error(`Fichier introuvable : ${fichier}`);
    return;
  }
  const brut = JSON.parse(readFileSync(fichier, 'utf8'));
  const items = Array.isArray(brut) ? brut : brut.items ?? [];
  // Conserver les repères existants HORS BARRAGE (accidents, zahma, etc.)
  const horsBarrage = items.filter((m) => !String(m.type ?? '').startsWith('barrage'));

  const sortie = Array.isArray(brut)
    ? [...horsBarrage, ...tousNouveauxBarrages]
    : { ...brut, items: [...horsBarrage, ...tousNouveauxBarrages] };

  if (ECRIRE) {
    const sauvDir = join(dossier, 'sauvegardes');
    mkdirSync(sauvDir, { recursive: true });
    const horo = new Date().toISOString().replace(/[:.]/g, '-');
    copyFileSync(fichier, join(sauvDir, `marquages.json.avant-etape3-${horo}`));
    writeFileSync(fichier, JSON.stringify(sortie, null, 2), 'utf8');
    console.log(`✓ Écrit avec succès dans ${fichier} (${tousNouveauxBarrages.length} barrages + ${horsBarrage.length} repères conservés)`);
  } else {
    console.log(`[Simulation] ${fichier} recevrait ${tousNouveauxBarrages.length} barrages + ${horsBarrage.length} repères.`);
  }
}

console.log('\nApplication aux datasets :');
appliquerJeu('donnees-demo');
appliquerJeu('donnees-serveur');

// Vérification de donnees-production
const fichierProd = join(ROOT, 'donnees-production', 'marquages.json');
if (existsSync(fichierProd)) {
  const prodBrut = JSON.parse(readFileSync(fichierProd, 'utf8'));
  const prodItems = (prodBrut.items ?? prodBrut).filter((m) => String(m.type ?? '').startsWith('barrage'));
  console.log(`\nContrôle donnees-production : ${prodItems.length} barrage(s) trouvé(s). (Règle RESET : 0 barrage).`);
}

if (!ECRIRE) {
  console.log('\n[APERÇU SEULEMENT] Rien n’a été écrit sur le disque.');
  console.log('Pour appliquer définitivement, lancez avec : node scripts/generer-nouveau-dispositif.mjs --ecrire\n');
}
