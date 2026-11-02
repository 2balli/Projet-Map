/**
 * Itinéraires dans un fil séparé : lecture des routes dans les tuiles, construction des
 * graphes et recherche de chemin (itineraire.js, reseau-national.js) ne bloquent plus la
 * carte. Même code qu'avant, appelé par itineraire-distant.js.
 *
 * Messages reçus :  { type: 'init', urlTuiles, urlNational }
 *                   { type: 'appel', id, methode: 'itineraire' | 'lignes' | 'matrice', args }
 *                   { type: 'annuler', id }   (demande devenue inutile : elle est sautée si elle n'a pas commencé)
 * Messages émis :   { id, resultat } · { id, erreur } · { id, annule: true } · { id, progression: [fait, total] }
 *
 * Les demandes sont traitées une à une, dans l'ordre : une demande annulée avant son tour
 * ne coûte rien (aperçus de la mesure remplacés pendant que la souris bouge).
 */
import { PMTiles } from 'pmtiles';
import { ReseauRoutier } from './itineraire.js';
import { ReseauNational } from './reseau-national.js';

const METHODES = new Set(['itineraire', 'lignes', 'matrice']);
let reseau = null;
const file = [];
const annules = new Set();
let occupe = false;

async function traiter() {
  if (occupe) return;
  occupe = true;
  while (file.length) {
    const { id, methode, args } = file.shift();
    if (annules.delete(id)) {
      self.postMessage({ id, annule: true });
      continue;
    }
    try {
      if (!reseau) throw new Error('itinéraires non initialisés');
      if (!METHODES.has(methode)) throw new Error(`méthode inconnue : ${methode}`);
      const options = { ...(args.at(-1) ?? {}) };
      if (methode === 'matrice') options.progression = (fait, total) => self.postMessage({ id, progression: [fait, total] });
      const resultat = await reseau[methode](...args.slice(0, -1), options);
      self.postMessage({ id, resultat });
    } catch (erreur) {
      self.postMessage({ id, erreur: erreur?.message ?? String(erreur) });
    }
  }
  occupe = false;
}

self.onmessage = ({ data }) => {
  if (data.type === 'init') {
    reseau = new ReseauRoutier(new PMTiles(data.urlTuiles), { national: new ReseauNational(data.urlNational) });
  } else if (data.type === 'annuler') {
    if (file.some((d) => d.id === data.id)) annules.add(data.id);
  } else if (data.type === 'appel') {
    file.push(data);
    traiter();
  }
};
