/**
 * RENDU D'ÉPREUVE DE TOUS LES PARCOURS.
 *
 * Le prouveur de navigation (`verifier-parcours.mjs`) éprouve le calcul pur.
 * Le contrôle de portée (`eslint`) attrape les identifiants inconnus. Aucun
 * des deux ne RENDING les composants : une étape qui lit `roster.effectif`
 * quand `roster` est nul, une brique appelée avec la mauvaise forme de
 * données, un crochet appelé conditionnellement — tout cela passe les deux
 * contrôles et meurt à l'ouverture. C'est exactement ce qui a produit quatre
 * écrans blancs dans ce projet.
 *
 * Ce fichier rend donc CHAQUE section, dans les états qui comptent : sans
 * session, avec chaque rang, sur chaque tâche, sur chaque étape, avec des
 * données vides ET avec des données plausibles.
 *
 * Il est assemblé par Vite en module Node (voir `scripts/verifier-rendu.mjs`)
 * parce qu'il faut le même JSX et les mêmes imports que l'application — un
 * second jeu de réglages finirait par éprouver autre chose que le vrai code.
 *
 * AUCUN APPEL RÉSEAU : `fetch` est remplacé par un refus immédiat. Les
 * panneaux doivent supporter que le serveur ne réponde pas, et c'est aussi ce
 * qu'on éprouve ici.
 */
import { renderToString } from 'react-dom/server';

import OptimisationPanel from '../src/OptimisationPanel.jsx';
import MarquagePanel from '../src/MarquagePanel.jsx';
import AdminPanel from '../src/AdminPanel.jsx';
import DistancePanel from '../src/DistancePanel.jsx';
import NotificationsPanel from '../src/NotificationsPanel.jsx';
import AnalysisPanel from '../src/AnalysisPanel.jsx';
import Login from '../src/Login.jsx';
import HierarchiePanel from '../src/HierarchiePanel.jsx';
import ContextSummary from '../src/components/command-center/ContextSummary.jsx';
import { statistiquesOptimisation } from '../src/statistiquesOptimisation.js';
import MotDePasse from '../src/MotDePasse.jsx';
import { DecisionPopup } from '../src/components/map/MapPopups.jsx';

/* ------------------------------------------------------------------ */
/* Données d'épreuve — plausibles, jamais réelles                     */
/* ------------------------------------------------------------------ */

const SESSIONS = {
  aucune: null,
  admin: { matricule: 'ADMIN', nom: 'Admin', role: 'commandement', rang: 'admin', unite: 'admin' },
  reg: {
    matricule: 'REG-X',
    nom: 'Région',
    role: 'commandement',
    rang: 'reg',
    unite: 'Ouarzazate',
  },
  cie: {
    matricule: 'CIE-X',
    nom: 'Compagnie',
    role: 'commandement',
    rang: 'cie',
    unite: 'Zagora',
    reg: 'Ouarzazate',
  },
  unite: {
    matricule: 'BT-X',
    nom: 'Brigade',
    role: 'commandement',
    rang: 'unite',
    unite: 'Agdez',
    reg: 'Ouarzazate',
    cie: 'Zagora',
  },
  lecture: { matricule: 'L', nom: 'Lecteur', role: 'lecture', rang: 'unite', unite: 'Agdez' },
};

const BARRAGE = {
  id: 'mq_essai_1',
  type: 'barrage_fixe',
  nom: 'Poste d’épreuve',
  route: 'RN8 — PK 42',
  note: '',
  debut: '',
  fin: '',
  accidentCount: 3,
  severite: 'moderate',
  activite: 'low',
  infraction: 'low',
  positionVille: 'none',
  eclairage: 'inconnu',
  statutBarrage: 'en_attente',
  decisionOptimisation: 'aucune',
  patrouilles: [{ nom: 'P1', unite: '', date: '', debut: '', fin: '', effectif: '4', vehicule: '' }],
  sousType: 'carrefour',
  bt: 'Agdez',
  cie: 'Zagora',
  reg: 'Ouarzazate',
  lng: -6.49292,
  lat: 30.69697,
  auteur: { matricule: 'AUTRE', nom: 'Un autre', role: 'commandement', rang: 'cie', unite: 'Zagora' },
};

