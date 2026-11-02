#!/usr/bin/env node
/**
 * LE JEU FICTIF TIENT-IL DEBOUT ?
 *
 * Un jeu d'épreuve faux se remarque tout de suite ; un jeu d'épreuve
 * INCOHÉRENT ne se remarque pas du tout — et c'est lui qui fait perdre des
 * journées. Un barrage rattaché à une brigade qui n'existe pas, un repère
 * tombé dans la circonscription voisine, un matricule qui ressemble à un vrai :
 * l'application affiche tout cela sans broncher, et l'on croit tenir une
 * anomalie d'interface alors qu'on regarde un défaut du jeu.
 *
 * Ce contrôle vérifie donc les trois choses qu'aucun écran ne montre :
 *   — les RATTACHEMENTS, de la relève jusqu'à la région ;
 *   — la GÉOGRAPHIE : chaque repère dans le contour de SA brigade ;
 *   — le MARQUAGE « DEMO », sur chaque identité et chaque identifiant.
 *
 * Et il refait deux fois le même tirage : sans déterminisme, une épreuve qui
 * échoue une fois sur trois n'apprend rien.
 *
 *   node --test scripts/verifier-fictif.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanPointInPolygon } from '@turf/turf';

import { creerJeuFictif, lireDecoupages, GRADES } from '../src/donnees/fictif/generateur.js';
import {
  TYPE_PAR_CLE, STATUTS_BARRAGE, valide, perimetreImpose, dansSaPortee, niveauPortee,
  porteeCourante, dansLaPortee,
} from '../src/marquages.js';
import { GRADES as GRADES_SERVEUR } from '../serveur/elements.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const couche = (nom) =>
  JSON.parse(readFileSync(join(ROOT, 'public', 'layers', `${nom}.geojson`), 'utf8'));

const DECOUPAGES = lireDecoupages({
  circoBt: couche('circo_bt'),
  circoCie: couche('circo_cie'),
  circoReg: couche('circo_reg'),
});

const CONFIG = {
  graine: 42,
  regions: 'toutes',
  compagniesParRegion: 'toutes',
  brigadesParCompagnie: 'toutes',
  effectifsParBrigade: [20, 30],
  barragesParBrigade: [3, 8],
  dateReference: '2026-09-18',
};

const JEU = creerJeuFictif(DECOUPAGES, CONFIG);

test('le volume couvre le découpage réel et dépasse le minimum demandé', () => {
  const { resume } = JEU;
  assert.ok(resume.regions >= 3, `régions : ${resume.regions}`);
  assert.ok(resume.compagnies >= 6, `compagnies : ${resume.compagnies}`);
  assert.ok(resume.brigades >= 18, `brigades : ${resume.brigades}`);
  /* Le découpage réel compte 504 brigades : le jeu complet doit toutes les
     servir, sinon des pans entiers de la carte restent muets. */
  assert.equal(resume.brigades, DECOUPAGES.brigades.length);
  assert.ok(resume.effectifs >= resume.brigades * 20);
  assert.ok(resume.barrages >= resume.brigades * 3);
});

test("l'échelle réduite reste utilisable, et respecte ses bornes", () => {
  const petit = creerJeuFictif(DECOUPAGES, {
    ...CONFIG, regions: 3, compagniesParRegion: 2, brigadesParCompagnie: 3,
  });
  assert.equal(petit.resume.regions, 3);
  assert.ok(petit.resume.compagnies <= 6, `compagnies : ${petit.resume.compagnies}`);
  assert.ok(petit.resume.brigades <= 18, `brigades : ${petit.resume.brigades}`);
  assert.ok(petit.resume.barrages > 0 && petit.resume.effectifs > 0);
});

