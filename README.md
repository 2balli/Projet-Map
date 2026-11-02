# Gendarmerie Royale — Carte Tactique

Carte React + Leaflet alimentée par les données réelles de `data/`.
Fond de carte : la carte hors ligne de `maroc-carte-offline` (archive PMTiles servie sous `fond-carte/`).

```bash
npm install
npm run build:layers   # data/**  ->  public/layers/*.geojson   (à relancer à chaque changement de données)
npm run serve:api      # service d'habilitation, port 8080  (saisie des chefs — §6)
npm run dev            # http://localhost:5173
```

Pour livrer sur le réseau interne : **[§4 Déploiement intranet](#4-déploiement-intranet)**.

### Sans les données réelles (démonstration)

Si `data/` n'est pas disponible, un jeu **fictif** remplit les mêmes couches :

```bash
npm run fake:data      # -> public/layers/*.geojson   (aucune donnée réelle)
npm run dev
```

Voir **[§5 Jeu de données fictif](#5-jeu-de-données-fictif)**.

---

## Comment ça marche

Les fichiers de `data/` font **88 Mo** : impossible de les charger tels quels dans un
navigateur. Le pipeline est donc en deux temps :

```
data/**.json  ──[ npm run build:layers ]──>  public/layers/*.geojson  ──[ fetch à la coche ]──>  carte
   88 Mo              simplification              3,6 Mo                   chargement paresseux
```

`npm run build:layers` est un script **hors ligne** : il ne tourne pas dans le
navigateur. Tant que vous ne le relancez pas, la carte continue d'afficher les
anciennes couches.

| Fichier | Rôle |
|---|---|
| [scripts/build-layers.mjs](scripts/build-layers.mjs) | **QUELS fichiers lire** — le tableau `SOURCES` en haut |
| [src/layersConfig.js](src/layersConfig.js) | **COMMENT les afficher** — nom, couleur, épaisseur, actif par défaut |
| [src/mapConfig.js](src/mapConfig.js) | Fond de carte hors ligne (chemin `fond-carte/`, bornes de zoom) |
| [src/GendarmerieMap.jsx](src/GendarmerieMap.jsx) | La carte — rien à toucher pour ajouter une couche ordinaire |

---

## 1. Changer un fichier de données

**Cas le plus simple : même format, fichier plus récent.**
Remplacez le fichier dans `data/` en gardant le même nom, puis :

```bash
npm run build:layers
```

Rien d'autre à modifier.

**Si le nom ou le chemin change**, ouvrez [scripts/build-layers.mjs](scripts/build-layers.mjs)
et corrigez le champ `in:` de l'entrée concernée :

```js
{
  kind: 'points',
  in:   'dataPoint/bt_2026.json',   // <-- nouveau chemin, relatif à data/
  out:  'pts_bt.geojson',
  props: { nom: 'Unite', cie: 'Compagnie', reg: 'Region' },
},
```

Si un fichier listé est absent, le script l'annonce (`! FICHIER ABSENT`) et
continue avec les autres — il ne plante pas.

---

## 2. Ajouter une couche

Deux entrées à écrire. Aucune modification de `GendarmerieMap.jsx`.

### Étape A — déclarer la source

Dans le tableau `SOURCES` de [scripts/build-layers.mjs](scripts/build-layers.mjs).
Trois `kind` sont disponibles :

**`points`** — un GeoJSON de points. `props` fait la correspondance
`champ affiché <- champ du fichier` (une liste = le premier non vide gagne) :

```js
{
  kind:  'points',
  in:    'dataPoint/postes_frontiere.json',
  out:   'pts_frontiere.geojson',
  props: { nom: ['denom_fr', 'Unite'], cie: 'Compagnie', reg: 'Region' },
},
```

**`polygons`** — un GeoJSON surfacique, `FeatureCollection` ou
`GeometryCollection`. `simplify` règle l'allègement (plus bas = plus léger),
`keep` liste les seules colonnes à conserver :

```js
{
  kind:     'polygons',
  in:       'Circonscription/Circonscription_Provinces.json',
  out:      'circo_prov.geojson',
  simplify: '6%',
  keep:     'nom_prov,population',   // à omettre s'il n'y a aucun attribut
},
```

### Étape B — déclarer l'affichage

Dans [src/layersConfig.js](src/layersConfig.js), ajoutez l'entrée au tableau
correspondant. Le champ `url` pointe sur le `out:` de l'étape A.

Pour une couche surfacique — `CIRCO_LAYERS` :

```js
{
  key:         'circo_prov',
  url:         'layers/circo_prov.geojson',
  label:       'العمالات (Circonscriptions Provinces)',  // texte de la case à cocher
  color:       '#8e7cc3',
  weight:      1.5,
  fillOpacity: 0,
  defaultOn:   false,   // true = chargée dès l'ouverture
  anonymous:   true,    // true si les polygones n'ont aucun attribut
},
```

Pour une couche ponctuelle — `POINT_LAYERS` :

```js
{
  key:            'pts_frontiere',
  url:            'layers/pts_frontiere.geojson',
  label:          'مراكز الحدود (Postes frontière)',
  color:          '#2f8fd8',
  radius:         5,
  defaultOn:      false,
  permanentLabel: false,   // true = nom toujours affiché (à réserver aux couches < ~50 points)
},
```

### Étape C

```bash
npm run build:layers
```

La case apparaît dans le sélecteur en haut à droite. **Le fichier n'est
téléchargé qu'au moment où l'utilisateur coche la case** (sauf `defaultOn: true`),
et une seule fois par session.

---

## 3. Le fond de carte

**Un seul fond : la carte hors ligne de `maroc-carte-offline`.** Fond
vectoriel Protomaps dans une archive PMTiles (`donnees/tiles/maroc.pmtiles`,
zooms 0 à 15, provinces du Sud comprises), polices et sprites locaux, règles
cartographiques propres au Maroc. Le style est celui de ce projet, importé tel
quel (`construireStyle`, maroc-carte-offline/src/carte-style.js) et dessiné
par MapLibre sous les couches de l'application
([src/components/map/FondCarteVectoriel.jsx](src/components/map/FondCarteVectoriel.jsx)).
Les routes, leurs numéros et leurs noms viennent de ce fond.

Le fond est servi par la même origine que l'application, sous `fond-carte/`,
avec les requêtes partielles qu'exige l'archive :

| Contexte | D'où vient `fond-carte/` |
|---|---|
| `npm run dev` | `maroc-carte-offline/donnees/` (greffon `fondCarte` de vite.config.js) |
| `npm run serve*` | `./fond-carte` à côté du script, sinon `maroc-carte-offline/donnees/` ; ou `--fond-carte <dossier>` |
| paquet intranet | `fond-carte/` copié à côté de `serve.mjs` par `npm run package` |

L'archive se télécharge une fois, dans `maroc-carte-offline` :
`npm run data`. Si elle manque, le panneau latéral affiche **hors ligne** et
un encart « Fond de carte injoignable » propose de réessayer — les repères,
contours et calculs restent opérationnels.

---

## 4. Déploiement intranet

L'application est **entièrement autonome** : aucune ressource externe, aucun CDN,
aucune police distante. Les images de Leaflet sont inlinées en base64 et les
icônes sont des SVG générés dans le code. Le fond de carte est servi par le
même serveur que l'application.

```bash
npm run build:layers   # si les données ont changé
npm run build
npm run package        # -> intranet/ + carte-gendarmerie-intranet.zip  (1,1 Mo)
```

`npm run package` **refuse de produire le paquet** si une ressource externe non
autorisée subsiste dans le build — impossible de livrer par accident une
version qui dépendrait d'internet.

Le paquet contient :

| | |
|---|---|
| `dist/` | l'application, 3,7 Mo dont 3,6 Mo de couches |
| `serve.mjs` | serveur statique **sans aucune dépendance** |
| `demarrer.cmd` | lancement par double-clic sous Windows |
| `LISEZ-MOI.txt` | procédure de déploiement |

### Servir le paquet

**Sans rien installer** (Node.js seul suffit) :

```bash
node serve.mjs --port 8080          # ou double-clic sur demarrer.cmd
```

Le serveur affiche au démarrage l'adresse réseau à donner aux postes clients.
Il gère les types MIME (dont `.geojson`), protège contre la traversée de
répertoire, met en cache indéfiniment les fichiers à empreinte
(`assets/index-a1b2.js`) et jamais `index.html` ni `layers/` — sinon une mise à
jour des données resterait invisible côté client.

**Sur un serveur existant** (IIS, Apache, nginx) : copiez le contenu de `dist/`
dans le répertoire publié. Les chemins sont relatifs (`base: './'`), donc la
racine du site comme un sous-répertoire `/carte/` fonctionnent sans
reconfiguration. Veillez à ce que `.geojson` soit servi (sinon déclarez-le en
`application/json`).

### Reconstruire sur un poste isolé

```bash
npm run package:sources          # -> carte-gendarmerie-sources.zip  (62 Mo)
npm run package:sources -- --data   # + les 86 Mo de GeoJSON brut
```

L'archive embarque `node_modules` : **aucun `npm install` n'est nécessaire**, ce
qui est le seul moyen fiable sur un poste sans accès au registre npm. Vérifié en
extrayant l'archive ailleurs et en relançant `npm run build` : mêmes empreintes
de fichiers, build reproductible.

Deux limites : les binaires natifs de Vite sont compilés pour **Windows x64**
(un autre système exigerait un `npm install` en ligne), et `data/` n'est inclus
qu'avec `--data` — il ne sert qu'à régénérer les couches, pas à compiler
l'application.

---

## 5. Jeu de données fictif

### La règle des trois

**Un barrage est tenu par exactement 3 hommes sur un créneau.** La constante est
`ELEMENTS_PAR_BARRAGE` — [src/marquages.js](src/marquages.js) pour l'interface,
[serveur/elements.mjs](serveur/elements.mjs) pour le service (duplication
assumée, comme `GRADES` ; `npm run check:trois` échoue si les deux divergent).

Un « élément » est une **présence datée**, rattachée à l'un des quatre créneaux
de six heures — pas une affectation permanente. La règle porte donc sur le
couple *(poste, créneau)* : trois hommes de 6 h à 12 h, trois autres ensuite. Un
poste accumule quatre relèves par jour depuis son ouverture.

| Où | Ce qui est tenu |
|---|---|
| Jeu fictif | chaque poste naît avec ses 3 hommes, pris dans sa propre brigade ; une brigade qui ne peut pas en aligner 3 ne tient aucun poste |
| Interface | bouton d'ajout éteint à 3, reprise de créneau écrêtée, badge `3/3`, lignes numérotées |
| Fournisseur fictif | 400 sur un 4ᵉ homme, sur un inconnu, sur un doublon, sur un homme d'une autre brigade |
| Serveur réel | mêmes refus sur `POST /api/elements` (aucun contrat modifié : seulement des 400 supplémentaires) |
| Composition | `composition-barrage.json` dit QUELS grades ; la règle dit COMBIEN et **écrête** toute composition plus nombreuse, avec un avertissement au journal |

Les relèves déjà écrites ne sont pas réécrites au vol : c'est un historique.
Pour l'aligner sur un jeu de **démonstration** :

```bash
node scripts/aligner-trois.mjs              # aperçu, n'écrit rien
node scripts/aligner-trois.mjs --ecrire     # applique, avec sauvegarde *.avant-trois
```

Il **refuse** un dossier dont `mode.json` n'annonce pas `demo`, retire les
surnuméraires en gardant les plus gradés, et **ne complète jamais** un créneau
incomplet — inventer une présence est exclu ; la préparation du roster sait le
faire avec l'effectif réel de la brigade.

### Deux modes fictifs, à ne pas confondre

| | **FICTIF** (navigateur) | **DÉMONSTRATION** (serveur) |
|---|---|---|
| Ce qu'il faut lancer | `npm run dev` | `npm run serve:demo` |
| D'où viennent les données | engendrées dans la page | `donnees-demo/`, semées par `semer-demo.mjs` |
| Écritures | vivent le temps de l'onglet | écrites sur le disque, partagées entre postes |
| Pour quoi faire | développer et éprouver l'interface | montrer l'application à plusieurs |
| Marquage à l'écran | `DÉMO · LOCAL` | `DÉMO` |

Les deux affichent le bandeau « données fictives » : ce qui est à l'écran est
inventé dans les deux cas.

### Mode FICTIF — l'interface sans aucun serveur

```bash
npm run dev            # http://localhost:5173  — aucune API à lancer
```

Le jeu est engendré à l'ouverture depuis les contours réels (`public/layers/`) :
**28 régions, 93 compagnies, 504 brigades, ~12 650 éléments, ~2 820 barrages**,
tous marqués `DEMO`, tous posés **dans** le contour de leur brigade.

| Où | Quoi |
|---|---|
| [src/donnees/sourceDonnees.js](src/donnees/sourceDonnees.js) | **l'interrupteur** `SOURCE_PAR_DEFAUT`, les scénarios, la latence, le volume |
| [src/donnees/fictif/generateur.js](src/donnees/fictif/generateur.js) | le tirage déterministe (même graine ⇒ même jeu) |
| [src/donnees/fictif/fournisseurFictif.js](src/donnees/fictif/fournisseurFictif.js) | l'API rejouée : mêmes chemins, mêmes formes, même cloisonnement |
| [src/api.js](src/api.js) | l'aiguillage, dans `appel()` — **le seul endroit qui connaît les deux sources** |

**Passer à l'API réelle** : `SOURCE_PAR_DEFAUT = SOURCES.REEL` dans
`src/donnees/sourceDonnees.js`. Rien d'autre. Les quarante-cinq fonctions de
`src/api.js` gardent leurs noms, leurs arguments et leurs réponses : aucun écran
n'est à reprendre. Un build de production part déjà sur l'API réelle — seul
`npm run dev` bascule en fictif.

Sans toucher au code :

```text
?donnees=fictif | ?donnees=reel     source
?scenario=vide | erreur | lent      états à éprouver (défaut : succes)
?echelle=petit                      3 régions au lieu du pays entier
```

Connexion en mode fictif : n'importe quelle unité, **code `DEMO`** — ou un
matricule `DEMO-00001` en accès personnel. Le cloisonnement reste celui de
l'application (`perimetreImpose`), rang par rang.

`npm run check:fictif` éprouve les rattachements, la géographie des repères, le
déterminisme et l'absence de toute identité vraisemblable.



[scripts/fake-data.mjs](scripts/fake-data.mjs) fabrique les **sept mêmes
couches** que `build:layers`, avec les mêmes attributs, sans lire `data/` :

```bash
npm run fake:data      # public/layers/*.geojson + _report.json  (et dist/layers si dist/ existe)
```

Rien à changer dans l'application : mêmes noms de fichiers, mêmes propriétés
(`gr_bde` / `gr_cie` / `gr_region`, `nom` / `nbBt` / `population` / `superficie`
/ `confiance`, `pk` / `mission` / `diametre` / `bde` / `cie` / `reg`). Les
popups, l'analyse par région, les fiches de contour et les couches de proximité
fonctionnent donc à l'identique.

| Ce qui est généré | Comment |
|---|---|
| 12 régions | cellules de Voronoï autour des chefs-lieux, découpées sur un contour national schématique |
| ~62 compagnies | pavage de Voronoï **à l'intérieur** de chaque région |
| ~517 brigades | pavage de Voronoï **à l'intérieur** de chaque compagnie |
| Populations | superficie réelle du contour × densité de la région × aléa (0,35–2,1) |

Chaque niveau pave exactement son parent : les totaux d'un contour région
correspondent à la somme de ses compagnies, elles-mêmes somme de leurs
brigades — comme sur les données réelles.

### Semis du jeu de démonstration — effectif, postes, relèves

`fake-data.mjs` ci-dessus fabrique la GÉOGRAPHIE. Ce qui la peuple — gendarmes,
barrages, points noirs, relèves — vient de
[scripts/semer-demo.mjs](scripts/semer-demo.mjs), qui écrit dans `donnees-demo/`
et **refuse de démarrer** sur un dossier dont `mode.json` n'annonce pas `demo`.

```bash
npm run demo:semer                                  # aperçu : n'écrit rien
node scripts/semer-demo.mjs --composition-demo --ecrire \
     --rapport artifacts/rapport-semis-demo.md \
     --projection artifacts/projection-scenario-g.csv
npm run check:semis                                 # contrôle du jeu semé
node scripts/verifier-projection.mjs --composition-demo   # contrôle indépendant
```

`--rapport` et `--projection` fonctionnent **sans** `--ecrire` : l'aperçu décrit
alors, brigade par brigade, ce que la commande produirait.

Le semis part de **la liste des brigades**, pas de celle des barrages : les 504
brigades de `circo_bt.geojson` sont peuplées, y compris les 113 qui ne tenaient
aucun poste et restaient vides.

**L'effectif n'est pas un nombre choisi** — il se déduit de ce que les postes de
la brigade réclament. Une première version en donnait vingt à chacune : 6 120
hommes manquaient par journée, sur 179 brigades. La cause n'était pas le volume
(10 080 hommes pour 7 653 nécessaires par créneau) mais la concentration — la
brigade médiane tient deux postes, Es-Smara en tient trente-six.

| Ce qui est semé | Règle |
|---|---|
| Effectif | `Σ composition(poste) + 15 %`, borné entre `--cible 20` et `--plafond 60` ; 1–2 A/C et ≥ 2 ADJT par brigade |
| Barrages | au moins un poste fixe et un poste mobile par brigade, placés **dans** la circonscription |
| Points noirs / congestions | une part des brigades (`--part-accidents`, `--part-zahma`), avec éclairage renseigné |
| Relèves | préparées par `serveur/roster.mjs` — la mécanique du service, pas une seconde implémentation |

`--composition-demo` ramène le **poste fixe** à `1 ADJT + 2 MDLC + 3 MDLG` dans
le dossier de démonstration **uniquement** : la composition livrée demandait un
A/C par poste fixe, ce qu'aucune brigade réelle ne peut aligner — l'A/C commande
la brigade, il ne se tient pas sur chaque barrage. Le poste mobile est inchangé,
et `composition-barrage.json` de la production n'est jamais touché.

Il reste **788 hommes manquants par journée sur 7 brigades** (Es-Smara en tête),
celles que le plafond empêche de couvrir leurs postes. C'est **assumé** : le
signalement de manque se donne ainsi à voir sur des unités qu'on peut nommer, au
lieu d'être dilué sur la moitié du pays.

**Rien n'est inventé au hasard** : noms, grades et coordonnées se déduisent
d'une empreinte du nom de la brigade, donc deux exécutions produisent le même
jeu. **Rien n'est recopié** : une brigade déjà à la cible ne reçoit personne, un
marquage dont l'identifiant existe n'est pas reposé — relancer la commande ne
duplique rien. **Rien n'est ambigu** : chaque personne porte `demo: true`, un
matricule `DEMO-…` et un nom finissant par `DEMO`, et
[scripts/retirer-demo.mjs](scripts/retirer-demo.mjs) reprend tout.

À savoir : la composition type demande un A/C par barrage fixe. Une brigade qui
tient douze postes en réclamerait douze, là où la cible de vingt hommes n'en
donne qu'un ou deux. Le manque est **affiché poste par poste**, jamais comblé
par une personne inventée — c'est le comportement voulu (voir `repartir` dans
`serveur/effectifs.mjs`).

### Assistant d'analyse — n8n ou Ollama

Le panneau **Optimisation** peut faire commenter son résultat par un service
externe. Un bouton **« Analyser ce résultat »** apparaît sous les compteurs,
**uniquement si le serveur a été démarré avec une destination** :

```bash
# un workflow n8n reçoit le résumé et rend le texte (voie à préférer)
node serve.mjs --n8n http://192.168.0.6:5678/webhook/carte-optimisation

# ou Ollama en direct, sans n8n
node serve.mjs --ollama http://192.168.0.6:11434 --modele llama3.1

# les deux : n8n d'abord, Ollama en secours s'il ne répond pas
node serve.mjs --n8n http://192.168.0.6:5678/webhook/carte-optimisation \
               --ollama http://192.168.0.6:11434 --modele llama3.1
```

Équivalents en variables d'environnement : `GR_N8N_URL`, `GR_OLLAMA_URL`,
`GR_OLLAMA_MODELE`. **Sans configuration, rien n'est appelé et le bouton
n'existe pas** — le service garde sa propriété de n'émettre aucun appel sortant.

**C'est le serveur qui joint ces machines, pas le navigateur.** Trois raisons :
aucun CORS à obtenir de n8n ni d'Ollama (qui le refuse par défaut), l'adresse ne
part pas dans le bundle JavaScript de tous les postes, et un poste client n'a
pas forcément la route vers ces machines.

#### Ce que le webhook reçoit

```json
{
  "source": "carte-gendarmerie",
  "resume": {
    "perimetre": "region Rabat",
    "seuilKm": 5,
    "examines": 21, "sousLeSeuil": 16, "intouchables": 4, "aDecider": 9,
    "postes": [
      { "nom": "Barrage RN1 #3", "route": "RN1", "distanceKm": 2.1, "protections": [] },
      { "nom": "Porte Cie Bouznika", "route": "A1", "distanceKm": 3.4,
        "protections": ["entree_ville"] }
    ]
  }
}
```

Au plus 20 postes. **Ni identité, ni matricule, ni coordonnées** ne sortent : le
corps est reconstruit champ par champ côté serveur avant l'envoi.

#### Ce que le workflow doit renvoyer

Du texte, dans l'une des formes usuelles — le serveur cherche la première qui
répond, sur quatre niveaux d'imbrication :

```
"du texte brut"                    {"output": "..."}      {"texte": "..."}
{"response": "..."}  (Ollama)      {"message": "..."}     {"analyse": "..."}
[{"json": {"output": "..."}}]      (retour n8n habituel)
```

Un délai de 60 s, puis abandon avec un message clair. Si `--n8n` échoue et
qu'`--ollama` est configuré, la bascule est automatique et la source est
affichée dans le panneau (`ollama (n8n indisponible)`).

### Reclassement géographique des barrages

[scripts/reclasser-barrages.mjs](scripts/reclasser-barrages.mjs) reconstruit
**quatre champs** des barrages à partir de leur seule position :
`eclairage`, `exceptionnel` (VIP), `missionId` et `positionVille`. Aucun tirage
au sort — deux exécutions donnent le même résultat, et un second passage ne
change rien.

```bash
node scripts/reclasser-barrages.mjs            # aperçu + audit, n'écrit rien
node scripts/reclasser-barrages.mjs --ecrire   # applique (refuse si l'audit échoue)
```

| Champ | Règle géographique |
|---|---|
| **éclairage** | `oui` dans la tache urbaine d'une commune de densité ≥ 400 hab/km², ou dans un périmètre DGSN déclaré · `non` à plus de 12 km du bâti de toute commune habitée **et** de tout chef-lieu de brigade · `inconnu` entre les deux |
| **VIP** | contact du bâti (≤ 3 km) d'une commune de densité ≥ 400, **et** sur autoroute ou nationale, **et** parmi les 2 mieux placés de cette ville |
| **non éclairé** | **exactement un par région** — le poste **le plus isolé** qu'elle possède, jamais dans une tache urbaine ni dans un périmètre DGSN déclaré, et **au moins à 2 km de tout autre non-éclairé** (contrainte globale, prioritaire sur l'isolement). Un **barrage fixe** est préféré : l'Optimisation n'examine pas les mobiles, un non-éclairé désigné sur un mobile serait invisible. Le seuil des 12 km ne filtre plus : il qualifie seulement le résultat (« isolé » ou « le moins urbain de sa région »). Une porte de ville n'est retenue qu'en dernier recours. Les autres postes repassent à `inconnu`, jamais à `oui` : on cesse d'affirmer, on n'affirme pas le contraire |
| **VIP** | **au plus un par région** : le poste le plus urbain sur l'axe le plus important. Dix régions rurales n'en ont aucun — aucune commune assez dense, rien n'est inventé pour remplir la case |

