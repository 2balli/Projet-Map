/**
 * Tableau « Optimisation des barrages » : analyse (worker), constats, doublons, simulation
 * avant / après, validation manuelle, règles, historique et annulation. Voir optimisation.js.
 *
 * Ce qui est écrit, et où (ce navigateur seulement, pas de serveur ni de compte) :
 *   - règles et historique des sessions : localStorage (clés maroc-carte:optimisation:*) ;
 *   - corrections appliquées : la surcouche locale des barages (comme l'édition de la carte),
 *     jamais le fichier donnees/barages/barages.json ; « Exporter barages.json » les transmet.
 * Rien n'est supprimé ni fusionné ; un barage n'est corrigé qu'après approbation, nouvelle
 * vérification et confirmation.
 */
import { CONTINU, LIBELLES_CRENEAUX, numeroFaction } from './barages.js';
import { CentreDedoublonnage } from './dedoublonnage-ui.js';
import { CentreProximite } from './proximite-ui.js';
import { EspaceComptes } from './comptes-ui.js';
import { circonscriptionEn } from './competence.js';
import { DISTANCE_SIMPLE_DEFAUT_KM, validerDistanceSimple } from './proximite.js';
import { element } from './dom.js';
import {
  CATEGORIES, CHAMPS_COMPARABLES, DESCRIPTIONS_REGLES, REGLES_DEFAUT, SEVERITES, STATUTS, ajouterSession, annulerEntree,
  appliquerAuxEditions, controlerEnregistrement, decider, doublonsExacts, filtrerConstats, lireHistorique, majSession, nouvelleSession,
  planifierApplication, quasiDoublons, statistiques, statutDe, validerRegles,
} from './optimisation.js';

const CLE_REGLES = 'maroc-carte:optimisation:regles:v1';
const CLE_HISTORIQUE = 'maroc-carte:optimisation:historique:v1';
const PAR_PAGE = 30;
const ONGLETS = [
  ['proximite', 'Proximité'], ['deplacements', 'Déplacements'], ['chaleur', 'Carte de chaleur'],
  ['ensemble', 'Qualité des données'], ['analyser', 'Analyser'], ['anomalies', 'Anomalies'], ['doublons', 'Doublons'],
  ['simulation', 'Simulation'], ['validation', 'Validation'], ['regles', 'Règles'], ['historique', 'Historique'],
];
const LIBELLES_SEVERITE = { erreur: 'Erreur', avertissement: 'Avertissement', info: 'Information' };
const LIBELLES_CONFIANCE = { haute: 'Confiance haute', moyenne: 'Confiance moyenne', faible: 'Confiance faible' };
const LIBELLES_REFUS = {
  'cible-absente': 'Barage introuvable', 'cible-ambigue': 'Identifiant en double', perimee: 'Proposition périmée',
  conflit: 'Conflit', 'champ-verrouille': 'Champ verrouillé', invalide: 'Résultat invalide', 'sans-proposition': 'Sans proposition',
};
const LIBELLES_CHAMPS = { id: 'Identifiant', name: 'Nom', type: 'Type', shift: 'Faction', btId: 'Brigade', latitude: 'Latitude', longitude: 'Longitude', route: 'Route', isSimulation: 'Origine', validation: 'Trace de validation' };
const SOURCE_CARTE = 'optimisation';
const SOURCE_ZONE = 'optimisation-zone';
const SOURCE_SURFACE = 'optimisation-surface';

/** Petit constructeur de DOM : propriétés, attributs, écouteurs, enfants (texte jamais interprété). */
function h(balise, props = {}, ...enfants) {
  const el = element(balise, props.class ?? null, props.text ?? null);
  for (const [k, v] of Object.entries(props)) {
    if (['class', 'text'].includes(k) || v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
    else if (['hidden', 'disabled', 'checked', 'value', 'type', 'title', 'selected'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants.flat(Infinity)) if (e !== null && e !== undefined && e !== false) el.append(e instanceof Node ? e : String(e));
  return el;
}

const lireStockage = (cle) => {
  try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch { return null; }
};
/** Empreinte (FNV-1a) du contenu des barages : survit au rechargement, contrairement à un compteur. */
export function empreinte(instantane) {
  const texte = JSON.stringify(instantane.enregistrements.map((e) => [e.source, e.barage]));
  let x = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) x = Math.imul(x ^ texte.charCodeAt(i), 0x01000193) >>> 0;
  return `${instantane.enregistrements.length}-${x.toString(16)}`;
}

const date = (iso) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));

