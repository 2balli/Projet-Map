import * as maplibregl from 'maplibre-gl';
import { enDMS } from './barre-recherche.js';
import { element } from './dom.js';
import {
  COUCHES_CLIQUABLES_POINTS, COUCHES_INFRA, COUCHES_UNITES, NIVEAUX,
  couchesDecoupage, echelonAuZoom, entitesSelection, plagesEchelon,
} from './gendarmerie-style.js';

const nombre = (n, langue) => (n == null ? null : new Intl.NumberFormat(langue === 'ar' ? 'ar-MA' : 'fr-FR', { maximumFractionDigits: 0 }).format(n));

/** Les tableaux des propriétés reviennent de MapLibre en JSON : liste de chaînes dans tous les cas. */
const liste = (valeur) => {
  if (Array.isArray(valeur)) return valeur;
  try { return valeur ? JSON.parse(valeur) : []; } catch { return []; }
};

/**
 * Couches de la Gendarmerie sur la carte : réglages en direct (échelon, unités,
 * infrastructures), fiche de sélection dans un panneau latéral, infobulle au
 * survol, sélection d'une circonscription.
 */
export class CouchesGendarmerie {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ inspecteur: HTMLElement, textes: () => object, langue: () => string, mesureActive: (e?: maplibregl.MapMouseEvent) => boolean,
   *           ajouterAMesure: (point) => void, surChangement?: () => void,
   *           actionsPoint?: (position: number[], nom: string) => [string, () => void, boolean?][] }} options
   *   `mesureActive` : un autre outil a les clics (survol et fiches suspendus) ; reçoit le clic en cours,
   *   que l'appelant peut aussi refuser (clic sur un élément du croquis).
   *   `actionsPoint` : actions supplémentaires des fiches d'unité et d'infrastructure (analyse.js).
   *   `extensions` : autres couches de points ouvertes dans ce panneau (barages : couche-barages.js),
   *   { couches: string[], nom: (p) => string, infobulle: (p) => [titre, sous-titre], fiche: (p, coord) => fiche,
   *     clic?: (p, coord) => boolean } ; leurs fiches reçoivent aussi « Mesurer depuis ici » et `actionsPoint` ;
   *   `clic` renvoie true quand il a traité le clic (aucune fiche).
   */
  constructor(carte, { inspecteur, textes, langue, mesureActive, ajouterAMesure, surChangement = () => {}, actionsPoint = () => [], extensions = [] }) {
    Object.assign(this, { carte, inspecteur, textes, langue, mesureActive, ajouterAMesure, surChangement, actionsPoint, extensions });
    this.couchesPoints = [...COUCHES_CLIQUABLES_POINTS, ...extensions.flatMap((x) => x.couches)];
    this.reglages = { echelon: 'auto', unites: true, infra: false };
    this.selection = null; // { id, niveau, geometrie }
    this.entites = new Map(); // niveau → Map(id → circonscription complète)
    this.repere = null;
    this.infobulle = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'infobulle', offset: 12 });
    this.survol = null;

    carte.on('click', (e) => this._surClic(e));
    carte.on('mousemove', (e) => this._surMouvement(e));
    carte.getCanvas().addEventListener('mouseleave', () => this._cacherInfobulle());
    carte.on('zoomend', () => this.surChangement());
    // Un changement de thème ou de langue recrée les sources : reposer la sélection.
    carte.on('style.load', () => this._rendreSelection());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.inspecteur.hidden && !this.mesureActive()) this.fermer();
    });
  }

  /** Applique des réglages sans recharger le style. */
  regler(reglages) {
    Object.assign(this.reglages, reglages);
    if (!this.carte.getLayer('gr-reg-fond')) return;
    const plages = plagesEchelon(this.reglages.echelon);
    for (const n of NIVEAUX) {
      for (const id of couchesDecoupage(n)) {
        if (plages[n]) this.carte.setLayerZoomRange(id, plages[n][0], plages[n][1]);
        this.carte.setLayoutProperty(id, 'visibility', plages[n] ? 'visible' : 'none');
      }
    }
    for (const id of COUCHES_UNITES) this.carte.setLayoutProperty(id, 'visibility', this.reglages.unites ? 'visible' : 'none');
    for (const id of COUCHES_INFRA) this.carte.setLayoutProperty(id, 'visibility', this.reglages.infra ? 'visible' : 'none');
    if (this.selection && !plages[this.selection.niveau]) this.deselectionner();
    this.surChangement();
  }

  /** Échelon de circonscription visible au zoom courant (null si aucun). */
  echelonAffiche() {
    return echelonAuZoom(this.reglages.echelon, this.carte.getZoom());
  }

  /** Ouvre la fiche d'une circonscription (« reg-3 », « bt-120 »…), l'isole et la cadre. */
  async montrerCirco(id) {
    const entite = await this._entite(id);
    if (!entite) return;
    this._ouvrir(this._ficheCirco(entite.properties), null);
    await this.selectionner(id, { cadrer: true });
  }

  /** Isole une circonscription et, au besoin, la cadre. */
  async selectionner(id, { cadrer = false } = {}) {
    const niveau = id.split('-')[0];
    const geometrie = (await this._entite(id))?.geometry;
    if (!geometrie) return;
    this.selection = { id, niveau, geometrie };
    this._rendreSelection();
    if (cadrer) {
      const points = (geometrie.type === 'Polygon' ? [geometrie.coordinates] : geometrie.coordinates).flatMap((p) => p[0]);
      const bornes = points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0]));
      const droite = this.inspecteur.hidden || window.innerWidth <= 900 ? 48 : this.inspecteur.offsetWidth + 36;
      this.carte.fitBounds(bornes, { padding: { top: 90, bottom: 60, left: 48, right: droite }, maxZoom: 13 });
    }
  }

  deselectionner() {
    this.selection = null;
    this._rendreSelection();
  }

  /** Ferme la fiche : sélection, repère et panneau. */
  fermer() {
    this.inspecteur.hidden = true;
    this.inspecteur.replaceChildren();
    this.repere?.remove();
    this.repere = null;
    this.deselectionner();
  }

  /** Circonscription complète (géométrie non découpée en tuiles, attributs). */
  async _entite(id) {
    const niveau = id.split('-')[0];
    if (!this.entites.has(niveau)) {
      const source = this.carte.getSource(`gr-circo-${niveau}`);
      if (!source) return null;
      const donnees = await source.getData();
      this.entites.set(niveau, new Map(donnees.features.map((f) => [f.properties.id, f])));
    }
    return this.entites.get(niveau).get(id) ?? null;
  }

  _rendreSelection() {
    const source = this.carte.getSource('gr-selection');
    if (!source) return;
    source.setData(this.selection ? entitesSelection(this.selection.geometrie) : { type: 'FeatureCollection', features: [] });
  }

  _couchesPresentes(ids) {
    return ids.filter((id) => this.carte.getLayer(id) && this.carte.getLayoutProperty(id, 'visibility') !== 'none');
  }

  _sous(e, couches, marge = 0) {
    const presentes = this._couchesPresentes(couches);
    if (!presentes.length) return null;
    const { x, y } = e.point;
    const zone = marge ? [[x - marge, y - marge], [x + marge, y + marge]] : e.point;
    return this.carte.queryRenderedFeatures(zone, { layers: presentes })[0] ?? null;
  }

  // ── Survol ───────────────────────────────────────────────────────────────

  _surMouvement(e) {
    if (this.mesureActive()) return this._cacherInfobulle();
    const point = this._sous(e, this.couchesPoints, 4);
    this.carte.getCanvas().style.cursor = point ? 'pointer' : '';
    if (!point) return this._cacherInfobulle();
    const p = point.properties;
    const extension = this._extension(point.layer.id);
    const cle = `${point.layer.id}|${extension ? p.id : p.nom}`;
    if (cle === this.survol) return;
    this.survol = cle;
    const t = this.textes();
    const [titre, sous] = extension ? extension.infobulle(p) : [p.nom, point.layer.id === 'gr-infra-point' ? t[`grInfra_${p.type}`]
      : point.layer.id === 'gr-unite-excel' ? t.grExcel : t[`grNiveauCourt_${p.niveau}`]];
    const contenu = element('span', null, titre);
    contenu.append(element('small', null, sous));
    this.infobulle.setLngLat(point.geometry.coordinates).setDOMContent(contenu).addTo(this.carte);
  }

  _cacherInfobulle() {
    this.survol = null;
    this.infobulle.remove();
  }

  // ── Clic ─────────────────────────────────────────────────────────────────

  _surClic(e) {
    if (this.mesureActive(e)) return;
    const point = this._sous(e, this.couchesPoints, 4);
    this._cacherInfobulle();
    if (point) {
      this.deselectionner();
      const coord = point.geometry.coordinates;
      const extension = this._extension(point.layer.id);
      // Une extension peut traiter le clic elle-même (groupe de barages : la carte s'approche).
      if (extension?.clic?.(point.properties, coord)) return;
      if (extension) return this._ouvrir(this._ficheExtension(extension, point.properties, coord), coord);
      const fiche = point.layer.id === 'gr-infra-point' ? this._ficheInfra(point.properties, coord)
        : point.layer.id === 'gr-unite-excel' ? this._ficheExcel(point.properties, coord) : this._ficheUnite(point.properties, coord);
      return this._ouvrir(fiche, coord);
    }
    const niveau = this.echelonAffiche();
    const circo = niveau && this._sous(e, [`gr-${niveau}-fond`]);
    if (circo) {
      this._ouvrir(this._ficheCirco(circo.properties), null);
      this.selectionner(circo.properties.id);
    } else if (!this.inspecteur.hidden) {
      this.fermer();
    }
  }

  _extension(couche) {
    return this.extensions.find((x) => x.couches.includes(couche)) ?? null;
  }

  /** Fiche d'une couche d'extension, avec les actions communes en tête. */
  _ficheExtension(extension, p, coord) {
    const fiche = extension.fiche(p, coord);
    const t = this.textes();
    const communes = [[t.grMesurerDepuis, () => { this.ajouterAMesure(coord); this.fermer(); }], ...this.actionsPoint(coord, extension.nom(p))];
    return { ...fiche, actions: [...communes, ...(fiche.actions ?? [])] };
  }

  /** Affiche une fiche dans le panneau latéral ; `position` pose un repère sur la carte. */
  _ouvrir(fiche, position) {
    this.repere?.remove();
    this.repere = position
      ? new maplibregl.Marker({ element: element('div', 'repere-selection') }).setLngLat(position).addTo(this.carte)
      : null;
    this.inspecteur.replaceChildren(this._rendreFiche(fiche));
    this.inspecteur.hidden = false;
    this.inspecteur.scrollTop = 0;
  }

  /**
   * @param {{ type: string, titre: string, fil?: string[], tuiles?: [string, string|null][],
   *           lignes?: [string, string|null, boolean?][], note?: string|null, actions?: [string, () => void, boolean?][],
   *           groupes?: { titre: string, elements: (string | [string, string|null])[] }[] }} f
   *   `groupes` : unités du classeur (rattachées, ou sur le même site) ; un élément [nom, précision].
   *   `voisins` : chefs-lieux posés au même point, ouverts d'un clic.
   */
  _rendreFiche({ type, titre, fil = [], tuiles = [], lignes = [], note = null, actions = [], groupes = [], voisins = null }) {
    const t = this.textes();
    const racine = document.createDocumentFragment();

    const tete = element('header', 'insp-tete');
    tete.append(element('span', 'insp-type', type), element('h2', null, titre));
    const etapes = fil.filter(Boolean);
    if (etapes.length) {
      const liste = element('ol', 'insp-fil');
      for (const etape of etapes) liste.append(element('li', null, etape));
      tete.append(liste);
    }
    const fermer = element('button', 'insp-fermer', '×');
    fermer.type = 'button';
    fermer.setAttribute('aria-label', t.fermer);
    fermer.addEventListener('click', () => this.fermer());
    tete.append(fermer);

    const corps = element('div', 'insp-corps');
    const remplies = tuiles.filter(([, valeur]) => valeur != null && valeur !== '');
    if (remplies.length) {
      const grille = element('div', 'insp-tuiles');
      for (const [libelle, valeur] of remplies) {
        const tuile = element('div', 'insp-tuile');
        tuile.append(element('b', null, valeur), element('span', null, libelle));
        grille.append(tuile);
      }
      corps.append(grille);
    }
    const lignesRemplies = lignes.filter(([, valeur]) => valeur != null && valeur !== '');
    if (lignesRemplies.length) {
      const dl = element('dl', 'insp-lignes');
      for (const [terme, valeur, mono] of lignesRemplies) dl.append(element('dt', null, terme), element('dd', mono ? 'mono' : null, valeur));
      corps.append(dl);
    }
    if (note) corps.append(element('p', 'insp-note', note));
    if (voisins?.noms.length) {
      const bloc = element('p', 'insp-voisins', `${voisins.titre} `);
      for (const nom of voisins.noms) {
        const lien = element('button', 'lien', nom);
        lien.type = 'button';
        lien.addEventListener('click', () => this.montrerUnite(nom));
        bloc.append(lien);
      }
      corps.append(bloc);
    }
    for (const groupe of groupes.filter((g) => g?.elements.length)) {
      const bloc = element('details', 'insp-groupe');
      bloc.open = groupe.elements.length <= 8;
      bloc.append(element('summary', null, groupe.titre));
      const ul = element('ul');
      for (const item of groupe.elements) {
        const [nom, precision] = Array.isArray(item) ? item : [item, null];
        const li = element('li', null, nom);
        if (precision) li.append(element('small', null, precision));
        ul.append(li);
      }
      bloc.append(ul);
      corps.append(bloc);
    }
    if (actions.length) {
      const rangee = element('div', 'insp-actions');
      for (const [texte, action, secondaire, desactive] of actions) {
        const bouton = element('button', secondaire ? 'secondaire' : null, texte);
        bouton.type = 'button';
        // 4e élément : action indisponible (texte = raison, en infobulle).
        if (desactive) {
          bouton.disabled = true;
          if (typeof desactive === 'string') bouton.title = desactive;
        }
        bouton.addEventListener('click', action);
        rangee.append(bouton);
      }
      corps.append(rangee);
    }
    racine.append(tete, corps);
    return racine;
  }

  // ── Fiches ───────────────────────────────────────────────────────────────

  _chiffres(p) {
    const t = this.textes();
    const l = this.langue();
    const densite = p.population && p.superficie ? p.population / p.superficie : null;
    return [
      [t.grPopulation, nombre(p.population, l)],
      [`${t.grSuperficie} (km²)`, p.superficie ? nombre(p.superficie, l) : null],
      [`${t.grDensite} (${t.grParKm2})`, densite != null ? nombre(densite, l) : null],
    ];
  }

  _position([lon, lat]) {
    return `${enDMS(lat, 'N', 'S')}\n${enDMS(lon, 'E', 'O')}`;
  }

  _ficheUnite(p, coord) {
    const t = this.textes();
    const l = this.langue();
    const actions = [[t.grMesurerDepuis, () => { this.ajouterAMesure(coord); this.fermer(); }], ...this.actionsPoint(coord, p.nom)];
    if (p.circo) actions.push([t.grVoirCirco, () => this.montrerCirco(p.circo), true]);
    return {
      type: t[`grNiveau_${p.niveau}`],
      titre: p.nom,
      fil: [p.reg && `${t.grRegionCourt} ${p.reg}`, p.cie && `Cie ${p.cie}`],
      tuiles: [
        ...this._chiffres(p),
        [t.grNbCie, p.nbCie != null ? nombre(p.nbCie, l) : null],
        [t.grNbBt, p.nbBt != null ? nombre(p.nbBt, l) : null],
      ],
      lignes: [
        [t.grCirconscription, p.circoNom ? (p.rattachement === 'position' ? `${p.circoNom} ${t.grParPosition}` : p.circoNom) : null],
        [t.grPosition, this._position(coord), true],
      ],
      note: [p.rattachement === 'classeur' ? t.grChefLieuClasseur : null,
        liste(p.memePosition).length ? t.grMemePosition(liste(p.memePosition).join(', ')) : null].filter(Boolean).join(' ') || null,
      groupes: this._groupesClasseur(p),
      voisins: { titre: t.grMemeSite, noms: [...liste(p.memePosition), ...liste(p.memeSite)] },
      actions,
    };
  }

  /** Ouvre la fiche d'un chef-lieu d'après son nom (voisins d'un même site). */
  async montrerUnite(nom) {
    const donnees = await this.carte.getSource('gr-unites')?.getData();
    const f = donnees?.features.find((x) => x.properties.nom === nom && ['reg', 'cie', 'bt'].includes(x.properties.niveau));
    if (!f) return;
    this.deselectionner();
    this._ouvrir(this._ficheUnite(f.properties, f.geometry.coordinates), f.geometry.coordinates);
  }

  /** Unités du classeur : celles qui dépendent de ce chef-lieu, puis les autres posées sur son site. */
  _groupesClasseur(p) {
    const t = this.textes();
    const rattachees = liste(p.rattachees).map(([nom, ou]) => [nom, ou === 'site' ? t.grAilleurs : ou ? t.grSurSiteDe(ou) : null]);
    const surSite = liste(p.surSite).map(([nom, parent]) => [nom, parent ? t.grDependDe(parent) : null]);
    return [
      { titre: t.grRattachees(rattachees.length), elements: rattachees },
      { titre: t.grEgalementSurSite(surSite.length), elements: surSite },
    ];
  }

  _ficheCirco(p) {
    const t = this.textes();
    const l = this.langue();
    return {
      type: `${t.grCirco} · ${t[`grNiveau_${p.niveau}`]}`,
      titre: p.nom,
      fil: [p.reg && `${t.grRegionCourt} ${p.reg}`, p.cie && `Cie ${p.cie}`],
      tuiles: [
        ...this._chiffres(p),
        [t.grNbCie, p.nbCie != null ? nombre(p.nbCie, l) : null],
        [t.grNbBt, p.nbBt != null ? nombre(p.nbBt, l) : null],
      ],
      note: p.confiance != null && p.confiance < 1 ? t.grConfiance(Math.round(p.confiance * 100)) : null,
      actions: [[t.grCadrer, () => this.selectionner(p.id, { cadrer: true })]],
    };
  }

  _ficheInfra(p, coord) {
    const t = this.textes();
    const ar = this.langue() === 'ar';
    const [principal, secondaire] = ar && p.nomAr ? [p.nomAr, p.nom] : [p.nom, p.nomAr];
    return {
      type: t[`grInfra_${p.type}`],
      titre: principal,
      lignes: [
        [t.grAutreNom, secondaire && secondaire !== principal ? secondaire : null],
        ['IATA', p.iata],
        [t.grPosition, this._position(coord), true],
      ],
      actions: [[t.grMesurerDepuis, () => { this.ajouterAMesure(coord); this.fermer(); }], ...this.actionsPoint(coord, principal)],
    };
  }

  _ficheExcel(p, coord) {
    const t = this.textes();
    const unites = liste(p.unites);
    return {
      type: t.grExcel,
      titre: p.nom,
      groupes: unites.length > 1 ? [{ titre: t.grSurSite(unites.length), elements: unites }] : [],
      fil: [p.regroupement, p.compagnie],
      lignes: [
        [t.grDepend, p.rattachement],
        [t.grRegion, p.regroupement],
        [t.grCompagnie, p.compagnie],
        [t.grPosition, this._position(coord), true],
      ],
      actions: [[t.grMesurerDepuis, () => { this.ajouterAMesure(coord); this.fermer(); }], ...this.actionsPoint(coord, p.nom)],
    };
  }
}
