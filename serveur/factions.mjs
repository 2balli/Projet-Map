/**
 * LES FACTIONS — les quatre tours de service de la journée, nommés une fois.
 *
 * CE FICHIER NE CRÉE AUCUNE DONNÉE. Il met un NOM et des BORNES sur ce que le
 * projet manipulait déjà en chiffres nus : `CRENEAUX = [0, 6, 12, 18]` dans
 * serveur/elements.mjs, l'heure de début qui identifie un créneau de six
 * heures. Chaque relève porte ce chiffre depuis toujours ; il lui manquait
 * seulement un vocabulaire — « Faction 1 », « 00h00 → 06h00 » — que chaque
 * écran réinventait pour lui-même.
 *
 * LES FACTIONS SE DÉDUISENT DE `CRENEAUX`, elles ne le doublent pas. Ajouter
 * un cinquième créneau au dépôt ajoute une cinquième faction ici, sans que
 * personne ait à y penser. L'inverse — deux listes tenues à la main — aurait
 * fini par les faire diverger, et l'on aurait eu des relèves sur un créneau
 * qu'aucune faction ne nomme.
 *
 * OÙ VIT LE LIEN BARRAGE → FACTION → ÉLÉMENTS. Pas ici, et pas dans un
 * nouveau fichier : dans le DÉPÔT DES RELÈVES (serveur/elements.mjs), où
 * chaque ligne porte déjà `barrageId`, `creneau`, `date` et l'identité de
 * l'homme. C'est la source de vérité, elle est datée, elle est alimentée par
 * le terrain, et elle existait avant cette demande. Recopier ces liens dans un
 * `barrages-factions.json` aurait créé exactement la seconde source de vérité
 * qu'il faut éviter : deux réponses à « qui tenait ce poste cette nuit-là »,
 * et aucun moyen de savoir laquelle croire.
 *
 * UN BARRAGE A DONC PLUSIEURS FACTIONS, et c'est le modèle réel : sur le
 * dispositif en service, chaque poste est relevé sur les quatre créneaux. Le
 * modèle « un barrage = une faction » aurait été plus simple à écrire et faux
 * dès la première journée.
 */
import { CRENEAUX } from './elements.mjs';
import { activiteDuBarrage, minutesChevauchement } from './creneaux.mjs';

/** Un créneau dure six heures — c'est ce que `CRENEAUX` encode par ses bornes. */
export const DUREE_FACTION_H = 24 / CRENEAUX.length;

const deuxChiffres = (n) => String(n).padStart(2, '0');
const heure = (h) => `${deuxChiffres(((h % 24) + 24) % 24)}:00`;

/**
 * LES FACTIONS, DANS L'ORDRE DE LA JOURNÉE.
 *
 * `id` est stable et lisible (`F1`…`F4`) : il voyage dans les URL, les
 * réglages d'écran et les rapports, là où un chiffre nu se confondrait avec
 * l'heure de début. `creneau` reste le chiffre du dépôt — c'est par lui que
 * l'on retrouve les relèves.
 *
 * La dernière faction se termine à « 24:00 » plutôt qu'à « 00:00 » : les deux
 * désignent le même instant, mais `00:00` en fin de plage se lit comme une
 * plage vide. Le calcul d'intervalle (serveur/creneaux.mjs) traite d'ailleurs
 * les deux correctement — c'est pour l'œil que la distinction compte.
 */
export const FACTIONS = CRENEAUX.map((creneau, i) => ({
  id: `F${i + 1}`,
  nom: `Faction ${i + 1}`,
  creneau,
  debut: heure(creneau),
  fin: creneau + DUREE_FACTION_H >= 24 ? '24:00' : heure(creneau + DUREE_FACTION_H),
  /** « 00h00 → 06h00 » — le libellé unique, employé partout. */
  libelle: `${deuxChiffres(creneau)}h00 → ${deuxChiffres((creneau + DUREE_FACTION_H) % 24)}h00`,
}));

