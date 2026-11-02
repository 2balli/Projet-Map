/**
 * RÉSULTAT DE L'OPTIMISATION, PAR CRITÈRE — dérivé du rapport et de rien
 * d'autre.
 *
 * Ces chiffres s'affichent dans la zone de résultat du panneau Optimisation,
 * à l'étape « Les barrages concernés ». Ils ont eu un temps leur propre
 * cartouche flottant sur la carte ; il a été retiré — un chiffre se lit à
 * côté de ce qu'il commente, pas dans un coin de l'écran.
 *
 * CE FICHIER NE CALCULE AUCUN CRITÈRE. Il COMPTE ce que le serveur a déjà
 * jugé. Chaque poste du rapport porte sa liste `protections` (« accidents »,
 * « non_eclaire », « vip », « entree_ville », « sortie_ville ») et son verdict
 * de distance `sousLeSeuil` : tout ce qui suit se lit dans ces deux champs.
 *
 * Refaire les règles ici — relire `accidentCount`, comparer un seuil, mesurer
 * une distance — donnerait un second moteur d'optimisation, qui finirait par
 * annoncer d'autres chiffres que le panneau d'à côté. C'est exactement ce
 * qu'il faut éviter : deux comptes du même dispositif, et plus personne pour
 * savoir lequel fait foi.
 *
 * LE TOTAL N'EST PAS LA SOMME DES LIGNES. Un poste peut être à la fois trop
 * proche de son voisin, non éclairé et en entrée de ville : il compte une fois
 * dans chacune des trois lignes, et UNE SEULE dans « barrages concernés ».
 * D'où l'union d'identifiants plutôt qu'une addition.
 */

/**
 * Les critères de l'optimisation, dans l'ordre d'affichage.
 *
 * `cle` est celle du serveur (voir `protections` dans la route
 * `consolidation`) ; `actif` dit si le critère a RÉELLEMENT servi au calcul,
 * d'après les paramètres renvoyés — et non d'après les cases à cocher, qui ont
 * pu changer depuis. Un critère actif mais sans aucun poste s'affiche à zéro :
 * c'est une information, pas un vide.
 */
export const CRITERES_OPTIMISATION = [
  {
    cle: 'distance',
    emoji: '📏',
    libelle: 'Problème de distance',
    /* Le cœur de la consolidation : toujours mesuré. */
    actif: () => true,
    /**
     * LES POSTES SUR LESQUELS LA DISTANCE POSE UNE QUESTION — et eux seuls.
     *
     * Ce chiffre a d'abord compté TOUS les postes sous le seuil, intouchables
     * compris. Il était exact et illisible : la carte pose un « ? » sur deux
     * postes, la statistique en annonçait trois, et l'on cherchait l'erreur.
     * Le troisième était protégé — entrée de ville, accidents, VIP — donc
     * jamais proposé au retrait, et marqué d'un cadenas.
     *
     * La statistique compte donc ce qu'on peut trancher, ce que la carte
     * montre. Les postes protégés mais trop proches ne sont pas perdus pour
     * autant : le panneau Optimisation les compte à sa ligne « Sous le seuil
     * mais intouchables », à côté de leur distance. Chaque chiffre à sa place,
     * et aucun qui en contredise un autre.
     *
     * ET LE POSTE TRANCHÉ SORT DU COMPTE. Conserver ou proposer le retrait,
     * c'est répondre : la question ne se pose plus, le « ? » disparaît de la
     * carte, et le chiffre baisse d'autant. Il dit donc ce qui RESTE en
     * alerte — un compteur de travail à faire, pas un historique du calcul.
     * Le décompte du calcul, lui, reste au panneau (« Déjà maintenus »,
     * « Retraits déjà proposés »).
     */
    concerne: (b) =>
      b.sousLeSeuil === true && b.intouchable !== true && (b.decision ?? 'aucune') === 'aucune',
  },
  {
    cle: 'accidents',
    emoji: '🚨',
    libelle: 'Accidents',
    actif: (p) => p?.accidents === true,
    concerne: (b) => (b.protections ?? []).includes('accidents'),
  },
  {
    cle: 'non_eclaire',
    emoji: '🌙',
    libelle: 'Non éclairés',
    actif: (p) => p?.nonEclaire === true,
    concerne: (b) => (b.protections ?? []).includes('non_eclaire'),
  },
  {
    cle: 'vip',
    emoji: '⭐',
    libelle: 'VIP',
    actif: (p) => p?.vip === true,
    concerne: (b) => (b.protections ?? []).includes('vip'),
  },
  {
    /* Les portes de ville sont évaluées sans interrupteur : le serveur les
       pousse toujours dans `protections`. Elles sont donc toujours actives. */
    cle: 'entree_ville',
    emoji: '🏙️',
    libelle: 'Entrée de ville',
    actif: () => true,
    concerne: (b) => (b.protections ?? []).includes('entree_ville'),
  },
  {
    cle: 'sortie_ville',
    emoji: '🏙️',
    libelle: 'Sortie de ville',
    actif: () => true,
    concerne: (b) => (b.protections ?? []).includes('sortie_ville'),
  },
];

