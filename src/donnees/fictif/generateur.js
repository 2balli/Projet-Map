/**
 * GÉNÉRATEUR DE JEU FICTIF — déterministe, et géographiquement cohérent.
 *
 * TOUT EST INVENTÉ SAUF LA GÉOGRAPHIE. Les découpages (régions, compagnies,
 * brigades) viennent des couches que la carte charge déjà — ce sont des
 * limites administratives, pas un renseignement opérationnel, et les
 * réinventer casserait tout le reste : le regroupement des barrages, les
 * limites affichées selon le zoom et le cloisonnement par unité reposent sur
 * ces NOMS. Un « Brigade A1 » imaginaire n'aurait aucun contour à habiter.
 *
 * Est fabriqué de toutes pièces, et marqué comme tel :
 *   — le personnel      (matricules `DEMO-…`, noms suffixés `DEMO`) ;
 *   — les barrages      (identifiants `BAR-…`, noms « Barrage DEMO … ») ;
 *   — les relèves       (identifiants `EL-…`).
 *
 * Aucun militaire réel, aucun matricule réel, aucun poste réellement tenu.
 *
 * DÉTERMINISME. Même graine, même jeu : les repères tombent aux mêmes mètres,
 * les effectifs portent les mêmes noms. C'est ce qui permet de comparer deux
 * exécutions, de rejouer une anomalie, et d'écrire des épreuves stables
 * (voir scripts/verifier-fictif.mjs).
 *
 * PLACEMENT DES REPÈRES. Chaque barrage tombe DANS le contour de sa brigade,
 * par tirage rejeté sur la boîte englobante. Semer au hasard sur le Maroc
 * aurait produit un jeu joli et faux : un poste attribué à Dakhla apparaissant
 * près de Tanger fausse le regroupement, le cloisonnement et toute lecture de
 * la carte.
 */
import { bbox, booleanPointInPolygon, pointOnFeature } from '@turf/turf';
import { ELEMENTS_PAR_BARRAGE } from '../../marquages.js';

/* ================================================================== */
/*  Tirage reproductible                                              */
/* ================================================================== */

/** Mulberry32 : court, rapide, et suffisant pour semer un jeu d'épreuve. */
function tirage(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const entre = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1));
const dans = (rnd, liste) => liste[Math.floor(rnd() * liste.length)];
const numero = (n, largeur) => String(n).padStart(largeur, '0');

/* ================================================================== */
/*  Vocabulaire fictif                                                */
/* ================================================================== */

/** Grades réellement employés par l'application (voir src/ElementsCreneau.jsx). */
export const GRADES = ['MDLG', 'MDLC', 'ADJT', 'A/C'];

/** Répartition plausible d'un poste : beaucoup de gendarmes, peu de gradés. */
const VIVIER_GRADES = ['MDLG', 'MDLG', 'MDLG', 'MDLG', 'MDLC', 'MDLC', 'ADJT', 'A/C'];

/**
 * Prénoms et noms marocains courants — vraisemblables et ANONYMES : ils ne
 * désignent personne, et le suffixe `DEMO` porté par chaque nom complet
 * interdit de prendre un élément fictif pour un militaire réel.
 */
const PRENOMS = ['Youssef', 'Karim', 'Mehdi', 'Anas', 'Hamza', 'Reda', 'Omar', 'Ayoub',
  'Bilal', 'Nabil', 'Tarik', 'Amine', 'Samir', 'Rachid', 'Khalid', 'Yassine'];
const NOMS = ['Alaoui', 'Bennani', 'Chraibi', 'Daoudi', 'El Amrani', 'Fassi', 'Guerrouj',
  'Haddad', 'Idrissi', 'Jbari', 'Kettani', 'Lahlou', 'Mansouri', 'Naciri', 'Ouazzani', 'Raji'];

/** Pourquoi un élément n'est pas disponible — vocabulaire de service. */
const MOTIFS_INDISPONIBILITE = ['permission', 'mission extérieure', 'stage', 'maladie', 'repos'];

