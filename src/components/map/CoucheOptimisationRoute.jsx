import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { useFractionProgressive, prefixesTraces } from '../../traceProgressive.js';

/**
 * CE QUE L'OPTIMISATION PAR ROUTE MONTRE SUR LA CARTE — voir
 * OptimisationRoutePanel.jsx, qui publie `vue`.
 *
 *   le corridor        bande translucide de la largeur réelle (2 × km), recalculée
 *                      au zoom : c'est la règle de sélection, dessinée ;
 *   le tracé           la route ou le trajet retenu : fuchsia sur liseré blanc et
 *                      sombre, plus épais que toute route du fond (atténué, voir
 *                      `attenuer` dans FondCarteVectoriel.jsx), et son nom posé
 *                      dessus (« RN1 », « Rabat → Casablanca ») ;
 *   les conflits       chaque paire en conflit, un trait rouge pointillé —
 *                      cliquable ; le conflit désigné : ses deux barrages
 *                      cerclés, la route qui les relie, et sa fiche ;
 *   les variantes      les autres itinéraires, en tirets — un clic en choisit un ;
 *   les barrages       un anneau autour de chaque barrage retenu (cyan) ou exclu
 *                      (gris), par-dessus son repère ordinaire ;
 *   les déplacements   position actuelle (rouge) → position proposée (vert),
 *                      reliées par le trajet routier du déplacement.
 *
 * Purement d'affichage : aucune décision n'est prise ici.
 *
 * EN SVG, et non sur le canevas de la carte (`preferCanvas`) : quelques
 * dizaines de formes au plus — les tronçons d'une route sont fusionnés en UNE
 * polyligne multiple —, et chacune reste un élément qu'on peut inspecter.
 */
/* Fuchsia : aucune classe de route du fond (orange, ocre, bleu, ardoise) ne le porte. */
const TRACE = '#C026D3';
const CONFLIT = '#F43F5E';
const echapper = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STATUTS = { actif: 'à traiter', en_attente: 'traitement en attente de validation', assigne: 'assigné au CMND Région' };
const PANE = 'gr-optimisation-route';

