@echo off
rem Double-cliquez sur ce fichier pour ouvrir la carte du Maroc hors ligne.
rem La premiere fois seulement, une connexion est necessaire pour installer
rem les dependances et telecharger les donnees.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est requis : https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules\ (
  echo Installation des dependances...
  call npm install || goto erreur
)
set DONNEES_OK=1
if not exist donnees\tiles\maroc.pmtiles set DONNEES_OK=0
if not exist donnees\data\reseau-national.bin set DONNEES_OK=0
if not exist donnees\data\recherche.json set DONNEES_OK=0
if "%DONNEES_OK%"=="0" (
  echo Preparation des donnees de la carte...
  call npm run data || goto erreur
)
if not exist donnees\gendarmerie\rapport.json (
  echo Import des couches de la Gendarmerie Royale...
  call npm run gendarmerie || echo Couches Gendarmerie non importees : la carte s'ouvrira sans elles.
)
if not exist dist\index.html (
  call npm run build || goto erreur
)

node serveur.mjs
goto :eof

:erreur
echo.
echo Une erreur est survenue, voir les messages ci-dessus.
pause
exit /b 1
