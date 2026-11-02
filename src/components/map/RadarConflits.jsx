import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { Circle, LayerGroup, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import { LIBELLES_PHASE, MAX_VEILLES, PHASES, phaseConflit, positionConflit, typeConflit } from '../../detectionConflits.js';
import { animerTrace, dureeDessin } from '../../animationTrace.js';

/**
 * REPÈRES DES CONFLITS — la ROUTE se dessine, puis le repère pulse.
 *
 * Pour chaque conflit (détecté par le serveur pendant la session, ou trouvé
 * par l'analyse d'un axe) :
 *   1. sa ROUTE RÉELLE se dessine, du premier poste au second, segment après
 *      segment (SVG stroke-dashoffset sur la géométrie exacte du graphe
 *      routier : chaque virage est conservé, aucun point n'est inventé) ;
 *   2. le trait achevé, le repère apparaît en grandissant, trois ondes radar
 *      s'élargissent, la zone du conflit s'allume puis s'efface ;
 *   3. tant que le conflit n'est pas pris en compte, une pulsation discrète
 *      demeure ; ensuite le repère suit le workflow (`phaseConflit`).
 *
 * PLUSIEURS CONFLITS : les routes se dessinent L'UNE APRÈS L'AUTRE (`delai`,
 * fixé par l'appelant) ; chacune une seule fois — un clic la REJOUE
 * (`rejoue`, compteur), sans dupliquer le tracé.
 *
 * PAS DE ROUTE CONNUE (graphe indisponible) : aucune ligne n'est tracée — une
 * droite entre deux postes ne sera jamais présentée comme une route ; le
 * repère le dit (« tracé routier indisponible »).
 *
 * COULEURS : jeton de thème `--gr-conflit` (rouge d'alerte) pour la route ;
 * repères : ambre / bleu / ardoise selon l'état. Animations réduites : la
 * route paraît d'un coup, sans ondes ni pulsation (index.css).
 */

export const COULEURS_PHASE = Object.freeze({
  [PHASES.NOUVEAU]: 'var(--gr-conflit)',
  [PHASES.EN_ATTENTE]: '#F59E0B',
  [PHASES.EN_TRAITEMENT]: '#3B82F6',
  [PHASES.TRAITE]: '#64748B',
});
/** Couleur réelle (attributs SVG de Leaflet : pas de variables CSS). */
const ROUGE_SVG = '#EF4444';
export const DUREE_IMPULSION = 3200;
/** Durée par défaut du dessin d'une route (s) — voir dureeDessin (longueur réelle). */
export const DUREE_TRACE = dureeDessin(10);
const PANE = 'gr-radar';

const GLYPHE_ALERTE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 6v7"/><path d="M12 17.5v.01"/></svg>';
const GLYPHE_TRAITE = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const icones = new Map();
/**
 * Une icône par état d'affichage et par délai d'apparition — jamais
 * recréée, donc jamais rejouée par un simple rendu.
 */
function iconeRadar(phase, enImpulsion, enVeille, delaiS = 0) {
  const d = enImpulsion ? Math.round(delaiS * 100) / 100 : 0;
  const cle = `${phase}|${enImpulsion ? 'i' : ''}|${enVeille ? 'v' : ''}|${d}`;
  if (!icones.has(cle)) {
    const decor = enImpulsion
      ? '<span class="gr-radar-onde"></span><span class="gr-radar-onde"></span><span class="gr-radar-onde"></span>'
      : enVeille
        ? '<span class="gr-radar-veille"></span>'
        : phase === PHASES.EN_TRAITEMENT
          ? '<span class="gr-radar-arc"></span>'
          : '';
    icones.set(cle, L.divIcon({
      className: 'gr-radar-divicon',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: `<span class="gr-radar gr-radar--${phase}${enImpulsion ? ' gr-radar-actif' : ''}" style="--gr-radar-couleur:${COULEURS_PHASE[phase]};--gr-delai:${d}s">`
        + decor
        + `<span class="gr-radar-coeur" aria-hidden="true">${phase === PHASES.TRAITE ? GLYPHE_TRAITE : GLYPHE_ALERTE}</span>`
        + '</span>',
    }));
  }
  return icones.get(cle);
}

function useMaintenant(actif) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return undefined;
    const id = setInterval(() => setT(Date.now()), 500);
    return () => clearInterval(id);
  }, [actif]);
  return t;
}

/**
 * Le tracé SVG d'une route : longueur normalisée (le dessin se règle en %)
 * et son délai / sa durée propres (séquence de plusieurs routes).
 */
/*
 * Les classes sont posées ICI (à l'ajout du tracé), pas seulement par
 * `pathOptions` : react-leaflet applique `pathOptions` par setStyle() APRÈS
 * l'ajout, et Leaflet ne lit `className` qu'à la création de l'élément SVG.
 * Un tracé recréé dans un groupe déjà sur la carte (rejeu) perdait ainsi sa
 * classe — donc son animation et la couleur du thème.
 */
const preparerTrace = (delaiS, dureeS) => (e) => {
  const couche = e.target;
  const p = couche?._path;
  if (!p) return;
  p.classList.add('gr-radar-route');
  /* Dessin progressif + point lumineux qui suit la route (animationTrace.js). */
  const nettoyer = animerTrace(p, { delaiS, dureeS, point: true });
  couche.once('remove', nettoyer);
};
const preparerZone = (delaiS) => (e) => {
  const p = e.target?._path;
  if (!p) return;
  p.classList.add('gr-radar-zone');
  p.style.setProperty('--gr-delai', `${delaiS}s`);
};

