#!/usr/bin/env node
/** Vérification métier des scénarios sur les vraies données demo et le graphe local. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accrocher, chargerGraphe, refArete } from '../serveur/routage.mjs';
import { analyserParTempsTrajet } from '../serveur/optimisationTrajet.mjs';
import { distanceRouteMinKm } from '../serveur/distances.mjs';
import { FICHIER_DEMO, SCENARIOS } from './seed-optimisation-demo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const brutAvant = readFileSync(FICHIER_DEMO);
const depot = JSON.parse(brutAvant.toString('utf8'));
const items = depot.items ?? [];
const actifs = items.filter(
  (m) =>
    m.type === 'barrage_fixe' &&
    !['supprime', 'retire_optimisation'].includes(m.statutBarrage),
);
const parId = new Map();
for (const m of actifs) {
  assert.ok(m.id, 'chaque barrage fixe actif possède un ID stable');
  assert.equal(parId.has(m.id), false, `ID physique dupliqué : ${m.id}`);
  parId.set(m.id, m);
}
const physiques = [...parId.values()];
assert.equal(physiques.length, 600, '594 barrages initiaux + 6 scénarios');
assert.equal(SCENARIOS.filter((s) => parId.has(s.id)).length, 6, 'six scénarios présents');

const graphe = chargerGraphe(
  JSON.parse(readFileSync(join(ROOT, 'public/layers/graphe_routier.json'), 'utf8')),
);
const resumes = [];
for (const s of SCENARIOS) {
  const item = parId.get(s.id);
  const anchor = parId.get(s.ancre);
  assert.ok(item && anchor, `${s.id} et son barrage d’ancrage existent`);
  assert.equal(item.reg, s.reg);
  assert.equal(item.cie, s.cie);
  assert.equal(item.bt, s.bt);
  assert.equal(item.route, s.route);
  assert.equal(item.intouchable, false);
  assert.notEqual(item.factionId, '', 'le scénario a une faction initiale');

  const snap = accrocher(graphe, item.lng, item.lat, 0.1);
  assert.ok(snap && snap.ecartKm < 0.05, `${s.id} est accroché au réseau routier`);
  assert.equal(refArete(graphe, snap.arete), s.route, `${s.id} est sur ${s.route}`);
  const km = distanceRouteMinKm(graphe, [anchor.lng, anchor.lat], [item.lng, item.lat]);
  assert.ok(km > 0 && km < 40, `${s.id} : distance routière ${km} km, sous 40 km`);

  /* Même filtre de périmètre que l'API au niveau brigade, sans occurrence en double. */
  const scope = physiques.filter((m) => m.bt === s.bt);
  const snapshot = JSON.stringify(scope);
  const r = analyserParTempsTrajet(scope, graphe);
  const p = r.propositions.find((ligne) => ligne.id === s.id);
  assert.ok(r.resume.conflitsAvant >= 1, `${s.id} : le conflit est détecté`);
  assert.equal(p?.action, 'changer_faction', `${s.id} : changement de faction proposé`);
  assert.equal(p.conflit.id, anchor.id, `${s.id} : l’ancre réelle est nommée comme voisin`);
  assert.notEqual(p.nouvelleFactionId, item.factionId, `${s.id} : la faction change`);
  assert.ok(p.conflit.km > 0 && p.conflit.km < 40, `${s.id} : distance du conflit routier affichée`);
  assert.equal(p.lng, item.lng, `${s.id} : longitude inchangée avant Apply`);
  assert.equal(p.lat, item.lat, `${s.id} : latitude inchangée avant Apply`);
  assert.equal(JSON.stringify(scope), snapshot, `${s.id} : aucune mutation des données d’entrée`);
  resumes.push({ id: s.id, reg: s.reg, cie: s.cie, bt: s.bt, km, minutes: p.minutesAvant });
}

/* Un poste réel, seul dans le périmètre de sa brigade, reste sans proposition. */
const posteStable = physiques.find(
  (m) => !m.intouchable && physiques.filter((x) => x.bt === m.bt).length === 1,
);
assert.ok(posteStable, 'un poste normal sans voisin dans son périmètre existe');
const scopeStable = physiques.filter((m) => m.bt === posteStable.bt);
const stableAvant = JSON.stringify(scopeStable);
const resultatStable = analyserParTempsTrajet(scopeStable, graphe);
assert.equal(resultatStable.resume.conflitsAvant, 0);
assert.equal(resultatStable.propositions.length, 0);
assert.equal(JSON.stringify(scopeStable), stableAvant, 'le poste non conflictuel reste inchangé');

/* Mesure de référence complète, sans appeler l’API Apply ni écrire de résultat. */
const instantane = JSON.stringify(physiques);
const resultat = analyserParTempsTrajet(physiques, graphe);
assert.equal(JSON.stringify(physiques), instantane, 'le moteur ne modifie aucune donnée chargée');
const intouchables = physiques.filter(
  (m) => m.intouchable === true || m.protection === 'intouchable' || m.type === 'barrage_vip',
);
const idsIntouchables = new Set(intouchables.map((m) => m.id));
const referencesIntouchables = new Set();
for (const p of resultat.propositions) {
  if (idsIntouchables.has(p.conflit?.id)) referencesIntouchables.add(p.conflit.id);
  assert.equal(
    idsIntouchables.has(p.id) && p.action !== 'conserver',
    false,
    `l’intouchable ${p.id} ne reçoit aucune action automatique`,
  );
}
for (const c of resultat.conflitsRestants) {
  if (idsIntouchables.has(c.a.id)) referencesIntouchables.add(c.a.id);
  if (idsIntouchables.has(c.b.id)) referencesIntouchables.add(c.b.id);
}
assert.ok(referencesIntouchables.size > 0, 'les intouchables apparaissent comme références de conflits');
const propositionsPosition = resultat.propositions.filter((p) => p.action === 'deplacer');
assert.equal(propositionsPosition.length, 0, 'le moteur actuel ne propose aucun déplacement');
assert.equal(resultat.resume.deplacements, 0);
assert.equal(sha256(readFileSync(FICHIER_DEMO)), sha256(brutAvant), 'aucune donnée n’a été écrite avant Apply');

console.log('VÉRIFICATION OPTIMISATION AUTOMATIQUE — DEMO');
console.log(`Barrages fixes physiques avant semis : ${physiques.length - SCENARIOS.length}`);
console.log(`Barrages de test ajoutés : ${SCENARIOS.length}`);
console.log(`Barrages fixes physiques après semis : ${physiques.length}`);
console.log(`Paires de conflit du calcul national (temps routier) : ${resultat.resume.conflitsAvant}`);
console.log(`Propositions nationales de changement de faction : ${resultat.resume.changementsFaction}`);
console.log(`Propositions de position : ${propositionsPosition.length} (non pris en charge par le moteur actuel)`);
console.log(`Intouchables : ${intouchables.length} ; référencés dans des conflits : ${referencesIntouchables.size}`);
console.log(`Intouchables modifiés : 0 ; écriture avant Apply : aucune`);
console.log(`Scénarios de brigade confirmés : ${resumes.length}`);
for (const s of resumes) {
  console.log(`  ${s.id} | ${s.reg} | ${s.cie} | ${s.bt} | ${s.km.toFixed(2)} km | ${s.minutes.toFixed(1)} min`);
}
console.log(`Poste non conflictuel conservé : ${posteStable.id} (${posteStable.reg} / ${posteStable.bt})`);
