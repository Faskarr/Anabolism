/**
 * Objectifs & habitudes : users/{uid}/data/goals
 *   {
 *     items: [{ id, title, period: 'day' | 'week' | 'month' }],
 *     done:  { 'd:2026-10-06': { [id]: true }, 'w:20261005': {…}, 'm:2026-10': {…} }
 *   }
 * Une case cochée vaut pour la période en cours (jour, semaine ISO, mois).
 * L'historique est élagué automatiquement (≈ 60 jours / 16 semaines / 12 mois)
 * pour que le document reste petit.
 *
 * Lecture/écriture : le propriétaire ; l'admin peut aussi lire et modifier
 * (firestore.rules → docId 'goals').
 */
import { localISODate, weekKey } from '../lib/dates.js';

export const PERIODS = {
  day:   { label: 'Quotidien',    title: 'Aujourd’hui',   short: 'jour' },
  week:  { label: 'Hebdomadaire', title: 'Cette semaine', short: 'semaine' },
  month: { label: 'Mensuel',      title: 'Ce mois-ci',    short: 'mois' },
};
export const PERIOD_ORDER = ['day', 'week', 'month'];

export const emptyGoals = () => ({ items: [], done: {} });

/** Clé de la période contenant la date `d`. */
export function periodKey(period, d = new Date()) {
  if (period === 'week') return `w:${weekKey(d)}`;
  if (period === 'month') return `m:${localISODate(d).slice(0, 7)}`;
  return `d:${localISODate(d)}`;
}

export const isDone = (goals, item, d = new Date()) => Boolean(goals?.done?.[periodKey(item.period, d)]?.[item.id]);

/** Jours consécutifs cochés (habitude quotidienne), aujourd'hui inclus s'il est fait. */
export function streak(goals, item, now = new Date()) {
  if (item.period !== 'day') return 0;
  let n = 0;
  const d = new Date(now);
  if (!isDone(goals, item, d)) d.setDate(d.getDate() - 1); // la journée n'est pas finie
  for (let i = 0; i < 60 && isDone(goals, item, d); i += 1) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/** 7 derniers jours (du plus ancien à aujourd'hui) : true/false. */
export function lastDays(goals, item, n = 7, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (n - 1 - i));
    return isDone(goals, item, d);
  });
}

/** Retire l'historique trop ancien. */
export function prune(done, now = new Date()) {
  const ago = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };
  const minDay = `d:${localISODate(ago(62))}`;
  const minWeek = `w:${weekKey(ago(16 * 7))}`;
  const minMonth = `m:${localISODate(ago(365)).slice(0, 7)}`;
  const out = {};
  for (const [k, v] of Object.entries(done || {})) {
    const keep = k.startsWith('d:') ? k >= minDay : k.startsWith('w:') ? k >= minWeek : k.startsWith('m:') ? k >= minMonth : false;
    if (keep && v && typeof v === 'object' && Object.keys(v).length) out[k] = v;
  }
  return out;
}

/** Normalisation défensive (données lues ou écrites par l'admin). */
export function normalizeGoals(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, 60)
    .map((x) => ({
      id: String(x?.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
      title: String(x?.title || '').trim().slice(0, 100),
      period: PERIODS[x?.period] ? x.period : 'day',
    }))
    .filter((x) => x.id && x.title);
  return { items, done: prune(raw?.done) };
}

/** Résumé d'une période : { total, done }. */
export function progress(goals, period, d = new Date()) {
  const list = (goals?.items || []).filter((x) => x.period === period);
  return { total: list.length, done: list.filter((x) => isDone(goals, x, d)).length };
}
