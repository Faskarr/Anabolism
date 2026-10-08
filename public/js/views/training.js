/**
 * Entraînement : profils, séances (avec jours de la semaine), exercices,
 * séance faite cette semaine, minuteur, carnet de charges.
 */
import { h, mount } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { formatWeekdays, formatShortDate, isoWeekday, frNum, localISODate, dayLetters } from '../lib/dates.js';
import {
  state, activeProfileId, profileData, sessionCount, sessionWeekKey, subscribe, ensureExlogs,
} from '../store.js';
import {
  updateProfileData, setWeekItem, setCounterBase, addLog, deleteLog,
} from '../data/repo.js';
import { publishActivity } from '../data/friends.js';
import { sharePR } from '../data/posts.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, IconButton, SectionTitle } from '../ui/layout.js';
import { formSheet, confirmSheet, actionSheet, openSheet } from '../ui/sheet.js';
import { undoToast, toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { lineChart } from '../ui/chart.js';
import { startTimer, parseRest, showTimer } from '../ui/timer.js';

import { T, isEn } from '../lib/i18n.js';
const CAT = 'workout';

/** Séance sélectionnée (mémorisée entre deux rendus). */
let selectedSid = null;

/** Permet à l'accueil d'ouvrir directement une séance. */
export function selectSession(sid) { selectedSid = sid; }

/**
 * Prochaine séance à faire :
 *  1. une séance prévue AUJOURD'HUI et pas encore cochée ;
 *  2. sinon la première séance du programme (dans l'ordre) pas encore cochée cette semaine ;
 *  3. sinon null (semaine terminée).
 * Cocher une séance la fait donc passer automatiquement à la suivante.
 */
export function nextSession(pid = activeProfileId(CAT)) {
  if (!pid) return { session: null, sessions: [] };
  const sessions = profileData(CAT, pid).sessions || [];
  const today = isoWeekday();
  const isDone = (s) => Boolean(state.week[sessionWeekKey(pid, s.id)]?.done);
  const planned = sessions.find((s) => s.weekdays?.includes(today) && !isDone(s));
  const session = planned || sessions.find((s) => !isDone(s)) || null;
  const todayStr = new Date().toDateString();
  const doneToday = sessions.filter((s) => {
    const ts = state.week[sessionWeekKey(pid, s.id)]?.ts;
    return isDone(s) && ts && new Date(ts).toDateString() === todayStr;
  });
  return { session, plannedToday: Boolean(planned), sessions, doneToday, isDone, pid };
}

/**
 * Coche / décoche une séance ET met à jour l'activité visible par les amis
 * (« s'est entraîné aujourd'hui »).
 */
export function setSessionDone(pid, session, done) {
  setWeekItem(sessionWeekKey(pid, session.id), done ? { done: true, ts: Date.now() } : { done: false, ts: null });
  if (!state.me) return;
  if (done) { publishActivity(state.me, session.name, true); return; }
  // Décoché : reste « entraîné » si une autre séance a été faite aujourd'hui.
  const other = nextSession(pid).doneToday?.find((s) => s.id !== session.id);
  publishActivity(state.me, other?.name, Boolean(other));
}

const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/** Jours de la séance, modifiables d'un tap (plus besoin de passer par un menu). */
function WeekdayPicker(session) {
  const days = new Set(session.weekdays || []);
  return h('div', { class: 'day-picker' },
    h('span', { class: 'day-picker__label' }, 'Jours'),
    h('div', { class: 'daychips daychips--inline', role: 'group', 'aria-label': T`Jours prévus pour ${session.name}` },
      dayLetters().map((l, i) => {
        const d = i + 1;
        const on = days.has(d);
        return h('button', {
          type: 'button', class: `daychip${on ? ' daychip--on' : ''}`, 'aria-pressed': String(on), 'aria-label': DAY_NAMES[i],
          onclick: () => updateProfileData(CAT, (draft) => {
            const s = draft.sessions.find((x) => x.id === session.id);
            if (!s) return;
            const set = new Set(s.weekdays || []);
            if (set.has(d)) set.delete(d); else set.add(d);
            s.weekdays = set.size ? [...set].sort() : null;
          }),
        }, l);
      })));
}

// 1RM estimé — formule d'Epley (identique à l'ancienne app).
export const est1RM = (w, r) => (r <= 1 ? w : w * (1 + r / 30));

const fmtKg = (w) => frNum(w, w % 1 ? (w * 10) % 1 ? 2 : 1 : 0);

/**
 * « 4×6–8 » → { sets: 4, min: 6, max: 8 } ; « 3×12 » → { sets: 3, min: 12, max: 12 }.
 * Renvoie null si aucune répétition n'est lisible.
 */
export function parseRepRange(text) {
  const t = String(text || '');
  const m = t.match(/(\d+)\s*[x×*]\s*(\d+)(?:\s*(?:-|–|—|à|\/)\s*(\d+))?/i);
  if (m) {
    const min = +m[2];
    return { sets: +m[1], min, max: Math.max(min, +(m[3] || min)) };
  }
  const r = t.match(/(\d+)\s*(?:-|–|—|à)\s*(\d+)/);
  return r ? { sets: null, min: +r[1], max: Math.max(+r[1], +r[2]) } : null;
}

/**
 * Charge suggérée — double progression :
 *  • à la dernière séance, toutes les séries à la charge de travail ont atteint
 *    le haut de la fourchette → on monte la charge (+2,5 kg, +1 kg sous 20 kg)
 *    et on repart du bas de la fourchette ;
 *  • sinon même charge, objectif +1 rep (sans dépasser le haut de la fourchette).
 * @returns {{ w:number, r:number, up:boolean } | null}
 */
export function suggestLoad(ex, logs = state.exlogs[ex.id] || []) {
  if (!logs.length) return null;
  // Référence = la dernière séance AVANT aujourd'hui (la suggestion ne bouge pas
  // pendant qu'on note ses séries du jour) ; à défaut, celle d'aujourd'hui.
  const today = localISODate();
  const lastDay = [...logs].reverse().find((x) => x.d !== today)?.d || today;
  // Les séries dégressives (charge volontairement baissée) ne comptent pas.
  const day = logs.filter((x) => x.d === lastDay && x.k !== 'drop');
  if (!day.length) return null;
  const topW = Math.max(...day.map((x) => x.w));
  const repsAtTop = Math.min(...day.filter((x) => x.w === topW).map((x) => x.r));
  const range = parseRepRange(ex.s);
  const max = range?.max ?? repsAtTop + 1;
  const min = range?.min ?? repsAtTop;
  if (repsAtTop >= max) {
    const step = topW < 20 ? 1 : 2.5;
    return { w: Math.round((topW + step) * 4) / 4, r: min, up: true };
  }
  return { w: topW, r: Math.min(max, Math.max(min, repsAtTop + 1)), up: false };
}

/** Recherche vidéo de l'exercice : ouvre YouTube (l'app si installée). */
const VIDEO = {
  youtube: { label: 'YouTube', url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
};

function VideoButton(kind, name) {
  const v = VIDEO[kind];
  return h('a', {
    class: `pill-btn pill-btn--video pill-btn--${kind}`, href: v.url(name), target: '_blank', rel: 'noopener noreferrer',
    'aria-label': T`Voir ${name} sur ${v.label} (le nom est copié)`,
    // Copie le nom : pratique si l'app ouvre sa page d'accueil au lieu de la recherche.
    onclick: () => { navigator.clipboard?.writeText(name).catch(() => {}); },
  }, icon('play', 13), v.label);
}

// ── Séances ─────────────────────────────────────────────────────────────

async function editSession(session) {
  const r = await formSheet({
    title: session ? 'Modifier la séance' : 'Nouvelle séance',
    subtitle: session ? null : 'Ex. Push, Pull, Legs, Full Body…',
    fields: [
      { name: 'name', label: 'Nom', value: session?.name, required: true, maxlength: 60, placeholder: 'Push' },
      { name: 'weekdays', type: 'weekdays', label: 'Jours prévus', value: session?.weekdays,
        hint: "Utilisé par l'accueil pour afficher la séance du jour." },
    ],
    submitLabel: session ? 'Enregistrer' : 'Créer',
    deleteLabel: session ? 'Supprimer la séance' : null,
  });
  if (!r) return;

  if (r.action === 'delete') { await deleteSession(session); return; }

  const { name, weekdays } = r.values;
  if (session) {
    updateProfileData(CAT, (d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (s) { s.name = name; s.weekdays = weekdays.length ? weekdays : null; }
    });
  } else {
    const id = uid('ses');
    updateProfileData(CAT, (d) => {
      d.sessions.push({ id, name, ...(weekdays.length ? { weekdays } : {}), exercises: [] });
    });
    selectedSid = id;
  }
}

async function deleteSession(session) {
  const ok = await confirmSheet({
    title: T`Supprimer « ${session.name} » ?`,
    message: 'La séance et ses exercices seront supprimés. Le carnet de charges est conservé.',
  });
  if (!ok) return;
  const undo = updateProfileData(CAT, (d) => { d.sessions = d.sessions.filter((s) => s.id !== session.id); });
  if (selectedSid === session.id) selectedSid = null;
  undoToast(T`« ${session.name} » supprimée`, undo);
}

// ── Exercices ───────────────────────────────────────────────────────────

async function editExercise(session, exercise) {
  const r = await formSheet({
    title: exercise ? "Modifier l'exercice" : 'Nouvel exercice',
    fields: [
      { name: 'n', label: 'Nom', value: exercise?.n, required: true, placeholder: 'Développé couché barre' },
      { type: 'row', fields: [
        { name: 's', label: 'Séries × reps', value: exercise?.s === '—' ? '' : exercise?.s, placeholder: '4×6–8', maxlength: 40 },
        { name: 'r', label: 'Repos', value: exercise?.r === '—' ? '' : exercise?.r, placeholder: "2'30", maxlength: 20 },
      ] },
      { name: 'no', label: 'Note', value: exercise?.no, placeholder: 'Charge lourde, tempo 3-1-1…', maxlength: 300 },
      { name: 'm', type: 'choice', label: 'Méthode', value: exercise?.m || '', options: [
        { value: '', label: 'Classique' },
        { value: 'drop', label: 'Dégressive', sub: 'Charge ↓ à chaque série' },
        { value: 'up', label: 'Montante', sub: 'Charge ↑ à chaque série' },
      ] },
      { name: 'dw', label: 'Charges prévues (dégressive / montante)', value: exercise?.dw, placeholder: '20 / 18 / 16', maxlength: 60,
        hint: 'En kg, séparées par « / ». Pré-remplies dans le carnet.' },
      { name: 'ss', type: 'toggle', label: 'Superset avec l’exercice précédent', value: exercise?.ss,
        hint: 'Les exercices s’enchaînent sans repos ; un seul repos après le dernier.' },
    ],
    deleteLabel: exercise ? "Supprimer l'exercice" : null,
  });
  if (!r) return;

  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const s = d.sessions.find((x) => x.id === session.id);
      if (s) s.exercises = s.exercises.filter((e) => e.id !== exercise.id);
    });
    undoToast(T`« ${exercise.n} » supprimé`, undo);
    return;
  }

  const ex = {
    id: exercise?.id || uid('e'),
    n: r.values.n,
    s: r.values.s || '—',
    r: r.values.r || '—',
    no: r.values.no || '',
    ...(r.values.ss ? { ss: true } : {}),
    ...(['drop', 'up'].includes(r.values.m) ? { m: r.values.m } : {}),
    ...(['drop', 'up'].includes(r.values.m) && parseLoads(r.values.dw).length ? { dw: parseLoads(r.values.dw).map((x) => frNum(x, x % 1 ? 1 : 0)).join(' / ') } : {}),
  };
  updateProfileData(CAT, (d) => {
    const s = d.sessions.find((x) => x.id === session.id);
    if (!s) return;
    s.exercises = s.exercises || [];
    const i = s.exercises.findIndex((e) => e.id === ex.id);
    if (i >= 0) s.exercises[i] = ex; else s.exercises.push(ex);
  });
}

