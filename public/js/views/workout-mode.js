/**
 * Mode séance — écran plein, pensé pour être lu en pleine série.
 *
 * Priorités visuelles : 1. exercice · 2. poids · 3. répétitions · 4. série
 * en cours · 5. repos · 6. progression de la séance.
 *
 * Déroulé : chaque série est une « étape ». Supersets / circuits : les
 * exercices liés s'enchaînent sans repos, un seul repos après le dernier,
 * puis on repart sur la série suivante du premier exercice.
 * Valider une série l'écrit dans le carnet de charges (addLog, comme avant),
 * lance le repos (grand anneau lumineux) puis passe à l'étape suivante.
 * La progression est gardée sur l'appareil : fermer puis rouvrir reprend
 * exactement où l'on en était (même jour).
 */
import { h } from '../lib/dom.js';
import { localISODate, frNum } from '../lib/dates.js';
import { state } from '../store.js';
import { addLog } from '../data/repo.js';
import { sharePR } from '../data/posts.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { startTimer, stopTimer, onTimer, timerState, parseRest, RestDial } from '../ui/timer.js';
import { suggestLoad, parseRepRange, est1RM, setSessionDone } from './training.js';
import { T, tx, num } from '../lib/i18n.js';

const KEY = (pid, sid) => `wo:${pid}:${sid}`;
const fmtKg = (w) => frNum(w, w % 1 ? ((w * 10) % 1 ? 2 : 1) : 0);

/** Séries prévues d'un exercice (« 4×6–8 » → 4), 3 par défaut. */
const setsOf = (ex) => Math.min(12, parseRepRange(ex.s)?.sets || 3);

/** Étapes de la séance : [{ ex, set, sets, group, k, last }] dans l'ordre d'exécution. */
function buildSteps(exercises) {
  const groups = [];
  exercises.forEach((ex) => { if (ex.ss && groups.length) groups.at(-1).push(ex); else groups.push([ex]); });
  const steps = [];
  groups.forEach((g, gi) => {
    const sets = Math.max(...g.map(setsOf));
    for (let s = 1; s <= sets; s += 1) {
      g.forEach((ex, k) => {
        if (s > setsOf(ex)) return;
        steps.push({ ex, set: s, sets: setsOf(ex), group: gi, k, size: g.length, lastOfRound: k === g.length - 1 || s + 0 > setsOf(g[k + 1]) });
      });
    }
  });
  return steps;
}

/** Repos après une étape : celui du dernier exercice du groupe (défaut 2 min), 0 au sein d'un superset. */
function restAfter(steps, i) {
  const st = steps[i];
  if (!st || i === steps.length - 1) return 0;
  if (!st.lastOfRound) return 0;
  return parseRest(st.ex.r) || 120;
}

/** Valeurs proposées : dernière série du jour → suggestion → dernière séance → plan. */
function initialValues(ex) {
  const logs = state.exlogs[ex.id] || [];
  const today = localISODate();
  const todayLast = [...logs].reverse().find((x) => x.d === today && x.k !== 'drop');
  if (todayLast) return { w: todayLast.w, r: todayLast.r };
  const sug = suggestLoad(ex, logs);
  if (sug) return { w: sug.w, r: sug.r };
  const last = logs.at(-1);
  const range = parseRepRange(ex.s);
  const plan = (String(ex.dw || '').match(/\d+(?:[.,]\d+)?/) || [])[0];
  return { w: last?.w || (plan ? parseFloat(plan.replace(',', '.')) : 0), r: last?.r || range?.max || 10 };
}

let ui = null;   // séance ouverte

function save() {
  if (!ui) return;
  try {
    localStorage.setItem(KEY(ui.pid, ui.session.id), JSON.stringify({
      date: localISODate(), i: ui.i, done: [...ui.done], log: ui.log, at: ui.startedAt, vals: ui.vals,
    }));
  } catch { /* stockage indisponible */ }
}
function restore(pid, sid) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY(pid, sid)));
    return s?.date === localISODate() ? s : null;
  } catch { return null; }
}
function clearSaved(pid, sid) { try { localStorage.removeItem(KEY(pid, sid)); } catch { /* ignoré */ } }

/** Séance en cours (pour afficher « Reprendre » sur l'accueil / Séances). */
export function workoutInProgress(pid, sid) {
  const s = restore(pid, sid);
  return s && s.done?.length ? s : null;
}

