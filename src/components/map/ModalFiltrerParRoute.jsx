import React, { useState, useEffect, useMemo } from 'react';
import { IconClose, IconRoute, IconSpinner } from '../../icons.jsx';
import { canonicalRouteId } from '../../conflitsIdentifies.js';
import {
  obtenirDirectionBarrage,
  SENS_ALLER,
  SENS_RETOUR,
  SENS_TOUS,
} from '../../directionSens.js';

const CATEGORIES_ROUTES = [
  { id: 'tous', libelle: 'Toutes les catégories', badge: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
  { id: 'autoroute', libelle: 'Autoroutes (A)', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { id: 'nationale', libelle: 'Routes Nationales (RN / N)', badge: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { id: 'regionale', libelle: 'Routes Régionales (RR / R)', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { id: 'provinciale', libelle: 'Routes Provinciales (RP / P)', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { id: 'autre', libelle: 'Autres axes routiers', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
];

function determinerCategorieRoute(r) {
  const can = canonicalRouteId(r) || String(r || '').trim().toUpperCase();
  if (/^A\d/.test(can)) return 'autoroute';
  if (/^(RN|N)\d/.test(can)) return 'nationale';
  if (/^(RR|R)\d/.test(can)) return 'regionale';
  if (/^(RP|P)\d/.test(can)) return 'provinciale';
  return 'autre';
}

/**
 * Modale centrée de configuration du filtrage des barrages et conflits par route.
 * Permet de :
 * 1. Choisir le type de route (Autoroute, Nationale, Régionale, Provinciale).
 * 2. Choisir l'axe routier spécifique filtré dynamiquement selon la catégorie.
 * 3. Régler la distance d'espacement (seuil en km).
 * 4. Déclencher le calcul explicite pour isoler la route sur la carte et afficher ses conflits.
 */
export default function ModalFiltrerParRoute({
  open,
  onClose,
  routesDisponibles = [],
  barrages = [],
  initialRoute = '',
  initialDistance = 20,
  initialSens = SENS_TOUS,
  filtreActif = null,
  onCalculer,
  onEffacer,
  /* Une analyse est en cours (le radar tourne sur la carte) : Calculer est
     désactivé jusqu'à sa fin — jamais deux calculs à la fois. */
  calculEnCours = false,
}) {
  const [categorieChoisie, setCategorieChoisie] = useState(() => (
    initialRoute ? determinerCategorieRoute(initialRoute) : 'tous'
  ));
  const [route, setRoute] = useState(initialRoute || '');
  const [distance, setDistance] = useState(initialDistance || 20);
  const [sens, setSens] = useState(initialSens || SENS_TOUS);
  const [rechercheTexte, setRechercheTexte] = useState('');
  const [erreur, setErreur] = useState('');
  const enCalcul = Boolean(calculEnCours);

  // Nombre de barrages par route canonique et ventilation par sens
  const compteursParRouteEtSens = useMemo(() => {
    const counts = new Map();
    for (const b of barrages ?? []) {
      const r = canonicalRouteId(b.route || b.axe || b.axeRoutier);
      if (r) {
        if (!counts.has(r)) {
          counts.set(r, { total: 0, aller: 0, retour: 0 });
        }
        const obj = counts.get(r);
        obj.total += 1;
        const dir = obtenirDirectionBarrage(b);
        if (dir === SENS_ALLER) obj.aller += 1;
        else if (dir === SENS_RETOUR) obj.retour += 1;
      }
    }
    return counts;
  }, [barrages]);

  const compteursParRoute = useMemo(() => {
    const counts = new Map();
    for (const [r, stat] of compteursParRouteEtSens.entries()) {
      counts.set(r, stat.total);
    }
    return counts;
  }, [compteursParRouteEtSens]);

  // Initialisation à l'ouverture
  useEffect(() => {
    if (open) {
      const routeInit = initialRoute || (filtreActif || '');
      const catInit = routeInit ? determinerCategorieRoute(routeInit) : 'tous';
      setCategorieChoisie(catInit);
      if (routeInit) {
        setRoute(routeInit);
      } else {
        // Sélectionner par défaut la route qui a le plus grand nombre de barrages (ex: RN1)
        let meilleureRoute = '';
        let maxBarrages = -1;
        for (const r of routesDisponibles ?? []) {
          const nb = compteursParRoute.get(r) || 0;
          if (nb > maxBarrages) {
            maxBarrages = nb;
            meilleureRoute = r;
          }
        }
        setRoute(meilleureRoute || (routesDisponibles?.[0] ?? ''));
      }
      setDistance(initialDistance || 20);
      setSens(initialSens || SENS_TOUS);
      setRechercheTexte('');
      setErreur('');
    }
  }, [open, initialRoute, initialDistance, initialSens, filtreActif, routesDisponibles, compteursParRoute]);

  // Routes filtrées selon la catégorie et la recherche textuelle, triées par nombre de barrages décroissant puis nom
  const routesFiltrees = useMemo(() => {
    let liste = routesDisponibles ?? [];
    if (categorieChoisie !== 'tous') {
      liste = liste.filter((r) => determinerCategorieRoute(r) === categorieChoisie);
    }
    if (rechercheTexte.trim()) {
      const q = rechercheTexte.trim().toUpperCase();
      liste = liste.filter((r) => r.toUpperCase().includes(q));
    }
    return [...liste].sort((a, b) => {
      const countA = compteursParRoute.get(a) || 0;
      const countB = compteursParRoute.get(b) || 0;
      if (countA !== countB) return countB - countA;
      return a.localeCompare(b, 'fr', { numeric: true });
    });
  }, [routesDisponibles, categorieChoisie, rechercheTexte, compteursParRoute]);

  // Statistiques de la route actuellement sélectionnée (Total, Aller, Retour)
  const statsRouteSelectionnee = useMemo(() => {
    if (!route) return null;
    const can = canonicalRouteId(route);
    return compteursParRouteEtSens.get(can) || null;
  }, [route, compteursParRouteEtSens]);

  // Changement de catégorie : ajuster automatiquement la route sélectionnée
  const handleChangerCategorie = (nouvelleCat) => {
    setCategorieChoisie(nouvelleCat);
    setRechercheTexte('');
    if (erreur) setErreur('');

    let liste = routesDisponibles ?? [];
    if (nouvelleCat !== 'tous') {
      liste = liste.filter((r) => determinerCategorieRoute(r) === nouvelleCat);
    }
    if (liste.length > 0) {
      const triee = [...liste].sort((a, b) => (compteursParRoute.get(b) || 0) - (compteursParRoute.get(a) || 0));
      setRoute(triee[0]);
    } else {
      setRoute('');
    }
  };

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const routeNettoyee = (route || '').trim();
    const distNum = Number(distance);

    if (!routeNettoyee) {
      setErreur('Veuillez sélectionner un axe routier dans la liste.');
      return;
    }
    if (!Number.isFinite(distNum) || distNum <= 0) {
      setErreur('Veuillez saisir une distance de recherche valide (supérieure à 0 km).');
      return;
    }
    if (distNum > 500) {
      setErreur('La distance maximale de recherche est de 500 km.');
      return;
    }

    setErreur('');
    /* La fenêtre se ferme pour laisser voir la carte : le radar y suit le
       calcul réel, et ses résultats — ou son erreur — s'y affichent
       (lancerAnalyseRoute, GendarmerieMap.jsx). */
    onClose();
    onCalculer({ route: routeNettoyee, distance: distNum, sens, categorie: categorieChoisie });
  };

  const handleEffacerFiltre = () => {
    if (onEffacer) {
      onEffacer();
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-modal-filtrer-route"
      className="fixed inset-0 z-[2600] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/20 bg-gr-navy/95 text-white shadow-2xl backdrop-blur-xl p-6 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* En-tête */}
        <div className="flex items-center justify-between pb-3.5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-gr-gold/20 text-gr-gold border border-gr-gold/30 shrink-0">
              <IconRoute size={20} />
            </span>
            <div>
              <h3 id="titre-modal-filtrer-route" className="text-[16px] font-bold tracking-tight text-white flex items-center gap-2">
                Filtration des barrages par route
              </h3>
              <p className="text-[11.5px] text-white/60">
                Isoler un axe routier sur la carte et afficher uniquement ses barrages et conflits
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la modale"
            className="grid size-8 place-items-center rounded-xl text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Badge d'état du filtre actif actuel */}
        {filtreActif && (
          <div className="flex items-center justify-between rounded-xl border border-gr-gold/30 bg-gr-gold/10 px-3.5 py-2 text-[12px] text-gr-gold">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-gr-gold animate-pulse" />
              <span>Axe actuellement isolé sur la carte : <strong>{filtreActif}</strong></span>
            </div>
            <button
              type="button"
              onClick={handleEffacerFiltre}
              className="text-[11px] underline hover:text-white transition-colors"
            >
              Réinitialiser
            </button>
          </div>
        )}

        {/* Message d'erreur de validation */}
        {erreur && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/15 p-3 text-[12px] text-red-200 flex items-start gap-2.5">
            <span className="shrink-0 font-bold">⚠️</span>
            <span>{erreur}</span>
          </div>
        )}

        {/* Formulaire à deux niveaux de sélection */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* SÉLECTEUR 1 : Type de route */}
          <div>
            <label htmlFor="select-type-route" className="block text-[11px] font-bold text-white/80 mb-1.5 uppercase tracking-wider">
              1. Type de route (Catégorie)
            </label>
            <div className="relative">
              <select
                id="select-type-route"
                value={categorieChoisie}
                onChange={(e) => handleChangerCategorie(e.target.value)}
                disabled={enCalcul}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-[13px] font-semibold text-white focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold transition-colors disabled:opacity-50 cursor-pointer"
              >
                {CATEGORIES_ROUTES.map((cat) => (
                  <option key={cat.id} value={cat.id} className="bg-gr-navy text-white py-1">
                    {cat.libelle}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-1 text-[10.5px] text-white/45">
              Filtre les axes routiers disponibles selon leur classe administrative (Autoroutes, Nationales, Régionales, etc.).
            </p>
          </div>

          {/* SÉLECTEUR 2 : Choix de la route */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="select-nom-route" className="block text-[11px] font-bold text-white/80 uppercase tracking-wider">
                2. Axe routier ({routesFiltrees.length} disponible{routesFiltrees.length > 1 ? 's' : ''})
              </label>
              {routesFiltrees.length > 8 && (
                <span className="text-[10px] text-gr-gold/80 font-medium">
                  {rechercheTexte ? `${routesFiltrees.length} résultat(s)` : 'Recherche rapide active'}
                </span>
              )}
            </div>

            {/* Champ de recherche rapide si le catalogue est volumineux */}
            {routesDisponibles.length > 6 && (
              <div className="mb-2">
                <input
                  type="text"
                  value={rechercheTexte}
                  onChange={(e) => setRechercheTexte(e.target.value)}
                  placeholder="Filtrer un numéro de route (ex: RN1, A1, RP5006…)"
                  disabled={enCalcul}
                  className="w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11.5px] text-white placeholder-white/40 focus:border-gr-gold/70 focus:outline-none transition-colors"
                />
              </div>
            )}

            <div className="relative">
              <select
                id="select-nom-route"
                value={route}
                onChange={(e) => {
                  setRoute(e.target.value);
                  if (erreur) setErreur('');
                }}
                disabled={enCalcul}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-[13px] font-semibold text-white focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <option value="" disabled className="bg-gr-navy text-white/50">
                  -- Sélectionnez une route dans la liste --
                </option>
                {routesFiltrees.map((r) => {
                  const stat = compteursParRouteEtSens.get(r) || { total: 0, aller: 0, retour: 0 };
                  const nb = stat.total;
                  let detail = '';
                  if (nb === 0) detail = ' · (0 barrage)';
                  else if (nb === 1) detail = ' · (1 seul barrage — aucun conflit possible)';
                  else detail = ` · (${nb} barrages : ${stat.aller} aller, ${stat.retour} retour)`;

                  return (
                    <option key={r} value={r} className="bg-gr-navy text-white py-1">
                      {r}{detail}
                    </option>
                  );
                })}
              </select>
            </div>
            {statsRouteSelectionnee && statsRouteSelectionnee.total < 2 && (
              <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
                <span className="shrink-0 text-amber-400 font-bold">ℹ️</span>
                <span>
                  L'axe <strong>{route}</strong> ne possède qu'un seul barrage. Un conflit d'espacement nécessite au moins 2 barrages sur l'axe. Pour tester le calcul de distance (ex: 100 km), sélectionnez un axe comme <strong>RN1</strong> (33 barrages), <strong>RN17</strong> (25 barrages), <strong>RN8</strong> (23 barrages) ou <strong>A2</strong> (9 barrages).
                </span>
              </div>
            )}
            <p className="mt-1 text-[10.5px] text-white/45">
              Seuls les barrages situés sur cet axe et leurs conflits d'espacement seront affichés sur la carte.
            </p>
          </div>

          {/* PARAMÈTRE 3 : Seuil de distance */}
          <div>
            <label htmlFor="input-distance-route" className="block text-[11px] font-bold text-white/80 mb-1.5 uppercase tracking-wider">
              3. Distance de recherche / Seuil de conflit (km)
            </label>
            <div className="relative flex items-center">
              <input
                id="input-distance-route"
                type="number"
                min="1"
                max="500"
                step="1"
                value={distance}
                onChange={(e) => {
                  setDistance(e.target.value);
                  if (erreur) setErreur('');
                }}
                disabled={enCalcul}
                className="w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-[13px] font-semibold text-white placeholder-white/40 focus:border-gr-gold focus:outline-none focus:ring-1 focus:ring-gr-gold transition-colors disabled:opacity-50"
              />
              <span className="absolute right-3.5 text-[12px] font-bold text-white/50 pointer-events-none">
                km
              </span>
            </div>
            <p className="mt-1 text-[10.5px] text-white/45">
              Détecte les paires de barrages consécutifs dont l'espacement routier est inférieur à ce seuil (par défaut 20 km).
            </p>
          </div>

          {/* SÉLECTEUR 4 : Sens de circulation (Aller / Retour) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-bold text-white/80 uppercase tracking-wider">
                4. Sens de circulation
              </label>
              {statsRouteSelectionnee && (
                <span className="text-[10.5px] text-white/50">
                  {statsRouteSelectionnee.total} barrage(s) au total
                </span>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSens(SENS_TOUS)}
                disabled={enCalcul}
                className={`rounded-xl border p-2.5 text-center transition-all cursor-pointer ${
                  sens === SENS_TOUS
                    ? 'border-gr-gold bg-gr-gold/20 text-white font-bold ring-1 ring-gr-gold/60'
                    : 'border-white/10 bg-black/30 text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="text-[12px] font-bold">Tous les sens</div>
                <div className="text-[10px] text-white/50 mt-0.5">
                  Aller &amp; Retour {statsRouteSelectionnee ? `(${statsRouteSelectionnee.total})` : ''}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSens(SENS_ALLER)}
                disabled={enCalcul}
                className={`rounded-xl border p-2.5 text-center transition-all cursor-pointer ${
                  sens === SENS_ALLER
                    ? 'border-sky-400 bg-sky-500/20 text-sky-200 font-bold ring-1 ring-sky-400/60'
                    : 'border-white/10 bg-black/30 text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="text-[12px] font-bold flex items-center justify-center gap-1">
                  <span>Sens Aller</span>
                  <span className="text-sky-400">➔</span>
                </div>
                <div className="text-[10px] text-white/50 mt-0.5">
                  Sens 1 {statsRouteSelectionnee ? `(${statsRouteSelectionnee.aller})` : ''}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSens(SENS_RETOUR)}
                disabled={enCalcul}
                className={`rounded-xl border p-2.5 text-center transition-all cursor-pointer ${
                  sens === SENS_RETOUR
                    ? 'border-amber-400 bg-amber-500/20 text-amber-200 font-bold ring-1 ring-amber-400/60'
                    : 'border-white/10 bg-black/30 text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="text-[12px] font-bold flex items-center justify-center gap-1">
                  <span>Sens Retour</span>
                  <span className="text-amber-400">⬅</span>
                </div>
                <div className="text-[10px] text-white/50 mt-0.5">
                  Sens 2 {statsRouteSelectionnee ? `(${statsRouteSelectionnee.retour})` : ''}
                </div>
              </button>
            </div>
            <p className="mt-1 text-[10.5px] text-white/45">
              Distingue rigoureusement les barrages du sens Aller et du sens Retour sur la chaussée.
            </p>
          </div>

          {/* Boutons d'action */}
          <div className="flex items-center justify-between pt-3 border-t border-white/10">
            <div>
              {filtreActif && (
                <button
                  type="button"
                  onClick={handleEffacerFiltre}
                  disabled={enCalcul}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2 text-[12px] font-semibold text-red-300 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Désactiver le filtre
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={enCalcul}
                className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={enCalcul || !route}
                className="flex items-center gap-2 rounded-xl bg-gr-gold px-6 py-2.5 text-[12.5px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {enCalcul ? (
                  <>
                    <IconSpinner size={15} className="animate-spin" />
                    <span>Calcul en cours…</span>
                  </>
                ) : (
                  <span>Calculer</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
