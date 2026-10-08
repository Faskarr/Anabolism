@echo off
REM Sauvegarde complete de la base Firestore Anabolism
cd /d "%~dp0"
node backup.mjs
if "%1"=="" pause
