/**
 * Prétraitement des données brutes -> couches web légères.
 *
 *   data/**                ->  public/layers/*.geojson
 *
 * POUR AJOUTER / CHANGER UN FICHIER : modifiez UNIQUEMENT le tableau SOURCES
 * ci-dessous, puis relancez `npm run build:layers`.
 * Voir README.md, section « Ajouter une couche ».
 *
 * Les polygones sont simplifiés avec mapshaper en mode topologique : les
 * frontières partagées entre circonscriptions voisines restent jointives
 * (ni trous ni chevauchements après simplification).
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';
import * as turf from '@turf/turf';

/* ================================================================== */
/*  SOURCES — LE SEUL BLOC À MODIFIER                                 */
/* ================================================================== */

const SOURCES = [
  /* ---------------- Points d'implantation ---------------- */
  {
    kind: 'points',
    in: 'dataPoint/bt.json',
    out: 'pts_bt.geojson',
    // Cible <- champ source (ou liste de champs, le premier non vide gagne)
    props: { nom: 'Unite', cie: 'Compagnie', reg: 'Region' },
  },
  {
    kind: 'points',
    in: 'dataPoint/cie.json',
    out: 'pts_cie.geojson',
    props: {
      nom: ['denom_fr', 'compagnie'],
      unite: 'compagnie',
      categorie: ['categorie', 'INFRA_TYPE'],
    },
  },
  {
    kind: 'points',
    in: 'dataPoint/reg.json',
    out: 'pts_reg.geojson',
    props: {
      nom: ['denom_fr', 'compagnie'],
      unite: 'compagnie',
      categorie: ['categorie', 'INFRA_TYPE'],
    },
  },

  /* ---------------- Pointages de flottes (dump Mongo) ---------------- */
  {
    kind: 'pointages',
    in: 'Flottes.pointages.json',
    out: 'pointages.geojson',
    /**
     * true  : Point.coordinates est [latitude, longitude]  (cas de ce dump)
     * false : Point.coordinates est [longitude, latitude]  (ordre GeoJSON standard)
     */
    latFirst: true,
    /**
     * Rattachement territorial : chaque pointage est localisé dans les
     * circonscriptions BT, ce qui remplit `bde` / `cie` / `reg` et sert en
     * même temps de masque — un point hors de toute circonscription est hors
     * territoire (mer, hors frontières) et donc rejeté.
     * Mettre à null pour ne ni rattacher ni filtrer.
     */
    locate: {
      file: 'Circonscription/Circonscription_Bt.json',
      props: { bde: 'gr_bde', cie: 'gr_cie', reg: 'gr_region' },
    },
  },

  /* ---------------- Circonscriptions (polygones) ---------------- */
  {
    kind: 'polygons',
    in: 'Circonscription/Circonscription_Bt.json',
    out: 'circo_bt.geojson',
    simplify: '4%', // baisser = plus léger / moins précis
    keep: 'gr_bde,gr_cie,gr_region,population,superficie',
  },
  /**
   * Ces deux fichiers sont des GeometryCollection NUES : aucun attribut, donc
   * aucun nom. `attribuer` les identifie en les recoupant avec les
   * circonscriptions BT, seules porteuses de `gr_bde / gr_cie / gr_region` :
   * chaque polygone hérite du nom majoritaire parmi les BT qu'il contient,
   * puis des agrégats de ce groupe (nombre d'unités, population, superficie).
   *
   * Les polygones deviennent ainsi cliquables et analysables, sans dépendre du
   * chargement des 1,5 Mo de circonscriptions BT côté navigateur.
   */
  {
    kind: 'polygons',
    in: 'Circonscription/Circonscription_Compagnies.json',
    out: 'circo_cie.geojson',
    simplify: '6%',
    attribuer: {
      depuis: 'Circonscription/Circonscription_Bt.json',
      cle: 'gr_cie',
      aussi: { reg: 'gr_region' },
    },
  },
  {
    kind: 'polygons',
    in: 'Circonscription/Circonscription_Region.json',
    out: 'circo_reg.geojson',
    simplify: '6%',
    attribuer: {
      depuis: 'Circonscription/Circonscription_Bt.json',
      cle: 'gr_region',
    },
  },
];