`--vip-region 0 --nuit-region 0` rend la totalité des cas géographiques au lieu
d'un par région ; l'écart minimal de 2 km continue alors de s'appliquer et écarte
les postes trop rapprochés (456 candidats → 452 retenus, écart minimal 2,02 km).
`--ecart-nuit <km>` change ce seuil.
| **entrée de ville** | **une seule par agglomération** : l'axe le plus important qui l'aborde (autoroute > nationale > régionale ; à égalité, le plus proche du centre) |
| **sortie de ville** | **une seule par agglomération** : le meilleur poste restant à plus de 90° d'azimut de l'entrée. Aucune si aucun second axe distinct — on n'en fabrique pas |

Deux pièges de `poles-population.json`, mesurés avant d'écrire la moindre
règle : `pop` et `rayonKm` décrivent la **circonscription**, pas la ville
(Zagora : 117 561 habitants, 38 km de rayon, **26 hab/km²**). Le script en
déduit donc un *rayon de tache urbaine* — `min(rayon, √(pop / π·3000))` — et
mesure l'urbanité sur la **densité**, jamais sur la population brute.

La direction de circulation n'existe pas dans `graphe_routier.json` (chaque
arête est insérée dans les deux sens) : « entrée » et « sortie » sont donc une
**convention explicite** — axe principal / autre côté de la ville — et non une
mesure. L'audit final vérifie l'unicité, la cohérence géographique de chaque
classification et l'absence de référence de mission morte ; l'écriture est
refusée si un contrôle échoue.

