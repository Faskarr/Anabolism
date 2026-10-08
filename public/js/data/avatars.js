/**
 * Photos de profil : avatars/{uid} = { img: 'data:image/jpeg;base64,…', at }.
 * Lecture : soi-même, ses amis, l'admin (cf. firestore.rules).
 *
 * Économie de lectures : chaque photo est gardée sur le téléphone (Cache
 * Storage) et n'est relue dans Firestore que si elle a changé. La « version »
 * d'une photo (avatarAt, en ms) est publiée dans activity/{uid} — que les amis
 * lisent déjà — et dans users/{uid} — que l'admin lit déjà.
 * Sans version connue, la copie locale est rafraîchie au bout de 7 jours.
 */
import { db, fs } from '../firebase.js';
import { state } from '../store.js';

const { doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp } = fs;

const CACHE = 'avatars-v1';
const TTL = 7 * 86400000;
const mem = new Map();          // uid → { img, v, t } | 'loading'
const keyOf = (uid) => `/__avatar__/${encodeURIComponent(uid)}`;

const rerender = () => window.dispatchEvent(new Event('app:render'));

/** Version connue de la photo d'un utilisateur (0 = inconnue). */
function versionOf(uid) {
  const a = Number(state.friendActivity?.[uid]?.avatarAt) || 0;
  const u = Number(state.adminUsers?.find((x) => x.id === uid)?.avatarAt) || 0;
  return Math.max(a, u);
}

// retryAt : après un échec (hors ligne, refus), pas de nouvelle tentative avant 1 min.
const fresh = (e, v) => e && (e.retryAt > Date.now() || (v ? e.v >= v : Date.now() - e.t < TTL));

async function readCache(uid) {
  try {
    const r = await (await caches.open(CACHE)).match(keyOf(uid));
    return r ? await r.json() : null;
  } catch { return null; }   // Cache Storage indisponible : on lira Firestore
}
async function writeCache(uid, entry) {
  try {
    await (await caches.open(CACHE)).put(keyOf(uid), new Response(JSON.stringify(entry), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* ignoré */ }
}

async function load(uid, v) {
  const cached = await readCache(uid);
  if (fresh(cached, v)) { mem.set(uid, cached); rerender(); return; }
  try {
    const snap = await getDoc(doc(db, 'avatars', uid));
    // Hors ligne, getDoc répond depuis le cache Firestore : pas une vraie mise à jour.
    if (snap.metadata?.fromCache && cached) throw new Error('cache');
    const entry = { img: snap.exists() ? snap.data().img : null, v, t: Date.now() };
    mem.set(uid, entry);
    writeCache(uid, entry);
  } catch {
    // Pas le droit / hors ligne : on garde l'ancienne image et on réessaiera plus tard.
    mem.set(uid, { ...(cached || { img: null, v: 0, t: 0 }), retryAt: Date.now() + 60_000 });
  }
  rerender();
}

/** Image d'un utilisateur si connue ; déclenche le chargement (cache puis Firestore) sinon. */
export function avatarOf(uid) {
  if (!uid) return null;
  const e = mem.get(uid);
  if (e === 'loading') return null;
  const v = versionOf(uid);
  if (fresh(e, v)) return e.img;
  mem.set(uid, 'loading');
  load(uid, v);
  return e?.img ?? null;   // ancienne photo affichée pendant la mise à jour
}

/** Publie la nouvelle version de MA photo (amis via activity, admin via users). */
function publishVersion(uid, at) {
  setDoc(doc(db, 'activity', uid), { avatarAt: at }, { merge: true }).catch(() => {});
  updateDoc(doc(db, 'users', uid), { avatarAt: at }).catch(() => {});
}

/** Enregistre MA photo (JPEG carré déjà recadré, en data URL). */
export async function uploadMyAvatar(uid, img) {
  if (!/^data:image\/jpeg;base64,/.test(img) || img.length >= 150000) throw new Error('Image invalide.');
  await setDoc(doc(db, 'avatars', uid), { img, at: serverTimestamp() });
  const at = Date.now();
  const entry = { img, v: at, t: at };
  mem.set(uid, entry);
  writeCache(uid, entry);
  publishVersion(uid, at);
  rerender();
}

export async function removeMyAvatar(uid) {
  await deleteDoc(doc(db, 'avatars', uid));
  const at = Date.now();
  const entry = { img: null, v: at, t: at };
  mem.set(uid, entry);
  writeCache(uid, entry);
  publishVersion(uid, at);
  rerender();
}
