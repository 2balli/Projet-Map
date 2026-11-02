#!/usr/bin/env node
/**
 * CONTRÔLE DE LA NAVIGATION DES PARCOURS GUIDÉS.
 *
 * Toutes les sections de l'application passent par le même parcours
 * (`src/Parcours.jsx`). Une faute dans sa navigation ne se voit pas : un
 * SUIVANT qui « termine » à l'étape 4 sur 5 ferme le parcours au milieu, un
 * RETOUR qui recule sur la première étape rend un indice négatif et l'écran
 * blanchit, une barre d'avancement qui laisse sauter en avant fait valider des
 * choix qu'on n'a pas faits.
 *
 * Ce script éprouve la SEULE partie où un raisonnement peut se tromper :
 * `src/parcoursNavigation.js`. Le reste — dessiner un en-tête, empiler un
 * corps qui défile — ne se raisonne pas, il se constate.
 *
 * Balayage exhaustif de toutes les combinaisons de (nombre d'étapes, étape
 * courante, validité, occupation, présence d'une action), indices hors bornes
 * compris. On vérifie des PROPRIÉTÉS, pas des cas particuliers :
 *
 *   1. on ne sort jamais des bornes ;
 *   2. TERMINER n'arrive que sur la dernière étape ;
 *   3. une étape non franchissable, ou un appel en cours, n'avance jamais ;
 *   4. une étape porteuse d'une action ne termine ni n'avance d'elle-même ;
 *   5. RETOUR sur la première étape ANNULE, et son libellé le dit ;
 *   6. SUIVANT puis RETOUR ramène exactement où l'on était ;
 *   7. la barre d'avancement ne laisse jamais sauter en avant.
 *
 *   node scripts/verifier-parcours.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EFFETS,
  apresRetour,
  apresSuivant,
  atteignable,
  borner,
  creerSuiviOuverture,
  libelleRetour,
} from '../src/parcoursNavigation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let cas = 0;
const echecs = [];
const rate = (quoi, detail) => {
  echecs.push(`${quoi} — ${detail}`);
};

/* Bornes larges à dessein : 0 étape (parcours vide) et des indices très hors
   bornes, parce que c'est exactement ce qu'une section produit quand elle
   retire une étape sous les pieds de l'utilisateur. */
const TOTAUX = [0, 1, 2, 3, 5, 8];
const INDICES = [-99, -1, 0, 1, 2, 4, 7, 12, 999, NaN, undefined];
const BOOLS = [false, true];

