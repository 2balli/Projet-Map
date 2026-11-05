/**
 * LES CONFLITS DE DISTANCE, IDENTIFIÉS — qui est en conflit avec qui.
 *
 * Remplace le simple faisceau de lignes rouges : quand plusieurs barrages
 * tiennent la même route, leurs itinéraires empruntent la même chaussée et se
 * superposaient pixel pour pixel. Ici, chaque PAIRE du serveur garde son
 * identité jusqu'à l'écran :
 *
 *   - un identifiant (C-01…) au milieu du tracé, avec sa distance ;
 *   - une VOIE propre : les tracés qui partagent un tronçon sont décalés de
 *     quelques pixels, recalculés à chaque zoom ;
 *   - ses deux EXTRÉMITÉS étiquetées « C-01 A » / « C-01 B » ;
 *   - sur chaque barrage, un badge listant SES conflits (« 🔴 C-01 C-03 ») ;
 *   - le conflit DÉSIGNÉ passe au premier plan, les autres restent visibles
 *     en retrait — jamais masqués.
 *
 * RIEN N'EST CALCULÉ ICI DE ROUTIER. Les paires, distances et tracés sont ceux
 * du serveur ; le décalage n'est qu'un déplacement d'affichage : la géométrie
 * transmise et les kilomètres affichés restent ceux de l'itinéraire réel.
 * Voir src/conflitsIdentifies.js.
 */
