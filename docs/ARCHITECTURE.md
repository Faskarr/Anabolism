# AnabolicOS — Audit, architecture cible et plan de refonte

> Étapes 1 à 3 du cahier des charges. **Aucune ligne de code n'a été modifiée.**
> Source analysée : `Ancien/index.html` (2 327 lignes, ~113 Ko) + `Ancien/manifest.json`.

---

## 0. Alerte avant tout

1. **Le fichier de consignes que tu m'as envoyé contient une clé secrète** (ligne 6 : `sk-2a2f…58b4fc`). Si c'est une vraie clé d'API (OpenAI, Anthropic, Stripe…), **révoque-la maintenant** dans la console du service concerné et génère-en une nouvelle. Elle ne doit jamais aller dans un dépôt Git ni dans le code front.
2. **Changement de projet Firebase = les comptes et données actuels ne suivent pas automatiquement.** Avant de basculer, exporte tes données depuis l'ancienne app (voir §7, Phase 0). Attention : l'export actuel n'exporte que le **profil actif** de chaque catégorie → il faut exporter chaque profil un par un.

---

## 1. Ce qui existe réellement

### 1.1 Stack

| Élément | Constat |
|---|---|
| Framework | **Aucun.** HTML + CSS + JavaScript vanilla, un seul fichier. Pas de build, pas de `package.json`. |
| Firebase | SDK **10.12.0** chargé depuis `gstatic.com` (ES modules CDN). Auth + Firestore uniquement. **Pas** de Storage, Functions, Messaging. |
| Projet Firebase | `anabolicos-cc61c` |
| Auth | Google uniquement, `signInWithPopup` + persistance `indexedDBLocalPersistence` (fallback `browserLocalPersistence`). |
| Hébergement | GitHub Pages (`start_url: /Programme-musculation/`). Aucun `firebase.json`, aucun fichier de règles dans le dossier. |
| PWA | `manifest.json` présent, **pas de service worker** (pas d'offline, pas de cache). |
| Polices | Google Fonts : Bebas Neue, DM Sans, JetBrains Mono. |
| Dépendances | Firebase (CDN) + Google Fonts. C'est tout. |

### 1.2 Architecture du code

Deux blocs `<script>` :

- **Module Firebase** (`type="module"`) : init, auth, `loadData()`, écoute temps réel de la semaine, expose `window.FB` (`signIn`, `signOut`, `save`, `saveWeek`, `saveWeights`).
- **Script classique** : état global `window.D`, routeur `window.App` (`goLogin` / `goHome` / `goInner(section)`), rendu de chaque section par concaténation de chaînes HTML + `innerHTML`, ~10 modales bottom-sheet, minuteur de repos.

Le pont `window.D` / `window.App` est le correctif des écrans noirs dus au scope des modules — il fonctionne mais tout est global et couplé.

### 1.3 Pages / écrans

| Écran | Contenu |
|---|---|
| `pgLogin` | Logo, bouton Google, note mode standalone |
| `pgHome` | Salutation, avatar, compteur de séances (2 fois), grille 4 cartes (Programme, Diet, Protocole, Poids) + bouton Import/Export |
| `pgInner` | Conteneur générique : en-tête + barre de profils (chips) + onglets séances (Programme seulement) + corps |

### 1.4 Modèle de données Firestore actuel

```
users/{uid}/
  data/
    workouts   { [profileId]: { sessions: [ { id, name, exercises: [ {id, n, s, r, no} ] } ] } }
    diet       { [profileId]: { objective, macros:{p,g,l}, meals: [ {id, name, foods:[{id,name,qty,cal,p?,g?,l?}]} ] } }
    protocol   { [profileId]: { days: [ {id, name, label, injections:[{id,name,type,time}]} ] } }
    profiles   { workout|diet|protocol: { active, list:[{id,name}] } }
    weights    { log: [ {date:'YYYY-MM-DD', kg} ] }
    exlogs     { logs: { [exerciseId]: [ {ts, d, w, r} ] } }
    counter    { base }
  weeks/{YYYYMMDD}   { [pid_sess_sid]: {done, ts}, [pid_injId]: {done} }   ← cases cochées de la semaine
```

**Il n'existe aucun document `users/{uid}` racine** : impossible aujourd'hui de lister les utilisateurs (l'API de listing Auth n'est accessible que côté serveur).

### 1.5 Fonctionnalités présentes

- **Programme** : profils multiples, séances dynamiques, exercices (nom, séries×reps, repos, note), cocher la séance de la semaine, minuteur de repos (presets + lecture du repos de l'exercice), **carnet de charges** par exercice (historique, 1RM Epley, Δ, graphique SVG).
- **Diet** : profils, objectif calorique, objectifs macros, repas → aliments (kcal + macros optionnelles), barres de progression.
- **Protocole** : profils, jours libres (« Lundi », label), injections (produit, type/fréquence, moment), cochage hebdo, stats, réinitialisation de semaine.
- **Poids** : saisie quotidienne (1 valeur/jour), stats actuel/delta/min/max, courbe 30 derniers points, historique.
- **Compteur de séances** : base manuelle + séances cochées de la semaine courante.
- **Import/Export** : JSON v3 (`{v:'3', at, workouts, diet, protocol, weights, counterBase, exlogs}`) copié/partagé en texte ; l'import crée un nouveau profil par catégorie.

### 1.6 Ce qui est demandé mais n'existe pas

- **Rapports** : aucune fonctionnalité de rapport dans le code.
- **Photos** : aucune.
- **Planning par jour** : les séances et jours de protocole **ne sont pas liés à un jour de la semaine** (le « Lundi » du protocole est un simple texte). → Les widgets « Séance du jour » et « Protocole du jour » nécessitent un **nouveau champ** (voir §4.3).
- La page `partage.html` (partage par code court) n'est **pas** dans ce dossier. Si elle existe dans ton ancien dépôt, envoie-la-moi pour que je préserve sa compatibilité.

---

## 2. Problèmes identifiés

### 2.1 Sécurité — à corriger impérativement

| # | Gravité | Problème | Conséquence concrète |
|---|---|---|---|
| S1 | **Critique** | **XSS stockée** : toutes les données (noms d'exercices, aliments, repas, injections, séances…) sont injectées via `innerHTML` sans échappement. | Un programme importé avec un nom d'exercice `<img src=x onerror="…">` exécute du code dans ton app. **Avec l'espace admin, ça devient une prise de contrôle** : un utilisateur malveillant met un script dans sa diet → tu ouvres sa fiche → le script s'exécute avec *tes* droits admin (lecture de tous les utilisateurs). |
| S2 | Haute | Règles Firestore **non versionnées** (absentes du projet). Impossible de vérifier ce qui est réellement en production. | Si les règles sont encore en « mode test » (`allow read, write: if true` avec date), toutes les données sont publiques. |
| S3 | Moyenne | `photoURL` Google injecté dans `innerHTML`. | Faible risque (URL Google), mais même classe de bug que S1. |
| S4 | Moyenne | Import sans validation de schéma ni de taille. | JSON piégé, document > 1 Mio qui casse la sauvegarde, champs inattendus persistés. |
| S5 | Info | La clé `apiKey` Firebase dans le front est **normale** (ce n'est pas un secret), mais elle doit être **restreinte par référent HTTP** dans Google Cloud Console, et les domaines autorisés d'Auth limités aux tiens. |

### 2.2 Bugs fonctionnels

| # | Problème | Effet |
|---|---|---|
| B1 | Dates enregistrées avec `new Date().toISOString().slice(0,10)` = **date UTC**. | En France, un poids ou une charge saisis entre 00h et 02h (01h l'hiver) sont enregistrés **la veille**. `weekKey()` utilise l'heure locale → incohérence entre les deux. |
| B2 | Import du poids : `saveWeights(data.weights)` **remplace** tout l'historique. | Importer le programme d'un ami avec « Poids » coché (coché par défaut !) **écrase ton historique de poids** par le sien. Idem compteur. |
| B3 | Carnet de charges indexé par **id d'exercice**, et l'import conserve les ids. | Importer deux fois le même programme → les deux profils partagent le même carnet. Importer un programme avec carnet → ses charges se mélangent aux tiennes. |
| B4 | Sauvegarde par **réécriture complète** du document (`setDoc` sur tout `workouts`, tout `diet`…). | Deux appareils ouverts = le dernier qui sauvegarde écrase l'autre (seule la semaine est en temps réel). |
| B5 | `await setDoc()` attend la confirmation serveur avant de fermer la modale ; les erreurs sont avalées (`console.warn`). | **Hors ligne (salle de sport en sous-sol)** : la modale reste ouverte indéfiniment ; en cas d'erreur, l'utilisateur croit que c'est sauvegardé. |
| B6 | Minuteur basé sur `setInterval` décrémental. | Quand iOS met la PWA en arrière-plan, le minuteur se fige → temps faux au retour. Il faut calculer à partir d'un timestamp de fin. |
| B7 | « Réinitialiser la semaine » ne réinitialise que ce qui est **affiché dans le DOM**. | Les séances cochées (onglet Programme) ne sont pas réinitialisées depuis l'onglet Protocole. |
| B8 | Suppression d'un profil : ne nettoie ni le carnet de charges ni les cases de la semaine. | Données orphelines qui s'accumulent. |
| B9 | « vs hier » compare à **l'entrée précédente**, pas à hier. | Libellé trompeur. |
| B10 | `manifest.json` : icônes via `via.placeholder.com` (service fermé) et `start_url` spécifique GitHub Pages ; pas d'`apple-touch-icon`. | Icône absente/générique sur l'écran d'accueil iPhone ; `start_url` cassée sur un autre hébergeur. |

### 2.3 Performance / robustesse

- Firestore en cache mémoire uniquement → rechargement à froid à chaque ouverture, aucun offline. **Correctif gratuit** : `persistentLocalCache` (IndexedDB) → ouverture instantanée et écritures hors ligne mises en file.
- Pas de service worker → rien n'est mis en cache, l'app ne s'ouvre pas sans réseau.
- Re-rendu complet de chaque section via `innerHTML` + ré-attachement de tous les écouteurs à chaque action.
- `exlogs` dans **un seul document** : croissance illimitée (~150 Ko/an pour un usage intensif) → OK plusieurs années, mais plafond dur de 1 Mio par document Firestore.
- 3 familles Google Fonts bloquantes au chargement.

### 2.4 UX / UI / accessibilité

- Thème sombre « gaming », 7 couleurs vives → contraire à la direction voulue.
- Textes de **8–9 px** (illisibles sur iPhone, sous le minimum de 11 px d'Apple). Contraste du gris `#6B6B80` sur `#0A0A0F` ≈ 3,9:1 (< 4,5:1 requis).
- Renommer un profil = **appui long** non signalé (fonction invisible).
- `alert()` / `confirm()` natifs (aspect non premium, bloquants).
- Icônes = emojis sans `aria-label` ; boutons `✕` sans libellé accessible.
- Compteur de séances affiché deux fois sur la home.
- Suppressions sans confirmation (aliment, poids) mais confirmation sur d'autres → incohérent ; aucun « Annuler » (undo).
- Pas d'états de chargement : l'écran s'affiche vide puis se remplit.

### 2.5 Ce qui est bon et sera conservé

- Le **modèle fonctionnel** (profils par catégorie, séances dynamiques, carnet de charges + 1RM, macros, cochage hebdo).
- Le **schéma JSON v3** d'import/export → conservé et étendu de façon rétro-compatible.
- Les **chemins Firestore** `users/{uid}/data/*` et `users/{uid}/weeks/*` → conservés tels quels (migration = simple import).
- Auth Google popup + persistance IndexedDB (fonctionne en PWA iOS).
- Les bonnes intentions mobile déjà présentes : safe-area, bottom sheets, `inputmode` numériques, zones tactiles ≥ 44 px sur la plupart des boutons.

---

## 3. Contraintes qui pilotent l'architecture

1. **100 % gratuit** (plan Spark, pas de carte bancaire). Conséquences directes :
   - **Pas de Cloud Functions** → pas de custom claims, pas d'Admin SDK, pas d'envoi de push serveur.
   - **Pas de Cloud Storage** sur un nouveau projet (depuis fin 2024, un bucket par défaut exige le plan Blaze — à revérifier dans ta console au moment de la création).
   - Quotas Firestore Spark (ordre de grandeur, à vérifier dans la console) : ~50 000 lectures / 20 000 écritures par jour, 1 Gio stocké. Largement suffisant pour quelques dizaines d'utilisateurs.
2. **Usage iPhone uniquement** (PWA ajoutée à l'écran d'accueil). Le desktop doit rester correct mais n'est pas prioritaire.
3. **Workflow ultra simple** : `git add / commit / push` puis `firebase deploy`. → **Pas d'étape de build** : je recommande de rester en JavaScript natif découpé en **modules ES** servis tels quels. Aucun `npm run build`, aucun risque de déployer un dossier obsolète.

> **Pourquoi pas React/Vite ?** Ça ajouterait une étape de build, des dépendances à maintenir et une courbe d'apprentissage, sans gain réel pour une app de cette taille. Des modules ES bien découpés + un petit utilitaire DOM sécurisé donnent la même maintenabilité.

---

## 4. Architecture cible

### 4.1 Arborescence du nouveau dépôt

```
anabolicos/
├── firebase.json              # config Hosting + Firestore
├── .firebaserc                # id du projet Firebase
├── firestore.rules            # règles de sécurité VERSIONNÉES
├── firestore.indexes.json
├── .gitignore
├── README.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── DEPLOIEMENT.md
└── public/                    # ← tout ce qui est en ligne
    ├── index.html             # app utilisateur
    ├── admin.html             # espace admin (même domaine, layout dédié)
    ├── manifest.webmanifest
    ├── sw.js                  # service worker (cache app shell)
    ├── icons/                 # 180, 192, 512, maskable
    ├── css/
    │   ├── tokens.css         # couleurs, typo, espacements, rayons, ombres, durées
    │   ├── base.css
    │   └── components.css
    └── js/
        ├── firebase.js        # init unique (Auth + Firestore persistant)
        ├── auth.js            # login, bootstrap users/{uid}, statut, rôle admin
        ├── store.js           # état central + abonnements (remplace window.D)
        ├── router.js          # navigation par hash (#/home, #/training…)
        ├── lib/
        │   ├── dom.js         # h() : création d'éléments SANS innerHTML → anti-XSS
        │   ├── dates.js       # dates LOCALES (corrige B1), clés de semaine
        │   ├── schema.js      # validation import/export v3 + v4
        │   └── format.js
        ├── data/              # 1 module par domaine, seuls à parler à Firestore
        │   ├── users.js  workouts.js  diet.js  protocol.js
        │   ├── weights.js  exlogs.js  weeks.js
        │   ├── messages.js  inbox.js
        ├── ui/
        │   ├── sheet.js       # bottom sheet (remplace les 10 modales dupliquées)
        │   ├── confirm.js  toast.js (avec « Annuler »)
        │   ├── tabbar.js  pull-reveal.js (geste de la home)
        │   └── chart.js       # 1 composant SVG pour poids + 1RM (remplace 2 copies)
        ├── views/
        │   ├── home.js  training.js  diet.js  protocol.js
        │   ├── weight.js  contact.js  share.js  me.js
        └── admin/
            ├── dashboard.js  users.js  user-detail.js  messages.js
```

### 4.2 Modèle Firestore cible

Les chemins existants sont conservés ; les ajouts sont en **gras**.

```
**admins/{uid}**                         ← créé À LA MAIN dans la console, jamais par l'app
     { createdAt }

**users/{uid}**                          ← créé au 1er login
     { displayName, email, photoURL,
       createdAt, lastActiveAt,         ← mis à jour 1×/jour max (économie d'écritures)
       status: 'active' | 'disabled',   ← modifiable par l'admin uniquement
       lastWeight, lastWeightAt }       ← dénormalisé pour la liste admin (évite N lectures)

users/{uid}/data/{workouts|diet|protocol|profiles|weights|exlogs|counter}   (inchangé)
users/{uid}/weeks/{YYYYMMDD}                                                 (inchangé)

**users/{uid}/inbox/{itemId}**           ← envois de l'admin
     { type: 'workout'|'diet'|'protocol'|'note',
       title, message, payload (format v4), sentAt,
       status: 'pending'|'accepted'|'dismissed', handledAt }

**users/{uid}/photos/{photoId}**         ← OPTIONNEL (voir §6)
     { img (JPEG base64 ≤ ~500 Ko), takenAt, sharedWithAdmin: bool }

**conversations/{uid}**                  ← 1 conversation par utilisateur (un seul admin)
     { userName, lastText, lastFrom: 'user'|'admin', lastAt,
       userReadAt, adminReadAt, status: 'open'|'done' }
**conversations/{uid}/messages/{msgId}**
     { from: 'user'|'admin', text (≤ 2000 car.), at }
```

**Calcul des non-lus sans compteur falsifiable** : non lu pour l'admin si `lastFrom == 'user' && lastAt > adminReadAt` (et symétriquement pour l'utilisateur). Pas de compteur à incrémenter → rien qu'un client puisse fausser.

### 4.3 Extensions de schéma (rétro-compatibles)

- `session.weekdays?: number[]` (1 = lundi … 7 = dimanche) → alimente « Séance du jour ».
- `protocolDay.weekdays?: number[]` → alimente « Protocole du jour ». Les jours existants sans ce champ s'affichent toujours dans le planning ; un assistant proposera de les rattacher (ex. jour nommé « Lundi » → `[1]` automatiquement).
- Export **v4** = v3 + ces champs optionnels + `kind` (`workout`/`diet`/`protocol`/`full`). Un fichier v3 s'importe toujours ; un v4 lu par l'ancienne app ignore simplement les nouveaux champs.
- Import : **ré-génère les ids** d'exercices (corrige B3), **fusionne** le poids par date au lieu de remplacer (corrige B2), case « Poids » et « Compteur » **décochées par défaut**, validation de schéma et taille max.

### 4.4 Rôles et permissions (sans Cloud Functions)

| Besoin | Solution gratuite |
|---|---|
| Distinguer admin / utilisateur | Document `admins/{tonUid}` créé manuellement. Les règles testent `exists(/admins/$(request.auth.uid))`. **Aucun client ne peut écrire dans `admins`.** |
| Lister les utilisateurs | Collection `users` (créée au login) lisible par l'admin uniquement. |
| Désactiver un compte | `users/{uid}.status = 'disabled'` (admin seul). Les règles refusent alors toute lecture/écriture des données de l'utilisateur ; l'app affiche « Compte désactivé — contacte l'administrateur ». **Aucune donnée supprimée.** Réactivation = repasser à `active`. *(Limite assumée : le compte Google reste authentifiable, mais n'accède plus à rien.)* |
| Envoyer un programme/diet/protocole | L'admin écrit dans `users/{uid}/inbox`. L'utilisateur reçoit une carte « Nouveau programme de ton coach » → **Accepter** (crée un nouveau profil via la même logique que l'import) ou **Ignorer**. L'utilisateur garde la maîtrise de ses données actives. |
| Modifier directement un contenu | L'admin a le droit d'écriture sur `data/workouts|diet|protocol|profiles` (pas sur poids, carnet, semaines). Utilisé depuis la fiche utilisateur. |
| Voir les photos | Lecture admin autorisée **seulement si** `sharedWithAdmin == true` sur la photo. |

### 4.5 Brouillon des règles Firestore

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn()      { return request.auth != null; }
    function isOwner(uid)    { return signedIn() && request.auth.uid == uid; }
    function isAdmin()       { return signedIn()
                                 && exists(/databases/$(database)/documents/admins/$(request.auth.uid)); }
    function isActive(uid)   { return get(/databases/$(database)/documents/users/$(uid)).data.status == 'active'; }
    function ownerActive(uid){ return isOwner(uid) && isActive(uid); }
    function onlyChanges(keys){ return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys); }

    match /admins/{uid} {
      allow read: if isOwner(uid);          // l'app sait si TU es admin
      allow write: if false;                // console Firebase uniquement
    }

    match /users/{uid} {
      allow read: if isOwner(uid) || isAdmin();
      allow create: if isOwner(uid)
        && request.resource.data.status == 'active'
        && request.resource.data.email == request.auth.token.email;
      allow update: if (isOwner(uid) && resource.data.status == 'active'
                        && onlyChanges(['displayName','photoURL','lastActiveAt','lastWeight','lastWeightAt']))
                    || (isAdmin() && onlyChanges(['status','adminNote']));
      allow delete: if false;

      match /data/{docId} {
        allow read:  if ownerActive(uid) || isAdmin();
        allow write: if ownerActive(uid)
                     || (isAdmin() && docId in ['workouts','diet','protocol','profiles']);
      }
      match /weeks/{wk} {
        allow read:  if ownerActive(uid) || isAdmin();
        allow write: if ownerActive(uid);
      }
      match /inbox/{itemId} {
        allow read: if ownerActive(uid) || isAdmin();
        allow create, delete: if isAdmin();
        allow update: if ownerActive(uid) && onlyChanges(['status','handledAt']);
      }
      match /photos/{pid} {
        allow read: if isOwner(uid) || (isAdmin() && resource.data.sharedWithAdmin == true);
        allow create, update: if ownerActive(uid) && request.resource.data.img.size() < 700000;
        allow delete: if isOwner(uid);
      }
    }

    match /conversations/{uid} {
      allow read: if isOwner(uid) || isAdmin();
      allow create, update: if (ownerActive(uid) && request.resource.data.lastFrom == 'user'
                                && request.resource.data.status == 'open')
                            || isAdmin();
      match /messages/{mid} {
        allow read: if isOwner(uid) || isAdmin();
        allow create: if request.resource.data.text is string
          && request.resource.data.text.size() > 0
          && request.resource.data.text.size() <= 2000
          && request.resource.data.at == request.time
          && ( (ownerActive(uid) && request.resource.data.from == 'user')
            || (isAdmin()        && request.resource.data.from == 'admin') );
        allow update, delete: if false;     // historique immuable
      }
    }
  }
}
```

Ces règles seront **testées avec l'émulateur Firebase** (utilisateur A ne lit pas B, utilisateur désactivé bloqué, non-admin refusé sur `/admins`, `/users` et l'inbox des autres, message usurpant `from:'admin'` refusé…).

### 4.6 Messagerie

- Temps réel via `onSnapshot` sur `conversations/{uid}/messages` (limité aux 50 derniers, pagination au scroll vers le haut).
- Côté utilisateur : onglet **Contact** (badge non-lu sur l'onglet « Moi » + widget sur la home).
- Côté admin : liste triée par `lastAt`, filtres *Non lus / À traiter / Traités*, recherche par nom, bouton « Marquer comme traité ».
- **Notifications — correction d'une hypothèse** : les notifications push *sont* possibles sur iPhone pour une PWA ajoutée à l'écran d'accueil (iOS 16.4+). Mais il faut un serveur pour les envoyer (Cloud Functions → plan payant). En gratuit : **badge sur l'icône de l'app** (`navigator.setAppBadge`, iOS 16.4+) mis à jour quand l'app est ouverte + badges internes. Évolutif plus tard si tu passes en Blaze.

---

## 5. Architecture UX/UI

### 5.1 Navigation

```
                ┌──────────────────────────────┐
                │           ACCUEIL            │
                │  Logo · widgets du jour      │
                │  ↓ tirer vers le bas = menu  │
                └──────────────┬───────────────┘
                               │
  Barre d'onglets permanente (5 grandes zones tactiles, safe-area) :

  [ Accueil ] [ Entraînement ] [ Diet ] [ Protocole ] [ Moi • ]
                                                        │
                                   Poids & suivi · Contact • · Partage (import/export)
                                   · Mes envois du coach · Profil & réglages
                                   · Espace admin (visible si admin)
```

**Pourquoi** : les 4 actions quotidiennes ont un accès direct en 1 tap. Le poids est saisi directement depuis le widget de la home (champ rapide), donc il n'a pas besoin d'un onglet. Le geste « tirer vers le bas » devient **le raccourci premium**, mais la navigation **ne dépend jamais** de lui (exigence d'accessibilité du §7 du cahier des charges).

### 5.2 Le geste de la home (pull-to-reveal)

Comportement :
1. Actif seulement quand la home est scrollée tout en haut (`scrollTop === 0`) → ne gêne jamais le scroll normal.
2. Pendant le geste (0 → 140 px), le logo grossit (`scale` 1 → 1,6), les widgets reculent (`scale` 1 → 0,94, `opacity` → 0,4), avec résistance progressive façon iOS (`déplacement = d × 0,55` puis amortissement).
3. Au-delà du seuil au relâchement : le logo s'agrandit plein écran et s'efface (≈ 380 ms, courbe ressort), puis la grille de navigation plein écran apparaît en cascade. En deçà : retour élastique.
4. Retour haptique léger au franchissement du seuil quand disponible.

Technique (performance) :
- `pointer events` + `requestAnimationFrame`, **uniquement `transform` et `opacity`** (animations sur le GPU, 60/120 fps sur iPhone ProMotion).
- `overscroll-behavior: none` + `touch-action: pan-x` sur la zone pour neutraliser le rebond iOS pendant le geste.
- `prefers-reduced-motion` → simple fondu.
- **Découvrabilité** : petit chevron animé + libellé « Tirer pour explorer » sous le logo les 3 premières ouvertures, puis masqué ; un bouton « Menu » reste toujours accessible au clavier/VoiceOver.

### 5.3 Widgets de la home

| Widget | Contenu | Action |
|---|---|---|
| **Séance du jour** | Nom de la séance prévue aujourd'hui (via `weekdays`), nb d'exercices, état (faite ✓ / à faire). Jour de repos → message dédié. | Tap → ouvre la séance directement. |
| **Protocole du jour** | Liste des prises prévues aujourd'hui avec case à cocher inline. | « Voir le planning » → Protocole. |
| **Poids** | Poids actuel en grand, tendance 7 jours (mini-courbe), écart. | Champ de saisie rapide « + Pesée du jour ». |
| **Macros** | Anneau calories + 3 barres P/G/L (objectifs du profil diet actif). | Tap → Diet. |
| **Message** (si non lu) | Aperçu de la réponse du coach. | Tap → Contact. |
| **Envoi du coach** (si en attente) | « Nouveau programme reçu ». | Accepter / voir. |

### 5.4 Identité visuelle — proposition

Direction : **« vestiaire de luxe »** — blanc cassé chaud, gris minéraux, encre presque noire, et **un seul accent bordeaux** réservé à l'action principale et aux états importants. Pas de dégradés, pas de néons : de la matière, de l'espace, une typographie forte.

| Jeton | Valeur | Usage |
|---|---|---|
| `--paper` | `#F7F6F3` | Fond de l'app |
| `--card` | `#FFFFFF` | Cartes |
| `--mist` | `#EDECE8` | Fonds secondaires, champs |
| `--line` | `#E2E0DB` | Séparateurs (hairlines 0,5 px sur écran Retina) |
| `--stone` | `#8C8A85` | Texte secondaire (contraste ≥ 4,5:1 sur blanc à vérifier/ajuster) |
| `--ink` | `#151515` | Texte, chiffres, boutons secondaires |
| `--bordeaux` | `#6E1F2C` | Accent unique : CTA, séance faite, non-lus |
| `--bordeaux-tint` | `#F3E9EA` | Fond des états actifs |

Typographie (2 familles, chargées en `font-display: swap`) :
- **Chiffres et titres** : une grotesque condensée à fort caractère (ex. *Archivo* en largeur condensée, ou *Barlow Condensed*) — garde l'ADN « performance » de Bebas Neue mais en plus raffiné et lisible.
- **Texte** : *Inter* ou la police système iOS (`-apple-system`, SF Pro) → rendu natif parfait, zéro téléchargement. **Je recommande SF Pro système** pour le texte : c'est ce qui donnera le plus l'impression d'app native.
- Taille minimale **12 px**, corps 15–17 px, chiffres clés 40–64 px.

Composants : cartes à grand rayon (20 px), ombres très douces en couches, bottom sheets avec poignée et fermeture par glissement, toasts avec « Annuler » (remplace les `confirm()`), squelettes de chargement, états vides illustrés sobrement, icônes SVG au trait (plus d'emojis).

Je te propose de **valider l'identité sur une maquette visuelle** (home + séance + admin) avant d'implémenter.

### 5.5 Espace administrateur (`admin.html`)

Layout différent : en-tête compact, densité d'information plus élevée, listes plutôt que cartes.

- **Dashboard** : total utilisateurs (requête d'agrégation `count()` = 1 lecture), actifs sur 7 jours, nouveaux sur 30 jours, conversations non lues, comptes désactivés.
- **Utilisateurs** : liste avec avatar, nom, poids actuel, dernière activité, pastille message non lu ; recherche instantanée (côté client) ; filtres *Actifs / Inactifs 14 j+ / Désactivés / Messages non lus*.
- **Fiche utilisateur** — onglets : Vue d'ensemble · Poids · Entraînements (+ carnet) · Diet · Protocoles · Messages · (Photos partagées). Actions : *Envoyer un programme / diet / protocole* (depuis tes propres profils ou un JSON), *Envoyer une note*, *Modifier*, *Désactiver / Réactiver* (avec confirmation).
- Toutes les données utilisateur y sont rendues **sans innerHTML** (cf. S1) — c'est non négociable dès qu'un admin lit des données saisies par d'autres.

---

## 6. Décisions que je te laisse trancher

1. **Photos** — tu avais retiré les photos pour rester gratuit. Option gratuite viable : compression côté téléphone (JPEG ~1080 px, ~200–400 Ko) stockée en base64 dans Firestore, partage opt-in par photo. Limite : quelques centaines de photos au total sur le quota 1 Gio. → *Inclure en phase optionnelle, ou laisser de côté ?*
2. **Rapports** — n'existent pas. Proposition gratuite : un **bilan hebdo généré à l'ouverture** (séances faites, adhérence protocole, évolution du poids, PR du carnet), visible par l'utilisateur et par toi. → *Oui / non ?*
3. **Nom de domaine** — Firebase Hosting donne gratuitement `ton-projet.web.app`. Je recommande d'utiliser ce domaine **aussi comme `authDomain`** : la connexion Google se fait alors sur le même domaine que l'app, ce qui évite les soucis de cookies tiers de Safari en mode PWA.
4. **`partage.html`** (partage par code court) — à conserver ? Si oui, envoie-le-moi.

---

## 7. Plan de travail

| Phase | Contenu | Vérification |
|---|---|---|
| **0. Préparation** | Révoquer la clé `sk-…`. Exporter **chaque profil** depuis l'ancienne app (JSON v3). Créer dépôt GitHub + projet Firebase + premier déploiement « Hello » (cf. `02_DEPLOIEMENT.md`). | URL `.web.app` en ligne, connexion Google OK sur iPhone. |
| **1. Fondations** | Arborescence, `firebase.js` (cache persistant), `auth.js` (création `users/{uid}`, statut, rôle), `lib/dom.js` anti-XSS, `lib/dates.js`, design tokens, manifest + icônes + service worker, règles v1 + tests émulateur. | Tests de règles verts ; app installable avec la bonne icône. |
| **2. Portage iso-fonctionnel** | Entraînement (+ carnet, minuteur corrigé), Diet, Protocole, Poids, Partage v3/v4, avec le nouveau design, états loading/empty/error, toasts + annuler. Correction B1–B9. | Import de tes exports v3 → données identiques à l'ancienne app. |
| **3. Accueil & navigation** | Widgets, champ `weekdays`, tab bar, geste pull-to-reveal, menu plein écran. | Test sur iPhone réel (SE / standard / Pro Max), 60 fps. |
| **4. Contact** | Messagerie utilisateur + badges + `setAppBadge`. | Échange bidirectionnel entre 2 comptes de test. |
| **5. Admin** | Dashboard, liste, fiche (onglets), inbox d'envoi, désactivation/réactivation. | Compte non-admin bloqué partout ; compte désactivé bloqué ; données intactes. |
| **6. Optionnel** | Photos partagées, bilan hebdo. | — |
| **7. Recette** | Checklist complète du §15 du cahier des charges (auth, permissions, admin, messagerie, import/export, mobile, desktop, animations, erreurs). | Rapport de tests. |

Chaque phase = un ou plusieurs commits atomiques, déployables séparément, avec la doc `docs/ARCHITECTURE.md` tenue à jour.
