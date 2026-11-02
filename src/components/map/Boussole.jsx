/**
 * BOUSSOLE — les quatre points cardinaux, en bas à droite de la carte.
 *
 * POURQUOI ELLE EST FIXE, ET POURQUOI C'EST HONNÊTE.
 *
 * Leaflet ne fait pas pivoter la carte : le Nord est toujours en haut, à tous
 * les zooms et sur toutes les vues. L'aiguille ne bouge donc jamais, et il
 * serait trompeur de laisser croire le contraire — une boussole qui pourrait
 * tourner mais ne tourne pas fait douter de la carte entière.
 *
 * Elle n'en est pas décorative pour autant. Une carte tactique se lit, se
 * montre et se capture en image : sur une vue rapprochée d'un carrefour, sans
 * côte ni frontière à l'écran, plus rien ne dit où est le Nord. C'est le seul
 * repère d'orientation qui subsiste, et il sert à décrire une position à voix
 * haute — « le poste est au sud du rond-point » — ce que fait toute la journée
 * celui qui tient la carte.
 *
 * INERTE, DÉLIBÉRÉMENT (`pointer-events-none`). On ne peut pas « remettre au
 * Nord » une carte qui y est déjà : un bouton qui ne ferait rien serait pire
 * qu'aucun bouton. Elle indique, elle ne commande pas — et elle n'avale aucun
 * clic destiné à la carte qu'elle recouvre.
 *
 * « O » COMME OUEST, ET NON « W ». Toute l'application est en français ; « W »
 * y serait le seul mot d'une autre langue. Les deux notations existent — « W »
 * est courant en aéronautique et en marine — et il n'y a qu'une lettre à
 * changer ici si l'usage du service est celui-là.
 */
export function Boussole({ integree = false }) {
  /* Placement : sous la colonne de zoom, qui s'arrête à 64 px du bas. La
     boussole occupe 12 → 60 px, donc quatre pixels de jour les séparent. */
  return (
    <div
      className={`pointer-events-none grid size-12
        place-items-center rounded-xl border border-border-default bg-gr-navy/95 shadow-panel
        backdrop-blur ${integree ? 'relative' : 'absolute bottom-3 right-3 z-[1050]'}`}
      role="img"
      aria-label="Orientation de la carte : le Nord est en haut"
      title="Le Nord est toujours en haut — la carte ne pivote pas"
    >
      <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
        {/* Le cercle de la rose : discret, il ne fait que tenir les lettres. */}
        <circle cx="17" cy="17" r="11.5" fill="none" stroke="currentColor" strokeWidth="0.75" className="text-white/15" />

        {/*
          L'AIGUILLE, EN DEUX MOITIÉS DE VALEURS OPPOSÉES.
          La pointe Nord est pleine et dorée, la queue Sud sourde : c'est ce
          contraste qui se lit d'un coup d'œil, pas la forme. En noir et blanc
          ou sur un écran mal réglé, la différence de valeur subsiste.
        */}
        <path d="M17 5.5 L21 18 L17 15.6 Z" className="fill-gr-gold" />
        <path d="M17 5.5 L13 18 L17 15.6 Z" className="fill-gr-gold/70" />
        <path d="M17 26 L21 18 L17 20.4 Z" className="fill-white/25" />
        <path d="M17 26 L13 18 L17 20.4 Z" className="fill-white/15" />

        {/* Les quatre lettres. Le Nord est doré comme l'aiguille qui le
            désigne ; les trois autres sont là pour lever l'ambiguïté, pas pour
            être lues en premier. */}
        <text
          x="17"
          y="4.6"
          textAnchor="middle"
          className="fill-gr-gold font-bold"
          fontSize="8"
        >
          N
        </text>
        <text
          x="30.4"
          y="20"
          textAnchor="middle"
          className="fill-white/55 font-semibold"
          fontSize="7"
        >
          E
        </text>
        <text
          x="17"
          y="33"
          textAnchor="middle"
          className="fill-white/55 font-semibold"
          fontSize="7"
        >
          S
        </text>
        <text
          x="3.6"
          y="20"
          textAnchor="middle"
          className="fill-white/55 font-semibold"
          fontSize="7"
        >
          O
        </text>
      </svg>
    </div>
  );
}
