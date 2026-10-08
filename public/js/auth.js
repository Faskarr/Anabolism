/**
 * Session utilisateur : connexion, profil racine users/{uid}, rôle admin, statut.
 *
 * Expose `onSession(cb)` qui notifie un objet unique :
 *   { state: 'loading' | 'signed-out' | 'active' | 'disabled' | 'error',
 *     user, profile, isAdmin, error }
 */
import { auth, db, googleProvider, authSdk, fs } from './firebase.js';

import { T } from './lib/i18n.js';
const { signInWithPopup, signInWithRedirect, getRedirectResult, signOut: fbSignOut, onAuthStateChanged, browserPopupRedirectResolver } = authSdk;
const { doc, getDoc, setDoc, updateDoc, serverTimestamp } = fs;

/** Messages d'erreur Firebase traduits pour l'utilisateur. */
const AUTH_ERRORS = {
  'auth/popup-blocked': 'La fenêtre de connexion a été bloquée. Touche à nouveau « Continuer avec Google ».',
  'auth/network-request-failed': 'Pas de connexion internet. Réessaie dans un instant.',
  'auth/unauthorized-domain': "Ce domaine n'est pas autorisé dans Firebase Authentication.",
  'auth/too-many-requests': 'Trop de tentatives. Patiente quelques minutes.',
};

/**
 * Connexion Google.
 *  • Ordinateur : fenêtre (popup).
 *  • iPhone / iPad / Android : REDIRECTION pleine page. Safari n'ouvre une
 *    fenêtre que si elle est demandée à l'instant même du toucher ; or Firebase
 *    l'ouvre ~100 ms plus tard (préparation de l'adresse) → 1er toucher bloqué,
 *    il fallait toucher deux fois. La redirection n'a pas cette limite : un seul
 *    toucher, puis retour automatique dans l'app une fois connecté.
 *    (Fiable car le domaine de connexion = le domaine de l'app, cf. firebase.js.)
 */
const MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPad récent
const REDIRECT_FLAG = 'authRedirect';

/** Retour de Google en cours de traitement (affiche « Connexion… » au lieu du bouton). */
export function redirectPending() {
  try { return sessionStorage.getItem(REDIRECT_FLAG) === '1'; } catch { return false; }
}

/**
 * Prépare la connexion et traite un éventuel retour de redirection Google.
 * Appelée au démarrage quand aucune session n'est connue sur l'appareil.
 * Renvoie { error } si le retour de Google a échoué (message à afficher).
 */
let warm = null;
let ready = false;
export function warmUpSignIn() {
  warm ||= getRedirectResult(auth, browserPopupRedirectResolver)
    .then(() => ({ error: null }))
    .catch((err) => ({ error: translate(err) }))
    .finally(() => {
      ready = true;
      try { sessionStorage.removeItem(REDIRECT_FLAG); } catch { /* ignoré */ }
    });
  return warm;
}
/** Module Google prêt : un seul toucher suffit. */
export const signInReady = () => ready;

function translate(err) {
  if (!err || err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request'
    || err.code === 'auth/redirect-cancelled-by-user') return null;
  return AUTH_ERRORS[err.code] || T`Connexion impossible (${err.code || err.message}).`;
}

export async function signIn() {
  try {
    if (MOBILE) {
      try { sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch { /* ignoré */ }
      await signInWithRedirect(auth, googleProvider, browserPopupRedirectResolver);
      return;   // la page part vers Google
    }
    await signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
  } catch (err) {
    try { sessionStorage.removeItem(REDIRECT_FLAG); } catch { /* ignoré */ }
    const msg = translate(err);
    if (msg) throw new Error(msg);
  }
}

export function signOut() {
  clearLocalSession();
  // La prochaine connexion s'ouvre sur l'accueil (et non sur l'écran Moi).
  try { history.replaceState(null, '', '/'); } catch { /* ignoré */ }
  return fbSignOut(auth);
}

/** Efface tout ce que l'app garde sur l'appareil pour un démarrage rapide. */
export function clearLocalSession() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === 'lastUid' || k === 'dietCalc' || k.startsWith('session:') || k.startsWith('snap:')) localStorage.removeItem(k);
    }
  } catch { /* stockage indisponible */ }
}

