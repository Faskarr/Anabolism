/**
 * RESTAURATION depuis une sauvegarde.
 *
 *   node restore.mjs                              → liste les sauvegardes disponibles
 *   node restore.mjs <fichier>                    → aperçu (ne modifie RIEN)
 *   node restore.mjs <fichier> --user <UID>       → aperçu pour un seul utilisateur
 *   node restore.mjs <fichier> [--user <UID>] --confirmer   → restaure vraiment
 *
 * • Par défaut : APERÇU seulement. Rien n'est écrit sans --confirmer.
 * • Restaure les documents tels qu'ils étaient (remplace les versions actuelles) ;
 *   les documents créés APRÈS la sauvegarde ne sont pas supprimés.
 * • --user <UID> : uniquement ce compte (users/UID/…, activity/UID/…, shared/UID,
 *   avatars/UID, conversations/UID/…) — idéal après un bug sur un seul compte.
 * • <fichier> : chemin complet, ou simplement son nom (ex. 2026-10-07_2240.json.gz).
 *   Les fichiers créés depuis l'app (anabolicos-….json.gz) se restaurent pareil :
 *   copie-les depuis Fichiers (iCloud Drive) dans backup/sauvegardes.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { connect, decode, BACKUP_DIR } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter((f) => /\.json(\.gz)?$/.test(f)).sort().reverse();
}

/** Le document appartient-il à cet utilisateur ? */
function ownedBy(path, uid) {
  const [col, id] = path.split('/');
  return id === uid && ['users', 'activity', 'shared', 'avatars', 'conversations'].includes(col);
}

async function main() {
  const fileArg = args.find((a) => !a.startsWith('--') && a !== opt('--user'));
  if (!fileArg) {
    const list = listBackups();
    console.log(list.length ? `Sauvegardes disponibles (plus récente en premier) :\n${list.map((f) => `  ${f}`).join('\n')}` : 'Aucune sauvegarde dans backup/sauvegardes.');
    console.log('\nUsage : node restore.mjs <fichier> [--user <UID>] [--confirmer]');
    return;
  }
  const file = existsSync(fileArg) ? fileArg : join(BACKUP_DIR, fileArg);
  if (!existsSync(file)) throw new Error(`Fichier introuvable : ${file}`);

  // .json.gz (script PC / app) ou .json brut (app sans compression) : détecté par l'en-tête gzip.
  const raw = readFileSync(file);
  const data = JSON.parse((raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8'));
  if (data.version !== 1 || !data.docs) throw new Error('Fichier de sauvegarde invalide.');

  const uid = opt('--user');
  let entries = Object.entries(data.docs);
  if (uid) entries = entries.filter(([path]) => ownedBy(path, uid));

  const byCol = {};
  for (const [path] of entries) { const c = path.split('/')[0]; byCol[c] = (byCol[c] || 0) + 1; }
  console.log(`Sauvegarde du ${new Date(data.createdAt).toLocaleString('fr-FR')} · projet ${data.project}`);
  console.log(uid ? `Utilisateur ${uid} :` : 'Toute la base :');
  for (const [c, n] of Object.entries(byCol)) console.log(`  ${c.padEnd(16)} ${n} document(s)`);
  if (!entries.length) { console.log('\nRien à restaurer.'); return; }

  if (!flag('--confirmer')) {
    console.log(`\nAPERÇU uniquement : ${entries.length} document(s) seraient restaurés.`);
    console.log('Ajoute --confirmer pour lancer la restauration.');
    return;
  }

  const { db, project } = connect();
  if (project !== data.project) throw new Error(`La sauvegarde vient du projet « ${data.project} », la clé est celle de « ${project} ».`);

  // Écritures par lots de 400 (limite Firestore : 500 par lot).
  let done = 0;
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    for (const [path, fields] of entries.slice(i, i + 400)) batch.set(db.doc(path), decode(fields, db));
    await batch.commit();
    done += Math.min(400, entries.length - i);
    console.log(`  ${done}/${entries.length}`);
  }
  console.log(`\n✔ ${done} document(s) restauré(s).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✘ Restauration échouée :', err.message);
  process.exit(1);
});
