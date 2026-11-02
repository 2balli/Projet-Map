/**
 * LE TEMPS D'ACTIVITÉ D'UN BARRAGE — quand il est tenu, et non seulement où.
 *
 * POURQUOI CE MODULE EXISTE. L'optimisation ne raisonnait que sur la
 * géométrie : deux postes à 300 m étaient des doublons, quelle que soit
 * l'heure. C'est faux dès que deux brigades d'une même compagnie se relaient
 * sur le même axe — l'une de 06h à 12h, l'autre de 12h à 18h. Elles ne sont
 * jamais actives ensemble : c'est une bonne répartition, pas une redondance.
 *
 * D'OÙ VIENT L'HORAIRE — trois sources, dans cet ordre, toutes réelles :
 *
 *   1. `debut` / `fin` du barrage (voir `horaire()` dans serveur/depot.mjs) —
 *      la fenêtre d'activité déclarée sur sa fiche. Elle fait autorité quand
 *      elle est renseignée ;
 *   2. les CRÉNEAUX RÉELLEMENT TENUS, lus dans le dépôt des relèves (voir
 *      `CRENEAUX` dans serveur/elements.mjs : 0, 6, 12, 18). Un barrage relevé
 *      au créneau de 6 h est actif de 06h00 à 12h00, c'est le sens même du
 *      créneau ;
 *   3. rien — et alors on ne suppose RIEN d'avantageux : voir `INCONNU`.
 *
 * INCONNU NE VEUT PAS DIRE « JAMAIS ENSEMBLE ». Un barrage sans horaire connu
 * est traité comme actif en permanence, donc comme chevauchant tout le monde.
 * L'inverse aurait été commode et faux : une donnée manquante aurait protégé
 * le poste du moindre examen, et il aurait suffi de ne rien saisir pour sortir
 * de l'optimisation. Le manque est signalé à part, dans `donneesManquantes`.
 *
 * MINUIT EST UN CAS ORDINAIRE, PAS UNE EXCEPTION. Un créneau 22h00 → 02h00 est
 * découpé en deux segments — [22h00, 24h00[ et [00h00, 02h00[ — et tout le
 * reste du calcul ignore qu'il a jamais traversé minuit. Comparer les heures
 * comme des nombres sans ce découpage donne des chevauchements manqués : c'est
 * exactement ce que fait `chevauchentHoraires` dans
 * serveur/conflitsPlanification.mjs, qui rend `false` pour 22h00→02h00 contre
 * 00h00→06h00 alors que les deux se recouvrent de deux heures pleines.
 */

/** Une journée entière, en minutes. */
export const MINUTES_JOUR = 1440;

/** Minutes depuis minuit — `horaire()` garantit un `HH:MM` bien formé. */
export const versMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** `HH:MM` depuis des minutes, pour les libellés. */
const versHeure = (min) => {
  const m = ((min % MINUTES_JOUR) + MINUTES_JOUR) % MINUTES_JOUR;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
};

/**
 * ACTIF EN PERMANENCE — ce que vaut un horaire inconnu.
 *
 * Gelé (`Object.freeze`) parce qu'il est partagé par tous les barrages sans
 * horaire : une modification en place les toucherait tous d'un coup.
 */
export const TOUJOURS = Object.freeze([Object.freeze({ de: 0, a: MINUTES_JOUR })]);

/**
 * Un intervalle `HH:MM → HH:MM` en segments d'une journée, minuit géré.
 *
 * Une fin égale au début est lue comme un service de 24 h, et non comme une
 * plage vide : c'est la convention déjà retenue par la détection de conflits,
 * et la seule qui ait un sens sur le terrain.
 *
 * @returns {Array<{de:number, a:number}>} segments disjoints, bornes en minutes.
 */
export function segmentsDe(debut, fin) {
  if (!debut || !fin) return [];
  const d = versMinutes(debut);
  const f = versMinutes(fin);
  if (!Number.isFinite(d) || !Number.isFinite(f)) return [];
  if (d === f) return [{ de: 0, a: MINUTES_JOUR }];
  if (f > d) return [{ de: d, a: f }];
  /* La fin est « avant » le début : le service traverse minuit. */
  return [
    { de: d, a: MINUTES_JOUR },
    { de: 0, a: f },
  ];
}

