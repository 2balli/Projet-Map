/**
 * Suite de vérification complète pour l'audit et les améliorations du Projet Map :
 * 1. Transmission CMD CIE sans erreur (fix de "n is not a function")
 * 2. Persistance de la transmission et statut en base
 * 3. Traitement de conflits par CMD Région et CMD Compagnie
 * 4. Visibilité Superadmin avec comparaison avant / après (déplacement, faction, suppression)
 * 5. Approbation et Rejet par le Superadmin (workflow décisionnel)
 * 6. Séparation stricte des conflits actifs et de l'historique des traitements
 * 7. Cloisonnement strict des rôles (Admin, Région, Compagnie)
 * 8. Données de démonstration (idempotence du semis et nettoyage sans suppression de barrage)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { creerDepotSuiviConflits } from '../serveur/suiviConflits.mjs';
import { creerDepotNotifications } from '../serveur/notifications.mjs';

// Création d'un dossier temporaire isolé pour les tests
const dirTest = path.resolve('tmp-test-audit-' + Date.now());
fs.mkdirSync(dirTest, { recursive: true });

const fichierSuivi = path.join(dirTest, 'suivi-conflits.json');
const fichierNotifs = path.join(dirTest, 'notifications.json');
const fichierBarrages = path.join(dirTest, 'marquages.json');

const sessionAdmin = { matricule: 'SUPERADMIN', nom: 'Super Admin', rang: 'admin', unite: 'admin' };
const sessionReg = { matricule: 'CMD-REG-AGADIR', nom: 'Colonel Agadir', rang: 'reg', unite: 'Agadir' };
const sessionCie = { matricule: 'CMD-CIE-TAROUDANT', nom: 'Capitaine Taroudant', rang: 'cie', unite: 'Taroudant' };
const sessionCieAutre = { matricule: 'CMD-CIE-TIZNIT', nom: 'Capitaine Tiznit', rang: 'cie', unite: 'Tiznit' };

const barragesInitiaux = [
  {
    id: 'B-001',
    nom: 'Poste Nord Agadir',
    route: 'RN1',
    reg: 'Agadir',
    cie: 'Taroudant',
    bt: 'Aoulouz',
    factionId: 'F1',
    lat: 30.5,
    lng: -9.5,
    type: 'barrage_fixe',
  },
  {
    id: 'B-002',
    nom: 'Poste Sud Agadir',
    route: 'RN1',
    reg: 'Agadir',
    cie: 'Taroudant',
    bt: 'Aoulouz',
    factionId: 'F1',
    lat: 30.58,
    lng: -9.52,
    type: 'barrage_mobile',
  },
  {
    id: 'B-003',
    nom: 'Poste Tiznit',
    route: 'RN1',
    reg: 'Agadir',
    cie: 'Tiznit',
    bt: 'Tiznit BT',
    factionId: 'F2',
    lat: 29.7,
    lng: -9.7,
    type: 'barrage_fixe',
  },
];

fs.writeFileSync(fichierBarrages, JSON.stringify({ version: '1.0', items: barragesInitiaux }, null, 2), 'utf8');

const depotBarrages = {
  tous: () => JSON.parse(fs.readFileSync(fichierBarrages, 'utf8')).items,
  parId: (id) => JSON.parse(fs.readFileSync(fichierBarrages, 'utf8')).items.find((x) => x.id === id),
  modifier: (id, diff) => {
    const d = JSON.parse(fs.readFileSync(fichierBarrages, 'utf8'));
    const item = d.items.find((x) => x.id === id);
    if (item) Object.assign(item, diff);
    fs.writeFileSync(fichierBarrages, JSON.stringify(d, null, 2), 'utf8');
    return item;
  },
  supprimer: (id) => {
    const d = JSON.parse(fs.readFileSync(fichierBarrages, 'utf8'));
    d.items = d.items.filter((x) => x.id !== id);
    fs.writeFileSync(fichierBarrages, JSON.stringify(d, null, 2), 'utf8');
  },
};

const depotNotifs = creerDepotNotifications(fichierNotifs);
const depotSuivi = creerDepotSuiviConflits(fichierSuivi);

const depotComptes = {
  tous: () => [
    { matricule: 'CMD-REG-AGADIR', nom: 'Colonel Agadir', rang: 'reg', unite: 'Agadir', region: 'Agadir' },
    { matricule: 'CMD-CIE-TAROUDANT', nom: 'Capitaine Taroudant', rang: 'cie', unite: 'Taroudant', region: 'Agadir' },
    { matricule: 'CMD-CIE-TIZNIT', nom: 'Capitaine Tiznit', rang: 'cie', unite: 'Tiznit', region: 'Agadir' },
  ],
};

test('1. Assignation CMD Région par Superadmin et persistance', () => {
  const res = depotSuivi.assignerConflit({
    conflitId: 'CONF-TEST-01',
    session: sessionAdmin,
    matricule: 'CMD-REG-AGADIR',
    conflitData: {
      id: 'CONF-TEST-01',
      numero: 'C-01',
      barrageAId: 'B-001',
      barrageBId: 'B-002',
      route: 'RN1',
      distanceKm: 9.2,
      seuilKm: 20,
    },
    depotBarrages,
    depotNotifications: depotNotifs,
    comptes: depotComptes,
  });

  assert.ok(res.ok);
  assert.equal(res.conflit.statut, 'a_traiter');
  assert.equal(res.conflit.assigneA.matricule, 'CMD-REG-AGADIR');

  // Vérifier persistance après relecture du disque
  const relu = depotSuivi.parId('CONF-TEST-01');
  assert.ok(relu);
  assert.equal(relu.statut, 'a_traiter');
  assert.equal(relu.assigneA.unite, 'Agadir');
});

test('2. Transmission du conflit par CMD Région au CMD Compagnie (Taroudant)', () => {
  const res = depotSuivi.transmettreConflit({
    conflitId: 'CONF-TEST-01',
    session: sessionReg,
    matricule: 'CMD-CIE-TAROUDANT',
    consigne: 'Veuillez réajuster la position ou décaler la faction.',
    depotBarrages,
    depotNotifications: depotNotifs,
    comptes: depotComptes,
  });

  assert.ok(res.conflit);
  assert.equal(res.conflit.statut, 'en_cours');
  assert.equal(res.conflit.assigneCie.matricule, 'CMD-CIE-TAROUDANT');
  assert.equal(res.conflit.assigneCie.unite, 'Taroudant');

  // L'historique d'audit doit consigner la transmission
  const dernierHisto = res.conflit.historique[res.conflit.historique.length - 1];
  assert.equal(dernierHisto.action, 'transmission_cie');
  assert.equal(dernierHisto.auteur.matricule, 'CMD-REG-AGADIR');
});

test('3. Traitement du conflit par CMD Compagnie (Changement de faction)', () => {
  const res = depotSuivi.traiterConflit({
    conflitId: 'CONF-TEST-01',
    session: sessionCie,
    action: 'changement_faction',
    details: {
      barrageId: 'B-002',
      ancienneFactionId: 'F1',
      ancienneFactionNom: 'Faction 1 (Matin)',
      nouvelleFactionId: 'F3',
      nouvelleFactionNom: 'Faction 3 (Nuit)',
    },
    depotBarrages,
    depotNotifications: depotNotifs,
  });

  assert.equal(res.conflit.statut, 'traite');
  assert.ok(res.conflit.changement);
  assert.equal(res.conflit.changement.type, 'changement_faction');
  assert.equal(res.conflit.changement.avant.factionId, 'F1');
  assert.equal(res.conflit.changement.apres.factionId, 'F3');
  /* Workflow hiérarchique : un traitement de CMD Cie attend la Région. */
  assert.equal(res.conflit.approbation.statut, 'en_attente_reg');

  // Vérifier modification du barrage dans le dépôt
  const b2 = depotBarrages.parId('B-002');
  assert.equal(b2.factionId, 'F3');
});

