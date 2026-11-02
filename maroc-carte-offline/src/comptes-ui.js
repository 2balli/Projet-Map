/**
 * Comptes et rôles dans l'interface : session (la connexion se fait sur connexion.html, voir
 * session.js), superadmin (affectation des conflits, suivi, décisions, comptes, exports) et
 * compte régional / commandement (ses conflits, propositions).
 * Toutes les opérations passent par l'API du serveur (src/api.js → serveur/api.mjs), qui vérifie
 * les droits et la région ; cette interface ne fait que refléter ce que le serveur autorise.
 * Aucun barage n'est modifié ici : une proposition approuvée est exportée pour installation.
 */
import { ErreurApi, appelApi, telechargerApi } from './api.js';
import { seDeconnecter, versConnexion } from './session.js';
import { CONTINU, CRENEAUX, LIBELLES_CRENEAUX, numeroFaction } from './barages.js';
import { LIBELLE_PROTEGE, LIBELLES_TYPE, estProtege, formaterKm, libelleFaction, traitsPaire } from './proximite.js';

const pluriel = (n, un, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const coord = (b) => `${Number(b.latitude).toFixed(5)}, ${Number(b.longitude).toFixed(5)}`;
const CLASSES_STATUT = {
  'a-traiter': 'avertissement',
  'en-cours': 'info',
  'proposition-soumise': 'avertissement',
  'a-corriger': 'avertissement',
  approuve: 'ok',
  resolu: 'ok',
  rejete: 'info',
  'bloque-fixes': 'info',
  'conflit-persistant': 'erreur',
};
const ACTIONS = {
  cree: 'Créé', assigne: 'Assigné', reassigne: 'Réassigné', 'en-cours': 'Mis en cours', 'proposition-soumise': 'Proposition soumise',
  'decision-approuver': 'Proposition approuvée', 'decision-rejeter': 'Proposition rejetée', 'decision-corriger': 'Renvoyée pour correction', resolu: 'Marqué résolu',
};

export class EspaceComptes {
  /**
   * @param {import('./optimisation-ui.js').TableauOptimisation} tableau
   * @param {{ h: Function, date: Function, $: Function }} outils
   */
  constructor(tableau, { h, date, $ }) {
    Object.assign(this, { tableau, h, date, $ });
    this.compte = null;
    this.disponible = null; // null : pas encore su
    this.statuts = {};
    this.roles = {};
    this.conflits = [];
    this.comptes = [];
    this.choix = new Set(); // paires choisies (indices d'alerte) pour l'affectation
    this.filtre = '';
    this.ouverts = new Set();
    this.formulaires = {}; // saisies en cours (motifs, décisions)
    this.region = null;
    $('mc-connexion-formulaire').addEventListener('submit', (e) => e.preventDefault());
    $('mc-connexion-annuler').addEventListener('click', () => this.fermerConnexion());
    $('mc-deconnexion').addEventListener('click', () => this.deconnecter());
    $('mc-changer-mot-de-passe').addEventListener('click', () => window.location.assign('/connexion.html?changer=1'));
    for (const b of document.querySelectorAll('[data-compte]')) b.addEventListener('click', () => this.ouvrirConnexion());
  }

  /** Superadmin (« admin » : nom du rôle dans les premières versions). */
  get admin() { return this.compte?.role === 'superadmin' || this.compte?.role === 'admin'; }
  get commandement() { return this.compte?.role === 'commandement'; }

  /**
   * Session en cours (cookie HttpOnly : seul le serveur la connaît). `session` : réponse de
   * /api/moi déjà lue au démarrage (session.js), sinon relue ici.
   */
  async initialiser(session = undefined) {
    try {
      const r = session === undefined ? await appelApi('/api/moi') : session;
      if (!r) throw new ErreurApi(503, 'serveur de comptes indisponible');
      Object.assign(this, { compte: r.compte, region: r.region ?? null, statuts: r.statuts, roles: r.roles, disponible: true });
    } catch (erreur) {
      this.compte = null;
      this.disponible = erreur instanceof ErreurApi && erreur.statut === 401;
    }
    this._majBouton();
    return this.compte;
  }

  _majBouton() {
    for (const b of document.querySelectorAll('[data-compte]')) {
      const t = b.querySelector('span');
      if (t) t.textContent = !this.compte ? 'Connexion' : this.commandement ? this.region?.nom ?? this.compte.identifiant : this.compte.nom.split(' ')[0];
      b.setAttribute('aria-pressed', String(Boolean(this.compte)));
      b.title = this.compte ? `${this.compte.nom} — ${this.roles[this.compte.role] ?? this.compte.role}` : 'Se connecter';
    }
  }

  // ── Connexion ────────────────────────────────────────────────────────────

  /** Fenêtre « Compte » : qui est connecté, sa région, changer le mot de passe, se déconnecter. */
  ouvrirConnexion({ message = null } = {}) {
    // Connexion : toujours sur la page dédiée (le serveur y renvoie toute requête sans session).
    if (!this.compte && this.disponible) return versConnexion();
    const d = this.$('mc-connexion');
    this.$('mc-connexion-session').hidden = !this.compte;
    const role = this.compte ? this.roles[this.compte.role] ?? this.compte.role : '';
    this.$('mc-connexion-qui').textContent = this.compte ? `${this.compte.nom} (${this.compte.identifiant})` : '';
    this.$('mc-connexion-role').textContent = this.compte
      ? `${role}${this.compte.regId ? ` · région ${this.region?.nom ?? this.tableau.couche.hierarchie?.regions.get(this.compte.regId)?.nom ?? this.compte.regId} (${this.compte.regId}) — accès limité à cette région` : ' · accès à toutes les régions'}`
      : '';
    const info = this.$('mc-connexion-erreur');
    info.textContent = message ?? (this.disponible === false ? 'Serveur de comptes indisponible : lancez la carte avec « npm start » (ou l’image Docker). Sans lui, il n’y a ni comptes ni optimisation.' : '');
    info.hidden = !info.textContent;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  fermerConnexion() {
    const d = this.$('mc-connexion');
    if (typeof d.close === 'function' && d.open) d.close();
    else d.removeAttribute('open');
  }

  /** État de l'interface propre à l'utilisateur : effacé à chaque changement de compte. */
  _oublier() {
    this.conflits = [];
    this.comptes = [];
    this.choix.clear();
    this.ouverts.clear();
    this.formulaires = {};
    this.attenteChoix = null;
    this.filtre = '';
  }

  async deconnecter() {
    this.compte = null;
    this._oublier();
    this.tableau.fermer();
    await seDeconnecter();
  }

  /** Erreur de l'API : session expirée → page de connexion ; sinon message. */
  _erreur(e) {
    if (e instanceof ErreurApi && e.statut === 401) {
      this.compte = null;
      this._oublier();
      versConnexion('expire=1');
      return;
    }
    if (e instanceof ErreurApi && e.changer) {
      versConnexion('changer=1');
      return;
    }
    this.tableau.message = { type: 'erreur', texte: e.message };
    this.tableau.rendre();
  }

  async chargerConflits() {
    try {
      this.conflits = (await appelApi('/api/conflits')).conflits;
      // Noms des commandements assignés (administrateur seulement : le serveur refuse aux autres).
      if (this.admin) this.comptes = (await appelApi('/api/comptes')).comptes;
    } catch (e) {
      this._erreur(e);
    }
    this.tableau.rendre();
  }

  // ── Carte d'un conflit (itinéraire enregistré, pas de recalcul) ──────────

  voirConflit(c) {
    const [a, b] = c.barages;
    const p = c.proposition;
    if (!p) {
      const route = c.route?.chemin?.length >= 2 ? { statut: 'ok', distance: c.routeM, chemin: c.route.chemin, approximatif: c.route.approximatif } : null;
      const f = traitsPaire(a, b, route);
      this.tableau._afficher(f);
      this.tableau._cadrer(f.flatMap((x) => (x.geometry.type === 'Point' ? [x.geometry.coordinates] : x.geometry.coordinates)));
      return;
    }
    const f = [];
    const bCible = c.barages.find((x) => x.id === p.barageId) ?? a;
    const bPartenaire = c.barages.find((x) => x.id !== p.barageId) ?? b;

    if (p.type === 'deplacement') {
      const avant = p.avant ?? { latitude: bCible.latitude, longitude: bCible.longitude };
      const apres = p.position;
      f.push({ type: 'Feature', properties: { role: 'barage-actuel', texte: `${bCible.id} (ancienne pos.)` }, geometry: { type: 'Point', coordinates: [avant.longitude, avant.latitude] } });
      if (apres) {
        f.push({ type: 'Feature', properties: { role: 'barage-apres', texte: `${bCible.id} (nouvelle pos.)` }, geometry: { type: 'Point', coordinates: [apres.longitude, apres.latitude] } });
        f.push({ type: 'Feature', properties: { role: 'deplacement' }, geometry: { type: 'LineString', coordinates: [[avant.longitude, avant.latitude], [apres.longitude, apres.latitude]] } });
      }
      if (bPartenaire) {
        f.push({ type: 'Feature', properties: { role: 'barage-actuel', texte: `${bPartenaire.id} (partenaire)` }, geometry: { type: 'Point', coordinates: [bPartenaire.longitude, bPartenaire.latitude] } });
        if (c.evaluation && (!c.evaluation.resolu || c.evaluation.bloquant) && apres) {
          f.push({ type: 'Feature', properties: { role: 'route-violation', texte: 'Conflit persistant' }, geometry: { type: 'LineString', coordinates: [[apres.longitude, apres.latitude], [bPartenaire.longitude, bPartenaire.latitude]] } });
        }
      }
    } else if (p.type === 'faction' || p.type === 'modification-faction') {
      f.push({ type: 'Feature', properties: { role: 'barage-apres', texte: `${bCible.id} (nouv. Faction ${p.nouvelleFaction})` }, geometry: { type: 'Point', coordinates: [bCible.longitude, bCible.latitude] } });
      if (bPartenaire) {
        f.push({ type: 'Feature', properties: { role: 'barage-actuel', texte: `${bPartenaire.id} (Faction ${bPartenaire.shift})` }, geometry: { type: 'Point', coordinates: [bPartenaire.longitude, bPartenaire.latitude] } });
        if (c.evaluation && (!c.evaluation.resolu || c.evaluation.bloquant)) {
          f.push({ type: 'Feature', properties: { role: 'route-violation', texte: 'Conflit persistant' }, geometry: { type: 'LineString', coordinates: [[bCible.longitude, bCible.latitude], [bPartenaire.longitude, bPartenaire.latitude]] } });
        }
      }
    } else if (p.type === 'suppression') {
      f.push({ type: 'Feature', properties: { role: 'supprimer', texte: `${bCible.id} (supprimé)` }, geometry: { type: 'Point', coordinates: [bCible.longitude, bCible.latitude] } });
      if (bPartenaire) {
        f.push({ type: 'Feature', properties: { role: 'conserve', texte: `${bPartenaire.id} (conservé)` }, geometry: { type: 'Point', coordinates: [bPartenaire.longitude, bPartenaire.latitude] } });
      }
    }
    this.tableau._afficher(f);
    const pts = f.flatMap((x) => (x.geometry.type === 'Point' ? [x.geometry.coordinates] : x.geometry.coordinates));
    this.tableau._cadrer(pts);
  }

  // ── Administrateur : affectation des résultats ───────────────────────────

  /** Crée les conflits choisis sur le serveur puis les assigne au commandement de la région. */
  async assigner(commandementId = null) {
    const r = this.tableau.proximite.resultat;
    if (!r || !this.choix.size) return;
    const regId = r.regles.perimetre.reg;
    const paires = [...this.choix].map((i) => ({ i, p: r.paires[i], a: r.alertes[i], route: r.routes[i] }))
      .filter(({ p }) => p.a.source === 'fichier' && p.b.source === 'fichier')
      .map(({ a, route }) => ({ ids: a.ids, routeM: a.routeM, route: route?.statut === 'ok' ? { chemin: route.chemin, secondes: route.secondes, approximatif: route.approximatif } : null }));
    if (!paires.length) {
      this.tableau.message = { type: 'erreur', texte: 'Les paires choisies contiennent des ajouts locaux : seuls les barages du jeu installé peuvent être assignés.' };
      return this.tableau.rendre();
    }
    try {
      const cree = await appelApi('/api/conflits', { methode: 'POST', corps: { regId, seuilKm: r.regles.distanceMaxKm, paires } });
      const ids = cree.crees.map((c) => c.id);
      if (ids.length) {
        try {
          await appelApi('/api/conflits/assigner', { methode: 'POST', corps: { conflitIds: ids, commandementId } });
        } catch (e) {
          if (e instanceof ErreurApi && e.statut === 409) {
            // Aucun ou plusieurs commandements : choix explicite.
            const cmds = (await appelApi(`/api/commandements?regId=${encodeURIComponent(regId)}`)).commandements.filter((x) => x.actif);
            this.attenteChoix = { ids, regId, cmds, raison: e.message };
            this.tableau.message = { type: 'info', texte: `${pluriel(ids.length, 'conflit enregistré', 'conflits enregistrés')} mais non assigné${ids.length > 1 ? 's' : ''} : ${e.message}.` };
            this.choix.clear();
            return this.tableau.rendre();
          }
          throw e;
        }
      }
      this.choix.clear();
      const ignores = cree.ignores.length ? ` ${pluriel(cree.ignores.length, 'paire écartée', 'paires écartées')} par le serveur (${[...new Set(cree.ignores.map((x) => x.raison))].join(' ; ')}).` : '';
      this.tableau.message = { type: 'ok', texte: `${pluriel(ids.length, 'conflit assigné', 'conflits assignés')} au commandement de ${this.tableau.couche.hierarchie?.regions.get(regId)?.nom ?? regId}.${ignores}` };
      await this.chargerConflits();
    } catch (e) {
      this._erreur(e);
    }
  }

  async assignerA(ids, commandementId) {
    try {
      await appelApi('/api/conflits/assigner', { methode: 'POST', corps: { conflitIds: ids, commandementId } });
      this.attenteChoix = null;
      this.tableau.message = { type: 'ok', texte: `${pluriel(ids.length, 'conflit assigné', 'conflits assignés')}.` };
      await this.chargerConflits();
    } catch (e) {
      this._erreur(e);
    }
  }

  /** Cases à cocher et bouton « Assigner au commandement » sous les résultats (administrateur). */
  rendreAffectation(violations) {
    const { h } = this;
    if (!this.admin || !violations.length) return null;
    const n = [...this.choix].filter((i) => violations.includes(i)).length;
    const a = this.attenteChoix;
    return h('div', { class: 'groupe opt-affectation' },
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'lien', text: n === violations.length ? 'Tout désélectionner' : 'Tout sélectionner', on: { click: () => { if (n === violations.length) this.choix.clear(); else for (const i of violations) this.choix.add(i); this.tableau.rendre(); } } }),
        h('button', { type: 'button', class: 'bouton-principal', text: `Assigner au commandement${n ? ` (${n})` : ''}`, disabled: !n, on: { click: () => this.assigner() } })),
      a ? h('div', { class: 'groupe' },
        h('p', { class: 'opt-message info', text: `Choisissez le commandement responsable (${a.raison}).` }),
        a.cmds.length ? h('div', { class: 'opt-actions' }, a.cmds.map((c) => h('button', { type: 'button', class: 'bouton-outil', text: c.nom, on: { click: () => this.assignerA(a.ids, c.id) } })))
          : h('p', { class: 'aide', text: 'Aucun commandement actif pour cette région : créez son compte (onglet Comptes), puis assignez depuis « Conflits ».' })) : null);
  }

  caseChoix(i) {
    const { h } = this;
    if (!this.admin) return null;
    return h('label', { class: 'opt-choix' }, h('input', { type: 'checkbox', checked: this.choix.has(i), 'data-choix': i, on: { change: (e) => { if (e.target.checked) this.choix.add(i); else this.choix.delete(i); this.tableau.rendre(); } } }), ' Choisir');
  }

  // ── Administrateur : suivi des conflits et décisions ─────────────────────

  async decider(c, decision) {
    const raison = (this.formulaires[`d-${c.id}`] ?? '').trim();
    try {
      await appelApi(`/api/conflits/${c.id}/decision`, { methode: 'POST', corps: { decision, raison } });
      this.formulaires[`d-${c.id}`] = '';
      this.tableau.message = { type: 'ok', texte: `Conflit ${c.id} : ${{ approuver: 'proposition approuvée (à appliquer par l’export)', rejeter: 'proposition rejetée', corriger: 'renvoyé au commandement pour correction' }[decision]}.` };
      await this.chargerConflits();
    } catch (e) {
      this._erreur(e);
    }
  }

  async marquerResolu(c) {
    try {
      await appelApi(`/api/conflits/${c.id}/resolu`, { methode: 'POST', corps: { note: (this.formulaires[`r-${c.id}`] ?? '').trim() } });
      this.tableau.message = { type: 'ok', texte: `Conflit ${c.id} résolu.` };
      await this.chargerConflits();
    } catch (e) {
      this._erreur(e);
    }
  }

  async exporter(type) {
    try {
      if (type === 'changements') await telechargerApi('/api/changements-approuves', 'changements-approuves.json');
      else await telechargerApi('/api/barages-mis-a-jour', 'barages.json');
      this.tableau.message = { type: 'ok', texte: type === 'changements' ? 'Changements approuvés exportés.' : 'barages.json mis à jour téléchargé : installez-le à la place de donnees/barages/barages.json, puis marquez les conflits résolus.' };
    } catch (e) {
      this._erreur(e);
      return;
    }
    this.tableau.rendre();
  }

  _champTexte(cle, libelle, { lignes = 2 } = {}) {
    const { h } = this;
    return h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('textarea', { rows: lignes, 'data-formulaire': cle, value: this.formulaires[cle] ?? '', on: { input: (e) => { this.formulaires[cle] = e.target.value; } } }));
  }

  _ligneBarage(b) {
    const { h } = this;
    const protege = b.protege ?? estProtege(b);
    return h('div', { class: 'opt-barage-alerte' },
      h('p', { class: 'opt-ids', text: `${b.name ?? b.id} · ${b.id} · ${coord(b)}` }),
      h('div', { class: 'opt-constat-tete' },
        h('span', { class: `opt-pastille ${protege ? 'protege' : 'mobile'}`, text: protege ? LIBELLE_PROTEGE : 'Déplaçable' }),
        h('span', { class: 'opt-categorie', text: LIBELLES_TYPE[b.type] ?? b.type })));
  }

  _historique(c) {
    const { h } = this;
    return h('details', { class: 'opt-details' }, h('summary', { text: `Historique (${c.historique.length})` }),
      h('ol', { class: 'opt-refus' }, c.historique.map((x) => h('li', { text: `${this.date(x.date)} · ${ACTIONS[x.action] ?? x.action} · ${x.acteurNom}${x.raison ? ` — « ${x.raison} »` : ''}${x.note ? ` — ${x.note}` : ''}${x.a ? ` → ${x.a.nom}` : ''}` }))));
  }

  _proposition(c) {
    const { h } = this;
    const p = c.proposition;
    if (!p) return null;
    const b = c.barages.find((x) => x.id === p.barageId) ?? { id: p.barageId };
    const autre = c.barages.find((x) => x.id !== p.barageId) ?? c.barages[0];

    const typeLabels = {
      deplacement: 'Déplacement de barrage',
      faction: 'Changement de faction',
      'modification-faction': 'Changement de faction',
      suppression: 'Suppression de barrage',
    };

    let avantApres = null;
    if (p.type === 'deplacement') {
      avantApres = h('div', { class: 'opt-comparaison' },
        h('p', { class: 'opt-ids', text: `Avant : ${coord(p.avant ?? b)}` }),
        p.position ? h('p', { class: 'opt-ids', text: `Après : ${coord(p.position)}` }) : null);
    } else if (p.type === 'faction' || p.type === 'modification-faction') {
      const fAvant = p.avant?.shift ?? c.faction;
      avantApres = h('div', { class: 'opt-comparaison' },
        h('p', { text: `Avant : Faction ${fAvant} (${LIBELLES_CRENEAUX[fAvant] ?? fAvant})` }),
        h('p', { text: `Après : Faction ${p.nouvelleFaction} (${LIBELLES_CRENEAUX[p.nouvelleFaction] ?? p.nouvelleFaction})` }));
    } else if (p.type === 'suppression') {
      avantApres = h('div', { class: 'opt-comparaison' },
        h('p', { text: `Avant : En service · ${coord(p.avant ?? b)} · Faction ${p.avant?.shift ?? c.faction}` }),
        h('p', { text: 'Après : Supprimé du jeu actif (conservé dans l’historique)' }));
    }

    const evalRes = c.evaluation;
    let blocVerification = null;
    if (evalRes) {
      const ok = evalRes.resolu && !evalRes.bloquant;
      blocVerification = h('div', { class: `opt-message ${ok ? 'ok' : 'erreur'}` },
        h('strong', { text: ok ? '✓ Résultat de la vérification : ' : '✗ Résultat de la vérification : ' }),
        h('span', { text: evalRes.motif }));
    } else if (p.validation) {
      blocVerification = h('p', { class: 'aide', text: `Vérification routière : ${{ valide: 'emplacement valide', 'verification-impossible': 'vérification impossible' }[p.validation.statut] ?? p.validation.statut}${p.validation.minimumM ? ` · plus proche voisin : ${formaterKm(p.validation.minimumM)}` : ''}` });
    }

    return h('div', { class: 'groupe opt-etude' },
      h('div', { class: 'opt-constat-tete' },
        h('strong', { text: `Action effectuée : ${typeLabels[p.type] ?? p.type} (${b.name ?? p.barageId})` }),
        h('span', { class: 'opt-categorie', text: `Conflit initial avec ${autre?.name ?? autre?.id} (${autre?.id})` })),
      avantApres,
      h('p', { text: `Motif du traitement : ${p.raison}` }),
      h('p', { class: 'aide', text: `Traitement effectué le ${this.date(p.soumiseLe)} par ${p.soumiseParNom ?? p.soumisePar ?? 'Commandement'}` }),
      blocVerification);
  }

  _carteConflit(c, { admin }) {
    const { h } = this;
    const ouvert = this.ouverts.has(c.id);
    const cmd = this.comptes.find((x) => x.id === c.assigneA);

    let statutLabel = this.statuts[c.statut] ?? c.statut;
    let statutClasse = CLASSES_STATUT[c.statut] ?? 'info';
    if (c.statut === 'proposition-soumise') {
      if (c.evaluation && (!c.evaluation.resolu || c.evaluation.bloquant)) {
        statutLabel = 'Conflit toujours présent';
        statutClasse = 'erreur';
      } else {
        statutLabel = 'En attente d’approbation';
        statutClasse = 'avertissement';
      }
    }

    const corps = [
      h('div', { class: 'opt-constat-tete' },
        h('span', { class: `opt-pastille ${statutClasse}`, text: statutLabel }),
        h('strong', { text: c.id }),
        h('span', { class: 'opt-categorie', text: `${c.regNom} · ${libelleFaction(c.faction)}` })),
      ...c.barages.map((b) => this._ligneBarage(b)),
      h('dl', { class: 'insp-lignes opt-detail' },
        h('dt', { text: 'Conflit initial' }), h('dd', { text: `Distance ${formaterKm(c.routeM)} (seuil ${formaterKm(c.seuilM)})` }),
        admin ? h('dt', { text: 'Commandement' }) : null, admin ? h('dd', { text: c.assigneA ? `${cmd?.nom ?? c.assigneA} (assigné le ${this.date(c.assigneLe)})` : 'non assigné' }) : null,
        c.decision ? h('dt', { text: 'Décision' }) : null, c.decision ? h('dd', { text: `${{ approuver: 'Approuvée', rejeter: 'Rejetée', corriger: 'Renvoyée pour correction' }[c.decision.decision]} — « ${c.decision.raison} » (${this.date(c.decision.le)})` }) : null),
      c.informatif ? h('p', { class: 'aide', text: 'Deux barages fixes intouchables : conflit pour information, ni déplacement ni suppression.' }) : null,
      this._proposition(c),
      h('div', { class: 'opt-liens' },
        h('button', { type: 'button', class: 'lien', text: 'Voir sur la carte', on: { click: () => this.voirConflit(c) } }),
        h('button', {
          type: 'button',
          class: 'lien',
          text: ouvert ? 'Masquer' : (admin ? 'Examiner' : 'Traiter'),
          on: { click: () => { if (ouvert) this.ouverts.delete(c.id); else this.ouverts.add(c.id); this.tableau.rendre(); } },
        })),
    ];
    if (ouvert) corps.push(admin ? this._actionsAdmin(c) : this._actionsCommandement(c), this._historique(c));
    return h('li', { class: `opt-constat ${c.informatif ? 'info' : (c.statut === 'approuve' ? 'ok' : 'avertissement')}`, 'data-conflit': c.id }, corps);
  }

  _actionsAdmin(c) {
    const { h } = this;
    if (c.statut === 'proposition-soumise') {
      const peutApprouver = Boolean(c.evaluation ? (c.evaluation.resolu && !c.evaluation.bloquant) : true);
      const motifCle = `d-${c.id}`;
      return h('div', { class: 'groupe opt-etude' },
        h('strong', { text: 'Validation par le Superadmin' }),
        !peutApprouver && c.evaluation ? h('p', { class: 'opt-message avertissement', text: `Approbation bloquée : ${c.evaluation.motif}` }) : null,
        this._champTexte(motifCle, 'Motif de l’approbation / décision (obligatoire)'),
        h('div', { class: 'opt-actions' },
          h('button', {
            type: 'button',
            class: 'bouton-principal',
            text: 'Approuver',
            disabled: !peutApprouver,
            title: peutApprouver ? 'Valider et approuver la résolution du conflit' : `Approbation impossible : ${c.evaluation?.motif ?? 'Conflit non résolu'}`,
            on: { click: () => this.decider(c, 'approuver') },
          }),
          h('button', { type: 'button', class: 'bouton-outil', text: 'Renvoyer pour correction', on: { click: () => this.decider(c, 'corriger') } }),
          h('button', { type: 'button', class: 'lien', text: 'Rejeter', on: { click: () => this.decider(c, 'rejeter') } })),
        h('p', { class: 'aide', text: 'L’approbation valide la résolution et conserve l’historique complet. Aucun barage actif n’est modifié sans le processus d’installation.' }));
    }
    if (c.statut === 'approuve') {
      return h('div', { class: 'groupe' },
        h('p', { class: 'opt-message ok', text: `Résolution approuvée par ${c.decision?.parNom ?? 'Superadmin'} le ${this.date(c.decision?.le)} : « ${c.decision?.raison} »` }),
        this._champTexte(`r-${c.id}`, 'Note d’application (ex. « barages.json réinstallé le … »)'),
        h('button', { type: 'button', class: 'bouton-outil', text: 'Marquer résolu', on: { click: () => this.marquerResolu(c) } }));
    }
    if (!c.assigneA && !['resolu', 'rejete'].includes(c.statut)) {
      return h('div', { class: 'opt-actions' }, h('button', { type: 'button', class: 'bouton-outil', text: 'Assigner au commandement', on: { click: () => this.assignerA([c.id], null) } }));
    }
    return null;
  }

  rendreConflitsAdmin() {
    const { h } = this;
    const liste = this.conflits.filter((c) => !this.filtre || c.statut === this.filtre);
    const n = (s) => this.conflits.filter((c) => c.statut === s).length;
    return [
      h('div', { class: 'opt-actions' },
        h('label', { class: 'champ' }, h('span', { text: 'Statut' }), h('select', { on: { change: (e) => { this.filtre = e.target.value; this.tableau.rendre(); } } },
          h('option', { value: '', text: `Tous (${this.conflits.length})` }),
          Object.entries(this.statuts).map(([k, v]) => h('option', { value: k, text: `${v} (${n(k)})`, selected: this.filtre === k })))),
        h('button', { type: 'button', class: 'lien', text: 'Actualiser', on: { click: () => this.chargerConflits() } })),
      n('approuve') ? h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-outil', text: 'Exporter les changements approuvés', on: { click: () => this.exporter('changements') } }),
        h('button', { type: 'button', class: 'bouton-outil', text: 'Télécharger barages.json mis à jour', on: { click: () => this.exporter('barages') } })) : null,
      liste.length ? h('ol', { class: 'opt-liste' }, liste.map((c) => this._carteConflit(c, { admin: true }))) : h('p', { class: 'aide', text: 'Aucun conflit enregistré : lancez « Optimisation », choisissez des paires, puis « Assigner au commandement ».' }),
    ];
  }

  // ── Administrateur : comptes ─────────────────────────────────────────────

  async chargerComptes() {
    try {
      this.comptes = (await appelApi('/api/comptes')).comptes;
    } catch (e) {
      this._erreur(e);
    }
    this.tableau.rendre();
  }

  async creerCommandement() {
    const f = this.formulaires;
    try {
      const r = await appelApi('/api/comptes', { methode: 'POST', corps: { identifiant: f.cIdentifiant, nom: f.cNom, regId: f.cRegion, motDePasse: f.cMotDePasse, role: 'commandement' } });
      Object.assign(f, { cIdentifiant: '', cNom: '', cMotDePasse: '' });
      this.tableau.message = { type: 'ok', texte: `Compte ${r.compte.identifiant} créé (commandement régional).` };
      await this.chargerComptes();
    } catch (e) {
      this._erreur(e);
    }
  }

  async modifierCompte(c, champs, texte) {
    try {
      await appelApi(`/api/comptes/${c.id}`, { methode: 'POST', corps: champs });
      this.tableau.message = { type: 'ok', texte };
      await this.chargerComptes();
    } catch (e) {
      this._erreur(e);
    }
  }

  rendreComptes() {
    const { h } = this;
    const f = this.formulaires;
    const regions = [...(this.tableau.couche.hierarchie?.regions.values() ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const champ = (cle, libelle, type = 'text') => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('input', { type, autocomplete: type === 'password' ? 'new-password' : 'off', 'data-formulaire': cle, value: f[cle] ?? '', on: { input: (e) => { f[cle] = e.target.value; } } }));
    return [
      h('div', { class: 'groupe' }, h('h3', { text: 'Nouveau commandement régional' }),
        h('div', { class: 'opt-filtres' },
          champ('cIdentifiant', 'Identifiant'), champ('cNom', 'Nom'),
          h('label', { class: 'champ' }, h('span', { text: 'Région' }), h('select', { 'data-formulaire': 'cRegion', on: { change: (e) => { f.cRegion = e.target.value; } } },
            h('option', { value: '', text: '— Choisir —' }), regions.map((r) => h('option', { value: r.id, text: r.nom, selected: f.cRegion === r.id })))),
          champ('cMotDePasse', 'Mot de passe initial (10 caractères au moins)', 'password')),
        h('button', { type: 'button', class: 'bouton-principal', text: 'Créer le compte', on: { click: () => this.creerCommandement() } })),
      h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison' },
        h('thead', {}, h('tr', {}, ['Identifiant', 'Nom', 'Rôle', 'Région', 'État', ''].map((t) => h('th', { text: t })))),
        h('tbody', {}, this.comptes.map((c) => h('tr', {},
          h('td', { text: c.identifiant }), h('td', { text: c.nom }), h('td', { text: this.roles[c.role] ?? c.role }),
          h('td', { text: c.regId ? this.tableau.couche.hierarchie?.regions.get(c.regId)?.nom ?? c.regId : '—' }), h('td', { text: c.actif ? 'actif' : 'désactivé' }),
          h('td', {}, c.id === this.compte.id ? null : h('button', { type: 'button', class: 'lien', text: c.actif ? 'Désactiver' : 'Réactiver', on: { click: () => this.modifierCompte(c, { actif: !c.actif }, `Compte ${c.identifiant} ${c.actif ? 'désactivé' : 'réactivé'}.`) } }),
            h('button', { type: 'button', class: 'lien', text: 'Nouveau mot de passe', on: { click: () => { const m = window.prompt(`Nouveau mot de passe pour ${c.identifiant} (10 caractères au moins) :`); if (m) this.modifierCompte(c, { motDePasse: m }, `Mot de passe de ${c.identifiant} changé.`); } } }))))))),
      h('p', { class: 'aide', text: 'Le premier administrateur se crée sur le poste du serveur : npm run comptes -- creer-admin <identifiant> "<Nom>". Les mots de passe sont hachés (scrypt) ; un compte désactivé est déconnecté aussitôt.' }),
    ];
  }

  // ── Commandement régional : ses conflits, ses propositions ───────────────

  async marquerEnCours(c) {
    try {
      await appelApi(`/api/conflits/${c.id}/en-cours`, { methode: 'POST' });
      await this.chargerConflits();
    } catch (e) {
      this._erreur(e);
    }
  }

  async proposer(c, corps) {
    try {
      await appelApi(`/api/conflits/${c.id}/proposition`, { methode: 'POST', corps });
      this.tableau.message = { type: 'ok', texte: `Proposition soumise au superadmin pour ${c.id}. Aucun barage n’est modifié avant sa décision.` };
      await this.chargerConflits();
      return true;
    } catch (e) {
      this._erreur(e);
      return false;
    }
  }

  /** Déplacement : l'étude routière de la carte (marqueur, même règle), puis soumission. */
  proposerDeplacement(c, b) {
    const enr = this.tableau.couche.instantane()?.enregistrements.find((e) => e.barage?.id === b.id && e.source === 'fichier');
    if (!enr) {
      this.tableau.message = { type: 'erreur', texte: `${b.id} n’est pas dans le jeu installé chargé : activez la couche Barages.` };
      return this.tableau.rendre();
    }
    const autre = c.barages.find((x) => x.id !== b.id);
    const partenaire = this.tableau.couche.instantane().enregistrements.find((e) => e.barage?.id === autre.id) ?? null;
    this.tableau.proximite.etudierBarage(enr, {
      partenaire, seuilKm: c.seuilM / 1000,
      proposition: { conflitId: c.id, soumettre: (donnees) => this.proposer(c, { type: 'deplacement', barageId: b.id, ...donnees }) },
    });
  }

  _actionsCommandement(c) {
    const { h } = this;
    const ouvert = ['a-traiter', 'en-cours', 'a-corriger'].includes(c.statut) && !c.informatif;
    if (!ouvert) return h('p', { class: 'aide', text: c.informatif ? 'Conflit pour information : barages fixes intouchables, aucune action.' : `Statut : ${this.statuts[c.statut] ?? c.statut}.` });
    const mobiles = c.barages.filter((b) => !b.protege);
    const cle = `s-${c.id}`;
    const cleF = `f-${c.id}`;
    return h('div', { class: 'groupe' },
      c.statut !== 'en-cours' ? h('button', { type: 'button', class: 'bouton-outil', text: 'Marquer en cours', on: { click: () => this.marquerEnCours(c) } }) : null,
      mobiles.map((b) => h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-principal', text: `Proposer un déplacement de ${b.id}`, on: { click: () => this.proposerDeplacement(c, b) } }),
        h('button', { type: 'button', class: 'bouton-outil', text: `Changer la faction de ${b.id}`, on: { click: () => { this.formulaires[`${cleF}-b`] = b.id; delete this.formulaires[`${cle}-b`]; this.tableau.rendre(); } } }),
        h('button', { type: 'button', class: 'lien', text: `Proposer la suppression de ${b.id}`, on: { click: () => { this.formulaires[`${cle}-b`] = b.id; delete this.formulaires[`${cleF}-b`]; this.tableau.rendre(); } } }))),
      this.formulaires[`${cleF}-b`] ? h('div', { class: 'groupe opt-etude' },
        h('strong', { text: `Changement de faction : ${this.formulaires[`${cleF}-b`]}` }),
        h('label', { class: 'champ' }, h('span', { text: 'Nouvelle faction' }),
          h('select', { on: { change: (e) => { this.formulaires[`${cleF}-nouv`] = e.target.value; } } },
            h('option', { value: '', text: '— Choisir une faction —' }),
            CRENEAUX.map((cr) => h('option', { value: cr, text: `Faction ${numeroFaction(cr)} · ${LIBELLES_CRENEAUX[cr]} (${cr})`, selected: this.formulaires[`${cleF}-nouv`] === cr })))),
        this._champTexte(cleF, 'Motif (obligatoire)'),
        h('div', { class: 'opt-actions' },
          h('button', {
            type: 'button',
            class: 'bouton-principal',
            text: 'Soumettre le changement de faction',
            on: {
              click: async () => {
                const nouv = this.formulaires[`${cleF}-nouv`];
                const r = this.formulaires[cleF] ?? '';
                if (!nouv) {
                  this.tableau.message = { type: 'erreur', texte: 'Veuillez sélectionner une nouvelle faction.' };
                  return this.tableau.rendre();
                }
                if (await this.proposer(c, { type: 'faction', barageId: this.formulaires[`${cleF}-b`], nouvelleFaction: nouv, raison: r })) {
                  delete this.formulaires[`${cleF}-b`];
                  delete this.formulaires[`${cleF}-nouv`];
                  delete this.formulaires[cleF];
                }
              },
            },
          }),
          h('button', { type: 'button', class: 'lien', text: 'Annuler', on: { click: () => { delete this.formulaires[`${cleF}-b`]; this.tableau.rendre(); } } }))) : null,
      this.formulaires[`${cle}-b`] ? h('div', { class: 'groupe opt-etude' },
        h('strong', { text: `Suppression proposée : ${this.formulaires[`${cle}-b`]}` }),
        this._champTexte(cle, 'Motif (obligatoire)'),
        h('p', { class: 'aide', text: 'Si le superadmin approuve, le barage sortira du jeu actif ; son enregistrement d’origine est conservé dans l’historique.' }),
        h('div', { class: 'opt-actions' },
          h('button', { type: 'button', class: 'bouton-principal', text: 'Soumettre la proposition au superadmin', on: { click: async () => { if (await this.proposer(c, { type: 'suppression', barageId: this.formulaires[`${cle}-b`], raison: this.formulaires[cle] ?? '' })) { delete this.formulaires[`${cle}-b`]; delete this.formulaires[cle]; } } } }),
          h('button', { type: 'button', class: 'lien', text: 'Annuler', on: { click: () => { delete this.formulaires[`${cle}-b`]; this.tableau.rendre(); } } }))) : null,
      c.barages.some((b) => b.protege) ? h('p', { class: 'aide', text: `${c.barages.filter((b) => b.protege).map((b) => b.id).join(', ')} : ${LIBELLE_PROTEGE}, aucune action possible.` }) : null);
  }

  rendreCommandement() {
    const { h } = this;
    const nomRegion = this.tableau.couche.hierarchie?.regions.get(this.compte.regId)?.nom ?? this.compte.regId;
    return [
      h('p', { class: 'opt-resume-simple' }, h('strong', { text: `Commandement régional — ${nomRegion}` }), ` · ${pluriel(this.conflits.length, 'conflit assigné', 'conflits assignés')}`),
      h('div', { class: 'opt-actions' }, h('button', { type: 'button', class: 'lien', text: 'Actualiser', on: { click: () => this.chargerConflits() } })),
      this.conflits.length ? h('ol', { class: 'opt-liste' }, this.conflits.map((c) => this._carteConflit(c, { admin: false }))) : h('p', { class: 'aide', text: 'Aucun conflit assigné à votre commandement.' }),
      h('p', { class: 'aide', text: 'Vous proposez ; l’administrateur décide. Aucun barage n’est modifié par cet espace.' }),
    ];
  }
}
