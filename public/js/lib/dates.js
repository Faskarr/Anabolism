/**
 * Dates LOCALES (heure de l'iPhone).
 *
 * Corrige le bug de l'ancienne app qui utilisait toISOString() — date UTC —
 * et enregistrait la veille pour toute saisie entre minuit et 1 h/2 h en France.
 */
import { locale, isEn, num } from './i18n.js';

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' dans le fuseau local. */
export function localISODate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Lundi de la semaine en cours, au format 'YYYYMMDD' (même format que l'ancienne app). */
export function weekKey(d = new Date()) {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}${pad(monday.getMonth() + 1)}${pad(monday.getDate())}`;
}

/** 1 = lundi … 7 = dimanche (convention ISO, utilisée pour `weekdays`). */
export function isoWeekday(d = new Date()) {
  return ((d.getDay() + 6) % 7) + 1;
}

/** Salutation selon l'heure. */
export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

const SHORT_DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const SHORT_DAYS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Initiales des jours (lundi → dimanche) dans la langue de l'app. */
export const dayLetters = () => (isEn() ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['L', 'M', 'M', 'J', 'V', 'S', 'D']);

/** [1, 4] → « Lun · Jeu » */
export function formatWeekdays(days) {
  const names = isEn() ? SHORT_DAYS_EN : SHORT_DAYS;
  return (days || []).map((d) => names[d - 1]).filter(Boolean).join(' · ');
}

/** 'YYYY-MM-DD' → Date à midi local (évite les décalages de fuseau). */
export function parseISODate(s) {
  return new Date(`${s}T12:00:00`);
}

/** Format court (langue de l'app) : « lun. 6 oct. » / « Mon, Oct 6 » */
export function formatShortDate(input, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const d = typeof input === 'string' ? parseISODate(input) : new Date(input);
  return d.toLocaleDateString(locale(), opts);
}

/** Nombre de jours entre deux dates ISO (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

/** Formate un nombre selon la langue : 82.5 → « 82,5 » (FR) / « 82.5 » (EN). */
export function frNum(n, decimals = 1) {
  return num(n, decimals);
}
