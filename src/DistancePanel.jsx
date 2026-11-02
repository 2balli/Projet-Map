/**
 * Panneau de mesure des distances par la route — multi-points.
 *
 * Permet de poser N jalons (A, B, C, D…) pour planifier un trajet
 * avec plusieurs étapes. Le calcul est fait jambe par jambe (A→B, B→C…)
 * et la somme totale est affichée en en-tête. Un seul chemin de calcul :
 * pas de divergence entre le tracé dessiné et les chiffres affichés.
 */
import {
  IconDistance,
  IconClose,
  IconTarget,
  IconAlert,
  IconSpinner,
  IconAutoroute,
  IconRoute,
  IconHoraire,
  IconPlus,
} from './icons.jsx';
import { useState } from 'react';
import { formatKm, formatDuree } from './routage.js';
import { libelle } from './marquages.js';
import { CLASSES_ROUTE } from './layersConfig.js';
import { Parcours, useParcours, Choix, Note } from './Parcours.jsx';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

const Titre = ({ children, ar }) => (
  <div className="mb-1.5 flex items-baseline justify-between px-1">
    <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">
      {children}
    </h3>
    {ar && (
      <span dir="rtl" className="text-[11px] text-white/35">
        {ar}
      </span>
    )}
  </div>
);

/** Étiquette lettre d'un jalon : A, B, C … */
const lettreJalon = (i) => String.fromCharCode(65 + i);

/** Un waypoint (jalon) dans la liste. */
function Jalon({ index, total, point, actif, onChoisir, onSupprimer }) {
  const lettre = lettreJalon(index);
  const peutSupprimer = total > 2;

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onChoisir}
        className={`flex flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left
          transition-colors duration-150 motion-reduce:transition-none
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
          ${actif ? 'bg-gr-gold/20 ring-2 ring-gr-gold/60' : 'bg-white/6 hover:bg-white/10'}`}
      >
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
            point ? 'bg-gr-gold text-gr-navy' : 'bg-white/15 text-white/60'
          }`}
        >
          {lettre}
        </span>
        <span className="min-w-0 flex-1">
          {point ? (
            <>
              <span className="block truncate text-[12px] font-semibold text-white">
                {point.route ?? 'Hors référence'}
              </span>
              <span className="block truncate font-mono text-[10px] text-white/45">
                {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                {/* `accroche` est posée par la carte à la création du jalon (voir
                    `accrocher` dans GendarmerieMap.jsx, qui refuse le point s'il
                    n'accroche pas) : elle est donc toujours là. Mais un
                    déréférencement nu faisait blanchir TOUT le panneau si elle
                    manquait — un défaut de sous-champ ne doit pas coûter l'écran
                    entier. */}
                {point.accroche ? ` · à ${formatKm(point.accroche.ecartKm)} de la route` : ''}
              </span>
            </>
          ) : (
            <span className="block text-[12px] text-white/50">
              {actif ? 'Cliquez sur la carte…' : 'Non défini'}
            </span>
          )}
        </span>
      </button>

      {peutSupprimer && (
        <button
          type="button"
          onClick={onSupprimer}
          aria-label={`Supprimer le point ${lettre}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-white/40
            transition-colors duration-150 hover:bg-white/10 hover:text-gr-red
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <IconClose size={13} />
        </button>
      )}
    </div>
  );
}

/** Résumé d'une jambe (tronçon A→B, B→C…). */
function ResumeJambe({ indexDe, indexVers, res }) {
  if (!res) {
    return (
      <p className="flex items-start gap-1.5 rounded-lg bg-gr-red/10 px-2 py-1.5 text-[10px] leading-snug text-gr-red">
        <IconAlert size={12} className="mt-px shrink-0" />
        <span>
          {lettreJalon(indexDe)}→{lettreJalon(indexVers)} : aucun itinéraire (réseau non relié).
        </span>
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-white/5 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-bold text-white/50">
          {lettreJalon(indexDe)} → {lettreJalon(indexVers)}
        </span>
        <div className="flex gap-2">
          <span className="font-mono text-[12px] font-semibold tabular-nums text-gr-gold">
            {formatKm(res.km)}
          </span>
          <span className="font-mono text-[12px] tabular-nums text-white/70">
            {formatDuree(res.heures)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(res.parClasse)
          .sort((a, b) => b[1] - a[1])
          .map(([cls, km]) => {
            const c = CLASSES_ROUTE[cls] ?? { fr: cls, couleur: '#8a97ab' };
            return (
              <span
                key={cls}
                className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px]"
                style={{ background: c.couleur + '22', color: c.couleur }}
              >
                <span
                  className="inline-block size-1.5 rounded-full"
                  style={{ background: c.couleur }}
                />
                {c.fr} {formatKm(km)}
              </span>
            );
          })}
      </div>
    </div>
  );
}

