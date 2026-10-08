/**
 * Objectifs & habitudes : à cocher chaque jour, chaque semaine, chaque mois.
 *
 * `GoalsBoard` est partagé entre l'utilisateur (Moi › Mes objectifs, widget de
 * l'accueil) et l'admin (fiche utilisateur › Objectifs) : seules les fonctions
 * d'écriture changent.
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { state } from '../store.js';
import { updateGoals, toggleGoal } from '../data/repo.js';
import { PERIODS, PERIOD_ORDER, isDone, streak, lastDays, progress } from '../data/goals.js';
import { PageHeader, IconButton, Empty, SectionTitle } from '../ui/layout.js';
import { formSheet, confirmSheet } from '../ui/sheet.js';
import { undoToast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

import { T, tx } from '../lib/i18n.js';
const SUGGESTIONS = [
  { title: '10 000 pas', period: 'day' },
  { title: 'Boire 3 L d’eau', period: 'day' },
  { title: 'Dormir 8 h', period: 'day' },
  { title: 'Respecter ma diet', period: 'day' },
  { title: '4 séances', period: 'week' },
  { title: 'Préparer mes repas (meal prep)', period: 'week' },
  { title: 'Photo / mensurations', period: 'month' },
];

/**
 * Formulaire d'ajout / modification.
 * @param {object|null} item
 * @param {(mutate: (g) => void) => any} apply  fonction d'écriture (utilisateur ou admin)
 */
export async function editGoal(item, apply, defaultPeriod = 'day') {
  const r = await formSheet({
    title: item ? 'Modifier l’objectif' : 'Nouvel objectif',
    fields: [
      { name: 'title', label: 'Objectif / habitude', value: item?.title, required: true, maxlength: 100, placeholder: '10 000 pas, 3 L d’eau, 4 séances…' },
      { name: 'period', type: 'choice', label: 'À cocher', columns: 3, value: item?.period || defaultPeriod,
        options: PERIOD_ORDER.map((p) => ({ value: p, label: PERIODS[p].label, sub: T`chaque ${PERIODS[p].short}` })) },
    ],
    submitLabel: item ? 'Enregistrer' : 'Ajouter',
    deleteLabel: item ? 'Supprimer' : null,
  });
  if (!r) return null;
  if (r.action === 'delete') {
    const ok = await confirmSheet({ title: T`Supprimer « ${item.title} » ?`, message: 'L’historique de cet objectif sera perdu.' });
    if (!ok) return null;
    return apply((g) => { g.items = g.items.filter((x) => x.id !== item.id); });
  }
  const { title, period } = r.values;
  return apply((g) => {
    if (item) {
      const x = g.items.find((y) => y.id === item.id);
      if (x) Object.assign(x, { title, period });
    } else {
      g.items.push({ id: uid('goal'), title, period });
    }
  });
}

/** Ligne cochable : [✓] Titre · série 🔥  [7 derniers jours]  [⋯] */
function GoalRow(goals, item, { onToggle, onEdit, compact }) {
  const on = isDone(goals, item);
  const s = streak(goals, item);
  return h('div', { class: `goal${on ? ' goal--on' : ''}` },
    h('button', {
      class: 'goal__check', type: 'button', 'aria-pressed': String(on),
      'aria-label': `${tx(on ? 'Décocher' : 'Cocher')} ${item.title}`, onclick: () => onToggle(item),
    }, icon('check', 18)),
    h('button', { class: 'goal__body', type: 'button', onclick: () => (onEdit ? onEdit(item) : onToggle(item)) },
      h('span', { class: 'goal__title' }, item.title),
      !compact && item.period === 'day'
        ? h('span', { class: 'goal__meta' },
          h('span', { class: 'goal__week', 'aria-label': '7 derniers jours' },
            lastDays(goals, item).map((d) => h('span', { class: `goal__dot${d ? ' goal__dot--on' : ''}` }))),
          s >= 2 ? h('span', { class: 'goal__streak' }, `🔥 ${s} j`) : null)
        : null));
}

/**
 * Tableau des objectifs par période.
 * @param {{ goals, onToggle?, onEdit?, onAdd?, readOnly? }} opts
 */
export function GoalsBoard({ goals, onToggle, onEdit, onAdd }) {
  const items = goals?.items || [];
  if (!items.length) return null;
  return PERIOD_ORDER.map((p) => {
    const list = items.filter((x) => x.period === p);
    if (!list.length) return null;
    const pr = progress(goals, p);
    return h('section', { class: 'card card--flush goals' },
      h('header', { class: 'goals__head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, T`${PERIODS[p].label} · ${PERIODS[p].title}`),
          h('p', { class: 'goals__count' }, `${pr.done}/${pr.total}`, pr.done === pr.total ? h('span', {}, ' ✓') : null)),
        onAdd ? IconButton('plus', T`Ajouter un objectif ${PERIODS[p].label.toLowerCase()}`, () => onAdd(p), 'icon-btn--soft') : null),
      h('div', { class: 'bar goals__bar' }, h('div', { class: 'bar__fill', style: { width: `${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%` } })),
      list.map((x) => GoalRow(goals, x, { onToggle, onEdit })));
  });
}

/** Version compacte pour l'accueil : objectifs du jour + de la semaine. */
export function GoalsCompact(goals, max = 6) {
  const list = (goals?.items || []).filter((x) => x.period !== 'month' || !isDone(goals, x))
    .sort((a, b) => PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period));
  const day = progress(goals, 'day');
  return {
    day,
    list: h('div', { class: 'goals goals--compact' },
      list.slice(0, max).map((x) => GoalRow(goals, x, { onToggle: (it) => toggleGoal(it), compact: true }))),
    more: Math.max(0, list.length - max),
  };
}

const apply = (mutate) => updateGoals(mutate);

export function GoalsView() {
  const goals = state.goals;
  const items = goals.items || [];
  const add = (period) => editGoal(null, apply, period);
  return [
    PageHeader({ eyebrow: 'Objectifs', title: 'Mes habitudes' }),
    items.length
      ? GoalsBoard({ goals, onToggle: (it) => toggleGoal(it), onEdit: (it) => editGoal(it, apply), onAdd: add })
      : Empty({ iconName: 'target', title: 'Aucun objectif', text: 'Ajoute des habitudes à cocher chaque jour, chaque semaine ou chaque mois.', actionLabel: 'Ajouter un objectif', onAction: () => add('day') }),
    items.length ? h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => add('day') }, icon('plus', 18), 'Ajouter un objectif') : null,
    SectionTitle('Idées'),
    h('div', { class: 'chips chips--wrap' }, SUGGESTIONS.filter((sg) => !items.some((x) => x.title === sg.title)).map((sg) => h('button', {
      class: 'chip chip--outline', type: 'button',
      onclick: () => { const undo = apply((g) => { g.items.push({ id: uid('goal'), ...sg }); }); undoToast(T`« ${sg.title} » ajouté`, undo); },
    }, icon('plus', 14), T` ${sg.title} · ${PERIODS[sg.period].short}`))),
    h('p', { class: 'hint' }, 'Les cases se remettent à zéro automatiquement chaque jour, chaque lundi et chaque 1er du mois. Ton coach peut voir et ajuster tes objectifs.'),
  ];
}
