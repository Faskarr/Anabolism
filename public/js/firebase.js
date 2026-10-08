/**
 * Initialisation Firebase — point d'entrée UNIQUE vers le SDK.
 * Les autres modules importent `auth` et `db` d'ici, jamais du CDN directement,
 * pour garantir une seule version du SDK dans toute l'app.
 *
 * Note : cette configuration n'est pas secrète (elle identifie le projet).
 * La sécurité des données repose sur firestore.rules.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  initializeAuth, GoogleAuthProvider,
  indexedDBLocalPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Ré-export des SDK : les autres modules importent d'ici (une seule version).
export * as authSdk from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
export * as fs from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBje3KcOzf7aeFzL-kvca5D2lv7WDgtIlM',
  // Domaine de connexion = domaine de l'app (web.app) : la page Google et son iframe
  // sont alors sur le MÊME site que l'app. Safari (iPhone) bloque les échanges entre
  // sites différents → 2 touchers nécessaires et connexion lente avec firebaseapp.com.
  // Prérequis (une fois) : https://anabolic-adc6a.web.app/__/auth/handler ajouté aux
  // « URI de redirection autorisés » du client OAuth dans Google Cloud Console.
  authDomain: /^anabolic-adc6a\.(web\.app|firebaseapp\.com)$/.test(location.hostname)
    ? location.hostname
    : 'anabolic-adc6a.firebaseapp.com',
  projectId: 'anabolic-adc6a',
  storageBucket: 'anabolic-adc6a.firebasestorage.app',
  messagingSenderId: '297929048136',
  appId: '1:297929048136:web:0bba6528cf6525c07bd87d',
};

export const app = initializeApp(firebaseConfig);

/**
 * Auth initialisée SANS « popupRedirectResolver » et SANS `await` :
 *  • getAuth() charge au démarrage l'iframe Google (apis.google.com) pour
 *    vérifier un éventuel retour de redirection → plusieurs centaines de ms
 *    de réseau avant le moindre affichage ; on n'utilise que la popup, dont le
 *    résolveur est passé au moment de la connexion (auth.js) ;
 *  • l'ancien `await setPersistence()` bloquait le chargement de TOUTE l'app
 *    jusqu'à la fin de l'initialisation de l'auth (réseau compris).
 * IndexedDB d'abord (fiable en PWA iOS), localStorage en secours.
 */
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
auth.languageCode = 'fr';

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

/**
 * Cache Firestore persistant (IndexedDB) :
 *  • ouverture quasi instantanée (données servies depuis le cache),
 *  • écritures hors ligne mises en file puis synchronisées au retour du réseau.
 * Gestionnaire « un seul onglet » : pas d'élection d'onglet principal ni de
 * synchronisation inter-onglets au démarrage (inutile pour une PWA, et plus
 * rapide). Un 2e onglet ouvert en même temps bascule seul sur un cache mémoire.
 * Repli sur le cache mémoire si IndexedDB est indisponible (navigation privée).
 */
function createDb() {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({ forceOwnership: false }) }),
      ignoreUndefinedProperties: true, // un champ optionnel vide ne fait pas échouer l'écriture
    });
  } catch (err) {
    console.warn('[firebase] cache persistant indisponible, repli mémoire', err);
    return initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
}
export const db = createDb();
