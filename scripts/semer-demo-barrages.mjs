/**
 * Semis idempotent de données de démonstration pour les barrages.
 * Ajoute accident_count, lighting_status, data_mode, demo_updated_at.
 * Ne modifie aucune coordonnée ni aucun attribut opérationnel réel.
 */
import fs from 'node:fs';
import path from 'node:path';

const cheminParDefaut = path.resolve('donnees-demo/marquages.json');
const fichier = process.argv[2] ? path.resolve(process.argv[2]) : cheminParDefaut;

if (!fs.existsSync(fichier)) {
  console.error(`Fichier introuvable : ${fichier}`);
  process.exit(1);
}

const brut = fs.readFileSync(fichier, 'utf8');
const data = JSON.parse(brut);
const items = Array.isArray(data) ? data : data.items;

if (!Array.isArray(items)) {
  console.error('Format JSON inattendu (pas d\'items).');
  process.exit(1);
}

let modifiés = 0;
const DEMO_TIMESTAMP = '2026-10-24T12:00:00.000Z';

for (const m of items) {
  const estBarrage = m.type && (m.type.startsWith('barrage') || m.type === 'bcp');
  if (!estBarrage) continue;

  // Calcul d'un pseudo-hash stable et déterministe basé sur l'identifiant
  const idStr = String(m.id || '');
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = (hash * 31 + idStr.charCodeAt(i)) >>> 0;
  }

  const accidentCount = (hash % 11); // 0 à 10 accidents
  const statutsEclairage = ['eclaire', 'non_eclaire', 'inconnu'];
  const lightingStatus = statutsEclairage[hash % 3];

  m.accident_count = accidentCount;
  m.accidentCount = accidentCount;
  m.lighting_status = lightingStatus;
  m.eclairage = lightingStatus === 'eclaire' ? 'oui' : lightingStatus === 'non_eclaire' ? 'non' : 'inconnu';
  m.data_mode = 'DEMO';
  m.demo_updated_at = DEMO_TIMESTAMP;
  modifiés++;
}

fs.writeFileSync(fichier, JSON.stringify(data, null, 2), 'utf8');
console.log(`✓ Semis DEMO appliqué avec succès à ${modifiés} barrages dans ${path.basename(fichier)}.`);
