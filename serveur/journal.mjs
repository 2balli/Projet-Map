/**
 * Journal des écritures — qui a fait quoi, quand, et sur quoi.
 *
 * Format JSONL : une ligne = un événement, ajoutée en fin de fichier. Le choix
 * n'est pas cosmétique — un JSON classique demanderait de relire et réécrire
 * tout le fichier à chaque écriture, et une coupure au mauvais moment le
 * détruirait. Ici, une ligne interrompue ne coûte que cette ligne, et l'ajout
 * reste constant quelle que soit la taille du journal.
 *
 * Le journal est APPEND-ONLY : rien n'est jamais modifié ni supprimé. C'est ce
 * qui en fait une trace opposable — un registre qu'on peut corriger n'atteste
 * plus rien.
 *
 * Chaque entrée garde l'état AVANT et APRÈS : on sait donc non seulement que le
 * repère a bougé, mais d'où il venait — de quoi revenir en arrière.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Champs retenus dans la trace : le reste est du bruit à la relecture. */
const RETENUS = [
  'id',
  'type',
  'nom',
  'route',
  'note',
  'cause',
  'sousType',
  'partage',
  'accidentCount',
  'gravite',
  'debut',
  'fin',
  'lng',
  'lat',
  'pk',
  'bt',
  'cie',
  'reg',
  'protection',
  'intouchable',
  'factionId',
];

const extrait = (m) => {
  if (!m) return null;
  const out = {};
  for (const c of RETENUS) if (m[c] !== undefined) out[c] = m[c];
  return out;
};

/**
 * Ce qui a réellement changé entre deux états.
 *
 * Journaliser l'objet entier rendrait la relecture pénible : sur une
 * modification de nom, il faudrait comparer trente champs à l'œil. On garde
 * donc le détail des seuls champs touchés — le reste est reconstituable.
 */
function differences(avant, apres) {
  if (!avant || !apres) return null;
  const diff = {};
  for (const c of RETENUS) {
    if (JSON.stringify(avant[c]) !== JSON.stringify(apres[c])) {
      diff[c] = { de: avant[c] ?? null, vers: apres[c] ?? null };
    }
  }
  return Object.keys(diff).length ? diff : null;
}

export function creerJournal(fichier) {
  mkdirSync(dirname(resolve(fichier)), { recursive: true });

  return {
    /**
     * Consigne une écriture. N'échoue JAMAIS bruyamment : un journal
     * indisponible ne doit pas empêcher un chef de travailler — mais l'anomalie
     * est signalée sur la sortie du serveur pour qu'elle ne passe pas inaperçue.
     */
    consigner({ session, action, avant, apres, details = null }) {
      const entree = {
        ts: new Date().toISOString(),
        matricule: session?.matricule ?? null,
        nom: session?.nom ?? null,
        role: session?.role ?? null,
        unite: session?.unite ?? null,
        rang: session?.rang ?? null,
        action, // creer | modifier | deplacer | supprimer | connexion | echec
        id: apres?.id ?? avant?.id ?? null,
        libelle: apres?.nom || avant?.nom || null,
        avant: action === 'creer' ? null : extrait(avant),
        apres: action === 'supprimer' ? null : extrait(apres),
        change: differences(avant, apres),
        ...(details ? { details } : {}),
      };

      try {
        appendFileSync(fichier, JSON.stringify(entree) + '\n');
      } catch (err) {
        console.error(`  ! journal non écrit (${err.message})`);
      }
      return entree;
    },

    /**
     * Dernières entrées, les plus récentes d'abord.
     *
     * Le fichier est lu par la fin : un journal de plusieurs mois n'a pas à être
     * parcouru en entier pour afficher les vingt dernières lignes.
     */
    dernieres(limite = 50, filtre = null) {
      if (!existsSync(fichier)) return [];

      let texte;
      try {
        texte = readFileSync(fichier, 'utf8');
      } catch {
        return [];
      }

      const lignes = texte.split('\n');
      const out = [];

      for (let i = lignes.length - 1; i >= 0 && out.length < limite; i--) {
        const l = lignes[i].trim();
        if (!l) continue;
        try {
          const e = JSON.parse(l);
          if (!filtre || filtre(e)) out.push(e);
        } catch {
          /* ligne tronquée par une coupure : ignorée, jamais devinée */
        }
      }
      return out;
    },

    taille: () => (existsSync(fichier) ? statSync(fichier).size : 0),
  };
}
