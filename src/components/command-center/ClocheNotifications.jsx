import { useCallback, useEffect, useRef, useState } from 'react';
import * as API from '../../api.js';
import { IconCloche, IconClose, IconFleche, IconSpinner, IconAlert } from '../../icons.jsx';
import PanneauDeroulant from './PanneauDeroulant.jsx';

/**
 * LA CLOCHE — ce qui vient de changer, lu ou non lu.
 *
 * Les événements viennent du serveur (serveur/notifications.mjs), qui les tire
 * de son journal et ne rend à chaque compte que ce qui relève de son
 * périmètre. Cet écran ne filtre rien : il montre.
 *
 *   NON LUES     tant qu'on ne les a pas ouvertes ;
 *   HISTORIQUE   toutes, lues comprises — rien ne disparaît à la lecture.
 *
 * OUVRIR, C'EST LIRE. Le clic affiche le détail et marque la notification lue
 * côté serveur ; au retour, elle a quitté « Non lues ».
 *
 * TEMPS RÉEL : un flux `text/event-stream` (voir `abonnerNotifications`). S'il
 * ne peut pas s'établir, la liste est relue toutes les 30 secondes.
 *
 * Les DÉCISIONS à rendre (dossiers « à traiter ») restent dans leur panneau ;
 * la cloche y renvoie, avec leur nombre.
 */
const RELECTURE_MS = 30_000;

const ALLURE = {
  assignation: { signe: '➜', teinte: 'text-sky-300' },
  traitement: { signe: '✓', teinte: 'text-gr-green' },
  validation: { signe: '⚖', teinte: 'text-purple-300' },
  faction: { signe: '⇄', teinte: 'text-gr-gold' },
  deplacement: { signe: '⌖', teinte: 'text-sky-300' },
  statut: { signe: '●', teinte: 'text-amber-300' },
  suppression: { signe: '✗', teinte: 'text-gr-red' },
  creation: { signe: '+', teinte: 'text-gr-gold' },
  demande: { signe: '?', teinte: 'text-amber-300' },
  modification: { signe: '✎', teinte: 'text-white/70' },
};

const TYPE_ACTION = {
  assignation: 'Assignation',
  traitement: 'Traitement d’assignation',
  validation: 'Validation d’une opération',
  faction: 'Changement de faction',
  deplacement: 'Déplacement',
  statut: 'Changement de statut',
  suppression: 'Retrait',
  creation: 'Création',
  demande: 'Demande de validation',
  modification: 'Modification de fiche',
};

const RANGS = { admin: 'Super Admin', reg: 'CMND Région', cie: 'CMND Cie', unite: 'CMND Brigade' };

const quand = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

const fonction = (p) => `${RANGS[p.rang] ?? p.rang}${p.unite && p.rang !== 'admin' ? ` ${p.unite}` : ''}`;
/** « Nom (CMND Région Agadir) », ou la fonction seule quand la personne n'est pas nommée. */
const qui = (p) => {
  if (!p) return '—';
  if (!p.rang) return p.nom || p.matricule || p.unite || '—';
  return p.nom || p.matricule ? `${p.nom || p.matricule} (${fonction(p)})` : fonction(p);
};

const onglet =
  'flex min-h-9 items-center justify-center rounded-lg px-2.5 text-[11.5px] font-semibold transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary';

