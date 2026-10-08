/**
 * Poids : saisie du jour (date LOCALE), statistiques, courbe, historique.
 */
import { h } from '../lib/dom.js';
import { formatShortDate, frNum, localISODate, daysBetween } from '../lib/dates.js';
import { state } from '../store.js';
import { addWeight, deleteWeight, clearWeights } from '../data/repo.js';
import { PageHeader, Empty, Skeleton, IconButton } from '../ui/layout.js';
import { confirmSheet, formSheet } from '../ui/sheet.js';
import { toast, undoToast } from '../ui/toast.js';
import { lineChart } from '../ui/chart.js';

import { T } from '../lib/i18n.js';
/** Statistiques utilisées ici et par l'accueil. */
export function weightStats(log = state.weights) {
  if (!log.length) return null;
  const last = log.at(-1);
  // Référence ~7 jours avant la dernière pesée (la plus proche disponible).
  const ref = [...log].reverse().find((e) => daysBetween(e.date, last.date) >= 7) || null;
  const prev = log.length > 1 ? log.at(-2) : null;
  const all = log.map((e) => e.kg);
  return {
    last,
    prev,
    delta: prev ? last.kg - prev.kg : null,
    delta7: ref ? last.kg - ref.kg : null,
    min: Math.min(...all),
    max: Math.max(...all),
  };
}

/** Champ de saisie rapide (réutilisé sur l'accueil). */
export function WeightInput({ compact = false } = {}) {
  const today = state.weights.find((e) => e.date === localISODate());
  // Écran Poids : date modifiable pour rentrer d'anciennes pesées.
  const dateIn = compact ? null : h('input', { class: 'input weight-input__date', type: 'date', max: localISODate(), 'aria-label': 'Date de la pesée' });
  if (dateIn) dateIn.value = localISODate();
  const input = h('input', {
    class: 'input input--num input--xl', id: compact ? 'w-quick' : 'w-main',
    inputmode: 'decimal', maxlength: 6, autocomplete: 'off',
    placeholder: today ? frNum(today.kg) : frNum(state.weights.at(-1)?.kg ?? 80),
    'aria-label': 'Poids du jour en kilos',
  });
  return h('form', {
    class: 'weight-input', novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      const v = parseFloat(input.value.replace(',', '.'));
      if (!(v >= 30 && v <= 300)) {
        input.classList.add('input--invalid');
        toast('Entre un poids entre 30 et 300 kg.', { type: 'error' });
        return;
      }
      const date = dateIn?.value && /^\d{4}-\d{2}-\d{2}$/.test(dateIn.value) && dateIn.value <= localISODate() ? dateIn.value : localISODate();
      const replaced = state.weights.some((x) => x.date === date);
      addWeight(v, date);
      input.value = '';
      input.blur();
      toast(T`${frNum(v)} kg ${replaced ? 'mis à jour' : 'enregistré'}${date !== localISODate() ? ` (${formatShortDate(date)})` : ''}`);
    },
  }, input, h('span', { class: 'weight-input__unit' }, 'kg'),
  h('button', { class: 'btn btn--primary', type: 'submit' }, today && compact ? 'Mettre à jour' : 'Ajouter'),
  dateIn ? h('label', { class: 'weight-input__datewrap' }, h('span', { class: 'field__hint' }, 'Date'), dateIn) : null);
}

function Stat(value, label, tone = '') {
  return h('div', { class: `stat${tone ? ` stat--${tone}` : ''}` },
    h('span', { class: 'stat__value' }, value), h('span', { class: 'stat__label' }, label));
}

const RANGES = [['m1', '1 mois'], ['m3', '3 mois'], ['y1', '1 an'], ['all', 'Tout']];
let range = 'm3';

