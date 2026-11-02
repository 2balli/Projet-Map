import {
  distanceMetres, ecartMinimal, formaterDistance, lignesDe, nomRoute, pointLePlusProche, pointMilieuChemin,
} from './mesure.js';

const SOURCE = 'mesure';
const RAYON_ACCROCHE_PX = 12;
/** En dessous, les tuiles sont simplifiées : la mesure reste juste mais moins fine. */
const ZOOM_PRECIS = 14;
/** Couches « roads_* » qui ne sont pas des routes ou pas des traits. */
const NON_ROUTES = /rail|runway|taxiway|pier|labels|shields|oneway/;
/** Délai avant de calculer l'aperçu routier sous le curseur (quand la souris s'arrête). */
const DELAI_APERCU_MS = 180;

const TEXTES = {
  fr: {
    aideDistance: 'Cliquez pour poser des points : la mesure suit les routes. Alt : segment à vol d’oiseau. Double-clic ou Échap pour terminer, ⌫ pour annuler le dernier point.',
    aideEcart1: 'Cliquez sur une première route.',
    aideEcart2: 'Cliquez sur une seconde route.',
    aideEcart3: 'Cliquez sur une route pour une nouvelle mesure.',
    aideZoom: 'Zoomez davantage (niveau 14 ou plus) pour une mesure au mètre près.',
    memeRoute: 'C’est la même route : choisissez-en une autre.',
    total: 'Total', ecart: 'Écart', croisement: 'Les deux routes se croisent', sansNom: 'route sans nom',
    axes: 'à vol d’oiseau, d’axe à axe',
    troncons: (n) => `${n} tronçon${n > 1 ? 's' : ''} par la route`,
    priorites: { autoroute: 'autoroutes en priorité', court: 'plus court chemin' },
    calcul: 'Calcul de l’itinéraire…',
    echec: (n) => `⚠ ${n} tronçon${n > 1 ? 's' : ''} sans route trouvée : mesuré${n > 1 ? 's' : ''} à vol d’oiseau`,
    libres: (n) => `${n} tronçon${n > 1 ? 's' : ''} à vol d’oiseau (Alt)`,
    approx: '≈ longue distance : itinéraire par les grands axes',
  },
  ar: {
    aideDistance: 'انقر لوضع النقاط: القياس يتبع الطرق. Alt: مقطع في خط مستقيم. نقرة مزدوجة أو Esc للإنهاء، ⌫ لإلغاء آخر نقطة.',
    aideEcart1: 'انقر على الطريق الأولى.',
    aideEcart2: 'انقر على الطريق الثانية.',
    aideEcart3: 'انقر على طريق لقياس جديد.',
    aideZoom: 'كبّر الخريطة (المستوى 14 فأكثر) لقياس دقيق بالمتر.',
    memeRoute: 'إنها نفس الطريق: اختر طريقًا أخرى.',
    total: 'المجموع', ecart: 'المسافة', croisement: 'الطريقان متقاطعتان', sansNom: 'طريق بدون اسم',
    axes: 'في خط مستقيم، من محور إلى محور',
    troncons: (n) => `${n} مقطع عبر الطريق`,
    priorites: { autoroute: 'الأولوية للطرق السيارة', court: 'أقصر طريق' },
    calcul: 'جارٍ حساب المسار…',
    echec: (n) => `⚠ ${n} مقطع بدون طريق: مقاس في خط مستقيم`,
    libres: (n) => `${n} مقطع في خط مستقيم (Alt)`,
    approx: '≈ مسافة طويلة: المسار عبر المحاور الكبرى',
  },
};

const COULEURS = {
  light: { trait: '#c1272d', texte: '#7a1015', halo: '#ffffff', route: '#c1272d' },
  dark: { trait: '#ff5a60', texte: '#ffe1e2', halo: '#101418', route: '#ff5a60' },
};

const milieu = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const point = (coordinates, proprietes) => ({ type: 'Feature', properties: proprietes, geometry: { type: 'Point', coordinates } });
const ligne = (coordinates, proprietes) => ({ type: 'Feature', properties: proprietes, geometry: { type: 'LineString', coordinates } });

