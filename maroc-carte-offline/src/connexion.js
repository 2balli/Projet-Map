/**
 * Page de connexion (connexion.html). Les identifiants sont envoyés au serveur local, qui les
 * vérifie (empreintes scrypt) et ouvre la session (cookie HttpOnly) : la page ne compare rien
 * elle-même et ne garde aucun mot de passe. Après un mot de passe temporaire, le serveur
 * n'ouvre la carte qu'une fois le nouveau mot de passe enregistré.
 *
 *   /connexion.html             connexion
 *   /connexion.html?expire=1    session expirée
 *   /connexion.html?changer=1   changement de mot de passe (imposé ou demandé depuis la carte)
 */
import { ErreurApi, appelApi } from './api.js';
import logo from './assets/logo-gendarmerie.png';
import './connexion.css';

const $ = (id) => document.getElementById(id);
const parametres = new URLSearchParams(window.location.search);
const LONGUEUR_MIN = 10;

try {
  const theme = JSON.parse(localStorage.getItem('maroc-carte:prefs:v1') ?? '{}')?.theme;
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
} catch { /* préférences illisibles : thème clair */ }
$('cx-logo').src = logo;

const versCarte = () => window.location.replace('/');

function message(el, texte) {
  el.textContent = texte ?? '';
  el.hidden = !texte;
}

function attente(bouton, actif) {
  bouton.disabled = actif;
  bouton.classList.toggle('en-cours', actif);
  bouton.setAttribute('aria-busy', String(actif));
  for (const champ of bouton.form.querySelectorAll('input')) champ.readOnly = actif;
}

function erreurChamp(input, texte) {
  const el = $(`${input.id}-erreur`);
  input.setAttribute('aria-invalid', String(Boolean(texte)));
  if (el) message(el, texte);
}

// Afficher / masquer les mots de passe.
for (const b of document.querySelectorAll('[data-voir]')) {
  b.addEventListener('click', () => {
    const input = $(b.dataset.voir);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    b.textContent = visible ? 'Masquer' : 'Afficher';
    b.setAttribute('aria-pressed', String(visible));
    b.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    input.focus();
  });
}

function montrerChangement(compte, { impose }) {
  $('cx-connexion').hidden = true;
  $('cx-changement').hidden = false;
  $('cx-changement-identifiant').value = compte?.identifiant ?? '';
  $('cx-changement-qui').textContent = impose
    ? `${compte?.nom ?? 'Compte'} : votre mot de passe est temporaire. Choisissez-en un nouveau (10 caractères au moins) pour ouvrir la carte.`
    : `${compte?.nom ?? 'Compte'} : choisissez un nouveau mot de passe (10 caractères au moins).`;
  $('cx-retour-carte').hidden = impose;
  $('cx-actuel').focus();
}

// ── Connexion ──────────────────────────────────────────────────────────────

$('cx-connexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const identifiant = $('cx-identifiant');
  const motDePasse = $('cx-mot-de-passe');
  message($('cx-connexion-erreur'), '');
  erreurChamp(identifiant, identifiant.value.trim() ? '' : 'Saisissez votre identifiant.');
  erreurChamp(motDePasse, motDePasse.value ? '' : 'Saisissez votre mot de passe.');
  if (!identifiant.value.trim()) return identifiant.focus();
  if (!motDePasse.value) return motDePasse.focus();
  const bouton = $('cx-connexion-valider');
  attente(bouton, true);
  try {
    const r = await appelApi('/api/connexion', { methode: 'POST', corps: { identifiant: identifiant.value.trim(), motDePasse: motDePasse.value } });
    motDePasse.value = '';
    if (r.doitChanger) {
      $('cx-actuel').value = '';
      attente(bouton, false);
      return montrerChangement(r.compte, { impose: true });
    }
    versCarte();
  } catch (erreur) {
    const texte = erreur instanceof ErreurApi && erreur.statut === 401 ? 'Identifiant ou mot de passe incorrect.'
      : erreur instanceof ErreurApi && erreur.statut === 429 ? 'Trop de tentatives : réessayez dans quelques minutes.'
        : erreur.message;
    message($('cx-connexion-erreur'), texte);
    motDePasse.select();
    attente(bouton, false);
  }
});

// ── Changement de mot de passe ─────────────────────────────────────────────

$('cx-changement').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erreur = $('cx-changement-erreur');
  const [actuel, nouveau, confirmation] = ['cx-actuel', 'cx-nouveau', 'cx-confirmation'].map($);
  const refus = !actuel.value ? 'Saisissez votre mot de passe actuel.'
    : nouveau.value.length < LONGUEUR_MIN ? `Le nouveau mot de passe doit compter au moins ${LONGUEUR_MIN} caractères.`
      : nouveau.value === actuel.value ? 'Le nouveau mot de passe doit être différent de l’actuel.'
        : nouveau.value !== confirmation.value ? 'La confirmation ne correspond pas au nouveau mot de passe.' : '';
  message(erreur, refus);
  if (refus) return;
  const bouton = $('cx-changement-valider');
  attente(bouton, true);
  try {
    await appelApi('/api/mot-de-passe', { methode: 'POST', corps: { actuel: actuel.value, nouveau: nouveau.value } });
    for (const c of [actuel, nouveau, confirmation]) c.value = '';
    versCarte();
  } catch (x) {
    if (x instanceof ErreurApi && x.statut === 401) {
      // Session expirée pendant la saisie : reconnexion.
      $('cx-changement').hidden = true;
      $('cx-connexion').hidden = false;
      message($('cx-info'), 'Session expirée : reconnectez-vous.');
    } else message(erreur, x.message);
    attente(bouton, false);
  }
});

$('cx-changement-sortir').addEventListener('click', async () => {
  try { await appelApi('/api/deconnexion', { methode: 'POST' }); } catch { /* déjà fermée */ }
  window.location.replace('/connexion.html');
});

// ── État à l'arrivée ───────────────────────────────────────────────────────

(async () => {
  if (parametres.has('expire')) message($('cx-info'), 'Session expirée : reconnectez-vous.');
  try {
    const r = await appelApi('/api/moi');
    // Déjà connecté : changement demandé ou imposé, sinon directement la carte.
    if (r.doitChanger || parametres.has('changer')) return montrerChangement(r.compte, { impose: r.doitChanger });
    return versCarte();
  } catch (erreur) {
    if (erreur instanceof ErreurApi && erreur.statut !== 401) {
      message($('cx-connexion-erreur'), erreur.statut === 503 || erreur.statut === 0
        ? 'Serveur de comptes indisponible : lancez la carte avec « npm start » (ou l’image Docker).'
        : erreur.message);
    }
  }
  $('cx-identifiant').focus();
})();
