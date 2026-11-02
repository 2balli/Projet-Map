/**
 * MODIFICATION D'UN BARRAGE — effectif et protection (le déplacement passe
 * par « Déplacer » et PATCH /api/marquages/:id, seul chemin de déplacement).
 *
 * Ce module ne contient que du CALCUL : il ne lit aucun fichier, n'écrit rien
 * et ne connaît pas la session. Les routes de `serveur/api.mjs`
 * (`/api/barrages/:id/modification` et son aperçu) l'appellent après avoir
 * contrôlé l'autorité, puis écrivent par les chemins qui existaient déjà —
 * dépôt, demandes de validation, dépôt des éléments, journal.
 *
 * L'enregistrement calcule tout sur l'état du dépôt à cet instant et refuse
 * (409, avec le résumé calculé) si une confirmation manque. Rien de ce que le
 * navigateur envoie n'est cru sur parole.
 *
 * Rien n'est réécrit ici qui existait déjà :
 *   — la route et le PK : `serveur/pointKilometrique.mjs`, sur le graphe réel ;
 *   — la distance routière : `distanceRouteMinKm` (serveur/distances.mjs) ;
 *   — les factions d'un poste : `factionsDuBarrage` (serveur/factions.mjs) ;
 *   — la protection : `estIntouchable` (serveur/depot.mjs) ;
 *   — la règle des trois : `ELEMENTS_PAR_BARRAGE` (serveur/elements.mjs).
 */
import { distanceKm } from './routage.mjs';
import { distanceRouteMinKm } from './distances.mjs';
import { estIntouchable, estTypeBarrage } from './depot.mjs';
import { FACTIONS, FACTION_IDS, factionParId, factionsDuBarrage } from './factions.mjs';
import { recalerPosition, routeExiste } from './pointKilometrique.mjs';
import { GRADES } from './elements.mjs';

/**
 * SEUIL DU CONTRÔLE DE DISTANCE, en kilomètres de route.
 *
 * 40 km : l'écartement retenu par le commandement pour le dispositif des
 * postes permanents (`SEPARATION_MEME_AXE_KM` de
 * scripts/generer-nouveau-dispositif.mjs). Réglable au lancement du service
 * (`--seuil-conflit-km`) ; il n'a rien à voir avec le seuil des alertes de
 * rapprochement (`--seuil-barrages`, 20 km), qui garde son propre usage.
 */
export const SEUIL_CONFLIT_KM_DEFAUT = 40;

/** Un poste retiré ne compte plus dans le dispositif. */
export const enService = (m) =>
  m && m.statutBarrage !== 'supprime' && m.statutBarrage !== 'retire_optimisation';

/**
 * LES FACTIONS À PRENDRE EN COMPTE POUR UN CONFLIT.
 *
 * Un intouchable est PERMANENT, 24 h sur 24 : quelle que soit la faction de
 * l'autre poste, il est en service en même temps que lui. Un poste dont on ne
 * sait pas quand il est tenu est traité de même — c'est la règle déjà retenue
 * par l'optimisation (`factionsSeChevauchent`, serveur/optimisationTrajet.mjs) :
 * dans le doute, on prévient plutôt que de taire un rapprochement réel.
 */
export function factionsPourConflit(m) {
  if (estIntouchable(m)) return [...FACTION_IDS];
  const f = factionsDuBarrage(m);
  return f.length ? f : [...FACTION_IDS];
}

/* ------------------------------------------------------------------ */
/* Position : inchangée, par la carte, ou par route + PK              */
/* ------------------------------------------------------------------ */

/**
 * Où le barrage se trouve AUJOURD'HUI, lu sur le réseau : route et PK.
 *
 * La position enregistrée n'est pas touchée — on ne recale pas en douce un
 * poste qu'on ne déplace pas. On dit seulement à quel PK il correspond.
 */
export function positionActuelle(graphe, m) {
  const base = { lng: m.lng, lat: m.lat, route: m.route || null, pk: Number.isFinite(m.pk) ? m.pk : null };
  if (!graphe) return base;
  const route = m.route && routeExiste(graphe, m.route) ? m.route : null;
  const lu = recalerPosition(graphe, m.lng, m.lat, { route, rayonKm: 30 });
  if (lu.erreur) return base;
  return { ...base, route: base.route ?? lu.route, pk: base.pk ?? lu.pk };
}

