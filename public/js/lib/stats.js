/**
 * Statistiques d'entraînement calculées à partir du carnet de charges
 * (state.exlogs : { [exerciseId]: [{ ts, d:'YYYY-MM-DD', w, r, k?, rir? }] }).
 *
 * Volume = Σ charge × répétitions ; séries = nombre de lignes du carnet.
 * Record = nouveau meilleur 1RM estimé (Epley) d'un exercice.
 * Calculs purs, sans écriture : appelés à chaque rendu de l'accueil.
 */
import { state } from '../store.js';
import { localISODate } from './dates.js';

export const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

/** Lundi (00:00 local) de la semaine décalée de `offset` semaines (0 = en cours). */
export function mondayOf(offset = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

/** Bornes ISO [lundi, dimanche] d'une semaine. */
export function weekBounds(offset = 0) {
  const a = mondayOf(offset);
  const b = new Date(a); b.setDate(a.getDate() + 6);
  return [localISODate(a), localISODate(b)];
}

/** Nom de chaque exercice connu (tous programmes confondus). */
export function exerciseNames() {
  const names = {};
  for (const prof of Object.values(state.workouts || {})) {
    for (const s of prof?.sessions || []) {
      for (const e of s.exercises || []) if (e?.id) names[e.id] = e.n;
    }
  }
  return names;
}

/** Volume et séries d'une semaine (offset 0 = en cours). */
export function weekLoad(offset = 0, logs = state.exlogs) {
  const [a, b] = weekBounds(offset);
  let volume = 0;
  let sets = 0;
  for (const arr of Object.values(logs || {})) {
    for (const x of arr || []) {
      if (x.d >= a && x.d <= b) { volume += (Number(x.w) || 0) * (Number(x.r) || 0); sets += 1; }
    }
  }
  return { volume, sets };
}

/** Série des n dernières semaines (la plus ancienne d'abord). */
export function weeklySeries(n = 8) {
  return Array.from({ length: n }, (_, i) => {
    const offset = i - (n - 1);
    return { offset, ...weekLoad(offset) };
  });
}

/**
 * Records personnels récents : pour chaque exercice, la dernière série qui a
 * battu le meilleur 1RM estimé précédent (dans les `days` derniers jours).
 * À défaut de record récent : les meilleures performances tous temps.
 * @returns {{ recent: boolean, list: { eid, name, w, r, e1rm, d, gain }[] }}
 */
export function personalRecords(max = 3, days = 45) {
  const names = exerciseNames();
  const cutoff = localISODate(new Date(Date.now() - days * 86400000));
  const recent = [];
  const best = [];
  for (const [eid, arr] of Object.entries(state.exlogs || {})) {
    const list = [...(arr || [])].filter((x) => x.k !== 'drop' && x.w > 0 && x.r > 0).sort((a, b) => a.ts - b.ts);
    if (!list.length) continue;
    let top = 0;
    let lastPr = null;
    for (const x of list) {
      const v = e1rm(x.w, x.r);
      if (v > top + 1e-9) {
        if (top > 0) lastPr = { ...x, e1rm: v, gain: v - top };
        top = v;
      }
    }
    const name = names[eid];
    if (!name) continue;   // exercice supprimé : on ne l'affiche pas
    const bestSet = list.reduce((b, x) => (e1rm(x.w, x.r) > e1rm(b.w, b.r) ? x : b), list[0]);
    best.push({ eid, name, w: bestSet.w, r: bestSet.r, e1rm: e1rm(bestSet.w, bestSet.r), d: bestSet.d, gain: 0 });
    if (lastPr && lastPr.d >= cutoff) recent.push({ eid, name, w: lastPr.w, r: lastPr.r, e1rm: lastPr.e1rm, d: lastPr.d, gain: lastPr.gain, ts: lastPr.ts });
  }
  if (recent.length) return { recent: true, list: recent.sort((a, b) => b.ts - a.ts).slice(0, max) };
  return { recent: false, list: best.sort((a, b) => b.e1rm - a.e1rm).slice(0, max) };
}

/** Séances cochées cette semaine, par jour ISO (1 = lundi) — pour la frise de la semaine. */
export function doneWeekdays(pid) {
  const out = new Set();
  for (const [k, v] of Object.entries(state.week || {})) {
    if (!k.startsWith(`${pid}_sess_`) || !v?.done) continue;
    if (v.ts) out.add(((new Date(v.ts).getDay() + 6) % 7) + 1);
  }
  return out;
}

/** Volume lisible : 12 450 → « 12,4 t » ; 850 → « 850 kg ». */
export function formatVolume(kg, num) {
  if (kg >= 10000) return { value: num(kg / 1000, 1), unit: 't' };
  if (kg >= 1000) return { value: num(kg / 1000, 2), unit: 't' };
  return { value: String(Math.round(kg)), unit: 'kg' };
}

