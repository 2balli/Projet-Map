/**
 * Analyse « Optimisation des barrages » dans un fil séparé : la carte reste utilisable
 * pendant l'analyse (contrôle des routes compris). Voir optimisation.js.
 *
 * Messages reçus : { type: 'analyser', id, instantane, regles, urls: { circos: { reg, cie, bt }, tuiles } }
 *                  { type: 'doublons', id, instantane, regles, portee: { perimetre, inclureAjoutsLocaux }, urls }
 *                  { type: 'proximite', id, enregistrements, regles, urls }
 *                  { type: 'candidats', id, zone: { niveau, id }, pasM, max, urls }  (carte de chaleur)
 *                  { type: 'annuler', id }
 * Messages émis :  { id, progression: [fait, total, etape] } · { id, resultat } · { id, erreur }
 */
import { PMTiles } from 'pmtiles';
import { CLASSES_ROUTE, construireHierarchie } from './barages.js';
import { circonscriptionEn, contient, indexerCircos } from './competence.js';
import { ReseauRoutier } from './itineraire.js';
import { detecterDoublons } from './dedoublonnage.js';
import { analyser } from './optimisation.js';
import { echantillonnerLignes, fenetres, pairesCandidates } from './proximite.js';

let referentiel = null; // { cle, hierarchie, circosBt }
let routes = null; // { url, reseau }
const annules = new Set();

async function lireReferentiel(urls) {
  const cle = JSON.stringify(urls);
  if (referentiel?.cle === cle) return referentiel;
  const lire = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`circonscriptions : HTTP ${r.status}`))));
  const [reg, cie, bt] = await Promise.all([lire(urls.reg), lire(urls.cie), lire(urls.bt)]);
  referentiel = {
    cle,
    hierarchie: construireHierarchie({ reg: reg.features.map((f) => f.properties), cie: cie.features.map((f) => f.properties), bt: bt.features.map((f) => f.properties) }),
    circosBt: indexerCircos(bt),
    circos: { reg: indexerCircos(reg), cie: indexerCircos(cie), bt: indexerCircos(bt) },
  };
  return referentiel;
}

function lireRoutes(url) {
  if (routes?.url !== url) routes = { url, reseau: new ReseauRoutier(new PMTiles(url)) };
  return (bbox, zMax) => routes.reseau.lignes(bbox, { zMax });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'annuler') {
    annules.add(data.id);
    return;
  }
  if (data.type === 'candidats') {
    // Emplacements candidats de la carte de chaleur : points des routes carrossables des tuiles,
    // dans la zone choisie (limites des circonscriptions), avec leur brigade. Rien d'inventé.
    const { id, zone, pasM, max, urls } = data;
    try {
      const { circos, circosBt } = await lireReferentiel(urls.circos);
      const entite = circos[zone.niveau]?.find((e) => e.proprietes.id === zone.id);
      if (!entite) throw new Error(`limites de la zone ${zone.id} introuvables`);
      const lire = lireRoutes(urls.tuiles);
      const morceaux = fenetres(entite.emprise, 0.25);
      const vus = new Set();
      let candidats = [];
      let illisibles = 0;
      for (let i = 0; i < morceaux.length; i++) {
        if (annules.has(id)) return self.postMessage({ id, resultat: { annule: true } });
        const lu = await lire(morceaux[i], 13).catch(() => null);
        if (!lu) illisibles += 1;
        else {
          candidats.push(...echantillonnerLignes(lu.lignes, pasM, { classes: CLASSES_ROUTE, vus, dans: (pt) => contient(entite.geometrie, pt) }));
        }
        self.postMessage({ id, progression: [i + 1, morceaux.length, 'routes'] });
      }
      // Trop de points : un sur k, régulièrement (signalé).
      const total = candidats.length;
      if (total > max) {
        const k = total / max;
        candidats = Array.from({ length: max }, (_, j) => candidats[Math.floor(j * k)]);
      }
      for (const c of candidats) c.btId = circonscriptionEn(circosBt, c.point)?.id ?? null;
      self.postMessage({ id, resultat: { candidats, total, fenetres: morceaux.length, illisibles, emprise: entite.emprise } });
    } catch (erreur) {
      self.postMessage({ id, erreur: erreur?.message ?? String(erreur) });
    } finally {
      annules.delete(id);
    }
    return;
  }
  if (data.type === 'proximite') {
    const { id, enregistrements, regles, urls } = data;
    try {
      const { hierarchie } = await lireReferentiel(urls.circos);
      self.postMessage({ id, resultat: pairesCandidates(enregistrements, regles, hierarchie) });
    } catch (erreur) {
      self.postMessage({ id, erreur: erreur?.message ?? String(erreur) });
    }
    return;
  }
  if (data.type === 'doublons') {
    const { id, instantane, regles, portee, urls } = data;
    try {
      const { hierarchie } = await lireReferentiel(urls.circos);
      const resultat = detecterDoublons(instantane, regles, {
        ...portee, hierarchie,
        progression: (fait, total, etape) => self.postMessage({ id, progression: [fait, total, etape] }),
      });
      self.postMessage({ id, resultat });
    } catch (erreur) {
      self.postMessage({ id, erreur: erreur?.message ?? String(erreur) });
    }
    return;
  }
  if (data.type !== 'analyser') return;
  const { id, instantane, regles, urls } = data;
  try {
    const { hierarchie, circosBt } = await lireReferentiel(urls.circos);
    const contexte = {
      hierarchie, circosBt, simulationDeclaree: instantane.simulationDeclaree,
      lireRoutes: regles.verifierRoutes ? lireRoutes(urls.tuiles) : null,
    };
    const resultat = await analyser(instantane, contexte, regles, {
      annule: () => annules.has(id),
      progression: (fait, total, etape) => self.postMessage({ id, progression: [fait, total, etape] }),
    });
    self.postMessage({ id, resultat });
  } catch (erreur) {
    self.postMessage({ id, erreur: erreur?.message ?? String(erreur) });
  } finally {
    annules.delete(id);
  }
};
