/**
 * Pseudo : nom affiché à la place du nom Google (accueil, amis, publications,
 * messages au coach). Stocké dans users/{uid}.pseudo ; '' = nom Google.
 *
 * Le nouveau nom est aussi recopié là où les autres le lisent déjà :
 *  • activity/{uid}.name        (accueil des amis, publications) ;
 *  • friendships/*.names[uid]   (liste d'amis, discussions) ;
 *  • friendCodes/{code}.name    (nom affiché quand on t'ajoute avec ton code).
 */
import { db, fs } from '../firebase.js';
import { state } from '../store.js';
import { cleanPseudo } from '../auth.js';

const { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, serverTimestamp } = fs;

export async function savePseudo(session, raw) {
  const uid = session.user.uid;
  const pseudo = cleanPseudo(raw);
  if (pseudo && pseudo.length < 2) throw new Error('2 caractères minimum.');
  const name = pseudo || session.user.googleName || session.user.email || 'Utilisateur';

  await updateDoc(doc(db, 'users', uid), { pseudo: pseudo || deleteField() });

  const jobs = [
    setDoc(doc(db, 'activity', uid), { name: name.slice(0, 120) }, { merge: true }),
    ...state.friendships.map((f) => updateDoc(doc(db, 'friendships', f.id), { [`names.${uid}`]: name.slice(0, 120) })),
  ];
  // Code ami : seul l'admin peut le modifier → on le recrée à l'identique avec le nouveau nom.
  const code = session.profile?.friendCode;
  if (code) {
    jobs.push((async () => {
      const ref = doc(db, 'friendCodes', code);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().uid === uid) {
        await deleteDoc(ref);
        await setDoc(ref, { uid, name: name.slice(0, 120), createdAt: serverTimestamp() });
      }
    })());
  }
  const results = await Promise.allSettled(jobs);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.warn('[pseudo] copie', r.reason));

  // Session gardée sur l'appareil : affichée avec le nouveau nom dès le rechargement.
  try {
    const key = `session:${uid}`;
    const c = JSON.parse(localStorage.getItem(key));
    if (c) {
      c.user = { ...c.user, displayName: name, pseudo };
      c.profile = { ...c.profile, pseudo };
      localStorage.setItem(key, JSON.stringify(c));
    }
  } catch { /* ignoré */ }
  return name;
}
