/**
 * Briques de mise en page partagées par toutes les vues.
 */
import { h } from '../lib/dom.js';
import { icon } from './icons.js';
import { state, activeProfileId } from '../store.js';
import { setActiveProfile, createProfile, renameProfile, deleteProfile } from '../data/repo.js';
import { formSheet, confirmSheet, actionSheet } from './sheet.js';
import { undoToast } from './toast.js';

import { T } from '../lib/i18n.js';
/** En-tête de page « grand titre » façon iOS. */
export function PageHeader({ eyebrow, title, trailing }) {
  return h('header', { class: 'page-head' },
    h('div', {},
      eyebrow ? h('p', { class: 'eyebrow' }, eyebrow) : null,
      h('h1', { class: 'page-title' }, title)),
    trailing || null);
}

/** Titre de section avec action optionnelle à droite. */
export function SectionTitle(text, trailing) {
  return h('div', { class: 'section-title' }, h('h2', {}, text), trailing || null);
}

/** État vide : icône, titre, explication, action. */
export function Empty({ iconName = 'plus', title, text, actionLabel, onAction }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty__icon' }, icon(iconName, 26)),
    h('p', { class: 'empty__title' }, title),
    text ? h('p', { class: 'empty__text' }, text) : null,
    actionLabel ? h('button', { class: 'btn btn--primary', type: 'button', onclick: onAction }, icon('plus', 18), actionLabel) : null);
}

/** Squelette de chargement. */
export function Skeleton(lines = 3) {
  return h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Chargement' },
    Array.from({ length: lines }, (_, i) => h('div', { class: 'skeleton__bar', style: { width: `${90 - i * 15}%` } })));
}

/** Petit bouton icône rond (libellé accessible obligatoire). */
export function IconButton(name, label, onclick, extraClass = '') {
  return h('button', { class: `icon-btn ${extraClass}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name, 20));
}

const CAT_LABEL = { workout: 'programme', diet: 'diet', protocol: 'protocole' };
const CAT_EXAMPLES = { workout: 'PPL Masse, Full Body…', diet: 'Sèche, Prise de masse…', protocol: 'Cycle 1, Croisière…' };

export async function newProfileFlow(cat) {
  const r = await formSheet({
    title: T`Nouveau ${CAT_LABEL[cat]}`,
    subtitle: T`Ex. ${CAT_EXAMPLES[cat]}`,
    fields: [{ name: 'name', label: 'Nom', required: true, maxlength: 60 }],
    submitLabel: 'Créer',
  });
  if (r?.values) createProfile(cat, r.values.name);
}

/**
 * Barre de profils (chips) + bouton « Gérer » explicite.
 * Remplace l'appui long invisible de l'ancienne app.
 */
export function ProfileBar(cat) {
  const p = state.profiles[cat];
  const activeId = activeProfileId(cat);
  const active = p.list.find((x) => x.id === activeId);

  const manage = () => actionSheet({
    title: active ? active.name : 'Profils',
    subtitle: T`Gérer tes profils ${CAT_LABEL[cat]}`,
    actions: [
      { label: T`Nouveau ${CAT_LABEL[cat]}`, icon: 'plus', onClick: () => newProfileFlow(cat) },
      active && { label: 'Renommer', icon: 'edit', onClick: async () => {
        const r = await formSheet({
          title: 'Renommer', fields: [{ name: 'name', label: 'Nom', value: active.name, required: true, maxlength: 60 }],
        });
        if (r?.values) renameProfile(cat, active.id, r.values.name);
      } },
      active && { label: 'Supprimer', icon: 'trash', danger: true, onClick: async () => {
        const ok = await confirmSheet({
          title: T`Supprimer « ${active.name} » ?`,
          message: 'Toutes les données de ce profil seront supprimées.',
        });
        if (ok) undoToast(T`« ${active.name} » supprimé`, deleteProfile(cat, active.id));
      } },
    ],
  });

  return h('div', { class: 'profile-bar' },
    h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Profils' },
      p.list.map((x) => h('button', {
        class: `chip${x.id === activeId ? ' chip--on' : ''}`, type: 'button', role: 'tab',
        'aria-selected': String(x.id === activeId),
        onclick: () => { if (x.id !== activeId) setActiveProfile(cat, x.id); },
      }, x.name))),
    IconButton('more', 'Gérer les profils', manage, 'icon-btn--soft'));
}

/** Écran affiché quand la catégorie n'a encore aucun profil. */
export function NoProfile(cat, iconName) {
  return Empty({
    iconName,
    title: T`Aucun ${CAT_LABEL[cat]}`,
    text: 'Crée ton premier profil, ou importe un code depuis Moi › Partage.',
    actionLabel: T`Créer un ${CAT_LABEL[cat]}`,
    onAction: () => newProfileFlow(cat),
  });
}
