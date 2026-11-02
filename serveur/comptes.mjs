/**
 * Comptes d'habilitation — une personne, un matricule.
 *
 * Ce qui est stocké : `matricule`, `nom`, `role`, `rang`/`unite`, et une
 * EMPREINTE du code (PBKDF2-SHA512, sel aléatoire par compte). Le code
 * lui-même n'est jamais écrit, ni journalisé, ni renvoyé par l'API : un
 * fichier de comptes volé ne permet donc pas de se connecter, seulement
 * d'attaquer les empreintes une par une, au coût de 210 000 itérations
 * chacune.
 *
 * Aucune dépendance externe : `node:crypto` suffit.
 */
import { randomBytes, randomInt, pbkdf2, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { ecrireJsonAtomique } from './ecritureAtomique.mjs';
import { promisify } from 'node:util';

const derive = promisify(pbkdf2);

/* ------------------------------------------------------------------ */
/* Paramètres cryptographiques                                        */
/* ------------------------------------------------------------------ */

const ITERATIONS = 210_000; // ~150 ms : négligeable à la connexion, coûteux à attaquer
const LONGUEUR = 64;
const DIGEST = 'sha512';

/**
 * Rangs reconnus. Un rang inconnu est refusé, jamais interprété.
 *
 * Voie hiérarchique, du périmètre le plus petit au plus grand :
 *   unite (Brigade Territoriale) < cie (compagnie) < reg (région)
 * `admin` est hors hiérarchie géographique : aucun périmètre, aucune
 * restriction — voir `controler` dans `serveur/geo.mjs` et `peutModifier`
 * dans `serveur/api.mjs`, les deux seuls endroits qui le distinguent.
 */
export const RANGS = {
  unite: {
    fr: 'Chef de brigade territoriale',
    ar: 'رئيس الدرك الترابي',
    niveau: 'unite',
    champ: 'bt',
    niveauOptimisation: 'brigade',
  },
  cie: {
    fr: 'Chef de compagnie',
    ar: 'رئيس السرية',
    niveau: 'compagnie',
    champ: 'cie',
    niveauOptimisation: 'compagnie',
  },
  reg: {
    fr: 'Chef de région',
    ar: 'رئيس الجهة',
    niveau: 'region',
    champ: 'reg',
    niveauOptimisation: 'region',
  },
  admin: {
    fr: 'Administrateur',
    ar: 'المسؤول',
    niveau: 'national',
    champ: null,
    niveauOptimisation: 'national',
  },
};

/**
 * PÉRIMÈTRE IMPOSÉ PAR LE PROFIL — la seule table qui en décide.
 *
 * Un chef de région, de compagnie ou de brigade n'a PAS de périmètre à
 * choisir : son rang le détermine entièrement. Le lui faire désigner n'était
 * pas seulement inutile, c'était faux — rien n'empêchait d'envoyer au serveur
 * une unité qui n'était pas la sienne, et le calcul d'OPTIMISATION obéissait.
 *
 * `champ` est le champ de rattachement du barrage (`bt`, `cie`, `reg` : voir
 * les repères de marquages.json). C'est par lui, et par lui seul, qu'on décide
 * si un poste relève du périmètre. `dansSonUnite` dans `serveur/api.mjs` et le
 * filtre d'OPTIMISATION lisent tous les deux ici, pour qu'il n'existe pas deux
 * idées du même périmètre.
 *
 * `admin` seul renvoie `null` : hors hiérarchie géographique, c'est le seul
 * profil pour lequel la question du périmètre se pose encore.
 *
 * @returns {{niveau: string, champ: string, unite: string}|null}
 */
export const perimetreDuRang = (session) => {
  const rang = RANGS[session?.rang];
  if (!rang?.champ) return null;
  return { niveau: rang.niveauOptimisation, champ: rang.champ, unite: session.unite };
};

/**
 * Rôles — ce que la personne a le droit de faire dans son périmètre.
 *
 * La distinction utile n'est pas « peut écrire ou non » mais « sur quoi » :
 * un gendarme saisit ce qu'il constate, un chef corrige ce que son unité a
 * produit. Sans ce partage, n'importe qui pouvait effacer le relevé d'un autre.
 * Un compte `admin` porte toujours `commandement` : son privilège vient de son
 * rang (aucun périmètre), pas de son rôle.
 */
export const ROLES = {
  lecture: {
    fr: 'Lecture seule',
    ar: 'قراءة فقط',
    ecrit: false,
    surAutrui: false,
  },
  saisie: {
    fr: 'Saisie',
    ar: 'تشوير',
    ecrit: true,
    /** Ne modifie/supprime que ce qu'il a lui-même créé. */
    surAutrui: false,
  },
  commandement: {
    fr: 'Commandement',
    ar: 'قيادة',
    ecrit: true,
    /** Corrige et supprime tout ce que son unité a produit. */
    surAutrui: true,
  },
};

/** Identifiant de connexion : le matricule, unique dans tout le fichier. */
export const normaliserMatricule = (m) =>
  String(m ?? '')
    .trim()
    .toUpperCase();

/**
 * Préfixe de matricule par rang.
 *
 * INDISPENSABLE : les noms d'unités ne sont PAS uniques d'un rang à l'autre.
 * « Tanger » désigne à la fois une région, une compagnie ET une brigade
 * territoriale — c'est le cas de 28 régions sur 28. Sans préfixe, les comptes
 * étant indexés par matricule, la compagnie écrasait la région créée juste
 * avant : se connecter en « Région Tanger » ouvrait en réalité la session de
 * la COMPAGNIE Tanger, avec son périmètre et ses droits.
 *
 * Le préfixe reste invisible à l'utilisateur : le formulaire envoie
 * {rang, unite} et le serveur retrouve le compte par ce couple (voir
 * `chercherParRangUnite`). Il n'a à connaître que son rang et son unité.
 */
export const PREFIXE_RANG = { unite: 'BT', cie: 'CIE', reg: 'REG' };

/**
 * Matricule d'un compte d'unité. `admin` n'a pas de périmètre et donc pas
 * d'homonyme possible : son identifiant reste tel quel.
 */
export const matriculeDe = (rang, unite) =>
  rang === 'admin'
    ? normaliserMatricule(unite)
    : normaliserMatricule(`${PREFIXE_RANG[rang] ?? rang}-${unite}`);

/**
 * Retrouve un compte par le couple (rang, unité) — ce que le formulaire de
 * connexion connaît réellement. Essaie d'abord le matricule calculé, puis
 * balaie les comptes : un compte créé à la main avec un matricule libre
 * (« G12345 ») reste ainsi joignable par son rang et son unité.
 */
export function chercherParRangUnite(etat, rang, unite) {
  if (!rang || !unite) return null;
  const direct = etat.comptes[matriculeDe(rang, unite)];
  if (direct) return direct;

  const cible = String(unite).trim().toUpperCase();
  return (
    Object.values(etat.comptes).find(
      (c) => c.rang === rang && String(c.unite ?? '').trim().toUpperCase() === cible
    ) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Fichier                                                            */
/* ------------------------------------------------------------------ */

export const VERSION_COMPTES = 3;

/**
 * Lit le fichier de comptes, en convertissant au passage l'ancien format.
 *
 * En version 1, un compte VALAIT une unité (`cie:Marrakech`) : on savait quelle
 * unité écrivait, jamais qui. La version 2 attache une personne — matricule,
 * nom, rôle. La conversion garde le sel et l'empreinte : les codes déjà
 * distribués continuent de fonctionner, le matricule devenant le nom de
 * l'unité (ou l'identifiant, pour un compte `admin`). Personne n'est mis
 * dehors par la mise à jour.
 */
export function chargerComptes(fichier) {
  if (!existsSync(fichier)) return { version: VERSION_COMPTES, comptes: {} };

  let brut;
  try {
    brut = JSON.parse(readFileSync(fichier, 'utf8'));
  } catch (err) {
    throw new Error(`Fichier de comptes illisible (${fichier}) : ${err.message}`);
  }

  const comptes = brut.comptes ?? {};

  /**
   * VERSION 3 — la nature du secret, inscrite sur chaque compte.
   *
   * La conversion N'INVALIDE AUCUNE EMPREINTE : elle ne fait qu'écrire ce qui
   * était implicite. Tous les comptes existants portaient un code engendré par
   * le service, comparé sans égard à la casse ; ils reçoivent donc
   * `secret: 'code'`, et rien d'autre ne change. Les codes déjà distribués
   * continuent de fonctionner à l'identique.
   *
   * `doitChanger` reste `false` : personne n'est mis dehors par une mise à
   * jour. Le drapeau se pose délibérément, compte par compte, avec
   * `scripts/mot-de-passe-initial.mjs`.
   */
  if ((brut.version ?? 1) >= 2) {
    let complets = 0;
    for (const c of Object.values(comptes)) {
      if (c.secret === undefined) {
        c.secret = SECRETS.CODE;
        complets++;
      }
      if (c.doitChanger === undefined) c.doitChanger = false;
    }
    return {
      version: VERSION_COMPTES,
      comptes,
      ...(complets ? { natureAjoutee: complets } : {}),
    };
  }

  const migres = {};
  for (const [cle, c] of Object.entries(comptes)) {
    const matricule = normaliserMatricule(c.unite ?? cle);
    migres[matricule] = {
      matricule,
      nom:
        c.rang === 'admin'
          ? `Administrateur ${c.unite}`
          : `Chef de ${RANGS[c.rang]?.fr?.toLowerCase() ?? c.rang} ${c.unite}`,
      role: 'commandement', // conserve le pouvoir qu'avait le compte d'unité
      rang: c.rang,
      unite: c.unite,
      reg: c.reg ?? null,
      cie: c.cie ?? null,
      sel: c.sel,
      empreinte: c.empreinte,
      iterations: c.iterations,
      cree: c.cree,
      migreDe: cle,
    };
  }

  return { version: VERSION_COMPTES, comptes: migres, migration: Object.keys(migres).length };
}

/**
 * Écriture atomique : on écrit à côté puis on renomme. Une coupure de courant
 * pendant l'enregistrement laisse donc l'ancien fichier intact au lieu d'un
 * fichier tronqué qui verrouillerait tout le monde dehors.
 */
export function enregistrerComptes(fichier, etat) {
  /* `mode: 0o600` — le fichier porte des empreintes de codes : lui seul est
     écrit en accès restreint, d'où l'option passée ici et nulle part ailleurs. */
  ecrireJsonAtomique(fichier, etat, 2, { mode: 0o600 });
}

/* ------------------------------------------------------------------ */
/* Codes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Alphabet sans caractères confondables (ni O/0, ni I/1/l) : un code lu au
 * téléphone ou recopié d'un papier ne se transforme pas en échec de connexion
 * inexplicable.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Code aléatoire lisible, du type `K7QF-3M2X-9BTR`. */
export function genererCode(groupes = 3, taille = 4) {
  const bloc = () =>
    Array.from({ length: taille }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return Array.from({ length: groupes }, bloc).join('-');
}

/**
 * Normalise la saisie d'un CODE : casse et tirets ne doivent pas faire échouer.
 *
 * RÉSERVÉ AUX CODES GÉNÉRÉS (`K7QF-3M2X-9BTR`), où c'est un service : un code
 * lu au téléphone ou recopié d'un papier se retrouve quelle que soit la casse.
 *
 * INTERDIT POUR UN MOT DE PASSE CHOISI, et c'est tout l'objet de la
 * distinction faite plus bas : appliquée à `Mon-Mot-2026!`, cette fonction
 * rend `MONMOT2026`. Elle détruirait la casse et les symboles, ferait de
 * « abc » et « ABC » le même secret, et réduirait un mot de passe de douze
 * caractères à un alphabet de trente-six.
 */
export const normaliserCode = (code) =>
  String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * LES DEUX NATURES DE SECRET.
 *
 * `code`       — engendré par le service, comparé sans égard à la casse.
 *                 C'est ce que portaient TOUS les comptes jusqu'ici.
 * `motdepasse` — choisi par la personne, comparé au caractère près, symboles
 *                 et accents compris.
 *
 * La nature est INSCRITE SUR LE COMPTE (`secret`) et non déduite : deux
 * comptes peuvent coexister dans les deux régimes, et c'est exactement ce
 * qu'exige la reprise — les 625 comptes déjà distribués gardent leur code,
 * ceux qui changent de mot de passe passent au régime strict, sans qu'aucune
 * empreinte existante soit invalidée.
 */
export const SECRETS = { CODE: 'code', MOTDEPASSE: 'motdepasse' };

/** La nature du secret d'un compte. Absente = `code`, le régime d'origine. */
const natureDe = (compte) => (compte?.secret === SECRETS.MOTDEPASSE ? SECRETS.MOTDEPASSE : SECRETS.CODE);

/**
 * Empreinte PBKDF2. `nature` décide de ce qui est dérivé : le code normalisé,
 * ou le mot de passe tel qu'il a été tapé.
 *
 * Le mot de passe est normalisé en NFC avant dérivation — sans quoi un « é »
 * composé et un « é » précomposé, identiques à l'œil, donneraient deux
 * empreintes différentes selon le clavier employé.
 */
async function empreinte(secret, sel, nature = SECRETS.CODE) {
  const clair =
    nature === SECRETS.MOTDEPASSE ? String(secret ?? '').normalize('NFC') : normaliserCode(secret);
  const brut = await derive(clair, sel, ITERATIONS, LONGUEUR, DIGEST);
  return brut.toString('base64');
}

/** Longueur minimale d'un code généré (1 = autorise des codes simples comme '12'). */
export const CODE_MIN = 1;

/**
 * EXIGENCES D'UN MOT DE PASSE CHOISI.
 *
 * Huit caractères et deux natures de caractères. Pas douze avec majuscule,
 * chiffre et symbole obligatoires : sur un poste de commandement, une règle
 * trop raide se solde par un mot de passe écrit sur un papier collé à l'écran,
 * ce qui est pire que tout ce qu'elle prétend empêcher.
 *
 * Le mot de passe temporaire est refusé explicitement : le laisser passer
 * comme « nouveau » annulerait tout l'intérêt de le faire changer.
 */
export const MOTDEPASSE_MIN = 8;

/**
 * Mots de passe refusés d'office — le temporaire et les suites évidentes.
 * Comparaison sans égard à la casse : « Azerty123 » ne vaut pas mieux que
 * « azerty123 ».
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
 * Le mot de passe est-il acceptable ? Rend `null` si oui, sinon la RAISON en
 * clair — l'utilisateur doit savoir quoi corriger, pas deviner.
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

  /* Deux natures de caractères parmi quatre : minuscules, majuscules, chiffres,
     symboles. La casse compte comme une nature à part. */
  const natures = [
    /\p{Ll}/u.test(m),
    /\p{Lu}/u.test(m),
    /\p{N}/u.test(m),
    /[^\p{L}\p{N}]/u.test(m),
  ].filter(Boolean).length;
  if (natures < 2) {
    return 'Mélangez au moins deux sortes de caractères : lettres, majuscules, chiffres ou symboles.';
  }

  /* Un seul caractère répété atteint la longueur sans rien apporter. */
  if (new Set(m).size < 4) {
    return 'Trop répétitif : il faut au moins quatre caractères différents.';
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Opérations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Crée ou remplace un compte. Retourne le code en clair UNE SEULE FOIS —
 * l'appelant doit le transmettre au chef concerné, il sera irrécupérable
 * ensuite.
 *
 * `reg`/`cie` : rattachement du chef de compagnie (`reg`) ou de brigade
 * territoriale (`cie`) à l'unité qui l'englobe — sans effet pour les autres
 * rangs, même principe que les autres champs saisissables mais pertinents
 * nulle part ailleurs.
 */
export async function definirCompte(
  etat,
  {
    matricule,
    nom,
    role = 'saisie',
    rang,
    unite,
    code,
    reg = null,
    cie = null,
    /**
     * LE SECRET DOIT-IL ÊTRE CHANGÉ À LA PREMIÈRE CONNEXION ?
     *
     * `true` pour un mot de passe temporaire distribué en clair — celui-ci
     * n'ouvre alors QUE l'écran de changement, et rien d'autre (le refus est
     * appliqué par le serveur, voir `api.mjs`).
     *
     * Par défaut `false` : un code engendré par le service n'a jamais été
     * connu de personne d'autre, il n'y a rien à remplacer.
     */
    doitChanger = false,
  }
) {
  if (!RANGS[rang]) throw new Error(`Rang inconnu : ${rang}`);
  if (!ROLES[role]) throw new Error(`Rôle inconnu : ${role} (${Object.keys(ROLES).join(', ')})`);
  if (!unite) throw new Error('Unité manquante.');

  const mat = normaliserMatricule(matricule || unite);
  if (!mat) throw new Error('Matricule manquant.');

  const clair = code ?? genererCode();
  if (normaliserCode(clair).length < CODE_MIN) {
    throw new Error(`Code trop court : ${CODE_MIN} caractères au minimum.`);
  }

  const sel = randomBytes(16).toString('base64');
  const existant = etat.comptes[mat];

  /** Un admin a toujours pleine autorité : son rôle n'est pas un choix. */
  const roleEffectif = rang === 'admin' ? 'commandement' : role;

  etat.comptes[mat] = {
    matricule: mat,
    nom: nom ?? existant?.nom ?? mat,
    role: roleEffectif,
    rang,
    unite,
    reg, // région de rattachement (chef de compagnie ou de brigade)
    cie, // compagnie de rattachement (chef de brigade territoriale uniquement)
    /* Un compte créé ici porte toujours un CODE : c'est le service qui le
       fabrique. Il ne passe au régime « mot de passe » que le jour où la
       personne en choisit un — voir `changerMotDePasse`. */
    secret: SECRETS.CODE,
    doitChanger: doitChanger === true,
    sel,
    empreinte: await empreinte(clair, sel, SECRETS.CODE),
    iterations: ITERATIONS,
    cree: existant?.cree ?? new Date().toISOString(),
    maj: new Date().toISOString(),
  };

  return clair;
}

/**
 * LA PERSONNE CHOISIT SON MOT DE PASSE.
 *
 * Trois effets, indissociables :
 *   1. une empreinte NEUVE, avec un sel neuf, au régime strict (casse et
 *      symboles conservés) ;
 *   2. `secret` passe à `motdepasse` — c'est ce qui fait que l'ancien code
 *      temporaire ne peut plus ouvrir le compte, puisqu'il n'est plus comparé
 *      de la même façon ET que l'empreinte a changé ;
 *   3. `doitChanger` retombe à `false` : la personne a fait ce qu'on lui
 *      demandait.
 *
 * Le sel est renouvelé volontairement. Le garder aurait suffi, mais un sel
 * neuf garantit qu'aucune empreinte précalculée sur l'ancien ne vaut plus
 * rien, même si le fichier avait été copié entre-temps.
 *
 * @throws si le mot de passe ne satisfait pas `refusMotDePasse`
 * @returns {Promise<void>}
 */
export async function changerMotDePasse(etat, matricule, nouveau) {
  const mat = normaliserMatricule(matricule);
  const compte = etat.comptes[mat];
  if (!compte) throw new Error('Compte inconnu.');

  const refus = refusMotDePasse(nouveau);
  if (refus) throw new Error(refus);

  const sel = randomBytes(16).toString('base64');
  compte.secret = SECRETS.MOTDEPASSE;
  compte.sel = sel;
  compte.empreinte = await empreinte(nouveau, sel, SECRETS.MOTDEPASSE);
  compte.iterations = ITERATIONS;
  compte.doitChanger = false;
  compte.motDePasseLe = new Date().toISOString();
  compte.maj = compte.motDePasseLe;
}

export function supprimerCompte(etat, matricule) {
  return delete etat.comptes[normaliserMatricule(matricule)];
}

/**
 * Vérifie un couple (matricule, code).
 *
 * Deux précautions constantes :
 *  - la comparaison passe par `timingSafeEqual`, pour ne pas laisser fuir
 *    l'empreinte par le temps de réponse ;
 *  - un compte inexistant fait quand même une dérivation, afin que « matricule
 *    inconnu » et « code faux » prennent le même temps — sans quoi l'API
 *    révélerait quels matricules ont un compte.
 */
export async function verifier(etat, matricule, code) {
  const compte = etat.comptes[normaliserMatricule(matricule)];

  if (!compte) {
    await empreinte(code, 'leurre-de-temps-constant', SECRETS.CODE);
    return null;
  }

  /* LA NATURE VIENT DU COMPTE, jamais de la requête : un client ne peut pas
     demander à être comparé au régime laxiste. */
  const nature = natureDe(compte);
  const candidat = Buffer.from(await empreinte(code, compte.sel, nature), 'base64');
  const attendu = Buffer.from(compte.empreinte, 'base64');

  if (candidat.length !== attendu.length || !timingSafeEqual(candidat, attendu)) return null;

  return {
    matricule: compte.matricule,
    nom: compte.nom,
    role: compte.role ?? 'commandement',
    rang: compte.rang,
    unite: compte.unite,
    reg: compte.reg,
    cie: compte.cie ?? null,
    /* Porté dans la session : c'est lui qui ferme l'application jusqu'au
       changement (voir `api.mjs`). */
    doitChanger: compte.doitChanger === true,
  };
}

export const listerComptes = (etat) =>
  Object.values(etat.comptes)
    .map(({ matricule, nom, role, rang, unite, reg, cie, cree }) => ({
      matricule,
      nom,
      role,
      rang,
      unite,
      reg,
      cie,
      cree,
    }))
    .sort(
      (a, b) =>
        a.rang.localeCompare(b.rang) ||
        a.unite.localeCompare(b.unite, 'fr') ||
        a.matricule.localeCompare(b.matricule)
    );
