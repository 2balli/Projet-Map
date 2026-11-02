/**
 * FOURNISSEUR FICTIF — l'API d'habilitation, rejouée dans le navigateur.
 *
 * Il répond aux MÊMES chemins, avec les MÊMES formes, que `serveur/api.mjs` :
 * `src/api.js` lui passe `(chemin, méthode, corps)` sans rien savoir de lui,
 * et les écrans ne voient aucune différence. C'est la condition pour que le
 * jour du branchement sur l'API réelle il n'y ait rien à réécrire — voir
 * `src/donnees/sourceDonnees.js`.
 *
 * CE QU'IL SIMULE VRAIMENT
 * ------------------------
 *   — la HIÉRARCHIE et les unités, tirées des contours réels ;
 *   — les BARRAGES : lecture, pose, modification, suppression, lot, import ;
 *   — les ÉLÉMENTS et la relève du jour ;
 *   — le CLOISONNEMENT par rang, avec la règle de l'application elle-même ;
 *   — la LATENCE, le VIDE et l'ERREUR (voir `SCENARIOS`).
 *
 * CE QU'IL NE SIMULE PAS, et le dit
 * ---------------------------------
 * L'optimisation par distance réelle, l'assistant d'analyse et le calcul
 * d'itinéraire tiennent à un graphe routier et à des services externes : ils
 * répondent ici une réponse VIDE mais bien formée, et non une invention. Un
 * résultat d'optimisation fabriqué au hasard serait pire qu'un écran vide —
 * on le lirait comme un conseil.
 *
 * LE CLOISONNEMENT N'EST PAS RÉÉCRIT
 * ----------------------------------
 * `perimetreImpose` vient de `src/marquages.js`, la règle que la carte et les
 * panneaux appliquent déjà. Le mode fictif ne peut donc pas diverger du mode
 * réel sur ce point, ni servir de porte dérobée : un chef de brigade voit sa
 * brigade, ici comme là-bas. (Rappel : côté réel, c'est le SERVEUR qui fait
 * foi ; ici il n'y a pas de serveur, et le jeu est fictif de bout en bout.)
 */
import {
  perimetreImpose, dansSaPortee, motifHorsPortee,
  ELEMENTS_PAR_BARRAGE, verifieEffectifBarrage,
} from '../../marquages.js';
import { CONFIG_FICTIVE, SCENARIO_ACTIF, SCENARIOS, latenceSimulee } from '../sourceDonnees.js';
import { creerJeuFictif, lireDecoupages, GRADES } from './generateur.js';

/* ================================================================== */
/*  Erreurs — même forme que celles du transport réel                 */
/* ================================================================== */

/** Reçue depuis api.js pour ne pas dupliquer la classe d'erreur. */
let FabriqueErreur = (message, statut) => Object.assign(new Error(message), { statut });

export function poserFabriqueErreur(fn) {
  FabriqueErreur = fn;
}

const refus = (statut, message) => {
  throw FabriqueErreur(message, statut);
};

/* ================================================================== */
/*  Chargement du jeu — une fois par session de navigateur            */
/* ================================================================== */

let jeuPromesse = null;

const lireCouche = async (nom) => {
  const r = await fetch(`layers/${nom}.geojson`);
  if (!r.ok) throw new Error(`layers/${nom}.geojson : HTTP ${r.status}`);
  return r.json();
};

/**
 * Les contours servent de support géographique au jeu. Ils sont téléchargés
 * une seule fois, en parallèle, et la carte les relira depuis son propre
 * cache : aucun fichier n'est demandé deux fois au réseau.
 */
async function chargerJeu() {
  const [circoBt, circoCie, circoReg] = await Promise.all([
    lireCouche('circo_bt'),
    lireCouche('circo_cie'),
    lireCouche('circo_reg'),
  ]);
  const jeu = creerJeuFictif(lireDecoupages({ circoBt, circoCie, circoReg }), CONFIG_FICTIVE);

  /* Une trace unique à l'ouverture : on doit pouvoir constater, sans fouiller,
     de quel jeu vient ce qui est à l'écran. */
  console.info(
    '[données fictives] jeu engendré (graine %s) : %s régions · %s compagnies · %s brigades · %s éléments · %s barrages · %s relèves',
    jeu.resume.graine, jeu.resume.regions, jeu.resume.compagnies, jeu.resume.brigades,
    jeu.resume.effectifs, jeu.resume.barrages, jeu.resume.elements,
  );
  return jeu;
}

export const jeuFictif = () => (jeuPromesse ??= chargerJeu());

/* ================================================================== */
/*  Session — vit dans le navigateur, le temps de l'onglet            */
/* ================================================================== */

const CLE_SESSION = 'gr-session-fictive';
/** Code d'accès du mode fictif. Écrit en clair : il n'ouvre rien de réel. */
export const CODE_FICTIF = 'DEMO';

const lireSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem(CLE_SESSION) ?? 'null');
  } catch {
    return null;
  }
};

