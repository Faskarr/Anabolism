# AnabolicOS

PWA de suivi musculation : entraînement, diet, protocole, poids — avec espace administrateur et messagerie.

- **Production** : https://anabolic-adc6a.web.app
- **Stack** : HTML/CSS/JS natifs (modules ES, sans build) · Firebase Auth (Google) · Cloud Firestore · Firebase Hosting
- **Plan** : Spark (gratuit)

## Structure

```
firebase.json            Config Hosting (cache, en-têtes de sécurité) + Firestore
.firebaserc              Projet Firebase lié (anabolic-adc6a)
firestore.rules          Règles de sécurité — déployées avec `firebase deploy`
public/
  index.html             App utilisateur
  sw.js                  Service worker (cache + hors ligne) — liste APP_SHELL
  css/tokens.css         Identité (couleurs, typo, espacements) — seule source des valeurs
  css/components.css     Primitives (boutons, cartes, badges…)
  css/app.css            Écrans
  js/app.js              Session → store → routeur (#/home, #/training, …)
  js/firebase.js         Init Firebase (seul point d'accès au SDK)
  js/auth.js             Session, profil users/{uid}, rôle admin, statut
  js/store.js            État temps réel (onSnapshot) + sélecteurs
  js/data/repo.js        TOUTES les écritures (optimistes, par profil, avec annulation)
  js/data/importer.js    Application d'un import (fusion, ids sans collision)
  js/lib/dom.js          h() : création d'éléments SANS innerHTML (anti-XSS)
  js/lib/dates.js        Dates locales + formats FR
  js/lib/schema.js       Validation import/export v3 → v4
  js/ui/                 Composants : sheet, toast, icons, tabbar, chart, timer, layout
  js/views/              Écrans : home, training, diet, protocol, weight, me, share, foundation (diagnostic)
docs/ARCHITECTURE.md     Audit, architecture cible, plan
docs/DEPLOIEMENT.md      Tutoriel GitHub + Firebase
```

## Workflow

```powershell
firebase emulators:start --only hosting   # test local → http://localhost:5000
git add .
git commit -m "Description de la modification"
git push origin main
firebase deploy
```

## Règles de code

1. **Jamais de `innerHTML`** avec des données : utiliser `h()` de `js/lib/dom.js`.
2. **Jamais de `toISOString()` pour une date du jour** : utiliser `localISODate()`.
3. Les vues n'écrivent jamais dans Firestore : elles passent par `data/repo.js` (exception : l'écran Diagnostic).
4. Ajouter tout nouveau fichier de `public/` à la liste `APP_SHELL` de `sw.js` et incrémenter `VERSION`.
5. Aucun secret dans le dépôt.
