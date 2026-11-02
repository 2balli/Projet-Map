/**
 * LA PORTE DE L'APPLICATION — trois états, et non deux.
 *
 *   session === undefined  on interroge le service, on ne sait pas encore ;
 *   session === null       personne n'est connecté      -> Login ;
 *   session + à changer    mot de passe TEMPORAIRE      -> MotDePasse ;
 *   session                                             -> la carte.
 *
 * LE TROISIÈME ÉTAT N'EST PAS UNE POLITESSE. Un compte ouvert avec un mot de
 * passe distribué en clair ne doit rien pouvoir faire avant d'en avoir choisi
 * un. L'interdiction elle-même est tenue par le SERVEUR, qui refuse toute
 * requête d'une telle session sauf le changement (code 428, voir le verrou
 * dans `serveur/api.mjs`). Cet écran est la face visible de ce refus : le
 * contourner ne donne accès à rien.
 *
 * L'état survit au rechargement parce qu'il ne vit pas ici : `/api/session`
 * renvoie `motDePasseAChanger` à chaque lecture. Un F5 sur l'écran de
 * changement y revient.
 */
import { useCallback, useEffect, useState } from 'react';
import GendarmerieMap from './GendarmerieMap.jsx';
import Login from './Login.jsx';
import MotDePasse from './MotDePasse.jsx';
import BandeauMode from './BandeauMode.jsx';
import * as API from './api.js';
import { IconSpinner } from './icons.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);
  const [aChanger, setAChanger] = useState(false);
  /** Pourquoi l'écran de connexion est revenu (session perdue), ou null. */
  const [avisConnexion, setAvisConnexion] = useState(null);

  /**
   * LE MODE DU SERVICE — 'demo', 'production', ou `null` si non marqué.
   *
   * Lu ICI, à la racine, et non dans un panneau : le bandeau de démonstration
   * doit être visible sur TOUS les écrans, y compris la connexion et le
   * changement de mot de passe. Un avertissement qui n'apparaît qu'après la
   * connexion arrive trop tard.
   *
   * Un échec de lecture laisse `null` : pas de bandeau. C'est le bon défaut —
   * afficher « démonstration » sur un service réel parce que `/api/etat` n'a
   * pas répondu serait pire que de ne rien afficher.
   */
  const [mode, setMode] = useState(null);

  useEffect(() => {
    API.session()
      .then(({ session: s, motDePasseAChanger }) => {
        setSession(s);
        setAChanger(motDePasseAChanger);
      })
      .catch(() => setSession(null));

    API.etatService()
      .then((e) => setMode(e?.mode ?? null))
      .catch(() => setMode(null));
  }, []);

  /**
   * LE 428 PEUT ARRIVER PLUS TARD.
   *
   * Un poste laissé ouvert pendant qu'un administrateur remet un mot de passe
   * temporaire sur le compte se retrouve avec une session qui ne peut plus
   * rien faire. Chaque appel refusé porte alors 428 ; l'application repasse
   * sur l'écran de changement au lieu d'accumuler des erreurs incompréhensibles.
   */
  useEffect(() => {
    const surRefus = () => setAChanger(true);
    window.addEventListener('gr-mot-de-passe-a-changer', surRefus);
    return () => window.removeEventListener('gr-mot-de-passe-a-changer', surRefus);
  }, []);

  /**
   * LE 401 AUSSI : le serveur ne connaît plus la session (redémarré, ou
   * session expirée). On revient à la connexion, en le disant — plutôt que
   * de laisser une carte « connectée » dont chaque écriture échoue.
   */
  useEffect(() => {
    const surPerte = () => {
      setSession((s) => {
        if (s) {
          setAvisConnexion(
            'Votre session n’est plus valide : le serveur a redémarré ou la session a expiré (8 h). Reconnectez-vous — ce qui a été enregistré n’est pas perdu.',
          );
        }
        return null;
      });
      setAChanger(false);
    };
    window.addEventListener('gr-session-perdue', surPerte);
    return () => window.removeEventListener('gr-session-perdue', surPerte);
  }, []);

  const seDeconnecter = useCallback(() => {
    API.deconnexion().catch(() => {});
    setSession(null);
    setAChanger(false);
  }, []);

  /**
   * L'ÉCRAN COURANT — un seul endroit qui en décide.
   *
   * Sorti dans une variable pour que le bandeau de mode l'enveloppe SANS être
   * recopié quatre fois. Un avertissement oublié sur l'un des quatre écrans
   * serait précisément le trou qu'il est censé boucher.
   */
  const ecran =
    session === undefined ? (
      <div className="flex h-screen w-screen items-center justify-center bg-gr-deep">
        <div className="flex flex-col items-center gap-4 text-gr-gold">
          <IconSpinner size={32} />
          <span className="text-[12px] font-semibold uppercase tracking-widest">Chargement...</span>
        </div>
      </div>
    ) : !session ? (
      <Login
        avis={avisConnexion}
        onLoginSuccess={(s, motDePasseAChanger) => {
          setAvisConnexion(null);
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              for (let i = window.localStorage.length - 1; i >= 0; i--) {
                const k = window.localStorage.key(i);
                if (k && (k.startsWith('gr-optimisation-onglets') || k.startsWith('gr-distance'))) {
                  window.localStorage.removeItem(k);
                }
              }
            }
          } catch {
            /* ignore */
          }
          setSession(s);
          setAChanger(motDePasseAChanger === true);
        }}
      />
    ) : aChanger ? (
      <MotDePasse
        session={session}
        /* Le serveur a fermé toutes les sessions du compte : on repart de la
           connexion, avec le nouveau mot de passe. */
        onFait={seDeconnecter}
        onAbandon={seDeconnecter}
      />
    ) : (
      <GendarmerieMap session={session} mode={mode} onLogout={() => setSession(null)} />
    );

  return (
    <>
      {ecran}
      {/* En portail, au-dessus de tout, et seulement en démonstration. */}
      {/* Sur la carte, le mode est intégré à la barre de commandement. Les
          écrans d'accès gardent le bandeau global, afin qu'il reste visible
          avant même l'ouverture d'une session. */}
      <BandeauMode mode={session && !aChanger ? null : mode} source={API.sourceDonnees()} />
    </>
  );
}
