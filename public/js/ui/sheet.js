/**
 * Bottom sheets (panneaux qui montent du bas, style iOS).
 * Remplacent les ~10 modales dupliquées de l'ancienne app + alert()/confirm().
 *
 *  openSheet()    panneau générique
 *  formSheet()    formulaire → Promise<{ values } | { action: 'delete' } | null>
 *  confirmSheet() confirmation → Promise<boolean>
 *  actionSheet()  liste d'actions (menu)
 *
 * Fermeture : tap sur le fond, Échap, ou glisser la poignée vers le bas.
 * Clavier iOS : le panneau remonte au-dessus du clavier (visualViewport).
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

import { T, tx } from '../lib/i18n.js';
import { dayLetters } from '../lib/dates.js';
let openCount = 0;

export function openSheet({ title, subtitle, body, footer, onClose, label }) {
  const previousFocus = document.activeElement;

  const handle = h('div', { class: 'sheet__grab', 'aria-hidden': 'true' }, h('span'));
  const panel = h('div', {
    class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title || 'Panneau', tabindex: '-1',
  },
    handle,
    title || subtitle ? h('header', { class: 'sheet__head' },
      title ? h('h2', { class: 'sheet__title' }, title) : null,
      subtitle ? h('p', { class: 'sheet__sub' }, subtitle) : null) : null,
    h('div', { class: 'sheet__body' }, body),
    footer ? h('footer', { class: 'sheet__foot' }, footer) : null,
  );
  const overlay = h('div', { class: 'sheet-overlay' }, panel);

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    overlay.classList.add('sheet-overlay--out');
    panel.style.transform = '';
    panel.classList.add('sheet--out');
    window.visualViewport?.removeEventListener('resize', onViewport);
    window.visualViewport?.removeEventListener('scroll', onViewport);
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      overlay.remove();
      openCount -= 1;
      if (openCount === 0) document.documentElement.classList.remove('no-scroll');
      // Ne pas voler le focus d'un panneau ouvert juste après (confirmation…).
      if (openCount === 0) previousFocus?.focus?.({ preventScroll: true });
    }, 220);
    onClose?.(result);
  }

  // Fond : ferme
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  // Échap : ferme
  const onKey = (e) => { if (e.key === 'Escape') close(null); };
  document.addEventListener('keydown', onKey);

  // Clavier iOS : décale le panneau au-dessus du clavier virtuel.
  const onViewport = () => {
    const vv = window.visualViewport;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    panel.style.marginBottom = `${kb}px`;
    panel.style.maxHeight = `${vv.height - 24}px`;
  };
  window.visualViewport?.addEventListener('resize', onViewport);
  window.visualViewport?.addEventListener('scroll', onViewport);

  // Glisser vers le bas pour fermer (poignée + en-tête).
  let startY = null;
  let dy = 0;
  const dragZone = [handle, panel.querySelector('.sheet__head')].filter(Boolean);
  for (const zone of dragZone) {
    zone.addEventListener('pointerdown', (e) => {
      startY = e.clientY; dy = 0;
      panel.style.transition = 'none';
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      panel.style.transform = `translateY(${dy}px)`;
    });
    const end = () => {
      if (startY == null) return;
      startY = null;
      panel.style.transition = '';
      if (dy > 110) close(null); else panel.style.transform = '';
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  document.body.appendChild(overlay);
  openCount += 1;
  document.documentElement.classList.add('no-scroll');
  requestAnimationFrame(() => panel.focus({ preventScroll: true }));

  return { close, panel };
}

// ── Formulaire ──────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

/**
 * Plusieurs heures (ex. prise matin + soir) : une ligne par heure,
 * « + Ajouter une heure », ✕ pour retirer. read() → ['08:00', '20:00'] (triées, sans doublon).
 */
