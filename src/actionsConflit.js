/**
 * CE QU'UN CONFLIT PROPOSE À CELUI QUI LE REGARDE — une action principale au
 * plus, quelques actions secondaires, une phrase d'état.
 *
 * Tout vient des droits que le serveur attache à chaque conflit
 * (`workflow.actions`, voir serveur/workflowConflits.mjs) : rien n'est proposé
 * que le serveur refuserait. Le rôle ne sert qu'à CHOISIR, parmi les actions
 * permises, celle qui passe devant :
 *
 *   Super Admin  « Assigner » un conflit nouveau ; une fois assigné, il voit
 *                à qui (« Assigné à … ») et peut « Réassigner » ; « Approuver »
 *                un traitement soumis. Jamais « Traiter » en action principale
 *                — son traitement direct reste dans les détails.
 *   CMD Région   « Traiter » (prise en charge comprise) ou « Transmettre à une
 *                CIE » ; « Réassigner la CIE » une fois transmis.
 *   CMD CIE      « Traiter » ce qui lui est assigné, « Corriger » un rejet.
 *
 * Pur, sans React : `npm run check:actions-conflit`.
 */

const EN_TRAITEMENT = new Set(['ASSIGNED_REGION', 'IN_PROGRESS_REGION', 'ASSIGNED_CIE', 'IN_PROGRESS_CIE', 'REJECTED']);
const ARCHIVES = new Set(['APPROVED', 'FOLLOW_UP', 'CLOSED']);

/** « CMD CIE X », « CMD Région A & B », ou null s'il n'est assigné à personne. */
export function libelleAssignation(conf) {
  const w = conf?.workflow;
  const cie = w?.compagnie ?? conf?.assigneCie?.unite ?? null;
  if (cie) return `CMD CIE ${cie}`;
  const regions = w?.regions?.length ? w.regions : conf?.assigneA?.unite ? [conf.assigneA.unite] : [];
  return regions.length ? `CMD Région ${regions.join(' & ')}` : null;
}

/**
 * Le statut en un mot, lu de l'état réel du workflow.
 * @returns {{ code: string, label: string }}
 */
export function statutConflit(conf) {
  const etat = conf?.workflow?.etat ?? null;
  if (ARCHIVES.has(etat) || conf?.statut === 'cloture') return { code: 'archive', label: 'Approuvé' };
  if (etat === 'PENDING_VALIDATION') return { code: 'a_valider', label: 'À valider' };
  if (etat === 'REJECTED') return { code: 'a_corriger', label: 'À corriger' };
  if (etat === 'IN_PROGRESS_REGION' || etat === 'IN_PROGRESS_CIE') return { code: 'en_cours', label: 'En cours' };
  if (etat === 'ASSIGNED_REGION' || etat === 'ASSIGNED_CIE') return { code: 'assigne', label: 'Assigné' };
  return { code: 'a_traiter', label: 'À traiter' };
}

/**
 * @returns {{
 *   principale: { cle: string, libelle: string } | null,
 *   secondaires: { cle: string, libelle: string }[],
 *   info: string | null,
 *   ton: 'neutre' | 'succes' | 'attente' | 'alerte',
 * }}
 *
 * Clés : assigner, reassigner, desassigner, transmettre, traiter, approuver,
 * rejeter, traiter_direct.
 */
