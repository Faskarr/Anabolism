/**
 * Minuteur de repos — 2.0.
 *
 *  • Capsule de verre flottante (écran Séances) : mini-anneau + temps restant.
 *    Au repos, un tap propose des durées ; pendant un repos, un tap ouvre
 *  • le grand minuteur circulaire : anneau lumineux à l'accent, chiffres géants,
 *    −15 s / +15 s / Passer.
 *
 * Fiabilité (B6) : on stocke l'heure de FIN et on recalcule le reste à chaque
 * image → toujours juste au retour dans l'app (iOS fige les minuteries en arrière-plan).
 * Fin du repos : vibration (si supportée) + bip court (Web Audio).
 * L'écran « Mode séance » s'abonne via onTimer() pour afficher son propre anneau.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

import { tx } from '../lib/i18n.js';
const PRESETS = [60, 90, 120, 150, 180];

let root;
let display;
let presetsEl;
let miniArc;
let endAt = null;
let total = 0;
let tickId = null;
let audioCtx = null;
let big = null;            // grand minuteur (overlay) quand ouvert
const subs = new Set();

export const fmtRest = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const NS = 'http://www.w3.org/2000/svg';
const svg = (name, attrs = {}) => { const n = document.createElementNS(NS, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

/** Petit anneau SVG (rayon r, épaisseur sw) ; renvoie { el, arc, c }. */
function ringSvg(size, sw, cls) {
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const el = svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: cls, 'aria-hidden': 'true' });
  const gid = `tg${Math.random().toString(36).slice(2, 8)}`;
  const defs = svg('defs');
  const g = svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 1, y2: 1 });
  g.append(svg('stop', { offset: '0%', class: 'ring__stop-a' }), svg('stop', { offset: '100%', class: 'ring__stop-b' }));
  defs.appendChild(g);
  const track = svg('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': sw, class: 'ring__track' });
  const arc = svg('circle', {
    cx: size / 2, cy: size / 2, r, fill: 'none', 'stroke-width': sw, stroke: `url(#${gid})`, class: 'ring__arc',
    'stroke-linecap': 'round', 'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': '0',
    transform: `rotate(-90 ${size / 2} ${size / 2})`,
  });
  el.append(defs, track, arc);
  return { el, arc, c };
}
export { ringSvg };

function ensure() {
  if (root) return;
  display = h('span', { class: 'timer__time' }, tx('Repos'));
  const mini = ringSvg(30, 3.5, 'timer__ring');
  miniArc = mini;
  const stop = h('button', {
    class: 'timer__stop', type: 'button', 'aria-label': 'Arrêter le minuteur',
    onclick: (e) => { e.stopPropagation(); stopTimer(); },
  }, icon('x', 16));
  presetsEl = h('div', { class: 'timer__presets', hidden: true },
    PRESETS.map((s) => h('button', {
      class: 'timer__preset', type: 'button',
      onclick: (e) => { e.stopPropagation(); startTimer(s); openBig(); },
    }, fmtRest(s))));
  const pill = h('button', {
    class: 'timer__pill', type: 'button', 'aria-label': 'Minuteur de repos',
    onclick: () => { if (endAt) openBig(); else presetsEl.hidden = !presetsEl.hidden; },
  }, h('span', { class: 'timer__icon' }, mini.el, icon('timer', 16)), display);
  root = h('div', { class: 'timer', hidden: true }, presetsEl, h('div', { class: 'timer__row' }, pill, stop));
  document.body.appendChild(root);
  document.addEventListener('visibilitychange', () => { if (endAt) tick(); });
}

/** Affiche/masque le minuteur flottant (visible uniquement dans Séances). */
export function showTimer(visible) {
  ensure();
  root.hidden = !visible;
}

/**
 * Parse « 2'30 », « 2’30 » (apostrophe typographique de l'iPhone), « 90s »,
 * « 45" », « 1:30 », « 1min30 », « 2 min ». Renvoie des secondes ou null.
 */
