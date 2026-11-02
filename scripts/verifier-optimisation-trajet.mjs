#!/usr/bin/env node
/**
 * ÉPREUVE DE L'OPTIMISATION PAR TEMPS DE TRAJET.
 *
 * Elle fixe les règles que rien d'autre ne garde :
 *
 *   le conflit se mesure en MINUTES DE ROUTE, jamais à vol d'oiseau ;
 *   deux postes proches mais de factions disjointes ne sont PAS en conflit ;
 *   LE BARRAGE EST INTOUCHABLE : la seule réponse est de changer la faction,
 *     sinon de conserver — jamais déplacer, jamais retirer ;
 *   une proposition ne modifie ni la position, ni le type, ni l'horaire, ni la
 *     durée, ni le statut du poste : le contrôle avant/après le vérifie ;
 *   un changement de faction n'en crée pas un ailleurs ;
 *   la proposition porte l'avant ET l'après, de quoi l'afficher avant
 *     d'appliquer.
 *
 *   node --test scripts/verifier-optimisation-trajet.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { chargerGraphe, accrocher } from '../serveur/routage.mjs';
import {
  voisinsEnTemps,
  indexerAcces,
  tempsDepuis,
  itineraireDetaille,
} from '../serveur/tempsTrajet.mjs';
import {
  analyserParTempsTrajet,
  factionsSeChevauchent,
  SEUIL_MINUTES_DEFAUT,
} from '../serveur/optimisationTrajet.mjs';

/* ------------------------------------------------------------------ */
/* UN RÉSEAU MINUSCULE, MAIS RÉEL                                     */
/* ------------------------------------------------------------------ */

const KM_PAR_DEG = 111.32;
const lngDe = (km) => km / KM_PAR_DEG;

/**
 * Une route rectiligne, à vitesse choisie.
 *
 * La VITESSE est le point : à 60 km/h, 40 minutes valent 40 km ; à 120, elles
 * en valent 80. C'est exactement ce qu'une mesure à vol d'oiseau ne sait pas
 * dire, et ce que ces épreuves doivent vérifier.
 */
function route(longueurKm, { vitesse = 60, lat = 0, ref = 'N1', classe = 'nationale' } = {}) {
  const pas = 0.5;
  const n = Math.round(longueurKm / pas) + 1;
  const sommets = [];
  for (let i = 0; i < n; i++) sommets.push([+lngDe(i * pas).toFixed(6), lat]);
  const aretes = [];
  for (let i = 0; i < n - 1; i++) aretes.push([i, i + 1, Math.round(pas * 1000), 0, 0, 0, vitesse]);
  return chargerGraphe({ classes: [classe], vitesses: [vitesse], refs: [ref], sommets, aretes });
}

const poste = (id, km, extra = {}) => ({
  id,
  type: 'barrage_fixe',
  nom: id,
  route: 'N1',
  lng: +lngDe(km).toFixed(6),
  lat: 0,
  accidentCount: 0,
  severite: 'none',
  activite: 'low',
  infraction: 'low',
  positionVille: 'none',
  eclairage: 'oui',
  statutBarrage: 'approuve',
  decisionOptimisation: 'aucune',
  exceptionnel: false,
  missionId: null,
  factionId: 'F1',
  bt: 'BDE-A',
  cie: 'CIE-X',
  reg: 'REG-1',
  ...extra,
});

/* ================================================================== */
/* LE TEMPS DE TRAJET                                                 */
/* ================================================================== */

test('le temps se mesure par la route, et dépend de la vitesse de l’axe', () => {
  const lent = route(60, { vitesse: 60 });
  const rapide = route(60, { vitesse: 120 });
  const postes = [poste('A', 5), poste('B', 25)]; // 20 km d'écart

  const mesurer = (g) => {
    const snaps = postes.map((m) => accrocher(g, m.lng, m.lat, 5));
    return voisinsEnTemps(g, snaps, 120)[0][0].minutes;
  };

  const tLent = mesurer(lent);
  const tRapide = mesurer(rapide);

  assert.ok(Math.abs(tLent - 20) < 2, `20 km à 60 km/h ≈ 20 min, mesuré ${tLent}`);
  assert.ok(Math.abs(tRapide - 10) < 2, `20 km à 120 km/h ≈ 10 min, mesuré ${tRapide}`);
  assert.ok(
    tLent > tRapide,
    'LA MÊME DISTANCE donne deux temps différents : c’est tout l’objet du critère',
  );
});