test('chaque enfant connaît son parent, jusqu’à la région', () => {
  const regions = new Set(JEU.regions.map((r) => r.nom));
  const compagnies = new Map(JEU.compagnies.map((c) => [c.nom, c]));
  const brigades = new Map(JEU.brigades.map((b) => [b.nom, b]));
  const barrages = new Map(JEU.barrages.map((b) => [b.id, b]));

  for (const c of JEU.compagnies) assert.ok(regions.has(c.reg), `compagnie ${c.nom}`);
  for (const b of JEU.brigades) {
    assert.ok(compagnies.has(b.cie), `brigade ${b.nom} → compagnie ${b.cie}`);
    assert.equal(compagnies.get(b.cie).reg, b.reg, `brigade ${b.nom} : région incohérente`);
  }
  for (const e of JEU.effectifs) {
    const b = brigades.get(e.bt);
    assert.ok(b, `élément ${e.matricule} → brigade ${e.bt}`);
    assert.deepEqual([e.cie, e.reg], [b.cie, b.reg], `élément ${e.matricule}`);
  }
  for (const m of JEU.barrages) {
    const b = brigades.get(m.bt);
    assert.ok(b, `barrage ${m.id} → brigade ${m.bt}`);
    assert.deepEqual([m.cie, m.reg], [b.cie, b.reg], `barrage ${m.id}`);
  }
  for (const r of JEU.elements) {
    assert.ok(barrages.has(r.barrageId), `relève ${r.id} → poste ${r.barrageId}`);
  }
});

test('chaque repère tombe dans le contour de SA brigade', () => {
  const contours = new Map(DECOUPAGES.brigades.map((b) => [b.nom, b.feature]));
  const dehors = JEU.barrages.filter((m) => {
    const f = contours.get(m.bt);
    return !f || !booleanPointInPolygon([m.lng, m.lat], f);
  });
  assert.equal(dehors.length, 0, `${dehors.length} repère(s) hors zone, ex. ${dehors[0]?.id}`);
});

test('même graine, même jeu — graine différente, autre jeu', () => {
  const bis = creerJeuFictif(DECOUPAGES, CONFIG);
  assert.deepEqual(bis.resume, JEU.resume);
  assert.equal(JSON.stringify(bis.barrages), JSON.stringify(JEU.barrages));
  assert.equal(JSON.stringify(bis.effectifs), JSON.stringify(JEU.effectifs));

  const autre = creerJeuFictif(DECOUPAGES, { ...CONFIG, graine: 7 });
  assert.notEqual(JSON.stringify(autre.barrages), JSON.stringify(JEU.barrages));
});

test('les valeurs employées existent dans l’application', () => {
  const statuts = new Set(STATUTS_BARRAGE.map((s) => s.code));
  for (const m of JEU.barrages) {
    assert.ok(TYPE_PAR_CLE[m.type], `type inconnu : ${m.type}`);
    assert.ok(statuts.has(m.statutBarrage), `statut inventé : ${m.statutBarrage}`);
    /* `valide` est le contrôle que la carte applique à tout repère reçu. */
    assert.ok(valide(m), `repère refusé par marquages.valide : ${m.id}`);
  }
  /* Les grades du jeu doivent être ceux du serveur, pas une liste parallèle :
     un « BRIG » inventé passerait l'affichage et casserait la relève. */
  assert.deepEqual([...GRADES].sort(), [...GRADES_SERVEUR].sort());
  for (const e of JEU.effectifs) assert.ok(GRADES.includes(e.grade), `grade : ${e.grade}`);
  for (const r of JEU.elements) assert.ok(GRADES.includes(r.grade), `grade relève : ${r.grade}`);
});

test('aucune identité ne peut passer pour réelle', () => {
  for (const e of JEU.effectifs) {
    assert.match(e.matricule, /^DEMO-\d{5}$/, `matricule : ${e.matricule}`);
    assert.match(e.nom, / DEMO$/, `nom : ${e.nom}`);
    assert.equal(e.demo, true);
  }
  for (const m of JEU.barrages) {
    assert.match(m.id, /^BAR-\d{4}$/, `identifiant : ${m.id}`);
    assert.match(m.nom, /DEMO/, `nom de poste : ${m.nom}`);
    assert.equal(m.demo, true);
  }
  for (const r of JEU.elements) assert.match(r.matricule, /^DEMO-/);
  /* Le jeu ne doit contenir aucun matricule au format réel (G + 5 chiffres). */
  const suspects = JEU.effectifs.filter((e) => /^G\d{5}$/i.test(e.matricule));
  assert.equal(suspects.length, 0);
});

