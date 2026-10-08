/**
 * Format d'échange AnabolicOS (import / export / envois admin).
 *
 * v3 (ancienne app) : { v:'3', at, workouts?, diet?, protocol?, weights?, counterBase?, exlogs? }
 *                      → un seul profil par catégorie.
 * v4 (nouvelle)     : mêmes clés que v3 (l'ancienne app peut donc le lire) +
 *                      name?      nom du profil partagé
 *                      all?       { workout:[{name,data}], diet:[…], protocol:[…] }  sauvegarde complète
 *                      sessions[].weekdays / days[].weekdays  (1 = lundi … 7 = dimanche)
 *
 * TOUT ce qui entre passe par `parseImport` : types forcés, longueurs bornées,
 * champs inconnus ignorés. Les chaînes ne sont jamais interprétées comme du HTML
 * (affichage via h()), mais on borne quand même pour protéger Firestore (1 Mio/doc).
 */
import { uid } from './ids.js';
import { normalizeGoals } from '../data/goals.js';

import { T } from './i18n.js';
export const FORMAT_VERSION = '4';
const MAX_CHARS = 900_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Primitives ──────────────────────────────────────────────────────────
const str = (v, max = 120) => (v == null ? '' : String(v)).trim().slice(0, max);
const num = (v, min, max) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};
const int = (v, min, max) => { const n = num(v, min, max); return n == null ? null : Math.round(n); };
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
const id = (v, prefix) => {
  const s = str(v, 60).replace(/[^A-Za-z0-9_-]/g, '');
  return s || uid(prefix);
};
const weekdays = (v) => {
  const days = [...new Set(arr(v).map((d) => int(d, 1, 7)).filter(Boolean))].sort();
  return days.length ? days : undefined;
};
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ── Normaliseurs par type ───────────────────────────────────────────────
export function normalizeWorkout(raw) {
  return {
    sessions: arr(raw?.sessions).slice(0, 30).map((s) => compact({
      id: id(s?.id, 'ses'),
      name: str(s?.name, 60) || 'Séance',
      weekdays: weekdays(s?.weekdays),
      exercises: arr(s?.exercises).slice(0, 60).map((e) => ({
        id: id(e?.id, 'e'),
        n: str(e?.n ?? e?.name, 120) || 'Exercice',
        s: str(e?.s ?? e?.sets, 40) || '—',
        r: str(e?.r ?? e?.rest, 20) || '—',
        no: str(e?.no ?? e?.note, 300),
        ...(e?.ss === true ? { ss: true } : {}),   // superset avec l'exercice précédent
        ...(['drop', 'up'].includes(e?.m) ? { m: e.m } : {}),   // séries dégressives / montantes
        ...(['drop', 'up'].includes(e?.m) && str(e?.dw, 60) ? { dw: str(e.dw, 60) } : {}),   // charges prévues « 20 / 18 / 16 »
      })),
    })),
  };
}

export function normalizeDiet(raw) {
  const m = raw?.macros || {};
  return {
    objective: int(raw?.objective, 0, 20000) || 0,
    macros: { p: int(m.p, 0, 2000) || 0, g: int(m.g, 0, 2000) || 0, l: int(m.l, 0, 2000) || 0 },
    meals: arr(raw?.meals).slice(0, 20).map((meal) => compact({
      id: id(meal?.id, 'm'),
      name: str(meal?.name, 60) || 'Repas',
      time: /^\d{2}:\d{2}$/.test(str(meal?.time, 5)) ? str(meal.time, 5) : undefined,
      supplements: arr(meal?.supplements).slice(0, 20).map((x) => ({
        id: id(x?.id, 'sup'), name: str(x?.name, 80) || 'Complément', dose: str(x?.dose, 40),
      })),
      foods: arr(meal?.foods).slice(0, 60).map((f) => compact({
        id: id(f?.id, 'f'),
        name: str(f?.name, 120) || 'Aliment',
        qty: str(f?.qty, 40),
        cal: int(f?.cal, 0, 20000) || 0,
        p: num(f?.p, 0, 2000) ?? undefined,
        g: num(f?.g, 0, 2000) ?? undefined,
        l: num(f?.l, 0, 2000) ?? undefined,
      })),
    })),
  };
}

export function normalizeProtocol(raw) {
  return {
    // Catalogue de produits (nouveau format) ; absent des anciennes données.
    products: arr(raw?.products).slice(0, 60).map((p) => ({
      id: id(p?.id, 'prd'),
      name: str(p?.name, 120) || 'Produit',
      dose: str(p?.dose, 120),
      color: /^#[0-9a-f]{6}$/i.test(str(p?.color, 7)) ? str(p.color, 7) : undefined,
    })).map(compact),
    days: arr(raw?.days).slice(0, 31).map((d) => compact({
      id: id(d?.id, 'day'),
      name: str(d?.name, 60) || 'Jour',
      label: str(d?.label, 60),
      weekdays: weekdays(d?.weekdays) ?? guessWeekdays(d?.name),
      auto: d?.auto === true ? true : undefined,   // groupe créé automatiquement (par jours de prise)
      injections: arr(d?.injections).slice(0, 30).map((i) => ({
        id: id(i?.id, 'inj'),
        name: str(i?.name, 120) || 'Produit',
        type: str(i?.type, 120),
        time: str(i?.time, 40),
        ...(i?.pid ? { pid: id(i.pid, 'prd') } : {}),
      })),
    })),
  };
}

