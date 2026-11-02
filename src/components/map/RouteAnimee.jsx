import { useMemo, useState } from 'react';
import L from 'leaflet';
import { LayerGroup, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { animerTrace, dureeDessin, longueurKm, pointLeLong } from '../../animationTrace.js';

/**
 * « VOIR SUR LA CARTE » — les routes d'un conflit se dessinent, avec leur
 * distance.
 *
 * Chaque route (avant, après, déplacement…) est indépendante :
 *   — ROUTE RÉELLE (graphe routier) : dessinée progressivement, segment après
 *     segment sur sa géométrie exacte, un point lumineux la parcourt ; puis
 *     l'étiquette de distance paraît — distance MESURÉE SUR CETTE GÉOMÉTRIE
 *     (somme de ses segments), donc la distance par la route ;
 *   — PAS DE ROUTE CONNUE : un trait pointillé discret entre les deux points,
 *     et l'étiquette le dit : « à vol d'oiseau · tracé routier indisponible ».
 *     Rien n'est présenté comme une route qui n'en est pas une.
 * Plusieurs routes : l'une après l'autre ; étiquettes placées à des endroits
 * différents du parcours et décalées si elles se touchent. Un clic sur une
 * route ou son étiquette la REJOUE (elle seule). `jeu` change à chaque
 * « Voir sur la carte » : tout est retiré puis redessiné (aucun doublon).
 *
 * Renderer SVG dédié (la carte est en canvas) ; couleurs du thème (index.css,
 * `.gr-route-*`). Animations réduites : routes et étiquettes d'emblée.
 *
 * @param {{
 *   routes: Array<{ cle: string, positions: Array<[number, number]>, routiere: boolean, role: 'conflit'|'resolue'|'deplacement', titre?: string, km?: number|null }>,
 *   jeu?: number|string,
 * }} p
 */
const PANE = 'gr-route-vue';
const ECART_S = 0.5;
const FRACTIONS = [0.5, 0.32, 0.68];

const libelle = (r) => {
  if (!r.km || !Number.isFinite(r.km)) return { valeur: 'Distance inconnue', note: r.titre ?? '' };
  const valeur = `${r.km < 10 ? r.km.toFixed(2) : r.km.toFixed(1)} km`;
  return r.routiere
    ? { valeur, note: [r.titre, 'par la route'].filter(Boolean).join(' · ') }
    : { valeur, note: [r.titre, 'à vol d’oiseau · tracé routier indisponible'].filter(Boolean).join(' · ') };
};

function iconeEtiquette(r, delaiS, dessous) {
  const { valeur, note } = libelle(r);
  return L.divIcon({
    className: 'gr-route-etiquette-ancre',
    iconSize: null,
    html: `<span class="gr-route-etiquette gr-route-${r.routiere ? r.role : 'directe'}" style="--gr-delai:${delaiS}s;transform:translate(-50%, ${dessous ? '14px' : 'calc(-100% - 14px)'})" title="Rejouer le tracé">`
      + `<i></i>${valeur}${note ? ` <small>${note}</small>` : ''}</span>`,
  });
}

export default function RouteAnimee({ routes = [], jeu = 0 }) {
  const map = useMap();
  const rendu = useMemo(() => {
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = 645;
    return L.svg({ pane: PANE });
  }, [map]);
  const [rejeux, setRejeux] = useState({});
  /* Les étiquettes se replacent quand le zoom change (chevauchements). */
  const [, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  /* La séquence : délai et durée de chaque route, selon sa longueur réelle. */
  const plan = useMemo(() => {
    let delai = 0;
    return routes
      .filter((r) => Array.isArray(r.positions) && r.positions.length > 1)
      .map((r, i) => {
        /* Distance AFFICHÉE : celle du moteur d'itinéraire pour cette route
           (`r.km`), sinon mesurée sur sa géométrie ; sans route, la droite
           entre ses extrémités (annoncée « à vol d'oiseau »). */
        const km = r.routiere
          ? (Number.isFinite(r.km) ? r.km : longueurKm(r.positions))
          : longueurKm([r.positions[0], r.positions.at(-1)]);
        const duree = r.routiere ? dureeDessin(km) : 0;
        const p = { ...r, km, duree, delai, point: pointLeLong(r.positions, FRACTIONS[i % FRACTIONS.length]) };
        delai += r.routiere ? duree + ECART_S : 0;
        return p;
      });
    // `jeu` : un nouveau « Voir sur la carte » recalcule et rejoue tout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, jeu]);

  /* Étiquettes qui se toucheraient : la suivante passe SOUS sa route. */
  const dessous = new Set();
  const places = [];
  for (const r of plan) {
    if (!r.point) continue;
    const p = map.latLngToContainerPoint(r.point);
    if (places.some((q) => Math.abs(q.x - p.x) < 150 && Math.abs(q.y - p.y) < 34)) dessous.add(r.cle);
    places.push(p);
  }

  const rejouer = (cle) => setRejeux((m) => ({ ...m, [cle]: (m[cle] ?? 0) + 1 }));

  return (
    <LayerGroup key={jeu}>
      {plan.map((r) => {
        const n = rejeux[r.cle] ?? 0;
        /* Rejouée seule : sans attendre les autres. */
        const delai = n ? 0 : r.delai;
        const classe = r.routiere ? `gr-route-${r.role}` : 'gr-route-directe';
        return (
          <LayerGroup key={`${r.cle}-${n}`}>
            <Polyline
              positions={r.positions}
              renderer={rendu}
              className={classe}
              smoothFactor={0.5}
              eventHandlers={{
                add: (e) => {
                  const p = e.target?._path;
                  if (!p) return;
                  p.classList.add(classe);
                  if (r.routiere) e.target.once('remove', animerTrace(p, { delaiS: delai, dureeS: r.duree, point: true }));
                },
                click: () => r.routiere && rejouer(r.cle),
              }}
              pathOptions={{
                color: '#EF4444',
                weight: r.routiere ? 5 : 2.5,
                opacity: r.routiere ? 0.95 : 0.7,
                dashArray: r.routiere ? null : '6 7',
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            {r.point && (
              <Marker
                position={r.point}
                icon={iconeEtiquette(r, r.routiere ? delai + r.duree : 0, dessous.has(r.cle))}
                keyboard={false}
                zIndexOffset={1600}
                eventHandlers={{ click: () => r.routiere && rejouer(r.cle) }}
              />
            )}
          </LayerGroup>
        );
      })}
    </LayerGroup>
  );
}
