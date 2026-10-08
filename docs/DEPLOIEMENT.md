# Déployer AnabolicOS avec GitHub + Firebase Hosting (Windows)

Objectif : un workflow en 2 temps, toujours le même.

```powershell
git add .
git commit -m "Description de tes modifications"
git push origin main      # sauvegarde + historique du code sur GitHub
firebase deploy           # mise en ligne sur https://<ton-projet>.web.app
```

> `git push` et `firebase deploy` sont **indépendants** : GitHub conserve ton code, Firebase sert l'app. Pousser sur GitHub ne met rien en ligne ; déployer ne sauvegarde rien sur GitHub. Fais toujours les deux.

Tout ce qui suit est gratuit (plan Firebase **Spark**, aucune carte bancaire).

---

## Partie 1 — Installation (une seule fois sur ton PC)

### 1.1 Node.js
1. Télécharge la version **LTS** sur https://nodejs.org et installe-la (options par défaut).
2. Ouvre **PowerShell** et vérifie :
   ```powershell
   node -v
   npm -v
   ```

### 1.2 Git
1. Installe **Git for Windows** : https://git-scm.com/download/win (options par défaut ; il installe aussi *Git Credential Manager*, qui gèrera la connexion GitHub).
2. Configure ton identité (une fois) :
   ```powershell
   git config --global user.name "Julien"
   git config --global user.email "ton-email-github@exemple.com"
   git config --global init.defaultBranch main
   ```

### 1.3 Firebase CLI
```powershell
npm install -g firebase-tools
firebase --version
firebase login            # ouvre le navigateur → connecte-toi avec ton compte Google
```

**Erreur fréquente** : *« l'exécution de scripts est désactivée sur ce système »* → exécute une fois :
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
puis relance la commande.

---

## Partie 2 — Créer le projet Firebase (une seule fois)

1. https://console.firebase.google.com → **Ajouter un projet** → nom : `anabolicos` (l'identifiant final sera par ex. `anabolicos-a1b2c` — **note-le**). Google Analytics : désactivé (inutile ici).
2. **Ajouter une application Web** (icône `</>`) → nom « AnabolicOS » → **ne coche pas** « Configurer Firebase Hosting » (on le fait en ligne de commande) → copie l'objet `firebaseConfig` affiché : il ira dans `public/js/firebase.js`.
3. **Authentication** → Commencer → onglet *Sign-in method* → **Google** → Activer → choisis ton e-mail d'assistance → Enregistrer.
   Onglet *Paramètres → Domaines autorisés* : `localhost`, `<projet>.firebaseapp.com` et `<projet>.web.app` sont déjà présents. Rien à ajouter.
4. **Firestore Database** → Créer une base de données → **mode production** → emplacement **`eur3 (europe-west)`** ou `europe-west9 (Paris)`.
   ⚠️ L'emplacement est **définitif**.
5. **Sécuriser la clé d'API** (recommandé) : https://console.cloud.google.com → sélectionne le projet → *API et services → Identifiants* → clé « Browser key » → *Restrictions d'application : Sites Web* → ajoute :
   ```
   https://<projet>.web.app/*
   https://<projet>.firebaseapp.com/*
   http://localhost:5000/*
   ```

### 2.1 (Recommandé) Connexion Google sur le même domaine que l'app
Sur iPhone en mode PWA, Safari limite les cookies tiers. Utiliser ton domaine d'hébergement comme domaine d'authentification évite ces soucis :
1. Dans `public/js/firebase.js` : `authDomain: "<projet>.web.app"` (au lieu de `.firebaseapp.com`).
2. Google Cloud Console → *API et services → Identifiants* → client OAuth « Web client (auto created by Google Service) » → *URI de redirection autorisés* → ajoute `https://<projet>.web.app/__/auth/handler` → Enregistrer.

---

## Partie 3 — Créer le dépôt GitHub (une seule fois)