test('le cloisonnement découpe le jeu comme il découpe le réel', () => {
  /**
   * La même fonction que l'application — c'est tout l'intérêt : si le mode
   * fictif filtrait autrement, il ne servirait pas à éprouver le RBAC.
   */
  const filtre = (session) => {
    const p = perimetreImpose(session);
    return p ? JEU.barrages.filter((m) => m[p.champ] === p.unite) : JEU.barrages;
  };

  const brigade = JEU.brigades[0];
  const parRang = {
    admin: filtre({ rang: 'admin', unite: 'DEMO-ADMIN' }),
    reg: filtre({ rang: 'reg', unite: brigade.reg }),
    cie: filtre({ rang: 'cie', unite: brigade.cie }),
    unite: filtre({ rang: 'unite', unite: brigade.nom }),
  };

  assert.equal(parRang.admin.length, JEU.barrages.length);
  assert.ok(parRang.reg.length < parRang.admin.length);
  assert.ok(parRang.cie.length <= parRang.reg.length);
  assert.ok(parRang.unite.length <= parRang.cie.length);
  assert.ok(parRang.unite.length > 0, 'la brigade éprouvée doit tenir au moins un poste');

  /* Et surtout : rien qui dépasse. */
  assert.ok(parRang.reg.every((m) => m.reg === brigade.reg));
  assert.ok(parRang.cie.every((m) => m.cie === brigade.cie));
  assert.ok(parRang.unite.every((m) => m.bt === brigade.nom));
});

/* ================================================================== */
/*  RBAC — la matrice complète, rang par rang                         */
/* ================================================================== */

/**
 * Les comptes d'épreuve sont pris DANS le jeu : une région qui contient
 * plusieurs compagnies, une compagnie qui contient plusieurs brigades. Éprouver
 * le cloisonnement sur une unité unique ne prouverait rien — tout y est à la
 * fois dedans et au bord.
 */
const REGION = JEU.regions.find((r) => JEU.compagnies.filter((c) => c.reg === r.nom).length > 1);
const COMPAGNIE = JEU.compagnies.find(
  (c) => c.reg === REGION.nom && JEU.brigades.filter((b) => b.cie === c.nom).length > 1,
);
const BRIGADE = JEU.brigades.find((b) => b.cie === COMPAGNIE.nom);

const SESSIONS = {
  admin: { rang: 'admin', unite: 'DEMO-ADMIN', reg: null, cie: null },
  reg: { rang: 'reg', unite: REGION.nom, reg: REGION.nom, cie: null },
  cie: { rang: 'cie', unite: COMPAGNIE.nom, reg: COMPAGNIE.reg, cie: COMPAGNIE.nom },
  unite: { rang: 'unite', unite: BRIGADE.nom, reg: BRIGADE.reg, cie: BRIGADE.cie },
};

/** Ce que chaque rang voit des EFFECTIFS — la règle appliquée aux données. */
const effectifsVus = (session) => {
  const p = perimetreImpose(session);
  return p ? JEU.effectifs.filter((e) => e[p.champ] === p.unite) : JEU.effectifs;
};

test('CMD_BRIGADE ne voit que les effectifs de sa brigade', () => {
  const vus = effectifsVus(SESSIONS.unite);
  assert.ok(vus.length >= 20, `effectifs de la brigade : ${vus.length}`);
  assert.ok(vus.every((e) => e.bt === BRIGADE.nom));
  /* Ni une autre brigade de sa compagnie, ni une autre compagnie, ni une
     autre région : les trois fuites possibles, vérifiées séparément. */
  const autreBt = JEU.brigades.find((b) => b.cie === BRIGADE.cie && b.nom !== BRIGADE.nom);
  assert.equal(vus.filter((e) => e.bt === autreBt.nom).length, 0);
  assert.equal(vus.filter((e) => e.cie !== BRIGADE.cie).length, 0);
  assert.equal(vus.filter((e) => e.reg !== BRIGADE.reg).length, 0);
  assert.equal(niveauPortee(SESSIONS.unite), 'brigade');
});

test('CMD_COMPAGNIE voit toutes ses brigades, et rien au-delà', () => {
  const vus = effectifsVus(SESSIONS.cie);
  const siennes = JEU.brigades.filter((b) => b.cie === COMPAGNIE.nom).map((b) => b.nom);
  assert.ok(siennes.length > 1);
  /* Chaque brigade de la compagnie est représentée : une vue « compagnie »
     qui oublierait une brigade serait pire qu'une vue vide. */
  for (const bt of siennes) assert.ok(vus.some((e) => e.bt === bt), `brigade absente : ${bt}`);
  assert.ok(vus.every((e) => e.cie === COMPAGNIE.nom));
  assert.ok(vus.length > effectifsVus(SESSIONS.unite).length);
  const autreCie = JEU.compagnies.find((c) => c.nom !== COMPAGNIE.nom);
  assert.equal(vus.filter((e) => e.cie === autreCie.nom).length, 0);
});

