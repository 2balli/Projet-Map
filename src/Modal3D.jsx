import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, ScaleControl, useMap } from 'react-leaflet';
import { IconClose, IconAlert, IconSpinner } from './icons.jsx';
import { pinIcon } from './markerIcons.js';
import { FOND_OPTIONS } from './mapConfig.js';
import FondCarteVectoriel from './components/map/FondCarteVectoriel.jsx';
import { Formulaire } from './MarquagePanel.jsx';
import * as API from './api.js';
import {
  TYPE_PAR_CLE,
  libelle,
  plage,
  SEVERITES,
  NIVEAUX_ACTIVITE,
  NIVEAUX_INFRACTION,
  POSITIONS_VILLE,
  ECLAIRAGE,
  /* STATUT_BARRAGE_INFO retiré avec le volet « Validation ». */
} from './marquages.js';
import { estBarrage as estBarrageMarquage } from './marquages.js';

/** Une ligne libellé / valeur — pour le bandeau d'identité en lecture seule. */
const Ligne = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3 border-b border-white/6 py-1.5 text-[12px] last:border-0">
    <span className="text-white/45">{label}</span>
    <span className="min-w-0 flex-1 truncate text-right font-semibold text-white/90">{children}</span>
  </div>
);

/** Libellé FR d'un code dans une liste `{code, fr}` — `—` si absent ou non renseigné. */
const frDe = (liste, code) => liste.find((o) => o.code === code)?.fr ?? '—';

/**
 * Force Leaflet à recalculer sa taille une fois la modale posée : à la
 * création, le conteneur flex peut ne pas encore avoir sa hauteur finale, ce
 * qui fige la carte à une taille nulle ou fausse (défaut connu de Leaflet
 * dans une mise en page dynamique — n'apparaît pas si la carte occupe toute
 * la page dès le premier rendu, comme la carte principale).
 */
function CorrigerTaille() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

/** Libellés FR des champs journalisés (voir `RETENUS` dans serveur/journal.mjs). */
const FR_CHAMP = {
  nom: 'Nom',
  route: 'Route',
  note: 'Observation',
  cause: 'Cause',
  sousType: 'Type de point',
  partage: 'Diffusion inter-régions',
  accidentCount: "Nombre d'accidents",
  debut: 'Début',
  fin: 'Fin',
  lng: 'Longitude',
  lat: 'Latitude',
  cie: 'Compagnie',
  reg: 'Région',
};

const FR_ACTION = {
  creer: { fr: 'Créé', color: '#4caf50' },
  modifier: { fr: 'Modifié', color: '#c8a349' },
  deplacer: { fr: 'Déplacé', color: '#c8a349' },
  supprimer: { fr: 'Supprimé', color: '#e35555' },
};

