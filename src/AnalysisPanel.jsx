/**
 * Panneau d'analyse — lecture chiffrée de ce que la carte montre.
 *
 * Toutes les valeurs sont calculées à partir des couches chargées
 * (`analysis.js`) et les anomalies viennent du rapport de build
 * (`public/layers/_report.json`) : rien n'est écrit en dur.
 */
import { usePresence } from './usePresence.js';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconChevron, IconTarget, IconPrint } from './icons.jsx';
import { Cartouche } from './Parcours.jsx';
import { entier } from './analysis.js';

const STATUT = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

const STATUT_LIBELLE = {
  good: 'conforme',
  warning: 'à surveiller',
  serious: 'anomalie',
  critical: 'critique',
};

/* ------------------------------------------------------------------ */

/** Un chiffre et ce qu'il designe — la brique du premier ecran. */
function Chiffre({ valeur, libelle, ton = 'neutre' }) {
  const tons = {
    neutre: 'text-white',
    bon: 'text-gr-green',
    attention: 'text-gr-gold',
    alerte: 'text-gr-red',
  };
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-1.5">
      <span className={'block text-[19px] font-bold leading-tight tabular-nums ' + tons[ton]}>
        {valeur}
      </span>
      <span className="block text-[9px] leading-tight text-white/45">{libelle}</span>
    </div>
  );
}

/** Les grades, du plus élevé au moins élevé — même ordre que SAISIE TERRAIN. */
const GRADES_ORDRE = ['A/C', 'ADJT', 'MDLC', 'MDLG'];

const deuxChiffres = (n) => String(n).padStart(2, '0');
const plage = (c) => `${deuxChiffres(c)}:00 → ${deuxChiffres((c + 6) % 24)}:00`;

/**
 * L'ANALYSE D'UNE BRIGADE — cliquée sur la carte, couche « Circonscriptions BT ».
 *
 * Elle répond à deux questions, et à elles seules : de qui la brigade dispose,
 * et où chacun se trouve à cette heure. Tout vient de `/api/roster`, le même
 * appel que SAISIE TERRAIN — deux écrans, une source, aucune contradiction
 * possible entre eux.
 *
 * PROGRESSIVE : le résumé et les postes sont visibles d’emblée ; le tableau
 * d'effectif se déplie sur demande. Trente lignes de personnel repousseraient
 * hors écran la disposition, qui est ce qu’on vient voir.
 */
