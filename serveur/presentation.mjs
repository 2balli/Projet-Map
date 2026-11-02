/**
 * LA RÉFÉRENCE DE PRÉSENTATION — l'état exact du dispositif de démonstration
 * auquel « ↩ Restaurer les positions initiales » ramène.
 *
 * Une démonstration déplace des postes, ouvre des demandes, en fait valider,
 * applique des optimisations. Pour la rejouer devant un autre public, il faut
 * revenir à l'état de départ — EXACTEMENT, pas à un état ressemblant : mêmes
 * coordonnées, même route, même PK, même rattachement, même faction, mêmes
 * décisions d'optimisation.
 *
 * CE QUE LA RÉFÉRENCE CONTIENT — et rien d'autre (périmètre audité) :
 *   - la copie intégrale de chaque BARRAGE (`barrage_fixe`, `barrage_mobile`),
 *     tous champs compris, et l'ordre de tous les marquages du dépôt ;
 *   - les ALERTES de distance telles qu’elles étaient (avec leur acquittement),
 *     recalculées ensuite sur les positions restaurées ;
 *   - la copie intégrale des NOTIFICATIONS qui portent sur l'état d'un barrage
 *     (`ACTIONS_BARRAGE` : demandes de modification ou de déplacement,
 *     propositions de retrait ou de maintien, signalements de pose, retraits
 *     d'optimisation), et l'ordre de toutes les notifications.
 *
 * CE QU'ELLE NE TOUCHE JAMAIS : les comptes, la hiérarchie et les contours, les
 * effectifs, la composition, les relèves de faction, le graphe routier et les
 * couches GeoJSON, les autres marquages (accidents, points noirs…), les
 * instructions écrites et les réclamations, le journal (qui ne fait que
 * s'allonger), l'historique des optimisations appliquées. Les alertes et les
 * conflits de planification, eux, sont DÉRIVÉS des barrages : ils sont
 * recalculés après la restauration, jamais copiés.
 *
 * Le fichier vit dans le dossier de données, à côté de `mode.json` : il
 * voyage avec la démonstration et n'existe pas pour un dossier de production
 * (le service refuse de l'écrire ou de l'appliquer hors du mode démo).
 */
import { existsSync, readFileSync } from 'node:fs';
import { ecrireJsonAtomique } from './ecritureAtomique.mjs';

export const FICHIER_REFERENCE_PRESENTATION = 'reference-presentation.json';

/** Les natures de notification qui décrivent l'état d'un barrage. */
export const ACTIONS_BARRAGE = ['modification', 'suppression', 'conservation', 'nouveau_barrage', 'retrait_optimisation'];
export const notificationDeBarrage = (n) => ACTIONS_BARRAGE.includes(n?.action);

const copie = (x) => JSON.parse(JSON.stringify(x));

/**
 * L'ÉTAT RESTAURÉ — la référence pour ce qui est concerné, l'état courant pour
 * le reste, dans l'ordre de la référence.
 *
 * Un élément concerné absent de la référence (posé pendant la démonstration)
 * disparaît ; un élément concerné de la référence absent aujourd'hui (retiré
 * pendant la démonstration) revient. Ce qui n'est pas concerné n'est jamais
 * ni retiré ni modifié ; ce qui a été ajouté hors périmètre est gardé, en fin
 * de liste.
 */
export function fusionnerAvecReference(courants, reference, ordre, estConcerne) {
  const ref = new Map(reference.map((x) => [x.id, x]));
  const cour = new Map(courants.map((x) => [x.id, x]));
  const sortie = [];
  const vus = new Set();
  for (const id of ordre) {
    vus.add(id);
    if (ref.has(id)) sortie.push(copie(ref.get(id)));
    else if (cour.has(id) && !estConcerne(cour.get(id))) sortie.push(cour.get(id));
  }
  for (const x of courants) {
    if (vus.has(x.id)) continue;
    if (ref.has(x.id)) continue;
    if (!estConcerne(x)) sortie.push(x);
  }
  return sortie;
}

/** Ce qui diffère de la référence — pour l'écran, avant de restaurer. */
export function ecartsAvecReference(courants, reference, estConcerne, champsPosition = ['lng', 'lat', 'route', 'pk']) {
  const ref = new Map(reference.map((x) => [x.id, x]));
  const concernes = courants.filter(estConcerne);
  const cour = new Map(concernes.map((x) => [x.id, x]));
  let deplaces = 0;
  let modifies = 0;
  for (const x of concernes) {
    const r = ref.get(x.id);
    if (!r) continue;
    if (JSON.stringify(x) === JSON.stringify(r)) continue;
    if (champsPosition.some((c) => JSON.stringify(x[c] ?? null) !== JSON.stringify(r[c] ?? null))) deplaces++;
    else modifies++;
  }
  return {
    deplaces,
    modifies,
    ajoutes: concernes.filter((x) => !ref.has(x.id)).length,
    retires: reference.filter((r) => !cour.has(r.id)).length,
  };
}

export function creerReferencePresentation(fichier) {
  let ref = null;
  if (existsSync(fichier)) {
    try {
      ref = JSON.parse(readFileSync(fichier, 'utf8'));
    } catch (err) {
      /* Une référence illisible ne se devine pas : on la signale, et la
         restauration reste impossible tant qu'elle n'est pas réenregistrée. */
      console.error(`  ! référence de présentation illisible (${err.message})`);
      ref = null;
    }
  }
  const ecrire = () => ecrireJsonAtomique(fichier, ref);
  return {
    lire: () => ref,
    existe: () => Boolean(ref?.barrages),
    /** Fige l'état présent comme référence. Les copies sont profondes. */
    enregistrer({ marquages, instructions, alertes = [], estBarrage, par = null, motif = 'manuel' }) {
      ref = {
        version: 1,
        cree: new Date().toISOString(),
        creePar: par,
        motif,
        ordreMarquages: marquages.map((m) => m.id),
        barrages: copie(marquages.filter(estBarrage)),
        ordreInstructions: instructions.map((i) => i.id),
        instructions: copie(instructions.filter(notificationDeBarrage)),
        /* Les alertes de distance sont DÉRIVÉES des barrages, mais elles portent
           un acquittement : on les restaure telles quelles, puis le recalcul
           routier les remet d’accord avec les positions restaurées. */
        alertes: copie(alertes),
        restaurations: ref?.restaurations ?? [],
      };
      ecrire();
      return ref;
    },
    noterRestauration(entree) {
      if (!ref) return;
      ref.restaurations = [...(ref.restaurations ?? []), entree].slice(-50);
      ecrire();
    },
    /** Horodatage ISO de la dernière restauration, ou null. */
    derniereRestauration: () => ref?.restaurations?.at(-1)?.ts ?? null,
  };
}
