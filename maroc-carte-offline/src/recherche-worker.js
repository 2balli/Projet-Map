/**
 * Recherche dans un fil d'exécution séparé : le chargement de l'index (≈ 6 Mo,
 * ~1 s de préparation) et chaque requête ne bloquent jamais la carte.
 *
 * Messages reçus :  { type: 'charger', url, optionnels } · { type: 'chercher', id, url, optionnels, requete, options }
 * Messages émis :   { type: 'pret', taille } · { type: 'erreur', message } · { id, resultats } · { id, erreur }
 */
import { Recherche } from './recherche.js';

let recherche = null;
const index = ({ url, optionnels = [] }) => {
  recherche ??= new Recherche(url, optionnels);
  return recherche.charger();
};

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'charger') {
      const pret = await index(data);
      self.postMessage({ type: 'pret', taille: pret.taille });
    } else if (data.type === 'chercher') {
      const pret = await index(data);
      self.postMessage({ id: data.id, resultats: pret.chercher(data.requete, data.options) });
    }
  } catch (erreur) {
    if (data.type === 'chercher') self.postMessage({ id: data.id, erreur: erreur.message });
    else self.postMessage({ type: 'erreur', message: erreur.message });
  }
};
