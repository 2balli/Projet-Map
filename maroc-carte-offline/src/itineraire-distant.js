/**
 * Mandataire de ReseauRoutier (itineraire.js) qui travaille dans itineraire-worker.js :
 * mêmes méthodes asynchrones (`itineraire`, `lignes`, `matrice`), mêmes résultats, mais la
 * carte reste fluide pendant qu'un graphe routier se construit.
 *
 * Option `canal` (ex. 'apercu') : une nouvelle demande sur le même canal annule la
 * précédente si elle attend encore son tour ; la demande annulée se résout à null.
 */
export class ReseauRoutierDistant {
  /**
   * @param {() => Worker} creerWorker  fabrique du worker (recréé si le précédent a échoué)
   * @param {{ urlTuiles: string, urlNational: string }} urls
   */
  constructor(creerWorker, urls) {
    Object.assign(this, { creerWorker, urls });
    this.worker = null;
    this.attente = new Map(); // id → { resolve, reject, progression }
    this.canaux = new Map(); // canal → id de la dernière demande
    this.id = 0;
  }

  _demarrer() {
    if (this.worker) return this.worker;
    const worker = this.creerWorker();
    worker.onmessage = ({ data }) => {
      const demande = this.attente.get(data.id);
      if (!demande) return;
      if (data.progression) return demande.progression?.(...data.progression);
      this.attente.delete(data.id);
      if (data.erreur) demande.reject(new Error(data.erreur));
      else demande.resolve(data.annule ? null : data.resultat);
    };
    // Worker introuvable ou planté : aucune demande ne reste bloquée, le prochain appel le recrée.
    worker.onerror = worker.onmessageerror = (e) => {
      e.preventDefault?.();
      for (const { reject } of this.attente.values()) reject(new Error(e.message || 'calcul d’itinéraire interrompu'));
      this.attente.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    worker.postMessage({ type: 'init', ...this.urls });
    this.worker = worker;
    return worker;
  }

  _appel(methode, args, { canal = null, progression = null } = {}) {
    const worker = this._demarrer();
    const id = ++this.id;
    if (canal) {
      const precedent = this.canaux.get(canal);
      if (precedent && this.attente.has(precedent)) worker.postMessage({ type: 'annuler', id: precedent });
      this.canaux.set(canal, id);
    }
    return new Promise((resolve, reject) => {
      this.attente.set(id, { resolve, reject, progression });
      worker.postMessage({ type: 'appel', id, methode, args });
    });
  }

  /** @see ReseauRoutier#itineraire */
  itineraire(a, b, { priorite = 'autoroute', canal = null } = {}) {
    return this._appel('itineraire', [a, b, { priorite }], { canal });
  }

  /** @see ReseauRoutier#lignes */
  lignes(bbox, { zMax } = {}) {
    return this._appel('lignes', [bbox, zMax === undefined ? {} : { zMax }]);
  }

  /** @see ReseauRoutier#matrice */
  matrice(points, { priorite = 'autoroute', progression = () => {} } = {}) {
    return this._appel('matrice', [points, { priorite }], { progression });
  }
}
