import { useEffect, useRef, useState } from 'react';
import { IconClose, IconCoche, IconAlert } from '../icons.jsx';

/**
 * TOASTS — retours brefs (succès, erreur, information), sans dépendance.
 *
 * `notifier({ type, titre, message })` peut être appelé de n'importe où ; le
 * composant <Toasts /> (monté une fois, voir GendarmerieMap) les affiche en
 * pile, en bas à droite, au-dessus des commandes de la carte.
 *
 * Accessibilité : région `aria-live` (« polite » ; « assertive » pour une
 * erreur), bouton de fermeture au clavier, pause au survol ET au focus — un
 * message ne disparaît pas sous les yeux de qui le lit. Mouvement : entrée et
 * sortie par `data-presence` (index.css), coupées si l'utilisateur le demande.
 *
 * Un toast ne remplace jamais l'état affiché : il confirme une action déjà
 * enregistrée par le serveur (il est émis APRÈS sa réponse), ou signale un
 * refus que la carte ou le panneau montre aussi.
 */
const abonnes = new Set();
let compteur = 0;

/** @param {{ type?: 'succes'|'erreur'|'info', titre: string, message?: string, duree?: number }} t */
export function notifier(t) {
  const toast = { id: ++compteur, type: t.type ?? 'info', titre: t.titre, message: t.message ?? '', duree: t.duree ?? (t.type === 'erreur' ? 7000 : 4500) };
  for (const f of abonnes) f(toast);
  return toast.id;
}

const ALLURE = {
  succes: { Icone: IconCoche, teinte: 'var(--tone-ok)' },
  erreur: { Icone: IconAlert, teinte: 'var(--tone-danger)' },
  info: { Icone: IconAlert, teinte: 'var(--primary)' },
};

const SORTIE_MS = 200;

function Toast({ t, onFini }) {
  const [sortie, setSortie] = useState(false);
  const pause = useRef(false);
  const reste = useRef(t.duree);
  const debut = useRef(Date.now());

  useEffect(() => {
    if (sortie) {
      const fin = setTimeout(onFini, SORTIE_MS);
      return () => clearTimeout(fin);
    }
    const tic = setInterval(() => {
      if (pause.current) return;
      if (Date.now() - debut.current >= reste.current) setSortie(true);
    }, 200);
    return () => clearInterval(tic);
  }, [sortie, onFini]);

  const suspendre = () => {
    if (pause.current) return;
    pause.current = true;
    reste.current -= Date.now() - debut.current;
  };
  const reprendre = () => {
    if (!pause.current) return;
    pause.current = false;
    debut.current = Date.now();
  };
  const { Icone, teinte } = ALLURE[t.type] ?? ALLURE.info;

  return (
    <div
      role={t.type === 'erreur' ? 'alert' : 'status'}
      data-presence={sortie ? 'sortie' : 'entree'}
      data-depuis="droite"
      onMouseEnter={suspendre}
      onMouseLeave={reprendre}
      onFocus={suspendre}
      onBlur={reprendre}
      className="pointer-events-auto flex w-[320px] max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-xl border border-border-default bg-gr-navy px-3 py-2.5 shadow-panel"
      style={{ borderLeft: `3px solid ${teinte}` }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: teinte }}>
        <Icone size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-text-primary">{t.titre}</p>
        {t.message && <p className="mt-0.5 text-[11.5px] leading-snug text-text-secondary">{t.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => setSortie(true)}
        aria-label="Fermer la notification"
        className="gr-bouton grid size-6 shrink-0 place-items-center rounded-md text-text-muted hover:bg-gr-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-gr-primary"
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}

export default function Toasts() {
  const [liste, setListe] = useState([]);
  useEffect(() => {
    const f = (t) => setListe((l) => [...l.slice(-3), t]); // au plus 4 à l'écran
    abonnes.add(f);
    return () => abonnes.delete(f);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed bottom-4 right-[76px] z-[2500] flex flex-col items-end gap-2"
    >
      {liste.map((t) => (
        <Toast key={t.id} t={t} onFini={() => setListe((l) => l.filter((x) => x.id !== t.id))} />
      ))}
    </div>
  );
}
