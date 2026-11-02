/**
 * Sélecteur d'unité avec recherche INTÉGRÉE.
 *
 * Un `<select>` natif ne peut pas contenir de champ de saisie : sa liste est
 * dessinée par le système, pas par la page. Chercher parmi 504 brigades
 * imposait donc soit de tout dérouler, soit de placer un filtre à côté du
 * sélecteur — deux champs pour une seule décision. Ce composant réunit les
 * deux : on ouvre, on tape, on choisit.
 *
 * La liste s'ouvre DANS LE FLUX plutôt qu'en surimpression : le panneau
 * d'administration défile (`overflow-y-auto`), et une liste positionnée en
 * absolu s'y ferait couper au bord du conteneur.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { sansAccent } from './texte.js';

/* Réexporté : `sansAccent` était défini ici, et des appelants l'importaient
   de ce module. La définition vit maintenant dans `texte.js`, seule copie. */
export { sansAccent };
import { IconClose, IconTarget } from './icons.jsx';


/** Les régions arrivent en chaînes, les compagnies et brigades en objets. */
export const nomDe = (u) => (typeof u === 'string' ? u : (u?.nom ?? ''));

/**
 * Unités retenues par la recherche.
 *
 * Le filtre porte sur le nom ET sur le rattachement (compagnie, région) :
 * taper « tanger » en mode Brigade fait apparaître les brigades de la
 * compagnie Tanger — c'est ainsi qu'un chef cherche la sienne, il connaît son
 * rattachement mieux que l'orthographe exacte de sa brigade.
 */
export function filtrerUnites(options, q) {
  const req = sansAccent(q).trim();
  if (!req) return options;
  return options.filter((u) =>
    typeof u === 'string'
      ? sansAccent(u).includes(req)
      : sansAccent(u.nom).includes(req) ||
        sansAccent(u.cie).includes(req) ||
        sansAccent(u.reg).includes(req)
  );
}

/**
 * Regroupe par rattachement, chaque groupe trié par nom. `grouperPar` à
 * `null` renvoie un groupe unique sans intitulé (cas des régions, qui n'ont
 * pas de parent).
 * @returns {Array<[string|null, string[]]>}
 */
