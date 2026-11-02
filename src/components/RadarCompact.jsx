/**
 * Le radar des calculs, en petit — le MÊME (classes `.gr-radar-analyse-*`,
 * couleurs du thème) que celui de la carte (map/RadarAnalyse.jsx), pour les
 * endroits où la carte est masquée : fenêtres de parcours (Parcours.jsx).
 */
export default function RadarCompact({ taille = 22 }) {
  return (
    <span className="gr-radar-analyse-disque gr-radar-compact shrink-0" style={{ width: taille }} aria-hidden="true">
      <span className="gr-radar-analyse-cercle" style={{ '--k': 1 }} />
      <span className="gr-radar-analyse-cercle" style={{ '--k': 0.5 }} />
      <span className="gr-radar-analyse-secteur" />
      <span className="gr-radar-analyse-centre" />
    </span>
  );
}
