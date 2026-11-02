/**
 * ORGANISATION — la vue d'ensemble, et la descente jusqu'à la brigade.
 *
 * POURQUOI CE PANNEAU EXISTE.
 *
 * Un administrateur devait ouvrir une région, revenir, ouvrir la suivante,
 * revenir — vingt-huit fois — pour se faire une idée de l'état du pays. Aucun
 * écran ne donnait la vue d'ensemble : les couches de la carte montrent des
 * contours, ANALYSE agrège au niveau national, et entre les deux, rien qui
 * dise « telle région porte tant de postes, tant d'hommes, tant de tenus ».
 *
 * DEUX USAGES, UN SEUL PARCOURS.
 *
 *   VOIR TOUT           le tableau complet, groupé, replié par région, avec
 *                       une recherche qui traverse les trois échelons ;
 *   descendre           région, puis compagnie, puis brigade, puis agir.
 *
 * Ce sont les deux faces du même arbre : le premier le montre en entier, le
 * second le suit branche par branche. Un seul appel les alimente
 * (`/api/hierarchie`), et il est déjà cloisonné par le serveur — un chef de
 * région n'y trouve que sa région, et l'écran n'a rien à filtrer.
 *
 * POUR LES PROFILS HIÉRARCHIQUES, LES PREMIÈRES ÉTAPES DISPARAISSENT.
 * Demander sa région à un chef de région serait absurde : son compte la nomme.
 * Le parcours commence donc là où son périmètre commence — exactement comme
 * dans OPTIMISATION (voir `perimetreImpose`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as API from './api.js';
import {
  IconTerritoire,
  IconRegion,
  IconCompagnie,
  IconBrigade,
  IconLoupe,
  IconSpinner,
  IconChevron,
  IconPointage,
  IconBarrageFixe,
} from './icons.jsx';
import { Parcours, useParcours, Choix, Recap, Note, Vide } from './Parcours.jsx';
import { sansAccent } from './texte.js';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

const nf = (n) => (n ?? 0).toLocaleString('fr-FR');

/* ================================================================== */
/* Briques                                                            */
/* ================================================================== */

/**
 * UNE LIGNE DE L'ARBRE — le nom, ce qu'il porte, et de quoi descendre.
 *
 * Les trois chiffres sont toujours les mêmes, dans le même ordre, à tous les
 * échelons : postes, tenus, hommes — puis, quand la source la connaît, la
 * répartition disponibles / indisponibles de ces hommes. Un tableau dont les
 * colonnes changent de sens d'une ligne à l'autre ne se lit pas.
 */
