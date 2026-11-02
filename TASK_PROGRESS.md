# TASK_PROGRESS — Gendarmerie Royale Map System

## 1. Current Task & Requirements

### Task: Génération de données synthétiques réalistes pour les barrages fixes (COMPLETED ✅)
- **Objectif**: Ajouter un système de génération de données synthétiques réalistes pour créer des barrages fixes (`FIXED`) et des barrages fixes intouchables permanents (`FIXED_PERMANENT`) positionnés directement sur le réseau routier marocain (routes nationales, régionales, provinciales, autoroutes, urbaines/périurbaines).
- **Statut**: ✅ **Terminé et validé à 100 %**.
- **Réalisations**:
  1. Types `FIXED` et `FIXED_PERMANENT` conformes à l'interface `SyntheticFixedBarrage`.
  2. Moteur de simulation déterministe (`serveur/generateurSynthetique.mjs`) avec PRNG Mulberry32, projection orthogonale stricte (snapping sur `routes_*.geojson`), zéro barrage hors réseau (distance < 150m, moyenne < 10m).
  3. Données et statistiques cohérentes : plages configurables (`autoroute: [10, 40]`, `national: [5, 35]`, `regional: [2, 20]`, `provincial: [0, 12]`, `urban: [3, 25]`), période `2025-2026`, éclairage contextuel, niveaux de trafic (`LOW`, `MODERATE`, `HIGH`, `VERY_HIGH`) et descriptions lisibles.
  4. Rendu cartographique distinct : teal `#0d9488` + bouclier pour permanent, cyan `#00bcd4` pour fixe, badges « Permanent / Intouchable » et « Fixe », intégration au clustering (`fixesCount`) et aux filtres.
  5. Popup détaillée (`BulleMarquage`) avec badge d'avertissement « Données synthétiques (Simulation UX/UI) », référence routière, accidents, éclairage, niveau/description de circulation, coordonnées (5 décimales).
  6. Script CLI d'amorçage (`scripts/generer-barrages-fixes-synthetiques.mjs`) avec options `--donnees`, `--nombre`, `--graine`, `--ratio-permanent`, `--espacement`, `--dry-run`, `--ecrire`, `--remplacer`, `--verbose`.
  7. API REST (`GET/POST/DELETE /api/barrages/synthetiques`) et fonctions frontend (`src/api.js`).
  8. Sécurité & RBAC : fanion obligatoire `isSynthetic = true`, protection stricte des intouchables contre suppression/déplacement par utilisateurs ordinaires, préservation intégrale des 914 barrages réels existants avec sauvegarde automatique.
  9. Suite de tests automatisée `scripts/verifier-barrages-synthetiques.mjs` (8 subtests, 100% de réussite). Script npm `npm run check:barrages-synthetiques` et `npm run barrages:synthetiques:demo`.
  10. Documentation complète dans `PROJECT_MAP.md`, `TASK_PROGRESS.md`, `WALKTHROUGH.md`.

### Task: Complete Overhaul of Barrage Filtering, Conflict Management and Conflict Assignment (COMPLETED)
- Automatic conflict detection & persistent side panel
- Assign conflicts, NEVER assign barrages
- Strict route-based barrage filtering
- FIXE INTOUCHABLE protection & restricted actions

### Task: Purge all conflicts in database and cache (COMPLETED ✅)
- **Objective**: Remove all stored conflicts from database (`suivi-conflits.json`, `conflits-planification.json`) and cache across all environments.
- **Completed**: 57 legacy conflicts purged with timestamped backups created.

### Task: Route Isolation, Pure Barrage Display, and Bulk Assignment (COMPLETED ✅)
- **Objective**:
  1. Remove / prevent the cluttered `OptimisationRoutePanel` dialog from popping up.
  2. In route filtering: user chooses route + distance (km) + clicks **Calculer**:
     - Map directly isolates that route corridor and fits bounds cleanly to its barrages.
     - ONLY barrages belonging to that route are shown on the map (hide non-barrage markers and unrelated barrages to avoid clutter).
  3. Calculated non-assigned conflicts appear immediately in the side panel (`PanneauConflitsLateral.jsx`) Section A.
  4. Add **`⚡ Assigner tout`** button in Section A header to assign all visible non-assigned conflicts in one click to their interested Region commands (`CMND_REGION`).

### Task: Correction complète du traitement des conflits + simplification des fenêtres (COMPLETED ✅)
- **Objective**:
  1. **Conserver les conflits traités dans l'espace Superadmin** :
     - Conflit traité reste visible dans le même panneau et la même liste pour le Superadmin avec le statut clair `Traité`.
     - Conserve toutes les informations : barrages A & B, nature, décision, date, auteur, persistance DB.
     - Distinction visuelle claire entre conflits en attente et conflits traités sans masquer ni supprimer.
  2. **Action Traiter directement dans la carte/ligne du conflit** :
     - Action `Traiter` accessible directement sur chaque fiche de conflit pour Superadmin, Région et Compagnie.
     - Actualisation immédiate du statut dans cette même ligne/carte sans déplacer vers une autre page.
  3. **Règles métier strictes selon factions (BFI vs BF et Même Faction)** :
     - **Cas A (BFI intouchable vs BF)** : INTERDICTION stricte de l'option `Changer la faction` (ne résout rien car le BFI est permanent 24h/24) avec message explicatif clair. Seuls déplacer ou supprimer le BF ou consigner une dérogation sont proposés.
     - **Cas B (Même faction)** : `Changer la faction` découple les créneaux horaires, enregistre le conflit comme `Traité (décalage horaire)` tout en maintenant la surveillance sur la distance physique.
  4. **Une seule fenêtre de traitement, simple et organisée** :
     - Une unique modale tout-en-un par conflit (`ModalTraiterConflit.jsx`) (détails, 2 barrages, localisation, distance, actions autorisées, champ justification, boutons Confirmer / Annuler).
     - Zéro popups successives ou fragmentées.
  5. **Cohérence détection et persistance** :
     - Distinguer statut administratif `Traité` de l'existence géographique du conflit (si la proximité physique persiste, le statut reste `Traité` tout en signalant la persistance).
  6. **Suite de tests automatisée** :
     - `scripts/verifier-traitement-conflits.mjs` validant les 5 critères métier (Cas A, Cas B, Déplacement >= seuil, Suppression, Persistance DB & Visibilité Superadmin). Intégré dans `prebuild`.

