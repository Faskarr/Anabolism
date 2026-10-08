/**
 * Écritures Firestore — SEUL module (avec auth.js) qui écrit des données.
 *
 * Stratégie :
 *  1. mise à jour locale immédiate de `state` + emit() → UI instantanée ;
 *  2. écriture Firestore en arrière-plan (jamais attendue par l'UI) :
 *     hors ligne, elle est mise en file par le cache persistant et part au
 *     retour du réseau (corrige le bug « modale bloquée hors ligne ») ;
 *  3. en cas d'échec réel (droits, quota), toast d'erreur — plus d'échec silencieux.
 *
 * Granularité : on n'écrit QUE le profil modifié (`mergeFields: [pid]`) au lieu
 * de réécrire tout le document → deux appareils qui modifient deux profils
 * différents ne s'écrasent plus.
 */
import { db, fs } from '../firebase.js';
import { state, emit, CATS, activeProfileId, isSynced, afterSync, rollWeekIfNeeded } from '../store.js';
import { localISODate } from '../lib/dates.js';
import { uid as newId } from '../lib/ids.js';
import { toast } from '../ui/toast.js';
import { periodKey, prune as pruneGoals } from './goals.js';

import { T } from '../lib/i18n.js';
const { doc, setDoc, updateDoc, deleteField, arrayUnion, arrayRemove, FieldPath } = fs;

const DATA_KEY = { workout: 'workouts', diet: 'diet', protocol: 'protocol' };

const dataRef = (name) => doc(db, 'users', state.uid, 'data', name);
const weekRef = () => doc(db, 'users', state.uid, 'weeks', state.weekKey);

/**
 * Lance une écriture sans bloquer l'UI ; signale les échecs.
 * `run` est une fonction : une erreur levée immédiatement (chemin invalide…)
 * est aussi signalée, au lieu de passer inaperçue.
 */
function write(run, label) {
  let p;
  try { p = run(); } catch (err) { p = Promise.reject(err); }
  p.catch((err) => {
    console.error(`[repo] ${label}`, err);
    toast(T`Échec de l'enregistrement (${label}). Vérifie ta connexion.`, { type: 'error' });
  });
}

const clone = (v) => (v == null ? v : structuredClone(v));

/**
 * Protection anti-écrasement : une opération qui réécrit tout un document (ou
 * tout un profil) attend que ce document ait été reçu de Firestore. Au
 * démarrage, l'écran affiche une copie locale qui peut être incomplète ou plus
 * ancienne : écrire à partir d'elle effacerait des données plus récentes.
 * Renvoie une fonction d'annulation valable même si l'opération est différée.
 */
function guarded(docs, run) {
  if (docs.every(isSynced)) return run() || (() => {});
  let undo = null;
  let cancelled = false;
  afterSync(docs, () => { if (!cancelled) undo = run() || null; });
  return () => { if (undo) undo(); else cancelled = true; };
}

// ── Profils ─────────────────────────────────────────────────────────────

/** N'écrit QUE la catégorie touchée : l'admin et l'utilisateur ne s'écrasent plus. */
function saveProfiles(cat) {
  write(() => setDoc(dataRef('profiles'), { [cat]: clone(state.profiles[cat]) }, { mergeFields: [new FieldPath(cat)] }), 'profils');
}

export function setActiveProfile(cat, pid) {
  guarded(['profiles'], () => {
    state.profiles[cat].active = pid;
    emit();
    saveProfiles(cat);
  });
}

/** Crée un profil vide (ou avec des données) et le rend actif. Renvoie son id. */
export function createProfile(cat, name, data = null) {
  const pid = newId('p');
  guarded(['profiles', DATA_KEY[cat]], () => {
    state.profiles[cat].list.push({ id: pid, name });
    state.profiles[cat].active = pid;
    if (data) setProfileDataLocal(cat, pid, data);
    emit();
    saveProfiles(cat);
    if (data) persistProfileData(cat, pid);
  });
  return pid;
}

export function renameProfile(cat, pid, name) {
  guarded(['profiles'], () => {
    const p = state.profiles[cat].list.find((x) => x.id === pid);
    if (!p) return;
    p.name = name;
    emit();
    saveProfiles(cat);
  });
}

