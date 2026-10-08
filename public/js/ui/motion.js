/**
 * Mouvement « premium » compatible avec le rendu temps réel.
 *
 * Les vues sont re-dessinées à chaque mise à jour du store : une animation
 * naïve redémarrerait à chaque rendu. On mémorise donc, par clé, l'instant de
 * départ et les valeurs de/vers ; un rendu intermédiaire REPREND l'animation
 * là où elle en est (aucun saut, aucun clignotement).
 *
 *  • countUp(key, value, format) : chiffre qui défile jusqu'à sa valeur ;
 *  • progress(key, ratio)        : fraction 0→ratio pour anneaux et barres ;
 *  • resetMotion()               : rejoue tout à la prochaine entrée d'écran.
 *
 * Uniquement transform / opacity / attributs SVG légers ; respecte « Réduire les animations ».
 */
import { h } from '../lib/dom.js';

const DURATION = 1100;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

/** clé → { from, to, at } */
const tracks = new Map();

export function resetMotion() { tracks.clear(); }

function track(key, to) {
  const now = performance.now();
  let t = tracks.get(key);
  if (!t) {
    t = { from: 0, to, at: now };
    tracks.set(key, t);
  } else if (t.to !== to) {
    // Nouvelle valeur : on part de la valeur actuellement affichée.
    t.from = valueAt(t, now);
    t.to = to;
    t.at = now;
  }
  return t;
}

function valueAt(t, now = performance.now()) {
  const p = Math.min(1, (now - t.at) / DURATION);
  return t.from + (t.to - t.from) * easeOut(p);
}

const running = new Set();
let raf = 0;
function loop() {
  raf = 0;
  const now = performance.now();
  for (const job of running) {
    if (!job.el.isConnected && job.started) { running.delete(job); continue; }
    job.started = true;
    job.step(now);
    if (now - job.t.at >= DURATION) running.delete(job);
  }
  if (running.size) raf = requestAnimationFrame(loop);
}
function schedule(job) {
  running.add(job);
  if (!raf) raf = requestAnimationFrame(loop);
}

/**
 * Nombre animé.
 * @param {string} key  identifiant stable (ex. 'home:volume')
 * @param {number} value
 * @param {(n:number)=>string} [format]
 * @param {string} [cls]
 */
export function countUp(key, value, format = (n) => String(Math.round(n)), cls = '') {
  const v = Number(value) || 0;
  const el = h('span', { class: `count ${cls}`.trim() });
  if (reduce()) { el.textContent = format(v); return el; }
  const t = track(key, v);
  el.textContent = format(valueAt(t));
  if (performance.now() - t.at < DURATION) {
    schedule({ el, t, step: (now) => { const s = format(valueAt(t, now)); if (el.textContent !== s) el.textContent = s; } });
  }
  return el;
}

/**
 * Fraction animée 0 → ratio, appliquée par `apply(el, f)` à chaque image.
 * @returns {number} valeur courante (pour le premier rendu)
 */
export function animateRatio(key, ratio, el, apply) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (reduce()) { apply(el, r); return r; }
  const t = track(key, r);
  apply(el, valueAt(t));
  if (performance.now() - t.at < DURATION) {
    schedule({ el, t, step: (now) => apply(el, valueAt(t, now)) });
  }
  return valueAt(t);
}

const NS = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};
let gid = 0;

/**
 * Anneau de progression lumineux (dégradé d'accent + halo), contenu au centre.
 * @param {{ key:string, ratio:number, size?:number, stroke?:number, children?:Node[] , tone?: 'accent'|'on-ink' }} o
 */
export function Ring({ key, ratio, size = 132, stroke = 12, children = [], cls = '' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const id = `rg${++gid}`;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring__svg', 'aria-hidden': 'true' });
  const defs = svg('defs');
  const grad = svg('linearGradient', { id, x1: 0, y1: 0, x2: 1, y2: 1 });
  grad.append(svg('stop', { offset: '0%', class: 'ring__stop-a' }), svg('stop', { offset: '100%', class: 'ring__stop-b' }));
  defs.appendChild(grad);
  const track_ = svg('circle', { cx: size / 2, cy: size / 2, r, class: 'ring__track', 'stroke-width': stroke, fill: 'none' });
  const arc = svg('circle', {
    cx: size / 2, cy: size / 2, r, class: 'ring__arc', 'stroke-width': stroke, fill: 'none',
    stroke: `url(#${id})`, 'stroke-linecap': 'round', 'stroke-dasharray': c.toFixed(2),
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  root.append(defs, track_, arc);
  animateRatio(key, ratio, arc, (el, f) => {
    // Un arc vide garde une petite pointe lumineuse (si progression > 0).
    el.setAttribute('stroke-dashoffset', (c * (1 - f)).toFixed(2));
    el.style.opacity = f <= 0.001 ? '0' : '1';
  });
  return h('div', { class: `ring ${cls}`.trim(), style: { width: `${size}px`, height: `${size}px` } },
    root, h('div', { class: 'ring__center' }, children));
}
