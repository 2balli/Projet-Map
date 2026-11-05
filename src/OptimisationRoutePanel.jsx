import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as API from './api.js';
import { avecRadar } from './radarCalcul.js';
import { IconAlert, IconClose, IconRoute, IconSpinner, IconCible } from './icons.jsx';
import { COULEURS_ROUTES } from './components/map/FondCarteVectoriel.jsx';

/**
 * FILTRATION PAR ROUTE OU PAR TRAJET — Superadmin.
 *
 * Deux façons de désigner la route :
 *
 *   ROUTE COMPLÈTE      une route numérotée du réseau (RN1, A2…), cherchée par
 *                       son numéro ou désignée d'un clic sur la carte ;
 *   TRAJET PERSONNALISÉ deux localités, un itinéraire calculé sur le graphe
 *                       routier hors ligne, et ses variantes quand il y en a.
 *
 * La filtration rend les barrages SUR cette route — à moins de 150 m du tracé
 * ET enregistrés sur elle (serveur : `appartenanceRoute`) — jamais ceux des
 * routes voisines, et leurs conflits par faction. Elle n'écrit rien : le
 * Super Admin ne modifie plus les barrages, il les ASSIGNE au CMND Région qui
 * les porte (« Assigner au CMND Région »), et c'est le commandement qui traite.
 *
 * L'écran ne calcule rien lui-même : tracés, barrages, positions viennent du
 * serveur. Il publie ce qu'il faut dessiner (`onVue`), voir
 * components/map/CoucheOptimisationRoute.jsx.
 */
