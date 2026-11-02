# NEXT_STEPS — Resume Checklist

## Current Status: Completed & Verified ✅
- Overhaul of Barrage Filtering, Conflict Management & Conflict Assignment: Verified.
- All stored conflicts in database and cache purged across all environments.
- Route-based filtering + distance threshold + calculation: Implemented and verified.
- Automatic detection and pre-selection of the interested Region Command (`CMND_REGION`): Implemented and verified.
- Direct Traitement with automatic map centering: Implemented and verified.
- Interactive road displacement and post-move resolution banner: Implemented and verified.
- Strict FIXE INTOUCHABLE protection (faction change disabled; Move or Delete for regular barrage): Implemented and verified.
- **Génération de données synthétiques réalistes pour les barrages fixes (`FIXED` & `FIXED_PERMANENT`) : Implémenté et validé (8/8 tests réussis, palette et clustering 100% conformes).**

- **Refonte UI/UX type Mapbox (thèmes clair/sombre, étiquettes territoriales sans chevauchement, mode focus) : implémentée et validée — voir TASK_PROGRESS.md.**

---

## Resume Checklist for Next Actions

### 0a. Workflow des conflits — décisions et contrôles restants
- [ ] Décider si un traitement de CMD CIE doit attendre la validation finale AVANT d'être appliqué au barrage (aujourd'hui : appliqué immédiatement, comme avant ; un refus ne l'annule pas).
- [ ] Appliquer la migration aux données de production si elles contiennent des conflits (`npm run conflits:migrer-workflow -- --donnees donnees-production` puis `--ecrire`).
- [ ] Recette manuelle sur le service de démonstration avec de vrais comptes CMD CIE / Région / Superadmin.

### 0. Refonte UI — contrôles manuels restants
- [ ] Sur le service de démonstration (`npm run serve:demo`) : cliquer une région, vérifier le contour à l'accent du thème et l'étiquette soulignée.
- [ ] Parcourir les modales (traiter / assigner un conflit, comparatif avant-après) en thème clair.
- [ ] Corriger la forme de `situation` du fournisseur FICTIF (écran blanc à la sélection d'une région en `npm run dev`).


### 1. Verification in Browser (Manual QA)
- [ ] Connect as `CMD Région Nador` (or Super Admin).
- [ ] In the side panel, click **`Traiter`** on an assigned conflict (e.g. `C-01` Selouane ↔ Zaïou) :
  - [ ] Verify that the map immediately centers on the conflict, zooms in, and draws the route between the two barrages.
  - [ ] Verify that `ModalTraiterConflit` opens, showing Barrage A and Barrage B.
  - [ ] If one barrage is `FIXE INTOUCHABLE`:
    - [ ] Verify that `Changer faction` is completely blocked.
    - [ ] Verify that the intouchable barrage is locked (`🔒 Intouchable`).
    - [ ] Verify that for the regular barrage, you can choose `⚡ Déplacer` or `🗑 Supprimer`.
  - [ ] Click `⚡ Déplacer directement sur la carte` :
    - [ ] Click a new spot along the route.
    - [ ] Confirm the displacement.
    - [ ] Verify the floating banner appears: `✓ Barrage repositionné ! Voulez-vous marquer ce conflit comme Traité / Résolu ?`
    - [ ] Click `✓ Marquer comme Résolu (Done)`.
    - [ ] Verify the conflict is marked as **Résolu** in the side panel and database for both the Region and Super Admin.

### 2. Verification des Barrages Synthétiques (Simulation UX/UI)
- [ ] Lancer la carte en mode démo (`npm run serve:demo` ou `npm run dev`).
- [ ] Vérifier la présence des nouveaux barrages synthétiques positionnés sur les routes (`Autoroute`, `Route Nationale`, `Route Régionale`, `Route Provinciale`).
- [ ] Cliquer sur un barrage cyan avec le badge « Fixe » (`FIXED`) :
  - [ ] Vérifier l'apparition de la fiche détaillée avec le badge ambré `⚠️ Données synthétiques (Simulation UX/UI)`.
  - [ ] Vérifier les informations : nom, route concernée, référence routière, nombre d'accidents (avec période 2025-2026), éclairage, circulation et coordonnées.
- [ ] Cliquer sur un barrage teal avec le badge « Permanent / Intouchable » (`FIXED_PERMANENT`) :
  - [ ] Vérifier le badge « Permanent / Intouchable ».
  - [ ] Vérifier que les actions de déplacement ou suppression sont bloquées pour les utilisateurs non superadmin.
- [ ] Tester la régénération via le script :
  ```bash
  npm run barrages:synthetiques:demo
  ```
  - [ ] Vérifier que le nombre total de barrages réels préexistants (914) est conservé et que les synthétiques sont remplacés sans doublon.

### 2. Standard Protocol for Future Tasks (Permanent Project Rule)
Whenever starting a new task:
- [ ] Read `PROJECT_MAP.md` (and `maroc-carte-offline/PROJECT_MAP.md`).
- [ ] Check `TASK_PROGRESS.md`, `WALKTHROUGH.md`, and `NEXT_STEPS.md`.
- [ ] Update `TASK_PROGRESS.md` with new requirements before modifying code.
- [ ] Implement one milestone at a time, update progress files, and run tests.
- [ ] Verify tests pass (`npm run prebuild`, `npm test` or specific verification scripts).
