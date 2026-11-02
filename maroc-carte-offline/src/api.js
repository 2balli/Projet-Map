/**
 * Client de l'API du serveur local (serveur/api.mjs). Les droits sont vérifiés par le serveur :
 * ce client ne fait qu'envoyer les requêtes (cookie de session HttpOnly, en-tête anti-intersite)
 * et rendre les erreurs lisibles.
 */
export class ErreurApi extends Error {
  constructor(statut, message, donnees = {}) {
    super(message);
    this.statut = statut;
    this.changer = donnees.changer === true; // mot de passe temporaire à changer d'abord
  }
}

/** @returns {Promise<object>} corps JSON ; ErreurApi si refus (statut HTTP et message du serveur) */
export async function appelApi(chemin, { methode = 'GET', corps } = {}) {
  let r;
  try {
    r = await fetch(chemin, {
      method: methode,
      credentials: 'same-origin',
      headers: methode === 'POST' ? { 'Content-Type': 'application/json', 'X-Requested-With': 'maroc-carte' } : {},
      body: methode === 'POST' ? JSON.stringify(corps ?? {}) : undefined,
    });
  } catch {
    throw new ErreurApi(0, 'serveur injoignable');
  }
  const estJson = (r.headers.get('content-type') ?? '').includes('application/json');
  // Serveur de développement (Vite) ou ancien serveur : pas d'API.
  if (!estJson) throw new ErreurApi(r.status === 200 ? 503 : r.status, 'serveur de comptes indisponible : lancez la carte avec « npm start » (ou l’image Docker)');
  const donnees = await r.json();
  if (!r.ok) throw new ErreurApi(r.status, donnees.erreur ?? `erreur ${r.status}`, donnees);
  return donnees;
}

/** Télécharge une réponse JSON de l'API comme fichier (exports de l'administrateur). */
export async function telechargerApi(chemin, nomFichier) {
  const donnees = await appelApi(chemin);
  const url = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 1)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nomFichier });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return donnees;
}