/** Emprise de contrôle : tout point en dehors est rejeté. */
const BBOX_MAROC = { lngMin: -18, lngMax: 0, latMin: 20, latMax: 37 };

/* ================================================================== */
/*  Moteur — inutile de toucher en dessous                            */
/* ================================================================== */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const OUT = resolve(ROOT, 'public/layers');

mkdirSync(OUT, { recursive: true });

const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' Mo';

/**
 * Rapport de build, écrit dans public/layers/_report.json.
 *
 * L'application le lit pour afficher la section « qualité des données » : les
 * anomalies constatées ici (points sans coordonnées, pointages hors territoire,
 * polygones sans attributs) restent ainsi exactes même quand les fichiers
 * sources changent, au lieu d'être recopiées en dur dans l'interface.
 */
const report = { layers: {}, issues: [] };

const issue = (level, message, count = null) => {
  report.issues.push({ level, message, count });
};

/** Un point est exploitable seulement si lon/lat sont deux nombres finis. */
const hasCoords = (c) =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);

const inBbox = ([lng, lat]) =>
  lng >= BBOX_MAROC.lngMin &&
  lng <= BBOX_MAROC.lngMax &&
  lat >= BBOX_MAROC.latMin &&
  lat <= BBOX_MAROC.latMax;

/** Réduit la précision des coordonnées (5 décimales ~ 1 m). */
const round = ([lng, lat], d = 5) => [+lng.toFixed(d), +lat.toFixed(d)];

/** Applique la table `props` : cible <- premier champ source non vide. */
function mapProps(src, table) {
  const out = {};
  for (const [target, from] of Object.entries(table)) {
    const candidates = Array.isArray(from) ? from : [from];
    out[target] = candidates.map((f) => src[f]).find((v) => v != null) ?? null;
  }
  return out;
}

function writeOut(name, geojson, extra = {}) {
  const path = resolve(OUT, name);
  writeFileSync(path, JSON.stringify(geojson));
  console.log(
    `  -> public/layers/${name}  (${geojson.features.length} entités, ${mb(path)})`
  );
  report.layers[name.replace('.geojson', '')] = {
    entites: geojson.features.length,
    taille: mb(path),
    ...extra,
  };
}

/* ------------------------- points ------------------------- */

function buildPoints(cfg, raw) {
  const feats = raw.features ?? [];
  const kept = feats.filter((f) => hasCoords(f?.geometry?.coordinates));
  const dropped = feats.length - kept.length;
  if (dropped) {
    console.log(
      `  ! ${dropped}/${feats.length} points écartés : coordonnées nulles dans la source`
    );
    issue(
      'critical',
      `${dropped} des ${feats.length} unités de ${cfg.in} ont des coordonnées nulles : absentes de la carte`,
      dropped
    );
  }

  writeOut(
    cfg.out,
    {
      type: 'FeatureCollection',
      features: kept.map((f) => ({
        type: 'Feature',
        properties: mapProps(f.properties || {}, cfg.props),
        geometry: { type: 'Point', coordinates: round(f.geometry.coordinates) },
      })),
    },
    { source: cfg.in, sourceEntites: feats.length, ecartes: dropped }
  );
}

/* ------------------- localisation dans des polygones ------------------- */

/**
 * Construit un localisateur « dans quel polygone tombe ce point ? ».
 *
 * Chaque polygone est indexé par sa boîte englobante : le test coûteux
 * (point-dans-polygone) n'est tenté que sur les candidats, ce qui rend la
 * localisation de milliers de points instantanée.
 *
 * Retourne une fonction ([lng, lat]) -> propriétés du polygone contenant,
 * ou null si le point n'est dans aucun.
 */
function buildLocator(file, label = 'localisateur') {
  const raw = JSON.parse(readFileSync(resolve(DATA, file), 'utf8'));
  const fc = toFeatureCollection(raw);

  const polys = fc.features
    .filter((f) => f.geometry && /Polygon$/.test(f.geometry.type))
    .map((f) => ({ props: f.properties || {}, feature: f, bbox: turf.bbox(f) }));

  console.log(`  ${label} : ${polys.length} polygones (${file})`);

  return ([lng, lat]) => {
    for (const { props, feature, bbox } of polys) {
      if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      if (turf.booleanPointInPolygon([lng, lat], feature)) return props;
    }
    return null;
  };
}

