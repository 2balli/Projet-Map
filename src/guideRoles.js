/**
 * INSTRUCTIONS PAR RÔLE — ce que chaque compte peut faire, étape par étape.
 *
 * RIEN N'EST PROMIS QUE LE SERVEUR REFUSERAIT. Chaque étape décrit un geste
 * que serveur/api.mjs autorise réellement à ce rang ; les règles d'origine sont
 * citées à côté pour qu'une évolution des droits se répercute ici :
 *
 *   admin  `superviseur` + `REFUS_SUPERVISION` : il assigne et suit, il ne
 *          modifie, ne déplace ni ne supprime aucun barrage (403). Il valide
 *          les demandes des unités (`validateurPour`).
 *   reg    `droitFaction` : faction de tout barrage de sa région ; `peutModifier`
 *          + `validateurPour` : un déplacement part en demande de validation
 *          vers l'administration ; `cmndCieDeRegion` : il peut transmettre une
 *          assignation à un CMND Cie de sa région.
 *   cie    `droitFaction` : la faction des seuls barrages QUI LUI SONT ASSIGNÉS,
 *          sous forme de proposition à sa région (`soumettre-demande-approbation`) ;
 *          ses corrections de fiche partent en validation.
 *   unite  aucune assignation ni changement de faction ; ses corrections de
 *          fiche partent en validation ; relèves par créneau de 6 h.
 *
 * Les libellés cités (« Assignations », « Barrages », « Effectifs / Relèves »,
 * « Approbations », « Décisions », la cloche) sont ceux de l'interface : voir
 * `sectionsNavigation` dans src/GendarmerieMap.jsx et la barre du haut.
 */

export const GUIDES = {
  admin: {
    titre: 'Super Admin — Gestion des conflits',
    workflow: 'Filtrer / Analyser → Consulter les conflits → Voir sur la carte → Assigner au CMD_REGION',
    intro:
      'Vous disposez d’une vue globale de détection et de supervision. Vous filtrez les barrages, examinez les conflits et déléguez le traitement aux Commandants de Région.',
    etapes: [
      {
        titre: 'Filtrer et analyser les barrages',
        detail: 'Utilisez la barre repliable des filtres (Distance, Accidents, Barrage VIP, Éclairage) ou le filtre Faction pour analyser le dispositif.',
      },
      {
        titre: 'Consulter les conflits détectés',
        detail: 'Le panneau latéral liste les conflits avec leur numéro, barrages, route, distance routière réelle et statut.',
      },
      {
        titre: 'Voir sur la carte',
        detail: 'Cliquez sur « Voir sur la carte » pour centrer la vue, tracer l’axe routier réel et mettre en évidence les barrages.',
      },
      {
        titre: 'Assigner au CMD_REGION',
        detail: 'Assignez le conflit au Commandant de Région compétent (ou aux deux régions si inter-régions) avec consigne éventuelle.',
      },
      {
        titre: 'Suivre l’avancement opérationnel',
        detail: 'Consultez le statut (« À traiter », « En cours », « Résolu ») et l’historique des actions menées par la région.',
      },
    ],
    remarques: [
      'Vous supervisez et assignez les conflits. La modification opérationnelle des barrages relève du commandement territorial.',
    ],
  },

  reg: {
    titre: 'Commandant de Région — Traitement et délégation',
    workflow: 'Consulter le conflit assigné → Voir sur la carte → Traiter le conflit OU Assigner au CMD_COMPAGNIE',
    intro: 'Vous recevez les conflits assignés par le Superadmin pour votre région et pilotez leur résolution.',
    etapes: [
      {
        titre: 'Consulter le conflit assigné',
        detail: 'Au clic sur la notification reçue, le panneau latéral s’ouvre directement sur le conflit à traiter.',
      },
      {
        titre: 'Voir sur la carte',
        detail: 'Examinez la configuration géographique, la route réelle et la distance mesurée entre les barrages concernés.',
      },
      {
        titre: 'Traiter le conflit',
        detail: 'Appliquez une action de résolution autorisée : changez la faction d’un des barrages pour supprimer le conflit ou demandez un déplacement.',
      },
      {
        titre: 'Assigner au CMD_COMPAGNIE',
        detail: 'Transmettez le conflit à une Compagnie de votre région pour exécution sur le terrain, avec vos consignes.',
      },
      {
        titre: 'Confirmer et vérifier la résolution',
        detail: 'Toute action est consignée dans l’historique. Le conflit passe à « Résolu » lorsque les conditions de séparation sont satisfaites.',
      },
    ],
    remarques: [
      'La transmission à une compagnie maintient le conflit ouvert (« En cours ») jusqu’à sa résolution effective.',
    ],
  },

  cie: {
    titre: 'Commandant de Compagnie — Exécution locale',
    workflow: 'Consulter le conflit transmis → Voir sur la carte → Actions autorisées / Proposition',
    intro: 'Vous consultez les conflits transmis par votre Commandant de Région et effectuez les actions autorisées dans votre compagnie.',
    etapes: [
      {
        titre: 'Consulter le conflit transmis',
        detail: 'Accédez aux détails du conflit (route, distance routière, temps estimé, identité du CMND Région ayant transmis).',
      },
      {
        titre: 'Voir sur la carte',
        detail: 'Visualisez les barrages et la portion de route concernée dans votre secteur.',
      },
      {
        titre: 'Effectuer les actions autorisées',
        detail: 'Proposez un ajustement de faction ou soumettez une demande de repositionnement selon vos prérogatives.',
      },
      {
        titre: 'Consulter le statut et l’historique',
        detail: 'Suivez l’avancement et l’historique des décisions enregistrées sur le conflit.',
      },
    ],
    remarques: [
      'Seules les actions autorisées par vos droits de compagnie sont disponibles.',
    ],
  },

  unite: {
    titre: 'Commandant de Brigade',
    workflow: 'Consulter les barrages → Vérifier la fiche → Renseigner les relèves → Suivre les changements',
    intro: 'Vous consultez les barrages de votre brigade et suivez les changements qui les concernent.',
    etapes: [
      {
        titre: 'Consulter les barrages de votre brigade',
        detail: 'La carte se cadre automatiquement sur votre circonscription ; seuls vos barrages y sont affichés.',
      },
      {
        titre: 'Vérifier les informations d’un barrage',
        detail: 'Cliquez sur un barrage : sa bulle affiche ses informations (axe, rattachement, éléments présents du jour).',
      },
      {
        titre: 'Renseigner les éléments présents par créneau de 6 h',
        detail: '« Effectifs / Relèves » : ajoutez les militaires du créneau en cours ; date et créneau sont posés par le serveur.',
      },
      {
        titre: 'Demander une correction si nécessaire',
        detail: 'Une modification de fiche ou un déplacement part en demande de validation : il n’est appliqué qu’après acceptation.',
      },
      {
        titre: 'Suivre les changements dans les notifications',
        detail: 'La cloche signale les déplacements, changements de faction ou de statut et les validations touchant vos barrages.',
      },
    ],
    remarques: [
      'Les assignations et le changement de faction relèvent de la compagnie et de la région.',
    ],
  },
};

/** Le guide du compte connecté — `null` pour un rang inconnu. */
export function guidePour(session) {
  const guide = GUIDES[session?.rang];
  if (!guide) return null;
  /* Un compte en lecture seule n'écrit rien, quel que soit son rang (ROLES.lecture). */
  if (session?.role === 'lecture') {
    return {
      ...guide,
      remarques: [
        'Votre compte est en lecture seule : vous consultez, aucune modification n’est enregistrée.',
        ...guide.remarques,
      ],
    };
  }
  return guide;
}
