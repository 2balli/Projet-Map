/**
 * DEUX VERSIONS DE L'APPLICATION, ET AUCUN MOYEN DE LES CONFONDRE.
 *
 * Le code est le MÊME dans les deux : mêmes écrans, même authentification,
 * mêmes permissions. Seules les DONNÉES diffèrent — l'une porte un jeu fictif
 * pour la démonstration, l'autre part vide et reçoit le dispositif réel.
 *
 * LE PROBLÈME QUE CE MODULE RÉSOUT. Deux dossiers de données côte à côte ne
 * protègent de rien : il suffit d'un `--donnees` mal recopié, d'un raccourci
 * dupliqué ou d'une archive dézippée au mauvais endroit pour qu'une séance de
 * démonstration écrive dans le dispositif réel. Et cela ne se verrait pas :
 * l'application est identique, l'écran ne dit rien, et les 1 124 barrages
 * fictifs se mêleraient aux vrais sans laisser de trace.
 *
 * LA PARADE : le mode est écrit DANS LE DOSSIER DE DONNÉES (`mode.json`), et
 * le service exige que ce qu'on lui déclare corresponde. Lancer le paquet de
 * démonstration sur les données réelles ne produit donc pas une erreur
 * silencieuse mais un REFUS DE DÉMARRER.
 *
 * Le marqueur voyage avec les données, jamais avec le code. C'est ce qui rend
 * la protection difficile à contourner par accident : copier le dossier copie
 * son mode, et un dossier sans marqueur est refusé plutôt que deviné.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const MODES = {
  DEMO: 'demo',
  PRODUCTION: 'production',
};

/** Le nom du marqueur, dans le dossier de données. */
export const FICHIER_MODE = 'mode.json';

const LIBELLES = {
  [MODES.DEMO]: 'DÉMONSTRATION — données fictives',
  [MODES.PRODUCTION]: 'PRODUCTION — données réelles',
};

/** Le mode, en clair, pour un message ou un bandeau. */
export const libelleMode = (mode) => LIBELLES[mode] ?? 'mode inconnu';

/**
 * Lit le marqueur d'un dossier de données.
 *
 * @param {string} dossier
 * @returns {{mode: string, cree?: string}|null} `null` si aucun marqueur
 */
export function lireMode(dossier) {
  const chemin = join(dossier, FICHIER_MODE);
  if (!existsSync(chemin)) return null;

  let brut;
  try {
    brut = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch (err) {
    throw new Error(`${FICHIER_MODE} illisible dans ${dossier} : ${err.message}`);
  }

  if (brut?.mode !== MODES.DEMO && brut?.mode !== MODES.PRODUCTION) {
    throw new Error(
      `${FICHIER_MODE} porte un mode inconnu : ${JSON.stringify(brut?.mode)} ` +
        `(attendu « ${MODES.DEMO} » ou « ${MODES.PRODUCTION} »)`,
    );
  }

  return brut;
}

/**
 * Écrit le marqueur. Employé par `scripts/preparer-versions.mjs`, jamais par
 * le service : le mode d'un dossier de données ne change pas à l'exécution.
 */
export function ecrireMode(dossier, mode, note = null) {
  if (mode !== MODES.DEMO && mode !== MODES.PRODUCTION) {
    throw new Error(`Mode inconnu : ${mode}`);
  }

  const contenu = {
    _lisezMoi: [
      'MODE DE CE DOSSIER DE DONNÉES — ne pas modifier à la main.',
      '',
      'Le service refuse de démarrer si le mode qu’on lui déclare (--mode)',
      'ne correspond pas à celui-ci. C’est ce qui empêche une séance de',
      'démonstration d’écrire dans le dispositif réel, et inversement.',
      '',
      mode === MODES.DEMO
        ? 'DÉMONSTRATION : les enregistrements sont FICTIFS. Ne jamais les'
        : 'PRODUCTION : les enregistrements sont RÉELS. Ne jamais y verser',
      mode === MODES.DEMO
        ? 'présenter comme réels, et ne jamais les verser en production.'
        : 'de données de démonstration.',
    ],
    mode,
    cree: new Date().toISOString(),
    ...(note ? { note } : {}),
  };

  writeFileSync(join(dossier, FICHIER_MODE), JSON.stringify(contenu, null, 2) + '\n', 'utf8');
  return contenu;
}

/**
 * LE CONTRÔLE QUE LE SERVICE FAIT AVANT DE SERVIR QUOI QUE CE SOIT.
 *
 * Rend le mode retenu, ou LÈVE — le service s'arrête alors, ce qui est le
 * comportement voulu : mieux vaut un service qui refuse de démarrer qu'un
 * service qui écrit au mauvais endroit.
 *
 * Trois situations :
 *
 *   — le dossier porte un marqueur ET on déclare le même mode : on sert ;
 *   — le dossier porte un marqueur et on en déclare un AUTRE : refus ;
 *   — le dossier n'a pas de marqueur : refus si l'on déclare un mode
 *     (l'intention ne peut pas être vérifiée), sinon on sert en prévenant.
 *
 * Le dernier cas ménage les dossiers de données antérieurs à ce mécanisme :
 * ils continuent de fonctionner, avec un avertissement qui dit quoi faire.
 *
 * @param {string} dossier
 * @param {string|null} declare  valeur de `--mode`, ou `null`
 * @returns {{mode: string|null, avertissement: string|null}}
 */
export function controlerMode(dossier, declare = null) {
  const marqueur = lireMode(dossier);

  if (marqueur && declare && marqueur.mode !== declare) {
    throw new Error(
      [
        '',
        '  ARRÊT — LE MODE DÉCLARÉ NE CORRESPOND PAS AUX DONNÉES.',
        '',
        `    demandé par --mode   : ${declare} (${libelleMode(declare)})`,
        `    trouvé dans le dossier : ${marqueur.mode} (${libelleMode(marqueur.mode)})`,
        `    dossier                : ${dossier}`,
        '',
        '  Le service ne démarre pas. C’est délibéré : servir quand même',
        '  reviendrait à laisser une séance de démonstration écrire dans le',
        '  dispositif réel — ou l’inverse — sans que rien ne le signale.',
        '',
        '  Vérifiez le dossier passé à --donnees.',
        '',
      ].join('\n'),
    );
  }

  if (!marqueur && declare) {
    throw new Error(
      [
        '',
        `  ARRÊT — AUCUN ${FICHIER_MODE} DANS LE DOSSIER DE DONNÉES.`,
        '',
        `    demandé par --mode : ${declare}`,
        `    dossier            : ${dossier}`,
        '',
        '  On ne peut pas vérifier que ce dossier est bien celui qu’on croit.',
        '  Le service ne démarre pas plutôt que de le supposer.',
        '',
        '  Pour marquer un dossier existant :',
        '      node scripts/preparer-versions.mjs --marquer <mode> --donnees <dossier>',
        '',
      ].join('\n'),
    );
  }

  if (!marqueur) {
    return {
      mode: null,
      avertissement:
        `Aucun ${FICHIER_MODE} : le mode de ce dossier est inconnu. ` +
        'Marquez-le avec `node scripts/preparer-versions.mjs --marquer <mode>`.',
    };
  }

  return { mode: marqueur.mode, avertissement: null };
}
