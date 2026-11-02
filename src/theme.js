/**
 * APPARENCE — palettes, modes clair / sombre, et préférence par utilisateur.
 *
 * QUATRE PALETTES, DEUX MODES CHACUNE (Paramètres → Apparence) :
 *   midnight  Midnight Command          bleu nuit, interaction cyan, sélection or ;
 *   graphite  Graphite & Electric Blue  gris graphite neutre, bleu électrique ;
 *   arctic    Arctic Professional       blancs froids et bleu glacier ;
 *   forest    Forest Slate              ardoise verte, vert opérationnel.
 * Le mode est « clair », « sombre » ou « système » (suit le poste, en direct).
 *
 * Portés par <html> : `data-palette`, `data-mode` (résolu : light | dark) et
 * `data-theme` = « palette-mode », la clé qu'emploient la carte et les tables
 * ci-dessous. Toute la charte de l'interface découle des variables CSS
 * (index.css) : les composants n'ont pas à connaître le thème.
 *
 * PAR UTILISATEUR. La préférence est enregistrée dans le COMPTE
 * (`/api/preferences`) : retrouvée à chaque reconnexion, sur tout poste, et
 * jamais imposée à un autre compte. Une copie locale par matricule
 * l'applique dès la connexion ; le serveur fait foi dès qu'il répond. Avant
 * la connexion, l'écran d'accès prend la dernière apparence du poste
 * (public/theme-initial.js, même règle, avant React : aucun éclair).
 *
 * CHANGER DE THÈME SANS À-COUP : la classe `gr-transition-theme` est posée sur
 * <html> le temps du changement ; index.css y fond les couleurs de l'habillage
 * en 240 ms (jamais celles des centaines de repères de la carte). Aucun
 * rechargement de page ; le fond de carte change de style en place.
 *
 * ANIMATIONS (Paramètres → Apparence → Animations) : `data-mouvement` sur
 * <html> — « reduit » coupe les animations (index.css, et les animations en
 * JS via `mouvementReduit`). « Système » suit le poste en direct.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { lirePreferences, enregistrerPreferences } from './api.js';
import {
  APPARENCE_DEFAUT, normaliserApparence, modeSysteme, resoudreApparence, HABILLAGE_THEME, mouvementReduitSysteme, resoudreMouvement,
} from './apparence.js';

export * from './apparence.js';

/* ------------------------------------------------------------------ */
/* Stockage local (copie) et application                              */
/* ------------------------------------------------------------------ */

export const CLE_APPARENCE = 'gr-apparence';
const cleCompte = (matricule) => `${CLE_APPARENCE}:${matricule}`;

