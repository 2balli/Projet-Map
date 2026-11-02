import { useCallback, useRef, useState } from 'react';
import { IconGuide, IconChevron, IconClose } from '../../icons.jsx';
import PanneauDeroulant from './PanneauDeroulant.jsx';
import { guidePour } from '../../guideRoles.js';

/**
 * « INSTRUCTIONS » — le mode d'emploi du compte connecté, en étapes numérotées.
 *
 * Le contenu dépend du rang de la session et de lui seul (src/guideRoles.js),
 * où chaque étape renvoie à la règle du serveur qui l'autorise : le menu ne
 * promet jamais un geste que serveur/api.mjs refuserait.
 *
 * Discret : un bouton dans la barre du haut, ouvert au clic, refermé par Échap
 * ou un clic ailleurs. Sur petit écran, le libellé s'efface derrière l'icône
 * (qui le garde en `aria-label`).
 */
export default function MenuInstructions({ session, decisions = 0, onOuvrirDecisions = null }) {
  const [ouvert, setOuvert] = useState(false);
  const racine = useRef(null);
  const guide = guidePour(session);
  const fermer = useCallback(() => setOuvert(false), []);

  if (!guide) return null;

  return (
    <div className="pointer-events-auto relative">
      <button
        ref={racine}
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label="Instructions"
        title="Instructions"
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-gr-card px-2 text-[11px] font-semibold transition-colors
          hover:border-gr-gold/45 hover:bg-gr-hover hover:text-gr-gold
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
          ${ouvert ? 'border-gr-gold/45 text-gr-gold' : 'border-border-default text-text-secondary'}`}
      >
        <IconGuide size={15} />
        <span className="hidden sm:inline">Instructions</span>
        <IconChevron size={12} open={ouvert} className="hidden sm:block" />
      </button>

      <PanneauDeroulant ouvert={ouvert} ancre={racine} onFermer={fermer} largeur={420} label={`Instructions — ${guide.titre}`}>
          <header className="flex items-start gap-2 border-b border-white/10 px-3.5 py-2.5">
            <IconGuide size={15} className="mt-0.5 text-gr-gold" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[13px] font-bold leading-tight">Instructions</h2>
              <p className="text-[10.5px] uppercase tracking-[0.08em] text-text-secondary">{guide.titre}</p>
            </div>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              aria-label="Fermer les instructions"
              className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            >
              <IconClose size={14} />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-3">
            {/* Workflow opérationnel synthétique */}
            {guide.workflow && (
              <div className="rounded-xl border border-gr-gold/35 bg-gr-gold/8 p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gr-gold">Workflow d’opération</p>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11.5px] font-semibold text-white/90">
                  {guide.workflow.split('→').map((step, idx, arr) => (
                    <span key={idx} className="flex items-center gap-1">
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-gr-gold">{step.trim()}</span>
                      {idx < arr.length - 1 && <span className="text-white/40">→</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Décisions et dossiers à trancher */}
            {onOuvrirDecisions && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-white/90">Dossiers de décision</span>
                  {decisions > 0 ? (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                      {decisions} à traiter
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/45">À jour</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-white/60">
                  {decisions > 0
                    ? `${decisions} demande(s) en attente de votre examen ou validation.`
                    : 'Aucun dossier en attente de décision pour votre commandement.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    fermer();
                    onOuvrirDecisions();
                  }}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-white/16 hover:text-gr-gold"
                >
                  Consulter les décisions
                </button>
              </div>
            )}

            <p className="rounded-lg bg-white/5 px-3 py-2 text-[12px] leading-relaxed text-white/70">{guide.intro}</p>

            <ol className="space-y-2.5">
              {guide.etapes.map((e, i) => (
                <li key={e.titre} className="flex gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-gr-gold/45 bg-gr-gold/12 font-mono text-[11px] font-bold text-gr-gold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[12.5px] font-semibold leading-snug text-white/95">{e.titre}</p>
                    {e.choix && (
                      <ul className="mt-1 space-y-0.5">
                        {e.choix.map((c) => (
                          <li key={c} className="flex items-center gap-1.5 text-[12px] text-white/85">
                            <span className="size-1 rounded-full bg-gr-gold" aria-hidden="true" /> {c}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/55">{e.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>

            {guide.remarques.length > 0 && (
              <div className="space-y-1 rounded-lg border border-white/10 px-3 py-2">
                {guide.remarques.map((r) => (
                  <p key={r} className="text-[11.5px] leading-relaxed text-white/60">{r}</p>
                ))}
              </div>
            )}
          </div>
      </PanneauDeroulant>
    </div>
  );
}