**Ce que ce jeu n'est pas.** Les frontières sont rectilignes et ne
correspondent à aucun découpage administratif. Les seuls éléments authentiques
sont les noms de villes, utilisés pour la vraisemblance géographique. Le
`_report.json` généré le déclare en anomalie **critique** : la section
« qualité des données » du panneau d'analyse affiche donc en clair qu'il s'agit
d'une démonstration.

Le générateur est **déterministe** : la même graine (`SEED`, en haut du script)
redonne exactement les mêmes fichiers. Changez-la pour un autre jeu, ou ajustez
`CIES_PAR_REGION`, `BT_PAR_CIE`, `NB_POINTAGES` juste en dessous.

Pour revenir aux données réelles : `npm run build:layers` réécrit les mêmes
fichiers par-dessus.

---

## 6. Saisie des chefs (compagnie et région)

Deux natures seulement, et l'une commande l'autre — bouton « Saisie » :

| | Ce que ça décrit | Champs propres |
|---|---|---|
| **Point noir** (نقطة سوداء) | le problème constaté | **cause obligatoire** : accidents de la route, activité / passage, infractions ; puis le bilan `accidents / 12 mois` et la `gravité maximale` |
| **Contrôle fixe** (نقطة مراقبة ثابتة) | la réponse permanente | créneau facultatif |
| **Contrôle mobile** (نقطة مراقبة متنقلة) | la réponse déplaçable | **créneau obligatoire** — sans horaire, la consigne est inapplicable |

