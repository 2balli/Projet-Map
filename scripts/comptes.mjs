#!/usr/bin/env node
/**
 * Gestion des comptes d'habilitation — quatre rangs (voir serveur/comptes.mjs) :
 * chef de brigade territoriale (unite), de compagnie (cie), de région (reg),
 * et administrateur (admin, aucun périmètre).
 *
 *   node scripts/comptes.mjs --initialiser
 *       Crée un compte de COMMANDEMENT par région et par compagnie d'après les
 *       couches livrées, tire un code par unité et AFFICHE la liste une seule fois.
 *   node scripts/comptes.mjs --initialiser --avec-bt --avec-admin
 *       Idem, plus un compte par brigade territoriale (~500) et un compte
 *       administrateur (identifiant "national", ou --admin-identifiant <nom>).
 *
 *   node scripts/comptes.mjs --lister
 *
 *   Ajouter une PERSONNE :
 *   node scripts/comptes.mjs --ajouter --matricule G12345 --nom "Cne Alaoui" --role saisie
 *               --rang cie --unite Marrakech [--code <code>]
 *   node scripts/comptes.mjs --ajouter --rang unite --unite Tanger   (chef de brigade territoriale)
 *   node scripts/comptes.mjs --ajouter --rang admin --unite national
 *
 *   roles : lecture (consultation) | saisie (ses propres repères) |
 *           commandement (tous ceux de son unité) — toujours `commandement`
 *           pour un compte `admin`, quel que soit --role.
 *
 *   node scripts/comptes.mjs --recoder --matricule <mat> [--code <code>]   remplace le code
 *   node scripts/comptes.mjs --supprimer --matricule <mat>
 *   node scripts/comptes.mjs --tous <code>                    impose le même code partout (TESTS UNIQUEMENT)
 *
 * Options communes :
 *   --donnees <dossier>   défaut : donnees-serveur/
 *   --couches <dossier>   défaut : public/layers/
 *
 * Les codes ne sont JAMAIS stockés en clair : seule une empreinte PBKDF2 l'est.
 * Un code perdu n'est pas récupérable — il se remplace (`--code`).
 */
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {
  chargerComptes,
  enregistrerComptes,
  definirCompte,
  supprimerCompte,
  listerComptes,
  genererCode,
  normaliserMatricule,
  matriculeDe,
  RANGS,
  ROLES,
} from '../serveur/comptes.mjs';
import { chargerCirconscriptions } from '../serveur/geo.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const drapeau = (nom) => process.argv.includes(`--${nom}`);
const valeur = (nom, defaut = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : defaut;
};

const DONNEES = resolve(valeur('donnees', join(ROOT, 'donnees-serveur')));

/**
 * Les contours servent à valider les noms d'unités. Deux emplacements possibles :
 * `public/layers/` dans le dépôt, `dist/layers/` dans le paquet intranet — le
 * même script sert donc au poste de développement et au serveur livré.
 */
const COUCHES = resolve(
  valeur('couches') ??
    [join(ROOT, 'public/layers'), join(ROOT, 'dist/layers')].find((d) => existsSync(d)) ??
    join(ROOT, 'public/layers')
);

const FICHIER = join(DONNEES, 'comptes.json');

const etat = chargerComptes(FICHIER);

/* ------------------------------------------------------------------ */

const tableau = (lignes) => lignes.map((l) => '  ' + l).join('\n');

function aide() {
  console.log(
    `\nComptes d'habilitation — carte tactique\n\n` +
      tableau([
        '--initialiser                    un compte de commandement par région et par compagnie',
        '  --avec-bt                        + un compte par brigade territoriale (~500)',
        '  --avec-admin                     + un compte administrateur (identifiant "national")',
        '--lister                         comptes existants (sans les codes)',
        '',
        'Ajouter une PERSONNE :',
        '  --ajouter --matricule G12345 --nom "Cne Alaoui" --role saisie',
        '            --rang <unite|cie|reg|admin> --unite <nom> [--code <code>]',
        '',
        '  roles : lecture (consultation) | saisie (ses propres repères) |',
        '          commandement (tous ceux de son unité) — toujours',
        '          "commandement" pour un compte admin.',
        '',
        '--recoder --matricule <mat> [--code <code>]   remplace le code',
        '--supprimer --matricule <mat>',
        '--purger-unites                  supprime les comptes région/compagnie/BT (garde les admins)',
        '--tous <code>                    impose le même code partout (TESTS UNIQUEMENT)',
        '',
        `--donnees <dossier>              ${DONNEES}`,
        `--couches <dossier>              ${COUCHES}`,
      ]) +
      '\n'
  );
}

