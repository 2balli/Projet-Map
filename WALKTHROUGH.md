# WALKTHROUGH — Barrage Filtering, Conflict Management & Conflict Assignment

## 1. Overview of Implementation

This overhaul resolves the workflow and data integrity requirements for checkpoint conflict management in the Gendarmerie Royale Map System.

### Core Principles Upheld:
1. **The Conflict is the Assigned Entity, NEVER the Barrage.**
2. **Persistent Side Panel with Distinct Sections (Unassigned vs Assigned).**
3. **Strict Canonical Route Filtering with Visual Consistency on the Map.**
4. **Sanctuarisation of `FIXE INTOUCHABLE` Checkpoints.**

---

## 2. Feature Details & Architecture

### A. Persistent Conflict Side Panel (`PanneauConflitsLateral.jsx`)
- **Location**: Rendered beside the map at `right-2 top-[calc(4.5rem+...)] z-[1200]`.
- **Dynamic Deduplication**: Merges real-time in-memory conflicts from the active map view (`conflitsIdentifies`) with persisted database conflicts (`dbConflits`), indexing them by pair key (`paireCle = clePaire(aId, bId)`).
- **Two Clearly Separated Sections**:
  - **Section A (`Conflits non assignés`)**:
    - Displays detected conflicts that have not yet been assigned (`!estAssigne && statut !== 'resolu'`).
    - Filtered by the active route filter (`filtreRoute`).
    - Displays `"Aucun barrage trouvé sur cette route"` when the filtered route contains zero checkpoints.
  - **Section B (`Conflits assignés`)**:
    - Groups all assigned conflicts together in one dedicated list.
    - Displays assignment recipient (`CMND Région`, delegated `Cie`), timestamp, and consigne.
    - Remains visible even when the unassigned list is route-filtered.
- **Conflict Inspection & Framing**:
  - Clicking any conflict card invokes `onVoirSurCarte(conf)`, which highlights both barrages via `ConflitAssigneLayer` and zooms the map to frame both checkpoints (`fitBounds`).

### B. Assignment, Reassignment & Unassignment Workflow
- **Assigning**:
  - Super Admin selects a conflict card and clicks `Assigner`.
  - Opens `ModalAssignerConflit` and sends `POST /api/conflits/:id/assigner` to the backend.
  - The conflict transitions to `statut: 'a_traiter'`, populated with `assigneA: { matricule, nom, unite, rang }`.
  - It moves immediately from Section A to Section B.
  - **No barrage in the database is modified or given an assignment tag.**
- **Reassigning**:
  - Super Admin clicks `Réassigner` in Section B, allowing selection of a different regional command.
- **Unassigning**:
  - Super Admin clicks `✕ Désassigner` in Section B.
  - Calls `DELETE /api/conflits/:id/assigner` (or `API.desassignerConflit`).
  - Clears `assigneA` and restores status to `'nouveau'`, automatically returning the card to Section A.

### C. Strict Route-Based Barrage Filtering (`GendarmerieMap.jsx`)
- **Canonical Normalization**:
  - Uses `canonicalRouteId` from `src/conflitsIdentifies.js`.
  - Automatically matches variants: `"RN 1"`, `"rn-1"`, `"N1"` ➔ `"RN1"`; `"A 2"`, `"a-2"` ➔ `"A2"`.
- **Map Layer Visibility**:
  - In `marquagesVisibles`, only barrages satisfying `canonicalRouteId(m.route) === canonicalRouteId(filtreRoute)` are rendered.
  - Checkpoints on other routes are hidden from view without being altered or deleted.
  - If a user inspects a conflict (`conflitAssigneVise`), the two participating barrages are retained on the map even if they belong to a different axis, preventing broken UI links.

### D. Strict FIXE INTOUCHABLE Protection
- **Rule**: A company's `FIXE INTOUCHABLE` checkpoint is permanent 24/24 across all shifts. It cannot be deleted or relocated, and its faction cannot be changed.
- **Conflict Handling**:
  - When a conflict involves a `FIXE INTOUCHABLE` and a regular `FIXE`:
    - **Frontend**: The `Changer faction` / `Proposer faction` button is disabled with a strike-through style and a badge `"Faction bloquée (24h/24)"`.
    - **Backend**: `serveur/suiviConflits.mjs` checks `estIntouchable(bA) || estIntouchable(bB)`. Any `action === 'changement_faction'` throws an error returning HTTP 403: `"Action non autorisée : un barrage FIXE INTOUCHABLE ne peut pas changer de faction."`.
    - **Permitted Action**: Only the regular checkpoint can be relocated or adjusted.

