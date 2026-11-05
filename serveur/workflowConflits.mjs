/**
 * WORKFLOW DE TRAITEMENT DES CONFLITS — Super Admin → CMD Région → CMD CIE.
 *
 * LA source de vérité unique des états, des transitions, des droits et des
 * sections. Le serveur (suiviConflits.mjs, api.mjs) n'écrit jamais un état
 * sans passer par `verifierAction` ; l'interface affiche ce que
 * `presenterWorkflow` lui dit (section, actions permises) sans recalculer les
 * droits.
 *
 *   NEW ──assigner_region──▶ ASSIGNED_REGION ──prendre_en_charge──▶ IN_PROGRESS_REGION ─┐
 *                                  │                                                     │
 *                                  └──assigner_cie──▶ ASSIGNED_CIE ──commencer──▶ IN_PROGRESS_CIE
 *                                                                                        │
 *                            soumettre (CMD Région ou CMD CIE responsable) ◀─────────────┘
 *                                   ▼
 *                           PENDING_VALIDATION ──rejeter (motif)──▶ REJECTED ──(reprise par le responsable)
 *                                   │
 *                                valider
 *                                   ▼
 *                     (APPROVED) ─▶ CLOSED ──rouvrir (motif)──▶ ASSIGNED_REGION | NEW
 *
 * L'APPROBATION ARCHIVE : `valider` traverse APPROVED (inscrit à
 * l'historique) et aboutit directement à CLOSED — il n'y a plus d'étape de
 * suivi à clôturer à la main. Les conflits enregistrés avant ce changement en
 * APPROVED ou FOLLOW_UP ne sont pas réécrits : ils sont LUS comme archivés
 * (section Historique, `estClos`), et `cloturer` reste permis pour eux.
 *
 * SECTIONS (une et une seule par état — aucun conflit n'apparaît dans deux) :
 *   Les Conflits  NEW
 *   À traiter     ASSIGNED_REGION, IN_PROGRESS_REGION, ASSIGNED_CIE, IN_PROGRESS_CIE, REJECTED
 *   À valider     PENDING_VALIDATION
 *   Historique    CLOSED (et APPROVED, FOLLOW_UP antérieurs)
 *
 * VISIBILITÉ (équivalent des policies RLS, appliquée par le serveur) :
 *   Super Admin  tout ;
 *   CMD Région   les conflits ASSIGNÉS à sa région (jamais un NEW non assigné) ;
 *   CMD CIE      les conflits assignés à SA compagnie ;
 *   autres       rien.
 *
 * Pur, sans E/S : `npm run check:workflow-conflits`.
 */

export const ETATS = Object.freeze({
  NEW: 'NEW',
  ASSIGNED_REGION: 'ASSIGNED_REGION',
  IN_PROGRESS_REGION: 'IN_PROGRESS_REGION',
  ASSIGNED_CIE: 'ASSIGNED_CIE',
  IN_PROGRESS_CIE: 'IN_PROGRESS_CIE',
  PENDING_VALIDATION: 'PENDING_VALIDATION',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  FOLLOW_UP: 'FOLLOW_UP',
  CLOSED: 'CLOSED',
});

/** Libellés affichés (français). */
export const LIBELLES = Object.freeze({
  NEW: 'Nouveau — non assigné',
  ASSIGNED_REGION: 'Assigné au CMD Région',
  IN_PROGRESS_REGION: 'En traitement — CMD Région',
  ASSIGNED_CIE: 'Assigné au CMD CIE',
  IN_PROGRESS_CIE: 'En traitement — CMD CIE',
  PENDING_VALIDATION: 'À valider',
  REJECTED: 'Rejeté — à corriger',
  APPROVED: 'Validé',
  FOLLOW_UP: 'Validé',
  CLOSED: 'Clôturé',
});

export const SECTIONS = Object.freeze({
  CONFLITS: 'conflits',
  A_TRAITER: 'a_traiter',
  A_VALIDER: 'a_valider',
  HISTORIQUE: 'historique',
});

export const LIBELLES_SECTIONS = Object.freeze({
  conflits: 'Nouveaux',
  a_traiter: 'À traiter',
  a_valider: 'À valider',
  historique: 'Historique',
});

