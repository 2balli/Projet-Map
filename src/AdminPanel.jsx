/**
 * PANNEAU D'ADMINISTRATION — les habilitations, et rien d'autre.
 *
 * IL PORTAIT AUSSI UNE « CONSOLIDATION DU DISPOSITIF »
 * ---------------------------------------------------
 * Elle faisait double emploi avec OPTIMISATION DES BARRAGES : même calcul,
 * même appel au serveur, mais en version appauvrie — sans choix du périmètre,
 * sans report du résultat sur la carte. Deux chemins pour une même décision,
 * dont l'un donnait moins d'informations : de quoi arbitrer différemment selon
 * la porte empruntée. L'arbitrage se prend dans OPTIMISATION ; ici on ne gère
 * que les comptes.
 *
 * CE QUI A ÉTÉ REFAIT, ET POURQUOI
 * --------------------------------
 * Le parc compte 625 comptes. La liste les déroulait TOUS, à plat, sans
 * recherche ni filtre : trouver la brigade de Tiznit demandait de faire défiler
 * cinq cents lignes. Ce n'était pas un défaut d'apparence mais d'usage.
 *
 * La suppression passait par `window.confirm()` — une boîte native, seule de
 * son espèce dans l'application, alors que tout le reste confirme en deux temps
 * DANS le bouton (voir `CommandesPopup`, `DecisionPopup`). Une boîte système
 * s'ignore d'un réflexe ; un bouton qui devient rouge sous le doigt, non.
 *
 * Et le code d'accès s'affichait en texte brut, à recopier à la main. Il est
 * désormais présenté pour être lu et copié — avec un repli pour les postes en
 * HTTP simple, où l'API presse-papiers du navigateur n'existe pas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as API from './api.js';
import {
  IconSpinner,
  IconPlus,
  IconChef,
  IconPoubelle,
  IconVerrou,
  IconRegion,
  IconCompagnie,
  IconBrigade,
  IconLoupe,
  IconCoche,
} from './icons.jsx';
import UniteSelect from './UniteSelect.jsx';
import { sansAccent } from './texte.js';
import {
  Parcours,
  useParcours,
  indiceDe,
  Choix,
  Champ,
  Recap,
  Note,
  Termine,
  Vide,
} from './Parcours.jsx';

const RANGS_FR = {
  unite: 'Brigade Territoriale',
  cie: 'Compagnie',
  reg: 'Région',
  admin: 'Administrateur',
};

/** Libellé court pour les pastilles de filtre — la place manque en 4 colonnes. */
const RANGS_COURT = { admin: 'Admin', reg: 'Régions', cie: 'Compagnies', unite: 'Brigades' };

const ICONE_RANG = { admin: IconChef, reg: IconRegion, cie: IconCompagnie, unite: IconBrigade };

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

const champ =
  'w-full rounded-lg border border-white/12 bg-white/6 px-2.5 py-2 text-[12px] text-white ' +
  'placeholder:text-white/30 focus:border-gr-gold/60 focus:outline-none';


/**
 * Copie dans le presse-papiers, AVEC REPLI.
 *
 * `navigator.clipboard` n'existe que dans un contexte sécurisé. L'intranet de
 * la Gendarmerie sert la carte en HTTP simple sur une adresse locale : l'API
 * y est absente, et un bouton « Copier » qui ne fait rien est pire que pas de
 * bouton du tout. D'où le repli par `execCommand`, dépréciée mais universelle.
 */