function lire(cle) {
  try {
    const brut = window.localStorage.getItem(cle);
    if (brut) return normaliserApparence(JSON.parse(brut));
    /* Ancien format : « gr-theme » = light | dark | slate. */
    const ancien = cle === CLE_APPARENCE ? window.localStorage.getItem('gr-theme') : window.localStorage.getItem(cle.replace(CLE_APPARENCE, 'gr-theme'));
    return ancien ? normaliserApparence({ theme: ancien }) : null;
  } catch {
    return null;
  }
}
function ecrire(cle, apparence) {
  try {
    window.localStorage.setItem(cle, JSON.stringify(apparence));
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

/** Durée du fondu de changement de thème — voir index.css, `.gr-transition-theme`. */
export const DUREE_TRANSITION_THEME = 240;
let minuterieTransition = null;

/**
 * Pose l'apparence sur <html>. `animer` : fondu des couleurs de l'habillage
 * (jamais au premier rendu, ni si l'utilisateur a demandé moins d'animation —
 * la règle CSS le neutralise alors).
 */
export function appliquerApparence(resolue, { animer = false } = {}) {
  const racine = document.documentElement;
  if (racine.dataset.theme === resolue.cle) return;
  if (animer) {
    racine.classList.add('gr-transition-theme');
    clearTimeout(minuterieTransition);
    minuterieTransition = setTimeout(() => racine.classList.remove('gr-transition-theme'), DUREE_TRANSITION_THEME + 80);
  }
  racine.dataset.palette = resolue.palette;
  racine.dataset.mode = resolue.mode;
  racine.dataset.theme = resolue.cle;
  racine.style.colorScheme = resolue.mode;
}

export function apparenceInitiale(matricule = null) {
  if (typeof window === 'undefined') return { ...APPARENCE_DEFAUT };
  return (matricule && lire(cleCompte(matricule))) || lire(CLE_APPARENCE) || { ...APPARENCE_DEFAUT };
}

/** Clé résolue du thème posé sur la page (pour les couches sans prop). */
export function themeInitial() {
  if (typeof document === 'undefined') return 'midnight-dark';
  const pose = document.documentElement.dataset.theme;
  return pose && HABILLAGE_THEME[pose] ? pose : resoudreApparence(apparenceInitiale()).cle;
}

/* ------------------------------------------------------------------ */
/* Le crochet                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {string|null} matricule  compte connecté — `null` avant la connexion.
 * @returns {{ theme: string, apparence: {palette: string, mode: string, mouvement: string}, choisir: (p: object) => void }}
 *   `theme` : la clé résolue (« forest-light »…) ; `choisir` accepte un
 *   changement partiel (`{ mode: 'dark' }`).
 */
export function useTheme(matricule = null) {
  const [apparence, setApparence] = useState(() => apparenceInitiale(matricule));
  const [systeme, setSysteme] = useState(modeSysteme);
  const [systemeReduit, setSystemeReduit] = useState(mouvementReduitSysteme);
  const resolue = resoudreApparence(apparence, systeme);
  const mouvement = resoudreMouvement(apparence.mouvement, systemeReduit);
  const premier = useRef(true);

  useEffect(() => {
    document.documentElement.dataset.mouvement = mouvement;
  }, [mouvement]);

  useEffect(() => {
    appliquerApparence(resolue, { animer: !premier.current });
    premier.current = false;
  }, [resolue.cle]); // eslint-disable-line react-hooks/exhaustive-deps

  /* LA PRÉFÉRENCE DU COMPTE : copie locale tout de suite, serveur ensuite. */
  useEffect(() => {
    if (!matricule) return undefined;
    let vivant = true;
    const locale = lire(cleCompte(matricule));
    if (locale) setApparence(locale);
    lirePreferences()
      .then((r) => {
        const p = r?.preferences;
        if (!vivant || !p || (!p.palette && !p.theme)) return;
        const a = normaliserApparence(p);
        ecrire(cleCompte(matricule), a);
        ecrire(CLE_APPARENCE, a);
        setApparence(a);
      })
      .catch(() => {
        /* hors ligne ou service ancien : la copie locale suffit */
      });
    return () => {
      vivant = false;
    };
  }, [matricule]);

  /* Le mode « système » suit le poste en direct ; un autre onglet du même
     compte est suivi aussi. */
  useEffect(() => {
    const requete = window.matchMedia?.('(prefers-color-scheme: light)');
    const requeteMouvement = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const surSysteme = () => setSysteme(modeSysteme());
    const surMouvement = () => setSystemeReduit(mouvementReduitSysteme());
    const surStockage = (e) => {
      if (matricule && e.key === cleCompte(matricule) && e.newValue) {
        try {
          setApparence(normaliserApparence(JSON.parse(e.newValue)));
        } catch {
          /* valeur illisible : ignorée */
        }
      }
    };
    requete?.addEventListener?.('change', surSysteme);
    requeteMouvement?.addEventListener?.('change', surMouvement);
    window.addEventListener('storage', surStockage);
    return () => {
      requete?.removeEventListener?.('change', surSysteme);
      requeteMouvement?.removeEventListener?.('change', surMouvement);
      window.removeEventListener('storage', surStockage);
    };
  }, [matricule]);

  const choisir = useCallback(
    (partiel) => {
      setApparence((avant) => {
        const a = normaliserApparence({ ...avant, ...partiel });
        ecrire(CLE_APPARENCE, a);
        if (matricule) {
          ecrire(cleCompte(matricule), a);
          enregistrerPreferences(a).catch(() => {
            /* gardé localement ; resynchronisé au prochain choix */
          });
        }
        return a;
      });
    },
    [matricule],
  );

  return { theme: resolue.cle, apparence, choisir };
}
