/**
 * Calculateur de diet : métabolisme de base (BMR), dépense du jour (TDEE),
 * puis calories et macros pour une sèche, un maintien ou une prise de masse.
 *
 *  • BMR — Mifflin-St Jeor (par défaut) :
 *      homme : 10 × poids + 6,25 × taille − 5 × âge + 5
 *      femme : 10 × poids + 6,25 × taille − 5 × âge − 161
 *  • BMR — Katch-McArdle (si le taux de masse grasse est connu, plus précis
 *    chez les pratiquants musclés) : 370 + 21,6 × masse maigre
 *  • TDEE = BMR × coefficient d'activité
 *
 * Tout est calculé localement ; les dernières valeurs saisies sont gardées
 * sur l'appareil (confort), rien n'est envoyé tant qu'on n'applique pas.
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state, activeProfileId } from '../store.js';
import { updateProfileData, createProfile } from '../data/repo.js';
import { PageHeader, IconButton } from '../ui/layout.js';
import { undoToast, toast } from '../ui/toast.js';
import { icon } from '../ui/icons.js';
import { weightStats } from './weight.js';

import { T, isEn } from '../lib/i18n.js';
/** Niveaux d'activité : coefficient + repères concrets (pas / séances). */
export const ACTIVITY = [
  { id: 'xs', label: 'Très sédentaire', factor: 1.2,   steps: '< 3 000 pas / jour',     sessions: '0 séance',             desc: 'Travail assis, peu de déplacements.' },
  { id: 's',  label: 'Sédentaire',      factor: 1.375, steps: '3 000 – 6 000 pas',      sessions: '1 – 2 séances / sem.', desc: 'Travail assis, un peu de marche.' },
  { id: 'm',  label: 'Actif',           factor: 1.55,  steps: '6 000 – 10 000 pas',     sessions: '3 – 4 séances / sem.', desc: 'Debout une partie de la journée.' },
  { id: 'l',  label: 'Très actif',      factor: 1.725, steps: '10 000 – 14 000 pas',    sessions: '5 – 6 séances / sem.', desc: 'Métier actif ou beaucoup de marche.' },
  { id: 'xl', label: 'Extrêmement actif', factor: 1.9, steps: '> 14 000 pas',           sessions: '6 – 7 séances / sem.', desc: 'Travail physique + entraînement intense.' },
];

/**
 * Objectifs : ajustement calorique + protéines/lipides en g/kg.
 * Protéines rapportées à la masse maigre si le % de masse grasse est connu
 * (évite de surestimer chez les personnes en surpoids).
 */
export const GOALS = {
  cut: {
    label: 'Sèche', adjust: -0.20, range: '−15 à −25 %',
    protein: 2.2, proteinLbm: 2.6, fat: 0.8,
    tips: [
      'Vise une perte de 0,5 à 1 % du poids de corps par semaine : plus vite, tu perds du muscle.',
      'Garde des charges lourdes à l’entraînement : c’est le signal qui protège ta masse musculaire.',
      'Protéines hautes à chaque repas (30–50 g) : satiété et préservation du muscle.',
      'Pèse-toi chaque matin à jeun et regarde la moyenne sur 7 jours. Si elle stagne 2 semaines, retire 100–150 kcal ou ajoute 2 000 pas/jour.',
    ],
  },
  maintain: {
    label: 'Maintien', adjust: 0, range: '± 0 %',
    protein: 2.0, proteinLbm: 2.4, fat: 1.0,
    tips: [
      'Le poids moyen doit rester stable (± 0,5 kg) sur 2 à 3 semaines ; sinon ajuste de 100–150 kcal.',
      'Idéal pour une « recompo » si tu débutes ou reprends : progresse sur tes charges à calories stables.',
      'Répartis les glucides autour de l’entraînement pour la performance.',
    ],
  },
  bulk: {
    label: 'Prise de masse', adjust: 0.10, range: '+5 à +15 %',
    protein: 1.8, proteinLbm: 2.2, fat: 1.0,
    tips: [
      'Vise +0,25 à +0,5 % du poids de corps par semaine : au-delà, c’est surtout du gras.',
      'Si tu ne prends rien en 2 semaines, ajoute 150–200 kcal (de préférence en glucides).',
      'Les glucides sont ton carburant : place-les avant et après la séance.',
      'Mesure ton tour de taille chaque semaine : s’il monte vite, réduis le surplus.',
    ],
  },
};

