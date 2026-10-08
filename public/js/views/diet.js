/**
 * Diet : profils, objectif calorique, objectifs macros, repas et aliments.
 * Le « total » est celui du plan alimentaire (comme l'ancienne app).
 */
import { h } from '../lib/dom.js';
import { uid } from '../lib/ids.js';
import { frNum } from '../lib/dates.js';
import { state, activeProfileId, profileData } from '../store.js';
import { updateProfileData } from '../data/repo.js';
import { PageHeader, ProfileBar, NoProfile, Empty, Skeleton, IconButton } from '../ui/layout.js';
import { formSheet, confirmSheet, actionSheet } from '../ui/sheet.js';
import { undoToast, toast } from '../ui/toast.js';
import { parseTimeOfDay, formatMinutes } from '../lib/schedule.js';
import { icon } from '../ui/icons.js';

import { T } from '../lib/i18n.js';
const CAT = 'diet';

/** Totaux du plan : kcal + macros (g). */
export function dietTotals(d) {
  const t = { cal: 0, p: 0, g: 0, l: 0 };
  for (const m of d?.meals || []) {
    for (const f of m.foods || []) {
      t.cal += Number(f.cal) || 0;
      t.p += Number(f.p) || 0;
      t.g += Number(f.g) || 0;
      t.l += Number(f.l) || 0;
    }
  }
  return t;
}

/** Heure par défaut proposée (déduite du nom : « Midi » → 12:30). */
const guessTime = (name) => { const t = parseTimeOfDay(name); return t == null ? '' : formatMinutes(t); };

const sortMeals = (meals) => meals.sort((a, b) => (parseTimeOfDay(a.time || a.name) ?? 9999) - (parseTimeOfDay(b.time || b.name) ?? 9999));

/** Change l'heure d'un repas (sélecteur natif iOS) et retrie la journée. */
function setMealTime(meal, value) {
  const t = parseTimeOfDay(value);
  updateProfileData(CAT, (d) => {
    const m = d.meals.find((x) => x.id === meal.id);
    if (!m) return;
    if (t == null) delete m.time; else m.time = formatMinutes(t);
    sortMeals(d.meals);
  });
}

const mealCal = (m) => (m.foods || []).reduce((a, f) => a + (Number(f.cal) || 0), 0);

// ── Édition ─────────────────────────────────────────────────────────────

async function editTargets(d) {
  const r = await formSheet({
    title: 'Objectifs du jour',
    subtitle: 'Laisse vide pour ne pas fixer de cible.',
    fields: [
      { name: 'objective', label: 'Calories (kcal)', type: 'number', integer: true, min: 0, max: 20000, value: d.objective || '', placeholder: '2800' },
      { type: 'row', fields: [
        { name: 'p', label: 'Protéines (g)', type: 'number', integer: true, min: 0, max: 2000, value: d.macros?.p || '', placeholder: '180' },
        { name: 'g', label: 'Glucides (g)', type: 'number', integer: true, min: 0, max: 2000, value: d.macros?.g || '', placeholder: '300' },
        { name: 'l', label: 'Lipides (g)', type: 'number', integer: true, min: 0, max: 2000, value: d.macros?.l || '', placeholder: '80' },
      ] },
    ],
  });
  if (!r?.values) return;
  const v = r.values;
  updateProfileData(CAT, (draft) => {
    draft.objective = v.objective || 0;
    draft.macros = { p: v.p || 0, g: v.g || 0, l: v.l || 0 };
  });
}