/** Raccorde un itinéraire routier aux points cliqués (écart d'accroche, souvent < 1 m). */
function raccorder(de, a, itineraire) {
  const chemin = [de, ...itineraire.chemin, a];
  const distance = itineraire.distance
    + distanceMetres(de, itineraire.chemin[0]) + distanceMetres(itineraire.chemin.at(-1), a);
  return { chemin, distance, approximatif: itineraire.approximatif };
}

/**
 * Outil de mesure sur la carte.
 *   mode « distance » : points successifs, chaque tronçon suit les routes ;
 *   mode « ecart »    : distance la plus courte (à vol d'oiseau) entre deux routes.
 * `surChangement(resume)` est appelé à chaque changement pour mettre à jour le panneau.
 */
export class OutilMesure {
  /**
   * @param {{ reseau?: import('./itineraire.js').ReseauRoutier | import('./itineraire-distant.js').ReseauRoutierDistant, priorite?: 'autoroute' | 'court', surChangement?: Function }} options
   */
  constructor(carte, { reseau = null, priorite = 'autoroute', surChangement = () => {} } = {}) {
    this.carte = carte;
    this.reseau = reseau;
    this.priorite = priorite;
    this.surChangement = surChangement;
    this.langue = 'fr';
    this.theme = 'light';
    this.mode = null;
    this._jetonApercu = 0;
    this.reinitialiser();

    this._clic = (e) => this._surClic(e);
    this._doubleClic = (e) => this._surDoubleClic(e);
    this._mouvement = (e) => this._surMouvement(e);
    this._touche = (e) => this._surTouche(e);
    this._apresDeplacement = () => this._notifier();
  }

  reinitialiser() {
    this.points = [];
    this.troncons = [];
    this.termine = false;
    this.curseur = null;
    this.apercu = null;
    this.accroche = null;
    this.routes = [];
    this.ecart = null;
    this.message = null;
    clearTimeout(this._minuteurApercu);
    this._jetonApercu += 1;
  }

