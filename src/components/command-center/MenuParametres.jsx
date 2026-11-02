import { useCallback, useRef, useState } from 'react';
import { IconReglages, IconCoche } from '../../icons.jsx';
import PanneauDeroulant from './PanneauDeroulant.jsx';
import {
  PALETTES, MODES, DESCRIPTIONS_PALETTES, LIBELLES_MODES, resoudreApparence, MOUVEMENTS, LIBELLES_MOUVEMENTS, mouvementReduitSysteme,
} from '../../theme.js';

/**
 * PARAMÈTRES → APPARENCE — palette, mode et animations du compte connecté.
 *
 * Deux groupes radio indépendants, au clavier comme à la souris (flèches pour
 * se déplacer dans un groupe) : la palette (quatre cartes avec aperçu dans le
 * mode courant), le mode (Clair / Sombre / Système) et les animations
 * (Système — le réglage du poste, Windows « Effets d'animation » — / Activées /
 * Réduites). Le choix s'applique
 * aussitôt, en fondu (voir `.gr-transition-theme`), et est enregistré dans le
 * compte : il revient à la prochaine connexion, sans rien changer pour les
 * autres comptes.
 */
function GroupeRadio({ valeurs, valeur, onChoisir, libelle, className, children }) {
  const auClavier = (e) => {
    const i = valeurs.indexOf(valeur);
    const pas = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!pas) return;
    e.preventDefault();
    const suivant = valeurs[(i + pas + valeurs.length) % valeurs.length];
    onChoisir(suivant);
    /* Le focus suit la sélection, comme dans un groupe radio natif. */
    requestAnimationFrame(() => e.currentTarget?.querySelector(`[data-valeur="${suivant}"]`)?.focus());
  };
  return (
    <div role="radiogroup" aria-label={libelle} onKeyDown={auClavier} className={className}>
      {children}
    </div>
  );
}