const ecrireSession = (s) => {
  try {
    if (s) sessionStorage.setItem(CLE_SESSION, JSON.stringify(s));
    else sessionStorage.removeItem(CLE_SESSION);
  } catch {
    /* navigation privée : la session ne survivra pas au rechargement, soit. */
  }
};

/* ================================================================== */
/*  Cloisonnement                                                     */
/* ================================================================== */

/** La règle de l'application, pas une seconde règle. */
const visibles = (session, items) => {
  const p = perimetreImpose(session);
  return p ? items.filter((m) => m[p.champ] === p.unite) : items;
};

const exigeSession = (session) => {
  if (!session) refus(401, 'Non connecté.');
  return session;
};

/* ================================================================== */
/*  Journal des écritures — pour que le panneau d'historique vive     */
/* ================================================================== */

const journal = [];
const noter = (session, action, cible) => {
  journal.unshift({
    horodatage: new Date().toISOString(),
    action,
    id: cible?.id ?? null,
    par: session ? `${session.rang} ${session.unite}` : 'anonyme',
    demo: true,
  });
  journal.splice(200);
};

/* ================================================================== */
/*  Routeur                                                           */
/* ================================================================== */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const vide = () => SCENARIO_ACTIF === SCENARIOS.VIDE;

/** Chemins que le scénario « erreur » fait échouer : les lectures de données. */
const LECTURES = /^(marquages|hierarchie|elements|roster|alertes-distance|conflits-planification|missions|instructions|regles|analyse\/situation|journal|comptes)/;

/**
 * Point d'entrée unique, appelé par `src/api.js`.
 *
 * @param {string} chemin  ex. `marquages/BAR-0001` (sans le préfixe `api/`)
 * @param {string} methode GET | POST | PATCH | DELETE
 * @param {object} corps
 */
