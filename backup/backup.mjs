/**
 * SAUVEGARDE COMPLÈTE de la base Firestore d'AnabolicOS.
 *
 *   node backup.mjs            → backup/sauvegardes/AAAA-MM-JJ_HHMM.json.gz
 *
 * • Parcourt TOUTES les collections et sous-collections (aucune liste à tenir à jour).
 * • Lecture seule : ne modifie rien dans la base.
 * • Garde les 20 dernières sauvegardes (les plus anciennes sont supprimées).
 * • Coût : 1 lecture Firestore par document (quota gratuit : 50 000 / jour).
 */
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { connect, encode, stamp, BACKUP_DIR } from './lib.mjs';

const KEEP = 20;

/** Lit récursivement une collection et ses sous-collections. */
async function dumpCollection(col, out) {
  const snap = await col.get();
  for (const doc of snap.docs) {
    out[doc.ref.path] = encode(doc.data());
    for (const sub of await doc.ref.listCollections()) await dumpCollection(sub, out);
  }
  // Documents « fantômes » (sans champs mais avec des sous-collections) : on descend aussi.
  for (const ref of await col.listDocuments()) {
    if (out[ref.path] !== undefined) continue;
    for (const sub of await ref.listCollections()) await dumpCollection(sub, out);
  }
}

async function main() {
  const started = Date.now();
  const { db, project } = connect();
  console.log(`Sauvegarde de « ${project} »…`);

  const docs = {};
  for (const col of await db.listCollections()) {
    const before = Object.keys(docs).length;
    await dumpCollection(col, docs);
    console.log(`  ${col.id.padEnd(16)} ${Object.keys(docs).length - before} document(s)`);
  }

  const payload = { version: 1, project, createdAt: new Date().toISOString(), counts: { docs: Object.keys(docs).length }, docs };
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = join(BACKUP_DIR, `${stamp()}.json.gz`);
  writeFileSync(file, gzipSync(JSON.stringify(payload)));

  // Rotation : on garde les KEEP plus récentes.
  const all = readdirSync(BACKUP_DIR).filter((f) => /^\d{4}-.*\.json\.gz$/.test(f)).sort(); // fichiers du script uniquement
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) unlinkSync(join(BACKUP_DIR, old));

  const kb = Math.round(statSync(file).size / 1024);
  console.log(`\n✔ ${payload.counts.docs} documents sauvegardés en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(`  Fichier : ${file} (${kb} Ko)`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\n✘ Sauvegarde échouée :', err.message);
  process.exit(1);
});