1. https://github.com/new → nom : `anabolicos` → **Private** (recommandé) → **ne coche rien** (pas de README, pas de .gitignore : on les crée localement) → *Create repository*.
2. Garde la page ouverte : elle affiche l'URL du dépôt, du type `https://github.com/<ton-pseudo>/anabolicos.git`.

---

## Partie 4 — Relier le dossier local à GitHub et Firebase (une seule fois)

### 4.1 Créer le dossier du projet
```powershell
cd $HOME\Desktop
mkdir anabolicos
cd anabolicos
```
(Je fournirai le contenu complet de ce dossier lors de la phase 1 ; tu pourras aussi le faire avec un simple `index.html` « Hello » pour tester la chaîne dès maintenant.)

### 4.2 Initialiser Firebase dans le dossier
> **Déjà fait pour ce dépôt** : `firebase.json`, `.firebaserc` et `firestore.rules` sont fournis. Cette section ne sert que pour un nouveau projet.

```powershell
firebase init
```
Réponses :
| Question | Réponse |
|---|---|
| Are you ready to proceed? | `Y` |
| Which features? (Espace pour cocher, Entrée pour valider) | **Firestore** et **Hosting** (pas « App Hosting ») |
| Project Setup | **Use an existing project** → choisis `anabolicos-xxxxx` |
| Firestore rules file | `firestore.rules` (Entrée) |
| Firestore indexes file | `firestore.indexes.json` (Entrée) |
| What do you want to use as your public directory? | `public` |
| Configure as a single-page app? | **No** |
| Set up automatic builds and deploys with GitHub? | **No** (on garde ton workflow manuel) |
| File public/index.html already exists. Overwrite? | **No** |

Cela crée `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`.