/** Ouvre le mode séance (reprend la progression du jour s'il y en a une). */
export function startWorkout(pid, session) {
  const exercises = session.exercises || [];
  if (!exercises.length) { toast('Ajoute d’abord des exercices à cette séance.'); return; }
  close(false);
  const steps = buildSteps(exercises);
  const saved = restore(pid, session.id);
  ui = {
    pid, session, steps,
    i: Math.min(saved?.i ?? 0, steps.length - 1),
    done: new Set(saved?.done || []),
    log: saved?.log || [],                 // séries notées pendant cette séance
    vals: saved?.vals || {},               // { [exId]: { w, r } }
    startedAt: saved?.at || Date.now(),
    phase: saved && saved.done?.length >= steps.length ? 'done' : 'set',
    prs: 0,
  };
  const root = h('div', { class: 'wo', role: 'dialog', 'aria-modal': 'true', 'aria-label': T`Séance ${session.name}` });
  ui.root = root;
  document.documentElement.classList.add('no-scroll', 'wo-open');
  document.body.appendChild(root);
  ui.unsub = onTimer((st) => {
    if (!ui || ui.phase !== 'rest') return;
    ui.dial?.paint(st);
    if (st.finished) setTimeout(() => { if (ui?.phase === 'rest') next(); }, 900);
  });
  render();
}

function close(keep = true) {
  if (!ui) return;
  if (keep) save();
  ui.unsub?.();
  const { root } = ui;
  ui = null;
  document.documentElement.classList.remove('no-scroll', 'wo-open');
  root.classList.add('wo--out');
  setTimeout(() => root.remove(), 320);
  window.dispatchEvent(new Event('app:render'));
}

function go(i) {
  ui.i = Math.max(0, Math.min(ui.steps.length - 1, i));
  ui.phase = 'set';
  stopTimer();
  save();
  render();
}

function next() {
  // Étape suivante non faite (sinon fin de séance).
  const n = ui.steps.findIndex((_, k) => k > ui.i && !ui.done.has(k));
  const any = ui.steps.findIndex((_, k) => !ui.done.has(k));
  if (n >= 0) go(n);
  else if (any >= 0) go(any);
  else { ui.phase = 'done'; stopTimer(); save(); render(); }
}

function validate(w, r) {
  const st = ui.steps[ui.i];
  const ex = st.ex;
  if (!(w > 0 && w < 1000)) { toast('Indique la charge.', { type: 'error' }); return; }
  if (!(r > 0 && r < 1000)) { toast('Indique les répétitions.', { type: 'error' }); return; }
  const prevBest = Math.max(0, ...(state.exlogs[ex.id] || []).filter((x) => x.k !== 'drop').map((x) => est1RM(x.w, x.r)));
  addLog(ex.id, w, r, { ts: Date.now() });
  navigator.vibrate?.(12);
  ui.vals[ex.id] = { w, r };
  ui.done.add(ui.i);
  ui.log.push({ eid: ex.id, w, r });
  if (prevBest > 0 && est1RM(w, r) > prevBest) {
    ui.prs += 1;
    if (state.me) {
      toast(T`Nouveau record ! ${fmtKg(w)} kg × ${r} 🏆`, {
        duration: 7000, action: { label: 'Partager', onClick: () => sharePR(state.me, { exercise: ex.n, w, r }) },
      });
    }
  }
  const rest = restAfter(ui.steps, ui.i);
  const remaining = ui.steps.some((_, k) => !ui.done.has(k));
  if (!remaining) { ui.phase = 'done'; save(); render(); return; }
  if (rest > 0) {
    ui.phase = 'rest';
    save();
    startTimer(rest);
    render();
  } else {
    next();
  }
}

// ── Rendu ───────────────────────────────────────────────────────────────