---

## 2. Current Project State
- **Status**: ✅ **Task complete and verified**. All tests passing (100%), ESLint clean, prebuild clean, production build clean.
- **Dev Server**: Active on port 8090 (`npm run serve:demo`).

---

## 3. Completed Milestones

### Milestone 1: Server-side Conflict Depot & API Guards
- Refactored `serveur/suiviConflits.mjs`:
  - Extracted centralized `trouverConflit(id)` closure helper to resolve method binding issues.
  - Conflict assignments/unassignments write only to `suivi-conflits.json` and never alter barrage records.
  - Added strict guard blocking `changement_faction` with HTTP 403 when a conflict involves a `FIXE INTOUCHABLE` (`estIntouchable(bA) || estIntouchable(bB)`).
- Fixed lexical scoping error in `serveur/api.mjs`:
  - Hoisted `let perimetre = null;` to outer function scope in `POST /api/barrages/optimisation-auto`.

### Milestone 2: UI Persistent Side Panel (`PanneauConflitsLateral.jsx`)
- Implemented persistent side panel beside the map.
- Section A: **Conflits non assignés** with strict route filtering, empty state, and status counts.
- Section B: **Conflits assignés** grouping all assigned conflicts together with full assignment metadata.
- Route filter datalist suggestions and clear button.
- Added UI purge button for Super Admin with confirmation dialog.

### Milestone 3: Map Filtering & Synchronization (`GendarmerieMap.jsx`)
- Integrated canonical route filtering via `canonicalRouteId` in `marquagesVisibles`.
- Completely removed the invalid fallback that assigned barrages (`API.assignerBarrages`).
- Added `handleDesassignerConflit` calling `API.desassignerConflit`.
- Wired conflict inspection (`afficherConflitSurCarte`) to highlight both barrages via `ConflitAssigneLayer` and fit map bounds.

### Milestone 4: Automated Testing & Verification
- Created `scripts/verifier-filtrage-assignation-conflits.mjs` testing all 15 acceptance criteria.
- Fixed pre-existing typo in `scripts/verifier-modification-barrage.mjs`.

### Milestone 5: Complete Conflict Database & Cache Purge
- Added `relireSiModifie()` and `vider()` in `serveur/suiviConflits.mjs` and `serveur/conflitsPlanification.mjs`.
- Implemented `DELETE /api/conflits` in `serveur/api.mjs` and `API.viderConflits()` in `src/api.js`.
- Added `suivi-conflits.json` to `scripts/vider-donnees.mjs`.
- Created and executed `scripts/vider-conflits.mjs` (`npm run conflits:vider`): 57 legacy/demo conflicts purged with timestamped backups created. All environments reset to `{ version: 1, items: [] }`.

### Milestone 6: Route Filtering with Distance Threshold & Interested Region Auto-selection
- **Interested Region Auto-detection**:
  - `POST /api/conflits/cmnd-reg` now accepts `barrageAId`, `barrageBId`, `regA`, and `regB` as primary criteria rather than relying on stale legacy conflict records.
  - Matches region names case-insensitively and diacritic-insensitively (`Nador` -> `REG-NADOR`).
  - Pre-selects interested regions (`duConflit: true`) automatically in `ModalAssignerConflit.jsx`.
- **Route + Distance Filter & Calculation**:
  - Added Route input (with datalists), Distance threshold input (in km), and a **Calculer** button in `PanneauConflitsLateral.jsx`.
  - Computes pairwise conflict distances along the chosen route using the road graph (`RT.itineraire`) with fallback to geodesic `distanceKm`.
  - Filters and displays detected conflicts under the threshold in Section A alongside existing conflicts.
  - Synchronizes visible map barrages with `onFiltrerRoute`.

### Milestone 7: Direct Conflict Traitement, Map Centering, Post-Move Resolution & Intouchable Rules
- **Direct Map Centering**:
  - Clicking `Traiter` in `PanneauConflitsLateral.jsx` automatically centers the map on the conflict (`afficherConflitSurCarte`), fitting the bounds to the two barrages and highlighting the route segment.
- **Interactive Road Displacement & Conflict Resolution**:
  - In `ModalTraiterConflit.jsx`, added direct `⚡ Déplacer directement ce barrage sur la carte` which arms displacement on the road for the selected barrage.
  - Once repositioned and confirmed, an interactive floating banner appears:
    *« Barrage repositionné avec succès ! Conflit C-XX : Voulez-vous marquer ce conflit comme Traité / Résolu ? [✓ Marquer comme Résolu (Done)] »*
  - Clicking the button marks the conflict as `resolu` in `depotSuiviConflits` and broadcasts the resolution to both the Super Admin and Regional Command.
- **Strict FIXE INTOUCHABLE Conflict Rules**:
  - For a conflict between a `FIXE INTOUCHABLE` and a regular `FIXE` barrage:
    - `Changer la faction` is completely blocked and disabled.
    - Two clear operational actions are provided for the regular barrage: `⚡ Déplacer` ou `🗑 Supprimer`.
    - The `FIXE INTOUCHABLE` barrage is permanently locked against deletion and displacement.
    - Suppressing the regular barrage automatically resolves the conflict and updates the database.