async function editMeal(meal) {
  const r = await formSheet({
    title: meal ? 'Modifier le repas' : 'Nouveau repas',
    fields: [
      { name: 'name', label: 'Nom', value: meal?.name, required: true, maxlength: 60, placeholder: 'Petit-déjeuner' },
      { name: 'time', type: 'time', label: 'Heure du repas', value: meal?.time || guessTime(meal?.name),
        hint: "Sert à afficher le prochain repas sur l'accueil. Laisse vide pour la déduire du nom." },
    ],
    deleteLabel: meal ? 'Supprimer le repas' : null,
  });
  if (!r) return;
  if (r.action === 'delete') return deleteMeal(meal);
  const t = parseTimeOfDay(r.values.time);
  const time = t == null ? '' : formatMinutes(t);
  if (r.values.time && t == null) toast('Heure non reconnue (format 12:30) — ignorée.', { type: 'error' });
  updateProfileData(CAT, (d) => {
    if (meal) {
      const m = d.meals.find((x) => x.id === meal.id);
      if (m) { m.name = r.values.name; if (time) m.time = time; else delete m.time; }
    } else {
      d.meals.push({ id: uid('m'), name: r.values.name, ...(time ? { time } : {}), foods: [] });
    }
    // Repas triés par heure (explicite ou déduite du nom).
    sortMeals(d.meals);
  });
}

async function deleteMeal(meal) {
  const ok = await confirmSheet({ title: T`Supprimer « ${meal.name} » ?`, message: 'Le repas et ses aliments seront supprimés.' });
  if (!ok) return;
  const undo = updateProfileData(CAT, (d) => { d.meals = d.meals.filter((m) => m.id !== meal.id); });
  undoToast(T`« ${meal.name} » supprimé`, undo);
}

async function editFood(meal, food) {
  const r = await formSheet({
    title: food ? "Modifier l'aliment" : T`Ajouter à ${meal.name}`,
    fields: [
      { name: 'name', label: 'Aliment', value: food?.name, required: true, placeholder: 'Riz basmati' },
      { type: 'row', fields: [
        { name: 'qty', label: 'Quantité', value: food?.qty, placeholder: '150 g', maxlength: 40 },
        { name: 'cal', label: 'Calories', type: 'number', integer: true, min: 0, max: 20000, value: food?.cal ?? '', placeholder: 'kcal' },
      ] },
      { type: 'row', fields: [
        { name: 'p', label: 'Prot. (g)', type: 'number', min: 0, max: 2000, value: food?.p ?? '', placeholder: '—' },
        { name: 'g', label: 'Gluc. (g)', type: 'number', min: 0, max: 2000, value: food?.g ?? '', placeholder: '—' },
        { name: 'l', label: 'Lip. (g)', type: 'number', min: 0, max: 2000, value: food?.l ?? '', placeholder: '—' },
      ] },
    ],
    deleteLabel: food ? "Supprimer l'aliment" : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const m = d.meals.find((x) => x.id === meal.id);
      if (m) m.foods = m.foods.filter((f) => f.id !== food.id);
    });
    undoToast(T`« ${food.name} » supprimé`, undo);
    return;
  }
  const v = r.values;
  const next = { id: food?.id || uid('f'), name: v.name, qty: v.qty, cal: v.cal || 0 };
  // Macros optionnelles : stockées seulement si renseignées (format identique à l'ancienne app).
  for (const k of ['p', 'g', 'l']) if (v[k] != null) next[k] = Math.round(v[k] * 10) / 10;
  updateProfileData(CAT, (d) => {
    const m = d.meals.find((x) => x.id === meal.id);
    if (!m) return;
    m.foods = m.foods || [];
    const i = m.foods.findIndex((f) => f.id === next.id);
    if (i >= 0) m.foods[i] = next; else m.foods.push(next);
  });
}

// ── Composants ──────────────────────────────────────────────────────────

export function MacroBar(label, value, target, tone) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return h('div', { class: 'macro' },
    h('div', { class: 'macro__head' },
      h('span', { class: 'macro__label' }, label),
      h('span', { class: 'macro__value' }, `${Math.round(value)}${target ? ` / ${target}` : ''} g`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
      h('div', { class: `bar__fill bar__fill--${tone}`, style: { width: `${pct}%` } })));
}

