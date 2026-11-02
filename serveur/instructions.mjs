/**
 * NOTIFICATIONS ADRESSÉES AU COMMANDEMENT, à propos d'un barrage précis.
 *
 * Ce dépôt s'appelait « instructions » et ne portait qu'un cas : un message de
 * l'administrateur à l'unité concernée, que celle-ci marquait traité. Il porte
 * désormais tout ce qui doit remonter à un commandant de région ou de
 * compagnie :
 *
 *   `instruction`     — le cas d'origine, un ordre écrit sur un barrage ;
 *   `suppression`     — le Super Admin propose de retirer ce poste ;
 *   `conservation`    — le Super Admin propose de le maintenir malgré un
 *                       rapprochement ;
 *   `nouveau_barrage` — une unité vient d'en poser un sur le terrain.
 *
 * Un SECOND système aurait été plus simple à écrire et pire à vivre : deux
 * fichiers, deux formats de date, deux endroits où chercher pourquoi un
 * barrage a disparu. Le destinataire, la copie figée du barrage, le statut, la
 * réponse écrite — tout était déjà là. Seuls manquaient l'action, la décision
 * du commandant et les critères du calcul.
 *
 * LA DÉCISION DU COMMANDANT FAIT AUTORITÉ. Une proposition de suppression
 * n'efface rien tant qu'elle n'est pas acceptée : c'est l'acceptation qui
 * déclenche le retrait réel (voir PATCH /api/instructions/:id dans
 * serveur/api.mjs), et le refus qui rend le poste à son état d'avant.
 *
 * Le barrage visé est capturé (`nom`, `route`, `cie`, `bt`, `reg`) au moment
 * de l'instruction plutôt que relu à chaque fois : si le barrage est ensuite
 * déplacé ou supprimé, l'instruction reste lisible et gardée pour l'unité à
 * qui elle s'adressait à l'origine — l'historique d'une décision de commandement
 * ne doit pas disparaître avec son objet.
 *
 * Même principe que `serveur/regles.mjs` : un seul fichier JSON, écriture
 * atomique (tmp + rename), le serveur est la seule source de vérité.
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';

const MAX_TEXTE = 500;
const MAX_REPONSE = 300;

/**
 * Ce qui a provoqué la notification. `instruction` : le cas d'origine.
 *
 *   `modification` — une unité demande à changer la fiche d'un barrage. Rien
 *                    n'est appliqué tant que l'administration n'a pas confirmé :
 *                    la demande porte l'ancienne ET la nouvelle valeur, et
 *                    c'est l'acceptation qui écrit (voir PATCH
 *                    /api/instructions/:id dans serveur/api.mjs).
 *   `reclamation`  — un chef de région conteste une modification DÉJÀ
 *                    confirmée. Elle ne défait rien : elle ouvre un dossier
 *                    qui pointe la modification par `modificationId`.
 */
/**
 *   `retrait_optimisation` — l'optimisation AUTOMATIQUE a sorti ce poste du
 *                            service (`statutBarrage: 'retire_optimisation'`).
 *                            Rien n'est effacé et tout est réversible : le
 *                            commandement confirme, ou refuse — et le refus
 *                            rend le poste exactement à son état d'avant (voir
 *                            PATCH /api/instructions/:id).
 *   `assignation`  — le Super Admin remet ce barrage au CMND Région qui le
 *                    porte, pour traitement. Rien n'est écrit sur le barrage :
 *                    le commandement le traite avec ses propres droits, puis
 *                    accuse réception (POST /api/barrages/assigner).
 */
const ACTIONS = [
  'instruction',
  'suppression',
  'conservation',
  'nouveau_barrage',
  'modification',
  'reclamation',
  'retrait_optimisation',
  'assignation',
];

/** Ce que le commandant en a fait. `null` tant qu'il n'a pas tranché. */
const DECISIONS = ['acceptee', 'refusee', 'transmise'];

const estValide = (i) => i && typeof i.id === 'string' && typeof i.texte === 'string';

