#!/usr/bin/env node
/**
 * ÉPREUVE DU DÉPÔT DES RELEVÉS — « ce créneau est-il déjà pris ? »
 *
 * Une seule règle est en jeu, et c'est la plus importante du roster : LA
 * PRÉPARATION AUTOMATIQUE NE DOIT JAMAIS ÉCRASER CE QU'UN CHEF A SAISI. Elle
 * tient à une seule question — « ce créneau porte-t-il déjà quelque chose ? »
 * — posée dans `preparer`.
 *
 * POURQUOI CE SCRIPT EXISTE. Cette question se posait par un balayage de tout
 * l'historique : `items.some((e) => e.barrageId === … && e.date === … &&
 * e.creneau === …)`. Sur 1 124 postes et 121 428 relevés, cela faisait 546
 * millions de comparaisons par journée préparée, et le coût croissait en
 * carré. Comme `preparerJournee` est SYNCHRONE et lancé au démarrage puis
 * toutes les heures, le service cessait de répondre pendant vingt-six
 * secondes par journée — processus vivant, aucune réponse, pas même sur une
 * connexion neuve.
 *
 * La question se pose désormais à l'index `occupation`, en temps constant.
 * Mais un index est une DUPLICATION de la vérité : il peut se désaccorder de
 * `items` — sur un retrait partiel, sur un retrait en masse, sur une saisie
 * humaine. Un désaccord ici ne se verrait pas à l'écran ; il se verrait le
 * lendemain, sur un roster qui aurait effacé une relève réelle.
 *
 * D'où ces contrôles : ils comparent le comportement de l'index à celui qu'on
 * attendait du balayage, cas par cas, y compris ceux qui ne se produisent
 * qu'une fois par mois.
 *
 *   node scripts/verifier-releves.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { creerDepotElements, creneauDe, CRENEAUX } from '../serveur/elements.mjs';
import { dateLocale } from '../serveur/roster.mjs';

let ok = 0;
const echecs = [];
const dit = (bon, titre, detail = '') => {
  console.log(`  ${bon ? 'RÉUSSI ' : 'ÉCHOUÉ '} ${titre}${detail ? ' — ' + detail : ''}`);
  if (bon) ok++;
  else echecs.push(titre);
};

const travail = mkdtempSync(join(tmpdir(), 'gr-releves-'));
const depot = creerDepotElements(join(travail, 'elements.json'));

const AUTEUR = {
  matricule: 'SYSTEME',
  nom: 'Préparation automatique',
  role: 'commandement',
  rang: 'admin',
  unite: 'systeme',
  reg: null,
  cie: null,
};
const EQUIPE = [
  { grade: 'MDLC', nom: 'Un', matricule: 'M1' },
  { grade: 'MDLG', nom: 'Deux', matricule: 'M2' },
];

const preparer = (barrageId, date, creneau) =>
  depot.preparer({ barrageId, date, creneau, personnes: EQUIPE, auteur: AUTEUR });

try {
  console.log('\n=== 1. UN CRÉNEAU NE SE PRÉPARE QU UNE FOIS ===\n');

  dit(preparer('b1', '2026-01-01', 0).ajoutes === 2, 'un créneau vide accepte la préparation');
  const second = preparer('b1', '2026-01-01', 0);
  dit(
    second.ajoutes === 0 && second.motif === 'creneau-non-vide',
    'le même créneau la REFUSE ensuite',
    second.motif,
  );

  console.log('\n=== 2. ET LES VOISINS RESTENT LIBRES ===\n');

  /* Les trois axes de la clé, un par un : se tromper d'axe donnerait un index
     qui refuse tout, ou qui n'oppose jamais rien. */
  dit(preparer('b1', '2026-01-01', 6).ajoutes === 2, 'un autre créneau du même jour reste libre');
  dit(preparer('b1', '2026-01-02', 0).ajoutes === 2, 'le même créneau d’un autre jour reste libre');
  dit(preparer('b2', '2026-01-01', 0).ajoutes === 2, 'le même créneau d’un autre poste reste libre');
  dit(depot.creneauOccupe('b1', '2026-01-01', 0) === true, '`creneauOccupe` concorde (occupé)');
  dit(depot.creneauOccupe('b9', '2026-01-01', 0) === false, '`creneauOccupe` concorde (libre)');

  console.log('\n=== 3. UN RETRAIT NE LIBÈRE QUE S IL NE RESTE RIEN ===\n');

  /**
   * L'index compte, il ne lève pas un drapeau. C'est la différence qui compte
   * ici : retirer une personne d'un poste qui en porte deux ne rend pas le
   * créneau préparable — il reste occupé par l'autre.
   */
  const lignes = depot.duBarrage('b1').filter((e) => e.date === '2026-01-01' && e.creneau === 0);
  dit(lignes.length === 2, 'le créneau porte bien deux lignes', `${lignes.length}`);

  depot.supprimer(lignes[0].id);
  dit(
    preparer('b1', '2026-01-01', 0).motif === 'creneau-non-vide',
    'après le retrait d’UNE ligne, le créneau reste pris',
  );

  depot.supprimer(lignes[1].id);
  dit(depot.creneauOccupe('b1', '2026-01-01', 0) === false, 'vidé de toutes ses lignes, il se libère');
  dit(preparer('b1', '2026-01-01', 0).ajoutes === 2, 'et il accepte à nouveau la préparation');

  console.log('\n=== 4. CE QU UN CHEF A SAISI NE S EFFACE PAS ===\n');

  /**
   * `creer` prend sa date et son créneau à l'HORLOGE DU SERVEUR, jamais du
   * corps de la requête — c'est ce qui rend la relève opposable et interdit
   * d'écrire dans un créneau passé. L'épreuve doit donc se placer sur le
   * créneau en cours, et non sur une date choisie : la choisir donnerait un
   * contrôle qui passe sans rien éprouver.
   */
  const AUJ = dateLocale(new Date());
  const ENCOURS = creneauDe(new Date());
  const AUTRE = CRENEAUX.find((c) => c !== ENCOURS);

  depot.creer({ barrageId: 'b3', grade: 'MDLC', nom: 'Saisi à la main', matricule: 'H1', auteur: AUTEUR });
  dit(
    depot.creneauOccupe('b3', AUJ, ENCOURS) === true,
    'une saisie humaine occupe le créneau en cours',
    `${AUJ} #${ENCOURS}`,
  );
  dit(
    preparer('b3', AUJ, ENCOURS).motif === 'creneau-non-vide',
    'la préparation refuse d’écrire par-dessus',
  );

  /* Et une re-préparation du jour ne défait que ce qu'elle avait proposé. */
  preparer('b3', AUJ, AUTRE);
  const bilan = depot.retirerPreparation(AUJ);
  dit(bilan.retires === 2, 'la re-préparation retire les lignes PROPOSÉES', `${bilan.retires}`);
  dit(bilan.creneauxHumains === 1, 'et compte le créneau humain qu’elle épargne', `${bilan.creneauxHumains}`);
  dit(depot.creneauOccupe('b3', AUJ, ENCOURS) === true, 'le créneau saisi reste OCCUPÉ');
  dit(depot.creneauOccupe('b3', AUJ, AUTRE) === false, 'celui qui n’était que proposé se rouvre');
  dit(
    preparer('b3', AUJ, ENCOURS).motif === 'creneau-non-vide',
    'et le créneau humain refuse toujours la préparation',
  );
  dit(preparer('b3', AUJ, AUTRE).ajoutes === 2, 'tandis que le créneau libéré l’accepte');

  console.log('\n=== 5. L INDEX ET LA MÉMOIRE NE DIVERGENT PAS ===\n');

  /**
   * LE CONTRÔLE DE DERNIER RECOURS : on recompte tout à la main et on compare.
   * Si l'index a dérivé d'une seule clé au fil des opérations ci-dessus, c'est
   * ici que cela se voit — et c'est ce qui autorise à s'y fier.
   */
  const attendu = new Map();
  for (const e of depot.duJour('2026-01-01').concat(depot.duJour('2026-01-02'), depot.duJour(AUJ))) {
    const k = `${e.barrageId}|${e.date}|${e.creneau}`;
    attendu.set(k, (attendu.get(k) ?? 0) + 1);
  }
  let divergences = 0;
  for (const [k] of attendu) {
    const [barrageId, date, creneau] = k.split('|');
    if (depot.creneauOccupe(barrageId, date, Number(creneau)) !== true) divergences++;
  }
  dit(divergences === 0, 'tout créneau réellement peuplé est vu comme occupé', `${attendu.size} clé(s)`);

  /* Et l'inverse : rien d'occupé qui ne soit peuplé. */
  let fantomes = 0;
  for (const date of ['2026-01-01', '2026-01-02', AUJ]) {
    for (const b of ['b1', 'b2', 'b3', 'b9']) {
      for (const c of CRENEAUX) {
        const peuple = depot.duJour(date).some((e) => e.barrageId === b && e.creneau === c);
        if (depot.creneauOccupe(b, date, c) !== peuple) fantomes++;
      }
    }
  }
  dit(fantomes === 0, 'et aucun créneau vide n’est vu comme occupé', `${fantomes} écart(s)`);
} finally {
  rmSync(travail, { recursive: true, force: true });
}

console.log(`\n  ${ok} réussi(s), ${echecs.length} échoué(s)`);
if (echecs.length) {
  console.error('');
  for (const e of echecs) console.error('  - ' + e);
  console.error('\nLe dépôt des relevés ne tient pas sa règle.\n');
  process.exit(1);
}
console.log('\nLa préparation n’écrase jamais une relève, et l’index dit vrai.\n');
