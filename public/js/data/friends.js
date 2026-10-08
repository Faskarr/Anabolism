/**
 * Amis : code personnel, ajout, discussions privées, activité du jour.
 *
 * Firestore (voir firestore.rules) :
 *   friendCodes/{CODE}            { uid, name, createdAt }          code → utilisateur
 *   friendships/{uidA_uidB}       { members:[a,b], names:{a,b}, code, createdAt,
 *                                   lastText, lastFrom, lastAt, readAt:{uid: ts} }
 *   friendships/{id}/messages/*   { from: uid, text, at }
 *   activity/{uid}                { name, day:'YYYY-MM-DD'|null, sessionName, at,
 *                                   lastPost: { id, type, … }, avatarAt: ms }
 *
 * Sécurité : une amitié ne peut être créée qu'avec le code de l'autre personne ;
 * l'activité n'est lisible que par les amis.
 */
import { db, fs } from '../firebase.js';
import { localISODate } from '../lib/dates.js';
import { ms } from './messages.js';
import { toast } from '../ui/toast.js';

import { T } from '../lib/i18n.js';
const {
  doc, collection, query, where, orderBy, limit, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc,
  writeBatch, serverTimestamp,
} = fs;

// Sans 0/O, 1/I/L : lisible et dictable.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-Z2-9]{6}$/;

export const pairOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
/** Amitié acceptée (les anciennes, sans statut, comptent comme acceptées). */
export const isAccepted = (f) => (f.status ?? 'accepted') === 'accepted';
/** Demande reçue (à accepter ou refuser). */
export const isIncoming = (f, me) => f.status === 'pending' && f.requestedBy !== me;
/** Demande envoyée, en attente de réponse. */
export const isOutgoing = (f, me) => f.status === 'pending' && f.requestedBy === me;
export const friendOf = (f, me) => f.members.find((m) => m !== me);
export const unreadFriend = (f, me) => Boolean(isAccepted(f) && f.lastFrom && f.lastFrom !== me && ms(f.lastAt) > ms(f.readAt?.[me]) && ms(f.lastAt) > ms(f.clearedAt?.[me]));

const read = (snap) => ({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) });

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** Normalise une saisie : « ab-12 cd » → « AB12CD ». */
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Renvoie le code ami de l'utilisateur, en le créant si besoin.
 * @param {{ uid, displayName, email }} user
 * @param {string} [known]  code déjà connu (profil)
 */
export async function ensureMyCode(user, known) {
  if (known && CODE_RE.test(known)) return known;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await setDoc(doc(db, 'friendCodes', code), {
        uid: user.uid, name: (user.displayName || user.email || 'Utilisateur').slice(0, 120), createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', user.uid), { friendCode: code });
      return code;
    } catch (err) {
      // Code déjà pris par quelqu'un d'autre → on en tire un nouveau.
      if (err.code !== 'permission-denied') throw err;
    }
  }
  throw new Error('Impossible de générer un code, réessaie.');
}

/** Mes amitiés, en temps réel (les plus récentes conversations d'abord). */
export function watchFriendships(uid, cb) {
  const q = query(collection(db, 'friendships'), where('members', 'array-contains', uid));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map(read).sort((a, b) => (ms(b.lastAt) || ms(b.createdAt)) - (ms(a.lastAt) || ms(a.createdAt)))),
    (err) => { console.warn('[friends]', err); cb([]); });
}

/**
 * Envoie une demande d'ami avec son code (il devra l'accepter).
 * @returns {Promise<string>} nom de la personne
 */
export async function addFriendByCode(user, rawCode, existing = []) {
  const code = cleanCode(rawCode);
  if (!CODE_RE.test(code)) throw new Error('Un code fait 6 caractères (lettres et chiffres).');
  const snap = await getDoc(doc(db, 'friendCodes', code));
  if (!snap.exists()) throw new Error('Code introuvable. Vérifie-le avec ton ami.');
  const other = snap.data();
  if (other.uid === user.uid) throw new Error("C'est ton propre code 🙂");
  const pid = pairOf(user.uid, other.uid);
  const already = existing.find((f) => f.id === pid);
  if (already) {
    if (isAccepted(already)) throw new Error(T`${other.name} est déjà dans tes amis.`);
    if (isIncoming(already, user.uid)) throw new Error(T`${other.name} t’a déjà envoyé une demande : accepte-la ci-dessous.`);
    throw new Error(T`Demande déjà envoyée à ${other.name}.`);
  }
  const members = [user.uid, other.uid].sort();
  await setDoc(doc(db, 'friendships', pid), {
    members,
    names: { [user.uid]: (user.displayName || user.email || 'Moi').slice(0, 120), [other.uid]: other.name },
    code,
    status: 'pending',
    requestedBy: user.uid,
    createdAt: serverTimestamp(),
  });
  return other.name;
}

/** ADMIN : amitié créée directement « acceptée » (sans demande ni code). */
export function addFriendDirect(admin, other) {
  const members = [admin.uid, other.uid].sort();
  return setDoc(doc(db, 'friendships', pairOf(admin.uid, other.uid)), {
    members,
    names: { [admin.uid]: (admin.displayName || admin.email || 'Coach').slice(0, 120), [other.uid]: String(other.name || 'Ami').slice(0, 120) },
    code: 'ADMIN',
    status: 'accepted',
    requestedBy: admin.uid,
    createdAt: serverTimestamp(),
    acceptedAt: serverTimestamp(),
  });
}

