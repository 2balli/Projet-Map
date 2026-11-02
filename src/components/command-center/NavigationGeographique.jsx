import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconChevron, IconTerritoire, IconTarget } from '../../icons.jsx';
import PanneauDeroulant from './PanneauDeroulant.jsx';

/**
 * NAVIGATION GÉOGRAPHIQUE — un petit bouton à côté du fil d'Ariane.
 *
 * Trois listes en cascade sur les DÉCOUPAGES RÉELS de l'application (contours
 * public/layers/circo_reg | circo_cie | circo_bt) : Région → Compagnie →
 * Brigade. Ce sont les échelons du territoire de la Gendarmerie — l'application
 * n'a pas de découpage administratif provinces / communes. Chaque choix cadre
 * la carte sur le CONTOUR réel de l'entité (cadrerCirconscription, mouvement
 * de caméra natif) ; la liste suivante ne propose que ce qu'elle contient.
 *
 * Portée : un compte régional ne voit que sa région (liste figée), un compte
 * de compagnie que sa compagnie — la même règle que le reste de la carte.
 *
 * @param {{
 *   couches: { region?: object, compagnie?: object, brigade?: object },  FeatureCollections (ou undefined en chargement)
 *   charger: () => void,           demande le chargement des trois couches
 *   contexte: { region?: string, compagnie?: string, brigade?: string },
 *   fige: { region?: string, compagnie?: string, brigade?: string },      imposé par le compte
 *   onChoisir: (niveau: 'region'|'compagnie'|'brigade', nom: string) => void,
 *   onMaroc: () => void,
 *   onRecentrer: () => void,
 * }} p
 */
const trier = (l) => [...new Set(l.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export default function NavigationGeographique({ couches = {}, charger, contexte = {}, fige = {}, onChoisir, onMaroc, onRecentrer }) {
  const racine = useRef(null);
  const [ouvert, setOuvert] = useState(false);
  const fermer = useCallback(() => setOuvert(false), []);
  useEffect(() => {
    if (ouvert) charger?.();
  }, [ouvert, charger]);

  const region = fige.region || contexte.region || '';
  const compagnie = fige.compagnie || contexte.compagnie || '';
  const brigade = fige.brigade || contexte.brigade || '';

  const regions = useMemo(
    () => (fige.region ? [fige.region] : trier((couches.region?.features ?? []).map((f) => f.properties?.nom))),
    [couches.region, fige.region],
  );
  const compagnies = useMemo(() => {
    if (fige.compagnie) return [fige.compagnie];
    if (!region) return [];
    return trier((couches.compagnie?.features ?? []).filter((f) => norm(f.properties?.reg) === norm(region)).map((f) => f.properties?.nom));
  }, [couches.compagnie, region, fige.compagnie]);
  const brigades = useMemo(() => {
    if (fige.brigade) return [fige.brigade];
    if (!compagnie) return [];
    return trier(
      (couches.brigade?.features ?? [])
        .filter((f) => norm(f.properties?.gr_cie) === norm(compagnie) && (!region || norm(f.properties?.gr_region) === norm(region)))
        .map((f) => f.properties?.gr_bde),
    );
  }, [couches.brigade, compagnie, region, fige.brigade]);

  const chargement = !couches.region || !couches.compagnie || !couches.brigade;
  const champ = 'w-full rounded-lg border border-border-default bg-gr-card px-2.5 py-1.5 text-[12px] text-text-primary focus-visible:outline-2 focus-visible:outline-gr-primary disabled:opacity-50';
  const ligne = (id, titre, valeur, options, niveau, vide) => (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-muted">{titre}</span>
      <select
        id={id}
        className={champ}
        value={options.includes(valeur) ? valeur : ''}
        disabled={!options.length || Boolean(fige[niveau])}
        onChange={(e) => e.target.value && onChoisir?.(niveau, e.target.value)}
      >
        <option value="">{options.length ? '— Choisir —' : vide}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );

  const bouton = 'gr-bouton flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-default bg-gr-card px-2 py-1.5 text-[11.5px] font-semibold text-text-secondary hover:bg-gr-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-gr-primary';

  return (
    <div ref={racine} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label="Naviguer vers une région, une compagnie ou une brigade"
        title="Naviguer sur le territoire"
        className={`gr-bouton flex h-[38px] shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold shadow-panel backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
          ouvert ? 'border-gr-primary/50 bg-gr-primary/12 text-gr-primary' : 'border-border-default bg-gr-navy/95 text-text-secondary hover:bg-gr-hover hover:text-text-primary'
        }`}
      >
        <IconTerritoire size={14} />
        <IconChevron size={11} className={`transition-transform duration-200 motion-reduce:transition-none ${ouvert ? 'rotate-180' : ''}`} />
      </button>

      <PanneauDeroulant ouvert={ouvert} ancre={racine} onFermer={fermer} largeur={300} label="Navigation géographique">
        <div className="space-y-2.5 px-3.5 py-3">
          <p className="text-[12.5px] font-bold text-text-primary">Aller à…</p>
          {chargement && <p className="text-[11px] text-text-muted">Chargement des contours…</p>}
          {ligne('nav-region', 'Région', region, regions, 'region', 'Chargement…')}
          {ligne('nav-compagnie', 'Compagnie', compagnie, compagnies, 'compagnie', region ? 'Aucune compagnie' : 'Choisissez une région')}
          {ligne('nav-brigade', 'Brigade', brigade, brigades, 'brigade', compagnie ? 'Aucune brigade' : 'Choisissez une compagnie')}
          <div className="flex gap-1.5 pt-1">
            <button type="button" className={bouton} onClick={() => { onMaroc?.(); fermer(); }}>
              <IconTerritoire size={13} />
              Vue Maroc
            </button>
            <button type="button" className={bouton} onClick={() => onRecentrer?.()} disabled={!region} title="Recadrer la zone sélectionnée">
              <IconTarget size={13} />
              Recentrer
            </button>
          </div>
          <p className="text-[10px] leading-snug text-text-muted">
            Découpage de la Gendarmerie : région, compagnie, brigade.
          </p>
        </div>
      </PanneauDeroulant>
    </div>
  );
}