/** Lie / délie un exercice au précédent (superset). */
function toggleSuperset(session, exId) {
  updateProfileData(CAT, (d) => {
    const s = d.sessions.find((x) => x.id === session.id);
    const e = s?.exercises.find((x) => x.id === exId);
    if (!e) return;
    if (e.ss) delete e.ss; else e.ss = true;
  });
}

/** Regroupe les exercices consécutifs liés : [[e0], [e1, e2 (ss)], …] avec leur index. */
function groupSupersets(exercises) {
  const groups = [];
  exercises.forEach((ex, i) => {
    if (ex.ss && groups.length) groups.at(-1).push({ ex, i });
    else groups.push([{ ex, i }]);
  });
  return groups;
}

/**
 * Déplace un exercice (repéré par son id : la liste a pu changer depuis
 * l'affichage). Un exercice déplacé quitte son superset, et celui qui le
 * suivait dans le superset aussi (sinon il se lierait à un autre exercice).
 */
function moveExercise(session, exId, delta) {
  updateProfileData(CAT, (d) => {
    const s = d.sessions.find((x) => x.id === session.id);
    if (!s) return;
    const i = s.exercises.findIndex((e) => e.id === exId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= s.exercises.length) return;
    const moved = s.exercises[i];
    const next = s.exercises[i + 1];
    if (next?.ss) delete next.ss;
    delete moved.ss;
    [s.exercises[i], s.exercises[j]] = [s.exercises[j], s.exercises[i]];
    if (s.exercises[0]?.ss) delete s.exercises[0].ss;   // le premier ne peut pas être lié au précédent
  });
}

