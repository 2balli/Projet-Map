import { usePresence } from './usePresence.js';
import {
  IconLayers,
  IconClose,
  IconSpinner,
  IconAlert,
  IconTarget,
} from './icons.jsx';
import { LAYER_GROUPS, BASEMAP } from './layersConfig.js';

/* ================================================================== */
/* Briques                                                            */
/* ================================================================== */

const fmt = (n) => (n == null ? null : n.toLocaleString('fr-FR'));

/**
 * Bouton-couche : icône colorée + libellé bilingue + compteur.
 * Hauteur 52 px -> cible tactile conforme (>= 44 px), état actif porté par
 * la couleur ET la coche ET le fond (jamais par la couleur seule).
 */
function LayerToggle({ layer, active, count, loading, error, onToggle }) {
  const Icon = layer.icon;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={() => onToggle(layer.key)}
      title={error || undefined}
      className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left
        transition-colors duration-150 motion-reduce:transition-none
        focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
        ${
          active
            ? 'bg-white/12 hover:bg-white/16'
            : 'bg-transparent hover:bg-white/6'
        }`}
    >
      {/* Pastille d'icône : pleine si active, atténuée sinon */}
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg transition-colors duration-150 motion-reduce:transition-none"
        style={
          active
            ? { backgroundColor: layer.color, color: '#0b1220' }
            : { backgroundColor: 'color-mix(in srgb, var(--text-primary) 7%, transparent)', color: 'var(--text-muted)' }
        }
      >
        {loading ? <IconSpinner size={18} /> : <Icon size={18} />}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[13px] font-semibold leading-tight ${
            active ? 'text-white' : 'text-white/55'
          }`}
        >
          {layer.fr}
        </span>
        <span
          dir="rtl"
          className={`block truncate text-[12px] leading-tight ${
            active ? 'text-white/60' : 'text-white/35'
          }`}
        >
          {layer.ar}
        </span>
      </span>

      {/* Compteur / état */}
      <span className="shrink-0 text-right">
        {error ? (
          <IconAlert size={16} className="text-gr-red" />
        ) : count != null ? (
          <span
            className={`font-mono text-[12px] tabular-nums ${
              active ? 'text-white/80' : 'text-white/30'
            }`}
          >
            {fmt(count)}
          </span>
        ) : null}
      </span>

      {/* Coche : redondance non chromatique de l'état */}
      <span
        aria-hidden
        className={`grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none ${
          active
            ? 'border-transparent bg-gr-gold text-gr-navy'
            : 'border-white/25 bg-transparent text-transparent'
        }`}
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m2.5 6.2 2.2 2.3 4.8-5" />
        </svg>
      </span>
    </button>
  );
}

/**
 * Fond de carte : source unique, donc simple indicateur d'état et non un
 * sélecteur. `tilesOk` reflète le chargement réel des tuiles.
 */
function BasemapStatus({ tilesOk }) {
  const Icon = BASEMAP.icon;

  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/6 px-2.5 py-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-white">
          {BASEMAP.fr}
        </span>
        <span className="block truncate font-mono text-[11px] leading-tight text-white/45">
          {BASEMAP.hint}
        </span>
      </span>
      {tilesOk === false && (
        <span
          title="Fond de carte introuvable — archive fond-carte/tiles/maroc.pmtiles absente ou illisible (voir mapConfig.js)"
          className="flex shrink-0 items-center gap-1 rounded-md bg-gr-red/15 px-1.5 py-1 text-[10px] font-semibold text-gr-red"
        >
          <IconAlert size={13} />
          hors ligne
        </span>
      )}
    </div>
  );
}

/**
 * Routes classées : la couche de numéros et de classes posée sur le fond (voir
 * `COUCHES_ROUTES`, FondCarteVectoriel.jsx). Même interrupteur que les couches.
 */
