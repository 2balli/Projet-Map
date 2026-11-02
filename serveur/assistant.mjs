/**
 * ASSISTANT D'ANALYSE — le SEUL appel sortant du service, et il est optionnel.
 *
 * Le panneau Optimisation mesure des rapprochements ; il ne dit pas ce qu'il
 * faudrait en faire. Ce module envoie le résultat du calcul à un service
 * d'analyse et rapporte sa réponse en texte, affichée telle quelle dans le
 * panneau.
 *
 * DEUX DESTINATIONS POSSIBLES, DANS CET ORDRE
 * -------------------------------------------
 *   n8n     un workflow reçoit le résumé sur son webhook et rend le texte.
 *           C'est la voie à préférer : le workflow peut enchaîner ce qu'il veut
 *           (Ollama, un modèle distant, une base, un envoi de message) sans
 *           qu'une ligne de cette application ne change.
 *   Ollama  appel direct à `/api/generate`, utile pour essayer sans n8n, ou
 *           comme secours si le workflow est indisponible.
 *
 * Configuré, l'un ou l'autre suffit. Non configuré, RIEN NE CHANGE : la route
 * répond 503 et le bouton ne s'affiche même pas. C'est ce qui permet de garder
 * la propriété annoncée dans le README — un service intranet qui n'appelle rien
 * à l'extérieur — pour tout déploiement qui ne demande pas l'assistant.
 *
 * CE QUI N'EST JAMAIS ENVOYÉ
 * --------------------------
 * Ni identité, ni matricule, ni code, ni coordonnées de patrouille. Le corps
 * transmis est construit par la route appelante à partir du seul résultat du
 * calcul (voir POST /api/assistant/optimisation), et plafonné.
 *
 * L'ADRESSE VIENT DE LA CONFIGURATION, JAMAIS DE LA REQUÊTE. Un client ne peut
 * donc pas faire appeler une adresse de son choix par le serveur — ce serait lui
 * offrir un relais vers tout ce que le serveur peut joindre et lui pas.
 */

/** Une minute : un modèle local met des dizaines de secondes à répondre. */
const DELAI_MS = 60_000;

/** Ce qu'on accepte de rapporter — au-delà, la réponse est tronquée. */
const MAX_TEXTE = 8000;

/**
 * Cherche le texte dans une réponse dont on ne maîtrise pas la forme.
 *
 * Un workflow n8n rend ce que son dernier nœud produit : parfois une chaîne,
 * souvent `{json: {...}}`, souvent un tableau d'un seul élément, et les noms de
 * champ varient d'un montage à l'autre. Plutôt que d'imposer une forme unique —
 * qu'il faudrait deviner juste du premier coup — on accepte les formes usuelles
 * et on le dit dans la documentation.
 */
function extraireTexte(donnees, profondeur = 0) {
  if (donnees == null || profondeur > 4) return '';
  if (typeof donnees === 'string') return donnees;
  if (Array.isArray(donnees)) {
    for (const e of donnees) {
      const t = extraireTexte(e, profondeur + 1);
      if (t) return t;
    }
    return '';
  }
  if (typeof donnees !== 'object') return '';

  /* Noms rencontrés en pratique : `response` est celui d'Ollama. */
  for (const cle of ['texte', 'text', 'response', 'output', 'message', 'reponse', 'analyse', 'result', 'data', 'json']) {
    if (cle in donnees) {
      const t = extraireTexte(donnees[cle], profondeur + 1);
      if (t) return t;
    }
  }
  return '';
}

