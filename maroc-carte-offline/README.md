# Gendarmerie Royale — carte opérationnelle hors ligne

Carte complète du Royaume, provinces du Sud incluses, avec toutes les routes,
rues, villes, quartiers et points d'intérêt d'OpenStreetMap, et le
**dispositif territorial de la Gendarmerie Royale** : commandements régionaux,
compagnies, brigades territoriales et leurs circonscriptions. Une fois les
données préparées, **elle fonctionne sans aucune connexion internet**.

- **Circonscriptions** des 28 commandements régionaux, des compagnies et des
  504 brigades territoriales — l'échelon suit le zoom (voir ci-dessous)
- **Chefs-lieux** des unités, avec leur fiche (rattachement, population, superficie)
- **Péages, gares, aéroports, ports**, à afficher ou masquer
- Zoom jusqu'au niveau de la rue (tuiles vectorielles jusqu'au zoom 15, agrandies au-delà)
- Libellés en **français** ou en **arabe** (les noms en tifinagh apparaissent quand OSM les fournit)
- Thème **clair** ou **sombre**, à la charte de la Gendarmerie (bleu marine et or)
- Les **12 régions administratives**, à afficher ou masquer (masquées par défaut :
  elles ne coïncident pas avec les commandements)
- Accès direct à 12 villes et aux 28 commandements régionaux, échelle, plein écran, position GPS
- Clic droit : coordonnées du point (degrés, décimal et **Lambert Maroc**, copiables),
  **compétence territoriale** (brigade, compagnie, région, trajet depuis le siège)
- **Recherche** de villes, quartiers, lieux, rues et coordonnées (voir ci-dessous)
- **Mesure en mètres** (voir ci-dessous)
- **Analyse** : couverture des brigades, zone d'intervention, bouclage, tournée de patrouille
- **Croquis** (symboles, lignes, zones, textes ; GeoJSON / KML) et **impression** A4 / A3 ou PDF

## Gendarmerie Royale

Les couches viennent du projet **Carte tactique** (dossier « Projet Map »), qui
les produit par `npm run build:layers`. Elles sont importées une fois, sans
connexion :

```
npm run gendarmerie                                  (cherche « Bureau\Projet Map » dans OneDrive)
npm run gendarmerie -- --source "D:\Projet Map"      (ou le dossier public/layers lui-même)
```

L'import écrit `donnees/gendarmerie/` (≈ 3,6 Mo) et affiche ce qu'il a trouvé
et les anomalies de la source. À relancer quand la Carte tactique régénère ses
couches. Le lanceur le fait seul la première fois.

Si `Classeur4.xlsx` est présent à la racine du projet, l'import ajoute aussi
les unités du classeur (`Unite`, `RegroupementNiv1`, `Compagnie` et
coordonnées). Chaque ligne est rattachée **à ce qu'elle est**, d'après ses
colonnes, puis placée d'après sa position :

- « BT X », « EMCIE X » (état-major de la compagnie X) et « EMR X » (de la
  région X) sont le chef-lieu lui-même : doublons, écartés de la carte et de la
  recherche. Une compagnie **sans chef-lieu** dans la Carte tactique (Skhirate,
  Marrakech, Berrechid…) le reçoit à la position de son EMCIE ; sa fiche le dit ;
