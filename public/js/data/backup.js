/**
 * SAUVEGARDE COMPLÈTE de la base depuis l'app (admin uniquement).
 *
 * Produit un fichier .json.gz au MÊME format que backup/backup.mjs (script PC) :
 *   { version: 1, project, createdAt, counts: { docs }, docs: { "chemin/du/doc": { ...champs } } }
 * → il se restaure avec `node restore.mjs <fichier>` sur le PC.
 *
 * Le SDK web ne sait pas lister les collections : elles sont donc nommées ici.
 *  • ROOTS : collections racines (une requête chacune).
 *  • GROUPS : sous-collections, lues par collectionGroup (une requête pour TOUS les
 *    parents, y compris les documents « fantômes » sans champs).
 * ⚠ Nouvelle collection dans l'app → l'ajouter ici (et dans firestore.rules si
 *   c'est une sous-collection : bloc « Sauvegarde admin »).
 *
 * Lecture seule. Coût : 1 lecture par document (quota gratuit 50 000 / jour).
 */
import { app, db, fs } from '../firebase.js';

const { collection, collectionGroup, getDocs, Timestamp, GeoPoint, DocumentReference, Bytes } = fs;

const ROOTS = ['users', 'conversations', 'friendCodes', 'friendships', 'activity', 'shared', 'avatars', 'config', 'library'];
const GROUPS = ['data', 'weeks', 'inbox', 'messages', 'posts'];
const LAST_KEY = 'backup:last';

/** Valeur Firestore → JSON (types encodés comme le script PC). */
function encode(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (v instanceof Bytes) return { __bytes: v.toBase64() };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = encode(x);
    return out;
  }
  return v;
}

/** 2026-10-07_2240 (heure locale). */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Compression gzip native (iOS 16.4+). Repli : JSON brut, accepté aussi par restore.mjs. */
async function gzip(text) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/**
 * Exporte toute la base.
 * @param {(step: string) => void} onProgress  libellé de l'étape en cours
 * @returns {Promise<{ file: File, count: number, sizeKb: number, byCol: Record<string, number> }>}
 */
export async function exportDatabase(onProgress = () => {}) {
  const docs = {};
  const byCol = {};
  const add = (snap) => {
    for (const d of snap.docs) docs[d.ref.path] = encode(d.data());
  };

  // Requêtes séquentielles : moins de pics réseau sur mobile, progression lisible.
  for (const name of ROOTS) {
    onProgress(name);
    const snap = await getDocs(collection(db, name));
    add(snap);
    byCol[name] = snap.size;
  }
  for (const name of GROUPS) {
    onProgress(name);
    const snap = await getDocs(collectionGroup(db, name));
    add(snap);
    byCol[`…/${name}`] = snap.size;
  }

  const count = Object.keys(docs).length;
  const payload = JSON.stringify({
    version: 1, project: app.options?.projectId || 'anabolic-adc6a', createdAt: new Date().toISOString(), source: 'app', counts: { docs: count }, docs,
  });
  const gz = await gzip(payload);
  const name = `anabolicos-${stamp()}.json${gz ? '.gz' : ''}`;
  const file = gz
    ? new File([gz], name, { type: 'application/gzip' })
    : new File([payload], name, { type: 'application/json' });

  return { file, count, sizeKb: Math.max(1, Math.round(file.size / 1024)), byCol };
}

/**
 * Enregistre le fichier : feuille de partage iOS (« Enregistrer dans Fichiers »),
 * sinon téléchargement classique. DOIT être appelé directement dans un tap
 * (Safari refuse navigator.share hors d'un geste utilisateur récent).
 * @returns {Promise<boolean>} true si enregistré / partagé
 */
export async function saveBackupFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      markSaved();
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false; // l'utilisateur a fermé la feuille
      console.warn('[backup] partage impossible, téléchargement', err);
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name, rel: 'noopener' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  markSaved();
  return true;
}

function markSaved() {
  try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* stockage indisponible */ }
}

/** Date (ms) de la dernière sauvegarde enregistrée depuis CET appareil, ou 0. */
export function lastBackupAt() {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
}