/** Appel HTTP avec délai maximal — un service muet ne doit pas figer la requête. */
async function poster(url, corps, delaiMs) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delaiMs);
  try {
    const reponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal: controleur.signal,
    });

    const brut = await reponse.text();
    if (!reponse.ok) {
      const err = new Error(
        `${url} a répondu ${reponse.status}${brut ? ` : ${brut.slice(0, 300)}` : ''}`
      );
      err.statut = 502;
      throw err;
    }

    try {
      return JSON.parse(brut);
    } catch {
      return brut; // un workflow peut rendre du texte brut
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Aucune réponse de ${url} en ${Math.round(delaiMs / 1000)} s.`);
      e.statut = 504;
      /* La machine n'a rien dit du tout : ce n'est pas le service qui traîne,
         c'est la voie qui est coupée. La bascule vers l'autre service s'en
         sert pour ne pas attendre une seconde fois sur le même hôte. */
      e.injoignable = true;
      throw e;
    }
    if (!err.statut) err.statut = 502;
    throw err;
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Le texte soumis au modèle quand on appelle Ollama DIRECTEMENT.
 *
 * En français, et cadré : on demande une lecture opérationnelle, pas un poème.
 * Passer par n8n dispense de ce prompt — le workflow écrit le sien.
 */
function prompt(resume) {
  const inv = resume.inventaire ?? {};
  const mesure = resume.examines != null;

  const lignes = [
    'Tu assistes un officier de la Gendarmerie Royale qui arbitre l’implantation des barrages routiers.',
    '',
    `Périmètre : ${resume.perimetre ?? 'non précisé'}.`,
    '',
    'DISPOSITIF EN PLACE',
    `- barrages : ${inv.total ?? '?'} (${inv.fixes ?? '?'} fixes, ${inv.mobiles ?? '?'} mobiles)`,
    `- portes de ville : ${inv.entrees ?? 0} entrée(s), ${inv.sorties ?? 0} sortie(s)`,
    `- postes de mission VIP : ${inv.vip ?? 0}`,
    `- axes non éclairés : ${inv.nonEclaires ?? 0}`,
  ];

  /**
   * La mesure de distance n'est joignable que si elle a eu lieu. Annoncer son
   * absence vaut mieux que d'envoyer des zéros : un modèle à qui l'on donne
   * « 0 poste sous le seuil » conclut que le dispositif est conforme, alors que
   * personne n'a rien mesuré.
   */
  if (mesure) {
    lignes.push(
      '',
      'MESURE DE RAPPROCHEMENT (calcul déjà lancé sur ce périmètre)',
      `- distance minimale demandée : ${resume.seuilKm ?? '?'} km`,
      `- barrages fixes examinés : ${resume.examines}, dont ${resume.sousLeSeuil ?? '?'} sous le seuil`,
      `- intouchables (portes de ville, VIP, accidents, axes non éclairés) : ${resume.intouchables ?? 0}`,
      `- restant à trancher : ${resume.aDecider ?? 0}`
    );
    if (resume.postes?.length) {
      lignes.push('', 'Postes concernés :');
      for (const p of resume.postes) {
        lignes.push(
          `- ${p.nom || 'sans nom'}${p.route ? ` (${p.route})` : ''} : ${p.distanceKm} km de son voisin` +
            `${p.protections?.length ? `, protégé (${p.protections.join(', ')})` : ''}`
        );
      }
    }
  } else {
    lignes.push(
      '',
      'AUCUNE MESURE DE RAPPROCHEMENT n’a été lancée sur ce périmètre : ne conclus rien',
      'sur les distances entre barrages, et dis-le si cela manque à ton analyse.'
    );
  }

  lignes.push(
    '',
    'En dix lignes au maximum, et en français :',
    '1. ce que ce dispositif dit de la couverture du périmètre ;',
    mesure
      ? '2. les postes qu’il paraît raisonnable de retirer, et pourquoi ;'
      : '2. ce qu’il faudrait mesurer ou vérifier en priorité ;',
    '3. ce qu’il faudrait contrôler sur le terrain avant de décider.',
    'N’invente aucun chiffre qui ne figure pas ci-dessus.'
  );

  return lignes.join('\n');
}

/**
 * @param {object} config
 * @param {string} [config.n8n]     URL complète du webhook (ex. http://192.168.0.6:5678/webhook/carte-optimisation)
 * @param {string} [config.ollama]  racine d'Ollama (ex. http://192.168.0.6:11434)
 * @param {string} [config.modele]  modèle Ollama (ex. llama3.1)
 * @param {number} [config.delaiMs]
 */
export function creerAssistant({ n8n = '', ollama = '', modele = 'llama3.1', delaiMs = DELAI_MS } = {}) {
  const urlN8n = String(n8n || '').trim();
  const urlOllama = String(ollama || '').trim().replace(/\/+$/, '');

  return {
    /** Ce que le navigateur a besoin de savoir : y a-t-il un assistant, et lequel. */
    etat: () => ({
      disponible: Boolean(urlN8n || urlOllama),
      n8n: Boolean(urlN8n),
      ollama: Boolean(urlOllama),
      modele: urlOllama ? modele : null,
    }),

    /**
     * Envoie le résumé et rapporte `{texte, source}`.
     *
     * n8n d'abord s'il est configuré. S'il échoue et qu'Ollama l'est aussi, on
     * bascule — un workflow arrêté ne doit pas priver l'utilisateur de l'analyse
     * quand le modèle, lui, répond. La bascule est dite dans la réponse.
     */
    async analyser(resume) {
      if (!urlN8n && !urlOllama) {
        const err = new Error(
          "Aucun assistant configuré : renseignez --n8n <url du webhook> ou --ollama <url> au démarrage du serveur."
        );
        err.statut = 503;
        throw err;
      }

      const echecs = [];
      /* Vrai quand un service n'a pas répondu du tout — voir plus bas. */
      let injoignable = false;

      if (urlN8n) {
        try {
          const donnees = await poster(urlN8n, { source: 'carte-gendarmerie', resume }, delaiMs);
          const texte = extraireTexte(donnees);
          if (texte) return { texte: texte.slice(0, MAX_TEXTE), source: 'n8n' };
          echecs.push(`n8n a répondu sans texte exploitable (${JSON.stringify(donnees).slice(0, 200)})`);
        } catch (err) {
          echecs.push(`n8n : ${err.message}`);
          injoignable = err.injoignable === true;
        }
      }

      /**
       * NE PAS ATTENDRE DEUX FOIS LA MÊME MACHINE.
       *
       * n8n et Ollama vivent en général sur le même serveur. Quand le premier
       * n'a pas répondu du tout — hôte injoignable, pas erreur applicative —
       * interroger le second sur cette même machine ajoute une minute
       * d'attente pour rien : deux minutes de sablier avant un message que
       * l'on connaissait déjà au bout de la première.
       *
       * Hôtes différents, en revanche, la bascule garde tout son sens : c'est
       * précisément le cas où l'autre service peut, lui, répondre.
       */
      const memeHote = (() => {
        try {
          /* `hostname` et non `host` : ces deux services sont sur des PORTS
             différents de la même machine (5678 et 11434). Comparer `host`
             les aurait toujours crus distincts, et la garde n'aurait jamais
             servi — c'est exactement le cas qu'elle vise. */
          return new URL(urlN8n).hostname === new URL(urlOllama).hostname;
        } catch {
          return false;
        }
      })();

      if (urlOllama && injoignable && memeHote) {
        const err = new Error(
          `${echecs.join(' — ')} — Ollama est sur la même machine, non interrogé.`
        );
        err.statut = 504;
        throw err;
      }

      if (urlOllama) {
        try {
          const donnees = await poster(
            `${urlOllama}/api/generate`,
            { model: modele, prompt: prompt(resume), stream: false },
            delaiMs
          );
          const texte = extraireTexte(donnees);
          if (texte) {
            return {
              texte: texte.slice(0, MAX_TEXTE),
              source: urlN8n ? 'ollama (n8n indisponible)' : 'ollama',
              modele,
            };
          }
          echecs.push('Ollama a répondu sans texte.');
        } catch (err) {
          echecs.push(`Ollama : ${err.message}`);
        }
      }

      const err = new Error(echecs.join(' — '));
      err.statut = 502;
      throw err;
    },
  };
}