### Milestone 8: Route Isolation, Pure Barrage Display & Bulk Assignment (« Assigner tout »)
- **Elimination of Cluttered Modal (`OptimisationRoutePanel`)**:
  - The disruptive screen-blocking modal `OptimisationRoutePanel` is completely silenced and disabled.
  - Navbar item "Par routes" and the map header tab now cleanly open the persistent contextual side panel (`PanneauConflitsLateral.jsx`).
- **Pure Route Isolation & Centering**:
  - Filtering by route (`filtreRoute`) strictly isolates the selected route corridor on the map.
  - Only barrages belonging to the selected route remain visible (`marquagesVisibles`); non-barrage markers (accidents, pointages, congestions) and unrelated checkpoints are hidden.
  - Automatically frames the route and its checkpoints using Leaflet `fitBounds` with padding.
- **Bulk Assignment to Concerned Regions (`⚡ Assigner tout`)**:
  - Added `⚡ Assigner tout ({totalNonAssignes})` button in Section A header of `PanneauConflitsLateral.jsx`.
  - In a single click, maps each unassigned conflict on the route to its interested Region commands (`CMND_REGION`) based on `c.a.reg` and `c.b.reg`.
  - Dispatches assignment payloads directly via `API.assignerConflit` and automatically transitions all resolved conflicts into Section B (Conflits assignés).

---

## 4. Files Modified / Created

| File | Status | Description |
| :--- | :--- | :--- |
| `src/GendarmerieMap.jsx` | Modified | Strict canonical route filtering, conflict-only assignment, unassignment handler, Super Admin filter sync hook. |
| `src/components/map/PanneauConflitsLateral.jsx` | Modified | Persistent side panel, Sections A & B, route datalist, FIXE INTOUCHABLE UI lockout, assign/reassign/unassign buttons. |
| `serveur/suiviConflits.mjs` | Modified | Robust `trouverConflit` closure lookup, HTTP 403 on intouchable faction change, barrage isolation. |
| `serveur/api.mjs` | Modified | Outer lexical scoping for `perimetre`, intouchable protection checks. |
| `scripts/verifier-filtrage-assignation-conflits.mjs` | Created | Automated test suite validating canonical routes, conflict assignment, intouchable protection, persistence. |
| `scripts/verifier-modification-barrage.mjs` | Modified | Fixed variable reference in Test 10. |
| `TASK_PROGRESS.md` | Created | Persistent progress tracker. |
| `WALKTHROUGH.md` | Created | Continuous walkthrough documentation. |
| `NEXT_STEPS.md` | Created | Execution checklist and next actions. |

---

## 5. Important Implementation Decisions

1. **Conflict as Entity, Never Barrages**: `confirmerAssignationConflit` in `GendarmerieMap.jsx` strictly invokes `API.assignerConflit`. Under no circumstance is `API.assignerBarrages` called.
2. **Canonical Route Normalization**: Road names (`RN 1`, `rn-1`, `N1`, `A 2`, `a-2`, `RR 322`) are normalized via `canonicalRouteId` to ensure strict matching without fragile string comparisons.
3. **Dual-Layer FIXE INTOUCHABLE Guard**: Frontend shows a disabled button with `"Faction bloquée (24h/24)"` and backend throws HTTP 403 / error if a request attempts `changement_faction` on an intouchable barrage.
4. **Section B Permanence**: Assigned conflicts remain in Section B even when the unassigned list is filtered by route.

---

## 6. Errors Encountered & Resolutions

- **Issue**: `ReferenceError: perimetre is not defined` in `serveur/api.mjs`.
  - **Resolution**: Hoisted `let perimetre = null;` out of the conditional block to function scope.
- **Issue**: Unbound `this.parId` / `parId is not a function` in `serveur/suiviConflits.mjs`.
  - **Resolution**: Defined internal `trouverConflit(id)` closure helper used consistently across all methods.
- **Issue**: ESLint `no-use-before-define` error on `portee` in `src/GendarmerieMap.jsx`.
  - **Resolution**: Moved the Super Admin sync `useEffect` below line 7914 where `portee` is defined.
- **Issue**: Integration test failed with `creerDepotMarquages is not a function`.
  - **Resolution**: Corrected import to `creerDepot` from `serveur/depot.mjs` and wrapped fixtures in `{ version: 1, items: [...] }`.

---

## 7. Tests Executed & Actual Results

- `node --test scripts/verifier-filtrage-assignation-conflits.mjs` ➔ **4/4 PASS** (0.09s)
- `node --test scripts/verifier-modification-barrage.mjs` ➔ **57/57 PASS** (5.5s)
- `npm run prebuild` ➔ **PASS (100%)** (18 sub-checks: ESLint, icones, releves, placement, parcours, palette, etc.)
- `npm run build` ➔ **PASS** (Vite build + check:classes postbuild)

---

## 8. Last Completed Milestone
- **Milestone 4**: Full verification and test validation completed with 0 errors.

---

## 9. Next Steps
- See `NEXT_STEPS.md` for the current resume checklist.

---

## Refonte UI/UX « type Mapbox » — thèmes clair/sombre et étiquettes territoriales (2026-10-28)

