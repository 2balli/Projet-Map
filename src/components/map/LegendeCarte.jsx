import { useRef, useState } from 'react';
import { IconPoignee, IconChevron, IconClose } from '../../icons.jsx';
import * as MQ from '../../marquages.js';
import { pinIcon } from '../../markerIcons.js';
import { COLORS, INFRASTRUCTURE_LAYERS } from '../../layersConfig.js';

export const CLE_LEGENDE = 'gr-legende-carte';
export const CLE_LEGENDE_POSITION = 'gr-legende-position';

function GroupeLegende({ titre, children, initial = false }) {
  const [ouvert, setOuvert] = useState(initial);
  return (
    <section className="border-b border-white/8 last:border-b-0">
      <button type="button" onClick={() => setOuvert((v) => !v)} aria-expanded={ouvert} className="flex w-full items-center gap-2 py-2 text-left text-[9px] font-bold uppercase tracking-[0.12em] text-gr-gold/75 hover:text-gr-gold">
        <span className="min-w-0 flex-1">{titre}</span>
        <IconChevron size={10} open={ouvert} className="text-white/35" />
      </button>
      {ouvert && <div className="space-y-1.5 pb-2">{children}</div>}
    </section>
  );
}

/** Lit une position enregistrée, en refusant tout ce qui n'est pas un point. */
export function positionEnregistree() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_LEGENDE_POSITION) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
  } catch {
    return null;
  }
}

/**
 * LÉGENDE DE LA CARTE — le vocabulaire visuel, expliqué une fois.
 */
