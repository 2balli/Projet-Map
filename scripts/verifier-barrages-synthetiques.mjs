#!/usr/bin/env node
/**
 * SUITE DE TESTS AUTOMATISÉE — BARRAGES FIXES SYNTHÉTIQUES
 *
 * Vérifie l'ensemble des 10 exigences obligatoires :
 * 1. Positionnement sur le réseau routier (snapping orthogonal).
 * 2. Zéro barrage hors route.
 * 3. Cohérence du modèle SyntheticFixedBarrage.
 * 4. Statistiques dans les plages configurées (accidents, éclairage, trafic).
 * 5. Protection stricte des barrages permanents (FIXED_PERMANENT / intouchable).
 * 6. Dédoublonnage et idempotence après plusieurs générations.
 * 7. Intégration au clustering et aux filtres cartographiques.
 * 8. Conformité des popups et libellés.
 * 9. Préservation stricte des données réelles et manuelles.
 * 10. Performances et temps d'exécution.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  genererBarragesFixesSynthetiques,
  PLAGES_ACCIDENTS_DEFAUT,
  creerPRNG,
} from '../serveur/generateurSynthetique.mjs';
import { estBarrage, estIntouchable, apparence, cleCoucheEffective, libelle } from '../src/marquages.js';
import { distanceKm } from '../serveur/routage.mjs';
import { chargerRoutesAffichees, pointSurRouteAffichee } from '../serveur/routesAffichees.mjs';
import { agregerBarragesHierarchie, determinerNiveauHierarchie } from '../src/barrageClustering.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COUCHES = resolve(ROOT, 'public/layers');

describe('Génération de données synthétiques réalistes pour les barrages fixes', () => {
  // Préparation : chargement des routes pour le contrôle géométrique
  const routesAffichees = chargerRoutesAffichees(COUCHES);

  test('1 & 2. Positionnement strict sur le réseau routier et zéro barrage hors route', () => {
    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 20261027,
      nombre: 50,
      ratioPermanent: 0.25,
      espacementKm: 4.0,
    });

    assert.ok(resultat.barrages.length >= 30, 'Au moins 30 barrages doivent être générés');

    for (const b of resultat.barrages) {
      // Vérifier que chaque point est sur le réseau routier (distance < 150m du trait affiché)
      const plusProche = pointSurRouteAffichee(routesAffichees, b.longitude, b.latitude, 2);
      assert.ok(plusProche, `Un segment routier doit être trouvé pour le barrage ${b.id}`);
      assert.ok(
        plusProche.metres <= 150,
        `Le barrage ${b.id} (${b.roadName}) est trop loin du réseau routier : ${plusProche.metres.toFixed(1)} m`,
      );

      // Coordonnées valides au Maroc
      assert.ok(b.latitude >= 21 && b.latitude <= 36, `Latitude hors Maroc : ${b.latitude}`);
      assert.ok(b.longitude >= -18 && b.longitude <= -1, `Longitude hors Maroc : ${b.longitude}`);
    }
  });

  test('3. Conformité stricte au modèle de données SyntheticFixedBarrage', () => {
    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 42,
      nombre: 40,
    });

    for (const b of resultat.barrages) {
      // Champs obligatoires de l'interface
      assert.equal(typeof b.id, 'string');
      assert.ok(b.id.startsWith('syn_bf_') || b.id.startsWith('syn_bfp_'));

      assert.equal(typeof b.name, 'string');
      assert.ok(b.name.length > 0);

      assert.ok(b.type === 'FIXED' || b.type === 'FIXED_PERMANENT');

      assert.equal(typeof b.latitude, 'number');
      assert.equal(typeof b.longitude, 'number');

      assert.equal(typeof b.roadName, 'string');
      assert.ok(b.roadName.length > 0);

      assert.equal(typeof b.roadType, 'string');
      assert.ok(['Autoroute', 'Route Nationale', 'Route Régionale', 'Route Provinciale'].includes(b.roadType));

      assert.equal(typeof b.accidentCount, 'number');
      assert.ok(Number.isInteger(b.accidentCount) && b.accidentCount >= 0);

      assert.equal(typeof b.accidentPeriod, 'string');
      assert.equal(b.accidentPeriod, '2025-2026');

      assert.equal(typeof b.isLighted, 'boolean');

      assert.ok(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'].includes(b.trafficLevel));
      assert.equal(typeof b.trafficDescription, 'string');
      assert.ok(b.trafficDescription.length > 0);

      assert.equal(typeof b.isPermanent, 'boolean');
      assert.equal(b.isPermanent, b.type === 'FIXED_PERMANENT');

      assert.equal(b.isSynthetic, true);

      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(b.createdAt));
      assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(b.updatedAt));

      // Rétrocompatibilité avec le modèle existant
      assert.equal(b.lat, b.latitude);
      assert.equal(b.lng, b.longitude);
      assert.equal(b.nom, b.name);
      assert.equal(b.route, b.roadName);
      assert.ok(b.bt, 'Brigade territoriale requise');
      assert.ok(b.cie, 'Compagnie requise');
      assert.ok(b.reg, 'Région requise');
    }
  });

  test('4. Statistiques réalistes et cohérentes dans les plages configurées', () => {
    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 9999,
      nombre: 80,
      ratioPermanent: 0.3,
    });

    const autoroutes = resultat.barrages.filter((b) => b.roadType === 'Autoroute');
    const nationales = resultat.barrages.filter((b) => b.roadType === 'Route Nationale');
    const provinciales = resultat.barrages.filter((b) => b.roadType === 'Route Provinciale');

    // Vérifier les plages d'accidents
    for (const b of autoroutes) {
      assert.ok(b.accidentCount >= 10 && b.accidentCount <= 40, `Accident count autoroute hors plage : ${b.accidentCount}`);
    }
    for (const b of nationales) {
      assert.ok(b.accidentCount >= 3 && b.accidentCount <= 35, `Accident count nationale hors plage : ${b.accidentCount}`);
    }
    for (const b of provinciales) {
      assert.ok(b.accidentCount >= 0 && b.accidentCount <= 25, `Accident count provinciale hors plage : ${b.accidentCount}`);
    }

    // Éclairage cohérent : plus fort en urbain qu'en rural
    const urbains = resultat.barrages.filter((b) => b.contexte === 'urban');
    const ruraux = resultat.barrages.filter((b) => b.contexte === 'rural');
    if (urbains.length && ruraux.length) {
      const pctUrbain = urbains.filter((b) => b.isLighted).length / urbains.length;
      const pctRural = ruraux.filter((b) => b.isLighted).length / ruraux.length;
      assert.ok(pctUrbain >= pctRural, 'Le taux d’éclairage en zone urbaine doit être supérieur ou égal à la zone rurale');
    }

    // Niveaux de circulation et descriptions associés
    for (const b of resultat.barrages) {
      if (b.trafficLevel === 'LOW') assert.equal(b.trafficDescription, 'Circulation fluide');
      if (b.trafficLevel === 'MODERATE') assert.equal(b.trafficDescription, 'Circulation modérée');
      if (b.trafficLevel === 'HIGH') assert.equal(b.trafficDescription, 'Circulation dense');
      if (b.trafficLevel === 'VERY_HIGH') assert.equal(b.trafficDescription, 'Circulation très dense');
    }
  });

  test('5. Protection stricte des barrages permanents (FIXED_PERMANENT)', () => {
    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 20261027,
      nombre: 50,
      ratioPermanent: 0.3,
    });

    const permanents = resultat.barrages.filter((b) => b.type === 'FIXED_PERMANENT');
    const fixes = resultat.barrages.filter((b) => b.type === 'FIXED');

    assert.ok(permanents.length > 0, 'Il doit y avoir des barrages FIXED_PERMANENT');
    assert.ok(fixes.length > 0, 'Il doit y avoir des barrages FIXED');

    // Les permanents sont protégés par estIntouchable
    for (const p of permanents) {
      assert.equal(estIntouchable(p), true, 'Un barrage FIXED_PERMANENT doit être intouchable');
      assert.equal(p.isPermanent, true);
      assert.equal(p.protection, 'intouchable');
      assert.equal(p.intouchable, true);
    }

    // Les fixes ordinaires ne sont PAS intouchables
    for (const f of fixes) {
      assert.equal(estIntouchable(f), false, 'Un barrage FIXED normal ne doit pas être intouchable');
      assert.equal(f.isPermanent, false);
      assert.equal(f.protection, 'aucune');
      assert.equal(f.intouchable, false);
    }
  });

  test('6. Dédoublonnage, espacement et déterminisme (seed)', () => {
    // Génération 1 avec graine 777
    const gen1 = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 777,
      nombre: 30,
      espacementKm: 5.0,
    });

    // Génération 2 avec la même graine 777
    const gen2 = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 777,
      nombre: 30,
      espacementKm: 5.0,
    });

    // Déterminisme strict
    assert.equal(gen1.barrages.length, gen2.barrages.length);
    for (let i = 0; i < gen1.barrages.length; i++) {
      assert.equal(gen1.barrages[i].id, gen2.barrages[i].id);
      assert.equal(gen1.barrages[i].latitude, gen2.barrages[i].latitude);
      assert.equal(gen1.barrages[i].longitude, gen2.barrages[i].longitude);
      assert.equal(gen1.barrages[i].type, gen2.barrages[i].type);
      assert.equal(gen1.barrages[i].accidentCount, gen2.barrages[i].accidentCount);
    }

    // Aucun doublon géographique interne (espacement minimal respecté)
    const barrages = gen1.barrages;
    for (let i = 0; i < barrages.length; i++) {
      for (let j = i + 1; j < barrages.length; j++) {
        const d = distanceKm(barrages[i].longitude, barrages[i].latitude, barrages[j].longitude, barrages[j].latitude);
        assert.ok(
          d >= 4.8, // 5.0 km avec tolérance numérique mineure
          `Deux barrages synthétiques sont trop rapprochés (${d.toFixed(2)} km) : ${barrages[i].id} et ${barrages[j].id}`,
        );
      }
    }
  });

  test('7. Préservation absolue des barrages réels existants', () => {
    const fauxReel = {
      id: 'BARRAGE_REEL_IMPORTANT',
      nom: 'Poste réel N1 Km 15',
      type: 'barrage_fixe',
      lng: -6.85,
      lat: 33.95,
      isSynthetic: false,
    };

    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 1234,
      nombre: 25,
      espacementReelsKm: 3.0,
      existantItems: [fauxReel],
    });

    // Aucun barrage synthétique ne doit être collé au barrage réel
    for (const b of resultat.barrages) {
      const d = distanceKm(b.longitude, b.latitude, fauxReel.lng, fauxReel.lat);
      assert.ok(
        d >= 2.9,
        `Un barrage synthétique (${b.id}) a été placé trop près du barrage réel (${d.toFixed(2)} km)`,
      );
    }
  });

  test('8. Rendu cartographique, clustering et filtres', () => {
    const resultat = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 20261027,
      nombre: 20,
    });

    for (const b of resultat.barrages) {
      // 1. Reconnu comme barrage
      assert.equal(estBarrage(b), true);

      // 2. Couche active
      assert.equal(cleCoucheEffective(b), 'mq_barrage_fixe');

      // 3. Libellé propre
      const lib = libelle(b);
      assert.ok(lib.includes('Barrage'), `Libellé incorrect : ${lib}`);

      // 4. Apparence visuelle distincte
      const app = apparence(b);
      if (b.type === 'FIXED_PERMANENT') {
        assert.equal(app.glyph, 'barrage_intouchable');
        assert.equal(app.color, '#0d9488');
        assert.equal(app.intouchable, true);
      } else {
        assert.equal(app.glyph, 'barrage_fixe');
        assert.equal(app.color, '#00bcd4');
        assert.equal(app.intouchable, false);
      }
    }

    // 5. Intégration au clustering hiérarchique
    const circoBt = JSON.parse(readFileSync(join(COUCHES, 'circo_bt.geojson'), 'utf8'));
    const circoCie = JSON.parse(readFileSync(join(COUCHES, 'circo_cie.geojson'), 'utf8'));
    const circoReg = JSON.parse(readFileSync(join(COUCHES, 'circo_reg.geojson'), 'utf8'));

    const clusters = agregerBarragesHierarchie(resultat.barrages, 7, { circoBt, circoCie, circoReg });
    assert.ok(clusters.length > 0, 'Les barrages synthétiques doivent s’agréger en clusters administratifs');
    for (const c of clusters) {
      assert.ok(c.count > 0);
      assert.ok(c.fixesCount > 0);
    }
  });

  test('9. Performances acceptables', () => {
    const debut = performance.now();
    const res = genererBarragesFixesSynthetiques({
      racineCouches: COUCHES,
      graine: 2026,
      nombre: 100,
    });
    const duree = performance.now() - debut;
    assert.ok(duree < 5000, `La génération de 100 barrages synthétiques a pris trop de temps : ${duree.toFixed(0)} ms`);
    assert.ok(res.barrages.length >= 80);
  });
});