test('CMD_REGION voit ses compagnies et leurs brigades, et rien au-delà', () => {
  const vus = effectifsVus(SESSIONS.reg);
  const siennes = JEU.compagnies.filter((c) => c.reg === REGION.nom).map((c) => c.nom);
  assert.ok(siennes.length > 1);
  for (const cie of siennes) assert.ok(vus.some((e) => e.cie === cie), `compagnie absente : ${cie}`);
  assert.ok(vus.every((e) => e.reg === REGION.nom));
  assert.ok(vus.length > effectifsVus(SESSIONS.cie).length);
  const autreRegion = JEU.regions.find((r) => r.nom !== REGION.nom);
  assert.equal(vus.filter((e) => e.reg === autreRegion.nom).length, 0);
});

test('ADMIN garde la vue globale', () => {
  assert.equal(effectifsVus(SESSIONS.admin).length, JEU.effectifs.length);
  assert.equal(niveauPortee(SESSIONS.admin), 'national');
});

test('les portées s’emboîtent strictement : brigade ⊂ compagnie ⊂ région ⊂ national', () => {
  const [bt, cie, reg, tout] = ['unite', 'cie', 'reg', 'admin'].map((r) =>
    new Set(effectifsVus(SESSIONS[r]).map((e) => e.matricule)),
  );
  for (const m of bt) assert.ok(cie.has(m), `brigade hors compagnie : ${m}`);
  for (const m of cie) assert.ok(reg.has(m), `compagnie hors région : ${m}`);
  for (const m of reg) assert.ok(tout.has(m), `région hors national : ${m}`);
  assert.ok(bt.size < cie.size && cie.size < reg.size && reg.size < tout.size);
});

test('un clic sur une unité extérieure est refusé, à chaque rang', () => {
  const autreRegion = JEU.regions.find((r) => r.nom !== REGION.nom);
  const autreCie = JEU.compagnies.find((c) => c.reg !== REGION.nom);
  const autreBt = JEU.brigades.find((b) => b.cie !== COMPAGNIE.nom);
  const sienneBt = JEU.brigades.find((b) => b.cie === COMPAGNIE.nom && b.nom !== BRIGADE.nom);
  const asc = (u) => ({ reg: u.reg, cie: u.cie });

  /* Autorisé */
  assert.ok(dansSaPortee(SESSIONS.unite, 'brigade', BRIGADE.nom, asc(BRIGADE)));
  assert.ok(dansSaPortee(SESSIONS.cie, 'brigade', sienneBt.nom, asc(sienneBt)));
  assert.ok(dansSaPortee(SESSIONS.reg, 'compagnie', COMPAGNIE.nom, asc(COMPAGNIE)));
  assert.ok(dansSaPortee(SESSIONS.admin, 'brigade', autreBt.nom, asc(autreBt)));
  /* L'ascendance du compte reste consultable : sans elle, pas de fil d'Ariane. */
  assert.ok(dansSaPortee(SESSIONS.cie, 'region', COMPAGNIE.reg));
  assert.ok(dansSaPortee(SESSIONS.unite, 'compagnie', BRIGADE.cie));

  /* Refusé */
  assert.equal(dansSaPortee(SESSIONS.unite, 'brigade', sienneBt.nom, asc(sienneBt)), false);
  assert.equal(dansSaPortee(SESSIONS.cie, 'brigade', autreBt.nom, asc(autreBt)), false);
  assert.equal(dansSaPortee(SESSIONS.cie, 'compagnie', autreCie.nom, asc(autreCie)), false);
  assert.equal(dansSaPortee(SESSIONS.reg, 'compagnie', autreCie.nom, asc(autreCie)), false);
  assert.equal(dansSaPortee(SESSIONS.reg, 'region', autreRegion.nom), false);
  assert.equal(dansSaPortee(SESSIONS.unite, 'region', autreRegion.nom), false);
});