async function copier(texte) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
  } catch {
    /* on tente le repli ci-dessous */
  }
  try {
    const z = document.createElement('textarea');
    z.value = texte;
    z.setAttribute('readonly', '');
    z.style.position = 'fixed';
    z.style.opacity = '0';
    document.body.appendChild(z);
    z.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(z);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Une ligne de compte, avec sa suppression en DEUX TEMPS.
 *
 * Le premier clic n'engage à rien : le bouton change de couleur et de mot.
 * Perdre le focus annule. Même mécanique que partout ailleurs dans
 * l'application — et surtout, plus de boîte `window.confirm` qu'on écarte d'un
 * réflexe sans lire.
 */
function LigneCompte({ c, occupe, onSupprimer }) {
  const [confirme, setConfirme] = useState(false);
  const Icone = ICONE_RANG[c.rang] ?? IconChef;

  return (
    <li className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/8 text-gr-gold/80">
        <Icone size={15} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-white">{c.unite}</div>
        <div className="truncate text-[10px] text-white/45">
          {RANGS_FR[c.rang]}
          {c.reg ? ` · ${c.reg}` : ''}
        </div>
        {/* Le matricule est l'identifiant réel du compte : il porte le préfixe
            de rang (REG-/CIE-/BT-) qui distingue les unités homonymes. Sans lui
            affiché, deux « Tanger » de rangs différents sont impossibles à
            départager dans cette liste. */}
        {c.matricule && (
          <div className="mt-0.5 truncate font-mono text-[10px] text-gr-gold/70">{c.matricule}</div>
        )}
      </div>

      <button
        type="button"
        disabled={occupe}
        onClick={() => (confirme ? onSupprimer() : setConfirme(true))}
        onBlur={() => setConfirme(false)}
        aria-label={`Supprimer le compte de ${c.unite}`}
        title="Retire l’habilitation — le compte ne pourra plus se connecter"
        className={`${bouton} shrink-0 ${
          confirme ? 'bg-gr-red text-white' : 'bg-gr-red/12 text-gr-red hover:bg-gr-red/22'
        }`}
      >
        <IconPoubelle size={13} />
        {confirme ? 'Confirmer ?' : 'Retirer'}
      </button>
    </li>
  );
}

/**
 * OUTILS DE PRÉSENTATION — revenir à l'état de départ de la démonstration.
 *
 * Rangés ici, dans l'administration, et non près de DÉPLACER, SUPPRIMER ou
 * RÉINITIALISER L'OPTIMISATION : ce geste ne défait pas une simulation, il
 * remet tout le dispositif de démonstration dans l'état de la référence.
 *
 * Deux temps, comme ailleurs dans l'application, plus un mot à saisir : le
 * serveur exige ce même mot, l'écran ne fait que le transmettre. Le mode
 * (démo), le rang (administrateur) et l'existence de la référence sont
 * vérifiés par le serveur, quoi qu'affiche l'écran.
 */
function OutilsPresentation({ etat, onEtat, onRestauree }) {
  const [confirmer, setConfirmer] = useState(null); // 'restaurer' | 'enregistrer' | null
  const [saisie, setSaisie] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);
  const ref = etat?.reference;
  const ecarts = etat?.ecarts;
  const date = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const auteur = (p) => (p ? [p.nom, p.matricule].filter(Boolean).join(' · ') : 'données livrées (premier démarrage)');
  const motAttendu = confirmer === 'restaurer' ? 'RESTAURER' : 'ENREGISTRER';
  const ouvrir = (quoi) => {
    setConfirmer(quoi);
    setSaisie('');
    setMessage(null);
  };
  const executer = async () => {
    setOccupe(true);
    setMessage(null);
    try {
      if (confirmer === 'restaurer') {
        const r = await API.restaurerPresentation(saisie);
        onEtat(r);
        const b = r.restauration?.resume?.barrages ?? {};
        const n = r.restauration?.resume?.notifications ?? {};
        setMessage({
          ok: true,
          texte:
            `✓ Positions initiales restaurées — ${b.deplaces ?? 0} poste(s) remis en place, ${b.modifies ?? 0} fiche(s) rétablie(s), ` +
            `${b.ajoutes ?? 0} poste(s) de démonstration retiré(s), ${b.retires ?? 0} rétabli(s) ; ` +
            `${(n.ajoutes ?? 0) + (n.deplaces ?? 0) + (n.modifies ?? 0)} notification(s) de démonstration annulée(s) ou rétablie(s). ` +
            'Distances et conflits recalculés.',
        });
        onRestauree?.(r);
      } else {
        const r = await API.enregistrerReferencePresentation(saisie);
        onEtat(r);
        setMessage({ ok: true, texte: `✓ État actuel enregistré comme référence (${r.reference?.barrages ?? 0} barrages).` });
      }
      setConfirmer(null);
      setSaisie('');
    } catch (err) {
      setMessage({ ok: false, texte: err.message });
    } finally {
      setOccupe(false);
    }
  };
  const ecartsTotal = ecarts
    ? ecarts.barrages.deplaces + ecarts.barrages.modifies + ecarts.barrages.ajoutes + ecarts.barrages.retires +
      ecarts.notifications.deplaces + ecarts.notifications.modifies + ecarts.notifications.ajoutes + ecarts.notifications.retires
    : 0;

  return (
    <div className="space-y-3" data-gr-outils-presentation="1">
      <Recap
        titre="Référence de présentation"
        lignes={[
          { libelle: 'Enregistrée le', valeur: date(ref?.cree) },
          { libelle: 'Par', valeur: auteur(ref?.creePar) },
          { libelle: 'Barrages de référence', valeur: ref?.barrages },
          { libelle: 'Notifications de barrage', valeur: ref?.notifications },
          { libelle: 'Dernière restauration', valeur: ref?.derniereRestauration ? date(ref.derniereRestauration.ts) : 'aucune' },
        ]}
      />
      {ecarts && (
        <Recap
          titre="Écart avec la référence"
          lignes={[
            { libelle: 'Postes déplacés', valeur: ecarts.barrages.deplaces },
            { libelle: 'Fiches modifiées (sans déplacement)', valeur: ecarts.barrages.modifies },
            { libelle: 'Postes ajoutés pendant la démonstration', valeur: ecarts.barrages.ajoutes },
            { libelle: 'Postes retirés pendant la démonstration', valeur: ecarts.barrages.retires },
            {
              libelle: 'Notifications de démonstration',
              valeur: ecarts.notifications.ajoutes + ecarts.notifications.deplaces + ecarts.notifications.modifies + ecarts.notifications.retires,
            },
            { libelle: 'Total', valeur: ecartsTotal, accent: true },
          ]}
        />
      )}

      {confirmer ? (
        <div role="alertdialog" data-gr-confirmation-presentation={confirmer} className="space-y-2 rounded-xl border border-[#F59E0B]/55 bg-[#F59E0B]/10 p-3 text-[12px] text-white/85">
          {confirmer === 'restaurer' ? (
            <>
              <p className="text-[13px] font-bold text-amber-300">Restaurer les positions initiales ?</p>
              <p>Cette action va :</p>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>remettre les barrages à leurs positions initiales</li>
                <li>annuler les repositionnements de démonstration</li>
                <li>nettoyer les repères « barrage nouvellement posé »</li>
                <li>restaurer les états nécessaires à la présentation</li>
                <li>recalculer les distances et conflits</li>
              </ul>
              <p className="font-semibold text-gr-green">Les données de production ne seront pas modifiées.</p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-bold text-amber-300">Enregistrer l’état actuel comme référence ?</p>
              <p>
                La prochaine restauration ramènera à l’état présent du dispositif ({ecartsTotal} écart(s) avec la référence actuelle
                deviendront la nouvelle base). L’ancienne référence est remplacée.
              </p>
            </>
          )}
          <label className="block text-[11px] text-white/65">
            Saisissez <b className="font-mono text-white">{motAttendu}</b> pour confirmer
            <input
              type="text"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Saisissez ${motAttendu} pour confirmer`}
              className="mt-1 w-full rounded-lg border border-white/20 bg-black/40 px-2.5 py-1.5 font-mono text-[12.5px] text-white outline-none focus:border-[#F59E0B]"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmer(null)}
              disabled={occupe}
              className="flex-1 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-[11.5px] font-bold uppercase text-white/80 hover:bg-white/12"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={executer}
              disabled={occupe || saisie !== motAttendu}
              className="flex-1 rounded-lg bg-[#F59E0B] px-3 py-2 text-[11.5px] font-bold uppercase text-gr-navy hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {occupe ? 'En cours…' : confirmer === 'restaurer' ? 'Restaurer' : 'Enregistrer'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => ouvrir('restaurer')}
            disabled={!ref}
            title="Réinitialiser l’environnement de démonstration"
            data-gr-restaurer-presentation="1"
            className="w-full rounded-xl border-2 border-[#F59E0B]/70 bg-[#F59E0B]/12 px-3 py-2.5 text-[12.5px] font-bold uppercase tracking-wide text-amber-300 hover:bg-[#F59E0B]/22 disabled:opacity-40"
          >
            ↩ Restaurer les positions initiales
          </button>
          <button
            type="button"
            onClick={() => ouvrir('enregistrer')}
            title="Faire de l’état actuel le point de départ des prochaines restaurations"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/65 hover:bg-white/10"
          >
            Enregistrer l’état actuel comme référence
          </button>
        </>
      )}
      {message && (
        <p
          role="status"
          data-gr-message-presentation={message.ok ? 'ok' : 'erreur'}
          className={`rounded-lg px-2.5 py-2 text-[11.5px] leading-relaxed ${message.ok ? 'bg-gr-green/12 text-gr-green' : 'bg-gr-red/12 text-gr-red'}`}
        >
          {message.texte}
        </p>
      )}
      <Note>
        Seuls les barrages et les notifications qui décrivent leur état sont restaurés. Comptes, hiérarchie, effectifs,
        relèves, graphe routier, couches et autres marquages ne sont pas touchés. Disponible uniquement en mode démonstration.
      </Note>
    </div>
  );
}

export default function AdminPanel({ open, onOpen, onClose, session, unites, onPresentationRestauree }) {
  const [comptes, setComptes] = useState([]);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [succes, setSucces] = useState(null);
  /** Outils de présentation — rendus par le serveur ; null hors administration. */
  const [presentation, setPresentation] = useState(null);

  /**
   * LA TÂCHE EN COURS, et l'étape où l'on en est.
   *
   * `ajoutOuvert` a disparu avec le formulaire dépliant : ce n'est plus un
   * bloc qu'on ouvre au milieu d'une liste, c'est une tâche à part entière.
   */
  const [tache, setTache] = useState(null);
  /* `useParcours` remet l'étape ET la tâche à zéro à chaque ouverture : on
     ne reprend pas une création de compte à moitié faite dont on a perdu le
     fil. Voir le commentaire du crochet dans Parcours.jsx. */
  const { indice: etape, setIndice: setEtape } = useParcours(
    open,
    () => {
      setTache(null);
      setSucces(null);
      /* L'ERREUR PART AVEC LE RESTE. Elle n'était effacée que par l'ancien
         « quitter la tâche » de TERMINER : fermer par la croix laissait donc
         un refus affiché, qui réapparaissait à la réouverture sur une étape
         qui n'avait rien à voir. Une seule remise à zéro, complète. */
      setErreur(null);
    },
    tache,
  );

  /* Le compte en cours de création */
  const [nouveauRang, setNouveauRang] = useState('cie');
  const [nouvelleUnite, setNouvelleUnite] = useState('');
  const [nouveauCode, setNouveauCode] = useState('');

  /* Recherche et filtre de la liste */
  const [recherche, setRecherche] = useState('');
  const [rangFiltre, setRangFiltre] = useState('tous');
  const [copie, setCopie] = useState(false);
  const champRecherche = useRef(null);

  const chargerComptes = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      const liste = await API.listerComptes();
      setComptes(liste);
    } catch (err) {
      setErreur(err.message ?? 'Erreur lors du chargement des comptes.');
    } finally {
      setOccupe(false);
    }
  };

  useEffect(() => {
    if (open && session?.rang === 'admin') {
      /* La remise à zéro du menu n'est PLUS écrite ici : `useParcours` s'en
         charge à chaque ouverture, pour toutes les sections à la fois. La
         garder en double aurait fini par divergir de l'autre. */
      chargerComptes();
      API.etatPresentation().then(setPresentation).catch(() => setPresentation(null));
    }
  }, [open, session]);

  /**
   * CRÉER LE COMPTE — le SUIVANT de l'étape de vérification.
   *
   * Il n'avance qu'en cas de réussite : un échec laisse sur la vérification,
   * avec son message, et l'unité intacte pour corriger. L'ancien formulaire se
   * refermait dans les deux cas, et il fallait tout ressaisir.
   *
   * `nouvelleUnite` N'EST PAS vidée ici : l'étape « Compte créé » la nomme, et
   * la vider ferait afficher « Habilitation créée pour  ».
   */
  const creerLeCompte = async () => {
    setOccupe(true);
    setErreur(null);
    setSucces(null);
    try {
      const res = await API.creerCompte(nouveauRang, nouvelleUnite, nouveauCode || undefined);
      setSucces({ unite: nouvelleUnite, code: res.code });
      setCopie(false);
      setNouveauCode('');
      /* PAR LA CLÉ, jamais par un nombre : « fait » était l'indice 4 avant que
         l'étape de choix ne passe en tête, et 5 après. Voir `indiceDe`. */
      setEtape(indiceDe(etapes, 'fait'));
      chargerComptes();
    } catch (err) {
      setErreur(err.message ?? "Erreur lors de la création du compte.");
    } finally {
      setOccupe(false);
    }
  };

  const handleSupprimer = async (rang, unite) => {
    setOccupe(true);
    setErreur(null);
    setSucces(null);
    try {
      await API.supprimerCompte(rang, unite);
      chargerComptes();
    } catch (err) {
      setErreur(err.message ?? 'Erreur lors de la suppression.');
    } finally {
      setOccupe(false);
    }
  };

  /* Liste des choix pour le sélecteur d'unité */
  const listeChoix =
    nouveauRang === 'cie'
      ? (unites?.compagnies ?? [])
      : nouveauRang === 'unite'
        ? (unites?.unites ?? [])
        : nouveauRang === 'reg'
          ? (unites?.regions ?? [])
          : [];

  const parRang = useMemo(() => {
    const n = { admin: 0, reg: 0, cie: 0, unite: 0 };
    for (const c of comptes) n[c.rang] = (n[c.rang] ?? 0) + 1;
    return n;
  }, [comptes]);

  /**
   * LA LISTE FILTRÉE — et plafonnée à l'affichage.
   *
   * 625 lignes dans le DOM ralentissent le panneau pour rien : personne ne
   * parcourt cinq cents brigades à l'œil, on cherche la sienne. On en rend donc
   * un nombre raisonnable, ET ON DIT COMBIEN SONT MASQUÉES — une liste tronquée
   * en silence se lit comme une liste complète, et laisse croire qu'un compte
   * n'existe pas.
   */
  const PLAFOND = 60;
  const filtres = useMemo(() => {
    const q = sansAccent(recherche.trim());
    return comptes.filter(
      (c) =>
        (rangFiltre === 'tous' || c.rang === rangFiltre) &&
        (!q ||
          sansAccent(c.unite).includes(q) ||
          sansAccent(c.matricule).includes(q) ||
          sansAccent(c.reg).includes(q))
    );
  }, [comptes, recherche, rangFiltre]);
  const affiches = filtres.slice(0, PLAFOND);

  /*
   * FERMETURE DU PANNEAU
   * --------------------
   * Ce garde manquait, et c'était le seul des huit panneaux à en être dépourvu.
   * Le parent le montait sans condition : `open` pilotait le chargement des
   * comptes, mais rien n'empêchait l'affichage. Le panneau restait donc à
   * l'écran en permanence, insensible aussi bien à son bouton qu'à sa propre
   * croix, qui mettaient bien `open` à `false` sans que cela ne change rien.
   */
  if (!open) return null;

  /**
   * DEUX TÂCHES, ET LE CODE D'ACCÈS COMME ABOUTISSEMENT.
   *
   * Le panneau montrait tout à la fois : une grille de quatre compteurs qui
   * servait AUSSI de filtre (rien ne le disait), un bouton « Créer une
   * habilitation » qui dépliait un formulaire de trois champs, le code du
   * dernier compte créé — affiché au-dessus du formulaire, donc au-dessus de
   * l'endroit d'où il venait — puis la liste des 625 comptes avec sa
   * recherche.
   *
   * Créer un compte et consulter le parc sont deux gestes sans rapport. On
   * demande donc lequel, et la création devient un parcours dont la DERNIÈRE
   * ÉTAPE est le code à transmettre : c'est son aboutissement, et il n'est
   * montré qu'une fois — le serveur ne le rend jamais en clair ensuite.
   */
  const etapesCreation = [
    {
      cle: 'rang',
      titre: 'Quel niveau d’habilitation ?',
      ar: 'مستوى الصلاحية',
      aide: 'Le niveau décide de ce que le compte verra et pourra écrire : son périmètre en découle entièrement.',
      valide: true,
      contenu: (
        <Choix
          nom="Niveau d’habilitation"
          valeur={nouveauRang}
          onChange={(r) => {
            setNouveauRang(r);
            setNouvelleUnite('');
          }}
          options={[
            {
              cle: 'unite',
              libelle: RANGS_FR.unite,
              ar: 'رئيس الدرك الترابي',
              icone: IconBrigade,
              aide: 'Voit et écrit sur sa seule brigade territoriale.',
            },
            {
              cle: 'cie',
              libelle: RANGS_FR.cie,
              ar: 'رئيس السرية',
              icone: IconCompagnie,
              aide: 'Couvre toutes les brigades de sa compagnie.',
            },
            {
              cle: 'reg',
              libelle: RANGS_FR.reg,
              ar: 'رئيس الجهة',
              icone: IconRegion,
              aide: 'Couvre toutes les compagnies de sa région.',
            },
            {
              cle: 'admin',
              libelle: RANGS_FR.admin,
              ar: 'المسؤول',
              icone: IconChef,
              aide: 'Aucun périmètre : voit et écrit partout, et tranche les décisions.',
            },
          ]}
        />
      ),
    },
    {
      cle: 'unite',
      titre: nouveauRang === 'admin' ? 'Quel identifiant ?' : 'Quelle unité ?',
      ar: nouveauRang === 'admin' ? 'المعرّف' : 'الوحدة',
      aide:
        nouveauRang === 'admin'
          ? 'Un administrateur n’est rattaché à aucun territoire : donnez-lui un nom d’utilisateur.'
          : 'C’est ce rattachement qui déterminera son périmètre, sans qu’il ait jamais à le choisir.',
      valide: Boolean(nouvelleUnite),
      empeche:
        nouveauRang === 'admin'
          ? 'Renseignez un nom d’utilisateur.'
          : 'Choisissez l’unité à habiliter.',
      contenu:
        nouveauRang === 'admin' ? (
          <Champ
            libelle="Nom d’utilisateur administrateur"
            value={nouvelleUnite}
            onChange={setNouvelleUnite}
            placeholder="Nom d’utilisateur administrateur"
            autoFocus
          />
        ) : (
          <div className="space-y-2">
            {/* `UniteSelect` extrait lui-même le nom : la liste mêle des
                chaînes (régions) et des objets {nom, cie, reg}. L'ancien
                `<option value={u}>` envoyait « [object Object] » pour une
                compagnie ou une brigade, et la création échouait. */}
            <UniteSelect
              options={listeChoix}
              value={nouvelleUnite}
              onChange={setNouvelleUnite}
              grouperPar={nouveauRang === 'cie' ? 'reg' : nouveauRang === 'unite' ? 'cie' : null}
              placeholderRecherche={
                nouveauRang === 'reg'
                  ? 'Rechercher une région…'
                  : nouveauRang === 'cie'
                    ? 'Rechercher une compagnie…'
                    : 'Rechercher une brigade ou sa compagnie…'
              }
            />
            <Note>
              {listeChoix.length} {nouveauRang === 'reg' ? 'région(s)' : nouveauRang === 'cie' ? 'compagnie(s)' : 'brigade(s)'} au
              choix. Un compte existe peut-être déjà pour cette unité : le serveur le dira à la
              création.
            </Note>
          </div>
        ),
    },
    {
      cle: 'code',
      titre: 'Code d’accès',
      ar: 'رمز الدخول',
      aide: 'Laissez vide et le serveur en tire un au hasard — c’est le choix recommandé : un code choisi de tête est un code devinable.',
      valide: true,
      contenu: (
        <div className="space-y-3">
          <Champ
            libelle="Code d’accès (facultatif)"
            ar="رمز الدخول"
            value={nouveauCode}
            onChange={setNouveauCode}
            placeholder="Laissez vide pour un tirage au hasard"
            aide="Il ne sera affiché qu’une seule fois, à l’étape suivante."
          />
          <Note>
            Le code n’est jamais conservé en clair : le serveur n’en garde qu’une empreinte
            (PBKDF2). Personne, administrateur compris, ne pourra le relire ensuite — il faudra en
            créer un nouveau.
          </Note>
        </div>
      ),
    },
    {
      cle: 'verification',
      titre: 'Vérification',
      ar: 'التحقق',
      aide: 'Relisez avant de créer. Le compte sera actif immédiatement.',
      valide: Boolean(nouvelleUnite),
      empeche: 'Revenez en arrière : l’unité n’est pas renseignée.',
      libelleSuivant: 'CRÉER LE COMPTE',
      onSuivant: creerLeCompte,
      contenu: (
        <div className="space-y-3">
          <Recap
            titre="Le compte à créer"
            lignes={[
              { libelle: 'Niveau', valeur: RANGS_FR[nouveauRang], accent: true },
              {
                libelle: nouveauRang === 'admin' ? 'Identifiant' : 'Unité',
                valeur: nouvelleUnite,
                accent: true,
              },
              {
                libelle: 'Code',
                valeur: nouveauCode ? 'celui que vous avez saisi' : 'tiré au hasard',
              },
              {
                libelle: 'Périmètre',
                valeur:
                  nouveauRang === 'admin'
                    ? 'Tout le pays'
                    : `${RANGS_FR[nouveauRang]} — ${nouvelleUnite}`,
              },
            ]}
          />
          <Note>
            Le périmètre découle du niveau : ce compte n’aura jamais à le choisir, ni dans
            OPTIMISATION ni ailleurs.
          </Note>
        </div>
      ),
    },
    {
      cle: 'fait',
      titre: 'Compte créé',
      ar: 'تم إنشاء الحساب',
      valide: true,
      contenu: succes ? (
        <div className="space-y-3">
          <Termine
            titre={`Habilitation créée pour ${succes.unite}`}
            detail="Notez ce code maintenant : il ne sera plus affiché, et le serveur ne peut pas le relire."
          />

          {/*
            LE CODE D'ACCÈS, MONTRÉ POUR ÊTRE TRANSMIS.
            Il n'est affiché qu'une fois : le serveur ne le rend jamais en clair
            ensuite. D'où le contraste, la police à chasse fixe, et le bouton de
            copie — le recopier de tête est le meilleur moyen de le fausser.
          */}
          <div className="rounded-xl border border-gr-gold/40 bg-gr-gold/10 px-3 py-3">
            <code className="block select-all rounded-lg bg-gr-deep/60 px-3 py-3 text-center font-mono text-[20px] font-bold tracking-[0.2em] text-gr-gold">
              {succes.code}
            </code>
            <button
              type="button"
              onClick={async () => setCopie(await copier(succes.code))}
              className={`${bouton} mt-2 w-full py-2.5 ${
                copie
                  ? 'bg-gr-green/25 text-gr-green'
                  : 'bg-white/10 text-white/85 hover:bg-white/16'
              }`}
            >
              {copie ? <IconCoche size={14} /> : <IconVerrou size={14} />}
              {copie ? 'Code copié' : 'Copier le code'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setSucces(null);
              setNouvelleUnite('');
              setNouveauCode('');
              /* La PREMIÈRE étape de la création, et non l'indice 0 — qui est
                 le choix de la tâche depuis que celui-ci reste en tête. */
              setEtape(indiceDe(etapes, 'rang'));
            }}
            className={`${bouton} w-full bg-white/8 py-2.5 text-white/75 hover:bg-white/14`}
          >
            <IconPlus size={14} /> Créer une autre habilitation
          </button>
        </div>
      ) : (
        <Vide>La création n’a pas abouti. Revenez à l’étape précédente.</Vide>
      ),
    },
  ];

  const etapesConsultation = [
    {
      cle: 'parc',
      titre: `${comptes.length} habilitation(s)`,
      ar: 'الحسابات',
      aide: 'Cherchez par unité, matricule ou région. Un compte se supprime en deux temps.',
      valide: true,
      contenu: (
        <div className="space-y-3">
          <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-white/10">
            {[
              ['admin', parRang.admin],
              ['reg', parRang.reg],
              ['cie', parRang.cie],
              ['unite', parRang.unite],
            ].map(([rang, n], i) => (
              <button
                key={rang}
                type="button"
                onClick={() => setRangFiltre((r) => (r === rang ? 'tous' : rang))}
                aria-pressed={rangFiltre === rang}
                title={`Ne montrer que : ${RANGS_FR[rang]}`}
                className={`px-1 py-2.5 text-center transition-colors duration-150
                  motion-reduce:transition-none focus-visible:outline-2
                  focus-visible:outline-offset-[-2px] focus-visible:outline-gr-primary
                  ${i ? 'border-l border-white/10' : ''}
                  ${rangFiltre === rang ? 'bg-gr-gold/20' : 'bg-white/5 hover:bg-white/10'}`}
              >
                <div
                  className={`font-mono text-[19px] font-bold leading-none tabular-nums ${
                    rangFiltre === rang ? 'text-gr-gold' : 'text-white'
                  }`}
                >
                  {n}
                </div>
                <div className="mt-1 text-[9px] uppercase tracking-wide text-white/40">
                  {RANGS_COURT[rang]}
                </div>
              </button>
            ))}
          </div>
          {/* Le double emploi de la grille — compteur ET filtre — n'était
              annoncé que par une infobulle. Une ligne le dit maintenant. */}
          <p className="text-[11px] leading-snug text-white/40">
            Appuyez sur un compteur pour ne montrer que ce niveau.
            {rangFiltre !== 'tous' && (
              <>
                {' '}
                Filtre actif : <b className="text-gr-gold">{RANGS_FR[rangFiltre]}</b>.{' '}
                <button
                  type="button"
                  onClick={() => setRangFiltre('tous')}
                  className="underline hover:text-white/70"
                >
                  Tout montrer
                </button>
              </>
            )}
          </p>

          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-white/75">
              <IconLoupe size={13} /> Rechercher
            </span>
            <input
              ref={champRecherche}
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className={champ}
              placeholder="Unité, matricule, région…"
              aria-label="Rechercher un compte"
            />
          </label>

          {occupe && !comptes.length ? (
            <div className="py-8 text-center text-white/40">
              <IconSpinner size={22} className="mx-auto" />
            </div>
          ) : filtres.length === 0 ? (
            <Vide>
              {recherche || rangFiltre !== 'tous'
                ? 'Aucun compte ne correspond.'
                : 'Aucun compte enregistré.'}
            </Vide>
          ) : (
            <>
              <ul className="space-y-1.5">
                {affiches.map((c) => (
                  <LigneCompte
                    key={c.matricule ?? `${c.rang}-${c.unite}`}
                    c={c}
                    occupe={occupe}
                    onSupprimer={() => handleSupprimer(c.rang, c.unite)}
                  />
                ))}
              </ul>

              {/* Dire ce qui est masqué, plutôt que de laisser croire à une
                  liste complète — voir le commentaire de `PLAFOND`. */}
              {filtres.length > PLAFOND && (
                <p className="rounded-lg bg-white/5 px-2.5 py-1.5 text-center text-[11px] text-white/45">
                  {affiches.length} affichés sur <b className="text-white/70">{filtres.length}</b> —
                  affinez la recherche pour voir les autres.
                </p>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  /**
   * L'ÉTAPE DE CHOIX RESTE EN TÊTE — même forme que SAISIE TERRAIN et
   * ORGANISATION. Le choix est l'étape 1, la branche suit, et c'est
   * `useParcours` qui mène à l'indice 1 quand la tâche change : aucun appelant
   * n'écrit plus d'indice, donc plus personne ne peut se tromper de 1.
   */
  const etapeTache = {
    cle: 'tache',
    titre: 'Que voulez-vous faire ?',
    ar: 'ماذا تريد أن تفعل؟',
    aide: 'Choisissez une tâche : seul ce qui la sert sera affiché.',
    valide: Boolean(tache),
    empeche: 'Choisissez une tâche pour continuer.',
    contenu: (
            <div className="space-y-3">
              <Choix
                nom="Tâche"
                valeur={tache}
                onChange={(cle) => {
                  setTache(cle);
                  setSucces(null);
                }}
                options={[
                  {
                    cle: 'creer',
                    libelle: 'Créer une habilitation',
                    ar: 'حساب جديد',
                    aide: 'Un niveau, une unité, un code — et le compte est actif.',
                    icone: IconPlus,
                  },
                  {
                    cle: 'consulter',
                    libelle: 'Consulter les habilitations',
                    ar: 'الحسابات',
                    aide: `${comptes.length} compte(s) enregistré(s). Chercher, vérifier, supprimer.`,
                    icone: IconChef,
                  },
                  /* Démonstration seulement : en production, le serveur répond
                     `disponible: false` et la tâche n'existe pas. */
                  ...(presentation?.disponible
                    ? [{
                        cle: 'presentation',
                        libelle: 'Outils de présentation',
                        ar: 'أدوات العرض',
                        aide: 'Revenir à l’état de départ de la démonstration (positions initiales des barrages).',
                        icone: IconVerrou,
                      }]
                    : []),
                ]}
              />
              <Recap
                titre="Le parc"
                lignes={[
                  { libelle: 'Administrateurs', valeur: parRang.admin },
                  { libelle: 'Régions', valeur: parRang.reg },
                  { libelle: 'Compagnies', valeur: parRang.cie },
                  { libelle: 'Brigades', valeur: parRang.unite },
                  { libelle: 'Total', valeur: comptes.length, accent: true },
                ]}
              />
            </div>
    ),
  };

  /* LE CHOIX D'ABORD, LA BRANCHE ENSUITE. */
  const etapes = [
    etapeTache,
    ...(tache === 'creer'
      ? etapesCreation
      : tache === 'consulter'
        ? etapesConsultation
        : tache === 'presentation'
          ? [{
              cle: 'presentation',
              titre: 'Outils de présentation',
              ar: 'أدوات العرض',
              aide: 'Restaurer l’environnement de démonstration dans son état de référence.',
              valide: true,
              contenu: (
                <OutilsPresentation etat={presentation} onEtat={setPresentation} onRestauree={onPresentationRestauree} />
              ),
            }]
          : []),
  ];

  /**
   * ANNULER dans une tâche ramène au menu, comme dans SAISIE TERRAIN — par la
   * MÊME remise à zéro que l'ouverture, jamais par une seconde écrite à côté.
   */
  return (
    <Parcours
      icone={IconChef}
      titre="ADMINISTRATION"
      ar="إدارة الحسابات"
      etapes={etapes}
      indice={etape}
      onIndice={setEtape}
      /* ANNULER n'existe que sur l'étape 1 : elle ferme. Revenir au choix se
         fait par RETOUR ou par la barre d'avancement. */
      onFermer={onClose}
      /* TERMINER ferme la section — voir la note de MarquagePanel.jsx : il
         ramenait au menu des tâches, ce qui donnait à croire que le geste
         n'avait pas été pris. La remise à zéro se fait à la fermeture
         (`useParcours`), et l'erreur affichée part avec elle. */
      onTerminer={onClose}
      libelleTerminer="TERMINER"
      occupe={occupe}
      erreur={erreur}
    />
  );
}