test('4. Visibilité et Approbation par le Superadmin', () => {
  // Superadmin consulte l'historique
  const visiblesAdmin = depotSuivi.visiblesPour(sessionAdmin);
  const confTraite = visiblesAdmin.find((c) => c.id === 'CONF-TEST-01');
  assert.ok(confTraite);
  assert.equal(confTraite.statut, 'traite');
  assert.equal(confTraite.approbation.statut, 'en_attente_reg');

  /* Le Superadmin ne peut pas sauter l'étape régionale. */
  assert.throws(
    () => depotSuivi.deciderTraitement({ conflitId: 'CONF-TEST-01', session: sessionAdmin, decision: 'approuver', depotNotifications: depotNotifs }),
    (err) => err.code === 409 && /CMD Région/.test(err.message),
  );

  // Le CMD Région valide, puis le Superadmin approuve définitivement
  depotSuivi.deciderTraitement({ conflitId: 'CONF-TEST-01', session: sessionReg, decision: 'approuver', depotNotifications: depotNotifs });
  const resApprobation = depotSuivi.deciderTraitement({
    conflitId: 'CONF-TEST-01',
    session: sessionAdmin,
    decision: 'approuver',
    raison: 'Traitement conforme aux impératifs opérationnels.',
    depotNotifications: depotNotifs,
  });

  /* Clôture définitive : statut distinct de « resolu » (résolution automatique). */
  assert.equal(resApprobation.conflit.statut, 'cloture');
  assert.equal(resApprobation.conflit.approbation.statut, 'approuve');
  assert.equal(resApprobation.conflit.approbation.par.matricule, 'SUPERADMIN');
});

