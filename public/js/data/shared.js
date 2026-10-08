/**
 * Profil visible par les amis : shared/{uid}
 *   { name, note?, share: { sessions, weight, diet, workout, protocol },
 *     sessions?, weight?: { kg, date }, diet?: {...}, workout?: {...}, protocol?: {...}, updatedAt }
 *
 * CONFIDENTIALITÉ : seul ce que l'utilisateur a choisi de partager est ÉCRIT dans
 * ce document (le reste n'existe pas côté serveur, il ne peut donc pas fuiter).
 * Lecture : soi-même, ses amis (amitié acceptée) et l'admin (firestore.rules).
 *
 * Coût : le document n'est réécrit que si son contenu change (comparaison locale),
 * avec un délai de 4 s pour regrouper les modifications.
 */
import { db, fs } from '../firebase.js';
import {
  state, subscribe, afterSync, sessionCount, profileData, activeProfileId,
} from '../store.js';
import { normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';

const { doc, getDoc, setDoc, onSnapshot, serverTimestamp } = fs;

/** Par défaut : seul le nombre de séances est partagé (le reste sur demande). */
export const DEFAULT_SHARE = { sessions: true, weight: false, diet: false, workout: false, protocol: false };
export const SHARE_ITEMS = [
  ['sessions', 'Nombre de séances', 'Total depuis le début'],
  ['workout', 'Mon programme', 'Séances et exercices du programme actif'],
  ['diet', 'Ma diet', 'Calories, macros et repas de la diet active'],
  ['protocol', 'Mon protocole', 'Produits, doses et planning du protocole actif'],
  ['weight', 'Mon poids', 'Dernière pesée'],
];

const ref = (uid) => doc(db, 'shared', uid);

/** JSON à clés triées : comparaison fiable (Firestore ne garde pas l'ordre des clés). */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
const withoutStamp = ({ updatedAt, ...rest }) => rest;

let prefs = null;        // préférences connues (null = pas encore lues)
let note = '';           // note affichée en haut de mon profil
let lastSent = null;     // dernier contenu écrit (JSON stable)
let timer = 0;
let unsub = null;
let uid = null;

function nameOf(cat) {
  const pid = activeProfileId(cat);
  return state.profiles[cat].list.find((p) => p.id === pid)?.name || '';
}

/** Contenu à publier, d'après les préférences (rien de ce qui n'est pas coché). */
function build() {
  const out = { name: String(state.me?.displayName || 'Ami').slice(0, 120), share: { ...prefs } };
  if (note) out.note = note;
  if (prefs.sessions) out.sessions = Math.max(0, Math.round(sessionCount() || 0));
  if (prefs.weight) {
    const last = [...(state.weights || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
    if (last) out.weight = { kg: Number(last.kg) || 0, date: String(last.date || '').slice(0, 10) };
  }
  if (prefs.workout && activeProfileId('workout')) out.workout = { name: nameOf('workout'), ...normalizeWorkout(profileData('workout')) };
  if (prefs.diet && activeProfileId('diet')) out.diet = { name: nameOf('diet'), ...normalizeDiet(profileData('diet')) };
  if (prefs.protocol && activeProfileId('protocol')) out.protocol = { name: nameOf('protocol'), ...normalizeProtocol(profileData('protocol')) };
  return JSON.parse(JSON.stringify(out));   // retire les champs undefined
}

async function publish() {
  timer = 0;
  if (!uid || !prefs || state.uid !== uid) return false;
  const data = build();
  const json = stable(data);
  if (json === lastSent) return true;       // rien n'a changé : aucune écriture
  lastSent = json;
  try {
    await setDoc(ref(uid), { ...data, updatedAt: serverTimestamp() });
    return true;
  } catch (err) {
    lastSent = null;                         // réessaiera au prochain changement
    console.warn('[shared] publication', err);
    return false;
  }
}
const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(publish, ms); };

/** À la connexion : lit les préférences, puis tient le profil partagé à jour. */
export function startSharedPublisher(myUid) {
  stopSharedPublisher();
  uid = myUid;
  afterSync(['profiles', 'workouts', 'diet', 'protocol', 'weights', 'counter', 'week'], async () => {
    if (uid !== myUid) return;
    let current = null;
    try { const s = await getDoc(ref(myUid)); current = s.exists() ? s.data() : null; } catch { /* hors ligne */ }
    if (uid !== myUid) return;
    prefs = { ...DEFAULT_SHARE, ...(current?.share || {}) };
    note = cleanNote(current?.note);
    lastSent = current ? stable(withoutStamp(current)) : null;
    schedule(1500);
    unsub = subscribe(() => schedule(4000));
  });
}

export function stopSharedPublisher() {
  clearTimeout(timer);
  unsub?.(); unsub = null;
  uid = null; prefs = null; lastSent = null; note = '';
}

/** Note de profil : 200 caractères max, sans caractères de contrôle (sauts de ligne gardés). */
export function cleanNote(v) {
  return String(v || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 200);
}
export const myNote = () => note;

/** Enregistre la note affichée en haut de mon profil (vide = aucune). */
export async function setNote(text) {
  note = cleanNote(text);
  if (!prefs) prefs = { ...DEFAULT_SHARE };
  clearTimeout(timer);
  if (!(await publish())) throw new Error('Enregistrement impossible.');
}

export const sharePrefs = () => ({ ...DEFAULT_SHARE, ...(prefs || {}) });

/** Enregistre les choix de partage et publie tout de suite. */
export async function setSharePrefs(next) {
  prefs = { ...DEFAULT_SHARE, ...next };
  clearTimeout(timer);
  if (!(await publish())) throw new Error('Enregistrement impossible.');
}

/** Profil partagé d'un utilisateur (ami ou soi-même), en temps réel. */
export function watchShared(of, cb) {
  return onSnapshot(ref(of),
    (s) => cb(s.exists() ? s.data({ serverTimestamps: 'estimate' }) : null),
    (err) => { console.warn('[shared] lecture', err); cb(null, err); });
}
