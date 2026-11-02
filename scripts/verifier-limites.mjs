#!/usr/bin/env node
/**
 * LES LIMITES TERRITORIALES SUIVENT-ELLES LE ZOOM, ET RIEN D'AUTRE ?
 *
 * Le défaut que ce contrôle empêche est silencieux : une limite qui RESTE
 * après être remonté d'un cran. Rien ne casse, rien n'est signalé — la carte
 * se couvre simplement d'un treillis que personne n'a demandé, et le
 * coupable (un état gardé d'un rendu à l'autre) ne se voit qu'à l'écran.
 *
 * La séquence complète est donc jouée ici, aller ET retour, en vérifiant à
 * chaque cran l'état des TROIS couches — y compris celles qui doivent avoir
 * disparu.
 *
 *   node --test scripts/verifier-limites.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUCHES_LIMITES,
  COUCHE_ECHELON,
  PANE_LIMITES,
  PANE_CONTOUR,
  SEUILS_LIMITES,
  OPACITE_ROLE,
  echelonPourZoom,
  visibiliteLimites,
} from '../src/limitesTerritoriales.js';

const visibles = (zoom, forcees) =>
  COUCHES_LIMITES.filter((c) => visibiliteLimites(zoom, forcees).couches[c].visible);

test("l'échelon suit le zoom, dans les deux sens", () => {
  for (const [zoom, attendu] of [
    [3, 'region'], [5, 'region'], [6, 'region'],
    [7, 'compagnie'], [8, 'compagnie'],
    [9, 'brigade'], [11, 'brigade'], [18, 'brigade'],
  ]) {
    assert.equal(echelonPourZoom(zoom), attendu, `zoom ${zoom}`);
  }
  /* Le niveau déjà calculé par le clustering est accepté tel quel — c'est
     par lui que passe la carte, et `barrage` y désigne l'échelon brigade. */
  assert.equal(echelonPourZoom('barrage'), 'brigade');
  assert.equal(echelonPourZoom('compagnie'), 'compagnie');
  assert.equal(echelonPourZoom('region'), 'region');
});

test('les seuils publiés sont ceux du clustering des barrages', () => {
  assert.equal(echelonPourZoom(SEUILS_LIMITES.COMPAGNIE_MIN), 'compagnie');
  assert.equal(echelonPourZoom(SEUILS_LIMITES.COMPAGNIE_MIN - 1), 'region');
  assert.equal(echelonPourZoom(SEUILS_LIMITES.BRIGADE_MIN), 'brigade');
  assert.equal(echelonPourZoom(SEUILS_LIMITES.BRIGADE_MIN - 1), 'compagnie');
});

test('un seul échelon à la fois — les autres sont éteints', () => {
  const attendu = {
    region: 'circo_reg',
    compagnie: 'circo_cie',
    brigade: 'circo_bt',
  };

  for (const [zoom, echelon] of [[6, 'region'], [8, 'compagnie'], [12, 'brigade']]) {
    const { couches } = visibiliteLimites(zoom);
    for (const cle of COUCHES_LIMITES) {
      const principal = attendu[echelon] === cle;
      const etat = couches[cle];
      assert.equal(etat.visible, principal, `${echelon} / ${cle} visible`);
      assert.equal(etat.opacite, principal ? OPACITE_ROLE.principal : 0, `${echelon} / ${cle}`);
      /* Un seul échelon capte le clic : celui que le zoom désigne. */
      assert.equal(etat.interactif, principal, `${echelon} / ${cle} clic`);
    }
    /* La règle, dite autrement : exactement une couche allumée. */
    assert.equal(COUCHES_LIMITES.filter((c) => couches[c].visible).length, 1);
  }
});

test('rien ne reste affiché après avoir changé d’échelon', () => {
  const sequence = [6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6];
  const vus = sequence.map((z) => visibles(z).join('+'));
  assert.deepEqual(vus, [
    'circo_reg',
    'circo_cie',
    'circo_cie',
    'circo_bt',
    'circo_bt',
    'circo_bt',
    'circo_bt',
    'circo_bt',
    'circo_cie',
    'circo_cie',
    'circo_reg',
  ]);
  /* Jamais deux découpages en même temps, à aucun zoom de la séquence. */
  for (const vu of vus) assert.equal(vu.includes('+'), false, `superposition : ${vu}`);
  /* Le retour est exactement l'aller : à zoom égal, même affichage, qu'on y
     arrive en descendant ou en remontant. */
  for (const zoom of [6, 7, 8, 9, 10]) {
    assert.equal(vus[sequence.indexOf(zoom)], vus[sequence.lastIndexOf(zoom)], `zoom ${zoom}`);
  }
});

test('aucun échelon ne reste allumé en dehors de sa bande', () => {
  /* Balayage complet, cran par cran : c'est ce qui attrape une frontière qui
     « colle » à un seuil précis, invisible sur une séquence choisie. */
  for (let zoom = 3; zoom <= 18; zoom++) {
    const { echelon, couches } = visibiliteLimites(zoom);
    const allumees = COUCHES_LIMITES.filter((c) => couches[c].visible);
    assert.deepEqual(allumees, [COUCHE_ECHELON[echelon]], `zoom ${zoom}`);
  }
});

test('une case cochée force son découpage à tous les zooms', () => {
  const cochee = new Set(['circo_bt']);
  for (const zoom of [3, 6, 7, 8, 9, 14]) {
    const etat = visibiliteLimites(zoom, cochee).couches.circo_bt;
    assert.equal(etat.visible, true, `zoom ${zoom}`);
    assert.equal(etat.opacite, 1, `zoom ${zoom} : pleine force`);
    assert.equal(etat.interactif, true, `zoom ${zoom} : cliquable`);
    assert.equal(etat.force, true);
  }
  /* Décocher rend la main au zoom, sans rien laisser derrière. */
  assert.deepEqual(visibles(6, new Set()), ['circo_reg']);
});

test('aucune dépendance au compte : le zoom règle le détail, pas le droit', () => {
  /**
   * `visibiliteLimites` ne reçoit ni session, ni rang, ni périmètre — et ne
   * peut donc pas servir de filtre d'habilitation. C'est volontaire et c'est
   * vérifié ici : l'autorisation est tenue par `dansSonPerimetre` côté
   * interface et par le serveur, jamais par l'échelle d'affichage.
   */
  assert.equal(visibiliteLimites.length, 2); // (zoom, forcees) et rien d'autre
  for (const zoom of [5, 8, 12]) {
    assert.deepEqual(visibiliteLimites(zoom).couches, visibiliteLimites(zoom, new Set()).couches);
  }
});

test("l'empilement des volets reste dans l'échelle de Leaflet", () => {
  const z = COUCHES_LIMITES.map((c) => PANE_LIMITES[c].zIndex);
  assert.deepEqual(z, [...z].sort((a, b) => a - b), 'région sous compagnie sous brigade');
  assert.ok(PANE_CONTOUR.zIndex > Math.max(...z), 'contour visé au-dessus des échelons');
  /* Entre les vecteurs ordinaires (overlayPane 400) et les marqueurs (600) :
     une limite ne doit jamais recouvrir un repère. */
  assert.ok(Math.min(...z) > 400 && PANE_CONTOUR.zIndex < 600);
  assert.equal(new Set(Object.values(PANE_LIMITES).map((p) => p.nom)).size, COUCHES_LIMITES.length);
});