const CLASSES = {
  autoroute: { nom: 'Autoroute', cle: 'A' },
  nationale: { nom: 'Nationale', cle: 'RN' },
  regionale: { nom: 'Régionale', cle: 'RR' },
  provinciale: { nom: 'Provinciale', cle: 'RP' },
  autre: { nom: 'Autre', cle: 'RP' },
};
const fmtKm = (km) => (km == null ? '—' : `${Number(km).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);
const fmtMin = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
};
const normaliser = (s) => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');

function Badge({ classe }) {
  const c = CLASSES[classe] ?? CLASSES.autre;
  return (
    <span
      className="inline-block rounded px-1.5 py-px font-mono text-[9.5px] font-bold text-white"
      style={{ backgroundColor: COULEURS_ROUTES[c.cle] }}
    >
      {c.nom}
    </span>
  );
}

function Bloc({ titre, children, droite = null }) {
  return (
    <section className="space-y-1.5 border-t border-white/10 pt-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-gr-gold/85">{titre}</h3>
        {droite}
      </div>
      {children}
    </section>
  );
}

const bouton = 'rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';
const champ = 'w-full rounded-lg border border-white/15 bg-white/6 px-2.5 py-1.5 text-[12.5px] text-white placeholder:text-white/35 focus:border-gr-gold/70 focus:outline-none';

const OptimisationRoutePanel = forwardRef(function OptimisationRoutePanel(
  {
    open,
    onClose,
    factions,
    onVue,
    onStatut,
    items = [],
    traitement = null,
    onOuvrirBarrage,
    onAssigner,
    onAssignerConflit,
    peutCreer = false,
    onCreerBarrage,
    estAdmin,
    session,
  },
  ref,
) {
  const [mode, setMode] = useState('route');
  const [catalogue, setCatalogue] = useState(null);
  const [villes, setVilles] = useState([]);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(null); // libellé de l'opération en cours

  const [recherche, setRecherche] = useState('');
  const [categorieRoute, setCategorieRoute] = useState('nationale');
  const [route, setRoute] = useState(null); // tracé renvoyé par le serveur
  const [depart, setDepart] = useState('');
  const [arrivee, setArrivee] = useState('');
  const [trajet, setTrajet] = useState(null);
  const [variante, setVariante] = useState(1);
  /* La faction ne fait que FILTRER la liste des barrages de la route. */
  const [factionId, setFactionId] = useState('toutes');
  const [recentrage, setRecentrage] = useState(0);
  const [choix, setChoix] = useState(null); // 'route' | 'depart' | 'arrivee' : clic carte attendu

  const [perimetre, setPerimetre] = useState(null);

  /* Le catalogue et les localités, une fois, à la première ouverture. */
  useEffect(() => {
    if (!open || catalogue) return;
    let vivant = true;
    Promise.all([API.listerRoutes(), API.villesRoutes()])
      .then(([c, v]) => {
        if (!vivant) return;
        setCatalogue(c);
        setVilles(v.villes ?? []);
      })
      .catch((e) => vivant && setErreur(e.message));
    return () => {
      vivant = false;
    };
  }, [open, catalogue]);

  /**
   * LA ROUTE OU LE TRAJET, tel que le serveur le comprend — `null` tant que
   * rien n'est choisi. Pas de largeur à régler : un barrage est sur la route
   * ou ne l'est pas (tolérance fixe de 150 m et route du poste, côté serveur).
   */
  /* DEUX PARAMÈTRES DISTINCTS : la distance d'un barrage à la route (qui dit
     s'il en fait partie) et l'écart maximal entre barrages consécutifs. */
  const [toleranceM, setToleranceM] = useState(150);
  const toleranceValide = toleranceM >= 50 && toleranceM <= 500;
  const corridor = useMemo(() => {
    if (!toleranceValide) return null;
    if (mode === 'route' && route) return { type: 'route', ref: route.ref, toleranceM };
    if (mode === 'trajet' && trajet) return { type: 'trajet', trajetId: trajet.trajetId, variante, toleranceM };
    return null;
  }, [mode, route, trajet, variante, toleranceM, toleranceValide]);

  /**
   * L'ESPACEMENT LE LONG DE LA ROUTE — écart maximal entre barrages
   * consécutifs, saisi librement (2, 5, 10 km…). Mesuré PAR LA ROUTE côté
   * serveur ; lecture seule. Le résultat se périme dès que la route, la
   * tolérance, la faction ou le maximum changent.
   */
  const [maxKm, setMaxKm] = useState('10');
  const [espacement, setEspacement] = useState(null);
  const [confirmerCreation, setConfirmerCreation] = useState(null);
  const maxValide = Number(maxKm) >= 0.1 && Number(maxKm) <= 500;

  /* LES BARRAGES DE LA ROUTE — relus quand la route, le filtre de faction ou un
     traitement (assignation…) change. */
  useEffect(() => {
    if (!corridor) {
      setPerimetre(null);
      return undefined;
    }
    let vivant = true;
    const t = setTimeout(() => {
      /* Optimisation des barrages de la route : le radar de la carte la suit. */
      avecRadar('Optimisation des barrages de la route', () => API.perimetreCorridor({ corridor, factionId }))
        .then((p) => vivant && (setPerimetre(p), setErreur(null)))
        .catch((e) => vivant && (setPerimetre(null), setErreur(e.message)));
    }, 250);
    return () => {
      vivant = false;
      clearTimeout(t);
    };
  }, [corridor, factionId, traitement?.n]);

  const executer = async (libelle, fn) => {
    setOccupe(libelle);
    setErreur(null);
    try {
      return await fn();
    } catch (e) {
      setErreur(e.message);
      return null;
    } finally {
      setOccupe(null);
    }
  };

  const choisirRoute = useCallback(async (ref) => {
    setChoix(null);
    setRecherche(ref);
    const t = await executer(`Tracé de la ${ref}…`, () => API.traceRoute(ref));
    if (t) {
      setRoute(t);
      if (t.classe) setCategorieRoute(t.classe);
    }
  }, []);

  const calculer = async (d = depart, a = arrivee) => {
    if (!d || !a) return;
    setTrajet(null);
    const t = await executer('Calcul de l’itinéraire…', () => avecRadar('Calcul de l’itinéraire', () => API.calculerTrajet(d, a)));
    if (t) {
      setTrajet(t);
      setVariante(1);
    }
  };

  /* La localité la plus proche d'un clic : départ ou arrivée choisis sur la carte. */
  const localiteProche = (lng, lat) => {
    let best = null;
    for (const v of villes) {
      const d = (v.lng - lng) ** 2 * Math.cos((lat * Math.PI) / 180) ** 2 + (v.lat - lat) ** 2;
      if (!best || d < best.d) best = { nom: v.nom, d };
    }
    return best?.nom ?? null;
  };

  const surPoint = useCallback(async (lng, lat) => {
    if (choix === 'route') {
      const r = await executer('Recherche de la route…', () => API.routeAuPoint(lng, lat));
      if (r?.ref) choisirRoute(r.ref);
      else setChoix(null);
      return;
    }
    const nom = localiteProche(lng, lat);
    setChoix(null);
    if (!nom) return;
    if (choix === 'depart') {
      setDepart(nom);
      if (arrivee && arrivee !== nom) calculer(nom, arrivee);
    } else if (choix === 'arrivee') {
      setArrivee(nom);
      if (depart && depart !== nom) calculer(depart, nom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choix, villes, depart, arrivee, choisirRoute]);

  useEffect(() => {
    setEspacement(null);
    setConfirmerCreation(null);
  }, [corridor, maxKm, factionId]);

  const analyserEspacement = async () => {
    if (!corridor || !maxValide) return;
    setConfirmerCreation(null);
    const r = await executer('Mesure des écarts le long de la route…', () =>
      avecRadar('Mesure des écarts le long de la route', () => API.espacementRoute({ corridor, maxKm: Number(maxKm), factionId })));
    if (r) setEspacement(r);
  };

  /* Créer un barrage à une position proposée : second clic de confirmation. */
  const creer = async (p, t) => {
    const cle = `${p.lng}|${p.lat}`;
    if (confirmerCreation !== cle) {
      setConfirmerCreation(cle);
      return;
    }
    setConfirmerCreation(null);
    const ok = await executer('Pose du barrage…', () => onCreerBarrage?.({
      lng: p.lng, lat: p.lat, route: mode === 'route' ? route?.ref : '',
      nom: `Barrage ${t.a.nom} – ${t.b.nom}`,
    }));
    if (ok) analyserEspacement();
  };

  const reinitialiser = useCallback(() => {
    setRoute(null);
    setRecherche('');
    setTrajet(null);
    setDepart('');
    setArrivee('');
    setPerimetre(null);
    setChoix(null);
    setErreur(null);
    setConflitVise(null);
  }, []);
  useImperativeHandle(ref, () => ({ reinitialiser }), [reinitialiser]);

  /* ---------- Les conflits du corridor, faction par faction ---------- */
  /**
   * TOUS les conflits du corridor, toutes factions confondues, chacun avec sa
   * faction (serveur/conflitsFaction.mjs) : la liste latérale les filtre.
   * Chargés en entier quand le corridor change ; ensuite, seules les paires
   * touchant un barrage traité (effacé, déplacé, changé de faction) ou modifié
   * dans le dépôt sont remesurées — les autres résultats restent.
   */
  const CONFLITS_VIDES = { etat: 'vide', liste: [], sansFaction: [], seuilKm: null, regle: null, erreur: null };
  const [conflits, setConflits] = useState(CONFLITS_VIDES);
  const [rechargement, setRechargement] = useState(0);
  const [filtreConflits, setFiltreConflits] = useState('toutes');
  const [conflitVise, setConflitVise] = useState(null);
  const [traces, setTraces] = useState({});
  const etatConflits = useRef('vide');
  etatConflits.current = conflits.etat;

  useEffect(() => {
    setConflitVise(null);
    setTraces({});
    if (!corridor) {
      setConflits(CONFLITS_VIDES);
      return undefined;
    }
    let vivant = true;
    setConflits((c) => ({ ...c, etat: 'chargement', erreur: null }));
    const t = setTimeout(() => {
      avecRadar('Conflits de la route', () => API.conflitsCorridor({ corridor }))
        .then((r) => vivant && setConflits({
          etat: 'pret', liste: r.conflits, sansFaction: r.sansFaction, seuilKm: r.seuilKm, regle: r.regle, erreur: null,
        }))
        .catch((e) => vivant && setConflits((c) => ({ ...c, etat: 'erreur', erreur: e.message })));
    }, 300);
    return () => {
      vivant = false;
      clearTimeout(t);
    };
    // CONFLITS_VIDES est une constante de forme : seul le corridor compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corridor, rechargement]);

  const rafraichirConflits = useCallback(async (ids) => {
    if (!corridor || !ids?.length || etatConflits.current !== 'pret') return;
    try {
      const r = await API.conflitsCorridor({ corridor, ids });
      const touche = (c) => ids.includes(c.a.id) || ids.includes(c.b.id);
      setConflits((c) => (c.etat !== 'pret' ? c : {
        ...c,
        liste: [...c.liste.filter((x) => !touche(x)), ...r.conflits].sort((x, y) => x.km - y.km || x.cle.localeCompare(y.cle)),
        sansFaction: [...c.sansFaction.filter((b) => !ids.includes(b.id)), ...r.sansFaction],
      }));
      setTraces((t) => Object.fromEntries(Object.entries(t).filter(([cle]) => !ids.some((id) => cle.split('|').includes(id)))));
    } catch (e) {
      setConflits((c) => ({ ...c, etat: 'erreur', erreur: e.message }));
    }
  }, [corridor]);

  /* Un geste « Traiter » : ses barrages, même si le serveur l'a mis en validation. */
  const dernierTraitement = useRef(null);
  useEffect(() => {
    if (!traitement || dernierTraitement.current === traitement.n) return;
    dernierTraitement.current = traitement.n;
    rafraichirConflits(traitement.ids);
  }, [traitement, rafraichirConflits]);

  /* Le dépôt a changé (validation acceptée, optimisation appliquée, autre
     poste de travail…) : on remesure les barrages dont la fiche a bougé. */
  const signatures = useRef(null);
  useEffect(() => {
    const sig = new Map();
    for (const m of items) {
      if (m.type !== 'barrage_fixe') continue;
      sig.set(m.id, [m.lng, m.lat, m.factionId, m.statutBarrage, m.decisionOptimisation, m.debut, m.fin, m.protection, m.intouchable].join('|'));
    }
    const avant = signatures.current;
    signatures.current = sig;
    if (!avant || etatConflits.current !== 'pret') return;
    const ids = [...sig].filter(([id, v]) => avant.get(id) !== v).map(([id]) => id)
      .concat([...avant.keys()].filter((id) => !sig.has(id)));
    if (!ids.length) return;
    if (ids.length > 60) setRechargement((n) => n + 1);
    else rafraichirConflits(ids);
  }, [items, rafraichirConflits]);

  const conflitsAffiches = useMemo(() => {
    const l = filtreConflits === 'toutes' ? conflits.liste : conflits.liste.filter((c) => c.factions.includes(filtreConflits));
    return l.map((c, i) => ({ ...c, rang: `C-${String(i + 1).padStart(Math.max(2, String(l.length).length), '0')}` }));
  }, [conflits.liste, filtreConflits]);

  /* Le conflit visé a disparu (traité, filtré) : on ne garde pas un fantôme. */
  useEffect(() => {
    if (conflitVise && !conflitsAffiches.some((c) => c.cle === conflitVise)) setConflitVise(null);
  }, [conflitVise, conflitsAffiches]);

  const viserConflit = useCallback((cle) => {
    setConflitVise(cle);
    const c = conflits.liste.find((x) => x.cle === cle);
    if (!c || traces[cle]) return;
    API.traceEntreBarrages(c.a.id, c.b.id)
      .then((t) => setTraces((x) => ({ ...x, [cle]: t })))
      .catch(() => setTraces((x) => ({ ...x, [cle]: 'erreur' })));
  }, [conflits.liste, traces]);

  /* Précharger les tracés réels des conflits pour que la carte et le panneau disposent de la géométrie routière */
  useEffect(() => {
    if (!conflits.liste?.length) return;
    for (const c of conflits.liste.slice(0, 15)) {
      if (!traces[c.cle]) {
        API.traceEntreBarrages(c.a.id, c.b.id)
          .then((t) => setTraces((x) => ({ ...x, [c.cle]: t })))
          .catch(() => setTraces((x) => ({ ...x, [c.cle]: 'erreur' })));
      }
    }
  }, [conflits.liste, traces]);

  const pasConflit = useCallback((sens) => {
    if (!conflitsAffiches.length) return;
    const i = conflitsAffiches.findIndex((c) => c.cle === conflitVise);
    const j = i < 0 ? 0 : (i + sens + conflitsAffiches.length) % conflitsAffiches.length;
    viserConflit(conflitsAffiches[j].cle);
  }, [conflitsAffiches, conflitVise, viserConflit]);

  const listeFactionsConflits = useMemo(
    () => (factions?.factions ?? []).map((f) => ({ id: f.id, libelle: f.nom })),
    [factions],
  );

  /* ---------- Ce que la carte dessine ---------- */
  const choisirVariante = useCallback((rang) => setVariante(rang), []);
  const vue = useMemo(() => {
    const lignes = mode === 'route'
      ? route?.lignes
      : trajet ? [trajet.variantes.find((v) => v.rang === variante)?.coords].filter(Boolean) : null;
    if (!lignes?.length && !choix) return null;
    const bbox = mode === 'route' ? route?.bbox : (() => {
      const pts = trajet?.variantes.flatMap((v) => v.coords) ?? [];
      if (!pts.length) return null;
      return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    })();
    return {
      lignes: lignes ?? [],
      corridorKm: null,
      cadrage: bbox ? { bbox, cle: `${mode}|${route?.ref ?? ''}|${trajet?.trajetId ?? ''}|${recentrage}` } : null,
      /* Le nom du tracé, posé SUR la carte : « RN1 », « Rabat → Casablanca ». */
      libelleTrace: mode === 'route' ? route?.ref ?? null : trajet ? `${trajet.depart.nom} → ${trajet.arrivee.nom}` : null,
      conflits: corridor
        ? {
            ...conflits,
            liste: conflitsAffiches,
            total: conflits.liste.length,
            filtre: filtreConflits,
            onFiltre: setFiltreConflits,
            factions: listeFactionsConflits,
            vise: conflitVise,
            trace: traces[conflitVise]?.trace ?? (Array.isArray(traces[conflitVise]) ? traces[conflitVise] : null),
            traceInfo: traces[conflitVise] && traces[conflitVise] !== 'erreur' ? traces[conflitVise] : null,
            traces,
            onViser: viserConflit,
            onFermer: () => setConflitVise(null),
            onPas: pasConflit,
            onRafraichir: () => setRechargement((n) => n + 1),
            onOuvrirBarrage,
            onAssigner: onAssignerConflit,
            onAssignerConflit,
            estAdmin: estAdmin ?? (session?.rang === 'admin'),
            session,
          }
        : null,
      variantes: mode === 'trajet' ? (trajet?.variantes ?? []).map((v) => ({ ...v, choisie: v.rang === variante })) : [],
      onChoisirVariante: choisirVariante,
      barrages: perimetre?.barrages ?? [],
      exclus: perimetre?.exclusions ?? [],
      deplacements: [],
      espacement,
      applique: false,
      choix,
      onPoint: surPoint,
    };
    // Le cadrage ne doit changer qu'avec la sélection : sa clé le porte.
  }, [mode, route, trajet, variante, corridor, perimetre, espacement, choix, surPoint, choisirVariante,
    recentrage, conflits, conflitsAffiches, filtreConflits, listeFactionsConflits, conflitVise, traces, viserConflit, pasConflit, onOuvrirBarrage, onAssignerConflit, estAdmin, session]);

  /* Cadrage stable : un nouvel objet seulement si la sélection change. */
  const cadrageRef = useRef(null);
  const vueStable = useMemo(() => {
    if (!vue) return null;
    if (vue.cadrage?.cle !== cadrageRef.current?.cle) cadrageRef.current = vue.cadrage;
    return { ...vue, cadrage: cadrageRef.current };
  }, [vue]);
  /* Conserver les paramètres et tracés sur la carte même quand la modale est fermée */
  useEffect(() => onVue?.(vueStable), [vueStable, onVue]);

  const statut = occupe ? 'optimizing' : erreur ? 'error' : corridor ? 'active' : 'idle';
  useEffect(() => onStatut?.({ statut, erreur }), [statut, erreur, onStatut]);

  /* ---------- Recherche et filtrage dans le catalogue ---------- */
  const routesFiltrees = useMemo(() => {
    if (!catalogue?.routes) return [];
    if (categorieRoute === 'toutes') return catalogue.routes;
    return catalogue.routes.filter((r) => r.classe === categorieRoute);
  }, [catalogue, categorieRoute]);

  const resultats = useMemo(() => {
    const q = normaliser(recherche);
    if (!catalogue || !q || route?.ref === recherche) return [];
    return catalogue.routes.filter((r) => normaliser(r.ref).startsWith(q)).slice(0, 12);
  }, [catalogue, recherche, route]);

  /* Gestion de la fermeture par touche Échap */
  useEffect(() => {
    if (!open) return undefined;
    const auClavier = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  }, [open, onClose]);

  if (!open) return null;

  const listeFactions = [{ id: 'toutes', libelle: 'Toutes les factions' }, ...(factions?.factions ?? []).map((f) => ({ id: f.id, libelle: f.nom }))];
  const nomFaction = (id) => factions?.factions?.find((f) => f.id === id)?.nom ?? id;
  const aAssigner = (perimetre?.barrages ?? []).filter((b) => !b.assigne && b.reg);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-optimisation-route"
      className="pointer-events-auto fixed inset-0 z-[2000] grid place-items-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="flex max-h-[min(90vh,780px)] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-border-default bg-gr-navy text-white shadow-[0_16px_50px_rgba(0,0,0,0.8)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gr-gold text-gr-navy shadow-sm">
            <IconRoute size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="titre-optimisation-route" className="text-[14px] font-bold text-text-primary">Optimisation par route</h2>
            <p className="text-[11px] text-text-secondary">Analyse du corridor routier et détection des conflits</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer l'optimisation par route"
            className="grid size-8 shrink-0 place-items-center rounded-xl text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            <IconClose size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 py-3.5">
          {/* Mode */}
          <div role="radiogroup" aria-label="Mode de sélection" className="grid grid-cols-2 gap-1 rounded-xl bg-white/6 p-1">
            {[['route', 'Route complète'], ['trajet', 'Trajet personnalisé']].map(([m, l]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => {
                  setMode(m);
                  setChoix(null);
                }}
                className={`rounded-lg py-1.5 text-[12px] font-semibold ${mode === m ? 'bg-gr-gold text-gr-navy' : 'text-white/65 hover:bg-white/8'}`}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Conflits identifiés sur la route avec métriques réelles */}
          {conflitsAffiches.length > 0 && (
            <Bloc titre={`Conflits identifiés sur la route (${conflitsAffiches.length})`}>
              <div className="space-y-2">
                <p className="text-[11px] text-white/60">
                  Barrages partageant une faction à moins de {conflits.seuilKm ?? 20} km par la route (cliquer pour visualiser sur la carte) :
                </p>
                <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                  {conflitsAffiches.map((c) => {
                    const actif = c.cle === conflitVise;
                    const trInfo = traces[c.cle] && traces[c.cle] !== 'erreur' ? traces[c.cle] : null;
                    const distanceTxt = trInfo?.km != null ? fmtKm(trInfo.km) : fmtKm(c.km);
                    const tempsTxt = trInfo?.minutes != null ? `${trInfo.minutes} min` : 'Temps estimé indisponible';
                    const routeNom = trInfo?.routes?.length ? trInfo.routes.join(', ') : (c.a.route || route?.ref || 'Route sélectionnée');
                    return (
                      <div
                        key={c.cle}
                        role="button"
                        tabIndex={0}
                        onClick={() => viserConflit(c.cle)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') viserConflit(c.cle); }}
                        className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${actif ? 'border-[#F43F5E] bg-[#F43F5E]/15' : 'border-white/10 bg-white/4 hover:bg-white/8'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-[12.5px] text-white">{c.a.nom} ↔ {c.b.nom}</span>
                          <span className="rounded bg-[#F43F5E]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-300">{c.rang}</span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded bg-black/25 p-1.5">
                            <span className="block text-[9.5px] font-bold uppercase text-white/45">Distance routière</span>
                            <span className="font-mono font-bold text-white text-[12px]">{distanceTxt}</span>
                          </div>
                          <div className="rounded bg-black/25 p-1.5">
                            <span className="block text-[9.5px] font-bold uppercase text-white/45">Temps estimé</span>
                            <span className="font-mono font-bold text-sky-300 text-[12px]">{tempsTxt}</span>
                          </div>
                        </div>
                        {actif && (
                          <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[11px] text-white/70">
                            <div><span className="text-white/45">Route :</span> <b className="text-white">{routeNom}</b></div>
                            <div><span className="text-white/45">Origine :</span> <span className="text-white">{c.a.nom}</span></div>
                            <div><span className="text-white/45">Destination :</span> <span className="text-white">{c.b.nom}</span></div>
                            <div><span className="text-white/45">Conflit :</span> <span className="text-red-300">{c.raison}</span></div>

                            {(estAdmin ?? (session?.rang === 'admin')) && onAssignerConflit && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAssignerConflit({
                                    id: c.rang || c.cle || 'C-01',
                                    cle: c.cle,
                                    numero: c.rang || c.cle,
                                    rang: c.rang,
                                    a: c.a,
                                    b: c.b,
                                    barrageAId: c.a?.id,
                                    barrageBId: c.b?.id,
                                    distanceKm: trInfo?.km != null ? trInfo.km : c.km,
                                    km: trInfo?.km != null ? trInfo.km : c.km,
                                    tempsMinutes: trInfo?.minutes != null ? trInfo.minutes : (c.km > 0 ? Math.max(1, Math.round(c.km * 1.1)) : null),
                                    seuilKm: conflits.seuilKm ?? 20,
                                    route: routeNom,
                                    factionId: c.factions?.[0],
                                    factions: c.factions ?? [],
                                    motif: c.raison,
                                    statut: c.statut,
                                    assigneA: c.assigneA,
                                  });
                                }}
                                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gr-gold px-2.5 py-1.5 text-[11.5px] font-bold text-gr-navy hover:bg-gr-gold/90 transition-colors shadow-sm"
                              >
                                ➜ {c.statut === 'assigne' || c.assigneA ? 'Réassigner au CMND Région' : 'Assigner au CMND Région'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </Bloc>
          )}

        {!catalogue && !erreur && (
          <p className="flex items-center gap-2 text-[12px] text-white/55"><IconSpinner size={13} /> Chargement du réseau routier…</p>
        )}

        {/* ---------- Mode A : route complète ---------- */}
        {catalogue && mode === 'route' && (
          <Bloc titre="Route">
            <div className="space-y-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-white/70">1. Catégorie de route</span>
                <select
                  value={categorieRoute}
                  onChange={(e) => setCategorieRoute(e.target.value)}
                  className={champ}
                  aria-label="Catégorie de route"
                >
                  <option value="nationale">Nationale (RN)</option>
                  <option value="autoroute">Autoroute (A)</option>
                  <option value="regionale">Régionale (RR)</option>
                  <option value="provinciale">Provinciale (RP)</option>
                  <option value="toutes">Toutes les catégories</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-white/70">
                  2. Choisir la route ({routesFiltrees.length})
                </span>
                <select
                  value={route?.ref || ''}
                  onChange={(e) => {
                    if (e.target.value) choisirRoute(e.target.value);
                  }}
                  className={champ}
                  aria-label="Sélectionner une route"
                >
                  <option value="">-- Choisir une route ({routesFiltrees.length}) --</option>
                  {routesFiltrees.map((r) => (
                    <option key={r.ref} value={r.ref}>
                      {r.ref} ({fmtKm(r.longueurKm)})
                    </option>
                  ))}
                </select>
              </label>

              <div className="pt-0.5">
                <span className="mb-1 block text-[10.5px] text-white/50">Ou rechercher par numéro ou sur la carte :</span>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && resultats[0]) choisirRoute(resultats[0].ref);
                      }}
                      placeholder="Numéro : RN1, A2, RR322…"
                      aria-label="Rechercher une route par son numéro"
                      className={champ}
                    />
                    {resultats.length > 0 && (
                      <ul role="listbox" className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-gr-card py-1 shadow-panel">
                        {resultats.map((r) => (
                          <li key={r.ref}>
                            <button type="button" onClick={() => choisirRoute(r.ref)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-white/10">
                              <span className="w-14 font-mono font-bold">{r.ref}</span>
                              <Badge classe={r.classe} />
                              <span className="ml-auto text-white/50">{fmtKm(r.longueurKm)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setChoix(choix === 'route' ? null : 'route')}
                    aria-pressed={choix === 'route'}
                    title="Désigner la route d’un clic sur la carte"
                    className={`${bouton} flex items-center gap-1 ${choix === 'route' ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 hover:bg-white/14'}`}
                  >
                    <IconCible size={14} /> Carte
                  </button>
                </div>
              </div>
            </div>
            {choix === 'route' && <p className="mt-1 text-[11px] text-gr-gold">Cliquez sur une route numérotée de la carte.</p>}
            {route && (
              <div className="rounded-xl bg-white/6 px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[15px] font-bold">{route.ref}</span>
                  <Badge classe={route.classe} />
                  <span className="ml-auto text-white/60">{fmtKm(route.longueurKm)} de chaussées</span>
                </div>
                <p className="mt-0.5 text-white/60">
                  {route.extremites?.map((e) => e.localite ?? `${e.lat.toFixed(2)}, ${e.lng.toFixed(2)}`).join(' → ')}
                  {' · '}{route.troncons} tronçon{route.troncons > 1 ? 's' : ''}
                </p>
                <button type="button" onClick={() => setRecentrage((n) => n + 1)} className="mt-1.5 flex items-center gap-1 text-[11.5px] font-semibold text-gr-gold hover:underline">
                  <IconCible size={12} /> Recentrer la carte sur la {route.ref}
                </button>
              </div>
            )}
          </Bloc>
        )}

        {/* ---------- Mode B : trajet personnalisé ---------- */}
        {catalogue && mode === 'trajet' && (
          <Bloc titre="Trajet">
            <datalist id="gr-localites">
              {villes.map((v) => <option key={v.nom} value={v.nom} />)}
            </datalist>
            {[['depart', 'Départ', depart, setDepart], ['arrivee', 'Arrivée', arrivee, setArrivee]].map(([cle, lib, val, set]) => (
              <div key={cle} className="flex items-center gap-1.5">
                <label className="w-14 shrink-0 text-[11px] text-white/55" htmlFor={`gr-trajet-${cle}`}>{lib}</label>
                <input id={`gr-trajet-${cle}`} list="gr-localites" value={val} onChange={(e) => set(e.target.value)} placeholder="Localité" className={champ} />
                <button
                  type="button"
                  aria-pressed={choix === cle}
                  title={`Choisir la localité de ${lib.toLowerCase()} sur la carte`}
                  onClick={() => setChoix(choix === cle ? null : cle)}
                  className={`${bouton} px-2 ${choix === cle ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 hover:bg-white/14'}`}
                >
                  <IconCible size={14} />
                </button>
              </div>
            ))}
            {(choix === 'depart' || choix === 'arrivee') && (
              <p className="text-[11px] text-gr-gold">Cliquez sur la carte : la localité la plus proche sera retenue.</p>
            )}
            <button
              type="button"
              disabled={!depart || !arrivee || depart === arrivee || !!occupe}
              onClick={() => calculer()}
              className={`${bouton} w-full bg-white/10 hover:bg-white/16`}
            >
              Calculer l’itinéraire
            </button>
            {trajet && (
              <div role="radiogroup" aria-label="Itinéraires" className="space-y-1">
                {trajet.variantes.map((v) => (
                  <button
                    key={v.rang}
                    type="button"
                    role="radio"
                    aria-checked={variante === v.rang}
                    onClick={() => setVariante(v.rang)}
                    className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] ${variante === v.rang ? 'border-gr-gold/70 bg-gr-gold/10' : 'border-white/10 hover:bg-white/6'}`}
                  >
                    <span className="font-semibold">Itinéraire {v.rang}{v.rang === 1 ? ' · le plus rapide' : ''}</span>
                    <span className="ml-auto shrink-0 text-white/65">{fmtKm(v.km)} · {fmtMin(v.minutes)}</span>
                    <span className="sr-only">par</span>
                    <span className="basis-full text-[10.5px] text-white/50">
                      par {v.routes.slice(0, 4).map((r) => r.ref).join(', ') || 'routes non numérotées'}
                    </span>
                  </button>
                ))}
                <button type="button" onClick={() => setRecentrage((n) => n + 1)} className="flex items-center gap-1 text-[11.5px] font-semibold text-gr-gold hover:underline">
                  <IconCible size={12} /> Recentrer la carte sur le trajet
                </button>
                {trajet.variantes.length === 1 && <p className="text-[10.5px] text-white/45">Aucune alternative raisonnable (≤ 1,5 × la durée, tracé différent à plus de 25 %).</p>}
              </div>
            )}
          </Bloc>
        )}

        {/* ---------- Les barrages SUR la route ---------- */}
        {perimetre && (
          <Bloc
            titre="Barrages sur la route"
            droite={<span className="text-[11px] text-white/55">{perimetre.barrages.length} barrage{perimetre.barrages.length > 1 ? 's' : ''}</span>}
          >
            <label className="flex items-center gap-2 text-[11px] text-white/55">
              Faction
              <select value={factionId} onChange={(e) => setFactionId(e.target.value)} aria-label="Filtrer par faction" className={`${champ} flex-1`}>
                {listeFactions.map((f) => <option key={f.id} value={f.id}>{f.libelle}</option>)}
              </select>
            </label>
            <p className="text-[10.5px] leading-snug text-white/45">
              Un barrage est retenu s’il est à moins de {perimetre.toleranceM} m du tracé ET enregistré sur cette route.
              Les barrages des routes voisines ne sont jamais pris.
            </p>
            {perimetre.barrages.length === 0 ? (
              <p className="text-[12px] text-white/55">Aucun barrage sur ce tracé{factionId !== 'toutes' ? ` pour la ${nomFaction(factionId)}` : ''}.</p>
            ) : (
              <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1 text-[11.5px]" aria-label="Barrages sur la route">
                {perimetre.barrages.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <span aria-hidden className="size-2 shrink-0 rounded-full border-2 border-[#06B6D4]" />
                    <button
                      type="button"
                      onClick={() => onOuvrirBarrage?.(b.id)}
                      className="min-w-0 flex-1 truncate text-left hover:text-gr-gold hover:underline"
                      title="Ouvrir la fiche du barrage"
                    >
                      {b.nom}
                    </button>
                    {b.intouchable && <span className="shrink-0 rounded bg-teal-400/15 px-1 text-[9.5px] font-bold text-teal-300">Intouchable</span>}
                    {b.assigne && <span className="shrink-0 rounded bg-sky-400/15 px-1 text-[9.5px] font-bold text-sky-300">Assigné</span>}
                    <span className="shrink-0 text-white/45">
                      {b.type === 'barrage_mobile' ? 'mobile' : 'fixe'} · {b.factions?.length ? (b.factions.length > 2 ? 'toutes factions' : b.factions.map(nomFaction).join(', ')) : 'sans faction'} · {b.route || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {perimetre.exclusions.length > 0 && (
              <details className="text-[11.5px]">
                <summary className="cursor-pointer text-white/60">Écartés : proches du tracé, mais pas sur la route ({perimetre.exclusions.length})</summary>
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pr-1">
                  {perimetre.exclusions.map((b) => (
                    <li key={b.id} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate text-white/70">{b.nom}</span>
                      <span className="shrink-0 text-white/45">{b.raison}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Bloc>
        )}

        {/* ---------- Espacement le long de la route ---------- */}
        {corridor && (
          <Bloc titre="Espacement le long de la route">
            <label className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1 text-[11.5px] text-white/70">
              <span className="col-span-3">Écart maximal entre barrages consécutifs (par la route)</span>
              <span />
              <input
                type="number"
                min={0.1}
                max={500}
                step={0.1}
                value={maxKm}
                onChange={(e) => setMaxKm(e.target.value)}
                aria-label="Écart maximal entre barrages consécutifs, en kilomètres"
                className={`${champ} w-20`}
              />
              <span>km</span>
            </label>
            <div className="flex gap-1">
              {['2', '5', '10', '20'].map((v) => (
                <button key={v} type="button" onClick={() => setMaxKm(v)} className={`rounded-md px-2 py-0.5 text-[11px] ${maxKm === v ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 hover:bg-white/14'}`}>
                  {v} km
                </button>
              ))}
            </div>
            <label className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-1 text-[11.5px] text-white/70">
              <span className="col-span-3">Distance maximale barrage ↔ route (appartenance à la route)</span>
              <span />
              <input
                type="number"
                min={50}
                max={500}
                step={10}
                value={toleranceM}
                onChange={(e) => setToleranceM(Number(e.target.value))}
                aria-label="Distance maximale entre un barrage et la route, en mètres"
                className={`${champ} w-20`}
              />
              <span>m</span>
            </label>
            {!toleranceValide && <p className="text-[11px] text-red-300">Distance à la route : entre 50 et 500 m.</p>}
            {!maxValide && <p className="text-[11px] text-red-300">Écart maximal : entre 0,1 et 500 km.</p>}
            <button type="button" disabled={!maxValide || !!occupe} onClick={analyserEspacement} className={`${bouton} w-full bg-white/10 hover:bg-white/16`}>
              Mesurer les écarts par la route
            </button>
            {espacement && (
              <div className="space-y-1.5 text-[11.5px]" aria-label="Résultat de l’espacement">
                <p className="text-white/55">
                  {espacement.ordre.length} barrage(s) rangés le long de la route ({espacement.mesure}, {fmtKm(espacement.longueurKm)}) · maximum {espacement.maxKm} km.
                </p>
                {espacement.avertissements.map((a) => (
                  <p key={a} role="alert" className="flex gap-1.5 text-gr-gold"><IconAlert size={13} className="mt-px shrink-0" /> {a}</p>
                ))}
                {espacement.troncons.length > 0 && espacement.depassements === 0 && (
                  <p className="font-semibold text-green-300">Aucun ajustement nécessaire : tous les écarts sont au plus de {espacement.maxKm} km.</p>
                )}
                {espacement.troncons.filter((t) => t.depasse).map((t) => (
                  <div key={`${t.a.id}-${t.b.id}`} className="rounded-lg border border-[#DC2626]/40 bg-[#DC2626]/10 px-2 py-1.5">
                    <p className="font-semibold">{t.a.nom} → {t.b.nom}</p>
                    <p className="text-white/75">
                      Écart de <b>{fmtKm(t.km)}</b> par la route, au-delà du maximum de <b>{espacement.maxKm} km</b> : il manque au
                      moins {t.manque} barrage{t.manque > 1 ? 's' : ''} pour le respecter.
                    </p>
                    {t.incertain && (
                      <p className="text-gr-gold">Incertain : {fmtKm(t.sautsKm)} de cet intervalle n’ont pas de géométrie réelle (raccord à vol d’oiseau).</p>
                    )}
                  </div>
                ))}
                {espacement.troncons.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-white/60">Tous les écarts ({espacement.troncons.length})</summary>
                    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-1">
                      {espacement.troncons.map((t) => (
                        <li key={`${t.a.id}-${t.b.id}`} className={`flex gap-2 ${t.depasse ? 'text-red-300' : 'text-white/65'}`}>
                          <span className="min-w-0 flex-1 truncate">{t.a.nom} → {t.b.nom}</span>
                          <span className="shrink-0">{fmtKm(t.km)}{t.incertain ? ' (incertain)' : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="text-[10.5px] text-white/45">Rien n’est déplacé ni supprimé automatiquement : les barrages existants et leurs positions restent inchangés.</p>
              </div>
            )}
          </Bloc>
        )}

        {(erreur || occupe) && (
          <p role={erreur ? 'alert' : 'status'} className={`flex items-start gap-2 text-[12px] ${erreur ? 'text-red-300' : 'text-white/60'}`}>
            {erreur ? <IconAlert size={14} className="mt-px shrink-0" /> : <IconSpinner size={13} className="mt-px shrink-0" />}
            <span>{erreur ?? occupe}</span>
          </p>
        )}
      </div>

      {/* ---------- Actions ---------- */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 bg-gr-navy">
        <button
          type="button"
          disabled={!aAssigner.length || !!occupe}
          onClick={() => onAssigner?.(aAssigner)}
          title="Remettre ces barrages au CMND Région de chacun, pour traitement"
          className={`${bouton} bg-gr-gold text-gr-navy hover:bg-gr-gold/90`}
        >
          Assigner au CMND Région{aAssigner.length ? ` (${aAssigner.length})` : ''}
        </button>
        {route && (
          <button
            type="button"
            onClick={reinitialiser}
            className={`${bouton} bg-white/8 text-white/70 hover:bg-white/14`}
          >
            Réinitialiser la sélection
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className={`${bouton} ml-auto border border-white/15 bg-white/10 text-white hover:bg-white/16`}
        >
          Fermer et revenir à la carte
        </button>
      </footer>
      </div>
    </div>
  );
});

export default OptimisationRoutePanel;
