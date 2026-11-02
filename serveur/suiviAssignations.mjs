/**
 * SUIVI DES ASSIGNATIONS — où en est chaque barrage confié par le Super Admin.
 *
 *   Assigner au CMND Région → Traiter → Déplacer OU Changer la faction → Terminé
 *
 * RIEN N'EST DÉCLARÉ, TOUT EST LU. Le statut d'une chaîne d'assignation se
 * déduit de ce qui est réellement en base :
 *
 *   — les maillons de la chaîne (`instructions.json`, `action: 'assignation'`,
 *     reliés par `parentId` : Région → Cie) et leur statut ;
 *   — les demandes encore en attente sur le barrage (une modification ou un
 *     retrait que l'administration n'a pas tranché, une demande d'approbation
 *     de faction que la région n'a pas approuvée) ;
 *   — les opérations du journal (`journal.jsonl`) sur ce barrage depuis
 *     l'assignation.
 *
 * D'où trois états, et une règle qui ne se discute pas : « Terminé » n'est
 * affiché qu'une fois la chaîne close ET aucune demande en attente. Un
 * déplacement soumis à validation n'est pas un déplacement : tant que
 * l'administration ne l'a pas accepté, le barrage n'a pas bougé, et le
 * traitement est « En cours ».
 *
 *   en_attente  la chaîne est ouverte et rien n'a encore été fait ;
 *   en_cours    quelque chose a été fait (transmis, demandé, modifié) mais la
 *               chaîne est encore ouverte, ou une demande attend validation ;
 *   termine     tous les maillons sont clos et plus rien n'attend.
 *
 * Fonctions pures : elles reçoivent les données, n'écrivent rien — c'est ce
 * qui les rend vérifiables sans service (scripts/verifier-notifications.mjs).
 */

/** Ce que chaque ligne du journal raconte, dans l'historique d'un barrage assigné. */
const LIBELLES = {
  assignation_traitee: 'Traitement clôturé',
  changement_faction: 'Faction changée',
  deplacer: 'Barrage déplacé',
  deplacement_optimisation: 'Barrage déplacé (optimisation)',
  supprimer: 'Barrage retiré',
  'demander-modification': 'Modification demandée — en attente de validation',
  'demander-suppression': 'Retrait demandé — en attente de validation',
  'soumettre-demande-approbation': 'Proposition de faction soumise au CMND Région',
  'creer-demande-approbation': 'Demande d’approbation soumise',
  'application-demande-approuvee': 'Changement approuvé appliqué',
  'workflow-demande-approuver': 'Demande approuvée',
  'workflow-demande-rejeter': 'Demande rejetée',
  'workflow-demande-retourner': 'Demande retournée au CMND Cie',
  'workflow-demande-retourner_region': 'Demande renvoyée au CMND Région',
  'workflow-demande-transmettre_admin': 'Demande transmise au Super Admin',
  'workflow-demande-modifier': 'Proposition modifiée par la région',
  'workflow-demande-resoumettre': 'Demande soumise de nouveau',
};

/** Les opérations qui ÉCRIVENT réellement le barrage — par opposition aux demandes. */
const EFFECTIVES = new Set([
  'changement_faction', 'deplacer', 'deplacement_optimisation', 'supprimer', 'application-demande-approuvee',
]);

export const ACTIONS_SUIVIES = new Set([
  'assignation', 'modifier', 'decision-demande', ...Object.keys(LIBELLES),
]);

const bouge = (e) => Boolean(e.change?.lng || e.change?.lat);

/** Le libellé d'une ligne du journal, ou `null` si elle n'a pas sa place dans l'historique. */
export function libelleOperation(e) {
  if (e.action === 'assignation') {
    return e.details?.cie ? `Transmis au CMND Cie ${e.details.cie}` : `Assigné au CMND Région ${e.details?.region ?? ''}`.trim();
  }
  if (e.action === 'modifier') {
    if (!e.change) return null;
    if (bouge(e)) return 'Barrage déplacé';
    if (e.change.factionId) return 'Faction changée';
    return 'Fiche modifiée';
  }
  if (e.action === 'decision-demande') {
    return `${e.details?.decision === 'acceptee' ? 'Acceptée' : 'Refusée'} par l’administration : ${e.details?.objet ?? 'demande'}`;
  }
  return LIBELLES[e.action] ?? null;
}

const estEffective = (e) => EFFECTIVES.has(e.action) || (e.action === 'modifier' && Boolean(e.change));

/**
 * LE SUIVI D'UNE CHAÎNE — à partir de son maillon racine (l'assignation du
 * Super Admin au CMND Région).
 *
 * @param racine        l'assignation d'origine
 * @param instructions  toutes les instructions (pour retrouver la suite)
 * @param operations    lignes du journal sur ce barrage, de la plus ancienne à la plus récente
 * @param demandesEnAttente  nombre de demandes non tranchées sur ce barrage depuis l'assignation
 * @param barrage       l'état actuel du barrage, ou `null` s'il a disparu
 * @param jusqua        date de l'assignation SUIVANTE du même barrage : ses opérations ne sont pas les nôtres
 */