/**
 * Crée users/{uid} au premier login, sinon met à jour lastActiveAt.
 * Les champs envoyés correspondent EXACTEMENT à ce qu'autorisent les règles.
 */
async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const profile = {
      displayName: (user.displayName || '').slice(0, 120),
      email: user.email,
      photoURL: user.photoURL || '',
      createdAt: serverTimestamp(),
      lastActiveAt: serverTimestamp(),
      status: 'active',
    };
    await setDoc(ref, profile);
    return { profile: { ...profile, status: 'active' }, created: true };
  }

  const profile = snap.data();
  // Rafraîchit nom/photo Google et la dernière activité (sans bloquer l'UI),
  // au plus une fois toutes les 6 h (une écriture par ouverture, c'était beaucoup).
  const stampKey = `activeStamp:${user.uid}`;
  let fresh = false;
  try { fresh = Date.now() - Number(localStorage.getItem(stampKey) || 0) < 6 * 3600e3; } catch { /* ignoré */ }
  const changed = (user.displayName && user.displayName !== profile.displayName) || (user.photoURL && user.photoURL !== profile.photoURL);
  if (profile.status === 'active' && (!fresh || changed)) {
    try { localStorage.setItem(stampKey, String(Date.now())); } catch { /* ignoré */ }
    updateDoc(ref, {
      displayName: (user.displayName || profile.displayName || '').slice(0, 120),
      photoURL: user.photoURL || profile.photoURL || '',
      lastActiveAt: serverTimestamp(),
    }).catch((err) => console.warn('[auth] lastActiveAt', err));
  }
  return { profile, created: false };
}

/** Lit admins/{uid}. Renvoie l'erreur au lieu de l'avaler (diagnostic). */
async function checkAdmin(uid) {
  try {
    return { isAdmin: (await getDoc(doc(db, 'admins', uid))).exists(), adminError: null };
  } catch (err) {
    console.warn('[auth] admin check', err);
    return { isAdmin: false, adminError: err.code || err.message };
  }
}

function retryAdmin(user, verified, callback, delays = [1500, 4000, 10000]) {
  if (!delays.length) return;
  setTimeout(async () => {
    if (auth.currentUser?.uid !== user.uid) return;
    const { isAdmin, adminError } = await checkAdmin(user.uid);
    if (adminError) { retryAdmin(user, verified, callback, delays.slice(1)); return; }
    if (isAdmin !== verified.isAdmin) {
      const next = { ...verified, isAdmin, adminError: null };
      writeCachedSession(user.uid, next);
      callback(next);
    }
  }, delays[0]);
}

/**
 * Démarrage rapide : la dernière session vérifiée est gardée sur l'appareil.
 * À l'ouverture, l'app s'affiche tout de suite avec elle, pendant que le profil
 * et le rôle admin sont revérifiés en arrière-plan auprès de Firestore (si le
 * compte a été désactivé entre-temps, l'écran change dès la réponse).
 * La sécurité ne dépend pas de ce cache : les règles Firestore décident.
 */
const SESSION_KEY = (uid) => `session:${uid}`;

/** Pseudo valide : 2 à 30 caractères, sans caractères de contrôle. '' = nom Google. */
export function cleanPseudo(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}

/**
 * Utilisateur vu par l'app : le PSEUDO (s'il y en a un) remplace le nom Google
 * partout (accueil, amis, publications, messages).
 */