export const SECTION_DE = Object.freeze({
  NEW: SECTIONS.CONFLITS,
  ASSIGNED_REGION: SECTIONS.A_TRAITER,
  IN_PROGRESS_REGION: SECTIONS.A_TRAITER,
  ASSIGNED_CIE: SECTIONS.A_TRAITER,
  IN_PROGRESS_CIE: SECTIONS.A_TRAITER,
  REJECTED: SECTIONS.A_TRAITER,
  PENDING_VALIDATION: SECTIONS.A_VALIDER,
  APPROVED: SECTIONS.HISTORIQUE,
  FOLLOW_UP: SECTIONS.HISTORIQUE,
  CLOSED: SECTIONS.HISTORIQUE,
});

/**
 * L'ANCIEN `statut` (et `approbation.statut`), tenu à jour pour les modules
 * qui le lisent encore (radar, filtres, notifications) : dérivé de l'état,
 * jamais l'inverse.
 */
export const STATUT_HERITE = Object.freeze({
  NEW: 'nouveau',
  ASSIGNED_REGION: 'a_traiter',
  IN_PROGRESS_REGION: 'en_cours',
  ASSIGNED_CIE: 'a_traiter',
  IN_PROGRESS_CIE: 'en_cours',
  PENDING_VALIDATION: 'traite',
  REJECTED: 'a_corriger',
  APPROVED: 'traite',
  FOLLOW_UP: 'traite',
  CLOSED: 'cloture',
});
export const APPROBATION_HERITEE = Object.freeze({
  PENDING_VALIDATION: 'en_attente_admin',
  REJECTED: 'rejete_admin',
  APPROVED: 'approuve',
  FOLLOW_UP: 'approuve',
  CLOSED: 'approuve',
});

/** Erreur de workflow : porte le code HTTP que la route doit renvoyer. */
export class ErreurWorkflow extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const meme = (a, b) => Boolean(a) && Boolean(b) && norm(a) === norm(b);

/* ------------------------------------------------------------------ */
/* L'état d'un conflit                                                */
/* ------------------------------------------------------------------ */

/**
 * L'ÉTAT D'UN CONFLIT. `conf.etat` fait foi ; un conflit antérieur au
 * workflow (non migré) voit son état DÉDUIT de ses anciens champs, avec la
 * même règle que la migration (scripts/migrer-etats-conflits.mjs).
 */
export function etatDe(conf) {
  if (!conf) return null;
  if (ETATS[conf.etat]) return conf.etat;
  const app = conf.approbation?.statut ?? conf.traitement?.approbation?.statut ?? null;
  const cie = conf.assigneCie?.unite ?? null;
  const assigneRegion = Boolean(conf.assigneA?.unite || conf.assignesA?.length);
  switch (conf.statut) {
    case 'cloture':
      return ETATS.CLOSED;
    case 'a_corriger':
      return ETATS.REJECTED;
    default:
  }
  if (app === 'approuve') return ETATS.FOLLOW_UP;
  if (app === 'en_attente_admin' || app === 'en_attente_reg') return ETATS.PENDING_VALIDATION;
  if (app === 'rejete_admin' || app === 'rejete_reg') return ETATS.REJECTED;
  switch (conf.statut) {
    case 'traite':
      return ETATS.PENDING_VALIDATION;
    case 'resolu':
      /* Résolu « physiquement » (distance redevenue conforme) sans décision :
         il n'attend plus rien — archivé. */
      return ETATS.CLOSED;
    case 'en_cours':
      return cie ? ETATS.IN_PROGRESS_CIE : ETATS.IN_PROGRESS_REGION;
    case 'a_traiter':
      if (cie) return ETATS.ASSIGNED_CIE;
      return assigneRegion ? ETATS.ASSIGNED_REGION : ETATS.NEW;
    default:
      return ETATS.NEW;
  }
}

export const sectionDe = (conf) => SECTION_DE[etatDe(conf)] ?? SECTIONS.CONFLITS;
/** Archivé : à l'historique, hors des listes actives (CLOSED, ou validé avant la suppression du suivi). */
export const estClos = (conf) => sectionDe(conf) === SECTIONS.HISTORIQUE;
const ARCHIVES = [ETATS.APPROVED, ETATS.FOLLOW_UP, ETATS.CLOSED];