export function actionsConflit(conf, session) {
  const rang = session?.rang;
  const w = conf?.workflow ?? null;
  const a = w?.actions ?? {};
  const etat = w?.etat ?? null;
  const assigne = libelleAssignation(conf);
  const r = { principale: null, secondaires: [], info: null, ton: 'neutre' };

  if (etat && ARCHIVES.has(etat)) {
    r.info = 'Approuvé — conservé dans l’historique';
    r.ton = 'succes';
    return r;
  }

  if (rang === 'admin') {
    /* Calculé mais pas encore enregistré : l'assignation l'enregistre. */
    if (!w && (conf?.dejaAssigne || conf?.dejaTraite)) {
      /* Calculé, mais sa paire est déjà entre les mains d'un commandement, ou
         déjà traitée : aucune nouvelle assignation. */
      r.info = conf.dejaTraite ? 'Déjà traité et approuvé — voir l’Historique' : `Assigné à ${conf.dejaAssigne} — en attente de traitement`;
      r.ton = 'succes';
      return r;
    }
    if (!w) {
      r.principale = { cle: 'assigner', libelle: 'Assigner' };
      r.secondaires.push({ cle: 'traiter_direct', libelle: 'Traiter moi-même' });
      return r;
    }
    if (etat === 'PENDING_VALIDATION') {
      if (a.valider) r.principale = { cle: 'approuver', libelle: 'Approuver' };
      if (a.rejeter) r.secondaires.push({ cle: 'rejeter', libelle: 'Rejeter' });
      r.info = assigne ? `Traitement soumis par ${assigne}` : 'Traitement soumis';
      r.ton = 'attente';
      return r;
    }
    if (EN_TRAITEMENT.has(etat)) {
      r.info = etat === 'REJECTED'
        ? `Renvoyé pour correction${assigne ? ` à ${assigne}` : ''}`
        : `Assigné à ${assigne ?? 'un responsable'}`;
      r.ton = etat === 'REJECTED' ? 'alerte' : 'succes';
      if (a.assigner_region) r.secondaires.push({ cle: 'reassigner', libelle: 'Réassigner' });
      if (a.desassigner) r.secondaires.push({ cle: 'desassigner', libelle: 'Désassigner' });
      if (a.soumettre) r.secondaires.push({ cle: 'traiter_direct', libelle: 'Traiter moi-même' });
      return r;
    }
    if (a.assigner_region) r.principale = { cle: 'assigner', libelle: 'Assigner' };
    if (a.soumettre) r.secondaires.push({ cle: 'traiter_direct', libelle: 'Traiter moi-même' });
    return r;
  }

  if (rang === 'reg' || rang === 'cie') {
    const peutTraiter = Boolean(a.soumettre || a.prendre_en_charge || a.commencer);
    if (peutTraiter) r.principale = { cle: 'traiter', libelle: etat === 'REJECTED' ? 'Corriger' : 'Traiter' };
    if (rang === 'reg' && a.assigner_cie) {
      const dejaTransmis = etat === 'ASSIGNED_CIE' || etat === 'IN_PROGRESS_CIE';
      r.secondaires.push({ cle: 'transmettre', libelle: dejaTransmis ? 'Réassigner la CIE' : 'Transmettre à une CIE' });
      if (dejaTransmis && w?.compagnie) {
        r.info = `Transmis à CMD CIE ${w.compagnie}`;
        r.ton = 'succes';
      }
    }
    if (etat === 'PENDING_VALIDATION') {
      r.info = 'En attente de validation du Super Admin';
      r.ton = 'attente';
    } else if (etat === 'REJECTED' && w?.motifRejet) {
      r.info = `Rejeté : ${w.motifRejet}`;
      r.ton = 'alerte';
    }
    return r;
  }

  return r;
}

const normU = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const A_TRAITER_REGION = new Set(['ASSIGNED_REGION', 'IN_PROGRESS_REGION']);
const A_TRAITER_CIE = new Set(['ASSIGNED_CIE', 'IN_PROGRESS_CIE']);

/**
 * CE CONFLIT EST-IL À TRAITER PAR CE COMPTE ? — remis à SA région (CMD
 * Région) ou à SA compagnie (CMD CIE), et pas encore traité. Ne comptent pas :
 * un traitement soumis (à valider), rejeté, clos, ni un conflit transmis à une
 * CIE (c'est alors à elle de le traiter).
 */
export function aTraiterPar(conf, session) {
  const w = conf?.workflow;
  const etat = w?.etat ?? conf?.etat ?? null;
  if (!session || !etat) return false;
  if (session.rang === 'reg') {
    return A_TRAITER_REGION.has(etat) && (w?.regions ?? []).some((r) => normU(r) === normU(session.unite));
  }
  if (session.rang === 'cie') {
    return A_TRAITER_CIE.has(etat) && normU(w?.compagnie) === normU(session.unite);
  }
  return false;
}

/** Le nombre de conflits à traiter par ce compte — chaque conflit compté une fois. */
export function compterATraiter(conflits, session) {
  const vus = new Set();
  for (const c of conflits ?? []) {
    const cle = c?.id ?? c?.paireCle;
    if (cle && !vus.has(cle) && aTraiterPar(c, session)) vus.add(cle);
  }
  return vus.size;
}

/** « Super Admin », ou le nom de qui a fait l'assignation. */
export const auteurAssignation = (conf) => {
  const p = conf?.assignation?.assignePar;
  if (!p) return null;
  return p.nom || (p.rang === 'admin' ? 'Super Admin' : p.matricule) || null;
};

/** Assigné et pas encore traité : remis à un commandement, jusqu'à l'archive. */
const ASSIGNE_NON_TRAITE = new Set([...EN_TRAITEMENT, 'PENDING_VALIDATION']);

const cleDePaire = (a, b) => [String(a), String(b)].sort().join('|');

