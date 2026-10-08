/**
 * Courbe SVG unique (poids, 1RM…) — remplace les deux copies de l'ancienne app.
 * Responsive via viewBox, aucun innerHTML, couleurs issues des tokens CSS.
 *
 * @param {{ label: string, value: number }[]} points
 * @param {{ height?: number, unit?: string, decimals?: number, ariaLabel?: string }} [opts]
 */
import { tx, num } from '../lib/i18n.js';
const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
}

let gradientSeq = 0;

export function lineChart(points, { height = 120, unit = '', decimals = 1, ariaLabel = 'Graphique' } = {}) {
  const W = 320;
  const H = height;
  const P = { t: 18, r: 14, b: 22, l: 14 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': tx(ariaLabel) });

  if (points.length < 2) {
    svg.appendChild(el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart__empty' },
      'Pas encore assez de données'));
    return svg;
  }

  const vals = points.map((p) => p.value);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;

  const x = (i) => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const xy = points.map((p, i) => [x(i), y(p.value)]);

  const line = xy.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const area = `${line} L${xy.at(-1)[0].toFixed(1)},${H - P.b} L${xy[0][0].toFixed(1)},${H - P.b} Z`;

  const gid = `cg${++gradientSeq}`;
  const defs = el('defs');
  const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(el('stop', { offset: '0%', class: 'chart__stop-top' }), el('stop', { offset: '100%', class: 'chart__stop-bottom' }));
  defs.appendChild(grad);

  const fmt = (v) => `${num(v, decimals)}${unit}`;
  const [lx, ly] = xy.at(-1);

  svg.append(
    defs,
    el('line', { x1: P.l, x2: W - P.r, y1: H - P.b, y2: H - P.b, class: 'chart__axis' }),
    el('path', { d: area, fill: `url(#${gid})` }),
    el('path', { d: line, class: 'chart__line' }),
    el('circle', { cx: lx, cy: ly, r: 4, class: 'chart__dot' }),
    el('text', { x: Math.min(lx, W - 30), y: Math.max(ly - 9, 11), 'text-anchor': 'middle', class: 'chart__value' }, fmt(vals.at(-1))),
    el('text', { x: P.l, y: H - 6, class: 'chart__label' }, points[0].label),
    el('text', { x: W - P.r, y: H - 6, 'text-anchor': 'end', class: 'chart__label' }, points.at(-1).label),
  );
  return svg;
}