### Réalisé
- **Thème clair / sombre** persistant (`src/theme.js`, `public/theme-initial.js`) : choix mémorisé par poste, sinon préférence système, sinon sombre ; posé avant le premier rendu (fichier externe — la CSP `script-src 'self'` refuse un script en ligne). Bascule dans la barre de commandement.
- **Jetons de charte** (`src/index.css`) : variables CSS par thème ; les couleurs Tailwind (`gr-navy`, `gr-gold`, `text-primary`…) y renvoient (`@theme inline`). En clair, `white`, `black`, `slate-100..300` et les nuances pâles (100–400, 900–950) sont redéfinies à la source : les ~2 000 emplois existants suivent sans réécriture.
- **Codemod** : 396 classes à couleur codée en dur remplacées par des jetons (49 fichiers, classes uniquement).
- **Fond de carte** : thème transmis à `construireStyle` (+ option rétrocompatible `retouches` dans `maroc-carte-offline/src/carte-style.js`) ; rechargement du style en place au changement de thème ; noms de villes du fond à partir du zoom 7, nom de pays retiré.
- **Étiquettes territoriales sans chevauchement** (`src/placementEtiquettes.js`, `BarrageClusterLayer.jsx`) : ancre = pôle d'inaccessibilité ; placement glouton par priorité (sélection > effectif) ; repli en renvoi avec trait de rappel, puis en point cliquable ; filigrane des régions aux zooms 7–8. Calcul par zoom entier, stable au glissement.
- **Mode focus** (bouton + touche F, Échap pour sortir), **réinitialisation des filtres** de la barre du bas, barre haute qui se range devant le panneau des conflits, correction de la faute `space-y-1verflow-y-auto` du rail.

### Tests
- `npm run check:etiquettes` (nouveau, dans `prebuild`) ➔ **10/10 PASS** sur les limites réelles (aucun chevauchement aux zooms 5–8).
- `npm run build` complet ➔ **PASS** (25 contrôles préalables, 126 cas `node:test`, build, `check:classes`).
- Navigateur (Chrome sans tête, mode FICTIF) : mesure dans le DOM rendu ➔ **0 chevauchement** aux zooms 6, 8 en sombre et clair ; bascule et persistance du thème ; mode focus ; 1024×768 sans défilement horizontal.

### Préexistant, non corrigé
- Mode FICTIF (`npm run dev`) : sélectionner une région ouvre l'Analyse, dont `SituationSection` lit `situation.brigades.sansEffectif` ; le fournisseur fictif renvoie une situation plate ➔ exception et écran blanc. Le serveur réel n'est pas concerné.

### Passe complémentaire — couleurs du thème clair (2026-10-28)
- Tons d'état thématisés (`--tone-danger`, `--tone-ok`, `--tone-warn`, `--tone-info`, `--tone-amber`…) : pastels en sombre, nuances profondes en clair. Appliqués à 26 règles CSS (étiquettes de conflit, aperçus, bulles) et à 29 styles en ligne (MapPopups, GendarmerieMap, SidePanel) ; les tracés Leaflet en canevas (`pathOptions`) ne sont pas touchés.
- Étiquettes posées sur la carte (conflits, aperçus de déplacement, « je suis ici ») : fond et texte du thème.
- Thème clair : `black` → ardoise pâle (puits des champs et cases), voiles de modale dédiés (`--voile-modal`), `gr-red` plus foncé.
- Écran de connexion : dégradé et carte aux jetons du thème ; barre comparatif avant/après idem.
- Vérifié dans le navigateur, en clair : connexion, Saisie terrain, Effectifs, Distances, Filtration, Par routes, Organisation, Décisions, Administration, Légende, panneau des conflits, bulle d'un barrage ; en sombre : connexion et bulle inchangées. `npm run build` complet ➔ PASS.

### Tracés « après déplacement » limités aux conflits du panneau (2026-10-29)
- Constat : le tracé rouge Poste fixe Témara ↔ BFI Ain Aouda (19,21 km < 20 km, Intouchable donc toutes factions) venait de la mesure serveur des repositionnements (fenêtre de 7 jours), sans aucun conflit correspondant dans le panneau latéral.
- Décision utilisateur : ne tracer un conflit après déplacement que si la paire est un conflit ACTIF du panneau (enregistré ou détecté, ni traité ni supprimé).
- `src/etatConflits.js` : définitions partagées panneau / carte (`estConflitTraite`, `estConflitAssigne`, `estConflitNonAssigne`, `pairesConflitActives`) ; `PanneauConflitsLateral.jsx` les importe ; `GendarmerieMap.jsx` filtre `routesRepositionnement`. Serveur inchangé.
- `npm run check:etat-conflits` (nouveau, dans `prebuild`) ➔ 6/6 ; navigateur : 0 tracé sans conflit, 1 avec conflit actif, 0 une fois traité ; `npm run build` ➔ PASS (132 cas).

### Workflow hiérarchique des conflits + trois thèmes par utilisateur (2026-10-29)
**Workflow** (`serveur/workflowConflits.mjs`, machine à états pure) — états portés par le champ existant `approbation.statut` :
`en_attente_reg` (EN_ATTENTE_CMD_REGION) → `en_attente_admin` (EN_ATTENTE_SUPERADMIN) → `approuve` + `statut: 'cloture'` (APPROUVE_FINAL) ; refus : `rejete_reg` / `rejete_admin` (+ `statut: 'a_corriger'`). La clôture ne se confond plus avec `resolu` (résolution automatique).
- Gardes serveur : rôle, périmètre, étape, motif de refus obligatoire (422), double soumission / double validation / écran périmé (409, `etatAttendu`). Le changement de faction n'est plus écrit avant la garde.
- Resoumission : cycles précédents conservés (`cycles`), transitions en ajout seul (`transitions`) + journal d'audit `journal.jsonl` (`action: 'conflit-transition'`).
- Notifications ADRESSÉES (`publierConflit`, `destinataires`, sans périmètre) — auparavant aucune notification de workflow n'était réellement émise.
- Historique : `GET /api/conflits/historique` (filtres date, région, compagnie, brigade, faction, statut, intervenant), lecture seule ; réouverture Superadmin auditée `POST /api/conflits/:id/rouvrir`. Conflits clos jamais supprimés, vidés, rouverts par la détection ni captés par leur paire.
- Suppression d'un conflit : désormais limitée au périmètre du compte (auparavant : toute session).
- Interface : onglets Non assignés / À traiter / À valider / Suivi / Historique (compteurs serveur), refus motivé en ligne, `HistoriqueConflits.jsx`.
- Migration réversible `npm run conflits:migrer-workflow -- --donnees <dossier> [--ecrire | --restaurer <sauvegarde>]` ; appliquée à donnees-demo (12 clôturés, 6 → validation Région, 1 réactivé, 8 inchangés ; sauvegarde dans donnees-demo/sauvegardes/).