/** Une entrée du journal — une écriture, son auteur, ce qui a changé. */
function LigneHistorique({ e }) {
  const action = FR_ACTION[e.action] ?? { fr: e.action, color: '#9aa5b1' };
  const changements = Object.entries(e.change ?? {});

  return (
    <li className="space-y-1 rounded-lg bg-white/6 px-2.5 py-2 text-[11px] leading-snug">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold" style={{ color: action.color }}>
          {action.fr}
        </span>
        <span className="text-[10px] text-white/35">{new Date(e.ts).toLocaleString('fr-FR')}</span>
      </div>
      <p className="text-white/50">
        {e.nom ?? e.matricule ?? 'Agent'} {e.unite ? `· ${e.unite}` : ''}
      </p>
      {changements.length > 0 && (
        <ul className="space-y-0.5 text-white/70">
          {changements.map(([champ, { de, vers }]) => (
            <li key={champ}>
              <span className="text-white/45">{FR_CHAMP[champ] ?? champ}</span> : {String(de ?? '—')} →{' '}
              {String(vers ?? '—')}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Onglet Infos : vue d'ensemble en lecture seule d'un barrage ou d'un point
 * noir — critères d'importance, validation, patrouilles, barrage lié — pour
 * un coup d'œil rapide sans passer par l'édition (onglet Détails, à côté).
 * Réservé à `accident`/`barrage_fixe`/`barrage_mobile` : les autres natures
 * n'ont que l'onglet Détails.
 */
function OngletInfos({ item, important, distanceProcheKm, barragesLies, onOuvrirBarrageLie }) {
  const type = TYPE_PAR_CLE[item.type];

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-5 py-4">
      <div className="mx-auto max-w-[440px] space-y-4">
        <header className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold"
            style={{ backgroundColor: type.color, color: '#0b1220' }}
          >
            {type.fr.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-white">{libelle(item)}</h3>
            <p className="truncate text-[11px] text-white/45">
              {[item.reg, item.cie, item.bt].filter(Boolean).join(' · ') || type.fr}
            </p>
          </div>
        </header>

        {important && (
          <p className="flex items-center gap-1.5 rounded-lg bg-gr-gold/15 px-2.5 py-1.5 text-[11px] font-semibold text-gr-gold">
            <IconAlert size={13} className="shrink-0" /> Point noir important
            {distanceProcheKm != null && (
              <span className="font-normal text-gr-gold/80">
                · à {distanceProcheKm.toFixed(1)} km du plus proche
              </span>
            )}
          </p>
        )}

        <section className="rounded-xl border border-white/10 bg-white/4 p-3">
          <Ligne label="Route / point kilométrique">{item.route || '—'}</Ligne>
          <Ligne label="Créneau">{plage(item) || 'Non renseigné'}</Ligne>
          <Ligne label="Coordonnées">
            {item.lat.toFixed(5)}, {item.lng.toFixed(5)}
          </Ligne>
          {item.auteur && (
            <Ligne label="Posé par">
              {item.auteur.rang === 'reg' ? 'Région' : item.auteur.rang === 'admin' ? 'Admin' : 'Cie'}{' '}
              {item.auteur.unite}
            </Ligne>
          )}
          <Ligne label="Mise à jour">{new Date(item.maj).toLocaleString('fr-FR')}</Ligne>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/4 p-3">
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gr-gold/80">
            {item.type === 'accident' ? "Critères d'importance" : "Critères d'importance (point noir d'origine)"}
          </h4>
          <Ligne label="Nombre d'accidents">{item.accidentCount ?? 0}</Ligne>
          <Ligne label="Sévérité">{frDe(SEVERITES, item.severite ?? 'none')}</Ligne>
          <Ligne label="Activité routière">{frDe(NIVEAUX_ACTIVITE, item.activite ?? 'low')}</Ligne>
          <Ligne label="Fréquence d'infractions">{frDe(NIVEAUX_INFRACTION, item.infraction ?? 'low')}</Ligne>
          <Ligne label="Position / ville">{frDe(POSITIONS_VILLE, item.positionVille ?? 'none')}</Ligne>
          <Ligne label="Éclairage nocturne">{frDe(ECLAIRAGE, item.eclairage ?? 'inconnu')}</Ligne>
        </section>

        {item.type === 'accident' && (
          <section className="rounded-xl border border-white/10 bg-white/4 p-3">
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gr-gold/80">Barrage lié</h4>
            {barragesLies.length === 0 ? (
              <p className="text-[11px] text-white/40">Aucun barrage généré depuis ce point.</p>
            ) : (
              <ul className="space-y-1">
                {barragesLies.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onOuvrirBarrageLie(b)}
                      className="w-full truncate rounded-lg bg-white/6 px-2 py-1 text-left text-[12px] text-white/80 hover:bg-white/10"
                    >
                      {libelle(b)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {estBarrageMarquage(item) && (
          <>
            {/* Le volet « Validation » (statut du barrage) a été retiré de
                l'interface — voir le commentaire dans MarquagePanel.jsx. La
                donnée reste en base. */}

            <section className="rounded-xl border border-white/10 bg-white/4 p-3">
              <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gr-gold/80">
                Patrouilles affectées
              </h4>
              {(item.patrouilles ?? []).length === 0 ? (
                <p className="text-[11px] text-white/40">Aucune patrouille affectée.</p>
              ) : (
                <ul className="space-y-1">
                  {item.patrouilles.map((p, i) => (
                    <li key={i} className="text-[12px] text-white/80">
                      {p.nom || `Patrouille ${i + 1}`}
                      {p.unite ? ` — ${p.unite}` : ''}
                      {p.date ? ` · ${p.date} ${p.debut ?? ''}–${p.fin ?? ''}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {item.note && (
          <section className="rounded-xl border border-white/10 bg-white/4 p-3">
            <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gr-gold/80">Observation</h4>
            <p className="text-[12px] leading-snug text-white/80">{item.note}</p>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Onglet Détails : bandeau d'identité en lecture seule (posé par, mise à
 * jour) puis le MÊME formulaire que le panneau Saisie (`Formulaire`, voir
 * MarquagePanel.jsx) — modifier ici ou dans Saisie revient au même appel
 * serveur, aucune logique dupliquée. Les actions liées à la carte principale
 * (vue aérienne, cadrage) sont masquées : on y est déjà.
 */
function OngletDetails({
  item,
  important,
  distanceProcheKm,
  session,
  onChange,
  onDelete,
  onGenererBarrage,
  generationEnCours,
  barragesLies,
  onOuvrirBarrageLie,
}) {
  const type = TYPE_PAR_CLE[item.type];

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-5 py-4">
      <div className="mx-auto max-w-[440px] space-y-4">
        <header className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl text-[13px] font-bold"
            style={{ backgroundColor: type.color, color: '#0b1220' }}
          >
            {type.fr.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold text-white">{libelle(item)}</h3>
            <p className="truncate text-[11px] text-white/45">
              {[item.reg, item.cie, item.bt].filter(Boolean).join(' · ') || type.fr}
            </p>
          </div>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/4 p-3">
          {item.auteur && (
            <Ligne label="Posé par">
              {item.auteur.rang === 'reg' ? 'Région' : item.auteur.rang === 'admin' ? 'Admin' : 'Cie'}{' '}
              {item.auteur.unite}
            </Ligne>
          )}
          <Ligne label="Mise à jour">{new Date(item.maj).toLocaleString('fr-FR')}</Ligne>
        </section>

        <Formulaire
          item={item}
          important={important}
          distanceProcheKm={distanceProcheKm}
          session={session}
          onChange={onChange}
          onDelete={onDelete}
          onGenererBarrage={onGenererBarrage}
          generationEnCours={generationEnCours}
          barragesLies={barragesLies}
          onOuvrirBarrageLie={onOuvrirBarrageLie}
          masquerActionsCarte
        />
      </div>
    </div>
  );
}

/**
 * Onglet Historique : journal des écritures (créé, modifié, déplacé,
 * supprimé) sur CE marquage — chargé à la demande, un appel par ouverture
 * d'onglet.
 */
function OngletHistorique({ item }) {
  const [entrees, setEntrees] = useState(null); // null = chargement, [] = aucune
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let annule = false;
    setEntrees(null);
    setErreur(null);
    API.journalMarquage(item.id)
      .then((r) => {
        if (!annule) setEntrees(r);
      })
      .catch((err) => {
        if (!annule) setErreur(err.message);
      });
    return () => {
      annule = true;
    };
  }, [item.id]);

  return (
    <div className="h-full overflow-y-auto overscroll-contain px-5 py-4">
      <div className="mx-auto max-w-[440px] space-y-1.5">
        {entrees === null ? (
          <p className="flex items-center gap-1.5 text-[11px] text-white/40">
            <IconSpinner size={12} /> Chargement…
          </p>
        ) : erreur ? (
          <p className="text-[11px] text-gr-red">{erreur}</p>
        ) : entrees.length === 0 ? (
          <p className="text-[11px] text-white/40">Aucune écriture enregistrée.</p>
        ) : (
          <ul className="space-y-1.5">
            {entrees.map((e, i) => (
              <LigneHistorique key={`${e.ts}_${i}`} e={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const ONGLETS = [
  { cle: 'vue', fr: 'Vue aérienne' },
  { cle: 'infos', fr: 'Infos' },
  { cle: 'details', fr: 'Détails' },
  { cle: 'historique', fr: 'Historique' },
];

/**
 * Fiche du marquage — plein écran, à onglets.
 *
 * Vue aérienne : zoom serré sur le fond de carte hors ligne (le même que la
 * carte principale, voir mapConfig.js), isolée dans une fenêtre
 * dédiée, sans aucune autre couche, pour un examen visuel sans distraction.
 *
 * Infos / Détails / Historique : chacun son onglet plutôt qu'une seule page à
 * faire défiler — modifier une fiche ou relire qui a fait quoi sans jamais
 * perdre le fil dans un long scroll.
 *
 * Ne dépend d'aucune ressource externe (ancienne version : iframe Google Maps,
 * qui exigeait une connexion internet en direct — incompatible avec un poste
 * intranet sans accès extérieur).
 */
export default function Modal3D({
  item,
  onClose,
  important,
  distanceProcheKm,
  items, // tous les marquages connus — pour retrouver les barrages déjà générés depuis ce point
  session,
  onChange, // (item complet) -> enregistre la modification (même chemin que Saisie)
  onDelete, // (id) -> supprime ce marquage
  onGenererBarrage,
  generationEnCours,
  onOuvrirItem, // (marquage) -> fait afficher CE marquage dans la même modale, sans la fermer
}) {
  // 'attente' | 'ok' | 'echec' — même logique que `tilesOk` sur la carte
  // principale (voir GendarmerieMap.jsx), pour distinguer un chargement lent
  // d'un serveur qui ne renvoie rien à cet endroit précis.
  const [etatTuiles, setEtatTuiles] = useState('attente');
  const [onglet, setOnglet] = useState('vue');

  useEffect(() => {
    setEtatTuiles('attente');
    setOnglet('vue');
  }, [item?.id]);

  /**
   * CLIC SUR LE FOND SOMBRE = FERMETURE, comme la croix : le geste qu'on tente
   * d'instinct pour revenir à la carte, sans viser le coin de la fenêtre.
   *
   * Deux garde-fous, car la fiche s'édite (onglet Détails) et une fermeture
   * involontaire perdrait la saisie en cours :
   *   — le relâchement doit viser le fond LUI-MÊME (`target === currentTarget`),
   *     donc pas un clic remonté depuis la fenêtre ;
   *   — l'appui doit avoir commencé sur ce même fond. Sans cela, faire glisser
   *     la carte aérienne et relâcher hors du cadre refermerait tout : le
   *     `click` est alors émis sur leur premier ancêtre commun — le fond.
   */
  const appuiSurFond = useRef(false);

  if (!item || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) return null;

  // `item` est un instantané au moment du clic : si l'onglet Détails modifie
  // la fiche (via `Formulaire`), c'est `items` qui reçoit la mise à jour, pas
  // cette prop. Sans ce recalage, la modale continuerait d'afficher les
  // anciennes valeurs alors même que le serveur a déjà enregistré les
  // nouvelles — on retrouve toujours le marquage courant par son id.
  const itemLive = (items ?? []).find((m) => m.id === item.id) ?? item;

  const estBarrage = estBarrageMarquage(itemLive);
  const estPointNoir = itemLive.type === 'accident';

  const barragesLies =
    itemLive.type === 'accident'
      ? (items ?? []).filter((m) => estBarrageMarquage(m) && m.origineId === itemLive.id)
      : [];

  const fondCharge = () => setEtatTuiles('ok');
  const fondErreur = () => setEtatTuiles((e) => (e === 'ok' ? e : 'echec'));

  const onglets = ONGLETS.filter((o) => {
    if (o.cle === 'infos') return estBarrage || estPointNoir;
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 sm:p-8"
      onMouseDown={(e) => {
        appuiSurFond.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (appuiSurFond.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex h-full max-h-[800px] w-full max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-gr-navy shadow-[0_0_50px_rgba(0,0,0,0.5)]">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gr-gold text-gr-navy font-bold shadow-[0_0_15px_rgba(200,163,73,0.3)]">
              3D
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-bold tracking-widest text-white">{libelle(itemLive)}</h2>
              <p className="truncate text-[11px] text-gr-gold/80">
                {itemLive.lat.toFixed(5)}, {itemLive.lng.toFixed(5)}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/6 p-1">
            {onglets.map((o) => (
              <button
                key={o.cle}
                type="button"
                onClick={() => setOnglet(o.cle)}
                className={`flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors duration-150 ${
                  onglet === o.cle ? 'bg-gr-gold text-gr-navy' : 'text-white/60 hover:bg-white/10'
                }`}
              >
                {o.fr}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconClose size={20} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 bg-gr-deep">
          {onglet === 'infos' && (estBarrage || estPointNoir) && (
            <OngletInfos
              item={itemLive}
              important={important}
              distanceProcheKm={distanceProcheKm}
              barragesLies={barragesLies}
              onOuvrirBarrageLie={onOuvrirItem}
            />
          )}

          {onglet === 'details' && (
            <OngletDetails
              item={itemLive}
              important={important}
              distanceProcheKm={distanceProcheKm}
              session={session}
              onChange={onChange}
              onDelete={() => {
                onDelete(itemLive.id);
                onClose();
              }}
              onGenererBarrage={onGenererBarrage}
              generationEnCours={generationEnCours}
              barragesLies={barragesLies}
              onOuvrirBarrageLie={onOuvrirItem}
            />
          )}

          {onglet === 'historique' && <OngletHistorique item={itemLive} />}

          {onglet === 'vue' && (
            <>
              {etatTuiles === 'attente' && (
                <div className="pointer-events-none absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 text-gr-gold">
                  <IconSpinner size={28} />
                  <span className="text-[11px] font-semibold tracking-widest">CHARGEMENT DES TUILES…</span>
                </div>
              )}
              {etatTuiles === 'echec' && (
                <div className="pointer-events-none absolute inset-x-0 top-3 z-[1000] flex justify-center px-4">
                  <p className="flex items-center gap-2 rounded-lg bg-gr-red/15 px-3 py-2 text-[11px] font-semibold text-gr-red">
                    <IconAlert size={14} />
                    Fond de carte indisponible : archive hors ligne introuvable ou illisible.
                  </p>
                </div>
              )}
              <MapContainer
                center={[itemLive.lat, itemLive.lng]}
                // 13 : le zoom le plus profond utilisé ailleurs dans l'appli (voir
                // cadrerMq/fitBounds dans GendarmerieMap.jsx). `maxZoom` reste plus
                // haut : au-delà du zoom 15 de l'archive, le fond vectoriel s'agrandit.
                zoom={13}
                maxZoom={FOND_OPTIONS.maxZoom}
                zoomControl
                attributionControl={false}
                className="h-full w-full"
              >
                <FondCarteVectoriel onCharge={fondCharge} onErreur={fondErreur} />
                <ScaleControl position="bottomleft" imperial={false} />
                <CorrigerTaille />
                <Marker position={[itemLive.lat, itemLive.lng]} icon={pinIcon({ glyph: 'pointage', color: '#d50000', scale: 1 })} />
              </MapContainer>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