/** « Lundi » → [1] : rattache automatiquement les anciens jours nommés. */
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export function guessWeekdays(name) {
  const n = str(name).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const found = DAY_NAMES.map((d, i) => (n.includes(d) ? i + 1 : 0)).filter(Boolean);
  return found.length ? found : undefined;
}

function normalizeWeights(raw) {
  // Hors bornes = rejeté (pas ramené à la borne : 999 kg n'est pas « 400 kg »).
  return arr(raw)
    .map((e) => ({ date: str(e?.date, 10), kg: num(e?.kg, -Infinity, Infinity) }))
    .filter((e) => DATE_RE.test(e.date) && e.kg != null && e.kg >= 20 && e.kg <= 400)
    .map((e) => ({ date: e.date, kg: Math.round(e.kg * 10) / 10 }));
}

function normalizeExlogs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [eid, entries] of Object.entries(raw).slice(0, 2000)) {
    const clean = arr(entries).map((e) => ({
      ts: int(e?.ts, 0, 4102444800000),
      d: str(e?.d, 10),
      w: num(e?.w, 0, 1000),
      r: int(e?.r, 1, 1000),
      ...([0, 1, 2].includes(e?.rir) ? { rir: e.rir } : {}),
      ...(e?.k === 'drop' ? { k: 'drop' } : {}),
    })).filter((e) => e.ts && DATE_RE.test(e.d) && e.w != null && e.r);
    if (clean.length) out[id(eid, 'e')] = clean;
  }
  return out;
}

const NORMALIZERS = { workout: normalizeWorkout, diet: normalizeDiet, protocol: normalizeProtocol };
const V3_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };

/**
 * Valide et normalise un texte importé.
 * @returns {{ bundle: object, summary: string[] }}
 * @throws Error avec un message lisible par l'utilisateur
 */
export function parseImport(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Colle un code ou choisis un fichier.');
  if (raw.length > MAX_CHARS) throw new Error('Fichier trop volumineux.');

  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Ce n'est pas un code AnabolicOS valide (JSON illisible)."); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Format non reconnu.');

  const bundle = { name: str(data.name, 60) || null };
  const summary = [];

  for (const cat of Object.keys(NORMALIZERS)) {
    if (data[V3_KEY[cat]]) bundle[cat] = NORMALIZERS[cat](data[V3_KEY[cat]]);
  }
  if (bundle.workout) summary.push(T`Programme · ${bundle.workout.sessions.length} séance(s)`);
  if (bundle.diet) summary.push(T`Diet · ${bundle.diet.meals.length} repas`);
  if (bundle.protocol) summary.push(T`Protocole · ${bundle.protocol.days.length} jour(s)`);

  if (data.all && typeof data.all === 'object') {
    bundle.all = {};
    for (const cat of Object.keys(NORMALIZERS)) {
      bundle.all[cat] = arr(data.all[cat]).slice(0, 50).map((p) => ({
        name: str(p?.name, 60) || 'Profil',
        data: NORMALIZERS[cat](p?.data),
      }));
    }
    const n = Object.values(bundle.all).reduce((a, l) => a + l.length, 0);
    if (n) summary.push(T`Sauvegarde complète · ${n} profil(s)`);
  }

  if (data.weights) {
    bundle.weights = normalizeWeights(data.weights);
    if (bundle.weights.length) summary.push(T`Poids · ${bundle.weights.length} pesée(s)`);
  }
  if (data.counterBase != null) {
    bundle.counterBase = int(data.counterBase, 0, 100000) ?? 0;
    summary.push(T`Compteur · ${bundle.counterBase}`);
  }
  if (data.goals) {
    bundle.goals = normalizeGoals(data.goals);
    if (bundle.goals.items.length) summary.push(T`Objectifs · ${bundle.goals.items.length}`);
    else delete bundle.goals;
  }
  if (data.exlogs) {
    bundle.exlogs = normalizeExlogs(data.exlogs);
    const n = Object.values(bundle.exlogs).reduce((a, l) => a + l.length, 0);
    if (n) summary.push(T`Carnet de charges · ${n} entrée(s)`);
  }

  if (!summary.length) throw new Error('Aucune donnée AnabolicOS trouvée dans ce code.');
  return { bundle, summary };
}

/**
 * Construit un export.
 * @param {object} opts
 * @param {{cat:string, name:string, data:object}[]} [opts.profiles]  profils simples (1 par catégorie max)
 * @param {object} [opts.all]  sauvegarde complète
 */
export function buildExport({ profiles = [], all, weights, counterBase, exlogs, goals }) {
  const out = { v: FORMAT_VERSION, at: new Date().toISOString(), app: 'AnabolicOS' };
  if (profiles.length === 1) out.name = profiles[0].name;
  for (const p of profiles) out[V3_KEY[p.cat]] = p.data;
  if (all) out.all = all;
  if (weights) out.weights = weights;
  if (counterBase != null) out.counterBase = counterBase;
  if (exlogs) out.exlogs = exlogs;
  if (goals?.items?.length) out.goals = goals;
  return JSON.stringify(out, null, 2);
}
