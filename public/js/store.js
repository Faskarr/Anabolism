/**
 * Store central — état de l'utilisateur connecté, synchronisé en TEMPS RÉEL
 * avec Firestore (onSnapshot sur chaque document).
 *
 * Remplace `window.D` de l'ancienne app. Différences :
 *  • tous les documents sont écoutés en temps réel (plus d'écrasement
 *    silencieux entre deux appareils ouverts) ;
 *  • les vues s'abonnent via `subscribe()` et se re-rendent automatiquement ;
 *  • `state.ready` indique quand les premières données sont disponibles.
 *
 * Les chemins Firestore sont IDENTIQUES à l'ancienne app :
 *   users/{uid}/data/{workouts|diet|protocol|profiles|weights|exlogs|counter}
 *   users/{uid}/weeks/{YYYYMMDD}
 */
import { db, fs } from './firebase.js';
import { weekKey } from './lib/dates.js';
import { watchConversation, watchAllConversations, unreadForUser, unreadForAdmin } from './data/messages.js';
import { watchPendingInbox } from './data/inbox.js';
import { watchUsers } from './data/admin.js';
import { watchFriendships, watchActivity, unreadFriend, friendOf, isAccepted, isIncoming } from './data/friends.js';
import { watchPosts } from './data/posts.js';
import { emptyGoals, normalizeGoals } from './data/goals.js';

const { doc, onSnapshot } = fs;

/** Catégories de profils (clé interne → clé du document `profiles`). */
export const CATS = /** @type {const} */ (['workout', 'diet', 'protocol']);

export const emptyProfiles = () => ({
  workout:  { active: null, list: [] },
  diet:     { active: null, list: [] },
  protocol: { active: null, list: [] },
});

export const state = {
  uid: null,
  ready: false,
  profiles: emptyProfiles(),
  workouts: {},     // { [pid]: { sessions: [...] } }
  diet: {},         // { [pid]: { objective, macros, meals } }
  protocol: {},     // { [pid]: { days: [...] } }
  weights: [],      // [{ date: 'YYYY-MM-DD', kg }]
  exlogs: {},       // { [exerciseId]: [{ ts, d, w, r }] }
  counterBase: 0,
  week: {},         // cases cochées de la semaine courante
  goals: emptyGoals(),                 // objectifs & habitudes { items, done }
  home: { order: null, hidden: [] },   // personnalisation des widgets de l'accueil
  weekKey: weekKey(),
  conversation: null,        // ma conversation avec l'admin (métadonnées)
  inbox: [],                 // envois du coach en attente
  me: null,                  // { uid, displayName, email } de l'utilisateur connecté
  friendships: [],           // mes amitiés (avec aperçu du dernier message)
  friendActivity: {},        // { [uid]: { name, day, sessionName, lastPost, avatarAt } } — amis + moi
  posts: {},                 // { [uid]: [publications] } — chargé seulement sur l'onglet Contact
  postsFeed: false,          // fil complet des publications actif ?
  adminUsers: null,          // ADMIN : tous les utilisateurs (null = non chargé)
  adminConversations: null,  // ADMIN : toutes les conversations (null = non chargé)
  error: null,
};

// ── Abonnements ─────────────────────────────────────────────────────────
const listeners = new Set();
let emitQueued = false;

/** S'abonne aux changements. Renvoie la fonction de désabonnement. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Notifie les abonnés (regroupé sur une frame pour éviter les rendus en rafale). */
export function emit() {
  if (emitQueued) return;
  emitQueued = true;
  requestAnimationFrame(() => {
    emitQueued = false;
    for (const fn of listeners) {
      try { fn(state); } catch (err) { console.error('[store] listener', err); }
    }
    saveSnapshot();
  });
}

// ── Synchronisation Firestore ───────────────────────────────────────────
let unsubs = [];
let pending = 0;

/**
 * Documents réellement reçus de Firestore (cache Firestore ou serveur) depuis
 * le démarrage. Tant qu'un document n'y est pas, l'écran peut afficher la copie
 * locale (instantané) mais AUCUNE écriture qui réécrit tout le document ne doit
 * partir : elle écraserait des données plus récentes (voir repo.js).
 */
const synced = new Set();
const waiters = new Map();   // nom → [fonctions à lancer à la synchro]

export const isSynced = (name) => synced.has(name);