/* ---------------------- pointages Mongo ---------------------- */

function buildPointages(cfg, raw) {
  const rows = Array.isArray(raw) ? raw : (raw.features ?? []);

  const withCoords = rows.filter((r) => hasCoords(r?.Point?.coordinates));
  if (withCoords.length < rows.length) {
    console.log(`  ! ${rows.length - withCoords.length} pointages sans coordonnées valides`);
  }

  const locate = cfg.locate
    ? buildLocator(cfg.locate.file, 'rattachement territorial')
    : null;

  const features = withCoords
    .map((r) => {
      const c = r.Point.coordinates;
      // Rétablit l'ordre GeoJSON [lng, lat] quel que soit l'ordre de la source.
      const lngLat = cfg.latFirst ? [c[1], c[0]] : [c[0], c[1]];
      return {
        type: 'Feature',
        properties: {
          id: r._id?.$oid ?? r.id ?? null,
          unite: r.uniteName ?? null,
          uniteId: r.uniteId ?? null,
          pk: r.pkName ?? null,
          mission: r.service?.mission ?? null,
          sousMission: r.service?.subMission ?? null,
          diametre: r.diameter ?? null, // mètres
          debut: r.startDate?.$date ?? r.startDate ?? null,
          fin: r.endDate?.$date ?? r.endDate ?? null,
        },
        geometry: { type: 'Point', coordinates: round(lngLat) },
      };
    })
    .filter((f) => inBbox(f.geometry.coordinates));

  const offBbox = withCoords.length - features.length;
  if (offBbox) console.log(`  ! ${offBbox} pointages hors emprise Maroc, rejetés`);

  /**
   * Rattachement + filtrage en une passe : un pointage hors de toute
   * circonscription est hors territoire, et est donc écarté.
   */
  let kept = features;
  if (locate) {
    kept = [];
    for (const f of features) {
      const hit = locate(f.geometry.coordinates);
      if (!hit) continue;
      for (const [target, from] of Object.entries(cfg.locate.props)) {
        f.properties[target] = hit[from] ?? null;
      }
      kept.push(f);
    }

    const off = features.length - kept.length;
    if (off) {
      const pct = Math.round((off / features.length) * 100);
      console.log(
        `  ! ${off} pointages hors territoire (mer / hors frontières), rejetés — ${pct} % du fichier`
      );
      issue(
        pct > 20 ? 'critical' : 'warning',
        `${off} pointages sur ${features.length} (${pct} %) tombent hors de toute circonscription : données de test générées aléatoirement`,
        off
      );
    }
    const regions = new Set(kept.map((f) => f.properties.reg).filter(Boolean));
    console.log(`  rattachés : ${kept.length} pointages sur ${regions.size} régions`);

    /**
     * Un champ qui ne prend qu'une seule valeur sur tout le fichier ne porte
     * aucune information : c'est le marqueur d'un jeu de test.
     */
    const constants = ['pk', 'mission', 'sousMission', 'diametre', 'debut', 'fin'].filter(
      (k) => new Set(kept.map((f) => f.properties[k])).size === 1
    );
    if (constants.length) {
      console.log(`  ! champs constants (aucune variation) : ${constants.join(', ')}`);
      issue(
        'serious',
        `${constants.length} champs des pointages n'ont qu'une seule valeur sur tout le fichier (${constants.join(', ')}) : aucune information exploitable`,
        constants.length
      );
    }

    writeOut(
      cfg.out,
      { type: 'FeatureCollection', features: kept },
      { source: cfg.in, sourceEntites: rows.length, rejetesHorsTerritoire: off }
    );
    return;
  }

  writeOut(cfg.out, { type: 'FeatureCollection', features: kept });
}

/* ------------------------ polygones ------------------------ */

/**
 * Certains fichiers sont des GeometryCollection nues (AUCUN attribut) :
 * on les convertit en FeatureCollection indexée pour pouvoir les afficher.
 */
function toFeatureCollection(raw) {
  if (raw.type === 'FeatureCollection') return raw;
  if (raw.type === 'GeometryCollection') {
    return {
      type: 'FeatureCollection',
      features: raw.geometries.map((g, i) => ({
        type: 'Feature',
        properties: { idx: i },
        geometry: g,
      })),
    };
  }
  if (Array.isArray(raw)) {
    return { type: 'FeatureCollection', features: raw };
  }
  throw new Error('Type GeoJSON non géré : ' + raw.type);
}

