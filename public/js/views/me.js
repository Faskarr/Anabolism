/**
 * Moi : compte, poids, partage, (contact et admin arrivent aux phases 4 et 5).
 */
import { h } from '../lib/dom.js';
import { frNum } from '../lib/dates.js';
import { state } from '../store.js';
import { signOut } from '../auth.js';
import { PageHeader } from '../ui/layout.js';
import { confirmSheet, formSheet } from '../ui/sheet.js';
import { icon } from '../ui/icons.js';
import { weightStats } from './weight.js';
import { Avatar } from '../ui/avatar.js';
import { avatarOf, uploadMyAvatar, removeMyAvatar } from '../data/avatars.js';
import { toast } from '../ui/toast.js';
import { getThemePref, setThemePref } from '../ui/theme.js';
import { ambientEnabled, setAmbient } from '../ui/ambient.js';
import { linksOf } from '../data/links.js';
import { InstallRow } from '../ui/install.js';
import { openSheet } from '../ui/sheet.js';

import { T, getLang, setLang } from '../lib/i18n.js';
import { Flag } from '../ui/flag.js';
export const APP_VERSION = '0.9.1';

function Row({ href, onclick, iconName, label, value, badge, danger }) {
  const inner = [
    h('span', { class: 'menu-row__icon' }, icon(iconName, 20)),
    h('span', { class: 'menu-row__label' }, label),
    value ? h('span', { class: 'menu-row__value' }, value) : null,
    badge ? h('span', { class: 'count-badge', 'aria-label': T`${badge} non lu${badge > 1 ? 's' : ''}` }, String(badge)) : null,
    href ? h('span', { class: 'menu-row__chevron' }, icon('chevron', 18)) : null,
  ];
  return href
    ? h('a', { class: 'menu-row', href }, inner)
    : h('button', { class: `menu-row${danger ? ' menu-row--danger' : ''}`, type: 'button', onclick }, inner);
}

let uploading = false;

/** Photo de profil : tap → choisir/prendre une photo → compressée et enregistrée. */
function AvatarPicker(user) {
  const input = h('input', {
    type: 'file', accept: 'image/*', class: 'sr-only', id: 'avatar-file',
    onchange: async () => {
      const file = input.files?.[0];
      input.value = '';                 // permet de re-choisir la même photo
      if (!file) return;
      let img;
      // Recadrage chargé à la demande (inutile au démarrage).
      try { const { cropAvatar } = await import('../ui/cropper.js'); img = await cropAvatar(file); } catch (err) { toast(err.message, { type: 'error' }); return; }
      if (!img) return;                 // recadrage annulé
      uploading = true;
      window.dispatchEvent(new Event('app:render'));
      try {
        await uploadMyAvatar(user.uid, img);
        toast('Photo de profil mise à jour');
      } catch (err) {
        toast(err.message || 'Envoi impossible.', { type: 'error' });
      } finally {
        uploading = false;
        window.dispatchEvent(new Event('app:render'));
      }
    },
  });
  return h('div', { class: 'avatar-picker' },
    h('label', { for: 'avatar-file', class: 'avatar-picker__btn', 'aria-label': 'Changer ma photo de profil' },
      Avatar({ uid: user.uid, name: user.displayName, photoURL: user.photoURL, size: 'lg' }),
      h('span', { class: 'avatar-picker__badge' }, uploading ? h('span', { class: 'spinner spinner--xs' }) : icon('camera', 15))),
    input,
    avatarOf(user.uid) ? h('button', {
      class: 'link-btn link-btn--danger avatar-picker__remove', type: 'button',
      onclick: async () => { if (await confirmSheet({ title: 'Retirer ta photo ?', confirmLabel: 'Retirer' })) removeMyAvatar(user.uid); },
    }, 'Retirer') : null);
}


