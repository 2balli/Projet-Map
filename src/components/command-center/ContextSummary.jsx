/**
 * RÉSUMÉ DU TERRITOIRE AFFICHÉ — et, après un calcul, ce qu'il a trouvé.
 *
 * Deux informations de même nature, et c'est pourquoi elles tiennent dans le
 * même cartouche : « voilà la zone que vous regardez » et « voilà ce que
 * l'optimisation y a relevé ». Les séparer obligeait à chercher les chiffres
 * ailleurs — d'abord dans un cartouche flottant, puis au fond d'un panneau —
 * alors que la question se pose ici, au moment où l'on lit le territoire.
 *
 * Les chiffres de l'optimisation n'apparaissent QUE s'il y a eu un calcul :
 * pas de lignes à zéro tant que rien n'a été demandé, car un zéro se lirait
 * comme « aucun défaut » et non comme « aucune mesure ».
 */
export default function ContextSummary({ resume, optimisation = null }) {
  if (!resume) return null;

  return (
    <section
      className="pointer-events-auto min-w-[210px] max-w-[240px] rounded-xl border border-border-default bg-gr-navy/95 px-3 py-2 shadow-panel backdrop-blur-md transition-all duration-200"
      aria-label="Résumé du territoire affiché"
    >
      <p className="truncate text-[9px] font-black uppercase tracking-[0.15em] text-gr-gold">{resume.titre}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {resume.chiffres.map((chiffre) => (
          <p key={chiffre.libelle} className="flex items-baseline gap-1">
            <span className="font-mono text-[14px] font-bold tabular-nums text-text-primary">{chiffre.valeur.toLocaleString('fr-FR')}</span>
            <span className="text-[9px] font-medium text-text-secondary">{chiffre.libelle}</span>
          </p>
        ))}
      </div>

      {optimisation && (
        <div className="mt-2 border-t border-border-default pt-1.5">
          <p className="text-[8.5px] font-black uppercase tracking-[0.14em] text-gr-gold/75">
            Résultat de la filtration
          </p>
          <ul className="mt-1 space-y-0.5">
            {optimisation.criteres.map((c) => (
              <li key={c.cle} className="flex items-baseline gap-1.5">
                <span aria-hidden className="w-3.5 shrink-0 text-center text-[10px] leading-none">
                  {c.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-[9.5px] text-text-secondary">{c.libelle}</span>
                {/* Un zéro reste affiché, en retrait : le critère a servi, il
                    n'a rien trouvé. Le masquer laisserait croire qu'il n'a pas
                    été employé. */}
                <span
                  className={`shrink-0 font-mono text-[11.5px] font-bold tabular-nums ${
                    c.nombre > 0 ? 'text-text-primary' : 'text-text-secondary/45'
                  }`}
                >
                  {c.nombre}
                </span>
              </li>
            ))}
          </ul>
          <p
            title="Postes distincts : un poste touché par plusieurs critères n’est compté qu’une fois"
            className="mt-1 flex items-baseline gap-1.5 border-t border-border-default pt-1"
          >
            <span className="min-w-0 flex-1 text-[8.5px] font-bold uppercase tracking-[0.1em] text-text-secondary">
              Barrages concernés
            </span>
            <span className="shrink-0 font-mono text-[13px] font-bold tabular-nums text-gr-gold">
              {optimisation.concernes}
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