// ── Carnet de charges ───────────────────────────────────────────────────

function openLog(exercise) {
  const eid = exercise.id;
  const weightIn = h('input', { class: 'input input--num', inputmode: 'decimal', placeholder: 'kg', 'aria-label': 'Charge en kg', maxlength: 6 });
  const repsIn = h('input', { class: 'input input--num', inputmode: 'numeric', placeholder: 'reps', 'aria-label': 'Répétitions', maxlength: 4 });
  const content = h('div', { class: 'log' });

  // Options de la série : RIR (répétitions en réserve) et série dégressive.
  // Exercice « dégressive » : le panneau des paliers est ouvert d'office,
  // pré-rempli avec les charges prévues (ex. 20 → 18 → 16).
  const plan = exercise.m === 'drop' ? parseLoads(exercise.dw) : [];
  if (plan[0]) weightIn.placeholder = frNum(plan[0], plan[0] % 1 ? 1 : 0);
  const opts = { rir: null, drop: exercise.m === 'drop' };
  let drops = [];
  const dropRow = (w = '') => {
    const wIn = h('input', { class: 'input input--num', inputmode: 'decimal', placeholder: 'kg', 'aria-label': 'Charge du palier en kg', maxlength: 6 });
    const rIn = h('input', { class: 'input input--num', inputmode: 'numeric', placeholder: 'reps', 'aria-label': 'Répétitions du palier', maxlength: 4 });
    wIn.value = w === '' ? '' : (isEn() ? String(w) : String(w).replace('.', ','));
    const row = { wIn, rIn, el: null };
    row.el = h('div', { class: 'drop-row' },
      h('span', { class: 'drop-row__arrow', 'aria-hidden': 'true' }, '↘'), wIn, h('span', { class: 'log__x', 'aria-hidden': 'true' }, '×'), rIn,
      h('button', { class: 'icon-btn icon-btn--ghost', type: 'button', 'aria-label': 'Retirer ce palier',
        onclick: () => { drops = drops.filter((x) => x !== row); renderDrops(); } }, icon('x', 16)));
    return row;
  };
  const resetDrops = () => { drops = plan.slice(1).map((w) => dropRow(w)); if (!drops.length) drops = [dropRow()]; };
  resetDrops();
  const dropPanel = h('div', { class: 'drop-panel' });
  function renderDrops() {
    dropPanel.hidden = !opts.drop;
    dropPanel.replaceChildren(
      h('p', { class: 'drop-panel__hint' }, 'Paliers après la 1re charge, sans repos :'),
      ...drops.map((x) => x.el),
      h('button', { class: 'link-btn', type: 'button', onclick: () => {
        const prev = parseFloat((drops.at(-1)?.wIn.value || weightIn.value || '').replace(',', '.'));
        drops.push(dropRow(prev > 0 ? Math.round(prev * 0.9 * 2) / 2 : '')); renderDrops();
      } }, icon('plus', 15), 'Ajouter un palier'));
  }

  const chip = (label, on, onclick, title) => h('button', { class: `chip chip--sm${on ? ' chip--on' : ''}`, type: 'button', 'aria-pressed': String(on), title, onclick }, label);
  const chipsEl = h('div', { class: 'log__opts' });
  function syncChips() {
    chipsEl.replaceChildren(
      h('span', { class: 'log__opts-label' }, 'RIR'),
      ...[2, 1, 0].map((n) => chip(String(n), opts.rir === n, () => { opts.rir = opts.rir === n ? null : n; syncChips(); }, T`${n} répétition${n > 1 ? 's' : ''} en réserve`)),
      h('span', { class: 'log__opts-sep', 'aria-hidden': 'true' }),
      chip('↘ Dégressive', opts.drop, () => { opts.drop = !opts.drop; syncChips(); }, 'Série dégressive : plusieurs charges enchaînées sans repos'));
    renderDrops();
  }
  syncChips();

  const num = (inp) => parseFloat(String(inp.value).replace(',', '.'));
  const form = h('form', {
    class: 'log__form', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const w = num(weightIn);
      const r = parseInt(repsIn.value, 10);
      if (!(w > 0 && w < 1000) || !(r > 0 && r < 1000)) {
        (w > 0 ? repsIn : weightIn).classList.add('input--invalid');
        return;
      }
      // Paliers dégressifs : lignes remplies (charge + reps) ; une ligne à moitié remplie est signalée.
      const steps = [];
      if (opts.drop) {
        for (const d of drops) {
          const dw = num(d.wIn); const dr = parseInt(d.rIn.value, 10);
          d.wIn.classList.remove('input--invalid'); d.rIn.classList.remove('input--invalid');
          if (!d.wIn.value.trim() && !d.rIn.value.trim()) continue;
          if (!(dw > 0 && dw < 1000)) { d.wIn.classList.add('input--invalid'); d.wIn.focus(); return; }
          if (!(dr > 0 && dr < 1000)) { d.rIn.classList.add('input--invalid'); d.rIn.focus(); return; }
          steps.push({ w: dw, r: dr });
        }
      }
      weightIn.classList.remove('input--invalid');
      repsIn.classList.remove('input--invalid');
      const prevBest = Math.max(0, ...(state.exlogs[eid] || []).map((x) => est1RM(x.w, x.r)));
      const ts = Date.now();
      addLog(eid, w, r, { rir: opts.rir, ts });
      steps.forEach((x, i) => addLog(eid, x.w, x.r, { drop: true, ts: ts + i + 1 }));
      if (steps.length) toast(T`Dégressive notée : ${[w, ...steps.map((x) => x.w)].map((x) => frNum(x, x % 1 ? 1 : 0)).join(' → ')} kg`);
      // Prochaine série : on garde la charge, on vide les reps des paliers.
      drops.forEach((d) => { d.rIn.value = ''; });
      // Nouveau record (1RM estimé) → proposition de partage aux amis.
      if (prevBest > 0 && est1RM(w, r) > prevBest && state.me) {
        toast(T`Nouveau record ! ${frNum(w, w % 1 ? 1 : 0)} kg × ${r} 🏆`, {
          duration: 7000,
          action: { label: 'Partager', onClick: () => sharePR(state.me, { exercise: exercise.n, w, r }) },
        });
      }
      repsIn.value = '';
      repsIn.focus();
    },
  }, weightIn, h('span', { class: 'log__x', 'aria-hidden': 'true' }, '×'), repsIn,
  h('button', { class: 'btn btn--primary', type: 'submit', 'aria-label': 'Ajouter la série' }, icon('plus', 20)));

  const suggestEl = h('p', { class: 'suggest' });
  function render() {
    const arr = state.exlogs[eid] || [];
    const last = arr.at(-1);
    const sug = suggestLoad(exercise, arr);
    if (sug) {
      weightIn.placeholder = fmtKg(sug.w);
      repsIn.placeholder = String(sug.r);
      suggestEl.replaceChildren(icon(sug.up ? 'up' : 'target', 16),
        h('span', {}, 'Suggéré aujourd’hui : ', h('strong', {}, T`${fmtKg(sug.w)} kg × ${sug.r}`),
          sug.up ? ' · haut de fourchette atteint, on monte' : ' · même charge, +1 rep'));
      suggestEl.hidden = false;
    } else { suggestEl.hidden = true; }
    if (!arr.length) {
      mount(content, h('p', { class: 'muted center' }, 'Aucune charge enregistrée. Ajoute ta première série.'));
      return;
    }
    // Meilleur 1RM par jour → progression
    const byDay = {};
    // Séries dégressives exclues de la progression (charge volontairement baissée).
    for (const e of arr) if (e.k !== 'drop') byDay[e.d] = Math.max(byDay[e.d] || 0, est1RM(e.w, e.r));
    const days = Object.keys(byDay).sort();
    const best = Math.max(0, ...Object.values(byDay));
    const delta = days.length > 1 ? byDay[days.at(-1)] - byDay[days.at(-2)] : null;

    const bestSet = arr.reduce((b, x) => (est1RM(x.w, x.r) > est1RM(b.w, b.r) ? x : b), arr[0]);
    // mount (et non replaceChildren) : ignore les blocs absents au lieu d'afficher « null ».
    mount(content,
      state.me ? h('button', {
        class: 'btn btn--ghost btn--block share-pr', type: 'button',
        onclick: () => sharePR(state.me, { exercise: exercise.n, w: bestSet.w, r: bestSet.r }),
      }, icon('share', 18), T`Partager mon record · ${frNum(bestSet.w, bestSet.w % 1 ? 1 : 0)} kg × ${bestSet.r}`) : null,
      h('div', { class: 'stats' },
        Stat(T`${frNum(last.w, last.w % 1 ? 1 : 0)} kg × ${last.r}`, 'Dernière série'),
        Stat(`${frNum(best, 0)} kg`, '1RM estimé max'),
        Stat(delta == null ? '—' : `${delta >= 0 ? '+' : ''}${frNum(delta, 1)}`, 'Δ 1RM', delta > 0 ? 'up' : delta < 0 ? 'down' : '')),
      days.length > 1 ? h('div', { class: 'chart-wrap' },
        lineChart(days.slice(-20).map((d) => ({ label: formatShortDate(d, { day: 'numeric', month: 'short' }), value: byDay[d] })),
          { unit: '', decimals: 0, ariaLabel: '1RM estimé par séance' })) : null,
      h('ul', { class: 'list' }, [...arr].reverse().slice(0, 60).map((e) => h('li', { class: 'list__row' },
        h('span', { class: 'list__meta' }, formatShortDate(e.d, { day: 'numeric', month: 'short' })),
        h('span', { class: 'list__main' }, T`${frNum(e.w, e.w % 1 ? 1 : 0)} kg × ${e.r}`,
          e.k === 'drop' ? h('span', { class: 'set-tag set-tag--drop' }, '↘ dégr.') : null,
          e.rir != null ? h('span', { class: 'set-tag' }, T`RIR ${e.rir}`) : null),
        h('span', { class: 'list__meta' }, T`1RM ${frNum(est1RM(e.w, e.r), 0)}`),
        IconButton('x', 'Supprimer cette série', () => undoToast('Série supprimée', deleteLog(eid, e.ts)), 'icon-btn--ghost')))),
    );
  }

  render();
  const unsub = subscribe(render);
  openSheet({
    title: exercise.n,
    subtitle: [exercise.s !== '—' && exercise.s, exercise.r !== '—' && T`repos ${exercise.r}`].filter(Boolean).join(' · ') || 'Carnet de charges',
    body: h('div', {}, suggestEl, form, chipsEl, dropPanel, content),
    onClose: unsub,
  });
}