const KEY = 'dietCalc';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

/** Saisie courante (persistée entre deux rendus et deux ouvertures). */
let input = null;

function initInput() {
  if (input) return;
  const saved = load();
  const lastKg = weightStats()?.last?.kg;
  input = {
    sex: saved.sex || 'm',
    age: saved.age ?? '',
    weight: lastKg ?? saved.weight ?? '',
    height: saved.height ?? '',
    bf: saved.bf ?? '',
    activity: saved.activity || 'm',
    goal: saved.goal || 'cut',
  };
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * Calcul complet. Renvoie null tant que les champs obligatoires sont invalides.
 * @returns {{ bmr, method, formula, lbm, tdee, factor, goals: Record<string, {kcal,p,l,g}> } | null}
 */
export function computeDiet({ sex, age, weight, height, bf, activity }) {
  const a = num(age); const w = num(weight); const ht = num(height); const fat = num(bf);
  if (!(a >= 14 && a <= 90) || !(w >= 30 && w <= 300) || !(ht >= 120 && ht <= 230)) return null;
  const act = ACTIVITY.find((x) => x.id === activity) || ACTIVITY[2];

  let bmr; let method; let formula; let lbm = null;
  if (fat != null && fat >= 3 && fat <= 60) {
    lbm = w * (1 - fat / 100);
    bmr = 370 + 21.6 * lbm;
    method = 'Katch-McArdle';
    formula = T`370 + 21,6 × ${frNum(lbm, 1)} kg de masse maigre`;
  } else {
    const k = sex === 'f' ? -161 : 5;
    bmr = 10 * w + 6.25 * ht - 5 * a + k;
    method = 'Mifflin-St Jeor';
    formula = `10 × ${frNum(w, 1)} + 6,25 × ${frNum(ht, 0)} − 5 × ${frNum(a, 0)} ${k > 0 ? '+ 5' : '− 161'}`;
  }
  const tdee = bmr * act.factor;

  const goals = {};
  for (const [id, g] of Object.entries(GOALS)) {
    const kcal = Math.round((tdee * (1 + g.adjust)) / 10) * 10;
    const p = Math.round(lbm ? lbm * g.proteinLbm : w * g.protein);
    const l = Math.round(w * g.fat);
    const gl = Math.max(0, Math.round((kcal - p * 4 - l * 9) / 4));
    goals[id] = { kcal, p, l, g: gl };
  }
  return { bmr: Math.round(bmr), method, formula, lbm, tdee: Math.round(tdee), factor: act.factor, act, w, goals };
}

/** Écrit l'objectif choisi dans la diet active (ou en crée une). */
function apply(goalId, r) {
  const t = r.goals[goalId];
  const name = GOALS[goalId].label;
  if (!activeProfileId('diet')) {
    createProfile('diet', name, { objective: t.kcal, macros: { p: t.p, g: t.g, l: t.l }, meals: [] });
    toast(T`Diet « ${name} » créée avec ${t.kcal} kcal`);
  } else {
    const undo = updateProfileData('diet', (d) => {
      d.objective = t.kcal;
      d.macros = { p: t.p, g: t.g, l: t.l };
    });
    undoToast(T`Objectifs mis à jour : ${t.kcal} kcal`, undo);
  }
  location.hash = '#/diet';
}

// ── Affichage ───────────────────────────────────────────────────────────

const rerender = () => window.dispatchEvent(new Event('app:render'));

function NumField(key, label, unit, { placeholder, hint, integer } = {}) {
  return h('label', { class: 'field', for: `calc-${key}` },
    h('span', { class: 'field__label' }, label),
    h('span', { class: 'input-unit' },
      h('input', {
        class: 'input input--num', id: `calc-${key}`, inputmode: integer ? 'numeric' : 'decimal', maxlength: 5,
        placeholder, value: input[key] ?? '', autocomplete: 'off',
        oninput: (e) => { input[key] = e.target.value; save(input); updateResults(); },
      }),
      h('span', { class: 'input-unit__u' }, unit)),
    hint ? h('span', { class: 'field__hint' }, hint) : null);
}

function Choice(key, options, cls = '') {
  return h('div', { class: `choices ${cls}`, role: 'radiogroup' }, options.map((o) => h('button', {
    type: 'button', role: 'radio', class: `choice${input[key] === o.value ? ' choice--on' : ''}`,
    'aria-checked': String(input[key] === o.value),
    onclick: () => { input[key] = o.value; save(input); rerender(); },
  }, h('span', { class: 'choice__label' }, o.label), o.sub ? h('span', { class: 'choice__sub' }, o.sub) : null)));
}

let resultsEl = null;

function updateResults() {
  if (!resultsEl) return;
  resultsEl.replaceChildren(...[Results()].flat().filter(Boolean));
}

function Line(label, value, strong) {
  return h('li', { class: strong ? 'calc-line calc-line--strong' : 'calc-line' }, h('span', {}, label), h('strong', {}, value));
}

function Results() {
  const r = computeDiet(input);
  if (!r) {
    return h('p', { class: 'hint center' }, 'Renseigne âge, poids et taille pour voir le calcul.');
  }
  const goal = GOALS[input.goal];
  const t = r.goals[input.goal];
  const pct = (kcal) => Math.round((kcal / t.kcal) * 100);

  return [
    // 1. Le résultat, en grand
    h('section', { class: 'card widget--ink calc-hero' },
      h('p', { class: 'eyebrow' }, T`${goal.label} · ${goal.range}`),
      h('p', { class: 'calc-hero__kcal' }, frNum(t.kcal, 0), h('span', {}, ' kcal / jour')),
      h('div', { class: 'macro-grid macro-grid--3' },
        [['Protéines', t.p, t.p * 4], ['Glucides', t.g, t.g * 4], ['Lipides', t.l, t.l * 9]].map(([l, g, kcal]) => h('div', { class: 'macro-tile' },
          h('span', { class: 'macro-tile__v' }, `${g} g`),
          h('span', { class: 'macro-tile__l' }, `${l} · ${pct(kcal)} %`)))),
      h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => apply(input.goal, r) },
        icon('check', 18), activeProfileId('diet') ? 'Appliquer à ma diet active' : 'Créer ma diet avec ces objectifs')),

    // 2. Les trois objectifs côte à côte
    h('div', { class: 'calc-goals' }, Object.entries(GOALS).map(([id, g]) => h('button', {
      type: 'button', class: `calc-goal${input.goal === id ? ' calc-goal--on' : ''}`, 'aria-pressed': String(input.goal === id),
      onclick: () => { input.goal = id; save(input); rerender(); },
    }, h('span', { class: 'calc-goal__label' }, g.label), h('span', { class: 'calc-goal__kcal' }, frNum(r.goals[id].kcal, 0)), h('span', { class: 'calc-goal__unit' }, 'kcal')))),

    // 3. Le détail du calcul
    h('section', { class: 'card' },
      h('p', { class: 'eyebrow' }, 'Détail du calcul'),
      h('ol', { class: 'calc-steps' },
        h('li', {},
          h('p', { class: 'calc-steps__title' }, T`Métabolisme de base · ${r.method}`),
          h('p', { class: 'calc-steps__formula' }, `${r.formula} = `, h('strong', {}, `${frNum(r.bmr, 0)} kcal`)),
          h('p', { class: 'muted small' }, r.lbm
            ? T`Masse grasse ${frNum(num(input.bf), 1)} % → masse maigre ${frNum(r.lbm, 1)} kg. Formule plus précise quand le % est fiable.`
            : 'Énergie dépensée au repos complet. Ajoute ton % de masse grasse pour passer en Katch-McArdle.')),
        h('li', {},
          h('p', { class: 'calc-steps__title' }, T`Dépense du jour · ${r.act.label}`),
          h('p', { class: 'calc-steps__formula' }, `${frNum(r.bmr, 0)} × ${isEn() ? r.factor : String(r.factor).replace('.', ',')} = `, h('strong', {}, `${frNum(r.tdee, 0)} kcal`)),
          h('p', { class: 'muted small' }, T`${r.act.steps} · ${r.act.sessions} — c’est ton maintien théorique.`)),
        h('li', {},
          h('p', { class: 'calc-steps__title' }, T`Objectif · ${goal.label}`),
          h('p', { class: 'calc-steps__formula' },
            `${frNum(r.tdee, 0)} × ${frNum(1 + goal.adjust, 2)} = `, h('strong', {}, `${frNum(t.kcal, 0)} kcal`)),
          h('p', { class: 'muted small' }, 'Arrondi à 10 kcal près.')),
        h('li', {},
          h('p', { class: 'calc-steps__title' }, 'Macros'),
          h('ul', { class: 'calc-lines' },
            Line('Protéines', r.lbm
              ? T`${frNum(goal.proteinLbm, 1)} g × ${frNum(r.lbm, 1)} kg maigre = ${t.p} g`
              : T`${frNum(goal.protein, 1)} g × ${frNum(r.w, 1)} kg = ${t.p} g`),
            Line('Lipides', T`${frNum(goal.fat, 1)} g × ${frNum(r.w, 1)} kg = ${t.l} g`),
            Line('Glucides', `(${t.kcal} − ${t.p}×4 − ${t.l}×9) ÷ 4 = ${t.g} g`, true))))),

    // 4. Conseils
    h('section', { class: 'card' },
      h('p', { class: 'eyebrow' }, T`Conseils · ${goal.label}`),
      h('ul', { class: 'calc-tips' }, goal.tips.map((tip) => h('li', {}, icon('check', 16), h('span', {}, tip)))),
      h('p', { class: 'hint' }, 'Estimation de départ : ajuste après 2 à 3 semaines selon la courbe de poids (Moi › Poids).')),
  ];
}