export function LegendeCarte({
  position = null,
  echelle = 1,
  onDeplacer,
  onRanger,
  ouvert: ouvertControle,
  onOuvertChange,
}) {
  const hote = useRef(null);
  const [glisse, setGlisse] = useState(false);

  const saisir = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const boite = hote.current?.getBoundingClientRect();
    const scene = hote.current?.closest('[data-gr-scene]')?.getBoundingClientRect();
    if (!boite || !scene) return;

    const depart = {
      px: e.clientX,
      py: e.clientY,
      x: (boite.left - scene.left) / echelle,
      y: (boite.top - scene.top) / echelle,
    };

    const maxX = Math.max(0, (scene.width - boite.width) / echelle);
    const maxY = Math.max(0, (scene.height - boite.height) / echelle);
    const borner = (v, max) => Math.max(0, Math.min(v, max));

    let dernier = { x: depart.x, y: depart.y };

    const bouger = (ev) => {
      dernier = {
        x: borner(depart.x + (ev.clientX - depart.px) / echelle, maxX),
        y: borner(depart.y + (ev.clientY - depart.py) / echelle, maxY),
      };
      onDeplacer?.(dernier, false);
    };

    const lacher = () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', lacher);
      window.removeEventListener('pointercancel', lacher);
      setGlisse(false);
      onDeplacer?.(dernier, true);
    };

    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', lacher);
    window.addEventListener('pointercancel', lacher);
    setGlisse(true);
  };

  const [ouvertInterne, setOuvertInterne] = useState(() => {
    try {
      return localStorage.getItem(CLE_LEGENDE) === '1';
    } catch {
      return false;
    }
  });
  const ouvert = ouvertControle ?? ouvertInterne;

  const basculer = () => {
    const suivant = !ouvert;
    if (ouvertControle == null) {
      setOuvertInterne(suivant);
      try {
        localStorage.setItem(CLE_LEGENDE, suivant ? '1' : '0');
      } catch {
        /* stockage indisponible */
      }
    }
    onOuvertChange?.(suivant);
  };

  const Ligne = ({ echantillon, children }) => (
    <div className="flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center">{echantillon}</span>
      <span className="min-w-0 flex-1 text-[10px] leading-tight text-white/65">{children}</span>
    </div>
  );

  const Pin = ({ type }) => {
    const t = MQ.TYPE_PAR_CLE[type];
    return (
      <img
        src={pinIcon({ glyph: t.glyph, color: t.color, scale: 0.62 }).options.iconUrl}
        alt=""
        aria-hidden="true"
        className="block"
      />
    );
  };

  const PinConfig = ({ cfg }) => (
    <img src={pinIcon({ glyph: cfg.glyph, color: cfg.color, scale: 0.62 }).options.iconUrl} alt="" aria-hidden="true" className="block" />
  );

  const Trait = ({ couleur, pointille = false }) => (
    <span className="block w-5 border-t-2" style={{ borderColor: couleur, borderStyle: pointille ? 'dashed' : 'solid' }} />
  );

  const Repere = ({ classe, contenu }) => (
    <span
      aria-hidden="true"
      className={classe}
      style={{ transform: 'scale(0.62)', cursor: 'default' }}
    >
      {contenu}
    </span>
  );

  return (
    <div
      ref={hote}
      /* `select-none` : la poignée et le titre se glissent et se double-cliquent
         (déplacer, remettre en place). Sans lui, ces gestes surlignaient le mot
         « Légende » en bleu au lieu d'agir — un défaut qu'on prend pour un bug
         d'affichage. Le rail de navigation porte la même protection. */
      className={`pointer-events-auto select-none overflow-hidden rounded-xl border bg-gr-navy/95
        shadow-panel backdrop-blur ${glisse ? 'border-gr-gold/50' : 'border-white/12'}`}
    >
      <div className="flex items-stretch">
        <span
          role="button"
          tabIndex={-1}
          aria-label="Déplacer la légende"
          title={
            position
              ? 'Glisser pour déplacer — double-clic pour la remettre à sa place'
              : 'Glisser pour déplacer la légende où vous voulez'
          }
          onPointerDown={saisir}
          onDoubleClick={() => onRanger?.()}
          className={`grid w-6 shrink-0 touch-none place-items-center text-white/30
            transition-colors duration-150 hover:bg-white/8 hover:text-white/70
            motion-reduce:transition-none ${glisse ? 'cursor-grabbing bg-white/10 text-gr-gold' : 'cursor-grab'}`}
        >
          <IconPoignee size={11} />
        </span>

        <button
          type="button"
          onClick={basculer}
          aria-expanded={ouvert}
          title={ouvert ? 'Replier la légende' : 'Que veulent dire les repères ?'}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pr-2.5 pl-1 text-left
            transition-colors duration-150 hover:bg-white/6 motion-reduce:transition-none
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">
            🗺️
          </span>
          <span className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-gr-gold/85">
            Légende
          </span>
          <IconChevron size={10} open={ouvert} className="shrink-0 text-white/40" />
        </button>

        {position && (
          <button
            type="button"
            onClick={() => onRanger?.()}
            aria-label="Remettre la légende à sa place"
            title="Remettre la légende à sa place"
            className="grid w-7 shrink-0 place-items-center text-white/35
              transition-colors duration-150 hover:bg-white/8 hover:text-white
              motion-reduce:transition-none
              focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
          >
            <IconPoignee size={11} />
          </button>
        )}

        <button
          type="button"
          onClick={() => (onOuvertChange ? onOuvertChange(false) : basculer())}
          aria-label="Fermer la légende"
          title="Fermer la légende"
          className="grid w-7 shrink-0 place-items-center text-white/40
            transition-colors duration-150 hover:bg-white/10 hover:text-white
            motion-reduce:transition-none
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gr-primary"
        >
          <IconClose size={12} />
        </button>
      </div>

      {ouvert && (
        <div className="max-h-[52vh] overflow-y-auto overscroll-contain border-t border-white/10 px-2.5 py-2">
          <GroupeLegende titre="Barrages" initial>
            <Ligne echantillon={<Pin type="barrage_fixe" />}>Barrage fixe normal</Ligne>
            <Ligne
              echantillon={
                <img
                  src={
                    pinIcon({
                      glyph: 'barrage_intouchable',
                      color: '#0d9488',
                      scale: 0.62,
                      intouchable: true,
                    }).options.iconUrl
                  }
                  alt=""
                  aria-hidden="true"
                  className="block"
                />
              }
            >
              Barrage fixe intouchable (BFI)
            </Ligne>
            <Ligne echantillon={<Repere classe="gr-nouveau" contenu="!" />}>Barrage nouvellement posé</Ligne>
            <Ligne echantillon={<span className="gr-badge gr-badge-ville text-[7px]">⇥</span>}>Entrée, sortie ou porte de ville</Ligne>
          </GroupeLegende>

          <GroupeLegende titre="Risques">
            <Ligne echantillon={<Pin type="accident" />}>Point noir accidents</Ligne>
            <Ligne echantillon={<Pin type="zahma" />}>Congestion</Ligne>
            <Ligne echantillon={<span className="gr-badge gr-badge-accident text-[8px]">A5</span>}>Accidents relevés</Ligne>
            <Ligne echantillon={<span className="gr-badge gr-badge-nuit text-[8px]">💡</span>}>Axe non éclairé</Ligne>
          </GroupeLegende>

          <GroupeLegende titre="Décisions">
            <Ligne echantillon={<Repere classe="gr-interro" contenu="?" />}><b className="text-white/85">À trancher</b> — trop près de son voisin</Ligne>
            <Ligne echantillon={<Repere classe="gr-decision gr-decision-retrait" contenu="✗" />}>Retrait proposé</Ligne>
            <Ligne echantillon={<Repere classe="gr-decision gr-decision-maintien" contenu="✓" />}>Maintenu par décision</Ligne>
            <Ligne echantillon={<Repere classe="gr-exclu" contenu={<span className="text-[11px]">🔒</span>} />}>Porte de ville protégée</Ligne>
            <Ligne echantillon={<Repere classe="gr-exclu gr-exclu-accident" contenu={<span className="text-[11px]">✳</span>} />}>Accidents au-delà du seuil</Ligne>
            <Ligne echantillon={<Repere classe="gr-exclu gr-exclu-vip" contenu={<span className="text-[11px]">◎</span>} />}>Mission VIP</Ligne>
            <Ligne echantillon={<Repere classe="gr-exclu gr-exclu-nuit" contenu={<span className="text-[11px]">☾</span>} />}>Axe non éclairé</Ligne>
            <Ligne echantillon={<span className="gr-badge gr-badge-vip text-[8px]">VIP</span>}>Badge de mission VIP</Ligne>
          </GroupeLegende>

          <GroupeLegende titre="Infrastructure">
            {INFRASTRUCTURE_LAYERS.map((cfg) => <Ligne key={cfg.key} echantillon={<PinConfig cfg={cfg} />}>{cfg.fr}</Ligne>)}
          </GroupeLegende>

          <GroupeLegende titre="Limites administratives">
            <Ligne echantillon={<Trait couleur={COLORS.reg} />}>Limite de région</Ligne>
            <Ligne echantillon={<Trait couleur={COLORS.cie} />}>Limite de compagnie</Ligne>
            <Ligne echantillon={<Trait couleur={COLORS.bt} pointille />}>Limite de brigade</Ligne>
          </GroupeLegende>
        </div>
      )}
    </div>
  );
}

export default LegendeCarte;
