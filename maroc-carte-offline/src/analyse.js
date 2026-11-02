/**
 * Outils d'analyse opérationnelle (onglet « Analyse ») :
 *   - couverture : temps d'accès par la route à la brigade la plus proche, sur tout le Royaume ;
 *   - zone d'intervention : ce qu'une unité atteint en 15, 30, 60 ou 90 min ;
 *   - bouclage : sorties routières d'un cercle autour d'un point ;
 *   - tournée : ordre de visite le plus court d'une liste d'étapes.
 * Les temps sont calculés dans couverture-worker.js ; les routes viennent des
 * tuiles locales (itineraire.js). Tout fonctionne hors ligne.
 */
import { BANDES, COULEURS_BANDES, VITESSE_HORS_ROUTE, celluleDe } from './couverture.js';
import { RANG_PRINCIPAL, cercle, direction, sortiesDuCercle } from './bouclage.js';
import { ordreOptimal } from './tournee.js';
import { distanceMetres, emprise, formaterDistance, formaterDuree } from './mesure.js';
import { COUCHES_CLIQUABLES_POINTS } from './gendarmerie-style.js';
import { formaterLambert, versLambert } from './lambert.js';
import { element } from './dom.js';

const SOURCE = 'analyse';
const SOURCE_TEMPS = 'analyse-temps';
const CLE_REGLAGES = 'maroc-carte:analyse:v1';
const DUREES = Object.freeze([15, 30, 60, 90]);
const RAYONS = Object.freeze([1000, 3000, 5000, 10000, 20000]);
const MAX_ETAPES = 15;
const DEFAUTS = { duree: 60, rayon: 5000, filtre: 'principales', boucle: false };

const TEXTES = {
  fr: {
    couvCalcul: 'Calcul en cours… (quelques secondes)',
    couvPrete: (n) => `Depuis les ${n} chefs-lieux de brigade`,
    couvErreur: (m) => `Calcul impossible : ${m}`,
    jusqua: (m) => `≤ ${m} min`,
    auDela: (m) => `> ${m} min`,
    zoneCalcul: (nom) => `Calcul de la zone : ${nom}…`,
    zonePrete: (nom, min, km2) => `${nom} · ≈ ${km2} km² en ${min} min`,
    zoneErreur: (m) => `Calcul impossible : ${m}`,
    cePoint: 'ce point',
    estimation: `Estimation par le réseau routier principal, aux vitesses de référence ; hors de ce réseau, ${VITESSE_HORS_ROUTE} km/h.`,
    survolCouv: (duree, nom) => `≈ ${duree} · ${nom}`,
    survolZone: (duree, nom) => `≈ ${duree} depuis ${nom}`,
    bouclageAide: 'Cliquez sur la carte pour placer le centre de la zone à boucler.',
    bouclageCalcul: 'Recherche des sorties…',
    bouclageResultat: (n) => (n ? `${n} sortie${n > 1 ? 's' : ''} à tenir` : 'Aucune route ne franchit ce cercle'),
    bouclageZoom: 'À ce rayon, les petites voies ne sont pas toutes lues : réduisez le rayon pour le détail.',
    bouclageErreur: 'Zone trop grande ou tuiles illisibles.',
    sansNom: 'route sans nom',
    copie: 'Copié ✓',
    tourneeAide: 'Cliquez sur la carte (ou sur une unité) pour ajouter des étapes ; la première est le départ.',
    tourneeMax: (n) => `${n} étapes au plus.`,
    tourneeMatrice: (f, t) => `Calcul des trajets… ${f} / ${t}`,
    tourneeTrace: 'Tracé de l’itinéraire…',
    tourneeTotal: (d, t) => `Total : ${d}${t ? ` · ≈ ${t}` : ''}`,
    tourneeDroit: '⚠ Étape sans route trouvée : tronçon à vol d’oiseau.',
    tourneeErreur: (m) => `Calcul impossible : ${m}`,
    tourneeApprox: '≈ longs tronçons par les grands axes',
    depart: 'Départ', retour: 'Retour au départ', retirer: 'Retirer',
    impCouverture: 'Temps d’accès à la brigade la plus proche',
    impZone: (nom, min) => `Zone d’intervention : ${nom} (${min} min)`,
    impBouclage: (r) => `Bouclage ${r}`, impTournee: 'Tournée de patrouille',
  },
  ar: {
    couvCalcul: 'جارٍ الحساب… (بضع ثوانٍ)',
    couvPrete: (n) => `انطلاقًا من ${n} مقر مركز`,
    couvErreur: (m) => `تعذّر الحساب: ${m}`,
    jusqua: (m) => `≤ ${m} د`,
    auDela: (m) => `> ${m} د`,
    zoneCalcul: (nom) => `جارٍ حساب المنطقة: ${nom}…`,
    zonePrete: (nom, min, km2) => `${nom} · ≈ ${km2} كم² في ${min} د`,
    zoneErreur: (m) => `تعذّر الحساب: ${m}`,
    cePoint: 'هذه النقطة',
    estimation: `تقدير عبر الشبكة الطرقية الرئيسية بالسرعات المرجعية؛ خارجها ${VITESSE_HORS_ROUTE} كم/س.`,
    survolCouv: (duree, nom) => `≈ ${duree} · ${nom}`,
    survolZone: (duree, nom) => `≈ ${duree} من ${nom}`,
    bouclageAide: 'انقر على الخريطة لوضع مركز المنطقة المراد تطويقها.',
    bouclageCalcul: 'جارٍ البحث عن المخارج…',
    bouclageResultat: (n) => (n ? `${n} مخرج يجب ضبطه` : 'لا يعبر أي طريق هذه الدائرة'),
    bouclageZoom: 'في هذا الشعاع لا تُقرأ كل الطرق الصغيرة: قلّص الشعاع للتفاصيل.',
    bouclageErreur: 'منطقة كبيرة جدًا أو تعذّرت قراءة البلاطات.',
    sansNom: 'طريق بدون اسم',
    copie: 'تم النسخ ✓',
    tourneeAide: 'انقر على الخريطة (أو على وحدة) لإضافة مراحل؛ الأولى هي الانطلاق.',
    tourneeMax: (n) => `${n} مراحل على الأكثر.`,
    tourneeMatrice: (f, t) => `جارٍ حساب المسارات… ${f} / ${t}`,
    tourneeTrace: 'جارٍ رسم المسار…',
    tourneeTotal: (d, t) => `المجموع: ${d}${t ? ` · ≈ ${t}` : ''}`,
    tourneeDroit: '⚠ مرحلة بدون طريق: مقطع في خط مستقيم.',
    tourneeErreur: (m) => `تعذّر الحساب: ${m}`,
    tourneeApprox: '≈ المقاطع الطويلة عبر المحاور الكبرى',
    depart: 'الانطلاق', retour: 'العودة إلى الانطلاق', retirer: 'حذف',
    impCouverture: 'زمن الوصول إلى أقرب مركز',
    impZone: (nom, min) => `منطقة التدخل: ${nom} (${min} د)`,
    impBouclage: (r) => `تطويق ${r}`, impTournee: 'جولة الدورية',
  },
};

