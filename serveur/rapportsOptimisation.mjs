/**
 * RAPPORTS D'OPTIMISATION — ce qui a été fait, par qui, sur quels critères.
 *
 * Une optimisation appliquée modifie le dispositif de dizaines de postes d'un
 * seul geste. Le journal des écritures (`serveur/journal.mjs`) en garde bien la
 * trace, mais ligne à ligne : il dit « ce barrage a changé d'état », jamais
 * « le 22/09/2026, le commandement est passé de 120 à 98 barrages, pour telle
 * couverture et tels critères ». C'est cette seconde phrase qui manque quand
 * on demande, six mois plus tard, pourquoi le maillage a maigri.
 *
 * Un rapport est donc écrit À L'APPLICATION, et jamais au calcul : simuler
 * n'engage rien, et remplir un historique de simulations abandonnées le
 * rendrait illisible.
 *
 * IL EST FIGÉ. Les chiffres, les critères, les poids et la liste des postes
 * sont recopiés au moment où la décision est prise, et non relus plus tard :
 * relancer l'optimisation six mois après donnerait d'autres nombres, et le
 * rapport ne raconterait plus la décision qui a été prise.
 *
 * Même dispositif d'écriture que les autres dépôts du projet : un seul fichier
 * JSON, écriture atomique (tmp + rename), copie datée du jour avant la première
 * écriture.
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

const JOURS_CONSERVES = 30;
/** Au-delà, les plus anciens sortent : un historique, pas une archive infinie. */
const MAX_RAPPORTS = 500;

const estValide = (r) => r && typeof r.id === 'string' && typeof r.date === 'string';

const nouvelId = () => `opt_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;

export function creerDepotRapportsOptimisation(fichier) {
  let items = [];

  if (existsSync(fichier)) {
    try {
      const brut = JSON.parse(readFileSync(fichier, 'utf8'));
      items = (brut.items ?? []).filter(estValide);
    } catch (err) {
      throw new Error(`Dépôt des rapports d'optimisation illisible (${fichier}) : ${err.message}`);
    }
  }

  const sauvegarder = () => {
    if (!existsSync(fichier)) return;
    const dossier = join(dirname(resolve(fichier)), 'sauvegardes');
    mkdirSync(dossier, { recursive: true });
    const jour = new Date().toISOString().slice(0, 10);
    const copie = join(dossier, `rapports-optimisation-${jour}.json`);
    if (existsSync(copie)) return;
    try {
      copyFileSync(fichier, copie);
      const anciennes = readdirSync(dossier)
        .filter((f) => /^rapports-optimisation-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of anciennes.slice(0, Math.max(0, anciennes.length - JOURS_CONSERVES))) {
        rmSync(join(dossier, f), { force: true });
      }
    } catch {
      /* Une sauvegarde impossible ne doit jamais empêcher d'écrire. */
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
    parId: (id) => items.find((r) => r.id === id) ?? null,

    /**
     * Consigne une optimisation appliquée.
     *
     * `barrages` porte, pour chaque poste retiré, ce qui a motivé SA décision —
     * score, redondance, distance au voisin qui reprend sa zone. C'est ce qui
     * permet de répondre « pourquoi celui-là ? » sans relancer aucun calcul.
     */
    creer({
      auteur,
      perimetre = null,
      parametres = null,
      poids = null,
      criteres = [],
      avant = null,
      apres = null,
      analyses = null,
      proposes = null,
      retires = 0,
      proteges = 0,
      couvertureAvant = null,
      couvertureApres = null,
      barrages = [],
      refuses = [],
    }) {
      const rapport = {
        id: nouvelId(),
        /* Numéro lisible, dans l'ordre d'écriture : « OPTIMISATION #001 ». */
        numero: items.length + 1,
        date: new Date().toISOString(),
        mode: 'AUTOMATIQUE',
        auteur,
        perimetre,
        parametres,
        poids,
        criteres,
        avant,
        apres,
        analyses,
        proposes,
        retires,
        proteges,
        couvertureAvant,
        couvertureApres,
        barrages,
        refuses,
      };
      items.push(rapport);
      if (items.length > MAX_RAPPORTS) items = items.slice(items.length - MAX_RAPPORTS);
      ecrire();
      return rapport;
    },

    /**
     * UNE RESTAURATION EST UNE OPÉRATION D'OPTIMISATION, ELLE AUSSI.
     *
     * Elle était déjà au journal des écritures et dans la notification ; elle
     * manquait ICI, c'est-à-dire à l'endroit où l'on vient lire ce que
     * l'optimisation a fait. Un poste revenu en service sans ligne dans cet
     * historique donnait un compte faux : le rapport disait « 12 retirés » et
     * plus rien ne disait que trois étaient revenus.
     *
     * Elle porte le rapport d'origine (`rapportId`) quand on le retrouve : la
     * restauration se lit alors à côté du retrait qu'elle défait.
     */
    consignerRestauration({ auteur, barrage, motif = 'restauration', rapportId = null }) {
      const trace = {
        id: nouvelId(),
        numero: items.length + 1,
        date: new Date().toISOString(),
        mode: 'RESTAURATION',
        auteur,
        motif,
        rapportId,
        perimetre: { niveau: 'barrage', unite: barrage?.reg ?? null },
        avant: null,
        apres: null,
        analyses: null,
        proposes: null,
        retires: 0,
        proteges: null,
        couvertureAvant: null,
        couvertureApres: null,
        criteres: [],
        barrages: [
          {
            id: barrage?.id,
            nom: barrage?.nom || '',
            route: barrage?.route || '',
            bt: barrage?.bt ?? null,
            cie: barrage?.cie ?? null,
            reg: barrage?.reg ?? null,
            action: 'RESTAURATION',
            raison: motif,
          },
        ],
        refuses: [],
      };
      items.push(trace);
      if (items.length > MAX_RAPPORTS) items = items.slice(items.length - MAX_RAPPORTS);
      ecrire();
      return trace;
    },

    supprimer(id) {
      const i = items.findIndex((r) => r.id === id);
      if (i < 0) return false;
      items.splice(i, 1);
      ecrire();
      return true;
    },
  };
}