function BrigadeSection({ roster, creneauCourant, onViser, onQuitter }) {
  const [creneau, setCreneau] = useState(creneauCourant);
  const [personnelOuvert, setPersonnelOuvert] = useState(false);

  /* Revenir au créneau en cours quand on change de brigade. */
  useEffect(() => setCreneau(creneauCourant), [creneauCourant, roster?.bt]);

  const vue = useMemo(() => {
    if (!roster || roster.erreur) return null;

    const lignes = (roster.elements ?? []).filter((e) => e.creneau === creneau);
    const parPoste = new Map();
    for (const e of lignes) {
      if (!parPoste.has(e.barrageId)) parPoste.set(e.barrageId, []);
      parPoste.get(e.barrageId).push(e);
    }
    for (const l of parPoste.values()) {
      l.sort(
        (a, b) =>
          GRADES_ORDRE.indexOf(a.grade) - GRADES_ORDRE.indexOf(b.grade) ||
          a.nom.localeCompare(b.nom, 'fr'),
      );
    }

    const attendus = (id) => (roster.composition?.[id] ?? []).reduce((t, c) => t + c.nombre, 0);

    let complets = 0;
    let vides = 0;
    const postes = (roster.barrages ?? []).map((b) => {
      const l = parPoste.get(b.id) ?? [];
      const cible = attendus(b.id);
      if (l.length === 0) vides++;
      else if (l.length >= cible) complets++;
      return { ...b, lignes: l, cible };
    });

    const places = new Set(lignes.map((e) => e.matricule));

    /* Les quatre relèves, comptées sur le même jeu de lignes. */
    const releves = [0, 6, 12, 18].map((c) => {
      const l = (roster.elements ?? []).filter((e) => e.creneau === c);
      return { creneau: c, hommes: l.length, postes: new Set(l.map((e) => e.barrageId)).size };
    });

    const parGrade = GRADES_ORDRE.map((g) => [
      g,
      (roster.effectif ?? [])
        .filter((p) => p.grade === g)
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
    ]).filter(([, l]) => l.length);

    return {
      postes,
      complets,
      vides,
      incomplets: postes.length - complets - vides,
      places,
      releves,
      parGrade,
      ou: new Map(lignes.map((e) => [e.matricule, e.barrageId])),
      nomDuPoste: new Map((roster.barrages ?? []).map((b) => [b.id, b.nom || ' (sans nom)'])),
    };
  }, [roster, creneau]);

  if (!roster) {
    return (
      <p className="rounded-lg bg-white/6 px-2 py-1.5 text-[11px] text-white/45">
        Chargement de la brigade…
      </p>
    );
  }

  if (roster.erreur || !vue) {
    return (
      <div className="space-y-2">
        <RetourGlobal onQuitter={onQuitter} />
        <p className="rounded-lg border border-gr-gold/30 bg-gr-gold/10 px-2 py-1.5 text-[11px] text-gr-gold">
          Brigade <b>{roster.bt}</b> : aucun barrage dans votre périmètre, ou lecture refusée.
        </p>
      </div>
    );
  }

  const effectif = roster.effectif ?? [];

  return (
    <div className="space-y-3">
      <RetourGlobal onQuitter={onQuitter} />

      <div className="rounded-xl border border-gr-gold/35 bg-gr-gold/12 px-2.5 py-2">
        <p className="truncate text-[14px] font-bold leading-tight text-gr-gold">{roster.bt}</p>
        <p className="text-[10px] text-white/55">
          {effectif.length} élément(s) · {vue.postes.length} barrage(s)
        </p>
      </div>

      {/* Les quatre relèves : un choix, pas quatre tableaux. */}
      <div>
        <SectionTitle ar="الفترات">Relèves</SectionTitle>
        <div className="grid grid-cols-4 gap-1.5">
          {vue.releves.map((r) => (
            <button
              key={r.creneau}
              type="button"
              onClick={() => setCreneau(r.creneau)}
              aria-pressed={r.creneau === creneau}
              className={
                'rounded-lg border px-1 py-1 text-center transition-colors duration-150 ' +
                'motion-reduce:transition-none ' +
                (r.creneau === creneau
                  ? 'border-gr-gold/50 bg-gr-gold/15'
                  : 'border-white/10 bg-white/4 hover:bg-white/8')
              }
            >
              <span className="block text-[10px] font-bold tabular-nums text-white/70">
                {deuxChiffres(r.creneau)}h
              </span>
              <span className="block text-[13px] font-bold tabular-nums text-white">
                {r.hommes}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle ar="المراكز">Postes · {plage(creneau)}</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          <Chiffre valeur={vue.complets} libelle="au complet" ton="bon" />
          <Chiffre
            valeur={vue.incomplets}
            libelle="incomplets"
            ton={vue.incomplets ? 'attention' : 'bon'}
          />
          <Chiffre valeur={vue.vides} libelle="sans personne" ton={vue.vides ? 'alerte' : 'bon'} />
        </div>
      </div>

      <div>
        <SectionTitle ar="العناصر">Effectif</SectionTitle>
        <div className="grid grid-cols-2 gap-1.5">
          <Chiffre valeur={vue.places.size} libelle="en poste" ton="bon" />
          <Chiffre valeur={effectif.length - vue.places.size} libelle="non affectés" />
        </div>
      </div>

      {/* La disposition : chaque poste, et qui le tient. */}
      <div>
        <SectionTitle ar="التوزيع">Barrages</SectionTitle>
        <ul className="space-y-1.5">
          {vue.postes.map((b) => (
            <li key={b.id} className="rounded-xl border border-white/10 bg-white/4 p-1.5">
              {/* Cliquer mène au poste : la carte s’y rend et le signale. */}
              <button
                type="button"
                onClick={() => onViser?.(b.id)}
                disabled={!onViser}
                className="flex w-full items-baseline gap-1.5 rounded text-left
                  transition-colors duration-150 hover:text-gr-gold disabled:cursor-default
                  motion-reduce:transition-none"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold text-white/90">
                  {b.nom || '(sans nom)'}
                </span>
                <span
                  className={
                    'shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-bold tabular-nums ' +
                    (b.cible > 0 && b.lignes.length >= b.cible
                      ? 'bg-gr-green/20 text-gr-green'
                      : 'bg-gr-gold/20 text-gr-gold')
                  }
                >
                  {b.lignes.length}/{b.cible || '?'}
                </span>
              </button>
              {b.lignes.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {b.lignes.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-1.5 text-[11px]">
                      <span className="w-10 shrink-0 font-bold text-gr-gold/75">{e.grade}</span>
                      <span className="min-w-0 flex-1 truncate text-white/80">{e.nom}</span>
                      <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/35">
                        {e.matricule}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Le tableau d'effectif, replié : on vient voir la disposition. */}
      {effectif.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-white/3">
          <button
            type="button"
            onClick={() => setPersonnelOuvert((o) => !o)}
            aria-expanded={personnelOuvert}
            className="flex w-full items-center gap-1.5 px-2 py-2 text-left
              transition-colors duration-150 hover:bg-white/6 motion-reduce:transition-none"
          >
            <IconChevron size={11} open={personnelOuvert} className="shrink-0 text-white/40" />
            <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/80">
              Personnel de la brigade
            </span>
            <span className="shrink-0 font-mono text-[10px] tabular-nums text-white/45">
              {vue.parGrade.map(([g, l]) => `${l.length} ${g}`).join(' · ')}
            </span>
          </button>

          {personnelOuvert && (
            <div className="max-h-80 space-y-2 overflow-y-auto overscroll-contain border-t border-white/10 px-2 py-2">
              {vue.parGrade.map(([grade, gens]) => (
                <div key={grade}>
                  <p className="mb-0.5 text-[10px] font-bold text-gr-gold/70">
                    {grade}
                    <span className="ml-1 font-normal text-white/35">{gens.length}</span>
                  </p>
                  <ul className="space-y-0.5">
                    {gens.map((p) => {
                      const poste = vue.ou.get(p.matricule);
                      return (
                        <li
                          key={p.matricule}
                          className="flex items-baseline gap-1.5 rounded bg-white/5 px-1.5 py-1"
                        >
                          <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                            {p.nom}
                          </span>
                          <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/35">
                            {p.matricule}
                          </span>
                          <span
                            className={
                              'max-w-[42%] shrink-0 truncate text-[9px] ' +
                              (poste ? 'text-gr-green' : 'text-white/30')
                            }
                          >
                            {poste ? vue.nomDuPoste.get(poste) : 'non affecté'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Le chemin de retour vers la situation nationale — un clic, toujours visible. */
function RetourGlobal({ onQuitter }) {
  return (
    <button
      type="button"
      onClick={onQuitter}
      className="text-[10px] font-semibold text-white/45 underline underline-offset-2
        transition-colors duration-150 hover:text-gr-gold motion-reduce:transition-none"
    >
      ← Revenir à la situation générale
    </button>
  );
}
/**
 * LE PREMIER ECRAN D'ANALYSE — la situation, sans un clic.
 *
 * Il repond aux questions qu'on se pose en ouvrant le panneau : combien de
 * postes sont tenus a cette heure, lesquels sont incomplets, quelles brigades
 * n'ont personne au tableau, combien d'hommes restent en reserve.
 *
 * TOUT EST VISIBLE D'EMBLEE, rien a configurer. Le seul geste propose est de
 * cliquer un poste degarni : la carte s'y rend et le signale. C'est la suite
 * naturelle de la lecture — on a vu le probleme, on veut voir ou il est.
 */
function SituationSection({ situation, onViser }) {
  const [tout, setTout] = useState(false);

  if (!situation) {
    return (
      <p className="rounded-lg bg-white/6 px-2 py-1.5 text-[11px] text-white/45">
        Chargement de la situation…
      </p>
    );
  }

  const { barrages, brigades, effectif, creneaux } = situation;
  const deux = (n) => String(n).padStart(2, '0');
  const ecarts = situation.detailIncomplets ?? [];
  const montres = tout ? ecarts : ecarts.slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 rounded-xl border border-gr-gold/35 bg-gr-gold/12 px-2.5 py-1.5">
        <span className="text-[15px] font-bold tabular-nums text-gr-gold">
          {deux(situation.creneau)}:00 → {deux((situation.creneau + 6) % 24)}:00
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-white/50">
          {String(situation.date).split('-').reverse().join('/')}
        </span>
      </div>

      <div>
        <SectionTitle ar="المراكز">Postes</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          <Chiffre valeur={barrages.pourvus} libelle="au complet" ton="bon" />
          <Chiffre
            valeur={barrages.incomplets}
            libelle="incomplets"
            ton={barrages.incomplets ? 'attention' : 'bon'}
          />
          <Chiffre
            valeur={barrages.vides}
            libelle="sans personne"
            ton={barrages.vides ? 'alerte' : 'bon'}
          />
        </div>
        <p className="mt-1 px-1 text-[10px] text-white/40">
          sur {barrages.total} poste(s) de votre périmètre
        </p>
      </div>

      <div>
        <SectionTitle ar="العناصر">Effectif</SectionTitle>
        <div className="grid grid-cols-3 gap-1.5">
          <Chiffre valeur={effectif.affectes} libelle="en poste" ton="bon" />
          <Chiffre valeur={effectif.libres} libelle="en réserve" />
          <Chiffre
            valeur={brigades.sansEffectif}
            libelle="brigades sans effectif"
            ton={brigades.sansEffectif ? 'attention' : 'bon'}
          />
        </div>
        <p className="mt-1 px-1 text-[10px] text-white/40">
          {effectif.total} personne(s) · {brigades.total} brigade(s)
          {effectif.demo ? ' · effectif de démonstration' : ''}
        </p>
      </div>

      <div>
        <SectionTitle ar="الفترات">Les quatre relèves</SectionTitle>
        <div className="grid grid-cols-4 gap-1.5">
          {creneaux.map((c) => (
            <div
              key={c.creneau}
              className={
                'rounded-lg border px-1 py-1 text-center ' +
                (c.creneau === situation.creneau
                  ? 'border-gr-gold/45 bg-gr-gold/12'
                  : 'border-white/10 bg-white/4')
              }
            >
              <span className="block text-[10px] font-bold tabular-nums text-white/70">
                {deux(c.creneau)}h
              </span>
              <span className="block text-[13px] font-bold tabular-nums text-white">
                {c.postes}
              </span>
              <span className="block text-[8px] text-white/35">postes</span>
            </div>
          ))}
        </div>
      </div>

      {ecarts.length === 0 ? (
        <p className="rounded-lg border border-gr-green/25 bg-gr-green/10 px-2 py-1.5 text-[11px] text-gr-green">
          Tous les postes de votre périmètre sont au complet sur ce créneau.
        </p>
      ) : (
        <div>
          <SectionTitle ar="النواقص">À regarder</SectionTitle>
          <ul className="space-y-0.5">
            {montres.map((e) => (
              <li key={e.id}>
                {/* Cliquer mene au poste : on a vu le probleme, on veut voir ou
                    il est. Pas de recherche a refaire a la main. */}
                <button
                  type="button"
                  onClick={() => onViser?.(e.id)}
                  disabled={!onViser}
                  className="flex w-full items-baseline gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-left
                    transition-colors duration-150 hover:bg-white/10 disabled:cursor-default
                    motion-reduce:transition-none
                    focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
                >
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/85">
                    {e.nom || '(sans nom)'}
                  </span>
                  <span className="shrink-0 text-[9px] text-white/35">{e.bt}</span>
                  <span
                    className={
                      'shrink-0 font-mono text-[10px] font-bold tabular-nums ' +
                      (e.presents === 0 ? 'text-gr-red' : 'text-gr-gold')
                    }
                  >
                    {e.presents}/{e.attendus}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {ecarts.length > montres.length && (
            <button
              type="button"
              onClick={() => setTout(true)}
              className="mt-1 px-1 text-[10px] font-semibold text-white/45 underline underline-offset-2
                transition-colors duration-150 hover:text-gr-gold motion-reduce:transition-none"
            >
              Voir les {ecarts.length} postes incomplets
            </button>
          )}
          {barrages.incomplets > ecarts.length && (
            <p className="mt-1 px-1 text-[9px] text-white/30">
              {barrages.incomplets - ecarts.length} autre(s) non détaillé(s).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children, sub, right }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">
          {children}
        </h3>
        {right}
      </div>
      {sub && <p className="mt-0.5 text-[10px] leading-snug text-white/45">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Rapport imprimable — document séparé, pas une copie du panneau       */
/* ------------------------------------------------------------------ */

const rStyleTitre = {
  margin: '0 0 4px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.02em',
  color: '#0b2545',
  textTransform: 'uppercase',
};
const rStyleSousTitre = { margin: '14px 0 6px', fontSize: 13, fontWeight: 700, color: '#0b2545' };
const rStylePara = { margin: '0 0 8px', fontSize: 12.5, lineHeight: 1.55, color: '#242a33' };

/**
 * Couleurs du rapport imprimé — palette DISTINCTE de `STATUT` (celle-ci pense
 * pour un fond sombre à l'écran, le rapport est sur papier blanc) : même
 * logique (vert = positif, ambre/rouge = à surveiller), tons assez soutenus
 * pour rester lisibles à l'impression noir & blanc comme en couleur.
 */
const R_COULEUR = { fort: '#1e7e34', faible: '#b3401c', recommandation: '#8a6d1f' };

/** Encart coloré pour un `<li>` de constat — bordure + fond teinté + puce retirée au profit d'un symbole. */
const rStyleEncart = (couleur) => ({
  margin: '0 0 6px',
  fontSize: 12.5,
  lineHeight: 1.5,
  color: '#242a33',
  listStyle: 'none',
  borderLeft: `3px solid ${couleur}`,
  background: `${couleur}14`,
  padding: '5px 10px',
});

const R_SYMBOLE = { fort: '✓', faible: '⚠', recommandation: '→' };

/**
 * Résume les totaux en quelques phrases plutôt qu'en tuiles isolées — un
 * supérieur qui reçoit ce rapport doit pouvoir le lire comme un texte, pas
 * comme un tableau de bord dont il faudrait deviner la portée.
 */
function syntheseGenerale(m, c) {
  const phrases = [];
  if (c) {
    phrases.push(
      `Le dispositif couvre ${entier(c.population)} habitants sur ${entier(c.superficie)} km², répartis sur ` +
        `${entier(c.circonscriptions)} circonscriptions territoriales et ${entier(c.compagnies)} compagnies.`,
    );
  }
  if (m) {
    const detailBarrages =
      (m.barrages.mobiles ?? 0) > 0
        ? `(${m.barrages.fixes} fixe(s), ${m.barrages.mobiles} mobile(s))`
        : `(${m.barrages.bfi ?? 0} fixe(s) intouchable(s), ${m.barrages.fixesNormaux ?? m.barrages.fixes} fixe(s) normaux)`;
    phrases.push(
      `${m.total} marquage(s) sont actuellement recensés, toutes unités confondues : ${m.barrages.total} barrage(s) ` +
        `${detailBarrages} et ${m.pointsNoirs.total} point(s) noir(s).`,
    );
    if (m.barrages.sansPatrouille > 0) {
      phrases.push(
        `${m.barrages.sansPatrouille} barrage(s) sur ${m.barrages.total} n'ont encore aucune patrouille affectée.`,
      );
    }
    if (m.barrages.alertesOuvertes > 0) {
      phrases.push(
        `${m.barrages.alertesOuvertes} alerte(s) de distance restent ouvertes : des barrages trop rapprochés par ` +
          `la route, à corriger ou fusionner.`,
      );
    }
    if (m.pointsNoirs.importants > 0) {
      phrases.push(
        `Parmi les points noirs, ${m.pointsNoirs.importants} sont jugés importants au regard de la sévérité, de ` +
          `l'activité routière et de la fréquence d'infractions constatées.`,
      );
    }
  }
  return phrases;
}

/** Couverture opérationnelle — voir `analyserCouverture` dans analysis.js. */
function syntheseCouverture(co) {
  const phrases = [];
  const tauxIsoles = co.barragesTotal
    ? Math.round((co.barragesIsoles.length / co.barragesTotal) * 100)
    : 0;
  if (co.barragesTotal === 0) {
    phrases.push("Aucun barrage n'est actuellement recensé sur le périmètre visible.");
  } else if (co.barragesIsoles.length === 0) {
    phrases.push(
      `L'ensemble des ${co.barragesTotal} barrage(s) recensé(s) se trouve à moins de ${co.seuilKm} km d'un ` +
        `pointage de flotte : la couverture terrain est cohérente avec le dispositif de contrôle en place.`,
    );
  } else {
    phrases.push(
      `${co.barragesIsoles.length} barrage(s) sur ${co.barragesTotal} (${tauxIsoles} %) se trouvent à plus de ` +
        `${co.seuilKm} km de tout pointage de flotte connu — un dispositif posé sans présence de patrouille ` +
        `rapprochée dans le secteur, à vérifier.`,
    );
  }
  if (co.pointsStrategiquesTotal > 0) {
    phrases.push(
      co.pointsStrategiquesSansBarrage.length === 0
        ? `Les ${co.pointsStrategiquesTotal} entrée(s) de ville et péage(s) recensé(s) disposent tous d'un ` +
            `barrage à proximité immédiate.`
        : `${co.pointsStrategiquesSansBarrage.length} point(s) stratégique(s) (entrée de ville ou péage) sur ` +
            `${co.pointsStrategiquesTotal} n'ont aucun barrage à moins de ${co.seuilKm} km — un renfort y serait ` +
            `pertinent, ce sont des passages obligés à fort potentiel de contrôle.`,
    );
  }
  return phrases;
}

/** Efficacité des barrages — voir `analyserEfficaciteBarrages` dans analysis.js. */
function syntheseEfficacite(ef) {
  const pctBaisse = Math.round((ef.ameliores.length / ef.total) * 100);
  const phrases = [
    `Sur ${ef.total} barrage(s) généré(s) depuis un point noir, ${ef.ameliores.length} (${pctBaisse} %) ` +
      `affichent aujourd'hui moins d'accidents sur leur point d'origine qu'au moment de la pose du dispositif — ` +
      `un indice que le barrage produit l'effet recherché.`,
  ];
  if (ef.aggraves.length > 0) {
    phrases.push(
      `${ef.aggraves.length} présentent au contraire une hausse depuis la pose : le dispositif actuel n'y ` +
        `paraît pas suffisant et mérite un réexamen prioritaire (position, horaires, effectif).`,
    );
  }
  if (ef.stables === ef.total) {
    phrases.push(
      "Aucune évolution n'est encore mesurable : la pose est probablement trop récente, ou le point noir " +
        "d'origine n'a pas été remis à jour depuis.",
    );
  }
  return phrases;
}

/**
 * Rapport imprimable — un document, pas une capture du panneau. Fond clair,
 * texte rédigé, titres descriptifs : ce que quelqu'un peut effectivement lire
 * ou faire lire à un supérieur, à la différence du panneau à l'écran qui
 * privilégie la densité d'information. Reste dans le DOM en permanence
 * (`hidden print:block`), n'apparaît qu'à l'impression.
 */
function RapportImpression({
  data,
  marquages,
  report,
  fiche,
  ficheMarquages,
  filtreAnalyse,
  couvertureOperationnelle,
  efficaciteBarrages,
}) {
  const c = data?.couverture;

  /* Le sujet du rapport : la circonscription cliquée sur la carte. Les deux
     autres sources — le panneau Filtrer, puis la recherche libre de ce
     panneau — ont été retirées ; leurs branches ne pouvaient plus être
     atteintes. */
  const scopeActif = fiche
    ? { titre: `Analyse terrain de la circonscription — ${fiche.nom}`, m: ficheMarquages }
    : null;

  const dateGeneration = new Date().toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  let n = 1;
  const numeroSection = () => n++;

  return (
    <div
      className="gr-rapport-impression hidden print:block"
      style={{ padding: '30px 40px', fontFamily: 'Georgia, "Times New Roman", serif' }}
    >
      <header style={{ borderBottom: '3px solid #0b2545', paddingBottom: 14, marginBottom: 22 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: '#0b2545' }}>
          Rapport de synthèse — Gendarmerie Royale
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#555' }}>
          Généré le {dateGeneration} · Portée :{' '}
          {scopeActif ? scopeActif.titre : 'vue nationale, toutes unités confondues'}
        </p>
      </header>

      <section style={{ marginBottom: 24 }}>
        <h2 style={rStyleTitre}>{numeroSection()}. Synthèse générale</h2>
        {marquages && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'Marquages', valeur: marquages.total, couleur: '#0b2545' },
              { label: 'Barrages', valeur: marquages.barrages.total, couleur: '#0b2545' },
              {
                label: 'Sans patrouille',
                valeur: marquages.barrages.sansPatrouille,
                couleur: marquages.barrages.sansPatrouille > 0 ? R_COULEUR.faible : R_COULEUR.fort,
              },
              {
                label: 'Points noirs importants',
                valeur: marquages.pointsNoirs.importants,
                couleur: marquages.pointsNoirs.importants > 0 ? R_COULEUR.faible : R_COULEUR.fort,
              },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  borderTop: `3px solid ${s.couleur}`,
                  background: '#f4f5f7',
                  padding: '6px 12px',
                  minWidth: 90,
                }}
              >
                <div
                  style={{
                    fontSize: 9.5,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: '#666',
                  }}
                >
                  {s.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.couleur }}>
                  {entier(s.valeur)}
                </div>
              </div>
            ))}
          </div>
        )}
        {syntheseGenerale(marquages, c).map((p, i) => (
          <p key={i} style={rStylePara}>
            {p}
          </p>
        ))}
      </section>

      {scopeActif?.m && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={rStyleTitre}>
            {numeroSection()}. {scopeActif.titre}
          </h2>
          {scopeActif.m.pointsForts?.length > 0 && (
            <>
              <h3 style={{ ...rStyleSousTitre, color: R_COULEUR.fort }}>Points forts constatés</h3>
              <ul style={{ margin: '0 0 8px', padding: 0 }}>
                {scopeActif.m.pointsForts.map((t, i) => (
                  <li key={i} style={rStyleEncart(R_COULEUR.fort)}>
                    <strong style={{ color: R_COULEUR.fort }}>{R_SYMBOLE.fort} </strong>
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )}
          {scopeActif.m.pointsFaibles?.length > 0 && (
            <>
              <h3 style={{ ...rStyleSousTitre, color: R_COULEUR.faible }}>Points de vigilance</h3>
              <ul style={{ margin: '0 0 8px', padding: 0 }}>
                {scopeActif.m.pointsFaibles.map((t, i) => (
                  <li key={i} style={rStyleEncart(R_COULEUR.faible)}>
                    <strong style={{ color: R_COULEUR.faible }}>{R_SYMBOLE.faible} </strong>
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )}
          {scopeActif.m.recommandations?.length > 0 && (
            <>
              <h3 style={{ ...rStyleSousTitre, color: R_COULEUR.recommandation }}>
                Recommandations opérationnelles
              </h3>
              <ul style={{ margin: '0 0 8px', padding: 0 }}>
                {scopeActif.m.recommandations.map((t, i) => (
                  <li key={i} style={rStyleEncart(R_COULEUR.recommandation)}>
                    <strong style={{ color: R_COULEUR.recommandation }}>
                      {R_SYMBOLE.recommandation}{' '}
                    </strong>
                    {t}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {couvertureOperationnelle && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={rStyleTitre}>{numeroSection()}. Couverture opérationnelle du territoire</h2>
          {syntheseCouverture(couvertureOperationnelle).map((p, i) => (
            <p key={i} style={rStylePara}>
              {p}
            </p>
          ))}
        </section>
      )}

      {efficaciteBarrages?.total > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={rStyleTitre}>{numeroSection()}. Efficacité mesurée des barrages</h2>
          {syntheseEfficacite(efficaciteBarrages).map((p, i) => (
            <p key={i} style={rStylePara}>
              {p}
            </p>
          ))}
        </section>
      )}

      {report && report.issues?.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={rStyleTitre}>{numeroSection()}. Qualité et fiabilité des données</h2>
          <p style={rStylePara}>
            Le contrôle automatique des couches signale {report.issues.length} anomalie(s) à
            connaître avant toute décision fondée sur ces chiffres :
          </p>
          <ul style={{ margin: '0 0 8px', padding: 0 }}>
            {report.issues.map((it, i) => {
              const couleur = STATUT[it.level] ?? STATUT.warning;
              return (
                <li key={i} style={rStyleEncart(couleur)}>
                  <strong style={{ color: couleur, textTransform: 'uppercase', fontSize: 10.5 }}>
                    {STATUT_LIBELLE[it.level] ?? it.level} :
                  </strong>{' '}
                  {it.message}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <footer
        style={{
          marginTop: 36,
          paddingTop: 14,
          borderTop: '1px solid #ccc',
          fontSize: 10,
          color: '#888',
        }}
      >
        Rapport généré automatiquement par la carte tactique Gendarmerie Royale — document à usage
        interne.
      </footer>
    </div>
  );
}

export default function AnalysisPanel({
  open,
  onClose,
  onOpen,
  data,
  marquages,
  report,
  loading,
  proximite,
  seuilKm,
  fiche,
  ficheCouche,
  ficheMarquages,
  situation,
  brigadeCliquee,
  rosterBrigade,
  onQuitterBrigade,
  onViserBarrage,
  filtreAnalyse,
  onRechercheAnalyseChange,
  couvertureOperationnelle,
  efficaciteBarrages,
  onOuvrirMarquage,
  onClearFiche,
  heatmapOn,
  onBasculerHeatmap,
  comparaisonPeriodes,
  periodeComparaison,
  onChangerPeriode,
}) {
  /**
   * LES SIX ANALYSES DÉTAILLÉES SONT REPLIÉES.
   *
   * Elles restent entières et à un clic. Mais une rangée de six onglets en
   * haut d'un panneau demande de choisir avant d'avoir lu quoi que ce soit —
   * et la question qu'on se pose en ouvrant ANALYSE se répond sans choisir.
   */

  /* Le bouton d’ouverture est rendu par GendarmerieMap (colonne de
     boutons) : empilé ici, il repoussait le panneau ouvert hors écran. */
  /* Gardé monté le temps de sa sortie (voir usePresence). */
  const presence = usePresence(open);
  if (!presence.monte) return null;

  /**
   * Panneau LATÉRAL et non modale plein écran : cliquer un repère depuis
   * l'analyse recadre la carte — encore faut-il la voir. Une modale imposait
   * de fermer le panneau pour constater le résultat de sa propre action.
   */
  /**
   * PAS DE SÉQUENCE INVENTÉE ICI NON PLUS.
   *
   * ANALYSE répond à une question qu'on se pose en l'ouvrant : « où en est-on ? ».
   * Elle n'a rien à faire régler en plusieurs temps. Elle prend donc la MÊME
   * ENVELOPPE que les parcours (`Cartouche`) — même en-tête, mêmes marges,
   * même typographie — sans barre d'avancement ni SUIVANT.
   *
   * Ce qui remplace la séquence, c'est la PORTÉE : national par défaut, la
   * brigade cliquée sur la carte prend sa place. Un seul écran, deux portées.
   */
  return (
    <>
      <Cartouche
        presence={presence.etat}
        icone={IconTarget}
        titre="ANALYSE"
        ar="تحليل المعطيات"
        onFermer={onClose}
        actions={
          <>
            <label className="flex shrink-0 items-center gap-2 rounded-lg bg-white/6 px-2.5 py-2 text-[11px] text-white/80">
              <input type="checkbox" checked={heatmapOn} onChange={onBasculerHeatmap} />
              Carte de risque
            </label>
            <button
              type="button"
              onClick={() => window.print()}
              aria-label="Imprimer le rapport d'analyse"
              title="Imprimer / exporter en PDF ce rapport"
              className="grid size-10 shrink-0 place-items-center rounded-lg text-white/50
                transition-colors duration-150 hover:bg-white/10 hover:text-white
                motion-reduce:transition-none
                focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
            >
              <IconPrint size={18} />
            </button>
          </>
        }
      >
        {/**
         * UNE BRIGADE CLIQUÉE PREND LA PLACE DE LA SITUATION GÉNÉRALE.
         *
         * Elle ne s'ajoute pas en dessous : on vient de désigner une unité, la
         * réponse doit occuper l'écran. Le retour au national est un lien en
         * tête, jamais un chemin à refaire.
         */}
        {brigadeCliquee ? (
          <BrigadeSection
            roster={rosterBrigade}
            creneauCourant={situation?.creneau ?? 0}
            onViser={onViserBarrage}
            onQuitter={onQuitterBrigade}
          />
        ) : (
          <SituationSection situation={situation} onViser={onViserBarrage} />
        )}
      </Cartouche>

      {/* MÊME GARDE QUE `Cartouche` : sans document, pas de portail. Le rendu
          serveur de React ne sait pas en rendre, et `scripts/verifier-rendu.mjs`
          rend cette section dans Node pour éprouver ses deux portées. Le
          rapport imprimable ne sert qu'au navigateur. */}
      {typeof document !== 'undefined' &&
        createPortal(
        <RapportImpression
          data={data}
          marquages={marquages}
          report={report}
          fiche={fiche}
          ficheMarquages={ficheMarquages}
          filtreAnalyse={filtreAnalyse}
          couvertureOperationnelle={couvertureOperationnelle}
          efficaciteBarrages={efficaciteBarrages}
        />,
          document.body,
        )}
    </>
  );
}