/** Motifs d'implantation — vocabulaire de service, sans contenu opérationnel. */
const MOTIFS = ['Contrôle routier DEMO', 'Point de passage DEMO', 'Axe surveillé DEMO',
  'Entrée de ville DEMO', 'Sortie autoroute DEMO', 'Carrefour accidentogène DEMO'];

/** Statuts de validation — EXACTEMENT ceux de l'application (marquages.js). */
const STATUTS = ['en_attente', 'approuve', 'approuve', 'approuve', 'a_modifier', 'annule'];

/** Natures de barrage supportées par l'application. */
const TYPES = ['barrage_fixe', 'barrage_fixe', 'barrage_mobile'];

const CRENEAUX = [0, 6, 12, 18];

/* ================================================================== */
/*  Découpages : ce que la carte a déjà téléchargé                    */
/* ================================================================== */

/**
 * Normalise les trois couches de contours en une liste de brigades portant
 * leur ascendance. `circo_bt` nomme ses champs `gr_bde / gr_cie / gr_region` ;
 * les deux autres couches portent `nom`. On ne renomme rien à la source — la
 * conversion vit ici, et nulle part ailleurs.
 */
export function lireDecoupages({ circoBt, circoCie, circoReg }) {
  const brigades = (circoBt?.features ?? [])
    .map((f) => ({
      nom: f.properties?.gr_bde ?? f.properties?.nom ?? null,
      cie: f.properties?.gr_cie ?? null,
      reg: f.properties?.gr_region ?? null,
      population: f.properties?.population ?? null,
      superficie: f.properties?.superficie ?? null,
      feature: f,
    }))
    .filter((b) => b.nom && b.cie && b.reg);

  const contour = (fc) =>
    new Map((fc?.features ?? []).filter((f) => f.properties?.nom).map((f) => [f.properties.nom, f]));

  return { brigades, contoursCie: contour(circoCie), contoursReg: contour(circoReg) };
}

/* ================================================================== */
/*  Placement                                                         */
/* ================================================================== */

/**
 * Un point tiré DANS le contour. Jusqu'à 40 essais dans la boîte englobante —
 * au-delà (contour très découpé, île, bande côtière), on retombe sur un point
 * dont turf garantit qu'il appartient à la forme. Jamais de repère hors zone.
 */
function pointDansContour(feature, rnd) {
  try {
    const [ouest, sud, est, nord] = bbox(feature);
    for (let i = 0; i < 40; i++) {
      const lng = ouest + rnd() * (est - ouest);
      const lat = sud + rnd() * (nord - sud);
      if (booleanPointInPolygon([lng, lat], feature)) {
        return [Number(lng.toFixed(5)), Number(lat.toFixed(5))];
      }
    }
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    return [Number(lng.toFixed(5)), Number(lat.toFixed(5))];
  } catch {
    return null; // géométrie inexploitable : la brigade n'aura pas de poste
  }
}

/* ================================================================== */
/*  Le jeu                                                            */
/* ================================================================== */

/**
 * @param {object} decoupages  sortie de `lireDecoupages`
 * @param {object} config      voir CONFIG_FICTIVE (sourceDonnees.js)
 * @returns {{regions, compagnies, brigades, effectifs, barrages, elements, comptes, resume}}
 */