/**
 * Supprime un profil et ses données. Renvoie une fonction d'annulation
 * (utilisée par le toast « Annuler »).
 */
export function deleteProfile(cat, pid) {
  return guarded(['profiles', DATA_KEY[cat]], () => {
    const prof = state.profiles[cat];
    const index = prof.list.findIndex((x) => x.id === pid);
    if (index < 0) return null;
    const removed = prof.list[index];
    const wasActive = prof.active === pid;
    const data = clone(state[DATA_KEY[cat]]?.[pid]);

    prof.list.splice(index, 1);
    if (wasActive) prof.active = prof.list[0]?.id || null;
    if (state[DATA_KEY[cat]]) delete state[DATA_KEY[cat]][pid];
    emit();
    saveProfiles(cat);
    write(() => setDoc(dataRef(DATA_KEY[cat]), { [pid]: deleteField() }, { merge: true }), 'suppression');

    return function undo() {
      prof.list.splice(Math.min(index, prof.list.length), 0, removed);
      if (wasActive) prof.active = pid;
      if (data) setProfileDataLocal(cat, pid, data);
      emit();
      saveProfiles(cat);
      if (data) persistProfileData(cat, pid);
    };
  });
}

// ── Données d'un profil (programme / diet / protocole) ──────────────────

function setProfileDataLocal(cat, pid, data) {
  const key = DATA_KEY[cat];
  if (!state[key]) state[key] = {};
  state[key][pid] = data;
}

function persistProfileData(cat, pid) {
  const key = DATA_KEY[cat];
  write(
    () => setDoc(dataRef(key), { [pid]: clone(state[key][pid]) }, { mergeFields: [new FieldPath(pid)] }),
    { workouts: 'programme', diet: 'diet', protocol: 'protocole' }[key],
  );
}

/**
 * Applique une modification à un profil (actif par défaut).
 * @param {'workout'|'diet'|'protocol'} cat
 * @param {(draft: object) => void} mutate  modifie une copie des données
 * @returns {() => void} fonction d'annulation
 */
export function updateProfileData(cat, mutate, pid = activeProfileId(cat)) {
  if (!pid) return () => {};
  const key = DATA_KEY[cat];
  return guarded([key], () => {
    const before = clone(state[key]?.[pid]) ?? null;
    const defaults = { workout: { sessions: [] }, diet: { objective: 0, macros: { p: 0, g: 0, l: 0 }, meals: [] }, protocol: { days: [] } }[cat];
    const draft = { ...structuredClone(defaults), ...clone(before) };
    mutate(draft);
    setProfileDataLocal(cat, pid, draft);
    emit();
    persistProfileData(cat, pid);

    return function undo() {
      setProfileDataLocal(cat, pid, before ?? structuredClone(defaults));
      emit();
      persistProfileData(cat, pid);
    };
  });
}

// ── Semaine (cases cochées) ─────────────────────────────────────────────

/** Écriture d'UN champ (merge) : sûre même avant la synchro. */
export function setWeekItem(key, value) {
  rollWeekIfNeeded();          // l'app est restée ouverte depuis dimanche ?
  state.week = { ...state.week, [key]: value };
  emit();
  write(() => setDoc(weekRef(), { [key]: value }, { merge: true }), 'semaine');
}

/** Réinitialise TOUTE la semaine (séances + protocole), pas seulement l'écran affiché. */
export function resetWeek() {
  rollWeekIfNeeded();
  return guarded(['week'], () => {
    const before = clone(state.week);
    state.week = {};
    emit();
    write(() => setDoc(weekRef(), {}), 'semaine');
    return function undo() {
      state.week = before;
      emit();
      write(() => setDoc(weekRef(), clone(before)), 'semaine');
    };
  });
}

// ── Compteur ────────────────────────────────────────────────────────────

export function setCounterBase(base) {
  state.counterBase = Math.max(0, Math.round(base) || 0);
  emit();
  write(() => setDoc(dataRef('counter'), { base: state.counterBase }), 'compteur');
}

