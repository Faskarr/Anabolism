/**
 * Barre d'onglets inférieure (7 zones tactiles, safe-area iPhone).
 * `badges` : { [route]: nombre } — ex. messages non lus sur « Contact ».
 *
 * Animation au tap : l'icône s'enfonce puis rebondit (ressort), une pastille
 * apparaît derrière, et l'onglet devenu actif « pop » une fois rendu.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';

import { T } from '../lib/i18n.js';
export const TABS = [
  { route: 'home',     label: 'Accueil',   icon: 'home' },
  { route: 'training', label: 'Séances',   icon: 'dumbbell' },
  { route: 'diet',     label: 'Diet',      icon: 'leaf' },
  { route: 'protocol', label: 'Protocole', icon: 'pill' },
  { route: 'goals',    label: 'Habitudes', icon: 'target' },
  { route: 'contact',  label: 'Contact',   icon: 'message' },
  { route: 'me',       label: 'Moi',       icon: 'user' },
];

/** Onglet tapé à l'instant : il joue l'animation « pop » au prochain rendu. */
let justTapped = null;

/** Route courante → onglet actif. */
function tabOf(current) {
  if (current.startsWith('contact') || current.startsWith('friends')
    || current === 'admin/messages' || current.startsWith('admin/conv')) return 'contact';
  if (current === 'me/goals') return 'goals';
  if (current.startsWith('admin') || current.startsWith('me')) return 'me';
  return current.split('/')[0];
}

export function TabBar(current, badges = {}) {
  const top = tabOf(current);
  // Le « pop » n'est consommé que lorsque l'onglet tapé est devenu l'onglet actif
  // (un rendu temps réel intermédiaire ne doit pas le gaspiller).
  const pop = justTapped === top ? top : null;
  if (pop) justTapped = null;

  return h('nav', { class: 'tabbar', 'aria-label': 'Navigation principale' },
    TABS.map((t) => {
      const n = badges[t.route] || 0;
      const on = t.route === top;
      return h('a', {
        class: `tab${on ? ' tab--on' : ''}${pop === t.route ? ' tab--pop' : ''}`,
        href: `#/${t.route}`,
        'aria-current': on ? 'page' : null,
        'aria-label': n ? T`${t.label}, ${n} non lu${n > 1 ? 's' : ''}` : null,
        onpointerdown: () => {
          justTapped = t.route;
          navigator.vibrate?.(8); // retour haptique léger (Android ; ignoré sur iOS)
        },
        onclick: (e) => {
          // Re-tap sur l'onglet actif : remonte en haut de la page (comme iOS).
          if (on && location.hash === `#/${t.route}`) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
        },
      },
      h('span', { class: 'tab__icon' }, icon(t.icon, 24), n ? h('span', { class: 'tab__badge' }, n > 9 ? '9+' : String(n)) : null),
      h('span', { class: 'tab__label' }, t.label));
    }));
}