/** Mètres par pixel à cette latitude et ce zoom (projection Web Mercator). */
const metresParPixel = (lat, zoom) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
const enLatLng = (ligne) => ligne.map(([lng, lat]) => [lat, lng]);
const fmtKm = (km) => `${Number(km).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

export default function CoucheOptimisationRoute({ vue, onAssigner, estAdmin }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  /* Cadrer sur la sélection quand elle change — pas à chaque rendu. */
  const cadrage = vue?.cadrage;
  useEffect(() => {
    if (!cadrage?.bbox) return;
    const [o, s, e, n] = cadrage.bbox;
    map.fitBounds([[s, o], [n, e]], { padding: [60, 60], maxZoom: 13 });
  }, [cadrage, map]);

  const lignes = useMemo(() => (vue?.lignes ?? []).map(enLatLng), [vue?.lignes]);
  /* Une route nouvellement choisie se DESSINE (voir traceProgressive.js) ;
     le corridor et les repères, eux, apparaissent tels quels. */
  const cleTrace = useMemo(() => (lignes.length ? lignes.map((l) => l.length).join('-') + ':' + (lignes[0][0] ?? []).join(',') : null), [lignes]);
  const fractionTrace = useFractionProgressive(cleTrace);
  const lignesVues = useMemo(() => prefixesTraces(lignes, fractionTrace), [lignes, fractionTrace]);
  /* Où poser le nom du tracé : le milieu de son plus long tronçon. */
  const etiquette = useMemo(() => {
    const plusLong = lignes.reduce((m, l) => (l.length > (m?.length ?? 0) ? l : m), null);
    return plusLong?.length ? plusLong[Math.floor(plusLong.length / 2)] : null;
  }, [lignes]);

  const libelleTrace = vue?.libelleTrace ?? null;
  const iconeEtiquette = useMemo(
    () => (libelleTrace
      ? L.divIcon({
          className: '',
          iconSize: null,
          html: `<div data-gr-etiquette-trace style="transform:translate(-50%,-150%);white-space:nowrap;padding:3px 8px;border-radius:6px;background:${TRACE};color:#fff;font:700 12px/1.2 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 2px 6px rgb(0 0 0 / .35)">${echapper(libelleTrace)}</div>`,
        })
      : null),
    [libelleTrace],
  );

  /**
   * L'ESPACEMENT — un écart par paire de barrages consécutifs : son étiquette
   * (km par la route) au milieu de l'intervalle, et, au-delà du maximum, la
   * portion de route en rouge (en tirets si sa géométrie est incertaine). Les
   * positions proposées : cercles violets en tirets, jamais confondues avec
   * un barrage existant.
   */
  const espacement = vue?.espacement ?? null;
  const etiquettesEcarts = useMemo(
    () => (espacement?.troncons ?? []).map((t) => ({
      t,
      icone: L.divIcon({
        className: '',
        iconSize: null,
        html: `<div data-gr-ecart="${t.depasse ? 'depasse' : 'ok'}" style="transform:translate(-50%,-50%);white-space:nowrap;padding:1px 6px;border-radius:5px;font:700 10.5px/1.3 system-ui,sans-serif;color:#fff;background:${t.depasse ? '#DC2626' : '#0F766E'};border:1.5px solid #fff">${echapper(`${t.km.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km${t.incertain ? ' ?' : ''}`)}</div>`,
      }),
    })),
    [espacement],
  );

  /* LE CONFLIT DÉSIGNÉ — cadré, puis sa fiche ouverte entre les deux postes. */
  const conflits = vue?.conflits ?? null;
  const vise = conflits?.liste?.find((c) => c.cle === conflits.vise) ?? null;
  const cleVise = vise?.cle ?? null;
  const viseRef = useRef(vise);
  viseRef.current = vise;
  useEffect(() => {
    const c = viseRef.current;
    if (!c) return;
    const tr = conflits?.trace ?? conflits?.traces?.[c.cle]?.trace;
    const pts = [];
    if (Array.isArray(tr) && tr.length > 1) {
      for (const [lng, lat] of tr) pts.push([lat, lng]);
    } else {
      pts.push([c.a.lat, c.a.lng], [c.b.lat, c.b.lng]);
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [120, 120], maxZoom: 14 });
  }, [cleVise, conflits?.trace, map]);
  const statutVise = vise?.statut;
  /* Les factions par leur NOM, sans horaire. */
  const factionsVise = vise
    ? (vise.factions.length > 2 ? 'toutes' : vise.factions.map((x) => conflits?.factions?.find((f) => f.id === x)?.libelle ?? x).join(', '))
    : '';
  const seuilKm = conflits?.seuilKm;
  useEffect(() => {
    const c = viseRef.current;
    if (!c) return undefined;
    const traceInfo = conflits?.traceInfo ?? conflits?.traces?.[c.cle];
    const routeNom = traceInfo?.routes?.length
      ? traceInfo.routes.join(', ')
      : (c.a.route || vue?.libelleTrace || 'Route');
    const distKm = traceInfo?.km != null ? fmtKm(traceInfo.km) : fmtKm(c.km);
    const tempsTxt = traceInfo?.minutes != null
      ? `${traceInfo.minutes} min`
      : 'Temps estimé indisponible';

    const assignerAction = onAssigner || conflits?.onAssigner || conflits?.onAssignerConflit;
    const admin = estAdmin ?? conflits?.estAdmin;

    const html =
      `<div class="gr-fiche-conflit" style="min-width:240px;padding:3px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;color:#fff;">` +
      `<div style="font-weight:800;font-size:13px;color:#F43F5E;margin-bottom:6px;display:flex;align-items:center;gap:6px;">` +
      `<span style="background:#F43F5E;color:#fff;border-radius:4px;padding:1px 5px;font-size:10px;">${echapper(c.rang || 'Conflit')}</span>` +
      `<span>Conflit de distance</span>` +
      `</div>` +
      `<div style="background:rgba(255,255,255,0.06);border-radius:8px;padding:6px 8px;margin-bottom:6px;border:1px solid rgba(255,255,255,0.1);">` +
      `<div><span style="color:#94A3B8;">Route :</span> <strong>${echapper(routeNom)}</strong></div>` +
      `<div><span style="color:#94A3B8;">Conflit :</span> <strong>${echapper(c.a.nom)} ↔ ${echapper(c.b.nom)}</strong></div>` +
      `<div><span style="color:#94A3B8;">Origine :</span> ${echapper(c.a.nom)}</div>` +
      `<div><span style="color:#94A3B8;">Destination :</span> ${echapper(c.b.nom)}</div>` +
      `</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">` +
      `<div style="background:rgba(255,255,255,0.06);padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);text-align:center;">` +
      `<span style="color:#94A3B8;font-size:9.5px;display:block;font-weight:700;">DISTANCE ROUTIÈRE</span>` +
      `<strong style="color:#fff;font-size:13px;">${echapper(distKm)}</strong>` +
      `</div>` +
      `<div style="background:rgba(255,255,255,0.06);padding:6px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);text-align:center;">` +
      `<span style="color:#94A3B8;font-size:9.5px;display:block;font-weight:700;">TEMPS ESTIMÉ</span>` +
      `<strong style="color:${traceInfo?.minutes != null ? '#7DD3FC' : '#94A3B8'};font-size:12px;">${echapper(tempsTxt)}</strong>` +
      `</div>` +
      `</div>` +
      `<div style="font-size:11px;color:#94A3B8;margin-bottom:3px;">${echapper(c.raison)}</div>` +
      `<div style="font-size:10.5px;color:#64748B;">Faction : ${echapper(factionsVise)} · Statut : ${echapper(STATUTS[c.statut] ?? c.statut)}</div>` +
      /* Déjà assigné (en attente de traitement) ou déjà traité : l'état, pas de bouton. */
      (c.dejaAssigne || c.dejaTraite
        ? `<div style="margin-top:8px;padding:6px 9px;border-radius:8px;background:rgba(56,189,248,.15);color:#7DD3FC;font-weight:700;font-size:11px;">✓ ${c.dejaTraite ? 'Déjà traité et approuvé — voir l’Historique' : `Assigné à ${echapper(c.dejaAssigne)} — en attente de traitement`}</div>`
        : '') +
      (admin && assignerAction && c.statut !== 'resolu' && !c.dejaAssigne && !c.dejaTraite
        ? `<button id="btn-assigner-conflit-popup" type="button" style="display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:8px;padding:7px 10px;background:#F59E0B;color:#0B1B2D;font-weight:800;font-size:11.5px;border-radius:8px;border:none;cursor:pointer;">➜ ${c.statut === 'assigne' || c.assigneA ? 'Réassigner au CMND Région' : 'Assigner au CMND Région'}</button>`
        : '') +
      `</div>`;

    const bulle = L.popup({ autoPan: false, closeOnClick: false, maxWidth: 320 })
      .setLatLng([(c.a.lat + c.b.lat) / 2, (c.a.lng + c.b.lng) / 2])
      .setContent(html)
      .openOn(map);

    const btn = document.getElementById('btn-assigner-conflit-popup');
    if (btn) {
      btn.onclick = (e) => {
        e.stopPropagation();
        const dist = Number(traceInfo?.km != null ? traceInfo.km : (c.km ?? 0));
        const minutes = traceInfo?.minutes != null ? traceInfo.minutes : (dist > 0 ? Math.max(1, Math.round(dist * 1.1)) : null);
        assignerAction({
          id: c.rang || c.cle || 'C-01',
          cle: c.cle,
          numero: c.rang || c.cle,
          rang: c.rang,
          a: c.a,
          b: c.b,
          barrageAId: c.a?.id,
          barrageBId: c.b?.id,
          distanceKm: dist,
          km: dist,
          tempsMinutes: minutes,
          seuilKm: seuilKm ?? 20,
          route: routeNom,
          factionId: c.factions?.[0],
          factions: c.factions ?? [],
          factionLibelle: factionsVise,
          motif: c.raison,
          statut: c.statut,
          assigneA: c.assigneA,
        });
      };
    }

    return () => {
      map.closePopup(bulle);
    };
  }, [cleVise, statutVise, seuilKm, factionsVise, conflits?.traceInfo, vue?.libelleTrace, map, onAssigner, estAdmin]);
  /* Le volet reste monté tant que la couche l'est : un rendu SVG resté
     accroché à un volet démonté dessinerait hors du document. */
  const rendu = useMemo(() => L.svg({ pane: PANE }), []);
  useEffect(() => () => {
    map.removeLayer(rendu);
  }, [map, rendu]);
  if (!vue) return <Pane name={PANE} style={{ zIndex: 450 }} />;

  const latRef = vue.cadrage?.bbox ? (vue.cadrage.bbox[1] + vue.cadrage.bbox[3]) / 2 : map.getCenter().lat;
  const largeurCorridor = vue.corridorKm
    ? Math.min(6000, Math.max(2, (2 * vue.corridorKm * 1000) / metresParPixel(latRef, zoom)))
    : 0;

  return (
    <Pane name={PANE} style={{ zIndex: 450 }}>
      {/* Le corridor : un trait de la largeur du corridor, bouts arrondis — la
          même bande que la règle « à moins de km du tracé ». */}
      {largeurCorridor > 0 && lignes.length > 0 && (
        <Polyline
          positions={lignes}
          interactive={false}
          renderer={rendu}
          pathOptions={{ color: TRACE, weight: largeurCorridor, opacity: 0.13, lineCap: 'round', lineJoin: 'round' }}
        />
      )}

      {(vue.variantes ?? []).filter((v) => !v.choisie).map((v) => (
        <Polyline
          key={`v${v.rang}`}
          positions={enLatLng(v.coords)}
          eventHandlers={{ click: () => vue.onChoisirVariante?.(v.rang) }}
          renderer={rendu}
          pathOptions={{ color: '#475569', weight: 5, opacity: 0.75, dashArray: '8 8' }}
        >
          <Tooltip sticky>
            Itinéraire {v.rang} — {fmtKm(v.km)}, {Math.round(v.minutes)} min · cliquer pour le choisir
          </Tooltip>
        </Polyline>
      ))}

      {lignes.length > 0 && (
        <>
          <Polyline positions={lignesVues} interactive={false} renderer={rendu} pathOptions={{ color: '#0B1B2D', weight: 13, opacity: 0.55 }} />
          <Polyline positions={lignesVues} interactive={false} renderer={rendu} pathOptions={{ color: '#FFFFFF', weight: 9, opacity: 0.95 }} />
          <Polyline positions={lignesVues} interactive={false} renderer={rendu} pathOptions={{ color: TRACE, weight: 5, opacity: 1 }} />
          {etiquette && iconeEtiquette && (
            <Marker
              position={etiquette}
              interactive={false}
              pane={PANE}
              icon={iconeEtiquette}
            />
          )}
        </>
      )}

      {(vue.exclus ?? []).map((b) => (
        <CircleMarker
          key={`x${b.id}`}
          center={[b.lat, b.lng]}
          radius={11}
          renderer={rendu}
          pathOptions={{ color: '#94A3B8', weight: 2, dashArray: '3 3', fill: false }}
        >
          <Tooltip>
            {b.nom} — exclu : {b.raison}
          </Tooltip>
        </CircleMarker>
      ))}
      {(vue.barrages ?? []).map((b) => (
        <CircleMarker
          key={`b${b.id}`}
          center={[b.lat, b.lng]}
          radius={11}
          renderer={rendu}
          pathOptions={{ color: '#06B6D4', weight: 2.5, fill: false }}
        >
          <Tooltip>
            {b.nom} · {b.route || 'route non renseignée'} · {fmtKm(b.distanceKm)} du tracé
          </Tooltip>
        </CircleMarker>
      ))}

      {(vue.deplacements ?? []).map((p) => {
        const trajet = p.routeDeplacement?.trace?.length > 1 ? enLatLng(p.routeDeplacement.trace) : [[p.avant.lat, p.avant.lng], [p.apres.lat, p.apres.lng]];
        return (
          <Fragment key={`d${p.id}`}>
            <Polyline positions={trajet} interactive={false} renderer={rendu} pathOptions={{ color: '#16A34A', weight: 3, opacity: 0.9, dashArray: '6 6' }} />
            {!vue.applique && (
              <CircleMarker center={[p.avant.lat, p.avant.lng]} radius={8} renderer={rendu} pathOptions={{ color: '#DC2626', weight: 2, fillColor: '#DC2626', fillOpacity: 0.35 }}>
                <Tooltip>
                  {p.nom} — position actuelle · {p.avant.route || '—'}
                </Tooltip>
              </CircleMarker>
            )}
            <CircleMarker center={[p.apres.lat, p.apres.lng]} radius={8} renderer={rendu} pathOptions={{ color: '#15803D', weight: 2.5, fillColor: '#22C55E', fillOpacity: 0.85 }}>
              <Tooltip>
                {p.nom} — {vue.applique ? 'nouvelle position' : 'déplacement prévu'} · {p.apres.route}
                {p.apres.pk != null ? ` PK ${p.apres.pk}` : ''}
              </Tooltip>
            </CircleMarker>
          </Fragment>
        );
      })}

      {(espacement?.troncons ?? []).filter((t) => t.depasse).map((t) => (
        <Polyline
          key={`g${t.a.id}-${t.b.id}`}
          positions={enLatLng(t.trace)}
          interactive={false}
          renderer={rendu}
          pathOptions={{ color: '#DC2626', weight: 8, opacity: 0.8, ...(t.incertain ? { dashArray: '10 8' } : {}) }}
        />
      ))}
      {/* À l'échelle du pays, seuls les écarts au-delà du maximum gardent leur étiquette. */}
      {etiquettesEcarts.filter(({ t }) => t.depasse || zoom >= 9).map(({ t, icone }) => (
        <Marker key={`e${t.a.id}-${t.b.id}`} position={[t.milieu[1], t.milieu[0]]} icon={icone} pane={PANE}>
          <Tooltip>
            {t.a.nom} → {t.b.nom} : {fmtKm(t.km)} par la route{t.depasse ? ` — au-delà du maximum de ${espacement.maxKm} km` : ''}
          </Tooltip>
        </Marker>
      ))}

      {(conflits?.liste ?? []).filter((c) => c.cle !== cleVise).map((c) => {
        const tr = conflits?.traces?.[c.cle]?.trace ?? c.trace;
        const pts = Array.isArray(tr) && tr.length > 1 ? enLatLng(tr) : [[c.a.lat, c.a.lng], [c.b.lat, c.b.lng]];
        return (
          <Polyline
            key={`k${c.cle}`}
            positions={pts}
            renderer={rendu}
            eventHandlers={{ click: () => conflits.onViser(c.cle) }}
            pathOptions={{ color: CONFLIT, weight: 3, opacity: 0.65, dashArray: Array.isArray(tr) && tr.length > 1 ? undefined : '2 6' }}
          >
            <Tooltip sticky>{c.rang} · {c.a.nom} ↔ {c.b.nom} · {fmtKm(c.km)}</Tooltip>
          </Polyline>
        );
      })}
      {vise && (
        <>
          {Array.isArray(conflits.trace) && conflits.trace.length > 1 && (
            <Polyline
              positions={enLatLng(conflits.trace)}
              interactive={false}
              renderer={rendu}
              pathOptions={{ color: '#0B1B2D', weight: 10, opacity: 0.65 }}
            />
          )}
          <Polyline
            positions={Array.isArray(conflits.trace) && conflits.trace.length > 1 ? enLatLng(conflits.trace) : [[vise.a.lat, vise.a.lng], [vise.b.lat, vise.b.lng]]}
            interactive={false}
            renderer={rendu}
            pathOptions={{ color: CONFLIT, weight: 6, opacity: 1, ...(Array.isArray(conflits.trace) ? {} : { dashArray: '8 6' }) }}
          />
          {[vise.a, vise.b].map((b) => (
            <Fragment key={`v${b.id}`}>
              <CircleMarker
                center={[b.lat, b.lng]}
                radius={20}
                renderer={rendu}
                interactive={false}
                pathOptions={{ color: CONFLIT, weight: 3, dashArray: '4 4', fill: true, fillColor: CONFLIT, fillOpacity: 0.18 }}
              />
              <CircleMarker
                center={[b.lat, b.lng]}
                radius={9}
                renderer={rendu}
                interactive={false}
                pathOptions={{ color: '#FFFFFF', weight: 2.5, fill: true, fillColor: CONFLIT, fillOpacity: 1 }}
              />
            </Fragment>
          ))}
        </>
      )}
    </Pane>
  );
}
