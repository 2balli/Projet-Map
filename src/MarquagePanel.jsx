/**
 * Panneau de saisie — chef de compagnie ou chef de région.
 *
 * Trois temps, dans cet ordre :
 *   1. connexion  — unité + code, vérifiés par le serveur
 *   2. saisie     — armer une nature, cliquer dans son périmètre
 *   3. échange    — exporter / importer un fichier GeoJSON
 *
 * Le panneau ne détient AUCUN état des marquages : il reçoit la liste et
 * remonte les intentions. La source de vérité est le serveur, qui seul décide
 * ce qui est accepté ; l'interface ne fait que rendre le refus lisible.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IconMarquage,
  IconChef,
  IconClose,
  IconPlus,
  IconPoubelle,
  IconExport,
  IconImport,
  IconTarget,
  IconAlert,
  IconVerrou,
  IconSpinner,
  IconHoraire,
  IconZahma,
  IconAccident,
  IconBarrageFixe,
  IconBarrageMobile,
  IconBarrageVIP,
  IconEntreeVille,
  IconPeage,
  IconSatellite,
  IconPointage,
  IconCrayon,
  IconLoupe,
  IconCoche,
} from './icons.jsx';
import {
  TYPES_MARQUAGE,
  TYPE_PAR_CLE,
  libelle,
  plage,
  peutModifier,
  SEVERITES,
  NIVEAUX_ACTIVITE,
  NIVEAUX_INFRACTION,
  POSITIONS_VILLE,
  ECLAIRAGE,
  CATEGORIES_ZAHMA,
  /* STATUTS_BARRAGE / STATUT_BARRAGE_INFO ne sont plus importés : le bloc
     « Validation » a été retiré de l'interface. Ils restent exportés par
     marquages.js, prêts à resservir. */
} from './marquages.js';
import * as MQ from './marquages.js';
import { formatKm } from './routage.js';
import { useEtapesEffectif } from './ElementsCreneau.jsx';
import {
  Parcours,
  useParcours,
  indiceDe,
  Choix,
  Recap,
  Note,
  MessageFlottant,
} from './Parcours.jsx';
import { sansAccent } from './texte.js';

/** Comment on nomme le périmètre du compte connecté, dans le récapitulatif. */
const RANGS_SAISIE = {
  admin: 'Administration',
  reg: 'Région',
  cie: 'Compagnie',
  unite: 'Brigade territoriale',
};

/** Et son rôle, en clair : « saisie » ne se comprend pas tout seul. */
const ROLES_SAISIE = {
  lecture: 'Consultation seule',
  saisie: 'Saisie de ses propres relevés',
  commandement: 'Commandement — agit sur les relevés de son unité',
};

/**
 * CE QU'ON PEUT POSER SUR LE TERRAIN, selon le grade.
 *
 * La congestion a été retirée de la saisie : elle n'était plus affichée comme
 * couche (voir `NATURES_AFFICHEES` dans layersConfig.js), on pouvait donc en
 * poser sans jamais les revoir. Un bouton qui crée de l'invisible n'a pas sa
 * place dans un panneau de terrain. La gestion de crise, elle, a été retirée
 * de l'application entière.
 *
 * LE POINT NOIR EST RÉSERVÉ À L'ADMINISTRATEUR. Ce n'est pas un signalement
 * ordinaire : il pèse sur la carte de risque, sur l'analyse et sur les
 * critères d'importance qui décident où poser un barrage. Le déclarer engage
 * donc bien plus que le périmètre de celui qui clique. Les unités continuent
 * de poser des barrages, et de renseigner les points noirs existants — seule
 * la CRÉATION est remontée au commandement central.
 *
 * Cette liste n'est qu'un affichage : la règle qui fait autorité est côté
 * serveur (voir POST /api/marquages), comme pour le périmètre.
 */
const posables = (session) =>
  TYPES_MARQUAGE.filter((t) =>
    (session?.rang === 'admin'
      ? ['accident', 'barrage_fixe', 'barrage_mobile', 'barrage_vip']
      : ['barrage_fixe', 'barrage_mobile', 'barrage_vip']
    ).includes(t.key),
  );

/** Icône par nature — mêmes tracés que les repères posés sur la carte. */
const TYPE_ICONS = {
  zahma: IconZahma,
  accident: IconAccident,
  barrage_fixe: IconBarrageFixe,
  barrage_mobile: IconBarrageMobile,
  barrage_vip: IconBarrageVIP,
};

/** Icône par sous-type de zahma — `carrefour`/`marche`/`autre` gardent l'icône générique. */
const ICONS_CATEGORIE_ZAHMA = {
  carrefour: IconZahma,
  entree_ville: IconEntreeVille,
  peage: IconPeage,
  marche: IconZahma,
  autre: IconZahma,
};

/* `clefRepli` est parti avec `SectionPliable` : les blocs pliables du panneau
   ont cédé la place au parcours guidé, qui mémorise l'étape et non le repli. */


const champ =
  'w-full rounded-lg border border-white/12 bg-white/6 px-2 py-1.5 text-[12px] text-white ' +
  'placeholder:text-white/30 focus:border-gr-gold/60 focus:outline-none';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';


/* ------------------------------------------------------------------ */
/* Formulaire d'un marquage                                           */
/* ------------------------------------------------------------------ */

/** Select d'attribut de point noir : options `{code, fr}`, valeur toujours renseignée. */
function SelectAttribut({ label, valeur, options, onChange }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-white/50">{label}</span>
      <select className={champ} value={valeur} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.fr}
          </option>
        ))}
      </select>
    </label>
  );
}


/**
 * Barrage déjà généré depuis CE point noir (voir `origineId`, posé à la
 * génération auto ou manuelle), ou bouton pour en générer un — partagé entre
 * la fiche du panneau Saisie et l'onglet Infos de la vue aérienne
 * (`Modal3D.jsx`) : même bouton, même liste, un seul endroit à faire évoluer.
 * UN SEUL barrage par point noir : dès qu'il en existe un, le bouton
 * disparaît — pour en poser un autre ailleurs, on part d'un nouveau point noir.
 */