// ── Poids ───────────────────────────────────────────────────────────────

function persistWeights() {
  const log = clone(state.weights);
  write(() => setDoc(dataRef('weights'), { log }), 'poids');
  // Dénormalisation pour la liste admin (évite de lire tout l'historique).
  const last = log[log.length - 1];
  write(() => updateDoc(doc(db, 'users', state.uid), {
    lastWeight: last ? last.kg : null,
    lastWeightAt: last ? last.date : null,
  }), 'profil');
}

/** Ajoute ou remplace la pesée d'une date (aujourd'hui par défaut, date LOCALE). */
export function addWeight(kg, date = localISODate()) {
  guarded(['weights'], () => {
    const log = state.weights.filter((e) => e.date !== date);
    log.push({ date, kg: Math.round(kg * 10) / 10 });
    log.sort((a, b) => a.date.localeCompare(b.date));
    state.weights = log;
    emit();
    persistWeights();
  });
}

export function deleteWeight(date) {
  return guarded(['weights'], () => {
    const before = clone(state.weights);
    state.weights = state.weights.filter((e) => e.date !== date);
    emit();
    persistWeights();
    return () => { state.weights = before; emit(); persistWeights(); };
  });
}

export function clearWeights() {
  return guarded(['weights'], () => {
    const before = clone(state.weights);
    state.weights = [];
    emit();
    persistWeights();
    return () => { state.weights = before; emit(); persistWeights(); };
  });
}

/** Fusionne des pesées importées : les dates existantes sont CONSERVÉES. */
export function mergeWeights(entries) {
  const known = new Set(state.weights.map((e) => e.date));
  const n = entries.filter((e) => !known.has(e.date)).length;
  guarded(['weights'], () => {
    const have = new Set(state.weights.map((e) => e.date));
    const added = entries.filter((e) => !have.has(e.date));
    if (!added.length) return;
    state.weights = [...state.weights, ...added].sort((a, b) => a.date.localeCompare(b.date));
    emit();
    persistWeights();
  });
  return n;
}

// ── Carnet de charges ───────────────────────────────────────────────────
// Écritures ATOMIQUES (arrayUnion / arrayRemove) : elles ne dépendent pas de la
// copie locale, donc aucune série enregistrée ailleurs ne peut être écrasée.

const exlogField = (eid, op) => ({ logs: { [eid]: op } });

/**
 * Le carnet tient dans UN document Firestore (limite 1 Mio). Quand il approche
 * ~60 % de cette limite, les séries de plus de 6 mois sont compactées : on ne
 * garde que la meilleure série (1RM estimé) de chaque jour. Les courbes de
 * progression, calculées sur le meilleur 1RM du jour, restent identiques.
 */
const EXLOG_SOFT_LIMIT = 600_000;
const e1rmOf = (x) => (x.r <= 1 ? x.w : x.w * (1 + x.r / 30));
let compactChecked = 0;

function compactExlogs() {
  // Vérification au plus une fois par minute (JSON.stringify d'un gros carnet).
  if (!isSynced('exlogs') || Date.now() - compactChecked < 60_000) return;
  compactChecked = Date.now();
  if (JSON.stringify(state.exlogs).length < EXLOG_SOFT_LIMIT) return;
  const cutoff = localISODate(new Date(Date.now() - 182 * 86400000));
  const next = {};
  for (const [eid, arr] of Object.entries(state.exlogs)) {
    const best = new Map();
    const recent = [];
    for (const x of arr) {
      if (x.d >= cutoff) { recent.push(x); continue; }
      const b = best.get(x.d);
      if (!b || e1rmOf(x) > e1rmOf(b)) best.set(x.d, x);
    }
    next[eid] = [...best.values(), ...recent].sort((a, b) => a.ts - b.ts);
  }
  state.exlogs = next;
  write(() => setDoc(dataRef('exlogs'), { logs: clone(next) }), 'carnet');
}

