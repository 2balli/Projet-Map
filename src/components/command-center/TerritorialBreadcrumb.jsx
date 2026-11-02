import { IconChevron, IconTerritoire } from '../../icons.jsx';

export default function TerritorialBreadcrumb({ contexte, onNavigate }) {
  const niveaux = [
    { niveau: 'maroc', nom: 'MAROC' },
    contexte?.region && { niveau: 'region', nom: contexte.region, prefixe: 'Région' },
    contexte?.compagnie && { niveau: 'compagnie', nom: contexte.compagnie, prefixe: 'Compagnie' },
    contexte?.brigade && { niveau: 'brigade', nom: contexte.brigade, prefixe: 'Brigade' },
  ].filter(Boolean);

  return (
    <nav
      aria-label="Contexte territorial"
      className="pointer-events-auto flex max-w-[min(760px,calc(100%-2rem))] items-center overflow-hidden rounded-xl border border-border-default bg-gr-navy/95 px-1.5 py-1 shadow-panel backdrop-blur"
    >
      {niveaux.map((item, index) => (
        <span key={item.niveau} className="flex min-w-0 items-center">
          {index > 0 && <IconChevron size={11} className="mx-0.5 shrink-0 -rotate-90 text-text-muted" />}
          <button
            type="button"
            onClick={() => onNavigate(item.niveau, item.nom)}
            title={item.niveau === 'maroc' ? 'Revenir à la vue nationale' : `Cadrer ${item.prefixe?.toLowerCase()} ${item.nom}`}
            className={`flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors hover:bg-gr-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary ${index === niveaux.length - 1 ? 'text-gr-gold' : 'text-text-secondary'}`}
          >
            {item.niveau === 'maroc' && <IconTerritoire size={13} className="shrink-0" />}
            <span className="truncate">{item.prefixe ? `${item.prefixe} ${item.nom}` : item.nom}</span>
          </button>
        </span>
      ))}
    </nav>
  );
}
