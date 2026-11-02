import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';

const tempDir = mkdtempSync(join(tmpdir(), 'test-suppression-conflit-'));
const fichier = join(tempDir, 'suivi-conflits.json');

const SESSIONS = {
  admin: { rang: 'admin', unite: 'admin', nom: 'Super Admin', matricule: 'ADM-01' },
  regRabat: { rang: 'reg', unite: 'Rabat', nom: 'CMD Région Rabat', matricule: 'REG-RABAT' },
  regFes: { rang: 'reg', unite: 'Fès', nom: 'CMD Région Fès', matricule: 'REG-FES' },
};

const B_RABAT_1 = { id: 'BF-BT-101', nom: 'Poste Rabat Nord', reg: 'Rabat', route: 'RN1', factionId: 'F1' };
const B_RABAT_2 = { id: 'BF-BT-102', nom: 'Poste Rabat Sud', reg: 'Rabat', route: 'RN1', factionId: 'F1' };
const B_FES_1 = { id: 'BF-BT-201', nom: 'Poste Fès Ouest', reg: 'Fès', route: 'RN8', factionId: 'F2' };
const B_FES_2 = { id: 'BF-BT-202', nom: 'Poste Fès Est', reg: 'Fès', route: 'RN8', factionId: 'F2' };
const B_MARRAKECH_1 = { id: 'BF-BT-301', nom: 'Poste Gueliz', reg: 'Marrakech', route: 'RN9', factionId: 'F1' };
const B_MARRAKECH_2 = { id: 'BF-BT-302', nom: 'Poste Menara', reg: 'Marrakech', route: 'RN9', factionId: 'F1' };

const donneesInitiales = {
  version: 1,
  items: [
    {
      id: 'CONF-RABAT-01',
      numero: 'C-01',
      paireCle: 'BF-BT-101|BF-BT-102',
      barrageAId: 'BF-BT-101',
      barrageBId: 'BF-BT-102',
      barrageA: B_RABAT_1,
      barrageB: B_RABAT_2,
      route: 'RN1',
      distanceKm: 8.5,
      seuilKm: 20,
      statut: 'nouveau',
      historique: [{ date: '2026-10-26T10:00:00Z', action: 'detection', statut: 'nouveau' }],
    },
    {
      id: 'CONF-FES-01',
      numero: 'C-02',
      paireCle: 'BF-BT-201|BF-BT-202',
      barrageAId: 'BF-BT-201',
      barrageBId: 'BF-BT-202',
      barrageA: B_FES_1,
      barrageB: B_FES_2,
      route: 'RN8',
      distanceKm: 11.2,
      seuilKm: 20,
      statut: 'a_traiter',
      assigneA: { rang: 'reg', unite: 'Fès', nom: 'CMD Région Fès' },
      historique: [{ date: '2026-10-26T10:00:00Z', action: 'detection', statut: 'nouveau' }],
    },
    {
      id: 'CONF-MARRAKECH-01',
      numero: 'C-03',
      paireCle: 'BF-BT-301|BF-BT-302',
      barrageAId: 'BF-BT-301',
      barrageBId: 'BF-BT-302',
      barrageA: B_MARRAKECH_1,
      barrageB: B_MARRAKECH_2,
      route: 'RN9',
      distanceKm: 15.0,
      seuilKm: 20,
      statut: 'resolu',
      resoluLe: '2026-10-26T10:15:00Z',
      historique: [{ date: '2026-10-26T10:00:00Z', action: 'detection', statut: 'nouveau' }],
    },
  ],
  supprimes: [],
};

writeFileSync(fichier, JSON.stringify(donneesInitiales, null, 2), 'utf8');

test('1. Suppression manuelle d’un conflit spécifique (Remove)', () => {
  const depot = creerDepotSuiviConflits(fichier);
  assert.equal(depot.tous().length, 3, 'Au départ, 3 conflits enregistrés');

  // Supprimer uniquement le conflit de Rabat
  const res = depot.supprimerConflit({
    conflitId: 'CONF-RABAT-01',
    session: SESSIONS.admin,
  });

  assert.equal(res.ok, true);
  assert.equal(res.id, 'CONF-RABAT-01');

  // Vérifier en mémoire
  assert.equal(depot.tous().length, 2, 'Il doit rester exactement 2 conflits');
  assert.equal(depot.parId('CONF-RABAT-01'), null, 'Le conflit supprimé n’est plus trouvé');
  assert.ok(depot.parId('CONF-FES-01'), 'Le conflit de Fès est intact');
  assert.ok(depot.parId('CONF-MARRAKECH-01'), 'Le conflit de Marrakech est intact');

  // Vérifier la persistance dans le fichier JSON
  const brutDisque = JSON.parse(readFileSync(fichier, 'utf8'));
  assert.equal(brutDisque.items.length, 2, '2 items persistés sur le disque');
  assert.ok(brutDisque.supprimes.includes('CONF-RABAT-01'), 'ID présent dans supprimes');
  assert.ok(brutDisque.supprimes.includes('BF-BT-101|BF-BT-102'), 'Paire présente dans supprimes');
});

test('2. Le conflit supprimé ne réapparaît pas lors des détections automatiques', () => {
  const depot = creerDepotSuiviConflits(fichier);

  const mockDepotBarrages = {
    parId: (id) => [B_RABAT_1, B_RABAT_2, B_FES_1, B_FES_2].find((b) => b.id === id),
    tous: () => [B_RABAT_1, B_RABAT_2, B_FES_1, B_FES_2],
  };

  // Simuler une actualisation sur le barrage B_RABAT_1 qui était en conflit avec B_RABAT_2
  depot.actualiserApresOperation({
    barrageId: B_RABAT_1.id,
    session: SESSIONS.admin,
    action: 'operation',
    depotBarrages: mockDepotBarrages,
    seuilKm: 40,
  });

  // Le conflit supprimé CONF-RABAT-01 ne doit pas être ré-inséré
  assert.equal(depot.tous().length, 2, 'Toujours 2 conflits, Rabat n’est pas ressuscité');
  assert.equal(depot.parPaire(B_RABAT_1.id, B_RABAT_2.id), null);
});

test('3. Les conflits résolus restent visibles pour le Superadmin pour review et approbation', () => {
  const depot = creerDepotSuiviConflits(fichier);
  const visiblesAdmin = depot.visiblesPour(SESSIONS.admin);

  const confResolu = visiblesAdmin.find((c) => c.id === 'CONF-MARRAKECH-01');
  assert.ok(confResolu, 'Le conflit résolu doit être visible pour le Superadmin');
  assert.equal(confResolu.statut, 'resolu');
});

test('4. Les conflits non résolus ne disparaissent pas sans action explicite', () => {
  const depot = creerDepotSuiviConflits(fichier);
  const confFes = depot.parId('CONF-FES-01');
  assert.ok(confFes, 'Conflit Fès présent');
  assert.equal(confFes.statut, 'a_traiter');

  const visiblesRegFes = depot.visiblesPour(SESSIONS.regFes);
  assert.equal(visiblesRegFes.length, 1, 'CMD Région Fès voit son conflit en attente');
});

test.after(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