/* Un traitement soumis, validé, en suivi ou clos fait partie de l'historique :
   il n'est jamais supprimé physiquement. */
const NON_SUPPRIMABLES = new Set([ETATS.PENDING_VALIDATION, ETATS.APPROVED, ETATS.FOLLOW_UP, ETATS.CLOSED]);

/** Suppression (faux positif) : Super Admin seul, avant toute soumission. */
export function peutSupprimer(conf, session) {
  if (session?.rang !== 'admin') return false;
  return !conf || !NON_SUPPRIMABLES.has(etatDe(conf));
}

/* ------------------------------------------------------------------ */
/* Assignations                                                       */
/* ------------------------------------------------------------------ */

/** Les régions assignées : [{ unite, matricule, nom }] (conflit inter-régions : deux). */
export function regionsAssignees(conf) {
  if (Array.isArray(conf?.assignation?.regions)) return conf.assignation.regions;
  const anciennes = (conf?.assignesA ?? []).filter((a) => a?.rang === 'reg' || a?.region);
  if (anciennes.length) return anciennes.map((a) => ({ unite: a.unite ?? a.region, matricule: a.matricule ?? null, nom: a.nom ?? null }));
  if (conf?.assigneA?.rang === 'reg' && conf.assigneA.unite && !String(conf.assigneA.unite).includes(' & ')) {
    return [{ unite: conf.assigneA.unite, matricule: conf.assigneA.matricule ?? null, nom: conf.assigneA.nom ?? null }];
  }
  return [];
}

/** La compagnie assignée : { unite, reg, matricule, nom } | null. */
export function cieAssignee(conf) {
  if (conf?.assignation && 'cie' in conf.assignation) return conf.assignation.cie ?? null;
  const c = conf?.assigneCie;
  return c?.unite ? { unite: c.unite, reg: c.reg ?? null, matricule: c.matricule ?? null, nom: c.nom ?? null } : null;
}

/**
 * LE RESPONSABLE à qui un rejet renvoie le conflit : l'auteur de la dernière
 * soumission (CMD CIE ou CMD Région).
 */
export function responsableDe(conf) {
  if (conf?.assignation?.responsable) return conf.assignation.responsable;
  const auteur = conf?.traitement?.auteur ?? conf?.traitePar ?? null;
  if (auteur?.rang === 'cie' || auteur?.rang === 'reg') return { rang: auteur.rang, unite: auteur.unite, matricule: auteur.matricule ?? null };
  const cie = cieAssignee(conf);
  if (cie) return { rang: 'cie', unite: cie.unite, matricule: cie.matricule ?? null };
  const r = regionsAssignees(conf)[0];
  return r ? { rang: 'reg', unite: r.unite, matricule: r.matricule ?? null } : null;
}

const estSaRegion = (conf, session) =>
  session?.rang === 'reg' && regionsAssignees(conf).some((r) => meme(r.unite, session.unite) || (r.matricule && r.matricule === session.matricule));

const estSaCompagnie = (conf, session) => {
  if (session?.rang !== 'cie') return false;
  const c = cieAssignee(conf);
  if (!c) return false;
  if (c.matricule && c.matricule === session.matricule) return true;
  /* Même nom de compagnie ET même région (deux régions peuvent avoir une
     compagnie du même nom). */
  return meme(c.unite, session.unite) && (!c.reg || !session.reg || meme(c.reg, session.reg));
};

/**
 * PEUT-IL VOIR CE CONFLIT ? — le cloisonnement, appliqué par le serveur à
 * chaque lecture et à chaque action.
 */
export function peutVoir(conf, session) {
  if (!session || !conf) return false;
  if (session.rang === 'admin') return true;
  const etat = etatDe(conf);
  if (etat === ETATS.NEW) return false;
  if (session.rang === 'reg') return estSaRegion(conf, session);
  if (session.rang === 'cie') return estSaCompagnie(conf, session);
  return false;
}

/* ------------------------------------------------------------------ */
/* Transitions                                                        */
/* ------------------------------------------------------------------ */