function timesField(field) {
  const list = h('div', { class: 'times' });
  const addBtn = h('button', { class: 'link-btn', type: 'button' }, icon('plus', 15), 'Ajouter une heure');
  const rows = [];
  const add = (v) => {
    const input = h('input', { class: 'input times__input', type: 'time', 'aria-label': 'Heure de prise' });
    input.value = v || '';
    const row = h('div', { class: 'times__row' }, input,
      h('button', { class: 'icon-btn icon-btn--ghost', type: 'button', 'aria-label': 'Retirer cette heure',
        onclick: () => { if (rows.length > 1) { rows.splice(rows.indexOf(input), 1); row.remove(); } } }, icon('x', 16)));
    rows.push(input);
    list.appendChild(row);
    return input;
  };
  (field.value?.length ? field.value : ['08:00']).forEach(add);
  addBtn.addEventListener('click', () => {
    // Heure proposée : 12 h après la dernière (matin → soir).
    const last = rows.at(-1)?.value || '08:00';
    const [hh, mm] = last.split(':').map(Number);
    add(`${String((hh + 12) % 24).padStart(2, '0')}:${String(mm || 0).padStart(2, '0')}`).focus();
  });
  return {
    el: h('div', { class: 'field' }, h('span', { class: 'field__label' }, field.label), list, addBtn,
      field.hint ? h('span', { class: 'field__hint' }, field.hint) : null),
    input: rows[0],
    read: () => [...new Set(rows.map((x) => x.value).filter((v) => /^\d{2}:\d{2}$/.test(v)))].sort(),
  };
}

function weekdaysField(field) {
  const selected = new Set(field.value || []);
  const buttons = dayLetters().map((l, i) => {
    const day = i + 1;
    const b = h('button', {
      type: 'button',
      class: `daychip${selected.has(day) ? ' daychip--on' : ''}`,
      'aria-pressed': String(selected.has(day)),
      'aria-label': WEEKDAY_NAMES[i],
      onclick: () => {
        if (selected.has(day)) selected.delete(day); else selected.add(day);
        b.classList.toggle('daychip--on', selected.has(day));
        b.setAttribute('aria-pressed', String(selected.has(day)));
      },
    }, l);
    return b;
  });
  return {
    el: h('div', { class: 'field' },
      h('span', { class: 'field__label' }, field.label),
      h('div', { class: 'daychips', role: 'group', 'aria-label': field.label }, buttons),
      field.hint ? h('span', { class: 'field__hint' }, field.hint) : null),
    read: () => [...selected].sort(),
  };
}

/** Interrupteur (case à cocher stylée). */
function toggleField(field) {
  const input = h('input', { type: 'checkbox', class: 'switch__input', id: `f_${field.name}`, name: field.name });
  input.checked = Boolean(field.value);
  return {
    el: h('label', { class: 'field field--switch', for: `f_${field.name}` },
      h('span', { class: 'field--switch__text' },
        h('span', { class: 'field__label' }, field.label),
        field.hint ? h('span', { class: 'field__hint' }, field.hint) : null),
      input, h('span', { class: 'switch', 'aria-hidden': 'true' })),
    read: () => input.checked,
  };
}

/** Choix unique parmi des options : [{ value, label, sub? }]. */
function choiceField(field) {
  let current = field.value ?? field.options[0]?.value;
  const buttons = field.options.map((o) => {
    const b = h('button', {
      type: 'button', role: 'radio', class: `choice${o.value === current ? ' choice--on' : ''}`,
      'aria-checked': String(o.value === current),
      onclick: () => {
        current = o.value;
        for (const x of buttons) {
          const on = x === b;
          x.classList.toggle('choice--on', on);
          x.setAttribute('aria-checked', String(on));
        }
        field.onChange?.(current);
      },
    }, h('span', { class: 'choice__label' }, o.label), o.sub ? h('span', { class: 'choice__sub' }, o.sub) : null);
    return b;
  });
  return {
    el: h('div', { class: 'field' },
      h('span', { class: 'field__label' }, field.label),
      h('div', { class: `choices${field.columns ? ` choices--${field.columns}` : ''}`, role: 'radiogroup', 'aria-label': field.label }, buttons),
      field.hint ? h('span', { class: 'field__hint' }, field.hint) : null),
    read: () => current,
  };
}

