/**
 * API du serveur local (/api/…), sans dépendance. Chaque requête est authentifiée (cookie de
 * session HttpOnly) et chaque opération vérifie le rôle et la région CÔTÉ SERVEUR (workflow.mjs) ;
 * l'interface ne fait que refléter ces droits. Les écritures exigent l'en-tête
 * X-Requested-With (pas de formulaire intersite) et un corps JSON (2 Mo au plus).
 *
 * `api.garde` protège aussi les fichiers statiques : sans session, seule la page de connexion
 * (et ses ressources) est servie ; un mot de passe temporaire n'ouvre que le changement de mot
 * de passe ; un compte régional ne reçoit que les données de sa région (filtres.mjs).
 */
import { Sessions, Tentatives, cookieEfface, cookieSession, hacherMotDePasse, lireCookie, verifierMotDePasse } from './auth.mjs';
import { FiltreRegional, emprise } from './filtres.mjs';
import { Referentiel, outilsReferentiel } from './referentiel.mjs';
import { Stockage } from './stockage.mjs';
import {
  ETAT_VIDE, ErreurWorkflow, ROLES, STATUTS, assigner, baragesAvecChangements, changementsApprouves, changerMotDePasse, commandementsPour,
  comptePublic, conflitsVisibles, creerCompte, creerConflits, decider, estAdmin, lireConflit, marquerEnCours, marquerResolu, modifierCompte,
  soumettreProposition,
} from './workflow.mjs';

const ENTETE_CSRF = 'x-requested-with';
const VALEUR_CSRF = 'maroc-carte';
const TAILLE_MAX = 2 * 1024 * 1024;
const EMPREINTE_FACTICE = hacherMotDePasse(Math.random().toString(36));
export const PAGE_CONNEXION = '/connexion.html';
/** Navigation vers une page (redirigée) plutôt que requête de données (refusée en 401/403). */
const estPage = (req, chemin) => chemin === '/' || chemin.endsWith('.html') || /\btext\/html\b/.test(req.headers.accept ?? '');
/** Routes encore ouvertes tant que le mot de passe temporaire n'est pas changé. */
const PENDANT_CHANGEMENT = new Set(['/api/moi', '/api/session', '/api/mot-de-passe', '/api/deconnexion']);

const json = (res, statut, corps, entetes = {}) => {
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...entetes });
  res.end(JSON.stringify(corps));
};