test('un Dijkstra borné ne rend que ce qui est dans le budget', () => {
  const g = route(200, { vitesse: 60 });
  const postes = [poste('A', 5), poste('B', 25), poste('B2', 45), poste('LOIN', 150)];
  const snaps = postes.map((m) => accrocher(g, m.lng, m.lat, 5));
  const v = voisinsEnTemps(g, snaps, 40);

  const depuisA = v[0].map((x) => postes[x.index].id);
  assert.ok(depuisA.includes('B'), 'B est à 20 min');
  assert.ok(depuisA.includes('B2'), 'B2 est à 40 km soit 40 min — à la limite');
  assert.equal(depuisA.includes('LOIN'), false, 'LOIN est à 145 min : hors budget');
});

/* ================================================================== */
/* LE CHEVAUCHEMENT DE FACTION                                        */
/* ================================================================== */

test('deux factions distinctes ne se chevauchent pas ; une faction inconnue chevauche tout', () => {
  assert.equal(factionsSeChevauchent('F1', 'F1'), true);
  assert.equal(factionsSeChevauchent('F1', 'F2'), false);
  assert.equal(factionsSeChevauchent('F1', 'F3'), false);
  assert.equal(factionsSeChevauchent('F4', 'F1'), false);
  /* L'inconnu ne protège pas : sans quoi il suffirait de ne rien saisir pour
     sortir de l'optimisation. */
  assert.equal(factionsSeChevauchent('', 'F2'), true);
  assert.equal(factionsSeChevauchent('F2', null), true);
});

test('deux postes proches mais de factions disjointes ne sont PAS en conflit', () => {
  const g = route(60, { vitesse: 60 });
  /* 3 km, soit trois minutes : très proches. Mais l'un tient la nuit, l'autre
     le matin — ils se relaient, ils ne se gênent pas. */
  const postes = [poste('NUIT', 10, { factionId: 'F1' }), poste('MATIN', 13, { factionId: 'F2' })];

  const r = analyserParTempsTrajet(postes, g);

  assert.equal(r.resume.conflitsAvant, 0, 'aucun conflit malgré trois minutes de route');
  assert.equal(r.propositions.length, 0);
  assert.equal(r.resume.retraits, 0);
});

test('deux postes proches de MÊME faction sont en conflit', () => {
  const g = route(60, { vitesse: 60 });
  const postes = [poste('A', 10, { factionId: 'F2' }), poste('B', 13, { factionId: 'F2' })];

  const r = analyserParTempsTrajet(postes, g);

  assert.equal(r.resume.conflitsAvant, 1);
  assert.ok(r.propositions.length >= 1, 'une proposition est faite');
  assert.equal(r.seuilMinutes, SEUIL_MINUTES_DEFAUT);
});

/* ================================================================== */
/* LES TROIS ACTIONS                                                  */
/* ================================================================== */

/**
 * LE CONTROLE QUI COMPTE : ce qu'une proposition a le droit de changer.
 *
 * Il tient lieu des deux tests de deplacement qui etaient ici. Ils verifiaient
 * que la position d'arrivee etait sur une route et dans la brigade — questions
 * qui n'ont plus d'objet, puisqu'il n'y a plus d'arrivee. La question est
 * devenue : la proposition laisse-t-elle le barrage EXACTEMENT tel qu'il est ?
 */
const CHAMPS_FIGES = ['id', 'lng', 'lat', 'type', 'nom', 'route', 'debut', 'fin', 'statutBarrage'];