export default function MenuParametres({ apparence, onChoisir }) {
  const racine = useRef(null);
  const [ouvert, setOuvert] = useState(false);
  const fermer = useCallback(() => setOuvert(false), []);
  const modeVu = resoudreApparence(apparence).mode;
  const mouvement = MOUVEMENTS.includes(apparence.mouvement) ? apparence.mouvement : 'systeme';

  return (
    <div ref={racine} className="relative">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label="Paramètres"
        title="Paramètres"
        className={`gr-bouton grid size-8 shrink-0 place-items-center rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
          ouvert
            ? 'border-gr-primary/50 bg-gr-primary/12 text-gr-primary'
            : 'border-border-default bg-gr-card text-text-secondary hover:bg-gr-hover hover:text-text-primary'
        }`}
      >
        <IconReglages size={15} className={`transition-transform duration-300 ease-out motion-reduce:transition-none ${ouvert ? 'rotate-45' : ''}`} />
      </button>

      <PanneauDeroulant ouvert={ouvert} ancre={racine} onFermer={fermer} largeur={360} label="Paramètres">
        <div className="border-b border-border-default px-4 py-3">
          <p className="text-[13px] font-bold text-text-primary">Paramètres</p>
          <p className="text-[11px] text-text-secondary">Préférences de votre compte — elles ne changent rien pour les autres utilisateurs.</p>
        </div>
        <section aria-labelledby="titre-apparence" className="space-y-3 px-4 py-3">
          <h3 id="titre-apparence" className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-muted">
            Apparence
          </h3>

          <div>
            <p id="titre-mode" className="mb-1.5 text-[11px] font-semibold text-text-secondary">Mode</p>
            <GroupeRadio
              valeurs={MODES}
              valeur={apparence.mode}
              onChoisir={(mode) => onChoisir({ mode })}
              libelle="Mode d’affichage"
              className="gr-segments relative grid grid-cols-3 rounded-xl border border-border-default bg-gr-card p-0.5"
            >
              {/* Indicateur glissant : se déplace par transform, sans recalcul de mise en page. */}
              <span
                aria-hidden="true"
                className="gr-segments-indicateur absolute inset-y-0.5 left-0.5 rounded-lg bg-gr-panel shadow-panel"
                style={{ width: 'calc((100% - 4px) / 3)', transform: `translateX(${MODES.indexOf(apparence.mode) * 100}%)` }}
              />
              {MODES.map((m) => {
                const choisi = m === apparence.mode;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    data-valeur={m}
                    aria-checked={choisi}
                    tabIndex={choisi ? 0 : -1}
                    onClick={() => onChoisir({ mode: m })}
                    className={`gr-bouton relative z-10 rounded-lg py-1.5 text-[11.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary ${
                      choisi ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {LIBELLES_MODES[m]}
                  </button>
                );
              })}
            </GroupeRadio>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-text-secondary">Animations</p>
            <GroupeRadio
              valeurs={MOUVEMENTS}
              valeur={mouvement}
              onChoisir={(m) => onChoisir({ mouvement: m })}
              libelle="Animations de l’interface"
              className="gr-segments relative grid grid-cols-3 rounded-xl border border-border-default bg-gr-card p-0.5"
            >
              <span
                aria-hidden="true"
                className="gr-segments-indicateur absolute inset-y-0.5 left-0.5 rounded-lg bg-gr-panel shadow-panel"
                style={{ width: 'calc((100% - 4px) / 3)', transform: `translateX(${MOUVEMENTS.indexOf(mouvement) * 100}%)` }}
              />
              {MOUVEMENTS.map((m) => {
                const choisi = m === mouvement;
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    data-valeur={m}
                    aria-checked={choisi}
                    tabIndex={choisi ? 0 : -1}
                    onClick={() => onChoisir({ mouvement: m })}
                    className={`gr-bouton relative z-10 rounded-lg py-1.5 text-[11.5px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gr-primary ${
                      choisi ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {LIBELLES_MOUVEMENTS[m]}
                  </button>
                );
              })}
            </GroupeRadio>
            {mouvement === 'systeme' && (
              <p className="mt-1 text-[10.5px] text-text-muted">
                {mouvementReduitSysteme()
                  ? 'Le poste demande moins d’animation (Windows : Effets d’animation désactivés) — choisissez « Activées » pour les voir.'
                  : 'Suit le réglage du poste (Windows : Effets d’animation).'}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold text-text-secondary">Palette</p>
            <GroupeRadio
              valeurs={PALETTES}
              valeur={apparence.palette}
              onChoisir={(palette) => onChoisir({ palette })}
              libelle="Palette"
              className="space-y-2"
            >
              {PALETTES.map((id) => {
                const d = DESCRIPTIONS_PALETTES[id];
                const ap = d.apercu[modeVu];
                const choisi = id === apparence.palette;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    data-valeur={id}
                    aria-checked={choisi}
                    tabIndex={choisi ? 0 : -1}
                    onClick={() => onChoisir({ palette: id })}
                    className={`gr-bouton flex w-full items-center gap-3 rounded-xl border p-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary ${
                      choisi
                        ? 'border-gr-primary bg-gr-primary/10'
                        : 'border-border-default bg-gr-card hover:border-border-strong hover:bg-gr-hover'
                    }`}
                  >
                    {/* Aperçu dans le mode affiché : fond, panneau, interaction, encre. */}
                    <span
                      aria-hidden="true"
                      className="grid h-11 w-16 shrink-0 grid-cols-[1fr_1.4fr] overflow-hidden rounded-lg border border-border-default"
                      style={{ background: ap[0] }}
                    >
                      <span style={{ background: ap[1] }} />
                      <span className="flex flex-col justify-center gap-1 px-1.5">
                        <span className="h-1 w-full rounded-full" style={{ background: ap[3], opacity: 0.85 }} />
                        <span className="h-1 w-2/3 rounded-full" style={{ background: ap[3], opacity: 0.45 }} />
                        <span className="h-1.5 w-1/2 rounded-full" style={{ background: ap[2] }} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-text-primary">{d.nom}</span>
                      <span className="block text-[11px] leading-snug text-text-secondary">{d.resume}</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200 ${
                        choisi ? 'border-gr-primary bg-gr-primary text-gr-primary-contrast' : 'border-border-strong'
                      }`}
                    >
                      {choisi && <IconCoche size={12} className="gr-coche-apparait" />}
                    </span>
                  </button>
                );
              })}
            </GroupeRadio>
          </div>
        </section>
      </PanneauDeroulant>
    </div>
  );
}