const EN_TRAITEMENT = [ETATS.ASSIGNED_REGION, ETATS.IN_PROGRESS_REGION, ETATS.ASSIGNED_CIE, ETATS.IN_PROGRESS_CIE, ETATS.REJECTED];

/** Le rejet renvoie-t-il le conflit à ce rang ? */
const rejetPour = (conf, rang) => etatDe(conf) === ETATS.REJECTED && responsableDe(conf)?.rang === rang;

/**
 * LA TABLE DES ACTIONS. Pour chacune : qui, depuis quels états, vers quel
 * état. `etapes` : les états traversés en chemin (inscrits à l'historique).
 */
const ACTIONS = {
  /* Super Admin → CMD Région (ou réassignation à une autre région). */
  assigner_region: {
    roles: ['admin'],
    depuis: [ETATS.NEW, ...EN_TRAITEMENT],
    vers: () => ETATS.ASSIGNED_REGION,
    libelle: 'Assignation au CMD Région',
  },
  /* Super Admin : retour dans « Les Conflits ». */
  desassigner: {
    roles: ['admin'],
    depuis: EN_TRAITEMENT,
    vers: () => ETATS.NEW,
    libelle: 'Désassignation',
  },
  /* CMD Région, option A : il traite lui-même. */
  prendre_en_charge: {
    roles: ['reg'],
    depuis: [ETATS.ASSIGNED_REGION, ETATS.REJECTED],
    garde: (conf) => etatDe(conf) !== ETATS.REJECTED || rejetPour(conf, 'reg'),
    vers: () => ETATS.IN_PROGRESS_REGION,
    libelle: 'Prise en charge par le CMD Région',
  },
  /* CMD Région, option B : il délègue à un CMD CIE de sa région. */
  assigner_cie: {
    roles: ['reg'],
    depuis: [ETATS.ASSIGNED_REGION, ETATS.IN_PROGRESS_REGION, ETATS.ASSIGNED_CIE, ETATS.IN_PROGRESS_CIE, ETATS.REJECTED],
    vers: () => ETATS.ASSIGNED_CIE,
    libelle: 'Assignation au CMD CIE',
  },
  /* CMD CIE : il commence (ou reprend après rejet). */
  commencer: {
    roles: ['cie'],
    depuis: [ETATS.ASSIGNED_CIE, ETATS.REJECTED],
    garde: (conf) => etatDe(conf) !== ETATS.REJECTED || rejetPour(conf, 'cie'),
    vers: () => ETATS.IN_PROGRESS_CIE,
    libelle: 'Début du traitement par le CMD CIE',
  },
  /* Le responsable soumet son traitement. Le Super Admin peut traiter
     directement (fonction existante) : son traitement vaut validation, et
     comme toute validation il archive le conflit. */
  soumettre: {
    roles: ['reg', 'cie', 'admin'],
    depuis: [ETATS.NEW, ...EN_TRAITEMENT],
    garde: (conf, session) => {
      const etat = etatDe(conf);
      if (session.rang === 'admin') return true;
      if (session.rang === 'reg') return [ETATS.ASSIGNED_REGION, ETATS.IN_PROGRESS_REGION].includes(etat) || rejetPour(conf, 'reg');
      return [ETATS.ASSIGNED_CIE, ETATS.IN_PROGRESS_CIE].includes(etat) || rejetPour(conf, 'cie');
    },
    vers: (conf, session) => (session.rang === 'admin' ? ETATS.CLOSED : ETATS.PENDING_VALIDATION),
    etapes: (conf, session) => {
      const etat = etatDe(conf);
      if (session.rang === 'admin') return [ETATS.APPROVED];
      if (session.rang === 'reg' && etat !== ETATS.IN_PROGRESS_REGION) return [ETATS.IN_PROGRESS_REGION];
      if (session.rang === 'cie' && etat !== ETATS.IN_PROGRESS_CIE) return [ETATS.IN_PROGRESS_CIE];
      return [];
    },
    libelle: 'Soumission du traitement pour validation',
  },
  /* Approuver = archiver : le conflit passe directement à l'historique. */
  valider: {
    roles: ['admin'],
    depuis: [ETATS.PENDING_VALIDATION],
    vers: () => ETATS.CLOSED,
    etapes: () => [ETATS.APPROVED],
    libelle: 'Validation du traitement',
  },
  rejeter: {
    roles: ['admin'],
    depuis: [ETATS.PENDING_VALIDATION],
    vers: () => ETATS.REJECTED,
    motifObligatoire: true,
    libelle: 'Rejet du traitement',
  },
  /* Ne sert plus qu'aux conflits validés avant que l'approbation archive. */
  cloturer: {
    roles: ['admin'],
    depuis: [ETATS.APPROVED, ETATS.FOLLOW_UP],
    vers: () => ETATS.CLOSED,
    libelle: 'Clôture',
  },
  /* Tout ce qui est à l'historique peut être rouvert (correction exceptionnelle). */
  rouvrir: {
    roles: ['admin'],
    depuis: ARCHIVES,
    vers: (conf) => (regionsAssignees(conf).length ? ETATS.ASSIGNED_REGION : ETATS.NEW),
    motifObligatoire: true,
    libelle: 'Réouverture',
  },
};

