import { h } from '../lib/dom.js';

let host;

/**
 * Notification éphémère non bloquante (remplace alert()).
 * Avec `action`, affiche un bouton (ex. « Annuler » après une suppression).
 *
 * @param {string} message
 * @param {{ type?: 'info'|'error', duration?: number,
 *           action?: { label: string, onClick: () => void } }} [opts]
 */
export function toast(message, { type = 'info', duration, action } = {}) {
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const ttl = duration ?? (action ? 5000 : 3200);
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 200);
  };
  const el = h('div', { class: `toast${type === 'error' ? ' toast--error' : ''}` },
    h('span', { class: 'toast__msg' }, message),
    action ? h('button', {
      class: 'toast__action', type: 'button',
      onclick: () => { action.onClick(); close(); },
    }, action.label) : null,
  );
  host.appendChild(el);
  timer = setTimeout(close, ttl);
}

/** Raccourci : toast « supprimé » avec Annuler. */
export function undoToast(message, undo) {
  toast(message, { action: { label: 'Annuler', onClick: undo } });
}