---

## 3. Files Containing the Implementation

1. **`src/components/map/PanneauConflitsLateral.jsx`**:
   - Complete side panel component, Sections A & B, route datalist, conflict cards, role-specific buttons.
2. **`src/GendarmerieMap.jsx`**:
   - `marquagesVisibles` canonical route filter logic.
   - Elimination of `API.assignerBarrages` fallback in `confirmerAssignationConflit`.
   - `handleDesassignerConflit` and Super Admin conflict refresh hook.
   - Map bounds fitting and dual-barrage highlight in `afficherConflitSurCarte`.
3. **`serveur/suiviConflits.mjs`**:
   - Centralized `trouverConflit(id)` helper.
   - Assignment/unassignment storage isolated to `suivi-conflits.json`.
   - Backend guard blocking faction changes on intouchable conflicts.
4. **`serveur/api.mjs`**:
   - Outer scope declaration of `perimetre`.
   - Route handlers for conflict listing, assignment, unassignment, and treatment.
   - `DELETE /api/conflits`: Endpoint to safely purge all conflicts in memory and on disk.
5. **`scripts/verifier-filtrage-assignation-conflits.mjs`**:
   - Unit and integration tests for route canonicalization, conflict assignment, intouchable protection, and persistence.
6. **`scripts/vider-conflits.mjs`**:
   - Standalone maintenance script to purge conflict database and cache across all environments (`donnees-demo`, `donnees-serveur`, `donnees-production`, intranet directories) with timestamped backups.

---

### E. Database & Cache Purging System
- **Script**: `npm run conflits:vider` (or `node scripts/vider-conflits.mjs`) scans all data folders, creates a timestamped copy in `sauvegardes/`, and resets `suivi-conflits.json` and `conflits-planification.json` to `{ version: 1, items: [] }`.
- **API Endpoint**: `DELETE /api/conflits` (Super Admin role required) empties conflict depots live.
- **UI Action**: A dedicated red trashcan icon button in `PanneauConflitsLateral.jsx` allows Super Admin to purge conflicts directly with confirmation.
- **Auto-Sync (`relireSiModifie`)**: `serveur/suiviConflits.mjs` watches file `mtimeMs` and reloads immediately if files on disk are reset by external scripts or commands.

---

## 4. Verification and Test Results

| Test Description | Execution Command | Result |
| :--- | :--- | :--- |
| Canonical route normalization & strict filtering | `node --test scripts/verifier-filtrage-assignation-conflits.mjs` | **PASS** |
| Conflict assignment & unassignment (barrages intact) | `node --test scripts/verifier-filtrage-assignation-conflits.mjs` | **PASS** |
| FIXE INTOUCHABLE protection (HTTP 403 on faction change) | `node --test scripts/verifier-filtrage-assignation-conflits.mjs` | **PASS** |
| Persistence & independence from map filters | `node --test scripts/verifier-filtrage-assignation-conflits.mjs` | **PASS** |
| Barrage modifications & protection rules (57 subtests) | `node --test scripts/verifier-modification-barrage.mjs` | **57/57 PASS** |
| Full prebuild validation suite (18 sub-checks) | `npm run prebuild` | **PASS** |
| Production bundle build & arbitrary CSS checks | `npm run build` | **PASS** |

---

## 5. Limitations & Known Considerations
- The local server is designed for offline LAN environments without Supabase cloud dependencies when running in offline mode (`serveur.mjs` / local JSON storage).
- The conflict line between barrages uses graph-based routing (`accrocher` + `itineraire`), falling back to a direct geodesic line if the road graph is still loading or offline.

---

## 6. Route-based Filtering with Distance Calculation & Region Pre-selection

