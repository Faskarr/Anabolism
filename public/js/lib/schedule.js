/**
 * Horaires du jour : prochain repas, prochaines prises du protocole.
 * Les heures sont en minutes depuis minuit (heure LOCALE).
 */
import { isoWeekday } from './dates.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

/** Mots-clés → heure approximative (minutes). Ordre = priorité. */
const KEYWORDS = [
  [/reveil|\blever\b|\bjeun\b/, 6 * 60 + 30],   // « à jeun » — mais pas « déjeuner »
  [/petit.?dej|breakfast/, 7 * 60 + 30],
  [/pre.?(work|train|seance|entrain)|avant (la )?seance/, 17 * 60],
  [/post.?(work|train|seance|entrain)|apres (la )?seance/, 19 * 60],
  [/matin/, 8 * 60],
  [/midi|dejeuner|lunch/, 12 * 60 + 30],
  [/collation|gouter|snack|apres.?midi/, 16 * 60],
  [/coucher|nuit|dodo/, 22 * 60 + 30],
  [/diner|souper|dinner/, 20 * 60],
  [/soir/, 20 * 60],
];

/**
 * « 08:30 », « 8h », « 8h30 », « Matin », « Avant séance »… → minutes, ou null.
 */
export function parseTimeOfDay(text) {
  const t = norm(text);
  if (!t) return null;
  const m = t.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
  if (m && +m[1] < 24) return (+m[1]) * 60 + (+(m[2] || 0));
  for (const [re, minutes] of KEYWORDS) if (re.test(t)) return minutes;
  return null;
}

export const formatMinutes = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const nowMinutes = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/**
 * Heure d'un repas : champ `time` explicite, sinon déduite du nom, sinon
 * répartition régulière entre 7 h et 21 h selon sa position.
 */
export function mealMinutes(meal, index, count) {
  const explicit = parseTimeOfDay(meal.time);
  if (explicit != null) return explicit;
  const guessed = parseTimeOfDay(meal.name);
  if (guessed != null) return guessed;
  if (count <= 1) return 12 * 60;
  return Math.round(7 * 60 + (index * (14 * 60)) / (count - 1));
}

/**
 * Prochain repas : le premier dont l'heure n'est pas passée depuis plus de
 * 45 min (on considère qu'un repas « en cours » est encore le prochain).
 * Après le dernier repas → premier repas de demain.
 */
export function nextMeal(meals, now = new Date()) {
  if (!meals?.length) return null;
  const timed = meals.map((meal, i) => ({ meal, minutes: mealMinutes(meal, i, meals.length) }))
    .sort((a, b) => a.minutes - b.minutes);
  const cur = nowMinutes(now);
  const next = timed.find((x) => x.minutes >= cur - 45);
  return next ? { ...next, tomorrow: false } : { ...timed[0], tomorrow: true };
}

/**
 * Prochaines prises du protocole (non cochées), aujourd'hui puis demain.
 * @param {object[]} days         jours du protocole actif
 * @param {(item) => boolean} isDone
 * @param {(day) => number[]} weekdaysOf
 */
export function nextProtocolItems(days, isDone, weekdaysOf, n = 2, now = new Date()) {
  const today = isoWeekday(now);
  const tomorrow = (today % 7) + 1;
  const collect = (wd) => days
    .filter((d) => weekdaysOf(d).includes(wd))
    .flatMap((d) => (d.injections || []).map((item) => ({ item, day: d, minutes: parseTimeOfDay(item.time) ?? parseTimeOfDay(d.label) ?? 9 * 60 })))
    .sort((a, b) => a.minutes - b.minutes);

  const todayItems = collect(today);
  const pending = todayItems.filter((x) => !isDone(x.item)).map((x) => ({ ...x, tomorrow: false }));
  const out = pending.slice(0, n);
  if (out.length < n) {
    // Les cases cochées sont hebdomadaires : demain, on ne filtre pas sur « fait ».
    out.push(...collect(tomorrow).slice(0, n - out.length).map((x) => ({ ...x, tomorrow: true })));
  }
  return { items: out, todayTotal: todayItems.length, todayDone: todayItems.length - pending.length };
}