for (const total of TOTAUX) {
  for (const indice of INDICES) {
    for (const valide of BOOLS) {
      for (const occupe of BOOLS) {
        for (const aAction of BOOLS) {
          cas++;

          const rang = borner(indice, total);
          const etat = { indice, total, valide, occupe, aAction };
          const s = apresSuivant(etat);
          const r = apresRetour({ indice, total, occupe });

          /* 1 — jamais hors bornes. */
          if (total > 0 && (rang < 0 || rang >= total)) {
            rate('borner sort des bornes', `total=${total} indice=${indice} -> ${rang}`);
          }
          for (const [nom, issue] of [
            ['SUIVANT', s],
            ['RETOUR', r],
          ]) {
            if (issue.effet === EFFETS.ALLER && (issue.indice < 0 || issue.indice >= total)) {
              rate(`${nom} mène hors bornes`, `total=${total} rang=${rang} -> ${issue.indice}`);
            }
          }

          /* 2 — TERMINER seulement sur la dernière étape. */
          if (s.effet === EFFETS.TERMINER && rang !== total - 1) {
            rate('TERMINER hors de la dernière étape', `total=${total} rang=${rang}`);
          }

          /**
           * 3 — BLOQUÉ : RIEN NE BOUGE. Mais « bloqué » a deux sens, et les
           * confondre a coûté cher.
           *
           * Cette règle s'écrivait `(!valide || occupe) => RIEN`, sans
           * distinguer une étape qu'on QUITTE d'une étape sur laquelle on
           * AGIT. Elle exigeait donc qu'une étape porteuse d'action reste
           * inerte tant qu'elle n'est pas valide — alors que son action est
           * justement ce qui la rend valide.
           *
           * L'OPTIMISATION en est morte à l'étape 3 sur 5 : « Les barrages
           * concernés » est valide quand un calcul existe, et son bouton
           * CALCULER était le seul moyen d'en produire un. Bouton grisé,
           * aucune issue. Ces 2 571 combinaisons passaient pendant ce
           * temps-là — la garde ne protégeait pas le parcours, elle protégeait
           * le défaut.
           *
           * `occupe` reste un verrou absolu : pendant un appel, rien, pas même
           * une action (sinon deux calculs se chevauchent).
           */
          if (occupe && s.effet !== EFFETS.RIEN) {
            rate('SUIVANT agit pendant un appel', `-> ${s.effet}`);
          }
          if (!valide && !aAction && !occupe && s.effet !== EFFETS.RIEN) {
            rate(
              'SUIVANT quitte une étape non valide',
              `valide=${valide} aAction=${aAction} -> ${s.effet}`,
            );
          }
          /* Une étape non valide ne doit JAMAIS mener ailleurs : agir, oui ;
             avancer ou terminer, non. */
          if (!valide && !occupe && (s.effet === EFFETS.ALLER || s.effet === EFFETS.TERMINER)) {
            rate('une étape non valide avance quand même', `-> ${s.effet}`);
          }
          if (occupe && r.effet !== EFFETS.RIEN) {
            rate('RETOUR agit pendant un appel', `-> ${r.effet}`);
          }

          /**
           * 4 — UNE ACTION AGIT, ET NE S'AUTO-AVANCE PAS.
           *
           * Sans condition sur `valide` : c'est le cœur de la correction
           * ci-dessus. Une étape qui porte une action agit dès qu'aucun appel
           * n'est en cours, valide ou non.
           */
          if (aAction && !occupe && total > 0 && s.effet !== EFFETS.AGIR) {
            rate(
              'une étape porteuse d’action n’agit pas',
              `total=${total} rang=${rang} valide=${valide} -> ${s.effet}`,
            );
          }

          /* 5 — première étape : RETOUR annule, et le libellé suit. */
          if (total > 0 && !occupe) {
            const attendu = rang === 0 ? EFFETS.FERMER : EFFETS.ALLER;
            if (r.effet !== attendu) {
              rate('RETOUR : effet inattendu', `total=${total} rang=${rang} -> ${r.effet}`);
            }
            const lib = libelleRetour({ indice, total });
            if ((rang === 0) !== (lib === 'ANNULER')) {
              rate('libellé de RETOUR contredit son effet', `rang=${rang} lib=${lib}`);
            }
          }

          /* 6 — aller puis revenir revient au même endroit. */
          if (s.effet === EFFETS.ALLER) {
            const retourApres = apresRetour({ indice: s.indice, total, occupe: false });
            if (retourApres.effet !== EFFETS.ALLER || retourApres.indice !== rang) {
              rate(
                'SUIVANT puis RETOUR ne revient pas au même point',
                `rang=${rang} -> ${s.indice} -> ${retourApres.indice}`,
              );
            }
          }

          /* 7 — la barre ne laisse jamais sauter en avant. */
          for (let i = -2; i <= total + 2; i++) {
            const ok = atteignable(i, indice, total, occupe);
            const devrait = !occupe && total > 0 && Number.isInteger(i) && i >= 0 && i < rang;
            if (ok !== devrait) {
              rate(
                'atteignable se trompe',
                `i=${i} rang=${rang} total=${total} occupe=${occupe} -> ${ok}`,
              );
            }
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* L'ÉTAPE « CALCULER » DE L'OPTIMISATION, telle qu'elle est déclarée  */
/* ------------------------------------------------------------------ */

/**
 * LE CAS CONCRET QUI A ÉCHAPPÉ AUX PROPRIÉTÉS GÉNÉRALES.
 *
 * Les balayages ci-dessus éprouvent des propriétés. Celui-ci rejoue la
 * situation exacte du panneau OPTIMISATION, avec les valeurs que l'étape 3
 * déclare vraiment (voir `cle: 'calcul'` dans src/OptimisationPanel.jsx) :
 *
 *     valide  : Boolean(rapport) && !reglagesModifies
 *     aAction : Boolean(aBesoinDeCalcul ? calculerPuisAvancer : undefined)
 *
 * Une propriété abstraite se lit mal ; ce tableau-ci se lit comme l'écran.
 * Les trois états qu'un utilisateur traverse, dans l'ordre :
 */
{
  const ETAPE_CALCUL = 2; // « Les barrages concernés », 3 sur 5
  const TOTAL_OPTIM = 5;

  const situations = [
    {
      nom: 'aucun calcul encore fait — le bouton dit CALCULER',
      valide: false,
      aAction: true,
      attendu: EFFETS.AGIR,
      pourquoi: 'sans cela l’étape est un cul-de-sac : le seul bouton est grisé',
    },
    {
      nom: 'calcul fait, réglages inchangés — le bouton dit SUIVANT',
      valide: true,
      aAction: false,
      attendu: EFFETS.ALLER,
      pourquoi: 'on passe à « Ce qu’on décide »',
    },
    {
      nom: 'réglages modifiés depuis le calcul — le bouton redit CALCULER',
      valide: false,
      aAction: true,
      attendu: EFFETS.AGIR,
      pourquoi: 'refaire la mesure plutôt que trancher sur des chiffres périmés',
    },
    {
      nom: 'calcul en cours',
      valide: false,
      aAction: true,
      occupe: true,
      attendu: EFFETS.RIEN,
      pourquoi: 'deux calculs simultanés se marcheraient dessus',
    },
  ];

  for (const s of situations) {
    cas++;
    const issue = apresSuivant({
      indice: ETAPE_CALCUL,
      total: TOTAL_OPTIM,
      valide: s.valide,
      occupe: s.occupe ?? false,
      aAction: s.aAction,
    });
    if (issue.effet !== s.attendu) {
      rate(
        `OPTIMISATION, étape 3 : ${s.nom}`,
        `attendu ${s.attendu}, obtenu ${issue.effet} — ${s.pourquoi}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Parcours complet : traverser 5 étapes dans les deux sens           */
/* ------------------------------------------------------------------ */

const TOTAL = 5;
let position = 0;
const visitees = [0];
for (let pas = 0; pas < 20; pas++) {
  const issue = apresSuivant({ indice: position, total: TOTAL });
  if (issue.effet === EFFETS.TERMINER) break;
  if (issue.effet !== EFFETS.ALLER) {
    rate('traversée interrompue', `pas=${pas} effet=${issue.effet}`);
    break;
  }
  position = issue.indice;
  visitees.push(position);
}
cas++;
if (visitees.join(',') !== '0,1,2,3,4') {
  rate('la traversée ne visite pas toutes les étapes', visitees.join(','));
}

const remontees = [position];
for (let pas = 0; pas < 20; pas++) {
  const issue = apresRetour({ indice: position, total: TOTAL });
  if (issue.effet === EFFETS.FERMER) break;
  if (issue.effet !== EFFETS.ALLER) {
    rate('remontée interrompue', `pas=${pas} effet=${issue.effet}`);
    break;
  }
  position = issue.indice;
  remontees.push(position);
}
cas++;
if (remontees.join(',') !== '4,3,2,1,0') {
  rate('la remontée ne repasse pas par toutes les étapes', remontees.join(','));
}

/* ------------------------------------------------------------------ */
/* UN PARCOURS REPART TOUJOURS DE L'ÉTAPE 1                           */
/* ------------------------------------------------------------------ */

/**
 * Le défaut éprouvé ici : un panneau refermé gardait son étape, et `borner`
 * ramenait l'indice périmé SUR LA DERNIÈRE — « Étape 2 sur 2 » à l'ouverture.
 *
 * On balaie toutes les séquences d'ouverture/fermeture jusqu'à huit gestes, et
 * l'on vérifie quatre propriétés :
 *
 *   1. jamais de remise à zéro au premier rendu (elle effacerait l'état qu'un
 *      lien direct vient de poser) ;
 *   2. jamais de remise à zéro quand `open` n'a pas changé (elle interdirait
 *      d'avancer) ;
 *   3. TOUJOURS une remise à zéro sur une transition — c'est le correctif ;
 *   4. après toute séquence finissant par une ouverture, l'étape vaut 0.
 */
{
  const AVANCES = [0, 1, 3, 7];

  for (let longueur = 1; longueur <= 8; longueur++) {
    /* Toutes les séquences de booléens de cette longueur. */
    for (let masque = 0; masque < 1 << longueur; masque++) {
      const sequence = Array.from({ length: longueur }, (_, i) => Boolean((masque >> i) & 1));

      for (const avance of AVANCES) {
        cas++;
        const suivi = creerSuiviOuverture();

        /* L'étape avance pendant que le panneau est ouvert, comme à l'usage. */
        let etape = 0;
        let precedent = null;
        let remisesAttendues = 0;

        sequence.forEach((open, i) => {
          const issue = suivi.observer(open);

          if (i === 0 && issue.recommencer) {
            rate('remise à zéro au premier rendu', `séquence ${sequence.join(',')}`);
          }
          if (i > 0 && open === precedent && issue.recommencer) {
            rate('remise à zéro sans changement', `séquence ${sequence.join(',')} rang ${i}`);
          }
          if (i > 0 && open !== precedent && !issue.recommencer) {
            rate('transition SANS remise à zéro', `séquence ${sequence.join(',')} rang ${i}`);
          }

          if (issue.recommencer) {
            etape = 0;
            remisesAttendues++;
          } else if (open) {
            /* On avance, puis on borne comme le fait le parcours. */
            etape = borner(etape + avance, 5);
          }
          precedent = open;
        });

        /* Propriété 4 : la dernière transition étant une OUVERTURE, on doit
           être à l'étape 1 — sauf si l'on a avancé après elle, ce que cette
           boucle ne fait pas dans le même tour. */
        const derniereTransition = sequence.findLastIndex(
          (o, i) => i > 0 && o !== sequence[i - 1],
        );
        if (derniereTransition === sequence.length - 1 && sequence.at(-1) === true && etape !== 0) {
          rate(
            'ouverture finale sans retour à l’étape 1',
            `séquence ${sequence.join(',')} avance ${avance} -> étape ${etape}`,
          );
        }
        void remisesAttendues;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* AUCUN INDICE D'ÉTAPE ÉCRIT À LA MAIN                               */
/* ------------------------------------------------------------------ */

/**
 * POURQUOI CE CONTRÔLE EXISTE — une faute commise deux fois dans la journée.
 *
 * Un indice d'étape codé en dur est juste jusqu'à ce qu'on ajoute ou déplace
 * une étape. Il devient alors faux SANS RIEN CASSER : c'est un nombre valide,
 * il mène simplement ailleurs. Deux occurrences réelles :
 *
 *   — `setEtape(1)` recopié d'une section où l'étape de choix reste dans le
 *     tableau vers une section où il était remplacé : choisir « Poser un
 *     repère » sautait « Quelle nature ? » et ouvrait une étape sans issue ;
 *   — en déplaçant l'étape de choix en tête des tableaux, CINQ sauts codés en
 *     dur se sont décalés d'un cran d'un seul coup.
 *
 * La parade est `indiceDe(etapes, 'cle')` : une clé ne se décale pas.
 *
 * Seul `0` reste toléré — il ne désigne pas une étape particulière mais « le
 * début », qui reste le début quoi qu'on ajoute.
 */
{
  const SOURCES = join(ROOT, 'src');
  const fichiers = [];
  (function balayer(dossier) {
    for (const nom of readdirSync(dossier)) {
      const chemin = join(dossier, nom);
      if (statSync(chemin).isDirectory()) balayer(chemin);
      else if (/\.jsx?$/.test(nom)) fichiers.push(chemin);
    }
  })(SOURCES);

  for (const f of fichiers) {
    const texte = readFileSync(f, 'utf8');
    texte.split('\n').forEach((ligne, i) => {
      /* On ignore les commentaires : ils CITENT la faute pour l'expliquer. */
      const nue = ligne.trim();
      if (nue.startsWith('*') || nue.startsWith('//') || nue.startsWith('/*')) return;

      for (const trouve of ligne.matchAll(/set(?:Etape|Indice)\(\s*(\d+)\s*\)/g)) {
        cas++;
        if (trouve[1] !== '0') {
          rate(
            'indice d’étape écrit à la main',
            `${f.replace(ROOT, '').replace(/\\/g, '/')}:${i + 1} — ${trouve[0]}` +
              ` (employez indiceDe(etapes, 'cle'))`,
          );
        }
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* « TERMINER » FERME-T-IL VRAIMENT LA SECTION ?                       */
/* ------------------------------------------------------------------ */

/**
 * LE DEUXIÈME DÉFAUT DU MÊME BOUTON, ET POURQUOI IL SE GARDE ICI.
 *
 * Trois panneaux écrivaient `onTerminer={tache ? quitterTache : onClose}`, et
 * `quitterTache` ne fermait rien : il remettait le parcours à l'étape 1. Après
 * avoir mené une tâche à son terme, appuyer sur TERMINER RAMENAIT DONC AU MENU
 * DU DÉBUT — le geste avait l'air ignoré, et l'on ne pouvait sortir que par la
 * croix.
 *
 * L'intention était d'enchaîner une seconde tâche sans rouvrir le panneau.
 * Mais ce n'est pas ce que le mot annonce, et RETOUR comme la barre
 * d'avancement le permettent déjà.
 *
 * Aucun contrôle ne pouvait le voir : la navigation rend bien `TERMINER`, et
 * `onTerminer` était bien branché. Ce qui manquait, c'est que le HANDLER
 * FERME. On le lit donc dans la source.
 *
 * LA RÈGLE. Pour chaque `onTerminer={…}` d'un panneau, on prend les BRANCHES de
 * l'expression (`a ? b : c` donne `b` et `c` ; `x` donne `x`) — jamais la
 * condition, qui n'est pas un gestionnaire. Chaque branche doit :
 *
 *   — être `onClose` ou `onFermer`, les deux fermetures du panneau ; ou
 *   — nommer une fonction locale dont le corps APPELLE l'une des deux.
 *
 * C'est ainsi que `NotificationsPanel` reste valide : `envoyer` transmet la
 * décision puis appelle `onFermer()`. Et c'est ainsi que `quitterTache`, qui
 * n'appelait que `recommencer()`, aurait été refusé.
 */
{
  const SRC = join(ROOT, 'src');
  const FERMETURES = ['onClose', 'onFermer'];

  /** Le contenu d'un `{…}` de JSX, accolades équilibrées. */
  const valeurDeProp = (texte, depart) => {
    let profondeur = 0;
    for (let i = depart; i < texte.length; i++) {
      if (texte[i] === '{') profondeur++;
      else if (texte[i] === '}') {
        profondeur--;
        if (profondeur === 0) return texte.slice(depart + 1, i);
      }
    }
    return null;
  };

  /** `a ? b : c` -> ['b','c'] ; `x` -> ['x']. La condition ne nous regarde pas. */
  const branches = (expr) => {
    const q = expr.indexOf('?');
    if (q === -1) return [expr.trim()];
    return expr
      .slice(q + 1)
      .split(':')
      .map((b) => b.trim());
  };

  /** Le corps d'un `const nom = …` jusqu'à la prochaine déclaration de même rang. */
  const corpsDe = (texte, nom) => {
    const declaration = new RegExp(`const\\s+${nom}\\s*=`);
    const trouve = texte.match(declaration);
    if (!trouve) return null;
    const debut = trouve.index;
    /* Fenêtre volontairement généreuse : on cherche un APPEL, pas à analyser
       la portée. Un faux positif ici serait une garde trop permissive, jamais
       une garde qui bloque à tort. */
    const suite = texte.slice(debut, debut + 1200);
    const fin = suite.search(/\n\s*(?:const|function|return)\s/);
    return fin === -1 ? suite : suite.slice(0, fin);
  };

  for (const nom of readdirSync(SRC)) {
    if (!nom.endsWith('.jsx') || nom === 'Parcours.jsx') continue;
    const chemin = join(SRC, nom);
    const texte = readFileSync(chemin, 'utf8');
    if (!texte.includes('<Parcours')) continue;

    const marque = texte.indexOf('onTerminer=');
    cas++;
    if (marque === -1) {
      rate(
        'un panneau à parcours ne branche pas TERMINER',
        `${nom} — le bouton final serait inerte`,
      );
      continue;
    }

    const expr = valeurDeProp(texte, texte.indexOf('{', marque));
    if (expr === null) {
      rate('onTerminer illisible', nom);
      continue;
    }

    for (const branche of branches(expr)) {
      cas++;
      if (FERMETURES.includes(branche)) continue;

      const corps = corpsDe(texte, branche);
      if (!corps) {
        rate(
          'TERMINER mène à quelque chose d’introuvable',
          `${nom} — « ${branche} » n'est ni onClose/onFermer ni une fonction locale`,
        );
        continue;
      }
      if (!FERMETURES.some((f) => corps.includes(`${f}(`))) {
        rate(
          'TERMINER ne ferme pas la section',
          `${nom} — « ${branche} » n'appelle ni onClose() ni onFermer() ` +
            '(un retour au menu n’est pas une fin)',
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* LE BOUTON SUIT-IL ENCORE LA REGLE PROUVEE ?                        */
/* ------------------------------------------------------------------ */

/**
 * TOUT CE QUI PRECEDE PROUVE `apresSuivant`, QUI EST DU CALCUL PUR.
 *
 * Or ce n'est pas `apresSuivant` qui grise le bouton : c'est l'attribut
 * `disabled` de Parcours.jsx. Les deux peuvent divergier, et ils ont divergé —
 * la navigation autorisait l'action, le bouton restait grise, et l'OPTIMISATION
 * s'arretait a l'etape 3 sur 5. Prouver la regle sans verifier que le bouton
 * l'applique ne protege rien.
 *
 * On lit donc la source. Trois exigences, minimales et stables :
 *
 *   — `disabled` s'appuie sur `actif`, et sur rien d'autre : recalculer la
 *     condition sur place est exactement ce qui a permis la divergence ;
 *   — `actif` tient compte de `aAction`, sans quoi une etape porteuse d'action
 *     redeviendrait inerte ;
 *   — `actif` tient compte de `occupe`, qui reste un verrou absolu.
 */
{
  const source = readFileSync(join(ROOT, 'src', 'Parcours.jsx'), 'utf8');
  /* On écarte les commentaires : celui qui explique la faute la CITE. */
  const sansCommentaires = source
    .split('\n')
    .filter((l) => {
      const nue = l.trim();
      return !nue.startsWith('*') && !nue.startsWith('//') && !nue.startsWith('/*');
    })
    .join('\n');

  cas++;
  const attribut = sansCommentaires.match(/disabled=\{([^}]*)\}/g) ?? [];
  const principal = attribut.find((a) => a.includes('actif'));
  if (!principal) {
    rate(
      'le bouton principal ne s’appuie pas sur `actif`',
      `disabled trouvés : ${attribut.join(' , ') || 'aucun'}`,
    );
  }

  cas++;
  const declaration = sansCommentaires.match(/const actif\s*=\s*([^;]+);/);
  if (!declaration) {
    rate('`actif` n’est pas déclaré dans Parcours.jsx');
  } else {
    if (!/aAction/.test(declaration[1])) {
      rate('`actif` ignore `aAction` — une étape porteuse d’action serait inerte', declaration[1].trim());
    }
    cas++;
    if (!/occupe/.test(declaration[1])) {
      rate('`actif` ignore `occupe` — le bouton resterait vif pendant un appel', declaration[1].trim());
    }
  }
}

/* ------------------------------------------------------------------ */

console.log('');
console.log(`Combinaisons éprouvées      : ${cas.toLocaleString('fr-FR')}`);
console.log(`Fautes de navigation        : ${echecs.length}`);

if (echecs.length) {
  console.error('');
  for (const e of echecs.slice(0, 12)) console.error(`  ${e}`);
  if (echecs.length > 12) console.error(`  … et ${echecs.length - 12} autre(s)`);
  console.error('\nLa navigation des parcours est en défaut.\n');
  process.exit(1);
}

console.log('\nSUIVANT, RETOUR, ANNULER et TERMINER font ce qu’ils annoncent.\n');
