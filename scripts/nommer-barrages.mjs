#!/usr/bin/env node
/**
 * NOMMER CHAQUE BARRAGE PAR CE QUI PERMET DE LE TROUVER.
 *
 * LE PROBLÈME
 * -----------
 * Sur 1121 barrages, 65 n'avaient aucun nom et 589 noms se partageaient le
 * reste : dix-sept postes s'appelaient tous « Barrage RN17 — Es-Smara ». Un
 * nom qui désigne dix-sept endroits ne désigne rien. Il ne sert ni à chercher,
 * ni à dire lequel on tient au téléphone, ni à relire un ordre de service.
 *
 * LA RÈGLE
 * --------
 * Un nom se construit à partir de ce qui existe déjà, jamais d'une invention :
 *
 *     ROUTE  —  LOCALITÉ LA PLUS PROCHE  [ DISTANCE  DIRECTION ]
 *
 *   RN1 — Skhirate                 le poste est dans la localité
 *   RN17 — Es-Smara 14 km NE       il en est à quatorze kilomètres
 *   Tarfaya 6 km S                 hors route nommée
 *
 * La distance et la direction n'apparaissent QUE lorsqu'elles sont nécessaires
 * à distinguer deux postes. Un nom court quand il suffit, précis quand il le
 * faut : allonger tous les noms pour les quelques cas ambigus les rendrait
 * tous illisibles.
 *
 * D'OÙ VIENNENT LES LOCALITÉS
 * ---------------------------
 * De deux fichiers déjà livrés, et d'eux seuls :
 *
 *   - `poles-population.json` — 477 localités nommées, avec population ;
 *   - `pts_bt.geojson`        — 501 implantations de brigade.
 *
 * Le pôle de population l'emporte à distance comparable : « Es-Smara » se
 * situe mieux que « BT Es-Smara », et c'est le nom qu'un gendarme emploie.
 * Aucun toponyme n'est inventé — si rien n'est trouvé dans un rayon
 * raisonnable, le poste garde le nom de sa brigade de rattachement, qui est
 * une donnée du dépôt.
 *
 * CE QUI N'EST PAS TOUCHÉ
 * -----------------------
 * Les noms écrits par une personne. Un barrage créé par un compte réel et
 * portant déjà un nom garde le sien : « barage alfa1 » est peut-être une
 * faute de frappe, mais c'est la faute de frappe de quelqu'un, et ce quelqu'un
 * sait pourquoi il l'a écrite. Seuls les postes semés par `SYSTEME`, et ceux
 * qu'on a laissés sans nom, sont renommés.
 *
 * RIEN D'AUTRE NE BOUGE : ni coordonnées, ni type, ni route, ni rattachement,
 * ni éclairage, ni classification. Ce script écrit UN champ, `nom`.
 *
 *   node scripts/nommer-barrages.mjs             aperçu et contrôles
 *   node scripts/nommer-barrages.mjs --ecrire    applique, avec sauvegarde
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);

const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');
const POLES = join(ROOT, 'public/layers/poles-population.json');
const PTS_BT = join(ROOT, 'public/layers/pts_bt.geojson');

/** Au-delà, on ne prétend plus qu'une localité situe le poste. */
const RAYON_MAX_KM = 80;

/** En deçà, le poste EST dans la localité : ni distance ni direction. */
const RAYON_SUR_PLACE_KM = 2.5;

/** À écart comparable, le pôle de population l'emporte sur la brigade. */
const PREFERENCE_POLE_KM = 4;

/* ------------------------------------------------------------------ */
/* Géométrie                                                          */
/* ------------------------------------------------------------------ */

const RAD = Math.PI / 180;