const nouvelId = () => `ins_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;

const texte = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function creerDepotInstructions(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des instructions illisible (${fichier}) : ${err.message}`);
    }
  }

  /**
   * COPIE DATÉE DU JOUR, prise avant la première écriture — même dispositif
   * que le dépôt des marquages (voir `sauvegarder` dans serveur/depot.mjs).
   *
   * Ce dépôt n'en avait pas, et il a suffi d'une manipulation pour effacer des
   * instructions réelles sans aucun moyen de revenir en arrière : ni copie
   * quotidienne ici, ni trace dans `journal.jsonl`, qui ne suit que les
   * marquages. Ce qui menace ces données n'est pas la panne — l'écriture est
   * atomique — mais le geste humain.
   */
  const JOURS_CONSERVES = 30;

  const sauvegarder = () => {
    if (!existsSync(fichier)) return;
    const dossier = join(dirname(resolve(fichier)), 'sauvegardes');
    mkdirSync(dossier, { recursive: true });
    const jour = new Date().toISOString().slice(0, 10);
    const copie = join(dossier, `instructions-${jour}.json`);
    if (existsSync(copie)) return; // déjà faite aujourd'hui

    try {
      copyFileSync(fichier, copie);
      const anciennes = readdirSync(dossier)
        .filter((f) => /^instructions-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of anciennes.slice(0, Math.max(0, anciennes.length - JOURS_CONSERVES))) {
        rmSync(join(dossier, f), { force: true });
      }
    } catch {
      /* Une sauvegarde impossible ne doit jamais empêcher d'écrire : mieux
         vaut la donnée à jour sans copie que l'inverse. */
    }
  };

  const ecrire = () => {
    sauvegarder();
    mkdirSync(dirname(resolve(fichier)), { recursive: true });
    const tmp = `${fichier}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2));
    renameSync(tmp, fichier);
  };

  return {
    tous: () => items,
    parId: (id) => items.find((i) => i.id === id) ?? null,

    creer({
      barrageId,
      barrage,
      texte: msg,
      auteur,
      action = 'instruction',
      criteres = null,
      source = null,
      /**
       * CE QUE LA DEMANDE CHANGERAIT — `[{champ, ancienne, nouvelle}]`.
       *
       * L'ancienne valeur est figée ici, au moment de la demande, et non relue
       * au moment de la confirmation : entre les deux, quelqu'un a pu corriger
       * la fiche. Le validateur doit voir ce sur quoi l'auteur s'est prononcé,
       * et le serveur refuse d'appliquer une demande dont l'état de départ
       * n'existe plus (voir `appliquerModification`).
       */
      changements = null,
      /** La modification contestée, pour une réclamation. */
      modificationId = null,
      /** Pourquoi l'auteur demande ou conteste. */
      motif = '',
      /**
       * QUI DOIT TRANCHER — 'admin', 'unite', ou null quand personne n'a de
       * décision à rendre (une instruction s'accuse réception).
       *
       * Un signalement de nouveau barrage part vers l'échelon qui ne l'a pas
       * posé : une unité pose, l'administrateur approuve ; l'administrateur
       * pose, l'unité en est informée. Sans ce champ, le panneau offrirait la
       * décision à celui qui vient de la prendre.
       */
      aDecider = null,
      /**
       * L'INTOUCHABLE QUE CETTE DEMANDE REMPLACE — son identifiant, ou null.
       *
       * Une compagnie n'a qu'un intouchable. Quand une modification en fait un
       * nouveau, l'auteur a confirmé que l'ancien perdait sa protection ; cette
       * confirmation est gardée ici pour que l'acceptation applique les DEUX
       * changements ensemble (voir PATCH /api/instructions/:id).
       */
      remplacerIntouchable = null,
      /**
       * À QUI EST ADRESSÉE UNE ASSIGNATION — `{rang, unite, matricule?}` : le
       * CMND Région (assignée par le Super Admin) ou un CMND Cie (transmise
       * par sa région). `parentId` : l'assignation dont celle-ci est la suite.
       */
      destinataire = null,
      parentId = null,
    }) {
      const instruction = {
        id: nouvelId(),
        barrageId,
        /* COPIE FIGÉE du barrage, et non une relecture à chaque affichage :
           une notification de suppression doit rester lisible APRÈS que le
           barrage a été effacé — c'est même son cas le plus utile. */
        barrage: {
          nom: barrage.nom || '',
          route: barrage.route || '',
          type: barrage.type,
          lng: barrage.lng ?? null,
          lat: barrage.lat ?? null,
          bt: barrage.bt ?? null,
          cie: barrage.cie ?? null,
          reg: barrage.reg ?? null,
        },
        action: ACTIONS.includes(action) ? action : 'instruction',
        /* Ce que le calcul disait au moment de la décision : distance, voisin,
           et les critères qui étaient activés. Figé pour la même raison que le
           barrage — relancer l'optimisation plus tard donnerait d'autres
           chiffres, et la notification ne raconterait plus la décision prise. */
        criteres: criteres ?? null,
        source: typeof source === 'string' ? source.slice(0, 40) : null,
        /* Nuls pour les natures qui n'en ont pas : un champ absent dirait la
           même chose, mais une forme constante se lit et se teste mieux. */
        changements: Array.isArray(changements) ? changements : null,
        modificationId: typeof modificationId === 'string' ? modificationId : null,
        motif: texte(motif, MAX_TEXTE),
        aDecider: aDecider === 'admin' || aDecider === 'unite' ? aDecider : null,
        remplacerIntouchable: typeof remplacerIntouchable === 'string' ? remplacerIntouchable : null,
        destinataire: destinataire && typeof destinataire.rang === 'string' && typeof destinataire.unite === 'string'
          ? { rang: destinataire.rang, unite: destinataire.unite, matricule: destinataire.matricule ?? null, nom: destinataire.nom ?? null }
          : null,
        parentId: typeof parentId === 'string' ? parentId : null,
        texte: texte(msg, MAX_TEXTE),
        statut: 'ouverte', // ouverte | traitee
        auteur, // {rang, unite, matricule, nom} — qui a déclenché
        traiteePar: null,
        /** 'acceptee' | 'refusee' | null — la décision du commandant. */
        decision: null,
        reponse: '', // le commentaire qui l'explique
        cree: new Date().toISOString(),
        traiteeLe: null,
      };
      items.push(instruction);
      ecrire();
      return instruction;
    },

    /**
     * Le commandant tranche : accepte ou refuse, et dit pourquoi.
     *
     * `decision` absente = le cas d'origine (l'unité marque un ordre traité),
     * conservé tel quel pour ne pas casser les instructions déjà en base.
     */
    traiter(id, { traiteePar, reponse, decision = null }) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return null;
      items[i] = {
        ...items[i],
        statut: 'traitee',
        traiteePar,
        decision: DECISIONS.includes(decision) ? decision : null,
        reponse: texte(reponse, MAX_REPONSE),
        traiteeLe: new Date().toISOString(),
      };
      ecrire();
      return items[i];
    },

    /** Rouvre une instruction déjà traitée — l'administrateur n'est pas satisfait de la réponse. */
    rouvrir(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return null;
      items[i] = { ...items[i], statut: 'ouverte', traiteePar: null, decision: null, traiteeLe: null };
      ecrire();
      return items[i];
    },

    /**
     * Remplace le contenu en une écriture — la restauration de la référence de
     * présentation (voir serveur/presentation.mjs), et elle seule.
     */
    restaurerLot(liste) {
      items = liste;
      ecrire();
      return items;
    },

    /** Toutes les notifications encore ouvertes visant CE barrage. */
    ouvertesPour: (barrageId) => items.filter((i) => i.barrageId === barrageId && i.statut === 'ouverte'),

    supprimer(id) {
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      ecrire();
      return true;
    },
  };
}
