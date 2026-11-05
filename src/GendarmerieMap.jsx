import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { flushSync, createPortal } from 'react-dom';
import {
  useMap,
  useMapEvents,
  MapContainer,
  GeoJSON,
  Marker,
  Circle,
  CircleMarker,
  Polyline,
  Popup,
  Tooltip,
  LayerGroup,
  ScaleControl,
  AttributionControl,
} from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import FondCarteVectoriel, { COULEURS_ROUTES } from './components/map/FondCarteVectoriel.jsx';
import CoucheOptimisationRoute from './components/map/CoucheOptimisationRoute.jsx';
import OptimisationRoutePanel from './OptimisationRoutePanel.jsx';
import ConflitsRoutePanel from './components/map/ConflitsRoutePanel.jsx';
import ChangerFaction from './components/map/ChangerFaction.jsx';
import AssignerRegion from './components/map/AssignerRegion.jsx';
import AssignationsPanel from './components/map/AssignationsPanel.jsx';
import ConflitAnalysePanel from './components/ConflitAnalysePanel.jsx';
import DemandeApprovalPanel from './components/DemandeApprovalPanel.jsx';
import {
  ARCHIVE_FOND,
  INITIAL_VIEW,
  BORNES_MAROC,
  PROXIMITY_KM,
} from './mapConfig.js';
import { traceCumulKm, projeterSurTrace } from './correlation.js';
import {
  COLORS,
  CLASSES_ROUTE,
  HABILLAGE,
  CIRCO_LAYERS,
  POINT_LAYERS,
  INFRASTRUCTURE_LAYERS,
  POINTAGE_LAYERS,
  PROXIMITY_LAYERS,
  MARQUAGE_LAYERS,
  ALL_LAYERS,
} from './layersConfig.js';

/** Couches proposées dans « Filtres » (le panneau des couches n'a plus d'entrée propre). */
const COUCHES_FILTRES = [...CIRCO_LAYERS, ...POINT_LAYERS];
import SidePanel from './SidePanel.jsx';
import AnalysisPanel from './AnalysisPanel.jsx';
import MarquagePanel, { PointNoirModal } from './MarquagePanel.jsx';
import { MessageFlottant } from './Parcours.jsx';
import DistancePanel from './DistancePanel.jsx';
import OptimisationPanel from './OptimisationPanel.jsx';
import Modal3D from './Modal3D.jsx';
import ConflitsIdentifiesLayer from './components/map/ConflitsIdentifiesLayer.jsx';
import ModalAssignerConflit from './components/map/ModalAssignerConflit.jsx';
import ModalTransmettreCie from './components/map/ModalTransmettreCie.jsx';
import CarteReevaluation from './components/map/CarteReevaluation.jsx';
import ModalTraiterConflit from './components/map/ModalTraiterConflit.jsx';
import PanneauConflitsLateral from './components/map/PanneauConflitsLateral.jsx';
import ModalFiltrerParRoute from './components/map/ModalFiltrerParRoute.jsx';
import BarreComparatifAvantApresCarte from './components/map/BarreComparatifAvantApresCarte.jsx';
import { canonicalRouteId, clePaire } from './conflitsIdentifies.js';
import { compterATraiter, libelleAssignation, rapprocherConflitsEnregistres } from './actionsConflit.js';
import {
  obtenirDirectionBarrage,
  libelleDirection,
  badgeDirection,
  separerBarragesSens,
  SENS_ALLER,
  SENS_RETOUR,
  SENS_TOUS,
} from './directionSens.js';
import HeatmapLayer from './HeatmapLayer.jsx';
import AdminPanel from './AdminPanel.jsx';
import HierarchiePanel from './HierarchiePanel.jsx';
import NotificationsPanel from './NotificationsPanel.jsx';
import {
  CommandBar,
  ConfirmationDeconnexionModal,
  NavigationRail,
  TerritorialBreadcrumb,
  ContextSummary,
  MapFilters,
  FactionFilter,
  MapStateNotice,
  BarrageStatFilter,
  MenuFiltresUnifie,
  MenuOptimisation,
  MenuOutilsCarte,
  nombreOptimisationsActives,
} from './components/command-center/index.js';
import {
  StatistiquesCarte,
  LegendeCarte,
  LegendeRisque,
  RechercheCarte,
  FondInjoignable,
  CommandesPopup,
  DecisionPopup,
  ExclusionPopup,
  formeExclusion,
  CLE_LEGENDE_POSITION,
  positionEnregistree,
  BarrageClusterLayer,
  ModifierBarrage,
} from './components/map/index.js';
import { ExplicationOptimisation, ActionsSimulation } from './components/map/MapPopups.jsx';
import {
  agregerBarragesHierarchie,
  determinerNiveauHierarchie,
  construireIndexAdministratif,
  diagnostiquerHierarchie,
  explorerCluster,
  normaliserNomEntite,
} from './barrageClustering.js';
import {
  COUCHE_ECHELON,
  COUCHES_LIMITES,
  PANE_LIMITES,
  PANE_CONTOUR,
  DUREE_FONDU,
  LIBELLE_ECHELON,
  echelonPourZoom,
  visibiliteLimites,
} from './limitesTerritoriales.js';
import * as RT from './routage.js';
import { pinIcon, echelleZoom } from './markerIcons.js';
import {
  computeAnalysis,
  computeProximity,
  analyseEntite,
  computeMarquagesAnalysis,
  analyserMarquagesFiche,
  analyserCouverture,
  analyserEfficaciteBarrages,
  comparerPeriodes,
  analyserCouvertureRoute,
} from './analysis.js';
import * as MQ from './marquages.js';
import { uniquesParIdentifiant } from './optimisationAffichage.js';
import { retraitATrancher } from './instructionsRegles.js';
import { pousserDedans } from './placementBulle.js';
/* Ce que la carte montre sans devenir illisible — regles pures, eprouvees
   par scripts/verifier-placement.mjs. */
import { badgesVisibles, coteDecision } from './carteLisibilite.js';
import { poleInaccessibilite, preparerGeometrie } from './placementEtiquettes.js';
import { pairesConflitActives } from './etatConflits.js';
import { useTheme, HABILLAGE_THEME, themeInitial, mouvementReduit } from './theme.js';
import Toasts, { notifier } from './components/Toasts.jsx';
import { creerDetecteur, phaseConflit } from './detectionConflits.js';
import { calculerConflitsRoute, barragesDeLaRoute, AnalyseInterrompue } from './calculConflitsRoute.js';
import RadarAnalyse from './components/map/RadarAnalyse.jsx';
import { dureeDessin, longueurKm } from './animationTrace.js';
import RouteAnimee from './components/map/RouteAnimee.jsx';
import NavigationGeographique from './components/command-center/NavigationGeographique.jsx';
import CarteResultatAnalyse from './components/map/CarteResultatAnalyse.jsx';

/** Durée minimale d'affichage du balayage radar (ms) — voir lancerAnalyseRoute. */
const DUREE_MIN_SCAN = 1200;
import IndicateurDetection from './components/map/IndicateurDetection.jsx';
import RadarConflits from './components/map/RadarConflits.jsx';
import CarteNouveauConflit from './components/map/CarteNouveauConflit.jsx';
import GardeErreur from './components/GardeErreur.jsx';
import * as API from './api.js';
import {
  IconPlus,
  IconFocusQuitter,
  IconRestaurer,
  IconSpinner,
  IconCible,
  IconTarget,
  IconSatellite,
  IconAlert,
  IconMarquage,
  IconDistance,
  IconTerritoire,
  IconBarrageFixe,
  IconBarrageIntouchable,
  IconChef,
  IconLayers,
  IconHoraire,
  IconDeconnexion,
  IconCoche,
  IconRoute,
} from './icons.jsx';

const bouton =
  'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold ' +
  'transition-colors duration-150 motion-reduce:transition-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

/** Le mot qui désigne le périmètre d'écriture d'un rang, dans une phrase de refus. */
const motPerimetre = (rang) =>
  rang === 'reg' ? 'région' : rang === 'cie' ? 'circonscription' : 'brigade territoriale';

/* ================================================================== */
/* Chargement des couches à la demande                                */
/* ================================================================== */

/** Cache mémoire : un fichier n'est jamais téléchargé deux fois. */
function useGeoJsonStore() {
  const [store, setStore] = useState({}); // dataKey -> {data|error|loading}
  const inFlight = useRef(new Set());

  const load = useCallback((key, url) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setStore((s) => ({ ...s, [key]: { loading: true } }));

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setStore((s) => ({ ...s, [key]: { data } })))
      .catch((err) => {
        inFlight.current.delete(key); // autorise une nouvelle tentative
        setStore((s) => ({ ...s, [key]: { error: err.message } }));
      });
  }, []);

  return [store, load];
}

/* ================================================================== */
/* Rendu des entités                                                  */
/* ================================================================== */

/**
 * Nom lisible d'un contour, quelle que soit la couche :
 * `nom` est posé au build sur les contours régionaux et de compagnie,
 * `gr_bde` vient des circonscriptions BT.
 */
const nomCirco = (p) => p?.nom ?? p?.gr_bde ?? null;

/**
 * Contour d'une entité, retrouvé par son nom.
 *
 * L'égalité stricte ne suffit pas : le nom vient parfois d'un enregistrement
 * de barrage (« CIE Settat », accentué ou non) et non du contour lui-même.
 * On retombe donc sur la forme normalisée, celle qui sert déjà à rattacher un
 * barrage à sa hiérarchie (voir `normaliserNomEntite`).
 */
/** Couche de contours correspondant à un échelon de la hiérarchie. */
const COUCHE_DU_NIVEAU = {
  region: 'circo_reg',
  compagnie: 'circo_cie',
  brigade: 'circo_bt',
};

const trouverContour = (fc, nom) => {
  const features = (nom && fc?.features) || [];
  const cible = nom ? normaliserNomEntite(nom).toLowerCase() : '';
  const approchant = cible
    ? features.find((f) => {
      const n = nomCirco(f.properties);
      return n && normaliserNomEntite(n).toLowerCase() === cible;
    })
    : null;
  return features.find((f) => nomCirco(f.properties) === nom) ?? approchant ?? null;
};

/**
 * LA PETITE BULLE D'UNE RÉGION (ou compagnie, brigade) — après un double-clic :
 * le nom, l'échelon, et deux ou trois chiffres utiles. Pas de tableau.
 */
const echapperHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bulleCirconscription = ({ echelon, nom, lignes }) => `
  <div class="gr-bulle-circo">
    <span class="gr-bulle-circo-tag">${echapperHtml(echelon)}</span>
    <strong class="gr-bulle-circo-nom">${echapperHtml(nom)}</strong>
    ${lignes.filter(Boolean).map((l) => `<span class="gr-bulle-circo-ligne">${echapperHtml(l)}</span>`).join('')}
  </div>`;

/** Thème courant, lu sur <html> (voir src/theme.js) : défaut des couches sans prop. */
const themeDocument = () => themeInitial();

/**
 * Couche surfacique (circonscription).
 *
 * Un clic sur un contour nommé cadre la carte dessus et le sélectionne, ce qui
 * ouvre sa fiche analytique. La surbrillance du contour retenu est appliquée
 * par `setStyle` sur la couche existante plutôt qu'en re-montant le GeoJSON :
 * re-créer 504 polygones à chaque sélection serait inutilement coûteux.
 */
/**
 * Liseré sombre posé sous un contour coloré.
 *
 * C'est ce qui rend une couleur vive lisible quel que soit le fond de carte :
 * la couleur ne touche jamais le fond, elle touche le liseré. Sans lui, un
 * jaune ou un vert clair — indispensables pour que les couches se distinguent
 * entre elles — disparaîtraient sur un plan clair.
 */
function Casing({ data, weight, pane, theme = themeDocument() }) {
  const style = useMemo(
    () => ({
      color: HABILLAGE_THEME[theme].liseré,
      weight: weight + 2.2,
      opacity: HABILLAGE_THEME[theme].liseréOpacite,
      fill: false,
      lineJoin: 'round',
    }),
    [weight, theme],
  );

  return <GeoJSON data={data} style={style} interactive={false} pane={pane} />;
}

/**
 * @param {boolean} attenue  L'échelon n'est pas celui que le zoom désigne : il
 *   n'est là que pour situer (voir `OPACITE_ROLE` dans limitesTerritoriales).
 *   Trait plus fin, aucun remplissage — le remplissage du parent teinterait
 *   toute la surface de l'échelon principal qu'il contient.
 */
/**
 * @param {(nom: string, proprietes: object) => boolean} autorise
 *   Le contour relève-t-il de la portée du compte ? Décidé UNE FOIS par
 *   contour, au montage : la portée vient de la session, qui ne change pas
 *   sans reconnexion. Un contour refusé ne reçoit ni bulle, ni infobulle, ni
 *   sélection — seulement un refus dit à voix haute. Cacher la donnée sans
 *   protéger l'action laisserait un chef de brigade ouvrir la fiche de la
 *   compagnie voisine d'un simple clic.
 * @param {(nom: string) => void} onRefus
 * @param {object} bornesRetour Zone retrouvée au second clic (dé-sélection) :
 *   sa propre portée, et non la vue nationale — voir `bornesPortee`.
 */
function CircoLayer({
  cfg, data, selection, onSelect, outilArme, pane, attenue = false,
  autorise = () => true, onRefus = () => { }, bornesRetour = null, theme = 'dark',
  onEntrer = null,
}) {
  const map = useMap();
  const ref = useRef(null);

  /**
   * L'état d'armement est lu par référence : les gestionnaires sont attachés
   * une fois par entité, et une simple prop les ferait tous reconstruire —
   * 517 polygones re-liés à chaque clic sur un bouton de nature.
   */
  const armeRef = useRef(outilArme);
  armeRef.current = outilArme;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  /* Mêmes raisons que `armeRef` : lues par référence pour ne pas relier les
     517 polygones à chaque rendu du parent. */
  const autoriseRef = useRef(autorise);
  autoriseRef.current = autorise;
  const refusRef = useRef(onRefus);
  refusRef.current = onRefus;
  const bornesRef = useRef(bornesRetour);
  bornesRef.current = bornesRetour;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  /* Double-clic : entrer dans l'entité (lu par référence, comme les autres). */
  const entrerRef = useRef(onEntrer);
  entrerRef.current = onEntrer;

  const selectionne = selection?.couche === cfg.key ? selection.nom : null;

  const style = useCallback(
    (feature) => {
      const actif = nomCirco(feature.properties) === selectionne;
      const baseColor = cfg.color || (cfg.key === 'circo_reg' ? COLORS.reg : cfg.key === 'circo_cie' ? COLORS.cie : COLORS.bt);
      /* Couleur inchangée : la hiérarchie se lit à la teinte (jaune région,
         bleu compagnie, vert brigade — voir palette.js), et un parent qui
         changerait de couleur ne serait plus reconnu comme le même découpage.
         Seuls l'épaisseur et le remplissage reculent ; l'opacité du volet
         fait le reste (voir PANE_LIMITES). */
      if (attenue) {
        return {
          color: baseColor,
          weight: Math.max(0.8, cfg.weight * 0.85),
          fill: false,
        };
      }
      /* La sélection prend l'accent du thème, avec un remplissage léger : elle
         se distingue sans masquer ce qu'elle contient. */
      const accent = HABILLAGE_THEME[theme].selection;
      return {
        color: actif ? accent : baseColor,
        weight: actif ? cfg.weight + 2 : cfg.weight,
        fillColor: actif ? accent : baseColor,
        fillOpacity: actif ? 0.14 : (cfg.fillOpacity || 0.04),
      };
    },
    [cfg, selectionne, attenue, theme],
  );

  // Réapplique le style quand la sélection change
  useEffect(() => {
    ref.current?.setStyle(style);
  }, [style]);

  const onEachFeature = useCallback(
    (feature, layer) => {
      const p = feature.properties || {};
      const nom = nomCirco(p);
      if (!nom) return; // contour anonyme : ni infobulle, ni clic

      /* HORS PORTÉE : le contour reste dessiné — il faut bien voir où s'arrête
         sa propre zone — mais il ne s'ouvre pas et ne se sélectionne pas. */
      if (!autoriseRef.current(nom, p)) {
        layer.on('click', (e) => {
          if (armeRef.current) {
            map.fire('click', e);
            return;
          }
          refusRef.current(nom);
        });
        return;
      }

      /* Plus de bulle de détails au clic : le double-clic entre dans l'entité
         et montre une petite bulle (voir `entrerCirconscription`). */

      const isReg = cfg.key === 'circo_reg';
      const isCie = cfg.key === 'circo_cie';
      const echelonLibelle = isReg ? 'RÉGION' : isCie ? 'COMPAGNIE' : 'BRIGADE';
      const typeClass = isReg ? 'gr-circo-badge-reg' : isCie ? 'gr-circo-badge-cie' : 'gr-circo-badge-bt';

      const badgeHtml = `
        <div class="gr-circo-badge ${typeClass}">
          <span class="gr-circo-badge-tag">${echelonLibelle}</span>
          <span class="gr-circo-badge-name">${nom}</span>
        </div>`;

      layer.bindTooltip(badgeHtml, {
        sticky: true,
        direction: 'top',
        offset: [0, -10],
        opacity: 1,
        className: 'gr-circo-label-tooltip',
      });

      layer.on({
        mouseover: (e) =>
          e.target.setStyle({
            color: HABILLAGE_THEME[themeRef.current].survol,
            fillColor: HABILLAGE_THEME[themeRef.current].survol,
            weight: cfg.weight + 1.8,
            fillOpacity: 0.16,
          }),
        mouseout: () => ref.current?.setStyle(style),
        click: (e) => {
          /**
           * Quand un OUTIL DE CLIC est armé, le clic sert à l'outil et non à
           * sélectionner la circonscription : pose d'un marquage, jalon de
           * l'outil Distances.
           */
          if (armeRef.current) {
            layer.closePopup();
            map.fire('click', e);
            return;
          }

          const currentSel = selectionRef.current;
          const dejaSelectionne = currentSel?.couche === cfg.key && currentSel?.nom === nom;

          if (dejaSelectionne) {
            onSelect(null);
          } else {
            // Clic simple : sélection de la circonscription sans zoomer
            const bounds = e.target.getBounds();
            onSelect({
              couche: cfg.key,
              nom,
              bounds,
              geometry: feature.geometry,
              properties: p,
            });
          }
        },
        dblclick: (e) => {
          /* Double-clic : ENTRER dans la circonscription — cadrage adapté,
             contour, fil d'Ariane, et une petite bulle. Repli : le cadrage seul. */
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          if (armeRef.current) return;
          if (entrerRef.current) {
            entrerRef.current({ couche: cfg.key, nom, properties: p, latlng: e.latlng });
            return;
          }
          const bounds = e.target.getBounds();
          if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
          }
        },
      });
    },
    [cfg, map, onSelect, style],
  );

  return (
    <GeoJSON
      ref={ref}
      data={data}
      style={style}
      onEachFeature={onEachFeature}
      pane={pane}
    /* `interactive` reste vrai : c'est ce qui rend les contours cliquables.
       Un échelon en retrait est neutralisé par le `pointer-events` de son
       volet, et non ici : changer cette option demanderait de remonter la
       couche entière à chaque franchissement de seuil. */
    />
  );
}

/**
 * Couche ponctuelle (chef-lieu), rendue en marqueurs GPS.
 *
 * `echelle` vient du zoom (voir `echelleZoom`) : les pins rétrécissent quand on
 * s'éloigne, sans quoi la vue nationale se couvre de gouttes.
 */
function PointLayer({ cfg, data, echelle = 1, niveauHierarchie = 'region' }) {
  const niveauDuPoint = { pts_reg: 'region', pts_cie: 'compagnie', pts_bt: 'barrage' }[cfg.key];
  const etiquettePermanente = niveauDuPoint
    ? niveauDuPoint === niveauHierarchie
    : cfg.permanentLabel;
  const icon = useMemo(
    () =>
      pinIcon({
        glyph: cfg.glyph,
        color: cfg.color,
        scale: cfg.scale * echelle,
      }),
    [cfg, echelle],
  );

  const pointToLayer = useCallback(
    (feature, latlng) => {
      const p = feature.properties || {};
      const nom = p.nom || p.unite || 'Unité';

      const marker = L.marker(latlng, { icon, title: nom, riseOnHover: true });

      const rows = [
        p.cie && `<tr><td>Compagnie</td><td>${p.cie}</td></tr>`,
        p.reg && `<tr><td>Région</td><td>${p.reg}</td></tr>`,
        p.categorie && `<tr><td>Catégorie</td><td>${p.categorie}</td></tr>`,
      ]
        .filter(Boolean)
        .join('');

      marker.bindPopup(
        `<div class="gr-popup"><h4>${nom}</h4>${rows ? `<table class="gr-tbl">${rows}</table>` : ''
        }</div>`,
      );

      if (etiquettePermanente) {
        marker.bindTooltip(nom, {
          permanent: true,
          direction: 'top',
          className: 'gr-label',
        });
      } else {
        marker.bindTooltip(nom, { direction: 'top' });
      }

      return marker;
    },
    [cfg, icon, etiquettePermanente],
  );

  return <GeoJSON data={data} pointToLayer={pointToLayer} />;
}

/**
 * Pointages de flottes (contrôles routiers) : le repère ET son emprise.
 *
 * Les deux ne font qu'un objet — le point est le lieu du contrôle, le cercle la
 * portée annoncée. Les séparer en deux couches laissait croire à deux jeux de
 * données distincts.
 */
function PointageLayer({ data, cfg, echelle = 1 }) {
  const icon = useMemo(
    () =>
      pinIcon({
        glyph: cfg.glyph,
        color: cfg.color,
        scale: cfg.scale * echelle,
      }),
    [cfg, echelle],
  );

  return (
    <LayerGroup>
      {cfg.avecZone && <PointageZones data={data} />}
      {data.features.map((f, i) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        return (
          <Marker
            key={p.id || i}
            position={[lat, lng]}
            icon={icon}
            title={p.pk || p.unite || 'Pointage'}
            riseOnHover
          >
            <Tooltip direction="top">{p.pk || p.unite}</Tooltip>
            <Popup>
              <div className="gr-popup">
                <h4>{p.pk || 'Pointage'}</h4>
                <table className="gr-tbl">
                  <tbody>
                    <tr>
                      <td>Unité</td>
                      <td>{p.unite ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Mission</td>
                      <td>{p.mission ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Type</td>
                      <td>{p.sousMission ?? '—'}</td>
                    </tr>
                    <tr>
                      <td>Zone</td>
                      <td>{p.diametre ? `${p.diametre} m (diam.)` : '—'}</td>
                    </tr>
                    <tr>
                      <td>Début</td>
                      <td>{p.debut ? new Date(p.debut).toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                    <tr>
                      <td>Fin</td>
                      <td>{p.fin ? new Date(p.fin).toLocaleString('fr-FR') : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </LayerGroup>
  );
}

/** Emprise réelle de chaque pointage (rayon = diamètre / 2). */
function PointageZones({ data }) {
  return (
    <LayerGroup>
      {data.features.map((f, i) => {
        const [lng, lat] = f.geometry.coordinates;
        const d = f.properties.diametre;
        if (!d) return null;
        return (
          <Circle
            key={f.properties.id || i}
            center={[lat, lng]}
            radius={d / 2}
            pathOptions={{
              color: COLORS.pointage,
              weight: 1,
              fillColor: COLORS.pointage,
              fillOpacity: 0.07,
            }}
          />
        );
      })}
    </LayerGroup>
  );
}

/** Itinéraire multi-points : tracé par jambe + jalons lettrés. */
const COULEURS_JAMBE = ['#c8a349', '#4ea8de', '#69db7c', '#f08080', '#da77f2', '#74c0fc'];

function ItineraireLayer({ resultat, jalons }) {
  return (
    <LayerGroup>
      {/* Tracé des jambes */}
      {resultat?.jambes?.map((jambe, i) => {
        if (!jambe) return null;
        const couleur = COULEURS_JAMBE[i % COULEURS_JAMBE.length];
        return (
          <LayerGroup key={`jambe-${i}`}>
            <Polyline
              positions={jambe.trace.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: '#0b1220',
                weight: 9,
                opacity: 0.55,
                lineCap: 'round',
              }}
              interactive={false}
            />
            <Polyline
              positions={jambe.trace.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: couleur,
                weight: 4.5,
                opacity: 1,
                lineCap: 'round',
              }}
              interactive={false}
            />
          </LayerGroup>
        );
      })}

      {/* Marqueurs des jalons */}
      {jalons.map((j, i) => {
        if (!j) return null;
        const lettre = String.fromCharCode(65 + i);
        return (
          <LayerGroup key={`jalon-${i}`}>
            <Polyline
              positions={[
                [j.lat, j.lng],
                [j.accroche.lat, j.accroche.lng],
              ]}
              pathOptions={{ color: '#c8a349', weight: 1.5, dashArray: '3, 4' }}
              interactive={false}
            />
            <Circle
              center={[j.accroche.lat, j.accroche.lng]}
              radius={70}
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                fillColor: '#c8a349',
                fillOpacity: 1,
              }}
            >
              <Tooltip direction="top" permanent className="gr-label">
                {lettre}
              </Tooltip>
            </Circle>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}

/* ================================================================== */
/* Habillage : voile hors territoire                                  */
/* ================================================================== */

/**
 * Masque tout ce qui n'est pas le territoire national, et trace la frontière.
 *
 * Un seul polygone troué (le monde moins le territoire) plutôt qu'un masque
 * par pays voisin : c'est le même principe que la brume de sélection, et cela
 * reste juste quel que soit le nombre de voisins.
 *
 * OPACITÉ TOTALE, ET NON PLUS UN VOILE
 * ------------------------------------
 * Le masque laissait auparavant transparaître les pays limitrophes à 60 %,
 * pour garder le contexte en zone frontalière. Ce n'est plus le cas : la carte
 * ne doit montrer que le territoire national. Ce qui est hors compétence n'est
 * pas atténué, il est absent — au même titre que la limite de déplacement et
 * le plancher de zoom, qui empêchent d'aller le chercher.
 */
function VoileTerritoire({ feature, opacite = 1, theme = 'dark' }) {
  const voile = useMemo(() => {
    try {
      return turf.difference(turf.featureCollection([MONDE, feature]));
    } catch {
      return null;
    }
  }, [feature]);

  if (!voile) return null;

  return (
    <LayerGroup>
      <GeoJSON
        data={voile}
        interactive={false}
        style={{
          stroke: false,
          fillColor: HABILLAGE_THEME[theme].voileHorsTerritoire,
          fillOpacity: opacite,
        }}
      />
      {/* Liseré de frontière : cadre la lecture sans peser sur la carte */}
      <GeoJSON
        data={feature}
        interactive={false}
        style={{
          color: HABILLAGE_THEME[theme].frontiere,
          weight: 1.6,
          opacity: 0.75,
          fill: false,
        }}
      />
    </LayerGroup>
  );
}

/* ================================================================== */
/* Brume : tout sauf l'entité retenue                                 */
/* ================================================================== */

/** Rectangle couvrant le monde, percé ensuite par l'entité sélectionnée. */
const MONDE = turf.polygon([
  [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ],
]);

/**
 * VOLETS DES LIMITES TERRITORIALES — créés une fois, jamais recréés.
 *
 * Trois volets Leaflet, un par échelon, dont l'ordre d'empilement et la
 * raison d'être sont documentés dans `PANE_LIMITES` (limitesTerritoriales.js).
 * Leur `opacity` est la seule chose que le zoom fera bouger ensuite : faire
 * apparaître un découpage de 500 polygones revient alors à écrire un nombre
 * dans une propriété CSS, et non à reconstruire une couche.
 *
 * Le fondu est refusé à qui demande moins d'animations (`prefers-reduced-
 * motion`) : la bascule est alors immédiate, ce qui reste juste — le fondu
 * est un confort de lecture, pas une information.
 */
/**
 * VOLET DE LA SÉLECTION DE POSITION — le seul, avec le fond de carte, qui
 * reste visible pendant le choix d'une nouvelle position (déplacement d'un
 * barrage) : voir `[data-gr-selection-position]` dans index.css. Les autres
 * couches sont masquées, jamais retirées.
 */
const PANE_SELECTION = 'gr-selection';
function VoletSelection() {
  const map = useMap();
  useEffect(() => {
    if (!map.getPane(PANE_SELECTION)) map.createPane(PANE_SELECTION).style.zIndex = '660';
  }, [map]);
  return null;
}

function VoletsLimites() {
  const map = useMap();

  useEffect(() => {
    const sobre = mouvementReduit();
    for (const def of [...Object.values(PANE_LIMITES), PANE_CONTOUR]) {
      if (map.getPane(def.nom)) continue;
      const volet = map.createPane(def.nom);
      volet.style.zIndex = String(def.zIndex);
      if (!sobre) volet.style.transition = `opacity ${DUREE_FONDU}ms linear`;
      /* Point de départ commun : invisible et inerte. `AppliquerLimites`
         relève l'échelon voulu dès le premier rendu. */
      volet.style.opacity = '0';
      volet.style.pointerEvents = 'none';
    }
    /* Le contour d'entité n'est jamais atténué ni cliquable : il double un
       contour déjà présent, qui garde bulle et sélection. */
    const contour = map.getPane(PANE_CONTOUR.nom);
    if (contour) contour.style.opacity = '1';
  }, [map]);

  return null;
}

/**
 * APPLICATION DE L'ÉTAT DES LIMITES — le seul endroit qui touche aux volets.
 *
 * Deux propriétés CSS par volet, à chaque changement d'échelon. Aucun parcours
 * de géométrie, aucun `setStyle` sur des milliers de tracés : c'est ce qui
 * rend la bascule gratuite, même sur les 500 circonscriptions de brigade.
 */
function AppliquerLimites({ couches }) {
  const map = useMap();

  useEffect(() => {
    const sobre = mouvementReduit();
    for (const cle of COUCHES_LIMITES) {
      const volet = map.getPane(PANE_LIMITES[cle].nom);
      if (!volet) continue;
      const etat = couches[cle];
      /**
       * ON S'ÉTEINT SEC, ON S'ALLUME EN FONDU.
       *
       * Un fondu croisé ferait cohabiter deux découpages pendant deux
       * dixièmes de seconde — l'ancien pas encore parti, le nouveau déjà là.
       * C'est court, mais c'est précisément ce que la règle interdit : à
       * aucun instant deux échelons superposés. L'échelon qui s'en va
       * disparaît donc immédiatement ; seul celui qui arrive prend le temps
       * d'apparaître, ce qui suffit à ce que la bascule ne soit pas brutale.
       */
      volet.style.transition = etat.opacite > 0 && !sobre
        ? `opacity ${DUREE_FONDU}ms linear`
        : 'none';
      volet.style.opacity = String(etat.opacite);
      volet.style.pointerEvents = etat.interactif ? 'auto' : 'none';
    }
  }, [map, couches]);

  return null;
}

/**
 * Volet dédié à la brume.
 *
 * Placé au-dessus des marqueurs (600) mais sous les infobulles (650) : les
 * unités hors zone sont donc assombries avec le fond, alors que les libellés
 * restent lisibles. `pointerEvents: none` garantit que la brume n'intercepte
 * aucun clic — sans quoi elle rendrait la carte inerte.
 */
function VoletBrume() {
  const map = useMap();

  useEffect(() => {
    if (map.getPane('gr-brume')) return;
    const volet = map.createPane('gr-brume');
    volet.style.zIndex = 640;
    volet.style.pointerEvents = 'none';
  }, [map]);

  return null;
}

/**
 * Assombrit tout le territoire SAUF le contour retenu.
 *
 * Le voile est un seul polygone troué (monde moins la sélection) plutôt qu'un
 * assombrissement de chaque entité voisine : le rendu ne dépend donc pas des
 * couches affichées, et une seule forme est dessinée quel que soit le nombre
 * de circonscriptions chargées.
 */
function Brume({ geometry, cle, opacite = 0.55 }) {
  const voile = useMemo(() => {
    if (!geometry) return null;
    try {
      return turf.difference(turf.featureCollection([MONDE, turf.feature(geometry)]));
    } catch {
      // Géométrie invalide (auto-intersection) : pas de brume plutôt qu'un plantage.
      return null;
    }
  }, [geometry]);

  if (!voile) return null;

  return (
    <GeoJSON
      /* `key` obligatoire : react-leaflet fige `data` à la création de la
         couche. Sans remontage, changer de circonscription laisserait le
         trou de la brume sur la précédente. */
      key={cle}
      data={voile}
      pane="gr-brume"
      interactive={false}
      style={{ stroke: false, fillColor: '#050a14', fillOpacity: opacite }}
    />
  );
}

/* ================================================================== */
/* Marquages du chef de compagnie                                     */
/* ================================================================== */

/** Contour d'habilitation : le périmètre où la saisie est permise. */
function PerimetreSaisie({ feature }) {
  if (!feature) return null;

  return (
    <GeoJSON
      key={feature.properties?.nom ?? 'perimetre'}
      data={feature}
      interactive={false}
      style={{
        color: '#c8a349',
        weight: 2.5,
        dashArray: '7, 5',
        fillColor: '#c8a349',
        fillOpacity: 0.05,
      }}
    />
  );
}

/**
 * CONTOUR DE L'ENTITÉ OÙ L'ON VIENT DE SE RENDRE.
 *
 * Zoomer sur une région ou une compagnie — en cliquant son agrégat de
 * barrages, ou en la choisissant dans un panneau — cadrait la vue sans jamais
 * dire OÙ s'arrête l'entité : on lisait des repères groupés au centre de
 * l'écran sans savoir lesquels des repères voisins en font partie.
 *
 * Seul le contour de l'entité visée est tracé, et non toute la couche de son
 * échelon : la question posée est « jusqu'où va CELLE-CI », pas « comment le
 * pays est-il découpé » — ce second besoin garde sa case dans le panneau des
 * couches (`circo_reg`, `circo_cie`, `circo_bt`).
 *
 * Non interactif : il se superpose aux couches de circonscription, qui
 * gardent leurs bulles et leur sélection. Un contour qui capterait le clic
 * volerait celui destiné au polygone qu'il recouvre exactement.
 */
function ContourEntite({ feature, couleur }) {
  const style = useMemo(
    () => ({
      color: couleur,
      weight: 3.2,
      opacity: 0.95,
      fillColor: couleur,
      fillOpacity: 0.06,
      lineJoin: 'round',
    }),
    [couleur],
  );

  if (!feature) return null;

  return (
    <LayerGroup>
      {/* Même liseré sombre que les circonscriptions : la couleur ne touche
          jamais le fond de carte, elle touche le liseré. */}
      <Casing data={feature} weight={3.2} pane={PANE_CONTOUR.nom} />
      <GeoJSON
        key={`contour|${nomCirco(feature.properties) ?? ''}`}
        data={feature}
        interactive={false}
        style={style}
        /* Au-dessus des trois échelons : l'entité visée doit rester lisible
           même quand la limite de brigade passe au même endroit. */
        pane={PANE_CONTOUR.nom}
      />
    </LayerGroup>
  );
}

/**
 * Repères saisis. Seuls ceux de la compagnie habilitée sont déplaçables :
 * l'autorisation est vérifiée ici (affichage) ET au dépôt (`onDeplacer`), le
 * glissement d'un repère pouvant sortir du périmètre.
 */
/**
 * Modifier / Supprimer, posés dans la bulle d'un repère.
 *
 * POURQUOI ICI PLUTÔT QUE DANS LA FICHE
 * -------------------------------------
 * Ces deux actions existaient déjà, mais au bout d'un chemin que personne ne
 * devine : ouvrir SAISIE TERRAIN, cliquer le repère (le clic ne faisait rien
 * tant que le panneau restait fermé), dérouler la fiche jusqu'en bas pour
 * trouver « Supprimer ». Sur la carte, un barrage cliqué n'offrait qu'une vue
 * aérienne. La bulle est l'endroit où l'on est déjà quand on veut agir sur un
 * repère : c'est là que les commandes doivent se trouver.
 *
 * La suppression demande une confirmation dans le bouton lui-même, sans
 * fenêtre par-dessus : un second clic, au même endroit, sur un libellé qui a
 * changé. Le premier clic n'engage à rien, et refermer la bulle annule.
 */

/**
 * QUI TIENT CE POSTE, MAINTENANT — dans la popup du barrage.
 *
 * Le renseignement le plus demandé devant un barrage est aussi celui qui
 * coûtait le plus cher à obtenir : il fallait ouvrir le panneau de saisie,
 * retrouver la brigade, puis le poste. Trois gestes pour lire six noms. La
 * popup les donne d'un clic, là où on les cherche.
 *
 * CHARGÉ SEULEMENT À L'OUVERTURE. React-Leaflet ne rend le contenu d'une popup
 * qu'une fois celle-ci ouverte (`_contentNode` n'existe pas avant) : ce
 * composant n'est monté que pour les postes réellement consultés, pas pour les
 * centaines de repères affichés.
 *
 * LA JOURNÉE ET LE CRÉNEAU VIENNENT DU SERVEUR, comme à l'écriture. Un poste
 * dont l'horloge dérive lirait sinon la relève de la veille.
 *
 * Muet en cas d'échec : hors périmètre ou sans session, la popup doit rester
 * lisible. Un bandeau d'erreur à cet endroit gênerait plus qu'il n'informerait.
 */
const ORDRE_GRADES = ['MDLG', 'MDLC', 'ADJT', 'A/C'];

function EffectifDuPoste({ barrageId, bt, onModifier, enTete = false }) {
  const [donnees, setDonnees] = useState(null);
  const [muet, setMuet] = useState(false);

  useEffect(() => {
    let vivant = true;
    setDonnees(null);
    setMuet(false);
    API.effectifDuPoste(barrageId)
      .then((d) => vivant && setDonnees(d))
      .catch(() => vivant && setMuet(true));
    return () => {
      vivant = false;
    };
  }, [barrageId]);

  if (muet) return null;
  if (!donnees) return <p className="gr-popup-eff-etat">Chargement de l’effectif…</p>;

  const presents = donnees.items
    .filter((e) => e.creneau === donnees.creneau)
    .sort(
      (a, b) =>
        ORDRE_GRADES.indexOf(b.grade) - ORDRE_GRADES.indexOf(a.grade) ||
        a.nom.localeCompare(b.nom, 'fr'),
    );

  const fin = (donnees.creneau + 6) % 24;
  const deux = (n) => String(n).padStart(2, '0');
  const complet = donnees.attendus > 0 && presents.length >= donnees.attendus;

  return (
    <div className={`gr-popup-eff${enTete ? ' gr-popup-eff-haut' : ''}`}>
      <p className="gr-popup-eff-titre">
        <span>
          Éléments · {deux(donnees.creneau)}:00 → {deux(fin)}:00
        </span>
        <span className={`gr-popup-eff-compte ${complet ? 'est-complet' : ''}`}>
          {presents.length}/{donnees.attendus || '?'}
        </span>
      </p>

      {/* La brigade qui tient le poste : c'est elle qu'on appelle, et elle ne
          figurait nulle part dans la fiche — seule la compagnie y était. */}
      {bt && <p className="gr-popup-eff-bt">Brigade {bt}</p>}

      {presents.length === 0 ? (
        <p className="gr-popup-eff-etat">Personne sur ce poste pour ce créneau.</p>
      ) : (
        <ul className="gr-popup-eff-liste">
          {presents.map((e) => (
            <li key={e.id}>
              <b>{e.grade}</b>
              <span>{e.nom}</span>
              <em>{e.matricule || '—'}</em>
            </li>
          ))}
        </ul>
      )}

      {/**
       * LIRE ET CORRIGER SONT DEUX GESTES.
       *
       * La bulle répond à « qui est là ? » et s'arrête là : on la consulte
       * cent fois pour une correction. Le bouton ouvre SAISIE TERRAIN sur la
       * bonne brigade — il n'y a donc rien à retrouver — mais il faut le
       * demander. Rien ne s'ouvre tout seul.
       */}
      {/* Le décompte en clair : « 6/6 » se lit d'un œil, « 6 éléments » se
          recopie dans un compte rendu. Les deux servent, à deux moments. */}
      {presents.length > 0 && (
        <p className="gr-popup-eff-total">
          {presents.length} élément{presents.length > 1 ? 's' : ''} présent
          {presents.length > 1 ? 's' : ''}
          {donnees.attendus
            ? ` sur ${donnees.attendus} attendu${donnees.attendus > 1 ? 's' : ''}`
            : ''}
        </p>
      )}

      {onModifier && (
        <button type="button" onClick={onModifier} className="gr-popup-eff-modifier">
          Modifier l’effectif
        </button>
      )}
    </div>
  );
}

/**
 * FOND DE CARTE INJOIGNABLE — le dire SUR la carte.
 *
 * Le voyant existait déjà, mais dans le panneau « Couches » : il fallait aller
 * l'ouvrir pour apprendre pourquoi l'écran est gris. Devant une carte vide, la
 * première question est « est-ce cassé ? », et personne ne va la poser à un
 * panneau replié. On y répond donc là où la question se pose, en nommant la
 * machine à joindre — c'est ce qui distingue une panne réseau d'un bug.
 *
 * Refermable : sur un poste durablement coupé du serveur de tuiles, on
 * travaille très bien sur les repères seuls, et un bandeau qui ne se ferme
 * jamais finit par se faire ignorer — y compris quand il dit autre chose.
 */

/**
 * OUVRIR LA BULLE DU REPÈRE QUE L'ON VIENT DE DÉSIGNER.
 *
 * Cadrer sur un poste répond à « où est-il ? ». La question suivante est
 * toujours « qui le tient ? », et elle se pose dans la seconde. Ouvrir la
 * bulle épargne un clic qu'on ferait de toute façon.
 *
 * Enveloppe plutôt qu'une refonte du marqueur : le repère est construit dans
 * une boucle, où l'on ne peut pas tenir de `useRef` par élément. Ce composant
 * en tient un pour lui, et laisse le marqueur exactement tel qu'il est.
 *
 * L'effet dépend de l'HORODATAGE, pas d'un booléen : redésigner le même poste
 * après avoir fermé la bulle doit la rouvrir.
 */
function OuvreSiVise({ marque, children }) {
  const ref = useRef(null);

  useEffect(() => {
    if (marque) ref.current?.openPopup();
  }, [marque]);

  return cloneElement(children, { ref });
}

/**
 * UNE ICÔNE `divIcon` STABLE — la même instance tant que ses options sont les mêmes.
 *
 * Recréer l'icône à chaque rendu faisait appeler `setIcon` à react-leaflet, et
 * Leaflet réécrit alors le contenu HTML du repère. Si ce rendu tombe entre
 * l'appui et le relâchement du bouton (un survol, une relecture, un minuteur
 * suffisent), l'élément pressé n'existe plus et le navigateur n'émet aucun
 * `click` : le repère se voit, se survole… et n'ouvre rien. Les épingles de
 * barrage ordinaires (`pinIcon`) avaient déjà leur cache ; les repères de
 * l'optimisation (cadenas, conflit, décision, contexte, aperçu) ne l'avaient pas.
 */
const CACHE_DIVICON = new Map();
function divIconStable(options) {
  const cle = JSON.stringify(options);
  let icone = CACHE_DIVICON.get(cle);
  if (!icone) {
    if (CACHE_DIVICON.size > 4000) CACHE_DIVICON.clear();
    icone = L.divIcon(options);
    CACHE_DIVICON.set(cle, icone);
  }
  return icone;
}

/** Distance entre deux points, en mètres — pour dire de combien on a bougé. */
function ecartMetres(aLat, aLng, bLat, bLng) {
  const R = Math.PI / 180;
  const dLat = (bLat - aLat) * R;
  const dLng = (bLng - aLng) * R;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * R) * Math.cos(bLat * R) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * DÉPLACER UN BARRAGE : consigne, puis aperçu, AVANT d'écrire.
 *
 * Une coordonnée de barrage n'est pas un réglage d'affichage : elle décide où
 * des hommes seront postés, et elle entre dans les calculs de distance de
 * l'optimisation. Elle ne change donc pas sur un clic : le clic PROPOSE.
 *
 *   1. « Cliquez sur la carte pour choisir la nouvelle position » ;
 *   2. le point cliqué est recalé sur la route réelle la plus proche, et le
 *      repère y est dessiné tout de suite ;
 *   3. l'aperçu dit d'où à où, sur quelle route, dans quelle brigade, et à
 *      quelle distance PAR LA ROUTE de sa position actuelle ;
 *   4. « Enregistrer la nouvelle position » envoie PATCH /api/marquages/:id.
 *
 * RIEN N'EST ENVOYÉ AU SERVEUR AVANT « ENREGISTRER ». Annuler ne défait pas un
 * enregistrement : il n'y en a pas eu.
 *
 * Carte NON BLOQUANTE, dans le coin bas-droit (centrée en bas sur téléphone) :
 * elle ne recouvre pas l'endroit où l'on clique. Un autre clic sur la carte propose
 * une autre position, sans avoir à annuler d'abord.
 */
function ConfirmationDeplacement({ m, demande, chargementReseau, occupe, onAnnuler, onConfirmer, onChoisirSens = null }) {
  const p = demande?.point;
  const t = demande?.territoire;
  /* Deux chaussées : rien ne s'enregistre tant que le sens n'est pas choisi. */
  const sensManquant = Boolean(demande?.sens && !demande?.sensChoisi);
  const pret = Boolean(p && t && !demande.erreur && !sensManquant);

  const carteApercu = (
    <div
      className="pointer-events-auto fixed bottom-16 left-1/2 z-[1600] max-h-[calc(100dvh-6rem)] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 overflow-y-auto rounded-2xl border border-gr-gold/40 bg-gr-navy/95 shadow-panel backdrop-blur md:bottom-3 md:left-auto md:right-3 md:translate-x-0"
      role="dialog"
      aria-labelledby="gr-depl-titre"
      data-testid="deplacement-barrage"
    >
      <div className="flex items-start gap-2.5 border-b border-white/10 px-4 py-3">
        <IconCible size={18} className="mt-0.5 shrink-0 text-gr-gold" />
        <div className="min-w-0">
          <p id="gr-depl-titre" className="text-[13px] font-bold uppercase tracking-[0.1em] text-gr-gold">
            Déplacer le barrage
          </p>
          <p className="truncate text-[12px] font-semibold text-white/85">{MQ.libelle(m)}</p>
        </div>
      </div>

      <div className="space-y-2 px-4 py-3">
        {!demande?.clic && (
          <p className="text-[12px] font-semibold text-white">
            Cliquez sur la carte pour choisir la nouvelle position
          </p>
        )}
        {demande?.clic && !p && !demande.erreur && (
          <p className="flex items-center gap-2 text-[12px] text-white/70">
            <IconSpinner size={13} /> {chargementReseau ? 'Chargement du réseau routier…' : 'Recalage sur la route…'}
          </p>
        )}
        {p && (
          <table className="gr-tbl w-full text-[11px] text-white/60">
            <tbody>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">Position actuelle</td>
                <td className="py-0.5 font-mono tabular-nums text-white/70">
                  {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">Nouvelle position</td>
                <td className="py-0.5 font-mono tabular-nums text-gr-gold">
                  {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">Route</td>
                <td className="py-0.5 text-white/80">
                  {m.route || '—'} →{' '}
                  <b className="text-white">{demande.route ?? `voie ${demande.classe ?? ''} sans numéro`}</b>
                  <span className="text-white/40"> · recalé à {demande.ecartM} m du clic</span>
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">PK</td>
                <td className="py-0.5 text-white/80">
                  {Number.isFinite(m.pk) ? `PK ${m.pk}` : '—'} → recalculé par le serveur à l’enregistrement
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">Région · Cie · Brigade</td>
                <td className="py-0.5 text-white/80">
                  {t ? `${t.reg ?? '—'} · ${t.cie ?? '—'} · ${t.bt ?? '—'}` : '…'}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-2 text-white/40">Distance routière</td>
                <td className="py-0.5 text-white">
                  <b>{demande.km != null ? RT.formatKm(demande.km) : '—'}</b>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {p && demande.sens && (
          <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-2.5" role="group" aria-label="Sens de circulation">
            <p className="text-[11.5px] font-semibold text-white">Route à deux chaussées : choisissez le sens</p>
            <p className="text-[10.5px] text-white/55">
              Les deux sens sont tracés sur la carte (cliquables). Aller : la chaussée vers le nord ou l’est ; Retour : l’autre.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {[[SENS_ALLER, 'Aller', '#0284c7'], [SENS_RETOUR, 'Retour', '#ea580c']].map(([valeur, libelle, couleur]) => {
                const choisi = demande.sensChoisi === valeur;
                return (
                  <button
                    key={valeur}
                    type="button"
                    aria-pressed={choisi}
                    disabled={occupe}
                    onClick={() => onChoisirSens?.(valeur)}
                    className={`flex items-center justify-center gap-2 rounded-lg border py-1.5 text-[12px] font-bold transition-colors ${
                      choisi ? 'border-white/70 bg-white/15 text-white' : 'border-white/15 text-white/75 hover:bg-white/10'
                    }`}
                  >
                    <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: couleur }} />
                    {libelle}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {demande?.conflitNouveau ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/15 p-2.5 text-[11.5px] text-red-200">
            <p className="font-bold text-red-300 flex items-center gap-1.5">
              <IconAlert size={14} className="shrink-0" />
              <span>Conflit détecté à cette nouvelle position :</span>
            </p>
            <p className="mt-0.5">
              Trop rapproché de <b>{demande.conflitNouveau.voisinNom}</b> : {demande.conflitNouveau.distanceKm} km par la route (seuil réglementaire {demande.conflitNouveau.seuilKm} km).
            </p>
            <p className="mt-1 text-[10.5px] text-white/60">
              Choisissez un autre point, ou enregistrez : la réévaluation indiquera le poste à déplacer ensuite.
            </p>
          </div>
        ) : p && !demande?.erreur && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-2.5 text-[11.5px] text-emerald-200">
            <p className="font-bold text-emerald-300 flex items-center gap-1.5">
              <span>✓ Conflit résolu à cette position !</span>
            </p>
            <p className="mt-0.5 text-white/90">
              Aucun conflit de distance détecté (seuil 20 km respecté).
              {demande.plusProcheAutre && (
                <span className="block text-[10.5px] text-emerald-300/80 mt-0.5">
                  Poste le plus proche : {demande.plusProcheAutre.nom} à {demande.plusProcheAutre.dist} km par la route.
                </span>
              )}
            </p>
          </div>
        )}
        {demande?.erreur && (
          <p className="flex items-start gap-1.5 rounded-lg border border-gr-red/40 bg-gr-red/10 px-3 py-2 text-[11px] text-white" role="alert">
            <IconAlert size={13} className="mt-0.5 shrink-0 text-gr-red" /> {demande.erreur}
          </p>
        )}
        {p && <p className="text-[11px] text-white/45">Un autre clic sur la carte propose une autre position.</p>}
      </div>

      <div className="flex gap-2 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onAnnuler}
          disabled={occupe}
          className={`${bouton} flex-1 bg-white/10 py-2 text-white/85 hover:bg-white/16`}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onConfirmer}
          /* Un conflit à la nouvelle position n'interdit plus l'enregistrement : la
             réévaluation qui suit guide vers la position (ou le poste) suivant. */
          disabled={occupe || !pret}
          className={`${bouton} flex-[1.4] bg-gr-gold py-2 text-gr-navy hover:brightness-110 disabled:opacity-50`}
          title={demande?.conflitNouveau ? `Conflit de ${demande.conflitNouveau.distanceKm} km sous le seuil de ${demande.conflitNouveau.seuilKm} km : la réévaluation indiquera la suite.` : undefined}
        >
          {occupe ? <IconSpinner size={13} /> : null} {sensManquant ? 'Choisissez le sens' : demande?.conflitNouveau ? 'Enregistrer malgré le conflit' : 'Enregistrer la nouvelle position'}
        </button>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return carteApercu;
  return createPortal(carteApercu, document.body);
}

/**
 * LA BULLE ORDINAIRE D'UN MARQUAGE — une seule, partout.
 *
 * Sortie de MarquageLayer telle quelle pour que les repères de l'optimisation
 * (barrage en conflit, décision simulée) ouvrent EXACTEMENT la même bulle que
 * le barrage lui-même : informations opérationnelles, effectif, commandes. Ce
 * qui relève de la distance s'ajoute en tête (`conflit`), sans rien remplacer.
 */
function BulleMarquage({
  m, factions = null, piedEffectif = null, on3D = null, gerable = () => false, onModifierBarrage = null,
  onOuvrir = () => { }, onSupprimer = null, onArmerDeplacement = null, peutRetirer = () => false, conflit = null,
  onChangerFaction = null,
  onAssigner = null,
  estAdmin = false,
  assignation = null,
  onVoirConflit = null,
}) {
  /* En cas de conflit d'optimisation : afficher uniquement la fiche de conflit (avec actions et explication). */
  if (conflit) {
    return (
      <div className="gr-popup">
        <h4>{MQ.libelle(m)}</h4>
        {conflit}
      </div>
    );
  }
  const isBFI = Boolean(
    MQ.estIntouchable(m) ||
    m.isPermanent === true ||
    m.protection === 'intouchable' ||
    m.type === 'FIXED_PERMANENT' ||
    m.type === 'barrage_vip' ||
    String(m.id || '').startsWith('BFI-')
  );
  const nature = isBFI ? 'Barrage Fixe Intouchable (BFI)' : (MQ.TYPE_PAR_CLE[m.type]?.fr ?? m.type);
  const creneau = isBFI ? '24h / 24 · En continu' : MQ.plage(m);
  return (
    <div className="gr-popup">
      <h4>{MQ.libelle(m)}</h4>
      {assignation && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 8,
            padding: '8px 10px',
            margin: '6px 0 10px',
            fontSize: 11.5,
            lineHeight: 1.4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'bold', color: 'var(--tone-danger)', marginBottom: 4 }}>
            <span style={{ fontSize: 13 }}>⚠️</span>
            <span>CONFLIT ASSIGNÉ POUR TRAITEMENT</span>
          </div>
          <div style={{ opacity: 0.9 }}>
            {assignation.criteres?.voisinNom && (
              <div><b>Autre barrage :</b> {assignation.criteres.voisinNom}</div>
            )}
            {assignation.barrage?.factionId && (
              <div><b>Faction :</b> {assignation.barrage.factionId}</div>
            )}
            {assignation.barrage?.route && (
              <div><b>Route :</b> {assignation.barrage.route}</div>
            )}
            {assignation.criteres?.distanceKm != null && (
              <div><b>Distance réelle :</b> <b style={{ color: 'var(--tone-danger)' }}>{assignation.criteres.distanceKm} km</b></div>
            )}
            <div><b>Contrainte minimale :</b> <b style={{ color: 'var(--tone-ok)' }}>{assignation.criteres?.seuilKm ?? 20} km</b></div>
            {assignation.texte && (
              <div style={{ fontSize: 10.5, fontStyle: 'italic', marginTop: 3, opacity: 0.75 }}>
                « {assignation.texte} »
              </div>
            )}
          </div>
          {onVoirConflit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onVoirConflit(assignation);
              }}
              className="gr-popup-act"
              style={{
                width: '100%',
                marginTop: 6,
                background: 'rgba(239, 68, 68, 0.25)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: 'var(--tone-danger)',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              👁 Voir le conflit et la route sur la carte
            </button>
          )}
        </div>
      )}
      {/**
          * LE BANDEAU « FIXE INTOUCHABLE » — une ligne, pas un panneau.
          *
          * Il dit les trois choses qu'il faut savoir avant d'agir :
          * le poste est permanent, les factions s'y relaient, il
          * échappe au retrait automatique. Il n'apparaît que dans
      {m.isSynthetic && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(245, 158, 11, 0.12)',
          border: '1px solid rgba(245, 158, 11, 0.35)',
          borderRadius: 6,
          padding: '4px 8px',
          margin: '4px 0 8px',
          fontSize: 10,
          color: 'var(--tone-warn)',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>🔬</span>
            <b style={{ fontWeight: 600 }}>Simulation UX/UI</b>
          </span>
          <span style={{
            background: 'rgba(245, 158, 11, 0.25)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            borderRadius: 4,
            padding: '1px 5px',
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: '0.04em',
          }}>
            DONNÉES SYNTHÉTIQUES
          </span>
        </div>
      )}
      {isBFI && (
        <div className="gr-popup-intouchable">
          <div className="flex items-center gap-1.5">
            <IconBarrageIntouchable size={15} className="text-gr-gold shrink-0" />
            <b className="block text-[11.5px] font-bold tracking-wide text-gr-gold">
              BARRAGE FIXE INTOUCHABLE (BFI)
            </b>
            <span className="ml-auto rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-300 border border-emerald-500/40">
              PERMANENT · 24H/24
            </span>
          </div>
          <span className="mt-0.5 block text-[10.5px] font-medium text-emerald-400">
            Position permanente — intouchable
          </span>
        </div>
      )}
      {!isBFI && (m.type === 'FIXED' || m.type === 'barrage_fixe') && (
        <div className="mb-2 px-2 py-1 rounded bg-cyan-950/40 border border-cyan-500/30 flex items-center justify-between">
          <span className="text-[11px] font-bold text-cyan-400">BARRAGE FIXE</span>
          <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-cyan-300 border border-cyan-500/40">
            FIXE
          </span>
        </div>
      )}
      {/**
         * QUI TIENT LE POSTE, EN TÊTE.
         */}
      {piedEffectif?.(m, true)}
      <table className="gr-tbl">
        <tbody>
          <tr>
            <td>Type</td>
            <td>
              <span className={`font-semibold ${isBFI ? 'text-gr-gold font-bold' : 'text-white/90'}`}>
                {isBFI
                  ? 'Barrage Fixe Intouchable (BFI)'
                  : (m.type === 'barrage_mobile' ? 'Barrage mobile' : 'Barrage fixe')}
              </span>
            </td>
          </tr>
          {(m.roadName || m.route) && (
            <tr>
              <td>Route concernée</td>
              <td>
                <span className="font-mono font-bold text-white/95">{m.roadName || m.route}</span>
                {(m.route_position != null || m.pk != null) && (
                  <span className="ml-1.5 font-mono text-[10px] text-white/50">
                    (PK {m.route_position ?? m.pk})
                  </span>
                )}
              </td>
            </tr>
          )}
          {MQ.estBarrage(m) && (
            <tr>
              <td>Sens de circulation</td>
              <td>
                {(() => {
                  const b = badgeDirection(m.direction || obtenirDirectionBarrage(m));
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-[10.5px] font-bold ${b.classeCouleur}`}>
                      <span>{b.nom}</span>
                      <span className="font-mono">{b.symbole}</span>
                    </span>
                  );
                })()}
              </td>
            </tr>
          )}
          <tr>
            <td>Coordonnées</td>
            <td>
              <span className="font-mono text-[10.5px] text-white/80">
                {Number(m.latitude ?? m.lat).toFixed(5)}° N, {Number(m.longitude ?? m.lng).toFixed(5)}° W
              </span>
            </td>
          </tr>
          <tr>
            <td>Créneau</td>
            <td>
              {isBFI ? (
                <span className="font-mono text-emerald-300 font-bold text-[11px]">
                  24h / 24 · En continu
                </span>
              ) : (
                <span className="font-mono text-white/90 text-[11px]">{creneau || '—'}</span>
              )}
            </td>
          </tr>
          <tr>
            <td>Compagnie</td>
            <td>{m.cie ?? '—'}</td>
          </tr>
          <tr>
            <td>Brigade</td>
            <td>{m.bt ?? '—'}</td>
          </tr>
          <tr>
            <td>Faction</td>
            <td>
              {isBFI ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10.5px] font-extrabold text-emerald-300">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span>Permanent (24h/24)</span>
                </span>
              ) : (
                (() => {
                  const assignees = factions?.assignations?.[m.id] ?? [];
                  if (assignees.length > 0) {
                    return assignees
                      .map((id) => {
                        const f = factions.factions?.find((x) => x.id === id);
                        return f ? f.nom : id;
                      })
                      .join(' · ');
                  }
                  if (m.factionNom || m.factionId) {
                    return `Faction ${m.factionNom || m.factionId}`;
                  }
                  return 'Aucune affectation ce jour';
                })()
              )}
            </td>
          </tr>
          {m.note && (
            <tr>
              <td>Observation</td>
              <td>{sansHorairesFaction(m.note)}</td>
            </tr>
          )}
        </tbody>
      </table>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          on3D && on3D(m);
        }}
        className="gr-popup-3d"
      >
        <IconSatellite size={13} /> Vue aérienne rapprochée
      </button>
      {/* Modifier / Supprimer — voir CommandesPopup. */}
      {gerable(m) && (
        <CommandesPopup
          m={m}
          onModifier={(id) =>
            onModifierBarrage && MQ.estBarrage(m) ? onModifierBarrage(m) : onOuvrir(id)
          }
          onSupprimer={onSupprimer}
          onArmerDeplacement={onArmerDeplacement}
          peutRetirer={peutRetirer(m)}
          onChangerFaction={onChangerFaction}
          estAdmin={estAdmin}
          onAssigner={onAssigner}
        />
      )}
    </div>
  );
}

function MarquageLayer({
  items,
  editable,
  /* Par défaut aucune commande : une couche montée sans autorité explicite
     reste en consultation, elle n'ouvre pas la suppression par omission. */
  gerable = () => false,
  importants,
  onOuvrir,
  /** « Modifier » d'un BARRAGE ouvre le formulaire dédié (ModifierBarrage). */
  onModifierBarrage = null,
  onSupprimer,
  on3D,
  /**
   * Repères REMPLACÉS par le marqueur « ? » de l'optimisation.
   *
   * Superposer les deux ne marchait pas : le « ? » se posait par-dessus le
   * pictogramme du barrage, et l'on voyait deux symboles empilés pour un seul
   * poste — sans savoir lequel cliquer. Un barrage signalé n'est pas un
   * barrage ordinaire avec une pastille en plus : tant que la question n'est
   * pas tranchée, il EST la question. Son repère cède donc la place.
   */
  masques = null,
  /**
   * LES FACTIONS — définition et affectations, telles que le serveur les rend.
   *
   * Passées à la couche pour que la BULLE puisse dire à quel tour de service le
   * poste est tenu. Rien n'est calculé ici : `assignations[id]` est la liste
   * que le serveur a établie sur les relèves du jour.
   */
  factions = null,
  /** Facteur de taille des pins, déduit du zoom — voir `echelleZoom`. */
  echelle = 1,
  /* Le poste désigné depuis un autre écran : sa bulle s'ouvre seule. */
  vise = null,
  /* L'effectif du créneau, fabriqué par la carte — le même pied que les
     bulles de décision et d'exclusion. Absent sans session : /api/elements
     refuserait, et l'on n'appelle pas pour recevoir un 401. */
  piedEffectif = null,
  /** « Déplacer » dans la bulle : passe la carte en mode déplacement (clic). */
  onArmerDeplacement = null,
  /** « Traiter → Changer la faction » : ouvre la boîte de confirmation. */
  onChangerFaction = null,
  /** Super Admin : « Assigner au CMND Région ». */
  onAssigner = null,
  estAdmin = false,
  /**
   * CE REPÈRE PEUT-IL ÊTRE RETIRÉ ? — un prédicat, pas la session.
   *
   * Même forme que `gerable` : la couche n'a pas à connaître qui est connecté,
   * seulement le droit sur l'élément qu'elle dessine. Le calcul vit là où la
   * session vit, et le serveur applique la même règle de son côté.
   */
  peutRetirer = () => false,
  optimisationResultats = null,
  tousItems = null,
  assignationsMap = null,
  onVoirConflit = null,
  factionActive = null,
  barrageAppartientAFaction = null,
}) {
  const tousItemsMap = useMemo(() => new Map((tousItems || items || []).map((x) => [x.id, x])), [tousItems, items]);
  const selectionActive = Boolean(factionActive && factionActive !== 'toutes');

  return (
    <LayerGroup>
      {items.map((m) => {
        if (masques?.has(m.id)) return null;
        const app = MQ.apparence(m);
        const modifiable = editable(m);
        const important = m.type === 'accident' && importants?.get(m.id)?.important;
        const estBarrage = MQ.estBarrage(m);
        const appartient = barrageAppartientAFaction ? barrageAppartientAFaction(m, factionActive) : true;
        const estAttenue = estBarrage && selectionActive && !appartient;
        const estMisEnEvidence = estBarrage && selectionActive && appartient;

        return (
          <LayerGroup key={m.id}>
            {/* Halo : point noir important, même teinte que son marqueur —
              aucune nouvelle couleur, la discipline de palette reste intacte. */}
            {important && (
              <Circle
                center={[m.lat, m.lng]}
                radius={900}
                interactive={false}
                pathOptions={{
                  color: app.color,
                  weight: 0,
                  fillColor: app.color,
                  fillOpacity: estAttenue ? 0.08 : 0.22,
                }}
              />
            )}
            {/* La bulle s’ouvre seule quand ce poste vient d’être désigné. */}
            <OuvreSiVise marque={vise?.id === m.id ? vise.ts : null}>
              <Marker
                position={[m.latAffichee ?? m.lat, m.lngAffichee ?? m.lng]}
                opacity={estAttenue ? 0.38 : 1}
                zIndexOffset={estAttenue ? -100 : (estMisEnEvidence ? 300 : 0)}
                icon={pinIcon({
                  glyph: app.glyph,
                  color: app.color,
                  scale: app.scale * echelle,
                  intouchable: app.intouchable || MQ.estIntouchable(m),
                  attenue: estAttenue,
                  misEnEvidence: estMisEnEvidence,
                  direction: estBarrage ? (m.direction || obtenirDirectionBarrage(m)) : null,
                })}
                title={`${MQ.libelle(m)}${estBarrage ? ` [${libelleDirection(m.direction || obtenirDirectionBarrage(m))}]` : ''}`}
                /**
                 * Jamais par défaut : il faut l'avoir demandé pour CE repère.
                 *
                 * On s'appuie sur `gerable` (l'autorité) et non sur
                 * `editable` (l'autorité ET le panneau ouvert) : le bouton
                 * « Déplacer » vit dans la bulle, donc hors du panneau. Le
                 * lier au panneau armerait un repère incapable de bouger.
                 *
                 * UN BARRAGE INTOUCHABLE N'EST JAMAIS SAISISSABLE. Sa position
                 * est l'ancrage permanent de sa compagnie, et elle est
                 * définitive. Le serveur refuse de toute
                 * façon tout déplacement (voir PATCH /api/marquages/:id) :
                 * cette garde évite seulement de proposer un geste dont on
                 * sait qu'il sera rejeté, et le repère qui revient en place
                 * tout seul se lit comme un défaut de l'application.
                 */
                riseOnHover
                eventHandlers={{
                  click: () => modifiable && onOuvrir(m.id),
                  dblclick: () => on3D && on3D(m),
                }}
              >
                <Tooltip direction="top" opacity={estAttenue ? 0.7 : 0.95}>
                  <span>{MQ.libelle(m)}</span>
                  {estBarrage && (
                    <span style={{ marginLeft: 6, fontWeight: 700, opacity: 0.9 }}>
                      ({(m.direction || obtenirDirectionBarrage(m)) === 'ALLER' ? 'Aller ➔' : '⬅ Retour'})
                    </span>
                  )}
                </Tooltip>
                {/* La hauteur est fixée à l'ouverture, d'après la place
                    disponible — voir `placer`. */}
                <Popup>
                  {(() => {
                    const cConflit = optimisationResultats?.conflits?.get(m.id);
                    const voisinConflit = cConflit?.voisinId ? tousItemsMap.get(cConflit.voisinId) ?? null : null;
                    const simulationConflit = cConflit ? simulationDe(optimisationResultats, m.id, MQ.estIntouchable(m), cConflit, m, {
                      estAdmin,
                      onAssigner,
                    }) : null;
                    return (
                      <BulleMarquage
                        m={m}
                        factions={factions}
                        piedEffectif={piedEffectif}
                        on3D={on3D}
                        gerable={gerable}
                        onModifierBarrage={onModifierBarrage}
                        onOuvrir={onOuvrir}
                        onSupprimer={onSupprimer}
                        onArmerDeplacement={onArmerDeplacement}
                        peutRetirer={peutRetirer}
                        onChangerFaction={onChangerFaction}
                        onAssigner={onAssigner}
                        estAdmin={estAdmin}
                        conflit={cConflit ? <SectionConflit c={{ ...cConflit, lat: m.lat, lng: m.lng }} voisin={voisinConflit} simulation={simulationConflit} /> : null}
                        assignation={assignationsMap?.get(m.id) ?? null}
                        onVoirConflit={onVoirConflit}
                      />
                    );
                  })()}
                </Popup>
              </Marker>
            </OuvreSiVise>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}


/**
 * Empêche de zoomer en arrière au-delà de SA ZONE — le territoire national
 * pour un administrateur, sa circonscription pour tout autre compte.
 *
 * Borner le déplacement (`maxBounds`) ne suffit pas : en zoom arrière, le
 * cadre national finit par être plus petit que l'écran, et tout ce qui
 * l'entoure — Espagne, Algérie, Atlantique, et jusqu'au reste du continent —
 * réapparaît dans les marges. La limite doit donc porter aussi sur le zoom.
 *
 * Le plancher n'est pas une constante : il dépend de la taille de la fenêtre.
 * `getBoundsZoom` donne exactement le niveau auquel le territoire remplit
 * l'écran ; on le recalcule à chaque redimensionnement, sans quoi une fenêtre
 * élargie laisserait de nouveau apparaître les voisins sur les côtés.
 */
/**
 * LA ZONE EST CELLE DU COMPTE — un seul verrou, pas deux.
 *
 * `bornes` vaut le cadre national pour un administrateur, et le contour du
 * périmètre pour un chef de région, de compagnie ou de brigade. Le même
 * dispositif qui empêchait d'atteindre l'Espagne empêche donc un chef de
 * brigade de partir explorer la compagnie voisine : `setMaxBounds` pour le
 * déplacement, le plancher de zoom pour le recul.
 *
 * POURQUOI ÉTENDRE CELUI-CI PLUTÔT QU'EN AJOUTER UN. Deux verrous concurrents
 * sur la même carte finissent toujours par se contredire — l'un rend la main
 * quand l'autre la retient, et la carte sautille. Il n'y a donc qu'un endroit
 * qui borne la vue, et c'est ici.
 *
 * Le cloisonnement des DONNÉES ne dépend pas de ce verrou : il est tenu par le
 * serveur et par `dansSonPerimetre`. Borner la carte ne protège rien — cela
 * évite de se perdre hors de sa zone de responsabilité, ce qui est un confort,
 * pas une sécurité.
 */
function LimiterAuTerritoire({ bornes = BORNES_MAROC }) {
  const map = useMap();

  useEffect(() => {
    const appliquer = () => {
      /*
       * Second argument `false` : on cherche le zoom auquel le TERRITOIRE tient
       * tout entier dans la vue — la vue nationale, celle sur laquelle la carte
       * s'ouvre.
       *
       * Avec `true`, Leaflet renvoie l'inverse : le zoom auquel la VUE tient
       * tout entière dans le cadre, sans jamais en déborder. C'est plus strict,
       * et c'était trop : le pays n'étant pas rectangulaire, on ne pouvait plus
       * le voir en entier — la carte refusait de reculer au-delà d'une portion
       * du Nord. Or voir le territoire d'un seul tenant est la vue de travail
       * principale.
       *
       * Ce qui déborde du cadre à ce niveau de zoom n'est pas un problème : le
       * masque hors territoire est opaque, tout ce qui n'est pas le Maroc reste
       * noir. Le plancher sert à empêcher de reculer PLUS LOIN, pas à rogner la
       * vue nationale.
       */
      map.setMaxBounds(bornes);
      const plancher = map.getBoundsZoom(bornes, false);
      map.setMinZoom(plancher);
      if (map.getZoom() < plancher) map.setZoom(plancher);
      /* Ramener la vue dans la zone si elle était restée dehors — le cas se
         produit au moment précis où la session se charge, la carte étant déjà
         ouverte sur le pays entier. */
      if (!map.getBounds().intersects(bornes)) map.fitBounds(bornes, { animate: false });
    };

    appliquer();
    map.on('resize', appliquer);
    return () => map.off('resize', appliquer);
  }, [map, bornes]);

  return null;
}

/**
 * Synchronise le mode dès le début de l'animation, puis confirme le zoom final.
 *
 * L'ÉTAT DOIT SUIVRE LA CARTE, QUI QUE CE SOIT QUI L'AIT BOUGÉE.
 *
 * Les gestionnaires ci-dessous ne voient que ce qui se passe APRÈS leur pose.
 * Or la carte est déplacée par programme au montage — cadrage sur le périmètre
 * du compte, plancher de zoom de `LimiterAuTerritoire`, qui est monté AVANT ce
 * composant et dont l'effet s'exécute donc en premier. Un chef de brigade se
 * retrouvait ainsi cadré au bon endroit, au bon zoom, avec un état d'échelon
 * resté à la vue nationale : la carte montrait sa brigade et dessinait les
 * limites RÉGIONALES par-dessus, et le compteur affichait « 6 » au milieu
 * d'une échelle à 3 km.
 *
 * Deux réponses, et il faut les deux : un relevé initial (comme `SuiviCadre`),
 * et `viewreset` / `moveend`, que Leaflet émet sur un recadrage sans animation
 * là où `zoomend` peut manquer.
 */
function SuiviZoom({ onZoom, onNiveau }) {
  const synchroniser = useCallback(
    (carte) => {
      const zoom = carte.getZoom();
      onNiveau(zoom);
      onZoom(zoom);
    },
    [onNiveau, onZoom],
  );

  const map = useMapEvents({
    /* Leaflet annonce ici le zoom cible AVANT son animation CSS. Le rendu du
       niveau suivant est validé dans le même tour, sans attendre zoomend. */
    zoomanim: (e) => flushSync(() => onNiveau(e.zoom)),
    zoom: () => onNiveau(map.getZoom()),
    zoomend: () => synchroniser(map),
    viewreset: () => synchroniser(map),
    moveend: () => synchroniser(map),
  });

  /* Relevé initial : sans lui, tout déplacement antérieur à la pose des
     gestionnaires reste ignoré pour toujours. */
  useEffect(() => {
    synchroniser(map);
  }, [map, synchroniser]);

  return null;
}

/**
 * Tient le CADRE VISIBLE à jour — pour les statistiques de la carte.
 *
 * Un tableau `[ouest, sud, est, nord]` plutôt que l'objet `LatLngBounds` de
 * Leaflet : il se compare et se mémorise sans surprise, là où l'objet change
 * d'identité à chaque déplacement même quand les bornes sont les mêmes.
 */
function SuiviCadre({ onCadre }) {
  const map = useMapEvents({
    moveend: () => onCadre(bornes(map)),
    zoomend: () => onCadre(bornes(map)),
  });

  /* Premier relevé : sans lui, aucune statistique avant le premier geste. */
  useEffect(() => {
    onCadre(bornes(map));
  }, [map, onCadre]);

  return null;
}

const bornes = (map) => {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
};

/**
 * LÉGENDE DE LA CARTE — le vocabulaire visuel, expliqué une fois.
 *
 * La carte porte aujourd'hui trois familles de signes, et rien à l'écran ne les
 * traduisait : il fallait avoir participé à leur construction pour les lire.
 *
 *   les NATURES        couleur du pin : ce que le poste EST ;
 *   les REPÈRES        ce qu'il faut en FAIRE — un seul par poste, il remplace
 *                      l'icône (voir `masques`) ;
 *   les BADGES         ce qu'il PORTE — plusieurs à la fois, posés au-dessus.
 *
 * Les échantillons ne sont pas redessinés : ils réutilisent les MÊMES classes
 * CSS que les marqueurs de la carte (`gr-interro`, `gr-exclu`, `gr-decision`…).
 * Une légende qui approxime ce qu'elle explique finit par mentir le jour où
 * l'un des deux change ; ici, les deux changent ensemble.
 *


/**
 * Résultat de l'optimisation, montré DIRECTEMENT sur la carte.
 *
 * Rouge plein : barrage que le calcul propose de retirer. Vert discret :
 * barrage conservé. Sans ce rendu, le panneau demandait de valider le retrait
 * de dizaines de points sans jamais montrer lesquels — on approuvait un
 * nombre, pas une décision.
 *
 * Les anneaux sont `interactive={false}` : ils ne doivent pas voler le clic
 * qui ouvre la fiche du barrage qu'ils entourent.
 */
/**
 * Contenu de la bulle d'un barrage signalé — le seul endroit d'où part une
 * décision.
 *
 * « Supprimer » demande confirmation en deux temps, comme la corbeille d'une
 * fiche ordinaire (voir `CommandesPopup`) : c'est un effacement réel, sur une
 * carte où le clic part vite. « Conserver » n'en demande pas — il ne modifie
 * rien qu'on ne puisse reprendre d'un clic.
 *
 * LA BULLE RESTE OUVERTE PENDANT LE TRAVAIL, et le bouton tourne.
 *
 * Elle se fermait aussitôt le clic donné. Or un retrait n'est pas instantané :
 * il faut l'écriture, puis le recalcul du voisinage sur le dispositif restant —
 * plusieurs secondes. Pendant tout ce temps l'écran ne bougeait pas, et le
 * geste passait pour n'avoir servi à rien. On voyait donc un outil cassé là où
 * il n'y avait qu'une attente muette.
 */

/**
 * UN BARRAGE CONSERVÉ REDEVIENT UN BARRAGE ORDINAIRE.
 *
 * Il a d'abord porté un « ✓ » vert, pour qu'on voie que la question avait été
 * tranchée. C'était une erreur de lecture : sur la carte, un repère particulier
 * veut dire « occupe-toi de moi ». Or décider de garder un poste, c'est
 * précisément dire qu'il n'y a plus rien à en faire — il doit donc reprendre
 * l'apparence de tous les autres, immédiatement.
 *
 * La trace de la décision n'est pas perdue pour autant : elle est écrite dans
 * le dépôt, et le panneau la liste sous « Conservés », avec de quoi revenir
 * dessus. La carte, elle, ne montre plus que ce qui attend encore un arbitrage.
 */
/**
 * NOUVEAUX BARRAGES — ceux dont le commandement n'a pas encore accusé réception.
 *
 * Ils viennent des NOTIFICATIONS, pas du dépôt : un barrage est « nouveau »
 * tant que sa notification est ouverte, pas pendant un nombre d'heures arbitraire.
 * C'est le geste du commandant qui éteint le repère, ce qui en fait une file
 * de travail plutôt qu'un effet d'affichage.
 *
 * Le repère bat, comme le « ? » : dans les deux cas quelqu'un doit regarder.
 */
/**
 * « VU — RETIRER LE REPÈRE » : retenu pour CE compte dans CE navigateur.
 *
 * Rien n'est effacé ni modifié côté serveur — ni le journal, ni la demande en
 * attente, ni la position. Un stockage indisponible (navigation privée) ne
 * fait que rendre le repère au prochain chargement.
 */
const CLE_REPERES_VUS = (matricule) => `gr-reperes-vus:${matricule}`;
function reperesVus(matricule) {
  try {
    return new Set(JSON.parse(localStorage.getItem(CLE_REPERES_VUS(matricule)) || '[]'));
  } catch {
    return new Set();
  }
}

/**
 * BADGES DE CARACTÉRISTIQUES — accidents, VIP, éclairage, entrée/sortie.
 *
 * Ils s'AJOUTENT au repère du barrage, ils ne le remplacent pas. C'est la
 * différence entre les deux familles de signes de cette carte :
 *
 *   « ? » « ✗ » « ✓ »  disent CE QU'IL FAUT DÉCIDER — un par poste, ils se
 *                       succèdent, et ils prennent la place de l'icône.
 *   A · VIP · 💡 · ⇥   disent CE QUE LE POSTE EST — plusieurs à la fois, ils
 *                       s'alignent au-dessus sans rien masquer.
 *
 * Un poste peut donc porter « ? » et « A VIP ENTRÉE » en même temps : la
 * distance reste jugée seule, les badges ne font que renseigner celui qui
 * tranche (voir la route consolidation, où les trois paramètres n'entrent
 * jamais dans le calcul).
 *
 * La rangée est posée AU-DESSUS du point : ancrée dessus, elle recouvrirait
 * l'icône qu'elle est censée compléter.
 *
 * `zoom` décide si elle est posée du tout — voir `badgesVisibles` dans
 * carteLisibilite.js.
 */
function BadgesLayer({ items, badges, zoom, factionActive = null, barrageAppartientAFaction = null }) {
  const concernes = useMemo(() => {
    if (!badges?.size) return [];
    return items.filter((m) => badges.has(m.id));
  }, [items, badges]);

  const selectionActive = Boolean(factionActive && factionActive !== 'toutes');

  /* Trop loin pour lire : on ne dessine rien plutôt que d'empiler du texte.
     Le filtre est fait APRÈS le `useMemo` pour ne pas recalculer la liste à
     chaque cran de zoom — seule la décision de la rendre change. */
  if (!badgesVisibles(zoom)) return null;

  if (!concernes.length) return null;

  return (
    <LayerGroup>
      {concernes.map((m) => {
        const b = badges.get(m.id);
        const jetons = [];
        const estBarrage = MQ.estBarrage(m);
        const appartient = barrageAppartientAFaction ? barrageAppartientAFaction(m, factionActive) : true;
        const estAttenue = estBarrage && selectionActive && !appartient;

        if (b.accident) {
          jetons.push(
            `<span class="gr-badge gr-badge-accident" title="Accidents au-dessus de l’ordinaire">A${b.accidents != null ? `<i>${b.accidents}</i>` : ''
            }</span>`,
          );
        }
        if (b.vip) jetons.push('<span class="gr-badge gr-badge-vip">VIP</span>');
        if (b.nonEclaire) jetons.push('<span class="gr-badge gr-badge-nuit">💡</span>');
        /* Une porte tient les deux : un seul badge le dit, plutôt que deux
           qui se contrediraient à l'œil. */
        if (b.positionVille === 'porte') {
          jetons.push('<span class="gr-badge gr-badge-ville">⇤ PORTE ⇥</span>');
        } else if (b.positionVille === 'entree') {
          jetons.push('<span class="gr-badge gr-badge-ville">⇥ ENTRÉE</span>');
        } else if (b.positionVille === 'sortie') {
          jetons.push('<span class="gr-badge gr-badge-ville">SORTIE ⇥</span>');
        }
        if (!jetons.length) return null;

        return (
          <Marker
            key={`bdg-${m.id}`}
            position={[m.lat, m.lng]}
            /* Sous les repères de décision : un badge ne doit jamais passer
               devant le geste qu'on attend de l'utilisateur. */
            zIndexOffset={estAttenue ? 100 : 700}
            opacity={estAttenue ? 0.38 : 1}
            interactive={false}
            icon={divIconStable({
              className: '',
              html: `<div class="gr-badges" style="${estAttenue ? 'opacity:0.38;' : ''}">${jetons.join('')}</div>`,
              iconSize: [1, 1],
              iconAnchor: [0, 0],
            })}
          />
        );
      })}
    </LayerGroup>
  );
}

/**
 * REPÈRES DE DÉCISION — « ✗ » retrait proposé, « ✓ » poste maintenu.
 *
 * POURQUOI CETTE COUCHE EXISTE À PART.
 *
 * Ces repères vivaient dans `OptimisationLayer`, qui ne s'affiche que si le
 * panneau Optimisation est OUVERT et qu'un calcul vient d'être lancé. Un
 * commandant de région, lui, ne lance jamais d'optimisation : il reçoit une
 * notification. Il voyait donc l'avis « retrait proposé » sans que le moindre
 * repère apparaisse sur sa carte — le lien notification → barrage → carte était
 * rompu, non par une donnée manquante, mais par une CONDITION D'AFFICHAGE.
 *
 * La décision, elle, n'a rien de transitoire : elle est écrite sur le barrage
 * (`decisionOptimisation`, voir serveur/depot.mjs) et arrive avec lui dans
 * `items`, avec son identifiant réel et ses coordonnées réelles. C'est donc de
 * LÀ que les repères se déduisent, et de nulle part ailleurs : aucun rapport à
 * générer, aucun panneau à ouvrir, aucun marqueur inventé.
 *
 * Conséquence : un poste tranché reste marqué pour tout le monde, tant que le
 * commandant ne s'est pas prononcé.
 */
function DecisionsLayer({
  items,
  criteres,
  focusId,
  exclusIds,
  onDecider,
  /**
   * LE DOSSIER OUVERT — les mêmes pièces que la cloche des notifications.
   *
   * Sert à une seule chose : savoir si le retrait proposé sur ce poste
   * attend une réponse de CE compte, et lui proposer alors de trancher dans
   * la bulle, devant le terrain concerné.
   */
  notifications,
  onDeciderDemande,
  session,
  peutReprendre,
  piedEffectif,
}) {
  const { aSupprimer, empiles } = useMemo(() => {
    const barrages = items.filter(
      (m) =>
        MQ.estBarrage(m) && !exclusIds?.has(m.id),
    );

    /**
     * COMBIEN DE BARRAGES PARTAGENT CE POINT ?
     *
     * Le dépôt en contient plusieurs posés aux MÊMES coordonnées — des clics
     * répétés au même endroit pendant des essais. Leurs repères se superposent
     * au pixel près, et la carte devient alors trompeuse : on retire une
     * décision, un repère identique reparaît dessous, et le geste passe pour
     * n'avoir rien fait. On ne peut même pas savoir lequel on vient de cliquer.
     *
     * Ce compte ne corrige pas les données — c'est le rôle de
     * `scripts/nettoyer-positions-empilees.mjs`. Il rend seulement la
     * superposition VISIBLE, pour qu'elle cesse de passer pour une panne.
     *
     * Arrondi à la 4e décimale, soit une dizaine de mètres : deux postes plus
     * proches que cela ne se distinguent de toute façon pas à l'écran.
     */
    const cle = (m) => `${m.lat.toFixed(4)}|${m.lng.toFixed(4)}`;
    const compte = new Map();
    for (const m of barrages) compte.set(cle(m), (compte.get(cle(m)) ?? 0) + 1);

    return {
      aSupprimer: barrages.filter((m) => m.decisionOptimisation === 'a_supprimer'),
      empiles: (m) => compte.get(cle(m)) ?? 1,
    };
  }, [items, exclusIds]);

  if (!aSupprimer.length) return null;

  return (
    <LayerGroup>
      {aSupprimer.map((m) => (
        <RepereDecision
          key={`sup-${m.id}`}
          m={m}
          etat="a_supprimer"
          vise={focusId === m.id}
          mesure={criteres?.get(m.id) ?? null}
          empiles={empiles(m)}
          onDecider={peutReprendre ? onDecider : null}
          demande={retraitATrancher(notifications, m.id, session)}
          onDeciderDemande={onDeciderDemande}
          piedEffectif={piedEffectif}
        />
      ))}
      {/* Aucun repère pour les postes CONSERVÉS : ils ont repris leur icône
          de barrage ordinaire (voir `masquesBarrages`). Revenir sur la
          décision se fait depuis la liste du panneau Optimisation. */}
    </LayerGroup>
  );
}

/**
 * Un repère de décision, qui OUVRE SA BULLE quand on le vise.
 *
 * Venu d'une notification, le commandant doit voir l'information sans avoir à
 * cliquer une seconde fois — et sans qu'un panneau latéral vienne reprendre la
 * moitié de l'écran qu'on vient justement de lui rendre. La bulle de la carte
 * est le seul endroit qui montre la fiche ET le terrain d'un même regard.
 */
function RepereDecision({
  m,
  etat,
  vise,
  mesure,
  empiles = 1,
  onDecider,
  demande = null,
  onDeciderDemande,
  piedEffectif,
}) {
  const ref = useRef(null);
  const retrait = etat === 'a_supprimer';

  useEffect(() => {
    if (vise) ref.current?.openPopup();
  }, [vise]);

  return (
    <Marker
      ref={ref}
      position={[m.lat, m.lng]}
      zIndexOffset={retrait ? 950 : 940}
      icon={divIconStable({
        className: '',
        html: `<div class="gr-decision ${retrait ? 'gr-decision-retrait' : 'gr-decision-maintien'
          }${vise ? ' gr-decision-vise' : ''}" aria-hidden="true">${retrait ? '✗' : '✓'}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })}
    >
      <Tooltip direction="top" offset={[0, -13]}>
        {MQ.libelle(m)} —{' '}
        {retrait ? 'retrait proposé, en attente du commandant' : 'maintenu par décision'}
      </Tooltip>
      <Popup>
        <DecisionPopup
          m={m}
          mesure={mesure}
          etat={etat}
          empiles={empiles}
          onDecider={onDecider}
          demande={demande}
          onDeciderDemande={onDeciderDemande}
          enPied={piedEffectif?.(m)}
        />
      </Popup>
    </Marker>
  );
}

/**
 * MOTIFS D'EXCLUSION, en clair — mêmes clés que la route `consolidation`.
 * Dupliqué de OptimisationPanel.jsx à dessein : la carte n'importe rien d'un
 * panneau, elle reçoit un résultat et le rend.
 */



/**
 * @returns {{classe: string, classeBandeau: string, svg: string, mot: string}}
 *   `classe` habille le marqueur, `classeBandeau` la bulle. Les deux se
 *   DÉDUISENT du même suffixe : deux noms écrits à la main finiraient par
 *   diverger, et le bandeau reprendrait la couleur d'un autre motif.
 */


/**
 * UNE ICÔNE DE DÉCISION, DIMENSIONNÉE EN UN SEUL ENDROIT.
 *
 * `iconSize` seul ne suffisait pas : `.gr-interro` et `.gr-exclu` portaient
 * leur côté EN DUR dans la feuille de style. Réduire la boîte du marqueur
 * aurait laissé le disque à 30px, et décentré par-dessus le marché — l'ancre
 * suit la boîte, pas le dessin.
 *
 * Les trois valeurs qui doivent s'accorder partent donc d'ici : la boîte et
 * l'ancre pour Leaflet, `--gr-taille` pour le CSS, qui en déduit le glyphe.
 */
const iconeDecision = (base, echelle, classes, contenu) => {
  const cote = coteDecision(base, echelle);
  return divIconStable({
    className: '',
    html: `<div class="${classes}" style="--gr-taille:${cote}px" aria-hidden="true">${contenu}</div>`,
    iconSize: [cote, cote],
    iconAnchor: [cote / 2, cote / 2],
  });
};

/**
 * LE BARRAGE EN CONFLIT, TEL QU'IL EST — et non un « ? » anonyme.
 *
 * Le repère « ? » REMPLAÇAIT l'icône du barrage : on voyait un disque, sans
 * savoir quel poste c'était ni de quelle nature. Le poste garde désormais son
 * épingle (même glyphe que sur la carte ordinaire), en rouge parce qu'il est en
 * conflit, et la question en suspens n'est plus qu'une pastille « ? » à côté.
 */
const iconeConflitBarrage = (m, echelle) => {
  const app = MQ.apparence(m);
  const base = pinIcon({ glyph: app.glyph, color: '#DC2626', scale: (app.scale ?? 1) * echelle });
  const [w, h] = base.options.iconSize;
  return divIconStable({
    className: '',
    html:
      `<div class="gr-conflit-barrage" style="width:${w}px;height:${h}px">` +
      `<img src="${base.options.iconUrl}" width="${w}" height="${h}" alt="" />` +
      `<span class="gr-conflit-badge">?</span></div>`,
    iconSize: [w, h],
    iconAnchor: base.options.iconAnchor,
    popupAnchor: base.options.popupAnchor,
    tooltipAnchor: base.options.tooltipAnchor,
  });
};

/**
 * LES FILTRES D'AFFICHAGE DE L'OPTIMISATION — `true` = montré. Sans résultat,
 * tout est montré. Ils ne touchent QUE le rendu des calques ci-dessous.
 */
const filtreOptim = (resultats, cle) => !resultats?.filtres || resultats.filtres[cle] !== false;

/** Le voisin nommé d'un conflit manuel, lu dans les liens du résultat. */
const voisinDuConflit = (resultats, id) => {
  const l = (resultats?.liens ?? []).find((x) => x.a?.id === id || x.b?.id === id);
  if (!l) return null;
  const v = l.a.id === id ? l.b : l.a;
  return `${v.id} — ${v.nom || v.id}`;
};

/**
 * LA SIMULATION D'UNE BULLE — présente seulement quand le panneau d'optimisation
 * en porte une (`resultats.decider`). Voir `ActionsSimulation` (MapPopups).
 */
const simulationDe = (resultats, id, protege = false, c = null, m = null, options = {}) => {
  if (!resultats) return null;
  const onDecider = (type) => {
    if (typeof resultats.decider === 'function') {
      resultats.decider(id, type);
    } else if (typeof resultats.basculerAuto === 'function') {
      resultats.basculerAuto(id);
    }
  };

  const decision = resultats.decisionsSimulees?.get(id) ?? null;
  const seuilKm = c?.seuilKm ?? resultats.seuilKm ?? null;
  const estProtege = protege === true || c?.etat === 'protege' || (m && MQ.estIntouchable(m));

  let explication = resultats.explications?.get(id)
    ? { ...resultats.explications.get(id), seuilDeplacementKm: resultats.seuilDeplacementKm ?? null }
    : null;

  if (!explication && (c || m)) {
    explication = {
      nom: m ? (MQ.libelle(m) || m.nom || m.id) : (c?.id ?? id),
      distanceKm: c?.km ?? null,
      seuilKm,
      voisinNom: c?.voisinNom || c?.voisinId || null,
      seuilDeplacementKm: resultats.seuilDeplacementKm ?? null,
    };
  }

  return {
    decision,
    protege: Boolean(estProtege),
    enCours: resultats.decisionEnCours === id,
    seuilKm,
    onDecider,
    explication,
    estAdmin: Boolean(options?.estAdmin),
    onAssigner: options?.onAssigner ?? null,
    barrage: m || { id },
  };
};

/**
 * LES DÉCISIONS SIMULÉES SUR LA CARTE — conserver et supprimer.
 *
 * Le déplacement a déjà son vocabulaire (ancienne / nouvelle position, trajet
 * routier) dans ApercuOptimisationLayer. Ici, les deux autres :
 *
 *   CONSERVÉ   l'épingle réelle du poste, pastille ✓ — ⚠ si le conflit reste ;
 *   SUPPRESSION PROPOSÉE   l'épingle grisée, pastille ✕ : le poste est retiré
 *              de l'état SIMULÉ, jamais du dépôt avant l'activation.
 *
 * Les postes protégés gardent leur cadenas (OptimisationLayer) : leur seule
 * décision possible, conserver, se lit dans leur bulle.
 */
function DecisionsSimuleesLayer({ resultats, items, echelle = 1, propsBulle = {} }) {
  const decisions = resultats?.decisionsSimulees;
  if (!decisions?.size) return null;
  const parId = new Map((items ?? []).map((m) => [m.id, m]));
  const proteges = resultats.protegesIds ?? new Set();
  return (
    <LayerGroup>
      {[...decisions.values()].map((d) => {
        if (d.statut !== 'simule' || (d.type !== 'conserver' && d.type !== 'supprimer')) return null;
        if (!filtreOptim(resultats, d.type === 'supprimer' ? 'retraits' : 'conserves')) return null;
        if (proteges.has(d.barrageId)) return null;
        const m = parId.get(d.barrageId);
        if (!m) return null;
        const supprime = d.type === 'supprimer';
        const app = MQ.apparence(m);
        const base = pinIcon({ glyph: app.glyph, color: supprime ? '#64748B' : d.conflitRestant ? '#D97706' : '#059669', scale: (app.scale ?? 1) * echelle });
        const [w, h] = base.options.iconSize;
        const badge = supprime ? '✕' : d.conflitRestant ? '⚠' : '✓';
        const legende = supprime ? 'SUPPRESSION PROPOSÉE' : d.conflitRestant ? 'CONSERVÉ · CONFLIT RESTANT' : 'CONSERVÉ';
        return (
          <Marker
            key={`sim-${d.barrageId}`}
            position={[m.lat, m.lng]}
            zIndexOffset={1000}
            icon={divIconStable({
              className: '',
              html:
                `<div class="gr-decision-simulee ${supprime ? 'gr-decision-simulee-supprime' : ''}" data-gr-decision-simulee="${d.type}" style="width:${w}px;height:${h}px">` +
                `<img src="${base.options.iconUrl}" width="${w}" height="${h}" alt="" />` +
                `<span class="gr-decision-simulee-badge">${badge}</span></div>`,
              iconSize: [w, h],
              iconAnchor: base.options.iconAnchor,
              popupAnchor: base.options.popupAnchor,
              tooltipAnchor: base.options.tooltipAnchor,
            })}
          >
            <Tooltip direction="top">{`${m.nom || m.id} — ${legende.toLowerCase()} (simulation)`}</Tooltip>
            <Popup>
              {resultats.conflits?.get(m.id) ? (
                <BulleMarquage
                  m={m}
                  {...propsBulle}
                  conflit={(
                    <SectionConflit
                      c={{ ...resultats.conflits.get(m.id), lat: m.lat, lng: m.lng }}
                      voisin={parId.get(resultats.conflits.get(m.id).voisinId) ?? null}
                      simulation={simulationDe(resultats, m.id, false, resultats.conflits.get(m.id), m, {
                        estAdmin: propsBulle.estAdmin,
                        onAssigner: propsBulle.onAssigner,
                      })}
                    />
                  )}
                />
              ) : (
                <DecisionPopup
                  m={m}
                  mesure={resultats.motifs?.get(m.id)}
                  voisinNom={voisinDuConflit(resultats, m.id)}
                  estAdmin={propsBulle.estAdmin}
                  onAssigner={propsBulle.onAssigner}
                  simulation={simulationDe(resultats, m.id, false, null, m, {
                    estAdmin: propsBulle.estAdmin,
                    onAssigner: propsBulle.onAssigner,
                  })}
                />
              )}
            </Popup>
          </Marker>
        );
      })}
    </LayerGroup>
  );
}

/**
 * LES POSTES DE CONTEXTE DE L'OPTIMISATION MANUELLE — hors zone analysée.
 *
 * Montrés parce qu'un poste ANALYSÉ est en conflit avec eux, et pour cette
 * seule raison : ils ne sont ni comptés, ni à trancher. Leur épingle est
 * grisée et porte « CONTEXTE », pour qu'on ne les prenne pas pour des postes
 * de la zone.
 */
function ContexteOptimisationLayer({ contexte, items, echelle = 1, conflits = null }) {
  if (!contexte?.length || conflits?.size) return null;
  const parId = new Map((items ?? []).map((m) => [m.id, m]));
  return (
    <LayerGroup>
      {contexte.map((c) => {
        const m = parId.get(c.id);
        if (!m) {
          console.warn(`[Optimisation manuelle] poste de contexte introuvable : ${c.id}`);
          return null;
        }
        const app = MQ.apparence(m);
        const base = pinIcon({ glyph: app.glyph, color: '#64748B', scale: (app.scale ?? 1) * echelle, intouchable: c.intouchable });
        const [w, h] = base.options.iconSize;
        return (
          <Marker
            key={`ctx-${c.id}`}
            position={[m.lat, m.lng]}
            zIndexOffset={850}
            icon={divIconStable({
              className: '',
              html:
                `<div class="gr-contexte-barrage" style="width:${w}px;height:${h}px">` +
                `<img src="${base.options.iconUrl}" width="${w}" height="${h}" alt="" /></div>`,
              iconSize: [w, h],
              iconAnchor: base.options.iconAnchor,
              popupAnchor: base.options.popupAnchor,
              tooltipAnchor: base.options.tooltipAnchor,
            })}
          >
            <Tooltip direction="top">{`Contexte — ${m.nom || m.id} : voisin d'un conflit, hors zone analysée`}</Tooltip>
            <Popup>
              <div className="gr-popup">
                <h4>{m.nom || m.id}</h4>
                <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'var(--text-secondary)' }}>CONTEXTE — non analysé</p>
                <p style={{ fontSize: 11, margin: 0 }}>
                  Hors de la zone analysée ({[m.bt, m.cie, m.reg].filter(Boolean).join(' · ')}). Affiché parce que{' '}
                  {c.pour.length} poste(s) analysé(s) sont en conflit avec lui. Il n’est ni compté ni à trancher ici.
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </LayerGroup>
  );
}

/**
 * APERÇU DE LA VERSION OPTIMISÉE — ce que deviendrait le dispositif, AVANT
 * d'écrire quoi que ce soit.
 *
 * C'est la couche qui répond à « où était le poste, où ira-t-il, et pourquoi ».
 * Elle se pose PAR-DESSUS le dispositif réel, qui reste affiché tel qu'il est :
 * on compare les deux d'un coup d'œil au lieu de se souvenir de l'état
 * précédent.
 *
 * TROIS SIGNES, ET ILS NE DISENT PAS LA MÊME CHOSE :
 *
 *   un CERCLE CREUX à l'ancienne place — « il était ici » ;
 *   une FLÈCHE en pointillés — le trajet du déplacement proposé ;
 *   un REPÈRE PLEIN à la place proposée — « il ira ici », avec sa faction.
 *
 * Un changement de faction ne bouge pas : il n'a ni flèche ni cercle creux,
 * seulement son repère, d'une autre couleur. Montrer une flèche de longueur
 * nulle aurait laissé croire à un micro-déplacement.
 *
 * RIEN N'EST ÉCRIT TANT QUE L'APERÇU EST À L'ÉCRAN. Le dépôt n'a pas bougé ;
 * cette couche lit une proposition, elle ne la constate pas.
 */
/**
 * LES ROUTES EN CONFLIT — le trajet réel entre deux postes trop proches.
 *
 * CE N'EST PAS UNE LIGNE DROITE, et c'est tout l'objet de cette couche. Un
 * trait tiré d'un poste à l'autre ne passe par aucune chaussée : il ne dit ni
 * par où l'on va, ni combien de kilomètres il faut parcourir. Ici, la
 * polyligne est la géométrie de l'itinéraire, calculée par le serveur sur le
 * même graphe routier et avec le même coût que la décision — la durée affichée
 * est celle qui a déclaré le conflit.
 *
 * DEUX ÉTATS, DEUX COULEURS. Rouge : le conflit subsiste après la proposition.
 * Vert : il est dénoué — le poste s'éloigne assez, ou il change de tour de
 * service et les deux ne sont plus simultanés. La route reste visible dans les
 * deux cas : on doit pouvoir vérifier ce qui a été résolu, pas seulement ce qui
 * reste.
 *
 * L'ÉTIQUETTE porte la distance PAR LA ROUTE et la durée. Elle est posée au
 * milieu du tracé, là où l'œil la cherche.
 */
function RoutesConflitLayer({ routes, seuilKm, items = [] }) {
  if (!routes?.length) return null;

  /**
   * TOUTE ROUTE EN CONFLIT EST ROUGE — y compris celle que la proposition
   * dénoue.
   *
   * Le conflit dénoué était vert. C'était trompeur : une route de quatre
   * minutes entre deux postes s'affichait en vert avec une coche, et se lisait
   * « tout va bien » alors que la proximité mesurée est extrême. Le vert disait
   * l'état de la PROPOSITION ; l'œil y lisait l'état du TERRAIN.
   *
   * Le rouge dit donc ce qui est dangereux — moins d'une heure de route entre
   * deux postes simultanés — et cela reste vrai que la proposition le règle ou
   * non. La distinction n'est pas perdue pour autant : le tracé dénoué est
   * POINTILLÉ et porte « ✓ », le tracé non dénoué est plein et porte « ⚠ », et
   * la bulle nomme le statut en toutes lettres.
   */
  const ROUGE_DANGER = '#E11D2E';
  const COULEUR = { conflit: ROUGE_DANGER, resolu: '#15803D' };
  const depotItems = new Map((items ?? []).map((m) => [m.id, m]));
  const estPosteIntou = (p) => {
    if (!p) return false;
    if (MQ.estIntouchable(p)) return true;
    const id = p.id ?? p;
    const m = depotItems.get(id);
    return Boolean(m && MQ.estIntouchable(m));
  };

  return (
    <LayerGroup>
      {routes.map((r) => {
        const couleur = COULEUR[r.statut] ?? COULEUR.conflit;
        if (couleur === ROUGE_DANGER && (r.entreIntouchables || (estPosteIntou(r.a) && estPosteIntou(r.b)))) {
          return null;
        }
        const positions = r.trace.map(([lng, lat]) => [lat, lng]);

        return (
          <LayerGroup key={`conflit-${r.cle}`}>
            {/* Un liseré sombre sous le tracé : sans lui, une route claire se
                perd sur un fond clair. */}
            <Polyline
              positions={positions}
              interactive={false}
              pathOptions={{ color: '#0B1B2D', weight: 7, opacity: 0.45 }}
            />
            <Polyline
              positions={positions}
              pathOptions={{
                color: couleur,
                weight: 4,
                opacity: 0.95,
                /* Pointillé = conflit dénoué par la proposition. Le rouge dit
                   le danger mesuré, le trait dit ce qu'on en fait. */
                dashArray: r.statut === 'resolu' ? '10 6' : null,
              }}
            >
              <Popup>
                <div className="gr-popup">
                  <h4>
                    {r.titre ?? (r.statut === 'resolu'
                      ? 'APRÈS — CONFLIT RÉSOLU'
                      : r.phase === 'restant'
                        ? 'CONFLIT RESTANT — aucune position valide'
                        : r.phase === 'avant'
                          ? 'AVANT — CONFLIT DE DISTANCE'
                          : 'APRÈS — CONFLIT NON RÉSOLU')}
                  </h4>
                  <table className="gr-tbl">
                    <tbody>
                      <tr>
                        <td>Barrage A</td>
                        <td>
                          {r.a.nom}
                          {r.a.bt ? ` (${r.a.bt})` : ''}
                        </td>
                      </tr>
                      <tr>
                        <td>Barrage B</td>
                        <td>
                          {r.b.nom}
                          {r.b.bt ? ` (${r.b.bt})` : ''}
                        </td>
                      </tr>
                      <tr>
                        <td>Distance routière</td>
                        <td>{r.km != null ? `${Number(r.km).toFixed(2)} km` : '—'}</td>
                      </tr>
                      <tr>
                        <td>Minimum requis</td>
                        <td>{r.seuilKm ?? seuilKm ?? '—'} km</td>
                      </tr>
                      <tr>
                        <td>Factions</td>
                        <td>
                          {r.a.factionId || '—'} / {r.b.factionId || '—'}
                        </td>
                      </tr>
                      <tr>
                        <td>Statut</td>
                        <td style={{ color: couleur, fontWeight: 700 }}>
                          {r.statut === 'resolu' ? 'RÉSOLU' : 'CONFLIT'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ margin: '6px 0 0', fontSize: 11, opacity: 0.7 }}>
                    Tracé et distance calculés sur le réseau routier réel, jamais à vol d’oiseau.
                  </p>
                </div>
              </Popup>
            </Polyline>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}

/** « 1 h 08 » plutôt que « 68 min » — la règle s'énonce en heures. */
const dureeLisible = (min) => {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`;
};

/**
 * L'APERÇU DE LA VERSION PROPOSÉE — ancienne place, nouvelle place, et la route.
 *
 * TROIS SIGNES, ET RIEN D'AUTRE — la carte doit se lire sans légende :
 *
 *   une ÉPINGLE ROUGE (✕) à l'ancienne position — « il était ici » ;
 *   une ÉPINGLE VERTE (✓) à la position proposée — « il irait ici » ;
 *   le TRAJET PAR LA ROUTE RÉELLE entre les deux, calculé par le serveur sur le
 *   graphe routier hors ligne, avec sa distance routière et ses routes.
 *
 * JAMAIS DE LIGNE DROITE. Sans tracé routier, aucun trait n'est dessiné : une
 * droite ne passe par aucune chaussée et mentirait sur le déplacement.
 *
 * AUCUN CERCLE. Les zones de rayon du seuil, les halos et les rayons ont été retirés :
 * la règle se lit dans les distances AVANT / APRÈS portées par les routes en
 * conflit (voir RoutesConflitLayer), pas dans une géométrie à interpréter.
 * L'Intouchable voisin garde son icône propre, sans rien autour.
 *
 * Les deux épingles ouvrent la même bulle AVANT / APRÈS. RIEN N'EST ÉCRIT :
 * c'est un calque de lecture, le dépôt ne bouge qu'au clic sur « Appliquer ».
 */
const GLYPHE_APERCU = {
  ancien:
    '<svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  nouveau:
    '<svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  /* Le second barrage du conflit, qui ne bouge pas : un simple point fixe. */
  inchange:
    '<svg viewBox="0 0 24 24" width="46%" height="46%"><circle cx="12" cy="12" r="6" fill="#fff"/></svg>',
};
const echapper = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const iconeApercu = (genre, taille) =>
  divIconStable({
    className: '',
    html:
      `<div class="gr-apercu-pin gr-apercu-pin-${genre}" style="--gr-apercu-pin:${taille}px">` +
      `<span class="gr-apercu-pin-tete"><span class="gr-apercu-pin-glyphe">${GLYPHE_APERCU[genre]}</span></span></div>`,
    iconSize: [taille, taille],
    /* La pointe de l'épingle, et non son centre, désigne la position. */
    iconAnchor: [taille / 2, Math.round(taille * 1.04)],
    popupAnchor: [0, -Math.round(taille * 0.9)],
  });

const kmLisible = (km) => (km != null && Number.isFinite(Number(km)) ? `${Number(km).toFixed(2)} km` : '—');

/**
 * LA BULLE D'UNE PROPOSITION — lisible en trois secondes.
 *
 * L'ordre est celui de la décision : QUI (le nom), QUOI (le verdict, en gros),
 * POURQUOI (la distance au conflit, AVANT → APRÈS, contre le seuil), puis QUI
 * BOUGE et QUI RESTE, le DÉPLACEMENT par la route, et seulement ensuite — repliés
 * — les coordonnées. Aucune valeur n'est calculée ici : distances, seuils, route,
 * espace adjacent et règle d'activation sont ceux rendus par le serveur ; la
 * bulle ne fait que les comparer pour choisir ✓ ou ❌.
 *
 * Le seuil est TOUJOURS celui de la simulation affichée (manuel : celui de
 * l'opérateur ; automatique : celui du moteur) — jamais une constante d'écran.
 */
const MAX_ROUTES_VISIBLES = 4;
function BulleAvantApres({ p, estResolu, cote, actions = null }) {
  const map = useMap();
  const dep = p.routeDeplacement;
  const seuil = p.seuilKm;
  const verdict = (km) => (km == null || seuil == null ? '' : Number(km) < Number(seuil) ? '❌' : '✓');
  const couleur = (km) => (km == null || seuil == null ? '#E5E7EB' : Number(km) < Number(seuil) ? '#F87171' : '#4ADE80');
  const coord = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—');
  const autre = p.conflit?.nom || p.conflitAvant?.id || '—';
  const voisinApres = p.voisinApresNom && p.voisinApresId !== p.conflitAvant?.id ? p.voisinApresNom : null;
  const routes = dep?.routes ?? [];
  const factionChange = p.factionApres && p.factionId && p.factionApres !== p.factionId;
  const titre =
    cote === 'ancien'
      ? { texte: '✕ ANCIENNE POSITION', couleur: '#F87171' }
      : !estResolu
        ? { texte: '⚠ CONFLIT RESTANT', couleur: '#FBBF24' }
        : cote === 'inchange'
          ? { texte: '✓ CONFLIT RÉSOLU', couleur: '#4ADE80' }
          : { texte: '✓ NOUVEL EMPLACEMENT', couleur: '#4ADE80' };
  const voirSurCarte = (e) => {
    e.stopPropagation();
    const pts = [[p.lat, p.lng]];
    if (Number.isFinite(p.latAvant)) pts.push([p.latAvant, p.lngAvant]);
    if (Number.isFinite(p.conflit?.lat)) pts.push([p.conflit.lat, p.conflit.lng]);
    for (const [lng, lat] of dep?.trace ?? []) pts.push([lat, lng]);
    map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 14, animate: true });
  };
  const section = { borderTop: '1px solid rgba(255,255,255,0.12)', padding: '7px 0 0', marginTop: 7 };
  const etiquette = { fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', opacity: 0.6, margin: '0 0 3px' };

  return (
    <div
      className="gr-popup gr-proposition"
      data-gr-proposition={p.id}
      data-gr-proposition-cote={cote}
      data-gr-proposition-statut={estResolu ? 'resolu' : 'conflit'}
      style={{ minWidth: 260, maxWidth: 300 }}
    >
      <h4 style={{ margin: 0 }}>{cote === 'inchange' ? autre : p.nom}</h4>
      <p data-gr-proposition-verdict="1" style={{ margin: '3px 0 0', fontSize: 13, fontWeight: 800, color: titre.couleur }}>{titre.texte}</p>
      <p style={{ margin: '2px 0 0', fontSize: 10, opacity: 0.65 }}>
        {p.mode === 'manuel' ? 'Position choisie par l’opérateur' : 'Position calculée'}
        {p.mode === 'manuel' && p.recalageM != null ? ` · recalée sur la route à ${p.recalageM} m du clic` : ''}
      </p>

      {/* 1. LA DISTANCE AU CONFLIT — l'information qui décide. */}
      <div style={section}>
        <p style={etiquette}>DISTANCE AU CONFLIT{seuil != null ? ` · SEUIL : ${seuil} KM` : ''}</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 6 }}>
          <div>
            <div style={{ fontSize: 9.5, opacity: 0.6 }}>AVANT</div>
            <div data-gr-avant-km={p.conflitAvant?.km ?? ''} style={{ fontSize: 15, fontWeight: 800, color: couleur(p.conflitAvant?.km) }}>
              {kmLisible(p.conflitAvant?.km)} {verdict(p.conflitAvant?.km)}
            </div>
          </div>
          <div style={{ fontSize: 15, opacity: 0.5 }}>→</div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9.5, opacity: 0.6 }}>APRÈS</div>
            <div data-gr-apres-km={p.distanceApresKm ?? ''} style={{ fontSize: 15, fontWeight: 800, color: couleur(p.distanceApresKm) }}>
              {kmLisible(p.distanceApresKm)} {verdict(p.distanceApresKm)}
            </div>
          </div>
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 10.5, fontWeight: 700, color: estResolu ? '#4ADE80' : '#FBBF24' }}>
          {estResolu
            ? `✓ CONFLIT RÉSOLU — ${kmLisible(p.distanceApresKm)} ≥ ${seuil ?? '—'} km`
            : `⚠ CONFLIT RESTANT — ${kmLisible(p.distanceApresKm)} < ${seuil ?? '—'} km${voisinApres ? ` avec ${voisinApres}` : ''}`}
        </p>
        {cote !== 'inchange' && (
          <details style={{ marginTop: 3, fontSize: 10.5 }} data-gr-pourquoi-proposition="1">
            <summary style={{ cursor: 'pointer', opacity: 0.75 }}>Pourquoi ?</summary>
            <ExplicationOptimisation
              nom={p.nom}
              distanceKm={p.conflitAvant?.km}
              seuilKm={seuil}
              voisinNom={autre}
              decision={{
                type: 'deplacer', statut: 'simule', distanceAvantKm: p.conflitAvant?.km,
                distanceApresKm: p.distanceApresKm, conflitRestant: !estResolu,
              }}
            />
          </details>
        )}
        {voisinApres && estResolu && (
          <p style={{ margin: '2px 0 0', fontSize: 10, opacity: 0.7 }}>Voisin le plus proche après : {voisinApres}</p>
        )}
        {/* Manuel : la règle que l'activation appliquera, dite à part. */}
        {p.mode === 'manuel' && p.activable != null && p.seuilDeplacementKm != null && (
          <p data-gr-activable={p.activable ? '1' : '0'} style={{ margin: '4px 0 0', fontSize: 10, color: p.activable ? '#4ADE80' : '#FBBF24' }}>
            {p.activable
              ? `✓ Règle de déplacement respectée : ≥ ${p.seuilDeplacementKm} km de tout poste`
              : `⚠ Règle de déplacement non respectée : ${p.conflitActivation?.nom ?? 'un poste'} à ${kmLisible(p.conflitActivation?.km)} (< ${p.seuilDeplacementKm} km) — l’activation sera refusée. Modifiez la position.`}
          </p>
        )}
      </div>

      {/* 2. L'ESPACE ADJACENT, quand la zone n'offrait rien. */}
      {p.espace === 'adjacent' && (
        <div style={section} data-gr-espace-adjacent="1">
          <p style={{ ...etiquette, color: 'var(--tone-info)', opacity: 1 }}>ESPACE ADJACENT</p>
          <p style={{ margin: 0, fontSize: 10.5 }}>
            {p.mode === 'manuel' ? 'Position choisie hors de la zone analysée, ' : 'Aucun emplacement valide dans la zone principale. Position calculée '}
            dans : <b>{p.espaceAdjacent?.libelle ?? 'espace adjacent'}</b>
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 10.5, fontWeight: 700, color: p.espaceAdjacent?.autorisation === 'autorisee' ? '#4ADE80' : '#FBBF24' }}>
            Autorisation : {p.espaceAdjacent?.autorisation === 'autorisee' ? '✓ Autorisée' : '⏳ AUTORISATION REQUISE'}
          </p>
        </div>
      )}

      {/* 3. QUI BOUGE, QUI RESTE. */}
      <div style={section}>
        <p style={etiquette}>BARRAGE DÉPLACÉ</p>
        <p style={{ margin: 0, fontWeight: 700 }}>{p.nom} → nouvelle position</p>
        <p style={{ ...etiquette, marginTop: 5 }}>{p.conflit?.intouchable ? '🔒 BARRAGE PROTÉGÉ' : 'BARRAGE EN CONFLIT'}</p>
        <p style={{ margin: 0, fontWeight: 700 }}>{autre}</p>
        <p style={{ margin: 0, fontSize: 10.5, opacity: 0.75 }}>{p.conflit?.deplaceAussi ? 'Déplacé lui aussi par la simulation' : 'Reste à sa position'}</p>
      </div>

      {/* 4. LE DÉPLACEMENT, par la route réelle. */}
      <div style={section}>
        <p style={etiquette}>DÉPLACEMENT PAR LA ROUTE</p>
        <p style={{ margin: 0, fontWeight: 700 }}>
          {p.routeAvant || '—'} → {p.routeApres || '—'}
          <span style={{ fontWeight: 600, opacity: 0.85 }}> · {dep ? `${kmLisible(dep.km)} par la route` : 'tracé indisponible'}</span>
        </p>
        {routes.length > 0 && routes.length <= MAX_ROUTES_VISIBLES && (
          <p style={{ margin: '1px 0 0', fontSize: 10.5, opacity: 0.75 }}>{routes.join(' › ')}</p>
        )}
        {routes.length > MAX_ROUTES_VISIBLES && (
          <details style={{ fontSize: 10.5, opacity: 0.8 }}>
            <summary style={{ cursor: 'pointer' }}>{routes.slice(0, MAX_ROUTES_VISIBLES).join(' › ')} › … ({routes.length} routes)</summary>
            {routes.join(' › ')}
          </details>
        )}
      </div>

      {/* 5. Le secondaire, replié. */}
      <details style={{ ...section, fontSize: 10.5 }} data-gr-details-position="1">
        <summary style={{ cursor: 'pointer', fontWeight: 700, opacity: 0.75 }}>Détails de position</summary>
        <div style={{ marginTop: 3, lineHeight: 1.5 }}>
          <div>Ancienne : <b>{coord(p.latAvant, p.lngAvant)}</b></div>
          <div>Nouvelle : <b>{coord(Number(p.lat), Number(p.lng))}</b></div>
          <div>
            Faction :{' '}
            {factionChange
              ? <b style={{ color: 'var(--tone-warn)' }}>{p.factionId} → {p.factionApres}</b>
              : <b>{p.factionId || '—'} · inchangée</b>}
          </div>
        </div>
      </details>

      <p style={{ margin: '7px 0 4px', fontSize: 9.5, opacity: 0.6, fontStyle: 'italic' }}>
        Simulation — rien n’est enregistré avant l’activation.
      </p>
      <div className="gr-popup-actions">
        <button type="button" className="gr-popup-act" data-gr-voir-carte="1" onClick={voirSurCarte}>Voir sur la carte</button>
        {actions?.modifierPosition && cote !== 'inchange' && (
          <button
            type="button"
            className="gr-popup-act gr-popup-act-actif"
            data-gr-modifier-position="1"
            onClick={(e) => { e.stopPropagation(); map.closePopup(); actions.modifierPosition(); }}
          >
            Modifier la position
          </button>
        )}
        {actions?.conserver && (
          <button
            type="button"
            className="gr-popup-act"
            data-gr-conserver-proposition="1"
            onClick={(e) => { e.stopPropagation(); map.closePopup(); actions.conserver(); }}
          >
            Conserver
          </button>
        )}
        {actions?.assigner && (
          <button
            type="button"
            className="gr-popup-act"
            style={{ background: '#F59E0B', color: '#0B1B2D', fontWeight: 800 }}
            onClick={(e) => { e.stopPropagation(); map.closePopup(); actions.assigner(); }}
          >
            ➜ Assigner au CMND Région
          </button>
        )}
      </div>
    </div>
  );
}

/** L'épingle NOUVELLE, qui s'ouvre d'elle-même quand l'opérateur vient de la placer. */
function MarqueurNouvellePosition({ p, taille, ouvrir, onOuvert, children }) {
  const ref = useRef(null);
  /* Après un court délai : la réponse du serveur fait re-rendre l'aperçu, et une
     bulle ouverte trop tôt serait perdue. Une fois ouverte, la demande est levée
     — l'opérateur qui la ferme ne la voit pas revenir. */
  useEffect(() => {
    if (!ouvrir) return undefined;
    const t = setTimeout(() => {
      if (!ref.current) return;
      ref.current.openPopup();
      onOuvert?.();
    }, 300);
    return () => clearTimeout(t);
  }, [ouvrir, p.lat, p.lng, onOuvert]);
  return (
    <Marker ref={ref} position={[p.lat, p.lng]} zIndexOffset={1200} icon={iconeApercu('nouveau', taille)}>
      {children}
    </Marker>
  );
}

function ApercuOptimisationLayer({ apercu, echelle = 1, intouchables = true, actionsDe = null, ouvrirId = null, onOuvert = null, conflits = null }) {
  if (!apercu?.length) return null;
  const taille = Math.round(24 * echelle);

  return (
    <LayerGroup>
      {apercu.map((p) => {
        const estResolu = p.statut === 'resolu';
        const aBouge =
          Number.isFinite(p.latAvant) &&
          Number.isFinite(p.lngAvant) &&
          (p.latAvant !== p.lat || p.lngAvant !== p.lng);
        const trace = p.routeDeplacement?.trace?.length > 1 ? p.routeDeplacement.trace : null;
        const positions = trace?.map(([lng, lat]) => [lat, lng]);
        const milieu = trace?.[Math.floor(trace.length / 2)];

        return (
          <LayerGroup key={`apercu-${p.id}`}>
            {/* L'Intouchable voisin : son icône, et rien autour. */}
            {/* Le voisin qui porte déjà son repère de conflit (BarragesEnConflitLayer) n'est pas doublé. */}
            {intouchables && p.conflit?.intouchable === true && !conflits?.has(p.conflit.id) && Number.isFinite(p.conflit.lat) && (
              <Marker
                position={[p.conflit.lat, p.conflit.lng]}
                zIndexOffset={1050}
                icon={divIconStable({
                  className: '',
                  html: `<div class="gr-apercu-intouchable" style="width:${taille}px;height:${taille}px" title="Barrage Intouchable">🔒</div>`,
                  iconSize: [taille, taille],
                  iconAnchor: [taille / 2, taille / 2],
                })}
              >
                <Tooltip direction="top">{`🔒 INTOUCHABLE : ${p.conflit.nom || p.conflit.id} — jamais déplacé`}</Tooltip>
                <Popup>
                  <div className="gr-popup">
                    <h4>{p.conflit.nom || p.conflit.id}</h4>
                    {/* Après le déplacement de son voisin : la distance APRÈS dit si le conflit reste. */}
                    <ExplicationOptimisation
                      intouchable
                      distanceKm={p.distanceApresKm}
                      seuilKm={p.seuilKm}
                      voisinNom={p.nom}
                    />
                  </div>
                </Popup>
              </Marker>
            )}

            {/* LE SECOND BARRAGE DU CONFLIT, À SA POSITION INCHANGÉE — sans lui, la
                carte laissait croire qu'un seul poste était en cause. */}
            {p.conflit && p.conflit.intouchable !== true && !p.conflit.deplaceAussi && !conflits?.has(p.conflit.id) && Number.isFinite(p.conflit.lat) && (
              <Marker
                position={[p.conflit.lat, p.conflit.lng]}
                zIndexOffset={1050}
                icon={iconeApercu('inchange', taille)}
              >
                <Tooltip direction="top" offset={[0, -taille]}>{`${p.conflit.nom || p.conflit.id} — reste à sa position`}</Tooltip>
                <Popup autoPanPaddingTopLeft={[24, 130]} autoPanPaddingBottomRight={[24, 40]}>
                  <BulleAvantApres p={p} estResolu={estResolu} cote="inchange" actions={actionsDe?.(p)} />
                </Popup>
              </Marker>
            )}

            {/* LE DÉPLACEMENT PAR LA ROUTE RÉELLE — jamais une droite. */}
            {aBouge && positions && (
              <>
                <Polyline
                  positions={positions}
                  interactive={false}
                  pathOptions={{ color: '#0B1B2D', weight: 8, opacity: 0.55 }}
                />
                <Polyline positions={positions} pathOptions={{ color: '#38BDF8', weight: 4.5, opacity: 0.95 }}>
                  <Tooltip sticky>{`${p.nom} : ancienne → nouvelle position, par la route`}</Tooltip>
                </Polyline>
              </>
            )}

            {aBouge && !conflits?.has(p.id) && (
              <Marker position={[p.latAvant, p.lngAvant]} zIndexOffset={1100} icon={iconeApercu('ancien', taille)}>
                <Tooltip direction="top" offset={[0, -taille]}>{`${p.nom} — ancienne position`}</Tooltip>
                <Popup autoPanPaddingTopLeft={[24, 130]} autoPanPaddingBottomRight={[24, 40]}>
                  <BulleAvantApres p={p} estResolu={estResolu} cote="ancien" actions={actionsDe?.(p)} />
                </Popup>
              </Marker>
            )}

            <MarqueurNouvellePosition p={p} taille={taille} ouvrir={ouvrirId === p.id} onOuvert={onOuvert}>
              <Tooltip direction="top" offset={[0, -taille]}>{`${p.nom} — nouvel emplacement`}</Tooltip>
              <Popup autoPanPaddingTopLeft={[24, 130]} autoPanPaddingBottomRight={[24, 40]}>
                <BulleAvantApres p={p} estResolu={estResolu} cote="nouveau" actions={actionsDe?.(p)} />
              </Popup>
            </MarqueurNouvellePosition>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}

/**
 * ⚠ CONFLIT DE DISTANCE — la section ajoutée à la bulle ordinaire du barrage.
 *
 * Valeurs du serveur seulement (`resultats.conflits`, publié par le panneau à
 * partir du résultat d'optimisation courant) : distance PAR LA ROUTE, seuil de
 * la simulation affichée, voisin en cause. « Voir le conflit sur la carte »
 * cadre les deux extrémités ; rien n'est recalculé ici.
 */
function SectionConflit({ c, voisin = null }) {
  const map = useMap();
  const km = (v) => (v != null && Number.isFinite(Number(v)) ? `${Number(v).toFixed(2)} km` : '—');
  const voir = (e) => {
    e.stopPropagation();
    const pts = [[c.lat, c.lng]];
    if (voisin && Number.isFinite(voisin.lat)) pts.push([voisin.lat, voisin.lng]);
    for (const [lng, lat] of c.trace ?? []) pts.push([lat, lng]);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 14 });
  };
  const titre = c.etat === 'protege' ? '🔒 BARRAGE PROTÉGÉ — CONFLIT DE DISTANCE' : '⚠ CONFLIT DE DISTANCE';
  return (
    <div data-gr-section-conflit={c.etat} style={{ margin: '4px 0 8px', padding: '7px 8px', borderRadius: 8, border: '1px solid rgba(225,29,46,0.55)', background: 'rgba(225,29,46,0.10)', fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 800, color: 'var(--tone-danger)', letterSpacing: '.03em' }}>{titre}</div>
      {c.etat === 'contexte' && <div style={{ fontSize: 10, opacity: 0.75 }}>Barrage de contexte — hors zone analysée, non compté</div>}
      <div>Distance réelle : <b>{km(c.km)}</b> ❌</div>
      {c.seuilKm != null && <div>Seuil : {c.seuilKm} km</div>}
      <div>Barrage en conflit : <b>{c.voisinNom || c.voisinId || '—'}</b>{c.voisinIntouchable ? ' 🔒' : ''}</div>
      {c.issue === 'resolu' && <div style={{ color: 'var(--tone-ok)' }}>✓ Résolu par la simulation en cours (rien n’est encore écrit)</div>}
      {c.issue === 'restant' && <div style={{ color: 'var(--tone-warn)' }}>⚠ Reste en conflit dans la simulation en cours</div>}
      {c.etat === 'protege' && <div style={{ fontSize: 10, opacity: 0.8 }}>Intouchable : jamais déplacé ni retiré par la filtration.</div>}
      {c.etat === 'conserve' && <div style={{ fontSize: 10, opacity: 0.8 }}>Conservé par décision du commandement — le conflit est maintenu.</div>}
      <div className="gr-popup-actions" style={{ marginTop: 5 }}>
        <button type="button" className="gr-popup-act" data-gr-voir-conflit="1" onClick={voir}>Voir le conflit sur la carte</button>
      </div>
      {/* Plus de bloc « décision / Assigner » ici : comme pour l'analyse par axe,
          les conflits se traitent dans le menu des conflits. */}
    </div>
  );
}

/**
 * LE REPÈRE D'UN BARRAGE EN CONFLIT — jamais celui d'un barrage ordinaire.
 *
 * Le pictogramme du poste (rouge, ou doré-cadenas pour un Intouchable), un
 * badge (« ? » à trancher, « 🔒 » protégé, « ❌ » sinon) et l'étiquette de la
 * distance « 5.41 km ❌ » — préfixée « CONTEXTE » hors zone analysée.
 */
const BADGE_CONFLIT = { a_trancher: '?', protege: '🔒', conserve: '❌', contexte: '❌', restant: '❌', resolu: '❌', decide: '❌' };
const iconeEtatConflit = (m, c, echelle) => {
  const app = MQ.apparence(m);
  const protege = c.etat === 'protege' || MQ.estIntouchable(m);
  const base = pinIcon({ glyph: app.glyph, color: protege ? app.color : '#DC2626', scale: (app.scale ?? 1) * echelle, intouchable: protege });
  const [w, h] = base.options.iconSize;
  return divIconStable({
    className: '',
    html:
      `<div class="gr-conflit-barrage gr-conflit-${c.etat}" data-gr-conflit-id="${echapper(m.id)}" data-gr-conflit-etat="${c.etat}" style="width:${w}px;height:${h}px">` +
      `<img src="${base.options.iconUrl}" width="${w}" height="${h}" alt="" />` +
      `<span class="gr-conflit-badge">${BADGE_CONFLIT[c.etat] ?? '❌'}</span></div>`,
    iconSize: [w, h],
    iconAnchor: base.options.iconAnchor,
    popupAnchor: base.options.popupAnchor,
    tooltipAnchor: base.options.tooltipAnchor,
  });
};

/**
 * LES BARRAGES EN CONFLIT DE DISTANCE — un repère par poste, à toute échelle.
 *
 * Source unique : `resultats.conflits` (analysés, protégés, conservés, de
 * contexte — et, en automatique, les deux extrémités de chaque conflit). Un poste
 * déjà représenté par une autre couche (décision simulée, épingle ANCIENNE d'un
 * déplacement, retrait proposé) n'est pas doublé ; si cette couche est masquée
 * par un filtre, c'est ce repère-ci qui reprend la main — un barrage en conflit
 * n'est jamais rendu comme un barrage ordinaire, ni effacé.
 */
/**
 * TRACÉ D'UN CONFLIT ASSIGNÉ — affiché quand un CMND Région ou CMND Cie clique
 * « Voir le conflit et la route sur la carte ».
 * Trace la route réelle (triq) entre les deux barrages et repère le voisin.
 */
function ConflitAssigneLayer({ conflit, mode = 'comparer' }) {
  if (!conflit) return null;
  const { barrage, voisin, trace, traceApres, traceDeplacement, changement } = conflit;
  const isTraite = Boolean(conflit.estTraite || changement || conflit.statut === 'traite');
  const isDeplacement = changement?.type === 'deplacement' || (changement?.apres?.lat != null);

  const posAvant = (changement?.avant?.lat != null && changement?.avant?.lng != null)
    ? [changement.avant.lat, changement.avant.lng]
    : (barrage?.lat != null && barrage?.lng != null ? [barrage.lat, barrage.lng] : null);

  const posApres = (changement?.apres?.lat != null && changement?.apres?.lng != null)
    ? [changement.apres.lat, changement.apres.lng]
    : null;

  const posVoisin = (voisin?.lat != null && voisin?.lng != null)
    ? [voisin.lat, voisin.lng]
    : null;

  const routeAvant = changement?.avant?.route || conflit.route || barrage?.route || 'Route';
  const routeApres = changement?.apres?.route || routeAvant;

  // Conversion en coordonnées [lat, lng]
  const toLatLngs = (tr) => Array.isArray(tr)
    ? tr.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => [lat, lng])
    : null;

  /* Une route RÉELLE (graphe routier) quand elle est connue et marquée comme
     telle ; sinon le segment entre les deux points — présenté comme tel
     (« à vol d'oiseau »), jamais comme une route. */
  const routeOuDirect = (tr, routiere, depuis, vers) => {
    const pts = toLatLngs(tr);
    if (pts && pts.length > 1) return { positions: pts, routiere: routiere !== false && pts.length > 1 };
    /* Segment de repli : jamais de longueur nulle (rien à montrer). */
    if (!depuis || !vers || longueurKm([depuis, vers]) < 0.01) return null;
    return { positions: [depuis, vers], routiere: false };
  };
  const rAvant = routeOuDirect(trace, conflit.traceRoutiere, posAvant, posVoisin);
  const rApres = routeOuDirect(traceApres, conflit.traceApresRoutiere, posApres, posVoisin);
  const rDeplacement = routeOuDirect(traceDeplacement, conflit.traceDeplacementRoutiere, posAvant, posApres);

  const afficherAvant = !isTraite || mode === 'avant' || mode === 'comparer';
  const afficherApres = isTraite && (mode === 'apres' || mode === 'comparer');

  /* Distances AFFICHÉES : mesurées sur la route réelle quand on l'a ; sinon la
     valeur enregistrée du conflit ; jamais une valeur inventée. */
  const kmDe = (r, moteur, enregistre) => {
    if (r?.routiere) return Number.isFinite(moteur) ? moteur : longueurKm(r.positions);
    return Number.isFinite(Number(enregistre)) && Number(enregistre) > 0 ? Number(enregistre) : null;
  };
  const distAvant = kmDe(rAvant, conflit.kmTrace, changement?.avant?.distanceKm ?? conflit.distanceKm);
  const distApres = kmDe(rApres, conflit.kmApres, changement?.apres?.distanceKm);
  const fmt = (km) => (km == null ? 'distance inconnue' : `${km.toFixed(1)} km`);

  /* `km` : la distance du moteur d'itinéraire pour CETTE route (sinon
     RouteAnimee la mesure sur sa géométrie). */
  const routes = [
    afficherAvant && rAvant && { cle: 'avant', role: 'conflit', titre: isTraite ? 'Avant' : null, ...rAvant, km: rAvant.routiere ? conflit.kmTrace : null },
    isTraite && mode === 'comparer' && isDeplacement && rDeplacement && { cle: 'deplacement', role: 'deplacement', titre: 'Déplacement', ...rDeplacement, km: rDeplacement.routiere ? conflit.kmDeplacement : null },
    afficherApres && isDeplacement && rApres && { cle: 'apres', role: 'resolue', titre: 'Après', ...rApres, km: rApres.routiere ? conflit.kmApres : null },
  ].filter(Boolean);

  return (
    <LayerGroup>
      {/* Routes du conflit, dessinées l'une après l'autre avec leur distance
          (RouteAnimee) — `jeu` change à chaque « Voir sur la carte ». */}
      <RouteAnimee routes={routes} jeu={conflit.jeu ?? 0} />

      {/* Repère AVANT du barrage en conflit */}
      {afficherAvant && posAvant && (
        <Marker
          position={posAvant}
          zIndexOffset={1350}
          icon={divIconStable({
            className: '',
            html: `<div style="position:relative;width:32px;height:32px;background:#DC2626;color:#fff;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:14px;box-shadow:0 0 14px rgba(220,38,38,0.9);border:2.5px solid #fff;${mode === 'comparer' ? 'opacity:0.85;' : ''}">
              <span style="font-size:12px;">🔴</span>
            </div>`,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          })}
        >
          <Tooltip direction="top" permanent={mode !== 'comparer'} offset={[0, -16]}>
            {`🔴 AVANT : ${barrage?.nom || 'Barrage'} (${fmt(distAvant)} sur ${routeAvant})`}
          </Tooltip>
        </Marker>
      )}

      {/* Repère APRÈS du barrage (Nouvel emplacement) */}
      {afficherApres && isDeplacement && posApres && (
        <Marker
          position={posApres}
          zIndexOffset={1400}
          icon={divIconStable({
            className: '',
            html: `<div style="position:relative;width:36px;height:36px;background:linear-gradient(135deg, #10B981, #059669);color:#fff;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:16px;box-shadow:0 0 18px rgba(16,185,129,0.95);border:3px solid #fff;">
              ✓
              <span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid #10B981;opacity:0.65;animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></span>
            </div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          })}
        >
          <Tooltip direction="top" permanent offset={[0, -18]}>
            {`🟢 NOUVELLE POSITION : ${barrage?.nom || 'Barrage'} (${fmt(distApres)} sur ${routeApres})`}
          </Tooltip>
        </Marker>
      )}

      {/* Repère du voisin */}
      {posVoisin && (
        <Marker
          position={posVoisin}
          zIndexOffset={1300}
          icon={divIconStable({
            className: '',
            html: `<div style="width:28px;height:28px;background:${afficherApres && !afficherAvant ? '#1E293B' : '#EF4444'};color:#fff;border-radius:50%;display:grid;place-items:center;font-weight:900;font-size:13px;box-shadow:0 0 12px ${afficherApres && !afficherAvant ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.9)'};border:2px solid #fff;">
              ${afficherApres && !afficherAvant ? '🛡' : '⚠'}
            </div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          })}
        >
          <Tooltip direction="top" permanent offset={[0, -14]}>
            {`Barrage voisin : ${voisin?.nom || voisin?.id}`}
          </Tooltip>
        </Marker>
      )}
    </LayerGroup>
  );
}

function BarragesEnConflitLayer({ resultats, items, echelle = 1, vise = null, propsBulle = {}, conflitsSupprimes = null }) {
  const conflits = resultats?.conflits;
  const parId = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);
  if (!conflits?.size) return null;
  return (
    <LayerGroup>
      {[...conflits.values()].map((c) => {
        if (representeAilleurs(resultats, c)) return null;
        if (propsBulle.estAdmin && propsBulle.barragesAssignes?.has(c.id)) return null;
        if (conflitsSupprimes && conflitsSupprimes.size > 0) {
          if (c.id && conflitsSupprimes.has(c.id)) return null;
          if (c.voisinId && (conflitsSupprimes.has(c.voisinId) || conflitsSupprimes.has(clePaire(c.id, c.voisinId)))) return null;
        }
        const m = parId.get(c.id) || (items ?? []).find((x) => x.id === c.id);
        if (!m || !Number.isFinite(m.lat)) return null;
        const voisin = c.voisinId ? parId.get(c.voisinId) ?? (items ?? []).find((x) => x.id === c.voisinId) ?? null : null;
        const simulation = c.etat === 'contexte' ? null : simulationDe(resultats, c.id, c.etat === 'protege', c, m, {
          estAdmin: propsBulle.estAdmin,
          onAssigner: propsBulle.onAssigner,
        });
        return (
          <OuvreSiVise key={`conflit-${c.id}`} marque={vise?.id === c.id ? vise.ts : null}>
            <Marker position={[m.lat, m.lng]} zIndexOffset={c.etat === 'contexte' ? 850 : 1000} icon={iconeEtatConflit(m, c, echelle)}>
              <Tooltip direction="top" offset={[0, -14]}>
                {`${m.nom || m.id} — conflit de distance : ${Number.isFinite(Number(c.km)) ? Number(c.km).toFixed(2) : '—'} km avec ${c.voisinNom || c.voisinId || '—'}`}
              </Tooltip>
              <Popup>
                <BulleMarquage
                  m={m}
                  {...propsBulle}
                  conflit={<SectionConflit c={{ ...c, lat: m.lat, lng: m.lng }} voisin={voisin} simulation={simulation} />}
                />
              </Popup>
            </Marker>
          </OuvreSiVise>
        );
      })}
    </LayerGroup>
  );
}

/** Ce poste a-t-il déjà son repère dans une autre couche AFFICHÉE ? */
function representeAilleurs(resultats, c) {
  if (c.etat === 'a_supprimer') return true; // RepereDecision « ✗ » (retrait au commandement)
  const d = resultats.decisionsSimulees?.get(c.id);
  if (d?.statut === 'simule') {
    if (d.type === 'conserver' || d.type === 'supprimer') {
      return c.etat !== 'protege' && filtreOptim(resultats, d.type === 'supprimer' ? 'retraits' : 'conserves');
    }
  }
  return false;
}

function OptimisationLayer({
  items,
  resultats,
  vise,
  onDecider,
  /* Voir DecisionsLayer : la même bulle, le même dossier, la même règle. */
  notifications,
  onDeciderDemande,
  session,
  peutReprendre,
  piedEffectif,
  echelle = 1,
  propsBulle = {},
}) {
  const barrage = (m) => MQ.estBarrage(m);

  const aDecider = useMemo(() => {
    if (!resultats) return [];
    return items.filter((m) => barrage(m) && resultats.annulesIds.has(m.id));
  }, [items, resultats]);

  /**
   * LES POSTES EXCLUS — repère distinct, jamais un « ? ».
   *
   * Le « ? » signifie « il faut trancher » : le poser sur un poste qu'aucune
   * décision ne peut atteindre serait un appel à cliquer sur rien. Ces postes
   * portent donc un cadenas, d'une autre couleur et sans battement — présents,
   * lisibles, et manifestement hors du jeu.
   *
   * `protegesIds` peut manquer si le rapport vient d'une version antérieure du
   * serveur : aucun cadenas ne s'affiche alors, et rien ne casse.
   */
  const exclus = useMemo(() => {
    if (!resultats?.protegesIds) return [];
    return items.filter((m) => barrage(m) && resultats.protegesIds.has(m.id));
  }, [items, resultats]);

  /**
   * Les décisions appartenant au résultat courant restent visibles à toute
   * échelle. DecisionsLayer les exclut de son propre rendu au niveau détaillé,
   * afin qu'un même poste ne reçoive jamais deux marqueurs superposés.
   */
  const decisions = useMemo(() => {
    if (!resultats) return [];
    return items
      .filter((m) => barrage(m) && resultats.masquesIds?.has(m.id))
      .map((m) => {
        /* Un poste conservé n'est plus une décision à montrer : il a repris
           son repère ordinaire (voir `masquesBarrages`). Seul le retrait
           proposé garde un marqueur, sa question restant ouverte. */
        const etat = resultats.aSupprimerIds?.has(m.id)
          ? 'a_supprimer'
          : m.decisionOptimisation === 'a_supprimer'
            ? 'a_supprimer'
            : null;
        return { m, etat };
      })
      .filter(({ etat }) => etat === 'a_supprimer');
  }, [items, resultats]);

  if (!resultats) return null;

  return (
    <LayerGroup>
      {/* Plus d'anneau autour du poste signalé : aucun cercle d'optimisation
          sur la carte. Le « ? » ci-dessous suffit à le désigner. */}

      {/*
        MARQUEUR « ? » CLIGNOTANT — voir `.gr-interro` dans index.css.

        L'anneau rouge dit qu'il y a un problème, mais il se confond avec le
        reste dès qu'on dézoome, et surtout il ne se clique pas. Ce marqueur-ci
        bat lentement pour attirer l'œil, et s'ouvre sur la seule question qui
        se pose devant un barrage signalé : on le retire, ou on le garde ?

        Il est en DOM (`divIcon`) et non sur le canevas des vecteurs : une
        animation CSS ne s'applique pas à une forme dessinée dans un canvas.
      */}
      {!resultats.conflits && filtreOptim(resultats, 'conflits') && aDecider.map((m) => (
        <OuvreSiVise key={`int-${m.id}`} marque={vise?.id === m.id ? vise.ts : null}>
          <Marker
            position={[m.lat, m.lng]}
            zIndexOffset={1000}
            icon={iconeConflitBarrage(m, echelle)}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {m.nom || 'Barrage sans nom'} — cliquez pour décider
            </Tooltip>
            <Popup>
              <DecisionPopup
                m={m}
                mesure={resultats.motifs?.get(m.id)}
                onDecider={propsBulle?.estAdmin ? null : onDecider}
                enPied={piedEffectif?.(m)}
                voisinNom={voisinDuConflit(resultats, m.id)}
                simulation={simulationDe(resultats, m.id, false, null, m, {
                  estAdmin: propsBulle?.estAdmin,
                  onAssigner: propsBulle?.onAssigner,
                })}
                estAdmin={propsBulle?.estAdmin}
                onAssigner={propsBulle?.onAssigner}
              />
            </Popup>
          </Marker>
        </OuvreSiVise>
      ))}

      {/*
        CADENAS DES POSTES EXCLUS — voir `.gr-exclu` dans index.css.

        Ni cercle d'emprise ni battement : ces deux signaux disent « regarde
        ici, il y a quelque chose à faire », et il n'y a précisément rien à
        faire. Le cadenas se contente d'être lisible et de s'expliquer au clic.
      */}
      {!resultats.conflits && filtreOptim(resultats, 'intouchables') && exclus.map((m) => {
        const exclusion = resultats.exclusions?.get(m.id);
        const forme = formeExclusion(exclusion?.protections);

        return (
          <OuvreSiVise key={`exc-${m.id}`} marque={vise?.id === m.id ? vise.ts : null}>
            <Marker
              position={[m.lat, m.lng]}
              zIndexOffset={900}
              icon={iconeDecision(30, echelle, `gr-exclu ${forme.classe}`, forme.svg)}
            >
              <Tooltip direction="top" offset={[0, -13]}>
                {m.nom || 'Barrage sans nom'} — exclu : {forme.mot}
              </Tooltip>
              <Popup>
                <ExclusionPopup
                  m={m}
                  exclusion={exclusion}
                  enPied={piedEffectif?.(m)}
                  simulation={simulationDe(resultats, m.id, true, null, m, {
                    estAdmin: propsBulle?.estAdmin,
                    onAssigner: propsBulle?.onAssigner,
                  })}
                />
              </Popup>
            </Marker>
          </OuvreSiVise>
        );
      })}

      {decisions.map(({ m, etat }) => (
        <RepereDecision
          key={`optim-decision-${m.id}`}
          m={m}
          etat={etat}
          vise={vise?.id === m.id}
          mesure={resultats.motifs?.get(m.id) ?? null}
          onDecider={propsBulle?.estAdmin ? null : (peutReprendre ? onDecider : null)}
          demande={retraitATrancher(notifications, m.id, session)}
          onDeciderDemande={onDeciderDemande}
          piedEffectif={piedEffectif}
        />
      ))}
    </LayerGroup>
  );
}

/**
 * Barrage fixe et mobile comptent comme UNE seule catégorie pour la
 * détection de doublon : poser un « barrage mobile » à 10 m d'un « barrage
 * fixe » existant n'est pas moins redondant que d'en poser un identique.
 */
const CATEGORIE_DOUBLON = {
  barrage_fixe: 'barrage',
  barrage_mobile: 'barrage',
  /* Le VIP compte dans la même catégorie : deux postes à dix mètres restent
     deux postes au même endroit, quelle que soit la nature du second. */
  barrage_vip: 'barrage',
};
const SEUIL_DOUBLON_M = 50; // en deçà, deux clics visent manifestement le même endroit

/**
 * Marquage existant le plus proche de même catégorie, sous le seuil — ou
 * `null`. Purement géométrique (vol d'oiseau, `RT.distanceKm`) : à cette
 * échelle (50 m), la précision de la route réelle n'apporte rien face au
 * coût d'un calcul d'itinéraire à chaque clic.
 */
function chercherDoublon(type, lngLat, items, seuilM = SEUIL_DOUBLON_M) {
  const categorie = CATEGORIE_DOUBLON[type] ?? type;
  let meilleur = null;
  for (const m of items) {
    if ((CATEGORIE_DOUBLON[m.type] ?? m.type) !== categorie) continue;
    const distanceM = RT.distanceKm(lngLat[0], lngLat[1], m.lng, m.lat) * 1000;
    if (!meilleur || distanceM < meilleur.distanceM) meilleur = { m, distanceM };
  }
  return meilleur && meilleur.distanceM <= seuilM ? meilleur : null;
}

/**
 * Repère provisoire d'un marquage, entre le clic et la confirmation : un
 * anneau pointillé (même code que le périmètre d'habilitation) le distingue
 * visuellement d'un repère déjà enregistré. Déplaçable pour ajuster
 * l'emplacement sans re-cliquer. `type` choisit le glyphe/la couleur —
 * n'importe quelle nature posée au clic passe par ce même aperçu.
 */
function PositionProvisoireLayer({ position, onDeplacer, type = 'accident' }) {
  if (!position) return null;
  const [lng, lat] = position;
  const t = MQ.TYPE_PAR_CLE[type] ?? MQ.TYPE_PAR_CLE.accident;

  return (
    <LayerGroup>
      <Circle
        center={[lat, lng]}
        radius={400}
        interactive={false}
        pathOptions={{
          color: '#c8a349',
          weight: 2,
          dashArray: '4, 5',
          fillOpacity: 0,
        }}
      />
      <Marker
        position={[lat, lng]}
        icon={pinIcon({ glyph: t.glyph, color: t.color, scale: t.scale })}
        draggable
        riseOnHover
        eventHandlers={{
          dragend: (e) => {
            const { lat: la, lng: ln } = e.target.getLatLng();
            onDeplacer([ln, la]);
          },
        }}
      >
        <Tooltip direction="top" permanent>
          Emplacement provisoire — à confirmer
        </Tooltip>
      </Marker>
    </LayerGroup>
  );
}

const champCoord =
  'w-28 rounded-lg border border-white/12 bg-white/6 px-2 py-1.5 text-[12px] text-white ' +
  'placeholder:text-white/30 focus:border-gr-gold/60 focus:outline-none';

/**
 * Barre flottante des phases 2 et 3 de la création d'un point noir : les
 * coordonnées GPS sont saisissables à la main (bouton « Localiser », en plus
 * du clic sur la carte) et toujours affichées avant tout envoi au serveur —
 * la confirmation ne porte jamais sur une position invisible.
 */
function PositionPointNoirBarre({
  position,
  occupe,
  saisie,
  type = 'accident',
  regions,
  regionApercu,
  onApercevoirRegion,
  onEffacerApercu,
  onLocaliser,
  onAnnuler,
  onConfirmer,
  doublon,
  onOuvrirDoublon,
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');

  // La position (clic carte ou glissement du repère provisoire) recopie les
  // champs : ils restent la représentation affichée même sans saisie manuelle.
  useEffect(() => {
    if (position) {
      setLat(position[1].toFixed(5));
      setLng(position[0].toFixed(5));
    }
  }, [position]);

  const localiser = () => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180)
      return;
    onLocaliser([ln, la]);
  };

  /** Rappel de ce qui a été qualifié à l'étape 1 — le contexte ne se perd pas en route. */
  const libelleOption = (liste, code) => liste.find((o) => o.code === code)?.fr ?? code;
  const resumeSaisie = saisie
    ? [
      `${saisie.accidentCount ?? 0} accident(s)`,
      saisie.severite && saisie.severite !== 'none'
        ? libelleOption(MQ.SEVERITES, saisie.severite)
        : null,
      saisie.positionVille && saisie.positionVille !== 'none'
        ? libelleOption(MQ.POSITIONS_VILLE, saisie.positionVille)
        : null,
    ]
      .filter(Boolean)
      .join(' · ')
    : null;

  return (
    <div className="absolute inset-x-0 bottom-6 z-[1050] flex flex-col items-center gap-1.5 px-3">
      {resumeSaisie && (
        <p className="flex items-center gap-1.5 rounded-full bg-gr-gold/15 px-3 py-1 text-[10px] font-semibold text-gr-gold">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-gr-gold/70">
            Étape 2/2
          </span>
          Point noir qualifié — {resumeSaisie}
        </p>
      )}
      {!saisie && (
        <p className="flex items-center gap-1.5 rounded-full bg-gr-gold/15 px-3 py-1 text-[10px] font-semibold text-gr-gold">
          {MQ.TYPE_PAR_CLE[type]?.fr ?? type} — à confirmer
        </p>
      )}

      {/* Doublon probable : un marquage de même catégorie existe déjà tout
          près (< 50 m) — on prévient plutôt que d'empiler deux repères
          identiques, sans empêcher le chef de confirmer quand même s'il sait
          ce qu'il fait (deux événements distincts au même endroit, à des
          dates différentes, restent possibles). */}
      {doublon && (
        <div className="flex max-w-lg items-center gap-2 rounded-2xl border border-gr-red/40 bg-gr-red/15 px-4 py-2 text-[11px] leading-snug text-white/90 shadow-panel backdrop-blur-md">
          <IconAlert size={15} className="shrink-0 text-gr-red" />
          <span className="min-w-0 flex-1">
            {MQ.TYPE_PAR_CLE[doublon.m.type]?.fr ?? doublon.m.type} déjà présent à{' '}
            {RT.formatKm(doublon.distanceM / 1000)} de ce point
            {doublon.m.nom || doublon.m.route ? ` (${doublon.m.nom || doublon.m.route})` : ''}.
          </span>
          <button
            type="button"
            onClick={() => onOuvrirDoublon(doublon.m)}
            className="shrink-0 rounded-lg bg-white/10 px-2 py-1 font-semibold text-white/85 hover:bg-white/16"
          >
            Ouvrir
          </button>
        </div>
      )}

      {/* Aperçu d'une région : isole visuellement la zone choisie (le reste
          s'assombrit) pour mieux voir où cliquer — n'accorde aucune autorité
          d'écriture, seul le périmètre de la session en donne. */}
      {regions?.length > 0 && (
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-gr-navy/95 px-4 py-2 shadow-panel backdrop-blur-md">
          <span className="text-[11px] text-white/60">Visualiser une région</span>
          <select
            className={champCoord}
            style={{ width: '11rem' }}
            value={regionApercu?.nom ?? ''}
            onChange={(e) =>
              e.target.value ? onApercevoirRegion(e.target.value) : onEffacerApercu()
            }
          >
            <option value="">— aucune —</option>
            {regions.map((nom) => (
              <option key={nom} value={nom}>
                {nom}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-gr-navy/95 px-4 py-2.5 shadow-panel backdrop-blur-md">
        <span className="text-[12px] font-semibold text-white/80">
          {position
            ? `Emplacement — ${MQ.TYPE_PAR_CLE[type]?.fr ?? type}`
            : 'Cliquez sur la carte, ou saisissez des coordonnées GPS'}
        </span>

        <input
          type="number"
          step="0.00001"
          placeholder="Latitude"
          aria-label="Latitude"
          value={lat}
          onChange={(e) => setLat(e.target.value)}
          className={champCoord}
        />
        <input
          type="number"
          step="0.00001"
          placeholder="Longitude"
          aria-label="Longitude"
          value={lng}
          onChange={(e) => setLng(e.target.value)}
          className={champCoord}
        />
        <button
          type="button"
          onClick={localiser}
          className={`${bouton} bg-white/10 text-white/85 hover:bg-white/16`}
        >
          <IconTarget size={14} /> Localiser
        </button>

        <button
          type="button"
          onClick={onAnnuler}
          className={`${bouton} bg-white/10 text-white/80 hover:bg-white/16`}
        >
          Annuler
        </button>

        {position && (
          <button
            type="button"
            onClick={onConfirmer}
            disabled={occupe}
            className={`${bouton} ${doublon ? 'bg-gr-red text-white hover:brightness-110' : 'bg-gr-gold text-gr-navy hover:brightness-110'} disabled:opacity-40`}
          >
            {occupe ? <IconSpinner size={14} /> : <IconPlus size={14} />}
            {doublon ? 'Confirmer quand même' : "Confirmer l'emplacement"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * LA COMPOSITION D'UN BARRAGE VIP — quatre hommes, nommés avant la création.
 *
 * POURQUOI CET ÉCRAN S'INTERCALE. Un barrage ordinaire se pose d'un clic et se
 * garnit ensuite : ses relèves arrivent par la préparation du roster ou par la
 * saisie de terrain. Un VIP, lui, n'existe pas sans sa faction — c'est la
 * règle, et elle serait fausse pendant tout le temps où le poste attendrait
 * ses hommes. Le poste et sa faction partent donc dans le même envoi, et le
 * serveur défait le poste si l'un des quatre est refusé.
 *
 * POURQUOI L'EFFECTIF VIENT D'UNE ROUTE DÉDIÉE. La question posée ici est
 * « j'ai pointé cet endroit, qui puis-je y mettre ? », et elle se pose avant
 * que le poste existe. Le roster répond à l'autre question — « qui tient les
 * postes de cette brigade ? » — et exige qu'elle en ait déjà. Sur un
 * dispositif neuf, il n'aurait rien à dire.
 *
 * CEUX QUI SONT DÉJÀ PRIS SONT MONTRÉS, ET GRISÉS. Les masquer aurait été plus
 * simple et moins honnête : un chef qui cherche un homme précis doit voir
 * qu'il est engagé ailleurs, et non le croire absent de l'effectif.
 */
function CompositionVIPModal({ position, occupe, onAnnuler, onValider }) {
  const [lieu, setLieu] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [choisis, setChoisis] = useState([]);
  const [filtre, setFiltre] = useState('');

  useEffect(() => {
    let vivant = true;
    setLieu(null);
    setErreur(null);
    setChoisis([]);
    API.effectifAuPoint(position[0], position[1]).then(
      (r) => vivant && setLieu(r),
      (e) => vivant && setErreur(e?.message || 'Effectif indisponible à cet endroit.'),
    );
    return () => {
      vivant = false;
    };
  }, [position]);

  const attendus = lieu?.attendus ?? 4;
  const occupes = useMemo(() => new Set(lieu?.occupes ?? []), [lieu]);

  const effectif = useMemo(() => {
    const tous = lieu?.effectif ?? [];
    const q = filtre.trim().toLowerCase();
    if (!q) return tous;
    return tous.filter(
      (p) =>
        String(p.nom ?? '').toLowerCase().includes(q) ||
        String(p.matricule ?? '').toLowerCase().includes(q),
    );
  }, [lieu, filtre]);

  const basculer = (p) => {
    setChoisis((prev) => {
      const deja = prev.some((x) => x.matricule === p.matricule);
      if (deja) return prev.filter((x) => x.matricule !== p.matricule);
      /* On ne dépasse pas : le bouton refuserait de toute façon, et laisser
         cocher un cinquième nom pour l'annoncer ensuite est un geste perdu. */
      if (prev.length >= attendus) return prev;
      return [...prev, { grade: p.grade, nom: p.nom, matricule: p.matricule }];
    });
  };

  const complet = choisis.length === attendus;

  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[86vh] flex flex-col rounded-2xl border border-white/12 bg-gr-navy shadow-panel">
        <div className="px-4 pt-4 pb-3 border-b border-white/10">
          <p className="text-[13px] font-bold text-white/90">Composition du barrage VIP</p>
          <p className="text-[11px] text-white/55 mt-0.5 leading-snug">
            Un barrage VIP est tenu par <b className="text-white/80">exactement {attendus} éléments</b>.
            La position pointée sur la carte est définitive, et la faction ne sera pas réaffectée
            par la filtration.
          </p>
          {lieu && (
            <p className="text-[11px] text-white/45 mt-1">
              Brigade {lieu.bt}
              {lieu.cie ? ` · Cie ${lieu.cie}` : ''}
              {lieu.reg ? ` · ${lieu.reg}` : ''}
            </p>
          )}
        </div>

        {erreur && (
          <p className="m-4 rounded-xl border border-gr-red/40 bg-gr-red/10 px-3 py-2 text-[11.5px] text-gr-red">
            {erreur}
          </p>
        )}

        {!lieu && !erreur && (
          <p className="p-6 text-center text-[12px] text-white/50">Chargement de l’effectif…</p>
        )}

        {lieu && (
          <>
            <div className="px-4 pt-3">
              <input
                type="search"
                value={filtre}
                onChange={(e) => setFiltre(e.target.value)}
                placeholder="Rechercher un nom ou un matricule"
                className="w-full rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-[12px] text-white/90 placeholder:text-white/35 outline-none focus:border-gr-gold/50"
              />
            </div>

            <ul className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
              {effectif.length === 0 && (
                <li className="py-6 text-center text-[11.5px] text-white/45">
                  Aucun élément dans l’effectif de cette brigade.
                </li>
              )}
              {effectif.map((p) => {
                const pris = occupes.has(p.matricule);
                const coche = choisis.some((x) => x.matricule === p.matricule);
                const plein = complet && !coche;
                return (
                  <li key={p.matricule}>
                    <button
                      type="button"
                      disabled={pris || plein}
                      onClick={() => basculer(p)}
                      className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${coche
                          ? 'border-gr-gold/45 bg-gr-gold/10'
                          : 'border-white/10 bg-white/4 hover:bg-white/8'
                        } disabled:opacity-35 disabled:hover:bg-white/4`}
                    >
                      <span
                        className={`shrink-0 size-4 rounded border ${coche ? 'border-gr-gold bg-gr-gold' : 'border-white/30'
                          }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-white/90">
                          {p.nom}
                        </span>
                        <span className="block truncate text-[10px] text-white/45">
                          {p.grade} · {p.matricule}
                          {pris ? ' · déjà engagé sur ce créneau' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="px-4 py-3 border-t border-white/10 space-y-2">
              <p
                className={`text-center text-[11.5px] font-bold ${complet ? 'text-gr-green' : 'text-white/60'
                  }`}
              >
                {choisis.length} / {attendus} élément(s) choisi(s)
                {complet ? ' — composition complète' : ''}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onAnnuler}
                  disabled={occupe}
                  className="flex-1 rounded-xl border border-white/15 bg-white/8 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/14 disabled:opacity-40"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => onValider(choisis)}
                  disabled={!complet || occupe}
                  className="flex-1 rounded-xl bg-gr-gold py-2 text-[12px] font-bold text-gr-navy hover:brightness-110 disabled:opacity-40"
                >
                  {occupe ? 'Création…' : 'Créer le barrage VIP'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * LA FACTION SE NOMME, ELLE NE S'HORODATE PAS — à l'affichage seulement.
 * Une observation saisie « Faction 4 (18h00 → 00h00) » se lit « Faction 4 » :
 * la donnée, elle, reste telle qu'elle a été écrite.
 */
const sansHorairesFaction = (texte) =>
  String(texte ?? '').replace(/(Faction\s+\w+)\s*\(\s*\d{1,2}\s*h\s*\d{2}\s*(?:→|->|-|à)\s*\d{1,2}\s*h\s*\d{2}\s*\)/gi, '$1');

/** Rien — gestionnaire stable quand aucun clic n'est attendu. */
const rienAFaire = () => { };

/** Capte le clic carte pendant la pose d'un marquage. */
function CaptureClic({ actif, onClic }) {
  useMapEvents({
    click: (e) => {
      if (actif) onClic([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

/**
 * UN CLIC À CÔTÉ REPLIE LA SECTION OUVERTE.
 *
 * Même geste qu'Échap (voir `panneauOuvert`), mais à la souris : c'est ce
 * qu'on essaie d'instinct quand un panneau gêne la vue — cliquer sur la carte,
 * plutôt que viser la croix en haut du panneau alors que le regard est
 * ailleurs. Rien n'est perdu au passage : chaque panneau reste MONTÉ et
 * retrouve sa saisie à la réouverture.
 *
 * C'est le clic CARTE de Leaflet, et non un gestionnaire posé sur le document.
 * Lui seul distingue déjà, sans que rien n'ait à être énuméré ici :
 *   — le fond de carte d'un contour, d'un repère ou d'une infobulle : cliquer
 *     une circonscription OUVRE l'analyse, cliquer un repère ouvre sa fiche —
 *     un `click` sur le document, lui, aurait refermé dans le même geste le
 *     panneau que ce clic venait d'ouvrir ;
 *   — un clic d'un GLISSEMENT de la carte : déplacer la vue ne referme rien ;
 *   — la carte des boutons, panneaux, commandes de zoom et modales, qui sont
 *     tous hors de la carte.
 *
 * `actif` est faux dès qu'un outil attend un clic carte : le clic appartient
 * alors à l'outil (voir `CaptureClic`), et le panneau qui l'a armé doit rester
 * sous les yeux jusqu'à la validation.
 */
/**
 * « JE SUIS ICI » — LE REPÈRE QU'ON VIENT DE DÉSIGNER.
 *
 * Un seul geste, quel qu'en soit le point de départ : la carte se déplace, et
 * l'endroit se signale de lui-même. Sans cela, cadrer sur un poste laisse
 * l'utilisateur devant une carte recentrée où il lui reste à retrouver lequel
 * des vingt repères visibles est le sien — le travail n'est qu'à moitié fait.
 *
 * CE N'EST PAS UN SECOND MARQUEUR. Aucune donnée, aucune coordonnée, aucun
 * repère n'est créé : c'est une décoration posée à la même position, sans
 * interaction (`interactive={false}`), sous le vrai repère
 * (`zIndexOffset` négatif) pour ne jamais le masquer ni voler son clic.
 *
 * DEUX TEMPS, parce qu'ils répondent à deux questions différentes :
 *
 *   1. l'ONDE et l'ÉTIQUETTE, deux secondes et demie — « où est-ce ? » ;
 *   2. l'ANNEAU calme, tant que le poste reste sélectionné — « lequel
 *      est-ce, déjà ? », question qu'on se repose en travaillant.
 *
 * Le battement s'arrête ; s'il ne s'arrêtait pas, il cesserait d'être un
 * signal et se confondrait avec les repères qui, eux, battent pour dire
 * qu'une décision est attendue.
 */
const DUREE_ONDE_MS = 2600;

function CibleLayer({ cible }) {
  const [onde, setOnde] = useState(true);

  /* Relancé par `ts` et pas seulement par `id` : redésigner le MÊME poste doit
     rejouer l'animation. C'est précisément le cas où l'utilisateur cherche à
     se confirmer qu'il ne s'est pas trompé. */
  useEffect(() => {
    if (!cible) return undefined;
    setOnde(true);
    const t = setTimeout(() => setOnde(false), DUREE_ONDE_MS);
    return () => clearTimeout(t);
  }, [cible?.id, cible?.ts]);

  if (!cible || cible.lat == null || cible.lng == null) return null;

  const etiquette =
    onde && cible.nom
      ? `<span class="gr-ici-etiquette">${String(cible.nom).replace(
        /[&<>"]/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
      )}</span>`
      : '';

  return (
    <Marker
      /* La clé force un montage neuf : une animation CSS ne se rejoue pas sur
         un élément déjà présent, elle se rejoue sur un élément qui naît. */
      key={`${cible.id}-${cible.ts}`}
      position={[cible.lat, cible.lng]}
      interactive={false}
      keyboard={false}
      zIndexOffset={-500}
      icon={divIconStable({
        className: '',
        html:
          `<div class="gr-ici${onde ? ' gr-ici-actif' : ''}" aria-hidden="true">` +
          '<span class="gr-ici-onde"></span>' +
          '<span class="gr-ici-onde gr-ici-onde-b"></span>' +
          '<span class="gr-ici-anneau"></span>' +
          etiquette +
          '</div>',
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      })}
    />
  );
}

/**
 * SIGNALE À LA SCÈNE QU'UNE BULLE EST OUVERTE.
 *
 * La barre de recherche recouvre les bulles ouvertes près du haut de l'écran,
 * et aucun réglage de z-index ne peut l'en empêcher (voir le commentaire dans
 * index.css). Elle s'efface donc le temps de la lecture : entre lire qui tient
 * un poste et garder un champ de recherche vide à l'écran, le choix est vite
 * fait.
 */
function SuiviBulle({ onChangement }) {
  useMapEvents({
    /**
     * LA BULLE GRANDIT APRÈS S'ÊTRE OUVERTE, ET IL FAUT LA SUIVRE.
     *
     * C'est ce qui faisait échouer les corrections précédentes. À l'ouverture,
     * le bloc effectif affiche « Chargement de l'effectif… » : la bulle mesure
     * deux cents pixels, elle tient partout, on ne corrige rien. La réponse
     * arrive cent millisecondes plus tard, six lignes de personnel
     * s'ajoutent — et comme Leaflet ancre une bulle par le BAS, elle grandit
     * vers le HAUT et sort de l'écran. Le placement était juste ; il portait
     * sur une bulle qui n'existait déjà plus.
     *
     * On la replace donc à chaque changement de contenu, pas seulement à
     * l'ouverture.
     */
    popupopen: (e) => {
      onChangement(true);
      const carte = e.target;
      const bulle = e.popup;
      placer(carte, bulle);

      const contenu = bulle._contentNode;
      if (!contenu || typeof ResizeObserver === 'undefined') return;

      /**
       * On se fie à `scrollHeight`, la hauteur du CONTENU, et non à la
       * hauteur affichée : `placer` pose lui-même une borne qui change la
       * seconde sans toucher à la première. Sans cette distinction, chaque
       * correction en déclencherait une autre, sans fin.
       */
      let derniere = contenu.scrollHeight;
      const observateur = new ResizeObserver(() => {
        const h = contenu.scrollHeight;
        if (h === derniere) return;
        derniere = h;
        placer(carte, bulle);
      });
      observateur.observe(contenu);
      bulle.gr_observateur = observateur;
    },

    popupclose: (e) => {
      onChangement(false);
      e.popup?.gr_observateur?.disconnect();
      if (e.popup) delete e.popup.gr_observateur;
    },
  });
  return null;
}

/** Hauteur de la pointe d'une bulle Leaflet — voir .leaflet-popup-tip-container. */
const HAUTEUR_POINTE = 19;

/** Marge entre le bord de la carte et la bulle. */
const MARGE_BULLE = 12;

/**
 * OUVRIR LA BULLE SOUS LE REPÈRE QUAND IL N'Y A PAS LA PLACE DESSUS.
 *
 * Leaflet ancre toujours ses bulles au-dessus du marqueur, et compte sur un
 * déplacement automatique de la carte pour les ramener dans le cadre. Ce
 * recours ne fonctionne pas ici : `maxBounds` avec une viscosité de 1 arrête
 * net la carte au bord du territoire (voir BORNES_MAROC). Un barrage de Tanger
 * est donc collé au haut de l'écran, la carte refuse de descendre, et la bulle
 * — devenue haute depuis qu'elle porte l'effectif — sort par le haut.
 *
 * On la retourne alors sous le repère. Le décalage vaut sa hauteur plus la
 * distance à l'ancre : elle se retrouve exactement de l'autre côté.
 *
 * La hauteur ne se connaît qu'une fois la bulle rendue — d'où la lecture de
 * son conteneur après ouverture, plutôt qu'un calcul a priori.
 */
/**
 * LA BULLE RESTE ENTIÈREMENT VISIBLE, où que soit le repère.
 *
 * ON MESURE, ON NE MODÉLISE PAS. Deux tentatives ont échoué à reproduire le
 * calcul interne de Leaflet — ancre de l'icône, décalage de la bulle, hauteur
 * rendue, animation de zoom. Ici on rend la bulle, on lit le rectangle qu'elle
 * occupe vraiment, et on la déplace de ce qui manque. Quelle que soit la
 * mécanique interne, le résultat est juste.
 *
 * Quatre temps :
 *   1. état neutre, sans borne — on découvre la hauteur voulue ;
 *   2. bornée à la hauteur du cadre si elle ne peut pas y tenir ;
 *   3. basculée SOUS le repère si elle déborde en haut et que le bas suffit ;
 *   4. poussée dans le cadre pour ce qui dépasse encore, verticalement comme
 *      horizontalement.
 *
 * AUCUNE COORDONNÉE DE BARRAGE N'EST TOUCHÉE : on ne change que le décalage
 * d'affichage de la bulle.
 */
function placer(carte, bulle) {
  const boite = bulle?._container;
  if (!carte || !boite) return;

  /* L'option `offset` de Leaflet vaut par défaut le TABLEAU [0, 7], pas
     un Point : lire `.x` dessus rend `undefined`, et `L.point(undefined, n)`
     rend `undefined` à son tour. On normalise à la lecture. */
  const base = L.point(bulle.options.gr_offsetInitial ?? bulle.options.offset ?? [0, 0]);
  bulle.options.gr_offsetInitial = base;

  const cadre = carte.getContainer().getBoundingClientRect();

  /* 1 — état neutre : au-dessus, sans borne, sans déplacement de carte. */
  bulle.options.autoPan = false;
  bulle.options.maxHeight = 0;
  bulle.options.offset = base;
  boite.classList.remove('gr-popup-dessous', 'gr-popup-libre');
  bulle.update();

  /* 2 — plus haute que le cadre : on la borne, Leaflet fera défiler dedans. */
  const dispo = cadre.height - 2 * MARGE_BULLE;
  if (boite.offsetHeight > dispo) {
    bulle.options.maxHeight = Math.max(160, Math.floor(dispo));
    bulle.update();
  }

  let r = boite.getBoundingClientRect();

  /* 3 — bascule sous le repère : seulement si elle déborde en haut ET que
         la place en dessous suffit. Sinon on la laisse où elle est et
         l'étape 4 la ramènera. */
  const ancre = cadre.top + carte.latLngToContainerPoint(bulle.getLatLng()).y;
  if (r.top < cadre.top + MARGE_BULLE) {
    const jeu = Math.max(0, ancre - r.bottom);
    if (ancre + jeu + r.height <= cadre.bottom - MARGE_BULLE) {
      bulle.options.offset = L.point(base.x, base.y + r.height + 2 * jeu);
      boite.classList.add('gr-popup-dessous');
      bulle.update();
      r = boite.getBoundingClientRect();
    }
  }

  /* 4 — ce qui dépasse encore est simplement poussé dedans. La bulle quitte
         alors son ancrage : on masque la pointe, qui ne désignerait plus le
         repère (voir .gr-popup-libre). */
  /**
   * LA POINTE COMPTE DANS L'ENCOMBREMENT.
   *
   * Elle est en position absolue : `getBoundingClientRect` ne la voit pas.
   * Haute de 19 px, elle dépasse sous la bulle quand celle-ci est au-dessus du
   * repère, et au-dessus quand elle est en dessous. Recadrer sans elle la
   * laisserait sortir du cadre — un détail de sept pixels, mais visible.
   */
  const dessous = boite.classList.contains('gr-popup-dessous');
  const avecPointe = {
    left: r.left,
    right: r.right,
    top: dessous ? r.top - HAUTEUR_POINTE : r.top,
    bottom: dessous ? r.bottom : r.bottom + HAUTEUR_POINTE,
  };

  const { dx, dy } = pousserDedans(avecPointe, cadre, MARGE_BULLE);
  if (dx || dy) {
    const actuel = L.point(bulle.options.offset ?? [0, 0]);
    bulle.options.offset = L.point(actuel.x + dx, actuel.y + dy);
    boite.classList.add('gr-popup-libre');
    bulle.update();
  }
}

/** Le prochain clic sur la carte désigne un point — pour « Modifier barrage ». */
function ChoixPointCarte({ actif, onPoint }) {
  const map = useMapEvents({
    click: (e) => {
      if (actif) onPoint(e.latlng.lng, e.latlng.lat);
    },
  });
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = actif ? 'crosshair' : '';
    return () => {
      el.style.cursor = '';
    };
  }, [actif, map]);
  return null;
}

/**
 * LE CLIC DE PLACEMENT — écouté sur le conteneur de la carte lui-même.
 *
 * Le `click` de Leaflet n’arrive pas toujours à la carte : un contour de zone ou
 * un tracé interactif dessiné sur le canevas le garde pour lui. Pour choisir une
 * position, tout point du fond doit compter — sauf une bulle, une épingle ou un
 * contrôle, et sauf la fin d’un glisser (déplacer la vue n’est pas choisir).
 */
function ChoixPointLibre({ actif, onPoint }) {
  const map = useMap();
  useEffect(() => {
    if (!actif) return undefined;
    const el = map.getContainer();
    let depart = null;
    const bas = (e) => { depart = [e.clientX, e.clientY]; };
    const clic = (e) => {
      if (e.target.closest('.leaflet-popup, .leaflet-marker-icon, .leaflet-control, [data-gr-placement-simulation]')) return;
      if (depart && Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 5) return;
      /* Le clic est consommé ici : il ne doit rien ouvrir d’autre en dessous. */
      e.stopPropagation();
      const p = map.mouseEventToLatLng(e);
      onPoint(p.lng, p.lat);
    };
    el.style.cursor = 'crosshair';
    el.addEventListener('mousedown', bas, true);
    el.addEventListener('click', clic, true);
    return () => {
      el.style.cursor = '';
      el.removeEventListener('mousedown', bas, true);
      el.removeEventListener('click', clic, true);
    };
  }, [actif, map, onPoint]);
  return null;
}

function FermerAuClicCarte({ actif, onFermer }) {
  useMapEvents({
    click: () => {
      if (actif) onFermer();
    },
  });
  return null;
}

/** Expose l'instance Leaflet au parent (cadrage depuis le panneau). */
function ExposeCarte({ cible }) {
  const map = useMap();

  useEffect(() => {
    cible.current = map;
    return () => {
      cible.current = null;
    };
  }, [map, cible]);

  return null;
}

/* ================================================================== */
/* Liaisons de proximité <= 5 km                                       */
/* ================================================================== */

/** Distance géodésique en km, injectée dans `computeProximity`. */
const distanceKm = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' });

/**
 * Trace les paires trop rapprochées. Les paires dont les zones d'action se
 * recoupent sont en trait plein et plus épais — la redondance de couverture
 * est ainsi lisible sans dépendre de la couleur.
 */
function ProximityLayer({ prox, color }) {
  if (!prox) return null;

  return (
    <LayerGroup>
      {prox.paires.map((p) => (
        <Polyline
          key={p.id}
          positions={p.positions}
          pathOptions={{
            color,
            weight: p.secant ? 3 : 2,
            dashArray: p.secant ? undefined : '5, 5',
          }}
        >
          <Tooltip sticky>
            {p.km.toFixed(2)} km{p.secant ? ' — zones sécantes' : ''}
          </Tooltip>
          <Popup>
            <div className="gr-popup">
              <h4>{p.km.toFixed(2)} km</h4>
              <table className="gr-tbl">
                <tbody>
                  <tr>
                    <td>De</td>
                    <td>{p.a.nom}</td>
                  </tr>
                  <tr>
                    <td>À</td>
                    <td>{p.b.nom}</td>
                  </tr>
                  {p.a.props.reg && (
                    <tr>
                      <td>Région</td>
                      <td>{p.a.props.reg}</td>
                    </tr>
                  )}
                  <tr>
                    <td>Zones</td>
                    <td>{p.secant ? 'sécantes' : 'disjointes'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Popup>
        </Polyline>
      ))}
    </LayerGroup>
  );
}

/* ================================================================== */
/* Carte                                                              */
/* ================================================================== */

export default function GendarmerieMap({ session: sessionInit, onLogout, mode = null }) {
  const [store, load] = useGeoJsonStore();

  /**
   * État réel du fond de carte : null tant qu'aucune tuile n'a répondu,
   * true dès la première tuile reçue, false si le serveur renvoie une erreur.
   * Évite d'afficher un fond noir sans explication.
   */
  const [tilesOk, setTilesOk] = useState(null);
  /** Niveau de zoom courant — pilote l'état des boutons + / − (voir CommandesZoom). */
  const [zoomActuel, setZoomActuel] = useState(INITIAL_VIEW.zoom);

  /* Le thème du COMPTE connecté — retrouvé à chaque reconnexion (voir theme.js).
     Le matricule ne change pas pendant une session : la prop suffit. */
  const { theme, apparence, choisir: choisirTheme } = useTheme(sessionInit?.matricule ?? null);

  /**
   * MODE FOCUS — la carte seule. Le rail, la barre de commandement, les
   * filtres, la légende et les panneaux s'effacent (masqués, pas démontés :
   * ils reviennent dans l'état où on les a laissés) ; le zoom, la boussole
   * et toutes les interactions de la carte restent. « F » bascule, Échap sort.
   */
  const [modeFocus, setModeFocus] = useState(false);
  useEffect(() => {
    const auClavier = (e) => {
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape' && modeFocus) {
        setModeFocus(false);
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) setModeFocus((v) => !v);
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [modeFocus]);
  const [niveauCluster, setNiveauCluster] = useState(() =>
    determinerNiveauHierarchie(INITIAL_VIEW.zoom),
  );
  const [idsBarragesCompagnie, setIdsBarragesCompagnie] = useState(null);

  /**
   * TAILLE DE L'INTERFACE — accessibilité.
   *
   * Les panneaux sont écrits en 10 à 12 px : dense et lisible pour qui passe
   * ses journées sur un écran, illisible pour beaucoup d'autres. Le réglage
   * agit par `zoom` sur les conteneurs de panneaux, ce qui agrandit le texte
   * ET les zones cliquables dans la même proportion — augmenter la seule
   * police laisserait des boutons trop petits pour un doigt ou une main peu
   * assurée à la souris.
   *
   * La carte n'est pas zoomée : elle a déjà ses propres commandes.
   * Le choix est mémorisé par poste.
   */
  const [echelleUI, setEchelleUI] = useState(() => {
    const v = Number(localStorage.getItem('gr-echelle-ui'));
    return Number.isFinite(v) && v >= 1 && v <= 1.6 ? v : 1;
  });
  const changerEchelle = useCallback((delta) => {
    setEchelleUI((v) => {
      const suivant = Math.min(1.6, Math.max(1, Math.round((v + delta) * 100) / 100));
      localStorage.setItem('gr-echelle-ui', String(suivant));
      return suivant;
    });
  }, []);

  /**
   * POSITION LIBRE DE LA LÉGENDE — `null` tant qu'on ne l'a pas déplacée.
   *
   * Tant qu'elle vaut `null`, la légende reste dans la colonne du bas à gauche
   * avec les autres cartouches ; au premier glissement elle s'en détache et
   * devient flottante. Le réglage par défaut est donc l'absence de réglage.
   */
  /**
   * DÉPLACEMENT D'UN REPÈRE : armement, clic, aperçu, puis enregistrement.
   *
   * `armeDeplacement` — l'identifiant du seul repère en cours de déplacement,
   * armé depuis sa bulle (« Déplacer ») ou depuis « Modifier barrage ». Le
   * prochain clic sur la carte désigne sa nouvelle position.
   *
   * `demandeDeplacement` — la position proposée : `{ id, clic }`, puis, une
   * fois calculée sur le réseau routier, `point` (recalé), `route`, `km`
   * (distance routière depuis l'ancienne position) et `territoire`. Le repère
   * est DESSINÉ à `point` tant qu'elle existe ; rien n'a été envoyé au
   * serveur avant « Enregistrer la nouvelle position ».
   */
  const [armeDeplacement, setArmeDeplacement] = useState(null);
  /* Le bilan de la DERNIÈRE réévaluation après un déplacement (CarteReevaluation). */
  const [reevaluation, setReevaluation] = useState(null);
  const demandeDeplacementNo = useRef(0);
  const [demandeDeplacement, setDemandeDeplacement] = useState(null);
  /**
   * « TRAITER » — un geste vient d'être fait sur ces barrages (effacer,
   * déplacer, changer la faction) : les conflits qui les touchent sont
   * remesurés, et eux seuls (voir OptimisationRoutePanel). Même quand le
   * serveur a mis le geste en validation : le statut du conflit change.
   */
  const [traitement, setTraitement] = useState(null);
  const signalerTraitement = useCallback((id) => setTraitement({ ids: [].concat(id), n: Date.now() }), []);
  /** « Assigner au CMND Région » : les barrages dont la boîte est ouverte (Super Admin). */
  const [assignation, setAssignation] = useState(null);
  /**
   * LES ASSIGNATIONS DU COMPTE (AssignationsPanel) — combien sont à traiter,
   * et celle dont on traite la faction (boîte ChangerFaction en mode assignation).
   */
  const [assignationsATraiter, setAssignationsATraiter] = useState(0);
  const [traitementAssignation, setTraitementAssignation] = useState(null);
  const [versionAssignations, setVersionAssignations] = useState(0);
  const [demandesEnAttente, setDemandesEnAttente] = useState(0);
  const [versionDemandes, setVersionDemandes] = useState(0);
  const [conflitAnalysePreTraitement, setConflitAnalysePreTraitement] = useState(null);

  /** « Traiter → Changer la faction » : le barrage dont la boîte est ouverte. */
  const [factionBarrage, setFactionBarrage] = useState(null);
  const [deplacementEnCours, setDeplacementEnCours] = useState(false);

  /**
   * « MODIFIER BARRAGE » — le formulaire dédié (components/map/ModifierBarrage) :
   * effectif et protection. Son bouton « Déplacer » passe par le mode
   * déplacement ci-dessus, le seul chemin de déplacement.
   */
  const [editionBarrageId, setEditionBarrageId] = useState(null);
  /* Le compte rendu de l'enregistrement. Les messages de saisie ne s'affichent
     que panneau « Saisie » ouvert ; on modifie ici depuis la carte, panneau
     fermé : sans ce message, l'enregistrement passerait sans aucun signe. */
  const [messageEdition, setMessageEdition] = useState(null);
  useEffect(() => {
    if (!messageEdition) return undefined;
    const t = setTimeout(() => setMessageEdition(null), 7000);
    return () => clearTimeout(t);
  }, [messageEdition]);

  const [posLegende, setPosLegende] = useState(positionEnregistree);
  const [legendeOuverte, setLegendeOuverte] = useState(() => {
    try {
      return sessionStorage.getItem('gr-legende-carte') === '1';
    } catch {
      return false;
    }
  });
  const changerLegende = useCallback((ouverte) => {
    setLegendeOuverte(ouverte);
    try {
      sessionStorage.setItem('gr-legende-carte', ouverte ? '1' : '0');
    } catch {
      /* Le choix reste valable pour la session React courante. */
    }
  }, []);

  const deplacerLegende = (pos, definitif) => {
    setPosLegende(pos);
    if (!definitif) return;
    try {
      localStorage.setItem(CLE_LEGENDE_POSITION, JSON.stringify(pos));
    } catch {
      /* stockage indisponible : la position vaut pour cette session */
    }
  };

  /**
   * LA LÉGENDE NE PEUT PAS SE PERDRE.
   *
   * Une position enregistrée hier sur un grand écran tomberait hors cadre sur
   * un poste plus étroit — et avec elle le bouton qui la remet en place. On la
   * ramène donc dans la scène à chaque redimensionnement, en laissant toujours
   * de quoi la saisir : un cartouche qu'on ne peut plus attraper est perdu,
   * même s'il est techniquement encore là.
   */
  useEffect(() => {
    if (!posLegende) return undefined;
    const borner = () => {
      const scene = document.querySelector('[data-gr-scene]')?.getBoundingClientRect();
      if (!scene) return;
      /* De quoi voir la poignée et le titre, pas davantage : on ne repositionne
         pas, on empêche seulement la disparition. */
      const maxX = Math.max(0, scene.width / echelleUI - 72);
      const maxY = Math.max(0, scene.height / echelleUI - 34);
      /**
       * ET UNE BORNE À GAUCHE, que la colonne de navigation impose.
       *
       * La borne ne retenait que le bas et la droite. On pouvait donc lâcher
       * la légende SUR le rail (12 → 72 px) : elle y disparaissait derrière
       * lui, tronquée, exactement comme la version rangée l'était avant
       * correction. `MARGE_RAIL` vaut le `left-3` des trois colonnes de
       * gauche — la même valeur, pour la même raison (le rail permanent n'est
       * plus : il ne reste que la marge).
       *
       * Appliqué au montage : une position enregistrée hier derrière le rail
       * se corrige toute seule à l'ouverture, sans que personne ait à vider
       * son stockage local.
       */
      const MARGE_RAIL = 12;
      const minX = Math.min(MARGE_RAIL, maxX);
      setPosLegende((p) => {
        if (!p) return p;
        const x = Math.min(Math.max(p.x, minX), maxX);
        const y = Math.min(Math.max(p.y, 0), maxY);
        return x === p.x && y === p.y ? p : { x, y };
      });
    };
    borner();
    window.addEventListener('resize', borner);
    return () => window.removeEventListener('resize', borner);
  }, [posLegende, echelleUI]);

  const rangerLegende = () => {
    setPosLegende(null);
    try {
      localStorage.removeItem(CLE_LEGENDE_POSITION);
    } catch {
      /* rien à faire : l'oubli est le comportement voulu */
    }
  };

  const [active, setActive] = useState(
    () => new Set(ALL_LAYERS.filter((l) => l.defaultOn).map((l) => l.key)),
  );

  const toggleLayer = useCallback((key) => {
    setActive((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  /** Résout l'URL du fichier qui alimente une couche. */
  const urlFor = useCallback((dataKey) => {
    const owner = ALL_LAYERS.find((l) => l.key === dataKey && l.url);
    return owner?.url ?? `layers/${dataKey}.geojson`;
  }, []);

  /** Télécharge le fichier de toute couche active et pas encore chargée. */
  useEffect(() => {
    for (const layer of ALL_LAYERS) {
      // Les couches locales (marquages) n'ont pas de fichier à télécharger.
      if (layer.local || !active.has(layer.key)) continue;
      const dataKey = layer.dataKey ?? layer.key;
      if (!store[dataKey]) load(dataKey, layer.url ?? urlFor(dataKey));
    }
  }, [active, store, load, urlFor]);

  /* Le contour du territoire est chargé d'office : il ne sert plus une couche
     que l'on coche, mais le masque permanent qui borne la carte au national. */
  useEffect(() => {
    if (!store.territoire) load('territoire', 'layers/territoire.geojson');
  }, [store.territoire, load]);

  /* Préchargement des couches nécessaires au clustering hiérarchique des barrages.
     Chargées EN ARRIÈRE-PLAN quelles que soient les cases cochées : le clustering
     a besoin des polygones et chefs-lieux pour résoudre la position des clusters.
     Sans ces données, le repli (moyenne des barrages) reste correct mais moins
     précis — c'est donc un CHARGEMENT D'OPPORTUNITÉ, pas un prérequis bloquant. */
  useEffect(() => {
    const clesCluster = ['pts_reg', 'pts_cie', 'pts_bt', 'circo_reg', 'circo_cie', 'circo_bt'];
    for (const cle of clesCluster) {
      if (!store[cle]) load(cle, urlFor(cle));
    }
  }, [store, load, urlFor]);

  /**
   * UN SEUL PANNEAU OUVERT À LA FOIS — et c'est une seule variable, pas sept.
   *
   * Chaque panneau avait son propre booléen. Rien n'empêchait donc d'en ouvrir
   * trois ensemble : ils s'empilaient de part et d'autre, et la carte — ce
   * qu'on est venu regarder — finissait réduite à une bande au milieu.
   *
   * On aurait pu, à chaque ouverture, refermer les six autres. Mais il aurait
   * fallu y penser à chaque fois, et à chaque panneau ajouté par la suite :
   * exactement le genre d'oubli qui ne lève aucune erreur et se découvre à
   * l'usage. Ici l'état ne PEUT PAS exprimer deux panneaux ouverts. La règle
   * n'est plus à appliquer, elle est dans la forme de la donnée.
   *
   * Les booléens `xxxOpen` restent dérivés de cet état : le reste du fichier
   * ne change pas.
   */
  const [panneauOuvert, setPanneauOuvert] = useState(null);
  const basculerPanneau = useCallback(
    (nom) => setPanneauOuvert((p) => (p === nom ? null : nom)),
    [],
  );
  const ouvrirPanneau = useCallback((nom) => setPanneauOuvert(nom), []);
  /* Ne referme que si c'est bien CE panneau qui est ouvert : une fermeture
     tardive ne doit pas faire disparaître celui qu'on vient d'ouvrir. */
  const fermerPanneau = useCallback((nom) => setPanneauOuvert((p) => (p === nom ? null : p)), []);

  /**
   * ÉCHAP REPLIE LA SECTION OUVERTE.
   *
   * Le geste manquait, et c'est celui qu'on essaie d'instinct quand un panneau
   * gêne la vue. La croix restait le seul moyen : il fallait la viser, en haut
   * à droite du panneau, alors que le regard était sur la carte.
   *
   * Rien n'est perdu au passage : chaque panneau reste MONTÉ et se contente de
   * ne rien rendre (`if (!open) return null`), donc distance saisie, périmètre,
   * interrupteurs et résultat sont intacts à la réouverture.
   *
   * On ne touche pas à un champ en cours de saisie : dans une zone de texte,
   * Échap sert d'abord à l'éditeur, et fermer le panneau sous les doigts de
   * l'utilisateur serait une surprise désagréable.
   */
  useEffect(() => {
    const surTouche = (e) => {
      if (e.key !== 'Escape') return;
      const cible = e.target;
      const balise = cible?.tagName;
      if (
        balise === 'INPUT' ||
        balise === 'TEXTAREA' ||
        balise === 'SELECT' ||
        cible?.isContentEditable
      ) {
        return;
      }
      setPanneauOuvert((p) => (p === null ? p : null));
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  const couchesOpen = panneauOuvert === 'couches';
  const mqOpen = panneauOuvert === 'saisie';
  const distOpen = panneauOuvert === 'distances';
  const optimisationOpen = panneauOuvert === 'optimisation';
  const analysisOpen = panneauOuvert === 'analyse';
  const adminOpen = panneauOuvert === 'admin';
  const notificationsOpen = panneauOuvert === 'notifications';
  const assignationsOpen = panneauOuvert === 'assignations';
  const demandesOpen = panneauOuvert === 'demandes';
  const organisationOpen = panneauOuvert === 'organisation';
  const [demandeDeconnexion, setDemandeDeconnexion] = useState(false);

  const [navigationCompacte, setNavigationCompacte] = useState(() => {
    try {
      const enregistre = localStorage.getItem('gr-navigation-compacte');
      if (enregistre != null) return enregistre === '1';
    } catch {
      /* Le choix retombera sur la largeur disponible. */
    }
    return false;
  });
  const basculerNavigation = useCallback(() => {
    setNavigationCompacte((courante) => {
      const suivante = !courante;
      try {
        localStorage.setItem('gr-navigation-compacte', suivante ? '1' : '0');
      } catch {
        /* Le choix reste valable pour le rendu courant. */
      }
      return suivante;
    });
  }, []);

  /* Demande d'entrée directe dans un parcours du panneau terrain. */
  const [demandeTache, setDemandeTache] = useState(null);
  const ouvrirTacheTerrain = useCallback(
    (cle, type = null) => {
      setDemandeTache({ cle, type, ts: Date.now() });
      ouvrirPanneau('saisie');
    },
    [ouvrirPanneau],
  );

  /* ---- Panneau d'analyse ---- */
  const [report, setReport] = useState(null);

  /** Contour cliqué : {couche, nom, bounds}. */
  const [selection, setSelection] = useState(null);

  /** Un clic sur un contour ouvre sa fiche : sans cela, rien ne serait visible. */
  const handleSelect = useCallback((sel) => {
    setSelection(sel);
    if (!sel) {
      setContexteNavigation({});
    } else if (sel.couche === 'circo_reg') {
      setContexteNavigation({ region: sel.nom });
    } else if (sel.couche === 'circo_cie') {
      setContexteNavigation({ region: sel.properties?.gr_region || sel.properties?.reg, compagnie: sel.nom });
    } else if (sel.couche === 'circo_bt') {
      setContexteNavigation({
        region: sel.properties?.gr_region || sel.properties?.reg,
        compagnie: sel.properties?.gr_cie || sel.properties?.cie,
        brigade: sel.nom,
      });
    }
    /* Plus d'ouverture automatique du panneau Analyse : il masquait la moitié
       de la carte à chaque clic sur une région. Il reste dans le menu ☰. */
  }, []);

  const clearSelection = useCallback(() => setSelection(null), []);

  /**
   * L'analyse a besoin de données que l'utilisateur n'a pas forcément
   * affichées (les circonscriptions BT portent population et superficie).
   * On les charge donc à l'ouverture du panneau, indépendamment des couches
   * visibles : besoin de données n'est pas besoin d'affichage.
   */
  useEffect(() => {
    if (!analysisOpen) return;
    for (const key of ['circo_bt', 'pointages', 'pts_bt', 'pts_cie', 'pts_reg']) {
      if (!store[key]) load(key, urlFor(key));
    }
    if (report === null) {
      fetch('layers/_report.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(setReport)
        .catch(() => setReport({ issues: [], indisponible: true }));
    }
  }, [analysisOpen, store, load, urlFor, report]);

  const analysis = useMemo(
    () =>
      computeAnalysis({
        circo: store.circo_bt?.data,
        pointages: store.pointages?.data,
        ptsBt: store.pts_bt?.data,
        ptsCie: store.pts_cie?.data,
        ptsReg: store.pts_reg?.data,
      }),
    [store],
  );

  /**
   * Fiche du contour sélectionné. Les agrégats étant posés sur les contours
   * au moment du build, elle se calcule sur la seule couche cliquée — les
   * circonscriptions BT n'ont pas besoin d'être chargées.
   */
  const fiche = useMemo(() => {
    if (!selection) return null;
    const couche = store[selection.couche]?.data;
    if (!couche) return null;
    /** Champ des pointages qui porte le rattachement, selon la couche cliquée. */
    const champ = { circo_cie: 'cie', circo_bt: 'bde' }[selection.couche] ?? 'reg';
    return analyseEntite(selection.nom, couche, store.pointages?.data, champ);
  }, [selection, store]);

  /**
   * Proximité, calculée à la demande pour chaque source.
   * `pointages` porte un rayon d'action (diamètre / 2), ce qui permet de
   * distinguer les paires dont les zones se recoupent ; les points BT n'en
   * ont pas, la notion ne s'y applique donc pas.
   */
  const proximite = useMemo(() => {
    const out = {};
    for (const cfg of PROXIMITY_LAYERS) {
      const data = store[cfg.dataKey]?.data;
      if (!data) continue;
      out[cfg.key] = computeProximity(data, distanceKm, {
        maxKm: PROXIMITY_KM,
        nom: (p) => p.nom ?? p.pk ?? p.bde ?? p.unite,
        rayonM: cfg.dataKey === 'pointages' ? (p) => (p.diametre || 0) / 2 : null,
      });
    }
    return out;
  }, [store]);

  /* ================================================================ */
  /* Marquages — habilitation par le serveur                          */
  /* ================================================================ */

  /* ================================================================ */
  /* Marquages — habilitation par le serveur                          */
  /* ================================================================ */

  const [session, setSession] = useState(sessionInit); // {rang, unite, reg} ou null — fourni par App.jsx
  const [contexteNavigation, setContexteNavigation] = useState(null);
  const [service, setService] = useState(null); // état de l'API

  /**
   * LES FACTIONS — définition, faction en cours et affectations, VENUES DU
   * SERVEUR.
   *
   * Rien n'est déduit ici : ni les bornes horaires (elles sont dans
   * serveur/factions.mjs), ni la faction courante (elle suit l'horloge locale
   * du serveur), ni le rattachement d'un barrage à une faction (il vient des
   * relèves du jour). Le navigateur choisit ce qu'il affiche ; il ne décide de
   * rien.
   */
  const [factions, setFactions] = useState(null);
  /** Choix explicite ('F1'…, 'sans_faction', 'toutes') ; par défaut 'toutes' pour conserver l'apparence habituelle de tous les barrages. */
  const [factionChoisie, setFactionChoisie] = useState('toutes');
  const [unitesApi, setUnitesApi] = useState(null); // listes du formulaire
  const [items, setItems] = useState([]); // marquages, tels que le serveur les donne
  const [occupe, setOccupe] = useState(false); // une requête est en cours

  // {scope, ids, alertesIds} | null — résultat courant du panneau Filtrer,
  // répercuté sur la carte en temps réel ; null quand le panneau est fermé.
  const [arme, setArme] = useState(null); // nature en cours de pose
  const [mqSelection, setMqSelection] = useState(null); // id ouvert dans la fiche

  /**
   * Persistance de la sélection courante (barrage ouvert, circonscription
   * cliquée) PAR COMPTE — un chef qui recharge la page retrouve ce qu'il
   * consultait, plutôt que de repartir d'un écran vide. `bounds` n'est pas
   * stocké (c'est une instance `L.LatLngBounds`, pas du JSON) : seule la
   * géométrie l'est, et les bornes sont recalculées à la restauration, comme
   * ailleurs dans ce fichier (`L.geoJSON(...).getBounds()`).
   */
  const clefSelectionCompte = (matricule) => `gr-selection-${matricule}`;
  const matriculeRestaure = useRef(null);

  useEffect(() => {
    if (!session?.matricule || items.length === 0) return;
    if (matriculeRestaure.current === session.matricule) return;
    matriculeRestaure.current = session.matricule;
    try {
      const brut = localStorage.getItem(clefSelectionCompte(session.matricule));
      if (!brut) return;
      const sauvegarde = JSON.parse(brut);

      if (sauvegarde.selection?.geometry) {
        const bounds = L.geoJSON(sauvegarde.selection.geometry).getBounds();
        if (bounds.isValid()) {
          setSelection({
            couche: sauvegarde.selection.couche,
            nom: sauvegarde.selection.nom,
            bounds,
            geometry: sauvegarde.selection.geometry,
          });
        }
      }
      /* La sélection est restaurée, mais AUCUN panneau ne s'ouvre seul à la
         connexion : la carte s'affiche dégagée. */
      if (sauvegarde.mqSelectionId && items.some((m) => m.id === sauvegarde.mqSelectionId)) {
        setMqSelection(sauvegarde.mqSelectionId);
      }
    } catch {
      // stockage indisponible ou corrompu (navigation privée…) : écran vide, sans planter
    }
  }, [session, items]);

  useEffect(() => {
    if (!session?.matricule) return;
    try {
      localStorage.setItem(
        clefSelectionCompte(session.matricule),
        JSON.stringify({
          selection: selection
            ? {
              couche: selection.couche,
              nom: selection.nom,
              geometry: selection.geometry,
            }
            : null,
          mqSelectionId: mqSelection,
        }),
      );
    } catch {
      // navigation privée / quota dépassé : la sélection reste en mémoire pour la session en cours
    }
  }, [session, selection, mqSelection]);
  const [mqMessage, setMqMessage] = useState(null);
  const [alertes, setAlertes] = useState([]); // alertes de distance entre barrages
  /**
   * Notifications adressées au commandement — décisions du Super Admin sur un
   * barrage, et barrages nouvellement posés sur le terrain. Voir
   * NotificationsPanel.jsx et serveur/instructions.mjs.
   */
  const [notifications, setNotifications] = useState([]);

  /* La pastille du bouton : ce qui reste À TRAITER, jamais le total. Déclaré
     ICI et non plus haut avec `notificationsOpen` : un `useMemo` posé avant le
     `useState` qu'il lit s'évalue dans la zone morte temporelle de la
     constante, et l'application ne rendait plus rien. */
  /**
   * LE BADGE COMPTE CE QUI ATTEND QUELQU'UN D'AUTRE QUE SOI.
   *
   * Poser un barrage faisait apparaître un « 1 » sur le bouton Notifications
   * de celui qui venait de le poser. Le compteur réclamait une action qu'il
   * venait d'accomplir — voir `aTraiter` dans NotificationsPanel.jsx, qui
   * applique la même règle à la liste.
   */
  const notificationsOuvertes = useMemo(
    () =>
      notifications.filter(
        (n) => n.statut === 'ouverte' && n.auteur?.matricule !== session?.matricule,
      ).length,
    [notifications, session?.matricule],
  );

  /** Aperçu d'un conflit assigné (CMND Région ou CMND Cie) : trace et repère du voisin en conflit. */
  const [conflitAssigneVise, setConflitAssigneVise] = useState(null);
  const [modeComparatifCarte, setModeComparatifCarte] = useState('comparer');
  const [idsAssignesLocaux, setIdsAssignesLocaux] = useState(() => new Set());
  const barragesAssignes = useMemo(() => {
    const s = new Set(idsAssignesLocaux);
    for (const n of notifications ?? []) {
      if (n.action === 'assignation' && n.statut === 'ouverte' && n.barrageId) {
        s.add(n.barrageId);
      }
    }
    return s;
  }, [notifications, idsAssignesLocaux]);

  const [assignationsListe, setAssignationsListe] = useState([]);
  useEffect(() => {
    if (!session || session.rang === 'admin') {
      setAssignationsListe([]);
      return;
    }
    API.listerAssignations()
      .then((res) => {
        if (Array.isArray(res?.aTraiter)) {
          setAssignationsListe(res.aTraiter);
          setAssignationsATraiter(res.aTraiter.length);
        }
      })
      .catch(() => { });
  }, [session, versionAssignations]);

  const assignationsMap = useMemo(
    () => new Map(assignationsListe.map((a) => [a.barrageId, a])),
    [assignationsListe],
  );

  /**
   * Le barrage sur lequel on vient d'attirer l'attention — depuis une
   * notification, ou une ligne de résultat. Purement visuel et volontairement
   * éphémère : un halo qui ne s'éteint jamais cesse d'être un signal.
   */
  /**
   * UN SEUL ÉTAT pour « le poste que l'utilisateur vient de désigner », d'où
   * qu'il l'ait désigné : recherche, saisie terrain, notification, liste d'un
   * panneau. Il porte sa position et son nom plutôt qu'un simple identifiant,
   * pour que le signal fonctionne même si la couche du repère est décochée —
   * ce serait absurde de cadrer sur un point et de ne rien montrer.
   *
   * `ts` sert à REJOUER l'animation quand on redésigne le même poste.
   *
   * `persistant` distingue deux besoins : un cadrage venu d'une notification
   * s'éteint seul (on regarde, on passe), une sélection de travail reste
   * marquée tant qu'on travaille dessus.
   */
  const [vise, setVise] = useState(null);

  /* Vrai tant qu'une bulle de repère est ouverte — voir SuiviBulle. */
  const [bulleOuverte, setBulleOuverte] = useState(false);
  const focusBarrageId = vise?.id ?? null;

  /* Un signal non persistant s'éteint de lui-même : le temps de voir où l'on
     vient d'être amené, pas plus. Un halo qui ne s'éteint jamais cesse d'être
     un signal, et finirait par se confondre avec les repères de décision. */
  useEffect(() => {
    if (!vise || vise.persistant) return undefined;
    const t = setTimeout(() => setVise(null), 6000);
    return () => clearTimeout(t);
  }, [vise]);

  const [optimisationResultats, setOptimisationResultats] = useState(null);
  const [distanceOptimisation, setDistanceOptimisation] = useState('20');
  const [distanceBaseOptimisation, setDistanceBaseOptimisation] = useState('20');
  /**
   * LA FACTION DE L'OPTIMISATION — son propre état, distinct du filtre
   * « Faction » de la carte. L'optimisation des barrages est un module à
   * part : lancer un calcul sur une faction ne change pas la faction affichée,
   * et changer la faction affichée ne relance pas le calcul. Le panneau
   * d'optimisation recalcule lui-même quand on change SA faction.
   */
  const [factionOptimisationChoisie, setFactionOptimisationChoisie] = useState('toutes');
  /* Les calculs de l'optimisation : état publié par OptimisationPanel, et les
     fonctions qu’il enregistre pour ouvrir ou désactiver un calcul. */
  const [ongletsOptimisation, setOngletsOptimisation] = useState(null);
  const ongletsOptimisationRef = useRef(null);
  const enregistrerOngletsOptimisation = useCallback((fns) => {
    ongletsOptimisationRef.current = fns;
  }, []);

  /**
   * OPTIMISATION PAR ROUTE — un onglet de plus, réservé au Superadmin, et son
   * panneau (OptimisationRoutePanel.jsx). Le panneau publie ce que la carte
   * dessine (`vueRoute`) et son état (`statutRoute`) ; la carte ne décide rien.
   */
  const routePanelRef = useRef(null);
  const [vueRoute, setVueRoute] = useState(null);
  const [statutRoute, setStatutRoute] = useState({ statut: 'idle', erreur: null });
  const [optimisationRouteOpen, setOptimisationRouteOpen] = useState(false);

  /**
   * LE CONFLIT DÉSIGNÉ (« C-01 ») — depuis la liste du panneau, un badge ou
   * un clic sur son tracé. `{ id, cadrer, n }` : `n` distingue deux gestes
   * successifs sur le même conflit (re-cadrer), `cadrer` dit si la carte doit
   * s'y rendre. Distinct de `vise`, qui désigne un BARRAGE.
   */
  const [conflitVise, setConflitVise] = useState(null);
  const [conflitAAssigner, setConflitAAssigner] = useState(null);
  const [panneauConflitsOuvert, setPanneauConflitsOuvert] = useState(false);
  /* Le bouton « Conflits » : le menu déroulant des conflits se pose dessous. */
  const boutonConflitsRef = useRef(null);
  /* La dernière assignation enregistrée : le menu passe au conflit suivant. */
  const [derniereAssignation, setDerniereAssignation] = useState(null);
  /* Chaque incrément : le menu des conflits montre la liste (après une analyse). */
  const [demandeListeConflits, setDemandeListeConflits] = useState(0);
  /* { id, n } : le menu des conflits s'ouvre sur la fiche de ce conflit. */
  const [demandeDetailConflit, setDemandeDetailConflit] = useState(null);
  /* Bord droit du menu des conflits ouvert (px) : la barre AVANT / APRÈS s'y range à droite. */
  const [bordMenuConflits, setBordMenuConflits] = useState(null);
  const [menuFiltresOuvert, setMenuFiltresOuvert] = useState(false);
  /* Optimisation des barrages : son propre panneau, indépendant des filtres. */
  const [menuOptimisationOuvert, setMenuOptimisationOuvert] = useState(false);
  /* Le volet de navigation (☰), ouvert depuis la boîte de recherche. */
  const [voletNavigationOuvert, setVoletNavigationOuvert] = useState(false);
  const [conflitViseLateral, setConflitViseLateral] = useState(null);
  const [conflitATransmettre, setConflitATransmettre] = useState(null);
  const [conflitATraiter, setConflitATraiter] = useState(null);
  const [conflitEnTraitement, setConflitEnTraitement] = useState(null);
  const [versionConflits, setVersionConflits] = useState(0);
  const [conflitsSupprimes, setConflitsSupprimes] = useState(() => new Set());
  /** Conflits enregistrés par le serveur — ceux du panneau latéral. */
  const [conflitsServeur, setConflitsServeur] = useState([]);
  /* Conflits traités et approuvés (Historique) : `{ id, paireCle }`, lus avec la liste. */
  const [conflitsClos, setConflitsClos] = useState([]);
  /** Paires closes (historique) : jamais retracées comme conflit actif. */
  const [pairesCloses, setPairesCloses] = useState(() => new Set());

  /**
   * RADAR DES NOUVEAUX CONFLITS (voir detectionConflits.js, RadarConflits.jsx).
   * Le détecteur vit le temps de la session : sa première liste sert de
   * référence, si bien que l'ouverture ou le rechargement de la page ne
   * rejouent rien. `radarConflits` : repères des conflits détectés depuis,
   * tant qu'ils restent à prendre en charge ; `alerteConflits` : la carte
   * « Nouveau conflit détecté ».
   */
  const detecteurConflits = useRef(null);
  if (!detecteurConflits.current) detecteurConflits.current = creerDetecteur();
  const [radarConflits, setRadarConflits] = useState([]);
  const [alerteConflits, setAlerteConflits] = useState({ conflits: [], version: 0 });

  /**
   * ANALYSE EN COURS — la détection réelle du serveur, vue de la carte.
   * `api.js` annonce le début et la fin des écritures après lesquelles le
   * serveur détecte les conflits (`gr-detection-conflits`). Pendant ce temps,
   * et jusqu'à la relecture de la liste qui suit : « Analyse des conflits… ».
   * Puis, si rien de nouveau : « Aucun nouveau conflit détecté » ; sinon la
   * notification et l'impulsion prennent le relais. Aucun relevé périodique.
   */
  const [etatDetection, setEtatDetection] = useState(null);
  const scansEnCours = useRef(0);
  const finDernierScan = useRef(0);
  const resultatAttendu = useRef(false);
  const debutDerniereLecture = useRef(0);
  useEffect(() => {
    const surDetection = (e) => {
      if (e.detail?.phase === 'debut') {
        scansEnCours.current += 1;
        setEtatDetection('analyse');
        return;
      }
      scansEnCours.current = Math.max(0, scansEnCours.current - 1);
      if (!e.detail?.ok) {
        if (!scansEnCours.current && !resultatAttendu.current) setEtatDetection(null);
        return;
      }
      const fin = Date.now();
      finDernierScan.current = fin;
      resultatAttendu.current = true;
      /* L'appelant relit souvent la liste lui-même : on ne relance une
         lecture que si aucune n'a commencé depuis la fin de la requête. */
      setTimeout(() => {
        if (debutDerniereLecture.current < fin) setVersionConflits((v) => v + 1);
      }, 200);
    };
    window.addEventListener('gr-detection-conflits', surDetection);
    return () => window.removeEventListener('gr-detection-conflits', surDetection);
  }, []);

  useEffect(() => {
    const surRechargerBarrages = (e) => {
      if (Array.isArray(e?.detail) && e.detail.length > 0) {
        setItems((prev) => {
          const mapMaj = new Map(e.detail.map((b) => [b.id, b]));
          return prev.map((x) => mapMaj.get(x.id) || x);
        });
      }
      API.listerMarquages().then(setItems).catch(() => {});
      chargerRepositionnementsRef.current?.();
      setVersionConflits((v) => v + 1);
    };
    window.addEventListener('gr-recharger-barrages', surRechargerBarrages);
    return () => window.removeEventListener('gr-recharger-barrages', surRechargerBarrages);
  }, []);
  useEffect(() => {
    if (!etatDetection) return undefined;
    /* « Aucun » s'efface vite ; « analyse » ne reste jamais bloquée. */
    const t = setTimeout(() => setEtatDetection(null), etatDetection === 'aucun' ? 2600 : 15000);
    return () => clearTimeout(t);
  }, [etatDetection]);

  useEffect(() => {
    if (!session) return;
    const debutLecture = Date.now();
    debutDerniereLecture.current = debutLecture;
    API.listerConflits()
      .then((res) => {
        setConflitsServeur(Array.isArray(res?.items) ? res.items : []);
        setConflitsClos(Array.isArray(res?.clos) ? res.clos : []);
        setPairesCloses(new Set((res?.clos ?? []).map((c) => c.paireCle).filter(Boolean)));

        /* Nouveaux conflits détectés depuis la dernière lecture : impulsion
           (au plus trois, situés) et carte d'alerte. Rien ici ne retient ni ne
           modifie un conflit : la détection ne fait que regarder la liste. */
        const recus = Array.isArray(res?.items) ? res.items : [];
        const { nouveaux, animes } = detecteurConflits.current.observer(recus);
        /* Un repère suit son conflit dans le workflow (phaseConflit) et
           disparaît à l'approbation, ou quand le conflit quitte la liste. */
        const parId = new Map(recus.map((c) => [c.id, c]));
        setRadarConflits((avant) => {
          const t = Date.now();
          const m = new Map(
            avant
              .filter((x) => parId.has(x.conf.id) && phaseConflit(parId.get(x.conf.id), { pris: x.pris }))
              .map((x) => [x.conf.id, x.conf === parId.get(x.conf.id) ? x : { ...x, conf: parId.get(x.conf.id) }]),
          );
          for (const c of nouveaux) m.set(c.id, { conf: c, impulsionLe: animes.some((a) => a.id === c.id) ? t : null, pris: false });
          const suivant = [...m.values()].slice(-50);
          return suivant.length === avant.length && suivant.every((x, i) => x === avant[i]) ? avant : suivant;
        });
        /* Résultat d'une analyse attendue (lecture commencée après elle). */
        if (resultatAttendu.current && !scansEnCours.current && debutLecture >= finDernierScan.current) {
          resultatAttendu.current = false;
          setEtatDetection(nouveaux.length ? null : 'aucun');
        }
        if (nouveaux.length) {
          setAlerteConflits((a) => ({
            conflits: [...nouveaux, ...a.conflits.filter((c) => !nouveaux.some((n) => n.id === c.id))].slice(0, 20),
            version: a.version + 1,
          }));
        }
        if (Array.isArray(res?.supprimes)) {
          setConflitsSupprimes((prev) => {
            const next = new Set(prev);
            res.supprimes.forEach((s) => {
              if (s && !/^C-\d+$/i.test(String(s).trim())) next.add(s);
            });
            return next;
          });
        }
      })
      .catch(() => {});
  }, [session, versionConflits]);
  const [filtreRoute, setFiltreRoute] = useState(null);
  const [filtreSensRoute, setFiltreSensRoute] = useState(SENS_TOUS);
  const [modalFiltreRouteOuverte, setModalFiltreRouteOuverte] = useState(false);
  const [conflitsCalculesRoute, setConflitsCalculesRoute] = useState(null);
  const [parametresFiltreRoute, setParametresFiltreRoute] = useState({ route: '', distance: 20, sens: SENS_TOUS });
  const [filtreEclairageBarrages, setFiltreEclairageBarrages] = useState('tous');
  const [filtreAccidentsBarrages, setFiltreAccidentsBarrages] = useState('tous');

  const handleEffacerFiltreRouteComplet = useCallback(() => {
    setFiltreRoute(null);
    setFiltreSensRoute(SENS_TOUS);
    setVueRoute(null);
    setConflitsCalculesRoute(null);
    setParametresFiltreRoute({ route: '', distance: 20, sens: SENS_TOUS });
    routePanelRef.current?.reinitialiser?.();
    setVersionConflits((v) => v + 1);
  }, []);

  const ongletsOptimisationComplets = useMemo(() => {
    const base = ongletsOptimisation ? [...ongletsOptimisation] : [];
    base.push({
      cle: 'route',
      libelle: 'Par routes',
      statut: filtreRoute ? 'active' : (vueRoute?.lignes?.length ? 'active' : 'idle'),
      erreur: statutRoute?.erreur ?? null,
      ouvert: modalFiltreRouteOuverte,
      verrouille: false,
    });
    return base;
  }, [ongletsOptimisation, statutRoute, vueRoute, filtreRoute, modalFiltreRouteOuverte]);

  const gererOuvertureOnglet = useCallback((cle) => {
    if (cle === 'route') {
      setModalFiltreRouteOuverte(true);
    } else {
      ongletsOptimisationRef.current?.ouvrir(cle);
    }
  }, []);

  const gererDesactivationOnglet = useCallback((cle) => {
    if (cle === 'route') {
      handleEffacerFiltreRouteComplet();
    } else {
      ongletsOptimisationRef.current?.desactiver(cle);
    }
  }, [handleEffacerFiltreRouteComplet]);
  /* La couche des routes classées (numéros A/RN/RR/RP) : allumée par défaut,
     préférence gardée par ce navigateur. */
  const [routesVisibles, setRoutesVisibles] = useState(() => {
    try {
      return localStorage.getItem('gr-routes-classees') !== 'non';
    } catch {
      return true;
    }
  });
  const basculerRoutes = useCallback(() => {
    setRoutesVisibles((v) => {
      try {
        localStorage.setItem('gr-routes-classees', v ? 'non' : 'oui');
      } catch {
        /* stockage indisponible : la préférence vaut pour la séance */
      }
      return !v;
    });
  }, []);

  const handleFiltrerRoute = useCallback((route) => {
    const can = route ? canonicalRouteId(route) : null;
    setFiltreRoute(can);
    setOptimisationRouteOpen(false);
    setVersionConflits((v) => v + 1);
    if (can && carte.current) {
      // Isoler immédiatement la route et cadrer sur ses barrages ("triq m3zola")
      const barragesSurRoute = items.filter((m) => MQ.estBarrage(m) && canonicalRouteId(m.route) === can);
      if (barragesSurRoute.length > 0) {
        const coords = barragesSurRoute
          .filter((b) => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng)))
          .map((b) => [Number(b.lat), Number(b.lng)]);
        if (coords.length === 1) {
          carte.current.flyTo(coords[0], 13, { duration: 0.6 });
        } else if (coords.length > 1) {
          carte.current.fitBounds(L.latLngBounds(coords), { padding: [80, 80], maxZoom: 14, animate: true });
        }
      }
    }
  }, [session?.rang, items]);

  const viserConflit = useCallback(
    (idOrObj, options = {}) => {
      const id = typeof idOrObj === 'string' ? idOrObj : idOrObj?.id;
      const confObj = typeof idOrObj === 'object' && idOrObj !== null ? idOrObj : { id };
      setConflitVise(id ? { id, cadrer: options.cadrer === true, n: Date.now() } : null);
      if (id) {
        /* Sa FICHE s'ouvre dans le menu des conflits (pas la liste) — la même
           que pour l'optimisation par route ; plus de petit panneau à part. */
        setConflitViseLateral((prev) => (prev?.id === id ? prev : confObj));
        if (['admin', 'reg', 'cie'].includes(session?.rang)) {
          setDemandeDetailConflit({ id, n: Date.now() });
          setPanneauConflitsOuvert(true);
        }
        carte.current?.closePopup();
      }
    },
    [session?.rang],
  );
  /**
   * LES CONFLITS DE L'OPTIMISATION, RAPPROCHÉS DES CONFLITS ENREGISTRÉS — par
   * leur paire de barrages, jamais par leur numéro de calcul (qui change à
   * chaque optimisation). Un conflit déjà assigné et pas encore traité arrive
   * donc marqué `dejaAssigne` (« CMD Région Rabat »…) à chaque nouvelle
   * optimisation : la carte et le panneau montrent « Assigné à … » au lieu
   * d'« Assigner ». Voir rapprocherConflitsEnregistres (src/actionsConflit.js).
   */
  const conflitsIdentifies = useMemo(
    () => rapprocherConflitsEnregistres(optimisationResultats?.conflitsIdentifies ?? null, conflitsServeur, session, conflitsClos),
    [optimisationResultats?.conflitsIdentifies, conflitsServeur, session, conflitsClos],
  );

  /* Les conflits d'une analyse par axe routier : même rapprochement. */
  const vueRouteAffichee = useMemo(() => {
    const liste = vueRoute?.conflits?.liste;
    if (!Array.isArray(liste)) return vueRoute;
    const rapprochee = rapprocherConflitsEnregistres(liste, conflitsServeur, session, conflitsClos);
    return rapprochee === liste ? vueRoute : { ...vueRoute, conflits: { ...vueRoute.conflits, liste: rapprochee } };
  }, [vueRoute, conflitsServeur, session, conflitsClos]);

  /**
   * DEMANDER L'ASSIGNATION D'UN CONFLIT — le seul chemin vers la fenêtre
   * d'assignation, quel que soit le bouton. Un conflit CALCULÉ (sans état du
   * serveur) dont la paire est déjà assignée et pas encore traitée, ou déjà
   * traitée et approuvée, n'ouvre pas la fenêtre : l'état est dit à la place.
   * La réassignation volontaire d'un conflit enregistré (`workflow`) passe.
   */
  const demanderAssignationConflit = useCallback(
    (c) => {
      const liste = Array.isArray(c) ? c : c?.conflits ?? null;
      const etatDe = (x) => (x?.workflow ? null : rapprocherConflitsEnregistres([x], conflitsServeur, session, conflitsClos)[0]);
      if (liste) {
        const libres = liste.filter((x) => {
          const r = etatDe(x);
          return !(r?.dejaAssigne || r?.dejaTraite);
        });
        if (libres.length < liste.length) {
          notifier({ type: 'info', titre: 'Conflits déjà pris en charge', message: `${liste.length - libres.length} conflit(s) déjà assigné(s) ou traité(s) : ignoré(s).` });
        }
        if (libres.length) setConflitAAssigner({ conflits: libres });
        return;
      }
      const r = etatDe(c);
      if (r?.dejaAssigne) {
        notifier({ type: 'info', titre: 'Conflit déjà assigné', message: `Assigné à ${r.dejaAssigne} — en attente de traitement. Aucune nouvelle assignation.` });
        return;
      }
      if (r?.dejaTraite) {
        notifier({ type: 'info', titre: 'Déjà traité', message: 'Ce conflit est déjà traité et approuvé. Pour le reprendre, rouvrez-le depuis l’Historique.' });
        return;
      }
      setConflitAAssigner(c);
    },
    [conflitsServeur, session, conflitsClos],
  );

  /**
   * CONFLITS À TRAITER — par le CMD Région (ou CMD CIE) connecté : ceux remis
   * à son commandement et pas encore traités (compterATraiter). Relu avec la
   * liste des conflits, donc après chaque assignation reçue (notification),
   * traitement, transmission ou changement d'état.
   */
  const conflitsATraiter = useMemo(() => compterATraiter(conflitsServeur, session), [conflitsServeur, session]);
  const destinataireConflits = session?.rang === 'reg' || session?.rang === 'cie';

  /**
   * DÉJÀ ASSIGNÉ ? — pour une ligne du panneau d'optimisation (un barrage et
   * son voisin en conflit). Même lecture que le serveur, qui refuse de toute
   * façon une seconde assignation :
   *   1. le conflit de la PAIRE, assigné et pas encore traité ;
   *   2. un autre conflit actif du barrage, remis au CMD Région de sa région ;
   *   3. l'assignation encore ouverte du barrage (Super Admin → CMND Région) ;
   *   4. celle qui vient d'être faite dans cette page.
   * Rend « CMD Région X » (ou la CIE), ou null : le bouton « Assigner » reste.
   */
  const assignationsOuvertesBarrage = useMemo(() => {
    const m = new Map();
    for (const n of notifications ?? []) {
      if (n.action === 'assignation' && n.statut === 'ouverte' && n.barrageId) {
        m.set(n.barrageId, n.destinataire?.unite ? `CMD Région ${n.destinataire.unite}` : 'CMD Région');
      }
    }
    return m;
  }, [notifications]);
  const assignationDe = useCallback(
    (b) => {
      if (!b?.id) return null;
      const voisin = b.voisin?.id;
      if (voisin) {
        const c = conflitsIdentifies?.find((x) => x.cle === clePaire(b.id, voisin));
        if (c?.dejaAssigne) return c.dejaAssigne;
      }
      const autre = conflitsServeur.find(
        (c) =>
          (c.barrageAId === b.id || c.barrageBId === b.id) &&
          c.workflow?.etat && c.workflow.etat !== 'NEW' && c.workflow.section !== 'historique' &&
          (c.workflow.regions ?? []).some((r) => String(r).toLowerCase() === String(b.reg ?? '').toLowerCase()),
      );
      if (autre) return libelleAssignation(autre);
      if (assignationsOuvertesBarrage.has(b.id)) return assignationsOuvertesBarrage.get(b.id);
      if (idsAssignesLocaux.has(b.id)) return b.reg ? `CMD Région ${b.reg}` : 'CMD Région';
      return null;
    },
    [conflitsIdentifies, conflitsServeur, assignationsOuvertesBarrage, idsAssignesLocaux],
  );

  /* Les conflits restent accessibles via le bouton "Conflits" dans la barre latérale sans recouvrir la carte par défaut */

  /* Un nouveau résultat peut renuméroter : un identifiant disparu n'est plus désigné si la liste est présente. */
  useEffect(() => {
    if (
      conflitVise &&
      conflitsIdentifies &&
      conflitsIdentifies.length > 0 &&
      !conflitsIdentifies.some((c) => c.id === conflitVise.id) &&
      !conflitsCalculesRoute?.some((c) => c.id === conflitVise.id)
    ) {
      setConflitVise(null);
    }
  }, [conflitsIdentifies, conflitsCalculesRoute, conflitVise]);

  const routesDisponibles = useMemo(() => {
    const set = new Set();
    for (const m of items ?? []) {
      if (MQ.estBarrage(m) && (m.route || m.roadName || m.axe || m.axeRoutier)) {
        const can = canonicalRouteId(m.route || m.roadName || m.axe || m.axeRoutier);
        if (can) set.add(can);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  }, [items]);

  /**
   * TOUTES LES ROUTES EN CONFLIT DE L'OPTIMISATION, en une liste — les liens
   * mesurés (manuel) et les routes AVANT / APRÈS / RESTANT (manuel et auto),
   * chacune avec l'identifiant de SA paire. Les filtres d'affichage sont ceux
   * d'avant : « conflits » pour les mesures, « déplacements » pour l'après.
   *
   * Une même route n'est dessinée qu'une fois : un lien mesuré identique à la
   * route AVANT de la même paire (mêmes extrémités) est écarté.
   */
  const routesConflitsOptim = useMemo(() => {
    const res = optimisationResultats;
    if (!res) return [];
    const out = [];
    const vues = new Set();
    const bout = (p) => `${Number(p[0]).toFixed(5)},${Number(p[1]).toFixed(5)}`;
    const depotItems = new Map((items ?? []).map((m) => [m.id, m]));
    const estPosteIntou = (p) => {
      if (!p) return false;
      if (MQ.estIntouchable(p)) return true;
      const id = p.id ?? p;
      const m = depotItems.get(id);
      return Boolean(m && MQ.estIntouchable(m));
    };
    const estEntreIntou = (r) => {
      if (r.entreIntouchables === true) return true;
      return estPosteIntou(r.a) && estPosteIntou(r.b);
    };
    const estAdmin = session?.rang === 'admin';
    const estAssigne = (p) => {
      if (!p) return false;
      const id = p.id ?? p;
      return barragesAssignes.has(id);
    };
    const estSupprime = (r) => {
      if (!conflitsSupprimes || conflitsSupprimes.size === 0) return false;
      const cid = r.conflitId ?? r.id;
      if (cid && conflitsSupprimes.has(cid)) return true;
      const aId = r.a?.id ?? r.a;
      const bId = r.b?.id ?? r.b;
      if (aId && bId) {
        const pKey = clePaire(aId, bId);
        if (conflitsSupprimes.has(pKey)) return true;
      }
      return false;
    };
    const ajouter = (r) => {
      // DONT SHOW ERROR RED LINE BETWEEN TWO POST FIX INTOUCHABLE
      if (r.statut !== 'resolu' && estEntreIntou(r)) return;
      if (r.conflitId !== conflitVise?.id && (estAssigne(r.a) || estAssigne(r.b))) return;
      if (estSupprime(r)) return;
      const ends = [bout(r.trace[0]), bout(r.trace[r.trace.length - 1])].sort().join('~');
      const cle = `${r.conflitId ?? r.cle}|${ends}`;
      if (vues.has(cle)) return;
      vues.add(cle);
      out.push(r);
    };
    for (const r of res.routesConflit ?? []) {
      if (r.trace?.length > 1 && filtreOptim(res, r.phase === 'apres' ? 'deplacements' : 'conflits')) ajouter(r);
    }
    if (filtreOptim(res, 'conflits')) {
      for (const l of res.liens ?? []) {
        if (!l.sousLeSeuil || !(l.trace?.length > 2)) continue;
        if (estSupprime(l)) continue;
        ajouter({
          cle: `lien-${l.cle}`,
          conflitId: l.conflitId ?? null,
          phase: 'mesure',
          trace: l.trace,
          km: l.distanceKm,
          statut: 'conflit',
          entreIntouchables: l.entreIntouchables,
          seuilKm: res.seuilKm,
          routes: l.routes,
          a: l.a,
          b: l.b,
        });
      }
    }
    return out;
  }, [optimisationResultats, items, session?.rang, barragesAssignes, conflitVise, conflitsSupprimes]);

  /**
   * UNE RÉFÉRENCE STABLE, ET C'EST ESSENTIEL ICI.
   *
   * `OptimisationPanel` publie son résultat depuis un `useEffect` qui a
   * `onResultatsChange` dans ses dépendances. Passée en fonction fléchée
   * écrite dans le JSX, la prop change d'identité à CHAQUE rendu du parent :
   * l'effet se rejoue sans fin et republie le même résultat.
   */
  /**
   * LES ÉTAPES COMMUNES À TOUTES LES OPTIMISATIONS — celles de l'analyse par
   * axe (lancerAnalyseRoute), la référence :
   *   1. pendant le calcul : le radar (RadarAnalyse), piloté par le calcul réel
   *      (avecRadar) — la progression chiffrée n'existe que si le calcul la
   *      fournit (analyse par axe) : rien n'est simulé ;
   *   2. les routes des conflits trouvés se dessinent l'une après l'autre
   *      (radarCalcul → RadarConflits) ;
   *   3. le résultat (`analyseAxe` → CarteResultatAnalyse), et le menu des
   *      conflits s'ouvre sur la LISTE de tous les conflits détectés.
   * Les calculs, eux, restent propres à chaque mode.
   */
  const presenterResultatCalcul = useCallback(({ libelle, distance, conflits, barrages = null, paires = null, route = null }) => {
    const t = Date.now();
    const ECART = 0.4;
    const durees = conflits.map((c) => dureeDessin(c.distanceKm));
    const total = durees.reduce((n, d) => n + d + ECART, 0);
    const facteur = total > 30 ? 30 / total : 1;
    let delai = 0;
    setRadarCalcul(conflits.map((c, i) => {
      const dureeTrace = Math.max(1.8, Math.round(durees[i] * facteur * 100) / 100);
      const entree = { conf: c, impulsionLe: t, pris: false, delai, dureeTrace, rejoue: 0, resultat: true };
      delai += dureeTrace + ECART;
      return entree;
    }));
    setAnalyseAxe({ etat: conflits.length ? 'conflits' : 'aucun', libelle, route, distance, conflits, barrages, paires, version: t });
    setConflitViseLateral(null);
    /* Rien de la consultation précédente ne reste à l'écran. */
    setConflitAssigneVise(null);
    setConflitVise(null);
    setMenuOptimisationOuvert(false);
    setPanneauConflitsOuvert(true);
    setDemandeListeConflits((n) => n + 1);
  }, []);

  /* Optimisation par paramètres : à chaque NOUVEAU calcul (calculId), les
     étapes communes ; désactivée, ses routes dessinées s'effacent. */
  const dernierCalculOptimisation = useRef(0);
  const radarDeLOptimisation = useRef(false);
  const publierResultatsOptimisation = useCallback((res) => {
    setOptimisationResultats(res);
    if (!res) {
      if (radarDeLOptimisation.current) {
        radarDeLOptimisation.current = false;
        setRadarCalcul([]);
        setAnalyseAxe((a) => (a?.libelle?.startsWith('Optimisation') ? null : a));
      }
      return;
    }
    if (!res.calculId || res.calculId === dernierCalculOptimisation.current) return;
    dernierCalculOptimisation.current = res.calculId;
    /* Une analyse par route lancée APRÈS ce calcul est en cours : ce résultat
       est périmé — il n'écrase rien, et l'optimisation se retire. */
    if (analyseEnCours.current) {
      ongletsOptimisationRef.current?.desactiver?.('distance');
      return;
    }
    /* UN SEUL MODE À LA FOIS : les résultats d'une analyse par route (axe
       isolé, ses conflits, ses tracés) ne restent pas affichés ni mélangés. */
    handleEffacerFiltreRouteComplet();
    radarDeLOptimisation.current = true;
    const conflits = (res.conflitsIdentifies ?? [])
      .filter((c) => c.statut !== 'resolu')
      .map((c) => ({ ...c, distanceKm: Number(c.distanceKm ?? c.km ?? 0) }));
    presenterResultatCalcul({
      libelle: 'Optimisation par paramètres',
      distance: res.seuilKm ?? '—',
      conflits,
    });
  }, [presenterResultatCalcul, handleEffacerFiltreRouteComplet]);


  /**
   * LES CHIFFRES QUI ONT MOTIVÉ CHAQUE DÉCISION, retrouvés par identifiant.
   *
   * Un commandant n'a lancé aucun calcul : sans cela, la bulle d'un « ✗ » sur
   * sa carte n'aurait aucune distance à montrer. Or la notification les porte
   * déjà, figés au moment de la décision (voir `criteres` dans
   * serveur/instructions.mjs) — on les relit de là, plutôt que de recalculer
   * autre chose que ce qui a été décidé.
   */
  const criteresParBarrage = useMemo(() => {
    const parId = new Map();
    for (const n of notifications) {
      if (n.statut !== 'ouverte' || !n.criteres) continue;
      parId.set(n.barrageId, {
        texte: n.criteres.voisinNom
          ? `${n.criteres.distanceKm} km de « ${n.criteres.voisinNom} »`
          : `${n.criteres.distanceKm} km de son voisin`,
        seuil: n.criteres.seuilKm,
        criteres: n.criteres,
      });
    }
    /* Le rapport en cours prime : s'il existe, il est plus frais. */
    if (optimisationResultats?.motifs) {
      for (const [id, m] of optimisationResultats.motifs) parId.set(id, m);
    }
    return parId;
  }, [notifications, optimisationResultats]);

  /**
   * Les barrages dont l'icône est REMPLACÉE par un repère de décision — « ? »,
   * « ✗ » ou « ✓ ». Deux symboles empilés au même point ne se lisent plus.
   *
   * Les deux sources sont réunies ici : le dépôt (décisions persistées) et le
   * rapport en cours (postes encore à trancher). Se fier au seul rapport
   * laissait le « ✗ » du commandant sous une icône de barrage ordinaire.
   */
  const masquesBarrages = useMemo(() => {
    const ids = new Set(optimisationResultats?.masquesIds ?? []);
    for (const m of items) {
      if (m.decisionOptimisation === 'a_supprimer') ids.add(m.id);
    }
    /**
     * UN POSTE CONSERVÉ REPREND SON REPÈRE ORDINAIRE.
     *
     * « Conserver » veut dire « ce barrage reste » : lui laisser un marqueur
     * de décision revenait à le montrer encore comme un cas en cours, alors
     * que la question est close. Il est donc retiré du masque — et du même
     * coup des couches de décision — pour redevenir un barrage comme les
     * autres, avec l'icône qu'il avait avant l'optimisation.
     *
     * Le poste dont le RETRAIT est proposé, lui, garde son marqueur : sa
     * question reste ouverte tant que le commandant ne s'est pas prononcé.
     */
    for (const m of items) {
      if (m.decisionOptimisation === 'conserve') ids.delete(m.id);
    }
    /* SAUF s'il est en conflit de distance : un poste conservé MAIS toujours
       trop proche n'est pas un barrage ordinaire — il porte son repère de
       conflit (voir BarragesEnConflitLayer). */
    for (const id of optimisationResultats?.conflits?.keys() ?? []) ids.add(id);
    return ids.size ? ids : null;
  }, [items, optimisationResultats]);
  const [generationEnCours, setGenerationEnCours] = useState(false);
  const [modal3DItem, setModal3DItem] = useState(null); // marquage ouvert en vue aérienne (coord + fiche)
  const [heatmapOn, setHeatmapOn] = useState(false); // carte de risque (voir HeatmapLayer.jsx)
  const [periodeComparaison, setPeriodeComparaison] = useState('semaine'); // jour | semaine | mois | annee
  // {annulesIds, conservesIds} | null — résultat courant de l'optimisation,
  // répercuté sur la carte en temps réel ; null quand le panneau est fermé.

  /**
   * Incrémenté chaque fois qu'un barrage est réellement retiré du dispositif.
   *
   * Un résultat d'optimisation décrit un voisinage à un instant donné. Dès
   * qu'un poste disparaît, ce voisinage est faux pour les autres : entre A, B
   * et C, retirer B fait de C le voisin de A, à une tout autre distance. Le
   * panneau observe ce compteur et refait son calcul sur le dispositif restant,
   * plutôt que de laisser à l'écran des chiffres qui ne valent plus.
   */
  const [dispositifVersion, setDispositifVersion] = useState(0);
  /**
   * LES BARRAGES REPOSITIONNÉS — id → { statut, ts, avant, apres, impact… }.
   *
   * RENDUS PAR LE SERVEUR (GET /api/barrages/repositionnements), relus au
   * chargement, toutes les 30 s, après un déplacement et après une décision :
   * le repère survit donc au rechargement de la page, et son statut — SAVED,
   * APPROVED, PENDING_APPROVAL — n'est jamais décidé ici. « Vu » ne fait que
   * masquer le repère pour ce compte, dans ce navigateur (voir `reperesVus`).
   */
  const [repositionnes, setRepositionnes] = useState(() => new Map());
  /** Le dernier changement OFFICIEL de position connu — { nom, ts } — pour le panneau. */
  const [positionChangee, setPositionChangee] = useState(null);
  const chargerRepositionnementsRef = useRef(() => { });
  /**
   * PLACEMENT D'UN DÉPLACEMENT SIMULÉ (optimisation manuelle) — { barrageId, nom }.
   * Le clic suivant sur la carte devient la position choisie par l'opérateur ;
   * le serveur la recale, la mesure et la renvoie. Rien n'est écrit.
   */
  const [placementSimulation, setPlacementSimulation] = useState(null);
  /** La proposition dont la bulle s'ouvre d'elle-même (celle qu'on vient de placer). */
  const [propositionOuverte, setPropositionOuverte] = useState(null);
  const viderPropositionOuverte = useCallback(() => setPropositionOuverte(null), []);
  /**
   * STABLE, et c'est voulu : le panneau publie ses résultats dans un effet qui
   * dépend de `deciderSimulation`, lequel dépendait de ce rappel. Une fonction
   * fléchée recréée à chaque rendu de la carte relançait la publication, qui
   * re-rendait la carte, qui recréait la fonction — une boucle de rendus.
   */
  const demanderPlacement = useCallback((x) => {
    setPropositionOuverte(null);
    setPlacementSimulation(x);
  }, []);
  /** Avance à chaque restauration de la référence de présentation — le panneau Optimisation s'y remet à zéro. */
  const [presentationVersion, setPresentationVersion] = useState(0);
  const carte = useRef(null);

  const marquagesAnalysis = useMemo(
    () =>
      computeMarquagesAnalysis(items, alertes, {
        estImportant: MQ.estImportant,
        scoreImportance: MQ.scoreImportance,
      }),
    [items, alertes],
  );

  const comparaisonPeriodes = useMemo(
    () =>
      comparerPeriodes(
        items,
        alertes,
        { estImportant: MQ.estImportant, scoreImportance: MQ.scoreImportance },
        periodeComparaison,
      ),
    [items, alertes, periodeComparaison],
  );

  /** Toute erreur d'API devient un message lisible, jamais une exception muette. */
  const signaler = useCallback(
    (err) => {
      setMqMessage({
        ok: false,
        texte:
          err?.statut === 0
            ? "Serveur d'habilitation injoignable : réessayez, ou prévenez l'administrateur."
            : (err?.message ?? 'Erreur inattendue.'),
      });
      if (err?.statut === 401) {
        setSession(null);
        if (onLogout) onLogout();
      }
    },
    [onLogout],
  );

  /**
   * Premier contact avec l'API : état du service, marquages déjà enregistrés, et
   * session éventuellement encore ouverte (le cookie survit à un rechargement
   * de page, pas à un redémarrage du serveur).
   */
  useEffect(() => {
    let annule = false;

    (async () => {
      try {
        const [etat, liste, alertesInit, notifsInit] = await Promise.all([
          API.etatService(),
          API.listerMarquages(),
          API.listerAlertes().catch(() => ({ items: [] })),
          /* Sans session, la route répond 401 : la carte reste consultable, la
             cloche reste vide. */
          API.listerNotifications().catch(() => []),
        ]);
        if (annule) return;
        setService(etat);
        setItems(liste);
        setAlertes(alertesInit.items);
        setNotifications(notifsInit);
      } catch {
        if (!annule) setService({ indisponible: true });
        return;
      }
    })();

    return () => {
      annule = true;
    };
  }, []);

  /**
   * LES FACTIONS, RELUES QUAND ELLES PEUVENT AVOIR CHANGÉ.
   *
   * Trois déclencheurs, et chacun ferme un cas réel :
   *
   *   la SESSION    les affectations sont filtrées par le périmètre du compte ;
   *                 une connexion change donc ce qu'on a le droit de voir ;
   *   les ITEMS     poser, retirer ou restaurer un barrage change les comptes
   *                 par faction. Sans ce lien, les chiffres du filtre
   *                 resteraient sur l'état d'avant l'écriture ;
   *   le TEMPS      « Faction actuelle » doit basculer à 06h00, 12h00, 18h00 et
   *                 minuit sans qu'on recharge la page. Le serveur seul sait
   *                 quand : on le lui redemande toutes les cinq minutes, ce qui
   *                 borne le retard d'affichage sans rien interroger en boucle.
   */
  useEffect(() => {
    if (!session) {
      setFactions(null);
      return undefined;
    }
    let annule = false;
    const relire = () => {
      API.listerFactions()
        .then((r) => {
          if (!annule) setFactions(r);
        })
        .catch(() => {
          /* Un serveur sans la route des factions (paquet plus ancien) ne doit
             pas casser la carte : le filtre ne s'affiche simplement pas. */
          if (!annule) setFactions(null);
        });
    };
    relire();
    const minuterie = setInterval(relire, 5 * 60 * 1000);
    return () => {
      annule = true;
      clearInterval(minuterie);
    };
  }, [session, items]);

  /**
   * Listes d'unités (régions, compagnies, brigades), chargées dès qu'une
   * session existe.
   *
   * POURQUOI PLUS AUCUN DÉCLENCHEUR PAR PANNEAU
   * -------------------------------------------
   * Le chargement était différé à l'ouverture du premier panneau qui s'en
   * sert. Il fallait donc penser à inscrire chaque nouveau panneau dans la
   * condition — et l'oubli ne se voyait pas : aucune erreur, aucun message,
   * simplement une liste de périmètres vide et un « Aucune unité ne
   * correspond » incompréhensible pour qui cherche sa région.
   *
   * La faute a été commise deux fois, d'abord avec Optimisation, puis avec la
   * gestion des barrages du panneau d'administration. Un piège qui se referme
   * deux fois n'est pas une inattention, c'est une mauvaise conception : la
   * charge utile fait 31 ko et arrive en une dizaine de millisecondes. Elle
   * est désormais chargée une fois pour toutes, et aucun panneau à venir n'aura
   * à s'en préoccuper.
   */
  useEffect(() => {
    if (!session || unitesApi || service?.indisponible) return;
    API.unites()
      .then(setUnitesApi)
      .catch(() => setUnitesApi({ compagnies: [], regions: [], unites: [] }));
  }, [session, unitesApi, service]);

  /**
   * Contours nécessaires au tracé du périmètre : ceux de la compagnie pour un
   * chef de compagnie, ceux des régions pour un chef de région. Chargés dès
   * qu'une session existe, indépendamment du panneau Saisie ou des couches
   * affichées — la connexion peut venir du portail plein écran (Login.jsx),
   * qui arrive avant même que ce panneau soit ouvert.
   */
  /**
   * Circonscription correspondant au rang connecté : le découpage que ce chef
   * commande. `admin` n'a pas de périmètre (voir serveur/geo.mjs) — on lui
   * associe le découpage régional, qui est la lecture nationale de la carte.
   */
  const COUCHE_DU_RANG = {
    unite: 'circo_bt',
    cie: 'circo_cie',
    reg: 'circo_reg',
    admin: 'circo_reg',
  };
  const coucheDuRang = COUCHE_DU_RANG[session?.rang] ?? 'circo_cie';

  /** `admin` n'a pas de périmètre : aucun contour à charger pour le tracer. */
  useEffect(() => {
    if (session && session.rang !== 'admin' && !store[coucheDuRang]) {
      load(coucheDuRang, urlFor(coucheDuRang));
    }
  }, [session, coucheDuRang, store, load, urlFor]);

  /**
   * LA COUCHE DU RANG N'EST PLUS COCHÉE D'OFFICE À LA CONNEXION.
   *
   * Elle l'était pour qu'un chef arrive sur SON découpage plutôt que sur une
   * carte nue. Le zoom s'en charge désormais : la connexion cadre sur le
   * périmètre (effet `fitBounds` ci-dessous), et l'échelon correspondant
   * apparaît de lui-même une fois sur place — voir `visibiliteLimites`.
   *
   * Garder la case cochée serait devenu nuisible : une case cochée FORCE
   * l'affichage à tous les zooms, et un chef de brigade se serait retrouvé
   * avec les 500 circonscriptions du pays en travers de la vue nationale —
   * exactement le treillis que ce dispositif supprime.
   */

  /**
   * Périmètre affiché. Le serveur fait le même calcul de son côté : celui-ci ne
   * sert qu'à montrer la limite et à prévenir avant l'envoi. `admin` n'en a
   * aucun — `null` désactive le tracé et le pré-contrôle (voir `preControle`).
   */
  const perimetre = useMemo(() => {
    if (!session || session.rang === 'admin') return null;
    const fc = store[coucheDuRang]?.data;
    if (!fc) return null;
    return fc.features.find((f) => nomCirco(f.properties) === session.unite) ?? null;
  }, [store, coucheDuRang, session]);

  /**
   * BORNES DE LA CARTE — la zone du compte, et rien d'autre.
   *
   * Dérivées du périmètre déjà calculé plus haut : un chef de brigade est
   * borné à sa brigade, un chef de compagnie à sa compagnie (donc à toutes ses
   * brigades), un chef de région à sa région, l'administrateur au pays. La
   * marge de 6 % évite de coller le contour au bord de l'écran — on doit voir
   * ce qui touche sa limite, sinon on travaille le nez sur la frontière.
   *
   * `admin` n'a pas de périmètre : `BORNES_MAROC`, le cadre national, comme
   * avant. Voir `LimiterAuTerritoire`, seul endroit qui applique la borne.
   */
  const bornesPortee = useMemo(() => {
    if (!perimetre) return BORNES_MAROC;
    try {
      const b = L.geoJSON(perimetre).getBounds();
      return b.isValid() ? b.pad(0.06) : BORNES_MAROC;
    } catch {
      return BORNES_MAROC; // géométrie inexploitable : on ne bloque pas la carte
    }
  }, [perimetre]);

  /**
   * Cadrage automatique sur le périmètre à la connexion : un chef de région
   * ou de compagnie n'a pas à chercher sa zone sur la carte du pays entier —
   * elle est présentée dès que le contour est disponible. `admin` n'a pas de
   * périmètre (voir ci-dessus), donc pas de cadrage forcé pour lui : tout le
   * territoire reste la vue par défaut, cohérente avec son autorité.
   */
  useEffect(() => {
    if (!perimetre || !carte.current) return;
    const bounds = L.geoJSON(perimetre).getBounds();
    if (bounds.isValid()) carte.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [perimetre]);

  /**
   * CADRAGE SUR UNE CIRCONSCRIPTION DEMANDÉ PAR UN PANNEAU
   * -----------------------------------------------------
   * Choisir une région ou une compagnie dans le panneau Optimisation ne
   * bougeait pas la carte : on réglait le périmètre du calcul à l'aveugle,
   * puis on cherchait soi-même la zone concernée sur la carte du pays entier.
   * La sélection amène désormais la vue sur place.
   *
   * En deux temps, parce que le contour n'est pas toujours déjà chargé : on
   * enregistre la cible, on coche la couche correspondante — ce qui déclenche
   * son téléchargement — et l'effet ci-dessous cadre dès que la donnée arrive.
   * Sans ce report, choisir une compagnie alors que la couche des compagnies
   * n'a jamais été affichée ne produirait rien du tout.
   */
  const [cibleCadrage, setCibleCadrage] = useState(null);
  /**
   * Zone mise au point par un panneau (Filtrer, Optimisation) : la carte s'y
   * rend ET tout le reste passe sous la brume. Choisir une région dans un
   * panneau, c'est déclarer qu'on ne travaille plus que sur elle ; la carte
   * doit le dire aussi, sinon on lit un résultat régional sur une carte
   * nationale et l'on croit voir des repères qui n'en font pas partie.
   */
  const [zoneFocus, setZoneFocus] = useState(null); // {nom, geometry} | null

  /**
   * ENTITÉ OÙ L'ON VIENT DE SE RENDRE — son contour, et lui seul.
   *
   * Cadrer une région ou une compagnie sans tracer sa limite laisse la
   * question ouverte : les repères groupés au centre de l'écran sont-ils tous
   * à elle ? La limite répond, et elle est aussi le seul repère visuel qui
   * survit au déplacement de la carte.
   *
   * Le contour de la SEULE entité visée est tracé. Afficher toute la couche
   * de son échelon — ce que faisait le cadrage venu des panneaux — répond à
   * une autre question (« comment le pays est-il découpé »), qui garde sa
   * case dans le panneau des couches.
   */
  const [contourVise, setContourVise] = useState(null); // {niveau, nom} | null

  /** Le contour demandé n'est pas forcément déjà téléchargé. */
  useEffect(() => {
    if (!contourVise) return;
    const couche = COUCHE_DU_NIVEAU[contourVise.niveau];
    if (couche && !store[couche]) load(couche, urlFor(couche));
  }, [contourVise, store, load, urlFor]);

  const featureContourVise = useMemo(() => {
    if (!contourVise) return null;
    const couche = COUCHE_DU_NIVEAU[contourVise.niveau];
    return trouverContour(store[couche]?.data, contourVise.nom);
  }, [contourVise, store]);

  const couleurContourVise =
    contourVise?.niveau === 'region'
      ? COLORS.reg
      : contourVise?.niveau === 'compagnie'
        ? COLORS.cie
        : COLORS.bt;

  /**
   * PORTÉE D'UN CONTOUR — la même règle que pour les repères.
   *
   * `MQ.dansSaPortee` dérive de `perimetreImpose`, l'unique table des rangs
   * (voir src/marquages.js). Le clic sur une circonscription obéit donc au
   * même cloisonnement que la visibilité des barrages et que le serveur : il
   * n'y a pas deux définitions de « ma zone » dans cette application.
   *
   * L'ascendance du contour se lit dans ses propres attributs : `reg` sur une
   * compagnie, `gr_cie`/`gr_region` sur une brigade (voir build-layers).
   */
  const NIVEAU_DE_LA_COUCHE = { circo_reg: 'region', circo_cie: 'compagnie', circo_bt: 'brigade' };

  const contourDansLaPortee = useCallback(
    (cle) => (nom, proprietes) =>
      MQ.dansSaPortee(session, NIVEAU_DE_LA_COUCHE[cle], nom, {
        reg: proprietes?.reg ?? proprietes?.gr_region ?? null,
        cie: proprietes?.gr_cie ?? null,
      }),
    [session],
  );

  const refuserContour = useCallback(
    (nom) => setMqMessage({ ok: false, texte: `${nom} — ${MQ.motifHorsPortee(session)}` }),
    [session],
  );

  const cadrerCirconscription = useCallback((niveau, nom) => {
    const couche = COUCHE_DU_NIVEAU[niveau];
    /* Retour à « toutes » : on lève la brume plutôt que de la laisser sur une
       zone qui n'est plus sélectionnée. */
    if (!couche || !nom || nom === 'toutes') {
      setZoneFocus(null);
      setCibleCadrage(null);
      setContourVise(null);
      setContexteNavigation({});
      return;
    }
    /* Tracer le contour, et pas seulement s'en approcher : c'est lui qui
       montre ce que le calcul va prendre en compte. Celui de l'entité
       choisie uniquement — la couche entière de son échelon reste une case
       du panneau, que ce geste n'a plus à cocher à la place du chef. */
    setContourVise({ niveau, nom });
    setCibleCadrage({ couche, nom });
    const reference = items.find((m) =>
      niveau === 'region' ? m.reg === nom : niveau === 'compagnie' ? m.cie === nom : m.bt === nom,
    );
    setContexteNavigation(
      niveau === 'region'
        ? { region: nom }
        : niveau === 'compagnie'
          ? { region: reference?.reg, compagnie: nom }
          : { region: reference?.reg, compagnie: reference?.cie, brigade: nom },
    );
  }, [items]);

  useEffect(() => {
    if (!cibleCadrage || !carte.current) return;
    const fc = store[cibleCadrage.couche]?.data;
    if (!fc) return; // couche en cours de chargement : l'effet repassera

    const f = fc.features.find((x) => nomCirco(x.properties) === cibleCadrage.nom);
    if (f) {
      const bounds = L.geoJSON(f).getBounds();
      /* Mouvement de caméra natif, doux, jusqu'au CONTOUR réel de l'entité. */
      if (bounds.isValid()) {
        if (mouvementReduit()) carte.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        else carte.current.flyToBounds(bounds, { padding: [40, 40], maxZoom: 13, duration: 1.0, easeLinearity: 0.3 });
      }
      /* La brume suit le cadrage : même geste, même zone. */
      setZoneFocus({ nom: cibleCadrage.nom, geometry: f.geometry });
    } else {
      setZoneFocus(null);
    }
    setCibleCadrage(null); // consommée, qu'on ait trouvé ou non
  }, [cibleCadrage, store]);

  /**
   * Pré-contrôle local, purement informatif.
   *
   * Le serveur refait ce test et c'est le sien qui décide ; celui-ci évite un
   * aller-retour réseau pour un clic manifestement hors zone, et permet de
   * remettre un repère glissé à sa place sans attendre la réponse.
   *
   * Trois réponses et non deux : « autorisé », « refusé », et « contour pas
   * encore chargé » — sans ce dernier cas, une couche en cours de
   * téléchargement produirait un refus incompréhensible.
   */
  const preControle = useCallback(
    (lngLat) => {
      if (session?.rang === 'admin') return 'autorise'; // aucun périmètre à vérifier
      if (!perimetre) return 'inconnu';
      return turf.booleanPointInPolygon(lngLat, perimetre) ? 'autorise' : 'refuse';
    },
    [perimetre, session],
  );

  /** Marquages relevant de l'unité connectée (les seuls modifiables). */
  /* Le périmètre, et non l'autorité : la liste montre la circonscription. Les
     commandes de chaque ligne sont gardées séparément (voir MarquagePanel). */
  const mesMarquages = useMemo(
    () => items.filter((m) => MQ.dansSonPerimetre(session, m)),
    [items, session],
  );

  /**
   * Importance de chaque point noir (nature `accident`) : filtre + distance à
   * vol d'oiseau au point important le plus proche. Information seulement —
   * l'annotation ne bloque rien, elle aide le chef à juger. La distance
   * RÉELLE (par la route) n'entre en jeu qu'entre barrages, où elle est
   * calculée et tranchée par le serveur (voir `serveur/distances.mjs`).
   */
  const importants = useMemo(() => {
    const noirs = items.filter((m) => m.type === 'accident');
    const pointsImportants = noirs.filter((m) => MQ.estImportant(m));
    const map = new Map();

    for (const m of noirs) {
      const important = MQ.estImportant(m);
      let distanceProcheKm = null;
      if (important) {
        for (const autre of pointsImportants) {
          if (autre.id === m.id) continue;
          const d = RT.distanceKm(m.lng, m.lat, autre.lng, autre.lat);
          if (distanceProcheKm == null || d < distanceProcheKm) distanceProcheKm = d;
        }
      }
      map.set(m.id, { important, distanceProcheKm });
    }
    return map;
  }, [items]);

  /**
   * Alertes enrichies des deux barrages concernés — pour la carte, où TOUTES
   * les alertes ouvertes s'affichent (la consultation reste ouverte à tous,
   * comme pour les marquages eux-mêmes).
   */
  const alertesEnrichies = useMemo(() => {
    const parId = new Map(items.map((m) => [m.id, m]));
    return alertes.map((al) => ({
      ...al,
      a: parId.get(al.checkpointAId) ?? null,
      b: parId.get(al.checkpointBId) ?? null,
    }));
  }, [alertes, items]);

  /**
   * Volet terrain de la fiche de circonscription sélectionnée (panneau
   * Analyse) : barrages et points noirs DE cette seule circonscription (pas
   * le national de `marquagesAnalysis`) — distance respectée, validation,
   * éclairage… voir `analyserMarquagesFiche`.
   */
  const ficheMarquages = useMemo(() => {
    if (!selection) return null;
    const champ = { circo_cie: 'cie', circo_bt: 'bt' }[selection.couche] ?? 'reg';
    return analyserMarquagesFiche(items, alertesEnrichies, selection.nom, champ, MQ.estImportant);
  }, [selection, items, alertesEnrichies]);

  /**
   * Couverture opérationnelle (barrages isolés, points stratégiques non
   * couverts) — croisée avec les pointages de flotte réellement postés.
   * `items` est déjà scopé par le serveur au périmètre de la session : un
   * chef de région obtient donc directement le rapport de SA région.
   */
  const couvertureOperationnelle = useMemo(
    () =>
      analyserCouverture({
        items,
        pointagesFeatures: store.pointages?.data?.features,
        distance: turf.distance,
      }),
    [items, store.pointages],
  );

  /** Efficacité des barrages générés depuis un point noir — voir analysis.js. */
  const efficaciteBarrages = useMemo(() => analyserEfficaciteBarrages(items), [items]);

  const rafraichirAlertes = useCallback(() => {
    API.listerAlertes()
      .then((r) => setAlertes(r.items))
      .catch(() => { });
  }, []);

  /**
   * NOTIFICATIONS de la session — le serveur ne renvoie que ce qui relève de
   * son périmètre, ou ce qu'elle a elle-même émis.
   *
   * Rechargées à chaque événement qui peut en produire (décision, pose d'un
   * barrage, arbitrage du commandant) plutôt qu'à intervalle régulier : sur un
   * intranet à quelques postes, un sondage permanent coûterait plus qu'il ne
   * rapporterait, et la fraîcheur ne serait pas meilleure.
   */
  const rafraichirDemandes = useCallback(() => {
    API.listerDemandes()
      .then((demandes) => {
        if (!Array.isArray(demandes)) return;
        const enAttente = demandes.filter((d) => {
          if (session?.rang === 'reg') {
            return d.statut === 'en_attente_region' || d.statut === 'modifiee_region';
          }
          if (session?.rang === 'admin') {
            return d.statut === 'en_attente_admin';
          }
          if (session?.rang === 'cie') {
            return d.statut === 'retournee_cie';
          }
          return false;
        }).length;
        setDemandesEnAttente(enAttente);
      })
      .catch(() => { });
  }, [session]);

  const rafraichirNotifications = useCallback(() => {
    API.listerNotifications()
      .then(setNotifications)
      .catch(() => { });
    rafraichirDemandes();
  }, [rafraichirDemandes]);

  useEffect(() => {
    if (session) {
      rafraichirDemandes();
    }
  }, [session, versionDemandes, rafraichirDemandes]);

  /**
   * Génération manuelle d'UN barrage depuis un point noir précis (bouton
   * dans sa fiche) : aucun critère d'importance ni de distance minimale —
   * un choix humain déjà délibéré sur ce point noir, à l'opposé du filtre de
   * génération en masse ci-dessus.
   */
  const genererBarrageManuel = useCallback(
    async (pointNoirId, type) => {
      if (!session) return;
      setGenerationEnCours(true);
      try {
        const r = await API.genererBarrages({ pointNoirId, type });
        setItems((prev) => [...prev, ...r.generes]);
        setMqMessage({
          ok: true,
          texte: 'Barrage généré depuis ce point noir.',
        });
        rafraichirAlertes();
      } catch (err) {
        signaler(err);
      } finally {
        setGenerationEnCours(false);
      }
    },
    [session, signaler, rafraichirAlertes],
  );

  /* ---- Connexion ---- */

  const deconnexion = useCallback(async () => {
    try {
      await API.deconnexion();
    } catch {
      /* la session est de toute façon abandonnée côté client */
    }
    setSession(null);
    setArme(null);
    setMqSelection(null);
    setMqMessage({ ok: true, texte: 'Session fermée.' });
    if (onLogout) onLogout();
  }, [onLogout]);

  /* ---- Écritures : le serveur tranche, l'interface rend compte ---- */

  /** Création effective d'un repère, une fois l'autorisation de périmètre acquise. */
  const creerMarquagePoint = useCallback(
    async (type, lngLat, extra = {}) => {
      setOccupe(true);
      try {
        const item = await API.creerMarquage({
          type,
          lng: lngLat[0],
          lat: lngLat[1],
          ...extra,
        });
        setItems((prev) => [...prev, item]);
        setMqSelection(item.id); // la fiche s'ouvre : le reste (lieu, route, observation) s'y complète
        setMqMessage({
          ok: true,
          texte:
            `${MQ.TYPE_PAR_CLE[type].fr} posé.` +
            (Object.keys(extra).length ? '' : ' Complétez sa fiche.'),
        });
        if (MQ.estBarrage({ type })) {
          rafraichirAlertes();
          /* Le serveur vient d'émettre une notification « nouveau barrage » —
             voir POST /api/marquages. On la fait apparaître sans attendre : le
             chef doit voir partir son propre signalement. */
          rafraichirNotifications();
        }
        return item;
      } catch (err) {
        signaler(err);
        return null;
      } finally {
        setOccupe(false);
      }
    },
    [signaler, rafraichirAlertes],
  );

  /**
   * Création d'un point noir en trois temps, dans cet ordre :
   *   1. saisie        — la modale de qualification (accidents/activité/
   *                       infraction/position ville/éclairage), AVANT toute
   *                       position ;
   *   2. position       — un clic sur la carte place un repère provisoire,
   *                       déplaçable ;
   *   3. confirmation   — rien n'est envoyé au serveur tant que
   *                       « Confirmer l'emplacement » n'a pas été cliqué.
   *
   * `pointNoirSaisie` = données validées (phase ≥ position atteinte).
   * `pointNoirPosition` = position provisoire choisie (phase = confirmation).
   * Les deux `null` : la modale de saisie est affichée (voir le rendu plus bas).
   */
  const [pointNoirSaisie, setPointNoirSaisie] = useState(null);
  const [pointNoirPosition, setPointNoirPosition] = useState(null);

  /**
   * Même principe que le point noir (position provisoire avant tout envoi),
   * généralisé aux autres natures (barrage fixe/mobile, congestion) :
   * `{type, lngLat, exceptionnel}` tant que non confirmé, `null` sinon. Ces
   * natures n'ont pas d'étape de qualification préalable (la fiche se
   * complète après coup), donc une seule barre de confirmation suffit — pas
   * besoin d'un `xxxSaisie` séparé comme pour l'accident.
   */
  const [posePosition, setPosePosition] = useState(null);

  /**
   * Aperçu d'une région pendant la pose d'un point noir : le reste du
   * territoire s'assombrit (même « brume » que la sélection d'analyse, voir
   * plus bas), pour mieux voir où cliquer. Purement visuel — l'autorité
   * d'écriture reste celle du périmètre de la session, pas de la région
   * survolée ici.
   */
  const [regionApercu, setRegionApercu] = useState(null); // {nom, geometry}

  useEffect(() => {
    if (arme === 'accident' && pointNoirSaisie && !store.circo_reg)
      load('circo_reg', urlFor('circo_reg'));
  }, [arme, pointNoirSaisie, store, load, urlFor]);

  const regions = useMemo(
    () =>
      (store.circo_reg?.data?.features ?? [])
        .map((f) => f.properties?.nom)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'fr')),
    [store.circo_reg],
  );

  const apercevoirRegion = useCallback(
    (nom) => {
      const feature = store.circo_reg?.data?.features?.find((f) => f.properties?.nom === nom);
      if (!feature) return;
      setRegionApercu({ nom, geometry: feature.geometry });
      try {
        const bounds = L.geoJSON(feature).getBounds();
        if (bounds.isValid()) carte.current?.fitBounds(bounds, { padding: [48, 48], maxZoom: 12 });
      } catch {
        /* bornes invalides : la région reste tout de même isolée par la brume */
      }
    },
    [store.circo_reg],
  );

  const effacerApercuRegion = useCallback(() => setRegionApercu(null), []);

  const annulerPointNoir = useCallback(() => {
    setPointNoirSaisie(null);
    setPointNoirPosition(null);
    setRegionApercu(null);
    setArme(null);
  }, []);

  const confirmerPointNoir = useCallback(async () => {
    if (!pointNoirPosition || !pointNoirSaisie) return;
    await creerMarquagePoint('accident', pointNoirPosition, pointNoirSaisie);
    setPointNoirPosition(null);
    setPointNoirSaisie(null);
    // `arme` reste sur 'accident' : la modale de saisie se rouvre aussitôt pour
    // le point noir suivant, comme les autres natures qui restent armées.
  }, [pointNoirPosition, pointNoirSaisie, creerMarquagePoint]);

  /**
   * Place (ou déplace) le repère provisoire d'un point noir, que la position
   * vienne d'un clic sur la carte OU d'une saisie manuelle de coordonnées GPS
   * (voir la barre de confirmation, plus bas) — même contrôle de périmètre
   * dans les deux cas, rien n'est envoyé au serveur avant confirmation.
   * @returns true si la position a été acceptée
   */
  const situerPointNoir = useCallback(
    (lngLat) => {
      const verdict = preControle(lngLat);
      if (verdict !== 'autorise') {
        setMqMessage({
          ok: false,
          texte:
            verdict === 'inconnu'
              ? 'Contour de votre unité pas encore chargé : réessayez dans un instant.'
              : `Point hors de votre ${motPerimetre(session?.rang)} : pose refusée.`,
        });
        return false;
      }
      setPointNoirPosition(lngLat);
      return true;
    },
    [preControle, session],
  );

  /**
   * Pose d'un repère. Rien n'est affiché avant la confirmation du serveur.
   *
   * Un point noir suit trois temps (saisie -> position -> confirmation, voir
   * ci-dessus) : tant que la saisie n'est pas validée, la modale bloque tout
   * clic sur la carte ; une fois validée, chaque clic pose ou repositionne un
   * repère PROVISOIRE, sans rien envoyer au serveur avant confirmation. Les
   * autres natures suivent maintenant le même principe à deux temps
   * (position -> confirmation, voir `posePosition`), juste sans étape de
   * qualification préalable.
   */
  const poser = useCallback(
    (lngLat) => {
      if (!arme || !session) return;

      if (arme === 'accident') {
        if (!pointNoirSaisie) return; // la modale de saisie doit être validée d'abord
        situerPointNoir(lngLat);
        return;
      }

      const verdict = preControle(lngLat);
      if (verdict !== 'autorise') {
        setMqMessage({
          ok: false,
          texte:
            verdict === 'inconnu'
              ? 'Contour de votre unité pas encore chargé : réessayez dans un instant.'
              : `Point hors de votre ${motPerimetre(session.rang)} : pose refusée.`,
        });
        return;
      }

      setPosePosition({ type: arme, lngLat });
    },
    [arme, session, pointNoirSaisie, situerPointNoir, preControle],
  );

  /** Doublon probable pour la pose en cours — point noir ou générique, même détection. */
  const doublonPointNoir = useMemo(
    () => (pointNoirPosition ? chercherDoublon('accident', pointNoirPosition, items) : null),
    [pointNoirPosition, items],
  );
  const doublonPose = useMemo(
    () => (posePosition ? chercherDoublon(posePosition.type, posePosition.lngLat, items) : null),
    [posePosition, items],
  );

  /** Ouvre le marquage repéré comme doublon probable, à la place d'en créer un nouveau. */
  const ouvrirDoublon = useCallback((m) => {
    setMqSelection(m.id);
    setModal3DItem(m);
    setPointNoirPosition(null);
    setPointNoirSaisie(null);
    setPosePosition(null);
  }, []);

  const deplacerPose = useCallback(
    (lngLat) => {
      const verdict = preControle(lngLat);
      if (verdict !== 'autorise') {
        setMqMessage({
          ok: false,
          texte:
            verdict === 'inconnu'
              ? 'Contour de votre unité pas encore chargé : réessayez dans un instant.'
              : `Point hors de votre ${motPerimetre(session?.rang)} : pose refusée.`,
        });
        return;
      }
      setPosePosition((p) => (p ? { ...p, lngLat } : p));
    },
    [preControle, session],
  );

  const annulerPose = useCallback(() => setPosePosition(null), []);

  /**
   * UN BARRAGE VIP PASSE PAR SA COMPOSITION AVANT D'ÊTRE CRÉÉ.
   *
   * Les autres natures se posent d'un clic et se complètent ensuite. Un VIP ne
   * le peut pas : la règle veut exactement quatre éléments, et un poste créé
   * vide la violerait le temps qu'on l'arme — indéfiniment, si le second geste
   * n'a jamais lieu. La confirmation d'emplacement ouvre donc l'écran de
   * composition, et c'est LUI qui crée.
   */
  const [compositionVIP, setCompositionVIP] = useState(null);

  const confirmerPose = useCallback(async () => {
    if (!posePosition) return;
    if (posePosition.type === 'barrage_vip') {
      setCompositionVIP(posePosition.lngLat);
      return;
    }
    await creerMarquagePoint(posePosition.type, posePosition.lngLat);
    setPosePosition(null);
  }, [posePosition, creerMarquagePoint]);

  const annulerCompositionVIP = useCallback(() => setCompositionVIP(null), []);

  const creerVIP = useCallback(
    async (elements) => {
      if (!compositionVIP) return;
      /* `elements` part dans le MÊME envoi que le poste : le serveur écrit les
         deux ensemble, et défait le poste si l'un des quatre est refusé. */
      const item = await creerMarquagePoint('barrage_vip', compositionVIP, { elements });
      if (item) {
        setCompositionVIP(null);
        setPosePosition(null);
      }
    },
    [compositionVIP, creerMarquagePoint],
  );

  /**
   * Une pose en attente de confirmation devient orpheline si l'outil change
   * en cours de route (autre nature armée, outil de zone/mission/jalon pris
   * en priorité, panneau fermé, déconnexion…) : plutôt que de patcher chacun
   * de ces déclencheurs, on referme simplement dès que l'outil armé ne
   * correspond plus à la pose en cours.
   */
  useEffect(() => {
    if (posePosition && arme !== posePosition.type) setPosePosition(null);
  }, [arme, posePosition]);

  /**
   * Correction de position par glissement.
   *
   * Le repère est remis à sa position enregistrée dès que le serveur refuse :
   * l'affichage ne doit jamais montrer une position que le serveur n'a pas
   * acceptée, sinon le chef croirait sa correction prise en compte.
   */
  const deplacer = useCallback(
    async (item, lngLat, route, extraOptions = {}) => {
      const verdict = preControle(lngLat);
      if (verdict !== 'autorise') {
        setMqMessage({
          ok: false,
          texte:
            verdict === 'inconnu'
              ? 'Contour de votre unité pas encore chargé : déplacement annulé.'
              : 'Déplacement hors de votre périmètre : le repère est revenu à sa position.',
        });
        return;
      }

      try {
        /* PATCH /api/marquages/:id — la route de modification existante. Le
           serveur refait le contrôle de périmètre, rattache le point à sa
           brigade/compagnie/région, recalcule le PK, refuse un intouchable,
           et met en validation ce qui doit l'être (202). */
        /* La ROUTE part avec la position : c'est la voie sur laquelle le point
           vient d'être recalé, et c'est sur elle que le serveur recalcule le
           PK. Sans elle, le poste garderait l'axe de son ancienne position. */
        /* Le seuil de l'optimisation affichée : le serveur réévalue les conflits
           du poste avec lui (voir actualiserApresOperation). */
        const seuilKm = extraOptions.seuilKm ?? optimisationResultats?.seuilKm ?? undefined;
        const no = ++demandeDeplacementNo.current;
        const r = await API.deplacerMarquage(item.id, { lng: lngLat[0], lat: lngLat[1], route, ...(seuilKm ? { seuilKm } : {}), ...extraOptions });
        /* Les conflits réévalués côté serveur : la liste est relue, et le bilan
           s'affiche — sauf si un déplacement plus récent a déjà répondu. */
        setVersionConflits((v) => v + 1);
        if (no === demandeDeplacementNo.current) setReevaluation(r.reevaluation ? { ...r.reevaluation, ts: Date.now() } : null);
        const maj = r.item;
        setItems((prev) => prev.map((m) => (m.id === maj.id ? maj : m)));
        /**
         * LE CHANGEMENT SE VOIT — position écrite, pas une demande en attente.
         *
         * Le poste est redessiné à sa nouvelle place (le repère « barrage
         * nouvellement posé » et sa bulle ont été retirés de la carte) ; la carte s'y
         * rend ; et le dispositif ayant changé, l'optimisation manuelle refait
         * sa mesure sur la position réelle (`dispositifVersion`).
         *
         * Une demande soumise à validation (202) ne bouge pas le poste officiel :
         * le repère se pose alors à la position DEMANDÉE, marqué « en attente de
         * validation », et rien n'est remesuré — le dispositif n'a pas changé.
         */
        if (MQ.estBarrage(maj)) {
          const vers = r.enAttente ? { lng: lngLat[0], lat: lngLat[1] } : maj;
          /* Le repère et, pour un changement officiel, la remesure (distances,
             conflits, optimisation) partent de la relecture serveur : une seule
             source, que la page soit rechargée ou non. */
          chargerRepositionnementsRef.current();
          carte.current?.flyTo([vers.lat, vers.lng], Math.max(carte.current.getZoom(), 13), { duration: 0.7 });
        }
        const compteRendu = {
          ok: true,
          texte: r.enAttente
            ? `${MQ.libelle(maj)} : déplacement transmis pour validation ` +
            `(${r.demande?.aDecider === 'admin' ? 'administration' : 'commandement de l’unité'}). ` +
            'La position officielle reste inchangée d’ici là.' +
''
            : `${MQ.libelle(maj)} repositionné` +
            `${maj.route ? ` sur ${maj.route}` : ''}${Number.isFinite(maj.pk) ? ` · PK ${maj.pk}` : ''}.` +
            (MQ.estBarrage(maj) ? ' Distances et conflits remesurés.' : ''),
        };
        setMqMessage(compteRendu);
        setMessageEdition(compteRendu);
        if (MQ.estBarrage(maj)) {
          rafraichirAlertes();
          signalerTraitement(maj.id);
        }
        rafraichirNotifications();
        return r;
      } catch (err) {
        signaler(err);
        setMessageEdition({ ok: false, texte: err.message });
        return false;
      }
    },
    [preControle, signaler, rafraichirAlertes, rafraichirNotifications, signalerTraitement, optimisationResultats?.seuilKm],
  );

  /**
   * Modification des champs de la fiche.
   *
   * L'affichage est mis à jour immédiatement, sinon le champ perdrait les
   * caractères tapés pendant l'aller-retour réseau. L'envoi, lui, est regroupé :
   * une frappe = un PATCH = une réécriture du fichier serveur, ce qui ferait des
   * dizaines d'écritures disque pour un simple nom. Un demi-secondes de silence
   * suffit à n'en faire qu'une.
   */
  const patchsEnAttente = useRef(new Map()); // id -> minuteur

  const envoyerFiche = useCallback(
    async (item) => {
      try {
        const maj = await API.modifierMarquage(item.id, {
          nom: item.nom,
          route: item.route,
          note: item.note,
          debut: item.debut,
          fin: item.fin,
          // Point noir (accident) — voir MarquagePanel.jsx, bloc `accident`.
          accidentCount: item.accidentCount,
          severite: item.severite,
          activite: item.activite,
          infraction: item.infraction,
          positionVille: item.positionVille,
          eclairage: item.eclairage,
          // Barrages — patrouilles affectées.
          patrouilles: item.patrouilles,
          /**
           * Statut de validation du barrage (approuvé / à modifier / annulé).
           *
           * Il manquait ici, et le défaut était silencieux : les boutons de la
           * fiche changeaient l'état local, la pastille se mettait à jour,
           * l'enregistrement partait — sans ce champ. Le serveur conservait
           * donc l'ancienne valeur, et la décision disparaissait au
           * rechargement suivant sans qu'aucune erreur ne le signale.
           *
           * Envoyé seulement pour un administrateur, parce que c'est la règle
           * du serveur (`PATCH /api/marquages/:id`) : toute TENTATIVE de
           * changement par un autre rang est refusée en 403. Or une fiche
           * ancienne peut ne pas porter le champ ; le renvoyer systématiquement
           * ferait échouer, chez un non-administrateur, la simple correction
           * d'un nom.
           */
          ...(session?.rang === 'admin' ? { statutBarrage: item.statutBarrage } : {}),
          // Congestion (zahma) — sous-type (carrefour, entrée de ville, péage…).
          sousType: item.sousType,
          partage: item.partage,
        });
        // Seuls les champs d'autorité sont réécrits : le texte affiché reste
        // celui de l'utilisateur, pas celui qui revient du réseau.
        setItems((prev) =>
          prev.map((m) => (m.id === maj.id ? { ...m, maj: maj.maj, majPar: maj.majPar } : m)),
        );
      } catch (err) {
        signaler(err);
      }
    },
    [signaler, session],
  );

  /* ------------------------ « Modifier barrage » ------------------------ */
  const editionBarrage = editionBarrageId ? items.find((m) => m.id === editionBarrageId) ?? null : null;

  const fermerEdition = useCallback(() => setEditionBarrageId(null), []);

  /**
   * Réponse de l'enregistrement. 200 : le poste (et l'ancien intouchable
   * éventuellement remplacé) est à jour, on le pose tel quel dans la liste.
   * 202 : une demande est partie — la carte garde la version officielle, et
   * le message le dit, au lieu de laisser croire que c'est appliqué.
   */
  const apresModificationBarrage = useCallback(
    (r) => {
      setItems((prev) =>
        prev.map((m) =>
          m.id === r.item?.id ? r.item : m.id === r.remplace?.id ? r.remplace.item : m,
        ),
      );
      const nEff = (r.effectif?.ajoutes?.length ?? 0) + (r.effectif?.retires?.length ?? 0);
      const effTexte = nEff ? ` Effectif du créneau : ${r.apercu?.effectif?.demande} élément(s), appliqué.` : '';
      const compteRendu = {
        ok: true,
        texte: r.enAttente
          ? `${MQ.libelle(r.item)} : modification transmise pour validation ` +
          `(${r.demande?.aDecider === 'admin' ? 'administration' : 'commandement de l’unité'}).${effTexte}`
          : r.rien
            ? 'Aucune modification à enregistrer.'
            : `${MQ.libelle(r.item)} : modification enregistrée.${effTexte}`,
      };
      setMqMessage(compteRendu);
      setMessageEdition(compteRendu);
      fermerEdition();
      rafraichirNotifications();
      rafraichirAlertes();
    },
    [fermerEdition, rafraichirNotifications, rafraichirAlertes],
  );

  const modifierMq = useCallback(
    (item) => {
      setItems((prev) => prev.map((m) => (m.id === item.id ? item : m)));

      clearTimeout(patchsEnAttente.current.get(item.id));
      patchsEnAttente.current.set(
        item.id,
        setTimeout(() => {
          patchsEnAttente.current.delete(item.id);
          envoyerFiche(item);
        }, 500),
      );
    },
    [envoyerFiche],
  );

  /** Au démontage (page quittée), les minuteurs restants sont abandonnés. */
  useEffect(
    () => () => {
      for (const t of patchsEnAttente.current.values()) clearTimeout(t);
    },
    [],
  );

  const supprimerMq = useCallback(
    async (id) => {
      // Une modification encore en attente porterait sur un repère disparu :
      // elle échouerait en « introuvable » après coup.
      clearTimeout(patchsEnAttente.current.get(id));
      patchsEnAttente.current.delete(id);

      const supprime = items.find((m) => m.id === id);

      try {
        const r = await API.supprimerMarquage(id);

        /**
         * UN BARRAGE NE S'EFFACE PAS D'UN CLIC — il part en validation.
         *
         * Le serveur répond alors `enAttente` : le poste RESTE, marqué
         * « suppression en attente », et c'est la décision de l'autre bord qui
         * le retirera vraiment. Le faire disparaître ici donnerait à voir une
         * suppression qui n'a pas eu lieu — et le poste reviendrait au premier
         * rechargement, ce qui se lit comme une panne.
         *
         * Les autres marquages — points noirs, congestions — s'effacent
         * toujours immédiatement : le serveur les supprime et ne renvoie pas
         * `enAttente`.
         */
        if (r?.enAttente) {
          if (r.item) setItems((prev) => prev.map((m) => (m.id === id ? r.item : m)));
          setMqMessage({
            ok: true,
            texte: `${supprime?.nom || 'Ce poste'} : suppression demandée — en attente de validation.`,
          });
          rafraichirNotifications();
          if (MQ.estBarrage(supprime)) signalerTraitement(id);
          return;
        }

        setItems((prev) => prev.filter((m) => m.id !== id));
        setMqSelection((s) => (s === id ? null : s));
        setMqMessage({ ok: true, texte: 'Marquage supprimé.' });
        if (MQ.estBarrage(supprime)) {
          rafraichirAlertes();
          signalerTraitement(id);
        }
      } catch (err) {
        signaler(err);
      }
    },
    [items, signaler, rafraichirAlertes, rafraichirNotifications, signalerTraitement],
  );

  /**
   * DÉCISION PRISE SUR LA CARTE, barrage par barrage.
   *
   * Le panneau propose une liste ; ce bouton-ci tranche un cas précis, devant
   * le terrain qu'il concerne. C'est la différence entre valider un nombre et
   * décider d'un poste.
   *
   * LES DEUX DÉCISIONS SONT DE VRAIES ÉCRITURES, pas un changement d'affichage.
   * Elles empruntent la route de gestion en lot qui existait déjà pour les
   * barrages (`POST /api/barrages/lot`) : même garde d'autorité, même journal,
   * même réponse. Aucun second mécanisme de suppression n'a été créé.
   *
   * LE SUPER ADMIN PROPOSE ; LE COMMANDANT TRANCHE.
   *
   *   « retirer »      — le retrait est PROPOSÉ, rien n'est effacé. Le poste
   *                      passe en `a_supprimer`, porte un « ✗ » sur la carte,
   *                      et le commandant de sa région ou de sa compagnie est
   *                      notifié. C'est son acceptation qui déclenche
   *                      l'effacement réel, son refus qui rend le poste à son
   *                      état d'avant. Sans cette attente, il n'y aurait ni
   *                      repère à montrer ni décision à refuser.
   *   « garder »       — le barrage n'est touché en rien : ni position, ni
   *                      statut, ni aucun champ. Seule la marque
   *                      `decisionOptimisation` est posée — « ✓ » sur la carte
   *                      — et le commandant est notifié de même.
   *   « reconsiderer » — retire la marque ET la notification encore ouverte :
   *                      le poste redevient à trancher, personne n'a à se
   *                      prononcer sur une décision retirée.
   *
   * Les CRITÈRES du calcul partent avec la décision : c'est sur eux que le
   * commandant se prononcera, et les recalculer plus tard donnerait d'autres
   * chiffres que ceux qui ont motivé la proposition.
   */
  const deciderBarrageSignale = useCallback(
    async (item, choix) => {
      const ACTION = {
        retirer: 'proposer_suppression',
        garder: 'conserver',
        reconsiderer: 'reconsiderer',
      };
      const action = ACTION[choix];
      if (!action) return;

      /* La bulle reste OUVERTE le temps de l'écriture — c'est elle qui porte le
         voyant d'attente (voir DecisionPopup). On ne la referme qu'une fois le
         serveur revenu ; en cas d'échec elle reste là, avec le message. */
      try {
        const r = await API.actionLotBarrages(
          action,
          [item.id],
          optimisationResultats?.motifs?.get(item.id)?.criteres ?? null,
        );
        carte.current?.closePopup();
        if (r.items) setItems(r.items);
        /* La décision vient de créer (ou de retirer) une notification : la
           cloche doit le refléter tout de suite. */
        rafraichirNotifications();

        if (action === 'proposer_suppression') {
          /* Le poste reste en place — le dispositif n'a pas changé, donc aucun
             recalcul : c'est l'acceptation du commandant qui, elle, retirera
             réellement le barrage et relancera le voisinage. */
          setMqMessage({
            ok: true,
            texte: `${item.nom || 'Barrage'} : retrait proposé — le commandant a été notifié.`,
          });
        } else if (action === 'conserver') {
          setMqMessage({
            ok: true,
            texte: `${item.nom || 'Barrage'} conservé — le commandant a été notifié.`,
          });
        } else {
          setMqMessage({
            ok: true,
            texte: `${item.nom || 'Barrage'} : décision reprise.`,
          });
        }
      } catch (err) {
        signaler(err);
      }
    },
    /**
     * LE PANNEAU NE SE REFERME PLUS APRÈS UNE DÉCISION.
     *
     * Il le faisait, et c'était une faute : trancher est un geste RÉPÉTÉ — on
     * parcourt les dix postes signalés l'un après l'autre. Refermer après le
     * premier obligeait à rouvrir neuf fois.
     *
     * Pire, la fermeture effaçait le résultat de l'analyse : les neuf « ? »
     * restants disparaissaient de la carte d'un coup. « Revenir sur cette
     * décision » rendait bien le poste, mais il n'y avait plus aucun « ? » où
     * revenir — d'où l'impression que le bouton ne faisait rien.
     */
    [signaler, optimisationResultats, rafraichirNotifications],
  );

  /**
   * LE COMMANDANT TRANCHE — et c'est ici que la décision prend effet.
   *
   * Accepter un retrait proposé efface réellement le barrage, côté serveur, par
   * le même chemin que toute autre suppression. La réponse rapporte donc le
   * dépôt à jour : la carte se remet d'aplomb sans second aller-retour, et le
   * repère « ✗ » disparaît avec le poste qu'il désignait.
   */
  const deciderNotification = useCallback(
    async (n, decision, commentaire) => {
      try {
        const r = await API.deciderNotification(n.id, decision, commentaire);
        if (r.items) setItems(r.items);
        rafraichirNotifications();
        /* Une demande de déplacement acceptée change la position OFFICIELLE. */
        chargerRepositionnementsRef.current();
        /* Un retrait accepté change le voisinage de tous les autres postes :
           le panneau Optimisation doit refaire son calcul. */
        if (decision === 'accepter' && n.action === 'suppression') {
          rafraichirAlertes();
          setDispositifVersion((v) => v + 1);
        }
        setMqMessage({
          ok: true,
          texte:
            decision === 'accepter'
              ? `${n.barrage?.nom || 'Barrage'} : décision acceptée.`
              : `${n.barrage?.nom || 'Barrage'} : décision refusée.`,
        });
      } catch (err) {
        signaler(err);
      }
    },
    [signaler, rafraichirNotifications, rafraichirAlertes],
  );

  /**
   * « CETTE NOTIFICATION CONCERNE CE BARRAGE-LÀ » — le geste qui relie les deux.
   *
   * Le barrage est retrouvé PAR SON IDENTIFIANT (`n.barrageId`), jamais par son
   * nom ni par ses coordonnées recopiées : c'est le seul lien stable, et c'est
   * lui qui garantit qu'on vise le repère déjà posé sur la carte plutôt que
   * d'en inventer un second au même endroit.
   *
   * Les coordonnées figées de la notification ne servent QUE de repli, pour le
   * cas où le barrage n'existe plus — un retrait déjà accepté. On peut alors
   * encore montrer où il se trouvait, sans rien poser dessus.
   *
   * Le panneau se referme derrière : la carte est l'interface principale, le
   * panneau n'était qu'un moyen d'y arriver.
   */
  /**
   * CADRER ET SIGNALER — le geste unique, appelé de partout.
   *
   * Recherche, saisie terrain, listes des panneaux, notifications : tout passe
   * ici. Un seul endroit décide du zoom, de l'animation et de sa durée, donc
   * un seul endroit à corriger — et le geste est identique quel que soit le
   * point de départ, ce qui est la moitié de son intérêt.
   *
   * Accepte n'importe quel objet portant `id`, `lat` et `lng` : un marquage de
   * la carte comme un barrage rendu par `/api/roster`. La fonction n'a pas
   * besoin d'en savoir plus, et le mécanisme reste ouvert aux écrans à venir.
   *
   * `flyTo` plutôt que `setView` : le déplacement montre le CHEMIN parcouru.
   * Reposé sec sur un autre point, on ne sait pas d'où l'on vient ni si la
   * carte a bougé — surtout quand elle était déjà presque au bon endroit.
   */
  const cadrerMq = useCallback((item, options = {}) => {
    if (!item || item.lat == null || item.lng == null) return false;

    const c = carte.current;
    /* `trace` : cadrer tout un trajet (un conflit se lit à deux postes) plutôt
       que le seul poste désigné. */
    const trajet = Array.isArray(options.trace)
      ? options.trace.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)).map(([lng, lat]) => [lat, lng])
      : null;
    if (c && trajet?.length > 1) {
      c.fitBounds(L.latLngBounds(trajet), { padding: [70, 70], maxZoom: 14, animate: true });
    } else if (c) {
      c.flyTo([item.lat, item.lng], Math.max(c.getZoom(), 13), { duration: 0.7 });
    }

    /* `garderContexte` : le panneau d'optimisation désigne un poste SANS
       déplacer la portée — elle est le périmètre de l'analyse en cours, et la
       resserrer sur la brigade du poste changerait ce qui est analysé. */
    if (!options.garderContexte && (item.reg || item.cie || item.bt)) {
      setContexteNavigation({ region: item.reg, compagnie: item.cie, brigade: item.bt });
    }

    setVise({
      id: item.id,
      lat: item.lat,
      lng: item.lng,
      /* `libelle` sait nommer un poste sans nom (« Barrage fixe #3 ») ; il
         attend un marquage, et l'on peut lui passer un barrage venu du
         roster : on retombe alors sur le nom brut plutôt que d'échouer. */
      nom: (() => {
        try {
          return MQ.libelle(item) || item.nom || '';
        } catch {
          return item.nom ?? '';
        }
      })(),
      ts: Date.now(),
      persistant: options.persistant === true,
      parTrajet: Boolean(trajet?.length > 1),
    });
    return true;
  }, []);

  /**
   * CADRER LE RÉSULTAT COMPLET D'UNE OPTIMISATION, EN UN SEUL GESTE.
   *
   * Plusieurs postes donnent une seule emprise Leaflet, sans passage animé
   * par les niveaux région puis compagnie. Un poste seul garde le cadrage
   * rapproché attendu. Aucun poste n'est « visé » individuellement : les
   * repères du résultat sont tous mis en avant par OptimisationLayer.
   */
  /** Désigner un poste depuis le panneau d'optimisation : la portée ne bouge pas. */
  const cadrerDepuisOptimisation = useCallback(
    (item, options = {}) => cadrerMq(item, { ...options, garderContexte: true }),
    [cadrerMq],
  );

  const cadrerResultatsOptimisation = useCallback((barrages) => {
    const coords = [];
    (barrages ?? []).forEach((b) => {
      if (Number.isFinite(Number(b?.lat)) && Number.isFinite(Number(b?.lng))) {
        coords.push([Number(b.lat), Number(b.lng)]);
      }
      if (Number.isFinite(Number(b?.apres?.lat)) && Number.isFinite(Number(b?.apres?.lng))) {
        coords.push([Number(b.apres.lat), Number(b.apres.lng)]);
      }
      if (Number.isFinite(Number(b?.avant?.lat)) && Number.isFinite(Number(b?.avant?.lng))) {
        coords.push([Number(b.avant.lat), Number(b.avant.lng)]);
      }
      if (Number.isFinite(Number(b?.conflit?.lat)) && Number.isFinite(Number(b?.conflit?.lng))) {
        coords.push([Number(b.conflit.lat), Number(b.conflit.lng)]);
      }
      if (Array.isArray(b?.conflit?.trace)) {
        b.conflit.trace.forEach(([lng, lat]) => {
          if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lat, lng]);
        });
      }
      if (Array.isArray(b?.routeApres)) {
        b.routeApres.forEach(([lng, lat]) => {
          if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lat, lng]);
        });
      }
      if (Array.isArray(b?.routeDeplacement?.trace)) {
        b.routeDeplacement.trace.forEach(([lng, lat]) => {
          if (Number.isFinite(lat) && Number.isFinite(lng)) coords.push([lat, lng]);
        });
      }
    });
    setVise(null);
    if (!coords.length || !carte.current) return false;

    if (coords.length === 1) {
      carte.current.setView(
        coords[0],
        Math.max(carte.current.getZoom(), 12),
        { animate: true },
      );
      return true;
    }

    const bounds = L.latLngBounds(coords);
    if (!bounds.isValid()) return false;
    carte.current.fitBounds(bounds, {
      padding: [60, 60],
      maxZoom: 13,
      animate: true,
    });
    return true;
  }, []);

  /**
   * LE MÊME PIED D'EFFECTIF POUR TOUTES LES BULLES DE BARRAGE.
   *
   * Un poste peut être dessiné par trois couches selon l'état du dispositif :
   * son repère ordinaire, son marqueur de décision quand l'optimisation l'a
   * signalé, son cadenas quand elle ne peut pas y toucher. La question « qui
   * le tient ? » ne dépend d'aucun de ces états — elle doit trouver la même
   * réponse au même endroit dans les trois bulles.
   *
   * Fabriqué ici et passé aux couches plutôt qu'importé par elles : les
   * bulles vivent dans MapPopups.jsx, qui ne connaît ni l'API ni les
   * créneaux, et l'y faire importer créerait un cycle.
   */
  const piedEffectif = useCallback(
    (m, enTete = false) =>
      session && MQ.estBarrage(m) ? (
        <EffectifDuPoste
          barrageId={m.id}
          enTete={enTete}
          bt={m.bt}
          onModifier={
            m.bt
              ? () => {
                /* Le POSTE, pas seulement sa brigade : on a cliqué un
                   barrage, on veut corriger ce barrage. Ouvrir les neuf
                   postes de l'unité oblige à retrouver celui qu'on venait
                   de quitter. */
                setBrigadeDemandee({ bt: m.bt, barrageId: m.id, ts: Date.now() });
                ouvrirPanneau('saisie');
              }
              : null
          }
        />
      ) : null,
    [session, ouvrirPanneau],
  );

  /**
   * LA BRIGADE QU'UN AUTRE ÉCRAN DEMANDE D'OUVRIR.
   *
   * Le bouton « Modifier l'effectif » d'une bulle doit amener SAISIE TERRAIN
   * sur la bonne brigade, sinon il ne fait que déplacer le problème : on
   * rouvrirait le sélecteur pour chercher celle qu'on vient de quitter.
   *
   * L'horodatage permet de redemander LA MÊME brigade après en avoir consulté
   * une autre — sans lui, la seconde demande passerait inaperçue.
   */
  const [brigadeDemandee, setBrigadeDemandee] = useState(null);

  /**
   * LA SITUATION DU MOMENT, pour le premier écran d'ANALYSE.
   *
   * Chargée à l'ouverture du panneau, et pas au démarrage de la carte : la
   * plupart des consultations ne l'ouvrent jamais, et l'agrégation parcourt
   * les vingt-trois mille lignes du jour côté serveur.
   *
   * Rafraîchie ensuite toutes les cinq minutes tant qu'il reste ouvert — un
   * panneau laissé de côté afficherait sinon la relève précédente sans le
   * dire, ce qui est pire que de ne rien afficher.
   */
  const [situation, setSituation] = useState(null);

  /**
   * LE ROSTER DE LA BRIGADE CLIQUÉE SUR LA CARTE.
   *
   * Activer la couche « Circonscriptions BT » et cliquer un contour donne déjà
   * le nom de l'unité (`selection`). Il suffisait de demander son roster :
   * effectif, barrages, composition et affectations du jour arrivent en un
   * appel, celui-là même qu'utilise SAISIE TERRAIN. Aucune seconde source, et
   * donc aucun risque que les deux écrans se contredisent.
   *
   * Chargé seulement quand une BT est cliquée — cliquer une région ou une
   * compagnie ne déclenche rien.
   */
  const [rosterBrigade, setRosterBrigade] = useState(null);
  const brigadeCliquee = selection?.couche === 'circo_bt' ? selection.nom : null;

  useEffect(() => {
    if (!brigadeCliquee || !session) {
      setRosterBrigade(null);
      return undefined;
    }
    let vivant = true;
    setRosterBrigade(null);
    API.chargerRoster(brigadeCliquee)
      .then((r) => vivant && setRosterBrigade(r))
      .catch(() => vivant && setRosterBrigade({ erreur: true, bt: brigadeCliquee }));
    return () => {
      vivant = false;
    };
  }, [brigadeCliquee, session]);

  useEffect(() => {
    if (panneauOuvert !== 'analyse' || !session) return undefined;
    let vivant = true;
    const lire = () =>
      API.chargerSituation()
        .then((r) => vivant && setSituation(r))
        .catch(() => vivant && setSituation(null));
    lire();
    const battement = setInterval(lire, 5 * 60 * 1000);
    return () => {
      vivant = false;
      clearInterval(battement);
    };
  }, [panneauOuvert, session]);

  /** Même geste, quand on ne dispose que de l'identifiant. */
  const viserBarrage = useCallback(
    (barrageId, options) => {
      const m = items.find((x) => x.id === barrageId);
      return m ? cadrerMq(m, options) : false;
    },
    [items, cadrerMq],
  );

  const viserDepuisNotification = useCallback(
    (n) => {
      const barrage = items.find((m) => m.id === n.barrageId);
      const cible = barrage ?? (n.barrage?.lat != null ? n.barrage : null);
      if (!cible) return;

      cadrerMq(cible);
      if (barrage) setMqSelection(barrage.id);
      fermerPanneau('notifications');
    },
    [items, fermerPanneau, cadrerMq],
  );

  const exporterMq = useCallback(() => {
    MQ.telecharger(MQ.versGeoJSON(items, session), MQ.nomFichierExport(session));
    setMqMessage({
      ok: true,
      texte: `${items.length} marquage(s) exporté(s) en GeoJSON.`,
    });
  }, [items, session]);

  /**
   * Import : le fichier est lu ici, mais la fusion est faite par le serveur —
   * il est le seul à pouvoir vérifier périmètre et autorité de chaque entité.
   */
  const importerMq = useCallback(
    async (fichier) => {
      setOccupe(true);
      try {
        const lu = MQ.depuisGeoJSON(JSON.parse(await fichier.text()));
        if (lu.erreur) {
          setMqMessage({ ok: false, texte: lu.erreur });
          return;
        }

        const { bilan, items: apres } = await API.importerMarquages(lu.items);
        setItems(apres);
        rafraichirAlertes();
        setMqMessage({
          ok: bilan.refuses === 0,
          texte:
            `Import : ${bilan.ajoutes} ajouté(s), ${bilan.remplaces} mis à jour, ` +
            `${bilan.ignores} déjà à jour` +
            (bilan.refuses ? `, ${bilan.refuses} refusé(s) (hors périmètre ou autorité)` : '') +
            (lu.rejetes ? `, ${lu.rejetes} illisible(s)` : '') +
            '.',
        });
      } catch (err) {
        if (err instanceof API.ErreurApi) signaler(err);
        else
          setMqMessage({
            ok: false,
            texte: 'Fichier illisible : JSON invalide.',
          });
      } finally {
        setOccupe(false);
      }
    },
    [signaler, rafraichirAlertes],
  );

  /* ================================================================ */
  /* Distances par la route                                           */
  /* ================================================================ */

  const [graphe, setGraphe] = useState(null); // structures de calcul
  const [grapheEtat, setGrapheEtat] = useState('absent'); // absent|chargement|pret|erreur
  /**
   * LE GRAPHE ROUTIER, À LA DEMANDE — un seul téléchargement, partagé : la
   * promesse est gardée, l'outil Distances, les tracés et l'analyse d'un axe
   * l'attendent ensemble. Échec : la promesse est oubliée (nouvel essai
   * possible) et le message habituel s'affiche.
   */
  const promesseGraphe = useRef(null);
  const chargerGrapheRoutier = useCallback(() => {
    if (!promesseGraphe.current) {
      setGrapheEtat('chargement');
      promesseGraphe.current = fetch('layers/graphe_routier.json')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((json) => {
          const g = RT.chargerGraphe(json);
          setGraphe(g);
          setGrapheEtat('pret');
          return g;
        })
        .catch((err) => {
          promesseGraphe.current = null;
          setGrapheMessage(
            `Réseau routier indisponible (${err.message}). Lancez « node scripts/build-roads.mjs » pour produire graphe_routier.json.`,
          );
          setGrapheEtat('erreur');
          throw err;
        });
    }
    return promesseGraphe.current;
  }, []);
  const [grapheMessage, setGrapheMessage] = useState(null);
  const [critere, setCritere] = useState('rapide');
  // jalons est un tableau de N points (null = non défini)
  const [jalons, setJalons] = useState([null, null]);
  const [enAttente, setEnAttente] = useState(null); // index numérique | null

  const handleCalculerFiltreRoute = useCallback(async ({ route, distance, sens = SENS_TOUS }, { surProgression, signal, avantResultats } = {}) => {
    const can = canonicalRouteId(route) || route;
    const sensChoisi = sens || SENS_TOUS;
    setParametresFiltreRoute({ route, distance, sens: sensChoisi });
    setFiltreRoute(can);
    setFiltreSensRoute(sensChoisi);

    const barragesCandidats = barragesDeLaRoute(items, can);

    // Obtenir le tracé réel de la route pour l'isoler et l'afficher sur la carte
    try {
      const resTrace = await API.traceRoute(can).catch(() => null);
      if (resTrace?.lignes?.length) {
        setVueRoute({
          lignes: resTrace.lignes,
          libelleTrace: resTrace.ref || can,
          cadrage: resTrace.bbox ? { bbox: resTrace.bbox } : null,
        });
      } else if (barragesCandidats.length >= 2) {
        const pts = [...barragesCandidats]
          .filter((b) => Number.isFinite(Number(b.lng)) && Number.isFinite(Number(b.lat)))
          .sort((a, b) => Number(a.lat) - Number(b.lat))
          .map((b) => [Number(b.lng), Number(b.lat)]);
        if (pts.length >= 2) {
          setVueRoute({
            lignes: [pts],
            libelleTrace: can,
            cadrage: null,
          });
        }
      }
    } catch (err) {
      console.warn('Erreur trace route:', err);
    }

    /* La distance est ROUTIÈRE (le panneau l'affiche ainsi) : le graphe est
       chargé avant le calcul s'il ne l'est pas encore — il fournit aussi la
       géométrie réelle de chaque conflit. Indisponible : repli haversine,
       comme avant, et aucun tracé n'est présenté comme une route. */
    const grapheCalcul = graphe ?? (await chargerGrapheRoutier().catch(() => null));
    if (signal?.aborted) throw new AnalyseInterrompue();

    /* Le calcul lui-même (inchangé, voir calculConflitsRoute.js) : découpé en
       tranches pour que le radar et la progression restent vivants. */
    const { conflits: conflitsTrouves, total: pairesAnalysees } = await calculerConflitsRoute({
      barrages: items, can, distance, sens: sensChoisi, graphe: grapheCalcul, surProgression, signal,
    });
    /* Les résultats paraissent quand le radar s'arrête (voir lancerAnalyseRoute). */
    await avantResultats?.();
    if (signal?.aborted) throw new AnalyseInterrompue();

    setConflitsCalculesRoute(conflitsTrouves);
    if (conflitsTrouves.length > 0) {
      const pairesTrouvees = conflitsTrouves.map((c) => c.paireCle).filter(Boolean);
      const idsTrouves = conflitsTrouves.map((c) => c.id).filter(Boolean);
      setConflitsSupprimes((prev) => {
        const next = new Set(prev);
        for (const p of pairesTrouvees) next.delete(p);
        for (const id of idsTrouves) next.delete(id);
        return next;
      });
      API.restaurerConflits(pairesTrouvees.concat(idsTrouves)).catch(() => {});

      /* TOUS les conflits trouvés : le menu des conflits s'ouvre sur leur
         liste (pas sur le détail du premier), et la carte les cadre tous
         (plus bas). Aucun n'est désigné d'office. */
      setConflitViseLateral(null);
      setConflitVise(null);
      setMqMessage({
        ok: true,
        texte: `Axe ${can} : ${conflitsTrouves.length} conflit(s) d'espacement détecté(s) (seuil ≤ ${distance} km).`,
      });
    } else {
      setConflitViseLateral(null);
      setConflitVise(null);
      setMqMessage({
        ok: true,
        texte: `Axe ${can} : Aucun barrage consécutif à moins de ${distance} km (${barragesCandidats.length} barrage(s) au total).`,
      });
    }
    setPanneauConflitsOuvert(true);
    setDemandeListeConflits((n) => n + 1);
    setVersionConflits((v) => v + 1);

    // Cadrage automatique : sur les conflits détectés (leurs deux postes),
    // sinon sur la route isolée et ses barrages.
    /* Les deux postes ET leur route réelle (elle peut s'écarter de la ligne droite). */
    const postesConflits = conflitsTrouves.flatMap((c) => [
      c.a,
      c.b,
      ...(c.traceRoutiere ? c.trace.map(([lng, lat]) => ({ lat, lng })) : []),
    ]);
    if (carte.current && (postesConflits.length > 0 || barragesCandidats.length > 0)) {
      const coords = (postesConflits.length ? postesConflits : barragesCandidats)
        .filter((b) => Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lng)))
        .map((b) => [Number(b.lat), Number(b.lng)]);
      if (coords.length === 1) {
        carte.current.flyTo(coords[0], 13, { duration: 0.6 });
      } else if (coords.length > 1) {
        /* Marges : à gauche, la carte de résultat (CarteResultatAnalyse) ;
           en haut, la barre ; à droite, le panneau des conflits. En vue
           nationale la borne du Maroc (maxBounds) l'emporte : c'est pourquoi
           la carte de résultat est à gauche, sur l'Atlantique. */
        const { x: largeur, y: hauteur } = carte.current.getSize();
        carte.current.fitBounds(L.latLngBounds(coords), {
          paddingTopLeft: [largeur > 1100 ? 460 : 110, hauteur > 640 ? 170 : 120],
          paddingBottomRight: [largeur > 900 ? 460 : 60, 90],
          maxZoom: 14,
          animate: true,
        });
      }
    }
    return { conflits: conflitsTrouves, barragesCandidats, pairesAnalysees, can };
  }, [items, graphe, chargerGrapheRoutier]);

  /**
   * ANALYSE PAR ROUTE — le radar suit le VRAI calcul, du clic à la réponse.
   *
   *   scan     radar et balayage sur la carte, « Analyse des conflits en
   *            cours… », progression réelle (paires examinées / total) ;
   *   conflits chaque conflit trouvé reçoit l'impulsion radar et sa liaison
   *            (son tracé réel), la carte s'y cadre, « X conflits détectés » ;
   *   aucun    « No Conflict Detected », coche verte ;
   *   erreur   message d'erreur — jamais « aucun conflit » après un échec.
   * Un seul calcul à la fois ; l'état est nettoyé quoi qu'il arrive (finally)
   * et à la fermeture de la carte (interruption). Les résultats ne sont pas
   * enregistrés : le calcul ne crée aucun conflit en base.
   */
  const [analyseAxe, setAnalyseAxe] = useState(null);
  const [radarCalcul, setRadarCalcul] = useState([]);
  const analyseEnCours = useRef(null);
  useEffect(() => () => {
    if (analyseEnCours.current) analyseEnCours.current.aborted = true;
  }, []);

  const lancerAnalyseRoute = useCallback(async (params) => {
    if (analyseEnCours.current) return;
    const signal = { aborted: false };
    analyseEnCours.current = signal;
    const contexte = { route: canonicalRouteId(params.route) || params.route, distance: params.distance };
    /* Rien d'ancien n'est montré comme résultat de ce calcul — ni celui d'une
       autre route, ni celui de l'optimisation par paramètres (un seul mode). */
    ongletsOptimisationRef.current?.desactiver?.('distance');
    setRadarCalcul([]);
    setConflitsCalculesRoute(null);
    setAnalyseAxe({ etat: 'scan', ...contexte, progression: null, debut: Date.now() });
    const debut = Date.now();
    try {
      /* Le radar s'affiche AVANT que le calcul ne commence. */
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      let dernier = 0;
      const res = await handleCalculerFiltreRoute(params, {
        signal,
        /* Durée d'affichage minimale du balayage : un calcul de quelques
           millisecondes ne doit pas réduire le radar à un éclair. Les
           résultats sont déjà calculés à ce moment ; rien n'est simulé. */
        avantResultats: async () => {
          const reste = DUREE_MIN_SCAN - (Date.now() - debut);
          if (reste > 0) await new Promise((r) => setTimeout(r, reste));
        },
        surProgression: (p) => {
          const t = Date.now();
          if (t - dernier < 80 && p.faites < p.total) return;
          dernier = t;
          if (!signal.aborted) setAnalyseAxe((a) => (a?.etat === 'scan' ? { ...a, progression: p } : a));
        },
      });
      if (signal.aborted) return;
      /* Les routes se dessinent L'UNE APRÈS L'AUTRE, chacune à la vitesse de
         sa longueur réelle (dureeDessin : ~4–6 s). Beaucoup de conflits : les
         durées sont réduites d'autant (jamais sous 1,8 s) pour que la séquence
         complète ne dépasse pas ~30 s. */
      /* Les étapes communes (routes dessinées, résultat, liste des conflits). */
      radarDeLOptimisation.current = false;
      presenterResultatCalcul({
        libelle: `Axe ${res.can || contexte.route}`,
        route: res.can || contexte.route,
        distance: contexte.distance,
        conflits: res.conflits,
        barrages: res.barragesCandidats.length,
        paires: res.pairesAnalysees,
      });
    } catch (err) {
      if (signal.aborted || err instanceof AnalyseInterrompue) return;
      console.error('Analyse des conflits par route :', err);
      setAnalyseAxe({
        etat: 'erreur',
        ...contexte,
        message: err?.message || 'Erreur lors du calcul des conflits sur le réseau routier.',
        version: Date.now(),
      });
    } finally {
      if (analyseEnCours.current === signal) analyseEnCours.current = null;
    }
  }, [handleCalculerFiltreRoute, presenterResultatCalcul]);

  /**
   * Le graphe (4 Mo) n'est téléchargé qu'à la première ouverture de l'outil
   * Distances, OU dès qu'un trait pointillé doit se tracer par la route
   * (alerte ouverte, filtre distance actif), OU dès que le panneau Filtrer a
   * des résultats (points noirs / barrages) à accrocher au réseau pour
   * surligner leur tronçon : la très grande majorité des consultations n'a
   * besoin d'aucun des trois, et le graphe ne doit pas peser sur le
   * démarrage de la carte.
   */
  const besoinGrapheTraces =
    /* L'optimisation n'en a plus besoin : ses tracés viennent du serveur. */
    alertesEnrichies.some((al) => al.status === 'open');

  /* Le mode déplacement recale sur la route : il demande le graphe. */
  const [besoinGrapheDeplacement, setBesoinGrapheDeplacement] = useState(false);

  useEffect(() => {
    if ((!distOpen && !besoinGrapheTraces && !besoinGrapheDeplacement) || grapheEtat !== 'absent') return;
    chargerGrapheRoutier().catch(() => {});
  }, [distOpen, grapheEtat, besoinGrapheTraces, besoinGrapheDeplacement, chargerGrapheRoutier]);

  /* À chaque connexion, s'assurer que tout outil distance ou calcul de distance est désactivé */
  useEffect(() => {
    if (!session?.matricule) return;
    setPanneauOuvert((p) => (p === 'distances' ? null : p));
    setJalons([null, null]);
    setEnAttente(null);
    setGrapheMessage(null);
    setOptimisationResultats(null);
    setConflitsCalculesRoute(null);
    setFiltreRoute(null);
    setVueRoute(null);
    setConflitVise(null);
    if (ongletsOptimisationRef.current?.desactiver) {
      ongletsOptimisationRef.current.desactiver('distance');
    }
  }, [session?.matricule]);

  /* ================================================================ */
  /* Mode déplacement d'un barrage                                    */
  /* ================================================================ */

  const barrageEnDeplacement = armeDeplacement ? items.find((m) => m.id === armeDeplacement) ?? null : null;

  const annulerDeplacement = useCallback(() => {
    setArmeDeplacement(null);
    setDemandeDeplacement(null);
  }, []);

  /* Deux chaussées à départager : la carte s'approche (zoom 17), sans quoi
     les deux voies, à une quinzaine de mètres, se confondent à l'écran. */
  const sensACadrer = demandeDeplacement?.sens && !demandeDeplacement.sensChoisi ? demandeDeplacement.ts : null;
  useEffect(() => {
    const p = demandeDeplacement?.point;
    if (!sensACadrer || !p || !carte.current) return;
    const z = Math.max(carte.current.getZoom(), 17);
    if (mouvementReduit()) carte.current.setView([p.lat, p.lng], z);
    else carte.current.flyTo([p.lat, p.lng], z, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensACadrer]);

  /* Le sens choisi : la position est reprise sur la chaussée de ce sens, et le
     contrôle (route, distance, conflits) refait à partir d'elle. */
  const choisirSensDeplacement = useCallback((sens) => {
    setDemandeDeplacement((d) => {
      if (!d?.sens) return d;
      const c = sens === SENS_ALLER ? d.sens.aller : d.sens.retour;
      return { id: d.id, clic: { lng: c.lng, lat: c.lat }, ts: Date.now(), sensChoisi: sens };
    });
  }, []);

  const demarrerDeplacement = useCallback(
    (m, options = {}) => {
      const autoriserBfi = Boolean(
        options?.autoriserBfi ||
        options?.conflitInterRegionBfi ||
        (conflitEnTraitement && (
          conflitEnTraitement.conflitInterRegionBfi ||
          (MQ.estIntouchable(conflitEnTraitement.a || conflitEnTraitement.barrageA) &&
           MQ.estIntouchable(conflitEnTraitement.b || conflitEnTraitement.barrageB))
        ))
      );
      if (MQ.estIntouchable(m) && !autoriserBfi) {
        /* Règle existante : la position d'un intouchable est définitive. */
        setMessageEdition({ ok: false, texte: 'Un barrage intouchable ne peut pas être déplacé : sa position est définitive.' });
        return;
      }
      carte.current?.closePopup();
      setDemandeDeplacement(null);
      setReevaluation(null);
      setArmeDeplacement(m.id);
      /* Le réseau routier est chargé à la demande : le mode déplacement en a besoin. */
      if (grapheEtat === 'absent') setBesoinGrapheDeplacement(true);
    },
    [grapheEtat, conflitEnTraitement],
  );

  /**
   * « TRAITER → CHANGER LA FACTION » — la boîte (ChangerFaction.jsx), puis la
   * MÊME route que toute correction de fiche (PATCH /api/marquages/:id) :
   * périmètre, journal, validation. Un poste rattaché part en validation
   * (202) : la faction officielle ne change qu'à l'acceptation, et l'écran le
   * dit au lieu d'annoncer un changement qui n'a pas eu lieu.
   */
  const demanderChangementFaction = useCallback((m) => {
    carte.current?.closePopup();
    setFactionBarrage(m);
  }, []);
  const confirmerChangementFaction = useCallback(
    async (factionId) => {
      const m = factionBarrage;
      if (!m) return;
      /* Écriture DIRECTE du CMND CIE / Région, journalisée côté serveur. */
      const r = await API.changerFactionCommandement(m.id, factionId);
      const nomFaction = factions?.factions?.find((x) => x.id === factionId)?.nom ?? factionId;
      if (r?.item) setItems((prev) => prev.map((x) => (x.id === r.item.id ? r.item : x)));
      const compteRendu = { ok: true, texte: `${MQ.libelle(m)} : faction changée — ${nomFaction}.` };
      rafraichirAlertes();
      setMqMessage(compteRendu);
      setMessageEdition(compteRendu);
      signalerTraitement(m.id);
      setFactionBarrage(null);
    },
    [factionBarrage, factions, rafraichirAlertes, signalerTraitement],
  );

  /**
   * LA CLOCHE (ClocheNotifications.jsx) — « Voir le barrage sur la carte », et
   * ce qu'il faut relire quand un événement arrive. La notification porte une
   * copie du barrage : s'il n'est plus dans la liste chargée (retiré, déplacé
   * hors du périmètre), on cadre sur la position qu'elle a retenue.
   */
  /* La cloche de notification délègue à voirNotificationConflit (défini plus bas) */
  let voirNotificationConflitRef = useRef(null);
  const voirNotification = useCallback(
    (n) => {
      if (voirNotificationConflitRef.current) {
        voirNotificationConflitRef.current(n);
        return;
      }
      const m = items.find((x) => x.id === n.barrageId);
      if (m) cadrerMq(m, { garderContexte: true });
      else if (n.barrage?.lat != null && n.barrage?.lng != null) carte.current?.setView([n.barrage.lat, n.barrage.lng], 14);
    },
    [items, cadrerMq],
  );
  const surNouvelleNotification = useCallback((n) => {
    rafraichirNotifications();
    setVersionAssignations((v) => v + 1);
    /* Toute opération annoncée peut avoir fait détecter un conflit : on relit
       la liste (le détecteur dira s'il y a du nouveau). */
    setVersionConflits((v) => v + 1);
    /* Une étape du workflow des conflits (traitement à valider, refus,
       clôture) : un toast, et les files du panneau se mettent à jour sans
       qu'on ait à le rouvrir. */
    if (n?.actions?.includes('conflit-workflow')) {
      setVersionConflits((v) => v + 1);
      notifier({ type: /refus/i.test(n.titre ?? '') ? 'erreur' : 'info', titre: n.titre ?? 'Conflit', message: n.description ?? '' });
    }
  }, [rafraichirNotifications]);

  /**
   * QUI AGIT SUR UN BARRAGE — le Super Admin supervise et assigne ; le
   * commandement traite. Le serveur refuse de toute façon (403) : on ne montre
   * pas un geste voué au refus. Les autres repères (points noirs, congestions)
   * gardent leurs commandes.
   */
  const superviseur = session?.rang === 'admin';
  /* Les commandements qui ont une chaîne d'assignation et la filtration par route. */
  const commandement = ['admin', 'reg', 'cie'].includes(session?.rang);
  const gererMarquage = useCallback(
    (m) => MQ.peutModifier(session, m) && !(session?.rang === 'admin' && MQ.estBarrage(m)),
    [session],
  );
  /* La faction se gère par le CMND CIE et le CMND Région (POST /api/barrages/:id/faction). */
  const changerFactionPermis = session?.rang === 'cie' || session?.rang === 'reg';
  const demanderAssignation = useCallback((barrages) => {
    carte.current?.closePopup();
    setAssignation([].concat(barrages));
  }, []);
  const confirmerAssignation = useCallback(
    async (texte) => {
      const ids = (assignation ?? []).map((b) => b.id);
      const criteresParId = {};
      for (const b of assignation ?? []) {
        const c = optimisationResultats?.conflits?.get(b.id);
        const l = (optimisationResultats?.liens ?? []).find((x) => x.a?.id === b.id || x.b?.id === b.id);
        const voisin = c?.voisinId ? items.find((x) => x.id === c.voisinId) : (l?.a?.id === b.id ? l.b : l?.a);
        criteresParId[b.id] = {
          distanceKm: c?.km ?? l?.distanceKm ?? null,
          seuilKm: c?.seuilKm ?? optimisationResultats?.seuilKm ?? 20,
          voisinId: voisin?.id ?? c?.voisinId ?? null,
          voisinNom: voisin?.nom ?? c?.voisinNom ?? null,
          route: b.route ?? l?.routes?.[0] ?? null,
          trace: c?.trace ?? l?.trace ?? null,
        };
      }
      const r = await API.assignerBarrages(ids, texte, { criteres: criteresParId });
      setIdsAssignesLocaux((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
      setOptimisationResultats((prev) => {
        if (!prev) return prev;
        const nConflits = new Map(prev.conflits);
        ids.forEach((id) => nConflits.delete(id));
        const nAnnules = new Set(prev.annulesIds);
        ids.forEach((id) => nAnnules.delete(id));
        return {
          ...prev,
          conflits: nConflits,
          annulesIds: nAnnules,
        };
      });
      rafraichirNotifications();
      signalerTraitement(ids);
      setVersionAssignations((v) => v + 1);
      setMessageEdition({
        ok: true,
        texte: `${r.assignees.length} barrage(s) assigné(s) au CMND Région${r.ignores?.length ? ` · ${r.ignores.length} non assigné(s)` : ''}.`,
      });
      return r;
    },
    [assignation, optimisationResultats, items, rafraichirNotifications, signalerTraitement],
  );

  /**
   * Bascule le mode d'affichage comparatif sur la carte (AVANT, APRÈS, COMPARER)
   * et recadre automatiquement la caméra pour englober les éléments pertinents.
   */
  const changerModeComparatifCarte = useCallback(
    (nouveauMode, conflitDonnees = null) => {
      setModeComparatifCarte(nouveauMode);
      const conf = conflitDonnees || conflitAssigneVise;
      if (!conf) return;
      const { trace, traceApres, traceDeplacement, changement, barrage, voisin } = conf;
      const posAvant =
        changement?.avant?.lat != null && changement?.avant?.lng != null
          ? [changement.avant.lat, changement.avant.lng]
          : barrage?.lat != null
          ? [barrage.lat, barrage.lng]
          : null;
      const posApres =
        changement?.apres?.lat != null && changement?.apres?.lng != null
          ? [changement.apres.lat, changement.apres.lng]
          : null;
      const posVoisin = voisin?.lat != null && voisin?.lng != null ? [voisin.lat, voisin.lng] : null;

      const pts = [];
      if (nouveauMode === 'avant') {
        if (trace?.length) trace.forEach(([lng, lat]) => pts.push([lat, lng]));
        else {
          if (posAvant) pts.push(posAvant);
          if (posVoisin) pts.push(posVoisin);
        }
      } else if (nouveauMode === 'apres') {
        if (traceApres?.length) traceApres.forEach(([lng, lat]) => pts.push([lat, lng]));
        else {
          if (posApres) pts.push(posApres);
          if (posVoisin) pts.push(posVoisin);
        }
      } else {
        // Mode comparer
        if (trace?.length) trace.forEach(([lng, lat]) => pts.push([lat, lng]));
        if (traceApres?.length) traceApres.forEach(([lng, lat]) => pts.push([lat, lng]));
        if (traceDeplacement?.length) traceDeplacement.forEach(([lng, lat]) => pts.push([lat, lng]));
        if (posAvant) pts.push(posAvant);
        if (posApres) pts.push(posApres);
        if (posVoisin) pts.push(posVoisin);
      }

      /* Mouvement de caméra NATIF et doux (flyToBounds) vers la zone réelle du
         conflit, en laissant libres la barre du haut et le panneau des
         conflits ; animations réduites : cadrage immédiat. */
      const reduit = mouvementReduit();
      const marges = { paddingTopLeft: [panneauConflitsOuvert ? 430 : 120, 150], paddingBottomRight: [90, 110], maxZoom: 14 };
      if (pts.length >= 2) {
        if (reduit) carte.current?.fitBounds(L.latLngBounds(pts), marges);
        else carte.current?.flyToBounds(L.latLngBounds(pts), { ...marges, duration: 1.1, easeLinearity: 0.3 });
      } else if (pts.length === 1) {
        if (reduit) carte.current?.setView(pts[0], 13);
        else carte.current?.flyTo(pts[0], 13, { duration: 1.1 });
      }
    },
    [conflitAssigneVise, panneauConflitsOuvert],
  );

  /**
   * Afficher le conflit d'un barrage assigné avec son tracé de route réel (triq)
   * et le repère de son voisin. Supporte également la visualisation AVANT / APRÈS / COMPARER
   * des conflits traités ou déplacés.
   */
  const afficherConflitSurCarte = useCallback(
    async (cible, modeDemande = null, { garderPanneau = false, detail = true } = {}) => {
      if (!cible) return;
      /* Les routes RÉELLES viennent du graphe routier : on l'attend (une
         seule requête, partagée) ; indisponible, la vue le dira. */
      const g = graphe ?? (await chargerGrapheRoutier().catch(() => null));
      const bAId = cible.barrageAId || cible.barrageId || cible.a?.id || cible.id;
      let barrage = items.find((x) => x.id === bAId) || cible.barrageA || cible.a || cible.barrage || (bAId ? { id: bAId } : null);
      if (!barrage) return;

      const c = cible.criteres ?? null;
      let voisin = cible.barrageB || cible.b || null;
      const bBId = cible.barrageBId || c?.voisinId;
      if (!voisin && bBId) {
        voisin = items.find((x) => x.id === bBId) ?? null;
      }
      if (!voisin && c?.voisinNom) {
        voisin = items.find((x) => x.nom === c.voisinNom || x.id === c.voisinNom) ?? null;
      }
      if (!voisin && bBId) {
        voisin = { id: bBId, nom: c?.voisinNom || bBId };
      }

      const changement = cible.changement || cible.traitement?.changement || null;
      /* Le poste DÉPLACÉ est « barrage » (avant → après) ; l'autre est le
         voisin. Quand c'est le poste B qui a bougé, on les échange — sinon la
         route « avant » allait de l'ancienne position du poste à lui-même. */
      const idDeplace = changement?.avant?.barrageId ?? changement?.apres?.barrageId ?? null;
      if (idDeplace && voisin?.id === idDeplace && barrage?.id !== idDeplace) {
        [barrage, voisin] = [voisin, barrage];
      }
      const estTraite = Boolean(cible.estTraite || changement || cible.statut === 'traite');

      /* Itinéraire routier réel (plus court chemin du graphe), ou null : la
         vue tracera alors un segment présenté comme tel (« à vol d'oiseau »). */
      const calculerItineraire = (pt1, pt2) => {
        if (!g || !pt1 || !pt2 || pt1.lat == null || pt1.lng == null || pt2.lat == null || pt2.lng == null) return null;
        try {
          const a1 = RT.accrocher(g, pt1.lng, pt1.lat, 10);
          const a2 = RT.accrocher(g, pt2.lng, pt2.lat, 10);
          if (a1 && a2) {
            const it = RT.itineraire(g, a1, a2, 'court');
            /* La route ET sa distance, celles du moteur d'itinéraire. */
            if (it?.trace && it.trace.length > 1) return { trace: it.trace, km: Number.isFinite(it.km) ? it.km : null };
          }
        } catch {
          /* itinéraire introuvable : repli honnête */
        }
        return null;
      };

      const posAvantObj = {
        lat: changement?.avant?.lat ?? barrage.lat,
        lng: changement?.avant?.lng ?? barrage.lng,
      };
      const posApresObj =
        changement?.apres?.lat != null && changement?.apres?.lng != null
          ? { lat: changement.apres.lat, lng: changement.apres.lng }
          : null;
      const posVoisinObj =
        voisin?.lat != null && voisin?.lng != null ? { lat: voisin.lat, lng: voisin.lng } : null;

      /* Le tracé déjà connu du conflit n'est repris que s'il est une ROUTE :
         marqué comme tel (`traceRoutiere`), ou une géométrie de plus de deux
         points (tracés du serveur). Un segment de repli est recalculé. */
      const traceConnu = cible.trace || c?.trace || null;
      const connuRoutier =
        Array.isArray(traceConnu) && traceConnu.length > 1 && cible.traceRoutiere !== false && (cible.traceRoutiere === true || traceConnu.length > 2);
      let trace = connuRoutier ? traceConnu : null;
      /* Distance de la route connue : celle du calcul qui l'a produite. */
      let kmTrace = connuRoutier && Number.isFinite(Number(cible.distanceRoutiereKm ?? cible.distanceKm)) ? Number(cible.distanceRoutiereKm ?? cible.distanceKm) : null;
      if (!trace && posAvantObj.lat != null && posVoisinObj) {
        const it = calculerItineraire(posAvantObj, posVoisinObj);
        trace = it?.trace ?? null;
        kmTrace = it?.km ?? null;
      }
      const traceRoutiere = Boolean(trace);

      const itApres = posApresObj && posVoisinObj ? calculerItineraire(posApresObj, posVoisinObj) : null;
      const traceApres = itApres?.trace ?? null;

      const itDeplacement = posAvantObj.lat != null && posApresObj ? calculerItineraire(posAvantObj, posApresObj) : null;
      const traceDeplacement = itDeplacement?.trace ?? null;

      const modeActif = modeDemande || (estTraite ? 'comparer' : 'avant');
      setModeComparatifCarte(modeActif);

      const conflitData = {
        /* Chaque « Voir sur la carte » rejoue le dessin (RouteAnimee). */
        jeu: Date.now(),
        traceRoutiere,
        traceApresRoutiere: Boolean(traceApres),
        traceDeplacementRoutiere: Boolean(traceDeplacement),
        /* Distances par la route, du moteur d'itinéraire (affichées). */
        kmTrace,
        kmApres: itApres?.km ?? null,
        kmDeplacement: itDeplacement?.km ?? null,
        barrage,
        voisin,
        trace,
        traceApres,
        traceDeplacement,
        distanceKm: cible.distanceRoutiereKm ?? cible.distanceKm ?? c?.distanceKm ?? null,
        seuilKm: cible.seuilKm ?? c?.seuilKm ?? 20,
        route: cible.route ?? c?.route ?? null,
        motif: cible.motif ?? c?.motif ?? null,
        faction: cible.faction ?? null,
        conflitId: cible.id ?? null,
        conflitNumero: cible.id ?? null,
        changement,
        traitement: cible.traitement,
        estTraite,
        statut: cible.statut,
        approbation: cible.approbation,
      };

      setConflitAssigneVise(conflitData);

      if (cible.id) {
        setConflitViseLateral(cible);
        setConflitVise({ id: cible.id, cadrer: true, n: Date.now() });
      }

      /* Depuis le menu des conflits, il reste ouvert sur le détail ; sinon il se
         ferme pour dégager la carte. */
      if (!garderPanneau) {
        if (detail && cible.id && ['admin', 'reg', 'cie'].includes(session?.rang)) {
          setDemandeDetailConflit({ id: cible.id, n: Date.now() });
          setPanneauConflitsOuvert(true);
        } else {
          setPanneauConflitsOuvert(false);
        }
      }
      fermerPanneau('notifications');

      // Fermer toute popup résiduelle sur la carte pour laisser la vue dégagée
      carte.current?.closePopup();

      // Cadrage selon le mode actif
      changerModeComparatifCarte(modeActif, conflitData);
    },
    [items, graphe, chargerGrapheRoutier, fermerPanneau, changerModeComparatifCarte, session?.rang],
  );

  /* « Voir sur la carte » d'un conflit nouvellement détecté : l'impulsion
     s'arrête, la carte s'y rend et le panneau des conflits s'ouvre sur lui
     (afficherConflitSurCarte, le chemin habituel). */
  const voirConflitDetecte = useCallback(
    (conf) => {
      /* Consulté = pris en compte : la pulsation de veille s'arrête. */
      setRadarConflits((l) => l.map((x) => (x.conf.id === conf.id ? { ...x, impulsionLe: null, pris: true } : x)));
      setAlerteConflits((a) => ({ ...a, conflits: a.conflits.filter((c) => c.id !== conf.id) }));
      afficherConflitSurCarte(conf);
    },
    [afficherConflitSurCarte],
  );
  const fermerAlerteConflits = useCallback(() => setAlerteConflits((a) => ({ ...a, conflits: [] })), []);

  /* Un résultat de l'analyse par route : la carte se cadre sur CE conflit
     (ses deux postes) et le panneau des conflits s'ouvre sur lui. */
  const voirResultatCalcul = useCallback(
    (conf) => {
      /* « Voir sur la carte » : sa route se REDESSINE dans la vue du conflit
         (RouteAnimee, avec sa distance) ; le radar la masque le temps de la
         vue, sans la dupliquer. Le repère, lui, rejoue son impulsion. */
      setRadarCalcul((l) => l.map((x) => (x.conf.id === conf.id ? { ...x, impulsionLe: Date.now(), delai: 0, rejoue: (x.rejoue ?? 0) + 1 } : x)));
      afficherConflitSurCarte(conf);
    },
    [afficherConflitSurCarte],
  );
  const fermerResultatAnalyse = useCallback(() => setAnalyseAxe((a) => (a?.etat === 'scan' ? a : null)), []);
  const reessayerAnalyse = useCallback(() => {
    setAnalyseAxe(null);
    setModalFiltreRouteOuverte(true);
  }, []);
  /**
   * LE RADAR DE TOUS LES CALCULS (radarCalcul.js) : affiché tant qu'au moins
   * un calcul annoncé est en cours, avec le libellé du plus récent.
   */
  const [calculsEnCours, setCalculsEnCours] = useState(() => new Map());
  useEffect(() => {
    const debuts = new Map();
    const minuteries = new Set();
    const retirer = (id) => setCalculsEnCours((avant) => {
      if (!avant.has(id)) return avant;
      const m = new Map(avant);
      m.delete(id);
      return m;
    });
    const sur = (e) => {
      const { phase, id, libelle } = e.detail ?? {};
      if (phase === 'debut') {
        debuts.set(id, Date.now());
        setCalculsEnCours((avant) => new Map(avant).set(id, libelle));
        return;
      }
      /* Un calcul de quelques millisecondes ne fait pas « clignoter » le
         radar : il reste au moins 600 ms. Les résultats, eux, s'affichent
         dès leur arrivée, comme avant. */
      const reste = 600 - (Date.now() - (debuts.get(id) ?? 0));
      debuts.delete(id);
      if (reste <= 0) retirer(id);
      else {
        const t = setTimeout(() => {
          minuteries.delete(t);
          retirer(id);
        }, reste);
        minuteries.add(t);
      }
    };
    window.addEventListener('gr-radar-calcul', sur);
    return () => {
      window.removeEventListener('gr-radar-calcul', sur);
      for (const t of minuteries) clearTimeout(t);
    };
  }, []);
  const radarAffiche =
    analyseAxe?.etat === 'scan'
      ? { libelle: `Conflits de l’axe ${analyseAxe.route} · seuil ≤ ${analyseAxe.distance} km`, progression: analyseAxe.progression }
      : calculsEnCours.size
        ? { libelle: [...calculsEnCours.values()].at(-1) }
        : null;

  /**
   * LA ROUTE RÉELLE D'UN CONFLIT, pour la dessiner : celle du calcul quand
   * elle vient du graphe (`traceRoutiere`) ; sinon le plus court chemin du
   * graphe routier entre ses deux postes (conflits détectés par le serveur,
   * qui n'en portent pas) ; sans graphe : null — aucune droite à la place.
   */
  const tracesConnues = useMemo(() => new Map(), [graphe]); // eslint-disable-line react-hooks/exhaustive-deps
  const traceRoutiereDe = useCallback(
    (conf) => {
      if (conf?.traceRoutiere && Array.isArray(conf.trace)) return conf.trace.map(([lng, lat]) => [lat, lng]);
      if (!graphe || !conf?.id) return null;
      if (tracesConnues.has(conf.id)) return tracesConnues.get(conf.id);
      let r = null;
      const a = conf.barrageA ?? conf.a;
      const b = conf.barrageB ?? conf.b;
      if ([a?.lng, a?.lat, b?.lng, b?.lat].every(Number.isFinite)) {
        try {
          const accA = RT.accrocher(graphe, a.lng, a.lat);
          const accB = RT.accrocher(graphe, b.lng, b.lat);
          const iti = accA && accB ? RT.itineraire(graphe, accA, accB, 'court') : null;
          if (iti?.trace?.length > 1) r = iti.trace.map(([lng, lat]) => [lat, lng]);
        } catch {
          r = null;
        }
      }
      tracesConnues.set(conf.id, r);
      return r;
    },
    [graphe, tracesConnues],
  );
  /* Des conflits à dessiner : le graphe est chargé (une fois). */
  useEffect(() => {
    if ((radarConflits.length || radarCalcul.length) && !graphe) chargerGrapheRoutier().catch(() => {});
  }, [radarConflits.length, radarCalcul.length, graphe, chargerGrapheRoutier]);

  /* Filtre de route effacé : ses résultats d'analyse disparaissent avec lui. */
  useEffect(() => {
    if (filtreRoute) return;
    setRadarCalcul([]);
    setAnalyseAxe((a) => (a?.etat === 'scan' ? a : null));
  }, [filtreRoute]);

  /* Liaison avec la notification */
  useEffect(() => {
    voirNotificationConflitRef.current = (n) => {
      const cId = n?.conflitId || n?.corps?.conflitId || n?.payload?.conflitId;
      if (cId) {
        afficherConflitSurCarte({ id: cId, ...n });
        return;
      }
      const m = items.find((x) => x.id === n.barrageId);
      if (m) cadrerMq(m, { garderContexte: true });
      else if (n.barrage?.lat != null && n.barrage?.lng != null) carte.current?.setView([n.barrage.lat, n.barrage.lng], 14);
    };
  }, [items, cadrerMq, afficherConflitSurCarte]);

  /**
   * CRÉER UN BARRAGE À UNE POSITION PROPOSÉE (espacement le long d'une route) —
   * après confirmation explicite, par la MÊME pose que partout (POST
   * /api/marquages) : périmètre, rattachement et validation s'appliquent.
   * Le Super Admin n'y a pas accès (il assigne).
   */
  const creerBarrageSurRoute = useCallback(async ({ lng, lat, route, nom }) => {
    const r = await API.creerMarquage({ type: 'barrage_fixe', lng, lat, route, nom });
    if (r) setItems((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]));
    rafraichirNotifications();
    setMessageEdition({ ok: true, texte: `${nom} : barrage posé à la position proposée${r?.statutBarrage === 'en_attente' ? ' — en attente de validation' : ''}.` });
    return r;
  }, [rafraichirNotifications]);

  /**
   * LES COMMANDES DE LA BULLE ORDINAIRE — les mêmes que celles de MarquageLayer,
   * pour que le repère d'un barrage en conflit (ou d'une décision simulée)
   * ouvre la MÊME bulle, avec les mêmes droits et les mêmes gestes.
   */
  const propsBulleMarquage = {
    factions,
    piedEffectif,
    session,
    estAdmin: superviseur,
    barragesAssignes,
    assignationsMap,
    onVoirConflit: afficherConflitSurCarte,
    on3D: (m) => setModal3DItem(m),
    gerable: gererMarquage,
    peutRetirer: gererMarquage,
    onArmerDeplacement: demarrerDeplacement,
    onChangerFaction: changerFactionPermis ? demanderChangementFaction : null,
    onAssigner: superviseur ? demanderAssignation : null,
    onSupprimer: supprimerMq,
    onOuvrir: (id) => {
      setMqSelection(id);
      ouvrirPanneau('saisie');
    },
    onModifierBarrage: (m) => {
      carte.current?.closePopup();
      annulerDeplacement();
      setEditionBarrageId(m.id);
    },
  };

  /** Ouvrir individuellement la fiche d'un barrage avec centrage */
  const ouvrirFicheBarrage = useCallback(
    (barrageId) => {
      if (!barrageId) return;
      setMqSelection(barrageId);
      ouvrirPanneau('saisie');
      const m = items.find((x) => x.id === barrageId);
      if (m) {
        cadrerMq(m, { garderContexte: true });
        setVise({ id: m.id, ts: Date.now(), persistant: true });
      }
    },
    [items, cadrerMq, ouvrirPanneau],
  );

  const confirmerAssignationConflit = useCallback(
    async ({ conflitId, conflitIds, matricule, matricules, consigne, conflitData, conflitsData, destinataire, destinataires, etatAttendu = null }) => {
      const listeMatricules = Array.isArray(matricules) && matricules.length > 0
        ? matricules
        : (matricule ? [matricule] : []);
      const listeDestinataires = Array.isArray(destinataires) && destinataires.length > 0
        ? destinataires
        : (destinataire ? [destinataire] : []);

      if (Array.isArray(conflitIds) && conflitIds.length > 0) {
        const res = await API.assignerConflitsGroupe(conflitIds, {
          matricule: listeMatricules[0],
          matricules: listeMatricules,
          consigne,
          conflitsData,
        });
        rafraichirNotifications();
        vueRoute?.conflits?.onRafraichir?.();
        setVersionConflits((v) => v + 1);
        setMessageEdition({
          ok: true,
          texte: `✓ ${res.count || conflitIds.length} conflit(s) assigné(s) avec succès.`,
        });
        return res;
      }

      // L'entité assignée est STRICTEMENT le CONFLIT, jamais le barrage.
      const res = await API.assignerConflit(conflitId, {
        matricule: listeMatricules[0],
        matricules: listeMatricules,
        consigne,
        conflitData,
        etatAttendu,
      });
      /* Enregistrée : le menu des conflits passe au suivant de la même région. */
      const regionsAssignees = listeDestinataires.map((d) => d.unite).filter(Boolean);
      setDerniereAssignation({
        ts: Date.now(),
        ids: [conflitId, res?.conflit?.id].filter(Boolean),
        paires: [conflitData?.paireCle, res?.conflit?.paireCle].filter(Boolean),
        regions: regionsAssignees.length ? regionsAssignees : (res?.conflit?.assignation?.regions ?? []).map((r) => r.unite),
        destinataire: regionsAssignees.length ? `CMD Région ${regionsAssignees.join(' & ')}` : null,
      });

      rafraichirNotifications();
      vueRoute?.conflits?.onRafraichir?.();

      if (conflitsIdentifies) {
        const maj = conflitsIdentifies.map((c) => {
          if (c.id === conflitId || c.cle === conflitData?.numero) {
            const nomDest = listeDestinataires.map((d) => d.nom).filter(Boolean).join(' & ');
            const uniteDest = listeDestinataires.map((d) => d.unite).filter(Boolean).join(' & ');
            return {
              ...c,
              statut: 'a_traiter',
              assigneA: {
                matricule: listeMatricules.join(','),
                nom: nomDest || listeMatricules.join(','),
                unite: uniteDest || listeMatricules.join(','),
                rang: 'reg',
              },
              assignesA: listeDestinataires.map((d) => ({
                matricule: d.matricule,
                nom: d.nom,
                unite: d.unite,
                rang: 'reg',
              })),
              assigneLe: new Date().toISOString(),
            };
          }
          return c;
        });
        setOptimisationResultats((prev) => (prev ? { ...prev, conflitsIdentifies: maj } : prev));
      }

      const labelDest = listeDestinataires.length > 1
        ? `aux 2 CMND Régions (${listeDestinataires.map((d) => d.unite || d.matricule).join(' et ')})`
        : `au CMND Région ${listeDestinataires[0]?.unite || listeMatricules[0]}`;

      setVersionConflits((v) => v + 1);
      setMessageEdition({
        ok: true,
        texte: `✓ Conflit ${conflitData?.numero || conflitId} assigné avec succès ${labelDest}.`,
      });
      return res;
    },
    [conflitsIdentifies, rafraichirNotifications, vueRoute],
  );

  const handleDesassignerConflit = useCallback(
    async (conflit) => {
      const id = conflit.id || conflit.numero;
      if (!id) return;
      await API.desassignerConflit(id);
      setVersionConflits((v) => v + 1);
      rafraichirNotifications();
      vueRoute?.conflits?.onRafraichir?.();
      setMessageEdition({
        ok: true,
        texte: `✓ Conflit ${conflit.numero || id} désassigné avec succès (replacé dans les conflits non assignés).`,
      });
    },
    [rafraichirNotifications, vueRoute],
  );

  const confirmerTransmissionConflit = useCallback(
    async ({ conflitId, matricule, consigne, conflitData, destinataire }) => {
      const res = await API.transmettreConflit(conflitId, { matricule, consigne, conflitData });
      /* Transmis : le menu passe au conflit suivant à transmettre. */
      setDerniereAssignation({
        ts: Date.now(),
        ids: [conflitId, res?.conflit?.id].filter(Boolean),
        paires: [conflitData?.paireCle, res?.conflit?.paireCle].filter(Boolean),
        regions: session?.unite ? [session.unite] : [],
        destinataire: destinataire?.unite ? `CMD CIE ${destinataire.unite}` : null,
      });
      rafraichirNotifications();
      setVersionConflits((v) => v + 1);
      const cieNom = destinataire?.unite ? `Cie ${destinataire.unite}` : (matricule || 'CMD Compagnie');
      setMessageEdition({
        ok: true,
        texte: `✓ Conflit ${conflitData?.numero || conflitId} assigné et transmis avec succès à la ${cieNom}.`,
      });
      return res;
    },
    [rafraichirNotifications, session?.unite],
  );

  const confirmerTraitementConflit = useCallback(
    async ({ conflitId, action, details }) => {
      const res = await API.traiterConflit(conflitId, { action, details });
      if (Array.isArray(res?.barragesModifies) && res.barragesModifies.length > 0) {
        setItems((prev) => {
          const mapMaj = new Map(res.barragesModifies.map((b) => [b.id, b]));
          return prev.map((x) => mapMaj.get(x.id) || x);
        });
      } else if (res?.barrageModifie) {
        setItems((prev) => prev.map((x) => (x.id === res.barrageModifie.id ? res.barrageModifie : x)));
      }
      API.listerMarquages().then(setItems).catch(() => {});
      chargerRepositionnementsRef.current?.();
      rafraichirNotifications();
      setVersionConflits((v) => v + 1);
      setMessageEdition({
        ok: true,
        texte: `✓ Action sur le conflit ${conflitId} enregistrée. Statut : ${res?.statut || 'mis à jour'}.`,
      });
      return res;
    },
    [rafraichirNotifications],
  );

  /* Après une assignation, une transmission… le panneau relit le conflit :
     il montre « Assigné à … » et non plus « Assigner ». */
  useEffect(() => {
    const id = conflitViseLateral?.id;
    if (!id || !commandement) return undefined;
    let annule = false;
    API.listerConflits()
      .then((r) => {
        const maj = (r?.items ?? []).find((c) => c.id === id);
        if (!annule && maj) setConflitViseLateral((p) => (p?.id === id ? { ...p, ...maj } : p));
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionConflits]);

  const handleConflitSupprime = useCallback(
    (conf) => {
      if (!conf) return;
      const id = conf.id || conf.numero;
      const aId = conf.barrageAId || conf.a?.id;
      const bId = conf.barrageBId || conf.b?.id;
      const paire = conf.paireCle || (aId && bId ? clePaire(aId, bId) : null);

      if (conflitVise && (conflitVise.id === id || conflitVise.id === conf.id || (paire && conflitVise.paireCle === paire))) {
        setConflitVise(null);
      }
      if (conflitAssigneVise && (conflitAssigneVise.conflitId === id || conflitAssigneVise.conflitNumero === id)) {
        setConflitAssigneVise(null);
      }

      setConflitsSupprimes((prev) => {
        const next = new Set(prev);
        if (paire) next.add(paire);
        if (id && !/^C-\d+$/i.test(String(id).trim())) next.add(id);
        if (conf.id && !/^C-\d+$/i.test(String(conf.id).trim())) next.add(conf.id);
        if (aId && bId) next.add(clePaire(aId, bId));
        return next;
      });

      setConflitsCalculesRoute((prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.filter(
          (c) =>
            c.id !== id &&
            c.id !== conf.id &&
            c.paireCle !== paire &&
            (!aId || !bId || (c.barrageAId !== aId && c.barrageBId !== bId && c.barrageAId !== bId && c.barrageBId !== aId))
        );
      });

      setOptimisationResultats((prev) => {
        if (!prev) return prev;
        const matchSupprime = (item) => {
          if (!item) return false;
          const itemId = item.id || item.conflitId || item.numero;
          const itemPaire = item.paireCle || item.cle || (item.a?.id && item.b?.id ? clePaire(item.a.id, item.b.id) : null);
          if (id && (itemId === id || item.cle === `lien-${id}`)) return true;
          if (conf.id && (itemId === conf.id || item.cle === `lien-${conf.id}`)) return true;
          if (paire && (itemPaire === paire || (item.a?.id && item.b?.id && clePaire(item.a.id, item.b.id) === paire))) return true;
          if (aId && bId && item.a?.id && item.b?.id) {
            if ((item.a.id === aId && item.b.id === bId) || (item.a.id === bId && item.b.id === aId)) return true;
          }
          return false;
        };

        const filteredIdentifies = (prev.conflitsIdentifies ?? []).filter((c) => !matchSupprime(c));
        const filteredRoutes = (prev.routesConflit ?? []).filter((r) => !matchSupprime(r));
        const filteredLiens = (prev.liens ?? []).filter((l) => !matchSupprime(l));

        let filteredConflits = prev.conflits;
        if (prev.conflits instanceof Map) {
          filteredConflits = new Map(prev.conflits);
          if (aId && bId) {
            const confA = filteredConflits.get(aId);
            if (confA && (confA.voisinId === bId || confA.voisinId === aId)) filteredConflits.delete(aId);
            const confB = filteredConflits.get(bId);
            if (confB && (confB.voisinId === aId || confB.voisinId === bId)) filteredConflits.delete(bId);
          }
        }

        const nouveauxAnnulesIds = prev.annulesIds ? new Set(prev.annulesIds) : new Set();
        if (aId && !filteredIdentifies.some((c) => c.a?.id === aId || c.b?.id === aId || c.barrageAId === aId || c.barrageBId === aId)) {
          nouveauxAnnulesIds.delete(aId);
        }
        if (bId && !filteredIdentifies.some((c) => c.a?.id === bId || c.b?.id === bId || c.barrageAId === bId || c.barrageBId === bId)) {
          nouveauxAnnulesIds.delete(bId);
        }

        return {
          ...prev,
          conflitsIdentifies: filteredIdentifies,
          routesConflit: filteredRoutes,
          liens: filteredLiens,
          conflits: filteredConflits,
          annulesIds: nouveauxAnnulesIds,
        };
      });

      setConflitsCalculesRoute((prev) => {
        if (!Array.isArray(prev)) return prev;
        return prev.filter((c) => c.id !== id && c.id !== conf.id && (!paire || c.paireCle !== paire));
      });

      setVersionConflits((v) => v + 1);
      rafraichirNotifications();
      setMessageEdition({
        ok: true,
        texte: `✓ Conflit ${conf.numero || conf.id || id} supprimé avec succès.`,
      });
    },
    [conflitVise, conflitAssigneVise, rafraichirNotifications],
  );

  /**
   * Les contours de brigade, compagnie et région — les mêmes couches que la
   * carte affiche — pour dire, AVANT l'envoi, où le poste va tomber. Le
   * serveur refait ce rattachement lui-même à l'écriture (voir `rattacher`).
   */
  const contoursTerritoire = useRef(null);
  const chargerContoursTerritoire = () => {
    if (!contoursTerritoire.current) {
      contoursTerritoire.current = Promise.all(
        ['circo_bt', 'circo_cie', 'circo_reg'].map((n) =>
          fetch(`layers/${n}.geojson`).then((r) => (r.ok ? r.json() : { features: [] })),
        ),
      ).catch(() => [{ features: [] }, { features: [] }, { features: [] }]);
    }
    return contoursTerritoire.current;
  };

  /* Le clic est recalé sur la route réelle la plus proche, dès que le réseau
     est là : même accrochage (`RT.accrocher`) et même itinéraire que l'outil
     Distances — aucune géométrie nouvelle. */
  useEffect(() => {
    const d = demandeDeplacement;
    if (!d?.clic || d.point || d.erreur || !barrageEnDeplacement) return;
    if (grapheEtat === 'erreur') {
      setDemandeDeplacement({ ...d, erreur: 'Réseau routier indisponible : impossible de recaler sur la route.' });
      return;
    }
    if (grapheEtat !== 'pret' || !graphe) return;

    const acc = RT.accrocher(graphe, d.clic.lng, d.clic.lat, 5);
    if (!acc) {
      setDemandeDeplacement({ ...d, erreur: 'Aucune route à moins de 5 km de ce point : choisissez un point plus près d’une route.' });
      return;
    }
    const point = { lng: +acc.lng.toFixed(5), lat: +acc.lat.toFixed(5) };
    const route = RT.refArete(graphe, acc.arete) ?? RT.nomArete(graphe, acc.arete) ?? null;
    /* Route à deux chaussées : Aller et Retour, à choisir — jamais d'office. */
    const choixSens = RT.chausseesOpposees(graphe, acc);
    const depart = RT.accrocher(graphe, barrageEnDeplacement.lng, barrageEnDeplacement.lat, 30);
    const it = depart ? RT.itineraire(graphe, depart, acc, 'court') : null;
    const verdict = preControle([point.lng, point.lat]);

    /* Recalcul automatique des conflits avec tous les autres barrages à cette nouvelle position */
    const assignationActive = assignationsMap.get(barrageEnDeplacement.id);
    const SEUIL_CONFLIT_KM = assignationActive?.criteres?.seuilKm ?? optimisationResultats?.seuilKm ?? barrageEnDeplacement?.seuilKm ?? 20;
    const factionsDuPoste = (b) => {
      if (!b) return [];
      const res = [];
      if (b.factionId) res.push(b.factionId);
      if (Array.isArray(b.factions)) res.push(...b.factions);
      const assignes = factions?.assignations?.[b.id];
      if (Array.isArray(assignes)) res.push(...assignes);
      return [...new Set(res)];
    };
    const factionsCible = new Set(factionsDuPoste(barrageEnDeplacement));
    let conflitDetecte = null;
    let plusProcheAutre = null;
    for (const autre of items) {
      if (autre.id === barrageEnDeplacement.id || !MQ.estBarrage(autre)) continue;
      const factionsAutre = factionsDuPoste(autre);
      const intouchable = MQ.estIntouchable(autre) || MQ.estIntouchable(barrageEnDeplacement);
      const commun = intouchable || factionsAutre.some((f) => factionsCible.has(f));
      if (!commun && factionsCible.size > 0 && factionsAutre.length > 0) continue;

      const distVol = RT.distanceKm(point.lng, point.lat, autre.lng, autre.lat);
      if (distVol > SEUIL_CONFLIT_KM * 2.5) continue;

      if (!graphe) continue;
      const accAutre = RT.accrocher(graphe, autre.lng, autre.lat, 30);
      if (!accAutre) continue;
      const itin = RT.itineraire(graphe, acc, accAutre, 'court');
      if (!itin || itin.km == null) continue;
      const distRoute = itin.km;

      if (!plusProcheAutre || distRoute < plusProcheAutre.dist) {
        plusProcheAutre = { m: autre, dist: distRoute, estRoute: true };
      }
      if (distRoute < SEUIL_CONFLIT_KM) {
        conflitDetecte = {
          voisinId: autre.id,
          voisinNom: MQ.libelle(autre) || autre.nom || autre.id,
          distanceKm: +distRoute.toFixed(2),
          seuilKm: SEUIL_CONFLIT_KM,
          estRoute: true,
          trace: itin?.trace ?? null,
          route: route ?? autre.route,
          factionId: autre.factionId || null,
        };
        break;
      }
    }

    const calcule = {
      ...d,
      point,
      route,
      classe: RT.classeArete(graphe, acc.arete),
      ecartM: Math.round(acc.ecartKm * 1000),
      km: it ? it.km : null,
      trace: it?.trace ?? null,
      erreur: verdict === 'refuse' ? 'Nouvelle position hors de votre périmètre : enregistrement impossible.' : null,
      conflitNouveau: conflitDetecte,
      /* Le seuil de cet aperçu : la réévaluation du serveur jugera avec le même. */
      seuilKm: SEUIL_CONFLIT_KM,
      sens: choixSens,
      sensChoisi: choixSens ? (d.sensChoisi ?? null) : null,
      plusProcheAutre: plusProcheAutre
        ? {
          nom: MQ.libelle(plusProcheAutre.m) || plusProcheAutre.m.nom || plusProcheAutre.m.id,
          dist: +plusProcheAutre.dist.toFixed(2),
          estRoute: plusProcheAutre.estRoute,
        }
        : null,
      territoire: null,
    };
    setDemandeDeplacement(calcule);

    /* Pas d'annulation au démontage de l'effet : il se relance aussitôt,
       justement parce qu'on vient de poser `calcule`. Une réponse périmée (un
       autre clic entre-temps) est écartée par son horodatage `ts`. */
    chargerContoursTerritoire().then(([bt, cie, reg]) => {
      const dans = (f) => {
        try {
          return turf.booleanPointInPolygon([point.lng, point.lat], f);
        } catch {
          return false;
        }
      };
      const fBt = bt.features.find(dans);
      const fCie = cie.features.find(dans);
      const fReg = fCie ? null : reg.features.find(dans);
      const territoire = {
        bt: fBt?.properties?.gr_bde ?? null,
        cie: fCie?.properties?.nom ?? null,
        reg: fCie?.properties?.reg ?? fReg?.properties?.nom ?? null,
      };
      setDemandeDeplacement((x) =>
        x && x.ts === calcule.ts
          ? {
            ...x,
            territoire,
            erreur:
              x.erreur ?? (territoire.bt ? null : 'Ce point ne tombe dans aucune brigade connue : il serait ingérable.'),
          }
          : x,
      );
    });
  }, [demandeDeplacement, grapheEtat, graphe, barrageEnDeplacement, preControle, items, assignationsMap, optimisationResultats?.seuilKm, factions]);

  /** Pose un jalon à l'index enAttente. */
  const poserJalon = useCallback(
    (lngLat) => {
      if (!graphe || enAttente === null) return;

      const accroche = RT.accrocher(graphe, lngLat[0], lngLat[1]);
      if (!accroche) {
        setGrapheMessage('Aucune route à moins de 30 km de ce point.');
        return;
      }

      const ref = RT.refArete(graphe, accroche.arete);
      const classe = RT.classeArete(graphe, accroche.arete);
      const nouveauJalon = {
        lng: lngLat[0],
        lat: lngLat[1],
        accroche,
        route: ref ?? RT.nomArete(graphe, accroche.arete) ?? CLASSES_ROUTE[classe]?.fr ?? classe,
      };

      setJalons((prev) => {
        const next = [...prev];
        next[enAttente] = nouveauJalon;
        return next;
      });

      // Enchaînement naturel : passe automatiquement au jalon suivant non défini.
      setEnAttente((idx) => {
        const nextIdx = idx + 1;
        return nextIdx < jalons.length && !jalons[nextIdx] ? nextIdx : null;
      });
    },
    [graphe, enAttente, jalons],
  );

  /** Ajoute un jalon vide à la fin de la liste. */
  const ajouterJalon = useCallback(() => {
    setJalons((prev) => {
      const next = [...prev, null];
      setEnAttente(next.length - 1); // positionner directement sur le nouveau
      return next;
    });
  }, []);

  /** Supprime le jalon à l'index donné (minimum 2 gardés). */
  const supprimerJalon = useCallback((idx) => {
    setJalons((prev) => {
      if (prev.length <= 2) return prev;
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setEnAttente(null);
  }, []);

  /**
   * L'itinéraire multi-points est recalculé à chaque changement de jalons ou de critère.
   * undefined = pas encore tous les points, null = calculé mais aucun chemin.
   */
  const itineraire = useMemo(() => {
    const accrochages = jalons.map((j) => j?.accroche ?? null);
    if (!graphe || accrochages.some((a) => !a) || accrochages.length < 2) return undefined;
    return RT.itineraireMulti(graphe, accrochages, critere);
  }, [graphe, jalons, critere]);

  /** La trace complète du trajet — toutes les jambes bout à bout. */
  const traceItineraire = useMemo(
    () =>
      itineraire?.jambes?.length
        ? itineraire.jambes.filter(Boolean).flatMap((j) => j.trace ?? [])
        : [],
    [itineraire],
  );

  /** Barrages/points noirs le long du trajet, et tronçons sans barrage à proximité — voir analysis.js. */
  const analyseRoute = useMemo(() => {
    if (!traceItineraire.length) return null;
    return analyserCouvertureRoute(traceItineraire, items, traceCumulKm, projeterSurTrace);
  }, [traceItineraire, items]);

  /**
   * Chemin alternatif : le même trajet calculé selon l'AUTRE critère (rapide
   * ↔ court) — pas un second algorithme, juste l'autre réglage déjà
   * disponible dans `RT.itineraireMulti`, pour comparer sans rien inventer.
   */
  const itineraireAlternatif = useMemo(() => {
    const accrochages = jalons.map((j) => j?.accroche ?? null);
    if (!graphe || accrochages.some((a) => !a) || accrochages.length < 2) return undefined;
    const autreCritere = critere === 'rapide' ? 'court' : 'rapide';
    return {
      critere: autreCritere,
      resultat: RT.itineraireMulti(graphe, accrochages, autreCritere),
    };
  }, [graphe, jalons, critere]);

  const effacerTrajet = useCallback(() => {
    setJalons([null, null]);
    setEnAttente(null);
    setGrapheMessage(null);
  }, []);

  const counts = useMemo(() => {
    const c = {};
    for (const [k, s] of Object.entries(store)) {
      if (s.data?.features) c[k] = s.data.features.length;
    }
    // Marquages : comptés sur ce que le serveur a renvoyé, toutes unités, par
    // couche EFFECTIVE — une entrée de ville compte dans sa propre couche,
    // pas dans « Congestion » (voir `cleCoucheEffective`).
    const cles = MQ.TYPES_MARQUAGE.map((t) => MQ.cleCouche(t.key)).concat([
      'mq_zahma_entree_ville',
    ]);
    for (const cle of cles) c[cle] = 0;
    for (const m of items) c[MQ.cleCoucheEffective(m)] = (c[MQ.cleCoucheEffective(m)] ?? 0) + 1;
    return c;
  }, [store, items]);

  /** Données d'une couche, seulement si elle est active ET chargée. */
  const dataFor = (layer) =>
    active.has(layer.key) ? store[layer.dataKey ?? layer.key]?.data : null;

  /* ---- LIMITES TERRITORIALES PILOTÉES PAR LE ZOOM ---- */

  /**
   * L'ÉTAT DES TROIS DÉCOUPAGES, CALCULÉ EN UN SEUL ENDROIT.
   *
   * `niveauCluster` est déjà l'échelon courant de la carte : il est posé par
   * `SuiviZoom` dès le début de l'animation de zoom, et forcé par un clic sur
   * un agrégat. Le réutiliser — plutôt que relire `zoomActuel`, qui n'est mis
   * à jour qu'en fin d'animation — garantit que les limites changent dans le
   * même tour que les agrégats de barrages, et non un tiers de seconde après.
   *
   * Les cases du panneau (`active`) restent prioritaires : voir le paramètre
   * `forcees` de `visibiliteLimites`.
   */
  const limites = useMemo(() => visibiliteLimites(niveauCluster, active), [niveauCluster, active]);
  const echelonTerritorial = limites.echelon;

  /**
   * Couches de limites effectivement montées.
   *
   * Une couche entre ici dès que l'échelon la demande, et n'en sort qu'une
   * fois son fondu terminé — sans ce délai, la sortie serait sèche et le
   * fondu ne se verrait jamais. Elle en sort bel et bien : garder les 500
   * polygones de brigade montés en vue nationale coûterait un redessin
   * complet du canevas à chaque déplacement, pour quelque chose d'invisible.
   *
   * Le FICHIER, lui, n'est téléchargé qu'une fois : il reste dans `store`
   * (voir `useGeoJsonStore`), et remonter la couche ne le redemande pas.
   */
  const [limitesMontees, setLimitesMontees] = useState(() => new Set());
  const retraitLimites = useRef(null);

  useEffect(() => {
    const voulues = COUCHES_LIMITES.filter((cle) => limites.couches[cle].visible);

    setLimitesMontees((prev) => {
      const manquantes = voulues.filter((cle) => !prev.has(cle));
      if (!manquantes.length) return prev;
      const suivant = new Set(prev);
      manquantes.forEach((cle) => suivant.add(cle));
      return suivant;
    });

    clearTimeout(retraitLimites.current);
    retraitLimites.current = setTimeout(() => {
      setLimitesMontees((prev) => {
        const aRetirer = [...prev].filter((cle) => !voulues.includes(cle));
        if (!aRetirer.length) return prev;
        const suivant = new Set(prev);
        aRetirer.forEach((cle) => suivant.delete(cle));
        return suivant;
      });
    }, DUREE_FONDU + 60);

    return () => clearTimeout(retraitLimites.current);
  }, [limites]);

  /**
   * Téléchargement à la demande de l'échelon : la limite de brigade n'est
   * chargée que par celui qui descend jusqu'à elle. Personne n'a plus à
   * cocher une case pour voir le découpage de l'endroit qu'il regarde.
   */
  useEffect(() => {
    for (const cle of COUCHES_LIMITES) {
      if (limites.couches[cle].visible && !store[cle]) load(cle, urlFor(cle));
    }
  }, [limites, store, load, urlFor]);

  /** Données d'une couche de limites : montée, chargée, et rien de plus. */
  const donneesLimite = (cle) => (limitesMontees.has(cle) ? store[cle]?.data ?? null : null);

  /**
   * Contour du territoire national. N'est plus conditionné à une case cochée :
   * le masque fait partie du cadre de la carte, au même titre que ses limites
   * de déplacement et de zoom. Le décocher aurait rouvert la vue sur les pays
   * voisins, ce que les trois dispositifs sont précisément là pour empêcher.
   */
  const territoire = useMemo(
    () => store.territoire?.data?.features?.[0] ?? null,
    [store.territoire],
  );

  /**
   * COUPER LA DEMANDE DE TUILES QUAND LE SERVEUR NE RÉPOND PAS.
   *
   * Leaflet redemande une tuile à chaque déplacement et à chaque zoom. Serveur
   * injoignable, cela produit un flot ininterrompu de requêtes en attente de
   * expiration : la console se remplit, le navigateur garde des dizaines de
   * connexions ouvertes, et le reste de l'application s'en trouve ralenti pour
   * un fond qui n'arrivera pas.
   *
   * Passé un nombre d'échecs sans le moindre succès, on retire donc la couche.
   * Les repères, les contours et les calculs de distance sont servis par le
   * poste local : ils restent tous là, sur fond neutre. Un bouton permet de
   * reprendre l'essai dès que le réseau est rétabli — la coupure est une
   * économie, pas un verdict.
   *
   * Le seuil laisse passer un écran complet d'échecs (une vue en compte une
   * vingtaine) : une tuile isolée qui manque ne doit pas couper le fond.
   */
  const ECHECS_AVANT_COUPURE = 24;

  /**
   * SONDER LE SERVEUR DE TUILES AVANT DE LUI DEMANDER QUOI QUE CE SOIT.
   *
   * Compter les échecs ne suffit pas. `ERR_CONNECTION_TIMED_OUT` met trente à
   * soixante-quinze secondes à remonter : le temps d'atteindre un seuil, la
   * console a reçu des centaines de lignes et le navigateur traîne autant de
   * connexions mortes. Le comptage arrive après la bataille.
   *
   * On pose donc UNE question courte avant d'afficher la couche. Réponse en
   * quelques millisecondes sur un réseau sain — l'attente est invisible ; pas
   * de réponse en quatre secondes, la couche n'est jamais montée et pas une
   * requête de tuile n'est émise.
   *
   * `mode: 'no-cors'` parce qu'on ne lit pas le contenu : on veut savoir si la
   * machine répond. Une tuile absente (404) répond quand même — c'est une
   * réponse, donc la voie est ouverte, et c'est tout ce qu'on demande ici.
   */
  const [sondeOk, setSondeOk] = useState(null);
  const [echecsTuiles, setEchecsTuiles] = useState(0);
  /* Change pour forcer Leaflet à repartir de zéro lors d'un nouvel essai. */
  const [essaiTuiles, setEssaiTuiles] = useState(0);

  /* Le fond vectoriel signale son premier rendu complet, et chacune de ses
     ressources perdues (archive, police, sprite) : mêmes compteurs qu'avant. */
  const fondCharge = useCallback(() => {
    setTilesOk(true);
    setEchecsTuiles(0);
  }, []);
  const fondErreur = useCallback(() => {
    setTilesOk((ok) => ok || false);
    setEchecsTuiles((n) => n + 1);
  }, []);

  useEffect(() => {
    let vivant = true;
    const controle = new AbortController();
    /* Quatre secondes : au-delà, sur un réseau interne, il n'y a personne. */
    const minuteur = setTimeout(() => controle.abort(), 4000);

    /* L'en-tête de l'archive PMTiles — 127 octets, ce que MapLibre lit en premier.
       Une réponse 200/206 prouve que le fond est là ; un 404 qu'il manque. */
    fetch(ARCHIVE_FOND, { cache: 'no-store', headers: { Range: 'bytes=0-126' }, signal: controle.signal })
      .then((r) => vivant && setSondeOk(r.ok))
      .catch(() => vivant && setSondeOk(false))
      .finally(() => clearTimeout(minuteur));

    return () => {
      vivant = false;
      clearTimeout(minuteur);
      controle.abort();
    };
  }, [essaiTuiles]);

  /**
   * Trois raisons de ne pas afficher le fond, et une seule conclusion :
   *
   *   - la sonde n'a pas encore répondu — on attend, quelques millisecondes ;
   *   - la sonde a échoué — le serveur ne répond pas, inutile d'insister ;
   *   - le serveur répondait puis s'est tu en cours de session — le comptage
   *     d'échecs reste utile pour ce cas-là, que la sonde initiale ne voit pas.
   */
  const fondCoupe = sondeOk === false || (tilesOk !== true && echecsTuiles >= ECHECS_AVANT_COUPURE);
  const fondEnAttente = sondeOk === null;

  const reessayerFond = () => {
    setEchecsTuiles(0);
    setTilesOk(null);
    /* Remet la sonde en attente : sans cela, `fondCoupe` resterait vrai et la
       couche ne serait jamais remontée, quel que soit l'état du réseau. */
    setSondeOk(null);
    setEssaiTuiles((n) => n + 1);
  };

  /**
   * Marquages visibles : ceux dont la couche est cochée — ou, pendant qu'un
   * filtre est actif (panneau Filtrer ouvert), exactement le résultat du
   * filtre, quelles que soient les couches cochées : la carte doit montrer
   * ce que la liste montre, pas une intersection déroutante des deux.
   */
  const contexteSession = useMemo(() => {
    if (!session || session.rang === 'admin') return {};
    const reference = items.find((m) =>
      session.rang === 'reg' ? m.reg === session.unite : session.rang === 'cie' ? m.cie === session.unite : m.bt === session.unite,
    );
    if (session.rang === 'reg') return { region: session.unite };
    if (session.rang === 'cie') return { region: session.reg || reference?.reg, compagnie: session.unite };
    return { region: reference?.reg, compagnie: reference?.cie, brigade: session.unite };
  }, [session, items]);

  const contexteTerritorial = contexteNavigation ?? contexteSession;

  /**
   * LA PORTÉE COURANTE — remontée ici, avant le filtrage des repères.
   *
   * Elle vivait plus bas, près du fil d'Ariane qu'elle alimente. Mais c'est
   * elle qui décide désormais de ce que la carte MONTRE, et non plus seulement
   * de ce qu'elle annonce : il faut donc la connaître avant de filtrer.
   */
  const portee = useMemo(
    () => MQ.porteeCourante(session, contexteTerritorial),
    [session, contexteTerritorial],
  );

  /* Tout filtrage relit la liste des conflits (Super Admin) — sans jamais
     ouvrir le panneau : il ne s'ouvre qu'à la demande. */
  useEffect(() => {
    if (session?.rang === 'admin') setVersionConflits((v) => v + 1);
  }, [filtreRoute, portee, active, session?.rang]);

  /**
   * CE QUE LA CARTE MONTRE — deux filtres, et ils ne disent pas la même chose.
   *
   *   `dansSonPerimetre`  le DROIT : ce que le compte peut voir. Fixé par le
   *                       rang, il ne bouge pas, et le serveur l'applique de
   *                       son côté. C'est le cloisonnement.
   *   `dansLaPortee`      le CHOIX : ce que l'utilisateur regarde en ce moment,
   *                       après être descendu dans une compagnie ou une
   *                       brigade. Il RESSERRE le premier, jamais l'inverse
   *                       (voir `porteeCourante`).
   *
   * Sans le second, on entrait dans une compagnie — fil d'Ariane, cadrage,
   * limites, tout suivait — et les barrages des compagnies voisines restaient
   * à l'écran. On décidait sur une unité en lisant le dispositif d'une autre.
   */
  /**
   * LA FACTION QUE L'OPTIMISATION ANALYSE — celle de SON propre choix
   * (`factionOptimisationChoisie`), pas celle du filtre d'affichage.
   * Deux factions ne sont pas tenues en même temps : l'optimisation raisonne
   * donc toujours sur UNE faction. Sous « Sans faction », c'est la faction en
   * cours selon l'horloge du serveur.
   */
  const factionOptimisation =
    !factionOptimisationChoisie || factionOptimisationChoisie === 'toutes'
      ? 'toutes'
      : (factionOptimisationChoisie !== 'sans_faction' ? factionOptimisationChoisie : (factions?.factionActuelle ?? 'toutes'));

  /**
   * CHANGEMENT DE FACTION — le filtre d'affichage, et lui seul.
   *
   * Il relançait autrefois l'optimisation en cours sur la nouvelle faction.
   * L'optimisation des barrages est désormais un module indépendant, avec sa
   * propre faction (`factionOptimisationChoisie`) : filtrer l'affichage ne
   * touche plus à ses calculs.
   */
  const gererChangementFaction = useCallback((nouvelleFaction) => {
    setFactionChoisie(nouvelleFaction);
  }, []);

  /**
   * RELIRE LES REPOSITIONNEMENTS — et réagir à un changement OFFICIEL.
   *
   * Le seuil est celui de l'optimisation affichée (manuel : celui de
   * l'utilisateur ; automatique : 20 km), à défaut celui du serveur. Quand un
   * poste prend une NOUVELLE position officielle (écriture directe, ou demande
   * acceptée — par ce compte ou par un autre), le dépôt est relu et
   * `dispositifVersion` avance : l'optimisation manuelle refait sa mesure,
   * l'automatique se déclare périmée. Une demande en attente ne déclenche rien.
   */
  const seuilRepositionnement = optimisationResultats?.seuilKm ?? null;
  const etatsRepositionnement = useRef(null);
  const chargerRepositionnements = useCallback(async () => {
    if (!session?.matricule) return;
    let r;
    try {
      r = await API.repositionnements({ seuilKm: seuilRepositionnement, factionId: factionOptimisation });
    } catch {
      return;
    }
    const vus = reperesVus(session.matricule);
    const precedents = etatsRepositionnement.current;
    const suivants = new Map();
    const suivant = new Map();
    let officiel = null;
    let dernierOfficiel = null;
    for (const x of r.items ?? []) {
      const cle = `${x.barrageId}|${x.statut}|${x.ts}`;
      suivants.set(x.barrageId, cle);
      if (x.statut !== 'PENDING_APPROVAL') {
        if (precedents && precedents.get(x.barrageId) !== cle) officiel = x;
        if (!dernierOfficiel || Date.parse(x.ts) > Date.parse(dernierOfficiel.ts)) dernierOfficiel = x;
      }
      if (vus.has(`${x.barrageId}|${x.ts}`)) continue;
      suivant.set(x.barrageId, {
        ...x,
        ts: Date.parse(x.ts),
        enAttente: x.statut === 'PENDING_APPROVAL',
        cleVu: `${x.barrageId}|${x.ts}`,
      });
    }
    etatsRepositionnement.current = suivants;
    if (dernierOfficiel) {
      const ts = Date.parse(dernierOfficiel.ts);
      setPositionChangee((p) => (p && p.ts >= ts ? p : { nom: dernierOfficiel.nom, ts, barrageId: dernierOfficiel.barrageId }));
    }
    setRepositionnes(suivant);
    if (officiel) {
      API.listerMarquages().then(setItems).catch(() => { });
      rafraichirAlertes();
      setDispositifVersion((v) => v + 1);
    }
  }, [session?.matricule, seuilRepositionnement, factionOptimisation, rafraichirAlertes]);
  chargerRepositionnementsRef.current = chargerRepositionnements;

  /**
   * APRÈS « ↩ RESTAURER LES POSITIONS INITIALES » — le serveur a remis les
   * barrages et leurs notifications dans l'état de référence et recalculé
   * alertes et conflits. La carte relit tout, sans rien deviner : dépôt,
   * alertes, notifications, repositionnements (aucun après une restauration).
   * Simulation, résultat, sélection et routes temporaires disparaissent ; la
   * configuration de l'optimisation (zone, faction, seuil, mode) reste.
   */
  /* Échap quitte le mode placement ; une restauration ou un changement de résultat aussi. */
  useEffect(() => {
    if (!placementSimulation) return undefined;
    /* La carte doit être libre pour le clic : une bulle ouverte le masquerait. */
    carte.current?.closePopup();
    /* En CAPTURE, et arrêté ici : sinon l’Échap irait au panneau qui a le focus
       (le bouton DÉPLACER) et le fermerait au lieu d’annuler le placement. */
    const surTouche = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPlacementSimulation(null);
    };
    window.addEventListener('keydown', surTouche, true);
    return () => window.removeEventListener('keydown', surTouche, true);
  }, [placementSimulation]);
  useEffect(() => {
    if (!optimisationResultats?.decider) setPlacementSimulation(null);
  }, [optimisationResultats?.decider]);

  const presentationRestauree = useCallback(async () => {
    etatsRepositionnement.current = null;
    setRepositionnes(new Map());
    setPositionChangee(null);
    setOptimisationResultats(null);
    setVise(null);
    setMqSelection(null);
    setPresentationVersion((v) => v + 1);
    try {
      const [liste, alertesMaj] = await Promise.all([API.listerMarquages(), API.listerAlertes()]);
      setItems(liste);
      setAlertes(alertesMaj.items);
    } catch {
      /* La relecture suivante (30 s) rattrapera. */
    }
    rafraichirNotifications();
    chargerRepositionnementsRef.current();
  }, [rafraichirNotifications]);
  /**
   * LES CONFLITS APRÈS DÉPLACEMENT — tracés routiers rendus par le serveur
   * (`tracerEntrePostes`) depuis la NOUVELLE position officielle. Aucun trait
   * droit : un conflit sans tracé n'est pas dessiné, il reste dans la bulle.
   */
  /**
   * LES PAIRES EN CONFLIT ACTIF DU PANNEAU — enregistrées par le serveur ou
   * détectées (optimisation, filtration par route), ni traitées ni supprimées.
   * Même définition que le panneau latéral (voir etatConflits.js).
   */
  const pairesActives = useMemo(
    () => pairesConflitActives({
      serveur: conflitsServeur,
      detectes: [conflitsIdentifies, conflitsCalculesRoute],
      supprimes: conflitsSupprimes,
      clos: pairesCloses,
    }),
    [conflitsServeur, conflitsIdentifies, conflitsCalculesRoute, conflitsSupprimes, pairesCloses],
  );

  /*
   * UN TRACÉ N'EST DESSINÉ QUE POUR UN CONFLIT DU PANNEAU. La mesure du
   * serveur signale tout voisin sous le seuil après déplacement ; tant que la
   * paire n'est pas un conflit actif du panneau (jamais enregistrée, déjà
   * traitée ou supprimée), la carte ne le trace pas — sinon elle montrait un
   * conflit que le panneau ne listait pas, et le trait restait toute la
   * fenêtre de sept jours. La bulle du poste garde la mesure complète.
   */
  const routesRepositionnement = useMemo(() => {
    const out = [];
    for (const [id, info] of repositionnes) {
      if (info.enAttente || !info.impact) continue;
      for (const v of info.impact.voisins ?? []) {
        if (!v.conflitApres || !v.route?.trace?.length) continue;
        if (!pairesActives.has(clePaire(id, v.id))) continue;
        out.push({
          cle: `repose-${id}-${v.id}`,
          trace: v.route.trace,
          km: v.apresKm,
          statut: 'conflit',
          phase: 'apres',
          seuilKm: info.impact.seuilKm,
          titre: v.evolution === 'nouveau' ? 'APRÈS DÉPLACEMENT — NOUVEAU CONFLIT' : 'APRÈS DÉPLACEMENT — CONFLIT MAINTENU',
          a: { nom: info.nom, factionId: v.factionId },
          b: { nom: v.nom, bt: v.bt, factionId: v.factionId },
        });
      }
    }
    return out;
  }, [repositionnes, pairesActives]);
  useEffect(() => {
    chargerRepositionnementsRef.current();
    const minuterie = setInterval(() => chargerRepositionnementsRef.current(), 30_000);
    return () => clearInterval(minuterie);
  }, [session?.matricule, seuilRepositionnement, factionOptimisation]);

  /**
   * LES FACTIONS PROPOSÉES PAR L'APERÇU — `id -> faction d'arrivée`.
   *
   * Vide hors aperçu : le filtre retombe alors sur les affectations réelles.
   */
  const apercuFactions = useMemo(() => {
    const lignes = optimisationResultats?.apercu;
    if (!lignes?.length) return null;
    const m = new Map();
    for (const l of lignes) {
      if (l.nouvelleFactionId) m.set(l.id, l.nouvelleFactionId);
    }
    return m.size ? m : null;
  }, [optimisationResultats]);

  /**
   * LA FACTION ACTUELLEMENT FILTRÉE POUR L'AFFICHAGE.
   * `null` lorsque toutes les factions sont affichées (apparence normale).
   */
  const factionActive = factionChoisie && factionChoisie !== 'toutes' ? factionChoisie : null;

  /**
   * DÉTERMINE SI UN BARRAGE APPARTIENT À UNE FACTION DONNÉE.
   *
   * - Tout barrage intouchable est permanent 24/7 et appartient à TOUTES les factions.
   * - Les non-barrages (accidents, pointages...) ne sont jamais filtrés par faction.
   * - Si 'sans_faction' est ciblé, seuls les postes sans tour d'affectation correspondent.
   * - Pendant l'aperçu d'une simulation, la faction proposée l'emporte.
   */
  const barrageAppartientAFaction = useCallback(
    (m, fId) => {
      if (!fId || fId === 'toutes') return true;
      if (!MQ.estBarrage(m)) return true;
      if (MQ.estIntouchable(m)) return true;

      const proposee = apercuFactions?.get(m.id);
      if (proposee) {
        if (fId === 'sans_faction') return false;
        return proposee === fId;
      }

      const assignes = factions?.assignations?.[m.id];
      if (Array.isArray(assignes) && assignes.length > 0) {
        if (fId === 'sans_faction') return false;
        return assignes.includes(fId);
      }

      if (m.factionId) {
        if (fId === 'sans_faction') return false;
        return m.factionId === fId;
      }
      if (Array.isArray(m.factions) && m.factions.length > 0) {
        if (fId === 'sans_faction') return false;
        return m.factions.includes(fId);
      }

      return fId === 'sans_faction';
    },
    [factions, apercuFactions],
  );

  /**
   * LE DISPOSITIF QUE LA CARTE CONSIDÈRE.
   *
   * Ce tableau est le jeu de données UNIQUE dont dépendent le clustering, les
   * compteurs, les statistiques, la recherche, les bulles et l'optimisation.
   * Le filtre Faction ne masque jamais les barrages des autres factions :
   * tous les barrages restent toujours présents et visibles sur la carte.
   * La distinction s'opère par le style (mise en évidence / atténuation visuelle).
   */
  const marquagesVisibles = useMemo(
    () =>
      items.filter((m) => {
        if (
          !active.has(MQ.cleCoucheEffective(m)) ||
          !MQ.dansSonPerimetre(session, m) ||
          !MQ.dansLaPortee(portee, m)
        ) {
          return false;
        }
        if (filtreRoute) {
          // Filtrage par route : seuls les barrages de cette route sont visibles (évite de mélanger avec d'autres repères)
          if (!MQ.estBarrage(m)) return false;
          const estConflitVise =
            (conflitAssigneVise && (conflitAssigneVise.barrage?.id === m.id || conflitAssigneVise.voisin?.id === m.id)) ||
            (conflitVise && (conflitVise.barrageAId === m.id || conflitVise.barrageBId === m.id));
          if (!estConflitVise) {
            const canFiltre = canonicalRouteId(filtreRoute);
            const canRoute = canonicalRouteId(m.route || m.roadName);
            if (canFiltre && (!canRoute || canRoute !== canFiltre)) {
              return false;
            }
            if (filtreSensRoute && filtreSensRoute !== SENS_TOUS) {
              const dir = obtenirDirectionBarrage(m);
              if (dir !== filtreSensRoute) {
                return false;
              }
            }
          }
        }
        if (MQ.estBarrage(m)) {
          if (filtreEclairageBarrages === 'eclaire' && m.lighting_status !== 'eclaire' && m.eclairage !== 'oui') {
            return false;
          }
          if (filtreEclairageBarrages === 'non_eclaire' && m.lighting_status !== 'non_eclaire' && m.eclairage !== 'non') {
            return false;
          }
          const acc = m.accident_count ?? m.accidentCount;
          if (filtreAccidentsBarrages === 'avec_accidents' && (acc == null || isNaN(acc))) {
            return false;
          }
          if (filtreAccidentsBarrages === '0' && acc !== 0) {
            return false;
          }
          if (filtreAccidentsBarrages === '1-3' && (acc < 1 || acc > 3)) {
            return false;
          }
          if (filtreAccidentsBarrages === '4-7' && (acc < 4 || acc > 7)) {
            return false;
          }
          if (filtreAccidentsBarrages === '8+' && acc < 8) {
            return false;
          }
        }
        return true;
      }),
    [items, active, session, portee, filtreRoute, filtreSensRoute, conflitAssigneVise, conflitVise, filtreEclairageBarrages, filtreAccidentsBarrages],
  );

  const barragesVisiblesCount = useMemo(() => {
    if (!filtreRoute) return null;
    return marquagesVisibles.filter(MQ.estBarrage).length;
  }, [marquagesVisibles, filtreRoute]);

  const [cadre, setCadre] = useState(null);
  const noterCadre = useCallback((b) => {
    setCadre((precedent) =>
      precedent && precedent.every((v, i) => Math.abs(v - b[i]) < 1e-6) ? precedent : b,
    );
  }, []);

  /* ---- CLUSTERING HIÉRARCHIQUE DES BARRAGES ---- */

  /** Index administratif indépendant du zoom. */
  const indexAdministratif = useMemo(
    () => construireIndexAdministratif({
      ptsReg: store.pts_reg?.data, ptsCie: store.pts_cie?.data, ptsBt: store.pts_bt?.data,
      circoReg: store.circo_reg?.data, circoCie: store.circo_cie?.data, circoBt: store.circo_bt?.data,
    }),
    [store.pts_reg?.data, store.pts_cie?.data, store.pts_bt?.data,
    store.circo_reg?.data, store.circo_cie?.data, store.circo_bt?.data],
  );

  /** Les deux représentations agrégées sont préparées lorsque les données,
      filtres, permissions ou géométries changent. Le zoom ne fait que choisir. */
  const clustersPrecalcules = useMemo(
    () => ({
      region: agregerBarragesHierarchie(marquagesVisibles, 'region', indexAdministratif),
      compagnie: agregerBarragesHierarchie(marquagesVisibles, 'compagnie', indexAdministratif),
    }),
    [marquagesVisibles, indexAdministratif],
  );
  const clustersBarrages = clustersPrecalcules[niveauCluster] ?? [];

  /**
   * ANCRES DES ÉTIQUETTES TERRITORIALES — le pôle d'inaccessibilité de chaque
   * région et compagnie, calculé une fois par jeu de limites (voir
   * placementEtiquettes.js). « region:* » : toutes les régions, pour le
   * filigrane des zooms 7–8.
   */
  const zonesEtiquettes = useMemo(() => {
    const zones = new Map();
    const ajouter = (cle, z) => zones.set(cle, [...(zones.get(cle) ?? []), z]);
    for (const [niveau, fc] of [['region', store.circo_reg?.data], ['compagnie', store.circo_cie?.data]]) {
      for (const f of fc?.features ?? []) {
        const nom = nomCirco(f.properties);
        if (!nom || !f.geometry) continue;
        const ancre = poleInaccessibilite(f.geometry);
        if (!ancre) continue;
        const z = { nom, ancre, geometrie: preparerGeometrie(f.geometry), population: f.properties?.population ?? 0 };
        ajouter(`${niveau}:${normaliserNomEntite(nom).toLowerCase()}`, z);
        if (niveau === 'region') ajouter('region:*', z);
      }
    }
    return zones;
  }, [store.circo_reg?.data, store.circo_cie?.data]);

  /** L'entité sélectionnée garde son étiquette, soulignée à l'accent du thème. */
  const selectionEtiquette = useMemo(() => {
    const niveau = { circo_reg: 'region', circo_cie: 'compagnie' }[selection?.couche];
    return niveau ? { niveau, nom: selection.nom } : null;
  }, [selection?.couche, selection?.nom]);

  const synchroniserNiveauCluster = useCallback((zoom) => {
    const prochain = determinerNiveauHierarchie(zoom);
    setNiveauCluster((courant) => (courant === prochain ? courant : prochain));
    if (prochain !== 'barrage') setIdsBarragesCompagnie(null);
    /* Revenir à la vue nationale efface le contour d'une compagnie ou d'une
       brigade : à cette échelle il n'est plus qu'une tache, et il laisserait
       croire que la carte est encore centrée sur elle. Celui d'une région
       reste — c'est l'échelon que cette vue montre. */
    if (prochain === 'region') {
      setContourVise((courant) => (courant && courant.niveau !== 'region' ? null : courant));
    }
  }, []);

  /* Diagnostic opt-in : ajouter ?debug-clustering=1 à l'URL. Les chiffres
     viennent du même tableau et du même niveau que le rendu React-Leaflet. */
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug-clustering')) return;
    const barrages = marquagesVisibles.filter(
      (m) => MQ.estBarrage(m),
    );
    const diagnostic = diagnostiquerHierarchie(barrages, indexAdministratif);
    console.info('[clustering]', JSON.stringify({
      zoom: zoomActuel,
      mode: niveauCluster.toUpperCase(),
      barragesVisibles: barrages.length,
      hierarchieResolue: diagnostic.resolus,
      hierarchieNonResolue: diagnostic.nonResolus,
      hierarchieAmbigue: diagnostic.ambigus,
      clustersRendus: clustersBarrages.length,
      barragesIndividuelsRendus: niveauCluster === 'barrage'
        ? barrages.filter((m) => idsBarragesCompagnie
          ? idsBarragesCompagnie.has(m.id)
          : !cadre || (m.lng >= cadre[0] && m.lng <= cadre[2] && m.lat >= cadre[1] && m.lat <= cadre[3])).length
        : 0,
    }));
  }, [cadre, clustersBarrages, idsBarragesCompagnie, indexAdministratif,
    marquagesVisibles, niveauCluster, zoomActuel]);

  /**
   * Marquages transmis à MarquageLayer : en vue agrégée (zoom < 9) les barrages
   * individuels sont retirés car représentés par les clusters. Les points noirs
   * (accidents) et les congestions restent toujours visibles individuellement.
   */
  /**
   * LES POSTES DU RÉSULTAT D'OPTIMISATION, MÊME HORS DU FILTRE DE FACTION.
   *
   * L'optimisation manuelle compare tous les barrages fixes du périmètre,
   * quelle que soit leur faction ; le filtre de la carte, lui, n'en montre
   * qu'une. Un conflit entre un poste de la faction 3 et un poste de la faction
   * 1 perdait donc son second repère : la route rouge arrivait sur un point
   * vide. Les postes que le résultat désigne sont rendus à la couche
   * d'optimisation — et à elle seule —, toujours dans le périmètre du compte.
   */
  const marquagesOptimisation = useMemo(() => {
    const r = optimisationResultats;
    if (!r) return marquagesVisibles;
    /* Exactement ce que le SERVEUR a désigné : les postes analysés, ceux de
       contexte, et les postes en conflit (ainsi que leurs partenaires). */
    const ids = new Set([
      ...(r.analysesIds ?? []),
      ...(r.contexteIds ?? []),
      ...(r.conflits ? [...r.conflits.keys()] : []),
    ]);
    if (r.conflits) {
      for (const c of r.conflits.values()) {
        if (c.voisinId) ids.add(c.voisinId);
      }
    }
    const deja = new Set(marquagesVisibles.map((m) => m.id));
    const ajoutes = items.filter((m) => ids.has(m.id) && !deja.has(m.id) && MQ.dansSonPerimetre(session, m));
    return ajoutes.length ? [...marquagesVisibles, ...ajoutes] : marquagesVisibles;
  }, [optimisationResultats, marquagesVisibles, items, session]);

  const marquagesPourCouche = useMemo(
    () =>
      marquagesVisibles.filter((m) => {
        const barrage = MQ.estBarrage(m);
        if (niveauCluster !== 'barrage') return !barrage;
        if (!barrage) return true;
        if (idsBarragesCompagnie) return idsBarragesCompagnie.has(m.id);
        return !cadre || (m.lng >= cadre[0] && m.lng <= cadre[2] && m.lat >= cadre[1] && m.lat <= cadre[3]);
      }),
    [marquagesVisibles, niveauCluster, idsBarragesCompagnie, cadre],
  );

  /* Le barrage est DESSINÉ à sa position proposée tant qu'elle existe — sans
     rien écrire : c'est une copie d'affichage, la liste `items` ne change pas.
     La séparation visuelle par sens de circulation évite toute superposition
     sur chaussée bidirectionnelle. */
  const marquagesAffiches = useMemo(() => {
    const p = demandeDeplacement?.point;
    const base = (!p || !armeDeplacement)
      ? marquagesPourCouche
      : marquagesPourCouche.map((m) => (m.id === armeDeplacement ? { ...m, lng: p.lng, lat: p.lat } : m));
    return separerBarragesSens(base);
  }, [marquagesPourCouche, demandeDeplacement, armeDeplacement]);


  /** Zoom vers l'échelon suivant au clic sur un cluster. */
  const surClicCluster = useCallback((cluster) => {
    const reference = cluster.barrages[0];
    /* La limite de l'entité explorée est tracée en même temps que la vue s'y
       rend : sans elle, on ne sait pas lesquels des repères voisins en font
       partie. Voir `ContourEntite`. */
    setContourVise({ niveau: cluster.niveau, nom: cluster.nom });
    if (cluster.niveau === 'compagnie') {
      setIdsBarragesCompagnie(new Set(cluster.barrages.map((barrage) => barrage.id)));
      setNiveauCluster('barrage');
      setContexteNavigation({ region: reference?.reg, compagnie: cluster.nom });
    } else {
      setIdsBarragesCompagnie(null);
      setNiveauCluster('compagnie');
      setContexteNavigation({ region: cluster.nom });
    }
    explorerCluster(carte.current, cluster);
  }, []);

  /**
   * STATISTIQUES DE LA CARTE — comptées sur `marquagesVisibles`, et sur rien
   * d'autre. Pas une seconde source de données : la même liste que celle qui est
   * dessinée, restreinte au cadre affiché.
   *
   * `cadre` est `null` avant le premier relevé (la carte n'est pas encore
   * montée) : tout est alors compté, plutôt que rien.
   */
  /**
   * Taille des pins selon le zoom — un seul calcul pour toutes les couches, et
   * par paliers, donc stable entre deux zooms voisins (voir `echelleZoom`).
   */
  const echellePins = useMemo(() => echelleZoom(zoomActuel), [zoomActuel]);

  /**
   * RÉINITIALISATION DES FILTRES DE LA BARRE DU BAS — natures de marquage,
   * faction, éclairage, accidents — à leur état d'ouverture. L'optimisation
   * des barrages, module à part, n'est pas touchée.
   */
  const filtresModifies =
    MARQUAGE_LAYERS.filter((l) => active.has(l.key) !== Boolean(l.defaultOn)).length +
    (factionChoisie && factionChoisie !== 'toutes' ? 1 : 0) +
    (filtreEclairageBarrages !== 'tous' ? 1 : 0) +
    (filtreAccidentsBarrages !== 'tous' ? 1 : 0);
  const reinitialiserFiltres = () => {
    setActive((prev) => {
      const next = new Set(prev);
      for (const l of MARQUAGE_LAYERS) (l.defaultOn ? next.add(l.key) : next.delete(l.key));
      return next;
    });
    if (factionChoisie && factionChoisie !== 'toutes') gererChangementFaction('toutes');
    setFiltreEclairageBarrages('tous');
    setFiltreAccidentsBarrages('tous');
  };

  /**
   * « RÉINITIALISER » DU BOUTON FILTRES — l'affichage initial : les filtres
   * ci-dessus, les couches et les numéros de routes. L'optimisation des
   * barrages n'est PAS touchée : elle a son propre état et se désactive
   * depuis son propre panneau (MenuOptimisation).
   */
  const reinitialiserAffichage = () => {
    reinitialiserFiltres();
    setActive((prev) => {
      const next = new Set(prev);
      for (const l of COUCHES_FILTRES) (l.defaultOn ? next.add(l.key) : next.delete(l.key));
      return next;
    });
    if (!routesVisibles) basculerRoutes();
  };

  /* Un panneau à la fois : les filtres et les outils de gauche ne se superposent pas. */
  const ouvrirFiltres = () => {
    setPanneauOuvert(null);
    setMenuOptimisationOuvert(false);
    setPanneauConflitsOuvert(false);
    setMenuFiltresOuvert(true);
  };
  const ouvrirOptimisation = () => {
    setPanneauOuvert(null);
    setMenuFiltresOuvert(false);
    setPanneauConflitsOuvert(false);
    setMenuOptimisationOuvert(true);
  };
  /* Le menu des conflits s'ouvre sous son bouton, là où s'ouvrent aussi les
     filtres et l'optimisation : un seul à la fois. */
  useEffect(() => {
    if (panneauConflitsOuvert) {
      setMenuFiltresOuvert(false);
      setMenuOptimisationOuvert(false);
    }
  }, [panneauConflitsOuvert]);
  useEffect(() => {
    if (panneauOuvert) {
      setMenuFiltresOuvert(false);
      setMenuOptimisationOuvert(false);
    }
  }, [panneauOuvert]);

  /* Où s'ouvrent les panneaux des outils : sous la puce « Outils », dans l'écran. */
  const [ancreOutils, setAncreOutils] = useState(null);
  useEffect(() => {
    const placer = () => {
      const r = boutonConflitsRef.current?.getBoundingClientRect?.();
      if (!r) return;
      const gauche = Math.round(Math.max(12, Math.min(r.left, window.innerWidth - 352)));
      const haut = Math.round(r.bottom + 8);
      setAncreOutils((a) => (a?.gauche === gauche && a?.haut === haut ? a : { gauche, haut }));
    };
    placer();
    const minuterie = setInterval(placer, 500);
    window.addEventListener('resize', placer);
    return () => {
      clearInterval(minuterie);
      window.removeEventListener('resize', placer);
    };
  }, []);

  /* Le bord gauche libre : la marge, ou la droite du panneau d'outil ouvert. */
  const bordGauche = panneauOuvert ? 364 : 12;

  /* Les repères dessinés en vue agrégée (accidents, zahma…) : une étiquette
     décalée ne vient pas se poser dessus. */
  const obstaclesEtiquettes = useMemo(
    () => (niveauCluster === 'barrage' ? [] : marquagesAffiches
      .filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng))
      .map((m) => ({ position: [m.lat, m.lng], rayon: 9 }))),
    [marquagesAffiches, niveauCluster],
  );

  const statsCarte = useMemo(() => {
    /**
     * SUR QUOI ON COMPTE — LES DEUX BORNES À LA FOIS.
     *
     * Deux erreurs successives ont mené ici, et chacune enseigne sa moitié :
     *
     *   le CADRE seul     un calcul portant sur « Région Rabat » s'affichait à
     *                     côté d'un total de 115 barrages, dont les trois quarts
     *                     appartenaient aux régions voisines simplement parce
     *                     qu'elles étaient à l'écran ;
     *   le PÉRIMÈTRE seul un calcul « Tout le pays » figeait le résumé à 1 121,
     *                     et déplacer ou zoomer ne changeait plus rien — un
     *                     encart qui commente la carte sans la suivre.
     *
     * On croise donc : le périmètre du calcul BORNE le compte, le cadre affiché
     * le RESSERRE. Panoramique et zoom redeviennent vivants, et aucun poste
     * étranger au périmètre analysé n'entre jamais dans le total.
     */
    const CHAMP_DU_NIVEAU = { region: 'reg', compagnie: 'cie', brigade: 'bt' };
    const per = optimisationResultats?.perimetre;
    const champ = per ? CHAMP_DU_NIVEAU[per.niveau] : null;

    const dansPerimetre = (m) => !champ || !per.unite || m[champ] === per.unite;
    const dansCadre = (m) =>
      !cadre || (m.lng >= cadre[0] && m.lng <= cadre[2] && m.lat >= cadre[1] && m.lat <= cadre[3]);

    const vusOccurrences = marquagesVisibles.filter(
      (m) =>
        MQ.estBarrage(m) &&
        dansPerimetre(m) &&
        dansCadre(m),
    );
    /* Le compteur de l'interface Optimisation porte sur les postes physiques.
       Un même ID peut apparaître dans plusieurs factions (notamment un BFI) :
       garder toutes ses lignes sur la carte, mais ne compter son ID qu'une fois. */
    const vus = uniquesParIdentifiant(vusOccurrences);
    const compte = (f) => vus.filter(f).length;
    /* Une « porte » tient l'entrée ET la sortie : elle compte dans les deux, comme
       partout ailleurs (voir la route consolidation). */
    const porte = (m, sens) => m.positionVille === sens || m.positionVille === 'porte';

    const bfiCount = compte((m) => MQ.estIntouchable(m));
    const fixesNormauxCount = compte((m) => m.type === 'barrage_fixe' && !MQ.estIntouchable(m));
    const mobilesCount = compte((m) => m.type === 'barrage_mobile');

    return {
      total: vus.length,
      bfi: bfiCount,
      fixesNormaux: fixesNormauxCount,
      fixes: fixesNormauxCount,
      mobiles: mobilesCount,
      entrees: compte((m) => porte(m, 'entree')),
      sorties: compte((m) => porte(m, 'sortie')),
      vip: compte((m) => Boolean(m.exceptionnel || m.missionId)),
      nonEclaires: compte((m) => m.eclairage === 'non'),
      /* Relus du résultat d'optimisation, jamais recalculés ici. */
      avecOptimisation: Boolean(optimisationResultats),
      aDecider: compte((m) => optimisationResultats?.annulesIds?.has(m.id)),
      intouchables: bfiCount,
      /**
       * Dit sur quoi porte le compte : un chiffre sans son assiette se lit mal.
       * Les DEUX bornes sont nommées — le périmètre du calcul, puis le cadre —
       * pour qu'un total qui baisse en zoomant ne passe pas pour une panne.
       */
      assiette: [
        optimisationResultats
          ? per?.unite
            ? `${per.niveau === 'compagnie' ? 'Compagnie' : per.niveau === 'brigade' ? 'Brigade' : 'Région'} ${per.unite}`
            : 'Tout le pays'
          : null,
        'cadre affiché',
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }, [marquagesVisibles, cadre, optimisationResultats]);

  useEffect(() => {
    setContexteNavigation((courant) => {
      if (!courant) return courant;
      if (niveauCluster === 'region') return session?.rang === 'admin' ? {} : null;
      if (niveauCluster === 'compagnie' && courant.compagnie) return { region: courant.region };
      return courant;
    });
  }, [niveauCluster, session?.rang]);

  const resumeContexte = useMemo(() => {
    const barrages = uniquesParIdentifiant(marquagesVisibles.filter((m) =>
      MQ.estBarrage(m) &&
      (!contexteTerritorial.region || m.reg === contexteTerritorial.region) &&
      (!contexteTerritorial.compagnie || m.cie === contexteTerritorial.compagnie) &&
      (!contexteTerritorial.brigade || m.bt === contexteTerritorial.brigade),
    ));
    const uniques = (champ) => new Set(barrages.map((m) => m[champ]).filter(Boolean)).size;
    if (contexteTerritorial.brigade) {
      return { titre: `Brigade ${contexteTerritorial.brigade}`, chiffres: [{ valeur: barrages.length, libelle: 'barrages' }] };
    }
    if (contexteTerritorial.compagnie) {
      return {
        titre: `Compagnie ${contexteTerritorial.compagnie}`,
        chiffres: [
          { valeur: barrages.length, libelle: 'barrages' },
          { valeur: uniques('bt'), libelle: 'brigades' },
        ],
      };
    }
    if (contexteTerritorial.region) {
      return {
        titre: `Région ${contexteTerritorial.region}`,
        chiffres: [
          { valeur: barrages.length, libelle: 'barrages' },
          { valeur: uniques('cie'), libelle: 'compagnies' },
          { valeur: uniques('bt'), libelle: 'brigades' },
        ],
      };
    }
    return {
      titre: 'Maroc',
      chiffres: [
        { valeur: barrages.length, libelle: 'barrages' },
        { valeur: uniques('reg'), libelle: 'régions' },
      ],
    };
  }, [marquagesVisibles, contexteTerritorial]);

  const naviguerTerritoire = (niveau, nom) => {
    setSelection(null);
    setIdsBarragesCompagnie(null);
    if (niveau === 'maroc') {
      setZoneFocus(null);
      setContourVise(null);
      setContexteNavigation({});
      if (mouvementReduit()) carte.current?.setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);
      else carte.current?.flyTo(INITIAL_VIEW.center, INITIAL_VIEW.zoom, { duration: 1.0 });
      return;
    }
    cadrerCirconscription(niveau, nom);
  };

  /**
   * DOUBLE-CLIC SUR UNE RÉGION (compagnie, brigade) : on y ENTRE — même chemin
   * que la navigation géographique (cadrage, contour, fil d'Ariane) — puis une
   * petite bulle s'ouvre, une fois la carte arrivée : nom, échelon, chiffres
   * utiles selon le rôle. Aucune grande fenêtre.
   */
  const entrerCirconscription = ({ couche, nom, properties: p = {}, latlng }) => {
    const niveau = couche === 'circo_reg' ? 'region' : couche === 'circo_cie' ? 'compagnie' : 'brigade';
    const champ = niveau === 'region' ? 'reg' : niveau === 'compagnie' ? 'cie' : 'bt';
    const norm = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const barrages = items.filter((m) => MQ.estBarrage(m) && norm(m[champ]) === norm(nom)).length;
    const conflitsZone = conflitsServeur.filter((c) =>
      [c.barrageA ?? c.a, c.barrageB ?? c.b].some((b) => norm(b?.[champ]) === norm(nom)));
    const lignes = [
      `${barrages} barrage${barrages > 1 ? 's' : ''}${p.nbBt != null && niveau !== 'brigade' ? ` · ${p.nbBt} brigade${p.nbBt > 1 ? 's' : ''}` : ''}`,
      commandement && conflitsZone.length ? `${conflitsZone.length} conflit${conflitsZone.length > 1 ? 's' : ''} en cours` : null,
      p.population != null ? `${Number(p.population).toLocaleString('fr-FR')} hab.` : null,
    ];
    const html = bulleCirconscription({
      echelon: niveau === 'region' ? 'Région' : niveau === 'compagnie' ? 'Compagnie' : 'Brigade',
      nom,
      lignes,
    });
    naviguerTerritoire(niveau, nom);
    const map = carte.current;
    if (!map || !latlng) return;
    let ouverte = false;
    const ouvrir = () => {
      if (ouverte) return;
      ouverte = true;
      L.popup({ className: 'gr-bulle-circo-cadre', maxWidth: 220, minWidth: 150, autoPan: false, closeButton: true })
        .setLatLng(latlng)
        .setContent(html)
        .openOn(map);
    };
    map.once('moveend', ouvrir);
    /* La carte était peut-être déjà cadrée : pas de mouvement, pas d'attente. */
    setTimeout(ouvrir, 1400);
  };

  /* NAVIGATION GÉOGRAPHIQUE (NavigationGeographique.jsx) — les contours des
     trois échelons, chargés à l'ouverture du menu seulement. */
  const chargerContoursNavigation = useCallback(() => {
    for (const k of ['circo_reg', 'circo_cie', 'circo_bt']) if (!store[k]) load(k, urlFor(k));
  }, [store, load, urlFor]);
  /* Ce que le compte impose : un CMD Région reste dans sa région, etc. */
  const figeNavigation = useMemo(() => {
    if (!session || session.rang === 'admin') return {};
    if (session.rang === 'reg') return { region: session.unite };
    if (session.rang === 'cie') return { region: contexteSession.region, compagnie: session.unite };
    return { region: contexteSession.region, compagnie: contexteSession.compagnie, brigade: contexteSession.brigade };
  }, [session, contexteSession]);
  /* « Recentrer » : l'échelon le plus fin de la zone sélectionnée. */
  const recentrerZoneNavigation = () => {
    const c = contexteTerritorial ?? {};
    if (c.brigade) cadrerCirconscription('brigade', c.brigade);
    else if (c.compagnie) cadrerCirconscription('compagnie', c.compagnie);
    else if (c.region) cadrerCirconscription('region', c.region);
    else naviguerTerritoire('maroc');
  };

  const [positionUtilisateur, setPositionUtilisateur] = useState(null);

  const localiserPosition = useCallback(() => {
    if (!navigator.geolocation) {
      notifier.avertissement('La géolocalisation n’est pas disponible sur votre navigateur.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setPositionUtilisateur([latitude, longitude]);
        if (carte.current) {
          if (mouvementReduit()) {
            carte.current.setView([latitude, longitude], 14);
          } else {
            carte.current.flyTo([latitude, longitude], 14, { duration: 1.2 });
          }
        }
        notifier.succes('Position GPS localisée');
      },
      (err) => {
        console.warn('Erreur geolocalisation:', err);
        notifier.info('Impossible d’obtenir votre position GPS.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }, []);

  const recentrerCarte = () => {
    if (perimetre) {
      const bounds = L.geoJSON(perimetre).getBounds();
      if (bounds.isValid()) {
        carte.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
        setContexteNavigation(null);
        return;
      }
    }
    carte.current?.setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);
    setContexteNavigation(session?.rang === 'admin' ? {} : null);
  };

  const ouvrirBrigade = (bt) => {
    const reference = items.find((m) => m.bt === bt);
    setContexteNavigation({ region: reference?.reg, compagnie: reference?.cie, brigade: bt });
    setBrigadeDemandee({ bt, ts: Date.now() });
    ouvrirPanneau('saisie');
  };

  const sectionsNavigation = [
    {
      label: 'Principal',
      items: [
        {
          id: 'barrages',
          label: 'Barrages',
          court: 'Barrages',
          icon: IconMarquage,
          active: mqOpen && demandeTache?.cle !== 'effectif',
          onClick: () => {
            setDemandeTache({ cle: 'menu', ts: Date.now() });
            ouvrirPanneau('saisie');
          },
        },
        /* Filtres, Optimisation et Conflits : dans le menu « Outils » de la carte
           (MenuOutilsCarte) — pas en double ici. */
        {
          id: 'distances',
          label: 'Itinéraires',
          court: 'Trajet',
          icon: IconDistance,
          active: distOpen,
          onClick: () => {
            if (distOpen) setEnAttente(null);
            basculerPanneau('distances');
          },
        },
        {
          id: 'legende',
          label: 'Légende',
          court: 'Légende',
          icon: IconTerritoire,
          active: legendeOuverte,
          onClick: () => changerLegende(!legendeOuverte),
        },
      ],
    },
  ];

  const outilsSecondaires = [
    {
      id: 'analyse',
      label: 'Analyse opérationnelle & Risques',
      icon: IconTarget,
      active: analysisOpen,
      onClick: () => basculerPanneau('analyse'),
    },
    {
      id: 'optimisation_route',
      label: 'Filtrage par axe routier',
      icon: IconRoute,
      active: modalFiltreRouteOuverte || Boolean(filtreRoute),
      badge: filtreRoute ? filtreRoute : null,
      onClick: () => setModalFiltreRouteOuverte(true),
    },
    /* Ancien bouton « Ma position » de la colonne de droite, retirée pour
       dégager la carte : la fonction reste ici. */
    {
      id: 'ma_position',
      label: 'Ma position (GPS)',
      icon: IconTarget,
      onClick: localiserPosition,
    },
    {
      id: 'organisation',
      label: 'Hiérarchie territoriale',
      icon: IconTerritoire,
      active: organisationOpen,
      onClick: () => basculerPanneau('organisation'),
    },
    {
      id: 'effectifs',
      label: 'Effectifs & Relèves terrain',
      icon: IconHoraire,
      active: mqOpen && demandeTache?.cle === 'effectif',
      onClick: () => ouvrirTacheTerrain('effectif'),
    },
    {
      id: 'notifications',
      label: 'Dossiers de décision',
      icon: IconAlert,
      active: notificationsOpen,
      badge: notificationsOuvertes,
      onClick: () => basculerPanneau('notifications'),
    },
    ...(session?.rang === 'admin'
      ? [
          {
            id: 'admin',
            label: 'Administration & Comptes',
            icon: IconChef,
            active: adminOpen,
            onClick: () => basculerPanneau('admin'),
          },
        ]
      : []),
  ];

  return (
    /* `data-gr-scene` : le repère auquel la légende flottante rapporte sa
       position. Une classe aurait fait l'affaire, mais elle se renomme au fil
       des retouches de style ; cet attribut ne sert qu'à ça et se cherche. */
    <div data-gr-command-center data-gr-focus={modeFocus || undefined} className="relative h-dvh w-full overflow-hidden bg-gr-deep">
      <div
        data-gr-scene
        /* La portée courante, lisible dans le DOM — même usage que
           `data-gr-scene` : un repère stable pour les épreuves, et de quoi
           constater d'un coup d'œil sur quoi la carte travaille. */
        data-gr-portee={portee ? `${portee.niveau}:${portee.unite}` : 'national'}
        /* Choix d'une nouvelle position : le fond de carte seul (index.css).
           L'attribut tombe avec le mode — confirmation, annulation ou erreur —
           et tout revient tel quel. */
        data-gr-selection-position={armeDeplacement !== null || undefined}
        className={`relative h-full w-full ${arme || enAttente ? 'gr-armed' : ''}`}
      >
        <NavigationRail
          masquerBouton
          ouvert={voletNavigationOuvert}
          onOuvertChange={setVoletNavigationOuvert}
          decalageGauche={bordGauche}
          sections={sectionsNavigation}
          outilsSecondaires={outilsSecondaires}
          canCreate={session?.role !== 'lecture'}
          onCreate={() => ouvrirTacheTerrain('poser', 'barrage_fixe')}
          onBrandClick={recentrerCarte}
        />
        <CommandBar
          session={session}
          mode={mode}
          source={API.sourceDonnees()}
          panneauOuvert={panneauOuvert !== null}
          panneauDroitOuvert={false}
          onLogout={deconnexion}
          onDemandeDeconnexion={() => setDemandeDeconnexion(true)}
          apparence={apparence}
          onChoisirTheme={choisirTheme}
          onFocus={() => setModeFocus(true)}
          /* OUTILS DE LA CARTE — Filtres, Optimisation, Conflits : une puce de la
             rangée du haut. Chaque outil garde son panneau, ouvert sous elle. */
          outils={
            <MenuOutilsCarte
            enLigne
            ref={boutonConflitsRef}
            decalageGauche={bordGauche}
            outils={[
              {
                cle: 'filtres',
                libelle: 'Filtres',
                compteur:
                  filtresModifies +
                  COUCHES_FILTRES.filter((c) => active.has(c.key) !== Boolean(c.defaultOn)).length +
                  (routesVisibles ? 0 : 1),
                actif: menuFiltresOuvert,
                onChoisir: () => (menuFiltresOuvert ? setMenuFiltresOuvert(false) : ouvrirFiltres()),
              },
              {
                cle: 'optimisation',
                libelle: 'Optimisation des barrages',
                libelleCourt: 'Optimisation',
                compteur: nombreOptimisationsActives(ongletsOptimisationComplets),
                actif: menuOptimisationOuvert,
                onChoisir: () => (menuOptimisationOuvert ? setMenuOptimisationOuvert(false) : ouvrirOptimisation()),
              },
              ...(commandement
                ? [
                    {
                      cle: 'conflits',
                      libelle: destinataireConflits ? 'Conflits à traiter' : 'Conflits',
                      libelleCourt: 'Conflits',
                      compteur: destinataireConflits ? conflitsATraiter : 0,
                      /* Ce qui attend le commandement se voit sans ouvrir le menu. */
                      compteurBouton: destinataireConflits ? conflitsATraiter : 0,
                      actif: panneauConflitsOuvert,
                      onChoisir: () => setPanneauConflitsOuvert((v) => !v),
                    },
                  ]
                : []),
            ]}
          />
          }
          breadcrumb={
            /* Le bouton de navigation AVANT le fil d'Ariane : la barre du haut
               est bornée en largeur, c'est le fil qui se tronque, jamais lui. */
            <div className="flex min-w-0 items-center gap-1.5">
              <NavigationGeographique
                couches={{ region: store.circo_reg?.data, compagnie: store.circo_cie?.data, brigade: store.circo_bt?.data }}
                charger={chargerContoursNavigation}
                contexte={contexteTerritorial}
                fige={figeNavigation}
                onChoisir={cadrerCirconscription}
                onMaroc={() => naviguerTerritoire('maroc')}
                onRecentrer={recentrerZoneNavigation}
              />
              <TerritorialBreadcrumb contexte={contexteTerritorial} onNavigate={naviguerTerritoire} />
            </div>
          }
          contextSummary={
            <ContextSummary
              resume={resumeContexte}
              optimisation={optimisationResultats?.situation ?? null}
            />
          }
          recherche={(
            <RechercheCarte
              integree
              fixe
              onMenu={() => setVoletNavigationOuvert(true)}
              masquee={bulleOuverte}
              items={items}
              onAller={(m) => cadrerMq(m, { persistant: true })}
              onCentrerLieu={(coord, zoom) => {
                if (mouvementReduit()) {
                  carte.current?.setView(coord, zoom);
                } else {
                  carte.current?.flyTo(coord, zoom, { duration: 1.0 });
                }
              }}
              onBrigade={ouvrirBrigade}
              onRouteSelect={(route) => handleFiltrerRoute(route)}
            />
          )}
        />
        <MapContainer
          center={INITIAL_VIEW.center}
          zoom={INITIAL_VIEW.zoom}
          zoomControl={false}
          /* Le préfixe par défaut de Leaflet pointe vers leafletjs.com :
             lien mort sur un réseau fermé, on le remplace ci-dessous. */
          attributionControl={false}
          preferCanvas /* indispensable : des milliers de vecteurs */
          /* La carte ne sort pas du territoire — voir BORNES_MAROC. La viscosité
             à 1 rend la limite ferme : le fond ne se laisse pas tirer au-delà
             puis revenir en arrière, il s'arrête net au bord. */
          maxBounds={BORNES_MAROC}
          maxBoundsViscosity={1}
          /* Molette et pavé tactile : zoom par quarts de niveau, moins
             brusque (120 px de défilement par niveau au lieu de 60). Il n'y a
             pas de boutons +/− : molette, pincement, double-clic et clavier
             suffisent, et la carte reste dégagée. */
          zoomSnap={0.25}
          zoomDelta={0.5}
          wheelPxPerZoomLevel={120}
          wheelDebounceTime={30}
          className="h-full w-full relative z-0"
          style={{ isolation: 'isolate' }}
        >
          <LimiterAuTerritoire bornes={bornesPortee} />
          {/* Fond de carte unique : la carte hors ligne de maroc-carte-offline
            (voir mapConfig.js). Retiré quand l'archive est introuvable — voir
            `fondCoupe`. La clé force un montage neuf à chaque nouvel essai. */}
          {!fondCoupe && !fondEnAttente && (
            <FondCarteVectoriel key={essaiTuiles} onCharge={fondCharge} onErreur={fondErreur} routes={routesVisibles} theme={theme}
              /* Une route ou un trajet choisi pour l'optimisation : les autres
                 routes s'effacent pour que le tracé se lise. */
              attenuer={Boolean(vueRoute?.lignes?.length) || Boolean(filtreRoute)}
            />
          )}

          <VoletBrume />
          <ExposeCarte cible={carte} />
          {/* Optimisation par route : tracé, corridor, barrages concernés, conflits. */}
          {Boolean(vueRoute?.lignes?.length) && (
            <CoucheOptimisationRoute
              vue={vueRouteAffichee}
              onAssigner={demanderAssignationConflit}
              estAdmin={session?.rang === 'admin'}
            />
          )}
          <ChoixPointLibre actif={Boolean(vueRoute?.choix)} onPoint={vueRoute?.onPoint ?? rienAFaire} />
          <SuiviZoom onZoom={setZoomActuel} onNiveau={synchroniserNiveauCluster} />
          {/* Cadre visible : ce qui borne les statistiques de la carte. */}
          <SuiviCadre onCadre={noterCadre} />

          {/* Repère GPS de l'utilisateur — Style Google Maps pulsing blue dot */}
          {positionUtilisateur && (
            <Marker
              position={positionUtilisateur}
              icon={L.divIcon({
                className: 'gr-pos-gps',
                html: '<div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;"><div style="position:absolute;width:24px;height:24px;border-radius:50%;background:rgba(66,133,244,0.35);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div><div style="position:relative;width:14px;height:14px;border-radius:50%;background:#1a73e8;border:2.5px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div></div>',
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              })}
            >
              <Tooltip direction="top" offset={[0, -10]}>Votre position actuelle</Tooltip>
            </Marker>
          )}

          {/**
         * Un seul capteur de clic pour trois outils, avec une priorité explicite :
         * un jalon de distance passe avant la pose d'un marquage, qui passe
         * avant la pose d'un marquage. Sans cette règle, activer plusieurs outils
         * créerait un effet à chaque clic — et l'ordre dépendrait de
         * l'implémentation.
         */}
          <CaptureClic
            actif={enAttente !== null || !!arme}
            onClic={(lngLat) => (enAttente !== null ? poserJalon(lngLat) : poser(lngLat))}
          />

          {/* Le clic carte referme la section ouverte — voir FermerAuClicCarte.
            Jamais quand un outil attend ce même clic : la condition est
            l'exacte réciproque de celle de `CaptureClic` ci-dessus. Une pose
            en attente de confirmation est couverte par `arme`, qui reste
            positionné jusqu'à la validation (voir `poser`). */}
          <FermerAuClicCarte
            actif={
              /* L'optimisation par route se règle EN cliquant la carte (route,
                 localité, variante) : un clic ne la replie pas. */
              ((panneauOuvert !== null && panneauOuvert !== 'route') || vise !== null) &&
              armeDeplacement === null &&
              !arme &&
              enAttente === null
            }
            onFermer={() => {
              setPanneauOuvert(null);
              /* Cliquer ailleurs, c'est désigner autre chose — ou plus rien. La
                 marque de sélection suit le geste au lieu de survivre à ce qui
                 l'a motivée. */
              setVise(null);
            }}
          />

          {/* « Je suis ici » : le poste que l'on vient de désigner — voir
            CibleLayer. Il passe SOUS les repères par `zIndexOffset`, pas par
            sa place ici : Leaflet range tous les marqueurs dans le même
            calque, l'ordre du JSX n'y change rien. */}
          {/* Un conflit désigné par sa route n'a pas d'anneau : la route rouge mise
            en avant EST la désignation, et l'optimisation ne dessine aucun cercle. */}
          <CibleLayer cible={vise?.parTrajet ? null : vise} />

          {/* Impulsion radar et repères des conflits nouvellement détectés. */}
          <GardeErreur nom="radar" silencieux cle={radarConflits}>
            <RadarConflits conflits={radarConflits} onVoir={voirConflitDetecte} traceDe={traceRoutiereDe} masquer={conflitAssigneVise?.conflitId ?? null} />
          </GardeErreur>
          {/* Conflits trouvés par l'analyse d'un axe (Filtrer par route → Calculer). */}
          <GardeErreur nom="radar-analyse-resultats" silencieux cle={radarCalcul}>
            <RadarConflits conflits={radarCalcul} onVoir={voirResultatCalcul} traceDe={traceRoutiereDe} masquer={conflitAssigneVise?.conflitId ?? null} />
          </GardeErreur>

          {/* La barre de recherche s'efface tant qu'une bulle est ouverte. */}
          <SuiviBulle onChangement={setBulleOuverte} />

          {/* Réseau routier : dessiné par le fond de carte hors ligne lui-même
            (routes, numéros et noms), sous toutes les couches. */}

          {/* Voile hors territoire : juste au-dessus du fond, sous les données */}
          {territoire && <VoileTerritoire feature={territoire} theme={theme} />}

          {/* LIMITES TERRITORIALES — l'échelon suit le zoom.
            Région seule en vue nationale, compagnies à partir du zoom 7,
            brigades à partir du 9, chacune avec son parent en retrait. Un
            seul endroit décide : `visibiliteLimites` (limitesTerritoriales.js).
            Ordre de superposition : surfaces, puis points, puis liaisons. */}
          <VoletsLimites />
          <VoletSelection />
          <AppliquerLimites couches={limites.couches} />
          {CIRCO_LAYERS.map((cfg) => {
            const data = donneesLimite(cfg.key);
            if (!data) return null;
            const etat = limites.couches[cfg.key];
            return (
              <LayerGroup key={cfg.key}>
                {/* Liseré d'abord : il doit passer SOUS le contour coloré */}
                <Casing data={data} weight={cfg.weight} pane={PANE_LIMITES[cfg.key].nom} theme={theme} />
                <CircoLayer
                  cfg={cfg}
                  data={data}
                  selection={selection}
                  onSelect={handleSelect}
                  onEntrer={entrerCirconscription}
                  pane={PANE_LIMITES[cfg.key].nom}
                  attenue={etat.role !== 'principal'}
                  /* Cloisonnement : un contour hors portée se voit, ne s'ouvre
                     pas et ne se sélectionne pas (voir `contourDansLaPortee`). */
                  autorise={contourDansLaPortee(cfg.key)}
                  onRefus={refuserContour}
                  bornesRetour={perimetre ? bornesPortee : null}
                  /* Vrai dès qu'un outil attend un clic sur la carte : pose d'un
                     marquage ou jalon de distance. Le contour doit alors laisser
                     passer le clic. */
                  outilArme={Boolean(arme) || enAttente !== null || armeDeplacement !== null}
                  theme={theme}
                />
              </LayerGroup>
            );
          })}

          {/* Périmètre d'habilitation : visible dès la connexion, pas seulement
            panneau Saisie ouvert — un chef doit voir sa zone même en simple
            consultation de la carte. */}
          <PerimetreSaisie feature={perimetre} />

          {/* Limite de la région ou de la compagnie où l'on vient de se rendre —
            au-dessus des couches surfaciques, sous les repères. */}
          <ContourEntite feature={featureContourVise} couleur={couleurContourVise} />

          {POINT_LAYERS.concat(INFRASTRUCTURE_LAYERS).map((cfg) => {
            const data = dataFor(cfg);
            return data ? (
              <PointLayer
                key={cfg.key}
                cfg={cfg}
                data={data}
                echelle={echellePins}
                niveauHierarchie={niveauCluster}
              />
            ) : null;
          })}

          {active.has(POINTAGE_LAYERS[0].key) && store.pointages?.data && (
            <PointageLayer
              data={store.pointages.data}
              cfg={POINTAGE_LAYERS[0]}
              echelle={echellePins}
            />
          )}

          {PROXIMITY_LAYERS.map((cfg) =>
            active.has(cfg.key) && proximite[cfg.key] ? (
              <ProximityLayer key={cfg.key} prox={proximite[cfg.key]} color={cfg.color} />
            ) : null,
          )}

          {/* Navigation visuelle stricte : Région → Compagnie → barrages. */}
          {clustersBarrages.length > 0 && (
            <BarrageClusterLayer
              clusters={clustersBarrages}
              onClusterClick={surClicCluster}
              zones={zonesEtiquettes}
              selection={selectionEtiquette}
              obstacles={obstaclesEtiquettes}
              theme={theme}
            />
          )}

          {/* Marquages : au-dessus des couches livrées, ce sont eux qu'on manipule.
            En vue agrégée (zoom < 9), seuls les non-barrages sont dessinés ici ;
            les barrages sont représentés par les clusters ci-dessus. */}
          {marquagesPourCouche.length > 0 && (
            <MarquageLayer
              items={marquagesAffiches}
              /* La bulle du poste désigné s'ouvre seule — voir OuvreSiVise. */
              vise={vise}
              piedEffectif={piedEffectif}
              /* Pour que la bulle nomme les tours de service du poste. */
              factions={factions}
              /**
               * MÊME RÈGLE QUE LE SERVEUR — et exactement la même que `gerable` :
               * le droit de retirer un repère EST le droit d'écrire dessus.
               *
               * Ce prédicat exigeait d'être l'auteur du barrage ou
               * l'administrateur. Un chef ne pouvait donc pas défaire le poste
               * qu'un de ses subordonnés venait de placer par erreur dans sa
               * propre circonscription, ce qui n'a pas de sens : l'autorité sur
               * un territoire ne se partage pas par paternité de saisie.
               * Le serveur a été aligné dans le même mouvement (voir la note sur
               * la suppression dans serveur/api.mjs).
               */
              peutRetirer={gererMarquage}
              /* Pins réduits en vue large : voir `echelleZoom`. */
              echelle={echellePins}
              /* Déplaçable seulement panneau ouvert ET dans son autorité : en
                 consultation, un repère ne bouge pas sur un glissement
                 involontaire — et le serveur refuserait de toute façon. */
              editable={(m) => mqOpen && gererMarquage(m)}
              /* Distinct d'`editable` à dessein. Le DÉPLACEMENT reste réservé au
                 panneau ouvert : en consultation, un repère ne doit pas glisser
                 sur un geste involontaire. La GESTION, elle, ne dépend que de
                 l'autorité — c'est justement quand le panneau est fermé qu'on a
                 besoin d'un accès direct depuis la carte. */
              gerable={gererMarquage}
              importants={importants}
              onArmerDeplacement={demarrerDeplacement}
              onChangerFaction={changerFactionPermis ? demanderChangementFaction : null}
              onAssigner={superviseur ? demanderAssignation : null}
              estAdmin={superviseur}
              onOuvrir={(id) => {
                setMqSelection(id);
                ouvrirPanneau('saisie');
              }}
              onSupprimer={supprimerMq}
              onModifierBarrage={(m) => {
                carte.current?.closePopup();
                annulerDeplacement();
                setEditionBarrageId(m.id);
              }}
              /* Les barrages signalés par l'optimisation sont rendus par elle :
                 « ? » tant qu'ils attendent une décision, « ✓ » une fois
                 conservés. Dans les deux cas le repère REMPLACE l'icône du
                 barrage au lieu de s'y superposer — voir OptimisationLayer. */
              masques={masquesBarrages}
              on3D={(m) => setModal3DItem(m)}
              optimisationResultats={optimisationResultats}
              tousItems={items}
              assignationsMap={assignationsMap}
              onVoirConflit={afficherConflitSurCarte}
              factionActive={factionActive}
              barrageAppartientAFaction={barrageAppartientAFaction}
            />
          )}

          {/* Les traits d'alerte de distance entre barrages ont été retirés de la
            carte : avec un parc dense, ils traçaient des centaines de liaisons
            rouges qui masquaient les données. Le rapprochement se traite
            désormais dans le panneau Optimisation, qui le mesure et propose une
            correction — voir OptimisationPanel.jsx. Les alertes restent
            calculées côté serveur et alimentent les statistiques d'analyse. */}

          {/* Résultat de l'optimisation : rouge = proposé au retrait, vert = conservé.
            Au-dessus des couches de données, sous la brume. */}
          {/* Les liens d'abord : les repères « ? » doivent rester au-dessus. */}
          {/* À tout niveau de zoom : un conflit se voit même avant d'être au
            niveau du barrage — la route rouge est justement ce qui y mène. */}
          {/* Les conflits mesurés du manuel sont dessinés par ConflitsIdentifiesLayer
            (plus bas), avec les routes AVANT / APRÈS : une seule couche numérote
            et sépare toutes les paires. */}
          {/* Ce que chaque poste EST — accidents, VIP, éclairage, entrée/sortie.
            S'ajoute aux repères ci-dessous sans jamais les remplacer, et ne
            paraît qu'une fois assez près pour être lu (voir carteLisibilite.js). */}
          <BadgesLayer
            items={marquagesPourCouche}
            badges={optimisationResultats?.badges}
            zoom={zoomActuel}
            factionActive={factionActive}
            barrageAppartientAFaction={barrageAppartientAFaction}
          />

          {/* Les décisions restent dans les totaux agrégés. Leurs repères et
            commandes réapparaissent au niveau individuel, après drill-down. */}
          {niveauCluster === 'barrage' && <>
            <DecisionsLayer
              items={marquagesVisibles}
              criteres={criteresParBarrage}
              piedEffectif={piedEffectif}
              focusId={focusBarrageId}
              exclusIds={optimisationResultats?.masquesIds}
              onDecider={deciderBarrageSignale}
              /**
               * LE DOSSIER OUVERT, PASSÉ TEL QUEL.
               *
               * Le repère « ✗ » annonçait « en attente du commandant » même au
               * commandant qui le lisait : il fallait aller chercher la cloche
               * pour répondre à ce qu'on avait sous les yeux. La bulle tranche
               * désormais sur place, par le MÊME chemin que le panneau des
               * notifications — `deciderNotification`, donc le même appel
               * serveur, le même rafraîchissement et le même recalcul du
               * voisinage après un retrait accepté.
               */
              notifications={notifications}
              onDeciderDemande={deciderNotification}
              session={session}
              peutReprendre={!superviseur && session?.rang === 'admin'}
            />


          </>}

          {/* Le résultat courant reste visible à toute échelle et indépendamment
            du zoom, mais suit le même filtre territorial et de faction que les
            barrages affichés sur la carte. Le calcul reste, lui, inchangé. */}
          <ContexteOptimisationLayer
            contexte={optimisationResultats?.contexte}
            items={marquagesOptimisation}
            echelle={echellePins}
            conflits={optimisationResultats?.conflits}
          />
          <DecisionsSimuleesLayer
            resultats={optimisationResultats}
            items={items}
            echelle={echellePins}
            propsBulle={propsBulleMarquage}
          />
          {/* LES BARRAGES EN CONFLIT — repère dédié, bulle ordinaire + section conflit. */}
          <BarragesEnConflitLayer
            resultats={optimisationResultats}
            items={items}
            echelle={echellePins}
            vise={vise}
            propsBulle={propsBulleMarquage}
            conflitsSupprimes={conflitsSupprimes}
          />
          <OptimisationLayer
            items={items}
            resultats={optimisationResultats}
            vise={vise}
            piedEffectif={piedEffectif}
            onDecider={deciderBarrageSignale}
            /* Même bulle, même dossier : voir DecisionsLayer ci-dessus. */
            notifications={notifications}
            onDeciderDemande={deciderNotification}
            session={session}
            peutReprendre={!superviseur && session?.rang === 'admin'}
            echelle={echellePins}
            propsBulle={propsBulleMarquage}
          />

          {/* LA VERSION PROPOSÉE, par-dessus le dispositif réel — voir
            ApercuOptimisationLayer. Elle n'apparaît que sur demande explicite
            (« Voir la version optimisée »), et rien n'est écrit tant qu'elle
            est à l'écran. */}
          {/* LES ROUTES EN CONFLIT — la vraie géométrie routière, avec sa
            distance et sa durée. Dessinées sous l'aperçu pour que les repères
            de position restent au-dessus du trait. */}
          {/* QUI EST EN CONFLIT AVEC QUI — chaque paire numérotée (C-01…), sur
            sa propre voie, ses deux extrémités nommées, et les badges des
            barrages. Voir ConflitsIdentifiesLayer. */}
          <ConflitsIdentifiesLayer
            routes={routesConflitsOptim}
            conflits={filtreOptim(optimisationResultats, 'conflits') ? conflitsIdentifies : null}
            items={items}
            vise={conflitVise}
            onViser={viserConflit}
            seuilKm={optimisationResultats?.seuilKm}
            barrageVise={vise?.id ?? null}
            /* Panneau latéral à gauche, fiche du conflit en haut (≈ 190 px) plus
               la hauteur d'une épingle et de sa légende, filtres en bas. */
            marges={{ gauche: (panneauOuvert ? 440 : 96) + 40, haut: 260, droite: 90, bas: 110 }}
            estAdmin={session?.rang === 'admin'}
            session={session}
            onAssigner={demanderAssignationConflit}
          />

          <RoutesConflitLayer routes={routesRepositionnement} seuilKm={seuilRepositionnement} items={items} />
          {/* LES BARRAGES REPOSITIONNÉS — à toute échelle, hors du regroupement :
            après un rechargement, la carte s'ouvre au niveau national, et le
            repère doit s'y voir sans qu'on ait à zoomer. */}
          {placementSimulation && (
            <div className="leaflet-top leaflet-left" style={{ pointerEvents: 'none', left: '50%', transform: 'translateX(-50%)', top: 70 }}>
              <div
                data-gr-placement-simulation={placementSimulation.barrageId}
                /* Un clic sur le bandeau n’est pas un point de la carte. */
                ref={(el) => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); } }}
                className="leaflet-control"
                style={{ pointerEvents: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--primary)', borderRadius: 10, padding: '8px 12px', color: 'var(--text-primary)', fontSize: 12, boxShadow: 'var(--shadow-popup)' }}
              >
                <b style={{ color: 'var(--primary)' }}>↗ Sélectionnez une nouvelle position sur la carte</b>
                <span style={{ display: 'block', opacity: 0.8 }}>{placementSimulation.nom} — le point sera recalé sur la route la plus proche. Simulation : rien n’est enregistré.</span>
                <button
                  type="button"
                  className="gr-popup-act"
                  style={{ marginTop: 6 }}
                  onClick={(e) => { e.stopPropagation(); setPlacementSimulation(null); }}
                >
                  Annuler (Échap)
                </button>
              </div>
            </div>
          )}

          <ApercuOptimisationLayer
            apercu={filtreOptim(optimisationResultats, 'deplacements') ? optimisationResultats?.apercu : null}
            echelle={echellePins}
            intouchables={filtreOptim(optimisationResultats, 'intouchables')}
            ouvrirId={propositionOuverte}
            conflits={optimisationResultats?.conflits}
            onOuvert={viderPropositionOuverte}
            actionsDe={(p) => (superviseur
              ? { assigner: () => demanderAssignation({ id: p.id, nom: p.nom }) }
              : (p.mode === 'manuel'
                ? {
                  modifierPosition: () => setPlacementSimulation({ barrageId: p.id, nom: p.nom }),
                  conserver: () => optimisationResultats?.decider?.(p.id, 'conserver'),
                }
                : optimisationResultats?.basculerAuto
                  ? { conserver: () => optimisationResultats.basculerAuto(p.id) }
                  : null))}
          />

          {/* LE PLACEMENT D'UN DÉPLACEMENT SIMULÉ — le clic de l'opérateur. */}
          <ChoixPointLibre
            actif={placementSimulation !== null}
            onPoint={(lng, lat) => {
              const cible = placementSimulation;
              setPlacementSimulation(null);
              setPropositionOuverte(cible.barrageId);
              optimisationResultats?.decider?.(cible.barrageId, 'deplacer', { lng, lat });
            }}
          />

          {/* Carte de risque — voir HeatmapLayer.jsx et la case à cocher du panneau Analyse. */}
          {heatmapOn && <HeatmapLayer items={items} />}

          {/* Point noir en cours de qualification : provisoire tant que non confirmé */}
          <PositionProvisoireLayer position={pointNoirPosition} onDeplacer={setPointNoirPosition} />

          {/* Toute autre nature en attente de confirmation — même principe. */}
          <PositionProvisoireLayer
            position={posePosition?.lngLat ?? null}
            onDeplacer={deplacerPose}
            type={posePosition?.type}
          />

          {/* Itinéraire mesuré : au-dessus des couches, sous la brume */}
          {(itineraire || jalons.some(Boolean)) && (
            <ItineraireLayer resultat={itineraire ?? null} jalons={jalons} />
          )}

          {/* Brume en dernier : elle doit recouvrir tout ce qui précède.
            Priorité, du plus ponctuel au plus permanent :
              aperçu de région (pose d'un point noir)
              > zone choisie dans Filtrer ou Optimisation
              > contour cliqué sur la carte
              > périmètre de la session connectée.
            Un chef de région ou de compagnie ne doit voir nettement que sa
            propre zone — les autres circonscriptions restent visibles mais
            assombries, jamais retirées de la carte (le contexte reste lisible,
            pas l'autorité).

            `cle` DOIT suivre le même ordre que `geometry` : c'est elle qui
            force le redessin. Les deux chaînes désynchronisées, la brume
            garderait la forme précédente en changeant de zone. */}
          <Brume
            geometry={(regionApercu ?? zoneFocus ?? selection ?? perimetre)?.geometry}
            cle={
              regionApercu
                ? `apercu|${regionApercu.nom}`
                : zoneFocus
                  ? `focus|${zoneFocus.nom}`
                  : selection
                    ? `${selection.couche}|${selection.nom}`
                    : perimetre
                      ? `perimetre|${session.rang}|${session.unite}`
                      : 'aucune'
            }
          />

          {/* MODE DÉPLACEMENT : le clic désigne la nouvelle position. Un second
            clic en propose une autre — rien n'est envoyé avant « Enregistrer ». */}
          <ChoixPointCarte
            actif={armeDeplacement !== null && !deplacementEnCours}
            onPoint={(lng, lat) =>
              setDemandeDeplacement({ id: armeDeplacement, clic: { lng, lat }, ts: Date.now() })
            }
          />
          {demandeDeplacement?.point && barrageEnDeplacement && (
            <Polyline
              positions={
                demandeDeplacement.trace && demandeDeplacement.trace.length > 1
                  ? demandeDeplacement.trace.map(([lng, lat]) => [lat, lng])
                  : [
                    [barrageEnDeplacement.lat, barrageEnDeplacement.lng],
                    [demandeDeplacement.point.lat, demandeDeplacement.point.lng],
                  ]
              }
              pathOptions={{ color: '#D6A928', weight: 4, dashArray: '6 6', opacity: 0.95 }}
              interactive={false}
              pane={PANE_SELECTION}
            />
          )}

          {/* LES POSTES DE LA DERNIÈRE RÉÉVALUATION — rouge : encore en conflit ;
              vert : résolu ; doré : le poste déplacé. */}
          {reevaluation && !barrageEnDeplacement && [
            [reevaluation.barrageId, '#D6A928'],
            ...[...reevaluation.restants, ...reevaluation.nouveaux].map((l) => [l.autreId, '#DC2626']),
            ...reevaluation.resolus.map((l) => [l.autreId, '#16A34A']),
          ].map(([id, couleur]) => {
            const m = items.find((x) => x.id === id);
            return m && Number.isFinite(m.lat) ? (
              <CircleMarker
                key={`reev-${id}-${reevaluation.ts}`}
                center={[m.lat, m.lng]}
                radius={16}
                interactive={false}
                pathOptions={{ color: couleur, weight: 3, fillColor: couleur, fillOpacity: 0.12, dashArray: '4 3' }}
              />
            ) : null;
          })}

          {/* SÉLECTION DE POSITION — repère de la position actuelle, les deux
              chaussées s'il y en a deux, et le marqueur temporaire. */}
          {barrageEnDeplacement && Number.isFinite(barrageEnDeplacement.lat) && (
            <CircleMarker
              center={[barrageEnDeplacement.lat, barrageEnDeplacement.lng]}
              radius={7}
              pane={PANE_SELECTION}
              interactive={false}
              pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#64748b', fillOpacity: 0.9, dashArray: '3 3' }}
            >
              <Tooltip direction="top" offset={[0, -8]} permanent pane={PANE_SELECTION}>Position actuelle</Tooltip>
            </CircleMarker>
          )}
          {demandeDeplacement?.sens &&
            [['aller', SENS_ALLER, 'Aller', '#0284c7'], ['retour', SENS_RETOUR, 'Retour', '#ea580c']].map(([cle, valeur, libelle, couleur]) => {
              const choisi = demandeDeplacement.sensChoisi === valeur;
              return (
                <Polyline
                  key={`sens-${cle}-${demandeDeplacement.ts}`}
                  positions={demandeDeplacement.sens[cle].trace.map(([lng, lat]) => [lat, lng])}
                  pane={PANE_SELECTION}
                  pathOptions={{ color: couleur, weight: choisi ? 10 : 7, opacity: choisi || !demandeDeplacement.sensChoisi ? 0.95 : 0.35, lineCap: 'round' }}
                  eventHandlers={{
                    click: (e) => {
                      L.DomEvent.stopPropagation(e);
                      choisirSensDeplacement(valeur);
                    },
                  }}
                >
                  <Tooltip permanent direction={cle === 'aller' ? 'left' : 'right'} offset={[cle === 'aller' ? -12 : 12, 0]} pane={PANE_SELECTION}>{libelle}</Tooltip>
                </Polyline>
              );
            })}
          {(demandeDeplacement?.point || demandeDeplacement?.clic) && barrageEnDeplacement && (
            <CircleMarker
              center={[
                (demandeDeplacement.point ?? demandeDeplacement.clic).lat,
                (demandeDeplacement.point ?? demandeDeplacement.clic).lng,
              ]}
              radius={9}
              pane={PANE_SELECTION}
              interactive={false}
              pathOptions={{ color: '#0B1B2D', weight: 3, fillColor: '#D6A928', fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -10]} permanent pane={PANE_SELECTION}>Nouvelle position</Tooltip>
            </CircleMarker>
          )}

          {/* Tracé de la route réelle du conflit détecté lors du déplacement */}
          {demandeDeplacement?.conflitNouveau?.trace && demandeDeplacement.conflitNouveau.trace.length > 1 && (
            <LayerGroup>
              <Polyline
                positions={demandeDeplacement.conflitNouveau.trace.map(([lng, lat]) => [lat, lng])}
                pathOptions={{ color: '#0B1B2D', weight: 8, opacity: 0.75 }}
                interactive={false}
                pane={PANE_SELECTION}
              />
              <Polyline
                positions={demandeDeplacement.conflitNouveau.trace.map(([lng, lat]) => [lat, lng])}
                pathOptions={{ color: '#EF4444', weight: 4.5, dashArray: '8, 8', opacity: 0.95 }}
                pane={PANE_SELECTION}
              >
                <Tooltip sticky pane={PANE_SELECTION}>
                  {`⚠ Conflit par la route : ${demandeDeplacement.conflitNouveau.distanceKm} km (seuil ${demandeDeplacement.conflitNouveau.seuilKm} km) ↔ ${demandeDeplacement.conflitNouveau.voisinNom}`}
                </Tooltip>
              </Polyline>
            </LayerGroup>
          )}

          {/* Tracé des conflits calculés sur la route filtrée */}
          {/* Tracé de tous les conflits calculés sur la route filtrée */}
          {filtreRoute && conflitsCalculesRoute && conflitsCalculesRoute.length > 0 && (
            <LayerGroup>
              {conflitsCalculesRoute.map((conf) => {
                const estVise = Boolean(
                  (conflitVise && (conflitVise.id === conf.id || conflitVise.paireCle === conf.paireCle)) ||
                  (conflitViseLateral && (conflitViseLateral.id === conf.id || conflitViseLateral.paireCle === conf.paireCle))
                );
                const toLeaflet = (pt) => {
                  if (!Array.isArray(pt) || pt.length < 2) return null;
                  const c0 = Number(pt[0]);
                  const c1 = Number(pt[1]);
                  if (!Number.isFinite(c0) || !Number.isFinite(c1)) return null;
                  if (c0 < 0 && c1 > 0) return [c1, c0];
                  return [c0, c1];
                };
                const tracePositions =
                  conf.trace && conf.trace.length > 1
                    ? conf.trace.map(toLeaflet).filter(Boolean)
                    : conf.a && conf.b && Number.isFinite(Number(conf.a.lat)) && Number.isFinite(Number(conf.b.lat))
                    ? [
                        [Number(conf.a.lat), Number(conf.a.lng)],
                        [Number(conf.b.lat), Number(conf.b.lng)],
                      ]
                    : null;
                if (!tracePositions || tracePositions.length < 2) return null;

                return (
                  <Fragment key={conf.id}>
                    {/* Liseré sombre */}
                    <Polyline
                      positions={tracePositions}
                      pathOptions={{
                        color: '#0B1B2D',
                        weight: estVise ? 9 : 5,
                        opacity: estVise ? 0.9 : 0.6,
                      }}
                      interactive={false}
                    />
                    {/* Trait pointillé distinctif */}
                    <Polyline
                      positions={tracePositions}
                      pathOptions={{
                        color: estVise ? '#F59E0B' : '#EF4444',
                        weight: estVise ? 5.5 : 3.5,
                        dashArray: estVise ? '8, 8' : '6, 6',
                        opacity: estVise ? 1 : 0.85,
                      }}
                      eventHandlers={{
                        click: (e) => {
                          e.originalEvent.stopPropagation();
                          viserConflit(conf.id);
                          setConflitViseLateral(conf);
                        },
                      }}
                    >
                      <Tooltip sticky>
                        {`⚠ ${conf.numero || 'Conflit'} : ${conf.distanceKm} km (seuil ${conf.seuilKm} km) · ${conf.a?.nom || conf.a?.id} ↔ ${conf.b?.nom || conf.b?.id}`}
                      </Tooltip>
                    </Polyline>
                  </Fragment>
                );
              })}
            </LayerGroup>
          )}

          {/* Tracé d'un conflit assigné (CMND Région / Cie) avec sa route réelle et support AVANT/APRÈS */}
          <ConflitAssigneLayer conflit={conflitAssigneVise} mode={modeComparatifCarte} />

          <ScaleControl position="bottomright" imperial={false} />
          <AttributionControl position="bottomright" prefix={false} />
        </MapContainer>


        {/* L'axe isolé (route, barrages, conflits, sens, Modifier, Désactiver) est
            dans le menu des conflits — plus de barre flottante sur la carte. */}

        {conflitAnalysePreTraitement && (
          <ConflitAnalysePanel
            barrage={conflitAnalysePreTraitement.barrage}
            seuilInitial={20}
            onFermer={() => setConflitAnalysePreTraitement(null)}
            actionLibelle="Procéder au traitement (Changer la faction)"
            onVoirSurCarte={afficherConflitSurCarte}
            onConfirmerTraitement={() => {
              const { assignation: a, recharger } = conflitAnalysePreTraitement;
              setTraitementAssignation({ a, recharger });
              setConflitAnalysePreTraitement(null);
            }}
          />
        )}
        {traitementAssignation && (
          <ChangerFaction
            barrage={{ id: traitementAssignation.a.barrageId, nom: traitementAssignation.a.barrage?.nom }}
            factions={factions}
            onFermer={() => setTraitementAssignation(null)}
            onConfirmer={async (factionId) => {
              const { a, recharger } = traitementAssignation;
              const r = await API.traiterAssignation(a.id, { factionId });
              if (Array.isArray(r.items)) setItems(r.items);
              else if (r.item) setItems((prev) => prev.map((x) => (x.id === r.item.id ? r.item : x)));
              recharger?.();
              signalerTraitement(a.barrageId);
              setMessageEdition({ ok: true, texte: `${a.barrage?.nom ?? 'Barrage'} : traité — ${r.assignation?.reponse ?? ''}` });
              setTraitementAssignation(null);
            }}
          />
        )}
        {assignation && (
          <AssignerRegion barrages={assignation} onConfirmer={confirmerAssignation} onFermer={() => setAssignation(null)} />
        )}
        {factionBarrage && (
          <ChangerFaction
            barrage={factionBarrage}
            factions={factions}
            onConfirmer={confirmerChangementFaction}
            onFermer={() => setFactionBarrage(null)}
          />
        )}

        {/* Barre flottante interactive AVANT / APRÈS / COMPARER pour un conflit traité */}
        {conflitAssigneVise && (conflitAssigneVise.changement || conflitAssigneVise.estTraite) && (() => {
          /* Jamais sous le menu des conflits : à sa droite, et s'il ne reste pas
             la place d'une barre lisible (petit écran), en bas de la carte. */
          const gauche = Math.max(panneauOuvert ? 420 : 64, bordMenuConflits != null ? bordMenuConflits + 16 : 0);
          const enBas = bordMenuConflits != null && window.innerWidth - gauche - 16 < 440;
          return (
          <div
            className={`pointer-events-none absolute inset-x-0 z-[1051] flex justify-center px-4 transition-all duration-150 ${enBas ? 'bottom-12' : 'top-28'}`}
            style={enBas ? undefined : { paddingLeft: gauche, paddingRight: 16 }}
          >
            <BarreComparatifAvantApresCarte
              conflit={conflitAssigneVise}
              mode={modeComparatifCarte}
              onChangerMode={changerModeComparatifCarte}
              onRecadrer={() => changerModeComparatifCarte(modeComparatifCarte)}
              onFermer={() => setConflitAssigneVise(null)}
            />
          </div>
          );
        })()}

        {/* Panneau latéral unique et centralisé pour les conflits */}
        <PanneauConflitsLateral
          ouvert={panneauConflitsOuvert}
          onFermer={() => setPanneauConflitsOuvert(false)}
          ancreRef={boutonConflitsRef}
          onBordDroit={setBordMenuConflits}
          demandeListe={demandeListeConflits}
          demandeDetail={demandeDetailConflit}
          derniereAssignation={derniereAssignation}
          session={session}
          factions={factions}
          conflitsIdentifies={conflitsIdentifies}
          conflitVise={conflitViseLateral}
          version={versionConflits}
          onVoirSurCarte={afficherConflitSurCarte}
          onAssigner={demanderAssignationConflit}
          onDesassigner={handleDesassignerConflit}
          onTransmettre={(c) => setConflitATransmettre(c)}
          onTraiter={(c) => {
            /* La carte se cadre sur le conflit (sans rien ouvrir d'autre), et la
               fenêtre de traitement s'ouvre une seule fois. */
            afficherConflitSurCarte(c, null, { detail: false });
            setConflitATraiter(c);
          }}
          onConflitSupprime={handleConflitSupprime}
          onBarragesModifies={(barrages) => {
            if (Array.isArray(barrages) && barrages.length > 0) {
              setItems((prev) => {
                const mapMaj = new Map(barrages.map((b) => [b.id, b]));
                return prev.map((x) => mapMaj.get(x.id) || x);
              });
            }
            API.listerMarquages().then(setItems).catch(() => {});
            chargerRepositionnementsRef.current?.();
          }}
          filtreRoute={filtreRoute}
          onFiltrerRoute={handleFiltrerRoute}
          routesDisponibles={routesDisponibles}
          barragesVisiblesCount={barragesVisiblesCount}
          barrages={items}
          graphe={graphe}
          onOuvrirFiltreRoute={() => setModalFiltreRouteOuverte(true)}
          conflitsCalculesRoute={conflitsCalculesRoute}
          parametresRoute={parametresFiltreRoute}
          filtreSensRoute={filtreSensRoute}
          onChangerSensRoute={setFiltreSensRoute}
          onEffacerFiltreRoute={handleEffacerFiltreRouteComplet}
        />

        {/* Modale centrée de configuration du filtrage par route */}
        <ModalFiltrerParRoute
          open={modalFiltreRouteOuverte}
          onClose={() => setModalFiltreRouteOuverte(false)}
          routesDisponibles={routesDisponibles}
          barrages={items}
          initialRoute={parametresFiltreRoute.route}
          initialDistance={parametresFiltreRoute.distance}
          initialSens={filtreSensRoute || parametresFiltreRoute.sens}
          filtreActif={filtreRoute}
          onCalculer={lancerAnalyseRoute}
          calculEnCours={analyseAxe?.etat === 'scan'}
          onEffacer={handleEffacerFiltreRouteComplet}
        />

        {/* Modale d'assignation d'un conflit au CMD_REGION (Superadmin) */}
        {conflitAAssigner && (
          <ModalAssignerConflit
            conflit={conflitAAssigner.conflits ? null : conflitAAssigner}
            conflits={conflitAAssigner.conflits || null}
            session={session}
            onClose={() => setConflitAAssigner(null)}
            onConfirmer={confirmerAssignationConflit}
            /* À côté du menu des conflits (qui reste ouvert pour passer au suivant), jamais dessus. */
            gauche={panneauConflitsOuvert && bordMenuConflits != null ? Math.max(12, Math.min(bordMenuConflits + 12, window.innerWidth - 352)) : 12}
          />
        )}

        {/* Modale de transmission d'un conflit au CMD_COMPAGNIE (CMD_REGION) */}
        {conflitATransmettre && (
          <ModalTransmettreCie
            conflit={conflitATransmettre}
            session={session}
            onClose={() => setConflitATransmettre(null)}
            onFermer={() => setConflitATransmettre(null)}
            onConfirmer={confirmerTransmissionConflit}
          />
        )}

        {/* Modale unique de traitement d'un conflit (Superadmin / CMD_REGION / CMD_COMPAGNIE) */}
        {conflitATraiter && (
          <ModalTraiterConflit
            conflit={conflitATraiter}
            session={session}
            factions={factions}
            barrages={items}
            onClose={() => setConflitATraiter(null)}
            onFermer={() => setConflitATraiter(null)}
            onConfirmer={confirmerTraitementConflit}
            onDemarrerDeplacement={(barrage, conf) => {
              setConflitEnTraitement(conf);
              setConflitATraiter(null);
              demarrerDeplacement(barrage, {
                conflitInterRegionBfi: Boolean(
                  conf?.conflitInterRegionBfi ||
                  (MQ.estIntouchable(conf?.a || conf?.barrageA) && MQ.estIntouchable(conf?.b || conf?.barrageB))
                ),
                autoriserBfi: true,
              });
            }}
            onSupprimerBarrage={async (barrage, conf, justification = '') => {
              try {
                await supprimerMq(barrage.id);
                await confirmerTraitementConflit({
                  conflitId: conf.id,
                  action: 'suppression_barrage',
                  details: {
                    barrageId: barrage.id,
                    statut: 'resolu',
                    resolu: true,
                    commentaire: justification || `Barrage ${barrage.nom || barrage.id} supprimé pour résoudre le conflit ${conf.numero || conf.id}.`,
                    conflitData: conf,
                  },
                });
                setConflitATraiter(null);
                setVersionConflits((v) => v + 1);
              } catch (err) {
                alert(err.message || 'Impossible de supprimer le barrage.');
              }
            }}
          />
        )}

        {/* Modale d'optimisation / filtration par route */}
        <OptimisationRoutePanel
          ref={routePanelRef}
          open={false}
          onClose={() => setOptimisationRouteOpen(false)}
          factions={factions}
          onVue={setVueRoute}
          onStatut={setStatutRoute}
          items={items}
          onAssigner={superviseur ? demanderAssignation : null}
          onAssignerConflit={demanderAssignationConflit}
          estAdmin={session?.rang === 'admin'}
          session={session}
        />

        {/* FILTRES — un seul bouton sur le côté de la carte, et à côté, l'accès
            aux conflits pour le commandement. */}
        <MenuFiltresUnifie
          ouvert={menuFiltresOuvert}
          onOuvrir={ouvrirFiltres}
          onFermer={() => setMenuFiltresOuvert(false)}
          decalageGauche={ancreOutils?.gauche ?? bordGauche}
          haut={ancreOutils?.haut ?? null}
          afficherBouton={false}
          couches={COUCHES_FILTRES}
          routesVisibles={routesVisibles}
          onToggleRoutes={basculerRoutes}
          layers={MARQUAGE_LAYERS}
          activeLayers={active}
          onToggleLayer={toggleLayer}
          factions={factions?.factions}
          factionChoisie={factionChoisie ?? 'toutes'}
          onChangerFaction={gererChangementFaction}
          factionActuelle={factions?.factionActuelle}
          compteursFactions={factions?.compteurs}
          filtreEclairage={filtreEclairageBarrages}
          onChangerEclairage={setFiltreEclairageBarrages}
          filtreAccidents={filtreAccidentsBarrages}
          onChangerAccidents={setFiltreAccidentsBarrages}
          totalBarrages={items.filter(MQ.estBarrage).length}
          filtresModifies={filtresModifies}
          onReinitialiser={reinitialiserAffichage}
        />

        {/* OPTIMISATION DES BARRAGES — module à part : ouvert depuis le menu
            « Outils », ni son état ni ses calculs ne dépendent des filtres. */}
        <MenuOptimisation
          ouvert={menuOptimisationOuvert}
          onFermer={() => setMenuOptimisationOuvert(false)}
          decalageGauche={ancreOutils?.gauche ?? bordGauche}
          haut={ancreOutils?.haut ?? null}
          onglets={ongletsOptimisationComplets}
          onOuvrirOnglet={(cle) => {
            setMenuOptimisationOuvert(false);
            gererOuvertureOnglet(cle);
          }}
          onDesactiverOnglet={gererDesactivationOnglet}
          onOuvrirPanneauComplet={() => {
            setMenuOptimisationOuvert(false);
            ouvrirPanneau('optimisation');
          }}
        />

        {/* Retours brefs (succès, erreur, étapes du workflow) — voir Toasts.jsx. */}
        <Toasts />

        {/* « Nouveau conflit détecté » : une seule carte, dans le coin. */}
        <GardeErreur nom="analyse-conflits" silencieux>
          <IndicateurDetection etat={radarAffiche ? null : etatDetection} />
        </GardeErreur>
        {/* Analyse d'un axe : radar pendant le calcul réel, puis son résultat. */}
        <GardeErreur nom="radar-analyse" silencieux cle={radarAffiche?.libelle}>
          <RadarAnalyse radar={radarAffiche} decalageDroit={0} />
        </GardeErreur>
        <GardeErreur nom="resultat-analyse" silencieux cle={analyseAxe}>
          {/* Menu des conflits ouvert : il liste déjà tous les conflits détectés —
              seule une ERREUR de calcul (« Réessayer ») reste affichée, à côté. */}
          <CarteResultatAnalyse
            analyse={analyseAxe?.etat === 'erreur' || (analyseAxe?.etat === 'aucun' && !panneauConflitsOuvert) ? analyseAxe : null}
            gauche={panneauConflitsOuvert && bordMenuConflits != null ? bordMenuConflits + 16 : 88}
            onVoir={voirResultatCalcul}
            onFermer={fermerResultatAnalyse}
            onReessayer={reessayerAnalyse}
          />
        </GardeErreur>
        <GardeErreur nom="alerte-conflit" silencieux>
          <CarteNouveauConflit
            conflits={alerteConflits.conflits}
            version={alerteConflits.version}
            onVoir={voirConflitDetecte}
            onVoirListe={() => setPanneauConflitsOuvert(true)}
            onFermer={fermerAlerteConflits}
            decalageDroit={12}
          />
        </GardeErreur>

        {/* Sortie du mode focus : le seul bouton qui reste, en haut à droite. */}
        {modeFocus && (
          <button
            type="button"
            onClick={() => setModeFocus(false)}
            aria-label="Quitter le mode focus (Échap)"
            title="Quitter le mode focus (Échap)"
            className="absolute right-3 z-[1300] flex items-center gap-2 rounded-xl border border-border-default bg-gr-navy/95 px-3 py-2 text-[12px] font-semibold text-text-primary shadow-panel backdrop-blur-md transition-colors hover:bg-gr-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
            style={{ top: 'calc(0.75rem + var(--gr-bandeau, 0px))' }}
          >
            <IconFocusQuitter size={16} />
            Quitter le focus
          </button>
        )}

        {/**
       * LE COIN BAS-GAUCHE — UNE SEULE COLONNE, empilée vers le haut.
       *
       * Ces trois encarts se positionnaient chacun de son côté, avec des
       * décalages écrits à la main (« si la carte de risque est là, monte de
       * 13,5 rem »). À deux c'était déjà fragile ; à trois, intenable. Ils sont
       * désormais des enfants ordinaires d'une colonne ancrée en bas : chacun
       * pousse les autres vers le haut, sans qu'aucun ne sache que les autres
       * existent.
       *
       * L'ordre du DOM est l'ordre à l'écran, de haut en bas — le résumé chiffré
       * reste donc au plus près du coin, là où on l'a pris l'habitude de lire.
       *
       * LE RÉSUMÉ N'APPARTIENT QU'À L'OPTIMISATION : affiché en permanence, il
       * commentait une carte qu'on regardait pour tout autre chose. Il se montre
       * quand le panneau est ouvert, et tant qu'un résultat est posé sur la
       * carte — replier le panneau ne doit pas faire disparaître le décompte des
       * repères qu'on examine.
       */}
        {/* `false` seulement : `null` veut dire « on ne sait pas encore », et un
          avertissement affiché pendant le premier chargement serait un
          mensonge d'une demi-seconde. */}
        {messageEdition && <MessageFlottant>{messageEdition.texte}</MessageFlottant>}
        {editionBarrage && (
          <ModifierBarrage
            key={editionBarrage.id}
            barrage={editionBarrage}
            onDeplacer={() => {
              const m = editionBarrage;
              fermerEdition();
              demarrerDeplacement(m);
            }}
            onFermer={fermerEdition}
            onEnregistre={apresModificationBarrage}
            onFicheComplete={() => {
              const id = editionBarrage.id;
              fermerEdition();
              setMqSelection(id);
              ouvrirPanneau('saisie');
            }}
          />
        )}

        {/* RÉÉVALUATION APRÈS DÉPLACEMENT — position valide, conflits restants ou
            nouveaux, et le poste à déplacer ensuite (voir CarteReevaluation). */}
        {reevaluation && !barrageEnDeplacement && (
          <CarteReevaluation
            bilan={reevaluation}
            onFermer={() => setReevaluation(null)}
            onVoirConflits={commandement ? () => {
              setPanneauConflitsOuvert(true);
              setDemandeListeConflits((n) => n + 1);
            } : null}
            onDeplacer={(id) => {
              const m = items.find((x) => x.id === id);
              if (m) demarrerDeplacement(m);
              else setMessageEdition({ ok: false, texte: 'Ce barrage n’est pas dans votre périmètre affiché : déplacement impossible d’ici.' });
            }}
          />
        )}

        {/* Déplacement : consigne, puis aperçu — voir ConfirmationDeplacement. */}
        {barrageEnDeplacement && (
          <ConfirmationDeplacement
            m={barrageEnDeplacement}
            demande={demandeDeplacement}
            chargementReseau={grapheEtat === 'chargement'}
            occupe={deplacementEnCours}
            onChoisirSens={choisirSensDeplacement}
            onAnnuler={() => {
              /* Rien à défaire côté serveur : rien n'y a été envoyé. Le repère
                 revient de lui-même, la position proposée disparaissant. */
              annulerDeplacement();
              setConflitEnTraitement(null);
              setMessageEdition({ ok: true, texte: 'Déplacement annulé : le barrage est resté à sa place.' });
            }}
            onConfirmer={async () => {
              const d = demandeDeplacement;
              if (!d?.point || d.erreur) return;
              setDeplacementEnCours(true);
              try {
                const depDetails = {
                  id: barrageEnDeplacement.id,
                  nom: barrageEnDeplacement.nom,
                  latAvant: barrageEnDeplacement.lat,
                  lngAvant: barrageEnDeplacement.lng,
                  routeAvant: barrageEnDeplacement.route,
                  latApres: d.point.lat,
                  lngApres: d.point.lng,
                  routeApres: d.route,
                };
                const estInterRegionBfi = Boolean(
                  conflitEnTraitement && (
                    conflitEnTraitement.conflitInterRegionBfi ||
                    (MQ.estIntouchable(conflitEnTraitement.a || conflitEnTraitement.barrageA) &&
                     MQ.estIntouchable(conflitEnTraitement.b || conflitEnTraitement.barrageB))
                  )
                );
                const deplace = await deplacer(barrageEnDeplacement, [d.point.lng, d.point.lat], d.route ?? '', {
                  conflitInterRegionBfi: estInterRegionBfi,
                  autoriserBfi: estInterRegionBfi,
                  /* Le sens choisi sur une route à deux chaussées, enregistré avec
                     la position (les deux champs : le dépôt relit l'un ou l'autre). */
                  ...(d.sensChoisi ? { direction: d.sensChoisi, sens: d.sensChoisi } : {}),
                  ...(d.seuilKm ? { seuilKm: d.seuilKm } : {}),
                });
                /* Conflit en cours de traitement : le déplacement ENREGISTRÉ est son
                   traitement — enregistré d'office, sans bandeau à valider. Un
                   déplacement refusé ou en échec n'enregistre rien. */
                /* Le traitement n'est enregistré que si la réévaluation du serveur ne
                   laisse pas CE conflit sous le seuil ; sinon la carte de
                   réévaluation guide vers la position suivante. */
                const paireTraitee = conflitEnTraitement
                  ? [conflitEnTraitement.barrageAId || conflitEnTraitement.a?.id, conflitEnTraitement.barrageBId || conflitEnTraitement.b?.id]
                  : [];
                const toujoursEnConflit = Boolean(deplace?.reevaluation?.restants?.some((l) => paireTraitee.includes(l.autreId)));
                if (conflitEnTraitement && deplace && !toujoursEnConflit) {
                  const conf = conflitEnTraitement;
                  const coord = (v) => (Number.isFinite(v) ? v.toFixed(4) : v);
                  try {
                    await confirmerTraitementConflit({
                      conflitId: conf.id,
                      action: 'deplacement',
                      details: {
                        barrageId: depDetails.id,
                        barrageNom: depDetails.nom,
                        latAvant: depDetails.latAvant,
                        lngAvant: depDetails.lngAvant,
                        routeAvant: depDetails.routeAvant,
                        latApres: depDetails.latApres,
                        lngApres: depDetails.lngApres,
                        routeApres: depDetails.routeApres,
                        /* Distance au plus proche voisin, mesurée à la nouvelle position. */
                        distanceApresKm: d.plusProcheAutre?.dist ?? conf.seuilKm ?? 20,
                        seuilKm: conf.seuilKm ?? 20,
                        statut: 'resolu',
                        resolu: true,
                        commentaire: `Barrage ${depDetails.nom || depDetails.id} déplacé de [${coord(depDetails.lngAvant)}, ${coord(depDetails.latAvant)}] vers [${coord(depDetails.lngApres)}, ${coord(depDetails.latApres)}] sur ${depDetails.routeApres || 'la route'}.`,
                      },
                    });
                  } catch (err) {
                    setMessageEdition({ ok: false, texte: `Barrage déplacé, mais le traitement du conflit n'a pas pu être enregistré : ${err?.message ?? 'erreur'}` });
                  }
                }
                setConflitEnTraitement(null);
              } finally {
                setDeplacementEnCours(false);
                annulerDeplacement();
              }
            }}
          />
        )}

        {(sondeOk === false || tilesOk === false) && (
          <FondInjoignable
            url={ARCHIVE_FOND}
            coupe={fondCoupe}
            onReessayer={reessayerFond}
            decalageGauche={bordGauche}
          />
        )}

        {/**
       * LA LÉGENDE, UNE FOIS DÉPLACÉE.
       *
       * Elle quitte la colonne pour un hôte à elle, positionné à la main. Le
       * `zoom` est le même que celui des autres cartouches, et les coordonnées
       * sont exprimées dans CE repère : c'est ce qui permet de calculer un
       * déplacement en divisant le trajet du pointeur par l'échelle, sans quoi
       * le cartouche dériverait du doigt dès que l'interface n'est pas à 100 %.
       *
       * Au-dessus de la colonne (z 1051 contre 1050) : posée sur un autre
       * cartouche, c'est elle qu'on vient de saisir, donc elle qui passe devant.
       */}
        {posLegende && legendeOuverte && (
          <div
            data-gr-chrome
            className="pointer-events-none absolute z-[1051] w-[228px] max-w-[calc(100vw-1.5rem)]"
            style={{ zoom: echelleUI, left: posLegende.x, top: posLegende.y }}
          >
            <LegendeCarte
              position={posLegende}
              echelle={echelleUI}
              onDeplacer={deplacerLegende}
              onRanger={rangerLegende}
              ouvert={legendeOuverte}
              onOuvertChange={changerLegende}
            />
          </div>
        )}

        {/**
       * DEUX COLONNES, chacune empilée de haut en bas.
       *
       *   Gauche — le terrain : Saisie, Distances, Filtrer.
       *   Droite — la décision : Optimisation, Analyse, Administration.
       *
       * Empilées verticalement plutôt qu'alignées horizontalement : une rangée
       * de boutons se lit de gauche à droite en balayant l'écran, une colonne
       * se lit d'un seul coup d'œil. Et les panneaux ouverts laissent le
       * centre de la carte dégagé au lieu de la traverser.
       *
       * `overflow-y-auto` sur chaque colonne : deux panneaux ouverts dans la
       * même colonne dépassent la hauteur d'écran, la colonne défile plutôt
       * que de rogner le second.
       */}
        {/* ---------- STATISTIQUES & LÉGENDE : En bas à gauche (sous les panneaux ouverts) ---------- */}
        <div
          data-gr-chrome
          /**
           * DÉCALÉE DE LA COLONNE DE NAVIGATION, comme tout ce qui se range à
           * gauche.
           *
           * Cette colonne était ancrée à `left-3`, c'est-à-dire exactement sous
           * le rail (`left-3`, largeur 60 px) : la légende passait derrière lui
           * et son libellé s'affichait tronqué — « ÉGENDE ». Les deux autres
           * colonnes de gauche prenaient `left-[76px]` (12 px de marge +
           * 60 px de rail + 4 px de jour). Le rail permanent a laissé place à
           * un volet masqué par défaut : les trois colonnes sont revenues à
           * `left-3`, la marge seule.
           *
           * `max-w` suit le même décalage, sinon la colonne déborderait à droite
           * de ce qu'elle gagne à gauche sur un écran étroit.
           */
          className="pointer-events-none absolute bottom-3 left-3 z-[900] flex w-[228px] max-w-[calc(100vw-1.5rem)] flex-col gap-2"
          style={{ zoom: echelleUI }}
        >
          {/**
         * LES STATISTIQUES N'APPARAISSENT QU'AVEC LE PANNEAU OPTIMISATION.
         *
         * Elles comptent ce que couvre le périmètre choisi pour un calcul :
         * hors de ce contexte, elles commentent une carte qu'on regarde pour
         * tout autre chose. Un remaniement de la mise en page avait laissé
         * tomber la condition, et le cartouche s'affichait en permanence.
         *
         * Sur l'ouverture du panneau, et pas sur la présence d'un résultat :
         * refermer le panneau, c'est passer à autre chose.
         */}
          {optimisationOpen && <StatistiquesCarte stats={statsCarte} />}
          {heatmapOn && <LegendeRisque onFermer={() => setHeatmapOn(false)} />}

          {/**
          * LA LÉGENDE À SA PLACE — celle qu'elle n'avait plus.
          *
          * Le cartouche n'était rendu QUE déplacé (`posLegende && …` plus
          * haut). Or on ne peut le déplacer qu'en le saisissant, et il n'y
          * avait rien à saisir : au premier usage, et après tout « remettre
          * à sa place », la légende disparaissait pour de bon. Le bouton
          * « Légende » du rail basculait alors un état que rien n'affichait.
          *
          * Les deux rendus s'excluent : un seul cartouche à la fois, sinon
          * le déplacement en laisserait un fantôme dans la colonne.
          */}
          {!posLegende && legendeOuverte && (
            <LegendeCarte
              echelle={echelleUI}
              onDeplacer={deplacerLegende}
              onRanger={rangerLegende}
              ouvert={legendeOuverte}
              onOuvertChange={changerLegende}
            />
          )}
        </div>

        {/* ---------- Panneaux OUVERTS : à côté des boutons, pleine hauteur ---------- */}
        <div
          data-gr-chrome
          data-gr-masque-selection className="gr-haut pointer-events-none absolute bottom-3 left-3 z-[1200] flex items-start gap-3 overflow-x-auto overflow-y-hidden overscroll-contain"
          style={{ zoom: echelleUI }}
        >
          <SidePanel
            open={couchesOpen}
            onClose={() => fermerPanneau('couches')}
            active={active}
            counts={counts}
            status={store}
            tilesOk={tilesOk}
            proximityCounts={Object.fromEntries(
              PROXIMITY_LAYERS.map((c) => [c.key, proximite[c.key]?.paires.length ?? null]),
            )}
            echelonLimites={LIBELLE_ECHELON[echelonTerritorial]}
            onToggleLayer={toggleLayer}
            session={session}
            echelleUI={echelleUI}
            onChangerEchelle={changerEchelle}
            routesVisibles={routesVisibles}
            couleursRoutes={COULEURS_ROUTES}
            onToggleRoutes={basculerRoutes}
          />

          <MarquagePanel
            open={mqOpen}
            onOpen={() => ouvrirPanneau('saisie')}
            onClose={() => {
              fermerPanneau('saisie');
              setArme(null); // fermer le panneau désarme : plus de pose involontaire
            }}
            session={session}
            service={service}
            unites={unitesApi}
            occupe={occupe}
            onConnexion={null}
            onDeconnexion={deconnexion}
            items={mesMarquages}
            total={items.length}
            arme={arme}
            onArmer={setArme}
            selection={mqSelection}
            onSelectionner={setMqSelection}
            onModifier={modifierMq}
            onSupprimer={supprimerMq}
            onCadrer={cadrerMq}
            /**
             * SAISIE TERRAIN — désigner un poste par son seul identifiant.
             *
             * Par l'identifiant et non par l'objet du roster : ce dernier est un
             * instantané reçu du serveur, tandis que `items` est ce que la carte
             * affiche à l'instant. Un poste déplacé entre-temps serait signalé
             * au mauvais endroit.
             *
             * `persistant` : un poste choisi pour y travailler reste marqué
             * pendant qu'on y travaille — c'est le sujet, pas un coup d'œil.
             */
            onViserBarrage={(id) => viserBarrage(id, { persistant: true })}
            brigadeDemandee={brigadeDemandee}
            onVue3D={(item) => setModal3DItem(item)}
            onExporter={exporterMq}
            onImporter={importerMq}
            message={mqMessage}
            importants={importants}
            onGenererBarrageManuel={genererBarrageManuel}
            generationEnCours={generationEnCours}
            demandeTache={demandeTache}
          />

          <DistancePanel
            open={distOpen}
            onOpen={() => ouvrirPanneau('distances')}
            onClose={() => {
              fermerPanneau('distances');
              setEnAttente(null); // fermer désarme : plus de jalon posé par surprise
            }}
            etat={grapheEtat}
            message={grapheMessage}
            critere={critere}
            onCritere={setCritere}
            jalons={jalons}
            enAttente={enAttente}
            onAttendre={(idx) => {
              setEnAttente(idx);
              setArme(null); // les deux outils ne s'arment pas en même temps
            }}
            onAjouterJalon={ajouterJalon}
            onSupprimerJalon={supprimerJalon}
            resultat={itineraire ?? null}
            onEffacer={effacerTrajet}
            analyseRoute={analyseRoute}
            itineraireAlternatif={itineraireAlternatif}
            onLocaliserMarquage={(m) => {
              cadrerMq(m);
              setModal3DItem(m);
            }}
          />
        </div>

        {/* ---------- Panneaux de décision : à GAUCHE de leurs boutons ---------- */}
        <div
          data-gr-masque-selection className="gr-haut pointer-events-none absolute bottom-3 left-3 z-[1200] flex items-start gap-3 overflow-x-auto overflow-y-hidden overscroll-contain"
          style={{ zoom: echelleUI }}
        >
          {/* Optimisation : les barrages FIXES trop proches de leur voisin — voir
            OptimisationPanel.jsx, et `distancesPlusProche` côté serveur, seule
            fonction de distance du projet. Ce commentaire citait encore
            `consoliderParVoisinage`, l'ancien arbitrage pesé par les motifs
            d'implantation : il n'a plus aucun appelant, et laisser son nom ici
            donnait à croire que les critères pèsent encore sur le calcul. */}
          <OptimisationPanel
            open={optimisationOpen}
            onOpen={() => ouvrirPanneau('optimisation')}
            onClose={() => fermerPanneau('optimisation')}
            session={session}
            onAssigner={superviseur ? demanderAssignation : null}
            assignationDe={assignationDe}
            unites={unitesApi}
            /* Sert au seul bouton « Analyser ce résultat » : il n'apparaît que si
               le serveur a un assistant configuré (voir /api/etat). */
            service={service}
            /* Le dépôt vivant : c'est lui qui porte les décisions déjà rendues et
               les postes réellement présents. Le rapport, lui, n'est qu'une
               mesure datée. */
            items={items}
            onItemsChange={setItems}
            dispositifVersion={dispositifVersion}
            onResultatsChange={publierResultatsOptimisation}
            /* Les paires numérotées que la carte dessine : la liste du panneau
               lit les mêmes, et désigne par le même geste. */
            conflitsIdentifies={conflitsIdentifies}
            conflitVise={conflitVise?.id ?? null}
            onViserConflit={viserConflit}
            /* Ce que l'écran montre devient ce que le calcul propose — voir
               `porteeCourante` dans src/marquages.js. */
            porteeCourante={portee}
            factionActuelle={factions?.factionActuelle}
            /* La faction dont les barrages sont optimisés — voir `factionOptimisation`. */
            factionAnalysee={factionOptimisation}
            factions={factions}
            onFactionChange={setFactionOptimisationChoisie}
            distance={distanceOptimisation}
            onDistanceChange={setDistanceOptimisation}
            onDistanceBaseChange={setDistanceBaseOptimisation}
            onOngletsChange={setOngletsOptimisation}
            onEnregistrerOnglets={enregistrerOngletsOptimisation}
            positionChangee={positionChangee}
            presentationVersion={presentationVersion}
            onDemanderPlacement={demanderPlacement}
            onEtatOfficielRestaure={presentationRestauree}
            /* RÉINITIALISER : la carte oublie le poste ou le conflit désigné. */
            onReinitialiser={() => setVise(null)}
            /* Le panneau reste OUVERT au cadrage : c'est un panneau latéral, la
               carte est visible à côté — le refermer ferait perdre la liste
               qu'on est en train de parcourir. */
            onCadrer={cadrerDepuisOptimisation}
            onCadrerResultats={cadrerResultatsOptimisation}
            /* Revenir sur un « Conservé » se fait depuis la liste : sur la carte,
               le poste a repris son repère ordinaire, il n'y a plus de « ? » où
               cliquer. La liste porte les deux gestes — Confirmer, Refuser — et
               passe donc le même arbitre que la bulle de la carte. */
            onDecider={deciderBarrageSignale}
            /* Et la même décision de commandement que la bulle : un retrait
               soumis à ce compte se tranche depuis la liste comme depuis la
               carte, par `deciderNotification` dans les deux cas. */
            notifications={notifications}
            onDeciderDemande={deciderNotification}
            /* Choix d'une région/compagnie/brigade : la carte s'y rend. */
            onCadrerCirconscription={cadrerCirconscription}
          />

          <AnalysisPanel
            open={analysisOpen}
            onOpen={() => ouvrirPanneau('analyse')}
            onClose={() => fermerPanneau('analyse')}
            data={analysis}
            marquages={marquagesAnalysis}
            report={report}
            loading={Object.values(store).some((s) => s.loading)}
            proximite={proximite.proximite_pointages}
            seuilKm={PROXIMITY_KM}
            fiche={fiche}
            ficheCouche={selection?.couche}
            ficheMarquages={ficheMarquages}
            situation={situation}
            brigadeCliquee={brigadeCliquee}
            rosterBrigade={rosterBrigade}
            onQuitterBrigade={() => setSelection(null)}
            /* Cliquer un poste dégarni y mène : même geste que partout ailleurs. */
            onViserBarrage={(id) => viserBarrage(id, { persistant: true })}
            couvertureOperationnelle={couvertureOperationnelle}
            efficaciteBarrages={efficaciteBarrages}
            onOuvrirMarquage={(m) => {
              cadrerMq(m);
              setModal3DItem(m);
            }}
            onClearFiche={clearSelection}
            heatmapOn={heatmapOn}
            onBasculerHeatmap={() => setHeatmapOn((v) => !v)}
            comparaisonPeriodes={comparaisonPeriodes}
            periodeComparaison={periodeComparaison}
            onChangerPeriode={setPeriodeComparaison}
          />

          {/* Administration — les comptes et leurs codes d'accès, et rien
            d'autre. Le volet « Gestion des barrages » qu'il portait a été
            retiré : un barrage se traite sur la carte, devant le terrain
            concerné, pas dans une liste à cocher. */}
          <NotificationsPanel
            open={notificationsOpen}
            onClose={() => fermerPanneau('notifications')}
            session={session}
            notifications={notifications}
            onDecider={deciderNotification}
            onCadrer={(n) => {
              if (n.action === 'assignation' || n.criteres?.distanceKm != null) {
                afficherConflitSurCarte(n);
              } else {
                viserDepuisNotification(n);
              }
            }}
            onTraiterAssignation={(n) => {
              const b = items.find((x) => x.id === (n.barrageId || n.barrage?.id)) || n.barrage;
              if (b) {
                setConflitAnalysePreTraitement({
                  assignation: { id: n.id, barrageId: b.id, barrage: b },
                  recharger: rafraichirNotifications,
                  barrage: b,
                });
              }
            }}
            onTransmettreAssignation={() => {
              ouvrirPanneau('assignations');
            }}
            /**
             * RÉCLAMER UN CHANGEMENT CONFIRMÉ.
             *
             * Aucune écriture sur le barrage : le serveur ouvre un dossier qui
             * pointe la modification (voir POST /api/instructions/:id/reclamation).
             * On rafraîchit donc la seule liste qui change — les notifications.
             */
            onReclamer={async (n, corps) => {
              await API.reclamerModification(n.id, corps);
              rafraichirNotifications();
              setMqMessage({
                ok: true,
                texte: `Réclamation enregistrée sur ${n.barrage?.nom || 'ce poste'} — le changement reste appliqué.`,
              });
            }}
          />

          <AdminPanel
            open={adminOpen}
            onOpen={() => ouvrirPanneau('admin')}
            onClose={() => fermerPanneau('admin')}
            session={session}
            unites={unitesApi}
            onPresentationRestauree={presentationRestauree}
          />

          <HierarchiePanel
            open={organisationOpen}
            onClose={() => fermerPanneau('organisation')}
            /* Descendre dans l'arbre cadre la carte : on voit ce dont on parle. */
            onCadrerCirconscription={cadrerCirconscription}
            /**
             * « Relever l'effectif » depuis une brigade de l'arbre mène à SAISIE
             * TERRAIN, sur cette brigade — le même chemin que le bouton d'une
             * bulle de barrage (voir `brigadeDemandee`). Une seule mécanique pour
             * un même geste, quel que soit l'endroit d'où on le demande.
             */
            onViserBrigade={ouvrirBrigade}
          />
        </div>

        {/* 1. Saisie — avant toute position, tant qu'on n'a pas de données validées. */}
        {arme === 'accident' && !pointNoirSaisie && (
          <PointNoirModal
            onAnnuler={annulerPointNoir}
            onConfirmer={(valeurs) => setPointNoirSaisie(valeurs)}
          />
        )}

        {/* 2/3. Position et confirmation — coordonnées GPS saisissables à la main
          (en plus du clic carte) et toujours affichées avant tout envoi. */}
        {arme === 'accident' && pointNoirSaisie && (
          <PositionPointNoirBarre
            position={pointNoirPosition}
            occupe={occupe}
            saisie={pointNoirSaisie}
            regions={regions}
            regionApercu={regionApercu}
            onApercevoirRegion={apercevoirRegion}
            onEffacerApercu={effacerApercuRegion}
            onLocaliser={(lngLat) => {
              if (situerPointNoir(lngLat)) {
                carte.current?.setView([lngLat[1], lngLat[0]], Math.max(carte.current.getZoom(), 13));
              }
            }}
            onAnnuler={annulerPointNoir}
            onConfirmer={confirmerPointNoir}
            doublon={doublonPointNoir}
            onOuvrirDoublon={ouvrirDoublon}
          />
        )}

        {/* Barrage fixe/mobile, congestion : même barre de confirmation,
          sans étape de qualification préalable (voir posePosition). */}
        {posePosition && (
          <PositionPointNoirBarre
            position={posePosition.lngLat}
            occupe={occupe}
            type={posePosition.type}
            onLocaliser={deplacerPose}
            onAnnuler={annulerPose}
            onConfirmer={confirmerPose}
            doublon={doublonPose}
            onOuvrirDoublon={ouvrirDoublon}
          />
        )}
        {compositionVIP && (
          <CompositionVIPModal
            position={compositionVIP}
            occupe={occupe}
            onAnnuler={annulerCompositionVIP}
            onValider={creerVIP}
          />
        )}
        {/* Overlay 3D */}
        {modal3DItem && (
          <Modal3D
            item={modal3DItem}
            onClose={() => setModal3DItem(null)}
            important={importants?.get(modal3DItem.id)?.important ?? false}
            distanceProcheKm={importants?.get(modal3DItem.id)?.distanceProcheKm ?? null}
            items={items}
            session={session}
            onChange={modifierMq}
            onDelete={supprimerMq}
            onGenererBarrage={genererBarrageManuel}
            generationEnCours={generationEnCours}
            onOuvrirItem={setModal3DItem}
          />
        )}
        {demandeDeconnexion && (
          <ConfirmationDeconnexionModal
            onConfirmer={() => {
              setDemandeDeconnexion(false);
              deconnexion();
            }}
            onAnnuler={() => setDemandeDeconnexion(false)}
          />
        )}
      </div>
    </div>
  );
}