export function parseRest(text) {
  const t = String(text || '').toLowerCase().replace(/\s/g, '')
    .replace(/[’‘′´`]/g, "'").replace(/[″"]/g, 's');
  let m = t.match(/^(\d+)(?:'|:|min|mn|m|\.|,)(\d{1,2})?/);
  if (m) return (+m[1]) * 60 + (+(m[2] || 0));
  m = t.match(/^(\d+)(s|sec)?$/);
  if (m) return +m[1] >= 10 ? +m[1] : (+m[1]) * 60;
  return null;
}

/** État courant : { running, left (s), total (s), ratio (0→1 écoulé) }. */
export function timerState() {
  if (!endAt) return { running: false, left: 0, total, ratio: 1 };
  const leftMs = Math.max(0, endAt - Date.now());
  return { running: true, left: Math.ceil(leftMs / 1000), total, ratio: total ? 1 - leftMs / (total * 1000) : 1 };
}

/** Abonnement aux ticks (≈ 4/s) ; renvoie la fonction de désabonnement. */
export function onTimer(cb) { subs.add(cb); return () => subs.delete(cb); }

/**
 * Lance un repos.
 * @param {number} seconds
 * @param {{ open?: boolean }} [opts]  open : affiche directement le grand minuteur
 */
export function startTimer(seconds, { open = false } = {}) {
  ensure();
  presetsEl.hidden = true;
  total = seconds;
  endAt = Date.now() + seconds * 1000;
  root.classList.add('timer--running');
  root.classList.remove('timer--done');
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.()?.catch?.(() => {});
  } catch { /* audio indisponible */ }
  clearInterval(tickId);
  tickId = setInterval(tick, 250);
  tick();
  if (open) openBig();
}

/** Ajoute / retire du temps au repos en cours. */
export function addTime(delta) {
  if (!endAt) return;
  endAt = Math.max(Date.now() + 1000, endAt + delta * 1000);
  total = Math.max(total + delta, Math.ceil((endAt - Date.now()) / 1000));
  tick();
}

function paintMini(st) {
  if (!miniArc) return;
  miniArc.arc.setAttribute('stroke-dashoffset', (miniArc.c * Math.min(1, st.ratio)).toFixed(2));
}

function tick() {
  const st = timerState();
  if (st.running && st.left > 0) {
    const txt = fmtRest(st.left);
    if (display.textContent !== txt) display.textContent = txt;   // une écriture par seconde
    paintMini(st);
    paintBig(st);
    subs.forEach((cb) => cb(st));
    return;
  }
  clearInterval(tickId);
  endAt = null;
  root.classList.remove('timer--running');
  root.classList.add('timer--done');
  display.textContent = tx('Go !');
  navigator.vibrate?.([200, 100, 200]);
  beep();
  const done = { running: false, left: 0, total, ratio: 1, finished: true };
  paintBig(done);
  subs.forEach((cb) => cb(done));
  setTimeout(() => {
    if (!endAt) { root.classList.remove('timer--done'); display.textContent = tx('Repos'); closeBig(); }
  }, 2200);
}

function beep() {
  if (!audioCtx) return;
  try {
    // iOS suspend l'audio quand l'app passe en arrière-plan : on le réveille.
    audioCtx.resume?.()?.catch?.(() => {});
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.5);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.5);
  } catch { /* ignore */ }
}

export function stopTimer() {
  clearInterval(tickId);
  endAt = null;
  root?.classList.remove('timer--running', 'timer--done');
  if (display) display.textContent = tx('Repos');
  closeBig();
  subs.forEach((cb) => cb({ running: false, left: 0, total, ratio: 1, stopped: true }));
}

// ── Grand minuteur circulaire ───────────────────────────────────────────

/** Contenu réutilisable (overlay ou mode séance) : anneau + chiffres + contrôles. */
export function RestDial({ onSkip, size = 264 } = {}) {
  const ring = ringSvg(size, 14, 'rest__ring');
  const time = h('span', { class: 'rest__time' }, fmtRest(timerState().left));
  const label = h('span', { class: 'rest__label' }, tx('Repos'));
  const el = h('div', { class: 'rest__dial', style: { width: `${size}px`, height: `${size}px` } },
    h('span', { class: 'rest__halo', 'aria-hidden': 'true' }),
    ring.el,
    h('div', { class: 'rest__center', role: 'timer', 'aria-live': 'off' }, label, time));
  const controls = h('div', { class: 'rest__controls' },
    h('button', { class: 'rest__btn', type: 'button', 'aria-label': 'Retirer 15 secondes', onclick: () => addTime(-15) }, '−15'),
    h('button', { class: 'btn btn--primary rest__skip', type: 'button', onclick: () => { stopTimer(); onSkip?.(); } }, tx('Passer')),
    h('button', { class: 'rest__btn', type: 'button', 'aria-label': 'Ajouter 15 secondes', onclick: () => addTime(15) }, '+15'));
  const paint = (st) => {
    ring.arc.setAttribute('stroke-dashoffset', (ring.c * Math.min(1, st.ratio)).toFixed(2));
    const t = st.running ? fmtRest(st.left) : tx('Go !');
    if (time.textContent !== t) time.textContent = t;
    el.classList.toggle('is-done', !st.running);
  };
  paint(timerState());
  return { el, controls, paint };
}

function openBig() {
  if (big || !endAt) return;
  const dial = RestDial();
  const close = h('button', { class: 'icon-btn icon-btn--glass rest__close', type: 'button', 'aria-label': 'Réduire le minuteur', onclick: closeBig }, icon('down', 20));
  const overlay = h('div', { class: 'rest', role: 'dialog', 'aria-label': 'Minuteur de repos', onclick: (e) => { if (e.target === overlay) closeBig(); } },
    h('div', { class: 'rest__panel' }, close, dial.el, dial.controls));
  big = { overlay, paint: dial.paint };
  document.body.appendChild(overlay);
}

function paintBig(st) { big?.paint(st); }

function closeBig() {
  if (!big) return;
  const { overlay } = big;
  big = null;
  overlay.classList.add('rest--out');
  setTimeout(() => overlay.remove(), 260);
}