/* ------------------------------------------------------------------ */
/* Contrôle de distance                                               */
/* ------------------------------------------------------------------ */

/**
 * Les postes à moins de `seuilKm` DE ROUTE et tenus sur une même faction.
 *
 * Le préfiltre à vol d'oiseau ne peut rien écarter à tort : la route est
 * toujours au moins aussi longue que la ligne droite (voir distances.mjs).
 * On en profite aussi pour dire la distance au poste le plus proche, quelle
 * que soit sa faction — l'aperçu l'affiche.
 *
 * @returns {{conflits: Array, plusProche: {id, nom, km}|null}}
 */
export function controleDistance(graphe, cible, barrages, seuilKm, { rayonPlusProcheKm = 100 } = {}) {
  const factionsCible = new Set(factionsPourConflit(cible));
  const voisins = barrages
    .filter((m) => m.id !== cible.id && estTypeBarrage(m.type) && enService(m))
    .map((m) => ({ m, vol: distanceKm(cible.lng, cible.lat, m.lng, m.lat) }))
    .filter((v) => v.vol <= Math.max(seuilKm, rayonPlusProcheKm))
    .sort((a, b) => a.vol - b.vol);

  const conflits = [];
  let plusProche = null;
  let mesuresPlusProche = 0;
  for (const { m, vol } of voisins) {
    const utilePourSeuil = vol < seuilKm;
    /* Pour le plus proche, une dizaine de mesures suffit : au-delà, la ligne
       droite est déjà plus longue que la meilleure route trouvée. */
    const utilePourProche = mesuresPlusProche < 10 && (!plusProche || vol < plusProche.km);
    if (!utilePourSeuil && !utilePourProche) continue;
    const km = graphe ? distanceRouteMinKm(graphe, [cible.lng, cible.lat], [m.lng, m.lat]) : null;
    if (utilePourProche) mesuresPlusProche++;
    if (km == null) continue;
    if (!plusProche || km < plusProche.km) plusProche = { id: m.id, nom: m.nom || '', km: Math.round(km * 10) / 10 };
    if (km < seuilKm) {
      const communes = factionsPourConflit(m).filter((f) => factionsCible.has(f));
      if (communes.length) {
        conflits.push({
          id: m.id,
          nom: m.nom || '',
          route: m.route || null,
          pk: Number.isFinite(m.pk) ? m.pk : null,
          cie: m.cie ?? null,
          bt: m.bt ?? null,
          intouchable: estIntouchable(m),
          km: Math.round(km * 10) / 10,
          factions: communes,
        });
      }
    }
  }
  conflits.sort((a, b) => a.km - b.km);
  return { conflits, plusProche };
}

/* ------------------------------------------------------------------ */
/* Protection                                                         */
/* ------------------------------------------------------------------ */

/**
 * L'autre intouchable de la compagnie, s'il existe — la règle « un seul par
 * compagnie », écrite UNE fois et lue par la pose, la modification et
 * l'acceptation d'une demande.
 */
export const autreIntouchableDeLaCompagnie = (barrages, cie, saufId) =>
  (cie &&
    barrages.find(
      (m) => m.id !== saufId && estIntouchable(m) && enService(m) && m.cie && m.cie === cie,
    )) ||
  null;

/**
 * Les champs d'une protection, activée ou retirée.
 *
 * ACTIVÉE : poste permanent, comme les intouchables semés par le
 * commandement — tenu de 00:00 à 24:00, sans faction attitrée (les quatre
 * factions s'y relaient). Le TYPE ne change pas : un intouchable reste un
 * `barrage_fixe` protégé, jamais un `barrage_vip`.
 *
 * RETIRÉE : `protection: 'aucune'`, la valeur que portent déjà les postes
 * ordinaires du dépôt. Si une faction est choisie, le poste reprend l'horaire
 * de cette faction — c'est la forme de tous les postes ordinaires ; sinon
 * l'horaire est conservé tel quel.
 */