export const NOMS_ACTIONS = Object.freeze(Object.keys(ACTIONS));
export const libelleAction = (action) => ACTIONS[action]?.libelle ?? action;

/**
 * L'ACTION EST-ELLE PERMISE ? Rôle, état actuel, périmètre, motif.
 *
 * @param {string|null} etatAttendu  l'état que l'écran affichait : s'il a
 *   changé entre-temps (autre utilisateur, double clic), l'action est refusée
 *   au lieu de s'appliquer à un état que l'utilisateur n'a pas vu.
 * @returns {{ de: string, vers: string, etapes: string[] }}
 * @throws {ErreurWorkflow} 401 / 403 / 404 / 409 / 422
 */
export function verifierAction(conf, session, action, { motif = '', etatAttendu = null } = {}) {
  if (!session) throw new ErreurWorkflow(401, 'Authentification requise.');
  const def = ACTIONS[action];
  if (!def) throw new ErreurWorkflow(422, `Action inconnue : « ${action} ».`);
  if (!conf) throw new ErreurWorkflow(404, 'Conflit introuvable.');
  if (!def.roles.includes(session.rang)) {
    throw new ErreurWorkflow(403, `Action « ${def.libelle} » non autorisée pour votre rôle.`);
  }
  /* Le périmètre AVANT l'état : on ne révèle rien d'un conflit hors périmètre. */
  if (!peutVoir(conf, session)) throw new ErreurWorkflow(403, 'Ce conflit ne relève pas de votre périmètre.');
  const de = etatDe(conf);
  if (etatAttendu && etatAttendu !== de) {
    throw new ErreurWorkflow(409, `Ce conflit a changé d'état entre-temps (${LIBELLES[de].toLowerCase()}). Rechargez la liste.`);
  }
  if (!def.depuis.includes(de) || (def.garde && !def.garde(conf, session))) {
    throw new ErreurWorkflow(409, `« ${def.libelle} » impossible : le conflit est ${LIBELLES[de].toLowerCase()}.`);
  }
  if (def.motifObligatoire && !String(motif ?? '').trim()) {
    throw new ErreurWorkflow(422, 'Le motif est obligatoire.');
  }
  return { de, vers: def.vers(conf, session), etapes: def.etapes ? def.etapes(conf, session) : [] };
}

const permis = (conf, session, action) => {
  try {
    verifierAction(conf, session, action, { motif: 'x' });
    return true;
  } catch {
    return false;
  }
};

/**
 * CE QUE L'INTERFACE DOIT SAVOIR D'UN CONFLIT, POUR CETTE SESSION : son état,
 * sa section, les actions permises. Le serveur l'attache à chaque conflit
 * renvoyé.
 */
export function presenterWorkflow(conf, session) {
  const etat = etatDe(conf);
  const actions = {};
  for (const a of NOMS_ACTIONS) actions[a] = permis(conf, session, a);
  actions.supprimer = peutSupprimer(conf, session);
  const dernierRejet = [...(conf?.historique ?? [])].reverse().find((h) => h.action === 'rejeter' || h.action === 'refus_superadmin' || h.action === 'refus_region');
  return {
    etat,
    libelle: LIBELLES[etat],
    section: SECTION_DE[etat],
    actions,
    regions: regionsAssignees(conf).map((r) => r.unite),
    compagnie: cieAssignee(conf)?.unite ?? null,
    responsable: responsableDe(conf),
    motifRejet: etat === ETATS.REJECTED ? (dernierRejet?.motif ?? conf?.approbation?.raison ?? null) : null,
  };
}