function LigneArbre({ icone: Icone, niveau, nom, sous, n, onOuvrir, ouvert, demo, indente = 0 }) {
  const Enveloppe = onOuvrir ? 'button' : 'div';
  const couleurIcone =
    niveau === 'region'
      ? 'text-[#ffd400]'
      : niveau === 'compagnie'
        ? 'text-blue-400'
        : niveau === 'brigade'
          ? 'text-[#00e676]'
          : 'text-gr-gold/70';

  const fondIcone =
    niveau === 'region'
      ? 'bg-[#ffd400]/15 border-[#ffd400]/30'
      : niveau === 'compagnie'
        ? 'bg-[#1565c0]/25 border-[#1565c0]/45'
        : niveau === 'brigade'
          ? 'bg-[#00e676]/15 border-[#00e676]/30'
          : 'bg-white/6 border-white/10';

  return (
    <Enveloppe
      type={onOuvrir ? 'button' : undefined}
      onClick={onOuvrir}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left
        ${onOuvrir ? 'transition-colors duration-150 hover:bg-white/8 motion-reduce:transition-none' : ''}
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary`}
      style={indente ? { paddingLeft: `${8 + indente * 14}px` } : undefined}
    >
      {onOuvrir && (
        <IconChevron size={12} open={ouvert} className="shrink-0 text-white/35" />
      )}
      {Icone && (
        <span className={`grid size-6 shrink-0 place-items-center rounded-md border ${fondIcone}`}>
          <Icone size={14} className={`shrink-0 ${couleurIcone}`} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-white/90">{nom}</span>
        {sous && <span className="block truncate text-[10.5px] text-white/40">{sous}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-[12px] font-bold tabular-nums text-white/85">
          {nf(n.barrages)}
          <span className="font-normal text-white/35"> postes</span>
        </span>
        <span className="block font-mono text-[10.5px] tabular-nums text-white/45">
          {nf(n.tenus)} tenus · {nf(n.effectif)} h.
          {demo && <span className="ml-1 text-gr-gold/70">DEMO</span>}
        </span>
        {/**
          * DISPONIBLES / INDISPONIBLES — seulement quand la source le sait.
          *
          * Le fichier d'effectifs du service réel ne porte pas cette
          * information : ses réponses n'ont donc pas ces deux clés, et la
          * ligne s'arrête au total, comme avant. Afficher « 0 indisponible »
          * faute de donnée serait pire que de se taire — on lirait un
          * dispositif au complet là où l'on ne sait simplement rien.
          */}
        {n.effectifDisponible != null && (
          <span className="block font-mono text-[10.5px] tabular-nums">
            <span className="text-[#00e676]/80">{nf(n.effectifDisponible)} dispo.</span>
            {n.effectifIndisponible > 0 && (
              <span className="text-white/35"> · {nf(n.effectifIndisponible)} indispo.</span>
            )}
          </span>
        )}
      </span>
    </Enveloppe>
  );
}

/* ================================================================== */

/**
 * PAS DE PROP `session` ICI, à dessein.
 *
 * La portée du compte vient du SERVEUR (`arbre.portee`), pas de ce que le
 * navigateur croit savoir. Passer la session inviterait à s'en servir pour
 * décider ce qui est visible — et cette décision-là ne doit jamais se prendre
 * ici : elle est déjà prise, et appliquée, par `/api/hierarchie`.
 */
export default function HierarchiePanel({
  open,
  onClose,
  onCadrerCirconscription,
  onViserBrigade,
}) {
  const [arbre, setArbre] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState(null);

  /** 'tout' | 'descendre' | null */
  const [mode, setMode] = useState(null);
  const [region, setRegion] = useState('');
  const [compagnie, setCompagnie] = useState('');
  const [brigade, setBrigade] = useState('');

  const [recherche, setRecherche] = useState('');
  const [depliees, setDepliees] = useState(() => new Set());

  /**
   * L'ÉTAPE, ET TOUT CE QUI DÉCRIT LA PORTÉE, REMIS À ZÉRO À L'OUVERTURE.
   *
   * C'est ici que le défaut se voyait le plus : « VOIR TOUT » ne compte que
   * DEUX étapes, si bien qu'un panneau quitté sur la seconde se rouvrait sur
   * « Étape 2 sur 2 » — l'écran de fin — et il fallait appuyer sur RETOUR pour
   * commencer.
   *
   * L'étape seule ne suffisait pas : `mode` survivait aussi, donc le parcours
   * rouvrait la branche « VOIR TOUT » sans qu'on l'ait choisie. Tout ce qui
   * décrit la portée repart donc de zéro — la portée, la région, la compagnie,
   * la brigade et la recherche. `arbre` est CONSERVÉ : c'est la donnée reçue
   * du serveur, la recharger à chaque ouverture serait un appel pour rien.
   */
  const { indice: etape, setIndice: setEtape } = useParcours(
    open,
    () => {
      setMode(null);
      setRegion('');
      setCompagnie('');
      setBrigade('');
      setRecherche('');
      setErreur(null);
    },
    mode,
  );

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      setArbre(await API.hierarchie());
    } catch (err) {
      setErreur(err?.message ?? 'Impossible de lire l’organisation.');
      setArbre(null);
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    if (open) charger();
  }, [open, charger]);

  /**
   * LE PÉRIMÈTRE DÉDUIT — la portée vient du SERVEUR, pas du navigateur.
   *
   * `arbre.portee` dit ce que ce compte peut voir. On s'en sert pour sauter
   * les étapes qui n'ont pas d'objet : un chef de compagnie ne choisit ni sa
   * région ni sa compagnie.
   */
  const portee = arbre?.portee?.niveau ?? 'national';
  const imposeRegion = portee !== 'national';
  const imposeCompagnie = portee === 'compagnie' || portee === 'brigade';
  const imposeBrigade = portee === 'brigade';

  const regions = arbre?.regions ?? [];

  /* Les valeurs effectives : imposées quand la portée les fixe. */
  const regionChoisie = imposeRegion ? (regions[0]?.nom ?? '') : region;
  const regionCourante = regions.find((r) => r.nom === regionChoisie) ?? null;

  const compagnies = regionCourante?.compagnies ?? [];
  const compagnieChoisie = imposeCompagnie ? (compagnies[0]?.nom ?? '') : compagnie;
  const compagnieCourante = compagnies.find((c) => c.nom === compagnieChoisie) ?? null;

  const brigades = compagnieCourante?.brigades ?? [];
  const brigadeChoisie = imposeBrigade ? (brigades[0]?.nom ?? '') : brigade;
  const brigadeCourante = brigades.find((b) => b.nom === brigadeChoisie) ?? null;

  /* ---------------------------------------------------------------- */
  /* La recherche du « VOIR TOUT » — traverse les trois échelons      */
  /* ---------------------------------------------------------------- */

  const resultats = useMemo(() => {
    const q = sansAccent(recherche).trim();
    if (!q) return null;
    const trouves = [];
    for (const r of regions) {
      if (sansAccent(r.nom).includes(q)) trouves.push({ niveau: 'region', item: r });
      for (const c of r.compagnies ?? []) {
        if (sansAccent(c.nom).includes(q)) trouves.push({ niveau: 'compagnie', item: c });
        for (const b of c.brigades ?? []) {
          if (sansAccent(b.nom).includes(q)) trouves.push({ niveau: 'brigade', item: b });
        }
      }
      for (const b of r.orphelines ?? []) {
        if (sansAccent(b.nom).includes(q)) trouves.push({ niveau: 'brigade', item: b });
      }
    }
    return trouves;
  }, [recherche, regions]);

  const basculer = (nom) =>
    setDepliees((s) => {
      const n = new Set(s);
      if (n.has(nom)) n.delete(nom);
      else n.add(nom);
      return n;
    });

  const cadrer = (niveau, nom) => onCadrerCirconscription?.(niveau, nom);

  if (!open) return null;

  /* ---------------------------------------------------------------- */
  /* Les étapes                                                       */
  /* ---------------------------------------------------------------- */

  const total = arbre?.total ?? {};

  const etapePortee = {
    cle: 'portee',
    titre: 'Que voulez-vous voir ?',
    ar: 'ماذا تريد أن ترى؟',
    aide:
      portee === 'national'
        ? 'Tout le pays d’un seul écran, ou une unité en particulier.'
        : 'Votre périmètre entier, ou une unité en particulier.',
    valide: Boolean(mode),
    empeche: 'Choisissez une portée pour continuer.',
    contenu: (
      <div className="space-y-3">
        {chargement && (
          <p className="flex items-center gap-2 text-[12.5px] text-white/55">
            <IconSpinner size={15} /> Lecture de l’organisation…
          </p>
        )}
        {erreur && <Note ton="alerte">{erreur}</Note>}

        {arbre && (
          <>
            <Choix
              nom="Portée"
              valeur={mode}
              onChange={(cle) => {
                /* Aucun `setEtape` ici : `useParcours` mène à l'étape 1 de la
                   branche dès que `mode` change. C'est ce 1 écrit à la main
                   qui, recopié dans SAISIE TERRAIN — où le tableau était
                   remplacé — sautait la première étape de la tâche. */
                setMode(cle);
                if (cle === 'tout') cadrer('region', 'toutes');
              }}
              options={[
                {
                  cle: 'tout',
                  libelle: 'VOIR TOUT',
                  ar: 'عرض الكل',
                  icone: IconTerritoire,
                  aide: `${nf(total.regions)} région(s), ${nf(total.compagnies)} compagnie(s), ${nf(
                    total.brigades,
                  )} brigade(s) — dans un seul tableau.`,
                },
                {
                  cle: 'descendre',
                  libelle: 'Descendre jusqu’à une brigade',
                  ar: 'النزول إلى فرقة',
                  icone: IconBrigade,
                  aide: 'Région, puis compagnie, puis brigade — et agir sur elle.',
                },
              ]}
            />

            <Recap
              titre={
                portee === 'national'
                  ? 'Le dispositif national'
                  : `Votre périmètre — ${arbre.portee?.unite ?? ''}`
              }
              lignes={[
                { libelle: 'Régions', valeur: nf(total.regions) },
                { libelle: 'Compagnies', valeur: nf(total.compagnies) },
                { libelle: 'Brigades', valeur: nf(total.brigades) },
                { libelle: 'Postes', valeur: nf(total.barrages), accent: true },
                { libelle: 'dont BFI intouchables', valeur: nf(total.bfi ?? 0) },
                { libelle: 'dont fixes normaux', valeur: nf(total.fixesNormaux ?? total.fixes) },
                ...(total.mobiles > 0 ? [{ libelle: 'dont mobiles', valeur: nf(total.mobiles) }] : []),
                { libelle: 'Tenus sur le créneau', valeur: nf(total.tenus) },
                { libelle: 'Effectif recensé', valeur: nf(total.effectif) },
              ]}
            />

            {total.effectifDemo && (
              <Note>
                Une partie de l’effectif est de <b className="text-gr-gold">démonstration</b>
                (matricules « DEMO- »). Ces personnes sont fictives et se remplacent par l’effectif
                réel sans toucher au reste.
              </Note>
            )}
          </>
        )}
      </div>
    ),
  };

  /* ---------------- VOIR TOUT ---------------- */
  const etapeTout = {
    cle: 'tout',
    titre: 'Tout le dispositif',
    ar: 'كل الحواجز',
    carte: true,
    aide: 'Appuyez sur une région pour la déplier, sur une brigade pour la voir sur la carte.',
    valide: true,
    contenu: (
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-white/75">
            <IconLoupe size={13} /> Chercher une région, une compagnie, une brigade
          </span>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Agdez, Zagora, Ouarzazate…"
            className="min-h-11 w-full rounded-xl border border-white/12 bg-white/6 px-3
              text-[14px] text-white placeholder:text-white/25
              focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary"
          />
        </label>

        {resultats ? (
          resultats.length === 0 ? (
            <Vide>Rien ne correspond à « {recherche} ».</Vide>
          ) : (
            <>
              <p className="text-[11px] text-white/40">{resultats.length} résultat(s)</p>
              <ul className="space-y-0.5">
                {resultats.slice(0, 60).map(({ niveau, item }) => (
                  <li key={`${niveau}-${item.nom}`}>
                    <LigneArbre
                      niveau={niveau}
                      icone={
                        niveau === 'region'
                          ? IconRegion
                          : niveau === 'compagnie'
                            ? IconCompagnie
                            : IconBrigade
                      }
                      nom={item.nom}
                      sous={
                        niveau === 'region'
                          ? 'Région'
                          : niveau === 'compagnie'
                            ? `Compagnie · ${item.reg ?? ''}`
                            : `Brigade · ${item.cie ?? ''}`
                      }
                      n={item}
                      demo={item.effectifDemo}
                      onOuvrir={() =>
                        cadrer(
                          niveau === 'region'
                            ? 'region'
                            : niveau === 'compagnie'
                              ? 'compagnie'
                              : 'brigade',
                          item.nom,
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
              {resultats.length > 60 && (
                <p className="text-[10.5px] text-white/35">
                  … et {resultats.length - 60} de plus — affinez la recherche.
                </p>
              )}
            </>
          )
        ) : (
          <ul className="space-y-0.5">
            {regions.map((r) => (
              <li key={r.nom}>
                <LigneArbre
                  niveau="region"
                  icone={IconRegion}
                  nom={r.nom}
                  sous={`${nf(r.nbCompagnies)} compagnie(s) · ${nf(r.nbBrigades)} brigade(s)`}
                  n={r}
                  demo={r.effectifDemo}
                  ouvert={depliees.has(r.nom)}
                  onOuvrir={() => {
                    basculer(r.nom);
                    cadrer('region', r.nom);
                  }}
                />

                {depliees.has(r.nom) && (
                  <ul className="space-y-0.5 border-l border-white/8 pl-1">
                    {(r.compagnies ?? []).map((c) => (
                      <li key={c.nom}>
                        <LigneArbre
                          niveau="compagnie"
                          icone={IconCompagnie}
                          nom={c.nom}
                          sous={`${nf(c.nbBrigades)} brigade(s)`}
                          n={c}
                          demo={c.effectifDemo}
                          ouvert={depliees.has(`${r.nom}/${c.nom}`)}
                          indente={1}
                          onOuvrir={() => {
                            basculer(`${r.nom}/${c.nom}`);
                            cadrer('compagnie', c.nom);
                          }}
                        />
                        {depliees.has(`${r.nom}/${c.nom}`) && (
                          <ul className="space-y-0.5">
                            {(c.brigades ?? []).map((b) => (
                              <li key={b.nom}>
                                <LigneArbre
                                  niveau="brigade"
                                  icone={IconBrigade}
                                  nom={b.nom}
                                  n={b}
                                  demo={b.effectifDemo}
                                  indente={2}
                                  onOuvrir={() => cadrer('brigade', b.nom)}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                    {(r.orphelines ?? []).map((b) => (
                      <li key={`orph-${b.nom}`}>
                        <LigneArbre
                          niveau="brigade"
                          icone={IconBrigade}
                          nom={b.nom}
                          sous="hors compagnie répertoriée"
                          n={b}
                          demo={b.effectifDemo}
                          indente={1}
                          onOuvrir={() => cadrer('brigade', b.nom)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    ),
  };

  /* ---------------- La descente ---------------- */
  const etapeRegion = !imposeRegion && {
    cle: 'region',
    titre: 'Quelle région ?',
    ar: 'أي جهة؟',
    aide: 'Le tableau montre ce que chacune porte.',
    valide: Boolean(regionChoisie),
    empeche: 'Choisissez une région.',
    contenu: (
      <ul className="space-y-0.5">
        {regions.map((r) => (
          <li key={r.nom}>
            <LigneArbre
              niveau="region"
              icone={IconRegion}
              nom={r.nom}
              sous={`${nf(r.nbCompagnies)} compagnie(s) · ${nf(r.nbBrigades)} brigade(s)`}
              n={r}
              demo={r.effectifDemo}
              ouvert={r.nom === regionChoisie}
              onOuvrir={() => {
                setRegion(r.nom);
                setCompagnie('');
                setBrigade('');
                cadrer('region', r.nom);
              }}
            />
          </li>
        ))}
      </ul>
    ),
  };

  const etapeCompagnie = !imposeCompagnie && {
    cle: 'compagnie',
    titre: 'Quelle compagnie ?',
    ar: 'أي سرية؟',
    aide: regionCourante ? `Les compagnies de ${regionCourante.nom}.` : undefined,
    valide: Boolean(compagnieChoisie),
    empeche: 'Choisissez une compagnie.',
    contenu:
      compagnies.length === 0 ? (
        <Vide>Cette région ne porte aucune compagnie répertoriée.</Vide>
      ) : (
        <ul className="space-y-0.5">
          {compagnies.map((c) => (
            <li key={c.nom}>
              <LigneArbre
                niveau="compagnie"
                icone={IconCompagnie}
                nom={c.nom}
                sous={`${nf(c.nbBrigades)} brigade(s)`}
                n={c}
                demo={c.effectifDemo}
                ouvert={c.nom === compagnieChoisie}
                onOuvrir={() => {
                  setCompagnie(c.nom);
                  setBrigade('');
                  cadrer('compagnie', c.nom);
                }}
              />
            </li>
          ))}
        </ul>
      ),
  };

  const etapeBrigade = !imposeBrigade && {
    cle: 'brigade',
    titre: 'Quelle brigade ?',
    ar: 'أي فرقة؟',
    carte: true,
    aide: compagnieCourante ? `Les brigades de ${compagnieCourante.nom}.` : undefined,
    valide: Boolean(brigadeChoisie),
    empeche: 'Choisissez une brigade.',
    contenu:
      brigades.length === 0 ? (
        <Vide>Cette compagnie ne porte aucune brigade répertoriée.</Vide>
      ) : (
        <ul className="space-y-0.5">
          {brigades.map((b) => (
            <li key={b.nom}>
              <LigneArbre
                niveau="brigade"
                icone={IconBrigade}
                nom={b.nom}
                n={b}
                demo={b.effectifDemo}
                ouvert={b.nom === brigadeChoisie}
                onOuvrir={() => {
                  setBrigade(b.nom);
                  cadrer('brigade', b.nom);
                }}
              />
            </li>
          ))}
        </ul>
      ),
  };

  const etapeUnite = {
    cle: 'unite',
    titre: brigadeCourante ? brigadeCourante.nom : 'La brigade',
    ar: 'الفرقة',
    carte: true,
    aide: 'Ce qu’elle porte, et ce qu’on peut y faire.',
    valide: true,
    contenu: brigadeCourante ? (
      <div className="space-y-3">
        <Recap
          titre="Rattachement"
          lignes={[
            { libelle: 'Brigade', valeur: brigadeCourante.nom, accent: true },
            { libelle: 'Compagnie', valeur: brigadeCourante.cie },
            { libelle: 'Région', valeur: brigadeCourante.reg },
          ]}
        />
        <Recap
          titre="Ce qu’elle porte"
          lignes={[
            { libelle: 'Postes', valeur: nf(brigadeCourante.barrages), accent: true },
            { libelle: 'dont BFI intouchables', valeur: nf(brigadeCourante.bfi ?? 0) },
            { libelle: 'dont fixes normaux', valeur: nf(brigadeCourante.fixesNormaux ?? brigadeCourante.fixes) },
            ...(brigadeCourante.mobiles > 0 ? [{ libelle: 'dont mobiles', valeur: nf(brigadeCourante.mobiles) }] : []),
            { libelle: 'Tenus sur le créneau', valeur: nf(brigadeCourante.tenus) },
            { libelle: 'Effectif recensé', valeur: nf(brigadeCourante.effectif) },
          ]}
        />

        {brigadeCourante.effectifDemo && (
          <Note>
            L’effectif de cette brigade est de <b className="text-gr-gold">démonstration</b> :
            personnes fictives, à remplacer par l’effectif réel.
          </Note>
        )}

        {brigadeCourante.barrages === 0 && (
          <Note ton="alerte">
            Aucun poste sur cette brigade. C’est ici qu’il y a quelque chose à saisir.
          </Note>
        )}

        <button
          type="button"
          onClick={() => onViserBrigade?.(brigadeCourante.nom)}
          className={`${bouton} w-full bg-gr-gold py-2.5 text-gr-navy hover:brightness-110`}
        >
          <IconPointage size={14} /> Relever l’effectif de cette brigade
        </button>

        <button
          type="button"
          onClick={() => cadrer('brigade', brigadeCourante.nom)}
          className={`${bouton} w-full bg-white/8 py-2.5 text-white/75 hover:bg-white/14`}
        >
          <IconBarrageFixe size={14} /> Cadrer la carte sur ses postes
        </button>
      </div>
    ) : (
      <Vide>Aucune brigade choisie.</Vide>
    ),
  };

  const etapes =
    mode === 'tout'
      ? [etapePortee, etapeTout]
      : mode === 'descendre'
        ? [etapePortee, etapeRegion, etapeCompagnie, etapeBrigade, etapeUnite].filter(Boolean)
        : [etapePortee];

  /**
   * ANNULER dans une portée ramène au choix de portée, comme ailleurs.
   *
   * C'est EXACTEMENT la remise à zéro de l'ouverture, et non une seconde
   * écrite à côté : celle-ci oubliait `region`, `compagnie` et `brigade`, si
   * bien qu'annuler puis rentrer à nouveau dans « Descendre » proposait un
   * choix qu'on croyait avoir abandonné.
   */
  return (
    <Parcours
      icone={IconTerritoire}
      titre="ORGANISATION"
      ar="التنظيم"
      etapes={etapes}
      indice={etape}
      onIndice={setEtape}
      /* ANNULER n'existe que sur l'étape 1 — le choix de la portée — et ferme
         donc le panneau. RETOUR et la barre d'avancement ramènent au choix. */
      onFermer={onClose}
      /* TERMINER ferme la section — voir la note de MarquagePanel.jsx : il
         ramenait au choix de la portée, ce qui ressemblait à un geste ignoré.
         RETOUR et la barre d'avancement y ramènent, sans fermer. */
      onTerminer={onClose}
      libelleTerminer="TERMINER"
      occupe={chargement}
      erreur={erreur}
    />
  );
}

