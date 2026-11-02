# Carte opérationnelle hors ligne — installation sur le réseau isolé

Ce dossier contient **tout** ce qu'il faut : l'image Docker de la carte
(application, tuiles du Royaume, couches de la Gendarmerie). Aucune connexion
internet n'est nécessaire sur le réseau de destination.

| Fichier | Rôle |
|---|---|
| `__ARCHIVE__` | image Docker (`__IMAGE__`) |
| `docker-compose.yml` | démarrage du conteneur, port **5555** |
| `installer.sh` / `installer.ps1` | installation en une commande (Linux / Windows) |
| `SHA256SUMS` | empreintes, pour vérifier que la copie est complète |

## Prérequis sur le serveur de destination

- Docker (et Docker Compose, inclus dans Docker Desktop et dans le paquet
  `docker-compose-plugin`), déjà installé : ce dossier ne l'installe pas.
- Processeur __PLATEFORME__ (celui du poste qui a préparé l'image).
- ≈ 1,5 Go d'espace disque ; le port **5555** libre.

## Installer

Copiez ce dossier sur le serveur (clé USB, disque), puis :

- **Linux** : `sh installer.sh`
- **Windows** : clic droit sur `installer.ps1` > « Exécuter avec PowerShell »

Le script vérifie les empreintes, charge l'image et démarre la carte. Elle
redémarre seule après un redémarrage du serveur.

À la main, c'est équivalent à :

```
sha256sum -c SHA256SUMS
docker load -i __ARCHIVE__
docker compose up -d
```

## Comptes (optimisation des barrages)

La carte est fermée sans session : toute adresse renvoie vers la page de connexion. Aucun
compte n'existe au départ. Créez « superadmin » et un compte « cr-<région> » par région du
jeu (mot de passe temporaire demandé, à changer par chacun à sa première connexion) :

    docker exec -it carte-gendarmerie node scripts/comptes.mjs initialiser
    docker exec -it carte-gendarmerie node scripts/comptes.mjs lister
    docker exec -it carte-gendarmerie node scripts/comptes.mjs mot-de-passe cr-rabat   (réinitialisation)

Un compte régional ne voit que sa région (données filtrées par le serveur) ; le superadmin
gère tout, comptes compris (Optimiser → Comptes). Comptes, conflits et journal d'audit sont
dans le volume `carte-etat` (à sauvegarder) ; une mise à jour de l'image ne les efface pas.
Derrière un proxy HTTPS, ajoutez `HTTPS=1` (cookie de session « Secure »).

## Utiliser

Sur n'importe quel poste du réseau : **http://<adresse-du-serveur>:5555**
(navigateur récent : Chrome, Edge ou Firefox). Si un pare-feu protège le
serveur, autorisez le port TCP 5555 en entrée.

| Action | Commande (dans ce dossier) |
|---|---|
| Arrêter | `docker compose down` |
| Redémarrer | `docker compose restart` |
| État | `docker compose ps` (« healthy » quand la carte répond) |
| Journal | `docker compose logs -f` |

Pour utiliser un autre port, remplacez la **première** valeur de
`"5555:5555"` dans `docker-compose.yml` (ex. `"8000:5555"`), puis
`docker compose up -d`.

## Mettre à jour

Une nouvelle version arrive dans un nouveau dossier du même type : lancez son
script d'installation, qui remplace le conteneur. Les anciennes images peuvent
ensuite être supprimées (`docker image ls`, puis `docker image rm <image>`).

## Bon à savoir

- Les **croquis** et les réglages (thème, langue…) sont enregistrés dans le
  navigateur de chaque poste, pas sur le serveur : exportez un croquis
  (GeoJSON ou KML) pour le transmettre à un autre poste.
- Les données de la Gendarmerie sont figées dans l'image, à la date de sa
  préparation (__DATE_DONNEES__). Pour les mettre à jour, préparez une nouvelle
  image sur le poste d'origine.
- Ce dossier contient l'implantation des unités : à transporter et conserver
  selon les règles de diffusion applicables.