export function BarrageDepuisPointNoir({
  item,
  barragesLies,
  onOuvrirBarrageLie,
  onGenererBarrage,
  generationEnCours,
}) {
  const aDejaUnBarrage = barragesLies?.length > 0;
  if (!onGenererBarrage && !aDejaUnBarrage) return null;

  return (
    <div className="space-y-1.5 rounded-lg bg-white/6 p-2">
      <span className="mb-0.5 block text-[10px] text-white/50">
        {aDejaUnBarrage ? 'Barrage généré depuis ce point' : 'Générer un barrage ici'}
      </span>

      {aDejaUnBarrage ? (
        <ul className="space-y-1">
          {barragesLies.map((b) => {
            const Icon = b.type === 'barrage_fixe' ? IconBarrageFixe : IconBarrageMobile;
            /* La pastille de statut de validation a été retirée avec le reste du
               concept — voir le bloc « Validation » plus bas dans ce fichier. */
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => onOuvrirBarrageLie?.(b)}
                  className="flex w-full items-center gap-2 rounded-lg bg-white/6 px-2 py-1.5 text-left
                    transition-colors duration-150 hover:bg-white/12 motion-reduce:transition-none"
                >
                  <Icon size={13} className="shrink-0 text-white/70" />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                    {libelle(b)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        onGenererBarrage && (
          <>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onGenererBarrage(item.id, 'barrage_fixe')}
                disabled={generationEnCours}
                className={`${bouton} flex-1 bg-white/10 text-white/85 hover:bg-white/16 disabled:opacity-40`}
              >
                {generationEnCours ? <IconSpinner size={13} /> : <IconBarrageFixe size={13} />}
                Fixe
              </button>
              <button
                type="button"
                onClick={() => onGenererBarrage(item.id, 'barrage_mobile')}
                disabled={generationEnCours}
                className={`${bouton} flex-1 bg-white/10 text-white/85 hover:bg-white/16 disabled:opacity-40`}
              >
                {generationEnCours ? <IconSpinner size={13} /> : <IconBarrageMobile size={13} />}
                Mobile
              </button>
            </div>
            <p className="text-[10px] leading-snug text-white/40">
              Crée un barrage brouillon directement sur ce point noir, sans passer par le filtre de
              génération en masse ni ses critères d'importance.
            </p>
          </>
        )
      )}
    </div>
  );
}

/**
 * Suppression depuis une ligne de la liste, en deux temps.
 *
 * Jusqu'ici, supprimer un repère supposait de le sélectionner, d'attendre que
 * sa fiche s'ouvre, puis de la parcourir jusqu'au bouton du bas. Pour faire le
 * ménage dans une série de barrages générés, cela faisait trois gestes et deux
 * changements d'écran par repère.
 *
 * Le premier clic n'engage rien : il transforme le bouton en rouge pendant
 * quelques secondes. Sortir du bouton, ou laisser passer le délai, annule.
 * C'est le même principe que dans la fiche et dans la bulle de la carte — un
 * seul geste à apprendre, valable partout.
 */
function BoutonSupprimerLigne({ nom, onSupprimer }) {
  const [confirme, setConfirme] = useState(false);

  useEffect(() => {
    if (!confirme) return undefined;
    const t = setTimeout(() => setConfirme(false), 4000);
    return () => clearTimeout(t);
  }, [confirme]);

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirme) {
          setConfirme(true);
          return;
        }
        onSupprimer();
      }}
      onBlur={() => setConfirme(false)}
      aria-label={confirme ? `Confirmer la suppression de ${nom}` : `Supprimer ${nom}`}
      title={confirme ? 'Cliquer de nouveau pour supprimer' : `Supprimer ${nom}`}
      className={`mr-1 grid size-9 shrink-0 place-items-center rounded-lg
        transition-colors duration-150 motion-reduce:transition-none
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
        ${confirme ? 'bg-gr-red text-white' : 'text-white/35 hover:bg-white/12 hover:text-white'}`}
    >
      <IconPoubelle size={14} />
    </button>
  );
}

/**
 * Édition d'un marquage. Chaque frappe remonte immédiatement (`onChange`) :
 * il n'y a donc pas de bouton « enregistrer », donc aucune saisie perdue si le
 * navigateur est fermé — le stockage local est écrit à chaque modification.
 *
 * `important`/`distanceProcheKm` : uniquement sur un point noir (`accident`),
 * calculés par le parent sur l'ensemble des points noirs connus — voir
 * `estImportant`/`scoreImportance` dans `marquages.js`. Information seulement :
 * rien n'est bloqué, c'est au chef de juger.
 */
/* ------------------------------------------------------------------ */
/* La fiche d'un marquage, en GROUPES                                 */
/* ------------------------------------------------------------------ */

/**
 * POURQUOI LA FICHE EST DÉCOUPÉE.
 *
 * Elle présentait, dans un tiroir de 352 px et d'un seul bloc : deux champs
 * d'identification, un compteur d'accidents, cinq listes de qualification, un
 * éditeur de patrouilles à sept champs répétables, un créneau, une
 * observation, les coordonnées et la suppression. Vingt champs. On ne savait
 * pas où commencer, et l'on ne voyait jamais la fin.
 *
 * Elle est donc rendue par GROUPES, chacun répondant à UNE question :
 *
 *   identification   — de quel lieu parle-t-on ?
 *   caractéristiques — que vaut ce point ?
 *   patrouilles      — qui y est affecté ?
 *   horaires         — quand, et quoi noter ?
 *
 * DEUX EMPLOIS, UN SEUL CODE. La vue aérienne (`Modal3D`) affiche tous les
 * groupes d'affilée — elle a la place, et l'on y corrige au vol. Le parcours
 * de SAISIE TERRAIN en montre UN PAR ÉTAPE. `groupesFiche` donne la liste des
 * groupes qui s'appliquent à un repère donné : un point de congestion n'a pas
 * de patrouilles, un barrage n'a pas de sous-type.
 *
 * L'ENREGISTREMENT N'A PAS CHANGÉ : chaque groupe appelle le même `maj`, donc
 * le même `onChange` qu'avant, à chaque frappe. Découper l'affichage ne
 * découpe pas la sauvegarde — il n'y a pas de brouillon, pas de bouton
 * « Enregistrer », et il n'en a pas été inventé.
 */

