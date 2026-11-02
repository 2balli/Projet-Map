import { useEffect, useRef, useState } from 'react';
import { IconChevron, IconHoraire } from '../../icons.jsx';

/**
 * FILTRE PAR FACTION — met en évidence la faction sélectionnée sur la carte.
 *
 * Le filtre Faction ne masque jamais les barrages des autres factions :
 * - Tous les barrages de toutes les factions restent visibles sur la carte.
 * - Par défaut (« Toutes les factions »), tous les barrages ont leur apparence normale.
 * - Lorsqu'une faction est sélectionnée (ex. « Faction 1 »), ses barrages sont mis en
 *   évidence (opacité 100%, lueur dorée, z-index supérieur), tandis que les barrages
 *   des autres factions restent visibles avec une apparence atténuée (opacité réduite,
 *   couleurs d'origine préservées, interactifs et cliquables).
 * - Choisir « Toutes les factions » restaure l'apparence normale de tous les postes.
 */
export default function FactionFilter({
  /** [{id, nom, debut, fin, libelle, creneau}] — définition, venue du serveur. */
  factions,
  /** 'F1'… | 'sans_faction' | 'toutes' */
  valeur,
  onChanger,
  /** Identifiant de la faction en cours, calculé par le serveur. */
  factionActuelle,
  /** Heure du serveur, « HH:MM » — pour expliquer « actuelle » plutôt que l'affirmer. */
  heureServeur,
  /** {F1: 278, …} — barrages par faction, dans le périmètre du compte. */
  compteurs,
  /** Barrages sans aucune faction ce jour-là — dit, jamais masqué. */
  sansFaction = 0,
  /** Tous les barrages du périmètre, factions confondues. */
  total = 0,
}) {
  const [ouvert, setOuvert] = useState(false);
  const conteneurRef = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => {
      if (conteneurRef.current && !conteneurRef.current.contains(e.target)) setOuvert(false);
    };
    document.addEventListener('mousedown', dehors);
    return () => document.removeEventListener('mousedown', dehors);
  }, [ouvert]);

  if (!factions?.length) return null;

  const choisie = factions.find((f) => f.id === valeur) ?? null;
  const sansAffectation = valeur === 'sans_faction';
  const toutes = valeur === 'toutes' || !valeur;
  const etiquette = toutes
    ? 'Toutes les factions'
    : sansAffectation ? 'Sans faction' : (choisie?.nom ?? 'Faction actuelle');
  const compte = toutes ? total : sansAffectation ? sansFaction : (compteurs?.[valeur] ?? 0);

  const choisir = (v) => {
    onChanger?.(v);
    setOuvert(false);
  };

  const ligne = (actif) =>
    `flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-[11px] transition-colors ${
      actif
        ? 'bg-gr-gold/15 text-gr-gold'
        : 'text-text-primary hover:bg-text-secondary/12'
    }`;

  return (
    <div ref={conteneurRef} className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-expanded={ouvert}
        aria-label="Filtrer par faction"
        className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-gr-gold/55 bg-gr-gold/15 px-3 text-[11px] font-semibold text-gr-gold shadow-panel backdrop-blur-md transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
      >
        <IconHoraire size={14} className="text-gr-gold" />
        <span className="max-w-[190px] truncate">{etiquette}</span>
        <span className="rounded-full border border-gr-gold/45 bg-gr-gold/15 px-1.5 font-mono text-[9px] font-bold text-gr-gold">
          {compte}
        </span>
        <IconChevron size={10} open={!ouvert} />
      </button>

      {ouvert && (
        /**
          * LE PANNEAU S'OUVRE VERS LE HAUT — `bottom-full`, jamais `top-full`.
          *
          * Cette barre est ancrée en BAS de la carte (voir le conteneur
          * `bottom-3` dans src/GendarmerieMap.jsx). Une liste qui descendrait
          * sortirait de l'écran et couperait les dernières factions sans
          * indication, puisque le panneau n'a pas d'ascenseur.
          *
          * C'est aussi la convention du filtre voisin (`MapFilters`), qui
          * emploie exactement `bottom-full mb-3` : deux menus côte à côte qui
          * s'ouvriraient dans des sens opposés se liraient comme un défaut.
          */
        <div className="absolute bottom-full left-0 mb-3 z-[1300] w-[290px] rounded-xl border border-border-default bg-gr-navy/98 p-1.5 shadow-2xl backdrop-blur-xl">
          <button type="button" onClick={() => choisir('toutes')} className={ligne(toutes)}>
            <span className="font-semibold">Toutes les factions</span>
            <span className="font-mono text-[10px] opacity-80">{total}</span>
          </button>
          <div className="my-1 h-px bg-text-secondary/18" />

          {factions.map((f) => (
            <button key={f.id} type="button" onClick={() => choisir(f.id)} className={ligne(valeur === f.id)}>
              <span className="min-w-0">
                <span className="block font-semibold">
                  {f.nom}
                  {f.id === factionActuelle && (
                    <span
                      title={
                        heureServeur
                          ? `Tour de service en cours à ${heureServeur}, heure du serveur`
                          : 'Tour de service en cours'
                      }
                      className="ml-1.5 rounded px-1 text-[8.5px] font-bold uppercase tracking-wider text-green-400"
                    >
                      en cours
                    </span>
                  )}
                </span>
              </span>
              <span className="font-mono text-[10px] opacity-80">{compteurs?.[f.id] ?? 0}</span>
            </button>
          ))}

          {sansFaction > 0 && (
            <>
              <div className="my-1 h-px bg-text-secondary/18" />
              <button type="button" onClick={() => choisir('sans_faction')} className={ligne(sansAffectation)}>
                <span className="font-semibold">Sans faction affectée</span>
                <span className="font-mono text-[10px] opacity-80">{sansFaction}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