- les autres unités relèvent de leur compagnie (colonne `Compagnie`), à défaut
  de leur région (`RegroupementNiv1`, toujours pour les services d'EMR) : la
  fiche de ce chef-lieu les liste, « Unités rattachées », en précisant celles
  posées sur le site d'un autre chef-lieu ;
- une unité posée sur le site d'un autre chef-lieu (à moins de 30 m) figure
  aussi dans sa fiche, « Également sur ce site », avec l'unité dont elle relève ;
- les sites restants forment un point chacun (« EMR BOUARFA +19 »).

Des chefs-lieux posés au même point (une compagnie dans les locaux d'une
brigade, ou deux brigades superposées dans la source) se renvoient l'un à
l'autre dans leur fiche : « Sur le même site : … », d'un clic. `rapport.json`
signale les brigades superposées, les unités à plus d'1 km de leur chef-lieu et
les brigades du classeur posées sur une autre (positions à vérifier dans l'une
des deux sources). Les lignes sans coordonnées sont signalées et ne sont pas
affichées.

**Découpage selon le zoom.** Un seul découpage à la fois, comme sur la Carte
tactique : les **régions** en dessous du zoom 7, les **compagnies** de 7 à 9, les
**brigades** au-delà. Le panneau peut imposer un échelon (ou aucun) ; il indique
celui qui est affiché.

**Interface.** La carte occupe tout l'écran ; la marque et la recherche
flottent en haut, un rail à gauche ouvre un panneau à la fois (Couches, Mesure,
Analyse, Croquis, Imprimer, Affichage), la fiche de sélection s'affiche à droite et la barre d'état en bas
donne la position, le zoom et l'échelon affiché. Sur téléphone, le rail passe en
bas et les panneaux s'ouvrent en feuilles.

**Fiches.** Un clic sur un chef-lieu ouvre sa fiche : compagnie, région,
circonscription, population, superficie, densité, position, avec **Ajouter à
la mesure** (distance par la route jusqu'à un autre point) et **Voir la
circonscription**. Un clic sur une circonscription l'**isole** : le reste du
territoire est assombri et son contour tracé en or. « Aller à » cadre de la
même façon un commandement régional.

**Recherche.** Les unités sont dans la barre de recherche : « BT Drarga »,
« Cie Tétouan », « Reg Marrakech », ou simplement « brigade » ou
« gendarmerie » pour les plus proches du centre de la carte.

**Ce que l'import corrige et ce qu'il signale.**

- Les noms en capitales (« BT IMOUZER IDA OUTANANE ») sont remis en casse normale.
- Les accents perdus à l'encodage dans les chefs-lieux de compagnie
  (« Cie T�touan ») sont réparés d'après le nom de leur circonscription.
- Un chef-lieu est rattaché à la circonscription du même nom, à une variante
  d'orthographe près (Drarga / Drargua) ; à défaut, à celle qui le contient — la
  fiche l'indique alors « (par position) ».
- Les contours de compagnie dont le nom a été attribué par recoupement incertain
  (Tanger 44 %, Bouskoura 50 %…) portent l'avertissement dans leur fiche.
- Les **pointages de flottes ne sont pas importés** : la source les déclare
  générés aléatoirement.
- Un jeu **fictif** de la Carte tactique (`npm run fake:data`) est reconnu : la
  carte affiche alors le bandeau « Données fictives ».

Ces données décrivent l'implantation des unités : `donnees/` n'est pas
versionné (voir `.gitignore`), et la carte ne les envoie nulle part.

## Barages (données simulées)

Panneau **Couches → Barages** : une couche de points de contrôle, **masquée par
défaut**, rattachés aux brigades et **toujours posés sur une route carrossable**.
Le jeu fourni est **simulé** : ≈ 1 000 barages posés (de façon reproductible) sur
les routes des circonscriptions de brigade, pour tester l'affichage, les filtres,
la hiérarchie et l'édition. **Ce ne sont pas des emplacements opérationnels** ; la
carte l'indique (badge « Simulation », fiche, légende imprimée).

```
npm run barages                                  (1 000 barages, graine 1 — après « npm run data » et « npm run gendarmerie »)
npm run barages -- --graine 7 --nombre 2000
npm run barages -- --verifier                    (contrôle le jeu installé : valide, rattaché, sur des routes)
```

- **Barage fixe** (disque orange barré) : affecté à une **faction** de 6 h —
  00:00–06:00, 06:00–12:00, 12:00–18:00 ou 18:00–00:00. **Barage fixe
  intouchable** (octogone « 24 ») : permanent, **sans faction** (« non affecté »).
  La faction est une affectation enregistrée : la carte ne prétend pas qu'un
  barage est tenu à l'heure actuelle.
- **Routes** : voies publiques carrossables des tuiles (autoroutes à rues
  résidentielles et pistes), jamais une voie de service, une ruelle ou un chemin.
- **Filtres** : région, compagnie, brigade (chaque liste suit la précédente), type,
  **faction** (toutes, chacune des quatre, ou « Barages intouchables » seuls ;
  les **intouchables restent toujours affichés**, quelle que soit la faction — seul
  le type « Fixes » les masque) et
  **origine** (simulées / réelles), combinables ; chaque choix indique son nombre.
  La faction se choisit aussi **directement sur la carte** (barre « Faction » en bas,
  sous la recherche sur téléphone) : Toutes, Faction 1 à 4, Barages intouchables, et
  **Heure actuelle** (la faction qui couvre l'heure de l'appareil : 00:00–05:59 → 1,
  06:00 → 2, 12:00 → 3, 18:00–23:59 → 4).
- **Selon le zoom** : en dessous du zoom 7, un disque par **région** avec le nombre de
  barages ; de 7 à 9, un par **compagnie** ; à partir de 9, chaque barage ; à partir de
  11, le badge « SIM ». Un disque ne mêle jamais deux régions ou compagnies, ni simulés
  et réels (disque plein = réels, disque clair cerclé = simulés) ; ses nombres suivent les
  filtres. Un clic sur un disque approche la carte.
- **Simulé / réel** : icône à anneau pointillé pour un barage simulé. L'origine d'un
  barage du jeu installé ne se change pas dans la carte ; **Retirer les barages
  simulés** (Édition) les masque tous, les réels restent, « Annuler les modifications
  locales » les fait revenir.
- **Édition** (section Édition du panneau) : **Ajouter sur une route** puis cliquer
  sur la carte — le barage s'accroche à la route carrossable la plus proche (à moins
  de 150 m), dans la brigade du point ; sinon il n'est pas posé et un message le dit.
  La fiche d'un barage propose **Modifier** : nom, type, faction, donnée simulée ou
  réelle, **Déplacer** (sur une route de la même brigade seulement), Supprimer.
  Les modifications restent **dans ce navigateur** (le fichier du jeu n'est jamais
  modifié) ; **Exporter barages.json** donne le jeu complet à installer à la place
  de `donnees/barages/barages.json`, puis « Annuler les modifications locales ».
- **Hiérarchie** : un barage ne connaît que sa brigade (`btId`) ; compagnie et
  région viennent des circonscriptions importées, par leur nom. Trois compagnies
  nommées par des brigades n'ont pas de circonscription (Nouaceur, Fahs Anjra,
  Tamansourte) : leurs barages affichent « compagnie non résolue », rien n'est
  deviné d'après la position.
- **Remplacer** le jeu simulé par un jeu validé : déposer un fichier au même
  format (`src/barages.js`, avec `simulation: false`) à la place de
  `donnees/barages/barages.json` ; la carte le valide au chargement et écarte les
  enregistrements invalides. Les identifiants `bt-N` suivent l'ordre des
  circonscriptions importées : régénérez le jeu après chaque `npm run gendarmerie`
  (la carte le signale).
- `npm run transfert` prévient si des barages simulés vont entrer dans l'image Docker.

### Barages protégés et workflow d'optimisation

- **Barage fixe intouchable** (24 h/24) = **protégé** : il compte dans toutes les analyses
  (alertes, espacement, carte de chaleur) comme point de référence, mais l'optimisation ne le
  **déplace**, ne le **supprime** ni ne le **modifie** jamais. Sa fiche affiche « Barage
  fixe — intouchable » et ses boutons Déplacer / Supprimer sont désactivés. La protection est
  dans les règles (`retirerBarage`, dédoublonnage, corrections de qualité, déplacement) **et**
  à l'écriture : `CoucheBarages.remplacerEditions` refuse toute écriture qui atteindrait un
  barage intouchable (`atteintesProtegees`).
- **Barage fixe** (Faction 1 à 4) = **déplaçable** : Déplacer (vérifié par la route) et
  Supprimer (retrait avec historique, restaurable).