/** Accepte une demande reçue. */
export function acceptFriend(pid) {
  return updateDoc(doc(db, 'friendships', pid), { status: 'accepted', acceptedAt: serverTimestamp() })
    .catch((err) => { console.error(err); toast('Impossible d’accepter la demande.', { type: 'error' }); throw err; });
}

export function removeFriend(pid) {
  return deleteDoc(doc(db, 'friendships', pid))
    .catch((err) => { console.error(err); toast('Suppression impossible.', { type: 'error' }); });
}

// ── Discussion entre amis ───────────────────────────────────────────────

export function watchFriendMessages(pid, cb) {
  const q = query(collection(db, 'friendships', pid, 'messages'), orderBy('at', 'desc'), limit(50));
  return onSnapshot(q, (snap) => cb(snap.docs.map(read).reverse()), (err) => { console.warn('[friends] msgs', err); cb([]); });
}

export function sendFriendMessage(uid, pid, text) {
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) return false;
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'friendships', pid, 'messages')), { from: uid, text: body, at: serverTimestamp() });
  batch.update(doc(db, 'friendships', pid), {
    lastText: body.slice(0, 140), lastFrom: uid, lastAt: serverTimestamp(), [`readAt.${uid}`]: serverTimestamp(),
  });
  batch.commit().catch((err) => { console.error(err); toast('Message non envoyé.', { type: 'error' }); });
  return true;
}

// ── Envoi d'un programme / diet / protocole à un ami ────────────────────

export const SHARE_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };
export const SHARE_MAX = 300000;   // caractères (le document Firestore reste < 1 Mo)

/**
 * Envoi groupé (un message par profil, en une seule écriture atomique).
 * Message spécial : { kind:'share', cat, title, payload (JSON), status:'pending' } ;
 * l'ami accepte chacun (ajouté comme nouveau profil chez lui) ou le refuse.
 */
export function sendFriendShares(uid, pid, items) {
  const batch = writeBatch(db);
  let last = '';
  for (const { cat, title, data } of items) {
    const payload = JSON.stringify(data ?? {});
    const name = String(title || SHARE_LABEL[cat]).trim().slice(0, 80) || SHARE_LABEL[cat];
    if (payload.length > SHARE_MAX) throw new Error(T`« ${name} » est trop volumineux pour être envoyé (exporte-le en fichier).`);
    last = `${SHARE_LABEL[cat]} « ${name} »`.slice(0, 200);
    batch.set(doc(collection(db, 'friendships', pid, 'messages')), {
      from: uid, text: last, at: serverTimestamp(), kind: 'share', cat, title: name, payload, status: 'pending',
    });
  }
  const preview = items.length > 1 ? `📦 ${items.length} envois (programme, diet…)` : `📦 ${last}`;
  batch.update(doc(db, 'friendships', pid), {
    lastText: preview.slice(0, 140), lastFrom: uid, lastAt: serverTimestamp(), [`readAt.${uid}`]: serverTimestamp(),
  });
  return batch.commit();
}

/** Réponse du destinataire : 'accepted' | 'refused'. */
export function answerFriendShare(pid, mid, status) {
  return updateDoc(doc(db, 'friendships', pid, 'messages', mid), { status });
}

/**
 * Supprime la discussion POUR MOI (comme WhatsApp) : les messages antérieurs ne
 * s'affichent plus chez moi ; l'ami et l'amitié sont conservés. La discussion
 * réapparaît au prochain message.
 */
export function clearFriendChat(uid, pid) {
  return updateDoc(doc(db, 'friendships', pid), {
    [`clearedAt.${uid}`]: serverTimestamp(), [`readAt.${uid}`]: serverTimestamp(),
  });
}
/** Discussion visible dans « Discussions » : un message après ma suppression éventuelle. */
export const hasChat = (f, me) => Boolean(f.lastAt && ms(f.lastAt) > ms(f.clearedAt?.[me]));

export function markFriendRead(uid, pid) {
  updateDoc(doc(db, 'friendships', pid), { [`readAt.${uid}`]: serverTimestamp() }).catch(() => {});
}

// ── Activité ────────────────────────────────────────────────────────────

/** Publie (ou retire) « séance faite aujourd'hui » pour les amis. */
export function publishActivity(user, sessionName, done) {
  // merge : conserve lastPost et avatarAt.
  setDoc(doc(db, 'activity', user.uid), {
    name: (user.displayName || 'Utilisateur').slice(0, 120),
    day: done ? localISODate() : null,
    sessionName: done ? String(sessionName || '').slice(0, 60) : null,
    at: serverTimestamp(),
  }, { merge: true }).catch((err) => console.warn('[friends] activité', err));
}

export function watchActivity(uid, cb, onError) {
  return onSnapshot(doc(db, 'activity', uid),
    (snap) => cb(snap.exists() ? read(snap) : null),
    (err) => { cb(null); onError?.(err); });
}