/**
 * POURQUOI LA DÉCISION NE FILTRE QUE LA DISTANCE.
 *
 * Les autres lignes comptent des PROTECTIONS — accidents, VIP, non éclairé,
 * portes de ville. Ce sont des caractères du terrain, pas des questions
 * posées : un poste protégé n'est jamais proposé au retrait, il n'y a donc
 * rien à y trancher, et aucune décision ne les fait varier. Leur appliquer le
 * même filtre ne changerait rien — sinon laisser croire qu'il s'y joue quelque
 * chose.
 */

/** Le périmètre, dit en toutes lettres — « Compagnie Agadir », « Maroc ». */
export function libellePerimetre(perimetre) {
  const mot = { region: 'Région', compagnie: 'Compagnie', brigade: 'Brigade' }[perimetre?.niveau];
  if (!mot || !perimetre?.unite) return 'Ensemble du territoire';
  return `${mot} : ${perimetre.unite}`;
}

/**
 * @param {object|null} rapport réponse de `/api/barrages/consolidation`
 * @returns {{
 *   perimetre: {niveau: string, unite: string|null},
 *   criteres: Array<{cle, emoji, libelle, nombre}>,
 *   concernes: number, examines: number, calculeeLe: string,
 * }|null} `null` tant qu'aucune optimisation n'a été lancée — l'écran affiche
 *   alors « Aucune optimisation effectuée », et surtout pas des zéros, qui se
 *   liraient comme un dispositif sans défaut.
 */
export function statistiquesOptimisation(rapport) {
  const postes = rapport?.barrages;
  if (!Array.isArray(postes)) return null;

  /* Le rapport peut contenir une occurrence par faction ; compter les postes
     physiques une seule fois, selon leur identifiant stable. */
  const idsVus = new Set();
  const postesUniques = postes.filter((b) => {
    if (b?.id == null || b.id === '') return true;
    if (idsVus.has(b.id)) return false;
    idsVus.add(b.id);
    return true;
  });

  const parametres = rapport.parametres ?? {};
  const retenus = CRITERES_OPTIMISATION.filter((c) => c.actif(parametres));

  /* Une seule traversée de la liste, et l'union se construit au passage. */
  const concernes = new Set();
  const criteres = retenus.map((c) => {
    let nombre = 0;
    for (const b of postesUniques) {
      if (!c.concerne(b)) continue;
      nombre++;
      concernes.add(b.id);
    }
    return { cle: c.cle, emoji: c.emoji, libelle: c.libelle, nombre };
  });

  return {
    perimetre: {
      niveau: parametres.niveau ?? 'national',
      unite: parametres.unite ?? null,
    },
    criteres,
    /** Postes distincts touchés par AU MOINS un critère — jamais la somme. */
    concernes: concernes.size,
    /** Ce que le calcul a examiné en tout : le dénominateur qui donne l'échelle. */
    examines: postesUniques.length,
    calculeeLe: new Date().toISOString(),
  };
}
