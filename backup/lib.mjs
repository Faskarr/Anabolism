/**
 * Outils communs à la sauvegarde et à la restauration (Firebase Admin SDK).
 *
 * Format du fichier de sauvegarde (JSON compressé .json.gz) :
 *   { version: 1, project, createdAt, counts: { docs }, docs: { "chemin/du/doc": { ...champs } } }
 * Les types Firestore sont encodés pour survivre au JSON :
 *   Timestamp → { "__ts": millisecondes }   Référence → { "__ref": "chemin" }
 *   GeoPoint  → { "__geo": [lat, lng] }      Octets    → { "__bytes": base64 }
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = join(HERE, 'sauvegardes');
export const KEY_FILE = join(HERE, 'service-account.json');

/** Connexion avec la clé de compte de service (jamais commitée : voir .gitignore). */
export function connect() {
  if (!existsSync(KEY_FILE)) {
    throw new Error(`Clé introuvable : ${KEY_FILE}\n` +
      '→ Console Firebase › ⚙ Paramètres du projet › Comptes de service › « Générer une nouvelle clé privée »,\n' +
      '  puis enregistre le fichier sous ce nom exact : backup/service-account.json');
  }
  const key = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  initializeApp({ credential: cert(key), projectId: key.project_id });
  return { db: getFirestore(), project: key.project_id };
}

/** Valeur Firestore → valeur JSON (récursif). */
export function encode(v) {
  if (v === null || v === undefined) return v ?? null;
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof GeoPoint) return { __geo: [v.latitude, v.longitude] };
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('base64') };
  if (Array.isArray(v)) return v.map(encode);
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

/** Valeur JSON → valeur Firestore (inverse de encode). */
export function decode(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => decode(x, db));
  const keys = Object.keys(v);
  if (keys.length === 1) {
    if (keys[0] === '__ts') return Timestamp.fromMillis(v.__ts);
    if (keys[0] === '__geo') return new GeoPoint(v.__geo[0], v.__geo[1]);
    if (keys[0] === '__ref') return db.doc(v.__ref);
    if (keys[0] === '__bytes') return Buffer.from(v.__bytes, 'base64');
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x, db)]));
}

/** Horodatage lisible pour les noms de fichiers : 2026-10-07_2240. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