/** Lance fn dès que tous les documents listés sont synchronisés. */
export function afterSync(names, fn) {
  const missing = names.filter((n) => !synced.has(n));
  if (!missing.length) { fn(); return; }
  const list = waiters.get(missing[0]) || [];
  list.push(() => afterSync(names, fn));
  waiters.set(missing[0], list);
}

function markSynced(name) {
  if (!name || synced.has(name)) return;
  synced.add(name);
  const list = waiters.get(name);
  waiters.delete(name);
  list?.forEach((fn) => { try { fn(); } catch (err) { console.error('[store] afterSync', err); } });
}

/** Normalise le document `profiles` (tolère les anciennes données partielles). */
function normalizeProfiles(raw) {
  const out = emptyProfiles();
  for (const cat of CATS) {
    const p = raw?.[cat];
    if (p && Array.isArray(p.list)) out[cat] = { active: p.active ?? null, list: p.list };
  }
  return out;
}

/**
 * Pesées lisibles quel que soit leur format d'origine (anciennes versions :
 * { d, w }, poids en texte « 82,5 », date avec heure) ; une par date, triées.
 */
function cleanWeights(raw) {
  const byDate = new Map();
  for (const e of Array.isArray(raw) ? raw : []) {
    const date = String(e?.date ?? e?.d ?? '').slice(0, 10);
    const kg = Number(String(e?.kg ?? e?.w ?? e?.weight ?? '').replace(',', '.'));
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && kg >= 20 && kg <= 400) byDate.set(date, { date, kg: Math.round(kg * 10) / 10 });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const DOC_HANDLERS = {
  workouts: (d) => { state.workouts = d || {}; },
  diet:     (d) => { state.diet = d || {}; },
  protocol: (d) => { state.protocol = d || {}; },
  profiles: (d) => { state.profiles = normalizeProfiles(d); },
  weights:  (d) => { state.weights = cleanWeights(d?.log); },
  exlogs:   (d) => { state.exlogs = d?.logs || {}; },
  counter:  (d) => { state.counterBase = Number(d?.base) || 0; },
  goals:    (d) => { state.goals = normalizeGoals(d); },
  home:     (d) => {
    state.home = {
      order: Array.isArray(d?.order) ? d.order.filter((x) => typeof x === 'string').slice(0, 30) : null,
      hidden: Array.isArray(d?.hidden) ? d.hidden.filter((x) => typeof x === 'string').slice(0, 30) : [],
    };
  },
};

// ── Instantané local (démarrage instantané) ─────────────────────────────
/**
 * Copie des données sur l'appareil (localStorage), relue au lancement : l'app
 * s'affiche immédiatement, puis Firestore met tout à jour en temps réel.
 * Les Timestamps Firestore sont convertis en millisecondes.
 */
const SNAP_VERSION = 2;
// Le carnet de charges (exlogs, potentiellement volumineux) n'est pas copié :
// il n'est chargé que sur l'écran Séances.
const SNAP_FIELDS = ['profiles', 'workouts', 'diet', 'protocol', 'weights', 'counterBase', 'week', 'weekKey',
  'goals', 'home', 'friendships', 'friendActivity', 'conversation', 'inbox'];
let snapTimer = null;

function saveSnapshot() {
  if (!state.uid || !state.ready) return;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    try {
      const data = {};
      for (const k of SNAP_FIELDS) data[k] = state[k];
      const json = JSON.stringify({ v: SNAP_VERSION, uid: state.uid, data },
        (_k, v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v));
      if (json.length < 2_000_000) localStorage.setItem(`snap:${state.uid}`, json);
    } catch { /* quota / stockage indisponible : sans conséquence */ }
  }, 1500);
}

function hydrate(uid) {
  try {
    const snap = JSON.parse(localStorage.getItem(`snap:${uid}`));
    if (snap?.v !== SNAP_VERSION || snap.uid !== uid) return false;
    Object.assign(state, snap.data);
    if (state.weekKey !== weekKey()) { state.week = {}; state.weekKey = weekKey(); }
    state.ready = true;
    return true;
  } catch { return false; }
}

function listen(ref, apply, name, { eager = true } = {}) {
  if (eager) pending += 1;
  let first = true;
  const done = () => {
    if (!first) return;
    first = false;
    markSynced(name);
    if (eager) { pending -= 1; if (pending === 0) state.ready = true; }
  };
  const unsub = onSnapshot(ref,
    (snap) => { apply(snap.exists() ? snap.data() : null); done(); emit(); },
    (err) => {
      console.error('[store] snapshot', ref.path, err);
      state.error = err;
      done();
      emit();
    });
  unsubs.push(unsub);
  return unsub;
}