function inputField(field) {
  const isNum = field.type === 'number';
  const input = h(field.type === 'textarea' ? 'textarea' : 'input', {
    class: `input${isNum ? ' input--num' : ''}`,
    id: `f_${field.name}`,
    name: field.name,
    type: field.type === 'textarea' ? null : field.type === 'time' ? 'time' : field.type === 'url' ? 'url' : 'text',
    inputmode: isNum ? (field.integer ? 'numeric' : 'decimal') : field.inputmode,
    placeholder: field.placeholder ?? '',
    maxlength: field.maxlength ?? (isNum ? 8 : 120),
    autocomplete: 'off',
    autocapitalize: isNum || field.type === 'url' ? 'off' : 'sentences',
    enterkeyhint: 'next',
    rows: field.type === 'textarea' ? 3 : null,
  });
  input.value = field.value ?? '';
  const wrap = h('label', { class: 'field', for: `f_${field.name}` },
    h('span', { class: 'field__label' }, field.label),
    input,
    field.hint ? h('span', { class: 'field__hint' }, field.hint) : null);
  return {
    el: wrap,
    input,
    read: () => {
      const v = input.value.trim();
      if (!isNum) return v;
      if (v === '') return null;
      // Strict : « 1 200 » → 1200, « 12abc » → invalide (parseFloat lisait 12).
      const n = Number(v.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    },
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {string} [cfg.subtitle]
 * @param {Array} cfg.fields  [{ name, label, type:'text'|'number'|'textarea'|'time'|'url'|'weekdays'|'toggle'|'choice', value, placeholder,
 *                              required, integer, min, max, hint }] ou { type:'row', fields:[…] }
 * @param {string} [cfg.submitLabel]
 * @param {string} [cfg.deleteLabel]  affiche un bouton de suppression
 */
export function formSheet({ title, subtitle, fields, submitLabel = 'Enregistrer', deleteLabel }) {
  return new Promise((resolve) => {
    const controls = {};
    const build = (f) => {
      if (f.type === 'row') return h('div', { class: 'field-row' }, f.fields.map(build));
      const c = f.type === 'weekdays' ? weekdaysField(f)
        : f.type === 'times' ? timesField(f)
        : f.type === 'toggle' ? toggleField(f)
          : f.type === 'choice' ? choiceField(f)
            : inputField(f);
      controls[f.name] = { ...c, def: f };
      return c.el;
    };
    const error = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'form', novalidate: true }, fields.map(build), error);

    const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, submitLabel);
    const del = deleteLabel ? h('button', {
      class: 'btn btn--danger-quiet btn--block', type: 'button',
      onclick: () => { sheet.close({ action: 'delete' }); },
    }, icon('trash', 18), deleteLabel) : null;

    form.append(h('div', { class: 'form__actions' }, submit, del));

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const [name, c] of Object.entries(controls)) {
        const v = c.read();
        const { def } = c;
        c.input?.classList.remove('input--invalid');
        if (def.required && (v === '' || v == null)) {
          error.textContent = T`${tx(def.label)} est obligatoire.`;
          c.input?.classList.add('input--invalid');
          c.input?.focus();
          return;
        }
        if (def.type === 'number' && v != null && (Number.isNaN(v)
            || (def.min != null && v < def.min) || (def.max != null && v > def.max))) {
          error.textContent = T`${tx(def.label)} : valeur invalide${def.min != null ? ` (${def.min} – ${def.max})` : ''}.`;
          c.input?.classList.add('input--invalid');
          c.input?.focus();
          return;
        }
        values[name] = def.integer && typeof v === 'number' ? Math.round(v) : v;
      }
      sheet.close({ values });
    });

    const sheet = openSheet({ title, subtitle, body: form, onClose: (r) => resolve(r || null) });
  });
}

/** Confirmation (remplace confirm()). */
export function confirmSheet({ title, message, confirmLabel = 'Supprimer', danger = true }) {
  return new Promise((resolve) => {
    let result = false;
    const sheet = openSheet({
      title,
      subtitle: message,
      body: h('div', { class: 'form__actions' },
        h('button', {
          class: `btn btn--block ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button',
          onclick: () => { result = true; sheet.close(); },
        }, confirmLabel),
        h('button', { class: 'btn btn--ghost btn--block', type: 'button', onclick: () => sheet.close() }, 'Annuler')),
      onClose: () => resolve(result),
    });
  });
}

/** Menu d'actions. actions: [{ label, icon, danger, onClick }] */
export function actionSheet({ title, subtitle, actions }) {
  let picked = false;   // un double tap ne lance pas l'action deux fois
  const sheet = openSheet({
    title,
    subtitle,
    body: h('div', { class: 'action-list' }, actions.filter(Boolean).map((a) =>
      h('button', {
        class: `action${a.danger ? ' action--danger' : ''}`, type: 'button',
        onclick: () => { if (picked) return; picked = true; sheet.close(); setTimeout(a.onClick, 230); },
      }, a.icon ? icon(a.icon, 20) : null, h('span', {}, a.label)))),
  });
  return sheet;
}