const POINT_NOIR = { ...BARRAGE, id: 'mq_essai_2', type: 'accident', nom: 'Point noir d’épreuve' };
const ZAHMA = { ...BARRAGE, id: 'mq_essai_3', type: 'zahma', nom: 'Congestion d’épreuve' };

const UNITES = {
  regions: ['Ouarzazate', 'Tanger'],
  compagnies: [{ nom: 'Zagora', reg: 'Ouarzazate' }],
  unites: [{ nom: 'Agdez', cie: 'Zagora', reg: 'Ouarzazate' }],
};

const RAPPORT = {
  parametres: {
    distanceMinKm: 5,
    niveau: 'brigade',
    unite: 'Agdez',
    accidents: true,
    seuilAccidents: 3,
    vip: false,
    nonEclaire: false,
  },
  barrages: [
    { ...BARRAGE, sousLeSeuil: true, distanceKm: 2.4, decision: 'aucune' },
    { ...BARRAGE, id: 'b2', sousLeSeuil: true, intouchable: true, distanceKm: 1.2 },
    { ...BARRAGE, id: 'b3', sousLeSeuil: true, decision: 'a_supprimer', distanceKm: 3 },
    { ...BARRAGE, id: 'b4', sousLeSeuil: true, decision: 'conserve', distanceKm: 3.5 },
  ],
};

const NOTIFICATIONS = [
  {
    id: 'n1',
    action: 'nouveau_barrage',
    aDecider: 'admin',
    statut: 'ouverte',
    texte: 'Un poste vient d’être posé.',
    cree: '2026-09-03T10:00:00.000Z',
    barrage: BARRAGE,
    auteur: BARRAGE.auteur,
  },
  {
    id: 'n2',
    action: 'suppression',
    statut: 'ouverte',
    texte: 'Retrait proposé.',
    cree: '2026-09-03T11:00:00.000Z',
    barrage: BARRAGE,
    auteur: BARRAGE.auteur,
    criteres: { distanceKm: 2.4, seuilKm: 5, voisinNom: 'Voisin', accidents: 3, vip: false },
  },
  {
    id: 'n3',
    action: 'conservation',
    statut: 'traitee',
    decision: 'acceptee',
    texte: 'Poste maintenu.',
    cree: '2026-09-02T09:00:00.000Z',
    traiteeLe: '2026-09-02T12:00:00.000Z',
    traiteePar: { nom: 'Admin' },
    reponse: 'Axe sensible.',
    barrage: BARRAGE,
    auteur: BARRAGE.auteur,
  },
  {
    id: 'n4',
    action: 'nouveau_barrage',
    aDecider: 'unite',
    statut: 'ouverte',
    texte: 'Le commandement a posé un poste chez vous.',
    cree: '2026-09-03T12:00:00.000Z',
    barrage: BARRAGE,
    auteur: SESSIONS.admin,
  },
];

/**
 * MÊME FORME QUE `/api/analyse/situation` — voir serveur/api.mjs.
 *
 * Inventer une forme approchante ne prouverait rien : c'est justement l'écart
 * entre la forme attendue et la forme reçue qui blanchit un écran.
 */
const SITUATION = {
  date: '2026-09-03',
  creneau: 6,
  barrages: { total: 1122, pourvus: 700, incomplets: 300, vides: 122 },
  brigades: { total: 391, avecEffectif: 380, sansEffectif: 11 },
  effectif: { total: 7454, affectes: 6800, libres: 654, demo: true },
  creneaux: [
    { creneau: 0, lignes: 5000, postes: 900 },
    { creneau: 6, lignes: 5800, postes: 1000 },
    { creneau: 12, lignes: 5700, postes: 990 },
    { creneau: 18, lignes: 5600, postes: 980 },
  ],
  detailIncomplets: [
    { id: BARRAGE.id, nom: BARRAGE.nom, bt: 'Agdez', cie: 'Zagora', reg: 'Ouarzazate', presents: 2, cible: 6 },
  ],
};

const ROSTER_BRIGADE = {
  bt: 'Agdez',
  barrages: [BARRAGE],
  effectif: [
    { matricule: 'DEMO-1', nom: 'Un DEMO', grade: 'MDLC', demo: true },
    { matricule: 'DEMO-2', nom: 'Deux DEMO', grade: 'A/C', demo: true },
  ],
  creneaux: { 6: [{ id: 'e1', matricule: 'DEMO-1', nom: 'Un DEMO', grade: 'MDLC', barrageId: BARRAGE.id }] },
};

