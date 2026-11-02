import { useEffect, useRef, useState } from 'react';

/**
 * Rejoue une animation CSS (`classe`) QUAND `valeur` CHANGE — jamais au
 * premier affichage : un compteur de file qui passe de 6 à 5, un badge d'état
 * qui passe de « À valider » à « Transmis ». Le changement de clé remonte
 * l'élément, ce qui relance l'animation ; rien n'est animé en continu.
 */
export default function ValeurAnimee({ valeur, classe, children }) {
  const precedente = useRef(valeur);
  const [tour, setTour] = useState(0);

  useEffect(() => {
    if (!Object.is(precedente.current, valeur)) {
      precedente.current = valeur;
      setTour((t) => t + 1);
    }
  }, [valeur]);

  return (
    <span key={tour} className={tour ? classe : undefined} style={{ display: 'inline-flex' }}>
      {children}
    </span>
  );
}