test('A — une proposition ne change QUE la faction, jamais le barrage', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high', infraction: 'high' }),
    poste('FAIBLE', 13, { factionId: 'F2' }),
  ];
  const avant = new Map(postes.map((b) => [b.id, JSON.parse(JSON.stringify(b))]));

  const r = analyserParTempsTrajet(postes, g);

  const p = r.propositions.find((x) => x.id === 'FAIBLE');
  assert.ok(p, 'c’est le moins prioritaire qui est réaffecté');
  assert.equal(p.action, 'changer_faction');
  assert.notEqual(p.nouvelleFactionId, 'F2', 'il quitte la faction en conflit');

  /* LA POSITION RENDUE EST CELLE DU POSTE, et il n'en existe aucune autre
     dans la proposition. */
  const b = avant.get('FAIBLE');
  assert.equal(p.lng, b.lng, 'la longitude est celle du poste');
  assert.equal(p.lat, b.lat, 'la latitude est celle du poste');
  for (const champ of ['nouvelleLng', 'nouvelleLat', 'nouvelleRoute', 'deplacementKm']) {
    assert.equal(p[champ], undefined, `la proposition ne porte pas de ${champ}`);
  }
  assert.equal(r.resume.deplacements, 0, 'aucun déplacement, jamais');
});

test('le jeu de données n’est pas touché : aucun champ figé ne bouge', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 13, { factionId: 'F2', debut: '06:00', fin: '12:00' }),
  ];
  const copie = JSON.parse(JSON.stringify(postes));

  analyserParTempsTrajet(postes, g);

  for (let i = 0; i < postes.length; i++) {
    for (const champ of CHAMPS_FIGES) {
      assert.deepEqual(
        postes[i][champ],
        copie[i][champ],
        `${champ} du poste ${copie[i].id} est resté identique`,
      );
    }
    assert.equal(postes[i].factionId, copie[i].factionId, 'même la faction : rien n’est écrit');
  }
});

test('B — faute de place, c’est la FACTION qui change', () => {
  /* Route courte : tout point est à moins de 40 min de l'autre poste, donc
     aucun déplacement ne peut résoudre. La faction, elle, le peut. */
  const g = route(20, { vitesse: 60 });
  const postes = [
    poste('FORT', 5, { factionId: 'F2', activite: 'high', infraction: 'high' }),
    poste('FAIBLE', 8, { factionId: 'F2' }),
  ];

  const r = analyserParTempsTrajet(postes, g);

  const p = r.propositions.find((x) => x.id === 'FAIBLE');
  assert.ok(p, 'une proposition porte sur le moins prioritaire');
  assert.equal(p.action, 'changer_faction');
  assert.notEqual(p.nouvelleFactionId, 'F2', 'il quitte la faction en conflit');
  assert.equal(p.lng, postes[1].lng, 'et il ne bouge pas : c’est sa position d’origine');
  assert.equal(r.resume.conflitsApres, 0, 'le conflit est dénoué');
});

test('un changement de faction n’en crée pas un ailleurs', () => {
  const g = route(20, { vitesse: 60 });
  /* Trois postes serrés : F2, F2, et F3. Le second doit éviter F2 (conflit) ET
     F3 (déjà tenue par le troisième, lui aussi à portée). */
  const postes = [
    poste('A', 4, { factionId: 'F2', activite: 'high' }),
    poste('B', 7, { factionId: 'F2' }),
    poste('C', 10, { factionId: 'F3' }),
  ];

  const r = analyserParTempsTrajet(postes, g);

  const p = r.propositions.find((x) => x.id === 'B' && x.action === 'changer_faction');
  if (p) {
    assert.notEqual(p.nouvelleFactionId, 'F2', 'pas la faction du conflit');
    assert.notEqual(p.nouvelleFactionId, 'F3', 'ni celle du troisième poste, à portée lui aussi');
  }
});