let weekUnsub = null;
function listenWeek() {
  state.weekKey = weekKey();
  weekUnsub = listen(doc(db, 'users', state.uid, 'weeks', state.weekKey), (d) => { state.week = d || {}; }, 'week');
}

/**
 * Changement de semaine (lundi 0 h) : on bascule UNIQUEMENT l'écoute de la
 * semaine, sans redémarrer tout le store (qui coupait les flux admin).
 */
export function rollWeekIfNeeded() {
  if (!state.uid || weekKey() === state.weekKey) return false;
  weekUnsub?.();
  synced.delete('week');
  state.week = {};
  listenWeek();
  emit();
  return true;
}

// ── Carnet de charges : chargé à la demande (écran Séances, export) ────
let exlogsPromise = null;
/** Démarre l'écoute du carnet si besoin ; la promesse se résout à la 1re réception. */
export function ensureExlogs() {
  if (!state.uid) return Promise.resolve();
  if (!exlogsPromise) {
    exlogsPromise = new Promise((resolve) => {
      afterSync(['exlogs'], resolve);
      listen(doc(db, 'users', state.uid, 'data', 'exlogs'), DOC_HANDLERS.exlogs, 'exlogs', { eager: false });
    });
  }
  return exlogsPromise;
}

/** Démarre la synchro pour un utilisateur. */
const activityUnsubs = new Map();

const postUnsubs = new Map();

/**
 * Économie de lectures : au démarrage, UN seul document par ami (activity/{uid},
 * qui contient aussi sa dernière publication et la version de sa photo).
 * Le fil complet (5 dernières publications par personne, avec les likes) n'est
 * écouté que sur l'onglet Contact (startPostsFeed / stopPostsFeed).
 */
function syncFriendActivity() {
  if (!state.uid) return;
  const friends = new Set(state.friendships.filter(isAccepted).map((f) => friendOf(f, state.uid)));
  const wanted = new Set([...friends, state.uid]);
  for (const [uid, unsub] of activityUnsubs) {
    if (!wanted.has(uid)) { unsub(); activityUnsubs.delete(uid); }
  }
  // Anciens amis encore présents dans la copie locale : retirés.
  for (const uid of Object.keys(state.friendActivity)) {
    if (!wanted.has(uid)) delete state.friendActivity[uid];
  }
  for (const uid of wanted) {
    if (activityUnsubs.has(uid)) continue;
    activityUnsubs.set(uid, watchActivity(uid,
      (a) => { state.friendActivity = { ...state.friendActivity, [uid]: a }; emit(); },
      () => {
        // Refus juste après une acceptation (règles pas encore à jour) : on réessaie.
        activityUnsubs.get(uid)?.();
        activityUnsubs.delete(uid);
        setTimeout(() => { if (state.uid) syncFriendActivity(); }, 5000);
      }));
  }
  if (state.postsFeed) syncPosts(wanted);
}

function syncPosts(wanted) {
  for (const [uid, unsub] of postUnsubs) {
    if (!wanted.has(uid)) { unsub(); postUnsubs.delete(uid); delete state.posts[uid]; }
  }
  for (const uid of wanted) {
    if (postUnsubs.has(uid)) continue;
    postUnsubs.set(uid, watchPosts(uid, (list) => { state.posts = { ...state.posts, [uid]: list }; emit(); }, 8));
  }
}

/** Fil complet des publications (onglet Contact). */
export function startPostsFeed() {
  if (state.postsFeed || !state.uid) return;
  state.postsFeed = true;
  syncPosts(new Set([...state.friendships.filter(isAccepted).map((f) => friendOf(f, state.uid)), state.uid]));
}
export function stopPostsFeed() {
  postUnsubs.forEach((u) => u());
  postUnsubs.clear();
  state.postsFeed = false;
  state.posts = {};
}