import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { LayerGroup, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import {
  attribuerVoies,
  clePaire,
  decalerPixels,
  kmConflit,
} from '../../conflitsIdentifies.js';
import { estIntouchable } from '../../marquages.js';
import { IconPoubelle } from '../../icons.jsx';
import { useTraceProgressive } from '../../traceProgressive.js';

const ROUGE = '#E11D2E';
const VERT = '#15803D';
/** Écart entre deux voies, en pixels : assez pour les distinguer, pas assez pour quitter la chaussée de vue. */
const ECART_VOIE_PX = 6;

const ORDRE_PHASE = { avant: 0, mesure: 1, apres: 2, restant: 3 };

const echapper = (t) =>
  String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Le zoom courant, pour recalculer les décalages en pixels. */
function useZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

export default function ConflitsIdentifiesLayer({
  routes,
  conflits,
  items = [],
  vise,
  onViser,
  seuilKm,
  barrageVise = null,
  /** Ce que les panneaux masquent de la carte, en pixels : le cadrage s'en écarte. */
  marges = { gauche: 80, haut: 80, droite: 80, bas: 80 },
  /** Super Admin : afficher le bouton « Assigner au CMND Région » dans la popup du conflit. */
  estAdmin = false,
  /** Session courante (rang, unite…). */
  session = null,
  /** Callback pour assigner un conflit au CMND Région : (conflit) => void. */
  onAssigner = null,
}) {
  const map = useMap();
  const zoom = useZoom();
  const viseId = vise?.id ?? null;
  /* Sans conflit désigné, un BARRAGE désigné (depuis la liste des postes) met
     en avant SES conflits — le comportement de l'ancienne couche manuelle. */
  const concerne = (r) =>
    viseId != null ? r.conflitId === viseId : barrageVise != null && (r.a?.id === barrageVise || r.b?.id === barrageVise);
  const enAvant =
    viseId != null || (barrageVise != null && (routes ?? []).some((r) => r.a?.id === barrageVise || r.b?.id === barrageVise));
  const parId = useMemo(() => new Map((conflits ?? []).map((c) => [c.id, c])), [conflits]);
  const itemsMap = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);

  const estPosteIntouchable = (p) => {
    if (!p) return false;
    if (estIntouchable(p)) return true;
    const id = p.id ?? p;
    const m = itemsMap.get(id);
    return Boolean(m && estIntouchable(m));
  };

  const estEntreIntouchables = (r) => {
    if (r.entreIntouchables === true || r.conflit?.entreIntouchables === true) return true;
    const pA = r.conflit?.a ?? r.a;
    const pB = r.conflit?.b ?? r.b;
    return estPosteIntouchable(pA) && estPosteIntouchable(pB);
  };

  /* Ordre stable : C-01 d'abord, AVANT avant APRÈS — les voies ne sautent
     pas d'un rendu à l'autre. */
  const ordonnees = useMemo(
    () =>
      (routes ?? [])
        .filter((r) => r.trace?.length > 1)
        .map((r) => ({ ...r, conflit: parId.get(r.conflitId) ?? null }))
        .filter((r) => {
          // Si la liste des conflits actifs est fournie, masquer les tracés de conflits supprimés
          if (conflits && Array.isArray(conflits)) {
            const aId = r.a?.id ?? r.a;
            const bId = r.b?.id ?? r.b;
            const pKey = aId && bId ? clePaire(aId, bId) : null;
            const existe =
              (r.conflitId && parId.has(r.conflitId)) ||
              (pKey && conflits.some((c) => c.paireCle === pKey || (c.a?.id && c.b?.id && clePaire(c.a.id, c.b.id) === pKey)));
            if (!existe && r.statut !== 'resolu') return false;
          }
          // NE PAS AFFICHER LA LIGNE ROUGE D'ERREUR ENTRE DEUX POSTES FIXES INTOUCHABLES
          if (r.statut === 'resolu') return true;
          return !estEntreIntouchables(r);
        })
        .sort(
          (x, y) =>
            (x.conflit?.rang ?? 1e9) - (y.conflit?.rang ?? 1e9) ||
            (ORDRE_PHASE[x.phase] ?? 9) - (ORDRE_PHASE[y.phase] ?? 9) ||
            (x.cle < y.cle ? -1 : 1),
        ),
    [routes, parId, conflits, itemsMap],
  );
  const voies = useMemo(() => attribuerVoies(ordonnees), [ordonnees]);

  /* Géométrie D'AFFICHAGE à ce zoom : décalée sur sa voie. */
  const dessin = useMemo(() => {
    return ordonnees.map((r) => {
      const voie = voies.get(r.cle) ?? 0;
      const px = r.trace.map(([lng, lat]) => map.project([lat, lng], zoom));
      const dec = decalerPixels(px, voie * ECART_VOIE_PX);
      const latlngs = dec.map((p) => map.unproject(L.point(p.x, p.y), zoom));
      return { r, voie, latlngs };
    });
  }, [ordonnees, voies, map, zoom]);

  /* Le conflit désigné depuis la liste ou un badge : la carte s'y rend. */
  useEffect(() => {
    if (!vise?.id || !vise.cadrer) return;
    const pts = [];
    for (const d of dessin) if (d.r.conflitId === vise.id) pts.push(...d.r.trace.map(([lng, lat]) => [lat, lng]));
    const c = parId.get(vise.id);
    for (const e of [c?.a, c?.b]) if (Number.isFinite(e?.lat) && Number.isFinite(e?.lng)) pts.push([e.lat, e.lng]);
    /* Les DEUX barrages doivent être visibles : hors du panneau latéral et
       sous la fiche du conflit, d'où des marges dissymétriques. */
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), {
        paddingTopLeft: [marges.gauche, marges.haut],
        paddingBottomRight: [marges.droite, marges.bas],
        maxZoom: 14,
        animate: true,
      });
    }
    else if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 13), { duration: 0.6 });
    // Seul un NOUVEAU geste de désignation cadre — pas un simple re-rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vise?.id, vise?.n]);

  if (!dessin.length) return null;

  /* Le désigné en DERNIER : dessiné par-dessus les autres. */
  const traces = enAvant ? [...dessin.filter((d) => !concerne(d.r)), ...dessin.filter((d) => concerne(d.r))] : dessin;

  return (
    <LayerGroup>
      {traces.map((d) => (
        <TraceConflit key={`cid-${d.r.cle}`} d={d} enAvant={enAvant} choisi={enAvant && concerne(d.r)} onViser={onViser} entreIntouchables={estEntreIntouchables(d.r)} />
      ))}

    </LayerGroup>
  );
}

/**
 * Un tracé de conflit. Sélectionné, il se DESSINE le long de sa route (voir
 * traceProgressive.js) — une fois, au moment de la sélection ; les autres
 * tracés restent immobiles.
 */
function TraceConflit({ d, enAvant, choisi, onViser, entreIntouchables }) {
  const { r } = d;
  const points = useTraceProgressive(d.latlngs, choisi ? r.cle : null);
  const retrait = enAvant && !choisi;
  const resolu = r.statut === 'resolu';
  if (!resolu && entreIntouchables) return null;
  const couleur = resolu ? VERT : ROUGE;
  const id = r.conflitId ?? '—';
  return (
    <LayerGroup>
      <Polyline
        positions={points}
        interactive={false}
        pathOptions={{ color: '#0B1B2D', weight: choisi ? 10 : 6, opacity: retrait ? 0.18 : 0.45 }}
      />
      <Polyline
        positions={points}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            if (r.conflitId) onViser?.(r.conflitId);
          },
        }}
        pathOptions={{
          color: couleur,
          weight: choisi ? 6 : retrait ? 2.5 : 3.5,
          opacity: retrait ? 0.3 : 0.95,
          dashArray: resolu ? '10 6' : null,
        }}
      >
        <Tooltip sticky direction="top">
          <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 4px' }}>
            <span style={{ color: couleur, fontWeight: 800 }}>{id}</span> · {d.r.conflit?.a?.nom ?? r.a?.nom} ↔ {d.r.conflit?.b?.nom ?? r.b?.nom} (<b>{kmConflit(r.km)}</b>)
          </div>
        </Tooltip>
      </Polyline>
    </LayerGroup>
  );
}

