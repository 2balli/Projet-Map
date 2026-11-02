/**
 * Onglet « Doublons » du tableau d'optimisation : analyser les doublons, lancer l'optimisation
 * (suppression des doublons CONFIRMÉS après confirmation du nombre exact), annuler la dernière
 * optimisation, historique des opérations, carte des doublons. Moteur : dedoublonnage.js.
 *
 * Écriture : surcouche locale des barages (CoucheBarages.remplacerEditions), jamais le fichier
 * installé. Ordre d'une opération : verrou → journal « en cours » (sauvegarde complète de la
 * surcouche d'avant) → écriture → vérification → journal « terminée ». Tout échec après
 * l'écriture remet la surcouche d'avant. Les doublons potentiels ne sont jamais supprimés.
 */
import { lireEditions } from './barages.js';
import {
  CRITERES_CANONIQUE, LIBELLES_CRITERES, REGLES_DEDOUBLONNAGE, ajouterOperation, annulerOptimisation, derniereAnnulable,
  etatApresInterruption, lireOperations, majOperation, planifierOptimisation, validerReglesDedoublonnage,
} from './dedoublonnage.js';
import { memeValeur } from './optimisation.js';

const CLE_REGLES = 'maroc-carte:optimisation:dedoublonnage:v1';
const CLE_OPERATIONS = 'maroc-carte:optimisation:operations:v1';
const CLE_EDITIONS = 'maroc-carte:barages-editions:v1'; // surcouche de couche-barages.js
const VERROU = 'maroc-carte:optimisation-barages';
const PAR_PAGE = 20;
const LIBELLES_STATUT = { 'en-cours': 'En cours', terminee: 'Terminée', echec: 'Échec (rien n’a été modifié)', annulee: 'Annulée', aucune: 'Aucun doublon confirmé', inconnue: 'Interrompue (état incertain)' };
const LIBELLES_DIFF = { type: 'type', shift: 'faction', btId: 'brigade', route: 'route', name: 'nom' };

