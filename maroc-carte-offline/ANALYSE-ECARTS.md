# Phase 0 — Analyse d'écarts : `maroc-carte-offline` ↔ « Carte tactique Gendarmerie »

Date : 2026-10-19. Base : lecture du code de `maroc-carte-offline` (`src/`, `serveur/`, `scripts/`),
de `PROJECT_MAP.md` et du projet de référence `Projet Map`. Suite de tests au départ :
`npm test` → **225 tests, 225 réussis**.

> `PROJECT_MAP.md` se contredit : §3.1 (« pas d'API ») et §6 (« aucune authentification ») sont
> périmés ; §7.23–7.24 et le code (`serveur/api.mjs`, `serveur/auth.mjs`) montrent une API avec
> comptes, sessions, rôles, workflow de conflits et journal. À corriger en phase 1.

## 1. Pile du projet cible

| Couche | Cible (existant) | Référence |
|---|---|---|
| Front | JS vanilla (modules ES), DOM natif, CSS custom properties, RTL | React 19 + Tailwind 4 |
| Carte | **MapLibre GL 6 + PMTiles** (fond vectoriel hors ligne, polices et sprites locaux) | Leaflet / react-leaflet + serveur de tuiles interne |
| Calcul | Web Workers (recherche, couverture, itinéraire, optimisation) | thread principal en grande partie |
| Serveur | `node:http` sans dépendance (`serveur.mjs` + `serveur/`) | `node:http` sans dépendance (routeur de 6,6 k lignes) |
| Stockage | JSON dans `etat/` (écriture atomique temp + rename, verrou mono-écrivain), `journal.jsonl` append-only | JSON/JSONL |
| Auth | scrypt, sessions mémoire 2 h inactivité / 12 h absolu, cookie HttpOnly SameSite=Strict, CSRF `X-Requested-With`, verrouillage 5 échecs / 10 min par **compte + IP** | PBKDF2, sessions 8 h |
| Tests | `node --test` (225) dont tests HTTP réels ; aucun lint, aucun E2E navigateur | nombreux scripts `check:*` |
| Déploiement | Lanceur Windows, `npm start`, bundle Docker air-gapped + SHA256SUMS | paquet intranet |
| Git | **pas de dépôt** (`.gitignore` présent, pas de `.git/`) | — |

**Décision d'architecture recommandée : garder la pile cible.** MapLibre + PMTiles couvre déjà 3.13 et
répond mieux à l'exigence « hors ligne d'abord » que Leaflet + serveur de tuiles. On porte les
*règles et fonctionnalités*, pas React/Leaflet.

## 2. Matrice d'écarts (✅ existe · 🟡 partiel · ❌ absent)

### 3.1 Fondation carte
| Élément | État | Constat |
|---|---|---|
| Fond hors ligne | ✅ | PMTiles + MapLibre ; serveur XYZ/WMS interne configurable ❌ (non requis si PMTiles) |
| Badge « fond hors ligne » + Réessayer | ❌ | `diagnostic-rendu.js` ne traite que le rendu logiciel |
| Limites par échelon selon zoom (<7 / 7–8 / ≥9) | ✅ | `gendarmerie-style.js` ; fondu 200 ms entrant seul : à vérifier |
| Carte verrouillée au périmètre | 🟡 | région uniquement (comptes `commandement`) ; pas de zoom mini par rang, pas de contour doré pointillé |
| Brume | ✅ | voile de sélection testé |
| Disposition « centre de commandement » | 🟡 | rail gauche + fil d'Ariane existent ; pas de carte de synthèse, barre basse, légende déplaçable, échelle UI |
| Portée `{niveau, unite}` pilotant comptages/défauts | 🟡 | filtres REG/CIE/BT dans le panneau barrages, pas de portée globale |
| Catalogue de couches | 🟡 | circos, QG, infrastructures ✅ ; routes issues des tuiles (mieux) ; « BT à moins de 5 km », pôles de population ❌ |
| Clustering barrages par échelon | ✅ | REG/CIE/individuel, jamais deux unités mélangées |
| Recherche | ✅ | worker, normalisation FR/AR (supérieure à la référence) ; barrages non indexés |
| Statistiques de carte | ❌ | |

### 3.2 Authentification et sécurité
| Élément | État | Constat |
|---|---|---|
| Connexion identifiant + mot de passe | ✅ | connexion `rang + unité + code` ❌ |
| Hachage | 🟡 | scrypt (aussi robuste que PBKDF2-210k) — voir décision D3 |
| Codes générés `XXXX-XXXX-XXXX` affichés une fois | ❌ | mots de passe temporaires saisis par l'admin |
| Politique de mot de passe | 🟡 | longueur ≥ 10 seulement ; liste noire, classes, caractères distincts ❌ |
| Changement forcé | ✅ | répond 403 `{changer:true}` (référence : 428) |
| Sessions persistantes | ❌ | en mémoire : un redémarrage déconnecte tout le monde |
| Verrouillage compte + IP | ✅ | 10 min (référence 15 min) ; `Retry-After` à vérifier |
| En-têtes (CSP, X-Frame-Options, Referrer-Policy) | ❌ | `nosniff` + `no-store` sur l'API uniquement |
| Modèle rang × rôle (admin/reg/cie/unite × lecture/saisie/commandement) | ❌ | seulement `superadmin` et `commandement` régional |
| Panneau + CLI comptes | ✅ | `comptes-ui.js`, `scripts/comptes.mjs` |
| Journal d'audit avant/après + diff par champ | 🟡 | append-only ✅ ; diff par champ et lecture limitée au périmètre ❌ |
| Sauvegarde quotidienne, rotation 30 j | ❌ | |

### 3.3 Marquages et cycle de vie — **écart le plus important**
| Élément | État | Constat |
|---|---|---|
| Modèle | 🟡 | barrages `{id, name, type: fixe\|intouchable, latitude, longitude, btId, shift, isSimulation, route}` ; pas de `barrage_mobile`, `barrage_vip`, `accident`, `zahma` |
| Stockage partagé côté serveur | ❌ | éditions **locales au navigateur** (surcouche `localStorage` + export de fichier) |
| Rattachement bt/cie/reg par point-dans-polygone | ✅ | client et serveur (`referentiel.mjs`) |
| Saisie de coordonnées (décimal, virgule, DMS, paire collée) | 🟡 | analyse de coordonnées présente dans la recherche, pas branchée à la création |
| Statuts `statutBarrage`, `decisionOptimisation`, suppression douce | 🟡 | retrait doux + restauration ✅ (local) ; statuts ❌ |
| Workflow de demandes (instructions) | 🟡 | workflow de *conflits* (assigner → proposition → décision) ✅ ; demandes création/modification/suppression ❌ |
| Points noirs, génération de barrages, score d'exposition | ❌ | aucune donnée d'accident |
| Actions par lot, vue 3D, import JSON | ❌ | export ✅ |

### 3.4 Factions, effectifs, relève
| Élément | État | Constat |
|---|---|---|
| Filtre de faction avec comptes | ✅ | mais **horloge du navigateur** (`factionDeLHeure`), pas celle du serveur |
| Règle de trois, grades, éléments, effectifs, relève, analyse de situation | ❌ | aucune donnée de personnel |

### 3.5 Réseau routier
| Élément | État | Constat |
|---|---|---|
| Graphe hors ligne, A\*, worker | ✅ | tuiles locales + réseau national binaire |
| Sens uniques | ❌ | limite documentée |
| Distance routière côté serveur | ❌ | le serveur contrôle seulement la plausibilité (≥ vol d'oiseau − 300 m) |
| Accrochage | 🟡 | ≤ 150 m (référence ≤ 30 km pour la génération) ; affichage de l'écart ✅ |
| PK | ❌ | |
| Itinéraire multi-jalons, rapide/court, durée, détour | 🟡 | mesure routière + tournée ✅ ; carnet de route, alternative, ventilation par classe ❌ |
| Validation sur distances de référence (±3 %) | ❌ | aucun test |

### 3.6 Alertes et conflits
| Élément | État | Constat |
|---|---|---|
| Alertes de distance par la route | 🟡 | calculées **côté client** à la demande, seuil `<=` (référence : `<` strict) ; pas stockées, pas d'acquittement |
| Conflits de planification (patrouilles) | ❌ | pas de patrouilles |

### 3.7 / 3.8 Optimisation
| Élément | État | Constat |
|---|---|---|
| Mesure plus proche voisin par la route, même faction, intouchables = toutes factions | ✅ | `proximite.js` (client) |
| Protections accidents / VIP / non éclairé / portes de ville | ❌ | champs absents ; seul `intouchable` protège |
| Décisions conserver / déplacer / supprimer | 🟡 | étude de déplacement validée par la route ✅ ; simulation serveur, route d'activation re-validante ❌ |
| Mode automatique (cascade) | ❌ | |
| Numérotation C-01, fiche conflit, instantané « avant simulation », historique des rapports | 🟡 | annulation locale ✅ ; le reste ❌ |
| Assistant IA (n8n / Ollama) | ❌ | |
| Onglets Distance · Accidents · VIP · Éclairage + dialogues | ❌ | dialogue « Optimiser » à un champ existe (`opt-dialogue`) |
| Carte de chaleur d'aptitude, dédoublonnage | ✅ | n'existent pas dans la référence (à conserver) |

### 3.9 – 3.11 Analyse, organisation, modes
| Élément | État | Constat |
|---|---|---|
| Couverture opérationnelle, zones d'intervention, impression carte | ✅ | |
| Synthèse, efficacité, qualité de données, comparaison de périodes, rapport imprimable | ❌ | |
| Arbre hiérarchique avec comptages, notifications, missions, règles sauvegardées | ❌ | hiérarchie calculée (`construireHierarchie`) mais pas d'affichage |
| Modes production / démonstration (`mode.json`) | ❌ | |
| Mode FICTIF sans serveur | 🟡 | générateur déterministe de barrages simulés + bandeau ✅ ; fournisseur d'API en navigateur ❌ |

### 3.12 – 3.13 Déploiement et outils hors ligne
| Élément | État | Constat |
|---|---|---|
| Docker air-gapped, lanceur Windows | ✅ | |
| Refus des ressources externes | 🟡 | test « URLs locales » sur le style uniquement |
| Lint, tests de contrat, E2E navigateur | ❌ | |
| Outils 3.13 (PMTiles, recherche, compétence, couverture, bouclage, tournée, mesure, croquis, impression, Lambert) | ✅ | le projet cible **est** le projet frère |

### Améliorations obligatoires (§5)
| # | État |
|---|---|
| 1 VIP partout | à faire (type à créer) |
| 2 permission sur chaque écriture | ✅ sur les routes existantes ; à tenir pour les nouvelles |
| 3 sessions / simulations persistées | ❌ |
| 4 verrouillage compte + IP, Secure | ✅ (HSTS ❌) |
| 5 écrivain atomique unique | 🟡 (`stockage.mjs` sans reprise `EPERM/EACCES/EBUSY`) |
| 6 compression HTTP | ❌ (`recherche.json` 6 Mo, `reseau-national.bin` 12 Mo bruts) |
| 7 découpage du code | ❌ (un bundle ~1,26 Mo) |
| 8 module partagé de constantes | 🟡 (le serveur importe déjà `src/barages.js`, `src/proximite.js`) |
| 9 dépendances inutiles | 🟡 (`xlsx` sert seulement aux scripts → devDependencies) |
| 10 artefacts hors de l'arbre | ❌ `transfert/` (544 Mo) et `dist/` dans le dossier |
| 11 i18n FR/AR, WCAG, 360 px | 🟡 (FR/AR + RTL ✅ ; l'UI d'optimisation est en français seul) |
| 12 contrats typés | ❌ |

## 3. Décisions à prendre avant la phase 1

- **D1 — Pile.** Garder JS vanilla + MapLibre/PMTiles + `node:http` + JSON (recommandé).
- **D2 — Modèle et stockage des marquages.** Créer un magasin serveur `etat/marquages.json` au contrat
  de la référence (§4), alimenté par un import unique de `donnees/barages/barages.json`
  (`fixe` → `barrage_fixe`, `intouchable` → `barrage_fixe` + `protection: 'intouchable'`,
  `shift` → `factionId`/`debut`/`fin`), fichier d'origine intact. Conséquence : l'édition locale au
  navigateur (surcouche `localStorage` + export) est **remplacée** par l'écriture serveur ; les
  éditions locales existantes devront être importées ou abandonnées. *Changement de comportement :
  accord requis.*
- **D3 — Modèle d'authentification.** Étendre à rang × rôle ; migration : `superadmin` →
  `admin/commandement`, `commandement` + `regId` → `reg/commandement`. Garder **scrypt** (changer
  d'algorithme imposerait de réinitialiser les 29 comptes ou de re-hacher à la connexion).
  *Change la sémantique de l'authentification : accord requis.*
- **D4 — Données réelles.** La référence contient 927 marquages (`Projet Map/donnees-*`). Les importer,
  ou rester sur les 1 000 barrages simulés ?
- **D5 — Hygiène.** `git init` + premier commit avant toute modification (fortement recommandé, aucun
  retour arrière possible sinon). Sortir `transfert/` et `dist/` de l'arbre : suppression → accord requis.
- **D6 — Seuil.** Unifier sur `<` strict (référence et spec 3.7) au lieu de `<=` (cible) ; modifie les
  tests existants de `proximite.js`.

## 4. Ampleur

La référence compte ~38 000 lignes de front ; la cible ~20 000. Les phases 3, 4, 6 et 8 créent
l'essentiel du code nouveau (marquages serveur, effectifs, optimisation serveur, panneaux). Chaque
phase sera livrée séparément avec tests, build et rapport, comme demandé au §6.