```
se connecter (unité + code)  ->  la carte se cadre sur SA circonscription
                             ->  poser un point noir (pourquoi ?)
                             ->  poser le contrôle qui y répond
                             ->  lire le classement et les doublons
```

**Il n'y a aucun point de contrôle livré avec l'application.** Les contrôles
sont ceux que les chefs posent ; l'ancienne couche de pointages, chargée d'un
fichier, a été retirée — elle donnait à voir un dispositif que personne n'avait
décidé.

### Éléments présents, par créneau de 6 heures

Les hommes d'un barrage changent toutes les six heures. Le haut du panneau
« Saisie » tient donc la **relève**, et rien d'autre :

```
choisir le barrage  ->  le créneau en cours s'affiche seul (00-06, 06-12, 12-18, 18-00)
                    ->  + Ajouter un élément
                    ->  Grade (M/G, M/C, Adjt, A/C) — Nom — Matricule
                    ->  Ajouter
```

| | |
|---|---|
| **Grade** | liste fermée : `M/G`, `M/C`, `Adjt`, `A/C`. Aucune saisie libre — le serveur refuse toute autre valeur |
| **Date, heure, créneau** | jamais saisis : posés par l'**horloge du serveur** à l'enregistrement. Deux postes dont les horloges divergent relèvent quand même dans le même créneau, et personne ne réécrit un créneau révolu |
| **Séparation** | une relève appartient à un couple (jour, créneau). Celles de 06:00–12:00 ne se mélangent jamais à celles de 12:00–18:00 |
| **Historique** | les créneaux passés restent consultables sous « Créneaux précédents », barrage par barrage |
| **Correction** | une ligne fautive se **retire** ; la ressaisie tombe dans le créneau en cours |
| **Autorité** | lire un barrage qu'on voit, écrire sur un barrage qu'on peut modifier — exactement la règle de sa fiche |

Le dépôt est un fichier à part, `donnees-serveur/elements.json` (voir
`serveur/elements.mjs`) : ces relèves s'accumulent quatre fois par jour, et
n'ont pas à faire grossir le dépôt des marquages, réécrit à chaque pose de
repère. Elles ne sont pas effacées avec un barrage retiré du dispositif — ce
qui a été tenu a eu lieu.