const COULEURS = {
  light: { bouclage: '#c1272d', tournee: '#1565c0', or: '#c6a050', halo: '#ffffff' },
  dark: { bouclage: '#ff5a60', tournee: '#5c9ded', or: '#e3c98a', halo: '#101418' },
};

const point = (coordinates, proprietes) => ({ type: 'Feature', properties: proprietes, geometry: { type: 'Point', coordinates } });
const ligne = (coordinates, proprietes) => ({ type: 'Feature', properties: proprietes, geometry: { type: 'LineString', coordinates } });
const coordCourte = ([lon, lat]) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

function lireReglages() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_REGLAGES) || '{}');
    return {
      duree: DUREES.includes(brut.duree) ? brut.duree : DEFAUTS.duree,
      rayon: RAYONS.includes(brut.rayon) ? brut.rayon : DEFAUTS.rayon,
      filtre: brut.filtre === 'toutes' ? 'toutes' : 'principales',
      boucle: brut.boucle === true,
    };
  } catch {
    return { ...DEFAUTS };
  }
}

export class Analyse {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ reseau: import('./itineraire.js').ReseauRoutier | import('./itineraire-distant.js').ReseauRoutierDistant, origine: string, $: (id: string) => HTMLElement,
   *           priorite?: 'autoroute' | 'court', langue?: string, surOutil?: (outil: string) => void }} options
   *   `surOutil` : un outil de l'analyse prend les clics de la carte (l'appelant arrête les autres).
   */
  constructor(carte, { reseau, origine, $, priorite = 'autoroute', langue = 'fr', surOutil = () => {} }) {
    Object.assign(this, { carte, reseau, origine, $, priorite, langue, surOutil });
    this.theme = 'light';
    this.reglages = lireReglages();
    this.outil = null; // 'bouclage' | 'tournee'
    this.affiche = null; // carte de temps affichée : { mode, url, grille, temps, proprio, noms, stats } (voir _carteTemps)
    this.couverture = { active: false, cache: null, statut: null, promesse: null };
    this.zoneEtat = null; // { nom, position, limite, statut, erreur? }
    this.bouclage = { centre: null, sorties: [], statut: null, z: null };
    this.tournee = { etapes: [], resultat: null, statut: null, message: null };
    this._jetons = { temps: 0, bouclage: 0, tournee: 0 };
    this._worker = null;
    this._attente = new Map();
    this._id = 0;
    this._listeBrigades = null;

    carte.on('click', (e) => this._surClic(e));
    carte.on('mousemove', (e) => this._surSurvol(e));
    carte.getCanvas().addEventListener('mouseleave', () => { this.$('etat-analyse').textContent = ''; });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.outil) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
      this.arreterOutil();
    });
    this._lierPanneau();
    this.rendrePanneau();
  }

  get t() {
    return TEXTES[this.langue] ?? TEXTES.fr;
  }

  _enregistrer() {
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(this.reglages)); } catch { /* stockage indisponible */ }
  }

  // ── Carte ────────────────────────────────────────────────────────────────

  /** À chaque chargement de style (thème, langue) : réinstalle sources et couches. */
  installer({ theme = this.theme } = {}) {
    this.theme = theme;
    const c = COULEURS[theme] ?? COULEURS.light;
    const carte = this.carte;
    if (!carte.getSource(SOURCE)) carte.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const type = (...types) => ['in', ['get', 'type'], ['literal', types]];
    const couches = [
      { id: 'analyse-cercle-fond', type: 'fill', filter: type('cercle'), paint: { 'fill-color': c.bouclage, 'fill-opacity': 0.06 } },
      { id: 'analyse-cercle', type: 'line', filter: type('cercle'), paint: { 'line-color': c.bouclage, 'line-width': 2, 'line-dasharray': [3, 2] } },
      { id: 'analyse-trajet', type: 'line', filter: type('trajet'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.tournee, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 6] } },
      { id: 'analyse-droit', type: 'line', filter: type('droit'), paint: { 'line-color': c.tournee, 'line-width': 2.5, 'line-dasharray': [1, 1.5] } },
      { id: 'analyse-points', type: 'circle', filter: type('sortie', 'etape', 'centre', 'origine'),
        paint: {
          'circle-radius': ['match', ['get', 'type'], 'centre', 5, 'origine', 7, 10],
          'circle-color': ['match', ['get', 'type'], 'etape', c.tournee, 'origine', c.or, c.bouclage],
          'circle-stroke-color': c.halo,
          'circle-stroke-width': 2,
        } },
      { id: 'analyse-numeros', type: 'symbol', filter: type('sortie', 'etape'),
        layout: {
          'text-field': ['get', 'num'], 'text-font': ['Noto Sans Medium'], 'text-size': 11,
          'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: { 'text-color': '#ffffff' } },
    ];
    for (const couche of couches) if (!carte.getLayer(couche.id)) carte.addLayer({ ...couche, source: SOURCE });
    this._installerTemps();
    this._rendre();
  }

  /** Couche de temps sous les couches de la Gendarmerie et les libellés. */
  _installerTemps() {
    const carte = this.carte;
    if (!carte.getStyle()) return;
    if (!this.affiche) {
      if (carte.getLayer(SOURCE_TEMPS)) carte.removeLayer(SOURCE_TEMPS);
      if (carte.getSource(SOURCE_TEMPS)) carte.removeSource(SOURCE_TEMPS);
      return;
    }
    const { url, grille } = this.affiche;
    const source = carte.getSource(SOURCE_TEMPS);
    if (source) source.updateImage({ url, coordinates: grille.coins });
    else carte.addSource(SOURCE_TEMPS, { type: 'image', url, coordinates: grille.coins });
    if (!carte.getLayer(SOURCE_TEMPS)) {
      const avant = carte.getStyle().layers.find((c) => c.id.startsWith('gr-') || c.type === 'symbol')?.id;
      carte.addLayer({ id: SOURCE_TEMPS, type: 'raster', source: SOURCE_TEMPS, paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 } }, avant);
    }
  }

  _rendre() {
    const source = this.carte.getSource(SOURCE);
    if (!source) return;
    const f = [];
    if (this.zoneEtat) f.push(point(this.zoneEtat.position, { type: 'origine' }));
    const { centre, sorties } = this.bouclage;
    if (centre) {
      f.push({ type: 'Feature', properties: { type: 'cercle' }, geometry: { type: 'Polygon', coordinates: [cercle(centre, this.reglages.rayon)] } });
      f.push(point(centre, { type: 'centre' }));
      sorties.forEach((s, i) => f.push(point(s.point, { type: 'sortie', num: String(i + 1) })));
    }
    const { etapes, resultat } = this.tournee;
    if (resultat) {
      for (const troncon of resultat.troncons) f.push(ligne(troncon.chemin, { type: troncon.droit ? 'droit' : 'trajet' }));
      resultat.ordre.forEach((i, rang) => f.push(point(etapes[i].position, { type: 'etape', num: String(rang + 1) })));
    } else {
      etapes.forEach((e, i) => f.push(point(e.position, { type: 'etape', num: String(i + 1) })));
    }
    source.setData({ type: 'FeatureCollection', features: f });
  }

  // ── Outils (prennent les clics de la carte) ──────────────────────────────

  activerOutil(outil) {
    if (this.outil === outil) return this.arreterOutil();
    this.surOutil(outil);
    this.outil = outil;
    this.carte.getCanvas().style.cursor = 'crosshair';
    this.rendrePanneau();
  }

  arreterOutil() {
    if (!this.outil) return;
    this.outil = null;
    this.carte.getCanvas().style.cursor = '';
    this.rendrePanneau();
  }

  _surClic(e) {
    if (!this.outil) return;
    const position = [e.lngLat.lng, e.lngLat.lat];
    if (this.outil === 'bouclage') return this.placerBouclage(position);
    // Tournée : un clic sur une unité l'ajoute avec son nom et sa position exacte.
    const couches = COUCHES_CLIQUABLES_POINTS.filter((id) => this.carte.getLayer(id) && this.carte.getLayoutProperty(id, 'visibility') !== 'none');
    const { x, y } = e.point;
    const unite = couches.length ? this.carte.queryRenderedFeatures([[x - 4, y - 4], [x + 4, y + 4]], { layers: couches })[0] : null;
    if (unite) this.ajouterEtape(unite.geometry.coordinates, unite.properties.nom ?? null);
    else this.ajouterEtape(position);
  }

  _surSurvol(e) {
    const sortie = this.$('etat-analyse');
    const a = this.affiche;
    const i = a ? celluleDe(a.grille, [e.lngLat.lng, e.lngLat.lat]) : -1;
    const t = i >= 0 ? a.temps[i] : Infinity;
    if (t === Infinity) {
      sortie.textContent = '';
      return;
    }
    const duree = formaterDuree(t, this.langue);
    const nom = a.noms[a.proprio[i]] ?? '';
    sortie.textContent = a.mode === 'couverture' ? this.t.survolCouv(duree, nom) : this.t.survolZone(duree, nom);
  }

  // ── Temps d'intervention (worker) ────────────────────────────────────────

  _calculer(message) {
    if (!this._worker) {
      this._worker = new Worker(new URL('./couverture-worker.js', import.meta.url), { type: 'module' });
      this._worker.onmessage = ({ data }) => {
        const attente = this._attente.get(data.id);
        this._attente.delete(data.id);
        if (data.erreur) attente?.reject(new Error(data.erreur));
        else attente?.resolve(data);
      };
      // Worker introuvable ou planté : aucun calcul en attente ne doit rester bloqué.
      this._worker.onerror = this._worker.onmessageerror = (e) => {
        e.preventDefault?.();
        for (const { reject } of this._attente.values()) reject(new Error(e.message || 'calcul interrompu'));
        this._attente.clear();
        this._worker?.terminate();
        this._worker = null;
      };
    }
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._attente.set(id, { resolve, reject });
      this._worker.postMessage({
        id, urlReseau: `${this.origine}/data/reseau-national.bin`, urlMasque: `${this.origine}/gendarmerie/circo-reg.geojson`, ...message,
      });
    });
  }

  _brigades() {
    this._listeBrigades ??= fetch(`${this.origine}/gendarmerie/unites.geojson`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => d.features.filter((f) => f.properties.niveau === 'bt').map((f) => ({ nom: f.properties.nom, position: f.geometry.coordinates })));
    this._listeBrigades.catch(() => { this._listeBrigades = null; });
    return this._listeBrigades;
  }

  /** Résultat du worker prêt à afficher (le PNG ne sert qu'à créer l'URL de l'image). */
  _carteTemps(mode, { image, ...resultat }, noms) {
    return { mode, ...resultat, url: URL.createObjectURL(image), noms };
  }

  _montrerTemps(resultat) {
    const precedent = this.affiche;
    this.affiche = resultat;
    this._installerTemps();
    // L'image d'une zone remplacée n'est plus utile ; celle de la couverture reste en cache.
    if (precedent && precedent.mode === 'zone' && precedent.url !== resultat?.url) URL.revokeObjectURL(precedent.url);
  }

  async basculerCouverture(active) {
    this.couverture.active = active;
    const jeton = ++this._jetons.temps;
    if (!active) {
      if (this.affiche?.mode === 'couverture') this._montrerTemps(null);
      this.couverture.statut = null;
      return this.rendrePanneau();
    }
    if (this.affiche?.mode === 'zone') this._montrerTemps(null);
    this.zoneEtat = null;
    this._rendre();
    if (this.couverture.cache) {
      this._montrerTemps(this.couverture.cache);
      return this.rendrePanneau();
    }
    this.couverture.statut = 'calcul';
    this.rendrePanneau();
    // Décocher puis recocher pendant le calcul réutilise le calcul en cours.
    this.couverture.promesse ??= this._brigades()
      .then(async (brigades) => this._carteTemps('couverture', await this._calculer({ sources: brigades.map((b) => b.position) }), brigades.map((b) => b.nom)))
      .finally(() => { this.couverture.promesse = null; });
    try {
      this.couverture.cache = await this.couverture.promesse;
      if (jeton !== this._jetons.temps) return;
      this.couverture.statut = null;
      this._montrerTemps(this.couverture.cache);
    } catch (erreur) {
      if (jeton !== this._jetons.temps) return;
      this.couverture.statut = { erreur: erreur.message };
    }
    this.rendrePanneau();
  }

  /** Zone d'intervention depuis une position (siège d'unité ou point quelconque). */
  async zone(position, nom = null) {
    const jeton = ++this._jetons.temps;
    const limite = this.reglages.duree * 60;
    this.couverture.active = false;
    this.couverture.statut = null;
    if (this.affiche?.mode === 'couverture') this._montrerTemps(null); // le cache reste
    this.zoneEtat = { nom: nom ?? this.t.cePoint, position, limite, statut: 'calcul' };
    this._rendre();
    this.rendrePanneau();
    try {
      const r = await this._calculer({ sources: [position], limite });
      if (jeton !== this._jetons.temps) return;
      this._montrerTemps(this._carteTemps('zone', r, [this.zoneEtat.nom]));
      this.zoneEtat.statut = 'ok';
    } catch (erreur) {
      if (jeton !== this._jetons.temps) return;
      Object.assign(this.zoneEtat, { statut: 'erreur', erreur: erreur.message });
    }
    this.rendrePanneau();
  }

  effacerZone() {
    this._jetons.temps += 1;
    if (this.affiche?.mode === 'zone') this._montrerTemps(null);
    this.zoneEtat = null;
    this._rendre();
    this.rendrePanneau();
  }

  // ── Bouclage ─────────────────────────────────────────────────────────────

  async placerBouclage(centre) {
    const jeton = ++this._jetons.bouclage;
    const rayon = this.reglages.rayon;
    this.bouclage = { centre, sorties: [], statut: 'calcul', z: null };
    this._rendre();
    this.rendrePanneau();
    const lu = await this.reseau.lignes(emprise(centre, centre, rayon + 300), { zMax: 14 }).catch(() => null);
    if (jeton !== this._jetons.bouclage) return;
    if (!lu) {
      this.bouclage.statut = 'erreur';
    } else {
      const rangMax = this.reglages.filtre === 'principales' ? RANG_PRINCIPAL : Infinity;
      Object.assign(this.bouclage, { sorties: sortiesDuCercle(lu.lignes, centre, rayon, { rangMax }), statut: 'ok', z: lu.z });
    }
    this._rendre();
    this.rendrePanneau();
  }

  effacerBouclage() {
    this._jetons.bouclage += 1;
    this.bouclage = { centre: null, sorties: [], statut: null, z: null };
    this._rendre();
    this.rendrePanneau();
  }

  _nomSortie(s) {
    const nom = this.langue === 'ar' ? s.nomAr || s.nom : s.nomFr || s.nom;
    return [s.refs.join(' / '), nom !== s.ref ? nom : null].filter(Boolean).join(' · ') || this.t.sansNom;
  }

  _texteBouclage() {
    const { centre, sorties } = this.bouclage;
    const lignes = [`${this.t.bouclageResultat(sorties.length)} — ${formaterDistance(this.reglages.rayon, this.langue)} · ${coordCourte(centre)}`];
    sorties.forEach((s, i) => lignes.push(`${i + 1}. ${this._nomSortie(s)} — ${direction(s.cap, this.langue)} — ${coordCourte(s.point)}`
      + ` — ${formaterLambert(versLambert(s.point), { langue: this.langue })}`));
    return lignes.join('\n');
  }

  /** Classes de temps affichées (jusqu'à `jusqua` minutes), avec leur part du territoire si `parts`. */
  _bandes({ jusqua = Infinity, parts = null } = {}) {
    const t = this.t;
    const pourcent = new Intl.NumberFormat(this.langue === 'ar' ? 'ar-MA' : 'fr-FR', { maximumFractionDigits: 0 });
    const bandes = [];
    for (let i = 0; i <= BANDES.length; i++) {
      if (i > 0 && BANDES[i - 1] >= jusqua) break;
      bandes.push({
        couleur: COULEURS_BANDES[i],
        libelle: i < BANDES.length ? t.jusqua(BANDES[i]) : t.auDela(BANDES.at(-1)),
        valeur: parts ? `${pourcent.format(parts[i] * 100)} %` : null,
      });
    }
    return bandes;
  }

  /** Total d'une tournée tracée : « Total : 45,7 km · ≈ 35 min » (sans durée si un tronçon est à vol d'oiseau). */
  _totalTournee(r) {
    const distance = r.troncons.reduce((s, tr) => s + tr.distance, 0);
    const droits = r.troncons.some((tr) => tr.droit);
    const secondes = droits ? null : r.troncons.reduce((s, tr) => s + tr.secondes, 0);
    return this.t.tourneeTotal(formaterDistance(distance, this.langue), secondes != null ? formaterDuree(secondes, this.langue) : null);
  }

  /** Légende et listes de la feuille imprimée (impression.js). */
  pourImpression() {
    const t = this.t;
    const c = COULEURS[this.theme] ?? COULEURS.light;
    const legende = [];
    const listes = [];
    const a = this.affiche;
    if (a) {
      const zone = a.mode === 'zone' ? this.zoneEtat : null;
      legende.push({ type: 'titre', libelle: zone ? t.impZone(zone.nom, zone.limite / 60) : t.impCouverture });
      const bandes = zone ? this._bandes({ jusqua: zone.limite / 60 }) : this._bandes({ parts: a.stats.parts });
      legende.push(...bandes.map((b) => ({ type: 'bande', ...b })));
    }
    const { centre, sorties, statut } = this.bouclage;
    if (centre && statut === 'ok') {
      const titre = t.impBouclage(formaterDistance(this.reglages.rayon, this.langue));
      legende.push({ type: 'cercle', couleur: c.bouclage, libelle: titre });
      listes.push({
        titre: `${titre} — ${t.bouclageResultat(sorties.length)}`,
        lignes: sorties.map((s, i) => ({
          num: String(i + 1), texte: `${this._nomSortie(s)} — ${direction(s.cap, this.langue)}`,
          detail: formaterLambert(versLambert(s.point), { avecZone: false }),
        })),
      });
    }
    const { etapes, resultat: r } = this.tournee;
    if (r) {
      legende.push({ type: 'trait', couleur: c.tournee, libelle: t.impTournee });
      const lignes = r.ordre.map((i, rang) => ({
        num: String(rang + 1),
        texte: rang === 0 ? `${t.depart} · ${this._nomEtape(etapes[i])}` : this._nomEtape(etapes[i]),
        detail: r.troncons[rang - 1] ? this._texteTroncon(r.troncons[rang - 1]) : null,
      }));
      if (r.boucle) lignes.push({ num: '↩', texte: t.retour, detail: this._texteTroncon(r.troncons.at(-1)) });
      lignes.push({ texte: this._totalTournee(r) });
      listes.push({ titre: t.impTournee, lignes });
    }
    return { legende, listes };
  }

  // ── Tournée ──────────────────────────────────────────────────────────────

  ajouterEtape(position, nom = null) {
    const tournee = this.tournee;
    if (tournee.etapes.length >= MAX_ETAPES) {
      tournee.message = this.t.tourneeMax(MAX_ETAPES);
      return this.rendrePanneau();
    }
    tournee.etapes.push({ position, nom });
    this._invaliderTournee();
  }

  retirerEtape(i) {
    this.tournee.etapes.splice(i, 1);
    this._invaliderTournee();
  }

  effacerTournee() {
    this.tournee.etapes = [];
    this._invaliderTournee();
  }

  _invaliderTournee() {
    this._jetons.tournee += 1;
    Object.assign(this.tournee, { resultat: null, statut: null, message: null });
    this._rendre();
    this.rendrePanneau();
  }

  /** Ordre de visite au moindre temps (ou à la plus courte distance), puis tracé par la route. */
  async optimiser() {
    const tournee = this.tournee;
    if (tournee.etapes.length < 2) return;
    const jeton = ++this._jetons.tournee;
    try {
      await this._optimiser(jeton);
    } catch (erreur) {
      if (jeton !== this._jetons.tournee) return;
      Object.assign(tournee, { resultat: null, statut: 'erreur', message: this.t.tourneeErreur(erreur.message) });
      this._rendre();
      this.rendrePanneau();
    }
  }

  async _optimiser(jeton) {
    const tournee = this.tournee;
    const priorite = this.priorite;
    const boucle = this.reglages.boucle;
    const points = tournee.etapes.map((e) => e.position);
    Object.assign(tournee, { resultat: null, statut: 'calcul', message: this.t.tourneeMatrice(0, 1) });
    this._rendre();
    this.rendrePanneau();
    const avancer = (message) => {
      if (jeton !== this._jetons.tournee) return false;
      tournee.message = message;
      this.rendrePanneau();
      return true;
    };
    const matrice = await this.reseau.matrice(points, { priorite, progression: (f, t) => avancer(this.t.tourneeMatrice(f, t)) });
    if (!avancer(this.t.tourneeTrace)) return;
    const { ordre } = ordreOptimal(matrice, { boucle });
    const suite = boucle ? [...ordre, ordre[0]] : ordre;
    const troncons = [];
    for (let k = 1; k < suite.length; k++) {
      const [a, b] = [points[suite[k - 1]], points[suite[k]]];
      const r = await this.reseau.itineraire(a, b, { priorite }).catch(() => null);
      if (jeton !== this._jetons.tournee) return;
      troncons.push(r
        ? { chemin: [a, ...r.chemin, b], distance: r.distance + distanceMetres(a, r.chemin[0]) + distanceMetres(r.chemin.at(-1), b), secondes: r.secondes, approximatif: r.approximatif }
        : { chemin: [a, b], distance: distanceMetres(a, b), secondes: null, droit: true });
    }
    tournee.resultat = { ordre, boucle, troncons };
    Object.assign(tournee, { statut: 'ok', message: null });
    this._rendre();
    this.rendrePanneau();
  }

  /** Changement de priorité (autoroutes / plus court) : la tournée tracée est recalculée. */
  definirPriorite(priorite) {
    this.priorite = priorite;
    if (this.tournee.resultat) this.optimiser();
  }

  definirLangue(langue) {
    const ancien = this.t.cePoint;
    this.langue = langue;
    if (this.zoneEtat?.nom === ancien) this.zoneEtat.nom = this.t.cePoint;
    this.rendrePanneau();
  }

  _nomEtape(e) {
    return e.nom || coordCourte(e.position);
  }

  // ── Panneau ──────────────────────────────────────────────────────────────

  _lierPanneau() {
    const $ = this.$;
    $('couv-active').addEventListener('change', (e) => this.basculerCouverture(e.target.checked));
    for (const b of document.querySelectorAll('[data-zone-duree]')) {
      b.addEventListener('click', () => {
        this.reglages.duree = Number(b.dataset.zoneDuree);
        this._enregistrer();
        if (this.zoneEtat) this.zone(this.zoneEtat.position, this.zoneEtat.nom);
        else this.rendrePanneau();
      });
    }
    $('zone-effacer').addEventListener('click', () => this.effacerZone());

    $('bouclage-placer').addEventListener('click', () => this.activerOutil('bouclage'));
    const relancerBouclage = () => {
      this._enregistrer();
      if (this.bouclage.centre) this.placerBouclage(this.bouclage.centre);
      else this.rendrePanneau();
    };
    for (const b of document.querySelectorAll('[data-rayon]')) {
      b.addEventListener('click', () => { this.reglages.rayon = Number(b.dataset.rayon); relancerBouclage(); });
    }
    for (const b of document.querySelectorAll('[data-filtre]')) {
      b.addEventListener('click', () => { this.reglages.filtre = b.dataset.filtre; relancerBouclage(); });
    }
    $('bouclage-copier').addEventListener('click', async (e) => {
      const bouton = e.currentTarget;
      try {
        await navigator.clipboard.writeText(this._texteBouclage());
        const libelle = bouton.textContent;
        bouton.textContent = this.t.copie;
        setTimeout(() => { bouton.textContent = libelle; }, 2000);
      } catch { /* presse-papiers refusé */ }
    });
    $('bouclage-effacer').addEventListener('click', () => this.effacerBouclage());

    $('tournee-placer').addEventListener('click', () => this.activerOutil('tournee'));
    $('tournee-boucle').addEventListener('change', (e) => {
      this.reglages.boucle = e.target.checked;
      this._enregistrer();
      if (this.tournee.resultat) this.optimiser();
    });
    $('tournee-optimiser').addEventListener('click', () => this.optimiser());
    $('tournee-effacer').addEventListener('click', () => this.effacerTournee());
  }

  /** Légende des classes de temps ; `parts` : part du territoire de chaque classe (couverture). */
  _legende(conteneur, options) {
    conteneur.replaceChildren(...this._bandes(options).map(({ couleur, libelle, valeur }) => {
      const li = element('li');
      li.style.setProperty('--c', couleur);
      li.append(element('span', null, libelle));
      if (valeur) li.append(element('b', null, valeur));
      return li;
    }));
  }

  rendrePanneau() {
    const $ = this.$;
    const t = this.t;
    const presse = (el, actif) => el.setAttribute('aria-pressed', String(actif));
    const nombre = new Intl.NumberFormat(this.langue === 'ar' ? 'ar-MA' : 'fr-FR', { maximumFractionDigits: 0 });

    // Couverture
    const couv = this.couverture;
    $('couv-active').checked = couv.active;
    $('couv-statut').textContent = couv.statut === 'calcul' ? t.couvCalcul
      : couv.statut?.erreur ? t.couvErreur(couv.statut.erreur)
        : couv.active && couv.cache ? t.couvPrete(couv.cache.noms.length) : '';
    const legendeCouv = $('couv-legende');
    legendeCouv.hidden = !(couv.active && this.affiche?.mode === 'couverture');
    if (!legendeCouv.hidden) this._legende(legendeCouv, { parts: this.affiche.stats.parts });
    $('analyse-estimation').textContent = t.estimation;

    // Zone d'intervention
    for (const b of document.querySelectorAll('[data-zone-duree]')) presse(b, Number(b.dataset.zoneDuree) === this.reglages.duree);
    const z = this.zoneEtat;
    let statutZone = '';
    if (z?.statut === 'calcul') statutZone = t.zoneCalcul(z.nom);
    else if (z?.statut === 'erreur') statutZone = t.zoneErreur(z.erreur);
    else if (z?.statut === 'ok' && this.affiche?.mode === 'zone') {
      const { parts, km2 } = this.affiche.stats;
      statutZone = t.zonePrete(z.nom, z.limite / 60, nombre.format(parts.reduce((s, p) => s + p, 0) * km2));
    }
    $('zone-statut').textContent = statutZone;
    $('zone-statut').hidden = !statutZone;
    $('zone-aide').hidden = Boolean(z);
    $('zone-effacer').hidden = !z;
    const legendeZone = $('zone-legende');
    legendeZone.hidden = !(z?.statut === 'ok' && this.affiche?.mode === 'zone');
    if (!legendeZone.hidden) this._legende(legendeZone, { jusqua: z.limite / 60 });

    // Bouclage
    presse($('bouclage-placer'), this.outil === 'bouclage');
    for (const b of document.querySelectorAll('[data-rayon]')) presse(b, Number(b.dataset.rayon) === this.reglages.rayon);
    for (const b of document.querySelectorAll('[data-filtre]')) presse(b, b.dataset.filtre === this.reglages.filtre);
    const bo = this.bouclage;
    $('bouclage-sortie').hidden = !bo.centre;
    $('bouclage-aide').textContent = t.bouclageAide;
    $('bouclage-aide').hidden = !(this.outil === 'bouclage' && !bo.centre);
    if (bo.centre) {
      $('bouclage-resultat').textContent = bo.statut === 'calcul' ? t.bouclageCalcul
        : bo.statut === 'erreur' ? t.bouclageErreur : t.bouclageResultat(bo.sorties.length);
      $('bouclage-note').textContent = bo.statut === 'ok' && this.reglages.filtre === 'toutes' && bo.z < 13 ? t.bouclageZoom : '';
      $('bouclage-liste').replaceChildren(...bo.sorties.map((s, i) => {
        const li = element('li');
        const bouton = element('button', 'item-liste');
        bouton.type = 'button';
        bouton.append(element('b', 'num', String(i + 1)), element('span', 'item-nom', this._nomSortie(s)), element('small', null, direction(s.cap, this.langue)));
        bouton.title = `${coordCourte(s.point)} · ${formaterLambert(versLambert(s.point), { langue: this.langue })}`;
        bouton.addEventListener('click', () => this.carte.flyTo({ center: s.point, zoom: Math.max(this.carte.getZoom(), 15), speed: 1.4 }));
        li.append(bouton);
        return li;
      }));
      $('bouclage-copier').hidden = !bo.sorties.length;
    }

    // Tournée
    const to = this.tournee;
    presse($('tournee-placer'), this.outil === 'tournee');
    $('tournee-boucle').checked = this.reglages.boucle;
    $('tournee-aide').textContent = t.tourneeAide;
    $('tournee-aide').hidden = !(this.outil === 'tournee' || !to.etapes.length);
    $('tournee-sortie').hidden = !to.etapes.length;
    $('tournee-optimiser').disabled = to.etapes.length < 2 || to.statut === 'calcul';
    const r = to.resultat;
    const nomListe = (e, rang) => (rang === 0 ? `${t.depart} · ${this._nomEtape(e)}` : this._nomEtape(e));
    let items;
    if (r) {
      items = r.ordre.map((i, rang) => {
        const li = element('li');
        li.append(element('b', 'num', String(rang + 1)), element('span', 'item-nom', nomListe(to.etapes[i], rang)));
        const troncon = r.troncons[rang - 1];
        if (troncon) li.append(element('small', null, this._texteTroncon(troncon)));
        return li;
      });
      if (r.boucle) {
        const li = element('li');
        li.append(element('b', 'num', '↩'), element('span', 'item-nom', t.retour), element('small', null, this._texteTroncon(r.troncons.at(-1))));
        items.push(li);
      }
    } else {
      items = to.etapes.map((e, i) => {
        const li = element('li');
        li.append(element('b', 'num', String(i + 1)), element('span', 'item-nom', nomListe(e, i)));
        const retirer = element('button', 'retirer', '×');
        retirer.type = 'button';
        retirer.setAttribute('aria-label', t.retirer);
        retirer.addEventListener('click', () => this.retirerEtape(i));
        li.append(retirer);
        return li;
      });
    }
    $('tournee-liste').replaceChildren(...items);
    let resultat = '';
    const details = [];
    if (r) {
      resultat = this._totalTournee(r);
      if (r.troncons.some((tr) => tr.droit)) details.push(t.tourneeDroit);
      if (r.troncons.some((tr) => tr.approximatif)) details.push(t.tourneeApprox);
    }
    $('tournee-resultat').textContent = resultat;
    $('tournee-statut').textContent = [to.message, ...details].filter(Boolean).join(' · ');
  }

  _texteTroncon(troncon) {
    const d = formaterDistance(troncon.distance, this.langue);
    if (troncon.droit) return `↗ ${d}`;
    return `${troncon.approximatif ? '≈ ' : ''}${d} · ${formaterDuree(troncon.secondes, this.langue)}`;
  }
}
