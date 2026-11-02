#!/usr/bin/env node
/**
 * Extrait les PÔLES DE POPULATION que consomme la carte de risque.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `circo_bt.geojson` porte la population et la superficie de chaque
 * circonscription de brigade — exactement le signal qui fait ressortir les
 * grandes agglomérations sur la carte de risque. Mais il pèse 1,6 Mo de
 * contours, dont la carte de risque n'a aucun usage : elle ne veut qu'un point
 * et un poids par circonscription.
 *
 * On précalcule donc ici un fichier réduit — quelques dizaines de kilo-octets —
 * chargé en une fois quand l'utilisateur coche « Carte de risque ».
 *
 * LE RAYON
 * --------
 * `rayonKm = sqrt(superficie / π)` : le rayon du disque de même surface que la
 * circonscription. Une brigade urbaine tient quelques kilomètres carrés pour
 * un million d'habitants — le poids se concentre, la zone chauffe. Une brigade
 * rurale étale la même population sur des milliers de kilomètres carrés — elle
 * reste tiède. C'est ce rapport, et non la population brute, qui distingue une
 * grande ville d'un vaste territoire peu dense.
 *
 *   node scripts/build-poles-population.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'public/layers/circo_bt.geojson');
const SORTIES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')];

/**
 * Centroïde d'un polygone, pondéré par l'aire (formule du polygone), et non
 * simple moyenne des sommets : un contour dont un côté est finement découpé
 * tirerait la moyenne vers ce côté sans que la circonscription y soit pour
 * autant centrée.
 */
function centroide(anneau) {
  let aire2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [x0, y0] = anneau[j];
    const [x1, y1] = anneau[i];
    const f = x0 * y1 - x1 * y0;
    aire2 += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(aire2) < 1e-12) {
    /* Contour dégénéré : on retombe sur la moyenne des sommets. */
    const n = anneau.length || 1;
    return [anneau.reduce((s, p) => s + p[0], 0) / n, anneau.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * aire2), cy / (3 * aire2)];
}

/** Anneau extérieur le plus étendu — une circonscription peut être multi-parties. */
function anneauPrincipal(geom) {
  const polygones = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let meilleur = null;
  let max = -1;
  for (const poly of polygones) {
    const anneau = poly?.[0];
    if (!anneau?.length) continue;
    let aire2 = 0;
    for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
      aire2 += anneau[j][0] * anneau[i][1] - anneau[i][0] * anneau[j][1];
    }
    const aire = Math.abs(aire2) / 2;
    if (aire > max) {
      max = aire;
      meilleur = anneau;
    }
  }
  return meilleur;
}

if (!existsSync(SOURCE)) {
  console.error(`Source introuvable : ${SOURCE}`);
  process.exit(1);
}

const features = JSON.parse(readFileSync(SOURCE, 'utf8')).features ?? [];
const poles = [];
let sansPopulation = 0;

for (const f of features) {
  const pop = Number(f.properties?.population) || 0;
  if (pop <= 0) {
    sansPopulation++;
    continue;
  }
  const anneau = anneauPrincipal(f.geometry ?? {});
  if (!anneau) continue;
  const [lng, lat] = centroide(anneau);
  const superficie = Number(f.properties?.superficie) || 0;
  const rayonKm = superficie > 0 ? Math.sqrt(superficie / Math.PI) : 5;

  poles.push({
    nom: f.properties?.gr_bde ?? '',
    cie: f.properties?.gr_cie ?? '',
    lng: Number(lng.toFixed(4)),
    lat: Number(lat.toFixed(4)),
    pop,
    /* Superficie réelle, conservée pour le regroupement en agglomérations —
       retirée du fichier final, la carte n'en a pas l'usage. */
    aireKm2: superficie,
    /* Densité calculée sur la superficie RÉELLE, avant tout bornage du rayon :
       c'est elle qui distingue une ville d'un vaste territoire peu peuplé. */
    densite: superficie > 0 ? Number((pop / superficie).toFixed(2)) : 0,
    /* Borné : au-delà de ~45 km une circonscription est un territoire, plus un pôle. */
    rayonKm: Number(Math.min(45, Math.max(1.5, rayonKm)).toFixed(2)),
  });
}

/**
 * REGROUPEMENT EN AGGLOMÉRATIONS
 * ------------------------------
 * Sans cette étape, la carte de risque lit le découpage administratif plutôt
 * que le risque. Casablanca est partagée en une vingtaine de circonscriptions
 * de brigade : vingt noyaux qui se recouvrent et saturent. Tanger, avec ses
 * 1,4 million d'habitants, n'en forme qu'UNE seule et reste tiède. L'écart
 * affiché ne venait pas du terrain, mais de la finesse du découpage.
 *
 * On fusionne donc les circonscriptions URBAINES contiguës — celles dont la
 * densité dépasse le seuil ci-dessous — en un pôle unique par agglomération :
 * populations additionnées, superficies additionnées, centre pondéré par la
 * population. Les circonscriptions rurales restent séparées : ce sont des
 * territoires distincts, pas les morceaux d'une même ville.
 *
 * Le seuil de proximité est volontairement court. Un lien trop long
 * enchaînerait tout le littoral en un seul bloc de Casablanca à Kénitra —
 * l'écueil classique du regroupement par proche-en-proche. À 8 km, Rabat et
 * Salé fusionnent (elles forment bien une conurbation) mais Casablanca et
 * Mohammedia, distantes de 25 km, restent distinctes.
 */