const ITINERAIRE = {
  km: 42.5,
  heures: 0.8,
  volOiseauKm: 30,
  jambes: [
    {
      km: 42.5,
      heures: 0.8,
      etapes: [
        { classe: 'autoroute', ref: 'A7', km: 20 },
        { classe: 'nationale', ref: 'RN8', km: 22.5 },
      ],
    },
  ],
};

const RIEN = () => {};

/* ------------------------------------------------------------------ */
/* Les cas à rendre                                                   */
/* ------------------------------------------------------------------ */

/**
 * Chaque cas : un nom, l'élément à rendre. Les états d'étape sont atteints en
 * rendant plusieurs fois avec des `props` différentes — le rendu serveur ne
 * clique pas, mais il éprouve CHAQUE étape par sa fonction de contenu, qui est
 * évaluée à la construction du tableau d'étapes.
 */
export function cas() {
  const liste = [];
  const ajouter = (nom, element) => liste.push({ nom, element });

  /* ---------------- RÉSUMÉ DU TERRITOIRE ---------------- */
  /**
   * Le cartouche du haut à droite porte deux choses : le territoire affiché,
   * et — après un calcul — ce que l'optimisation y a relevé. Les deux états
   * sont rendus ici, le second avec un rapport à la forme exacte du serveur,
   * pour que les chiffres par critère soient réellement traversés.
   */
  {
    const resume = {
      titre: 'Région Ouarzazate',
      chiffres: [
        { valeur: 47, libelle: 'barrages' },
        { valeur: 5, libelle: 'compagnies' },
        { valeur: 19, libelle: 'brigades' },
      ],
    };
    ajouter('résumé — sans optimisation', <ContextSummary resume={resume} />);
    ajouter(
      'résumé — avec les chiffres du calcul',
      <ContextSummary resume={resume} optimisation={statistiquesOptimisation(RAPPORT)} />,
    );
    /* Pas de cas « aucun territoire » : le composant rend alors `null`, ce
       qui est voulu — et ce banc traite tout rendu vide comme un écran blanc,
       donc comme un échec. Le cas est légitime, l'épreuve ne l'est pas. */
  }

  /* ---------------- OPTIMISATION ---------------- */
  for (const [nomSession, session] of Object.entries(SESSIONS)) {
    if (!session) continue;
    for (const [nomEtat, extra] of [
      ['sans rapport', {}],
      ['avec rapport', { items: [BARRAGE] }],
    ]) {
      ajouter(
        `OptimisationPanel · ${nomSession} · ${nomEtat}`,
        <OptimisationPanel
          open
          onClose={RIEN}
          onOpen={RIEN}
          session={session}
          unites={UNITES}
          service={{ assistant: { disponible: true } }}
          items={[BARRAGE]}
          dispositifVersion={1}
          onResultatsChange={RIEN}
          onCadrer={RIEN}
          onCadrerCirconscription={RIEN}
          onReconsiderer={RIEN}
          {...extra}
        />,
      );
    }
  }

  /* ---------------- SAISIE TERRAIN ---------------- */
  for (const [nomSession, session] of Object.entries(SESSIONS)) {
    for (const [nomCas, extra] of [
      ['sans repère', { items: [] }],
      ['avec repères', { items: [BARRAGE, POINT_NOIR, ZAHMA], selection: BARRAGE.id }],
      ['point noir ouvert', { items: [POINT_NOIR], selection: POINT_NOIR.id }],
      ['congestion ouverte', { items: [ZAHMA], selection: ZAHMA.id }],
      ['demande de brigade', { items: [BARRAGE], brigadeDemandee: { bt: 'Agdez', ts: 1 } }],
    ]) {
      ajouter(
        `MarquagePanel · ${nomSession} · ${nomCas}`,
        <MarquagePanel
          open
          onOpen={RIEN}
          onClose={RIEN}
          session={session}
          service={{ comptes: 3 }}
          unites={UNITES}
          occupe={false}
          onConnexion={RIEN}
          onDeconnexion={RIEN}
          total={3}
          arme={null}
          onArmer={RIEN}
          onSelectionner={RIEN}
          onModifier={RIEN}
          onSupprimer={RIEN}
          onCadrer={RIEN}
          onViserBarrage={RIEN}
          onVue3D={RIEN}
          onExporter={RIEN}
          onImporter={RIEN}
          message={null}
          importants={new Map()}
          onGenererBarrageManuel={RIEN}
          generationEnCours={false}
          items={[]}
          {...extra}
        />,
      );
    }
  }

  /* ---------------- ADMINISTRATION ---------------- */
  for (const [nomSession, session] of Object.entries(SESSIONS)) {
    if (!session) continue;
    ajouter(
      `AdminPanel · ${nomSession}`,
      <AdminPanel open onOpen={RIEN} onClose={RIEN} session={session} unites={UNITES} />,
    );
  }

  /* ---------------- DISTANCES ---------------- */
  for (const [nomEtat, props] of [
    ['chargement', { etat: 'chargement', jalons: [null, null], resultat: null }],
    ['erreur', { etat: 'erreur', message: 'Réseau absent', jalons: [null, null], resultat: null }],
    ['prêt sans points', { etat: 'pret', jalons: [null, null], resultat: null }],
    [
      'prêt avec trajet',
      {
        etat: 'pret',
        jalons: [
          { lat: 30.6, lng: -6.4, route: 'RN8', accroche: { lat: 30.6, lng: -6.4, ecartKm: 0.1 } },
          { lat: 31.6, lng: -7.9, route: 'A7', accroche: { lat: 31.6, lng: -7.9, ecartKm: 0.3 } },
        ],
        resultat: ITINERAIRE,
      },
    ],
    [
      'prêt sans itinéraire',
      {
        etat: 'pret',
        /* Sans accroche à dessein : un sous-champ manquant ne doit pas
           blanchir le panneau (voir `Jalon` dans DistancePanel.jsx). */
        jalons: [
          { lat: 30.6, lng: -6.4 },
          { lat: 31.6, lng: -7.9 },
        ],
        resultat: null,
      },
    ],
  ]) {
    ajouter(
      `DistancePanel · ${nomEtat}`,
      <DistancePanel
        open
        onOpen={RIEN}
        onClose={RIEN}
        critere="rapide"
        onCritere={RIEN}
        enAttente={null}
        onAttendre={RIEN}
        onAjouterJalon={RIEN}
        onSupprimerJalon={RIEN}
        onEffacer={RIEN}
        analyseRoute={null}
        itineraireAlternatif={null}
        onLocaliserMarquage={RIEN}
        {...props}
      />,
    );
  }

  /* ---------------- NOTIFICATIONS ---------------- */
  for (const [nomSession, session] of Object.entries(SESSIONS)) {
    if (!session) continue;
    for (const [nomCas, notifs] of [
      ['vide', []],
      ['pleines', NOTIFICATIONS],
    ]) {
      ajouter(
        `NotificationsPanel · ${nomSession} · ${nomCas}`,
        <NotificationsPanel
          open
          onOpen={RIEN}
          onClose={RIEN}
          session={session}
          notifications={notifs}
          onDecider={RIEN}
          onCadrer={RIEN}
        />,
      );
    }
  }

  /* ---------------- ANALYSE ---------------- */
  for (const [nomCas, props] of [
    ['national', { situation: SITUATION, brigadeCliquee: null }],
    ['brigade cliquée', { situation: SITUATION, brigadeCliquee: 'Agdez', rosterBrigade: ROSTER_BRIGADE }],
    ['sans situation', { situation: null, brigadeCliquee: null }],
  ]) {
    ajouter(
      `AnalysisPanel · ${nomCas}`,
      <AnalysisPanel
        open
        onOpen={RIEN}
        onClose={RIEN}
        data={null}
        marquages={[BARRAGE]}
        report={null}
        loading={false}
        proximite={null}
        seuilKm={5}
        fiche={null}
        ficheCouche={null}
        ficheMarquages={[]}
        onQuitterBrigade={RIEN}
        onViserBarrage={RIEN}
        filtreAnalyse={null}
        onRechercheAnalyseChange={RIEN}
        couvertureOperationnelle={null}
        efficaciteBarrages={null}
        onOuvrirMarquage={RIEN}
        onClearFiche={RIEN}
        heatmapOn={false}
        onBasculerHeatmap={RIEN}
        comparaisonPeriodes={null}
        periodeComparaison={null}
        onChangerPeriode={RIEN}
        {...props}
      />,
    );
  }

  /* ---------------- ORGANISATION (VOIR TOUT) ---------------- */
  ajouter(
    'HierarchiePanel',
    <HierarchiePanel open onClose={RIEN} onCadrerCirconscription={RIEN} onViserBrigade={RIEN} />,
  );

  /* ---------------- NOUVEAU MOT DE PASSE ---------------- */
  for (const [nom, s] of Object.entries(SESSIONS)) {
    ajouter(`MotDePasse · ${nom}`, <MotDePasse session={s} onFait={RIEN} onAbandon={RIEN} />);
  }

  /* ---------------- BULLE DE DÉCISION (CARTE) ---------------- */
  /**
   * La bulle du repère « ? » et celle du repère « ✗ » sont le seul endroit
   * où un poste se tranche devant le terrain. Ses trois branches de commandes
   * ne se ressemblent pas — arbitrer, répondre à une demande, ou n'avoir rien
   * à proposer — et aucune n'était rendue nulle part.
   */
  {
    const poste = { ...BARRAGE, id: 'b-decision' };
    const mesure = { distanceKm: 3.23, voisin: 'RN-9 — voisin', seuilKm: 5, accidents: 0 };
    const demandeRetrait = {
      id: 'i-retrait',
      barrageId: poste.id,
      action: 'suppression',
      statut: 'ouverte',
      decision: null,
      aDecider: 'unite',
      auteur: { matricule: 'ADMIN' },
      cree: '2026-02-01T09:00:00.000Z',
    };

    ajouter(
      'bulle de décision · à trancher',
      <DecisionPopup m={poste} mesure={mesure} etat="aucune" onDecider={RIEN} />,
    );
    for (const etat of ['a_supprimer', 'conserve']) {
      ajouter(
        `bulle de décision · ${etat} · arbitre`,
        <DecisionPopup m={poste} mesure={mesure} etat={etat} onDecider={RIEN} />,
      );
      ajouter(
        `bulle de décision · ${etat} · simple lecteur`,
        <DecisionPopup m={poste} mesure={mesure} etat={etat} />,
      );
    }
    ajouter(
      'bulle de décision · retrait soumis à ce compte',
      <DecisionPopup
        m={poste}
        mesure={mesure}
        etat="a_supprimer"
        demande={demandeRetrait}
        onDeciderDemande={RIEN}
      />,
    );
  }

  /* ---------------- CONNEXION ---------------- */
  ajouter('Login', <Login onLoginSuccess={RIEN} />);

  return liste;
}

