/**
 * QUI PEUT TRANCHER UNE DEMANDE — la règle, à un seul endroit.
 *
 * La liste de l'Optimisation propose désormais « Accepter / Refuser » sur un
 * retrait soumis au compte qui regarde. Plutôt que d'y recopier une troisième
 * fois la condition — après `peutDecider` dans src/NotificationsPanel.jsx et
 * les gardes du PATCH /api/instructions/:id dans serveur/api.mjs — elle est
 * écrite ici, calquée sur les gardes du serveur, qui sont les seules à faire
 * foi. `peutDecider` reste en place tel quel : il gouverne un parcours à deux
 * temps (lire, puis répondre) et non un bouton, et le toucher aurait changé le
 * panneau des notifications sans qu'on l'ait demandé.
 *
 * CE FICHIER NE PROTÈGE RIEN. Le serveur reste seul juge : il revérifie le
 * périmètre, l'auteur et le destinataire, et répond 403 quoi qu'affiche
 * l'écran. Ce qui est décidé ici, c'est uniquement s'il vaut la peine de
 * MONTRER un bouton — un bouton qui ne pourrait mener qu'à un refus du serveur
 * est un piège, pas une fonction.
 *
 * Les quatre conditions sont celles du serveur, dans le même ordre :
 *
 *   1. la demande est encore ouverte — une décision rendue ne se rejoue pas ;
 *   2. ce n'est pas une réclamation — elle s'instruit, elle ne se tranche pas
 *      d'un clic ;
 *   3. on n'est pas l'auteur — nul ne contresigne sa propre demande, dans les
 *      deux sens (unité → administration ET administration → commandement) ;
 *   4. on est bien le bord désigné par `aDecider` : « admin » réserve la
 *      décision à l'administrateur ; « unite » la réserve au commandement de
 *      région ou de compagnie, jamais au chef de brigade.
 */
export function peutTrancher(instruction, session) {
  const n = instruction;
  if (!n || !session) return false;
  if (n.statut !== 'ouverte') return false;
  if (n.action === 'reclamation') return false;
  if (n.auteur?.matricule && n.auteur.matricule === session.matricule) return false;
  if (n.aDecider === 'admin') return session.rang === 'admin';
  if (n.aDecider === 'unite') return session.rang !== 'unite';
  return true;
}

/**
 * LA DEMANDE DE RETRAIT OUVERTE SUR CE POSTE, si elle attend CE compte.
 *
 * Un poste peut traîner plusieurs pièces à son dossier — une conservation
 * ancienne, un refus, une pose. On ne retient que celle qui appelle une
 * réponse maintenant, et la plus récente s'il y en avait deux : c'est la
 * dernière proposition qui vaut.
 */
export function retraitATrancher(instructions, barrageId, session) {
  if (!barrageId) return null;
  return (
    [...(instructions ?? [])]
      .filter(
        (n) =>
          n.barrageId === barrageId && n.action === 'suppression' && peutTrancher(n, session),
      )
      .sort((a, b) => String(b.cree).localeCompare(String(a.cree)))[0] ?? null
  );
}