function CaloriesCard(d, totals) {
  const obj = d.objective || 0;
  const rest = obj - totals.cal;
  const pct = obj > 0 ? Math.min(100, Math.round((totals.cal / obj) * 100)) : 0;
  return h('section', { class: 'card' },
    h('div', { class: 'card__row' },
      h('p', { class: 'eyebrow' }, 'Plan du jour'),
      h('button', { class: 'link-btn', type: 'button', onclick: () => editTargets(d) }, icon('edit', 16), 'Objectifs')),
    obj
      ? h('div', { class: 'kcal' },
        h('div', {}, h('span', { class: 'kcal__big' }, String(totals.cal)), h('span', { class: 'kcal__unit' }, T` / ${obj} kcal`)),
        h('span', { class: `kcal__rest${rest < 0 ? ' kcal__rest--over' : ''}` }, rest >= 0 ? T`${rest} restantes` : T`${-rest} en trop`))
      : h('div', { class: 'kcal' }, h('span', { class: 'kcal__big' }, String(totals.cal)), h('span', { class: 'kcal__unit' }, ' kcal')),
    obj ? h('div', { class: 'bar bar--lg' }, h('div', { class: 'bar__fill', style: { width: `${pct}%` } })) : null,
    h('div', { class: 'macros' },
      MacroBar('Protéines', totals.p, d.macros?.p || 0, 'p'),
      MacroBar('Glucides', totals.g, d.macros?.g || 0, 'g'),
      MacroBar('Lipides', totals.l, d.macros?.l || 0, 'l')));
}

// ── Compléments (sous-catégorie de chaque repas) ───────────────────────

async function editSupplement(meal, sup) {
  const r = await formSheet({
    title: sup ? 'Modifier le complément' : T`Complément · ${meal.name}`,
    fields: [
      { name: 'name', label: 'Complément', value: sup?.name, required: true, maxlength: 80, placeholder: 'Créatine, Oméga 3, Vitamine D…' },
      { name: 'dose', label: 'Dose (optionnel)', value: sup?.dose, maxlength: 40, placeholder: '5 g, 2 gélules…' },
    ],
    deleteLabel: sup ? 'Supprimer le complément' : null,
  });
  if (!r) return;
  if (r.action === 'delete') {
    const undo = updateProfileData(CAT, (d) => {
      const m = d.meals.find((x) => x.id === meal.id);
      if (m) m.supplements = (m.supplements || []).filter((x) => x.id !== sup.id);
    });
    undoToast(T`« ${sup.name} » supprimé`, undo);
    return;
  }
  const next = { id: sup?.id || uid('sup'), name: r.values.name, dose: r.values.dose || '' };
  updateProfileData(CAT, (d) => {
    const m = d.meals.find((x) => x.id === meal.id);
    if (!m) return;
    m.supplements = m.supplements || [];
    const i = m.supplements.findIndex((x) => x.id === next.id);
    if (i >= 0) m.supplements[i] = next; else m.supplements.push(next);
  });
}

/** Liste compacte des compléments d'un repas (réutilisée par l'accueil et l'admin). */
export function SupplementList(meal, onEdit) {
  const sups = meal.supplements || [];
  if (!sups.length) return null;
  return h('div', { class: 'supps' },
    h('span', { class: 'supps__label' }, 'Compléments'),
    h('div', { class: 'supps__items' }, sups.map((x) => (onEdit
      ? h('button', { class: 'supp', type: 'button', onclick: () => onEdit(x) }, x.name, x.dose ? h('span', { class: 'supp__dose' }, x.dose) : null)
      : h('span', { class: 'supp' }, x.name, x.dose ? h('span', { class: 'supp__dose' }, x.dose) : null)))));
}

/**
 * Pastille d'heure : un vrai <input type="time"> transparent par-dessus →
 * un tap ouvre directement la roue de sélection iOS.
 */