test('C — sans solution, le poste est CONSERVÉ et la raison est dite', () => {
  const g = route(20, { vitesse: 60 });
  /* Quatre postes serrés, un par faction : toutes les factions sont prises, et
     la route est trop courte pour éloigner qui que ce soit. */
  const postes = [
    poste('A', 3, { factionId: 'F1', activite: 'high' }),
    poste('B', 6, { factionId: 'F2', activite: 'high' }),
    poste('C', 9, { factionId: 'F3', activite: 'high' }),
    poste('D', 12, { factionId: 'F4', activite: 'high' }),
    poste('E', 15, { factionId: 'F1' }), // en conflit avec A, sans échappatoire
  ];

  const r = analyserParTempsTrajet(postes, g);

  const p = r.propositions.find((x) => x.id === 'E');
  assert.ok(p, 'le poste sans issue fait l’objet d’une proposition');
  assert.equal(p.action, 'conserver');
  assert.equal(r.resume.retraits, 0, 'JAMAIS de retrait automatique');
  assert.ok(
    p.raisons.some((x) => /Aucune faction libre/.test(x)),
    'la raison nomme le motif : aucune faction disponible',
  );
  assert.ok(
    p.raisons.some((x) => /barrage conservé, affectation inchangée/i.test(x)),
    'et l’action retenue, dans les termes exigés',
  );
  assert.ok(
    p.raisons.some((x) => /intouchable/i.test(x)),
    'et dit explicitement qu’on ne retire ni ne déplace',
  );
});

/* ================================================================== */
/* LES GARANTIES GÉNÉRALES                                            */
/* ================================================================== */

test('un poste protégé n’est ni déplacé ni réaffecté', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [
    poste('PORTE', 10, { factionId: 'F2', positionVille: 'porte' }),
    poste('VIP', 13, { factionId: 'F2', exceptionnel: true }),
  ];

  const r = analyserParTempsTrajet(postes, g);

  assert.equal(r.resume.conflitsAvant, 1, 'le conflit est bien CONSTATÉ');
  assert.equal(r.propositions.length, 0, 'mais aucun des deux ne peut bouger');
  assert.equal(r.resume.conflitsApres, 1, 'et il est rendu tel quel, pas masqué');
});

test('un BFI reste protégé tandis qu’un barrage normal en conflit peut être traité', () => {
  const g = route(120, { vitesse: 60 });
  const bfi = poste('BFI', 10, {
    factionId: 'F2',
    protection: 'intouchable',
    intouchable: true,
  });
  const normal = poste('NORMAL', 13, { factionId: 'F2' });

  const r = analyserParTempsTrajet([bfi, normal], g);
  assert.equal(r.resume.conflitsAvant, 1, 'le conflit avec le BFI est bien mesuré');
  assert.equal(r.propositions.some((p) => p.id === bfi.id), false, 'le BFI ne devient pas une proposition');
  assert.equal(r.propositions.some((p) => p.id === normal.id), true, 'le barrage normal peut être traité');
  assert.equal(bfi.lng, +lngDe(10).toFixed(6), 'la position du BFI demeure inchangée');
  assert.equal(bfi.factionId, 'F2', 'la faction du BFI demeure inchangée');
});

test('chaque proposition porte l’avant ET l’après, de quoi l’afficher', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 13, { factionId: 'F2' }),
  ];
  const r = analyserParTempsTrajet(postes, g);

  for (const p of r.propositions) {
    assert.ok(typeof p.lng === 'number' && typeof p.lat === 'number', 'la position actuelle');
    assert.ok(p.conflit?.nom, 'le poste en conflit est nommé');
    assert.ok(typeof p.minutesAvant === 'number', 'le temps de trajet mesuré');
    assert.ok(Array.isArray(p.raisons) && p.raisons.length >= 4, 'plusieurs raisons');
    assert.ok(
      p.raisons.some((x) => /Temps de trajet par la route/.test(x)),
      'dont le critère principal, nommé',
    );
  }
});

test('l’analyse ne modifie pas les barrages qu’on lui passe', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 13, { factionId: 'F2' }),
  ];
  const avant = JSON.stringify(postes);

  analyserParTempsTrajet(postes, g);

  assert.equal(JSON.stringify(postes), avant, 'rien n’est écrit : c’est une simulation');
});

test('le recalcul global : déplacer un poste ne doit pas créer un conflit ignoré', () => {
  const g = route(200, { vitesse: 60 });
  /* Une chaîne serrée : si l'on déplaçait sans recalculer, le poste bougé
     pourrait atterrir près d'un troisième sans que personne ne le voie. */
  const postes = [
    poste('A', 5, { factionId: 'F2', activite: 'high' }),
    poste('B', 8, { factionId: 'F2' }),
    poste('C', 60, { factionId: 'F2', activite: 'high' }),
    poste('D', 120, { factionId: 'F2', activite: 'high' }),
  ];

  const r = analyserParTempsTrajet(postes, g);

  /* Le compte final est RECALCULÉ sur l'état proposé, pas déduit du compte de
     départ moins les propositions. */
  assert.equal(
    typeof r.resume.conflitsApres,
    'number',
    'les conflits restants sont recomptés sur l’état final',
  );
  assert.ok(
    r.resume.conflitsApres <= r.resume.conflitsAvant,
    'une optimisation ne doit pas empirer la situation',
  );
});