export function DietCalcView() {
  initInput();
  resultsEl = h('div', { class: 'calc-results', 'aria-live': 'polite' });
  updateResults();

  return [
    PageHeader({
      eyebrow: 'Ma nutrition', title: 'Calculer ma diet',
      trailing: IconButton('back', 'Retour', () => { location.hash = '#/diet'; }, 'icon-btn--soft'),
    }),
    h('section', { class: 'card form calc-form' },
      h('div', { class: 'field' },
        h('span', { class: 'field__label' }, 'Sexe'),
        Choice('sex', [{ value: 'm', label: 'Homme' }, { value: 'f', label: 'Femme' }], 'choices--2')),
      h('div', { class: 'field-row' },
        NumField('age', 'Âge', 'ans', { placeholder: '28', integer: true }),
        NumField('weight', 'Poids', 'kg', { placeholder: '80' })),
      h('div', { class: 'field-row' },
        NumField('height', 'Taille', 'cm', { placeholder: '178', integer: true }),
        NumField('bf', 'Masse grasse', '%', { placeholder: 'option.' })),
      h('p', { class: 'field__hint' }, 'Masse grasse facultative (impédancemètre, pince, DEXA) : si elle est renseignée, le calcul passe en Katch-McArdle.')),
    h('p', { class: 'eyebrow menu-title' }, 'Activité au quotidien'),
    h('div', { class: 'activity-list', role: 'radiogroup', 'aria-label': 'Niveau d’activité' },
      ACTIVITY.map((a) => {
        const on = input.activity === a.id;
        return h('button', {
          type: 'button', role: 'radio', class: `activity${on ? ' activity--on' : ''}`, 'aria-checked': String(on),
          onclick: () => { input.activity = a.id; save(input); rerender(); },
        },
        h('span', { class: 'activity__check' }, on ? icon('check', 16) : null),
        h('span', { class: 'activity__body' },
          h('span', { class: 'activity__label' }, a.label, h('span', { class: 'activity__factor' }, `× ${isEn() ? a.factor : String(a.factor).replace('.', ',')}`)),
          h('span', { class: 'activity__meta' }, T`${a.steps} · ${a.sessions}`),
          h('span', { class: 'activity__desc' }, a.desc)));
      })),
    h('p', { class: 'eyebrow menu-title' }, 'Résultat'),
    resultsEl,
  ];
}
