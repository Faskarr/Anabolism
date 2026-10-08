/**
 * Icônes SVG au trait (24×24, stroke 1.75) — remplacent les emojis.
 * Toujours décoratives (aria-hidden) : le bouton qui les contient porte le libellé.
 */
const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  home:     ['M3 10.5 12 3l9 7.5', 'M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5'],
  dumbbell: ['M6.5 6.5v11', 'M17.5 6.5v11', 'M3.5 9v6', 'M20.5 9v6', 'M6.5 12h11'],
  leaf:     ['M5 19c8 0 14-6 14-14-8 0-14 6-14 14Z', 'M5 19 13 11'],
  pill:     ['M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7Z', 'M8.5 8.5l7 7'],
  user:     ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
  plus:     ['M12 5v14', 'M5 12h14'],
  more:     ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  check:    ['M5 12.5 10 17l9-10'],
  timer:    ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 9v4l2.5 2', 'M10 2h4'],
  chart:    ['M4 20V4', 'M4 20h16', 'M7 15l4-4 3 3 5-6'],
  trash:    ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  edit:     ['M4 20h4L19 9l-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  chevron:  ['M9 6l6 6-6 6'],
  back:     ['M15 6l-6 6 6 6'],
  scale:    ['M5 21h14a1 1 0 0 0 1-1V8a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v12a1 1 0 0 0 1 1Z', 'M12 7v3', 'M9 9.5l3 .5'],
  share:    ['M12 3v12', 'M7 8l5-5 5 5', 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M5 21h14'],
  copy:     ['M9 9h11v11H9Z', 'M5 15H4V4h11v1'],
  logout:   ['M15 4h4v16h-4', 'M10 8l-4 4 4 4', 'M6 12h10'],
  x:        ['M6 6l12 12', 'M18 6 6 18'],
  reset:    ['M4 12a8 8 0 1 0 2.5-5.8', 'M4 4v4h4'],
  file:     ['M6 3h8l4 4v14H6Z', 'M14 3v4h4'],
  flame:    ['M12 21c4 0 7-3 7-7 0-5-5-7-5-11-3 2-6 6-6 9-1-1-2-2-2-4-2 2-3 4-3 6 0 4 3 7 9 7Z'],
  message:  ['M4 5h16v11H8l-4 4Z'],
  send:     ['M12 19V5', 'M5 12l7-7 7 7'],
  heart:    ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z'],
  camera:   ['M4 8h3l2-3h6l2 3h3v11H4Z', 'M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z'],
  shield:   ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6Z'],
  moon:     ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z'],
  link:     ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  target:   ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 12h.01'],
  music:    ['M9 18V5l11-2v13', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  play:     ['M7 4l13 8-13 8Z'],
  calendar: ['M4 6h16v14H4Z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  grip:     ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  link2:    ['M8 7v10', 'M8 12h8', 'M16 7v10'],
  calc:     ['M5 3h14v18H5Z', 'M8 7h8', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01', 'M8 16h.01', 'M12 16h.01', 'M16 16h.01'],
  eye:      ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff:   ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2', 'M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6'],
  up:       ['M6 15l6-6 6 6'],
  down:     ['M6 9l6 6 6-6'],
  clock:    ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  bell:     ['M6 16V11a6 6 0 1 1 12 0v5l2 2H4Z', 'M10 21h4'],
  book:     ['M4 4h7a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z', 'M20 4h-7a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7Z'],
  phone:    ['M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z', 'M11 18h2'],
  layout:   ['M4 4h16v6H4Z', 'M4 14h7v6H4Z', 'M15 14h5v6h-5Z'],
};

/**
 * @param {keyof typeof PATHS} name
 * @param {number} [size=22]
 */
export function icon(name, size = 22) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const d of PATHS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