export function startStore(uid, user) {
  stopStore();
  state.uid = uid;
  state.me = user ? { uid, displayName: user.displayName, email: user.email } : { uid };
  state.ready = false;
  state.error = null;
  hydrate(uid);   // affichage immédiat avec la dernière copie locale
  for (const [name, apply] of Object.entries(DOC_HANDLERS)) {
    if (name === 'exlogs') continue;          // à la demande (ensureExlogs)
    listen(doc(db, 'users', uid, 'data', name), apply, name);
  }
  listenWeek();
  unsubs.push(watchConversation(uid, (c) => { state.conversation = c; emit(); updateAppBadge(); }));
  unsubs.push(watchPendingInbox(uid, (items) => { state.inbox = items; emit(); }));
  unsubs.push(watchFriendships(uid, (list) => { state.friendships = list; syncFriendActivity(); emit(); updateAppBadge(); }));
  document.addEventListener('visibilitychange', onVisible);
}

/** ADMIN : conversations récentes (badge + boîte de réception), dès la connexion. */
export function startAdminFeeds() {
  unsubs.push(watchAllConversations((list) => { state.adminConversations = list; emit(); updateAppBadge(); }));
}

let usersUnsub = null;
/** ADMIN : liste de tous les utilisateurs, chargée seulement en ouvrant l'espace admin. */
export function ensureAdminUsers() {
  if (usersUnsub || !state.uid) return;
  usersUnsub = watchUsers((list) => { state.adminUsers = list; emit(); });
  unsubs.push(() => { usersUnsub?.(); usersUnsub = null; });
}

/** Nombre de non-lus à afficher (badge onglet « Moi » et icône de l'app). */
export function unreadCount() {
  const mine = unreadForUser(state.conversation) ? 1 : 0;
  const admin = (state.adminConversations || []).filter(unreadForAdmin).length;
  const friends = state.friendships.filter((f) => unreadFriend(f, state.uid)).length;
  const requests = state.friendships.filter((f) => isIncoming(f, state.uid)).length;
  return mine + admin + friends + requests;
}

/** Pastille sur l'icône de l'app (iOS 16.4+, app installée sur l'écran d'accueil). */
function updateAppBadge() {
  const n = unreadCount();
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* non supporté */ }
}

export function stopStore() {
  unsubs.forEach((u) => u());
  unsubs = [];
  activityUnsubs.forEach((u) => u());
  activityUnsubs.clear();
  postUnsubs.forEach((u) => u());
  postUnsubs.clear();
  pending = 0;
  synced.clear();
  waiters.clear();
  exlogsPromise = null;
  weekUnsub = null;
  document.removeEventListener('visibilitychange', onVisible);
  Object.assign(state, {
    uid: null, ready: false, profiles: emptyProfiles(), workouts: {}, diet: {}, protocol: {},
    weights: [], exlogs: {}, counterBase: 0, week: {}, error: null,
    goals: emptyGoals(), home: { order: null, hidden: [] },
    conversation: null, adminConversations: null, inbox: [], adminUsers: null,
    me: null, friendships: [], friendActivity: {}, posts: {}, postsFeed: false,
  });
}

/** Si l'app reste ouverte d'une semaine à l'autre, on bascule sur la nouvelle semaine. */
function onVisible() {
  if (document.visibilityState === 'visible') rollWeekIfNeeded();
}

// ── Sélecteurs ──────────────────────────────────────────────────────────

/** Id du profil actif d'une catégorie (ou du premier, ou null). */
export function activeProfileId(cat) {
  const p = state.profiles[cat];
  if (!p?.list?.length) return null;
  return p.list.find((x) => x.id === p.active)?.id || p.list[0].id;
}

export function activeProfile(cat) {
  const id = activeProfileId(cat);
  return id ? state.profiles[cat].list.find((x) => x.id === id) : null;
}

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };

/** Données du profil actif, avec valeurs par défaut sûres. */
export function profileData(cat, pid = activeProfileId(cat)) {
  if (!pid) return null;
  const raw = state[DATA_KEY[cat]]?.[pid];
  if (cat === 'workout')  return { sessions: [], ...raw };
  if (cat === 'diet')     return { objective: 0, macros: { p: 0, g: 0, l: 0 }, meals: [], ...raw };
  return { days: [], ...raw };
}

/** Nombre de séances : base manuelle + séances cochées cette semaine. */
export function sessionCount() {
  const done = Object.entries(state.week || {})
    .filter(([k, v]) => k.includes('_sess_') && v?.done).length;
  return (state.counterBase || 0) + done;
}

export const sessionWeekKey = (pid, sid) => `${pid}_sess_${sid}`;
export const injectionWeekKey = (pid, iid) => `${pid}_${iid}`;