function lireCorps(req) {
  return new Promise((resolve, reject) => {
    let taille = 0;
    const morceaux = [];
    req.on('data', (m) => {
      taille += m.length;
      if (taille > TAILLE_MAX) {
        reject(new ErreurWorkflow(413, 'requête trop volumineuse'));
        req.destroy();
      } else morceaux.push(m);
    });
    req.on('end', () => {
      if (!morceaux.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8')));
      } catch {
        reject(new ErreurWorkflow(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {{ dossierEtat: string, dossierDonnees: string, secure?: boolean }} options
 * @returns {(req, res) => Promise<boolean>}  true si la requête relevait de l'API
 */
export function creerApi({ dossierEtat, dossierDonnees, secure = false, sessions = new Sessions(), tentatives = new Tentatives() }) {
  const stockage = new Stockage(dossierEtat);
  const referentiel = new Referentiel(dossierDonnees);
  const etat = () => stockage.lire('etat', ETAT_VIDE());
  const ref = async () => outilsReferentiel(await referentiel.charger());

  const filtre = new FiltreRegional(dossierDonnees, referentiel);

  async function acteur(req, options) {
    const compteId = sessions.lire(lireCookie(req.headers.cookie), options);
    if (!compteId) return null;
    const c = (await etat()).comptes.find((x) => x.id === compteId);
    return c?.actif ? c : null;
  }

  /** Région d'un compte régional, pour l'interface : id, nom, emprise (cadrage de la carte). */
  async function regionDe(compte) {
    if (!compte?.regId) return null;
    const r = (await referentiel.charger()).regions.get(compte.regId);
    return r ? { id: r.id, nom: r.nom, emprise: emprise(r.geometrie) } : { id: compte.regId, nom: compte.regId, emprise: null };
  }
  const profil = async (c) => ({ compte: comptePublic(c), region: await regionDe(c), doitChanger: c.doitChanger === true });
  const cookie = (jeton) => cookieSession(jeton, { secure, maxAgeS: Math.round(sessions.maximumMs / 1000) });

  /** Opération qui modifie l'état : une à la fois, puis écriture et journal d'audit. */
  const modifier = (fn) => stockage.verrou(async () => {
    const r = await fn(await etat());
    await stockage.ecrire('etat', r.etat);
    await stockage.journaliser(r.audit ?? []);
    return r;
  });

  const routes = [
    ['POST', /^\/api\/connexion$/, async ({ req, corps, res }) => {
      const identifiant = String(corps.identifiant ?? '').trim().toLowerCase();
      const cle = `${identifiant}|${req.socket.remoteAddress}`;
      if (tentatives.bloque(cle)) throw new ErreurWorkflow(429, 'trop de tentatives : réessayez dans quelques minutes');
      const c = (await etat()).comptes.find((x) => x.identifiant === identifiant);
      // Identifiant inconnu : le mot de passe est quand même vérifié (même durée de réponse).
      const bon = verifierMotDePasse(corps.motDePasse ?? '', c?.empreinte ?? EMPREINTE_FACTICE);
      if (!c || !c.actif || !bon) {
        tentatives.echec(cle);
        await stockage.journaliser([{ date: new Date().toISOString(), action: 'connexion-refusee', identifiant }]);
        throw new ErreurWorkflow(401, 'identifiant ou mot de passe incorrect');
      }
      tentatives.reussite(cle);
      const jeton = sessions.creer(c.id);
      await stockage.journaliser([{ date: new Date().toISOString(), acteurId: c.id, acteurNom: c.nom, action: 'connexion' }]);
      return { statut: 200, corps: await profil(c), entetes: { 'Set-Cookie': cookie(jeton) }, res };
    }, { public: true }],
    ['POST', /^\/api\/mot-de-passe$/, async ({ req, moi, corps }) => {
      const r = await modifier(async (e) => changerMotDePasse(e, moi, corps, verifierMotDePasse));
      // Nouveau mot de passe : toutes les sessions du compte sont fermées, une nouvelle est ouverte ici.
      sessions.supprimer(lireCookie(req.headers.cookie));
      sessions.supprimerCompte(moi.id);
      return { corps: await profil(r.compte), entetes: { 'Set-Cookie': cookie(sessions.creer(moi.id)) } };
    }],
    ['POST', /^\/api\/deconnexion$/, async ({ req, moi }) => {
      sessions.supprimer(lireCookie(req.headers.cookie));
      if (moi) await stockage.journaliser([{ date: new Date().toISOString(), acteurId: moi.id, acteurNom: moi.nom, action: 'deconnexion' }]);
      return { corps: { ok: true }, entetes: { 'Set-Cookie': cookieEfface() } };
    }, { public: true }],
    ['GET', /^\/api\/moi$/, async ({ moi }) => ({ corps: { ...(await profil(moi)), roles: ROLES, statuts: STATUTS } })],
    // Contrôle périodique de la page : ne prolonge pas la session (seule l'activité réelle compte).
    ['GET', /^\/api\/session$/, async ({ req }) => ({ corps: { restantS: Math.round(sessions.restant(lireCookie(req.headers.cookie)) / 1000) } }), { consultation: true }],

    // Comptes (administrateur)
    ['GET', /^\/api\/comptes$/, async ({ moi }) => {
      if (!estAdmin(moi)) throw new ErreurWorkflow(403, 'réservé au superadmin');
      return { corps: { comptes: (await etat()).comptes.map(comptePublic) } };
    }],
    ['POST', /^\/api\/comptes$/, async ({ moi, corps }) => {
      // Mot de passe choisi par le superadmin : temporaire, à changer à la première connexion.
      const r = await modifier(async (e) => creerCompte(e, moi, { ...corps, role: corps.role ?? 'commandement', temporaire: true }, await ref()));
      return { statut: 201, corps: { compte: comptePublic(r.compte) } };
    }],
    ['POST', /^\/api\/comptes\/([\w-]+)$/, async ({ moi, corps, params }) => {
      const r = await modifier(async (e) => modifierCompte(e, moi, params[0], corps));
      if (r.deconnecter) sessions.supprimerCompte(r.compte.id);
      return { corps: { compte: comptePublic(r.compte) } };
    }],
    ['GET', /^\/api\/commandements$/, async ({ moi, url }) => {
      if (!estAdmin(moi)) throw new ErreurWorkflow(403, 'réservé au superadmin');
      const regId = url.searchParams.get('regId');
      const e = await etat();
      return { corps: { commandements: (regId ? commandementsPour(e, regId) : e.comptes.filter((c) => c.role === 'commandement')).map(comptePublic) } };
    }],

    // Conflits
    ['GET', /^\/api\/conflits$/, async ({ moi }) => ({ corps: { conflits: conflitsVisibles(await etat(), moi, await ref()) } })],
    ['GET', /^\/api\/conflits\/([\w-]+)$/, async ({ moi, params }) => ({ corps: { conflit: lireConflit(await etat(), moi, params[0], await ref()) } })],
    ['POST', /^\/api\/conflits$/, async ({ moi, corps }) => {
      const r = await modifier(async (e) => creerConflits(e, moi, corps, await ref()));
      return { statut: 201, corps: { crees: r.crees, ignores: r.ignores } };
    }],
    ['POST', /^\/api\/conflits\/assigner$/, async ({ moi, corps }) => {
      await modifier(async (e) => assigner(e, moi, corps));
      return { corps: { ok: true } };
    }],
    ['POST', /^\/api\/conflits\/([\w-]+)\/en-cours$/, async ({ moi, params }) => ({ corps: { conflit: (await modifier(async (e) => marquerEnCours(e, moi, params[0]))).conflit } })],
    ['POST', /^\/api\/conflits\/([\w-]+)\/proposition$/, async ({ moi, corps, params }) => ({ corps: { conflit: (await modifier(async (e) => soumettreProposition(e, moi, params[0], corps, await ref()))).conflit } })],
    ['POST', /^\/api\/conflits\/([\w-]+)\/decision$/, async ({ moi, corps, params }) => ({ corps: { conflit: (await modifier(async (e) => decider(e, moi, params[0], corps, await ref()))).conflit } })],
    ['POST', /^\/api\/conflits\/([\w-]+)\/resolu$/, async ({ moi, corps, params }) => ({ corps: { conflit: (await modifier(async (e) => marquerResolu(e, moi, params[0], corps))).conflit } })],

    // Exports (administrateur) : rien n'est modifié côté serveur
    ['GET', /^\/api\/changements-approuves$/, async ({ moi }) => ({ corps: { changements: changementsApprouves(await etat(), moi) } })],
    ['GET', /^\/api\/barages-mis-a-jour$/, async ({ moi }) => ({
      corps: baragesAvecChangements(await etat(), moi, await ref()),
      entetes: { 'Content-Disposition': 'attachment; filename="barages.json"' },
    })],
    ['GET', /^\/api\/journal$/, async ({ moi }) => {
      if (!estAdmin(moi)) throw new ErreurWorkflow(403, 'réservé au superadmin');
      return { corps: { journal: (await stockage.lireJournal()).slice(-1000) } };
    }],
  ];

  async function api(req, res) {
    const url = new URL(req.url, 'http://local');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      const route = routes.find(([m, motif]) => m === req.method && motif.test(url.pathname));
      if (!route) throw new ErreurWorkflow(404, 'route inconnue');
      const [methode, motif, gerer, options = {}] = route;
      if (methode === 'POST') {
        if (req.headers[ENTETE_CSRF] !== VALEUR_CSRF) throw new ErreurWorkflow(403, 'en-tête X-Requested-With manquant');
        if (!/^application\/json/.test(req.headers['content-type'] ?? '')) throw new ErreurWorkflow(415, 'corps JSON attendu');
      }
      const moi = await acteur(req, { prolonger: !options.consultation });
      if (!options.public && !moi) throw new ErreurWorkflow(401, 'connexion requise');
      if (moi?.doitChanger && !options.public && !PENDANT_CHANGEMENT.has(url.pathname)) {
        throw Object.assign(new ErreurWorkflow(403, 'changez d’abord votre mot de passe temporaire'), { changer: true });
      }
      const corps = methode === 'POST' ? await lireCorps(req) : {};
      const r = await gerer({ req, res, url, corps, moi, params: url.pathname.match(motif).slice(1) });
      json(res, r.statut ?? 200, r.corps, r.entetes);
    } catch (erreur) {
      if (erreur instanceof ErreurWorkflow) json(res, erreur.code, { erreur: erreur.message, ...(erreur.changer ? { changer: true } : {}) });
      else {
        console.error('API :', erreur);
        json(res, 500, { erreur: 'erreur interne du serveur' });
      }
    }
    return true;
  }

  /**
   * Contrôle d'accès des fichiers statiques, appelé par serveur.mjs avec le fichier résolu
   * (`fichier` : chemin canonique, null si absent) : les décisions portent sur ce fichier, pas
   * sur l'écriture de l'URL. `publique` : page de connexion ou ressource construite.
   * @returns {Promise<{ suite: true } | { redirection: string } | { refus: number } | { contenu: { corps: Buffer, etag: string } }>}
   */
  api.garde = async function garde(req, { chemin, fichier, publique }) {
    if (publique) return { suite: true };
    const moi = await acteur(req);
    const page = estPage(req, chemin);
    if (!moi) return page ? { redirection: PAGE_CONNEXION + (lireCookie(req.headers.cookie) ? '?expire=1' : '') } : { refus: 401 };
    if (moi.doitChanger) return page ? { redirection: `${PAGE_CONNEXION}?changer=1` } : { refus: 403 };
    if (!estAdmin(moi) && fichier) {
      const cle = await filtre.identifier(fichier);
      if (cle) {
        const contenu = moi.regId ? await filtre.servir(cle, moi.regId) : null;
        return contenu ? { contenu } : { refus: 404 };
      }
    }
    return { suite: true };
  };
  return api;
}

/** Lecture seule de l'état (CLI). */
export async function lireEtat(dossierEtat) {
  return new Stockage(dossierEtat).lire('etat', ETAT_VIDE());
}