test('5. Déplacement de barrage avec conservation des coordonnées avant / après', () => {
  // Créer un second conflit
  depotSuivi.assignerConflit({
    conflitId: 'CONF-TEST-02',
    session: sessionAdmin,
    matricule: 'CMD-REG-AGADIR',
    conflitData: {
      id: 'CONF-TEST-02',
      numero: 'C-02',
      barrageAId: 'B-001',
      barrageBId: 'B-003',
      route: 'RN1',
      distanceKm: 12.0,
      seuilKm: 20,
    },
    depotBarrages,
    depotNotifications: depotNotifs,
    comptes: depotComptes,
  });

  const resDeplacement = depotSuivi.traiterConflit({
    conflitId: 'CONF-TEST-02',
    session: sessionReg,
    action: 'deplacement',
    details: {
      barrageId: 'B-003',
      latAvant: 29.7,
      lngAvant: -9.7,
      routeAvant: 'RN1',
      latApres: 29.3,
      lngApres: -9.9,
      routeApres: 'RN1',
      distanceApresKm: 26.5,
      resolu: true,
      statut: 'resolu',
      commentaire: 'Déplacement de 14.5 km au sud pour satisfaire le seuil.',
    },
    depotBarrages,
    depotNotifications: depotNotifs,
  });

  assert.equal(resDeplacement.conflit.statut, 'traite');
  assert.equal(resDeplacement.conflit.changement.type, 'deplacement');
  assert.equal(resDeplacement.conflit.changement.avant.lat, 29.7);
  assert.equal(resDeplacement.conflit.changement.apres.lat, 29.3);
  assert.equal(resDeplacement.conflit.statutPhysique, 'resolu');
});

