@echo off
REM Liste les sauvegardes puis affiche un APERCU (rien n est ecrit sans --confirmer)
cd /d "%~dp0"
node restore.mjs %*
pause