export function champsProtection(intouchable, factionId = null) {
  if (intouchable) {
    return { protection: 'intouchable', intouchable: true, debut: '00:00', fin: '24:00', factionId: '' };
  }
  const f = factionParId(factionId);
  return {
    protection: 'aucune',
    intouchable: false,
    ...(f ? { factionId: f.id, debut: f.debut, fin: f.fin === '24:00' ? '00:00' : f.fin } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Effectif du créneau                                                */
/* ------------------------------------------------------------------ */

const RANG_GRADE = Object.fromEntries(GRADES.map((g, i) => [g, i]));

/**
 * CE QUE « PASSER À N ÉLÉMENTS » VEUT DIRE, EN NOMS.
 *
 * L'effectif d'un poste n'est pas un nombre écrit sur sa fiche : c'est la
 * relève nominative du créneau en cours (serveur/elements.mjs). Changer le
 * nombre, c'est donc désigner QUI arrive ou QUI part — et chaque arrivant doit
 * être de la brigade du poste et libre sur ce créneau, exactement comme à la
 * saisie unitaire (POST /api/elements).
 *
 *   ajout    les plus gradés d'abord, puis par matricule — l'ordre du roster
 *            (`deLaBrigade`), pour que le même geste désigne les mêmes hommes ;
 *   retrait  les lignes préparées automatiquement d'abord, puis les plus
 *            récentes : une saisie humaine est la dernière à partir.
 *
 * @returns {{actuel, demande, ajouter: Array, retirer: Array}|{erreur: string}}
 */
export function planEffectif({ demande, presents, personnel, occupes, max }) {
  const actuel = presents.length;
  if (demande == null || demande === '') return { actuel, demande: actuel, ajouter: [], retirer: [] };
  const n = Math.trunc(Number(demande));
  if (!Number.isFinite(n) || n < 0) return { erreur: "L'effectif doit être un nombre entier positif." };
  if (n > max) {
    return {
      erreur: `Un barrage est tenu par ${max} éléments au plus sur un créneau (règle des trois) : ${n} est refusé.`,
    };
  }
  if (n === actuel) return { actuel, demande: n, ajouter: [], retirer: [] };

  if (n < actuel) {
    const ordre = [...presents].sort(
      (a, b) => (b.prepare === true) - (a.prepare === true) || String(b.saisiLe).localeCompare(String(a.saisiLe)),
    );
    return { actuel, demande: n, ajouter: [], retirer: ordre.slice(0, actuel - n) };
  }

  if (!personnel.length) {
    return {
      erreur:
        "Aucun personnel enregistré pour la brigade de ce poste : impossible d'affecter des éléments nommés. " +
        "Chargez l'effectif de la brigade ou saisissez les éléments un par un.",
    };
  }
  const deja = new Set(presents.map((e) => e.matricule).filter(Boolean));
  const libres = personnel
    .filter((p) => !deja.has(p.matricule) && !occupes.has(p.matricule))
    .sort((a, b) => (RANG_GRADE[b.grade] ?? -1) - (RANG_GRADE[a.grade] ?? -1) || a.matricule.localeCompare(b.matricule));
  const manque = n - actuel;
  if (libres.length < manque) {
    return {
      erreur:
        `Effectif insuffisant : ${manque} élément(s) demandé(s), ${libres.length} disponible(s) ` +
        'dans la brigade sur ce créneau (les autres tiennent déjà un poste).',
    };
  }
  return { actuel, demande: n, ajouter: libres.slice(0, manque), retirer: [] };
}

/** Résumé lisible d'une fiche, pour l'aperçu et le journal. */
export const resume = (m, { effectif = null } = {}) => ({
  lng: m.lng,
  lat: m.lat,
  route: m.route || null,
  pk: Number.isFinite(m.pk) ? m.pk : null,
  bt: m.bt ?? null,
  cie: m.cie ?? null,
  reg: m.reg ?? null,
  intouchable: estIntouchable(m),
  protection: m.protection ?? null,
  factionId: m.factionId || null,
  debut: m.debut || null,
  fin: m.fin || null,
  effectif,
});

export { FACTIONS };