### 1. Formulaire Route + Seuil de Distance + Calculer
- Situé en tête de `PanneauConflitsLateral.jsx` :
  - **Champ Route** avec auto-complétion `datalist` (ex: `RN2`, `A1`, `RN7`...).
  - **Champ Seuil Distance** en km (par défaut `20 km`, ajustable à volonté).
  - **Bouton Calculer** (`⚡ Calculer`) :
    1. Filtre instantanément les barrages affichés sur la carte sur la route sélectionnée via `onFiltrerRoute`.
    2. Parcourt toutes les paires de barrages sur cette route et calcule leur espacement routier via le réseau de transport réel (`RT.itineraire`) ou géodésique.
    3. Retient tous les conflits sous le seuil configuré.
    4. Affiche les résultats dans la **Section A (Non assignés)** aux côtés des autres conflits.
  - **Bouton Réinitialiser** (`✕` ou `Restaurer tout`) pour effacer le filtre et revenir à la vue globale.

### 2. Auto-sélection de la Région Intéressée (`ModalAssignerConflit.jsx`)
- Résolution du problème où Marrakech apparaissait pour des barrages à Nador (ex. Selouane & Zaïou sur la RN2) :
  - L'API backend `POST /api/conflits/cmnd-reg` lit désormais en priorité absolue les identifiants et régions transmises (`regA`, `regB`, `barrageAId`, `barrageBId`).
  - La correspondance tolère les variations de casse et accents (`Nador` -> `REG-NADOR`).
---

## 7. Traitement Direct sur Carte, Résolution Post-Déplacement & Règles INTOUCHABLE

### 1. Cadrage direct et centrage sur le conflit
- Cliquer sur le bouton **« Traiter »** dans `PanneauConflitsLateral.jsx` déclenche immédiatement `afficherConflitSurCarte(conf)` :
  - La caméra de la carte zoome et cadre précisément les deux barrages concernés.
  - Le tracé routier du conflit est dessiné et mis en évidence.
  - La modale de traitement `ModalTraiterConflit.jsx` s'ouvre pour permettre de choisir le barrage et l'action.

### 2. Déplacement interactif sur la route & validation de résolution
- Dans `ModalTraiterConflit.jsx`, le bouton **« ⚡ Déplacer directement ce barrage sur la carte »** arme le déplacement routier interactif :
  - La modale se ferme pour laisser la vue dégagée.
  - L'utilisateur clique sur le nouvel emplacement souhaité le long de la chaussée.
  - Dès la confirmation du déplacement, un bandeau flottant apparaît :
    *« Barrage repositionné avec succès ! Conflit C-XX : Voulez-vous marquer ce conflit comme Traité / Résolu ? [✓ Marquer comme Résolu (Done)] »*
  - Le clic sur **« Marquer comme Résolu (Done) »** enregistre le conflit comme `resolu` dans la base `depotSuiviConflits` et informe le Super Admin et la Région en temps réel.

### 3. Règle absolue FIXE INTOUCHABLE
- Si le conflit implique un barrage **FIXE INTOUCHABLE** :
  - **Changement de faction interdit** : Le mode faction est désactivé avec avertissement.
  - **Seul le barrage régulier peut être modifié** :
    - Option 1 : **« ⚡ Déplacer »** le barrage régulier sur la route.
    - Option 2 : **« 🗑 Supprimer »** le barrage régulier du dispositif (ce qui résout automatiquement le conflit).
  - Le barrage FIXE INTOUCHABLE reste verrouillé et protégé contre tout déplacement ou suppression.

---

## 3. Filtration par Route, Isolation Cartographique & Assignation Groupée (« Assigner tout »)

### A. Suppression de la modale intrusive `OptimisationRoutePanel`
- La fenêtre encombrante (avec boutons jaunes "Optimisation par route", "Route complète", etc.) a été neutralisée.
- Cliquer sur le bouton **« Par routes »** dans la barre de navigation ou sur l'onglet en haut de carte ouvre directement le panneau latéral unifié `PanneauConflitsLateral.jsx`.

### B. Filtration par route + seuil de distance (« Calculer »)
- Dans le panneau latéral, l'utilisateur :
  1. Choisit ou saisit la route (ex: `RN1`, `RN2`, `A1`, `A2`...).
  2. Spécifie le seuil de distance en km (ex: `20 km`, `15 km`...).
  3. Clique sur le bouton doré **« Calculer »**.
