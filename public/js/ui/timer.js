/**
 * Minuteur de repos flottant.
 *
 * Corrige B6 : l'ancien minuteur décrémentait un compteur chaque seconde et se
 * figeait quand iOS mettait l'app en arrière-plan. Ici on stocke l'heure de FIN
 * et on recalcule le reste à chaque tick → toujours juste au retour dans l'app.
 * Fin du repos : vibration (si supportée) + bip court (Web Audio).
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

import { tx } from '../lib/i18n.js';
const PRESETS = [60, 90, 120, 150, 180];

let root;
let display;
let presetsEl;
let endAt = null;
let tickId = null;
let audioCtx = null;

const fmt = (s) => `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}`;

function ensure() {
  if (root) return;
  display = h('span', { class: 'timer__time' }, 'Repos');
  const stop = h('button', {
    class: 'timer__stop', type: 'button', 'aria-label': 'Arrêter le minuteur',
    onclick: (e) => { e.stopPropagation(); stopTimer(); },
  }, icon('x', 16));
  presetsEl = h('div', { class: 'timer__presets', hidden: true },
    PRESETS.map((s) => h('button', {
      class: 'timer__preset', type: 'button',
      onclick: (e) => { e.stopPropagation(); startTimer(s); },
    }, fmt(s))));
  const pill = h('button', {
    class: 'timer__pill', type: 'button', 'aria-label': 'Minuteur de repos',
    onclick: () => { if (!endAt) presetsEl.hidden = !presetsEl.hidden; },
  }, icon('timer', 20), display);
  root = h('div', { class: 'timer', hidden: true }, presetsEl, h('div', { class: 'timer__row' }, pill, stop));
  document.body.appendChild(root);
  document.addEventListener('visibilitychange', () => { if (endAt) tick(); });
}

/** Affiche/masque le minuteur (visible uniquement dans Entraînement). */
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

export function startTimer(seconds) {
  ensure();
  root.hidden = false;
  presetsEl.hidden = true;
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
}

function tick() {
  const left = Math.ceil((endAt - Date.now()) / 1000);
  if (left > 0) {
    const txt = fmt(left);
    if (display.textContent !== txt) display.textContent = txt;   // une écriture par seconde
    return;
  }
  clearInterval(tickId);
  endAt = null;
  root.classList.remove('timer--running');
  root.classList.add('timer--done');
  display.textContent = tx('Go !');
  navigator.vibrate?.([200, 100, 200]);
  beep();
  setTimeout(() => { if (!endAt) { root.classList.remove('timer--done'); display.textContent = tx('Repos'); } }, 4000);
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
}
