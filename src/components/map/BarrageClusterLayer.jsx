/**
 * COUCHE DE CLUSTERING HIÉRARCHIQUE DES BARRAGES
 *
 * Affiche les agrégats de barrages (Région ou Compagnie) sous forme
 * d'étiquettes portant le nom de l'entité. L'effectif exact reste consultable
 * dans l'infobulle de survol. Un double-clic sur un agrégat effectue un zoom
 * direct (fitBounds) vers l'échelon suivant.
 *
 * PLACEMENT SANS CHEVAUCHEMENT — voir placementEtiquettes.js. Les étiquettes
 * ne sont plus posées au chef-lieu mais à l'ancre de leur entité, écartées
 * les unes des autres par priorité ; faute de place, renvoyées hors de
 * l'entité avec un trait de rappel, ou repliées en un point. Le calcul ne
 * dépend que du zoom : il est refait au début de chaque zoom, jamais en
 * glissant la carte.
 *
 * Aux zooms 7–8, les noms de régions restent lus en filigrane, et cèdent
 * toujours la place aux compagnies.
 */
import { useMemo, useState } from 'react';
import { LayerGroup, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import {
  creerIconeCluster, creerIconeFiligrane, calculerDimensionsCluster, CONFIG_CLUSTERS, ICONE_ANCRE_RENVOI,
} from '../../barrageClusterIcons.js';
import {
  placerEtiquettes, dimensionsEtiquette, filigraneRegionsVisible, pointDansGeometrie, projeter, deprojeter,
} from '../../placementEtiquettes.js';
import { normaliserNomEntite } from '../../barrageClustering.js';
import { HABILLAGE_THEME } from '../../theme.js';

const cleNom = (nom) => normaliserNomEntite(nom ?? '').toLowerCase();

/**
 * La zone d'un agrégat : par son nom, et, entre homonymes, celle qui contient
 * son chef-lieu ou ses barrages. Sans zone connue (limites pas encore
 * chargées), l'étiquette garde la position de l'agrégat et le calcul de
 * collision s'applique quand même.
 */
function zoneDe(cluster, zones) {
  const candidates = zones?.get(`${cluster.niveau}:${cleNom(cluster.nom)}`) ?? [];
  if (candidates.length <= 1) return candidates[0] ?? null;
  const reperes = [[cluster.lat, cluster.lng], ...cluster.barrages.slice(0, 3).map((b) => [b.lat, b.lng])];
  return candidates.find((z) => reperes.some((p) => pointDansGeometrie(p, z.geometrie))) ?? candidates[0];
}

/** Le point du bord de l'étiquette le plus proche de son ancre : bout du trait de rappel. */
function boutDuRappel(placement, zoom) {
  const a = projeter(placement.ancre, zoom);
  const b = placement.boite;
  return deprojeter({ x: Math.max(b.x0, Math.min(a.x, b.x1)), y: Math.max(b.y0, Math.min(a.y, b.y1)) }, zoom);
}

export default function BarrageClusterLayer({
  clusters = [],
  onClusterClick,
  /** Map `${niveau}:${nom normalisé}` -> [{ ancre, geometrie, nom, population }] (voir GendarmerieMap). */
  zones = null,
  /** Entité sélectionnée sur la carte : { niveau, nom } — prioritaire, et soulignée. */
  selection = null,
  /** Repères à ne pas recouvrir : [{ position: [lat, lng], rayon }]. */
  obstacles = [],
  theme = 'dark',
}) {
  const carte = useMap();
  /* Le zoom VISÉ, connu dès le début de l'animation : les étiquettes arrivent
     placées en même temps que le nouvel échelon, pas un tiers de seconde après. */
  const [zoom, setZoom] = useState(() => Math.round(carte.getZoom()));
  useMapEvents({
    zoomanim: (e) => setZoom(Math.round(e.zoom)),
    zoomend: () => setZoom(Math.round(carte.getZoom())),
  });

  const niveau = String(clusters[0]?.niveau ?? '').toLowerCase();
  const filigrane = niveau === 'compagnie' && filigraneRegionsVisible(zoom);
  const cleSelection = selection ? `${selection.niveau}:${cleNom(selection.nom)}` : null;

  const etiquettes = useMemo(() => {
    const liste = clusters.map((c) => {
      const zone = zoneDe(c, zones);
      const selectionne = cleSelection === `${String(c.niveau).toLowerCase()}:${cleNom(c.nom)}`;
      return {
        id: c.id,
        ancre: zone?.ancre ?? [c.lat, c.lng],
        geometrie: zone?.geometrie ?? null,
        /* L'entité sélectionnée d'abord, puis la plus chargée en barrages : à
           place égale, c'est elle qu'on vient chercher. */
        priorite: selectionne ? Number.MAX_SAFE_INTEGER : c.count * 1e6 + (zone?.population ?? 0) / 1e3,
        ...calculerDimensionsCluster(c.niveau, c.nom),
        cluster: { ...c, selectionne },
      };
    });
    if (filigrane) {
      for (const zone of zones?.get('region:*') ?? []) {
        liste.push({
          id: `filigrane:${zone.nom}`,
          ancre: zone.ancre,
          geometrie: zone.geometrie,
          /* Toujours derrière les compagnies : un filigrane ne masque rien. */
          priorite: -1 + (zone.population ?? 0) / 1e9,
          renvoi: false,
          cedeAuxObstacles: false,
          ...dimensionsEtiquette('filigrane', zone.nom),
          filigrane: zone.nom,
        });
      }
    }
    return liste;
  }, [clusters, zones, cleSelection, filigrane]);

  const placements = useMemo(
    () => placerEtiquettes(etiquettes, { zoom, obstacles }),
    [etiquettes, zoom, obstacles],
  );

  if (!clusters || clusters.length === 0) {
    return null;
  }

  const parId = new Map(etiquettes.map((e) => [e.id, e]));
  const couleurRappel = HABILLAGE_THEME[theme]?.rappel ?? '#94A3B8';

  return (
    <LayerGroup>
      {placements.map((p) => {
        const e = parId.get(p.id);
        if (e.filigrane) {
          return p.mode === 'replie' ? null : (
            <Marker
              key={p.id}
              position={p.centre}
              icon={creerIconeFiligrane(e.filigrane)}
              interactive={false}
              keyboard={false}
              zIndexOffset={-1000}
            />
          );
        }

        const c = e.cluster;
        const replie = p.mode === 'replie';
        const icone = creerIconeCluster(c, { replie });
        const normNiveau = String(c.niveau || '').toLowerCase();
        const cfg = CONFIG_CLUSTERS[normNiveau] || CONFIG_CLUSTERS.region;
        const decalage = replie ? 8 : e.hauteur / 2 + 6;
        const details = [
          c.fixesCount > 0 && `${c.fixesCount} fixe${c.fixesCount > 1 ? 's' : ''}`,
          c.mobilesCount > 0 && `${c.mobilesCount} mobile${c.mobilesCount > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(', ');
        const sousUnites = new Set(
          c.barrages.map((barrage) => (normNiveau === 'region' ? barrage.cie : barrage.bt)).filter(Boolean),
        ).size;
        const sousUniteLibelle = normNiveau === 'region' ? 'compagnies' : 'brigades';

        return (
          <LayerGroup key={c.id}>
            {p.mode === 'renvoi' && (
              <>
                <Polyline
                  positions={[p.ancre, boutDuRappel(p, zoom)]}
                  interactive={false}
                  pathOptions={{ color: couleurRappel, weight: 1, opacity: 0.85 }}
                />
                <Marker position={p.ancre} icon={ICONE_ANCRE_RENVOI} interactive={false} keyboard={false} />
              </>
            )}
            <Marker
              position={p.centre}
              icon={icone}
              riseOnHover
              zIndexOffset={c.selectionne ? 1000 : 0}
              title={`${cfg.libelleNiveau} ${c.nom} : ${c.count} barrages — double-cliquer pour explorer`}
              eventHandlers={{
                dblclick: (ev) => {
                  if (ev?.originalEvent) {
                    L.DomEvent.stopPropagation(ev.originalEvent);
                    L.DomEvent.preventDefault(ev.originalEvent);
                  }
                  if (onClusterClick) onClusterClick(c);
                },
                /* Clavier : Entrée sur un agrégat focalisé vaut le double-clic. */
                keypress: (ev) => {
                  if (ev?.originalEvent?.key === 'Enter' && onClusterClick) onClusterClick(c);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -decalage]} opacity={1}>
                <div className="min-w-[150px] py-0.5">
                  <strong className="block text-[12px] text-white">{cfg.libelleNiveau} {c.nom}</strong>
                  <span className="mt-0.5 block text-[11px] font-normal text-white/65">
                    {c.count} barrage{c.count > 1 ? 's' : ''} · {sousUnites} {sousUniteLibelle}
                  </span>
                  {details && <span className="block text-[10px] font-normal text-white/45">{details}</span>}
                  <span className="mt-1 block text-[10px] font-semibold text-gr-primary">Double-cliquer pour explorer</span>
                </div>
              </Tooltip>
            </Marker>
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}