/**
 * LES IDENTIFIANTS SEULS — pour les énumérations qui valident une saisie.
 *
 * `serveur/depot.mjs` s'en sert pour n'accepter que `F1`…`F4` dans le champ
 * `factionId` d'un barrage. Il importe cette liste plutôt que de la recopier :
 * une cinquième faction deviendrait sinon une valeur refusée à l'écriture.
 */
export const FACTION_IDS = FACTIONS.map((f) => f.id);

/** Retrouve une faction par son identifiant (`F1`) — `null` si inconnu. */
export const factionParId = (id) => FACTIONS.find((f) => f.id === id) ?? null;

/** Retrouve une faction par l'heure de début de son créneau (0, 6, 12, 18). */
export const factionParCreneau = (creneau) =>
  FACTIONS.find((f) => f.creneau === Number(creneau)) ?? null;

/**
 * LA FACTION EN COURS À CET INSTANT.
 *
 * Même règle que `creneauDe` (serveur/elements.mjs), et pour la même raison :
 * l'heure LOCALE du serveur, jamais UTC. Un tour de service est une réalité
 * d'horloge murale ; calculé en UTC, il basculerait une heure trop tôt ou trop
 * tard selon la saison, et la carte annoncerait la mauvaise faction.
 *
 * Le passage de 23h59 à 00h00 n'est pas un cas particulier : `getHours()`
 * repasse à 0, et la division entière rend la première faction.
 */
export const factionDe = (d = new Date()) =>
  FACTIONS[Math.floor(d.getHours() / DUREE_FACTION_H)] ?? FACTIONS[0];

/** Les segments d'une faction, en minutes depuis minuit. */
const segmentsDe = (f) => [{ de: f.creneau * 60, a: f.creneau * 60 + DUREE_FACTION_H * 60 }];

/**
 * LES FACTIONS SUR LESQUELLES CE BARRAGE EST TENU.
 *
 * Trois lectures, dans cet ordre, et aucune invention :
 *
 *   1. LE CHAMP `factionId` DE LA FICHE. Le commandement a affecté ce poste à
 *      un tour de service, une fois pour toutes : c'est la réponse, et elle
 *      est unique. C'est le cas des barrages de référence, un par brigade et
 *      par faction.
 *   2. LA FENÊTRE `debut`/`fin`. À défaut d'affectation, les factions que
 *      l'horaire déclaré recouvre. Un service 20h00 → 02h00 relève ainsi de la
 *      faction 4 ET de la faction 1 — ce qui est exact, et qu'un rattachement
 *      unique aurait été incapable de dire.
 *   3. LES RELÈVES. À défaut des deux, les créneaux réellement tenus ce
 *      jour-là, lus au dépôt des éléments. C'est la donnée de terrain.
 *
 * AUCUNE DES TROIS : le poste n'est rattaché à aucune faction. Ce n'est pas une
 * erreur à corriger en douce — c'est un poste dont personne n'a encore dit
 * quand il est tenu, et il faut que cela se voie. Il est compté à part
 * (`sansFaction`) plutôt que rangé d'office dans la première faction venue.
 *
 * POURQUOI `factionId` PASSE DEVANT L'HORAIRE, alors que les deux disent la
 * même chose sur les postes générés : parce qu'ils peuvent diverger. Si
 * quelqu'un corrige l'horaire d'un poste sans toucher à son affectation, c'est
 * l'affectation qui fait foi — elle est le fait du commandement, l'horaire
 * n'en est que la traduction en heures.
 *
 * @returns {string[]} identifiants de faction, dans l'ordre de la journée.
 */
export function factionsDuBarrage(barrage, creneauxTenus = null) {
  if (barrage?.factionId && factionParId(barrage.factionId)) return [barrage.factionId];
  if (barrage?.debut && barrage?.fin) {
    const activite = activiteDuBarrage(barrage, null);
    if (activite.source === 'horaire') {
      return FACTIONS.filter((f) => minutesChevauchement(activite.segments, segmentsDe(f)) > 0).map(
        (f) => f.id,
      );
    }
  }
  const tenus = creneauxTenus ? [...creneauxTenus] : [];
  if (!tenus.length) return [];
  return FACTIONS.filter((f) => tenus.includes(f.creneau)).map((f) => f.id);
}