/** Fichiers volumineux : évite de reparser 52 Mo à chaque couche. */
const cacheSources = new Map();
const lireSource = (file) => {
  if (!cacheSources.has(file)) {
    cacheSources.set(file, JSON.parse(readFileSync(resolve(DATA, file), 'utf8')));
  }
  return cacheSources.get(file);
};

/**
 * Nomme des polygones anonymes par vote majoritaire.
 *
 * Pour chaque polygone cible, on compte les unités de référence dont le point
 * représentatif tombe à l'intérieur, et on retient la valeur de `cle` la plus
 * fréquente. Le vote majoritaire — plutôt qu'un simple « premier trouvé » —
 * rend l'attribution insensible aux petits décalages de frontière entre les
 * deux jeux de données.
 *
 * Les agrégats sont ensuite calculés en regroupant TOUTES les unités portant ce
 * nom, et non seulement celles géométriquement contenues : les totaux
 * coïncident ainsi exactement avec ceux du panneau d'analyse.
 */
function attribuerPolygones(fc, spec, etiquette) {
  const ref = toFeatureCollection(lireSource(spec.depuis));

  const unites = ref.features
    .filter((f) => f.geometry && f.properties?.[spec.cle])
    .map((f) => {
      const p = turf.pointOnFeature(f); // garanti à l'intérieur, contrairement au centroïde
      return { props: f.properties, lngLat: p.geometry.coordinates };
    });

  // Agrégats par valeur de clé, sur l'ensemble des unités
  const agregats = new Map();
  for (const u of unites) {
    const k = u.props[spec.cle];
    const a = agregats.get(k) ?? { nbBt: 0, population: 0, superficie: 0, cies: new Set() };
    a.nbBt++;
    a.population += u.props.population || 0;
    a.superficie += u.props.superficie || 0;
    if (u.props.gr_cie) a.cies.add(u.props.gr_cie);
    agregats.set(k, a);
  }

  let nommes = 0;
  for (const cible of fc.features) {
    if (!cible.geometry) continue;
    const bbox = turf.bbox(cible);

    const votes = new Map();
    for (const u of unites) {
      const [lng, lat] = u.lngLat;
      if (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      if (!turf.booleanPointInPolygon(u.lngLat, cible)) continue;
      const k = u.props[spec.cle];
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }

    if (votes.size === 0) continue;

    const [nom, voix] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    const total = [...votes.values()].reduce((s, v) => s + v, 0);
    const a = agregats.get(nom);

    cible.properties = {
      nom,
      nbBt: a.nbBt,
      nbCie: a.cies.size,
      population: Math.round(a.population),
      superficie: Math.round(a.superficie),
      /** Part des votes obtenue par le nom retenu : 1 = attribution nette. */
      confiance: +(voix / total).toFixed(2),
      ...(spec.aussi
        ? Object.fromEntries(
            Object.entries(spec.aussi).map(([cible2, source]) => {
              // valeur la plus fréquente du champ secondaire parmi les unités du groupe
              const c = new Map();
              for (const u of unites) {
                if (u.props[spec.cle] !== nom) continue;
                const v = u.props[source];
                if (v != null) c.set(v, (c.get(v) ?? 0) + 1);
              }
              const meilleur = [...c.entries()].sort((x, y) => y[1] - x[1])[0];
              return [cible2, meilleur ? meilleur[0] : null];
            })
          )
        : {}),
    };
    nommes++;
  }

  const ambigus = fc.features.filter(
    (f) => f.properties?.confiance != null && f.properties.confiance < 0.8
  ).length;

  console.log(
    `  attribution : ${nommes}/${fc.features.length} polygones nommés via ${spec.cle}` +
      (ambigus ? ` (${ambigus} sous 80 % de votes concordants)` : '')
  );

  if (nommes < fc.features.length) {
    issue(
      'warning',
      `${fc.features.length - nommes} polygones de ${etiquette} n'ont pu être nommés : aucune unité de référence à l'intérieur`,
      fc.features.length - nommes
    );
  }

  if (ambigus) {
    const pires = fc.features
      .filter((f) => f.properties?.confiance != null && f.properties.confiance < 0.8)
      .sort((a, b) => a.properties.confiance - b.properties.confiance)
      .slice(0, 3)
      .map((f) => `${f.properties.nom} ${Math.round(f.properties.confiance * 100)} %`);
    issue(
      'warning',
      `${ambigus} contours de ${etiquette} nommés sur des votes partagés (${pires.join(', ')}) : les limites des deux jeux de données divergent`,
      ambigus
    );
  }

  /** Valeurs de référence sans aucun polygone : découpages désynchronisés. */
  const attribues = new Set(fc.features.map((f) => f.properties?.nom).filter(Boolean));
  const absents = [...agregats.keys()].filter((k) => !attribues.has(k));
  if (absents.length) {
    issue(
      'warning',
      `${absents.length} valeurs de ${spec.cle} n'ont aucun contour correspondant (${absents.slice(0, 4).join(', ')}) : contours plus anciens que le découpage des BT`,
      absents.length
    );
  }

  return { nommes, ambigus };
}

async function buildPolygons(cfg, raw) {
  const fc = toFeatureCollection(raw);

  let attribution = null;
  if (cfg.attribuer) {
    attribution = attribuerPolygones(fc, cfg.attribuer, cfg.in);
  }

  /**
   * Champs conservés. Pour une couche attribuée, la liste est déduite de la
   * spécification : les champs secondaires (`aussi`) n'existent que là où ils
   * ont été demandés — mapshaper échoue si on lui nomme un champ absent.
   */
  const champs =
    cfg.keep ??
    (cfg.attribuer
      ? [
          'nom',
          'nbBt',
          'nbCie',
          'population',
          'superficie',
          'confiance',
          ...Object.keys(cfg.attribuer.aussi ?? {}),
        ].join(',')
      : null);

  const cmd = [
    '-i input.json',
    champs ? `-filter-fields ${champs}` : '',
    // visvalingam + keep-shapes : simplification topologique, aucune entité perdue
    `-simplify ${cfg.simplify ?? '5%'} visvalingam keep-shapes`,
    '-clean',
    '-o precision=0.00001 out.geojson',
  ]
    .filter(Boolean)
    .join(' ');

  const result = await mapshaper.applyCommands(cmd, {
    'input.json': JSON.stringify(fc),
  });

  if (!champs) {
    issue(
      'warning',
      `${cfg.in} est une GeometryCollection sans aucun attribut : ces contours ne peuvent être ni nommés ni rattachés`,
      null
    );
  }

  writeOut(cfg.out, JSON.parse(result['out.geojson']), {
    source: cfg.in,
    simplification: cfg.simplify ?? '5%',
    attributs: champs,
    ...(attribution ? { nommesParVote: attribution.nommes } : {}),
  });
}

/* --------------------------- run --------------------------- */

const BUILDERS = {
  points: buildPoints,
  pointages: buildPointages,
  polygons: buildPolygons,
};

let ok = 0;
for (const [i, cfg] of SOURCES.entries()) {
  const inPath = resolve(DATA, cfg.in);
  console.log(`\n[${i + 1}/${SOURCES.length}] ${cfg.in} -> ${cfg.out}`);

  if (!existsSync(inPath)) {
    console.log(`  ! FICHIER ABSENT : data/${cfg.in} — couche ignorée`);
    continue;
  }
  console.log(`  source : ${mb(inPath)}`);

  const build = BUILDERS[cfg.kind];
  if (!build) {
    console.log(`  ! kind inconnu : "${cfg.kind}" (attendu : ${Object.keys(BUILDERS).join(' | ')})`);
    continue;
  }

  await build(cfg, JSON.parse(readFileSync(inPath, 'utf8')));
  ok++;
}

/* Rapport lu par l'application (section « qualité des données »). */
report.couches = ok;
report.couchesAttendues = SOURCES.length;
writeFileSync(resolve(OUT, '_report.json'), JSON.stringify(report, null, 2));

console.log(`\nTerminé : ${ok}/${SOURCES.length} couches générées.`);
console.log(`Rapport : public/layers/_report.json (${report.issues.length} anomalie(s))\n`);