/* ------------------------------ lister ----------------------------- */

if (drapeau('lister')) {
  const liste = listerComptes(etat);
  if (!liste.length) {
    console.log(`\nAucun compte dans ${FICHIER}.\n`);
    process.exit(0);
  }
  console.log(`\n${liste.length} compte(s) — ${FICHIER}\n`);
  console.log(
    tableau([
      `${'MATRICULE'.padEnd(16)} ${'NOM'.padEnd(26)} ${'RÔLE'.padEnd(14)} UNITÉ`,
      ...liste.map((c) =>
        `${(c.matricule ?? '?').padEnd(16)} ${(c.nom ?? '').padEnd(26)} ${(
          ROLES[c.role]?.fr ?? c.role ?? '?'
        ).padEnd(14)} ${RANGS[c.rang]?.fr ?? c.rang} ${c.unite}`.trimEnd()
      ),
    ])
  );
  console.log('\nLes codes ne sont pas affichables : ils ne sont pas stockés.\n');
  process.exit(0);
}

/* ----------------------------- tous ------------------------------- */

if (valeur('tous')) {
  const codeImpose = valeur('tous');
  let nb = 0;
  for (const c of Object.values(etat.comptes)) {
    /* Les champs de la personne sont repris tels quels : seul le code change. */
    await definirCompte(etat, {
      matricule: c.matricule,
      nom: c.nom,
      role: c.role,
      rang: c.rang,
      unite: c.unite,
      reg: c.reg,
      cie: c.cie,
      code: codeImpose,
    });
    nb++;
  }
  enregistrerComptes(FICHIER, etat);
  console.log('\n  ! Tous les comptes partagent désormais le même code.');
  console.log('    À ne garder que pour des essais : `--initialiser --remplacer`');
  console.log('    rétablit un code distinct par unité.');
  console.log(`\n${nb} compte(s) mis à jour avec le code : ${codeImpose}\n`);
  process.exit(0);
}

/* ---------------------------- purger ------------------------------- */

/**
 * Retire tous les comptes d'UNITÉ (région, compagnie, brigade), en gardant les
 * comptes `admin`. Sert à repartir d'un fichier propre après un changement de
 * schéma de matricule : les anciens comptes nommés d'après la seule unité
 * (« TANGER ») resteraient sinon à côté des nouveaux (« REG-TANGER »), et le
 * repli par nom d'unité continuerait de tomber sur eux.
 */
if (drapeau('purger-unites')) {
  const avant = Object.keys(etat.comptes).length;
  for (const [cle, c] of Object.entries(etat.comptes)) {
    if (c.rang !== 'admin') delete etat.comptes[cle];
  }
  const restants = Object.keys(etat.comptes).length;
  enregistrerComptes(FICHIER, etat);
  console.log(`\n${avant - restants} compte(s) d'unité supprimé(s).`);
  console.log(`${restants} compte(s) administrateur conservé(s).`);
  console.log(`\nRelancez --initialiser [--avec-bt] pour les recréer.\n`);
  process.exit(0);
}

/* --------------------------- initialiser --------------------------- */