function Stepper({ value, step, decimals, unit, label, onChange, id }) {
  const input = h('input', {
    class: 'wo__num', id, inputmode: decimals ? 'decimal' : 'numeric', 'aria-label': label, autocomplete: 'off',
    onfocus: () => input.select(),
    onchange: () => { const v = parseFloat(String(input.value).replace(',', '.')); onChange(Number.isFinite(v) ? v : 0); },
  });
  const show = (v) => { input.value = v ? (decimals ? fmtKg(v) : String(Math.round(v))) : ''; input.placeholder = '0'; };
  show(value);
  const bump = (d) => {
    const cur = parseFloat(String(input.value).replace(',', '.')) || 0;
    const v = Math.max(0, Math.round((cur + d) * 100) / 100);
    show(v); onChange(v);
    input.classList.remove('is-bump'); void input.offsetWidth; input.classList.add('is-bump');
    navigator.vibrate?.(6);
  };
  return h('div', { class: 'stepper' },
    h('button', { class: 'stepper__btn', type: 'button', 'aria-label': T`Moins ${label}`, onclick: () => bump(-step()) }, icon('minus', 26)),
    h('label', { class: 'stepper__value', for: id }, input, h('span', { class: 'stepper__unit' }, unit)),
    h('button', { class: 'stepper__btn', type: 'button', 'aria-label': T`Plus ${label}`, onclick: () => bump(step()) }, icon('plus', 26)));
}

function TopBar() {
  const total = ui.steps.length;
  const doneN = ui.done.size;
  const st = ui.steps[ui.i];
  const exIndex = (ui.session.exercises || []).indexOf(st.ex) + 1;
  const exTotal = (ui.session.exercises || []).length;
  return h('header', { class: 'wo__top' },
    h('button', { class: 'icon-btn icon-btn--glass', type: 'button', 'aria-label': 'Fermer (la progression est gardée)', onclick: () => close(true) }, icon('down', 22)),
    h('div', { class: 'wo__title' },
      h('span', { class: 'wo__session' }, ui.session.name),
      h('span', { class: 'wo__count' }, ui.phase === 'done' ? tx('Terminé') : T`Exercice ${exIndex}/${exTotal}`)),
    h('span', { class: 'wo__pct', 'aria-label': T`${doneN} séries sur ${total}` }, `${Math.round((doneN / total) * 100)}%`),
    h('div', { class: 'wo__progress', 'aria-hidden': 'true' }, h('span', { style: { transform: `scaleX(${doneN / total})` } })));
}

function SetView() {
  const st = ui.steps[ui.i];
  const ex = st.ex;
  const v = ui.vals[ex.id] || (ui.vals[ex.id] = initialValues(ex));
  const logs = state.exlogs[ex.id] || [];
  const today = localISODate();
  const prevSession = [...logs].reverse().find((x) => x.d !== today && x.k !== 'drop');
  const sug = suggestLoad(ex, logs);
  const doneSets = ui.steps.map((s, k) => (s.ex === ex ? k : -1)).filter((k) => k >= 0);
  const ssLabel = st.size > 1 ? (st.size > 2 ? T`Circuit · ${String.fromCharCode(65 + st.k)}` : T`Superset · ${String.fromCharCode(65 + st.k)}`) : null;
  const restSec = restAfter(ui.steps, ui.i);

  let w = v.w; let r = v.r;
  const weight = Stepper({ id: 'wo-w', value: w, decimals: true, unit: 'kg', label: 'charge', step: () => (w < 20 ? 1 : 2.5), onChange: (x) => { w = x; v.w = x; } });
  const reps = Stepper({ id: 'wo-r', value: r, decimals: false, unit: 'reps', label: 'répétitions', step: () => 1, onChange: (x) => { r = x; v.r = x; } });

  return h('div', { class: 'wo__body wo__in' },
    h('div', { class: 'wo__ex' },
      h('p', { class: 'eyebrow' }, ssLabel || T`Série ${st.set} sur ${st.sets}`),
      h('h1', { class: 'wo__name' }, ex.n),
      h('p', { class: 'wo__target' }, [ex.s !== '—' ? ex.s : null, ex.r && ex.r !== '—' ? T`repos ${ex.r}` : null].filter(Boolean).join(' · ') || ' '),
      ex.no ? h('p', { class: 'wo__note' }, ex.no) : null),
    h('div', { class: 'wo__sets', role: 'img', 'aria-label': T`Série ${st.set} sur ${st.sets}` },
      doneSets.map((k) => h('span', { class: `wo__set${ui.done.has(k) ? ' is-done' : ''}${k === ui.i ? ' is-now' : ''}` }))),
    h('div', { class: 'wo__inputs' }, weight, h('span', { class: 'wo__times', 'aria-hidden': 'true' }, '×'), reps),
    h('p', { class: 'wo__hint' },
      sug ? [icon(sug.up ? 'up' : 'target', 14), T`Suggéré ${fmtKg(sug.w)} kg × ${sug.r}`] : null,
      sug && prevSession ? h('span', { class: 'wo__dot' }, '·') : null,
      prevSession ? T`Dernière fois ${fmtKg(prevSession.w)} × ${prevSession.r}` : (!sug ? tx('Première fois : prends tes repères') : null)),
    h('div', { class: 'wo__actions' },
      h('button', { class: 'icon-btn icon-btn--glass', type: 'button', 'aria-label': 'Série précédente', disabled: ui.i === 0, onclick: () => go(ui.i - 1) }, icon('back', 22)),
      h('button', { class: 'btn btn--primary wo__go', type: 'button', onclick: () => validate(w, r) },
        icon('check', 20), tx('Valider'),
        restSec ? h('span', { class: 'wo__go-rest', 'aria-label': T`puis repos ${Math.floor(restSec / 60)}:${String(restSec % 60).padStart(2, '0')}` },
          icon('timer', 14), `${Math.floor(restSec / 60)}:${String(restSec % 60).padStart(2, '0')}`) : null),
      h('button', { class: 'icon-btn icon-btn--glass', type: 'button', 'aria-label': 'Passer cette série', disabled: ui.i === ui.steps.length - 1, onclick: () => go(ui.i + 1) }, icon('chevron', 22))));
}