### Deux façons de poser un repère

| | Quand |
|---|---|
| **clic sur la carte** | l'emplacement se reconnaît à l'œil |
| **coordonnées saisies** | le relevé arrive en chiffres (GPS, procès-verbal, message radio) |

Le champ de coordonnées accepte le décimal (`31.6295` / `-7.9811`), la virgule
décimale française (`31,6295`), le degré-minute-seconde (`31°37'46"N`,
`7°58'52"O` — `W` et `O` acceptés), et le **couple collé d'un bloc** dans le
premier champ, comme le donnent Google Maps et les GPS. Une saisie permutée
(latitude négative, longitude positive) est **refusée avec son motif** plutôt que
de poser un repère au milieu de l'océan Indien. Les deux voies passent ensuite par
le même contrôle de périmètre côté serveur.

Chaque repère porte aussi : lieu / désignation, route et PK, observation,
position, **qui l'a posé** et qui l'a modifié en dernier. Pas de bouton
« enregistrer » : chaque frappe part au serveur. Ce qui manque pour qu'une fiche
soit exploitable est **listé en clair** plutôt que bloqué — un repère posé sur le
terrain doit pouvoir être complété au retour.

### Qui peut quoi

| | Périmètre d'écriture | Sur quels repères |
|---|---|---|
| **Chef de compagnie** | sa circonscription de compagnie | les siens |
| **Chef de région** | toute sa région | les siens **et** ceux de ses compagnies |

À la connexion, **la carte se cadre automatiquement sur l'unité** : le chef
s'identifie pour travailler sur sa zone, la chercher à la main avant chaque
saisie n'aurait pas de sens. Le contour du périmètre est tracé en pointillé or.
Un clic à l'extérieur est refusé avec son motif ; un repère glissé au-delà
**revient à sa position**.

### Exposition, classement et arbitrage des doublons

C'est le point noir qui justifie le contrôle : il faut donc pouvoir comparer deux
endroits. D'où un score unique, calculé sur le bilan d'accidents :

```
exposition = accidents sur 12 mois × gravité      (matériel ×1, blessés ×3, tués ×8)
```

Le rapport de 1 à 8 fait ressortir les accidents mortels sans effacer les points
à répétition. Un point noir dont la cause n'est pas accidentelle vaut 0 : il
justifie peut-être un contrôle, mais pas au titre des accidents.

Deux réglages commandent tout le raisonnement, et sont côte à côte dans le
panneau :

| Réglage | Effet |
|---|---|
| **accidents ≥ N** | écarte les points noirs trop légers pour justifier un barrage |
| **rayon d'action R km** | ce qu'un barrage couvre — et, du même coup, la distance en dessous de laquelle deux repères font double emploi |

Le rayon sert deux fois à dessein : la portée d'un contrôle et le seuil de
redondance sont la même grandeur, et les séparer aurait laissé produire des
dispositifs incohérents.

### Générer le dispositif

Le bouton **« Appliquer »** compose les barrages à partir des points noirs, par
sélection gloutonne :

```
1. classer les points noirs par exposition décroissante
2. retenir le plus exposé, ignorer ceux qui tombent dans son rayon (déjà couverts)
3. les barrages déjà à portée d'un emplacement retenu y restent
4. les barrages restants sont DÉPLACÉS vers les emplacements dépourvus
5. ce qui ne couvre plus rien est signalé
```

Le glouton n'est pas l'optimum théorique — la couverture d'ensemble est
NP-difficile — mais il donne un dispositif **explicable en une phrase** : « on
couvre d'abord le plus meurtrier ». Un chef doit pouvoir justifier
l'emplacement d'un barrage, pas invoquer un solveur.

Le plan est **affiché avant d'être appliqué** (`en place / à déplacer / à créer /
inutiles`), et rien ne part au serveur avant le bouton. Chaque écriture repasse
par le contrôle de périmètre : un barrage ne peut pas être déplacé hors de
l'unité. Après application, le plan se recalcule et le bouton s'éteint —
« dispositif conforme ».

Trois usages, tous dans le panneau :

1. **la taille du repère sur la carte** suit l'exposition — les points critiques
   sautent aux yeux ;
2. **deux filtres** (accidents minimum, distance en km) écartent le bruit et
   listent aussi les points noirs — ou les barrages — trop rapprochés ;
3. **les contrôles trop proches** (< 5 km) sont signalés avec la recommandation :
   *déplacer celui qui couvre le moins de risque*, la couverture étant la somme
   des expositions des points noirs dans son rayon. À couverture égale, c'est le
   **contrôle mobile** qui est désigné — c'est celui qui est fait pour bouger ; à
   nature égale aussi, aucune recommandation n'est inventée et l'arbitrage reste
   au chef.

> **Pas d'export ni d'import.** Les marquages vivent sur le serveur, où tous les
> postes lisent la même chose : le passage par un fichier n'apporterait qu'un
> risque de divergence.

### Comptes nominatifs et rôles

Un compte est une **personne**, pas une unité : matricule, nom, rôle, unité de
rattachement. La connexion se fait au **matricule + code**, et tout ce qui est
écrit porte le nom de son auteur.

| Rôle | Peut écrire | Sur quoi |
|---|---|---|
| **lecture** | non | consultation seule |
| **saisie** | oui | **ses propres** repères, dans son unité |
| **commandement** | oui | **tous** les repères de son unité |

Le partage n'est pas décoratif : un gendarme corrige ses relevés, effacer celui
d'un autre est un acte de chef. Le refus est explicite — *« Ce repère a été posé
par Adj Karim Bennani : seul un compte de commandement peut le modifier. »*

```bash
node scripts/comptes.mjs --initialiser        # un compte de COMMANDEMENT par unité
node scripts/comptes.mjs --ajouter --matricule G12345 --nom "Adj Karim Bennani" \
                         --role saisie --rang cie --unite Marrakech
node scripts/comptes.mjs --lister             # matricule, nom, rôle, unité
node scripts/comptes.mjs --recoder --matricule G12345
```

Les anciens comptes d'unité sont **convertis automatiquement** au premier
chargement : le sel et l'empreinte sont conservés, donc les codes déjà
distribués continuent de fonctionner, le matricule devenant le nom de l'unité.
Personne n'est mis dehors par la mise à jour.

### Journal des écritures

Chaque création, modification, déplacement, suppression, connexion et échec de
connexion est consigné dans `donnees-serveur/journal.jsonl` — **une ligne par
événement, ajoutée en fin de fichier, jamais modifiée**. Un registre qu'on peut
corriger n'atteste plus rien.

Chaque entrée garde l'état **avant** et **après**, plus le détail des seuls
champs touchés :

```
09:14:45  Chef de compagnie Marrakech  a modifié « Relevé agent »
          note : "vu" → "corrigé par le chef"