/** Distance orthodromique, en kilomètres. */
function distanceKm(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * RAD;
  const dLng = (bLng - aLng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

/**
 * Direction du poste VU DE LA LOCALITÉ, en huit secteurs.
 *
 * Huit et non seize : « nord-nord-est » n'aide personne sur le terrain, et
 * multiplierait les noms presque identiques que ce script cherche justement
 * à éliminer.
 */
const SECTEURS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/* Seize secteurs, réservés au départage de deux postes qui partagent déjà
   tout le reste. On ne s'en sert pas plus tôt : « nord-nord-est » n'aide
   personne, sauf quand c'est la seule chose qui distingue deux noms. */
const SECTEURS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO',
];

function azimut(deLat, deLng, versLat, versLng) {
  const dLat = versLat - deLat;
  /* Les longitudes se resserrent vers les pôles : sans ce facteur, un écart
     est-ouest paraîtrait plus grand qu'il n'est, et la direction basculerait
     à tort vers l'est ou l'ouest. */
  const dLng = (versLng - deLng) * Math.cos(deLat * RAD);
  return (Math.atan2(dLng, dLat) / RAD + 360) % 360;
}

const direction = (a, b, c, d) => SECTEURS[Math.round(azimut(a, b, c, d) / 45) % 8];
const direction16 = (a, b, c, d) => SECTEURS_16[Math.round(azimut(a, b, c, d) / 22.5) % 16];

/* ------------------------------------------------------------------ */
/* Toponymes                                                          */
/* ------------------------------------------------------------------ */

/** « BT AGADIR » -> « Agadir ». Les fichiers de points sont en capitales. */
function titre(brut) {
  return String(brut ?? '')
    .replace(/^(BT|CIE|REG)\s+/i, '')
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s'’\-])([a-zà-ÿ])/g, (_, s, c) => s + c.toLocaleUpperCase('fr'))
    .trim();
}

function chargerGazetteer() {
  const lieux = [];

  const poles = JSON.parse(readFileSync(POLES, 'utf8'));
  for (const p of Array.isArray(poles) ? poles : (poles.items ?? [])) {
    if (!p?.nom || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    lieux.push({ nom: p.nom, lat: p.lat, lng: p.lng, pole: true });
  }

  /**
   * UNE LOCALITÉ, UNE SEULE ORTHOGRAPHE.
   *
   * Les deux fichiers ne s'accordent pas : « Es Smara » côté pôles,
   * « Es-Smara » côté brigades. Gardés tous les deux, deux postes voisins
   * porteraient deux graphies du même lieu — les noms resteraient uniques,
   * et pourtant on ne saurait plus s'il s'agit du même endroit. Le pôle
   * l'emporte : c'est le nom d'usage, et il porte une population.
   */
  const cle = (n) =>
    n
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const clesPoles = new Map(lieux.map((l) => [cle(l.nom), l]));

  const bt = JSON.parse(readFileSync(PTS_BT, 'utf8'));
  for (const f of bt.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const nom = titre(f.properties?.nom);
    if (!nom || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    /* Même lieu qu'un pôle déjà connu, à orthographe près : on ne l'ajoute
       pas une seconde fois sous un autre nom. */
    const jumeau = clesPoles.get(cle(nom));
    if (jumeau && distanceKm(lat, lng, jumeau.lat, jumeau.lng) < 15) continue;

    lieux.push({ nom, lat, lng, pole: false });
  }

  return lieux;
}

/**
 * La localité qui situe le mieux ce point.
 *
 * On prend la plus proche, avec une préférence pour les pôles de population :
 * à quelques kilomètres près, le nom d'une ville connue vaut mieux que celui
 * d'un hameau où se trouve une brigade.
 */
function localiser(lieux, lat, lng) {
  let meilleur = null;
  let meilleurPole = null;

  for (const l of lieux) {
    const d = distanceKm(lat, lng, l.lat, l.lng);
    if (!meilleur || d < meilleur.km) meilleur = { ...l, km: d };
    if (l.pole && (!meilleurPole || d < meilleurPole.km)) meilleurPole = { ...l, km: d };
  }

  if (!meilleur) return null;
  if (meilleurPole && meilleurPole.km <= meilleur.km + PREFERENCE_POLE_KM) return meilleurPole;
  return meilleur;
}

/* ------------------------------------------------------------------ */
/* Construction des noms                                              */
/* ------------------------------------------------------------------ */

/**
 * ENTRÉE ET SORTIE DE VILLE appartiennent au nom.
 *
 * C'est la première chose qu'on veut savoir d'un poste avant d'y envoyer du
 * monde, et elle est déjà dans la donnée (`positionVille`). L'écrire dans le
 * nom évite d'ouvrir la fiche pour une information qu'on lit mille fois.
 */
const QUALITE = { entree: 'Entrée', sortie: 'Sortie', porte: 'Porte' };

/** « Entrée RN17 — Es Smara 14 km NE », ou plus court si cela suffit. */
function composer({ qualite, route, lieu, km, dir }, avecPosition) {
  const gauche = [qualite, route].filter(Boolean).join(' ');
  const tete = gauche ? `${gauche} — ` : '';
  if (!avecPosition) return `${tete}${lieu}`;
  return `${tete}${lieu} ${km} km ${dir}`;
}

/** La forme la plus fine : au dixième de kilomètre, au seizième de tour. */
function precis(c) {
  const gauche = [c.qualite, c.route].filter(Boolean).join(' ');
  return `${gauche ? `${gauche} — ` : ''}${c.lieu} ${c.kmPrecis} km ${c.dir16}`;
}

/* ------------------------------------------------------------------ */

const depot = JSON.parse(readFileSync(FICHIER, 'utf8'));
const items = depot.items ?? [];
const lieux = chargerGazetteer();

const estBarrage = (m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile';
const barrages = items.filter(estBarrage);

/**
 * CE QUI EST PRÉSERVÉ : un nom d'humain, pas un gabarit de semis.
 *
 * L'auteur ne suffit pas à trancher. Le dispositif a été semé sous des comptes
 * réels autant que sous `SYSTEME`, et ces semis portent des noms de gabarit —
 * « Barrage RN1 #9 », « Barrage RN1 (remplacement 5) », « Porte Cie Tarfaya
 * — RR109 » — qui ne désignent rien de plus que ce que ce script produit en
 * mieux. Filtrer sur l'auteur préservait seize noms inutiles.
 *
 * On se fie donc à la FORME. Ce qui ne ressemble pas à un gabarit a été tapé
 * par quelqu'un : « barage alfa1 » est peut-être une faute de frappe, mais
 * c'est la sienne, et il sait pourquoi il l'a écrite.
 */
const GABARITS = [/^Barrage\b/i, /^Porte Cie\b/i];

const humain = (m) => {
  const nom = String(m.nom ?? '').trim();
  return nom && !GABARITS.some((g) => g.test(nom));
};

const preserves = barrages.filter(humain);
const aNommer = barrages.filter((m) => !humain(m));

/* --- 1. Le candidat de chaque poste, sans se soucier des collisions --- */

const candidats = new Map();
const horsPortee = [];
const erreursChargement = [];

for (const m of aNommer) {
  const l = localiser(lieux, m.lat, m.lng);
  /* Un identifiant de route, pas un mot : « nationale » ne situe rien et
     donnerait « nationale — Errahma ». Une valeur non conforme est ignorée
     dans le nom — elle reste intacte dans la donnée, ce script n'y touche pas. */
  const brut = String(m.route ?? '').trim();
  const route = /^(A|RN|RR|RP)\d+$/i.test(brut) ? brut.toUpperCase() : '';

  if (!l) {
    /* Le gazetteer est vide ou illisible : c'est une panne, pas un cas limite. */
    erreursChargement.push(m.id);
    continue;
  }

  /**
   * AUCUN PLAFOND DE DISTANCE.
   *
   * Une première version repliait les postes éloignés de plus de 80 km sur le
   * nom de leur brigade. Dans le Sahara, dix barrages d'une même brigade
   * recevaient alors le même nom et finissaient numérotés « Es-Smara #7 » —
   * un nom qui ne situe rien, exactement ce que ce script combat.
   *
   * « Es Smara 118 km NE » est long, et vrai. On préfère le vrai.
   */
  if (l.km > RAYON_MAX_KM) horsPortee.push({ m, km: Math.round(l.km) });

  candidats.set(m.id, {
    qualite: QUALITE[m.positionVille] ?? '',
    route,
    lieu: l.nom,
    km: Math.max(1, Math.round(l.km)),
    /* Au dixième de kilomètre : réservé au départage, jamais affiché sans
       nécessité. Deux postes à 0,1 km et au même seizième de tour l'un de
       l'autre sont, à l'échelle d'une carte, le même point. */
    kmPrecis: Math.max(0.1, Math.round(l.km * 10) / 10).toFixed(1),
    dir: direction(l.lat, l.lng, m.lat, m.lng),
    dir16: direction16(l.lat, l.lng, m.lat, m.lng),
    surPlace: l.km <= RAYON_SUR_PLACE_KM,
  });
}

/* --- 2. Le nom le plus court qui ne se confonde avec aucun autre --- */

/**
 * Trois passes, de la plus lisible à la plus précise. On ne descend d'un cran
 * que pour les postes encore en collision : les autres gardent le nom court.
 */
const pris = new Set(preserves.map((m) => String(m.nom).trim()));
const attribues = new Map();

const essayer = (liste, formule) => {
  const parNom = new Map();
  for (const m of liste) {
    const n = formule(candidats.get(m.id));
    if (!parNom.has(n)) parNom.set(n, []);
    parNom.get(n).push(m);
  }

  const restants = [];
  for (const [nom, groupe] of parNom) {
    if (groupe.length === 1 && !pris.has(nom)) {
      attribues.set(groupe[0].id, nom);
      pris.add(nom);
    } else {
      restants.push(...groupe);
    }
  }
  return restants;
};

/**
 * Passe 1 — le nom court : route et localité. Il suffit pour l'immense
 * majorité des postes, et c'est celui qu'on veut lire.
 */
let restants = essayer(aNommer, (c) => composer(c, false));

/**
 * Passe 2 — distance et direction, y compris pour les postes « sur place ».
 *
 * Les inclure ici est le correctif d'une première version qui les en
 * dispensait : trois barrages dans la même ville retombaient alors sur le
 * nom court à chaque passe et finissaient tous numérotés. « Es-Smara 1 km N »
 * situe ; « Es-Smara #4 » ne situe rien.
 */
restants = essayer(restants, (c) => composer(c, true));

/**
 * Passe 3 — au dixième de kilomètre et au seizième de tour. Deux postes de la
 * même route, à la même distance arrondie et dans le même octant : il faut
 * descendre d'un cran pour les séparer par une donnée réelle plutôt que par
 * un rang arbitraire.
 */
restants = essayer(restants, precis);

/**
 * Dernier recours, et il doit rester rare : un rang. Il ne dit rien du
 * terrain, on l'assume comme tel et le contrôle le compte.
 */
const numerotes = [];
for (const m of restants) {
  const c = candidats.get(m.id);
  /* Dans la localité même, « 0.2 km SO » n'apporte rien et alourdit : deux
     postes séparés de deux cents mètres sont au même endroit pour qui lit une
     carte. Le rang, alors, est plus honnête que la fausse précision. */
  const base = c.surPlace ? composer(c, false) : precis(c);
  let n = 2;
  while (pris.has(`${base} #${n}`)) n++;
  const nom = `${base} #${n}`;
  attribues.set(m.id, nom);
  pris.add(nom);
  numerotes.push(nom);
}

/* ------------------------------------------------------------------ */
/* Contrôles                                                          */
/* ------------------------------------------------------------------ */

const erreurs = [];
const avis = [];

const nomsFinaux = new Map();
for (const m of barrages) {
  const nom = attribues.get(m.id) ?? String(m.nom ?? '').trim();
  if (!nom) erreurs.push(`Barrage ${m.id} resterait sans nom.`);
  if (!nomsFinaux.has(nom)) nomsFinaux.set(nom, []);
  nomsFinaux.get(nom).push(m.id);
}

for (const [nom, ids] of nomsFinaux) {
  if (ids.length > 1) erreurs.push(`Nom encore partagé par ${ids.length} postes : « ${nom} »`);
}

if (attribues.size + preserves.length !== barrages.length) {
  erreurs.push(
    `Compte incohérent : ${attribues.size} renommés + ${preserves.length} préservés ` +
      `!= ${barrages.length} barrages.`
  );
}

if (erreursChargement.length) {
  erreurs.push(`${erreursChargement.length} poste(s) sans localité : gazetteer illisible ?`);
}

if (horsPortee.length) {
  const pire = horsPortee.reduce((s, h) => Math.max(s, h.km), 0);
  avis.push(
    `${horsPortee.length} poste(s) nommés d'après une localité à plus de ` +
      `${RAYON_MAX_KM} km (la plus lointaine : ${pire} km). Le Sahara est vide ; ` +
      `le nom reste vrai.`
  );
}
if (numerotes.length) {
  avis.push(`${numerotes.length} nom(s) ont dû être départagés par un rang (#2, #3…).`);
}

/* ------------------------------------------------------------------ */
/* Rapport                                                            */
/* ------------------------------------------------------------------ */

const long = [...attribues.values()].reduce((s, n) => Math.max(s, n.length), 0);

console.log(`\nBarrages                    : ${barrages.length}`);
console.log(`  renommés                  : ${attribues.size}`);
console.log(`  noms d'origine préservés  : ${preserves.length} (écrits par un compte réel)`);
console.log(`  noms distincts au total   : ${nomsFinaux.size}`);
console.log(`  nom le plus long          : ${long} caractères`);

console.log('\nExemples :');
for (const m of aNommer.slice(0, 12)) {
  const c = candidats.get(m.id);
  console.log(
    `  ${(m.nom || '(vide)').padEnd(28).slice(0, 28)} ->  ${attribues.get(m.id)}` +
      `   [${c.surPlace ? 'sur place' : `${c.km} km`}]`
  );
}

console.log('\nLes dix-sept homonymes d’Es-Smara, désormais :');
const smara = aNommer.filter((m) => /Es-Smara/i.test(String(m.nom ?? '')) && /RN17/.test(m.route ?? ''));
for (const m of smara.slice(0, 17)) console.log(`  ${attribues.get(m.id)}`);

if (numerotes.length) {
  /* Les rangs sont le seul endroit où ce script renonce à situer : on les
     imprime pour vérifier qu'il s'agit bien de postes confondus. */
  console.log('\nDépartagés par un rang :');
  numerotes.forEach((x) => console.log(`  ${x}`));
}

if (avis.length) {
  console.log('\nÀ savoir :');
  avis.forEach((a) => console.log(`  - ${a}`));
}

if (erreurs.length) {
  console.error('\nCONTRÔLES EN ÉCHEC — rien ne sera écrit :');
  erreurs.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}

console.log('\nContrôles : tous les postes ont un nom, et aucun nom n’est partagé.');

if (!drapeau('ecrire')) {
  console.log('\nAperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.\n');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Écriture                                                           */
/* ------------------------------------------------------------------ */

/**
 * La sauvegarde ne se laisse écraser par aucun second passage : relancé, ce
 * script sauvegarderait un fichier déjà modifié et la sauvegarde ne servirait
 * plus à rien. C'est déjà arrivé sur ce dépôt.
 */
const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-nommage.json');
const dejaSauve = existsSync(sauvegarde);
if (!dejaSauve) copyFileSync(FICHIER, sauvegarde);

let ecrits = 0;
for (const m of items) {
  const nom = attribues.get(m.id);
  if (nom && m.nom !== nom) {
    m.nom = nom;
    ecrits++;
  }
}

writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log(`\n${ecrits} nom(s) écrit(s) dans ${FICHIER}`);
console.log(
  dejaSauve
    ? `Sauvegarde déjà présente, conservée intacte : ${sauvegarde}`
    : `Sauvegarde : ${sauvegarde}`
);
console.log('Redémarrez le service pour que les postes le voient.\n');