- Un intouchable est en service pendant les quatre factions : il est comparé aux barages de
  **chaque** faction (et aux autres intouchables) ; deux barages fixes ne sont comparés que
  s'ils ont la même faction.
- Alerte entre un intouchable et un déplaçable : actions sur le déplaçable seulement. Entre
  deux intouchables : « Alerte pour information », aucune action.
- La fiche d'un barage liste ses alertes (voisin, distance par la route) avec « Voir
  l'alerte », qui sélectionne l'alerte dans la liste et trace son itinéraire.

### Fiche d'un barage, retrait et historique

Un clic sur un barage ouvre sa fiche (nom, identifiant, type, faction, brigade, compagnie,
région, route, origine, position) avec :

- **Déplacer** : nouvel emplacement choisi sur la carte (marqueur, clic ou coordonnées),
  vérifié **par la route** contre les barages actifs de la même faction (seuil de l'onglet
  Proximité), enregistré seulement après confirmation, ancienne position gardée dans
  l'historique, **Annuler le déplacement** possible (tableau « Optimisation », onglet
  Déplacements).
- **Retirer** : après confirmation, le barage quitte le jeu actif (compteurs, filtres,
  calculs de proximité, d'espacement et de carte de chaleur) ; une copie complète (identifiant,
  nom, faction, type, brigade, coordonnées, route, métadonnées) et la date sont gardées, et son
  ancien emplacement reste marqué sur la carte : disque gris pointillé barré, « Ancien
  barage — retiré ». Un clic sur ce marqueur ouvre sa fiche (retiré le…, informations
  d'origine) avec **Restaurer**. « Supprimer » dans l'éditeur fait la même chose.
- **Fermer**.

Panneau Couches → Barages : interrupteurs **Barages actifs** et **Barages retirés
(historique)** (affichage seulement ; l'historique n'est jamais effacé par là). Les anciens
emplacements suivent les filtres de zone et d'origine, pas ceux de type ou de faction.

**Restaurer** remet l'enregistrement d'origine (même identifiant, faction, brigade,
métadonnées) ; refusé si un barage actif porte déjà cet identifiant, ou s'il a déjà été
restauré. Un nouveau barage ne reçoit jamais l'identifiant d'un barage retiré.

Où c'est gardé : dans la surcouche locale des barages (`localStorage`, ce navigateur), champ
`retraits`, écrit en même temps que le retrait lui-même ; il survit aux rechargements. Le
fichier installé n'est pas modifié ; « Exporter barages.json » ne contient que les barages
actifs. « Annuler les modifications locales » remet les barages et marque leurs retraits
« restaurés » sans effacer l'historique.

### Connexion et accès par région

Avec le serveur local (`npm start`) ou l'image Docker, **toute la carte est fermée sans
session** : la page, les données (barages, circonscriptions, unités, index de recherche…) et
l'API. Toute adresse renvoie vers la page de connexion (`/connexion.html`).

- **Créer les comptes** (une fois, sur le poste du serveur) :
  `npm run comptes -- initialiser` — crée `superadmin` et un compte régional `cr-<région>`
  par région du jeu installé (28 : `cr-rabat` → reg-21, `cr-beni-mellal` → reg-11, …). Le
  mot de passe est demandé au clavier (ou lu dans `MOT_DE_PASSE`) et n'est **jamais**
  enregistré en clair : seule son empreinte scrypt est gardée dans `etat/etat.json`. C'est un
  mot de passe **temporaire** (6 caractères au moins, ex. 123456 pour l'installation) :
  chaque utilisateur doit le changer à sa première connexion (10 caractères au moins) ; tant
  qu'il ne l'a pas fait, le serveur n'ouvre ni la carte ni l'API.
- **Superadmin** : accès complet (toutes les régions, optimisation, conflits, exports,
  journal) ; il crée, désactive et réinitialise les comptes (Optimiser → Comptes, ou
  `npm run comptes -- mot-de-passe <identifiant>` / `desactiver` / `activer`). Une
  réinitialisation pose un mot de passe temporaire et ferme les sessions du compte.
- **Compte régional** (`cr-…`) : la carte s'ouvre sur **sa région** ; le serveur ne lui envoie
  que les barages, circonscriptions, unités, étiquettes et entrées de recherche de cette
  région (même en tapant l'URL d'un fichier), et refuse les actions du superadmin (403). Il
  ne change ni son rôle ni sa région ; il consulte les barages sans les modifier et propose
  ses changements par **Optimiser** (conflits assignés). Le fond de carte, les lieux et les
  infrastructures publiques restent nationaux.
- **Session** : cookie HttpOnly ; fermée après 2 h sans activité et au plus tard 12 h après
  la connexion, au redémarrage du serveur, à la déconnexion (bouton **Compte** →
  **Se déconnecter**) ou au changement de mot de passe. **Compte** → **Changer le mot de
  passe** à tout moment.
- Régions : celles du jeu de la Gendarmerie (circo-reg.geojson, identifiants `reg-N`). Il
  n'existe pas de région « Drâa-Tafilalet » ni « Oriental » dans ce jeu : leurs territoires
  sont couverts par les comptes `cr-errachidia` / `cr-ouarzazate` et `cr-oujda` /
  `cr-nador` / `cr-bouarfa`. `npm run comptes -- regions` liste les régions.
- `npm run dev` (Vite seul) n'a pas de serveur de comptes : la carte s'ouvre sans connexion,
  sans optimisation ni données filtrées (développement uniquement).

### Optimisation des barrages

**Comptes et rôles** (serveur local `npm start` ou image Docker ; pas avec `npm run dev`) :

- **Superadmin** : seul à lancer l'optimisation. **Optimiser** → distance minimale par la
  route (km) + région (« Région actuelle » si la carte la montre sûrement, sinon un choix) →
  **Calculer** : la carte se cadre sur la région, seules ses paires non conformes sont
  montrées. Il coche des paires et **Assigner au commandement** : le serveur revérifie chaque
  paire (barages du jeu installé, même région, même faction, distance routière ≤ seuil),
  écarte les doublons et assigne au commandement de la région (choix explicite s'il n'y en a
  aucun ou plusieurs). Onglet **Conflits** : statuts, historique, décisions motivées sur les
  propositions (Approuver, Renvoyer pour correction, Rejeter), exports. Onglet **Comptes** :
  créer, désactiver, changer le mot de passe des commandements. L'administrateur ne déplace
  ni ne supprime aucun barage depuis l'optimisation.
- **Compte régional (commandement)** : **Optimiser** ouvre son espace — seulement les conflits qui lui
  sont assignés, dans sa région. Pour un barage déplaçable : **Proposer un déplacement**
  (marqueur, vérification routière en direct ; un emplacement non valide ne peut pas être
  proposé) ou **Proposer la suppression**, toujours motivé. Il ne modifie rien : il propose.
- **Approuvé ≠ appliqué** : l'administrateur télécharge « barages.json mis à jour » (les
  changements approuvés appliqués au jeu installé, les barages supprimés gardés dans
  `retraitsApprouves`) et l'installe par le processus habituel, puis marque le conflit
  **Résolu**. Les barages fixes intouchables ne sont jamais déplacés ni supprimés : conflit
  entre deux intouchables = « Bloqué — barrages fixes ».
- Statuts : À traiter, En cours, Proposition soumise, Renvoyée pour correction, Approuvé — à
  appliquer, Résolu, Rejeté, Bloqué — barrages fixes. Chaque étape est horodatée avec son
  auteur (historique du conflit et journal `etat/journal.jsonl`).
- Comptes : `npm run comptes -- initialiser` (voir « Connexion et accès par région ») ;
  `npm run comptes -- lister | regions | mot-de-passe <id> | desactiver <id> | activer <id>`,
  `creer-admin <identifiant> "<Nom>"` pour un superadmin supplémentaire.
  Les droits sont vérifiés par le serveur à chaque requête (rôle, région, propriété du
  conflit) ; un commandement qui force une URL d'une autre région reçoit « introuvable ».
- Données du serveur : dossier `etat/` (ou `$ETAT`), jamais servi : `etat.json` (comptes aux
  mots de passe hachés, conflits) et `journal.jsonl` (audit, en ajout seul).

**En une étape** : **Optimiser** (rail) ou **Optimisation des barrages** ouvre une petite
fenêtre — « Distance minimale par la route (km) », 10 km par défaut — avec **Calculer** et
**Annuler**. « Calculer » lance l'analyse sur tout le Royaume, toutes les factions (chacune
avec les intouchables), les deux types, et affiche aussitôt les **paires non conformes**
(même faction, distance par la route ≤ la distance saisie), leurs itinéraires sur la carte,
la faction commune, la distance, et si chaque barage est déplaçable ou intouchable. Un clic
sur une paire cadre son itinéraire ; Déplacer / Supprimer seulement sur les déplaçables ; deux
intouchables = information seule. Les paires dont la distance routière n'a pas pu être
vérifiée sont listées à part, jamais comme non conformes. « Modifier la distance » rouvre la
fenêtre ; « Outils avancés » donne accès au tableau complet décrit ci-dessous.