if (drapeau('initialiser')) {
  if (!existsSync(COUCHES)) {
    console.error(`\nCouches introuvables : ${COUCHES}\nLancez d'abord la génération des couches.\n`);
    process.exit(1);
  }

  const index = chargerCirconscriptions(COUCHES);
  if (index.manquant.length) {
    console.error(`\nCouches manquantes : ${index.manquant.join(', ')}\n`);
    process.exit(1);
  }

  /**
   * Un compte de COMMANDEMENT par unité : c'est le chef, celui qui peut
   * corriger le travail de ses subordonnés. Les comptes individuels de saisie
   * s'ajoutent ensuite un par un (`--ajouter`), avec le nom de la personne —
   * les créer d'office serait inventer un effectif qu'on ne connaît pas.
   *
   * Le matricule vaut le nom de l'unité (ou l'identifiant, pour `admin`) :
   * c'est ce que le chef tape pour se connecter, et c'est ce que les codes
   * déjà distribués supposent.
   */
  const cibles = [
    ...[...index.region.keys()].map((unite) => ({
      rang: 'reg',
      unite,
      reg: unite,
      matricule: matriculeDe('reg', unite),
      nom: `Chef de région ${unite}`,
    })),
    ...[...index.compagnie.values()].map((c) => ({
      rang: 'cie',
      unite: c.nom,
      reg: c.reg,
      matricule: matriculeDe('cie', c.nom),
      nom: `Chef de compagnie ${c.nom}`,
    })),
  ];

  if (drapeau('avec-bt')) {
    cibles.push(
      ...[...index.bt.values()].map((u) => ({
        rang: 'unite',
        unite: u.nom,
        cie: u.cie,
        reg: u.reg,
        matricule: matriculeDe('unite', u.nom),
        nom: `Chef de brigade territoriale ${u.nom}`,
      }))
    );
  }

  if (drapeau('avec-admin')) {
    const identifiant = valeur('admin-identifiant', 'national');
    cibles.push({
      rang: 'admin',
      unite: identifiant,
      matricule: identifiant,
      nom: `Administrateur ${identifiant}`,
    });
  }

  const remplacer = drapeau('remplacer');
  const nouveaux = [];
  let conserves = 0;

  for (const cible of cibles) {
    if (etat.comptes[normaliserMatricule(cible.matricule)] && !remplacer) {
      conserves++;
      continue;
    }
    const code = await definirCompte(etat, {
      ...cible,
      role: 'commandement',
      code: genererCode(),
    });
    nouveaux.push({ ...cible, code });
  }

  enregistrerComptes(FICHIER, etat);

  console.log(`\n${nouveaux.length} compte(s) créé(s), ${conserves} conservé(s).`);
  console.log(`Fichier : ${FICHIER}\n`);

  if (nouveaux.length) {
    console.log('CODES — à distribuer aux chefs concernés, puis à détruire.');
    console.log("Ils ne sont affichés QU'UNE FOIS : rien ne permet de les relire.\n");
    const SIGLE = { reg: 'Région', cie: 'Cie', unite: 'BT', admin: 'Admin' };
    console.log(
      tableau(
        nouveaux.map(
          (c) => `${(SIGLE[c.rang] ?? c.rang).padEnd(7)} ${c.unite.padEnd(28)} ${c.code}`
        )
      )
    );
    console.log('');
  }

  if (conserves && !remplacer) {
    console.log('Les comptes déjà présents ont été conservés (--remplacer pour tout refaire).\n');
  }
  process.exit(0);
}

/* ------------------------ ajouter / recoder ------------------------ */

/**
 * `--recoder` et non `--code` : `--code` désigne UNE valeur (le code imposé).
 * Le même nom pour l'action et pour l'option rendait `--code --rang cie --unite X
 * --code XXX` ambigu — la valeur lue était le drapeau lui-même, et un code
 * aléatoire remplaçait silencieusement celui demandé.
 */
