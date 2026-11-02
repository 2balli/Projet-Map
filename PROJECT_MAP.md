# PROJECT_MAP — Carte Tactique Interactive & Système d'Optimisation des Postes

## Module : Génération de données synthétiques réalistes pour les barrages fixes

> **IMPORTANT / AVERTISSEMENT :**
> Les barrages décrits ci-dessous et générés par ce système sont des **données synthétiques et fictives** destinées exclusivement à la simulation opérationnelle, aux tests de charge, à l'évaluation ergonomique et aux présentations UX/UI.
> Elles ne doivent en aucun cas être interprétées ou exploitées comme des barrages réels ou des informations opérationnelles vérifiées de la Gendarmerie Royale.

---

## 1. Vue d'ensemble de la fonctionnalité

Le module de génération synthétique enrichit la carte tactique avec un ensemble de barrages fixes positionnés de manière réaliste et crédible directement sur l'asphalte du réseau routier marocain (autoroutes, routes nationales, régionales et provinciales).

Le système introduit deux types normalisés :
1. **Barrage fixe intouchable (permanent)** : `type = "FIXED_PERMANENT"`, `isPermanent = true`.
2. **Barrage fixe** : `type = "FIXED"`, `isPermanent = false`.

Tous les barrages générés portent le marqueur booléen obligatoire :
```ts
isSynthetic: true
```
Ce fanion garantit une séparation hermétique entre les données synthétiques de test et les barrages réels / manuels créés par les unités ou les opérateurs.

---

## 2. Modèle de données (`SyntheticFixedBarrage`)

Le modèle s'intègre harmonieusement dans le dépôt central des marquages (`serveur/depot.mjs` et `src/marquages.js`) sans dédoublonner les structures existantes.

```ts
interface SyntheticFixedBarrage {
  id: string;                    // Identifiant unique déterministe (ex: syn_bfp_001_5y1i0 ou syn_bf_002_2y7we)
  name: string;                  // Nom lisible complet (ex: "Barrage Permanent RN1 — Rabat")
  type: "FIXED" | "FIXED_PERMANENT"; // Type normalisé

  latitude: number;              // Latitude WGS84 arrondie à 5 décimales
  longitude: number;             // Longitude WGS84 arrondie à 5 décimales

  roadName: string;              // Nom complet de l'axe (ex: "Route Nationale RN1")
  roadType: string;              // Type d'axe ("Autoroute", "Route Nationale", "Route Régionale", "Route Provinciale")
  roadReference?: string;        // Référence normalisée (ex: "RN1", "A1", "RR301", "RP3431")

  accidentCount: number;         // Nombre d'accidents annuel simulé selon la classe routière
  accidentPeriod: string;        // Période de référence ("2025-2026")

  isLighted: boolean;            // Indicateur d'éclairage public nocturne (probabilité contextuelle)

  trafficLevel:                  // Niveau de trafic synthétique
    | "LOW"
    | "MODERATE"
    | "HIGH"
    | "VERY_HIGH";

  trafficDescription: string;    // Description lisible ("Circulation fluide", "Circulation dense", etc.)

  isPermanent: boolean;          // true pour FIXED_PERMANENT, false pour FIXED
  isSynthetic: true;             // Marqueur inviolable de simulation

  createdAt: string;             // Horodatage ISO-8601
  updatedAt: string;             // Horodatage ISO-8601

  // Champs de rétrocompatibilité territoriale
  bt?: string;                   // Brigade territoriale de rattachement
  cie?: string;                  // Compagnie
  reg?: string;                  // Région
  lat?: number;                  // Alias latitude
  lng?: number;                  // Alias longitude
  nom?: string;                  // Alias nom
  route?: string;                // Alias roadName
}
```

---

## 3. Positionnement sur le réseau routier & Snapping

Le positionnement est la priorité absolue du générateur pour éviter les barrages aberrants (dans les champs, les oueds ou les bâtiments) :

1. **Extraction depuis le graphe routier national** :
   Le générateur parcourt les arêtes de `public/layers/graphe_routier.json` associées aux classes prioritaires (`autoroute`, `nationale`, `regionale`, `provinciale`).
2. **Attribution territoriale précise** :
   Chaque point candidat est projeté dans les polygones de compétence de `public/layers/circo_bt.geojson` via le test géométrique point-dans-polygone (`dansGeometrie`).