/** Modifier une pesée (poids et/ou date). */
async function editWeight(e) {
  const r = await formSheet({
    title: 'Modifier la pesée',
    fields: [
      { name: 'kg', type: 'number', label: 'Poids (kg)', value: e.kg, min: 30, max: 300, required: true },
      { name: 'date', label: 'Date (AAAA-MM-JJ)', value: e.date, maxlength: 10, required: true },
    ],
    deleteLabel: 'Supprimer la pesée',
  });
  if (!r) return;
  if (r.action === 'delete') { undoToast('Pesée supprimée', deleteWeight(e.date)); return; }
  const date = String(r.values.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localISODate()) { toast('Date invalide (format AAAA-MM-JJ, pas dans le futur).', { type: 'error' }); return; }
  if (date !== e.date) deleteWeight(e.date);
  addWeight(r.values.kg, date);
  toast('Pesée modifiée');
}

const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${frNum(v)}`);

export function WeightView() {
  const header = PageHeader({
    eyebrow: 'Suivi',
    title: 'Mon poids',
    trailing: IconButton('back', 'Retour', () => { location.hash = '#/me'; }, 'icon-btn--soft'),
  });
  if (!state.ready) return [header, Skeleton(3)];

  const log = state.weights;
  const s = weightStats(log);
  // Période de la courbe (toutes les pesées comptent, y compris les anciennes).
  const since = { m1: 31, m3: 92, y1: 366 }[range];
  const shown = since ? log.filter((e) => daysBetween(e.date, localISODate()) <= since) : log;

  return [
    header,
    h('section', { class: 'card' }, h('p', { class: 'eyebrow' }, 'Pesée du jour'), WeightInput()),
    s ? [
      h('div', { class: 'stats stats--4' },
        Stat(frNum(s.last.kg), 'Actuel'),
        Stat(signed(s.delta7), '7 jours', s.delta7 > 0 ? 'up' : s.delta7 < 0 ? 'down' : ''),
        Stat(frNum(s.min), 'Mini'),
        Stat(frNum(s.max), 'Maxi')),
      h('section', { class: 'card' },
        h('p', { class: 'eyebrow' }, T`Courbe · ${shown.length} pesée${shown.length > 1 ? 's' : ''}`),
        h('div', { class: 'weight-range' }, RANGES.map(([k, label]) => h('button', {
          class: `chip chip--sm${range === k ? ' chip--on' : ''}`, type: 'button', onclick: () => { range = k; window.dispatchEvent(new Event('app:render')); },
        }, label))),
        h('div', { class: 'chart-wrap' },
          lineChart(shown.map((e) => ({ label: formatShortDate(e.date, { day: 'numeric', month: 'short' }), value: e.kg })),
            { unit: ' kg', ariaLabel: 'Évolution du poids', height: 150 }))),
      h('section', { class: 'card card--flush' },
        h('header', { class: 'meal__head' }, h('h3', { class: 'meal__name' }, T`Historique · ${log.length}`),
          h('button', {
            class: 'link-btn link-btn--danger', type: 'button',
            onclick: async () => {
              const ok = await confirmSheet({ title: "Effacer tout l'historique ?", message: T`${log.length} pesée(s) seront supprimées.`, confirmLabel: 'Tout effacer' });
              if (!ok) return;
              undoToast('Historique effacé', clearWeights());
            },
          }, 'Tout effacer')),
        h('ul', { class: 'list list--scroll' }, (() => { const rev = [...log].reverse(); return rev.map((e, i) => {
          const older = rev[i + 1];   // liste complète : la 120ᵉ ligne a aussi son écart
          const d = older ? e.kg - older.kg : null;
          return h('li', { class: 'list__row' },
            h('span', { class: 'list__meta list__meta--date' }, formatShortDate(e.date)),
            h('button', { class: 'list__main list__edit', type: 'button', 'aria-label': T`Modifier la pesée du ${formatShortDate(e.date)}`, onclick: () => editWeight(e) }, `${frNum(e.kg)} kg`),
            h('span', { class: `list__meta${d > 0 ? ' up' : d < 0 ? ' down' : ''}` }, d == null ? '' : signed(d)),
            IconButton('x', T`Supprimer la pesée du ${formatShortDate(e.date)}`,
              () => undoToast('Pesée supprimée', deleteWeight(e.date)), 'icon-btn--ghost'));
        }); })())),
    ] : Empty({ iconName: 'scale', title: 'Aucune pesée', text: 'Pèse-toi le matin, à jeun, pour un suivi fiable.' }),
  ];
}