const quand = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/**
 * FICHE DÉTAILLÉE DU CONFLIT SÉLECTIONNÉ.
 *
 * Affiche :
 *   - Identifiant (C-01, C-02...) et statuts
 *   - Origine (A) et Destination (B) avec noms et localisations
 *   - Distance routière réelle et temps estimé
 *   - Route, faction et motif du conflit
 *   - Boutons individuels « Ouvrir [nom du barrage] »
 *   - Action « Assigner le conflit » pour le Super Admin
 *   - Traitement opérationnel pour le CMD_REGION
 *   - Historique / détails d'assignation
 */
export function FicheConflit({
  conflit,
  seuilKm,
  session = null,
  estAdmin = false,
  onFermer,
  onOuvrirBarrage,
  onAssigner,
  onTransmettre,
  onTraiter,
  onSupprimer = null,
}) {
  if (!conflit) return null;
  const c = conflit;
  const resolu = c.statut === 'resolu';
  const dist = Number(c.distanceKm ?? c.avantKm ?? c.km ?? 0);
  const temps = c.tempsMinutes ?? (dist > 0 ? Math.max(1, Math.round(dist * 1.1)) : null);
  const route = c.route || c.a?.route || c.b?.route || 'Axe routier';
  const faction = c.factionLibelle || (c.factions?.length ? c.factions.join(' · ') : 'Toutes factions');
  const motif = c.motif || (dist > 0 ? `Distance routière de ${kmConflit(dist)} inférieure au seuil réglementaire (${seuilKm ?? 20} km).` : 'Conflit de proximité');
  /* À qui il est déjà remis : l'état enregistré (retrouvé par sa paire à chaque
     optimisation), à défaut l'assignation faite à l'instant dans cette page. */
  const dejaAssigne = c.dejaAssigne || (c.assigneA?.unite ? `CMD Région ${c.assigneA.unite}` : null);

  const poste = (e, lettre) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="gr-fiche-conflit-lettre">{lettre}</span>
        <b className="truncate text-white font-semibold" title={e?.nom}>
          {e?.nom || e?.id}
        </b>
      </div>
      <div className="text-[10px] text-white/50 pl-5 truncate">
        {[e?.cie, e?.reg].filter(Boolean).join(' · ') || (e?.deplace ? 'Position déplacée' : 'En place')}
      </div>
    </div>
  );

  return (
    <div data-gr-fiche-conflit={c.id} className="pointer-events-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-gr-navy/97 p-3.5 text-white shadow-2xl backdrop-blur-md space-y-2.5 animate-in fade-in duration-150">
      {/* En-tête avec ID, badges et fermeture */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-[12px] font-bold text-red-300 border border-red-500/30">
          {c.id}
        </span>
        {c.nouveau && <span className="gr-fiche-conflit-nouveau">NOUVEAU CONFLIT</span>}
        {resolu ? (
          <span className="rounded bg-green-500/20 px-2 py-0.5 text-[10px] font-bold text-green-300 border border-green-500/30">
            ✓ Résolu
          </span>
        ) : c.dejaTraite ? (
          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/30" title="Traité et approuvé — voir l’Historique">
            ✓ Déjà traité
          </span>
        ) : dejaAssigne ? (
          <span className="rounded bg-sky-400/20 px-2 py-0.5 text-[10px] font-bold text-sky-300 border border-sky-400/30 truncate max-w-[190px]" title={`Assigné à ${dejaAssigne} — en attente de traitement`}>
            ✓ Assigné à {dejaAssigne}
          </span>
        ) : (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/30">
            À traiter
          </span>
        )}

        {c.factionLibelle && (
          <span className="text-[11px] bg-blue-500/20 border border-blue-500/30 rounded px-1.5 py-0.5 text-blue-300">
            {c.factionLibelle}
          </span>
        )}

        <button
          type="button"
          onClick={onFermer}
          aria-label="Fermer la fiche du conflit"
          className="ml-auto rounded-lg px-2 py-0.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors text-base"
        >
          ×
        </button>
      </div>

      {/* Origine et Destination */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-white/5 p-2 border border-white/5">
        {poste(c.a, 'A')}
        <div className="text-white/40 font-bold px-1 text-center">↔</div>
        {poste(c.b, 'B')}
      </div>

      {/* Métriques clés */}
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-black/30 p-2 border border-white/5">
          <span className="block text-[9.5px] font-bold uppercase tracking-wider text-white/50">
            Distance routière
          </span>
          <span className="font-mono text-[13.5px] font-bold text-amber-300">
            {kmConflit(dist)}
          </span>
          {seuilKm != null && (
            <span className="block text-[9px] text-white/40 mt-0.5">
              seuil : {seuilKm} km
            </span>
          )}
        </div>

        <div className="rounded-xl bg-black/30 p-2 border border-white/5">
          <span className="block text-[9.5px] font-bold uppercase tracking-wider text-white/50">
            Temps estimé
          </span>
          <span className="font-mono text-[13.5px] font-bold text-sky-300">
            {temps != null ? `${temps} min` : '—'}
          </span>
          <span className="block text-[9px] text-white/40 mt-0.5">
            par le réseau routier
          </span>
        </div>
      </div>

      {/* Informations route, origine, destination et motif */}
      <div className="rounded-xl border border-white/10 bg-black/25 p-2.5 text-[11px] space-y-1">
        <div>
          <span className="text-white/50">Route / Axe :</span>{' '}
          <b className="text-white">{route}</b>
        </div>
        <div>
          <span className="text-white/50">Origine (A) :</span>{' '}
          <span className="text-white/90">{c.a?.nom || c.a?.id}</span>
        </div>
        <div>
          <span className="text-white/50">Destination (B) :</span>{' '}
          <span className="text-white/90">{c.b?.nom || c.b?.id}</span>
        </div>
        <div>
          <span className="text-white/50">Faction :</span>{' '}
          <span className="text-sky-300">{faction}</span>
        </div>
        <div>
          <span className="text-white/50">Motif :</span>{' '}
          <span className="text-red-300 font-medium">{motif}</span>
        </div>
      </div>

      {/* DÉJÀ ASSIGNÉ — en attente de traitement : ni nouvel « Assigner », ni doublon. */}
      {dejaAssigne && !resolu && (
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 p-2 text-[11px] text-sky-200">
          <div className="flex items-center justify-between font-semibold">
            <span>Assigné à {dejaAssigne}</span>
            {c.assigneLe && (
              <span className="text-[10px] text-white/50 font-normal">
                {quand(c.assigneLe)}
              </span>
            )}
          </div>
          <div className="text-[10px] text-white/60 mt-0.5">En attente de traitement.</div>
        </div>
      )}

      {/* Boutons d'action */}
      <div className="space-y-1.5 pt-1">
        <div className="flex gap-1.5">
          {[c.a, c.b].map((barrage) => (
            <button
              key={barrage?.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOuvrirBarrage?.(barrage?.id);
              }}
              className="flex-1 truncate rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-white/90 hover:bg-white/20 transition-colors border border-white/10"
              title={`Ouvrir la fiche de ${barrage?.nom || barrage?.id}`}
            >
              Ouvrir {barrage?.nom || barrage?.id}
            </button>
          ))}
        </div>

        {/* Action Assigner le conflit pour le Super Admin (au CMD Région
            concerné) — pas pour un conflit déjà assigné. */}
        {estAdmin && !resolu && !dejaAssigne && !c.dejaTraite && onAssigner && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAssigner?.(c);
            }}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gr-gold px-3 py-2 text-[12px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors shadow-md"
          >
            <span>➜ Assigner au CMD Région</span>
          </button>
        )}

        {/* Action Assigner à la Cie (UNIQUEMENT pour le CMD_REGION) */}
        {!estAdmin && session?.rang === 'reg' && !resolu && onTransmettre && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTransmettre?.(c);
            }}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-400 px-3 py-2 text-[12px] font-bold text-white transition-colors shadow-md"
          >
            <span>➜ Assigner à la Cie</span>
          </button>
        )}

        {/* Action Traiter le conflit (pour CMD_REGION et CMD_COMPAGNIE uniquement) */}
        {!estAdmin && (session?.rang === 'reg' || session?.rang === 'cie') && !resolu && onTraiter && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTraiter?.(c.a);
            }}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 px-3 py-2 text-[12px] font-bold text-white transition-colors shadow-md"
          >
            <span>Traiter ce conflit</span>
          </button>
        )}

        {/* Action Supprimer manuellement ce conflit (Remove) */}
        {onSupprimer && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSupprimer?.(c);
            }}
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 hover:bg-red-500/25 px-3 py-1.5 text-[11px] font-bold text-red-300 hover:text-red-200 transition-colors shadow-sm"
            title="Supprimer manuellement ce conflit"
          >
            <IconPoubelle size={12} />
            <span>Supprimer ce conflit</span>
          </button>
        )}
      </div>
    </div>
  );
}