const DENSITE_URBAINE = 300; // hab/km² — au-dessous, on est en territoire rural
const LIEN_KM = 8;

const distKm = (a, b) => {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLng = (a.lng - b.lng) * 111.32 * Math.cos(((a.lat + b.lat) / 2 * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
};

const urbains = poles.filter((p) => p.densite >= DENSITE_URBAINE);
const ruraux = poles.filter((p) => p.densite < DENSITE_URBAINE);

/* Union-find sur les seuls pôles urbains. */
const parent = urbains.map((_, i) => i);
const trouver = (i) => (parent[i] === i ? i : (parent[i] = trouver(parent[i])));
for (let i = 0; i < urbains.length; i++) {
  for (let j = i + 1; j < urbains.length; j++) {
    if (distKm(urbains[i], urbains[j]) <= LIEN_KM) {
      const a = trouver(i), b = trouver(j);
      if (a !== b) parent[a] = b;
    }
  }
}

const groupes = new Map();
urbains.forEach((p, i) => {
  const r = trouver(i);
  if (!groupes.has(r)) groupes.set(r, []);
  groupes.get(r).push(p);
});

const agglomerations = [];
for (const membres of groupes.values()) {
  const pop = membres.reduce((s, m) => s + m.pop, 0);
  const aire = membres.reduce((s, m) => s + m.aireKm2, 0);
  /* Centre pondéré : le barycentre doit tomber sur le cœur peuplé, pas au
     milieu géométrique d'une couronne. */
  const lng = membres.reduce((s, m) => s + m.lng * m.pop, 0) / pop;
  const lat = membres.reduce((s, m) => s + m.lat * m.pop, 0) / pop;
  /* Nom : la composante la plus peuplée porte l'agglomération. */
  const chef = membres.reduce((a, b) => (b.pop > a.pop ? b : a));
  const rayon = Math.sqrt(aire / Math.PI);
  agglomerations.push({
    nom: chef.nom,
    cie: chef.cie,
    parties: membres.length,
    lng: Number(lng.toFixed(4)),
    lat: Number(lat.toFixed(4)),
    pop,
    densite: aire > 0 ? Number((pop / aire).toFixed(2)) : 0,
    rayonKm: Number(Math.min(45, Math.max(1.5, rayon)).toFixed(2)),
  });
}

const fusionnes = [...agglomerations, ...ruraux.map(({ aireKm2, ...r }) => ({ ...r, parties: 1 }))];
const avantFusion = poles.length;
poles.length = 0;
poles.push(...fusionnes);

poles.sort((a, b) => b.densite - a.densite);

const contenu = JSON.stringify({
  _source: 'circo_bt.geojson (population, superficie) — regénérer : node scripts/build-poles-population.mjs',
  poles,
});

for (const dossier of SORTIES) {
  if (!existsSync(dossier)) continue;
  const chemin = join(dossier, 'poles-population.json');
  writeFileSync(chemin, contenu, 'utf8');
  console.log(`écrit ${chemin}  (${(contenu.length / 1024).toFixed(0)} Ko)`);
}

console.log('');
console.log(`Circonscriptions traitées : ${features.length}`);
console.log(`  sans population (ignorées) : ${sansPopulation}`);
console.log('');
console.log(`Regroupement : ${avantFusion} circonscriptions -> ${poles.length} pôles`);
console.log(`  agglomérations formées : ${agglomerations.length}   (à partir de ${urbains.length} circonscriptions urbaines)`);
console.log(`  pôles ruraux inchangés : ${ruraux.length}`);
const plusGrande = agglomerations.reduce((a, b) => (b.parties > a.parties ? b : a), agglomerations[0] ?? { parties: 0, nom: '—' });
console.log(`  plus grande agglomération : ${plusGrande.nom} (${plusGrande.parties} circonscriptions, rayon ${plusGrande.rayonKm} km)`);
console.log('');
console.log('Les douze pôles les plus DENSES — ce que la carte de risque fait ressortir :');
for (const p of poles.slice(0, 12)) {
  console.log(
    `  ${(p.nom + (p.parties > 1 ? ` (+${p.parties - 1})` : '')).padEnd(24)} ${String(p.pop).padStart(9)} hab.  rayon ${String(p.rayonKm).padStart(6)} km  ${Math.round(p.densite).toLocaleString('fr-FR').padStart(7)} hab/km²`
  );
}
console.log('');
const froids = [...poles].reverse().slice(0, 4);
console.log('À l’autre bout — territoires étendus et peu denses, qui doivent rester froids :');
for (const p of froids) {
  console.log(
    `  ${p.nom.padEnd(22)} ${String(p.pop).padStart(9)} hab.  ${String(p.densite).padStart(8)} hab/km²`
  );
}
console.log('');