function Detail({ n, onRetour, onVoirBarrage }) {
  const a = ALLURE[n.type] ?? ALLURE.modification;
  const b = n.barrage ?? {};
  const lignes = [
    ['Date et heure', quand(n.maj ?? n.cree)],
    ['Type d’action', TYPE_ACTION[n.type] ?? n.type],
    ['Effectuée par', qui(n.acteur)],
    ...(n.destinataire ? [['Adressée à', qui(n.destinataire)]] : []),
    ['Barrage', b.nom || b.id || '—'],
    ...(b.route ? [['Axe', b.route]] : []),
    ['Rattachement', [b.reg, b.cie, b.bt].filter(Boolean).join(' · ') || '—'],
  ];
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onRetour}
        className="flex items-center gap-1 text-[11.5px] font-semibold text-white/60 hover:text-gr-gold"
      >
        <IconFleche size={13} arriere /> Retour à la liste
      </button>
      <div>
        <p className={`flex items-center gap-2 text-[13.5px] font-bold ${a.teinte}`}>
          <span aria-hidden="true">{a.signe}</span>
          {n.titre}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-white/85">{n.description}</p>
      </div>
      <dl className="divide-y divide-white/8 rounded-xl border border-white/10 bg-white/4 text-[12px]">
        {lignes.map(([l, v]) => (
          <div key={l} className="flex gap-3 px-3 py-1.5">
            <dt className="w-28 shrink-0 text-white/45">{l}</dt>
            <dd className="min-w-0 flex-1 break-words text-white/90">{v}</dd>
          </div>
        ))}
      </dl>
      {n.details?.conflitId || n.conflitId ? (
        <button
          type="button"
          onClick={() => onVoirBarrage?.(n)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gr-gold px-3 py-2 text-[12px] font-bold text-gr-navy transition-colors hover:bg-gr-gold/90"
        >
          Ouvrir le conflit sur la carte
        </button>
      ) : (
        <button
          type="button"
          disabled={b.lat == null || b.lng == null}
          onClick={() => onVoirBarrage?.(n)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gr-gold px-3 py-2 text-[12px] font-bold text-gr-navy transition-colors hover:bg-gr-gold/90 disabled:opacity-40"
        >
          Voir le barrage sur la carte
        </button>
      )}
    </div>
  );
}

