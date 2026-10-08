/**
 * ADMIN — lecture et gestion des utilisateurs.
 *
 * Tout est protégé côté serveur par firestore.rules (isAdmin()) :
 *  • lecture : users/*, users/{uid}/data/*, weeks/*, inbox/*
 *  • écriture : users/{uid}.status, data/{workouts|diet|protocol|profiles|goals}, inbox (création),
 *               library/* (bibliothèque de programmes types)
 * Un non-admin qui appellerait ces fonctions recevrait « permission-denied ».
 */
import { db, fs } from '../firebase.js';
import { weekKey } from '../lib/dates.js';
import { uid as newId } from '../lib/ids.js';
import { toast } from '../ui/toast.js';
import { normalizeGoals, emptyGoals } from './goals.js';

import { T } from '../lib/i18n.js';
const {
  doc, collection, query, orderBy, limit, onSnapshot, setDoc, updateDoc, deleteField, serverTimestamp, writeBatch, getDoc, FieldPath,
  getDocs, where,
} = fs;

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };
const DOCS = ['profiles', 'workouts', 'diet', 'protocol', 'weights', 'exlogs', 'counter', 'goals'];

const fail = (label) => (err) => {
  console.error(`[admin] ${label}`, err);
  toast(T`Action impossible (${label}) : ${err.code || err.message}`, { type: 'error' });
  throw err;
};

/** Tous les utilisateurs (les plus récents d'abord). */
export function watchUsers(cb) {
  const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(500));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => {
      const u = d.data({ serverTimestamps: 'estimate' });
      // Pseudo affiché en priorité (le nom Google reste visible dans googleName).
      return { id: d.id, ...u, googleName: u.displayName, displayName: u.pseudo || u.displayName };
    })),
    (err) => { console.error('[admin] users', err); cb([]); });
}

/**
 * Toutes les données d'un utilisateur, en temps réel.
 * cb reçoit { profiles, workouts, diet, protocol, weights, exlogs, counterBase, week, ready }.
 */
export function watchUserData(uid, cb) {
  const data = {
    profiles: null, workouts: {}, diet: {}, protocol: {}, weights: [], exlogs: {}, counterBase: 0, week: {}, goals: emptyGoals(), ready: false,
  };
  let pending = DOCS.length + 1;
  const done = () => { if (pending > 0) pending -= 1; data.ready = pending === 0; cb({ ...data }); };

  const apply = {
    profiles: (d) => { data.profiles = d || {}; },
    workouts: (d) => { data.workouts = d || {}; },
    diet: (d) => { data.diet = d || {}; },
    protocol: (d) => { data.protocol = d || {}; },
    weights: (d) => { data.weights = Array.isArray(d?.log) ? d.log : []; },
    exlogs: (d) => { data.exlogs = d?.logs || {}; },
    counter: (d) => { data.counterBase = Number(d?.base) || 0; },
    goals: (d) => { data.goals = normalizeGoals(d); },
  };
  const unsubs = DOCS.map((name) => {
    let first = true;
    return onSnapshot(doc(db, 'users', uid, 'data', name), (snap) => {
      apply[name](snap.exists() ? snap.data() : null);
      if (first) { first = false; done(); } else cb({ ...data });
    }, (err) => { console.warn('[admin] data', name, err); if (first) { first = false; done(); } });
  });
  let firstWeek = true;
  unsubs.push(onSnapshot(doc(db, 'users', uid, 'weeks', weekKey()), (snap) => {
    data.week = snap.exists() ? snap.data() : {};
    if (firstWeek) { firstWeek = false; done(); } else cb({ ...data });
  }, () => { if (firstWeek) { firstWeek = false; done(); } }));

  return () => unsubs.forEach((u) => u());
}

/** Envois en attente / traités pour un utilisateur. */
export function watchUserInbox(uid, cb) {
  const q = query(collection(db, 'users', uid, 'inbox'), orderBy('sentAt', 'desc'), limit(30));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    () => cb([]));
}

// ── Actions ─────────────────────────────────────────────────────────────

/** Désactive / réactive un compte. Aucune donnée n'est supprimée. */
export function setUserStatus(uid, status) {
  return updateDoc(doc(db, 'users', uid), { status }).catch(fail('statut'));
}

