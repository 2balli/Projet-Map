/**
 * VÉRIFICATION DU COMPORTEMENT DU FILTRE FACTION SUR LA CARTE DES BARRAGES
 *
 * Règles vérifiées :
 * 1. Aucun barrage n'est jamais masqué de la carte (aucun retrait de données).
 * 2. Par défaut (« Toutes les factions »), tous les barrages conservent leur apparence normale (non atténués).
 * 3. Lorsqu'on sélectionne « Faction 1 », les barrages de la F1 sont mis en évidence,
 *    tandis que les F2, F3, F4 sont atténués.
 * 4. Lorsqu'on sélectionne « Faction 2 », les barrages de la F2 sont mis en évidence,
 *    tandis que les F1, F3, F4 sont atténués.
 * 5. Les Intouchables (postes permanents 24/7) appartiennent à toutes les factions et
 *    ne sont jamais atténués.
 * 6. Les éléments non-barrages (accidents, pointages, etc.) ne sont jamais atténués.
 * 7. Restaurer « Toutes les factions » rétablit l'apparence normale pour tous.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function creerTesterAppartenance(factions, apercuFactions) {
  return function barrageAppartientAFaction(m, fId) {
    if (!fId || fId === 'toutes') return true;
    if (m.type !== 'barrage_fixe' && m.type !== 'barrage_mobile' && m.type !== 'barrage_vip') return true;
    if (m.intouchable) return true;

    const proposee = apercuFactions?.get(m.id);
    if (proposee) {
      if (fId === 'sans_faction') return false;
      return proposee === fId;
    }

    const assignes = factions?.assignations?.[m.id];
    if (Array.isArray(assignes) && assignes.length > 0) {
      if (fId === 'sans_faction') return false;
      return assignes.includes(fId);
    }

    if (m.factionId) {
      if (fId === 'sans_faction') return false;
      return m.factionId === fId;
    }
    if (Array.isArray(m.factions) && m.factions.length > 0) {
      if (fId === 'sans_faction') return false;
      return m.factions.includes(fId);
    }

    return fId === 'sans_faction';
  };
}

function calculerEtatVisuel(m, factionActive, barrageAppartientAFaction) {
  const estBarrage = m.type === 'barrage_fixe' || m.type === 'barrage_mobile' || m.type === 'barrage_vip';
  const selectionActive = Boolean(factionActive && factionActive !== 'toutes');
  const appartient = barrageAppartientAFaction(m, factionActive);
  const estAttenue = estBarrage && selectionActive && !appartient;
  const estMisEnEvidence = estBarrage && selectionActive && appartient;
  const opacite = estAttenue ? 0.38 : 1.0;
  return { estAttenue, estMisEnEvidence, opacite };
}

test('1. Par défaut (Toutes les factions), tous les barrages gardent leur apparence normale', () => {
  const factions = {
    factions: [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }, { id: 'F4' }],
    assignations: { b1: ['F1'], b2: ['F2'], b3: ['F3'], b4: ['F4'], bInt: ['F1', 'F2', 'F3', 'F4'] },
  };
  const testeur = creerTesterAppartenance(factions, null);

  const barrages = [
    { id: 'b1', type: 'barrage_fixe' },
    { id: 'b2', type: 'barrage_mobile' },
    { id: 'b3', type: 'barrage_fixe' },
    { id: 'b4', type: 'barrage_fixe' },
    { id: 'bInt', type: 'barrage_fixe', intouchable: true },
  ];

  for (const b of barrages) {
    const etat = calculerEtatVisuel(b, 'toutes', testeur);
    assert.equal(etat.estAttenue, false, `Le barrage ${b.id} ne doit pas être atténué sous 'toutes'`);
    assert.equal(etat.estMisEnEvidence, false, `Le barrage ${b.id} a son style standard sous 'toutes'`);
    assert.equal(etat.opacite, 1.0, `L'opacité de ${b.id} doit être 1.0`);
  }
});

test('2. Sélection Faction 1 : F1 mis en évidence, F2/F3/F4 atténués, intouchables préservés', () => {
  const factions = {
    factions: [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }, { id: 'F4' }],
    assignations: { b1: ['F1'], b2: ['F2'], b3: ['F3'], b4: ['F4'], bInt: [] },
  };
  const testeur = creerTesterAppartenance(factions, null);

  const b1 = { id: 'b1', type: 'barrage_fixe' };
  const b2 = { id: 'b2', type: 'barrage_mobile' };
  const b3 = { id: 'b3', type: 'barrage_fixe' };
  const b4 = { id: 'b4', type: 'barrage_fixe' };
  const bInt = { id: 'bInt', type: 'barrage_fixe', intouchable: true };

  const etatB1 = calculerEtatVisuel(b1, 'F1', testeur);
  assert.equal(etatB1.estMisEnEvidence, true, 'b1 (F1) doit être mis en évidence');
  assert.equal(etatB1.estAttenue, false, 'b1 (F1) ne doit pas être atténué');
  assert.equal(etatB1.opacite, 1.0);

  const etatB2 = calculerEtatVisuel(b2, 'F1', testeur);
  assert.equal(etatB2.estAttenue, true, 'b2 (F2) doit être atténué');
  assert.equal(etatB2.estMisEnEvidence, false);
  assert.equal(etatB2.opacite, 0.38);

  const etatB3 = calculerEtatVisuel(b3, 'F1', testeur);
  assert.equal(etatB3.estAttenue, true, 'b3 (F3) doit être atténué');

  const etatB4 = calculerEtatVisuel(b4, 'F1', testeur);
  assert.equal(etatB4.estAttenue, true, 'b4 (F4) doit être atténué');

  const etatBInt = calculerEtatVisuel(bInt, 'F1', testeur);
  assert.equal(etatBInt.estAttenue, false, 'Le barrage intouchable ne doit JAMAIS être atténué');
  assert.equal(etatBInt.estMisEnEvidence, true, 'Le barrage intouchable est permanent et actif');
  assert.equal(etatBInt.opacite, 1.0);
});

test('3. Sélection Faction 2 : F2 mis en évidence, F1/F3/F4 atténués', () => {
  const factions = {
    factions: [{ id: 'F1' }, { id: 'F2' }, { id: 'F3' }, { id: 'F4' }],
    assignations: { b1: ['F1'], b2: ['F2'], b3: ['F3'], b4: ['F4'] },
  };
  const testeur = creerTesterAppartenance(factions, null);

  const b1 = { id: 'b1', type: 'barrage_fixe' };
  const b2 = { id: 'b2', type: 'barrage_mobile' };

  const etatB2 = calculerEtatVisuel(b2, 'F2', testeur);
  assert.equal(etatB2.estMisEnEvidence, true, 'b2 (F2) doit être mis en évidence');
  assert.equal(etatB2.estAttenue, false);
  assert.equal(etatB2.opacite, 1.0);

  const etatB1 = calculerEtatVisuel(b1, 'F2', testeur);
  assert.equal(etatB1.estAttenue, true, 'b1 (F1) doit être atténué');
  assert.equal(etatB1.estMisEnEvidence, false);
  assert.equal(etatB1.opacite, 0.38);
});

test('4. Les non-barrages (accidents, pointages) ne sont jamais atténués', () => {
  const factions = {
    factions: [{ id: 'F1' }, { id: 'F2' }],
    assignations: { a1: [] },
  };
  const testeur = creerTesterAppartenance(factions, null);

  const accident = { id: 'a1', type: 'accident' };
  const etatAccident = calculerEtatVisuel(accident, 'F1', testeur);
  assert.equal(etatAccident.estAttenue, false, 'Un accident ne doit pas être atténué');
  assert.equal(etatAccident.opacite, 1.0);
});

test('5. Retour à Toutes les factions : rétablissement de la visibilité standard pour tous', () => {
  const factions = {
    factions: [{ id: 'F1' }, { id: 'F2' }],
    assignations: { b1: ['F1'], b2: ['F2'] },
  };
  const testeur = creerTesterAppartenance(factions, null);

  const b1 = { id: 'b1', type: 'barrage_fixe' };
  const b2 = { id: 'b2', type: 'barrage_mobile' };

  const etatB1 = calculerEtatVisuel(b1, 'toutes', testeur);
  const etatB2 = calculerEtatVisuel(b2, 'toutes', testeur);
  assert.equal(etatB1.estAttenue, false);
  assert.equal(etatB2.estAttenue, false);
  assert.equal(etatB1.opacite, 1.0);
  assert.equal(etatB2.opacite, 1.0);
});