/**
 * @param {{
 *   conflits: Array<{ conf: object, impulsionLe: number|null, pris?: boolean, delai?: number, dureeTrace?: number, rejoue?: number, resultat?: boolean }>,
 *   onVoir: (conf: object) => void,
 *   traceDe: (conf: object) => Array<[number, number]> | null,
 *   masquer?: string|null,
 * }} p  `traceDe` : la route réelle [lat, lng] du conflit, ou null ;
 *       `masquer` : conflit affiché par « Voir sur la carte » — sa route est
 *       dessinée là-bas, pas en double ici.
 */
export default function RadarConflits({ conflits = [], onVoir, traceDe = () => null, masquer = null }) {
  const map = useMap();
  /* Volet propre, au-dessus des repères (600) et sous les infobulles (650). */
  const rendu = useMemo(() => {
    if (!map.getPane(PANE)) {
      const p = map.createPane(PANE);
      p.style.zIndex = 640;
    }
    return L.svg({ pane: PANE });
  }, [map]);

  const finImpulsion = (x) => (x.impulsionLe ? x.impulsionLe + ((x.delai ?? 0) + (x.dureeTrace ?? DUREE_TRACE)) * 1000 + DUREE_IMPULSION : 0);
  const enCours = conflits.some((x) => finImpulsion(x) > Date.now());
  const maintenant = useMaintenant(enCours);

  let veilles = 0;
  return (
    <LayerGroup>
      {conflits.map((x) => {
        const { conf, impulsionLe, pris } = x;
        const pos = positionConflit(conf);
        const phase = phaseConflit(conf, { pris });
        if (!pos || !phase) return null;
        const route = traceDe(conf);
        const delai = x.delai ?? 0;
        const dureeTrace = route ? (x.dureeTrace ?? DUREE_TRACE) : 0;
        /* Résultat d'un calcul (`resultat`) : sa route reste dessinée et se
           rejoue quel que soit l'état du conflit dans le workflow (déjà
           assigné, par exemple) — c'est ce que le calcul a trouvé. Sinon
           (détection), seul un conflit NOUVEAU s'anime. */
        const animable = x.resultat === true || phase === PHASES.NOUVEAU;
        const enImpulsion = animable && Boolean(impulsionLe) && maintenant < finImpulsion(x);
        const enVeille = phase === PHASES.NOUVEAU && !enImpulsion && veilles++ < MAX_VEILLES;
        /* L'alerte (rouge) le temps de l'impulsion, puis la couleur de son état. */
        const phaseVue = enImpulsion ? PHASES.NOUVEAU : phase;
        /* Le repère paraît quand SA route est dessinée. */
        const apparition = enImpulsion ? delai + dureeTrace : 0;
        const tour = `${x.rejoue ?? 0}-${impulsionLe ?? 0}`;
        return (
          <LayerGroup key={conf.id}>
            {enImpulsion && (
              <Circle
                key={`zone-${tour}`}
                center={pos.centre}
                radius={pos.rayonM}
                renderer={rendu}
                interactive={false}
                eventHandlers={{ add: preparerZone(apparition) }}
                pathOptions={{ className: 'gr-radar-zone', color: ROUGE_SVG, weight: 1.5, dashArray: '6 6', fillColor: ROUGE_SVG, fillOpacity: 0.1 }}
              />
            )}
            {route && animable && conf.id !== masquer && (
              <Polyline
                /* UN tracé par conflit et par (re)jeu : la clé ne change qu'au
                   rejeu. Le dessin (CSS, `forwards`) reste acquis à la fin ;
                   seule l'opacité baisse après l'impulsion (setStyle). Recréer
                   le tracé à la fin de l'impulsion le faisait disparaître. */
                key={`route-${tour}`}
                positions={route}
                renderer={rendu}
                interactive={false}
                smoothFactor={0.5}
                eventHandlers={{ add: preparerTrace(delai, dureeTrace) }}
                pathOptions={{
                  className: 'gr-radar-route',
                  color: ROUGE_SVG,
                  weight: 4,
                  opacity: enImpulsion ? 0.95 : 0.6,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            )}
            <Marker
              position={pos.centre}
              icon={iconeRadar(phaseVue, enImpulsion, enVeille, apparition)}
              pane={PANE}
              keyboard
              title={`Conflit ${conf.numero || conf.id} — ${LIBELLES_PHASE[phase]} — voir sur la carte`}
              eventHandlers={{
                click: () => onVoir?.(conf),
                keypress: (e) => {
                  if (e.originalEvent?.key === 'Enter') onVoir?.(conf);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -12]}>
                <span className="text-[11.5px]">
                  <b style={{ color: COULEURS_PHASE[phase] }}>Conflit {conf.numero || conf.id}</b>
                  {' · '}
                  {typeConflit(conf)}
                  <br />
                  {LIBELLES_PHASE[phase]}
                  {' · '}
                  {conf.barrageA?.nom || conf.a?.nom || conf.barrageAId} ↔ {conf.barrageB?.nom || conf.b?.nom || conf.barrageBId}
                  {!route && (
                    <>
                      <br />
                      <i>Tracé routier indisponible — aucune route n’est dessinée.</i>
                    </>
                  )}
                </span>
              </Tooltip>
            </Marker>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}