/** Bandeau d'identité du repère, avec ses deux actions de carte. */
export function EnTeteFiche({ item, onCadrer, onVue3D, masquerActionsCarte = false }) {
  const type = TYPE_PAR_CLE[item.type];
  const Icon =
    item.type === 'zahma'
      ? (ICONS_CATEGORIE_ZAHMA[item.sousType] ?? IconZahma)
      : TYPE_ICONS[item.type];

  return (
    <div className="flex items-center gap-2">
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: type.color, color: '#0b1220' }}
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
        {libelle(item)}
      </span>
      {!masquerActionsCarte && (
        <>
          <button
            type="button"
            onClick={() => onVue3D?.(item)}
            title="Vue aérienne rapprochée"
            className={`${bouton} bg-white/10 text-white/80 hover:bg-white/16`}
          >
            <IconSatellite size={14} />
          </button>
          <button
            type="button"
            onClick={onCadrer}
            title="Centrer la carte sur ce marquage"
            className={`${bouton} bg-white/10 text-white/80 hover:bg-white/16`}
          >
            <IconTarget size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/** De quel lieu parle-t-on ? */
export function GroupeIdentification({ item, maj }) {
  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-white/75">
          Lieu / désignation
        </span>
        <input
          className={champ}
          value={item.nom ?? ''}
          onChange={(e) => maj({ nom: e.target.value })}
          placeholder="Carrefour Bab Doukkala"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-white/75">
          Route / point kilométrique
        </span>
        <input
          className={champ}
          value={item.route ?? ''}
          onChange={(e) => maj({ route: e.target.value })}
          placeholder="RN8 — PK 42"
        />
      </label>

      {item.type === 'zahma' && (
        <SelectAttribut
          label="Type de point"
          valeur={item.sousType ?? 'carrefour'}
          options={CATEGORIES_ZAHMA}
          onChange={(v) => maj({ sousType: v })}
        />
      )}

      <p className="font-mono text-[10.5px] text-white/35">
        {item.lat.toFixed(5)}, {item.lng.toFixed(5)} — glissez le repère sur la carte pour corriger
      </p>
    </div>
  );
}

/**
 * Que vaut ce point ?
 *
 * MÊMES CHAMPS pour un point noir et pour un barrage, à dessein : ce sont eux
 * qui décident de l'importance (`estImportant` dans marquages.js), et un
 * barrage doit rester retrouvable par les mêmes critères que le point noir
 * dont il est issu.
 */
export function GroupeCaracteristiques({
  item,
  maj,
  important,
  distanceProcheKm,
  barragesLies,
  onOuvrirBarrageLie,
  onGenererBarrage,
  generationEnCours,
}) {
  const estPointNoir = item.type === 'accident';

  return (
    <div className="space-y-2.5">
      {estPointNoir && important && (
        <p className="flex items-center gap-1.5 rounded-lg bg-gr-gold/15 px-2.5 py-1.5 text-[11px] font-semibold text-gr-gold">
          <IconAlert size={13} className="shrink-0" /> Point noir important
          {distanceProcheKm != null && (
            <span className="font-normal text-gr-gold/80">
              · à {formatKm(distanceProcheKm)} du plus proche
            </span>
          )}
        </p>
      )}

      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-white/75">
          {estPointNoir ? "Nombre d'accidents" : "Nombre d'accidents (à l'origine)"}
        </span>
        <input
          type="number"
          min={0}
          className={champ}
          value={item.accidentCount ?? 0}
          onChange={(e) => maj({ accidentCount: Math.max(0, Number(e.target.value) || 0) })}
        />
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <SelectAttribut
          label="Sévérité"
          valeur={item.severite ?? 'none'}
          options={SEVERITES}
          onChange={(v) => maj({ severite: v })}
        />
        <SelectAttribut
          label="Activité routière"
          valeur={item.activite ?? 'low'}
          options={NIVEAUX_ACTIVITE}
          onChange={(v) => maj({ activite: v })}
        />
        <SelectAttribut
          label="Fréquence d'infractions"
          valeur={item.infraction ?? 'low'}
          options={NIVEAUX_INFRACTION}
          onChange={(v) => maj({ infraction: v })}
        />
        <SelectAttribut
          label="Position / ville"
          valeur={item.positionVille ?? 'none'}
          options={POSITIONS_VILLE}
          onChange={(v) => maj({ positionVille: v })}
        />
        <SelectAttribut
          label="Éclairage nocturne"
          valeur={item.eclairage ?? 'inconnu'}
          options={ECLAIRAGE}
          onChange={(v) => maj({ eclairage: v })}
        />
      </div>

      {estPointNoir && (
        <BarrageDepuisPointNoir
          item={item}
          barragesLies={barragesLies}
          onOuvrirBarrageLie={onOuvrirBarrageLie}
          onGenererBarrage={onGenererBarrage}
          generationEnCours={generationEnCours}
        />
      )}

      {/*
        VALIDATION RETIRÉE DE L'INTERFACE — voir `statutBarrage`.

        Le bloc proposait quatre états (en attente / approuvé / à modifier /
        annulé). Il est retiré à la demande, provisoirement.

        LA DONNÉE, ELLE, RESTE : le champ existe toujours sur chaque barrage, le
        serveur continue de le valider et de n'en autoriser le changement qu'à
        un administrateur, et `GendarmerieMap` le renvoie inchangé à chaque
        modification de fiche — sans quoi toute correction de nom aurait remis
        les barrages « en attente ». Le concept se rebranche donc en réaffichant
        ce bloc, sans migration.
      */}
    </div>
  );
}

/** Qui est affecté à ce poste ? — barrages seulement. */
export function GroupePatrouilles({ item, maj }) {
  const liste = item.patrouilles ?? [];

  return (
    <div className="space-y-2">
      {liste.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/12 px-3 py-5 text-center text-[12px] text-white/40">
          Aucune patrouille affectée pour l’instant.
        </p>
      )}

      {liste.map((p, i) => {
        const majPatrouille = (champPatch) => {
          const copie = liste.map((x) => ({ ...x }));
          copie[i] = { ...copie[i], ...champPatch };
          maj({ patrouilles: copie });
        };

        return (
          <div key={i} className="space-y-1.5 rounded-xl border border-white/10 bg-white/6 p-2.5">
            <div className="flex items-center gap-1.5">
              <input
                className={champ}
                value={p.nom ?? ''}
                onChange={(e) => majPatrouille({ nom: e.target.value })}
                placeholder={`Patrouille ${i + 1} (nom)`}
              />
              <button
                type="button"
                onClick={() => maj({ patrouilles: liste.filter((_, j) => j !== i) })}
                aria-label="Retirer cette patrouille"
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 text-white/60 hover:bg-white/16"
              >
                <IconClose size={13} />
              </button>
            </div>

            <input
              className={champ}
              value={p.unite ?? ''}
              onChange={(e) => majPatrouille({ unite: e.target.value })}
              placeholder="Unité (si différente de celle du barrage)"
            />

            <div className="grid grid-cols-3 gap-1.5">
              <input
                type="date"
                className={champ}
                value={p.date ?? ''}
                onChange={(e) => majPatrouille({ date: e.target.value })}
              />
              <input
                type="time"
                className={champ}
                value={p.debut ?? ''}
                onChange={(e) => majPatrouille({ debut: e.target.value })}
              />
              <input
                type="time"
                className={champ}
                value={p.fin ?? ''}
                onChange={(e) => majPatrouille({ fin: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="number"
                min={0}
                className={champ}
                value={p.effectif || ''}
                onChange={(e) => majPatrouille({ effectif: e.target.value })}
                placeholder="Effectif"
              />
              <input
                className={champ}
                value={p.vehicule ?? ''}
                onChange={(e) => majPatrouille({ vehicule: e.target.value })}
                placeholder="Véhicule (immatriculation)"
              />
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() =>
          maj({
            patrouilles: [
              ...liste,
              { nom: '', unite: '', date: '', debut: '', fin: '', effectif: '', vehicule: '' },
            ],
          })
        }
        className={`${bouton} w-full bg-white/10 py-2.5 text-white/80 hover:bg-white/16`}
      >
        <IconPlus size={13} /> Ajouter une patrouille
      </button>
    </div>
  );
}

/** Quand, et quoi noter ? */
export function GroupeHoraires({ item, maj }) {
  const type = TYPE_PAR_CLE[item.type];

  return (
    <div className="space-y-2.5">
      <div>
        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-white/75">
          <IconHoraire size={13} />
          Créneau {type.horaires ? '' : '(facultatif)'}
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="time"
            className={champ}
            value={item.debut ?? ''}
            onChange={(e) => maj({ debut: e.target.value })}
          />
          <span className="text-white/35">→</span>
          <input
            type="time"
            className={champ}
            value={item.fin ?? ''}
            onChange={(e) => maj({ fin: e.target.value })}
          />
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-[12px] font-semibold text-white/75">Observation</span>
        <textarea
          rows={3}
          className={`${champ} resize-none`}
          value={item.note ?? ''}
          onChange={(e) => maj({ note: e.target.value })}
          placeholder="Sortie de souk le dimanche, visibilité réduite…"
        />
      </label>
    </div>
  );
}

/**
 * SUPPRESSION — EN DEUX TEMPS, ET POUR TOUTES LES NATURES.
 *
 * Un barrage n'avait ici aucun bouton, seulement un avis renvoyant vers
 * OPTIMISATION : le serveur refusait le geste, l'afficher aurait menti. Il ne
 * refuse plus (voir la note sur la suppression dans serveur/api.mjs) — qui a
 * autorité d'écriture sur le périmètre efface le repère, barrage compris.
 *
 * Le retrait CONCERTÉ d'un poste en service existe toujours dans OPTIMISATION :
 * c'est une autre chose, et elle a son propre écran.
 *
 * Deux temps dans tous les cas : un marquage effacé n'est pas récupérable.
 */
export function GroupeSuppression({ onDelete }) {
  const [confirme, setConfirme] = useState(false);

  return confirme ? (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={onDelete}
        className={`${bouton} flex-1 bg-gr-red py-2.5 text-white hover:brightness-110`}
      >
        <IconPoubelle size={14} /> Confirmer la suppression
      </button>
      <button
        type="button"
        onClick={() => setConfirme(false)}
        className={`${bouton} flex-1 bg-white/10 py-2.5 text-white/80 hover:bg-white/16`}
      >
        Annuler
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setConfirme(true)}
      className={`${bouton} w-full bg-gr-red/15 py-2.5 text-gr-red hover:bg-gr-red/25`}
    >
      <IconPoubelle size={14} /> Supprimer ce repère
    </button>
  );
}

/**
 * LES GROUPES QUI S'APPLIQUENT À CE REPÈRE, dans l'ordre où on les remplit.
 *
 * Une seule source pour les deux emplois : le parcours en fait des étapes, la
 * fiche complète les empile. Sans cette liste, l'ordre et les conditions
 * auraient été recopiés des deux côtés — et auraient divergé.
 *
 * @returns {Array<{cle:string,titre:string,ar:string,aide:string,rendu:Function}>}
 */
export function groupesFiche(item) {
  const estBarrage = MQ.estBarrage(item);
  const estPointNoir = item.type === 'accident';

  return [
    {
      cle: 'identification',
      titre: 'De quel lieu parle-t-on ?',
      ar: 'تحديد المكان',
      aide: 'Le nom sert à retrouver ce repère dans les listes et les recherches.',
      rendu: (p) => <GroupeIdentification {...p} />,
    },
    (estBarrage || estPointNoir) && {
      cle: 'caracteristiques',
      titre: 'Que vaut ce point ?',
      ar: 'خصائص النقطة',
      aide: 'Ces critères décident de son importance, et servent à le retrouver parmi les points sensibles.',
      rendu: (p) => <GroupeCaracteristiques {...p} />,
    },
    estBarrage && {
      cle: 'patrouilles',
      titre: 'Qui est affecté à ce poste ?',
      ar: 'الدوريات',
      aide: 'Facultatif. L’effectif du créneau se saisit ailleurs — ici on note les patrouilles rattachées au poste.',
      rendu: (p) => <GroupePatrouilles {...p} />,
    },
    {
      cle: 'horaires',
      titre: 'Créneau et observation',
      ar: 'التوقيت وملاحظات',
      aide: 'Les deux sont facultatifs pour la plupart des natures.',
      rendu: (p) => <GroupeHoraires {...p} />,
    },
  ].filter(Boolean);
}

/**
 * LA FICHE COMPLÈTE — tous les groupes d'affilée.
 *
 * Employée par la vue aérienne (`Modal3D`), qui a la place et où l'on corrige
 * au vol. Le parcours de SAISIE TERRAIN, lui, affiche un groupe par étape.
 */
export function Formulaire({
  item,
  important,
  distanceProcheKm,
  session,
  onChange,
  onDelete,
  onCadrer,
  onVue3D,
  onGenererBarrage,
  generationEnCours,
  barragesLies,
  onOuvrirBarrageLie,
  // Masque les actions liées à la carte principale (vue aérienne, cadrage) —
  // utile quand le formulaire est réutilisé DANS la vue aérienne elle-même
  // (Modal3D), où ces boutons n'ont pas de sens.
  masquerActionsCarte = false,
}) {
  const maj = (patch) => onChange({ ...item, ...patch });
  const commun = {
    item,
    maj,
    session,
    important,
    distanceProcheKm,
    barragesLies,
    onOuvrirBarrageLie,
    onGenererBarrage,
    generationEnCours,
  };

  return (
    <div className="space-y-3 rounded-xl border border-white/12 bg-white/6 p-2.5">
      <EnTeteFiche
        item={item}
        onCadrer={onCadrer}
        onVue3D={onVue3D}
        masquerActionsCarte={masquerActionsCarte}
      />

      {groupesFiche(item).map((g) => (
        <section key={g.cle}>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gr-gold/70">
            {g.titre}
          </p>
          {g.rendu(commun)}
        </section>
      ))}

      <GroupeSuppression onDelete={onDelete} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Qualification d'un point noir à la pose                            */
/* ------------------------------------------------------------------ */

/**
 * Modale affichée immédiatement au clic pour poser un point noir accidents :
 * le repère n'est envoyé au serveur qu'une fois ces attributs renseignés — au
 * lieu de le créer vide puis de le compléter dans la fiche, comme pour les
 * autres natures. Ce sont ces mêmes attributs qui décident si le point est
 * « important » (voir `estImportant` dans `marquages.js`).
 */
export function PointNoirModal({ onConfirmer, onAnnuler }) {
  const [valeurs, setValeurs] = useState({
    accidentCount: 0,
    severite: 'none',
    activite: 'low',
    infraction: 'low',
    positionVille: 'none',
    eclairage: 'inconnu',
  });
  const appuiSurFond = useRef(false);

  const maj = (patch) => setValeurs((v) => ({ ...v, ...patch }));

  /**
   * CLIC SUR LE FOND SOMBRE = ANNULER, comme le bouton : cliquer à côté est le
   * geste qu'on tente d'instinct pour renoncer.
   *
   * Deux garde-fous, car renoncer perd les critères déjà saisis : le
   * relâchement doit viser le fond LUI-MÊME (et non remonter du formulaire), et
   * l'appui doit avoir commencé dessus — un glissement parti d'un champ et
   * relâché hors du cadre émet son `click` sur le fond, leur premier ancêtre
   * commun, et annulerait la saisie.
   */
  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Qualifier le point noir"
      className="pointer-events-auto fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        appuiSurFond.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (appuiSurFond.current && e.target === e.currentTarget) onAnnuler();
      }}
    >
      <form
        className="w-[340px] max-w-full space-y-3 rounded-2xl border border-white/10 bg-gr-navy/95 p-4 shadow-panel"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmer(valeurs);
        }}
      >
        <header className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy">
            <IconAccident size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-gr-gold/70">
              Étape 1/2 — Qualifier
            </span>
            <h2 className="truncate text-[17px] font-bold leading-tight tracking-[-0.01em] text-white">
              QUALIFIER LE POINT NOIR
            </h2>
            <p dir="rtl" className="truncate text-[13px] leading-tight text-gr-gold/70">
              تحديد خصائص نقطة الحوادث
            </p>
          </div>
        </header>

        <p className="flex items-start gap-1.5 rounded-lg bg-gr-gold/10 px-2.5 py-1.5 text-[10px] leading-snug text-gr-gold/90">
          <IconTarget size={13} className="mt-px shrink-0" />
          <span>
            Après ces critères, l'étape suivante vous demandera de{' '}
            <strong>choisir l'emplacement</strong> sur la carte (ou d'entrer ses coordonnées GPS).
          </span>
        </p>

        <label className="block">
          <span className="mb-0.5 block text-[10px] text-white/50">Nombre d'accidents</span>
          <input
            type="number"
            min={0}
            autoFocus
            className={champ}
            value={valeurs.accidentCount}
            onChange={(e) => maj({ accidentCount: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>

        <div className="grid grid-cols-2 gap-1.5">
          <SelectAttribut
            label="Sévérité"
            valeur={valeurs.severite}
            options={SEVERITES}
            onChange={(v) => maj({ severite: v })}
          />
          <SelectAttribut
            label="Activité routière"
            valeur={valeurs.activite}
            options={NIVEAUX_ACTIVITE}
            onChange={(v) => maj({ activite: v })}
          />
          <SelectAttribut
            label="Fréquence d'infractions"
            valeur={valeurs.infraction}
            options={NIVEAUX_INFRACTION}
            onChange={(v) => maj({ infraction: v })}
          />
          <SelectAttribut
            label="Position / ville"
            valeur={valeurs.positionVille}
            options={POSITIONS_VILLE}
            onChange={(v) => maj({ positionVille: v })}
          />
          <SelectAttribut
            label="Éclairage nocturne"
            valeur={valeurs.eclairage}
            options={ECLAIRAGE}
            onChange={(v) => maj({ eclairage: v })}
          />
        </div>

        <p className="text-[10px] leading-snug text-white/45">
          Le lieu, la route et l'observation se complètent après, dans la fiche du repère.
        </p>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={onAnnuler}
            className={`${bouton} flex-1 bg-white/10 text-white/80 hover:bg-white/16`}
          >
            Annuler
          </button>
          <button
            type="submit"
            className={`${bouton} flex-1 bg-gr-gold text-gr-navy hover:brightness-110`}
          >
            <IconTarget size={14} />
            Choisir l'emplacement sur la carte
          </button>
        </div>
      </form>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

/* Le filtre de génération en masse (GenerationFiltre, NIVEAUX_MIN et son
   réglage initial) a été retiré avec la section « Barrages-projets » : le
   dispositif se pilote par OPTIMISATION, qui raisonne sur le parc existant
   plutôt que d'en créer davantage. La génération depuis UN point noir précis
   reste dans sa fiche — voir `BarrageDepuisPointNoir`. */

/* ------------------------------------------------------------------ */
/* Connexion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Formulaire d'habilitation : rang, unité, code.
 *
 * Le code part au serveur et n'est jamais conservé — ni dans le stockage local,
 * ni dans l'état après l'envoi. La session est un cookie `HttpOnly` : cette
 * page ne peut pas le lire, donc elle ne peut pas le divulguer.
 */
function Connexion({ unites, service, onConnexion, occupe }) {
  const [rang, setRang] = useState('cie');
  const [unite, setUnite] = useState('');
  const [code, setCode] = useState('');

  const liste =
    rang === 'cie'
      ? (unites?.compagnies ?? [])
      : rang === 'unite'
        ? (unites?.unites ?? [])
        : rang === 'reg'
          ? (unites?.regions ?? [])
          : [];

  /**
   * Deux niveaux comptent trop d'entrées pour une liste plate : les
   * compagnies (62) groupées par région, les brigades territoriales (~500)
   * groupées par compagnie. `admin` n'a pas de liste — voir le rendu.
   */
  const groupes = useMemo(() => {
    if (rang === 'cie') {
      const m = new Map();
      for (const c of liste) {
        if (!m.has(c.reg)) m.set(c.reg, []);
        m.get(c.reg).push(c.nom);
      }
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr'));
    }
    if (rang === 'unite') {
      const m = new Map();
      for (const u of liste) {
        if (!m.has(u.cie)) m.set(u.cie, []);
        m.get(u.cie).push(u.nom);
      }
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr'));
    }
    return null;
  }, [rang, liste]);

  if (service?.indisponible) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-gr-red/12 px-2 py-1.5 text-[10px] leading-snug text-gr-red">
        <IconAlert size={13} className="mt-px shrink-0" />
        <span>
          Serveur d'habilitation injoignable : la saisie est indisponible. La carte reste
          consultable. (Le service tourne avec <code>node serve.mjs</code>.)
        </span>
      </p>
    );
  }

  if (service && service.comptes === 0) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-gr-red/12 px-2 py-1.5 text-[10px] leading-snug text-gr-red">
        <IconAlert size={13} className="mt-px shrink-0" />
        <span>
          Aucun compte n'est déclaré sur le serveur : personne ne peut saisir. À créer avec{' '}
          <code>node scripts/comptes.mjs --initialiser</code>.
        </span>
      </p>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onConnexion(rang, unite, code, () => setCode(''));
      }}
    >
      {/* Rang : des boutons plutôt qu'une liste — le choix est structurant. */}
      <div className="grid grid-cols-2 gap-1.5">
        {Object.entries(RANGS_FR).map(([cle, libelleRang]) => (
          <button
            key={cle}
            type="button"
            role="radio"
            aria-checked={rang === cle}
            onClick={() => {
              setRang(cle);
              setUnite('');
            }}
            className={`${bouton} ${
              rang === cle
                ? 'bg-gr-gold text-gr-navy'
                : 'bg-white/8 text-white/70 hover:bg-white/14'
            }`}
          >
            <IconChef size={14} /> {libelleRang}
          </button>
        ))}
      </div>

      {rang === 'admin' ? (
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-white/50">Identifiant</span>
          <input
            className={champ}
            value={unite}
            onChange={(e) => setUnite(e.target.value)}
            placeholder="national"
            required
          />
        </label>
      ) : (
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-white/50">
            {rang === 'cie' ? 'Compagnie' : rang === 'reg' ? 'Région' : 'Brigade territoriale'}
          </span>
          <select
            className={champ}
            value={unite}
            onChange={(e) => setUnite(e.target.value)}
            required
          >
            <option value="">— choisir —</option>
            {groupes
              ? groupes.map(([parent, noms]) => (
                  <optgroup key={parent} label={parent}>
                    {noms
                      .sort((a, b) => a.localeCompare(b, 'fr'))
                      .map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                  </optgroup>
                ))
              : liste.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className="mb-0.5 block text-[10px] text-white/50">Code d'habilitation</span>
        <input
          type="password"
          className={`${champ} font-mono tracking-widest`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          required
        />
      </label>

      <button
        type="submit"
        disabled={!unite || !code || occupe}
        className={`${bouton} w-full bg-gr-gold text-gr-navy hover:brightness-110 disabled:opacity-40`}
      >
        {occupe ? <IconSpinner size={14} /> : <IconVerrou size={14} />}
        {occupe ? 'Vérification…' : 'Se connecter'}
      </button>

      <p className="text-[10px] leading-snug text-white/45">
        Le code est vérifié par le serveur (empreinte PBKDF2), jamais par le navigateur. Cinq échecs
        bloquent l'unité 15 minutes.
      </p>
    </form>
  );
}

const RANGS_FR = { unite: 'Brigade', cie: 'Compagnie', reg: 'Région', admin: 'Admin' };
/** Le mot qui désigne le périmètre d'écriture de la session, dans une phrase. */
const perimetreMot = (rang) =>
  rang === 'reg'
    ? 'votre région'
    : rang === 'cie'
      ? 'votre circonscription'
      : 'votre brigade territoriale';

/* ------------------------------------------------------------------ */
/* Panneau                                                            */
/* ------------------------------------------------------------------ */
/* Choisir un repère dans le périmètre                                */
/* ------------------------------------------------------------------ */

/**
 * LA LISTE DES REPÈRES, avec recherche.
 *
 * Elle était enfermée dans un bloc pliable au bas du panneau, sous la fiche —
 * donc sous plusieurs écrans de défilement — et sans aucun moyen de chercher :
 * un chef de région en compte plusieurs centaines, et il fallait les parcourir
 * à l'œil.
 *
 * Elle est ici l'étape « quel repère corriger ? », et elle filtre sur le nom,
 * la route et l'unité de rattachement. Le tri d'origine est conservé : par
 * nature, puis par nom.
 */
function ListeMarquages({ items, session, selection, onSelectionner, onCadrer, onSupprimer }) {
  const [recherche, setRecherche] = useState('');

  const visibles = useMemo(() => {
    const q = sansAccent(recherche).trim();
    const tries = items
      .slice()
      .sort((a, b) => a.type.localeCompare(b.type) || libelle(a).localeCompare(libelle(b), 'fr'));
    if (!q) return tries;
    return tries.filter((m) =>
      [libelle(m), m.route, m.bt, m.cie, m.reg, TYPE_PAR_CLE[m.type]?.fr]
        .filter(Boolean)
        .some((champTexte) => sansAccent(champTexte).includes(q)),
    );
  }, [items, recherche]);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[12.5px] leading-relaxed text-white/40">
        {session.rang === 'admin'
          ? 'Aucun repère saisi.'
          : `Aucun repère saisi dans ${perimetreMot(session.rang)}.`}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-white/75">
          <IconLoupe size={13} /> Rechercher
        </span>
        <input
          className={champ}
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Nom, route, brigade…"
        />
      </label>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/12 px-3 py-5 text-center text-[12px] text-white/40">
          Aucun repère ne correspond à « {recherche} ».
        </p>
      ) : (
        <>
          <p className="text-[11px] text-white/40">
            {visibles.length} sur {items.length}
          </p>
          <ul className="max-h-[46vh] space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
            {visibles.map((m) => {
              const t = TYPE_PAR_CLE[m.type];
              const Icon = TYPE_ICONS[m.type];
              const actif = m.id === selection;
              return (
                <li
                  key={m.id}
                  className={`flex items-center gap-1 rounded-lg ${
                    actif ? 'bg-gr-gold/18' : 'hover:bg-white/8'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectionner(actif ? null : m.id);
                      if (!actif) onCadrer(m);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left
                      focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
                  >
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-md"
                      style={{ backgroundColor: t.color, color: '#0b1220' }}
                    >
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-white/90">
                        {libelle(m)}
                      </span>
                      <span className="block truncate text-[10.5px] text-white/45">
                        {/* Un chef de région ou de compagnie couvre plusieurs
                            unités plus fines : sans ce rappel, deux repères
                            homonymes seraient indistinguables dans la liste. */}
                        {[
                          session.rang === 'admin'
                            ? [m.reg, m.cie, m.bt].filter(Boolean).join(' > ')
                            : session.rang === 'reg'
                              ? m.cie
                              : session.rang === 'cie'
                                ? m.bt
                                : null,
                          m.route,
                          plage(m),
                        ]
                          .filter(Boolean)
                          .join(' · ') || t.fr}
                      </span>
                    </span>
                    {actif && <IconCoche size={15} className="shrink-0 text-gr-gold" />}
                  </button>
                  {/* Suppression directe depuis la liste — voir
                      BoutonSupprimerLigne. Les barrages en étaient exclus
                      parce que le serveur refusait leur retrait ; il ne le
                      refuse plus, et le seul critère est désormais le droit
                      d'écriture. */}
                  {onSupprimer && peutModifier(session, m) && (
                    <BoutonSupprimerLigne nom={libelle(m)} onSupprimer={() => onSupprimer(m.id)} />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function MarquagePanel({
  open,
  onOpen,
  onClose,
  session, // {rang, unite, reg} ou null
  service, // {comptes, contours…} ou {indisponible:true}
  unites, // {compagnies:[{nom,reg}], regions:[nom]}
  occupe, // une requête est en cours
  onConnexion,
  onDeconnexion,
  items, // marquages relevant de l'unité connectée
  total, // tous marquages connus
  arme, // nature armée, ou null
  onArmer,
  selection, // id du marquage ouvert dans le formulaire
  onSelectionner,
  onModifier,
  onSupprimer,
  onCadrer,
  onViserBarrage,
  brigadeDemandee,
  onVue3D,
  onExporter,
  onImporter,
  message, // dernier retour d'action (refus, import…)
  importants, // Map id -> {important, distanceProcheKm}, points noirs seulement
  onGenererBarrageManuel, // (pointNoirId, type) -> barrage unique, sans filtre d'importance
  generationEnCours,
  demandeTache, // {cle, type?, ts} — accès direct depuis la navigation principale
}) {
  const fichier = useRef(null);

  /**
   * LA TÂCHE EN COURS, et l'étape où l'on en est.
   *
   * `null` = le menu. Les deux vivent ici et non dans `Parcours` : c'est ce
   * panneau qui sait qu'une tâche neuve relâche l'outil de la précédente, et
   * qu'un repère fraîchement posé fait avancer d'une étape tout seul.
   *
   * `useParcours` REMET LES DEUX À ZÉRO à chaque ouverture : l'étape, et la
   * tâche. Rouvrir sur l'étape 1 d'une tâche qu'on n'a pas choisie n'aurait
   * pas de sens — on revient au menu « Que voulez-vous faire ? ».
   *
   * L'outil de pose est relâché avec, sinon le panneau se rouvrirait armé, et
   * un clic sur la carte poserait un repère qu'on n'a pas demandé.
   *
   * `onSelectionner` N'EST PAS remis à zéro, à dessein : ouvrir la saisie
   * depuis la bulle d'un repère doit garder ce repère désigné.
   */
  const [tache, setTache] = useState(null);
  const { indice: etape, setIndice: setEtape } = useParcours(
    open,
    () => {
      setTache(null);
      onArmer(null);
    },
    /* La branche : changer de tâche mène à sa première étape (indice 1), sans
       qu'aucun appelant n'écrive d'indice. Voir `useParcours`. */
    tache,
  );

  /**
   * La barre de commandement peut mener directement à une tâche connue
   * (nouveau barrage ou relève), sans dupliquer le parcours ni ses règles.
   * Le timestamp rejoue volontairement la demande si l'utilisateur reclique.
   */
  useEffect(() => {
    if (!open || !demandeTache?.cle) return;
    if (demandeTache.cle === 'menu') {
      setTache(null);
      onArmer(null);
      return;
    }
    setTache(demandeTache.cle);
    onArmer(demandeTache.type ?? null);
    if (demandeTache.cle === 'poser') onSelectionner(null);
  }, [open, demandeTache, onArmer, onSelectionner]);

  /**
   * LE REPÈRE POSÉ FAIT AVANCER TOUT SEUL.
   *
   * L'étape « Où le poser ? » attend un clic sur la carte. `GendarmerieMap`
   * crée alors le repère ET le sélectionne (voir `creerMarquagePoint`).
   * L'utilisateur n'a donc plus rien à faire là : rester sur une étape dont la
   * consigne est accomplie l'obligerait à appuyer sur SUIVANT pour constater
   * qu'il a déjà réussi.
   *
   * Uniquement dans la tâche « poser », et uniquement depuis cette étape :
   * sélectionner un repère dans la liste, en « corriger », ne doit pas faire
   * sauter d'étape.
   */
  useEffect(() => {
    /* PANNEAU REPLIÉ : RIEN À FAIRE AVANCER, et surtout rien à lire.
       `etapes` est construit plus bas, APRÈS la sortie anticipée : sur un rendu
       replié il n'est jamais assigné, et le lire ici ferait tomber toute
       l'application (« Cannot access 'etapes' before initialization »). Le même
       défaut a été corrigé dans OptimisationPanel.jsx ; ici la bonne réponse
       est de renoncer, puisqu'un parcours invisible n'a pas d'étape courante. */
    if (!open) return;
    if (tache !== 'poser' || !selection) return;
    /* PAR LES CLÉS, jamais par des nombres : « position » était l'indice 1 et
       la suite 2 avant que l'étape de choix ne passe en tête ; 2 et 3 après.
       Voir `indiceDe`. */
    const position = indiceDe(etapes, 'position');
    if (position > -1 && etape === position) setEtape(position + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tache, etape, selection]);

  /**
   * LES ÉTAPES DU RELEVÉ D'EFFECTIF, fournies par `useEtapesEffectif`.
   *
   * Appelé inconditionnellement — règle des crochets — mais `actif` lui évite
   * d'appeler le serveur pour une tâche que personne ne regarde.
   */
  const { etapes: etapesEffectif, correctionVoulue } = useEtapesEffectif({
    session,
    items,
    onViser: onViserBarrage,
    demande: brigadeDemandee,
    actif: tache === 'effectif',
  });

  /**
   * « MODIFIER L'EFFECTIF » DEPUIS LA BULLE D'UN BARRAGE mène ici, et
   * directement à la correction du poste désigné.
   *
   * Deux effets, parce que ce sont deux faits distincts : l'arrivée d'une
   * demande ouvre la tâche, et la demande d'un POSTE précis saute à l'étape de
   * correction. Les fondre ferait sauter l'étape même quand on demande une
   * brigade entière, où il n'y a rien à corriger d'emblée.
   */
  useEffect(() => {
    if (!brigadeDemandee?.ts) return;
    /* La tâche seule : `useParcours` mène à sa première étape (indice 1) dès
       que `tache` change. Écrire un indice ici viserait le menu. */
    setTache('effectif');
  }, [brigadeDemandee?.ts]);

  useEffect(() => {
    /* Replié : voir la note de l'effet « poser » ci-dessus — `etapes` n'existe
       pas sur un rendu replié. */
    if (!open) return;
    if (!correctionVoulue) return;
    /* Sur le tableau RENDU, qui commence par l'étape de choix — chercher dans
       `etapesEffectif` seul donnait un indice décalé d'un cran. */
    const i = indiceDe(etapes, 'corriger');
    if (i > -1) setEtape(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correctionVoulue]);

  const parType = useMemo(() => {
    const c = Object.fromEntries(TYPES_MARQUAGE.map((t) => [t.key, 0]));
    for (const m of items) c[m.type] = (c[m.type] ?? 0) + 1;
    return c;
  }, [items]);

  const ouvert = items.find((m) => m.id === selection) ?? null;

  /** Barrage(s) déjà généré(s) depuis CE point noir précis — voir `origineId` dans serveur/depot.mjs. */
  const barragesLies = useMemo(
    () =>
      ouvert?.type === 'accident'
        ? items.filter(
            (m) =>
              MQ.estBarrage(m) &&
              m.origineId === ouvert.id,
          )
        : [],
    [items, ouvert],
  );

  const ouvrirBarrageLie = (barrage) => {
    onSelectionner(barrage.id);
    onCadrer(barrage);
  };

  /* Le bouton d’ouverture est rendu par GendarmerieMap (colonne de
     boutons) : empilé ici, il repoussait le panneau ouvert hors écran. */
  if (!open) return null;

  
  /**
   * QUATRE TÂCHES, ET NON UN SEUL ÉCRAN.
   *
   * Le panneau empilait dans un tiroir de 336 px : l'habilitation, le relevé
   * de l'effectif du créneau, le choix d'une nature à poser, la fiche du
   * repère ouvert (vingt champs), la liste de tous les marquages, et l'échange
   * de fichier. Cinq blocs pliables, vingt-deux boutons, vingt champs. Rien ne
   * disait lequel servait au geste qu'on venait faire.
   *
   * Ce sont pourtant QUATRE TÂCHES SANS RAPPORT entre elles. On les demande
   * donc d'abord, et l'on ne montre ensuite que ce qui les sert.
   *
   * L'ordre suit la fréquence réelle du terrain : on relève quatre fois par
   * jour qui tient un poste ; on en pose un nouveau rarement.
   */
  const tachesPossibles = [
    {
      cle: 'effectif',
      libelle: 'Relever l’effectif présent',
      ar: 'العناصر الحاضرة',
      aide: 'Qui tient les postes sur le créneau en cours. Le geste le plus fréquent.',
      icone: IconPointage,
    },
    {
      cle: 'poser',
      libelle: 'Poser un nouveau repère',
      ar: 'إضافة نقطة',
      aide: 'Barrage, point de congestion, point noir… posé d’un clic sur la carte.',
      icone: IconPlus,
    },
    {
      cle: 'corriger',
      libelle: 'Corriger un repère existant',
      ar: 'تعديل نقطة',
      aide: `${items.length} repère(s) dans votre périmètre.`,
      icone: IconCrayon,
      desactive: items.length === 0,
    },
    {
      cle: 'echanger',
      libelle: 'Échanger un fichier',
      ar: 'تصدير / استيراد',
      aide: 'Exporter un GeoJSON pour le commandement, ou importer celui d’un autre poste.',
      icone: IconExport,
    },
  ];

  /* Le repère sur lequel porte la tâche en cours — celui de la liste, ou celui
     qu'on vient de poser (`GendarmerieMap` le sélectionne aussitôt créé). */
  const commun = ouvert
    ? {
        item: ouvert,
        maj: (patch) => onModifier({ ...ouvert, ...patch }),
        session,
        important: importants?.get(ouvert.id)?.important ?? false,
        distanceProcheKm: importants?.get(ouvert.id)?.distanceProcheKm ?? null,
        barragesLies,
        onOuvrirBarrageLie: ouvrirBarrageLie,
        onGenererBarrage: onGenererBarrageManuel,
        generationEnCours,
      }
    : null;

  /** Les étapes de fiche, communes à « poser » et à « corriger ». */
  const etapesFiche = ouvert
    ? groupesFiche(ouvert).map((g) => ({
        cle: g.cle,
        titre: g.titre,
        ar: g.ar,
        aide: g.aide,
        carte: true,
        valide: true,
        contenu: (
          <div className="space-y-3">
            <EnTeteFiche item={ouvert} onCadrer={() => onCadrer(ouvert)} onVue3D={onVue3D} />
            {g.rendu(commun)}
          </div>
        ),
      }))
    : [];

  /**
   * L'ÉTAPE DE VÉRIFICATION D'UN REPÈRE.
   *
   * Elle relit ce qui a été saisi et porte la suppression. Elle n'enregistre
   * rien : la fiche écrit à chaque frappe, comme avant — découper l'affichage
   * ne découpe pas la sauvegarde, et aucun brouillon n'a été inventé.
   */
  const etapeVerification = ouvert && {
    cle: 'verification',
    titre: 'Vérification',
    ar: 'التحقق',
    aide: 'Tout est déjà enregistré : la fiche écrit à mesure que vous saisissez. Relisez, et fermez.',
    valide: true,
    contenu: (
      <div className="space-y-3">
        <Recap
          titre="Le repère"
          lignes={[
            { libelle: 'Nature', valeur: TYPE_PAR_CLE[ouvert.type]?.fr, accent: true },
            { libelle: 'Lieu', valeur: ouvert.nom || null },
            { libelle: 'Route', valeur: ouvert.route || null },
            { libelle: 'Créneau', valeur: plage(ouvert) || null },
            { libelle: 'Brigade', valeur: ouvert.bt || null },
            { libelle: 'Compagnie', valeur: ouvert.cie || null },
            { libelle: 'Région', valeur: ouvert.reg || null },
            {
              libelle: 'Position',
              valeur: `${ouvert.lat.toFixed(5)}, ${ouvert.lng.toFixed(5)}`,
            },
            { libelle: 'Observation', valeur: ouvert.note || null },
          ]}
        />

        {peutModifier(session, ouvert) ? (
          <GroupeSuppression onDelete={() => onSupprimer(ouvert.id)} />
        ) : (
          <Note>
            Ce repère est hors de votre autorité d’écriture : vous pouvez le consulter, non le
            modifier.
          </Note>
        )}
      </div>
    ),
  };

  /* ---------------------------------------------------------------- */
  /* Les étapes, selon l'habilitation puis la tâche                   */
  /* ---------------------------------------------------------------- */

  let etapes;

  if (!session) {
    /* NON CONNECTÉ : une seule question. Tant que la session n'existe pas, le
       parcours ne va pas plus loin — et il dit pourquoi. */
    etapes = [
      {
        cle: 'habilitation',
        titre: 'Identifiez-vous',
        ar: 'الهوية',
        aide: 'La saisie engage votre unité : chaque repère porte le nom de qui l’a posé.',
        valide: false,
        empeche: 'Renseignez votre unité et votre code, puis validez.',
        contenu: (
          <Connexion
            unites={unites}
            service={service}
            occupe={occupe}
            onConnexion={onConnexion}
          />
        ),
      },
    ];
  } else {
    /**
     * L'ÉTAPE DE CHOIX RESTE EN TÊTE, elle ne disparaît plus.
     *
     * Le tableau était REMPLACÉ par celui de la tâche dès qu'on en choisissait
     * une, et le gestionnaire de choix écrivait `setEtape(1)` — un 1 recopié
     * d'ORGANISATION, dont l'étape de choix, elle, reste dans le tableau. Le
     * résultat était visible : « Poser un nouveau repère » ouvrait « Où le
     * poser ? », étape 2 sur 2, en sautant « Quelle nature ? ». Sans nature
     * armée, cette étape ne pouvait jamais être franchie.
     *
     * Les trois sections branchées ont maintenant la même forme : le choix est
     * l'étape 1, les étapes de la branche suivent, et c'est `useParcours` qui
     * mène à l'indice 1 quand la branche change. Aucun appelant ne manipule
     * plus d'indice.
     *
     * Bénéfice supplémentaire : le choix reste visible dans la barre
     * d'avancement, et un clic sur son segment y ramène.
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
              /* Une tâche neuve ne reprend pas l'outil de la précédente. */
              if (cle !== 'poser') onArmer(null);
              if (cle === 'poser') onSelectionner(null);
            }}
            options={tachesPossibles}
          />

          <Recap
            titre="Vous êtes"
            lignes={[
              { libelle: RANGS_SAISIE[session.rang] ?? 'Unité', valeur: session.unite, accent: true },
              { libelle: 'Rôle', valeur: ROLES_SAISIE[session.role] ?? session.role },
              { libelle: 'Repères de votre périmètre', valeur: items.length },
            ]}
          />

          <button
            type="button"
            onClick={onDeconnexion}
            className={`${bouton} w-full bg-white/8 py-2.5 text-white/70 hover:bg-white/14`}
          >
            <IconVerrou size={14} /> Se déconnecter
          </button>
        </div>
      ),
    };

    /** Les étapes de la tâche choisie — vide tant qu'aucune ne l'est. */
    let deLaTache = [];

    if (tache === 'effectif') {
      /* LES ÉTAPES VIENNENT DU RELEVÉ LUI-MÊME, et s'insèrent dans CE
         parcours : une seule barre d'avancement, celle d'ici. Voir
         `useEtapesEffectif`. */
      deLaTache = etapesEffectif;
    } else if (tache === 'poser') {
      deLaTache = [
      {
        cle: 'nature',
        titre: 'Quelle nature de repère ?',
        ar: 'نوع النقطة',
        aide: 'Un seul choix : c’est lui qui décide des champs à renseigner ensuite.',
        valide: Boolean(arme),
        empeche: 'Choisissez la nature du repère à poser.',
        contenu: (
          <div className="space-y-3">
            <Choix
              nom="Nature à poser"
              valeur={arme}
              onChange={(cle) => onArmer(cle)}
              options={posables(session).map((t) => ({
                cle: t.key,
                libelle: t.fr,
                ar: t.ar,
                icone: TYPE_ICONS[t.key],
                aide:
                  (parType[t.key] ?? 0) > 0
                    ? `${parType[t.key]} déjà dans votre périmètre.`
                    : 'Aucun dans votre périmètre.',
              }))}
            />

            {session.rang !== 'admin' && (
              <Note>
                La déclaration d’un <b className="text-white/80">point noir</b> relève du
                commandement central : elle pèse sur la carte de risque et sur l’implantation des
                barrages. Vous pouvez toujours renseigner ceux qui existent déjà dans votre
                périmètre.
              </Note>
            )}
          </div>
        ),
      },
      {
        cle: 'position',
        titre: 'Où le poser ?',
        ar: 'المكان',
        carte: true,
        aide: arme
          ? `Cliquez sur la carte à l’endroit exact du repère « ${TYPE_PAR_CLE[arme]?.fr} ».`
          : undefined,
        valide: Boolean(ouvert),
        empeche: 'Cliquez sur la carte pour poser le repère.',
        contenu: ouvert ? (
          <Note>
            Repère posé. Les champs suivants achèvent sa fiche — et il est déjà enregistré.
          </Note>
        ) : (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-xl border border-gr-gold/40 bg-gr-gold/12 px-3 py-2.5 text-[12px] leading-relaxed text-gr-gold">
              <IconTarget size={15} className="mt-px shrink-0" />
              <span>
                Cliquez sur la carte, à droite.{' '}
                {session.rang === 'admin'
                  ? 'Aucune restriction de périmètre pour un administrateur.'
                  : `Un clic hors de ${perimetreMot(session.rang)} sera refusé.`}
              </span>
            </p>
            <Note>Un repère déjà posé se déplace en le glissant, puis se confirme.</Note>
          </div>
        ),
      },
        ...etapesFiche,
        etapeVerification,
      ].filter(Boolean);
    } else if (tache === 'corriger') {
      deLaTache = [
      {
        cle: 'choisir',
        titre: 'Quel repère corriger ?',
        ar: 'اختر النقطة',
        carte: true,
        aide: 'Le repère choisi est centré sur la carte.',
        valide: Boolean(ouvert),
        empeche: 'Choisissez un repère dans la liste.',
        contenu: (
          <ListeMarquages
            items={items}
            session={session}
            selection={selection}
            onSelectionner={onSelectionner}
            onCadrer={onCadrer}
            onSupprimer={onSupprimer}
          />
        ),
      },
        ...etapesFiche,
        etapeVerification,
      ].filter(Boolean);
    } else if (tache === 'echanger') {
      deLaTache = [
      {
        cle: 'echange',
        titre: 'Exporter ou importer',
        ar: 'تصدير / استيراد',
        aide: 'Les marquages vivent sur le serveur : tous les postes voient les mêmes. L’échange de fichier sert à transmettre au commandement, ou à reprendre le relevé d’un autre poste.',
        valide: true,
        contenu: (
          <div className="space-y-3">
            <button
              type="button"
              onClick={onExporter}
              disabled={total === 0}
              className={`${bouton} w-full bg-white/10 py-3 text-white/85 hover:bg-white/16`}
            >
              <IconExport size={15} /> Exporter {total} repère(s) en GeoJSON
            </button>

            <button
              type="button"
              onClick={() => fichier.current?.click()}
              disabled={occupe}
              className={`${bouton} w-full bg-white/10 py-3 text-white/85 hover:bg-white/16`}
            >
              <IconImport size={15} /> Importer un fichier GeoJSON
            </button>

            {/* Entrée fichier masquée : le bouton ci-dessus la déclenche, ce qui
                évite le style natif illisible sur fond sombre. */}
            <input
              ref={fichier}
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImporter(f);
                e.target.value = ''; // permet de réimporter le même fichier
              }}
            />

            <Note>
              À l’import, le serveur applique les mêmes règles qu’à la saisie : hors périmètre, une
              entité est refusée, et la version la plus récente de chaque repère l’emporte.
            </Note>
          </div>
        ),
      },
      ];
    }

    /* LE CHOIX D'ABORD, LA BRANCHE ENSUITE — toujours dans cet ordre. */
    etapes = [etapeTache, ...deLaTache];
  }

  /**
   * REVENIR AU CHOIX DE LA TÂCHE.
   *
   * Le choix étant l'étape 1, RETOUR y ramène tout seul et la barre
   * d'avancement aussi. Cette fonction ne sert donc plus qu'à TERMINER —
   * finir une tâche rend au menu, pas au dehors — et à relâcher ce que le
   * parcours seul ne saurait pas relâcher.
   */
  return (
    <>
      <Parcours
        icone={IconMarquage}
        titre="SAISIE TERRAIN"
        ar="تشوير رئيس السرية"
        etapes={etapes}
        indice={etape}
        onIndice={setEtape}
        /* ANNULER n'existe que sur l'étape 1 — le choix de la tâche — et
           ferme donc le panneau. Revenir au choix depuis une tâche se fait par
           RETOUR ou par la barre d'avancement, sans détour. */
        onFermer={onClose}
        /**
         * TERMINER FERME LA SECTION. Toujours, tâche ou pas.
         *
         * Il ramenait au menu « Que voulez-vous faire ? » quand une tâche était
         * en cours. L'intention était de permettre d'en enchaîner une seconde
         * sans rouvrir le panneau — mais ce n'est pas ce que le mot annonce :
         * on appuie sur TERMINER pour EN AVOIR FINI, et l'on retombait sur le
         * menu du début, comme si le geste n'avait pas été pris en compte.
         *
         * La remise à zéro n'est pas perdue pour autant : `useParcours` la fait
         * à chaque changement d'ouverture, fermeture comprise (voir plus haut).
         * Rouvrir la saisie ramène donc au menu, à l'étape 1, tâche et outil de
         * pose relâchés — ce que l'ancien TERMINER faisait, mais au bon moment.
         *
         * Enchaîner deux tâches reste possible : RETOUR et la barre
         * d'avancement ramènent au menu sans fermer.
         */
        onTerminer={onClose}
        libelleTerminer="TERMINER"
        occupe={occupe}
        erreur={message && !message.ok ? message.texte : null}
      />

      {/* Un retour d'action réussi se dit, sans bloquer le parcours. Un échec,
          lui, remonte dans le pied du parcours (voir `erreur` ci-dessus) : il
          faut le lire avant de continuer. */}
      {message?.ok && <MessageFlottant>{message.texte}</MessageFlottant>}
    </>
  );
}