export default function ClocheNotifications({ session, decisions = 0, onOuvrirDecisions = null, onVoirBarrage = null, onEvenement = null }) {
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState('non_lues'); // non_lues | historique
  const [donnees, setDonnees] = useState({ items: [], nonLues: 0 });
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState(null);
  const [detail, setDetail] = useState(null);
  const racine = useRef(null);
  const surEvenement = useRef(onEvenement);
  surEvenement.current = onEvenement;

  const recharger = useCallback(() => {
    API.listerNotificationsEvenements()
      .then((r) => {
        setDonnees({ items: r?.items ?? [], nonLues: r?.nonLues ?? 0 });
        setErreur(null);
      })
      .catch((e) => setErreur(e?.message ?? 'Notifications indisponibles.'))
      .finally(() => setCharge(true));
  }, []);

  /* Chargement, puis temps réel — ou relecture périodique si le flux échoue. */
  useEffect(() => {
    if (!session?.matricule) return undefined;
    recharger();
    let minuterie = null;
    const fermer = API.abonnerNotifications(
      (n) => {
        recharger();
        surEvenement.current?.(n);
      },
      () => {
        if (!minuterie) minuterie = setInterval(recharger, RELECTURE_MS);
      },
    );
    return () => {
      fermer();
      if (minuterie) clearInterval(minuterie);
    };
  }, [session?.matricule, recharger]);

  /** Ouvrir = lire. Un clic sur une notification de conflit ouvre directement le conflit. */
  const ouvrir = (n) => {
    const estConflit = Boolean(n.details?.conflitId || n.conflitId || n.action === 'assignation' || n.action === 'transmission');
    if (estConflit) {
      setOuvert(false);
      onVoirBarrage?.(n);
    } else {
      setDetail(n);
    }

    if (!n.lue) {
      setDonnees((d) => ({
        items: d.items.map((x) => (x.id === n.id ? { ...x, lue: true } : x)),
        nonLues: Math.max(0, d.nonLues - 1),
      }));
      API.marquerNotificationLue(n.id)
        .then((r) => setDonnees((d) => ({ ...d, nonLues: r?.nonLues ?? d.nonLues })))
        .catch(() => recharger());
    }
  };

  const fermer = useCallback(() => setOuvert(false), []);
  const liste = vue === 'non_lues' ? donnees.items.filter((n) => !n.lue) : donnees.items;
  const badge = donnees.nonLues;

  return (
    <div className="pointer-events-auto relative">
      <button
        ref={racine}
        type="button"
        onClick={() => {
          setOuvert((o) => !o);
          setDetail(null);
        }}
        aria-haspopup="dialog"
        aria-expanded={ouvert}
        aria-label={badge ? `Notifications : ${badge} non lue${badge > 1 ? 's' : ''}` : 'Notifications'}
        title="Notifications"
        className={`relative grid size-8 shrink-0 place-items-center rounded-lg border bg-gr-card transition-colors
          hover:border-gr-gold/45 hover:bg-gr-hover hover:text-gr-gold
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
          ${ouvert ? 'border-gr-gold/45 text-gr-gold' : 'border-border-default text-text-secondary'}`}
      >
        <IconCloche size={16} />
        {badge > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[16px] rounded-full bg-gr-red px-1 font-mono text-[8px] font-bold leading-[16px] text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>

      <PanneauDeroulant ouvert={ouvert} ancre={racine} onFermer={fermer} largeur={380} label="Notifications">
          <header className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
            <IconCloche size={15} className="text-gr-gold" />
            <h2 className="flex-1 text-[13px] font-bold">Notifications</h2>
            <button
              type="button"
              onClick={() => setOuvert(false)}
              aria-label="Fermer les notifications"
              className="grid size-7 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            >
              <IconClose size={14} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3">
            {detail ? (
              <Detail
                n={detail}
                onRetour={() => setDetail(null)}
                onVoirBarrage={(n) => {
                  setOuvert(false);
                  onVoirBarrage?.(n);
                }}
              />
            ) : (
              <>
                <div role="tablist" aria-label="Filtre des notifications" className="grid grid-cols-2 gap-1.5">
                  {[
                    ['non_lues', `Non lues (${badge})`],
                    ['historique', 'Historique'],
                  ].map(([cle, libelle]) => (
                    <button
                      key={cle}
                      type="button"
                      role="tab"
                      aria-selected={vue === cle}
                      onClick={() => setVue(cle)}
                      className={`${onglet} ${vue === cle ? 'bg-gr-gold text-gr-navy' : 'bg-white/8 text-white/70 hover:bg-white/14'}`}
                    >
                      {libelle}
                    </button>
                  ))}
                </div>

                {!charge && (
                  <p className="mt-3 flex items-center gap-2 text-[12px] text-white/60">
                    <IconSpinner size={13} /> Chargement…
                  </p>
                )}
                {erreur && (
                  <p role="alert" className="mt-3 flex gap-1.5 text-[12px] text-red-300">
                    <IconAlert size={14} className="mt-px shrink-0" /> {erreur}
                  </p>
                )}
                {charge && !erreur && liste.length === 0 && (
                  <p className="mt-3 rounded-xl border border-dashed border-white/12 px-3 py-6 text-center text-[12.5px] text-white/45">
                    {vue === 'non_lues' ? 'Aucune notification non lue.' : 'Aucune notification.'}
                  </p>
                )}
                <ul className="mt-3 space-y-1.5">
                  {liste.map((n) => {
                    const a = ALLURE[n.type] ?? ALLURE.modification;
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => ouvrir(n)}
                          className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/8
                            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary
                            ${n.lue ? 'border-white/8 bg-transparent' : 'border-gr-gold/30 bg-white/5'}`}
                        >
                          <span className={`mt-px w-4 shrink-0 text-center text-[14px] font-black leading-none ${a.teinte}`} aria-hidden="true">
                            {a.signe}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className={`truncate text-[11.5px] font-bold ${n.lue ? 'text-white/60' : 'text-white'}`}>{n.titre}</span>
                              {!n.lue && <span className="size-1.5 shrink-0 rounded-full bg-gr-gold" aria-label="non lue" />}
                            </span>
                            <span className={`line-clamp-2 block text-[11.5px] ${n.lue ? 'text-white/45' : 'text-white/75'}`}>{n.description}</span>
                            <span className="block truncate text-[10px] text-white/40">
                              {quand(n.maj ?? n.cree)} · {n.acteur?.nom || n.acteur?.unite || '—'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {onOuvrirDecisions && !detail && (
            <footer className="border-t border-white/10 px-3.5 py-2">
              <button
                type="button"
                onClick={() => {
                  setOuvert(false);
                  onOuvrirDecisions();
                }}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-white/70 hover:bg-white/8 hover:text-gr-gold"
              >
                <span>Décisions à traiter{decisions > 0 ? ` (${decisions})` : ''}</span>
                <IconFleche size={13} />
              </button>
            </footer>
          )}
      </PanneauDeroulant>
    </div>
  );
}
