/**
 * Présentation de l'app (première connexion, ou Moi › Découvrir l'app).
 *
 * Fenêtre à pages qu'on fait glisser du doigt (défilement horizontal natif avec
 * « scroll-snap » : fluide, géré par le navigateur, aucun calcul JavaScript
 * pendant le glissement). Points de progression, « Passer », « Suivant ».
 *
 * Vue une fois par compte et par appareil (localStorage) : aucune lecture ni
 * écriture Firebase. Module chargé à la demande (absent du démarrage).
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';
import { LiveLogo } from './logo.js';

import { T } from '../lib/i18n.js';
import { tx } from '../lib/i18n.js';
const KEY = (uid) => `tour:v1:${uid}`;
const standalone = () => window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

/** Pages : icône, titre, phrase d'accroche, 3 points clés. */
function slides() {
  const list = [
    {
      hero: true,
      title: 'Bienvenue',
      text: 'Ton entraînement, ta nutrition et ton protocole au même endroit. Glisse vers la gauche pour faire le tour.',
    },
    {
      icon: 'home', eyebrow: 'Accueil', title: 'Ta journée en un coup d’œil',
      points: [
        'La séance du jour, à cocher une fois faite.',
        'Tes amis entraînés aujourd’hui et leurs sons conseillés.',
        'Tes prochaines prises et tes habitudes. Le bouton en haut à droite réorganise les widgets.',
        'Le drapeau en haut à droite change la langue de l’app (français / anglais).',
      ],
    },
    {
      icon: 'dumbbell', eyebrow: 'Séances', title: 'Programme & charges',
      points: [
        'Tes séances par jour, avec séries, répétitions et repos.',
        '« Charges » : note chaque série, l’app te suggère la suivante et suit ton 1RM.',
        'Minuteur de repos, supersets et vidéo de technique pour chaque exercice.',
      ],
    },
    {
      icon: 'leaf', eyebrow: 'Diet', title: 'Ta nutrition',
      points: [
        'Tes repas, aliments, calories et macros de la journée.',
        'Les compléments à prendre avec chaque repas.',
        '« Calculer ma diet » estime tes besoins en calories et en macros.',
      ],
    },
    {
      icon: 'pill', eyebrow: 'Protocole', title: 'Produits & planning',
      points: [
        'Tes produits avec leur dose.',
        'Un tableau pour choisir le jour et l’heure de chaque prise.',
        'Coche tes prises et ajoute des rappels au calendrier du téléphone.',
      ],
    },
    {
      icon: 'target', eyebrow: 'Habitudes', title: 'Tiens le rythme',
      points: [
        'Des objectifs par jour ou par semaine (eau, sommeil, cardio…).',
        'Une série 🔥 qui grandit tant que tu tiens.',
        'Les habitudes du jour s’affichent aussi sur l’accueil.',
      ],
    },
    {
      icon: 'message', eyebrow: 'Contact', title: 'Coach & amis',
      points: [
        'Écris directement à ton coach.',
        'Ajoute tes amis avec ton code ami.',
        'Partage tes records et la musique de ta séance.',
      ],
    },
    {
      icon: 'user', eyebrow: 'Moi', title: 'Ton compte',
      points: [
        'Ta photo de profil (recadrable) et le suivi de ton poids.',
        'Import / export de tes données.',
        'Thème clair ou sombre, fond animé et liens utiles.',
      ],
    },
  ];
  if (!standalone()) {
    list.push({
      icon: 'phone', eyebrow: 'Astuce', title: 'Installe l’app',
      text: 'Dans Safari : bouton Partager, puis « Sur l’écran d’accueil ». AnabolicOS s’ouvre alors en plein écran, plus vite, même sans réseau.',
    });
  }
  return list;
}

function Slide(s, i, total) {
  return h('section', { class: 'tour__slide', 'aria-roledescription': 'page', 'aria-label': T`${i + 1} sur ${total}` },
    s.hero
      ? h('div', { class: 'tour__hero' }, LiveLogo({ size: 'hero' }))
      : h('div', { class: 'tour__icon', 'aria-hidden': 'true' }, icon(s.icon, 34)),
    s.eyebrow ? h('p', { class: 'eyebrow tour__eyebrow' }, s.eyebrow) : null,
    h('h2', { class: 'tour__title' }, s.title),
    s.text ? h('p', { class: 'tour__text' }, s.text) : null,
    s.points ? h('ul', { class: 'tour__points' }, s.points.map((p) =>
      h('li', {}, h('span', { class: 'tour__tick', 'aria-hidden': 'true' }, icon('check', 14)), h('span', {}, p)))) : null);
}

let open = false;

/** Affiche la présentation. `uid` : marque comme vue pour ce compte. */
export function showTour(uid) {
  if (open) return;
  open = true;
  const list = slides();
  const prevFocus = document.activeElement;

  const track = h('div', { class: 'tour__track' }, list.map((s, i) => Slide(s, i, list.length)));
  const dots = list.map((_, i) => h('button', {
    class: 'tour__dot', type: 'button', 'aria-label': T`Aller à la page ${i + 1}`, onclick: () => go(i),
  }));
  const next = h('button', { class: 'btn btn--primary tour__next', type: 'button', onclick: () => (index >= list.length - 1 ? close() : go(index + 1)) }, 'Suivant');
  const skip = h('button', { class: 'link-btn tour__skip', type: 'button', onclick: () => close() }, 'Passer');

  const panel = h('div', { class: 'tour__panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Découvrir AnabolicOS' },
    track,
    h('div', { class: 'tour__foot' },
      skip,
      h('div', { class: 'tour__dots' }, dots),
      next));
  const overlay = h('div', { class: 'tour', onclick: (e) => { if (e.target === overlay) close(); } }, panel);

  let index = 0;
  function sync(i) {
    index = i;
    dots.forEach((d, k) => d.classList.toggle('tour__dot--on', k === i));
    const last = i >= list.length - 1;
    next.textContent = tx(last ? 'C’est parti' : 'Suivant');
    skip.style.visibility = last ? 'hidden' : '';
  }
  function go(i) {
    track.scrollTo({ left: i * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    sync(i);
  }
  // Page courante pendant le glissement (une mesure par image, pas plus).
  let raf = 0;
  track.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (i !== index) sync(Math.min(list.length - 1, Math.max(0, i)));
    });
  }, { passive: true });

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(Math.min(list.length - 1, index + 1));
    else if (e.key === 'ArrowLeft') go(Math.max(0, index - 1));
  };

  function close() {
    try { if (uid) localStorage.setItem(KEY(uid), '1'); } catch { /* ignoré */ }
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('tour--out');
    setTimeout(() => { overlay.remove(); open = false; prevFocus?.focus?.({ preventScroll: true }); }, 260);
  }

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  sync(0);
  requestAnimationFrame(() => next.focus({ preventScroll: true }));
}

/** Première connexion sur ce compte (et cet appareil) : présentation pas encore vue ? */
export function tourSeen(uid) {
  try { return localStorage.getItem(KEY(uid)) === '1'; } catch { return true; }
}