/** Compteurs par section, sur les conflits VISIBLES de la session. */
export function compterSections(conflits, session) {
  const c = { conflits: 0, a_traiter: 0, a_valider: 0, historique: 0 };
  for (const conf of conflits) if (!conf.is_deleted && !conf.deleted && peutVoir(conf, session)) c[sectionDe(conf)]++;
  return c;
}

/* ------------------------------------------------------------------ */
/* Champs hérités                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tient à jour les anciens champs à partir de l'état et de l'assignation
 * (lecture seule pour les autres modules) : `statut`, `approbation.statut`,
 * `assigneA`, `assignesA`, `assigneCie`.
 */
export function synchroniserChampsHerites(conf) {
  const etat = etatDe(conf);
  conf.statut = STATUT_HERITE[etat];
  const app = APPROBATION_HERITEE[etat];
  if (app) conf.approbation = { ...(conf.approbation ?? {}), statut: app };
  else if (conf.approbation) delete conf.approbation;
  const regions = regionsAssignees(conf);
  const cie = cieAssignee(conf);
  if (regions.length && etat !== ETATS.NEW) {
    conf.assignesA = regions.map((r) => ({ matricule: r.matricule, nom: r.nom, rang: 'reg', unite: r.unite, region: r.unite }));
    conf.assigneA = conf.assignesA.length === 1 ? conf.assignesA[0] : {
      matricule: regions.map((r) => r.matricule).join(','),
      nom: regions.map((r) => r.nom).join(' & '),
      rang: 'reg',
      unite: regions.map((r) => r.unite).join(' & '),
    };
  } else {
    delete conf.assignesA;
    delete conf.assigneA;
  }
  if (cie && etat !== ETATS.NEW) conf.assigneCie = { matricule: cie.matricule, nom: cie.nom, rang: 'cie', unite: cie.unite, reg: cie.reg ?? null };
  else delete conf.assigneCie;
  return conf;
}

/* ------------------------------------------------------------------ */
/* Migration                                                          */
/* ------------------------------------------------------------------ */

/**
 * CONVERSION D'UN CONFLIT EXISTANT au modèle à états — RÉVERSIBLE : les
 * anciens champs sont conservés tels quels dans `migrationEtats.avant`.
 * Idempotente (un conflit déjà converti n'est pas touché).
 *
 * @returns {{ conflit: object, change: boolean, etat: string }}
 */
export function migrerConflit(original) {
  const c = structuredClone(original);
  if (ETATS[c.etat]) return { conflit: c, change: false, etat: c.etat };
  const etat = etatDe(c);
  c.migrationEtats = {
    le: new Date().toISOString(),
    avant: {
      statut: original.statut ?? null,
      approbation: original.approbation ?? null,
      assigneA: original.assigneA ?? null,
      assignesA: original.assignesA ?? null,
      assigneCie: original.assigneCie ?? null,
    },
  };
  c.etat = etat;
  c.assignation = {
    regions: etat === ETATS.NEW ? [] : regionsAssignees(original),
    cie: etat === ETATS.NEW ? null : cieAssignee(original),
    responsable: [ETATS.REJECTED, ETATS.PENDING_VALIDATION].includes(etat) ? responsableDe(original) : null,
    assignePar: null,
    assigneLe: original.assigneLe ?? null,
  };
  return { conflit: c, change: true, etat };
}

/** Annule la conversion (restaure les anciens champs). */
export function annulerMigration(conf) {
  const c = structuredClone(conf);
  const avant = c.migrationEtats?.avant;
  if (!avant) return { conflit: c, change: false };
  for (const k of ['statut', 'approbation', 'assigneA', 'assignesA', 'assigneCie']) {
    if (avant[k] == null) delete c[k];
    else c[k] = avant[k];
  }
  delete c.etat;
  delete c.assignation;
  delete c.migrationEtats;
  return { conflit: c, change: true };
}