test('l’index d’accès se met à jour quand un poste bouge', () => {
  const g = route(120, { vitesse: 60 });
  const postes = [poste('A', 10), poste('B', 13)];
  const snaps = postes.map((m) => accrocher(g, m.lng, m.lat, 5));
  const index = indexerAcces(g, snaps);

  const avant = tempsDepuis(g, index, snaps[0], 120, 0).get(1);
  assert.ok(avant < 5, `B est à trois minutes, mesuré ${avant}`);

  /* On déplace B à 100 km : la mesure doit suivre, sans reconstruire l'index. */
  const loin = accrocher(g, lngDe(110), 0, 5);
  index.remplacer(1, loin);
  const apres = tempsDepuis(g, index, snaps[0], 120, 0).get(1);
  assert.ok(apres > 90, `B est maintenant à plus de 90 min, mesuré ${apres}`);
});

/* ================================================================== */
/* LA RÈGLE D'UNE HEURE                                               */
/* ================================================================== */

test('le seuil par défaut est UNE HEURE de route', () => {
  assert.equal(SEUIL_MINUTES_DEFAUT, 60, 'la séparation opérationnelle minimale');
});

test('un couple à 45 minutes est en conflit — il ne l’était pas à 40 min', () => {
  /* 45 km à 60 km/h font 45 minutes : au-dessus de l'ancien seuil, en dessous
     du nouveau. C'est exactement le cas que le passage à une heure ajoute. */
  const g = route(200, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 55, { factionId: 'F2' }),
  ];

  const aUneHeure = analyserParTempsTrajet(postes, g);
  assert.equal(aUneHeure.resume.conflitsAvant, 1, '45 min < 1 h : conflit');

  const aQuarante = analyserParTempsTrajet(postes, g, {
    seuilMinutes: 40,
  });
  assert.equal(aQuarante.resume.conflitsAvant, 0, '45 min > 40 min : aucun conflit à l’ancien seuil');
});

test('un couple à plus d’une heure n’est pas en conflit', () => {
  /* 80 km à 60 km/h font 1 h 20. */
  const g = route(200, { vitesse: 60 });
  const postes = [poste('A', 10, { factionId: 'F2' }), poste('B', 90, { factionId: 'F2' })];

  const r = analyserParTempsTrajet(postes, g);
  assert.equal(r.resume.conflitsAvant, 0, '1 h 20 ≥ 1 h : le maillage est conforme');
  assert.equal(r.propositions.length, 0);
});

test('sur un axe long, le conflit se dénoue par la FACTION, pas en bougeant', () => {
  /* Quatre cents kilometres de route libre : l'ancienne optimisation y aurait
     deplace le poste faible. Elle ne le peut plus, et c'est la bonne reponse —
     la reaffectation denoue le conflit sans toucher a l'implantation. */
  const g = route(400, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 20, { factionId: 'F2' }),
  ];

  const r = analyserParTempsTrajet(postes, g);
  const p = r.propositions.find((x) => x.id === 'FAIBLE');
  assert.ok(p, 'une proposition porte sur le poste faible');
  assert.equal(p.action, 'changer_faction', 'la seule action possible');
  assert.equal(p.lat, postes[1].lat, 'le poste est resté exactement où il était');
  assert.equal(r.resume.conflitsApres, 0, 'et le conflit est dénoué');
});

/* ================================================================== */
/* LE TRACÉ ROUTIER DU CONFLIT                                        */
/* ================================================================== */

