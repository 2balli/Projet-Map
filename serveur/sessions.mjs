/**
 * Sessions et limitation des tentatives.
 *
 * Les sessions vivent EN MÉMOIRE : redémarrer le serveur déconnecte tout le
 * monde. C'est voulu — pas de jeton persistant à voler sur le disque, et un
 * incident se solde par une reconnexion, jamais par un accès qui traîne.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Durée d'une session inactive avant expiration. */
export const DUREE_MS = 8 * 3600_000;

/** Tentatives ratées tolérées, puis blocage temporaire du compte. */
const TENTATIVES_MAX = 5;
const BLOCAGE_MS = 15 * 60_000;

const sessions = new Map(); // jeton -> {rang, unite, reg, expire, ouvert}
const echecs = new Map(); // clé de compte -> {n, jusqu}

export const NOM_COOKIE = 'gr_session';

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

export function ouvrir(identite) {
  purger();
  const jeton = randomBytes(32).toString('base64url');
  sessions.set(jeton, {
    ...identite,
    ouvert: new Date().toISOString(),
    expire: Date.now() + DUREE_MS,
  });
  return jeton;
}

/**
 * Session valide, ou null. L'échéance est repoussée à chaque appel : une saisie
 * en cours ne se fait pas couper au bout de huit heures, alors qu'un poste
 * laissé sans surveillance finit bien par expirer.
 */
export function lire(jeton) {
  if (!jeton) return null;
  const s = sessions.get(jeton);
  if (!s) return null;
  if (s.expire < Date.now()) {
    sessions.delete(jeton);
    return null;
  }
  s.expire = Date.now() + DUREE_MS;
  return s;
}

/**
 * Session valide, ou null — SANS repousser l'échéance.
 *
 * Pour le flux des notifications (GET /api/notifications/flux) : une
 * connexion ouverte en permanence qui prolongerait la session à chaque
 * événement garderait connecté pour toujours un poste laissé sans surveillance.
 */
export function consulter(jeton) {
  if (!jeton) return null;
  const s = sessions.get(jeton);
  if (!s || s.expire < Date.now()) return null;
  return s;
}

export function fermer(jeton) {
  return jeton ? sessions.delete(jeton) : false;
}

/**
 * Ferme TOUTES les sessions d'un compte, où qu'elles soient ouvertes.
 *
 * Employée au changement de mot de passe. Changer de mot de passe, c'est
 * souvent qu'on soupçonne l'ancien d'avoir fuité : laisser vivre les sessions
 * ouvertes avec celui-là viderait le geste de son sens. La personne se
 * reconnecte une fois, avec le nouveau — et les postes où le compte traînait
 * ouvert se referment.
 *
 * @returns {number} nombre de sessions fermées, la courante comprise
 */
export function fermerToutesDe(matricule) {
  if (!matricule) return 0;
  let n = 0;
  for (const [jeton, s] of sessions) {
    if (s.matricule === matricule) {
      sessions.delete(jeton);
      n++;
    }
  }
  return n;
}

function purger() {
  const maintenant = Date.now();
  for (const [jeton, s] of sessions) if (s.expire < maintenant) sessions.delete(jeton);
  for (const [cle, e] of echecs) if (e.jusqu < maintenant) echecs.delete(cle);
}

export const compteSessions = () => {
  purger();
  return sessions.size;
};

/* ------------------------------------------------------------------ */
/* Cookie                                                             */
/* ------------------------------------------------------------------ */

/**
 * `HttpOnly` : le jeton est invisible au JavaScript de la page, donc inutile
 * de le manipuler côté client. `SameSite=Strict` : le navigateur ne l'envoie
 * pas depuis un autre site, ce qui coupe la falsification de requête.
 * Pas de `Secure` : l'intranet est en HTTP, l'attribut empêcherait le cookie
 * d'être posé — à ajouter le jour où le service passe en HTTPS.
 */
export const cookieSession = (jeton) =>
  `${NOM_COOKIE}=${jeton}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${DUREE_MS / 1000}`;

export const cookieEffacement = () =>
  `${NOM_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

/** Extrait le jeton de l'en-tête Cookie, sans dépendance. */
export function jetonDe(req) {
  const brut = req.headers.cookie;
  if (!brut) return null;
  for (const morceau of brut.split(';')) {
    const i = morceau.indexOf('=');
    if (i < 0) continue;
    if (morceau.slice(0, i).trim() === NOM_COOKIE) return morceau.slice(i + 1).trim();
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Limitation des tentatives                                          */
/* ------------------------------------------------------------------ */

/** Secondes restantes de blocage, ou 0 si le compte est libre d'essayer. */
export function blocage(cle) {
  const e = echecs.get(cle);
  if (!e || e.jusqu < Date.now()) return 0;
  return e.n >= TENTATIVES_MAX ? Math.ceil((e.jusqu - Date.now()) / 1000) : 0;
}

export function echec(cle) {
  const e = echecs.get(cle) ?? { n: 0, jusqu: 0 };
  e.n++;
  e.jusqu = Date.now() + BLOCAGE_MS;
  echecs.set(cle, e);
  return Math.max(0, TENTATIVES_MAX - e.n);
}

export const reussite = (cle) => echecs.delete(cle);

/** Comparaison à temps constant de deux chaînes courtes (jetons d'en-tête). */
export function memeChaine(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