3. **Snapping orthogonal sur polylignes réelles** :
   Chaque candidat fait l'objet d'une projection orthogonale stricte (`pointSurRouteAccepte` / `pointSurRouteAffichee`) sur les tracés haute résolution de `routes_*.geojson` (via `serveur/routesAffichees.mjs`).
4. **Zéro barrage hors réseau** :
   La distance orthogonale entre le point final et le tracé de la route affichée est strictement garantie ≤ 150 mètres (moyenne constatée < 10 mètres).
5. **Dédoublonnage et espacement** :
   Un algorithme glouton spatial garantit un espacement minimal paramétrable (par défaut 4 km) entre deux barrages synthétiques, ainsi qu'une distance de sécurité vis-à-vis de tout barrage réel existant.

---

## 4. Paramètres et heuristiques de simulation

Le moteur pseudo-aléatoire utilise l'algorithme déterministe **Mulberry32** (`creerPRNG(graine)`). À graine identique, le résultat généré est 100 % reproductible bit à bit.

### 4.1 Plages d'accidents configurables (`plagesAccidents`)

```ts
const PLAGES_ACCIDENTS_DEFAUT = {
  autoroute: [10, 40],
  national: [5, 35],
  regional: [2, 20],
  provincial: [0, 12],
  urban: [3, 25],
};
```
- Pour les axes majeurs, la traversée d'une zone à forte densité de population (analyse via `poles-population.json`) induit un décalage proportionnel vers la tranche supérieure de la plage, sans jamais excéder les bornes de la classe d'axe.
- Période de référence configurée par défaut : `2025-2026`.

### 4.2 Éclairage public (`isLighted`)
La probabilité d'éclairage est pondérée par le contexte territorial :
- Zone urbaine (`urban`) : 85 %
- Zone périurbaine (`periurban`) : 50 %
- Autoroutes : 40 %
- Zone rurale : 15 %

### 4.3 Circulation (`trafficLevel` & `trafficDescription`)
- `LOW` : « Circulation fluide »
- `MODERATE` : « Circulation modérée »
- `HIGH` : « Circulation dense »
- `VERY_HIGH` : « Circulation très dense »

La distribution s'adapte au type d'axe et à la proximité des grands pôles urbains (autoroutes et rocades urbaines favorisant `HIGH` et `VERY_HIGH`).

---

## 5. Règles de sécurité, RBAC et protection des barrages permanents

### Règle d'intouchabilité (`FIXED_PERMANENT`)
- Les barrages `FIXED_PERMANENT` ou ayant `isPermanent === true` sont reconnus par la fonction `estIntouchable(m)` du dépôt serveur (`serveur/depot.mjs`) et du frontend (`src/marquages.js`, `src/analysis.js`).
- **Suppression interdite** : Les requêtes de suppression émanant d'utilisateurs ordinaires sont rejetées avec le code `403 Forbidden` (`"Ce barrage permanent est intouchable et ne peut pas être supprimé."`).
- **Modification de position interdite** : Le déplacement cartographique (drag & drop ou saisie de coordonnées modifiées) est bloqué au niveau du dépôt serveur pour les profils sans élévation de privilèges.
- **Règles Superadmin** : Seul un compte disposant des droits d'administration centrale (Superadmin) peut intervenir sur la définition structurelle de ces repères permanents.

### Préservation des données réelles
- Lors de la régénération (`--remplacer` ou `POST /api/barrages/synthetiques/generer`), le système filtre strictement les éléments à purger avec `m.isSynthetic === true`.
- Aucun barrage manuel, aucun barrage réel et aucune donnée opérationnelle n'est jamais supprimée ou altérée.
- Une sauvegarde automatique datée est créée dans `donnees-*/sauvegardes/marquages-pre-synthetique-*.json` avant toute écriture sur le disque.

---

## 6. Rendu cartographique & Ergonomie UI/UX

### Représentation visuelle
- **Barrage Fixe (`FIXED`)** :
  - Couleur : Cyan `#00bcd4`
  - Glyphe : Icône barrage fixe
  - Badge : `Fixe`
- **Barrage Fixe Permanent (`FIXED_PERMANENT`)** :
  - Couleur : Teal foncé `#0d9488`
  - Glyphe : Icône bouclier intouchable
  - Badge : `Permanent / Intouchable`