export async function repondreFictif(chemin, methode = 'GET', corps = undefined) {
  await attendre(latenceSimulee());

  const [avantQuery, query = ''] = chemin.split('?');
  const params = new URLSearchParams(query);
  const morceaux = avantQuery.split('/').filter(Boolean);
  const route = morceaux[0];

  if (SCENARIO_ACTIF === SCENARIOS.ERREUR && methode === 'GET' && LECTURES.test(avantQuery)) {
    refus(503, 'Service indisponible (scénario d’épreuve « erreur »).');
  }

  const jeu = await jeuFictif();
  const session = lireSession();

  /* ------------------------------ état ---------------------------- */

  if (route === 'etat') {
    return {
      service: 'habilitation',
      /* `demo` allume le bandeau permanent — voir BandeauMode.jsx. Le mode
         fictif DOIT porter la même marque que la démonstration serveur : ce
         qui est à l'écran est inventé, la nuance technique n'intéresse pas
         celui qui regarde la carte. */
      mode: 'demo',
      source: 'fictif',
      scenario: SCENARIO_ACTIF,
      comptes: jeu.comptes.length,
      contours: {
        regions: jeu.regions.length,
        compagnies: jeu.compagnies.length,
        manquant: [],
      },
      reseauRoutier: false,
      sessions: session ? 1 : 0,
      assistant: { disponible: false, n8n: false, ollama: false, modele: null },
    };
  }

  /* ----------------------------- unités --------------------------- */

  if (route === 'unites') {
    return {
      compagnies: jeu.compagnies.map((c) => ({ nom: c.nom, reg: c.reg }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
      regions: jeu.regions.map((r) => r.nom).sort((a, b) => a.localeCompare(b, 'fr')),
      unites: jeu.brigades.map((b) => ({ nom: b.nom, cie: b.cie, reg: b.reg }))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    };
  }

  /* ---------------------------- session --------------------------- */

  /* Préférences d'affichage : par compte, dans ce navigateur (le serveur les
     garde, lui, dans le compte — voir /api/preferences). */
  if (route === 'preferences') {
    exigeSession(session);
    const cle = `gr-fictif-preferences:${session.matricule}`;
    let prefs = {};
    try {
      prefs = JSON.parse(localStorage.getItem(cle) ?? '{}') ?? {};
    } catch {
      prefs = {};
    }
    if (methode === 'GET') return { preferences: prefs };
    if (!['midnight', 'graphite', 'arctic', 'forest'].includes(corps?.palette) || !['light', 'dark', 'systeme'].includes(corps?.mode)) {
      refus(422, 'Apparence inconnue.');
    }
    prefs = { palette: corps.palette, mode: corps.mode };
    try {
      localStorage.setItem(cle, JSON.stringify(prefs));
    } catch {
      /* stockage indisponible : la préférence vaut pour la session */
    }
    return { preferences: prefs };
  }

  if (route === 'session') {
    if (methode === 'GET') return { session, motDePasseAChanger: false };
    if (methode === 'DELETE') {
      ecrireSession(null);
      return null;
    }
    if (methode === 'POST') {
      const { rang, unite, code } = corps ?? {};
      if (code !== CODE_FICTIF) {
        refus(401, `Mot de passe incorrect. En mode fictif, le code est « ${CODE_FICTIF} ».`);
      }
      /* Connexion par matricule personnel : `rang` absent, `unite` porte le
         matricule — même convention que Login.jsx. */
      const personne = !rang && jeu.effectifs.find((e) => e.matricule === unite);
      const compte = personne
        ? { rang: 'unite', unite: personne.bt, nom: personne.nom, role: 'commandement',
          reg: personne.reg, cie: personne.cie }
        : jeu.comptes.find((c) => c.rang === rang && c.unite === unite)
          ?? (rang && unite ? deduireCompte(jeu, rang, unite) : null);

      if (!compte) refus(401, 'Unité inconnue du jeu fictif.');

      const nouvelle = {
        matricule: personne?.matricule ?? `DEMO-${compte.rang.toUpperCase()}`,
        nom: compte.nom,
        role: compte.role,
        rang: compte.rang,
        unite: compte.unite,
        reg: compte.reg,
        cie: compte.cie,
        demo: true,
      };
      ecrireSession(nouvelle);
      noter(nouvelle, 'connexion', null);
      return { session: nouvelle, motDePasseAChanger: false };
    }
  }

  if (route === 'motdepasse') {
    return { session: lireSession(), motDePasseAChanger: false };
  }

  /* --------------------------- hiérarchie -------------------------- */

  if (route === 'hierarchie') {
    exigeSession(session);
    return hierarchieDe(jeu, session);
  }

  /* --------------------------- marquages --------------------------- */

  /* « Modifier barrage » (effectif + protection) : les règles — relève
     nominative, un intouchable par compagnie, distance routière — sont tenues
     par le serveur ; le mode fictif le dit plutôt que de les imiter. */
  if (route === 'barrages' && morceaux[2] === 'modification') {
    refus(503, 'Modification de barrage indisponible en mode fictif : ses contrôles sont tenus par le serveur.');
  }

  if (route === 'marquages') {
    exigeSession(session);

    if (morceaux[1] === 'import' && methode === 'POST') {
      const ajoutes = (corps?.items ?? []).filter((m) => m?.id);
      jeu.barrages.push(...ajoutes.map((m) => ({ ...m, demo: true })));
      noter(session, 'import', null);
      return { ajoutes: ajoutes.length, ignores: (corps?.items?.length ?? 0) - ajoutes.length };
    }

    /* La génération automatique repose, côté serveur, sur les points noirs et
       le réseau routier : sans eux, on ne fabrique pas un dispositif. */
    if (morceaux[1] === 'generer' && methode === 'POST') {
      return { crees: [], ignores: 0, motif: 'Génération indisponible en mode fictif.' };
    }

    if (methode === 'GET') return { items: vide() ? [] : visibles(session, jeu.barrages) };

    if (methode === 'POST') {
      const item = poserBarrage(jeu, session, corps);
      noter(session, 'creation', item);
      return { item };
    }

    if (morceaux[1] && methode === 'PUT') {
      refus(405, 'Méthode non prévue par le service.');
    }

    const id = morceaux[1];
    const index = jeu.barrages.findIndex((m) => m.id === id);
    if (index < 0) refus(404, 'Repère introuvable.');
    if (!visibles(session, [jeu.barrages[index]]).length) {
      refus(403, 'Ce repère est hors de votre périmètre.');
    }

    if (methode === 'PATCH') {
      const item = { ...jeu.barrages[index], ...corps, id, maj: new Date().toISOString() };
      jeu.barrages[index] = item;
      noter(session, 'modification', item);
      return { item };
    }
    if (methode === 'DELETE') {
      const [retire] = jeu.barrages.splice(index, 1);
      /* Les relèves du poste partent avec lui : une présence orpheline
         compterait encore dans les épreuves de la règle des trois, et se
         rattacherait à un poste qui n'existe plus. */
      for (let i = jeu.elements.length - 1; i >= 0; i--) {
        if (jeu.elements[i].barrageId === retire.id) jeu.elements.splice(i, 1);
      }
      noter(session, 'suppression', retire);
      return null;
    }
  }

  /* ---------------------------- barrages --------------------------- */

  if (route === 'barrages') {
    exigeSession(session);
    if (morceaux[1] === 'lot' && methode === 'POST') {
      const action = corps?.action ?? '';
      const ids = new Set(corps?.ids ?? []);

      /**
       * L'ARBITRAGE REND UNE DÉCISION, IL N'EFFACE RIEN.
       *
       * Ces trois actions étaient absentes : cliquer « Conserver » ou
       * « Retirer » sur un poste signalé partait au fournisseur, ne
       * correspondait à aucune branche, et repartait avec `traites: 0` — sans
       * erreur, sans effet. Le bouton semblait mort.
       *
       * `conserver` et `reconsiderer` ne touchent QUE `decisionOptimisation` ;
       * `proposer_suppression` marque le poste en attente du commandant. Aucun
       * barrage n'est retiré ici — le retrait réel n'a lieu qu'à l'acceptation
       * de la proposition, exactement comme côté serveur.
       */
      const DECISION = {
        conserver: 'conserve',
        proposer_suppression: 'a_supprimer',
        reconsiderer: 'aucune',
      };

      let touches = 0;
      const ignores = [];
      for (const m of jeu.barrages) {
        if (!ids.has(m.id)) continue;
        /* Même règle qu'au serveur : l'autorité se vérifie poste par poste. */
        if (!visibles(session, [m]).length) {
          ignores.push({ id: m.id, raison: motifHorsPortee(session) });
          continue;
        }
        if (action in DECISION) m.decisionOptimisation = DECISION[action];
        else if (action === 'supprimer') m._retire = true;
        else if (action === 'approuver') m.statutBarrage = 'approuve';
        else if (action === 'annuler') m.statutBarrage = 'annule';
        else {
          ignores.push({ id: m.id, raison: `Action inconnue : ${action || '(vide)'}.` });
          continue;
        }
        m.maj = new Date().toISOString();
        touches++;
      }
      if (action === 'supprimer') {
        for (let i = jeu.barrages.length - 1; i >= 0; i--) {
          if (jeu.barrages[i]._retire) jeu.barrages.splice(i, 1);
        }
      }
      noter(session, `lot:${action}`, null);
      /* `items` : le dépôt à jour, que la carte relit sans second aller-retour
         — même forme que la réponse du serveur. */
      return { traites: touches, ignores, action, items: visibles(session, jeu.barrages) };
    }
    /**
     * CONSOLIDATION ET PROPOSITION DEMANDENT LE GRAPHE ROUTIER — 409, comme le
     * serveur.
     *
     * Une liste VIDE aurait été pire qu'un refus : la synthèse « Situation
     * après optimisation » l'aurait comptée et affiché « 0 » sur chaque
     * critère, ce qui se lit « dispositif sans défaut » alors que rien n'a été
     * calculé. Le serveur réel répond 409 quand le graphe manque (voir
     * `/api/barrages/consolidation`) ; le mode fictif dit la même chose, avec
     * le même code, et l'écran affiche « Aucune optimisation effectuée ».
     */
    refus(409, "Réseau routier indisponible en mode fictif : l'optimisation par distance "
      + 'demande le graphe routier et un service. Lancez `npm run serve:demo`.');
    return null;
  }

  /* --------------------------- éléments ---------------------------- */

  if (route === 'elements') {
    exigeSession(session);

    if (methode === 'GET') {
      const barrageId = params.get('barrageId');
      const barrage = jeu.barrages.find((m) => m.id === barrageId);
      if (!barrage) refus(404, 'Poste introuvable.');
      if (!visibles(session, [barrage]).length) refus(403, 'Poste hors de votre périmètre.');
      const items = vide() ? [] : jeu.elements.filter((e) => e.barrageId === barrageId);
      return {
        items,
        date: CONFIG_FICTIVE.dateReference,
        creneau: items[0]?.creneau ?? 0,
        /* Ce que le poste attend : la règle, la même pour tous. */
        attendus: ELEMENTS_PAR_BARRAGE,
      };
    }

    if (methode === 'POST') {
      const barrage = jeu.barrages.find((m) => m.id === corps?.barrageId);
      if (!barrage) refus(404, 'Poste introuvable.');
      if (!visibles(session, [barrage]).length) refus(403, 'Poste hors de votre périmètre.');

      /* LA RÈGLE DES TROIS, côté fictif comme côté serveur (voir la même
         garde dans serveur/api.mjs) : on ne pose pas un quatrième homme. */
      const surLeCreneau = jeu.elements.filter(
        (e) => e.barrageId === barrage.id && e.date === CONFIG_FICTIVE.dateReference,
      );
      if (surLeCreneau.length >= ELEMENTS_PAR_BARRAGE) {
        refus(400,
          `Ce poste compte déjà ${surLeCreneau.length} éléments sur ce créneau : `
          + `un barrage en tient exactement ${ELEMENTS_PAR_BARRAGE}. Retirez-en un avant d'ajouter.`);
      }

      /* Et trois hommes DE SA BRIGADE. */
      const deLaBrigade = jeu.effectifs.filter((e) => e.bt === barrage.bt);
      if (!deLaBrigade.some((p) => p.matricule === corps?.matricule)) {
        refus(400,
          `${corps?.matricule ?? 'Cet élément'} n'appartient pas à la brigade ${barrage.bt} : `
          + 'un barrage est tenu par des hommes de sa propre brigade.');
      }

      const item = {
        id: `EL-REL-SAISIE-${jeu.elements.length + 1}`,
        barrageId: barrage.id,
        grade: GRADES.includes(corps.grade) ? corps.grade : 'MDLG',
        nom: corps.nom,
        matricule: corps.matricule,
        date: CONFIG_FICTIVE.dateReference,
        heure: '06:00',
        creneau: 6,
        saisiLe: new Date().toISOString(),
        prepare: false,
        auteur: session,
        demo: true,
      };
      jeu.elements.push(item);
      (barrage.elements ??= []).push(item.id);
      noter(session, 'element:ajout', item);
      /* `element`, et non `item` : c'est la clé du serveur (201 { element }),
         et `src/api.js` lit exactement celle-là. Une clé approchante rendrait
         `undefined` à l'appelant — une panne silencieuse, propre à ce genre de
         double implémentation, que seule l'exactitude du contrat évite. */
      return { element: item };
    }

    if (methode === 'DELETE') {
      const i = jeu.elements.findIndex((e) => e.id === morceaux[1]);
      if (i < 0) refus(404, 'Élément introuvable.');
      const [retire] = jeu.elements.splice(i, 1);
      const poste = jeu.barrages.find((m) => m.id === retire.barrageId);
      if (poste?.elements) poste.elements = poste.elements.filter((id) => id !== retire.id);
      noter(session, 'element:retrait', retire);
      return { supprime: retire.id };
    }
  }

  /* ----------------------------- relève ---------------------------- */

  if (route === 'roster') {
    exigeSession(session);
    if (morceaux[1] === 'etat') {
      return {
        date: CONFIG_FICTIVE.dateReference,
        prepare: true,
        lignes: jeu.elements.length,
        barrages: new Set(jeu.elements.map((e) => e.barrageId)).size,
      };
    }
    if (morceaux[1] === 'preparer') {
      return { rapport: { prepares: 0, motif: 'Préparation indisponible en mode fictif.' } };
    }
    const bt = params.get('bt');
    if (!bt) refus(400, 'Précisez la brigade (bt).');

    /**
     * LE PARAMÈTRE NE DONNE AUCUN DROIT.
     *
     * `?bt=` est écrit par l'appelant : il désigne ce qu'on demande, jamais ce
     * qu'on a le droit d'obtenir. Sans ce contrôle, un chef de brigade lisait
     * l'effectif nominatif de n'importe quelle brigade du pays en changeant un
     * mot dans l'URL — c'est exactement la faille que le serveur réel ferme de
     * son côté (voir `/api/roster` dans serveur/api.mjs), et le mode fictif
     * n'avait pas le droit d'être plus permissif : on s'en servirait pour
     * éprouver le cloisonnement, et il donnerait le feu vert à tort.
     */
    const brigade = jeu.brigades.find((b) => b.nom === bt);
    if (!brigade) refus(404, `Brigade inconnue : ${bt}.`);
    if (!dansSaPortee(session, 'brigade', bt, { cie: brigade.cie, reg: brigade.reg })) {
      refus(403, motifHorsPortee(session));
    }

    const postes = visibles(session, jeu.barrages).filter((m) => m.bt === bt);
    return {
      bt,
      date: params.get('date') ?? CONFIG_FICTIVE.dateReference,
      effectif: jeu.effectifs.filter((e) => e.bt === bt),
      composition: Object.fromEntries(postes.map((m) => [m.id, []])),
      barrages: postes.map((m) => ({
        id: m.id, nom: m.nom, route: m.route, type: m.type, lng: m.lng, lat: m.lat,
      })),
      lignes: jeu.elements.filter((e) => postes.some((m) => m.id === e.barrageId)),
    };
  }

  /* -------------------- listes secondaires ------------------------- */

  /**
   * Missions, consignes et règles enregistrées : le jeu fictif n'en sème
   * aucune — ce sont des écritures de chef, pas un état du dispositif. Les
   * écrans doivent donc afficher leur état VIDE, qui est la vérité, et rester
   * utilisables : ce qu'on y crée vit le temps de la session.
   *
   * La CLÉ DE RÉPONSE est celle du serveur, une par route (`mission`,
   * `regle`, `instruction`) : `src/api.js` lit précisément celle-là.
   */
  if (route === 'missions' || route === 'instructions' || route === 'regles') {
    exigeSession(session);
    const cle = { missions: 'mission', instructions: 'instruction', regles: 'regle' }[route];
    const local = (jeu.secondaires ??= { missions: [], instructions: [], regles: [] });

    if (methode === 'GET') return { items: vide() ? [] : local[route] };
    if (methode === 'POST') {
      const objet = {
        id: `${cle.toUpperCase()}-DEMO-${local[route].length + 1}`,
        ...corps,
        auteur: session,
        cree: new Date().toISOString(),
        demo: true,
      };
      local[route].push(objet);
      noter(session, `${cle}:creation`, objet);
      return { [cle]: objet };
    }
    const index = local[route].findIndex((x) => x.id === morceaux[1]);
    if (methode === 'DELETE') {
      if (index >= 0) local[route].splice(index, 1);
      return null;
    }
    if (index < 0) refus(404, 'Introuvable.');
    local[route][index] = { ...local[route][index], ...corps };
    /* Une décision de consigne rapporte aussi le dépôt à jour — voir
       `deciderNotification` dans src/api.js. */
    return { [cle]: local[route][index], items: visibles(session, jeu.barrages) };
  }

  /**
   * Alertes de distance et conflits de planification : calculés par le
   * serveur à partir du GRAPHE ROUTIER, absent ici. Liste vide et
   * `reseauRoutier: false` — la même réponse dégradée que donne le serveur
   * réel quand le graphe n'est pas chargé, donc un chemin déjà éprouvé.
   */
  if (route === 'alertes-distance' || route === 'conflits-planification') {
    exigeSession(session);
    if (methode === 'GET') {
      return route === 'alertes-distance'
        ? { items: [], reseauRoutier: false }
        : { items: [] };
    }
    return route === 'alertes-distance' ? { alerte: null } : { conflit: null };
  }

  if (route === 'conflits') {
    exigeSession(session);
    if (morceaux[1] === 'cmnd-reg') {
      const pBAId = params.get('barrageAId');
      const pBBId = params.get('barrageBId');
      const bA = pBAId ? (jeu.barrages || []).find((b) => b.id === pBAId) : null;
      const bB = pBBId ? (jeu.barrages || []).find((b) => b.id === pBBId) : null;
      const regA = params.get('regA') || bA?.reg || null;
      const regB = params.get('regB') || bB?.reg || null;
      const norm = (s) => String(s || '').trim().toLowerCase();
      const matchReg = (u, t) => Boolean(u && t && (norm(u) === norm(t) || norm(u).includes(norm(t)) || norm(t).includes(norm(u))));
      const comptes = (jeu.regions || []).map((r) => {
        const concerneA = Boolean(regA && matchReg(r.nom, regA));
        const concerneB = Boolean(regB && matchReg(r.nom, regB));
        let roleConflit = null;
        if (concerneA && concerneB) roleConflit = 'Barrages A & B';
        else if (concerneA) roleConflit = `Barrage A (${bA?.nom || 'A'})`;
        else if (concerneB) roleConflit = `Barrage B (${bB?.nom || 'B'})`;
        return {
          matricule: `REG-${r.nom.toUpperCase().replace(/\s+/g, '-')}`,
          nom: `Chef de région ${r.nom}`,
          unite: r.nom,
          region: r.nom,
          duConflit: Boolean(concerneA || concerneB),
          concerneA,
          concerneB,
          roleConflit,
        };
      }).sort((a, b) => Number(b.duConflit) - Number(a.duConflit) || a.unite.localeCompare(b.unite, 'fr'));

      return { comptes, regA, regB, estInterRegion: regA !== regB, regionsConcernees: [regA, regB].filter(Boolean) };
    }
    if (methode === 'GET') {
      return { items: [], totaux: { nouveau: 0, a_traiter: 0, en_cours: 0, resolu: 0, total: 0 } };
    }
    if (methode === 'DELETE') {
      return { ok: true, message: 'Tous les conflits ont été effacés.' };
    }
    return { ok: true, conflit: { id: morceaux[1] || 'conf', ...(typeof corps === 'object' ? corps : {}), statut: 'resolu' }, resolu: true };
  }

  if (route === 'distances-plus-proche') {
    exigeSession(session);
    return { items: [], reseauRoutier: false };
  }

  if (route === 'analyse') {
    exigeSession(session);
    return situationDe(jeu, session);
  }

  /**
   * Notifications d'événements et suivi des assignations : nés des écritures
   * du SERVEUR (son journal). Sans serveur, il ne s'est rien passé — la liste
   * vide est la vérité, pas une panne.
   */
  if (route === 'notifications') {
    exigeSession(session);
    if (methode === 'GET') return { items: [], nonLues: 0, total: 0 };
    refus(404, 'Notification introuvable.');
  }
  if (route === 'assignations' && morceaux[1] === 'suivi') {
    exigeSession(session);
    if (session.rang !== 'admin') refus(403, 'Le suivi des assignations est réservé au Super Admin.');
    return { items: [], totaux: { en_attente: 0, en_cours: 0, termine: 0 } };
  }

  if (route === 'journal') {
    exigeSession(session);
    return { entrees: journal.filter((e) => !params.get('id') || e.id === params.get('id')) };
  }

  if (route === 'comptes') {
    exigeSession(session);
    if (session.rang !== 'admin') refus(403, 'Accès réservé aux administrateurs.');
    if (methode === 'GET') {
      return { comptes: jeu.comptes.map((c) => ({ ...c, matricule: `DEMO-${c.rang.toUpperCase()}` })) };
    }
    return methode === 'DELETE' ? null : { compte: { ...corps, demo: true } };
  }

  if (route === 'assistant') {
    return { disponible: false, analyse: null, motif: 'Assistant indisponible en mode fictif.' };
  }

  refus(404, `Chemin inconnu du fournisseur fictif : ${avantQuery}`);
  return null;
}

/* ================================================================== */
/*  Aides                                                             */
/* ================================================================== */

/** Un compte pour n'importe quelle unité du jeu : tout rang doit pouvoir être éprouvé. */
function deduireCompte(jeu, rang, unite) {
  if (rang === 'admin') {
    return { rang, unite, nom: `Administrateur ${unite} DEMO`, role: 'commandement', reg: null, cie: null };
  }
  if (rang === 'reg') {
    const r = jeu.regions.find((x) => x.nom === unite);
    return r && { rang, unite, nom: `Chef de région ${unite} DEMO`, role: 'commandement', reg: unite, cie: null };
  }
  if (rang === 'cie') {
    const c = jeu.compagnies.find((x) => x.nom === unite);
    return c && { rang, unite, nom: `Chef de compagnie ${unite} DEMO`, role: 'commandement', reg: c.reg, cie: unite };
  }
  const b = jeu.brigades.find((x) => x.nom === unite);
  return b && { rang, unite, nom: `Chef de brigade ${unite} DEMO`, role: 'commandement', reg: b.reg, cie: b.cie };
}

/** Pose d'un repère : mêmes champs que le serveur, rattachement compris. */
function poserBarrage(jeu, session, champs) {
  const brigade =
    jeu.brigades.find((b) => b.nom === champs?.bt) ??
    jeu.brigades.find((b) => b.cie === session.cie) ??
    jeu.brigades[0];

  /**
   * TROIS ÉLÉMENTS À LA POSE — quand l'appelant en fournit.
   *
   * Le geste ordinaire de la carte pose un poste PUIS l'arme (panneau
   * Effectifs / Relèves) : le corps n'a alors pas de champ `elements`, et le
   * poste naît à 0 / 3, ce que l'écran affiche sans ambiguïté. Dès qu'un
   * appelant fournit la liste, en revanche, elle est tenue à la règle
   * complète : exactement trois, existants, et de la brigade du poste.
   */
  if (champs?.elements != null) {
    const verdict = verifieEffectifBarrage(champs.elements);
    if (!verdict.ok) refus(400, verdict.motif);

    const parMatricule = new Map(jeu.effectifs.map((e) => [e.matricule, e]));
    const choisis = champs.elements.map((ref) =>
      typeof ref === 'string' ? parMatricule.get(ref) : parMatricule.get(ref?.matricule));

    const introuvable = champs.elements.find((ref, i) => !choisis[i]);
    if (introuvable) {
      refus(400, `Élément inconnu de l'effectif : ${JSON.stringify(introuvable)}.`);
    }
    if (new Set(choisis.map((e) => e.matricule)).size !== ELEMENTS_PAR_BARRAGE) {
      refus(400, 'Le même homme ne peut pas occuper deux des trois places du poste.');
    }
    const etranger = choisis.find((e) => e.bt !== brigade.nom);
    if (etranger) {
      refus(400,
        `${etranger.matricule} appartient à la brigade ${etranger.bt}, pas à ${brigade.nom} : `
        + 'un barrage est tenu par des hommes de sa propre brigade.');
    }
  }
  const item = {
    ...champs,
    id: champs?.id ?? `BAR-SAISIE-${jeu.barrages.length + 1}`,
    bt: champs?.bt ?? brigade?.nom ?? null,
    cie: champs?.cie ?? brigade?.cie ?? null,
    reg: champs?.reg ?? brigade?.reg ?? null,
    statutBarrage: champs?.statutBarrage ?? 'en_attente',
    auteur: session,
    cree: new Date().toISOString(),
    maj: new Date().toISOString(),
    demo: true,
  };
  jeu.barrages.push(item);

  /* Les trois présences correspondantes, si la liste a été fournie. */
  if (champs?.elements != null) {
    const parMatricule = new Map(jeu.effectifs.map((e) => [e.matricule, e]));
    item.elements = [];
    for (const ref of champs.elements) {
      const personne = parMatricule.get(typeof ref === 'string' ? ref : ref?.matricule);
      const releve = {
        id: `EL-REL-SAISIE-${jeu.elements.length + 1}`,
        barrageId: item.id,
        grade: personne.grade,
        nom: personne.nom,
        matricule: personne.matricule,
        date: CONFIG_FICTIVE.dateReference,
        heure: '06:00',
        creneau: 6,
        saisiLe: new Date().toISOString(),
        prepare: false,
        auteur: session,
        demo: true,
      };
      jeu.elements.push(releve);
      item.elements.push(releve.id);
    }
  }

  return item;
}

/** L'arbre région → compagnie → brigade, chiffré, borné au périmètre. */
function hierarchieDe(jeu, session) {
  const p = perimetreImpose(session);
  const postes = vide() ? [] : visibles(session, jeu.barrages);
  const elementsParBarrage = new Set(jeu.elements.map((e) => e.barrageId));

  const compte = (liste) => ({
    barrages: liste.length,
    fixes: liste.filter((m) => m.type === 'barrage_fixe').length,
    mobiles: liste.filter((m) => m.type === 'barrage_mobile').length,
    tenus: liste.filter((m) => elementsParBarrage.has(m.id)).length,
  });

  const retenue = (u, niveau) => {
    if (!p) return true;
    if (p.champ === 'reg') return niveau === 'region' ? u.nom === p.unite : u.reg === p.unite;
    if (p.champ === 'cie') {
      if (niveau === 'region') return jeu.compagnies.some((c) => c.nom === p.unite && c.reg === u.nom);
      if (niveau === 'compagnie') return u.nom === p.unite;
      return u.cie === p.unite;
    }
    const b = jeu.brigades.find((x) => x.nom === p.unite);
    if (niveau === 'region') return u.nom === b?.reg;
    if (niveau === 'compagnie') return u.nom === b?.cie;
    return u.nom === p.unite;
  };

  const brigades = jeu.brigades.filter((b) => retenue(b, 'brigade')).map((b) => {
    const siens = postes.filter((m) => m.bt === b.nom);
    const hommes = jeu.effectifs.filter((e) => e.bt === b.nom);
    return {
      nom: b.nom, cie: b.cie, reg: b.reg,
      ...compte(siens),
      effectif: hommes.length,
      /* Disponible / indisponible : le jeu fictif porte l'information (voir
         `disponibilite` dans le générateur). Le SERVEUR RÉEL ne la connaît
         pas — son fichier d'effectifs n'a pas ce champ — et ses réponses
         n'auront donc pas ces deux clés. Les écrans doivent s'en passer :
         voir `LigneEffectif` dans HierarchiePanel.jsx. */
      effectifDisponible: hommes.filter((e) => e.disponibilite).length,
      effectifIndisponible: hommes.filter((e) => !e.disponibilite).length,
      effectifDemo: true,
    };
  });

  const somme = (liste, champ) => liste.reduce((t, x) => t + (x[champ] ?? 0), 0);

  const compagnies = jeu.compagnies.filter((c) => retenue(c, 'compagnie')).map((c) => {
    const siennes = brigades.filter((b) => b.cie === c.nom);
    return {
      nom: c.nom, reg: c.reg, brigades: siennes, nbBrigades: siennes.length,
      barrages: somme(siennes, 'barrages'), fixes: somme(siennes, 'fixes'),
      mobiles: somme(siennes, 'mobiles'), tenus: somme(siennes, 'tenus'),
      effectif: somme(siennes, 'effectif'),
      effectifDisponible: somme(siennes, 'effectifDisponible'),
      effectifIndisponible: somme(siennes, 'effectifIndisponible'),
      effectifDemo: true,
    };
  });

  const regions = jeu.regions.filter((r) => retenue(r, 'region')).map((r) => {
    const siennes = compagnies.filter((c) => c.reg === r.nom);
    return {
      nom: r.nom, compagnies: siennes, nbCompagnies: siennes.length,
      nbBrigades: somme(siennes, 'nbBrigades'), barrages: somme(siennes, 'barrages'),
      fixes: somme(siennes, 'fixes'), mobiles: somme(siennes, 'mobiles'),
      tenus: somme(siennes, 'tenus'), effectif: somme(siennes, 'effectif'),
      effectifDisponible: somme(siennes, 'effectifDisponible'),
      effectifIndisponible: somme(siennes, 'effectifIndisponible'),
      effectifDemo: true, orphelines: [],
    };
  });

  return {
    date: CONFIG_FICTIVE.dateReference,
    creneau: 6,
    portee: p ? { niveau: p.niveau, unite: p.unite } : { niveau: 'national', unite: null },
    total: {
      regions: regions.length,
      compagnies: somme(regions, 'nbCompagnies'),
      brigades: somme(regions, 'nbBrigades'),
      barrages: somme(regions, 'barrages'),
      fixes: somme(regions, 'fixes'),
      mobiles: somme(regions, 'mobiles'),
      tenus: somme(regions, 'tenus'),
      effectif: somme(regions, 'effectif'),
      effectifDisponible: somme(regions, 'effectifDisponible'),
      effectifIndisponible: somme(regions, 'effectifIndisponible'),
      effectifDemo: true,
    },
    regions,
  };
}

/** Situation nationale — les mêmes chiffres, agrégés au périmètre visible. */
function situationDe(jeu, session) {
  const postes = vide() ? [] : visibles(session, jeu.barrages);
  const tenus = new Set(jeu.elements.map((e) => e.barrageId));
  return {
    date: CONFIG_FICTIVE.dateReference,
    creneau: 6,
    barrages: postes.length,
    fixes: postes.filter((m) => m.type === 'barrage_fixe').length,
    mobiles: postes.filter((m) => m.type === 'barrage_mobile').length,
    tenus: postes.filter((m) => tenus.has(m.id)).length,
    effectif: visibles(session, jeu.effectifs).length,
    parStatut: Object.fromEntries(
      ['en_attente', 'approuve', 'a_modifier', 'annule'].map((s) => [
        s, postes.filter((m) => m.statutBarrage === s).length,
      ]),
    ),
    demo: true,
  };
}
