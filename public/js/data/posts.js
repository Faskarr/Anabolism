/**
 * Publications partagées avec les amis : activity/{uid}/posts/{id}
 *   record  : { type: 'pr', name, exercise, w, r, e1rm, at, likes: [uid…] }
 *   musique : { type: 'music', name, url, title, service, at, likes: [uid…] }
 * Visibles et « likables » par les amis (cf. firestore.rules).
 */
import { db, fs } from '../firebase.js';
import { toast } from '../ui/toast.js';

const { doc, collection, query, orderBy, limit, onSnapshot, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, arrayRemove, serverTimestamp } = fs;

const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

/**
 * Recopie la dernière publication dans activity/{uid} : l'accueil de mes amis
 * l'affiche sans lire ma sous-collection de posts.
 */
function setLastPost(uid, ref, data) {
  const { likes, at, name, ...rest } = data;
  const copy = { id: ref.id || ref.path.split('/').pop(), ...rest, at: Date.now() };
  // La dernière musique est gardée à part : un record publié ensuite ne l'efface pas.
  const patch = data.type === 'music' ? { lastPost: copy, lastMusic: copy } : { lastPost: copy };
  return setDoc(doc(db, 'activity', uid), patch, { merge: true }).catch(() => {});
}

export function sharePR(me, { exercise, w, r }) {
  const ref = doc(collection(db, 'activity', me.uid, 'posts'));
  const data = {
    type: 'pr',
    name: (me.displayName || 'Utilisateur').slice(0, 120),
    exercise: String(exercise).slice(0, 120),
    w: Math.round(w * 10) / 10,
    r: Math.round(r),
    e1rm: Math.round(e1rm(w, r)),
    at: serverTimestamp(),
    likes: [],
  };
  return setDoc(ref, data).then(() => { setLastPost(me.uid, ref, data); toast('Record partagé avec tes amis 🏆'); })
    .catch((err) => { console.error(err); toast('Partage impossible.', { type: 'error' }); });
}

// ── Musique ─────────────────────────────────────────────────────────────

/** Services reconnus : le lien universel ouvre directement l'app installée. */
export const MUSIC_SERVICES = {
  spotify: { label: 'Spotify',     hosts: ['open.spotify.com', 'spotify.link'] },
  deezer:  { label: 'Deezer',      hosts: ['www.deezer.com', 'deezer.com', 'deezer.page.link', 'link.deezer.com'] },
  apple:   { label: 'Apple Music', hosts: ['music.apple.com'] },
  youtube: { label: 'YouTube Music', hosts: ['music.youtube.com'] },
};

/**
 * Où ouvrir un son partagé : le lien d'origine sur son service, sinon une
 * recherche par titre sur les autres (Spotify, Deezer, YouTube Music).
 * Les adresses sont construites ici (jamais reprises d'un autre utilisateur).
 * @returns {Array<{ key, label, href, original }>}
 */
export function musicTargets({ url, service, title }) {
  const q = encodeURIComponent(String(title || '').trim().slice(0, 120));
  const search = {
    spotify: q && `https://open.spotify.com/search/${q}`,
    deezer:  q && `https://www.deezer.com/search/${q}`,
    youtube: q && `https://music.youtube.com/search?q=${q}`,
  };
  const out = ['spotify', 'deezer', 'youtube'].map((key) => ({
    key, label: MUSIC_SERVICES[key].label,
    href: key === service ? url : search[key],
    original: key === service,
  }));
  if (service === 'apple') out.unshift({ key: 'apple', label: 'Apple Music', href: url, original: true });
  return out.filter((t) => t.href);
}

/**
 * Valide un lien de partage musical. Accepte un texte collé contenant le lien
 * (ex. « Écoute ce titre sur Deezer : https://… »).
 * @returns {{ url: string, service: string } | null}
 */
