# Installe la carte sur un poste Windows sans internet (Docker Desktop requis, démarré).
# Usage : clic droit > « Exécuter avec PowerShell », ou : powershell -ExecutionPolicy Bypass -File installer.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host "1/3  Vérification de l'intégrité des fichiers…"
foreach ($ligne in Get-Content -LiteralPath 'SHA256SUMS') {
  $attendu, $fichier = $ligne -split '\s+', 2
  $reel = (Get-FileHash -LiteralPath $fichier -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($reel -ne $attendu) { throw "Fichier altéré ou incomplet : $fichier" }
  Write-Host "  $fichier : OK"
}

Write-Host "2/3  Chargement de l'image Docker (≈ 1 minute)…"
docker load -i '__ARCHIVE__'
if ($LASTEXITCODE -ne 0) { throw 'Chargement de l’image impossible : Docker Desktop est-il démarré ?' }

Write-Host '3/3  Démarrage de la carte…'
docker compose up -d
if ($LASTEXITCODE -ne 0) { throw 'Démarrage impossible (voir le message ci-dessus).' }

Write-Host ''
Write-Host 'Carte démarrée : http://localhost:5555 (depuis les autres postes : http://<adresse-de-ce-poste>:5555)'
Write-Host 'Arrêter : docker compose down    Journal : docker compose logs -f'