**Proximité** (premier onglet) : barages **de la même faction** proches **par la route**.

- **Paramètres**, choisis avant chaque analyse : distance routière maximale en km (libre,
  de 10 m à 100 km), faction (une seule, ou toutes — chacune analysée séparément ; les
  barages intouchables forment leur propre groupe), origine (simulés, réels, ou les deux —
  jamais appariés entre eux), région / compagnie / brigade. **Lancer l'optimisation** ;
  **Annuler l'analyse** pendant le calcul.
- **Règle d'alerte**, sans exception : les deux barages sont de la même faction **et** la
  distance par la route est inférieure ou égale au seuil. Des factions différentes ne sont
  jamais comparées, même à quelques mètres l'une de l'autre.
- **Distance par la route** : longueur du plus court itinéraire du moteur de la carte (tuiles
  locales, réseau national pour les longs trajets), calculée dans un fil séparé pour chaque
  paire de même faction. Itinéraire introuvable (routes non reliées) ou erreur du moteur :
  « Distance routière indisponible », jamais d'alerte, jamais de distance estimée.
- Pour éviter des milliers de calculs, une paire n'est envoyée au moteur que si la route
  **pourrait** être sous le seuil : la ligne droite (plus courte que toute route) sert de
  borne inférieure, avec une marge de 500 m pour les accroches à la route. Elle ne décide
  jamais d'une alerte et n'est pas affichée.
- **Résultats** : barages analysés, itinéraires calculés, alertes (par faction et par
  tranche de distance routière), paires au-delà du seuil, distances indisponibles, erreurs
  du moteur, propositions. Chaque alerte : noms et identifiants, faction commune, distance
  par la route, temps de trajet **estimé**, itinéraire sur la carte (« Voir l'itinéraire
  sur la carte »), « Étudier un changement d'emplacement ».

**Règle d'espacement unique** (alertes, déplacements, carte de chaleur, nouveaux barages) :
deux barages de la même faction sont trop proches si leur distance **par la route** est
inférieure ou égale au seuil D. Une paire existante à D ou moins est en alerte ; un
emplacement n'est **valide** que si chaque distance routière vérifiée vers la faction est
supérieure à D. Une route introuvable ne valide jamais rien.

**Zone** : la région (ou compagnie, brigade) choisie est cadrée et sa limite surlignée au
lancement ; limites introuvables → message d'erreur, la carte ne bouge pas ; **Retour à
toutes les régions**.

**Déplacements** : « Changer l'emplacement » sur une alerte.

- La carte se centre sur le barage et ses voisins ; un **marqueur violet** se fait glisser,
  ou un clic sur la carte (ou des coordonnées saisies) le déplace. L'emplacement est accroché
  à la route la plus proche (150 m au plus) **dans la brigade du barage**, sinon refusé.