- **Résultat immédiat sur la carte** :
  - **Isolation visuelle complète de la route (« triq m3zola »)** : Seuls les barrages appartenant à cette route restent visibles.
  - Tous les autres repères (accidents, pointages de flotte, congestions, et barrages des autres axes) sont masqués pour éviter toute surcharge visuelle.
  - La carte cadre et zoome automatiquement sur l'emprise exacte des barrages de cette route (`fitBounds`).
- **Résultat dans le panneau latéral** :
  - La section **A. Conflits non assignés** affiche immédiatement les conflits calculés sous le seuil sur cette route.
  - L'utilisateur peut inspecter chaque conflit ou l'assigner un par un.

### C. Bouton « ⚡ Assigner tout »
- Dans l'en-tête de la section **A. Conflits non assignés**, un bouton doré **« ⚡ Assigner tout ({nombre}) »** est disponible pour le Super Admin.
- En un seul clic :
  - Le système identifie automatiquement les régions d'appartenance des barrages de chaque conflit (`c.a.reg`, `c.b.reg`).
  - Il affecte chaque conflit aux Commandants de Région concernés (`CMND_REGION`).
  - Tous les conflits traités basculent instantanément de la Section A vers la **Section B. Conflits assignés** avec leurs fiches d'assignation complètes.

---

## 9. Refonte Complète du Traitement des Conflits & Simplification des Fenêtres

### 1. Conservation et Visibilité des Conflits Traités dans l'Espace Superadmin
- **Visibilité Continue** : Les conflits traités ne disparaissent plus du panneau latéral (`PanneauConflitsLateral.jsx`).
- **Section C dédiée & Vue Unifiée** :
  - Un sélecteur en 3 onglets affiche les totaux en temps réel : `Tous (X)`, `En attente (Y)`, `Traités (Z)`.
  - Dans la vue `Tous`, les conflits traités figurent directement dans la même zone dans la **Section C (Conflits traités)** avec un badge émeraude clair `✓ Traité`.
- **Informations Consolidées** :
  - Barrages A et B identifiés avec leur route, région et faction.
  - Décision opérationnelle enregistrée (changement de faction, dérogation, déplacement...).
  - Date de traitement formatée en français et utilisateur/responsable identifié.
  - Justification ou consigne opérationnelle consignée par le commandement.
  - Distinction visuelle entre statut administratif (`Traité`) et réalité physique (`⚠️ Proximité maintenue (< 20 km)` vs `✓ Distance résolue`).
- **Persistance DB Intégrale** : Le traitement est enregistré sur disque dans `suivi-conflits.json` (`statut: 'traite'`, objet `traitement`). Il persiste lors des rafraîchissements de page, reconnexions ou redémarrages serveur.

### 2. Action Traiter Directe et Mise à Jour en Place
- Bouton **`Traiter`** disponible directement sur chaque carte de conflit dans le panneau latéral pour le Superadmin, le CMD Région et le CMD Compagnie.
- Si le conflit est déjà traité, le bouton devient **`Consulter / Re-traiter`** permettant d'ajuster l'arbitrage ou de revoir la justification.
- Actualisation en temps réel sans rechargement de page et sans redirection vers un écran tiers.

### 3. Adaptation Stricte des Options selon la Faction des Deux Barrages
Dans `ModalTraiterConflit.jsx` et `serveur/suiviConflits.mjs` :
- **Cas A — Conflit entre un Barrage Fixe Intouchable (BFI) et un Barrage BF Régulier** :
  - **L'option « Changer la faction » est formellement retirée et invisible**.
  - Explication claire affichée : le BFI est permanent 24h/24 sur tous les créneaux, changer la faction du barrage régulier ne résoudrait pas le conflit opérationnel d'espacement.
  - Seules les actions réellement applicables sont proposées sur le barrage régulier : **Déplacer**, **Supprimer**, ou accorder une **Dérogation opérationnelle**.
  - Le barrage BFI est verrouillé et protégé contre toute suppression ou déplacement.
- **Cas B — Conflit entre deux barrages BF réguliers de même faction** :
  - L'option **« Changer la faction »** est proposée pour découpler les créneaux horaires (ex: Matin vs Après-midi).
  - Règle métier respectée : le conflit physique reste identifié comme maintenu sous décalage horaire (`statutPhysique: 'maintenu_decalage_horaire'`) et ne masque pas la proximité résiduelle.
  - Actions **Déplacer**, **Supprimer** et **Dérogation** disponibles.