/** Valeur lisible d'un champ de barage. */
function lisible(champ, v) {
  if (v === undefined || v === null || v === '') return '—';
  if (champ === 'shift') return v === CONTINU ? 'Continu (intouchable)' : LIBELLES_CRENEAUX[v] ? `Faction ${numeroFaction(v)} · ${LIBELLES_CRENEAUX[v]}` : JSON.stringify(v);
  if (champ === 'isSimulation') return v === true ? 'Simulé' : v === false ? 'Réel' : JSON.stringify(v);
  if (champ === 'route' && typeof v === 'object') return [v.ref, v.nom].filter(Boolean).join(' · ') || `route sans nom (${v.classe ?? '?'})`;
  if (typeof v === 'number') return String(v);
  // Une coordonnée écrite en texte doit se distinguer du nombre qui la remplace.
  if ((champ === 'latitude' || champ === 'longitude') && typeof v === 'string') return `« ${v} » (texte)`;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export class TableauOptimisation {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ $: (id: string) => HTMLElement, couche: import('./couche-barages.js').CoucheBarages,
   *           urls: { circos: { reg, cie, bt }, tuiles: string }, activerCouche: () => void, fermerFiche?: () => void }} options
   */
  constructor(carte, { $, couche, urls, activerCouche, fermerFiche = () => {}, reseau = null, arreterOutils = () => {}, session = undefined }) {
    Object.assign(this, { carte, $, couche, urls, activerCouche, fermerFiche });
    this.panneau = $('optimisation');
    this.contenu = $('opt-contenu');
    const { regles, erreurs } = validerRegles(lireStockage(CLE_REGLES) ?? {});
    this.regles = erreurs.length ? validerRegles({}).regles : regles;
    this.historique = lireHistorique(lireStockage(CLE_HISTORIQUE));
    this.sessionId = this.historique.sessions[0]?.id ?? null;
    this.onglet = 'proximite';
    this.analyse = { etat: 'inactif', id: 0, fait: 0, total: 0, etape: '', erreur: null };
    this.filtres = { categorie: '', severite: '', statut: '', origine: '', reg: '', texte: '' };
    this.page = 1;
    this.selection = null; // constat ouvert (doublons, simulation)
    this.ouvert = new Set(); // constats dépliés dans la liste
    this.revue = null; // plan d'application vérifié, en attente de confirmation
    this.message = null;
    this.vueAvant = null;
    this._worker = null;
    this._traits = [];
    this.dedoublonnage = new CentreDedoublonnage(this, { h, date });
    this.proximite = new CentreProximite(this, { h, date, reseau, arreterOutils });
    couche.controleEspacement = (b) => this.proximite.controlerNouveau(b);
    this.espace = new EspaceComptes(this, { h, date, $ });
    this.espace.initialiser(session);
    couche.deplacerAvecValidation = (id) => this.proximite.deplacerBarage(id);
    couche.alertesDe = (id) => this.proximite.alertesDe(id);
    couche.voirAlerte = (i) => this.proximite.selectionnerAlerte(i);

    $('opt-fermer').addEventListener('click', () => this.fermer());
    this.mode = 'simple'; // « Optimisation » : fenêtre puis résultats compacts ; « Outils avancés » : tableau complet
    $('opt-dialogue-formulaire').addEventListener('submit', (e) => {
      e.preventDefault();
      this.calculer();
    });
    $('opt-dialogue-annuler').addEventListener('click', () => this.fermerDialogue());
    couche.surDonnees(() => { if (!this.panneau.hidden) this.rendre(); });
    couche.controleAjout = (b) => this.controlerAjout(b);
  }

  get session() {
    return this.historique.sessions.find((s) => s.id === this.sessionId) ?? null;
  }

  // ── Ouverture ────────────────────────────────────────────────────────────

  /** « Optimisation » selon le rôle (vérifié ensuite par le serveur à chaque opération). */
  async basculer() {
    if (!this.panneau.hidden) return this.fermer();
    if (this.espace.disponible === null) await this.espace.initialiser();
    if (this.espace.admin) return this.ouvrirDialogue();
    if (this.espace.commandement) return this.ouvrirCommandement();
    this.espace.ouvrirConnexion({
      message: this.espace.disponible === false ? null : 'L’optimisation est réservée au superadmin ; les comptes régionaux y trouvent leurs conflits.',
    });
  }

  async ouvrirCommandement() {
    this.mode = 'commandement';
    this.message = null;
    if (this.couche.etat === 'inactif') this.activerCouche();
    this.ouvrir('proximite');
    await this.espace.chargerConflits();
  }

  /** Région au centre de la carte, si on la reconnaît sûrement (échelle régionale) ; sinon null. */
  async _regionActuelle() {
    if (this.carte.getZoom() < 7) return null;
    const circos = await this.couche.circos?.().catch(() => null);
    if (!circos?.reg) return null;
    const c = this.carte.getCenter();
    return circonscriptionEn(circos.reg, [c.lng, c.lat]);
  }

  /** « Optimisation » : petite fenêtre, une seule distance, « Calculer » ou « Annuler ». */
  async ouvrirDialogue() {
    const d = this.$('opt-dialogue');
    const champ = this.$('opt-dialogue-distance');
    if (!champ.value) champ.value = String(this.proximite.regles.distanceMaxKm ?? DISTANCE_SIMPLE_DEFAUT_KM);
    this.$('opt-dialogue-erreur').hidden = true;
    // Région : la région actuelle si la carte la montre sûrement, sinon un choix explicite.
    const actuelle = await this._regionActuelle();
    const regions = [...(this.couche.hierarchie?.regions.values() ?? [])].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const choix = this.$('opt-dialogue-region');
    choix.replaceChildren(
      h('option', { value: actuelle ? `actuelle:${actuelle.id}` : '', text: actuelle ? `Région actuelle (${actuelle.nom})` : '— Choisir une région —', selected: true }),
      ...regions.map((r) => h('option', { value: r.id, text: r.nom })));
    this.$('opt-dialogue-region-aide').textContent = actuelle ? '' : 'Région actuelle non identifiable (vue trop large ou hors des régions) : choisissez-en une.';
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    champ.focus();
    champ.select?.();
  }

  fermerDialogue() {
    const d = this.$('opt-dialogue');
    if (typeof d.close === 'function' && d.open) d.close();
    else d.removeAttribute('open');
  }

  /** « Calculer » : distance validée, fenêtre fermée, analyse lancée, résultats compacts. */
  async calculer() {
    const v = validerDistanceSimple(this.$('opt-dialogue-distance').value);
    const erreur = this.$('opt-dialogue-erreur');
    const regId = this.$('opt-dialogue-region').value.replace(/^actuelle:/, '');
    if (v.erreur || !regId) {
      erreur.textContent = v.erreur ?? 'Choisissez une région.';
      erreur.hidden = false;
      return;
    }
    this.fermerDialogue();
    this.mode = 'simple';
    this.onglet = 'proximite';
    this.message = null;
    if (this.couche.etat === 'inactif') this.activerCouche();
    this.ouvrir('proximite');
    // Barages pas encore chargés (couche juste activée) : attendre le chargement.
    for (let k = 0; k < 200 && this.couche.etat === 'chargement'; k++) await new Promise((r) => setTimeout(r, 100));
    if (this.couche.etat !== 'pret') return this.rendre();
    await this.proximite.calculerSimple(v.km, regId);
  }

  /** Outils avancés : le tableau complet (onglets), pour la carte de chaleur, la qualité, l'historique… */
  modeComplet() {
    this.mode = 'complet';
    this.rendre();
  }

  ouvrir(onglet = this.onglet) {
    this.fermerFiche();
    this.onglet = onglet;
    this.panneau.hidden = false;
    document.body.classList.add('tableau-ouvert');
    this._marquer(true);
    this.rendre();
  }

  fermer() {
    this.panneau.hidden = true;
    document.body.classList.remove('tableau-ouvert');
    this._marquer(false);
    this.proximite.fermerEtude({ rendre: false });
    this._surligner(null);
  }

  // Proximité, déplacements, carte de chaleur (proximite-ui.js)
  _chaleur() {
    return this.proximite.rendreChaleur();
  }

  _proximite() {
    return this.proximite.rendreProximite();
  }

  _deplacements() {
    return this.proximite.rendreDeplacements();
  }

  _marquer(ouvert) {
    for (const b of document.querySelectorAll('#rail [data-tableau="optimisation"]')) b.setAttribute('aria-pressed', String(ouvert));
  }

  // ── Carte : surlignage des barages d'un constat, aperçu des positions proposées ─

  installer() {
    if (!this.carte.getSource(SOURCE_CARTE)) this.carte.addSource(SOURCE_CARTE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const couleurLigne = ['match', ['get', 'role'], 'route-apres', '#7c3aed', 'route-actuel', '#0369a1', 'route-liste', '#0369a1', 'route-violation', '#dc2626', '#64748b'];
    const vide = { type: 'FeatureCollection', features: [] };
    if (!this.carte.getSource(SOURCE_ZONE)) this.carte.addSource(SOURCE_ZONE, { type: 'geojson', data: vide });
    const zoneEtChaleur = [
      { id: 'optimisation-zone-fond', type: 'fill', source: SOURCE_ZONE, paint: { 'fill-color': '#0369a1', 'fill-opacity': 0.05 } },
      { id: 'optimisation-zone-trait', type: 'line', source: SOURCE_ZONE, paint: { 'line-color': '#0369a1', 'line-width': 3, 'line-dasharray': [3, 1.5] } },
    ];
    for (const c of zoneEtChaleur) if (!this.carte.getLayer(c.id)) this.carte.addLayer(c);
    const couches = [
      {
        id: 'optimisation-vol', type: 'line', filter: ['match', ['get', 'role'], ['vol-actuel', 'vol-apres', 'vol-liste'], true, false],
        paint: { 'line-color': '#64748b', 'line-width': 1.5, 'line-dasharray': [1, 2] },
      },
      {
        id: 'optimisation-route', type: 'line', filter: ['match', ['get', 'role'], ['route-actuel', 'route-apres', 'route-liste', 'route-violation'], true, false],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': couleurLigne, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 6], 'line-opacity': 0.85 },
      },
      {
        id: 'optimisation-barages', type: 'circle', filter: ['match', ['get', 'role'], ['barage-actuel', 'barage-apres', 'barage-liste'], true, false],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 14, 9], 'circle-color': '#ffffff', 'circle-stroke-width': 3,
          'circle-stroke-color': ['match', ['get', 'role'], 'barage-apres', '#7c3aed', '#0369a1'],
        },
      },
      {
        id: 'optimisation-etiquette-ligne', type: 'symbol', filter: ['all', ['has', 'texte'], ['==', ['geometry-type'], 'LineString']],
        layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'texte'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, -0.9], 'text-allow-overlap': true },
        paint: { 'text-color': couleurLigne, 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
      },
      { id: 'optimisation-trajet', type: 'line', filter: ['==', ['get', 'role'], 'deplacement'], paint: { 'line-color': '#6d28d9', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } },
      { id: 'optimisation-cible', type: 'circle', filter: ['==', ['get', 'role'], 'cible'], paint: { 'circle-radius': 15, 'circle-color': 'rgba(109,40,217,0.12)', 'circle-stroke-color': '#6d28d9', 'circle-stroke-width': 3 } },
      { id: 'optimisation-propose', type: 'circle', filter: ['==', ['get', 'role'], 'propose'], paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#6d28d9', 'circle-stroke-width': 3 } },
      {
        id: 'optimisation-doublons', type: 'circle', filter: ['match', ['get', 'role'], ['conserve', 'supprimer', 'potentiel'], true, false],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9],
          'circle-color': ['match', ['get', 'role'], 'conserve', '#15803d', 'supprimer', '#b91c1c', '#d97706'],
          'circle-opacity': 0.35, 'circle-stroke-width': 2.5,
          'circle-stroke-color': ['match', ['get', 'role'], 'conserve', '#15803d', 'supprimer', '#b91c1c', '#d97706'],
        },
      },
      { id: 'optimisation-etiquette', type: 'symbol', filter: ['all', ['has', 'texte'], ['==', ['geometry-type'], 'Point']], layout: { 'text-field': ['get', 'texte'], 'text-font': ['Noto Sans Medium'], 'text-size': 11, 'text-offset': [0, -1.6], 'text-allow-overlap': true }, paint: { 'text-color': '#6d28d9', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 } },
    ];
    for (const c of couches) if (!this.carte.getLayer(c.id)) this.carte.addLayer({ ...c, source: SOURCE_CARTE });
    this._afficher(this._traits);
    this.carte.getSource(SOURCE_ZONE)?.setData({ type: 'FeatureCollection', features: this._zoneTrait ? [this._zoneTrait] : [] });
    this._afficherSurface(this._surface ?? null);
  }

  /** Zone choisie surlignée (limite de la circonscription), ou rien. */
  _afficherZone(geometrie) {
    this._zoneTrait = geometrie ? { type: 'Feature', properties: {}, geometry: geometrie } : null;
    this.carte.getSource(SOURCE_ZONE)?.setData({ type: 'FeatureCollection', features: this._zoneTrait ? [this._zoneTrait] : [] });
  }

  /**
   * Surface continue de la carte de chaleur : une image (raster) posée aux quatre coins de son
   * emprise, sous les étiquettes de la carte ; null la retire.
   * @param {{ url: string, coins: number[][] } | null} surface
   */
  _afficherSurface(surface) {
    this._surface = surface;
    const carte = this.carte;
    if (!surface) {
      if (carte.getLayer(SOURCE_SURFACE)) carte.removeLayer(SOURCE_SURFACE);
      if (carte.getSource(SOURCE_SURFACE)) carte.removeSource(SOURCE_SURFACE);
      return;
    }
    const source = carte.getSource(SOURCE_SURFACE);
    if (source) {
      source.updateImage({ url: surface.url, coordinates: surface.coins });
      return;
    }
    carte.addSource(SOURCE_SURFACE, { type: 'image', url: surface.url, coordinates: surface.coins });
    // Sous la première couche d'étiquettes : routes, noms et barages restent lisibles au-dessus.
    const avant = carte.getStyle().layers.find((c) => c.type === 'symbol')?.id;
    carte.addLayer({ id: SOURCE_SURFACE, type: 'raster', source: SOURCE_SURFACE, paint: { 'raster-opacity': 0.72, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, avant);
  }

  /** Cadre la carte sur une emprise [ouest, sud, est, nord] (marge pour le tableau ouvert). */
  _cadrerEmprise([o, s, e, n]) {
    const droite = this.panneau.offsetWidth && window.innerWidth > 900 ? this.panneau.offsetWidth + 40 : 40;
    const bas = window.innerWidth <= 640 && !this.panneau.hidden ? Math.round(window.innerHeight * 0.55) : 60;
    this.carte.fitBounds([[o, s], [e, n]], { padding: { top: 90, bottom: bas, left: 60, right: droite }, maxZoom: 14, duration: 800 });
  }

  /** Remplace ce que le tableau dessine sur la carte (gardé pour être redessiné après un changement de style). */
  _afficher(traits) {
    this._traits = traits;
    this.carte.getSource(SOURCE_CARTE)?.setData({ type: 'FeatureCollection', features: traits });
  }

  /** Cadre la carte sur des points ; la vue d'avant est gardée pour « Revenir ». */
  _cadrer(points) {
    if (!points.length) return;
    this.vueAvant ??= { center: this.carte.getCenter(), zoom: this.carte.getZoom(), bearing: this.carte.getBearing(), pitch: this.carte.getPitch() };
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const largeur = this.panneau.offsetWidth && window.innerWidth > 900 ? this.panneau.offsetWidth + 40 : 40;
    this.carte.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: { top: 90, bottom: 90, left: 60, right: largeur }, maxZoom: 16, duration: 700 });
    this.rendre();
  }

  /** Barages d'un constat (positions à l'analyse), et positions proposées si `apercu`. */
  _surligner(c, { apercu = false } = {}) {
    this._surligne = c;
    const f = [];
    for (const e of c?.enregistrements ?? []) {
      const b = this.session?.enregistrements?.[e.cle];
      if (!Number.isFinite(b?.longitude) || !Number.isFinite(b?.latitude)) continue;
      f.push({ type: 'Feature', properties: { role: 'cible', texte: e.id ?? '' }, geometry: { type: 'Point', coordinates: [b.longitude, b.latitude] } });
    }
    const p = c?.proposition;
    if (apercu && p) {
      const champ = (k, defaut) => p.changements.find((x) => x.champ === k)?.apres ?? defaut;
      const b = this.session?.enregistrements?.[c.enregistrements[0]?.cle];
      const lon = champ('longitude', b?.longitude);
      const lat = champ('latitude', b?.latitude);
      if (Number.isFinite(lon) && Number.isFinite(lat) && (lon !== b?.longitude || lat !== b?.latitude)) {
        f.push({ type: 'Feature', properties: { role: 'propose', texte: 'proposé' }, geometry: { type: 'Point', coordinates: [lon, lat] } });
        if (Number.isFinite(b?.longitude) && Number.isFinite(b?.latitude)) {
          f.push({ type: 'Feature', properties: { role: 'deplacement' }, geometry: { type: 'LineString', coordinates: [[b.longitude, b.latitude], [lon, lat]] } });
        }
      }
    }
    this._afficher(f);
    return f;
  }

  /** Cadre la carte sur un constat (la vue d'avant est gardée pour y revenir). */
  localiser(c, options) {
    const f = this._surligner(c, options);
    this._cadrer(f.filter((x) => x.geometry.type === 'Point').map((x) => x.geometry.coordinates));
  }

  revenir() {
    if (!this.vueAvant) return;
    this.carte.easeTo({ ...this.vueAvant, duration: 600 });
    this.vueAvant = null;
    this._surligner(null);
    this.rendre();
  }

  // ── Stockage (ce navigateur) ─────────────────────────────────────────────

  /** Écrit l'historique ; si le stockage est plein, retire les sessions les plus anciennes. */
  _sauverHistorique() {
    for (;;) {
      try {
        localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(this.historique));
        return true;
      } catch {
        if (this.historique.sessions.length <= 1) {
          this.message = { type: 'erreur', texte: 'Historique non enregistré : stockage du navigateur plein ou indisponible. Les décisions de cette session seront perdues à la fermeture.' };
          return false;
        }
        this.historique = { ...this.historique, sessions: this.historique.sessions.slice(0, -1) };
      }
    }
  }

  _majSession(session) {
    this.historique = majSession(this.historique, session);
    this._sauverHistorique();
  }

  enregistrerRegles(brut) {
    const { regles, erreurs } = validerRegles(brut);
    if (erreurs.length) {
      this.message = { type: 'erreur', texte: `Règles non enregistrées : ${erreurs.join(' ; ')}.` };
      return false;
    }
    this.regles = regles;
    try {
      localStorage.setItem(CLE_REGLES, JSON.stringify(regles));
      this.message = { type: 'ok', texte: 'Règles enregistrées. Elles s’appliqueront à la prochaine analyse (les barages ne sont pas modifiés).' };
    } catch {
      this.message = { type: 'erreur', texte: 'Règles appliquées pour cette visite seulement : stockage du navigateur indisponible.' };
    }
    return true;
  }

  // ── Analyse (worker) ─────────────────────────────────────────────────────

  _travailleur() {
    if (this._worker) return this._worker;
    this._worker = new Worker(new URL('./optimisation-worker.js', import.meta.url), { type: 'module' });
    this._worker.onmessage = ({ data }) => this._surMessage(data);
    this._worker.onerror = (e) => {
      e.preventDefault?.();
      this.analyse = { ...this.analyse, etat: this.analyse.etat === 'en-cours' ? 'erreur' : this.analyse.etat, erreur: e.message || 'analyse interrompue' };
      this.dedoublonnage.surErreurWorker(e.message || 'analyse interrompue');
      this._worker?.terminate();
      this._worker = null;
      this.rendre();
    };
    return this._worker;
  }

  lancer() {
    const instantane = this.couche.instantane();
    if (!instantane) {
      this.message = { type: 'erreur', texte: 'Les barages ne sont pas chargés : activez la couche Barages.' };
      return this.rendre();
    }
    const id = this.analyse.id + 1;
    this.analyse = { etat: 'en-cours', id, fait: 0, total: instantane.enregistrements.length, etape: 'controles', erreur: null, version: this._empreinte(instantane), regles: structuredClone(this.regles), instantane };
    this.message = null;
    this._travailleur().postMessage({ type: 'analyser', id, instantane, regles: this.regles, urls: this.urls });
    this.rendre();
  }

  annulerAnalyse() {
    if (this.analyse.etat !== 'en-cours') return;
    this._worker?.postMessage({ type: 'annuler', id: this.analyse.id });
  }

  _surMessage(data) {
    if (typeof data.id === 'string' && data.id.startsWith('D-')) return this.dedoublonnage.surMessage(data);
    if (typeof data.id === 'string' && (data.id.startsWith('P-') || data.id.startsWith('C-'))) return this.proximite.surMessage(data);
    if (data.id !== this.analyse.id) return;
    if (data.progression) {
      [this.analyse.fait, this.analyse.total, this.analyse.etape] = data.progression;
      return this._rendreProgression();
    }
    if (data.erreur) {
      this.analyse = { ...this.analyse, etat: 'erreur', erreur: data.erreur };
      return this.rendre();
    }
    const { instantane, regles, version } = this.analyse;
    const session = nouvelleSession(data.resultat, regles, { version });
    // Valeurs des barages concernés, figées au moment de l'analyse (preuves, comparaison, carte).
    const parCle = new Map(instantane.enregistrements.map((e) => [`${e.source}#${e.rang}`, e.barage]));
    session.enregistrements = Object.fromEntries([...new Set(session.constats.flatMap((c) => c.enregistrements.map((e) => e.cle)))].map((cle) => [cle, parCle.get(cle)]));
    this.historique = ajouterSession(this.historique, session);
    this.sessionId = session.id;
    this._sauverHistorique();
    this.analyse = { etat: 'inactif', id: this.analyse.id, fait: 0, total: 0, etape: '', erreur: null };
    this.page = 1;
    this.selection = null;
    this.revue = null;
    this.message = data.resultat.annule
      ? { type: 'info', texte: 'Analyse annulée : les constats affichés sont partiels.' }
      : { type: 'ok', texte: `Analyse terminée : ${session.constats.length} constat${session.constats.length > 1 ? 's' : ''} sur ${session.analyses} barage${session.analyses > 1 ? 's' : ''}.` };
    if (this.onglet === 'analyser') this.onglet = 'ensemble';
    this.rendre();
  }

  // ── Décisions ────────────────────────────────────────────────────────────

  decider(c, statut) {
    const s = this.session;
    try {
      this._majSession({ ...s, decisions: decider(s.decisions, c, statut) });
      this.message = null;
    } catch (erreur) {
      this.message = { type: 'erreur', texte: erreur.message };
    }
    this.revue = null;
    this.rendre();
  }

  /** Approbation groupée des propositions affichées : action de revue explicite, confirmée. */
  toutApprouver(liste) {
    const aApprouver = liste.filter((c) => c.proposition && statutDe(c, this.session.decisions) === 'proposition');
    if (!aApprouver.length) return;
    if (!window.confirm(`Approuver ${aApprouver.length} proposition${aApprouver.length > 1 ? 's' : ''} affichée${aApprouver.length > 1 ? 's' : ''} ?\n\nRien n'est encore appliqué : l'application demandera une vérification et une seconde confirmation.`)) return;
    let decisions = this.session.decisions;
    for (const c of aApprouver) decisions = decider(decisions, c, 'approuve');
    this._majSession({ ...this.session, decisions });
    this.rendre();
  }

  // ── Application ──────────────────────────────────────────────────────────

  _approuves() {
    const s = this.session;
    return s ? s.constats.filter((c) => c.proposition && statutDe(c, s.decisions) === 'approuve') : [];
  }

  /** Nouvelle vérification des propositions approuvées contre les données actuelles (rien n'est écrit). */
  verifier() {
    const instantane = this.couche.instantane();
    if (!instantane) return;
    this.revue = { ...planifierApplication(this._approuves(), instantane.enregistrements, this.couche.hierarchie), date: new Date().toISOString() };
    this.rendre();
  }

  /** Application confirmée : vérifiée une dernière fois, écrite dans la surcouche, journalisée. */
  appliquer() {
    const instantane = this.couche.instantane();
    if (!instantane || !this.revue) return;
    const plan = planifierApplication(this._approuves(), instantane.enregistrements, this.couche.hierarchie);
    if (!plan.valides.length) {
      this.revue = { ...plan, date: new Date().toISOString() };
      this.message = { type: 'erreur', texte: 'Aucune correction applicable après la dernière vérification.' };
      return this.rendre();
    }
    const nbBarages = new Set(plan.valides.map((v) => v.id)).size;
    if (!window.confirm(`Appliquer ${plan.valides.length} correction${plan.valides.length > 1 ? 's' : ''} à ${nbBarages} barage${nbBarages > 1 ? 's' : ''} ?\n\nLes corrections vont dans les modifications locales de ce navigateur (le fichier installé n'est pas modifié) et s'annulent depuis l'Historique.`)) return;
    const { editions, journal } = appliquerAuxEditions(this.couche.editions, plan.valides);
    const ecriture = this.couche.remplacerEditions(editions);
    const s = this.session;
    let decisions = { ...s.decisions };
    const maintenant = new Date().toISOString();
    const evenement = { id: `EVT-${Date.now().toString(36).toUpperCase()}`, date: maintenant, refus: plan.refus };
    if (ecriture.ok) {
      for (const v of plan.valides) decisions[v.constatId] = { statut: 'applique', date: maintenant };
      for (const r of plan.refus) decisions[r.constatId] = { statut: 'echec', date: maintenant, raison: r.raison, detail: r.detail };
      Object.assign(evenement, { type: 'application', changements: journal });
      this.message = { type: 'ok', texte: `${journal.length} barage${journal.length > 1 ? 's' : ''} corrigé${journal.length > 1 ? 's' : ''}${plan.refus.length ? ` ; ${plan.refus.length} proposition${plan.refus.length > 1 ? 's' : ''} refusée${plan.refus.length > 1 ? 's' : ''} à la vérification` : ''}.` };
    } else {
      for (const v of plan.valides) decisions[v.constatId] = { statut: 'echec', date: maintenant, raison: 'ecriture', detail: ecriture.erreur };
      Object.assign(evenement, { type: 'echec-application', changements: journal, erreur: ecriture.erreur });
      this.message = { type: 'erreur', texte: `Échec : rien n'a été modifié (${ecriture.erreur}).` };
    }
    this._majSession({ ...s, decisions, evenements: [...s.evenements, evenement] });
    this.revue = null;
    this.rendre();
  }

  /** « Annuler la modification » : rétablit les valeurs d'avant si le barage n'a pas changé depuis. */
  annulerModification(session, evenement, entree) {
    const instantane = this.couche.instantane();
    if (!instantane) return;
    const resume = Object.entries(entree.champs).map(([k, v]) => `${LIBELLES_CHAMPS[k] ?? k} : ${lisible(k, v.apres)} → ${lisible(k, v.avant)}`).join('\n');
    if (!window.confirm(`Annuler la modification de ${entree.id} ?\n\n${resume}`)) return;
    const r = annulerEntree(this.couche.editions, entree, instantane.enregistrements, this.couche.baseParId());
    const maintenant = new Date().toISOString();
    if (r.conflits) {
      this.message = { type: 'erreur', texte: `Annulation refusée, rien n'a été changé : ${r.conflits.join(' ')}` };
      this._majSession({ ...session, evenements: [...session.evenements, { id: `EVT-${Date.now().toString(36).toUpperCase()}`, type: 'annulation-refusee', date: maintenant, de: evenement.id, cible: entree.id, conflits: r.conflits }] });
      return this.rendre();
    }
    const ecriture = this.couche.remplacerEditions(r.editions);
    const decisions = { ...session.decisions };
    if (ecriture.ok) for (const id of entree.constats ?? []) decisions[id] = { statut: 'annule', date: maintenant };
    this._majSession({
      ...session, decisions,
      evenements: [...session.evenements, {
        id: `EVT-${Date.now().toString(36).toUpperCase()}`, type: ecriture.ok ? 'annulation' : 'echec-annulation', date: maintenant,
        de: evenement.id, cible: entree.id, champs: entree.champs, erreur: ecriture.ok ? null : ecriture.erreur,
      }],
    });
    this.message = ecriture.ok ? { type: 'ok', texte: `Modification de ${entree.id} annulée : valeurs d'origine rétablies.` } : { type: 'erreur', texte: `Échec de l'annulation : ${ecriture.erreur}` };
    this.rendre();
  }

  /** L'entrée d'un événement a-t-elle déjà été annulée ? */
  _annulee(session, evenement, entree) {
    return session.evenements.some((e) => e.type === 'annulation' && e.de === evenement.id && e.cible === entree.id);
  }

  // ── Contrôle d'un barage ajouté (règle « contrôler chaque nouveau barage ») ─

  controlerAjout(b) {
    if (!this.regles.controleAjouts) return null;
    const instantane = this.couche.instantane();
    if (!instantane) return null;
    const enr = { barage: b, source: 'local', rang: -1 };
    const contexte = { hierarchie: this.couche.hierarchie, circosBt: this.couche.circosBt, simulationDeclaree: instantane.simulationDeclaree };
    const champs = controlerEnregistrement(enr, contexte, this.regles).filter((c) => c.severite !== 'info');
    const autres = instantane.enregistrements.filter((e) => e.barage?.id !== b.id);
    const concerne = (c) => c.enregistrements.some((e) => e.id === b.id);
    // Même position (doublon exact) puis voisins sous le seuil ; jamais entre simulé et réel.
    const exacts = doublonsExacts([enr, ...autres]).filter(concerne);
    const proches = quasiDoublons([enr, ...autres], this.regles).filter(concerne);
    if (!champs.length && !exacts.length && !proches.length) return null;
    const parties = [
      ...exacts.map((c) => `${c.enregistrements.filter((e) => e.id !== b.id).map((e) => e.id).join(', ')} à la même position`),
      ...proches.map((c) => `${c.enregistrements.find((e) => e.id !== b.id)?.id} à ${c.preuves.distanceM} m`),
      ...champs.map((c) => c.raison),
    ];
    return `Contrôle : ${parties.join(' ; ')} — à vérifier dans « Optimisation des barrages ».`;
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  rendre() {
    if (this.panneau.hidden) return;
    // Le tableau complet est réservé à l'administrateur ; un commandement n'a que son espace.
    if (this.mode === 'complet' && !this.espace.admin) this.mode = this.espace.commandement ? 'commandement' : 'simple';
    const simple = this.mode !== 'complet';
    this.panneau.classList.toggle('opt-compact', simple);
    this.$('opt-onglets').hidden = simple;
    this.$('opt-avis').hidden = simple;
    if (simple) {
      const corps = [];
      const espace = this.espace;
      if (espace.admin) {
        corps.push(h('div', { class: 'opt-onglets opt-modes', role: 'tablist' }, [['simple', 'Résultats'], ['conflits', 'Conflits'], ['comptes', 'Comptes']].map(([m, l]) => h('button', {
          type: 'button', role: 'tab', class: 'opt-onglet', 'aria-selected': String(this.mode === m), text: m === 'conflits' && espace.conflits.length ? `${l} (${espace.conflits.length})` : l,
          on: { click: () => { this.mode = m; this.message = null; if (m === 'conflits') espace.chargerConflits(); if (m === 'comptes') { espace.chargerComptes(); espace.chargerConflits(); } this.rendre(); } },
        }))));
      }
      // Le résumé des résultats dit déjà « Analyse terminée » : seuls les autres messages s'affichent.
      if (this.message && !/^Analyse terminée/.test(this.message.texte)) corps.push(h('p', { class: `opt-message ${this.message.type}`, role: 'status', text: this.message.texte }));
      if (this.couche.etat !== 'pret') corps.push(h('p', { class: 'aide', text: this.couche.etat === 'chargement' ? 'Chargement des barages…' : 'Barages indisponibles.' }));
      else if (this.proximite.etude && (this.mode === 'commandement' || this.mode === 'simple')) corps.push(h('button', { type: 'button', class: 'lien', text: '← Retour', on: { click: () => this.proximite.fermerEtude() } }), this.proximite._etude());
      else if (this.mode === 'commandement') corps.push(...espace.rendreCommandement());
      else if (this.mode === 'conflits') corps.push(...espace.rendreConflitsAdmin());
      else if (this.mode === 'comptes') corps.push(...espace.rendreComptes());
      else corps.push(...this.proximite.rendreSimple(() => this.ouvrirDialogue()));
      if (espace.admin) corps.push(h('button', { type: 'button', class: 'lien opt-avance', text: 'Outils avancés (carte de chaleur, qualité des données, historique…)', on: { click: () => this.modeComplet() } }));
      this.contenu.replaceChildren(...corps.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
      return;
    }
    const onglets = this.$('opt-onglets');
    onglets.replaceChildren(...ONGLETS.map(([id, libelle]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(this.onglet === id), class: 'opt-onglet',
      on: { click: () => { this.onglet = id; this.message = null; this.rendre(); } },
    }, libelle, id === 'validation' && this._approuves().length ? h('small', { text: ` ${this._approuves().length}` }) : null)));
    const avis = this.$('opt-avis');
    avis.textContent = 'Données de ce navigateur : déplacements, corrections et suppressions sont des modifications locales (comme l’édition), annulables, jamais faites sans votre confirmation ; exportez barages.json pour les transmettre.';
    const corps = [];
    if (this.message) corps.push(h('p', { class: `opt-message ${this.message.type}`, role: 'status', text: this.message.texte }));
    const etat = this.couche.etat;
    if (etat !== 'pret') {
      corps.push(h('div', { class: 'groupe' },
        h('p', { class: 'aide', text: etat === 'chargement' ? 'Chargement des barages…' : etat === 'absent' ? 'Aucun jeu de barages installé (npm run barages).' : etat === 'erreur' ? `Barages illisibles : ${this.couche.erreur}` : 'La couche Barages est désactivée : l’analyse porte sur ses données.' }),
        etat === 'inactif' ? h('button', { type: 'button', class: 'bouton-principal', text: 'Activer la couche Barages', on: { click: () => this.activerCouche() } }) : null));
    } else {
      // En arrivant sur l'onglet Doublons : les doublons détectés sur la carte.
      if (this.onglet === 'doublons' && this._ongletRendu !== 'doublons') this.dedoublonnage.afficherSurCarte();
      if (this.onglet === 'proximite' && this._ongletRendu !== 'proximite' && this._ongletRendu !== undefined) this.proximite.afficherSurCarte();
      if (this.onglet === 'deplacements' && this._ongletRendu !== 'deplacements') this.proximite._dessinerEtude();
      this._ongletRendu = this.onglet;
      corps.push(...this[`_${this.onglet}`]());
    }
    // Les sections rendent des listes imbriquées, avec des null pour les parties absentes.
    this.contenu.replaceChildren(...corps.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
  }

  _rendreProgression() {
    const barre = this.contenu.querySelector('#opt-progression');
    if (!barre) return this.rendre();
    const a = this.analyse;
    barre.max = a.total || 1;
    barre.value = a.fait;
    this.contenu.querySelector('#opt-progression-texte').textContent = `${a.etape === 'routes' ? 'Contrôle des routes' : 'Contrôles'} : ${a.fait} / ${a.total}`;
  }

  _barreAnalyse() {
    const a = this.analyse;
    if (a.etat === 'en-cours') {
      return h('div', { class: 'groupe opt-analyse' },
        h('strong', { text: 'Analyse en cours (la carte reste utilisable)…' }),
        h('progress', { id: 'opt-progression', max: a.total || 1, value: a.fait }),
        h('span', { id: 'opt-progression-texte', class: 'aide', text: `Contrôles : ${a.fait} / ${a.total}` }),
        h('button', { type: 'button', class: 'lien', text: 'Annuler l’analyse', on: { click: () => this.annulerAnalyse() } }));
    }
    return h('div', { class: 'opt-actions' },
      h('button', { type: 'button', class: 'bouton-principal', text: this.session ? 'Relancer l’analyse' : 'Lancer l’analyse', on: { click: () => this.lancer() } }),
      a.etat === 'erreur' ? h('span', { class: 'opt-message erreur', text: `Échec de l’analyse : ${a.erreur}` }) : null);
  }

  /** Empreinte des données actuelles (recalculée seulement quand la couche change). */
  _empreinte(instantane = null) {
    if (this._cacheEmpreinte?.version !== this.couche.version) {
      const i = instantane ?? this.couche.instantane();
      this._cacheEmpreinte = i ? { version: this.couche.version, valeur: empreinte(i) } : null;
    }
    return this._cacheEmpreinte?.valeur ?? null;
  }

  _perime() {
    const s = this.session;
    return Boolean(s) && s.versionDonnees !== this._empreinte();
  }

  _avisPerime() {
    return this._perime() ? h('p', { class: 'opt-message info', text: 'Les barages ont changé depuis cette analyse : les propositions seront vérifiées à nouveau avant application ; relancez l’analyse pour des constats à jour.' }) : null;
  }

  // Vue d'ensemble
  _ensemble() {
    const s = this.session;
    if (!s) {
      return [h('div', { class: 'groupe' }, h('p', { text: 'Aucune analyse pour l’instant. Les chiffres viendront des barages chargés, après analyse.' })), this._barreAnalyse()];
    }
    const st = statistiques(s.constats, s.decisions, s.analyses);
    const tuile = (valeur, libelle, onglet, filtre) => h('button', {
      type: 'button', class: 'insp-tuile opt-tuile',
      on: { click: () => { if (filtre) this.filtres = { ...this.filtres, ...filtre }; this.page = 1; this.onglet = onglet; this.rendre(); } },
    }, h('b', { text: String(valeur) }), h('span', { text: libelle }));
    return [
      this._avisPerime(),
      h('div', { class: 'insp-tuiles opt-tuiles' },
        tuile(st.analyses, 'Barages analysés', 'anomalies', { categorie: '', statut: '' }),
        tuile(st.doublonsExacts, 'Doublons exacts possibles', 'doublons'),
        tuile(st.quasiDoublons, 'Quasi-doublons possibles', 'doublons'),
        tuile(st.coordonnees, 'Coordonnées invalides ou absentes', 'anomalies', { categorie: 'coordonnees' }),
        tuile(st.metadonnees, 'Métadonnées incomplètes ou incohérentes', 'anomalies', { categorie: '' }),
        tuile(st.aVerifier, 'Barages à vérifier à la main', 'anomalies', { statut: 'a-verifier' }),
        tuile(st.enAttente, 'Propositions en attente', 'simulation'),
        tuile(st.approuves, 'Approuvées (non appliquées)', 'validation'),
        tuile(st.refuses, 'Refusées / rejetées', 'anomalies', { statut: 'refuse' }),
        tuile(st.appliques, 'Appliquées', 'historique')),
      h('dl', { class: 'insp-lignes opt-resume' },
        h('dt', { text: 'Analyse' }), h('dd', { text: `${s.id} · ${date(s.date)}${s.annulee ? ' · annulée (partielle)' : ''}` }),
        h('dt', { text: 'Périmètre' }), h('dd', { text: this._libellePerimetre(s.perimetre, s.regles) }),
        h('dt', { text: 'Exclus' }), h('dd', { text: `${s.exclus} barage${s.exclus > 1 ? 's' : ''} hors périmètre` }),
        h('dt', { text: 'Seuil' }), h('dd', { text: `${s.regles.seuilProximiteM} m${s.regles.verifierRoutes ? ` · routes à ${s.regles.toleranceRouteM} m` : ' · routes non contrôlées'}` }),
        h('dt', { text: 'Constats' }), h('dd', { text: `${s.constats.length}${s.tronque ? ` (sur ${s.tronque} : historique limité)` : ''}` })),
      h('p', { class: 'aide', text: 'Les doublons et anomalies sont des suggestions fondées sur les règles affichées, pas des preuves.' }),
      this._barreAnalyse(),
    ];
  }

  _libellePerimetre(p, r = this.regles) {
    const h2 = this.couche.hierarchie;
    const unite = p.bt ? `BT ${h2?.brigades.get(p.bt)?.nom ?? p.bt}` : p.cie ? `Cie ${h2?.compagnies.get(p.cie)?.nom ?? p.cie}` : p.reg ? `Rég. ${h2?.regions.get(p.reg)?.nom ?? p.reg}` : 'tout le Royaume';
    const origine = { toutes: 'simulés et réels (séparés)', simulation: 'simulés seulement', reelle: 'réels seulement' }[p.origine];
    return `${unite} · ${origine}${r.inclureAjoutsLocaux ? '' : ' · sans les ajouts locaux'}`;
  }

  // Analyser
  _analyser() {
    const r = this.regles;
    const p = r.perimetre;
    const h2 = this.couche.hierarchie;
    const options = (map, filtre = () => true) => [...map.values()].filter(filtre).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    const choix = (id, libelle, liste, valeur, cle) => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('select', { id, on: { change: (e) => { const perimetre = { ...p, [cle]: e.target.value }; if (cle === 'reg') Object.assign(perimetre, { cie: '', bt: '' }); if (cle === 'cie') perimetre.bt = ''; this.enregistrerRegles({ ...r, perimetre }); this.message = null; this.rendre(); } } },
        h('option', { value: '', text: 'Toutes' }), liste.map((x) => h('option', { value: x.id, text: x.nom, selected: x.id === valeur }))));
    const actifs = Object.entries({ doublonsExacts: 'doublons exacts', quasiDoublons: `quasi-doublons (${r.seuilProximiteM} m)`, verifierCoordonnees: 'coordonnées', verifierMetadonnees: 'métadonnées', verifierRelations: 'rattachements', verifierRoutes: `routes (${r.toleranceRouteM} m)` }).filter(([k]) => r[k]).map(([, v]) => v);
    return [
      h('div', { class: 'groupe' },
        h('h3', { text: 'Périmètre' }),
        h('div', { class: 'champ' }, h('span', { text: 'Origine' }), h('div', { class: 'segments', role: 'group' },
          [['toutes', 'Simulés et réels'], ['simulation', 'Simulés'], ['reelle', 'Réels']].map(([v, l]) => h('button', {
            type: 'button', 'aria-pressed': String(p.origine === v), text: l,
            on: { click: () => { this.enregistrerRegles({ ...r, perimetre: { ...p, origine: v } }); this.message = null; this.rendre(); } },
          })))),
        choix('opt-reg', 'Région', options(h2.regions), p.reg, 'reg'),
        choix('opt-cie', 'Compagnie', options(h2.compagnies, (c) => !p.reg || c.regId === p.reg), p.cie, 'cie'),
        choix('opt-bt', 'Brigade', options(h2.brigades, (b) => (!p.reg || b.regId === p.reg) && (!p.cie || b.cieId === p.cie)), p.bt, 'bt'),
        h('p', { class: 'aide', text: 'Simulés et réels sont toujours analysés séparément : jamais rapprochés dans un même doublon.' })),
      h('div', { class: 'groupe' },
        h('h3', { text: 'Contrôles actifs' }),
        h('p', { text: actifs.join(' · ') || 'aucun' }),
        h('button', { type: 'button', class: 'lien', text: 'Modifier les règles d’optimisation', on: { click: () => { this.onglet = 'regles'; this.rendre(); } } })),
      this._barreAnalyse(),
    ];
  }

  // Constats : liste, filtres, pages
  _unites() {
    const s = this.session;
    const h2 = this.couche.hierarchie;
    return new Map(Object.entries(s?.enregistrements ?? {}).map(([cle, b]) => [cle, { regId: h2?.brigades.get(b?.btId)?.regId ?? '' }]));
  }

  _carteConstat(c) {
    const s = this.session;
    const statut = statutDe(c, s.decisions);
    const ouvert = this.ouvert.has(c.id);
    const localisable = c.enregistrements.some((e) => Number.isFinite(s.enregistrements?.[e.cle]?.latitude) && Number.isFinite(s.enregistrements?.[e.cle]?.longitude));
    const actions = [
      h('button', { type: 'button', class: 'lien', text: ouvert ? 'Masquer le détail' : 'Détail', on: { click: () => { ouvert ? this.ouvert.delete(c.id) : this.ouvert.add(c.id); this.rendre(); } } }),
      localisable ? h('button', { type: 'button', class: 'lien', text: 'Voir sur la carte', on: { click: () => this.localiser(c) } }) : null,
      c.categorie.includes('doublon') ? h('button', { type: 'button', class: 'lien', text: 'Comparer', on: { click: () => { this.selection = c.id; this.onglet = 'doublons'; this.rendre(); } } }) : null,
      c.proposition ? h('button', { type: 'button', class: 'lien', text: 'Simulation avant / après', on: { click: () => { this.selection = c.id; this.onglet = 'simulation'; this.rendre(); } } }) : null,
      ...this._boutonsDecision(c, statut),
    ];
    return h('li', { class: `opt-constat ${c.severite}` },
      h('div', { class: 'opt-constat-tete' },
        h('span', { class: `opt-pastille ${c.severite}`, text: LIBELLES_SEVERITE[c.severite] }),
        h('span', { class: 'opt-categorie', text: CATEGORIES[c.categorie] }),
        c.confiance ? h('span', { class: 'opt-categorie', text: LIBELLES_CONFIANCE[c.confiance] }) : null,
        h('span', { class: `opt-statut ${statut}`, text: STATUTS[statut] })),
      h('p', { class: 'opt-raison', text: c.raison }),
      c.enregistrements.length ? h('p', { class: 'opt-ids', text: c.enregistrements.map((e) => `${e.id ?? '(sans identifiant)'}${e.source === 'local' ? ' · local' : ''} · ${e.origine === 'sim' ? 'simulé' : e.origine === 'reel' ? 'réel' : 'origine inconnue'}`).join('  |  ') }) : null,
      ouvert ? this._detail(c) : null,
      h('div', { class: 'opt-liens' }, actions));
  }

  _detail(c) {
    const lignes = [];
    if (c.champ) lignes.push(['Champ', LIBELLES_CHAMPS[c.champ] ?? c.champ]);
    if (c.valeur !== null && c.valeur !== undefined) lignes.push(['Valeur actuelle (à l’analyse)', typeof c.valeur === 'object' ? JSON.stringify(c.valeur) : String(c.valeur)]);
    if (c.preuves?.distanceM !== undefined && c.preuves.distanceM !== null) lignes.push(['Distance', `${c.preuves.distanceM} m (distance géodésique)`]);
    if (c.preuves?.seuilM) lignes.push(['Seuil configuré', `${c.preuves.seuilM} m`]);
    if (c.preuves?.champsIdentiques?.length) lignes.push(['Champs identiques', c.preuves.champsIdentiques.map((k) => LIBELLES_CHAMPS[k] ?? k).join(', ')]);
    if (c.preuves?.champsDifferents?.length) lignes.push(['Champs différents', c.preuves.champsDifferents.map((k) => LIBELLES_CHAMPS[k] ?? k).join(', ')]);
    if (c.preuves?.brigadeContenant) lignes.push(['Brigade contenant la position', c.preuves.brigadeContenant]);
    if (c.piste) lignes.push(['Indice', c.piste]);
    if (c.proposition) lignes.push(['Correction proposée', c.proposition.changements.map((ch) => `${LIBELLES_CHAMPS[ch.champ] ?? ch.champ} : ${lisible(ch.champ, ch.avant)} → ${lisible(ch.champ, ch.apres)}`).join(' ; ')]);
    else lignes.push(['Correction proposée', 'aucune : elle ne se déduit pas des données (à corriger dans la source si nécessaire)']);
    const d = this.session.decisions[c.id];
    if (d?.detail) lignes.push(['Dernier refus', `${LIBELLES_REFUS[d.raison] ?? d.raison} — ${d.detail}`]);
    return h('dl', { class: 'insp-lignes opt-detail' }, lignes.flatMap(([t, v]) => [h('dt', { text: t }), h('dd', { text: v })]));
  }

  _boutonsDecision(c, statut) {
    const b = (texte, vers, classe = 'lien') => h('button', { type: 'button', class: classe, text: texte, on: { click: () => this.decider(c, vers) } });
    if (c.proposition) {
      return [statut === 'proposition' || statut === 'refuse' || statut === 'echec' ? b('Approuver', 'approuve') : null,
        statut === 'proposition' || statut === 'approuve' || statut === 'echec' ? b('Refuser', 'refuse') : null,
        statut === 'approuve' || statut === 'refuse' ? b('Remettre à l’examen', 'proposition') : null];
    }
    const doublon = c.categorie.includes('doublon');
    return [statut === 'a-verifier' ? b('Marquer vérifié', 'verifie') : null,
      doublon && ['a-verifier', 'verifie'].includes(statut) ? b('Confirmer le doublon', 'confirme') : null,
      ['a-verifier', 'verifie'].includes(statut) ? b(doublon ? 'Rejeter la suggestion' : 'Ignorer', 'rejete') : null,
      ['verifie', 'confirme', 'rejete'].includes(statut) ? b('Remettre à vérifier', 'a-verifier') : null];
  }

  _filtresListe(liste) {
    const f = this.filtres;
    const sel = (cle, libelle, valeurs) => h('label', { class: 'champ' }, h('span', { text: libelle }),
      h('select', { on: { change: (e) => { this.filtres = { ...f, [cle]: e.target.value }; this.page = 1; this.rendre(); } } },
        h('option', { value: '', text: 'Tous' }), valeurs.map(([v, l]) => h('option', { value: v, text: l, selected: f[cle] === v }))));
    const regs = [...new Set([...this._unites().values()].map((u) => u.regId).filter(Boolean))]
      .map((id) => [id, this.couche.hierarchie.regions.get(id)?.nom ?? id]).sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    return h('div', { class: 'opt-filtres' },
      sel('categorie', 'Type de constat', Object.entries(CATEGORIES)),
      sel('severite', 'Gravité', SEVERITES.map((s) => [s, LIBELLES_SEVERITE[s]])),
      sel('statut', 'Statut', Object.entries(STATUTS)),
      sel('origine', 'Origine', [['sim', 'Simulés'], ['reel', 'Réels'], ['inconnue', 'Origine inconnue']]),
      sel('reg', 'Région', regs),
      h('label', { class: 'champ' }, h('span', { text: 'Recherche' }), h('input', { type: 'search', value: f.texte, placeholder: 'identifiant, texte…', on: { change: (e) => { this.filtres = { ...f, texte: e.target.value.trim() }; this.page = 1; this.rendre(); } } })),
      h('p', { class: 'aide', text: `${liste.length} constat${liste.length > 1 ? 's' : ''} affiché${liste.length > 1 ? 's' : ''}` }),
      h('button', { type: 'button', class: 'lien', text: 'Effacer les filtres', on: { click: () => { this.filtres = { categorie: '', severite: '', statut: '', origine: '', reg: '', texte: '' }; this.page = 1; this.rendre(); } } }));
  }

  _liste(liste) {
    const visibles = liste.slice(0, this.page * PAR_PAGE);
    return [
      h('ol', { class: 'opt-liste' }, visibles.map((c) => this._carteConstat(c))),
      liste.length > visibles.length ? h('button', { type: 'button', class: 'lien', text: `Afficher ${Math.min(PAR_PAGE, liste.length - visibles.length)} de plus (${liste.length - visibles.length} restants)`, on: { click: () => { this.page += 1; this.rendre(); } } }) : null,
    ];
  }

  _sansSession() {
    return [h('p', { class: 'aide', text: 'Aucune analyse : lancez-en une depuis « Analyser ».' }), this._barreAnalyse()];
  }

  // Anomalies
  _anomalies() {
    const s = this.session;
    if (!s) return this._sansSession();
    const liste = filtrerConstats(s.constats, this.filtres, s.decisions, this._unites());
    const propositions = liste.filter((c) => c.proposition && statutDe(c, s.decisions) === 'proposition');
    return [
      this._avisPerime(),
      this._filtresListe(liste),
      this.vueAvant ? h('button', { type: 'button', class: 'lien', text: 'Revenir à la vue précédente de la carte', on: { click: () => this.revenir() } }) : null,
      propositions.length ? h('button', { type: 'button', class: 'lien', text: propositions.length > 1 ? `Approuver les ${propositions.length} propositions affichées…` : 'Approuver la proposition affichée…', on: { click: () => this.toutApprouver(liste) } }) : null,
      liste.length ? this._liste(liste) : h('p', { class: 'aide', text: s.constats.length ? 'Aucun constat ne correspond aux filtres.' : 'Aucun constat : rien à signaler pour ces règles et ce périmètre.' }),
    ];
  }

  // Doublons : comparaison côte à côte
  // Doublons : dédoublonnage (dedoublonnage-ui.js), puis comparaison des suggestions de l'analyse qualité
  _doublons() {
    const comparaison = this._comparaisonAnalyse();
    return [
      ...this.dedoublonnage.rendre(),
      comparaison ? h('details', { class: 'groupe opt-details', open: Boolean(this.selection) || undefined },
        h('summary', { text: 'Comparer les suggestions de l’analyse qualité' }), comparaison) : null,
    ];
  }

  _comparaisonAnalyse() {
    const s = this.session;
    if (!s) return null;
    const liste = s.constats.filter((c) => c.categorie === 'doublon-exact' || c.categorie === 'quasi-doublon');
    if (!liste.length) return null;
    const choisi = liste.find((c) => c.id === this.selection) ?? liste[0];
    const recs = choisi.enregistrements.map((e) => ({ ...e, b: s.enregistrements?.[e.cle] ?? {} }));
    const champs = ['id', 'name', 'type', 'shift', 'btId', 'latitude', 'longitude', 'route', 'isSimulation'];
    const h2 = this.couche.hierarchie;
    const val = (b, k) => (k === 'btId' && b.btId ? `${h2.brigades.get(b.btId)?.nom ?? '?'} (${b.btId})` : lisible(k, b[k]));
    const tableau = h('table', { class: 'opt-comparaison' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Champ' }), recs.map((r) => h('th', { text: r.id ?? '(sans identifiant)' })))),
      h('tbody', {}, champs.map((k) => {
        const valeurs = recs.map((r) => val(r.b, k));
        const egal = valeurs.every((v) => v === valeurs[0]);
        return h('tr', { class: egal ? 'egal' : 'different' }, h('th', { text: LIBELLES_CHAMPS[k] ?? k }), valeurs.map((v) => h('td', { text: v })));
      }), h('tr', {}, h('th', { text: 'Provenance' }), recs.map((r) => h('td', { text: r.source === 'local' ? 'ajout local' : 'fichier installé' })))));
    return [
      h('label', { class: 'champ' }, h('span', { text: `Doublons possibles (${liste.length})` }),
        h('select', { on: { change: (e) => { this.selection = e.target.value; this.rendre(); } } },
          liste.map((c) => h('option', { value: c.id, selected: c.id === choisi.id, text: `${c.enregistrements.map((e) => e.id).join(' / ')} — ${c.code === 'proximite' ? `${c.preuves.distanceM} m` : CATEGORIES[c.categorie]} · ${STATUTS[statutDe(c, s.decisions)]}` })))),
      this._carteConstat(choisi),
      h('div', { class: 'opt-defile' }, tableau),
      h('p', { class: 'aide', text: 'Lignes surlignées : valeurs différentes. Suggestions de l’analyse qualité : seuls les doublons confirmés ci-dessus sont supprimés, par « Lancer le dédoublonnage ».' }),
    ];
  }

  // Simulation avant / après (lecture seule)
  _simulation() {
    const s = this.session;
    if (!s) return this._sansSession();
    const props = s.constats.filter((c) => c.proposition);
    if (!props.length) return [h('p', { class: 'aide', text: 'Aucune correction proposée dans cette analyse : aucune ne se déduisait des données. Les constats restent à vérifier dans « Anomalies ».' })];
    const choisi = props.find((c) => c.id === this.selection) ?? props[0];
    const p = choisi.proposition;
    const actuel = this.couche.instantane()?.enregistrements.find((e) => e.barage?.id === p.cible.id)?.barage;
    const lies = s.constats.filter((c) => c.id !== choisi.id && c.enregistrements.some((e) => e.id === p.cible.id));
    const tableau = h('table', { class: 'opt-comparaison' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Champ' }), h('th', { text: 'À l’analyse' }), h('th', { text: 'Actuellement' }), h('th', { text: 'Proposé' }))),
      h('tbody', {}, p.changements.map((ch) => {
        const maintenant = actuel ? actuel[ch.champ] ?? null : undefined;
        const change = actuel && JSON.stringify(maintenant) !== JSON.stringify(ch.avant);
        return h('tr', { class: change ? 'different' : '' }, h('th', { text: LIBELLES_CHAMPS[ch.champ] ?? ch.champ }),
          h('td', { text: lisible(ch.champ, ch.avant) }), h('td', { text: actuel ? lisible(ch.champ, maintenant) : 'barage introuvable' }), h('td', { class: 'propose', text: lisible(ch.champ, ch.apres) }));
      })));
    const statut = statutDe(choisi, s.decisions);
    const coordonnees = p.changements.some((ch) => ch.champ === 'latitude' || ch.champ === 'longitude');
    return [
      h('label', { class: 'champ' }, h('span', { text: `Corrections proposées (${props.length})` }),
        h('select', { on: { change: (e) => { this.selection = e.target.value; this.rendre(); } } },
          props.map((c) => h('option', { value: c.id, selected: c.id === choisi.id, text: `${c.proposition.cible.id} — ${CATEGORIES[c.categorie]} · ${STATUTS[statutDe(c, s.decisions)]}` })))),
      h('p', { class: 'opt-message info', text: 'Simulation en lecture seule : rien n’est écrit, la carte et les données ne changent pas.' }),
      h('div', { class: 'opt-defile' }, tableau),
      h('dl', { class: 'insp-lignes opt-detail' },
        h('dt', { text: 'Constat' }), h('dd', { text: choisi.raison }),
        h('dt', { text: 'Motif de la correction' }), h('dd', { text: p.motif }),
        h('dt', { text: 'Preuves' }), h('dd', { text: [choisi.preuves?.distanceM !== undefined && choisi.preuves?.distanceM !== null ? `distance ${choisi.preuves.distanceM} m` : null, choisi.preuves?.route ? `route ${lisible('route', choisi.preuves.route)}` : null, `confiance ${p.confiance}`].filter(Boolean).join(' · ') }),
        h('dt', { text: 'Conséquences' }), h('dd', { text: p.consequences.join(' ') || '—' }),
        h('dt', { text: 'Autres constats sur ce barage' }), h('dd', { text: lies.length ? lies.map((c) => CATEGORIES[c.categorie]).join(', ') : 'aucun' }),
        h('dt', { text: 'Réversible' }), h('dd', { text: 'Oui : les valeurs d’origine sont gardées ; « Annuler la modification » (Historique) les rétablit tant que le barage n’a pas été modifié de nouveau.' }),
        h('dt', { text: 'Statut' }), h('dd', { text: STATUTS[statut] })),
      h('div', { class: 'opt-liens' },
        coordonnees ? h('button', { type: 'button', class: 'lien', text: 'Aperçu sur la carte (position actuelle et proposée)', on: { click: () => this.localiser(choisi, { apercu: true }) } }) : null,
        this.vueAvant ? h('button', { type: 'button', class: 'lien', text: 'Revenir à la vue précédente', on: { click: () => this.revenir() } }) : null,
        ...this._boutonsDecision(choisi, statut)),
    ];
  }

  // Validation : approuvées → vérification → confirmation → application
  _validation() {
    const s = this.session;
    if (!s) return this._sansSession();
    const approuves = this._approuves();
    const corps = [h('p', { class: 'aide', text: 'Seules les propositions approuvées sont appliquées, après une nouvelle vérification contre les données actuelles et votre confirmation.' })];
    if (!approuves.length) {
      corps.push(h('p', { text: 'Aucune proposition approuvée en attente.' }));
      return corps;
    }
    corps.push(h('ol', { class: 'opt-liste' }, approuves.map((c) => this._carteConstat(c))));
    if (!this.revue) {
      corps.push(h('button', { type: 'button', class: 'bouton-principal', text: `Vérifier les ${approuves.length} proposition${approuves.length > 1 ? 's' : ''} approuvée${approuves.length > 1 ? 's' : ''}`, on: { click: () => this.verifier() } }));
      return corps;
    }
    const { valides, refus } = this.revue;
    const parBarage = new Map();
    for (const v of valides) parBarage.set(v.id, [...(parBarage.get(v.id) ?? []), ...v.changements]);
    corps.push(h('div', { class: 'groupe' },
      h('h3', { text: `Récapitulatif avant application · vérifié ${date(this.revue.date)}` }),
      valides.length ? h('div', { class: 'opt-defile' }, h('table', { class: 'opt-comparaison' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Barage' }), h('th', { text: 'Champ' }), h('th', { text: 'Avant' }), h('th', { text: 'Après' }))),
        h('tbody', {}, [...parBarage].flatMap(([id, chs]) => chs.map((ch, i) => h('tr', {}, h('th', { text: i ? '' : id }), h('td', { text: LIBELLES_CHAMPS[ch.champ] ?? ch.champ }), h('td', { text: lisible(ch.champ, ch.avant) }), h('td', { class: 'propose', text: lisible(ch.champ, ch.apres) }))))))) : h('p', { text: 'Aucune correction applicable.' }),
      refus.length ? h('ul', { class: 'opt-refus' }, refus.map((r) => h('li', {}, h('strong', { text: `${r.id ?? '?'} · ${LIBELLES_REFUS[r.raison] ?? r.raison} : ` }), r.detail))) : null,
      h('div', { class: 'opt-actions' },
        valides.length ? h('button', { type: 'button', class: 'bouton-principal', text: `Confirmer l’application (${parBarage.size} barage${parBarage.size > 1 ? 's' : ''})`, on: { click: () => this.appliquer() } }) : null,
        h('button', { type: 'button', class: 'lien', text: 'Abandonner', on: { click: () => { this.revue = null; this.rendre(); } } }))));
    return corps;
  }

  // Règles
  _regles() {
    const r = this.regles;
    const brouillon = structuredClone(r);
    const brouillonDoublons = structuredClone(this.dedoublonnage.regles);
    const caseRegle = (cle) => h('label', { class: 'ligne-couche' },
      h('span', { class: 'ligne-texte' }, h('strong', { text: DESCRIPTIONS_REGLES[cle].split(' :')[0] }), h('small', { text: DESCRIPTIONS_REGLES[cle] })),
      h('input', { type: 'checkbox', class: 'interrupteur', checked: r[cle], on: { change: (e) => { brouillon[cle] = e.target.checked; } } }));
    const nombre = (cle, min, max) => h('label', { class: 'champ' }, h('span', { text: DESCRIPTIONS_REGLES[cle] }),
      h('input', { type: 'number', min, max, step: 1, value: String(r[cle]), on: { input: (e) => { brouillon[cle] = Number(e.target.value); } } }));
    return [
      h('div', { class: 'groupe' }, h('h3', { text: 'Doublons' }),
        caseRegle('doublonsExacts'), caseRegle('quasiDoublons'), nombre('seuilProximiteM', 1, 2000), caseRegle('exigerMemeBrigade'),
        h('div', { class: 'champ' }, h('span', { text: DESCRIPTIONS_REGLES.champsComparaison }),
          h('div', { class: 'opt-cases' }, CHAMPS_COMPARABLES.map((c) => h('label', {},
            h('input', { type: 'checkbox', checked: r.champsComparaison.includes(c), on: { change: (e) => { brouillon.champsComparaison = e.target.checked ? [...new Set([...brouillon.champsComparaison, c])] : brouillon.champsComparaison.filter((x) => x !== c); } } }),
            ` ${LIBELLES_CHAMPS[c] ?? c}`))))),
      h('div', { class: 'groupe' }, h('h3', { text: 'Qualité des données' }),
        caseRegle('verifierCoordonnees'), caseRegle('verifierMetadonnees'), caseRegle('verifierRelations'), caseRegle('verifierRoutes'), nombre('toleranceRouteM', 1, 50)),
      h('div', { class: 'groupe' }, h('h3', { text: 'Périmètre et affichage' }),
        h('p', { class: 'aide', text: `${DESCRIPTIONS_REGLES.perimetre} Actuel : ${this._libellePerimetre(r.perimetre)} (onglet « Analyser »).` }),
        caseRegle('inclureAjoutsLocaux'),
        h('label', { class: 'champ' }, h('span', { text: DESCRIPTIONS_REGLES.severiteMin }),
          h('select', { on: { change: (e) => { brouillon.severiteMin = e.target.value; } } }, SEVERITES.map((v) => h('option', { value: v, text: LIBELLES_SEVERITE[v], selected: r.severiteMin === v })))),
        caseRegle('controleAjouts')),
      this.dedoublonnage.reglages(brouillonDoublons),
      h('div', { class: 'opt-actions' },
        h('button', { type: 'button', class: 'bouton-principal', text: 'Enregistrer les règles', on: {
          click: () => {
            const erreurs = this.dedoublonnage.enregistrerRegles(brouillonDoublons);
            if (this.enregistrerRegles(brouillon) && erreurs.length) this.message = { type: 'erreur', texte: `Règles de dédoublonnage non enregistrées : ${erreurs.join(' ; ')}.` };
            this.rendre();
          },
        } }),
        h('button', { type: 'button', class: 'lien', text: 'Valeurs par défaut', on: { click: () => { if (window.confirm('Revenir aux règles par défaut ? (le périmètre est gardé)')) { this.enregistrerRegles({ ...REGLES_DEFAUT, perimetre: r.perimetre }); this.rendre(); } } } })),
      h('p', { class: 'aide', text: 'Paramètres : règles et historique sont gardés dans ce navigateur (aucun compte, aucun serveur). Chaque analyse enregistre les règles qu’elle a utilisées.' }),
    ];
  }

  // Historique et annulation
  _historique() {
    const sessions = this.historique.sessions;
    if (!sessions.length) return [h('p', { class: 'aide', text: 'Aucune session enregistrée dans ce navigateur.' })];
    const recherche = (this._recherche ?? '').toLowerCase();
    const trouvees = sessions.filter((s) => !recherche || s.id.toLowerCase().includes(recherche)
      || s.evenements.some((e) => (e.changements ?? []).some((c) => c.id?.toLowerCase().includes(recherche)) || e.cible?.toLowerCase().includes(recherche))
      || s.constats.some((c) => c.enregistrements.some((e) => e.id?.toLowerCase().includes(recherche))));
    const s = this.session ?? sessions[0];
    const parCategorie = {};
    for (const c of s.constats) parCategorie[c.categorie] = (parCategorie[c.categorie] ?? 0) + 1;
    return [
      h('label', { class: 'champ' }, h('span', { text: 'Rechercher (session ou barage)' }),
        h('input', { type: 'search', value: this._recherche ?? '', on: { change: (e) => { this._recherche = e.target.value.trim(); this.rendre(); } } })),
      h('ol', { class: 'opt-sessions' }, trouvees.map((x) => {
        const appliques = x.evenements.filter((e) => e.type === 'application').reduce((n, e) => n + e.changements.length, 0);
        return h('li', {}, h('button', {
          type: 'button', class: 'item-liste', 'aria-pressed': String(x.id === s.id),
          on: { click: () => { this.sessionId = x.id; this.selection = null; this.revue = null; this.page = 1; this.rendre(); } },
        }, h('b', { class: 'num', text: '' }), h('span', { class: 'item-nom', text: `${date(x.date)} · ${x.constats.length} constats · ${appliques} barage${appliques > 1 ? 's' : ''} corrigé${appliques > 1 ? 's' : ''}` }), h('small', { text: x.id })));
      })),
      h('div', { class: 'groupe' },
        h('h3', { text: `Session ${s.id}${s.id === this.historique.sessions[0].id ? ' (la plus récente)' : ''}` }),
        h('dl', { class: 'insp-lignes opt-detail' },
          h('dt', { text: 'Date' }), h('dd', { text: date(s.date) }),
          h('dt', { text: 'Auteur' }), h('dd', { text: s.auteur }),
          h('dt', { text: 'Périmètre' }), h('dd', { text: this._libellePerimetre(s.perimetre, s.regles) }),
          h('dt', { text: 'Règles' }), h('dd', { text: `seuil ${s.regles.seuilProximiteM} m · champs ${s.regles.champsComparaison.join(', ')} · ${['doublonsExacts', 'quasiDoublons', 'verifierCoordonnees', 'verifierMetadonnees', 'verifierRelations', 'verifierRoutes'].filter((k) => s.regles[k]).join(', ')}` }),
          h('dt', { text: 'Constats' }), h('dd', { text: Object.entries(parCategorie).map(([k, n]) => `${CATEGORIES[k]} ${n}`).join(' · ') || 'aucun' })),
        h('button', { type: 'button', class: 'lien', text: 'Ouvrir les constats de cette session', on: { click: () => { this.onglet = 'anomalies'; this.rendre(); } } })),
      h('h3', { class: 'opt-titre-section', text: 'Événements' }),
      s.evenements.length ? h('ol', { class: 'opt-liste' }, [...s.evenements].reverse().map((e) => this._evenement(s, e))) : h('p', { class: 'aide', text: 'Aucune correction appliquée dans cette session : les décisions seules ne modifient rien.' }),
    ];
  }

  _evenement(s, e) {
    const titres = { application: 'Corrections appliquées', 'echec-application': 'Échec d’application (rien n’a été modifié)', annulation: 'Modification annulée', 'echec-annulation': 'Échec d’annulation', 'annulation-refusee': 'Annulation refusée (conflit)' };
    const corps = [h('div', { class: 'opt-constat-tete' }, h('strong', { text: titres[e.type] ?? e.type }), h('span', { class: 'opt-categorie', text: date(e.date) }))];
    if (e.erreur) corps.push(h('p', { class: 'opt-message erreur', text: e.erreur }));
    if (e.conflits) corps.push(h('p', { text: e.conflits.join(' ') }));
    if (e.type === 'annulation') corps.push(h('p', { text: `${e.cible} : valeurs d’origine rétablies (événement ${e.de}).` }));
    for (const entree of e.changements ?? []) {
      const annulee = this._annulee(s, e, entree);
      corps.push(h('div', { class: 'opt-entree' },
        h('strong', { text: `${entree.id}${entree.source === 'local' ? ' (ajout local)' : ''}` }),
        h('ul', {}, Object.entries(entree.champs).map(([k, v]) => h('li', { text: `${LIBELLES_CHAMPS[k] ?? k} : ${lisible(k, v.avant)} → ${lisible(k, v.apres)}` }))),
        e.type === 'application' ? (annulee
          ? h('span', { class: 'opt-statut annule', text: 'Annulée' })
          : h('button', { type: 'button', class: 'lien', text: 'Annuler la modification', on: { click: () => this.annulerModification(s, e, entree) } })) : null));
    }
    if (e.refus?.length) corps.push(h('ul', { class: 'opt-refus' }, e.refus.map((r) => h('li', { text: `${r.id ?? '?'} · ${LIBELLES_REFUS[r.raison] ?? r.raison} : ${r.detail}` }))));
    return h('li', { class: 'opt-constat' }, corps);
  }
}