  /** À appeler à chaque chargement de style (le changement de thème ou de langue efface les sources). */
  installer({ theme = this.theme, langue = this.langue } = {}) {
    this.theme = theme;
    this.langue = langue;
    const c = COULEURS[theme] ?? COULEURS.light;
    const carte = this.carte;
    if (!carte.getSource(SOURCE)) carte.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const type = (...types) => ['in', ['get', 'type'], ['literal', types]];
    const couches = [
      { id: 'mesure-routes', type: 'line', filter: type('route'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.route, 'line-opacity': 0.3, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 6, 18, 18] } },
      { id: 'mesure-apercu', type: 'line', filter: type('apercu'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.trait, 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.75 } },
      { id: 'mesure-droit', type: 'line', filter: type('droit'),
        paint: { 'line-color': c.trait, 'line-width': 3, 'line-dasharray': [1, 1.5] } },
      { id: 'mesure-trace', type: 'line', filter: type('trace', 'ecart'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': c.trait, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 18, 6] } },
      { id: 'mesure-sommets', type: 'circle', filter: type('sommet', 'accroche'),
        paint: {
          'circle-radius': ['match', ['get', 'type'], 'accroche', 6, 4.5],
          'circle-color': ['match', ['get', 'type'], 'accroche', 'rgba(0,0,0,0)', c.trait],
          'circle-stroke-color': ['match', ['get', 'type'], 'accroche', c.trait, c.halo],
          'circle-stroke-width': 2,
        } },
      { id: 'mesure-etiquettes', type: 'symbol', filter: type('etiquette'),
        layout: {
          'text-field': ['get', 'texte'], 'text-font': ['Noto Sans Medium'], 'text-size': 13,
          'text-offset': [0, -1.1], 'text-allow-overlap': true, 'text-ignore-placement': true,
        },
        paint: { 'text-color': c.texte, 'text-halo-color': c.halo, 'text-halo-width': 2 } },
    ];
    for (const couche of couches) {
      if (!carte.getLayer(couche.id)) carte.addLayer({ ...couche, source: SOURCE });
    }
    this._rendre();
  }

  definirLangue(langue) {
    this.langue = langue;
    this._rendre();
  }

  activer(mode) {
    if (this.mode === mode) return this.arreter();
    if (!this.mode) {
      this.carte.on('click', this._clic);
      this.carte.on('dblclick', this._doubleClic);
      this.carte.on('mousemove', this._mouvement);
      this.carte.on('moveend', this._apresDeplacement);
      document.addEventListener('keydown', this._touche);
      this.carte.doubleClickZoom.disable();
    }
    this.mode = mode;
    this.reinitialiser();
    this.carte.getCanvas().style.cursor = 'crosshair';
    this._rendre();
  }

  arreter() {
    if (!this.mode) return;
    this.carte.off('click', this._clic);
    this.carte.off('dblclick', this._doubleClic);
    this.carte.off('mousemove', this._mouvement);
    this.carte.off('moveend', this._apresDeplacement);
    document.removeEventListener('keydown', this._touche);
    this.carte.doubleClickZoom.enable();
    this.carte.getCanvas().style.cursor = '';
    this.mode = null;
    this.reinitialiser();
    this._rendre();
  }

  effacer() {
    this.reinitialiser();
    this._rendre();
  }

  // ── Routes rendues sous le curseur ───────────────────────────────────────

  _couchesRoutes() {
    return this.carte.getStyle().layers
      .filter((c) => c.type === 'line' && c.source === 'protomaps' && c.id.startsWith('roads_') && !NON_ROUTES.test(c.id))
      .map((c) => c.id);
  }

  /** Route rendue la plus proche du pixel, dans un rayon de RAYON_ACCROCHE_PX. */
  _routeSous(evenement) {
    const { x, y } = evenement.point;
    const r = RAYON_ACCROCHE_PX;
    const candidates = this.carte.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: this._couchesRoutes() });
    const clic = [evenement.lngLat.lng, evenement.lngLat.lat];
    let meilleure = null;
    for (const feature of candidates) {
      const proche = pointLePlusProche(clic, lignesDe(feature.geometry));
      if (proche && (!meilleure || proche.distance < meilleure.distance)) meilleure = { feature, ...proche };
    }
    return meilleure;
  }

  /** Toute la route visible : les morceaux (découpés par les tuiles) de même nom et même type. */
  _routeComplete(feature) {
    const p = feature.properties ?? {};
    const nom = p.name || p.ref || null;
    const cle = nom ? `${nom}|${p.kind}` : null;
    let lignes = lignesDe(feature.geometry);
    if (cle) {
      lignes = this.carte.queryRenderedFeatures({ layers: this._couchesRoutes() })
        .filter((f) => `${f.properties?.name || f.properties?.ref || ''}|${f.properties?.kind}` === cle)
        .flatMap((f) => lignesDe(f.geometry));
    }
    return { cle, proprietes: p, lignes };
  }

  // ── Tronçons par la route ────────────────────────────────────────────────

  _ajouterPoint(p, libre) {
    const precedent = this.points.at(-1);
    this.points.push(p);
    if (!precedent) return;
    const troncon = { de: precedent, a: p, libre };
    this.troncons.push(troncon);
    this._calculerTroncon(troncon);
  }

  /** (Re)calcule un tronçon par la route, selon la priorité courante. */
  _calculerTroncon(troncon) {
    const { de, a } = troncon;
    const distance = distanceMetres(de, a);
    const parLaRoute = !troncon.libre && this.reseau && distance > 0.5;
    const priorite = this.priorite;
    Object.assign(troncon, { statut: parLaRoute ? 'calcul' : 'droit', chemin: [de, a], distance, approximatif: false, priorite });
    if (!parLaRoute) return;
    this.reseau.itineraire(de, a, { priorite })
      .then((itineraire) => {
        // Tronçon annulé, ou priorité changée entre-temps : résultat périmé.
        if (!this.troncons.includes(troncon) || troncon.priorite !== priorite) return;
        if (itineraire) Object.assign(troncon, { statut: 'route', ...raccorder(de, a, itineraire) });
        else troncon.statut = 'echec';
        this._rendre();
      })
      .catch(() => {
        troncon.statut = 'echec';
        this._rendre();
      });
  }

  /** Ajoute un point venu d'ailleurs (un résultat de recherche) à la mesure de distance. */
  ajouterPoint(point) {
    if (this.mode !== 'distance') this.activer('distance');
    if (this.termine) this.reinitialiser();
    this._ajouterPoint(point, false);
    this._rendre();
  }

  /** Autoroutes en priorité (`'autoroute'`) ou plus court chemin (`'court'`) : recalcule les tronçons tracés. */
  definirPriorite(priorite) {
    if (priorite === this.priorite) return;
    this.priorite = priorite;
    for (const troncon of this.troncons) if (!troncon.libre) this._calculerTroncon(troncon);
    this.apercu = null;
    this._jetonApercu += 1;
    this._rendre();
  }

  _retirerDernierPoint() {
    this.points.pop();
    if (this.troncons.length >= this.points.length && this.troncons.length) this.troncons.pop();
  }

  /** Aperçu sous le curseur : ligne droite immédiate, puis itinéraire routier quand la souris s'arrête. */
  _preparerApercu(libre) {
    clearTimeout(this._minuteurApercu);
    const jeton = ++this._jetonApercu;
    const de = this.points.at(-1);
    const a = this.curseur;
    if (!de || !a || this.termine) {
      this.apercu = null;
      return;
    }
    const distance = distanceMetres(de, a);
    const parLaRoute = !libre && this.reseau && distance > 0.5;
    this.apercu = { chemin: [de, a], distance, statut: parLaRoute ? 'calcul' : 'droit' };
    if (!parLaRoute) return;
    this._minuteurApercu = setTimeout(async () => {
      // Canal « apercu » : l'aperçu suivant remplace celui-ci s'il n'a pas encore été calculé.
      const itineraire = await this.reseau.itineraire(de, a, { priorite: this.priorite, canal: 'apercu' }).catch(() => null);
      if (jeton !== this._jetonApercu) return;
      this.apercu = itineraire ? { statut: 'route', ...raccorder(de, a, itineraire) } : { ...this.apercu, statut: 'droit' };
      this._rendre();
    }, DELAI_APERCU_MS);
  }

  // ── Évènements ───────────────────────────────────────────────────────────

  _surClic(e) {
    if (this.mode === 'distance') {
      if (this.termine) this.reinitialiser();
      this._ajouterPoint(this._positionAccrochee(e), Boolean(e.originalEvent?.altKey));
      this.apercu = null;
      this._jetonApercu += 1;
    } else if (this.mode === 'ecart') {
      const sous = this._routeSous(e);
      if (!sous) return;
      if (this.routes.length === 2) this.reinitialiser();
      const route = this._routeComplete(sous.feature);
      this.message = null;
      if (this.routes.length === 1 && route.cle && route.cle === this.routes[0].cle) {
        this.message = 'memeRoute';
      } else {
        this.routes.push(route);
        if (this.routes.length === 2) this.ecart = ecartMinimal(this.routes[0].lignes, this.routes[1].lignes);
      }
    }
    this._rendre();
  }

  _surDoubleClic(e) {
    e.preventDefault();
    if (this.mode !== 'distance') return;
    // Un double-clic a déjà produit deux clics : retirer le doublon du dernier point.
    const n = this.points.length;
    if (n >= 2 && distanceMetres(this.points[n - 1], this.points[n - 2]) < 0.5) this._retirerDernierPoint();
    this.termine = this.points.length > 0;
    this.curseur = null;
    this.apercu = null;
    this._jetonApercu += 1;
    this._rendre();
  }

  _surMouvement(e) {
    if (this._image) return;
    this._image = requestAnimationFrame(() => {
      this._image = null;
      if (this.mode === 'distance') {
        if (this.termine) return;
        this.curseur = this._positionAccrochee(e);
        this._preparerApercu(Boolean(e.originalEvent?.altKey));
      } else if (this.mode === 'ecart' && this.routes.length < 2) {
        const sous = this._routeSous(e);
        this.accroche = sous ? sous.point : null;
        this.carte.getCanvas().style.cursor = sous ? 'pointer' : 'crosshair';
      }
      this._rendre();
    });
  }

  _surTouche(e) {
    if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return;
    if (e.key === 'Escape') {
      if (this.mode === 'distance' && this.points.length && !this.termine) {
        this.termine = true;
        this.curseur = null;
        this.apercu = null;
        this._jetonApercu += 1;
        this._rendre();
      } else {
        this.arreter();
      }
    } else if (e.key === 'Backspace' && this.mode === 'distance' && this.points.length) {
      e.preventDefault();
      this._retirerDernierPoint();
      this.termine = false;
      this.apercu = null;
      this._jetonApercu += 1;
      this._rendre();
    }
  }

  /** Position du clic, accrochée à la route la plus proche sauf si Alt est enfoncé. */
  _positionAccrochee(e) {
    const brut = [e.lngLat.lng, e.lngLat.lat];
    const sous = e.originalEvent?.altKey ? null : this._routeSous(e);
    this.accroche = sous ? sous.point : null;
    return sous ? sous.point : brut;
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  _rendre() {
    const source = this.carte.getSource(SOURCE);
    if (source) source.setData({ type: 'FeatureCollection', features: this._entites() });
    this._notifier();
  }

  _notifier() {
    this.surChangement(this.resume());
  }

  _etiquette(troncon) {
    if (troncon.statut === 'calcul') return '…';
    const texte = formaterDistance(troncon.distance, this.langue);
    return troncon.approximatif ? `≈ ${texte}` : texte;
  }

  _entites() {
    const f = [];
    if (this.mode === 'distance') {
      const typeTrait = { route: 'trace', calcul: 'apercu', droit: 'droit', echec: 'droit' };
      for (const troncon of this.troncons) {
        f.push(ligne(troncon.chemin, { type: typeTrait[troncon.statut] }));
        f.push(point(pointMilieuChemin(troncon.chemin), { type: 'etiquette', texte: this._etiquette(troncon) }));
      }
      for (const p of this.points) f.push(point(p, { type: 'sommet' }));
      if (this.apercu && !this.termine) {
        f.push(ligne(this.apercu.chemin, { type: 'apercu' }));
        f.push(point(pointMilieuChemin(this.apercu.chemin), { type: 'etiquette', texte: this._etiquette(this.apercu) }));
      }
    } else if (this.mode === 'ecart') {
      for (const route of this.routes) {
        f.push({ type: 'Feature', properties: { type: 'route' }, geometry: { type: 'MultiLineString', coordinates: route.lignes } });
      }
      if (this.ecart) {
        const { de, a, distance, croisement } = this.ecart;
        if (!croisement) f.push(ligne([de, a], { type: 'ecart' }));
        f.push(point(de, { type: 'sommet' }), point(a, { type: 'sommet' }));
        f.push(point(milieu(de, a), { type: 'etiquette', texte: croisement ? '0 m' : formaterDistance(distance, this.langue) }));
      }
    }
    if (this.mode && this.accroche && !(this.mode === 'distance' && this.termine) && this.routes.length < 2) {
      f.push(point(this.accroche, { type: 'accroche' }));
    }
    return f;
  }

  /** Résumé pour le panneau : { mode, resultat, details[], aide }. */
  resume() {
    const t = TEXTES[this.langue] ?? TEXTES.fr;
    const d = (m) => formaterDistance(m, this.langue);
    const nom = (route) => nomRoute(route.proprietes, this.langue) || t.sansNom;
    const imprecis = this.mode && this.carte.getZoom() < ZOOM_PRECIS;
    const resume = { mode: this.mode, resultat: null, details: [], aide: null };
    if (this.mode === 'distance') {
      const compte = (statut) => this.troncons.filter((tr) => tr.statut === statut).length;
      if (this.troncons.length) {
        const total = this.troncons.reduce((s, tr) => s + tr.distance, 0);
        const approximatif = this.troncons.some((tr) => tr.approximatif);
        resume.resultat = `${t.total} : ${compte('calcul') ? '…' : `${approximatif ? '≈ ' : ''}${d(total)}`}`;
        const parRoute = compte('route');
        if (parRoute) resume.details.push(`${t.troncons(parRoute)} · ${t.priorites[this.priorite]}`);
        if (compte('calcul')) resume.details.push(t.calcul);
        if (compte('echec')) resume.details.push(t.echec(compte('echec')));
        if (compte('droit')) resume.details.push(t.libres(compte('droit')));
        if (approximatif) resume.details.push(t.approx);
      }
      resume.aide = t.aideDistance;
    } else if (this.mode === 'ecart') {
      if (this.routes[0]) resume.details.push(`① ${nom(this.routes[0])}`);
      if (this.routes[1]) resume.details.push(`② ${nom(this.routes[1])}`);
      if (this.ecart) {
        resume.resultat = this.ecart.croisement ? t.croisement : `${t.ecart} : ${d(this.ecart.distance)}`;
        if (!this.ecart.croisement) resume.details.push(t.axes);
      }
      resume.aide = this.message ? t[this.message] : t[['aideEcart1', 'aideEcart2', 'aideEcart3'][this.routes.length]];
    }
    if (imprecis) resume.aide = `${resume.aide} ${t.aideZoom}`;
    return resume;
  }
}
