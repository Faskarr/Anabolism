/**
 * Messagerie utilisateur ↔ administrateur.
 *
 * Modèle (déjà couvert par firestore.rules) :
 *   conversations/{uid}
 *     { userName, lastText, lastFrom: 'user'|'admin', lastAt, userReadAt, adminReadAt, status: 'open'|'done' }
 *   conversations/{uid}/messages/{id}
 *     { from: 'user'|'admin', text (1–2000 car.), at: serverTimestamp }
 *
 * Non-lus SANS compteur falsifiable : une conversation est non lue pour l'un
 * si le dernier message vient de l'autre et est plus récent que sa date de lecture.
 * Envoi = batch atomique (message + aperçu de la conversation).
 */
import { db, fs } from '../firebase.js';
import { toast } from '../ui/toast.js';

const {
  doc, collection, query, orderBy, limit, onSnapshot, writeBatch, updateDoc, serverTimestamp,
} = fs;

export const MAX_LEN = 2000;
const PREVIEW_LEN = 140;

/** Timestamp Firestore | Date | nombre | null → millisecondes (0 si absent). */
export function ms(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

export const unreadForUser = (c) => Boolean(c && c.lastFrom === 'admin' && ms(c.lastAt) > ms(c.userReadAt));
export const unreadForAdmin = (c) => Boolean(c && c.lastFrom === 'user' && ms(c.lastAt) > ms(c.adminReadAt));

const convRef = (uid) => doc(db, 'conversations', uid);
const msgCol = (uid) => collection(db, 'conversations', uid, 'messages');

/** Données d'un snapshot avec estimation des horodatages serveur en attente (affichage immédiat). */
const read = (snap) => ({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) });

function fail(label) {
  return (err) => {
    console.error(`[messages] ${label}`, err);
    toast("Message non envoyé. Vérifie ta connexion et réessaie.", { type: 'error' });
  };
}

// ── Lecture ─────────────────────────────────────────────────────────────

/** Conversation (métadonnées) d'un utilisateur, en temps réel. */
export function watchConversation(uid, cb) {
  return onSnapshot(convRef(uid),
    (snap) => cb(snap.exists() ? read(snap) : null),
    (err) => console.warn('[messages] conversation', err));
}

/** 100 derniers messages, du plus ancien au plus récent. */
export function watchMessages(uid, cb) {
  const q = query(msgCol(uid), orderBy('at', 'desc'), limit(50));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map(read).reverse()),
    (err) => { console.warn('[messages] messages', err); cb([]); });
}

/** ADMIN — toutes les conversations, la plus récente en premier. */
export function watchAllConversations(cb) {
  const q = query(collection(db, 'conversations'), orderBy('lastAt', 'desc'), limit(60));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map(read)),
    (err) => { console.warn('[messages] admin list', err); cb([]); });
}

// ── Écriture ────────────────────────────────────────────────────────────

const clean = (text) => String(text || '').replace(/\s+$/g, '').replace(/^\s+/g, '').slice(0, MAX_LEN);

/** UTILISATEUR — envoie un message (crée la conversation si besoin, la rouvre si « traitée »). */
export function sendUserMessage(user, text) {
  const body = clean(text);
  if (!body) return false;
  const batch = writeBatch(db);
  batch.set(doc(msgCol(user.uid)), { from: 'user', text: body, at: serverTimestamp() });
  batch.set(convRef(user.uid), {
    userName: (user.displayName || user.email || 'Utilisateur').slice(0, 120),
    lastText: body.slice(0, PREVIEW_LEN),
    lastFrom: 'user',
    lastAt: serverTimestamp(),
    userReadAt: serverTimestamp(),
    status: 'open',
  }, { merge: true });
  batch.commit().catch(fail('envoi'));
  return true;
}

/** UTILISATEUR — marque la conversation comme lue. */
export function markReadByUser(uid) {
  updateDoc(convRef(uid), { userReadAt: serverTimestamp() })
    .catch((err) => console.warn('[messages] lu (user)', err));
}

/** UTILISATEUR — supprime la discussion avec le coach de MON côté (l'historique reste chez le coach). */
export function clearCoachChat(uid) {
  return updateDoc(convRef(uid), { userClearedAt: serverTimestamp(), userReadAt: serverTimestamp() });
}

/** ADMIN — répond à (ou écrit en premier à) un utilisateur. */
export function sendAdminMessage(uid, text, userName) {
  const body = clean(text);
  if (!body) return false;
  const batch = writeBatch(db);
  batch.set(doc(msgCol(uid)), { from: 'admin', text: body, at: serverTimestamp() });
  batch.set(convRef(uid), {
    ...(userName ? { userName: String(userName).slice(0, 120) } : {}),
    lastText: body.slice(0, PREVIEW_LEN),
    lastFrom: 'admin',
    lastAt: serverTimestamp(),
    adminReadAt: serverTimestamp(),
  }, { merge: true });
  batch.commit().catch(fail('réponse'));
  return true;
}

/** ADMIN — marque comme lue. */
export function markReadByAdmin(uid) {
  updateDoc(convRef(uid), { adminReadAt: serverTimestamp() })
    .catch((err) => console.warn('[messages] lu (admin)', err));
}

/** ADMIN — « traitée » / « à traiter ». */
export function setConversationStatus(uid, status) {
  return updateDoc(convRef(uid), { status })
    .catch((err) => { console.error(err); toast('Mise à jour impossible.', { type: 'error' }); });
}