### 4. Une Seule Fenêtre de Traitement, Simple et Organisée
- Remplacement des flux fragmentés par une **modale unique** (`ModalTraiterConflit.jsx`) :
  - Identification synthétique des deux barrages (factions réelles, routes, statuts BFI).
  - Détails utiles (distance calculée, seuil réglementaire).
  - Sélecteur d'actions autorisées selon les règles métier.
  - Paramétrage contextuel intégré (choix de faction avec pastilles de couleur, consigne de déplacement ou de suppression).
  - Champ de saisie d'une justification opérationnelle.
  - Boutons `Confirmer le traitement` (avec indicateur de chargement et protection anti-double soumission) et `Annuler`.
- Zéro popups successives : confirmation directe dans la fenêtre sans boîtes de dialogue invasives additionnelles.

### 5. Suite de Tests Automatisée (`scripts/verifier-traitement-conflits.mjs`)
- Intégrée dans `package.json` (`npm run check:traitement-conflits`) et dans la suite obligatoire `npm run prebuild`.
- Valide avec succès :
  1. Cas A (BFI vs BF) : rejet strict du changement de faction et validation par dérogation.
  2. Cas B (BF vs BF) : modification de faction avec statut administratif `Traité` et maintien physique sous décalage horaire.
  3. Déplacement >= seuil réglementaire (20 km) marquant le conflit physiquement résolu (`resolu: true`).
  4. Suppression d'un barrage régulier avec protection absolue des BFI.
  5. Visibilité Superadmin et persistance disque après relecture complète du dépôt.

---

## 10. Option « Remove » (Supprimer) & Maintien de la Visibilité des Conflits

### 1. Bouton « Supprimer » (Remove) Disponible sur Chaque Conflit
- Ajouté à côté des actions existantes sur toutes les cartes de conflit dans [PanneauConflitsLateral.jsx](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/src/components/map/PanneauConflitsLateral.jsx) (onglets `Traités`, `En attente`, et `Non assignés`) ainsi que dans la fiche détaillée [ConflitsIdentifiesLayer.jsx](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/src/components/map/ConflitsIdentifiesLayer.jsx).
- Permet de retirer manuellement et individuellement un conflit ciblé.
- **Portée ciblée** : Ne supprime que le conflit sélectionné sans toucher aux autres conflits.