/**
 * Analyse du trajet calculé : barrages posés le long, points noirs rencontrés,
 * et tronçons sans aucun barrage à proximité — voir `analyserCouvertureRoute`
 * dans `analysis.js`. Purement informatif : rien
 * n'est décidé ici, le chef garde la main sur où renforcer.
 */
/**
 * Bloc dépliable — un en-tête qui porte le compte, la liste en dessous.
 *
 * Un trajet national produit vingt étapes, trente barrages et une dizaine de
 * tronçons découverts : dépliés d'office, ces listes repoussaient hors de
 * l'écran le seul chiffre que l'on vient chercher (distance et durée). Le
 * compte reste visible sur l'en-tête, donc rien n'est caché — seul le détail
 * attend qu'on le demande.
 */
function BlocDepliable({ titre, ar, compte, teinte = 'text-white/50', children, ouvertParDefaut = false }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);
  if (!compte) return null;

  return (
    <div className="mb-1.5">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors
          duration-150 hover:bg-white/6 motion-reduce:transition-none"
      >
        <span aria-hidden className="text-[10px] text-white/40">{ouvert ? '▾' : '▸'}</span>
        <span className={`flex-1 text-[10px] font-bold uppercase tracking-wide ${teinte}`}>{titre}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/45">{compte}</span>
        {ar && <span dir="rtl" className="shrink-0 text-[10px] text-white/30">{ar}</span>}
      </button>
      {ouvert && <div className="mt-1">{children}</div>}
    </div>
  );
}

function AnalyseRouteSection({ analyse, onLocaliser }) {
  if (!analyse) return null;

  return (
    <section>
      {/* Les deux comptes sur une ligne : deux pavés pour deux nombres à un
          chiffre coûtaient plus de hauteur que d'information. */}
      <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/8 px-2.5 py-1.5 text-[11px]">
        <span className="font-mono text-[15px] font-bold tabular-nums text-white">{analyse.barrages.length}</span>
        <span className="text-white/50">barrages</span>
        <span aria-hidden className="text-white/20">·</span>
        <span className="font-mono text-[15px] font-bold tabular-nums text-white">{analyse.pointsNoirs.length}</span>
        <span className="text-white/50">points noirs</span>
        <span dir="rtl" className="ml-auto text-[10px] text-white/30">تحليل الطريق</span>
      </div>

      {analyse.gaps.length === 0 && (
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px]" style={{ color: '#0ca30c' }}>
          <IconTarget size={12} className="shrink-0" /> Aucun tronçon découvert de plus de {analyse.seuilGapKm} km sur
          ce trajet.
        </p>
      )}

      <BlocDepliable
        titre={`Tronçons sans barrage à moins de ${(analyse.seuilProximiteM / 1000).toFixed(1)} km`}
        compte={analyse.gaps.length}
        teinte="text-gr-red"
      >
        <ul className="space-y-0.5 rounded-lg bg-gr-red/12 px-2.5 py-2 text-[10px] leading-snug text-white/85">
          {analyse.gaps.map((g, i) => (
            <li key={i}>
              Du km {formatKm(g.debutKm)} au km {formatKm(g.finKm)} — {formatKm(g.longueurKm)} sans dispositif
            </li>
          ))}
        </ul>
      </BlocDepliable>

      <BlocDepliable
        titre="Points noirs sans barrage proche"
        compte={analyse.pointsNoirsNonCouverts.length}
        teinte="text-gr-gold/85"
      >
        <ul className="space-y-1">
          {analyse.pointsNoirsNonCouverts.map(({ m, km }) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onLocaliser(m)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/6 px-2 py-1.5 text-left hover:bg-white/10"
              >
                <span className="truncate text-[11px] text-white/85">
                  {libelle(m)} — km {formatKm(km)}
                </span>
                <IconTarget size={11} className="shrink-0 text-white/50" />
              </button>
            </li>
          ))}
        </ul>
      </BlocDepliable>

      <BlocDepliable titre="Barrages rencontrés" compte={analyse.barrages.length}>
        <ul className="space-y-0.5">
          {analyse.barrages.map(({ m, km }) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onLocaliser(m)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/6"
              >
                <span className="truncate text-[11px] text-white/75">{libelle(m)}</span>
                <span className="shrink-0 font-mono text-[10px] text-white/45">km {formatKm(km)}</span>
              </button>
            </li>
          ))}
        </ul>
      </BlocDepliable>
    </section>
  );
}

