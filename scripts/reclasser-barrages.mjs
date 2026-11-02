#!/usr/bin/env node
/**
 * RECLASSEMENT GÉOGRAPHIQUE DES BARRAGES — éclairage, VIP, entrée, sortie.
 *
 * Quatre champs sont RECONSTRUITS de zéro, sur le seul critère de la position
 * réelle du poste et de son contexte routier :
 *
 *   eclairage      'oui' | 'non' | 'inconnu'
 *   exceptionnel   le poste porte une mission de protocole (VIP)
 *   missionId      remis à null s'il ne désigne aucune mission réelle
 *   positionVille  'entree' | 'sortie' | 'none'
 *
 * LE CAS `missionId` MÉRITE SON PARAGRAPHE, il a failli passer inaperçu.
 *
 * Le serveur ne lit pas `exceptionnel` seul : il calcule
 * `vip = Boolean(exceptionnel || missionId)` (voir la route consolidation).
 * Reposer `exceptionnel` sans toucher à `missionId` laissait donc 89 barrages
 * VIP aux yeux de l'application alors que la règle géographique les avait
 * écartés — dont des postes de Zagora, à 26 hab/km².
 *
 * Ces 90 identifiants sont tous de la forme `mission_vip_xxxxxx`, fabriqués par
 * scripts/qualifier-barrages.mjs, et AUCUN ne désigne une mission existante
 * (`donnees-serveur/missions.json` n'en contient qu'une, sans rapport). Ce sont
 * des références mortes : elles sont effacées. Un `missionId` qui désigne une
 * vraie mission, lui, est conservé tel quel — et son poste reste VIP.
 *
 * Rien d'autre n'est touché : ni coordonnées, ni nom, ni route, ni unité, ni
 * statut de validation, ni décision d'optimisation, ni accidents. Le type non
 * plus, et aucun poste n'est créé ni supprimé.
 *
 * AUCUN TIRAGE AU SORT. C'est la raison d'être de ce script : le parc portait
 * des valeurs posées à la volée (voir scripts/qualifier-barrages.mjs, qui tire
 * 12 % de VIP au hasard parmi les axes majeurs). Ici, tout se déduit de la
 * géométrie, et deux exécutions sur les mêmes données donnent le même résultat.
 *
 * QUAND L'INFORMATION N'EST PAS DÉTERMINABLE, ELLE RESTE VIDE. Un poste dans la
 * frange périurbaine n'est ni « éclairé » ni « non éclairé » : il est
 * `inconnu`. Une ville sans axe majeur identifiable n'a pas d'entrée. Mieux
 * vaut un champ vide qu'une classification fausse — c'est la règle qui a
 * présidé à tout ce qui suit.
 *
 * CE QUI SERT DE RÉFÉRENCE, ET POURQUOI
 * -------------------------------------
 *   poles-population.json   477 communes réelles avec population, densité et
 *                           superficie (bâti sur circo_bt — voir
 *                           scripts/build-poles-population.mjs). C'est l'unité
 *                           d'« agglomération » : ni le nom du barrage, ni sa
 *                           circonscription administrative.
 *
 * DEUX PIÈGES DE CE FICHIER, MESURÉS AVANT D'ÉCRIRE LA MOINDRE RÈGLE
 * ------------------------------------------------------------------
 * `pop` et `rayonKm` décrivent la CIRCONSCRIPTION, pas la ville :
 *
 *   Zagora        117 561 hab, rayon 37,98 km, densité 26 hab/km²
 *   Errachidia    134 239 hab, rayon 29,86 km, densité 48
 *   Casablanca  1 482 554 hab, rayon  6,50 km, densité 11 170
 *
 * Prendre `pop` pour mesurer l'urbanité aurait fait de Zagora une métropole ;
 * prendre `rayonKm` pour le bâti aurait déclaré « en ville » tout poste à moins
 * de 38 km de Zagora. Deux corrections, donc :
 *
 *   RAYON URBAIN  min(rayon de la circonscription, rayon du disque qui
 *                 contiendrait la population à DENSITE_BATI hab/km²). Zagora
 *                 tombe à 3,5 km, Errachidia à 3,8, Casablanca reste à 6,5 —
 *                 chacun retrouve l'ordre de grandeur de sa tache urbaine.
 *   DENSITÉ       c'est elle, et non la population, qui dit si une commune est
 *                 urbaine. Le projet le disait déjà dans le commentaire de
 *                 build-poles-population.mjs : « c'est ce rapport, et non la
 *                 population brute, qui distingue une grande ville d'un vaste
 *                 territoire peu dense. »
 *   pts_bt.geojson          les 50 chefs-lieux de brigade qu'aucun pôle ne
 *                           couvre, ajoutés comme petites localités : sans eux,
 *                           des bourgs entiers seraient traités en rase
 *                           campagne.
 *   graphe_routier.json     la CLASSE de la route sous le poste, mesurée par
 *                           accrochage au réseau — pas lue dans le champ
 *                           `route`, qui est du texte saisi à la main.
 *   villes-police.json      périmètres urbains déclarés de la Sûreté Nationale
 *                           (voir scripts/zones-urbaines.mjs) : on n'y place pas
 *                           de porte de ville.
 *
 * CE QUE LA DONNÉE NE PERMET PAS DE SAVOIR
 * ----------------------------------------
 * Le graphe routier ne porte AUCUN sens de circulation — `serveur/routage.mjs`
 * insère chaque arête dans les deux sens. « Entrée » et « sortie » ne sont donc
 * pas mesurables : sur une chaussée à double sens, le même point est l'un quand
 * on arrive et l'autre quand on part.
 *
 * La distinction retenue est donc une CONVENTION, explicite et reproductible :
 *
 *   entrée  l'axe le PLUS IMPORTANT qui aborde l'agglomération (autoroute avant
 *           nationale avant régionale ; à égalité, le poste le plus proche du
 *           centre) — l'accès principal ;
 *   sortie  le meilleur poste restant situé de l'AUTRE CÔTÉ de la ville (plus de
 *           90° d'écart d'azimut avec l'entrée) — l'autre extrémité de la
 *           traversée.
 *
 * Aucune ville n'obtient de sortie s'il n'existe pas de second axe franchement
 * distinct : on ne fabrique pas une sortie pour faire la paire.
 *
 *   node scripts/reclasser-barrages.mjs             aperçu + audit, n'écrit rien
 *   node scripts/reclasser-barrages.mjs --ecrire    applique, avec sauvegarde
 *
 * Options (les valeurs par défaut sont celles retenues après mesure) :
 *   --hors-ville <km>  distance minimale d'une porte au centre       (2.5)
 *   --marge <km>       fouille au-delà du bâti de l'agglomération    (6)
 *   --isole <km>       au-delà, le poste est isolé -> non éclairé    (12)
 *   --densite-urbain   densité minimale d'une commune urbanisée      (400)
 *   --densite-habite   densité minimale d'une commune habitée        (150)
 *   --densite-bati     densité de référence du bâti, pour le rayon   (3000)
 *   --vip-max <n>      VIP par agglomération                         (2)
 *   --ecart-vip <km>   distance maximale au bâti pour un VIP         (3)
 *   --vip-region <n>   VIP retenus par RÉGION                        (1)
 *   --nuit-region <n>  « non éclairé » retenus par RÉGION            (1)
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chargerGraphe, distanceKm, accrocher, classeArete } from '../serveur/routage.mjs';
import { chargerZonesUrbaines } from './zones-urbaines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const drapeau = (n) => process.argv.includes(`--${n}`);
const valeur = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? Number(process.argv[i + 1])
    : d;
};

const COUCHES = [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d));
const FICHIER = join(ROOT, 'donnees-serveur/marquages.json');

const HORS_VILLE_KM = valeur('hors-ville', 2.5);
const MARGE_KM = valeur('marge', 6);
const ISOLE_KM = valeur('isole', 12);
const VIP_MAX = valeur('vip-max', 2);
const ECART_VIP_KM = valeur('ecart-vip', 3);

/**
 * COMBIEN DE CAS RETENUS PAR RÉGION — une décision de LISIBILITÉ, pas de mesure.
 *
 * La géométrie, laissée libre, désignait 40 postes VIP et 458 non éclairés : la
 * carte en devenait illisible, chaque région couverte d'étoiles roses, de
 * viseurs violets et de croissants. Or ces deux caractères servent à ATTIRER
 * L'ŒIL sur un cas ; multipliés par dix, ils ne montrent plus rien.
 *
 * On ne garde donc qu'un cas par région, et le plus représentatif :
 *
 *   VIP           le poste le plus urbain de la région sur son axe le plus
 *                 important — la ville la plus dense d'abord, puis l'autoroute
 *                 avant la nationale, puis le plus proche du centre ;
 *   non éclairé   le poste le PLUS ISOLÉ de la région — le cas d'école de la
 *                 route sans éclairage, celui qui justifie la classification.
 *
 * LES AUTRES NE DEVIENNENT PAS « ÉCLAIRÉS » : ce serait affirmer faux. Ils
 * repassent à `inconnu` — l'éclairage n'y a pas été relevé, ce qui est la
 * vérité. Rien n'est perdu : `--nuit-region 0` rend la totalité des cas
 * géographiques, et le script est rejouable à volonté.
 */
