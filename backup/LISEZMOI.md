# Sauvegarde AnabolicOS

## Depuis l'iPhone (le plus simple)

App › Admin › **Sauvegarder la base** › **Enregistrer dans Fichiers**.
Le fichier `anabolicos-AAAA-MM-JJ_HHMM.json.gz` contient toute la base. La ligne
indique la date de la dernière sauvegarde faite depuis l'appareil.
Pour le restaurer : copie-le depuis Fichiers (iCloud Drive) vers
`backup/sauvegardes/` sur le PC, puis utilise `restore.mjs` (voir plus bas).

## Depuis le PC

Exporte **toute** la base Firestore (comptes, entraînements, messages, amis…) dans
`backup/sauvegardes/AAAA-MM-JJ_HHMM.json.gz`. Les 20 dernières sont conservées.
Lecture seule : la sauvegarde ne modifie jamais la base.

## Installation (une seule fois)

1. Installer Node.js LTS : https://nodejs.org
2. Dans ce dossier : `npm install`
3. Console Firebase › ⚙ Paramètres du projet › **Comptes de service** ›
   **Générer une nouvelle clé privée** → enregistrer le fichier ici sous le nom
   `service-account.json`.
   ⚠ Cette clé donne un accès total à la base : ne jamais la partager ni la committer
   (elle est déjà exclue par `.gitignore`).

## Sauvegarder

Double-clic sur `sauvegarder.bat` (ou `node backup.mjs`).

### Automatique chaque semaine (dimanche 20h)

Dans une invite de commandes :

```
schtasks /create /tn "AnabolicOS sauvegarde" /sc weekly /d SUN /st 20:00 /tr "\"C:\Users\Julien\Desktop\Anabolic\backup\sauvegarder.bat\" auto"
```

Supprimer la tâche : `schtasks /delete /tn "AnabolicOS sauvegarde" /f`
(Le PC doit être allumé à l'heure prévue.)

## Restaurer

```
node restore.mjs                                   liste les sauvegardes
node restore.mjs 2026-10-07_2000.json.gz           APERÇU (n'écrit rien)
node restore.mjs 2026-10-07_2000.json.gz --user UID              aperçu d'un seul compte
node restore.mjs 2026-10-07_2000.json.gz --user UID --confirmer  restaure ce compte
node restore.mjs 2026-10-07_2000.json.gz --confirmer             restaure TOUTE la base
```

- Rien n'est écrit sans `--confirmer`.
- Les documents sauvegardés remplacent les versions actuelles ; ceux créés après la
  sauvegarde ne sont pas supprimés.
- L'UID d'un compte : panneau admin › fiche de l'utilisateur, c'est la fin de l'adresse (`#/admin/user/<UID>`), ou Console Firebase › Authentication.
