import * as maplibregl from 'maplibre-gl';

const DELAI_FRAPPE_MS = 120;

/** 33.5731 → « 33°34′23,2″ N » */
export function enDMS(valeur, positif, negatif) {
  const abs = Math.abs(valeur);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d - m / 60) * 3600).toFixed(1).replace('.', ',');
  return `${d}°${String(m).padStart(2, '0')}′${s.padStart(4, '0')}″ ${valeur >= 0 ? positif : negatif}`;
}

/**
 * Barre de recherche : saisie, liste de résultats au clavier, envol vers le lieu
 * choisi, repère et fiche avec « Ajouter à la mesure ».
 */
export class BarreRecherche {
  /**
   * @param {maplibregl.Map} carte
   * @param {{ entree: HTMLInputElement, liste: HTMLElement, statut: HTMLElement, worker: Worker,
   *           urlIndex: string, indexOptionnels?: string[], textes: () => object, langue: () => string,
   *           ajouterAMesure?: (point) => void }} options
   *   `indexOptionnels` : index complémentaires fusionnés au principal (unités de la Gendarmerie).
   */
  constructor(carte, { entree, liste, statut, worker, urlIndex, indexOptionnels = [], textes, langue, ajouterAMesure }) {
    Object.assign(this, { carte, entree, liste, statut, worker, urlIndex, indexOptionnels, textes, langue, ajouterAMesure });
    this.resultats = [];
    this.actif = -1;
    this.jeton = 0;
    this.pret = false;
    this.repere = null;

    worker.addEventListener('message', ({ data }) => this._surMessage(data));
    entree.addEventListener('focus', () => this.prechauffer(), { once: true });
    entree.addEventListener('input', () => this._planifier());
    entree.addEventListener('keydown', (e) => this._surTouche(e));
    entree.addEventListener('blur', () => setTimeout(() => this._fermer(), 150));
    liste.addEventListener('mousedown', (e) => e.preventDefault()); // garder le focus pendant le clic
    liste.addEventListener('click', (e) => {
      const li = e.target.closest('[data-indice]');
      if (li) this.choisir(Number(li.dataset.indice));
    });
    // « / » ou Ctrl+K : aller à la recherche.
    document.addEventListener('keydown', (e) => {
      const dansUnChamp = e.target instanceof HTMLElement && e.target.closest('input, select, textarea');
      if ((e.key === '/' && !dansUnChamp) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        entree.focus();
        entree.select();
      }
    });
  }

  /** Charge l'index en arrière-plan dès la première mise au point du champ. */
  prechauffer() {
    if (this.pret) return;
    this._afficherStatut(this.textes().chargementIndex);
    this.worker.postMessage({ type: 'charger', url: this.urlIndex, optionnels: this.indexOptionnels });
  }

  /** Après un changement de langue : relance la recherche affichée. */
  rafraichir() {
    // Sans le focus, la liste fermée le reste.
    if (this.entree.value.trim() && document.activeElement === this.entree) this._chercher();
  }

  _surMessage(data) {
    if (data.type === 'pret') {
      this.pret = true;
      this._afficherStatut('');
      if (this.entree.value.trim()) this._chercher();
    } else if (data.type === 'erreur') {
      this._afficherStatut(this.textes().indexAbsent);
    } else if (data.id === this.jeton) {
      if (data.erreur) return this._afficherStatut(this.textes().indexAbsent);
      this.resultats = data.resultats;
      this.actif = this.resultats.length ? 0 : -1;
      this._rendre();
    }
  }

  _planifier() {
    clearTimeout(this._minuteur);
    this._minuteur = setTimeout(() => this._chercher(), DELAI_FRAPPE_MS);
  }

  _chercher() {
    const requete = this.entree.value.trim();
    this.jeton += 1;
    if (!requete) {
      this.resultats = [];
      return this._rendre();
    }
    const { lng, lat } = this.carte.getCenter();
    this.worker.postMessage({
      type: 'chercher', id: this.jeton, url: this.urlIndex, optionnels: this.indexOptionnels, requete,
      options: { centre: [lng, lat], langue: this.langue(), max: 8 },
    });
  }

  _surTouche(e) {
    const n = this.resultats.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.actif = (this.actif + 1) % n;
      this._rendre();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.actif = (this.actif - 1 + n) % n;
      this._rendre();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (n) this.choisir(Math.max(0, this.actif));
    } else if (e.key === 'Escape') {
      if (!this.liste.hidden) this._fermer();
      else { this.entree.value = ''; this.entree.blur(); }
    }
  }

  _fermer() {
    this.liste.hidden = true;
    this.entree.setAttribute('aria-expanded', 'false');
  }

  _afficherStatut(texte) {
    this.statut.textContent = texte;
    this.statut.hidden = !texte;
  }

  _rendre() {
    const t = this.textes();
    const requete = this.entree.value.trim();
    this.liste.replaceChildren();
    if (!requete) return this._fermer();
    if (!this.resultats.length) {
      if (!this.pret) return this._fermer();
      const vide = document.createElement('li');
      vide.className = 'resultat-vide';
      vide.textContent = t.aucunResultat;
      this.liste.append(vide);
    }
    this.resultats.forEach((r, i) => {
      const li = document.createElement('li');
      li.id = `resultat-${i}`;
      li.setAttribute('role', 'option');
      li.dataset.indice = String(i);
      li.setAttribute('aria-selected', String(i === this.actif));
      const type = document.createElement('span');
      type.className = `resultat-type type-${r.type}`;
      type.textContent = r.libelle;
      const nom = document.createElement('span');
      nom.className = 'resultat-nom';
      nom.textContent = r.nom;
      const details = document.createElement('span');
      details.className = 'resultat-details';
      details.textContent = [r.nomSecondaire, r.contexte].filter(Boolean).join(' · ');
      li.append(type, nom, details);
      this.liste.append(li);
    });
    this.liste.hidden = false;
    this.entree.setAttribute('aria-expanded', 'true');
    this.entree.setAttribute('aria-activedescendant', this.actif >= 0 ? `resultat-${this.actif}` : '');
    this.liste.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  /** Va au résultat choisi et y pose un repère avec sa fiche. */
  choisir(i) {
    const r = this.resultats[i];
    if (!r) return;
    this._fermer();
    this.entree.blur();
    const t = this.textes();
    this.carte.flyTo({ center: r.point, zoom: r.zoom, speed: 1.6 });
    this.repere?.remove();

    const fiche = document.createElement('div');
    fiche.className = 'fiche-lieu';
    const titre = document.createElement('strong');
    titre.textContent = r.nom;
    const sous = document.createElement('span');
    sous.textContent = [r.libelle, r.nomSecondaire, r.contexte].filter(Boolean).join(' · ');
    const coord = document.createElement('code');
    coord.textContent = `${enDMS(r.point[1], 'N', 'S')}  ${enDMS(r.point[0], 'E', 'O')}`;
    fiche.append(titre, sous, coord);
    if (this.ajouterAMesure) {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = t.ajouterMesure;
      bouton.addEventListener('click', () => {
        this.ajouterAMesure(r.point);
        this.repere?.getPopup()?.remove();
      });
      fiche.append(bouton);
    }
    const fenetre = new maplibregl.Popup({ offset: 28, maxWidth: '300px' }).setDOMContent(fiche);
    this.repere = new maplibregl.Marker({ color: '#0b2445' }).setLngLat(r.point).setPopup(fenetre).addTo(this.carte);
    this.repere.togglePopup();
  }
}