export function suivreChaine({ racine, instructions, operations, demandesEnAttente = 0, barrage = null, jusqua = null }) {
  const chaine = [racine];
  for (let i = 0; i < chaine.length; i++) {
    for (const x of instructions) if (x.parentId === chaine[i].id && x.action === 'assignation') chaine.push(x);
  }
  const ouverte = chaine.some((x) => x.statut === 'ouverte');
  const depuis = Date.parse(racine.cree);
  const fin = jusqua ? Date.parse(jusqua) : Infinity;
  const ops = operations
    .filter((e) => Date.parse(e.ts) >= depuis - 1000 && Date.parse(e.ts) < fin - 1000)
    .map((e) => ({ e, libelle: libelleOperation(e) }))
    .filter((x) => x.libelle);
  /* La ligne qui consigne l'assignation d'origine n'est pas « quelque chose de fait ». */
  const faites = ops.filter((x) => !(x.e.action === 'assignation' && !x.e.details?.cie));
  const effectives = faites.filter((x) => estEffective(x.e));

  let statut;
  if (!ouverte && demandesEnAttente === 0) statut = 'termine';
  else if (faites.length || chaine.length > 1 || demandesEnAttente > 0) statut = 'en_cours';
  else statut = 'en_attente';

  /* Qui tient le barrage maintenant : le dernier maillon ouvert, sinon le dernier de la chaîne. */
  const porteur = [...chaine].reverse().find((x) => x.statut === 'ouverte') ?? chaine[chaine.length - 1];
  /* La clôture d'une assignation suit de quelques millisecondes l'opération
     qui la motive : c'est l'opération qu'on veut lire comme « dernière action ». */
  const finale = ops[ops.length - 1] ?? null;
  const effectiveFinale = [...ops].reverse().find((x) => estEffective(x.e));
  const derniere = finale && effectiveFinale && Date.parse(finale.e.ts) - Date.parse(effectiveFinale.e.ts) <= 2000
    ? effectiveFinale
    : finale;
  const dates = [racine.cree, ...chaine.map((x) => x.traiteeLe), ...ops.map((x) => x.e.ts)].filter(Boolean).sort();

  return {
    id: racine.id,
    barrageId: racine.barrageId,
    barrage: barrage
      ? {
          id: barrage.id, nom: barrage.nom || barrage.id, route: barrage.route || '',
          reg: barrage.reg ?? null, cie: barrage.cie ?? null, bt: barrage.bt ?? null,
          lng: barrage.lng, lat: barrage.lat,
          factionId: barrage.factionId || null, statutBarrage: barrage.statutBarrage ?? null,
        }
      : { ...racine.barrage, id: racine.barrageId, supprime: true },
    region: racine.destinataire?.unite ?? racine.barrage?.reg ?? null,
    responsable: porteur.destinataire ?? { rang: 'reg', unite: racine.barrage?.reg ?? null },
    assignePar: racine.auteur ?? null,
    assigneLe: racine.cree,
    consigne: racine.texte ?? '',
    statut,
    /* Clos sans qu'aucune écriture n'ait touché le barrage : dit en clair, pas maquillé en succès. */
    sansModification: statut === 'termine' && effectives.length === 0,
    demandesEnAttente,
    derniereAction: derniere
      ? { libelle: derniere.libelle, date: derniere.e.ts, par: derniere.e.nom || derniere.e.matricule || null }
      : { libelle: 'Assigné — aucune action encore', date: racine.cree, par: racine.auteur?.nom ?? null },
    derniereModification: dates[dates.length - 1] ?? racine.cree,
    maillons: chaine.map((x) => ({
      id: x.id,
      destinataire: x.destinataire ?? null,
      cree: x.cree,
      statut: x.decision === 'transmise' ? 'transmise' : x.statut,
      traiteePar: x.traiteePar ?? null,
      traiteeLe: x.traiteeLe ?? null,
      reponse: x.reponse ?? '',
    })),
    historique: ops.map((x) => ({
      date: x.e.ts,
      libelle: x.libelle,
      par: x.e.nom || x.e.matricule || null,
      rang: x.e.rang ?? null,
      effective: estEffective(x.e),
    })),
  };
}

/** Toutes les chaînes : une par assignation RACINE (sans `parentId`), la plus récente d'abord. */
export function suivreAssignations({ instructions, operationsPar, demandesEnAttentePour, barrageParId }) {
  const racines = instructions.filter((i) => i.action === 'assignation' && !i.parentId);
  /* La racine suivante du même barrage borne l'historique de la précédente. */
  const suivante = (r) => racines
    .filter((x) => x.barrageId === r.barrageId && String(x.cree) > String(r.cree))
    .map((x) => x.cree)
    .sort()[0] ?? null;
  return racines
    .map((racine) => {
      const jusqua = suivante(racine);
      return suivreChaine({
        racine,
        instructions,
        operations: operationsPar(racine.barrageId),
        /* Une demande en attente appartient à la chaîne la plus récente du barrage. */
        demandesEnAttente: jusqua ? 0 : demandesEnAttentePour(racine.barrageId, racine.cree),
        barrage: barrageParId(racine.barrageId),
        jusqua,
      });
    })
    .sort((a, b) => String(b.assigneLe).localeCompare(String(a.assigneLe)));
}