const CLASSES_ROUTES = [
  ['A', 'Autoroute'],
  ['RN', 'Nationale'],
  ['RR', 'Régionale'],
  ['RP', 'Provinciale'],
];
function RoutesToggle({ active, couleurs, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className={`mt-1 flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
        active ? 'bg-white/12 hover:bg-white/16' : 'bg-transparent hover:bg-white/6'
      }`}
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg font-mono text-[10px] font-bold"
        style={active ? { backgroundColor: couleurs.RN, color: '#0b1220' } : { backgroundColor: 'color-mix(in srgb, var(--text-primary) 7%, transparent)', color: 'var(--text-muted)' }}
      >
        RN
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] font-semibold leading-tight ${active ? 'text-white' : 'text-white/55'}`}>
          Routes classées
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] leading-tight text-white/50">
          {CLASSES_ROUTES.map(([cle, nom]) => (
            <span key={cle} className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: couleurs[cle] }} />
              {nom}
            </span>
          ))}
        </span>
      </span>
      <span
        aria-hidden
        className={`grid size-4 shrink-0 place-items-center rounded-full border ${
          active ? 'border-transparent bg-gr-gold text-gr-navy' : 'border-white/25 bg-transparent text-transparent'
        }`}
      >
        <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m2.5 6.2 2.2 2.3 4.8-5" />
        </svg>
      </span>
    </button>
  );
}

function GroupHeading({ group }) {
  return (
    <div className="mb-1 flex items-baseline justify-between px-1">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">
        {group.fr}
      </h3>
      <span dir="rtl" className="text-[11px] text-white/35">
        {group.ar}
      </span>
    </div>
  );
}

/* ================================================================== */
/* Panneau                                                            */
/* ================================================================== */

/**
 * Réglage de la taille de l'interface.
 *
 * Placé dans le panneau Couches, ouvert par défaut : c'est le premier endroit
 * où l'on regarde, et le réglage doit être trouvé SANS savoir le chercher.
 * Deux boutons de 44 px — la taille minimale pour être visé sans effort — et
 * le pourcentage écrit en clair entre les deux, pour qu'on sache où on en est.
 */
function TailleInterface({ echelle, onChanger }) {
  const pct = Math.round(echelle * 100);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/6 px-2.5 py-2">
      <span className="min-w-0 flex-1 text-[12px] font-semibold text-white/70">
        Taille de l'affichage
      </span>
      <button
        type="button"
        onClick={() => onChanger(-0.1)}
        disabled={echelle <= 1}
        aria-label="Réduire la taille de l'affichage"
        className="grid size-11 shrink-0 place-items-center rounded-lg bg-white/10 text-[15px]
          font-bold text-white transition-colors hover:bg-white/20 disabled:opacity-30
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
      >
        A−
      </button>
      <span className="w-11 shrink-0 text-center font-mono text-[12px] tabular-nums text-white/60">
        {pct}%
      </span>
      <button
        type="button"
        onClick={() => onChanger(0.1)}
        disabled={echelle >= 1.6}
        aria-label="Agrandir la taille de l'affichage"
        className="grid size-11 shrink-0 place-items-center rounded-lg bg-gr-gold text-[17px]
          font-bold text-gr-navy transition-[filter] hover:brightness-110 disabled:opacity-30
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
      >
        A+
      </button>
    </div>
  );
}

/**
 * Ce que fait le zoom, dit là où l'on coche.
 *
 * Les limites territoriales suivent le zoom (voir limitesTerritoriales.js) :
 * sans cette ligne, les trois cases laissent croire que rien ne s'affiche tant
 * qu'on n'a rien coché, alors que le découpage de l'endroit regardé est déjà
 * là. Elle dit aussi ce que cocher ajoute vraiment — forcer, à tous les zooms.
 */
function NoteEchelonAuto({ echelon }) {
  return (
    <p className="mb-1.5 px-1 text-[10.5px] leading-snug text-white/40">
      Affichage automatique selon le zoom
      {echelon && (
        <> — actuellement <span className="font-semibold text-gr-gold/80">{echelon.long}</span></>
      )}
      . Cocher force l'affichage à tous les zooms.
    </p>
  );
}

export default function SidePanel({
  active,
  counts,
  status,
  tilesOk,
  proximityCounts = {},
  echelonLimites = null,
  onToggleLayer,
  session,
  echelleUI = 1,
  onChangerEchelle,
  routesVisibles = false,
  couleursRoutes = null,
  onToggleRoutes = null,
  /* L'ouverture/fermeture est pilotée par GendarmerieMap, comme les autres
     panneaux : le bouton vit dans la colonne, pas dans le panneau. */
  open,
  onClose,
}) {
  /**
   * Le bouton « Couches » est rendu par GendarmerieMap, dans la colonne de
   * boutons, au même titre que Saisie, Distances et Filtrer. Le panneau
   * s'ouvre ensuite À CÔTÉ de cette colonne, comme tous les autres — il ne
   * glisse plus depuis le bord de l'écran, où il recouvrait les boutons.
   */
  const presence = usePresence(open);
  if (!presence.monte) return null;

  /* Utilisé par le pied de panneau ; il était déclaré avec le bouton
     d'ouverture, parti dans GendarmerieMap. */
  const activeCount = active.size;

  return (
    <>
      <aside
        aria-label="Couches et fonds de carte"
        data-presence={presence.etat}
        data-depuis="gauche"
        className="pointer-events-auto relative flex max-h-full w-[318px] shrink-0
          max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10
          bg-gr-navy/95 shadow-panel backdrop-blur-md"
      >
        {/* En-tête */}
        <header className="flex items-center gap-2.5 border-b border-white/10 px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy">
            <IconLayers size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-bold leading-tight tracking-wide text-white">
              GENDARMERIE ROYALE
            </h2>
            <p dir="rtl" className="truncate text-[13px] leading-tight text-gr-gold/70">
              الخريطة التكتيكية
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau"
          title="Replier la section — la carte reprend tout l'écran"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-white/50
              transition-colors duration-150 hover:bg-white/10 hover:text-white
              motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            <IconClose size={18} />
          </button>
        </header>

        {/* Corps défilant */}
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-2.5 py-3">
          {onChangerEchelle && (
            <TailleInterface echelle={echelleUI} onChanger={onChangerEchelle} />
          )}

          {/* Le raccourci vers l'administration a été retiré d'ici : elle a
              désormais son propre bouton dans la colonne de droite, au même
              titre qu'Optimisation et Analyse. */}
          {LAYER_GROUPS.map((group) => (
            <section key={group.id}>
              <GroupHeading group={group} />
              {group.id === 'circo' && <NoteEchelonAuto echelon={echelonLimites} />}
              <div className="space-y-0.5">
                {group.layers.map((layer) => {
                  const dataKey = layer.dataKey ?? layer.key;
                  const st = status[dataKey] ?? {};
                  // Une couche de proximité compte des paires, pas des entités.
                  const count =
                    layer.key in proximityCounts
                      ? proximityCounts[layer.key]
                      : counts[dataKey];
                  return (
                    <LayerToggle
                      key={layer.key}
                      layer={layer}
                      active={active.has(layer.key)}
                      count={count}
                      loading={st.loading}
                      error={st.error}
                      onToggle={onToggleLayer}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          <section>
            <GroupHeading group={{ fr: 'Fond de carte', ar: 'خريطة الأساس' }} />
            <BasemapStatus tilesOk={tilesOk} />
            {onToggleRoutes && couleursRoutes && (
              <RoutesToggle active={routesVisibles} couleurs={couleursRoutes} onToggle={onToggleRoutes} />
            )}
          </section>
        </div>

        {/* Pied : erreurs de chargement */}
        <footer className="border-t border-white/10 px-3.5 py-2.5">
          {(() => {
            const errs = Object.entries(status).filter(([, s]) => s.error);
            if (errs.length === 0) {
              return (
                <p className="flex items-center gap-1.5 text-[11px] text-white/40">
                  <IconTarget size={13} />
                  {activeCount} couche{activeCount > 1 ? 's' : ''} active
                  {activeCount > 1 ? 's' : ''}
                </p>
              );
            }
            return (
              <div className="space-y-1">
                {errs.map(([k, s]) => (
                  <p key={k} className="flex items-start gap-1.5 text-[11px] text-gr-red">
                    <IconAlert size={13} className="mt-px shrink-0" />
                    <span className="min-w-0 break-words">
                      {k} : {s.error}
                    </span>
                  </p>
                ))}
              </div>
            );
          })()}
        </footer>
      </aside>
    </>
  );
}
