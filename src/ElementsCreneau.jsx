/**
 * SAISIE TERRAIN — LE ROSTER D'UNE BRIGADE, PRÉPARÉ D'AVANCE.
 *
 * Le parcours, et rien d'autre :
 *
 *   1. choisir la brigade
 *   2. lire le créneau en cours (il s'affiche seul)
 *   3. parcourir ses barrages — le personnel y est DÉJÀ réparti
 *   4. corriger ce qui a changé : retirer un absent, ajouter un remplaçant
 *
 * CE QUI A CHANGÉ, ET POURQUOI
 * ----------------------------
 * La première version demandait de choisir UN barrage, puis de taper grade, nom
 * et matricule pour chaque homme, quatre fois par jour. `elements.json`
 * n'existait toujours pas après des jours d'exploitation : personne ne s'y était
 * mis. Le coût de saisie condamnait la fonction.
 *
 * Désormais le serveur prépare la journée LA VEILLE (voir serveur/roster.mjs) :
 * chaque brigade trouve ses postes déjà pourvus, du plus gradé au moins gradé,
 * avec rotation entre les quatre créneaux. Il ne reste qu'à corriger l'écart
 * entre le prévu et le réel — le travail d'un chef, pas de la dactylographie.
 *
 * UN SEUL APPEL POUR TOUT L'ÉCRAN : `/api/roster?bt=…` rend l'effectif, les
 * barrages, la composition attendue et les personnes déjà placées. Une requête
 * par barrage aurait multiplié les allers-retours pour un écran qui se lit d'un
 * bloc.
 *
 * AJOUTER SE FAIT DEPUIS L'EFFECTIF, pas au clavier : on choisit un nom dans la
 * liste de la brigade, et grade et matricule suivent. Ni faute de frappe, ni
 * grade inventé, ni personne placée à deux endroits — la liste ne propose que
 * des gens libres, et le serveur refuse de toute façon (voir `creer` dans
 * serveur/elements.mjs).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  IconPlus,
  IconClose,
  IconSpinner,
  IconHoraire,
  IconCible,
} from './icons.jsx';
import * as API from './api.js';
import * as MQ from './marquages.js';
import UniteSelect from './UniteSelect.jsx';
import { Recap, Note } from './Parcours.jsx';

/**
 * LES QUATRE GRADES, du moins élevé au plus élevé — abréviations officielles :
 * MDLG (maréchal des logis gendarme), MDLC (maréchal des logis-chef),
 * ADJT (adjudant), A/C (adjudant-chef).
 *
 * Liste fermée, jamais de champ libre. Le serveur refuse toute autre valeur
 * (voir `GRADES` dans serveur/elements.mjs, la liste qui fait autorité).
 * L'ORDRE COMPTE : il sert à ranger les hommes du plus gradé au moins gradé.
 */
export const GRADES = ['MDLG', 'MDLC', 'ADJT', 'A/C'];

/** Heures de début des quatre créneaux — voir serveur/elements.mjs. */
const CRENEAUX = [0, 6, 12, 18];

const deuxChiffres = (n) => String(n).padStart(2, '0');

/** « 06:00 → 12:00 ». Le dernier créneau se ferme à minuit, pas à 24:00. */
const libelleCreneau = (c) => `${deuxChiffres(c)}:00 → ${deuxChiffres((c + 6) % 24)}:00`;

/** Créneau qui contient cette heure : 0, 6, 12 ou 18. */
const creneauDe = (d) => CRENEAUX[Math.floor(d.getHours() / 6)];

/** `AAAA-MM-JJ` en heure LOCALE — `toISOString()` aurait changé de jour le soir. */
const dateLocale = (d) =>
  `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())}`;


/** `2026-08-28` -> `28/08/2026`. */
const dateFr = (iso) =>
  String(iso ?? '')
    .split('-')
    .reverse()
    .join('/');

/* Mêmes styles que le reste du panneau de saisie. Recopiés plutôt qu'importés
   de MarquagePanel.jsx : c'est lui qui rend ce composant, l'importer en retour
   créerait un cycle. */
const champ =
  'w-full rounded-lg border border-white/12 bg-white/6 px-2 py-1.5 text-[12px] text-white ' +
  'placeholder:text-white/30 focus:border-gr-gold/60 focus:outline-none';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

/** La brigade choisie survit à la fermeture du panneau et au rechargement. */
const CLE_BRIGADE = 'gr-saisie-brigade';

/* ------------------------------------------------------------------ */
/* Briques                                                            */
/* ------------------------------------------------------------------ */

/** Une personne sur un poste : grade, nom, matricule, et le retrait. */
/**
 * `rang` — la place de l'homme dans l'équipe du poste (1, 2, 3).
 *
 * Numéroter n'est pas décoratif : la règle veut exactement trois hommes, et un
 * chiffre en tête de ligne fait voir le compte sans le faire. Une liste qui
 * s'arrête à ② se remarque, là où trois lignes identiques se comptent.
 */
