/**
 * EFFECTIF NOMINATIF — qui sert dans quelle brigade, et à quel grade.
 *
 * Un fichier JSON de plus, sur le modèle des autres dépôts : lecture au
 * démarrage, le serveur seul fait autorité.
 *
 * CE DÉPÔT NE CONNAÎT NI BARRAGE NI CRÉNEAU. Il ne dit que « telle personne
 * appartient à telle brigade ». C'est la répartition (voir `repartir`) qui la
 * place sur un poste, et le dépôt des éléments qui garde la trace de sa garde.
 * Séparer les deux permet de remplacer l'effectif sans toucher à l'historique
 * des relèves, et inversement.
 *
 * DONNÉES DE DÉMONSTRATION
 * ------------------------
 * Le projet ne dispose pas de l'effectif réel : `comptes.json` ne contient que
 * des comptes de connexion, un par unité, sans grade ni gendarme individuel. Un
 * effectif FICTIF a donc été produit pour développer et éprouver la mécanique —
 * voir scripts/fake-effectifs.mjs.
 *
 * Chaque personne fictive porte `demo: true` ET un matricule préfixé `DEMO-`.
 * La redondance est voulue : le drapeau sert au code, le préfixe saute aux yeux
 * dans n'importe quelle liste, à l'écran comme à l'impression. Le script les
 * efface toutes avec `--retirer`, et rien d'autre.
 *
 * Le jour où l'effectif réel arrivera, il suffira de charger des personnes sans
 * ce drapeau : aucune ligne de la mécanique ne dépend des noms fictifs.
 */
import { readFileSync, existsSync } from 'node:fs';
import { GRADES } from './elements.mjs';

const estValide = (p) =>
  p &&
  typeof p.matricule === 'string' &&
  p.matricule.trim() !== '' &&
  typeof p.nom === 'string' &&
  p.nom.trim() !== '' &&
  GRADES.includes(p.grade) &&
  typeof p.bt === 'string' &&
  p.bt.trim() !== '';

export function creerDepotEffectifs(fichier) {
  let items = [];
  let empreinte = -1;

  const charger = () => {
    if (!existsSync(fichier)) {
      items = [];
      return;
    }
    const brut = JSON.parse(readFileSync(fichier, 'utf8'));
    items = (brut.items ?? []).filter(estValide);
  };

  try {
    charger();
  } catch (err) {
    throw new Error(`Effectif illisible (${fichier}) : ${err.message}`);
  }

  /**
   * Relu quand le fichier change — comme le dépôt des marquages.
   *
   * L'effectif est produit puis remplacé par script : sans relecture, il
   * faudrait redémarrer le service après chaque import, et l'on servirait
   * entre-temps l'ancien effectif sans le moindre signe. Ce piège a déjà coûté
   * trois allers-retours sur les marquages ; on ne le reproduit pas ici.
   *
   * La taille du fichier tient lieu d'empreinte : suffisant pour un fichier
   * remplacé en bloc par un script.
   */
  const relireSiModifie = () => {
    let taille = 0;
    try {
      taille = existsSync(fichier) ? readFileSync(fichier).length : 0;
    } catch {
      return;
    }
    if (taille === empreinte) return;
    const avant = items.length;
    try {
      charger();
      empreinte = taille;
      if (avant !== items.length) {
        console.log(`  effectif relu : ${avant} -> ${items.length} personne(s)`);
      }
    } catch (err) {
      empreinte = taille;
      console.error(`  ! effectif non relu (${err.message})`);
    }
  };

  return {
    tous: () => {
      relireSiModifie();
      return items;
    },

    /** L'effectif d'une brigade, du plus gradé au moins gradé puis par matricule. */
    deLaBrigade: (bt) => {
      relireSiModifie();
      return items
        .filter((p) => p.bt === bt)
        .sort(
          (a, b) =>
            GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade) ||
            a.matricule.localeCompare(b.matricule)
        );
    },

    /** Combien de personnes par brigade — pour la vue d'ensemble. */
    parBrigade: () => {
      relireSiModifie();
      const c = new Map();
      for (const p of items) c.set(p.bt, (c.get(p.bt) ?? 0) + 1);
      return c;
    },
  };
}