function ThemePicker() {
  const cur = getThemePref();
  return h('div', { class: 'theme-row' },
    h('span', { class: 'menu-row__icon' }, icon('moon', 20)),
    h('span', { class: 'menu-row__label' }, 'Apparence'),
    h('div', { class: 'segmented segmented--mini', role: 'radiogroup', 'aria-label': 'Thème' },
      [['light', 'Clair'], ['dark', 'Sombre'], ['auto', 'Auto']].map(([v, l]) => h('button', {
        class: `segment${cur === v ? ' segment--on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(cur === v),
        onclick: () => { setThemePref(v); window.dispatchEvent(new Event('app:render')); },
      }, l))));
}

/** Langue de l'app : chaque option est écrite dans sa propre langue (jamais traduite). */
function LangPicker() {
  const cur = getLang();
  return h('div', { class: 'theme-row' },
    h('span', { class: 'menu-row__icon' }, Flag(cur === 'en' ? 'us' : 'fr', 20)),
    h('span', { class: 'menu-row__label' }, 'Langue'),
    h('div', { class: 'segmented segmented--mini', role: 'radiogroup', 'aria-label': 'Langue', translate: 'no' },
      [['fr', 'Français'], ['en', 'English']].map(([v, l]) => h('button', {
        class: `segment${cur === v ? ' segment--on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(cur === v),
        onclick: () => { if (v !== cur) setLang(v); },
      }, l))));
}

/** Fond animé (halos en mouvement) : activé par défaut, désactivable. */
function FxToggle() {
  const input = h('input', {
    type: 'checkbox', class: 'switch__input', id: 'fx-cracks',
    onchange: () => setAmbient(input.checked),
  });
  input.checked = ambientEnabled();
  return h('label', { class: 'theme-row', for: 'fx-cracks', style: { position: 'relative' } },
    h('span', { class: 'menu-row__icon' }, icon('flame', 20)),
    h('span', { class: 'menu-row__label' }, 'Fond animé', h('span', { class: 'menu-row__sub' }, 'Halos flous et étoiles filantes')),
    input, h('span', { class: 'switch', 'aria-hidden': 'true' }));
}

/** Changer d'identité : pseudo affiché à la place du nom Google. */
async function editPseudo(session) {
  const { user } = session;
  const r = await formSheet({
    title: 'Mon pseudo',
    subtitle: T`Affiché à tes amis et à ton coach à la place de « ${user.googleName || user.email} ». Laisse vide pour reprendre ton nom Google.`,
    fields: [{ name: 'pseudo', label: 'Pseudo', maxlength: 30, value: user.pseudo || '', placeholder: 'Ex. Faskarr' }],
    submitLabel: 'Enregistrer',
  });
  if (!r?.values) return;
  try {
    const { savePseudo } = await import('../data/profile.js');
    const name = await savePseudo(session, r.values.pseudo);
    toast(T`Tu t’appelles maintenant ${name}`);
    setTimeout(() => location.reload(), 700);   // tout l'écran repart avec le nouveau nom
  } catch (err) {
    console.error('[pseudo]', err);
    toast(err.message?.includes('caractères') ? err.message : 'Impossible d’enregistrer le pseudo.', { type: 'error' });
  }
}

export function MeView(session) {
  const { user, isAdmin } = session;
  const s = weightStats();

  return [
    PageHeader({ eyebrow: 'Compte', title: 'Mon compte' }),
    h('section', { class: 'card profile-card' },
      AvatarPicker(user),
      h('div', { style: { minWidth: 0 } },
        h('button', { class: 'profile-card__name profile-card__edit', type: 'button', 'aria-label': 'Changer mon pseudo', onclick: () => editPseudo(session) },
          user.displayName || 'Athlète', icon('edit', 15), isAdmin ? h('span', { class: 'badge badge--inline' }, 'Admin') : null),
        user.pseudo ? h('p', { class: 'muted small' }, T`Nom Google : ${user.googleName}`) : null,
        h('p', { class: 'muted', style: { overflowWrap: 'anywhere' } }, user.email),
        h('p', { class: 'muted small' }, 'Photo visible par tes amis et ton coach.'))),
    h('nav', { class: 'menu card card--flush', 'aria-label': 'Sections' },
      InstallRow(openSheet),
      Row({ href: '#/me/weight', iconName: 'scale', label: 'Poids', value: s ? `${frNum(s.last.kg)} kg` : null }),
      Row({ href: '#/me/share', iconName: 'share', label: 'Import / Export' }),
      Row({ href: `#/u/${encodeURIComponent(user.uid)}`, iconName: 'user', label: 'Mon profil' }),
      Row({ href: '#/me/check', iconName: 'shield', label: 'Diagnostic' }),
      Row({
        iconName: 'book', label: 'Découvrir l’app',
        onclick: () => import('../ui/tour.js').then((m) => m.showTour(user.uid)),
      })),
    h('p', { class: 'eyebrow menu-title' }, 'Liens & réglages'),
    h('nav', { class: 'menu card card--flush', 'aria-label': 'Liens utiles' },
      ThemePicker(),
      LangPicker(),
      FxToggle(),
      linksOf(isAdmin).map((l) => h('a', { class: 'menu-row', href: l.href, target: '_blank', rel: 'noopener noreferrer' },
        h('span', { class: 'menu-row__icon' }, icon(l.icon || 'link', 20)),
        h('span', { class: 'menu-row__label' }, l.label, h('span', { class: 'menu-row__sub' }, l.sub)),
        h('span', { class: 'menu-row__chevron' }, icon('external', 16))))),
    isAdmin ? h('nav', { class: 'menu card card--flush', 'aria-label': 'Administration' },
      Row({
        href: '#/admin', iconName: 'shield', label: 'Espace admin',
        value: state.adminUsers ? T`${state.adminUsers.length} utilisateur${state.adminUsers.length > 1 ? 's' : ''}` : null,
      })) : null,
    h('nav', { class: 'menu card card--flush' },
      Row({
        iconName: 'logout', label: 'Se déconnecter', danger: true,
        onclick: async () => {
          if (await confirmSheet({ title: 'Se déconnecter ?', confirmLabel: 'Se déconnecter', danger: false })) signOut();
        },
      })),
    h('p', { class: 'hint center' }, T`AnabolicOS ${APP_VERSION}${state.error ? ' · erreur de synchro' : ''}`),
  ];
}