/**
 * SUPPRIME un compte : toutes ses données Firestore (profil, programmes, diet,
 * protocole, poids, carnet, habitudes, semaines, envois du coach, conversation,
 * activité et publications, photo, code ami, amitiés et leurs discussions).
 *
 * `block` : garde une fiche minimale « désactivée » → la personne ne peut plus
 * se réinscrire avec ce compte Google. Sinon, elle repartirait de zéro en se
 * reconnectant. (Le compte Google lui-même reste dans Firebase Authentication :
 * le retirer aussi = console Firebase › Authentication.)
 * @returns {Promise<number>} nombre de documents supprimés
 */
export async function deleteUserAccount(uid, { block = false } = {}) {
  const refs = [];
  const all = async (q) => (await getDocs(q)).docs.map((d) => d.ref);

  for (const name of [...DOCS, 'home']) refs.push(doc(db, 'users', uid, 'data', name));
  const [weeks, inbox, convMsgs, posts, codes, friendships, userSnap] = await Promise.all([
    all(collection(db, 'users', uid, 'weeks')),
    all(collection(db, 'users', uid, 'inbox')),
    all(collection(db, 'conversations', uid, 'messages')),
    all(collection(db, 'activity', uid, 'posts')),
    all(query(collection(db, 'friendCodes'), where('uid', '==', uid))),
    getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid))),
    getDoc(doc(db, 'users', uid)),
  ]);
  refs.push(...weeks, ...inbox, ...convMsgs, doc(db, 'conversations', uid),
    ...posts, doc(db, 'activity', uid), doc(db, 'avatars', uid), doc(db, 'shared', uid), ...codes);
  for (const f of friendships.docs) {
    refs.push(...await all(collection(db, 'friendships', f.id, 'messages')), f.ref);
  }

  // Lots de 450 écritures (limite Firestore : 500 par lot).
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  const u = userSnap.exists() ? userSnap.data() : {};
  if (block) {
    await setDoc(doc(db, 'users', uid), {
      status: 'disabled', email: u.email || '', displayName: (u.displayName || '').slice(0, 120),
      createdAt: u.createdAt || serverTimestamp(), deletedAt: serverTimestamp(),
    });
  } else {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'users', uid));
    await batch.commit();
  }
  return refs.length + 1;
}

/**
 * Renomme un utilisateur (pseudo imposé par l'admin ; '' = retour au nom Google).
 * Le nom est recopié partout où il est lu : activité, amitiés, code ami,
 * conversation avec le coach, profil partagé.
 */
export async function renameUser(uid, rawPseudo) {
  const pseudo = String(rawPseudo || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const userSnap = await getDoc(doc(db, 'users', uid));
  const u = userSnap.exists() ? userSnap.data() : {};
  const name = (pseudo || u.displayName || u.email || 'Utilisateur').slice(0, 120);
  const [friendships, codes, conv, shared, act] = await Promise.all([
    getDocs(query(collection(db, 'friendships'), where('members', 'array-contains', uid))),
    getDocs(query(collection(db, 'friendCodes'), where('uid', '==', uid))),
    getDoc(doc(db, 'conversations', uid)),
    getDoc(doc(db, 'shared', uid)),
    getDoc(doc(db, 'activity', uid)),
  ]);
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), { pseudo: pseudo || deleteField() });
  friendships.docs.forEach((f) => batch.update(f.ref, { [`names.${uid}`]: name }));
  codes.docs.forEach((c) => batch.update(c.ref, { name }));
  if (conv.exists()) batch.update(conv.ref, { userName: name });
  if (shared.exists()) batch.update(shared.ref, { name });
  if (act.exists()) batch.update(act.ref, { name });
  await batch.commit();
  return name;
}

/**
 * Propose un programme / diet / protocole : l'utilisateur l'accepte ou l'ignore
 * depuis son accueil (il garde la main sur ses données).
 */
export function proposeToUser(uid, { type, title, message, payload }) {
  return setDoc(doc(collection(db, 'users', uid, 'inbox')), {
    type, title: String(title || '').slice(0, 80), message: String(message || '').slice(0, 500),
    payload: payload ?? null, status: 'pending', sentAt: serverTimestamp(),
  }).catch(fail('envoi'));
}

