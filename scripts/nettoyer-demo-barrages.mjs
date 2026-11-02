/**
 * Nettoyage des données de démonstration pour les barrages.
 * Retire les champs DEMO sans supprimer les enregistrements opérationnels réels.
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

let nettoyes = 0;

for (const m of items) {
  if (m.data_mode === 'DEMO') {
    delete m.data_mode;
    delete m.demo_updated_at;
    m.accident_count = null;
    m.accidentCount = 0;
    m.lighting_status = 'inconnu';
    m.eclairage = 'inconnu';
    nettoyes++;
  }
}

fs.writeFileSync(fichier, JSON.stringify(data, null, 2), 'utf8');
console.log(`✓ Données DEMO retirées avec succès de ${nettoyes} barrages dans ${path.basename(fichier)} sans toucher aux enregistrements réels.`);