export function creerJeuFictif(decoupages, config) {
  const rnd = tirage(config.graine);
  const { brigades: toutes, contoursCie, contoursReg } = decoupages;

  /* ---- Sélection du périmètre engendré ---------------------------- */

  const parRegion = new Map();
  for (const b of toutes) {
    if (!parRegion.has(b.reg)) parRegion.set(b.reg, new Map());
    const cies = parRegion.get(b.reg);
    if (!cies.has(b.cie)) cies.set(b.cie, []);
    cies.get(b.cie).push(b);
  }

  const limite = (liste, n) => (n === 'toutes' ? liste : liste.slice(0, Math.max(0, n)));
  const nomsRegions = limite([...parRegion.keys()].sort((a, b) => a.localeCompare(b, 'fr')),
    config.regions);

  /* ---- Régions, compagnies, brigades : identifiants et liens ------ */

  const regions = [];
  const compagnies = [];
  const brigades = [];

  nomsRegions.forEach((nomRegion, iRegion) => {
    const idRegion = `REG-${numero(iRegion + 1, 2)}`;
    const cies = parRegion.get(nomRegion);
    const nomsCies = limite([...cies.keys()].sort((a, b) => a.localeCompare(b, 'fr')),
      config.compagniesParRegion);

    regions.push({
      id: idRegion,
      code: idRegion,
      nom: nomRegion,
      geometry: contoursReg.get(nomRegion)?.geometry ?? null,
      demo: true,
    });

    nomsCies.forEach((nomCie, iCie) => {
      const idCie = `CIE-${numero(compagnies.length + 1, 3)}`;
      const siennes = limite(
        [...cies.get(nomCie)].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
        config.brigadesParCompagnie,
      );

      compagnies.push({
        id: idCie,
        code: idCie,
        nom: nomCie,
        regionId: idRegion,
        reg: nomRegion,
        rang: iCie,
        geometry: contoursCie.get(nomCie)?.geometry ?? null,
        demo: true,
      });

      for (const bt of siennes) {
        brigades.push({
          id: `BT-${numero(brigades.length + 1, 3)}`,
          code: `BT-${numero(brigades.length + 1, 3)}`,
          nom: bt.nom,
          regionId: idRegion,
          compagnieId: idCie,
          reg: nomRegion,
          cie: nomCie,
          centre: null, // posé plus bas, avec les repères
          geometry: bt.feature.geometry,
          feature: bt.feature,
          population: bt.population,
          superficie: bt.superficie,
          effectifTotal: 0,
          effectifDisponible: 0,
          statut: 'active',
          demo: true,
        });
      }
    });
  });

  /* ---- Personnel --------------------------------------------------- */

  const effectifs = [];
  for (const brigade of brigades) {
    const combien = entre(rnd, ...config.effectifsParBrigade);
    for (let i = 0; i < combien; i++) {
      const matricule = `DEMO-${numero(effectifs.length + 1, 5)}`;
      const prenom = dans(rnd, PRENOMS);
      const patronyme = dans(rnd, NOMS);
      /**
       * INDISPONIBLE, ET POURQUOI. Un effectif absent sans motif ne se
       * distingue pas d'une donnée manquante ; avec son motif, l'écran peut
       * dire « 4 en permission » et le chef sait s'il peut compter dessus.
       */
      const disponible = rnd() < 0.82;
      const motif = disponible ? null : dans(rnd, MOTIFS_INDISPONIBILITE);
      effectifs.push({
        id: `EL-${numero(effectifs.length + 1, 5)}`,
        matricule,
        /* `nom` complet ET les deux parties : l'application affiche le nom
           complet partout (c'est le champ du serveur), les écrans d'effectif
           demandés trient et regroupent par patronyme. */
        nom: `${prenom} ${patronyme} DEMO`,
        prenom,
        patronyme: `${patronyme} DEMO`,
        grade: dans(rnd, VIVIER_GRADES),
        bt: brigade.nom,
        cie: brigade.cie,
        reg: brigade.reg,
        brigadeId: brigade.id,
        compagnieId: brigade.compagnieId,
        regionId: brigade.regionId,
        statut: disponible ? 'disponible' : 'indisponible',
        disponibilite: disponible,
        motifIndisponibilite: motif,
        demo: true,
      });
    }
    brigade.effectifTotal = combien;
    brigade.effectifDisponible = effectifs
      .slice(-combien)
      .filter((e) => e.statut === 'disponible').length;
  }

  /* ---- Barrages ---------------------------------------------------- */

  const barrages = [];
  const auteurSysteme = {
    matricule: 'DEMO-SYSTEME',
    nom: 'Jeu de démonstration',
    role: 'commandement',
    rang: 'admin',
    unite: 'demo',
    reg: null,
    cie: null,
  };

  for (const brigade of brigades) {
    /**
     * PAS DE POSTE SANS SES TROIS HOMMES.
     *
     * Une brigade qui ne peut pas aligner trois hommes ne tient pas de
     * barrage — on ne crée pas un poste qu'il faudrait laisser hors règle.
     * L'invariant est ainsi tenu par CONSTRUCTION, et non rattrapé ensuite :
     * il n'existe aucun instant, dans ce générateur, où un barrage a un autre
     * effectif que trois.
     */
    if (brigade.effectifTotal < ELEMENTS_PAR_BARRAGE) continue;
    const combien = entre(rnd, ...config.barragesParBrigade);
    for (let i = 0; i < combien; i++) {
      const position = pointDansContour(brigade.feature, rnd);
      if (!position) break;
      const [lng, lat] = position;
      if (!brigade.centre) brigade.centre = [lat, lng];

      const type = dans(rnd, TYPES);
      const debut = dans(rnd, ['00:00', '06:00', '12:00', '18:00']);
      const fin = { '00:00': '06:00', '06:00': '12:00', '12:00': '18:00', '18:00': '00:00' }[debut];
      const id = `BAR-${numero(barrages.length + 1, 4)}`;

      barrages.push({
        /* ---- Champs attendus par l'application (voir src/marquages.js) --- */
        id,
        type,
        nom: `Barrage DEMO ${numero(barrages.length + 1, 4)}`,
        route: `RN-DEMO ${entre(rnd, 1, 99)}`,
        note: dans(rnd, MOTIFS),
        debut,
        fin,
        accidentCount: entre(rnd, 0, 9),
        severite: dans(rnd, ['none', 'moderate', 'moderate', 'high', 'critical']),
        activite: dans(rnd, ['low', 'medium', 'high']),
        infraction: dans(rnd, ['low', 'medium', 'high']),
        positionVille: dans(rnd, ['none', 'entree', 'sortie']),
        eclairage: dans(rnd, ['inconnu', 'oui', 'non']),
        statutBarrage: dans(rnd, STATUTS),
        decisionOptimisation: 'aucune',
        origineId: null,
        patrouilles: [],
        sousType: null,
        exceptionnel: false,
        missionId: null,
        viaAssistant: false,
        partage: false,
        bt: brigade.nom,
        cie: brigade.cie,
        reg: brigade.reg,
        lng,
        lat,
        auteur: auteurSysteme,
        cree: `${config.dateReference}T06:00:00.000Z`,
        maj: `${config.dateReference}T06:00:00.000Z`,
        /* ---- Champs de confort du jeu fictif ---------------------------- */
        brigadeId: brigade.id,
        compagnieId: brigade.compagnieId,
        regionId: brigade.regionId,
        /* Ce que le poste ATTEND : la règle, et rien d'autre. */
        effectif: ELEMENTS_PAR_BARRAGE,
        elements: [],
        demo: true,
      });
    }
    if (!brigade.centre) {
      const p = pointDansContour(brigade.feature, rnd);
      brigade.centre = p ? [p[1], p[0]] : null;
    }
  }

  /* ---- Relèves du jour (éléments présents sur un poste) ------------ */

  const elements = [];
  const effectifsParBt = new Map();
  for (const e of effectifs) {
    if (!effectifsParBt.has(e.bt)) effectifsParBt.set(e.bt, []);
    effectifsParBt.get(e.bt).push(e);
  }

  for (const barrage of barrages) {
    /**
     * LA RÈGLE DES TROIS — exactement trois hommes par poste et par créneau.
     *
     * Le jeu tirait auparavant deux à six présences, et laissait un tiers des
     * postes vides pour éprouver l'écran « poste non tenu ». Ce n'est plus
     * permis : `ELEMENTS_PAR_BARRAGE` est une contrainte métier, et un jeu
     * d'épreuve qui la viole ne sert plus à éprouver quoi que ce soit — on
     * passerait son temps à se demander si l'écart vient du code ou du jeu.
     *
     * Les trois viennent du VIVIER DE SA BRIGADE, jamais d'ailleurs : c'est la
     * seconde moitié de la règle (même région, même compagnie, même brigade).
     * Une brigade comptant au moins vingt hommes, les trois sont toujours
     * distincts ; le modulo ne fait que parcourir le vivier sans le déborder.
     *
     * Un même homme peut tenir plusieurs postes de sa brigade : le modèle le
     * permet (les créneaux diffèrent) et l'inverse obligerait à inventer du
     * personnel, ce que le jeu s'interdit.
     */
    const vivier = effectifsParBt.get(barrage.bt) ?? [];
    /* Garanti par la boucle des barrages ci-dessus : un poste n'existe que si
       sa brigade peut l'armer. La garde reste, au cas où l'ordre changerait. */
    if (vivier.length < ELEMENTS_PAR_BARRAGE) continue;
    const creneau = dans(rnd, CRENEAUX);
    const combien = ELEMENTS_PAR_BARRAGE;
    const debut = Math.floor(rnd() * vivier.length);

    for (let i = 0; i < combien; i++) {
      const personne = vivier[(debut + i) % vivier.length];
      const idReleve = `EL-REL-${numero(elements.length + 1, 5)}`;
      /* Le poste porte la liste de ses trois éléments : l'appelant n'a pas à
         balayer sept mille relèves pour savoir qui tient ce barrage. */
      (barrage.elements ??= []).push(idReleve);
      elements.push({
        id: idReleve,
        barrageId: barrage.id,
        grade: personne.grade,
        nom: personne.nom,
        matricule: personne.matricule,
        date: config.dateReference,
        heure: `${numero(creneau, 2)}:00`,
        creneau,
        saisiLe: `${config.dateReference}T${numero(creneau, 2)}:05:00.000Z`,
        prepare: true,
        auteur: auteurSysteme,
        demo: true,
      });
    }
  }

  /* ---- Comptes d'épreuve, un par rang (voir §RBAC du README) ------- */

  const premiere = brigades[0];
  const comptes = [
    { rang: 'admin', unite: 'DEMO-ADMIN', nom: 'Administrateur DEMO', role: 'commandement',
      reg: null, cie: null },
    { rang: 'reg', unite: regions[0]?.nom ?? '', nom: `Chef de région ${regions[0]?.nom} DEMO`,
      role: 'commandement', reg: regions[0]?.nom ?? null, cie: null },
    { rang: 'cie', unite: compagnies[0]?.nom ?? '', nom: `Chef de compagnie ${compagnies[0]?.nom} DEMO`,
      role: 'commandement', reg: compagnies[0]?.reg ?? null, cie: compagnies[0]?.nom ?? null },
    { rang: 'unite', unite: premiere?.nom ?? '', nom: `Chef de brigade ${premiere?.nom} DEMO`,
      role: 'commandement', reg: premiere?.reg ?? null, cie: premiere?.cie ?? null },
  ].filter((c) => c.unite);

  /* La géométrie ne sert qu'au placement : la garder doublerait la mémoire du
     jeu, pour une donnée que la carte télécharge déjà de son côté. */
  for (const b of brigades) delete b.feature;

  return {
    regions,
    compagnies,
    brigades,
    effectifs,
    barrages,
    elements,
    comptes,
    resume: {
      graine: config.graine,
      regions: regions.length,
      compagnies: compagnies.length,
      brigades: brigades.length,
      effectifs: effectifs.length,
      effectifsDisponibles: effectifs.filter((e) => e.disponibilite).length,
      barrages: barrages.length,
      elements: elements.length,
      postesTenus: barrages.filter((b) => (b.elements ?? []).length === ELEMENTS_PAR_BARRAGE).length,
    },
  };
}