test('chaque personnel porte son rattachement complet et sa disponibilité', () => {
  for (const e of JEU.effectifs.filter((_, i) => i % 97 === 0)) {
    for (const champ of ['id', 'matricule', 'grade', 'nom', 'prenom', 'regionId',
      'compagnieId', 'brigadeId', 'statut']) {
      assert.ok(e[champ] != null && e[champ] !== '', `${champ} manquant sur ${e.matricule}`);
    }
    assert.equal(typeof e.disponibilite, 'boolean');
    assert.equal(e.statut, e.disponibilite ? 'disponible' : 'indisponible');
    if (!e.disponibilite) assert.ok(e.motifIndisponibilite, 'indisponible sans motif');
  }
  /* Les identifiants pointent sur des unités qui existent. */
  const ids = {
    reg: new Set(JEU.regions.map((r) => r.id)),
    cie: new Set(JEU.compagnies.map((c) => c.id)),
    bt: new Set(JEU.brigades.map((b) => b.id)),
  };
  for (const e of JEU.effectifs) {
    assert.ok(ids.reg.has(e.regionId) && ids.cie.has(e.compagnieId) && ids.bt.has(e.brigadeId));
  }
});

/* ================================================================== */
/*  PORTÉE COURANTE — la navigation resserre, jamais elle n'ouvre      */
/* ================================================================== */

test('la portée suit la navigation, dans les limites du compte', () => {
  const region = JEU.regions.find((r) => JEU.compagnies.filter((c) => c.reg === r.nom).length > 1);
  const cie = JEU.compagnies.find((c) => c.reg === region.nom);
  const autreCie = JEU.compagnies.find((c) => c.reg === region.nom && c.nom !== cie.nom);
  const bt = JEU.brigades.find((b) => b.cie === cie.nom);
  const chefRegion = { rang: 'reg', unite: region.nom, reg: region.nom };

  /* Sans navigation : son périmètre. */
  assert.deepEqual(porteeCourante(chefRegion, {}),
    { niveau: 'region', champ: 'reg', unite: region.nom });

  /* Descendu dans une compagnie, puis dans une brigade : la portée suit. */
  assert.equal(porteeCourante(chefRegion, { region: region.nom, compagnie: cie.nom }).unite, cie.nom);
  assert.equal(
    porteeCourante(chefRegion, { region: region.nom, compagnie: cie.nom, brigade: bt.nom }).unite,
    bt.nom,
  );

  /* Un contexte qui désigne une AUTRE région est ignoré : on ne sort pas. */
  const autreRegion = JEU.regions.find((r) => r.nom !== region.nom);
  assert.deepEqual(porteeCourante(chefRegion, { region: autreRegion.nom }),
    { niveau: 'region', champ: 'reg', unite: region.nom });

  /* L'administrateur sans navigation n'a aucune restriction. */
  assert.equal(porteeCourante({ rang: 'admin', unite: 'A' }, {}), null);
  assert.equal(porteeCourante({ rang: 'admin', unite: 'A' }, { region: autreRegion.nom }).unite,
    autreRegion.nom);

  /* Et la carte ne montre alors que les postes de cette portée. */
  const portee = porteeCourante(chefRegion, { region: region.nom, compagnie: cie.nom });
  const vus = JEU.barrages.filter((m) => dansLaPortee(portee, m));
  assert.ok(vus.length > 0);
  assert.ok(vus.every((m) => m.cie === cie.nom), 'un poste hors compagnie est resté visible');
  assert.equal(vus.filter((m) => m.cie === autreCie.nom).length, 0);

  /* Portée nulle : tout passe (c'est la vue nationale). */
  assert.equal(JEU.barrages.filter((m) => dansLaPortee(null, m)).length, JEU.barrages.length);
});

test('la portée s’emboîte : brigade ⊂ compagnie ⊂ région', () => {
  const region = JEU.regions.find((r) => JEU.compagnies.filter((c) => c.reg === r.nom).length > 1);
  const cie = JEU.compagnies.find((c) => c.reg === region.nom);
  const bt = JEU.brigades.find((b) => b.cie === cie.nom);
  const chef = { rang: 'reg', unite: region.nom, reg: region.nom };

  const vus = (contexte) =>
    new Set(
      JEU.barrages
        .filter((m) => dansLaPortee(porteeCourante(chef, contexte), m))
        .map((m) => m.id),
    );

  const dansRegion = vus({ region: region.nom });
  const dansCie = vus({ region: region.nom, compagnie: cie.nom });
  const dansBt = vus({ region: region.nom, compagnie: cie.nom, brigade: bt.nom });

  assert.ok(dansBt.size > 0 && dansBt.size < dansCie.size && dansCie.size < dansRegion.size);
  for (const id of dansBt) assert.ok(dansCie.has(id));
  for (const id of dansCie) assert.ok(dansRegion.has(id));
});
