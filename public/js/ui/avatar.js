/**
 * Avatar : photo personnalisée (avatars/{uid}) → sinon photo Google → sinon initiale.
 */
import { h } from '../lib/dom.js';
import { avatarOf } from '../data/avatars.js';

export function Avatar({ uid, name, photoURL, size = '' } = {}) {
  const src = avatarOf(uid) || photoURL || null;
  const cls = `avatar${size ? ` avatar--${size}` : ''}`;
  if (src) return h('img', { class: cls, src, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
  return h('span', { class: cls, 'aria-hidden': 'true' }, String(name || '?').trim().charAt(0).toUpperCase() || '?');
}