test('6. Suppression de barrage : traçabilité conservée dans l’historique', () => {
  depotSuivi.assignerConflit({
    conflitId: 'CONF-TEST-03',
    session: sessionAdmin,
    matricule: 'CMD-REG-AGADIR',
    conflitData: {
      id: 'CONF-TEST-03',
      numero: 'C-03',
      barrageAId: 'B-002',
      barrageBId: 'B-003',
      route: 'RN1',
      distanceKm: 5.0,
      seuilKm: 20,
    },
    depotBarrages,
    depotNotifications: depotNotifs,
    comptes: depotComptes,
  });

  const resSuppr = depotSuivi.traiterConflit({
    conflitId: 'CONF-TEST-03',
    session: sessionReg,
    action: 'suppression_barrage',
    details: {
      barrageId: 'B-002',
      resolu: true,
      commentaire: 'Poste mobile surnuméraire retiré du dispositif.',
    },
    depotBarrages,
    depotNotifications: depotNotifs,
  });

  assert.equal(resSuppr.conflit.statut, 'traite');
  assert.ok(resSuppr.conflit.changement.barrageSupprime);
  assert.equal(resSuppr.conflit.changement.barrageSupprime.id, 'B-002');
  // Le barrage doit avoir été retiré du dépôt
  assert.equal(depotBarrages.parId('B-002'), undefined);
});

test('7. Cloisonnement strict des rôles (visiblesPour)', () => {
  // CMD Cie Tiznit ne doit pas voir les conflits affectés uniquement à Taroudant
  const visiblesTiznit = depotSuivi.visiblesPour(sessionCieAutre);
  const aTaroudant = visiblesTiznit.find((c) => c.id === 'CONF-TEST-01');
  assert.equal(aTaroudant, undefined, 'La compagnie Tiznit ne doit pas voir un conflit propre à Taroudant');

  // Superadmin voit l’ensemble des dossiers
  const tousAdmin = depotSuivi.visiblesPour(sessionAdmin);
  assert.ok(tousAdmin.length >= 3);
});

test('8. Données DEMO des barrages : semis idempotent et nettoyage propre', () => {
  const fichierDemoTest = path.join(dirTest, 'marquages-demo.json');
  fs.writeFileSync(
    fichierDemoTest,
    JSON.stringify({
      version: '1.0',
      items: [
        { id: 'BAR-DEMO-1', nom: 'Barrage 1', type: 'barrage_fixe', lat: 30, lng: -9 },
        { id: 'BAR-DEMO-2', nom: 'Barrage 2', type: 'barrage_mobile', lat: 31, lng: -8 },
      ],
    }),
    'utf8',
  );

  // Exécution du script de semis
  execSync(`node scripts/semer-demo-barrages.mjs "${fichierDemoTest}"`);

  let data = JSON.parse(fs.readFileSync(fichierDemoTest, 'utf8'));
  const b1 = data.items[0];
  assert.equal(b1.data_mode, 'DEMO');
  assert.ok(typeof b1.accident_count === 'number');
  assert.ok(['eclaire', 'non_eclaire', 'inconnu'].includes(b1.lighting_status));
  const countInitial = b1.accident_count;

  // Re-semis : idempotence stricte
  execSync(`node scripts/semer-demo-barrages.mjs "${fichierDemoTest}"`);
  data = JSON.parse(fs.readFileSync(fichierDemoTest, 'utf8'));
  assert.equal(data.items[0].accident_count, countInitial, 'L’accident count doit rester strictement identique après un second semis');

  // Nettoyage des champs DEMO
  execSync(`node scripts/nettoyer-demo-barrages.mjs "${fichierDemoTest}"`);
  data = JSON.parse(fs.readFileSync(fichierDemoTest, 'utf8'));
  assert.equal(data.items.length, 2, 'Les 2 barrages doivent être préservés');
  assert.equal(data.items[0].data_mode, undefined, 'data_mode doit avoir été supprimé');
  assert.equal(data.items[0].demo_updated_at, undefined, 'demo_updated_at doit avoir été supprimé');
});

// Nettoyage final du dossier temporaire
test.after(() => {
  try {
    fs.rmSync(dirTest, { recursive: true, force: true });
  } catch {}
});