/**
 * LES CONFLITS D'UNE OPTIMISATION, RAPPROCHÉS DES CONFLITS ENREGISTRÉS.
 *
 * Une optimisation renumérote tout (C-01, C-02…) : le numéro ne dit pas si le
 * conflit est déjà connu. Sa PAIRE de barrages, si — la même clé, quel que
 * soit l'ordre A/B, que le serveur (`cleDePaire`, serveur/suiviConflits.mjs).
 * Un conflit calculé dont la paire porte un conflit enregistré, assigné et pas
 * encore traité, reçoit :
 *   dejaAssigne        « CMD Région Rabat », « CMD CIE X »… (libelleAssignation)
 *   conflitEnregistre  { id, etat } — le conflit du serveur, son historique
 * et garde le reste du calcul (distance, tracé). Un conflit archivé (traité)
 * ne compte plus : la même paire détectée ensuite est un conflit nouveau.
 *
 * Rend le tableau d'origine quand rien ne correspond.
 *
 * @param {object[]|null} calcules    conflitsIdentifies (champ `cle` = paire)
 * @param {object[]} enregistres      GET /api/conflits (`paireCle`, `workflow`)
 * @param {object} [session]          le compte qui regarde : s'il est le
 *                                    destinataire, `aTraiterParMoi` au lieu de `dejaAssigne`
 * @param {object[]} [clos]           GET /api/conflits → `clos` ({ id, paireCle }) :
 *                                    une paire traitée et approuvée, sans conflit
 *                                    actif, arrive `dejaTraite` — pas de nouvelle assignation
 */
export function rapprocherConflitsEnregistres(calcules, enregistres, session = null, clos = []) {
  if (!Array.isArray(calcules) || !calcules.length || (!enregistres?.length && !clos?.length)) return calcules;
  const parPaire = new Map();
  for (const e of enregistres ?? []) {
    const cle = e?.paireCle || (e?.barrageAId && e?.barrageBId ? cleDePaire(e.barrageAId, e.barrageBId) : null);
    if (cle && ASSIGNE_NON_TRAITE.has(e.workflow?.etat)) parPaire.set(cle, e);
  }
  /* Paires dont le conflit est traité et approuvé (Historique) — sans conflit actif. */
  const actives = new Set((enregistres ?? []).map((e) => e?.paireCle).filter(Boolean));
  const archivees = new Map();
  for (const x of clos ?? []) if (x?.paireCle && !actives.has(x.paireCle)) archivees.set(x.paireCle, x);
  if (!parPaire.size && !archivees.size) return calcules;
  let change = false;
  const out = calcules.map((c) => {
    const cle = c?.cle || c?.paireCle || (c?.a?.id && c?.b?.id ? cleDePaire(c.a.id, c.b.id) : c?.barrageAId && c?.barrageBId ? cleDePaire(c.barrageAId, c.barrageBId) : null);
    const e = cle ? parPaire.get(cle) : null;
    if (!e) {
      const a = cle ? archivees.get(cle) : null;
      if (!a) return c;
      change = true;
      return { ...c, dejaTraite: true, conflitEnregistre: { id: a.id, numero: a.numero ?? null, etat: 'archive' } };
    }
    change = true;
    /* Chez le commandement destinataire, le conflit est à traiter : il n'est
       « déjà assigné » que pour qui voudrait l'assigner de nouveau. */
    if (aTraiterPar(e, session)) {
      return { ...c, aTraiterParMoi: true, conflitEnregistre: { id: e.id, numero: e.numero ?? null, etat: e.workflow.etat } };
    }
    return {
      ...c,
      dejaAssigne: libelleAssignation(e) ?? 'un commandement',
      conflitEnregistre: { id: e.id, numero: e.numero ?? null, etat: e.workflow.etat },
      assigneLe: c.assigneLe ?? e.assignation?.assigneLe ?? e.assigneLe ?? null,
    };
  });
  return change ? out : calcules;
}

/**
 * L'ÉTAT D'UN CONFLIT DANS LA LISTE DÉROULANTE — un mot (pastille) et, s'il
 * est remis à quelqu'un, la ligne d'assignation :
 *
 *   À assigner                 détecté, remis à personne ;
 *   Assigné                    remis à un CMD Région (ou à une CIE)…
 *     « Assigné à CMD Région X · En attente de traitement »  …pas encore traité ;
 *   En cours / À valider / À corriger / Approuvé   les états du workflow.
 *
 * Chez le commandement DESTINATAIRE (`session`), un conflit qui lui est remis
 * est « À traiter » (« Assigné par Super Admin »). Chez le Super Admin, son
 * état réel : « Assigné à CMD Région X » — et plus de bouton « Assigner ».
 *
 * @returns {{ code: string, libelle: string, assignation: string | null }}
 */