/* ================================================================== */
/* Répartition — fonction PURE, sans fichier ni horloge                */
/* ================================================================== */

/**
 * RÉPARTIT L'EFFECTIF D'UNE BRIGADE SUR SES BARRAGES, POUR UN CRÉNEAU.
 *
 * Volontairement pure : elle ne lit aucun fichier, n'interroge aucune horloge,
 * ne connaît pas le serveur. Deux appels avec les mêmes arguments rendent le
 * même résultat — elle se vérifie donc seule, et le jour où l'effectif réel
 * remplacera l'effectif fictif, rien ici ne change.
 *
 * TROIS RÈGLES, DANS CET ORDRE
 * ----------------------------
 *   1. PAR GRADE, DU PLUS ÉLEVÉ AU MOINS ÉLEVÉ. On place d'abord les A/C
 *      demandés, puis les ADJT, et ainsi de suite. Un manque frappe donc le bas
 *      de la composition, jamais son encadrement.
 *   2. UN TOUR À LA FOIS. À chaque grade, on sert les barrages l'un après
 *      l'autre avant de revenir au premier. Sinon le premier poste serait
 *      complet et le dernier vide ; ici la pénurie se répartit.
 *   3. JAMAIS DEUX FOIS LA MÊME PERSONNE DANS UN CRÉNEAU. Le vivier se
 *      consomme, il ne se recopie pas.
 *
 * LA ROTATION ENTRE CRÉNEAUX — `decalage` fait commencer la distribution plus
 * loin dans la liste, pour que les mêmes ne prennent pas les quatre relèves de
 * la journée. Quand l'effectif ne suffit pas à quatre relèves complètes, une
 * réutilisation reste inévitable : c'est la réalité d'une brigade, pas un
 * défaut — elle est alors répartie au lieu d'être subie par les mêmes.
 *
 * CE QUI MANQUE EST DIT, JAMAIS COMBLÉ : un poste incomplet ressort dans
 * `manques`, avec le grade et le nombre attendu. Aucune personne n'est inventée.
 */
export function repartir({ personnel, barrages, composition, decalage = 0 }) {
  const vivier = new Map();
  for (const g of GRADES) vivier.set(g, []);
  for (const p of personnel) if (vivier.has(p.grade)) vivier.get(p.grade).push(p);

  /* La rotation porte sur CHAQUE vivier séparément : décaler la liste entière
     ferait tourner les grades entre eux, pas les personnes d'un même grade. */
  for (const [g, liste] of vivier) {
    if (liste.length > 1) {
      const d = decalage % liste.length;
      vivier.set(g, [...liste.slice(d), ...liste.slice(0, d)]);
    }
  }

  const affectations = new Map(barrages.map((b) => [b.id, []]));
  const manques = [];
  const pris = new Set();

  /* `GRADES` va du moins élevé au plus élevé : on le parcourt à l'envers. */
  for (const grade of [...GRADES].reverse()) {
    const dispo = vivier.get(grade) ?? [];
    let curseur = 0;

    const demandes = barrages.map((b) => ({
      barrage: b,
      reste: composition(b).find((c) => c.grade === grade)?.nombre ?? 0,
    }));

    let encore = true;
    while (encore) {
      encore = false;
      for (const d of demandes) {
        if (d.reste <= 0) continue;
        if (curseur >= dispo.length) continue;
        const personne = dispo[curseur++];
        if (pris.has(personne.matricule)) continue;
        pris.add(personne.matricule);
        affectations.get(d.barrage.id).push({
          matricule: personne.matricule,
          nom: personne.nom,
          grade,
        });
        d.reste--;
        encore = true;
      }
    }

    for (const d of demandes) {
      if (d.reste > 0) manques.push({ barrageId: d.barrage.id, grade, nombre: d.reste });
    }
  }

  return {
    affectations,
    manques,
    /** L'effectif non affecté sur ce créneau — la réserve de la brigade. */
    reserve: personnel.filter((p) => !pris.has(p.matricule)),
  };
}