/** Rend tous les cas et rend compte. Employé par `verifier-rendu.mjs`. */
export function eprouver() {
  const echecs = [];
  let rendus = 0;
  let parcours = 0;

  for (const { nom, element } of cas()) {
    try {
      const html = renderToString(element);
      rendus++;
      if (!html || html.length < 20) {
        echecs.push({ nom, motif: `rendu vide (${html.length} caractères)` });
      }

      /**
       * TOUT PARCOURS S'OUVRE SUR L'ÉTAPE 1.
       *
       * Chaque section est rendue ici À NEUF, comme à l'ouverture. Le rang
       * affiché doit donc être 1 — jamais 2, jamais le dernier.
       *
       * Ce n'est pas une vérification théorique : les panneaux se referment
       * par `if (!open) return null`, ce qui NE DÉMONTE PAS le composant.
       * L'étape survivait à la fermeture et `borner` ramenait l'indice périmé
       * sur la DERNIÈRE étape — « Étape 2 sur 2 » à la réouverture. Le
       * correctif vit dans `useParcours` ; cette assertion garde la porte.
       */
      /* Le rendu serveur sépare texte et expressions par des commentaires
         (« Étape <!-- -->1<!-- --> sur <!-- -->5 ») : on les retire avant de
         lire le rang, sinon le motif ne mord jamais et le contrôle passe en
         ne vérifiant rien. */
      const rang = html.replace(/<!--\s*-->/g, '').match(/Étape\s*(\d+)\s*sur\s*(\d+)/);
      if (rang) {
        parcours++;
        if (rang[1] !== '1') {
          echecs.push({
            nom,
            motif: `s'ouvre sur « Étape ${rang[1]} sur ${rang[2]} » au lieu de l'étape 1`,
          });
        }
      }
    } catch (err) {
      echecs.push({ nom, motif: err?.message ?? String(err) });
    }
  }

  return { rendus, echecs, parcours };
}