### Clustering & Filtres
- Les deux types sont intégrés dans le système de clustering hiérarchique par échelons (`src/barrageClustering.js`).
- Le calcul de `fixesCount` agrège automatiquement `barrage_fixe`, `FIXED` et `FIXED_PERMANENT`.
- La visibilité respecte les filtres de zoom, de recherche textuelle et de sélection par région / compagnie / brigade.

### Popup détaillé (`BulleMarquage`)
Au clic sur un barrage synthétique, la bulle affiche :
- Un badge proéminent ambré : `⚠️ Données synthétiques (Simulation UX/UI)`
- Le badge de catégorie : `Permanent / Intouchable` ou `Fixe`
- Nom officiel et identifiant
- Type normalisé (`FIXED_PERMANENT` / `FIXED`)
- Statut permanent : `✓ Permanent` ou `Non`
- Route concernée et référence (`RN1`, `A1`, `RP4025`, etc.)
- Type d'axe routier
- Nombre d'accidents et période (`ex: 24 (2025-2026)`)
- Éclairage nocturne (`💡 Oui (Éclairé)` ou `🌙 Non éclairé`)
- Niveau et description de circulation avec pastille colorée
- Coordonnées géographiques précises (5 décimales)

---

## 7. Commandes CLI et API HTTP

### Scripts npm
- **Vérification complète de la suite de tests** :
  ```bash
  npm run check:barrages-synthetiques
  ```
- **Génération dans le jeu de démonstration (`donnees-demo`)** :
  ```bash
  npm run barrages:synthetiques:demo
  ```
- **Génération personnalisée (CLI)** :
  ```bash
  node scripts/generer-barrages-fixes-synthetiques.mjs --donnees donnees-demo --nombre 80 --graine 20261027 --ratio-permanent 0.3 --espacement 5 --dry-run
  ```
  Options disponibles :
  - `--donnees <dossier>` : Répertoire cible (`donnees-demo`, `donnees-serveur`, etc.)
  - `--nombre <n>` : Nombre de barrages souhaité (défaut : 60)
  - `--graine <seed>` : Graine de reproduction (défaut : 20261027)
  - `--ratio-permanent <r>` : Proportion de permanents entre 0 et 1 (défaut : 0.25)
  - `--espacement <km>` : Espacement minimum en kilomètres (défaut : 4)
  - `--dry-run` : Analyse et simulation sans modification disque
  - `--ecrire` : Autorise l'écriture sur le fichier `marquages.json`
  - `--remplacer` : Remplace les anciens barrages synthétiques sans toucher aux réels
  - `--verbose` : Affiche les détails pour chaque barrage généré

### API REST (`serveur/api.mjs`)
- `GET /api/barrages/synthetiques` : Liste les barrages synthétiques du dépôt.
- `POST /api/barrages/synthetiques/generer` : Déclenche la génération avec paramètres JSON (`{ nombre, graine, ratioPermanent, remplacer, dryRun }`).
- `DELETE /api/barrages/synthetiques` : Purge l'ensemble des données synthétiques du dépôt sans toucher aux données réelles.

---

## 8. Résultats des tests automatisés

La suite de tests automatisée `scripts/verifier-barrages-synthetiques.mjs` valide 8 dimensions critiques :

| Test | Dimension validée | Résultat |
|---|---|---|
| **1 & 2** | Positionnement strict sur réseau routier & Zéro barrage hors route (snapping ≤ 150m) | **PASS** |
| **3** | Conformité stricte à l'interface `SyntheticFixedBarrage` | **PASS** |
| **4** | Statistiques réalistes et cohérentes dans les plages configurées | **PASS** |
| **5** | Protection RBAC et intouchabilité de `FIXED_PERMANENT` | **PASS** |
| **6** | Dédoublonnage, respect de l'espacement et déterminisme (Mulberry32) | **PASS** |
| **7** | Préservation absolue et intégrité des 914 barrages réels existants | **PASS** |
| **8** | Rendu cartographique, intégration clustering et filtres | **PASS** |
| **9** | Performances de génération (< 200 ms grâce au cache en mémoire) | **PASS** |

Exécution : 8 subtests, 0 échec. Palette CIEDE2000 et tests de clustering conservés à 100 %.

---

## 9. Amélioration du filtrage par route — Gestion des barrages Aller / Retour