### 4.3 Remplacer `firebase.json` par cette version
Elle ajoute les en-têtes de cache (pour que tes mises à jour apparaissent immédiatement sur l'iPhone) et des en-têtes de sécurité :
```json
{
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  },
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true,
    "headers": [
      {
        "source": "**/*.@(html|js|css|webmanifest)",
        "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
      },
      {
        "source": "**/*.@(png|svg|jpg|webp|woff2)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }]
      },
      {
        "source": "**",
        "headers": [
          { "key": "X-Content-Type-Options", "value": "nosniff" },
          { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
          { "key": "X-Frame-Options", "value": "SAMEORIGIN" }
        ]
      }
    ]
  }
}
```
> `no-cache` ne veut pas dire « pas de cache » : le navigateur garde le fichier mais vérifie à chaque ouverture s'il a changé (requête très légère). C'est ce qui évite le classique « j'ai déployé mais l'iPhone affiche l'ancienne version ».

### 4.4 Créer `.gitignore`
Crée un fichier `.gitignore` à la racine avec :
```
node_modules/
.firebase/
firebase-debug.log
firestore-debug.log
ui-debug.log
*.log
.env
.env.*
.DS_Store
Thumbs.db
```
⚠️ Ne mets **jamais** de clé secrète (`sk-…`, mot de passe, compte de service) dans ce dossier. La config `firebaseConfig` du front, elle, n'est pas secrète : c'est normal qu'elle soit dans le code ; la sécurité vient des règles Firestore.

### 4.5 Premier commit et premier push
```powershell
git init
git add .
git commit -m "Initialisation du projet AnabolicOS"
git remote add origin https://github.com/<ton-pseudo>/anabolicos.git
git push -u origin main
```
Au premier push, une fenêtre de connexion GitHub s'ouvre (Git Credential Manager) → autorise. Ensuite, plus jamais.
Le `-u` mémorise la branche : les fois suivantes, `git push origin main` (ou juste `git push`) suffit.

### 4.6 Premier déploiement
```powershell
firebase deploy
```
À la fin :
```
Hosting URL: https://anabolicos-xxxxx.web.app
```
Ouvre cette URL sur ton iPhone dans **Safari** → bouton Partager → **Sur l'écran d'accueil**.

> Si tu avais l'ancienne app sur l'écran d'accueil, c'est une **autre adresse** : supprime l'ancienne icône une fois la migration de tes données terminée.

### 4.7 Te déclarer administrateur (après la phase 1)
1. Connecte-toi une fois à la nouvelle app avec ton compte Google.
2. Console Firebase → **Authentication → Users** → copie ton **UID** (colonne *Identifiant utilisateur*).
3. **Firestore → Démarrer une collection** → ID : `admins` → ID du document : *colle ton UID* → champ `createdAt` (type *timestamp*, maintenant) → Enregistrer.
4. Recharge l'app : l'entrée « Espace admin » apparaît. Personne d'autre ne peut se l'attribuer (les règles interdisent toute écriture dans `admins` depuis l'app).

---

## Partie 5 — Workflow quotidien

### 5.1 Tester en local avant de déployer
```powershell
firebase emulators:start --only hosting
```
→ ouvre http://localhost:5000 dans Chrome. La connexion Google fonctionne (`localhost` est autorisé). Tu travailles sur **les vraies données** de ton projet. `Ctrl + C` pour arrêter.

Astuce : dans Chrome, `F12` → icône téléphone (*Toggle device toolbar*) → choisis « iPhone 14 Pro » pour simuler l'écran.

### 5.2 Tester sur ton iPhone sans toucher à la version en ligne
```powershell
firebase hosting:channel:deploy test --expires 7d
```
→ te donne une URL temporaire (`https://anabolicos-xxxxx--test-abc123.web.app`) à ouvrir sur l'iPhone. La version de production n'est pas touchée.
Si la connexion Google y échoue : *Authentication → Paramètres → Domaines autorisés* → ajoute ce domaine.

### 5.3 Publier
```powershell
git add .
git commit -m "Diet : ajout de la saisie rapide des macros"
git push origin main
firebase deploy
```

Variantes utiles :
```powershell
firebase deploy --only hosting           # seulement le site (le plus courant)
firebase deploy --only firestore:rules   # seulement les règles de sécurité
git status                               # voir ce qui a changé avant de committer
git log --oneline -10                    # 10 derniers commits
```

Bonnes pratiques de message de commit : un message = une modification, au présent, précis. *« Corrige la date UTC du poids »* plutôt que *« fix »*.

### 5.4 Annuler une mauvaise mise en ligne
- **Le plus rapide** : Console Firebase → *Hosting* → tableau *Historique des versions* → sur la version précédente : ⋮ → **Restaurer**. Effet immédiat.
- **Côté code** : `git revert HEAD` (crée un commit qui annule le dernier) → `git push` → `firebase deploy`.

---

## Partie 6 — Problèmes fréquents

| Symptôme | Cause | Solution |
|---|---|---|
| `firebase : le terme n'est pas reconnu` | PowerShell ouvert avant l'installation | Ferme et rouvre PowerShell |
| `l'exécution de scripts est désactivée` | Politique PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `rejected … (fetch first)` au push | Le dépôt GitHub contient un fichier que tu n'as pas (ex. README créé sur le site) | `git pull --rebase origin main` puis `git push` |
| `auth/unauthorized-domain` | Domaine non autorisé | Authentication → Paramètres → Domaines autorisés |
| L'iPhone affiche l'ancienne version | Cache / service worker | Ferme complètement l'app (balayage vers le haut) et rouvre-la ; le service worker de la phase 1 proposera « Nouvelle version disponible » |
| `Missing or insufficient permissions` | Règles Firestore | Vérifie que `firestore.rules` est déployé : `firebase deploy --only firestore:rules` |
| `Error: Failed to get Firebase project` | Mauvais projet lié | `firebase use --add` et choisis le bon |

---

## Option (plus tard) — Déploiement automatique à chaque push

Si un jour tu veux supprimer l'étape `firebase deploy` : `firebase init hosting:github` crée une GitHub Action qui déploie automatiquement à chaque `git push` sur `main`. Gratuit pour un dépôt de cette taille. Je te conseille d'abord de maîtriser le workflow manuel ci-dessus.