test('chaque conflit porte la VRAIE route, jamais une ligne droite', () => {
  const g = route(200, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 40, { factionId: 'F2' }),
  ];

  const r = analyserParTempsTrajet(postes, g);

  const p = r.propositions[0];
  assert.ok(p, 'une proposition est faite');
  assert.ok(Array.isArray(p.conflit.trace), 'le conflit porte un tracé');
  assert.ok(
    p.conflit.trace.length > 2,
    `le tracé suit la chaussée, il ne relie pas deux points (${p.conflit.trace.length} points)`,
  );
  assert.ok(typeof p.conflit.km === 'number' && p.conflit.km > 0, 'la distance ROUTIÈRE est donnée');
  /* 30 km à 60 km/h = 30 min : la distance routière et la durée se recoupent. */
  assert.ok(
    Math.abs(p.conflit.km - 30) < 2,
    `la distance routière vaut ~30 km, mesuré ${p.conflit.km}`,
  );
  assert.ok(
    Math.abs(p.conflit.minutes - 30) < 3,
    `et la durée ~30 min, mesuré ${p.conflit.minutes}`,
  );
  /* Le tracé part du premier poste et finit sur l'autre. */
  const [d, f] = [p.conflit.trace[0], p.conflit.trace[p.conflit.trace.length - 1]];
  assert.ok(Math.abs(d[0] - postes[0].lng) < 0.01 || Math.abs(d[0] - postes[1].lng) < 0.01);
  assert.ok(Math.abs(f[0] - postes[0].lng) < 0.01 || Math.abs(f[0] - postes[1].lng) < 0.01);
});

test('la distance routière dépasse le vol d’oiseau sur un tracé sinueux', () => {
  /* Une route en zigzag : la distance parcourue est nettement plus longue que
     l'écart à vol d'oiseau. C'est précisément ce qu'une mesure géométrique
     ignore, et ce que le tracé doit montrer. */
  const sommets = [];
  const n = 40;
  for (let i = 0; i < n; i++) {
    sommets.push([+lngDe(i * 1).toFixed(6), i % 2 === 0 ? 0 : 0.02]);
  }
  const aretes = [];
  for (let i = 0; i < n - 1; i++) aretes.push([i, i + 1, 2600, 0, 0, 0, 60]);
  const g = chargerGraphe({
    classes: ['nationale'],
    vitesses: [60],
    refs: ['N1'],
    sommets,
    aretes,
  });

  const snapA = accrocher(g, sommets[2][0], sommets[2][1], 5);
  const snapB = accrocher(g, sommets[20][0], sommets[20][1], 5);
  const t = itineraireDetaille(g, snapA, snapB);

  assert.ok(t, 'un itinéraire est trouvé');
  const volDOiseau = Math.abs(sommets[20][0] - sommets[2][0]) * KM_PAR_DEG;
  assert.ok(
    t.km > volDOiseau,
    `la route (${t.km} km) est plus longue que le vol d’oiseau (${volDOiseau.toFixed(1)} km)`,
  );
  assert.ok(t.coords.length > 10, 'et le tracé suit chaque lacet');
});

test('le statut dit si la proposition dénoue vraiment le conflit', () => {
  const g = route(400, { vitesse: 60 });
  const postes = [
    poste('FORT', 10, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 30, { factionId: 'F2' }),
  ];
  const r = analyserParTempsTrajet(postes, g);
  const p = r.propositions.find((x) => x.action === 'changer_faction');
  assert.ok(p, 'une réaffectation est proposée');
  assert.equal(p.statut, 'resolu', 'les deux postes ne sont plus simultanés');

  /* Un maintien ne dénoue rien, et le dit. */
  const serre = route(20, { vitesse: 60 });
  const bloques = [
    poste('A', 3, { factionId: 'F1', activite: 'high' }),
    poste('B', 6, { factionId: 'F2', activite: 'high' }),
    poste('C', 9, { factionId: 'F3', activite: 'high' }),
    poste('D', 12, { factionId: 'F4', activite: 'high' }),
    poste('E', 15, { factionId: 'F1' }),
  ];
  const r2 = analyserParTempsTrajet(bloques, serre);
  const maintien = r2.propositions.find((x) => x.action === 'conserver');
  assert.ok(maintien, 'un maintien est proposé');
  assert.equal(maintien.statut, 'conflit', 'et il ne prétend pas avoir résolu quoi que ce soit');
});

