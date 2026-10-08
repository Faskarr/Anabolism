/**
 * Fil de discussion + zone de saisie — partagés entre Contact (utilisateur)
 * et la conversation côté admin.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';
import { ms, MAX_LEN } from '../data/messages.js';

import { locale } from '../lib/i18n.js';
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayLabel(d) {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Aujourd'hui";
  if (sameDay(d, yesterday)) return 'Hier';
  return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

const hhmm = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

/** « 14:05 », « Hier », « lun. », « 6 oct. » — pour les listes. */
export function shortWhen(v) {
  const t = ms(v);
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  if (sameDay(d, now)) return hhmm(d);
  const diffDays = (now - d) / 86400000;
  if (diffDays < 2 && sameDay(new Date(now.getTime() - 86400000), d)) return 'Hier';
  if (diffDays < 7) return d.toLocaleDateString(locale(), { weekday: 'short' });
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/**
 * @param {Array<{id, from, text, at}>} messages
 * @param {'user'|'admin'} me  qui « parle » de ce côté-ci (bulles à droite)
 * @param {{ special?: (m) => Node|null }} [opts]  rendu dédié de certains messages (envoi de programme…)
 */
export function Thread(messages, me, { special } = {}) {
  const nodes = [];
  let lastDay = null;
  for (const m of messages) {
    const d = new Date(ms(m.at) || Date.now());
    const key = d.toDateString();
    if (key !== lastDay) {
      nodes.push(h('p', { class: 'thread__day' }, dayLabel(d)));
      lastDay = key;
    }
    const mine = m.from === me;
    const custom = special?.(m, mine, hhmm(d));
    if (custom) { nodes.push(custom); continue; }
    nodes.push(h('div', { class: `bubble${mine ? ' bubble--mine' : ''}` },
      h('p', { class: 'bubble__text', translate: 'no' }, m.text),
      h('span', { class: 'bubble__time' }, hhmm(d))));
  }
  return h('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' }, nodes);
}

/**
 * Zone de saisie fixée en bas. Grandit avec le texte ; Entrée = nouvelle ligne
 * (comme iMessage), le bouton envoie. Le texte en cours survit aux re-rendus
 * grâce à `draft` (objet mutable fourni par la vue).
 */
export function Composer({ id, draft, placeholder, onSend }) {
  const area = h('textarea', {
    class: 'composer__input', id, rows: 1, maxlength: MAX_LEN,
    placeholder, 'aria-label': placeholder, enterkeyhint: 'send', autocapitalize: 'sentences',
  });
  area.value = draft.text || '';

  const button = h('button', { class: 'composer__send', type: 'submit', 'aria-label': 'Envoyer', disabled: !area.value.trim() },
    icon('send', 22));

  const resize = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 140)}px`;
  };

  area.addEventListener('input', () => {
    draft.text = area.value;
    button.disabled = !area.value.trim();
    resize();
  });
  area.addEventListener('focus', () => document.documentElement.classList.add('kb-open'));
  area.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement?.id !== id) document.documentElement.classList.remove('kb-open');
  }, 50));

  const form = h('form', {
    class: 'composer',
    onsubmit: (e) => {
      e.preventDefault();
      if (onSend(area.value)) {
        draft.text = '';
        area.value = '';
        button.disabled = true;
        resize();
        area.focus();
      }
    },
  }, area, button);

  requestAnimationFrame(resize);
  return form;
}

/** Fait défiler jusqu'au dernier message (après insertion dans le DOM). */
export function scrollToEnd(smooth = false) {
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
}
