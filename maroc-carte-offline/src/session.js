/**
 * Session de l'utilisateur, à part du rendu de la carte. Le serveur décide de tout (cookie
 * HttpOnly, droits, région, données filtrées) : ce module ne fait que suivre l'état de la
 * session et renvoyer vers la page de connexion quand elle n'est plus valide. Aucun mot de passe
 * ni jeton n'est gardé dans le navigateur.
 *
 * Sans serveur de comptes (`npm run dev`, Vite seul), la carte fonctionne comme avant : il n'y a
 * alors ni comptes ni données protégées (le serveur de développement sert les fichiers tels quels).
 */
import { ErreurApi, appelApi } from './api.js';

export const PAGE_CONNEXION = '/connexion.html';
const INTERVALLE_CONTROLE_MS = 60 * 1000;

/** Quitte la carte pour la page de connexion (sans garder la carte dans l'historique). */
export function versConnexion(motif = '') {
  window.location.replace(`${PAGE_CONNEXION}${motif ? `?${motif}` : ''}`);
  return new Promise(() => {}); // la page est quittée : la suite ne s'exécute pas
}

/**
 * Session au démarrage de la carte.
 * @returns {Promise<{ compte, region: { id, nom, emprise } | null, roles, statuts } | null>}
 *   null : pas de serveur de comptes (développement) ; sans session, la page est quittée.
 */
export async function ouvrirSession() {
  try {
    const r = await appelApi('/api/moi');
    if (r.doitChanger) return versConnexion('changer=1');
    return r;
  } catch (erreur) {
    if (erreur instanceof ErreurApi && erreur.statut === 401) return versConnexion();
    if (erreur instanceof ErreurApi && erreur.statut === 403) return versConnexion('changer=1');
    return null; // serveur de comptes absent : mode développement
  }
}

/**
 * Contrôle périodique (sans prolonger la session) et au retour sur l'onglet : session expirée
 * → page de connexion « session expirée ».
 */
export function surveillerSession() {
  let enCours = false;
  const controler = async () => {
    if (enCours) return;
    enCours = true;
    try {
      const r = await appelApi('/api/session');
      if (!(r.restantS > 0)) await versConnexion('expire=1');
    } catch (erreur) {
      if (erreur instanceof ErreurApi && erreur.statut === 401) await versConnexion('expire=1');
    } finally {
      enCours = false;
    }
  };
  const minuterie = setInterval(controler, INTERVALLE_CONTROLE_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && controler());
  return () => clearInterval(minuterie);
}

export async function seDeconnecter() {
  try { await appelApi('/api/deconnexion', { methode: 'POST' }); } catch { /* déjà fermée */ }
  return versConnexion();
}
