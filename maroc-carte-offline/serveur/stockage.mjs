/**
 * Stockage du serveur : fichiers JSON dans un dossier NON servi (`etat/`, ou $ETAT), écrits de
 * façon atomique (fichier temporaire puis renommage), et un journal d'audit en ajout seul
 * (journal.jsonl). Les opérations qui modifient l'état passent une à une (verrou).
 */
import { mkdir, readFile, rename, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

export class Stockage {
  constructor(dossier) {
    this.dossier = dossier;
    this._file = Promise.resolve();
    this._cache = new Map();
  }

  async _pret() {
    await mkdir(this.dossier, { recursive: true });
  }

  /**
   * Contenu d'un fichier JSON, relu seulement s'il a changé (chaque requête, tuiles comprises,
   * vérifie la session). Le résultat est partagé : ne pas le modifier (les règles sont pures).
   */
  async lire(nom, defaut) {
    const fichier = path.join(this.dossier, `${nom}.json`);
    try {
      const s = await stat(fichier);
      const cle = `${s.size}-${s.mtimeMs}`;
      const connu = this._cache.get(nom);
      if (connu?.cle === cle) return connu.valeur;
      const valeur = JSON.parse(await readFile(fichier, 'utf8'));
      this._cache.set(nom, { cle, valeur });
      return valeur;
    } catch (erreur) {
      if (erreur.code === 'ENOENT') return structuredClone(defaut);
      throw new Error(`${nom}.json illisible : ${erreur.message}`);
    }
  }

  async ecrire(nom, valeur) {
    await this._pret();
    const fichier = path.join(this.dossier, `${nom}.json`);
    const temporaire = `${fichier}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaire, JSON.stringify(valeur, null, 1), 'utf8');
    await rename(temporaire, fichier);
  }

  /** Journal d'audit : une ligne JSON par événement, jamais réécrite. */
  async journaliser(evenements) {
    if (!evenements.length) return;
    await this._pret();
    await appendFile(path.join(this.dossier, 'journal.jsonl'), evenements.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  }

  async lireJournal() {
    try {
      return (await readFile(path.join(this.dossier, 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (erreur) {
      if (erreur.code === 'ENOENT') return [];
      throw erreur;
    }
  }

  /** Exécute `fn` seul (lecture, décision, écriture) : pas de mises à jour entremêlées. */
  verrou(fn) {
    const suite = this._file.then(fn, fn);
    this._file = suite.catch(() => {});
    return suite;
  }
}
