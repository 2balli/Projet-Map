/**
 * Gestion des comptes sur le poste du serveur (aucun mot de passe par défaut).
 *
 *   npm run comptes -- initialiser                               superadmin + un compte cr-<région> par région du jeu
 *   npm run comptes -- creer-admin <identifiant> "<Nom>"        superadmin (premier ou supplémentaire)
 *   npm run comptes -- creer-commandement <identifiant> "<Nom>" <reg-N>
 *   npm run comptes -- lister
 *   npm run comptes -- mot-de-passe <identifiant>
 *   npm run comptes -- desactiver <identifiant> | activer <identifiant>
 *   npm run comptes -- regions                                   identifiants des régions (reg-N)
 *
 * Le mot de passe est demandé au clavier (ou lu dans $MOT_DE_PASSE, pour un script) ; il n'est
 * jamais affiché ni journalisé, seule son empreinte scrypt est enregistrée. « initialiser » et
 * « mot-de-passe » posent un mot de passe TEMPORAIRE (6 caractères au moins) : l'utilisateur
 * doit le changer à sa première connexion (imposé par le serveur).
 * Dossier : $ETAT, sinon etat/ à la racine du projet. La console agit comme superadmin ;
 * chaque action est inscrite au journal d'audit et prend effet immédiatement.
 */
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Referentiel, outilsReferentiel } from '../serveur/referentiel.mjs';
import { Stockage } from '../serveur/stockage.mjs';
import { ETAT_VIDE, ErreurWorkflow, ROLES, comptePublic, comptesInitiaux, creerCompte, estAdmin, modifierCompte } from '../serveur/workflow.mjs';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stockage = new Stockage(process.env.ETAT || path.join(RACINE, 'etat'));
const CONSOLE = { id: 'console', role: 'superadmin', nom: 'console du serveur' };

function demander(question) {
  if (process.env.MOT_DE_PASSE) return Promise.resolve(process.env.MOT_DE_PASSE);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (v) => { rl.close(); r(v); }));
}

async function referentiel() {
  return outilsReferentiel(await new Referentiel(path.join(RACINE, 'donnees')).charger());
}

async function modifier(fn) {
  return stockage.verrou(async () => {
    const r = await fn(await stockage.lire('etat', ETAT_VIDE()));
    await stockage.ecrire('etat', r.etat);
    await stockage.journaliser(r.audit ?? []);
    return r;
  });
}

const [commande, ...args] = process.argv.slice(2);
try {
  if (commande === 'initialiser') {
    const ref = await referentiel();
    const prevus = comptesInitiaux(ref.regions.values());
    const motDePasse = await demander('Mot de passe temporaire commun (6 caractères au moins, à changer à la première connexion) : ');
    const r = await modifier(async (e) => {
      let etat = e;
      const audit = [];
      const crees = [];
      for (const p of prevus) {
        if (etat.comptes.some((c) => c.identifiant === p.identifiant)) continue; // déjà là : inchangé
        const acteur = etat.comptes.some((c) => estAdmin(c)) ? CONSOLE : null;
        const x = creerCompte(etat, acteur, { ...p, motDePasse, temporaire: true }, ref);
        etat = x.etat;
        audit.push(...x.audit);
        crees.push(x.compte);
      }
      return { etat, audit, crees };
    });
    for (const c of r.crees) console.log(`créé   ${c.identifiant.padEnd(22)} ${(c.regId ?? '').padEnd(7)} ${c.regId ? ref.nomRegion(c.regId) : 'accès complet'}`);
    console.log(`${r.crees.length} compte(s) créé(s), ${prevus.length - r.crees.length} déjà existant(s). Changement de mot de passe imposé à la première connexion.`);
  } else if (commande === 'creer-admin' || commande === 'creer-commandement') {
    const [identifiant, nom, regId] = args;
    if (!identifiant || !nom || (commande === 'creer-commandement' && !regId)) throw new ErreurWorkflow(400, 'arguments manquants (voir l’en-tête du script)');
    const motDePasse = await demander('Mot de passe (10 caractères au moins) : ');
    const role = commande === 'creer-admin' ? 'superadmin' : 'commandement';
    const r = await modifier(async (e) => creerCompte(e, e.comptes.some((c) => estAdmin(c)) ? CONSOLE : null, { identifiant, nom, role, regId, motDePasse }, await referentiel()));
    console.log(`Compte créé : ${r.compte.identifiant} (${ROLES[r.compte.role]}${r.compte.regId ? `, ${r.compte.regId}` : ''}).`);
  } else if (commande === 'lister') {
    const e = await stockage.lire('etat', ETAT_VIDE());
    if (!e.comptes.length) console.log('Aucun compte. Créez les comptes : npm run comptes -- initialiser');
    for (const c of e.comptes.map(comptePublic)) console.log(`${c.identifiant.padEnd(24)} ${ROLES[c.role].padEnd(32)} ${(c.regId ?? '').padEnd(8)} ${c.actif ? 'actif' : 'désactivé'}${c.doitChanger ? ' (mot de passe temporaire)' : ''}  ${c.nom}`);
  } else if (['mot-de-passe', 'desactiver', 'activer'].includes(commande)) {
    const e = await stockage.lire('etat', ETAT_VIDE());
    const c = e.comptes.find((x) => x.identifiant === String(args[0] ?? '').toLowerCase());
    if (!c) throw new ErreurWorkflow(404, 'compte introuvable');
    const champs = commande === 'mot-de-passe' ? { motDePasse: await demander('Mot de passe temporaire (6 caractères au moins) : ') } : { actif: commande === 'activer' };
    await modifier(async (x) => modifierCompte(x, CONSOLE, c.id, champs));
    console.log(`Compte ${c.identifiant} : ${commande === 'mot-de-passe' ? 'mot de passe réinitialisé (à changer à la prochaine connexion)' : commande === 'activer' ? 'activé' : 'désactivé'} — effet immédiat.`);
  } else if (commande === 'regions') {
    for (const r of (await referentiel()).regions.values()) console.log(`${r.id.padEnd(8)} ${r.nom}`);
  } else {
    console.log('Commandes : initialiser, creer-admin, creer-commandement, lister, mot-de-passe, desactiver, activer, regions (voir scripts/comptes.mjs).');
  }
} catch (erreur) {
  console.error(`Refusé : ${erreur.message}`);
  process.exitCode = 1;
}
