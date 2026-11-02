/**
 * EXIGENCES D'UN MOT DE PASSE — miroir de `refusMotDePasse` (serveur/comptes.mjs).
 *
 * MÊME RÈGLE QUE LE SERVEUR, dupliquée à dessein, comme `peutModifier` et
 * `perimetreImpose` : ici pour dire à la personne ce qui manque PENDANT qu'elle
 * tape, là-bas pour refuser. Si les deux divergent, c'est le serveur qui
 * tranche — jamais l'inverse, et le message qu'il renvoie s'affiche tel quel.
 *
 * Sans ce miroir, l'écran ne pourrait que renvoyer la saisie au serveur pour
 * savoir si elle convient : on découvrirait « trop court » après avoir tapé
 * deux fois le mot de passe et appuyé sur ENREGISTRER.
 *
 * `scripts/verifier-motdepasse.mjs` compare les deux implémentations sur des
 * milliers de saisies : elles ne peuvent pas divergir en silence.
 */

/** Longueur minimale. */
export const MOTDEPASSE_MIN = 8;

/**
 * Mots de passe refusés d'office — le temporaire et les suites évidentes.
 * MÊME LISTE, dans le même ordre, que celle du serveur.
 */
const REFUSES = [
  '123456',
  '1234567',
  '12345678',
  '123456789',
  'password',
  'motdepasse',
  'azerty',
  'azertyui',
  'qwerty',
  'qwertyui',
  '00000000',
  '11111111',
  'gendarmerie',
];

/**
 * Le mot de passe est-il acceptable ? `null` si oui, sinon la RAISON en clair.
 *
 * @param {string} clair
 * @returns {string|null}
 */
export function refusMotDePasse(clair) {
  const m = String(clair ?? '').normalize('NFC');

  if (m.length < MOTDEPASSE_MIN) {
    return `Trop court : ${MOTDEPASSE_MIN} caractères au minimum.`;
  }
  if (/^\s|\s$/.test(m)) {
    return 'Ne doit pas commencer ni finir par une espace.';
  }
  if (REFUSES.includes(m.toLowerCase())) {
    return 'Trop courant : choisissez autre chose.';
  }

  const natures = [
    /\p{Ll}/u.test(m),
    /\p{Lu}/u.test(m),
    /\p{N}/u.test(m),
    /[^\p{L}\p{N}]/u.test(m),
  ].filter(Boolean).length;
  if (natures < 2) {
    return 'Mélangez au moins deux sortes de caractères : lettres, majuscules, chiffres ou symboles.';
  }

  if (new Set(m).size < 4) {
    return 'Trop répétitif : il faut au moins quatre caractères différents.';
  }

  return null;
}

/**
 * LES EXIGENCES, ÉNONCÉES — et leur état pour la saisie en cours.
 *
 * Affichées en permanence, pas seulement en cas d'échec : on choisit mieux un
 * mot de passe quand on sait d'avance ce qui est demandé. Chaque ligne dit si
 * elle est satisfaite, de sorte que la personne voit son mot de passe devenir
 * acceptable à mesure qu'elle tape.
 *
 * @returns {Array<{texte: string, satisfaite: boolean}>}
 */
export function exigences(clair) {
  const m = String(clair ?? '').normalize('NFC');
  const natures = [
    /\p{Ll}/u.test(m),
    /\p{Lu}/u.test(m),
    /\p{N}/u.test(m),
    /[^\p{L}\p{N}]/u.test(m),
  ].filter(Boolean).length;

  return [
    { texte: `${MOTDEPASSE_MIN} caractères au minimum`, satisfaite: m.length >= MOTDEPASSE_MIN },
    {
      texte: 'deux sortes de caractères (lettres, majuscules, chiffres, symboles)',
      satisfaite: natures >= 2,
    },
    { texte: 'quatre caractères différents au moins', satisfaite: new Set(m).size >= 4 },
    {
      texte: 'pas un mot de passe courant',
      satisfaite: m.length > 0 && !REFUSES.includes(m.toLowerCase()),
    },
  ];
}
