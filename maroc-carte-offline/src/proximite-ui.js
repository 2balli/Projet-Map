/**
 * Onglets « Proximité », « Déplacements » et « Carte de chaleur » du tableau d'optimisation.
 *
 * Une seule règle, partout (proximite.js) : deux barages de la MÊME faction sont trop proches si
 * leur distance PAR LA ROUTE est ≤ D (km choisi par l'utilisateur). Elle sert à l'analyse des
 * paires, au déplacement interactif (validation en direct), à la carte de chaleur et à la
 * création d'un barage. Itinéraires : moteur de la carte (worker), mis en cache par paire.
 *
 * Rien n'est déplacé ni créé sans aperçu puis confirmation ; aucun emplacement, route ou
 * limite n'est inventé.
 */
import * as maplibregl from 'maplibre-gl';
import { CONTINU, traceValidation, validerBarage } from './barages.js';
import { EMPRISE_TUILES } from './carte-style.js';
import { contient } from './competence.js';
import { annulerEntree, appliquerAuxEditions, memeValeur } from './optimisation.js';
import {
  LIBELLES_TYPE, LIBELLE_PROTEGE, TYPES, estProtege, reglesSimples, resultatsNonConformes,
  CLASSES_CANDIDAT, CacheItineraires, INCONNU, SANS_ROUTE, aptitudeEn, couleurAptitude, grilleAptitude, indexerCandidats, libelleAptitude, FACTIONS, LIBELLES_VALIDATION, LIMITES, REGLES_PROXIMITE, STATUTS_PROPOSITION, ajouterAnalyse,
  ajouterProposition, alerte, cibleZone, classerCandidat, compterPropositions, distancesRoute, factionDe, formaterDuree, formaterKm,
  libelleFaction, lireHistoriqueProximite, majProposition, parTranche, traitsPaire, validerEmplacementRoutier, validerReglesProximite,
} from './proximite.js';

const CLE_REGLES = 'maroc-carte:optimisation:proximite:regles:v2';
const CLE_CHALEUR = 'maroc-carte:optimisation:chaleur:regles:v1';
const CLE_HISTORIQUE = 'maroc-carte:optimisation:proximite:v1';
const PAR_PAGE = 25;
const MAX_CANDIDATS = 1000;
const LARGEUR_SURFACE = 480; // pixels de la grille d'aptitude (lissée à l'affichage)
const LIBELLES_ORIGINE = { simulation: 'Simulés', reelle: 'Réels', toutes: 'Les deux (jamais mélangés)' };
const PRIORITE = 'court'; // plus court itinéraire : la distance routière la plus courte entre deux barages