function MealTime(meal) {
  const value = meal.time || '';
  const shown = value || guessTime(meal.name);
  return h('label', { class: `meal__time${value ? '' : ' meal__time--auto'}`, title: 'Changer l’heure du repas' },
    icon('clock', 14),
    h('span', {}, shown || 'Heure'),
    h('input', {
      type: 'time', class: 'meal__time-input', value: value || shown, 'aria-label': T`Heure de ${meal.name}`,
      // iOS déclenche « change » à chaque cran de la roue : enregistrer tout de suite
      // re-rendrait l'écran et fermerait la roue. On enregistre à la fermeture.
      onchange: (e) => { if (document.activeElement !== e.target) setMealTime(meal, e.target.value); else e.target.dataset.pending = '1'; },
      onblur: (e) => { if (e.target.dataset.pending) { delete e.target.dataset.pending; setMealTime(meal, e.target.value); } },
    }));
}

function MealCard(meal) {
  const foods = meal.foods || [];
  return h('section', { class: 'card card--flush' },
    h('header', { class: 'meal__head' },
      h('div', { class: 'meal__title' },
        MealTime(meal),
        h('div', {}, h('h3', { class: 'meal__name' }, meal.name), h('span', { class: 'meal__kcal' }, `${mealCal(meal)} kcal`))),
      h('div', { class: 'row-gap' },
        IconButton('plus', T`Ajouter à ${meal.name}`, () => actionSheet({
          title: meal.name,
          actions: [
            { label: 'Ajouter un aliment', icon: 'leaf', onClick: () => editFood(meal, null) },
            { label: 'Ajouter un complément', icon: 'pill', onClick: () => editSupplement(meal, null) },
          ],
        }), 'icon-btn--soft'),
        IconButton('more', T`Options de ${meal.name}`, () => actionSheet({
          title: meal.name,
          actions: [
            { label: 'Renommer / heure', icon: 'edit', onClick: () => editMeal(meal) },
            { label: 'Ajouter un complément', icon: 'pill', onClick: () => editSupplement(meal, null) },
            { label: 'Supprimer le repas', icon: 'trash', danger: true, onClick: () => deleteMeal(meal) },
          ],
        }), 'icon-btn--soft'))),
    foods.length
      ? h('ul', { class: 'list' }, foods.map((f) => {
        const hasMacros = [f.p, f.g, f.l].some((x) => x != null && x !== '');
        return h('li', {},
          h('button', { class: 'food', type: 'button', onclick: () => editFood(meal, f) },
            h('span', { class: 'food__body' },
              h('span', { class: 'food__name' }, f.name),
              h('span', { class: 'food__meta' }, [f.qty, hasMacros ? T`P ${frNum(f.p || 0, 0)} · G ${frNum(f.g || 0, 0)} · L ${frNum(f.l || 0, 0)}` : null].filter(Boolean).join(' · '))),
            h('span', { class: 'food__kcal' }, String(f.cal || 0))));
      }))
      : h('button', { class: 'meal__empty', type: 'button', onclick: () => editFood(meal, null) }, 'Aucun aliment — appuie pour ajouter'),
    SupplementList(meal, (x) => editSupplement(meal, x)));
}

// ── Vue ─────────────────────────────────────────────────────────────────

export function DietView() {
  const header = PageHeader({
    eyebrow: 'Alimentation', title: 'Ma nutrition',
    trailing: h('a', { class: 'head-action', href: '#/diet/calc', 'aria-label': 'Calculer ma diet' },
      icon('calc', 20), h('span', {}, 'Calculer', h('br'), 'ma diet')),
  });
  if (!state.ready) return [header, Skeleton(4)];
  if (!activeProfileId(CAT)) return [header, NoProfile(CAT, 'leaf')];

  const d = profileData(CAT);
  const totals = dietTotals(d);
  const meals = d.meals || [];

  return [
    header,
    ProfileBar(CAT),
    CaloriesCard(d, totals),
    meals.length
      ? h('div', { class: 'stack' }, meals.map(MealCard))
      : Empty({ iconName: 'leaf', title: 'Aucun repas', text: 'Ajoute tes repas puis leurs aliments.' }),
    h('button', { class: 'btn btn--ghost btn--block add-btn', type: 'button', onclick: () => editMeal(null) },
      icon('plus', 18), 'Ajouter un repas'),
  ];
}