export function etatListeConflit(conf, session = null) {
  const etat = conf?.workflow?.etat ?? null;
  const qui = libelleAssignation(conf);
  /* Chez le destinataire : une tâche, avec qui la lui a confiée. */
  if (aTraiterPar(conf, session) || conf?.aTraiterParMoi) {
    const par = auteurAssignation(conf);
    const enCours = etat === 'IN_PROGRESS_REGION' || etat === 'IN_PROGRESS_CIE';
    return {
      code: enCours ? 'en_cours' : 'a_traiter',
      libelle: enCours ? 'En cours' : 'À traiter',
      assignation: par ? `Assigné par ${par}` : 'Assigné à votre commandement',
    };
  }
  /* Le CMD Région qui l'a transmis à une CIE : c'est à elle de le traiter. */
  if (session?.rang === 'reg' && (etat === 'ASSIGNED_CIE' || etat === 'IN_PROGRESS_CIE')) {
    return { code: 'assigne', libelle: 'Transmis', assignation: `${qui ?? 'CMD CIE'} · En attente de traitement` };
  }
  if (ARCHIVES.has(etat) || conf?.statut === 'cloture') return { code: 'archive', libelle: 'Approuvé', assignation: qui };
  if (etat === 'PENDING_VALIDATION') return { code: 'a_valider', libelle: 'À valider', assignation: qui ? `${qui} · traitement soumis` : null };
  if (etat === 'REJECTED') return { code: 'a_corriger', libelle: 'À corriger', assignation: qui };
  if (etat === 'IN_PROGRESS_REGION' || etat === 'IN_PROGRESS_CIE') return { code: 'en_cours', libelle: 'En cours', assignation: qui ? `${qui} · traitement en cours` : null };
  if (etat === 'ASSIGNED_REGION' || etat === 'ASSIGNED_CIE') {
    return { code: 'assigne', libelle: 'Assigné', assignation: `Assigné à ${qui ?? 'un commandement'} · En attente de traitement` };
  }
  if (conf?.dejaAssigne) return { code: 'assigne', libelle: 'Assigné', assignation: `Assigné à ${conf.dejaAssigne} · En attente de traitement` };
  if (conf?.dejaTraite) return { code: 'archive', libelle: 'Déjà traité', assignation: 'Traité et approuvé — voir l’Historique' };
  return { code: 'a_assigner', libelle: 'À assigner', assignation: null };
}

/** Le geste « assigner » de ce rôle : Super Admin → CMD Région ; CMD Région → CIE. */
export const cleAssignation = (session) => (session?.rang === 'admin' ? 'assigner' : session?.rang === 'reg' ? 'transmettre' : null);

/** Ce conflit attend-il encore l'assignation de CE compte ? (droits du serveur, voir actionsConflit) */
export function aAssignerPar(conf, session) {
  const cle = cleAssignation(session);
  if (!cle || conf?.dejaAssigne || conf?.dejaTraite) return false;
  if (cle === 'transmettre' && conf?.workflow?.compagnie) return false;
  const a = actionsConflit(conf, session);
  return [a.principale, ...a.secondaires].some((x) => x?.cle === cle);
}

const regionsDuConflit = (c) => [c?.a ?? c?.barrageA, c?.b ?? c?.barrageB].map((b) => b?.reg).filter(Boolean);
const memeConflit = (c, ids, paires) =>
  ids.has(String(c?.id ?? '')) || ids.has(String(c?.numero ?? '')) || (c?.paireCle && paires.has(c.paireCle));

/**
 * LE PROCHAIN CONFLIT À ASSIGNER, après celui qu'on vient d'assigner — dans
 * l'ordre de la liste, en repartant du début une fois la fin atteinte.
 *
 * Retenu : un conflit que CE compte peut encore assigner (`aAssignerPar` : un
 * conflit déjà assigné par un autre traitement est sauté) et qui relève de la
 * même région (`regions` : celles de l'assignation qui vient d'être faite ;
 * vide = toutes). Le conflit qui vient d'être assigné ne l'est jamais.
 *
 * @param {object[]} liste
 * @param {{ ids?: string[], paires?: string[], regions?: string[] }} faite
 * @returns {object | null}
 */
export function prochainConflitAAssigner(liste, faite, session) {
  if (!Array.isArray(liste) || !liste.length) return null;
  const ids = new Set((faite?.ids ?? []).filter(Boolean).map(String));
  const paires = new Set((faite?.paires ?? []).filter(Boolean));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const regions = new Set((faite?.regions ?? []).filter(Boolean).map(norm));
  const depart = liste.findIndex((c) => memeConflit(c, ids, paires));
  for (let k = 1; k <= liste.length; k++) {
    const c = liste[(Math.max(depart, -1) + k + liste.length) % liste.length];
    if (memeConflit(c, ids, paires)) continue;
    if (!aAssignerPar(c, session)) continue;
    if (regions.size && !regionsDuConflit(c).some((r) => regions.has(norm(r)))) continue;
    return c;
  }
  return null;
}