/** Retire un envoi pas encore traité. */
export function cancelProposal(uid, itemId) {
  return fs.deleteDoc(doc(db, 'users', uid, 'inbox', itemId)).catch(fail('annulation'));
}

/**
 * Écriture des profils d'UNE catégorie seulement : si l'utilisateur modifie une
 * autre catégorie au même moment, les deux écritures ne s'écrasent pas.
 */
const profilesWrite = (uid, next, cat) => [
  doc(db, 'users', uid, 'data', 'profiles'), { [cat]: next[cat] }, { mergeFields: [new FieldPath(cat)] },
];

/**
 * Installe DIRECTEMENT un profil chez l'utilisateur et le rend actif.
 * @param {object} profiles  document `profiles` actuel de l'utilisateur
 */
export function installProfileForUser(uid, profiles, cat, name, data) {
  const pid = newId('p');
  const next = structuredClone(profiles || {});
  next[cat] = next[cat]?.list ? next[cat] : { active: null, list: [] };
  next[cat].list.push({ id: pid, name: String(name).slice(0, 60) });
  next[cat].active = pid;
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'data', DATA_KEY[cat]), { [pid]: data }, { mergeFields: [new FieldPath(pid)] });
  batch.set(...profilesWrite(uid, next, cat));
  return batch.commit().catch(fail('installation'));
}

export function renameUserProfile(uid, profiles, cat, pid, name) {
  const next = structuredClone(profiles);
  const p = next[cat]?.list?.find((x) => x.id === pid);
  if (!p) return Promise.resolve();
  p.name = String(name).slice(0, 60);
  return setDoc(...profilesWrite(uid, next, cat)).catch(fail('renommage'));
}

export function setUserActiveProfile(uid, profiles, cat, pid) {
  const next = structuredClone(profiles);
  if (!next[cat]) return Promise.resolve();
  next[cat].active = pid;
  return setDoc(...profilesWrite(uid, next, cat)).catch(fail('profil actif'));
}

export function deleteUserProfile(uid, profiles, cat, pid) {
  const next = structuredClone(profiles);
  if (!next[cat]?.list) return Promise.resolve();
  next[cat].list = next[cat].list.filter((x) => x.id !== pid);
  if (next[cat].active === pid) next[cat].active = next[cat].list[0]?.id || null;
  const batch = writeBatch(db);
  batch.set(...profilesWrite(uid, next, cat));
  batch.set(doc(db, 'users', uid, 'data', DATA_KEY[cat]), { [pid]: deleteField() }, { merge: true });
  return batch.commit().catch(fail('suppression'));
}

/** Remplace les objectifs d'un utilisateur (liste + cases). */
export function setUserGoals(uid, goals) {
  return setDoc(doc(db, 'users', uid, 'data', 'goals'), normalizeGoals(goals)).catch(fail('objectifs'));
}

// ── Bibliothèque de programmes types (admin uniquement) ─────────────────
//   library/{id} = { cat, name, note, payload, createdAt, updatedAt }

export function watchLibrary(cb) {
  const q = query(collection(db, 'library'), orderBy('updatedAt', 'desc'), limit(200));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    (err) => { console.error('[admin] library', err); cb([]); });
}

export function saveLibraryItem(id, { cat, name, note, payload }) {
  const ref = id ? doc(db, 'library', id) : doc(collection(db, 'library'));
  const body = {
    cat, name: String(name).slice(0, 60), note: String(note || '').slice(0, 300), updatedAt: serverTimestamp(),
    ...(payload ? { payload } : {}),
    ...(id ? {} : { createdAt: serverTimestamp() }),
  };
  return setDoc(ref, body, { merge: true }).catch(fail('bibliothèque'));
}

export function deleteLibraryItem(id) {
  return fs.deleteDoc(doc(db, 'library', id)).catch(fail('bibliothèque'));
}

/** Installe un profil chez un utilisateur sans avoir sa fiche ouverte (lit ses profils d'abord). */
export async function installForUser(uid, cat, name, payload) {
  const snap = await getDoc(doc(db, 'users', uid, 'data', 'profiles')).catch(fail('lecture des profils'));
  return installProfileForUser(uid, snap.exists() ? snap.data() : {}, cat, name, payload);
}
