/**
 * UTILISATEUR — envois du coach (programme, diet, protocole).
 * Le contenu reçu repasse par les normaliseurs d'import (jamais utilisé tel quel).
 */
import { db, fs } from '../firebase.js';
import { normalizeWorkout, normalizeDiet, normalizeProtocol } from '../lib/schema.js';
import { applyImport } from './importer.js';
import { toast } from '../ui/toast.js';

import { T } from '../lib/i18n.js';
const { doc, collection, query, where, onSnapshot, updateDoc, serverTimestamp } = fs;

const NORMALIZE = { workout: normalizeWorkout, diet: normalizeDiet, protocol: normalizeProtocol };
export const TYPE_LABEL = { workout: 'Programme', diet: 'Diet', protocol: 'Protocole' };

/** Envois en attente, en temps réel. */
export function watchPendingInbox(uid, cb) {
  const q = query(collection(db, 'users', uid, 'inbox'), where('status', '==', 'pending'));
  return onSnapshot(q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))),
    (err) => { console.warn('[inbox]', err); cb([]); });
}

function close(uid, item, status) {
  return updateDoc(doc(db, 'users', uid, 'inbox', item.id), { status, handledAt: serverTimestamp() })
    .catch((err) => { console.error('[inbox]', err); toast('Action impossible.', { type: 'error' }); });
}

/** Accepte : crée un nouveau profil (actif) avec le contenu envoyé. */
export function acceptItem(uid, item) {
  const normalize = NORMALIZE[item.type];
  if (!normalize || !item.payload) { toast('Envoi vide ou invalide.', { type: 'error' }); return close(uid, item, 'dismissed'); }
  applyImport({ name: item.title || TYPE_LABEL[item.type], [item.type]: normalize(item.payload) }, { [item.type]: true });
  toast(T`${TYPE_LABEL[item.type]} « ${item.title} » ajouté et activé`);
  return close(uid, item, 'accepted');
}

export function dismissItem(uid, item) {
  return close(uid, item, 'dismissed');
}