/** Les segments d'un créneau de six heures identifié par son heure de début. */
export const segmentsDuCreneau = (heure) => [{ de: heure * 60, a: heure * 60 + 360 }];

/** Fusionne des segments qui se touchent — sans quoi on compterait deux fois. */
function fusionner(segments) {
  const tries = [...segments].sort((a, b) => a.de - b.de);
  const out = [];
  for (const s of tries) {
    const dernier = out[out.length - 1];
    if (dernier && s.de <= dernier.a) dernier.a = Math.max(dernier.a, s.a);
    else out.push({ de: s.de, a: s.a });
  }
  return out;
}

/** Durée totale couverte, en minutes. */
export const dureeMinutes = (segments) =>
  fusionner(segments).reduce((total, s) => total + (s.a - s.de), 0);

/** Minutes pendant lesquelles les deux dispositifs sont actifs EN MÊME TEMPS. */
export function minutesChevauchement(a, b) {
  const A = fusionner(a ?? []);
  const B = fusionner(b ?? []);
  let total = 0;
  for (const sa of A) {
    for (const sb of B) {
      const de = Math.max(sa.de, sb.de);
      const vers = Math.min(sa.a, sb.a);
      if (vers > de) total += vers - de;
    }
  }
  return total;
}

/**
 * CHEVAUCHEMENT EN POURCENTAGE — rapporté au PLUS COURT des deux.
 *
 * Deux créneaux de six heures identiques donnent 100 %. Un créneau de six
 * heures entièrement contenu dans un service de 24 h donne 100 % lui aussi, et
 * c'est juste : pendant toute son activité, l'autre est là. Rapporter à
 * l'union aurait donné 25 % et laissé croire à une séparation qui n'existe pas.
 */
export function pourcentChevauchement(a, b) {
  const commun = minutesChevauchement(a, b);
  if (!commun) return 0;
  const reference = Math.min(dureeMinutes(a), dureeMinutes(b));
  if (!reference) return 0;
  return Math.round((commun / reference) * 100);
}

/** « 06h00 → 12h00 », « 22h00 → 02h00 », « 24 h/24 ». */
export function libelleSegments(segments) {
  const fusion = fusionner(segments ?? []);
  if (!fusion.length) return 'horaire inconnu';
  if (dureeMinutes(fusion) >= MINUTES_JOUR) return '24 h/24';
  /* Un service à cheval sur minuit revient en deux segments dont l'un finit à
     24h00 et l'autre commence à 00h00 : on le recolle pour l'affichage. */
  if (
    fusion.length === 2 &&
    fusion[0].de === 0 &&
    fusion[fusion.length - 1].a === MINUTES_JOUR
  ) {
    return `${versHeure(fusion[1].de)} → ${versHeure(fusion[0].a)}`;
  }
  return fusion.map((s) => `${versHeure(s.de)} → ${versHeure(s.a)}`).join(', ');
}

/**
 * L'ACTIVITÉ D'UN BARRAGE — segments, source et libellé.
 *
 * `creneauxTenus` est l'ensemble des heures de créneau (0, 6, 12, 18) relevées
 * pour ce poste dans le dépôt des relèves. Il n'est consulté que si la fiche
 * ne porte pas d'horaire : ce que le chef a déclaré prime sur ce que
 * l'historique montre.
 *
 * @returns {{segments, source:'horaire'|'releves'|'inconnu', libelle, creneaux:number[]}}
 */
export function activiteDuBarrage(barrage, creneauxTenus = null) {
  if (barrage?.debut && barrage?.fin) {
    const segments = segmentsDe(barrage.debut, barrage.fin);
    if (segments.length) {
      return {
        segments,
        source: 'horaire',
        libelle: libelleSegments(segments),
        creneaux: [],
      };
    }
  }

  const heures = [...(creneauxTenus ?? [])].sort((x, y) => x - y);
  if (heures.length) {
    const segments = fusionner(heures.flatMap(segmentsDuCreneau));
    return {
      segments,
      source: 'releves',
      libelle: libelleSegments(segments),
      creneaux: heures,
    };
  }

  return {
    segments: TOUJOURS,
    source: 'inconnu',
    libelle: 'horaire inconnu',
    creneaux: [],
  };
}