const VIP_PAR_REGION = valeur('vip-region', 1);
const NUIT_PAR_REGION = valeur('nuit-region', 1);

/**
 * ÉCART MINIMAL ENTRE DEUX POSTES NON ÉCLAIRÉS — 2 km, à vol d'oiseau.
 *
 * Deux postes voisins sont sur la même portion de route : les déclarer tous les
 * deux « non éclairé » n'apporte aucune information de plus et empile deux
 * croissants au même endroit de la carte.
 *
 * La contrainte est GLOBALE, pas régionale : deux régions limitrophes peuvent se
 * toucher, et rien n'empêcherait leurs deux postes désignés d'être à 800 m l'un
 * de l'autre de part et d'autre de la limite.
 *
 * Elle est aussi PRIORITAIRE sur l'isolement : un candidat mieux placé mais trop
 * proche d'un poste déjà retenu est écarté au profit du suivant. Avec un poste
 * par région le cas ne se présente pas (le minimum observé est de 26,8 km), mais
 * `--nuit-region 0` en désigne 456 : c'est là que la règle travaille.
 */
const ECART_NUIT_KM = valeur('ecart-nuit', 2);

/** 0 ou moins : aucun plafond régional, on garde tout ce que la géométrie donne. */
const sansPlafond = (n) => !Number.isFinite(n) || n <= 0;

/**
 * LES TROIS DENSITÉS, mesurées sur les 477 pôles avant d'être fixées.
 *
 * Répartition observée : médiane 77 hab/km², p75 165, p90 449, p95 983, et
 * douze communes au-dessus de 3 000 (les métropoles).
 *
 *   URBAIN 400   les 53 communes franchement urbanisées — Casablanca 11 170,
 *                Fès 10 892, Rabat 3 712, Tanger 3 004, Bouknadel 544,
 *                Bouznika 351 est juste en dessous. Ce sont celles dont les
 *                voies sont éclairées et où un cortège officiel circule.
 *   HABITÉ 150   environ 130 communes : un bourg avec des commerces et de la
 *                voirie. En dessous, c'est du rural étalé.
 *   BÂTI 3000    densité de référence servant à déduire le rayon de la tache
 *                urbaine (voir plus haut). Ni un seuil ni un jugement : une
 *                unité de conversion.
 */
const DENSITE_URBAIN = valeur('densite-urbain', 400);
const DENSITE_HABITE = valeur('densite-habite', 150);
const DENSITE_BATI = valeur('densite-bati', 3000);

/** Le bâti d'une localité n'est jamais réputé plus petit que cela. */
const RAYON_URBAIN_MIN_KM = 1;

/** Poids des classes de route : un axe majeur aborde une ville, une desserte non. */
const POIDS_CLASSE = { autoroute: 3, nationale: 2, regionale: 1 };

const estBarrage = (m) => m.type === 'barrage_fixe' || m.type === 'barrage_mobile';

/* ================================================================== */
/* Références géographiques                                           */
/* ================================================================== */

const lireJson = (chemin) => JSON.parse(readFileSync(chemin, 'utf8'));

const poles = lireJson(join(COUCHES, 'poles-population.json')).poles ?? [];
const graphe = chargerGraphe(lireJson(join(COUCHES, 'graphe_routier.json')));
const zonesPolice = chargerZonesUrbaines(COUCHES);

/**
 * Missions réellement enregistrées. Un `missionId` absent de cette liste est une
 * référence morte : il sera effacé, sans quoi il continuerait de faire un VIP.
 */
const FICHIER_MISSIONS = join(ROOT, 'donnees-serveur/missions.json');
const missionsReelles = new Set(
  existsSync(FICHIER_MISSIONS)
    ? (lireJson(FICHIER_MISSIONS).items ?? []).map((x) => x.id).filter(Boolean)
    : []
);