```

Le panneau de saisie en affiche les dernières entrées, **cloisonnées par
périmètre** : un chef de compagnie voit sa compagnie, un chef de région sa
région. Le format JSONL est un choix de robustesse : une coupure au mauvais
moment ne coûte qu'une ligne, là où un JSON global serait détruit.

### Sauvegardes

Une **copie datée par jour** de `marquages.json` est prise avant la première
écriture de la journée, dans `donnees-serveur/sauvegardes/`, et les 30 derniers
jours sont conservés. Ce qui menace ces données n'est pas la panne machine —
l'écriture est atomique — mais l'erreur humaine : on veut revenir à « hier », pas
à « il y a trente secondes ».

### Authentification

Elle est faite **par le serveur**, pas par le navigateur :

- une personne = un compte (matricule + code) rattaché à une unité et à un rôle ;
- seule une **empreinte PBKDF2-SHA512** (210 000 itérations, sel par compte) est
  stockée — un fichier de comptes volé ne permet pas de se connecter ;
- session par cookie **HttpOnly / SameSite=Strict** : le JavaScript de la page ne
  peut pas lire le jeton, donc pas le divulguer ; 8 h d'inactivité, prolongées à
  chaque action ;
- **cinq échecs bloquent l'unité 15 minutes** ; « unité inconnue » et « code
  faux » renvoient le même message et prennent le même temps, pour ne pas
  révéler quelles unités ont un compte ;
- toute écriture exige l'en-tête `X-Requested-With`, qu'un autre site ne peut pas
  poser : la requête falsifiée est inopérante.

**Ce que le client ne décide pas.** La compagnie et la région d'un repère ne
sont jamais lues dans la requête : le serveur les déduit de la session et de la
géométrie. Un navigateur modifié ne peut donc pas s'attribuer une autre unité.
Le contrôle de périmètre est fait deux fois — dans la page pour prévenir avant
l'envoi, sur le serveur pour décider.

### Créer les comptes

```bash
node scripts/comptes.mjs --initialiser     # un compte par région et par compagnie
node scripts/comptes.mjs --lister
node scripts/comptes.mjs --recoder --rang cie --unite Marrakech
node scripts/comptes.mjs --ajouter --rang reg --unite "Souss-Massa" --code MON-CODE-1234
node scripts/comptes.mjs --supprimer --rang cie --unite Marrakech
```

Les codes sont **affichés une seule fois** (`JKHD-ZV3D-9WSC`, alphabet sans
`O/0` ni `I/1`) : à remettre au chef concerné, puis à détruire. Un code perdu ne
se retrouve pas, il se remplace.

### Lancer le service

```bash
npm run serve            # dist/ + API, port 8080 (déploiement)
npm run serve:api        # public/ + API, pour travailler avec npm run dev
npm run dev              # Vite relaie /api vers le port 8080
```

| Fichier | Rôle |
|---|---|
| [serveur/comptes.mjs](serveur/comptes.mjs) | Empreintes PBKDF2, vérification à temps constant |
| [serveur/sessions.mjs](serveur/sessions.mjs) | Jetons en mémoire, cookie, blocage des tentatives |
| [serveur/geo.mjs](serveur/geo.mjs) | Point-dans-polygone, périmètres, rattachement d'un point |
| [serveur/depot.mjs](serveur/depot.mjs) | Marquages : validation, écriture atomique, sauvegardes datées |
| [serveur/journal.mjs](serveur/journal.mjs) | Journal JSONL append-only, diff champ par champ |
| [serveur/api.mjs](serveur/api.mjs) | **Toutes les règles d'autorité**, en un seul fichier |
| [scripts/comptes.mjs](scripts/comptes.mjs) | Gestion des comptes en ligne de commande |
| [src/api.js](src/api.js) | Appels côté navigateur |
| [src/marquages.js](src/marquages.js) | Natures, causes, score d'exposition, arbitrage des doublons |
| [src/MarquagePanel.jsx](src/MarquagePanel.jsx) | Connexion, pose, fiche, classement, conflits |

Les données d'exploitation vivent dans `donnees-serveur/` (`comptes.json`,
`marquages.json`) — hors dépôt git, à sauvegarder et à protéger en lecture. Les
écritures sont atomiques : une coupure de courant ne tronque pas le fichier.

**Ce que le client ne peut pas fausser.** Les champs d'autorité ne sont jamais
lus dans la requête : `cie`, `reg` et `auteur` viennent de la session et de la
géométrie. Les champs propres à une nature sont remis à zéro sur les autres — un
contrôle ne traîne pas de bilan d'accidents, et un bilan n'est conservé que pour
la cause accidentelle, faute de quoi un « 99 » sur un passage officiel resterait
dans le fichier sans que rien permette de l'interpréter.

> **Limites assumées.** Le service tourne en HTTP sur l'intranet : le cookie n'a
> pas l'attribut `Secure` (à ajouter le jour du passage en HTTPS, une ligne dans
> `serveur/sessions.mjs`). Un compte vaut pour une unité, pas pour une personne
> nommée : il établit *quelle unité* a écrit, pas *quel militaire*. Enfin, servir
> `dist/` par IIS ou nginx sans `serve.mjs` laisse la carte consultable mais
> supprime la saisie — il n'y a alors aucun service pour vérifier les codes.

### Limites territoriales selon le zoom

Les trois découpages ne se cochent plus pour être vus : **l'échelon suit le
zoom**, et les seuils sont ceux du regroupement des barrages — un seul jeu, pour
que la carte ne montre jamais des barrages groupés par compagnie sur un fond
découpé en régions.

| Zoom | Échelon affiché | Les deux autres |
|---|---|---|
| < 7 | Régions (`circo_reg`) | éteints |
| 7 – 8 | Compagnies (`circo_cie`) | éteints |
| ≥ 9 | Brigades (`circo_bt`) | éteints |

**Un seul échelon à la fois.** Quand les compagnies apparaissent, les régions
disparaissent ; quand les brigades apparaissent, les compagnies disparaissent.
L'échelon qui s'en va s'éteint SEC, seul celui qui arrive prend 200 ms à
apparaître : à aucun instant, même pendant la bascule, deux découpages ne sont
superposés (`npm run check:limites`, et un relevé toutes les 25 ms en
navigateur le confirment).

Un seul endroit décide : `visibiliteLimites` dans
[src/limitesTerritoriales.js](src/limitesTerritoriales.js). Aucun composant ne
compare un zoom à un seuil de son côté, et `npm run check:limites` rejoue la
séquence complète, aller et retour.

### Verrouillage de la carte sur la zone du compte

`maxBounds`, plancher de zoom et cadrage initial suivent le périmètre du compte
— un seul dispositif, `LimiterAuTerritoire`, celui qui bornait déjà la carte au
territoire national :

| Compte | Carte bornée à | Plancher de zoom |
|---|---|---|
| `admin` | le Maroc (`BORNES_MAROC`) | ~6 |
| `reg` | sa région | ~8 |
| `cie` | sa compagnie | ~10 |
| `unite` | sa brigade | ~12 |

Un contour hors portée reste **dessiné** (on doit voir où s'arrête sa zone) mais
ne s'ouvre pas et ne se sélectionne pas : `dansSaPortee` dans
[src/marquages.js](src/marquages.js), dérivé de `perimetreImpose` — la table des
rangs reste unique. Borner la carte est un confort de navigation, **pas** une
sécurité : le cloisonnement des données est tenu par le serveur.

Chaque échelon a son **volet Leaflet** (`gr-limites-reg` 402, `gr-limites-cie`
404, `gr-limites-bt` 406, entre les vecteurs ordinaires à 400 et les marqueurs à
600). Apparition et effacement se jouent sur l'`opacity` de ces volets : faire
surgir 500 circonscriptions revient à écrire un nombre dans une propriété CSS.
Seul l'échelon principal reçoit les clics — un parent laisse passer le clic
destiné au contour qu'il recouvre.

Les cases du panneau **Couches** restent des ordres explicites : cocher un
découpage l'affiche à pleine force à tous les zooms. Le zoom choisit le défaut,
il ne confisque pas la commande.

> Le zoom règle le **détail affiché**, jamais le **droit** : il ne reçoit ni
> session ni rang. Les repères opérationnels restent filtrés par
> `dansSonPerimetre` et par le serveur, quel que soit l'éloignement.

### Brume sur la sélection

Cliquer une circonscription — région, compagnie ou BT — l'isole : tout le reste
du territoire est assombri par un voile unique (le monde moins le contour
retenu), au-dessus des marqueurs mais sous les libellés, qui restent lisibles.
Fermer la fiche dans le panneau d'analyse dissipe la brume.

---

## 7. Réseau routier et distances

Autoroutes, routes nationales, régionales et provinciales sont affichées comme
couches, et servent à **mesurer des distances par la route** — pas à vol
d'oiseau. Bouton « Distances » : deux clics sur la carte, un itinéraire.

```bash
npm run roads:fetch     # OpenStreetMap -> data/routes/*.json   (accès internet, une fois)
npm run build:roads     # -> public/layers/routes_*.geojson + graphe_routier.json
```

| Couche | Linéaire | Poids |
|---|---|---|
| Autoroutes (`A1`…`A7`) | 3 685 km *(deux chaussées comptées)* | 60 ko |
| Routes nationales (`RN…`) | 16 496 km | 1,0 Mo |
| Routes régionales (`RR…`) | 11 389 km | 0,6 Mo |
| Routes provinciales (`RP…`) | 27 755 km | 1,4 Mo |
| Graphe de calcul | 51 915 sommets, 65 061 arêtes | 4,0 Mo |

La classification suit la **référence signalée sur le terrain** (`RN8`, `RR322`)
et non le type OSM : une nationale reste une nationale là où elle traverse une
ville et se retrouve étiquetée `primary`.

### Pourquoi pas OSRM

OSRM est un service C++ à compiler, à préparer (plusieurs Go de RAM) et à
maintenir en marche à côté de l'application — pour un intranet fermé où le
serveur doit rester « copier le dossier, lancer Node », c'est un poids
disproportionné. Le réseau d'un seul pays, réduit à son graphe, tient en 4 Mo :
[src/routage.js](src/routage.js) le parcourt en **A\*** dans le navigateur, en
une dizaine de millisecondes. Aucun service supplémentaire, et les distances
restent calculables même quand l'application est servie en fichiers statiques.

Contrôle de justesse contre des distances routières connues :

| Trajet | Calculé | Référence | Écart |
|---|---|---|---|
| Casablanca → Rabat | 86 km | 87 km | −1 % |
| Casablanca → Marrakech | 240 km | 240 km | 0 % |
| Casablanca → Tanger | 339 km | 340 km | 0 % |
| Marrakech → Agadir | 250 km | 250 km | 0 % |
| Rabat → Oujda | 524 km | 540 km | −3 % |
| Laâyoune → Dakhla | 535 km | 530 km | +1 % |

Les itinéraires empruntent bien les axes réels (Casablanca → Tanger par A1 puis
A5, Marrakech → Agadir par RN8 puis A3).

### Ce que l'outil donne

- **distance par la route** et **durée estimée**, au choix par le trajet *le plus
  rapide* ou *le plus court* ;
- l'écart au vol d'oiseau et le **facteur de détour** — c'est lui qui explique un
  délai d'intervention anormal ;
- la **répartition par type de route** : 200 km d'autoroute ne valent pas 200 km
  de provinciale ;
- la **feuille de route** (`RN8 sur 42 km, puis A7 sur 120 km`).

Chaque point cliqué est ramené à la route la plus proche, et l'écart est affiché
(« à 320 m de la route ») : un point posé loin de tout axe ne fait pas passer une
erreur pour une mesure. Au-delà de 30 km sans route, l'outil refuse plutôt que
d'inventer.

> **Limites.** Les durées sont calculées sur des vitesses de parcours par classe
> de route (autoroute 110, nationale 75, régionale 60, provinciale 50 km/h),
> corrigées par les limitations déclarées dans OSM : elles ignorent le trafic,
> les arrêts et la météo. Les sens uniques sont respectés (les autoroutes sont
> traitées comme telles, chaussée par chaussée). Enfin les données valent ce que
> vaut OSM à la date du téléchargement : `npm run roads:fetch` les rafraîchit.

### Routes classées et filtration par route

**La couche « Routes classées »** (panneau Couches → Fond de carte) colore les
autoroutes, nationales, régionales et provinciales et affiche leur numéro (A1,
RN1, RR322…). Elle est lue dans les tuiles de l'archive hors ligne (couche
`roads`, tag OSM `ref`) : aucune donnée de plus, seules les tuiles de la vue sont
chargées. Interrupteur mémorisé par le navigateur.

**L'onglet « Par route »** (Superadmin, en haut de la carte) ouvre la
**Filtration par route** :

| Mode | Désignation | Tracé |
|---|---|---|
| Route complète | numéro (recherche) ou clic sur la carte | toutes les arêtes du graphe portant ce `ref` |
| Trajet personnalisé | deux localités (liste ou clic sur la carte) | plus court chemin en temps sur le graphe, + jusqu'à 2 variantes |

**Seuls les barrages SUR la route sont retenus** (`appartenanceRoute`,
`serveur/api.mjs`) : à moins de **150 m** du tracé réel (`TOLERANCE_ROUTE_KM`,
`serveur/corridorRoutier.mjs` — l'écart GPS et la simplification du graphe ;
mesuré, les postes d'une route sont à moins de 45 m de son tracé) **et**
enregistrés sur cette route (ou, sans référence exploitable, dont la route
numérotée la plus proche est celle-là). Un barrage d'une route voisine, même à
quelques mètres (croisement), n'est jamais pris ; un barrage enregistré sur la
route mais loin de son tracé est signalé « position à vérifier ». Pour un
trajet, ce sont les routes empruntées par l'itinéraire.

La liste (filtrable par faction), les anneaux sur la carte et les **conflits**
(entre barrages de la route, même faction, moins de `SEUIL_DISTANCE_AUTO_KM` par
la route — `serveur/conflitsFaction.mjs`) en découlent. La filtration n'écrit
rien : le Superadmin **assigne** les barrages au CMND Région qui les porte.

### Rôles : le Superadmin assigne, le commandement traite

**La chaîne d'assignation** — panneau « Assignations » (rail), serveur
`/api/barrages/assigner` et `/api/assignations/*` :

| Rôle | Ce qu'il fait |
|---|---|
| **Superadmin** | assigne un barrage (bulle) ou ceux d'une route (filtration) au **CMND Région de la région du barrage** ; suit la chaîne. Il ne pose, ne déplace, ne supprime, ne modifie plus aucun barrage : 403 côté serveur (`REFUS_SUPERVISION`). |
| **CMND Région** | voit les barrages qui lui sont assignés ; **Traiter** (choisir une faction configurée) ou **Assigner à un CMND Cie** — seuls les comptes CMND Cie de sa région, la compagnie du barrage en tête ; suit ce qu'il a transmis. |
| **CMND Cie** | voit et **traite seulement les barrages qui lui sont assignés** (faction), y compris hors de sa compagnie si sa région le lui a confié ; un barrage non assigné est refusé (403). |

Chaque maillon est une notification `assignation` avec son destinataire
(`{rang, unite}`), sa date, son auteur et son statut (en attente, traité,
transmis) ; `parentId` relie Région → Cie. Le changement de faction est
journalisé (`changement_faction`). Ses autres droits d'administration
(comptes, génération et import du dispositif, effectifs, alertes, validation
des demandes des unités) restent au Superadmin.

**Les factions se nomment sans horaire** à l'écran (« Faction 2 ») ; les
horaires restent dans les données. **La filtration automatique est masquée**
(`FILTRATION_AUTOMATIQUE_VISIBLE`, `src/OptimisationPanel.jsx`).

### Notifications, suivi du traitement et instructions

**La cloche** (en haut à droite) annonce ce qui vient de changer : assignation,
traitement, déplacement, changement de faction ou de statut, validation d'une
opération. Elle ne s'alimente pas route par route : toute écriture passe par
`journal.consigner`, et c'est là que naît la notification
(`serveur/notifications.mjs`) — une ligne du journal, une notification ; les
lignes d'une même opération (même barrage, même auteur, < 1,5 s) sont fusionnées.

| | |
|---|---|
| **Non lues / Historique** | ouvrir une notification la marque lue *pour ce compte* ; elle quitte « Non lues » et reste dans l'historique |
| **Contenu** | titre, description, date et heure, auteur, destinataire, type d'action, barrage (« Voir sur la carte ») |
| **Cloisonnement** | celui de la carte (`perimetreDuRang`), vérifié par le serveur ; jamais ses propres gestes |
| **Temps réel** | `GET /api/notifications/flux` (`text/event-stream`) ; relecture toutes les 30 s si le flux ne s'établit pas |
| **Données** | `notifications.json` dans le dossier de données, créé au premier événement |

Les dossiers à **trancher** (propositions, demandes, assignations) restent dans
le panneau « Décisions » du rail ; la cloche y renvoie.

**Suivi du traitement** (Super Admin, panneau « Assignations ») — statut lu en
base par `GET /api/assignations/suivi` (`serveur/suiviAssignations.mjs`) :
*en attente* (rien de fait), *en cours* (transmis, demandé, ou une demande
attend validation), *terminé* (chaîne close et plus rien en attente). Un
déplacement demandé par le CMND Région n'est terminé qu'une fois accepté par
l'administration ; l'assignation se clôt alors d'elle-même. Lecture seule.

**Instructions** (barre du haut) : les étapes du rôle connecté
(`src/guideRoles.js`), chacune adossée à une règle de `serveur/api.mjs`.

```bash
npm run check:notifications            # dépôt, lecture, cloisonnement, statuts (sans service)
npm run check:notifications:service    # de bout en bout, par HTTP, sur une copie de la démo
```

### Espacement des barrages le long d'une route

Dans « Filtration par route » (Superadmin, CMND Région, CMND Cie — chacun sur
son périmètre), **deux paramètres distincts** :

- **distance maximale barrage ↔ route** (50–500 m, 150 par défaut) : dit si un
  barrage appartient à la route ;
- **écart maximal entre barrages consécutifs** (saisie libre en km : 2, 5, 10…).

`POST /api/routes/espacement` (`serveur/espacementRoute.mjs`) range les
barrages fixes de la route le long de l'axe réel — le **tronc kilométrique** de
la route (`serveur/pointKilometrique.mjs`), le tracé pour un trajet — et mesure
chaque écart **par la route**. Sur la carte : l'écart de chaque intervalle, en
rouge au-delà du maximum, avec l'explication (écart actuel, maximum, barrages
manquants) ; « Aucun ajustement nécessaire » sinon. Là où la donnée OSM est
coupée (raccords à vol d'oiseau, `sauts`), l'écart est dit **incertain** et
aucune position n'y est proposée. Les positions proposées (cercles violets en
tirets) ne sont jamais créées automatiquement : un CMND Région ou Cie peut en
créer une, après confirmation, par la pose habituelle (périmètre, validation).


Code : `serveur/corridorRoutier.mjs`, `serveur/conflitsFaction.mjs`, `/api/routes/*`,
`/api/barrages/assigner`, `/api/barrages/:id/faction` (`serveur/api.mjs`),
`src/OptimisationRoutePanel.jsx`, `src/components/map/{CoucheOptimisationRoute,
ConflitsRoutePanel,AssignerRegion,ChangerFaction}.jsx`.


---

## Pièges dans les données actuelles

**28 des 529 points BT ont `coordinates: [null, null]`** dans `dataPoint/bt.json`
(BT DCHIRA, BT AL HAMD, PP BOUSKOURA, BT MARZOUGA…). Ils sont écartés, donc
**absents de la carte** : la couche affiche 501 brigades sur 529. À corriger à
la source pour les récupérer.

**`Circonscription_Compagnies.json` et `Circonscription_Region.json` sont des
`GeometryCollection` nues : zéro attribut.** Ces polygones ne peuvent donc être
ni nommés ni reliés à une compagnie/région ; ils s'affichent en contours
anonymes. Seules les circonscriptions BT portent des attributs exploitables
(`gr_bde`, `gr_cie`, `gr_region`, `population`, `superficie` — 28 régions,
93 compagnies, 504 brigades). Pour obtenir des contours compagnie/région
**nommés**, il faut les recalculer en fusionnant les circonscriptions BT par
`gr_cie` / `gr_region` (mapshaper `-dissolve2`).

**`dataPoint/cie.json` a des clés en encodage cassé** (`r�gion`, `�tat`) alors
que `reg.json` est en UTF-8 correct. Sans effet ici : la table `props` ne lit
que `denom_fr` / `compagnie` / `categorie`.

---

## Couches actuelles

| Couche | Fichier | Entités | Défaut |
|---|---|---|:--:|
| Autoroutes | `routes_autoroute.geojson` | 43 axes — 3 685 km | ✔ |
| Routes nationales | `routes_nationale.geojson` | 4 105 — 16 496 km | ✔ |
| Routes régionales | `routes_regionale.geojson` | 2 058 — 11 389 km | |
| Routes provinciales | `routes_provinciale.geojson` | 3 738 — 27 755 km | |
| Circonscriptions Régions | `circo_reg.geojson` | 28 | ✔ |
| Circonscriptions Compagnies | `circo_cie.geojson` | 90 | |
| Circonscriptions BT | `circo_bt.geojson` | 504 | |
| Chefs-lieux Régions | `pts_reg.geojson` | 28 | ✔ |
| Chefs-lieux Compagnies | `pts_cie.geojson` | 86 | ✔ |
| Brigades Territoriales | `pts_bt.geojson` | 501 | ✔ |
| BT à moins de 5 km | *calculé* | 37 liens | |
| Points noirs / Contrôles fixes / Contrôles mobiles | *serveur* | saisis par les chefs — [§6](#6-saisie-des-chefs-compagnie-et-région) | |

La dernière couche est calculée à la volée : toutes les paires de brigades
séparées de ≤ 5 km (distance géodésique via `@turf/turf`), avec pré-filtre par
boîte englobante — 42 calculs géodésiques au lieu de 125 250, soit 0,5 ms.

Le rendu utilise `preferCanvas` et des `CircleMarker` plutôt que des `Marker` :
indispensable avec ~2600 vecteurs simultanés.