/**
 * Chemin alternatif : le même trajet selon l'AUTRE critère (rapide ↔ court),
 * pour comparer avant de choisir — pas un second algorithme de recherche
 * d'itinéraire, juste l'autre réglage déjà proposé par `RT.itineraireMulti`.
 */
function CheminAlternatifSection({ itineraireAlternatif, totalKmActuel, totalHeuresActuel, onCritere }) {
  const resultat = itineraireAlternatif?.resultat;
  if (!resultat?.jambes?.some(Boolean)) return null;

  const libelleCritere = itineraireAlternatif.critere === 'rapide' ? 'le plus rapide' : 'le plus court';

  return (
    <section>
      <Titre ar="مسار بديل">Chemin alternatif</Titre>
      <div className="rounded-lg bg-white/6 px-2.5 py-2 text-[11px] leading-snug text-white/80">
        <p>
          Via le trajet <strong className="text-white">{libelleCritere}</strong> : {formatKm(resultat.km)} en{' '}
          {formatDuree(resultat.heures)}
          {totalKmActuel > 0 && (
            <span className="text-white/50">
              {' '}
              (actuel : {formatKm(totalKmActuel)} en {formatDuree(totalHeuresActuel)})
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => onCritere(itineraireAlternatif.critere)}
          className={`${bouton} mt-1.5 w-full bg-white/10 text-white/85 hover:bg-white/16`}
        >
          Utiliser ce critère
        </button>
      </div>
    </section>
  );
}

export default function DistancePanel({
  open,
  onOpen,
  onClose,
  etat,        // 'absent' | 'chargement' | 'pret' | 'erreur'
  message,
  critere,
  onCritere,
  jalons,      // tableau de jalons (chacun null ou {lat, lng, route, accroche})
  enAttente,   // index numérique | null
  onAttendre,
  onAjouterJalon,
  onSupprimerJalon,
  resultat,    // { jambes, km, heures, volOiseauKm } | undefined | null
  onEffacer,
  analyseRoute, // barrages/points noirs/tronçons non couverts sur le trajet — voir analysis.js
  itineraireAlternatif, // { critere, resultat } — l'autre critère (rapide ↔ court), pour comparer
  onLocaliserMarquage,
}) {
  /** L'étape du parcours, remise à zéro à chaque ouverture — voir `useParcours`. */
  const { indice: etape, setIndice: setEtape } = useParcours(open);

  /** Résumé total : toutes jambes valides. */
  const totalKm = resultat?.km ?? 0;
  const totalHeures = resultat?.heures ?? 0;
  const hasAnyResult = resultat?.jambes?.some((j) => j !== null);
  const hasAllPoints = jalons.length >= 2 && jalons.every(Boolean);

  /** Nombre d'étapes, affiché sur l'en-tête replié de la feuille de route. */
  const nbEtapes = (resultat?.jambes ?? []).reduce((n, j) => n + (j?.etapes?.length ?? 0), 0);

  /* Le bouton d’ouverture est rendu par GendarmerieMap (colonne de
     boutons) : empilé ici, il repoussait le panneau ouvert hors écran. */
  if (!open) return null;

  /**
   * TROIS TEMPS : les points, la façon de mesurer, le résultat.
   *
   * Le panneau présentait tout d'un coup : la liste des points, le bouton
   * d'ajout, la paire de critères, le total, les tronçons, la feuille de route,
   * l'analyse des natures rencontrées, le chemin alternatif, et l'effacement.
   * Sur un trajet national, cela faisait quatre écrans de défilement — et rien
   * ne disait qu'il fallait DEUX points avant que quoi que ce soit s'affiche.
   *
   * LES TROIS ÉTAPES TRAVAILLENT SUR LA CARTE (`carte: true`) : on désigne les
   * points en cliquant, on voit le tracé changer avec le critère, on suit
   * l'itinéraire du regard. Une modale centrée masquerait précisément ce qu'on
   * mesure — d'où le format latéral, comme avant, mais séquencé.
   *
   * LA MESURE N'A PAS CHANGÉ : elle est faite par la carte à chaque
   * modification des points ou du critère (voir `itineraire` dans
   * GendarmerieMap.jsx). Le parcours ne calcule rien.
   */
  const etapes =
    etat !== 'pret'
      ? [
          {
            cle: 'reseau',
            titre: 'Réseau routier',
            ar: 'شبكة الطرق',
            carte: true,
            valide: false,
            empeche:
              etat === 'chargement'
                ? 'Chargement en cours…'
                : 'Le réseau routier est indisponible : la mesure est impossible.',
            contenu:
              etat === 'chargement' ? (
                <p className="flex items-center gap-2 text-[12.5px] text-white/60">
                  <IconSpinner size={15} /> Chargement du réseau routier…
                </p>
              ) : (
                <Note ton="alerte">
                  {message ??
                    "Réseau routier indisponible : la couche graphe_routier.json n'a pas pu être chargée."}
                </Note>
              ),
          },
        ]
      : [
          /* ---------------- 1 — les points ---------------- */
          {
            cle: 'points',
            titre: 'Entre quels points ?',
            ar: 'النقاط',
            carte: true,
            aide: 'Appuyez sur un point ci-dessous, puis cliquez sur la carte. Chaque point est ramené à la route la plus proche.',
            valide: hasAllPoints,
            empeche:
              jalons.length < 2
                ? 'Il faut au moins deux points.'
                : 'Désignez chaque point sur la carte.',
            contenu: (
              <div className="space-y-2">
                {/* La liste des points est la SEULE partie dont la hauteur
                    n'est pas bornée : elle grandit à chaque point
                    intermédiaire. Elle défile donc à l'intérieur d'elle-même
                    au-delà de quatre points. */}
                <div className="max-h-[40vh] space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
                  {jalons.map((point, i) => (
                    <Jalon
                      key={i}
                      index={i}
                      total={jalons.length}
                      point={point}
                      actif={enAttente === i}
                      onChoisir={() => onAttendre(enAttente === i ? null : i)}
                      onSupprimer={() => onSupprimerJalon(i)}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onAjouterJalon}
                  className={`${bouton} w-full bg-white/6 py-2.5 text-white/70 hover:bg-white/12 hover:text-gr-gold`}
                >
                  <IconPlus size={14} />
                  Ajouter un point intermédiaire
                </button>

                {jalons.some(Boolean) && (
                  <button
                    type="button"
                    onClick={onEffacer}
                    className={`${bouton} w-full bg-white/8 py-2.5 text-white/70 hover:bg-white/14`}
                  >
                    <IconClose size={14} /> Effacer le trajet
                  </button>
                )}

                <Note>
                  Cliquez un repère de brigade, un pointage, ou n’importe quel endroit de la carte.
                </Note>
              </div>
            ),
          },

          /* ---------------- 2 — comment mesurer ---------------- */
          {
            cle: 'critere',
            titre: 'Le plus rapide, ou le plus court ?',
            ar: 'المعيار',
            carte: true,
            aide: 'Le tracé change sur la carte à mesure que vous choisissez.',
            valide: true,
            contenu: (
              <div className="space-y-3">
                <Choix
                  nom="Critère de mesure"
                  valeur={critere}
                  onChange={onCritere}
                  options={[
                    {
                      cle: 'rapide',
                      libelle: 'Le plus rapide',
                      ar: 'الأسرع',
                      icone: IconHoraire,
                      aide: 'Privilégie les autoroutes et nationales, même en allongeant la distance.',
                    },
                    {
                      cle: 'court',
                      libelle: 'Le plus court',
                      ar: 'الأقصر',
                      icone: IconDistance,
                      aide: 'Le moins de kilomètres, quelle que soit la classe de route.',
                    },
                  ]}
                />

                <CheminAlternatifSection
                  itineraireAlternatif={itineraireAlternatif}
                  totalKmActuel={totalKm}
                  totalHeuresActuel={totalHeures}
                  onCritere={onCritere}
                />

                <Note>
                  La durée est calculée sur les vitesses de parcours par classe de route — hors
                  trafic et hors arrêts.
                </Note>
              </div>
            ),
          },

          /* ---------------- 3 — le résultat ---------------- */
          {
            cle: 'resultat',
            titre: 'Le trajet mesuré',
            ar: 'النتيجة',
            carte: true,
            valide: true,
            contenu: (
              <div className="space-y-2.5">
                {hasAllPoints && resultat === null && (
                  <Note ton="alerte">
                    Aucun itinéraire entre ces points : le réseau retenu (autoroutes, nationales,
                    régionales, provinciales) ne les relie pas.
                  </Note>
                )}

                {hasAnyResult && (
                  <>
                    {/* Distance et durée sur UNE ligne : ce sont les deux
                        chiffres qu'on vient chercher. */}
                    <div className="flex items-baseline gap-3 rounded-xl bg-white/8 px-3 py-2.5">
                      <span className="font-mono text-[22px] font-bold leading-none tabular-nums text-gr-gold">
                        {formatKm(totalKm)}
                      </span>
                      <span aria-hidden className="text-white/20">
                        ·
                      </span>
                      <span className="font-mono text-[18px] font-bold leading-none tabular-nums text-white">
                        {formatDuree(totalHeures)}
                      </span>
                      <span className="ml-auto text-[10.5px] text-white/45">total du trajet</span>
                    </div>

                    <p className="truncate text-[11px] text-white/45">
                      Détour ×{(totalKm / Math.max(0.01, resultat.volOiseauKm)).toFixed(2)} sur{' '}
                      {formatKm(resultat.volOiseauKm)} à vol d’oiseau
                    </p>

                    {resultat?.jambes?.length > 0 && (
                      <BlocDepliable
                        titre={resultat.jambes.length > 1 ? 'Tronçons' : 'Mesure par classe de route'}
                        ar="المقاطع"
                        compte={resultat.jambes.length}
                        teinte="text-gr-gold/85"
                      >
                        <div className="space-y-1.5">
                          {resultat.jambes.map((jambe, i) => (
                            <ResumeJambe key={i} indexDe={i} indexVers={i + 1} res={jambe} />
                          ))}
                        </div>
                      </BlocDepliable>
                    )}

                    {/**
                     * Feuille de route détaillée — REPLIÉE par défaut.
                     *
                     * Un itinéraire un peu long produit des dizaines d'étapes :
                     * la liste chassait tout le reste hors de l'écran, alors que
                     * le chiffre utile est déjà donné plus haut.
                     */}
                    <BlocDepliable
                      titre="Itinéraire détaillé"
                      ar="مسار الطريق"
                      compte={nbEtapes}
                      teinte="text-gr-gold/85"
                    >
                      {resultat.jambes.map((jambe, ji) => {
                        if (!jambe || jambe.etapes.length === 0) return null;
                        return (
                          <div key={ji} className="mb-2">
                            {resultat.jambes.length > 1 && (
                              <div className="mb-1 px-1 text-[10.5px] font-semibold text-white/40">
                                {lettreJalon(ji)} → {lettreJalon(ji + 1)}
                              </div>
                            )}
                            <ol className="space-y-0.5">
                              {jambe.etapes.map((e, i) => {
                                const c = CLASSES_ROUTE[e.classe];
                                const Icon = e.classe === 'autoroute' ? IconAutoroute : IconRoute;
                                return (
                                  <li
                                    key={i}
                                    className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/6"
                                  >
                                    <Icon size={13} style={{ color: c?.couleur ?? '#8a97ab' }} />
                                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-white/85">
                                      {e.ref
                                        ? e.nom ? `${e.ref} · ${e.nom}` : e.ref
                                        : e.nom ?? c?.fr ?? e.classe}
                                    </span>
                                    <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-white/60">
                                      {formatKm(e.km)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ol>
                          </div>
                        );
                      })}
                    </BlocDepliable>

                    <AnalyseRouteSection analyse={analyseRoute} onLocaliser={onLocaliserMarquage} />
                  </>
                )}
              </div>
            ),
          },
        ];

  return (
    <Parcours
      icone={IconDistance}
      titre="DISTANCES"
      ar="المسافات على الطريق"
      etapes={etapes}
      indice={etape}
      onIndice={setEtape}
      onFermer={onClose}
      onTerminer={onClose}
      libelleTerminer="TERMINER"
    />
  );
}