const lire = (cle) => {
  try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch { return null; }
};
const ecrire = (cle, valeur) => {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); return true; } catch { return false; }
};
const pluriel = (n, un, plusieurs = `${un}s`) => `${n} ${n > 1 ? plusieurs : un}`;
const coord = (b) => `${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}`;
const nouvelId = (prefixe) => `${prefixe}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const texteRoute = (r) => (!r ? '…' : r.statut === 'ok'
  ? `${formaterKm(r.distance)}${r.secondes ? ` · ≈ ${formaterDuree(r.secondes)} (estimation)` : ''}${r.approximatif ? ' · tracé approximatif' : ''}`
  : r.statut === 'erreur' ? `Distance routière indisponible (erreur : ${r.erreur})` : 'Distance routière indisponible');
const nomRoute = (r) => [r?.ref, r?.nom].filter(Boolean).join(' · ') || (r?.classe ? `route ${r.classe}` : '—');
/** Modèle (type, faction) d'un nouveau barage d'une faction. */
const modeleFaction = (faction, isSimulation) => (faction === CONTINU ? { type: 'intouchable', shift: CONTINU, isSimulation } : { type: 'fixe', shift: faction, isSimulation });
const CLASSES_VALIDATION = { valide: 'ok', 'non-valide': 'erreur', 'verification-impossible': 'info' };

export class CentreProximite {
  /**
   * @param {import('./optimisation-ui.js').TableauOptimisation} tableau
   * @param {{ h: Function, date: Function, reseau: { itineraire: Function } | null, arreterOutils?: () => void }} options
   */
  constructor(tableau, { h, date, reseau, arreterOutils = () => {} }) {
    Object.assign(this, { tableau, h, date, arreterOutils });
    this.reseau = reseau ? new CacheItineraires(reseau) : null;
    const { regles } = validerReglesProximite(lire(CLE_REGLES) ?? {});
    this.regles = regles ?? { ...REGLES_PROXIMITE };
    this.reglesChaleur = { distanceMaxKm: 5, faction: FACTIONS[0], origine: 'simulation', perimetre: { reg: '', cie: '', bt: '' }, ...(lire(CLE_CHALEUR) ?? {}) };
    this.historique = lireHistoriqueProximite(lire(CLE_HISTORIQUE));
    this.etat = { etat: 'inactif', n: 0, fait: 0, total: 0, etape: '' };
    this.resultat = null;
    this.page = 1;
    this.selection = null;
    this.etude = null;
    this.choix = false; // les clics sur la carte déplacent l'emplacement étudié
    this.occupe = false;
    this.marqueur = null;
    this.zone = null; // zone cadrée et surlignée
    this.chaleur = { etat: 'inactif', n: 0, fait: 0, total: 0, etape: '', resultat: null, selection: null, apercu: null };
    this.popup = null;
    this._delai = null;
    tableau.carte.on('click', (e) => this._surClic(e));
    // Barages modifiés (ici ou ailleurs) : la carte de chaleur affichée est recalculée.
    this.couche.surDonnees(() => {
      if ((this.chaleur.resultat || this.chaleur.etat === 'en-cours') && this.chaleur.version !== this.couche.version) this._planifierChaleur();
    });
  }

  get couche() { return this.tableau.couche; }

  /** Les clics de la carte sont-ils à nous ? (les fiches de la Gendarmerie ne s'ouvrent pas) */
  capteClic(e) {
    if (this.choix) return true;
    return Boolean(e?.lngLat) && this._surSurface([e.lngLat.lng, e.lngLat.lat]);
  }

  /** Le point est-il sur la surface affichée, onglet « Carte de chaleur » ouvert ? */
  _surSurface([lon, lat]) {
    const r = this.chaleur.resultat;
    if (!r?.grille || this.tableau.panneau.hidden || this.tableau.onglet !== 'chaleur') return false;
    const [o, s, e, n] = r.zone.emprise;
    return lon >= o && lon <= e && lat >= s && lat <= n && contient(r.zone.geometrie, [lon, lat]);
  }

  /** Itinéraires : cache oublié dès que les barages changent. */
  _moteur() {
    this.reseau?.valider(this.couche.version);
    return this.reseau;
  }

  _sauver() {
    for (;;) {
      try {
        localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(this.historique));
        return true;
      } catch {
        if (this.historique.analyses.length > 1) this.historique = { ...this.historique, analyses: this.historique.analyses.slice(0, -1) };
        else return false;
      }
    }
  }

  _evenement(type, details) {
    this.historique = { ...this.historique, evenements: [{ id: nouvelId('EVT'), type, date: new Date().toISOString(), ...details }, ...this.historique.evenements].slice(0, 500) };
  }

  enregistrerRegles(brut) {
    const { regles, erreurs } = validerReglesProximite(brut);
    if (erreurs.length) {
      this.tableau.message = { type: 'erreur', texte: `Paramètres refusés : ${erreurs.join(' ; ')}.` };
      return false;
    }
    this.regles = regles;
    ecrire(CLE_REGLES, regles);
    return true;
  }

  // ── Zone : navigation automatique ────────────────────────────────────────

  /**
   * Cadre et surligne la zone choisie (limites des circonscriptions du projet).
   * @returns {Promise<object | null>}  la zone, `{ tout: true }`, ou null si elle est introuvable (erreur affichée)
   */
  async allerZone(perimetre) {
    const circos = await this.couche.circos().catch(() => null);
    const z = cibleZone(circos, perimetre);
    if (z.erreur) {
      this.tableau.message = { type: 'erreur', texte: z.erreur };
      this.tableau.rendre();
      return null;
    }
    if (z.tout) {
      this.zone = null;
      this.tableau._afficherZone(null);
      return z;
    }
    this.zone = z;
    this.tableau._afficherZone(z.geometrie);
    this.tableau._cadrerEmprise(z.emprise);
    return z;
  }

  /** « Retour à toutes les régions » : filtre de zone retiré, carte sur tout le Royaume. */
  retourToutesRegions(cible = 'proximite') {
    const vide = { reg: '', cie: '', bt: '' };
    if (cible === 'proximite') this.enregistrerRegles({ ...this.regles, perimetre: vide });
    else this._reglesChaleur({ ...this.reglesChaleur, perimetre: vide });
    this.zone = null;
    this.tableau._afficherZone(null);
    this.tableau._cadrerEmprise([EMPRISE_TUILES[0][0], EMPRISE_TUILES[0][1], EMPRISE_TUILES[1][0], EMPRISE_TUILES[1][1]]);
    this.tableau.rendre();
  }

  // ── Analyse des paires ───────────────────────────────────────────────────

  async lancer(brut) {
    if (this.etat.etat === 'en-cours') return;
    if (!this.enregistrerRegles(brut)) return this.tableau.rendre();
    if (!this.reseau) {
      this.tableau.message = { type: 'erreur', texte: 'Moteur d’itinéraires indisponible : aucune distance routière ne peut être calculée, donc aucune alerte.' };
      return this.tableau.rendre();
    }
    const instantane = this.couche.instantane();
    if (!instantane) return;
    const zone = await this.allerZone(this.regles.perimetre);
    if (!zone) return;
    const regles = structuredClone(this.regles);
    const n = this.etat.n + 1;
    this.etat = { etat: 'en-cours', n, cle: `P-${n}`, fait: 0, total: 0, etape: 'candidats', annule: false, regles, version: this.couche.version };
    this.tableau.message = null;
    this.selection = null;
    this.tableau._travailleur().postMessage({ type: 'proximite', id: `P-${n}`, enregistrements: instantane.enregistrements, regles, urls: this.tableau.urls });
    this.tableau.rendre();
  }

  annuler() {
    if (this.etat.etat === 'en-cours') this.etat.annule = true;
  }

  async surMessage(data) {
    if (typeof data.id === 'string' && data.id.startsWith('C-')) return this._surCandidats(data);
    if (data.id !== this.etat.cle) return;
    const { regles, n } = this.etat;
    if (data.erreur || this.etat.annule) {
      this.etat = { ...this.etat, etat: data.erreur ? 'erreur' : 'inactif', erreur: data.erreur };
      if (!data.erreur) this.tableau.message = { type: 'info', texte: 'Analyse annulée : aucune distance routière calculée.' };
      return this.tableau.rendre();
    }
    const { candidats, analyses, incoherents, exclus, tronque, parFaction } = data.resultat;
    const r = {
      id: nouvelId('PROX'), date: new Date().toISOString(), regles, analyses, incoherents, exclus, tronque, parFaction, version: this.etat.version,
      paires: candidats, routes: candidats.map(() => null), alertes: [], annulee: false, calculees: 0,
    };
    this.resultat = r;
    this.page = 1;
    this.etat = { ...this.etat, etape: 'routes', total: candidats.length, fait: 0 };
    this.tableau.rendre();
    const { routes, annule } = await distancesRoute(candidats, this._moteur(), {
      priorite: PRIORITE,
      annule: () => this.etat.n !== n || this.etat.annule,
      progression: (fait, total) => this._progression('opt-prox', fait, total, 'Itinéraires calculés'),
    });
    if (this.etat.n !== n) return;
    routes.forEach((route, i) => { r.routes[i] = route; });
    r.calculees = routes.length;
    r.annulee = annule;
    r.alertes = candidats.map((p, i) => alerte(p, r.routes[i] ?? undefined, regles));
    this.etat = { ...this.etat, etat: 'inactif' };
    this._enregistrerAnalyse(r);
    this.afficherSurCarte();
    if (this.tableau.mode === 'simple') {
      const pts = resultatsNonConformes(r.alertes).violations.flatMap((i) => [r.paires[i].a.barage, r.paires[i].b.barage]).map((b) => [b.longitude, b.latitude]);
      if (pts.length) this.tableau._cadrer(pts);
    }
    const st = this.statistiques(r);
    this.tableau.message = annule
      ? { type: 'info', texte: `Analyse annulée : ${r.calculees} itinéraires sur ${candidats.length} calculés ; résultats partiels.` }
      : { type: 'ok', texte: `Analyse terminée : ${pluriel(st.alertes, 'alerte')} de proximité (même faction, ≤ ${formaterKm(regles.distanceMaxKm * 1000)} par la route)${st.indisponibles + st.erreurs ? ` ; ${pluriel(st.indisponibles + st.erreurs, 'distance routière indisponible', 'distances routières indisponibles')}` : ''}.` };
    this.tableau.rendre();
  }

  _progression(prefixe, fait, total, libelle) {
    const barre = document.getElementById(`${prefixe}-progression`);
    if (barre) { barre.value = fait; barre.max = total || 1; }
    const t = document.getElementById(`${prefixe}-progression-texte`);
    if (t) t.textContent = `${libelle} : ${fait} / ${total}`;
  }

  _enregistrerAnalyse(r) {
    this.historique = ajouterAnalyse(this.historique, {
      id: r.id, date: r.date, regles: r.regles, analyses: r.analyses, candidats: r.paires.length, annulee: r.annulee, stats: this.statistiques(r),
      alertes: r.alertes.filter((a) => a.alerte || a.statutRoute !== 'ok').map((a) => ({ ids: a.ids, faction: a.faction, routeM: a.routeM === null ? null : Math.round(a.routeM), statutRoute: a.statutRoute, alerte: a.alerte })),
    });
    if (!this._sauver()) this.tableau.message = { type: 'erreur', texte: 'Analyse non enregistrée dans l’historique : stockage du navigateur plein ou indisponible.' };
  }

  statistiques(r = this.resultat) {
    if (!r) return null;
    const alertes = r.alertes.filter((a) => a.alerte);
    const parFaction = {};
    for (const a of alertes) parFaction[a.faction] = (parFaction[a.faction] ?? 0) + 1;
    return {
      analyses: r.analyses, candidats: r.paires.length, calculees: r.calculees, alertes: alertes.length,
      indisponibles: r.alertes.filter((a) => a.statutRoute === 'indisponible').length,
      erreurs: r.alertes.filter((a) => a.statutRoute === 'erreur').length,
      horsSeuil: r.alertes.filter((a) => a.statutRoute === 'ok' && !a.alerte).length,
      alertesParFaction: parFaction,
      tranches: parTranche(r.alertes, r.regles).map(({ libelle, n }) => ({ libelle, n })),
    };
  }

  afficherSurCarte() {
    const r = this.resultat;
    if (!r) return this.tableau._afficher([]);
    const f = [];
    r.alertes.forEach((a, i) => {
      if (!a.alerte) return;
      f.push(...traitsPaire(r.paires[i].a.barage, r.paires[i].b.barage, r.routes[i], { role: 'liste' }).map((x) => ({ ...x, properties: x.geometry.type === 'LineString' ? x.properties : { role: x.properties.role } })));
    });
    this.tableau._afficher(f);
  }

  /** Alertes d'un barage (fiche de la carte) : voisin, distance routière, indice de l'alerte. */
  alertesDe(id) {
    const r = this.resultat;
    if (!r) return [];
    return r.alertes.map((a, i) => ({ a, i })).filter(({ a }) => a.alerte && a.ids.includes(id))
      .map(({ a, i }) => ({ index: i, avec: a.ids.find((x) => x !== id), km: formaterKm(a.routeM) }));
  }

  /** Sélectionne une alerte : liste (onglet Proximité, carte mise en avant) et itinéraire sur la carte. */
  selectionnerAlerte(i) {
    if (!this.resultat?.alertes[i]) return;
    const indices = this.resultat.alertes.map((a, k) => (a.alerte ? k : -1)).filter((k) => k >= 0);
    this.page = Math.max(this.page, Math.ceil((indices.indexOf(i) + 1) / PAR_PAGE));
    if (this.tableau.panneau.hidden) this.tableau.ouvrir('proximite');
    this.tableau.onglet = 'proximite';
    this.voir(i);
    document.querySelector(`#opt-contenu [data-alerte="${i}"]`)?.scrollIntoView({ block: 'center' });
  }

  voir(i) {
    const r = this.resultat;
    const p = r?.paires[i];
    if (!p) return;
    this.selection = i;
    const f = traitsPaire(p.a.barage, p.b.barage, r.routes[i]);
    this.tableau._afficher(f);
    this.tableau._cadrer(f.flatMap((x) => (x.geometry.type === 'Point' ? [x.geometry.coordinates] : x.geometry.coordinates)));
  }

  // ── Changer l'emplacement : marqueur, validation en direct ───────────────

  /** Ouvre l'étude d'un barage d'une alerte : carte centrée, marqueur déplaçable, validation en direct. */
  changerEmplacement(i, cote = 'a') {
    const r = this.resultat;
    const p = r?.paires[i];
    if (!p) return;
    this.etudierBarage(p[cote], { alerte: i, cote, partenaire: p[cote === 'a' ? 'b' : 'a'], seuilKm: r.regles.distanceMaxKm, routeAvant: r.routes[i] });
  }

  /** « Déplacer » depuis la fiche d'un barage (hors alerte) : même étude, seuil de l'onglet Proximité. */
  deplacerBarage(id) {
    const enr = this.couche.instantane()?.enregistrements.find((e) => e.barage?.id === id);
    if (!enr) return;
    this.etudierBarage(enr, { seuilKm: this.regles.distanceMaxKm });
  }

  /**
   * Étude d'un nouvel emplacement pour un barage actif : marqueur déplaçable, validation routière
   * en direct contre la même faction (règle commune), confirmation, historique, annulation.
   */
  etudierBarage(enr, { alerte = null, cote = 'a', partenaire = null, seuilKm = this.regles.distanceMaxKm, routeAvant = null, proposition = null } = {}) {
    if (estProtege(enr.barage)) {
      this.tableau.message = { type: 'erreur', texte: `${enr.barage.id} : ${LIBELLE_PROTEGE}, il ne peut pas être déplacé.` };
      return this.tableau.rendre();
    }
    this.fermerEtude({ rendre: false });
    this.etude = {
      alerte, cote, enr, partenaire, seuilKm, seuilAnalyseKm: seuilKm,
      propose: null, validation: null, erreur: null, jeton: 0, calcul: false, accepteIncertain: false, propositionId: null,
      routeAvant, proposition, motif: '',
    };
    if (this.tableau.panneau.hidden) this.tableau.ouvrir('deplacements');
    this.tableau.onglet = 'deplacements';
    this.arreterOutils();
    this.choix = true;
    this.tableau.carte.getCanvas().style.cursor = 'crosshair';
    const b = enr.barage;
    this.marqueur = new maplibregl.Marker({ draggable: true, color: '#7c3aed' }).setLngLat([b.longitude, b.latitude]).addTo(this.tableau.carte);
    this.marqueur.on('dragend', () => {
      const { lng, lat } = this.marqueur.getLngLat();
      this.proposerEn([lng, lat]);
    });
    // Carte centrée sur le barage et ses voisins de la faction.
    const voisins = this.couche.instantane().enregistrements.filter((x) => x.barage?.id !== b.id && factionDe(x.barage) === factionDe(b) && x.barage.isSimulation === b.isSimulation)
      .filter((x) => Math.abs(x.barage.latitude - b.latitude) < 0.15 && Math.abs(x.barage.longitude - b.longitude) < 0.15);
    this._dessinerEtude();
    this.tableau._cadrer([[b.longitude, b.latitude], ...(partenaire ? [[partenaire.barage.longitude, partenaire.barage.latitude]] : []), ...voisins.slice(0, 6).map((x) => [x.barage.longitude, x.barage.latitude])]);
    this.tableau.message = { type: 'info', texte: 'Faites glisser le marqueur violet, ou cliquez sur la carte : l’emplacement est accroché à la route la plus proche dans la brigade du barage, puis vérifié par la route.' };
    this.tableau.rendre();
  }

  arreterChoix() {
    this.choix = false;
    this.tableau.carte.getCanvas().style.cursor = '';
  }

  async _surClic(e) {
    if (this.choix && this.etude) return this.proposerEn([e.lngLat.lng, e.lngLat.lat]);
    if (this._surSurface([e.lngLat.lng, e.lngLat.lat])) this.infoSurface([e.lngLat.lng, e.lngLat.lat]);
  }

  /** Nouvel emplacement étudié : accroché à la route (même brigade), puis validation routière. */
  async proposerEn(point) {
    const e = this.etude;
    if (!e) return;
    const jeton = ++e.jeton;
    e.erreur = null;
    e.calcul = true;
    e.validation = null;
    e.accepteIncertain = false;
    this.tableau.rendre();
    const place = await this.couche.placerSurRoute(point, e.enr.barage.btId);
    if (this.etude !== e || e.jeton !== jeton) return;
    if (place.statut !== 'valide') {
      e.propose = null;
      e.calcul = false;
      e.erreur = `${place.erreur ?? 'Emplacement refusé.'} Aucun emplacement n’est inventé : choisissez un autre point.`;
      this.marqueur?.setLngLat([e.enr.barage.longitude, e.enr.barage.latitude]);
      this._dessinerEtude();
      return this.tableau.rendre();
    }
    e.propose = { latitude: place.point[1], longitude: place.point[0], route: place.route, validation: traceValidation(place), btId: place.btId, ecartM: place.distance };
    this.marqueur?.setLngLat(place.point);
    this._dessinerEtude();
    this.tableau.rendre();
    await this._validerEtude(jeton);
  }

  /** Validation commune (voisins de même faction, par la route) de l'emplacement étudié. */
  async _validerEtude(jeton = this.etude?.jeton) {
    const e = this.etude;
    if (!e?.propose) return;
    e.calcul = true;
    this.tableau.rendre();
    const point = [e.propose.longitude, e.propose.latitude];
    const v = await validerEmplacementRoutier(point, e.enr.barage, this.couche.instantane().enregistrements, e.seuilKm * 1000, this._moteur(), { priorite: PRIORITE });
    if (this.etude !== e || e.jeton !== jeton) return; // emplacement changé entre-temps
    e.validation = v;
    e.calcul = false;
    // Route actuelle → voisin de l'alerte, pour comparer (même cache).
    if (e.partenaire && !e.routeAvant) e.routeAvant = (await distancesRoute([{ a: e.enr, b: e.partenaire }], this._moteur(), { priorite: PRIORITE })).routes[0];
    this._dessinerEtude();
    this.tableau.rendre();
  }

  /** Règle changée explicitement dans l'étude : nouvelle validation. */
  changerSeuilEtude(km) {
    const e = this.etude;
    if (!e || !Number.isFinite(km) || km < LIMITES.distanceMinKm || km > LIMITES.distanceMaxKm) {
      this.tableau.message = { type: 'erreur', texte: `Distance minimale : entre ${LIMITES.distanceMinKm * 1000} m et ${LIMITES.distanceMaxKm} km.` };
      return this.tableau.rendre();
    }
    e.seuilKm = km;
    e.jeton += 1;
    this._validerEtude(e.jeton);
  }

  /** Carte : position actuelle, emplacement étudié, itinéraires vers les voisins (rouge si trop proches). */
  _dessinerEtude() {
    const e = this.etude;
    if (!e) return;
    const b = e.enr.barage;
    const f = e.partenaire ? traitsPaire(b, e.partenaire.barage, e.routeAvant, { role: 'actuel' })
      : [{ type: 'Feature', properties: { role: 'barage-actuel', texte: `${b.id} (actuel)` }, geometry: { type: 'Point', coordinates: [b.longitude, b.latitude] } }];
    for (const v of e.validation?.verifiees ?? []) {
      const viole = e.validation.violations.includes(v);
      if (v.route.chemin?.length >= 2) {
        f.unshift({ type: 'Feature', properties: { role: viole ? 'route-violation' : 'route-apres', texte: `${v.enr.barage.id} : ${formaterKm(v.route.distance)}${viole ? ' ≤ seuil' : ''}` }, geometry: { type: 'LineString', coordinates: v.route.chemin } });
      }
      f.push({ type: 'Feature', properties: { role: 'barage-apres', texte: v.enr.barage.id }, geometry: { type: 'Point', coordinates: [v.enr.barage.longitude, v.enr.barage.latitude] } });
    }
    this.tableau._afficher(f);
  }

  cadrerEtude() {
    if (!this.etude) return;
    this._dessinerEtude();
    const pts = this.tableau._traits.flatMap((x) => (x.geometry.type === 'Point' ? [x.geometry.coordinates] : x.geometry.coordinates));
    if (this.etude.propose) pts.push([this.etude.propose.longitude, this.etude.propose.latitude]);
    this.tableau._cadrer(pts);
  }

  _peutAppliquer(e = this.etude) {
    if (!e?.propose || e.calcul || !e.validation) return false;
    return e.validation.statut === 'valide' || (e.validation.statut === 'verification-impossible' && e.accepteIncertain);
  }

  /** Enregistre l'emplacement étudié comme proposition (rien n'est modifié). */
  enregistrerProposition() {
    const e = this.etude;
    if (!e?.propose || e.calcul || !e.validation) return null;
    const b = e.enr.barage;
    const km = (r) => (r?.statut === 'ok' ? Math.round(r.distance) : null);
    const p = {
      id: nouvelId('DEP'), date: new Date().toISOString(), analyseId: this.resultat?.id ?? null, barageId: b.id, source: e.enr.source,
      partenaire: e.partenaire?.barage.id ?? null, faction: factionDe(b), origine: b.isSimulation === true ? 'simulé' : 'réel',
      avant: { latitude: b.latitude, longitude: b.longitude, route: b.route ?? null, validation: b.validation ?? null },
      apres: { latitude: e.propose.latitude, longitude: e.propose.longitude, route: e.propose.route, validation: e.propose.validation },
      seuilKm: e.seuilKm, regleModifiee: e.seuilKm !== e.seuilAnalyseKm ? { de: e.seuilAnalyseKm, a: e.seuilKm } : null,
      verification: { statut: e.validation.statut, minimumM: e.validation.minimumM === null ? null : Math.round(e.validation.minimumM), violations: e.validation.violations.map((v) => v.enr.barage.id), indisponibles: e.validation.indisponibles.map((v) => v.enr.barage.id), accepteIncertain: e.accepteIncertain },
      effet: { routeAvantM: km(e.routeAvant), routeApresM: e.partenaire ? km(e.validation.verifiees.find((v) => v.enr.barage.id === e.partenaire.barage.id)?.route) : null },
      statut: 'en-attente', decisions: [{ date: new Date().toISOString(), statut: 'en-attente' }], entree: null,
    };
    this.historique = ajouterProposition(this.historique, p);
    this._evenement('proposition', { proposition: p.id, barage: p.barageId, verification: p.verification.statut });
    this._sauver();
    e.propositionId = p.id;
    this.tableau.message = { type: 'ok', texte: `Proposition ${p.id} enregistrée (${LIBELLES_VALIDATION[p.verification.statut]}) : ${b.id} n’est pas déplacé tant que vous ne l’appliquez pas.` };
    this.tableau.rendre();
    return p;
  }

  fermerEtude({ rendre = true } = {}) {
    this.arreterChoix();
    this.marqueur?.remove();
    this.marqueur = null;
    this.etude = null;
    this.tableau._afficher([]);
    if (rendre) this.tableau.rendre();
  }

  rejeter(p) {
    if (p.statut !== 'en-attente') return;
    this._statut(p, 'rejetee');
    this._evenement('rejet', { proposition: p.id, barage: p.barageId });
    this._sauver();
    this.tableau.message = { type: 'ok', texte: `Proposition ${p.id} rejetée : rien n’a été modifié.` };
    this.tableau.rendre();
  }

  _statut(p, statut, champs = {}) {
    const maj = { ...p, ...champs, statut, decisions: [...p.decisions, { date: new Date().toISOString(), statut }] };
    this.historique = majProposition(this.historique, maj);
    return maj;
  }

  /**
   * Application confirmée : barage inchangé depuis la proposition, espacement vérifié DE NOUVEAU
   * sur les données actuelles (même règle), résultat valide, puis surcouche.
   */
  async appliquer(p) {
    if (p.statut !== 'en-attente' || this.occupe) return;
    const instantane = this.couche.instantane();
    if (!instantane) return;
    const refus = (texte) => {
      this._evenement('refus-application', { proposition: p.id, barage: p.barageId, raison: texte });
      this._sauver();
      this.tableau.message = { type: 'erreur', texte: `Non appliquée, rien n’a été modifié : ${texte}` };
      this.tableau.rendre();
    };
    const cibles = instantane.enregistrements.filter((e) => e.barage?.id === p.barageId);
    if (cibles.length !== 1) return refus(cibles.length ? `${p.barageId} existe en plusieurs exemplaires.` : `${p.barageId} n’existe plus.`);
    const actuel = cibles[0].barage;
    if (estProtege(actuel)) return refus(`${p.barageId} : ${LIBELLE_PROTEGE}, jamais déplacé par l’optimisation.`);
    if (actuel.latitude !== p.avant.latitude || actuel.longitude !== p.avant.longitude) return refus(`${p.barageId} a été déplacé depuis la proposition.`);
    this.occupe = true;
    this.tableau.message = { type: 'info', texte: 'Nouvelle vérification de l’espacement par la route…' };
    this.tableau.rendre();
    try {
      const v = await validerEmplacementRoutier([p.apres.longitude, p.apres.latitude], actuel, instantane.enregistrements, p.seuilKm * 1000, this._moteur(), { priorite: PRIORITE });
      if (v.statut === 'non-valide') return refus(`Emplacement non valide : ${v.violations.map((x) => `${x.enr.barage.id} à ${formaterKm(x.route.distance)} par la route`).join(', ')} (≤ ${formaterKm(p.seuilKm * 1000)}).`);
      if (v.statut === 'verification-impossible' && !p.verification.accepteIncertain) return refus('Vérification impossible (distance routière indisponible) : confirmez explicitement dans l’étude pour appliquer malgré tout.');
      const suivant = { ...actuel, latitude: p.apres.latitude, longitude: p.apres.longitude, route: p.apres.route, validation: p.apres.validation };
      const erreurs = validerBarage(suivant, this.couche.hierarchie);
      if (erreurs.length) return refus(erreurs.join(' ; '));
      const texte = `Déplacer ${p.barageId} ?\n\nDe ${p.avant.latitude.toFixed(5)}, ${p.avant.longitude.toFixed(5)}\nà  ${p.apres.latitude.toFixed(5)}, ${p.apres.longitude.toFixed(5)}\n\n${LIBELLES_VALIDATION[v.statut]} (même faction, > ${formaterKm(p.seuilKm * 1000)} par la route)${v.statut === 'verification-impossible' ? ' — accepté malgré une distance routière indisponible' : ''}\n\nIdentifiant, faction, brigade, type et origine inchangés. Modification locale à ce navigateur, annulable depuis « Déplacements ».`;
      if (!window.confirm(texte)) {
        this.tableau.message = null;
        return;
      }
      const changements = ['latitude', 'longitude', 'route', 'validation'].map((champ) => ({ champ, avant: actuel[champ] ?? null, apres: suivant[champ] ?? null }));
      const { editions, journal } = appliquerAuxEditions(this.couche.editions, [{ constatId: p.id, id: p.barageId, source: cibles[0].source, changements }]);
      const ecriture = this.couche.remplacerEditions(editions);
      if (!ecriture.ok) {
        this._statut(p, 'echec', { erreur: ecriture.erreur });
        this._sauver();
        this.tableau.message = { type: 'erreur', texte: `Échec, rien n’a été modifié : ${ecriture.erreur}` };
        return;
      }
      this._statut(p, 'appliquee', { entree: journal[0], appliqueeLe: new Date().toISOString(), verificationFinale: v.statut });
      this._evenement('application', { proposition: p.id, barage: p.barageId, avant: p.avant, apres: p.apres, verification: v.statut });
      if (!this._sauver()) this.tableau.message = { type: 'erreur', texte: 'Déplacement appliqué, mais l’historique n’a pas pu être enregistré (stockage plein) : l’annulation ne survivra pas au rechargement.' };
      else this.tableau.message = { type: 'ok', texte: `${p.barageId} déplacé (modification locale). « Annuler le déplacement » rétablit l’ancien emplacement.` };
      this.tableau.fermerFiche();
      if (this.etude?.propositionId === p.id) this.fermerEtude({ rendre: false });
    } finally {
      this.occupe = false;
      this.tableau.rendre();
    }
  }

  /** Bouton de l'étude : enregistre puis applique (vérification et confirmation comprises). */
  async confirmerEtude() {
    if (!this._peutAppliquer()) return;
    const p = this.etude.propositionId ? this.historique.propositions.find((x) => x.id === this.etude.propositionId) : this.enregistrerProposition();
    if (p) await this.appliquer(p);
  }

  /** Retour arrière : refusé si le barage a été modifié depuis (aucun écrasement). */
  annulerDeplacement(p) {
    if (p.statut !== 'appliquee' || !p.entree) return;
    const instantane = this.couche.instantane();
    if (!instantane) return;
    if (!window.confirm(`Annuler le déplacement de ${p.barageId} ?\n\nIl retrouvera ${p.avant.latitude.toFixed(5)}, ${p.avant.longitude.toFixed(5)}.`)) return;
    const r = annulerEntree(this.couche.editions, p.entree, instantane.enregistrements, this.couche.baseParId());
    if (r.conflits) {
      this._evenement('annulation-refusee', { proposition: p.id, barage: p.barageId, conflits: r.conflits });
      this._sauver();
      this.tableau.message = { type: 'erreur', texte: `Annulation refusée, rien n’a été changé : ${r.conflits.join(' ')}` };
      return this.tableau.rendre();
    }
    const ecriture = this.couche.remplacerEditions(r.editions);
    if (!ecriture.ok) {
      this.tableau.message = { type: 'erreur', texte: `Échec de l’annulation : ${ecriture.erreur}` };
      return this.tableau.rendre();
    }
    this._statut(p, 'annulee', { annuleeLe: new Date().toISOString() });
    this._evenement('annulation', { proposition: p.id, barage: p.barageId });
    this._sauver();
    this.tableau.message = { type: 'ok', texte: `Déplacement de ${p.barageId} annulé : ancien emplacement rétabli.` };
    this.tableau.rendre();
  }

  // ── Barage ajouté avec l'outil de la carte : même règle, à titre d'avis ──

  async controlerNouveau(b) {
    if (!this.reseau || !b) return null;
    const seuilM = this.regles.distanceMaxKm * 1000;
    const v = await validerEmplacementRoutier([b.longitude, b.latitude], b, this.couche.instantane().enregistrements, seuilM, this._moteur(), { priorite: PRIORITE });
    if (!v) return null;
    const detail = v.statut === 'non-valide' ? ` : ${v.violations.map((x) => `${x.enr.barage.id} à ${formaterKm(x.route.distance)}`).join(', ')}`
      : v.statut === 'verification-impossible' ? ' : distance routière indisponible' : '';
    return `Espacement (${libelleFaction(factionDe(b))}, plus de ${formaterKm(seuilM)} par la route) : ${LIBELLES_VALIDATION[v.statut]}${detail}.`;
  }

  // ── Carte de chaleur des emplacements ────────────────────────────────────

  _reglesChaleur(r) {
    this.reglesChaleur = r;
    ecrire(CLE_CHALEUR, r);
  }

  async lancerChaleur(brut) {
    if (this.chaleur.etat === 'en-cours') this.annulerChaleur();
    const c = this.chaleur;
    const km = Number(brut.distanceMaxKm);
    if (!Number.isFinite(km) || km < LIMITES.distanceMinKm || km > LIMITES.distanceMaxKm) {
      this.tableau.message = { type: 'erreur', texte: `Distance minimale : entre ${LIMITES.distanceMinKm * 1000} m et ${LIMITES.distanceMaxKm} km.` };
      return this.tableau.rendre();
    }
    if (!FACTIONS.includes(brut.faction)) return;
    if (!brut.perimetre.reg && !brut.perimetre.cie && !brut.perimetre.bt) {
      this.tableau.message = { type: 'erreur', texte: 'Choisissez une région (ou une compagnie, une brigade) : la carte de chaleur se calcule zone par zone.' };
      return this.tableau.rendre();
    }
    if (!this.reseau) {
      this.tableau.message = { type: 'erreur', texte: 'Moteur d’itinéraires indisponible : aucune distance routière, donc pas de carte de chaleur.' };
      return this.tableau.rendre();
    }
    this._reglesChaleur({ ...brut, distanceMaxKm: km });
    const zone = await this.allerZone(brut.perimetre);
    if (!zone) return;
    const regles = structuredClone(this.reglesChaleur);
    // Échantillon dense le long des routes : un point tous les D/4 (250 m au moins).
    const pasM = Math.max(250, Math.round((regles.distanceMaxKm * 1000) / 4));
    const n = c.n + 1;
    this.chaleur = { ...c, etat: 'en-cours', n, cle: `C-${n}`, fait: 0, total: 0, etape: 'routes', annule: false, regles, zone, pasM, resultat: null, selection: null, apercu: null, version: this.couche.version };
    this.popup?.remove();
    this.tableau._afficherSurface(null);
    this.tableau.message = null;
    this.tableau._travailleur().postMessage({ type: 'candidats', id: `C-${n}`, zone: { niveau: zone.niveau, id: zone.id }, pasM, max: MAX_CANDIDATS, urls: this.tableau.urls });
    this.tableau.rendre();
  }

  annulerChaleur() {
    const c = this.chaleur;
    if (c.etat !== 'en-cours') return;
    c.annule = true;
    if (c.etape === 'routes') this.tableau._travailleur().postMessage({ type: 'annuler', id: c.cle });
  }

  async _surCandidats(data) {
    const c = this.chaleur;
    if (data.id !== c.cle) return;
    if (data.progression) {
      [c.fait, c.total] = data.progression;
      return this._progression('opt-chaleur', c.fait, c.total, 'Lecture des routes (fenêtres)');
    }
    if (data.erreur || data.resultat?.annule || c.annule) {
      this.chaleur = { ...c, etat: data.erreur ? 'erreur' : 'inactif', erreur: data.erreur };
      this.tableau.message = data.erreur ? { type: 'erreur', texte: `Carte de chaleur : ${data.erreur}` } : { type: 'info', texte: 'Carte de chaleur annulée.' };
      return this.tableau.rendre();
    }
    const { candidats, total, fenetres, illisibles } = data.resultat;
    const { regles, n } = c;
    const modele = modeleFaction(regles.faction, regles.origine !== 'reelle');
    const enrs = this.couche.instantane().enregistrements;
    const seuilM = regles.distanceMaxKm * 1000;
    const r = { regles, zone: c.zone, pasM: c.pasM, total, fenetres, illisibles, candidats: [], date: new Date().toISOString(), annule: false };
    c.resultat = r;
    c.etape = 'validation';
    c.fait = 0;
    c.total = candidats.length;
    this.tableau.rendre();
    // Chaque candidat : la même validation qu'un déplacement (voisins de la faction, par la route).
    const moteur = this._moteur();
    for (let i = 0; i < candidats.length; i++) {
      if (this.chaleur.n !== n || c.annule) {
        r.annule = true;
        break;
      }
      const cand = candidats[i];
      let validation = null;
      if (!cand.btId) {
        validation = { statut: 'verification-impossible', violations: [], indisponibles: [], verifiees: [], minimumM: null, seuilM, requis: 0, horsBrigade: true };
      } else {
        validation = await validerEmplacementRoutier(cand.point, modele, enrs, seuilM, moteur, { priorite: PRIORITE });
      }
      r.candidats.push({ ...cand, validation, classe: classerCandidat(validation) });
      c.fait = i + 1;
      this._progression('opt-chaleur', c.fait, c.total, 'Emplacements vérifiés par la route');
      if (i % 150 === 149) this._peindreSurface();
    }
    if (this.chaleur.n !== n) return;
    c.etat = 'inactif';
    this._peindreSurface();
    const k = this.comptesChaleur();
    this.tableau.message = { type: r.annule ? 'info' : 'ok', texte: `${r.annule ? 'Carte de chaleur interrompue' : 'Carte de chaleur prête'} : ${r.candidats.length} emplacements vérifiés — ${k.adapte} potentiellement adaptés, ${k['a-examiner']} à examiner, ${k.invalide} non valides, ${k.indetermine} au réseau insuffisant.` };
    this._evenement('carte-chaleur', { zone: c.zone.id, faction: regles.faction, distanceMaxKm: regles.distanceMaxKm, comptes: k, candidats: r.candidats.length });
    this._sauver();
    this.tableau.rendre();
  }

  comptesChaleur() {
    const k = { adapte: 0, 'a-examiner': 0, invalide: 0, indetermine: 0 };
    for (const x of this.chaleur.resultat?.candidats ?? []) k[x.classe] += 1;
    return k;
  }

  /**
   * Surface continue : grille d'aptitude (proximite.js) peinte dans un canevas, découpée à la
   * limite de la zone, posée comme image raster sur la carte. Aucun point n'est dessiné.
   */
  _peindreSurface() {
    const r = this.chaleur.resultat;
    if (!r?.candidats.length) return;
    const rayonM = r.pasM * 2.5;
    r.index = indexerCandidats(r.candidats, rayonM);
    r.rayonM = rayonM;
    const g = grilleAptitude(r.candidats, r.zone.emprise, { largeur: LARGEUR_SURFACE, rayonM, index: r.index });
    r.grille = g;
    const brut = document.createElement('canvas');
    brut.width = g.largeur;
    brut.height = g.hauteur;
    const ctx = brut.getContext('2d');
    const img = ctx.createImageData(g.largeur, g.hauteur);
    for (let k = 0; k < g.valeurs.length; k++) img.data.set(couleurAptitude(g.valeurs[k]), k * 4);
    ctx.putImageData(img, 0, 0);
    // Découpe à la limite de la circonscription (dans la même projection que la grille).
    const sortie = document.createElement('canvas');
    sortie.width = g.largeur;
    sortie.height = g.hauteur;
    const cx = sortie.getContext('2d');
    const [o, , e] = r.zone.emprise;
    const [yN, yS] = g.mercY;
    const px = (lon) => ((lon - o) / (e - o)) * g.largeur;
    const py = (lat) => ((yN - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / (yN - yS)) * g.hauteur;
    const polygones = r.zone.geometrie.type === 'Polygon' ? [r.zone.geometrie.coordinates] : r.zone.geometrie.coordinates;
    cx.beginPath();
    for (const anneaux of polygones) for (const anneau of anneaux) anneau.forEach(([lo, la], i) => (i ? cx.lineTo(px(lo), py(la)) : cx.moveTo(px(lo), py(la))));
    cx.clip('evenodd');
    cx.drawImage(brut, 0, 0);
    this.tableau._afficherSurface({ url: sortie.toDataURL('image/png'), coins: g.coins });
  }

  effacerChaleur() {
    this.chaleur = { ...this.chaleur, resultat: null, selection: null, apercu: null };
    this.popup?.remove();
    this.tableau._afficherSurface(null);
    this.tableau._afficher([]);
    this.tableau.rendre();
  }

  /** Paramètres ou barages changés : nouveau calcul (après une courte pause, un seul à la fois). */
  _planifierChaleur() {
    clearTimeout(this._delai);
    this._delai = setTimeout(() => {
      if (this.chaleur.resultat || this.chaleur.etat === 'en-cours') this.lancerChaleur(structuredClone(this.reglesChaleur));
    }, 700);
  }

  /** Clic sur la surface : aptitude de l'endroit et lieu vérifié le plus proche (bulle temporaire). */
  infoSurface(point) {
    const r = this.chaleur.resultat;
    if (!r?.index) return;
    const { valeur, proche } = aptitudeEn(point, r.index, r.rayonM);
    this.popup?.remove();
    const bulle = document.createElement('div');
    bulle.className = 'opt-bulle';
    const ligne = (t, cl) => { const p = document.createElement(cl ? 'strong' : 'p'); p.textContent = t; bulle.append(p); };
    ligne(libelleAptitude(valeur), true);
    if (valeur >= 0) ligne(`Aptitude ${Math.round(valeur * 100)} % (interpolée des lieux vérifiés par la route alentour).`);
    if (proche !== null) {
      const x = r.candidats[proche];
      const v = x.validation;
      ligne(`Lieu vérifié le plus proche : ${nomRoute(x.route)} — ${CLASSES_CANDIDAT[x.classe].libelle}.`);
      ligne(v.violations.length ? `Trop proche : ${v.violations.map((y) => `${y.enr.barage.id} à ${formaterKm(y.route.distance)}`).join(', ')} par la route.`
        : v.indisponibles.length ? `Distance routière indisponible vers ${v.indisponibles.map((y) => y.enr.barage.id).join(', ')}.`
          : v.minimumM !== null ? `Barage de la faction le plus proche vérifié : ${formaterKm(v.minimumM)} par la route.` : `Aucun barage de la faction à ${formaterKm(v.seuilM)} ou moins par la route.`);
      this.inspecterCandidat(proche, { cadrer: false });
    }
    this.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat(point).setDOMContent(bulle).addTo(this.tableau.carte);
  }

  /** Clic sur un emplacement candidat : détails et itinéraires vers les barages de la faction. */
  /** Détails d'un lieu vérifié : seuls les itinéraires sont tracés (temporairement), aucun point. */
  inspecterCandidat(i) {
    const x = this.chaleur.resultat?.candidats[i];
    if (!x) return;
    this.chaleur.selection = i;
    this.chaleur.apercu = null;
    this.tableau.onglet = 'chaleur';
    const f = [];
    for (const v of x.validation.verifiees) {
      const viole = x.validation.violations.includes(v);
      if (v.route.chemin?.length >= 2) f.push({ type: 'Feature', properties: { role: viole ? 'route-violation' : 'route-apres', texte: `${v.enr.barage.id} : ${formaterKm(v.route.distance)}` }, geometry: { type: 'LineString', coordinates: v.route.chemin } });
    }
    this.tableau._afficher(f);
    this.tableau.rendre();
  }

  /** Aperçu de création : emplacement accroché (route, brigade), revalidé avec la règle commune. */
  async apercuCreation() {
    const c = this.chaleur;
    const x = c.resultat?.candidats[c.selection];
    if (!x) return;
    const regles = c.resultat.regles;
    const modele = modeleFaction(regles.faction, regles.origine !== 'reelle');
    c.apercu = { calcul: true, modele, nom: '', accepteIncertain: false };
    this.tableau.rendre();
    const place = await this.couche.placerSurRoute(x.point, null);
    if (c.selection === null || c.resultat?.candidats[c.selection] !== x) return;
    if (place.statut !== 'valide') {
      c.apercu = { ...c.apercu, calcul: false, erreur: `${place.erreur ?? 'Emplacement refusé.'} Aucun emplacement n’est inventé.` };
      return this.tableau.rendre();
    }
    const v = await validerEmplacementRoutier(place.point, modele, this.couche.instantane().enregistrements, regles.distanceMaxKm * 1000, this._moteur(), { priorite: PRIORITE });
    c.apercu = { ...c.apercu, calcul: false, place, validation: v, nom: `Barage ${place.route?.ref || place.route?.nom || ''}`.trim() };
    this.tableau.rendre();
  }

  /** Création confirmée, par le chemin de l'éditeur de la carte (CoucheBarages.creerSurRoute). */
  async creerDepuisApercu() {
    const c = this.chaleur;
    const a = c.apercu;
    if (!a?.validation || a.calcul) return;
    if (a.validation.statut === 'non-valide') return;
    if (a.validation.statut === 'verification-impossible' && !a.accepteIncertain) return;
    const regles = c.resultat.regles;
    const texte = `Créer un barage ?\n\n${a.nom || 'Barage'} · ${libelleFaction(regles.faction)} · ${a.modele.isSimulation ? 'simulé' : 'réel'}\n${a.place.point[1].toFixed(5)}, ${a.place.point[0].toFixed(5)} (${nomRoute(a.place.route)})\n\n${LIBELLES_VALIDATION[a.validation.statut]} : plus de ${formaterKm(regles.distanceMaxKm * 1000)} par la route de tout barage de la faction${a.validation.statut === 'verification-impossible' ? ' non garanti (distance routière indisponible)' : ''}.\n\nAjout local à ce navigateur (comme l’outil « Ajouter »), annulable depuis « Déplacements ».`;
    if (!window.confirm(texte)) return;
    const r = await this.couche.creerSurRoute(a.place.point, a.modele, { nom: a.nom });
    if (!r.ok) {
      this.tableau.message = { type: 'erreur', texte: `Barage non créé : ${r.erreur}` };
      return this.tableau.rendre();
    }
    this._evenement('creation', { barage: r.barage.id, copie: r.barage, verification: a.validation.statut, accepteIncertain: a.accepteIncertain, faction: regles.faction, distanceMaxKm: regles.distanceMaxKm });
    this._sauver();
    c.apercu = null;
    this.tableau.message = { type: 'ok', texte: `Barage ${r.barage.id} créé (ajout local). La carte de chaleur se recalcule pour en tenir compte. « Annuler la création » dans « Déplacements ».` };
    this.tableau.rendre();
  }

  /** Retire un barage créé depuis la carte de chaleur, s'il n'a pas été modifié depuis. */
  annulerCreation(evt) {
    const ajout = this.couche.editions.ajouts.find((x) => x.id === evt.barage);
    if (!ajout) {
      this.tableau.message = { type: 'erreur', texte: `${evt.barage} n’est plus un ajout local : rien à annuler.` };
      return this.tableau.rendre();
    }
    if (!memeValeur(ajout, evt.copie)) {
      this.tableau.message = { type: 'erreur', texte: `${evt.barage} a été modifié depuis sa création : annulation refusée, rien n’a été changé.` };
      return this.tableau.rendre();
    }
    if (!window.confirm(`Annuler la création de ${evt.barage} ?`)) return;
    const ecriture = this.couche.remplacerEditions({ ...this.couche.editions, ajouts: this.couche.editions.ajouts.filter((x) => x.id !== evt.barage) });
    if (!ecriture.ok) {
      this.tableau.message = { type: 'erreur', texte: `Échec : ${ecriture.erreur}` };
      return this.tableau.rendre();
    }
    this._evenement('annulation-creation', { barage: evt.barage, de: evt.id });
    this._sauver();
    this.tableau.message = { type: 'ok', texte: `Création de ${evt.barage} annulée.` };
    this.tableau.rendre();
  }

  // ── Rendu commun ─────────────────────────────────────────────────────────

  _choixZone(brouillon, enregistrer, cible) {
    const { h } = this;
    const hi = this.couche.hierarchie;
    const p = brouillon.perimetre;
    const trie = (map, filtre) => [...map.values()].filter(filtre).sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
    const choix = (cle, libelle, liste) => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('select', { [`data-${cible}-zone`]: cle, on: { change: (e) => { p[cle] = e.target.value; if (cle === 'reg') Object.assign(p, { cie: '', bt: '' }); if (cle === 'cie') p.bt = ''; enregistrer(brouillon); this.tableau.rendre(); } } },
        h('option', { value: '', text: cle === 'reg' ? 'Toutes les régions' : 'Toutes' }), liste.map((x) => h('option', { value: x.id, text: x.nom, selected: x.id === p[cle] }))));
    return [
      choix('reg', 'Région', trie(hi.regions, () => true)),
      choix('cie', 'Compagnie', trie(hi.compagnies, (c) => !p.reg || c.regId === p.reg)),
      choix('bt', 'Brigade', trie(hi.brigades, (x) => (!p.reg || x.regId === p.reg) && (!p.cie || x.cieId === p.cie))),
      p.reg || p.cie || p.bt ? h('button', { type: 'button', class: 'lien opt-plein', text: 'Retour à toutes les régions', on: { click: () => this.retourToutesRegions(cible) } }) : null,
    ];
  }

  _barreProgression(prefixe, etat, libelle) {
    const { h } = this;
    return h('div', { class: 'groupe opt-analyse' }, h('strong', { text: libelle }),
      h('progress', { id: `${prefixe}-progression`, max: etat.total || 1, value: etat.fait }),
      h('span', { id: `${prefixe}-progression-texte`, class: 'aide', text: etat.total ? `${etat.fait} / ${etat.total}` : '' }));
  }

  // ── Rendu : Proximité ────────────────────────────────────────────────────

  rendreProximite() {
    return [this._configuration(), this._etatAnalyse(), ...this._resultats()];
  }

  _configuration() {
    const { h } = this;
    const b = structuredClone(this.regles);
    const enCours = this.etat.etat === 'en-cours';
    return h('div', { class: 'groupe' },
      h('h3', { text: 'Paramètres de l’optimisation' }),
      h('div', { class: 'opt-filtres' },
        h('label', { class: 'champ' }, h('span', { text: 'Distance routière maximale (km)' }),
          h('input', { type: 'number', id: 'opt-prox-distance', min: LIMITES.distanceMinKm, max: LIMITES.distanceMaxKm, step: 0.1, value: String(b.distanceMaxKm), on: { input: (e) => { b.distanceMaxKm = e.target.value === '' ? NaN : Number(e.target.value); } } })),
        h('label', { class: 'champ opt-plein' }, h('span', { text: 'Faction' }),
          h('select', { id: 'opt-prox-faction', on: { change: (e) => { b.faction = e.target.value; } } },
            h('option', { value: 'toutes', text: 'Toutes (chaque faction séparément)', selected: b.faction === 'toutes' }),
            FACTIONS.map((f) => h('option', { value: f, text: libelleFaction(f), selected: b.faction === f })))),
        h('div', { class: 'champ opt-plein' }, h('span', { text: 'Types de barage' }), h('div', { class: 'opt-cases' }, TYPES.map((t) => h('label', {},
          h('input', { type: 'checkbox', 'data-type': t, checked: (b.types ?? TYPES).includes(t), on: { change: (e) => { b.types = e.target.checked ? [...new Set([...(b.types ?? TYPES), t])] : (b.types ?? TYPES).filter((x) => x !== t); } } }), ` ${LIBELLES_TYPE[t]}`)))),
        h('div', { class: 'champ opt-plein' }, h('span', { text: 'Origine' }), h('div', { class: 'segments', role: 'group' },
          Object.entries(LIBELLES_ORIGINE).map(([v, l]) => h('button', { type: 'button', 'data-origine': v, 'aria-pressed': String(b.origine === v), text: l,
            on: { click: (e) => { b.origine = v; for (const x of e.target.parentElement.children) x.setAttribute('aria-pressed', String(x === e.target)); } } })))),
        this._choixZone(b, (x) => this.enregistrerRegles(x), 'proximite')),
      h('p', { class: 'aide', text: 'Les barages intouchables (24 h/24) sont en service pendant les quatre factions : ils sont comparés à chacune, et restent toujours des points de référence — jamais déplacés ni supprimés. Règle unique : deux barages de la même faction sont trop proches si leur distance PAR LA ROUTE est inférieure ou égale au seuil (alerte ici ; emplacement non valide pour un déplacement ou un nouveau barage). Itinéraire introuvable : « Distance routière indisponible », jamais une alerte ni une validation. Les factions ne sont jamais comparées entre elles. La zone choisie est cadrée et surlignée au lancement.' }),
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-principal', text: 'Lancer l’optimisation', disabled: enCours, on: { click: () => this.lancer(b) } }),
        enCours ? h('button', { type: 'button', class: 'bouton-outil', text: 'Annuler l’analyse', on: { click: () => this.annuler() } }) : null));
  }

  _etatAnalyse() {
    const { h } = this;
    if (this.etat.etat === 'erreur') return h('p', { class: 'opt-message erreur', text: `Échec de l’analyse : ${this.etat.erreur}` });
    if (this.etat.etat !== 'en-cours') return null;
    return this._barreProgression('opt-prox', this.etat, this.etat.etape === 'routes' ? 'Calcul des itinéraires (la carte reste utilisable)…' : 'Regroupement par faction…');
  }

  _resultats() {
    const { h } = this;
    const r = this.resultat;
    if (!r) return [h('p', { class: 'aide', text: 'Aucune analyse : choisissez les paramètres puis « Lancer l’optimisation ».' })];
    if (this.etat.etat === 'en-cours' && !r.alertes.length) return [];
    const st = this.statistiques(r);
    const n = compterPropositions(this.historique);
    const tuile = (v, l) => h('div', { class: 'insp-tuile' }, h('b', { text: String(v) }), h('span', { text: l }));
    const alertes = r.alertes.map((a, i) => (a.alerte ? i : -1)).filter((i) => i >= 0);
    const sansRoute = r.alertes.map((a, i) => (a.statutRoute === 'indisponible' || a.statutRoute === 'erreur' ? i : -1)).filter((i) => i >= 0);
    return [
      r.version !== this.couche.version ? h('p', { class: 'opt-message info', text: 'Les barages ont changé depuis cette analyse : relancez-la pour des distances à jour.' }) : null,
      r.annulee ? h('p', { class: 'opt-message info', text: `Analyse annulée : ${r.calculees} itinéraires calculés sur ${r.paires.length}. Les paires non calculées ne sont pas des alertes.` }) : null,
      r.tronque ? h('p', { class: 'opt-message info', text: `Plus de ${r.regles.maxCandidats} paires à calculer : réduisez la distance, choisissez une faction ou une zone.` }) : null,
      r.incoherents ? h('p', { class: 'opt-message info', text: `${pluriel(r.incoherents, 'barage')} au type et à la faction incompatibles : non comparé${r.incoherents > 1 ? 's' : ''} (voir « Qualité des données »).` }) : null,
      h('div', { class: 'insp-tuiles opt-tuiles' },
        tuile(st.analyses, 'Barages analysés'),
        tuile(st.calculees, 'Itinéraires calculés (même faction)'),
        tuile(st.alertes, 'Alertes de proximité'),
        tuile(st.horsSeuil, 'Au-delà du seuil par la route'),
        tuile(st.indisponibles, 'Distance routière indisponible'),
        tuile(st.erreurs, 'Erreurs du moteur'),
        tuile(n.total, 'Propositions de déplacement'),
        tuile(`${n['en-attente']} / ${n.appliquee} / ${n.rejetee}`, 'En attente / appliquées / rejetées')),
      h('div', { class: 'groupe' }, h('h3', { text: 'Alertes par faction et par distance routière' }),
        h('table', { class: 'opt-comparaison opt-tranches' }, h('tbody', {},
          FACTIONS.filter((f) => r.parFaction[f]).map((f) => h('tr', {}, h('th', { text: libelleFaction(f) }), h('td', { text: `${st.alertesParFaction[f] ?? 0} alerte(s) · ${r.parFaction[f]} barages` }))),
          st.tranches.map((t) => h('tr', {}, h('th', { text: t.libelle }), h('td', { text: String(t.n) })))))),
      h('p', { class: 'aide', text: `${this.date(r.date)} · seuil ${formaterKm(r.regles.distanceMaxKm * 1000)} par la route · ${r.regles.faction === 'toutes' ? 'toutes les factions, séparément' : libelleFaction(r.regles.faction)} · ${LIBELLES_ORIGINE[r.regles.origine]} · ${this.tableau._libellePerimetre({ origine: 'toutes', ...r.regles.perimetre })}` }),
      h('div', { class: 'opt-actions' },
        alertes.length ? h('button', { type: 'button', class: 'lien', text: 'Toutes les alertes sur la carte', on: { click: () => { this.selection = null; this.afficherSurCarte(); this.tableau._cadrer(this.tableau._traits.flatMap((x) => (x.geometry.type === 'Point' ? [x.geometry.coordinates] : []))); } } }) : null,
        this.tableau.vueAvant ? h('button', { type: 'button', class: 'lien', text: 'Revenir à la vue précédente', on: { click: () => this.tableau.revenir() } }) : null),
      h('h3', { class: 'opt-titre-section', text: `Alertes de proximité (${alertes.length})` }),
      alertes.length ? h('ol', { class: 'opt-liste' }, alertes.slice(0, this.page * PAR_PAGE).map((i) => this._carteAlerte(i))) : h('p', { class: 'aide', text: 'Aucune alerte : aucune paire de même faction sous le seuil par la route.' }),
      alertes.length > this.page * PAR_PAGE ? h('button', { type: 'button', class: 'lien', text: `Afficher plus (${alertes.length - this.page * PAR_PAGE} restantes)`, on: { click: () => { this.page += 1; this.tableau.rendre(); } } }) : null,
      sansRoute.length ? h('details', { class: 'groupe opt-details' }, h('summary', { text: `Distance routière indisponible (${sansRoute.length}) : pas d’alerte` }),
        h('ul', { class: 'opt-refus' }, sansRoute.map((i) => { const p = r.paires[i]; return h('li', { text: `${p.a.barage.id} ↔ ${p.b.barage.id} (${libelleFaction(r.alertes[i].faction)}) — ${r.alertes[i].raison}` }); }))) : null,
    ];
  }

  _carteAlerte(i) {
    const { h } = this;
    const r = this.resultat;
    // Administrateur connecté : coordination seulement (choisir, assigner), jamais de modification directe.
    const admin = this.tableau.espace?.admin === true;
    const actions = !admin;
    const p = r.paires[i];
    const a = r.alertes[i];
    const actif = (x) => this.couche.jeu?.parId.has(x.barage.id);
    const barage = (x) => {
      const protege = estProtege(x.barage);
      return h('div', { class: 'opt-barage-alerte' },
        h('p', { class: 'opt-ids', text: `${x.barage.name ?? '—'} · ${x.barage.id} · ${coord(x.barage)}${x.source === 'local' ? ' · ajout local' : ''}${actif(x) ? '' : ' · supprimé depuis l’analyse'}` }),
        h('div', { class: 'opt-constat-tete' },
          h('span', { class: `opt-pastille ${protege ? 'protege' : 'mobile'}`, text: protege ? LIBELLE_PROTEGE : 'Déplaçable' }),
          h('span', { class: 'opt-categorie', text: LIBELLES_TYPE[x.barage.type] ?? x.barage.type }),
          !protege && actif(x) && actions ? h('button', { type: 'button', class: 'lien', text: `Déplacer ${x.barage.id}`, on: { click: () => this.changerEmplacement(i, x === p.a ? 'a' : 'b') } }) : null,
          !protege && actif(x) && actions ? h('button', { type: 'button', class: 'lien', text: `Supprimer ${x.barage.id}`, on: { click: () => this.couche.retirer(x.barage.id) } }) : null));
    };
    return h('li', {
      class: `opt-constat opt-cliquable ${a.informatif ? 'info' : 'avertissement'}${this.selection === i ? ' opt-choisi' : ''}`, 'data-alerte': i,
      on: { click: (e) => { if (!e.target.closest('button, input, label, textarea, select')) this.voir(i); } },
    },
      h('div', { class: 'opt-constat-tete' },
        h('span', { class: `opt-pastille ${a.informatif ? 'info' : 'avertissement'}`, text: a.informatif ? 'Alerte pour information' : 'Alerte de proximité' }),
        h('span', { class: 'opt-categorie', text: libelleFaction(a.faction) })),
      barage(p.a), barage(p.b),
      h('dl', { class: 'insp-lignes opt-detail' },
        h('dt', { text: 'Par la route' }), h('dd', { text: texteRoute(r.routes[i]) }),
        h('dt', { text: 'Règle' }), h('dd', { text: a.raison }),
        h('dt', { text: 'Avis' }), h('dd', { text: a.informatif
          ? 'Deux barages fixes intouchables : conflit signalé pour information, aucune action possible.'
          : admin ? `À assigner au commandement de la région : il pourra proposer le déplacement ou la suppression de ${a.mobiles.join(' ou ')}${a.mobiles.length < 2 ? ' (l’autre est intouchable)' : ''}.`
            : `Actions possibles sur ${a.mobiles.join(' et ')} seulement${a.mobiles.length < 2 ? ' (l’autre est intouchable)' : ''}. La proximité seule ne prouve pas qu’un barage doive être déplacé.` })),
      h('div', { class: 'opt-liens' },
        admin ? this.tableau.espace.caseChoix(i) : null,
        h('button', { type: 'button', class: 'lien', text: 'Voir l’itinéraire sur la carte', on: { click: () => this.voir(i) } })));
  }

  // ── Rendu : optimisation en une étape (résultats compacts) ────────

  /** Lance l'analyse avec la seule distance choisie dans la fenêtre « Calculer ». */
  calculerSimple(km, regId = '') {
    this.fermerEtude({ rendre: false });
    this.page = 1;
    return this.lancer({ ...reglesSimples(km), perimetre: { reg: regId, cie: '', bt: '' } });
  }

  rendreSimple(rouvrirDialogue) {
    const { h } = this;
    if (this.etude) {
      return [h('button', { type: 'button', class: 'lien', text: '← Retour aux résultats', on: { click: () => this.fermerEtude() } }), this._etude()];
    }
    const r = this.resultat;
    const enCours = this.etat.etat === 'en-cours';
    const corps = [];
    if (enCours) {
      corps.push(this._barreProgression('opt-prox', this.etat, this.etat.etape === 'routes' ? 'Calcul des distances par la route (la carte reste utilisable)…' : 'Préparation…'),
        h('button', { type: 'button', class: 'bouton-outil', text: 'Annuler le calcul', on: { click: () => this.annuler() } }));
    }
    if (this.etat.etat === 'erreur') corps.push(h('p', { class: 'opt-message erreur', text: `Échec du calcul : ${this.etat.erreur}` }));
    if (r && !enCours) {
      const { violations, nonVerifiees } = resultatsNonConformes(r.alertes);
      const km = formaterKm(r.regles.distanceMaxKm * 1000);
      const zone = r.regles.perimetre?.reg ? this.couche.hierarchie?.regions.get(r.regles.perimetre.reg)?.nom ?? r.regles.perimetre.reg : 'tout le Royaume';
      const espace = this.tableau.espace;
      corps.push(
        h('p', { class: 'opt-portee', text: `Zone analysée : ${zone}` }),
        h('p', { class: 'opt-resume-simple' },
          h('strong', { text: violations.length ? `${pluriel(violations.length, 'paire non conforme', 'paires non conformes')}` : 'Aucune paire non conforme' }),
          ` : barages de la même faction à ${km} ou moins par la route${r.annulee ? ' (calcul interrompu : résultats partiels)' : ''}.`),
        espace?.rendreAffectation(violations) ?? null,
        r.version !== this.couche.version ? h('p', { class: 'opt-message info', text: 'Les barages ont changé depuis ce calcul : relancez-le pour des résultats à jour.' }) : null,
        h('div', { class: 'opt-actions' },
          h('button', { type: 'button', class: 'bouton-outil', text: 'Modifier la distance', on: { click: () => rouvrirDialogue() } }),
          violations.length ? h('button', { type: 'button', class: 'lien', text: 'Tout voir sur la carte', on: { click: () => { this.selection = null; this.afficherSurCarte(); this.tableau._cadrer(violations.flatMap((i) => [r.paires[i].a.barage, r.paires[i].b.barage]).map((b) => [b.longitude, b.latitude])); } } }) : null),
        violations.length ? h('ol', { class: 'opt-liste' }, violations.slice(0, this.page * PAR_PAGE).map((i) => this._carteAlerte(i))) : null,
        violations.length > this.page * PAR_PAGE ? h('button', { type: 'button', class: 'lien', text: `Afficher plus (${violations.length - this.page * PAR_PAGE} restantes)`, on: { click: () => { this.page += 1; this.tableau.rendre(); } } }) : null,
        nonVerifiees.length ? h('details', { class: 'groupe opt-details' }, h('summary', { text: `Distance routière non vérifiée (${nonVerifiees.length}) : ni conformes ni non conformes` }),
          h('ul', { class: 'opt-refus' }, nonVerifiees.map((i) => { const p = r.paires[i]; return h('li', { text: `${p.a.barage.name ?? p.a.barage.id} (${p.a.barage.id}) ↔ ${p.b.barage.name ?? p.b.barage.id} (${p.b.barage.id}) · ${libelleFaction(r.alertes[i].faction)} — ${r.alertes[i].raison}` }); }))) : null,
        h('p', { class: 'aide', text: 'Les barages fixes intouchables comptent dans le calcul mais ne sont jamais déplacés ni supprimés. Cliquez une paire pour voir son itinéraire.' }),
      );
    }
    if (!r && !enCours && this.etat.etat !== 'erreur') corps.push(h('p', { class: 'aide', text: 'Aucun calcul : « Modifier la distance » puis « Calculer ».' }), h('button', { type: 'button', class: 'bouton-principal', text: 'Modifier la distance', on: { click: () => rouvrirDialogue() } }));
    return corps;
  }

  // ── Rendu : Déplacements ─────────────────────────────────────────────────

  rendreDeplacements() {
    return [this._etude(), this._propositions(), this._journal()];
  }

  _etude() {
    const { h } = this;
    const e = this.etude;
    if (!e) {
      return h('div', { class: 'groupe' }, h('h3', { text: 'Changer l’emplacement d’un barage' }),
        h('p', { class: 'aide', text: 'Depuis une alerte de l’onglet « Proximité », « Changer l’emplacement » : un marqueur à déplacer sur la carte, et une vérification en direct par la route. Aucun emplacement n’est proposé automatiquement.' }));
    }
    const b = e.enr.barage;
    const p = e.propose;
    const v = e.validation;
    const proposition = e.propositionId ? this.historique.propositions.find((x) => x.id === e.propositionId) : null;
    const statut = e.calcul ? { classe: 'info', texte: 'Vérification par la route…' }
      : !p ? { classe: 'info', texte: 'Choisissez un emplacement : faites glisser le marqueur ou cliquez sur la carte.' }
        : { classe: CLASSES_VALIDATION[v.statut], texte: LIBELLES_VALIDATION[v.statut] };
    return h('div', { class: 'groupe opt-etude' },
      h('h3', { text: `Changer l’emplacement : ${b.name ?? ''} (${b.id}) · ${libelleFaction(factionDe(b))}` }),
      e.alerte !== null && this.resultat?.paires[e.alerte] ? h('div', { class: 'champ' }, h('span', { text: 'Barage à déplacer' }), h('div', { class: 'segments', role: 'group' },
        ['a', 'b'].map((c) => { const x = this.resultat.paires[e.alerte][c].barage; return h('button', { type: 'button', 'aria-pressed': String(e.cote === c), text: x.id, on: { click: () => this.changerEmplacement(e.alerte, c) } }); }))) : null,
      h('p', { id: 'opt-statut-emplacement', class: `opt-message ${statut.classe} opt-statut-emplacement`, role: 'status', text: statut.texte }),
      e.proposition ? h('p', { class: 'aide', text: `Règle fixée par l’administrateur : plus de ${formaterKm(e.seuilKm * 1000)} par la route de tout barage de la même faction.` })
        : h('label', { class: 'champ' }, h('span', { text: `Distance minimale par la route avec la même faction (km)${e.seuilKm !== e.seuilAnalyseKm ? ` — modifiée (réglage : ${e.seuilAnalyseKm})` : ''}` }),
          h('input', { type: 'number', id: 'opt-seuil-etude', min: LIMITES.distanceMinKm, max: LIMITES.distanceMaxKm, step: 0.1, value: String(e.seuilKm), on: { change: (x) => this.changerSeuilEtude(Number(x.target.value)) } })),
      h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison' },
        h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { text: 'Emplacement actuel' }), h('th', { text: 'Emplacement proposé' }))),
        h('tbody', {},
          h('tr', {}, h('th', { text: 'Coordonnées' }), h('td', { text: coord(b) }), h('td', { class: 'propose', text: p ? coord(p) : '—' })),
          h('tr', {}, h('th', { text: 'Route' }), h('td', { text: nomRoute(b.route) }), h('td', { text: p ? nomRoute(p.route) : '—' })),
          e.partenaire ? h('tr', {}, h('th', { text: `Vers ${e.partenaire.barage.id} par la route` }), h('td', { text: texteRoute(e.routeAvant) }),
            h('td', { text: v ? texteRoute(v.verifiees.find((x) => x.enr.barage.id === e.partenaire.barage.id)?.route ?? v.indisponibles.find((x) => x.enr.barage.id === e.partenaire.barage.id)?.route ?? null) || 'au-delà de la zone vérifiée' : '—' })) : null))),
      p ? h('p', { class: 'aide', text: `Accroché à la route à ${Math.round(p.ecartM)} m du point choisi · brigade inchangée (${this.couche.hierarchie?.brigades.get(p.btId)?.nom ?? p.btId}).` }) : null,
      v ? this._detailsValidation(v) : null,
      v?.statut === 'verification-impossible' && !proposition ? h('label', { class: 'opt-cases' },
        h('input', { type: 'checkbox', id: 'opt-accepte-incertain', checked: e.accepteIncertain, on: { change: (x) => { e.accepteIncertain = x.target.checked; this.tableau.rendre(); } } }),
        ' Je confirme avoir vérifié moi-même les distances indisponibles (enregistré dans l’historique).') : null,
      e.erreur ? h('p', { class: 'opt-message erreur', text: e.erreur }) : null,
      proposition ? null : this._saisieCoordonnees(p ?? b),
      e.proposition ? this._soumissionProposition(e) : null,
      e.proposition ? null : h('div', { class: 'opt-actions' },
        !proposition ? h('button', { type: 'button', class: 'bouton-principal', text: 'Confirmer le nouvel emplacement…', disabled: !this._peutAppliquer(e) || this.occupe, title: v?.statut === 'non-valide' ? 'Emplacement non valide : changez l’emplacement ou la règle.' : '', on: { click: () => this.confirmerEtude() } }) : null,
        p && v && !proposition ? h('button', { type: 'button', class: 'bouton-outil', text: 'Enregistrer comme proposition', on: { click: () => this.enregistrerProposition() } }) : null,
        proposition?.statut === 'en-attente' ? h('button', { type: 'button', class: 'bouton-principal', text: 'Appliquer le déplacement…', on: { click: () => this.appliquer(proposition) } }) : null,
        proposition?.statut === 'en-attente' ? h('button', { type: 'button', class: 'lien', text: 'Rejeter', on: { click: () => this.rejeter(proposition) } }) : null,
        h('button', { type: 'button', class: 'lien', text: 'Voir sur la carte', on: { click: () => this.cadrerEtude() } }),
        h('button', { type: 'button', class: 'lien', text: proposition ? 'Fermer' : 'Abandonner', on: { click: () => this.fermerEtude() } })),
      h('p', { class: 'opt-legende-carte' }, h('span', { class: 'pastille route' }), ' itinéraire actuel ', h('span', { class: 'pastille apres' }), ' depuis l’emplacement proposé ', h('span', { class: 'pastille violation' }), ' trop proche (même faction)'));
  }

  /** Commandement : la position validée par la route est soumise, avec un motif ; rien n'est modifié. */
  _soumissionProposition(e) {
    const { h } = this;
    const pret = this._peutAppliquer(e) && e.motif.trim().length >= 5;
    return h('div', { class: 'groupe' },
      h('label', { class: 'champ' }, h('span', { text: 'Motif de la proposition (obligatoire)' }),
        h('textarea', { rows: 2, id: 'opt-motif-proposition', value: e.motif, on: { input: (x) => { e.motif = x.target.value; const b = document.getElementById('opt-soumettre-proposition'); if (b) b.disabled = !(this._peutAppliquer(e) && e.motif.trim().length >= 5); } } })),
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-principal', id: 'opt-soumettre-proposition', text: 'Soumettre la proposition à l’administrateur', disabled: !pret, on: { click: async () => {
          const v = e.validation;
          const ok = await e.proposition.soumettre({
            position: [e.propose.longitude, e.propose.latitude], raison: e.motif,
            validation: { statut: v.statut, minimumM: v.minimumM, violations: v.violations.map((x) => x.enr.barage.id), accepteIncertain: e.accepteIncertain, seuilKm: e.seuilKm },
          });
          if (ok) this.fermerEtude();
        } } }),
        h('button', { type: 'button', class: 'lien', text: 'Abandonner', on: { click: () => this.fermerEtude() } })),
      h('p', { class: 'aide', text: 'Un emplacement non valide ne peut pas être proposé. La proposition va à l’administrateur ; aucun barage n’est déplacé ici.' }));
  }

  /** Détail de la validation commune : voisins de même faction, distances routières, violations. */
  _detailsValidation(v) {
    const { h } = this;
    const lignes = [...v.violations.map((x) => [x, 'trop proche']), ...v.verifiees.filter((x) => !v.violations.includes(x)).map((x) => [x, 'au-delà du seuil']), ...v.indisponibles.map((x) => [x, 'Distance routière indisponible'])];
    return h('div', { class: 'groupe' },
      v.violations.length ? h('p', { class: 'opt-message erreur', text: `Trop proche : ${v.violations.map((x) => `${x.enr.barage.name ?? ''} (${x.enr.barage.id}, ${libelleFaction(factionDe(x.enr.barage))}) à ${formaterKm(x.route.distance)} par la route`).join(' ; ')} — seuil ${formaterKm(v.seuilM)}.` }) : null,
      lignes.length ? h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison' },
        h('thead', {}, h('tr', {}, ['Barage (même faction)', 'Par la route', 'Règle'].map((t) => h('th', { text: t })))),
        h('tbody', {}, lignes.map(([x, etat]) => h('tr', { class: etat === 'trop proche' ? 'different' : '' }, h('th', { text: x.enr.barage.id }), h('td', { text: texteRoute(x.route) }), h('td', { text: etat })))))) : null,
      h('p', { class: 'aide', text: v.requis ? `${pluriel(v.requis, 'barage')} de la même faction à vérifier par la route (les plus éloignés ne peuvent pas être à moins de ${formaterKm(v.seuilM)} par la route). Les autres factions ne comptent pas.` : `Aucun barage de la même faction ne peut être à moins de ${formaterKm(v.seuilM)} par la route de cet emplacement. Les autres factions ne comptent pas.` }));
  }

  _saisieCoordonnees(depart) {
    const { h } = this;
    const valeurs = { lat: depart.latitude.toFixed(6), lon: depart.longitude.toFixed(6) };
    const champ = (cle, libelle) => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('input', { type: 'text', inputmode: 'decimal', 'data-coord': cle, value: valeurs[cle], on: { input: (e) => { valeurs[cle] = e.target.value; } } }));
    return h('div', { class: 'opt-filtres' },
      champ('lat', 'Latitude (WGS84)'), champ('lon', 'Longitude (WGS84)'),
      h('button', { type: 'button', class: 'bouton-outil', text: 'Vérifier ces coordonnées', on: {
        click: () => {
          const lat = Number(String(valeurs.lat).replace(',', '.'));
          const lon = Number(String(valeurs.lon).replace(',', '.'));
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            this.etude.erreur = 'Coordonnées invalides (degrés décimaux, ex. 33.58973 et -7.62994).';
            return this.tableau.rendre();
          }
          this.proposerEn([lon, lat]);
        },
      } }));
  }

  _propositions() {
    const { h } = this;
    const liste = this.historique.propositions;
    const n = compterPropositions(this.historique);
    return h('div', { class: 'groupe' },
      h('h3', { text: `Propositions de déplacement (${n.total} : ${n['en-attente']} en attente, ${n.appliquee} appliquées, ${n.rejetee} rejetées, ${n.annulee} annulées)` }),
      liste.length ? h('ol', { class: 'opt-liste' }, liste.slice(0, 50).map((p) => h('li', { class: 'opt-constat' },
        h('div', { class: 'opt-constat-tete' }, h('strong', { text: `${p.barageId} (${p.faction ? libelleFaction(p.faction) : '?'}, ${p.origine})` }), h('span', { class: `opt-statut ${p.statut === 'appliquee' ? 'applique' : p.statut === 'rejetee' ? 'refuse' : p.statut}`, text: STATUTS_PROPOSITION[p.statut] ?? p.statut })),
        h('p', { class: 'opt-ids', text: `${p.avant.latitude.toFixed(5)}, ${p.avant.longitude.toFixed(5)} → ${p.apres.latitude.toFixed(5)}, ${p.apres.longitude.toFixed(5)}` }),
        h('p', { class: 'aide', text: `${p.verification ? `${LIBELLES_VALIDATION[p.verification.statut]} à l’enregistrement` : ''} · seuil ${formaterKm(p.seuilKm * 1000)}${p.regleModifiee ? ` (règle modifiée, réglage : ${p.regleModifiee.de} km)` : ''}${p.partenaire ? ` · vers ${p.partenaire} : ${formaterKm(p.effet.routeAvantM)} → ${formaterKm(p.effet.routeApresM)} par la route` : ''} · ${this.date(p.date)}${p.erreur ? ` · erreur : ${p.erreur}` : ''}` }),
        h('div', { class: 'opt-liens' },
          p.statut === 'en-attente' ? h('button', { type: 'button', class: 'lien', text: 'Appliquer…', on: { click: () => this.appliquer(p) } }) : null,
          p.statut === 'en-attente' ? h('button', { type: 'button', class: 'lien', text: 'Rejeter', on: { click: () => this.rejeter(p) } }) : null,
          p.statut === 'appliquee' ? h('button', { type: 'button', class: 'lien', text: 'Annuler le déplacement', on: { click: () => this.annulerDeplacement(p) } }) : null)))) : h('p', { class: 'aide', text: 'Aucune proposition.' }));
  }

  _journal() {
    const { h } = this;
    const titres = {
      proposition: 'Proposition enregistrée', rejet: 'Proposition rejetée', application: 'Déplacement appliqué', annulation: 'Déplacement annulé',
      'annulation-refusee': 'Annulation refusée', 'refus-application': 'Application refusée', creation: 'Barage créé (carte de chaleur)',
      'annulation-creation': 'Création annulée', 'carte-chaleur': 'Carte de chaleur calculée',
    };
    const ev = this.historique.evenements;
    const annulees = new Set(ev.filter((x) => x.type === 'annulation-creation').map((x) => x.de));
    const analyses = this.historique.analyses.filter((a) => a.stats && 'calculees' in a.stats);
    return h('div', { class: 'groupe' },
      h('h3', { text: 'Historique (ce navigateur)' }),
      analyses.length ? h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison opt-historique' },
        h('thead', {}, h('tr', {}, ['Analyse', 'Faction', 'Seuil (route)', 'Barages', 'Itinéraires', 'Alertes', 'Indisponibles'].map((t) => h('th', { text: t })))),
        h('tbody', {}, analyses.map((a) => h('tr', {}, h('td', { text: this.date(a.date) }), h('td', { text: a.regles.faction === 'toutes' ? 'toutes' : libelleFaction(a.regles.faction) }),
          h('td', { text: formaterKm(a.regles.distanceMaxKm * 1000) }), h('td', { text: String(a.analyses) }), h('td', { text: String(a.stats.calculees) }),
          h('td', { text: String(a.stats.alertes) }), h('td', { text: String(a.stats.indisponibles + a.stats.erreurs) })))))) : null,
      ev.length ? h('ol', { class: 'opt-refus' }, ev.slice(0, 100).map((x) => h('li', {},
        `${this.date(x.date)} · ${titres[x.type] ?? x.type} · ${x.barage ?? x.zone ?? ''}${x.verification ? ` · ${LIBELLES_VALIDATION[x.verification]}` : ''}${x.raison ? ` : ${x.raison}` : ''}${x.conflits ? ` : ${x.conflits.join(' ')}` : ''} `,
        x.type === 'creation' && !annulees.has(x.id) ? h('button', { type: 'button', class: 'lien', text: 'Annuler la création', on: { click: () => this.annulerCreation(x) } }) : null))) : h('p', { class: 'aide', text: 'Aucun événement.' }));
  }

  // ── Rendu : Carte de chaleur ─────────────────────────────────────────────

  rendreChaleur() {
    const { h } = this;
    const c = this.chaleur;
    const b = structuredClone(this.reglesChaleur);
    const enCours = c.etat === 'en-cours';
    const r = c.resultat;
    const k = this.comptesChaleur();
    const css = (v) => `rgba(${couleurAptitude(v).slice(0, 3).join(',')},${(couleurAptitude(v)[3] / 255).toFixed(2)})`;
    const legende = h('div', { class: 'opt-legende-surface' },
      h('div', { class: 'opt-degrade', style: `background:linear-gradient(to right, ${css(0)}, ${css(0.5)}, ${css(1)})`, role: 'img', 'aria-label': 'Aptitude : de non adapté (rouge) à potentiellement adapté (vert)' }),
      h('div', { class: 'opt-degrade-libelles' }, h('span', { text: 'Non adapté' }), h('span', { text: 'Incertain' }), h('span', { text: 'Potentiellement adapté' })),
      h('ul', { class: 'opt-legende-chaleur' },
        h('li', {}, h('span', { class: 'pastille carre', style: `background:${css(INCONNU)}` }), h('strong', { text: 'Inconnu' }), h('small', { text: ' distance routière indisponible : la règle ne peut pas être vérifiée' })),
        h('li', {}, h('span', { class: 'pastille carre', style: `background:${css(SANS_ROUTE)};outline:1px solid ${css(INCONNU)}` }), h('strong', { text: 'Sans route' }), h('small', { text: ' aucune route carrossable proche : pas d’emplacement possible' }))),
      h('p', { class: 'aide', text: `Rouge : un barage de la même faction à ${r ? formaterKm(r.regles.distanceMaxKm * 1000) : 'D'} ou moins par la route (jamais présenté comme adapté). Couleur interpolée entre les lieux vérifiés par la route le long du réseau, sur une grille de ${LARGEUR_SURFACE} colonnes, découpée à la limite de la zone.${r ? ` Lieux vérifiés : ${k.adapte} adaptés, ${k['a-examiner']} à examiner, ${k.invalide} non valides, ${k.indetermine} inconnus.` : ''}` }));
    return [
      h('div', { class: 'groupe' },
        h('h3', { text: 'Carte de chaleur des emplacements' }),
        h('p', { class: 'aide', text: 'Surface continue d’aptitude : des lieux sont pris le long des routes carrossables réelles (tuiles locales) de la zone, chacun vérifié par la route avec la règle commune (aucun barage de la même faction à une distance routière inférieure ou égale au minimum), puis la couleur est interpolée entre eux. Elle se recalcule quand la zone, la faction, la distance ou les barages changent. Ce sont des suggestions : la carte ne dit pas qu’un endroit est opérationnellement optimal (relief, visibilité, sécurité, trafic ne sont pas dans les données). Cliquez sur la surface pour le détail d’un endroit.' }),
        h('div', { class: 'opt-filtres' },
          h('label', { class: 'champ opt-plein' }, h('span', { text: 'Faction du futur barage' }),
            h('select', { id: 'opt-chaleur-faction', on: { change: (e) => { b.faction = e.target.value; this._reglesChaleur(b); this._planifierChaleur(); } } }, FACTIONS.map((f) => h('option', { value: f, text: libelleFaction(f), selected: b.faction === f })))),
          h('label', { class: 'champ' }, h('span', { text: 'Distance routière minimale (km)' }),
            h('input', { type: 'number', id: 'opt-chaleur-distance', min: LIMITES.distanceMinKm, max: LIMITES.distanceMaxKm, step: 0.1, value: String(b.distanceMaxKm), on: { input: (e) => { b.distanceMaxKm = Number(e.target.value); }, change: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= LIMITES.distanceMinKm && v <= LIMITES.distanceMaxKm) { this._reglesChaleur({ ...b, distanceMaxKm: v }); this._planifierChaleur(); } } } })),
          h('div', { class: 'champ opt-plein' }, h('span', { text: 'Barages comparés' }), h('div', { class: 'segments', role: 'group' },
            [['simulation', 'Simulés'], ['reelle', 'Réels']].map(([v, l]) => h('button', { type: 'button', 'data-chaleur-origine': v, 'aria-pressed': String(b.origine === v), text: l,
              on: { click: (e) => { b.origine = v; for (const x of e.target.parentElement.children) x.setAttribute('aria-pressed', String(x === e.target)); this._reglesChaleur(b); this._planifierChaleur(); } } })))),
          this._choixZone(b, (x) => { this._reglesChaleur(x); if (x.perimetre.reg || x.perimetre.cie || x.perimetre.bt) this._planifierChaleur(); }, 'chaleur')),
        h('div', { class: 'opt-actions' },
          h('button', { type: 'button', class: 'bouton-principal', text: 'Calculer la carte de chaleur', disabled: enCours, on: { click: () => this.lancerChaleur(b) } }),
          enCours ? h('button', { type: 'button', class: 'bouton-outil', text: 'Annuler', on: { click: () => this.annulerChaleur() } }) : null,
          r && !enCours ? h('button', { type: 'button', class: 'lien', text: 'Effacer la carte de chaleur', on: { click: () => this.effacerChaleur() } }) : null)),
      enCours ? this._barreProgression('opt-chaleur', c, c.etape === 'routes' ? 'Lecture des routes de la zone…' : 'Vérification des emplacements par la route (la carte reste utilisable)…') : null,
      c.etat === 'erreur' ? h('p', { class: 'opt-message erreur', text: c.erreur }) : null,
      legende,
      r ? h('p', { class: 'aide', text: `${c.zone?.nom ?? ''} · ${libelleFaction(r.regles.faction)} · minimum ${formaterKm(r.regles.distanceMaxKm * 1000)} par la route · un point tous les ${formaterKm(r.pasM)} de route · ${r.candidats.length} emplacements vérifiés${r.total > r.candidats.length && !r.annule ? ` (échantillon régulier de ${r.candidats.length} points sur ${r.total})` : ''}${r.illisibles ? ` · ${r.illisibles} fenêtre(s) de tuiles illisible(s) : zones non couvertes` : ''}${r.annule ? ' · interrompue' : ''}` }) : null,
      r && this.couche.version !== c.version ? h('p', { class: 'opt-message info', text: 'Les barages ont changé depuis ce calcul : relancez la carte de chaleur.' }) : null,
      this._candidat(),
      r && !enCours ? this._listeCandidats(r) : null,
    ];
  }

  /** Emplacements par classe (les plus éloignés de la faction d'abord), accessibles sans viser un point sur la carte. */
  _listeCandidats(r) {
    const { h } = this;
    return h('div', { class: 'groupe' }, h('h3', { text: 'Lieux vérifiés par la route, par classe' }),
      Object.entries(CLASSES_CANDIDAT).map(([cle, cl]) => {
        const liste = r.candidats.map((x, i) => ({ x, i })).filter(({ x }) => x.classe === cle)
          .sort((p, q) => (q.x.validation.minimumM ?? Infinity) - (p.x.validation.minimumM ?? Infinity)).slice(0, 8);
        if (!liste.length) return null;
        return h('details', { class: 'opt-details', 'data-classe': cle }, h('summary', { text: `${cl.libelle} (${r.candidats.filter((x) => x.classe === cle).length})` }),
          h('ul', { class: 'opt-refus' }, liste.map(({ x, i }) => h('li', {}, h('button', {
            type: 'button', class: 'lien', 'data-candidat': i,
            text: `${nomRoute(x.route)} · ${x.point[1].toFixed(4)}, ${x.point[0].toFixed(4)} · ${x.validation.minimumM === null ? 'aucun barage de la faction à vérifier' : `plus proche de la faction : ${formaterKm(x.validation.minimumM)} par la route`}`,
            on: { click: () => { this.inspecterCandidat(i); this.tableau._cadrer([x.point, ...x.validation.verifiees.map((v) => [v.enr.barage.longitude, v.enr.barage.latitude])]); } },
          })))));
      }));
  }

  _candidat() {
    const { h } = this;
    const c = this.chaleur;
    const x = c.resultat?.candidats[c.selection];
    if (!x) return c.resultat ? h('p', { class: 'aide', text: 'Cliquez sur la surface pour l’aptitude d’un endroit, la route et les distances aux barages de la faction.' }) : null;
    const cl = CLASSES_CANDIDAT[x.classe];
    const a = c.apercu;
    return h('div', { class: 'groupe opt-etude' },
      h('h3', { text: `Emplacement candidat · ${cl.libelle}` }),
      h('dl', { class: 'insp-lignes opt-detail' },
        h('dt', { text: 'Position' }), h('dd', { text: `${x.point[1].toFixed(5)}, ${x.point[0].toFixed(5)}` }),
        h('dt', { text: 'Route' }), h('dd', { text: nomRoute(x.route) }),
        h('dt', { text: 'Brigade' }), h('dd', { text: x.btId ? this.couche.hierarchie?.brigades.get(x.btId)?.nom ?? x.btId : 'hors des circonscriptions de brigade' }),
        h('dt', { text: 'Règle' }), h('dd', { text: `${LIBELLES_VALIDATION[x.validation.statut]} — ${cl.aide}` })),
      x.validation.horsBrigade ? h('p', { class: 'opt-message info', text: 'Point hors des circonscriptions de brigade : un barage doit être rattaché à une brigade.' }) : this._detailsValidation(x.validation),
      !a ? h('button', { type: 'button', class: 'bouton-outil', text: 'Prévisualiser un nouveau barage ici', disabled: x.classe === 'invalide' || x.validation.horsBrigade, on: { click: () => this.apercuCreation() } }) : this._apercu(a));
  }

  _apercu(a) {
    const { h } = this;
    if (a.calcul) return h('p', { class: 'opt-message info', text: 'Préparation de l’aperçu : accroche à la route et vérification par la route…' });
    if (a.erreur) return h('p', { class: 'opt-message erreur', text: a.erreur });
    const v = a.validation;
    const peut = v.statut === 'valide' || (v.statut === 'verification-impossible' && a.accepteIncertain);
    return h('div', { class: 'groupe' },
      h('h3', { text: 'Aperçu du nouveau barage (rien n’est créé)' }),
      h('label', { class: 'champ' }, h('span', { text: 'Nom' }), h('input', { type: 'text', id: 'opt-nom-nouveau', maxlength: 80, value: a.nom, on: { input: (e) => { a.nom = e.target.value; } } })),
      h('dl', { class: 'insp-lignes opt-detail' },
        h('dt', { text: 'Type, faction' }), h('dd', { text: `${a.modele.type === 'intouchable' ? 'Barage fixe intouchable' : 'Barage fixe'} · ${libelleFaction(a.modele.shift)}` }),
        h('dt', { text: 'Origine' }), h('dd', { text: a.modele.isSimulation ? 'simulé' : 'réel' }),
        h('dt', { text: 'Position (accrochée)' }), h('dd', { text: `${a.place.point[1].toFixed(5)}, ${a.place.point[0].toFixed(5)} · ${nomRoute(a.place.route)}` }),
        h('dt', { text: 'Brigade' }), h('dd', { text: this.couche.hierarchie?.brigades.get(a.place.btId)?.nom ?? a.place.btId })),
      h('p', { class: `opt-message ${CLASSES_VALIDATION[v.statut]}`, text: LIBELLES_VALIDATION[v.statut] }),
      v.statut !== 'valide' ? this._detailsValidation(v) : null,
      v.statut === 'verification-impossible' ? h('label', { class: 'opt-cases' },
        h('input', { type: 'checkbox', checked: a.accepteIncertain, on: { change: (e) => { a.accepteIncertain = e.target.checked; this.tableau.rendre(); } } }),
        ' Je confirme avoir vérifié moi-même les distances indisponibles.') : null,
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-principal', text: 'Créer le barage…', disabled: !peut, on: { click: () => this.creerDepuisApercu() } }),
        h('button', { type: 'button', class: 'lien', text: 'Annuler l’aperçu', on: { click: () => { this.chaleur.apercu = null; this.tableau.rendre(); } } })));
  }
}