/** @param {{ rir?: 0|1|2, drop?: boolean, ts?: number }} [opts]  RIR, palier dégressif, horodatage (facultatifs) */
export function addLog(eid, w, r, opts = {}) {
  const entry = { ts: opts.ts || Date.now(), d: localISODate(), w, r };
  if ([0, 1, 2].includes(opts.rir)) entry.rir = opts.rir;
  if (opts.drop) entry.k = 'drop';
  state.exlogs = { ...state.exlogs, [eid]: [...(state.exlogs[eid] || []), entry] };
  emit();
  write(() => setDoc(dataRef('exlogs'), exlogField(eid, arrayUnion(entry)), { merge: true }), 'carnet');
  compactExlogs();
}

export function deleteLog(eid, ts) {
  const entry = (state.exlogs[eid] || []).find((e) => e.ts === ts);
  if (!entry) return () => {};
  const arr = state.exlogs[eid].filter((e) => e !== entry);
  const next = { ...state.exlogs };
  if (arr.length) next[eid] = arr; else delete next[eid];
  state.exlogs = next;
  emit();
  write(() => setDoc(dataRef('exlogs'), exlogField(eid, arrayRemove(entry)), { merge: true }), 'carnet');
  return () => {
    state.exlogs = { ...state.exlogs, [eid]: [...(state.exlogs[eid] || []), entry].sort((a, b) => a.ts - b.ts) };
    emit();
    write(() => setDoc(dataRef('exlogs'), exlogField(eid, arrayUnion(entry)), { merge: true }), 'carnet');
  };
}

/** Fusionne des entrées importées (dédoublonnage par timestamp). */
export function mergeLogs(logsByExercise) {
  let count = 0;
  const next = { ...state.exlogs };
  for (const [eid, entries] of Object.entries(logsByExercise)) {
    const arr = [...(next[eid] || [])];
    const known = new Set(arr.map((e) => e.ts));
    const fresh = entries.filter((e) => !known.has(e.ts));
    if (!fresh.length) continue;
    count += fresh.length;
    next[eid] = [...arr, ...fresh].sort((a, b) => a.ts - b.ts);
    write(() => setDoc(dataRef('exlogs'), exlogField(eid, arrayUnion(...fresh)), { merge: true }), 'carnet');
  }
  state.exlogs = next;
  emit();
  return count;
}

/** Id d'exercice déjà utilisé dans un programme existant ? (détection de collision à l'import) */
export function exerciseIdExists(eid) {
  for (const prog of Object.values(state.workouts || {})) {
    for (const s of prog?.sessions || []) {
      if ((s.exercises || []).some((e) => e.id === eid)) return true;
    }
  }
  return false;
}

// ── Objectifs & habitudes ───────────────────────────────────────────────

/**
 * Modifie les objectifs (liste + cases) puis réécrit le document entier
 * (petit : historique élagué). Renvoie une fonction d'annulation.
 */
export function updateGoals(mutate) {
  return guarded(['goals'], () => {
    const before = clone(state.goals);
    const draft = clone(state.goals) || { items: [], done: {} };
    mutate(draft);
    draft.done = pruneGoals(draft.done);
    state.goals = draft;
    emit();
    write(() => setDoc(dataRef('goals'), clone(draft)), 'objectifs');
    return () => { state.goals = before; emit(); write(() => setDoc(dataRef('goals'), clone(before)), 'objectifs'); };
  });
}

/** Coche / décoche un objectif pour sa période en cours (écriture d'une seule case). */
export function toggleGoal(item, date = new Date()) {
  const key = periodKey(item.period, date);
  const on = !state.goals.done?.[key]?.[item.id];
  const cur = { ...(state.goals.done?.[key] || {}) };
  if (on) cur[item.id] = true; else delete cur[item.id];
  state.goals = { ...state.goals, done: { ...state.goals.done, [key]: cur } };
  emit();
  write(() => setDoc(dataRef('goals'), { done: { [key]: { [item.id]: on ? true : deleteField() } } }, { merge: true }), 'objectifs');
}

// ── Accueil personnalisé ────────────────────────────────────────────────

export function updateHome(next) {
  guarded(['home'], () => {
    state.home = { order: next.order, hidden: next.hidden };
    emit();
    write(() => setDoc(dataRef('home'), clone(state.home)), 'accueil');
  });
}

export { CATS };