function Ligne({ element, onRetirer, occupe, rang = null }) {
  return (
    <li className="flex items-center gap-1.5 rounded-lg bg-white/6 px-1.5 py-1">
      {rang != null && (
        <span
          aria-hidden
          className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-white/35"
        >
          {rang}
        </span>
      )}
      <span className="w-11 shrink-0 rounded-md bg-gr-gold/20 py-0.5 text-center text-[10px] font-bold text-gr-gold">
        {element.grade}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/90">
        {element.nom}
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/45">
        {element.matricule || '—'}
      </span>
      {onRetirer && (
        <button
          type="button"
          onClick={onRetirer}
          disabled={occupe}
          aria-label={`Retirer ${element.nom}`}
          title={`Retirer ${element.nom} de ce poste`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-white/40
            transition-colors duration-150 hover:bg-white/12 hover:text-white
            disabled:opacity-40 motion-reduce:transition-none"
        >
          <IconClose size={12} />
        </button>
      )}
    </li>
  );
}

/**
 * Ajout d'une personne SUR UN POSTE, choisie dans l'effectif de la brigade.
 *
 * Un `select` et non un champ libre : le grade et le matricule viennent de la
 * fiche de la personne, donc ni faute de frappe ni grade inventé. Les gens déjà
 * placés ailleurs sur ce créneau n'y figurent pas — on ne propose pas quelqu'un
 * qui n'est pas libre.
 */
/**
 * @param {boolean} complet Le poste tient déjà ses trois hommes.
 *   Le bouton est alors éteint : le serveur refuserait l'ajout (voir
 *   `ELEMENTS_PAR_BARRAGE`), et proposer un geste voué au refus est une
 *   promesse qu'on ne tient pas. Le motif est écrit dans l'infobulle — un
 *   bouton grisé sans explication se lit comme une panne.
 */
function AjouterPersonne({ libres, onAjouter, occupe, total = 0, complet = false }) {
  const [ouvert, setOuvert] = useState(false);
  const [choix, setChoix] = useState('');

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        disabled={occupe || !libres.length || complet}
        title={
          complet
            ? `Poste complet : un barrage est tenu par exactement ${MQ.ELEMENTS_PAR_BARRAGE} éléments. Retirez-en un pour en changer.`
            : libres.length
              ? undefined
              : total === 0
                ? 'Aucun effectif chargé pour cette brigade'
                : 'Toute la brigade est déjà placée sur ce créneau'
        }
        className={`${bouton} w-full bg-white/8 text-white/75 hover:bg-white/14 disabled:opacity-40`}
      >
        <IconPlus size={13} />
        {complet
          ? `Poste complet (${MQ.ELEMENTS_PAR_BARRAGE}/${MQ.ELEMENTS_PAR_BARRAGE})`
          : libres.length
          ? 'Ajouter depuis l’effectif'
          : total === 0
            ? 'Aucun effectif chargé'
            : 'Effectif entièrement placé'}
      </button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-white/12 bg-white/6 p-2">
      <select className={champ} value={choix} onChange={(e) => setChoix(e.target.value)} autoFocus>
        <option value="">— choisir dans l’effectif —</option>
        {libres.map((p) => (
          <option key={p.matricule} value={p.matricule}>
            {p.grade} · {p.nom} · {p.matricule}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setOuvert(false);
            setChoix('');
          }}
          className={`${bouton} flex-1 bg-white/10 text-white/80 hover:bg-white/16`}
        >
          Fermer
        </button>
        <button
          type="button"
          disabled={!choix || occupe}
          onClick={async () => {
            const p = libres.find((x) => x.matricule === choix);
            if (!p) return;
            await onAjouter(p);
            setChoix('');
          }}
          className={`${bouton} flex-1 bg-gr-gold text-gr-navy hover:brightness-110 disabled:opacity-40`}
        >
          {occupe ? <IconSpinner size={13} /> : <IconPlus size={13} />} Ajouter
        </button>
      </div>
    </div>
  );
}

/**
 * PRÉPARATION DE LA JOURNÉE — bandeau réservé à l'administrateur.
 *
 * Le serveur prépare seul, au démarrage puis toutes les heures (voir
 * `veillerAuRoster` dans serveur/api.mjs). Ce bandeau ne fait donc pas marcher
 * la fonction : il la REND VISIBLE, et permet de relancer la préparation après
 * une correction de `composition-barrage.json` ou un chargement d'effectif,
 * sans attendre le prochain battement ni redémarrer le service.
 *
 * Il dit surtout ce qui est prêt. Sans lui, l'administrateur n'aurait aucun
 * moyen de savoir si demain est couvert avant que demain arrive.
 */
function PreparationAdmin({ etat, relire }) {
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);

  if (!etat) return null;

  /**
   * Le compte rendu dit CE QUI EST, pas seulement ce qui vient d'être fait.
   *
   * « rien à ajouter » laissait croire à une panne alors que la journée était
   * déjà entièrement proposée. Un compte rendu qui ne chiffre pas l'existant
   * n'informe de rien.
   */
  const compteRendu = (r) => {
    const jour = dateFr(r.date);
    /**
     * On annonce des HOMMES, pas des lignes de manque.
     *
     * `manquesTotal` compte les entrées `{barrage, grade, nombre}` : « il
     * manque 3 MDLG ici » en est UNE. L'annoncer comme un nombre de postes
     * trompait sur l'ordre de grandeur autant que sur la nature du problème.
     *
     * Et l'on nomme les brigades : un total national ne se corrige pas, une
     * brigade qui tient trente-six barrages avec vingt hommes, si.
     */
    const ou = (r.manquesParBrigade ?? [])
      .slice(0, 3)
      .map((m) => `${m.bt} (${m.hommes})`)
      .join(', ');
    const manque = r.manquesTotalHommes
      ? ` Il manque ${r.manquesTotalHommes} homme(s) pour honorer la composition` +
        (ou ? `, surtout à ${ou}.` : '.')
      : '';

    if (r.remplacement) {
      const garde = r.remplacement.creneauxHumains
        ? ` ${r.remplacement.creneauxHumains} créneau(x) tenus par un chef ont été laissés intacts.`
        : '';
      return (
        `${jour} refaite : ${r.remplacement.retires} ligne(s) effacée(s), ` +
        `${r.ajoutes} reproposée(s) sur ${r.barrages} barrage(s) de ${r.brigades} brigade(s).` +
        garde +
        manque
      );
    }

    if (r.ajoutes === 0) {
      return (
        `${jour} : rien à compléter — les ${r.creneauxOccupes} créneau(x) de la journée sont ` +
        `déjà pourvus. Pour tenir compte d’une composition ou d’un effectif modifiés, ` +
        `refaites la préparation.`
      );
    }

    return (
      `${jour} : ${r.ajoutes} ligne(s) ajoutée(s) sur ${r.barrages} barrage(s) de ` +
      `${r.brigades} brigade(s).` +
      (r.creneauxOccupes ? ` ${r.creneauxOccupes} créneau(x) étaient déjà pourvus.` : '') +
      manque
    );
  };

  const preparer = async (remplacer = false) => {
    setOccupe(true);
    setMessage(null);
    try {
      setMessage(compteRendu(await API.preparerRoster(undefined, remplacer)));
      await relire();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="space-y-1.5 rounded-xl border border-white/12 bg-white/4 p-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">
        Préparation du roster
      </p>
      <p className="text-[10px] leading-snug text-white/55">
        Aujourd’hui {dateFr(etat.aujourdhui.date)} :{' '}
        <b className="tabular-nums text-white/85">{etat.aujourdhui.lignes}</b> ligne(s) · demain{' '}
        {dateFr(etat.demain.date)} :{' '}
        <b className={`tabular-nums ${etat.demain.lignes ? 'text-gr-green' : 'text-gr-red'}`}>
          {etat.demain.lignes}
        </b>{' '}
        ligne(s)
      </p>
      <p className="text-[10px] text-white/40">
        Effectif : {etat.effectif.total} personne(s), {etat.effectif.brigades} brigade(s)
        {etat.effectif.demo ? ' — de démonstration' : ''}
      </p>
      <button
        type="button"
        onClick={() => preparer(false)}
        disabled={occupe}
        title="Complète les créneaux vides de demain. Ne touche à rien de ce qui est déjà posé."
        className={`${bouton} w-full bg-white/8 text-white/75 hover:bg-white/14 disabled:opacity-40`}
      >
        {occupe ? <IconSpinner size={13} /> : <IconHoraire size={13} />}
        Préparer demain
      </button>

      {/* Refaire n'a de sens que s'il y a déjà quelque chose à refaire — et
          c'est une action qui efface : elle reste distincte, jamais le geste
          par défaut. Les créneaux où un chef est intervenu sont préservés. */}
      {etat.demain.lignes > 0 && (
        <button
          type="button"
          onClick={() => preparer(true)}
          disabled={occupe}
          title="Efface les lignes PROPOSÉES de demain et les recalcule — après une correction de la composition ou un chargement d’effectif. Les créneaux tenus par un chef ne sont pas touchés."
          className={`${bouton} w-full border border-white/12 text-white/50 hover:bg-white/8 disabled:opacity-40`}
        >
          Refaire la préparation de demain
        </button>
      )}
      {message && (
        <p className="rounded-lg bg-white/6 px-2 py-1 text-[10px] leading-snug text-white/70">
          {message}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panneau                                                            */
/* ------------------------------------------------------------------ */

/**
 * LE RELEVÉ D'EFFECTIF — un CROCHET qui rend des ÉTAPES, non un panneau.
 *
 * C'était un composant qui dessinait tout son écran. Il est devenu le
 * fournisseur d'étapes de la tâche « Relever l'effectif » du parcours de
 * SAISIE TERRAIN : `useEtapesEffectif` rend la liste des étapes, et le
 * parcours du parent les affiche une par une, sous SA barre d'avancement.
 *
 * Un second parcours imbriqué aurait donné deux barres d'avancement l'une dans
 * l'autre — illisible.
 *
 * `actif` : le roster n'est chargé que si la tâche est effectivement ouverte.
 * Le crochet, lui, s'exécute toujours (règle des crochets React), mais il ne
 * doit pas appeler le serveur pour une tâche que personne ne regarde.
 *
 * RIEN DES DONNÉES N'A CHANGÉ : mêmes appels, même autorité, même créneau
 * serveur. Tout ce qui suit jusqu'aux étapes est le code d'avant, intact.
 */
export function useEtapesEffectif({ session, items, onViser, demande, actif = true }) {
  /**
   * Les brigades atteignables — déduites des barrages que la session voit
   * déjà. Pas d'appel supplémentaire, et pas de brigade qu'on ne pourrait pas
   * ouvrir ensuite : la liste ne peut pas mentir.
   */
  const brigades = useMemo(() => {
    const noms = new Set();
    for (const m of items) {
      if (MQ.estBarrage(m) && m.bt) noms.add(m.bt);
    }
    return [...noms].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [items]);

  /**
   * Un chef de brigade n'a qu'une brigade : la sienne. Lui demander de la
   * choisir dans une liste d'un seul élément serait une politesse inutile.
   */
  const sienne = session?.rang === 'unite' && brigades.includes(session.unite) ? session.unite : '';

  const [bt, setBt] = useState(() => {
    try {
      return localStorage.getItem(CLE_BRIGADE) ?? '';
    } catch {
      return '';
    }
  });

  /**
   * QUELLES BRIGADES ONT UN EFFECTIF CHARGÉ.
   *
   * 391 brigades tiennent un barrage ; l'effectif n'est chargé que pour une
   * partie d'entre elles. Sans cette liste, le sélecteur les propose toutes à
   * égalité : on en choisit une au hasard, l'écran est vide, et la fonction
   * passe pour cassée alors qu'il ne manque qu'une donnée. Elle sert donc à
   * SÉPARER la liste en deux, pas à masquer quoi que ce soit — une brigade sans
   * effectif reste ouvrable, avec l'explication qui va avec.
   */
  const [etat, setEtat] = useState(null);
  const relireEtat = () =>
    API.etatRoster()
      .then(setEtat)
      .catch(() => setEtat(null));
  useEffect(() => {
    relireEtat();
  }, []);

  const [roster, setRoster] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);
  /* Les trois états de repli (autres créneaux, personnel, préparation) ont
     disparu avec les blocs pliables : ce sont des étapes du parcours. */

  /**
   * LE POSTE SEUL, quand on est venu pour lui.
   *
   * `null` = toute la brigade, comme avant. Renseigné, la disposition se
   * réduit à ce barrage : c'est la différence entre « qui tient ce poste »
   * et « où est tout le monde », et les deux questions ont leur écran.
   */
  const [posteCible, setPosteCible] = useState(null);

  /**
   * LIRE D'ABORD, CORRIGER SUR DEMANDE.
   *
   * La question posée cent fois par jour est « qui tient ce poste ? » ; la
   * correction est rare. Afficher d'emblée les croix de retrait et les
   * sélecteurs d'ajout encombrait la réponse de moyens d'agir dont on n'a pas
   * besoin, et invitait à la fausse manœuvre : on vient lire, on décoche.
   *
   * LA BASCULE « CONSULTER / MODIFIER » A DISPARU, remplacée par deux étapes
   * distinctes du parcours : « Qui est présent ? » puis « Corriger l'effectif ».
   * Deux états du même écran obligeaient à repérer lequel était actif en
   * cherchant quel bouton était doré ; deux étapes ne se confondent pas.
   *
   * Il reste à préserver UN raccourci : « Modifier l'effectif » depuis la bulle
   * d'un barrage ouvrait directement la correction. Ce compteur le signale au
   * parcours du parent, qui saute à l'étape de correction. Un compteur et non
   * un booléen : redemander la correction du même poste doit fonctionner.
   */
  const [correctionVoulue, setCorrectionVoulue] = useState(0);

  /**
   * L'heure du poste, rafraîchie chaque minute : c'est ce qui fait BASCULER le
   * créneau à 06:00, 12:00, 18:00 et minuit. Sans ce battement, un panneau
   * ouvert depuis la veille afficherait encore la relève de la veille.
   */
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const battement = setInterval(() => setMaintenant(new Date()), 60_000);
    return () => clearInterval(battement);
  }, []);

  const dateDuJour = dateLocale(maintenant);
  const creneauCourant = creneauDe(maintenant);

  /* La brigade retenue doit exister dans le périmètre courant. */
  const brigadeValide = (bt && brigades.includes(bt) && bt) || sienne;

  const choisirBrigade = (nom) => {
    setBt(nom);
    setErreur(null);
    setRoster(null);
    setPosteCible(null);
    try {
      if (nom) localStorage.setItem(CLE_BRIGADE, nom);
      else localStorage.removeItem(CLE_BRIGADE);
    } catch {
      /* stockage indisponible : le choix vaut pour cette session */
    }
  };

  /** Recharge le roster — après un choix de brigade, un ajout, un retrait. */
  const charger = async (nom, silencieux = false) => {
    if (!nom) {
      setRoster(null);
      return;
    }
    if (!silencieux) setChargement(true);
    try {
      const r = await API.chargerRoster(nom, dateLocale(new Date()));
      setRoster(r);
      setErreur(null);
    } catch (err) {
      setRoster(null);
      setErreur(err.message);
    } finally {
      if (!silencieux) setChargement(false);
    }
  };

  useEffect(() => {
    if (!actif) return;
    charger(brigadeValide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, brigadeValide, dateDuJour]);

  /**
   * OUVERT DEPUIS LA CARTE, SUR LA BONNE BRIGADE.
   *
   * Le bouton « Modifier l'effectif » d'une bulle amène ici ; sans cela il
   * faudrait rechercher dans le sélecteur la brigade que l'on vient de
   * quitter, ce qui annulerait le bénéfice du bouton.
   *
   * Déclenché par l'horodatage et non par le nom : redemander la même brigade
   * après en avoir consulté une autre doit fonctionner.
   */
  useEffect(() => {
    if (!demande?.bt) return;
    if (demande.bt !== bt) choisirBrigade(demande.bt);

    /**
     * VENU D'UN POSTE : on n'ouvre que ce poste.
     *
     * Cliquer « Modifier l'effectif » dans la bulle d'un barrage et se
     * retrouver devant les neuf postes de la brigade oblige à retrouver
     * celui qu'on venait de quitter — le bouton ne faisait que déplacer le
     * travail. La brigade entière reste à un clic.
     *
     * Et l'on passe en correction : le bouton s'appelle « Modifier ». Le
     * demander deux fois serait une formalité, pas une sécurité.
     */
    setPosteCible(demande.barrageId ?? null);
    if (demande.barrageId) setCorrectionVoulue((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demande?.ts]);

  /* ---- Ce qui est posé sur le créneau en cours, poste par poste ---- */

  const duCreneau = useMemo(() => {
    const par = new Map();
    for (const e of roster?.elements ?? []) {
      if (e.creneau !== creneauCourant) continue;
      if (!par.has(e.barrageId)) par.set(e.barrageId, []);
      par.get(e.barrageId).push(e);
    }
    /* Du plus gradé au moins gradé : la liste se lit comme un ordre de bataille. */
    for (const liste of par.values()) {
      liste.sort(
        (a, b) =>
          GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade) || a.nom.localeCompare(b.nom, 'fr'),
      );
    }
    return par;
  }, [roster, creneauCourant]);

  /**
   * OÙ SE TROUVE CHAQUE PERSONNE, sur ce créneau — par matricule.
   *
   * C'est la moitié de la réponse que doit donner une vue de brigade : la
   * liste du personnel ne vaut que si elle dit, en face de chaque nom, le
   * poste où il se trouve. Sans cela, il faut lire les neuf barrages et faire
   * la soustraction de tête.
   */
  const affectationDe = useMemo(() => {
    const par = new Map();
    for (const e of roster?.elements ?? []) {
      if (e.creneau !== creneauCourant) continue;
      par.set(e.matricule, e.barrageId);
    }
    return par;
  }, [roster, creneauCourant]);

  const nomDuPoste = useMemo(() => {
    const par = new Map();
    for (const b of roster?.barrages ?? []) par.set(b.id, b.nom || '(sans nom)');
    return par;
  }, [roster]);

  /**
   * L'EFFECTIF DE LA BRIGADE, rangé par grade décroissant.
   *
   * L'ordre est celui d'un tableau d'effectif, pas l'ordre alphabétique : on
   * cherche « combien d'A/C ai-je », question à laquelle une liste triée par
   * nom ne répond pas.
   */
  const parGrade = useMemo(() => {
    const groupes = new Map(
      GRADES.slice()
        .reverse()
        .map((g) => [g, []]),
    );
    for (const p of roster?.effectif ?? []) {
      if (!groupes.has(p.grade)) groupes.set(p.grade, []);
      groupes.get(p.grade).push(p);
    }
    for (const l of groupes.values()) l.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    return [...groupes.entries()].filter(([, l]) => l.length);
  }, [roster]);

  /** Qui, dans la brigade, n'est placé nulle part sur ce créneau. */
  const libres = useMemo(() => {
    const pris = new Set(
      (roster?.elements ?? []).filter((e) => e.creneau === creneauCourant).map((e) => e.matricule),
    );
    return (roster?.effectif ?? []).filter((p) => !pris.has(p.matricule));
  }, [roster, creneauCourant]);

  /**
   * A-T-ON L'AUTORITÉ SUR CES POSTES ?
   *
   * On interroge la règle de la carte (`MQ.peutModifier`) sur les barrages de
   * la brigade — un seul suffit, ils relèvent tous de la même unité. Le
   * serveur reste l'arbitre : ceci ne fait que ne pas proposer un bouton
   * voué au refus.
   */
  const peutCorriger = useMemo(() => {
    if (!session || !roster?.barrages?.length) return false;
    const ids = new Set(roster.barrages.map((b) => b.id));
    return items.some((m) => ids.has(m.id) && MQ.peutModifier(session, m));
  }, [session, roster, items]);

  const attendus = (barrageId) =>
    (roster?.composition?.[barrageId] ?? []).reduce((s, c) => s + c.nombre, 0);

  const ajouter = async (barrageId, personne) => {
    setOccupe(true);
    setErreur(null);
    try {
      await API.ajouterElement({
        barrageId,
        grade: personne.grade,
        nom: personne.nom,
        matricule: personne.matricule,
      });
      await charger(brigadeValide, true);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  };

  const retirer = async (element) => {
    setOccupe(true);
    setErreur(null);
    try {
      await API.supprimerElement(element.id);
      await charger(brigadeValide, true);
    } catch (err) {
      setErreur(err.message);
    } finally {
      setOccupe(false);
    }
  };

  /**
   * REPRENDRE UN AUTRE CRÉNEAU DU JOUR, poste par poste.
   *
   * La préparation de la veille couvre le cas ordinaire. Il reste celui d'une
   * brigade sans effectif déclaré, ou d'un poste vidé puis à refaire : plutôt
   * que de rappeler les hommes un à un, on recopie un créneau déjà tenu.
   *
   * Les envois sont séquentiels — le dépôt réécrit son fichier à chaque ajout,
   * et une personne déjà placée ailleurs sur le créneau courant serait refusée
   * par le serveur. On rapporte alors ce qui est passé, sans annuler le reste.
   */
  const reprendreCreneau = async (barrageId, source) => {
    setOccupe(true);
    setErreur(null);
    let faits = 0;
    try {
      /* La règle des trois vaut aussi pour une reprise : on recopie les trois
         premiers, le serveur refuserait les suivants un par un. */
      for (const e of [...source].reverse().slice(0, MQ.ELEMENTS_PAR_BARRAGE)) {
        await API.ajouterElement({
          barrageId,
          grade: e.grade,
          nom: e.nom,
          matricule: e.matricule,
        });
        faits++;
      }
    } catch (err) {
      setErreur(
        `${faits} ligne(s) reprise(s) sur ${source.length}, puis interrompu : ${err.message}`,
      );
    } finally {
      await charger(brigadeValide, true);
      setOccupe(false);
    }
  };

  /* ---- Les autres créneaux de la journée ---- */

  const autresCreneaux = useMemo(() => {
    const par = new Map();
    for (const e of roster?.elements ?? []) {
      if (e.creneau === creneauCourant) continue;
      if (!par.has(e.creneau)) par.set(e.creneau, []);
      par.get(e.creneau).push(e);
    }
    return [...par.entries()].sort((a, b) => a[0] - b[0]);
  }, [roster, creneauCourant]);

  /** Le créneau le mieux garni d'un poste, pour la reprise — hors créneau courant. */
  const meilleureSource = (barrageId) => {
    let meilleur = null;
    for (const [creneau, liste] of autresCreneaux) {
      const duPoste = liste.filter((e) => e.barrageId === barrageId);
      if (duPoste.length && (!meilleur || duPoste.length > meilleur.liste.length)) {
        meilleur = { creneau, liste: duPoste };
      }
    }
    return meilleur;
  };

  /**
   * La liste, coupée en deux : ce qui est prêt à l'emploi d'abord, le reste
   * ensuite. Tant que l'état n'est pas connu, on ne suppose rien — tout part
   * dans « pourvues », et le sélecteur se lit comme avant.
   */
  const { pourvues, sansEffectif } = useMemo(() => {
    const avec = etat?.effectif?.listeBrigades;
    if (!Array.isArray(avec)) return { pourvues: brigades, sansEffectif: [] };
    const ensemble = new Set(avec);
    return {
      pourvues: brigades.filter((n) => ensemble.has(n)),
      sansEffectif: brigades.filter((n) => !ensemble.has(n)),
    };
  }, [brigades, etat]);

  /**
   * Les options du sélecteur : le nom, et le groupe où le ranger.
   *
   * `cie` est détourné de son sens — le composant s'en sert d'intitulé de
   * groupe, et « Effectif chargé » est bien plus utile ici que le nom d'une
   * compagnie que l'on connaît déjà.
   */
  const optionsBrigades = useMemo(
    () => [
      ...pourvues.map((nom) => ({ nom, cie: 'Effectif chargé' })),
      ...sansEffectif.map((nom) => ({ nom, cie: 'Sans effectif chargé' })),
    ],
    [pourvues, sansEffectif],
  );

  /* ================================================================
     LES ÉTAPES DU RELEVÉ — rendues à SAISIE TERRAIN, qui les insère
     dans SON parcours.

     Ce panneau empilait tout : le sélecteur de brigade, l'en-tête du
     créneau, la bascule Consulter/Modifier, la disposition poste par
     poste, les non affectés, le tableau d'effectif par grade, les autres
     créneaux du jour et la préparation d'administration. Huit blocs,
     dont quatre pliables.

     POURQUOI DES ÉTAPES RENDUES, ET NON UN SECOND PARCOURS IMBRIQUÉ :
     deux barres d'avancement l'une dans l'autre ne se lisent plus. La
     brigade et ses postes deviennent donc des étapes du parcours de
     SAISIE TERRAIN, avec UNE seule barre — celle du parent.

     AUCUNE DONNÉE, AUCUNE RÈGLE N'A CHANGÉ : mêmes appels
     (`chargerRoster`, `ajouter`, `retirer`, `reprendreCreneau`), même
     autorité (`peutCorriger`), même créneau serveur. Seul l'ordre
     d'affichage est nouveau.

     (Un commentaire décrivant « une seule recherche pour la brigade, le
     poste et l'homme » vivait ici : ce champ unique n'a jamais existé —
     la recherche est celle d'`UniteSelect`, sur les brigades seules.)
     ================================================================ */

  /**
   * LES POSTES À MONTRER — toute la brigade, ou le seul poste désigné.
   *
   * Ce filtre était écrit deux fois dans le rendu, une fois pour la lecture et
   * une fois pour la correction. Une seule expression, employée par les deux
   * étapes : elles ne peuvent plus montrer des postes différents.
   */
  const postesAffiches = posteCible
    ? (roster?.barrages ?? []).filter((b) => b.id === posteCible)
    : (roster?.barrages ?? []);

  const etapeBrigade = {
    cle: 'brigade',
    titre: 'Quelle brigade ?',
    ar: 'أي فرقة؟',
    aide: 'Ses barrages et le personnel qui les tient s’affichent ensuite, déjà répartis pour le créneau en cours.',
    valide: Boolean(brigadeValide),
    empeche: brigades.length
      ? 'Choisissez une brigade pour continuer.'
      : 'Aucune brigade dans votre périmètre.',
    contenu: (
      <div className="space-y-3">
        {/**
         * LE MÊME SÉLECTEUR CHERCHABLE QUE PARTOUT AILLEURS.
         *
         * Une liste déroulante native de 391 entrées ne se parcourt qu'en
         * connaissant la première lettre. `UniteSelect` — déjà employé par la
         * connexion, l'administration et l'optimisation — ouvre sur un champ de
         * recherche et une liste filtrée.
         *
         * Les deux groupes disent ce qui est prêt à l'emploi : le rattachement
         * sert ici à séparer les brigades pourvues des autres.
         */}
        <UniteSelect
          options={optionsBrigades}
          value={brigadeValide}
          onChange={choisirBrigade}
          grouperPar={sansEffectif.length ? 'cie' : null}
          placeholder={
            brigades.length ? 'Choisir une brigade…' : 'Aucune brigade dans votre périmètre'
          }
          placeholderRecherche="Rechercher une brigade…"
          fs={13}
        />

        <Recap
          titre="Le créneau en cours"
          lignes={[
            { libelle: 'Créneau', valeur: libelleCreneau(creneauCourant), accent: true },
            { libelle: 'Date', valeur: dateFr(dateDuJour) },
            { libelle: 'Brigades de votre périmètre', valeur: brigades.length },
            {
              libelle: 'Dont sans effectif chargé',
              valeur: sansEffectif.length || null,
            },
          ]}
        />

        {erreur && <Note ton="alerte">{erreur}</Note>}
      </div>
    ),
  };

  const etapePresents = {
    cle: 'presents',
    titre: 'Qui est présent ?',
    ar: 'العناصر الحاضرة',
    carte: true,
    aide: 'Chaque poste, et qui le tient. Appuyez sur le nom d’un poste pour le voir sur la carte.',
    valide: true,
    contenu: (
      <div className="space-y-2">
        <div className="flex items-baseline gap-2 rounded-xl border border-gr-gold/35 bg-gr-gold/12 px-3 py-2">
          <IconHoraire size={15} className="shrink-0 self-center text-gr-gold" />
          <span className="shrink-0 text-[15px] font-bold leading-tight tabular-nums text-gr-gold">
            {libelleCreneau(creneauCourant)}
          </span>
          <span className="min-w-0 flex-1 truncate text-right text-[11px] text-white/50">
            {brigadeValide}
            {roster ? ` · ${roster.effectif.length} élément(s)` : ''}
          </span>
        </div>

        {chargement && (
          <p className="flex items-center gap-1.5 px-1.5 py-1 text-[12px] text-white/45">
            <IconSpinner size={14} /> Chargement du roster…
          </p>
        )}

        {roster && roster.effectif.length === 0 && (
          <Note ton="alerte">
            <b>Aucun effectif chargé</b> pour cette brigade — ses postes restent vides.
            {etat?.effectif?.brigades ? ` ${etat.effectif.brigades} brigades le sont.` : ''}
          </Note>
        )}

        {posteCible && (
          <button
            type="button"
            onClick={() => setPosteCible(null)}
            className={`${bouton} w-full bg-white/8 py-2 text-white/70 hover:bg-white/14`}
          >
            Voir toute la brigade ({roster?.barrages?.length ?? 0})
          </button>
        )}

        {roster && roster.barrages.length === 0 && (
          <Note>Cette brigade ne tient aucun barrage.</Note>
        )}

        {postesAffiches.map((b) => (
          <CartePoste
            key={b.id}
            b={b}
            liste={duCreneau.get(b.id) ?? []}
            cible={attendus(b.id)}
            onViser={onViser}
          />
        ))}

        {/**
         * NON AFFECTÉS — la fin de la disposition, pas une annexe.
         *
         * Une disposition qui ne montre que les postes tenus laisse croire que
         * tout le monde est employé. Ces hommes sont la réserve de la brigade :
         * c'est là qu'on prend pour renforcer, et c'est le premier chiffre
         * qu'on regarde quand un poste est incomplet.
         */}
        {!posteCible && roster && libres.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/3 p-2.5">
            <p className="mb-1.5 flex items-baseline gap-1.5">
              <span className="min-w-0 flex-1 text-[12.5px] font-bold text-white/70">
                Non affectés
              </span>
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-px font-mono text-[11px] font-bold tabular-nums text-white/60">
                {libres.length}
              </span>
            </p>
            <ul className="max-h-52 space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
              {libres
                .slice()
                .sort(
                  (a, b) =>
                    GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade) ||
                    a.nom.localeCompare(b.nom, 'fr'),
                )
                .map((pers) => (
                  <Ligne key={pers.matricule} element={pers} onRetirer={null} />
                ))}
            </ul>
          </div>
        )}

        {/* Les personnes fictives ne doivent jamais passer pour de vraies. */}
        {roster?.effectif?.some((p) => p.demo) && (
          <Note>
            Effectif de <b className="text-gr-gold">démonstration</b> : ces personnes sont fictives
            (matricules « DEMO- »). Elles se remplacent par l’effectif réel sans toucher au reste.
          </Note>
        )}

        {erreur && <Note ton="alerte">{erreur}</Note>}
      </div>
    ),
  };

  /**
   * CORRIGER — une étape à part, et seulement si l'on en a l'autorité.
   *
   * C'était une bascule « Consulter / Modifier » au-dessus de la liste : deux
   * états du même écran, sans qu'on sache lequel était actif avant de chercher
   * quel bouton était doré. Une étape distincte ne se confond avec rien.
   *
   * La règle appliquée est celle de la carte (`peutCorriger`), pas une
   * nouvelle : proposer un bouton que le serveur refusera n'est pas une
   * politesse.
   */
  const etapeCorriger =
    peutCorriger && roster?.effectif?.length > 0
      ? {
          cle: 'corriger',
          titre: 'Corriger l’effectif',
          ar: 'تعديل العناصر',
          carte: true,
          aide: `Ajoutez ou retirez des hommes sur le créneau ${libelleCreneau(creneauCourant)}. Chaque geste est enregistré aussitôt.`,
          valide: true,
          contenu: (
            <div className="space-y-2">
              {postesAffiches.map((b) => {
                const liste = duCreneau.get(b.id) ?? [];
                const source = liste.length === 0 ? meilleureSource(b.id) : null;
                return (
                  <div key={b.id} className="rounded-xl border border-white/12 bg-white/4 p-2.5">
                    <EnTetePoste
                      b={b}
                      liste={liste}
                      cible={attendus(b.id)}
                      onViser={onViser}
                    />

                    {liste.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {liste.map((e, rang) => (
                          <Ligne
                            key={e.id}
                            element={e}
                            rang={rang + 1}
                            occupe={occupe}
                            onRetirer={() => retirer(e)}
                          />
                        ))}
                      </ul>
                    )}

                    <div className="mt-2 space-y-1.5">
                      {source && (
                        <button
                          type="button"
                          onClick={() => reprendreCreneau(b.id, source.liste)}
                          /* Reprendre un créneau ne peut pas non plus dépasser
                             la règle : la reprise s'arrête à trois. */
                          disabled={occupe || liste.length >= MQ.ELEMENTS_PAR_BARRAGE}
                          title={`Recopie les ${source.liste.length} homme(s) du créneau ${libelleCreneau(source.creneau)}`}
                          className={`${bouton} w-full border border-gr-gold/40 bg-gr-gold/10 py-2 text-gr-gold hover:bg-gr-gold/18`}
                        >
                          {occupe ? <IconSpinner size={13} /> : <IconHoraire size={13} />}
                          Reprendre {libelleCreneau(source.creneau)} ({source.liste.length})
                        </button>
                      )}
                      <AjouterPersonne
                        libres={libres}
                        total={roster?.effectif?.length ?? 0}
                        occupe={occupe}
                        complet={liste.length >= MQ.ELEMENTS_PAR_BARRAGE}
                        onAjouter={(p) => ajouter(b.id, p)}
                      />
                    </div>
                  </div>
                );
              })}

              {erreur && <Note ton="alerte">{erreur}</Note>}
            </div>
          ),
        }
      : null;

  /**
   * LE RESTE DE LA JOURNÉE — l'autre moitié de la réponse.
   *
   * La disposition dit qui tient chaque poste maintenant ; ceci dit de qui la
   * brigade dispose, et ce que valent les trois autres relèves. Les deux
   * étaient des blocs pliables au bas de l'écran, donc rarement ouverts.
   *
   * L'effectif est rangé par grade décroissant et non par nom : la question
   * posée est « combien d'A/C ai-je », à laquelle une liste alphabétique ne
   * répond pas.
   */
  const etapeJournee =
    roster && (roster.effectif.length > 0 || autresCreneaux.length > 0)
      ? {
          cle: 'journee',
          titre: 'Le reste de la journée',
          ar: 'باقي اليوم',
          aide: 'De qui la brigade dispose, et où en sont les autres relèves. En lecture seule : on corrige le créneau en cours, pas un créneau passé ou à venir.',
          valide: true,
          contenu: (
            <div className="space-y-3">
              {roster.effectif.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-white/3 p-2.5">
                  <p className="mb-1.5 text-[12.5px] font-bold text-white/70">
                    Personnel de la brigade
                    <span className="ml-1.5 font-normal text-white/40">
                      {roster.effectif.length}
                    </span>
                  </p>
                  {/* Rangé par grade décroissant et non par nom : la question
                      posée est « combien d'A/C ai-je », à laquelle une liste
                      alphabétique ne répond pas. En face de chaque nom, OÙ il
                      se trouve — c'est la réponse attendue. */}
                  <div className="space-y-2">
                    {parGrade.map(([grade, gens]) => (
                      <div key={grade}>
                        <p className="mb-0.5 text-[11px] font-bold text-gr-gold/70">
                          {grade}
                          <span className="ml-1.5 font-normal text-white/35">{gens.length}</span>
                        </p>
                        <ul className="space-y-0.5">
                          {gens.map((pers) => {
                            const poste = affectationDe.get(pers.matricule);
                            return (
                              <li
                                key={pers.matricule}
                                className="flex items-baseline gap-1.5 rounded-lg bg-white/5 px-2 py-1"
                              >
                                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white/85">
                                  {pers.nom}
                                </span>
                                <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-white/40">
                                  {pers.matricule}
                                </span>
                                <span
                                  className={`min-w-0 max-w-[46%] shrink-0 truncate text-[10.5px] ${
                                    poste ? 'text-gr-green' : 'text-white/30'
                                  }`}
                                  title={poste ? nomDuPoste.get(poste) : 'non affecté'}
                                >
                                  {poste ? `→ ${nomDuPoste.get(poste)}` : '— non affecté'}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {autresCreneaux.map(([creneau, liste]) => (
                <div key={creneau} className="rounded-xl border border-white/10 bg-white/3 p-2.5">
                  <p className="mb-1 text-[12.5px] font-bold tabular-nums text-white/75">
                    {libelleCreneau(creneau)}
                    <span className="ml-1.5 text-[11px] font-normal text-white/40">
                      {liste.length} homme(s)
                    </span>
                  </p>
                  <ul className="space-y-0.5">
                    {liste
                      .slice()
                      .sort((a, b) => GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade))
                      .slice(0, 12)
                      .map((e) => (
                        <Ligne key={e.id} element={e} onRetirer={null} />
                      ))}
                  </ul>
                  {liste.length > 12 && (
                    <p className="px-1.5 text-[10px] text-white/35">
                      … et {liste.length - 12} de plus
                    </p>
                  )}
                </div>
              ))}
            </div>
          ),
        }
      : null;

  /**
   * PRÉPARATION — outil d'administration, donc en dernière étape.
   *
   * Il occupait le haut de l'écran, devant tout le monde, avec un compte rendu
   * de plusieurs lignes — pour une action que l'administrateur lance une fois
   * par jour. Ce qu'on vient chercher ici, c'est qui tient les postes.
   */
  const etapePreparation =
    session?.rang === 'admin'
      ? {
          cle: 'preparation',
          titre: 'Préparation du roster',
          ar: 'إعداد الجدول',
          aide: 'Réservé à l’administration : reproposer la répartition du jour ou du lendemain.',
          valide: true,
          contenu: <PreparationAdmin etat={etat} relire={relireEtat} />,
        }
      : null;

  const etapes = brigadeValide
    ? [etapeBrigade, etapePresents, etapeCorriger, etapeJournee, etapePreparation].filter(Boolean)
    : [etapeBrigade, etapePreparation].filter(Boolean);

  /**
   * `correctionVoulue` remonte au parent : c'est lui qui tient l'indice de
   * l'étape courante, donc lui seul peut sauter. Le crochet dit ce qu'il veut,
   * le parcours décide — comme partout ailleurs dans cette interface.
   */
  return { etapes, correctionVoulue };
}

/* ------------------------------------------------------------------ */
/* Un poste et son effectif                                           */
/* ------------------------------------------------------------------ */

/**
 * L'EN-TÊTE D'UN POSTE — le nom EST le bouton « où est-ce ? ».
 *
 * Le chef connaît ses barrages de nom ; le renfort venu d'ailleurs, non.
 * Cliquer le nom cadre la carte dessus et l'y signale — voir `cadrerMq` dans
 * GendarmerieMap.jsx. Aucun bouton supplémentaire : c'est le libellé lui-même
 * qui répond, là où la question se pose.
 *
 * Extrait pour être partagé par l'étape de lecture et celle de correction :
 * il y était recopié, et les deux copies avaient déjà des tailles différentes.
 */
function EnTetePoste({ b, liste, cible, onViser }) {
  const complet = cible > 0 && liste.length >= cible;

  return (
    <div className="flex items-baseline gap-1.5">
      <button
        type="button"
        onClick={() => onViser?.(b.id)}
        disabled={!onViser}
        title={`Montrer ${b.nom || 'ce poste'} sur la carte`}
        className="flex min-w-0 flex-1 items-center gap-1 rounded text-left text-[12.5px]
          font-bold text-white/90 transition-colors duration-150 hover:text-gr-gold
          disabled:cursor-default disabled:hover:text-white/90 motion-reduce:transition-none
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
      >
        <span className="min-w-0 truncate">{b.nom || '(sans nom)'}</span>
        {onViser && <IconCible size={11} className="shrink-0 text-white/30" aria-hidden="true" />}
      </button>
      <span className="shrink-0 text-[10.5px] text-white/40">
        {b.route || b.type.replace('barrage_', '')}
      </span>
      {/* Présents sur attendus — le manque se voit sans compter. */}
      <span
        className={`shrink-0 rounded px-1.5 py-px font-mono text-[10.5px] font-bold tabular-nums ${
          complet ? 'bg-gr-green/20 text-gr-green' : 'bg-gr-gold/20 text-gr-gold'
        }`}
        title={`${liste.length} présent(s) pour ${cible} attendu(s)`}
      >
        {liste.length}/{cible || '?'}
      </span>
    </div>
  );
}

/** Un poste en lecture : son en-tête et qui le tient. */
function CartePoste({ b, liste, cible, onViser }) {
  return (
    <div className="rounded-xl border border-white/12 bg-white/4 p-2.5">
      <EnTetePoste b={b} liste={liste} cible={cible} onViser={onViser} />
      {/* Rien à dire quand le badge affiche déjà « 0/6 » : la phrase
          « Personne sur ce poste », répétée neuf fois, faisait tout l'écran
          d'une brigade sans effectif. */}
      {liste.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {liste.map((e, rang) => (
            <Ligne key={e.id} element={e} rang={rang + 1} onRetirer={null} />
          ))}
        </ul>
      )}
    </div>
  );
}