function RestView() {
  const dial = RestDial({ onSkip: () => next(), size: Math.min(280, window.innerWidth - 96) });
  ui.dial = dial;
  const n = ui.steps.findIndex((_, k) => k > ui.i && !ui.done.has(k));
  const nx = n >= 0 ? ui.steps[n] : null;
  const nv = nx ? (ui.vals[nx.ex.id] || initialValues(nx.ex)) : null;
  return h('div', { class: 'wo__body wo__body--rest wo__in' },
    dial.el,
    dial.controls,
    nx ? h('div', { class: 'wo__next' },
      h('span', { class: 'eyebrow' }, 'Ensuite'),
      h('span', { class: 'wo__next-name' }, nx.ex.n),
      h('span', { class: 'wo__next-meta' }, T`Série ${nx.set}/${nx.sets}${nv?.w ? T` · ${fmtKg(nv.w)} kg × ${nv.r}` : ''}`)) : null);
}

function DoneView() {
  const minutes = Math.max(1, Math.round((Date.now() - ui.startedAt) / 60000));
  const volume = ui.log.reduce((a, x) => a + x.w * x.r, 0);
  const already = Boolean(state.week[`${ui.pid}_sess_${ui.session.id}`]?.done);
  const stat = (value, label) => h('div', { class: 'wo__stat' }, h('span', { class: 'wo__stat-v' }, value), h('span', { class: 'wo__stat-l' }, label));
  return h('div', { class: 'wo__body wo__body--done wo__in' },
    h('div', { class: 'wo__trophy' }, h('span', { class: 'rest__halo', 'aria-hidden': 'true' }), icon('check', 44)),
    h('h1', { class: 'wo__done-title' }, 'Séance terminée'),
    h('p', { class: 'wo__target' }, ui.session.name),
    h('div', { class: 'wo__stats' },
      stat(String(ui.log.length), 'séries'),
      stat(volume >= 1000 ? `${num(volume / 1000, 1)} t` : `${Math.round(volume)} kg`, 'volume'),
      stat(`${minutes}′`, 'durée'),
      stat(String(ui.prs), ui.prs > 1 ? 'records' : 'record')),
    h('div', { class: 'wo__done-actions' },
      already ? null : h('button', {
        class: 'btn btn--primary btn--block wo__go', type: 'button',
        onclick: () => { setSessionDone(ui.pid, ui.session, true); toast(T`${ui.session.name} terminée 💪`); clearSaved(ui.pid, ui.session.id); close(false); },
      }, icon('check', 20), 'Valider la séance'),
      h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => { if (already) clearSaved(ui.pid, ui.session.id); close(!already); } }, already ? tx('Fermer') : tx('Plus tard')),
      h('button', { class: 'btn btn--quiet btn--block', type: 'button', onclick: () => { ui.done.clear(); ui.log = []; ui.startedAt = Date.now(); go(0); } }, icon('reset', 16), 'Recommencer')));
}

function render() {
  if (!ui) return;
  ui.dial = null;
  const body = ui.phase === 'rest' && timerState().running ? RestView()
    : ui.phase === 'done' ? DoneView()
      : (ui.phase = 'set', SetView());
  ui.root.replaceChildren(h('span', { class: 'wo__glow', 'aria-hidden': 'true' }), TopBar(), body);
}