const chefsLieuxBt = (lireJson(join(COUCHES, 'pts_bt.geojson')).features ?? [])
  .filter((f) => f.geometry?.type === 'Point')
  .map((f) => ({
    nom: f.properties?.nom ?? f.properties?.unite ?? 'Brigade',
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

/**
 * LES AGGLOMÉRATIONS — l'unité de la règle d'unicité (une entrée, une sortie).
 *
 * Les pôles d'abord : ce sont des communes, avec leur population et leur rayon
 * de bâti. Puis les chefs-lieux de brigade qu'aucun pôle ne couvre, regroupés
 * entre eux à 6 km pour qu'un bourg à deux brigades reste UNE ville — sans quoi
 * il recevrait deux entrées, ce que la règle d'unicité interdit.
 *
 * Les trois brigades de Skhirate, elles, tombent dans les pôles voisins
 * (Témara, Sebbah) : Skhirate n'est pas un pôle de population à elle seule. Ses
 * barrages sont donc rattachés à ces agglomérations, ce qui est exact —
 * Skhirate-Témara forme une seule conurbation le long de l'axe côtier.
 */
/**
 * Rayon de la TACHE URBAINE, et non de la circonscription — voir l'en-tête.
 * Le disque qui contiendrait la population de la commune à la densité de
 * référence du bâti, jamais plus grand que la circonscription elle-même.
 */
const rayonUrbain = (pop, rayonCirco) =>
  Math.max(
    RAYON_URBAIN_MIN_KM,
    Math.min(rayonCirco, Math.sqrt(Math.max(0, pop) / (Math.PI * DENSITE_BATI)))
  );

const agglomerations = poles.map((p) => {
  const pop = Number(p.pop) || 0;
  const rayonCirco = Number(p.rayonKm) || 3;
  return {
    nom: p.nom,
    lng: p.lng,
    lat: p.lat,
    pop,
    densite: Number(p.densite) || 0,
    rayonCircoKm: rayonCirco,
    rayonKm: rayonUrbain(pop, rayonCirco),
    source: 'pole',
  };
});

const RAYON_BOURG_KM = 3;
const FUSION_BOURG_KM = 6;

/**
 * DÉDOUBLONNAGE — la même ville ne doit pas compter deux fois.
 *
 * Sans cela, « BT BOUZNIKA » s'ajoutait à côté du pôle « Bouznika » : deux
 * agglomérations pour une seule ville, donc DEUX entrées et DEUX sorties — la
 * règle d'unicité violée sans que le contrôle le voie, puisqu'il compare des
 * noms et que ceux-là diffèrent.
 *
 * Deux tests, et le nom passe avant la distance : le rayon URBAIN est petit (2,7
 * km pour Bouznika), un chef-lieu de brigade à 4 km du centre y échappe alors
 * qu'il désigne bel et bien la même ville. La comparaison de noms, insensible à
 * la casse et aux accents, le rattrape ; la distance couvre les cas où les noms
 * diffèrent (orthographe locale, ancienne dénomination).
 */
const clefNom = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(bt|cie|reg)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const nomsAgglos = new Set(agglomerations.map((a) => clefNom(a.nom)));
/** Au-delà, deux points ne sont plus la même localité, même dans une immense circonscription. */
const RATTACHEMENT_MAX_KM = 10;

let bourgsAjoutes = 0;
for (const c of chefsLieuxBt) {
  const cle = clefNom(c.nom);
  /* Même nom qu'une agglomération connue : c'est elle. */
  if (nomsAgglos.has(cle)) continue;
  /* Ou bien dans l'emprise de sa commune, à distance raisonnable de son centre. */
  if (
    agglomerations.some((a) => {
      const d = distanceKm(c.lng, c.lat, a.lng, a.lat);
      return d <= Math.min(a.rayonCircoKm, RATTACHEMENT_MAX_KM);
    })
  ) {
    continue;
  }
  /* Deux brigades du même bourg : on ne crée pas deux villes. */
  const voisine = agglomerations.find(
    (a) => a.source === 'bourg' && distanceKm(c.lng, c.lat, a.lng, a.lat) <= FUSION_BOURG_KM
  );
  if (voisine) continue;
  nomsAgglos.add(cle);
  agglomerations.push({
    nom: c.nom.replace(/^BT\s+/i, ''),
    lng: c.lng,
    lat: c.lat,
    /* Population et densité INCONNUES : ce bourg ne sera donc jamais réputé
       urbanisé (pas d'éclairage déduit, pas de VIP). Il compte seulement comme
       localité habitée — assez pour qu'un poste à sa porte ne soit pas déclaré
       « isolé », et pour qu'il puisse avoir une entrée. */
    pop: 0,
    densite: 0,
    rayonCircoKm: RAYON_BOURG_KM,
    rayonKm: RAYON_BOURG_KM,
    source: 'bourg',
  });
  bourgsAjoutes++;
}

/* ================================================================== */
/* Mesures par barrage                                                */
/* ================================================================== */

/** Azimut en degrés (0 = nord, sens horaire) du centre-ville vers le poste. */
function azimut(lngA, latA, lngB, latB) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLng = rad(lngB - lngA);
  const y = Math.sin(dLng) * Math.cos(rad(latB));
  const x =
    Math.cos(rad(latA)) * Math.sin(rad(latB)) -
    Math.sin(rad(latA)) * Math.cos(rad(latB)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Écart angulaire minimal entre deux azimuts, de 0 à 180. */
const ecartAngle = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const depot = lireJson(FICHIER);
const items = depot.items ?? [];
const barrages = items.filter(estBarrage);

console.log('');
console.log('RECLASSEMENT GÉOGRAPHIQUE DES BARRAGES');
console.log('='.repeat(78));
console.log(`Parc                    : ${barrages.length} barrages`);
console.log(`Agglomérations retenues : ${agglomerations.length} (${poles.length} pôles + ${bourgsAjoutes} bourgs)`);
console.log(`Zones DGSN déclarées    : ${zonesPolice.villes.length}${zonesPolice.valide ? '' : ' (non validées par le commandement)'}`);
console.log('Accrochage au réseau routier…');

/**
 * Pour chaque poste : son agglomération de rattachement, l'écart au bâti, et la
 * classe de la route qui le porte.
 *
 * `ecartBatiKm` — et non la distance au centre — est ce qui décide de l'urbain :
 * une ville de 14 km de rayon et un bourg de 3 km ne se comparent pas à la même
 * aune. Négatif ou nul, le poste est DANS le bâti.
 */
const mesures = new Map();
for (const m of barrages) {
  let proche = null; // la localité la plus proche, quelle qu'elle soit
  let procheHabitee = null; // la plus proche commune habitée (densité)
  let procheUrbaine = null; // la plus proche commune franchement urbanisée
  for (const a of agglomerations) {
    const d = distanceKm(m.lng, m.lat, a.lng, a.lat);
    const ecart = d - a.rayonKm;
    if (!proche || d < proche.d) proche = { a, d, ecart };
    /* Un bourg sans densité connue compte comme habité : il a une brigade,
       donc au moins un village. */
    const habitee = a.densite >= DENSITE_HABITE || a.source === 'bourg';
    if (habitee && (!procheHabitee || ecart < procheHabitee.ecart)) {
      procheHabitee = { a, d, ecart };
    }
    if (a.densite >= DENSITE_URBAIN && (!procheUrbaine || ecart < procheUrbaine.ecart)) {
      procheUrbaine = { a, d, ecart };
    }
  }

  /* La classe de la route se MESURE : le champ `route` est du texte saisi. Un
     poste à plus de 300 m de tout axe connu n'est rattaché à aucune classe. */
  const acc = accrocher(graphe, m.lng, m.lat, 1);
  const classe = acc && acc.ecartKm <= 0.3 ? classeArete(graphe, acc.arete) : null;

  /* La localité habitée la plus proche, y compris les chefs-lieux de brigade
     déjà couverts par un pôle : c'est le dernier rempart avant de déclarer un
     poste « isolé ». Un barrage devant une brigade ne l'est pas. */
  let ecartChefLieu = Infinity;
  for (const c of chefsLieuxBt) {
    const d = distanceKm(m.lng, m.lat, c.lng, c.lat);
    if (d < ecartChefLieu) ecartChefLieu = d;
  }

  /**
   * ISOLEMENT — la distance à ce qui est habité le plus proche, quel qu'il soit.
   *
   * Le minimum des deux signaux, et non leur moyenne : être à 40 km d'une ville
   * n'isole pas un poste planté devant une brigade. C'est ce chiffre qui
   * désignera le cas le plus représentatif de sa région.
   */
  const isolementKm = Math.min(
    procheHabitee ? procheHabitee.ecart : Infinity,
    ecartChefLieu
  );

  mesures.set(m.id, {
    proche,
    procheHabitee,
    procheUrbaine,
    ecartChefLieu,
    isolementKm,
    classe,
    poids: POIDS_CLASSE[classe] ?? 0,
    dansZonePolice: Boolean(zonesPolice.contient(m.lng, m.lat)),
  });
}

/* ================================================================== */
/* Règle 1 — éclairage                                                */
/* ================================================================== */

/**
 * L'éclairage suit l'URBANISATION, rien d'autre.
 *
 *   'oui'      dans la tache urbaine d'une commune de densité ≥ DENSITE_URBAIN,
 *              ou dans un périmètre urbain déclaré par le commandement : ces
 *              voies sont éclairées ;
 *   'non'      à plus de ISOLE_KM du bâti de TOUTE commune habitée ET à plus de
 *              ISOLE_KM de TOUT chef-lieu de brigade — route isolée, rase
 *              campagne, montagne : l'éclairage y est improbable ;
 *   'inconnu'  entre les deux. La frange périurbaine ne se devine pas, et on
 *              n'invente pas : le champ reste vide. C'est le cas le plus
 *              fréquent, et c'est normal.
 *
 * La double condition du cas « non » est ce qui l'empêche de s'emballer : la
 * densité ignore les villages sans population déclarée, les 501 chefs-lieux de
 * brigade les rattrapent. Un poste n'est « non éclairé » que si les deux
 * signaux disent « personne à douze kilomètres ».
 */
function eclairageDe(m) {
  const x = mesures.get(m.id);
  if (x.dansZonePolice) return 'oui';
  if (x.procheUrbaine && x.procheUrbaine.ecart <= 0) return 'oui';
  const loinDesVilles = !x.procheHabitee || x.procheHabitee.ecart > ISOLE_KM;
  if (loinDesVilles && x.ecartChefLieu > ISOLE_KM) return 'non';
  return 'inconnu';
}

/* ================================================================== */
/* Règle 2 — VIP                                                      */
/* ================================================================== */

/**
 * VIP = CONTEXTE URBAIN ET AXE MAJEUR.
 *
 * Un cortège officiel circule sur autoroute ou sur nationale, et il entre dans
 * une ville. Trois conditions, donc, et aucune part de hasard :
 *
 *   — le poste est au contact du bâti (ECART_VIP_KM) d'une commune dont la
 *     DENSITÉ atteint DENSITE_URBAIN — une vraie ville, pas une circonscription
 *     rurale peuplée. C'est ce critère qui écarte Zagora (26 hab/km²) et retient
 *     Témara (3 591), dont dépendent les brigades de Skhirate ;
 *   — il est posé sur une autoroute ou une nationale ;
 *   — il fait partie des VIP_MAX postes les mieux placés de cette agglomération
 *     (axe le plus important d'abord, puis le plus proche du centre).
 *
 * Le troisième point est ce qui évite de décorer douze postes d'une même ville :
 * une mission de protocole se tient sur les accès principaux, pas partout.
 *
 * `missionId` reste à `null` : inventer un identifiant de mission créerait une
 * référence vers un dossier qui n'existe pas. `exceptionnel` porte seul
 * l'information — c'est ce que lit le serveur (voir la route consolidation).
 */
function calculerVip() {
  const parVille = new Map();
  for (const m of barrages) {
    const x = mesures.get(m.id);
    const a = x.procheUrbaine;
    if (!a || a.ecart > ECART_VIP_KM) continue;
    if (x.poids < POIDS_CLASSE.nationale) continue; // autoroute ou nationale
    if (!parVille.has(a.a.nom)) parVille.set(a.a.nom, []);
    parVille.get(a.a.nom).push({ m, poids: x.poids, d: a.d });
  }

  const retenus = new Set();
  for (const [, liste] of parVille) {
    liste.sort((p, q) => q.poids - p.poids || p.d - q.d || p.m.id.localeCompare(q.m.id));
    for (const { m } of liste.slice(0, VIP_MAX)) retenus.add(m.id);
  }

  /**
   * PLAFOND RÉGIONAL — on ne garde que le cas le plus significatif par région.
   *
   * Le tri est celui de la représentativité : la ville la plus DENSE de la
   * région d'abord (un VIP à Rabat plutôt qu'au chef-lieu d'un bourg), puis
   * l'axe le plus important, puis le plus proche du centre-ville. L'identifiant
   * tranche les ex æquo, pour que le choix ne dépende pas de l'ordre du fichier.
   */
  if (!sansPlafond(VIP_PAR_REGION)) {
    const parRegion = new Map();
    for (const m of barrages) {
      if (!retenus.has(m.id)) continue;
      const reg = m.reg ?? '(sans région)';
      if (!parRegion.has(reg)) parRegion.set(reg, []);
      parRegion.get(reg).push(m);
    }
    const gardes = new Set();
    for (const [, liste] of parRegion) {
      liste.sort((p, q) => {
        const xp = mesures.get(p.id);
        const xq = mesures.get(q.id);
        return (
          (xq.procheUrbaine?.a.densite ?? 0) - (xp.procheUrbaine?.a.densite ?? 0) ||
          xq.poids - xp.poids ||
          (xp.procheUrbaine?.d ?? Infinity) - (xq.procheUrbaine?.d ?? Infinity) ||
          p.id.localeCompare(q.id)
        );
      });
      for (const m of liste.slice(0, VIP_PAR_REGION)) gardes.add(m.id);
    }
    for (const id of [...retenus]) if (!gardes.has(id)) retenus.delete(id);
  }

  return { retenus, parVille };
}

const { retenus: vipRetenus, parVille: vipParVille } = calculerVip();

/* ================================================================== */
/* Règles 3 à 6 — entrée et sortie, une seule de chaque par ville      */
/* ================================================================== */

/**
 * Les portes ne sont cherchées que parmi les barrages FIXES.
 *
 * Un barrage mobile est là aujourd'hui et ailleurs demain (voir l'en-tête de la
 * route consolidation) : faire de lui l'entrée unique d'une ville reviendrait à
 * déplacer la porte de la ville avec la patrouille. Les mobiles gardent
 * `positionVille: 'none'`.
 */
function calculerPortes() {
  const candidatsParVille = new Map();

  for (const m of barrages) {
    if (m.type !== 'barrage_fixe') continue;
    const x = mesures.get(m.id);
    const a = x.proche;
    if (!a) continue;
    /* Dans le tissu urbain : ce n'est pas une porte (et la zone relève de la
       DGSN quand elle est déclarée). */
    if (a.d < HORS_VILLE_KM || x.dansZonePolice) continue;
    /* Trop loin du bâti pour aborder cette ville. */
    if (a.d > a.a.rayonKm + MARGE_KM) continue;
    /* Une desserte locale n'est pas un axe d'accès. */
    if (x.poids === 0) continue;

    if (!candidatsParVille.has(a.a.nom)) candidatsParVille.set(a.a.nom, []);
    candidatsParVille.get(a.a.nom).push({
      m,
      poids: x.poids,
      classe: x.classe,
      d: a.d,
      azimut: azimut(a.a.lng, a.a.lat, m.lng, m.lat),
      ville: a.a,
    });
  }

  const entrees = new Map(); // nom de ville -> candidat
  const sorties = new Map();

  for (const [ville, liste] of candidatsParVille) {
    /* Ordre TOTAL et déterministe : l'identifiant tranche les ex æquo, pour que
       deux exécutions ne puissent pas désigner des postes différents. */
    liste.sort((p, q) => q.poids - p.poids || p.d - q.d || p.m.id.localeCompare(q.m.id));

    const entree = liste[0];
    entrees.set(ville, entree);

    /* La sortie doit être franchement de l'autre côté : au moins 90° d'écart. */
    const sortie = liste
      .slice(1)
      .find((c) => ecartAngle(c.azimut, entree.azimut) >= 90);
    if (sortie) sorties.set(ville, sortie);
  }

  return { candidatsParVille, entrees, sorties };
}

const { candidatsParVille, entrees, sorties } = calculerPortes();

const idsEntree = new Set([...entrees.values()].map((c) => c.m.id));
const idsSortie = new Set([...sorties.values()].map((c) => c.m.id));

/* ================================================================== */
/* Application (en mémoire) et relevé des changements                  */
/* ================================================================== */

const avant = {
  eclairage: {},
  positionVille: {},
  vip: 0,
};
const apres = { eclairage: {}, positionVille: {}, vip: 0 };
const compter = (o, cle) => {
  o[cle] = (o[cle] ?? 0) + 1;
};

/**
 * LES « NON ÉCLAIRÉ » — UN PAR RÉGION, LE PLUS ISOLÉ DE SES POSTES.
 *
 * PREMIÈRE VERSION, ET POURQUOI ELLE NE SUFFISAIT PAS
 * ---------------------------------------------------
 * Elle partait des postes que la géographie déclare isolés (à plus de
 * ISOLE_KM de tout) et n'en gardait qu'un par région. Résultat : quatre régions
 * à ZÉRO — Casablanca, Kénitra, Sidi Kacem, Tanger — parce qu'aucun de leurs
 * postes n'atteint ce seuil. Ces régions sont denses, c'était exact, mais la
 * règle demandée est « une par région », pas « une là où il y en a ».
 *
 * CE QUI EST FAIT
 * ---------------
 * Chaque région classe TOUS ses postes par isolement décroissant et désigne le
 * premier. Le seuil des 12 km ne sert plus de filtre d'entrée : il ne sert qu'à
 * dire, dans le compte rendu, si le poste retenu est franchement isolé ou
 * seulement le moins urbain de sa région.
 *
 * DEUX GARDE-FOUS, EUX, RESTENT ABSOLUS — « ne pas le placer au centre d'une
 * ville » :
 *   — jamais dans la tache urbaine d'une commune (écart au bâti > 0) ;
 *   — jamais dans un périmètre urbain déclaré de la Sûreté Nationale.
 *
 * Une région dont TOUS les postes sont en ville n'en reçoit donc aucun, et le
 * compte rendu le dit. Aucune n'est dans ce cas aujourd'hui.
 *
 * UN FIXE D'ABORD, ET CE N'EST PAS UN DÉTAIL D'ESTHÉTIQUE.
 *
 * Le type passe AVANT l'isolement, alors que l'isolement est le critère
 * géographique. Raison : l'Optimisation n'examine que les barrages FIXES (les
 * mobiles sont temporaires par nature — voir l'en-tête de la route
 * consolidation). Un non-éclairé désigné sur un mobile n'apparaît donc JAMAIS
 * dans le panneau ni sur la carte : la région semble n'en avoir aucun.
 *
 * C'est ce qui arrivait à six régions sur vingt-huit — Rabat, Agadir, Nador,
 * Khémisset, Tétouan, Sidi Kacem — dont le poste le plus isolé était un mobile.
 * Interrogée sur la région de Rabat, l'application répondait « 0 non éclairé ».
 *
 * On choisit donc le plus isolé PARMI LES FIXES, ce qui reste pleinement
 * justifié géographiquement, et on ne se rabat sur un mobile que si la région
 * n'a aucun fixe éligible.
 */
function retenirNonEclaires() {
  /* Hors ville, et hors périmètre urbain déclaré : le reste est trié. */
  const eligibles = barrages.filter((m) => {
    const x = mesures.get(m.id);
    if (x.dansZonePolice) return false;
    if (x.procheUrbaine && x.procheUrbaine.ecart <= 0) return false;
    return !(x.proche && x.proche.ecart <= 0);
  });

  /**
   * Le poste tient-il l'écart minimal avec tous ceux déjà retenus ?
   *
   * Comparaison linéaire : au plus quelques centaines de postes retenus, donc
   * quelques dizaines de milliers de distances au pire. Une grille spatiale
   * n'apporterait rien à cette échelle et se paierait en complexité.
   */
  const retenusPos = [];
  const assezLoin = (m) =>
    ECART_NUIT_KM <= 0 ||
    retenusPos.every((p) => distanceKm(m.lng, m.lat, p.lng, p.lat) >= ECART_NUIT_KM);
  const accepter = (m) => {
    retenusPos.push({ lng: m.lng, lat: m.lat });
    return m.id;
  };

  if (sansPlafond(NUIT_PAR_REGION)) {
    /* Sans plafond régional : tous les postes isolés, du plus isolé au moins
       isolé, chacun accepté s'il respecte l'écart avec les précédents. */
    const gardesLibres = new Set();
    const ordonnes = [...eligibles]
      .filter((m) => eclairageDe(m) === 'non')
      .sort(
        (p, q) =>
          mesures.get(q.id).isolementKm - mesures.get(p.id).isolementKm ||
          p.id.localeCompare(q.id)
      );
    for (const m of ordonnes) {
      if (assezLoin(m)) gardesLibres.add(accepter(m));
    }
    return gardesLibres;
  }

  const parRegion = new Map();
  for (const m of eligibles) {
    const reg = m.reg ?? '(sans région)';
    if (!parRegion.has(reg)) parRegion.set(reg, []);
    parRegion.get(reg).push(m);
  }

  const gardes = new Set();
  /** Le plus isolé d'abord — l'ordre est total, l'identifiant tranche. */
  const classer = (liste) =>
    [...liste].sort(
      (p, q) =>
        mesures.get(q.id).isolementKm - mesures.get(p.id).isolementKm ||
        p.id.localeCompare(q.id)
    );

  /**
   * ON ÉVITE LES PORTES DE VILLE, sans les interdire.
   *
   * Un poste ne devrait pas être à la fois « entrée de ville » et « la route non
   * éclairée de sa région » : sur la carte, un marqueur ne porte qu'un signe, et
   * le croissant masquerait alors le cadenas de la porte — on perdrait
   * l'information la plus structurante des deux. C'est ce qui arrivait à
   * Casablanca, dont tous les postes sont urbains.
   *
   * Ce n'est qu'une PRÉFÉRENCE : si une région n'a que des portes hors de son
   * bâti, elle en désigne une quand même. La règle « une par région » passe
   * devant le confort d'affichage.
   */
  const estPorte = (m) => idsEntree.has(m.id) || idsSortie.has(m.id);
  const estFixe = (m) => m.type === 'barrage_fixe';

  /* Régions parcourues dans un ordre FIXE : la contrainte des 2 km rend le
     résultat dépendant de l'ordre de passage, il ne doit donc rien devoir à
     l'ordre du fichier. */
  for (const region of [...parRegion.keys()].sort()) {
    const liste = parRegion.get(region);
    /**
     * ÉCHELLE DE PRÉFÉRENCE, du meilleur au dernier recours. À l'intérieur d'un
     * échelon, c'est toujours le plus isolé qui gagne.
     *
     *   1. un FIXE qui n'est pas une porte de ville  — le cas idéal
     *   2. un FIXE, porte de ville acceptée          — visible dans l'Optimisation
     *   3. un MOBILE hors porte                      — la région n'a aucun fixe
     *   4. n'importe lequel                          — pour ne jamais rendre 0
     *
     * Un candidat trop proche d'un poste DÉJÀ RETENU (ailleurs, y compris dans
     * une région voisine) est sauté : on descend dans la liste plutôt que de
     * violer l'écart minimal. Une région dont tous les candidats sont trop
     * proches n'en reçoit aucun — et l'audit le signale.
     */
    const echelons = [
      liste.filter((m) => estFixe(m) && !estPorte(m)),
      liste.filter(estFixe),
      liste.filter((m) => !estPorte(m)),
      liste,
    ];

    let pris = 0;
    for (const echelon of echelons) {
      for (const m of classer(echelon)) {
        if (pris >= NUIT_PAR_REGION) break;
        if (gardes.has(m.id) || !assezLoin(m)) continue;
        gardes.add(accepter(m));
        pris++;
      }
      if (pris >= NUIT_PAR_REGION) break;
    }
  }
  return gardes;
}

const nonEclairesRetenus = retenirNonEclaires();

const nouveau = new Map();
let missionsEffacees = 0;
for (const m of barrages) {
  compter(avant.eclairage, m.eclairage ?? 'inconnu');
  compter(avant.positionVille, m.positionVille ?? 'none');
  /* La formule du SERVEUR, pas la mienne : c'est elle qui décide à l'écran. */
  if (m.exceptionnel || m.missionId) avant.vip++;

  /**
   * Le poste désigné pour sa région est `non`, quoi qu'en dise le seuil des
   * 12 km : c'est le plus isolé qu'elle ait. Les autres ne sont jamais déclarés
   * `oui` par défaut — seule la règle urbaine peut le faire ; sinon `inconnu`.
   */
  const geographique = eclairageDe(m);
  const eclairage = nonEclairesRetenus.has(m.id)
    ? 'non'
    : geographique === 'non'
      ? 'inconnu'
      : geographique;
  const positionVille = idsEntree.has(m.id) ? 'entree' : idsSortie.has(m.id) ? 'sortie' : 'none';
  const exceptionnel = vipRetenus.has(m.id);
  /* Référence morte -> effacée ; référence valide -> conservée, et elle suffit
     à faire un VIP même si la règle géographique n'a pas retenu le poste : une
     mission enregistrée est un fait, pas une déduction. */
  const missionId = m.missionId && missionsReelles.has(m.missionId) ? m.missionId : null;
  if (m.missionId && !missionId) missionsEffacees++;

  compter(apres.eclairage, eclairage);
  compter(apres.positionVille, positionVille);
  if (exceptionnel || missionId) apres.vip++;

  nouveau.set(m.id, { eclairage, positionVille, exceptionnel, missionId });
}

/* ================================================================== */
/* Audit                                                              */
/* ================================================================== */

const ligne = (libelle, a, b) =>
  `  ${String(libelle).padEnd(26)} ${String(a).padStart(6)}  ->  ${String(b).padStart(6)}`;

console.log('');
console.log('AVANT / APRÈS');
console.log('-'.repeat(78));
console.log(ligne('éclairé (oui)', avant.eclairage.oui ?? 0, apres.eclairage.oui ?? 0));
console.log(ligne('non éclairé (non)', avant.eclairage.non ?? 0, apres.eclairage.non ?? 0));
console.log(ligne('éclairage inconnu', avant.eclairage.inconnu ?? 0, apres.eclairage.inconnu ?? 0));
console.log('');
console.log(ligne('entrée de ville', avant.positionVille.entree ?? 0, apres.positionVille.entree ?? 0));
console.log(ligne('sortie de ville', avant.positionVille.sortie ?? 0, apres.positionVille.sortie ?? 0));
console.log(ligne('porte (retirée)', avant.positionVille.porte ?? 0, apres.positionVille.porte ?? 0));
console.log(ligne('non classé', avant.positionVille.none ?? 0, apres.positionVille.none ?? 0));
console.log('');
console.log(ligne('barrages VIP', avant.vip, apres.vip));

/* ---- Contrôles qui doivent tous rendre zéro ---- */

const anomalies = [];
const verifier = (nom, liste) => {
  anomalies.push({ nom, n: liste.length, exemples: liste.slice(0, 3) });
};

/* Unicité — le contrôle demandé au point 10. */
const parVilleEntree = new Map();
const parVilleSortie = new Map();
for (const [ville] of candidatsParVille) {
  parVilleEntree.set(ville, entrees.has(ville) ? 1 : 0);
  parVilleSortie.set(ville, sorties.has(ville) ? 1 : 0);
}
verifier(
  'ville avec plus d’une entrée',
  [...parVilleEntree.entries()].filter(([, n]) => n > 1).map(([v]) => v)
);
verifier(
  'ville avec plus d’une sortie',
  [...parVilleSortie.entries()].filter(([, n]) => n > 1).map(([v]) => v)
);

/* Un même poste ne peut pas être entrée ET sortie. */
verifier(
  'poste à la fois entrée et sortie',
  [...idsEntree].filter((id) => idsSortie.has(id))
);

/* Cohérence géographique de chaque classification. */
verifier(
  '« non éclairé » dans une ville',
  barrages
    .filter((m) => nouveau.get(m.id).eclairage === 'non')
    .filter((m) => {
      const x = mesures.get(m.id);
      return x.dansZonePolice || (x.procheHabitee && x.procheHabitee.ecart <= 0);
    })
    .map((m) => m.nom || m.id)
);
/**
 * Le contrôle « non éclairé loin d'un chef-lieu » a été RETIRÉ, à dessein.
 *
 * Il exigeait que tout poste non éclairé soit à plus de ISOLE_KM d'une brigade.
 * C'était cohérent tant que la sélection partait du seuil ; ce n'est plus la
 * règle. Une région dense — Casablanca, Tanger — n'a aucun poste à douze
 * kilomètres de tout, et doit pourtant en désigner un. Le maintenir aurait fait
 * échouer l'audit sur la règle elle-même.
 *
 * Ce qui reste vérifié, et qui compte : jamais en ville (ci-dessus), et un seul
 * par région (ci-dessous). L'isolement réel de chaque poste retenu est imprimé
 * dans le compte rendu, région par région, pour être jugé à l'œil.
 */
verifier(
  'VIP hors contexte urbain',
  barrages
    .filter((m) => nouveau.get(m.id).exceptionnel)
    .filter((m) => {
      const a = mesures.get(m.id).procheUrbaine;
      return !a || a.ecart > ECART_VIP_KM || a.a.densite < DENSITE_URBAIN;
    })
    .map((m) => m.nom || m.id)
);
verifier(
  'VIP hors axe majeur',
  barrages
    .filter((m) => nouveau.get(m.id).exceptionnel && mesures.get(m.id).poids < POIDS_CLASSE.nationale)
    .map((m) => m.nom || m.id)
);
/**
 * LE CONTRÔLE QUI COMPTE VRAIMENT : celui qui applique la formule du SERVEUR.
 *
 * Les deux tests ci-dessus n'examinent que `exceptionnel`. Or l'application
 * affiche VIP dès que `exceptionnel || missionId` est vrai. Sans cette ligne, le
 * script pouvait se déclarer au vert en laissant 89 faux VIP à l'écran — c'est
 * précisément ce qui s'est produit au premier passage.
 */
verifier(
  'VIP à l’écran non justifié (formule serveur)',
  barrages
    .filter((m) => {
      const n = nouveau.get(m.id);
      if (!(n.exceptionnel || n.missionId)) return false;
      if (n.missionId) return false; // mission enregistrée : justification suffisante
      const a = mesures.get(m.id).procheUrbaine;
      return !a || a.ecart > ECART_VIP_KM;
    })
    .map((m) => m.nom || m.id)
);
/* Plafonds régionaux — le point même de la demande : pas plus d'un cas par région. */
const compterParRegion = (predicat) => {
  const c = new Map();
  for (const m of barrages) {
    if (!predicat(m)) continue;
    const reg = m.reg ?? '(sans région)';
    c.set(reg, (c.get(reg) ?? 0) + 1);
  }
  return c;
};
if (!sansPlafond(VIP_PAR_REGION)) {
  verifier(
    `région avec plus de ${VIP_PAR_REGION} VIP`,
    [...compterParRegion((m) => nouveau.get(m.id).exceptionnel || nouveau.get(m.id).missionId).entries()]
      .filter(([, n]) => n > VIP_PAR_REGION)
      .map(([r, n]) => `${r} (${n})`)
  );
}
if (!sansPlafond(NUIT_PAR_REGION)) {
  const nuitParRegion = compterParRegion((m) => nouveau.get(m.id).eclairage === 'non');
  verifier(
    `région avec plus de ${NUIT_PAR_REGION} non éclairé`,
    [...nuitParRegion.entries()].filter(([, n]) => n > NUIT_PAR_REGION).map(([r, n]) => `${r} (${n})`)
  );
  /* L'autre moitié de la règle : aucune région ne doit rester à zéro. */
  const regions = new Set(barrages.map((m) => m.reg ?? '(sans région)'));
  verifier(
    'région sans aucun non éclairé',
    [...regions].filter((r) => !nuitParRegion.has(r))
  );
}
/**
 * PORTE DE VILLE **ET** NON ÉCLAIRÉ — signalé, pas refusé.
 *
 * Ce n'est pas une erreur de donnée : les deux affirmations peuvent être vraies
 * du même poste. C'est une gêne d'AFFICHAGE — un marqueur ne porte qu'un signe,
 * et le croissant l'emporte sur le cadenas (voir `formeExclusion` dans
 * GendarmerieMap.jsx), de sorte que la porte ne se voit plus sur la carte. Sa
 * bulle, elle, énumère les deux motifs.
 *
 * La sélection évite déjà ce cas quand elle peut. Elle ne peut pas toujours :
 * Casablanca n'a qu'UN poste hors de son bâti, et c'est une porte. Refuser
 * l'écriture pour cela reviendrait à faire échouer l'audit sur la règle
 * demandée — « une par région » passe devant.
 */
const cumulPorteNuit = barrages.filter(
  (m) => nouveau.get(m.id).eclairage === 'non' && nouveau.get(m.id).positionVille !== 'none'
);
/**
 * ÉCART MINIMAL ENTRE NON ÉCLAIRÉS — vérifié sur toutes les paires.
 *
 * Contrôle indépendant de la sélection : il recompte les distances au lieu de
 * faire confiance à l'algorithme qui vient de les choisir. C'est le seul moyen
 * qu'une erreur d'ordre de parcours ou de comparaison ne passe pas inaperçue.
 */
const nuitRetenus = barrages.filter((m) => nouveau.get(m.id).eclairage === 'non');
const pairesTropProches = [];
let ecartMinNuit = Infinity;
for (let i = 0; i < nuitRetenus.length; i++) {
  for (let j = i + 1; j < nuitRetenus.length; j++) {
    const a = nuitRetenus[i];
    const b = nuitRetenus[j];
    const d = distanceKm(a.lng, a.lat, b.lng, b.lat);
    if (d < ecartMinNuit) ecartMinNuit = d;
    if (d < ECART_NUIT_KM) {
      pairesTropProches.push(
        `${d.toFixed(2)} km : ${a.reg}/${a.nom || a.id} — ${b.reg}/${b.nom || b.id}`
      );
    }
  }
}
verifier(`deux non éclairés à moins de ${ECART_NUIT_KM} km`, pairesTropProches);
verifier(
  'poste requalifié « éclairé » alors qu’il est isolé',
  barrages
    .filter((m) => nouveau.get(m.id).eclairage === 'oui' && eclairageDe(m) === 'non')
    .map((m) => m.nom || m.id)
);
verifier(
  'référence de mission morte encore présente',
  barrages
    .filter((m) => nouveau.get(m.id).missionId && !missionsReelles.has(nouveau.get(m.id).missionId))
    .map((m) => m.nom || m.id)
);
verifier(
  'porte dans le tissu urbain',
  barrages
    .filter((m) => nouveau.get(m.id).positionVille !== 'none')
    .filter((m) => mesures.get(m.id).proche.d < HORS_VILLE_KM || mesures.get(m.id).dansZonePolice)
    .map((m) => m.nom || m.id)
);
verifier(
  'porte hors de portée de sa ville',
  barrages
    .filter((m) => nouveau.get(m.id).positionVille !== 'none')
    .filter((m) => {
      const a = mesures.get(m.id).proche;
      return a.d > a.a.rayonKm + MARGE_KM;
    })
    .map((m) => m.nom || m.id)
);
verifier(
  'porte sur une route non majeure',
  barrages
    .filter((m) => nouveau.get(m.id).positionVille !== 'none' && mesures.get(m.id).poids === 0)
    .map((m) => m.nom || m.id)
);
verifier(
  'porte sur un barrage mobile',
  barrages
    .filter((m) => nouveau.get(m.id).positionVille !== 'none' && m.type !== 'barrage_fixe')
    .map((m) => m.nom || m.id)
);

/* Doublons de position : deux postes distincts au même endroit. Ce script ne les
   corrige pas — il les signale, c'est le rôle de nettoyer-positions-empilees. */
const parPosition = new Map();
for (const m of barrages) {
  const cle = `${m.lat.toFixed(4)}|${m.lng.toFixed(4)}`;
  parPosition.set(cle, (parPosition.get(cle) ?? 0) + 1);
}
const empiles = [...parPosition.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0);

console.log('');
console.log('AUDIT');
console.log('-'.repeat(78));
for (const { nom, n, exemples } of anomalies) {
  const marque = n === 0 ? 'OK  ' : 'ÉCHEC';
  console.log(`  ${marque} ${String(nom).padEnd(34)} ${String(n).padStart(4)}${n ? `   ex. ${exemples.join(', ')}` : ''}`);
}
console.log(`  INFO  ${'postes empilés (même position)'.padEnd(34)} ${String(empiles).padStart(4)}   (non corrigé ici)`);
console.log(
  `  INFO  ${'porte de ville ET non éclairé'.padEnd(34)} ${String(cumulPorteNuit.length).padStart(4)}   (le croissant masque le cadenas)`
);
for (const m of cumulPorteNuit.slice(0, 5)) {
  console.log(`        ${String(m.reg ?? '?').padEnd(16)} ${m.nom || m.id}`);
}

/**
 * FILET DE SÉCURITÉ SUR L'UNICITÉ — géométrique, pas nominal.
 *
 * Le contrôle ci-dessus compte une entrée par agglomération : il ne voit rien si
 * la même ville figure deux fois dans la liste des agglomérations sous deux
 * noms différents — c'est exactement ce qui est arrivé avec « Bouznika » et
 * « BT BOUZNIKA ». Deux entrées à moins de PROCHES_KM l'une de l'autre sont
 * donc signalées, quel que soit le nom de leur ville.
 *
 * Simple signalement, et non échec : deux vraies villes peuvent être voisines
 * (Rabat et Salé se touchent). C'est à l'œil humain de trancher, la liste est
 * courte.
 */
const PROCHES_KM = 6;
const paires = [];
const listeEntrees = [...entrees.entries()];
for (let i = 0; i < listeEntrees.length; i++) {
  for (let j = i + 1; j < listeEntrees.length; j++) {
    const [v1, c1] = listeEntrees[i];
    const [v2, c2] = listeEntrees[j];
    const d = distanceKm(c1.m.lng, c1.m.lat, c2.m.lng, c2.m.lat);
    if (d < PROCHES_KM) paires.push({ v1, v2, d });
  }
}
console.log(
  `  INFO  ${'entrées à moins de 6 km l’une de l’autre'.padEnd(34)} ${String(paires.length).padStart(4)}   (villes voisines ou doublon)`
);
for (const { v1, v2, d } of paires.slice(0, 8)) {
  console.log(`        ${d.toFixed(1).padStart(5)} km — ${v1} / ${v2}`);
}

/* ---- Pourquoi si peu de sorties : la structure du parc, pas le réglage ---- */

const tailles = new Map();
for (const [, liste] of candidatsParVille) {
  const n = Math.min(liste.length, 4);
  tailles.set(n, (tailles.get(n) ?? 0) + 1);
}

console.log('');
console.log(`Villes ayant au moins un axe majeur à leur porte : ${candidatsParVille.size}`);
console.log(`  dont avec une entrée                          : ${entrees.size}`);
console.log(`  dont avec une sortie distincte (≥ 90°)        : ${sorties.size}`);
console.log('');
console.log('  Candidats par ville — une ville à un seul poste ne peut pas avoir');
console.log('  une entrée ET une sortie ; on n’en fabrique pas une pour faire la paire :');
for (const n of [...tailles.keys()].sort()) {
  console.log(`    ${n === 4 ? '4 ou +' : `${n}     `} candidat(s) : ${String(tailles.get(n)).padStart(4)} ville(s)`);
}

/* ---- Ventilation régionale : la cohérence doit se voir ---- */

const parRegion = new Map();
for (const m of barrages) {
  const reg = m.reg ?? '(sans région)';
  if (!parRegion.has(reg)) {
    parRegion.set(reg, { total: 0, non: 0, oui: 0, vip: 0, entree: 0, sortie: 0 });
  }
  const r = parRegion.get(reg);
  const n = nouveau.get(m.id);
  r.total++;
  if (n.eclairage === 'non') r.non++;
  if (n.eclairage === 'oui') r.oui++;
  if (n.exceptionnel || n.missionId) r.vip++;
  if (n.positionVille === 'entree') r.entree++;
  if (n.positionVille === 'sortie') r.sortie++;
}

console.log('');
console.log(
  `PAR RÉGION — au plus ${VIP_PAR_REGION} VIP et ${NUIT_PAR_REGION} non éclairé chacune`
);
console.log('-'.repeat(78));
console.log(
  `  ${'Région'.padEnd(26)} ${'parc'.padStart(5)} ${'non écl.'.padStart(9)} ${'VIP'.padStart(4)} ${'entrées'.padStart(8)} ${'sorties'.padStart(8)}`
);
for (const [reg, r] of [...parRegion.entries()].sort((a, b) => b.total - a.total || String(a[0]).localeCompare(String(b[0])))) {
  console.log(
    `  ${String(reg).padEnd(26)} ${String(r.total).padStart(5)} ${String(r.non).padStart(9)} ${String(r.vip).padStart(4)} ${String(r.entree).padStart(8)} ${String(r.sortie).padStart(8)}`
  );
}

/* ---- Quelques exemples, pour juger à l'œil ---- */

const exemplesPortes = [...entrees.entries()]
  .filter(([ville]) => sorties.has(ville))
  .sort((a, b) => b[1].ville.densite - a[1].ville.densite)
  .slice(0, 8);

if (exemplesPortes.length) {
  console.log('');
  console.log('ENTRÉE / SORTIE — les huit plus grandes villes servies');
  console.log('-'.repeat(78));
  for (const [ville, e] of exemplesPortes) {
    const s = sorties.get(ville);
    console.log(
      `  ${ville.padEnd(22)} densité ${String(Math.round(e.ville.densite)).padStart(5)}  bâti ${e.ville.rayonKm.toFixed(1).padStart(4)} km`
    );
    console.log(
      `      entrée  ${String(e.classe).padEnd(10)} ${e.d.toFixed(1).padStart(5)} km  azimut ${String(Math.round(e.azimut)).padStart(3)}°  ${e.m.nom || '(sans nom)'}`
    );
    console.log(
      `      sortie  ${String(s.classe).padEnd(10)} ${s.d.toFixed(1).padStart(5)} km  azimut ${String(Math.round(s.azimut)).padStart(3)}°  écart ${String(Math.round(ecartAngle(s.azimut, e.azimut))).padStart(3)}°  ${s.m.nom || '(sans nom)'}`
    );
  }
}

/* ---- Le contrôle obligatoire : une ligne par région, et le poste désigné ---- */

/**
 * UNE RÉGION = UN SEUL BARRAGE NON ÉCLAIRÉ.
 *
 * Les « régions » sont celles de ce projet : les 28 régions de gendarmerie de
 * `circo_reg.geojson`, celles que porte le champ `reg` de chaque barrage et que
 * liste le sélecteur du panneau Optimisation. Ce ne sont pas les 12 régions
 * administratives du Maroc, qui ne figurent dans aucune couche.
 *
 * Le verdict est donné sous la forme MIN / MAX : c'est la seule qui prouve la
 * règle d'un coup d'œil, sans avoir à parcourir vingt-huit lignes.
 */
const regionsConnues = [...new Set(barrages.map((m) => m.reg ?? '(sans région)'))];
const nuitParRegionFinal = new Map(regionsConnues.map((r) => [r, 0]));
for (const m of barrages) {
  if (nouveau.get(m.id).eclairage !== 'non') continue;
  const r = m.reg ?? '(sans région)';
  nuitParRegionFinal.set(r, (nuitParRegionFinal.get(r) ?? 0) + 1);
}
const comptes = [...nuitParRegionFinal.values()];
const minNuit = Math.min(...comptes);
const maxNuit = Math.max(...comptes);

console.log('');
console.log('NON ÉCLAIRÉ — UNE RÉGION = UN SEUL');
console.log('-'.repeat(78));
console.log(
  `  ${regionsConnues.length} régions (celles de la gendarmerie, champ « reg »)  ` +
    `MIN = ${minNuit}   MAX = ${maxNuit}   total = ${comptes.reduce((s, n) => s + n, 0)}`
);
console.log(
  minNuit === NUIT_PAR_REGION && maxNuit === NUIT_PAR_REGION
    ? `  RÈGLE RESPECTÉE : exactement ${NUIT_PAR_REGION} par région, sans exception.`
    : `  RÈGLE VIOLÉE : ${[...nuitParRegionFinal.entries()].filter(([, n]) => n !== NUIT_PAR_REGION).map(([r, n]) => `${r}=${n}`).join(', ')}`
);
console.log(
  `  Écart minimal entre deux non éclairés : ${Number.isFinite(ecartMinNuit) ? ecartMinNuit.toFixed(2) : '—'} km ` +
    `(minimum exigé : ${ECART_NUIT_KM} km) — ${pairesTropProches.length} paire(s) en défaut`
);
console.log('');
console.log('  Le poste désigné dans chacune, et pourquoi lui :');
const retenusNuit = barrages
  .filter((m) => nouveau.get(m.id).eclairage === 'non')
  .sort((a, b) => mesures.get(b.id).isolementKm - mesures.get(a.id).isolementKm);
for (const m of retenusNuit) {
  const x = mesures.get(m.id);
  const franchement = x.isolementKm > ISOLE_KM ? 'isolé' : 'le moins urbain';
  console.log(
    `  ${String(m.reg ?? '(sans région)').padEnd(16)} 1  ${x.isolementKm.toFixed(1).padStart(6)} km de tout habité  ` +
      `${String(m.type === 'barrage_fixe' ? 'fixe' : 'mobile').padEnd(6)} ${String(m.route || '—').padEnd(7)} ${franchement.padEnd(15)} ${(m.nom || '(sans nom)').slice(0, 24)}`
  );
}
const nbFixes = retenusNuit.filter((m) => m.type === 'barrage_fixe').length;
console.log('');
console.log(
  `  ${retenusNuit.length} régions servies · ${nbFixes} fixe(s) et ${retenusNuit.length - nbFixes} mobile(s) · ` +
    `${retenusNuit.filter((m) => mesures.get(m.id).isolementKm > ISOLE_KM).length} franchement isolé(s) (> ${ISOLE_KM} km)`
);

const villesVip = [...vipParVille.entries()]
  .filter(([, l]) => l.some(({ m }) => vipRetenus.has(m.id)))
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 10);
if (villesVip.length) {
  console.log('');
  console.log('VIP — agglomérations concernées (candidats -> retenus)');
  console.log('-'.repeat(78));
  for (const [ville, liste] of villesVip) {
    const n = liste.filter(({ m }) => vipRetenus.has(m.id)).length;
    console.log(`  ${ville.padEnd(24)} ${String(liste.length).padStart(3)} candidat(s) -> ${n} retenu(s)`);
  }
}

/* ================================================================== */
/* Écriture                                                           */
/* ================================================================== */

const echecs = anomalies.filter((a) => a.n > 0);

if (!drapeau('ecrire')) {
  console.log('');
  console.log(
    echecs.length
      ? `${echecs.length} contrôle(s) en échec — corrigez avant d’écrire.`
      : 'Tous les contrôles passent.'
  );
  console.log('Aperçu seulement — rien n’a été écrit. Ajoutez --ecrire pour appliquer.');
  console.log('');
  process.exit(echecs.length ? 1 : 0);
}

if (echecs.length) {
  console.log('');
  console.log("ÉCRITURE REFUSÉE : l'audit ci-dessus n'est pas au vert.");
  console.log('');
  process.exit(1);
}

/**
 * LA PREMIÈRE SAUVEGARDE EST LA BONNE — on ne l'écrase jamais.
 *
 * Le script est fait pour être relancé (il est idempotent, et on ajuste les
 * seuils par essais). Recopier le dépôt à chaque passage remplaçait donc « l'état
 * d'avant » par « l'état d'après le passage précédent » : au deuxième essai, la
 * sauvegarde ne servait plus à rien. C'est arrivé.
 *
 * Le dépôt garde par ailleurs une copie quotidienne prise avant la première
 * écriture du jour (voir `sauvegarder` dans serveur/depot.mjs) : la voie de
 * retour existe même sans celle-ci.
 */
const sauvegarde = join(ROOT, 'donnees-serveur/marquages.avant-reclassement.json');
const dejaSauve = existsSync(sauvegarde);
if (!dejaSauve) copyFileSync(FICHIER, sauvegarde);

let modifies = 0;
for (const m of items) {
  const n = nouveau.get(m.id);
  if (!n) continue; // pas un barrage : intact
  const change =
    m.eclairage !== n.eclairage ||
    m.positionVille !== n.positionVille ||
    Boolean(m.exceptionnel) !== n.exceptionnel ||
    (m.missionId ?? null) !== n.missionId;
  if (!change) continue;
  m.eclairage = n.eclairage;
  m.positionVille = n.positionVille;
  m.exceptionnel = n.exceptionnel;
  m.missionId = n.missionId;
  modifies++;
}

writeFileSync(FICHIER, JSON.stringify(depot, null, 2), 'utf8');

console.log('');
console.log(
  `${modifies} barrage(s) reclassé(s) — seuls eclairage, positionVille, exceptionnel et missionId ont changé.`
);
if (missionsEffacees) {
  console.log(`${missionsEffacees} référence(s) de mission morte(s) effacée(s).`);
}
console.log(
  dejaSauve
    ? `Sauvegarde déjà présente, conservée intacte : ${sauvegarde}`
    : `Sauvegarde : ${sauvegarde}`
);
console.log('IMPORTANT  : redémarrez le serveur — le dépôt est lu au démarrage.');
console.log('');
