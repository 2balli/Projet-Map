/**
 * Authentification du serveur local, sans dépendance : mots de passe hachés (scrypt, sel
 * aléatoire, comparaison à temps constant), sessions en mémoire (jeton aléatoire, cookie
 * HttpOnly), limitation des tentatives de connexion.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const LONGUEUR = 64;
export const LONGUEUR_MIN_MOT_DE_PASSE = 10;
/** Mot de passe temporaire (création initiale, réinitialisation) : changement imposé à la connexion. */
export const LONGUEUR_MIN_TEMPORAIRE = 6;

/** Empreinte « scrypt$N$r$p$sel$hachage » (base64). */
export function hacherMotDePasse(motDePasse) {
  const sel = randomBytes(16);
  const h = scryptSync(String(motDePasse), sel, LONGUEUR, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sel.toString('base64')}$${h.toString('base64')}`;
}

export function verifierMotDePasse(motDePasse, empreinte) {
  const parties = String(empreinte ?? '').split('$');
  if (parties.length !== 6 || parties[0] !== 'scrypt') return false;
  const [, n, r, p, sel, attendu] = parties;
  const reference = Buffer.from(attendu, 'base64');
  let calcule;
  try {
    calcule = scryptSync(String(motDePasse), Buffer.from(sel, 'base64'), reference.length, { N: Number(n), r: Number(r), p: Number(p) });
  } catch {
    return false;
  }
  return calcule.length === reference.length && timingSafeEqual(calcule, reference);
}

/**
 * Règle des mots de passe : au moins 10 caractères (choisi par l'utilisateur), 6 pour un mot de
 * passe temporaire qui devra être changé à la première connexion.
 * @returns {string | null} motif du refus
 */
export function refusMotDePasse(motDePasse, { temporaire = false } = {}) {
  const min = temporaire ? LONGUEUR_MIN_TEMPORAIRE : LONGUEUR_MIN_MOT_DE_PASSE;
  return typeof motDePasse === 'string' && motDePasse.length >= min ? null : `mot de passe : au moins ${min} caractères`;
}

/**
 * Sessions en mémoire : expirent après 2 h sans activité et, quoi qu'il arrive, 12 h après la
 * connexion. Un redémarrage du serveur déconnecte tout le monde (voulu).
 */
export class Sessions {
  constructor({ inactiviteMs = 2 * 3600 * 1000, maximumMs = 12 * 3600 * 1000, maintenant = () => Date.now() } = {}) {
    Object.assign(this, { inactiviteMs, maximumMs, maintenant });
    this.liste = new Map();
  }

  creer(compteId) {
    const jeton = randomBytes(32).toString('base64url');
    const t = this.maintenant();
    this.liste.set(jeton, { compteId, vu: t, cree: t });
    return jeton;
  }

  /**
   * Compte d'un jeton valide ; null sinon. `prolonger: false` : simple consultation (contrôle
   * périodique de la page) qui ne compte pas comme une activité.
   */
  lire(jeton, { prolonger = true } = {}) {
    const s = jeton && this.liste.get(jeton);
    if (!s) return null;
    const t = this.maintenant();
    if (t - s.vu > this.inactiviteMs || t - s.cree > this.maximumMs) {
      this.liste.delete(jeton);
      return null;
    }
    if (prolonger) s.vu = t;
    return s.compteId;
  }

  /** Millisecondes avant expiration (inactivité ou durée maximale), sans prolonger. */
  restant(jeton) {
    const s = jeton && this.liste.get(jeton);
    if (!s) return 0;
    const t = this.maintenant();
    return Math.max(0, Math.min(this.inactiviteMs - (t - s.vu), this.maximumMs - (t - s.cree)));
  }

  supprimer(jeton) {
    this.liste.delete(jeton);
  }

  /** Toutes les sessions d'un compte (compte désactivé, mot de passe changé). */
  supprimerCompte(compteId) {
    for (const [j, s] of this.liste) if (s.compteId === compteId) this.liste.delete(j);
  }
}

/** Limite les échecs de connexion : 5 par identifiant et par adresse, sur 10 minutes. */
export class Tentatives {
  constructor({ max = 5, fenetreMs = 10 * 60 * 1000, maintenant = () => Date.now() } = {}) {
    Object.assign(this, { max, fenetreMs, maintenant });
    this.echecs = new Map();
  }

  bloque(cle) {
    const t = (this.echecs.get(cle) ?? []).filter((d) => d > this.maintenant() - this.fenetreMs);
    this.echecs.set(cle, t);
    return t.length >= this.max;
  }

  echec(cle) {
    this.echecs.set(cle, [...(this.echecs.get(cle) ?? []), this.maintenant()]);
  }

  reussite(cle) {
    this.echecs.delete(cle);
  }
}

export const NOM_COOKIE = 'mc_session';

export function lireCookie(entete, nom = NOM_COOKIE) {
  for (const partie of String(entete ?? '').split(';')) {
    const [k, ...v] = partie.trim().split('=');
    if (k === nom) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Cookie de session : HttpOnly (illisible par la page), SameSite=Strict (pas d'envoi intersite). */
export function cookieSession(jeton, { secure = false, maxAgeS = 12 * 3600 } = {}) {
  // Durée maximale de la session ; l'inactivité est vérifiée par le serveur.
  return `${NOM_COOKIE}=${encodeURIComponent(jeton)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}

export const cookieEfface = () => `${NOM_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