- **Statut en direct**, recalculé à chaque changement : « Emplacement valide », « Emplacement
  non valide » (avec le barage, sa faction, la distance par la route et l'itinéraire en rouge),
  ou « Vérification impossible » (distance routière indisponible). Les autres factions ne
  comptent pas ; le barage déplacé n'est pas comparé à lui-même.
- Un emplacement non valide ne peut pas être appliqué : changer l'emplacement, ou changer
  explicitement la distance minimale (la modification est enregistrée). « Vérification
  impossible » demande de cocher une confirmation, enregistrée elle aussi.
- **Confirmer le nouvel emplacement** (nouvelle vérification puis dialogue), ou **Enregistrer
  comme proposition** puis Appliquer / Rejeter ; **Annuler le déplacement** ensuite.
  Identifiant, faction, brigade, type et origine ne changent jamais.

**Carte de chaleur** : une **surface continue** (image raster semi-transparente, sous les
noms de la carte), pas des points.

- Paramètres : faction du futur barage, distance routière minimale D, barages comparés
  (simulés ou réels), zone (région obligatoire, ou compagnie, brigade). La surface se
  **recalcule seule** quand l'un d'eux change, ou quand des barages sont ajoutés, déplacés ou
  supprimés.
- Calcul : des lieux sont pris le long des **routes carrossables des tuiles locales** de la
  zone (un tous les D/4, 250 m au moins ; 1 000 au plus), chacun vérifié **par la route** avec
  la règle commune (même faction seulement). Une grille (480 colonnes, dans la projection de
  la carte) reçoit en chaque cellule une aptitude interpolée des lieux vérifiés proches
  (rayon 2,5 × le pas), puis l'image est **découpée à la limite** de la zone.
- Couleurs : dégradé continu **rouge** (non adapté : un barage de la même faction à D ou
  moins par la route) → **orange** (incertain, à examiner) → **vert** (potentiellement adapté).
  **Gris** : inconnu (distance routière indisponible). **Voile léger** : aucune route
  carrossable proche. Une cellule dont le lieu vérifié le plus proche est non valide ne peut
  pas paraître adaptée ; une cellule dominée par des lieux non vérifiables est inconnue.
- **Clic sur la surface** : bulle temporaire (aptitude de l'endroit, lieu vérifié le plus
  proche, barages trop proches ou routes indisponibles) et itinéraires tracés ; aucun
  marqueur ajouté. **Prévisualiser un nouveau barage ici** (rien n'est créé), puis **Créer le
  barage…** (confirmation ; même chemin que l'outil « Ajouter »), **Annuler la création**
  dans « Déplacements ».
- Ce sont des suggestions : relief, visibilité, sécurité ou trafic ne sont pas dans les
  données, et la « couverture » n'est pas calculée au-delà de la règle d'espacement.

L'outil « Ajouter » de la carte signale aussi, après coup et sans bloquer, l'espacement du
barage posé avec la même règle (seuil de l'onglet Proximité).

**Autres onglets** (contrôle de la qualité des données) :

Bouton **Optimiser** (rail) ou **Optimisation des barrages** (groupe Barages) : un
tableau qui **analyse** les barages chargés (fichier + modifications locales) sans
rien modifier, dans un fil séparé (la carte reste utilisable ; barre de progression,
**Annuler l'analyse**).

- **Vue d'ensemble** : barages analysés, doublons exacts et quasi-doublons possibles,
  coordonnées et métadonnées en défaut, barages à vérifier, propositions en attente,
  approuvées, refusées, appliquées — chiffres calculés sur les données chargées.
- **Analyser** : périmètre (région, compagnie, brigade ; simulés, réels, ou les deux —
  **jamais rapprochés entre eux**).
- **Anomalies** : constats filtrables (type, gravité, statut, origine, région, texte),
  avec raison, preuves, indice, et « Voir sur la carte » / « Revenir à la vue précédente ».
- **Doublons** : **Analyser les doublons**, **Lancer le dédoublonnage**, **Annuler la
  dernière optimisation**, listes « Doublons confirmés », « Doublons potentiels à vérifier »,
  « Doublons supprimés », historique des optimisations, et carte (vert : conservé, rouge :
  à supprimer, orange : potentiel). Voir « Suppression des doublons » ci-dessous.
- **Simulation** : à l'analyse / actuellement / proposé, conséquences, aperçu de la
  position proposée sur la carte — **en lecture seule**.
- **Validation** : seules les propositions **approuvées** sont appliquées, après une
  nouvelle vérification (barage disparu, identifiant en double, valeur changée depuis
  l'analyse, résultat invalide → refus motivé) et une confirmation.
- **Règles** : seuil, champs comparés, contrôles actifs (routes : plus lent),
  gravité minimale, contrôle facultatif de chaque barage ajouté (un avis, pas un blocage).
- **Historique** : sessions (date, règles, constats, décisions, corrections avec avant /
  après) et **Annuler la modification**, refusée si le barage a changé depuis.

Les corrections proposées ne se déduisent que des données : latitude écrite en texte →
nombre, intouchable avec une faction → « continu », barage hors route → point de la route
la plus proche dans sa brigade. L'identifiant, la brigade et l'origine (simulé / réel) ne
sont jamais corrigés : seulement signalés, avec un indice.

#### Suppression des doublons (« Lancer le dédoublonnage »)

- **Doublon confirmé** — supprimé après confirmation : même origine (simulé ou réel,
  jamais mélangés), coordonnées à moins de 1 m (réglable), même type, faction et brigade,
  routes et noms compatibles (identiques ou un seul renseigné), identifiants distincts et
  uniques dans le jeu. Un nom semblable ne suffit jamais.
- **Doublon potentiel** — jamais supprimé, listé à vérifier : proche (30 m par défaut) sans
  remplir tout cela (autre faction au même endroit, autre nom, quelques mètres d'écart…),
  ou identifiant présent deux fois.
- **Barage conservé** : critères dans l'ordre réglable (coordonnées valides, identifiant au
  format reconnu, fichier installé plutôt qu'ajout local, données les plus complètes, liens
  vérifiés), puis le premier du fichier. Il garde son identifiant, sa brigade et son
  origine ; ses champs vides (nom, route, trace de validation) sont complétés seulement si
  les doublons s'accordent.
- Avant d'écrire : nouvelle recherche sur les données actuelles, dialogue avec le **nombre
  exact** de barages supprimés, une seule opération à la fois (y compris entre onglets),
  refus si les données ont changé entre-temps. La sauvegarde complète des modifications
  locales d'avant est enregistrée **avant** l'écriture ; toute erreur remet tout comme avant.
- Suppression = modification locale (identifiant masqué pour un barage du fichier, ajout
  local retiré) : le fichier installé n'est pas modifié. **Annuler la dernière
  optimisation** rétablit les barages et défait les compléments, en gardant les autres
  modifications faites depuis (refus si un barage concerné a changé).
- Jeu fourni : **aucun doublon confirmé** (ses 7 emplacements partagés portent des factions
  ou types différents) ; ils restent des doublons potentiels.

**Où c'est enregistré** : dans **ce navigateur** seulement (pas de compte ni de serveur).
Les corrections appliquées vont dans les modifications locales des barages, comme
l'édition ; le fichier installé n'est jamais modifié : **Exporter barages.json** pour les
transmettre. Règles et historique (20 sessions au plus) sont dans `localStorage` ; vider
les données du site les efface. Le tableau est en français seulement.

## Rechercher

Le champ en haut du panneau (raccourci **/** ou **Ctrl+K**) cherche, sans
connexion, parmi ≈ 104 000 entrées du Royaume :

- **villes, villages et quartiers** (« Agdal », « Ifrane »…) ;
- **lieux** : mosquées, écoles, hôpitaux, pharmacies, administrations,
  gendarmerie, gares, hôtels… — en tapant une **catégorie** (« pharmacie »,
  « مسجد ») on obtient les plus proches du centre de la carte ;
- **rues et routes** (« bd Zerktouni », « av Mohammed V », « A7 ») ;
- les **12 régions** ;
- des **coordonnées** : `33.5731, -7.5898`, `33,5731 -7,5898` ou
  `33°34′23″N 7°35′23″O`.

La recherche accepte le français et l'arabe, ignore les accents, les lettres
doublées (Mohammed / Mohamed) et les variantes d'écriture arabe (أ / ا, ة / ه),
comprend les abréviations (bd, av, pl…) et les chiffres romains (Hassan 2 =
Hassan II). Les résultats proches du centre de la carte passent en premier.

Flèches ↑ ↓ puis **Entrée** pour choisir : la carte s'y rend et affiche une
fiche (nom, catégorie, ville, coordonnées) avec **Ajouter à la mesure** — par
exemple pour mesurer la distance par la route entre deux lieux trouvés.

L'index (`donnees/data/recherche.json`, ≈ 6 Mo) est construit à partir des
tuiles par `npm run data` (≈ 3 min, une seule fois).

## Mesurer

Dans le panneau, section **Mesure** :

- **Distance** : cliquez pour poser des points ; chaque point s'accroche à la
  route la plus proche et **chaque tronçon suit les routes** (plus court
  chemin par le réseau routier, calculé hors ligne), jamais à travers les
  bâtiments. Un aperçu suit le curseur. Maintenez **Alt** en cliquant pour un
  segment volontairement à vol d'oiseau. Double-clic ou **Échap** pour
  terminer, **⌫** pour retirer le dernier point.
- **Entre 2 routes** : cliquez une route, puis une autre ; la carte trace le
  segment le plus court entre elles, à vol d'oiseau, et affiche l'écart
  (« 0 m » si elles se croisent) avec le nom des deux routes.

L'itinéraire utilise les routes, rues et voies de service d'OpenStreetMap
(pas les trottoirs, escaliers ni voies ferrées) ; un pont n'est jamais relié
à la route qu'il enjambe. Les sens interdits ne sont pas pris en compte :
c'est une mesure de distance, pas un guidage. Si aucune route ne relie deux
points, le tronçon est mesuré à vol d'oiseau et le panneau le signale.

**Autoroutes en priorité** (par défaut) : l'itinéraire retenu est celui du plus
faible temps estimé, avec des vitesses de référence par catégorie — autoroute
120 km/h, voie express 100, nationale 80, régionale 70, rue 30. Les autoroutes
l'emportent donc dès que le détour est raisonnable (ex. Casablanca → Marrakech
par l'A3 et l'A7, 239 km). Le bouton **Plus court** donne à la place le plus
court chemin en distance (même trajet : 236 km par la N9). La distance
affichée est toujours la longueur réelle de l'itinéraire tracé.

**Aucune limite de distance** : de deux rues voisines à Tanger → Guerguerat
(≈ 2 230 km). Jusqu'à 15 km à vol d'oiseau, l'itinéraire est calculé rue par
rue. Au-delà, il passe par un **graphe routier national** précalculé
(`donnees/data/reseau-national.bin`, ≈ 12 Mo, construit par `npm run data`) :
autoroutes, nationales et régionales, avec les rues seulement pour le départ et
l'arrivée ; le total est alors marqué « ≈ ».

Les distances sont mesurées sur l'axe des voies ; au zoom 14 et plus, la
précision est meilleure que le mètre.

## Analyser

Onglet **Analyse**, et clic droit sur la carte. Tout est calculé hors ligne.

- **Compétence territoriale** (clic droit) : brigade, compagnie et région dont
  la circonscription contient le point, et trajet par la route depuis le siège
  de la brigade compétente (distance et temps estimé). « Tracer le trajet » le
  reporte dans la mesure.
- **Couverture des brigades** : temps d'accès par la route au chef-lieu de
  brigade le plus proche, sur tout le Royaume (≤ 15, 30, 45, 60, 90, 120 min,
  au-delà), avec la part du territoire de chaque classe. Au survol, la barre
  d'état donne le temps et la brigade la plus proche. Calcul ≈ 3 s, une fois.
- **Zone d'intervention** : ce qu'une unité atteint en 15, 30, 60 ou 90 min
  (bouton de sa fiche, ou clic droit pour un point quelconque), et la surface
  correspondante.
- **Bouclage** : cliquez un centre et choisissez un rayon (1 à 20 km) ; la carte
  numérote chaque route qui franchit le cercle, avec sa direction (N, NE…) et
  ses coordonnées. Chaussées séparées et bretelles comptent pour une sortie.
  « Axes principaux » (jusqu'aux routes tertiaires) ou « Toutes les voies » ;
  « Copier la liste » pour la transmettre.
- **Tournée de patrouille** : cliquez des étapes (ou des unités, ou « Ajouter à
  la tournée » dans une fiche) ; la première est le départ. « Optimiser
  l'ordre » donne l'ordre de visite le plus rapide (exact jusqu'à 12 étapes,
  15 au plus), avec ou sans retour au départ, puis trace l'itinéraire.

Les temps sont des **estimations de planification** aux vitesses de référence
de la mesure (autoroute 120 km/h…) : ni circulation, ni relief, ni sens
interdits. La couverture et les zones d'intervention passent par le réseau
national (grands axes) ; hors de ce réseau, le terrain est compté à 20 km/h
(routes secondaires et pistes non comprises dans ce réseau).

## Coordonnées Lambert

Le clic droit donne aussi les coordonnées **Lambert Maroc** (système Merchich),
dans la zone du point : Nord Maroc, Sud Maroc, Sahara Nord ou Sahara Sud
(EPSG 26191, 26192, 26194, 26195), avec « Copier Lambert ». Panneau
**Affichage → Coordonnées** : la barre d'état les affiche en degrés ou en
Lambert. Les sorties de bouclage copiées et imprimées portent leurs
coordonnées Lambert. Le passage WGS 84 → Merchich se fait par translation
(31, 146, 47 m) : quelques mètres de précision, comme les logiciels SIG
courants avec ces mêmes paramètres.

## Croquis

Onglet **Croquis** : poser des **symboles** (repère, barrage, incident,
rassemblement, poste de commandement, observation), des **lignes**, des
**zones** et des **textes**, en cinq couleurs, chacun avec un libellé. Un clic
sur un élément le sélectionne pour le renommer, le recolorer ou le supprimer
(touche Suppr). Lignes et zones : un clic par sommet, double-clic ou Entrée
pour terminer, ⌫ pour retirer le dernier sommet, Échap pour annuler.

Le croquis est enregistré **dans ce navigateur** (il survit à la fermeture de
la carte). Pour le transmettre : **Exporter GeoJSON** ou **Exporter KML**
(Google Earth, QGIS, GPS) ; **Importer…** relit ces deux formats, y compris
des fichiers venus d'autres logiciels.

## Imprimer

Onglet **Imprimer** : format **A4 ou A3**, paysage ou portrait, échelle (vue
actuelle, ou 1:5 000 à 1:1 000 000), quadrillage **Lambert** (km),
**géographique** ou aucun, titre, mention facultative (« Diffusion
restreinte »…) et notes. Un cadre doré montre sur la carte l'emprise qui sera
imprimée. **Imprimer / PDF** compose la feuille hors ligne — cartouche de la
Gendarmerie, carte à ≈ 240 ppp, nord, barre d'échelle, légende de ce qui est
affiché (circonscriptions, unités, couverture ou zone d'intervention,
bouclage, tournée, croquis), listes des sorties de bouclage et des étapes de
tournée, centre en degrés et en Lambert — puis ouvre la boîte d'impression ;
choisissez « Enregistrer au format PDF » pour un fichier. La feuille est
toujours en thème clair.

## Lancer la carte

Double-cliquez sur **`Lancer-la-carte.cmd`**. Le navigateur s'ouvre sur
<http://localhost:5555>. Fermez la fenêtre noire pour arrêter la carte.

Ou en ligne de commande :

```
npm start
```

La **première fois seulement**, le lanceur a besoin d'internet pour installer
les dépendances (`npm install`), télécharger les données (`npm run data`,
≈ 540 Mo) et compiler l'application (`npm run build`). Ensuite, plus aucune
connexion n'est nécessaire. Il importe aussi les couches de la Gendarmerie
(`npm run gendarmerie`, sans connexion) ; si le projet Carte tactique est
introuvable, la carte s'ouvre sans elles et le panneau le signale.

Prérequis : [Node.js](https://nodejs.org) 22.12 ou plus récent.

## Utiliser la carte sur un autre ordinateur sans internet

Copiez **tout le dossier** (y compris `node_modules/`, `dist/` et `donnees/`)
sur l'autre poste, par exemple avec une clé USB. Il suffit que Node.js y soit
installé ; double-cliquez ensuite sur `Lancer-la-carte.cmd`.

Pour la rendre accessible aux autres postes d'un réseau local (sans internet),
lancez dans une invite de commandes :

```
set "HOTE=0.0.0.0" && node serveur.mjs
```

puis ouvrez `http://<adresse-de-ce-poste>:5555` sur les autres postes.

## Déployer avec Docker (réseau isolé)

Pour servir la carte depuis un conteneur Docker sur un réseau sans internet :

1. **Préparer le paquet** (sur ce poste, avec Docker et une connexion) :

   ```
   npm run transfert
   ```

   Le dossier `transfert/carte-gendarmerie-<version>/` contient l'image Docker
   (≈ 0,6 Go), un `docker-compose.yml`, des scripts d'installation et un
   `LISEZMOI.md`.

2. **Copier** ce dossier sur le serveur cible (clé USB, disque).

3. **Installer** sur le serveur (Docker requis, internet non) :

   - Linux : `sh installer.sh`
   - Windows : clic droit sur `installer.ps1` > « Exécuter avec PowerShell »

La carte est accessible sur `http://<adresse-du-serveur>:5555`.
Voir `docker/LISEZMOI.md` pour les détails (arrêt, mise à jour, changement de
port).

## Mettre à jour les routes

Les données OpenStreetMap évoluent en permanence. Pour récupérer la dernière
version (connexion requise) :

```
npm run data -- --force
```

## Contenu du dossier

| Élément | Rôle |
|---|---|
| `Lancer-la-carte.cmd` | lanceur à double-cliquer |
| `serveur.mjs` | petit serveur local, sans dépendance, qui sert l'application et les données |
| `src/carte-style.js` | style de la carte : fond OSM adapté au Royaume, 12 régions |
| `src/main.js`, `index.html`, `src/style.css`, `src/dom.js` | interface |
| `src/analyse.js` | onglet Analyse : couverture, zone d'intervention, bouclage, tournée |
| `src/couverture.js`, `src/couverture-worker.js` | temps d'intervention par la route (calculés hors du fil de la carte) |
| `src/bouclage.js`, `src/tournee.js`, `src/competence.js` | sorties d'un cercle, ordre de visite, circonscription d'un point |
| `src/croquis.js` | croquis : symboles, lignes, zones, textes ; import / export GeoJSON et KML |
| `src/impression.js` | feuille imprimée A4 / A3 : cartouche, quadrillage, échelle, légende |
| `src/lambert.js` | coordonnées Lambert Maroc (Merchich, 4 zones) |
| `scripts/telecharger-donnees.mjs` | téléchargement unique des données dans `donnees/` |
| `donnees/tiles/maroc.pmtiles` | toutes les tuiles du Maroc (un seul fichier) |
| `donnees/fonts/`, `donnees/sprites/` | polices et icônes |
| `donnees/data/` | régions, limites entre régions, points d'étiquette, graphe routier national |
| `src/itineraire.js`, `src/reseau-national.js` | calcul d'itinéraire hors ligne (rues, puis grands axes) |
| `src/recherche.js`, `src/recherche-worker.js`, `src/barre-recherche.js` | recherche hors ligne (index, worker, interface) |
| `scripts/index-recherche.mjs` | construction de l'index de recherche à partir des tuiles |
| `scripts/importer-gendarmerie.mjs` | import des couches de la Carte tactique dans `donnees/gendarmerie/` |
| `src/gendarmerie-style.js` | couches de la Gendarmerie : couleurs, découpage selon le zoom, sélection |
| `src/gendarmerie.js` | fiches des unités et circonscriptions, réglages du panneau |
| `src/barages.js`, `src/couche-barages.js` | barages : format, génération, hiérarchie, filtres ; couche, panneau, fiche |
| `src/optimisation.js`, `src/optimisation-worker.js`, `src/optimisation-ui.js` | optimisation des barrages : contrôles, doublons, propositions, application et annulation ; analyse en fil séparé ; tableau |
| `src/proximite.js`, `src/proximite-ui.js` | règle d'espacement par la route (même faction), alertes, déplacement interactif, carte de chaleur des emplacements, zone cadrée ; onglets Proximité, Déplacements, Carte de chaleur |
| `src/dedoublonnage.js`, `src/dedoublonnage-ui.js` | suppression des doublons confirmés : détection, barage conservé, plan, annulation ; onglet Doublons |
| `scripts/generer-barages.mjs` | jeu de barages simulés dans `donnees/barages/` |
| `src/assets/` | logo de la Gendarmerie Royale |
| `donnees/gendarmerie/` | circonscriptions, chefs-lieux, infrastructures, index de recherche des unités, rapport d'import |
| `Dockerfile`, `.dockerignore` | image Docker autonome (compilation + données) |
| `docker/` | modèles pour le paquet de transfert (`docker-compose.yml`, installateurs, `LISEZMOI.md`) |
| `scripts/preparer-transfert.mjs` | construit l'image et assemble le paquet dans `transfert/` |

Commandes utiles : `npm run dev` (développement, http://localhost:5174),
`npm test` (tests).

**Performances.** Pour l'usage courant, préférez `npm run build` puis `npm start`
(http://localhost:5555) : le serveur de développement charge MapLibre non compressé
(≈ 12 Mo au lieu de 6). Les itinéraires (mesure, compétence, tournée, bouclage, barages)
sont calculés dans un worker : la carte ne se fige plus pendant leur calcul. Si le
navigateur dessine sans carte graphique (accélération matérielle désactivée), la carte
devient 10 à 20 fois plus lente : un bandeau le signale en haut de l'écran.

## Représentation du territoire

La carte représente le Royaume dans ses frontières, provinces du Sud
incluses :

- la ligne de séparation que certaines sources tracent au sud (frontière
  marquée « contestée » dans OpenStreetMap) n'est pas affichée ;
- le libellé de pays « RASD » n'est pas affiché ;
- le découpage régional est celui des 12 régions de 2015, dont
  Laâyoune-Sakia El Hamra et Dakhla-Oued Ed-Dahab.

Ces adaptations sont faites dans `src/carte-style.js` (`adapterCouchesMaroc`).

## Sources et licences

| Données | Source | Licence |
|---|---|---|
| Routes, villes, bâtiments, POI… | © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), tuiles [Protomaps](https://protomaps.com) | ODbL |
| 12 régions | [geoBoundaries](https://www.geoboundaries.org) (gbOpen MAR ADM1) | ODbL |
| Circonscriptions et chefs-lieux | Gendarmerie Royale, via la Carte tactique | usage interne |
| Péages, gares, aéroports, ports | © contributeurs OpenStreetMap, via la Carte tactique | ODbL |
| Polices (Noto Sans) et icônes | [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets) | voir le dépôt |
| Affichage | [MapLibre GL JS](https://maplibre.org), [PMTiles](https://github.com/protomaps/PMTiles) | BSD-3 |

L'attribution OpenStreetMap reste affichée en bas à droite de la carte,
comme l'exige la licence ODbL.
