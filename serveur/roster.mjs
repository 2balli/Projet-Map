/**
 * PRÉPARATION DU ROSTER D'UNE JOURNÉE.
 *
 * Le fil complet, de l'effectif au poste :
 *
 *   BRIGADE  ->  ses BARRAGES  ->  COMPOSITION type  ->  PERSONNES  ->  CRÉNEAU
 *
 * Ce module ne fait que l'orchestration. Le calcul de répartition lui-même est
 * ailleurs, dans `repartir` (serveur/effectifs.mjs) : une fonction pure, sans
 * fichier ni horloge, qu'on peut vérifier seule.
 *
 * POURQUOI PRÉPARER LA VEILLE
 * ---------------------------
 * Sans préparation, le chef ouvre SAISIE TERRAIN sur une liste vide et ressaisit
 * grade, nom et matricule pour chaque homme, quatre fois par jour. C'est le seul
 * vrai frein à l'usage de cette section — `elements.json` n'existait toujours pas
 * après des jours d'exploitation. La veille, le système propose donc une
 * répartition complète ; le jour venu, il ne reste qu'à corriger ce qui a changé.
 *
 * CE QUI EST PROPOSÉ N'EST PAS IMPOSÉ. La préparation n'écrit jamais dans un
 * créneau qui contient déjà quelque chose (voir `preparer` dans elements.mjs) :
 * une relève saisie par un chef est un fait, une préparation n'est qu'une
 * proposition. Elle se corrige ensuite comme n'importe quelle ligne — ajout,
 * retrait, remplacement.
 *
 * AUCUNE PERSONNE N'EST INVENTÉE. Quand l'effectif d'une brigade ne suffit pas à
 * honorer la composition demandée, le poste reste incomplet et le manque est
 * rapporté, grade par grade.
 */
import { readFileSync, existsSync } from 'node:fs';
import { CRENEAUX, GRADES, ELEMENTS_PAR_BARRAGE } from './elements.mjs';
import { repartir } from './effectifs.mjs';
import { estTypeBarrage, estVIP } from './depot.mjs';

/** Composition de repli si le fichier déclaré manque ou devient illisible. */
const COMPOSITION_REPLI = [
  { grade: 'A/C', nombre: 1 },
  { grade: 'ADJT', nombre: 1 },
  { grade: 'MDLC', nombre: 1 },
  { grade: 'MDLG', nombre: 3 },
];