function Stat(value, label, tone = '') {
  return h('div', { class: `stat${tone ? ` stat--${tone}` : ''}` },
    h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

// ── Compteur ────────────────────────────────────────────────────────────

async function editCounter() {
  const r = await formSheet({
    title: 'Compteur de séances',
    subtitle: 'Point de départ (les séances cochées chaque semaine s’y ajoutent).',
    fields: [{ name: 'base', label: 'Séances déjà effectuées', type: 'number', integer: true, min: 0, max: 100000, value: state.counterBase }],
  });
  if (r?.values) setCounterBase(r.values.base ?? 0);
}

// ── Vue ─────────────────────────────────────────────────────────────────

const METHOD = { drop: '↘ Dégressive', up: '↗ Montante' };

/** « 20 / 18,5 / 16 » → [20, 18.5, 16] (charges valides seulement). */
function parseLoads(text) {
  return (String(text || '').match(/\d+(?:[.,]\d+)?/g) || [])
    .map((x) => parseFloat(x.replace(',', '.'))).filter((x) => x > 0 && x < 1000).slice(0, 8);
}

/**
 * Carte d'exercice. `inSuperset` : version ligne, sans bouton de repos (le
 * superset n'a qu'UN repos, après le dernier exercice) et vidéo dans les actions.
 */
function ExerciseCard(session, ex, index, total, label, inSuperset = false) {
  const logs = state.exlogs[ex.id] || [];
  const last = logs.at(-1);
  const restSec = parseRest(ex.r);
  const sug = suggestLoad(ex, logs);

  const more = () => actionSheet({
    title: ex.n,
    actions: [
      { label: 'Modifier', icon: 'edit', onClick: () => editExercise(session, ex) },
      index > 0 && { label: ex.ss ? 'Délier du précédent (superset)' : 'Lier au précédent (superset)', icon: 'link2', onClick: () => toggleSuperset(session, ex.id) },
      index > 0 && { label: 'Monter', icon: 'up', onClick: () => moveExercise(session, ex.id, -1) },
      index < total - 1 && { label: 'Descendre', icon: 'down', onClick: () => moveExercise(session, ex.id, 1) },
    ],
  });

  const main = h('button', { class: 'exercise__main', type: 'button', 'aria-label': T`Modifier ${ex.n}`, onclick: () => editExercise(session, ex) },
    h('span', { class: 'exercise__index' }, label || String(index + 1).padStart(2, '0')),
    h('span', { class: 'exercise__body' },
      h('span', { class: 'exercise__name' }, ex.n),
      ex.no ? h('span', { class: 'exercise__note' }, ex.no) : null,
      METHOD[ex.m] ? h('span', { class: `exercise__method exercise__method--${ex.m}` }, METHOD[ex.m],
        ex.dw ? T` · ${parseLoads(ex.dw).map((x) => frNum(x, x % 1 ? 1 : 0)).join(' → ')} kg` : null) : null,
      sug ? h('span', { class: `exercise__suggest${sug.up ? ' exercise__suggest--up' : ''}` },
        icon(sug.up ? 'up' : 'target', 14), T`Suggéré ${fmtKg(sug.w)} kg × ${sug.r}`) : null),
    h('span', { class: 'exercise__sets' },
      h('span', { class: 'exercise__setsval' }, ex.s),
      !inSuperset && ex.r && ex.r !== '—' ? h('span', { class: 'exercise__rest' }, ex.r) : null));

  const logBtn = h('button', { class: 'pill-btn', type: 'button', onclick: () => openLog(ex) },
    icon('chart', 16), last ? T`${fmtKg(last.w)} kg × ${last.r}` : 'Charges');

  if (inSuperset) {
    return h('article', { class: 'ss-row' }, main,
      h('div', { class: 'exercise__actions' }, logBtn, VideoButton('youtube', ex.n),
        h('span', { class: 'spacer' }),
        IconButton('more', T`Options de ${ex.n}`, more, 'icon-btn--ghost exercise__more')));
  }

  return h('article', { class: 'exercise' },
    main,
    h('div', { class: 'exercise__actions' },
      logBtn,
      h('button', {
        class: 'pill-btn', type: 'button', 'aria-label': T`Lancer le repos ${ex.r}`,
        onclick: () => (restSec ? startTimer(restSec) : startTimer(120)),
      }, icon('timer', 16), restSec ? ex.r : 'Repos'),
      h('span', { class: 'spacer' }),
      IconButton('more', T`Options de ${ex.n}`, more, 'icon-btn--ghost exercise__more')),
    h('div', { class: 'exercise__video' },
      h('span', { class: 'exercise__video-label' }, 'Technique'),
      VideoButton('youtube', ex.n)));
}

/** Superset / circuit : UNE seule bulle, UN seul repos après le dernier exercice. */
function SupersetCard(session, group, num, total) {
  // Repos du tour : celui du dernier exercice (à défaut, le dernier renseigné).
  const restEx = [...group].reverse().map((g) => g.ex).find((e) => parseRest(e.r));
  const restSec = restEx ? parseRest(restEx.r) : null;
  const kind = group.length > 2 ? T`Circuit · ${group.length} exercices` : 'Superset';
  return h('section', { class: 'exercise superset-card', 'aria-label': `${kind}` },
    h('p', { class: 'superset__label' }, icon('link2', 14), kind, h('span', { class: 'superset__hint' }, ' · enchaînés sans repos')),
    h('div', { class: 'superset-card__rows' },
      group.map(({ ex, i }, k) => ExerciseCard(session, ex, i, total, `${num}${String.fromCharCode(65 + k)}`, true))),
    h('div', { class: 'superset-card__foot' },
      h('button', {
        class: 'pill-btn pill-btn--rest', type: 'button',
        'aria-label': T`Lancer le repos après le tour${restEx ? ` (${restEx.r})` : ''}`,
        onclick: () => startTimer(restSec || 120),
      }, icon('timer', 16), restSec ? T`Repos ${restEx.r}` : 'Repos'),
      h('span', { class: 'superset-card__hint' }, 'après le dernier exercice')));
}

/** Liste des exercices : les supersets sont regroupés dans une même bulle. */
function ExerciseList(session, exercises) {
  let n = 0;
  return h('div', { class: 'stack' }, groupSupersets(exercises).map((group) => {
    n += 1;
    const num = String(n).padStart(2, '0');     // numérotation continue : 01, 02A, 02B, 03…
    if (group.length === 1) {
      const { ex, i } = group[0];
      return ExerciseCard(session, ex, i, exercises.length, num);
    }
    return SupersetCard(session, group, num, exercises.length);
  }));
}

export function TrainingView() {
  showTimer(true);
  ensureExlogs();   // carnet de charges chargé à la demande (pas au démarrage)
  const header = PageHeader({
    eyebrow: 'Programme',
    title: 'Mon entraînement',
    trailing: h('button', { class: 'counter', type: 'button', onclick: editCounter, 'aria-label': 'Modifier le compteur de séances' },
      h('span', { class: 'counter__value' }, String(sessionCount())),
      h('span', { class: 'counter__label' }, 'séances')),
  });

  if (!state.ready) return [header, Skeleton(4)];
  const pid = activeProfileId(CAT);
  if (!pid) return [header, NoProfile(CAT, 'dumbbell')];

  const data = profileData(CAT);
  const sessions = data.sessions || [];
  if (!sessions.some((s) => s.id === selectedSid)) {
    selectedSid = (nextSession(pid).session || sessions[0])?.id || null;
  }
  const session = sessions.find((s) => s.id === selectedSid);

  const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Séances' },
    sessions.map((s) => h('button', {
      class: `segment${s.id === selectedSid ? ' segment--on' : ''}`, type: 'button', role: 'tab',
      'aria-selected': String(s.id === selectedSid),
      onclick: () => { selectedSid = s.id; window.dispatchEvent(new Event('app:render')); },
    }, s.name)),
    h('button', { class: 'segment segment--add', type: 'button', 'aria-label': 'Nouvelle séance', onclick: () => editSession(null) }, icon('plus', 18)));

  if (!session) {
    return [header, ProfileBar(CAT), Empty({
      iconName: 'dumbbell', title: 'Aucune séance',
      text: 'Crée ta première séance (Push, Full Body, Legs…).',
      actionLabel: 'Créer une séance', onAction: () => editSession(null),
    })];
  }

  const weekKey = sessionWeekKey(pid, session.id);
  const done = state.week[weekKey]?.done;
  const doneTs = state.week[weekKey]?.ts;
  const exercises = session.exercises || [];

  const doneCard = h('button', {
    class: `done-toggle${done ? ' done-toggle--on' : ''}`, type: 'button', 'aria-pressed': String(Boolean(done)),
    onclick: () => setSessionDone(pid, session, !done),
  },
  h('span', { class: 'done-toggle__box' }, icon('check', 18)),
  h('span', { class: 'done-toggle__text' },
    h('span', { class: 'done-toggle__title' }, done ? 'Séance terminée' : 'Marquer la séance comme faite'),
    h('span', { class: 'done-toggle__sub' }, done && doneTs ? formatShortDate(doneTs) : 'Cette semaine')));

  return [
    header,
    ProfileBar(CAT),
    tabs,
    doneCard,
    SectionTitle(session.name,
      h('div', { class: 'row-gap' },
        IconButton('more', 'Options de la séance', () => actionSheet({
          title: session.name,
          actions: [
            { label: 'Modifier (nom, jours)', icon: 'edit', onClick: () => editSession(session) },
            { label: 'Supprimer la séance', icon: 'trash', danger: true, onClick: () => deleteSession(session) },
          ],
        }), 'icon-btn--soft'))),
    WeekdayPicker(session),
    exercises.length
      ? ExerciseList(session, exercises)
      : Empty({ iconName: 'dumbbell', title: 'Aucun exercice', text: 'Ajoute le premier exercice de cette séance.' }),
    h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editExercise(session, null) },
      icon('plus', 18), 'Ajouter un exercice'),
    h('p', { class: 'hint' }, 'Charge suggérée = double progression : quand toutes tes séries atteignent le haut de la fourchette (ex. 8 reps sur 4×6–8), +2,5 kg et retour au bas de la fourchette ; sinon même charge, +1 rep.'),
  ];
}
