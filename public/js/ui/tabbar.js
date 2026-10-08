/**
 * Barre d'onglets — capsule de verre flottante (5 zones tactiles, safe-area iPhone).
 * `badges` : { [route]: nombre } — ex. messages non lus sur « Social ».
 *
 * La barre est créée UNE fois puis mise à jour (et non recréée à chaque rendu) :
 * la pastille active peut ainsi glisser d'un onglet à l'autre avec un ressort.
 * Au tap : l'icône s'enfonce puis rebondit.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

import { T, tx } from '../lib/i18n.js';

/** 5 onglets : le quotidien en un tap. Protocole, habitudes et poids vivent dans « Moi » (et sur l'accueil). */
export const TABS = [
  { route: 'home',     label: 'Aujourd’hui', icon: 'home' },
  { route: 'training', label: 'Séances',     icon: 'dumbbell' },
  { route: 'diet',     label: 'Nutrition',   icon: 'leaf' },
  { route: 'contact',  label: 'Social',      icon: 'message' },
  { route: 'me',       label: 'Moi',         icon: 'user' },
];

/** Onglet tapé à l'instant : il joue l'animation « pop » au prochain rendu. */
let justTapped = null;

/** Route courante → onglet actif. */
export function tabOf(current) {
  if (current.startsWith('contact') || current.startsWith('friends') || current === 'u'
    || current === 'admin/messages' || current.startsWith('admin/conv')) return 'contact';
  if (current.startsWith('diet')) return 'diet';
  if (current === 'protocol' || current === 'goals' || current.startsWith('admin') || current.startsWith('me')) return 'me';
  return current.split('/')[0];
}

let nav = null;
const tabs = new Map();   // route → { a, badgeHost, label }
let glow = null;
let lang = null;

function build() {
  glow = h('span', { class: 'tabbar__glow', 'aria-hidden': 'true' });
  nav = h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale', style: { '--tabs': String(TABS.length) } }, glow);
  nav.style.setProperty('--tabs', String(TABS.length));
  for (const t of TABS) {
    const badgeHost = h('span', { class: 'tab__icon' }, icon(t.icon, 23));
    const label = h('span', { class: 'tab__label' }, t.label);
    const a = h('a', {
      class: 'tab', href: `#/${t.route}`,
      onpointerdown: () => {
        justTapped = t.route;
        navigator.vibrate?.(8); // retour haptique léger (Android ; ignoré sur iOS)
      },
      onclick: (e) => {
        // Re-tap sur l'onglet actif : remonte en haut de la page (comme iOS).
        if (a.classList.contains('tab--on') && location.hash === `#/${t.route}`) {
          e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
    }, badgeHost, label);
    tabs.set(t.route, { a, badgeHost, label, def: t });
    nav.appendChild(a);
  }
}

/**
 * Affiche / met à jour la barre dans `host`.
 * @param {HTMLElement} host
 * @param {string} current  clé de route
 * @param {Record<string, number>} badges
 */
export function renderTabBar(host, current, badges = {}) {
  if (!nav) build();
  if (nav.parentNode !== host) host.replaceChildren(nav);
  const top = tabOf(current);
  // Le « pop » n'est consommé que lorsque l'onglet tapé est devenu l'onglet actif.
  const pop = justTapped === top ? top : null;
  if (pop) justTapped = null;
  const langNow = document.documentElement.lang;

  TABS.forEach((t, i) => {
    const { a, badgeHost, label } = tabs.get(t.route);
    const on = t.route === top;
    a.classList.toggle('tab--on', on);
    if (on) { a.setAttribute('aria-current', 'page'); nav.style.setProperty('--i', String(i)); } else a.removeAttribute('aria-current');
    if (pop === t.route) { a.classList.remove('tab--pop'); void a.offsetWidth; a.classList.add('tab--pop'); }
    const n = badges[t.route] || 0;
    const old = badgeHost.querySelector('.tab__badge');
    if (n) {
      const txt = n > 9 ? '9+' : String(n);
      if (old) old.textContent = txt; else badgeHost.appendChild(h('span', { class: 'tab__badge' }, txt));
      a.setAttribute('aria-label', T`${t.label}, ${n} non lu${n > 1 ? 's' : ''}`);
    } else {
      old?.remove();
      a.removeAttribute('aria-label');
    }
    if (lang !== langNow) label.textContent = tx(t.label);   // changement de langue
  });
  lang = langNow;
  glow.style.opacity = TABS.some((t) => t.route === top) ? '1' : '0';
}

/** Compatibilité : ancien appel (rendu complet). */
export function TabBar(current, badges = {}) {
  const host = h('div');
  renderTabBar(host, current, badges);
  return nav;
}
