/**
 * Mini-utilitaire DOM — remplace tous les `innerHTML` de l'ancienne app.
 *
 * SÉCURITÉ : les enfants de type string sont insérés via createTextNode,
 * donc jamais interprétés comme du HTML. Une donnée utilisateur du type
 * `<img src=x onerror=alert(1)>` s'affiche telle quelle, sans s'exécuter.
 *
 * Exemple :
 *   h('button', { class: 'btn btn--primary', onclick: save }, 'Enregistrer')
 */

import { tx } from './i18n.js';

const BOOLEAN_PROPS = new Set(['disabled', 'checked', 'hidden', 'required', 'readonly']);
// Attributs lus par l'utilisateur (ou VoiceOver) : traduits comme les textes.
const TEXT_ATTRS = new Set(['aria-label', 'placeholder', 'title', 'alt']);

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;

    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (BOOLEAN_PROPS.has(key)) {
      el[key] = Boolean(value);
    } else if (key === 'href' || key === 'src') {
      // Bloque les URL javascript: / data: injectées (images base64 autorisées en src uniquement).
      el.setAttribute(key, safeUrl(value, key === 'src' && tag === 'img'));
    } else {
      el.setAttribute(key, TEXT_ATTRS.has(key) ? tx(String(value)) : String(value));
    }
  }

  // translate: 'no' → contenu saisi par un utilisateur (message, note…) : jamais traduit.
  append(el, children, props?.translate !== 'no');
  return el;
}

function append(parent, children, translate = true) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(translate ? tx(String(child)) : String(child)));
  }
}

/**
 * N'autorise que http(s), les chemins relatifs et les ancres ; pour une image,
 * accepte aussi les photos base64 (JPEG/PNG/WebP) — jamais pour un lien.
 */
export function safeUrl(url, allowImageData = false) {
  const s = String(url).trim();
  // http(s), ancres, chemins relatifs — mais pas « //site » ni « /\site » (autre domaine).
  if (/^(https?:|#|\.\/|\/(?![\/\\]))/i.test(s)) return s;
  if (allowImageData && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(s)) return s;
  return '#';
}

/** Remplace le contenu d'un élément. */
export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
  return target;
}
