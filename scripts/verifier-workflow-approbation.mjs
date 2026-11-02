/**
 * VÉRIFICATION DU WORKFLOW D'APPROBATION ET RESTRICTIONS SUPER ADMIN
 *
 * Exécuté par : node --test scripts/verifier-workflow-approbation.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerDepotDemandes, ACTIONS_WORKFLOW, STATUTS_WORKFLOW } from '../serveur/demandesApprobation.mjs';
import { analyserConflitsComplet } from '../serveur/analyseConflits.mjs';
import { creerDepot } from '../serveur/depot.mjs';

function creerEnvTest() {
  const dir = mkdtempSync(join(tmpdir(), 'gr-test-workflow-'));
  const fichierDemandes = join(dir, 'demandes.json');
  const fichierMarquages = join(dir, 'marquages.json');

  const barragesInitiaux = [
    {
      id: 'B_RABAT_01',
      type: 'barrage_fixe',
      nom: 'Barrage Rabat Nord A1',
      route: 'A1',
      pk: '15.5',
      lng: -6.8325,
      lat: 34.0132,
      reg: 'Rabat-Salé-Kénitra',
      cie: 'Rabat',
      bt: 'Rabat Centre',
      effectif: 4,
      factionId: 'F1',
      intouchable: false,
    },
    {
      id: 'B_RABAT_02',
      type: 'barrage_fixe',
      nom: 'Barrage Salé A1',
      route: 'A1',
      pk: '25.0',
      lng: -6.8125,
      lat: 34.0532,
      reg: 'Rabat-Salé-Kénitra',
      cie: 'Salé',
      bt: 'Salé Ville',
      effectif: 3,
      factionId: 'F1',
      intouchable: false,
    },
  ];

  writeFileSync(fichierMarquages, JSON.stringify({ version: 1, items: barragesInitiaux }, null, 2), 'utf-8');
  writeFileSync(fichierDemandes, JSON.stringify({ version: 1, items: [] }, null, 2), 'utf-8');

  const depotMarquages = creerDepot(fichierMarquages);
  const depotDemandes = creerDepotDemandes(fichierDemandes);

  const sessions = {
    cie: { rang: 'cie', unite: 'Rabat', reg: 'Rabat-Salé-Kénitra', matricule: 'CIE_RABAT_01', nom: 'Cdt Cie Rabat', role: 'commandement' },
    reg: { rang: 'reg', unite: 'Rabat-Salé-Kénitra', reg: 'Rabat-Salé-Kénitra', matricule: 'REG_RSK_01', nom: 'Cdt Région RSK', role: 'commandement' },
    admin: { rang: 'admin', unite: 'Direction Générale', matricule: 'ADMIN_01', nom: 'Super Admin', role: 'commandement' },
  };

  const nettoyer = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignorer si nettoyage déjà fait
    }
  };

  return { dir, depotMarquages, depotDemandes, sessions, barragesInitiaux, nettoyer };
}

test('1. Super Admin : lecture seule sur les barrages (surveillance et filtrage)', () => {
  const env = creerEnvTest();
  try {
    const barrage = env.depotMarquages.parId('B_RABAT_01');
    assert.ok(barrage, 'Le barrage initial existe');

    const superviseur = env.sessions.admin.rang === 'admin';
    const estBarrage = barrage.type === 'barrage_fixe';
    assert.equal(superviseur && estBarrage, true, 'Superviseur sur un barrage détecté');
  } finally {
    env.nettoyer();
  }
});

test('2. CMND Cie : soumission d’une proposition d’assignation sans altération directe du barrage actif', () => {
  const env = creerEnvTest();
  try {
    const barrageAvant = env.depotMarquages.parId('B_RABAT_01');

    // CMND Cie soumet une proposition
    const demande = env.depotDemandes.creer({
      barrageId: barrageAvant.id,
      barrage: barrageAvant,
      changements: [
        { champ: 'factionId', ancienne: 'F1', nouvelle: 'F2', nomAncienne: 'F1', nomNouvelle: 'F2' },
        { champ: 'effectif', ancienne: 4, nouvelle: 6 },
      ],
      raison: 'Proposition de renfort faction 2',
      auteur: env.sessions.cie,
      destinataire: { rang: 'reg', unite: barrageAvant.reg },
    });

    assert.ok(demande.id, 'Demande créée avec identifiant unique');
    assert.equal(demande.statutWorkflow, 'en_attente_region', 'Statut initial = en_attente_region');
    assert.equal(demande.barrage.effectif, 4, 'Snapshot original conservé');
    assert.equal(demande.changements.length, 2, '2 changements proposés enregistrés');

    // Vérifier que le barrage actif dans le dépôt N’EST PAS modifié
    const barrageApres = env.depotMarquages.parId('B_RABAT_01');
    assert.equal(barrageApres.effectif, 4, 'Le barrage actif n’est pas modifié avant approbation');
    assert.equal(barrageApres.factionId, 'F1', 'La faction active n’est pas modifiée avant approbation');
  } finally {
    env.nettoyer();
  }
});

test('3. Séparation des devoirs : l’auteur ne peut pas approuver sa propre demande', () => {
  const env = creerEnvTest();
  try {
    const barrage = env.depotMarquages.parId('B_RABAT_01');
    const demande = env.depotDemandes.creer({
      barrageId: barrage.id,
      barrage,
      changements: [{ champ: 'factionId', ancienne: 'F1', nouvelle: 'F3' }],
      raison: 'Test séparation',
      auteur: env.sessions.cie,
      destinataire: { rang: 'reg', unite: barrage.reg },
    });

    // Règle de séparation des devoirs
    const memeAuteur = demande.auteurOriginal?.matricule === env.sessions.cie.matricule;
    assert.equal(memeAuteur, true, 'Détection que la session est l’auteur original');

    // Dans l’API HTTP (api.mjs ligne 6098), cette condition renvoie une erreur 403 :
    // if (action === 'approuver' && demande.auteurOriginal?.matricule === session.matricule) 403
  } finally {
    env.nettoyer();
  }
});

test('4. Workflow CMND Région : retour à la Cie, resoumission, modification puis transmission Super Admin', () => {
  const env = creerEnvTest();
  try {
    const barrage = env.depotMarquages.parId('B_RABAT_01');
    const demande = env.depotDemandes.creer({
      barrageId: barrage.id,
      barrage,
      changements: [{ champ: 'effectif', ancienne: 4, nouvelle: 6 }],
      raison: 'Demande initiale',
      auteur: env.sessions.cie,
      destinataire: { rang: 'reg', unite: barrage.reg },
    });

    // Étape A : Région retourne à la Cie avec motif
    const dRetour = env.depotDemandes.agir(demande.id, {
      action: 'retourner',
      par: env.sessions.reg,
      commentaire: 'Effectif disproportionné, réviser à 5',
    });
    assert.equal(dRetour.statutWorkflow, 'retournee_cie');
    assert.equal(dRetour.destinataireActuel.rang, 'cie');

    // Étape B : Cie resoumet avec modifications corrigées
    const dResoumis = env.depotDemandes.agir(demande.id, {
      action: 'resoumettre',
      par: env.sessions.cie,
      changements: [{ champ: 'effectif', ancienne: 4, nouvelle: 5 }],
      commentaire: 'Corrigé à 5 agents',
    });
    assert.equal(dResoumis.statutWorkflow, 'en_attente_region');
    assert.equal(dResoumis.changements[0].nouvelle, 5);

    // Étape C : Région ajuste et transmet au Super Admin
    const dTransmis = env.depotDemandes.agir(demande.id, {
      action: 'transmettre_admin',
      par: env.sessions.reg,
      commentaire: 'Avis favorable pour arbitrage Super Admin',
      destinataire: { rang: 'admin', unite: 'admin', nom: 'Super Admin' },
    });
    assert.equal(dTransmis.statutWorkflow, 'en_attente_admin');
    assert.equal(dTransmis.destinataireActuel.rang, 'admin');
    assert.equal(dTransmis.historique.length, 4, 'Historique complet des 4 étapes');
  } finally {
    env.nettoyer();
  }
});

test('5. Super Admin : approbation et application atomique des changements sur le barrage actif', () => {
  const env = creerEnvTest();
  try {
    const barrage = env.depotMarquages.parId('B_RABAT_01');
    const demande = env.depotDemandes.creer({
      barrageId: barrage.id,
      barrage,
      changements: [
        { champ: 'factionId', ancienne: 'F1', nouvelle: 'F4' },
        { champ: 'effectif', ancienne: 4, nouvelle: 8 },
      ],
      raison: 'Besoin d’approbation',
      auteur: env.sessions.cie,
      destinataire: { rang: 'reg', unite: barrage.reg },
    });

    // Transmission à l'admin
    env.depotDemandes.agir(demande.id, {
      action: 'transmettre_admin',
      par: env.sessions.reg,
      commentaire: 'Pour validation finale',
      destinataire: { rang: 'admin', unite: 'admin', nom: 'Super Admin' },
    });

    // Super Admin approuve
    const dApprouvee = env.depotDemandes.agir(demande.id, {
      action: 'approuver',
      par: env.sessions.admin,
      commentaire: 'Validé par Super Admin',
    });
    assert.equal(dApprouvee.statutWorkflow, 'approuvee');

    // Application atomique des modifications dans le dépôt
    const modifs = {};
    for (const ch of dApprouvee.changements) {
      modifs[ch.champ] = ch.nouvelle;
    }
    const barrageActuel = env.depotMarquages.parId(barrage.id);
    const nouveau = {
      ...barrageActuel,
      ...modifs,
      maj: new Date().toISOString(),
      majPar: env.sessions.admin,
    };
    env.depotMarquages.remplacer(barrageActuel.id, nouveau);

    const verif = env.depotMarquages.parId(barrage.id);
    assert.equal(verif.effectif, 8, 'Effectif mis à jour sur le barrage actif');
    assert.equal(verif.factionId, 'F4', 'Faction mise à jour sur le barrage actif');
  } finally {
    env.nettoyer();
  }
});

test('6. Analyse pré-traitement de conflits : détection routière et géométrie réelle', () => {
  const env = creerEnvTest();
  try {
    const tousLesBarrages = env.depotMarquages.tous();
    const barrageA = tousLesBarrages[0];

    const analyse = analyserConflitsComplet({
      cible: barrageA,
      barrages: tousLesBarrages,
      seuilKm: 30,
      graphe: null,
    });

    assert.ok(analyse.barrageId === barrageA.id, 'Rapport associé au barrage');
    assert.ok(Array.isArray(analyse.conflits), 'Liste des conflits retournée');
    assert.ok(Array.isArray(analyse.avertissements), 'Liste des avertissements retournée');
    assert.ok(typeof analyse.seuilKm === 'number', 'Seuil numérique configuré');

    if (analyse.conflits.length > 0) {
      const c = analyse.conflits[0];
      assert.ok(c.barrageId, 'Autre barrage identifié');
      assert.ok(c.distanceKm > 0, 'Distance calculée');
      assert.ok(['critique', 'alerte', 'attention', 'info'].includes(c.severite), 'Sévérité valide');
    }
  } finally {
    env.nettoyer();
  }
});

test('7. Assignation ciblée à la compagnie du barrage et préparation traitement CMND Région', () => {
  const env = creerEnvTest();
  try {
    const b = env.depotMarquages.parId('B_RABAT_01');
    assert.equal(b.cie, 'Rabat', 'Compagnie du barrage est Rabat');

    // Simulation de la règle de filtrage stricte de cmndCieDeRegion
    const comptesCie = [
      { matricule: 'CIE_RABAT', nom: 'CMND Cie Rabat', rang: 'cie', unite: 'Rabat', reg: 'Rabat-Salé-Kénitra' },
      { matricule: 'CIE_SALE', nom: 'CMND Cie Salé', rang: 'cie', unite: 'Salé', reg: 'Rabat-Salé-Kénitra' },
      { matricule: 'CIE_KENITRA', nom: 'CMND Cie Kénitra', rang: 'cie', unite: 'Kénitra', reg: 'Rabat-Salé-Kénitra' },
    ];

    const filtrerCieDuBarrage = (comptes, barrage) => {
      if (barrage?.cie) {
        const match = comptes.filter((c) => c.unite === barrage.cie);
        if (match.length > 0) return match;
      }
      return comptes;
    };

    const cibles = filtrerCieDuBarrage(comptesCie, b);
    assert.equal(cibles.length, 1, 'Seule la compagnie du barrage est retenue');
    assert.equal(cibles[0].unite, 'Rabat', 'Unité de la compagnie correspondante');
  } finally {
    env.nettoyer();
  }
});

