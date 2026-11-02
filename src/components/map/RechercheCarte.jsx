import { useState, useEffect, useRef, useMemo } from 'react';
import { IconLoupe, IconClose, IconTerritoire } from '../../icons.jsx';
import * as MQ from '../../marquages.js';
import { sansAccent as normaliserTexte } from '../../texte.js';
import { Recherche } from '../../../maroc-carte-offline/src/recherche.js';
import { origineFond } from './FondCarteVectoriel.jsx';

/**
 * RECHERCHE CARTOGRAPHIQUE MODERNE — Google Maps Style
 *
 * Une seule barre de recherche visible en permanence, claire et intuitive.
 * Recherche rapide et prédictive par :
 * - Villes, communes, quartiers et lieux (base cartographique offline)
 * - Nom de barrage et numéro de poste
 * - Référence de route (RN1, A1, R401, etc.)
 * - Brigade, Compagnie ou Région
 *
 * Suggestions structurées avec sélection en un clic et centrage immédiat.
 */
export function RechercheCarte({
  items = [],
  onAller,
  onCentrerLieu = null,
  onBrigade,
  onRouteSelect = null,
  masquee = false,
  integree = false,
}) {
  const [q, setQ] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [survol, setSurvol] = useState(0);
  const [indexGeo, setIndexGeo] = useState(null);
  const boite = useRef(null);
  const inputRef = useRef(null);

  // Initialisation différée de l'index des lieux cartographiques
  useEffect(() => {
    let actif = true;
    try {
      const url = `${origineFond()}/data/recherche.json`;
      const recherche = new Recherche(url);
      recherche
        .charger()
        .then((idx) => {
          if (actif) setIndexGeo(idx);
        })
        .catch((err) => {
          console.warn('Index cartographique local en attente:', err);
        });
    } catch (err) {
      console.warn('Initialisation recherche:', err);
    }
    return () => {
      actif = false;
    };
  }, []);

  // Raccourci clavier universel : Ctrl+K ou Cmd+K
  useEffect(() => {
    const auRaccourci = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOuvert(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', auRaccourci);
    return () => window.removeEventListener('keydown', auRaccourci);
  }, []);

  // Clic extérieur : fermer le menu déroulant de suggestions
  useEffect(() => {
    const dehors = (e) => {
      if (boite.current && !boite.current.contains(e.target)) {
        setOuvert(false);
      }
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, []);

  // Extraction unique des routes et des brigades pour les suggestions
  const { routesMap, brigadesMap } = useMemo(() => {
    const rMap = new Map();
    const bMap = new Map();

    for (const m of items) {
      if (!MQ.estBarrage(m)) continue;

      // Routes
      const routeNom = (m.route || m.roadName || '').trim();
      if (routeNom) {
        const cle = normaliserTexte(routeNom);
        const exist = rMap.get(cle) || { nom: routeNom, postes: 0, reg: m.reg };
        exist.postes++;
        rMap.set(cle, exist);
      }

      // Brigades
      if (m.bt) {
        const cleBt = normaliserTexte(m.bt);
        const existBt = bMap.get(cleBt) || { bt: m.bt, cie: m.cie, reg: m.reg, postes: 0 };
        existBt.postes++;
        bMap.set(cleBt, existBt);
      }
    }

    return { routesMap: [...rMap.values()], brigadesMap: [...bMap.values()] };
  }, [items]);

  // Suggestions pertinentes classées pendant la saisie
  const resultats = useMemo(() => {
    const query = normaliserTexte(q).trim();
    if (!query) return [];
    const mots = query.split(/\s+/).filter(Boolean);

    // 1. Recherche cartographique de villes, communes, régions et quartiers (style Google Maps)
    const lieuxTrouves = [];
    if (indexGeo && query.length >= 2) {
      try {
        const geoMatches = indexGeo.chercher(query, { max: 4, langue: 'fr' });
        for (const g of geoMatches) {
          lieuxTrouves.push({ type: 'lieu_geo', item: g });
        }
      } catch {
        // En cours de frappe
      }
    }

    // 2. Recherche parmi les barrages (nom, id/numéro, route, brigade)
    const barragesTrouves = [];
    for (const m of items) {
      if (!MQ.estBarrage(m)) continue;
      const nom = m.nom || m.name || '';
      const num = String(m.id || m.numero || m.code || '');
      const route = m.route || m.roadName || '';
      const bt = m.bt || '';
      const cie = m.cie || '';
      const reg = m.reg || '';
      const typeLibelle = MQ.TYPE_PAR_CLE[m.type]?.fr || '';

      const texteComplet = normaliserTexte(`${nom} ${num} ${route} ${bt} ${cie} ${reg} ${typeLibelle}`);

      if (mots.every((mot) => texteComplet.includes(mot))) {
        barragesTrouves.push({ type: 'barrage', item: m });
        if (barragesTrouves.length >= 6) break;
      }
    }

    // 3. Recherche parmi les axes routiers
    const routesTrouvees = [];
    for (const r of routesMap) {
      const texteRoute = normaliserTexte(`${r.nom} ${r.reg || ''}`);
      if (mots.every((mot) => texteRoute.includes(mot))) {
        routesTrouvees.push({ type: 'route', route: r });
        if (routesTrouvees.length >= 3) break;
      }
    }

    // 4. Recherche parmi les brigades
    const brigadesTrouvees = [];
    for (const b of brigadesMap) {
      const texteBt = normaliserTexte(`${b.bt} ${b.cie || ''} ${b.reg || ''}`);
      if (mots.every((mot) => texteBt.includes(mot))) {
        brigadesTrouvees.push({ type: 'brigade', brigade: b });
        if (brigadesTrouvees.length >= 2) break;
      }
    }

    return [...lieuxTrouves, ...barragesTrouves, ...routesTrouvees, ...brigadesTrouvees];
  }, [items, routesMap, brigadesMap, indexGeo, q]);

  useEffect(() => setSurvol(0), [q]);

  const selectionner = (res) => {
    if (!res) return;
    if (res.type === 'lieu_geo') {
      const g = res.item;
      if (onCentrerLieu) {
        onCentrerLieu([g.point[1], g.point[0]], g.zoom, g.nom);
      } else if (onAller) {
        onAller({ lat: g.point[1], lng: g.point[0], zoom: g.zoom, nom: g.nom });
      }
    } else if (res.type === 'barrage') {
      onAller?.(res.item);
    } else if (res.type === 'route') {
      onRouteSelect?.(res.route.nom);
    } else if (res.type === 'brigade') {
      onBrigade?.(res.brigade.bt);
    }
    setOuvert(false);
  };

  const auClavier = (e) => {
    if (e.key === 'Escape') {
      setOuvert(false);
      e.currentTarget.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSurvol((i) => Math.min(i + 1, resultats.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSurvol((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && resultats[survol]) {
      e.preventDefault();
      selectionner(resultats[survol]);
    }
  };

  const montrerMenu = ouvert && q.trim().length > 0;

  return (
    <div
      ref={boite}
      aria-hidden={masquee}
      className={`relative w-[260px] sm:w-[320px] md:w-[380px] transition-all duration-200 ${
        masquee ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100'
      }`}
    >
      {/* Barre de recherche unique, style Google Maps */}
      <div
        className={`group relative flex h-10 w-full items-center rounded-xl border transition-all duration-150 shadow-md backdrop-blur-md ${
          ouvert
            ? 'border-amber-500/70 bg-gr-navy/98 ring-2 ring-amber-500/20'
            : 'border-border-default bg-gr-navy/95 hover:border-white/20 hover:bg-gr-hover'
        }`}
      >
        <span className="grid size-10 place-items-center shrink-0 text-text-muted group-hover:text-amber-400 transition-colors">
          <IconLoupe size={15} />
        </span>

        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOuvert(true);
          }}
          onFocus={() => setOuvert(true)}
          onKeyDown={auClavier}
          placeholder="Rechercher une ville, commune, barrage, route..."
          aria-label="Rechercher une ville, commune, barrage, poste ou route"
          className="h-full flex-1 bg-transparent pr-7 text-[12px] font-medium text-white placeholder:text-white/40 focus:outline-none"
        />

        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              setOuvert(false);
              inputRef.current?.focus();
            }}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <IconClose size={12} />
          </button>
        )}
      </div>

      {/* Menu déroulant de suggestions prédictives */}
      {montrerMenu && (
        <div className="absolute left-0 right-0 top-[46px] z-[2200] overflow-hidden rounded-2xl border border-white/15 bg-gr-navy/98 shadow-2xl backdrop-blur-xl max-h-[380px] overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-100">
          {resultats.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-[12px] font-semibold text-white/70">Aucun résultat trouvé</p>
              <p className="text-[10px] text-white/40 mt-0.5">
                Vérifiez le nom de la ville, du barrage, du poste ou de la route.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5 p-1.5 space-y-0.5">
              {resultats.map((res, i) => {
                const estSurvol = i === survol;

                if (res.type === 'lieu_geo') {
                  const g = res.item;
                  return (
                    <li key={`geo-${g.nom}-${g.point[0]}-${g.point[1]}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setSurvol(i)}
                        onClick={() => selectionner(res)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                          estSurvol ? 'bg-amber-500/15 text-white' : 'hover:bg-white/5 text-white/80'
                        }`}
                      >
                        <span className="grid size-6 place-items-center rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold shrink-0">
                          <IconTerritoire size={13} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-bold text-white">
                              {g.nom}
                            </span>
                            {g.libelle && (
                              <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-medium border border-emerald-500/20">
                                {g.libelle}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-white/50 truncate mt-0.5 flex items-center gap-1.5">
                            {g.contexte && <span>{g.contexte}</span>}
                            {g.contexte && g.nomSecondaire && <span>•</span>}
                            {g.nomSecondaire && <span dir="rtl">{g.nomSecondaire}</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                }

                if (res.type === 'barrage') {
                  const m = res.item;
                  const typeObj = MQ.TYPE_PAR_CLE[m.type];
                  const nom = m.nom || m.name || `Poste ${m.id}`;
                  const num = m.id || m.numero || '';
                  const route = m.route || m.roadName || '';
                  const brigade = [m.bt, m.reg].filter(Boolean).join(' · ');

                  return (
                    <li key={`barrage-${m.id || i}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setSurvol(i)}
                        onClick={() => selectionner(res)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                          estSurvol ? 'bg-amber-500/15 text-white' : 'hover:bg-white/5 text-white/80'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="size-2.5 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: typeObj?.color || '#EAB308' }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-bold text-white">
                              {nom}
                            </span>
                            {num && (
                              <span className="font-mono text-[10px] text-amber-400 font-bold bg-amber-400/10 px-1 rounded border border-amber-400/20">
                                #{num}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-white/50 truncate mt-0.5 flex items-center gap-1.5">
                            {route && <span className="font-semibold text-white/70">Axe {route}</span>}
                            {route && brigade && <span>•</span>}
                            {brigade && <span>{brigade}</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                }

                if (res.type === 'route') {
                  const r = res.route;
                  return (
                    <li key={`route-${r.nom}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setSurvol(i)}
                        onClick={() => selectionner(res)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                          estSurvol ? 'bg-blue-500/15 text-white' : 'hover:bg-white/5 text-white/80'
                        }`}
                      >
                        <span className="grid size-6 place-items-center rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[10px] font-bold shrink-0">
                          Route
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-bold text-blue-200">
                            Axe {r.nom}
                          </span>
                          <span className="block truncate text-[10px] text-white/50">
                            {r.postes} barrage{r.postes > 1 ? 's' : ''} sur cet axe
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                }

                if (res.type === 'brigade') {
                  const b = res.brigade;
                  return (
                    <li key={`bt-${b.bt}`}>
                      <button
                        type="button"
                        onMouseEnter={() => setSurvol(i)}
                        onClick={() => selectionner(res)}
                        className={`flex w-full items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                          estSurvol ? 'bg-amber-500/15 text-white' : 'hover:bg-white/5 text-white/80'
                        }`}
                      >
                        <span className="grid size-6 place-items-center rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold shrink-0">
                          BT
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-bold text-white">
                            Brigade {b.bt}
                          </span>
                          <span className="block truncate text-[10px] text-white/50">
                            {b.postes} poste{b.postes > 1 ? 's' : ''} · {[b.cie, b.reg].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                }

                return null;
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default RechercheCarte;