const lire = (cle) => {
  try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch { return null; }
};
const pluriel = (n, un, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;

export class CentreDedoublonnage {
  /**
   * @param {import('./optimisation-ui.js').TableauOptimisation} tableau
   * @param {{ h: Function, date: (iso: string) => string }} outils
   */
  constructor(tableau, { h, date }) {
    Object.assign(this, { tableau, h, date });
    const { regles, erreurs } = validerReglesDedoublonnage(lire(CLE_REGLES) ?? {});
    this.regles = erreurs.length ? { ...REGLES_DEDOUBLONNAGE } : regles;
    this.historique = lireOperations(lire(CLE_OPERATIONS));
    this.etat = { etat: 'inactif', id: 0, fait: 0, total: 0, but: null, erreur: null };
    this.resultat = null; // { confirmes, potentiels, analyses, exclus, version, date, perimetre }
    this.occupe = false; // une opération à la fois (et le verrou du navigateur entre onglets)
    this.pages = { confirmes: 1, potentiels: 1 };
    this.compare = null;
    this._repris = false;
  }

  get couche() { return this.tableau.couche; }

  // ── Stockage ─────────────────────────────────────────────────────────────

  /** Écrit l'historique des opérations ; s'il est plein, les plus anciennes partent (jamais la dernière). */
  _sauver() {
    for (;;) {
      try {
        localStorage.setItem(CLE_OPERATIONS, JSON.stringify(this.historique));
        return true;
      } catch {
        if (this.historique.operations.length <= 1) return false;
        this.historique = { ...this.historique, operations: this.historique.operations.slice(0, -1) };
      }
    }
  }

  enregistrerRegles(brut) {
    const { regles, erreurs } = validerReglesDedoublonnage(brut);
    if (erreurs.length) return erreurs;
    this.regles = regles;
    try { localStorage.setItem(CLE_REGLES, JSON.stringify(regles)); } catch { /* gardées pour cette visite */ }
    return [];
  }

  /** Opération restée « en cours » (onglet fermé pendant l'écriture) : son issue se lit dans la surcouche. */
  reprendre() {
    if (this._repris || this.couche.etat !== 'pret') return;
    this._repris = true;
    let change = false;
    for (const op of this.historique.operations.filter((o) => o.statut === 'en-cours')) {
      const statut = etatApresInterruption(op, this.couche.editions);
      this.historique = majOperation(this.historique, { ...op, statut, erreurs: [...op.erreurs, `Opération interrompue (onglet fermé ?) ; état constaté au rechargement : ${LIBELLES_STATUT[statut]}.`] });
      change = true;
    }
    if (change) this._sauver();
  }

  // ── Détection (worker) ───────────────────────────────────────────────────

  analyser(but = 'analyse', { garderMessage = false } = {}) {
    const instantane = this.couche.instantane();
    if (!instantane) {
      this.tableau.message = { type: 'erreur', texte: 'Les barages ne sont pas chargés : activez la couche Barages.' };
      if (but === 'optimisation') this.occupe = false;
      return this.tableau.rendre();
    }
    const id = `D-${this.etat.id + 1}`;
    const r = this.tableau.regles;
    this.etat = { etat: 'en-cours', id: this.etat.id + 1, cle: id, fait: 0, total: instantane.enregistrements.length, but, erreur: null, version: this.couche.version, perimetre: structuredClone(r.perimetre) };
    if (!garderMessage) this.tableau.message = null;
    this.tableau._travailleur().postMessage({
      type: 'doublons', id, instantane, regles: this.regles,
      portee: { perimetre: r.perimetre, inclureAjoutsLocaux: r.inclureAjoutsLocaux }, urls: this.tableau.urls,
    });
    this.tableau.rendre();
  }

  surMessage(data) {
    if (data.id !== this.etat.cle) return;
    if (data.progression) {
      [this.etat.fait, this.etat.total] = data.progression;
      const barre = document.getElementById('opt-dbl-progression');
      if (barre) { barre.max = this.etat.total || 1; barre.value = this.etat.fait; }
      return;
    }
    const { but, version, perimetre } = this.etat;
    this.etat = { ...this.etat, etat: data.erreur ? 'erreur' : 'inactif', erreur: data.erreur ?? null };
    if (data.erreur) {
      this.occupe = false;
      return this.tableau.rendre();
    }
    this.resultat = { ...data.resultat, version, perimetre, date: new Date().toISOString() };
    this.pages = { confirmes: 1, potentiels: 1 };
    this.afficherSurCarte();
    if (but === 'optimisation') return this._executer(this.resultat);
    this.tableau.rendre();
  }

  /** Échec du worker (erreur de script) : l'opération éventuelle est relâchée. */
  surErreurWorker(message) {
    if (this.etat.etat !== 'en-cours') return;
    this.etat = { ...this.etat, etat: 'erreur', erreur: message };
    this.occupe = false;
  }

  // ── Carte ────────────────────────────────────────────────────────────────

  /** Doublons sur la carte : conservés (vert), à supprimer (rouge), potentiels (orange). */
  afficherSurCarte(groupe = null) {
    const r = this.resultat;
    if (!r) return [];
    const f = [];
    const point = (b, role, texte) => {
      if (Number.isFinite(b?.longitude) && Number.isFinite(b?.latitude)) f.push({ type: 'Feature', properties: { role, texte }, geometry: { type: 'Point', coordinates: [b.longitude, b.latitude] } });
    };
    const confirmes = groupe ? r.confirmes.filter((g) => g.id === groupe) : r.confirmes;
    const potentiels = groupe ? r.potentiels.filter((p) => p.id === groupe) : r.potentiels;
    for (const g of confirmes) {
      point(g.conserve.barage, 'conserve', groupe ? `${g.conserve.id} (conservé)` : null);
      for (const d of g.doublons) point(d.barage, 'supprimer', groupe ? `${d.id} (supprimé)` : null);
    }
    for (const p of potentiels) for (const e of p.enregistrements) point(e.barage, 'potentiel', groupe ? e.id : null);
    for (const x of f) if (!x.properties.texte) delete x.properties.texte;
    this.tableau._afficher(f, { doublons: true });
    return f;
  }

  voir(id) {
    const f = this.afficherSurCarte(id);
    this.tableau._cadrer(f.map((x) => x.geometry.coordinates));
  }

  // ── Optimisation ─────────────────────────────────────────────────────────

  lancer() {
    if (this.occupe) {
      this.tableau.message = { type: 'erreur', texte: 'Une optimisation est déjà en cours.' };
      return this.tableau.rendre();
    }
    this.occupe = true;
    this.analyser('optimisation'); // détection fraîche : le nombre confirmé est celui des données actuelles
  }

  /** Verrou partagé entre les onglets de ce navigateur (Web Locks) quand il existe. */
  async _sousVerrou(fn) {
    if (!navigator.locks?.request) return fn();
    return navigator.locks.request(VERROU, { ifAvailable: true }, async (verrou) => {
      if (!verrou) throw new Error('une optimisation est déjà en cours dans un autre onglet');
      return fn();
    });
  }

  async _executer(det) {
    try {
      await this._sousVerrou(() => this._executerSousVerrou(det));
    } catch (erreur) {
      this.tableau.message = { type: 'erreur', texte: `Optimisation non lancée : ${erreur.message}.` };
    } finally {
      this.occupe = false;
      if (this._reanalyser) {
        this._reanalyser = false;
        this.analyser('analyse', { garderMessage: true });
      } else {
        this.tableau.rendre();
      }
    }
  }

  _executerSousVerrou(det) {
    const nb = det.confirmes.reduce((s, g) => s + g.doublons.length, 0);
    const fusions = det.confirmes.filter((g) => Object.keys(g.fusion.champs).length).length;
    const base = {
      id: `OPT-${Date.now().toString(36).toUpperCase()}`, date: new Date().toISOString(), auteur: 'poste local (pas d’authentification)',
      perimetre: det.perimetre, regles: structuredClone(this.regles),
      detectes: { groupes: det.confirmes.length, doublons: nb, potentiels: det.potentiels.length, analyses: det.analyses },
      supprimes: [], fusions: [], conserves: [], erreurs: [],
    };
    if (!nb) {
      this.historique = ajouterOperation(this.historique, { ...base, statut: 'aucune' });
      this._sauver();
      this.tableau.message = { type: 'info', texte: `Aucun doublon confirmé : rien n’a été supprimé.${det.potentiels.length ? ` ${pluriel(det.potentiels.length, 'doublon potentiel')} à vérifier à la main (jamais supprimés automatiquement).` : ''}` };
      return;
    }
    const texte = `Supprimer ${pluriel(nb, 'barage')} en double ?\n\n`
      + `• ${pluriel(nb, 'doublon confirmé', 'doublons confirmés')} supprimé${nb > 1 ? 's' : ''} (${pluriel(det.confirmes.length, 'groupe')})\n`
      + `• ${pluriel(det.confirmes.length, 'barage conservé', 'barages conservés')}${fusions ? `, dont ${fusions} complété${fusions > 1 ? 's' : ''} par des informations sans conflit` : ''}\n`
      + `• ${pluriel(det.potentiels.length, 'doublon potentiel', 'doublons potentiels')} NON touché${det.potentiels.length > 1 ? 's' : ''} (à vérifier)\n\n`
      + 'Modification locale à ce navigateur (le fichier installé n’est pas modifié), annulable par « Annuler la dernière optimisation ».';
    if (!window.confirm(texte)) {
      this.tableau.message = { type: 'info', texte: 'Optimisation abandonnée : rien n’a été modifié.' };
      return;
    }
    // Les données ne doivent pas avoir changé depuis la détection (ici ou dans un autre onglet).
    if (this.couche.version !== det.version) throw new Error('les barages ont changé depuis l’analyse ; relancez');
    let stockees;
    try { stockees = lireEditions(JSON.parse(localStorage.getItem(CLE_EDITIONS) || 'null')); } catch (e) { throw new Error(`surcouche illisible (${e.message})`); }
    const avant = structuredClone(this.couche.editions);
    if (!memeValeur(stockees, lireEditions(avant))) throw new Error('les modifications locales ont changé dans un autre onglet ; relancez');

    let plan;
    try {
      plan = planifierOptimisation(avant, det.confirmes);
    } catch (erreur) {
      this.historique = ajouterOperation(this.historique, { ...base, statut: 'echec', erreurs: [erreur.message] });
      this._sauver();
      throw erreur;
    }
    // 1. Journal d'abord (sauvegarde complète de la surcouche d'avant) : sans lui, on ne touche à rien.
    let op = { ...base, statut: 'en-cours', supprimes: plan.supprimes, fusions: plan.fusions, conserves: plan.conserves, editionsAvant: avant, editionsApres: plan.editions };
    this.historique = ajouterOperation(this.historique, op);
    if (!this._sauver()) {
      this.historique = { ...this.historique, operations: this.historique.operations.filter((o) => o.id !== op.id) };
      throw new Error('impossible d’enregistrer la sauvegarde (stockage du navigateur plein ou indisponible) ; rien n’a été modifié');
    }
    const finir = (champs) => {
      op = { ...op, ...champs };
      this.historique = majOperation(this.historique, op);
      this._sauver();
    };
    // 2. Écriture.
    const ecriture = this.couche.remplacerEditions(plan.editions);
    if (!ecriture.ok) {
      finir({ statut: 'echec', erreurs: [`écriture refusée : ${ecriture.erreur}`] });
      throw new Error(`écriture refusée (${ecriture.erreur}) ; rien n’a été modifié`);
    }
    // 3. Vérification : doublons partis, conservés présents, rien d'autre de retiré. Sinon retour arrière.
    const apres = new Map();
    for (const e of this.couche.instantane().enregistrements) if (e.barage?.id) apres.set(e.barage.id, (apres.get(e.barage.id) ?? 0) + 1);
    const restants = plan.supprimes.filter((s) => apres.has(s.id)).map((s) => s.id);
    const perdus = plan.conserves.filter((id) => !apres.has(id));
    if (restants.length || perdus.length) {
      const retour = this.couche.remplacerEditions(avant);
      const erreur = `vérification après écriture : ${restants.length ? `encore présents ${restants.join(', ')}` : ''}${perdus.length ? ` conservés absents ${perdus.join(', ')}` : ''}`;
      finir({ statut: retour.ok ? 'echec' : 'inconnue', erreurs: [erreur, retour.ok ? 'surcouche d’avant rétablie' : `retour arrière impossible : ${retour.erreur}`] });
      throw new Error(`${erreur} ; ${retour.ok ? 'tout a été remis comme avant' : 'retour arrière impossible'}`);
    }
    finir({ statut: 'terminee' });
    this.tableau.fermerFiche(); // une fiche ouverte pouvait montrer un barage supprimé
    this.tableau.message = { type: 'ok', texte: `Optimisation terminée : ${pluriel(nb, 'doublon supprimé', 'doublons supprimés')}, ${pluriel(plan.conserves.length, 'barage conservé', 'barages conservés')}${plan.fusions.length ? `, ${pluriel(plan.fusions.length, 'barage complété', 'barages complétés')}` : ''}. ${det.potentiels.length ? `${pluriel(det.potentiels.length, 'doublon potentiel')} reste${det.potentiels.length > 1 ? 'nt' : ''} à vérifier.` : ''}` };
    this._reanalyser = true; // les listes reflètent les données après suppression
  }

  async annulerDerniere() {
    const op = derniereAnnulable(this.historique);
    if (!op || this.occupe) return;
    const texte = `Annuler l’optimisation du ${this.date(op.date)} ?\n\n• ${pluriel(op.supprimes.length, 'barage rétabli', 'barages rétablis')}\n• ${pluriel(op.fusions.length, 'complément retiré', 'compléments retirés')}\n\nLes autres modifications faites depuis sont gardées.`;
    if (!window.confirm(texte)) return;
    this.occupe = true;
    try {
      await this._sousVerrou(() => {
        const r = annulerOptimisation(this.couche.editions, op);
        if (r.conflits) {
          this.historique = majOperation(this.historique, { ...op, erreurs: [...op.erreurs, `Annulation refusée le ${this.date(new Date().toISOString())} : ${r.conflits.join(' ')}`] });
          this._sauver();
          throw new Error(`annulation refusée, rien n’a été changé : ${r.conflits.join(' ')}`);
        }
        const ecriture = this.couche.remplacerEditions(r.editions);
        if (!ecriture.ok) throw new Error(`écriture refusée (${ecriture.erreur}) ; rien n’a été changé`);
        this.historique = majOperation(this.historique, { ...op, statut: 'annulee', annulation: { date: new Date().toISOString() } });
        this._sauver();
        this.tableau.message = { type: 'ok', texte: `Optimisation annulée : ${pluriel(op.supprimes.length, 'barage rétabli', 'barages rétablis')}.` };
        this._reanalyser = true;
      });
    } catch (erreur) {
      this.tableau.message = { type: 'erreur', texte: `Annulation : ${erreur.message}.` };
    } finally {
      this.occupe = false;
      if (this._reanalyser) {
        this._reanalyser = false;
        this.analyser('analyse', { garderMessage: true });
      } else {
        this.tableau.rendre();
      }
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  rendre() {
    const { h } = this;
    this.reprendre();
    const r = this.resultat;
    const derniere = this.historique.operations.find((o) => o.statut === 'terminee' || o.statut === 'annulee') ?? null;
    const annulable = derniereAnnulable(this.historique);
    const perime = r && r.version !== this.couche.version;
    const enCours = this.etat.etat === 'en-cours';
    const nbConfirmes = r ? r.confirmes.reduce((s, g) => s + g.doublons.length, 0) : null;
    const tuile = (valeur, libelle, cible) => h('button', { type: 'button', class: 'insp-tuile opt-tuile', on: { click: () => document.getElementById(cible)?.scrollIntoView({ behavior: 'smooth' }) } },
      h('b', { text: valeur === null ? '—' : String(valeur) }), h('span', { text: libelle }));
    return [
      h('p', { class: 'aide', text: 'Doublon confirmé : même origine (simulé ou réel), mêmes coordonnées, type, faction, brigade, route et nom compatibles, identifiants distincts. Lui seul est supprimé, après votre confirmation ; un nom semblable ne suffit jamais. Doublon potentiel : proche ou presque identique — jamais supprimé, à vérifier.' }),
      h('div', { class: 'insp-tuiles opt-tuiles' },
        tuile(nbConfirmes, 'Doublons confirmés', 'opt-dbl-confirmes'),
        tuile(r ? r.potentiels.length : null, 'Doublons potentiels à vérifier', 'opt-dbl-potentiels'),
        tuile(r ? r.confirmes.length : null, 'Barrages conservés', 'opt-dbl-confirmes'),
        tuile(derniere?.statut === 'terminee' ? derniere.supprimes.length : 0, 'Doublons supprimés (dernière optimisation)', 'opt-dbl-supprimes')),
      r ? h('p', { class: 'aide', text: `Analyse du ${this.date(r.date)} · ${r.analyses} barages dans le périmètre (${this.tableau._libellePerimetre(r.perimetre)}) · seuils ${this.regles.seuilConfirmeM} m (confirmé) / ${this.regles.seuilPotentielM} m (potentiel)` }) : null,
      perime ? h('p', { class: 'opt-message info', text: 'Les barages ont changé depuis cette analyse : « Lancer le dédoublonnage » analyse de nouveau avant de supprimer.' }) : null,
      enCours ? h('div', { class: 'groupe opt-analyse' }, h('strong', { text: this.etat.but === 'optimisation' ? 'Optimisation : recherche des doublons…' : 'Recherche des doublons…' }), h('progress', { id: 'opt-dbl-progression', max: this.etat.total || 1, value: this.etat.fait })) : null,
      this.etat.etat === 'erreur' ? h('p', { class: 'opt-message erreur', text: `Échec de la recherche : ${this.etat.erreur}` }) : null,
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-outil', text: 'Analyser les doublons', disabled: enCours || this.occupe, on: { click: () => this.analyser() } }),
        h('button', { type: 'button', class: 'bouton-principal', text: 'Lancer le dédoublonnage', disabled: enCours || this.occupe, on: { click: () => this.lancer() } }),
        h('button', { type: 'button', class: 'lien', text: 'Annuler la dernière optimisation', disabled: !annulable || enCours || this.occupe, title: annulable ? `Opération du ${this.date(annulable.date)}` : 'Aucune optimisation à annuler', on: { click: () => this.annulerDerniere() } }),
        r ? h('button', { type: 'button', class: 'lien', text: 'Tout voir sur la carte', on: { click: () => this.voir(null) } }) : null,
        this.tableau.vueAvant ? h('button', { type: 'button', class: 'lien', text: 'Revenir à la vue précédente', on: { click: () => this.tableau.revenir() } }) : null),
      r ? h('p', { class: 'opt-legende-carte' }, h('span', { class: 'pastille conserve' }), ' conservé ', h('span', { class: 'pastille supprimer' }), ' à supprimer ', h('span', { class: 'pastille potentiel' }), ' potentiel') : null,
      this._confirmes(),
      this._potentiels(),
      this._supprimes(derniere),
      this._historique(),
    ];
  }

  _ligneBarage(b, extra = '') {
    const h2 = this.couche.hierarchie;
    const route = b.route ? [b.route.ref, b.route.nom].filter(Boolean).join(' · ') || b.route.classe : '—';
    return `${b.id} · ${b.name ?? '—'} · ${b.type ?? '?'} ${b.shift ?? ''} · ${h2?.brigades.get(b.btId)?.nom ?? b.btId ?? '—'} · ${route} · ${b.isSimulation === true ? 'simulé' : b.isSimulation === false ? 'réel' : 'origine ?'}${extra}`;
  }

  _plus(cle, liste) {
    const vus = this.pages[cle] * PAR_PAGE;
    return liste.length > vus ? this.h('button', { type: 'button', class: 'lien', text: `Afficher plus (${liste.length - vus} restants)`, on: { click: () => { this.pages[cle] += 1; this.tableau.rendre(); } } }) : null;
  }

  _confirmes() {
    const { h } = this;
    const r = this.resultat;
    if (!r) return h('p', { id: 'opt-dbl-confirmes', class: 'aide', text: 'Aucune analyse des doublons : « Analyser les doublons » (rien n’est modifié).' });
    const liste = r.confirmes;
    return h('section', { id: 'opt-dbl-confirmes', class: 'groupe' },
      h('h3', { text: `Doublons confirmés (${pluriel(liste.reduce((s, g) => s + g.doublons.length, 0), 'barage')} dans ${pluriel(liste.length, 'groupe')})` }),
      liste.length ? h('ol', { class: 'opt-liste' }, liste.slice(0, this.pages.confirmes * PAR_PAGE).map((g) => h('li', { class: 'opt-constat avertissement' },
        h('div', { class: 'opt-constat-tete' }, h('span', { class: 'opt-pastille conserve', text: 'Conservé' }), h('strong', { text: g.conserve.id }), h('span', { class: 'opt-categorie', text: g.conserve.source === 'local' ? 'ajout local' : 'fichier installé' })),
        h('p', { class: 'opt-ids', text: this._ligneBarage(g.conserve.barage) }),
        h('p', { class: 'aide', text: `Choisi : ${g.motif}.` }),
        g.doublons.map((d) => h('p', { class: 'opt-ids opt-supprime', text: `Supprimé : ${this._ligneBarage(d.barage, ` · à ${d.distanceM} m`)}${d.source === 'local' ? ' · ajout local' : ''}` })),
        Object.keys(g.fusion.champs).length ? h('p', { class: 'aide', text: `Complété depuis les doublons (champ vide sur le conservé) : ${Object.keys(g.fusion.champs).join(', ')}.` }) : null,
        g.fusion.conflits.length ? h('p', { class: 'aide', text: `Non fusionné (valeurs en conflit) : ${g.fusion.conflits.join(', ')} — la valeur du conservé est gardée.` }) : null,
        h('div', { class: 'opt-liens' }, h('button', { type: 'button', class: 'lien', text: 'Voir sur la carte', on: { click: () => this.voir(g.id) } }))))) : h('p', { class: 'aide', text: 'Aucun doublon confirmé dans ce périmètre.' }),
      this._plus('confirmes', liste));
  }

  _potentiels() {
    const { h } = this;
    const r = this.resultat;
    if (!r) return null;
    const liste = r.potentiels;
    const champs = ['id', 'name', 'type', 'shift', 'btId', 'latitude', 'longitude', 'route', 'isSimulation'];
    const val = (b, k) => (k === 'route' ? (b.route ? JSON.stringify(b.route) : '—') : k === 'btId' ? `${this.couche.hierarchie?.brigades.get(b.btId)?.nom ?? '?'} (${b.btId})` : String(b[k] ?? '—'));
    return h('section', { id: 'opt-dbl-potentiels', class: 'groupe' },
      h('h3', { text: `Doublons potentiels à vérifier (${liste.length})` }),
      h('p', { class: 'aide', text: 'Jamais supprimés automatiquement. Corrigez la source si l’un d’eux est un vrai doublon, ou ajustez les règles.' }),
      liste.length ? h('ol', { class: 'opt-liste' }, liste.slice(0, this.pages.potentiels * PAR_PAGE).map((p) => h('li', { class: 'opt-constat info' },
        h('div', { class: 'opt-constat-tete' }, h('span', { class: 'opt-pastille potentiel', text: 'À vérifier' }), h('strong', { text: p.enregistrements.map((e) => e.id).join(' / ') }), p.distanceM !== null ? h('span', { class: 'opt-categorie', text: `${p.distanceM} m` }) : null),
        h('p', { class: 'opt-raison', text: p.raisons.join(' ; ') || 'proches' }),
        p.differences.length ? h('p', { class: 'aide', text: `Champs différents : ${p.differences.map((k) => LIBELLES_DIFF[k] ?? k).join(', ')}` }) : null,
        h('div', { class: 'opt-liens' },
          h('button', { type: 'button', class: 'lien', text: 'Voir sur la carte', on: { click: () => this.voir(p.id) } }),
          h('button', { type: 'button', class: 'lien', text: this.compare === p.id ? 'Masquer la comparaison' : 'Comparer', on: { click: () => { this.compare = this.compare === p.id ? null : p.id; this.tableau.rendre(); } } })),
        this.compare === p.id ? h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison' },
          h('tbody', {}, champs.map((k) => {
            const v = p.enregistrements.map((e) => val(e.barage, k));
            return h('tr', { class: v[0] === v[1] ? 'egal' : 'different' }, h('th', { text: k }), v.map((x) => h('td', { text: x })));
          })))) : null))) : h('p', { class: 'aide', text: 'Aucun doublon potentiel.' }),
      this._plus('potentiels', liste));
  }

  _supprimes(derniere) {
    const { h } = this;
    if (!derniere) return h('section', { id: 'opt-dbl-supprimes', class: 'groupe' }, h('h3', { text: 'Doublons supprimés' }), h('p', { class: 'aide', text: 'Aucune optimisation effectuée dans ce navigateur.' }));
    return h('section', { id: 'opt-dbl-supprimes', class: 'groupe' },
      h('h3', { text: `Doublons supprimés — optimisation du ${this.date(derniere.date)}${derniere.statut === 'annulee' ? ' (annulée : rétablis)' : ''}` }),
      h('ul', { class: 'opt-refus' }, derniere.supprimes.slice(0, 100).map((s) => h('li', { text: `${s.id} → conservé ${s.conserve}${s.source === 'local' ? ' (ajout local)' : ''}` }))),
      derniere.supprimes.length > 100 ? h('p', { class: 'aide', text: `… et ${derniere.supprimes.length - 100} autres (détail dans l’historique enregistré).` }) : null);
  }

  _historique() {
    const { h } = this;
    const ops = this.historique.operations;
    return h('section', { class: 'groupe' },
      h('h3', { text: 'Historique des optimisations' }),
      ops.length ? h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison opt-historique' },
        h('thead', {}, h('tr', {}, ['Date', 'Périmètre', 'Détectés', 'Supprimés', 'Conservés', 'Complétés', 'Potentiels', 'Statut', 'Erreurs'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ops.map((o) => h('tr', {},
          h('td', { text: this.date(o.date) }),
          h('td', { text: this.tableau._libellePerimetre(o.perimetre) }),
          h('td', { text: String(o.detectes.doublons) }),
          h('td', { text: o.statut === 'terminee' || o.statut === 'annulee' ? String(o.supprimes.length) : '0' }),
          h('td', { text: String(o.conserves.length) }),
          h('td', { text: String(o.fusions.length) }),
          h('td', { text: String(o.detectes.potentiels) }),
          h('td', { text: `${LIBELLES_STATUT[o.statut] ?? o.statut}${o.annulation ? ` le ${this.date(o.annulation.date)}` : ''}` }),
          h('td', { text: o.erreurs.join(' ') || '—' })))))) : h('p', { class: 'aide', text: 'Aucune opération.' }),
      h('p', { class: 'aide', text: 'Historique et sauvegardes gardés dans ce navigateur (20 opérations au plus) : pas de serveur, pas de partage entre postes.' }));
  }

  /** Réglages dans l'onglet Règles ; `brouillon` est enregistré par le bouton commun. */
  reglages(brouillon) {
    const { h } = this;
    const nombre = (cle, libelle, min, max, pas) => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('input', { type: 'number', min, max, step: pas, value: String(brouillon[cle]), on: { input: (e) => { brouillon[cle] = Number(e.target.value); } } }));
    const cas = (cle, titre, aide) => h('label', { class: 'ligne-couche' }, h('span', { class: 'ligne-texte' }, h('strong', { text: titre }), h('small', { text: aide })),
      h('input', { type: 'checkbox', class: 'interrupteur', checked: brouillon[cle], on: { change: (e) => { brouillon[cle] = e.target.checked; } } }));
    const ordre = h('ol', { class: 'opt-criteres' });
    const dessiner = () => ordre.replaceChildren(...brouillon.criteres.map((c, i) => h('li', {}, LIBELLES_CRITERES[c],
      i ? h('button', { type: 'button', class: 'lien', text: '↑', 'aria-label': `Monter « ${LIBELLES_CRITERES[c]} »`, on: { click: () => { brouillon.criteres.splice(i - 1, 2, brouillon.criteres[i], brouillon.criteres[i - 1]); dessiner(); } } }) : null)));
    dessiner();
    return h('div', { class: 'groupe' }, h('h3', { text: 'Dédoublonnage (« Lancer le dédoublonnage »)' }),
      nombre('seuilConfirmeM', 'Doublon confirmé : distance maximale (m, 0 à 10)', 0, 10, 0.1),
      nombre('seuilPotentielM', 'Doublon potentiel : distance maximale (m)', 1, 2000, 1),
      cas('exigerMemeNom', 'Noms compatibles exigés', 'Deux noms différents (renseignés) font un doublon potentiel, pas confirmé.'),
      cas('fusionner', 'Compléter le barage conservé', 'Seulement les champs vides (nom, route, trace) et si les doublons s’accordent.'),
      h('div', { class: 'champ' }, h('span', { text: 'Barage conservé : ordre des critères' }), ordre,
        h('button', { type: 'button', class: 'lien', text: 'Ordre par défaut', on: { click: () => { brouillon.criteres = [...CRITERES_CANONIQUE]; dessiner(); } } })));
  }
}