**Thèmes** : Light Professional / Dark Tactical / Slate Blue — Paramètres → Apparence (`MenuParametres.jsx`) ; préférence dans le compte (`/api/preferences`, `comptes.json`), copie locale par matricule, anti-éclair `public/theme-initial.js`. Contrastes recalculés (WCAG AA sur panneaux et cartes).

**Tests** : `check:workflow-conflits` (12, dans prebuild), `check:workflow-conflits:api` (41, service réel), `check:etat-conflits` (8) ; `verifier-traitement-conflits` et `verifier-audit-ameliorations` mis à jour (les 2 échecs préexistants décrivaient l'ancien modèle à une étape). `npm run build` ➔ PASS (146 cas).

### Palettes premium × modes et animations (2026-10-29)
**Thèmes** : Midnight Command, Graphite & Electric Blue, Arctic Professional, Forest Slate — chacun en clair et en sombre, + mode « Système ». `src/apparence.js` (pur, testé), `src/theme.js` (crochet), `public/theme-initial.js` (anti-éclair). Préférence `{ palette, mode }` par compte (`/api/preferences`, ancien `{ theme }` converti). Paramètres → Apparence : segments Clair/Sombre/Système + cartes de palette (groupes radio clavier). Contrastes WCAG AA vérifiés pour les 8 combinaisons par `npm run check:theme` (sur les valeurs d'index.css) ; 3 tons d'état clairs assombris pour y parvenir.
**Animations** (CSS d'abord, aucune dépendance) : jetons de durée coupés par `prefers-reduced-motion` ; fondu de thème 240 ms hors repères de carte ; fond de carte mis à jour par différence (0 tuile retéléchargée) ; utilitaires `animate-in`/`fade-in`/`zoom-in-95`/`slide-in-*` (employés mais inopérants : le greffon n'était pas installé) ; entrée/sortie des panneaux (`usePresence`), menus, modales ; indicateur glissant du rail et des segments ; sections repliables sans saut ; retour d'appui ; squelettes ; toasts (`Toasts.jsx`, aria-live) ; badges et compteurs animés au changement ; carte de conflit qui quitte sa file après la réponse du serveur, relecture silencieuse ; tracé progressif de la route sélectionnée (préfixe exact de la géométrie, `traceProgressive.js`) ; retour de survol/sélection des repères par `filter` (jamais `transform`), `will-change` retiré des repères.
**Mesures** (Chrome sans tête, rendu logiciel) : changement de thème sans décalage de mise en page, 0 tuile retéléchargée, 1–2 tâches longues (54–107 ms) avec 309 repères ; déplacement de carte identique avec et sans animations (médiane 156 ms/image dans les deux cas — coût du rendu logiciel, pas des animations) ; sortie de panneau 230 ms puis démontage ; repli de carte de conflit 72 ms après la réponse du serveur, compteurs 6→5 / 0→1 conformes au serveur.
**Tests** : `check:theme` (11), `check:trace` (4) ajoutés au prebuild ; `check:workflow-conflits:api` 43/43 ; `npm run build` ➔ PASS (161 cas).

### Radar des nouveaux conflits (2026-10-29)
**Détection** (`src/detectionConflits.js`, pur) : le détecteur observe la liste serveur `GET /api/conflits` (déjà filtrée par périmètre) ; la première lecture de la session sert de référence (ouverture, rechargement, thème, nouveaux rendus ne rejouent rien). Signature = id + date du dernier événement `detection`/`reouverture` de l'historique : une réapparition est annoncée de nouveau, une assignation non. Seuls les conflits actifs non soumis sont annoncés ; au plus 3 impulsions simultanées (les plus récentes) ; conflit sans coordonnées : annoncé dans la carte, jamais animé. Relecture déclenchée par le flux temps réel existant (chaque notification) + toutes les 30 s, onglet visible.
**Carte** (`RadarConflits.jsx`) : 3 ondes rouge alerte `#E11D2E` (CSS transform/opacity), brève lueur, zone du conflit (disque contenant les deux postes) 3,2 s, puis repère statique cliquable/focalisable. Mouvement réduit : ni ondes ni lueur, zone immobile. **Alerte** (`CarteNouveauConflit.jsx`) : une seule carte (regroupe les arrivages), type, identifiant, postes, distance, « Voir sur la carte » → `afficherConflitSurCarte` existant (centre, zoome, ouvre le panneau des conflits ; pas de modale). Disparition à 25 s, suspendue au survol/focus. Aucune modification serveur, workflow ou permissions.
**Tests** : `check:radar` (9, données réelles, au prebuild) ; `check:radar:api` (7, bout en bout : un vrai changement de faction par un CMD Région → le serveur détecte → annoncé une fois, situé, historique daté, relecture muette, autre région muette). Navigateur (serveur réel) : impulsion 164–185 ms après l'opération d'un autre compte, ondes 0,97→3,4× opacité →0, zone qui s'efface, repère statique ensuite ; thème clair et rechargement sans rejeu ; « Voir sur la carte » ouvre le panneau, sans modale ; mouvement réduit conforme. `npm run build` ➔ PASS (170 cas).
**Limites** : la notification temps réel de détection ne porte pas l'id du conflit, d'où une relecture de la liste à chaque événement ; les gestes de l'utilisateur lui-même ne passent pas par son flux et sont vus au plus tard au relevé de 30 s ; la zone est un disque, pas le tracé routier.

### Détection animée des conflits — séquence complète et états du workflow (2026-10-30)
**Déclenchement réel** : `api.js` annonce (`gr-detection-conflits`) le début et la fin des écritures dont la route serveur appelle `actualiserSuiviConflits` (faction, modification d'un barrage, assignation, transmission/traitement d'assignation, action sur demande) ; la carte relit alors la liste — une seule fois — et le détecteur dit s'il y a du nouveau. Les gestes des autres arrivent par le flux temps réel existant. **Relevé de 30 s supprimé** (plus aucun sondage). Mode fictif : rien n'est annoncé.
**Séquence** (`RadarConflits.jsx`, `index.css`) : pastille « Analyse des conflits… » (balayage) pendant la requête → repère qui grandit (0,2→1, léger rebond) → 3 ondes radar + lueur + zone → liaison lumineuse tracée entre les deux postes (pathLength normalisé) → pulsation de veille discrète jusqu'à la prise en compte (consultation ou assignation ; au plus 12 simultanées). Sans nouveauté : « Aucun nouveau conflit détecté » ~2,6 s.
**États** (`phaseConflit`, lecture seule du workflow) : nouveau rouge #EF4444 pulsant ; en attente (assigné / renvoyé / consulté) ambre #F59E0B fixe ; en traitement (`en_cours`) bleu #3B82F6 arc tournant ; traité (EN_ATTENTE_*) neutre immobile ; approuvé/clos/résolu : repère retiré.
**Notification** : « Conflit détecté », toute l'entrée cliquable (ouvre le panneau des conflits existant sur ce conflit, centre la carte), dédoublonnage inchangé. **Robustesse** : `GardeErreur.jsx` autour de l'application (plus de page blanche : message + recharger) et autour du radar/alerte/pastille (échec silencieux, la carte continue).
**Tests exécutés** : `check:radar` 11/11 (dont états du workflow sur données réelles, conflit jamais modifié) ; `check:radar:api` 17/17 (conflit réellement détecté → transmis → traité par la Cie → validé Région → approuvé Superadmin : rouge → bleu → neutre → retiré, aucune ré-annonce) ; `npm run build` PASS (172). Navigateur (dev, API réelle) : pastille 61 ms après le début, notification ~370 ms, repère 0,2→1,07→1, liaison tracée 0,74→1,65 s, veille `infinite`, consultation → ambre ; opération sans conflit → « Aucun nouveau conflit détecté » (308 ms) ; mouvement réduit : ni échelle, ni ondes, ni veille, liaison affichée d'emblée.

### Réglage « Animations » par compte (2026-10-30)
**Constat** : sur le poste de l'utilisateur, Windows « Effets d'animation » est désactivé → le navigateur annonce `prefers-reduced-motion: reduce` → toutes les animations étaient coupées. **Ajout** : Paramètres → Apparence → Animations (Système / Activées / Réduites), enregistré dans le compte (`/api/preferences`, champ facultatif `mouvement`, valeur inconnue → 422, un client sans ce champ ne l'efface pas). Résolu en `<html data-mouvement="normal|reduit">` (src/apparence.js `resoudreMouvement`, posé avant React par public/theme-initial.js et suivi en direct par src/theme.js). Les 11 blocs `@media (prefers-reduced-motion)` d'index.css et les variantes Tailwind `motion-reduce:`/`motion-safe:` (`@custom-variant`) lisent désormais cet attribut ; les animations en JS (présence, tracé progressif, volets des limites) passent par `mouvementReduit()`. Défaut inchangé : « Système ».
**Tests exécutés** : `check:theme` 13/13 (dont résolution et absence de media query résiduelle), préférences API (enregistrement, refus, conservation, reconnexion), `npm run build` PASS (176). Navigateur, poste émulé « moins d'animation » : aide affichée sous « Système », « Activées » → `data-mouvement=normal`, ondes radar animées (0,83→3,38×), préférence retrouvée après rechargement.

### Radar branché sur « Calculer » (Filtrer par route) — 2026-10-30
**Pourquoi rien ne s'animait** : (1) le radar précédent n'observait que les conflits ENREGISTRÉS par le serveur après une écriture ; « Calculer » est un calcul local (`handleCalculerFiltreRoute`) qui n'enregistre rien — il était explicitement exclu ; (2) ce calcul était une double boucle synchrone : aucun rendu possible pendant qu'il tournait ; (3) la fenêtre restait ouverte sur un voile noir à 75 % flouté, qui masquait la carte ; (4) Windows « Effets d'animation » coupé sur le poste (réglé par Paramètres → Animations).
**Correction** : la boucle est déplacée À L'IDENTIQUE dans `src/calculConflitsRoute.js` (preuve : `check:analyse-route`, résultats identiques à la boucle d'origine en haversine et par le graphe réel), découpée en tranches de 16 ms avec progression RÉELLE (paires examinées / total). `lancerAnalyseRoute` (GendarmerieMap) : un seul calcul à la fois, try/catch/finally, interruption au démontage ; la fenêtre se ferme au clic et Calculer reste désactivé (« Calcul en cours… ») jusqu'à la fin. `RadarAnalyse.jsx` : cercles concentriques, secteur 360°, faisceau, lueur, « Analyse des conflits en cours… » + progression (sur la partie visible de la carte). Résultats : impulsion radar + liaison le long du tracé calculé pour CHAQUE conflit (`RadarConflits`), cadrage sur les conflits (et non plus sur le premier : `cadrer: false`), `CarteResultatAnalyse.jsx` « X conflits détectés » (liste dépliable, clic → cadrage exact + panneau des conflits) ; zéro → « No Conflict Detected / Aucun conflit détecté dans la zone analysée. » (coche verte) ; échec → « Échec de l'analyse des conflits » + message + Réessayer, jamais « aucun conflit ». Durée d'affichage minimale du balayage : 1,2 s (résultats déjà calculés, rien de simulé). Carte de résultat à gauche : la carte est bornée au Maroc (maxBounds, viscosité 1) — en vue nationale elle ne peut pas se décaler, la gauche (Atlantique) reste libre.
**Inchangé** : la règle de calcul (toute paire de l'axe ≤ seuil ; graphe s'il est chargé, sinon haversine ; NI faction NI créneau — comme avant), aucun enregistrement en base, rôles et permissions.
**Tests exécutés** : `check:analyse-route` 6/6 ; `npm run build` PASS (182). Navigateur (build de production, serveur réel) — A : RN1 ≤ 20 km → radar à 58 ms, progression réelle (≈ 500/666 à 2,6 s, graphe chargé), bouton désactivé pendant le calcul, 12 conflits = calcul Node par le graphe (12), 12/12 repères dégagés, clic C-R3 → centré à 0 px + panneau ouvert, 33 img/s après résultats ; B : RN25 ≤ 5 km → « No Conflict Detected », 0 repère ; C : panne injectée par l'épreuve (Math.asin, haversine de routage.js) → radar arrêté, « Échec de l'analyse », Calculer de nouveau actif.

### Session perdue → retour à la connexion (2026-10-30)
**Constat** : « Connexion requise : identifiez-vous pour écrire. » — le serveur du port 8090 avait été relancé à 11:04:14 ; les sessions vivent en mémoire (serveur/session.mjs), la page restait « connectée » mais chaque écriture recevait un 401. **Correction** : `api.js` signale tout 401 hors connexion (`gr-session-perdue`) ; `App.jsx` revient à l'écran de connexion ; `Login.jsx` affiche pourquoi (serveur redémarré ou session expirée après 8 h). Rien côté serveur. **Testé** (navigateur, build de production) : connexion → redémarrage du serveur → choix d'une palette → écran de connexion avec l'avis. `npm run build` PASS (182).

### Radar de tous les calculs (couleurs du thème) + dessin des routes réelles des conflits (2026-10-30)
**Radar unique** : `src/radarCalcul.js` (`avecRadar(libellé, calcul)` + `useRadarCalcul`) — branché sur les calculs RÉELS : filtration par distance (`API.optimiserParDistance`, couvre « Calculer (X km) », « Lancer la filtration » des onglets, « Refaire le calcul »), filtration automatique (`analyserOptimisationAuto`), filtration et conflits d'une route, itinéraire, mesure des écarts (OptimisationRoutePanel) ; l'analyse des conflits d'un axe garde son cycle (progression réelle). `RadarAnalyse.jsx` simplifié (petit scanner, cercles + faisceau, plus de voile ni de faisceau traversant) ; `RadarCompact.jsx` dans les fenêtres de parcours (`Parcours.jsx`), qui masquent la carte. Couleurs : jetons du thème uniquement (`--primary`, `--bg-panel`, `--tone-ok`, `--tone-warn`, nouveau `--gr-conflit`). Affichage minimal 600 ms (les résultats ne sont pas retardés).
**Routes** : l'analyse d'un axe charge le graphe routier avant le calcul (chargeur partagé `chargerGrapheRoutier`, une seule requête) ; `traceRoutiere` marque une vraie route. `RadarConflits.jsx` dessine la route réelle (stroke-dashoffset sur la géométrie exacte), l'une après l'autre (délais), le repère pulse quand SA route est dessinée ; clic = rejeu de cette seule route ; sans graphe : aucune droite, « sans tracé routier ». Conflits détectés par le serveur : route calculée sur le graphe (affichage seulement). Correctifs trouvés en test : react-leaflet applique `pathOptions` après l'ajout (Leaflet ne lit `className` qu'à la création) → classes posées à l'ajout ; un tracé n'est plus recréé à la fin de l'impulsion ; `GardeErreur` se rétablit quand ses données changent (`cle`).
**Tests exécutés** : `check:analyse-route` 7/7 ; `npm run build` PASS (183). Navigateur (build de production, serveur réel) : 1 filtration par distance → radar dans la fenêtre « Analyse en cours… Filtration par distance · 20 km » le temps du calcul, aucun conflit créé ; 2 analyse d'axe → radar + progression ; 3 thème : radar #38bdf8 (Midnight sombre) puis #047857 (Forest clair) ; 4 RR407 : route réelle 28 sommets dessinée 100→0, repère après ; 5 RN1 : 12 routes en séquence, toutes dessinées à la fin ; 6 RN25 ≤ 5 km : NO CONFLICT DETECTED ; 7 panne injectée (Math.asin, graphe bloqué) : erreur, jamais « no conflict » ; 8 rejeu C-R3 : sa seule route 100→0, 12 routes, aucun doublon ; 9 graphe bloqué : 13 conflits, aucune route dessinée, « sans tracé routier » ×13 ; animations réduites : route entière d'emblée, sans ondes.

### Dessin lent des routes, « Voir sur la carte » animé avec distances, navigation géographique (2026-10-30)
**Dessin** : `src/animationTrace.js` (partagé) — tracé SVG progressif sur la géométrie exacte (stroke-dashoffset, pathLength 100), point lumineux qui suit la route (SVG animateMotion + mpath, même courbe), lueur douce (couleur du trait + accent du thème), durée selon la longueur réelle (`dureeDessin` : 3,5–6,5 s, ~5 s pour 17 km), route entière à la fin, pas de boucle ; nettoyage du point quand la couche est retirée. Séquence de l'analyse d'un axe : durées réelles, réduites proportionnellement au-delà de ~30 s (min 1,8 s).
**« Voir sur la carte »** : `components/map/RouteAnimee.jsx` (renderer SVG dédié — la carte est en canvas) remplace les polylignes canvas de `ConflitAssigneLayer` ; caméra native `flyToBounds` (1,1 s, marges du panneau) ; le graphe routier est attendu ; routes avant / déplacement / après dessinées l'une après l'autre ; étiquette de distance = distance du moteur d'itinéraire pour CETTE route (sinon mesurée sur sa géométrie), affichée une fois la route dessinée, placée à des fractions différentes et décalée en cas de contact ; clic = rejeu de cette route ; sans route : pointillé « à vol d'oiseau · tracé routier indisponible ». La route du radar est masquée pendant la vue (pas de doublon). Correctifs : la valeur inventée `25.0 km` (après) est supprimée ; poste déplacé = poste B → A/B échangés (la route « avant » allait du poste à lui-même) ; segments de longueur nulle ignorés.
**Navigation** : `components/command-center/NavigationGeographique.jsx` — Région → Compagnie → Brigade en cascade sur les contours réels (circo_reg/cie/bt ; l'application n'a pas de découpage provinces/communes), portée du compte respectée, « Vue Maroc », « Recentrer » ; bouton globe « Vue d'ensemble du Maroc » dans les commandes ; cadrages `flyTo`/`flyToBounds` (immédiats en animations réduites) ; fil d'Ariane inchangé (cliquable). Molette / pavé tactile : `zoomSnap 0.25`, `zoomDelta 0.5`, `wheelPxPerZoomLevel 120` ; boutons +/− : un niveau entier ; affichage du zoom à une décimale.
**Tests exécutés** : `check:trace` 7/7 (longueur, point le long de la route, durées) ; `npm run build` PASS (184). Navigateur (build de production, serveur réel) : 1 dessin RR407 ≈ 5,4 s, point mobile puis éteint, route conservée ; 2–3 « Voir sur la carte » : caméra 12,3 → 12,8, route 29 sommets dessinée en ~5 s, étiquette « 17.0 km par la route » (= distance du conflit) après le dessin, rejeu sans doublon, route radar masquée ; 4 C-04 (déplacement) : avant 20,2 km → déplacement 52,6 km → après 42,9 km, en séquence, 0 chevauchement d'étiquettes ; 5–6 Agadir (28 régions) → 6 compagnies → 6 brigades, fil d'Ariane suivi et cliquable, Vue Maroc → zoom 6 ; 7 molette −60 px → +0,25, −120 px → +0,5, glisser déplace la carte, double-clic +0,5, appui-glisser sur une commande ne déplace pas la carte ; 8 thème : trait #EF4444 / étiquette sombre (Midnight sombre) → #DC2626 / étiquette blanche (Arctic clair) ; 9 analyse RN25, désactivation du filtre, fenêtre Filtration : inchangés.

### Refonte du suivi-traitement des conflits — workflow unique, 5 sections (2026-11-02)
**Causes trouvées** : la détection recalculait l'état des conflits existants (conflits perdus ou mal classés) ; aucune table de transitions (une assignation réinitialisait tout) ; `visiblesPour` trop large (Région/CIE voyaient les non-assignés de leur périmètre) ; cibles d'assignation approximatives + repli « premier CMD Région » (fuite inter-régions) ; transmission sans vérifier que la CIE appartient à la région ; notifications diffusées au périmètre du poste et fusionnées (pertes), sans dédoublonnage ; compteurs partagés serveur/client ; `/cmnd-cie` exposait les comptes d'autres régions ; distance « 25.0 km » inventée ; suppression possible par Région/CIE dans leur périmètre (perte d'historique).
**Correction** : `serveur/workflowConflits.mjs` seule source de vérité (états NEW … CLOSED, libellés FR, sections, table d'actions rôle × état, `verifierAction` 401/403/404/409/422, `peutVoir`, `peutSupprimer`, `presenterWorkflow`, `compterSections`, champs hérités dérivés, migration réversible). `suiviConflits.mjs` : toute transition passe par `appliquer` (historique jamais effacé), notifications `publierConflit` à clé unique, détection qui ne touche plus l'état. `api.mjs` : contrôles serveur sur chaque route, `POST /api/conflits/:id/action`, compteurs par section, suppression Super Admin seul et jamais d'un conflit soumis/validé/en suivi/clos. Panneau : onglets Les Conflits / À traiter / À valider / Suivi / Historique avec compteurs du serveur, filtres (recherche, région, compagnie, état, dates), actions selon `workflow.actions`, historique chronologique, Supprimer affiché seulement si permis.
**Migration** : `node scripts/migrer-workflow-conflits.mjs --donnees <dossier> [--ecrire|--annuler|--restaurer]` (essai à blanc par défaut, sauvegarde avant écriture) — NON appliquée aux données réelles ; le serveur dérive l'état des conflits non migrés.
**Tests exécutés** : `check:workflow-conflits` 9/9 ; `verifier-workflow-conflits-api` 70/70 (serveur réel : chemins A et B, rejet/resoumission, validation, clôture, isolation inter-régions/compagnies, 409 état périmé, notifications sans doublon, compteurs = listes, suppression 403/409) ; `check:radar:api` 21/21 ; `check:radar` 11/11 ; `check:traitement-conflits` 5/5 ; suppression 4/4 ; `check:securite` 174 sûrs, 0 faiblesse ; `npm run build` PASS (181). Navigateur (build de production) : onglets, compteurs et actions par rôle, « Commencer », saisie du motif de rejet, « Valider » → Suivi + Clôturer, filtres.
