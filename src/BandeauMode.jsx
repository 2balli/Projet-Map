/**
 * BANDEAU DE MODE — « DÉMONSTRATION », en permanence et sans échappatoire.
 *
 * POURQUOI IL EXISTE. Les deux versions de l'application sont IDENTIQUES à
 * l'écran : mêmes panneaux, mêmes comptes, même carte. Rien ne distingue une
 * séance de démonstration d'une journée de travail réelle — et c'est
 * exactement ce qui rend la confusion possible. Un chef qui voit 1 124
 * barrages fictifs correctement nommés et pourvus n'a aucune raison de douter.
 *
 * Le service refuse déjà de démarrer sur le mauvais dossier de données (voir
 * `serveur/mode.mjs`). Ce bandeau couvre le cas que ce refus ne peut pas
 * couvrir : le service est bien lancé en démonstration, et quelqu'un l'oublie.
 *
 * EN DÉMONSTRATION SEULEMENT. La production n'affiche rien : un bandeau
 * permanent qu'on voit tous les jours cesse d'être lu, et il ne resterait plus
 * rien pour signaler la démonstration. Le silence en production est ce qui
 * donne son poids au bandeau de démonstration.
 *
 * `pointer-events-none` : il passe devant tout sans jamais avaler un clic —
 * y compris ceux destinés à la carte, qu'il recouvre en partie.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconAlert } from './icons.jsx';

export default function BandeauMode({ mode, source = null }) {
  /**
   * LE BANDEAU DIT QU'IL EST LÀ, ET LA CARTE LUI FAIT DE LA PLACE.
   *
   * Il recouvrait la barre de recherche : les deux se posent en haut au centre,
   * et lui passe devant tout (`z-3000`). La recherche restait utilisable au
   * clavier, mais invisible — le pire des deux mondes.
   *
   * Plutôt que de descendre le bandeau (un avertissement de mode se lit en
   * haut) ou de faire remonter la recherche ailleurs, on RÉSERVE la bande.
   * L'attribut posé ici allume `--gr-bandeau` dans la feuille de style, et tout
   * ce qui se range en haut de la carte s'en décale par `.gr-haut`. En
   * production l'attribut est absent, la variable vaut zéro, rien ne bouge.
   *
   * Sur la racine du document et non sur `body` : `body` porte déjà des styles
   * de l'application, et une variable de mise en page se lit mieux à la racine.
   *
   * Le nettoyage compte : un passage de démonstration à production sans
   * rechargement laisserait sinon une bande vide en haut de la carte.
   */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const racine = document.documentElement;
    if (mode !== 'demo') {
      delete racine.dataset.bandeau;
      return undefined;
    }
    racine.dataset.bandeau = 'demo';
    return () => {
      delete racine.dataset.bandeau;
    };
  }, [mode]);

  if (mode !== 'demo') return null;
  if (typeof document === 'undefined') return null;

  /**
   * EN PORTAIL, comme les modales : le bandeau doit surmonter la carte, ses
   * panneaux et jusqu'aux parcours guidés. Rendu dans l'arbre de
   * l'application, il hériterait du `zoom` de l'échelle d'interface et se
   * retrouverait décalé, ou pris sous une modale.
   *
   * `z-3000` le place au-dessus de tout ce que l'application emploie (les
   * modales sont à 2000).
   */
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[2100] flex justify-center px-3 py-1.5"
      role="status"
    >
      <p
        className="flex items-center gap-2 rounded-b-xl border border-t-0 border-gr-gold/60
          bg-gr-gold px-4 py-1.5 text-[11.5px] font-bold uppercase tracking-[0.1em]
          text-gr-navy shadow-panel"
      >
        <IconAlert size={14} className="shrink-0" />
        Version de démonstration — données fictives
        {source === 'fictif' && <span className="font-normal normal-case"> (jeu local)</span>}
        <span dir="rtl" className="font-normal normal-case tracking-normal opacity-70">
          نسخة تجريبية
        </span>
      </p>
    </div>,
    document.body,
  );
}