### 9.1 Objectif et principes directeurs
Le système de filtrage « Par route » distingue de manière réaliste les deux sens de circulation sur les axes routiers à double sens :
- **Sens 1 : ALLER** (direction ascendante ou vers destination, symbole `➔`, badge bleu azur).
- **Sens 2 : RETOUR** (direction descendante ou vers origine, symbole `⬅`, badge ambre).

Chaque barrage est associé à son sens de circulation respectif. Un barrage situé sur le sens Aller est **rigoureusement distinct** d'un barrage situé sur le sens Retour, même lorsqu'ils se trouvent sur le même axe ou au même point kilométrique.

### 9.2 Modèle de données & Attributs
Les barrages bénéficient des champs normalisés suivants (persistés et synchronisés côté serveur dans `serveur/depot.mjs` et `serveur/directionSens.mjs`) :
```ts
interface DirectionalBarrage {
  direction: "ALLER" | "RETOUR";     // Sens normalisé
  sens: "ALLER" | "RETOUR";          // Alias standardisé
  road_id: string;                   // Identifiant canonique de l'axe routier
  route_position?: number;           // Position métrique / kilométrique (PK) sur l'axe
  coordinates: [number, number];     // Coordonnées géographiques [lng, lat]
}
```
- **Détermination déterministe** : Si un barrage possède déjà un sens défini, cette information est strictement conservée. Si la direction est absente, un hachage stable et déterministe (`obtenirDirectionBarrage`) lui assigne une direction cohérente sans créer aucun doublon artificiel.

### 9.3 Affichage cartographique & Décalage latéral de voie
Sur les routes où les deux sens de circulation sont représentés par une géométrie unique médiane (ex: GeoJSON OSM de l'axe routier) :
- Les deux marqueurs utilisent leurs coordonnées réelles.
- Pour éviter la superposition exacte lorsque deux barrages de sens opposés sont situés à la même position (< 35 m), l'algorithme `separerBarragesSens` applique un décalage latéral léger de **±5,5 mètres** (`ajusterPositionSens`) perpendiculaire à l'axe.
- Ce décalage correspond précisément à la séparation des voies de circulation d'une chaussée standard (8 à 14 m de largeur totale). Les marqueurs restent ainsi **strictement sur la chaussée**, parfaitement lisibles et cliquables indépendamment.
- Des badges visuels de direction `A` (Aller) et `R` (Retour) sont intégrés dans les icônes SVG des pins Leaflet (`src/markerIcons.js`).

### 9.4 Filtrage par route et par sens
1. **Modale de filtrage par route (`ModalFiltrerParRoute.jsx`)** :
   - Présente le décompte en temps réel des barrages par sens pour chaque route (`Tous`, `Aller`, `Retour`).
   - Permet de filtrer par « Tous les sens », « Sens Aller ➔ » ou « Sens Retour ⬅ ».
2. **Panneau des conflits latéral (`PanneauConflitsLateral.jsx`)** :
   - Affiche les badges Aller (`➔ Aller`) et Retour (`⬅ Retour`) sur chaque barrage impliqué (`barrageA` et `barrageB`).
   - Adapte le filtrage des conflits à l'axe et au sens sélectionnés.
   - Propose un sélecteur rapide de sens (`Tous`, `Aller ➔`, `⬅ Retour`) dans le bandeau supérieur.
3. **Bulle d'information et Tooltip cartographique** :
   - Les infobulles indiquent le sens (`Sens Aller ➔` ou `⬅ Sens Retour`) et la position kilométrique (PK).

### 9.5 Validation automatisée des 5 cas de test (`scripts/verifier-barrages-aller-retour.mjs`)
La suite de tests dédiée valide exhaustivement les 5 cas obligatoires :

| Cas | Description du test | Statut |
|---|---|---|
| **Cas 1** | Route avec des barrages uniquement dans le sens Aller | **PASS** (2 barrages filtrés, 0 en Retour) |
| **Cas 2** | Route avec des barrages uniquement dans le sens Retour | **PASS** (2 barrages filtrés, 0 en Aller) |
| **Cas 3** | Route avec des barrages dans les deux sens | **PASS** (distinction stricte, pas de doublon) |
| **Cas 4** | Deux barrages superposés / proches sur la même route en sens opposés | **PASS** (séparation de ~11m, décalage ±5.5m sur la chaussée) |
| **Cas 5** | Route avec des barrages fixes (`FIXED`) et permanents (`FIXED_PERMANENT`) dans les deux sens | **PASS** (statuts intouchables et permanents préservés) |