export function grouperUnites(unitesFiltrees, grouperPar) {
  if (!grouperPar) {
    return [[null, unitesFiltrees.map(nomDe).sort((a, b) => a.localeCompare(b, 'fr'))]];
  }
  const m = new Map();
  for (const u of unitesFiltrees) {
    const parent = u?.[grouperPar] ?? '—';
    if (!m.has(parent)) m.set(parent, []);
    m.get(parent).push(nomDe(u));
  }
  return [...m.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr'))
    .map(([p, noms]) => [p, noms.sort((a, b) => a.localeCompare(b, 'fr'))]);
}

export default function UniteSelect({
  options = [],
  value,
  onChange,
  /** Champ de rattachement servant d'intitulé de groupe : 'reg', 'cie' ou null. */
  grouperPar = null,
  placeholder = '— Sélectionner —',
  placeholderRecherche = 'Rechercher…',
  /** Taille de police de base, pour suivre le réglage d'accessibilité du portail. */
  fs = 13,
  id,
}) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const [survol, setSurvol] = useState(0); // index actif au clavier
  const boite = useRef(null);
  const champ = useRef(null);

  /* Fermer au clic extérieur : sans cela la liste reste ouverte derrière le
     reste du formulaire et masque les champs suivants. */
  useEffect(() => {
    if (!ouvert) return;
    const dehors = (e) => {
      if (boite.current && !boite.current.contains(e.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  /* Le curseur va dans la recherche dès l'ouverture : on ouvre pour taper. */
  useEffect(() => {
    if (ouvert) champ.current?.focus();
  }, [ouvert]);

  const filtrees = useMemo(() => filtrerUnites(options, q), [options, q]);
  const groupes = useMemo(() => grouperUnites(filtrees, grouperPar), [filtrees, grouperPar]);

  const plat = useMemo(() => groupes.flatMap(([, noms]) => noms), [groupes]);

  /* La position au clavier ne doit pas survivre au changement de filtre :
     l'index 3 d'une liste de 40 ne désigne pas la même unité dans une liste
     de 2 résultats. */
  useEffect(() => setSurvol(0), [q, options]);

  const choisir = (nom) => {
    onChange(nom);
    setOuvert(false);
    setQ('');
  };

  const auClavier = (e) => {
    if (e.key === 'Escape') { setOuvert(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSurvol((i) => Math.min(i + 1, plat.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSurvol((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (plat[survol]) choisir(plat[survol]);
    }
  };

  const cadre =
    'w-full rounded-lg border border-white/10 bg-white/5 text-white transition-colors duration-150 ' +
    'focus:border-gr-gold/70 focus:outline-none';

  return (
    <div ref={boite} className="relative">
      {/* ── Champ fermé : ce qui est choisi, ou l'invite ── */}
      <button
        id={id}
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        className={`${cadre} flex items-center gap-2 text-left hover:border-white/20`}
        style={{ fontSize: fs, padding: `${Math.round(fs * 0.6)}px ${Math.round(fs * 0.9)}px` }}
      >
        <span className={`min-w-0 flex-1 truncate ${value ? 'text-white' : 'text-white/35'}`}>
          {value || placeholder}
        </span>
        {value ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Effacer la sélection"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="shrink-0 rounded p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
          >
            <IconClose size={Math.round(fs * 0.95)} />
          </span>
        ) : (
          <span aria-hidden className="shrink-0 text-white/30" style={{ fontSize: fs * 0.7 }}>▼</span>
        )}
      </button>

      {/* ── Liste ouverte : la recherche est DANS la liste ── */}
      {ouvert && (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-gr-gold/25 bg-gr-deep shadow-panel">
          <div className="relative border-b border-white/10">
            <span
              aria-hidden
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gr-gold/60"
            >
              <IconTarget size={Math.round(fs * 1.05)} />
            </span>
            <input
              ref={champ}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={auClavier}
              placeholder={placeholderRecherche}
              aria-label={placeholderRecherche}
              autoComplete="off"
              className="w-full bg-transparent text-white placeholder:text-white/30 focus:outline-none"
              style={{
                fontSize: fs,
                padding: `${Math.round(fs * 0.6)}px ${Math.round(fs * 2.6)}px ${Math.round(fs * 0.6)}px ${Math.round(fs * 2.1)}px`,
              }}
            />
            <span
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono tabular-nums text-white/35"
              style={{ fontSize: fs * 0.75 }}
            >
              {plat.length}
            </span>
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto overscroll-contain py-1">
            {plat.length === 0 ? (
              <li className="px-3 py-3 text-center text-white/40" style={{ fontSize: fs * 0.88 }}>
                Aucune unité ne correspond
              </li>
            ) : (
              groupes.map(([parent, noms]) =>
                noms.length === 0 ? null : (
                  <li key={parent ?? '_'}>
                    {parent && (
                      <div
                        className="sticky top-0 bg-gr-deep px-3 pb-1 pt-2 font-bold uppercase tracking-wider text-gr-gold/70"
                        style={{ fontSize: fs * 0.7 }}
                      >
                        {parent}
                      </div>
                    )}
                    <ul>
                      {noms.map((nom) => {
                        const idx = plat.indexOf(nom);
                        const actif = idx === survol;
                        const choisi = nom === value;
                        return (
                          <li key={nom}>
                            <button
                              type="button"
                              role="option"
                              aria-selected={choisi}
                              onMouseEnter={() => setSurvol(idx)}
                              onClick={() => choisir(nom)}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-100 ${
                                actif ? 'bg-white/10 text-white' : 'text-white/75 hover:bg-white/6'
                              }`}
                              style={{ fontSize: fs * 0.95 }}
                            >
                              <span className="min-w-0 flex-1 truncate">{nom}</span>
                              {choisi && (
                                <span className="shrink-0 text-gr-gold" style={{ fontSize: fs * 0.8 }}>✓</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                )
              )
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