### 2. Étape de Confirmation Obligatoire (Anti-suppression accidentelle)
- Cliquer sur « Supprimer » ouvre une boîte de dialogue modale dédiée :
  - Affiche l'identifiant du conflit (`C-XX`), la route, les barrages participants (Origine ↔ Destination) et la distance calculée.
  - Explicite clairement : *« Êtes-vous sûr de vouloir supprimer définitivement ce conflit ? Cette action est ciblée et ne retirera que ce conflit spécifique de l’application. »*
  - Boutons explicites : **« Annuler »** (ferme la fenêtre sans modifier aucune donnée) et **« Confirmer la suppression »** (bouton d'action rouge avec icône corbeille et indicateur de progression).

### 3. Persistance en Base de Données (`suivi-conflits.json`) & Prévention des Doublons
- **Backend API** :
  - `DELETE /api/conflits/:id` et `POST /api/conflits/:id/supprimer` dans [serveur/api.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/serveur/api.mjs).
  - Méthode `supprimerConflit({ conflitId, session, depotInstructions, depotNotifications })` dans [serveur/suiviConflits.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/serveur/suiviConflits.mjs).
- **Protection anti-résurrection** :
  - La paire de barrages (`paireCle`) et l'identifiant du conflit sont enregistrés dans la liste persistante `supprimes` du fichier `suivi-conflits.json`.
  - Les détections ultérieures du corridor ou les recalculs automatiques ignorent cette paire et évitent toute ré-apparition involontaire.
  - Toutes les instructions ouvertes associées à ce conflit sont automatiquement archivées/annulées (`statut: 'annulee'`).

### 4. Maintien Strict de la Visibilité des Conflits
- **Aucune disparition automatique** :
  - Les conflits non résolus demeurent visibles dans le panneau latéral (`Non assignés` ou `En attente`) et sur la carte jusqu'à intervention manuelle explicite du commandement ou suppression manuelle.
  - Déplacer ou supprimer un barrage ne supprime pas silencieusement les conflits : les états et historiques antérieurs sont préservés.
  - Les conflits résolus ou traités restent consultables en continu par le Superadmin dans l'onglet **`Traités`** pour revue, comparaison avant/après et approbation/rejet.
- **Synchronisation cartographique** :
  - En cas de suppression manuelle confirmée, le tracé et les étiquettes du conflit ciblé sont retirés de la carte en temps réel sans affecter les autres tracés.

### 5. Validation par Tests Automatisés
- **Suite dédiée** : [scripts/verifier-suppression-conflit.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/scripts/verifier-suppression-conflit.mjs) (**4/4 tests réussis**).
- **Ensemble des suites conflits** : 26/26 tests réussis avec 0 échec.
- **Build production & Lint** : `npm run check:portee` et `npm run build` exécutés avec succès (code 0).

---

## 11. Génération de Données Synthétiques Réalistes pour les Barrages Fixes

### 1. Objectifs & Démarcation
- Ajout d'un système complet de simulation pour générer des barrages fixes (`FIXED`) et des barrages fixes intouchables permanents (`FIXED_PERMANENT`).
- **Avertissement Simulation** : Données fictives créées avec `isSynthetic: true` pour les tests UX/UI et la simulation, isolées de toute donnée opérationnelle réelle.

### 2. Architecture & Composants Réutilisés
- **Moteur déterministe** : [serveur/generateurSynthetique.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/serveur/generateurSynthetique.mjs)
  - PRNG déterministe Mulberry32 garantissant l'idempotence et la reproductibilité via seed.
  - Échantillonnage sur le graphe routier [graphe_routier.json](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/public/layers/graphe_routier.json) et rattachement territorial via [circo_bt.geojson](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/public/layers/circo_bt.geojson).
  - Projection orthogonale stricte (snapping) sur les polylignes affichées `routes_*.geojson` (distance < 150m, moyenne < 10m). Zéro barrage hors réseau routier.
  - Évaluation contextuelle (urbain / périurbain / rural) via [poles-population.json](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/public/layers/poles-population.json).
  - Cache en mémoire des couches permettant une exécution ultra-rapide (< 150 ms).
- **CLI & Amorçage** : [scripts/generer-barrages-fixes-synthetiques.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/scripts/generer-barrages-fixes-synthetiques.mjs)
  - Options complètes : `--donnees`, `--nombre`, `--graine`, `--ratio-permanent`, `--espacement`, `--dry-run`, `--ecrire`, `--remplacer`, `--verbose`.
  - Commandes npm : `npm run barrages:synthetiques:demo` et `npm run barrages:synthetiques:generer`.
- **Dépôt & Sécurité RBAC** : [serveur/depot.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/serveur/depot.mjs) & [src/marquages.js](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/src/marquages.js)
  - Prise en charge des types `FIXED` et `FIXED_PERMANENT`.
  - Intouchabilité inviolable : `estIntouchable` verrouille `FIXED_PERMANENT` et `isPermanent: true` contre la suppression et le déplacement pour les rôles ordinaires (HTTP 403).
  - Préservation intégrale des 914 barrages réels/manuels avec sauvegarde automatique avant écriture.
- **Rendu Cartographique & Popups** : [src/GendarmerieMap.jsx](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/src/GendarmerieMap.jsx)
  - Couleurs et icônes dédiées : Teal `#0d9488` pour Permanent, Cyan `#00bcd4` pour Fixe.
  - Bulle détaillée avec avertissement « Données synthétiques (Simulation UX/UI) », badges, accidents, éclairage, niveau/description de circulation, référence routière et coordonnées.
  - Intégration transparente au clustering d'échelons ([src/barrageClustering.js](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/src/barrageClustering.js)).

### 3. Validation par Tests Automatisés
- **Suite dédiée** : [scripts/verifier-barrages-synthetiques.mjs](file:///c:/Users/windows10/Desktop/Projet%20Map%2010-23-2026/Projet%20Map/scripts/verifier-barrages-synthetiques.mjs) (**8/8 tests réussis, 100 % passants**).
- Commande : `npm run check:barrages-synthetiques`.
- Conformité de la palette CIEDE2000 et des 9 tests de clustering vérifiée.