export function detectMusic(text) {
  const m = String(text || '').match(/https:\/\/[^\s<>"']+/i);
  if (!m) return null;
  let u;
  try { u = new URL(m[0]); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  const service = Object.keys(MUSIC_SERVICES).find((k) => MUSIC_SERVICES[k].hosts.includes(host));
  if (!service) return null;
  const url = u.toString();
  return url.length <= 300 ? { url, service } : null;
}

export function shareMusic(me, { url, service, title }) {
  const ref = doc(collection(db, 'activity', me.uid, 'posts'));
  const data = {
    type: 'music',
    name: (me.displayName || 'Utilisateur').slice(0, 120),
    url,
    service,
    title: String(title || '').trim().slice(0, 120),
    at: serverTimestamp(),
    likes: [],
  };
  return setDoc(ref, data).then(() => { setLastPost(me.uid, ref, data); toast('Son partagé avec tes amis 🎵'); })
    .catch((err) => { console.error(err); toast('Partage impossible.', { type: 'error' }); });
}

/** Dernières publications d'un utilisateur (5 par défaut). */
export function watchPosts(uid, cb, n = 5) {
  const q = query(collection(db, 'activity', uid, 'posts'), orderBy('at', 'desc'), limit(n));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, owner: uid, ...d.data({ serverTimestamps: 'estimate' }) }))),
    () => cb([]));
}

export function toggleLike(meUid, post) {
  const liked = (post.likes || []).includes(meUid);
  return updateDoc(doc(db, 'activity', post.owner, 'posts', post.id), { likes: liked ? arrayRemove(meUid) : arrayUnion(meUid) })
    .catch((err) => { console.error(err); toast('Action impossible.', { type: 'error' }); });
}

/** Supprime MA publication, et sa copie dans mon activité (accueil des amis). */
export async function deletePost(meUid, post) {
  await deleteDoc(doc(db, 'activity', meUid, 'posts', post.id));
  const act = await getDoc(doc(db, 'activity', meUid)).catch(() => null);
  const a = act?.exists() ? act.data() : {};
  const patch = {};
  if (a.lastPost?.id === post.id) patch.lastPost = {};
  if (a.lastMusic?.id === post.id) patch.lastMusic = {};
  // updateDoc (et non merge) : remplace vraiment la copie par une valeur vide.
  if (Object.keys(patch).length) await updateDoc(doc(db, 'activity', meUid), patch);
}

/** Likes actuels d'une publication (lecture unique, pour l'aperçu de l'accueil). */
export async function fetchLikes(owner, id) {
  const snap = await getDoc(doc(db, 'activity', owner, 'posts', id));
  return snap.exists() ? (snap.data().likes || []) : [];
}

/**
 * Titre d'un son, retrouvé depuis son lien (pour pré-remplir le partage).
 *  • Spotify : oEmbed officiel (titre) ;  • YouTube Music : oEmbed YouTube ;
 *  • Apple Music : API iTunes (artiste – titre).
 * Deezer n'autorise pas ces requêtes depuis un site : titre à saisir.
 * 4 s maximum ; renvoie '' si rien trouvé (jamais d'erreur).
 */
export async function fetchMusicTitle(url, service) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  const get = async (u) => (await fetch(u, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })).json();
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  try {
    if (service === 'spotify' && /open\.spotify\.com$/.test(new URL(url).hostname)) {
      return clean((await get(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`)).title);
    }
    if (service === 'youtube') {
      const d = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
      return clean(d.title);
    }
    if (service === 'apple') {
      const u = new URL(url);
      const id = u.searchParams.get('i') || (u.pathname.match(/\/(\d+)(?:\/)?$/) || [])[1];
      const country = (u.pathname.split('/')[1] || 'fr').slice(0, 2);
      if (!id) return '';
      const r = (await get(`https://itunes.apple.com/lookup?id=${id}&country=${country}`)).results?.[0];
      return r ? clean(`${r.artistName} – ${r.trackName || r.collectionName}`) : '';
    }
  } catch { /* hors ligne, lien court, refus : saisie manuelle */ } finally { clearTimeout(timer); }
  return '';
}
