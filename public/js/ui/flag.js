/**
 * Drapeaux ronds (SVG dessinés : rendu identique sur tous les appareils, sans
 * dépendre des émojis) et bouton de changement de langue.
 *
 * Le bouton montre la langue VERS laquelle on bascule :
 *   app en français → drapeau américain (passer en anglais)
 *   app en anglais  → drapeau français (passer en français)
 */
import { h } from '../lib/dom.js';
import { getLang, setLang } from '../lib/i18n.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

let uid = 0;

/** Drapeau rond de `size` px : 'fr' ou 'us'. */
export function Flag(code, size = 24) {
  const id = `flagclip${uid++}`;
  const svg = el('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', class: 'flag' });
  const defs = el('defs', {});
  const clip = el('clipPath', { id });
  clip.appendChild(el('circle', { cx: 12, cy: 12, r: 12 }));
  defs.appendChild(clip);
  svg.appendChild(defs);
  const g = el('g', { 'clip-path': `url(#${id})` });

  if (code === 'fr') {
    g.appendChild(el('rect', { x: 0, y: 0, width: 8, height: 24, fill: '#0055A4' }));
    g.appendChild(el('rect', { x: 8, y: 0, width: 8, height: 24, fill: '#FFFFFF' }));
    g.appendChild(el('rect', { x: 16, y: 0, width: 8, height: 24, fill: '#EF4135' }));
  } else {
    // 13 bandes (rouge en haut et en bas) + canton bleu étoilé.
    const band = 24 / 13;
    g.appendChild(el('rect', { x: 0, y: 0, width: 24, height: 24, fill: '#FFFFFF' }));
    for (let i = 0; i < 13; i += 2) g.appendChild(el('rect', { x: 0, y: i * band, width: 24, height: band, fill: '#B22234' }));
    g.appendChild(el('rect', { x: 0, y: 0, width: 11.5, height: band * 7, fill: '#3C3B6E' }));
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        g.appendChild(el('circle', { cx: 1.9 + c * 2.7 + (r % 2) * 1.35, cy: 1.8 + r * 3, r: 0.62, fill: '#FFFFFF' }));
      }
    }
  }
  svg.appendChild(g);
  // Liseré discret pour détacher le blanc du fond clair.
  svg.appendChild(el('circle', { cx: 12, cy: 12, r: 11.5, fill: 'none', stroke: 'rgba(0,0,0,.14)', 'stroke-width': 1 }));
  return svg;
}

/** Bouton de langue (libellé dans la langue CIBLE, pour être compris de tous). */
export function LangButton({ cls = '' } = {}) {
  const en = getLang() === 'en';
  return h('button', {
    class: `lang-btn ${cls}`.trim(), type: 'button',
    // Libellés non traduits volontairement : chacun est écrit dans la langue proposée.
    'aria-label': en ? 'Passer en français' : 'Switch to English',
    title: en ? 'Français' : 'English',
    translate: 'no',
    onclick: (e) => { e.currentTarget.disabled = true; setLang(en ? 'fr' : 'en'); },
  }, Flag(en ? 'fr' : 'us', 24));
}