test('un changement de faction est marqué RÉSOLU — la simultanéité disparaît', () => {
  const g = route(20, { vitesse: 60 });
  const postes = [
    poste('FORT', 5, { factionId: 'F2', activite: 'high', infraction: 'high' }),
    poste('FAIBLE', 8, { factionId: 'F2' }),
  ];
  const r = analyserParTempsTrajet(postes, g);
  const p = r.propositions.find((x) => x.action === 'changer_faction');
  assert.ok(p, 'un changement de faction est proposé');
  assert.equal(p.statut, 'resolu');
  assert.equal(p.conflit.chevauchementPct, 100, 'le chevauchement d’AVANT est rapporté');
});

/* ================================================================== */
/* LES BORNES DE L'ANALYSE                                            */
/* ================================================================== */

test('aucune issue ne sort du périmètre — parce qu’il n’y a plus d’issue spatiale', () => {
  /* Ce test gardait l'ancienne optimisation dans les bornes de sa compagnie :
     elle deplacait, et un poste deplace pouvait franchir une limite
     administrative. La garantie est maintenant structurelle — rien ne bouge —
     et c'est CELA qu'il faut verifier, sur le resultat rendu. */
  const g = route(200, { vitesse: 60 });
  const postes = [
    poste('FORT', 5, { factionId: 'F2', activite: 'high' }),
    poste('FAIBLE', 10, { factionId: 'F2' }),
  ];
  const origines = new Map(postes.map((b) => [b.id, [b.lng, b.lat]]));

  const r = analyserParTempsTrajet(postes, g);

  for (const p of r.propositions) {
    const [lng, lat] = origines.get(p.id);
    assert.equal(p.lng, lng, `${p.id} n’a pas changé de longitude`);
    assert.equal(p.lat, lat, `${p.id} n’a pas changé de latitude`);
    assert.ok(['changer_faction', 'conserver'].includes(p.action), 'deux actions, pas trois');
  }
  /* Et quoi qu'il arrive, aucun retrait. */
  assert.equal(r.resume.retraits, 0);
  assert.equal(r.resume.deplacements, 0);
});

test('l’analyse s’interrompt sur son budget, et le DIT', () => {
  const g = route(400, { vitesse: 60 });
  /* Beaucoup de postes serrés sur la même faction : de quoi occuper la
     résolution bien au-delà d'un budget d'une milliseconde. */
  const postes = [];
  for (let i = 0; i < 60; i++) postes.push(poste(`P${i}`, 2 + i * 1.5, { factionId: 'F2' }));

  const bride = analyserParTempsTrajet(postes, g, {
    budgetMs: 1,
  });

  assert.equal(bride.resume.interrompue, true, 'l’interruption est signalée');
  assert.ok(
    bride.resume.conflitsNonExamines > 0,
    'et le nombre de conflits non examinés est rendu',
  );
  assert.ok(typeof bride.resume.dureeMs === 'number', 'la durée réelle est rendue');

  /* Sans bride, elle va au bout et ne prétend rien avoir interrompu. */
  const complete = analyserParTempsTrajet(postes, g);
  assert.equal(complete.resume.interrompue, false);
  assert.equal(complete.resume.conflitsNonExamines, 0);
});

test('les propositions rendues sont plafonnées, et le reste est compté', () => {
  const g = route(400, { vitesse: 60 });
  const postes = [];
  for (let i = 0; i < 40; i++) postes.push(poste(`P${i}`, 2 + i * 1.5, { factionId: 'F2' }));

  const r = analyserParTempsTrajet(postes, g);

  assert.equal(
    r.propositions.length + r.resume.propositionsOmises,
    r.resume.propositionsTotal,
    'rendues + omises = total : rien ne disparaît en silence',
  );
  /* Les actions applicables passent avant les maintiens : un maintien
     n'apprend rien tant qu'il reste des changements à examiner. */
  const premierMaintien = r.propositions.findIndex((p) => p.action === 'conserver');
  const dernierChangement = r.propositions.map((p) => p.action !== 'conserver').lastIndexOf(true);
  if (premierMaintien > -1 && dernierChangement > -1) {
    assert.ok(premierMaintien > dernierChangement, 'les changements sont listés en premier');
  }
});
