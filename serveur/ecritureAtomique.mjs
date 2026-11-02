/**
 * Écriture atomique d'un fichier JSON — écrire à côté, puis renommer.
 *
 * Le renommage est l'opération qui rend l'écriture atomique : le fichier final
 * n'existe jamais à moitié écrit, même si le poste s'arrête au mauvais moment.
 *
 * POURQUOI UNE RÉESSAI, ET PAS UN SIMPLE `renameSync`
 * ---------------------------------------------------
 * Sous Windows, un renommage échoue en `EPERM` / `EACCES` / `EBUSY` dès qu'un
 * autre processus tient le fichier ouvert, ne serait-ce qu'un instant : un
 * antivirus qui inspecte le `.tmp` à peine écrit, l'indexeur de recherche, ou
 * la synchronisation d'un dossier (le projet est sur le Bureau, lui-même
 * synchronisé). Ce verrou dure quelques dizaines de millisecondes et disparaît
 * de lui-même.
 *
 * Le comportement observé était brutal : la création d'un barrage remontait à
 * l'utilisateur une erreur 400 illisible — « EPERM: operation not permitted,
 * rename 'alertes.json.tmp' -> 'alertes.json' » — alors que rien n'était en
 * cause côté métier, et que réessayer aurait suffi. Le `.tmp` restait par
 * ailleurs sur le disque.
 *
 * On réessaie donc brièvement, en attendant de plus en plus longtemps. Si le
 * verrou persiste au-delà de la dernière tentative, l'erreur remonte : mieux
 * vaut un échec franc qu'une donnée qu'on croit enregistrée.
 */
import { writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * UN NOM PROVISOIRE UNIQUE PAR ÉCRITURE — et non un par fichier.
 *
 * LE DÉFAUT QUE CECI SUPPRIME, mesuré : le provisoire s'appelait
 * `<fichier>.tmp`, donc DEUX écritures simultanées du même fichier
 * s'écrasaient l'une l'autre et se disputaient le même renommage. Le second
 * renommage échouait en EPERM — non pas à cause d'un antivirus, mais à cause
 * du premier — et partait dans la boucle de réessai, qui est SYNCHRONE : elle
 * bloque la boucle d'événements, donc TOUT le serveur.
 *
 * Quarante saisies simultanées prenaient ainsi 12 secondes, là où une seule
 * prend 1 milliseconde. C'est exactement ce qui arrive à 06:00, 12:00 et
 * 18:00, quand les brigades relèvent en même temps : l'application aurait
 * paru figée au moment le plus chargé de la journée.
 *
 * Le compteur suffit à distinguer deux écritures du même processus ; le
 * numéro de processus distingue deux services qui partageraient un dossier.
 */
let compteurEcriture = 0;

/** Attentes successives, en millisecondes. Environ 600 ms au total. */
const ATTENTES = [5, 10, 20, 40, 80, 150, 300];

/** Codes d'erreur d'un verrou passager — tout autre code est une vraie panne. */
const VERROUS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Pause synchrone. Ces écritures sont synchrones de bout en bout ; introduire
 * ici de l'asynchrone obligerait à revoir tous les appelants, et le dépôt tient
 * en mémoire — quelques centaines de millisecondes au pire, sur une opération
 * déjà rare, ne se remarquent pas.
 */
const patienter = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Écrit `donnees` en JSON dans `fichier`, de façon atomique.
 *
 * `indentation` : espaces d'indentation (0 = compact).
 * `options`     : passées telles quelles à `writeFileSync` — sert au fichier
 *                 des comptes, écrit en `mode: 0o600`.
 */
export function ecrireJsonAtomique(fichier, donnees, indentation = 2, options = undefined) {
  mkdirSync(dirname(resolve(fichier)), { recursive: true });
  /* Unique : voir `compteurEcriture` ci-dessus. Deux écritures concurrentes
     ne se marchent plus dessus, et la boucle de réessai redevient ce qu'elle
     devait être — un filet contre un verrou d'antivirus, pas le régime
     normal. */
  const tmp = `${fichier}.${process.pid}.${++compteurEcriture}.tmp`;
  writeFileSync(tmp, JSON.stringify(donnees, null, indentation), options);

  let dernier = null;
  for (let essai = 0; essai <= ATTENTES.length; essai++) {
    try {
      renameSync(tmp, fichier);
      return;
    } catch (err) {
      dernier = err;
      if (!VERROUS.has(err.code) || essai === ATTENTES.length) break;
      patienter(ATTENTES[essai]);
    }
  }

  /* Échec définitif : on retire le provisoire pour ne pas laisser traîner un
     fichier à moitié à jour que personne ne saurait interpréter. */
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* Si même la suppression est verrouillée, il n'y a plus rien à tenter. */
  }
  throw dernier;
}
