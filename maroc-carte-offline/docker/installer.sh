#!/bin/sh
# Installe la carte sur un serveur Linux sans internet (Docker et Docker Compose requis).
# Usage : sh installer.sh   (depuis ce dossier)
set -eu
cd "$(dirname "$0")"

echo "1/3  Vérification de l'intégrité des fichiers…"
sha256sum -c SHA256SUMS

echo "2/3  Chargement de l'image Docker (≈ 1 minute)…"
docker load -i "__ARCHIVE__"

echo "3/3  Démarrage de la carte…"
docker compose up -d

echo
ADRESSE=$(hostname -I 2>/dev/null | cut -d' ' -f1 || true)
echo "Carte démarrée : http://${ADRESSE:-localhost}:5555"
echo "Arrêter : docker compose down    Journal : docker compose logs -f"