function asUser(u, pseudo) {
  const p = cleanPseudo(pseudo);
  return {
    uid: u.uid,
    displayName: p || u.googleName || u.displayName || '',
    googleName: u.googleName || u.displayName || '',
    pseudo: p,
    email: u.email || '',
    photoURL: u.photoURL || '',
  };
}
function readCachedSession(uid) {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY(uid))); } catch { return null; }
}
function writeCachedSession(uid, s) {
  try {
    localStorage.setItem('lastUid', uid);
    localStorage.setItem(SESSION_KEY(uid), JSON.stringify({
      at: Date.now(),
      user: { uid, displayName: s.user?.displayName || '', googleName: s.user?.googleName || '', pseudo: s.user?.pseudo || '', email: s.user?.email || '', photoURL: s.user?.photoURL || '' },
      isAdmin: Boolean(s.isAdmin),
      profile: {
        status: s.profile?.status || 'active',
        displayName: s.profile?.displayName || '',
        photoURL: s.profile?.photoURL || '',
        friendCode: s.profile?.friendCode || null,
        pseudo: s.profile?.pseudo || '',
      },
    }));
  } catch { /* stockage indisponible */ }
}

export function onSession(callback) {
  // 1. Démarrage instantané : dernière session connue sur cet appareil, affichée
  //    AVANT que Firebase Auth ait fini de s'initialiser (qui demande du réseau).
  let provisional = null;
  try {
    const uid = localStorage.getItem('lastUid');
    const c = uid && readCachedSession(uid);
    if (c?.user?.uid === uid && c.profile?.status === 'active') provisional = c;
  } catch { /* stockage indisponible */ }
  if (provisional) {
    callback({ state: 'active', user: provisional.user, profile: provisional.profile, isAdmin: provisional.isAdmin, provisional: true });
  } else {
    callback({ state: 'loading' });
    warmUpSignIn();   // pas de session sur l'appareil : on prépare Google tout de suite
  }

  // 2. Confirmation par Firebase Auth, puis revérification du profil.
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      clearLocalSession();
      callback({ state: 'signed-out' });
      return;
    }
    const cached = readCachedSession(user.uid);
    if (cached?.profile?.status === 'active') {
      callback({ state: 'active', user: asUser(user, cached.profile.pseudo), profile: cached.profile, isAdmin: cached.isAdmin, cached: true });
    } else {
      // Juste après la connexion Google : l'app s'ouvre tout de suite, sans attendre
      // les 2 lectures Firestore (profil + rôle). Si le compte est désactivé, l'écran
      // change dès la réponse ; les données restent protégées par les règles.
      callback({ state: 'active', user: asUser(user, ''), profile: { status: 'active', displayName: user.displayName || '', photoURL: user.photoURL || '' }, isAdmin: false, provisional: true });
    }
    try {
      const [{ profile, created }, { isAdmin, adminError }] = await Promise.all([
        ensureProfile(user),
        checkAdmin(user.uid),
      ]);
      // Vérification admin impossible (réseau) : on garde le rôle connu au lieu de le retirer.
      const admin = adminError ? Boolean(cached?.isAdmin) : isAdmin;
      const verified = {
        state: profile.status === 'disabled' ? 'disabled' : 'active',
        user: asUser(user, profile.pseudo), profile, isAdmin: admin, adminError, created,
      };
      writeCachedSession(user.uid, verified);
      if (adminError && cached) retryAdmin(user, verified, callback);
      // Déjà affiché depuis le cache et rien n'a changé : pas de nouveau rendu,
      // mais le profil affiché reçoit les champs à jour (code ami…).
      if (cached && verified.state === 'active' && cached.isAdmin === admin && cleanPseudo(cached.profile.pseudo) === cleanPseudo(profile.pseudo)) {
        Object.assign(cached.profile, { friendCode: profile.friendCode || null, displayName: profile.displayName || '' });
        return;
      }
      callback(verified);
      // Rôle admin non vérifiable (ex. juste après la connexion, avant que Firestore
      // ait reçu le jeton) : nouvelles tentatives, puis mise à jour de l'écran.
      if (adminError) retryAdmin(user, verified, callback);
    } catch (error) {
      console.error('[auth] session', error);
      if (!cached) callback({ state: 'error', user: asUser(user, ''), error });   // hors ligne : on garde la session en cache
    }
  });
}