if (drapeau('ajouter') || drapeau('recoder')) {
  /**
   * Recoder n'exige que le matricule : la personne existe déjà, il n'y a
   * aucune raison de redonner son unité et son rôle — les redemander invitait
   * à les retaper de travers.
   */
  const existant = drapeau('recoder')
    ? etat.comptes[normaliserMatricule(valeur('matricule') ?? valeur('unite'))]
    : null;

  if (drapeau('recoder') && !existant) {
    console.error(`\nMatricule inconnu : « ${valeur('matricule') ?? valeur('unite')} »`);
    console.error('Listez les comptes avec --lister.\n');
    process.exit(1);
  }

  const rang = valeur('rang') ?? existant?.rang;
  const unite = valeur('unite') ?? existant?.unite;
  const role = valeur('role') ?? existant?.role ?? 'saisie';
  const matricule = valeur('matricule') ?? existant?.matricule ?? unite;
  const nom = valeur('nom') ?? existant?.nom ?? null;

  if (!RANGS[rang] || !unite) {
    console.error(`\n--rang (unite|cie|reg|admin) et --unite <nom> sont requis.\n`);
    aide();
    process.exit(1);
  }

  if (!ROLES[role]) {
    console.error(`\nRôle inconnu : « ${role} » — attendu : ${Object.keys(ROLES).join(' | ')}\n`);
    process.exit(1);
  }

  /** Un matricule déjà pris désignerait deux personnes : refus net. */
  if (drapeau('ajouter')) {
    const deja = etat.comptes[normaliserMatricule(matricule)];
    if (deja) {
      console.error(`\nMatricule déjà attribué : « ${matricule} » (${deja.nom}).`);
      console.error('Choisissez-en un autre, ou utilisez --recoder pour changer son code.\n');
      process.exit(1);
    }
  }

  /** Table de circonscriptions concernée par le rang, ou `null` pour `admin`
   *  qui n'en a pas — voir `serveur/geo.mjs`. */
  const tableDuRang = (index) => ({ unite: index.bt, cie: index.compagnie, reg: index.region })[rang] ?? null;

  /** Contrôle d'existence : un compte pour une unité inconnue ne servirait à
   *  rien, le contrôle de périmètre ne trouverait aucun contour. Sans objet
   *  pour `admin`, qui n'a pas de périmètre. */
  let reg = valeur('reg');
  let cie = valeur('cie');

  if (rang !== 'admin' && existsSync(COUCHES)) {
    const index = chargerCirconscriptions(COUCHES);
    const table = tableDuRang(index);
    const entree = table.get(unite);
    if (!entree) {
      const proches = [...table.keys()]
        .filter((n) => n.toLowerCase().includes(unite.toLowerCase().slice(0, 4)))
        .slice(0, 5);
      console.error(`\nUnité inconnue dans les couches : « ${unite} »`);
      if (proches.length) console.error(`Proches : ${proches.join(', ')}`);
      console.error('');
      process.exit(1);
    }
    reg = reg ?? (rang === 'reg' ? unite : (entree.reg ?? null));
    cie = cie ?? (rang === 'unite' ? entree.cie : null);
  }

  const code = await definirCompte(etat, { matricule, nom, role, rang, unite, reg, cie, code: valeur('code') });
  enregistrerComptes(FICHIER, etat);

  console.log(`\n${nom ?? matricule}`);
  console.log(`Matricule : ${normaliserMatricule(matricule)}`);
  console.log(`Rôle      : ${ROLES[rang === 'admin' ? 'commandement' : role].fr} — ${RANGS[rang].fr} ${unite}`);
  console.log(`Code      : ${code}`);
  console.log("\nTransmettez-le à l'intéressé : il n'est plus consultable ensuite.\n");
  process.exit(0);
}

/* ---------------------------- supprimer ---------------------------- */

if (drapeau('supprimer')) {
  /* `--unite` reste accepté : c'est le matricule des comptes d'unité créés
     par `--initialiser`. */
  const matricule = normaliserMatricule(valeur('matricule') ?? valeur('unite'));
  if (!matricule) {
    console.error('\n--matricule <mat> est requis.\n');
    process.exit(1);
  }
  const compte = etat.comptes[matricule];
  const fait = supprimerCompte(etat, matricule);
  enregistrerComptes(FICHIER, etat);
  console.log(
    fait
      ? `\nCompte supprimé : ${matricule}${compte?.nom ? ` (${compte.nom})` : ''}\n`
      : `\nAucun compte au matricule ${matricule}\n`
  );
  process.exit(fait ? 0 : 1);
}

aide();