const deuxChiffres = (n) => String(n).padStart(2, '0');
export const dateLocale = (d) =>
  `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;

/** Le lendemain d'une date donnée, en heure locale. */
export const lendemain = (d) => {
  const j = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return dateLocale(j);
};

/**
 * Charge la composition déclarée par le commandement.
 *
 * Relue à CHAQUE préparation, et non au démarrage : le fichier est fait pour
 * être corrigé à la main, et l'on ne va pas demander un redémarrage du service
 * pour changer un nombre d'hommes.
 *
 * Les grades inconnus sont écartés en silence plutôt que de faire échouer la
 * préparation entière : une faute de frappe dans le fichier ne doit pas priver
 * une région de son roster.
 */
export function chargerComposition(fichier) {
  let brut = null;
  if (existsSync(fichier)) {
    try {
      brut = JSON.parse(readFileSync(fichier, 'utf8'));
    } catch {
      brut = null;
    }
  }

  /**
   * ÉCRÊTAGE À LA RÈGLE DES TROIS — deux règles ne peuvent pas se contredire.
   *
   * Le fichier dit QUELS grades tiennent un poste ; `ELEMENTS_PAR_BARRAGE` dit
   * COMBIEN, et c'est lui qui fait autorité (voir serveur/elements.mjs). Une
   * composition demandant six hommes ferait sinon préparer six relèves que
   * l'écriture refuserait une par une à partir de la quatrième : le poste
   * resterait incomplet, avec un « manque » inexplicable dans le rapport.
   *
   * On écrête donc, du grade le moins élevé vers le plus élevé — c'est le
   * gradé qu'on garde quand l'équipe se réduit — et on le DIT dans le journal
   * du service, pour que le commandement corrige son fichier plutôt que de
   * découvrir l'écart sur le terrain.
   */
  const ecreter = (liste, origine) => {
    let reste = ELEMENTS_PAR_BARRAGE;
    const retenue = [];
    /* Du plus gradé au moins gradé : `GRADES` va du moins élevé au plus. */
    for (const c of [...liste].sort((a, b) => GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade))) {
      if (reste <= 0) break;
      retenue.push({ grade: c.grade, nombre: Math.min(c.nombre, reste) });
      reste -= Math.min(c.nombre, reste);
    }
    const demande = liste.reduce((t, c) => t + c.nombre, 0);
    if (demande > ELEMENTS_PAR_BARRAGE) {
      console.warn(
        `[composition] ${origine} demande ${demande} hommes ; la règle en fixe ` +
          `${ELEMENTS_PAR_BARRAGE}. Composition ramenée à ` +
          `${retenue.map((c) => `${c.nombre} ${c.grade}`).join(' + ')}. ` +
          'Corrigez composition-barrage.json pour lever cet avertissement.',
      );
    }
    return retenue;
  };

  const nettoyer = (liste, origine = 'composition') =>
    ecreter(
      (Array.isArray(liste) ? liste : [])
        .filter((c) => GRADES.includes(c?.grade) && Number(c?.nombre) > 0)
        .map((c) => ({ grade: c.grade, nombre: Math.min(20, Math.trunc(Number(c.nombre))) })),
      origine,
    );

  const defaut = nettoyer(brut?.defaut, 'la composition par défaut');
  const parType = {};
  for (const [type, liste] of Object.entries(brut?.parType ?? {})) {
    const n = nettoyer(liste, `la composition « ${type} »`);
    if (n.length) parType[type] = n;
  }

  return {
    defaut: defaut.length ? defaut : COMPOSITION_REPLI,
    parType,
    valide: brut?.valideParLeCommandement === true,
    /** La composition applicable à UN barrage, selon sa nature. */
    pour: (barrage) => parType[barrage?.type] ?? (defaut.length ? defaut : COMPOSITION_REPLI),
  };
}

/**
 * PRÉPARE UNE JOURNÉE ENTIÈRE, brigade par brigade et créneau par créneau.
 *
 * `decalage` tourne d'un créneau à l'autre : la même personne ne prend pas les
 * quatre relèves du jour. L'indice du créneau suffit — c'est un décalage stable
 * et lisible, pas un tirage.
 *
 * Retourne un compte rendu, jamais une exception : une brigade sans effectif ou
 * un créneau déjà occupé sont des situations NORMALES, pas des pannes. Elles
 * ressortent dans le rapport, où on peut les lire.
 */
export function preparerJournee({
  date,
  effectifs,
  barrages,
  composition,
  depotElements,
  auteur,
  remplacer = false,
}) {
  /**
   * REFAIRE une journée déjà préparée.
   *
   * `preparer` refuse tout créneau non vide — c'est ce qui protège la saisie du
   * terrain. Mais cela rend aussi une journée proposée définitive : après une
   * correction de la composition ou un chargement d'effectif, re-préparer
   * n'aurait plus aucun effet. On efface donc d'abord les seules lignes
   * PROPOSÉES, et uniquement dans les créneaux où personne n'est intervenu
   * (voir `retirerPreparation`). Ce qu'un chef a touché reste tel quel.
   */
  const efface = remplacer
    ? depotElements.retirerPreparation(date)
    : { retires: 0, proteges: 0, creneauxHumains: 0 };

  /* On ne prépare que là où il y a un effectif déclaré : ailleurs, il n'y a
     rien à proposer, et proposer du vide n'aide personne. */
  const parBrigade = new Map();
  for (const b of barrages) {
    if (!estTypeBarrage(b.type)) continue;
    /**
     * LA PRÉPARATION AUTOMATIQUE NE TOUCHE JAMAIS UN BARRAGE VIP.
     *
     * Sa faction n'est pas une proposition à compléter : elle a été COMPOSÉE
     * à la création, quatre hommes nommés, et c'est la règle même du VIP. La
     * préparation, qui garnit les postes créneau par créneau d'après la
     * composition type, y aurait ajouté trois hommes par créneau sur les
     * quatre de la journée — le poste se serait retrouvé à vingt-cinq
     * éléments le lendemain de sa création, sans que personne l'ait demandé.
     *
     * C'est le défaut qu'a révélé `npm run check:vip` : la règle tenait à
     * l'écriture manuelle et à la création, et une tâche de fond la défaisait
     * une heure plus tard.
     */
    if (estVIP(b)) continue;
    if (!b.bt) continue;
    if (!parBrigade.has(b.bt)) parBrigade.set(b.bt, []);
    parBrigade.get(b.bt).push(b);
  }

  const rapport = {
    date,
    brigades: 0,
    barrages: 0,
    ajoutes: 0,
    creneauxOccupes: 0,
    sansEffectif: [],
    manques: [],
    /* Ce que le remplacement a défait, et ce qu'il a refusé de défaire. */
    remplacement: remplacer ? efface : null,
  };

  /**
   * TOUTE LA JOURNÉE EN UN SEUL ENREGISTREMENT.
   *
   * Sans ce groupement, préparer le pays réécrivait le dépôt à chaque poste et
   * à chaque créneau — plus de quatre mille fois un fichier de vingt-quatre
   * mégaoctets. Le dépôt sait grouper (voir `enBloc`) ; ici on lui dit où
   * commence et où finit le lot.
   */
  depotElements.enBloc(() => {
    /* Ordre stable : deux préparations de la même journée donnent le même roster. */
    for (const bt of [...parBrigade.keys()].sort()) {
      const postes = parBrigade
        .get(bt)
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id));
      const personnel = effectifs.deLaBrigade(bt);

      if (!personnel.length) {
        rapport.sansEffectif.push({ bt, barrages: postes.length });
        continue;
      }

      rapport.brigades++;
      rapport.barrages += postes.length;

      CRENEAUX.forEach((creneau, iCreneau) => {
        const { affectations, manques } = repartir({
          personnel,
          barrages: postes,
          composition: (b) => composition.pour(b),
          decalage: iCreneau,
        });

        for (const poste of postes) {
          const personnes = affectations.get(poste.id) ?? [];
          if (!personnes.length) continue;
          const r = depotElements.preparer({
            barrageId: poste.id,
            date,
            creneau,
            personnes,
            auteur,
          });
          rapport.ajoutes += r.ajoutes;
          if (r.motif === 'creneau-non-vide') rapport.creneauxOccupes++;
        }

        for (const m of manques) {
          rapport.manques.push({ bt, creneau, ...m });
        }
      });
    }
  }); // fin du lot d'écritures — voir `enBloc`

  /* Le détail des manques peut être long : on le résume par grade, en gardant
     la liste complète pour qui veut la lire. */
  const parGrade = {};
  for (const m of rapport.manques) parGrade[m.grade] = (parGrade[m.grade] ?? 0) + m.nombre;
  rapport.manquesParGrade = parGrade;

  /**
   * COMBIEN D'HOMMES MANQUENT, ET DANS QUELLES BRIGADES.
   *
   * `manques` compte des LIGNES — « il manque 3 MDLG sur ce poste, à ce
   * créneau » est une seule entrée pour trois hommes. En annoncer le nombre
   * comme un nombre de postes trompe deux fois : sur l'ordre de grandeur, et
   * sur la nature du problème.
   *
   * La répartition par brigade est la seule information dont on puisse faire
   * quelque chose. Un total national ne se corrige pas ; « Es-Smara tient 36
   * barrages avec 20 hommes » se corrige — en allégeant la composition de ces
   * postes, en y affectant du monde, ou en admettant que tous ne seront pas
   * tenus en même temps.
   */
  rapport.manquesTotalHommes = Object.values(parGrade).reduce((s, n) => s + n, 0);

  /* `parBrigade` sert déjà, plus haut, à ranger les barrages par unité. */
  const manquesBt = {};
  for (const m of rapport.manques) manquesBt[m.bt] = (manquesBt[m.bt] ?? 0) + m.nombre;
  rapport.manquesParBrigade = Object.entries(manquesBt)
    .sort((a, b) => b[1] - a[1])
    .map(([bt, hommes]) => ({ bt, hommes }));

  return rapport;
}
